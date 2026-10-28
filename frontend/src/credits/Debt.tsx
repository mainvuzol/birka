import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  CONFLICT_TEXT,
  INVALID_TEXT,
  api,
  errorText,
  inOwnWords,
  isConflict,
} from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { visible } from "@/shared/visible";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { asInput } from "@/prices/SuggestedPrice";
import {
  isTillMethod,
  methodHow,
  methodLabels,
  notStated,
  refundHow,
  tillMethods,
} from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { usePanelRoom } from "@/shared/panel";
import { buzz } from "@/shared/telegram";
import { Sum } from "@/shared/Sum";
import { Eyelet } from "@/shared/Eyelet";
import { SendingLine } from "@/shared/Sending";
import {
  PaperFields,
  paperRefusal,
  paperText,
  takenBy,
  usePaperMark,
} from "@/sales/paperMark";
import type { PaperBody } from "@/sales/paperMark";
import { paidDuringOutage } from "@/sales/types";
import { submitCreditCommand, useCreditCommand } from "./commands";
import { shortDay, shortWhen } from "./format";
import { Paid } from "./Paid";
import { askForPhone, erasedCustomer, statusLabels } from "./types";
import type { Credit, CreditEntry, Erasure } from "./types";

/**
 * What the owner's erasure did: how many closed debts lost the customer, and
 * how many open ones keep them. Those are erased by their own term once
 * closed, or by the owner again (owner decision, 2026-10-09; ADR-0015 §5).
 */
function erasedText(result: Erasure): string {
  const open =
    result.still_open > 0
      ? ` Відкритих боргів цього покупця: ${String(result.still_open)}. З них дані не стирають; коли їх закриють, стерти можна так само.`
      : "";
  return result.erased > 0
    ? `Дані покупця стерто із закритих боргів${result.network ? "" : " цього магазину"}: ${String(result.erased)}.${open}`
    : `Дані покупця вже стерто.${open}`;
}

/**
 * What a history line was, and how money moved (ADR-0012 §B12): «Внесок ·
 * готівка»; «Повернення товару»; «Списано». A payment recorded before the
 * way was asked reads «не вказано», and is never guessed (owner decision,
 * 2026-10-04).
 */
function entryWhat(entry: CreditEntry): string {
  if (entry.kind === "PAYMENT")
    return `Внесок · ${
      entry.payment_method
        ? methodLabels[entry.payment_method].toLowerCase()
        : notStated
    }${entry.corrected ? " (виправлено)" : ""}`;
  return entry.kind === "RETURN" ? "Повернення товару" : "Списано";
}

/**
 * When, and who: «01.10, 13:00 · Оля», then where another store took it, a
 * payment from paper's mark, and the money a return handed back. The mark
 * is a warning's (credits task list, P2-4).
 */
function entryMeta(entry: CreditEntry): { text: string; paper?: true }[] {
  const parts: { text: string; paper?: true }[] = [
    { text: shortWhen(entry.at) },
  ];
  if (entry.outage)
    parts.push(
      { text: paperText("payment", entry.outage), paper: true },
      { text: `внесено: ${visible(entry.by)}` },
    );
  else parts.push({ text: visible(entry.by) });
  // The store took it: never a verb of the person before it.
  if (entry.taken_at)
    parts.push({ text: `прийняв магазин «${visible(entry.taken_at)}»` });
  if (entry.kind === "RETURN" && (kopecks(entry.cash_back) ?? 0n) > 0n)
    parts.push({
      text: `повернено ${money(entry.cash_back)}${
        isTillMethod(entry.payment_method)
          ? ` ${refundHow[entry.payment_method]}`
          : ""
      }${entry.corrected ? ", виправлено" : ""}`,
    });
  return parts;
}

/** A sum that is not one to the kopeck. */
const sumUnread = "Вкажіть суму внеску з точністю до копійок.";

