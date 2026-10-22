import { useId, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { api, errorText } from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import { Placeholder } from "@/shared/Placeholder";
import type { JournalOutcome } from "@/shared/journal";
import { usePanelRoom } from "@/shared/panel";
import { methodLabels } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { Sum } from "@/shared/Sum";
import { buzz } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { cashErrorText, timeOf } from "./errors";
import { correctionDone, wayName, whenOf } from "./format";
import { OperationPlaceholder } from "./Placeholders";
import { targetLabels, waysFor } from "./types";
import type {
  CashAnswer,
  CashBody,
  Correction,
  EventMethod,
  FixTarget,
  MinePage,
} from "./types";

/** Where one operation's sum and way are read. A sale is the server's
 * `GET /cash/sales/{id}/method`; a payment and a return the same, by kind. */
function methodPath(chosen: FixTarget, storeId: string): string {
  const kind = { SALE: "sales", PAYMENT: "payments", REFUND: "refunds" }[
    chosen.target
  ];
  return `/cash/${kind}/${chosen.id}/method?store_id=${storeId}`;
}

/** «20:05» today, «21.10, 18:40» an earlier day: an open period may span
 * days nobody closed (review, 2026-10-22). */
function momentOf(at: string): string {
  return new Date(at).toDateString() === new Date().toDateString()
    ? timeOf(at)
    : whenOf(at);
}

/** «← Каса», as on the count's screen. */
function Back({ back }: { back: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="quiet back"
      aria-label="Назад до каси"
      onClick={back}
    >
      <span aria-hidden="true">← </span>Каса
    </button>
  );
}

/**
 * A seller's own operations of the open period, a row each by time, kind
 * and goods — never a sum nor a way (G16, G32) — and the way of the one they
 * choose (cash task list, P1-3): «Каса», «Змінити спосіб оплати», the
 * operation, the way, «Змінити на «Готівка»». The receipt's «Змінити спосіб
 * оплати» opens its sale straight away, for the owner and managers too.
 */
export function FixStep({
  store,
  token,
  initial,
  kept,
  disabled,
  send,
  back,
}: {
  store: Store;
  token: string;
  initial: FixTarget | null;
  /** «Каса»'s kept command's banner and words. */
  kept: ReactNode;
  disabled: boolean;
  send: (body: CashBody) => Promise<JournalOutcome<CashAnswer>>;
  /** Back to «Каса»: what was recorded, or null. */
  back: (done: string | null) => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<FixTarget | null>(initial);
  const mine = useQuery({
    queryKey: ["cash-mine", store.id],
    queryFn: () =>
      api<MinePage>(`/cash/events?store_id=${store.id}&mine=true`, token),
    enabled: chosen === null,
    retry: false,
  });
  const method = useQuery({
    queryKey: ["cash-method", chosen?.target, chosen?.id],
    queryFn: () =>
      api<EventMethod>(
        methodPath(chosen ?? { target: "SALE", id: "" }, store.id),
        token,
      ),
    enabled: chosen !== null,
    retry: false,
  });
  const leave = (
    <Back
      back={() => {
        back(null);
      }}
    />
  );
  const answer = method.data;
  if (chosen)
    return (
      <section className="cash-fix">
        {leave}
        <h2>Змінити спосіб оплати</h2>
        {kept}
        {method.error ? (
          // A read, never a command: no «Не записано» (review, 2026-10-22).
          <p role="alert">{errorText(method.error)}</p>
        ) : answer === undefined ? (
          <OperationPlaceholder />
        ) : answer.may_change ? (
          <WayCard
            what={`${targetLabels[answer.target]}${
              chosen.at === undefined ? "" : ` · ${momentOf(chosen.at)}`
            }`}
            amount={answer.amount_taken}
            current={answer.method}
            corrected={answer.corrected}
            ways={waysFor(answer.is_order)}
            closedNote={null}
            disabled={disabled}
            send={async (to, note) => {
              const outcome = await send({
                command: "correction",
                store_id: store.id,
                command_id: crypto.randomUUID(),
                target: answer.target,
                target_id: answer.target_id,
                from_method: answer.method,
                to_method: to,
                note,
              });
              if (outcome.kind === "done") {
                buzz("success");
                back(correctionDone(outcome.result as Correction));
              } else if (outcome.kind === "refused") {
                buzz("error");
                // A way changed meanwhile is read again (B6.1).
                void method.refetch();
                return cashErrorText(outcome.error, false, "correction");
              }
              // Unknown: held here under «Каса»'s banner until it is known;
              // confirmed, «Каса» leaves it (review, 2026-10-22).
              return null;
            }}
          />
        ) : (
          <p>
            {targetLabels[answer.target]}: {money(answer.amount_taken)} ·{" "}
            {wayName(answer.method)}. Змінити спосіб оплати тепер може лише
            менеджер або власник.
          </p>
        )}
      </section>
    );
  return (
    <section className="cash-fix">
      {leave}
      <h2>Змінити спосіб оплати</h2>
      {kept}
      <p className="cash-context">Ваші операції після останнього закриття</p>
      {mine.isPending ? (
        <Placeholder said="Завантажуємо…" rows={3} day={false} />
      ) : mine.error ? (
        <p role="alert">{errorText(mine.error)}</p>
      ) : mine.data.items.length === 0 ? (
        <p>Після останнього закриття ви ще нічого не провели.</p>
      ) : (
        <ul className="fix-list" aria-label="Ваші операції">
          {mine.data.items.map((event) => (
            <li key={event.target_id}>
              <button
                type="button"
                className="sale-row fix-row"
                disabled={disabled}
                onClick={() => {
                  setChosen({
                    target: event.target,
                    id: event.target_id,
                    at: event.at,
                  });
                }}
              >
                <span className="fix-time">{momentOf(event.at)}</span>
                <span className="sale-main">
                  <span className="cash-row-title">
                    {targetLabels[event.target]}
                  </span>
                  <span className="sale-meta">{visible(event.label)}</span>
                </span>
                <span className="sale-open" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One operation's sum, large, its way now as a pill, and the ways to change
 * it to as the till's buttons — the one it has now not to be chosen — with
 * «Змінити на «Готівка»» in the panel under the thumb (cash task list,
 * P1-3). The seller's and the owner's and managers' alike.
 */
export function WayCard({
  what,
  amount,
  current,
  corrected,
  ways,
  closedNote,
  aside,
  disabled,
  send,
}: {
  /** «Продаж · 20:05». */
  what: string;
  amount: string;
  current: PaymentMethod | null;
  corrected: boolean;
  ways: readonly PaymentMethod[];
  closedNote: string | null;
  /** Under the ways: another operation to choose, for whoever lists them. */
  aside?: ReactNode;
  disabled: boolean;
  /** The refusal's text, or null. */
  send: (to: PaymentMethod, note: string | null) => Promise<string | null>;
}): JSX.Element {
  const [picked, setTo] = useState<PaymentMethod | null>(null);
  // A way read again as the one it has now is no longer a change (B6.1).
  const to = picked === current ? null : picked;
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const hint = useId();
  const panel = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, true);
  return (
    <>
      <div className="fix-card">
        <p className="fix-what">{what}</p>
        <p className="fix-sum">
          <Sum value={money(amount)} />
        </p>
        <span className="badge neutral">
          Зараз: {wayName(current)}
          {corrected ? " · виправлено" : ""}
        </span>
      </div>
      {closedNote && <p className="notice">{closedNote}</p>}
      <div
        ref={group}
        // An order's five ways a row each (cash task list, P1-3).
        className={`pay-ways fix-ways${ways.length > 3 ? " fix-ways-rows" : ""}`}
        role="group"
        aria-label="Новий спосіб оплати"
      >
        {ways.map((way) => (
          <button
            key={way}
            type="button"
            aria-pressed={to === way}
            disabled={disabled || way === current}
            onClick={() => {
              setTo(way);
              setProblem(null);
            }}
          >
            {methodLabels[way]}
            {way === current && <span className="fix-now"> зараз</span>}
          </button>
        ))}
      </div>
      {aside}
      <label>
        Пояснення (необов’язково)
        <input
          value={note}
          maxLength={200}
          disabled={disabled}
          aria-describedby={hint}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <NoCustomerData id={hint} />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <div className="pay-panel" ref={panel}>
        <button
          type="button"
          className="cash-panel-button"
          disabled={disabled || to === null}
          onClick={() => {
            if (to === null) return;
            void send(to, note.trim() === "" ? null : note.trim()).then(
              (text) => {
                setProblem(text);
                // Refused: on a way to choose again (review, 2026-10-22).
                if (text !== null)
                  requestAnimationFrame(() =>
                    group.current
                      ?.querySelector<HTMLButtonElement>(
                        "button:not(:disabled)",
                      )
                      ?.focus(),
                  );
              },
            );
          }}
        >
          {to === null
            ? "Оберіть новий спосіб"
            : `Змінити на «${methodLabels[to]}»`}
        </button>
      </div>
    </>
  );
}
