import { useEffect, useId, useRef, useState } from "react";
import type { JSX, MouseEvent } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { useSettled } from "@/sales/StockSearch";
import { Back } from "@/shared/Back";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { CARRIED_TAP } from "@/shared/panel";
import { Placeholder } from "@/shared/Placeholder";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { SearchField } from "@/shared/SearchField";
import { useNextPageFailed } from "@/shared/nextPage";
import { buzz } from "@/shared/telegram";
import { Toast } from "@/shared/Toast";
import { KnotFilter, StatusSticker, placeWords } from "./Knots";
import type { Place } from "./Knots";
import { placesKey, shippingText } from "./types";
import type {
  Location,
  Order,
  OrderItem,
  Status,
  StepRefusal,
  Store,
} from "./types";
import { StepRefused } from "./StepRefused";
import { Unread } from "@/shared/Unread";
import { Empty } from "@/shared/Empty";

interface OrderPage {
  orders: Order[];
  has_more: boolean;
}

/** The open orders a page: all of a shop's at once, as a rule. */
const OPEN_PAGE = 100;
/** The closed and the found, fifty at a time, each page under those read. */
const PAGE = 50;
/** How many of an order's lines a row names before «+ ще N». */
const NAMED = 2;
/** How much of where an order goes abroad a row says (review,
 * 2026-10-23): the note may hold a thousand characters. */
const NOTE_SHOWN = 60;

/** What «Замовлення» keeps while an order is open: what was typed, the
 * place chosen on the string, and whether the cancelled and come back are
 * shown (review, 2026-10-23; «Усе на бірці» sections task list, P0-1). */
export interface OrdersView {
  query: string;
  pressed: string;
  place: Place;
  gone: boolean;
}
export const freshOrdersView: OrdersView = {
  query: "",
  pressed: "",
  place: "send",
  gone: false,
};

/** «Лоран шоколад · M», and «× 2» for more than one. */
export function tagOf(
  item: Pick<OrderItem, "display_name" | "size_label" | "quantity">,
): string {
  const size =
    item.size_label === null || item.size_label === "UNKNOWN"
      ? "розмір невідомий"
      : visible(item.size_label);
  return `${visible(item.display_name)} · ${size}${
    item.quantity > 1 ? ` × ${String(item.quantity)}` : ""
  }`;
}

/** How it goes, in a row: an order abroad by the start of its note. */
function goesBy(order: Order): string {
  const note = order.abroad_note ?? "";
  const points = Array.from(note);
  return order.destination === "ABROAD" && points.length > NOTE_SHOWN
    ? `За кордон · ${visible(points.slice(0, NOTE_SHOWN).join(""))}…`
    : shippingText(order);
}

/** « · з 21.10»: since when the order waits, by the phone's own calendar,
 * never broken after «з». */
export function since(iso: string | null | undefined): string {
  return iso ? ` · ${sinceDay(iso)}` : "";
}

/** «з 21.10», alone. */
export function sinceDay(iso: string): string {
  const at = new Date(iso);
  return `з\u00a0${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}`;
}

/** An order's first goods, and how many more lines: its card's title. */
export function titleOf(order: Order): string {
  const [first] = order.items;
  const more = order.items.length - 1;
  return first
    ? `${tagOf(first)}${more > 0 ? ` + ще ${String(more)}` : ""}`
    : "Замовлення";
}

/** Each status's eyelet on its row (spec §6.9): filled — it waits on you;
 * a ring — on the carrier and the customer; a knot — nothing is left. */
const eyelets: Record<Status, { tone: string; shape: string }> = {
  READY_TO_DISPATCH: { tone: "online", shape: "filled" },
  DISPATCHED: { tone: "transit", shape: "ring" },
  ARRIVED: { tone: "transit", shape: "ring" },
  COLLECTED: { tone: "paid", shape: "tied" },
  CANCELLED: { tone: "offline", shape: "tied" },
  RETURNED: { tone: "offline", shape: "tied" },
};

