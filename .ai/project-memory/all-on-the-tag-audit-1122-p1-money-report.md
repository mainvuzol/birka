# «Усе на бірці», audit 2026-11-22, batch 1: an order's day said by what it means; «Схожі» saying where what was typed says otherwise; «Нова модель»'s name fork, as the rename's; the till's sums of what is sold — 2026-11-22

Baseline: `c11afb08` (main after #240).

Points: orders-cash P1-1, goods P1-1, goods P1-2, sale P2-1 (financial
integrity), with a money review and a catalogue-rules review.

Chosen by the user from the audit's suggested first batch, «P1s and money
first». Not in it: the goods pass's XS points (P2-1, P2-3 (а), P2-4, P2-5)
and the other P2s.

No right, check, journal or step changes; nothing recorded changes; no
backend change. What is sent changes only where the person now chooses it
in «Нова модель»'s fork: the same requests the form's own ways sent.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1245 (seven new, one replaced, one extended).
- Branch: `feat/audit-1122-p1-money`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-22 (audit
  2026-11-22, batch 1: …)".

## What exists now

- **An order's day on its row** (orders-cash P1-1):
  - Before: «з 13.10» on every order's tag, read under «Прибув на пошту» as
    «at the post office since».
  - Now: «з 21.10» while it waits to be sent; «замовлено 13.10» in every
    other status, the card's word — by the order's status, so a search and
    the card's «Замовлення з цією ТТН» say it too. The word and its day
    never break apart.
- **«Схожі» says where what was typed says otherwise** (goods P1-1):
  «Не збігається: колір» under a candidate's name and «Відмінність
  моделі: …», the proposal's rows' words from one helper. A grey line: it
  tells, it does not refuse.
- **«Нова модель» asks a name some models have as the rename does** (goods
  P1-2):
  - Before: `CATALOG_AMBIGUOUS` drew a refusal's plate and opened «Ще
    ознаки» on «Окрема модель зі схожою назвою» — one way of two, and for a
    new colour of a model the catalogue has, the way to a double.
  - Now: the question «З такою назвою вже є модель. Це вона — чи окрема
    модель зі схожою назвою?», the cursor on it; the models the refusal
    names as rows with «Це вона»; «Окрема модель…» under them; nothing
    chosen beforehand, «Додати модель» held until one is. One component
    with the rename (`NameFork`).
  - «Це вона»: «Інший колір нашої моделі» with that model; the colour, the
    other words and the sizes stay; sent as `product_family_id`.
  - «Окрема модель…»: the form's own box ticked, «Ще ознаки» open, the
    cursor in «Чим відрізняється модель».
  - While the models are read: up to three grey rows where they will stand,
    «Завантажуємо моделі…» said to a reader alone; on the rename too.
  - The name, its source or its garment type changed: the fork goes, and
    what was chosen in it.
  - A kept operation's refusal, a refusal naming no models, and a read that
    finds none of them: the plate, as before.
- **The till's sums are of what is sold** (sale P2-1):
  - Before: after «на місці лише N» or «на полиці немає жодної — продати
    решту», the tray's «Разом», «Зараз · винен» and the sheet's «Лишиться
    винен» still counted the whole basket, while the sale sent and checked
    the terms on what it sells.
  - Now: one count in kopecks (`soldKopecks`) for the screen and the send.
  - One answer of the shelf to a line: a new one replaces that line's
    other, as the server refuses them together.
  - The terms' own check says the till server's words: «… Зніміть «Оплата
    частинами» або змініть суму.», on «Клієнт забрав» too.

## How it was built and proven

Sources:
- `frontend/src/orders/Orders.tsx`: `since(order)` and `orderedDay(status,
  iso)`; `Order.tsx`'s same-waybill rows use `orderedDay`.
- `frontend/src/catalog/types.ts`: `conflictsText`; `Catalog.tsx` and
  `NewModel.tsx`'s «Схожі» use it.
- `frontend/src/catalog/NameFork.tsx` (new): `forkedFamilies`,
  `useForkedFamilies`, `NameFork`. `Models.tsx`'s rename sheet uses them in
  place of its own; `NewModel.tsx` draws the fork, holds «Додати модель»,
  forgets the fork on a word changed, keeps the plate where none is named
  or found.
- `frontend/src/sales/Sale.tsx`: `soldKopecks`, `besides`; the total, the
  send and the shelf's answers. `frontend/src/credits/Terms.tsx`: the
  check's words.

Decided here: see the business rules' entry — the fork's place, focus and
the rows' places; what a changed word forgets; the plate kept for a kept
operation, for none named and for none found; the grey «Не збігається»;
one answer of the shelf to a line; «Кошик · N» kept.

Journeys:
- New:
  - `catalog`: «Схожі» says where what was typed says otherwise, as the
    proposal's rows do (both themes at 360; a candidate that agrees has no
    line);
  - `catalog`: «Це вона» in the fork — a model of its own made first, then
    another colour of it created in it, nothing of a new model sent, the
    server's answer a variant of that model;
  - `catalog`: a word changed forgets the fork and what was chosen in it —
    the other way and what was written; «Це вона»'s model;
  - `catalog`: the fork's models read slowly — up to three grey rows in
    sight, «Завантажуємо моделі…» to a reader alone and outside the fork,
    no «Це вона» yet, held; come, the rows where the grey stood;
  - `catalog`: a read that finds none of the models named — the plate,
    «Ще ознаки» open, no fork;
  - `till-shortage`: «На полиці немає жодної — продати решту» in parts — two
    models, the tray's «винен» before and after, the basket sheet's lines,
    the second send's terms;
  - `till-shortage`: an answer the terms held back is never sent beside the
    next one for that line.
