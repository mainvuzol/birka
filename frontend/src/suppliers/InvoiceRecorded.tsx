import { useEffect, useRef } from "react";
import type { JSX } from "react";
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
 * «Готово», Telegram's MainButton where it is there, to the invoice's card.
 */
export function InvoiceRecorded({
  title,
  invoice,
  sum,
  line,
  next,
}: {
  title: string;
  invoice: Invoice;
  /** What was recorded: the invoice's sum, or the payment as sent. */
  sum: string;
  /** «Ганна · накладна від 14.10». */
  line: string;
  next: () => void;
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const main = useMainButton("Готово", next);
  const settled = invoice.status === "SETTLED";
  return (
    <div className="paid-result invoice-result">
      <h3 ref={heading} tabIndex={-1} className="result-title">
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
      {!main && (
        <div className="result-next">
          <button type="button" onClick={next}>
            Готово
          </button>
        </div>
      )}
    </div>
  );
}
