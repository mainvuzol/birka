import { useEffect, useId, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import { visible } from "@/shared/visible";
import type { Store } from "@/orders/types";
import {
  daysAgo,
  firstDaysSpan,
  paperDay,
  setFirstDays,
  setPaper,
  setTakenBy,
  usePaper,
} from "./paper";

/**
 * A return or a debt payment typed from paper (owner decision, 2026-10-10;
 * ADR-0021): the mark «під час збою», as a sale's. It may name who took it
 * and at what hour, as the paper says; both optional. The switch is the
 * till's (`./paper`): one series per store, whichever screen it is ticked
 * on; who is named is this screen's own, kept for its series; the paper's
 * time is each operation's own. Since 2026-10-16 the first days' paper is
 * «з паперу», with no word of an outage, and may be dated any of the last
 * two weeks (owner decision; ADR-0013 §5.8).
 */

/** The mark as a return's or a payment's request carries it; `first_days`
 * only when true, so an outage's mark is sent as it always was. */
export interface PaperBody {
  by_user_id: string | null;
  at: string | null;
  first_days?: true;
}

/** The mark as the server answers it: who took it, by name too.
 * `first_days` is absent from answers recorded before it existed. */
export interface PaperView {
  by_user_id: string | null;
  by: string | null;
  at: string | null;
  first_days?: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A kept command's mark, read back from the phone's storage. */
export function isPaperBody(value: unknown): value is PaperBody {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  if (keys.some((name) => !["by_user_id", "at", "first_days"].includes(name)))
    return false;
  const {
    by_user_id: by,
    at,
    first_days: firstDays,
  } = value as Record<string, unknown>;
  return (
    (firstDays === undefined || firstDays === true) &&
    (by === undefined ||
      by === null ||
      (typeof by === "string" && uuid.test(by))) &&
    (at === undefined ||
      at === null ||
      (typeof at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at)))
  );
}

/**
 * «Повернено під час збою · хто прийняв: Ганна · за папером 06.10, 19:40»,
 * by the phone's own clock; «Повернено з паперу · …» for the first days'
 * paper. What the paper did not name is left out.
 */
export function paperText(kind: "return" | "payment", mark: PaperView): string {
  const how = mark.first_days === true ? "з паперу" : "під час збою";
  const parts = [kind === "return" ? `Повернено ${how}` : `Внесок ${how}`];
  if (mark.by !== null) parts.push(`хто прийняв: ${visible(mark.by)}`);
  if (mark.at !== null && !Number.isNaN(Date.parse(mark.at))) {
    const at = new Date(mark.at);
    parts.push(
      `за папером ${at.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}, ${at.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`,
    );
  }
  return parts.join(" · ");
}

/**
 * «Хто прийняв: Ганна · за папером вчора, 19:40», the one line under the
 * panel's buttons from paper — a return's (returns task list, P1-4) and a
 * debt payment's (credits task list, P0-4): seen before the press, so a
 * switch left on is seen, as the till's «Продавець: …» is (G6). The paper's
 * time only when it reads.
 */
export function takenBy(mark: PaperMarkState): string {
  const who = mark.named ? visible(mark.named.display_name) : "не вказано";
  const at = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(
    mark.body()?.at ?? "",
  );
  if (!at) return `Хто прийняв: ${who}`;
  const [, month = "", day = "", time = ""] = at;
  const when =
    mark.firstDays === true
      ? `${day}.${month}`
      : mark.yesterday
        ? "вчора"
        : "сьогодні";
  return `Хто прийняв: ${who} · за папером ${when}, ${time}`;
}

/** Why a paper time was too old: an outage's is today's or yesterday's, the
 * first days' of the last two weeks (owner decisions, 2026-10-07 and
 * 2026-10-16). */
export function tooOldText(firstDays: boolean): string {
  return firstDays
    ? `Час з паперу перших днів можна вказати лише за останні ${String(firstDaysSpan)} днів. Для давнішого залиште час порожнім.`
    : "Час з паперу можна вказати лише за сьогодні або вчора. Для давнішого залиште час порожнім.";
}

/** Why a mark was refused, after the command was looked up: nothing was
 * recorded, and the seller fixes the mark and sends it again. A time too
 * old says how many days back the server took (`days`): more than one is
 * the first days' paper. */
export function paperRefusal(reason: unknown, days?: unknown): string | null {
  switch (reason) {
    case "OUTAGE_SELLER_UNKNOWN":
      return "Ця людина не може приймати це в цьому магазині. Оберіть іншу або залиште «не вказано».";
    case "OUTAGE_TIME_FUTURE":
      return "Цей час ще не настав. Перевірте час і день з паперу.";
    case "OUTAGE_TIME_TOO_OLD":
      return tooOldText(typeof days === "number" && days > 1);
    default:
      return null;
  }
}

/**
 * Which paper the series is, said once by whoever types it (owner decision,
 * 2026-10-16): the first days', written while a warehouse waited for its
 * opening list, or an outage's. The mark is permanent, so nothing is chosen
 * for them; until one is, nothing typed from paper is sent.
 */
export function PaperKind({
  storeId,
  firstDays,
}: {
  storeId: string;
  firstDays: boolean | null;
}): JSX.Element {
  const name = useId();
  return (
    <fieldset className="paper-kind">
      <legend>Що вносите з паперу?</legend>
      <label className="check">
        <input
          type="radio"
          name={name}
          checked={firstDays === true}
          onChange={() => {
            setFirstDays(storeId, true);
          }}
        />
        Перші дні, до затвердження залишків
      </label>
      <label className="check">
        <input
          type="radio"
          name={name}
          checked={firstDays === false}
          onChange={() => {
            setFirstDays(storeId, false);
          }}
        />
        Сервер не відповідав
      </label>
      {firstDays === null && (
        <p className="hint">
          Оберіть, що вносите: позначка залишиться назавжди.
        </p>
      )}
    </fieldset>
  );
}

/**
 * The paper's day and time, each operation's own. An outage's paper is of
 * today, or of yesterday with «Це було вчора» (G1); the first days' paper
 * is of any of the last two weeks, its day picked.
 */
export function PaperWhen({
  firstDays,
  day,
  time,
  yesterday,
  onDay,
  onTime,
  onYesterday,
}: {
  firstDays: boolean | null;
  day: string;
  time: string;
  yesterday: boolean;
  onDay: (day: string) => void;
  onTime: (time: string) => void;
  onYesterday: (yesterday: boolean) => void;
}): JSX.Element {
  const problem = paperWhenProblem(firstDays, day, time);
  return (
    <div className="fields">
      {firstDays === true && (
        <label>
          День з паперу
          <input
            type="date"
            min={daysAgo(firstDaysSpan - 1)}
            max={daysAgo(0)}
            value={day}
            onChange={(event) => {
              onDay(event.target.value);
            }}
          />
        </label>
      )}
      <label>
        Час з паперу
        <input
          type="time"
          value={time}
          onChange={(event) => {
            onTime(event.target.value);
          }}
        />
      </label>
      {firstDays !== true && time && (
        <label className="check">
          <input
            type="checkbox"
            checked={yesterday}
            onChange={(event) => {
              onYesterday(event.target.checked);
            }}
          />
          Це було вчора
        </label>
      )}
      {problem && <p className="hint">{problem}</p>}
    </div>
  );
}

/**
 * What keeps the paper's day and time from being sent (review,
 * 2026-10-16): the first days' paper names its day and its time together,
 * or neither, and nothing guesses the one left out — a wrong mark is
 * permanent. Null when they may be sent.
 */
export function paperWhenProblem(
  firstDays: boolean | null,
  day: string,
  time: string,
): string | null {
  if (firstDays !== true) return null;
  const hasDay = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const hasTime = /^\d{2}:\d{2}/.test(time);
  if (hasTime && !hasDay) return "Вкажіть день з паперу.";
  if (hasDay && !hasTime)
    return "Вкажіть і час з паперу або очистіть день: без часу день не запишеться.";
  return null;
}

/**
 * The paper's time as a request writes it: the store's wall clock,
 * `YYYY-MM-DDTHH:MM`, or null when no time was typed. An outage's day is
 * today, or yesterday with «Це було вчора»; the first days' is the one
 * picked, and without it nothing is sent (`paperWhenProblem`).
 */
export function paperAt(
  firstDays: boolean | null,
  day: string,
  time: string,
  yesterday: boolean,
): string | null {
  const at = /^\d{2}:\d{2}/.exec(time)?.[0];
  if (!at) return null;
  if (firstDays !== true) return `${paperDay(yesterday)}T${at}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T${at}` : null;
}

/** The paper mode of a return's or a payment's screen. */
export function usePaperMark(
  store: Store,
  token: string,
  journalKey: string,
  namedFor: "refund" | "credit",
) {
  const paper = usePaper((state) => state.storeId === store.id);
  const taker = usePaper((state) =>
    state.storeId === store.id ? state.takenBy[namedFor] : null,
  );
  const firstDays = usePaper((state) =>
    state.storeId === store.id ? state.firstDays : null,
  );
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [yesterday, setYesterday] = useState(false);
  // Another kind of paper: its day and time are asked anew, never carried
  // over from the other's (review, 2026-10-16).
  useEffect(() => {
    setDay("");
    setTime("");
    setYesterday(false);
  }, [firstDays]);
  // Who may be named: read only while the switch is on. Only someone this
  // list shows is ever sent, as at the till.
  const people = useQuery({
    queryKey: ["paper-people", namedFor, journalKey, store.id],
    queryFn: () =>
      api<{ sellers: { user_id: string; display_name: string }[] }>(
        `/stores/${store.id}/sellers?for=${namedFor}`,
        token,
      ),
    enabled: paper,
    retry: false,
  });
  const named =
    taker === null
      ? undefined
      : people.data?.sellers.find((person) => person.user_id === taker);
  return {
    paper,
    firstDays,
    /** Nothing typed from paper is sent until the series says which paper
     * it is, and the first days' day and time go together. */
    ready:
      !paper ||
      (firstDays !== null && paperWhenProblem(firstDays, day, time) === null),
    named,
    people,
    day,
    time,
    yesterday,
    setDay,
    turn(on: boolean): void {
      setPaper(store.id, on);
      setDay("");
      setTime("");
      setYesterday(false);
    },
    name(userId: string | null): void {
      setTakenBy(store.id, namedFor, userId);
    },
    setTime(value: string): void {
      setTime(value);
      if (!value) setYesterday(false);
    },
    setYesterday,
    /** The mark to send, or null when typed live. */
    body(): PaperBody | null {
      if (!paper) return null;
      return {
        by_user_id: named?.user_id ?? null,
        at: paperAt(firstDays, day, time, yesterday),
        ...(firstDays === true ? { first_days: true as const } : {}),
      };
    },
    /** After each one sent: the next line of paper has its own time. */
    forgetTime(): void {
      setDay("");
      setTime("");
      setYesterday(false);
    },
  };
}

export type PaperMarkState = ReturnType<typeof usePaperMark>;

/** The switch and, while it is on, what the paper names. */
export function PaperFields({
  mark,
  what,
  storeId,
}: {
  mark: PaperMarkState;
  what: "return" | "payment";
  storeId: string;
}): JSX.Element {
  return (
    <>
      <label className="check">
        <input
          type="checkbox"
          checked={mark.paper}
          onChange={(event) => {
            mark.turn(event.target.checked);
          }}
        />
        {what === "return"
          ? "Вношу повернення з паперу"
          : "Вношу внесок з паперу"}
      </label>
      {mark.paper && (
        <section className="notice" aria-label="Режим: з паперу">
          <h3>Режим: з паперу</h3>
          <PaperKind storeId={storeId} firstDays={mark.firstDays} />
          {mark.firstDays !== null && (
            <p>
              {what === "return"
                ? mark.firstDays
                  ? "Повернення позначать «з паперу». Воно увійде в сьогоднішні повернення й у касу до наступного закриття. Гроші, які вже віддали, вдруге не віддавайте."
                  : "Повернення позначать «під час збою». Воно увійде в сьогоднішні повернення й у касу до наступного закриття. Гроші, які віддали під час збою, вдруге не віддавайте."
                : mark.firstDays
                  ? "Внесок позначать «з паперу». Він увійде в касу до наступного закриття. Гроші вже взяли — на терміналі нічого не проводьте."
                  : "Внесок позначать «під час збою». Він увійде в касу до наступного закриття. Гроші вже взяли — на терміналі нічого не проводьте."}
            </p>
          )}
          <label>
            Хто прийняв
            <select
              value={mark.named?.user_id ?? ""}
              onChange={(event) => {
                mark.name(event.target.value || null);
              }}
            >
              <option value="">Не вказано</option>
              {(mark.people.data?.sellers ?? []).map((person) => (
                <option key={person.user_id} value={person.user_id}>
                  {visible(person.display_name)}
                </option>
              ))}
            </select>
          </label>
          {mark.people.error && (
            <p role="alert">
              {errorText(mark.people.error)}{" "}
              <button
                className="quiet"
                onClick={() => {
                  void mark.people.refetch();
                }}
              >
                Спробувати ще раз
              </button>
            </p>
          )}
          <PaperWhen
            firstDays={mark.firstDays}
            day={mark.day}
            time={mark.time}
            yesterday={mark.yesterday}
            onDay={mark.setDay}
            onTime={(value) => {
              mark.setTime(value);
            }}
            onYesterday={mark.setYesterday}
          />
        </section>
      )}
    </>
  );
}
