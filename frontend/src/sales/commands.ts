import { create } from "zustand";
import {
  api,
  ApiError,
  recordedNothing,
  refusedOutright,
  unreachable,
} from "@/shared/api";
import { decimal, kopecks } from "@/orders/types";
import { isTillMethod } from "@/shared/payment";
import type { TillMethod } from "@/shared/payment";
import { countOf, keepCount } from "@/shared/journal";
import { isSince, sinceOf } from "@/shared/reach";
import type {
  CreditTerms,
  EmptyShelf,
  OutageBody,
  Report,
  Sale,
  SaleLine,
  Shortfall,
} from "./types";
import { shortfallOf } from "./types";

export interface SaleBody {
  store_id: string;
  command_id: string;
  lines: SaleLine[];
  found_in_store: Report[];
  missing_in_store: Report[];
  /**
   * Absent from an attempt written down before the till could clarify a
   * size. Such an attempt is resent exactly as stored, so it stays absent:
   * the server reads a missing list as an empty one.
   */
  size_clarified?: Report[];
  /** Present only when the customer pays in parts. */
  credit?: CreditTerms;
  /**
   * How the customer pays: «Готівка», «Картка» or «Переказ», the button that
   * sold (owner decision, 2026-10-04; ADR-0012 §B2). With `credit`, how the
   * part paid now is paid. Absent from an attempt written down before the
   * till asked; such an attempt is resent exactly as stored, so it stays
   * absent, and the server replays it if it was recorded or refuses it as
   * having recorded nothing.
   */
  payment_method?: TillMethod;
  /**
   * A sale typed from paper after the server did not answer: «продано під
   * час збою», with who sold and the paper's time when known (owner
   * decisions, 2026-10-04 and 2026-10-07; ADR-0013 §5.2, §7). Absent from
   * every ordinary sale, so its body and its print stay as they were.
   */
  outage?: OutageBody;
}

/**
 * One attempt at one sale, written down before it is sent.
 *
 * `key` is this attempt's Idempotency-Key and `command_id` is the basket's
 * permanent identity. The two have different jobs and the recovery rules fall
 * out of that: replaying the *same* key asks "what did you answer?", while
 * `command_id` is what guarantees the answer describes one sale and not two.
 *
 * A new attempt may therefore change the payload — add a correction — only
 * after a *definite* refusal, which rolled everything back. While an outcome
 * is unknown the payload is frozen: if that attempt did commit, a different
 * payload under the same `command_id` is a fingerprint conflict, and the
 * seller would be stuck holding a sale they cannot see.
 */
export interface SaleAttempt {
  key: string;
  body: SaleBody;
  saleId?: string;
  /**
   * Nothing in the basket was on the shelf, so this attempt records an empty
   * shelf under the basket's `command_id` instead of selling (owner decision,
   * 2026-10-01; Q-G). Every line then carries a «0 present» report.
   */
  emptyShelf?: boolean;
  shelfId?: string;
  acknowledged?: boolean;
  ambiguous?: boolean;
  /**
   * When it was first written down, by the phone's clock, kept on every
   * resend: the banner's «Чекає відповіді сервера з 14:20» (ADR-0013 §4.4).
   * Beside the body, never in it: what is sent stays byte for byte the same.
   * Absent from an attempt kept before it was written.
   */
  since?: string;
  /** Its checks' «not found» in a row, kept beside it across reopening
   * (owner decision, 2026-10-21; `@/shared/journal`). */
  misses?: number;
}

export type Outcome =
  | { kind: "sold"; sale: Sale }
  | { kind: "nothing-sold"; shelf: EmptyShelf }
  | { kind: "refused"; error: ApiError; shortfall: Shortfall | null }
  | { kind: "unknown" };

interface SaleCommandState {
  pending: SaleAttempt | null;
  busy: boolean;
  error: unknown;
  /** The kept sale's checks answered «not found» this many times in a row
   * (owner decision, 2026-10-19; `@/shared/journal`). */
  misses: number;
  set: (pending: SaleAttempt | null) => void;
}

