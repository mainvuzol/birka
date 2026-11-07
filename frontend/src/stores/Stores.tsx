import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { keptUnconfirmed } from "@/cash/errors";
import {
  ApiError,
  SlowAnswer,
  api,
  errorText,
  inOwnWords,
  unreachable,
} from "@/shared/api";
import { Back } from "@/shared/Back";
import { Eyelet } from "@/shared/Eyelet";
import { Kept, Settled } from "@/shared/Kept";
import { waitsText } from "@/shared/reach";
import { SendingLine } from "@/shared/Sending";
import { Sheet } from "@/shared/Sheet";
import { buzz } from "@/shared/telegram";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";
import { shortDay, shortTime } from "@/credits/format";
import type { StoreState } from "@/orders/types";
import {
  resolveStateCommand,
  submitStateCommand,
  useStateCommand,
} from "./commands";
import { stateLabels } from "./types";
import type { Leftover, StoreRecord } from "./types";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { ScreenHeader } from "@/shared/ScreenHeader";

/** What the section says once a change is answered: its stub, or why not. */
type Said =
  | { kind: "recorded"; text: string; at: string | null; reason: string }
  | { kind: "refused"; text: string };

/**
 * The network's stores and their states (owner decisions, 2026-10-01).
 *
 * The owner of the network blocks a store for a while, archives one that
 * stopped trading, and opens either again, saying why each time. A store
 * that does not trade does nothing: the owner and the network's managers read
 * it, and its own people see only that it is blocked or archived, and since
 * when — never why. Only an empty store is archived.
 *
 * A store's tag each, as at the door, its state on a sticker, and nothing to
 * press but the tag: its own screen holds its history and the buttons that
 * change it (stage 2, admin task list, P0-3; В-А3 (а)). A change asks in a
 * sheet and is answered as a stub; one whose answer was lost is the
 * section's stub, here and on a store's screen (P0-4).
 */
