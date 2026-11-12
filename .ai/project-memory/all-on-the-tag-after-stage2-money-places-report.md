# «Усе на бірці», after stage 2's audit, batch 12: «Гроші»'s «Вам винні клієнти» in a debt's colour and «людини»; «Ви винні постачальникам» the open store's line the way to its «Накладні»; «Закриття · {магазин}» — 2026-11-12

Baseline: `9efce4d5` (the audit's eleventh batch, PR #194, merged). This
batch covers the first two items of the money task list after stage 2:
- [P1-1](redesign/2026-11-09-redesign-tz-after-stage2-money.md): what
  customers owe in a debt's colour, in the words «Сьогодні» uses;
- [P1-2](redesign/2026-11-09-redesign-tz-after-stage2-money.md): a way
  from «Гроші» names the store it opens.

Left of the money task list: P1-3, P2-1, P2-2, P2-3, P2-4.

Status: built. 1064 of 1065 journeys passed on a fresh seed; the one that
failed did so for the stand's database, as in batches 7–11. 21 of 22
mutants were caught; the one left cannot be reached. CI is GitHub's, on
the pull request.
Not yet seen on a real phone.
- Branch: `feat/after-stage2-money-places`.
- Task: the audit's twelfth batch, chosen in chat after #194 was merged
  (2026-11-12, «Yes, money first»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-12 (audit after
  stage 2, batch 12: …)".

Where it stood:
- «Вам винні клієнти» said «Винні 8 400,00 грн · 4 покупці» in ink, the
  same ink as what is owed to suppliers. «Сьогодні» showed the same figure
  in the debt's colour as «4 людини».
- «Ви винні постачальникам ›» was a button over the lines of every store,
  but it opened «Накладні» of the open store alone. An owner of two stores
  saw «Ринок»'s line, tapped, and found only «Центр».
- «Закриття» on «Гроші» opened the open store's closes without naming it,
  while «Каса · Центр» beside it did.

## What exists now

- **What customers owe** (P1-1; §4 «Долг», S29 №9; В-ГР1 (а)):
  - A store's line where customers owe something is drawn whole in the
    debt's colour: ««Центр»: Винні 8 400,00 грн · 4 людини». Its twin is
    «Винні» at the line's start.
  - «Ніхто не винен» is in pencil, as «Сьогодні» says it.
  - The place's glyph takes the debt's colour while at least one store's
    line does. With nobody owing anywhere it stays in ink (decided here).
  - «Ви винні постачальникам», its glyph and its lines stay in ink.
  - No sum changed; nothing is added up.
- **The suppliers' way** (P1-2; S29 №10; Q-1 «if not»):
  - «Ви винні постачальникам» is a title, no way.
  - The open store's line comes first and is the way to its «Накладні»:
    the place's whole width, 44 high, the set's chevron at the end.
    - It is heard «Накладні магазину «Центр»: 38 000,00 грн · 3
      накладні». Not read, «…: не вдалося прочитати», and the way stays.
    - It is held as the title was.
  - The other stores' lines follow in the report's order, as lines.
  - With one store, as many taps as before: the tab, then the line.
  - Without `supplier:debt` in the open store, every line is a line.
- **«Закриття · Центр»** (P1-2; S29 №18): the open store's name, as
  «Каса · Центр» beside it. The «Закриття» button on «Каса» is unchanged.
  The words wait for the owner's approval.
- «Вам винні клієнти» keeps its way on the title: «Покупці» shows every
  store's block.

## The independent review

A reviewer who had not built it read the diff, the task and this batch's
rules. It found nothing serious: no bug and no break of the task.
- **Fixed — the held way faded its money** (medium). Held, the open
  store's line took every disabled button's 45%: its figures fell to about
  3:1, while the other stores' lines stayed in ink. Before, only the title
  faded. Now it is drawn as a held row is: nothing faded over it, its
  words in pencil. `suppliers`' kept return checks it.
- **Fixed — the dark theme's colour was not checked** (low). Only the
  default theme compared the line and the glyph with `--owed`; the themes'
  journey checked contrast alone, which ink passes too. It now waits for
  the line's colour and compares both with the theme's `--owed`.
- **Said, not changed:**
  - The state's mark in the way's name cannot be heard today: an open
    store that does not trade loses `supplier:debt`, so its line is never
    the way. It stays, in case that changes; the rules say so.
  - The name starts with «Накладні магазину», so what the line shows is
    in it but not first. The task names it so.
  - The line's 44 puts about 12 px under the title and before the next
    line, where other lines sit closer. Worth a look on a phone.
  - The two-tap count counts the journey's own clicks. The proof is the
    heading after the second one.

## How it was built and proven

**Code:**
- `frontend/src/money/Money.tsx`:
  - `debtsText` in «людина / людини / людей»;
  - `debtsTone`: a line's colour by what it says;
  - `Place`'s glyph colour;
  - `InvoicesLine`: the open store's way;
  - the suppliers' lines, the open store's first.
- `frontend/src/App.tsx`: `here`, the open store, and «Закриття · …».
- `frontend/src/styles.css`: `.money-owes`, `.money-none`,
  `.money-line-open`.
- `frontend/src/shared/Icon.tsx`: `className` may be absent (types only).
- No backend change.

**Journeys:** 1065 in all; 1063 before.
- New in `money`:
  - from «Ринок»: its line first and the one way, its own «Накладні» and
    «Закриття · Ринок» asked by its id; a manager of one store two taps
    from «Накладні»;
  - nobody owing in any store: every line in pencil, the glyph in ink.
- Changed in `money`:
  - S29: «людини», the debt's colour on the lines and the glyph, ink on
    the suppliers', one way of 44 at the place's width with its chevron
    and its name, «Закриття · Центр»;
  - the ways back: «Накладні» from the line, «Закриття · Центр»;
  - a place not read: the way kept with its name;
  - a store that does not trade: «Ніхто не винен» in pencil;
  - both themes: the debt's colour and the way at 4.5:1.
- `suppliers`: a kept supplier return holds the way.
- `supplier-invoices` and `fixtures`: «Накладні» opened from the line.

## Mutants

`~/.cache/birka-runtime/helpers/mutate42.py` has 22 mutants. Each one
undoes one thing this batch made. `mutants42.sh` ran each against the
journeys that should catch it. «Гроші»'s journeys are stubbed, so only
the real server's got a fresh seed.
- **P1-1:**
  - «покупці» again;
  - no colour on any line, or the debt's colour on «Ніхто не винен»;
  - «Ніхто не винен» in ink;
  - the glyph always, or never, in the debt's colour;
  - the debt's colour turned to ink in the styles;
  - the suppliers' lines in the debt's colour;
  - the dark theme's debt colour turned to light ink (review).
- **P1-2:**
  - the title a way again;
  - every store's line a way;
  - the open store's line not first;
  - the way without its name, or without what it shows when not read;
  - the way not held while a send is in flight, or while another
    section's kept operation waits;
  - lower than 44, or narrower than the place;
  - faded when held (review);
  - no chevron;
  - «Закриття» without the store, or opening «Каса».
- **21 caught, 1 not reachable.**
  - The first pass had 21 and caught 17. Two were equivalent: the row's
    `min-height` and its padding each made it 44. The padding is gone, and
    its mutant with it; `min-height` alone makes it 44, and its mutant is
    caught now.
  - The way not held while another section's operation waits survived.
    `suppliers`' kept return now goes to «Гроші» and finds it held; caught.
  - The way not held while a first send is in flight survives. The menu
    is held while sending, so «Гроші» cannot be opened then. The title's
    hold before had no journey either.
  - The review's two came after: the held line faded, caught by
    `suppliers`; the dark theme's colour, caught by the themes' journey.
    Its first try changed the dark copy under `prefers-color-scheme`,
    which a Telegram theme never uses; aimed at `data-theme`, it is
    caught.
- Logs: `go-mutants42-first.log` … `go-mutants42-fourth.log`.

## Evidence

- **Type check, ESLint, build:** `tsc --noEmit` and ESLint on `src` and
  every touched journey are clean. `npm run build` built. The e2e type
  check's 44 errors are main's own (44 before and after).
- **The touched journeys:** `money`, `supplier-invoices`,
  `suppliers-pages`, `borrowed`, `outside-text`, `till-sections` and
  `design-system` whole: 102 of 102. After the mutants' changes: 6 of 6.
- **Every journey:** 1064 of 1065 on a fresh seed, one worker, in 29.4
  minutes (`b12-full.log`). The one is `backups.spec.ts:93`: 14 nights
  listed where it reads 3, because the stand's database keeps every
  seed's nights (the seed is additive), as in batches 7–11. Nothing of
  this batch touches «Резервні копії».
- **After the review's fixes,** on a fresh seed: `money`, `suppliers` and
  `supplier-invoices` whole, 46 of 46. The fixes are a held line's style
  and two journeys' checks; the rest is as in the whole run.
- **Mutants:** 21 of 22 caught, 1 not reachable (above).

## Not covered

- A real phone.
- The way held while a first send is in flight (above).
- Q-1: with a «yes», every store's line would get its «›» (S29 whole). Not
  here.

## For the owner

- **Done:** on «Гроші», what customers owe is in the debt's colour and
  says «4 людини», as «Сьогодні» does. What you owe suppliers stays in
  ink.
- «Ви винні постачальникам» no longer pretends to open every store: only
  the open store's line opens its «Накладні». The other stores' lines are
  lines.
- **Please approve:** «Закриття» on «Гроші» now reads «Закриття · Центр»,
  as «Каса · Центр» beside it.
- **Decided here; tell us if you want otherwise:** the place's glyph is in
  the debt's colour only while some store's customers owe something.
- **Still open from batch 10:** the «Початкові залишки» line that takes
  four lines at 360 px. Keep it, or shorten it?
