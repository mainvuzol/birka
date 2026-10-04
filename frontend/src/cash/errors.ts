import { ApiError, errorText, recordedNothing } from "@/shared/api";
import { methodLabels, notStated } from "@/shared/payment";
import { isPaymentMethod } from "./types";
import type { CashBody } from "./types";

/**
 * What the drawer's refusals say (ADR-0012, B10, B12), and what every
 * journal says when an attempt resent after an unknown outcome is refused
 * as having recorded nothing.
 *
 * Every refusal the server decides after looking a cash command up carries
 * `recorded: false` (B4): the text says what was not recorded and what to
 * do instead, never only that something failed.
 */

/** «20:05», the phone's own time, as the app shows every moment. */
export function timeOf(iso: unknown): string {
  return typeof iso === "string" && !Number.isNaN(Date.parse(iso))
    ? new Date(iso).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

/** «07.10» of a business day `2026-10-07`, as the owner's texts write it. */
export function dayOf(day: string): string {
  const [, month = "", date = ""] = day.split("-");
  return `${date}.${month}`;
}

/** Who and when, from a refusal's details: «20:05 · Олена». */
function closedBy(details: Record<string, unknown>): string {
  const by = typeof details.closed_by === "string" ? details.closed_by : "—";
  return `${timeOf(details.closed_at)} · ${by}`;
}

/** A refusal of any cash command, as «Каса» shows it. */
export function cashErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return errorText(error);
  // A stale screen: the way changed since it was read (B6.1).
  if (error.code === "PAYMENT_METHOD_CHANGED") {
    const current = error.details.current;
    return `Спосіб оплати вже змінили: зараз — ${
      isPaymentMethod(current) ? methodLabels[current] : notStated
    }. Перевірте й оберіть ще раз.`;
  }
  switch (error.details.reason) {
    // A count kept on the phone and sent over ten minutes after it was
    // taken (G31): that day goes into the evening's close, so the screen
    // does not invite a recount now, which would take that day's slot.
    case "COUNT_IS_STALE":
      return "Підрахунок не записано — він дійшов надто пізно. Закрийте касу, як завжди, увечері: цей день увійде в те закриття.";
    case "CLOSED_BY_ANOTHER":
      return `Касу вже закрито о ${closedBy(error.details)}. Ваш підрахунок не записано.`;
    case "ALREADY_CLOSED_TODAY":
      return `Касу сьогодні вже закрито о ${closedBy(error.details)}. Наступне закриття — завтра.`;
    // Cash taken out or put in, sent after a close its form did not show,
    // and that close is not the newest one made in the last ten minutes:
    // the server does not put it on that close by itself (B5). After the
    // close it is recorded again, in the open period; before it, the owner
    // or a manager names that close («Коли?», `cash:correct`, G7).
    case "CLOSE_IN_BETWEEN":
      return `Не записано: поки форма була відкрита, касу закрили о ${closedBy(error.details)}. Якщо гроші взяли чи внесли вже після закриття — запишіть ще раз. Якщо до нього — це запише менеджер до того закриття.`;
    case "NO_REASON":
      return "Напишіть, чому не збігається.";
    // Nothing to explain: no difference, an opening count, or a difference
    // under 1,00 грн (owner decision, 2026-10-04, G41).
    case "NO_DIFFERENCE":
      return "Причина не потрібна: різниці немає або вона менша за 1,00 грн.";
    case "REASON_GIVEN":
      return "Причину вже записано.";
    // A seller fixes their own operation only before the close (owner
    // decisions, 2026-10-04); afterwards the owner or a manager does.
    case "DAY_CLOSED":
      return "Касу вже закрито: змінити спосіб оплати тепер може лише менеджер або власник.";
    case "SAME_METHOD":
      return "Цей спосіб оплати вже вказано.";
    case "METHOD_NOT_FOR_THIS":
      return "Такий спосіб оплати для цієї операції не підходить.";
    case "BEFORE_DRAWER":
      return "Цю операцію записано до того, як застосунок почав рахувати касу: її спосіб оплати не змінюють.";
  }
  return errorText(error);
}

/**
 * «Клієнт забрав» refused for want of a way (ADR-0012, B12): a collect
 * without one, or an attempt saved before the way was asked and resent.
 */
export const collectNeedsMethod = "Вкажіть, як оплачено замовлення.";

/** An order command refused, as the orders' journal shows it. */
export function orderErrorText(error: unknown, resent: boolean): string {
  if (
    error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
  )
    return resent
      ? "Замовлення не позначено як забране — вкажіть, як оплачено, і натисніть «Клієнт забрав» ще раз."
      : collectNeedsMethod;
  return errorText(error);
}

/*
 * A journal's attempt, resent after an unknown outcome, refused as having
 * recorded nothing. The journals settle it (`@/shared/journal`), and before
 * 0035 nothing refused a payment or a return so: an old attempt saved
 * without a way would vanish without a word. Each says plainly that nothing
 * was recorded, and what to do (ADR-0012, B12). An error the server did not
 * mark so is an unknown outcome, said as before.
 */

/** The till: a refused old sale remounts an empty basket. */
export function saleErrorText(error: unknown): string {
  return recordedNothing(error)
    ? `${errorText(error)} Кошик треба зібрати знову.`
    : errorText(error);
}

export function returnErrorText(error: unknown): string {
  if (!recordedNothing(error)) return errorText(error);
  return error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
    ? "Повернення не записано — оформіть його ще раз і вкажіть, як повертаєте гроші."
    : `Повернення не записано. ${errorText(error)}`;
}

export function creditErrorText(
  error: unknown,
  kind: "payment" | "write-off",
): string {
  if (!recordedNothing(error)) return errorText(error);
  if (
    error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
  )
    return "Внесок не записано — прийміть його ще раз і вкажіть, як платить покупець.";
  return `${kind === "payment" ? "Внесок" : "Списання"} не записано. ${errorText(error)}`;
}

const notRecorded: Record<CashBody["command"], string> = {
  close: "Підрахунок не записано.",
  reason: "Причину не записано.",
  movement: "Видачу чи внесення не записано.",
  correction: "Зміну способу оплати не записано.",
};

/** The drawer's own journal: what was not recorded, then why. */
export function cashJournalText(
  error: unknown,
  command: CashBody["command"],
): string {
  if (!recordedNothing(error)) return errorText(error);
  // These say themselves what was not recorded.
  if (
    error instanceof ApiError &&
    ["COUNT_IS_STALE", "CLOSED_BY_ANOTHER", "CLOSE_IN_BETWEEN"].includes(
      String(error.details.reason),
    )
  )
    return cashErrorText(error);
  return `${notRecorded[command]} ${cashErrorText(error)}`;
}
