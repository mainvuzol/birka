import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  CONFLICT_TEXT,
  INVALID_TEXT,
  api,
  errorText,
} from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { visible } from "@/shared/visible";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { isTillMethod, refundHow, tillMethods } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { usePanelRoom } from "@/shared/panel";
import { Placeholder } from "@/shared/Placeholder";
import { Sum } from "@/shared/Sum";
import {
  PaperFields,
  paperRefusal,
  takenBy,
  usePaperMark,
} from "@/sales/paperMark";
import { buzz } from "@/shared/telegram";
import { useSettled } from "@/sales/StockSearch";
import { submitReturn, useReturnCommand } from "./commands";
import { SaleRow, dayOf, dayTitle } from "./SaleRow";
import { useBackOnSale } from "./places";
import { Result } from "./Result";
import { refundLabels, sizeLabel } from "./types";
import type { InfiniteData } from "@tanstack/react-query";
import type {
  Refund,
  ReturnPart,
  SaleList,
  SaleMethod,
  SaleSummary,
} from "./types";

const pageSize = 20;

/**
 * A return at the till (owner decision, 2026-10-01).
 *
 * The seller finds the sale in the store's list, searchable by name, and says
 * how many of each line came back intact and how many damaged. Intact goes
 * back to the warehouse it was sold from; damaged to the store's «Брак»,
 * where nothing sells. The money is what was paid, worked out by the server.
 *
 * Goods bought at another store of the network come back here too (owner
 * decisions, 2026-10-01): the seller finds that sale by a search among the
 * other stores', this store hands the money back, and damaged goods stay in
 * this store's «Брак». Intact goods sold from a warehouse this store does
 * not reach go to one of its own, which the seller chooses.
 *
 * The money goes back the way the sale was paid, unless the seller changes
 * it — a card sale returned in cash (owner decision, 2026-10-04; ADR-0012
 * §B12). Money returned to a card does not leave the drawer.
 */