/**
 * «Сплачено 1 000,00 грн з 3 000,00 грн», and what came back or was written
 * off, when anything did: every sum the server's.
 */
function paidText(credit: Credit): string {
  const parts = [`Сплачено ${money(credit.paid)} з ${money(credit.amount)}`];
  if ((kopecks(credit.returned) ?? 0n) > 0n)
    parts.push(
      `повернено товару на ${money(credit.returned)}${
        (kopecks(credit.cash_back) ?? 0n) > 0n
          ? `, з них грошима ${money(credit.cash_back)}`
          : ""
      }`,
    );
  if ((kopecks(credit.written_off) ?? 0n) > 0n)
    parts.push(`списано ${money(credit.written_off)}`);
  return parts.join(" · ");
}

/** How much of the debt is closed, for the bar under what is owed: a look,
 * never a number to read (credits task list, P0-3). */
function closedShare(credit: Credit): number {
  const amount = kopecks(credit.amount) ?? 0n;
  const owed = kopecks(credit.owed) ?? 0n;
  if (amount <= 0n) return 0;
  return Number(((amount - owed) * 100n) / amount);
}

/**
 * One debt (credits task list, P0-3, P0-4): who, what they took and since
 * when in one line; what they owe, large, and how much of it is paid; the
 * payment's sum under it, and its three ways under the thumb; the history a
 * line an entry; writing off and erasing, the owner's, after it.
 */
