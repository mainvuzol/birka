import type { StoreState } from "@/orders/types";

/** `GET /suppliers`: the network's suppliers (owner decision, 2026-10-01). */
export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
}

export interface ReturnLine {
  product_variant_id: string;
  size_id: string;
  quantity: number;
  display_name: string;
  size: string | null;
}

/** `GET /supplier-returns`: goods this store sent back to a supplier. */
export interface SupplierReturn {
  id: string;
  store_id: string;
  location_id: string;
  location_name: string;
  supplier: Supplier;
  /** A unit from «Брак»: its return is cancelled from there. */
  damaged_unit_id: string | null;
  note: string | null;
  by: string;
  at: string;
  lines: ReturnLine[];
  cancelled: Cancellation | null;
  /** What the supplier counts of it against invoices now. While any
   * stands, the return is not cancelled (owner decision, 2026-10-01). */
  set_offs: SetOff[];
}

export interface Cancellation {
  reason: string;
  by: string;
  at: string;
}

export interface SetOff {
  invoice_id: string;
  entry_id: string;
  amount: string;
  at: string;
}

export interface ReturnPage {
  items: SupplierReturn[];
  has_more: boolean;
}

/** What the journal keeps of a return from a warehouse, all of it sent. */
export interface ReturnBody {
  command_id: string;
  store_id: string;
  location_id: string;
  supplier_id: string;
  lines: { product_variant_id: string; size_id: string; quantity: number }[];
  note: string | null;
}

/**
 * `GET /supplier-invoices`: what the store owes a supplier for one invoice
 * (owner decisions, 2026-10-01). Recorded on its own, never with a delivery.
 */
export type InvoiceStatus = "OPEN" | "SETTLED" | "WRITTEN_OFF" | "CANCELLED";

export type InvoiceEntryKind = "PAYMENT" | "SET_OFF" | "WRITE_OFF";

export interface InvoiceEntry {
  id: string;
  kind: InvoiceEntryKind;
  amount: string;
  at: string;
  by: string;
  /** A write-off's reason. */
  note: string | null;
  /** A payment another store made, because the one that owes did not trade. */
  paid_at: string | null;
  /** A set-off: the return the supplier counted. */
  supplier_return_id: string | null;
  cancelled: Cancellation | null;
}

export interface Invoice {
  id: string;
  store_id: string;
  /** The store that owes, and whether it trades: while it does not, any
   * store of the network that trades pays. */
  store_name: string;
  store_state: StoreState;
  supplier: Supplier;
  /** The sum on the invoice, never changed. */
  amount: string;
  currency_code: string;
  note: string | null;
  status: InvoiceStatus;
  paid: string;
  set_off: string;
  written_off: string;
  owed: string;
  by: string;
  at: string;
  last_payment_at: string | null;
  closed_at: string | null;
  cancelled: Cancellation | null;
  entries: InvoiceEntry[];
}

export interface InvoicePage {
  items: Invoice[];
  has_more: boolean;
}

/** `GET /supplier-invoices/summary`: what the store owes its suppliers now. */
export interface SupplierDebts {
  owed: string;
  invoices: number;
  suppliers: { supplier: Supplier; owed: string; invoices: number }[];
}

/**
 * What the journal keeps of a command that records money. `store_id` is
 * the store worked in; a payment for a store that does not trade says so
 * with `elsewhere`.
 */
export type InvoiceBody =
  | {
      kind: "invoice";
      command_id: string;
      store_id: string;
      supplier_id: string;
      amount: string;
      paid_now: string;
      note: string | null;
    }
  | {
      kind: "payment";
      command_id: string;
      store_id: string;
      invoice_id: string;
      amount: string;
      elsewhere?: boolean;
    }
  | {
      kind: "set-off";
      command_id: string;
      store_id: string;
      invoice_id: string;
      supplier_return_id: string;
      amount: string;
    }
  | {
      kind: "write-off";
      command_id: string;
      store_id: string;
      invoice_id: string;
      reason: string;
    };
