import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import type { ApiError } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Location, StockOption, Store } from "@/orders/types";
import type { SizeOption } from "@/inventory/receiptTypes";
import { asInput } from "@/prices/SuggestedPrice";
import { sizeLabel } from "@/returns/types";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
import { methodHow, methodLabels, tillMethods } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";
import { submitSale, useSaleCommand } from "./commands";
import { paperDay, setPaper, setSoldBy, usePaper } from "./paper";
import type {
  EmptyShelf,
  OutageBody,
  SaleLine,
  Sale as SaleReceipt,
  Shortfall,
} from "./types";
import { markText, paidDuringOutage, stockKey } from "./types";

const pageSize = 100;

/**
 * A sale typed from paper refused for stock (owner decisions, 2026-10-04 and
 * 2026-10-07; ADR-0013 §6): never sold around the shortfall — nobody stands
 * at the shelf now — but after a manager fixes the balance, or, for units
 * reserved for an order, decides about the order.
 */
const paperGone =
  "Цього товару вже немає в обліку — продаж з паперу не записано. Попросіть менеджера спершу виправити залишок, потім внесіть цей продаж ще раз. Кошик збережено — нічого не продано.";
const paperReserved =
  "Частина цих одиниць у резерві замовлення — продаж з паперу не записано. Менеджер має вирішити із замовленням, потім внесіть цей продаж ще раз. Кошик збережено — нічого не продано.";

interface Draft {
  line: SaleLine;
  name: string;
  size: string;
  /** Sold as "size not known": there is no size to clarify, nothing to find. */
  unknownSize: boolean;
  /** Its size was read off a coat held with its size not known. */
  fromUnknown: boolean;
}

/**
 * The till.
 *
 * Two things make this screen different from reserving an order. It takes
 * money, so the command journal in `./commands` is what decides when a basket
 * may be sent again. And it must let the seller sell what they can *see*: a
 * shelf that disagrees with the ledger is the normal case this whole flow was
 * designed around, so a quantity above the recorded balance is offered to the
 * server rather than blocked here. The server refuses, names the shortfall,
 * and the seller answers it — «товар на місці» or «на місці лише стільько».
 *
 * A third answer exists where a legacy list left the same model here with its
 * size not known (ADR-0005 §11): the coat in hand is one of those, and its
 * label says M. The seller clarifies its size and it is sold as M, as an
 * audited pair of movements. «Товар на місці» is then not offered — the server
 * refuses it, because the coat could be counted twice. A coat held that way
 * whose size is on its label can also be sold with that size from the start,
 * which is how an M the system holds none of is sold at all.
 *
 * The seller sells with the way the customer pays: «Готівка», «Картка» or
 * «Переказ» in place of «Продати», so a sale still takes five taps and
 * nothing is guessed (owner decision, 2026-10-04; ADR-0012 §B12). The press
 * comes first, then the terminal is charged the sum the receipt shows: it may
 * still change when a coat is not on the shelf.
 *
 * Sales written on paper while the server did not answer are typed here
 * once it does, with «Вношу продаж з паперу» ticked (owner decisions,
 * 2026-10-04 and 2026-10-07; ADR-0013 §7): each is marked «продано під час
 * збою», with who sold and the paper's time when known. Off by default, so a
 * live sale still takes five taps and its body carries no mark. On, the till
 * offers nothing that describes the shelf now — nobody stands at it — and
 * the pay buttons say the mode, who sold and from which warehouse, since a
 * wrong mark can never be changed.
 */
