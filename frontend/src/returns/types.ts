import type { PaymentMethod, TillMethod } from "@/shared/payment";

/**
 * `GET /sales`: a store's sales, newest first, as a seller looks one up. It
 * never says how a sale was paid: a seller pages through it before their
 * count (ADR-0012 G32). The way of the one sale being returned is asked for
 * alone (`SaleMethod`).
 */
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
  /**
   * How the money goes back (owner decision, 2026-10-04; ADR-0012 §B2).
   * Absent from an attempt written down before it was asked, which is resent
   * as stored; and may be absent for a sale paid in parts, whose return asks
   * it only when money goes back (G35).
   */
  payment_method?: TillMethod;
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
  /**
   * How the money went back. Absent or null on an answer recorded before
   * the way was asked, and on a return that only lowered a debt (G35).
   */
  payment_method?: TillMethod | null;
}

/**
 * `GET /cash/sales/{id}/method`: the money taken with the one sale being
 * returned (ADR-0012 §B10, G32), and the way a return suggests: the sale's
 * own, «Переказом» for an order paid in advance or on delivery (G4), none for
 * a sale in parts paid several ways or an old sale (G5).
 */
export interface SaleMethod {
  sale_id: string;
  target: "SALE" | "PAYMENT";
  target_id: string;
  amount_taken: string;
  method: PaymentMethod | null;
  corrected: boolean;
  refund_method: PaymentMethod | null;
  may_change: boolean;
}

/** The choices of «Як повертаємо гроші». */
export const refundLabels: Record<TillMethod, string> = {
  CASH: "Готівкою",
  CARD: "На картку",
  TRANSFER: "Переказом",
};

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
