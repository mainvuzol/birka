import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { api } from "@/shared/api";
import type { Store } from "@/orders/types";
import type { DamagedUnit } from "./types";

/**
 * The store's «Брак», read once for its screen and for its row of «Ще»
 * (navigation task list, P0-3; «Усе на бірці» task list, P0-4): one read,
 * so the row's count is the screen's own.
 */
export function useDamagedUnits(
  store: Store,
  token: string,
  enabled = true,
): UseQueryResult<{ units: DamagedUnit[] }> {
  return useQuery({
    queryKey: ["damaged-units", store.id],
    queryFn: () =>
      api<{ units: DamagedUnit[] }>(
        `/damaged-units?store_id=${store.id}`,
        token,
      ),
    retry: false,
    enabled,
  });
}
