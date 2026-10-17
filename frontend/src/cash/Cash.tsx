import { useEffect, useId, useState } from "react";
import type { JSX, ReactNode } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, errorText, unreachable } from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import type { JournalOutcome } from "@/shared/journal";
import { keptText, useAutoCheck } from "@/shared/reach";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { methodLabels, notStated } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { visible } from "@/shared/visible";
import {
  resolveCashCommand,
  submitCashCommand,
  useCashCommand,
  useCashLastCommand,
} from "./commands";
import { cashErrorText, cashJournalText, dayOf, timeOf } from "./errors";
import { directionOf, movementLabels, waysFor } from "./types";
import type {
  CashAnswer,
  CashBody,
  Close,
  ClosePage,
  CloseBrief,
  Correction,
  DayEvent,
  Drawer,
  EventMethod,
  EventPage,
  MineEvent,
  MinePage,
  Movement,
  MovementKind,
  Target,
  WaySums,
} from "./types";

/**
 * «Каса»: the store's drawer (owner decisions, 2026-10-04; ADR-0012, B12).
 *
 * One drawer per store, closed once a day by the seller on duty: they count
 * the cash and type it without seeing what the drawer should hold, then
 * see the difference; what they counted is where the next day starts. A
 * difference of 1,00 грн or more needs their reason, and until they write
 * it every other tab of their phone waits (G12, G41). Card and transfer are
 * not counted: their sums are shown after the count, to compare by eye with
 * the terminal's slip.
 *
 * Cash taken out is recorded with who took it and why — a seller for
 * expenses or a supplier's courier, the owner and managers for any reason,
 * and cash put in for change (G29, G34). Before the close a seller fixes the
 * way of paying of their own sales, debt payments and returns (G16); the
 * owner and managers correct any, a closed day's correction explaining that
 * close's difference (G7). They also read the closes.
 *
 * Nothing on this screen lists the seller's sales with their sums or ways
 * before their count (G32): the drawer's answer carries no sum at all.
 */

/**
 * `GET /cash/drawer`, read by «Каса» and by the App, which holds the phone
 * while a reason is owed. Read when the screen opens and when asked, never
 * behind the seller's back: the newest close it shows is the one their count
 * names (`after_close_id`), so a close made meanwhile on another phone is
 * refused rather than silently counted over.
 */