export const useSaleCommand = create<SaleCommandState>((set) => ({
  pending: null,
  busy: false,
  error: null,
  misses: 0,
  set: (pending) => {
    set({ pending, error: null, misses: pending?.misses ?? 0 });
  },
}));

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const isUuid = new RegExp(`^${uuid}$`);
const scopeKey = new RegExp(
  `^birka:sale-pending:(${uuid}):(${uuid}):(${uuid})$`,
);

/** `least` is 0 only for «present» counts: nothing on the shelf is an answer. */
function isReports(value: unknown, lines: number, least = 1): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        Number.isInteger((entry as Report).line_index) &&
        (entry as Report).line_index >= 0 &&
        (entry as Report).line_index < lines &&
        Number.isInteger((entry as Report).quantity) &&
        (entry as Report).quantity >= least,
    )
  );
}

function isTerms(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const terms = value as CreditTerms;
  return (
    typeof terms.customer_name === "string" &&
    terms.customer_name.trim() !== "" &&
    typeof terms.customer_phone === "string" &&
    terms.customer_phone.trim() !== "" &&
    typeof terms.paid_now === "string" &&
    /^\d{1,10}\.\d{2}$/.test(terms.paid_now)
  );
}

/**
 * The mark of a sale typed from paper: exactly its two fields, each null or
 * what the till fills — a person's id, and the paper's time as
 * `YYYY-MM-DDTHH:MM` — and `first_days`, true, for the first days' paper.
 */
function isOutage(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const mark = value as Record<string, unknown>;
  return (
    Object.keys(mark).every((field) =>
      ["sold_by_user_id", "sold_at", "first_days"].includes(field),
    ) &&
    (mark.first_days === undefined || mark.first_days === true) &&
    (mark.sold_by_user_id === null ||
      (typeof mark.sold_by_user_id === "string" &&
        isUuid.test(mark.sold_by_user_id))) &&
    (mark.sold_at === null ||
      (typeof mark.sold_at === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(mark.sold_at)))
  );
}

/** Storage is untrusted, whatever TypeScript has been told about it. */
function validateAttempt(key: string, value: unknown): SaleAttempt {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid saved sale");
  const attempt = value as SaleAttempt;
  const scope = scopeKey.exec(key);
  const body: unknown = attempt.body;
  const lines: unknown = (body as SaleBody | undefined)?.lines;
  if (
    !scope ||
    typeof attempt.key !== "string" ||
    !isUuid.test(attempt.key) ||
    typeof body !== "object" ||
    body === null ||
    typeof (body as SaleBody).command_id !== "string" ||
    !isUuid.test((body as SaleBody).command_id) ||
    (body as SaleBody).store_id !== scope[3] ||
    !Array.isArray(lines) ||
    lines.length === 0 ||
    !isReports((body as SaleBody).found_in_store, lines.length) ||
    !isReports((body as SaleBody).missing_in_store, lines.length, 0) ||
    ((body as SaleBody).size_clarified !== undefined &&
      !isReports((body as SaleBody).size_clarified, lines.length)) ||
    ((body as SaleBody).credit !== undefined &&
      !isTerms((body as SaleBody).credit)) ||
    ((body as SaleBody).payment_method !== undefined &&
      !isTillMethod((body as SaleBody).payment_method)) ||
    ((body as SaleBody).outage !== undefined &&
      !isOutage((body as SaleBody).outage)) ||
    !isSince(attempt.since) ||
    (attempt.acknowledged !== undefined &&
      typeof attempt.acknowledged !== "boolean") ||
    (attempt.ambiguous !== undefined &&
      typeof attempt.ambiguous !== "boolean") ||
    (attempt.saleId !== undefined &&
      (typeof attempt.saleId !== "string" || !isUuid.test(attempt.saleId))) ||
    (attempt.shelfId !== undefined &&
      (typeof attempt.shelfId !== "string" || !isUuid.test(attempt.shelfId))) ||
    (attempt.emptyShelf !== undefined &&
      typeof attempt.emptyShelf !== "boolean") ||
    (attempt.emptyShelf === true &&
      !lines.every((_, index) =>
        (body as SaleBody).missing_in_store.some(
          (report) => report.line_index === index && report.quantity === 0,
        ),
      )) ||
    (attempt.acknowledged === true &&
      typeof (attempt.emptyShelf ? attempt.shelfId : attempt.saleId) !==
        "string")
  ) {
    throw new Error("Некоректний збережений продаж. Зверніться до менеджера.");
  }
  return { ...attempt, misses: countOf(attempt.misses) };
}

