import { useId } from "react";
import type { JSX } from "react";
import { kopecks, money } from "@/orders/types";
import { visible } from "@/shared/visible";
import { Eyelet } from "@/shared/Eyelet";
import { shortDay } from "@/credits/format";
import { InvoiceSticker } from "./InvoiceSticker";
import type { Invoice } from "./types";

/**
 * One invoice as a row tag (spec §6.9; stage 2, money task list, P0-1): its
 * eyelet filled in ink while it is owed — it waits on you — a knot once
 * paid or written off, none once cancelled. The supplier, and at the right
 * in ink, never the debts' red, what is owed — once closed, the sum on it.
 * Under them, in two lines at most: the day and who, what is paid of it or
 * its status as a sticker; the store it is of, its note, or the borrowed
 * goods it is for. Every sum the server's. A tap opens its card; «Сплатити»,
 * one verb at the bottom right, the payment at once.
 */
export function InvoiceTag({
  invoice,
  storeId,
  open,
  pay,
}: {
  invoice: Invoice;
  /** The store worked in: another's invoice says whose it is. */
  storeId: string;
  open: () => void;
  pay?: { held: boolean; go: () => void } | undefined;
}): JSX.Element {
  const title = useId();
  const sum = useId();
  const day = useId();
  const owed = invoice.status === "OPEN";
  const shape =
    invoice.status === "CANCELLED" ? "none" : owed ? "filled" : "tied";
  const paid = kopecks(invoice.paid) ?? 0n;
  const setOff = kopecks(invoice.set_off) ?? 0n;
  const meta = [`${shortDay(invoice.at)} · ${visible(invoice.by)}`];
  if (owed && paid > 0n)
    meta.push(`сплачено ${money(invoice.paid)} з ${money(invoice.amount)}`);
  if (owed && setOff > 0n) meta.push(`зараховано ${money(invoice.set_off)}`);
  const then = [
    ...(invoice.store_id !== storeId
      ? [`магазин «${visible(invoice.store_name)}»`]
      : []),
    ...(invoice.sold
      ? [
          `За продане позичене: ${visible(invoice.sold.label)} × ${String(invoice.sold.quantity)}`,
        ]
      : invoice.note
        ? [visible(invoice.note)]
        : []),
  ];
  return (
    <li>
      <article
        className={`order-tag invoice-tag tag-row tag-outline ${shape}`}
        aria-labelledby={title}
      >
        <div className="order-tag-body">
          <span className="order-tag-eyelet" aria-hidden="true">
            {shape === "tied" && <Eyelet state="knot" size={8} />}
          </span>
          <button type="button" className="order-row" onClick={open}>
            <span className="invoice-tag-head">
              <span className="order-tag-title t-row" id={title}>
                {visible(invoice.supplier.name)}
              </span>
              <span className="invoice-tag-sum" id={sum}>
                {money(owed ? invoice.owed : invoice.amount)}
              </span>
            </span>
            <span className="order-tag-meta t-meta" id={day}>
              {meta.join(" · ")}
            </span>
            {invoice.status !== "OPEN" && (
              <InvoiceSticker status={invoice.status} />
            )}
            {then.length > 0 && (
              <span className="order-tag-meta t-meta">{then.join(" · ")}</span>
            )}
          </button>
          {pay && (
            <button
              type="button"
              className="tag-verb"
              // Two of one supplier's told apart: its sum and its day.
              aria-describedby={`${title} ${sum} ${day}`}
              disabled={pay.held}
              onClick={pay.go}
            >
              Сплатити
            </button>
          )}
        </div>
      </article>
    </li>
  );
}
