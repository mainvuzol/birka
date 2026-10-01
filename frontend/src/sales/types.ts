import type { Line } from "@/orders/types";

/** A sale line is shaped exactly like an order line; the command differs. */
export type SaleLine = Line;

/**
 * One of the three in-sale corrections, all `{line_index, quantity}` on the wire.
 *
 * Their `quantity` means different things: `found_in_store` carries how many
 * units to add to the shelf, bounded by the line's shortfall;
 * `missing_in_store` carries how many units are **present**, and the server
 * takes the difference it believed in off the shelf; `size_clarified` carries
 * how many units move out of "size not known" into the line's size, which
 * must be exactly the line's shortfall at that size.
 */
export interface Report {
  line_index: number;
  quantity: number;
}

export interface SaleItem extends SaleLine {
  id: string;
  final_unit_price: string;
  line_total: string;
  display_name: string;
}

export interface Sale {
  id: string;
  store_id: string;
  currency_code: string;
  subtotal: string;
  discount_total: string;
  total: string;
  items: SaleItem[];
  corrections: string[];
  shortages: string[];
  size_reclassifications: string[];
}

/**
 * What `POST /shelf-shortages` recorded: nothing in the basket was on the
 * shelf, so nothing was sold, and the ledger took off what it believed in
 * (owner decision, 2026-10-01; Q-G).
 */
export interface EmptyShelf {
  id: string;
  store_id: string;
  command_id: string;
  recorded_at: string;
  lines: {
    source_location_id: string;
    product_variant_id: string;
    size_id: string;
    display_name: string;
    size: string | null;
    requested: number;
    removed: number;
  }[];
}

/** The `details` of an `INSUFFICIENT_STOCK` refusal. */
export interface Shortfall {
  location_id: string;
  product_variant_id: string;
  size_id: string;
  requested: number;
  available: number;
  correctable: boolean;
}

export function shortfallOf(details: Record<string, unknown>): Shortfall | null {
  const {
    location_id,
    product_variant_id,
    size_id,
    requested,
    available,
    correctable,
  } = details;
  if (
    typeof location_id !== "string" ||
    typeof product_variant_id !== "string" ||
    typeof size_id !== "string" ||
    typeof requested !== "number" ||
    typeof available !== "number" ||
    typeof correctable !== "boolean"
  )
    return null;
  return {
    location_id,
    product_variant_id,
    size_id,
    requested,
    available,
    correctable,
  };
}

export function stockKey(line: {
  source_location_id: string;
  product_variant_id: string;
  size_id: string;
}): string {
  return `${line.source_location_id}:${line.product_variant_id}:${line.size_id}`;
}