/**
 * What a kept sale was sent for, as its banner says it (redesign P1-4): each
 * line at its price, a line answered «на місці лише N» at N; or, paid in
 * parts, the part paid now. The attempt's own figures, never the server's
 * total: nobody knows yet whether it was recorded. Null when a price does
 * not read as money.
 */
export function attemptSum(body: SaleBody): {
  sum: string | null;
  inParts: boolean;
} {
  // Read from storage, whatever TypeScript was told: a field that does not
  // read gives no sum, and never breaks the banner (review, 2026-10-16).
  const read = (value: unknown): bigint | null =>
    typeof value === "string" ? kopecks(value) : null;
  const count = (value: unknown): number | null =>
    Number.isInteger(value) && (value as number) >= 0
      ? (value as number)
      : null;
  if (body.credit) {
    const paid = read(body.credit.paid_now);
    return { sum: paid === null ? null : decimal(paid), inParts: true };
  }
  const reports: unknown = body.missing_in_store;
  let total = 0n;
  for (const [index, line] of body.lines.entries()) {
    const price = read(line.unit_price);
    const discount = read(line.discount_amount);
    const asked = count(line.quantity);
    if (
      price === null ||
      discount === null ||
      asked === null ||
      discount > price
    )
      return { sum: null, inParts: false };
    const report = Array.isArray(reports)
      ? (reports as { line_index?: unknown; quantity?: unknown }[]).find(
          (entry) => entry.line_index === index,
        )
      : undefined;
    const present = report === undefined ? asked : count(report.quantity);
    if (present === null) return { sum: null, inParts: false };
    total += (price - discount) * BigInt(present);
  }
  return { sum: decimal(total), inParts: false };
}

export function loadSale(key: string): SaleAttempt | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const attempt = validateAttempt(key, JSON.parse(raw));
  // Anything found on disk was sent, or may have been: the page could have
  // died between writing it down and hearing back.
  const recovered = {
    ...attempt,
    ambiguous: !attempt.acknowledged || Boolean(attempt.ambiguous),
  };
  localStorage.setItem(key, JSON.stringify(recovered));
  return recovered;
}

/**
 * Send one attempt, and leave the journal in a state the seller can act on.
 *
 * A definite refusal — an authorization, validation or stock answer to an
 * attempt whose outcome was never in doubt — proves nothing was written, so
 * the journal is cleared and the basket is the seller's again. Everything
 * else leaves the attempt on disk marked ambiguous, and the only honest next
 * move is `resolve`.
 */
