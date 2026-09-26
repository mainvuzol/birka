import { create } from "zustand";
import { api, ApiError } from "@/shared/api";
import type { Decision } from "./types";
export interface Command {
  path: string;
  body: Record<string, unknown>;
  decisionId: string;
  ambiguous?: boolean;
}
interface State {
  pending: Command | null;
  busy: boolean;
  error: unknown;
}
export const useCatalogCommand = create<State>(() => ({
  pending: null,
  busy: false,
  error: null,
}));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const base = "/catalog/match-decisions";
function valid(key: string, value: unknown): Command {
  if (!value || typeof value !== "object") throw new Error("Invalid journal");
  const scope = key.split(":");
  if (
    scope.length !== 5 ||
    scope[0] !== "birka" ||
    scope[1] !== "catalog-pending" ||
    scope.slice(2).some((part) => !uuid.test(part))
  )
    throw new Error("Invalid scope");
  const c = value as Command;
  if (
    typeof c.path !== "string" ||
    typeof c.decisionId !== "string" ||
    !uuid.test(c.decisionId) ||
    typeof c.body !== "object" ||
    Array.isArray(c.body)
  )
    throw new Error("Invalid journal");
  // Storage may contain JSON null despite the declared TypeScript shape.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (c.body === null) throw new Error("Invalid journal");
  const body = c.body;
  const action =
    c.path === base
      ? "create"
      : c.path.startsWith(`${base}/${c.decisionId}/`)
        ? c.path.slice(`${base}/${c.decisionId}/`.length)
        : "";
  let keys: string[];
  if (action === "create") {
    keys = ["decision_id", "store_id", "raw_text"];
    if (
      body.decision_id !== c.decisionId ||
      body.store_id !== key.split(":").at(-1) ||
      typeof body.raw_text !== "string" ||
      !body.raw_text.trim() ||
      body.raw_text.length > 2000
    )
      throw new Error("Invalid journal");
  } else if (action === "confirm") {
    keys = ["variant_id", "expected_knowledge_revision"];
    if (
      typeof body.variant_id !== "string" ||
      !uuid.test(body.variant_id) ||
      typeof body.expected_knowledge_revision !== "number" ||
      !Number.isSafeInteger(body.expected_knowledge_revision) ||
      body.expected_knowledge_revision < 0
    )
      throw new Error("Invalid journal");
  } else if (action === "reject") {
    keys = ["reason"];
    if (
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      body.reason.length > 1000
    )
      throw new Error("Invalid journal");
  } else if (action === "alias-feedback") {
    keys = ["feedback_id", "variant_id", "event"];
    if (
      typeof body.feedback_id !== "string" ||
      !uuid.test(body.feedback_id) ||
      typeof body.variant_id !== "string" ||
      !uuid.test(body.variant_id) ||
      !["CONFIRM", "REJECT"].includes(String(body.event))
    )
      throw new Error("Invalid journal");
  } else throw new Error("Invalid journal");
  if (
    Object.keys(body).some((k) => !keys.includes(k)) ||
    (c.ambiguous !== undefined && typeof c.ambiguous !== "boolean")
  )
    throw new Error("Invalid journal");
  return c;
}
export function loadCatalogCommand(key: string): Command | null {
  const raw = localStorage.getItem(key);
  return raw ? { ...valid(key, JSON.parse(raw)), ambiguous: true } : null;
}
export async function submitCatalogCommand(
  key: string,
  token: string,
  command: Command,
): Promise<Decision | null> {
  if (useCatalogCommand.getState().busy) return null;
  useCatalogCommand.setState({ busy: true, error: null });
  let ambiguous = Boolean(command.ambiguous);
  let acknowledged = false;
  try {
    valid(key, command);
    const saved = loadCatalogCommand(key);
    if (
      saved &&
      (saved.path !== command.path ||
        JSON.stringify(saved.body) !== JSON.stringify(command.body))
    )
      throw new Error("Unfinished command");
    ambiguous ||= Boolean(saved);
    const pending = { ...command, ambiguous: true };
    localStorage.setItem(key, JSON.stringify(pending));
    useCatalogCommand.setState({ pending });
    try {
      if (command.path !== base) {
        const target = await api<Decision>(
          `${base}/${command.decisionId}`,
          token,
        );
        if (target.store_id !== key.split(":").at(-1)) {
          throw new ApiError(403, "FORBIDDEN_STORE");
        }
      }
      await api<unknown>(command.path, token, command.body);
      acknowledged = true;
    } catch (error) {
      // A terminal state can reconcile a lost response to a decision action.
      // Feedback has its own durable UUID; only replay can acknowledge it.
      if (!ambiguous || command.path.endsWith("/alias-feedback")) throw error;
      const existing = await api<Decision>(
        `${base}/${command.decisionId}`,
        token,
      );
      const matches =
        existing.store_id === key.split(":").at(-1) &&
        ((command.path === base &&
          existing.preview.raw_text === command.body.raw_text) ||
          (command.path.endsWith("/confirm") &&
            existing.status === "APPLIED" &&
            existing.resolved_variant_id === command.body.variant_id &&
            existing.knowledge_revision ===
              command.body.expected_knowledge_revision) ||
          (command.path.endsWith("/reject") &&
            existing.status === "REJECTED" &&
            existing.rejection?.reason === command.body.reason));
      if (!matches) throw error;
      acknowledged = true;
    }
    const latest = await api<Decision>(`${base}/${command.decisionId}`, token);
    if (
      latest.decision_id !== command.decisionId ||
      latest.store_id !== key.split(":").at(-1)
    ) {
      throw new Error("Unexpected decision response");
    }
    localStorage.removeItem(key);
    useCatalogCommand.setState({ pending: null });
    return latest;
  } catch (error) {
    if (
      !ambiguous &&
      !acknowledged &&
      error instanceof ApiError &&
      [400, 403, 404, 409, 422].includes(error.status)
    ) {
      localStorage.removeItem(key);
      useCatalogCommand.setState({ pending: null });
    }
    useCatalogCommand.setState({ error });
    return null;
  } finally {
    useCatalogCommand.setState({ busy: false });
  }
}
