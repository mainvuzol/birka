# «Усе на бірці», audit 2026-11-13, batch 5: the return's dock at the till's scale; the returns' blank tag and day captions as the till's; «Винні» one look; «Списано» `offline` (sale P2-1, P2-2, P2-4, P2-5) — 2026-11-14

Baseline: `0ea7b11f` (the audit's fourth batch, PR #205, merged). This batch
is the audit's next in its own order («merged, go next»): the sale list's
P2s that wait on no owner's answer — its quick wins P2-5, P2-2, P2-1 and its
«Долг одним видом» P2-4. P2-7 waits on В13-П1.

Status: built and proven in the journeys (the full run before the review's
fixes 1113 of 1115 — the stand's own `backups:93` and a `receive:451` timing
flake that passed 3 of 3 alone; the 5 specs touched again after them, 136
of 136); 29 of 29 mutants caught; the review's findings fixed; not committed.
Not yet seen on a real phone.
- Branch: `feat/audit-1113-sale-tail`.
- Task: the audit's fifth batch, after #205's merge (2026-11-14).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-14 (audit
  2026-11-13, batch 5: …)".

Where it stood:
- The return's dock said what comes back at 26 and its button was 54, while
  the till's tray, a segment away, says «Разом» at 32 over ways of 56.
- The returns' «nothing found» was one line of two sentences at 17/600, its
  other stores' offer and the manager's line neighbours of the blank tag
  centred by CSS; the till and «Внесок» split the fact and the step, the
  way on inside the tag. A day's heading was its own 14/700.
- A debt's own screen said «Винні» in pencil without the glyph and its sum
  at 34; S21 said it with the glyph in the debt's colour at 56; the
  customer's card at 44/48. «Історія» a plain `h3` there, a caption on the
  card.
- «Списано» was `neutral` in five places, though the spec names `offline`;
  a return row's «Магазин «…»» had no tone, a debt row's was `neutral`.

## What exists now

- **The return's dock** (sale P2-1; `frontend/src/styles.css`): the sum
  `money-l` 32/34; the button 56 (`--h-pay`). Words and states as before.
- **The returns' blank tag** (sale P2-2; `frontend/src/returns/Returns.tsx`,
  `styles.css`):
  - nothing found here: «За «…» продажів не знайдено.» the line, «Перевірте
    назву або очистіть пошук.» the meta; at the other stores, its one
    sentence, no meta;
  - «Очистити», «Купили в іншому магазині мережі? Шукати там» and the
    manager's line the tag's children in that order, centred with it;
  - under results, while read, or under a refused read, the offer where it
    stood;
  - a day's heading `t-label` in pencil, its bar while read 16 high.
- **«Винні» one look** (sale P2-4; `frontend/src/credits/Debt.tsx`,
  `frontend/src/credits/Customer.tsx`, `styles.css`): a debt's own screen —
  the glyph at 20 and the word in the debt's colour, the sum 56/56; S21 by
  the same rules (it carries `debt-detail` too), its 32 under 700 high as
  before; the card's sum 56/56, and its bar while another store is read
  the same 56 line (review); «Історія» on a debt's screen the caption.
- **Stickers** (sale P2-5; `Debt.tsx`, `Customer.tsx`,
  `frontend/src/credits/CustomerRow.tsx`, `frontend/src/returns/SaleRow.tsx`):
  «Списано» `offline` in five places and in a customer row whose debts
  were all written off; «Нічого не винні» `neutral`, «Сплачено» `paid`; a
  return row's store `neutral`.

## The independent review

An independent reviewer read the diff cold (no Playwright, nothing
edited), during the full run. No High, no Medium.
- **Low, fixed:**
  - the card's grey bar while another store's block is read was still the
    old 38-px line under a 56 line — now the same line; a journey holds
    another store's read and measures it;
  - business-rules said «Списано» keeps `neutral` — the old line now says
    it was revisited here;
  - three checks that could not fail: the sum's line against its own
    block (now the figures inside their line), «at least one line» (gone),
    the manager line's box centred by the flex (now each line of the
    words' text measured, and the offer's question too);
  - S21 at full height and its closed sticker had no check — a journey:
    S21 at 740, «Винні» glyph and colour, 56/56; a payment refused, the
    debt read again written off, «Списано» `offline`;
  - the 360 × 640 debt check did not see the fixed dock — now the whole
    «Винні» card in view and above the dock.
