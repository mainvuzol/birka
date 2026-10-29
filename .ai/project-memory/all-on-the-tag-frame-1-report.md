# «Усе на бірці», the frame, part 1: the bottom menu by rights, «Ще» by the design's groups, docks over the menu — 2026-10-29

Baseline: `a1eec34` (#149, on main), and the frame's task list
([P0-4](redesign/2026-10-27-redesign-tz-all-on-the-tag.md)).
Status: built and reviewed; every journey passes locally. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/frame`. Task: the frame's P0-4, part 1.
Chosen: business-rules.md, "Chosen in chat — 2026-10-29 (the frame of «Усе
на бірці», part 1)".

P0-4 is built in two parts. This one moves the places: the menu, «Ще», the
docks, Telegram's height, the content's width and the words that name a
place. Part 2 makes each screen's own title the page's heading, with the
line «{Магазин} · {Ім’я}» under it; it touches the titles of about thirty
screens, and nothing in part 1 waits for it.

## What exists now

- **The bottom menu** (`shared/TabBar.tsx`, spec §6.2): `nav «Розділи»`,
  64 px over the home indicator on the card, a glyph of 24 over a 13 px
  word, the open tab's glyph on a 56 × 30 pill in `primary`. Its tabs,
  each by its own right in the store open (§4а):
  - «Продаж» — «Продати · Повернути · Внесок» under its heading, as before;
  - «Замовлення» — a tab of its own (`sale:view`): its list, card and «+
    Нове замовлення» as before; pressed again, its first screen;
  - «Каса» — for whoever counts the drawer and reads no report; for whoever
    reads one it is «Ще» › «Гроші» › «Каса» until «Гроші» (S29, the frame's
    В2 (а)); over a store that does not trade, a tab for whoever the
    network's rights open it to;
  - «Ще» — while it holds a row.

  A seller's menu is «Продаж · Замовлення · Каса · Ще»; a manager's and the
  owner's «Продаж · Замовлення · Ще». «Клієнти» and «Товар» are gone, and
  so is «Борги | Замовлення».
- **«Ще»** (S07), by the design's groups in its order, a group with nothing
  in it not drawn, its label in capitals by style:
  - «Люди»: «Борги» (named as its screen until «Покупці», S19);
  - «Товар»: «Прийшов товар», «Брак» with how many units wait under it,
    «Залишки» (until the model's own screen, S23), and «Товар і каталог» —
    a list of its own with «← Ще» for whoever has two of «Перевірка
    каталогу», «Моделі», «Початкові залишки» or more, its line naming them;
    the one itself for whoever has one;
  - «Гроші»: «Каса» (for whoever has no such tab), «Звіт про продажі»,
    «Накладні», «Постачальникам»;
  - «Мережа»: «Магазини», «Резервні копії»;
  - «Цей телефон»: «Змінити магазин» and «Вношу продаж з паперу», a switch
    of the till's own state.

  «← Ще» stands over every screen opened from it; «← Товар» is gone, and
  the screen «Товар» is «Залишки», with no tiles.
- **«Змінити магазин»** on the workspace's line over every screen of a
  store, for whoever has two or more — one tap — and in «Ще» › «Цей
  телефон»; held as the menu is.
- **Docks over the menu:** the till's, a return's, a payment's, the
  cash's, an order's and every result's dock stands on the menu
  (`--menu-h`), the menu keeping the home indicator (`--dock-safe`); with
  the menu out of the way, over the home indicator itself. The page's foot
  and the room kept above a dock count the menu too.
- **The menu steps aside** while the phone's keyboard is up, and on S21,
  the till's payment.
- **Telegram:** once ready, `web_app_expand`, and `web_app_setup_swipe_behavior`
  with `allow_vertical_swipe: false` where the version knows it — once a
  launch, however often the app connects; never outside Telegram. The
  page's height is Telegram's stable height (`--tg-viewport-stable-height`
  from `viewport_changed`), `100dvh` otherwise; `100vh` is used nowhere.
- **The content is 560 px at most**, centred — Telegram on a computer —
  the menu's tabs with it.
- **Words that named a place that is gone follow it:** «Ціну для всіх
  задає менеджер у «Залишках».», «…а відсутній товар прийміть через «Ще» ›
  «Прийшов товар».», and the receipt's «Наступні внески — у «Продажі» ›
  «Внесок».». «Наступні внески — у «Боргах».» and «Решту — у «Боргах»
  цього магазину.» stay, as the owner chose on 2026-10-26.
- **Kept as it was:** the till's basket across «Ще» and back, the menu held
  while an operation is kept or sent, a kept operation's turn (§4б), the
  focus on «Ще» after a row opens its screen.

No backend change. No right changes: every tab and row is shown by the
right that showed its section before, and the server checks each as
before.

## Decided here, not by the owner

- **P0-4 in two parts**, the screen's own title as the page's heading the
  second.
- **The menu steps aside only while the keyboard is really up**: a field it
  opens for has the focus *and* the visible part of the screen is shorter
  than the tallest seen at this width by more than 150 px. On focus alone
  it would leave the till whenever the search takes the cursor as the till
  opens, keyboard or none.
- **«Брак»'s row keeps its tile's line** «N очікують перевірки», read each
  time «Ще» opens, grey while read, none when unread — until P1-5's
  counters.
- **«Прийшов товар»** is the row's word, as the task list and the tile
  said, though its screen is «Приймання товару».
- **«← Ще» is never held but while a first send is in flight**, as «Ще»
  itself; a row of «Ще» to a screen with a journal of its own — «Борги»,
  «Прийшов товар», «Залишки», «Каса», «Моделі» — is held by every journal
  but that one, so a kept operation's screen can always be come back to.
- **«Товар і каталог»'s row is held** only when every screen in it is.
- **«Змінити магазин» is held on S21** too, as the menu steps aside there:
  «←» is its only way out.
- **«Ще» marks a screen opened from it** as `aria-current="true"`, its own
  screen as the page.
- **A screen from «Товар і каталог» leads «← Ще» back to «Ще»**, not to the
  group's list.
- **«Вношу продаж з паперу» in «Ще»** only for whoever sells, in a store
  that trades, as at the till.
- **Whoever may not read orders opens on the first tab shown** — «Ще» for
  whoever has no other — never on a task's screen (§4а names no tab for
  them).
- **The receipt's next payments, «у «Продажі» › «Внесок»»**: the sections'
  task list's В5 (а), one word with it, as the frame's task list asks.
- **Expand and the swipe once a launch**, though the app connects twice in
  development and again on its crash screen.

## How it was built and proven

- **Files:**
  - new: `shared/TabBar.tsx` (`TabBar`, the keyboard's check);
  - `App.tsx`: the places, the menu's tabs, «Ще»'s groups, «Товар і
    каталог», the store line's «Змінити магазин»;
  - `shared/More.tsx`: a row's line, a switch row, a group's own list;
  - `shared/telegram.ts`: expand, the swipe, the stable height;
  - `inventory/Goods.tsx`: «Брак»'s line (`DamagedMeta`), the tiles gone;
  - `inventory/Stock.tsx` («Залишки», «← Ще»), `inventory/Receive.tsx`,
    `damaged/Damaged.tsx`, `credits/Credits.tsx`, `cash/Cash.tsx` («← Ще»);
  - `sales/PriceHint.tsx`, `sales/Sale.tsx`, `openings/Openings.tsx`: the
    words;
  - `styles.css`: the menu, the docks over it, 560 px, «Ще»'s lines and
    switch; the row's and the tiles' styles gone;
  - `e2e/fixtures.ts`: `menu`, and `section`, `more`, `changeStore` through
    the menu and «Ще».
- **Journeys:** the navigation's journeys in `till-sections.spec.ts`
  rewritten as P0-4's, and two new in `design-system.spec.ts`:
  - a seller's menu at 360 px, a glyph over each word, the open one on its
    pill; the owner's, «Каса» among the money; a manager's «Ще» with no
    network;
  - «Замовлення» a tab and «Борги» a row of «Ще» › «Люди»; the goods rows
    of «Ще» › «Товар», «← Ще» back from each; «Брак»'s line;
  - no tab or row without its right: no «Замовлення» without `sale:view`,
    no «Каса» without the drawer's rights, no «Накладні» without
    `supplier:debt`; whoever only reads orders, whoever reads nothing but
    «Ще»;
  - «Змінити магазин» one tap from any screen, and in «Ще»; the paper
    switch in «Ще» the till's own;
  - the till's dock over the menu at 360 × 640 and 390 × 844, none of its
    buttons under the menu;
  - the menu aside while the keyboard is up, and kept with the cursor in
    the search and no keyboard;
  - 560 px on a computer's window; both themes at 4.5:1, nothing wider
    than the phone, no tab's word cut;
  - Telegram 8.0 asked once for the whole height and the swipe, 6.0 for
    the height alone.

  Changed in 34 journey files: a press of «Клієнти» or «Товар» now names
  the place it meant — «Ще» › «Борги», «Ще» › «Залишки», or the
  «Замовлення» tab for a held menu — and «Каса» goes through `section`, a
  row of «Ще» for whoever reads the report. The owner's taps to «Каса» are one more, and to an
  order one fewer; the journeys' titles say so.
- **Journeys:** 722.

## Review

An independent review of the uncommitted tree found the rights sound —
every tab and row by the right that showed its section, nothing reachable
wider than before, nothing that could be opened now out of reach — and
the kept operations' turns, the paper switch, the variables and Telegram's
calls too. It found, fixed before the first commit:
- **A kept correction, count or write-off could strand the person on
  «Ще»**: its row was held by every journal, its own too, while «← Ще» and
  «Ще» were free; once left, the screen was out of reach until it settled.
  It was so on main, through the old «Ще». Each such row is held now by
  every journal but its own, as «Каса» and «Моделі» were; «← Ще» over
  «Прийшов товар» and «Брак», held while «Ще» under it was not, is free.
- **The keyboard's check took a pinched zoom for a keyboard**, and kept a
  window made shorter as one for good: it reads the unzoomed height now,
  measured afresh by every resize with no field in focus.
- **A dock was drawn under the menu for a frame** each time the menu came
  back: its height is set before the paint.
- **«Ще» said «current page»** over every screen opened from it: it says
  «current» there, «current page» on its own screen.
- **«Змінити магазин» was a way out of S21**: it is held there.
- **Comments named places that are gone**: brought up to date.

Not changed:
- **The receipt's «Наступні внески — у «Продажі» › «Внесок».»** is built as
  В5 (а) of the sections' task list and stays a question for the owner.

## Evidence

- Locally on `feat/frame`, against the E2E API and PostgreSQL 17 on a fresh
  seed:
  - 722 journeys: 720 passed. `backups.spec.ts` failed, finding 14 nights
    rather than 3: the local seed only adds, not this change. And the kept
    delivery's journey in `outage.spec.ts` failed: it still said «← Ще» was
    held, which the review's fix freed; it now proves the screen is come
    back to, and passed alone after the run;
  - the throwaway screenshots at 360 × 640 — the till with a coat, «Ще», the
    dock over the menu — looked as the design draws them, «Замовлення»
    whole;
  - eslint, tsc and the build are clean: app 510.39 kB, parts 2.61 kB,
    icons 6.56 kB, vendor 210.85 kB. The app's own file is past the 500 kB
    warning; the build only warns.
- **CI:** GitHub Actions on the pull request.

## Not covered here

- **On a real phone:** the menu under the thumb, the keyboard's check in
  Telegram on Android and iOS, the stable height while the sheet is
  dragged, and the home indicator under the menu.
- **Part 2:** each screen's title as the page's heading, «{Магазин} ·
  {Ім’я}» under it.
- **The menu on other task screens** (the count, the sheets): with their
  screens, the sections' task list.
- **The 500 kB warning:** either it is raised, or screens load when
  opened. To choose.
- **«До відправлення»** is still a warning (В5 (а)). To ask the owner.
- **Next:** P0-4's part 2, then P1-1.
