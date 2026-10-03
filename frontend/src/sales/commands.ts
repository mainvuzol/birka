import { create } from "zustand";
import { api, ApiError, recordedNothing } from "@/shared/api";
import type {
  CreditTerms,
  EmptyShelf,
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
  set: (pending: SaleAttempt | null) => void;
}

export const useSaleCommand = create<SaleCommandState>((set) => ({
  pending: null,
  busy: false,
  error: null,
  set: (pending) => {
    set({ pending, error: null });
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
  return attempt;
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
  try {
    current = validateAttempt(storageKey, current);
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const existing = validateAttempt(storageKey, JSON.parse(saved));
      if (existing.body.command_id !== current.body.command_id) {
        useSaleCommand.setState({ pending: existing });
        throw new Error("Спершу завершіть збережений продаж.");
      }
      previouslyAmbiguous ||= Boolean(existing.ambiguous);
    }
    // Written down BEFORE the request, so a page that dies mid-flight still
    // knows which key to ask about.
    current = { ...current, ambiguous: true };
    useSaleCommand.setState({ pending: current });
    localStorage.setItem(storageKey, JSON.stringify(current));

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
      useSaleCommand.setState({ pending: null });
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
    useSaleCommand.setState({ pending: null });
    return { kind: "sold", sale };
  } catch (error) {
    const definite =
      (!previouslyAmbiguous || recordedNothing(error)) &&
      !current.acknowledged &&
      error instanceof ApiError &&
      error.code !== "IDEMPOTENCY_IN_PROGRESS" &&
      [400, 403, 404, 409, 422].includes(error.status);
    if (definite) {
      localStorage.removeItem(storageKey);
      // Handed back to the caller rather than raised globally: the till has a
      // precise answer for a shortfall, and a vague banner above it only
      // makes the screen harder to read. The store's `error` stays for the
      // failures nobody can act on locally.
      useSaleCommand.setState({ pending: null, error: null });
      return {
        kind: "refused",
        error,
        shortfall:
          error.code === "INSUFFICIENT_STOCK"
            ? shortfallOf(error.details)
            : null,
      };
    }
    useSaleCommand.setState({ error });
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
