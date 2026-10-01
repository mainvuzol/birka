import type { StoreState } from "@/orders/types";

/** `GET /credits`: a store's debts — sales paid in parts (owner decisions, 2026-10-01). */
export type CreditStatus = "OPEN" | "SETTLED" | "WRITTEN_OFF";

export type EntryKind = "PAYMENT" | "RETURN" | "WRITE_OFF";

export interface CreditEntry {
  kind: EntryKind;
  amount: string;
  /** For a return: how much of `amount` went back in cash. */
  cash_back: string;
  at: string;
  by: string;
  note: string | null;
  /** A payment another store took, because the one that sold did not trade. */
  taken_at: string | null;
}

export interface Credit {
  id: string;
  sale_id: string;
  store_id: string;
  /** The store that sold, and whether it trades: while it does not, any
   * store of the network that trades takes the payments. */
  store_name: string;
  store_state: StoreState;
  customer_name: string;
  customer_phone: string;
  /** What was agreed: the sale's total. */
  amount: string;
  currency_code: string;
  status: CreditStatus;
  paid: string;
  /** The worth of goods brought back, of which `cash_back` went back in cash. */
  returned: string;
  cash_back: string;
  written_off: string;
  owed: string;
  opened_at: string;
  last_payment_at: string | null;
  closed_at: string | null;
  goods: string[];
  entries: CreditEntry[];
}

export interface CreditPage {
  items: Credit[];
  has_more: boolean;
}

/**
 * `GET /credits/customers`: one customer's debts in the store. One phone is
 * one customer (owner decision, 2026-10-01), however each sale wrote the name.
 */
export interface Customer {
  /** The number in its own ten digits for a Ukrainian one. */
  phone_digits: string;
  /** As the newest of these debts wrote them. */
  customer_name: string;
  customer_phone: string;
  owed: string;
  open_debts: number;
  credits: Credit[];
}

export interface CustomerPage {
  items: Customer[];
  has_more: boolean;
}

/** `GET /credits/summary`: what the store is owed now, by store only. */
export interface StoreDebts {
  owed: string;
  customers: number;
  debts: number;
}

/**
 * What the journal keeps of a payment or a write-off. `store_id` and
 * `credit_id` are the journal's own: the server takes the debt from the path
 * and the store from the debt — except for a payment `elsewhere`, taken by
 * this store for one that does not trade, which names it.
 */
export type CreditBody =
  | {
      kind: "payment";
      store_id: string;
      credit_id: string;
      command_id: string;
      amount: string;
      elsewhere?: boolean;
    }
  | {
      kind: "write-off";
      store_id: string;
      credit_id: string;
      command_id: string;
      reason: string;
    };

/** The customer's phone has 10 to 15 digits, written however (the server's rule). */
export function phoneDigits(phone: string): number {
  return phone.replace(/\D/g, "").length;
}

export const statusLabels: Record<CreditStatus, string> = {
  OPEN: "Винні",
  SETTLED: "Сплачено",
  WRITTEN_OFF: "Списано",
};
