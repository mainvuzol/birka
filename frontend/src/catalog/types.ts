export interface Candidate {
  family_id: string;
  variant_id: string;
  display_name: string;
  distinction_note: string | null;
  conflicts: string[];
}
export interface Decision {
  decision_id: string;
  store_id: string;
  status: "PENDING" | "NEEDS_REVIEW" | "APPLIED" | "REJECTED";
  knowledge_revision: number;
  resolved_variant_id: string | null;
  preview: {
    raw_text: string;
    candidates: Candidate[];
    review_reasons: string[];
    truncated: boolean;
  };
  rejection: { reason: string } | null;
  creation: {
    display_name: string;
    sizes: { system: string; code: string }[];
    /** A merged model's name: the product is the model that stays. */
    redirected_from?: string | null;
  } | null;
}
export const statusLabels: Record<Decision["status"], string> = {
  PENDING: "Очікує перевірки",
  NEEDS_REVIEW: "Потребує перевірки",
  APPLIED: "Підтверджено",
  REJECTED: "Відхилено",
};
export const fieldLabels: Record<string, string> = {
  color: "колір",
  material: "матеріал",
  texture: "фактура",
  fur: "хутро",
  collar: "комір",
  garment_type: "тип виробу",
  length_cm: "довжина",
  hood: "капюшон",
  pockets: "кишені",
  concept_context: "модель",
  category_context: "категорія",
  ENTITY_NEEDS_REVIEW: "стан товару потребує перевірки",
};
export function reviewText(reason: string): string {
  const labels: Record<string, string> = {
    HUMAN_CONFIRMATION_REQUIRED: "Остаточний вибір робить людина.",
    UNCLASSIFIED_DESCRIPTORS:
      "Частину опису не вдалося розпізнати; перевірте оригінал.",
    NO_RECOGNIZED_FIELDS: "У тексті не знайдено відомих ознак.",
    CANDIDATE_POOL_TRUNCATED:
      "Показано обмежену вибірку; вона може не містити потрібний товар.",
    CONFLICTING_OR_MULTIPLE_EXACT_CANDIDATES:
      "Кілька товарів мають схожі назви або суперечливі ознаки.",
    STRUCTURED_CONFLICTS_PRESENT:
      "Деякі ознаки опису відрізняються від товарів у каталозі.",
    IDENTITY_NOT_ESTABLISHED: "Не вдалося однозначно визначити товар.",
  };
  return (
    labels[reason] ??
    "Опис містить неоднозначність, яку потрібно перевірити вручну."
  );
}