export function Debt({
  store,
  token,
  journalKey,
  blocked,
  readOnly,
  networkOwner,
  mayErase,
  credit,
  changed,
  back,
  backTo = "До боргів",
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  readOnly: boolean;
  networkOwner: boolean;
  mayErase: boolean;
  credit: Credit;
  changed: (credit: Credit) => void;
  back: () => void;
  /** Where «←» leads: the list, or the customer's card it was opened from. */
  backTo?: string;
}): JSX.Element {
  const { busy, pending, firstSend } = useCreditCommand();
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // A payment or a write-off recorded: its result, in place of the form
  // (P0-5), until the seller goes on.
  const [paid, setPaid] = useState<Omit<
    Parameters<typeof Paid>[0],
    "next"
  > | null>(null);
  // Every good of the debt, on a tap (owner decision, 2026-10-18).
  const [allGoods, setAllGoods] = useState(false);
  const [erasing, setErasing] = useState<"ask" | "sending" | null>(null);
  const cache = useQueryClient();
  const hint = useId();
  // Another store's debt, paid here because that one does not trade.
  const elsewhere = credit.store_id !== store.id;
  // The owner writes off; for a store that does not trade, the network's.
  const mayWriteOff =
    credit.store_state === "ACTIVE"
      ? !readOnly && store.permissions.includes("credit:write_off")
      : networkOwner;
  const owed = kopecks(credit.owed) ?? 0n;
  const working = busy || pending !== null;
  // What is sent for the first time (spec §6.5; «Усе на бірці» task list,
  // P0-2): the payment's way turns its ring, the others step back; a
  // write-off, its own button. A kept one checked again is its stub's to
  // say, not the dock's.
  const sending = busy && firstSend ? pending : null;
  const pressing =
    sending?.body.kind === "payment" ? sending.body.payment_method : null;
  const writingOff = sending?.body.kind === "write-off";
  // Paper mode: the till's switch (`@/sales/paper`); the paper's time is
  // this payment's own (owner decision, 2026-10-10; ADR-0021).
  const paperMark = usePaperMark(store, token, journalKey, "credit");
  // A store's owner erases in their store, while it trades (owner,
  // 2026-10-09); the network's owner anywhere.
  const erasesHere =
    !readOnly &&
    !elsewhere &&
    store.permissions.includes("credit:erase_customer");
  // A payment is taken here on a debt still owed, in a store that trades.
  const takes = credit.status === "OPEN" && !readOnly;
  const panelRef = useRef<HTMLDivElement>(null);
  // Room for the panel while it stands: the result unmounts it, and
  // «Відкрити борг» brings a new one, measured again (review, 2026-10-18).
  usePanelRoom(panelRef, takes && paid === null);
  // Back from the result to the debt: the eye and a screen reader begin
  // again at its name, not at the page's top.
  const name = useRef<HTMLHeadingElement>(null);
  const reopened = useRef(false);
  useEffect(() => {
    if (paid !== null || !reopened.current) return;
    reopened.current = false;
    name.current?.focus();
  }, [paid]);
  // Every good, once opened, is where focus goes: the tapped «+ ще N» is
  // gone.
  const goodsList = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (allGoods) goodsList.current?.focus();
  }, [allGoods]);
  const cents = kopecks(amount);
  const typed = cents !== null && cents > 0n;
  // Typed, but not a sum read to the kopeck: said in the panel, not left to
  // dead buttons (review, 2026-10-18).
  const unreadable = amount.trim() !== "" && cents === null;
  // A refusal, or what was done, is seen where it is said, above the panel
  // (P0-4) — each time it is said, the same words again included.
  const said = useRef<HTMLParagraphElement>(null);
  const [told, setTold] = useState(0);
  function tell(text: string): void {
    setProblem(text);
    setTold((n) => n + 1);
  }
  useEffect(() => {
    if (told > 0) said.current?.scrollIntoView({ block: "nearest" });
  }, [told]);
  const result = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (done !== null) result.current?.scrollIntoView({ block: "nearest" });
  }, [done]);

  async function send(
    body:
      | {
          kind: "payment";
          amount: string;
          payment_method: TillMethod;
          elsewhere?: boolean;
          outage?: PaperBody;
          goods?: string[];
        }
      | { kind: "write-off"; reason: string },
  ): Promise<void> {
    setProblem(null);
    setDone(null);
    const outcome = await submitCreditCommand(journalKey, token, {
      // A new transport key per attempt; the payment's identity is
      // `command_id`, which is what makes a late retry safe.
      key: crypto.randomUUID(),
      body: {
        ...body,
        store_id: store.id,
        credit_id: credit.id,
        command_id: commandId,
      },
    });
    // A buzz in the hand once the server answers, as at the till and in
    // «Повернення» (P0-5); a lost answer, and one confirmed later, none.
    if (outcome.kind === "done") {
      buzz("success");
      setCommandId(crypto.randomUUID());
      setAmount("");
      setReason("");
      setAsking(false);
      setPaid(
        body.kind === "write-off"
          ? {
              kind: "write-off",
              amount: outcome.result.written_off,
              way: null,
              paper: null,
              credit: outcome.result,
              said: `Борг списано: ${money(outcome.result.written_off)}.`,
            }
          : {
              kind: "payment",
              amount: body.amount,
              way: body.payment_method,
              // The mark as sent, named as it was chosen: the paper's pill
              // as the history says it (credits task list, P0-5).
              paper: body.outage
                ? {
                    by_user_id: body.outage.by_user_id,
                    by: paperMark.named?.display_name ?? null,
                    at: body.outage.at,
                    first_days: body.outage.first_days === true,
                  }
                : null,
              credit: outcome.result,
              said: `${paymentTaken(body.amount, body.payment_method, !!body.outage, body.outage?.first_days === true)} ${
                outcome.result.status === "SETTLED"
                  ? "Борг сплачено повністю."
                  : `Залишок боргу ${money(outcome.result.owed)}.`
              }`,
            },
      );
      if (body.kind === "payment" && body.outage) paperMark.forgetTime();
      changed(outcome.result);
    } else if (outcome.kind === "refused") {
      buzz("error");
      setCommandId(crypto.randomUUID());
      setAsking(false);
      tell(
        pressRefusalText(
          outcome.error,
          body.kind,
          body.kind === "payment" ? body.payment_method : undefined,
        ),
      );
      // Refused because the debt moved on — another payment, a return: show
      // it as it is now.
      try {
        changed(
          await api<Credit>(
            `/credits/${credit.id}${elsewhere ? `?store_id=${store.id}` : ""}`,
            token,
          ),
        );
      } catch {
        // What was shown stays; the refusal says what to do.
      }
    }
  }

  /**
   * The owner erases this customer at their request: from every closed debt
   * of the network under their phone. Not a money command, and the same
   * whenever repeated, so it is sent directly rather than through the
   * journal (owner decision, 2026-10-09; ADR-0015).
   */
  async function erase(): Promise<void> {
    setProblem(null);
    setDone(null);
    setErasing("sending");
    try {
      // A body makes it a POST; the command takes nothing in it.
      const result = await api<Erasure>(
        `/credits/${credit.id}/erase-customer`,
        token,
        {},
      );
      setDone(erasedText(result));
      changed(result.credit);
      // The customer is erased in every store of the network.
      void cache.invalidateQueries({ queryKey: ["credits"] });
    } catch (error) {
      tell(
        inOwnWords(
          refusalText(error),
          "Дані покупця не стерто. Спробуйте ще раз.",
          "Дані покупця не стерто: борг щойно змінився — перегляньте його й спробуйте ще раз.",
        ),
      );
      // Changed in a way it does not name: the debt shown as it is now, as
      // a refused payment's.
      if (isConflict(error))
        try {
          changed(
            await api<Credit>(
              `/credits/${credit.id}${elsewhere ? `?store_id=${store.id}` : ""}`,
              token,
            ),
          );
        } catch {
          // What was shown stays; the refusal says what to do.
        }
    } finally {
      setErasing(null);
    }
  }

  function pay(way: TillMethod): void {
    // From paper, nothing is sent until the series says which paper it is
    // (owner decision, 2026-10-16): the buttons wait, and so does this.
    if (!paperMark.ready) return;
    if (cents === null || cents <= 0n) {
      tell(sumUnread);
      return;
    }
    if (cents > owed) {
      // The same words as the server's refusal: a sum typed from paper may
      // have been taken already (owner decision, 2026-10-07).
      tell(moreThanOwed(credit.owed, way));
      return;
    }
    const outage = paperMark.body();
    void send({
      kind: "payment",
      amount: decimal(cents),
      payment_method: way,
      ...(elsewhere ? { elsewhere: true } : {}),
      ...(outage ? { outage } : {}),
      // Kept beside the attempt for its banner, never sent (P1-2).
      goods: credit.goods,
    });
  }

  const [firstGood, ...moreGoods] = credit.goods.map(visible);
  return (
    <section className="credits debt-detail">
      <button
        type="button"
        className="quiet back"
        disabled={working || erasing === "sending"}
        onClick={back}
      >
        <span aria-hidden="true">← </span>
        {backTo}
      </button>
      <h2 ref={name} tabIndex={-1}>
        {visible(credit.customer_name ?? erasedCustomer)}
      </h2>
      {credit.customer_phone === null && credit.customer_erased_at && (
        <p className="hint">
          Ім’я й телефон стерто {shortDay(credit.customer_erased_at)}. Суми
          лишаються.
        </p>
      )}
      {/* Who, what they took, since when: one line (P0-3). */}
      <p className="hint debt-context">
        {credit.customer_phone && (
          <>
            <a
              className="debt-phone"
              href={`tel:${credit.customer_phone.replace(/[^\d+]/g, "")}`}
            >
              {visible(credit.customer_phone)}
            </a>
            {" · "}
          </>
        )}
        {firstGood && (
          <>
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
            {" · "}
          </>
        )}
        з {shortDay(credit.opened_at)}
      </p>
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
      {paid ? (
        <Paid
          {...paid}
          next={{
            back,
            backTo,
            debt: () => {
              reopened.current = true;
              setPaid(null);
            },
          }}
        />
      ) : (
        <>
          {elsewhere && (
            <p className="notice">
              Продано в «{visible(credit.store_name)}» (
              {credit.store_state === "ARCHIVED" ? "закрито" : "заблоковано"}).
              Внесок приймаєте ви, борг — за «{visible(credit.store_name)}».
            </p>
          )}
          {credit.status === "OPEN" ? (
            // What they owe, first and large (P0-3): «скільки я ще винна?».
            <div className="owed-card" role="group" aria-label="Скільки винні">
              <p className="owed-what">Винні</p>
              <p className="owed-sum">
                <Sum value={money(credit.owed)} />
              </p>
              <div className="debt-bar" aria-hidden="true">
                <span style={{ width: `${String(closedShare(credit))}%` }} />
              </div>
              <p className="owed-count">{paidText(credit)}</p>
            </div>
          ) : (
            <div className="debt-closed">
              <p>
                <span
                  className={
                    credit.status === "WRITTEN_OFF"
                      ? "badge neutral"
                      : "badge paid"
                  }
                >
                  {statusLabels[credit.status]}
                </span>
                {credit.closed_at && ` Закрито ${shortDay(credit.closed_at)}`}
              </p>
              <p className="hint">{paidText(credit)}</p>
            </div>
          )}
          {takes && (
            // The payment's sum under what is owed; its ways under the thumb
            // (P0-4).
            <fieldset className="pay-in" disabled={blocked || working}>
              <legend className="visually-hidden">Сума внеску</legend>
              <div className="pay-amount">
                <label>
                  {/* Named in the field; the panel says the sum typed. */}
                  <span className="visually-hidden">Сума внеску, грн</span>
                  <input
                    inputMode="decimal"
                    enterKeyHint="done"
                    placeholder="Сума, грн"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setAmount(asInput(credit.owed));
                  }}
                >
                  Увесь залишок
                </button>
              </div>
            </fieldset>
          )}
          {takes && (
            // A mode, not the first thing: under the sum (P0-4), a group of its
            // own.
            <fieldset className="pay-in" disabled={blocked || working}>
              <legend className="visually-hidden">Внесок з паперу</legend>
              <PaperFields mark={paperMark} what="payment" storeId={store.id} />
            </fieldset>
          )}
          {done && (
            <p role="status" ref={result}>
              {done}
            </p>
          )}
          {problem && (
            <p role="alert" ref={said}>
              {problem}
            </p>
          )}
          <h3>Історія</h3>
          <ul className="history" aria-label="Історія боргу">
            {credit.entries.map((entry, index) => (
              <li className="history-row" key={`${entry.at}:${String(index)}`}>
                <span className="history-main">
                  <span className="history-what">{entryWhat(entry)}</span>
                  <span className="history-meta">
                    {entryMeta(entry).map((part, at) => (
                      <Fragment key={at}>
                        {at > 0 && " · "}
                        {part.paper ? (
                          <span className="paper-meta">{part.text}</span>
                        ) : (
                          part.text
                        )}
                      </Fragment>
                    ))}
                  </span>
                  {entry.note && (
                    <span className="history-meta">{visible(entry.note)}</span>
                  )}
                  {entry.kind === "WRITE_OFF" && entry.note === null && (
                    <span className="history-meta">
                      причину стерто разом з даними покупця
                    </span>
                  )}
                </span>
                <span className="history-sum">{money(entry.amount)}</span>
              </li>
            ))}
          </ul>
          {takes && (
            // Under the thumb (P0-4): the sum to take, and the three ways that
            // take it — none chosen beforehand, none pressable without a sum.
            // Before the owner's rare ones, so the keyboard reaches it first; it
            // rests between them and the history at the end of the page.
            <div
              className="pay-panel"
              role="group"
              aria-label="Внесок"
              ref={panelRef}
            >
              <p className="pay-total">
                {typed ? (
                  <>
                    {paperMark.paper && "З паперу · "}Внесок{" "}
                    <Sum value={money(decimal(cents))} />
                  </>
                ) : unreadable ? (
                  sumUnread
                ) : (
                  "Впишіть суму внеску"
                )}
              </p>
              <SendingLine busy={pressing !== null} />
              <div className="pay-ways">
                {tillMethods.map((way) => (
                  <button
                    key={way}
                    type="button"
                    className={
                      pressing === null
                        ? undefined
                        : pressing === way
                          ? "pressed"
                          : "stepped-back"
                    }
                    disabled={blocked || working || !paperMark.ready || !typed}
                    onClick={() => {
                      pay(way);
                    }}
                  >
                    {pressing === way && <Eyelet state="spin" size={20} />}
                    {paperMark.paper
                      ? `З паперу · ${methodLabels[way]}`
                      : methodLabels[way]}
                  </button>
                ))}
              </div>
              {paperMark.paper && (
                <p className="pay-seller">{takenBy(paperMark)}</p>
              )}
            </div>
          )}
          {/* The owner's, and rare: after the history, never between what is
          owed and the payment (P0-3). */}
          {credit.status === "OPEN" && mayWriteOff && (
            <fieldset className="rare" disabled={blocked || working}>
              <legend className="visually-hidden">Списання</legend>
              {asking ? (
                <div className="notice">
                  <p>
                    Борг {money(credit.owed)} закриється без оплати. Скасувати
                    це потім не можна.
                  </p>
                  <label>
                    Чому списуємо
                    <textarea
                      value={reason}
                      maxLength={1000}
                      aria-describedby={hint}
                      onChange={(event) => {
                        setReason(event.target.value);
                      }}
                    />
                    <NoCustomerData id={hint} />
                  </label>
                  <SendingLine busy={writingOff} />
                  <div className="actions">
                    <button
                      type="button"
                      className={writingOff ? "pressed" : undefined}
                      disabled={reason.trim() === "" || working}
                      onClick={() => {
                        void send({ kind: "write-off", reason: reason.trim() });
                      }}
                    >
                      {writingOff && <Eyelet state="spin" size={20} />}
                      Так, списати {money(credit.owed)}
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        setAsking(false);
                      }}
                    >
                      Скасувати
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setDone(null);
                    setProblem(null);
                    setAsking(true);
                  }}
                >
                  Списати борг
                </button>
              )}
            </fieldset>
          )}
          {(mayErase || erasesHere) &&
            credit.status !== "OPEN" &&
            credit.customer_erased_at === null && (
              <fieldset
                className="rare"
                disabled={working || erasing === "sending"}
              >
                <legend className="visually-hidden">Дані покупця</legend>
                {erasing ? (
                  <div className="notice">
                    <p>
                      Ім’я й телефон покупця зникнуть з усіх закритих боргів{" "}
                      {mayErase ? "мережі" : "цього магазину"} з цим телефоном.
                      Суми лишаються. Скасувати це не можна.
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        onClick={() => {
                          void erase();
                        }}
                      >
                        Так, стерти дані покупця
                      </button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => {
                          setErasing(null);
                        }}
                      >
                        Скасувати
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setDone(null);
                      setProblem(null);
                      setErasing("ask");
                    }}
                  >
                    Стерти дані покупця
                  </button>
                )}
              </fieldset>
            )}
        </>
      )}
    </section>
  );
}

