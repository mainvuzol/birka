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
  /**
   * Whether intact goods taken back here go back to the warehouse they were
   * sold from. Not for another store's own warehouse: the seller then
   * chooses one of this store's (owner decision, 2026-10-01).
   */
  back_to_sold_from: boolean;
}

export interface SaleSummary {
  id: string;
  /** The store that sold it: another store's, for a return taken here. */
  store_id: string;
  store_name: string;
  sold_at: string;
  currency_code: string;
  total: string;
  /**
   * Paid in parts: a return lowers the debt first, and the refund's answer
   * says how much goes back in cash.
   */
  paid_in_parts: boolean;
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
  /** Intact goods sold from a warehouse this store does not reach: where to. */
  location_id?: string;
}

/**
 * What the journal keeps. `store_id` and `sale_id` are the journal's own:
 * the server takes the sale from the path and the store from the sale —
 * unless the sale is another store's, when `store_id` names this store as
 * the one taking the goods back (owner decisions, 2026-10-01).
 */
export interface ReturnBody {
  store_id: string;
  sale_id: string;
  command_id: string;
  lines: ReturnPart[];
  reason: string | null;
  /** The sale is another store's. Absent from attempts written before. */
  elsewhere?: boolean;
}

export interface Refund {
  id: string;
  sale_id: string;
  /** The store that sold. */
  store_id: string;
  /** The store that took the goods back and handed the money back. */
  taken_at_store_id?: string | null;
  total_amount: string;
  items: {
    sale_item_id: string;
    quantity: number;
    amount: string;
    condition: Condition | null;
    destination_location_id: string | null;
    display_name: string;
  }[];
  /** For a sale paid in parts: how the goods' worth was settled. */
  credit?: CreditSettlement | null;
}

/**
 * Returned goods first lower what is owed; money goes back only when the
 * customer has paid more than the goods they keep are worth (owner decision,
 * 2026-10-01).
 */
export interface CreditSettlement {
  debt_reduced: string;
  cash_back: string;
  owed_after: string;
}

export function sizeLabel(size: string | null): string {
  return size === null || size === "UNKNOWN" ? "розмір невідомий" : size;
}
