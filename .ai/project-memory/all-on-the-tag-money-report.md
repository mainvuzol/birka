# «Усе на бірці», «Гроші»: where the money is now, what came in — 2026-11-01

Baseline: `b1639c6` (#163, on main), and the sections task list
([P0-7](redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md), its
decisions and acceptance), with the spec's S29, §6.7 (the mode switch),
§6.17 (how old the data is) and §12.3 (rules 8, 9, 15 and 19).
Status: built, reviewed and proven on this Mac; evidence below. CI is
GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/money`. Task: the sections task list's P0-7 alone (chosen in
chat, 2026-11-01, «Yes, start «Гроші»»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-01 («Гроші»: where
the money is now, what came in; sections P0-7)". The design's Q-1, Q-9,
Q-10 and Q-11 are built as «if no».

Where the money was meant five screens: the report under «Ще» with its
dates and lists, «Каса» a tab or a row, who owes in «Покупці», what is
owed to suppliers in «Накладні» — each of the open store only, so the
owner of two changed store to read the other (≥ 12 taps). Now «Гроші» is
a tab of whoever reads the store's reports: each place where money is on
its own, a line a store, every figure its own read's and never two added
up; under it what came in over a period, the ways down and the stores
across; and the screens it stands for opened from it, «← Гроші» back.
Nothing changes on the server.

## What exists now

- **The tab:** «Сьогодні · Продаж · Замовлення · Гроші · Ще» for whoever
  holds `report:view_financial` in the open store; «Ще» › «Гроші» keeps
  «Постачальникам» alone for them. A cashier, who reads no report, keeps
  «Каса» as a tab and has no «Гроші». In a store that does not trade
  «Каса» is opened from «Гроші» too, never a sixth tab.
- **The header:** «Гроші», the server's day («Четвер, 22 жовтня»).
- **«Де гроші зараз»**, «● наживо · 11:40» or «дані на 11:32» beside it;
  the stores those of the report, by code, one that does not trade marked
  «заблоковано» or «в архіві»:
  - «У касах»: «учора порахували 5 380,00 грн о 20:06» — the last close's
    counted cash, never what was to be there; «сьогодні …», «21.10 …»,
    «Каса ще не рахувалась»; «Сьогоднішня готівка — після вечірнього
    підрахунку.» while a drawer is still open today; «Видано сьогодні» a
    line for each cash taken out today;
  - «Картка сьогодні · звірте з чеком», «Перекази сьогодні»: today's
    report's card and transfers;
  - «Вам винні клієнти» (`sale:credit`): «Винні 8 400,00 грн · 4 покупці»
    or «Ніхто не винен»; its name opens «Покупці»;
  - «Ви винні постачальникам» (`supplier:debt`): «38 000,00 грн · 3
    накладні» or «Нічого не винні»; its name opens «Накладні»;
  - «Кожне місце окремо — ніколи не складаємо в одну суму.»
  Each place waits, ages and fails on its own: «дані на …» where it is
  older, its plate with «Спробувати ще раз» where it was never read.
- **«Надійшло»:** «Сьогодні · Вчора · Тиждень · Місяць», held until the
  server's today is known; the table «Готівка», «Картка», «Переказ», «Не
  вказано» where a store has any, «Разом», «грн» once over it, kopecks
  always; «Окремо від «Разом» — замовлення: …» and «З них внески за борг:
  …» under it.
- **The rows:** «Звіт про продажі» (on the period chosen), «Закриття»,
  «Каса · {магазин}»; each screen says «← Гроші» and marks the tab.

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the tab's place and who has it; what leaves «Ще» and what stays;
- the stores are the report's, named even when there is one;
- an older close says its day, «21.10 порахували …»;
- «Видано сьогодні» lists only what was taken out;
- «Тиждень» and «Місяць» are the switch's words, the report keeps «Цей
  тиждень», «Цей місяць»;
- the table's figures without «грн», which heads it once.

## How it was built and proven

- **Files:**
  - `frontend/src/money/Money.tsx` (new): the screen, its places, the
    table, the rows;
  - `frontend/src/money/reads.ts` (new): the periods from the server's
    today, the period's report, the last closes, today's movements, the
    suppliers' debts — under the keys the other screens read them by;
  - `frontend/src/today/age.tsx` (new): how old a screen of the day is,
    moved from `Today.tsx` as it was, for both screens;
  - `frontend/src/App.tsx`: the tab, «Ще»'s money rows, «← Гроші», the
    period kept while the report opened on it stands;
  - `frontend/src/reports/SalesReport.tsx`: opens on a period given;
  - `frontend/src/cash/History.tsx`: «← Гроші» when opened from it;
  - `frontend/src/styles.css`: the places, the table, the rows.
- **Journeys:** 856 in all (840 after #163).
  - **new:** `money.spec.ts` (16) — S29 at 360 × 640 with every figure
    its own stub's and none the sum of two stores, two places or a
    store's ways; «Ще» › «Гроші» left with «Постачальникам»; each way
    back with «← Гроші», the tab marked; the drawers' days, never
    counted, all counted; a place unread with its plate, a place gone
    old with its stamp; the periods from the server's today, the report
    opened on one; the periods waiting; a period kept while the day's
    report is forgotten; a store that does not trade, three wide columns
    scrolled in the table alone; a store whose report is not this
    person's; a manager, a cashier; both themes;
  - **changed:** `till-sections.spec.ts` (the owner's and a manager's
    menus with «Гроші», «Накладні»'s right), `supplier-invoices.spec.ts`
    (an invoice's payment waiting: its way on «Гроші» open, the others
    held), `fixtures.ts` (`section()` goes through «Гроші» for «Каса»,
    the report and «Накладні» where the tab is).
- **Mutants:** 49 written, each applied alone and its journey run. Two
  were removed with the code they changed, which the review's own
  journey showed did nothing (the period's read held back, and its
  plate). Of the other 47, all fail their journey; three passed first —
  every store of `/me` read as the report's, a place's stamp taken away,
  the table's scroll taken away — and their journeys were added or
  sharpened: the table's check had seen only five pixels of overflow,
  below the fold.

## Review

An independent review of the whole change named four defects and four
doubts. Three defects were real and are fixed, each with its journey and
its mutant but one; the fourth was not; the journeys it called weak are
sharpened.
- **Fixed:**
  - «Видано сьогодні» listed cash recorded this morning against last
    night's close (`for_close_id`, B6.3): it left before that count, and
    the owner would have taken it from today's cash; it is left out now;
  - the right to read the report gone while «Гроші» or «Закриття» stood
    left an empty screen: the first screen this person has opens, as
    «Сьогодні» does. No journey: nothing in the app reads `/me` again
    while «Гроші» is open;
  - «Покупці» opened from «Гроші» said «← Гроші» but marked «Ще»: it
    marks «Гроші».
- **Not a defect:** a period kept while today's report was forgotten
  (half an hour away from «Гроші») and could not be read again was said
  to wait without end. Until today is known the period's read is the
  day's own, under its key, and says its failure with «Спробувати ще
  раз». The journey written for it passed without the change; the change
  and the switch that held the read back are removed, the journey kept.
- **Doubts, decided:**
  - «Гроші» is held as «Ще» is, only by a first send, not as «Сьогодні»:
    for whoever reads the report it is the only way to «Каса», a reason
    owed included; each of its ways keeps its section's hold;
  - a store that does not trade kept the line about tonight's count for
    ever: only the stores that trade are waited for;
  - a place's name held by another screen's operation lost its button:
    it is a button held now, as its row in «Ще»;
  - the table's «грн» was the ways' column header to a screen reader: the
    table has its caption «Надійшло, грн», the corner is not a header, and
    the table's scroll can be reached by the keyboard.
- **Left as it is:** for a minute after midnight the cached report's
  `today` is yesterday's until read again; a period chosen in that minute
  asks yesterday's week or month, and the report opened then keeps it.
- **Journeys sharpened:** the stubs' «came in» and «went out» are never
  the net, and «Центр»'s «Разом» is not its ways' sum, so a sum on the
  phone would show; the card is checked after the period changes; the
  days asked are compared whole, the report's too; nothing dated is
  asked before the server's today; «У касах» wholly on the screen at
  360 × 640, and the table itself not scrolling with two stores.

## Evidence

- **Full run** on a fresh seed, on this Mac, after the review's fixes:
  855 of 856 in 16.6 minutes. The one: `backups.spec.ts:78`, which fails
  only on this Mac, as on main (the local database keeps 14 nights of
  copies where the journey writes 3); nothing here touches it. Before the
  review, on its own fresh seed: 852 of 853, the same one.
- **Before it:** `money.spec.ts` whole (16 of 16); the specs the move
  touched (315 of 319, then the four that still looked for «Каса», the
  report and «Накладні» under «Ще», rewritten and passing); `tsc -b`,
  `eslint src e2e` clean; `npm run build`; Prettier: the new files and
  those clean on main stay clean, and in those that were not, no line of
  this change is out of form.

## For the owner

The words to approve are in business-rules.md under the heading above,
«For the owner».

## Not covered here

- **A real phone:** the table at 360 with three stores and more (it
  scrolls on its own; «нужен скриншот», §10).
- **The right to the report lost while «Гроші» is open:** built, but no
  journey — nothing in the app reads `/me` again while it stands.
- **Q-1:** another store's «Каса» and «Накладні» are reached by «Змінити
  магазин».
- **The rest of the sections task list:** the model's detail (P0-6),
  «Каса» (P1-1…P1-3), «Прийшов товар» (P1-4), «Інвентаризація» (P1-5).