/**
 * «Внесок 300,00 грн прийнято карткою.», or for one typed from paper the
 * same with what the till says of money taken during the outage: never to
 * charge the card again (owner decision, 2026-10-10; ADR-0021). The first
 * days' paper says it with no word of an outage.
 */
export function paymentTaken(
  amount: string,
  way: TillMethod,
  fromPaper: boolean,
  firstDays = false,
): string {
  if (!fromPaper) return `Внесок ${money(amount)} прийнято ${methodHow[way]}.`;
  const paid = paidDuringOutage(way, firstDays);
  return `Внесок ${money(amount)} з паперу записано: ${methodHow[way]}${paid ? ` — ${paid}` : ""}.`;
}

/**
 * How money taken for a debt goes back to the customer: the way it came,
 * never another — cash from the drawer, a card through the terminal, a
 * transfer by transfer (owner decision, 2026-10-07; ADR-0013 §8, G9). After
 * «поверніть покупцю»; cash, and a payment kept from before the way was
 * asked, add nothing.
 */
function backTo(way: TillMethod | null): string {
  return way === "CARD"
    ? " на картку через термінал"
    : way === "TRANSFER"
      ? " переказом"
      : "";
}

/**
 * More than is owed: what is still owed is taken, and the rest goes back the
 * way it came (G9).
 */
