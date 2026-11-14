# «Усе на бірці», audit 2026-11-13, batch 4: «Гроші»'s places in store columns, a figure large; sums under 22 px in the text face; the invoice tag's sum `money-m`; the price sheet's no answer one text (money P1-1, P2-3, frame P2-8, goods P1-2 part 1) — 2026-11-14

Baseline: `a674a2d4` (the audit's third batch, PR #204, merged). This batch
is the audit's next in its own order («merged, go next»): the P1s left that
wait on no owner's answer — the money list's P1-1 with the frame's P2-8 it
depends on, the money list's P2-3 on the same rule, and the goods list's
P1-2 part 1 (part 2 waits on В13-Т1).

Status: built and proven in the journeys (the full run before the review's
fixes 1111 of 1112 — the stand's own `backups:93`; the 8 specs touched,
after them, 134 of 134); 41 of 41 mutants caught; the review's findings
fixed; not committed.
Not yet seen on a real phone.
- Branch: `feat/audit-1113-money-columns`.
- Task: the audit's fourth batch, after #204's merge (2026-11-14).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-14 (audit
  2026-11-13, batch 4: …)".

Where it stood:
- «Де гроші зараз»: every place a list of sentences, a store each, 15/20
  in ink — ««Центр»: учора порахували 5 380,00 грн о 20:06» — its figure
  never larger than its words, while «Сьогодні» puts the same drawers and
  debts in store columns with their sums at 32.
- A sum under 22 px was drawn in the condensed display face: the day tag's
  store sums in rows and under 390 px (spec: never below 22), and the
  invoice tag's sum at 20/800.
- The price sheet said «Сервер не відповідає. Продавайте на папері: …» for
  a gateway's 502–504, and its own «Немає відповіді сервера. Натисніть ще
  раз — повторне збереження безпечне.» for a lost network: one trouble,
  two texts.

## What exists now

- **«Де гроші зараз» in store columns** (money P1-1;
  `frontend/src/money/Money.tsx`, `frontend/src/styles.css`):
  - a store in its parts — its name as the day's tag names a store
    (`t-label`), the words before its figure (`meta`, pencil), the figure
    (`Sum`), the words after (`meta`, pencil); the colon and the joints
    visually hidden, so a store is heard as the phrase it was;
  - two stores in a place, two columns; one, or three and more, a row each
    — the name and its words at the left, the figure at the right; each
    place counts its own stores;
  - the figure 32/34 in the display face from 390 px, 20/24 in the text
    face 600 under it; in a row 20/24 always; a million or more at 24 in
    the display face at any width (`long`, as the day's tag's), breaking
    before its kopecks or unit if it must, never wider than its column;
  - no figure — «Каса ще не рахувалась», «Ніхто не винен», «Нічого не
    винні», «не вдалося прочитати» — one line in the figure's place
    («Ніхто не винен» and the unread in pencil); while read, a grey bar
    there;
  - customers' «Винні» and figure in `--owed` — its kopecks and «грн» too
    (review) — the count in pencil, the name in ink; suppliers' figure in
    ink;
  - the open store of «Ви винні постачальникам»: its whole column (or row)
    the button to its «Накладні», 44 at least and as tall as the other
    store's column (review), its chevron by the words after the figure — by
    the line where there is none (review); in a row after the figure, its
    parts in the row's middle (review); its name for a reader as before;
    held — words in pencil, nothing faded;
  - its layout classes are its own (`money-store-columns`,
    `money-store-rows`): `money-rows` is the «Звіт про продажі» rows' nav,
    whose 8 px margin had reached the new rows (review);
  - «Видано сьогодні», the rule's line, plates and stamps as before.
- **Sums under 22 px in the text face** (frame P2-8; `styles.css`): the day
  tag's store sums in rows, and in two columns under 390 px (a million's
  24 excepted), and «Гроші»'s figures — the text face, 600, even figures.
- **The invoice tag's sum** (money P2-3; `styles.css`): text face 20/24,
  600, ink.
- **The price sheet's no answer** (goods P1-2 part 1;
  `frontend/src/prices/SuggestedPrice.tsx`): a 502, 503 or 504 says what a
  lost network says; no paper's words in the sheet.

## The independent review

An independent reviewer read the diff cold (no Playwright, nothing
edited), during the first full run.
- **Medium, fixed:** the rows' class `money-rows` was already the class of
  «Гроші»'s nav of rows («Звіт про продажі», «Закриття», «Каса»): its
  `margin-top: 8px`, later in the sheet, put every place's list of one or
  three stores 8 px lower than two stores' columns. The layout's classes
  are now `money-store-columns` and `money-store-rows`; the journeys check
  each place's list starts at 0.
- **Low, fixed:**
  - the open store's button was as tall as its own parts, not its column:
    beside a taller column (it owes nothing, the other owes) its foot took
    no tap — its item is now a grid, the button stretched; a journey with
    that uneven pair;
  - with nothing after the figure the chevron stood alone on a fourth line
    — now by the line; in a row the button's parts stood at its top — now
    in its middle;
  - the debt's kopecks and «грн» were in pencil under an `--owed` figure:
    now in the debt's colour, as the customer's card;
  - comments said a reader hears one phrase — now: the parts in the
    phrase's order, the colon and joints hidden from the eye; a journey
    checks the colon and joint are 1 px and say «:» and «·»;
  - `quiet`, a global class of buttons, on the unread line: now
    `money-unread`;
  - `today.spec` had Prettier's reflow of lines this batch did not touch:
    reverted, only the batch's lines left.
- **Low, left:** the role check's «even figures» is `:root`'s already, so it
  cannot tell the rule's own line; the waiting bar holds one line, not the
  parts to come — a reading in business-rules.
