import { ApiError, errorText, inOwnWords, refusedWrite } from "@/shared/api";
import { money } from "@/orders/types";
import { visible } from "@/shared/visible";
import { shortDay } from "@/credits/format";
import type {
  Invoice,
  InvoiceBody,
  InvoiceEntry,
  InvoiceStatus,
} from "./types";

/** What a command says without its name and the store it was sent from. */
export type Command =
  | Omit<Extract<InvoiceBody, { kind: "invoice" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "payment" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "set-off" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "write-off" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "sold" }>, "command_id" | "store_id">;

export const statusLabels: Record<InvoiceStatus, string> = {
  OPEN: "Винні",
  SETTLED: "Сплачено повністю",
  WRITTEN_OFF: "Залишок списано",
  CANCELLED: "Скасовано",
};

export const entryLabels: Record<InvoiceEntry["kind"], string> = {
  PAYMENT: "Оплата",
  SET_OFF: "Залік за повернення",
  WRITE_OFF: "Списано",
};

/** What an operation recorded, said once: here, and on a kept one's stub
 * torn off (stage 2, money task list, P0-6). */
export function doneText(invoice: Invoice, command: Command): string {
  const rest = restText(invoice);
  switch (command.kind) {
    case "invoice":
      return `Накладну «${visible(invoice.supplier.name)}» на ${money(invoice.amount)} записано. ${rest}`;
    case "payment":
      return `Оплату ${money(command.amount)} записано. ${rest}`;
    case "set-off":
      return `Залік ${money(command.amount)} записано. ${rest}`;
    case "write-off":
      return `Списано ${money(invoice.written_off)}.`;
    case "sold":
      return `Продано з позиченого: ${visible(invoice.sold?.label ?? "")} × ${String(command.quantity)}. Борг «${visible(invoice.supplier.name)}» ${money(invoice.amount)} — у «Накладних».`;
  }
}

/** What is left once an operation is recorded: «Залишок 999,50 грн.», or
 * «Накладну сплачено повністю.» under a knot. */
export function restText(invoice: Invoice): string {
  return invoice.status === "SETTLED"
    ? "Накладну сплачено повністю."
    : `Залишок ${money(invoice.owed)}.`;
}

/** «14.10.25, 10:20», as the invoices said it before. */
export function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** «Накладна «Ганна» від 14.10»: one invoice, named. */
export function invoiceName(invoice: Invoice): string {
  return `Накладна «${visible(invoice.supplier.name)}» від ${shortDay(invoice.at)}`;
}

/** Why an operation was not taken, in this screen's words: here, and under
 * a kept one checked (stage 2, money task list, P0-6). */
export function refusalText(error: unknown, kept = false): string {
  if (error instanceof ApiError) {
    switch (error.details.reason) {
      case "MORE_THAN_OWED":
        return `Це більше, ніж винні: залишок ${money(String(error.details.owed))}.`;
      case "NOT_OWED":
        return "За цією накладною вже нічого не винні.";
      case "NO_REASON":
        return "Вкажіть, чому.";
      case "PAID_WHERE_OWED":
        return "Магазин, чия це накладна, знову працює — сплачує він.";
      case "OTHER_SUPPLIER":
        return "Це повернення іншому постачальнику.";
      case "RETURN_CANCELLED":
        return "Це повернення скасовано: товар повернувся на склад.";
      case "ENTRIES_STAND":
        return "Спершу скасуйте оплати й заліки цієї накладної.";
      case "WRITTEN_OFF":
        return "Списане лишається списаним.";
    }
  }
  // A kept one refused later keeps its words (owner, В-П1 (б): the kept
  // operations' words stay).
  if (kept)
    return inOwnWords(
      errorText(error),
      "Не записано. Перевірте дані та спробуйте ще раз.",
      "Не записано: дані змінилися — перегляньте їх і спробуйте ще раз.",
    );
  return refusedWrite(
    error,
    "Не записано.",
    "Перевірте дані накладної.",
    "Не записано: дані змінилися — перегляньте їх.",
  );
}

/** What a command that records money came to: the invoice as the server
 * answered it, the refusal in this screen's words, or an answer lost — the
 * operation kept on the phone, its stub over the screen. */
export type Sent =
  | { kind: "done"; invoice: Invoice }
  | { kind: "refused"; text: string }
  | { kind: "unknown" };
