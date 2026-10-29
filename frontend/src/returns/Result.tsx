import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { refundHow } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { Sum } from "@/shared/Sum";
import { RecordedMark } from "@/shared/Eyelet";
import { Perforation, Stub, WaySticker } from "@/shared/Stub";
import { visible } from "@/shared/visible";
import { paperText } from "@/sales/paperMark";
import { isRecord } from "@/shared/journal";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { useBackOnSale } from "./places";
import { sizeLabel } from "./types";
import type { Refund, ReturnBody, ReturnPart } from "./types";

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
 * A kept return confirmed — maybe by the phone itself, hours after the
 * press. Following the paper text, the money may have been given back
 * meanwhile, so it says to give it back only if nobody did, as a card does
 * at the till (owner decision, 2026-10-08).
 */
export function handBackOnce(
  amount: string,
  way: TillMethod | null | undefined,
): string {
  const step = handBack(amount, way).replace(/\.$/, "");
  return `Якщо гроші ще не повернули — ${step.charAt(0).toLowerCase()}${step.slice(1)}. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.`;
}

/**
 * A kept return's banner (returns task list, P1-2): which customer it is —
 * the goods as counted, the sum as the button said it and the way — from
 * what the attempt kept beside its body, never the server's figures:
 * nobody knows yet whether it was recorded. A sale in parts names no sum.
 * An attempt kept before it said its goods, or whose goods do not read,
 * names its units and its way alone.
 */
export function keptReturnText(body: ReturnBody): string {
  const waits =
    "сервер не відповів. Двічі воно не запишеться, і гроші двічі не повернуться. Поки чекаємо, інші дії недоступні.";
  const how = body.payment_method ? refundHow[body.payment_method] : null;
  // Read back from storage, whatever TypeScript was told.
  const shown: unknown = body.shown;
  const tags = isRecord(shown) ? tagsOf(shown.lines) : null;
  if (tags !== null && isRecord(shown) && shown.parts === true)
    return `Повернення частинами: ${tags} — ${waits}`;
  const sum =
    isRecord(shown) && typeof shown.sum === "string" ? shown.sum : null;
  if (tags !== null && sum !== null && kopecks(sum) !== null)
    return `Повернення: ${tags} · ${money(sum)}${how ? ` ${how}` : ""} — ${waits}`;
  const units = body.lines.reduce((n, line) => n + line.quantity, 0);
  return `Повернення ${String(units)} шт.${how ? ` · ${how}` : ""} — ${waits}`;
}

/** «Лоран шоколад · M × 1, …», or nothing when a line does not read. */
function tagsOf(lines: unknown): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const tags: string[] = [];
  for (const line of lines as unknown[]) {
    if (
      !isRecord(line) ||
      typeof line.name !== "string" ||
      (line.size !== null && typeof line.size !== "string") ||
      typeof line.units !== "number" ||
      !Number.isInteger(line.units) ||
      line.units < 1
    )
      return null;
    tags.push(
      `${visible(line.name)} · ${sizeLabel(line.size)} × ${String(line.units)}`,
    );
  }
  return tags.join(", ");
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

/**
 * «Помилилися з поверненням? …», under a return's result (P1-5): the till
 * and «Брак» as instructions to whoever may use them, as how it is done to
 * anyone else.
 */
function mistakeText(
  inParts: boolean,
  damaged: boolean,
  sells: boolean,
  handlesDamaged: boolean,
): string {
  if (inParts)
    return "Помилилися з поверненням? Помилку з продажем частинами вирішує власник.";
  const sell = sells
    ? "Продайте ці речі знову на касі"
    : "Ці речі продають знову на касі";
  const first = !damaged
    ? ""
    : handlesDamaged
      ? "; пошкоджене спершу поверніть у продаж у «Браку»"
      : "; пошкоджене спершу повертають у продаж у «Браку»";
  return `Помилилися з поверненням? ${sell}${first}.`;
}

/** Under the way's sticker: what to do with the money (P0-5; «Усе на
 * бірці» task list, P0-2). */
