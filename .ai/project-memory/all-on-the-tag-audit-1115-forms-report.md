# «Усе на бірці», audit 2026-11-15, batch 3: one look for a button taking no tap; one form for a warning's plate; the held till drawn, not faded; the catalogue's and the openings' plates; the order card's same-waybill plate led by a line and a triangle; «Покупці»'s two plates a store's state — 2026-11-16

Baseline: `36a17e41` (main after #216). The forms' batch: the frame's two
shared rules, P2-7 and P2-8
(`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-frame.md`), and
the sections' tasks that wait on them: sale P2-5, goods P2-1 (with its
observation on «Покупці»), orders-cash P2-2. Picked by «merged, go next».

Nothing recorded, sent or counted changes. No word on a screen changes,
except that a plate of two sentences is split at the first.

Status: built and proven; not committed; not yet seen on a real phone.
- Touched specs and their neighbours on a fresh seed: 531 of 532 (17
  files). The one failure was a journey that still expected «Внесок»'s
  ways to be filled in the primary before a sum; P2-7 point 1 (S21 №10)
  greys them as the main. It now checks the greyed look first, then the
  primary once a sum is keyed in.
- After the review's fixes: 59 of 59 (`design-system`'s held kinds,
  `outage`'s held till, `credits`, `credits-debt`, `returns-sale-screen`,
  `returns`); then, with the held look on a send too, 102 of 102
  (`till-redesign`, `till-basket`, `till-taps`, `credits-debt`,
  `design-system`).
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 46 of 51 caught; the five alive are equivalent (see «Mutants»).
- One independent review; its findings are fixed or left with a reason.
- Journeys: 1167 (1160 before).
- Branch: `feat/audit-1115-forms`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-16 (audit 2026-11-15, batch 3: …)".

## What exists now

- **A button taking no tap is drawn so** (frame P2-7). The 45 % fade
  is gone for buttons. Nothing moves, and the words are in pencil at
  4.5:1 or more in both themes.
  - The secondary, a quiet one, a chip and a segment: the fold with a
    dashed `edge`.
  - The main and a sheet's «Готово»: the hairline, no edge (§6.4). The
    till's and «Внесок»'s ways before a sum look the same (S21 №10).
  - A text button, the «←» line and a tag's model name: words only.
  - A chosen chip or way keeps its fill and its words, its edge dashed.
    The open segment, and «Повернути»'s chosen way, keep their card, with
    words in pencil and no ring.
  - «Пошкоджені»'s «−» and «+» are drawn as a secondary.
  - Unchanged:
    - a row taking no tap;
    - a press on its way;
    - a way stepped back;
    - the switch's track;
    - a size's cell, a catalogue's or a supplier's row, a tag and a card,
      at 45 %.
  - The rules stand last in `styles.css`.
- **One form for a warning's plate** (frame P2-8). `.warning-plate`, whatever
  the role:
  - an edge of 1 in `--warn-line`, corner 4, 42 at the left, and the
    triangle of 20 by the first line;
  - the lead `.notice-lead` in `--warn`, 600;
  - `.notice[role="alert"]` is on the same rule, its look unchanged.
- **The held till** (sale P2-5). `till-held` is on the till's section and
  on S21's whenever their fieldset is held (`blocked || working`):
  - the segment, the cells and the ways are stepped;
  - the search's words and its placeholder are in pencil;
  - a cell with no room keeps its fade.
- **The catalogue's and the openings' plates** (goods P2-1):
  - «Список кандидатів обмежено.» in «Схожі» and on «Пропозиція», with
    no role;
  - «Список … уже збережено…» and «… уже чекає / чекає список…», with
    `role="status"`, split at the first sentence;
  - «Магазин …, що почав цей список, не працює…» is `Banner kind="blocked"`
    and keeps `role="status"`;
  - the file's summary is a `t-meta` line;
  - «Моделі»'s «Така назва вже є…» is a lead line, and «Це інша назва —
    зберегти як є» is quiet.
- **The order card's same-waybill plate** (orders-cash P2-2): a lead line
  with the triangle of 16, no role. The send sheet's line is the model and
  is not changed.
- **«Покупці»'s two «Продано в «…»» plates**, on the debt and at
  «Внесок», are `Banner kind="blocked"`.

## How it was built and proven

Sources:
- `frontend/src/styles.css`;
- `sales/Sale.tsx`, `credits/Debt.tsx`;
- `catalog/Catalog.tsx`, `catalog/NewModel.tsx`, `catalog/Models.tsx`;
- `openings/Openings.tsx`, `openings/FileChooser.tsx`;
- `orders/Order.tsx`.

New and changed journeys:
- `fixtures.ts`: `tokenColour`, `expectHeldLook` (stepped, chosen, main,
  text) and `expectWarningPlate`.
- `design-system.spec.ts`:
  - in both themes, every kind held by hand on a probe over the screen —
    its look, its box ±1, its words at 4.5:1, the chosen keeping their
    fill;
  - «Повернути»'s way switch held by its fieldset;
  - two warning plates, with no role and with `status`;
  - screenshots `held-kinds-{light,dark}`, `warning-plates-{light,dark}`.
- `outage.spec.ts`: in both themes, the till a kept sale holds — the
  segment, the cell and its count, the ways, the search and its placeholder;
  the boxes ±1; a forced tap that changes nothing two frames later; a
  no-room cell at 45 %; screenshots `till-held-{light,dark}`.
