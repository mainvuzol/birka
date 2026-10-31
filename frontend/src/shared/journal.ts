import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import {
  api,
  ApiError,
  recordedNothing,
  refusedOutright,
  unreachable,
} from "@/shared/api";
import { isSince, sinceOf } from "@/shared/reach";
import { buzz } from "@/shared/telegram";

/**
 * One stock command, written down before it is sent.
 *
 * The protocol the receiving screen introduced, now shared by every command
 * that carries a permanent `command_id` and needs no read-back: a receipt
 * (ADR-0006) and a stock correction (ADR-0007). For both, resending the
 * identical attempt returns the original answer however late it arrives —
 * even after the 7-day cache is gone — so resending *is* the recovery.
 *
 * A return at the till (`@/returns/commands`) uses it too: its path names the
 * sale, and what is sent leaves out what the journal keeps only for itself.
 *
 * The till keeps its own journal (`@/sales/commands`): a sale is read back by
 * its id once acknowledged, which these commands have no need for.
 */
export interface Attempt<Body> {
  key: string;
  body: Body;
  ambiguous?: boolean;
  /**
   * When it was first written down, by the phone's clock, kept on every
   * resend: the banner's «Чекає відповіді сервера з 14:20» (ADR-0013 §4.4).
   * Beside the body, never in it, so what is sent stays the same. Absent
   * from an attempt kept before it was written.
   */
  since?: string;
  /**
   * Its checks answered «not found», or that the request was not taken,
   * this many times in a row (`counts`), kept beside
   * the body, never in it, so the count survives Telegram closing and
   * reopening the app (owner decision, 2026-10-21). Absent from an attempt
   * kept before it was written, or never missed.
   */
  misses?: number;
}

/**
 * An answer that settles nothing about a kept command and counts towards a
 * manager: «not found» (owner decision, 2026-10-19), and a request the
 * server did not take, a 400 or a 422 (owner decision, 2026-10-21) — in one
 * row, whichever comes. Any other answer begins the count again.
 */
export function counts(error: ApiError): boolean {
  return error.status === 404 || error.status === 400 || error.status === 422;
}

/** A kept count, read as one: anything else on disk is no count at all;
 * a count past 999 is 999, still past three (review, 2026-10-21). */
export function countOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, 999)
    : 0;
}

/** Write the count beside a kept attempt; a phone that cannot write keeps
 * it for the session, as before (the count only words a banner). */
export function keepCount(
  storageKey: string,
  attempt: object,
  misses: number,
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...attempt, misses }));
  } catch {
    // Storage refused: the attempt itself was written before it was sent.
  }
}

export type JournalOutcome<Result> =
  | { kind: "done"; result: Result }
  | { kind: "refused"; error: ApiError }
  | { kind: "unknown" };

export interface JournalState<Body> {
  pending: Attempt<Body> | null;
  busy: boolean;
  error: unknown;
  /**
   * The kept attempt's checks answered «not found», or that the request was
   * not taken, this many times in a row (`counts`):
   * from the third, its words send the seller to a manager (owner decision,
   * 2026-10-19).
   */
  misses: number;
  /**
   * The attempt being sent was never sent before: the press's own dock says
   * it is being sent, and it is shown as kept only once its answer is lost
   * («Усе на бірці» task list, P0-2).
   */
  firstSend: boolean;
}

export interface Journal<Body, Result> {
  use: UseBoundStore<StoreApi<JournalState<Body>>>;
  load: (storageKey: string) => Attempt<Body> | null;
  submit: (
    storageKey: string,
    token: string,
    attempt: Attempt<Body>,
  ) => Promise<JournalOutcome<Result>>;
  resolve: (
    storageKey: string,
    token: string,
    attempt: Attempt<Body>,
  ) => Promise<JournalOutcome<Result>>;
}

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const isUuid = new RegExp(`^${uuid}$`);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isId(value: unknown): boolean {
  return typeof value === "string" && isUuid.test(value);
}

export function journal<
  Body extends { store_id: string; command_id: string },
  Result,
