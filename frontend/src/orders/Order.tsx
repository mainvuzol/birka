import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { methodLabels } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { Sum } from "@/shared/Sum";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
import { Collected, CollectedLine } from "./Collected";
import { since, sinceDay, tagOf } from "./Orders";
import { Returned, byPlace } from "./Returned";
import { Shipping } from "./Shipping";
import {
  carrierLabels,
  collectHint,
  decimal,
  kopecks,
  money,
  shippingText,
  statusLabels,
  statusPills,
} from "./types";
import type {
  Carrier,
  Location,
  Order,
  OrderItem,
  SameWaybill,
  ShippingChange,
  Store,
} from "./types";

/** What each step is called where it is kept, refused or said. */
export const actionLabels: Record<string, string> = {
  shipping: "Зміна доставки",
  dispatch: "Відправлено",
  arrive: "Прибув на пошту",
  collect: "Клієнт забрав",
  cancel: "Скасувати замовлення",
  return: "Прийняти повернення",
};

/** An order as its card's title says it: its first goods, and how many
 * more (orders task list, P0-2). */
function titleOf(order: Order): string {
  const [first] = order.items;
  const more = order.items.length - 1;
  return first
    ? `${tagOf(first)}${more > 0 ? ` + ще ${String(more)}` : ""}`
    : "Замовлення";
}

/** How it goes, as the card's panel names it: the carrier, or abroad. */
function goesOf(order: Order): string | null {
  return order.destination === "ABROAD"
    ? "За кордон"
    : order.carrier
      ? carrierLabels[order.carrier]
      : null;
}

/**
 * What a step on an order is about, kept beside it for its banner while its
 * answer is unknown (orders task list, P1-1): the goods, and how they go —
 * a shipping change the delivery it sets, whole (the server replaces it);
 * any other step the order's, with the waybill sent with it or its own.
 */
