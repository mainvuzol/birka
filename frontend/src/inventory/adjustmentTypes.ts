/**
 * Why a manager corrects a balance. The reasons this screen offers.
 *
 * The API accepts two more, and this screen deliberately does not offer them:
 * `FOUND_DURING_SALE` and `MISSING_AT_SALE` record what a seller observed at
 * the counter, in the sale's own transaction, and how often they happen is a
 * signal the owner measures. A manager's stocktake written under either would
 * pollute that signal with corrections no sale ever saw.
 */
export type AdjustmentReason =
  "STOCKTAKE" | "DAMAGED" | "LOST" | "CORRECTION" | "OTHER";

export const reasonLabels: Record<AdjustmentReason, string> = {
  STOCKTAKE: "Перерахунок",
  DAMAGED: "Пошкоджено",
  LOST: "Втрачено",
  CORRECTION: "Помилка обліку",
  OTHER: "Інше",
};

export interface AdjustmentBody {
  store_id: string;
  location_id: string;
  command_id: string;
  product_variant_id: string;
  size_id: string;
  quantity_delta: number;
  reason_code: AdjustmentReason;
  note: string | null;
  /** The balance a count was made against; null for a stated change. */
  expected_quantity: number | null;
}

export interface Adjustment {
  id: string;
  movement_id: string;
  quantity_before: number;
  quantity_after: number;
}
