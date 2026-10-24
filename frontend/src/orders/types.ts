import type { PaymentMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";

/**
 * Whether a store trades (owner decisions, 2026-10-01). A blocked or archived
 * one does nothing: the owner and the network's managers read it, and its
 * own people learn only its state and since when.
 */
export type StoreState = "ACTIVE" | "BLOCKED" | "ARCHIVED";

export interface Store {
  id: string;
  name: string;
  code: string;
  state: StoreState;
  /** When the state last changed; null when unknown. */
  state_since: string | null;
  /** In a store that does not trade: what this person may still read there. */
  permissions: string[];
}

/** What is read, never changed, by the permissions that open these screens. */
const reads = new Set([
  "sale:view",
  "inventory:view",
  "sale:credit",
  "damaged:handle",
  "report:view_financial",
]);

/**
 * The store as its screens should see it: one that does not trade keeps only
 * what opens a screen to read, so no button that changes anything is shown.
 * The server refuses those anyway (`STORE_NOT_TRADING`). The one write left
 * there, the network owner's close of its drawer (owner decision,
 * 2026-10-04), is offered from what they hold network-wide, never from
 * these.
 */
export function asShown(store: Store): Store {
  return store.state === "ACTIVE"
    ? store
    : {
        ...store,
        permissions: store.permissions.filter((permission) =>
          reads.has(permission),
        ),
      };
}

/** «Заблоковано власником з 01.10.2026», or «Закрито (архів) …». */
export function stateText(store: Pick<Store, "state" | "state_since">): string {
  const since = store.state_since
    ? ` з ${new Date(store.state_since).toLocaleDateString("uk-UA")}`
    : "";
  return store.state === "BLOCKED"
    ? `Заблоковано власником${since}`
    : store.state === "ARCHIVED"
      ? `Закрито, в архіві${since}`
      : "Працює";
}
export interface Me {
  user_id: string;
  organization_id: string;
  display_name: string;
  /** Held organization-wide, such as `backup:view`, which no store grants. */
  organization_permissions: string[];
  stores: Store[];
}
export interface Location {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  can_sell: boolean;
  can_receive: boolean;
  /** The store's «Брак»: damaged returns go here, and nothing sells from it. */
  damaged_returns: boolean;
  /**
   * Nothing has been recorded there yet: its opening list, typed or not, or
   * its first delivery is awaited (owner decisions, 2026-10-02 and
   * 2026-10-16). The till says to sell on paper and offers no coat from the
   * catalogue (redesign P1-5). Absent from a server before it said so.
   */
  awaiting_first_stock?: boolean;
}
export interface StockOption {
  /** Where it is: the warehouse asked for, or each the store sells from
   * when the till asks for all (sale-slice TZ, P2-5). */
  location_id: string;
  product_variant_id: string;
  size_id: string;
  display_name: string;
  size_label: string;
  size_is_unknown: boolean;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  // What this store's till suggests: its own price, else the shared one.
  suggested_price: string | null;
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
  /** A collected order paid in parts: what is paid and owed so far. */
  credit?: { credit_id: string; paid: string; owed: string } | null;
  /** Where it goes (owner decisions, 2026-10-01); none on an order made
   * before orders said so. */
  destination?: Destination | null;
  carrier?: Carrier | null;
  waybill?: string | null;
  abroad_note?: string | null;
  /** One order only: every version of where it went. */
  shipping_history?: ShippingChange[];
  /** One order only: the store's other orders with the same waybill. */
  same_waybill?: { id: string; status: Status }[];
  /** How a collected order was paid, said at «Клієнт забрав» (owner
   * decision, 2026-10-04); none before it was asked. */
  payment_method?: PaymentMethod | null;
}

/** What collecting records: the rest is in the ways' rows (orders task
 * list, P0-3) — the money given now, and what was paid ahead or goes
 * through the carrier. */
export const collectHint = "Продаж записуємо, коли покупець забрав товар.";
export type Destination = "UKRAINE" | "ABROAD";
export type Carrier = "NOVA_POSHTA" | "UKRPOSHTA" | "MEEST";
export const carrierLabels: Record<Carrier, string> = {
  NOVA_POSHTA: "Нова пошта",
  UKRPOSHTA: "Укрпошта",
  MEEST: "Міст",
};
export interface Shipping {
  destination?: Destination | null;
  carrier?: Carrier | null;
  waybill?: string | null;
  abroad_note?: string | null;
}
export interface ShippingChange extends Shipping {
  kind: "CREATED" | "DISPATCHED" | "CORRECTED";
  by: string;
  at: string;
}
/** How an order goes, in a line: «Нова пошта · ТТН 2045…», «За кордон · …». */
export function shippingText(shipping: Shipping): string {
  if (!shipping.destination) return "Доставку не вказано";
  if (shipping.destination === "ABROAD")
    return shipping.abroad_note
      ? `За кордон · ${visible(shipping.abroad_note)}`
      : "За кордон";
  const carrier = shipping.carrier ? carrierLabels[shipping.carrier] : "";
  return shipping.waybill
    ? `${carrier} · ТТН ${visible(shipping.waybill)}`
    : `${carrier} · ТТН ще немає`;
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
/** «1 850,00 грн»: thousands apart by a no-break space, so the figure never
 * breaks across lines (sale-slice TZ, P2-1). An input keeps «1850,50»,
 * which `kopecks()` reads. */
export function money(value: string): string {
  const parsed = kopecks(value);
  if (parsed === null) return "—";
  const [whole = "0", fraction = "00"] = decimal(parsed).split(".");
  return `${whole.replace(/\B(?=(\d{3})+$)/g, "\u00a0")},${fraction} грн`;
}
