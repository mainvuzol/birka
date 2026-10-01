/** How the goods came to be here. The three a delivery may say (ADR-0005). */
export type Acquisition = "PURCHASE" | "CONSIGNMENT" | "BORROWED";

export const acquisitionLabels: Record<Acquisition, string> = {
  PURCHASE: "Закупівля",
  CONSIGNMENT: "Під реалізацію",
  BORROWED: "Позичено",
};

export interface ReceiptLine {
  product_variant_id: string;
  size_id: string;
  quantity: number;
  acquisition_type: Acquisition;
  /** What the shop paid for one unit, `"1850.50"`, or null when not stated. */
  unit_cost: string | null;
}

export interface ReceiptBody {
  store_id: string;
  location_id: string;
  command_id: string;
  lines: ReceiptLine[];
  notes: string | null;
  /** Whose goods: sent when any are borrowed or under consignment. */
  supplier_id?: string;
}

/** Goods owed for only once sold (owner decisions, 2026-10-01). */
export function paidWhenSold(acquisition: Acquisition): boolean {
  return acquisition === "BORROWED" || acquisition === "CONSIGNMENT";
}

export interface ReceivedLine {
  location_id: string;
  product_variant_id: string;
  size_id: string;
  quantity_received: number;
  quantity_after: number;
  stock_lot_id: string;
  movement_id: string;
  /** As stored on the lot, which is what the screen shows back. */
  unit_cost: string | null;
  currency_code: string | null;
}

export interface Receipt {
  id: string;
  store_id: string;
  lines: ReceivedLine[];
}

export interface ReceivableVariant {
  product_variant_id: string;
  display_name: string;
}

export interface SizeOption {
  size_id: string;
  code: string;
  system: string;
}
