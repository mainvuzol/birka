# «Усе на бірці», audit 2026-11-13, batch 12: no «Оновити» by any screen's title; the model menu's one name for a reader — 2026-11-15

Baseline: `f3210a06` (the audit's eleventh batch, PR #212, merged). After
it, every task left in the audit's five lists waits on the owner: В13-Т1,
В13-П1, В13-З1, В13-Г1, В13-Г2, the batch-15 «Каса»/«Замовлення»
question, the S12 vibration reading. The user chose from the findings
outside the lists (««Оновити» batch»).

No request body, right or rule of what is recorded changes. No words on
a screen change.

Status: built and proven, not committed, not yet seen on a real phone.
- The touched specs, on a fresh seed (`stock`, `goods-places`, `damaged`,
  `sales-report`, `openings-file`, `openings`, `backups`, `failures`,
  `more-lines`, `model`, `correct`, `stores`, `suppliers`,
  `supplier-invoices`, `borrowed`, `catalog`): 206 of 210. `backups:93` is
  the stand's state (14 nights seeded, 3 expected), as before this batch.
  The other three were this batch's own journeys meeting a read already
  on its way (see «The independent review»); fixed, each 3 of 3.
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 21 of 21 caught.
- The review's findings are fixed or left with a reason.
- Branch: `feat/audit-1113-header-refresh`.
- Chosen: business-rules.md, "Chosen in chat — 2026-11-15 (audit
  2026-11-13, batch 12: …)".

Where it stood:
- Ten screens had «Оновити» by their title: «Позичене й під реалізацію»,
  «Постачальникам», «Накладні», «Перевірка каталогу», «Магазини»,
  «Брак», «Залишки», «Початкові залишки», «Резервні копії», «Звіт про
  продажі». The direction's header holds the title, one line of
  context and «Змінити магазин» (design direction §5). Returns and orders
  had already dropped theirs, reading on entering and as the app comes
  back (`business-rules.md`, returns P0-1, orders P0-2).
- The money and goods passes asked to decide it once for all. The frame
  pass had left it (its §12) for after the owner approves the stage-2
  screens: built here ahead of that, as chosen in chat, and given to the
  owner as a reading.
- A model's detail named its «⋯» «Ще дії з моделлю» for a reader; every
  other menu is «Дії з …» (the frame pass, outside its section).

## What exists now

- No screen has «Оновити» by its title. `ScreenHeader`'s `aside` says
  so: «Змінити магазин», a section's «+», «До списку» — never «Оновити».
- Each list is read as its screen opens and as the app comes back
  (React Query: no list of these screens keeps its answer fresh, so a
  mount and a return read it again). A read that failed says so where it
  stood, with its own «Спробувати ще раз», as before: every one of the
  ten already had one.
