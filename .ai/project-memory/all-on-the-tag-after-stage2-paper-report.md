# «Усе на бірці», after stage 2's audit, batch 1: the page is the paper, never a card; the money buttons wait as the till's dock — 2026-11-09

Baseline: `e68dfb63` (stage 2's thirteenth batch, PR #182, merged: stage 2
built whole), and three P0s of the audit after stage 2:
- [frame P0-1](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) — the
  page is the paper, the 2026-10-11 card gone from the base rule;
- [sale P0-1](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — the
  till's share of it;
- [orders-cash P0-1](redesign/2026-11-09-redesign-tz-after-stage2-orders-cash.md)
  — «Клієнт забрав», «Змінити на «…»» and «Видати / Внести» wait as the
  till's dock.

Status: built; proof below — 1006 of 1008 journeys on a fresh seed: one
of the two the known Mac-only failure, the other a width this batch
changed, settled and passed after. 40 of 40 mutants caught. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-paper`. Task: the audit's first batch, chosen in
chat after the audit (2026-11-09, «Yes, start it»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-09 (audit after stage
2, batch 1: …)". No owner's question was open on these three.

Where it stood:
- every `section` a white card — 18 round, 22 inside, 17 at ≤ 480 px — and
  33 screens undoing it each with a rule of its own; the gutter 18, and 14
  at ≤ 480 px;
- in the dark theme, a tag's outline the card's colour on a card of the
  same colour: the models read as running text;
- at 360 px the till's tag 248 px inside: «S M L XL» in two rows;
- «Клієнт забрав»: five ways greyed alike, no ring, no «Ще надсилаємо…»;
  «Назад» closed the sheet in the middle of the write; the ways 54 high;
- «Змінити на «…»»: greyed with no ring nor line; «Видати / Внести»: a
  ring, no line.

## What exists now

- **The paper.** No `section` has a fill, an outline, a corner or an
  inside of its own, on every screen: white is what lies on the paper — the
  tags, a list's block, the sheets, the menu. The gutter 16 at every width.
- **A list's white block** (spec §6.8): «Ще»'s groups, each a block 4
  round, a hairline round it in the light theme and none in the dark, its
  label on the paper; «Гроші»'s rows the same.
- **The till:** the tags on the paper, in the dark theme the card's fill on
  the paper's; four sizes of one warehouse in one row at 360 px, 60 × 60
  each; the tray and the result's dock on the gutter; the search held at the
  top on the paper.
- **What leaned on the card** has its own: a plate drawn as a section its
  box (12 16, its warning's outline, 4 round); the customer's card's blocks
  4 round; a stub the card's white wherever it lies; the openings' line the
  card's white.
- **«Клієнт забрав» on its way:** the pressed way's ring in its colour, the
  four others stepped back (4.5:1 in both themes), «Ще надсилаємо…» over the
  ways past 3 s; no Telegram's «Назад», Escape, scrim or grip closes it;
  the ways 56. Pressed with «Оплата частинами» open and the ways scrolled
  half out, they come back into view with the line's room over them.
  Answered as before.
- **«Змінити на «…»» on its way:** the ring on the button in its colour,
  «Ще надсилаємо…» over it past 3 s; «← Каса», Telegram's «Назад» and
  «Інша операція» held meanwhile.
- **«Видати / Внести» on its way:** the button in its colour with its ring,
  «Ще надсилаємо…» over it past 3 s, Telegram's «Назад» hidden, the sheet
  kept; the sheet let go whatever comes of the send.

## Decided here, not by the owner

All in business-rules.md under the heading above. In short:
- **A plate drawn as a section keeps a box of its own;** a stub inside a
  section is the card's white, as anywhere.
- **The till's search, held at the top,** on the paper: on the screenshots
  it stood as a white band.
- **The openings' line** a slip of the card's white: paper on paper it all
  but vanished (review).
- **A screen held while a change of way is on its way,** not while a
  command is kept unanswered: «Каса»'s banner holds that, as before.
- **«Клієнт забрав»'s ways brought into view** on a press, so the line
  over them is never out of the sheet's view.
- **The model's grid: its rows' names in `meta`** (§5.5's 14/19/500, the
  floor for reading text; they were 15/19/500, off the ramp). GitHub's run
  found the grid's room to spare under 12 px at 360 px on its Roboto once
  the gutter took 4 px; 14 px gives back about as much. «з них у резерві»
  was 14 already.

## How it was built and proven

- **Files:**
  - `frontend/src/styles.css`: the base `section` a block of meaning; 33
    screens' undoing of the card gone; the gutter; `--block-outline`; the
    list's block; `section.notice`; `.customer-block`; the tray's and the
    dock's margins; the till's search; the openings' line; the sheets'
    room for the line; the five ways 56;
  - `frontend/src/shared/More.tsx`: a group's rows on a block;
  - `frontend/src/money/Money.tsx`: «Гроші»'s rows on a block;
  - `frontend/src/orders/Collect.tsx`, `frontend/src/App.tsx`: «Клієнт
    забрав» given its waiting, the way pressed, the sheet held, the line,
    the ways brought into view;
  - `frontend/src/cash/Fix.tsx`, `frontend/src/cash/Cash.tsx`: the way
    card's sending on its screen, its line and ring, «← Каса» and «Інша
    операція» held;
  - `frontend/src/cash/Move.tsx`: the line, the button's colour, the sheet
    held, the send's end in `finally`.
  - No backend change.
- **Journeys:** 1008 in all, 999 before.
  - `e2e/design-system.spec.ts`, 2 new — at 360 and 390 px, as the network
    owner: «Сьогодні», «Продаж», «Повернути», «Внесок», «Замовлення»,
    «Гроші», «Каса», «Звіт про продажі», «Покупці», «Ще» — every
    `main > section` with no fill, outline, corner or inside; the gutter 16;
    no scroll across; «Ще»'s blocks the card's white, 4 round, their
    labels on the paper; a plate's own box; «Гроші»'s block, its hairline
    in the light theme and none in the dark; a model's detail (S23).
  - `e2e/till-cells.spec.ts`, 2 new — at 360 px in both themes: the till no
    card, the tag the card's white, the search on the paper, four sizes in
    one row, the gutter, the tray at 16 and 344; then a screenshot at 390 ×
    844.
  - `e2e/orders-card.spec.ts`, 2 new — «Клієнт забрав» held: the ring, the
    others stepped back and read, the line past 3 s, Telegram's «Назад»
    hidden and with Escape and the scrim closing nothing, the line inside
    the sheet just over the ways, the stub after, white; in parts in the
    dark theme with the ways scrolled half out.
  - `e2e/cash-move-fix.spec.ts`, 1 new, 1 changed — «Видати» and «Змінити
    на «Готівка»» held: the ring, the colour, the line over the button,
    Telegram's «Назад» hidden, «← Каса» held; the owner's correction held:
    «← Каса» and «Інша операція».
  - `e2e/credits-debt.spec.ts`, 1 new, 1 changed — «Покупці», the customer's
    card, the debt's detail, S21 and S22 on the paper; the card's blocks 4
    round.
  - `e2e/till-receipt.spec.ts`, 1 new — the receipt at 360 px: no card,
    its stub white, «Новий продаж»'s dock on the gutter.
  - `e2e/openings.spec.ts`, 1 changed — the line's slip the card's white.
  - `e2e/till-sections.spec.ts`, 1 changed — «Ще»'s row the whole width of
    its white block (was: of the whole list).

## The independent review

An independent reviewer read the diff against `e68dfb63` with the three
tasks, the reference, the rules and the journeys, through the
financial-integrity, human-error, adversarial, design-system, POS and
Playwright lenses; it ran the type check. **No P0 and no P1:**
- no second command can be sent while one is on its way;
- no outcome is lost, and no ring shows on the wrong way;
- no state is left «sending»;
- the removed screens' rules were each on a `section` alone;
- no full undoing of the card is left;
- no negative margin was left leaning on the card.

Eight P2s, each settled in the code or the journeys, the ones a person
sees written in business-rules.md («Settled in the review»):
- **«Видати / Внести» waited unlike the others:** greyed to 0.45 with its
  ring, Telegram's «Назад» shown though it did nothing. Now the button
  keeps its colour, the sheet hides it. Its send had no `finally`: a send
  that failed on the phone would hold the sheet for good — now it lets go.
- **«Змінити спосіб оплати» could be left mid-write:** «← Каса», Telegram's
  «Назад» and «Інша операція» stayed live, and a refusal answered after
  was lost. Now the screen holds them while the change is on its way; the
  way card's sending is its screen's.
- **«Ще надсилаємо…» could stand out of the sheet's view** with «Оплата
  частинами» open and the ways scrolled half out. Now a press brings the
  ways into view with the line's room over them; a journey scrolls them so
  in the dark theme.
- **The journeys left acceptance unmet:**
  - S23, S19–S22 and the debt's detail were not visited — now they are;
  - «Повернути» and «Внесок» were measured under the till's heading,
    perhaps before they drew — now each waits for its own section;
  - `.customer-block` 4 px and the stepped-back ways read in the dark
    theme were not asserted — now both are.
- **The openings' line, paper on paper,** all but vanished — now the card's
  white.
- **«Гроші»'s rows,** «Ще»'s own, stood on the bare paper — now on the block.
- **The 4 px the gutter took** from screens already on the paper (14 → 16
  at 360 px): the full run below, and GitHub's on Roboto.
- Seen and left to their tasks: fields, the mode switch's track and the
  chips nearly vanish on the paper in the light theme (frame P1-1); other
  lists' rows not on a block (P2-2 and the sections); placeholders fainter
  on the paper.

## Mutants

`~/.cache/birka-runtime/helpers/mutate31.py`: 40 mutants, each undoing
one thing this batch made — 30 of the three points, 10 of the review's
fixes. `mutants31.sh` ran each against the journeys that should catch it,
on a fresh seed each, one failure ending the run.
- **37 caught in the first pass,** each at an assertion about what it
  changes; `fixfinally` by its second press, which never comes.
- **Three survived,** and the journeys were tightened for them:
  - `collectroom` and `moveroom` — «Ще надсилаємо…» drawn against the
    wrong box. The journeys read its words, not where they stood; now they
    find it inside the sheet, within 12 px over the ways or the button.
  - `dockmargin` — the result's dock at −6 px. No journey of the batch
    showed it; now the receipt at 360 px does: no card, its stub white, the
    dock on the gutter.
  - Run again: **all three caught — 40 of 40.**
- One mutant of the plan was dropped as equivalent: `sending` in «Змінити
  на «…»»'s `disabled` — the journal's `busy` holds the button all the same.
- Logs: `go-mutants31.log`, `go-mutants31-tight.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean. Prettier is clean on the files that were clean at the
  baseline, and on every hunk of this batch in the files that were not
  (`App.tsx`, `styles.css`, `More.tsx`, `Cash.tsx`, `Money.tsx`,
  `credits-debt.spec.ts`, `till-sections.spec.ts`).
- **Every journey,** on a fresh seed, one worker: 1006 of 1008 in 27.0
  minutes — `go-b1-full.log`. The two:
  - `backups.spec.ts:93`, «the owner is shown last night's failed copy…»:
    this Mac's backups' history, failing alike on the last baselines;
    GitHub's run is the proof.
  - `till-sections.spec.ts:737`, «Ще»'s rows the whole width: a row was
    measured against the whole list. Inside its white block's 1 px outline
    it is 326 of 328 at 360 px. Now it is measured against its block's
    inside, as the design draws it. Run again: 29 of 29 —
    `go-b1-sections.log`.
- **The affected specs** after the review's fixes and the tightening, each
  on a fresh seed:
  - `orders-card`, `cash-move-fix`, `till-cells`, `design-system`,
    `credits-debt`, `openings`, `money` — 160 of 160, `go-p1-review.log`;
  - `orders-card`, `cash-move-fix`, `openings` — 80 of 80,
    `go-p1-review2.log`;
  - `till-receipt`, `orders-card`, `cash-move-fix`, `till-cells` — 94 of
    94, `go-p1-tight.log`.
- **GitHub's first run** (36ca0476): 1006 of 1008. The two, and how they
  were settled:
  - `model.spec.ts:282`, the six sizes at 360 px: the grid's least width
    under 12 px short of its room on CI's Roboto (the room 294, 4 px less
    with the gutter 16). Its rows' names in `meta` 14 px; here its spare
    went from 13 px to about 18.
  - `suppliers.spec.ts:253`, a refused return's warehouse read again: the
    search's own read, sent 300 ms after the typing, left 27 ms before the
    refused send, so the re-read joined it and no read followed. The
    journey now waits for that read before it counts. The app is left as
    it is: the read on its way then is the re-read.
  - `model`, `suppliers`, `correct`, `person-limit`, `stocktake`,
    `design-system` on a fresh seed: 59 of 59 — `ci183-fix-1.txt`.
- **Screenshots** (`frontend/test-results/`, wiped by the next Playwright
  run): `paper-till-390-{light,dark}.png` — the till at 390 × 844, the tag
  the card's white on the paper in both themes (in the dark the fill parts
  it), four sizes in one row, the tray on the gutter. Seen by eye at 360
  px while building (the scratchpad's shots), and settled from them: the
  till's search stood on a white band — now on the paper. Seen and fine:
  «Ще» on its blocks, «Замовлення», «Повернення», «Внесок», «Сьогодні» in
  both themes.
- Logs are in `~/.cache/birka-runtime/helpers/`.

## For the owner

- Nothing to answer. Where the paper shows what the next tasks redraw —
  fields, the mode switch's track and the chips nearly vanish on the paper
  in the light theme — frame P1-1 is the next step.

## Not covered

- A real phone: the paper and the blocks in Telegram's own themes; the
  sheet scrolled by a finger.
- A send that fails on the phone itself («Видати / Внести»'s `finally`): no
  journey makes `crypto.randomUUID` or the journal throw.
- CI's font: the 360 px widths of screens that were on the paper before
  lost 4 px to the gutter; the full run proves them on this Mac's font,
  GitHub's on Roboto (the size grid's settled above).
