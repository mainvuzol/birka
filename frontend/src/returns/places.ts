import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { api } from "@/shared/api";
import type { Location, Store } from "@/orders/types";

/**
 * Where this store may put goods back on sale: the open warehouses it
 * receives into, never its «Брак». Goods sold from a warehouse this store
 * does not reach — another store's own — go to one of these, which the
 * seller chooses (owner decision, 2026-10-01).
 */
export function useBackOnSale(
  store: Store,
  token: string,
  enabled: boolean,
): UseQueryResult<Location[]> {
  return useQuery({
    queryKey: ["back-on-sale", store.id],
    queryFn: async () =>
      (
        await api<Location[]>(`/stock-locations?store_id=${store.id}`, token)
      ).filter(
        (location) =>
          location.is_active &&
          location.can_receive &&
          !location.damaged_returns,
      ),
    enabled,
    retry: false,
  });
}
