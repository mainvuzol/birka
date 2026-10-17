# Both warehouses in the till's search; the screen kept in place — 2026-10-17

Baseline: `7f8aa3e` (the day's count on the receipt, PR #97).
Status: TODO.
Branch: `feat/till-search-both-warehouses`. Tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P2-5, P2-6. Owner: business-rules.md, "both warehouses in the till's
search; the screen kept in place" (2026-10-17).

## Why this was next

The owner named them after the day's count merged: the last two of the
till's task list. A store that sells from its own warehouse and a shared
one chose the warehouse first and searched after, so a coat «on the other
one» was not seen and was searched for twice. And «Завантажуємо…» stood
where the field and the tags were coming, so the screen jumped when they
came — under the finger, a missed button.

## What exists now

- **A store that sells from two or more warehouses lists them all at
  once:** «Склад» reads «Усі склади», and each model's chips name their
  warehouse — «M · Свій 1», «M · Спільний 2» — a size's chips together, in
  the store's order of warehouses. A tap puts the coat in the basket from
  that warehouse; each line keeps its own. One warehouse may still be
  chosen alone, and its chips then read «M · 2».
- **A warehouse still waiting for its opening list** is said to sell on
  paper, «Склад «Свій» ще чекає початкових залишків: його товар продавайте
  на папері.», while the other's goods are listed; both waiting, the till
  says to sell on paper and lists nothing.
- **A coat in hand from the catalogue,** with every warehouse listed, is
  asked «З якого складу віддаєте?» before the catalogue is offered, and
  leaves from the one said.
- **The server** lists every warehouse the store sells from now — active,
  with `can_sell` — the caller may read, when the till names none
  (`GET /catalog/stock-options`, ADR-0004, 2026-10-17); each row names its
  warehouse. A warehouse named is listed alone, as before.
- **A line says its warehouse** — in the basket, its count, «Прибрати», a
  shortfall and the receipt — while every warehouse is listed or the basket
  holds more than one: two «Лоран шоколад · M» are told apart, and a
  shortfall says which shelf to look at before «Товар на місці».
- **What is being read keeps its place:** signing in and the warehouses
  show grey places of the search field and three tags, the goods those of
  three tags, in their sizes; a screen reader still hears «Входимо в
  магазин…», «Завантажуємо склади…», «Завантажуємо товари…». A search
  typed keeps the list where it was until the new one comes, so nothing
  under it moves.

Nothing about money, stock or who may do what changes. No migration.

## Decided here, not by the owner

- **«Склад» stays, «Усі склади» first:** a store may sell from more than
  two warehouses, and a seller may want one; chosen alone, it lists as a
  one-warehouse store's.
- **A coat from the catalogue is asked its warehouse** when all are
  listed: the server never chooses (owner decision, 2026-09-17).
- **A search keeps the list until the new one comes,** rather than places
  each time a letter is typed; the places are for a first read.
- **A line says its warehouse** only where it could be another's: chosen
  alone, a warehouse's lines read as a one-warehouse store's.
- **The placeholders breathe slowly,** and stand still for whoever asks
  their phone for less motion.
- **The hot path measures the new read** of every warehouse, alone and by
  six sellers, in a world whose second warehouse holds every other model.

## How it was built and proven

- **The server, against real PostgreSQL** (`test_till_search_warehouses.py`,
  4):
  - no warehouse named: every one the store sells from, each row naming
    its own — never one without `can_sell`, a paused one, or one the store
    does not reach; a warehouse named, alone;
  - pages across two warehouses neither repeat nor skip a row;
  - the same right as one warehouse's list;
  - a warehouse the store manages for itself only for whoever reads that
    store's own, never through a network-wide right (I23).
- **The hot path** measures the till of two warehouses, alone and by six
  sellers (`measure_hot_path.py`, its tests).
- **The till of two warehouses** (`till-two-warehouses.spec.ts`, 10; the
  warehouses, goods and answers stubbed):
  - «Усі склади» first, the search at once, chips «M · Свій 1», «M ·
    Спільний 2», a size's chips together in the store's order; two lines
    from the two warehouses, named apart, sent each with its own;
  - one chosen alone, listed alone, «M · 2»;
  - a model's sizes in its own order, whatever another model lists first;
  - a warehouse waiting said, the other's goods listed; both waiting,
    nothing asked for;
  - another warehouse chosen: its own places while read, never the
    other's chips;
  - a shortfall naming the warehouse's shelf, and the receipt naming it;
  - «Розмір з етикетки» offered only for a line from the warehouse holding
    the coats of no size;
  - from paper, the press naming both warehouses;
  - a coat from the catalogue asked its warehouse, leaving from it, and the
    next one asked again.
- **The screen kept in place** (`till-placeholders.spec.ts`, 5, each read
  held back): signing in, the warehouses and the goods show their places
  and say «Завантажуємо…»; a search typed keeps the list, and the basket's
  line under it stays where it is on the page; a search with nothing found,
  typed further, never says «нічого немає» before it is searched.
- **The journeys before:** the two that waited for the first list now wait
  for their warehouse's; the one that asked a warehouse first is replaced.
- **Mutation:** twenty-one ways of breaking it, one at a time, each
  against the tests or journeys meant to catch it, after the unchanged tree
  passed: all caught on the first run
  (`output/verification/2026-10-17-till-search-both-warehouses/`) — the
  server's list selling or not, paused, private, its rows unnamed; the till
  asking for one warehouse first, chips unnamed, the coat leaving from the
  warehouse chosen, sizes out of order, the lines or the receipt unnamed,
  the waiting warehouse unsaid, both waiting still asked for, the catalogue
  not asking or remembering; a stale empty list speaking, a search blanking
  the list, another warehouse's list kept, the places silent, without their
  field or its height.

## Review

An independent review before the first commit found the basket's keys,
the catalogue's and paper's warehouses, the stale data and the server's
filter right, and the following, all addressed before the first commit:
- **A blocker:** a model's sizes were ranked by where each size first came
  in the whole list, so «Лоран» after a model with only L read L, S, M —
  in every store. Each model keeps its own order now, and a journey holds
  it.
- **Lines that did not say their warehouse:** two «Лоран шоколад · M» could
  not be told apart, and a shortfall did not say which shelf «Товар на
  місці» would record a coat at. The basket, «Прибрати», the shortfall and
  the receipt name it now, where it could be another's.
- **The catalogue remembered the last warehouse** for the next coat; it
  asks anew.
- **The status inside a busy region** might not be heard: it stands apart.
- **The pay panel's place proved nothing,** being pinned to the screen's
  foot: the basket's line under the list is measured on the page now.
- **Untested:** a model of no size in one warehouse only, the paper's two
  warehouses, a private warehouse with none named — each has a test now;
  the hot path measures the new read.
- **Smaller:** holds released without a race, no line without a warehouse,
  a chip of a warehouse the till does not list read as one, the store's
  warehouses kept between drawings, the README's contract, and the docs'
  words for what each place holds.

## Evidence

TODO

## Not covered here

- **On a real phone:** the chips with warehouse names at 360 px, and the
  placeholders, in Telegram's own web view, on Android and on iOS, are not
  tried on a device yet.
- **Г6** — whether the seller knows which warehouse a coat in hand is
  from — is still a hypothesis: the chips make the choice visible, not
  certain.
- **The signing-in places draw the till,** though someone with two or more
  stores chooses a store next; and the warehouses' places hold one field
  where a store of two shows «Склад» and the search.
- **«Ще N шт. у резерві замовлення»** sums every warehouse listed, and does
  not say which holds the reserve.
- **В9, В10;** the bot's «6100,00 грн»; the next section's task list.
