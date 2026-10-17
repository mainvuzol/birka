import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { refundHow } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { Sum } from "@/shared/Sum";
import { visible } from "@/shared/visible";
import { paperText } from "@/sales/paperMark";
import { useBackOnSale } from "./places";
import type { Refund, ReturnPart } from "./types";

/**
 * What the seller does with the money, by the way it goes back (ADR-0012
 * §B12, G39). An answer recorded before the way was asked names none.
 */
export function handBack(
  amount: string,
  way: TillMethod | null | undefined,
): string {
  switch (way) {
    case "CASH":
      return `Поверніть покупцю ${money(amount)} готівкою.`;
    case "CARD":
      return `Поверніть ${money(amount)} на картку покупця через термінал.`;
    case "TRANSFER":
      return `Надішліть покупцю ${money(amount)} переказом.`;
    default:
      return `Поверніть покупцю ${money(amount)}.`;
  }
}

/**
 * A return typed from paper: the money went back while the server did not
 * answer, the way the seller pressed (ADR-0021); or, from the first days'
 * paper, before the app took returns (owner decision, 2026-10-16).
 */
export function handedBack(
  amount: string,
  way: TillMethod | null | undefined,
  firstDays: boolean,
): string {
  const how = way ? ` ${refundHow[way]}` : "";
  return `${money(amount)}${how} повернули ${firstDays ? "раніше" : "під час збою"} — вдруге не повертайте.`;
}

/** Over the sum to hand back: the way, and what to do with it (P0-5). */
const wayPills: Record<TillMethod, string> = {
  CASH: "Готівка · Поверніть покупцю",
  CARD: "Картка · Поверніть на картку через термінал",
  TRANSFER: "Переказ · Надішліть покупцю переказом",
};

/**
 * Intact goods the seller sent to a warehouse of this store (owner
 * decision, 2026-10-01): the lines that named one, and its name where the
 * server says they went, from this store's warehouses as the form offered
 * them — read again when the form is gone. A name not found there is left
 * out, never said to be the warehouse they were sold from.
 */
export function useChosenPlaces(
  store: Store,
  token: string,
  refund: Refund,
  sent: readonly ReturnPart[],
): { chose: ReadonlySet<string>; placed: number; chosen: string | undefined } {
  const chose = new Set(
    sent.flatMap((part) =>
      part.location_id === undefined ? [] : [part.sale_item_id],
    ),
  );
  const placed = new Set(
    refund.items.flatMap((item) =>
      item.condition === "INTACT" &&
      chose.has(item.sale_item_id) &&
      item.destination_location_id !== null
        ? [item.destination_location_id]
        : [],
    ),
  );
  const ownPlaces = useBackOnSale(store, token, placed.size > 0);
  const named = (ownPlaces.data ?? []).filter((location) =>
    placed.has(location.id),
  );
  return {
    chose,
    placed: placed.size,
    chosen:
      named.length === placed.size
        ? named.map((location) => visible(location.name)).join("», «")
        : undefined,
  };
}

/**
 * A return recorded (returns task list, P0-5): in place of its form, as the
 * till's receipt is, what to hand back from the drawer, large — from the
 * server's answer, never worked out here — with the way as a pill over it,
 * and where each coat went, by the answer's lines. Typed from paper, the
 * money went back already, and it is never said to hand it back.
 */
