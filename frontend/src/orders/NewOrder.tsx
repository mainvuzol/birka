import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText } from "@/shared/api";
import { usePanelRoom } from "@/shared/panel";
import { Placeholder } from "@/shared/Placeholder";
import { Sum } from "@/shared/Sum";
import { visible } from "@/shared/visible";
import { asInput } from "@/prices/SuggestedPrice";
import { PriceHint } from "@/sales/PriceHint";
import { StockSearch, useSettled, useStock } from "@/sales/StockSearch";
import { shortfallOf, stockKey } from "@/sales/types";
import type { Shortfall } from "@/sales/types";
import { carrierLabels, decimal, kopecks, money } from "./types";
import type {
  Carrier,
  Destination,
  Line,
  Location,
  StockOption,
  Store,
} from "./types";
import { WhereTo } from "./WhereTo";

interface DraftLine {
  /** The line's own: its key and its price field. */
  id: string;
  /** What is sent; its `unit_price` is the price typed, once it reads as one. */
  line: Line;
  /** The price as typed in the line. */
  price: string;
  /** The model's price for this store, which the line starts from. */
  suggested: string | null;
  name: string;
  size: string;
  /** What may still be reserved of it, as last read: its chip's, or the
   * server's when it refused for want of it. */
  available: number;
}

/** A price as sent: the one typed, once it reads as money; else none. */
function asPrice(typed: string): string {
  const cents = kopecks(typed);
  return cents === null ? "" : decimal(cents);
}

/** At most what may be reserved, and never more than a line holds (1000). */
function most(d: DraftLine): number {
  return Math.max(1, Math.min(d.available, 1000));
}

/** «Замовити та зарезервувати» refused for want of stock: what it names. */
export function shortOf(error: unknown): Shortfall | null {
  return error instanceof ApiError && error.code === "INSUFFICIENT_STOCK"
    ? shortfallOf(error.details)
    : null;
}

/** Under the line the server found short (orders task list, P0-5). */
function shortText(short: Shortfall): string {
  if (short.available <= 0)
    return short.reserved === true
      ? "Доступних уже немає — усі в резерві інших замовлень. Приберіть рядок."
      : "Доступних уже немає. Приберіть рядок.";
  return short.reserved === true
    ? `Доступно лише ${String(short.available)} шт. — решта в резерві інших замовлень.`
    : `Доступно лише ${String(short.available)} шт.`;
}

function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): JSX.Element {
  return (
    <div role="alert">
      <p>{errorText(error)}</p>
      <button type="button" onClick={retry}>
        Спробувати ще раз
      </button>
    </div>
  );
}

/**
 * «Нове замовлення» as the till sells (orders task list, P0-5): a few
 * letters of the model, a tap on its size puts a line in the order — from
 * that chip's warehouse, never another (business rule: no warehouse is
 * swapped), at the store's price for it, which the seller may change
 * (owner decision, 2026-10-23, В3 (а)) — then where it goes, and
 * «Замовити та зарезервувати» under the thumb. Only what the ledger holds
 * is reserved: no coat from the catalogue. The server reserves; a line it
 * finds short is marked with what is left, the rest kept as typed.
 */
