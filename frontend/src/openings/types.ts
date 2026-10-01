/** `/snapshots`: a legacy stock list, reviewed line by line (ADR-0005). */
export type ListStatus = "IN_REVIEW" | "APPLIED" | "REJECTED";

export type LineStatus = "PENDING" | "NEEDS_REVIEW" | "RESOLVED" | "SKIPPED";

/** What the source line said about quantity — evidence, not the answer. */
export type QuantityState =
  "KNOWN" | "UNKNOWN_DISTRIBUTION" | "UNKNOWN_QUANTITY";

/** Where the numbers in a line's answer came from. */
export type Basis =
  "STATED" | "LINE_IMPLIES_ONE" | "RECOUNTED" | "OWNER_KNOWLEDGE";

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
}

export interface StockList {
  snapshot_id: string;
  command_id: string;
  store_id: string;
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
  application: { units: number } | null;
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
};

export const basisLabels: Record<Basis, string> = {
  STATED: "Як у списку",
  LINE_IMPLIES_ONE: "Рядок без кількості — одна штука",
  RECOUNTED: "Перелічили",
  OWNER_KNOWLEDGE: "Відомо інакше",
};

/** What the list itself says about a line's quantity. */
export function sourceQuantity(line: ListLine): string {
  if (line.quantity_state === "KNOWN")
    return `у списку: ${String(line.quantity_total)} шт`;
  if (line.quantity_state === "UNKNOWN_DISTRIBUTION")
    return line.quantity_total === null
      ? "у списку кілька розмірів чи кольорів, без поділу"
      : `у списку: ${String(line.quantity_total)} шт, але не сказано, скільки якого розміру чи кольору`;
  return "кількість у списку не вказана";
}
