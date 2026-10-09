import { ApiError } from "@/shared/api";
import { visible } from "@/shared/visible";

/** Correcting the catalogue (owner decision, 2026-10-03; ADR-0008). */
export type ModelStatus = "ACTIVE" | "NEEDS_REVIEW" | "RETIRED" | "MERGED";

export interface ModelItem {
  product_variant_id: string;
  display_name: string;
  status: ModelStatus;
}

export interface ModelPage {
  items: ModelItem[];
  has_more: boolean;
}

export interface ModelRef {
  product_variant_id: string;
  display_name: string;
}

export interface ModelCard {
  product_variant_id: string;
  display_name: string;
  status: ModelStatus;
  merged_into: ModelRef | null;
  product_family_id: string;
  concept: string;
  source: string | null;
  color: string | null;
  material: string | null;
  texture: string | null;
  fur: string | null;
  collar: string | null;
  length_cm: number | null;
  business_category: string | null;
  garment_type: string | null;
  distinction_note: string | null;
  /** Whether this person may merge: the right in every store. */
  may_merge: boolean;
}

export interface Correction {
  correction_id: string | null;
  kind: "RENAME" | "MERGE" | "RETIRE" | "RESTORE";
  product_variant_id: string;
  into_variant_id: string | null;
  name_before: string;
  name_after: string;
  status: ModelStatus;
  details: Record<string, unknown>;
}

export interface MergeModel {
  product_variant_id: string;
  display_name: string;
  status: ModelStatus;
  shared_price: string | null;
  store_price: string | null;
}

export interface StockLine {
  location_id: string;
  location_name: string;
  size_id: string;
  size_label: string | null;
  /** Null where this person may not read that warehouse's stock. */
  quantity: number | null;
}

export interface MergePreview {
  duplicate: MergeModel;
  into: MergeModel;
  /** What would move from the duplicate. */
  stock: StockLine[];
  /** What the model that stays holds already. */
  stock_into: StockLine[];
  blockers: Blocker[];
}

export interface Blocker {
  reason: string;
  [detail: string]: unknown;
}

export const statusText: Record<ModelStatus, string> = {
  ACTIVE: "Діє",
  NEEDS_REVIEW: "Потребує перевірки",
  RETIRED: "Прибрана",
  MERGED: "Об’єднана",
};

/** The words of a model's name, as the forms and the warnings call them. */
export const wordLabels: Record<string, string> = {
  concept: "Назва моделі",
  source: "Фабрика або бренд",
  color: "Колір",
  material: "Матеріал",
  texture: "Фактура",
  fur: "Хутро",
  collar: "Комір",
};

function places(blocker: Blocker): string {
  const named = Array.isArray(blocker.locations)
    ? (blocker.locations as { name?: unknown }[])
        .map((place) => (typeof place.name === "string" ? place.name : ""))
        .filter(Boolean)
        .map(visible)
    : [];
  return named.length ? `: ${named.join(", ")}` : "";
}

/** What stops a merge, and what to finish first (owner decision, 2026-10-03). */
export function blockerText(blocker: Blocker): string {
  switch (blocker.reason) {
    case "TARGET_RETIRED":
      return "Модель, що лишається, прибрана. Спершу поверніть її.";
    case "OPEN_ORDERS":
      return `Є незавершені замовлення дубліката (${String(
        Array.isArray(blocker.order_ids) ? blocker.order_ids.length : 1,
      )}). Завершіть або скасуйте їх.`;
    case "BORROWED_ON_HAND":
      return "Є позичений товар дубліката на руках. Поверніть його постачальнику або позначте проданим у «Позиченому».";
    case "DAMAGED_IN_BIN":
      return `У «Браку» є одиниці дубліката (${String(
        typeof blocker.units === "number" ? blocker.units : 1,
      )}). Завершіть їх у «Браку».`;
    case "OPENING_LIST_WAITING":
      return "Список початкових залишків, що чекає, називає дублікат. Затвердіть або відхиліть його.";
    case "WAREHOUSE_CLOSED":
      return `Залишок дубліката лежить на закритому складі${places(blocker)}.`;
    case "STOCK_OUT_OF_REACH":
      return `Залишок дубліката лежить на складі, який цей магазин не змінює (власний склад іншого магазину або заблокований)${places(
        blocker,
      )}. Спершу перемістіть товар на спільний склад.`;
    default:
      return "Є незавершена справа з дублікатом.";
  }
}

export interface SimilarWord {
  field: string;
  typed: string;
  existing: string[];
  left_by_merge: boolean;
  models: ModelRef[];
}

/** The similar words a `CATALOG_SIMILAR` refusal names, checked. */
export function similarFrom(error: unknown): SimilarWord[] | null {
  if (!(error instanceof ApiError) || error.code !== "CATALOG_SIMILAR")
    return null;
  const similar = error.details.similar;
  if (!Array.isArray(similar)) return null;
  return similar.flatMap((item: unknown): SimilarWord[] => {
    if (typeof item !== "object" || item === null) return [];
    const word = item as Record<string, unknown>;
    if (typeof word.field !== "string" || typeof word.typed !== "string")
      return [];
    return [
      {
        field: word.field,
        typed: word.typed,
        existing: Array.isArray(word.existing)
          ? word.existing.filter((v): v is string => typeof v === "string")
          : [],
        left_by_merge: word.left_by_merge === true,
        models: Array.isArray(word.models)
          ? (word.models as unknown[]).flatMap((model): ModelRef[] =>
              typeof model === "object" &&
              model !== null &&
              typeof (model as ModelRef).product_variant_id === "string" &&
              typeof (model as ModelRef).display_name === "string"
                ? [model as ModelRef]
                : [],
            )
          : [],
      },
    ];
  });
}

/** One line per similar word: what was typed, and what is in use. */
export function similarText(word: SimilarWord): string {
  const label = wordLabels[word.field] ?? word.field;
  const typed = visible(word.typed);
  if (word.left_by_merge)
    return `${label}: «${typed}» лишилося від моделі, яку об’єднали з іншою.`;
  if (word.existing.length)
    return `${label}: «${typed}» схоже на «${word.existing.map(visible).join("», «")}», що вже є в каталозі.`;
  return `${label}: «${typed}» схоже на назву, що вже є в каталозі.`;
}
