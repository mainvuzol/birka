# «Усе на бірці», audit 2026-11-15, batch 2: «Ще» with no line of its own; a switch off seen at 3:1, held alike; «Сьогодні»'s empty search, its folded tag and its day's words; a confirming sheet's «not now» a text button; one face for the `label` role — 2026-11-16

Baseline: `3e7ad787` (main after #214 and #215). The frame's task list of
audit 2026-11-15 gives its quick wins as its second batch: P2-1, P2-2,
P2-3, P2-4, P2-6 (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-frame.md`, §8).
Picked by «merged, go next».

Nothing recorded, sent or counted changes; no word on a screen changes.

Status: built and proven; not committed; not yet seen on a real phone.
- Touched specs on a fresh seed: 462 of 471 the first time (21 files).
  Three journeys of mine had not been brought to P2-1 and P2-2, and two
  more failed after them on the store they left (see «The review»).
- After the fixes, on a fresh seed: 190 of 190 (`cash`, `design-system`,
  `till-sections`, `stores`, `credits`, `credits-debt`,
  `supplier-invoices`, `suppliers`); then, after the cancel's check read the dark theme too, 156 of 156 (`cash-close`, `stores`, `credits`, `credits-debt`, `stocktake`, `openings`, `supplier-invoices`).
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 25 of 25 caught (one only after its journey was made stronger; see «Mutants»).
- One independent review; its findings are fixed or left with a reason.
- Journeys: 1160 (1157 before).
- Branch: `feat/audit-1115-frame-system`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-16 (audit 2026-11-15, batch 2: …)".

## What exists now

- **«Ще» names no store** (P2-1). `ScreenHeader` takes `bare`: no line under
  the title. `More` passes it on its root, which has no «←». «Змінити
  магазин» is there once, its row under «Цей телефон». «Товар і каталог»,
  pushed from «Ще», keeps the line.
- **A switch off is seen** (P2-2). Off, the track is `edge`, the knob
  `card`: 3:1 or more to the paper and the card, in both themes. On, the
  primary. Held, the track is at 45 % for «Ще»'s switch too, as the till's.
- **«Сьогодні»** (P2-3). Nothing found is the shared `Empty`, its one line
  the words as before. The folded day-tag has no `aria-expanded`.
  «продано · N шт.» is 16/23 at 400.
- **A confirming sheet's «not now»** (P2-4). `.sheet-cancel`: no edge,
  15/600 in `link`, 44 high, the foot's width, under the main. Eight places:
  S27, a store's state, a stocktake's start and finish, an opening list's
  approval, a debt's write-off and a customer's erasure, and `Reasoned`
  (an invoice's write-off and cancel, a payment's or a set-off's cancel, a
  supplier return's cancel).
- **One face for `label`** (P2-6). `.t-label` sets `--font-text`; «Ще»'s
  group `h3` carries `t-label` (0.06em, no longer 0.04em).

## How it was built and proven

- `frontend/src/shared/ScreenHeader.tsx`, `shared/More.tsx`, `styles.css`.
- `today/Search.tsx`, `today/Today.tsx`.
- `cash/Count.tsx`, `stores/Stores.tsx`, `inventory/Stocktake.tsx`,
  `openings/Openings.tsx`, `credits/Debt.tsx`, `suppliers/InvoiceActions.tsx`.

New and changed journeys:
- `design-system.spec.ts`: the `label` role on «Сьогодні», «Гроші» and «Ще»;
  the switch in both themes, off, on and held, in «Ще» and at the till.
- `fixtures.ts`: `expectSheetCancel`, called in `cash-close`, `stores`,
  `stocktake` (start and finish), `openings`, `credits-debt`, `credits`,
  `supplier-invoices` (cancel and write-off).
- `today-search.spec.ts`: nothing found through `expectEmpty`.
- `today.spec.ts`: no `aria-expanded`; the day's words 16/400/23.
- `till-redesign.spec.ts`, `more-lines.spec.ts`: «Ще» without a line, one
  «Змінити магазин»; «Товар і каталог» with it.

## The review

An independent review (correctness, regressions, specs):
- **High: fixed.** Three journeys still read the old screens:
  - `cash.spec.ts` looked for «Змінити магазин» on «Ще»'s line. It now
    checks that the row is held and that «Ще» has no line. The two
    journeys after it had failed on the drawer it left waiting for a reason.
  - `till-sections.spec.ts` measured «Ще»'s line. «Ще» is now measured
    with its card under its title.
  - The switch journey read the track's colour during its 120 ms move. It
    now waits for the colour.
- **Low: fixed.**
  - The label journey waited on `networkidle`, which a tab never reaches
    here. It now waits for each screen's read: the day's figures, the
    money's places, «Ще»'s groups.
  - Above 480 px, in the four feet that are a row of `.actions`, the main
    was not the foot's width, so «Скасувати» was centred under nothing.
    Those feet are `confirm-foot`: the main is the foot's width on any
    screen.
  - `expectEmpty`'s comment had moved onto the new helper. It is back.
  - In the light theme the link's colour is the ink's, so the cancel's
    colour check could not tell. It reads the dark theme as well (the
    surviving mutant, below).
  - Screenshots of the switch, on and off, in «Ще» and at the till, both
    themes; of the label role on «Сьогодні», «Гроші» and «Ще» at 360.
- **Low: left.** «Ще»'s held switch is held by hand in its journey: the
  same rule is checked at the till on a real hold
  (`till-redesign.spec.ts`, an unreadable kept invoice).

## Mutants

`~/.cache/birka-runtime/helpers/mutate62.py`, run with `mutants62.sh`. Each
mutant is applied, its journey run once (`pw-slow`, no retries), then
restored. After the run, `check` was clean and no keep file was left.

- frame P2-1: `bare`, `barealone`, `barenested`, `bareline`.
- frame P2-2: `trackedge` and `trackedgelight` (the hairline back),
  `moredim` («Ще»'s held track at full strength).
- frame P2-3: `foundempty`, `expanded`, `wordsbody`, `wordsline`.
- frame P2-4: one per sheet — `cancelcount`, `cancelstores`,
  `cancelstart`, `cancelfinish`, `cancelopen`, `cancelwrite`,
  `cancelerase`, `cancelreason`, `cancelreasonoff` — and the class's
  `canceledge`, `cancellink`, `cancelheight`.
- frame P2-6: `labelface`, `grouplabel`.

The first run left one alive: `cancellink` (the cancel in the ink's colour). In the light theme the link's colour is the ink's, so `expectSheetCancel` could not tell them apart. It now reads the dark theme too, where the link is the primary's lime, and the mutant is caught.

## Not covered

- The look on a real phone; CI's font (DejaVu) against the Mac's at 360.
- The empty search's place over the open keyboard (no keyboard in the
  browser run).
- A non-Telegram screen wider than 480 px, beyond the class's rule.