export function stepShown(
  order: Order,
  extra: Record<string, unknown> = {},
): string {
  const setting =
    extra.destination === "UKRAINE" || extra.destination === "ABROAD";
  const goes = setting
    ? extra.destination === "ABROAD"
      ? "За кордон"
      : typeof extra.carrier === "string" && extra.carrier in carrierLabels
        ? carrierLabels[extra.carrier as Carrier]
        : null
    : goesOf(order);
  const waybill =
    typeof extra.waybill === "string"
      ? extra.waybill
      : setting
        ? null
        : order.waybill;
  return [titleOf(order), goes, waybill ? `ТТН ${visible(waybill)}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** What a step just recorded says on its order (orders task list, P0-2):
 * the step, and for a parcel sent its waybill, or that it may come later;
 * a new order, how many units it holds now (P0-5); come back, how many went
 * back to which warehouse, by the warehouses read for it (P2-4). */
export function stepDone(
  action: string,
  order: Order,
  places?: readonly Location[],
): string | null {
  // Confirmed late, it may have moved on meanwhile: then nothing said.
  if (action === "reserve")
    return order.status === "READY_TO_DISPATCH"
      ? `Зарезервовано: ${String(order.items.reduce((n, item) => n + item.quantity, 0))} шт. Чекає відправлення.`
      : null;
  if (action === "cancel") return "Замовлення скасовано, резерв звільнено.";
  if (action === "arrive") return "Прибув на пошту";
  // Its own step, said on the card it went back to (P1-3).
  if (action === "shipping") return "Доставку збережено";
  if (action === "return") return returnedText(order, places ?? []);
  if (action !== "dispatch") return null;
  if (order.destination === "ABROAD") return "Відправлено.";
  return order.waybill
    ? `Відправлено · ТТН ${visible(order.waybill)}`
    : "Відправлено. ТТН можна вписати пізніше.";
}

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

/** A line's sum: its price less its discount, for every unit. */
function lineSum(item: OrderItem): string {
  const each =
    (kopecks(item.unit_price) ?? 0n) - (kopecks(item.discount_amount) ?? 0n);
  return money(decimal(each * BigInt(item.quantity)));
}

interface CardProps {
  order: Order;
  /** What the step just taken on it did. */
  done: string | null;
  /** «Клієнт забрав» just recorded on it — at its press, or kept and
   * confirmed later: its result, not its line. */
  collected: "now" | "kept" | null;
  store: Store;
  /** Who asks what a number already owes, paying in parts. */
  token: string;
  blocked: boolean;
  action: (action: string, extra?: Record<string, unknown>) => void;
  /** «До замовлень». */
  back: () => void;
  /** «Каса» on its sale, for whoever opens «Каса». */
  fixWay?: (() => void) | undefined;
  /** «Повернення» on its sale, for whoever takes returns. */
  returnSale?: (() => void) | undefined;
  /** Another order with the same waybill, opened from its row. */
  openOther: (id: string) => void;
}
/**
 * An order's place while it is read (orders task list, P2-2): its title,
 * its line of context, its pill and two of its lines, in their sizes; a
 * screen reader hears «Завантажуємо замовлення…».
 */
export function CardPlaceholder(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо замовлення…
      </p>
      <div className="placeholder order-placeholder" aria-hidden="true">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-meta" />
        <span className="skeleton skeleton-pill" />
        {[0, 1].map((n) => (
          <div className="order-line" key={n}>
            <span className="skeleton skeleton-name" />
            <span className="skeleton skeleton-owed" />
          </div>
        ))}
      </div>
    </>
  );
}

/** «Повернено на склад «Свій»: 1 шт.», a sentence for each warehouse the
 * units went back to; a warehouse not read, unnamed (P2-4). */
function returnedText(order: Order, places: readonly Location[]): string {
  const names = new Map(places.map((place) => [place.id, place.name]));
  const lines = byPlace(order);
  const units = (items: readonly OrderItem[]): string =>
    `${String(items.reduce((n, item) => n + item.quantity, 0))} шт.`;
  if (!lines.every(([id]) => names.has(id)))
    return `Повернено на ${lines.length > 1 ? "склади" : "склад"} відправлення: ${units(order.items)}`;
  return lines
    .map(
      ([id, items]) =>
        `Повернено на склад «${visible(names.get(id) ?? "")}»: ${units(items)}`,
    )
    .join(" ");
}

/**
 * One order: its card, and over it a rare step on a screen of its own —
 * where it goes (orders task list, P1-3) or the goods come back (P2-4) —
 * the card kept under it with what was typed there, «← Замовлення» back to
 * it with the row that opened it in focus. Taken, the card is mounted
 * afresh with what it did.
 */
export function OrderDetail(props: CardProps): JSX.Element {
  const [step, setStep] = useState<"write" | "change" | "return" | null>(null);
  const back = (): void => {
    setStep(null);
  };
  // The card first: its panel's room let go before the step's is kept.
  return (
    <>
      <Card
        {...props}
        away={step === null ? null : step === "return" ? "return" : "shipping"}
        changeShipping={(writing) => {
          setStep(writing ? "write" : "change");
        }}
        takeBack={() => {
          setStep("return");
        }}
      />
      {(step === "write" || step === "change") && (
        <Shipping
          order={props.order}
          title={titleOf(props.order)}
          writing={step === "write"}
          blocked={props.blocked}
          back={back}
          save={(body) => {
            props.action("shipping", body);
          }}
        />
      )}
      {step === "return" && (
        <Returned
          order={props.order}
          store={props.store}
          token={props.token}
          title={titleOf(props.order)}
          blocked={props.blocked}
          back={back}
          take={(body) => {
            props.action("return", body);
          }}
        />
      )}
    </>
  );
}

/**
 * One order (orders task list, P0-2): what it is and where it goes on top —
 * its goods as its title, how it goes, since when, its number small, its
 * status; its lines with their sums and «Разом» large; the next step one
 * button in the panel under the thumb, what it needs over the panel; the
 * rare at the foot. «Клієнт забрав» is its five ways, each the step itself
 * (P0-3); collected, the sale said large, then later in a line.
 */
function Card({
  order,
  done,
  collected,
  store,
  token,
  blocked,
  action,
  back,
  fixWay,
  returnSale,
  openOther,
  away,
  changeShipping,
  takeBack,
}: CardProps & {
  /** A rare step shown over it, which: hidden, its panel with it. */
  away: "shipping" | "return" | null;
  /** Where it goes, its own step: to write the waybill, or to change it. */
  changeShipping: (writing: boolean) => void;
  /** «Товар повернувся на склад», its own step. */
  takeBack: () => void;
}): JSX.Element {
  const hint = useId();
  // Collected and paid in parts, as at the till (owner decision, 2026-10-01).
  const [credit, setCredit] = useState<TermsInput>(noTerms);
  const [problem, setProblem] = useState("");
  // Why the terms were not taken, brought to the finger over the panel
  // (review, 2026-10-24).
  const why = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (problem) why.current?.focus();
  }, [problem]);
  // Shown at once after a step, the next step's buttons stand where the
  // last was pressed: a tap meant for it, landing on them, is let go
  // (review, 2026-10-24). The card is mounted afresh on every step.
  const [shownAt] = useState(() => performance.now());
  function late(event: { timeStamp: number }): boolean {
    return done !== null && event.timeStamp - shownAt < CARRIED_TAP;
  }
  // What a step did is seen with what it was done to: a new order opens
  // here from the foot of its long form (orders task list, P0-5).
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done !== null) heading.current?.scrollIntoView({ block: "nearest" });
  }, [done]);
  // Back from a rare step: the row that opened it in focus, and a tap
  // carried from «← Замовлення» onto «← До замовлень» let go.
  const shippingRow = useRef<HTMLButtonElement>(null);
  const returnRow = useRef<HTMLButtonElement>(null);
  const opened = useRef<"shipping" | "return" | null>(null);
  const backAt = useRef(-Infinity);
  useEffect(() => {
    if (away !== null) opened.current = away;
    else if (opened.current !== null) {
      backAt.current = performance.now();
      (opened.current === "return" ? returnRow : shippingRow).current?.focus();
    }
  }, [away]);
  // The waybill, or abroad where and how it went, written as it is sent.
  const [sentWith, setSentWith] = useState("");
  const mayStep = store.permissions.includes("sale:create");
  const mayCredit = store.permissions.includes("sale:credit");
  const open = ["READY_TO_DISPATCH", "DISPATCHED", "ARRIVED"].includes(
    order.status,
  );
  const next = {
    READY_TO_DISPATCH: "dispatch",
    DISPATCHED: "arrive",
    ARRIVED: "collect",
  }[order.status as "READY_TO_DISPATCH" | "DISPATCHED" | "ARRIVED"];
  // The panel's step: sent, arrived, or «Клієнт забрав» by its ways. None
  // while a rare step is over the card: one press at a time under the thumb
  // (review, 2026-10-23).
  const panelStep = mayStep && open && away === null ? next : null;
  // Sent within Ukraine with no waybill: written later, as it often is
  // (orders task list, P1-3). Before it is sent, the field over the panel.
  const writeLater =
    order.destination === "UKRAINE" &&
    !order.waybill &&
    order.status !== "READY_TO_DISPATCH";
  const total = kopecks(order.total) ?? 0n;
  // In parts, what is paid now and what is left, once the part is a sum
  // under the whole, as the till's panel says it.
  const paidNow = credit.inParts ? kopecks(credit.paid) : null;
  const owing =
    paidNow !== null && paidNow > 0n && paidNow < total
      ? { now: paidNow, left: total - paidNow }
      : null;
  /** «Клієнт забрав» by a way: in parts, its terms checked first. */
  function collect(way: PaymentMethod): void {
    setProblem("");
    if (!credit.inParts) {
      action("collect", { payment_method: way });
      return;
    }
    const terms = checkTerms(credit, total);
    if (typeof terms === "string") setProblem(terms);
    else action("collect", { payment_method: way, credit: terms });
  }
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, panelStep !== null);
  const title = titleOf(order);
  const goes = goesOf(order);
  return (
    <section className="order" hidden={away !== null}>
      <button
        type="button"
        className="quiet"
        onClick={(event) => {
          if (event.timeStamp - backAt.current < CARRIED_TAP) return;
          back();
        }}
      >
        ← До замовлень
      </button>
      <h2 className="order-title" ref={heading}>
        {title}
      </h2>
      <p className="order-context">
        {shippingText(order)}
        {since(order.created_at)}
      </p>
      {done && <p role="status">{done}</p>}
      {/* Its status, and its number small beside it (owner decision,
          2026-10-23, В1): the context one line at 360 px. */}
      <p className="order-status">
        <span className={statusPills[order.status]}>
          {statusLabels[order.status]}
        </span>
        <small className="order-number">№ {order.id.slice(0, 8)}</small>
      </p>
      {order.same_waybill && order.same_waybill.length > 0 && (
        // Saved anyway: several orders may go in one parcel (owner decision,
        // 2026-10-01). Each other order its row, opened by a tap (orders
        // task list, P1-3), never its eight characters (В1).
        <div className="notice same-waybill">
          <p>
            {order.same_waybill.length === 1
              ? "Ця ТТН є також у замовленні — перевірте, чи це один пакунок."
              : "Ця ТТН є також у замовленнях — перевірте, чи це один пакунок."}
          </p>
          <ul className="order-rows" aria-label="Замовлення з цією ТТН">
            {order.same_waybill.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  className="sale-row order-row"
                  onClick={() => {
                    openOther(other.id);
                  }}
                >
                  <span className="sale-main">
                    <span className="sale-goods">{sameTitle(other)}</span>
                    {other.created_at && (
                      <span className="sale-meta">
                        {sinceDay(other.created_at)}
                      </span>
                    )}
                    <span className={statusPills[other.status]}>
                      {statusLabels[other.status]}
                    </span>
                  </span>
                  <span className="sale-open" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="order-lines" aria-label="Товар">
        {order.items.map((item) => {
          const discounted = kopecks(item.discount_amount) !== 0n;
          return (
            <li className="order-line" key={item.id}>
              <span className="sale-main">
                <span className="cash-row-title">{tagOf(item)}</span>
                {(item.quantity > 1 || discounted) && (
                  <span className="sale-meta">
                    {money(item.unit_price)} за 1 шт.
                    {discounted
                      ? ` · знижка ${money(item.discount_amount)} за 1 шт.`
                      : ""}
                  </span>
                )}
              </span>
              <span className="history-sum">{lineSum(item)}</span>
            </li>
          );
        })}
      </ul>
      {/* Just collected, the sum taken stands large alone (review,
          2026-10-24). */}
      {collected === null && (
        <p className="order-total">
          Разом <Sum value={money(order.total)} />
        </p>
      )}
      {order.status === "READY_TO_DISPATCH" && (
        <p className="hint reserve-hint">
          Товар у резерві — на касі його не продадуть.
        </p>
      )}
      {panelStep === "dispatch" && order.destination && (
        // What the step needs, under the sum and over the panel where it
        // stands: the waybill, or abroad where and how it went, now or
        // later.
        <label className="order-sent-with">
          {order.destination === "ABROAD"
            ? "Куди і як відправили: місто, країна, спосіб"
            : "Номер ТТН"}{" "}
          (можна дописати пізніше)
          <input
            value={sentWith}
            maxLength={order.destination === "ABROAD" ? 1000 : 64}
            disabled={blocked}
            aria-describedby={
              order.destination === "ABROAD" ? `${hint}-sent` : undefined
            }
            onChange={(event) => {
              setSentWith(event.target.value);
            }}
          />
          {order.destination === "ABROAD" && (
            <NoCustomerData id={`${hint}-sent`} />
          )}
        </label>
      )}
      {order.sale_id &&
        (collected ? (
          <Collected
            order={order}
            kept={collected === "kept"}
            back={back}
            fixWay={fixWay}
            returnSale={returnSale}
          />
        ) : (
          <CollectedLine
            order={order}
            fixWay={fixWay}
            returnSale={returnSale}
          />
        ))}
      {panelStep === "collect" && (
        <>
          <p className="hint">{collectHint}</p>
          {mayCredit && (
            <fieldset disabled={blocked}>
              <legend>Оплата</legend>
              <TermsFields
                value={credit}
                change={(value) => {
                  setCredit(value);
                  setProblem("");
                }}
                total={total}
                // One line at 360 px, as at the till (credits task list,
                // P1-5): the order is this store's, as its words before said.
                hint="Решту — у «Боргах» цього магазину."
                // The debt's store, by construction.
                storeId={order.store_id}
                token={token}
              />
            </fieldset>
          )}
          {problem && (
            <p role="alert" ref={why} tabIndex={-1}>
              {problem}
            </p>
          )}
        </>
      )}
      {open && mayStep && (
        <button
          type="button"
          className="quiet order-rare"
          ref={shippingRow}
          disabled={blocked}
          onClick={() => {
            changeShipping(writeLater);
          }}
        >
          {writeLater ? "ТТН ще немає — вписати" : "Змінити доставку"}{" "}
          <span aria-hidden="true">›</span>
        </button>
      )}
      {order.shipping_history && order.shipping_history.length > 0 && (
        // Each version a row (orders task list, P1-3): what it was, when
        // and by whom; how it went on the right.
        <>
          <h3 className="shipping-changes-title">Історія доставки</h3>
          <ul className="shipping-changes" aria-label="Історія доставки">
            {order.shipping_history.map((change, index) => (
              <li
                className="shipping-change"
                key={`${change.at}:${String(index)}`}
              >
                <span className="sale-main">
                  <span className="shipping-kind">
                    {shippingKinds[change.kind]}
                  </span>
                  <span className="sale-meta">
                    {at(change.at)} · {visible(change.by)}
                  </span>
                </span>
                <span className="shipping-how">{shippingText(change)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* At the card's foot, asked first: a cancel is for good, and the
          reserve is sold at once (orders task list, P0-4). */}
      {order.status === "READY_TO_DISPATCH" && mayStep && (
        <CancelOrder
          blocked={blocked}
          cancel={() => {
            action("cancel");
          }}
        />
      )}
      {["DISPATCHED", "ARRIVED"].includes(order.status) &&
        store.permissions.includes("sale:refund") &&
        store.permissions.includes("inventory:receive") && (
          // Its own step, the last row of the card's foot (orders task list,
          // P2-4).
          <button
            type="button"
            className="quiet order-rare"
            ref={returnRow}
            disabled={blocked}
            onClick={takeBack}
          >
            Товар повернувся на склад <span aria-hidden="true">›</span>
          </button>
        )}
      {panelStep === "collect" ? (
        // «Клієнт забрав»: each way the step itself, nothing chosen first
        // (owner decision, 2026-10-23, В2 (а)) — at the counter now, or
        // paid ahead or to the carrier.
        <div
          className="pay-panel order-panel"
          role="group"
          aria-label="Клієнт забрав — як оплачено?"
          ref={panel}
        >
          <p className="pay-what">
            {title}
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
                    onClick={(event) => {
                      if (late(event)) return;
                      collect(way);
                    }}
                  >
                    {methodLabels[way]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        panelStep && (
          <div className="pay-panel order-panel" ref={panel}>
            <p className="pay-what">
              {title}
              {goes ? ` · ${goes}` : ""}
            </p>
            <button
              type="button"
              disabled={blocked}
              onClick={(event) => {
                if (late(event)) return;
                if (panelStep === "arrive") {
                  action("arrive");
                  return;
                }
                const written = sentWith.trim();
                action(
                  "dispatch",
                  written
                    ? order.destination === "ABROAD"
                      ? { abroad_note: written }
                      : { waybill: written }
                    : undefined,
                );
              }}
            >
              {actionLabels[panelStep]}
            </button>
          </div>
        )
      )}
    </section>
  );
}

/**
 * «Скасувати замовлення», asked first where it stands: what it does, and
 * that it is for good (orders task list, P0-4). The focus on «Ні,
 * залишити», the safe one.
 */
function CancelOrder({
  blocked,
  cancel,
}: {
  blocked: boolean;
  cancel: () => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const question = useId();
  const keep = useRef<HTMLButtonElement>(null);
  const ask = useRef<HTMLButtonElement>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (asking) keep.current?.focus();
    else if (asked) ask.current?.focus();
  }, [asking, asked]);
  return asking ? (
    <div className="cancel-ask" role="group" aria-labelledby={question}>
      <p id={question}>
        Скасувати замовлення? Резерв звільниться — товар знову можна продати.
        Відновити замовлення не можна.
      </p>
      <div className="actions">
        <button type="button" disabled={blocked} onClick={cancel}>
          Так, скасувати
        </button>
        <button
          type="button"
          className="quiet"
          ref={keep}
          // Held with «Так» while the cancel is on its way or kept: it may
          // still be recorded (review, 2026-10-23).
          disabled={blocked}
          onClick={() => {
            setAsking(false);
          }}
        >
          Ні, залишити
        </button>
      </div>
    </div>
  ) : (
    <button
      type="button"
      className="quiet cancel-order"
      ref={ask}
      disabled={blocked}
      onClick={() => {
        setAsking(true);
        setAsked(true);
      }}
    >
      Скасувати замовлення
    </button>
  );
}

const shippingKinds: Record<ShippingChange["kind"], string> = {
  CREATED: "Вказано при створенні",
  DISPATCHED: "Вписано при відправленні",
  CORRECTED: "Змінено",
};

/** «22.10, 14:05»: when a version was stated, by the phone's own clock. */
function at(iso: string): string {
  const when = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(when.getDate())}.${two(when.getMonth() + 1)}, ${two(when.getHours())}:${two(when.getMinutes())}`;
}

/** Another order with the same waybill, as its card's title says it: its
 * first goods, and how many more lines (P1-3). An answer kept from before
 * it was named so: «Замовлення». */
function sameTitle(other: SameWaybill): string {
  if (!other.display_name) return "Замовлення";
  const more = (other.lines ?? 1) - 1;
  return `${tagOf({
    display_name: other.display_name,
    size_label: other.size_label ?? null,
    quantity: other.quantity ?? 1,
  })}${more > 0 ? ` + ще ${String(more)}` : ""}`;
}
