import { isId, isRecord, journal } from "@/shared/journal";
import type { Correction } from "./modelTypes";

/**
 * One correction of the catalogue — a rename, a merge, a retirement or a
 * bringing back — written down before it is sent (`@/shared/journal`).
 *
 * Each carries a permanent `command_id` (ADR-0008 §1), so resending the
 * identical attempt answers with what the first one did, however late: a
 * merge, which cannot be undone, is never done twice.
 */
export type CorrectionBody =
  | {
      kind: "rename";
      store_id: string;
      command_id: string;
      product_variant_id: string;
      concept: string;
      source: string | null;
      variant: Record<string, string>;
      business_category: string | null;
      garment_type: string | null;
      product_family_id: string | null;
      new_model: boolean;
      distinction_note: string | null;
      similar_confirmed: boolean;
    }
  | {
      kind: "merge";
      store_id: string;
      command_id: string;
      product_variant_id: string;
      into: string;
    }
  | {
      kind: "retire" | "restore";
      store_id: string;
      command_id: string;
      product_variant_id: string;
    };

const words = ["color", "material", "texture", "fur", "collar", "length_cm"];

function text(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.trim() !== "");
}

const corrections = journal<CorrectionBody, Correction>({
  path: (body) => `/catalog/models/${body.product_variant_id}/${body.kind}`,
  payload: (body) => {
    switch (body.kind) {
      case "rename":
        return {
          store_id: body.store_id,
          command_id: body.command_id,
          concept: body.concept,
          source: body.source,
          variant: body.variant,
          business_category: body.business_category,
          garment_type: body.garment_type,
          product_family_id: body.product_family_id,
          new_model: body.new_model,
          distinction_note: body.distinction_note,
          similar_confirmed: body.similar_confirmed,
        };
      case "merge":
        return {
          store_id: body.store_id,
          command_id: body.command_id,
          into: body.into,
        };
      default:
        return { store_id: body.store_id, command_id: body.command_id };
    }
  },
  scope: "catalog-correction-pending",
  isBody: (body) =>
    isId(body.product_variant_id) &&
    ((body.kind === "rename" &&
      typeof body.concept === "string" &&
      body.concept.trim() !== "" &&
      text(body.source) &&
      isRecord(body.variant) &&
      Object.entries(body.variant).every(
        ([key, value]) => words.includes(key) && text(value),
      ) &&
      text(body.business_category) &&
      text(body.garment_type) &&
      (body.product_family_id === null || isId(body.product_family_id)) &&
      typeof body.new_model === "boolean" &&
      text(body.distinction_note) &&
      typeof body.similar_confirmed === "boolean") ||
      (body.kind === "merge" &&
        isId(body.into) &&
        body.into !== body.product_variant_id) ||
      body.kind === "retire" ||
      body.kind === "restore"),
  corrupt: "Некоректна збережена зміна каталогу. Зверніться до власника.",
  unfinished: "Спершу завершіть збережену зміну каталогу.",
});

export const useCorrectionCommand = corrections.use;
export const loadCorrectionCommand = corrections.load;
export const submitCorrectionCommand = corrections.submit;
export const resolveCorrectionCommand = corrections.resolve;