export function Result({
  store,
  token,
  refund,
  sent,
  sell,
  more,
  blocked,
}: {
  store: Store;
  token: string;
  refund: Refund;
  /** The lines as sent: a line naming a warehouse is one the seller chose. */
  sent: readonly ReturnPart[];
  /** «Новий продаж»: the till, its cursor in the search; only for whoever
   * may sell. */
  sell?: (() => void) | undefined;
  /** Back to the list, its search as it was. */
  more: () => void;
  /** Whatever holds the sections holds the way to the till too. */
  blocked: boolean;
}): JSX.Element {
  // The form is gone: the screen reader starts here, and so does the page.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const paper = refund.outage ?? null;
  const firstDays = paper?.first_days === true;
  const way = refund.payment_method ?? null;
  const { credit } = refund;
  const amount = credit ? credit.cash_back : refund.total_amount;
  // Paid in parts, and nothing paid beyond the goods kept: no money goes
  // back (owner decision, 2026-10-01).
  const nothingBack = !!credit && (kopecks(credit.cash_back) ?? 0n) <= 0n;
  const elsewhere =
    !!refund.taken_at_store_id && refund.taken_at_store_id !== refund.store_id;
  const { chose, chosen } = useChosenPlaces(store, token, refund, sent);
  const units = (keep: (item: Refund["items"][number]) => boolean): number =>
    refund.items.filter(keep).reduce((n, item) => n + item.quantity, 0);
  const soldFrom = units(
    (item) => item.condition === "INTACT" && !chose.has(item.sale_item_id),
  );
  const here = units(
    (item) => item.condition === "INTACT" && chose.has(item.sale_item_id),
  );
  const damaged = units((item) => item.condition === "DAMAGED");
  return (
    <section className="return-result">
      <h2 ref={heading} tabIndex={-1}>
        Повернення записано
      </h2>
      {paper && <p className="badge">{paperText("return", paper)}</p>}
      {elsewhere && (
        <p>
          {paper
            ? "Товар куплено в іншому магазині мережі — гроші віддавав ваш магазин."
            : "Товар куплено в іншому магазині мережі — гроші віддаєте ви."}
        </p>
      )}
      <div className="hand-back">
        {nothingBack ? (
          <>
            <p className="hand-back-sum" aria-hidden="true">
              <Sum value={money("0.00")} />
            </p>
            <p>Грошей покупцю не повертаємо.</p>
          </>
        ) : paper ? (
          // Handed back already: what went, and the paper's words.
          <>
            <p className="hand-back-what" aria-hidden="true">
              {firstDays
                ? "Уже повернули раніше"
                : "Уже повернули під час збою"}
            </p>
            <p className="hand-back-sum" aria-hidden="true">
              <Sum value={money(amount)} />
            </p>
            <p>{handedBack(amount, way, firstDays)}</p>
          </>
        ) : (
          // Seen as the way and the sum; heard as the one sentence.
          <>
            <p className="badge way-pill" aria-hidden="true">
              {way ? wayPills[way] : "Поверніть покупцю"}
            </p>
            <p className="hand-back-sum" aria-hidden="true">
              <Sum value={money(amount)} />
            </p>
            <p className="visually-hidden">{handBack(amount, way)}</p>
          </>
        )}
      </div>
      {credit && (
        <>
          {(kopecks(credit.debt_reduced) ?? 0n) > 0n && (
            <p>Борг покупця зменшено на {money(credit.debt_reduced)}.</p>
          )}
          <p>
            {(kopecks(credit.owed_after) ?? 0n) > 0n
              ? `Покупець ще винен ${money(credit.owed_after)}.`
              : "Покупець більше нічого не винен."}
          </p>
        </>
      )}
      <div className="return-goods">
        {soldFrom > 0 && (
          <p>Цілі: {soldFrom} шт. — на склад, з якого продали.</p>
        )}
        {here > 0 && (
          <p>
            Цілі: {here} шт. — на склад {chosen ? `«${chosen}» ` : ""}вашого
            магазину.
          </p>
        )}
        {damaged > 0 && (
          // «Брак» is opened by whoever handles damaged goods.
          <p>
            Пошкоджені: {damaged} шт. — у «Брак».
            {store.permissions.includes("damaged:handle") &&
              " Перевірити можна в розділі «Брак»."}
          </p>
        )}
      </div>
      {sell ? (
        <div className="result-next">
          <button type="button" disabled={blocked} onClick={sell}>
            Новий продаж
          </button>
          <button type="button" className="quiet" onClick={more}>
            Ще повернення
          </button>
        </div>
      ) : (
        <div className="result-next">
          <button type="button" onClick={more}>
            До списку
          </button>
        </div>
      )}
    </section>
  );
}