- «Резервні копії» asks each time the screen opens
  (`refetchOnMount: "always"` on the screen's own read). «Ще» and
  «Сьогодні» read them at most once a minute, as before, and so does
  the screen as the app comes back.
- «Постачальникам» and «Накладні» keep their «+»; «Перевірка каталогу»
  keeps «Нова пропозиція». A «Накладні» without the right to record one
  has nothing by its title.
- What «Брак» said of a decision («Списали: …») stays as its list is read
  again on the app's return; «Оновити» let it go before. It goes with the
  next press.
- The model detail's «⋯» is «Дії з моделлю» for a reader.
- A list is read again on the way back to it inside its screen too:
  from a list of «Початкові залишки» or «Новий список», a proposal of
  «Перевірка каталогу», a store of «Магазини», a return of
  «Постачальникам», «Моделі» or «Продажі й повернення» of the report.
- «Накладні»'s total never read says «не вдалося прочитати» in its place,
  with one plate whose «Спробувати ще раз» asks it again.
- A decision of «Перевірка каталогу» refused as changed meanwhile has the
  proposal and the queue read again under the refusal.
- «Звіт про продажі» is `aria-busy` while a read is on its way.

## The independent review

A fresh agent read the diff with no conclusions given. It ran no
journey.

- **M1, fixed: «Накладні»'s total had no retry of its own.** Never read,
  it said «не вдалося прочитати» and nothing could ask it again but
  «Оновити». Now `Unreads` gives it the one plate, as «Сьогодні»'s tags.
- **M2, fixed: a list was not read again on the way back to it inside
  its screen** — the list's read stays mounted under a sub-screen. A list
  a lost send made did not show after «Назад» (the batch's own journey
  had needed `comeBack` for it). Each way back now reads its list again;
  that journey proves it without `comeBack`.
- **M3, fixed in part: «Оновіть перегляд» with nothing to press.** A
  decision refused as changed meanwhile now has the proposal and the
  queue read again. The words stay — the owner's reading, with «Оновіть
  список…» of a slow answer and of «Початкові залишки».
- **L, fixed:**
  - the business rule said «Списали: …» goes with the next press; where
    «Брак» is left empty there is none — it goes as the screen is left;
  - the report's `settled()` counted requests, and a request finished is
    not yet a read stored: it waits for the report's own `aria-busy` now;
  - `comeBack` fired on the window; a browser fires it on the document,
    bubbling — so it does now;
  - leftovers: an empty `.catalog-ways` on a proposal, stale comments in
    `Catalog.tsx` and `ScreenHeader.tsx`, CSS comments unwrapped.
- **L, left:**
  - as the app comes back «Залишки» reads its warehouses and their goods
    at once (the old «Оновити» read the warehouses first): a warehouse
    taken away may show «Немає доступу» a moment before it goes;
  - Telegram Desktop may not fire `visibilitychange` when another window
    was on top: the lists are read again as the screen opens;
  - «Брак»'s held row outlives later reads until the switch changes — as
    on main.
- **Found while proving, fixed:** a `comeBack` right after a screen's
  own read began joined that read (TanStack does not cancel a read on its
  way when the app comes back), so the journeys' new answers never came:
  each now waits for the screen's read to settle first.

## How it was built and proven

- Fixture (`frontend/e2e/fixtures.ts`): `comeBack(page)` — the app comes
  back to the screen (`visibilitychange`), the way a list is read again
  now.
- Journeys, changed — each press of «Оновити» is now the app coming back
  or the screen opened again:
  - `more-lines`: every row of the owner's «Ще» and «Товар і каталог»
    opens a screen with no «Оновити» by its title (nine of the ten;
    «Залишки» is not under the owner's «Ще», who has the till);
  - `stock`: «Залишки» has none; read again on return, nothing written;
    a refusal by the right, another refusal, a warehouse taken away —
    each on return;
  - `goods-places` («Перевірка каталогу»): a next page failed, then the
    queue read again on return;
  - `damaged`: read again on return; what was said of the last decision
    stays;
  - `sales-report`: read again on return, its failure said over what was
    read; `settled()` now waits until every read of the report is
    answered (it waited for «Оновити» to be free before);
  - `openings-file`: the lists read again on return;
  - `backups`: no «Оновити» while the state is on its way or after;
    opened again, it asks again;
  - `failures` (the watcher on «Резервні копії»): the screen opened
    again instead of «Оновити»;
  - `model`, `correct`: «Дії з моделлю», by its exact name;
  - from the review: `openings` (a list's «Назад»), `openings-file` (a
    new list's «Назад», with no `comeBack`), `catalog` (back to the
    queue; a confirm refused 409 reads the proposal and the queue again),
    `stores` (Telegram's «Назад» to the list), `suppliers` (a return's
    «← Постачальникам»), `sales-report` (`backToReport` waits for the
    read), `supplier-invoices` (the total never read, its plate and
    retry; no «Оновити» by the title).
- Journeys: 1143 by `--list`, as before — no new journey.

## Mutants

`~/.cache/birka-runtime/helpers/mutate60.py` (list, check, apply,
restore), run by `mutants60.sh`: each mutant applied, its one journey
run with no retries, the source restored.

- 12 at first. Three lived: «Накладні» and «Звіт про продажі» are not
  rows of the owner's «Ще» (they are «Гроші»'s), and «Дії з моделлю»
  matched «Ще дії з моделлю» as a part of its name. Their own journeys
  now check, by exact name; each caught.
- Then 9 for the review's fixes, each caught.
- By what they break:
  - «Оновити» back by a title (`borrowed`, `suppliers`, `invoices`,
    `catalog`, `stores`, `damaged`, `stock`, `openings`, `backups`,
    `report`);
  - «Резервні копії» asking as it opens (`backupsmount`);
  - the reader's name (`modellabel`);
  - a list read on the way back (`openingscancel`, `openingsclose`,
    `queueback`, `storesback`, `returnsback`, `reportback`);
  - the total's plate (`summaryretry`), a refused decision read again
    (`conflictreread`), the report's busy (`reportbusy`).
- `check` clean after the run; no keep file left.

## Not covered

- Not seen on a real phone or inside Telegram — in particular whether
  Telegram Desktop says the app came back.
- The whole suite: GitHub CI.
- `correct:440` («Знайшли товар…») fails on its own repeat on one stand
  (its first run's state); it passes on a fresh seed.
