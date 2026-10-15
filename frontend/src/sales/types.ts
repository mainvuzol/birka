import type { Line } from "@/orders/types";
import type { PaymentMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";

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
  /** The size as the receipt froze it, «UNKNOWN» for one not known; absent
   * from answers stored before it was given (redesign P1-1). */
  size?: string | null;
}

/** Coats sold with the size read off their label. */
export interface Clarified {
  size: string;
  quantity: number;
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
  /**
   * The corrections above in units, counted by the server from what it wrote
   * (redesign P1-1): found on the shelf, written off as missing, sold with a
   * size read off a label. Absent from answers stored before them.
   */
  found_quantity?: number | null;
  missing_quantity?: number | null;
  clarified?: Clarified[] | null;
  /** A sale paid in parts: what was paid now and what is owed. */
  credit?: SaleCredit | null;
  /**
   * How the customer paid: the button the seller pressed (owner decision,
   * 2026-10-04; ADR-0012 §B10). For a sale paid in parts, how the part paid
   * now was paid. Absent or null on an answer recorded before the way was
   * asked, whose receipt then names no way.
   */
  payment_method?: PaymentMethod | null;
  /**
   * The mark «продано під час збою» of a sale typed from paper (ADR-0013
   * §5.6). Absent or null on every other sale, and on an answer recorded
   * before the mark existed.
   */
  outage?: OutageMark | null;
}

/**
 * What the till sends for a sale typed from paper (ADR-0013 §5.2): who sold,
 * one of the store's sellers, and the paper's time as the store's wall clock,
 * `YYYY-MM-DDTHH:MM`, today or yesterday (owner decision, 2026-10-07). Both
 * optional: null says nobody or no time was named.
 */
export interface OutageBody {
  sold_by_user_id: string | null;
  sold_at: string | null;
}

/**
 * The mark as the server shows it (ADR-0013 §5.6): the person's name as it
 * was when the sale was typed, and the paper's time as a moment.
 */
export interface OutageMark {
  sold_by_user_id: string | null;
  sold_by: string | null;
  sold_at: string | null;
}

/**
 * «Продано під час збою · продавець: Марина · за папером 06.10, 19:40», as
 * the receipt, the confirmation, the sales list and «Звіт» write it, by the
 * phone's own clock. What the paper did not name is left out.
 */
export function markText(mark: {
  sold_by: string | null;
  sold_at: string | null;
}): string {
  const parts = ["Продано під час збою"];
  if (mark.sold_by !== null) parts.push(`продавець: ${visible(mark.sold_by)}`);
  if (mark.sold_at !== null && !Number.isNaN(Date.parse(mark.sold_at))) {
    const at = new Date(mark.sold_at);
    parts.push(
      `за папером ${at.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}, ${at.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`,
    );
  }
  return parts.join(" · ");
}

/**
 * The money line of a sale paid during the outage, by card or transfer (owner
 * decision, 2026-10-07; ADR-0013 §5.6): the customer is gone and a second
 * charge is the risk, so it never says to charge the terminal. Cash says
 * nothing more; neither does a way the till does not take.
 */
export function paidDuringOutage(way: PaymentMethod): string | null {
  switch (way) {
    case "CARD":
      return "оплату провели під час збою, на терміналі не проводьте ще раз";
    case "TRANSFER":
      return "отримано під час збою, звірте з папером";
    default:
      return null;
  }
}

/**
 * What a sale paid in parts left owing (owner decisions, 2026-10-01). No name
 * or phone: a receipt is read more widely than the store's debts are.
 */
export interface SaleCredit {
  credit_id: string;
  paid_now: string;
  owed: string;
}

/** The customer takes the goods now, pays `paid_now` and owes the rest. */
export interface CreditTerms {
  customer_name: string;
  customer_phone: string;
  paid_now: string;
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
  /**
   * Units of this key are reserved for an order (ADR-0013 §6). Absent from a
   * refusal of a server that did not say it yet: read as not.
   */
  reserved?: boolean;
}

export function shortfallOf(
  details: Record<string, unknown>,
): Shortfall | null {
  const {
    location_id,
    product_variant_id,
    size_id,
    requested,
    available,
    correctable,
    reserved,
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
    ...(typeof reserved === "boolean" ? { reserved } : {}),
  };
}

export function stockKey(line: {
  source_location_id: string;
  product_variant_id: string;
  size_id: string;
}): string {
  return `${line.source_location_id}:${line.product_variant_id}:${line.size_id}`;
}
