import type { StoreState } from "@/orders/types";
import { tillMethods } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";

/**
 * The drawer, as the server answers for it (ADR-0012, B10). Money is a
 * string with two decimals, as everywhere; a difference or a correction's
 * cash may be negative («-150.00»).
 */

/** The money row a correction names: the money taken with a sale (paid in
 * full, or its first payment when paid in parts), a payment toward a debt,
 * or money handed back on a return. */
export type Target = "SALE" | "PAYMENT" | "REFUND";

export const targets: readonly Target[] = ["SALE", "PAYMENT", "REFUND"];

/** What each kind of operation is called. */
export const targetLabels: Record<Target, string> = {
  SALE: "Продаж",
  PAYMENT: "Внесок",
  REFUND: "Повернення",
};

/** One operation whose way is to be changed: the receipt's sale, or one
 * chosen from a list, with its moment when the list said it. */
export interface FixTarget {
  target: Target;
  id: string;
  at?: string;
}

/** Why cash left the drawer, or came into it (owner decisions, 2026-10-04).
 * There is no «Інше» (G17). */
export type MovementKind = "OWNER" | "EXPENSES" | "SUPPLIER_COURIER" | "CHANGE";

export const movementKinds: readonly MovementKind[] = [
  "OWNER",
  "EXPENSES",
  "SUPPLIER_COURIER",
  "CHANGE",
];

export const movementLabels: Record<MovementKind, string> = {
  OWNER: "Власнику",
  EXPENSES: "Витрати",
  SUPPLIER_COURIER: "Кур’єру постачальника",
  // A kind, as «Витрати» is; its row says «Внесено · розмін» (cash task
  // list, §9).
  CHANGE: "Розмін",
};

/** Only change brought in puts cash into the drawer. */
export function directionOf(kind: MovementKind): "OUT" | "IN" {
  return kind === "CHANGE" ? "IN" : "OUT";
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    value === "CASH" ||
    value === "CARD" ||
    value === "TRANSFER" ||
    value === "PREPAID_TRANSFER" ||
    value === "CARRIER_COD"
  );
}

/** One way's money since the previous close: card and transfer are shown to
 * compare by eye with the terminal's slip, never counted (owner decision). */
export interface WaySums {
  came_in: string;
  went_out: string;
  corrected: string;
  net: string;
}

/** What explains a closed close's difference: a correction of one of its
 * money rows, or cash taken out or put in before it and recorded later. */
export interface Explanation {
  kind: "CORRECTION" | "TAKE_OUT" | "PUT_IN";
  at: string;
  by: string;
  cash: string;
  text: string;
}

export interface CloseBrief {
  id: string;
  number: number;
  business_day: string;
  closed_at: string;
  closed_by: string;
  mine: boolean;
}

/**
 * One close. A seller sees their own close only, and only what their count
 * needs (G27): the fields marked * are then null or empty.
 */
export interface Close extends CloseBrief {
  store_id: string;
  store_name: string;
  /** Nothing to compare with: the first count, or the first after the
   * store came back from the archive (G6, G30). */
  opening: boolean;
  since: string | null;
  counted: string;
  expected: string | null;
  difference: string | null;
  card: WaySums;
  transfer: WaySums;
  unclosed_days: string[];
  reason: string | null;
  reason_by: string | null;
  /** A difference of 1,00 грн or more, which needs a reason (G41). Still
   * true once the reason is written: `reason` says whether it is. */
  reason_required: boolean;
  opening_float: string | null; // *
  cash_in: string | null; // *
  cash_out: string | null; // *
  taken_out: string | null; // *
  put_in: string | null; // *
  cash_corrected: string | null; // *
  prepaid_transfer: string | null; // *
  carrier_cod: string | null; // *
  not_stated: WaySums | null; // *
  explained: string | null; // *
  unexplained: string | null; // *
  explanations: Explanation[]; // *
}

export interface Movement {
  id: string;
  store_id: string;
  kind: MovementKind;
  direction: "OUT" | "IN";
  amount: string;
  note: string | null;
  at: string;
  by: string;
  /** The close this cash moved before: it explains that close. */
  for_close_id: string | null;
  for_day: string | null;
  /** Put on that close because a colleague closed before this phone's
   * record arrived (B5), not by a person. */
  moved_to_close: boolean;
}

