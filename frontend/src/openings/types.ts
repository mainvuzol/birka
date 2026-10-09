import type { StoreState } from "@/orders/types";
import { visible } from "@/shared/visible";

/** `/snapshots`: a legacy stock list, reviewed line by line (ADR-0005). */
export type ListStatus = "IN_REVIEW" | "APPLIED" | "REJECTED";

/** `REMOVED`: its file was taken out of the list; kept as evidence only. */
export type LineStatus =
  "PENDING" | "NEEDS_REVIEW" | "RESOLVED" | "SKIPPED" | "REMOVED";

/** What the source line said about quantity — evidence, not the answer. */
export type QuantityState =
  "KNOWN" | "UNKNOWN_DISTRIBUTION" | "UNKNOWN_QUANTITY";

/**
 * Where the numbers in a line's answer came from. `STATED_BY_SIZE`: the
 * split a file line's text shows, each size with its count (ADR-0014 §5).
 */
export type Basis =
  | "STATED"
  | "STATED_BY_SIZE"
  | "LINE_IMPLIES_ONE"
  | "RECOUNTED"
  | "OWNER_KNOWLEDGE";

/** The kind of every price in one file: one notebook, one kind (owner). */
export type PriceKind = "SALE" | "PURCHASE";

export interface ListSummary {
  lines: number;
  pending: number;
  needs_review: number;
  resolved: number;
  skipped: number;
  allocations: number;
  units: number;
  lines_differing_from_source: number;
  lines_by_basis: Record<Basis, number>;
  units_by_basis: Record<Basis, number>;
  /** Files and hand-typed parts that count, and those removed. */
  parts: number;
  parts_removed: number;
  /** The most lines that count, and the most answers, one list takes. */
  limits: { lines: number; allocations: number };
}

export interface StockList {
  snapshot_id: string;
  command_id: string;
  /** The store that keeps the list: a shared warehouse's is seen from both. */
  store_id: string;
  store_name: string | null;
  /** Whether that store trades. While it does not, the list is only
   * rejected, through the other store (owner decision, 2026-10-09). */
  store_state: StoreState;
  location_id: string;
  status: ListStatus;
  source_document_ref: string | null;
  captured_at: string | null;
  /** What an approval names, so it approves exactly what was looked at. */
  review_revision: number;
  created_at: string;
  rejection_reason: string | null;
  decided_at: string | null;
  summary: ListSummary;
  ready_to_approve: boolean;
  application: { units: number; allocations: number } | null;
}

export interface Allocation {
  product_variant_id: string;
  display_name: string | null;
  size_id: string;
  size_code: string | null;
  quantity: number;
}

export interface ListLine {
  line_no: number;
  raw_text: string | null;
  /** How many lines of the list read exactly the same, this one included. */
  same_text_lines: number;
  status: LineStatus;
  quantity_state: QuantityState;
  quantity_total: number | null;
  /** The server's own rule for whether "one piece" may answer it. */
  may_imply_one: boolean;
  review_reasons: string[];
  /** The parser's reading, field by field: `size: ["S", "M"]`. */
  candidates: Record<string, string[]>;
  quantity_basis: Basis | null;
  allocations: Allocation[];
  resolution_note: string | null;
  /** The part the line came in, and for a line from a file: where it was
   * written, and what the parser read of it — a hint (ADR-0014 §6). */
  part_id: string;
  part_no: number;
  photo_name: string | null;
  photo_line: number | null;
  reading: Reading | null;
  price_kind: PriceKind | null;
  file_reasons: string[];
  /** The split the text shows, each size with its count; `size_id` is null
   * when the catalogue lacks that size. What `STATED_BY_SIZE` answers. */
  shown_split: ShownSize[] | null;
  /** Lines that count naming this photo and line, this one included. */
  same_photo_lines: number;
}

/** What the parser read of a line, exactly as the file said it. */
export interface Reading {
  model: string | null;
  colours: string[] | null;
  sizes: string[] | null;
  size_counts: { size: string; count: number }[] | null;
  count: number | null;
  price: string | null;
  note: string | null;
}

export interface ShownSize {
  size: string;
  count: number;
  size_id: string | null;
  /** The record as the line's text writes it: «42-44». */
  written: string | null;
  /** The record may also be a range of sizes: the person says which before
   * the split is taken as it is (owner decision, 2026-10-09). */
  may_be_range: boolean;
}

/** What a person said a record that may be a range of sizes means. */
export type SplitReading = "SIZE_WITH_COUNT" | "RANGE";

