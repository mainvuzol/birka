# «Усе на бірці», «Сьогодні», part 3: news, «Бачу», «Зроблено сьогодні» — 2026-10-31

Baseline: `5de529a` (#157, on main), and the frame's task list
([P0-6](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), item 3 for
«Зроблено сьогодні», item 4 rows 2 and 6, item 5; item 7 for their reads,
item 8 for the badge; its acceptance where it concerns them).
Status: built, reviewed and proven on this Mac; evidence below. CI is
GitHub's, on the pull request. Not yet seen on a real phone (С8).
Branch: `feat/today-news`. Task: the frame's P0-6, part 3 of 3 — P0-6 is
closed with it.
Chosen: business-rules.md, "Chosen in chat — 2026-10-31 («Сьогодні», part
3: news, «Бачу», «Зроблено сьогодні», «Усе на бірці» P0-6)".

Part 2 said what waits on whoever opens «Сьогодні». Left was what someone
else did that the owner should know: a drawer counted short or over, a
stocktake finished. In a notebook that is a line the owner reads and ticks;
here it is a tag with «Бачу», which goes once seen and can be brought back
for five seconds. Nothing is added to the backend: each tag is a read the
server already answers, by the right it already needs, and what was seen
is kept on this phone alone (В-Т3 (а)).

## What exists now

- **Two kinds of news** among «Чекає на вас»'s tags, in the frame's order —
  the backups, **a drawer's difference**, the parcels, «Брак», the lists,
  **a stocktake finished**:
  - **a drawer's difference** (`GET /cash/closes`, `report:view_financial`):
    a tag for each close of the drawer's yesterday or today (06:00–06:00,
    as «Каса» counts its days) whose difference wants a reason — 1,00 грн
    or more — «У касі «Центр» учора нестача 120,00 грн» / «… сьогодні
    надлишок 50,00 грн» in «Каса»'s own words; its meta «Наталя · о 20:06
    · причина: «…»», or «причину не вказано»; the open store's first, the
    oldest first in each store;
  - **a stocktake finished** (`GET /stock-locations`, then `GET
    /stocktakes?store_id&location_id`, `inventory:view`): a tag for each
    finished yesterday or today by the phone's day, «Склад «Основний»:
    інвентаризацію завершено — нестача 2 шт., надлишок 1 шт.» or «—
    розбіжностей немає», as «Залишки» says it; its meta the store it was
    taken in, who finished it and «учора о 18:30». A warehouse two stores
    share is read once, through the open store if it is one of them;
    «Брак» and a paused warehouse are never read. A stocktake taken in a
    store not of the day — «Старий», which no longer trades — is named as
    that store's, after the day's.
- **News looks like news** (spec §6.9): the drawer's eyelet filled in the
  warning colour; the stocktake's a ring in the offline colour, as S04
  draws it — what someone else did.
- **«Бачу»** on every piece of news, another store's too: it changes
  nothing anywhere, it is only what this phone keeps. Seen, the tag goes —
  from the screen and from the tab's count at once — the cursor goes to the
  tag after it, else the one before, else the heading; and a toast
  «Бірку сховано.» with «Повернути» stands over the menu for five seconds
  (spec §6.23, the shared `Toast`), held while the cursor is in it.
  «Повернути» puts the tag back in its place, the cursor on it.
- **A double tap is one «Бачу»:** the next tag, or the toast, rises under
  the finger, and the tap's second half is let go for 0.7 s — as a sheet
  lets its own (`CARRIED_TAP`). The first «Бачу» of the day never moves
  the tags: «Зроблено сьогодні» is 44 to the thumb, the label's line to
  the page.
- **What this phone keeps** (`today/seen.ts`): under
  `birka:seen:{organisation}:{person}`, a news tag's id and when it was
  seen — never what it said; forgotten after seven days, as Бірка opens.
  A phone that keeps nothing keeps it for as long as Бірка stays open.
- **«Зроблено сьогодні · N ›»** right of «Чекає на вас · N», or under «Вас
  нічого не чекає.», once anything was seen today, by the phone's day: a
  sheet of what was seen, the latest first, each tied off with a knot and
  «Побачили о 12:04». It opens over the toast, which goes with it; closed,
  the cursor back on «Зроблено сьогодні».
- **Its reads** (`today/reads.ts`): the closes of every store whose money
  is read, one read for them all, under «Каса»'s prefix — a close there
  is read again here at once; each store's warehouses where its stock is
  read; each warehouse's stocktakes under «Залишки»'s prefix, keyed by the
  warehouse alone. At entry, on the tab and as the app comes back, never
  more than once a minute, as part 1's.

## Decided here, not by the owner

- **«Бачу» on every piece of news,** another store's too: the frame gives
  another store's tag no verb (В-Т2 (а)), but «Бачу» does nothing there —
  it is this phone's, as В-Т3 (а) has it.
