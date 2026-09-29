import { isId, journal } from "@/shared/journal";
import { reasonLabels } from "./adjustmentTypes";
import type { Adjustment, AdjustmentBody } from "./adjustmentTypes";

/**
 * One stock correction, written down before it is sent (`@/shared/journal`).
 *
 * Safe to replay at any distance in time only since `0017`: a correction
 * carries a permanent `command_id` (ADR-0007). Before that, a correction
 * resent from here after its 7-day cache was gone applied a second time.
 */
const adjustments = journal<AdjustmentBody, Adjustment>({
  path: "/inventory/adjustments",
  scope: "adjustment-pending",
  isBody: (body) =>
    isId(body.location_id) &&
    isId(body.product_variant_id) &&
    isId(body.size_id) &&
    typeof body.quantity_delta === "number" &&
    Number.isInteger(body.quantity_delta) &&
    body.quantity_delta !== 0 &&
    Math.abs(body.quantity_delta) <= 10000 &&
    typeof body.reason_code === "string" &&
    Object.hasOwn(reasonLabels, body.reason_code) &&
    (body.note === null || typeof body.note === "string") &&
    (body.expected_quantity === null ||
      (typeof body.expected_quantity === "number" &&
        Number.isInteger(body.expected_quantity) &&
        body.expected_quantity >= 0)),
  corrupt: "Некоректне збережене коригування. Зверніться до менеджера.",
  unfinished: "Спершу завершіть збережене коригування.",
});

export const useAdjustmentCommand = adjustments.use;
export const loadAdjustment = adjustments.load;
export const submitAdjustment = adjustments.submit;
export const resolveAdjustment = adjustments.resolve;