/** One file of a list, or one hand-typed part (ADR-0014 §2). */
export interface StockPart {
  part_id: string;
  part_no: number;
  kind: "FILE" | "PASTED";
  file_name: string | null;
  source: string | null;
  counted_on: string | null;
  price_kind: PriceKind | null;
  parser: string | null;
  format_version: number | null;
  lines: number;
  first_line_no: number;
  last_line_no: number;
  added_by_user_id: string | null;
  added_by_name: string | null;
  added_at: string;
  removed_by_user_id: string | null;
  removed_by_name: string | null;
  removed_at: string | null;
  progress: {
    pending: number;
    needs_review: number;
    resolved: number;
    skipped: number;
  };
  /** Its lines whose photo and line another part of the list names too. */
  photo_lines_elsewhere: number;
}

export const listStatusLabels: Record<ListStatus, string> = {
  IN_REVIEW: "Перевіряється",
  APPLIED: "Затверджено",
  REJECTED: "Відхилено",
};

export const lineStatusLabels: Record<LineStatus, string> = {
  NEEDS_REVIEW: "Потребує уваги",
  PENDING: "Чекає",
  RESOLVED: "Розібрано",
  SKIPPED: "Не товар",
  REMOVED: "Прибрано",
};

export const basisLabels: Record<Basis, string> = {
  STATED: "Як у списку",
  STATED_BY_SIZE: "Як у рядку, по розмірах",
  LINE_IMPLIES_ONE: "Рядок без кількості — одна штука",
  RECOUNTED: "Перелічили",
  OWNER_KNOWLEDGE: "Відомо інакше",
};

export const priceKindLabels: Record<PriceKind, string> = {
  SALE: "продажна",
  PURCHASE: "закупівельна",
};

/**
 * Why a line from a file needs a person's eye, beyond what Birka's own
 * reading says (ADR-0014 §4). The parser's count is a hint: the person states
 * the count, and says where it is known from.
 */
export const fileReasonLabels: Record<string, string> = {
  FILE_COUNT_HINT:
    "Парсер прочитав кількість, але в рядку вона не написана зі «шт» — це лише підказка. Вкажіть кількість і звідки вона відома.",
  FILE_COUNT_DIFFERS:
    "Рядок каже про кількість інакше, ніж парсер. Подивіться фото й вкажіть, звідки відома кількість.",
  FILE_SPLIT_NOT_IN_TEXT:
    "Парсер прочитав кількість по розмірах, але рядок показує її не так або не лише її — одним натиском її не підтвердити. Вкажіть, звідки відома кількість.",
};

/** «M × 1, L × 2»: sizes, each with its count. */
export function sizesWithCounts(
  pairs: readonly { size: string; count: number }[],
): string {
  return pairs.map((pair) => `${pair.size} × ${String(pair.count)}`).join(", ");
}

/** What the list itself says about a line's quantity. */
export function sourceQuantity(line: ListLine): string {
  // Each size beside its count, as Birka found it in the text (ADR-0014 §5).
  if (line.shown_split !== null && line.shown_split.length > 0)
    return `у рядку по розмірах: ${sizesWithCounts(line.shown_split)}`;
  if (line.quantity_state === "KNOWN")
    return `у списку: ${String(line.quantity_total)} шт`;
  if (line.quantity_state === "UNKNOWN_DISTRIBUTION")
    return line.quantity_total === null
      ? "у списку кілька розмірів чи кольорів, без поділу"
      : `у списку: ${String(line.quantity_total)} шт, але не сказано, скільки якого розміру чи кольору`;
  return "кількість у списку не вказана";
}

/** A count as a person reads it: «5 000». */
export function number(count: number): string {
  return count.toLocaleString("uk-UA");
}

/** The noun for a count: «1 раз», «2 рази», «5 разів», «21 раз». */
export function plural(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const tens = count % 100;
  const units = count % 10;
  if (units === 1 && tens !== 11) return one;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

/** «3 рази»: how many times a line stands in the list. */
export function times(count: number): string {
  return `${number(count)} ${plural(count, "раз", "рази", "разів")}`;
}

/**
 * The store that started the list may no longer receive goods into its
 * warehouse (`LIST_STORE_CANNOT_RECEIVE`): the list is only rejected, from
 * either store (review, 2026-10-09). The page learns it from the refusal.
 */
export function cannotReceiveText(list: StockList): string {
  return `Магазин «${visible(list.store_name ?? "—")}», що почав цей список, більше не може приймати товар на цей склад: список можна лише відхилити.`;
}
