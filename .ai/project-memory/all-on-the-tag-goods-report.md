# «Усе на бірці», «Товар»: the model's detail, «Інвентаризація» — 2026-11-01

Baseline: `5c99659` (#164, on main), and the sections task list
([P0-6, P1-5](redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md),
their decisions and acceptance), with the spec's S23 and §6.13 (the size
cells).
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/goods`. Task: the sections task list's P0-6 and P1-5 as one
step, as its §8 orders (chosen in chat, 2026-11-01, «go next»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-01 («Товар»: the
model's detail, «Інвентаризація»; sections P0-6, P1-5)". В4 is built by
(а); the design's Q-6 stays «if no».

How much of a coat there is, size by size and warehouse by warehouse, was
a list of one warehouse at a time under «Ще» › «Товар» › «Залишки»: a
warehouse chosen, a card a size, «На складі», «У резерві», «Доступно»
each — to find a size everywhere, every warehouse in turn (≥ 6 taps). Now
the model's name on the till's search opens its detail: one grid, a row
a warehouse and a column a size, what orders hold under each row, and
«Можна продати» under them all (2 taps). Corrections, the price and the
stocktake are each a way from it, by its own right. Nothing changes on
the server.

## What exists now

- **The way in:** at the till, «Продати», the model's name on its tag is
  a button; it opens S23 with «← Продаж» (and Telegram's «Назад»); back
  on the till, its search and basket as they were.
- **S23:**
  - its name in capitals on a hero tag; «Ціна продажу 3 600,00 грн» or
    «не задана»; «Змінити ціну» (`catalog:set_price`), the price editor
    in a sheet named by the model;
  - the grid: the sizes in the organization's order, «?» for a size not
    known, «Разом»; a row a warehouse holding any of it — those the
    store sells from first, «з них у резерві» under each where orders
    hold any, «Брак» with its torn tag, a paused one grey with «Склад на
    паузі. Залишки доступні для перегляду.» under the grid; then
    «Можна продати»; «·» for none, read «0»; nothing in it is pressed;
  - its ways: «Прийшов товар» (`inventory:receive`) with the model
    chosen and «← {модель}»; «Виправити залишок» (`inventory:adjust`), a
    sheet of cells — a size and a warehouse that may be corrected each,
    one an order holds dark with the approved line under them — a tap,
    the correction form as it was; ⋯ «Інвентаризація»;
  - recorded: the sheet closes, a stub says what, the grid is read again.
- **«Інвентаризація»:** «Ще» › «Товар», after «Брак», for
  `inventory:adjust`; the warehouses that may be corrected as chips; the
  stocktakes and «Знайшли товар, якого немає в списку» as they were.
- **«Залишки»:** only for whoever reads the stock with no till in the
  store; its stocktake moved to «Інвентаризація».

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the way in from «Продати» only; «Залишки» kept for whoever has no till;
- how the grid is read and drawn, and its ways;
- where a kept correction or count opens;
- a correction whose answer is lost closes its sheet.

## How it was built and proven

- **Files:**
  - `frontend/src/inventory/Model.tsx` (new): S23 — its reads, the grid,
    its ways and sheets;
  - `frontend/src/inventory/Stocktaking.tsx` (new): «Інвентаризація», the
    stocktake and «Знайшли товар…» moved from «Залишки» as they were;
  - `frontend/src/inventory/Stock.tsx`: «Залишки» without the stocktake;
  - `frontend/src/inventory/Stocktake.tsx`: its own heading gone, the
    screen's title says it;
  - `frontend/src/inventory/Correction.tsx`: says when its answer is lost;
  - `frontend/src/inventory/Receive.tsx`: opens with a model chosen;
  - `frontend/src/sales/Sale.tsx`, `frontend/src/sales/StockSearch.tsx`:
    the model's name a button, the search kept for the way back;
  - `frontend/src/App.tsx`: the two screens, «Ще» › «Товар»'s rows, the
    ways back, where a kept correction or count opens;
  - `frontend/src/styles.css`: the hero, the grid, the ways.
- **Journeys:** 868 in all (856 after #164).
  - **new:** `model.spec.ts` (10) — the TZ's acceptance grid at 360 × 640
    in both themes, nothing pressed in it and nothing written; six sizes,
    «?» and «Разом» fitting, a paused warehouse; the sizes' order with and
    without receiving's right; paging, never past the model; a read that
    fails; the real stock against the server's, «← Продаж» with the search
    and basket as left; a seller's ways; «Прийшов товар» and ⋯
    «Інвентаризація» with «← {модель}»; the correction sheet's cells — no
    «Брак», no paused warehouse, a held cell opening nothing; after the
    review, a name tapped while a new search is read, and a model sold out
    since it was found;
  - **moved to the new ways in:** `correct.spec.ts` (S23's sheet, and
    «Інвентаризація» for goods found), `price.spec.ts` (S23's «Змінити
    ціну»), `stocktake.spec.ts` (the chips), `person-limit.spec.ts`,
    `outside-text.spec.ts` (S23's name);
  - **«Залишки» for whoever has no till:** `stock.spec.ts` (and a journey:
    with the till, no «Залишки»), `damaged.spec.ts`, `returns.spec.ts`,
    `outage.spec.ts` (a stock-keeper with no till; a kept count of whoever
    may correct opens «Інвентаризація»);
  - **«Інвентаризація» where «Залишки» stood:** `till-sections.spec.ts`,
    `telegram-back.spec.ts`, `people.spec.ts`, `models.spec.ts`,
    `suppliers.spec.ts`, `supplier-invoices.spec.ts`, `stores.spec.ts`;
    `fixtures.ts` (`openModel`, `gridCell`, `units`; `section()` knows
    «Інвентаризація»).

## The independent review

An agent read the change cold (2026-11-01). What it found, and what was
done:
- **Fixed:**
  - a model's name tapped while a new search was read opened the model by
    the new search — perhaps «Зараз цієї моделі немає…»: now by the search
    its tag was found by (`model.spec.ts`, «a name tapped while a new
    search is read»);
  - without receiving's right, a size held only on the second warehouse
    the store sells from fell after the others: the listings' own order
    is merged now (`model.spec.ts`, the sizes' order, two warehouses);
  - a model sold out since the search said «Ціна продажу не задана»:
    nothing is said of its price now (`model.spec.ts`, «a model sold out
    since it was found»);
  - the focus was lost to the page on the way to the model and back: it
    stays on «Продаж» (`model.spec.ts`, the real stock and the ways);
  - a correction kept with its sheet closed let «Виправити залишок» and
    «Прийшов товар» be tapped again under the app's notice: they wait
    (`correct.spec.ts`, «a correction whose outcome is unknown»);
  - the price sheet closed while a price was saved, its answer said to no
    one: it stays (`price.spec.ts`);
  - «Інвентаризація» was offered to whoever may correct the stock but not
    read it, whose reads are refused: it is not now (`stocktake.spec.ts`,
    either right taken);
  - «Інвентаризація»'s count could be drawn on another warehouse once the
    only one changed: a count is its warehouse's;
  - a kept correction or count, settled, left the till's search as read
    before: it is read again;
  - the till's price hint sent the seller's manager to «Залишки», which a
    manager with the till no longer has: it names the model's detail
    (`till-search.spec.ts`, `orders-new.spec.ts`);
  - the search kept for the way back from a model came back on a till
    opened afresh — a kept sale settled, say: the till takes it once.
- **Recorded for the owner, not changed:** stock only on a warehouse the
  store does not sell from is not reached by whoever has the till; the
  stocktakes of a paused, non-receiving or «Брак» warehouse are read by no
  one (business-rules.md, the heading above).
- **Left as they were:** a model's detail opened from the whole list (no
  search) reads each warehouse the store does not sell from to its end —
  as many pages as that warehouse holds, once; one failed read replaces
  the screen with «Спробувати ще раз», as every screen does.

## Mutants

50 changes to the source, each applied alone and run against the
journeys that should catch it (`~/.cache/birka-runtime/helpers/mutate13.py`,
`mutants13.sh`): how the model's rows are read (paging, stopping, the
search, «Брак»'s own reads, the retry); the grid (the warehouses' and the
sizes' order, «·», «Можна продати», the reserve's row, the paused and
«Брак» looks, the price line); its ways and their rights; the correction
sheet's cells; the way in and back (the name a button, the search kept and
forgotten, the focus on «Продаж»); where a kept correction or count opens;
«Інвентаризація»'s rights, chips and only warehouse; and the review's
fixes. All 50 are caught. Five were not at first, and their journeys were
sharpened: «Брак» holding other models on its first page (a read that
stopped early), «Брак» first in the store's order, a size not known listed
first, the price sheet asked to close by its scrim (Escape went to no one
once the save button was disabled), and «Прийшов товар» for whoever may
not receive, checked where that right is taken.

## Evidence

- Every journey on a fresh seed, on the Mac (2026-11-02): 867 of 868 pass
  in 16.9 minutes. The one failure is `backups.spec.ts:78`, which fails only
  on this Mac, as on every batch before; CI runs it.
- `tsc -b`, eslint over `src` and `e2e`, and the build: clean. Prettier:
  clean in every hunk of this change (main's own unformatted lines are
  left as they were).
- The 50 mutants above, all caught.

## For the owner

Asked as words of the screen, each built by its «if no»
(business-rules.md, the heading above): «Можна продати», «з них у
резерві», «Разом», «?», «Ціна продажу …», «Змінити ціну», «← Продаж» on
the model, «Інвентаризація» as a row and a title, «Склад «…»», «Зараз
цієї моделі немає на складах магазину.», «Немає складу, де цей магазин
може виправляти залишки. Зверніться до менеджера.», and the till's price
hint «Ціну для всіх задає менеджер: «Продаж» › назва моделі › «Змінити
ціну».». And three losses, each kept by its «if no»: a model held only
where the store does not sell is not reached from the till; past
stocktakes are a manager's; a paused, non-receiving or «Брак» warehouse's
stocktakes are read by no one until it may be corrected again.

## Not covered

- A real phone: the grid at 360 is proven in Chromium's phone profile in
  both themes, not on a device or in Telegram's own web view.
- CI's Linux font (DejaVu) is wider than the Mac's: a long warehouse name
  in the grid's first column is first seen there, on the pull request.
- Two fixes have no journey of their own: the till's search read again
  once a kept correction or count settles, and the till taking its kept
  search once — each is seen only after the app reopens on the till, or a
  kept sale settles, with a model opened meanwhile; both are read in the
  code and named here.
- «Інвентаризація»'s count kept to its warehouse when the only one
  changes has no journey: it needs a warehouse paused and another
  activated while a count is open.