- **Checked, no defect:** the offer drawn once in every state of the list
  (the id it describes by never twice); the manager line in the states it
  was; S21's short-phone rule still wins; `.customer-owed .sum` after
  `.owed-sum .sum`; the dock's and the caption's classes used only there;
  every token has its dark value; every solution point of the four tasks.

## How it was built and proven

- Journeys, new:
  - `credits-debt`: «Винні» one look at 360 — the card's «120 000,00 грн»
    56/56 on one line with its glyph, a written-off coat's row `offline`,
    another store's bar while read the 56 line; the debt's own screen —
    «Винні» glyph 20 × 20 and the debt's colour, «120 000,00 грн» one
    line, «Історія» 13/700 capitals pencil; nothing wider than the phone;
    screenshots;
  - `credits-debt` S21 (review): at 740, «Винні» and 56/56; written off
    meanwhile, «Списано» `offline`;
  - `today-search`: customers owing nothing — «Сплачено» `paid`,
    «Списано» `offline`, closed both ways «Нічого не винні» `neutral`.
- Journeys, changed:
  - `returns-sale-screen` (360 × 640): the dock's sum 32/34/800; the
    longest way's button `min-height` 56, two lines at most, in view;
    nothing wider; screenshot;
  - `returns-list`: nothing found — `expectEmpty` with the line, the meta
    apart; the tag's children in order; the buttons and each line of the
    words centred with the tag; at the other stores no meta, no offer, the
    manager inside; under results the offer outside any tag; both themes —
    the day's heading 13/700 capitals tracked pencil, another store's
    sticker `neutral` at 4.5:1, the blank tag's parts at 4.5:1,
    screenshots;
  - `returns-elsewhere`: the store's sticker `neutral`;
  - `credits-debt`: the debt's theme check — «Винні» in the debt's colour,
    56, «Історія» at 4.5:1; the closed debt `offline`; 360 × 640 — the
    card above the dock (review);
  - `credits-list`: «Списано» `offline` (both themes, 4.5:1); the card's
    sum 56 in both themes;
  - `credits`: «Списано» `offline` on the card and on the erased debt.

## Mutants

`mutate53.py`, 29 mutants, each applied alone, its journey run, the source
restored (`mutants53.sh`): 29 caught, each at the check meant for it.
- The return's dock (3): the sum at 26; its line not 34; the button 54.
- The returns' blank tag (10): no meta; a meta at the other stores; the
  offer out of the tag; the offer twice; the manager out of the tag; the
  manager before the offer; no offer under results; the offer's button not
  centred; the day's heading not the caption; the heading in ink.
- «Винні» (8): no glyph on a debt's screen; its word not the debt's colour
  (both themes); the sum at 34; its line not 56; the card at 44/48;
  «Історія» a plain heading; the card's bar while read the old line
  (review); S21's «Винні» not the debt's colour (review).
- Stickers (8): a written-off customer row `neutral`; a both-ways row
  `offline`; the card's, a card row's, a debt screen's (two journeys) and
  S21's «Списано» `neutral` (S21's reached only by the review's journey);
  a return row's store without a tone.

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1113 of
  1115 in 30.9 min. The two: `backups:93` — the stand's own, as in every
  full run since batch 8; `receive:451` — «element is not stable … was
  detached» on «Перевірити результат приймання», nothing this batch
  touches; 3 of 3 alone after it.
- After the review's fixes, the specs these fixes touch (`credits-debt`,
  `returns-list`, `returns-sale-screen`, `credits-list`, `credits`): 136 of
  136 in 3.7 min.
- Journeys: 1116 by `--list` (1113 before).
- Types: `tsc --noEmit` clean (the e2e config's `AsymmetricMatcher` casts
  are main's); ESLint clean on every file touched; Prettier clean on what
  this batch changed — `Returns.tsx`, `Debt.tsx`, `credits-debt.spec.ts`
  and `styles.css` are unformatted on main and left so outside this
  batch's lines.

## Not covered

- A real phone.
- A million in «Винні» at 360 — it would break before its kopecks; not
  measured.
- P2-7 (waits on В13-П1).
