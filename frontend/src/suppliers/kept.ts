import { keptUnconfirmed, twiceOf } from "@/cash/errors";
import { ApiError, errorText, SlowAnswer, unreachable } from "@/shared/api";
import type { InvoiceBody } from "./types";

/**
 * A kept operation of the invoices' or the suppliers' journal, as its stub
 * and its banner name it (stage 2, money task list, P0-6): «Оплату ще не
 * підтверджено», «Перевірити результат оплати», «Оплату записано один раз»,
 * and the line under the title as the screens said it.
 */
export interface KeptWords {
  /** The operation as the stub's title names it: «Оплату». */
  what: string;
  /** «Перевірити результат оплати». */
  check: string;
  /** «Невідомо, чи записано оплату. …». */
  unknown: string;
  /** «двічі вона не запишеться», for a check answered by no answer. */
  twice: string;
}

const invoiceUnknown = (what: string): string =>
  `Невідомо, чи записано ${what}. Перевірте результат — та сама операція не запишеться двічі.`;

export const invoiceKept: Record<InvoiceBody["kind"], KeptWords> = {
  invoice: {
    what: "Накладну",
    check: "Перевірити результат накладної",
    unknown: invoiceUnknown("накладну"),
    twice: twiceOf("вона"),
  },
  payment: {
    what: "Оплату",
    check: "Перевірити результат оплати",
    unknown: invoiceUnknown("оплату"),
    twice: twiceOf("вона"),
  },
  "set-off": {
    what: "Залік",
    check: "Перевірити результат заліку",
    unknown: invoiceUnknown("залік"),
    twice: twiceOf("він"),
  },
  "write-off": {
    what: "Списання",
    check: "Перевірити результат списання",
    unknown: invoiceUnknown("списання"),
    twice: twiceOf("воно"),
  },
  sold: {
    what: "Продаж позиченого",
    check: "Перевірити результат продажу позиченого",
    unknown: invoiceUnknown("продаж позиченого"),
    twice: twiceOf("він"),
  },
};

export const supplierReturnKept: KeptWords = {
  what: "Повернення постачальнику",
  check: "Перевірити результат повернення",
  unknown:
    "Невідомо, чи записано повернення постачальнику. Перевірте результат — те саме повернення не запишеться двічі.",
  twice: twiceOf("воно"),
};

/**
 * Why a kept operation is still unconfirmed, as every kept command says it
 * — the server failed, did not take the request, said the data changed —
 * or what else it answered. No answer at all says nothing more: the stub
 * says since when it waits, and the paper's words are the till's, not a
 * supplier's.
 */
export function keptSaid(
  error: unknown,
  words: KeptWords,
  misses: number,
): string | null {
  if (error === null || unreachable(error)) return null;
  // The journal's own («Спершу завершіть збережену операцію з накладною.»),
  // as the screens said it before (review, 2026-11-05).
  if (
    error instanceof Error &&
    !(error instanceof ApiError) &&
    !(error instanceof SlowAnswer)
  )
    return error.message;
  return (
    keptUnconfirmed(error, words.what, words.twice, misses) ?? errorText(error)
  );
}
