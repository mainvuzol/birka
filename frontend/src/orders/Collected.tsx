import { useEffect, useId, useRef } from "react";
import type { JSX } from "react";
import { RecordedMark } from "@/shared/Eyelet";
import { methodHow, methodLabels } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { OwedSum } from "@/shared/OwedSum";
import { Stub, WaySticker } from "@/shared/Stub";
import { Sum } from "@/shared/Sum";
import { kopecks, money } from "./types";
import type { Order } from "./types";

/** Over the sum taken, under the way's sticker: what to do with it, as the
 * till's receipt and a debt's payment say (orders task list, P0-3; owner
 * decision, 2026-10-23, В2 (а)). Cash, ahead or through the carrier,
 * nothing to do now. */
const waySays: Partial<Record<PaymentMethod, string>> = {
  CARD: "Проведіть на терміналі",
  TRANSFER: "Перевірте, що переказ надійшов",
};

/**
 * A card operation whose answer was lost, confirmed — maybe by the phone
 * itself, minutes or hours after the press. Following the paper text, the
 * seller may have charged the terminal meanwhile, so it says to charge it
 * only if nobody did (owner decision, 2026-10-07; ADR-0013 §5.6, G19). The
 * till's, a debt's and a collected order's.
 */
export function chargeOnce(amount: string): string {
  return `Якщо картку ще не провели — проведіть на терміналі ${money(amount)}. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.`;
}

/** Where the next payments are taken, as the till's receipt says it. */
const nextPayments = "Наступні внески — у «Продажі» › «Внесок».";

/** What is owed after it, in parts: from the server's answer. Heard so,
 * in one sentence. */
export function owedText(order: Order): string | null {
  return order.credit
    ? `Покупець винен ${money(order.credit.owed)}. ${nextPayments}`
    : null;
}

/**
 * What is owed, seen as the till's receipt shows it (audit 2026-11-15,
 * orders-cash P2-1): «Покупець винен» with the sum in the debt's colour and
 * its arrow, and where the next payments go on a line of its own — the words
 * as they were, the sum the server's. What is owed so far: once nothing is
 * left, nothing in the debt's colour (as S22's).
 */
function OwedLines({
  owed,
  className,
}: {
  owed: string;
  className?: string;
}): JSX.Element {
  return (
    <>
      <p className={className} aria-hidden="true">
        Покупець винен{" "}
        {(kopecks(owed) ?? 0n) > 0n ? <OwedSum value={owed} /> : money(owed)}
      </p>
      <p className={className} aria-hidden="true">
        {nextPayments}
      </p>
    </>
  );
}

/** «Змінити спосіб оплати» and «Оформити повернення», as the receipt has
 * them: for whoever opens «Каса» while the server says the way may be
 * changed, and whoever takes returns. Not answered yet on a card already
 * drawn, the link's place is held, unseen, so nothing under it moves when
 * it comes (audit 2026-11-15, orders-cash P2-3 (а); decided here). */
export function SaleLinks({
  fixWay,
  fixHeld = false,
  returnSale,
}: {
  fixWay?: (() => void) | undefined;
  fixHeld?: boolean;
  returnSale?: (() => void) | undefined;
}): JSX.Element {
  return (
    <>
      {fixWay ? (
        <button type="button" className="quiet" onClick={fixWay}>
          Змінити спосіб оплати
        </button>
      ) : (
        fixHeld && (
          <button
            type="button"
            className="quiet link-held"
            tabIndex={-1}
            aria-hidden="true"
          >
            Змінити спосіб оплати
          </button>
        )
      )}
      {returnSale && (
        // A sale is never changed: a mistake is returned, then sold again
        // (I8), as from the till's receipt.
        <p className="hint return-offer">
          Помилилися з товаром чи ціною?{" "}
          {/* A link of its sentence, as the till's receipt's (spec S11 №9;
              audit 2026-11-18, frame P2-1 (б)). */}
          <button type="button" className="text-button" onClick={returnSale}>
            Оформити повернення
          </button>
        </p>
      )}
    </>
  );
}