/** `GET /cash/drawer`: never an expected sum, nor any of the period's sums. */
export interface Drawer {
  store_id: string;
  store_name: string;
  store_state: StoreState;
  /** None yet: the next close is an opening count. */
  last_close: CloseBrief | null;
  next_is_opening: boolean;
  closed_today: boolean;
  may_close: boolean;
  movement_kinds: MovementKind[];
  may_correct: boolean;
  /** A seller's own of the open period; everything for the owner and managers. */
  movements: Movement[];
  unclosed_days: string[];
  /** The caller's own newest close with a difference and no reason: until
   * it is written, every tab but «Каса» waits (G12). */
  reason_owed: CloseBrief | null;
}

export interface ClosePage {
  items: Close[];
  has_more: boolean;
}

export interface Correction {
  id: string;
  seq: number;
  store_id: string;
  target: Target;
  target_id: string;
  amount: string;
  direction: "IN" | "OUT";
  from_method: PaymentMethod | null;
  to_method: PaymentMethod;
  explains_close_id: string | null;
  explains_day: string | null;
  at: string;
  by: string;
  note: string | null;
}

/** A money event of one day at the drawer, with its sum and way: the owner's
 * and managers' only. `label` names goods, never a customer. */
export interface DayEvent {
  target: Target;
  target_id: string;
  at: string;
  by: string;
  amount: string;
  direction: "IN" | "OUT";
  stated_method: PaymentMethod | null;
  method: PaymentMethod | null;
  corrected: boolean;
  closed: boolean;
  label: string;
  is_order: boolean;
  may_change: boolean;
}

export interface EventPage {
  items: DayEvent[];
}

/**
 * One of the seller's own operations of the open period: a sale, a debt
 * payment or a return (owner decision, 2026-10-04, G16). Time and goods
 * only — no sum, no way, so the list tells them nothing of what the drawer
 * should hold (G32).
 */
export interface MineEvent {
  target: Target;
  target_id: string;
  at: string;
  label: string;
}

export interface MinePage {
  items: MineEvent[];
}

/** The money of one chosen operation: its sum and its way now. */
export interface EventMethod {
  target: Target;
  target_id: string;
  amount_taken: string;
  method: PaymentMethod | null;
  corrected: boolean;
  /** Whether the caller may change it now. */
  may_change: boolean;
  /** A collected order's sale takes the order ways too (B6.1). */
  is_order: boolean;
}

/**
 * What the journal keeps of each command (`@/shared/journal`). `store_id` is
 * the store the screen is in, which the journal is kept under; what is sent
 * is cut from it (`./commands`).
 */
export type CashBody =
  | {
      command: "close";
      store_id: string;
      command_id: string;
      counted: string;
      /** The phone's clock at «Так, закрити»: the age of the count is
       * worked out from it at each send (B4 step 5). */
      counted_at: string;
      /** The newest close the count screen showed. */
      after_close_id: string | null;
    }
  | {
      command: "reason";
      store_id: string;
      command_id: string;
      close_id: string;
      reason: string;
    }
  | {
      command: "movement";
      store_id: string;
      command_id: string;
      movement_kind: MovementKind;
      amount: string;
      note: string | null;
      after_close_id: string | null;
      /** Named by a person holding `cash:correct`: cash moved before that
       * close and recorded late. */
      for_close_id?: string;
    }
  | {
      command: "correction";
      store_id: string;
      command_id: string;
      target: Target;
      target_id: string;
      from_method: PaymentMethod | null;
      to_method: PaymentMethod;
      note: string | null;
    };

export type CashAnswer = Close | Movement | Correction;

/** The ways a correction may set: the till's, and for a collected order's
 * sale the order ways too (B6.1). */
export function waysFor(isOrder: boolean): readonly PaymentMethod[] {
  return isOrder
    ? ["PREPAID_TRANSFER", "CARRIER_COD", ...tillMethods]
    : tillMethods;
}