export function useDrawer(storeId: string, token: string, enabled: boolean) {
  return useQuery({
    queryKey: ["cash-drawer", storeId],
    queryFn: () => api<Drawer>(`/cash/drawer?store_id=${storeId}`, token),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** One operation whose way is to be changed: the receipt's sale, or one
 * chosen from a list. */
export interface FixTarget {
  target: Target;
  id: string;
}

type Step =
  | { name: "main" }
  | { name: "move"; direction: "OUT" | "IN" }
  | { name: "fix"; chosen: FixTarget | null }
  | { name: "correct" }
  | { name: "history" };

const targetLabels: Record<Target, string> = {
  SALE: "Продаж",
  PAYMENT: "Внесок",
  REFUND: "Повернення",
};

/** What a pending command is, in «Невідомо, чи записано …». */
const pendingLabels: Record<CashBody["command"], string> = {
  close: "закриття каси",
  reason: "причину різниці",
  movement: "видачу чи внесення",
  correction: "зміну способу оплати",
};

// A sum that may be below nothing: «−150,00 грн».
function signed(value: string): string {
  return value.startsWith("-") ? `−${money(value.slice(1))}` : money(value);
}

// What moved the drawer either way: «+350,00 грн», «−150,00 грн».
function moved(value: string): string {
  return value.startsWith("-") || nothing(value)
    ? signed(value)
    : `+${money(value)}`;
}

function nothing(value: string): boolean {
  return kopecks(value.replace(/^-/, "")) === 0n;
}

function wayName(method: PaymentMethod | null): string {
  return method ? methodLabels[method] : notStated;
}

/** «06.10, 20:00» of a moment, the phone's own time. */
function whenOf(iso: string): string {
  const at = new Date(iso);
  return `${at.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}, ${timeOf(iso)}`;
}

/** The phone's own date, as the server's days are written. */
function isoDay(at: Date): string {
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

function daysAgo(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() - days);
  return isoDay(at);
}

/** «Нестача 150,00 грн.», «Надлишок 350,00 грн.», «Збіглося до копійки.» */
function differenceText(difference: string): string {
  if (nothing(difference)) return "Збіглося до копійки.";
  return difference.startsWith("-")
    ? `Нестача ${money(difference.slice(1))}.`
    : `Надлишок ${money(difference)}.`;
}

/** A day nobody closed went into this close (G9); the same words as the bot's. */
function unclosedText(days: string[]): string {
  const named = days.map(dayOf).join(", ");
  return days.length === 1
    ? `Не закрито: ${named} — цей день увійшов у це закриття.`
    : `Не закрито: ${named} — ці дні увійшли в це закриття.`;
}

/**
 * The card's sum since the previous close, to compare with the terminal's
 * end-of-day slip (owner, answer 11): what came in and what went back, and
 * what corrections moved off or onto the card.
 */
function cardText(card: WaySums): string {
  const parts = [
    `оплати ${money(card.came_in)}`,
    `повернення ${money(card.went_out)}`,
    ...(nothing(card.corrected) ? [] : [`виправлено ${moved(card.corrected)}`]),
  ];
  const detail =
    nothing(card.went_out) && nothing(card.corrected)
      ? ""
      : ` (${parts.join(", ")})`;
  return `Картка: ${signed(card.net)}${detail}. Звірте з чеком терміналу.`;
}

const explanationLabels: Record<Close["explanations"][number]["kind"], string> =
  {
    CORRECTION: "виправлення способу оплати",
    TAKE_OUT: "видано з каси",
    PUT_IN: "внесено в касу",
  };

/** The count's result, as its closer sees it (G27), and what explains it. */
export function CloseResult({ close }: { close: Close }): JSX.Element {
  return (
    <div className="section-block" role="status" aria-label="Закриття каси">
      <p>
        {close.opening || close.expected === null || close.difference === null
          ? `Перший підрахунок: ${money(close.counted)}. З цієї суми почнемо наступного разу.`
          : `Касу закрито. Мало бути ${money(close.expected)}, порахували ${money(close.counted)}. ${differenceText(close.difference)}`}
      </p>
      <CloseDetails close={close} />
      {close.unclosed_days.length > 0 && (
        <p>{unclosedText(close.unclosed_days)}</p>
      )}
    </div>
  );
}

/** What every view of a close shows under its count: the slip's sums, the
 * reason, and for the owner and managers the cash itself. */
function CloseDetails({ close }: { close: Close }): JSX.Element {
  const explained =
    close.explained !== null &&
    close.unexplained !== null &&
    close.difference !== null &&
    !nothing(close.difference);
  return (
    <>
      <p>{cardText(close.card)}</p>
      <p>Переказ: {signed(close.transfer.net)}.</p>
      {close.reason !== null ? (
        <p>
          Причина: «{visible(close.reason)}»
          {close.reason_by && ` · ${visible(close.reason_by)}`}
        </p>
      ) : (
        close.reason_required && <p>Причину не вказано.</p>
      )}
      {close.cash_in !== null && !close.opening && (
        <dl className="debt" aria-label="Готівка за період">
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

export function Cash({
  store,
  token,
  journalKey,
  blocked,
  networkOwner,
  fix,
  fixSeen,
  person,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** The network's owner: the bot does not write to whoever closed (G40). */
  networkOwner: boolean;
  /** The receipt's «Змінити спосіб оплати»: straight to that sale. */
  fix: FixTarget | null;
  fixSeen: () => void;
  /** Whoever this phone belongs to: named on the kept operation's paper line. */
  person: string;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, error } = useCashCommand();
  // Kept when this screen opened: the App read it from the phone's storage
  // and opened «Каса» on it, since a kept drawer command holds every other
  // tab.
  const [loaded] = useState(() => pending !== null);
  const drawer = useDrawer(store.id, token, true);
  const [step, setStep] = useState<Step>(() =>
    fix ? { name: "fix", chosen: fix } : { name: "main" },
  );
  useEffect(() => {
    if (fix) fixSeen();
  }, [fix, fixSeen]);
  // The close just recorded, or the one whose reason was just written.
  const [result, setResult] = useState<Close | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Which command the journal's error is about, to say what was not
  // recorded: beside the journal, since the error outlives this screen.
  const lastCommand = useCashLastCommand((state) => state.command);
  const working = blocked || busy || pending !== null;
  const financial = store.permissions.includes("report:view_financial");
  // Recent closes: the history's first page, and what a late movement may
  // name («До закриття 07.10»).
  const recent = useQuery({
    queryKey: ["cash-closes", store.id, "recent"],
    queryFn: () =>
      api<ClosePage>(
        `/cash/closes?store_id=${store.id}&date_from=${daysAgo(30)}&date_to=${isoDay(new Date())}&limit=10`,
        token,
      ),
    enabled: financial,
    retry: false,
  });

  function changed(): void {
    void cache.invalidateQueries({ queryKey: ["cash-drawer", store.id] });
    void cache.invalidateQueries({ queryKey: ["cash-closes", store.id] });
    void cache.invalidateQueries({ queryKey: ["cash-close"] });
    void cache.invalidateQueries({ queryKey: ["cash-mine", store.id] });
    void cache.invalidateQueries({ queryKey: ["cash-events", store.id] });
    void cache.invalidateQueries({ queryKey: ["cash-method"] });
  }

  async function send(body: CashBody): Promise<JournalOutcome<CashAnswer>> {
    setDone(null);
    setProblem(null);
    useCashLastCommand.setState({ command: body.command });
    const outcome = await submitCashCommand(journalKey, token, {
      // A new transport key per attempt; the command's identity is
      // `command_id`, which is what makes a late retry safe.
      key: crypto.randomUUID(),
      body,
    });
    changed();
    return outcome;
  }

  /** What an answer means, however late it came. */
  function recorded(body: CashBody, answer: CashAnswer): void {
    switch (body.command) {
      case "close":
        setResult(answer as Close);
        return;
      case "reason":
        setResult(answer as Close);
        setDone(reasonDone(answer as Close, networkOwner));
        return;
      case "movement":
        setDone(movementDone(answer as Movement));
        return;
      case "correction":
        setDone(correctionDone(answer as Correction));
        return;
    }
  }

  // The close a reason is owed for: the drawer's, or the close just recorded
  // until the drawer is read again. Never one whose reason this screen has
  // just written: its answer still says `reason_required` (that is the
  // difference's, not what remains to do), and the form would stay, saying
  // the other tabs wait while the App has opened them (G12).
  const owedId =
    drawer.data?.reason_owed?.id ??
    (result?.reason_required && result.reason === null ? result.id : null);
  // The close a reason is owed for, or the closer's own of today, read
  // again when this screen no longer holds it.
  const ownToday =
    drawer.data?.closed_today && drawer.data.last_close?.mine
      ? drawer.data.last_close.id
      : null;
  const shownId = owedId ?? ownToday;
  const shown = useQuery({
    queryKey: ["cash-close", shownId],
    queryFn: () => api<Close>(`/cash/closes/${shownId ?? ""}`, token),
    enabled: shownId !== null && result?.id !== shownId,
    retry: false,
  });
  const close = result?.id === shownId ? result : (shown.data ?? result);

  /** The kept command, resent as it is: by its button, or by itself. */
  function check(): void {
    const attempt = pending;
    if (!attempt) return;
    setDone(null);
    setProblem(null);
    useCashLastCommand.setState({ command: attempt.body.command });
    void resolveCashCommand(journalKey, token, attempt).then((outcome) => {
      if (outcome.kind === "done") {
        recorded(attempt.body, outcome.result);
        if (attempt.body.command !== "reason")
          setDone(
            (text) =>
              text ??
              "Операцію було записано один раз — повторно вона не пройде.",
          );
      } else if (outcome.kind === "refused")
        // Proven to have recorded nothing: the journal is settled, and the
        // refusal says what to do instead.
        useCashCommand.setState({ error: outcome.error });
      changed();
    });
  }
  // «Каса»'s kept command is checked by itself too (ADR-0013 §4.3, §9).
  useAutoCheck([{ pending: pending !== null, busy, loaded, run: check }]);

  if (step.name === "move" && drawer.data)
    return (
      <MoveStep
        store={store}
        drawer={drawer.data}
        direction={step.direction}
        closes={
          recent.data?.items ??
          (drawer.data.last_close ? [drawer.data.last_close] : [])
        }
        disabled={working}
        send={send}
        back={(text) => {
          setStep({ name: "main" });
          setDone(text);
        }}
      />
    );
  if (step.name === "fix")
    return (
      <FixStep
        store={store}
        token={token}
        initial={step.chosen}
        manager={drawer.data?.may_correct ?? false}
        disabled={working}
        send={send}
        back={(text) => {
          setStep({ name: "main" });
          setDone(text);
        }}
      />
    );
  if (step.name === "correct")
    return (
      <CorrectStep
        store={store}
        token={token}
        closes={recent.data?.items ?? []}
        disabled={working}
        send={send}
        back={(text) => {
          setStep({ name: "main" });
          setDone(text);
        }}
      />
    );
  if (step.name === "history")
    return (
      <History
        store={store}
        token={token}
        back={() => {
          setStep({ name: "main" });
        }}
      />
    );

  const data = drawer.data;
  const kinds = data?.movement_kinds ?? [];
  const takesOut = kinds.some((kind) => directionOf(kind) === "OUT");
  const putsIn = kinds.some((kind) => directionOf(kind) === "IN");
  // The count's form is shown: the reminder to record cash moved comes
  // first, with its buttons, then the count.
  const formShown =
    data !== undefined &&
    data.may_close &&
    !(data.closed_today && data.last_close !== null);
  const moves = (takesOut || putsIn) && (
    <div className="actions">
      {takesOut && (
        <button
          className="quiet"
          disabled={working}
          onClick={() => {
            // The newest close is read again when the form opens:
            // what the movement names as the one it came after.
            void drawer.refetch();
            setStep({ name: "move", direction: "OUT" });
          }}
        >
          Видати з каси
        </button>
      )}
      {putsIn && (
        <button
          className="quiet"
          disabled={working}
          onClick={() => {
            void drawer.refetch();
            setStep({ name: "move", direction: "IN" });
          }}
        >
          Внести в касу
        </button>
      )}
    </div>
  );
  return (
    <section>
      <div className="toolbar">
        <h2>Каса</h2>
        <button
          className="quiet"
          disabled={drawer.isFetching}
          onClick={() => {
            changed();
          }}
        >
          Оновити
        </button>
      </div>
      {pending && (
        <section className="notice">
          <h3>
            {busy ? "Перевіряємо операцію каси…" : "Незавершена операція каси"}
          </h3>
          <p>
            Невідомо, чи записано {pendingLabels[pending.body.command]}.
            Перевірте результат — та сама операція не запишеться двічі. Поки
            чекаємо, інші дії недоступні.
          </p>
          <p>{keptText(pending.since, person)}</p>
          <button disabled={busy} onClick={check}>
            Перевірити результат
          </button>
        </section>
      )}
      {error !== null && (
        <p role="alert">{cashJournalText(error, lastCommand)}</p>
      )}
      {done && <p role="status">{done}</p>}
      {problem && <p role="alert">{problem}</p>}
      {drawer.isPending ? (
        <p role="status">Завантажуємо касу…</p>
      ) : drawer.error ? (
        <div role="alert">
          <p>{errorText(drawer.error)}</p>
          {unreachable(drawer.error) && (
            // No close while the server does not answer (owner decisions,
            // 2026-10-04 and 2026-10-07; ADR-0013 §9, G26).
            <p>
              Касу зараз не закрити: сервер не відповідає. Перерахуйте гроші й
              запишіть суму для себе. Якщо сервер відповість сьогодні — спершу
              внесіть усе з паперу, потім закрийте касу; якщо ні — закриєте
              наступного вечора.
            </p>
          )}
          <button
            onClick={() => {
              void drawer.refetch();
            }}
          >
            Повторити
          </button>
        </div>
      ) : data === undefined ? null : (
        <>
          {owedId !== null && (
            <div className="notice">
              {close && close.id === owedId && <CloseResult close={close} />}
              <ReasonForm
                key={owedId}
                disabled={working}
                send={async (reason) => {
                  const body: CashBody = {
                    command: "reason",
                    store_id: store.id,
                    command_id: crypto.randomUUID(),
                    close_id: owedId,
                    reason,
                  };
                  const outcome = await send(body);
                  if (outcome.kind === "done") recorded(body, outcome.result);
                  else if (outcome.kind === "refused")
                    setProblem(cashErrorText(outcome.error));
                }}
              />
              <p className="hint">
                Поки причину не записано, інші розділи недоступні.
              </p>
            </div>
          )}
          <Status
            drawer={data}
            moves={formShown ? moves : null}
            disabled={working}
            close={async (counted) => {
              const body: CashBody = {
                command: "close",
                store_id: store.id,
                command_id: crypto.randomUUID(),
                counted,
                // The moment of «Так, закрити»: the count describes the
                // drawer then, and only for ten minutes (G31).
                counted_at: new Date().toISOString(),
                after_close_id: data.last_close?.id ?? null,
              };
              const outcome = await send(body);
              if (outcome.kind === "done") recorded(body, outcome.result);
              else if (outcome.kind === "refused")
                setProblem(cashErrorText(outcome.error));
              return outcome.kind !== "unknown";
            }}
          />
          {owedId === null && close && <CloseResult close={close} />}
          {!formShown && moves}
          {data.movements.length > 0 && (
            <>
              <h3>Видано й внесено після останнього закриття</h3>
              <ul aria-label="Видано й внесено">
                {data.movements.map((movement) => (
                  <li key={movement.id}>{movementLine(movement)}</li>
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            {data.may_correct ? (
              <button
                className="quiet"
                disabled={working}
                onClick={() => {
                  setStep({ name: "correct" });
                }}
              >
                Виправити спосіб оплати
              </button>
            ) : (
              store.permissions.includes("sale:create") && (
                <button
                  className="quiet"
                  disabled={working}
                  onClick={() => {
                    setStep({ name: "fix", chosen: null });
                  }}
                >
                  Змінити спосіб оплати
                </button>
              )
            )}
            {financial && (
              <button
                className="quiet"
                onClick={() => {
                  setStep({ name: "history" });
                }}
              >
                Закриття
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function movementLine(movement: Movement): string {
  return `${whenOf(movement.at)} · ${movementLabels[movement.kind]} ${money(movement.amount)} · ${visible(movement.by)}${
    movement.note ? ` · ${visible(movement.note)}` : ""
  }${movement.for_day ? ` · до закриття ${dayOf(movement.for_day)}` : ""}`;
}

/**
 * Within the bot's 15 minutes the reason goes with the message; later the
 * owner already has it without, and reads the reason in the app (G11). The
 * phone's own clock tells which, against the close's moment. The network's
 * owner who closed gets no message at all (G40).
 */
function reasonDone(close: Close, networkOwner: boolean): string {
  if (networkOwner) return "Причину записано.";
  return Date.now() - Date.parse(close.closed_at) <= 15 * 60 * 1000
    ? "Причину записано. Власник отримає повідомлення."
    : "Причину записано. Власник уже отримав повідомлення без причини — побачить її в застосунку.";
}

function movementDone(movement: Movement): string {
  if (movement.moved_to_close && movement.for_day)
    return `Записано до закриття ${dayOf(movement.for_day)}: гроші взяли до нього.`;
  if (movement.for_day)
    return `Записано до закриття ${dayOf(movement.for_day)}.`;
  return `Записано: ${movementLabels[movement.kind]}, ${money(movement.amount)}.`;
}

function correctionDone(correction: Correction): string {
  return `Спосіб оплати змінено: ${wayName(correction.from_method)} → ${wayName(correction.to_method)}.${
    correction.explains_day
      ? ` Пояснює різницю закриття ${dayOf(correction.explains_day)}.`
      : ""
  }`;
}

/** Where the drawer stands, and the count when it is due. */
function Status({
  drawer,
  moves,
  disabled,
  close,
}: {
  drawer: Drawer;
  /** «Видати з каси», «Внести в касу»: right after the reminder. */
  moves: ReactNode;
  disabled: boolean;
  close: (counted: string) => Promise<boolean>;
}): JSX.Element {
  const last = drawer.last_close;
  if (drawer.closed_today && last)
    return (
      <p>
        Касу сьогодні закрито о {timeOf(last.closed_at)} ·{" "}
        {visible(last.closed_by)}.
      </p>
    );
  if (!drawer.may_close)
    return last ? (
      <p>
        Останнє закриття: {whenOf(last.closed_at)} · {visible(last.closed_by)}
      </p>
    ) : (
      <></>
    );
  return (
    <>
      <p>
        {drawer.next_is_opening || !last
          ? "Каса ще не рахувалась — цей підрахунок запише, скільки в ній зараз"
          : `Останнє закриття: ${whenOf(last.closed_at)} · ${visible(last.closed_by)}`}
      </p>
      <p className="hint">
        Перед підрахунком запишіть гроші, взяті з каси чи внесені в неї.
      </p>
      {moves}
      <p className="hint">Поки рахуєте, не продавайте.</p>
      {/* Shown always: another phone may have seen the server down (owner
          decision, 2026-10-04; ADR-0013 §9, G7). */}
      <p className="hint">
        Якщо сервер не відповідав — спершу внесіть усе, що записали на папері,
        потім рахуйте касу.
      </p>
      <p className="hint">
        Якщо на іншому телефоні операція чекає перевірки, спершу перевірте її:
        інакше вона потрапить у наступне закриття.
      </p>
      <CloseForm disabled={disabled} close={close} />
    </>
  );
}

/**
 * The blind count: what is in the drawer, typed, then confirmed. Three taps
 * from anywhere — «Каса», «Закрити касу», «Так, закрити» — and the sum.
 */
function CloseForm({
  disabled,
  close,
}: {
  disabled: boolean;
  close: (counted: string) => Promise<boolean>;
}): JSX.Element {
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  return (
    <fieldset disabled={disabled}>
      <label>
        Скільки готівки в касі зараз, грн
        <input
          inputMode="decimal"
          placeholder="0,00"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setAsking(null);
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      {asking === null ? (
        <button
          type="button"
          onClick={() => {
            const cents = kopecks(typed);
            if (cents === null) {
              setProblem("Вкажіть суму з точністю до копійок.");
              return;
            }
            setProblem("");
            setAsking(decimal(cents));
          }}
        >
          Закрити касу
        </button>
      ) : (
        <div className="notice">
          <p>Закрити касу: у касі {money(asking)}? Змінити потім не можна.</p>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void close(asking).then((settled) => {
                  if (settled) {
                    setAsking(null);
                    setTyped("");
                  }
                });
              }}
            >
              Так, закрити
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setAsking(null);
              }}
            >
              Ні
            </button>
          </div>
        </div>
      )}
    </fieldset>
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

/** Why the count differs, written only by whoever counted (G12). */
function ReasonForm({
  disabled,
  send,
}: {
  disabled: boolean;
  send: (reason: string) => Promise<void>;
}): JSX.Element {
  const [reason, setReason] = useState("");
  const hint = useId();
  return (
    <fieldset disabled={disabled}>
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
      <div className="actions">
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
      <button
        type="button"
        disabled={reason.trim() === ""}
        onClick={() => {
          void send(reason.trim());
        }}
      >
        Записати причину
      </button>
    </fieldset>
  );
}

/**
 * Cash taken out, or put in for change (B5). Recorded when it moves: the
 * newest close the form read is sent with it, so a record that reaches the
 * server after a colleague's close is put on that close, where the cash
 * left. Whoever holds `cash:correct` may name an earlier close for cash
 * moved and forgotten: it explains that close and changes no expected sum
 * now (G7).
 */
function MoveStep({
  store,
  drawer,
  direction,
  closes,
  disabled,
  send,
  back,
}: {
  store: Store;
  drawer: Drawer;
  direction: "OUT" | "IN";
  closes: CloseBrief[];
  disabled: boolean;
  send: (body: CashBody) => Promise<JournalOutcome<CashAnswer>>;
  back: (done: string | null) => void;
}): JSX.Element {
  const hint = useId();
  const kinds = drawer.movement_kinds.filter(
    (kind) => directionOf(kind) === direction,
  );
  const [kind, setKind] = useState<MovementKind | null>(
    kinds.length === 1 ? (kinds[0] ?? null) : null,
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Empty: the open period, after the last close.
  const [forClose, setForClose] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function record(): Promise<void> {
    const cents = kopecks(amount);
    if (kind === null) {
      setProblem("Оберіть, кому чи на що видаєте.");
      return;
    }
    if (cents === null || cents <= 0n) {
      setProblem("Вкажіть суму з точністю до копійок.");
      return;
    }
    setProblem(null);
    const outcome = await send({
      command: "movement",
      store_id: store.id,
      command_id: crypto.randomUUID(),
      movement_kind: kind,
      amount: decimal(cents),
      note: note.trim() === "" ? null : note.trim(),
      after_close_id: drawer.last_close?.id ?? null,
      ...(forClose === "" ? {} : { for_close_id: forClose }),
    });
    if (outcome.kind === "done") back(movementDone(outcome.result as Movement));
    else if (outcome.kind === "refused")
      setProblem(cashErrorText(outcome.error));
  }

  return (
    <section>
      <div className="toolbar">
        <h2>{direction === "OUT" ? "Видати з каси" : "Внести в касу"}</h2>
        <button
          className="quiet"
          onClick={() => {
            back(null);
          }}
        >
          До каси
        </button>
      </div>
      <fieldset disabled={disabled}>
        {direction === "OUT" && (
          <fieldset>
            <legend>Кому чи на що</legend>
            {kinds.map((each) => (
              <label className="check" key={each}>
                <input
                  type="radio"
                  name="movement-kind"
                  checked={kind === each}
                  onChange={() => {
                    setKind(each);
                    setProblem(null);
                  }}
                />
                {movementLabels[each]}
              </label>
            ))}
          </fieldset>
        )}
        {kind === "SUPPLIER_COURIER" && (
          // The invoice and its payment stay in «Накладні», which a seller
          // does not see (G20).
          <p className="hint">
            {store.permissions.includes("supplier:debt")
              ? "Оплату накладної запишіть у «Накладних»."
              : "Накладну й оплату за нею запише менеджер."}
          </p>
        )}
        <label>
          Сума, грн
          <input
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </label>
        <label>
          {direction === "OUT"
            ? "На що (необов’язково)"
            : "Примітка (необов’язково)"}
          <input
            value={note}
            maxLength={200}
            aria-describedby={hint}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <NoCustomerData id={hint} />
        </label>
        {drawer.may_correct && closes.length > 0 && (
          <label>
            Коли?
            <select
              value={forClose}
              onChange={(event) => {
                setForClose(event.target.value);
              }}
            >
              <option value="">Після останнього закриття</option>
              {closes.map((each) => (
                <option key={each.id} value={each.id}>
                  До закриття {dayOf(each.business_day)}
                </option>
              ))}
            </select>
          </label>
        )}
        {problem && <p role="alert">{problem}</p>}
        <button
          type="button"
          onClick={() => {
            void record();
          }}
        >
          Записати
        </button>
      </fieldset>
    </section>
  );
}

/** Where one operation's sum and way are read. A sale is the server's
 * `GET /cash/sales/{id}/method`; a payment and a return the same, by kind. */
function methodPath(chosen: FixTarget, storeId: string): string {
  const kind = { SALE: "sales", PAYMENT: "payments", REFUND: "refunds" }[
    chosen.target
  ];
  return `/cash/${kind}/${chosen.id}/method?store_id=${storeId}`;
}

/**
 * A seller's own operations of the open period, by time and goods only
 * (G16, G32), and the way of the one they choose. The receipt's «Змінити
 * спосіб оплати» opens its sale straight away.
 */
function FixStep({
  store,
  token,
  initial,
  manager,
  disabled,
  send,
  back,
}: {
  store: Store;
  token: string;
  initial: FixTarget | null;
  /** The owner or a manager, from a receipt: any sale, any time. */
  manager: boolean;
  disabled: boolean;
  send: (body: CashBody) => Promise<JournalOutcome<CashAnswer>>;
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
    <button
      className="quiet"
      onClick={() => {
        back(null);
      }}
    >
      До каси
    </button>
  );
  const answer = method.data;
  if (chosen)
    return (
      <section>
        <div className="toolbar">
          <h2>Змінити спосіб оплати</h2>
          {leave}
        </div>
        {method.error ? (
          <p role="alert">{cashErrorText(method.error)}</p>
        ) : answer === undefined ? (
          <p role="status">Завантажуємо операцію…</p>
        ) : answer.may_change ? (
          <WayChoice
            title={targetLabels[answer.target]}
            amount={answer.amount_taken}
            current={answer.method}
            corrected={answer.corrected}
            ways={waysFor(answer.is_order)}
            closedNote={null}
            confirm={manager ? "Так, виправити" : "Так, змінити"}
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
              if (outcome.kind === "done")
                back(correctionDone(outcome.result as Correction));
              else if (outcome.kind === "refused") {
                void method.refetch();
                return cashErrorText(outcome.error);
              }
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
    <section>
      <div className="toolbar">
        <h2>Змінити спосіб оплати</h2>
        {leave}
      </div>
      <p className="hint">
        Ваші продажі, внески й повернення після останнього закриття. Спосіб
        оплати змінюють, доки касу не закрито.
      </p>
      {mine.isPending ? (
        <p role="status">Завантажуємо…</p>
      ) : mine.error ? (
        <p role="alert">{errorText(mine.error)}</p>
      ) : mine.data.items.length === 0 ? (
        <p>Після останнього закриття ви ще нічого не провели.</p>
      ) : (
        <ul aria-label="Ваші операції">
          {mine.data.items.map((event: MineEvent) => (
            <li key={event.target_id}>
              <button
                className="quiet"
                onClick={() => {
                  setChosen({
                    target: event.target,
                    id: event.target_id,
                  });
                }}
              >
                {timeOf(event.at)} · {targetLabels[event.target]}:{" "}
                {visible(event.label)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The owner's and managers' correction (B6): a day, its money events with
 * their sums and ways, one of them, a new way. A closed day's event explains
 * that close's difference and changes no expected sum now (G7).
 */
function CorrectStep({
  store,
  token,
  closes,
  disabled,
  send,
  back,
}: {
  store: Store;
  token: string;
  closes: Close[];
  disabled: boolean;
  send: (body: CashBody) => Promise<JournalOutcome<CashAnswer>>;
  back: (done: string | null) => void;
}): JSX.Element {
  const [day, setDay] = useState(() => isoDay(new Date()));
  const [chosen, setChosen] = useState<DayEvent | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const events = useQuery({
    queryKey: ["cash-events", store.id, day],
    queryFn: () =>
      api<EventPage>(`/cash/events?store_id=${store.id}&day=${day}`, token),
    enabled: valid,
    retry: false,
  });
  // The close an event's period ended with: the first one after it.
  function closedBy(event: DayEvent): string | null {
    const after = closes
      .filter((each) => Date.parse(each.closed_at) > Date.parse(event.at))
      .sort((a, b) => Date.parse(a.closed_at) - Date.parse(b.closed_at))[0];
    return after ? after.business_day : null;
  }
  return (
    <section>
      <div className="toolbar">
        <h2>Виправити спосіб оплати</h2>
        <button
          className="quiet"
          onClick={() => {
            back(null);
          }}
        >
          До каси
        </button>
      </div>
      {chosen ? (
        <>
          <p>
            {timeOf(chosen.at)} · {visible(chosen.label)} · {visible(chosen.by)}
          </p>
          <WayChoice
            title={targetLabels[chosen.target]}
            amount={chosen.amount}
            current={chosen.method}
            corrected={chosen.corrected}
            ways={waysFor(chosen.is_order)}
            closedNote={
              chosen.closed
                ? (() => {
                    const closedDay = closedBy(chosen);
                    return closedDay
                      ? `Пояснить різницю закриття ${dayOf(closedDay)}`
                      : "Пояснить різницю закриття, у яке потрапила";
                  })()
                : null
            }
            confirm="Так, виправити"
            disabled={disabled}
            send={async (to, note) => {
              const outcome = await send({
                command: "correction",
                store_id: store.id,
                command_id: crypto.randomUUID(),
                target: chosen.target,
                target_id: chosen.target_id,
                from_method: chosen.method,
                to_method: to,
                note,
              });
              if (outcome.kind === "done")
                back(correctionDone(outcome.result as Correction));
              else if (outcome.kind === "refused") {
                setChosen(null);
                void events.refetch();
                return cashErrorText(outcome.error);
              }
              return null;
            }}
          />
          <button
            className="quiet"
            onClick={() => {
              setChosen(null);
            }}
          >
            Інша операція
          </button>
        </>
      ) : (
        <>
          <label>
            День
            <input
              type="date"
              value={day}
              max={isoDay(new Date())}
              onChange={(event) => {
                setDay(event.target.value);
              }}
            />
          </label>
          {!valid ? (
            <p>Оберіть день.</p>
          ) : events.isPending ? (
            <p role="status">Завантажуємо операції…</p>
          ) : events.error ? (
            <p role="alert">{errorText(events.error)}</p>
          ) : events.data.items.length === 0 ? (
            <p>Цього дня грошових операцій не було.</p>
          ) : (
            <ul aria-label="Операції дня">
              {events.data.items.map((event) => (
                <li key={`${event.target}:${event.target_id}`}>
                  <button
                    className="quiet"
                    disabled={!event.may_change}
                    onClick={() => {
                      setChosen(event);
                    }}
                  >
                    {timeOf(event.at)} · {targetLabels[event.target]}:{" "}
                    {visible(event.label)} · {money(event.amount)} ·{" "}
                    {wayName(event.method)}
                    {event.corrected ? " (виправлено)" : ""} ·{" "}
                    {visible(event.by)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** One operation's sum and way, and the other ways to choose from. */
function WayChoice({
  title,
  amount,
  current,
  corrected,
  ways,
  closedNote,
  confirm,
  disabled,
  send,
}: {
  title: string;
  amount: string;
  current: PaymentMethod | null;
  corrected: boolean;
  ways: readonly PaymentMethod[];
  closedNote: string | null;
  confirm: string;
  disabled: boolean;
  /** The refusal's text, or null. */
  send: (to: PaymentMethod, note: string | null) => Promise<string | null>;
}): JSX.Element {
  const [to, setTo] = useState<PaymentMethod | null>(null);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const hint = useId();
  return (
    <fieldset disabled={disabled}>
      <p>
        {title}: <strong>{money(amount)}</strong> · зараз {wayName(current)}
        {corrected ? " (виправлено)" : ""}
      </p>
      {closedNote && <p className="notice">{closedNote}</p>}
      <fieldset>
        <legend>Новий спосіб оплати</legend>
        {ways
          .filter((way) => way !== current)
          .map((way) => (
            <label className="check" key={way}>
              <input
                type="radio"
                name="new-way"
                checked={to === way}
                onChange={() => {
                  setTo(way);
                  setProblem(null);
                }}
              />
              {methodLabels[way]}
            </label>
          ))}
      </fieldset>
      <label>
        Пояснення (необов’язково)
        <input
          value={note}
          maxLength={200}
          aria-describedby={hint}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <NoCustomerData id={hint} />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <button
        type="button"
        disabled={to === null}
        onClick={() => {
          if (to === null) return;
          void send(to, note.trim() === "" ? null : note.trim()).then(
            setProblem,
          );
        }}
      >
        {confirm}
      </button>
    </fieldset>
  );
}

/** Closes per page of the history: the server gives at most 100 at once
 * (`GET /cash/closes`), so the history pages by offset, never by a larger
 * limit. */
const pageSize = 20;

/**
 * The closes, newest first, for the owner and managers (owner decision:
 * the split and the closes are theirs, as the sales report is): what was
 * counted and expected, the difference and its reason, what explains it,
 * the slip's sums, and each day nobody closed.
 */
function History({
  store,
  token,
  back,
}: {
  store: Store;
  token: string;
  back: () => void;
}): JSX.Element {
  // One year, fixed while the screen is open: every page is of the same list.
  const [period] = useState(() => ({
    from: daysAgo(365),
    to: isoDay(new Date()),
  }));
  const closes = useInfiniteQuery({
    queryKey: ["cash-closes", store.id, "history", period.from, period.to],
    queryFn: ({ pageParam }) =>
      api<ClosePage>(
        `/cash/closes?store_id=${store.id}&date_from=${period.from}&date_to=${period.to}&limit=${String(pageSize)}&offset=${String(pageParam)}`,
        token,
      ),
    initialPageParam: 0,
    // The next page starts after the closes read; the server says whether
    // there is one.
    getNextPageParam: (last: ClosePage, pages: ClosePage[]) =>
      last.has_more ? pages.length * pageSize : undefined,
    retry: false,
  });
  // A close made between two pages moves the older ones down by one: each
  // close is shown once.
  const items = [
    ...new Map(
      (closes.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((close) => [close.id, close]),
    ).values(),
  ];
  return (
    <section>
      <div className="toolbar">
        <h2>Закриття</h2>
        <button className="quiet" onClick={back}>
          До каси
        </button>
      </div>
      {closes.isPending ? (
        <p role="status">Завантажуємо закриття…</p>
      ) : closes.data === undefined ? (
        <p role="alert">{errorText(closes.error)}</p>
      ) : items.length === 0 ? (
        <p>Касу цього магазину ще не закривали.</p>
      ) : (
        <>
          <ul className="nights" aria-label="Закриття каси">
            {items.map((close) => (
              <HistoryRow key={close.id} close={close} />
            ))}
          </ul>
          {/* A page that failed keeps the closes already read. */}
          {closes.error && <p role="alert">{errorText(closes.error)}</p>}
          {closes.hasNextPage && (
            <button
              className="quiet"
              disabled={closes.isFetching}
              onClick={() => {
                void closes.fetchNextPage();
              }}
            >
              Показати ще
            </button>
          )}
        </>
      )}
    </section>
  );
}

function HistoryRow({ close }: { close: Close }): JSX.Element {
  return (
    <>
      <li aria-label={`Закриття ${dayOf(close.business_day)}`}>
        <strong>
          {dayOf(close.business_day)} · {visible(close.closed_by)}
        </strong>{" "}
        <small>о {timeOf(close.closed_at)}</small>
        <p>
          {close.opening || close.expected === null || close.difference === null
            ? `Перший підрахунок: ${money(close.counted)}.`
            : `Порахували ${money(close.counted)}, мало бути ${money(close.expected)}. ${differenceText(close.difference)}`}
        </p>
        <CloseDetails close={close} />
      </li>
      {/* Newest first: the days nobody closed came before this close. */}
      {[...close.unclosed_days].reverse().map((day) => (
        <li key={`${close.id}:${day}`}>{dayOf(day)} — не закрито</li>
      ))}
    </>
  );
}
