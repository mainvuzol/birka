import { isId, journal } from "@/shared/journal";
import type { Invoice, InvoiceBody } from "./types";

/**
 * One invoice, payment, set-off or write-off — or borrowed goods marked
 * sold, which is an invoice too — written down before it is sent
 * (`@/shared/journal`).
 *
 * Each carries a permanent `command_id`, so resending the identical attempt
 * returns what the first one did however late it arrives: money paid to a
 * supplier once is counted once, even when its answer was lost.
 */
const money = /^\d{1,10}\.\d{2}$/;

const invoices = journal<InvoiceBody, Invoice>({
  path: (body) =>
    body.kind === "invoice"
      ? "/supplier-invoices"
      : body.kind === "sold"
        ? "/supplier-invoices/sold"
        : `/supplier-invoices/${body.invoice_id}/${
            body.kind === "payment"
              ? "payments"
              : body.kind === "set-off"
                ? "set-offs"
                : "write-off"
          }`,
  payload: (body) => {
    switch (body.kind) {
      case "invoice":
        return {
          command_id: body.command_id,
          store_id: body.store_id,
          supplier_id: body.supplier_id,
          amount: body.amount,
          paid_now: body.paid_now,
          note: body.note,
        };
      case "payment":
        return {
          command_id: body.command_id,
          amount: body.amount,
          // Only for a store that does not trade: a payment where the
          // invoice is owed names no store.
          ...(body.elsewhere ? { store_id: body.store_id } : {}),
        };
      case "set-off":
        return {
          command_id: body.command_id,
          supplier_return_id: body.supplier_return_id,
          amount: body.amount,
        };
      case "write-off":
        return { command_id: body.command_id, reason: body.reason };
      case "sold":
        return {
          command_id: body.command_id,
          store_id: body.store_id,
          stock_lot_id: body.stock_lot_id,
          quantity: body.quantity,
        };
    }
  },
  scope: "supplier-invoice-pending",
  isBody: (body) =>
    (body.kind === "invoice" &&
      isId(body.supplier_id) &&
      typeof body.amount === "string" &&
      money.test(body.amount) &&
      typeof body.paid_now === "string" &&
      money.test(body.paid_now) &&
      (body.note === null || typeof body.note === "string")) ||
    (body.kind === "sold" &&
      isId(body.stock_lot_id) &&
      typeof body.quantity === "number" &&
      Number.isInteger(body.quantity) &&
      body.quantity > 0) ||
    (isId(body.invoice_id) &&
      ((body.kind === "payment" &&
        typeof body.amount === "string" &&
        money.test(body.amount) &&
        (body.elsewhere === undefined ||
          typeof body.elsewhere === "boolean")) ||
        (body.kind === "set-off" &&
          isId(body.supplier_return_id) &&
          typeof body.amount === "string" &&
          money.test(body.amount)) ||
        (body.kind === "write-off" &&
          typeof body.reason === "string" &&
          body.reason.trim() !== ""))),
  corrupt: "Некоректна збережена операція з накладною. Зверніться до власника.",
  unfinished: "Спершу завершіть збережену операцію з накладною.",
});

export const useInvoiceCommand = invoices.use;
export const loadInvoiceCommand = invoices.load;
export const submitInvoiceCommand = invoices.submit;
export const resolveInvoiceCommand = invoices.resolve;
