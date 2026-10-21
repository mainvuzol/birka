import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, errorText, unreachable } from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import type { JournalOutcome } from "@/shared/journal";
import { useAutoCheck } from "@/shared/reach";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { notStated, methodLabels } from "@/shared/payment";
import type { PaymentMethod } from "@/shared/payment";
import { buzz } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { Closed, CloseSummary, PeriodDetails, ReasonLine } from "./Closed";
import { Count } from "./Count";
import { Kept } from "./Kept";
import { cardText, differenceText, signed, whenOf } from "./format";
import {
  resolveCashCommand,
  submitCashCommand,
  useCashCommand,
  useCashLastCommand,
} from "./commands";
import {
  cashErrorText,
  cashJournalText,
  dayOf,
  staleToday,
  timeOf,
} from "./errors";
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
  // The count (cash task list, P0-2), and the close's result (P0-3).
  | { name: "count" }
  | { name: "closed" }
  // From the count, cash taken out is recorded and the count comes back.
  | { name: "move"; direction: "OUT" | "IN"; then?: "count" }
  | { name: "fix"; chosen: FixTarget | null }
  | { name: "correct" }
  | { name: "history" };

const targetLabels: Record<Target, string> = {
  SALE: "Продаж",
  PAYMENT: "Внесок",
  REFUND: "Повернення",
};