/** An order's next step, as its row's verb says it. */
export type Next = "send" | "arrive" | "collect";

const nextOf: Partial<Record<Status, Next>> = {
  READY_TO_DISPATCH: "send",
  DISPATCHED: "arrive",
  ARRIVED: "collect",
};

const verbWords: Record<Next, string> = {
  send: "Відправити",
  arrive: "Прибув на пошту",
  collect: "Клієнт забрав",
};

/**
 * One order as a row tag (spec §6.9; «Усе на бірці» sections task list,
 * P0-1): its eyelet by whose turn it is, its goods — two lines and «+ ще
 * N» — how it goes and since when; never its sum or the way it was paid
 * (G32), nor the eight characters of its id (owner decision, 2026-10-23,
 * В1). Its status a sticker only where no place says it. A tap opens its
 * card; its next step, one verb at the bottom right.
 */
function OrderTag({
  order,
  sticker,
  open,
  verb,
  refused,
}: {
  order: Order;
  sticker: boolean;
  open: () => void;
  /** Its «Прибув на пошту» refused: why, under its tag (audit 2026-11-13,
   * orders P1-1). */
  refused?: StepRefusal | null | undefined;
  verb?:
    | {
        words: string;
        held: boolean;
        /** Its send on its way: the ring on it until answered. */
        pressed: boolean;
        act: (event: MouseEvent) => void;
      }
    | undefined;
}): JSX.Element {
  const named = order.items.slice(0, NAMED);
  const more = order.items.length - named.length;
  const title = useId();
  const look = eyelets[order.status];
  return (
    <li>
      <article
        className={`order-tag tag-row tag-outline tone-${look.tone} ${look.shape}`}
      >
        <div className="order-tag-body">
          <span className="order-tag-eyelet" aria-hidden="true">
            {look.shape === "tied" && <Eyelet state="knot" size={8} />}
          </span>
          <button type="button" className="order-row" onClick={open}>
            <span className="order-tag-title t-row" id={title}>
              {named.map((item) => (
                <span key={item.id}>{tagOf(item)}</span>
              ))}
              {more > 0 && <span>+ ще {more}</span>}
            </span>
            <span className="order-tag-meta t-meta">
              {goesBy(order)}
              {since(order.created_at)}
            </span>
            {sticker && <StatusSticker status={order.status} />}
          </button>
          {verb && (
            <button
              type="button"
              className={verb.pressed ? "tag-verb pressed" : "tag-verb"}
              aria-describedby={title}
              // Pressed, it takes no second tap until its list is read
              // again, its ring on it till then (review).
              disabled={verb.held || verb.pressed}
              onClick={verb.act}
            >
              {verb.pressed && <Eyelet state="spin" size={20} />}
              {verb.words}
            </button>
          )}
        </div>
      </article>
      {refused && <StepRefused refusal={refused} />}
    </li>
  );
}

