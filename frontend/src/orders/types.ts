export interface Store {
  id: string;
  name: string;
  code: string;
  permissions: string[];
}
export interface Me {
  user_id: string;
  organization_id: string;
  display_name: string;
  stores: Store[];
}
export interface Location {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  can_sell: boolean;
  can_receive: boolean;
}
export interface StockOption {
  product_variant_id: string;
  size_id: string;
  display_name: string;
  size_label: string;
  size_is_unknown: boolean;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}
export interface Line {
  product_variant_id: string;
  size_id: string;
  source_location_id: string;
  quantity: number;
  unit_price: string;
  discount_amount: string;
}
export interface OrderItem extends Line {
  id: string;
  display_name: string;
  size_label: string | null;
}
export type Status =
  | "READY_TO_DISPATCH"
  | "DISPATCHED"
  | "ARRIVED"
  | "COLLECTED"
  | "CANCELLED"
  | "RETURNED";
export interface Order {
  id: string;
  store_id: string;
  status: Status;
  sale_id: string | null;
  currency_code: string;
  total: string;
  created_at: string | null;
  items: OrderItem[];
}
export const statusLabels: Record<Status, string> = {
  READY_TO_DISPATCH: "До відправлення",
  DISPATCHED: "Відправлено",
  ARRIVED: "Прибув на пошту",
  COLLECTED: "Клієнт забрав",
  CANCELLED: "Скасовано",
  RETURNED: "Повернено на склад",
};
export function kopecks(value: string): bigint | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function decimal(value: bigint): string {
  return `${(value / 100n).toString()}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function money(value: string): string {
  const parsed = kopecks(value);
  return parsed === null ? "—" : `${decimal(parsed).replace(".", ",")} грн`;
}
