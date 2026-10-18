import { ApiError, errorText, recordedNothing } from "@/shared/api";
import { methodLabels, notStated } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";
import { refusalText as debtRefusalText } from "@/credits/Credits";
import { refusalText as correctionRefusalText } from "@/inventory/Correction";
import {
  refusalText as returnRefusalText,
  RETURN_CONFLICT_TEXT,
} from "@/returns/Returns";
import {
  refusalText as tillRefusalText,
  TILL_CONFLICT_TEXT,
} from "@/sales/Sale";
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
  const by =
    typeof details.closed_by === "string" ? visible(details.closed_by) : "—";
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

/**
 * An order command refused, as the orders' journal shows it. `resent` is the
 * label of a saved command resent — by its button or by the phone itself —
 * and null for one sent from its screen.
 */
export function orderErrorText(error: unknown, resent: string | null): string {
  if (
    error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
  )
    return resent !== null
      ? "Замовлення не позначено як забране — вкажіть, як оплачено, і натисніть «Клієнт забрав» ще раз."
      : collectNeedsMethod;
  // «Клієнт забрав» after another phone cancelled the order or took it
  // back: refused, recording nothing (ADR-0013 §1). The customer has the
  // goods, so they are typed as a sale from paper at the order's prices
  // (owner decision, 2026-10-07; G24).
  if (
    recordedNothing(error) &&
    error instanceof ApiError &&
    error.details.action === "collect" &&
    (error.details.status === "CANCELLED" ||
      error.details.status === "RETURNED")
  )
    return "Замовлення вже скасовано або повернено — «Клієнт забрав» не записано. Якщо товар віддали — внесіть його як продаж з паперу, за цінами замовлення.";
  // A saved command refused on resend: nobody is looking at its form, so it
  // says what was not recorded before why (ADR-0013 §1).
  if (resent !== null && recordedNothing(error))
    return `Операцію «${resent}» не записано. ${errorText(error)}`;
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

/**
 * Why a kept sale was not recorded, inside «Продаж не записано (…)»: the
 * till's own words, as one clause.
 */
function saleReason(error: unknown): string {
  // Goods gone from the ledger: a manager fixes the balance first (owner
  // decision, 2026-10-04). Units reserved for an order meanwhile: a manager
  // decides about the order, never the balance (owner decision, 2026-10-07).
  if (error instanceof ApiError && error.code === "INSUFFICIENT_STOCK")
    return error.details.reserved === true
      ? "частина цих одиниць у резерві замовлення — спершу менеджер має вирішити із замовленням"
      : "цього товару вже немає в обліку — спершу попросіть менеджера виправити залишок";
  // Not «спробуйте ще раз»: the basket is gone, and it is typed from paper.
  if (tillRefusalText(error) === TILL_CONFLICT_TEXT)
    return "дані змінилися, поки сервер не відповідав";
  const text = tillRefusalText(error).replace(/\.$/, "");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The till: a refused old sale remounts an empty basket. Its customer has
 * usually left with the goods, so whatever the reason, the sale is typed
 * from paper, marked (ADR-0013 §8; G15).
 */
export function saleErrorText(error: unknown): string {
  return recordedNothing(error)
    ? `Продаж не записано (${saleReason(error)}). Якщо товар віддали покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати знову.`
    : errorText(error);
}

/**
 * A kept delivery: the shared words for why, as «Приймання» shows a
 * refusal of its own (ADR-0013 §1).
 */
export function receiptErrorText(error: unknown): string {
  return recordedNothing(error)
    ? `Приймання не записано. ${errorText(error)}`
    : errorText(error);
}

/**
 * A kept stock correction: the correction screen's own words for why, so a
 * count made against a balance that moved meanwhile says to count again
 * (ADR-0013 §1). The balance it was made against is the one the refusal
 * names: the server compares the count with nothing else.
 */
export function adjustmentErrorText(error: unknown): string {
  if (!recordedNothing(error) || !(error instanceof ApiError))
    return errorText(error);
  const counted = error.details.expected;
  return `Коригування не записано. ${correctionRefusalText(
    error,
    typeof counted === "number" ? counted : null,
    "",
  )}`;
}

/** «Повернення»'s own words for why (ADR-0013 §8). */
export function returnErrorText(error: unknown): string {
  if (!recordedNothing(error)) return errorText(error);
  if (
    error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
  )
    return "Повернення не записано — оформіть його ще раз і вкажіть, як повертаєте гроші.";
  // Resent after the server did not answer: it changed meanwhile, not while
  // the seller worked, as a kept sale says (decided with the task list's
  // P2-2, 2026-10-18; for the owner to confirm).
  if (returnRefusalText(error) === RETURN_CONFLICT_TEXT)
    return "Повернення не записано. Дані змінилися, поки сервер не відповідав. Поверніться до списку й спробуйте ще раз.";
  return `Повернення не записано. ${returnRefusalText(error)}`;
}

/**
 * «Борги»'s own words for why, by the way the payment was pressed: money
 * already taken for a debt paid meanwhile goes back (owner decisions,
 * 2026-10-04 and 2026-10-07; ADR-0013 §8). `way` is the kept payment's, null
 * for one kept before the way was asked.
 */
export function creditErrorText(
  error: unknown,
  kind: "payment" | "write-off",
  way: TillMethod | null = null,
): string {
  if (!recordedNothing(error)) return errorText(error);
  if (
    error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
  )
    return "Внесок не записано — прийміть його ще раз і вкажіть, як платить покупець.";
  const why = debtRefusalText(error, kind === "payment" ? way : undefined);
  // It says itself that the payment was not recorded.
  if (
    kind === "payment" &&
    error instanceof ApiError &&
    error.details.reason === "NOT_OWED"
  )
    return why;
  return `${kind === "payment" ? "Внесок" : "Списання"} не записано. ${why}`;
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
