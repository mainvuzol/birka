import { limited } from "./fileErrors";

/**
 * A parser's file, read on the phone before it is sent (ADR-0014 §1, §15).
 *
 * The shops photograph their notebooks, a parser outside Birka reads them
 * into a file of Birka's format, `birka.stock-list` version 1, and the app
 * takes it into a warehouse's list (owner decision, 2026-10-08). The server
 * checks every rule of the format; the phone checks first what is lost once
 * the bytes are parsed, and what would only waste a send:
 *
 * - **the bytes**, decoded as UTF-8 strictly: `file.text()` would quietly
 *   turn a bad byte into U+FFFD, and a line would be kept as it was never
 *   written. A BOM is allowed;
 * - **a repeated key, and a number written with a point or an exponent**
 *   where the format takes a whole number («3.0» is not 3): `JSON.parse`
 *   keeps the last of two keys and reads 3.0 as 3, so a scan of the text
 *   finds them before it;
 * - **the format, its version, how many lines**, and the size of what would
 *   be sent: the edge refuses a body over 1 000 000 bytes (§11).
 *
 * The file's content is never kept on the phone: a draft keeps its name and
 * its sha256, to send the same command again for the same file.
 */

/** A file larger than this is not read at all. */
export const MAX_FILE_BYTES = 4_000_000;
/** The largest request the phone sends; the edge refuses over 1 000 000. */
export const MAX_BODY_BYTES = 990_000;
export const MAX_PART_LINES = 1000;
export const FORMAT = "birka.stock-list";
export const VERSION = 1;

export const TOO_LARGE = "Файл завеликий — розділіть його на два.";

/** One written line, as the parser read it. Only `text` is evidence. */
export interface StockFileLine {
  text: string;
  photo: string;
  photo_line: number;
  model?: string;
  colours?: string[];
  sizes?: string[];
  size_counts?: { size: string; count: number }[];
  count?: number;
  price?: string;
  note?: string;
}

export interface StockFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  source?: string;
  counted_on?: string;
  price_kind?: "sale" | "purchase";
  parser?: string;
  lines: StockFileLine[];
}

/** What a person is told about a file before it is sent. */
export interface StockFileSummary {
  lines: number;
  photos: number;
  price_kind: "sale" | "purchase" | null;
  source: string | null;
  counted_on: string | null;
  /** Lines for which the parser read a count, or counts per size. */
  with_count: number;
  with_size_counts: number;
}

export type StockFileRead =
  | {
      ok: true;
      name: string;
      file: StockFile;
      summary: StockFileSummary;
      /** Of the file's bytes; null where the phone cannot compute it. */
      sha256: string | null;
    }
  | { ok: false; name: string; problems: string[] };

/** The length in bytes of a request as it is sent. */
export function bodyBytes(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/** Where a value stands in the file: its keys and indices from the top. */
type Path = (string | number)[];

/** A path's line of the file, 1-based, when it is inside `lines`. */
function lineOf(path: Path): number | null {
  return path[0] === "lines" && typeof path[1] === "number"
    ? path[1] + 1
    : null;
}

/** Whether a number at this path must be written as a whole number. */
function wholeNumberAt(path: Path): boolean {
  if (path.length === 1) return path[0] === "version";
  if (lineOf(path) === null) return false;
  if (path.length === 3) return path[2] === "photo_line" || path[2] === "count";
  return (
    path.length === 5 &&
    path[2] === "size_counts" &&
    typeof path[3] === "number" &&
    path[4] === "count"
  );
}

function where(path: Path): string {
  const line = lineOf(path);
  return line === null ? "Файл" : `Рядок ${String(line)} файлу`;
}

/** The scan gave up: the text is not JSON, and `JSON.parse` will say so. */
class Broken extends Error {}

/**
 * The problems `JSON.parse` would hide, where they stand: a key twice in one
 * object, and a number with a point or an exponent where the format takes a
 * whole number. A text that is not JSON gives none here.
 */
export function scanJson(text: string): string[] {
  const problems: string[] = [];
  let at = 0;

  function space(): void {
    while (at < text.length && " \t\n\r".includes(text.charAt(at))) at += 1;
  }

  function string(): string {
    const start = at;
    at += 1;
    while (at < text.length && text.charAt(at) !== '"')
      at += text.charAt(at) === "\\" ? 2 : 1;
    if (at >= text.length) throw new Broken();
    at += 1;
    // The literal as JSON reads it, escapes and all: «text» is «text».
    try {
      return JSON.parse(text.slice(start, at)) as string;
    } catch {
      throw new Broken();
    }
  }

  function value(path: Path): void {
    space();
    const first = text.charAt(at);
    if (first === "{") {
      at += 1;
      const seen = new Set<string>();
      space();
      if (text.charAt(at) === "}") {
        at += 1;
        return;
      }
      for (;;) {
        space();
        if (text.charAt(at) !== '"') throw new Broken();
        const key = string();
        if (seen.has(key))
          problems.push(`${where(path)}: ключ «${key}» повторюється.`);
        seen.add(key);
        space();
        if (text.charAt(at) !== ":") throw new Broken();
        at += 1;
        value([...path, key]);
        space();
        const next = text.charAt(at);
        at += 1;
        if (next === "}") return;
        if (next !== ",") throw new Broken();
      }
    }
    if (first === "[") {
      at += 1;
      space();
      if (text.charAt(at) === "]") {
        at += 1;
        return;
      }
      for (let index = 0; ; index += 1) {
        value([...path, index]);
        space();
        const next = text.charAt(at);
        at += 1;
        if (next === "]") return;
        if (next !== ",") throw new Broken();
      }
    }
    if (first === '"') {
      string();
      return;
    }
    const start = at;
    while (at < text.length && /[-+0-9.eEa-z]/.test(text.charAt(at))) at += 1;
    const literal = text.slice(start, at);
    if (literal === "") throw new Broken();
    if (/^-?\d/.test(literal) && /[.eE]/.test(literal) && wholeNumberAt(path)) {
      const key = path[path.length - 1];
      problems.push(
        `${where(path)}: «${String(key)}» має бути цілим числом, а записано ${literal}.`,
      );
    }
  }

  try {
    value([]);
    space();
    if (at !== text.length) return [];
  } catch {
    // Not JSON, or nested past what the phone can follow: `JSON.parse` says.
    return [];
  }
  return problems;
}

/** The file with its `null`s left out, as the server keeps it (§11). */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, withoutNulls(item)]),
    );
  return value;
}

