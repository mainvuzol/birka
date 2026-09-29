import type { Line } from "@/orders/types";

/** A sale line is shaped exactly like an order line; the command differs. */
export type SaleLine = Line;

/**
 * One of the two in-sale corrections, both `{line_index, quantity}` on the wire.
 *
 * Their `quantity` means opposite things and neither is a shortage:
 * `found_in_store` carries how many units to add to the shelf, bounded by the
 * line's shortfall; `missing_in_store` carries how many units are **present**,
 * and the server takes the difference it believed in off the shelf.
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
