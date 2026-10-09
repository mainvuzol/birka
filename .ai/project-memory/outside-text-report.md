# Text from outside, shown as it is — 2026-10-10

Baseline: `3061c05` (every container held, merged as PR #80).
Status: built and proven: the whole CI run locally passed, and the guard
taken off twelve places, one at a time, failed the new journey each time.
Branch: `feat/catalog-text-guard`. Decision: [ADR-0018](../decisions/ADR-0018-outside-text-shown-as-it-is.md);
owner: business-rules.md, "text from outside, shown as it is" (2026-10-10).

## Why this was next

On 2026-10-09 the owner chose three of the risks left before the public
domain, in this order: the app's own database role (PR #79), the containers'
limits (PR #80), and this one: «Початкові залишки» shows a character that
hides or reorders text as its code, the catalogue's screens did not.

## What the owner was asked

A map of the frontend (2026-10-10) found a model's name, colour and size
shown on some 60 places, not only the catalogue's screens, and other text
from outside on some 90 more: people's names (from their Telegram),
suppliers', customers' and stores' names and phones, notes and reasons. None
of it guarded. The owner chose on 2026-10-10:
- **every text from outside, on every screen**;
- **shown only**: nothing refused when typed, nothing stored changed.

## What exists now

- **31 files** pass text from outside through `visible()` where it is shown:
  an element's text, `aria-label`, `title`, an option of a list, and the
  messages built from it.
  - Catalogue: «Моделі», a similar name, the catalogue review (a parser's
    rows, candidates, notes), a new model, the model picker.
  - Stock: receiving, «Залишки» and its correction, «Початкові залишки»'s
    last unguarded places (a model chosen, a size, a warehouse, a list's
    source and a line's note).
  - Selling: the till (stock, sizes, sellers, warehouses, shortfalls, the
    receipt), orders (list, detail, a new order, its changes, the waybill),
    returns, «Брак».
  - Money: «Борги» (customer, phone, goods, stores, who, notes), «Звіт»,
    «Каса» (who closed, reasons, explanations, cash in and out, the sales
    to correct), «Накладні», «Постачальникам» and the borrowed goods,
    a suggested price.
  - People and places: the header's own name, the store switcher, «Магазини»
    (names, codes, states' reasons, who).
- **Shared helpers mark their outside pieces**, so their every caller is
  covered: `keptText`, `markText`, `sizeLabel`, `shippingText`,
  `familyLabel`, `similarText`, `blockerText`, `closedBy`, and a file's
  problem in `errorText`.
- **Left as typed**: a value given to a field to edit, a value sent to the
  server or kept in the phone's journal, keys, comparisons, searches, and
  the `tel:` link.
- The catalogue review's queue card now isolates a parser's row as its
  detail does (`catalog-raw`).

## How it was built and proven

- **The wrapping** was done by three agents, each in its own files, under
  one rule (where shown: marked; edited, sent, keyed, compared: as typed);
  their diffs were read, and every `visible(` beside a comparison or a value
  checked. Types and lint clean.
- **A journey** (`e2e/outside-text.spec.ts`) plants the characters the ways
  they arrive:
  - a model whose name holds U+202E and whose colour U+200B, made through
    the API;
  - a supplier with U+200B, and an invoice from them whose note holds
    U+202E;
  - a seller added by the server command, whose Telegram name holds U+202E,
    selling on credit to a customer whose name opens U+2066;
  - the owner writing the rest off, with a reason holding U+202E.

  Then it reads nine screens whole, their text, every label and every
  option: the seller's header and till, «Залишки», «Моделі», «Борги» (list
  and a debt), «Звіт», «Повернення», «Каса» (the sales to correct; a cash
  day runs from 06:00, so it reads the day that holds the sale),
  «Накладні» and «Постачальникам». Each must hold the marks and none of the
  characters. The journey writes them as `\u` escapes, so its own source
  shows them rather than obeys them.
- **Mutation**: the guard taken off one place at a time, on each of those
  screens: twelve places, each failing the journey. Two of them showed the
  journey's own faults first: a check that found the seller's name in the
  header before the till's list had loaded, and a mark in a closed list
  that a "visible" check could not see. Both fixed.

## Evidence

- **The journey** ran alone and in the whole suite: 265 journeys passed,
  against the real API and PostgreSQL.
- **Mutation, at `98b6c6e`** ([result](../../output/verification/2026-10-10-outside-text/mutants.txt),
  its driver beside it): twelve of twelve caught. A hidden character quoted
  from a failure is written there as `\uXXXX`, so the file shows it rather
  than obeys it.
- **CI, run locally at `98b6c6e`** ([summary](../../output/verification/2026-10-10-outside-text-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 308 on PostgreSQL 17;
  - restore drill: 7/7;
  - e2e: 265 journeys;
  - frontend: lint, types, `npm audit` and the build clean;
  - edge: 9/9;
  - hot path: worst p95 68.4 ms (catalogue read) and 69.7 ms
    (`POST /sales`), within 300 and 500.

## Not covered here

- A field opened to edit a name holds the character itself; the screen
  beside it shows the mark.
- The journey reads nine screens. The others are guarded by the same rule
  but not walked with planted text: receiving, orders, «Брак», the
  catalogue review, «Магазини», a suggested price.
- A new screen needs `visible()` of its own; nothing checks it by itself.
- The server keeps every character as it came.
