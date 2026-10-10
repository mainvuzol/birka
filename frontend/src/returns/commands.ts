import { isId, isRecord, journal } from "@/shared/journal";
import { isTillMethod } from "@/shared/payment";
import { isPaperBody } from "@/sales/paperMark";
import type { Refund, ReturnBody } from "./types";

/**
 * One return, written down before it is sent (`@/shared/journal`).
 *
 * A refund carries a permanent `command_id` (M1-017), so resending the
 * identical attempt returns the original refund however late it arrives,
 * and the money goes back once.
 */
function isPart(value: unknown): boolean {
  return (
    isRecord(value) &&
    isId(value.sale_item_id) &&
    typeof value.quantity === "number" &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0 &&
    value.restock === true &&
    (value.condition === "INTACT" || value.condition === "DAMAGED") &&
    (value.location_id === undefined ||
      (value.condition === "INTACT" && isId(value.location_id)))
  );
}

const returns = journal<ReturnBody, Refund>({
  path: (body) => `/sales/${body.sale_id}/refunds`,
  payload: (body) => ({
    command_id: body.command_id,
    lines: body.lines,
    reason: body.reason,
    // Only when the attempt has it: one saved before the way was asked is
    // resent byte for byte (ADR-0012 §B12).
    ...(body.payment_method ? { payment_method: body.payment_method } : {}),
    // Taken back here, sold at another store of the network.
    ...(body.elsewhere ? { store_id: body.store_id } : {}),
    // Typed from paper (ADR-0021): only then, so every other is as before.
    ...(body.outage ? { outage: body.outage } : {}),
  }),
  scope: "return-pending",
  isBody: (body) =>
    isId(body.sale_id) &&
    (body.reason === null || typeof body.reason === "string") &&
    (body.elsewhere === undefined || typeof body.elsewhere === "boolean") &&
    (body.payment_method === undefined || isTillMethod(body.payment_method)) &&
    (body.outage === undefined || isPaperBody(body.outage)) &&
    Array.isArray(body.lines) &&
    body.lines.length > 0 &&
    body.lines.every(isPart),
  corrupt: "Некоректне збережене повернення. Зверніться до менеджера.",
  unfinished: "Спершу завершіть збережене повернення.",
});

export const useReturnCommand = returns.use;
export const loadReturn = returns.load;
export const submitReturn = returns.submit;
export const resolveReturn = returns.resolve;
