# «Усе на бірці», the till, part 2: the pay tray and the basket sheet — 2026-10-30

Baseline: `78c2dab` (#153, on main), and the frame's task list
([P0-5](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), items 3, 4, 5
and 7).
Status: built and reviewed; evidence below. CI is GitHub's, on the pull
request. Not yet seen on a real phone (С6).
Branch: `feat/till-tray`. Task: the frame's P0-5, part 2 of 3.
Chosen: business-rules.md, "Chosen in chat — 2026-10-30 (the till's tray
and basket sheet, «Усе на бірці» P0-5, part 2)".

Part 1 drew the models as tags and the sizes as cells. The basket's lines
still stood on the page under them, the panel under the thumb said only
«Лоран шоколад · M» or «У кошику: 3 шт.», and at 360 × 640 a second line
pushed the next model off the screen. Here the basket goes into a sheet,
and what stays under the thumb is one row of it, the sum and the three
ways.

## What exists now

- **The tray** (spec §6.15), only while the basket holds something, over
  the bottom menu, the perforation along its top edge:
  - row 1, one 44 button: «КОШИК · N», then the first line «{модель} ·
    {розмір}» cut short where it is long, then «›»; read aloud «Кошик · 2
    · Лоран шоколад · M», and it opens the basket's sheet;
  - row 2: «Разом {сума}» at 32, or, paid in parts, «Зараз … · винен …»,
    as before;
  - row 3: the three ways at 56, as before; from paper «З паперу · …» and
    «Продавець: …» under them, as before.
