import { create } from "zustand";
import { api, ApiError, recordedNothing } from "@/shared/api";
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
export const CANCEL_CREATION_REASON =
  "Створення скасовано користувачем після непідтвердженої відповіді";
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
  } else if (action === "create-product") {
    keys = [
      "store_id",
      "concept",
      "source",
      "business_category",
      "garment_type",
      "product_family_id",
      "new_model",
      "distinction_note",
      "variant",
      "sizes",
      // The person saw a similar name and said this is another (owner
      // decision, 2026-10-03).
      "similar_confirmed",
    ];
    const label = (v: unknown, max: number): boolean =>
      typeof v === "string" && !!v.trim() && v.length <= max;
    const family = body.product_family_id;
    if (
      body.store_id !== scope.at(-1) ||
      (family !== undefined
        ? typeof family !== "string" ||
          !uuid.test(family) ||
          [
            "concept",
            "source",
            "business_category",
            "garment_type",
            "new_model",
          ].some((k) => body[k] !== undefined)
        : !label(body.concept, 200)) ||
      ["source", "business_category", "garment_type", "distinction_note"].some(
        (k) =>
          body[k] !== undefined &&
          !label(
            body[k],
            k === "source" ? 200 : k === "distinction_note" ? 1000 : 120,
          ),
      ) ||
      (body.new_model !== undefined && typeof body.new_model !== "boolean") ||
      (body.similar_confirmed !== undefined &&
        body.similar_confirmed !== true) ||
      (body.new_model === true && !label(body.distinction_note, 1000)) ||
      !body.variant ||
      typeof body.variant !== "object" ||
      Array.isArray(body.variant) ||
      Object.entries(body.variant).some(([k, v]) =>
        k === "length_cm"
          ? typeof v !== "string" ||
            !/^\d{1,4}(\.\d)?$/.test(v) ||
            Number(v) <= 0
          : !["color", "material", "texture", "fur", "collar"].includes(k) ||
            !label(v, 120),
      ) ||
      !Array.isArray(body.sizes) ||
      body.sizes.length < 1 ||
      body.sizes.length > 50 ||
      body.sizes.some((size: unknown) => {
        if (!size || typeof size !== "object" || Array.isArray(size))
          return true;
        const row = size as Record<string, unknown>;
        return (
          Object.keys(row).some((k) => !["system", "code"].includes(k)) ||
          !["ALPHA", "NUMERIC_EU", "UNSPECIFIED"].includes(
            String(row.system),
          ) ||
          !label(row.code, 20)
        );
      })
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
      !(
        saved.path.endsWith("/create-product") &&
        saved.decisionId === command.decisionId &&
        command.path.endsWith("/reject") &&
        command.body.reason === CANCEL_CREATION_REASON
      ) &&
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
      if (
        !ambiguous ||
        command.path.endsWith("/alias-feedback") ||
        command.path.endsWith("/create-product")
      )
        throw error;
      const existing = await api<Decision>(
        `${base}/${command.decisionId}`,
        token,
      );
      const matches =
        existing.store_id === key.split(":").at(-1) &&
        ((command.path.endsWith("/reject") &&
          command.body.reason === CANCEL_CREATION_REASON &&
          ["APPLIED", "REJECTED"].includes(existing.status)) ||
          (command.path === base &&
            existing.preview.raw_text === command.body.raw_text) ||
          (command.path.endsWith("/confirm") &&
            existing.status === "APPLIED" &&
            !existing.creation &&
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
      // A refusal proving nothing was recorded settles even an attempt
      // whose outcome was unknown (ADR-0008 §9).
      (!ambiguous || recordedNothing(error)) &&
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