- `catalog.spec.ts`: a proposal whose list was cut, in the sheet and on its
  screen; settled, no plate.
- `credits-debt.spec.ts`: S21 held while its own payment is kept; its
  ways over the debt greyed as the main; the debt's «Продано в» plate
  grey.
- `credits.spec.ts`: «Внесок»'s ways greyed before a sum, primary after.
- `cash-close.spec.ts`: «Закрити касу» before a sum, greyed as the main.
- `openings-file.spec.ts`: the summary a `t-meta` line; the three plates and
  the grey banner.
- `models.spec.ts`: the lead line; «Це інша назва» quiet.
- `orders-card.spec.ts`: the lead's colour and weight; the triangle.
- `stores.spec.ts`: «Внесок»'s «Продано в» plate grey.

## The review

An independent review (the CSS cascade, behaviour and roles, tests):
- **High: fixed.** «Пошкоджені»'s «−» and «+» kept their damaged fill when
  disabled. Their own rule outweighs the shared one, and the fade had
  been their only cue. Every line opens at 0 damaged, so its «−» looked
  pressable. They are now drawn as a secondary, and the probe checks them.
- **Medium: fixed.**
  - The «←» line over a title got the fold's fill while held: `.quiet`
    is lighter than the shared rule, and `.screen-header .back` sets no
    ground.
  - A tag's model name (`.model-open`) got the same fill.

  Both are now text buttons and are in the probe. A sweep of every
  borderless rule with no ground found no other button that can be held.
- **Low: fixed.**
  - «Повернути»'s chosen way kept its ring inside the dashed edge, with
    its words in ink. The ring now goes, and the words are in pencil;
    the probe checks it.
  - The forced tap on a held cell was checked before anything could
    re-render. It now waits two frames and compares the cell's words and
    the basket.
  - `till-held` was `blocked || pending`. The journal sets `pending`
    before it sends, so the class was already on during a send. It is now
    `blocked || working`, the same condition as the fieldset, so nothing
    fades in between. The comments say so.
  - The stylesheet's comment had `till-held` on «Повернути». It now
    says that «Повернути»'s form is drawn by the shared rules.
- **Low: left, decided and recorded.**
  - A size's cell in the basket, when held, is drawn as the other cells;
    its count stays on it.
  - The open tab keeps its pill, with its words in pencil, as the open
    segment keeps its card.
- **Low: proven by a mutant.** Whether the placeholder's colour can be read
  at all: see `placeholder` below.

## Mutants

`~/.cache/birka-runtime/helpers/mutate63.py`, run with `mutants63.sh`.
Each mutant is applied, its journey is run once (`pw-slow`, no retries),
and the source is restored. Every openings-file mutant runs on a fresh
seed.

- frame P2-7:
  - the stepped look: `stepdash`, `stepfold`, `steppencil`;
  - the cell's fade: `cellfade`;
  - the main: `mainhair` («Закрити касу»), `mainpressed`;
  - the text buttons: `textground`, `textline`, `textback`, `textmodel`;
  - the chosen: `chosencandidate`, `chosenfix`;
  - the segment and the ways: `segdash`, `segpencil`, `waychecked`;
  - the damaged stepper: `damagedheld`;
  - «Внесок»'s ways over the debt: `waysmain`.
- sale P2-5: `tillheld`, `tillheldnone`, `debtheld`, `heldcell`,
  `heldways`, `noroom`, `sizefree`, `search`.
- frame P2-8: `plateedge`, `platepad`, `plateclass`, `plateglyph`.
- goods P2-1:
  - the catalogue: `cutlead`, `cutleadsheet`, `cutplate`, `cutplatesheet`;
  - «Моделі»: `mergelead`, `astyped`;
  - the openings: `mineplate`, `minelead`, `otherplate`, `otherlead`,
    `stoppedbanner`, `stoppedrole`, `filemeta`.
- orders-cash P2-2: `waybillglyph`, `waybilllead`.
- «Покупці»: `tillbanner`, `debtbanner`.

The five left alive are equivalent:
- `rowfade`: a sale row in the 45 % list. `button.sale-row:disabled`
  outweighs the list and keeps the row at full strength.
- `mainedge`: the main's edge left dashed. Its edge is transparent, so
  nothing is drawn.
- `segpad`: the held segment's padding at 4. The box is its flex cell
  with a minimum height and the words centred, so nothing moves.
- `placeholder`: the till's search has its placeholder in pencil already
  (`.search-field`). The held rule matters for the till's price field
  «0,00», which this journey does not open.
- `waybillcolour`: the triangle's own colour removed. It inherits the
  lead's `--warn`, which is `var(--warning)`.

One more was equivalent in the first run: `chosenedge`, `.chip` taken out
of the chosen rule. A chip's own rule names no edge, so the shared rule
dashes it anyway. `.chip` has left the rule. A candidate in «Схожі» and a
way in «Змінити спосіб оплати», whose own rules name their edges, are now
in the probe. `chosencandidate` and `chosenfix` take its place and are
caught.

## Not covered

- The look on a real phone, and CI's font (DejaVu) against the Mac's at
  360.
- A held «Повернути» on a real kept return: the probe holds its parts by
  hand. The till and S21 are checked on a real hold.
