/**
 * A text as a person should see it: what reorders or hides characters is
 * shown as a mark instead (ADR-0014 §15).
 *
 * A parser's file, every line of a stock list, and every name shown beside
 * them may hold characters that change how the rest of the text looks
 * without being seen themselves: the bidirectional controls (U+202A–202E,
 * U+2066–2069, U+200E, U+200F, U+061C) can make «12 шт» read as «шт 21»,
 * and the invisible ones make two texts that look the same differ. Each is
 * marked, by Unicode's own classes, so none is missed (review, 2026-10-09):
 *
 * - every control character (`Cc`): a line break or a tab would show one
 *   written line as two, and U+0080–U+009F (NEL among them) print nothing;
 * - the line and paragraph separators (`Zl`, `Zp`: U+2028, U+2029), which
 *   break a line as a line break does;
 * - every default-ignorable code point: the zero-width ones (U+200B–200D,
 *   U+2060, U+FEFF), the soft hyphen U+00AD, U+034F, the Hangul fillers,
 *   U+180E, U+2061–U+206F, the variation selectors and the tag characters;
 * - every bidirectional control.
 *
 * Each is replaced, only on the screen, by its code: `⟦U+202E⟧`. Nothing
 * stored changes.
 *
 * Two of them are a part of an emoji, and are left as they are: a
 * variation selector (U+FE0E, U+FE0F) right after a pictograph («❤️») or
 * inside a keycap («1️⃣»), and the zero-width joiner (U+200D) between two
 * pictographs («👨‍👩‍👧»). There they neither hide nor reorder anything, and a
 * person's name such as «Оля ❤️» reads as written (review, 2026-10-09).
 * After a letter or a bare digit they are still marked: «M-1» and «M-1»
 * with a selector after it look the same and differ.
 */
const HIDDEN =
  /[\p{Cc}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;
const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
// A keycap: a digit, «#» or «*», the selector, and U+20E3 («1️⃣»).
const KEYCAP_BASE = /^[0-9#*]$/;
const KEYCAP = "\u20E3";
// What may stand between a pictograph and the joiner after it: a skin tone,
// or the variation selector that makes it an emoji («👩🏽‍💻», «❤️‍🔥»).
const BEFORE_JOINER = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]$/u;
const VARIATION = new Set(["\uFE0E", "\uFE0F"]);
const JOINER = "\u200D";

/** The code point that ends just before `offset`, or "". */
function before(text: string, offset: number): string {
  if (offset <= 0) return "";
  const unit = text.charCodeAt(offset - 1);
  const start =
    unit >= 0xdc00 && unit <= 0xdfff && offset >= 2 ? offset - 2 : offset - 1;
  return text.slice(start, offset);
}

/** The code point that starts at `offset`, or "". */
function at(text: string, offset: number): string {
  const code = text.codePointAt(offset);
  return code === undefined ? "" : String.fromCodePoint(code);
}

/** Whether this character, here, is a part of an emoji sequence. */
function inEmoji(character: string, offset: number, text: string): boolean {
  if (VARIATION.has(character)) {
    const previous = before(text, offset);
    return (
      PICTOGRAPH.test(previous) ||
      (KEYCAP_BASE.test(previous) &&
        at(text, offset + character.length) === KEYCAP)
    );
  }
  if (character === JOINER)
    return (
      BEFORE_JOINER.test(before(text, offset)) &&
      PICTOGRAPH.test(at(text, offset + character.length))
    );
  return false;
}

export function visible(text: string): string {
  return text.replace(HIDDEN, (character: string, offset: number) =>
    inEmoji(character, offset, text)
      ? character
      : `⟦U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}⟧`,
  );
}