function moreThanOwed(owed: string, way: TillMethod | null): string {
  return `Це більше, ніж винні: залишок боргу ${money(owed)}. Прийміть ${money(owed)}, а решту поверніть покупцю${backTo(way)}.`;
}

/**
 * A payment or a write-off refused as it was pressed: what was not recorded
 * first, in the debt's words where the shared ones would speak of an order
 * (credits task list, P2-2). Proven to have recorded nothing, so «спробуйте
 * ще раз»; the debt is read again after it.
 */
export function pressRefusalText(
  error: unknown,
  kind: "payment" | "write-off",
  way?: TillMethod | null,
): string {
  const said = refusalText(error, way);
  const what = kind === "payment" ? "Внесок" : "Списання";
  if (said === CONFLICT_TEXT)
    return `${what} не записано. Дані боргу змінилися, поки ви працювали: перевірте залишок і спробуйте ще раз.`;
  if (said === INVALID_TEXT)
    return `${what} не записано. Перевірте ${kind === "payment" ? "суму" : "причину"} й спробуйте ще раз.`;
  return said;
}

/**
 * Why a payment or a write-off was refused. `way` is how the payment was
 * pressed, null for one kept from before the way was asked, and absent for a
 * write-off. A payment taken on paper and typed once the debt was paid
 * meanwhile stays refused, and the money goes back (owner decisions,
 * 2026-10-04 and 2026-10-07; ADR-0013 §8, G9, G19). A kept payment refused
 * on resend says the same (`@/cash/errors`).
 */
