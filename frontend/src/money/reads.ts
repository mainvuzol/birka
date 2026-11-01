import { useQueries, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { api } from "@/shared/api";
import type { Close, Drawer, Movement } from "@/cash/types";
import type { Store } from "@/orders/types";
import { daysBefore, monthStart, weekStart } from "@/reports/types";
import type { SalesReport } from "@/reports/types";
import type { SupplierDebts } from "@/suppliers/types";
import { often } from "@/today/reads";

/**
 * What «Гроші» reads besides «Сьогодні»'s own reads («Усе на бірці»
 * sections task list, P0-7): each by its own right in its own store, as
 * often as «Сьогодні» reads, under the keys «Каса», «Накладні» and «Звіт
 * про продажі» read them by — what one learns, the other shows.
 */

/** «Надійшло»'s periods, as the report counts them. */
export type Period = "today" | "yesterday" | "week" | "month";

export const periods: readonly { mode: Period; label: string }[] = [
  { mode: "today", label: "Сьогодні" },
  { mode: "yesterday", label: "Вчора" },
  { mode: "week", label: "Тиждень" },
  { mode: "month", label: "Місяць" },
];

/** The days of a period, from the server's `today`: from Monday, from the
 * 1st (navigation task list, В5 (а)). Today is none: the server's own
 * today, the day's report read once for «Сьогодні» and «Гроші». */
export function rangeOf(
  period: Period,
  today: string,
): { from: string; to: string } | null {
  switch (period) {
    case "today":
      return null;
    case "yesterday":
      return { from: daysBefore(today, 1), to: daysBefore(today, 1) };
    case "week":
      return { from: weekStart(today), to: today };
    case "month":
      return { from: monthStart(today), to: today };
  }
}

/** The report of a period's days, as «Звіт про продажі» reads it; none, the
 * day's — «Сьогодні»'s own read, and the only one asked until it has said
 * which day today is. */
export function usePeriodReport(
  token: string,
  scopeKey: string,
  range: { from: string; to: string } | null,
): UseQueryResult<SalesReport> {
  return useQuery({
    queryKey: ["sales-report", scopeKey, range],
    queryFn: () =>
      api<SalesReport>(
        range
          ? `/reports/sales?date_from=${range.from}&date_to=${range.to}`
          : "/reports/sales",
        token,
      ),
    ...often,
  });
}

/** Each drawer's last close, where it has one: the cash counted in it, as
 * «Каса» reads a close. */
export function useLastCloses(
  token: string,
  drawers: ReadonlyMap<string, UseQueryResult<Drawer>>,
): Map<string, UseQueryResult<Close>> {
  const last = [...drawers].flatMap(([storeId, drawer]) => {
    const close = drawer.data?.last_close;
    return close ? [{ storeId, id: close.id }] : [];
  });
  const reads = useQueries({
    queries: last.map(({ id }) => ({
      queryKey: ["cash-close", id],
      queryFn: () => api<Close>(`/cash/closes/${id}`, token),
      ...often,
    })),
  });
  return new Map(
    last.flatMap(({ storeId }, at) => {
      const read = reads[at];
      return read === undefined ? [] : [[storeId, read] as const];
    }),
  );
}

/** Each drawer's cash taken out and put in during today's drawer day, under
 * the drawer's own key: what «Каса» records, read again here at once. */
export function useMovementsToday(
  token: string,
  drawers: ReadonlyMap<string, UseQueryResult<Drawer>>,
): Map<string, UseQueryResult<{ items: Movement[] }>> {
  const ids = [...drawers.keys()];
  const reads = useQueries({
    queries: ids.map((storeId) => ({
      queryKey: ["cash-drawer", storeId, "movements-today"],
      queryFn: () =>
        api<{ items: Movement[] }>(
          `/cash/movements?store_id=${storeId}`,
          token,
        ),
      ...often,
    })),
  });
  return new Map(
    ids.flatMap((storeId, at) => {
      const read = reads[at];
      return read === undefined ? [] : [[storeId, read] as const];
    }),
  );
}

/** What each store owes its suppliers now, where this person reads its
 * invoices (`supplier:debt` there): «Накладні»'s own read. */
export function useSupplierDebts(
  token: string,
  stores: readonly Store[],
): Map<string, UseQueryResult<SupplierDebts>> {
  const shown = stores.filter((store) =>
    store.permissions.includes("supplier:debt"),
  );
  const reads = useQueries({
    queries: shown.map((store) => ({
      queryKey: ["supplier-invoices", store.id, "summary"],
      queryFn: () =>
        api<SupplierDebts>(
          `/supplier-invoices/summary?store_id=${store.id}`,
          token,
        ),
      ...often,
    })),
  });
  return new Map(
    shown.flatMap((store, at) => {
      const read = reads[at];
      return read === undefined ? [] : [[store.id, read] as const];
    }),
  );
}
