# ADR-0018: Text from outside, shown as it is

Status: Accepted (2026-10-10). Built on `feat/catalog-text-guard`; see the
[report](../project-memory/outside-text-report.md).
Owner decision: business-rules.md, "text from outside, shown as it is"
(2026-10-10).
Extends: ADR-0014 §15 (the display guard of «Початкові залишки») to every
screen. Closes: the risk register's "the catalogue screens still show raw
text".

## Context

Some characters change how text looks without being seen themselves:
- the bidirectional controls (U+202A–202E, U+2066–2069, U+200E, U+200F,
  U+061C) reorder what follows: «Шуба », U+202E, then «21 шт» reads as
  «Шуба тш 12»;
- the invisible ones (U+200B, U+FEFF, the soft hyphen and others) make two
  names that look the same differ;
- a control character or a line separator breaks one written line into two.

`visible()` (`frontend/src/shared/visible.ts`, ADR-0014 §15) shows each as
its code, «⟦U+202E⟧», leaving an emoji's own selector and joiner as they are.
Only «Початкові залишки» used it. A map on 2026-10-10 found such text
everywhere else, unguarded:
- **a model's name, colour and size** on some 60 places: the catalogue
  screens, the till, receiving, «Залишки», returns, «Брак», orders, «Звіт»,
  «Борги», «Накладні», «Каса»;
- **other text from outside** on some 90 more: people's names, which come
  from their Telegram profile and change at each sign-in; suppliers',
  customers' and stores' names and phones; notes and reasons.

A seller's Telegram name, a parser's file and a name typed in the app all
reach these screens.

## Decision

1. **Every text from outside passes through `visible()` where it is shown**
   (owner, 2026-10-10): the text of an element, `aria-label`, `title`,
   `alt`, an option of a list, and the messages built from it. A helper
   that builds a message from outside pieces marks the pieces inside it
   (`keptText`, `markText`, `sizeLabel`, `shippingText`, `familyLabel`,
   `similarText`, `blockerText`, `closedBy`, a file's problem in
   `errorText`), so its every caller is covered.
2. **Only where it is shown.** A value given to a field to edit, a value
   sent to the server or kept in the phone's journal, a key, a comparison,
   a search and a link (`tel:`) keep the text as it is: marking them would
   store the marks, or find nothing.
3. **Nothing is refused, and nothing stored changes** (owner, 2026-10-10).
   The server keeps what was typed or sent.
4. **A journey proves it** (`e2e/outside-text.spec.ts`). It plants the
   characters the ways they arrive:
   - a model and a supplier made through the API;
   - a seller added by the server command, whose Telegram name holds one;
   - a customer's name on that seller's debt;
   - a write-off's reason and an invoice's note.

   Then it reads nine screens whole: their text, every label and every
   option. Each must hold the marks, and none of the characters.

## Consequences

- A name with such a character reads longer: «Шуба ⟦U+202E⟧21 шт». That is
  the point; whoever sees it can correct the name.
- A field opened to edit the name still holds the character itself, as
  typed; the screen beside it shows the mark.
- A new screen that shows text from outside needs `visible()`; nothing
  checks that by itself, but the journey reads the screens it walks whole.

## Rejected

- **Marking every text the server sends, in one place** (the API client).
  A name sent back to edit it, or to search with, would carry the marks
  into the database.
- **Refusing such characters when typed.** The owner chose to show them
  (2026-10-10); a Telegram name or a parser's file cannot be refused anyway.
- **CSS alone** (`unicode-bidi: isolate`). It keeps a name's reordering
  from spilling into the text around it, but still reorders the name and
  hides what is invisible.