export function Sale({
  store,
  token,
  journalKey,
  blocked,
  fixMethod,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  /**
   * Opens «Каса»'s step that changes how this one sale was paid. Given, the
   * receipt offers «Змінити спосіб оплати»: a card the terminal refused, and
   * the customer paid another way (owner decision, 2026-10-04; ADR-0012
   * §B6.4).
   */
  fixMethod?: (sale: SaleReceipt) => void;
}): JSX.Element {
  const [locationId, setLocationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [option, setOption] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [draft, setDraft] = useState<Draft[]>([]);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [found, setFound] = useState<Record<number, number>>({});
  const [missing, setMissing] = useState<Record<number, number>>({});
  const [clarified, setClarified] = useState<Record<number, number>>({});
  // `location:variant` keys this till has learned hold the model with its
  // size not known — from the server refusing «товар на місці» because of it.
  const [heldUnknown, setHeldUnknown] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [labelSize, setLabelSize] = useState("");
  const [shortfall, setShortfall] = useState<Shortfall | null>(null);
  const [refusal, setRefusal] = useState<unknown>(null);
  const [present, setPresent] = useState("");
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  // Lines dropped from the receipt's sale because nothing was on the shelf.
  const [dropped, setDropped] = useState<string[]>([]);
  const [nothingSold, setNothingSold] = useState<EmptyShelf | null>(null);
  const [validation, setValidation] = useState("");
  // Paying in parts (owner decisions, 2026-10-01): the customer takes the
  // goods now, pays part and owes the rest to this store.
  const [credit, setCredit] = useState<TermsInput>(noTerms);
  // The way the seller pressed. A shortfall's answers resend the same sale,
  // so they keep it and say it (ADR-0012 §B12); a changed basket forgets it.
  const [method, setMethod] = useState<TillMethod | null>(null);
  // Paper mode: the switch and «Хто продав» outlive this screen (`./paper`);
  // the paper's time is this sale's alone.
  const paper = usePaper((state) => state.storeId === store.id);
  const soldBy = usePaper((state) =>
    state.storeId === store.id ? state.soldBy : null,
  );
  const [paperTime, setPaperTime] = useState("");
  const [yesterday, setYesterday] = useState(false);
  const { busy, pending } = useSaleCommand();

  const mayCorrect = store.permissions.includes(
    "inventory:correct_during_sale",
  );
  const mayReportMissing = store.permissions.includes(
    "inventory:report_missing_during_sale",
  );
  // The organization's sizes come from the receiving endpoint, which asks
  // for `inventory:receive`; the default seller holds both.
  const mayReadLabel =
    mayCorrect && store.permissions.includes("inventory:receive");
  const mayCredit = store.permissions.includes("sale:credit");

  const locations = useQuery({
    queryKey: ["sale-locations", journalKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  const stock = useQuery({
    queryKey: ["sale-stock", journalKey, store.id, locationId, offset],
    queryFn: () =>
      api<{ items: StockOption[]; has_more: boolean }>(
        `/catalog/stock-options?store_id=${store.id}&location_id=${locationId}&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    enabled: !!locationId && !locations.isError,
    retry: false,
  });
  const selected = stock.data?.items.find(
    (item) => `${item.product_variant_id}:${item.size_id}` === option,
  );
  const sizes = useQuery({
    queryKey: ["sale-sizes", journalKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    enabled: mayReadLabel && !!selected?.size_is_unknown && !paper,
    retry: false,
  });
  // Who may be named as having sold: read only while the switch is on
  // (ADR-0013 §5.7). Only someone this list shows is ever sent.
  const sellers = useQuery({
    queryKey: ["sale-sellers", journalKey, store.id],
    queryFn: () =>
      api<{ sellers: { user_id: string; display_name: string }[] }>(
        `/stores/${store.id}/sellers`,
        token,
      ),
    enabled: paper,
    retry: false,
  });
  const named =
    soldBy === null
      ? undefined
      : sellers.data?.sellers.find((seller) => seller.user_id === soldBy);

  // A basket that changed is a different business operation, and any answer
  // given about the old one no longer applies to it.
  function replaceDraft(next: Draft[]): void {
    setDraft(next);
    setCommandId(crypto.randomUUID());
    setFound({});
    setMissing({});
    setClarified({});
    setShortfall(null);
    setPresent("");
    setMethod(null);
  }

  /**
   * The switch (G20). Ticked, the basket stays, and any answer about the
   * shelf already given goes: a marked sale may not carry one (§5.3).
   * Unticked, a basket built from paper goes, with its answers and its
   * `command_id`: sent unmarked, its shortfall would offer «Товар на місці»
   * and record a coat found that never was.
   */
  function turnPaper(on: boolean): void {
    setPaper(store.id, on);
    setPaperTime("");
    setYesterday(false);
    setRefusal(null);
    setValidation("");
    setLabelSize("");
    if (on) {
      setFound({});
      setMissing({});
      setClarified({});
      setShortfall(null);
      setPresent("");
      setMethod(null);
    } else if (draft.length > 0) replaceDraft([]);
  }

  useEffect(() => {
    if (locationId && locations.isSuccess) {
      const reachable = locations.data.some(
        (location) => location.id === locationId,
      );
      if (!reachable) {
        setLocationId("");
        setOption("");
        setOffset(0);
      }
    }
  }, [locationId, locations.isSuccess, locations.data]);

  const sellable = (locations.data ?? []).filter(
    (location) => location.is_active && location.can_sell,
  );
  const onlyWarehouse = sellable.length === 1 ? sellable[0] : undefined;
  // Where the goods leave from, named on a paper sale's press: a store may
  // sell from two warehouses, and the paper says which (G21).
  const from = [
    ...new Set(
      (draft.length > 0
        ? draft.map((d) => d.line.source_location_id)
        : [locationId]
      )
        .map(
          (id) => locations.data?.find((location) => location.id === id)?.name,
        )
        .filter((name): name is string => name !== undefined),
    ),
  ];

  useEffect(() => {
    // Explicitly permitted: "the client may prefill it when the store reaches
    // only one warehouse, but the server never chooses" (sale API, owner
    // decision 2026-09-17). Two taps out of a measured eight, and the seller
    // is choosing nothing they had an alternative to.
    if (!locationId && onlyWarehouse) setLocationId(onlyWarehouse.id);
  }, [locationId, onlyWarehouse]);

  function add(): void {
    const cents = kopecks(price);
    const count = Number(quantity);
    if (
      !selected ||
      cents === null ||
      !/^\d+$/.test(quantity) ||
      count < 1 ||
      count > 1000
    ) {
      setValidation(
        "Оберіть товар, кількість від 1 до 1000 та ціну з точністю до копійок.",
      );
      return;
    }
    const label = selected.size_is_unknown
      ? sizes.data?.find((size) => size.size_id === labelSize)
      : undefined;
    const line: SaleLine = {
      product_variant_id: selected.product_variant_id,
      size_id: label ? label.size_id : selected.size_id,
      source_location_id: locationId,
      quantity: count,
      unit_price: decimal(cents),
      discount_amount: "0.00",
    };
    if (draft.some((d) => stockKey(d.line) === stockKey(line))) {
      setValidation(
        "Цей товар із цього складу вже в кошику. Видаліть рядок, щоб змінити кількість.",
      );
      return;
    }
    replaceDraft([
      ...draft,
      {
        line,
        name: selected.display_name,
        size: label
          ? label.code
          : selected.size_is_unknown
            ? "розмір невідомий"
            : selected.size_label,
        unknownSize: selected.size_is_unknown && !label,
        fromUnknown: label !== undefined,
      },
    ]);
    setPrice("");
    setQuantity("1");
    setOption("");
    setLabelSize("");
    setValidation("");
  }

  async function send(
    way: TillMethod,
    nextFound: Record<number, number>,
    nextMissing: Record<number, number>,
    nextClarified: Record<number, number>,
  ): Promise<void> {
    // Nothing on the shelf of a line drops it from the sale (owner decision,
    // 2026-10-01; Q-G). Nothing on the shelf of any line leaves no sale to
    // make, and the basket records an empty shelf instead.
    const empty = draft.filter((_, index) => nextMissing[index] === 0);
    const emptyShelf = draft.length > 0 && empty.length === draft.length;
    // What will be sold: a line answered «на місці лише N» sells N.
    const sold = draft.reduce(
      (sum, d, index) =>
        sum +
        (kopecks(d.line.unit_price) ?? 0n) *
          BigInt(nextMissing[index] ?? d.line.quantity),
      0n,
    );
    const terms =
      credit.inParts && !emptyShelf ? checkTerms(credit, sold) : null;
    if (typeof terms === "string") {
      setValidation(terms);
      return;
    }
    // The paper's time as its day and hour, the store's wall clock (G1).
    const time = /^\d{2}:\d{2}/.exec(paperTime)?.[0];
    const mark: OutageBody | null = paper
      ? {
          sold_by_user_id: named?.user_id ?? null,
          sold_at: time ? `${paperDay(yesterday)}T${time}` : null,
        }
      : null;
    let key: string;
    try {
      // A new key per payload: one key then always answers one payload, and
      // a replay of it is unambiguous. `command_id` is what keeps the
      // corrected attempt from selling twice.
      key = crypto.randomUUID();
    } catch (error) {
      // The phone's own failure, before anything was sent: said as such,
      // never as the server's (ADR-0013 §3).
      setRefusal(error);
      return;
    }
    const asked = shortfall;
    setMethod(way);
    setShortfall(null);
    setRefusal(null);
    setValidation("");
    const outcome = await submitSale(journalKey, token, {
      key,
      emptyShelf,
      body: {
        store_id: store.id,
        command_id: commandId,
        lines: draft.map((d) => d.line),
        found_in_store: Object.entries(nextFound).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        missing_in_store: Object.entries(nextMissing).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        size_clarified: Object.entries(nextClarified).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        ...(terms ? { credit: terms } : {}),
        payment_method: way,
        // Only in paper mode: an ordinary sale has no such key (§7).
        ...(mark ? { outage: mark } : {}),
      },
    });
    if (outcome.kind === "sold" || outcome.kind === "nothing-sold") {
      if (outcome.kind === "sold") {
        setReceipt(outcome.sale);
        setDropped(empty.map((d) => `${visible(d.name)} · ${visible(d.size)}`));
      } else {
        setNothingSold(outcome.shelf);
      }
      setDraft([]);
      setFound({});
      setMissing({});
      setClarified({});
      setCommandId(crypto.randomUUID());
      setPresent("");
      setMethod(null);
      // A paper's time is one sale's: left, it would go on the next one,
      // and a wrong time is permanent (§7). The switch and who sold stay
      // for the series.
      setPaperTime("");
      setYesterday(false);
      // The next customer is someone else.
      setCredit(noTerms);
      await stock.refetch();
    } else if (outcome.kind === "refused") {
      const { error, shortfall: short } = outcome;
      const { details } = error;
      if (
        error.code === "UNKNOWN_SIZE_STOCK" &&
        asked !== null &&
        details.product_variant_id === asked.product_variant_id &&
        details.location_id === asked.location_id
      ) {
        // «Товар на місці» was refused because this model is held here with
        // its size not known. Nothing was sold, the same shortfall stands,
        // and now the till knows which answer fits it.
        setHeldUnknown(
          (known) =>
            new Set([
              ...known,
              `${asked.location_id}:${asked.product_variant_id}`,
            ]),
        );
        const index = indexOf(asked);
        setFound(
          Object.fromEntries(
            Object.entries(nextFound).filter(([key]) => Number(key) !== index),
          ),
        );
        setShortfall(asked);
      } else if (short && details.reason === undefined) {
        setShortfall(short);
      } else {
        // A clarification refused for its own reason is withdrawn, so the
        // seller answers afresh rather than resending what cannot pass.
        setClarified({});
        setRefusal(error);
      }
      setPresent("");
    }
  }

  /** A shortfall's answer: the same sale, the same way, one answer more. */
  function answer(
    nextFound: Record<number, number>,
    nextMissing: Record<number, number>,
    nextClarified: Record<number, number>,
  ): void {
    if (method) void send(method, nextFound, nextMissing, nextClarified);
  }

  function indexOf(short: Shortfall): number {
    return draft.findIndex(
      (d) =>
        stockKey(d.line) ===
        stockKey({
          source_location_id: short.location_id,
          product_variant_id: short.product_variant_id,
          size_id: short.size_id,
        }),
    );
  }

  const total = draft.reduce(
    (sum, d) =>
      sum + (kopecks(d.line.unit_price) ?? 0n) * BigInt(d.line.quantity),
    0n,
  );
  const shortIndex = shortfall ? indexOf(shortfall) : -1;
  const shortDraft = shortIndex >= 0 ? draft[shortIndex] : undefined;
  // Whether the short line's model is held at its warehouse with its size not
  // known — and so whether the coat in hand may be one of those.
  const unknownHere =
    shortDraft !== undefined &&
    !shortDraft.unknownSize &&
    (shortDraft.fromUnknown ||
      heldUnknown.has(
        `${shortDraft.line.source_location_id}:${shortDraft.line.product_variant_id}`,
      ) ||
      (shortDraft.line.source_location_id === locationId &&
        (stock.data?.items ?? []).some(
          (item) =>
            item.product_variant_id === shortDraft.line.product_variant_id &&
            item.size_is_unknown &&
            item.available_quantity > 0,
        )));
  const working = busy || pending !== null;
  // The server's answer to a shortage opens above the panel, in view and
  // focused, so it is never past the edge of the screen (redesign P0-4).
  const shortRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!shortfall) return;
    shortRef.current?.scrollIntoView({ block: "nearest" });
    shortRef.current?.focus({ preventScroll: true });
  }, [shortfall]);
  // Paid in parts: what is paid now and what is left, as typed so far. The
  // receipt's figures are the server's.
  const paidNow = mayCredit && credit.inParts ? kopecks(credit.paid) : null;
  const owing =
    paidNow !== null && paidNow > 0n && paidNow < total
      ? { now: paidNow, left: total - paidNow }
      : null;
  // Named on every answer that sells: «… · Картка».
  const how = method ? ` · ${methodLabels[method]}` : "";

  if (nothingSold)
    return (
      <NothingSold
        shelf={nothingSold}
        next={() => {
          setNothingSold(null);
        }}
      />
    );

  if (receipt)
    return (
      <Receipt
        receipt={receipt}
        dropped={dropped}
        next={() => {
          setReceipt(null);
          setDropped([]);
        }}
        fixMethod={fixMethod}
      />
    );

  return (
    <section>
      <h2>Продаж</h2>
      <p className="hint">
        Оберіть склад, з якого фізично віддаєте товар. Ціна — остаточна після
        торгу.
      </p>
      {paper && (
        <section className="notice" aria-label="Режим: продаж з паперу">
          <h3>Режим: продаж з паперу</h3>
          <p>
            Продаж позначать «продано під час збою». Він увійде в сьогоднішній
            «Звіт» і в касу до наступного закриття.
          </p>
        </section>
      )}
      <fieldset disabled={blocked || working}>
        <legend>Кошик</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={paper}
            onChange={(event) => {
              turnPaper(event.target.checked);
            }}
          />
          Вношу продаж з паперу
        </label>
        {paper && (
          <>
            <label>
              Хто продав
              <select
                value={named?.user_id ?? ""}
                onChange={(event) => {
                  setSoldBy(store.id, event.target.value || null);
                }}
              >
                <option value="">Не вказано</option>
                {(sellers.data?.sellers ?? []).map((seller) => (
                  <option key={seller.user_id} value={seller.user_id}>
                    {visible(seller.display_name)}
                  </option>
                ))}
              </select>
            </label>
            {sellers.error && (
              <Failure
                error={sellers.error}
                retry={() => {
                  void sellers.refetch();
                }}
              />
            )}
            <div className="fields">
              <label>
                Час з паперу
                <input
                  type="time"
                  value={paperTime}
                  onChange={(event) => {
                    setPaperTime(event.target.value);
                    if (!event.target.value) setYesterday(false);
                  }}
                />
              </label>
              {paperTime && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={yesterday}
                    onChange={(event) => {
                      setYesterday(event.target.checked);
                    }}
                  />
                  Це було вчора
                </label>
              )}
            </div>
          </>
        )}
        {locations.isPending ? (
          <p role="status">Завантажуємо склади…</p>
        ) : locations.error ? (
          <Failure
            error={locations.error}
            retry={() => {
              void locations.refetch();
            }}
          />
        ) : (
          <label>
            Склад
            <select
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setOffset(0);
                setOption("");
              }}
            >
              {!onlyWarehouse && <option value="">Оберіть склад явно</option>}
              {locations.data.map((location) => (
                <option
                  key={location.id}
                  value={location.id}
                  disabled={!location.is_active || !location.can_sell}
                >
                  {visible(location.name)}
                  {!location.is_active
                    ? " — на паузі"
                    : !location.can_sell
                      ? " — без права продажу"
                      : ""}
                </option>
              ))}
            </select>
            {locations.data.length === 0 && (
              <span>Доступних складів немає. Зверніться до менеджера.</span>
            )}
          </label>
        )}
        {locationId &&
          (stock.isPending ? (
            <p role="status">Завантажуємо товари…</p>
          ) : stock.error ? (
            <Failure
              error={stock.error}
              retry={() => {
                void stock.refetch();
              }}
            />
          ) : (
            <>
              <label>
                Товар і розмір
                <select
                  value={option}
                  onChange={(event) => {
                    setOption(event.target.value);
                    setLabelSize("");
                    // The model's suggested price, which the seller may
                    // change: the agreed price is the one sold at (owner
                    // decisions, 2026-09-15 and 2026-10-01). A model with
                    // none leaves the field empty, never a previous one's.
                    const picked = stock.data.items.find(
                      (item) =>
                        `${item.product_variant_id}:${item.size_id}` ===
                        event.target.value,
                    );
                    setPrice(
                      picked?.suggested_price
                        ? asInput(picked.suggested_price)
                        : "",
                    );
                  }}
                >
                  <option value="">Оберіть товар</option>
                  {stock.data.items.map((item) => (
                    <option
                      key={`${item.product_variant_id}:${item.size_id}`}
                      value={`${item.product_variant_id}:${item.size_id}`}
                    >
                      {visible(item.display_name)} ·{" "}
                      {item.size_is_unknown
                        ? "розмір невідомий"
                        : visible(item.size_label)}{" "}
                      · доступно {item.available_quantity}
                    </option>
                  ))}
                </select>
              </label>
              {stock.data.items.length === 0 && (
                <p>На цьому складі немає товарів із додатним залишком.</p>
              )}
              {selected && (
                <p className="hint">
                  На складі {selected.quantity} · у резерві{" "}
                  {selected.reserved_quantity} · доступно{" "}
                  {selected.available_quantity}
                  {selected.size_is_unknown &&
                    " · розмір невідомий: продається як є"}
                </p>
              )}
              {selected?.size_is_unknown && paper && (
                // A size read off a coat in hand: on paper nobody holds it
                // (G3).
                <p className="hint">
                  Товар без розміру вносьте як «розмір невідомий».
                </p>
              )}
              {selected?.size_is_unknown && mayReadLabel && !paper && (
                <label>
                  Розмір з етикетки
                  <select
                    value={labelSize}
                    onChange={(event) => {
                      setLabelSize(event.target.value);
                    }}
                  >
                    <option value="">Не читали — продати без розміру</option>
                    {(sizes.data ?? []).map((size) => (
                      <option key={size.size_id} value={size.size_id}>
                        {visible(size.code)}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Прочитали розмір на етикетці — оберіть його, і товар
                    продасться з цим розміром.
                  </span>
                </label>
              )}
              {sizes.error && (
                <Failure
                  error={sizes.error}
                  retry={() => {
                    void sizes.refetch();
                  }}
                />
              )}
              <div className="toolbar">
                <button
                  type="button"
                  className="quiet"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - pageSize));
                    setOption("");
                  }}
                >
                  Попередні товари
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={!stock.data.has_more}
                  onClick={() => {
                    setOffset(offset + pageSize);
                    setOption("");
                  }}
                >
                  Наступні товари
                </button>
              </div>
            </>
          ))}
        <div className="fields">
          <label>
            Кількість
            <input
              inputMode="numeric"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
              }}
            />
          </label>
          <label>
            Ціна за одиницю, грн
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={price}
              onChange={(event) => {
                setPrice(event.target.value);
              }}
            />
            {selected?.suggested_price && (
              <span className="hint">
                Рекомендована {money(selected.suggested_price)}. Домовилися про
                іншу — змініть.
              </span>
            )}
          </label>
        </div>
        <button
          type="button"
          className="quiet"
          disabled={!selected || draft.length >= 100}
          onClick={add}
        >
          Додати в кошик
        </button>
        {validation && <p role="alert">{validation}</p>}
        {draft.map((d, index) => (
          <div
            className={index === shortIndex ? "line short" : "line"}
            key={stockKey(d.line)}
          >
            <strong>
              {visible(d.name)} · {visible(d.size)}
            </strong>
            <span>
              {d.line.quantity} × {money(d.line.unit_price)}
            </span>
            {found[index] !== undefined && (
              <span>Підтверджено на місці: +{found[index]}</span>
            )}
            {missing[index] === 0 ? (
              <span>На полиці немає — не продається</span>
            ) : (
              missing[index] !== undefined && (
                <span>На місці лише {missing[index]}</span>
              )
            )}
            {d.fromUnknown && (
              <span className="hint">Розмір з етикетки товару без розміру</span>
            )}
            {clarified[index] !== undefined && (
              <span>
                Розмір уточнено: {clarified[index]} од. з «розмір невідомий»
              </span>
            )}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                replaceDraft(draft.filter((_, i) => i !== index));
              }}
            >
              Прибрати {visible(d.name)}
            </button>
          </div>
        ))}
        {mayCredit && (
          <TermsFields
            value={credit}
            change={setCredit}
            total={total}
            hint="Покупець забирає товар зараз, решту доплачує, коли зможе. Внески приймає лише цей магазин, у розділі «Борги»."
          />
        )}
        <p className="hint">
          {paper
            ? // The card was charged during the outage (G19).
              "Оплату взяли під час збою: натисніть, як оплатили. На терміналі нічого не проводьте."
            : "Спершу натисніть, як платить покупець, потім проведіть на терміналі суму з чека: вона може змінитися, якщо товару не виявиться на полиці."}
        </p>
      </fieldset>
      {refusal !== null && (
        <p role="alert">
          {refusalText(refusal)} Кошик збережено — нічого не продано.
        </p>
      )}
      {shortfall && (
        <section
          className="notice"
          role="alert"
          ref={shortRef}
          tabIndex={-1}
          aria-label="Залишку не вистачає"
        >
          <h3>Залишку не вистачає</h3>
          {shortDraft === undefined || shortIndex < 0 ? (
            <p>
              Сервер відмовив через товар, якого немає в цьому кошику. Оновіть
              залишки й складіть кошик заново.
            </p>
          ) : (
            <>
              <p>
                {visible(shortDraft.name)} · {visible(shortDraft.size)}: у
                кошику {shortfall.requested}, в обліку доступно{" "}
                {shortfall.available}.
              </p>
              {paper ? (
                // Nothing that describes the shelf now (§6, §7).
                <p>{shortfall.reserved === true ? paperReserved : paperGone}</p>
              ) : !shortfall.correctable ? (
                <p>
                  Цей залишок неможливо виправити під час продажу — частина
                  одиниць у резерві замовлення. Зменшіть кількість або продайте
                  інший товар.
                </p>
              ) : (
                <>
                  {mayCorrect && unknownHere && (
                    <>
                      <p>
                        Ця модель є на складі з невідомим розміром. Якщо у вас
                        одна з тих одиниць, уточніть її розмір — вона продасться
                        як {visible(shortDraft.size)}.
                      </p>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          const next = {
                            ...clarified,
                            [shortIndex]:
                              shortfall.requested - shortfall.available,
                          };
                          setClarified(next);
                          answer(found, missing, next);
                        }}
                      >
                        Це товар без розміру — продати як{" "}
                        {visible(shortDraft.size)}
                        {how}
                      </button>
                    </>
                  )}
                  {mayCorrect && !unknownHere && !shortDraft.unknownSize && (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        const next = {
                          ...found,
                          [shortIndex]:
                            shortfall.requested - shortfall.available,
                        };
                        setFound(next);
                        answer(next, missing, clarified);
                      }}
                    >
                      Товар на місці — продати {shortfall.requested}
                      {how}
                    </button>
                  )}
                  {mayReportMissing && (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        const next = { ...missing, [shortIndex]: 0 };
                        setMissing(next);
                        answer(found, next, clarified);
                      }}
                    >
                      {/* Recording an empty shelf takes no money: no way. */}
                      {draft.every(
                        (_, index) =>
                          index === shortIndex || missing[index] === 0,
                      )
                        ? "На полиці немає жодної — записати нестачу"
                        : `На полиці немає жодної — продати решту${how}`}
                    </button>
                  )}
                  {mayReportMissing && shortfall.requested > 1 && (
                    <>
                      <label>
                        На місці фактично є, одиниць
                        <input
                          inputMode="numeric"
                          value={present}
                          onChange={(event) => {
                            setPresent(event.target.value);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          const count = Number(present);
                          if (
                            !/^\d+$/.test(present) ||
                            count < 1 ||
                            count >= shortfall.requested
                          ) {
                            setValidation(
                              `Вкажіть від 1 до ${String(shortfall.requested - 1)} одиниць. Якщо немає жодної — натисніть «На полиці немає жодної».`,
                            );
                            return;
                          }
                          const next = { ...missing, [shortIndex]: count };
                          setMissing(next);
                          answer(found, next, clarified);
                        }}
                      >
                        Продати стільки, скільки є{how}
                      </button>
                    </>
                  )}
                  {!mayCorrect && !mayReportMissing && (
                    <p>
                      Немає права виправляти залишок під час продажу. Покличте
                      менеджера або зменшіть кількість.
                    </p>
                  )}
                  {mayCorrect && !mayReportMissing && (
                    <p>
                      Немає на полиці? Приберіть рядок і скажіть менеджеру —
                      залишок виправить він.
                    </p>
                  )}
                </>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  replaceDraft(draft.filter((_, i) => i !== shortIndex));
                }}
              >
                Прибрати з кошика
              </button>
            </>
          )}
        </section>
      )}
      {/* Under the thumb (redesign P0-4): what is being paid, and the three
          ways, which sell when pressed (owner decision, 2026-10-04). */}
      <div
        className="pay-panel"
        role="group"
        aria-label="Продати — як платить покупець"
      >
        <p className="pay-total">
          {owing ? (
            <>
              Зараз <strong>{money(decimal(owing.now))}</strong> · винен{" "}
              <strong>{money(decimal(owing.left))}</strong>
            </>
          ) : (
            <>
              Разом <strong>{money(decimal(total))}</strong>
            </>
          )}
        </p>
        <div className="pay-ways">
          {tillMethods.map((way) => (
            <button
              key={way}
              type="button"
              disabled={blocked || working || draft.length === 0}
              onClick={() => {
                void send(way, found, missing, clarified);
              }}
            >
              {paper ? `З паперу · ${methodLabels[way]}` : methodLabels[way]}
            </button>
          ))}
        </div>
        {paper && (
          // Seen before the press: a forgotten switch marks a live sale for
          // good, with a colleague's name (G6).
          <p className="pay-seller">
            Продавець: {named ? visible(named.display_name) : "не вказано"}
            {from.length > 0 &&
              ` · ${from.length > 1 ? "склади" : "склад"}: ${from.map((name) => visible(name)).join(", ")}`}
          </p>
        )}
      </div>
    </section>
  );
}

function Receipt({
  receipt,
  dropped,
  next,
  fixMethod,
}: {
  receipt: SaleReceipt;
  dropped: string[];
  next: () => void;
  fixMethod: ((sale: SaleReceipt) => void) | undefined;
}): JSX.Element {
  // An answer recorded before the way was asked names none (ADR-0012 §B12).
  const way = receipt.payment_method ?? null;
  // A sale typed from paper (ADR-0013 §5.6): its mark, and money taken
  // during the outage is never charged again.
  const mark = receipt.outage ?? null;
  const paid = mark !== null && way !== null ? paidDuringOutage(way) : null;
  return (
    <section>
      <h2>Продаж записано</h2>
      {mark && <p className="badge">{markText(mark)}</p>}
      {receipt.credit ? (
        // Paid in parts, the terminal takes only what is paid now: the sum
        // first, and how (redesign P0-6). From the answer, never worked out.
        <p className="total">
          <span>
            {way !== null && `${methodLabels[way]} · `}
            {way === "CARD" && paid === null
              ? "Проведіть на терміналі"
              : "Зараз"}{" "}
            <strong>{money(receipt.credit.paid_now)}</strong>
            {paid !== null
              ? ` — ${paid}`
              : way === "TRANSFER" &&
                " — перевірте, що переказ надійшов, перш ніж віддати товар"}
          </span>
        </p>
      ) : way === null ? (
        <p className="total">
          Разом <strong>{money(receipt.total)}</strong>
        </p>
      ) : paid !== null ? (
        <p className="total">
          <span>
            {methodLabels[way]} · Разом <strong>{money(receipt.total)}</strong>{" "}
            — {paid}
          </span>
        </p>
      ) : way === "TRANSFER" ? (
        // Checked before the goods are handed over (ADR-0012 G38). One
        // sentence, so it wraps as one rather than splitting the total's row.
        <p className="total">
          <span>
            {methodLabels[way]} · Разом <strong>{money(receipt.total)}</strong>{" "}
            — перевірте, що переказ надійшов, перш ніж віддати товар
          </span>
        </p>
      ) : (
        // The terminal is charged after the press, for the sum the receipt
        // shows (owner decision, 2026-10-04).
        <p className="total">
          {methodLabels[way]} ·{" "}
          {way === "CARD" ? "Проведіть на терміналі" : "Разом"}{" "}
          <strong>{money(receipt.total)}</strong>
        </p>
      )}
      {receipt.credit && (
        <div className="section-block">
          <h3>Оплата частинами</h3>
          <p>
            Разом за товар <strong>{money(receipt.total)}</strong>
          </p>
          <p>
            Сплачено зараз <strong>{money(receipt.credit.paid_now)}</strong>
            {way !== null && ` ${methodHow[way]}`}
            {paid !== null && ` — ${paid}`}
          </p>
          <p>
            Покупець винен <strong>{money(receipt.credit.owed)}</strong>
          </p>
          <p className="hint">Наступні внески — у розділі «Борги».</p>
        </div>
      )}
      {receipt.items.map((item) => (
        <div className="line" key={item.id}>
          <strong>{visible(item.display_name)}</strong>
          <span>
            {item.quantity} × {money(item.final_unit_price)} ={" "}
            {money(item.line_total)}
          </span>
        </div>
      ))}
      {receipt.corrections.length > 0 && (
        <p className="hint">
          Оприходовано знайдене на місці: {receipt.corrections.length} рух(и)
          складу.
        </p>
      )}
      {dropped.length > 0 && (
        <p>Не продано — на полиці не було: {dropped.join(", ")}.</p>
      )}
      {receipt.shortages.length > 0 && (
        <p className="hint">
          Списано як фізично відсутнє: {receipt.shortages.length} рух(и) складу.
          Перевірте склад із менеджером.
        </p>
      )}
      {receipt.size_reclassifications.length > 0 && (
        <p className="hint">
          Уточнено розмір: {receipt.size_reclassifications.length} рух(и)
          складу.
        </p>
      )}
      {fixMethod && way !== null && (
        <button
          type="button"
          className="quiet"
          onClick={() => {
            fixMethod(receipt);
          }}
        >
          Змінити спосіб оплати
        </button>
      )}
      <button type="button" onClick={next}>
        Новий продаж
      </button>
    </section>
  );
}

/** Nothing in the basket was on the shelf: no sale, and the shortage recorded. */
function NothingSold({
  shelf,
  next,
}: {
  shelf: EmptyShelf;
  next: () => void;
}): JSX.Element {
  return (
    <section>
      <h2>Продажу немає</h2>
      <p>Нічого з кошика не було на полиці. Нестачу записано.</p>
      {shelf.lines.map((line) => (
        <div
          className="line"
          key={`${line.source_location_id}:${line.product_variant_id}:${line.size_id}`}
        >
          <strong>
            {visible(line.display_name)} · {sizeLabel(line.size)}
          </strong>
          <span>
            {line.removed > 0
              ? `Знято з обліку: ${String(line.removed)} од.`
              : "Облік і так не мав цих одиниць — нічого не знято."}
          </span>
        </div>
      ))}
      <p className="hint">Перевірте склад із менеджером.</p>
      <button type="button" onClick={next}>
        Новий продаж
      </button>
    </section>
  );
}

/**
 * What the till can say about a refusal it knows the cause of. A kept sale
 * refused on resend says it too (`@/cash/errors`, ADR-0013 §8).
 */
export function refusalText(error: unknown): string {
  const details = (error as Partial<ApiError> | null)?.details ?? {};
  switch (details.reason) {
    case "SIZE_NOT_KNOWN_SHORT":
      return `Одиниць цієї моделі без розміру на складі менше, ніж треба уточнити (є ${String(details.available)}). Зменшіть кількість або продайте товар без розміру.`;
    case "SIZE_CLARIFIED":
      return "Облік змінився, поки ви відповідали. Натисніть «Готівка», «Картка» або «Переказ» ще раз, щоб побачити, чого бракує тепер.";
    case "SIZE_NOT_KNOWN_AMBIGUOUS":
      return "Ця модель записана на складі під кількома невідомими розмірами, тож уточнити розмір не можна. Зверніться до менеджера.";
    case "NOTHING_TO_SELL":
      return "У кошику не лишилося нічого, що є на полиці.";
    case "PAID_IN_FULL":
      return `Покупець сплачує все одразу (${money(String(details.total))}) — це звичайний продаж. Зніміть «Оплата частинами» або змініть суму.`;
    case "CUSTOMER_NAME":
      return "Вкажіть ім’я покупця, який платить частинами.";
    case "CUSTOMER_PHONE":
      return "Телефон покупця має містити від 10 до 15 цифр.";
    case "NOTHING_PAID":
      return "Покупець має сплатити зараз більше нуля.";
    case "RESERVED":
      return "Частина цих одиниць у резерві замовлення, тому під час продажу облік не виправити. Зменшіть кількість або продайте інший товар.";
    // A sale typed from paper, refused for its mark (ADR-0013 §5.3).
    case "OUTAGE_SHELF_REPORT":
      return "Продаж з паперу не виправляє залишок. Попросіть менеджера спершу виправити залишок, потім внесіть продаж ще раз.";
    case "OUTAGE_SELLER_UNKNOWN":
      return "Цієї людини немає серед продавців магазину. Оберіть іншу або залиште «не вказано».";
    case "OUTAGE_TIME_FUTURE":
      return "Цей час ще не настав. Перевірте час і день з паперу.";
    case "OUTAGE_TIME_TOO_OLD":
      return "Час з паперу можна вказати лише за сьогодні або вчора. Для давнішого продажу залиште час порожнім.";
    default:
      return errorText(error);
  }
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
        Повторити завантаження
      </button>
    </div>
  );
}
