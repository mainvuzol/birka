import { useEffect, useId, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { money } from "@/orders/types";
import { errorText } from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { usePanelRoom } from "@/shared/panel";
import { methodLabels } from "@/shared/payment";
import { Sum } from "@/shared/Sum";
import { visible } from "@/shared/visible";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { dayOf } from "./errors";
import {
  cardParts,
  moved,
  nothing,
  signed,
  unclosedText,
  whenOf,
} from "./format";
import { ClosePlaceholder, ContextPlaceholder } from "./Placeholders";
import type { Close } from "./types";

/** Nothing to compare with: the first count, or the first after the store
 * came back from the archive (G6, G30). */
export function isOpening(close: Close): boolean {
  return close.opening || close.expected === null || close.difference === null;
}

/**
 * The difference in words, and what it means: a shortage or a surplus is a
 * warning — neither a debt nor anyone's fault — and to the kopeck the
 * accent's (owner decision, 2026-10-21, В4 (а); cash task list, P0-3).
 */
export function differenceOf(difference: string): {
  text: string;
  match: boolean;
} {
  if (nothing(difference)) return { text: "Збіглося до копійки", match: true };
  return difference.startsWith("-")
    ? { text: `Нестача ${money(difference.slice(1))}`, match: false }
    : { text: `Надлишок ${money(difference)}`, match: false };
}

/**
 * «Мало бути» and «Порахували» large, the difference on its own line (cash
 * task list, P0-3): the notebook's column of three figures. Every figure is
 * the server's; nothing is summed here.
 */
function Figures({
  close,
  now,
}: {
  close: Close;
  /** Just counted: what comes next is said; read later, it is not. */
  now: boolean;
}): JSX.Element {
  if (isOpening(close))
    return (
      <div
        className="owed-card cash-figures"
        role="group"
        aria-label="Підрахунок"
      >
        <p className="owed-what">Порахували</p>
        <p className="cash-sum">
          <Sum value={money(close.counted)} />
        </p>
        {now && (
          <p className="owed-count">З цієї суми почнемо наступного разу.</p>
        )}
      </div>
    );
  const difference = differenceOf(close.difference ?? "0.00");
  return (
    <div
      className="owed-card cash-figures"
      role="group"
      aria-label="Закриття каси"
    >
      <div className="cash-figure">
        <p className="owed-what">Мало бути</p>
        <p className="cash-sum">
          <Sum value={money(close.expected ?? "0.00")} />
        </p>
      </div>
      <div className="cash-figure">
        <p className="owed-what">Порахували</p>
        <p className="cash-sum">
          <Sum value={money(close.counted)} />
        </p>
      </div>
      <p className={`cash-difference ${difference.match ? "match" : "warn"}`}>
        {difference.text}
      </p>
    </div>
  );
}

/** The card's and the transfer's sums, a row each, to compare by eye with
 * the terminal's slip (owner, answer 11). */
function Slip({ close }: { close: Close }): JSX.Element {
  return (
    <ul className="history cash-slip" aria-label="Картка й переказ">
      <li className="history-row">
        <span className="history-main">
          <span className="history-what">Картка</span>
          <span className="history-meta">
            {[
              ...(cardParts(close.card) ?? []),
              "звірте з чеком терміналу",
            ].join(" · ")}
          </span>
        </span>
        <span className="history-sum">{signed(close.card.net)}</span>
      </li>
      <li className="history-row">
        <span className="history-main">
          <span className="history-what">Переказ</span>
        </span>
        <span className="history-sum">{signed(close.transfer.net)}</span>
      </li>
    </ul>
  );
}

/** The reason as it was written, by whom; or that none was. */
export function ReasonLine({ close }: { close: Close }): JSX.Element | null {
  if (close.reason !== null)
    return (
      <p className="cash-reason">
        Причина: «{visible(close.reason)}»
        {close.reason_by && ` · ${visible(close.reason_by)}`}
      </p>
    );
  return close.reason_required ? <p>Причину не вказано.</p> : null;
}

const explanationLabels: Record<Close["explanations"][number]["kind"], string> =
  {
    CORRECTION: "виправлення способу оплати",
    TAKE_OUT: "видано з каси",
    PUT_IN: "внесено в касу",
  };

/**
 * For the owner and managers (G27): the period's cash, the orders' money
 * that never went through the till, what has no way, and what explains the
 * difference. A seller's close carries none of it.
 */
export function PeriodDetails({ close }: { close: Close }): JSX.Element {
  const explained =
    close.explained !== null &&
    close.unexplained !== null &&
    close.difference !== null &&
    !nothing(close.difference);
  return (
    <>
      {close.cash_in !== null && !close.opening && (
        <dl className="cash-period" aria-label="Готівка за період">
          {close.opening_float !== null && (
            <>
              <dt>На початку</dt>
              <dd>{money(close.opening_float)}</dd>
            </>
          )}
          <dt>Готівкою отримано</dt>
          <dd>{money(close.cash_in)}</dd>
          {close.cash_out !== null && (
            <>
              <dt>Готівкою повернено</dt>
              <dd>{money(close.cash_out)}</dd>
            </>
          )}
          {close.taken_out !== null && (
            <>
              <dt>Видано з каси</dt>
              <dd>{money(close.taken_out)}</dd>
            </>
          )}
          {close.put_in !== null && (
            <>
              <dt>Внесено в касу</dt>
              <dd>{money(close.put_in)}</dd>
            </>
          )}
          {close.cash_corrected !== null && !nothing(close.cash_corrected) && (
            <>
              <dt>Виправлення способу оплати</dt>
              <dd>{moved(close.cash_corrected)}</dd>
            </>
          )}
        </dl>
      )}
      {/* Order money that never went through the till (owner decision). */}
      {close.prepaid_transfer !== null && !nothing(close.prepaid_transfer) && (
        <p>
          {methodLabels.PREPAID_TRANSFER}: {signed(close.prepaid_transfer)}.
        </p>
      )}
      {close.carrier_cod !== null && !nothing(close.carrier_cod) && (
        <p>
          {methodLabels.CARRIER_COD}: {signed(close.carrier_cod)}.
        </p>
      )}
      {close.not_stated !== null && !nothing(close.not_stated.net) && (
        <p>Спосіб оплати не вказано: {signed(close.not_stated.net)}.</p>
      )}
      {explained && (
        <p>
          Пояснено: {moved(close.explained ?? "0.00")}. Не пояснено:{" "}
          {signed(close.unexplained ?? "0.00")}.
        </p>
      )}
      {close.explanations.length > 0 && (
        <ul aria-label="Що пояснює різницю">
          {close.explanations.map((item, index) => (
            <li key={`${item.at}:${String(index)}`}>
              {whenOf(item.at)} · {explanationLabels[item.kind]} ·{" "}
              {moved(item.cash)} · {visible(item.by)}
              {item.text && ` · ${visible(item.text)}`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * A close's figures, the slip, the days nobody closed before it, the reason
 * and, for the owner and managers, its period: the close's result and the
 * history's close alike (cash task list, P0-3, P1-4). `reason`: false while
 * a reason is owed, its form standing below.
 */
export function CloseBody({
  close,
  reason = true,
  now = true,
}: {
  close: Close;
  reason?: boolean;
  /** The close's result, just made; false for one read back later, whose
   * «наступного разу» has long come (review, 2026-10-22). */
  now?: boolean;
}): JSX.Element {
  return (
    <>
      <Figures close={close} now={now} />
      <Slip close={close} />
      {close.unclosed_days.length > 0 && (
        <p>{unclosedText(close.unclosed_days)}</p>
      )}
      {reason && <ReasonLine close={close} />}
      <PeriodDetails close={close} />
    </>
  );
}

/**
 * Today's own close on «Каса»'s main screen, compact (cash task list,
 * P0-1): its three figures in one line, and the reason.
 */
export function CloseSummary({ close }: { close: Close }): JSX.Element {
  const difference = isOpening(close)
    ? null
    : differenceOf(close.difference ?? "0.00");
  return (
    <div
      className="owed-card cash-today"
      role="group"
      aria-label="Закриття каси"
    >
      <p>
        {difference === null ? (
          `Перший підрахунок: ${money(close.counted)}`
        ) : (
          <>
            Мало бути {money(close.expected ?? "0.00")} · Порахували{" "}
            {money(close.counted)} ·{" "}
            <span
              className={`cash-difference ${difference.match ? "match" : "warn"}`}
            >
              {difference.text}
            </span>
          </>
        )}
      </p>
      <ReasonLine close={close} />
    </div>
  );
}

/**
 * One tap for the reasons an outage leaves (owner decision, 2026-10-04;
 * ADR-0013 §9, G8): a sale typed after the close it belonged to, and a
 * return or a debt payment typed so; and the first days' paper, whose money
 * comes into the drawer as any sale's (owner decision, 2026-10-16). Each
 * puts its words in the field, to be edited: the reason stays free text.
 */
const outageReasons = [
  "Продаж під час збою",
  "Повернення чи внесок під час збою",
  "Продажі з паперу перших днів",
] as const;

/**
 * Why the count differs, written only by whoever counted (G12): the field
 * and the quick reasons on the screen, its button in the panel under the
 * thumb. The cursor is not put in the field: the figures are read first.
 */
function ReasonForm({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (reason: string) => Promise<void>;
}): JSX.Element {
  const [reason, setReason] = useState("");
  const hint = useId();
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, true);
  return (
    <>
      <fieldset className="cash-reason-form" disabled={disabled}>
        <label>
          Чому не збігається? (обов’язково)
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
        <div className="reason-chips">
          {outageReasons.map((text) => (
            <button
              key={text}
              type="button"
              className="quiet"
              onClick={() => {
                setReason(text);
              }}
            >
              {text}
            </button>
          ))}
        </div>
      </fieldset>
      {/* The section's own child, so it stays under the thumb however long
          what comes before it — the owner's period figures (review,
          2026-10-21). */}
      <div className="pay-panel" ref={panel}>
        <p className="pay-what">
          Поки причину не записано, інші розділи недоступні.
        </p>
        <button
          type="button"
          className="cash-panel-button"
          disabled={disabled || reason.trim() === ""}
          onClick={() => {
            void send(reason.trim());
          }}
        >
          Записати причину
        </button>
      </div>
    </>
  );
}

/**
 * The close's result (cash task list, P0-3): «Касу закрито», its figures
 * large, the card's and the transfer's rows, and the reason under the thumb
 * when one is owed; then «Готово», back to «Каса».
 */
export function Closed({
  close,
  owedId,
  storeId,
  failed,
  kept,
  done,
  problem,
  disabled,
  sendReason,
  retry,
  leave,
  finish,
}: {
  /** Null while the close a reason is owed for is still being read. */
  close: Close | null;
  /** The close a reason is owed for: until it is written, no other tab. */
  owedId: string | null;
  /** This store: another's close is named by its store. */
  storeId: string;
  /** The close could not be read. */
  failed: unknown;
  /** The kept command's banner and words, as on every screen of «Каса». */
  kept: ReactNode;
  done: string | null;
  problem: string | null;
  disabled: boolean;
  sendReason: (reason: string) => Promise<void>;
  retry: () => void;
  /** Back to «Каса», whose own tasks a reason owed never holds (G12). */
  leave: () => void;
  finish: () => void;
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        pushed
        title={
          close && isOpening(close)
            ? "Перший підрахунок записано"
            : "Касу закрито"
        }
        back={
          owedId !== null && (
            <button
              type="button"
              className="quiet back"
              aria-label="Назад до каси"
              onClick={leave}
            >
              <span aria-hidden="true">← </span>Каса
            </button>
          )
        }
      />
      <section className="cash-closed">
        {close ? (
          // Which close: its day, and its store when it is another's — a
          // reason owed is the closer's in any store (review, 2026-10-21).
          <p className="cash-context">
            Закриття {dayOf(close.business_day)}
            {close.store_id !== storeId &&
              ` · магазин «${visible(close.store_name)}»`}
          </p>
        ) : (
          // Its place while read, in its own slot (review, 2026-10-22).
          !failed && <ContextPlaceholder size="Закриття 00.00" />
        )}
        {kept}
        {close === null ? (
          failed ? (
            <div role="alert">
              <p>{errorText(failed)}</p>
              <button type="button" onClick={retry}>
                Спробувати ще раз
              </button>
            </div>
          ) : (
            <ClosePlaceholder />
          )
        ) : (
          <CloseBody close={close} reason={owedId === null} />
        )}
        {done && <p role="status">{done}</p>}
        {problem && <p role="alert">{problem}</p>}
        {owedId !== null ? (
          <ReasonForm key={owedId} disabled={disabled} send={sendReason} />
        ) : (
          <div className="result-next">
            <button type="button" onClick={finish}>
              Готово
            </button>
          </div>
        )}
      </section>
    </>
  );
}
