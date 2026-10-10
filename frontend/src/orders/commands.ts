import { create } from "zustand";
import { api, recordedNothing, refusedOutright } from "@/shared/api";
import { isSince, sinceOf } from "@/shared/reach";
import type { Order } from "./types";
export interface Pending {
  path: string;
  body: Record<string, unknown>;
  label: string;
  orderId?: string;
  acknowledged?: boolean;
  ambiguous?: boolean;
  /**
   * When it was first written down, by the phone's clock, kept on every
   * resend: the banner's «Чекає відповіді сервера з 14:20» (ADR-0013 §4.4).
   * Beside the body, never in it. Absent from a command kept before it was
   * written.
   */
  since?: string;
}
interface CommandState {
  pending: Pending | null;
  busy: boolean;
  error: unknown;
  set: (pending: Pending | null) => void;
}
export const useCommand = create<CommandState>((set) => ({
  pending: null,
  busy: false,
  error: null,
  set: (pending) => {
    set({ pending, error: null });
  },
}));
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const commandPath = new RegExp(
  `^/orders(?:/(${uuid})/(?:dispatch|arrive|collect|cancel|return|shipping))?$`,
);
const scopeKey = new RegExp(`^birka:pending:(${uuid}):(${uuid}):(${uuid})$`);
function validatePending(key: string, value: unknown): Pending {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid saved command");
  const pending = value as Pending;
  const scope = scopeKey.exec(key);
  const path =
    typeof pending.path === "string" ? commandPath.exec(pending.path) : null;
  // Runtime storage data is untrusted despite the TypeScript assertion.
  if (
    !scope ||
    !path ||
    typeof pending.body !== "object" ||
    // Stored JSON may violate the declared type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    pending.body === null ||
    typeof pending.body.command_id !== "string" ||
    !new RegExp(`^${uuid}$`).test(pending.body.command_id) ||
    typeof pending.label !== "string" ||
    (pending.path === "/orders" && pending.body.store_id !== scope[3]) ||
    (path[1] !== undefined && pending.orderId !== path[1]) ||
    (pending.acknowledged !== undefined &&
      typeof pending.acknowledged !== "boolean") ||
    (pending.ambiguous !== undefined &&
      typeof pending.ambiguous !== "boolean") ||
    !isSince(pending.since) ||
    (pending.acknowledged &&
      (typeof pending.orderId !== "string" ||
        !new RegExp(`^${uuid}$`).test(pending.orderId)))
  ) {
    throw new Error("Некоректна збережена команда. Зверніться до менеджера.");
  }
  return pending;
}
export function loadPending(key: string): Pending | null {
  // Upgrade the initial session-only journal without losing an uncertain command.
  const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
  if (!raw) return null;
  const pending = validatePending(key, JSON.parse(raw));
  const recovered = {
    ...pending,
    ambiguous: !pending.acknowledged || Boolean(pending.ambiguous),
  };
  localStorage.setItem(key, JSON.stringify(recovered));
  sessionStorage.removeItem(key);
  return recovered;
}
export async function submitPending(
  key: string,
  token: string,
  pending: Pending,
): Promise<Order | null> {
  if (useCommand.getState().busy) return null;
  useCommand.setState({ busy: true, error: null });
  let current = pending;
  let previouslyAmbiguous = Boolean(current.ambiguous);
  try {
    current = validatePending(key, current);
    const saved = localStorage.getItem(key);
    let existing: Pending | null = null;
    if (saved) {
      existing = validatePending(key, JSON.parse(saved));
      if (existing.body.command_id !== current.body.command_id) {
        useCommand.setState({ pending: existing });
        throw new Error("Спершу перевірте збережену операцію.");
      }
      previouslyAmbiguous ||= Boolean(existing.ambiguous);
    }
    // Persist uncertainty BEFORE sending, including page closure during fetch.
    // Since when is kept from the first time.
    current = { ...current, ambiguous: true, ...sinceOf(existing, current) };
    useCommand.setState({ pending: current });
    localStorage.setItem(key, JSON.stringify(current));
    if (!current.acknowledged) {
      const response = await api<Order>(current.path, token, current.body);
      current = {
        ...current,
        orderId: response.id,
        acknowledged: true,
        ambiguous: false,
      };
      localStorage.setItem(key, JSON.stringify(current));
      useCommand.setState({ pending: current });
    }
    const latest = await api<Order>(`/orders/${current.orderId ?? ""}`, token);
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    useCommand.setState({ pending: null });
    return latest;
  } catch (error) {
    // Later authorization/validation failures precede durable replay lookup;
    // unlike a first-attempt rejection, they cannot disprove an earlier commit.
    if (
      (!previouslyAmbiguous || recordedNothing(error)) &&
      !current.acknowledged &&
      refusedOutright(error)
    ) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      useCommand.setState({ pending: null });
    }
    useCommand.setState({ error });
    return null;
  } finally {
    useCommand.setState({ busy: false });
  }
}