async function sha256(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    // No `crypto.subtle` outside a secure page: the file is sent all the
    // same, only a resend after a lost answer is not recognised by it.
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Read a picked file as strictly as the format reads it. */
export async function readStockFile(file: File): Promise<StockFileRead> {
  const name = file.name;
  const refused = (...problems: string[]): StockFileRead => ({
    ok: false,
    name,
    problems: limited(problems),
  });
  if (file.size > MAX_FILE_BYTES) return refused(TOO_LARGE);
  if (name.length > 200)
    return refused(
      "Назва файлу довша за 200 символів. Перейменуйте файл і оберіть його ще раз.",
    );
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    // Strict: a bad byte is refused, never replaced. A BOM is dropped.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refused("Файл не в кодуванні UTF-8. Збережіть його як UTF-8.");
  }
  const scanned = scanJson(text);
  if (scanned.length > 0) return refused(...scanned);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refused("Це не JSON-файл, або він пошкоджений.");
  }
  if (!isObject(parsed) || parsed.format !== FORMAT)
    return refused(`Це не файл формату Бірки («${FORMAT}»).`);
  if (parsed.version === undefined || parsed.version === null)
    return refused(
      "У файлі не вказано версію формату: застосунок читає версію 1.",
    );
  if (parsed.version !== VERSION)
    return refused(
      `Версія формату ${JSON.stringify(parsed.version)} не підтримується: застосунок читає версію 1.`,
    );
  const lines = parsed.lines;
  if (!Array.isArray(lines) || lines.length === 0)
    return refused("У файлі немає рядків («lines»).");
  if (lines.length > MAX_PART_LINES)
    return refused(
      `Рядків у файлі: ${String(lines.length)}, а один файл бере не більше ${String(MAX_PART_LINES)}. Розділіть його.`,
    );
  const kept = withoutNulls(parsed) as Record<string, unknown>;
  delete kept.$schema;
  // Said now rather than at sending: the request is larger still.
  if (bodyBytes(kept) > MAX_BODY_BYTES) return refused(TOO_LARGE);
  const items = kept.lines as unknown[];
  const priceKind = kept.price_kind;
  return {
    ok: true,
    name,
    file: kept as unknown as StockFile,
    summary: {
      lines: items.length,
      photos: new Set(
        items.flatMap((line) =>
          isObject(line) && typeof line.photo === "string" ? [line.photo] : [],
        ),
      ).size,
      price_kind:
        priceKind === "sale" || priceKind === "purchase" ? priceKind : null,
      source: optionalText(kept.source),
      counted_on: optionalText(kept.counted_on),
      with_count: items.filter(
        (line) => isObject(line) && line.count !== undefined,
      ).length,
      with_size_counts: items.filter(
        (line) => isObject(line) && line.size_counts !== undefined,
      ).length,
    },
    sha256: await sha256(bytes),
  };
}
