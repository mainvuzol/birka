# «Усе на бірці», audit 2026-11-13, batch 11: a warning's plate led by its line, never a heading; a rename's fork as «Нова модель»'s «Схожі»; a return, a delivery and «Покупці» held by whatever holds the till (goods P2-5, frame Д4) — 2026-11-15

Baseline: `2aad0aea` (the audit's tenth batch, PR #211, merged). After
it, only two of the audit's tasks waited on no one: goods P2-5 and the
frame list's developer check Д4. The user chose both («Yes, both»).

No request body, right or rule of what is recorded changes. No words
change.

Status: built and proven, not committed, not yet seen on a real phone.
- The touched specs, on a fresh seed (`models`, `receive`, `returns`,
  `catalog`, `credits-debt`): 131 of 132. The one failure was the fork's
  journey: an answer for the name as sent came back over the name as
  typed — fixed in the sheet (see the review). After it, on a fresh seed:
  `models` 33 of 33; the fork's journey 3 of 3.
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 18 of 18 caught.
- The review's findings are fixed or explained.
- Branch: `feat/audit-1113-catalog-forks`.
- Task: the audit's eleventh batch, after #211's merge (2026-11-15).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-15 (audit
  2026-11-13, batch 11: …)".

Where it stood:
- «Схожа назва вже є» (in «Нова модель», over a delivery and in a
  model's rename) and «Поки що не можна об’єднати» of a merge were
  warning plates headed by an `h3` — a heading inside a frame, which the
  direction has none of.
- A rename whose new name another model already has asked «Це вона — чи
  окрема модель зі схожою назвою?» in a warning's plate (`role="alert"`),
  with radios: one per model the server named, and «Окрема модель зі
  схожою назвою» a radio under them. «Нова модель»'s «Схожі» ask the same
  thing as rows with «Це вона» (the owner's reading, line 6).
- «Повернення»'s hold (`App.tsx`, its `blocked` list) left out four kept
  operations that hold the till and «Внесок»: a store's state, a
  supplier's return, an invoice's operation and a correction. A kept
  return confirmed while one of those was still kept let another return
  begin (frame Д4). The review found the same gap on «Прийшов товар» and
  «Покупці».

## What exists now

- **A warning's plate led by its line** (goods P2-5;
  `frontend/src/catalog/Similar.tsx`, `frontend/src/catalog/Models.tsx`):
  `<p className="notice-lead">` instead of the `h3`, in both plates. The
  plate stays (`.notice`, `role="alert"`); `.notice .notice-lead` in
  `frontend/src/styles.css` — the warning's colour, 600, 6 under it.
  `.merge-blockers h3` is gone. No `h3` is left in `src/catalog/`.
- **A rename's fork as «Нова модель»'s «Схожі»** (goods P2-5;
  `Models.tsx`'s `RenameSheet`): `section.rename-fork`, no plate.
  - The question is a `p.new-model-ask` with `role="status"`: said
    politely, never as an alert (review).
  - The models the server names are `ul.new-model-candidates` rows: the
    name, and a quiet «Це вона» with `aria-pressed` and the label
    «Це вона: {модель}». Nothing is pressed beforehand.
  - «Окрема модель зі схожою назвою», a quiet button under them, with
    `aria-pressed`. Pressed, it looks as a chosen «Це вона»
    (`.rename-fork > button[aria-pressed="true"]`, review), opens «Чим
    відрізняється модель» and puts the cursor in it.
  - Pressing one lets go of the other. «Зберегти назву» holds until one
    is pressed and, for another model, until what tells it apart is
    written (ADR-0002), as before.
  - A changed word of the name forgets what was pressed and written in
    the fork (`change()`, review).
  - An answer for words changed since they were sent is not shown
    (`edits`, found while proving).
  - No `type="radio"` is left in `src/catalog/`. «Нова модель»'s own
    «Окрема модель зі схожою назвою» checkbox is untouched.
- **A return, a delivery and «Покупці» held by whatever holds the till**
  (frame Д4; `App.tsx`): `storesUnsettled`, `supplierUnsettled`,
  `invoiceUnsettled`, `correctionUnsettled` join the `blocked` lists of
  «Повернення», «Прийшов товар» and «Покупці». Every other screen's
  hold is computed from lists that already have them; each screen leaves
  out only its own journal.

## The independent review

A fresh agent read the diff against the goods and frame task lists and
the owner's reading. It ran no journey.

- **H1, fixed: the fork's question was drawn red.** It was a `p` with
  `role="alert"`, and the app's global `[role="alert"]` style is a
  refusal's danger plate. It is `role="status"` now: a question said
  politely. The journey checks no ground and no `::before` mark on it.
- **M1, fixed: the same gap on two more screens.** «Прийшов товар» and
  «Покупці» left out the same four kept operations. Both lists have them
  now, each with a journey.
- **M2, fixed: «Окрема модель…» pressed looked as nothing.** Only «Це
  вона» had a chosen look. It has the same one now; the journey checks
  its ground.
- **M3, fixed: the fork's journey never looked at what was sent.** It
  now reads every rename's body: «Окрема» sends `new_model: true` and
  the note; nothing pressed sends `new_model: false`, no note; «Це вона»
  sends one of the models the server named.
- **L, fixed:**
  - `.notice-lead` alone lost its margin to `.notice[role="alert"] p:first-child`:
    it is `.notice .notice-lead` now.
  - The fork's rows and field kept their own width under
    `align-items: flex-start`: they stretch now.
  - A changed name kept what was pressed and written in the fork: it is
    forgotten now.
  - `expectNoticeLead` checked only the colour: now also that the line
    is the plate's first child, 6 under, 600, and the plate's warning
    ground.
  - `e2e/returns.spec.ts` is not formatted on main, and Prettier had
    rewritten it: rebuilt from main with the one new journey.
- **L, left: the cursor may drop to the page.** On iOS a tapped button
  takes no focus. «Це вона» tapped while the cursor is in «Чим
  відрізняється модель» takes the field away, and the cursor goes to the
  page. What was pressed shows as pressed, and nothing typed is sent.

**Found while proving, fixed: an answer for words no longer typed.** A
rename refused as «Це вона — чи окрема…» has the screen read the model
again before the sheet takes the refusal. A name changed in that time got
the fork back, for the name as sent; it was so on main. `RenameSheet`
counts each word typed, and an answer for words changed since they were
sent is not shown. Every run of the fork's journey failed on it before (8 of 8); 3 of 3 after.

## How it was built and proven

- Fixture (`frontend/e2e/fixtures.ts`): `expectNoticeLead(plate, lead)`
  — no heading in the plate; the lead a `p`, its first child, in the
  warning's colour, 600, 6 under it; the plate on the warning's ground.
- Journeys, extended:
  - `models`: the merge's blockers and a rename's similar name are led
    by their line; the rename fork's journey checks the question (a
    status, no ground, no mark), no alert or radio in the sheet, nothing
    pressed beforehand, «Окрема модель…» pressed (its look, the cursor in
    «Чим відрізняється модель»), and what each choice sends.
  - `receive`: the similar name over a delivery is led by its line.
- Journeys, new — each a kept operation confirmed on reload while the
  phone keeps an invoice operation it cannot read
  (`birka:supplier-invoice-pending:…` = `{not an invoice`):
  - `returns`: «Оформити повернення» and «Продаж» held;
  - `receive`: «Прийшов товар»'s search and «Продаж» held;
  - `credits-debt`: her card's «Внесок» and «Продаж» held.
- Journeys: 1143 by `--list` (1140 before).

## Mutants

`~/.cache/birka-runtime/helpers/mutate59.py` (list, check, apply,
restore), run by `mutants59.sh`: each mutant applied, its one journey
run with no retries, the source restored. A fresh seed before each run.

- 11 at first, each caught. Then 7 for the review's fixes and the find
  made while proving, each caught. The fork's 9 were run again once its
  journey passed, each caught at its own step.
- By what they break:
  - the plates' line (`similarh3`, `blockersh3`, `similarplate`,
    `leadcolour`, `leadweight`, `leadscope`);
  - the fork (`forkplate`, `forkstatus`, `forkchosen`, `apartpressed`,
    `apartchosen`, `howfocus`, `itlabel`, `changeforgets`,
    `staleanswer`);
  - the holds (`returnheld`, `receiveheld`, `creditsheld`).
- `check` clean after the run; no keep file left.

## Not covered

- Not seen on a real phone or inside Telegram.
- The whole suite: GitHub CI.
- The cursor dropped to the page on iOS (the review's one Low left).
