# «Усе на бірці», after stage 2's audit, batch 3: a button the secondary one unless it says it is the screen's main; fields, the ring, what is said under and the weights by §4; one Unread, the lint holding it; «Магазини»' words; one Empty — 2026-11-09

Baseline: `c220c4a9` (the audit's second batch, PR #184, merged), and
three tasks of the audit after stage 2:
- [frame P1-1, part 1](redesign/2026-11-09-redesign-tz-after-stage2-frame.md)
  — the base buttons, fields, the focus ring and what is said under, by §4
  and §6 of the direction (part 2 — the mode switch, the menu, the radii
  off the scale, the dead rules, `index.html` — is a later batch);
- [frame P1-2](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  one plate for a read that failed, a rule for the whole app; «Магазини»'
  kept stub;
- [frame P2-1](redesign/2026-11-09-redesign-tz-after-stage2-frame.md) —
  the empty state's component.

Status: built; proof below — 1015 of 1016 journeys on a fresh seed, the one the known Mac-only failure. 46 of 46 mutants caught. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-controls`. Task: the audit's third batch, chosen
in chat after #184 was merged (2026-11-09, «Yes, start batch 3»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-09 (audit after stage
2, batch 3: …)". No owner's question is open for these tasks; В-К1 stays
as it was.

Where it stood:
- the base `button` was the main: the primary's fill, radius 11, 16/650,
  48 high — 72 of 359 buttons had no class, so a retry in a plate, an
  empty place's «Новий продаж» or «Зрозуміло» stood as black as the
  screen's main, beside Telegram's MainButton; «Спробувати ще раз» before
  a store black on two blank tags and a quiet link on the third;
- fields radius 9 and always the fold; a label 14/650 whose weight what
  was typed took; the focus ring 3 at 3; `small` and `.hint` 13, «Ще»'s
  meta 13; 27 rules at 650, two at 750;
- a read that failed drawn three ways: the shared `Unread` (51 calls), 11
  yellow copies of its markup, and 16 bare red alerts (8 in «Покупці», 8
  in «Товар») — nothing kept a new one from being red;
- «Магазини»' kept stub said «Незавершена зміна стану» and «Перевірити
  результат»;
- the empty place drawn three ways: `orders-empty` with the blank tag (9
  places), «Сьогодні»'s own copy of it, the bare `.empty`.

## What exists now

- **A button is the secondary one** — the card, an edge of 1, ink,
  15/600, 44 high at least, the corner 8 — **unless it says it is the
  screen's main:** `.primary`, the primary's fill, 52 high, 17/700, the
  corner 8. Telegram's MainButton's place outside Telegram
  (`.main-mimic`) is one too.
  - **33 places in 25 files say they are the main**, each where no
    MainButton stands: «Новий продаж» in the result's dock and after
    nothing was sold, «Готово» on a recorded invoice and a closed drawer,
    «До замовлень», «Прийняти повернення», «Записати причину»,
    «Перезапустити», «Прийняти ще», «Так, стерти дані покупця», the
    write-off, the drawer's panels' sends, a sheet's «Готово» and a
    picker's choice, a return's record, a store's change confirmed,
    «Позначити проданим · N шт.».
  - Everything else is the secondary: a plate's retry, «Зрозуміло»,
    steppers, an empty place's offer, the shortfall's answers, a yes or no
    asked in the content, a sheet's list of ways, «Клієнт забрав»'s ways.
  - **The till's three ways and a debt payment's** are each the primary at
    17/700 — the button is the sale (§6.15, S21).
  - **Before a store** — «Вхід через Telegram», «Магазинів поки немає», a
    store that stopped trading — «Спробувати ще раз» is the text button,
    as S03's.
  - **The supplier picker:** in its own sheet «Додати постачальника» is
    that sheet's main, and «Повернути постачальнику» hides Telegram's
    MainButton while the sheet is over it; inside another sheet it is the
    secondary.
  - **One main a screen at most**, its own or Telegram's, on S04, S07,
    S08, S16, S19, S25 and S29, with every list failing too.
  - A row, a picker's line, a tray, a tag or a size's cell that is a
    button reads in the body's 16, as before.
- **A field:** the corner 8, typed 16/400, the card on the paper and the
  fold in a white block (a sheet, the pay panel, a dock, a list's block);
  a search in a sheet the fold too; the keypad's sum its own card.
- **The focus ring** 2 at 2 for every control; inward inside a tag, as
  before.
- **What is said under** — `small`, `.hint`, «Ще»'s meta — 14/500 in
  pencil; a label 14/700.
- **No weight but the roles'** — 400, 500, 600, 700, 800 — in the
  stylesheet: the 650s are 600 or 700, the two 750s 700.
- **One plate for a read that failed:** the shared `Unread` — the
  warning's plate, one line in the screen's words, the secondary
  «Спробувати ще раз». It takes `held` (asked again, not answered: no
  second ask) and lines under its line («Каса»'s close while the server
  does not answer). The 11 yellow copies and «Покупці»'s 8 red ones are on
  it; their words and retries as before.
- **The lint:** an element whose own `role="alert"` holds a `readText(`
  call is an ESLint error outside `shared/Unread.tsx`. The 8 places of
  «Товар» carry a marked exception each until goods P1-1 moves them.
- **«Магазини»' kept stub:** «Зміну стану магазину ще не підтверджено»,
  «Перевірити результат зміни».
- **One empty state:** `shared/Empty.tsx` — the blank tag at 64 in the
  edge, a line 17/600, a line of meta when needed, what the place offers;
  a section headed by its line where the screen focuses it. «Сьогодні»'s
  «Вас нічого не чекає.» and the 9 places already drawn alike are on it.

## Decided here, not by the owner

Each is in business-rules.md with its reason.
- **Which buttons are the main:** the TZ named one («Новий продаж» in the
  result's dock) and the rule; the other 32 were sorted by «one main a
  screen» — a screen's or a sheet's finishing action where no MainButton
  stands.
- **The pay ways:** the till's and a debt payment's the primary
  (§6.15's «the button is the sale»); «Клієнт забрав»'s the secondary
  (§6.15's «a choice, then the MainButton»). «Каса»'s fix ways keep their
  own look.
- **The quiet button** takes the secondary's type and height (15/600, 44;
  it was 16/650, 48).
- **The server's banner's «Оновити»** left the secondary; §6.23's text
  button there is the orders-cash TZ's.
- **«Покупці»'s 8 red copies** are on `Unread` here: the frame TZ gave
  them to the sale TZ's P1-2 and that one pointed back at the frame's
  rule.
- **The lint is on now**, not after the sections' tasks as the TZ put it:
  the 8 goods places are marked, so a new copy anywhere fails at once.
- **9 empty places beyond «Сьогодні»** moved onto `Empty` — the same
  markup, nothing else changed. The orders' search with nothing found (no
  mark) is left to orders-cash P2-3; the bare `.empty` places to their
  sections.
- **The two 750s** (a debt's sum on its row, the drawer's difference) are
  700, the nearest role; §4's money as list text at 600 is left to their
  sections.
- **A row, a tag, a size's cell that is a button** keeps the body's 16 —
  the new base's 15 is a button's.

## How it was built and proven

- **Files:**
  - `frontend/src/styles.css`: the base button, `.primary` and
    `.main-mimic`; the focus ring; `small`, `.hint`, `.more-meta`, the
    label; fields and the fold in a white block (`:where`, so a field's
    own look wins); every 650 and 750; the 16 of rows, tags and cells;
    the pay ways; the ink tag's colour; the edge gone from the chips, the
    damaged stepper and `.copy-id`; the empty state's heading, `hidden`
    and «Сьогодні»'s link; the search in a sheet;
  - 25 files of `frontend/src/` with `.primary` where the main is;
    `frontend/src/App.tsx` the three text buttons before a store;
  - `frontend/src/shared/Unread.tsx`: `held`, lines under; 19 copies
    replaced in `returns/Returns.tsx`, `cash/Closed.tsx`, `cash/Cash.tsx`,
    `catalog/Catalog.tsx`, `catalog/NewModel.tsx`,
    `inventory/CatalogPicker.tsx`, `sales/FromCatalog.tsx`,
    `sales/Sale.tsx`, `sales/paperMark.tsx`, `credits/Credits.tsx`,
    `credits/Customer.tsx`, `credits/Debts.tsx`;
  - `frontend/eslint.config.js`: the rule; 8 marked exceptions in
    `catalog/FamilySearch.tsx`, `inventory/Model.tsx`, `Receive.tsx`,
    `Stock.tsx`, `Stocktaking.tsx`, `openings/Openings.tsx`,
    `prices/SuggestedPrice.tsx`;
  - `frontend/src/shared/Empty.tsx` (new) and its 10 places in
    `today/Today.tsx`, `suppliers/Borrowed.tsx`, `Suppliers.tsx`,
    `SupplierList.tsx`, `Invoices.tsx`, `damaged/Damaged.tsx`,
    `returns/Returns.tsx`, `orders/Orders.tsx`;
  - `frontend/src/stores/Stores.tsx`: the stub's words;
  - `frontend/src/suppliers/Picker.tsx`, `NewReturn.tsx`: the picker's
    add, its sheet told to the screen.
  - No backend change.
- **Journeys:** 1016 in all, 1011 before.
  - `e2e/design-system.spec.ts`, 4 new: one main a screen at most on S04,
    S07, S08, S16, S19, S25, S29 in Telegram, its own or Telegram's (the
    till's ways one main together), and again with every list failing —
    the plate on «Продаж», «Замовлення», «Гроші», «Каса» and «Покупці»,
    its retry the card and not the main; in both themes, a button, the
    main, a field in its label and in a sheet, the keypad's sum, a search
    in a sheet, a row, a hint, `small`, «Ще»'s meta and a label as drawn,
    a real button's ring reached by Tab, and no weight but the roles' in
    the stylesheet.
  - `e2e/suppliers.spec.ts`, 1 new: in Telegram the supplier's sheet over
    «Повернути постачальнику» hides its MainButton, «Додати
    постачальника» the sheet's one main; picked, the MainButton is back.
  - `e2e/fixtures.ts`: `expectEmpty` — the blank tag 64 in the edge, the
    line 17/600 in ink; `addSupplier` — «Додати постачальника» the main in
    its own sheet, the secondary inside another.
  - Changed: «Новий продаж» the receipt's one main at 52 and 17/700
    (`till-receipt`); the stub's new words and the text button with no
    main before a store (`stores`); `expectEmpty` on «Вас нічого не
    чекає.» and «Накладні»'s empty place, «Зроблено сьогодні» 8 under its
    line (`today`, `supplier-invoices`); the ink tag's ring 2
    (`cash-close`); the till's and «Внесок»'s ways the primary
    (`till-tray`, `credits`); the collect ways scrolled by whole pixels
    (`orders-card`).
- **The style collector:** a temporary hook in `e2e/fixtures.ts` read
  every button's, field's and hint's computed style in every journey,
  before the change and after it (29 478 and 29 687 readings), and a
  script compared them by class. It found what leaned on the old black
  base — the till's and «Внесок»'s ways white, the ink tag's ink, chips
  and the damaged stepper with an edge, rows, tags and the folded line at
  15, the keypad's sum on the fold — each fixed and in a journey or a
  probe. The hook is gone from the branch.

## The independent review

An independent reviewer read the diff against `main` with the three
tasks, the direction's §4–§6 and the spec's §5.5, §6.5, §6.6, §6.15,
§6.23 and §6.28; it ran the linter and the type check, and probed the lint
rule with ESLint in memory. No blocker. Settled in the code or the
journeys:
- **Two mains in a sheet:** the supplier picker's «Додати постачальника»
  said it was the main inside «Як надійшов» (whose foot is) and «Брак»'s
  supplier step (whose MainButton is); in its own sheet over «Повернути
  постачальнику», Telegram's MainButton stood over it. Now the secondary
  in place, and the return's MainButton hidden while the sheet is open; a
  journey holds both, and `addSupplier` checks the class wherever it adds.
- **`Empty`'s `hidden`** hid nothing by itself — its own `display: flex`
  won over the browser's; now it hides.
- **«Зроблено сьогодні»** went 8 lower under «Вас нічого не чекає.» (the
  empty state's button margin); now where it was, measured.
- **A search in a sheet** stayed white on the sheet's white; now the fold.
- **The «one main» journey** passed if any one screen showed a plate, and
  glanced for it once — now it waits for each and names the five; it
  counted the till's ways as nothing — now as one main together.
- **The computed styles** were read in the light theme alone — now both.
- **The lint's reach** is written in its comment: it catches an alert's
  `readText(` at any depth, with no false alarm among the shapes tried; it
  does not see `role={"alert"}` or a text read into a name first.
- Seen and left: outside Telegram a page's own main stays drawn under a
  modal sheet with its own (two places, dimmed and out of reach); the
  catalog's stub still says «Незавершена» (goods P1-4); the focus check
  reaches the first button «Сьогодні» offers by Tab, not one of its own.
- Found by the first full run, not the review: the two 750s the static
  check named; the collect ways scrolled half a pixel under the sheet's
  edge (the journey scrolls by whole pixels now).

## Mutants

`~/.cache/birka-runtime/helpers/mutate33.py`: 46 mutants, each undoing
one thing this batch made — 40 of the three tasks, 6 of the review's
fixes. `mutants33.sh` ran each against the journeys that should catch it,
on a fresh seed each, one failure ending the run; the lint's mutant by
ESLint over `src/`.
- **The three tasks:** the base button (its fill, edge, corner, height,
  ink, size, weight); the main (its height, edge, size, weight, fill; the
  receipt's «Новий продаж» unclassed; the text button before a store made
  the main); the pay ways (the tray's, the dock's); the ring (its width,
  its offset, the ink tag's); what is said under (its size, weight,
  colour; «Ще»'s meta; the label's weight); a field (its corner, fill,
  size, weight; the fold in a sheet; `:where` back to `:is`); rows at 16;
  `Unread` (its retry the main, the lines under it gone); a goods place's
  lint mark taken off; «Магазини»' two words; `Empty` (the shared class,
  the blank tag, the line's role, the heading's).
- **The review's:** the picker's add the main in place; the return's
  MainButton not hidden; the picker's sheet not told; «Зроблено сьогодні»'s
  8; a search in a sheet on the card; a 750 back.
- **46 caught in the first pass**: 45 journeys failed at an assertion
  about what each changed, and ESLint flagged the unmarked goods place.
  One of them — «Перевірити результат» back for «Перевірити результат
  зміни» — was caught only by a click that waited until the journey's
  timeout; the journey now looks for the button by its words first, and
  run again it is caught there.
- Logs: `go-mutants33.log`, `go-mutants33-tight.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean. Prettier is clean on the files that were clean at the
  baseline and on `shared/Empty.tsx`; in the files that were not, this
  batch adds nothing to what it would change.
- **Every journey,** on a fresh seed, one worker: 1015 of 1016 in 27.4
  minutes — `go-b3-full.log`. The one: `backups.spec.ts:93`, «the owner is
  shown last night's failed copy…» — this Mac's backups' history, failing
  alike on the last baselines; GitHub's run is the proof.
- **The first full run after the change,** with the collector — 1009 of
  1014, `go-b3-after.log`: the Mac's one; the ink tag's ring still asked
  at 3 (`cash-close`, both themes); the computed-style journey's Tab
  landing on a tag's inward ring; the collect ways clipped by half a
  pixel (`orders-card`). Each settled in the journey.
- **The affected specs while building,** each on a fresh seed:
  - `design-system`, `cash-close`, `orders-card`, `till-tray`, `credits`,
    `credits-debt`, `till-receipt` — 179 of 180, `go-b3-fix1.log`: the one
    the static weight check naming the two 750s, then made 700;
  - after the review's fixes, `design-system`, `suppliers`, `today`,
    `supplier-invoices`, `damaged`, `receive`, `cash-close`,
    `credits-list` — 163 of 164, `go-b3-fix2.log`: the one the «one main»
    journey run to learn which screens draw a plate, then named.
- **The style diff, before and at the end** (`b3-audit-before.jsonl`,
  `b3-audit-final.jsonl`): what is left is the tasks' — secondary faces,
  15/600 and 44 for buttons, the corner 8, hints and «Ще»'s meta at 14,
  fields 16 and the card on the paper, the 650s and 750s — or a state
  caught at another moment (pressed, held, a segment chosen). One more,
  kept: a quiet button standing in a smaller line — «Оформити повернення»
  under a sale (13), «Шукати там» (14) — reads at the button's 15.

## For the owner

- Nothing to answer for these tasks. What changes for the eye: one black
  button a screen at most; retries, «Зрозуміло» and the like white with
  an edge; hints a size larger. The words change only in «Магазини»'
  unconfirmed change.

## Not covered

- A real phone: the buttons in Telegram's own themes; the ring on a
  keyboard attached to a phone.
- Outside Telegram, a page's own main stays drawn under a modal sheet with
  a main of its own — the customer's dock «Внесок» under the write-off and
  erase sheets, «Закрити касу» under the count's confirmation; dimmed and
  out of reach. In Telegram the MainButton is hidden there.
- The catalog's kept stub still says «Незавершена операція каталогу»
  (goods P1-4); frame P1-2's third criterion waits for it.
- The lint does not see `role={"alert"}` or a text read into a name
  before the alert.
- `Empty`'s `hidden` is held by a journey only on «Сьогодні», the one
  place that passes it.
- Frame P1-1's part 2 — the mode switch, the menu, the radii off the
  scale, the dead rules, `index.html`.
