import { isId, journal } from "@/shared/journal";
import type { Credit, CreditBody } from "./types";

/**
 * One payment or write-off, written down before it is sent (`@/shared/journal`).
 *
 * Both carry a permanent `command_id`, so resending the identical attempt
 * returns what the first one did however late it arrives: a payment taken
 * once is counted once, even when its answer was lost.
 */
const money = /^\d{1,10}\.\d{2}$/;

const credits = journal<CreditBody, Credit>({
  path: (body) =>
    body.kind === "payment"
      ? `/credits/${body.credit_id}/payments`
      : `/credits/${body.credit_id}/write-off`,
  payload: (body) =>
    body.kind === "payment"
      ? {
          command_id: body.command_id,
          amount: body.amount,
          // Only for another store's debt: a payment where it was sold is
          // sent exactly as before.
          ...(body.elsewhere ? { store_id: body.store_id } : {}),
        }
      : { command_id: body.command_id, reason: body.reason },
  scope: "credit-pending",
  isBody: (body) =>
    isId(body.credit_id) &&
    ((body.kind === "payment" &&
      typeof body.amount === "string" &&
      money.test(body.amount) &&
      (body.elsewhere === undefined || typeof body.elsewhere === "boolean")) ||
      (body.kind === "write-off" &&
        typeof body.reason === "string" &&
        body.reason.trim() !== "")),
  corrupt: "Некоректний збережений внесок. Зверніться до менеджера.",
  unfinished: "Спершу завершіть збережений внесок.",
});

export const useCreditCommand = credits.use;
export const loadCreditCommand = credits.load;
export const submitCreditCommand = credits.submit;
export const resolveCreditCommand = credits.resolve;
