import type { ValidationIssue } from "@/shared/api";

/**
 * A parser's file refused by the server, in a person's words (ADR-0014 §15):
 * which line of the file, and what is wrong in it.
 *
 * The server reads the file the way the format says (`birka.stock-list`,
 * `backend/app/modules/snapshots/stock_file.py`) and names each refusal's
 * line, 1-based, as `ctx.line`; a refusal outside the lines names none. The
 * person fixes the file, or asks whoever made it to.
 */

/** A refusal of the file itself, not of the request around it. */
export function isFileIssue(issue: ValidationIssue): boolean {
  return issue.loc[0] === "body" && issue.loc[1] === "file";
}

const fieldNames: Record<string, string> = {
  text: "текст",
  photo: "фото",
  photo_line: "номер рядка на фото",
  count: "кількість",
  size_counts: "кількість по розмірах",
  sizes: "розміри",
  colours: "кольори",
  price: "ціна",
  note: "примітка",
  model: "модель",
  source: "звідки",
  counted_on: "коли перелічено",
  price_kind: "вид цін",
  parser: "парсер",
  format: "формат",
  version: "версія формату",
  lines: "рядки",
};

const typeTexts: Record<string, string> = {
  missing: "немає",
  extra_forbidden: "невідоме поле",
  int_type: "має бути цілим числом",
  string_type: "має бути текстом",
  string_too_short: "порожнє",
  too_short: "порожнє",
  string_too_long: "задовге",
  too_long: "задовге",
  greater_than_equal: "поза межами",
  less_than_equal: "поза межами",
  literal_error: "недопустиме значення",
  list_type: "має бути списком",
  model_type: "має бути об’єктом",
  dict_type: "має бути об’єктом",
};

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

/**
 * Where the refusal stands in the file: the line, 1-based, and the key the
 * line (or the file, outside its lines) was refused for.
 */
function place(issue: ValidationIssue): {
  line: number | null;
  key: string | null;
} {
  // After `body`, `file`: either `lines`, the line's index and its key, or a
  // key of the file itself.
  const rest = issue.loc.slice(2);
  const atLines = rest[0] === "lines" && typeof rest[1] === "number";
  const stated = issue.ctx.line;
  const line =
    typeof stated === "number" && Number.isInteger(stated)
      ? stated
      : atLines
        ? Number(rest[1]) + 1
        : null;
  const keys = (atLines ? rest.slice(2) : rest).filter(
    (part): part is string => typeof part === "string",
  );
  return { line, key: keys[0] ?? null };
}

function fieldName(key: string | null): string {
  if (key === null) return "рядок";
  return fieldNames[key] ?? `«${key}»`;
}

/** One refusal of a file, as one sentence. */
export function fileProblemText(issue: ValidationIssue): string {
  const { line, key } = place(issue);
  const where = line === null ? "Файл" : `Рядок ${String(line)} файлу`;
  switch (issue.type) {
    case "stock_file_text_blank":
      return `${where}: текст порожній.`;
    case "stock_file_control_character":
      return `${where}: у полі «${fieldName(text(issue.ctx.field) || key)}» є службовий символ (перенесення рядка чи табуляція).`;
    case "stock_file_photo_line_repeated":
      return `${where}: те саме фото й рядок, що в рядку ${text(issue.ctx.first_line)}.`;
    case "stock_file_sizes_and_size_counts":
      return `${where}: або розміри, або кількість по розмірах — не обидва.`;
    case "stock_file_size_repeated":
      return `${where}: розмір «${text(issue.ctx.size)}» двічі.`;
    case "stock_file_duplicate_key":
      return `${where}: ключ «${text(issue.ctx.key)}» повторюється.`;
    case "stock_file_text_too_long_in_all":
      return `У файлі забагато тексту: не більше ${text(issue.ctx.limit)} символів.`;
    case "stock_file_too_large":
      return "Файл завеликий — розділіть його на два.";
  }
  const said = typeTexts[issue.type] ?? "не відповідає формату";
  // An unknown key is named as written: it is not a field of the format.
  const field =
    issue.type === "extra_forbidden" && key !== null
      ? `«${key}»`
      : fieldName(key);
  return `${where}: ${field} — ${said}.`;
}

/** The most a screen lists; the rest are counted. */
const SHOWN = 10;

/** Every refusal of a file, one per line, at most ten and how many more. */
export function fileProblemTexts(issues: ValidationIssue[]): string[] {
  const texts = issues.filter(isFileIssue).map(fileProblemText);
  return limited(texts);
}

/** At most ten problems, and «…і ще {k}» for the rest. */
export function limited(texts: string[]): string[] {
  return texts.length > SHOWN
    ? [...texts.slice(0, SHOWN), `…і ще ${String(texts.length - SHOWN)}`]
    : texts;
}