- **Checked, no defect:** the open store's name for a reader as before;
  `signed` the same as `money` for what is never negative, U+2212 on the
  ways' negatives; the million's threshold on `abs`; each place's count;
  the rules' specificity at every width; `StoreName` in the report's table
  and «Видано сьогодні» untouched; the held button; the hidden spans take
  no grid cell; the invoice sum has no `.sum` inside; the price sheet's
  4xx and 500 still through `refusedWrite`, its conflict as before; the
  new price journey fails on main.

## How it was built and proven

- Journeys, new:
  - `money`, light and dark: two stores, 360 × 640 — every figure
    `money-m`, «38 000,00 грн» on one line in its column; 390 × 844 — the
    figures `money-l` (32/34, display, 800) with the display face loaded,
    «1 250 000,00 грн» `long` at 24 on one line in its column; back at 360
    — the million still 24 in the display face, the rest 20; nothing wider
    than the phone; screenshots at both widths;
  - `price`: a save lost to the network, then to 502, 503, 504 — the same
    one text each time, no paper's words in the sheet, «Зберегти · …»
    enabled; answered, saved.
- Journeys, changed:
  - `money` (review): the open store owing nothing beside one that owes —
    its column the whole way, as tall as the other's, the chevron by
    «Нічого не винні»;
  - `money` S29: every place two columns, each figure its stub's
    («5 380,00 грн», «2 450,00 грн» …), the parts in order under each other,
    the columns side by side; the words before and after; the name
    `t-label` in ink; «Винні» and figure in `--owed`, the words after in
    pencil, the debt's kopecks and «грн» `--owed` too; the colon and joint
    hidden, 1 px; suppliers' figure in ink; the open store's column the button —
    its box the column's, the chevron in the words-after's line at the
    column's right; the other store no button;
  - `money` three stores: every place rows, the figure right of the name,
    the words left of it, `money-m`; each list at 0 under its title; the
    open store's row centring its parts; the archived store's sticker not
    in capitals; screenshot;
  - `money` one store: rows; nobody owing: «Ніхто не винен» in pencil, no
    figure, two columns; the contrast journeys (both themes): the parts at
    4.5:1;
  - `today`: 390 — the stores' sums `money-l`; 360 opened — `money-m`;
    three stores in rows — `money-m`;
  - `supplier-invoices`: the long name's tag at 360 — its sum `money-m`, on
    one line beside the name's first;
  - `fixtures`: `expectSumRole` — a sum's face, size, line and weight by
    role.
- Found while proving: the figure's kopecks and «грн», kept whole as
  inline blocks, raised its line from 24 to 27 px — now `line-height: 1`
  on them.

## Mutants

`mutate52.py`, 41 mutants, each applied alone, its journey run, the source
restored (`mutants52.sh`): 41 caught, each at the check meant for it.
- The places' layout (6): three stores, or one, as columns; the columns
  stacked; the rows' figure under the name; the chevron off the words
  after; the open store's button no column.
- The parts (9): a drawer's close another store's; the transfers the
  card's; the words before, or after, not drawn; the joint seen; the
  reader's phrase without its joint; the name not the label; a million
  never `long`; the sticker in capitals.
- Colours (5): «Винні», or its figure, not the debt's; «Ніхто не винен» not
  pencil; the unread not pencil; the words not pencil.
- Sizes and faces (11): the column's 32 at 28; a million at 32; nothing
  narrower than 390; a million's line at 360; the kopecks raising the
  line; the rows', the narrow columns' and a narrow million's face in
  «Гроші»; the day tag's rows', narrow columns', narrow million's and
  390's faces.
- The invoice tag (2): its face, its weight. The price sheet (1): a
  gateway's answer in `refusedWrite`'s words.
- The review's fixes (6): the open store's item not a grid; the chevron
  alone under a figureless line; a row's button not centred; the debt's
  kopecks in pencil; the colon seen; the nav's class on the rows.
- The first pass had 35, 32 caught. Three lived, and each found a check
  missing: `unreadquiet` (no journey looked at the unread line's colour —
  now `money` does), `longnarrow` (at 360 a million's line was not
  measured — now 34), `daylong` (the day tag's million at 360 — its face
  now checked, in «a million in a store's day stays in its column»). All
  caught on the second pass.

## Evidence

- Full run, a fresh seed, one worker, before the review's fixes: 1111 of
  1112 in 30.6 min. The one: `backups:93` — the stand's own, as in every
  full run since batch 8.
- After the review's fixes, a fresh seed, the 8 specs these files touch
  (`money`, `today`, `price`, `supplier-invoices`, `suppliers`,
  `suppliers-pages`, `sales-report`, `borrowed`): 134 of 134 in 3.0 min.
- Journeys: 1113 by `--list` (1109 before).
- Types: `tsc --noEmit` clean; ESLint clean on every file touched; Prettier
  clean on what this batch changed — `today.spec.ts` and `styles.css` are
  unformatted on main and left so outside this batch's lines.

## Not covered

- A real phone; how a phone's reader stops on a column's lines.
- A place read slowly growing once read is not measured.
- The day tag's own million at 360 in the display face: no journey draws
  one there with the face checked.

## For the owner

- **Done:** in «Гроші» every place is now the stores side by side — the
  name, then the figure large, the words around it small — as on
  «Сьогодні»; small sums are drawn in the plain face so «18 450» and
  «16 450» read apart; the price sheet says one thing when the server does
  not answer.
- **To read:** a figure of a million or more stays at 24 in the narrow
  face on a 360 phone, as on «Сьогодні»; a store's figure is heard as one
  sentence, as before, but a phone's reader may stop on each line.
- **Still open:** В13-Т1 (the stocktake's and «Брак»'s words), В13-Г1/Г2,
  В13-П1/П2, В13-З1, В13-Т2 and the questions of earlier batches.
