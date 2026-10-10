/**
 * A stocktake of a whole warehouse (owner decisions, 2026-10-10; ADR-0022),
 * as the server answers it.
 */

export interface StocktakeSums {
  counted_positions: number;
  /** Positions with stock nobody counted: they stay as they are. */
  unchecked_positions: number;
  shortage_units: number;
  shortage_positions: number;
  surplus_units: number;
  surplus_positions: number;
}

export interface StocktakeRecord {
  id: string;
  location_id: string;
  location_name: string;
  store_id: string;
  started_by: string;
  started_at: string;
  finished_by: string | null;
  finished_at: string | null;
  /** Live while it is open, frozen once it is finished. */
  sums: StocktakeSums;
}

export interface LastCount {
  counted_quantity: number;
  /** What the stocktake changed here: the sum of this position's counts. */
  net_delta: number;
  counted_by: string;
  counted_at: string;
}

export interface StocktakePosition {
  product_variant_id: string;
  size_id: string;
  display_name: string;
  size_label: string;
  size_is_unknown: boolean;
  quantity: number;
  reserved_quantity: number;
  count: LastCount | null;
}

/** One count as the journal keeps it: the stocktake's id names where it goes. */
export interface CountBody {
  store_id: string;
  stocktake_id: string;
  command_id: string;
  product_variant_id: string;
  size_id: string;
  /** What the shelf holds. */
  counted_quantity: number;
  /** The balance it was counted against. */
  expected_quantity: number;
}

export interface CountResult {
  id: string;
  stocktake_id: string;
  product_variant_id: string;
  size_id: string;
  counted_quantity: number;
  quantity_before: number;
  quantity_delta: number;
  counted_at: string;
}
