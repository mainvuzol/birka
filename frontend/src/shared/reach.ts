import { useEffect, useRef } from "react";
import { create } from "zustand";
import { visible } from "@/shared/visible";

/**
 * Whether the server answers, as this phone last saw it (ADR-0013 §4.2).
 *
 * `api()` notes every outcome: no answer, the 20 s timeout, a page that is
 * not the API's, or a 502, 503 or 504 set `down`; any other answer ends it.
 * A call declared slow that runs out of its own 60 s notes nothing: the
 * server may still be working on it (`SlowAnswer`, ADR-0014 §16).
 * `since` is when it went down, kept from the first failure until an answer.
 * `back` is that this phone saw it come back, until the till's reminder is
 * answered or it goes down again (redesign P1-7).
 * Only in memory: a reopened app starts by asking.
 */
export interface Reach {
  down: boolean;
  since: string | null;
  back: boolean;
}

export const useReach = create<Reach>(() => ({
  down: false,
  since: null,
  back: false,
}));

/** No answer: the server is down from now, or still since the first one. */
export function noteUnreachable(): void {
  if (!useReach.getState().down)
    useReach.setState({
      down: true,
      since: new Date().toISOString(),
      back: false,
    });
}

/** An answer of the server's own: it is back. */
export function noteAnswered(): void {
  if (useReach.getState().down)
    useReach.setState({ down: false, since: null, back: true });
}

/** The till's reminder answered: not shown again until the next return. */
export function backNoted(): void {
  if (useReach.getState().back) useReach.setState({ back: false });
}

/**
 * One kept operation the phone checks by itself (ADR-0013 §4.3): a journal
 * that holds an attempt nobody knows the outcome of.
 */
export interface Check {
  /** An attempt is kept, its outcome unknown. */
  pending: boolean;
  /** It is being sent now. */
  busy: boolean;
  /**
   * Its attempt was read from the phone's storage when this screen opened:
   * the app was reopened, and the attempt is checked once, at once
   * (Trigger 2, G12).
   */
  loaded: boolean;
  /**
   * Exactly what the banner's button does: the identical attempt, resent
   * under its own key. Never a new command (ADR-0003).
   */
  run: () => void;
}

/**
 * The phone checks its kept operations by itself, with no new tap (ADR-0013
 * §4.3; owner decision, 2026-10-04: "the phone checks it itself as soon as
 * the connection is back").
 *
 * - When the server comes back — `down` turns false, by the probe or by any
 *   request that got an answer — each kept attempt not being sent is resent
 *   once. A resend that again gets no answer sets `down` again, and the next
 *   return resends it again: once per reconnection, never in a loop. An
 *   answer while `down` is already false (a 500, say) is no return.
 * - When its journal read the attempt from storage, it is resent once, as
 *   soon as this screen is up: a reopened app never sees the server come
 *   back, and would otherwise leave it to the button.
 * - While something is kept and the server is down, `/ready` is asked (the
 *   probe below).
 *
 * `checks` keeps its order from one drawing to the next: each is known by
 * its place.
 */
export function useAutoCheck(checks: readonly Check[]): void {
  const latest = useRef(checks);
  useEffect(() => {
    latest.current = checks;
  });
  // Trigger 1: the server is back.
  useEffect(
    () =>
      useReach.subscribe((state, previous) => {
        if (!previous.down || state.down) return;
        for (const check of latest.current)
          if (check.pending && !check.busy) check.run();
      }),
    [],
  );
  // Trigger 2: read from storage, checked once. One already being sent (its
  // button pressed) counts as checked.
  const checked = useRef<boolean[]>([]);
  useEffect(() => {
    checks.forEach((check, index) => {
      if (!check.loaded || checked.current[index] === true) return;
      if (check.busy) checked.current[index] = true;
      else if (check.pending) {
        checked.current[index] = true;
        check.run();
      }
    });
  });
  const waiting = checks.some((check) => check.pending);
  useEffect(() => (waiting ? holdProbe() : undefined), [waiting]);
}

/*
 * The probe (ADR-0013 §4.3). While the server is down and some screen keeps
 * an operation, `GET /api/v1/ready` is asked: 10 s after the probing starts,
 * then every 20 s; at once when the phone says it is online again, and when
 * the app is shown again. One request per 20 s per phone while something
 * waits; never otherwise.
 *
 * Only a 200 whose body says `{"status": "ready"}` ends `down`: a captive
 * portal or an operator's page answering for the server is no answer. No
 * token: readiness is public, and the session may have ended meanwhile.
 */
const FIRST_PROBE = 10_000;
const NEXT_PROBE = 20_000;
let holders = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let probing = false;
let listening = false;

function stopProbing(): void {
  clearTimeout(timer);
  timer = undefined;
}

function probeIn(delay: number): void {
  stopProbing();
  if (holders > 0 && useReach.getState().down)
    timer = setTimeout(() => {
      void probe();
    }, delay);
}

async function probe(): Promise<void> {
  if (probing || holders === 0 || !useReach.getState().down) return;
  probing = true;
  stopProbing();
  let ready = false;
  try {
    const response = await fetch("/api/v1/ready", {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 200) {
      const body: unknown = await response.json();
      ready =
        typeof body === "object" &&
        body !== null &&
        (body as { status?: unknown }).status === "ready";
    }
  } catch {
    // No answer, or a page that is not the API's: still down.
  } finally {
    probing = false;
  }
  if (ready) noteAnswered();
  else probeIn(NEXT_PROBE);
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("online", () => {
    void probe();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void probe();
  });
  useReach.subscribe((state, previous) => {
    if (state.down && !previous.down) probeIn(FIRST_PROBE);
    else if (!state.down) stopProbing();
  });
}

/** Some screen keeps an operation: probe while the server is down. */
function holdProbe(): () => void {
  listen();
  holders += 1;
  if (holders === 1) probeIn(FIRST_PROBE);
  return () => {
    holders -= 1;
    if (holders === 0) stopProbing();
  };
}

/** «14:20», the phone's own time, as the app shows every moment. */
function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The line under every kept operation's banner (ADR-0013 §4.4; owner
 * decision, 2026-10-07): since when it waits, and that its paper line is
 * not typed while this phone keeps it — a kept attempt and a typed paper
 * line are two commands, and the server cannot tell them apart. `person` is
 * whoever this phone belongs to. An attempt kept before this change has no
 * `since`, and the first sentence is left out.
 */
export function keptText(since: string | undefined, person: string): string {
  const waits =
    since !== undefined && !Number.isNaN(Date.parse(since))
      ? `Чекає відповіді сервера з ${clockOf(since)}. `
      : "";
  return `${waits}Запишіть цю операцію на папері з позначкою «у телефоні — ${visible(person)}» і не вносьте її з паперу: телефон перевірить її сам. Вносьте з паперу, лише якщо застосунок скаже «не записано».`;
}

/** An optional `since` read back from storage: absent, or a moment. */
export function isSince(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && !Number.isNaN(Date.parse(value)))
  );
}

/**
 * The `since` an attempt is written down with: the first time it was put on
 * the phone, kept on every resend. `kept` is what storage already holds for
 * this same command; one kept before this change has none, and gets none.
 */
export function sinceOf(
  kept: { since?: string } | null,
  attempt: { since?: string },
): { since?: string } {
  const since =
    kept !== null ? kept.since : (attempt.since ?? new Date().toISOString());
  return since === undefined ? {} : { since };
}
