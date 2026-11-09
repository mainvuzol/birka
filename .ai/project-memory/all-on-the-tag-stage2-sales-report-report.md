# «Усе на бірці», stage 2's thirteenth batch: «Звіт про продажі» — «Гроші»'s periods as one switch, days of one's own in a sheet; one table, a column a store and «Усі разом»; «Моделі» and «Продажі й повернення» each a screen of its own — 2026-11-08

Baseline: `b23da22e` (batch 12, PR #181, merged), and the money task
list's last point ([P1-1](redesign/2026-11-05-redesign-tz-stage2-money.md)),
its decisions and acceptance. With it, stage 2 is built whole.
Status: built; proof below — 998 of 999 journeys on a fresh seed, the
one left failing on this Mac alone, as before; 59 of 59 mutants caught. CI is
GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/stage2-sales-report`. Task: the thirteenth batch, chosen in
chat after #181 was merged (2026-11-08, «Yes, start it»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-08 (stage 2 batch 13:
«Звіт про продажі» — …; money P1-1)". The owner's В4 and В5 were open;
both built by (а), as chosen in chat: the periods are «Гроші»'s, «Як
рахуємо ›» opens a sheet.

Where the report still did its own way:
- a hint of three lines over everything; four buttons of days in words
  other than «Гроші»'s — «Цей тиждень», «Цей місяць» against «Тиждень»,
  «Місяць» — and two date fields always on the screen;
- each store a block of three tables, «Усі магазини разом» one more: to
  compare «Центр» with «Ринок», scroll;
- the models and fifty sales on the same screen, their store picked in a
  native list «Моделі й продажі», «Попередні / Наступні»;
- «од.» beside «шт.» elsewhere.

## What exists now

- **The period:** «Сьогодні · Вчора · Тиждень · Місяць», «Гроші»'s own
  periods and days, by the server's today; the report opens on the period
  chosen on «Гроші». Under it a quiet «Інші дні» — with days of one's own
  «03.10 – 05.11 · Змінити», nothing pressed above — opening the sheet
  «Інші дні»: «Від», «До», «Показати». Days refused: the server's words as
  an alert, no «Спробувати ще раз». The line under the title says the
  period and its days, «Тиждень · 02.11 – 05.11»; a day of another year
  carries it.
- **One table:** rows down, a column a store («в архіві», «заблоковано» as
  on «Гроші»), «Усі разом» — the server's `total` — with two or more; «грн»
  once in the corner. ПРОДАЖІ: «Продажі» with «12 · 15 шт.», «Повернення»
  with «1 · 1 шт.», «З урахуванням повернень». ГРОШІ: «Оплачено одразу
  повністю», «Внески за борг», «Віддано при поверненнях», «Виправлення
  способу оплати» where any store has it, «Разом». ЗА СПОСОБОМ ОПЛАТИ:
  «Готівка», «Картка», «Переказ», «Не вказано» where any. ОКРЕМО ВІД
  «РАЗОМ» — ЗАМОВЛЕННЯ: «Переказ наперед», «Накладений платіж» where any.
  Under it, a line a store whose way was corrected. Wider than the phone,
  the table alone scrolls, its first column fixed, a column coming to rest
  whole beside it.
- **How old it is,** only while today is in the days and the answer is
  older than five minutes.
- **«Моделі ›» and «Продажі й повернення ›»** under the table, «Як рахуємо
  ›» under them — a sheet of the three sentences, unchanged.
- **«Моделі»:** its own screen, «← Звіт про продажі», the period under the
  title; the store's switch «Усі · «Центр» · «Ринок»» with two stores or
  more, a row of chips with four or more; a row a model, «15 шт. ·
  повернено 1 шт. на 1 850,00 грн», the sum sold; «Нічого не продано.».
- **«Продажі й повернення»:** its own screen, the same switch; a thread by
  day, the newest first, the day said once; «Продаж …» / «Повернення −…»,
  the hour, who and the goods, how it was paid, whose store where several
  are shown, the paper it was typed from; «Показати ще» fifty at a time,
  an entry never twice; «Ні продажів, ні повернень.».
- The store chosen is kept between the two screens; back, the report where
  it was, the cursor on the row that opened the screen.

## Decided here, not by the owner

All in business-rules.md under the heading above. In short:
- **A day of another year carries it:** «30.12.2025 – 02.01».
- **A row only some stores have** reads «0,00» in the others.
- **The table's first column fixed at 118 px,** a column coming to rest
  whole beside it: a figure cut at its edge read as another figure. A
  section's name wraps within what stays in view as the stores scroll.
- **The period kept as chosen,** days of one's own staying one's own even
  where they are a period's.
- **The store chosen kept between «Моделі» and «Продажі й повернення»,**
  forgotten when the report is left; each screen opening at its top, the
  cursor on its title; back, on the row that opened it.
- **The taps:** a week is three from «Гроші»; one store's yesterday is
  five, but the rows stand under the table, as the task list draws them,
  so at 390 × 844 with two stores they are reached with one scroll — the
  acceptance asked for none (For the owner).

## How it was built and proven

- **Files:**
  - `frontend/src/reports/SalesReport.tsx` (rewritten): the switch, «Інші
    дні» and its sheet, the age, the ways, the two screens and their
    focus, «Як рахуємо»;
  - `frontend/src/reports/ReportTable.tsx` (new): the one table, its
    rows only where any store has them, the notes, the room after the last
    column;
  - `frontend/src/reports/ReportModels.tsx`, `ReportEntries.tsx` (new):
    the two screens, the thread and its pages;
  - `frontend/src/reports/StoreSwitch.tsx` (new): the switch, or chips;
  - `frontend/src/reports/format.ts` (new): the figures' and the days'
    words;
  - `frontend/src/money/Money.tsx`: `StoreName` shared;
  - `frontend/src/money/reads.ts`: the report's own read always fresh;
  - `frontend/src/shared/ModeSwitch.tsx`: a way held on its own;
  - `frontend/src/App.tsx`: the report opens on «Гроші»'s period and its
    days, both;
  - `frontend/src/styles.css`: the screens above.
  - No backend change.
- **Journeys:** 999 in all, 993 before.
  - `e2e/sales-report.spec.ts`, 3 rewritten, 6 new:
    - rewritten — the owner's table, column by column, and both screens;
      the manager's store alone; the periods as «Гроші»'s, «Інші дні», the
      refusal, and days of another year;
    - new — at 390 × 844 with two stores, the fold, the taps, «Усі разом»
      the server's, no select, «Як рахуємо», a screenshot; at 360 px with
      three stores in both themes, the rows only «Вокзал» has, the note,
      the scroll and its snap, 4.5:1, the place kept, chips with four
      stores, screenshots; the thread by day, the paper, its pages, a page
      that failed, another year's day, «Моделі», Telegram's «Назад», a
      re-read that failed; how old it is; a Monday and the 1st, opened on
      «Гроші»'s period and read again, «Сьогодні» never held, a failed
      «Оновити».
  - `money.spec.ts`, `outside-text.spec.ts`, `outage.spec.ts`,
    `outage-mark-debts-returns.spec.ts` changed to the new screens.

## The independent review

An independent reviewer read the diff against `b23da22e` with the TZ,
the rules and the journeys; it ran the type check and the linter and
measured the snap in a page of its own. One high and eight lower; each
settled in the code or the journeys, and the ones that change what a
person sees written in business-rules.md («Settled in the review»):
- **High — the period guessed from its days:** the pressed period was the
  first whose days matched. On a Monday «Тиждень» is today alone, so it
  pressed «Сьогодні» and the line said «Сьогодні · 09.11»; on the 1st
  «Місяць» did the same; opened from «Гроші» on a Monday with «Тиждень»,
  the report opened on «Сьогодні». The period journey, on the real
  server's today, would have failed from 2026-11-09. Now the period is
  kept as chosen, and «Гроші» hands the report its period with its days;
  a journey stubs a Monday and the 1st.
- **The money's rows had no journey:** every stub had nothing of no way,
  no correction, no order paid off the till. Now «Вокзал» has all three
  at 360 px: the rows only it has, «0,00» in the others, «Окремо від
  «Разом»» with «Переказ наперед» alone, and the note under the table;
  at 390 px none of them.
- **The table could lag a minute:** read with «Гроші»'s minute, a sale
  made since was on «Продажі й повернення» and not in the table. Now the
  report reads again each time it is opened or its days chosen.
- **The five taps «without a scroll» are not met** at 844 with two
  stores: recorded, the journey's title says the scroll, and the owner is
  asked (below).
- **Journeys claimed more than they checked:** «four stores» had three —
  now a fourth is added and the chips are read; «Telegram's «Назад»»
  pressed the screen's button — now Telegram's event.
- **The whole switch held** until today was known: now «Сьогодні» never
  is.
- **Failures:** a page that failed showed «Спробувати ще раз» and
  «Показати ще» together — now the retry alone; «Моделі» and the table
  said nothing of a re-read that failed — now both say it.
- **The table's scroll across** was lost on coming back — kept.
- **The thread's day of another year** was «31.12.25», wider than its
  column and by the phone's year — now «31.12» with «2025» under it, by
  the server's.

**Seen in the screenshots,** after the full run, and settled:
- **Scrolled to the end, «ОКРЕМО ВІД «РАЗОМ» — ЗАМОВЛЕННЯ» lost its start**
  and read «РАЗОМ» — ЗАМОВЛЕННЯ» — the other way round. A section's name
  sticks within the table, and the room left after the last column let
  the table scroll past where the name could follow. Now, while the table
  scrolls, the name wraps within the first column and the last; a journey
  finds every section's name whole in view at the end.
- **A sliver of the figures under the first column** showed at its left
  edge beside «Разом» and «Готівка»: at the phone's 2.625 device pixels to
  a CSS pixel, the table's edge falls inside a device pixel, and the
  column's background starts at the next one. A shadow to its left was
  clipped with the scroll; a strip of the page's background just inside
  the column's edge covers it, short of its words. Checked by eye in both
  themes' screenshots, scrolled and not: no assertion reads a pixel.

## Mutants

`~/.cache/birka-runtime/helpers/mutate30.py`: 59 mutants, each undoing
one thing this batch made — 47 of the point itself, 11 of the review's
fixes, 1 of the screenshots' (`labelroom`) — run by `mutants30.sh` against the journeys that should catch it,
on a fresh seed each, one failure ending the run.
- **58 of 58 caught,** in one pass, each at an assertion about what it
  changes, and `labelroom` after it, at the section's name out of view —
  **59 of 59**; two (`todaykept`, `morebutton`) by a tap that waits for a way
  the mutant holds or hides, which never comes.
- The journeys were tightened for them before the pass, from the list
  made with the plan: the rows only some stores have and the note
  (`notstatednever`, `ordersnever`, `correctedrow`, `correctedzero`,
  `notes`); none of them at 390 px and nothing to scroll there
  (`notstatedalways`, `ordersalways`, `roomnarrow`); chips with four
  stores (`chipsfour`); another day's first entry says its day
  (`dayfirst`); days of another year (`dayyear`).
- Two of the plan's mutants went with the code they tested: `chosenOf`,
  the period guessed from its days, is gone.
- Logs: `go-mutants30.log`, `go-mutants30-label.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean; Prettier clean on the files written whole, and on
  every hunk of this batch in the files not clean at the baseline
  (`App.tsx`, `styles.css`, `outage.spec.ts`).
- **Every journey,** on a fresh seed, one worker: 998 of 999 in 26.5
  minutes — `go-b13-full1.log`. The one: `backups.spec.ts:93`, «the owner
  is shown last night's failed copy…», 14 nights listed for 3 — this
  Mac's backups' history, failing alike on the last two baselines; GitHub's
  run is the proof.
- **After the screenshots' two fixes** (the full run came before them, and
  they touch only the report's table): the specs that open the report, on
  a fresh seed — `sales-report`, `money`, `outside-text`,
  `outage-mark-debts-returns` — 30 of 30, `go-b13-specs.log`; the kept
  mark's journey in `outage`, 2 of 2, `go-b13-outage.log`.
- **A real Monday:** the period journey reads the real server's today; its
  last run was on 2026-11-09, a Monday, and passed — the day the review's
  high finding would have failed it.
- **Screenshots** (`frontend/test-results/`, wiped by the next Playwright
  run): `report-390.png` — two stores and «Усі разом», the switch,
  «ПРОДАЖІ» and «ГРОШІ» above the menu; `report-{light,dark}.png` — three
  stores at 360 px, «Вокзал»'s rows of no way, its correction and its
  order paid ahead, the note; `report-{light,dark}-scrolled.png` — at the
  end, «Усі разом» beside the first column, the sections' names whole.
- Logs are in `~/.cache/birka-runtime/helpers/`.

## For the owner

- **One store's yesterday is five taps, with one scroll** at 390 × 844 with
  two stores: «Моделі ›» and «Продажі й повернення ›» stand under the
  table, as the task list draws them. To have them without a scroll they
  would go above the table — the table then starting lower. Which?
- В4 and В5 were built by (а); each is theirs to overturn.

## Not covered

- A real phone: the table's scroll and its snap under a finger.
- CI's font: the 390 px fold and the 360 px bounds are checked on
  GitHub's run.
