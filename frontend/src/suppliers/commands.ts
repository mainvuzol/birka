import { isId, isRecord, journal } from "@/shared/journal";
import type { ReturnBody, SupplierReturn } from "./types";

/**
 * One return of goods to a supplier, written down before it is sent
 * (`@/shared/journal`).
 *
 * It carries a permanent `command_id`, so resending the identical attempt
 * returns what the first one did however late it arrives: goods sent back
 * once leave the warehouse once, even when the answer was lost.
 */
const returns = journal<ReturnBody, SupplierReturn>({
  path: "/supplier-returns",
  scope: "supplier-return-pending",
  isBody: (body) =>
    isId(body.location_id) &&
    isId(body.supplier_id) &&
    Array.isArray(body.lines) &&
    body.lines.length > 0 &&
    body.lines.every(
      (line: unknown) =>
        isRecord(line) &&
        isId(line.product_variant_id) &&
        isId(line.size_id) &&
        typeof line.quantity === "number" &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0,
    ) &&
    (body.note === null || typeof body.note === "string"),
  corrupt:
    "Некоректне збережене повернення постачальнику. Зверніться до менеджера.",
  unfinished: "Спершу завершіть збережене повернення постачальнику.",
});

export const useReturnToSupplier = returns.use;
export const loadReturnToSupplier = returns.load;
export const submitReturnToSupplier = returns.submit;
export const resolveReturnToSupplier = returns.resolve;
