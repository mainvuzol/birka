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
  cancelled: { reason: string; by: string; at: string } | null;
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
