/**
 * How a customer paid (owner decision, 2026-10-04; ADR-0012 §B1): one way for
 * each payment, never split between cash and card. The same values as the
 * server's `PaymentMethod`.
 *
 * The till, a debt payment and money handed back on a return take one of the
 * three till ways. The two others are an order's only, given at «Клієнт
 * забрав»: paid in advance by transfer, or cash on delivery through the
 * carrier. Only cash goes through the drawer.
 */
export type PaymentMethod =
  "CASH" | "CARD" | "TRANSFER" | "PREPAID_TRANSFER" | "CARRIER_COD";

/**
 * A till way: what a sale at the till, a debt payment and money handed back on
 * a return take (ADR-0012 §B1).
 */
export type TillMethod = "CASH" | "CARD" | "TRANSFER";

/** The till's ways, in the order of its buttons: «Готівка», «Картка», «Переказ». */
export const tillMethods: readonly TillMethod[] = ["CASH", "CARD", "TRANSFER"];

/**
 * Whether a value read back from the phone's storage is a till way. Storage is
 * untrusted: an attempt saved before the way was asked has none, and the
 * journals check it only when it is there (ADR-0012 §B12).
 */
export function isTillMethod(value: unknown): value is TillMethod {
  return value === "CASH" || value === "CARD" || value === "TRANSFER";
}

/** A way's name on its button and in a history line. */
export const methodLabels: Record<PaymentMethod, string> = {
  CASH: "Готівка",
  CARD: "Картка",
  TRANSFER: "Переказ",
  PREPAID_TRANSFER: "Переказ наперед",
  CARRIER_COD: "Накладений платіж",
};

/** How a sum was paid, after it: «Сплачено зараз 1 000,00 грн готівкою». */
export const methodHow: Record<PaymentMethod, string> = {
  CASH: "готівкою",
  CARD: "карткою",
  TRANSFER: "переказом",
  PREPAID_TRANSFER: "переказом наперед",
  CARRIER_COD: "накладеним платежем",
};

/**
 * How money goes back on a return, after its sum: «Повернути покупцю
 * 3 000,00 грн на картку». Only the till's ways hand money back.
 */
export const refundHow: Record<TillMethod, string> = {
  CASH: "готівкою",
  CARD: "на картку",
  TRANSFER: "переказом",
};

/**
 * A payment recorded before the way was asked: nothing tells how it was
 * paid, and nothing is guessed (owner decision, 2026-10-04).
 */
export const notStated = "не вказано";