function wayName(method: PaymentMethod | null): string {
  return method ? methodLabels[method] : notStated;
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

/** What the history shows under a close's count: the slip's sums, the
 * reason, and for the owner and managers the cash itself. */
function CloseDetails({ close }: { close: Close }): JSX.Element {
  return (
    <>
      <p>{cardText(close.card)}</p>
      <p>Переказ: {signed(close.transfer.net)}.</p>
      <ReasonLine close={close} />
      <PeriodDetails close={close} />
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
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, error, misses } = useCashCommand();
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
  // What the count's field holds: kept while cash taken out is recorded from
  // it, and given back (cash task list, P0-2).
  const [counting, setCounting] = useState("");
  // Which command the journal's error is about, to say what was not
  // recorded: beside the journal, since the error outlives this screen.
  const lastCommand = useCashLastCommand((state) => state.command);
  const cardHint = useId();
  // The card's read is in flight: the count opens on its answer.
  const [reading, setReading] = useState(false);
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
    useCashLastCommand.setState({ command: body.command, sending: true });
    try {
      return await submitCashCommand(journalKey, token, {
        // A new transport key per attempt; the command's identity is
        // `command_id`, which is what makes a late retry safe.
        key: crypto.randomUUID(),
        body,
      });
    } finally {
      useCashLastCommand.setState({ sending: false });
      changed();
    }
  }

  /** What an answer means, however late it came; `once`, a kept command
   * confirmed: «… записано один раз» (cash task list, P1-1), `since` when
   * it was first sent. */
  function recorded(
    body: CashBody,
    answer: CashAnswer,
    once = false,
    since?: string,
  ): void {
    switch (body.command) {
      case "close":
        setResult(answer as Close);
        if (once) setDone("Підрахунок записано один раз.");
        return;
      case "reason":
        setResult(answer as Close);
        setDone(
          reasonDone(answer as Close, networkOwner, once ? { since } : null),
        );
        return;
      case "movement":
        setDone(movementDone(answer as Movement, once));
        return;
      case "correction":
        setDone(correctionDone(answer as Correction, once));
        return;
    }
  }

  // The close a reason is owed for: the drawer's, or the close just recorded
  // until the drawer is read again. Never one whose reason this screen has
  // just written: its answer still says `reason_required` (that is the
  // difference's, not what remains to do), and the form would stay, saying
  // the other tabs wait while the App has opened them (G12).
  const owedByDrawer = drawer.data?.reason_owed?.id ?? null;
  const owedId =
    // Nor one whose reason was just written, while the drawer is read again
    // (review, 2026-10-21).
    owedByDrawer !== null &&
    !(result?.id === owedByDrawer && result.reason !== null)
      ? owedByDrawer
      : result?.reason_required && result.reason === null
        ? result.id
        : null;
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
  // A reason owed opens its result once, by itself: on a close just
  // answered, and when «Каса» opens on one owed from before (G12).
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (owedId === null || opened.current === owedId) return;
    opened.current = owedId;
    setStep((now) => (now.name === "main" ? { name: "closed" } : now));
  }, [owedId]);
  // The count is left when the drawer can no longer be read — the server
  // out of reach, whose words «Каса» says (G26) — or it says the count is no
  // longer due (review, 2026-10-21).
  useEffect(() => {
    if (step.name !== "count") return;
    if (drawer.error || (drawer.data && !isDue(drawer.data))) {
      setCounting("");
      setStep({ name: "main" });
    }
  }, [step.name, drawer.error, drawer.data]);

  /** The kept command, resent as it is: by its button, or by itself. */
  function check(): void {
    const attempt = pending;
    if (!attempt) return;
    setDone(null);
    setProblem(null);
    useCashLastCommand.setState({ command: attempt.body.command });
    void resolveCashCommand(journalKey, token, attempt).then((outcome) => {
      if (outcome.kind === "done") {
        recorded(attempt.body, outcome.result, true, attempt.since);
        // A close or its reason confirmed: its result, as when answered.
        if (
          attempt.body.command === "close" ||
          attempt.body.command === "reason"
        )
          setStep({ name: "closed" });
      } else if (outcome.kind === "refused")
        // Proven to have recorded nothing: the journal is settled, and the
        // refusal says what to do instead.
        useCashCommand.setState({ error: outcome.error });
      changed();
    });
  }
  // «Каса»'s kept command is checked by itself too (ADR-0013 §4.3, §9).
  useAutoCheck([{ pending: pending !== null, busy, loaded, run: check }]);

  // The drawer is still to be closed today, as its last read says; never
  // while it cannot be read (G26; review, 2026-10-22).
  const closeNow =
    !drawer.error && drawer.data !== undefined && isDue(drawer.data);
  // A kept count that came too late, the same evening, the drawer still to
  // close: the count again, at once, once the drawer is read anew (owner
  // decision, 2026-10-21, В3). Never while it is read, nor when it cannot
  // be (G26); from «Каса»'s own screen only, and once for that refusal,
  // however often «Каса» is opened again (review, 2026-10-22).
  const recounted = useCashLastCommand((state) => state.recounted);
  useEffect(() => {
    if (error === null || recounted === error || !staleToday(error)) return;
    if (drawer.isFetching || !closeNow || step.name !== "main") return;
    useCashLastCommand.setState({ recounted: error });
    setStep({ name: "count" });
  }, [error, recounted, drawer.isFetching, closeNow, step.name]);
  // A command on its first sending is not yet unknown: no banner saying the
  // server did not answer (review, 2026-10-22).
  const sending = useCashLastCommand((state) => state.sending);

  // The kept command's banner and words, on every screen of «Каса».
  const kept = (
    <>
      {pending && !sending && (
        <Kept
          body={pending.body}
          since={pending.since}
          busy={busy}
          check={check}
        />
      )}
      {error !== null && (
        <p role="alert">
          {cashJournalText(
            error,
            lastCommand,
            misses,
            pending?.body.command === "movement"
              ? directionOf(pending.body.movement_kind)
              : undefined,
            closeNow,
          )}
        </p>
      )}
    </>
  );

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
          setStep(step.then === "count" ? { name: "count" } : { name: "main" });
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

  /** The count, sent: its result, a refusal over the panel, or the banner. */
  async function closeWith(
    counted: string,
  ): Promise<"done" | "refused" | "unknown"> {
    if (!data) return "unknown";
    const body: CashBody = {
      command: "close",
      store_id: store.id,
      command_id: crypto.randomUUID(),
      counted,
      // The moment of «Так, закрити»: the count describes the drawer then,
      // and only for ten minutes (G31).
      counted_at: new Date().toISOString(),
      // The newest close read when the count opened (cash task list, P0-1).
      after_close_id: data.last_close?.id ?? null,
    };
    const outcome = await send(body);
    if (outcome.kind === "done") {
      // A buzz in the hand once the server answers, as at the till (P0-3).
      buzz("success");
      recorded(body, outcome.result);
      setCounting("");
      setStep({ name: "closed" });
    } else if (outcome.kind === "refused") {
      buzz("error");
      setProblem(cashErrorText(outcome.error, closeNow));
    } else {
      // Unknown: «Каса» holds it in its banner; a sum typed for a moment
      // gone is never confirmed later with a new one (G31).
      setCounting("");
      setStep({ name: "main" });
    }
    return outcome.kind;
  }

  if (step.name === "count" && data && !drawer.error && isDue(data))
    return (
      <Count
        typed={counting}
        setTyped={setCounting}
        kept={kept}
        done={done}
        problem={problem}
        disabled={working}
        reading={drawer.isFetching}
        takeOut={
          data.movement_kinds.some((kind) => directionOf(kind) === "OUT")
            ? () => {
                setDone(null);
                setProblem(null);
                // The newest close is read again: what the movement names
                // as the one it came after.
                void drawer.refetch();
                setStep({ name: "move", direction: "OUT", then: "count" });
              }
            : null
        }
        close={closeWith}
        back={() => {
          setProblem(null);
          setDone(null);
          // Kept only on the way to cash taken out and back.
          setCounting("");
          setStep({ name: "main" });
        }}
      />
    );
  // A close just answered, or one whose reason is owed: its result (cash
  // task list, P0-3). A reason owed holds the other tabs, never «Каса»'s
  // own tasks (G12).
  if (step.name === "closed" && (close !== null || owedId !== null))
    return (
      <Closed
        close={close && (owedId === null || close.id === owedId) ? close : null}
        owedId={owedId}
        storeId={store.id}
        failed={shown.error}
        kept={kept}
        done={done}
        problem={problem}
        disabled={working}
        sendReason={async (reason) => {
          if (owedId === null) return;
          const body: CashBody = {
            command: "reason",
            store_id: store.id,
            command_id: crypto.randomUUID(),
            close_id: owedId,
            reason,
          };
          const outcome = await send(body);
          if (outcome.kind === "done") {
            recorded(body, outcome.result);
            setStep({ name: "closed" });
          } else if (outcome.kind === "refused")
            setProblem(cashErrorText(outcome.error));
        }}
        retry={() => {
          void shown.refetch();
        }}
        leave={() => {
          setDone(null);
          setProblem(null);
          setStep({ name: "main" });
        }}
        finish={() => {
          setDone(null);
          setProblem(null);
          setStep({ name: "main" });
        }}
      />
    );

  const kinds = data?.movement_kinds ?? [];
  const takesOut = kinds.some((kind) => directionOf(kind) === "OUT");
  const putsIn = kinds.some((kind) => directionOf(kind) === "IN");
  const due = data !== undefined && isDue(data);
  const opening =
    data !== undefined && (data.next_is_opening || data.last_close === null);
  return (
    <section className="cash">
      <h2>Каса</h2>
      {data && <p className="cash-context">{contextOf(data)}</p>}
      {kept}
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
            Спробувати ще раз
          </button>
        </div>
      ) : data === undefined ? null : (
        <>
          {due ? (
            // The day's one task, large (cash task list, P0-1): what the
            // drawer should hold is said only after the count (G32).
            <button
              type="button"
              className="cash-card"
              aria-label={opening ? "Перший підрахунок" : "Закрити касу"}
              aria-describedby={cardHint}
              disabled={working || reading}
              onClick={() => {
                setDone(null);
                setProblem(null);
                setReading(true);
                // Read again: the newest close is the one the count names.
                // Opened on that read alone, while the count is still due:
                // never while the server does not answer (G26).
                void drawer.refetch().then((read) => {
                  setReading(false);
                  if (read.isSuccess && isDue(read.data))
                    setStep({ name: "count" });
                });
              }}
            >
              <span className="cash-card-title" aria-hidden="true">
                {opening ? "Перший підрахунок" : "Закрити касу"}
              </span>
              <span className="cash-card-hint" id={cardHint}>
                {opening
                  ? "Запишемо, скільки в касі зараз"
                  : "Скільки мало бути — покажемо після підрахунку"}
              </span>
            </button>
          ) : (
            owedId === null &&
            data.closed_today &&
            data.last_close?.mine &&
            close &&
            close.id === data.last_close.id && <CloseSummary close={close} />
          )}
          {owedId !== null && (
            // A reason owed, from «Каса»'s main screen: its close, and the
            // way back to it (G12).
            <div className="cash-owed">
              {close && close.id === owedId && <CloseSummary close={close} />}
              <p className="hint">
                Поки причину не записано, інші розділи недоступні.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDone(null);
                  setProblem(null);
                  setStep({ name: "closed" });
                }}
              >
                Записати причину
              </button>
            </div>
          )}
          <div className="cash-rows">
            {takesOut && (
              <Row
                title="Видати з каси"
                hint={
                  kinds.includes("OWNER")
                    ? "Власнику, на витрати, кур’єру"
                    : "Витрати, кур’єру постачальника"
                }
                disabled={working}
                open={() => {
                  setDone(null);
                  void drawer.refetch();
                  setStep({ name: "move", direction: "OUT" });
                }}
              />
            )}
            {putsIn && (
              <Row
                title="Внести в касу"
                hint="Розмін"
                disabled={working}
                open={() => {
                  setDone(null);
                  void drawer.refetch();
                  setStep({ name: "move", direction: "IN" });
                }}
              />
            )}
            {data.may_correct ? (
              <Row
                title="Змінити спосіб оплати"
                hint="Будь-яка операція, будь-який день"
                disabled={working}
                open={() => {
                  setDone(null);
                  setStep({ name: "correct" });
                }}
              />
            ) : (
              store.permissions.includes("sale:create") && (
                <Row
                  title="Змінити спосіб оплати"
                  hint="Ваші операції до закриття"
                  disabled={working}
                  open={() => {
                    setDone(null);
                    setStep({ name: "fix", chosen: null });
                  }}
                />
              )
            )}
            {financial && (
              <Row
                title="Закриття"
                hint="Усі закриття й різниці"
                open={() => {
                  setDone(null);
                  setStep({ name: "history" });
                }}
              />
            )}
          </div>
          {data.movements.length > 0 && (
            <>
              <h3 className="cash-subhead">Видано й внесено після закриття</h3>
              <ul className="history" aria-label="Видано й внесено">
                {data.movements.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** The count is due: whoever may close, and not yet today. */
function isDue(drawer: Drawer): boolean {
  return (
    drawer.may_close && !(drawer.closed_today && drawer.last_close !== null)
  );
}

/**
 * Where the drawer stands, in one line under «Каса» (cash task list, P0-1):
 * open since the last close, never counted, or closed today; in a store
 * that does not trade, only when it was last closed.
 */
function contextOf(drawer: Drawer): string {
  const last = drawer.last_close;
  if (drawer.closed_today && last)
    return `Сьогодні закрито о ${timeOf(last.closed_at)} · ${visible(last.closed_by)}`;
  if (drawer.next_is_opening || !last) return "Каса ще не рахувалась";
  const when = `${whenOf(last.closed_at)} · ${visible(last.closed_by)}`;
  return drawer.store_state === "ACTIVE"
    ? `Каса відкрита · останнє закриття ${when}`
    : `Останнє закриття ${when}`;
}

/** One of «Каса»'s tasks, a row with what it is for (cash task list, P0-1). */
function Row({
  title,
  hint,
  disabled = false,
  open,
}: {
  title: string;
  hint: string;
  disabled?: boolean;
  open: () => void;
}): JSX.Element {
  const said = useId();
  return (
    <button
      type="button"
      className="sale-row cash-row"
      aria-label={title}
      aria-describedby={said}
      disabled={disabled}
      onClick={open}
    >
      <span className="sale-main">
        <span className="cash-row-title">{title}</span>
        <span className="sale-meta" id={said}>
          {hint}
        </span>
      </span>
      <span className="sale-open" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/** Cash taken out or put in since the close: what for, when and who, and the
 * sum on the right, out as «−», in as «+» (cash task list, P0-1). */
function MovementRow({ movement }: { movement: Movement }): JSX.Element {
  const today =
    new Date(movement.at).toDateString() === new Date().toDateString();
  return (
    <li className="history-row">
      <span className="history-main">
        <span className="history-what">
          {[
            movement.kind === "CHANGE"
              ? "Внесено · розмін"
              : movementLabels[movement.kind],
            movement.note === null ? null : visible(movement.note),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="history-meta">
          {[
            today ? timeOf(movement.at) : whenOf(movement.at),
            visible(movement.by),
            movement.for_day ? `до закриття ${dayOf(movement.for_day)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="history-sum">
        {movement.direction === "OUT" ? "−" : "+"}
        {money(movement.amount)}
      </span>
    </li>
  );
}

/**
 * Within the bot's 15 minutes the reason goes with the message; later the
 * owner already has it without, and reads the reason in the app (G11). The
 * phone's own clock tells which, against the close's moment. The network's
 * owner who closed gets no message at all (G40).
 */
function reasonDone(
  close: Close,
  networkOwner: boolean,
  /** A kept reason confirmed, and when it was first sent, if known. */
  kept: { since: string | undefined } | null = null,
): string {
  const written = kept ? "Причину записано один раз." : "Причину записано.";
  if (networkOwner) return written;
  const closedAt = Date.parse(close.closed_at);
  const window = 15 * 60 * 1000;
  if (Date.now() - closedAt <= window)
    return `${written} Власник отримає повідомлення.`;
  // A kept reason was recorded when it first reached the server, sometime
  // after it was first sent: past the bot's wait only if sent past it
  // (review, 2026-10-22).
  const since = kept?.since === undefined ? NaN : Date.parse(kept.since);
  if (kept && !(since - closedAt > window))
    return `${written} Власник побачить її в застосунку.`;
  return `${written} Власник уже отримав повідомлення без причини — побачить її в застосунку.`;
}

/** Cash moved, as recorded; `once`, a kept one confirmed: «Видачу записано
 * один раз: Витрати, 150,00 грн.» (cash task list, P1-1). */
function movementDone(movement: Movement, once = false): string {
  if (once) {
    const what =
      movement.direction === "OUT"
        ? `Видачу записано один раз: ${movementLabels[movement.kind]}, ${money(movement.amount)}`
        : `Внесення записано один раз: ${money(movement.amount)}`;
    if (!movement.for_day) return `${what}.`;
    return `${what} — до закриття ${dayOf(movement.for_day)}${
      movement.moved_to_close ? `, ${movedBefore(movement)}` : ""
    }.`;
  }
  if (movement.moved_to_close && movement.for_day)
    return `Записано до закриття ${dayOf(movement.for_day)}: ${movedBefore(movement)}.`;
  if (movement.for_day)
    return `Записано до закриття ${dayOf(movement.for_day)}.`;
  return `Записано: ${movementLabels[movement.kind]}, ${money(movement.amount)}.`;
}

/** Why cash the server put on a colleague's close went there: it moved
 * before that close — taken out, or put in (review, 2026-10-22). */
function movedBefore(movement: Movement): string {
  return movement.direction === "IN"
    ? "гроші внесли до нього"
    : "гроші взяли до нього";
}

/** A way changed, as recorded; `once`, a kept one confirmed (P1-1). */
function correctionDone(correction: Correction, once = false): string {
  const ways = `${wayName(correction.from_method)} → ${wayName(correction.to_method)}`;
  return `${once ? `Зміну способу оплати записано один раз: ${ways}` : `Спосіб оплати змінено: ${ways}`}.${
    correction.explains_day
      ? ` Пояснює різницю закриття ${dayOf(correction.explains_day)}.`
      : ""
  }`;
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
        <h2>Змінити спосіб оплати</h2>
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
