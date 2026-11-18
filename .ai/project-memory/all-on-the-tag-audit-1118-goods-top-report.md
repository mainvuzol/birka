# «Усе на бірці», audit 2026-11-18, batch 5: «Перевірка каталогу»'s kept operation and its refusal under the title and line; «Інвентаризацію завершено» a result's screen, the menu back under it; «Брак» with no line repeating the frame's plate — 2026-11-18

Baseline: `fc83d2f7` (main after #228).

Points: goods P2-1, P2-2 and P2-6 (all P2). P2-1 + P2-2 are the goods
task list's batch «Верх экрана и итог»; P2-6 is the XS point of «Слова и
углы». Picked by «merged, go next».

Nothing recorded, sent or counted changes. No request, check, journal or
right changes. One line is gone (P2-6). «Змінити магазин» now shows on the
count's result, as on its twins'.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1201 (1200 before).
- Branch: `feat/audit-1118-goods-top`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-18 (audit
  2026-11-18, batch 5: …)".

## What exists now

- **«Перевірка каталогу»'s kept operation under the title and line**
  (goods P2-1):
  - `KeptCatalog` and its refusal stand right after the header, over the
    switch and the proposal, as «Моделі»'s stub.
  - The order: the paper plate → «Перевірка каталогу» (or «← Перевірка
    каталогу» «Пропозиція») and the line → the stub → the refusal → the
    screen.
  - The stub's form, words, sway and tear are as before. «Нова модель»'s
    sheet keeps its stub first.
- **«Інвентаризацію завершено» is a result's screen** (goods P2-2), as
  «Прийшло … шт.»'s:
  - Outside Telegram, «До інвентаризації» sits in its dock at the menu's
    top and sticks there on a long result. Inside Telegram it is
    Telegram's MainButton, with no dock.
  - The 0.7 s guard against the finish's second tap is as before.
  - The form's own dock and its room are gone.
  - Another operation's stub («Підрахунок записано один раз», not let go)
    stands over the result, never between its title and what it says.
  - Decided here: the menu is back under the result before it is
    painted, as on «Прийшов товар», «Борги» and the return to a supplier.
    With it «Змінити магазин» shows beside the line for whoever has two
    stores, as on the twins' results.
  - By the review, the stock is read again at the finish, so leaving the
    result by the menu shows it counted.
- **«Брак» has no line repeating the frame's plate** (goods P2-6): «Магазин
  не торгує: тут лише перегляд.» is gone. The plate says it over «Брак»,
  as over every screen. Д4 checked: `readOnly` is always `!trading`.

## How it was built and proven

Sources:
- `catalog/Catalog.tsx`: `KeptCatalog` and the refusal moved under
  `ScreenHeader`.
- `shared/Kept.tsx`: the comment names the catalogue's and «Моделі»'s
  stubs under their headers.
- `inventory/Stocktake.tsx`:
  - the result is a `ResultScreen` (`as="div"`), its section inside;
  - «До інвентаризації» is its dock outside Telegram, with the `late()`
    guard kept;
  - the dock's ref and `usePanelRoom` are gone;
  - the menu is aside while `done === null`, set in layout effects;
  - `inventory-stock` invalidated at the finish.
- `damaged/Damaged.tsx`: the line removed.

Journeys (3 specs):
- `catalog`:
  - `stubUnder(page, title)`: the stub at rest under the header's title;
  - the alias-feedback journey checks it on «Пропозиція»;
  - a new journey: a draft kept and lost again on reopening stands under
    «Перевірка каталогу»; a 500 to its check is said under the stub, over
    the queue; it is answered, then its proposal opens. At 360 × 640 in
    both themes, with full-page screenshots.
- `stocktake`:
  - the finish journey: a result's screen, no form's dock, the menu shown
    and `dockOnMenu` at 390 × 844 and 360 × 640 in both themes;
  - the kept-count journey now finishes with its stub not let go: the stub
    over the title, nothing in the result's screen. Its differences are
    drawn as five: at 360 × 640 in both themes the page scrolls, the dock
    stands, and the last difference ends above it, with screenshots;
  - the Telegram finish journey: a result's screen, no dock.
- `stores`: the plate over «Брак», «тут лише перегляд» nowhere.

Runs on a fresh seed:
- Touched specs (`catalog`, `stocktake`, `stores`, `damaged`, `models`):
  100 passed, 1 failed — my own new journey. The check's look at the
  proposal was not lost, so it settled by itself. It is lost now, as in
  journey 339.
- Rerun: 1/1. Then the order check, below: 1/1. The Telegram journey with
  its new check: 1/1.
- After the review's fixes, on a fresh seed, the same five specs: 101/101.

Found while proving: at 360 × 640 the queue's first proposal is not in
sight under the stub, as P2-1's criterion said. The title and the stub
with its paper words (488 high) fill the phone; the queue is one scroll
down. It was so over the title too. The stub's form is not this point's
to change, so the journey checks the order and takes full-page
screenshots. An owner reading.

## The review

An independent review read the diff against the three points, Д2–Д4 and
the twins. It found nothing High. `tsc` and ESLint are clean on the
changed files.

Checked and found right:
- the menu's flag on every path: «←» and Telegram's «Назад», a refused
  finish, «Знайшли товар…», a warehouse taken away, StrictMode; the entry's
  own flag never overlaps the count's;
- Д2: one room only, `--result-dock-h`; no place under the title; the
  region, focus, scroll, MainButton and the dock's `late()` as before; the
  dock's `main-mimic` 50 at 10;
- the look: the gaps, the stub's width and `.stocktake-done .stub-line` as
  before;
- the catalogue: nothing depended on the old order; the sheet case and the
  proposal's back as before;
- Д3: with no place the stub still sways on entry; Д4 holds;
- every new check fails on the old code.

Medium, fixed:
- **M1, a race in the Telegram finish journey.** The two new checks stood
  inside the 0.7 s in which the carried press must land. They are checked
  now once the press is let go.
- **M2, said now:** «Змінити магазин» on the count's result and the menu
  back inside Telegram too, as on the twins' results. In the rules entry.

Low:
- **L1, recorded:** the 0.7 s guard holds for the dock, not the menu, as on
  «Борги» and the return. The next audit's.
- **L2, fixed:** the stock is read again at the finish, however the result
  is left.
- **L3, fixed:** the catalogue journey reads its boxes in one frame; the
  refusal is the block right after the stub.
- **L4, fixed:** the kept-count journey checks the result's screen first;
  at 390 × 844 the finish's result never scrolls; the catalogue's order is
  checked in both themes.
- **L5, fine:** the kept-count journey now finishes its stocktake, so it
  can be run again; the new catalogue journey leaves one open proposal.

## Mutants

`~/.cache/birka-runtime/helpers/mutate74.py`, run with `mutants74.sh`. Each
mutant is applied, its journey is run once with no retries, and the source
is restored. A stocktake mutant runs on a fresh seed.

9 of 9 caught, each at its own check:
- goods P2-1: `stubover` (the stub and refusal over the title, new
  journey), `stuboverprop` (the same on «Пропозиція»), `refusalover`;
- goods P2-2: `doneplain`, `donestub` (no result's screen), `donemenu`,
  `donemenukept` (the menu left aside), `donedockin` (a dock inside
  Telegram);
- goods P2-6: `damagedline`.

`stuboverprop` first failed before its check: «Лоран» was not offered
(a crowded catalogue). After a reseed the plain journey passed (1/1) and
the mutant was caught at its check.

After the review's fixes all 9 were run again: caught, `refusalover` at
the refusal found as the block right after the stub. `stuboverprop` again
failed before its check after a whole `catalog` run on the same seed; on a
fresh seed it was caught at `catalog.spec.ts:120` from `:672`.

## Not covered

- The look on a real phone, in Telegram.
- The full suite is left to CI.
- What is left of the audit 2026-11-18:
  - sale P2-1, and P2-4 (waits for «Прибрати» to be read);
  - orders-cash P2-3, P2-4;
  - money P2-3 (waits for Д1, a real phone);
  - goods P2-3 + P2-4, and P2-5.

  В18-К1 and the set-off limit wait for the user's pick too.
