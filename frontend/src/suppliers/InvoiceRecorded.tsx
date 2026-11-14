import { useEffect, useRef } from "react";
import type { JSX, ReactNode } from "react";
import { money } from "@/orders/types";
import { RecordedMark } from "@/shared/Eyelet";
import { Perforation, Stub } from "@/shared/Stub";
import { Sum } from "@/shared/Sum";
import { useMainButton } from "@/shared/telegram";
import { restText } from "./invoiceWords";
import type { Invoice } from "./types";

/**
 * What an invoice's operation recorded, as its stub (spec §6.30, S22; stage
 * 2, money task list, P0-1, P0-2): the title with its check, the sum large,
 * the supplier, a perforation, and what is left — knotted once nothing is.
 * «Готово» is the screen's (`useRecordedDone`).
 */
export function InvoiceRecorded({
  title,
  invoice,
  sum,
  line,
}: {
  title: string;
  invoice: Invoice;
  /** What was recorded: the invoice's sum, or the payment as sent. */
  sum: string;
  /** «Ганна · накладна від 14.10». */
  line: string;
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const settled = invoice.status === "SETTLED";
  return (
    <div className="paid-result invoice-result">
      {/* The result's heading, 24/26 in the display face with its check,
          as «Продано 1 шт.» (spec §6.30; audit 2026-11-13, money P2-2
          (а)). */}
      <h3 ref={heading} tabIndex={-1} className="result-title t-sheet">
        <RecordedMark />
        {title}
      </h3>
      <Stub state={settled ? "settled" : "recorded"}>
        <div className="hand-back">
          <p className="hand-back-sum stub-sum">
            <Sum value={money(sum)} />
          </p>
          <p className="stub-say">{line}</p>
        </div>
        <Perforation />
        <p className="paid-owed stub-line">{restText(invoice)}</p>
      </Stub>
    </div>
  );
}

/**
 * The record's «Готово», to the invoice's card, once there is a record:
 * Telegram's MainButton where it is there; outside it, the MainButton's
 * place in the result's dock at the menu's top (spec §6.4, §6.5; audit
 * 2026-11-13, frame P2-9) — what this answers, for `ResultScreen`'s `dock`.
 * The screen's header and «←» stay the ones they were: the host keeps its
 * one tree, the result only turned on in it.
 */
export function useRecordedDone(next: (() => void) | null): ReactNode {
  const main = useMainButton(
    "Готово",
    () => {
      next?.();
    },
    { shown: next !== null },
  );
  if (next === null || main) return null;
  return (
    <button type="button" className="main-mimic" onClick={next}>
      Готово
    </button>
  );
}
