import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { visible } from "@/shared/visible";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { Sum } from "@/shared/Sum";
import { Back } from "@/shared/Back";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Stub } from "@/shared/Stub";
import { Toast } from "@/shared/Toast";
import { askPopup, buzz, popupHere, useMainButton } from "@/shared/telegram";
import { Collected, CollectedLine } from "./Collected";
import { goesOf } from "./Collect";
import { KnotString, StatusSticker, dayOf, toneOf } from "./Knots";
import { sinceDay, tagOf, titleOf } from "./Orders";
import { Returned, byPlace } from "./Returned";
import {
  carrierLabels,
  decimal,
  kopecks,
  money,
  placesKey,
  shippingText,
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

/** A line's sum: its price less its discount, for every unit. */
function lineSum(item: OrderItem): string {
  const each =
    (kopecks(item.unit_price) ?? 0n) - (kopecks(item.discount_amount) ?? 0n);
  return money(decimal(each * BigInt(item.quantity)));
}

interface CardProps {
  order: Order;
  /** What the step just taken on it did; a reserve, on its stub (stage 2,
   * orders task list, P1-3). */
  done: { text: string; stub: boolean } | null;
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
  /** «Відправити», «Клієнт забрав» or «Доставка»: its sheet over the card;
   * «Доставка» to write the waybill, the cursor in it. */
  openSheet: (kind: "send" | "collect" | "shipping", writing?: boolean) => void;
  /** A sheet is over the card: its MainButton is the sheet's, or none. */
  sheet: boolean;
  /** A step is being asked: «Прибув на пошту» turns. */
  waiting: boolean;
}
/**
 * An order's place while it is read (orders task list, P2-2): its line of
 * context, its pill and two of its lines, in their sizes — its title's is
 * the screen's head's («Усе на бірці» task list, P0-4); a screen reader
 * hears «Завантажуємо замовлення…».
 */
export function CardPlaceholder(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо замовлення…
      </p>
      <div className="placeholder order-placeholder" aria-hidden="true">
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
 * One order: its card, and over it the goods come back on a screen of
 * their own (orders task list, P2-4) — the card kept under it with what was
 * typed there, «← Замовлення» back to it with the row that opened it in
 * focus. Where it goes is a sheet over the card (stage 2, orders task list,
 * P1-1). Taken, the card is mounted afresh with what it did.
 */
export function OrderDetail(props: CardProps): JSX.Element {
  const [returning, setReturning] = useState(false);
  const back = (): void => {
    setReturning(false);
  };
  // The card first: its panel's room let go before the step's is kept.
  return (
    <>
      <Card
        {...props}
        away={returning}
        takeBack={() => {
          setReturning(true);
        }}
      />
      {returning && (
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
 * One order (spec S17; «Усе на бірці» sections task list, P0-2): its goods
 * as its title, when it was ordered and its number small; the string of
 * places with their days; what is in the parcel and from which warehouse,
 * «Разом» large; how it goes, its waybill copied with one tap; its history
 * folded. Its next step Telegram's MainButton, or the dock's one button —
 * «Відправити» and «Клієнт забрав» open their sheets, «Прибув на пошту»
 * records. The rare at the foot as links; a cancel asked by Telegram's own
 * popup, or in its block where there is none. Collected, the sale said
 * large, then later in a line.
 */
function Card({
  order,
  done,
  collected,
  store,
  token,
  blocked,
  waiting,
  action,
  back,
  fixWay,
  returnSale,
  openOther,
  openSheet,
  sheet,
  away,
  takeBack,
}: CardProps & {
  /** The goods coming back are taken over it: hidden, its panel with it. */
  away: boolean;
  /** «Товар повернувся на склад», its own step. */
  takeBack: () => void;
}): JSX.Element {
  // Shown at once after a step, or back as its sheet closes, the next
  // step's button stands where the last was pressed: a tap meant for it,
  // landing on it, is let go (review, 2026-10-24; 2026-11-01). The card is
  // mounted afresh on every step.
  const [shownAt] = useState(() => performance.now());
  const sheetGoneAt = useRef(-Infinity);
  const hadSheet = useRef(sheet);
  useEffect(() => {
    if (hadSheet.current && !sheet) sheetGoneAt.current = performance.now();
    hadSheet.current = sheet;
  }, [sheet]);
  function late(at: number): boolean {
    return (
      (done !== null && at - shownAt < CARRIED_TAP) ||
      at - sheetGoneAt.current < CARRIED_TAP
    );
  }
  // What a step did takes the cursor where nothing else has it: the button
  // pressed, or the sheet, went with the card it was on (review,
  // 2026-11-01).
  const said = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done === null || sheet) return;
    const at = document.activeElement;
    if (at === null || at === document.body)
      said.current?.focus({ preventScroll: true });
  }, [done, sheet]);
  // What a step did is seen with what it was done to: a new order opens
  // here from the foot of its long form (orders task list, P0-5).
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done !== null) heading.current?.scrollIntoView({ block: "nearest" });
  }, [done]);
  // Back from the goods come back: the row that opened it in focus, and a
  // tap carried from «← Замовлення» onto «← До замовлень» let go.
  const returnRow = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const backAt = useRef(-Infinity);
  useEffect(() => {
    if (away) opened.current = true;
    else if (opened.current) {
      opened.current = false;
      backAt.current = performance.now();
      returnRow.current?.focus();
    }
  }, [away]);
  const mayStep = store.permissions.includes("sale:create");
  const open = ["READY_TO_DISPATCH", "DISPATCHED", "ARRIVED"].includes(
    order.status,
  );
  // The next step: sent, arrived, or «Клієнт забрав» by its ways. None
  // while a rare step is over the card: one press at a time under the thumb
  // (review, 2026-10-23).
  const panelStep = mayStep && !away ? (nextSteps[order.status] ?? null) : null;
  // Sent within Ukraine with no waybill: written later, as it often is
  // (orders task list, P1-3).
  const writeLater =
    order.destination === "UKRAINE" &&
    !order.waybill &&
    order.status !== "READY_TO_DISPATCH";
  function step(): void {
    if (blocked || panelStep === null) return;
    if (panelStep === "arrive") action("arrive");
    else openSheet(panelStep === "dispatch" ? "send" : "collect");
  }
  // Telegram's MainButton where it is there (spec §4.4, rule 4); put away
  // while a sheet is over the card — the ways are never it — and turning
  // while «Прибув на пошту» is asked.
  const main = useMainButton(
    panelStep === null ? "" : nextWords[panelStep],
    () => {
      // Telegram's button stands where the last step's was: a second tap
      // of the press that took it is let go too.
      if (late(performance.now())) return;
      step();
    },
    {
      shown: panelStep !== null && !sheet,
      progress: waiting && panelStep === "arrive",
      // Held by another kept operation, as the dock's button is.
      active: !blocked,
    },
  );
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, panelStep !== null && !main);
  // The warehouses each line left from, for whoever reads the stock: the
  // list's and the return's read.
  const mayStock = store.permissions.includes("inventory:view");
  const warehouses = useQuery({
    queryKey: placesKey(store.id),
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    enabled: mayStock,
    retry: false,
  });
  const names = new Map(
    (warehouses.status === "success" ? warehouses.data : []).map((place) => [
      place.id,
      place.name,
    ]),
  );
  const [historyShown, setHistoryShown] = useState(false);
  const [toast, setToast] = useState<{ text: string; times: number } | null>(
    null,
  );
  const tell = (text: string): void => {
    setToast((now) => ({ text, times: (now?.times ?? 0) + 1 }));
  };
  // Absent outside a secure page, whatever the types say.
  const clipboard = (navigator as { clipboard?: Partial<Clipboard> }).clipboard;
  const write = clipboard?.writeText?.bind(clipboard);
  const waybill = order.destination === "UKRAINE" ? order.waybill : null;
  const copy =
    waybill && write !== undefined
      ? () => {
          const failed = "Не вдалося скопіювати — виділіть ТТН і скопіюйте її.";
          try {
            // Exactly as it was written: the server keeps it so.
            write(waybill).then(
              () => {
                buzz("success");
                tell("ТТН скопійовано");
              },
              () => {
                tell(failed);
              },
            );
          } catch {
            tell(failed);
          }
        }
      : null;
  const title = titleOf(order);
  return (
    <div hidden={away}>
      <ScreenHeader
        ref={heading}
        className="order-title"
        title={title}
        screen={order.id}
        back={
          <Back
            go={back}
            carried={(event) => event.timeStamp - backAt.current < CARRIED_TAP}
          >
            <span aria-hidden="true">← </span>До замовлень
          </Back>
        }
      />
      <section className="order">
        {/* When it was ordered, and its number small beside it (owner
            decision, 2026-10-23, В1): the store is the screen's line. */}
        <p className="order-context t-meta">
          {order.created_at ? `замовлено ${dayOf(order.created_at)} · ` : ""}
          <small className="order-number">№ {order.id.slice(0, 8)}</small>
        </p>
        {done && (
          // A reserve torn off as recorded over the thread, the coat held
          // for its customer; any other step a line, its eyelet filled in
          // the step's colour (stage 2, orders task list, P1-3).
          <div role="status" ref={said} tabIndex={-1} className="order-done">
            {done.stub ? (
              <Stub state="recorded">
                <StatusSticker status="READY_TO_DISPATCH" />
                {order.items.map((item) => {
                  const from = names.get(item.source_location_id);
                  return (
                    <p className="stub-line" key={item.id}>
                      <strong>
                        {tagOf(item)}
                        {from === undefined
                          ? ""
                          : ` · склад «${visible(from)}»`}
                      </strong>
                    </p>
                  );
                })}
                <p className="stub-line">{done.text}</p>
              </Stub>
            ) : (
              <p className={`step-done tone-${toneOf(order.status)}`}>
                <Eyelet state="filled" />
                {done.text}
              </p>
            )}
          </div>
        )}
        <KnotString order={order} />
        <h3 className="order-section t-label">У посилці</h3>
        <ul className="order-lines" aria-label="Товар">
          {order.items.map((item) => {
            const discounted = kopecks(item.discount_amount) !== 0n;
            const from = names.get(item.source_location_id);
            return (
              <li className="order-line" key={item.id}>
                <span className="sale-main">
                  <span className="cash-row-title">{tagOf(item)}</span>
                  {(item.quantity > 1 || discounted || from !== undefined) && (
                    <span className="sale-meta">
                      {[
                        from === undefined ? null : `склад «${visible(from)}»`,
                        item.quantity > 1 || discounted
                          ? `${money(item.unit_price)} за 1 шт.${
                              discounted
                                ? ` · знижка ${money(item.discount_amount)} за 1 шт.`
                                : ""
                            }`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
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
        <h3 className="order-section t-label">Доставка</h3>
        <div className="order-delivery">
          <p className="order-goes">{shippingText(order)}</p>
          {copy && (
            <button type="button" className="copy-ttn" onClick={copy}>
              <Icon name="copy" />
              Скопіювати ТТН
            </button>
          )}
        </div>
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
                      <StatusSticker status={other.status} />
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
        {order.shipping_history && order.shipping_history.length > 0 && (
          // Folded: each version a row once it is opened (orders task list,
          // P1-3) — what it was, when and by whom; how it went on the right.
          <>
            <button
              type="button"
              className="quiet order-rare shipping-changes-title"
              aria-expanded={historyShown}
              onClick={() => {
                setHistoryShown((shown) => !shown);
              }}
            >
              Історія доставки <span aria-hidden="true">›</span>
            </button>
            {historyShown && (
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
            )}
          </>
        )}
        {open && mayStep && (
          <button
            type="button"
            className="quiet order-rare"
            disabled={blocked}
            onClick={() => {
              openSheet("shipping", writeLater);
            }}
          >
            {writeLater ? "ТТН ще немає — вписати" : "Змінити доставку"}{" "}
            <span aria-hidden="true">›</span>
          </button>
        )}
        {["DISPATCHED", "ARRIVED"].includes(order.status) &&
          store.permissions.includes("sale:refund") &&
          store.permissions.includes("inventory:receive") && (
            // Its own step (orders task list, P2-4).
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
        {panelStep !== null && !main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-panel order-dock" ref={panel}>
            <button
              type="button"
              className="main-mimic"
              disabled={blocked}
              onClick={(event) => {
                if (late(event.timeStamp)) return;
                step();
              }}
            >
              {waiting && panelStep === "arrive" ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">
                    {nextWords[panelStep]}
                  </span>
                </>
              ) : (
                nextWords[panelStep]
              )}
            </button>
          </div>
        )}
      </section>
      {toast && (
        <Toast
          key={toast.times}
          text={toast.text}
          gone={() => {
            setToast(null);
          }}
        />
      )}
    </div>
  );
}

type NextStep = "dispatch" | "arrive" | "collect";

const nextSteps: Partial<Record<Order["status"], NextStep>> = {
  READY_TO_DISPATCH: "dispatch",
  DISPATCHED: "arrive",
  ARRIVED: "collect",
};

/** The next step as the MainButton says it (spec S17): its sheet's name,
 * or the step itself. */
const nextWords: Record<NextStep, string> = {
  dispatch: "Відправити",
  arrive: "Прибув на пошту",
  collect: "Клієнт забрав",
};

/**
 * «Скасувати замовлення», asked first: what it does, and that it is for
 * good (orders task list, P0-4). Inside Telegram by its own popup, «Так,
 * скасувати» its destructive button (spec §6.29; «Усе на бірці» sections
 * task list, P0-2); elsewhere in its block where it stands, the focus on
 * «Ні, залишити», the safe one.
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
      <p id={question}>Скасувати замовлення? {cancelWords}</p>
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
        if (popupHere()) {
          void askPopup("Скасувати замовлення?", cancelWords, [
            { id: "keep", text: "Ні, залишити" },
            { id: "cancel", text: "Так, скасувати", destructive: true },
          ]).then((pressed) => {
            if (pressed === "cancel") cancel();
          });
          return;
        }
        setAsking(true);
        setAsked(true);
      }}
    >
      Скасувати замовлення
    </button>
  );
}

const cancelWords =
  "Резерв звільниться — товар знову можна продати. Відновити замовлення не можна.";

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
