import {
  ApiError,
  CONFLICT_TEXT,
  errorText,
  FAILED_TEXT,
  INVALID_TEXT,
  recordedNothing,
} from "@/shared/api";
import { methodLabels, notStated } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";
import { refusalText as debtRefusalText } from "@/credits/Debt";
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
export function orderErrorText(
  error: unknown,
  resent: string | null,
  /** A command still kept, unconfirmed: never said to have failed. */
  kept = false,
  misses = 0,
  /** The kept command's name, said even at its first press. */
  label: string | null = null,
  /** The server answered the step: only reading its order failed. */
  recorded = false,
): string {
  // Recorded: never the shared «Спробуйте ще раз», which reads as a
  // failure; the banner's own button reads the order again, and a server's
  // own failure keeps its request's number (owner decision, 2026-10-21).
  // Every answer with words of its own — the server out of reach, a session
  // ended, too many requests — keeps them (review, 2026-10-21).
  if (recorded) {
    const text = errorText(error);
    if (text.startsWith(FAILED_TEXT))
      return [
        `Операцію «${label ?? resent ?? ""}» записано. Замовлення не вдалося показати — натисніть «Оновити результат».`,
        text.slice(FAILED_TEXT.length).trim(),
      ]
        .filter(Boolean)
        .join(" ");
  }
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
  if (kept && !recordedNothing(error))
    return (
      keptUnconfirmed(
        error,
        (label ?? resent) !== null
          ? `Операцію «${label ?? resent ?? ""}»`
          : "Операцію",
        "вона",
        misses,
      ) ?? errorText(error)
    );
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
export function saleErrorText(
  error: unknown,
  misses = 0,
  /** The server answered the sale: only its reading failed. */
  recorded = false,
): string {
  if (recordedNothing(error))
    return `Продаж не записано (${saleReason(error)}). Якщо товар віддали покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати знову.`;
  if (recorded) return errorText(error);
  return keptUnconfirmed(error, "Продаж", "він", misses) ?? errorText(error);
}

/**
 * A kept delivery: the shared words for why, as «Приймання» shows a
 * refusal of its own (ADR-0013 §1).
 */
export function receiptErrorText(error: unknown, misses = 0): string {
  return recordedNothing(error)
    ? `Приймання не записано. ${errorText(error)}`
    : (keptUnconfirmed(error, "Приймання", "воно", misses) ?? errorText(error));
}

/**
 * A kept stock correction: the correction screen's own words for why, so a
 * count made against a balance that moved meanwhile says to count again
 * (ADR-0013 §1). The balance it was made against is the one the refusal
 * names: the server compares the count with nothing else.
 */
export function adjustmentErrorText(error: unknown, misses = 0): string {
  if (!recordedNothing(error) || !(error instanceof ApiError))
    return (
      keptUnconfirmed(error, "Коригування", "воно", misses) ?? errorText(error)
    );
  const counted = error.details.expected;
  return `Коригування не записано. ${correctionRefusalText(
    error,
    typeof counted === "number" ? counted : null,
    "",
  )}`;
}

/**
 * A return refused, having recorded nothing, because where it was going is
 * lost: the right to take returns, a warehouse no longer reached — the one
 * it was sold from, or the one chosen — or closed, the «Брак» undone.
 */
function lostPlace(error: ApiError): boolean {
  return (
    error.status === 403 ||
    error.code === "DAMAGED_RETURNS_UNAVAILABLE" ||
    error.details.reason === "WAREHOUSE_UNAVAILABLE" ||
    error.details.reason === "CHOOSE_A_WAREHOUSE" ||
    error.details.reason === "NOT_A_WAREHOUSE_OF_THIS_STORE"
  );
}

/** From a kept command's third «not found» or request not taken in a row
 * (`counts`, `@/shared/journal`): someone to look (owner decisions,
 * 2026-10-19 and 2026-10-21). */
export const ASK_A_MANAGER =
  "Зверніться до менеджера: нехай перевірить, чи записано.";

/**
 * A kept command asked about again, and answered by a server's error or a
 * request it could not find: no answer about the command. Still
 * unconfirmed, never «спробуйте ще раз», which could take or hand back the
 * money twice; the request's number kept, for whoever reads the log — for
 * every kept command (owner decisions, 2026-10-18 and 2026-10-19). From the
 * third «not found» in a row (`misses`), a manager is asked to look. `what`
 * is the sentence's subject («Продаж», «Операцію «Відправлено»»), `it`
 * stands for it after. A request the server did not take — a 400, or a 422
 * the shared words would answer «Перевірте дані…» — is no proof either: «…
 * сервер не прийняв запит …», as a kept payment's (owner decision,
 * 2026-10-21). Null for any other answer.
 */
export function keptUnconfirmed(
  error: unknown,
  what: string,
  it: string,
  misses = 0,
): string | null {
  if (!(error instanceof ApiError)) return null;
  const text = errorText(error);
  const failed = text.startsWith(FAILED_TEXT);
  const notTaken = (failed && error.status === 400) || text === INVALID_TEXT;
  if (!failed && !notTaken) return null;
  return [
    `${what} ще не підтверджено: сервер ${notTaken ? "не прийняв запит" : "не зміг відповісти"}. Перевірте результат ще раз — двічі ${it} не запишеться.`,
    failed ? text.slice(FAILED_TEXT.length).trim() : "",
    // Only «not found» and a request not taken count, in one row; any other
    // answer begins it again (`@/shared/journal`).
    misses >= 3 ? ASK_A_MANAGER : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** «Повернення»'s own words for why (ADR-0013 §8). */
export function returnErrorText(error: unknown, misses = 0): string {
  // Not said to have recorded nothing: still unconfirmed, never «try again»,
  // which could hand the money back twice (owner decisions, 2026-10-18).
  if (!recordedNothing(error)) {
    const text = errorText(error);
    if (text === CONFLICT_TEXT)
      return "Повернення ще не підтверджено: сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі воно не запишеться.";
    // A request not taken, in the shared words, with a manager from the
    // third in a row (owner decision, 2026-10-21).
    return keptUnconfirmed(error, "Повернення", "воно", misses) ?? text;
  }
  if (
    error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
  )
    return "Повернення не записано — оформіть його ще раз і вкажіть, як повертаєте гроші.";
  // Resent after the server did not answer: it changed meanwhile, not while
  // the seller worked, as a kept sale says; the section named, since it may
  // show over the till (owner decision, 2026-10-18).
  if (returnRefusalText(error) === RETURN_CONFLICT_TEXT)
    return "Повернення не записано. Дані змінилися, поки сервер не відповідав. Поверніться до списку в «Поверненні» й спробуйте ще раз.";
  // Where it was going is lost while the phone kept it — the right to take
  // returns, the warehouse no longer reached or closed, the «Брак» undone:
  // the money may have been handed back meanwhile, and the paper says so
  // (owner decisions, 2026-10-18).
  if (error instanceof ApiError && lostPlace(error))
    return `Повернення не записано. ${
      error.details.reason === "WAREHOUSE_UNAVAILABLE"
        ? "Склад, куди йшов цей товар, закрито. Зверніться до менеджера."
        : returnRefusalText(error)
    } Якщо гроші вже повернули — передайте папір менеджеру, щоб внести повернення з паперу.`;
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
  misses = 0,
): string {
  const what = kind === "payment" ? "Внесок" : "Списання";
  // Refused for the right in a store: «Борги»'s own words, never a
  // warehouse's (owner decision, 2026-10-21; words to be confirmed). A
  // write-off's right is the owner's to give back. A closed store's debt,
  // written off by the network's owner alone, names no store: not this.
  const right =
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === "PERMISSION_DENIED" &&
    typeof error.details.store_id === "string"
      ? kind === "payment"
        ? "у вас більше немає права приймати внески. Зверніться до менеджера."
        : "у вас більше немає права списувати борги. Зверніться до власника."
      : null;
  // Not said to have recorded nothing: still unconfirmed, never «спробуйте
  // ще раз», which could take the money twice, and never an order's words
  // (credits task list, P2-2; as «Повернення», owner decisions, 2026-10-18).
  if (!recordedNothing(error)) {
    if (right !== null) return `${what} ще не підтверджено: ${right}`;
    const text = errorText(error);
    const twice = `Перевірте результат ще раз — двічі ${kind === "payment" ? "він" : "воно"} не запишеться.`;
    if (text === CONFLICT_TEXT)
      return `${what} ще не підтверджено: сервер відповів, що дані змінилися. ${twice}`;
    // A request not taken, in the shared words, with a manager from the
    // third in a row (owner decision, 2026-10-21).
    return (
      keptUnconfirmed(
        error,
        what,
        kind === "payment" ? "він" : "воно",
        misses,
      ) ?? text
    );
  }
  if (
    error instanceof ApiError &&
    error.details.reason === "PAYMENT_METHOD_REQUIRED"
  )
    return "Внесок не записано — прийміть його ще раз і вкажіть, як платить покупець.";
  // Its own person, answered by the server that nothing was recorded: the
  // till is free, and money already taken is entered from paper by a
  // manager, as a return's (owner decisions, 2026-10-18 and 2026-10-21).
  if (right !== null)
    return `${what} не записано: ${right}${
      kind === "payment"
        ? " Якщо гроші вже взяли — передайте папір менеджеру, щоб внести внесок з паперу."
        : ""
    }`;
  const why = debtRefusalText(error, kind === "payment" ? way : undefined);
  // It says itself that the payment was not recorded.
  if (
    kind === "payment" &&
    error instanceof ApiError &&
    error.details.reason === "NOT_OWED"
  )
    return why;
  // Resent after the server did not answer: it changed meanwhile, not while
  // the seller worked; the section named, as the banner may stand over any
  // tab.
  if (why === CONFLICT_TEXT)
    return `${what} не записано. Дані змінилися, поки сервер не відповідав. Відкрийте борг у «Боргах» і спробуйте ще раз.`;
  if (why === INVALID_TEXT)
    return `${what} не записано. Сервер не прийняв запит. Відкрийте борг у «Боргах» і спробуйте ще раз.`;
  return `${what} не записано. ${why}`;
}

const notRecorded: Record<CashBody["command"], string> = {
  close: "Підрахунок не записано.",
  reason: "Причину не записано.",
  movement: "Видачу чи внесення не записано.",
  correction: "Зміну способу оплати не записано.",
};

/** What each of the drawer's commands is called, and stood for after; a
 * movement by its way, when known (review, 2026-10-20). */
const keptNames: Record<CashBody["command"], [string, string]> = {
  close: ["Підрахунок", "він"],
  reason: ["Причину", "вона"],
  movement: ["Видачу чи внесення", "це"],
  correction: ["Зміну способу оплати", "вона"],
};
const movementNames: Record<"OUT" | "IN", [string, string]> = {
  OUT: ["Видачу", "вона"],
  IN: ["Внесення", "воно"],
};

/** The drawer's own journal: what was not recorded, then why. */
export function cashJournalText(
  error: unknown,
  command: CashBody["command"],
  misses = 0,
  /** A movement's way, out of the drawer or in. */
  direction?: "OUT" | "IN",
): string {
  if (!recordedNothing(error))
    return (
      keptUnconfirmed(
        error,
        ...(command === "movement" && direction
          ? movementNames[direction]
          : keptNames[command]),
        misses,
      ) ?? errorText(error)
    );
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
