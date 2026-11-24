import { visible } from "@/shared/visible";

export interface Candidate {
  family_id: string;
  variant_id: string;
  display_name: string;
  distinction_note: string | null;
  conflicts: string[];
  /** The candidate's model, named as a model is named everywhere else
   * (audit 2026-11-22, goods P2-2); a proposal saved before the server said
   * them has none. */
  concept_name?: string | null;
  source_name?: string | null;
  business_category_name?: string | null;
  garment_type_name?: string | null;
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
    /** `code` is the size's one spelling; `typed`, how it was typed
     * (owner decision, 2026-10-03). Absent from creations made before. */
    sizes: { system: string; code: string; typed?: string | null }[];
    /** A merged model's name: the product is the model that stays. */
    redirected_from?: string | null;
    /** What the server made: a new model, a new colour of one, or neither
     * — that one there already, chosen. Absent from creations made before
     * (audit 2026-11-23, goods P1-1, Д1). */
    family_created?: boolean;
    variant_created?: boolean;
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
/** «Не збігається: колір, матеріал»: where what was typed says otherwise
 * than a candidate, by the server's `conflicts`; none, nothing. The same
 * line wherever candidates are offered (audit 2026-11-22, goods P1-1). */
export function conflictsText(conflicts: readonly string[]): string | null {
  return conflicts.length > 0
    ? `Не збігається: ${conflicts
        .map((f) => fieldLabels[f] ?? "ознака потребує перевірки")
        .join(", ")}`
    : null;
}
/** The model a decision ended on: the one made, or the candidate chosen. */
export function decidedName(decision: Decision): string {
  const variant = decision.resolved_variant_id;
  return (
    decision.creation?.display_name ??
    decision.preview.candidates.find((c) => c.variant_id === variant)
      ?.display_name ??
    ""
  );
}
/** What a decision did, by the server's answer, never guessed: «Модель
 * додано», «Колір додано», or «Модель обрано» when nothing new was made —
 * a candidate confirmed, or the model and colour there already (audit
 * 2026-11-23, goods P1-1). A creation saved before the server said says
 * «додано», as it did. */
export function decidedText(decision: Decision): string {
  const name = visible(decidedName(decision));
  // A model no candidate names any more (an older proposal): the word
  // alone, never «: .» (audit 2026-11-24, goods Д1).
  const tail = name ? `: ${name}.` : ".";
  const made = decision.creation;
  if (!made) return `Модель обрано${tail}`;
  if (made.family_created === false)
    return made.variant_created === true
      ? `Колір додано${tail}`
      : `Модель обрано${tail}`;
  return `Модель додано${tail}`;
}
/** What a command on «Пропозиція» came to, by the status the server read
 * after it, never by the button pressed: decided — what `decidedText`
 * says, as the sheet's; rejected; or saved and still open — a kept «Далі»
 * checked here (audit 2026-11-24, goods P1-1). */
export function outcomeText(decision: Decision): string {
  if (decision.status === "APPLIED") return decidedText(decision);
  if (decision.status === "REJECTED") return "Пропозицію відхилено.";
  return "Пропозицію збережено.";
}
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