const refundSays: Record<TillMethod, string> = {
  CASH: "Поверніть покупцю",
  CARD: "Поверніть на картку через термінал",
  TRANSFER: "Надішліть покупцю переказом",
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

/** What follows the result: a live one's next steps, or a kept one's notice. */
type Next =
  | {
      /** A kept return confirmed, in its notice (`App.tsx`), compact. */
      kept: true;
    }
  | {
      kept?: false;
      /** «Новий продаж»: the till, its cursor in the search; only for
       * whoever may sell. */
      sell?: (() => void) | undefined;
      /** Back to the list, its search as it was. */
      more: () => void;
      /** Whatever holds the sections holds the way to the till too. */
      blocked: boolean;
    };

/**
 * A return recorded (returns task list, P0-5): in place of its form, as the
 * till's receipt is, what to hand back from the drawer, large — from the
 * server's answer, never worked out here — with the way as a pill over it,
 * and where each coat went, by the answer's lines. Typed from paper, the
 * money went back already, and it is never said to hand it back.
 *
 * A kept return confirmed later shows the same block, compact, in its
 * notice (P1-2): «Повернення записано один раз», and the money to give back
 * only if nobody did meanwhile (owner decision, 2026-10-08).
 */
export function Result({
  store,
  token,
  refund,
  sent,
  ...next
}: {
  store: Store;
  token: string;
  refund: Refund;
  /** The lines as sent: a line naming a warehouse is one the seller chose. */
  sent: readonly ReturnPart[];
} & Next): JSX.Element {
  // The form is gone: the screen reader starts here, and so does the page.
  // A kept one's notice comes above whatever is open, and takes nothing.
  const heading = useRef<HTMLHeadingElement>(null);
  const kept = next.kept === true;
  useEffect(() => {
    if (!kept) heading.current?.focus();
  }, [kept]);
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
  // The money, large: its way's sticker and what to do with it over the sum
  // (spec §6.30). Confirmed later, the way alone, and «Поверніть» said only
  // under «Якщо гроші ще не повернули» (owner decision, 2026-10-08; review,
  // 2026-10-18).
  const handed = nothingBack ? (
    <>
      <p className="hand-back-sum stub-sum" aria-hidden="true">
        <Sum value={money("0.00")} />
      </p>
      <p>Грошей покупцю не повертаємо.</p>
    </>
  ) : paper ? (
    // Handed back already: what went, and the paper's words.
    <>
      <p className="hand-back-what" aria-hidden="true">
        {firstDays ? "Уже повернули раніше" : "Уже повернули під час збою"}
      </p>
      <p className="hand-back-sum stub-sum" aria-hidden="true">
        <Sum value={money(amount)} />
      </p>
      <p>{handedBack(amount, way, firstDays)}</p>
    </>
  ) : (
    // Seen as the way and the sum; heard as the one sentence.
    <>
      {!kept && (
        <p className="stub-say" aria-hidden="true">
          {way ? refundSays[way] : "Поверніть покупцю"}
        </p>
      )}
      <p className="hand-back-sum stub-sum" aria-hidden="true">
        <Sum value={money(amount)} />
      </p>
      {kept ? (
        // Confirmed later: said whole, and only if nobody did.
        <p>{handBackOnce(amount, way)}</p>
      ) : (
        <p className="visually-hidden">{handBack(amount, way)}</p>
      )}
    </>
  );
  const stickers = (paper || (way && !nothingBack)) && (
    <p className="stub-head">
      {way && !paper && !nothingBack && <WaySticker way={way} hidden />}
      {paper && (
        <span className="badge warn">{paperText("return", paper)}</span>
      )}
    </p>
  );
  const debt = credit && (
    <>
      {(kopecks(credit.debt_reduced) ?? 0n) > 0n && (
        <p className="stub-line">
          Борг покупця зменшено на {money(credit.debt_reduced)}.
        </p>
      )}
      <p className="stub-line">
        {(kopecks(credit.owed_after) ?? 0n) > 0n
          ? `Покупець ще винен ${money(credit.owed_after)}.`
          : "Покупець більше нічого не винен."}
      </p>
    </>
  );
  const goods = (
    <div className="return-goods">
      {soldFrom > 0 && (
        <p className="stub-line">
          Цілі: {soldFrom} шт. — на склад, з якого продали.
        </p>
      )}
      {here > 0 && (
        <p className="stub-line">
          Цілі: {here} шт. — на склад {chosen ? `«${chosen}» ` : ""}вашого
          магазину.
        </p>
      )}
      {damaged > 0 && (
        // «Брак» is opened by whoever handles damaged goods.
        <p className="stub-line damaged-line">
          Пошкоджені: {damaged} шт. — у «Брак».
          {store.permissions.includes("damaged:handle") &&
            " Перевірити можна в розділі «Брак»."}
        </p>
      )}
    </div>
  );
  const elsewhereLine = elsewhere && (
    <p>
      {paper
        ? "Товар куплено в іншому магазині мережі — гроші віддавав ваш магазин."
        : "Товар куплено в іншому магазині мережі — гроші віддаєте ви."}
    </p>
  );
  // A kept return confirmed later, compact, in its own stub (`App.tsx`).
  if (next.kept)
    return (
      <div className="return-result kept">
        <h3>Повернення записано один раз</h3>
        {paper && <p className="badge warn">{paperText("return", paper)}</p>}
        {elsewhereLine}
        <div className="hand-back">
          {way && !paper && !nothingBack && (
            <p className="stub-head">
              <WaySticker way={way} hidden />
            </p>
          )}
          {handed}
        </div>
        {debt}
        {goods}
      </div>
    );
  return (
    <section className="return-result receipt">
      <ScreenHeader
        ref={heading}
        focusable
        className="result-title t-sheet"
        title={
          <>
            <RecordedMark />
            Повернення записано
          </>
        }
      />
      {elsewhereLine}
      <Stub state="recorded">
        {stickers}
        <div className="hand-back">{handed}</div>
        {debt}
        <Perforation />
        {goods}
      </Stub>
      {/* How a mistaken return is mended (owner decision, 2026-10-17,
          В2 (а); returns task list, P1-5): sold again at the till, damaged
          goods first put back on sale in «Брак»; a sale in parts, by the
          owner. What this person cannot open is said, never offered. */}
      <p className="hint return-mistake">
        {mistakeText(
          !!credit,
          damaged > 0,
          store.permissions.includes("sale:create"),
          store.permissions.includes("damaged:handle"),
        )}
      </p>
      {/* «Новий продаж» under the thumb; another return and the list,
          quiet (spec §6.5). */}
      <div className="result-next">
        {next.sell && (
          <button type="button" disabled={next.blocked} onClick={next.sell}>
            Новий продаж
          </button>
        )}
        <button type="button" className="quiet" onClick={next.more}>
          {next.sell ? "Ще повернення" : "До списку"}
        </button>
      </div>
    </section>
  );
}