export function Returns({
  store,
  token,
  journalKey,
  blocked,
  open = null,
  opened,
  sell,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  /**
   * A sale to open at once, from its receipt (redesign P1-2): the store's
   * newest, so it is on the first page; if it is not, the list shows.
   */
  open?: string | null;
  /** Called once the sale asked for was looked for. */
  opened?: () => void;
  /**
   * «Новий продаж» on a return's result: the till, its cursor in the search
   * (returns task list, P0-5). Only for whoever may sell.
   */
  sell?: (() => void) | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  // What the seller types, searched once they pause, from two letters, as
  // the till's search (returns task list, P0-1); Enter searches at once.
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const typed = useSettled(query);
  const [pressed, setPressed] = useState("");
  const search = pressed !== "" && pressed === query.trim() ? pressed : typed;
  // Bought at another store of the network: found only by a search of two
  // letters or more, asked for under this store's results (owner decision,
  // 2026-10-17, В3 (а); returns task list, P1-1). Fewer letters, and it is
  // this store's list again.
  const [elsewhere, setElsewhere] = useState(false);
  // A word of two letters at least, as the server asks of the other stores'
  // search (owner decision, 2026-10-18).
  const words = hasWord(query);
  // Read in the same render it is typed, so not one more is drawn or asked
  // for the other stores (review, 2026-10-18); and left for good.
  const away = elsewhere && words;
  useEffect(() => {
    if (!words) setElsewhere(false);
  }, [words]);
  const offerId = useId();
  const [selected, setSelected] = useState<SaleSummary | null>(null);
  const [done, setDone] = useState<{
    refund: Refund;
    sent: ReturnPart[];
  } | null>(null);
  const searching = !away || hasWord(search);
  // The other stores, offered once there is something to look for, and
  // what is looked for is what is typed.
  const offerElsewhere = !away && hasWord(search) && search === query.trim();
  // Twenty at a time, each page under those read (returns task list,
  // P0-2): the server takes fifty at most, and a growing `limit` broke the
  // list after forty.
  const sales = useInfiniteQuery({
    queryKey: ["store-sales", store.id, away, search],
    queryFn: ({ pageParam }) =>
      api<SaleList>(
        `/sales?store_id=${store.id}&limit=${String(pageSize)}&offset=${String(pageParam)}${
          away ? "&elsewhere=true" : ""
        }${search ? `&q=${encodeURIComponent(search)}` : ""}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: SaleList, pages: SaleList[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    enabled: searching,
    retry: false,
    // A search typed keeps the list in place until the new one comes, as at
    // the till: this store's list or the other stores', never one for the
    // other (review, 2026-10-17).
    placeholderData: (
      previous: InfiniteData<SaleList, number> | undefined,
      before,
    ) => (before?.queryKey[2] === away ? previous : undefined),
  });
  // A sale made meanwhile moves the pages' edge: a row read twice is shown
  // once.
  const listed = [
    ...new Map(
      (sales.data?.pages ?? [])
        .flatMap((page) => page.sales)
        .map((sale) => [sale.id, sale]),
    ).values(),
  ];

  useEffect(() => {
    if (open === null) return;
    // The list could not be read: the list's own failure shows, and the
    // sale is not opened later, for another customer (review, 2026-10-15).
    if (sales.isError) {
      opened?.();
      return;
    }
    // Read afresh, never from a page cached before the sale was made.
    if (!sales.isSuccess || sales.isFetching) return;
    const sale = listed.find((each) => each.id === open);
    if (sale) setSelected(sale);
    opened?.();
  }, [
    open,
    sales.isError,
    sales.isSuccess,
    sales.isFetching,
    sales.data,
    opened,
  ]);

  async function settled(refund: Refund, sent: ReturnPart[]): Promise<void> {
    setDone({ refund, sent });
    setSelected(null);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["store-sales", store.id] }),
      cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
      cache.invalidateQueries({ queryKey: ["credits", store.id] }),
      cache.invalidateQueries({ queryKey: ["damaged-units", store.id] }),
    ]);
  }

  // Recorded: what to hand back, in place of the form, as the till's receipt
  // is (returns task list, P0-5).
  if (done)
    return (
      <Result
        store={store}
        token={token}
        refund={done.refund}
        sent={done.sent}
        sell={sell}
        more={() => {
          setDone(null);
        }}
        blocked={blocked}
      />
    );

  if (selected)
    return (
      <ReturnForm
        store={store}
        token={token}
        journalKey={journalKey}
        blocked={blocked}
        sale={selected}
        settled={(refund, sent) => {
          void settled(refund, sent);
        }}
        back={() => {
          setSelected(null);
          // Read again: what may still come back may have changed meanwhile,
          // by another seller's return (review, 2026-10-17).
          void cache.invalidateQueries({ queryKey: ["store-sales", store.id] });
        }}
      />
    );

  return (
    <section className="returns">
      <h2>Повернення</h2>
      <form
        className="search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setPressed(query.trim().length >= 2 ? query.trim() : "");
        }}
      >
        <label className="till-search">
          Що повертають?
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Модель або колір"
            ref={field}
            maxLength={100}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
      </form>
      {away && (
        // Never mixed with this store's: headed, and left in one tap.
        <div className="toolbar elsewhere-head">
          <h3>В інших магазинах мережі</h3>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              setElsewhere(false);
            }}
          >
            <span aria-hidden="true">← </span>У своєму магазині
          </button>
        </div>
      )}
      {!searching ? null : sales.isPending ||
        (sales.isPlaceholderData && listed.length === 0) ? (
        // The rows' places while they are read (returns task list, P2-3).
        <Placeholder said="Завантажуємо продажі…" rows={3} />
      ) : !sales.data ? (
        <div role="alert">
          <p>{refusalText(sales.error)}</p>
          <button
            type="button"
            onClick={() => {
              void sales.refetch();
            }}
          >
            Спробувати ще раз
          </button>
        </div>
      ) : listed.length === 0 ? (
        search ? (
          <div className="empty">
            <p>
              {away
                ? `В інших магазинах мережі за «${visible(search)}» продажів не знайдено.`
                : `За «${visible(search)}» продажів не знайдено. Перевірте назву або очистіть пошук.`}
            </p>

            <button
              type="button"
              className="quiet"
              onClick={() => {
                setQuery("");
                setPressed("");
                field.current?.focus();
              }}
            >
              Очистити
            </button>
          </div>
        ) : (
          <p>Продажів у магазині ще немає.</p>
        )
      ) : (
        <>
          {sales.isError && !sales.isFetchNextPageError && (
            // Read again and refused: the rows below are as they were, and
            // that is said (ADR-0011; review, 2026-10-17).
            <div role="alert">
              <p>{refusalText(sales.error)}</p>
              <button
                type="button"
                disabled={sales.isFetching}
                onClick={() => {
                  void sales.refetch();
                }}
              >
                Спробувати ще раз
              </button>
            </div>
          )}
          {listed.map((sale, index) => (
            <div key={sale.id}>
              {(index === 0 ||
                dayOf(listed[index - 1]?.sold_at ?? "") !==
                  dayOf(sale.sold_at)) && (
                <h3 className="sale-day">{dayTitle(sale.sold_at)}</h3>
              )}
              <SaleRow
                sale={sale}
                here={sale.store_id === store.id}
                choose={() => {
                  setSelected(sale);
                }}
                blocked={blocked}
              />
            </div>
          ))}
          {sales.isFetchNextPageError ? (
            // The next page could not be read: those read stay.
            <div role="alert">
              <p>{refusalText(sales.error)}</p>
              <button
                type="button"
                disabled={sales.isFetching}
                onClick={() => {
                  void sales.fetchNextPage();
                }}
              >
                Спробувати ще раз
              </button>
            </div>
          ) : (
            sales.hasNextPage && (
              <button
                type="button"
                className="quiet"
                disabled={sales.isFetching}
                onClick={() => {
                  void sales.fetchNextPage();
                }}
              >
                Показати ще
              </button>
            )
          )}
        </>
      )}
      {offerElsewhere && (
        // Under the results, what was typed kept (owner decision,
        // 2026-10-17, В3 (а)).
        <p className="hint elsewhere-offer">
          <span id={offerId}>Купили в іншому магазині мережі?</span>{" "}
          <button
            type="button"
            className="quiet"
            aria-describedby={offerId}
            onClick={() => {
              setElsewhere(true);
            }}
          >
            Шукати там
          </button>
        </p>
      )}
      {!away &&
        search !== "" &&
        !!sales.data &&
        !sales.isPlaceholderData &&
        listed.length === 0 && (
          // Found in neither store, a coat sold from the notebook, before
          // Бірка: the manager decides (owner decision, 2026-10-17, В5 (а);
          // returns task list, P1-6). Said after the other stores' offer,
          // which comes first.
          <p className="hint">
            Продали ще до Бірки? Покличте менеджера — таке повернення вирішує
            він.
          </p>
        )}
    </section>
  );
}

/**
 * A word of two letters at least in what is typed, counted and split as
 * the server does (Python's `str.split()`, letters by code point), so the
 * other stores are never offered a search the server refuses.
 */
function hasWord(text: string): boolean {
  return text
    .split(
      // Python's whitespace, the separators \x1c-\x1f among it.
      // eslint-disable-next-line no-control-regex
      /[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/,
    )
    .some((word) => Array.from(word).length >= 2);
}

type Counts = Record<string, { intact: number; damaged: number }>;

const none = { intact: 0, damaged: 0 };

/** «17.10, 14:32», by the phone's own clock; the year when not this one. */
function when(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  const time = at.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day}, ${time}`;
}

/**
 * How many of a line come back in one state, with «−» and «+», as the
 * till's basket counts (returns task list, P0-3): from none, and never past
 * what may still come back.
 */
function Step({
  name,
  value,
  room,
  damaged = false,
  set,
}: {
  name: "Цілі" | "Пошкоджені";
  value: number;
  /** One more may come back. */
  room: boolean;
  damaged?: boolean;
  set: (value: number, from: HTMLElement) => void;
}): JSX.Element {
  return (
    <div className={damaged ? "return-step damaged" : "return-step"}>
      <span className="return-step-name">{name}</span>
      <div className="stepper">
        <button
          type="button"
          aria-label={`${name}: менше`}
          disabled={value <= 0}
          onClick={(event) => {
            set(value - 1, event.currentTarget);
          }}
        >
          −
        </button>
        {/* Heard as «Цілі: 1» when it changes, seen as «1». */}
        <output aria-live="polite">
          <span className="visually-hidden">{name}: </span>
          <span className="return-count">{value}</span>
        </output>
        <button
          type="button"
          aria-label={`${name}: більше`}
          disabled={!room}
          onClick={(event) => {
            set(value + 1, event.currentTarget);
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * One sale's return (returns task list, P0-3, P0-4). Each line the customer
 * may still bring back is a tag, its intact and damaged units counted with
 * «−» and «+» from none: the state of each unit is the seller's to name,
 * never preset (owner decisions, 2026-09-15, §3). What comes back, its sum
 * and the way the money goes are under the thumb, in a panel like the
 * till's, once a unit is counted.
 */
function ReturnForm({
  store,
  token,
  journalKey,
  blocked,
  sale,
  settled,
  back,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  sale: SaleSummary;
  settled: (refund: Refund, sent: ReturnPart[]) => void;
  back: () => void;
}): JSX.Element {
  const ids = useId();
  const { busy, pending } = useReturnCommand();
  // Paper mode: the till's switch (`@/sales/paper`); the paper's time is
  // this return's own.
  const mark = usePaperMark(store, token, journalKey, "refund");
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<Counts>({});
  // Per sale line: the warehouse of this store intact goods go to, when the
  // one they were sold from is another store's own.
  const [places, setPlaces] = useState<Record<string, string>>({});
  // The reason is asked for only when the seller has one (P0-3).
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [refusal, setRefusal] = useState<unknown>(null);
  const refusalRef = useRef<HTMLParagraphElement>(null);
  // How the money goes back: the seller's choice, else the one the sale
  // suggests (owner decision, 2026-10-04; ADR-0012 G4, G5). Only this one
  // sale's way is asked for, never a list's (G32).
  const [chosenWay, setChosenWay] = useState<TillMethod | null>(null);
  const paid = useQuery({
    queryKey: ["sale-method", store.id, sale.id],
    queryFn: () =>
      api<SaleMethod>(
        `/cash/sales/${sale.id}/method?store_id=${store.id}`,
        token,
      ),
    retry: false,
  });
  const suggested = paid.data?.refund_method;
  const way = chosenWay ?? (isTillMethod(suggested) ? suggested : null);
  const lines = sale.items.filter((item) => item.refunded < item.quantity);
  const elsewhere = sale.store_id !== store.id;
  const choosing = lines.some((item) => !item.back_to_sold_from);
  const ownPlaces = useBackOnSale(store, token, choosing);

  // What is counted, at each line's frozen price, as the button always said
  // it; what the customer is handed is the server's answer (P0-5).
  let over = false;
  let unplaced = false;
  const parts: ReturnPart[] = [];
  const picked: { item: SaleSummary["items"][number]; units: number }[] = [];
  let total = 0n;
  for (const item of lines) {
    const { intact, damaged } = counts[item.id] ?? none;
    // The steppers stop at what may still come back; it is checked here
    // again, and by the server (I9).
    if (intact + damaged > item.quantity - item.refunded) {
      over = true;
      continue;
    }
    const place = places[item.id];
    if (intact > 0 && !item.back_to_sold_from && !place) unplaced = true;
    for (const [quantity, condition] of [
      [intact, "INTACT"],
      [damaged, "DAMAGED"],
    ] as const)
      if (quantity > 0) {
        parts.push({
          sale_item_id: item.id,
          quantity,
          restock: true,
          condition,
          ...(condition === "INTACT" && !item.back_to_sold_from && place
            ? { location_id: place }
            : {}),
        });
        total += (kopecks(item.final_unit_price) ?? 0n) * BigInt(quantity);
      }
    if (intact + damaged > 0) picked.push({ item, units: intact + damaged });
  }
  const units = picked.reduce((n, line) => n + line.units, 0);
  const working = busy || pending !== null;
  const ready = !over && !unplaced && parts.length > 0;

  // The panel shows once a unit is counted, and its height is kept clear;
  // the tag just counted, and the warehouse it may now ask for, is brought
  // above it (P0-4; review, 2026-10-17).
  const panelRef = useRef<HTMLDivElement>(null);
  const touched = useRef<Element | null>(null);
  const shown = units > 0;
  usePanelRoom(panelRef, shown);
  useEffect(() => {
    // A tag that asks for a warehouse may be taller than the room above the
    // panel on a small phone: then its chips are what is brought into view.
    const tag = touched.current;
    (tag?.querySelector(".return-place") ?? tag)?.scrollIntoView({
      block: "nearest",
    });
    // This store's warehouses are read as the form opens; read slowly, they
    // come after a count, and their chips grow the tag, brought above the
    // panel again once they do.
  }, [counts, ownPlaces.data]);
  useEffect(() => {
    if (asking) reasonRef.current?.focus();
  }, [asking]);
  useEffect(() => {
    if (refusal !== null)
      refusalRef.current?.scrollIntoView({ block: "nearest" });
  }, [refusal]);

  function set(
    id: string,
    field: "intact" | "damaged",
    value: number,
    from: HTMLElement,
  ): void {
    touched.current = from.closest(".line-return");
    setCounts({ ...counts, [id]: { ...(counts[id] ?? none), [field]: value } });
  }

  async function send(): Promise<void> {
    // From paper, nothing is sent until the series says which paper it is
    // (owner decision, 2026-10-16): the button waits, and so does this.
    if (!ready || !mark.ready) return;
    setRefusal(null);
    const trimmed = reason.trim();
    const outage = mark.body();
    const outcome = await submitReturn(journalKey, token, {
      // A new transport key per attempt; the return's identity is
      // `command_id`, which is what makes a late retry safe.
      key: crypto.randomUUID(),
      body: {
        store_id: store.id,
        sale_id: sale.id,
        command_id: commandId,
        lines: parts,
        reason: trimmed ? trimmed : null,
        ...(elsewhere ? { elsewhere: true } : {}),
        // A sale in parts may go without: the server asks for the way only
        // when money goes back (ADR-0012 G35).
        ...(way ? { payment_method: way } : {}),
        ...(outage ? { outage } : {}),
        // For the banner, should the answer be lost: never sent (P1-2).
        shown: {
          lines: picked.map(({ item, units: count }) => ({
            name: item.display_name,
            size: item.size,
            units: count,
          })),
          ...(sale.paid_in_parts
            ? { parts: true as const }
            : { sum: decimal(total) }),
        },
      },
    });
    // A buzz in the hand once the server answers, as at the till (P2-5); a
    // lost answer, and a kept return confirmed later, none.
    if (outcome.kind === "done") {
      buzz("success");
      setCommandId(crypto.randomUUID());
      mark.forgetTime();
      settled(outcome.result, parts);
    } else if (outcome.kind === "refused") {
      buzz("error");
      setRefusal(outcome.error);
      setCommandId(crypto.randomUUID());
    }
  }

  const sum = money(decimal(total));
  const one = picked.length === 1 ? picked[0] : undefined;
  return (
    <section className="returns">
      <div className="toolbar">
        <h2>Повернення</h2>
        <button className="quiet" disabled={working} onClick={back}>
          <span aria-hidden="true">← </span>До списку
        </button>
      </div>
      {/* One sale's sum, once it is opened (G33). */}
      <p className="sale-context">
        Продаж {when(sale.sold_at)} · {money(sale.total)}
        {elsewhere && ` · магазин «${visible(sale.store_name)}»`}
      </p>
      {(sale.paid_in_parts || sale.outage) && (
        <p className="sale-marks">
          {sale.paid_in_parts && (
            <span className="badge debt">Оплата частинами</span>
          )}
          {sale.outage && (
            <span className="badge warn">
              {sale.outage.first_days === true
                ? "Продано з паперу"
                : "Продано під час збою"}
            </span>
          )}
        </p>
      )}
      {elsewhere && (
        <p className="hint">
          Куплено в іншому магазині: гроші віддаєте ви, пошкоджене лишається у
          вашому «Браку».
        </p>
      )}
      <fieldset disabled={blocked || working}>
        <legend className="visually-hidden">Що повертають</legend>
        <PaperFields mark={mark} what="return" storeId={store.id} />
        {lines.map((item) => {
          const left = item.quantity - item.refunded;
          const entered = counts[item.id] ?? none;
          const room = entered.intact + entered.damaged < left;
          const heading = `${ids}-${item.id}`;
          return (
            <div
              className="line-return"
              role="group"
              aria-labelledby={heading}
              key={item.id}
            >
              <h3 id={heading}>
                {visible(item.display_name)} · {sizeLabel(item.size)}
              </h3>
              <p className="hint">
                {money(item.final_unit_price)} за 1 шт. · можна повернути {left}{" "}
                шт.
                {item.refunded > 0 &&
                  ` · уже повернено ${String(item.refunded)} шт.`}
              </p>
              <div className="return-steps">
                <Step
                  name="Цілі"
                  value={entered.intact}
                  room={room}
                  set={(value, from) => {
                    set(item.id, "intact", value, from);
                  }}
                />
                <Step
                  name="Пошкоджені"
                  value={entered.damaged}
                  room={room}
                  damaged
                  set={(value, from) => {
                    set(item.id, "damaged", value, from);
                  }}
                />
              </div>
              {!item.back_to_sold_from && entered.intact > 0 && (
                // Which of this store's warehouses takes the intact ones: a
                // chip each, one tap, none chosen beforehand (owner
                // decision, 2026-10-01; returns task list, P1-1).
                <div
                  className="return-place"
                  role="group"
                  aria-labelledby={`${heading}-place`}
                >
                  <p className="return-place-ask" id={`${heading}-place`}>
                    Цілі — на який склад?
                  </p>
                  <div className="chips">
                    {ownPlaces.isPending && (
                      // Their places while they are read, so nothing moves.
                      <>
                        <span className="visually-hidden" role="status">
                          Завантажуємо склади…
                        </span>
                        <span className="chip skeleton" aria-hidden="true" />
                        <span className="chip skeleton" aria-hidden="true" />
                      </>
                    )}
                    {(ownPlaces.data ?? []).map((location) => (
                      <button
                        type="button"
                        className="chip"
                        key={location.id}
                        data-location={location.id}
                        aria-pressed={places[item.id] === location.id}
                        onClick={() => {
                          setPlaces({ ...places, [item.id]: location.id });
                        }}
                      >
                        {visible(location.name)}
                      </button>
                    ))}
                  </div>
                  <p className="hint">
                    Продали з власного складу іншого магазину.
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {asking ? (
          <label>
            Причина повернення (необов’язково)
            <textarea
              ref={reasonRef}
              value={reason}
              maxLength={1000}
              aria-describedby={`${ids}-reason`}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            <NoCustomerData id={`${ids}-reason`} />
          </label>
        ) : (
          <button
            type="button"
            className="quiet add-reason"
            onClick={() => {
              setAsking(true);
            }}
          >
            Додати причину
          </button>
        )}
      </fieldset>
      {ownPlaces.error && <p role="alert">{errorText(ownPlaces.error)}</p>}
      {refusal !== null && (
        <p role="alert" ref={refusalRef}>
          {refusalText(refusal)}{" "}
          {mark.paper ? "Нічого не записано." : "Нічого не повернено."}
        </p>
      )}
      {/* Under the thumb (P0-4): what comes back, its sum large, and the
          way, the sale's own offered; one button, which hands the money
          back, its sum and way in its name. */}
      {shown && (
        <div
          className="pay-panel return-panel"
          role="group"
          aria-label="Повернення: сума і спосіб"
          ref={panelRef}
        >
          <p className="pay-what">
            {one
              ? `${visible(one.item.display_name)} · ${sizeLabel(one.item.size)} × ${String(one.units)}`
              : `Повертають ${String(units)} шт.`}
          </p>
          <p className="pay-total">
            {/* From paper, the money went back already: the large line
                carries the button's «З паперу · » (review, 2026-10-17). */}
            {mark.paper && "З паперу · "}
            {sale.paid_in_parts ? "Товар на " : "Повернути "}
            <Sum value={sum} />
          </p>
          {sale.paid_in_parts && !mark.paper && (
            // How far the debt falls is said after the press (owner
            // decision, 2026-10-17, В6 (а)).
            <p className="pay-note">
              Спершу зменшимо борг; скільки віддати — покажемо після.
            </p>
          )}
          {paid.isError && (
            <p className="pay-note">
              {/* In parts, a way only if money goes back (G35; owner,
                  2026-10-18). */}
              {sale.paid_in_parts
                ? "Не вдалося прочитати, як платили. Якщо буде що повертати — оберіть, як."
                : "Не вдалося прочитати, як платили. Оберіть, як повертаєте."}
            </p>
          )}
          <fieldset className="way-switch" disabled={blocked || working}>
            <legend className="visually-hidden">
              {mark.paper
                ? sale.paid_in_parts
                  ? mark.firstDays === false
                    ? "Як повертали гроші під час збою (якщо повертали)"
                    : "Як повертали гроші (якщо повертали)"
                  : mark.firstDays === false
                    ? "Як повернули гроші під час збою"
                    : "Як повернули гроші"
                : sale.paid_in_parts
                  ? "Як повертаємо гроші (якщо буде що повертати)"
                  : "Як повертаємо гроші"}
            </legend>
            {tillMethods.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="refund-method"
                  checked={way === option}
                  onChange={() => {
                    setChosenWay(option);
                  }}
                />
                <span>{refundLabels[option]}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="return-go"
            disabled={
              blocked ||
              working ||
              !ready ||
              !mark.ready ||
              (!sale.paid_in_parts && way === null)
            }
            onClick={() => {
              void send();
            }}
          >
            {unplaced
              ? "Оберіть склад для цілого товару"
              : !mark.ready
                ? "Оберіть, що вносите з паперу"
                : `${mark.paper ? "З паперу · " : ""}${
                    sale.paid_in_parts
                      ? `Повернути товар на ${sum}`
                      : way === null
                        ? "Оберіть, як повертаєте гроші"
                        : `Повернути покупцю ${sum} ${refundHow[way]}`
                  }`}
          </button>
          {mark.paper && <p className="pay-seller">{takenBy(mark)}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * A conflict, and a request the server could not take, that «Повернення»
 * knows nothing more of: its own words, never an order's (returns task
 * list, P2-2; as the till's, owner 2026-10-17).
 */
export const RETURN_CONFLICT_TEXT =
  "Дані змінилися, поки ви працювали. Поверніться до списку й спробуйте ще раз.";
const RETURN_INVALID_TEXT = "Перевірте, що повертають, і спробуйте ще раз.";

/**
 * Why a return was refused. A kept return refused on resend says the same
 * (`@/cash/errors`, ADR-0013 §8), but for a conflict and a way not stated,
 * which it says in its own words.
 */
export function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    // Typed from paper, refused for its mark (ADR-0021).
    const paper = paperRefusal(error.details.reason, error.details.days);
    if (paper !== null) return paper;
    if (error.code === "DAMAGED_RETURNS_UNAVAILABLE")
      return error.details.reason === "SOLD_FROM"
        ? "Склад «Брак» цього магазину налаштований як склад для продажу, тож пошкоджений товар туди не приймається. Зверніться до власника."
        : "У цього магазину ще немає складу «Брак» для пошкодженого товару. Зверніться до власника.";
    if (error.code === "REFUND_EXCEEDS_SOLD")
      return "Частину цього товару вже повернули. Поверніться до списку: він покаже, що можна повернути тепер.";
    if (
      error.details.reason === "CHOOSE_A_WAREHOUSE" ||
      error.details.reason === "NOT_A_WAREHOUSE_OF_THIS_STORE"
    )
      return "Цілий товар цього продажу йде на склад вашого магазину — оберіть його ще раз.";
    if (error.details.reason === "SEARCH_REQUIRED")
      return "Продаж іншого магазину знаходять за назвою товару.";
    // Only a sale paid in parts is sent without a way, and the server asks
    // for one once it has worked out that money goes back (ADR-0012 G35).
    if (error.details.reason === "PAYMENT_METHOD_REQUIRED")
      return "Покупцю повертаємо гроші — оберіть, як.";
  }
  const said = errorText(error);
  if (said === CONFLICT_TEXT) return RETURN_CONFLICT_TEXT;
  if (said === INVALID_TEXT) return RETURN_INVALID_TEXT;
  return said;
}
