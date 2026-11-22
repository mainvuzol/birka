# «Усе на бірці», audit 2026-11-22, batch 2: the small points — «Оформити повернення» heard with its question; one way back from the other stores; the merge's unknown size as «?»; a model's tag naming what tells it apart; the purchase price's line read with its field; the opening line's sizes felt as they change; Telegram asking before closing over a typed cash sum and a part paid; «Оберіть день.» a hint — 2026-11-22

Baseline: `7a642a32` (main after #241).

Points: sale P2-2, P2-3; goods P2-1, P2-3 (а), P2-4, P2-5; orders-cash
P2-1, Д1, Д2.

Taken as the next after «merged go next»: the audit's small points that
wait for no owner's answer and need no backend change. Not in it: goods
P2-3 (б) (waits for В22-Т1 or a count, Н2, and a server field),
orders-cash P2-2 (waits for a screenshot), the money and frame P2s.

No right, check, journal or step changes; nothing recorded or sent
changes; no backend change.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1250 (five new, five extended).
- Branch: `feat/audit-1122-small`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-22 (audit
  2026-11-22, batch 2: …)".

## What exists now

- **«Оформити повернення» heard with its question** (sale P2-2): on the
  till's receipt and on «Клієнт забрав»'s card, «Помилилися з товаром чи
  ціною?» is the link's description. What is seen: as before.
- **«← У цьому магазині»** (sale P2-3): «Повернути»'s way back from the
  other stores says it as «Внесок» and «Покупці» do. The audit's «the
  header in one line» held for neither word: under 480 px every toolbar
  stands its way under its title. The way back is narrower now; the
  header's look otherwise as before.
- **The merge's unknown size** (goods P2-1): in «Об’єднати моделі»'s stock
  cells, a size with no label or the code «UNKNOWN» is «?», heard «розмір
  невідомий — 3 шт.», with «? — розмір невідомий» under the cells, as
  «Залишки» say it. It was «UNKNOWN 3».
- **A model's tag names what tells it apart** (goods P2-3 (а)): in
  «Моделі», «Відмінність моделі: довге» in grey under «Джерело: …» when
  the model has it.
- **The purchase price's line read with its field** (goods P2-4): in «Як
  надійшов», the field said wrong (`aria-invalid`) is read with «Закупівельну
  ціну вкажіть у гривнях…» while the line stands; cleared, with nothing.
- **An opening line's sizes felt as they change** (goods P2-5): a size
  cell, «?» among them, buzzes when the size changes or when the tap
  confirms the dashed size the line read; tapped again, nothing.
- **Telegram asks before closing** (orders-cash P2-1):
  - «Видати з каси» / «Внести в касу»: while a sum is typed; wiped, closed
    or recorded, no longer.
  - «Клієнт забрав»: while «Оплата частинами» is on and «Сплачує зараз»
    typed; a name or a phone alone asks nothing; off, closed or collected,
    no longer.
- **«Оберіть день.» a hint** (orders-cash Д1): 14/500 in pencil, as every
  hint under a field of «Каса».
- **Two comments mended** (orders-cash Д2): the order lists are newest
  first; the server records the other places' days but does not send them
  yet.

## How it was built and proven

Sources:
- `frontend/src/sales/Sale.tsx` (Receipt), `frontend/src/orders/Collected.tsx`
  (SaleLinks): the question a `<span id>`, the link `aria-describedby` it.
- `frontend/src/returns/Returns.tsx`: «У цьому магазині».
- `frontend/src/catalog/Models.tsx`: `unknownSize(line)`; the stock cells'
  «?», their heard size and the note; the tag's «Відмінність моделі».
- `frontend/src/inventory/Receive.tsx`: the purchase price's line has its
  id, the field described by it while it stands.
- `frontend/src/openings/Line.tsx`: `buzz("selection")` only on a change
  or a dashed size confirmed.
- `frontend/src/cash/Move.tsx`, `frontend/src/orders/Collect.tsx`:
  `useAskBeforeClosing`.
- `frontend/src/cash/Cash.tsx`: «Оберіть день.» `hint`.
- `frontend/src/orders/Orders.tsx`, `frontend/src/orders/Knots.tsx`:
  comments.

Decided here: see the business rules' entry — «цьому», not «своєму»; the
dashed cell's tap felt though the size stays.

The audit's Д4 checks:
- No organisation size is named «UNKNOWN»: the catalogue refuses that
  spelling of a typed size (`catalog/service.py`), so «?» means one thing,
  as four other screens already read it.
- «Клієнт забрав» leaves no moment unasked between a step on its way and
  its answer lost: the sheet stays, held, with the sum typed; a step kept
  on the phone asks by the app's own rule.

Journeys:
- New:
  - `models`: a size nobody knows in the merge's preview — «?» heard
    «розмір невідомий — 3 шт.», the note, no «UNKNOWN», both themes at 360;
  - `models`: a model's tag says what tells it from another of its name —
    two models of one name, the line under one only;
  - `openings`: inside Telegram a line's size is felt only as it changes —
    the dashed «M» confirmed felt, again nothing; «Розмір невідомий» once,
    again nothing; «M» once;
  - `cash-move-fix`: inside Telegram «Видати з каси» and «Внести в касу»
    ask while a sum is typed — typed, wiped, closed, recorded;
  - `orders-card`: inside Telegram «Клієнт забрав» in parts asks — a name
    and a phone alone, the part paid, «Оплата частинами» off, closed,
    collected with «Готівка».
- Extended:
  - `till-receipt` and `orders-card`: «Оформити повернення»'s description;
  - `returns-list`: the way back at 360 × 640 no wider than «У своєму
    магазині» would be, and no page scroll;
  - `receive`: the field said wrong, read with its line; cleared, with
    nothing;
  - `cash-correct`: «Оберіть день.» 14px / 500 / pencil.

Runs on a fresh seed:
- The 15 specs the batch touches or reads (`design-system` first,
  `till-receipt`, `returns-sale-screen`, `returns-list`, `orders-card`,
  `orders`, `credits`, `models`, `receive`, `openings`, `openings-file`,
  `cash-move-fix`, `cash-correct`, `cash-close`, `cash-kept`): 360/362.
  Both failures were the new journeys' own: the way back's «one line»
  (the toolbar wraps under 480 px, on main too — the check is now the
  width and the page's scroll), and «Клієнт забрав» reopened within the
  0.7 s a MainButton press is let go.
- After the review's fixes, `returns-list`, `orders-card`, `openings`,
  `models`: 145/145.
- CI runs all 1250.

Mutants (mutate85, 17, each against its journey): 17/17 caught.
- The question unsaid on the receipt and on the card.
- «У своєму магазині» back.
- The merge: «UNKNOWN» not read as unknown; no note; the size heard as
  «розмір».
- The tag without what tells the model apart.
- The price's line never read with its field; read with it always.
- The sizes: felt on every tap; the dashed size's confirm not felt; «?»
  felt on every tap.
- Telegram: «Каса»'s sum never asks; «Клієнт забрав» never asks, asks over
  a name, asks with «Оплата частинами» off.
- «Оберіть день.» in the page's ink.

## The review

An independent review read the diff against the audit's points and the
decisions' draft: no High or Medium.
- **Fixed:** the way back's check at the phone's 360 rather than the
  profile's width; null-guarded positions in the new `models` journeys.
- **Fixed:** the opening line's journey ends with no list waiting
  (`noListWaits`).
- **Fixed:** `Collect.tsx`'s comment says why a lost answer leaves nothing
  unasked (Д4).
- **Known, kept:** the merge's journey stubs the preview's answer with the
  unknown size rather than seeding unknown stock of two models — the seed
  has none, and the cells read the answer alone.
- **Known, kept:** `unknownSize` is the fifth copy of that check; folding
  them into one helper touches four other screens, past this batch.

## Left

- goods P2-3 (б), the search's rows and the merge's tags, waits for
  В22-Т1 or a count (Н2), and a server field.
- orders-cash P2-2 waits for a screenshot.
- Next candidates: the money pass's «Звідки, що й коли» (P2-1, P2-3, P2-4)
  and the frame's P2-1, P2-2.
- goods P2-5 (2026-11-20) waits for В20-Т1 (the owner pack).
- Money P2-5 (а), an API field, needs the user's consent.
- Dependabot pull request #223 is closed only on the user's word.