export function Stores({
  storeId,
  token,
  journalKey,
  blocked,
  changed,
  back,
}: {
  /** The store the owner is working in, which the journal is kept under. */
  storeId: string;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** A state changed: what the app knows of its stores is read again. */
  changed: () => void;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, error, firstSend } = useStateCommand();
  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => api<StoreRecord[]>("/stores", token),
    retry: false,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  // Sent for the first time, the press's own sheet says so; kept once its
  // answer is lost («Усе на бірці» task list, P0-2).
  const kept = busy && firstSend ? null : pending;
  const held = blocked || busy || pending !== null;
  const open =
    openId === null ? undefined : stores.data?.find((s) => s.id === openId);
  const screen = open ? "store" : "list";

  // Each screen begins at its top, the section too, whatever «Ще» was
  // scrolled to; back on the list, its heading takes the cursor, the tag
  // pressed being gone — never as the section opens.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const title = useRef<HTMLHeadingElement>(null);
  const was = useRef(screen);
  useEffect(() => {
    if (was.current === screen) return;
    was.current = screen;
    window.scrollTo(0, 0);
    if (screen === "list") title.current?.focus();
  }, [screen]);

  // What is said of a change — its stub, a kept one, why — takes the cursor
  // once nothing is over it: the button pressed is gone or held, and a
  // reader would never reach it, over the store's tag (review, 2026-11-07).
  const notice = useRef<HTMLDivElement>(null);
  const [told, setTold] = useState(0);
  const seen = useRef(0);
  const showTold = useCallback((now: number): void => {
    if (seen.current === now) return;
    seen.current = now;
    notice.current?.focus();
  }, []);
  const tell = (): void => {
    setTold((now) => now + 1);
  };
  useEffect(() => {
    if (screen === "list") showTold(told);
  }, [screen, told, showTold]);

  /** The list read again, and the app's stores; never waited for — the
   * sheet closes and the stub is torn at once, its button never pressed
   * twice meanwhile (review, 2026-11-07). */
  function reread(): void {
    void cache.invalidateQueries({ queryKey: ["stores"] }).then(changed);
  }

  function settled(record: StoreRecord, reason: string): void {
    // A buzz in the hand once the server answers (spec §4.4).
    buzz("success");
    setSaid({
      kind: "recorded",
      text: `«${visible(record.name)}»: ${stateLabels[record.state].toLowerCase()}.`,
      // Newest first: the change that put it where it is.
      at:
        record.changes.find((one) => one.to_state === record.state)?.at ?? null,
      reason,
    });
    tell();
    reread();
  }

  async function change(
    target: StoreRecord,
    state: StoreState,
    reason: string,
  ): Promise<ApiError | "kept" | null> {
    setSaid(null);
    const outcome = await submitStateCommand(journalKey, token, {
      // A new transport key per attempt; the change's identity is
      // `command_id`, which is what makes a late retry safe.
      key: crypto.randomUUID(),
      body: {
        store_id: storeId,
        target_id: target.id,
        command_id: crypto.randomUUID(),
        state,
        reason,
      },
    });
    if (outcome.kind === "done") {
      settled(outcome.result, reason);
      return null;
    }
    if (outcome.kind === "refused") {
      // What is left keeps a store from the archive: a warning, the same
      // sheet; any other refusal an error (spec §4.4; P0-4).
      buzz(outcome.error.details.reason === "NOT_EMPTY" ? "warning" : "error");
      void cache.invalidateQueries({ queryKey: ["stores"] });
      return outcome.error;
    }
    // Its answer lost, or its kept one unreadable: the section's stub or
    // alert says so; the journal felt it.
    tell();
    return "kept";
  }

  function check(): void {
    if (pending === null) return;
    const reason = pending.body.reason;
    void resolveStateCommand(journalKey, token, pending).then((outcome) => {
      if (outcome.kind === "done") settled(outcome.result, reason);
      else {
        if (outcome.kind === "refused") {
          buzz("error");
          setSaid({ kind: "refused", text: refusalText(outcome.error) });
          void cache.invalidateQueries({ queryKey: ["stores"] });
        }
        // Answered or not, the button pressed was held: the cursor to what
        // is said now.
        tell();
      }
    });
  }

  // Why it is still not known, as every kept command says it: no answer
  // says nothing more — the stub has; the journal's own words as they are;
  // a check answered with no proof in the shared words, never a manager to
  // ask, its reader the owner (review, 2026-11-07).
  const why =
    error === null || unreachable(error) || error instanceof SlowAnswer
      ? null
      : !(error instanceof ApiError)
        ? error instanceof Error
          ? error.message
          : null
        : kept
          ? (keptUnconfirmed(
              error,
              "Зміну стану",
              "двічі вона не виконається",
            ) ?? errorText(error))
          : null;

  const notices = (
    <div ref={notice} tabIndex={-1} className="stores-notices">
      {kept && (
        <Kept
          own
          title="Незавершена зміна стану"
          busy={busy}
          byItself={false}
          check={{ label: "Перевірити результат", run: check }}
        >
          <p>
            Невідомо, чи змінено стан магазину. Перевірте результат — та сама
            зміна не виконається двічі.
          </p>
          {kept.since && <p>{waitsText(kept.since)}</p>}
          {why !== null && <p>{why}</p>}
        </Kept>
      )}
      {said?.kind === "recorded" && (
        <Settled own>
          <p>{said.text}</p>
          <p className="t-meta">
            {said.at !== null && `${shortTime(said.at)} · `}Причина:{" "}
            {visible(said.reason)}
          </p>
        </Settled>
      )}
      {said?.kind === "refused" && <p role="alert">{said.text}</p>}
      {!kept && why !== null && <p role="alert">{why}</p>}
    </div>
  );

  if (open)
    return (
      <StoreScreen
        key={open.id}
        store={open}
        held={held}
        busy={busy}
        notices={notices}
        told={told}
        showTold={showTold}
        back={() => {
          setSaid(null);
          setOpenId(null);
        }}
        change={(state, reason) => change(open, state, reason)}
      />
    );

  return (
    <>
      <ScreenHeader
        ref={title}
        focusable
        title="Магазини"
        back={back && <BackToMore back={back} />}
        aside={
          <button
            className="quiet"
            disabled={stores.isFetching}
            onClick={() => {
              void stores.refetch();
            }}
          >
            Оновити
          </button>
        }
      />
      <section className="stores">
        {notices}
        {stores.isPending ? (
          <p role="status">Завантажуємо магазини…</p>
        ) : stores.error ? (
          <Unread
            error={stores.error}
            retry={() => {
              void stores.refetch();
            }}
          />
        ) : (
          <div className="door stores-list">
            {stores.data.map((store) => (
              <button
                type="button"
                className="store-tag tag-hero tag-outline"
                key={store.id}
                aria-label={`Магазин ${visible(store.name)}${
                  store.state === "ACTIVE" ? "" : `, ${stickerText(store)}`
                }`}
                onClick={() => {
                  // A choice, felt (spec §4.4).
                  buzz("selection");
                  setSaid(null);
                  setOpenId(store.id);
                }}
              >
                <span className="store-tag-in">
                  <span className="store-tag-name">{visible(store.name)}</span>
                  <span className="t-meta store-tag-code">
                    {visible(store.code)}
                  </span>
                  {store.state !== "ACTIVE" && (
                    <span className="badge store-tag-state">
                      {stickerText(store)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/** «Заблоковано з 12.10», «В архіві з 12.10»: a store's state on its
 * sticker, the year only when it is not this one. */
function stickerText(store: StoreRecord): string {
  return `${stateLabels[store.state]}${
    store.state_since ? ` з ${shortDay(store.state_since)}` : ""
  }`;
}

const actions: Record<StoreState, { to: StoreState; label: string }[]> = {
  ACTIVE: [
    { to: "BLOCKED", label: "Заблокувати" },
    { to: "ARCHIVED", label: "Закрити в архів" },
  ],
  BLOCKED: [
    { to: "ACTIVE", label: "Розблокувати" },
    { to: "ARCHIVED", label: "Закрити в архів" },
  ],
  ARCHIVED: [{ to: "ACTIVE", label: "Відкрити знову" }],
};

const confirmLabels: Record<StoreState, string> = {
  BLOCKED: "Так, заблокувати",
  ARCHIVED: "Так, закрити в архів",
  ACTIVE: "Так, магазин працює",
};

/**
 * One store's screen (stage 2, admin task list, P0-3): its tag large — its
 * name, its code, its state since when and, while it does not trade, why;
 * its history as a thread, newest first, every change recorded; at the
 * bottom the buttons that change it, ordinary ones — rare and drastic, never
 * the screen's main action — «Закрити в архів» the quiet one.
 */
function StoreScreen({
  store,
  held,
  busy,
  notices,
  told,
  showTold,
  back,
  change,
}: {
  store: StoreRecord;
  /** Sending, kept, or another command unsettled: nothing new. */
  held: boolean;
  /** Its change in flight: no way out. */
  busy: boolean;
  notices: JSX.Element;
  /** How many times something was said of a change; `showTold` takes the
   * cursor to it once the sheet is gone. */
  told: number;
  showTold: (now: number) => void;
  /** «← Магазини». */
  back: () => void;
  change: (
    state: StoreState,
    reason: string,
  ) => Promise<ApiError | "kept" | null>;
}): JSX.Element {
  const name = useRef<HTMLHeadingElement>(null);
  const [asking, setAsking] = useState<StoreState | null>(null);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  useEffect(() => {
    name.current?.focus();
  }, []);
  useEffect(() => {
    if (asking === null) showTold(told);
  }, [asking, told, showTold]);
  const latest = store.changes[0];
  return (
    <>
      <ScreenHeader
        back={
          <Back go={back} held={busy} label="Назад до магазинів">
            <span aria-hidden="true">← </span>
            Магазини
          </Back>
        }
      />
      <article
        className="store-screen"
        aria-label={`Магазин ${visible(store.name)}`}
      >
        {notices}
        <div className="tag-hero tag-outline store-hero">
          <div className="store-tag-in">
            <h1 ref={name} tabIndex={-1} className="store-tag-name">
              {visible(store.name)}
            </h1>
            <p className="t-meta store-tag-code">{visible(store.code)}</p>
            {store.state !== "ACTIVE" && (
              <p className="badge store-tag-state">{stickerText(store)}</p>
            )}
            {latest && store.state !== "ACTIVE" && (
              <p className="t-row store-hero-why">
                Причина: {visible(latest.reason)}
              </p>
            )}
          </div>
        </div>
        {store.changes.length > 0 && (
          <>
            <h2 className="t-label customer-history-title">Історія змін</h2>
            <ul
              className="timeline"
              aria-label={`Історія: ${visible(store.name)}`}
            >
              {store.changes.map((item, index) => (
                <li
                  className="timeline-row"
                  key={`${item.at}:${String(index)}`}
                >
                  <span className="timeline-day">{shortDay(item.at)}</span>
                  {/* Every change recorded: a knot each. */}
                  <span className="timeline-node knot" aria-hidden="true" />
                  <span className="timeline-main">
                    <span className="timeline-what">
                      {stateLabels[item.from_state]} →{" "}
                      {stateLabels[item.to_state]}
                    </span>
                    <span className="timeline-meta">
                      {visible(item.by)} · {visible(item.reason)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="actions store-ways">
          {actions[store.state].map((action) => (
            <button
              key={action.to}
              type="button"
              className={action.to === "ARCHIVED" ? "quiet" : "store-way"}
              aria-haspopup="dialog"
              disabled={held}
              onClick={() => {
                setRefusal(null);
                setAsking(action.to);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </article>
      {asking && (
        <StateSheet
          store={store}
          to={asking}
          held={held}
          busy={busy}
          refusal={refusal}
          fallback={name}
          close={() => {
            setAsking(null);
            setRefusal(null);
          }}
          run={(reason) => {
            setRefusal(null);
            void change(asking, reason).then((answer) => {
              if (answer instanceof ApiError) setRefusal(answer);
              else setAsking(null);
            });
          }}
        />
      )}
    </>
  );
}

/**
 * The question before a store's state changes (stage 2, admin task list,
 * P0-4): a sheet, as «Списати борг» asks — a reason is needed — named by
 * what it does, «Заблокувати «Ринок»?»; what follows from it, the reason
 * and who reads it, «Так, …» dark while no reason is typed. Sent, its way
 * out is held until the answer. Refused, it stays: what is left in a store
 * that may not be archived is listed in it.
 */
function StateSheet({
  store,
  to,
  held,
  busy,
  refusal,
  fallback,
  close,
  run,
}: {
  store: StoreRecord;
  to: StoreState;
  held: boolean;
  busy: boolean;
  refusal: ApiError | null;
  fallback: RefObject<HTMLElement>;
  close: () => void;
  run: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState("");
  const hint = useId();
  // The state it was asked from: the question stays the one asked.
  const [from] = useState(store.state);
  const named = `«${visible(store.name)}»`;
  const title =
    to === "BLOCKED"
      ? `Заблокувати ${named}?`
      : to === "ARCHIVED"
        ? `Закрити ${named} в архів?`
        : from === "ARCHIVED"
          ? `Відкрити ${named} знову?`
          : `Розблокувати ${named}?`;
  // Moved on meanwhile — answered «already», read again — nothing to send.
  const offered = actions[store.state].some((action) => action.to === to);
  // Refused: the cursor to why, in the sheet — the button it was on was held
  // while sending, and a held button lets the cursor go (review,
  // 2026-11-07).
  const refused = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (refusal) refused.current?.focus();
  }, [refusal]);
  const leftovers =
    refusal?.details.reason === "NOT_EMPTY"
      ? (refusal.details.leftovers as Leftover[])
      : null;
  return (
    <Sheet
      title={title}
      close={() => {
        if (!busy) close();
      }}
      fallback={fallback}
      foot={
        <>
          <SendingLine busy={busy} />
          <div className="actions">
            <button
              type="button"
              className={busy ? "pressed" : undefined}
              disabled={held || !offered || reason.trim() === ""}
              onClick={() => {
                run(reason.trim());
              }}
            >
              {busy && <Eyelet state="spin" size={20} />}
              {confirmLabels[to]} {named}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={close}
            >
              Скасувати
            </button>
          </div>
        </>
      }
    >
      {to === "ARCHIVED" ? (
        <p>
          Закрити можна лише порожній магазин: на його власних складах і в
          «Брак» нічого немає, відкритих замовлень немає. Його люди не зможуть
          нічого робити в ньому; відкрити його знову можна пізніше.
        </p>
      ) : to === "BLOCKED" ? (
        <p>
          У магазині зупиняться продажі, приймання, повернення, оплати й
          замовлення. Його відкриті замовлення чекатимуть, товар під ними
          лишиться заброньованим.
        </p>
      ) : (
        <p>Магазин знову працюватиме, його люди — з тими самими правами.</p>
      )}
      {to !== "ACTIVE" && (
        <p>Борги його покупців приймає будь-який магазин, що працює.</p>
      )}
      <label className="write-off-why">
        Причина
        <textarea
          // Opened by a tap: the keyboard comes with the sheet (iOS).
          autoFocus
          enterKeyHint="enter"
          value={reason}
          maxLength={1000}
          aria-describedby={hint}
          disabled={busy}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>
      <p id={hint} className="t-meta store-why-hint">
        Її бачите ви й менеджери мережі, не продавці.
      </p>
      {refusal && (
        <div ref={refused} tabIndex={-1} role="alert" className="store-refusal">
          <p>{refusalText(refusal)}</p>
          {leftovers && (
            <ul className="store-left" aria-label="Що лишилось у магазині">
              {leftovers.map((left) =>
                left.kind === "ORDERS" ? (
                  <li key="orders" className="t-row">
                    Відкриті замовлення · {left.count}
                  </li>
                ) : (
                  <li key={left.location_id} className="t-row">
                    {left.kind === "DAMAGED" ? "Брак" : "Власний склад"} «
                    {visible(left.name)}» · {left.units} шт.
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}

function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.details.reason) {
      case "NOT_EMPTY":
        return "Закрити в архів можна лише порожній магазин. Спершу продайте, перемістіть чи спишіть те, що лишилось, і завершіть замовлення:";
      case "ALREADY":
        return "Магазин уже в цьому стані. Список оновлено.";
      case "NOT_FROM_ARCHIVE":
        return "Закритий магазин не блокують — його відкривають знову.";
      case "NO_REASON":
        return "Вкажіть причину.";
    }
  }
  return inOwnWords(
    errorText(error),
    "Стан магазину не змінено. Перевірте причину та спробуйте ще раз.",
    "Стан магазину не змінено: його змінили — перегляньте його й спробуйте ще раз.",
  );
}
