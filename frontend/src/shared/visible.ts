/**
 * A text as a person should see it: what reorders or hides characters is
 * shown as a mark instead (ADR-0014 §15).
 *
 * A parser's file, and every line of a stock list, may hold characters that
 * change how the rest of the text looks without being seen themselves: the
 * bidirectional controls (U+202A–202E, U+2066–2069, U+200E, U+200F, U+061C)
 * can make «12 шт» read as «шт 21», and the invisible ones (U+200B–200D,
 * U+2060, U+FEFF) make two texts that look the same differ. A line break or
 * a tab would show one written line as two. Each is replaced, only on the
 * screen, by its code: `⟦U+202E⟧`. Nothing stored changes.
 */
const HIDDEN =
  /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B-\u200D\u2060\uFEFF\n\r\t]/g;

export function visible(text: string): string {
  return text.replace(
    HIDDEN,
    (character) =>
      `⟦U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}⟧`,
  );
}