- Replaced: `catalog`'s «ambiguous named model retains explicit form» by
  «Нова модель»'s fork — the question focused and in sight at 360 × 640 in
  both themes, no alert, «Ще ознаки» folded, the rows, nothing pressed,
  held; «Це вона» then «Нова модель» leaves nothing pressed; «Окрема
  модель…» ticks the box, opens «Ще ознаки», the cursor in what tells it
  apart; the separate model's request.
- Extended: `till-shortage`'s «an answer that leaves less to sell than is
  paid now» — the tray's and the sheet's sums before and after, the terms'
  words, what is sent.
- Changed: `orders-list` (the closed and cancelled rows' «замовлено»,
  «з» where they wait) and `order-shipping` (the same-waybill row).

Runs on a fresh seed:
- The 16 specs the batch touches or reads (`design-system` first,
  `orders-list`, `orders-card`, `order-shipping`, `credits`, `catalog`,
  `models`, `receive`, `goods-places`, `till-shortage`, `till-tray`,
  `till-basket`, `till-money-words`, `till-taps`, `shelf`, `sale`):
  322/324. Both failures were the new journeys' own: a filter scoped
  through the sheet, and a second tap within the shortage sheet's 0.7 s.
- After the reviews' fixes, `catalog`, `models`, `till-shortage`,
  `till-basket`, `shelf`, `sale`: 109/111. The rename's journey met two
  statuses in the fork while its models were read — the read's status now
  stands beside the fork; a new journey tapped the basket sheet's «Готово»
  within its 0.7 s.
- After those, with the two new fork journeys, `catalog`, `models`,
  `till-shortage`: 89/89.
- CI runs all 1245.

Mutants (mutate84, 27, each against its journey): 27/27 caught.
- The day: «з» always, «замовлено» always, «з» on the closed and
  cancelled, the card's rows as waiting.
- «Не збігається»: gone from «Схожі», gone from the proposal.
- The fork: never asked; «Додати модель» not held; the plate beside it;
  «Ще ознаки» opened by it; «Це вона» pressed under «Нова модель»; «Окрема
  модель…» not opening «Ще ознаки», not taking the cursor; the cursor not
  on the question; a fork though none found; no grey rows; the read unsaid;
  «Це вона» keeping «Нова модель»; a changed word forgetting nothing, not
  the other way, not the model; the rename's «Це вона» never pressed.
- The till: the total or the send of the whole basket; a line's earlier
  answer sent beside the next; «продати решту» counted whole; the terms'
  old words.

## The reviews

Two independent reviews read the diff against the audit's points, ADR-0002
and the decisions' draft.

Money (sale P2-1): no High or Medium.
- **Low, fixed:** a line's earlier answer stayed beside a new one — the
  count and the send took both; now one answer a line (`besides`).
- **Low, covered:** «продати решту» (a zero) in parts had no journey; one
  now.
- **Nit, fixed:** the journey checked the sums but not the request; it
  checks the lines, the credit, missing and found.
- **Nit, known:** the shared words of the server's `PAID_IN_FULL` outside
  the till lack «або змініть суму» — to the owner pack's № 13.
- **Nit, kept:** «Кошик · N» counts the basket, not what is sold.

Catalogue rules (goods P1-1, P1-2): no High.
- **Medium, fixed:** while the models were read, «Окрема модель…» stood
  alone in sight — the rows' places now.
- **Fixed:** a read that finds none of the models named left a fork with
  one way; the plate is said.
- **Fixed:** the cursor was lost with «Додати модель» held; it goes to the
  question.
- **Fixed:** journeys scoped through the sheet; «Це вона» on the shared
  «Лоран» — a model of its own now.
- **Kept:** a kept operation's refusal keeps the plate (decided); the fork
  is forgotten only while it is shown.

## Left

- goods P2-1, P2-3 (а), P2-4, P2-5 and the other P2s of audit 2026-11-22.
- The fork's read is the name's first fifty; a model past them is not paged
  to.
- goods P2-5 (2026-11-20) waits for В20-Т1 (the owner pack); «Зніміть» on
  № 13.
- Money P2-5 (а), an API field, needs the user's consent.
- Dependabot pull request #223 is closed only on the user's word.