/** Pages of orders, each under those read; a row read twice shown once. */
function useOrders(
  store: Store,
  token: string,
  query: string,
  size: number,
  enabled: boolean,
) {
  const pages = useInfiniteQuery({
    queryKey: ["orders", store.id, query],
    queryFn: ({ pageParam }) =>
      api<OrderPage>(
        `/orders?store_id=${store.id}&limit=${String(size)}&offset=${String(pageParam)}${query}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last: OrderPage, read: OrderPage[]) =>
      last.has_more ? read.length * size : undefined,
    enabled,
    retry: false,
    // What was typed keeps the rows in place until the new ones come, as at
    // the till.
    placeholderData: keepPreviousData,
  });
  const orders = [
    ...new Map(
      (pages.data?.pages ?? [])
        .flatMap((page) => page.orders)
        .map((order) => [order.id, order]),
    ).values(),
  ];
  return { pages, orders };
}

/**
 * The orders to be sent by the warehouse they are taken from (spec S16;
 * «Усе на бірці» sections task list, P0-1): «Склад «Основний» · 2» over
 * those wholly from one, «З кількох складів · 1» over those from several —
 * each order once, in the order read. Its warehouse only shown, never
 * chosen. A line from a warehouse not read: one list, no labels.
 */
function byWarehouse(
  orders: readonly Order[],
  read: readonly Location[] | undefined,
): { label: string; orders: Order[] }[] | null {
  if (read === undefined) return null;
  const names = new Map(read.map((place) => [place.id, place.name]));
  const one = new Map<string, Order[]>();
  const several: Order[] = [];
  for (const order of orders) {
    const from = new Set(order.items.map((item) => item.source_location_id));
    if (![...from].every((id) => names.has(id))) return null;
    const [only] = from;
    if (from.size === 1 && only !== undefined)
      one.set(only, [...(one.get(only) ?? []), order]);
    else several.push(order);
  }
  return [
    ...read
      .filter((place) => one.has(place.id))
      .map((place) => ({
        label: `Склад «${visible(place.name)}»`,
        orders: one.get(place.id) ?? [],
      })),
    ...(several.length > 0
      ? [{ label: "З кількох складів", orders: several }]
      : []),
  ];
}

/**
 * «Замовлення» (spec S16; «Усе на бірці» sections task list, P0-1): the
 * string of places — «До відправлення», «Відправлено», «Прибув на пошту»
 * counted once every open order is read, «Клієнт забрав» — as the filter,
 * a list a place, oldest first; those to be sent by the warehouse they are
 * taken from; each row's next step on it. Under «Клієнт забрав», the
 * cancelled and come back as a screen of their own. An order found by its
 * waybill as it is typed; «+» for a new one. Read again on every step, as
 * the app comes back, and on entering.
 */
export function Orders({
  store,
  token,
  blocked,
  view,
  change,
  open,
  create,
  arrive,
  refusal,
}: {
  store: Store;
  token: string;
  blocked: boolean;
  /** Kept by the workspace, so an order opened and left finds it so. */
  view: OrdersView;
  change: (view: OrdersView) => void;
  /** Its card; with its step's sheet over it, where the row's verb opens
   * one. */
  open: (order: Order, then?: "send" | "collect") => void;
  create: () => void;
  /** «Прибув на пошту» from its row: recorded as from its card, and
   * whether it was. */
  arrive: (order: Order) => Promise<boolean>;
  /** A row's «Прибув на пошту» refused: said under its tag, or where its
   * tag stood once the order moved on (audit 2026-11-13, orders P1-1). */
  refusal?: StepRefusal | null | undefined;
}): JSX.Element {
  const mayCreate = store.permissions.includes("sale:create");
  const mayRead = store.permissions.includes("sale:view");
  const mayStock = store.permissions.includes("inventory:view");
  // A waybill, searched once they pause, from two characters, as the till's
  // search; Enter searches at once.
  const { query, pressed, place, gone } = view;
  const typed = useSettled(query);
  const search = pressed !== "" && pressed === query.trim() ? pressed : typed;
  const field = useRef<HTMLInputElement>(null);

  const found = useOrders(
    store,
    token,
    `&waybill=${encodeURIComponent(search)}`,
    PAGE,
    mayRead && search !== "",
  );
  const opened = useOrders(store, token, "&status=open", OPEN_PAGE, mayRead);
  const nothingOpen =
    opened.pages.data !== undefined && opened.orders.length === 0;
  // Read as soon as nothing is open: whether there was ever an order.
  const closed = useOrders(
    store,
    token,
    "&status=closed",
    PAGE,
    mayRead && (place === "collected" || gone || nothingOpen),
  );
  // The warehouses' names, for whoever reads the stock: the card's and the
  // return's read.
  const warehouses = useQuery({
    queryKey: placesKey(store.id),
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    enabled: mayRead && mayStock,
    retry: false,
  });
  const inPlace = (status: Status): Order[] =>
    opened.orders.filter((order) => order.status === status);
  const lists: Record<Exclude<Place, "collected">, Order[]> = {
    send: inPlace("READY_TO_DISPATCH"),
    sent: inPlace("DISPATCHED"),
    post: inPlace("ARRIVED"),
  };
  const collected = closed.orders.filter(
    (order) => order.status === "COLLECTED",
  );
  // Those to be sent by their warehouse, for whoever reads the stock: until
  // the warehouses are first read, the rows' places — never one list the
  // labels come over later (orders and «Каса» task list after stage 2,
  // P1-1). Refused, one list, as before — and read again after a refusal,
  // the rows shown stay (review).
  const waitingForPlaces =
    mayStock && warehouses.isPending && !warehouses.isFetched;
  const groups = mayStock
    ? byWarehouse(
        lists.send,
        warehouses.status === "success" ? warehouses.data : undefined,
      )
    : null;
  const cancelled = closed.orders.filter(
    (order) => order.status === "CANCELLED" || order.status === "RETURNED",
  );
  // The open ones counted once every one of them is read.
  const counts =
    opened.pages.data !== undefined && !opened.pages.hasNextPage
      ? {
          send: lists.send.length,
          sent: lists.sent.length,
          post: lists.post.length,
        }
      : null;

  // A tap carried from the list before onto the row that took its place —
  // a place chosen, a row gone to its next, the rows come where their
  // places stood — is let go (orders task list, P0-2; review, 2026-10-24,
  // 2026-11-01). A key's press is never one.
  const ids = (orders: readonly Order[]): string[] =>
    orders.map((order) => order.id);
  const shown = [
    search,
    place,
    String(gone),
    // The rows come where their places stood: a tap as they do is let go
    // (review).
    String(waitingForPlaces),
    ...(search !== ""
      ? ids(found.orders)
      : place === "collected"
        ? ids(collected)
        : place === "send" && groups !== null
          ? groups.flatMap((group) => [group.label, ...ids(group.orders)])
          : ids(lists[place])),
  ].join(" ");
  const before = useRef<string | null>(null);
  const changedAt = useRef(-Infinity);
  useEffect(() => {
    if (before.current !== null && before.current !== shown)
      changedAt.current = performance.now();
    before.current = shown;
  }, [shown]);
  const carried = (event: MouseEvent): boolean =>
    event.detail !== 0 && event.timeStamp - changedAt.current < CARRIED_TAP;

  // «Прибув на пошту» said once it is recorded: the row has gone to its
  // place.
  const [toast, setToast] = useState<{ text: string; times: number } | null>(
    null,
  );
  // The order whose «Прибув на пошту» is on its way: its verb pressed, the
  // ring on it until answered, as the card's (audit after stage 2,
  // orders-cash P2-5).
  const [arriving, setArriving] = useState<string | null>(null);
  // The cancelled opened: their heading in focus; back, the link that
  // opened them.
  const goneLink = useRef<HTMLButtonElement>(null);
  const goneHeading = useRef<HTMLHeadingElement>(null);
  const wasGone = useRef(gone);
  useEffect(() => {
    if (gone) goneHeading.current?.focus();
    else if (wasGone.current) goneLink.current?.focus();
    wasGone.current = gone;
  }, [gone]);

  // Where the row whose «Прибув на пошту» was pressed stood: its refusal is
  // said under its tag until the next step, another place or search; its
  // order moved on meanwhile, where its tag stood, until the next tap (audit
  // 2026-11-13, orders P1-1) — let go once that tap is delivered, so nothing
  // moves under it first (review, 2026-11-13).
  const pressedAt = useRef<{
    orderId: string;
    label: string;
    at: number;
  } | null>(null);
  const [heard, setHeard] = useState(0);
  const [tapped, setTapped] = useState(0);
  const said = refusal && refusal.times > heard ? refusal : null;
  const stoodSaid = said && said.times > tapped ? said : null;
  const stoodTimes = stoodSaid?.times ?? null;
  useEffect(() => {
    if (stoodTimes === null) return;
    const hear = (): void => {
      setTapped(stoodTimes);
    };
    document.addEventListener("click", hear, { capture: true });
    return () => {
      document.removeEventListener("click", hear, { capture: true });
    };
  }, [stoodTimes]);
  useEffect(() => {
    if (refusal) setHeard(refusal.times);
    // Another place or search: what was refused is not said there; the
    // refusal itself is not why this runs.
  }, [place, search]);
  /** The refusal of a row no longer shown, where its tag stood. */
  function stood(label: string, orders: readonly Order[]): number | null {
    const was = pressedAt.current;
    if (
      !stoodSaid ||
      was?.orderId !== stoodSaid.orderId ||
      was.label !== label ||
      orders.some((order) => order.id === stoodSaid.orderId)
    )
      return null;
    return Math.min(was.at, orders.length);
  }

  function verbOf(order: Order, label: string, at: number) {
    const next = nextOf[order.status];
    if (!mayCreate || next === undefined) return undefined;
    return {
      words: verbWords[next],
      held: blocked,
      pressed: arriving === order.id,
      act: (event: MouseEvent) => {
        if (carried(event)) return;
        if (next !== "arrive") {
          // A tag's verb, felt (spec §4.4).
          buzz("light");
          open(order, next);
          return;
        }
        setArriving(order.id);
        pressedAt.current = { orderId: order.id, label, at };
        void arrive(order)
          .then((recorded) => {
            if (recorded)
              setToast((now) => ({
                text: `Прибув на пошту: ${titleOf(order)}`,
                times: (now?.times ?? 0) + 1,
              }));
          })
          .finally(() => {
            setArriving(null);
          });
      },
    };
  }

  function rows(
    orders: readonly Order[],
    label: string,
    sticker: boolean,
  ): JSX.Element {
    const standsAt = stood(label, orders);
    const tagsOf = orders.map((order, at) => (
      <OrderTag
        key={order.id}
        order={order}
        sticker={sticker}
        open={() => {
          open(order);
        }}
        verb={verbOf(order, label, at)}
        refused={said?.orderId === order.id ? said : null}
      />
    ));
    // Its own keyed place: the rows read again move it, never draw it anew
    // (review, 2026-11-13).
    if (stoodSaid && standsAt !== null)
      tagsOf.splice(
        standsAt,
        0,
        <li key="refused" className="order-refused">
          <StepRefused refusal={stoodSaid} />
        </li>,
      );
    return (
      <ul className="order-rows order-tags" aria-label={label}>
        {tagsOf}
      </ul>
    );
  }

  // Whether what each list holds is its next page's failure (P2-6).
  const nextFailed = {
    found: useNextPageFailed(found.pages),
    opened: useNextPageFailed(opened.pages),
    closed: useNextPageFailed(closed.pages),
  };

  /** «Показати ще» under the rows read; the next page that could not be
   * read, one plate in its place, its retry reading that page — those read
   * stay (orders and «Каса» task list after stage 2, P2-6). */
  function more(
    pages: ReturnType<typeof useOrders>["pages"],
    failed: boolean,
  ): JSX.Element | null {
    if (failed)
      return (
        <Unread
          error={pages.error}
          held={pages.isFetching}
          retry={() => {
            void pages.fetchNextPage();
          }}
        />
      );
    return pages.hasNextPage ? (
      <button
        type="button"
        className="quiet"
        disabled={pages.isFetching}
        onClick={() => {
          void pages.fetchNextPage();
        }}
      >
        Показати ще
      </button>
    ) : null;
  }

  /** The rows' places while they are read: row tags, as the rows' own
   * (orders and «Каса» task list after stage 2, P1-1). To be sent, for
   * whoever reads the stock, in a warehouse's own section, its label's
   * place over them. */
  function places(said: string, labelled = false): JSX.Element {
    const tags = <Placeholder said={said} lineTags={3} />;
    return labelled ? (
      <section className="order-place">
        <span
          className="order-place-label t-meta skeleton-line skeleton-place-label"
          aria-hidden="true"
        >
          <span>Склад «Основний»</span>
        </span>
        {tags}
      </section>
    ) : (
      tags
    );
  }

  /** The closed read's state over its rows: its places while it is read,
   * what failed — a next page's failure is said where «Показати ще» was. */
  function closedRead(): JSX.Element | null {
    return closed.pages.isPending ? (
      places("Завантажуємо замовлення…")
    ) : closed.pages.error && !nextFailed.closed ? (
      <Unread
        error={closed.pages.error}
        held={closed.pages.isFetching}
        retry={() => {
          void closed.pages.refetch();
        }}
      />
    ) : null;
  }

  // Nothing here (spec §6.28): the blank tag, the words as before (orders
  // and «Каса» task list after stage 2, P1-1).
  const empty = <Empty title="Тут посилок немає." />;

  function placeList(): JSX.Element {
    if (place === "collected")
      return (
        <>
          {closedRead()}
          {closed.pages.data !== undefined &&
            (collected.length > 0
              ? rows(collected, placeWords.collected, true)
              : !closed.pages.hasNextPage && empty)}
          {more(closed.pages, nextFailed.closed)}
          {closed.pages.data !== undefined &&
            (cancelled.length > 0 || closed.pages.hasNextPage) && (
              <button
                type="button"
                className="quiet order-rare orders-gone"
                ref={goneLink}
                onClick={() => {
                  change({ ...view, gone: true });
                }}
              >
                Скасовані й повернені на склад{" "}
                <Icon name="chevron-right" size={16} className="link-chevron" />
              </button>
            )}
        </>
      );
    const orders = lists[place];
    const under = place === "send" ? groups : null;
    return (
      <>
        {orders.length === 0 && stood(placeWords[place], orders) !== null
          ? rows(orders, placeWords[place], false)
          : null}
        {orders.length === 0 ? (
          // Nothing here yet of what is read: the rest may hold some.
          opened.pages.hasNextPage ? null : place === "send" ? (
            <Empty title="Зараз нічого не треба відправляти." />
          ) : (
            empty
          )
        ) : place === "send" && waitingForPlaces ? (
          places("Завантажуємо склади…", true)
        ) : under === null ? (
          rows(orders, placeWords[place], false)
        ) : (
          under.map((group) => (
            <section key={group.label} className="order-place">
              <h3 className="order-place-label t-meta">
                {group.label}
                {/* Counted, as the knots are, once every one is read. */}
                {counts === null ? "" : ` · ${String(group.orders.length)}`}
              </h3>
              {rows(group.orders, group.label, false)}
            </section>
          ))
        )}
        {more(opened.pages, nextFailed.opened)}
      </>
    );
  }

  const shownToast = toast && (
    <Toast
      key={toast.times}
      text={toast.text}
      gone={() => {
        setToast(null);
      }}
    />
  );

  if (gone && mayRead && search === "")
    // The cancelled and come back, under «Клієнт забрав»: nothing more is
    // done to them.
    return (
      <>
        <ScreenHeader
          ref={goneHeading}
          title="Скасовані й повернені на склад"
          focusable
          back={
            <Back
              go={() => {
                change({ ...view, gone: false });
              }}
            >
              <span aria-hidden="true">← </span>До замовлень
            </Back>
          }
        />
        <section className="orders">
          {closedRead()}
          {closed.pages.data !== undefined &&
            (cancelled.length > 0
              ? rows(cancelled, "Скасовані й повернені на склад", true)
              : !closed.pages.hasNextPage && empty)}
          {more(closed.pages, nextFailed.closed)}
        </section>
      </>
    );

  return (
    <>
      <ScreenHeader
        title="Замовлення"
        wraps
        aside={
          mayCreate && (
            // Said in words, its «+» before them (stage 2, orders task list,
            // P1-4; В-ЗП4 (а)).
            <button
              type="button"
              className="orders-add"
              disabled={blocked}
              onClick={create}
            >
              <Icon name="plus" size={20} />
              Нове замовлення
            </button>
          )
        }
      />
      <section className="orders">
        {/* Never opened without the right (orders task list, P2-1): nothing
            is said of the rule. */}
        {!mayRead ? null : (
          <>
            {/* The shared field (spec §6.6; orders and «Каса» task list
                after stage 2, P1-1): its name heard, «Номер ТТН» its hint —
                the server searches the waybill alone — the magnifier and
                «×», which is «Очистити». */}
            <form
              className="find"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                change({
                  ...view,
                  pressed: query.trim().length >= 2 ? query.trim() : "",
                });
              }}
            >
              <SearchField
                label="Номер ТТН"
                placeholder="Номер ТТН"
                maxLength={64}
                value={query}
                change={(text) => {
                  // An Enter is for what was typed then: its «×» or a
                  // letter more, and the search waits for the pause again.
                  change({ ...view, query: text, pressed: "" });
                }}
                inputRef={field}
              />
            </form>
            {search !== "" ? (
              // What was typed before stands until the answer: «not found» is
              // said of this search only (review, 2026-10-23).
              found.pages.isPending ||
              (found.pages.isPlaceholderData && found.orders.length === 0) ? (
                places("Шукаємо…")
              ) : (
                <>
                  {found.pages.error && !nextFailed.found && (
                    <Unread
                      error={found.pages.error}
                      held={found.pages.isFetching}
                      retry={() => {
                        void found.pages.refetch();
                      }}
                    />
                  )}
                  {found.pages.data && found.orders.length === 0 ? (
                    // The blank tag, «Очистити» its one button (spec §6.28;
                    // orders and «Каса» task list after stage 2, P1-1).
                    <Empty
                      title={`За «${visible(search)}» замовлень не знайдено. Перевірте номер ТТН.`}
                    >
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => {
                          change({ ...view, query: "", pressed: "" });
                          field.current?.focus();
                        }}
                      >
                        Очистити
                      </button>
                    </Empty>
                  ) : (
                    // No place says where they are: a sticker each.
                    rows(found.orders, "Знайдені замовлення", true)
                  )}
                  {more(found.pages, nextFailed.found)}
                </>
              )
            ) : opened.pages.data === undefined ? (
              opened.pages.isPending ? (
                // The string, not counted yet, and its rows' places (orders
                // task list, P2-2).
                <>
                  <KnotFilter
                    chosen={place}
                    counts={null}
                    choose={(chosen) => {
                      change({ ...view, place: chosen });
                    }}
                  />
                  {places(
                    "Завантажуємо замовлення…",
                    place === "send" && mayStock,
                  )}
                </>
              ) : (
                <Unread
                  error={opened.pages.error}
                  retry={() => {
                    void opened.pages.refetch();
                  }}
                />
              )
            ) : nothingOpen &&
              (closed.pages.isPending ||
                (closed.pages.data !== undefined &&
                  closed.orders.length === 0)) ? (
              // Whether there was ever an order: until it is known, the
              // places; never one, the words that teach what an order is.
              closed.pages.isPending ? (
                places("Завантажуємо замовлення…")
              ) : (
                // Nothing yet (spec §6.28): a blank tag drawn, the words
                // under it, «Нове замовлення» a second button (stage 2,
                // orders task list, P1-4).
                <Empty
                  title="Замовлень ще немає."
                  meta="Замовлення тримає товар у резерві, поки його не відправили."
                >
                  {mayCreate && (
                    <button
                      type="button"
                      className="quiet"
                      disabled={blocked}
                      onClick={create}
                    >
                      Нове замовлення
                    </button>
                  )}
                </Empty>
              )
            ) : (
              <>
                {opened.pages.error && !nextFailed.opened && (
                  <Unread
                    error={opened.pages.error}
                    held={opened.pages.isFetching}
                    retry={() => {
                      void opened.pages.refetch();
                    }}
                  />
                )}
                <KnotFilter
                  chosen={place}
                  counts={counts}
                  choose={(chosen) => {
                    change({ ...view, place: chosen });
                  }}
                />
                {placeList()}
              </>
            )}
          </>
        )}
      </section>
      {shownToast}
    </>
  );
}
