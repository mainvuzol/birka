# «Усе на бірці», «Сьогодні», part 1: the tab and the day-tag — 2026-10-30

Baseline: `9ed6e62` (#155, on main), and the frame's task list
([P0-6](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), items 1, 2, 7
and the first tab of 8; its acceptance where it concerns the day-tag).
Status: built and reviewed; evidence below. CI is GitHub's, on the pull
request. Not yet seen on a real phone (С8).
Branch: `feat/today-day-tag`. Task: the frame's P0-6, part 1 of 3.
Chosen: business-rules.md, "Chosen in chat — 2026-10-30 («Сьогодні», part
1: the tab and the day-tag, «Усе на бірці» P0-6)".

There was no screen of the day. «How are we doing» was the sales report,
«Каса», «Борги» and «Замовлення», four screens and six taps or more; the
owner opened on the till like a seller. Here «Сьогодні» comes first for
whoever reads the report, and its day-tag answers in one look: what every
store sold, the money through the tills and outside them, each store's
drawer and debts, and the parcels on their way. Every figure is a field
the server already answers; nothing is added to the backend.

P0-6 is split in three:
1. this part — the tab, its head, the day-tag, its reads;
2. the work tags of «Чекає на вас» (backups, parcels to send, «Брак»,
   opening lists), «+ ще N», the empty state, the backups line and the
   tab's badge;
