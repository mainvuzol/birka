import { useQueries, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { api, unreachable } from "@/shared/api";
import { cashDay } from "@/cash/format";
import type { Close, Drawer } from "@/cash/types";
import type { StoreDebts } from "@/credits/types";
import type { DamagedUnit } from "@/damaged/types";
import type { StockList } from "@/openings/types";
import type { Backups } from "@/backups/types";
import type { StocktakeRecord } from "@/inventory/stocktakeTypes";
import type { Location, Order, Store } from "@/orders/types";
import type { SalesReport } from "@/reports/types";

/**
 * What «Сьогодні» reads («Усе на бірці» task list, P0-6): only what the
 * server already answers, each by its own right in its own store. A read is
 * asked as the screen opens and as the app comes back, never more than once
 * a minute; one that fails keeps what it read before. The report, a
 * drawer and a store's debts are read under the keys their own screens read
 * them by: one asking for both, and what «Каса» or «Борги» learns, «Сьогодні»
 * shows.
 */
export const EVERY = 60_000;

/** Older than this, the day-tag says how old: «дані на 11:32». */
export const STALE_AFTER = 5 * 60_000;

/** Kept while the person works elsewhere in Бірка: back on «Сьогодні», what
 * was read stands, with its age, while it is read again. */
const KEPT = 30 * 60_000;

/** The open orders read of each store, as «Замовлення» reads them. */
export const OPEN_ORDERS = 100;

export interface OpenOrders {
  orders: Order[];
  has_more: boolean;
}

const often = { staleTime: EVERY, gcTime: KEPT, retry: false } as const;

/** Today's sales of every store this person reads the report in, as «Звіт
 * про продажі» reads today's. */
export function useDayReport(
  token: string,
  scopeKey: string,
): UseQueryResult<SalesReport> {
  return useQuery({
    queryKey: ["sales-report", scopeKey, null],
    queryFn: () => api<SalesReport>("/reports/sales", token),
    ...often,
  });
}

/** Every store this person reads the report in, as the report orders
 * them: by code. One that does not trade is among them; the server reads
 * it too. */
export function reportStores(stores: readonly Store[]): Store[] {
  return stores
    .filter((store) => store.permissions.includes("report:view_financial"))
    .sort((a, b) =>
      a.code === b.code
        ? a.id.localeCompare(b.id)
        : a.code < b.code
          ? -1
          : 1,
    );
}

/** The stores of the day-tag: those of the report that trade, their rights
 * with them, known from `/me` before the report is read, so nothing of
 * theirs waits on it. */
export function dayStores(stores: readonly Store[]): Store[] {
  return reportStores(stores).filter((store) => store.state === "ACTIVE");
}

/** Each store's drawer, where this person may read it (`cash:close`,
 * `cash:expense` or `report:view_financial` there). */
export function useDrawers(
  token: string,
  stores: readonly Store[],
): Map<string, UseQueryResult<Drawer>> {
  const shown = stores.filter((store) =>
    ["cash:close", "cash:expense", "report:view_financial"].some((right) =>
      store.permissions.includes(right),
    ),
  );
  const reads = useQueries({
    queries: shown.map((store) => ({
      queryKey: ["cash-drawer", store.id],
      queryFn: () => api<Drawer>(`/cash/drawer?store_id=${store.id}`, token),
      ...often,
    })),
  });
  return byStore(shown, reads);
}

/** Each read by the store it is of, as `useQueries` gives them in order. */
function byStore<T>(
  stores: readonly Store[],
  reads: readonly T[],
): Map<string, T> {
  return new Map(
    stores.flatMap((store, at) => {
      const read = reads[at];
      return read === undefined ? [] : [[store.id, read] as const];
    }),
  );
}

/** What each store is owed, where this person takes payments on debts
 * (`sale:credit` there): never summed across stores. */
export function useDebts(
  token: string,
  stores: readonly Store[],
): Map<string, UseQueryResult<StoreDebts>> {
  const shown = stores.filter((store) =>
    store.permissions.includes("sale:credit"),
  );
  const reads = useQueries({
    queries: shown.map((store) => ({
      queryKey: ["credits", store.id, "summary"],
      queryFn: () =>
        api<StoreDebts>(`/credits/summary?store_id=${store.id}`, token),
      ...often,
    })),
  });
  return byStore(shown, reads);
}

/** Each store's open orders, where this person reads them (`sale:view`
 * there): the newest hundred, as «Замовлення» shows them. */
export function useOpenOrders(
  token: string,
  scopeKey: string,
  stores: readonly Store[],
): Map<string, UseQueryResult<OpenOrders>> {
  const shown = stores.filter((store) =>
    store.permissions.includes("sale:view"),
  );
  const reads = useQueries({
    queries: shown.map((store) => ({
      // Under «Замовлення»'s own prefix: a step of an order there reads
      // it again at once, and the parcels' tag and the badge with it.
      queryKey: ["orders", store.id, { today: scopeKey }],
      queryFn: () =>
        api<OpenOrders>(
          `/orders?store_id=${store.id}&status=open&limit=${String(OPEN_ORDERS)}`,
          token,
        ),
      ...often,
    })),
  });
  return byStore(shown, reads);
}

/** The network's backups, where this person may read them (`backup:view`
 * of the network): the backups screen's own read, here as often as the
 * rest. */
export function useNetworkBackups(
  token: string,
  scopeKey: string,
  enabled: boolean,
): UseQueryResult<Backups> {
  return useQuery({
    queryKey: ["backups", scopeKey],
    queryFn: () => api<Backups>("/backups", token),
    enabled,
    ...often,
  });
}

/** Each store's «Брак», where this person inspects it (`damaged:handle`
 * there): «Брак»'s own read, and its row's in «Ще». */
export function useDamaged(
  token: string,
  stores: readonly Store[],
): Map<string, UseQueryResult<{ units: DamagedUnit[] }>> {
  const shown = stores.filter((store) =>
    store.permissions.includes("damaged:handle"),
  );
  const reads = useQueries({
    queries: shown.map((store) => ({
      queryKey: ["damaged-units", store.id],
      queryFn: () =>
        api<{ units: DamagedUnit[] }>(
          `/damaged-units?store_id=${store.id}`,
          token,
        ),
      ...often,
    })),
  });
  return byStore(shown, reads);
}

/** Each store's lists of existing stock, where this person approves them
 * (`snapshot:approve` there): «Початкові залишки»'s own ask, under its
 * prefix, so a list it approves or rejects is read again here at once. */
export function useStockLists(
  token: string,
  scopeKey: string,
  stores: readonly Store[],
): Map<string, UseQueryResult<{ items: StockList[]; has_more: boolean }>> {
  const shown = stores.filter((store) =>
    store.permissions.includes("snapshot:approve"),
  );
  const reads = useQueries({
    queries: shown.map((store) => ({
      queryKey: ["stock-lists", { today: scopeKey }, store.id],
      queryFn: () =>
        api<{ items: StockList[]; has_more: boolean }>(
          `/snapshots?store_id=${store.id}&limit=100`,
          token,
        ),
      ...often,
    })),
  });
  return byStore(shown, reads);
}

/** The closes of yesterday and today of every store whose money this
 * person reads (`report:view_financial` there): one read for them all,
 * under «Каса»'s prefix, so a close there is read again here at once. The
 * days are the asking's: at 06:00 the key stays, and what was read stands
 * until the next reading. */
export function useCloses(
  token: string,
  scopeKey: string,
  enabled: boolean,
): UseQueryResult<{ items: Close[]; has_more: boolean }> {
  return useQuery({
    queryKey: ["cash-closes", { today: scopeKey }],
    queryFn: () =>
      // The drawer's days, 06:00 to 06:00, as «Каса» reads them.
      api<{ items: Close[]; has_more: boolean }>(
        `/cash/closes?date_from=${cashDay(1)}&date_to=${cashDay(0)}&limit=100`,
        token,
      ),
    enabled,
    ...often,
  });
}

/** Each store's warehouses, where this person reads its stock
 * (`inventory:view` there). */
export function useWarehouses(
  token: string,
  scopeKey: string,
  stores: readonly Store[],
): Map<string, UseQueryResult<Location[]>> {
  const shown = stores.filter((store) =>
    store.permissions.includes("inventory:view"),
  );
  const reads = useQueries({
    queries: shown.map((store) => ({
      queryKey: ["inventory-locations", { today: scopeKey }, store.id],
      queryFn: () =>
        api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
      ...often,
    })),
  });
  return byStore(shown, reads);
}

/** A warehouse whose stocktakes are read, and the store read through. */
export interface Counted {
  store: Store;
  location: Location;
}

/** Each warehouse's stocktakes, the open one and the latest: under
 * «Залишки»'s prefix, so one finished there is read again here at once.
 * Kept by the warehouse alone: the store it is read through may change as
 * the stores' warehouses answer, and it is the same warehouse. */
export function useStocktakes(
  token: string,
  scopeKey: string,
  warehouses: readonly Counted[],
): Map<string, UseQueryResult<{ items: StocktakeRecord[] }>> {
  const reads = useQueries({
    queries: warehouses.map(({ store, location }) => ({
      queryKey: ["stocktakes", { today: scopeKey }, location.id],
      queryFn: () =>
        api<{ items: StocktakeRecord[] }>(
          `/stocktakes?store_id=${store.id}&location_id=${location.id}`,
          token,
        ),
      ...often,
    })),
  });
  return new Map(
    warehouses.flatMap(({ location }, at) => {
      const read = reads[at];
      return read === undefined ? [] : [[location.id, read] as const];
    }),
  );
}

/** How old what a block shows is: the oldest of its reads' last answers,
 * and whether the last asking of any of them failed — the server silent,
 * or another refusal. */
export interface Age {
  /** When the oldest of its reads last answered; none before the first. */
  at: number | undefined;
  failed: boolean;
  silent: boolean;
}

export function ageOf(reads: readonly UseQueryResult[]): Age {
  const answered = reads
    .filter((read) => read.data !== undefined)
    .map((read) => read.dataUpdatedAt);
  const failing = reads.filter((read) => read.isError);
  return {
    at: answered.length > 0 ? Math.min(...answered) : undefined,
    failed: failing.length > 0,
    silent: failing.some((read) => unreachable(read.error)),
  };
}
