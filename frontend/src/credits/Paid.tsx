import { useEffect, useId, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { money } from "@/orders/types";
import { paperText } from "@/sales/paperMark";
import type { PaperView } from "@/sales/paperMark";
import { methodHow } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { Sum } from "@/shared/Sum";
import { RecordedMark } from "@/shared/Eyelet";
import { Perforation, Stub, WaySticker } from "@/shared/Stub";
import { useMainButton } from "@/shared/telegram";
import { OwedSum } from "@/shared/OwedSum";
import { ResultScreen } from "@/shared/ResultScreen";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { visible } from "@/shared/visible";
import { Sticker } from "@/shared/Sticker";
import type { Credit } from "./types";

/** Under the way's sticker: what to do with the money (credits task list,
 * P0-5; owner decision, 2026-10-18, В1 (а); spec S22), as the till's
 * receipt says. */
const waySays: Record<TillMethod, string> = {
  CASH: "У касу",
  CARD: "Проведіть на терміналі",
  TRANSFER: "Перевірте, що переказ надійшов",
};

/** The props of a payment's or a write-off's result. */
interface PaidProps {
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
   * The till's (spec S22): what the customer owes the store in all, read
   * again once the payment is recorded, or its place while it is read.
   */
  total?: ReactNode;
  /**
   * Where to go from the result; none on a notice confirmed later. `back`
   * is named as the debt's «←» is: «До боргів», or the customer's name for
   * a debt opened from their card.
   */
  next?: { back: () => void; backTo: string; debt: () => void };
}

/**
 * A payment's or a write-off's result (credits task list, P0-5): what was
 * done, the way with what to do, the sum large, and what is owed after — the
 * sum as sent and taken, what is owed from the server's answer. From paper,
 * the money was taken already: never «Проведіть», the paper's mark as the
 * history says it.
 *
 * Its own result's screen (spec S22; audit 2026-11-13, sale P1-1): the title
 * with its check where the debt's was, no «←» and no Telegram «Назад»; the
 * stub, and the screen's one main at the menu's top.
 *
 * `kept`: a command whose answer was lost, confirmed later (P1-2) — the same
 * block, compact, «… записано один раз», the way alone over the sum, and
 * `said` shown: what to do only if nobody did meanwhile; what was taken, how,
 * heard before it, where the eye reads the pill and the sum.
 */
export function Paid(props: PaidProps): JSX.Element {
  return props.kept ? <PaidKept {...props} /> : <PaidScreen {...props} />;
}

/** The way, what to do with the money, the sum large, and the sentence. */
function HandBack({
  kind,
  amount,
  way,
  paper,
  said,
  kept,
  sentence,
}: Pick<PaidProps, "kind" | "amount" | "way" | "paper" | "said"> & {
  kept: boolean;
  sentence: string;
}): JSX.Element {
  const payment = kind === "payment";
  // Seen in the sentence already, from paper and once confirmed later.
  const shown = kept || (payment && paper !== null);
  const firstDays = paper?.first_days === true;
  return (
    <div className="hand-back">
      {payment &&
        (paper ? (
          <>
            <Sticker tone="warn" as="p" hidden>
              {paperText("payment", paper)}
            </Sticker>
            <p className="hand-back-what" aria-hidden="true">
              {firstDays ? "Уже взяли раніше" : "Уже взяли під час збою"}
            </p>
          </>
        ) : (
          way && (
            // Confirmed later, the way alone: «Проведіть» only under «Якщо
            // картку ще не провели» (owner decision, 2026-10-07).
            <>
              <p className="stub-head">
                <WaySticker way={way} hidden />
              </p>
              {!kept && (
                <p className="stub-say" aria-hidden="true">
                  {waySays[way]}
                </p>
              )}
            </>
          )
        ))}
      <p className="hand-back-sum stub-sum" aria-hidden="true">
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
  );
}

/** What is left on the debt, read, in the debt's colour (sale P2-3). */
function Owed({ credit }: { credit: Credit }): JSX.Element {
  return (
    <p className="paid-owed stub-line" aria-hidden="true">
      {credit.status === "SETTLED" ? (
        "Борг сплачено повністю."
      ) : (
        <>
          Залишок боргу <OwedSum value={credit.owed} />
        </>
      )}
    </p>
  );
}

/** Confirmed later, in its notice: compact, «… записано один раз». */
function PaidKept(props: PaidProps): JSX.Element {
  const sentence = useId();
  const payment = props.kind === "payment";
  return (
    <div className="paid-result kept">
      <h3 aria-describedby={sentence}>
        {payment ? "Внесок записано один раз" : "Списання записано один раз"}
      </h3>
      <HandBack {...props} kept sentence={sentence} />
    </div>
  );
}

function PaidScreen({
  kind,
  amount,
  way,
  paper,
  credit,
  said,
  total,
  next,
}: PaidProps): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const sentence = useId();
  const payment = kind === "payment";
  // A payment's «Відкрити борг» is Telegram's MainButton where it is there
  // — the screen's one action, never one that pays («Усе на бірці» task
  // list, P1-2) — and the way back a quiet one under the stub; else the way
  // back is the screen's main, in its dock, «Відкрити борг» quiet (audit
  // after stage 2, frame P1-1, sale P1-5; audit 2026-11-13, sale P1-1). A
  // write-off's two stay the screen's own.
  const main = useMainButton(
    "Відкрити борг",
    () => {
      next?.debt();
    },
    { shown: payment && next !== undefined },
  );
  const telegrams = payment && main;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  // From paper, the sentence says what is left: not said twice.
  const shown = payment && paper !== null;
  // What she took (spec S22 №6): the debt's first good and «+ ще N», as the
  // debt's title said them; the rest on a tap.
  const [firstGood, ...moreGoods] = credit.goods.map(visible);
  const [allGoods, setAllGoods] = useState(false);
  const goodsList = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (allGoods) goodsList.current?.focus();
  }, [allGoods]);
  const title = payment ? "Внесок записано" : "Борг списано";
  return (
    <ResultScreen
      className="paid-result"
      dock={
        next &&
        !telegrams && (
          <button type="button" className="primary" onClick={next.back}>
            {next.backTo}
          </button>
        )
      }
    >
      <ScreenHeader
        ref={heading}
        focusable
        describedBy={sentence}
        className="result-title t-sheet"
        title={
          <>
            <RecordedMark />
            {title}
          </>
        }
      />
      {/* Its stub (spec S22; «Усе на бірці» task list, P0-2): knotted once
          nothing is left on the debt. */}
      <Stub state={credit.status === "SETTLED" ? "settled" : "recorded"}>
        <HandBack
          kind={kind}
          amount={amount}
          way={way}
          paper={paper}
          said={said}
          kept={false}
          sentence={sentence}
        />
        {payment && (
          <>
            <Perforation />
            {firstGood !== undefined && (
              <p className="stub-line paid-goods">
                {firstGood}
                {moreGoods.length > 0 && !allGoods && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="more-goods"
                      aria-expanded={false}
                      onClick={() => {
                        setAllGoods(true);
                      }}
                    >
                      + ще {moreGoods.length}
                    </button>
                  </>
                )}
              </p>
            )}
            {allGoods && moreGoods.length > 0 && (
              <ul
                ref={goodsList}
                className="debt-goods"
                aria-label="Товари боргу"
                tabIndex={-1}
              >
                {[firstGood, ...moreGoods].map((good, index) => (
                  <li key={index}>{good}</li>
                ))}
              </ul>
            )}
            {!shown && <Owed credit={credit} />}
            {total}
          </>
        )}
      </Stub>
      {next &&
        (telegrams ? (
          <button type="button" className="quiet paid-more" onClick={next.back}>
            {next.backTo}
          </button>
        ) : (
          <button type="button" className="quiet paid-more" onClick={next.debt}>
            Відкрити борг
          </button>
        ))}
    </ResultScreen>
  );
}
