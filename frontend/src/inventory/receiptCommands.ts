import { isId, isRecord, journal } from "@/shared/journal";
import type { Receipt, ReceiptBody } from "./receiptTypes";

/**
 * One delivery, written down before it is sent (`@/shared/journal`).
 *
 * Before `0016` this journal would have been dangerous. A delivery replayed
 * from here after a week away would have been received twice; since then a
 * receipt carries a permanent `command_id` (ADR-0006), so resending the
 * identical attempt returns the original receipt however late it arrives.
 */
const acquisitions = new Set(["PURCHASE", "CONSIGNMENT", "BORROWED"]);
const money = /^\d{1,10}\.\d{2}$/;

function isLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    isId(value.product_variant_id) &&
    isId(value.size_id) &&
    typeof value.quantity === "number" &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0 &&
    typeof value.acquisition_type === "string" &&
    acquisitions.has(value.acquisition_type) &&
    (value.unit_cost === null ||
      (typeof value.unit_cost === "string" && money.test(value.unit_cost)))
  );
}

const receipts = journal<ReceiptBody, Receipt>({
  path: "/inventory/receipts",
  scope: "receipt-pending",
  isBody: (body) =>
    isId(body.location_id) &&
    (body.supplier_id === undefined || isId(body.supplier_id)) &&
    (body.notes === null || typeof body.notes === "string") &&
    Array.isArray(body.lines) &&
    body.lines.length > 0 &&
    body.lines.every(isLine),
  corrupt: "Некоректне збережене приймання. Зверніться до менеджера.",
  unfinished: "Спершу завершіть збережене приймання.",
});

export const useReceiptCommand = receipts.use;
export const loadReceipt = receipts.load;
export const submitReceipt = receipts.submit;
export const resolveReceipt = receipts.resolve;
