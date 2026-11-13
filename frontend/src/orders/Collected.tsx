import { useEffect, useId, useRef } from "react";
import type { JSX } from "react";
import { RecordedMark } from "@/shared/Eyelet";
import { methodHow, methodLabels } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { Stub, WaySticker } from "@/shared/Stub";
import { Sum } from "@/shared/Sum";
import { money } from "./types";
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

/** What is owed after it, in parts: from the server's answer. */
export function owedText(order: Order): string | null {
  return order.credit
    ? `Покупець винен ${money(order.credit.owed)}. Наступні внески — у «Продажі» › «Внесок».`
    : null;
}

/** «Змінити спосіб оплати» and «Оформити повернення», as the receipt has
 * them: for whoever opens «Каса», and whoever takes returns. */
export function SaleLinks({
  fixWay,
  returnSale,
}: {
  fixWay?: (() => void) | undefined;
  returnSale?: (() => void) | undefined;
}): JSX.Element {
  return (
    <>
      {fixWay && (
        <button type="button" className="quiet" onClick={fixWay}>
          Змінити спосіб оплати
        </button>
      )}
      {returnSale && (
        // A sale is never changed: a mistake is returned, then sold again
        // (I8), as from the till's receipt.
        <p className="hint return-offer">
          Помилилися з товаром чи ціною?{" "}
          <button type="button" className="quiet" onClick={returnSale}>
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
  fixWay,
  returnSale,
}: {
  order: Order;
  kept: boolean;
  fixWay?: (() => void) | undefined;
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
  const taken = order.credit ? order.credit.paid : order.total;
  const owed = owedText(order);
  // Confirmed later, the way alone: a card may have been charged meanwhile.
  const say = !kept && way ? (waySays[way] ?? null) : null;
  return (
    <div className={`paid-result order-collected${kept ? " kept" : ""}`}>
      <h3
        ref={heading}
        tabIndex={-1}
        aria-describedby={sentence}
        className="result-title"
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
        {owed && (
          <p className="stub-line paid-owed" aria-hidden="true">
            {owed}
          </p>
        )}
        {/* Said in ink: what to do at the terminal, or not. */}
        {kept && way === "CARD" && <p>{chargeOnce(taken)}</p>}
      </Stub>
      <SaleLinks fixWay={fixWay} returnSale={returnSale} />
    </div>
  );
}

/** A collected order seen later: the sale and its way, and the same ways
 * on — the way only to whoever the server gives it. */
export function CollectedLine({
  order,
  fixWay,
  returnSale,
}: {
  order: Order;
  fixWay?: (() => void) | undefined;
  returnSale?: (() => void) | undefined;
}): JSX.Element {
  const owed = owedText(order);
  return (
    <>
      <p role="status">
        Продаж записано
        {order.payment_method ? ` · ${methodLabels[order.payment_method]}` : ""}
      </p>
      {owed && <p>{owed}</p>}
      <SaleLinks fixWay={fixWay} returnSale={returnSale} />
    </>
  );
}
