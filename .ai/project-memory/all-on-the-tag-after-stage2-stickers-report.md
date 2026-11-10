# «Усе на бірці», after stage 2's audit, batch 5: one mode switch; the menu's pill and word; every corner on the scale; nothing left of what no screen draws; one sticker, its glyph brought by its meaning — 2026-11-10

Baseline: `be8110c0` (the audit's fourth batch, PR #186, merged), and two
tasks of the audit after stage 2, the frame TZ's last pair (§8):
- [frame P1-1, part 2](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  the mode switch, the menu, the corners, what is dead, the page before
  the app;
- [frame P1-5](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  one sticker, a glyph and a word, the colour never alone.

Status: built; proof below — 1028 of 1029 journeys on a fresh seed, the one
the known Mac-only failure. 28 of 28 mutants caught. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-stickers`. Task: the audit's fifth batch, chosen
in chat after #186 was merged (2026-11-10, «Yes, start batch 5»). Chosen:
business-rules.md, "Chosen in chat — 2026-11-10 (audit after stage 2,
batch 5: …)". No owner's question is open for these tasks; В-К1 stays
as it was. With these two the frame TZ after stage 2 is built whole but
for what the sections' TZs took.

Where it stood:
- two switches of one meaning drew alike only by luck — `.mode-switch`
  (buttons) and `.way-switch` (radios), each its own copy: a track 14
  round with 4 around, segments 11 round and 44 high, every word 600;
- the menu's pill 15 round, the open tab's word 600 as the others';
- 33 corners off the scale (14, 15, 12, 11, 20, 16, 13, 10, 4, 3, 2 and a
  50 %), 20 more written as 999px, not the token;
- 8 classes no screen drew and a base `header` every screen's own
  overrode; the page shown when the app's code never comes 780 wide, its
  plate 12 round;
- two stickers: `.badge` (no glyph, 7 meanings told by colour alone —
  «Ще не підтверджено», paper's mark on a receipt, «Оплата частинами» and
  «Продано з паперу» on a returns' row, a return's and a payment's paper)
  and `.sticker` (orders, invoices, closes); shrunk to 13 in four places,
  the close's stub's 20/700 at 32 high.

## What exists now

- **One mode switch** (spec §6.7): `.mode-switch` (buttons — the till's
  «Продати | Повернути», «Каса», «Гроші», «Покупці», the goods' screens,
  the report, the suppliers' lists, the price's scope) and `.way-switch`
  (the return's way, radios) are one rule: 44 high, the fold's track 8
  round with 3 around, equal segments 6 round, the open one the card with
  its edge in 15/600 ink, the others 15/500 pencil. A segment is drawn 38 high; its tap
  reaches over the track's 3 above and below, so the tap is the whole 44.
  A long word is cut with «…» on its own span, never wrapped.
- **The menu** (spec §6.3): the open tab's pill 8 round; its word 13/700,
  the others 13/600, in the role `.t-tab`.
- **Every corner on the scale's tokens**, by the role of what it is: 8 a
  button, a field, the search, a chip, a stepper's −/+, the till's pay
  ways, «Повернути товар», ⋯, the count's sum field; 4 a block or a card;
  3 a sticker's grey and the debt's bar; round the sheet's handle, the
  toggle and every 999; the sheet's 16 the pay panel and the result's
  dock; the grey's own 10 now the scale's. Four left for orders and «Каса»
  P2-4: `.cash-panel-button`, `.skeleton-way`, `.cancel-ask`,
  `.same-waybill`.
- **Nothing left of what no screen draws:** `.t-button`, `.size-count`,
  `.owed-mode`, `.pay-amount`, `.pay-confirm`, `.order-status`,
  `.order-sent-with`, the base `header` and its `> span`; the orders'
  `statusPills`, which nothing read.
- **The page before the app** (`index.html`): 560 wide, its plate 4 round.
- **One sticker** (spec §6.18): `shared/Sticker.tsx` — 28 high on one line
  (5 above and below a line of 18), corner 3, a glyph of 16, a word of
  14/600, never shrunk. The tone brings its glyph: a debt the arrow with a
  minus, a warning and paper the triangle, a kept operation the dashed
  eyelet, paid the check in a circle, on its way the parcel, held or online
  the pin. `.badge` is gone; 23 files draw a status through it, the
  orders' `StatusSticker` too. ESLint holds it: no `sticker` or `badge`
  class written by hand outside the component.

## Decided here, not by the owner

Each is in business-rules.md with its reason.
- **A segment drawn 38, its tap the track's 44**: the spec's 44 is the
  switch; a tap is never under 44.
- **The glyphs the spec names by tone** are the set's: paid the check in a
  circle (`collected`), on its way the parcel (`sent`), held the pin
  (`held`). A screen may draw another of the same meaning (an order at the
  post office its building, a settled invoice its check), never none.
- **Paper's mark on a lost sale's settled answer** was ink on the fold;
  now paper's warning with its triangle, as on the receipt and the
  returns' row. «Сплачено» on a debt and a customer draws its check.
- **«Збіглося» stays the paid's green with its knot** until the till's
  match colour (orders and «Каса» P1-4).
- **28 on one line, a long one wraps**: the spec's padding is 0 8; with
  5 above and below a line of 18 a sticker that wraps at 360 grows a line
  and its words never touch its edge.
- **Every shrink went**, not three: «Закриття»'s 13, a correction's, an
  order row's, «Гроші»'s store state, the close's stub's 20/700 at 32, a
  list's state at padding 2.
- **`neutral`** — said by the way in pencil (a store's name, «Усе вже
  повернено», «Списано») — keeps its look; the spec has no such tone.
- **No «брак» tone**: no screen says damaged goods in a sticker yet.
- **Corners by role** where the TZ named only the scale: a stepper's −/+,
  ⋯ and the count's sum field 8 (buttons); the grey's own 10 kept.

## How it was built and proven

- **Files:**
  - `frontend/src/shared/Sticker.tsx` (new): the tone, its glyph (a
    `satisfies` over every tone with a meaning: one without a glyph does
    not compile), `as="p"`, `hidden`;
  - 23 files moved onto it: `App.tsx`, `cash/Closed.tsx`,
    `cash/History.tsx`, `catalog/Catalog.tsx`, `catalog/Models.tsx`,
    `credits/Customer.tsx`, `CustomerRow.tsx`, `Debt.tsx`, `Debts.tsx`,
    `Paid.tsx`, `money/Money.tsx`, `openings/Openings.tsx`,
    `orders/Knots.tsx` (`StatusSticker`, read by `Order.tsx` and
    `Orders.tsx`), `returns/Result.tsx`, `Returns.tsx`, `SaleRow.tsx`,
    `sales/Sale.tsx`, `shared/Kept.tsx`, `shared/Stub.tsx`,
    `stores/Stores.tsx`, `suppliers/InvoiceSticker.tsx`,
    `ReturnDetail.tsx`, `Suppliers.tsx`; `orders/types.ts`: `statusPills`
    gone;
  - `frontend/src/shared/ModeSwitch.tsx`: the word on its span;
    `shared/TabBar.tsx`: `.t-tab`;
  - `frontend/src/styles.css`: the switch's one rule, the menu, the
    corners, the dead rules, `.badge` gone, the sticker;
  - `frontend/index.html`: 560, 4;
  - `frontend/eslint.config.js`: no `sticker` or `badge` class by hand
    outside `Sticker.tsx`.
  - No backend change.
- **Journeys:** 1029 in all, 1027 before.
  - New: `design-system` — in the light and the dark theme, the switch as
    buttons (the till's) and as radios (the return's way, drawn on the
    page): track 44, its fold, corner 8 and 3 around; a segment 38, corner
    6; the open one card, its edge, ink 15/600; the others pencil 15/500;
    a tap at the track's top and foot reaching the segment; the menu's pill
    8, words 13/700 and 13/600; the sheet's corners — none off the scale
    but the four P2-4 keeps; the eight dead classes and the base `header`
    gone.
  - Added: `expectOneSticker` (fixtures) — every visible sticker 28 high on
    one line (a wrapped one a line of 18 more), corner 3, 14/600, a glyph of
    16 where its tone has a meaning; read in `orders-list` (done, gone —
    both glyphs drawn), `credits-list` (settled, written off), `cash-close`
    (the close's figures, the knot's group — the paid's tone), `outage`
    (paper's stub), `cash-kept` (the kept stub — its dashed eyelet),
    `cash-history` («Закриття»); `till-sections` — the switch's track 44
    and a tap at its top and foot; `failures` — the page before the app 560
    and 4.
  - Changed: `.badge` read as `.sticker` and tones by their whole name
    (`tone-…`) in 9 specs; the chip's grey corner 8 (`damaged`,
    `design-system`); the price's long store cut on its span (`price`).

## The independent review

An independent reviewer read the diff against `main` with the two tasks
and the spec's §4, §5, §6.3, §6.7 and §6.18; it ran the type check and
ESLint, and tried the lint's selectors on a sample file. Two high
findings, both the journeys'; one the look's. Settled in the code or the
journeys:
- **A sticker that wraps** — paper's mark on the sale's stub, «Продано під
  час збою · продавець: … · за папером …», wraps at 412 and at 360, its
  lines touching the sticker's edge (padding 0 8). Now 5 8: one line stays
  28, a wrapped one grows 18 a line; the helper reads a wrapped one so.
- **The close's knot** was read inside the sticker itself, and a locator
  looks only below: the helper reads the close's group now.
- **The price's and the report's stores**: a flex button cuts no word with
  «…», and its `overflow: hidden` clipped the tap's reach over the track —
  38, not 44. The word is on its own span now, cut there; the button keeps
  the tap.
- **`statusPills`**, dead on `main` too, still spelled `badge …`: gone.
- **Journeys:** the reach's point typed (the journeys' type check back to
  44); a tone read by its whole name, `tone-debt`, not `debt`, which a bare
  class would pass too.
- Seen and left: the lint holds a class written in `className`, not one
  kept in a variable or written in a `.ts` file.
- Found by the runs, not the review: the stub's swing tilts its box, so a
  sticker on it measured 29–32 by its bounding box (the helper reads the
  laid-out height); the radios' span, positioned over the input, took
  Playwright's `check()` (only the buttons are positioned now); a paid
  sticker in a debt's row stretched to the row's height (it keeps its own).

## Mutants

`~/.cache/birka-runtime/helpers/mutate35.py`: 28 mutants, each undoing
one thing this batch made. `mutants35.sh` ran each against the journeys
that should catch it, on a fresh seed each, one failure ending the run;
the lint's two by ESLint over `src/`.
- **The switch:** the track's padding and corner, the segment's corner and
  height, the tap's reach as buttons and as radios, the others' weight,
  the open one's weight, the radios' open look.
- **The menu:** the pill's corner, the open word's 700, its role.
- **Corners and what is gone:** a chip back at 14; `.owed-mode` and the
  base `header` back; the page before the app 780 and 12.
- **The sticker:** 24 high, corner 4, word 13; paid with no glyph; the kept
  one with the warning's triangle; the gone orders' glyphs; «Закриття»'s
  shrink back; the close's line rule on its sticker; «Збіглося» neutral;
  a `badge` class and a `sticker` template written by hand (the lint).
- **28 caught.** The first pass: 26 of 28. The two left were equivalent as
  written — a rule of the sticker's own weight placed before it, which the
  sticker's 14/600 overrode; each rewritten as the shrink stood on `main`
  (a weightier rule) and caught.
- Logs: `go-mutants35-first.log`, `go-mutants35-second.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean; the journeys' type check at the baseline's 44.
  Prettier is clean on the files that were clean at the baseline; in the
  files that were not, this batch adds nothing to what it would change
  (`cash-history`, `fixtures` and `outage` are clean now).
- **Every journey,** on a fresh seed, one worker: 1028 of 1029 in 27.7
  minutes — `go-b5-full2.log`. The one: `backups.spec.ts:93`, «the owner
  is shown last night's failed copy…» — this Mac's backups' history (14
  nights where the journey makes 3), failing alike on the last baselines;
  GitHub's run is the proof.
- **While building,** each on a fresh seed:
  - the switch's and the stickers' journeys first (`design-system`,
    `till-sections`, the stickers' specs) — 53 of 53, `go-b5-ds.log`;
  - the first full run, before the review's fixes — 1011 of 1029,
    `go-b5-full.log`: the stub's swing (a sticker on it 29–32 by its box),
    the radios' span over the input, the close's knot read inside itself,
    and the Mac-only backups journey;
  - the 20 specs this batch touches, after every fix — 464 of 465,
    `go-b5-rerun.log` (the one, the backups journey).

## Not covered

- A real phone.
- «Списано» on a debt keeps its neutral look; the spec names the offline
  grey for it (§6.18).
- The lint holds a status class written in `className`, not one kept in a
  variable or written in a `.ts` file.
- The four corners off the scale wait for orders and «Каса» P2-4;
  «Збіглося»'s colour for P1-4; «Початкові залишки»' three counts at 14,
  two lines where they must, for goods P0-1.
- No «брак» tone: no screen says damaged goods in a sticker yet.

## For the owner

- Nothing to answer for these tasks. What changes for the eye: every
  switch of ways looks alike — a light track, the open way white with a
  thin edge; the menu's open tab says its word bolder; corners are a little
  less round; every status is the same sticker, 28 high, its small sign
  beside its word, never told by its colour alone; paper's mark on a lost
  sale's answer is yellow with its triangle, as on the receipt.
