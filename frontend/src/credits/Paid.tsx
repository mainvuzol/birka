import { useEffect, useId, useRef } from "react";
import type { JSX } from "react";
import { money } from "@/orders/types";
import { paperText } from "@/sales/paperMark";
import type { PaperView } from "@/sales/paperMark";
import { methodHow, methodLabels } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { Sum } from "@/shared/Sum";
import type { Credit } from "./types";

/** Over the sum taken: the way, and what to do with it (credits task list,
 * P0-5; owner decision, 2026-10-18, В1 (а)), as the till's receipt says. */
const wayPills: Record<TillMethod, string> = {
  CASH: "Готівка",
  CARD: "Картка · Проведіть на терміналі",
  TRANSFER: "Переказ · Перевірте, що переказ надійшов",
};

/**
 * A payment's or a write-off's result (credits task list, P0-5): what was
 * done, the way with what to do, the sum large, and what is owed after — the
 * sum as sent and taken, what is owed from the server's answer. From paper,
 * the money was taken already: never «Проведіть», the paper's mark as the
 * history says it.
 *
 * `kept`: a command whose answer was lost, confirmed later (P1-2) — the same
 * block, compact, «… записано один раз», the way alone over the sum, and
 * `said` shown: what to do only if nobody did meanwhile; what was taken, how,
 * heard before it, where the eye reads the pill and the sum.
 */
export function Paid({
  kind,
  amount,
  way,
  paper,
  credit,
  said,
  kept = false,
  next,
}: {
  kind: "payment" | "write-off";
  /** The payment as sent and taken; for a write-off, what was written off. */
  amount: string;
  way: TillMethod | null;
  /** Typed from paper: who took it and when, as far as is known. */
  paper: PaperView | null;
  /** The server's answer. */
  credit: Credit;
  /**
   * The whole of it in one sentence: heard by a screen reader where the eye
   * reads the pill and the sum; shown from paper, and once confirmed later.
   */
  said: string;
  kept?: boolean;
  /**
   * Where to go from the result; none on a notice confirmed later. `back`
   * is named as the debt's «←» is: «До боргів», or the customer's name for
   * a debt opened from their card.
   */
  next?: { back: () => void; backTo: string; debt: () => void };
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const sentence = useId();
  useEffect(() => {
    if (kept) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [kept]);
  const payment = kind === "payment";
  // Seen in the sentence already, from paper and once confirmed later.
  const shown = kept || (payment && paper !== null);
  const firstDays = paper?.first_days === true;
  return (
    <div className={`paid-result${kept ? " kept" : ""}`}>
      <h3 ref={heading} tabIndex={-1} aria-describedby={sentence}>
        {payment
          ? kept
            ? "Внесок записано один раз"
            : "Внесок записано"
          : kept
            ? "Списання записано один раз"
            : "Борг списано"}
      </h3>
      <div className="hand-back">
        {payment &&
          (paper ? (
            <>
              <p className="badge warn" aria-hidden="true">
                {paperText("payment", paper)}
              </p>
              <p className="hand-back-what" aria-hidden="true">
                {firstDays ? "Уже взяли раніше" : "Уже взяли під час збою"}
              </p>
            </>
          ) : (
            way && (
              // Confirmed later, the way alone: «Проведіть» only under «Якщо
              // картку ще не провели» (owner decision, 2026-10-07).
              <p className="badge way-pill" aria-hidden="true">
                {kept ? methodLabels[way] : wayPills[way]}
              </p>
            )
          ))}
        <p className="hand-back-sum" aria-hidden="true">
          <Sum value={money(amount)} />
        </p>
        <p id={sentence} className={shown ? undefined : "visually-hidden"}>
          {kept && (
            // The pill and the sum, heard (review, 2026-10-18).
            <span className="visually-hidden">
              {payment
                ? `Внесок${paper ? " з паперу" : ""} ${money(amount)}${way ? ` ${methodHow[way]}` : ""}. `
                : `Списано ${money(amount)}. `}
            </span>
          )}
          {said}
        </p>
      </div>
      {!shown && payment && (
        <p className="paid-owed" aria-hidden="true">
          {credit.status === "SETTLED"
            ? "Борг сплачено повністю."
            : `Залишок боргу ${money(credit.owed)}`}
        </p>
      )}
      {next && (
        <div className="result-next">
          <button type="button" onClick={next.back}>
            {next.backTo}
          </button>
          <button type="button" className="quiet" onClick={next.debt}>
            Відкрити борг
          </button>
        </div>
      )}
    </div>
  );
}
