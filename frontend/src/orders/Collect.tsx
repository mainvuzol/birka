import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { methodLabels } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { Sheet } from "@/shared/Sheet";
import { Sum } from "@/shared/Sum";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
import { titleOf } from "./Orders";
import { carrierLabels, collectHint, decimal, kopecks, money } from "./types";
import type { Order, Store } from "./types";

/**
 * How an order was paid, chosen at «Клієнт забрав» (owner decisions,
 * 2026-10-04; ADR-0012, B12): at the counter — cash, card or transfer
 * handed over now, as it is pressed (G1, G33) — or in advance by transfer,
 * or cash on delivery through the carrier. Nothing is chosen for the
 * seller; only the cash given now goes into the drawer. In the rows they
 * are said in (orders task list, P0-3).
 */
const collectWays: readonly {
  caption: string;
  ways: readonly PaymentMethod[];
}[] = [
  { caption: "Зараз, у магазині", ways: ["CASH", "CARD", "TRANSFER"] },
  {
    caption: "Наперед чи перевізнику",
    ways: ["PREPAID_TRANSFER", "CARRIER_COD"],
  },
];

/** How it goes, as the sheet names it: the carrier, or abroad. */
export function goesOf(order: Order): string | null {
  return order.destination === "ABROAD"
    ? "За кордон"
    : order.carrier
      ? carrierLabels[order.carrier]
      : null;
}

/**
 * «Клієнт забрав — як оплачено?» (spec §6.29; «Усе на бірці» sections task
 * list, P0-2): a sheet over the order's card — from its MainButton or its
 * row's verb — the sum large, «Зараз … · винен …» once a part is typed;
 * the two rows of ways (owner decision, 2026-10-23, В2 (а)), nothing
 * chosen, each the step itself; «Оплата частинами» under them, as the till
 * pays in parts. A way is never Telegram's MainButton (spec §4.4). A tap
 * carried from the press that opened it is let go by the sheet. Refused,
 * why over the ways.
 */
export function Collect({
  order,
  store,
  token,
  blocked,
  refusal,
  collect,
  close,
}: {
  order: Order;
  store: Store;
  /** Who asks what a number already owes, paying in parts. */
  token: string;
  blocked: boolean;
  refusal: string | null;
  collect: (extra: Record<string, unknown>) => void;
  close: () => void;
}): JSX.Element {
  const hint = useId();
  const mayCredit = store.permissions.includes("sale:credit");
  // Collected and paid in parts, as at the till (owner decision,
  // 2026-10-01).
  const [credit, setCredit] = useState<TermsInput>(noTerms);
  const [problem, setProblem] = useState("");
  // Why the terms were not taken, brought to the finger (review,
  // 2026-10-24).
  const why = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (problem) why.current?.focus();
  }, [problem]);
  const refused = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (refusal !== null) refused.current?.focus();
  }, [refusal]);
  const total = kopecks(order.total) ?? 0n;
  // In parts, what is paid now and what is left, once the part is a sum
  // under the whole, as the till's panel says it.
  const paidNow = credit.inParts ? kopecks(credit.paid) : null;
  const owing =
    paidNow !== null && paidNow > 0n && paidNow < total
      ? { now: paidNow, left: total - paidNow }
      : null;
  /** «Клієнт забрав» by a way: in parts, its terms checked first. */
  function pay(way: PaymentMethod): void {
    setProblem("");
    if (!credit.inParts) {
      collect({ payment_method: way });
      return;
    }
    const terms = checkTerms(credit, total);
    if (typeof terms === "string") setProblem(terms);
    else collect({ payment_method: way, credit: terms });
  }
  const goes = goesOf(order);
  return (
    <Sheet title="Клієнт забрав — як оплачено?" close={close} said={hint}>
      <p className="pay-what" id={hint}>
        {titleOf(order)}
        {goes ? ` · ${goes}` : ""}
      </p>
      <p className="pay-total">
        {owing ? (
          <>
            Зараз <Sum value={money(decimal(owing.now))} /> · винен{" "}
            <Sum value={money(decimal(owing.left))} />
          </>
        ) : (
          <>
            Разом <Sum value={money(order.total)} />
          </>
        )}
      </p>
      <p className="hint">{collectHint}</p>
      {refusal !== null && (
        <p role="alert" ref={refused} tabIndex={-1}>
          {refusal}
        </p>
      )}
      {problem && (
        <p role="alert" ref={why} tabIndex={-1}>
          {problem}
        </p>
      )}
      <div className="collect-ways">
        {collectWays.map(({ caption, ways }, index) => (
          <div
            key={caption}
            role="group"
            aria-labelledby={`${hint}-ways-${String(index)}`}
          >
            <p className="pay-caption" id={`${hint}-ways-${String(index)}`}>
              {caption}
            </p>
            <div className={`pay-ways${ways.length === 2 ? " two" : ""}`}>
              {ways.map((way) => (
                <button
                  type="button"
                  key={way}
                  disabled={blocked}
                  onClick={() => {
                    pay(way);
                  }}
                >
                  {methodLabels[way]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {mayCredit && (
        <fieldset disabled={blocked} className="collect-parts">
          {/* Read, not shown: the sheet asks «як оплачено?» already, and
              «Оплата частинами» says the rest. */}
          <legend className="visually-hidden">Оплата</legend>
          <TermsFields
            value={credit}
            change={(value) => {
              setCredit(value);
              setProblem("");
            }}
            total={total}
            // One line at 360 px, as at the till (credits task list,
            // P1-5): where the next payments are taken («Усе на бірці»
            // sections task list, P2-2; В5 (а)).
            hint="Решту — у «Продажі» › «Внесок»."
            // The debt's store, by construction.
            storeId={order.store_id}
            token={token}
          />
        </fieldset>
      )}
    </Sheet>
  );
}
