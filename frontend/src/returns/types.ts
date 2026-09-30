/** `GET /sales`: a store's sales, newest first, as a seller looks one up. */
export interface SaleLine {
  id: string;
  display_name: string;
  /** As the receipt recorded it; "UNKNOWN" for goods sold without a size. */
  size: string | null;
  source_location_id: string;
  quantity: number;
  final_unit_price: string;
  line_total: string;
  /** Already come back, in every part and condition. */
  refunded: number;
}

export interface SaleSummary {
  id: string;
  sold_at: string;
  currency_code: string;
  total: string;
  items: SaleLine[];
}

export interface SaleList {
  sales: SaleSummary[];
  has_more: boolean;
}

export type Condition = "INTACT" | "DAMAGED";

export interface ReturnPart {
  sale_item_id: string;
  quantity: number;
  restock: true;
  condition: Condition;
}

/**
 * What the journal keeps. `store_id` and `sale_id` are the journal's own:
 * the server takes the sale from the path and the store from the sale.
 */
export interface ReturnBody {
  store_id: string;
  sale_id: string;
  command_id: string;
  lines: ReturnPart[];
  reason: string | null;
}

export interface Refund {
  id: string;
  sale_id: string;
  total_amount: string;
  items: {
    sale_item_id: string;
    quantity: number;
    amount: string;
    condition: Condition | null;
    destination_location_id: string | null;
    display_name: string;
  }[];
}

export function sizeLabel(size: string | null): string {
  return size === null || size === "UNKNOWN" ? "розмір невідомий" : size;
}
