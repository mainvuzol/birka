import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { methodLabels } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { usePanelRoom } from "@/shared/panel";
import { Sum } from "@/shared/Sum";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
import { Collected, CollectedLine } from "./Collected";
import { since, tagOf } from "./Orders";
import {
  carrierLabels,
  collectHint,
  decimal,
  kopecks,
  money,
  shippingText,
  statusLabels,
} from "./types";
import type {
  Carrier,
  Destination,
  Order,
  OrderItem,
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

/** What a step just recorded says on its order (orders task list, P0-2):
 * the step, and for a parcel sent its waybill, or that it may come later;
 * a new order, how many units it holds now (P0-5). */
export function stepDone(action: string, order: Order): string | null {
  // Confirmed late, it may have moved on meanwhile: then nothing said.
  if (action === "reserve")
    return order.status === "READY_TO_DISPATCH"
      ? `Зарезервовано: ${String(order.items.reduce((n, item) => n + item.quantity, 0))} шт. Чекає відправлення.`
      : null;
  if (action === "cancel") return "Замовлення скасовано, резерв звільнено.";
  if (action === "arrive") return "Прибув на пошту";
  if (action !== "dispatch") return null;
  if (order.destination === "ABROAD") return "Відправлено.";
  return order.waybill
    ? `Відправлено · ТТН ${visible(order.waybill)}`
    : "Відправлено. ТТН можна вписати пізніше.";
}

/** How long after a step's answer a tap is taken as meant for that step,
 * not for the next step's buttons that took its place: a double tap's
 * second half. */
const CARRIED_TAP = 700;

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

/**
 * One order (orders task list, P0-2): what it is and where it goes on top —
 * its goods as its title, how it goes, since when, its number small, its
 * status; its lines with their sums and «Разом» large; the next step one
 * button in the panel under the thumb, what it needs over the panel; the
 * rare at the foot. «Клієнт забрав» is its five ways, each the step itself
 * (P0-3); collected, the sale said large, then later in a line.
 */
export function OrderDetail({
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
}: {
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
}): JSX.Element {
  const hint = useId();
  const [reason, setReason] = useState("");
  const [received, setReceived] = useState(false);
  const [returning, setReturning] = useState(false);
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
  // The waybill, or abroad where and how it went, written as it is sent.
  const [sentWith, setSentWith] = useState("");
  const [changingShipping, setChangingShipping] = useState(false);
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
  // while where it goes is changed, or it comes back: one form at a time
  // under the thumb (review, 2026-10-23).
  const panelStep =
    mayStep && open && !changingShipping && !returning ? next : null;
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
  const [first] = order.items;
  const more = order.items.length - 1;
  const title = first
    ? `${tagOf(first)}${more > 0 ? ` + ще ${String(more)}` : ""}`
    : "Замовлення";
  const goes =
    order.destination === "ABROAD"
      ? "За кордон"
      : order.carrier
        ? carrierLabels[order.carrier]
        : null;
  return (
    <section className="order">
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
        <span className="badge">{statusLabels[order.status]}</span>
        <small className="order-number">№ {order.id.slice(0, 8)}</small>
      </p>
      {order.same_waybill && order.same_waybill.length > 0 && (
        <p className="notice">
          Ця накладна є також у замовленні №{" "}
          {order.same_waybill.map((other) => other.id.slice(0, 8)).join(", № ")}
          . Збережено — перевірте, чи це один пакунок.
        </p>
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
        <p className="hint">Товар у резерві — на касі його не продадуть.</p>
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
      {open &&
        mayStep &&
        (changingShipping ? (
          <ShippingForm
            order={order}
            blocked={blocked}
            cancel={() => {
              setChangingShipping(false);
            }}
            save={(shipping) => {
              action("shipping", shipping);
            }}
          />
        ) : (
          <button
            type="button"
            className="quiet order-rare"
            disabled={blocked}
            onClick={() => {
              setChangingShipping(true);
            }}
          >
            Змінити доставку
          </button>
        ))}
      {order.shipping_history && order.shipping_history.length > 0 && (
        <>
          <h3>Історія доставки</h3>
          <ul aria-label="Історія доставки">
            {order.shipping_history.map((change, index) => (
              <li key={`${change.at}:${String(index)}`}>
                {new Date(change.at).toLocaleString("uk-UA", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                · {shippingKinds[change.kind]} · {shippingText(change)} ·{" "}
                {visible(change.by)}
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
          <button
            type="button"
            className="quiet order-rare"
            disabled={blocked}
            onClick={() => {
              setReturning(!returning);
            }}
          >
            Товар повернувся на склад
          </button>
        )}
      {returning && ["DISPATCHED", "ARRIVED"].includes(order.status) && (
        <fieldset disabled={blocked}>
          <legend>Фізичне повернення всього замовлення</legend>
          <p>Товар повернеться на ті склади, звідки його відправили.</p>
          <label>
            Причина повернення
            <textarea
              maxLength={1000}
              value={reason}
              aria-describedby={`${hint}-return`}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <NoCustomerData id={`${hint}-return`} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={received}
              onChange={(e) => {
                setReceived(e.target.checked);
              }}
            />
            Усі товари фізично отримані на складах відправлення
          </label>
          <button
            type="button"
            disabled={!received || !reason.trim()}
            onClick={() => {
              action("return", {
                reason: reason.trim(),
                physically_received: true,
              });
            }}
          >
            Прийняти повернення
          </button>
        </fieldset>
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

/** Within Ukraine by one of three carriers, or abroad. */
export function DestinationFields({
  destination,
  carrier,
  change,
}: {
  destination: Destination;
  carrier: Carrier | "";
  change: (destination: Destination, carrier: Carrier | "") => void;
}): JSX.Element {
  return (
    <div className="fields">
      <label>
        Куди
        <select
          value={destination}
          onChange={(event) => {
            const next = event.target.value as Destination;
            change(next, next === "UKRAINE" ? carrier : "");
          }}
        >
          <option value="UKRAINE">По Україні</option>
          <option value="ABROAD">За кордон</option>
        </select>
      </label>
      {destination === "UKRAINE" && (
        <label>
          Перевізник
          <select
            value={carrier}
            onChange={(event) => {
              change("UKRAINE", event.target.value as Carrier | "");
            }}
          >
            <option value="">Оберіть перевізника</option>
            {(Object.keys(carrierLabels) as Carrier[]).map((key) => (
              <option key={key} value={key}>
                {carrierLabels[key]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

const shippingKinds: Record<ShippingChange["kind"], string> = {
  CREATED: "Вказано при створенні",
  DISPATCHED: "Вписано при відправленні",
  CORRECTED: "Змінено",
};

/** Where an open order goes, as it should stand: corrected or written later.
 * Every earlier version stays in its history (owner decision, 2026-10-01). */
function ShippingForm({
  order,
  blocked,
  cancel,
  save,
}: {
  order: Order;
  blocked: boolean;
  cancel: () => void;
  save: (shipping: Record<string, unknown>) => void;
}): JSX.Element {
  const hint = useId();
  const [destination, setDestination] = useState<Destination>(
    order.destination ?? "UKRAINE",
  );
  const [carrier, setCarrier] = useState<Carrier | "">(order.carrier ?? "");
  const [waybill, setWaybill] = useState(order.waybill ?? "");
  const [note, setNote] = useState(order.abroad_note ?? "");
  const [problem, setProblem] = useState("");
  return (
    <fieldset disabled={blocked}>
      <legend>Доставка</legend>
      <DestinationFields
        destination={destination}
        carrier={carrier}
        change={(nextDestination, nextCarrier) => {
          setDestination(nextDestination);
          setCarrier(nextCarrier);
          setProblem("");
        }}
      />
      {destination === "UKRAINE" ? (
        <label>
          Номер накладної
          <input
            value={waybill}
            maxLength={64}
            onChange={(event) => {
              setWaybill(event.target.value);
            }}
          />
        </label>
      ) : (
        <label>
          Куди і як відправили: місто, країна, спосіб
          <textarea
            value={note}
            maxLength={1000}
            aria-describedby={hint}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <NoCustomerData id={hint} />
        </label>
      )}
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            if (destination === "UKRAINE" && carrier === "") {
              setProblem("Оберіть перевізника.");
              return;
            }
            save(
              destination === "UKRAINE"
                ? {
                    destination,
                    carrier,
                    ...(waybill.trim() ? { waybill: waybill.trim() } : {}),
                  }
                : {
                    destination,
                    ...(note.trim() ? { abroad_note: note.trim() } : {}),
                  },
            );
          }}
        >
          Зберегти доставку
        </button>
        <button type="button" className="quiet" onClick={cancel}>
          Скасувати
        </button>
      </div>
    </fieldset>
  );
}