- **One tag a close and a stocktake,** not one a kind and a store: each is
  its own news, with its own who and when.
- **The drawer's days, the stocktake's days:** a close is «сьогодні» or
  «учора» by the drawer's day, 06:00–06:00, as «Каса» says it; a stocktake
  by the phone's, as the frame's «учора о 18:30». Between midnight and six
  the two can stand side by side meaning different days.
- **A difference that wants a reason** — 1,00 грн or more, the server's
  `reason_required` — is news; under a hryvnia, or a first count, it is not.
- **A stocktake's store** is the one it was taken in; a shared warehouse is
  read once, through the open store first; «Брак» and paused warehouses
  are never read.
- **The meta's words:** «{Ім’я} · о 20:06 · причина: «…»», «причину не
  вказано» where none was given; for a stocktake, «{Магазин} · {Ім’я} ·
  учора о 18:30», the store named as the work tags name it.
- **The colours:** the drawer's eyelet filled in warning, the stocktake's a
  ring in offline, as S04.
- **The toast:** five seconds, held while the cursor is in it, and gone
  when «Зроблено сьогодні» opens, so the sheet never covers it out of
  reach.
- **Where the cursor goes** after «Бачу» and «Повернути» (above).
- **A double tap's second half** let go on «Бачу» and on «Повернути» for
  0.7 s.
- **«Зроблено сьогодні»** also under «Вас нічого не чекає.»; the sheet is
  read only, «Побачили о …», the latest first; today is the phone's.
- **What this phone keeps:** `birka:seen:{org}:{user}`, ids and times
  only, seven days.
- **The badge** counts only the tags not seen.

## How it was built and proven

- **Files:**
  - `frontend/src/today/seen.ts` (new): what this phone keeps, and when
    it forgets;
  - `frontend/src/shared/Toast.tsx` (new): the toast, its five seconds and
    its one way back;
  - `frontend/src/today/reads.ts`: the closes, warehouses and stocktakes
    reads;
  - `frontend/src/today/waiting.ts`: the two kinds of news, what was seen,
    what was done today;
  - `frontend/src/today/Today.tsx`: «Бачу», the cursor, the toast,
    «Зроблено сьогодні» and its sheet;
  - `frontend/src/cash/Cash.tsx`: a close reads every closes list again;
  - `frontend/src/styles.css`;
  - `frontend/e2e/today.spec.ts`; `frontend/e2e/orders.spec.ts` (below).
- **Journeys** (`today.spec.ts`; the reads stubbed, no closes and no
  stocktakes unless a journey says otherwise):
  - news: three drawer tags and three stocktakes among the work, in the
    frame's order, each title and meta the stub's fields, «Бачу» on each
    and the work's verb on the parcels, the ring on the stocktake, the
    badge 7; a shared warehouse read once though the open store's answer
    comes last, «Брак» and a paused one never; a stocktake of «Старий»
    named and last;
  - «Бачу»: the tag goes, the cursor on the next, the badge one less, the
    toast; «Повернути» brings it back, the cursor on it; the toast held
    while the cursor is in it, gone five seconds after it leaves; «Зроблено
    сьогодні · 1» with its knot and «Побачили о 12:0x», Escape back on it;
    opened again, still seen; the last one seen, «Вас нічого не чекає.»
    with the cursor on it; the sheet opened over the toast, which goes,
    the latest first;
  - what this phone keeps: one key, `birka:seen:{org}:{user}`, its ids
    alone; a seventh day's forgotten as Бірка opens, a sixth's kept; one
    seen before midnight still gone, not «Зроблено сьогодні»;
  - a double tap: the next tag risen under the finger, and lower, the
    toast's «Повернути» — each second half let go;
  - before six: last night's close «сьогодні», the night before's
    «учора», three days back not told; the closes asked of the drawer's
    two days;
  - part 1's reads journeys count the closes and stocktakes too: once at
    entry, none again within the minute, each again after it; a store
    without its stock's right has no warehouses read.
- **Proven to catch:** each break was applied once, its journey run, then
  undone. All 36 failed the journey named for them, each at the check
  written for it:
  - no «Бачу» on another store's news;
  - what was seen still shown, and counted on the badge;
  - never forgotten; seen only while Бірка stays open;
  - no toast; «Повернути» bringing nothing back; the toast staying;
  - the cursor nowhere after «Бачу», after «Повернути»;
  - a shared warehouse read twice; read through whichever store answered
    first;
  - «Брак» counted; a paused warehouse read;
  - a close under a hryvnia, or a first count, told;
  - a drawer's day always «сьогодні»; the drawer's day the phone's; a
    close of any day told;
  - a stocktake of any day told;
  - a stocktake in the store it was read through; one of a store not of
    the day in the store read through, or first;
  - the stocktakes before the drawers; a store's closes newest first;
  - no ring; no knot;
  - nothing in «Зроблено сьогодні»; what was seen before midnight in it;
  - «причину не вказано» unsaid;
  - the warehouses read without the right; the closes again within the
    minute;
  - every person on the phone sharing what was seen;
  - the toast not held while the cursor is in it; held under the sheet;
  - a double tap's second half seeing the tag risen under the finger, or
    landing on «Повернути»;
  - the heading's row growing as the first is seen.
