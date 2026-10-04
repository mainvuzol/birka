import { isId, journal } from "@/shared/journal";
import { isPaymentMethod, movementKinds, targets } from "./types";
import type { CashAnswer, CashBody, MovementKind, Target } from "./types";

/**
 * One command of the drawer, written down before it is sent
 * (`@/shared/journal`): a close, its reason, cash taken out or put in, or a
 * way of paying corrected (ADR-0012, B12).
 *
 * Each carries a permanent `command_id`, so resending the identical attempt
 * returns what the first one did however late it arrives: a drawer counted
 * once is closed once, and cash taken out once is recorded once. Every
 * refusal the server decides after looking the command up says it recorded
 * nothing (`recorded: false`), so even an attempt whose outcome was unknown
 * settles on it, and the phone is not left blocked.
 */
const money = /^\d{1,10}\.\d{2}$/;

/**
 * Whole seconds since the seller confirmed the count, by this phone's own
 * clock, worked out afresh at each send (B4 step 5): a count over ten
 * minutes old no longer describes the drawer, and the server refuses it.
 * Never below 0, so a clock moved back cannot have it refused before the
 * server looks the command up; outside the body, so a resend stays
 * identical.
 */
export function ageOf(countedAt: string, now: number = Date.now()): number {
  const at = Date.parse(countedAt);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.floor((now - at) / 1000));
}

function isNote(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length <= 200);
}

function isAfter(value: unknown): boolean {
  return value === null || isId(value);
}

const cash = journal<CashBody, CashAnswer>({
  path: (body) => {
    switch (body.command) {
      case "close":
        return `/cash/closes?age=${String(ageOf(body.counted_at))}`;
      case "reason":
        return `/cash/closes/${body.close_id}/reason`;
      case "movement":
        return "/cash/movements";
      case "correction":
        return "/cash/corrections";
    }
  },
  payload: (body) => {
    switch (body.command) {
      // Exactly these five: the count, when it was confirmed, and the
      // newest close the screen showed (B4.3).
      case "close":
        return {
          store_id: body.store_id,
          command_id: body.command_id,
          counted: body.counted,
          counted_at: body.counted_at,
          after_close_id: body.after_close_id,
        };
      case "reason":
        return { command_id: body.command_id, reason: body.reason };
      case "movement":
        return {
          store_id: body.store_id,
          command_id: body.command_id,
          kind: body.movement_kind,
          amount: body.amount,
          ...(body.note === null ? {} : { note: body.note }),
          after_close_id: body.after_close_id,
          ...(body.for_close_id === undefined
            ? {}
            : { for_close_id: body.for_close_id }),
        };
      case "correction":
        return {
          command_id: body.command_id,
          target: body.target,
          target_id: body.target_id,
          from_method: body.from_method,
          to_method: body.to_method,
          ...(body.note === null ? {} : { note: body.note }),
        };
    }
  },
  scope: "cash-pending",
  isBody: (body) => {
    switch (body.command) {
      case "close":
        return (
          typeof body.counted === "string" &&
          money.test(body.counted) &&
          typeof body.counted_at === "string" &&
          !Number.isNaN(Date.parse(body.counted_at)) &&
          isAfter(body.after_close_id)
        );
      case "reason":
        return (
          isId(body.close_id) &&
          typeof body.reason === "string" &&
          body.reason.trim() !== "" &&
          body.reason.length <= 1000
        );
      case "movement":
        return (
          movementKinds.includes(body.movement_kind as MovementKind) &&
          typeof body.amount === "string" &&
          money.test(body.amount) &&
          body.amount !== "0.00" &&
          isNote(body.note) &&
          isAfter(body.after_close_id) &&
          (body.for_close_id === undefined || isId(body.for_close_id))
        );
      case "correction":
        return (
          targets.includes(body.target as Target) &&
          isId(body.target_id) &&
          (body.from_method === null || isPaymentMethod(body.from_method)) &&
          isPaymentMethod(body.to_method) &&
          body.from_method !== body.to_method &&
          isNote(body.note)
        );
      default:
        return false;
    }
  },
  corrupt: "Некоректна збережена операція каси. Зверніться до менеджера.",
  unfinished: "Спершу завершіть збережену операцію каси.",
});

export const useCashCommand = cash.use;
export const loadCashCommand = cash.load;
export const submitCashCommand = cash.submit;
export const resolveCashCommand = cash.resolve;
