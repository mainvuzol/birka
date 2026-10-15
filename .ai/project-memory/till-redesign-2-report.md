# The till's search and one tap of a size — 2026-10-15

Baseline: `c641a52` (the till in the new design, first part, PR #90).
Status: TODO(final).
Branch: `feat/till-search`. Direction:
[design-direction.md](redesign/design-direction.md) (approved 2026-10-11);
tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P0-2, P0-3, with P2-3 and the texts of В5. Owner: business-rules.md, "the
till's search, one tap of a size, the app's name" (2026-10-15).

## Why this was next

After PR #90 the till opened on itself, with the total and the three ways
under the thumb, but a coat was still picked from a native list of a
hundred rows, «Назва · M · доступно 3», in the order of the database's ids,
one model's sizes scattered among the others, a page at a time; the
quantity and the price sat in fields above the basket, and «Додати в
кошик» was a tap of its own. The owner chose the search and one tap of a
size next, on 2026-10-15, and answered two more of the list's questions: the
app's name (В4) and two paper-mode texts a seller misreads (В5).

## What exists now

- **The list reads by name.** `GET /catalog/stock-options` lists a
  warehouse by the model's name, its source and its colour, each model's
  sizes together in receiving's order and a size not known last, a hundred
  rows a page. Every screen that reads it does: the till, «Залишки»,
  «Постачальникам» and «Нове замовлення», which keeps its own list, now
  by name. What it may show is unchanged (I23): the same access checks,
  now shared with `readable_stock` (`_readable_places`), and only what is
  held. Models whose names differ only in material, texture, fur, collar
  or length follow one another in no set order.
- **The search.** An optional `query`, at most 200 readable characters:
  every word must be in the model's name, its source or its colour,
  literally, and a merged model's old name finds the model that stays, as
  receiving's search does. No migration.
- **At the till** (`sales/StockSearch.tsx`): «Знайти модель», «Назва або
  колір», searching from two letters after a third of a second; each model
  a tag — its name, its price, a chip per size held, «M · 2», «Розмір
  невідомий · 3»; a chip whose every coat an order holds offers nothing,
  and the tag says «Ще 2 шт. у резерві замовлення» — but from paper, where
  the server's refusal says what to do, as before (ADR-0013 §6). «Ще товари» adds the
  next hundred under the first. Nothing found: «За «зима» на складі
  «Основний склад» нічого немає. Перевірте назву або очистіть пошук.» and
  «Очистити».
- **One tap of a size** (P0-3) puts the coat in the basket; the same chip
  again is one more. The line holds «−» and «+» (1 to 1000) and «Ціна, грн»,
  filled with the model's price, «Ціна продажу 1850,00 грн. Домовилися про
  іншу — змініть.»; a model with none leaves it empty, takes the cursor,
  and says «Ціни продажу ще немає — впишіть домовлену.»; the three ways
  wait for a price in every line, «Разом —» until then, and a price that
  does not read as money says «Впишіть ціну: гривні й копійки, напр. 1850
  або 1850,50.». Any
  change is a new sale, with a new `command_id`, and the server's answers
  about the shelf go, as before. «Розмір з етикетки» moved into the line of
  a coat held with its size not known; a line so read before «Вношу продаж
  з паперу» was ticked holds the ways, since no size is read off a label
  from paper (G3). A line remembers whether its model was listed with
  coats of no known size, so the shortage offers the answer that fits
  whatever was searched after.
- **One warehouse to sell from is named** («Склад: Основний склад»); two are
  asked, «З якого складу віддаєте?». A warehouse paused or no longer sold
  from is not kept as the till's. The hint above the till went.
- **«Новий продаж»** puts the cursor in the search, cleared; the shelf is
  read again.
- **The app is «Бірка»** in its header, on the sign-in and crash screens,
  and in the browser's tab (В4).
- **Paper mode's two texts** (В5): «Він увійде в сьогоднішні продажі й у
  касу до наступного закриття.» and «Товар з невідомим розміром вносьте як
  «розмір невідомий».»

Nothing about money, stock or who may do what changes; `POST /sales` does
not change. The stock list's order changes for every screen that reads it.

## How it was built and proven

- **Server tests** (`test_till_search.py`, 11): a few letters find the
  model and nothing else, in any case; every word must match the model,
  the source or the colour; `%` and `_` are literal; a merged model's old
  name finds the one that stays; the list reads by name with each model's
  sizes in order (S, M, XL, then «?»; 42, 44, 46); Ukrainian letters in the
  alphabet's order, where the database collates by ICU `uk-UA`; pages
  neither repeat nor skip a row; a model sold out is not listed; a search
  reaches no further than the list (another network's warehouse, no right
  to see stock); a search that cannot be read is refused.
- **The hot path:** two new cases, the search alone and by six sellers
  (`measure_hot_path.py`, its unit tests).
- **Journeys** (`till-search.spec.ts`, 10, and every journey that sold a
  coat moved to chips — `tapSize()` and `fillLine()` in `e2e/fixtures.ts`):
  - a model past the first hundred is found by three letters and sold by
    the search, its chip and a way on a 360 × 640 screen, at its price,
    with nothing typed but the search; one letter and a pause is no search;
    the next sale is «Новий продаж», a chip and a way;
  - «Ще товари» adds the next hundred under the first;
  - nothing found says where, and «Очистити» brings the list back;
  - a size whose every coat an order holds offers nothing;
  - the same size twice is one line of two, and «Менше» never takes a line
    away; a price changed in the line is the price sent;
  - a model with no price: its field takes the cursor, and the ways wait;
  - a line changed after the server's shortage answer — given and refused
    again — is a new sale, its answers gone;
  - a line keeps knowing its model is held with no size, whatever is
    searched after;
  - a size read off a label holds the ways once the sale is from paper;
  - a warehouse that stops selling is not the till's any more;
  - the price set in «Залишки» is the one the line starts from, and a model
    with none never keeps another's (`price.spec.ts`); the label's size in
    paper mode (`outage.spec.ts`); the app's name on the sign-in and crash
    screens.
- **Mutation:** thirty-seven ways of breaking it, one at a time — twelve on
  the server, run against its tests, and twenty-five on the screens, against
  the journeys on a fresh seed each — after the unchanged tree passed both
  ways: thirty-six caught, each by the test meant to catch it.
  - Two survived a first run, and a test now closes each: one model's colours
    were never asserted in order, and the size-unknown journey tapped before
    its second search had narrowed the list.
  - The one left is equivalent on the till's path: without the
    `location_id not in granted` check, `require_stock_access` has already
    refused a private warehouse, since the till always passes a scope.

## Review

TODO(final).

## Evidence

TODO(final).

## Not covered here

- **On a real phone:** the keyboard over a line's price field and the
  search's scroll are not seen on a device yet (the task list's С5, С7).
- **A count typed in:** many of one size are tapped one by one.
- **The return's paper text** still names «Звіт»; В5 named the sale's.
- **«Нове замовлення»** still picks from its own list, now by name (the
  task list leaves it for later).
- **The direction's chip «в корзине» with «×N»** and a search icon are not
  drawn; money still reads «1850,00 грн», not «1 850,00 грн» (P2-1).
- **В1 and В3** are decided and recorded, not built (P1-5, P1-8).