>({
  path,
  payload = (body) => body,
  scope,
  isBody,
  corrupt,
  unfinished,
}: {
  /** Where the command is sent, e.g. `/inventory/receipts`, or where this one is. */
  path: string | ((body: Body) => string);
  /** What is sent, when it is not the whole body the journal keeps. */
  payload?: (body: Body) => unknown;
  /** The storage key's prefix: `birka:<scope>:<organization>:<user>:<store>`. */
  scope: string;
  /** Every field of the body, checked; `store_id` and `command_id` are checked here. */
  isBody: (body: Record<string, unknown>) => boolean;
  /** Said when what is on disk is not an attempt. */
  corrupt: string;
  /** Said when another command is still unsettled. */
  unfinished: string;
}): Journal<Body, Result> {
  const use = create<JournalState<Body>>(() => ({
    pending: null,
    busy: false,
    error: null,
    misses: 0,
    firstSend: false,
  }));
  const scopeKey = new RegExp(`^birka:${scope}:(${uuid}):(${uuid}):(${uuid})$`);

  /** Storage is untrusted, whatever TypeScript has been told about it. */
  function validate(key: string, value: unknown): Attempt<Body> {
    const owner = scopeKey.exec(key);
    const body = isRecord(value) ? value.body : undefined;
    if (
      !owner ||
      !isRecord(value) ||
      !isId(value.key) ||
      (value.ambiguous !== undefined && typeof value.ambiguous !== "boolean") ||
      !isSince(value.since) ||
      !isRecord(body) ||
      body.store_id !== owner[3] ||
      !isId(body.command_id) ||
      !isBody(body)
    ) {
      throw new Error(corrupt);
    }
    // Every field the type promises has been checked above; the count is
    // only a count.
    return {
      ...(value as unknown as Attempt<Body>),
      misses: countOf(value.misses),
    };
  }

  function load(storageKey: string): Attempt<Body> | null {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    // Anything found on disk was sent, or may have been.
    const attempt = {
      ...validate(storageKey, JSON.parse(raw)),
      ambiguous: true,
    };
    localStorage.setItem(storageKey, JSON.stringify(attempt));
    return attempt;
  }

  /**
   * Send one command, leaving the journal in a state the person can act on.
   *
   * A definite refusal to an attempt that was never in doubt proves nothing
   * was written, so the journal is cleared and the screen is theirs again.
   * So does a refusal the server marks as proving it (`recordedNothing`),
   * even after an unknown outcome.
   * Anything else keeps the attempt on disk, marked ambiguous, and blocks the
   * app until the identical attempt is resent.
   */
  async function submit(
    storageKey: string,
    token: string,
    attempt: Attempt<Body>,
  ): Promise<JournalOutcome<Result>> {
    if (use.getState().busy) return { kind: "unknown" };
    use.setState({ busy: true, error: null });
    let current = attempt;
    let previouslyAmbiguous = Boolean(current.ambiguous);
    // Whether the attempt on disk is this one: only then is its count kept
    // beside it, never over another command still unsettled.
    let written = false;
    try {
      current = validate(storageKey, current);
      const saved = localStorage.getItem(storageKey);
      let existing: Attempt<Body> | null = null;
      if (saved) {
        existing = validate(storageKey, JSON.parse(saved));
        if (existing.body.command_id !== current.body.command_id) {
          use.setState({ pending: existing });
          throw new Error(unfinished);
        }
        previouslyAmbiguous ||= Boolean(existing.ambiguous);
      }
      // Written down BEFORE the request, so a page that dies mid-flight still
      // knows which command to ask about.
      current = {
        ...current,
        ambiguous: true,
        ...sinceOf(existing, current),
        misses: use.getState().misses,
      };
      use.setState({ pending: current, firstSend: !previouslyAmbiguous });
      localStorage.setItem(storageKey, JSON.stringify(current));
      written = true;
      const result = await api<Result>(
        typeof path === "string" ? path : path(current.body),
        token,
        payload(current.body),
        current.key,
      );
      localStorage.removeItem(storageKey);
      use.setState({ pending: null, misses: 0 });
      return { kind: "done", result };
    } catch (error) {
      const definite =
        (!previouslyAmbiguous || recordedNothing(error)) &&
        refusedOutright(error) &&
        error.code !== "IDEMPOTENCY_IN_PROGRESS";
      if (definite) {
        localStorage.removeItem(storageKey);
        use.setState({ pending: null, error: null, misses: 0 });
        return { kind: "refused", error };
      }
      const misses =
        // No answer at all, or the app's own failure, says nothing of the
        // command: the count stands (review, 2026-10-20).
        !(error instanceof ApiError) || unreachable(error)
          ? use.getState().misses
          : counts(error)
            ? use.getState().misses + 1
            : 0;
      if (written) {
        keepCount(storageKey, current, misses);
        // Kept on the phone from now: felt once, as it first is (spec §4.4;
        // «Усе на бірці» task list, P1-2).
        if (!previouslyAmbiguous) buzz("warning");
        use.setState({ error, misses, pending: { ...current, misses } });
      } else use.setState({ error, misses });
      return { kind: "unknown" };
    } finally {
      use.setState({ busy: false, firstSend: false });
    }
  }

  /** Settle a command nobody knows the outcome of, without changing it. */
  function resolve(
    storageKey: string,
    token: string,
    attempt: Attempt<Body>,
  ): Promise<JournalOutcome<Result>> {
    return submit(storageKey, token, { ...attempt, ambiguous: true });
  }

  return { use, load, submit, resolve };
}
