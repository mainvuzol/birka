import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { api, ApiError, recordedNothing } from "@/shared/api";
import { isSince, sinceOf } from "@/shared/reach";

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
}

export type JournalOutcome<Result> =
  | { kind: "done"; result: Result }
  | { kind: "refused"; error: ApiError }
  | { kind: "unknown" };

export interface JournalState<Body> {
  pending: Attempt<Body> | null;
  busy: boolean;
  error: unknown;
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
    // Every field the type promises has been checked above.
    return value as unknown as Attempt<Body>;
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
      };
      use.setState({ pending: current });
      localStorage.setItem(storageKey, JSON.stringify(current));
      const result = await api<Result>(
        typeof path === "string" ? path : path(current.body),
        token,
        payload(current.body),
        current.key,
      );
      localStorage.removeItem(storageKey);
      use.setState({ pending: null });
      return { kind: "done", result };
    } catch (error) {
      const definite =
        (!previouslyAmbiguous || recordedNothing(error)) &&
        error instanceof ApiError &&
        error.code !== "IDEMPOTENCY_IN_PROGRESS" &&
        [400, 403, 404, 409, 422].includes(error.status);
      if (definite) {
        localStorage.removeItem(storageKey);
        use.setState({ pending: null, error: null });
        return { kind: "refused", error };
      }
      use.setState({ error });
      return { kind: "unknown" };
    } finally {
      use.setState({ busy: false });
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