export async function submitSale(
  storageKey: string,
  token: string,
  attempt: SaleAttempt,
): Promise<Outcome> {
  if (useSaleCommand.getState().busy) return { kind: "unknown" };
  useSaleCommand.setState({ busy: true, error: null });
  let current = attempt;
  let previouslyAmbiguous = Boolean(current.ambiguous);
  // Whether the attempt on disk is this one (`@/shared/journal`).
  let written = false;
  try {
    current = validateAttempt(storageKey, current);
    const saved = localStorage.getItem(storageKey);
    let existing: SaleAttempt | null = null;
    if (saved) {
      existing = validateAttempt(storageKey, JSON.parse(saved));
      if (existing.body.command_id !== current.body.command_id) {
        useSaleCommand.setState({ pending: existing });
        throw new Error("Спершу завершіть збережений продаж.");
      }
      previouslyAmbiguous ||= Boolean(existing.ambiguous);
    }
    // Written down BEFORE the request, so a page that dies mid-flight still
    // knows which key to ask about. Since when is kept from the first time.
    current = {
      ...current,
      ambiguous: true,
      ...sinceOf(existing, current),
      misses: useSaleCommand.getState().misses,
    };
    useSaleCommand.setState({ pending: current });
    localStorage.setItem(storageKey, JSON.stringify(current));
    written = true;

    if (current.emptyShelf) {
      let shelf: EmptyShelf;
      if (current.acknowledged && current.shelfId) {
        shelf = await api<EmptyShelf>(
          `/shelf-shortages/${current.shelfId}`,
          token,
        );
      } else {
        // The basket's own command_id: a retry is answered with what was
        // recorded, and the basket can never also become a sale.
        shelf = await api<EmptyShelf>("/shelf-shortages", token, {
          store_id: current.body.store_id,
          command_id: current.body.command_id,
          lines: current.body.lines.map((line) => ({
            source_location_id: line.source_location_id,
            product_variant_id: line.product_variant_id,
            size_id: line.size_id,
            quantity: line.quantity,
          })),
        });
        current = { ...current, shelfId: shelf.id, acknowledged: true };
        localStorage.setItem(storageKey, JSON.stringify(current));
      }
      localStorage.removeItem(storageKey);
      useSaleCommand.setState({ pending: null, misses: 0 });
      return { kind: "nothing-sold", shelf };
    }
    let sale: Sale;
    if (current.acknowledged && current.saleId) {
      sale = await api<Sale>(`/sales/${current.saleId}`, token);
    } else {
      sale = await api<Sale>("/sales", token, current.body, current.key);
      // Record the receipt before clearing, so a storage failure here leaves
      // an attempt that knows its own sale id rather than one that does not.
      current = { ...current, saleId: sale.id, acknowledged: true };
      localStorage.setItem(storageKey, JSON.stringify(current));
    }
    localStorage.removeItem(storageKey);
    useSaleCommand.setState({ pending: null, misses: 0 });
    return { kind: "sold", sale };
  } catch (error) {
    const definite =
      (!previouslyAmbiguous || recordedNothing(error)) &&
      !current.acknowledged &&
      refusedOutright(error) &&
      error.code !== "IDEMPOTENCY_IN_PROGRESS";
    if (definite) {
      localStorage.removeItem(storageKey);
      // Handed back to the caller rather than raised globally: the till has a
      // precise answer for a shortfall, and a vague banner above it only
      // makes the screen harder to read. The store's `error` stays for the
      // failures nobody can act on locally.
      useSaleCommand.setState({ pending: null, error: null, misses: 0 });
      return {
        kind: "refused",
        error,
        shortfall:
          error.code === "INSUFFICIENT_STOCK"
            ? shortfallOf(error.details)
            : null,
      };
    }
    const misses =
      // No answer at all, or the app's own failure, says nothing of the
      // command: the count stands (review, 2026-10-20).
      !(error instanceof ApiError) || unreachable(error)
        ? useSaleCommand.getState().misses
        : error.status === 404
          ? useSaleCommand.getState().misses + 1
          : 0;
    if (written) {
      keepCount(storageKey, current, misses);
      useSaleCommand.setState({
        error,
        misses,
        pending: { ...current, misses },
      });
    } else useSaleCommand.setState({ error, misses });
    return { kind: "unknown" };
  } finally {
    useSaleCommand.setState({ busy: false });
  }
}

/**
 * Settle an attempt whose outcome nobody knows, without changing its payload.
 *
 * Resending the identical body under the identical key either replays the
 * receipt that was stored or performs a sale that never happened. Either way
 * one sale exists and the seller learns its number.
 */
export function resolve(
  storageKey: string,
  token: string,
  attempt: SaleAttempt,
): Promise<Outcome> {
  return submitSale(storageKey, token, { ...attempt, ambiguous: true });
}