export function NewOrder({
  store,
  token,
  journalKey,
  blocked,
  refused,
  back,
  submit,
}: {
  store: Store;
  token: string;
  /** The till's: an order lists the stock the till sells, read once. */
  journalKey: string;
  blocked: boolean;
  /** Why the last «Замовити та зарезервувати» was refused, if it was. */
  refused: unknown;
  back: () => void;
  submit: (
    lines: Line[],
    destination: Destination,
    carrier: Carrier | null,
    /** What it is, for its banner if its answer is lost (P1-1). */
    shown: string,
  ) => void;
}): JSX.Element {
  const [text, setText] = useState("");
  const query = useSettled(text);
  const searchRef = useRef<HTMLInputElement>(null);
  // The cursor is in the search from the start (P0-5).
  const [focusSearch, setFocusSearch] = useState(true);
  const priceRefs = useRef(new Map<string, HTMLInputElement>());
  const [focusPrice, setFocusPrice] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLine[]>([]);
  // Within Ukraine unless said otherwise, and then by a carrier, picked
  // now; the waybill comes when it is sent (owner decisions, 2026-10-01).
  const [destination, setDestination] = useState<Destination>("UKRAINE");
  const [carrier, setCarrier] = useState<Carrier | "">("");
  const [short, setShort] = useState<Shortfall | null>(null);
  const shortRef = useRef<HTMLParagraphElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const linesHeading = useId();
  const cache = useQueryClient();

  const locations = useQuery({
    queryKey: ["sale-locations", journalKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  const sellable = (locations.data ?? []).filter(
    (location) => location.is_active && location.can_sell,
  );
  const onlyWarehouse = sellable.length === 1 ? sellable[0] : undefined;
  // Two or more: each chip and each line says its warehouse (owner
  // decision, 2026-10-17).
  const places = useMemo(() => {
    const rows = (locations.data ?? []).filter(
      (location) => location.is_active && location.can_sell,
    );
    return rows.length >= 2
      ? new Map(rows.map((location) => [location.id, location.name]))
      : null;
  }, [locations.data]);
  const stock = useStock({
    store,
    token,
    journalKey,
    locationId: null,
    query,
    enabled: !locations.isError && sellable.length > 0,
  });

  const placeOf = (id: string): string =>
    places ? ` · ${visible(places.get(id) ?? "")}` : "";

  const shortIndex =
    short === null
      ? -1
      : draft.findIndex(
          (d) =>
            stockKey(d.line) ===
            stockKey({
              source_location_id: short.location_id,
              product_variant_id: short.product_variant_id,
              size_id: short.size_id,
            }),
        );

  /** A chip tapped: a line of it at its price, or one more of it. */
  function put(item: StockOption): void {
    if (!item.location_id) return;
    const line: Line = {
      product_variant_id: item.product_variant_id,
      size_id: item.size_id,
      source_location_id: item.location_id,
      quantity: 1,
      unit_price: item.suggested_price ? asPrice(item.suggested_price) : "",
      discount_amount: "0.00",
    };
    const at = draft.findIndex((d) => stockKey(d.line) === stockKey(line));
    if (at >= 0) {
      const held = draft[at];
      if (held && held.line.quantity < most(held))
        change(at, { quantity: held.line.quantity + 1 });
      return;
    }
    if (draft.length >= 100) return;
    const id = crypto.randomUUID();
    setDraft([
      ...draft,
      {
        id,
        line,
        price: item.suggested_price ? asInput(item.suggested_price) : "",
        suggested: item.suggested_price,
        name: item.display_name,
        size: item.size_is_unknown ? "розмір невідомий" : item.size_label,
        available: item.available_quantity,
      },
    ]);
    if (!item.suggested_price) setFocusPrice(id);
  }

  function change(
    index: number,
    edit: { quantity?: number; price?: string },
  ): void {
    setDraft(
      draft.map((d, i) => {
        if (i !== index) return d;
        const price = edit.price ?? d.price;
        return {
          ...d,
          price,
          line: {
            ...d.line,
            quantity: edit.quantity ?? d.line.quantity,
            unit_price: asPrice(price),
          },
        };
      }),
    );
    // Its count changed: the line the server found short is the seller's
    // again (review, 2026-10-24).
    if (index === shortIndex && edit.quantity !== undefined) setShort(null);
  }

  // Refused for want of stock: the line it names marked, with what may
  // still be reserved, and the chips read again (P0-5).
  useEffect(() => {
    const found = shortOf(refused);
    setShort(found);
    if (!found) return;
    const key = stockKey({
      source_location_id: found.location_id,
      product_variant_id: found.product_variant_id,
      size_id: found.size_id,
    });
    setDraft((lines) =>
      lines.map((d) =>
        stockKey(d.line) === key
          ? { ...d, available: Math.max(found.available, 0) }
          : d,
      ),
    );
    void cache.invalidateQueries({
      queryKey: ["sale-stock", journalKey, store.id],
    });
  }, [refused, cache, journalKey, store.id]);
  useEffect(() => {
    if (!short) return;
    shortRef.current?.scrollIntoView({ block: "nearest" });
    shortRef.current?.focus({ preventScroll: true });
  }, [short]);
  useEffect(() => {
    if (focusPrice === null) return;
    priceRefs.current.get(focusPrice)?.focus();
    setFocusPrice(null);
  }, [focusPrice]);
  useEffect(() => {
    // The search waits for the warehouses to be read.
    if (!focusSearch || !searchRef.current) return;
    searchRef.current.focus();
    setFocusSearch(false);
  }, [focusSearch, locations.status]);
  usePanelRoom(panelRef, draft.length > 0);

  const priced = draft.every((d) => d.line.unit_price !== "");
  const total = draft.reduce(
    (sum, d) =>
      sum + (kopecks(d.line.unit_price) ?? 0n) * BigInt(d.line.quantity),
    0n,
  );
  const units = draft.reduce((n, d) => n + d.line.quantity, 0);
  const noCarrier = destination === "UKRAINE" && carrier === "";
  const first = draft[0];
  // What is ordered, as the panel says it (and a kept one's banner, P1-1).
  const what =
    draft.length === 1 && first
      ? `${visible(first.name)} · ${visible(first.size)}${placeOf(first.line.source_location_id)}${first.line.quantity > 1 ? ` × ${String(first.line.quantity)}` : ""}`
      : `У замовленні: ${String(units)} шт.`;

  return (
    <section className="order-new">
      <button type="button" className="quiet" onClick={back}>
        ← До замовлень
      </button>
      <h2>Нове замовлення</h2>
      <fieldset disabled={blocked}>
        {locations.isPending ? (
          <Placeholder said="Завантажуємо склади…" field />
        ) : locations.error ? (
          <Failure
            error={locations.error}
            retry={() => {
              void locations.refetch();
            }}
          />
        ) : sellable.length === 0 ? (
          <p className="empty">
            Доступних складів немає. Зверніться до менеджера.
          </p>
        ) : (
          <>
            {onlyWarehouse && (
              // One warehouse: named, not chosen (P0-5).
              <p className="warehouse">Склад: {visible(onlyWarehouse.name)}</p>
            )}
            <StockSearch
              text={text}
              type={setText}
              query={query}
              stock={stock}
              warehouse={onlyWarehouse?.name ?? ""}
              places={places}
              pick={put}
              canAdd={(item) => {
                const held = draft.find(
                  (d) =>
                    stockKey(d.line) ===
                    stockKey({
                      source_location_id: item.location_id,
                      product_variant_id: item.product_variant_id,
                      size_id: item.size_id,
                    }),
                );
                // A chip of no warehouse — a server from before every one
                // was listed — puts nothing in: none is guessed.
                if (!item.location_id) return false;
                return held
                  ? held.line.quantity < most(held)
                  : draft.length < 100;
              }}
              offerHeld={false}
              searchRef={searchRef}
              failure={
                stock.error ? (
                  <Failure
                    error={stock.error}
                    retry={() => {
                      void stock.refetch();
                    }}
                  />
                ) : null
              }
              offer={null}
            />
          </>
        )}
        {draft.length > 0 && (
          <div
            className="order-lines"
            role="group"
            aria-labelledby={linesHeading}
          >
            <h3 id={linesHeading}>У замовленні</h3>
            {draft.map((d, index) => (
              <div
                className={index === shortIndex ? "line short" : "line"}
                key={d.id}
              >
                <strong>
                  {visible(d.name)} · {visible(d.size)}
                  {placeOf(d.line.source_location_id)}
                </strong>
                <div className="line-edit">
                  <div
                    className="stepper"
                    role="group"
                    aria-label={`Кількість: ${visible(d.name)} · ${visible(d.size)}${placeOf(d.line.source_location_id)}`}
                  >
                    <button
                      type="button"
                      aria-label="Менше"
                      disabled={d.line.quantity <= 1}
                      onClick={() => {
                        change(index, { quantity: d.line.quantity - 1 });
                      }}
                    >
                      −
                    </button>
                    <output>{d.line.quantity}</output>
                    <button
                      type="button"
                      aria-label="Більше"
                      disabled={d.line.quantity >= most(d)}
                      onClick={() => {
                        change(index, { quantity: d.line.quantity + 1 });
                      }}
                    >
                      +
                    </button>
                  </div>
                  <label>
                    Ціна, грн
                    <input
                      ref={(input) => {
                        if (input) priceRefs.current.set(d.id, input);
                        else priceRefs.current.delete(d.id);
                      }}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={d.price}
                      onChange={(event) => {
                        change(index, { price: event.target.value });
                      }}
                    />
                  </label>
                </div>
                <PriceHint
                  typed={d.price}
                  price={d.line.unit_price}
                  suggested={d.suggested}
                />
                {index === shortIndex && short && (
                  <p
                    className="line-short"
                    role="alert"
                    tabIndex={-1}
                    ref={shortRef}
                  >
                    {shortText(short)}
                  </p>
                )}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setDraft(draft.filter((_, i) => i !== index));
                    if (index === shortIndex) setShort(null);
                  }}
                >
                  Прибрати {visible(d.name)} · {visible(d.size)}
                  {placeOf(d.line.source_location_id)}
                </button>
              </div>
            ))}
          </div>
        )}
        {short && shortIndex < 0 && (
          // Short of a line no longer here: the server's words.
          <p role="alert">{errorText(refused)}</p>
        )}
        <WhereTo
          destination={destination}
          carrier={carrier}
          disabled={blocked}
          change={(nextDestination, nextCarrier) => {
            setDestination(nextDestination);
            setCarrier(nextCarrier);
          }}
        />
        <p className="hint">
          {destination === "ABROAD"
            ? "Куди і як відправили — впишете, коли відправите."
            : "ТТН впишете, коли відправите."}
        </p>
      </fieldset>
      {/* Under the thumb (P0-5): what is ordered, its sum, and the one
          press, which says the carrier first when none is chosen — as
          «Каса»'s «Оберіть новий спосіб». */}
      {draft.length > 0 && (
        <div className="pay-panel" ref={panelRef}>
          <p className="pay-what">{what}</p>
          <p className="pay-total">
            Разом{" "}
            {priced ? (
              <Sum value={money(decimal(total))} />
            ) : (
              // A sum without a line's price is no sum to say.
              <strong className="sum">—</strong>
            )}
          </p>
          <button
            type="button"
            className="cash-panel-button"
            disabled={blocked || !priced || noCarrier}
            onClick={() => {
              submit(
                draft.map((d) => d.line),
                destination,
                destination === "UKRAINE" && carrier !== "" ? carrier : null,
                [
                  first
                    ? `${visible(first.name)} · ${visible(first.size)}${first.line.quantity > 1 ? ` × ${String(first.line.quantity)}` : ""}${draft.length > 1 ? ` + ще ${String(draft.length - 1)}` : ""}`
                    : what,
                  destination === "ABROAD"
                    ? "За кордон"
                    : carrier !== ""
                      ? carrierLabels[carrier]
                      : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              );
            }}
          >
            {noCarrier ? "Оберіть перевізника" : "Замовити та зарезервувати"}
          </button>
        </div>
      )}
    </section>
  );
}
