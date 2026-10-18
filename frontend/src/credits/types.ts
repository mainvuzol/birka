import type { StoreState } from "@/orders/types";
import type { PaymentMethod, TillMethod } from "@/shared/payment";
import type { PaperBody, PaperView } from "@/sales/paperMark";

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
  /**
   * How it was paid, as it stands now (owner decision, 2026-10-04; ADR-0012
   * §B10): a payment's way, or for a return how its money went back. Null
   * when nothing says: recorded before the way was asked, a return that only
   * lowered the debt, a write-off.
   */
  payment_method: PaymentMethod | null;
  /** The way was corrected after it was recorded. */
  corrected: boolean;
  /**
   * A payment typed from paper (owner decision, 2026-10-10; ADR-0021): who
   * took it and when, as the paper says; `by` is who typed it.
   */
  outage?: PaperView | null;
}

export interface Credit {
  id: string;
  sale_id: string;
  store_id: string;
  /** The store that sold, and whether it trades: while it does not, any
   * store of the network that trades takes the payments. */
  store_name: string;
  store_state: StoreState;
  /**
   * Null once the customer is erased: a year after the debt was paid or
   * returned, three after it was written off, or at once by the network's
   * owner when the customer asks (owner decisions, 2026-10-09; ADR-0015).
   */
  customer_name: string | null;
  customer_phone: string | null;
  customer_erased_at: string | null;
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
  /**
   * The number in its own ten digits for a Ukrainian one. Null for a debt
   * whose customer is erased, which stands alone.
   */
  phone_digits: string | null;
  /** As the newest of these debts wrote them. */
  customer_name: string | null;
  customer_phone: string | null;
  owed: string;
  open_debts: number;
  credits: Credit[];
}

export interface CustomerPage {
  items: Customer[];
  has_more: boolean;
}

/** `POST /credits/{id}/erase-customer`: what the owner's erasure did. */
export interface Erasure {
  /** Closed debts of the network whose customer was erased now. */
  erased: number;
  /** The customer's open debts within the same reach, which keep them. */
  still_open: number;
  /** The whole network (its owner's), or the debt's store alone (a store's owner's). */
  network: boolean;
  credit: Credit;
}

/** What a closed store's customer is found by: their whole phone. */
export const askForPhone =
  "Введіть повний номер телефону покупця, наприклад 067 123 45 67. За іменем чи частиною номера борги інших магазинів не шукають.";

/** What an erased customer's debt reads instead of a name. */
export const erasedCustomer = "Покупця стерто";

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
      /**
       * How the customer pays (owner decision, 2026-10-04; ADR-0012 §B2).
       * Absent from an attempt written down before it was asked, which is
       * resent as stored.
       */
      payment_method?: TillMethod;
      /** Typed from paper (ADR-0021). Absent from a payment typed live. */
      outage?: PaperBody;
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
