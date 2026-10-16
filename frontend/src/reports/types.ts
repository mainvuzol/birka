import type { PaymentMethod } from "@/shared/payment";

// The sales report (owner decisions, 2026-10-02), as `/reports/sales` and its
// two lists answer it. Money is a decimal string, as everywhere. Since
// 2026-10-04 the money is split by the way it was paid (ADR-0012 §B11).

// One of the till's ways. «Не вказано» is money recorded before the way was
// asked: never guessed (owner decision, 2026-10-04).
export interface WayFigures {
  method: "CASH" | "CARD" | "TRANSFER" | "NOT_STATED";
  came_in: string;
  went_out: string;
  // Moved to this way by corrections made in these days, less moved from it.
  corrected: string;
  net: string;
}

// An order paid off the till: in advance by transfer, or cash on delivery.
// Nothing is ever handed back this way.
export interface OffTillFigures {
  came_in: string;
  corrected: string;
  net: string;
}

export interface Figures {
  sales: number;
  units: number;
  sold: string;
  returns: number;
  returned_units: number;
  returned: string;
  // Sold, less what came back.
  net: string;
  // The till's money: an order paid off the till is in none of these.
  paid_in_full: string;
  debt_payments: string;
  paid_back: string;
  // What corrections moved into the till from an order's ways, less out.
  corrected_into_till: string;
  // What went through the till in these days, «Разом»: the four ways' net add
  // up to it.
  money: string;
  // Cash, card, transfer and «не вказано»: always these four, in this order.
  ways: WayFigures[];
  // Outside «Разом» (owner decision, 2026-10-04).
  off_till: { prepaid_transfer: OffTillFigures; carrier_cod: OffTillFigures };
}

export interface StoreFigures extends Figures {
  store_id: string;
  store_name: string;
  store_state: "ACTIVE" | "BLOCKED" | "ARCHIVED";
}

export interface Period {
  date_from: string;
  date_to: string;
  today: string;
}

export interface SalesReport extends Period {
  currency_code: string;
  stores: StoreFigures[];
  // The stores together, for whoever sees more than one.
  total: Figures | null;
}

export interface ModelFigures {
  product_variant_id: string;
  display_name: string;
  units: number;
  sold: string;
  returned_units: number;
  returned: string;
}

export interface Models extends Period {
  models: ModelFigures[];
}

export interface Entry {
  kind: "SALE" | "RETURN";
  id: string;
  sale_id: string;
  at: string;
  // The store that sold.
  store_id: string;
  store_name: string;
  // A return: the store that took it and handed the money back.
  taken_at_store_id: string | null;
  taken_at_store_name: string | null;
  by: string;
  units: number;
  amount: string;
  // The money it moved: in for a sale, out for a return.
  money: string;
  // As stated when the money moved; null for «не вказано», and for a return
  // that only lowered a debt.
  payment_method: PaymentMethod | null;
  // The way now, when a correction changed it; null when none did.
  method_now: PaymentMethod | null;
  paid_in_parts: boolean;
  goods: string[];
  // A sale typed from paper, «продано під час збою» (ADR-0013 §5.6): who sold
  // and the paper's time, each null when the paper named none; `by` above is
  // still whoever typed it. A return typed from paper carries it too (owner
  // decision, 2026-10-10; ADR-0021): `sold_by` is then who took it back.
  // Null on every other entry.
  outage?: {
    sold_by: string | null;
    sold_at: string | null;
    // «З паперу», the first days' paper (owner decisions, 2026-10-15 and
    // 2026-10-16); absent from a server before it said so.
    first_days?: boolean;
  } | null;
}

export interface Entries extends Period {
  entries: Entry[];
  has_more: boolean;
}

// Days as the server names them, YYYY-MM-DD. Counted in UTC so that no
// clock of the phone's moves them.
function day(value: string): Date {
  const [year = 0, month = 1, date = 1] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function daysBefore(value: string, days: number): string {
  const moved = day(value);
  moved.setUTCDate(moved.getUTCDate() - days);
  return iso(moved);
}

// The week starts on Monday.
export function weekStart(value: string): string {
  return daysBefore(value, (day(value).getUTCDay() + 6) % 7);
}

export function monthStart(value: string): string {
  return `${value.slice(0, 8)}01`;
}

export function dayText(value: string): string {
  return day(value).toLocaleDateString("uk-UA", { timeZone: "UTC" });
}
