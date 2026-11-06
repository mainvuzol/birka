import type { JSX } from "react";
import { kopecks, money } from "@/orders/types";
import { Sum } from "@/shared/Sum";
import { shortDay } from "@/credits/format";
import type { Invoice } from "./types";

/** How much of the invoice is closed, for the bar under what is owed: a
 * look, never a number to read. */
function closedShare(invoice: Invoice): number {
  const amount = kopecks(invoice.amount) ?? 0n;
  const owed = kopecks(invoice.owed) ?? 0n;
  if (amount <= 0n) return 0;
  return Number(((amount - owed) * 100n) / amount);
}

/**
 * «Сплачено 500,00 грн з 1 499,50 грн · остання оплата 19.10» (spec §6.24),
 * and under it what was set off or written off, when anything was: every
 * sum and the day the server's.
 */
export function Progress({ invoice }: { invoice: Invoice }): JSX.Element {
  const setOff = kopecks(invoice.set_off) ?? 0n;
  const written = kopecks(invoice.written_off) ?? 0n;
  return (
    <>
      <div className="debt-bar invoice-bar" aria-hidden="true">
        <span style={{ width: `${String(closedShare(invoice))}%` }} />
      </div>
      <p className="owed-count">
        Сплачено {money(invoice.paid)} з {money(invoice.amount)}
        {invoice.last_payment_at &&
          ` · остання оплата ${shortDay(invoice.last_payment_at)}`}
      </p>
      {setOff > 0n && (
        <p className="owed-count">
          зараховано за повернений товар {money(invoice.set_off)}
        </p>
      )}
      {written > 0n && (
        <p className="owed-count">списано {money(invoice.written_off)}</p>
      )}
    </>
  );
}

/** What is owed on an invoice still open, large and in ink — never the
 * debts' red (stage 2, money task list, P0-2) — and how much is paid. */
export function InvoiceOwed({ invoice }: { invoice: Invoice }): JSX.Element {
  return (
    <div className="invoice-owed" role="group" aria-label="Скільки винні">
      <p className="owed-what">Винні</p>
      <p className="invoice-owed-sum t-money-l t-money-xl">
        <Sum value={money(invoice.owed)} />
      </p>
      <Progress invoice={invoice} />
    </div>
  );
}