- **Over the tray, in the page's own flow:** the terminal's hint, or its
  paper variants, in their words (the task list's deviation 2, until В-Т4).
- **The basket's sheet** (spec §6.16, S10; `shared/Sheet.tsx`):
  - its title «Кошик», then each line as it was on the page: the model and
    size, «Склад: X», «−» the count «+», the price with its hint and the
    gift's warning, the size read off a label, «Прибрати …»;
  - «Оплата частинами» and its fields under the lines; «Готово» at its
    foot, under the scrolling inside, always in view;
  - it rises from the bottom over the menu, at most 92 % of Telegram's
    height and never more than the keyboard leaves, its inside scrolling,
    the till dimmed behind and out of reach;
  - for a moment after it opens it lets a tap go: the second of a double
    tap lands on what rose under the finger;
  - closed by «Готово», Telegram's «Назад», Escape, a tap on the dimmed
    till, its handle pulled down, and the keyboard's «Готово» after a price
    or after the sum paid now;
  - closed, nothing of it is lost: the lines, the prices and the terms are
    the till's, as before;
  - the cursor goes into it, and back to what opened it once it closes —
    to the tray's row when that is gone, to the search when the basket is;
    what it goes back to is scrolled into sight over the tray.
- **The sheet opens by itself** when a model with no price is tapped, the
  cursor in its price; and when a way is pressed with the terms in parts
  not whole, what is missing said at its top.
- **While a line waits** — for its price, or, from paper, to be taken out
  after its size was read off a label (G3) — the ways are dimmed, as
  before, but a press opens the sheet at that line, the cursor in the
  missing price. Nothing is sent.
- **An emptied basket** closes the sheet, and the tray goes.
- **The price's key** on the keyboard is «Готово» (`enterkeyhint="done"`).
  The count has no keyboard: «−» and «+».
- **The search takes the cursor** as the app opens on the till, and on
  «Новий продаж» (P0-3, and a return's, as before); the till reached by
  «Продати» or by the menu leaves the cursor on what was pressed (review,
  2026-10-17).
- **360 × 640** (С1): with a coat in the basket, the search, one whole tag
  and the tray are on the screen at once; at 390 × 844, two tags.
- **While the shelf's answer stands**, the search lets go of the top and
  goes up with the page: at 360 × 640 the answer is 357 px, and between the
  held search and the tray there are 329. Without it held, the whole answer
  stands over the tray, as the review of 2026-10-15 asks.
- **Layers:** the tray at the design system's 20, under the menu's 30; the
  sheet at 40, over both.

No backend change. No right or rule changes.

## Decided here, not by the owner

- **The terminal's hint over the tray, not in it:** in it, at 360 the tray
  grew to some 250 px and covered the till.
- **The tray counts coats, not lines:** «Кошик · 3» for one line of one and
  one of two, as «У кошику: 3 шт.» counted before; the spec's «Кошик · 1»
  does not say which.
- **The tray names the first line only**, however many there are.
- **No notches on the tray's edge,** the perforation only: the tray stands
  over the tags scrolling under it, and a notch would show them through.
- **No icons on the three ways:** from paper «З паперу · Готівка» already
  fills a third of 360 px; the task list asks for the three buttons.
- **The size read off a label is in the sheet**, and a tap on «?» does not
  open it: unread, the coat sells as «розмір невідомий», as before.
- **The sheet rises; it does not sink:** closed, it is gone at once.
- **Pulled down past 80 px**, the handle closes the sheet; less, it springs
  back.
- **«Готово» is a quiet button**, at the sheet's foot.
- **The ways dimmed but pressable while a line waits** (above), not
  pressable as before: closed, the sheet says nothing on the page.
- **A tap let go for a moment after the sheet opens:** `CARRIED_TAP`, as
  the order's steps; the journeys wait for it.
- **The search lets go of the top while the shelf's answer stands**, until
  part 3 puts the answer in a sheet of its own (above).
- **The search in focus «on open»** (S08) is read as the app opening on the
  till: the rule of 2026-10-17 keeps the cursor on «Продати» and on the
  menu's tab when the till is reached by them.
- **Waiting for part 3:** the shortage as a sheet, «Вношу продаж з паперу»
  as a switch row, the taps counted; the light tap and the `drop` to the
  tray (P1-2).

## How it was built and proven

- **Files:**
  - new: `shared/Sheet.tsx` (`Sheet`): the sheet over the screen, its
    scrim, its handle, Telegram's «Назад» as the last way back
    (`addBackWay`), Escape, the cursor in and back;
  - `sales/Sale.tsx`: the tray; the basket's lines and «Оплата частинами»
    in the sheet; the sheet opened for a model with no price and for terms
    not whole; the terminal's hint over the tray;
  - `credits/Terms.tsx`: `done`, the keyboard's «Готово» after the sum;
  - the ways dimmed while a line waits, pressed to the sheet at it;
  - `App.tsx`: the till's cursor in the search as the app opens on it;
  - `styles.css`: the tray, its basket row and perforation, the sheet;
  - new journeys: `e2e/till-tray.spec.ts`; `e2e/fixtures.ts`:
    `basketSheet` and `basketDone`, and `fillLine` through the sheet;
    `tapSize` looks again when a search answered under it takes «Ще
    товари» away.
- **Journeys** (`till-tray.spec.ts`, the goods and the sale's answer
  stubbed):
  - the search in focus as the till opens;
  - the tray with the first coat: «Кошик · 1 · Лоран шоколад · M» read
    aloud, its row 44, «Разом 1 850,00 грн», the ways 56, no line and no
    sheet on the page; the next tap «Кошик · 2»;
  - the row opens the sheet: «Кошик», the line, «Склад: Каса-склад»,
    «Більше», the price's key «Готово», a price typed, «Готово»; the tray
    «Кошик · 2», «Разом 2 000,00 грн»; opened again, the price kept;
  - closed by Telegram's «Назад» (the button shown while it is open, then
    hidden), Escape, a tap on the scrim, the handle pulled 160 px; pulled
    30 px, it stays; the basket kept each time;
  - a model with no price, on 360 × 640: the sheet opens itself, the
    price in focus, Enter closes it, «Разом 1 500,00 грн», the cursor back
    on the cell, and the cell over the tray;
  - in parts in the sheet: the name in focus, Enter after the sum closes
    it, the tray «Зараз 1 000,00 грн · винен 850,00 грн»;
  - the basket emptied in the sheet: the sheet and the tray gone, the
    cursor in the search;
  - the sheet closed with a price missing: «Разом —», the ways dimmed; a
    way pressed opens the sheet at the line, the cursor in its price,
    nothing sent;
  - a tap on the scrim at once after a model with no price opened the
    sheet is let go; a moment later it closes it;
  - while «Готівка»'s press is sent, the tray's row opens no sheet;
  - with the screen shortened to 320 px under a stable height of 640, the
    sheet within the screen, its inside scrolling to the name, «Готово» in
    view;
  - the app's root `inert` while the sheet is open, the cursor back on the
    row once it closes;
  - 360 × 640, one whole tag between the search and the tray; 390 × 844,
    two.
- **Journeys changed:** every journey that read, set or took away a
  basket line now does it in the sheet (`basketSheet`, `basketDone`);
  paying in parts opens it first, and closes it before the way; the
  terminal's hint, not the last line, is what stands over the tray; the
  tray's «Кошик · N · …» for «У кошику: N шт.»; the ways read under the
  tray's basket row.
- **Proven to catch**, each broken once, its journeys run, then undone.
  Fourteen breaks, each failing the journeys named for it:
  - the sheet's way back taken under StrictMode's second mount: the cursor
    never in the price (the no-price journey here and in
    `till-search.spec.ts`);
  - a way pressed while a line waits sending the sale: the sheet not opened
    at the line;
  - the carried tap taken;
  - no `inert` on the app's root;
  - the emptied basket leaving the cursor nowhere;
  - the sheet 92 % of the stable height whatever the keyboard leaves;
  - a pull of 20 px closing the sheet;
  - the search held at the top through the shelf's answer
    (`till-redesign.spec.ts`);
  - the till opened by the app without the cursor in its search;
  - the tray counting lines, not coats (`till-money-words.spec.ts`);
  - the ways at 54;
  - «Оплата частинами» kept for the next customer (`credits.spec.ts`);
  - the row opening the sheet while a press is sent;
  - the way back not scrolled: the cell left under the tray.
- **Journeys:** 753.

## Review

An independent review of the uncommitted tree found no sale lost or
changed. Telegram's «Назад» is added and taken away in step with the
sheet, StrictMode included, and is the last way while the sheet is open.
No Escape of the app's own is in its way. The till takes `searchFirst`
before the tab's effect clears it. `.pay-panel`'s rules for the other
screens are as they were, and the tray's room is measured from the tray
as it is drawn. It found, fixed before the commit:
- **The ways dimmed with nothing on the page saying why:** a sheet closed
  with a price missing, or from paper with a size read off a label, left
  three dimmed ways under «Разом —», and what they wait for was said only
  inside the closed sheet. Now they are dimmed but pressable
  (`aria-disabled`). A press opens the sheet at that line, the cursor in
  the missing price, and nothing is sent. A journey covers it.
- **A double tap carried into the sheet:** the second tap of the one that
  opened it landed on the scrim and closed it, or on what rose under the
  finger. For a moment after it opens, the sheet lets such a tap go, as
  the order's steps do (review, 2026-10-24). A key's press still goes
  through. A journey covers it.
- **The sheet opened while a press was sent:** the shelf's answer would
  have come under it. The row opens nothing while a press is sent. A
  journey covers it.
- **Over the keyboard, the sheet ran off the top:** where the keyboard
  makes the screen shorter, as on Telegram for Android, the sheet kept 92 %
  of the stable height. It is never taller than what is left now. A
  journey shrinks the screen to 320 px.
- **The cursor lost to the page:** with the last line taken out in the
  sheet, the row that had opened it was gone, and so was the coat taken
  from the catalogue. The cursor now goes to the search, or back to the
  tray's row.
- **`aria-modal` with the screen behind in reach:** Tab, a tap or a reader
  could get to the ways under the scrim. The app's root is `inert` while
  the sheet is open, and a finger on the scrim scrolls nothing.
- **«Продати — як платить покупець» around the basket's row:** the group
  holds what is paid and the ways, without the row.
- **Journeys weaker than their titles:**
  - after «Новий продаж», «Оплата частинами» is now checked unticked in
    the next coat's sheet, where before nothing could be found;
  - «Кошик» is checked as the basket's own sheet;
  - the warehouse's line is read in the dialog.
- **«Готово» scrolled away with several lines:** it stands at the sheet's
  foot, under its scrolling inside.

Before the review, the run of the journeys found the cursor never reached
an unpriced line's price under React's StrictMode: the sheet, mounted
twice, gave the cursor back to the cell. The way back is taken only once
the sheet is really gone. The handle's long pull was also decided by what
had been drawn, not where the finger was let go. A quick pull now closes
the sheet too.

After the review, the screenshots at 360 × 640 found the cursor's way back
under the tray. The tray that comes with the first coat covers the cell
just tapped, and the cursor went back to it without scrolling. Now it
scrolls, and the page's scroll padding keeps the cell clear of the tray.
On iOS a tapped button takes no cursor: the sheet then goes back to the
tray's row, not to the page's body.

## Evidence

On the Mac, against the E2E API and PostgreSQL 17:
- **e2e, the seed run afresh:** all 753 journeys, 752 passed. The one
  failure is `backups.spec.ts`: it finds more nights than it expects,
  because the local seed only adds, as on main.
- **Earlier runs on the same database, not seeded afresh,** also failed
  lists grown past their first page (the catalogue, openings, a
  correction, «Залишки»'s prices), the cash journeys after midnight, and
  at last the till's stock sold out. Six of those specs, run on main the
  same way, failed there too: 20 failures.
- **frontend:** eslint, tsc and the build are clean. App 516.09 kB (513.23
  before), parts 2.61 kB, icons 6.56 kB, vendor 210.85 kB.
- **Screenshots** at 360 × 640, light and dark (throwaway): the tray with
  two coats, the sheet, the sheet opened by a model with no price, the
  ways waiting under «Разом —».

## Not covered here

- **On a real phone** (С6): the sheet under a thumb, its handle pulled,
  the keyboard over it, Telegram's «Назад» while it is open.
- **Part 3:** the shortage as a sheet, «Вношу продаж з паперу» as a switch
  row, the taps counted (3 for a priced coat, 5 in parts).
- **In dark, the tags sit on the till's card**, as after part 1.
- **The app's own file past 500 kB:** still to choose.
