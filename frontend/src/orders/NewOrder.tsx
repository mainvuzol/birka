import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText } from "@/shared/api";
import { Eyelet } from "@/shared/Eyelet";
import { Empty } from "@/shared/Empty";
import { Icon } from "@/shared/Icon";
import { usePanelRoom } from "@/shared/panel";
import { Placeholder } from "@/shared/Placeholder";
import { Sheet } from "@/shared/Sheet";
import { Sum } from "@/shared/Sum";
import {
  buzz,
  hideKeyboard,
  useAskBeforeClosing,
  useMainButton,
} from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { Back } from "@/shared/Back";
import { ScreenHeader } from "@/shared/ScreenHeader";
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
import { Unread } from "@/shared/Unread";
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

/**
 * «Нове замовлення» as the till sells (stage 2, orders task list, P0-5): a
 * task screen, the menu stepped aside. A few letters of the model, a tap
 * on its size puts a line in the order — from that cell's warehouse, never
 * another (business rule: no warehouse is swapped), at the store's price
 * for it, which the seller may change (owner decision, 2026-10-23, В3 (а))
 * — kept in the tray «У замовленні» under the thumb and its sheet; then
 * where it goes, one row of chips, and «Замовити та зарезервувати»,
 * Telegram's MainButton or the dock's one button. Only what the ledger
 * holds is reserved: no coat from the catalogue. The server reserves; a
 * line it finds short is marked in the sheet with what is left, the rest
 * kept as typed; any other refusal is said over «Куди». Telegram asks
 * before closing while the order holds a line.
 */