export function refusalText(error: unknown, way?: TillMethod | null): string {
  if (error instanceof ApiError) {
    // Typed from paper, refused for its mark (ADR-0021).
    const paper = paperRefusal(error.details.reason, error.details.days);
    if (paper !== null) return paper;
    switch (error.details.reason) {
      case "MORE_THAN_OWED":
        return way === undefined
          ? `Це більше, ніж винні: залишок боргу ${money(String(error.details.owed))}.`
          : moreThanOwed(String(error.details.owed), way);
      case "NOT_OWED":
        if (way === undefined) return "За цим продажем уже нічого не винні.";
        // Cash not yet given back is in the drawer: a surplus at the close,
        // with its reason. A card or a transfer is not in it.
        return `За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю${backTo(way)}${
          way === "CASH"
            ? ". Поки не повернули, вони зайві в касі: при закритті вкажіть причину."
            : way === null
              ? "."
              : ". На касу це не впливає."
        }`;
      case "NOTHING_PAID":
        return "Внесок має бути більшим за нуль.";
      case "NO_REASON":
        return "Вкажіть, чому списуємо борг.";
      // Taken on paper in another store while this one was blocked, typed
      // once it works again: a manager decides each case (owner decision,
      // 2026-10-07; G25).
      case "PAID_WHERE_SOLD":
        return "Магазин, де продали, знову працює — внесок приймає він. Передайте папір менеджеру.";
      case "PHONE_REQUIRED":
        return askForPhone;
      case "STILL_OWED":
        return "Борг ще не закрито: дані покупця з нього не стирають. Коли його закриють, стерти можна так само.";
    }
  }
  return errorText(error);
}