3. the news tags (the drawer's difference, a stocktake) with «Бачу», the
   toast with «Повернути», what was seen kept on this phone for 7 days,
   and «Зроблено сьогодні».

## What exists now

- **«Сьогодні» comes first** for whoever holds `report:view_financial` in
  the store open (owner decision, 2026-10-26, В3; the frame's §4а):
  - the menu's first tab, with its own icon: the owner's menu at 360 px
    reads «Сьогодні · Продаж · Замовлення · Ще»;
  - a seller, who reads no report, opens on the till as before;
  - an operation kept on the phone still turns to its own tab;
  - the report's right gone while it is open: the first tab shown.
- **Its head** (spec §6.2): «Сьогодні», and under it «П’ятниця, 30 жовтня
  · Оля», with «Змінити магазин» at the line's right for whoever has two
  stores or more. The day is the stores' own once the report gives it, the
  phone's before that.
- **The day-tag** (spec §6.10, S04), hanging from the head by its thread
  through the eyelet:
  - «СЬОГОДНІ ДОСІ» and the age stamp;
  - the total: the report's `sold` and `units` (`total` with two stores or
    more), then «· повернули N шт.» when anything came back;
  - the money line: «Гроші {money}» — the report's «Разом» — then «поза
    касою: накладений платіж …, переказ наперед …», each only when it is
    not nothing;
  - under a perforation, the stores:
    - two that trade: a column each;
    - three or more: a row each;
    - one read alone: no name, its drawer and debts in the tag;
    - one that trades beside one that does not: a named row, since the
      total holds the other's day too;
    - a store that does not trade has no column, though the report's total
      holds it;
  - each store shows its name, its `sold` and `units`, then its drawer:
    «Каса відкрита», «Касу закрито о 20:06» or «Каса ще не рахувалась»;
  - then its debts: «Винні 8 400,00 грн · 4 людини» in the debt's colour
    with its arrow, or «Ніхто не винен» in pencil. Debts are never summed
    across stores;
  - the parcels' line «Онлайн: відправити 3 · в дорозі 2 · на пошті 2»:
    - it counts the open orders of every store where this person reads
      orders;
    - each state shows only when there is any, and there is no line when
      there are none;
    - when a store holds more than its hundred, every count gets «+»;
    - its tap opens «Замовлення» of the store open;
  - the stamp:
    - «● наживо · 11:40» while every read is fresh;
    - «дані на 11:32» in the warning's colour with its triangle when a read
      is older than five minutes or its last asking failed;
    - « — сервер не відповідає» added when the asking went unanswered;
    - with nothing read yet and the reading failed: «сервер не відповідає»
      or «не вдалося прочитати».
- **Under 700 px** of Telegram's steady height, the tag is one line:
  - «Сьогодні досі · 12 050,00 грн · 6 шт.» with a chevron — at 360 px in
    two lines, broken after «Сьогодні досі ·»;
  - old or unread, its stamp stands under the line;
  - a tap opens the tag in place, the cursor on its heading. It stays open
    while the screen stays.
- **A store's sum** is at 32 in two columns and at 20 in rows. Narrower
  than 390 px it is at 20, as the spec has it under 360 (at 32 «,00 грн»
  leaves no room for the lines). A million a day or more is at 24, so it
  stays in its column at 390.
- **Its reads** (`today/reads.ts`):
  - what it reads: the report, each store's drawer, its debts and its open
    orders, each by its own right in its own store (the frame's §4);
  - the stores come from `/me`, so a drawer or a debt never waits on the
    report;
  - when: as the screen opens, on the tab, and as the app comes back, never
    more than once a minute;
  - what a read keeps:
    - kept 30 minutes while the person works elsewhere;
    - a failure keeps what was read;
    - a figure that waits holds its place in grey;
  - the report, a drawer and a store's debts are read under the keys of
    «Звіт про продажі», «Каса» and «Борги»: one asking serves both screens,
    and what «Каса» or «Борги» learns shows here.

No backend change. No right or rule changes: every figure is a field the
server already answers.

## Decided here, not by the owner

Each owner question of P0-6 is built by its (а) until answered: В-Т1,
В-Т2, В-Т3, В-Т5, and В-Т6 (the network's day). Besides them:
- **P0-6 is split in three parts** (above).
- **The stores' layout:** the frame names columns for two, rows from
  three, and none for one. A store that does not trade has no column. One
  store that trades beside one that does not gets a named row: the total
  holds both.
- **The drawer's words are «Каса»'s own:** «Каса відкрита», «Касу закрито
  о 20:06», «Каса ще не рахувалась».
- **«Ніхто не винен»** is «Борги»'s «Зараз ніхто не винен», shortened. It
  is in pencil, without the debt's arrow.
- **The money line:** «Гроші» is the report's «Разом»; «поза касою:»
  names cash on delivery and the transfer in advance.
- **The parcels' line** counts only stores where this person reads orders.
  Its tap opens the store open's «Замовлення».
- **The age stamp** shows the oldest of the tag's reads; any failed asking
  makes it old.
- **The folded line** does not fit one line at 360 px: it breaks only
  after «Сьогодні досі ·», as the money's line breaks between its parts. It
  keeps the stamp when it is old. Opened, the cursor goes to the tag's
  heading.
- **The day under the title** is the report's `today`, the phone's before
  it comes.
- **Keys shared** with «Звіт про продажі», «Каса» and «Борги».
- **The sum's sizes** under 390 px and from a million (above).
- **«Ще ⚠» stays in the menu** until the backups tag (part 2) and «Ще»'s
  dot (P1-5).
- **No reading while the screen stays open:** the frame names the times to
  read (entry, tab, return), and this keeps to them.

## How it was built and proven

- **Files:**
  - `today/Today.tsx` (new): the screen, its head, the day-tag, its parts
    and stamp, the folded line, the stores' layout;
  - `today/reads.ts` (new): the reads, their keys and their cadence; the
    stores of the report and of the tag, from `/me`;
  - `App.tsx`: the tab, first for whoever reads the report, its icon, its
    fallback;
  - `shared/ScreenHeader.tsx`: `lead`, what the line names first where it
    is not the store — «Сьогодні»'s day;
  - `styles.css`: the day-tag's block;
  - `e2e/today.spec.ts` (new); `e2e/fixtures.ts`: `toTill`, the till as
    whoever reads the report reaches it, and `openStore` reading the day
    where the store's name stood.
- **Journeys** (`today.spec.ts`; the report, drawers, debts and open
  orders stubbed, `/me` kept to the seed's network of «Центр», «Ринок» and
  the archived «Старий»):
  - the owner opens on «Сьогодні», the menu's first tab: the head's day
    and name, every figure of the tag the stub's field, the columns' drawer
    and debts each its store's, the parcels' line; no «⚠» on the screen;
    at 390 × 741 the tag's foot and 64 px more stand over the menu;
  - under 700 px (360 × 640) the one line, `aria-expanded="false"`, no tag;
    tapped, the tag in place and the cursor on its heading;
  - under 700 px, six minutes on: «дані на …» under the line;
  - a million in a store's day: each sum inside its column at 390, 360 and
    430, and no page wider than the screen;
  - Марко, one store: no columns, «Ніхто не винен» in pencil without the
    arrow, no parcels' line;
  - three trading stores: a row each, three «Винні», never one for the
    network;
  - «Ринок» blocked: «Центр» alone, in a named row;
  - the archived «Старий» has no column; with `sale:credit` taken from
    «Ринок», its debts are never asked for: one report, two drawers, one
    debts, two order lists;
  - Ліда, a seller: no «Сьогодні» in the menu, the till first;
  - a store past its hundred: «Онлайн: відправити 3+ · в дорозі 1+ · на
    пошті 2+»; tapped, «Замовлення»;
  - the report refused: each column's drawer and debts stand, its sold line
    held in grey, the parcels' line read, the stamp «дані на … — сервер не
    відповідає»;
  - the stamp «наживо · …», «дані на …» six minutes on, and with the report
    unanswered as the app comes back, « — сервер не відповідає», the total
    kept;
  - «Ринок»'s debts refused: its line held in grey, everything else shown;
  - at most 20 reads as Бірка opens, the whole app's; to the till and back
    and the app left and come back to within the minute, none again; a
    minute on, each once more;
  - in Telegram's dark theme the debts, the old stamp and the money line at
    4.5:1 or more.
- **Journeys changed:**
  - whoever reads the report now opens on «Сьогодні», so 121 journeys of 19
    specs that expected the till as Бірка opened failed;
  - each now reaches the till by `toTill`, which taps «Продаж» when Бірка
    opened on «Сьогодні». It is called only where it taps: a temporary log
    of every call site found 27 that never did — sellers and people who
    read no report — and those were taken out;
  - `till-redesign.spec.ts`'s P0-1 journeys now say where each person
    opens: one store, «Сьогодні» with nothing to change to; two stores,
    the choice each time, then «Сьогодні»; whoever neither sells nor reads
    the report, «Замовлення»;
  - an unreadable kept invoice is held for someone who reads no report,
    so the till they open on is still the one checked;
  - `till-tray.spec.ts`'s «the cursor in the search as the till opens» is
    for whoever reads no report: from «Сьогодні» the tab keeps the cursor
    (review, 2026-10-17);
  - `till-sections.spec.ts`'s owner's and manager's menus begin with
    «Сьогодні»;
  - `people.spec.ts`'s person let in opens on «Сьогодні»;
  - `openStore` reads the day where the store's name stood under the
    title.

- **Proven to catch:** each break was applied once, its journeys run,
  then undone. All 22 failed the journey named for them:
  - the till first for the owner;
  - the total taken from the first store;
  - every column with the first store's debts;
  - a drawer closed today called open;
  - never folded;
  - never old;
  - never «сервер не відповідає»;
  - one failed read hiding the tag;
  - read at every visit;
  - a store that does not trade given a column;
  - debts asked for without the right;
  - no «+» past a hundred;
  - the parcels' line opening nothing;
  - a seller given «Сьогодні»;
  - nobody owing said as owing;
  - the old stamp in the placeholders' grey, which dark leaves unread;
  - one store's lines unnamed beside a store that does not trade;
  - the cursor nowhere as the folded line opens;
  - the folded line silent about an old day;
  - a million at 32 in its column (366.8 px of a 359.5 px column);
  - the stores waiting on the report;
  - a column's sold line with no place held.
- **Journeys:** 780 — 765 on main, where #155's last journey came after its
  count of 764 — and the 15 here.

## Review

An independent review of the uncommitted tree found the following, fixed
before the commit:
- **The stores came from the report:** a drawer and a store's debts waited
  for the report and vanished with it. Now the stores come from `/me`, and a
  column's sold line holds its place while the report is read. A journey
  refuses the report.
- **One store's lines unnamed beside a store that does not trade:** the
  total held both, so the drawer and debts read as the network's. Now
  they are named, in a row. A journey blocks «Ринок».
- **The folded line:** opened, the cursor was lost with the button. Now it
  goes to the tag's heading. An old day said nothing on the line; now the
  stamp stands under it. Journeys cover both.
- **No way off «Сьогодні»** if the report's right were gone while it was
  open: now the first tab shown. Rights are read once as Бірка opens, so no
  journey reaches it; it stands beside the same guard for «Замовлення».
- **The eyelet's `z-index`** did nothing: the thread is drawn over the
  eyelet's upper half, through it, and the comment now says so.
- **A store's sum could leave its column:** the condensed figures keep
  six-figure days inside at 390 px (143 of 156 px), but a million did not
  (164). A million or more is now at 24. A journey checks at 390, 360 and
  430.
- **Journeys weaker than their titles:**
  - the reads are counted after they settle;
  - the non-trading journey checks every read, not the debts alone;
  - the orders' stub leaves «Замовлення»'s further pages to the server;
  - no page is wider than the screen.

Kept as they are:
- **No reading while the screen stays open:** the frame names when to read
  — entry, the tab, the app's return — and the server allows 300 requests
  a minute to a person (ADR-0020).
- **`openStore` checks less on «Сьогодні»:** it reads a day of the week
  where the store's name stood, and cannot tell the store from it.

Found after the review:
- **The seed's network owner reads five stores that trade,** «Каса»,
  «Північний» and «Південний» besides the two, for other journeys. With
  the stores from `/me`, the stubbed day showed five rows. `today.spec.ts`
  now keeps `/me` to the seed's network of three.
- **The folded line at 360 px** broke inside «Сьогодні досі» and before
  «шт.». Now it breaks only after «Сьогодні досі ·».
- **A kept operation turns to its own tab after the first frame:**
  `toTill` waits two frames before it reads the screen.

## Evidence

On the Mac, against the E2E API and PostgreSQL 17:
- **e2e, the seed run afresh:** all 780 journeys, 779 passed. The one
  failure is `backups.spec.ts`: it finds more nights than it expects,
  because the local seed only adds, as on main.
- **The run before it**, also on a fresh seed: 778 passed. Besides
  `backups`, `receive.spec.ts`'s «a delivery whose outcome is unknown…»
  failed once: «Незавершене приймання» was not shown. It then passed:
  - five times alone;
  - three times among its spec's neighbours;
  - in the whole run above.

  Its trace was lost to the rerun. One race fits: any answer after a lost
  one is the server's return, and the phone resends the kept delivery by
  itself (`shared/reach.ts`). An owner now opens on «Сьогодні», whose reads
  answer then. Measured on that database, though, they took 8–42 ms, far
  less than the journey's steps before it sends.
- **The first full run, before the journeys were moved:** 121 failed, 655
  passed (`backups.spec.ts` among them, as on main). The 19 specs, moved,
  were run twice on a fresh seed. The second run's 8 failures were all
  `till-sections.spec.ts` journeys of Ліда at «Центр». Run alone, those
  specs leave «Склад мережі» as the seed made it: empty, so her till shows
  no search. In the whole run other specs stock it first.
- **frontend:** eslint, tsc and the build are clean. App 526.01 kB (516.91
  before), parts 2.61 kB, icons 6.56 kB, vendor 210.85 kB.
- **Heights** at 390 × 741 with «Центр + Ринок»:
  - the tag 347 px: its head 19, the total 75, the money's line 38, the
    columns 116, the parcels' line 44;
  - its foot at 484, the menu at 676: 192 px under it;
  - folded at 360 × 640: 54 px, 75 with the stamp.
- **Screenshots** (throwaway): 390 × 741 light and dark; 360 × 640 folded,
  live and old; 412 × 690 folded, in one line; a million at 390.

## Not covered here

- **On a real phone** (С8): Telegram's steady height under 700 px, the
  fold, the reads as the app comes back.
- **The frame's «≤ 240 px»**, and with it part 2's two tags over the menu
  at 390 × 741: about 70 px short. A reading for the owner.
- **Parts 2 and 3** (above). «Ще ⚠» stays until the backups tag.
- **An owner's sale is two taps further** from the app's opening:
  «Продаж», and the search, which a tab does not put the cursor in. A
  seller's is as before. A reading for the owner, with the menu's own
  rule.
- **Journeys that lose only the first answer** (13 besides `receive`, in
  cash-kept, catalog, correct, openings, order-shipping, orders, shelf,
  stocktake, sale and till-receipt): if a read answers after the lost one,
  the phone resends by itself before the journey looks. None failed. Each
  could wait for the network to settle first, as `till-sections.spec.ts`'s
  reminders do.
- **The app's own file past 500 kB:** still to choose.