- **Journeys:** 795 — 790 on main and the 5 here.

## Review

An independent review of the change, read-only, before these fixes. Fixed:
- **A shared warehouse's stocktakes read twice, its tag gone meanwhile**
  (the worst): the warehouse went to the first store whose warehouses had
  answered, and its stocktakes' key held that store, so a later answer
  moved it and read it again. Now counted once every store's warehouses
  have answered, keyed by the warehouse alone; the journey answers
  «Центр»'s last.
- **A close in «Каса» not read again here:** «Каса» cleared its store's
  closes, not «Сьогодні»'s, so the tag and the badge waited up to a minute
  while the day-tag already said «Касу закрито». A close now clears every
  closes list. The closes' key no longer holds the days: at 06:00 the
  tags stand until the next reading instead of a grey place.
- **A double tap on «Бачу» saw two tags,** the first out of «Повернути»'s
  reach — and lower on the screen, its second half landed on «Повернути»
  and undid it (found by the journey written for the first): both let go
  (above).
- **The toast stood over «Зроблено сьогодні»'s sheet** and could not be
  pressed: it goes as the sheet opens.
- **A stocktake taken in a store not of the day** was told as the store's
  it was read through: named as its own, after the day's.
- **Paused warehouses were read:** no longer, one read fewer each.
- **Journeys weaker than their titles:** none before six, where the
  drawer's day is not the calendar's; the closes stub's days unchecked;
  the key's organisation and person unchecked; the toast's hold unchecked.
  Each has a check now (above).

Found by the journeys written for the review: the first «Бачу» of the day
moved the tags down 28 px — «Зроблено сьогодні», 44 high, grew the
heading's row. Its touch target stays, the row does not grow.

Found by the full run, after the review:
- **orders.spec:249, a kept order settled by itself before its tap:** the
  journey lets the server back and taps «Перевірити результат
  замовлення» at once, while «Сьогодні»'s reads at entry were still in
  flight — now longer, the stocktakes waiting for the warehouses. One
  answering after it is the server back, and the order is checked by
  itself (ADR-0013 §4.3): the app as it should be. 5 of 6 failed so; the
  journey now lets the server back with nothing in flight, as
  orders-card's do since part 2.

Kept, not journeyed:
- a close in «Каса» read again by «Сьогодні» at once — the prefix, as the
  stocktakes' under «Залишки»'s and part 2's under their screens';
- two Біркаs open on one phone keep each other's «Бачу» only when opened
  again: the store is read from storage once a page;
- `seen.ts` writes the purge back as it first reads, during a render — the
  same every time, so StrictMode's second render changes nothing.

For the owner (not bugs):
- **the toast's words:** the frame's «Бірку сховано.» is built; the spec's
  §6.23 example is «Перенесено в «Зроблено сьогодні»»;
- **«Бачу» on another store's news** (above);
- **two days side by side before six:** a close «сьогодні» by the drawer's
  day next to a stocktake «учора о 23:50» by the phone's;
- **reads grow with warehouses:** one stocktakes read a warehouse; with the
  seed's shared one the entry is 17 reads, two stores with two warehouses
  each would be 20 — the frame's «около 18».

## Evidence

On 2026-10-31, on this Mac, against the E2E API and PostgreSQL 17 on a
fresh seed; CI is GitHub's, on the pull request.
- **Every journey:** 793 of 795 passed (14.3 min). Left:
  `backups.spec.ts:76`, which fails on this Mac only (its night's count),
  as on main; and `orders.spec.ts:249` (below), fixed since: 8 of 8 over
  eight runs, and `orders.spec.ts`, `orders-card.spec.ts` and
  `today.spec.ts` 88 of 88.
- **`today.spec.ts`** 30 of 30.
- **Mutants:** 36 of 36 caught (above).
- **eslint** and **tsc** clean; **build** passes, the app's own file
  539.69 kB, past the 500 kB warning as on main (still to choose).
- **Screenshots**, light and dark, at 390 × 741: the news among the work
  with «Бачу» and the ring; the toast over the menu (y 612–660, 358 wide,
  the menu from 676), «Повернути» in the thread's colour; the sheet with
  its knot — seen, not kept in the repository.

## Not covered here

- **On a real phone** (С8): Telegram's steady height, the toast over the
  menu, a real double tap.
- **The frame's «two tags over the menu at 390 × 741»** — part 1's open
  question of the day-tag's height, as part 2 said.
- **«Пізніше»** (В-Т3 (б)) and what was seen on another phone: a backend
  task if the owner chooses it.
- **The app's own file past 500 kB:** still to choose.
