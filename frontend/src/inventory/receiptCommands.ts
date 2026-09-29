import { create } from "zustand";
import { api, ApiError } from "@/shared/api";
import type { Receipt, ReceiptBody } from "./receiptTypes";

/**
 * One delivery, written down before it is sent.
 *
 * The same protocol as the till's journal (`@/sales/commands`), and simpler
 * for one reason: since `0016` a receipt carries a permanent `command_id`
 * (ADR-0006), so resending the identical attempt returns the original receipt
 * however late it arrives — even after the 7-day cache is gone. There is no
 * read-back path to maintain: resending *is* the recovery.
 *
 * Before `0016` this journal would have been dangerous. A delivery replayed
 * from here after a week away would have been received twice.
 */
export interface ReceiptAttempt {
  key: string;
  body: ReceiptBody;
  ambiguous?: boolean;
}

export type ReceiptOutcome =
  | { kind: "received"; receipt: Receipt }
  | { kind: "refused"; error: ApiError }
  | { kind: "unknown" };

interface ReceiptCommandState {
  pending: ReceiptAttempt | null;
  busy: boolean;
  error: unknown;
}

export const useReceiptCommand = create<ReceiptCommandState>(() => ({
  pending: null,
  busy: false,
  error: null,
}));

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const isUuid = new RegExp(`^${uuid}$`);
const scopeKey = new RegExp(
  `^birka:receipt-pending:(${uuid}):(${uuid}):(${uuid})$`,
);
const acquisitions = new Set(["PURCHASE", "CONSIGNMENT", "BORROWED"]);
const money = /^\d{1,10}\.\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isId(value: unknown): boolean {
  return typeof value === "string" && isUuid.test(value);
}

function isLine(value: unknown): boolean {
  return (
    isRecord(value) &&
    isId(value.product_variant_id) &&
    isId(value.size_id) &&
    typeof value.quantity === "number" &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0 &&
    typeof value.acquisition_type === "string" &&
    acquisitions.has(value.acquisition_type) &&
    (value.unit_cost === null ||
      (typeof value.unit_cost === "string" && money.test(value.unit_cost)))
  );
}

/** Storage is untrusted, whatever TypeScript has been told about it. */
function validateAttempt(key: string, value: unknown): ReceiptAttempt {
  const scope = scopeKey.exec(key);
  const body = isRecord(value) ? value.body : undefined;
  if (
    !scope ||
    !isRecord(value) ||
    !isId(value.key) ||
    (value.ambiguous !== undefined && typeof value.ambiguous !== "boolean") ||
    !isRecord(body) ||
    body.store_id !== scope[3] ||
    !isId(body.location_id) ||
    !isId(body.command_id) ||
    (body.notes !== null && typeof body.notes !== "string") ||
    !Array.isArray(body.lines) ||
    body.lines.length === 0 ||
    !body.lines.every(isLine)
  ) {
    throw new Error("Некоректне збережене приймання. Зверніться до менеджера.");
  }
  // Every field the type promises has been checked above.
  return value as unknown as ReceiptAttempt;
}

export function loadReceipt(key: string): ReceiptAttempt | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  // Anything found on disk was sent, or may have been.
  const attempt = { ...validateAttempt(key, JSON.parse(raw)), ambiguous: true };
  localStorage.setItem(key, JSON.stringify(attempt));
  return attempt;
}

/**
 * Send one delivery, leaving the journal in a state the seller can act on.
 *
 * A definite refusal to an attempt that was never in doubt proves nothing was
 * written, so the journal is cleared and the list is the seller's again.
 * Anything else keeps the attempt on disk, marked ambiguous, and blocks the
 * app until the identical attempt is resent.
 */
export async function submitReceipt(
  storageKey: string,
  token: string,
  attempt: ReceiptAttempt,
): Promise<ReceiptOutcome> {
  if (useReceiptCommand.getState().busy) return { kind: "unknown" };
  useReceiptCommand.setState({ busy: true, error: null });
  let current = attempt;
  let previouslyAmbiguous = Boolean(current.ambiguous);
  try {
    current = validateAttempt(storageKey, current);
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const existing = validateAttempt(storageKey, JSON.parse(saved));
      if (existing.body.command_id !== current.body.command_id) {
        useReceiptCommand.setState({ pending: existing });
        throw new Error("Спершу завершіть збережене приймання.");
      }
      previouslyAmbiguous ||= Boolean(existing.ambiguous);
    }
    // Written down BEFORE the request, so a page that dies mid-flight still
    // knows which delivery to ask about.
    current = { ...current, ambiguous: true };
    useReceiptCommand.setState({ pending: current });
    localStorage.setItem(storageKey, JSON.stringify(current));
    const receipt = await api<Receipt>(
      "/inventory/receipts",
      token,
      current.body,
      current.key,
    );
    localStorage.removeItem(storageKey);
    useReceiptCommand.setState({ pending: null });
    return { kind: "received", receipt };
  } catch (error) {
    const definite =
      !previouslyAmbiguous &&
      error instanceof ApiError &&
      error.code !== "IDEMPOTENCY_IN_PROGRESS" &&
      [400, 403, 404, 409, 422].includes(error.status);
    if (definite) {
      localStorage.removeItem(storageKey);
      useReceiptCommand.setState({ pending: null, error: null });
      return { kind: "refused", error };
    }
    useReceiptCommand.setState({ error });
    return { kind: "unknown" };
  } finally {
    useReceiptCommand.setState({ busy: false });
  }
}

/** Settle a delivery nobody knows the outcome of, without changing it. */
export function resolveReceipt(
  storageKey: string,
  token: string,
  attempt: ReceiptAttempt,
): Promise<ReceiptOutcome> {
  return submitReceipt(storageKey, token, { ...attempt, ambiguous: true });
}
