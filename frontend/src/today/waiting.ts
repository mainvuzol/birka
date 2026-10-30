import type { UseQueryResult } from "@tanstack/react-query";
import { serverTitle, troubleText, verdictTitle } from "@/backups/Backups";
import type { Backups } from "@/backups/types";
import type { DamagedUnit } from "@/damaged/types";
import { plural } from "@/openings/types";
import type { OrderItem, Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import {
  ageOf,
  dayStores,
  useDamaged,
  useNetworkBackups,
  useOpenOrders,
  useStockLists,
} from "./reads";
import type { Age } from "./reads";

/**
 * The work «Сьогодні» says waits («Усе на бірці» task list, P0-6, items 3–8;
 * spec §6.9), in the frame's order: the backups, the parcels to send,
 * «Брак», the lists of existing stock to approve. Each from a read the
 * server already answers, by its own right in its own store; a tag goes by
 * itself once the work is done, at the next reading.
 */
export type Kind = "backups" | "parcels" | "damaged" | "openings";

export interface Tag {
  /** One a kind and a store. */
  key: string;
  kind: Kind;
  /** The store it is of; none for the backups, which are the network's. */
  store: Store | undefined;
  title: string;
  /** Up to two lines, its parts said with «·» between them. */
  meta: string[];
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

  const reads: UseQueryResult[] = [
    ...(backups ? [backups] : []),
    ...orders.values(),
    ...damaged.values(),
    ...lists.values(),
  ];
  const unread = reads.filter((read) => read.data === undefined);
  const state = backups?.data;
  return {
    tags: [
      ...(backups ? backupsTag(backups) : []),
      ...parcels,
      ...inspect,
      ...approve,
    ],
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