/**
 * «Клієнт забрав» recorded (orders task list, P0-3): «Продаж записано»,
 * the way with what to do, the sum taken large — the order's, or in parts
 * the part paid now — and what is owed, all from the server's answer; the
 * receipt's two quiet ways on, «До замовлень» the card's dock (audit
 * 2026-11-13, frame P2-9). A sale, so its stub torn off as the till's
 * receipt is (spec §6.30; stage 2, orders task list, P1-2).
 *
 * `kept`: a «Клієнт забрав» whose answer was lost, confirmed later — «…
 * записано один раз», the way alone, never «Проведіть»: a card may have
 * been taken meanwhile, and is never taken twice (review, 2026-10-24).
 */
export function Collected({
  order,
  kept,
  paidNow,
  fixWay,
  fixHeld = false,
  returnSale,
}: {
  order: Order;
  kept: boolean;
  /** In parts: what the attempt itself paid. Kept and confirmed after a
   * «Внесок» on another phone, the server's `paid` holds that one too —
   * «Сплачено зараз» and the terminal's sum are this sale's own, as the
   * till's kept sale says its `paid_now` (audit 2026-11-20, orders-cash
   * Н2). What is owed stays the server's. */
  paidNow?: string | undefined;
  fixWay?: (() => void) | undefined;
  fixHeld?: boolean;
  returnSale?: (() => void) | undefined;
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const sentence = useId();
  useEffect(() => {
    if (kept) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [kept]);
  const way = order.payment_method ?? null;
  const taken = order.credit ? (paidNow ?? order.credit.paid) : order.total;
  const owed = owedText(order);
  // Confirmed later, the way alone: a card may have been charged meanwhile.
  const say = !kept && way ? (waySays[way] ?? null) : null;
  return (
    <div className={`paid-result order-collected${kept ? " kept" : ""}`}>
      <h3
        ref={heading}
        tabIndex={-1}
        aria-describedby={sentence}
        className="result-title t-sheet"
      >
        {!kept && <RecordedMark />}
        {kept ? "Продаж записано один раз" : "Продаж записано"}
      </h3>
      <Stub state="recorded">
        {way && (
          <p className="stub-head">
            <WaySticker way={way} hidden />
          </p>
        )}
        {say !== null && (
          <p className="stub-say" aria-hidden="true">
            {say}
          </p>
        )}
        <p className="stub-sum" aria-hidden="true">
          {order.credit && (
            <span className="stub-sum-what">Сплачено зараз </span>
          )}
          <Sum value={money(taken)} />
        </p>
        <p id={sentence} className="visually-hidden">
          {order.credit ? "Сплачено зараз " : ""}
          {money(taken)}
          {way ? ` ${methodHow[way]}` : ""}.{say !== null ? ` ${say}.` : ""}
          {owed ? ` ${owed}` : ""}
        </p>
        {order.credit && (
          <OwedLines owed={order.credit.owed} className="stub-line" />
        )}
        {/* Said in ink: what to do at the terminal, or not. */}
        {kept && way === "CARD" && <p>{chargeOnce(taken)}</p>}
      </Stub>
      <SaleLinks fixWay={fixWay} fixHeld={fixHeld} returnSale={returnSale} />
    </div>
  );
}

/** A collected order seen later: the sale and its way, and the same ways
 * on — the way only to whoever the server gives it. */
export function CollectedLine({
  order,
  fixWay,
  fixHeld = false,
  returnSale,
}: {
  order: Order;
  fixWay?: (() => void) | undefined;
  fixHeld?: boolean;
  returnSale?: (() => void) | undefined;
}): JSX.Element {
  const owed = owedText(order);
  return (
    <>
      <p role="status">
        Продаж записано
        {order.payment_method ? ` · ${methodLabels[order.payment_method]}` : ""}
      </p>
      {owed && order.credit && (
        <>
          <p className="visually-hidden">{owed}</p>
          <OwedLines owed={order.credit.owed} />
        </>
      )}
      <SaleLinks fixWay={fixWay} fixHeld={fixHeld} returnSale={returnSale} />
    </>
  );
}
