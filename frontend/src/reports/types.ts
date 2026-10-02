// The sales report (owner decisions, 2026-10-02), as `/reports/sales` and its
// two lists answer it. Money is a decimal string, as everywhere.

export interface Figures {
  sales: number;
  units: number;
  sold: string;
  returns: number;
  returned_units: number;
  returned: string;
  // Sold, less what came back.
  net: string;
  paid_in_full: string;
  debt_payments: string;
  paid_back: string;
  // What the till should hold from these days.
  cash: string;
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
  // Into the till for a sale, out of it for a return.
  cash: string;
  paid_in_parts: boolean;
  goods: string[];
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