export function NewOrder({
  store,
  token,
  journalKey,
  blocked,
  waiting,
  refused,
  said,
  back,
  submit,
}: {
  store: Store;
  token: string;
  /** The till's: an order lists the stock the till sells, read once. */
  journalKey: string;
  blocked: boolean;
  /** «Замовити та зарезервувати» is being asked: the button turns. */
  waiting: boolean;
  /** Why the last «Замовити та зарезервувати» was refused, if it was. */
  refused: unknown;
  /** That refusal as the orders say it. */
  said: string | null;
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
  // The sheet «У замовленні», opened by the tray's row, by a line with no
  // price, and by the line the server found short.
  const [sheetOpen, setSheetOpen] = useState(false);
  // Within Ukraine unless said otherwise, and then by a carrier, picked
  // now; the waybill comes when it is sent (owner decisions, 2026-10-01).
  const [destination, setDestination] = useState<Destination>("UKRAINE");
  const [carrier, setCarrier] = useState<Carrier | "">("");
  const [short, setShort] = useState<Shortfall | null>(null);
  const shortRef = useRef<HTMLParagraphElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The tray's row: the cursor's way back from the sheet when what opened
  // it is gone.
  const rowRef = useRef<HTMLButtonElement>(null);
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
  // Two or more: each cell and each line says its warehouse (owner
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

  /** A cell tapped: a line of it at its price, or one more of it. */
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
    // The search done with, the keyboard goes — unless a new line's price
    // is to be typed next; and a coat in the order is felt, as at the till.
    if (item.suggested_price || at >= 0) hideKeyboard();
    if (at >= 0) {
      const held = draft[at];
      if (held && held.line.quantity < most(held)) {
        change(at, { quantity: held.line.quantity + 1 });
        buzz("light");
      }
      return;
    }
    if (draft.length >= 100) return;
    buzz("light");
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
    // A model with no price: the sheet opens, the cursor in its price.
    if (!item.suggested_price) {
      setSheetOpen(true);
      setFocusPrice(id);
    }
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

  // Refused for want of stock: the sheet opens on the line it names, with
  // what may still be reserved, and the cells read again (P0-5).
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
  const shortHere = short !== null && shortIndex >= 0;
  useEffect(() => {
    if (shortHere) setSheetOpen(true);
  }, [shortHere, refused]);
  useEffect(() => {
    if (!short) return;
    shortRef.current?.scrollIntoView({ block: "nearest" });
    shortRef.current?.focus({ preventScroll: true });
  }, [short, sheetOpen]);
  // Any other refusal — or a shortfall of a line no longer here — over
  // «Куди», in view, the lines and the carrier kept. Read off the refusal
  // itself, so a line's shortfall is never said there first.
  const refusedShort = shortOf(refused);
  const plate =
    refused === null
      ? null
      : refusedShort === null
        ? said
        : short !== null && shortIndex < 0
          ? errorText(refused)
          : null;
  useEffect(() => {
    if (plate === null) return;
    alertRef.current?.scrollIntoView({ block: "nearest" });
    alertRef.current?.focus({ preventScroll: true });
  }, [plate, refused]);
  // An empty order closes its sheet; the cursor goes to the search, where
  // the next model is found: the tray goes with the lines.
  useEffect(() => {
    if (draft.length > 0 || !sheetOpen) return;
    setSheetOpen(false);
    setFocusSearch(true);
  }, [draft.length, sheetOpen]);
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
  // Telegram asks before closing while the order holds a line (§6, 2).
  useAskBeforeClosing(draft.length > 0);

  const priced = draft.every((d) => d.line.unit_price !== "");
  const total = draft.reduce(
    (sum, d) =>
      sum + (kopecks(d.line.unit_price) ?? 0n) * BigInt(d.line.quantity),
    0n,
  );
  const units = draft.reduce((n, d) => n + d.line.quantity, 0);
  const noCarrier = destination === "UKRAINE" && carrier === "";
  const first = draft[0];
  // A line, then the carrier: the button says what is missing (P0-5).
  const words =
    draft.length > 0 && noCarrier
      ? "Оберіть перевізника"
      : "Замовити та зарезервувати";
  const ready = draft.length > 0 && priced && !noCarrier && !blocked;
  function press(): void {
    if (!ready || waiting) return;
    // Pressed over the sheet, it goes: what the press comes to — a plate,
    // a kept order — is said on the page, never under it (review,
    // 2026-11-05); a shortfall opens it again on its line.
    setSheetOpen(false);
    submit(
      draft.map((d) => d.line),
      destination,
      destination === "UKRAINE" && carrier !== "" ? carrier : null,
      // What is ordered, as a kept one's banner says it (P1-1).
      [
        first
          ? `${visible(first.name)} · ${visible(first.size)}${first.line.quantity > 1 ? ` × ${String(first.line.quantity)}` : ""}${draft.length > 1 ? ` + ще ${String(draft.length - 1)}` : ""}`
          : "",
        destination === "ABROAD"
          ? "За кордон"
          : carrier !== ""
            ? carrierLabels[carrier]
            : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  // Telegram's MainButton, set on entry and taken away on leaving (spec
  // §6, 4); held until a line has its price and a carrier is chosen.
  const main = useMainButton(words, press, {
    progress: waiting,
    active: ready,
  });
  usePanelRoom(panelRef, draft.length > 0 || !main);
  const traySaid = `У замовленні · ${String(units)}${first ? ` · ${visible(first.name)} · ${visible(first.size)}` : ""}`;
  const closeSheet = (): void => {
    setSheetOpen(false);
  };

  return (
    <>
      <ScreenHeader
        title="Нове замовлення"
        back={
          <Back go={back}>
            <span aria-hidden="true">← </span>До замовлень
          </Back>
        }
        // One warehouse: named in the screen's line, not chosen (P0-5).
        lead={
          onlyWarehouse ? `Склад: ${visible(onlyWarehouse.name)}` : undefined
        }
      />
      <section className="order-new">
        <fieldset disabled={blocked}>
          {locations.isPending ? (
            <Placeholder said="Завантажуємо склади…" field />
          ) : locations.error ? (
            <Unread
              error={locations.error}
              retry={() => {
                void locations.refetch();
              }}
            />
          ) : sellable.length === 0 ? (
            // The blank tag, its two sentences a line and its meta (spec
            // §6.28; orders and «Каса» task list after stage 2, P2-3).
            <Empty
              title="Доступних складів немає."
              meta="Зверніться до менеджера."
            />
          ) : (
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
                // A cell of no warehouse — a server from before every one
                // was listed — puts nothing in: none is guessed.
                if (!item.location_id) return false;
                return held
                  ? held.line.quantity < most(held)
                  : draft.length < 100;
              }}
              chosen={(item) =>
                draft.find(
                  (d) =>
                    stockKey(d.line) ===
                    stockKey({
                      source_location_id: item.location_id,
                      product_variant_id: item.product_variant_id,
                      size_id: item.size_id,
                    }),
                )?.line.quantity ?? 0
              }
              chosenIn="у замовленні"
              offerHeld={false}
              sticky={false}
              searchRef={searchRef}
              offer={null}
            />
          )}
          {plate !== null && (
            <p role="alert" ref={alertRef} tabIndex={-1}>
              {plate}
            </p>
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
        {/* The tray under the thumb (spec §6.15, as the till's): the order
            in one row that opens its sheet, «Разом» — and outside Telegram
            its MainButton as the dock's one button. */}
        {(draft.length > 0 || !main) && (
          <div
            className={[
              "pay-panel",
              draft.length > 0 ? "till-tray order-tray" : "order-panel",
              main ? "" : "order-dock",
            ]
              .filter(Boolean)
              .join(" ")}
            ref={panelRef}
          >
            {draft.length > 0 && (
              <>
                <button
                  ref={rowRef}
                  type="button"
                  className="tray-basket"
                  aria-haspopup="dialog"
                  aria-label={traySaid}
                  onClick={() => {
                    // Not while it is sent: its answer is said on the page.
                    if (!waiting) setSheetOpen(true);
                  }}
                >
                  <span className="tray-count">У замовленні · {units}</span>
                  {first && (
                    <span className="tray-what">
                      {visible(first.name)} · {visible(first.size)}
                    </span>
                  )}
                  <Icon name="chevron-right" size={16} className="tray-open" />
                </button>
                <p className="pay-total">
                  Разом{" "}
                  {priced ? (
                    <Sum value={money(decimal(total))} />
                  ) : (
                    // A sum without a line's price is no sum to say.
                    <strong className="sum">—</strong>
                  )}
                </p>
              </>
            )}
            {!main && (
              <button
                type="button"
                className="main-mimic"
                disabled={!ready}
                onClick={press}
              >
                {waiting ? (
                  <>
                    <Eyelet state="spin" size={20} />
                    <span className="visually-hidden">{words}</span>
                  </>
                ) : (
                  words
                )}
              </button>
            )}
          </div>
        )}
      </section>
      {sheetOpen && draft.length > 0 && (
        <Sheet
          title="У замовленні"
          close={closeSheet}
          fallback={rowRef}
          foot={
            <button
              type="button"
              className="quiet sheet-done"
              onClick={closeSheet}
            >
              Готово
            </button>
          }
        >
          <fieldset disabled={blocked}>
            {draft.map((d, index) => (
              <div
                className={index === shortIndex ? "line short" : "line"}
                key={d.id}
              >
                <strong>
                  {visible(d.name)} · {visible(d.size)}
                </strong>
                {/* Where it leaves from, under it (spec §6.16), as the
                    till's basket says it. */}
                {(places?.get(d.line.source_location_id) ??
                  onlyWarehouse?.name) !== undefined && (
                  <span className="line-place">
                    Склад:{" "}
                    {visible(
                      places?.get(d.line.source_location_id) ??
                        onlyWarehouse?.name ??
                        "",
                    )}
                  </span>
                )}
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
                        buzz("light");
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
                        buzz("light");
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
                      enterKeyHint="done"
                      placeholder="0,00"
                      value={d.price}
                      onChange={(event) => {
                        change(index, { price: event.target.value });
                      }}
                      // The keyboard's «Готово» closes the sheet, as its own
                      // button does.
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        hideKeyboard();
                        closeSheet();
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
          </fieldset>
        </Sheet>
      )}
    </>
  );
}
