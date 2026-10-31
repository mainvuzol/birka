import type { UseQueryResult } from "@tanstack/react-query";
import { serverTitle, troubleText, verdictTitle } from "@/backups/Backups";
import type { Backups } from "@/backups/types";
import { differenceOf } from "@/cash/Closed";
import { timeOf } from "@/cash/errors";
import { cashDay } from "@/cash/format";
import type { Close } from "@/cash/types";
import type { DamagedUnit } from "@/damaged/types";
import type { StocktakeRecord } from "@/inventory/stocktakeTypes";
import { plural } from "@/openings/types";
import type { OrderItem, Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import {
  ageOf,
  dayStores,
  useCloses,
  useDamaged,
  useNetworkBackups,
  useOpenOrders,
  useStockLists,
  useStocktakes,
  useWarehouses,
} from "./reads";
import type { Age, Counted } from "./reads";
import { useSeen } from "./seen";

/**
 * What «Сьогодні» says waits («Усе на бірці» task list, P0-6, items 3–8;
 * spec §6.9), in the frame's order: the backups, a drawer's difference, the
 * parcels to send, «Брак», the lists of existing stock to approve, a
 * stocktake finished. Each from a read the server already answers, by its
 * own right in its own store. Work goes by itself once done, at the next
 * reading; news — a drawer's difference, a stocktake — once seen («Бачу»).
 */
export type Kind =
  | "backups"
  | "drawer"
  | "parcels"
  | "damaged"
  | "openings"
  | "stocktake";

export interface Tag {
  /** One a kind and a store. */
  key: string;
  kind: Kind;
  /** The store it is of; none for the backups, which are the network's. */
  store: Store | undefined;
  title: string;
  /** Up to two lines, its parts said with «·» between them. */
  meta: string[];
  /** News, gone once seen: what this phone keeps of it. */
  seen?: string;
}

/** A news tag seen today on this phone, and when. */
export interface Done {
  tag: Tag;
  at: number;
}

export interface Waiting {
  tags: Tag[];
  /** Some read has not answered yet: its place is held. */
  unread: boolean;
  /** The unread reads' last asking: whether it failed. */
  unreadAge: Age;
  /** Whether anything is read at all: this person holds a right to one. */
  asked: boolean;
  /** How old it all is: the oldest of its reads. */
  age: Age;
  /** The backups in order, with no trouble on the server: when the last
   * copy was made. */
  backupsOk: { at: string } | undefined;
  /** «Зроблено сьогодні»: the news seen today on this phone, the latest
   * first, of what is still read. */
  done: Done[];
}

/** «сьогодні о 03:15», «учора о 03:15», «28.10 о 03:15»: when, by the
 * phone's day. */
export function whenText(iso: string, now: number): string {
  const at = new Date(iso);
  const day = (date: Date): string => date.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = timeOf(iso);
  if (day(at) === day(new Date(now))) return `сьогодні о ${time}`;
  if (day(at) === day(yesterday)) return `учора о ${time}`;
  const date = at.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${date} о ${time}`;
}

/** Today or yesterday, by the phone's day. */
function lately(iso: string, now: number): boolean {
  const at = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return [new Date(now), yesterday].some(
    (day) => day.toDateString() === at.toDateString(),
  );
}

/** «Лоран шоколад M», and «× 2» for more than one: a model, its colour and
 * its size, as the frame writes them. */
function goods({
  display_name,
  size_label,
  quantity,
}: Pick<OrderItem, "display_name" | "size_label" | "quantity">): string {
  const size =
    size_label === null || size_label === "UNKNOWN"
      ? "розмір невідомий"
      : visible(size_label);
  return `${visible(display_name)} ${size}${
    quantity > 1 ? ` × ${String(quantity)}` : ""
  }`;
}

/** «Лагуна персик L»: a unit in «Брак». */
function unitGoods(unit: DamagedUnit): string {
  return unit.size === null || unit.size === "UNKNOWN"
    ? `${visible(unit.display_name)} розмір невідомий`
    : `${visible(unit.display_name)} ${visible(unit.size)}`;
}

/** «нестача 120,00 грн», as «Каса» says it, inside a sentence. */
function differenceWords(difference: string): string {
  const { text } = differenceOf(difference);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** «— нестача 2 шт., надлишок 1 шт.», or «— розбіжностей немає», as the
 * stocktake's own result. */
function stocktakeWords({ sums }: StocktakeRecord): string {
  const found = [
    ...(sums.shortage_units > 0
      ? [`нестача ${String(sums.shortage_units)} шт.`]
      : []),
    ...(sums.surplus_units > 0
      ? [`надлишок ${String(sums.surplus_units)} шт.`]
      : []),
  ];
  return found.length > 0 ? found.join(", ") : "розбіжностей немає";
}

/** Oldest first: the work waiting longest comes first. */
function byAge(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** The backups' tag, while something is wrong with them or on the server
 * (`backup:view` of the network): the backups screen's heading for it,
 * and what is wrong on the server now. */
function backupsTag(read: UseQueryResult<Backups>): Tag[] {
  const backups = read.data;
  if (!backups) return [];
  const open = backups.server?.open ?? [];
  if (backups.state === "OK" && open.length === 0) return [];
  return [
    {
      key: "backups",
      kind: "backups",
      store: undefined,
      title:
        backups.state === "OK"
          ? serverTitle(open.length)
          : verdictTitle(backups),
      meta: open.map((trouble) => troubleText(trouble.kind)),
    },
  ];
}

/**
 * The tags of the stores of the day, and of the network's backups. Read
 * wherever this person reads the report: by «Сьогодні» — so on its tab
 * they are read again once a minute has gone — and by its tab's badge, the
 * same reads.
 */
export function useWaiting({
  token,
  scopeKey,
  stores,
  open,
  readsBackups,
}: {
  token: string;
  /** Whose reads these are: the organisation and the person. */
  scopeKey: string;
  /** Every store of `/me`, with this person's rights in each; none where
   * «Сьогодні» is not this person's. */
  stores: readonly Store[];
  /** The store open in Бірка: its tags first of their kind. */
  open: Store;
  /** Whether the network's backups are this person's to read. */
  readsBackups: boolean;
}): Waiting {
  const read = useNetworkBackups(token, scopeKey, readsBackups);
  const backups = readsBackups ? read : undefined;
  // The open store's tags first of their kind, the others by code.
  const shown = dayStores(stores).sort(
    (a, b) => Number(b.id === open.id) - Number(a.id === open.id),
  );
  const orders = useOpenOrders(token, scopeKey, shown);
  const damaged = useDamaged(token, shown);
  const lists = useStockLists(token, scopeKey, shown);
  const closes = useCloses(token, scopeKey, shown.length > 0);
  const warehouses = useWarehouses(token, scopeKey, shown);
  // Each warehouse read once, through the first store of the day that sees
  // it, the open one first: one two stores share is one warehouse. «Брак»
  // and a paused one are never counted. Counted once every store's
  // warehouses have answered: which store reads a shared one never hangs on
  // which answered first.
  const counted: Counted[] = [];
  const settled = [...warehouses.values()].every(
    (read) => read.data !== undefined || read.isError,
  );
  for (const store of settled ? shown : [])
    for (const location of warehouses.get(store.id)?.data ?? [])
      if (
        location.is_active &&
        !location.damaged_returns &&
        !counted.some((one) => one.location.id === location.id)
      )
        counted.push({ store, location });
  const stocktakes = useStocktakes(token, scopeKey, counted);
  const seen = useSeen(scopeKey);
  const now = Date.now();
  // A store is named where the day holds another, or it is not the one
  // open: «Відправити 3 посилки» alone would be read as this store's.
  const named = (store: Store): string[] =>
    shown.length > 1 || store.id !== open.id ? [visible(store.name)] : [];

  const parcels = shown.flatMap((store): Tag[] => {
    const read = orders.get(store.id);
    const page = read?.data;
    if (!read || !page) return [];
    const ready = page.orders
      .filter((order) => order.status === "READY_TO_DISPATCH")
      .sort((a, b) => byAge(a.created_at, b.created_at));
    if (ready.length === 0) return [];
    // Past a store's hundred, every count is the least there is.
    const more = page.has_more ? "+" : "";
    const items = ready.flatMap((order) => order.items).map(goods);
    return [
      {
        key: `parcels:${store.id}`,
        kind: "parcels",
        store,
        title: `Відправити ${String(ready.length)}${more} ${plural(
          ready.length,
          "посилку",
          "посилки",
          "посилок",
        )}`,
        meta: [
          ...named(store),
          ...items.slice(0, 3),
          ...(items.length > 3
            ? [`+ ще ${String(items.length - 3)}${more}`]
            : []),
        ],
      },
    ];
  });

  const inspect = shown.flatMap((store): Tag[] => {
    const read = damaged.get(store.id);
    if (!read?.data) return [];
    const waiting = read.data.units
      .filter((unit) => unit.status === "AWAITING")
      .sort((a, b) => byAge(a.returned_at, b.returned_at));
    const count = waiting.length;
    if (count === 0) return [];
    const one = count % 10 === 1 && count % 100 !== 11;
    return [
      {
        key: `damaged:${store.id}`,
        kind: "damaged",
        store,
        title: `У «Браку» «${visible(store.name)}» ${String(count)} ${plural(
          count,
          "річ",
          "речі",
          "речей",
        )} ${one ? "очікує" : "очікують"} перевірки`,
        meta: waiting.slice(0, 2).map(unitGoods),
      },
    ];
  });

  const approve = shown.flatMap((store): Tag[] => {
    const read = lists.get(store.id);
    if (!read?.data) return [];
    // A list of a warehouse two stores share is seen from both: it waits
    // in the store that keeps it.
    const waiting = read.data.items.filter(
      (list) => list.status === "IN_REVIEW" && list.store_id === store.id,
    );
    const first = waiting[0];
    if (first === undefined) return [];
    return [
      {
        key: `openings:${store.id}`,
        kind: "openings",
        store,
        title: "Затвердьте початкові залишки",
        meta: [
          ...named(store),
          waiting.length === 1
            ? `${String(first.summary.lines)} ${plural(
                first.summary.lines,
                "рядок",
                "рядки",
                "рядків",
              )}`
            : `${String(waiting.length)} ${plural(
                waiting.length,
                "список",
                "списки",
                "списків",
              )}`,
        ],
      },
    ];
  });

  // A drawer's difference of 1,00 грн or more, yesterday's or today's —
  // the drawer's days — one tag a close, the open store's first, the oldest
  // first in each.
  const today = cashDay(0);
  // The stores of the day in their order, any other after them.
  const order = (id: string): number => {
    const at = shown.findIndex((store) => store.id === id);
    return at === -1 ? shown.length : at;
  };
  const differences = shown.flatMap((store): Tag[] =>
    (closes.data?.items ?? [])
      .filter(
        (close): close is Close & { difference: string } =>
          close.store_id === store.id &&
          close.reason_required &&
          close.difference !== null &&
          (close.business_day === today ||
            close.business_day === cashDay(1)),
      )
      .sort((a, b) => byAge(a.closed_at, b.closed_at))
      .map((close) => ({
        key: `drawer:${close.id}`,
        kind: "drawer",
        store,
        seen: `close:${close.id}`,
        title: `У касі «${visible(store.name)}» ${
          close.business_day === today ? "сьогодні" : "учора"
        } ${differenceWords(close.difference)}`,
        meta: [
          visible(close.closed_by),
          `о ${timeOf(close.closed_at)}`,
          close.reason === null
            ? "причину не вказано"
            : `причина: «${visible(close.reason)}»`,
        ],
      })),
  );

  // A stocktake finished yesterday or today, by the phone's day: in the
  // store it was taken in — one not of the day too, a paused one — where
  // this person knows it; else in the one it was read through.
  const finished = counted
    .flatMap(({ store, location }) =>
      (stocktakes.get(location.id)?.data?.items ?? []).flatMap((item) =>
        item.finished_at !== null && lately(item.finished_at, now)
          ? [
              {
                item,
                at: item.finished_at,
                store: stores.find((one) => one.id === item.store_id) ?? store,
              },
            ]
          : [],
      ),
    )
    .sort(
      (a, b) =>
        order(a.store.id) - order(b.store.id) || byAge(a.at, b.at),
    )
    .map(
      ({ item, at, store }): Tag => ({
        key: `stocktake:${item.id}`,
        kind: "stocktake",
        store,
        seen: `stocktake:${item.id}`,
        title: `Склад «${visible(
          item.location_name,
        )}»: інвентаризацію завершено — ${stocktakeWords(item)}`,
        meta: [
          ...named(store),
          ...(item.finished_by === null ? [] : [visible(item.finished_by)]),
          whenText(at, now),
        ],
      }),
    );

  const reads: UseQueryResult[] = [
    ...(backups ? [backups] : []),
    ...(shown.length > 0 ? [closes] : []),
    ...orders.values(),
    ...damaged.values(),
    ...lists.values(),
    ...warehouses.values(),
    ...stocktakes.values(),
  ];
  const unread = reads.filter((read) => read.data === undefined);
  const state = backups?.data;
  const every = [
    ...(backups ? backupsTag(backups) : []),
    ...differences,
    ...parcels,
    ...inspect,
    ...approve,
    ...finished,
  ];
  const seenAt = (tag: Tag): number | undefined =>
    tag.seen === undefined ? undefined : seen[tag.seen];
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return {
    tags: every.filter((tag) => seenAt(tag) === undefined),
    done: every
      .flatMap((tag): Done[] => {
        const at = seenAt(tag);
        return at !== undefined && at >= midnight ? [{ tag, at }] : [];
      })
      .sort((a, b) => b.at - a.at),
    unread: unread.length > 0,
    unreadAge: ageOf(unread),
    asked: reads.length > 0,
    age: ageOf(reads),
    backupsOk:
      state?.state === "OK" &&
      (state.server?.open.length ?? 0) === 0 &&
      state.latest
        ? { at: state.latest.finished_at }
        : undefined,
  };
}
