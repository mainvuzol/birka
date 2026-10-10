import { isId, journal } from "@/shared/journal";
import type { CountBody, CountResult } from "./stocktakeTypes";

/**
 * One position's count in a stocktake, written down before it is sent
 * (`@/shared/journal`; ADR-0022). It carries a permanent `command_id`, as a
 * stock correction does (ADR-0007): resent however late, even after the
 * stocktake was finished, it is answered from its record and applies once.
 */
const counts = journal<CountBody, CountResult>({
  path: (body) => `/stocktakes/${body.stocktake_id}/counts`,
  payload: (body) => ({
    store_id: body.store_id,
    command_id: body.command_id,
    product_variant_id: body.product_variant_id,
    size_id: body.size_id,
    counted_quantity: body.counted_quantity,
    expected_quantity: body.expected_quantity,
  }),
  scope: "stocktake-count-pending",
  isBody: (body) =>
    isId(body.stocktake_id) &&
    isId(body.product_variant_id) &&
    isId(body.size_id) &&
    typeof body.counted_quantity === "number" &&
    Number.isInteger(body.counted_quantity) &&
    body.counted_quantity >= 0 &&
    body.counted_quantity <= 10000 &&
    typeof body.expected_quantity === "number" &&
    Number.isInteger(body.expected_quantity) &&
    body.expected_quantity >= 0,
  corrupt: "Некоректний збережений підрахунок. Зверніться до менеджера.",
  unfinished: "Спершу завершіть збережений підрахунок.",
});

export const useCountCommand = counts.use;
export const loadCount = counts.load;
export const submitCount = counts.submit;
export const resolveCount = counts.resolve;
