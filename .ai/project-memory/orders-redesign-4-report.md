# «Замовлення»: «Нове замовлення» as a sale — 2026-10-24

Baseline: `2501ee1` (#129, «Клієнт забрав» by its ways, on main), and
«Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`5039e90`, and thirty-three of thirty-three ways of breaking it caught.
The screen waits for the owner's approval; not yet tried on a real phone.
Branch: `feat/orders-new`. Task: P0-5.
Owner: business-rules.md, "after #129 was merged" (2026-10-24).

## Why this was next

The owner approved «Клієнт забрав» as built and chose «Нове замовлення».
It was two native lists — «Склад», then «Товар і розмір» by a hundred rows
with «Попередні товари / Наступні товари» — the price typed every time
though the store's price came in the same row, «Кількість» typed, «Додати
товар» a tap of its own, «Куди» and «Перевізник» two more lists, three
explanations, and «Замовити та зарезервувати» at the end of the form; a
coat took 11 taps and a price typed, and the card after it said nothing.

## What exists now

- **The till's search:** «Знайти модель», the cursor in it; every
  warehouse the store sells from at once, a chip per size and warehouse;
  one warehouse named, never chosen.
- **A tap on a size is a line** from that chip's warehouse, at the store's
  price, editable, with the till's words under it; «−»/«+» to what is
  free; «Прибрати … · M».
- **Where it goes:** «По Україні / За кордон» a switch, the carrier a chip,
  none chosen; one line, «ТТН впишете, коли відправите.».
- **Under the thumb:** what is ordered, «Разом» large, and «Замовити та
  зарезервувати» — «Оберіть перевізника» while none is chosen.
- **Short of stock:** the line named marked «Доступно лише 1 шт. — решта в
  резерві інших замовлень.», focused, the rest as typed.
- **Reserved:** a buzz, and the card, from its top, says «Зарезервовано: 1
  шт. Чекає відправлення.».
- **Five taps from «Ще»** with the search typed: «Ще», «+ Нове замовлення»,
  the size, the carrier, the press — eleven and a price before.

What is sent is unchanged, `POST /orders` with the same keys; no backend
change.

## Decided here, not by the owner

- **The screen,** not drawn in the design: to be approved from the
  [screenshots](../../output/verification/2026-10-24-orders-new/screens/).
- **The panel shows once a line is in the order,** as the till's
  (direction §5); before it, the search alone.
- **One line of more than one unit says «… × 2»** in the panel, as the
  till's; the task list wrote only «Лоран шоколад · M» or «У замовленні: N
  шт.».
- **None free:** «Доступних уже немає — усі в резерві інших замовлень.
  Приберіть рядок.» or «Доступних уже немає. Приберіть рядок.» — the task
  list wrote only «Доступно лише N шт.».
- **A shortfall is said on its line alone,** the page's own words not over
  it, and forgotten with the screen.
- **«Прибрати» names the size too,** so two sizes of one model are told
  apart by whoever listens.
- **«Зарезервовано…» only while the order waits to be sent:** confirmed
  late after a colleague sent or cancelled it, nothing is said of it.
- **The carriers in one row at 360 px,** each its word on one line.
- **The till's price words moved to one place** (`sales/PriceHint.tsx`),
  the till's unchanged; the suppliers' screens now refresh the till's stock
  where they refreshed the old form's.

## How it was built and proven

- **`orders-new.spec.ts`, 15 journeys (stubbed):**
  - at 360×640: «← До замовлень», «Склад: Свій», no list, the cursor in
    «Знайти модель», nothing of the old form; two letters ask the server
    and show «Лоран шоколад» alone at 1 850,00 грн, its L all held
    disabled with «Ще 2 шт. у резерві замовлення»; M a line at «1850,00»
    with «Ціна продажу 1 850,00 грн. …»; the panel «Лоран шоколад · M»,
    «Разом 1 850,00 грн», «Оберіть перевізника» held; «+» to three — its
    chip then disabled — «× 2», «Разом 5 550,00 грн»; «Нова пошта»
    pressed, the three carriers one row; the press 54 px on the screen, the
    page's room for the panel its height, the carriers over it; the body
    exactly as before; «Зарезервовано: 1 шт. Чекає відправлення.», the
    card, one buzz;
  - two warehouses: «M · Свій 3», «M · Спільний 2», the list not narrowed,
    the line «· Спільний» and sent from it;
  - no price: the field empty and focused, «Ціни продажу ще немає …»,
    «Разом —» and the press held; «15,5,5» said no price; 0,00 asked
    about; «Прибрати Мілан графіт · S»; nothing sent;
  - abroad: within Ukraine first; no carriers, its own line, the press at
    once; a carrier chosen before forgotten back within Ukraine; no
    carrier sent;
  - short of stock: the named line marked and «Доступно лише 1 шт. — решта
    в резерві інших замовлень.» focused, no words over the page, both lines
    as typed, its «+» held, the goods read again, an error buzz; another
    line's price changed keeps the mark; one fewer clears it, and it is
    reserved, 2 шт.; none free said so;
  - the shortfall's screen left: nothing over the list, nor on the next new
    order;
  - another refusal: over the page, focused, a buzz, the lines and the
    carrier kept;
  - an answer never come: «Повторити ту саму команду» resends the same
    command and says «Зарезервовано…» with a buzz; answered but its reading
    failed: «Оновити результат» says it;
  - five taps from «Ще»; a double tap's second half on the card's
    «Відправлено» sends nothing, a moment later it does; «← До замовлень»;
  - both themes at 4.5:1 — the heading, the tag, the chip, «У замовленні»,
    the line and its words, the switch, the carriers, the panel — nothing
    wider than the phone, with screenshots.
- **The real API:** `orders.spec.ts` and `order-shipping.spec.ts` make
  every order on the new screen — the model found by name, the fixture's
  warehouse's chip, the price typed, the carrier a chip; «Оберіть
  перевізника» sends nothing; abroad by the switch; each step after the
  answer read.
- **Related journeys:** 370 — orders, their list, card and shipping, the
  till, its search, places, sections and receipt, prices and sizes, debts,
  returns' sale screen, the outage and its paper, failures, sessions and
  the first sign-in — passed with it; after the review's fixes 115 —
  orders, suppliers, borrowed goods and invoices, debts, the till and its
  prices — on a fresh seed.
- **Mutation:** 33 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 33 caught — 32 at first,
  and one more after the screenshots
  ([`mutants.txt`](../../output/verification/2026-10-24-orders-new/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed the body as before, the line's warehouse its chip's and never
merged with another's, the quantity to what is free, the till's price
parsing and words unchanged, the shortfall parsed and clamped, a kept new
order holding the screen, the double tap let go, and the old form's code
gone with nothing else using it. It found, all addressed before the first
commit:
- **A shortfall outlived its screen:** said over the list, and again on the
  next new order with no line. Now it belongs to its screen, forgotten when
  it is left.
- **A new order answered but read late said nothing:** kept with its
  order's id, it was taken for a step. Now by its path first; and
  «Зарезервовано…» only while it waits to be sent.
- **The journey read the body before the request was sure to be made.**
  Now after the answer.
- **The mark went with any change.** Now with that line's count, or the
  line.
- **«Прибрати» named two sizes alike, the search lost the cursor after a
  retried read, a chip of no warehouse did nothing, and the suppliers'
  screens refreshed the old form's stock.** All mended.

After the review, the screenshots showed the new order's card from where
the form's foot had left the page: «Відправлено», not its title nor
«Зарезервовано…». Now a card that says what a step did brings its title
into view.

Not changed: a line's free count is its chip's at the tap and the server's
at a refusal, not the list read again — it errs to reserving less; the
panel with the phone's keyboard is for the phone (Not covered).

## Evidence

- [`output/verification/2026-10-24-orders-new/`](../../output/verification/2026-10-24-orders-new/):
  `mutants.py`, `mutants.txt`, and `screens/` — the search, a line in the
  light and dark themes, the shortfall, and the card reserved.
- **CI, run locally at `5039e90`**
  ([summary](../../output/verification/2026-10-24-orders-new-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 464 on PostgreSQL 17;
  - e2e: 591 journeys;
  - hot path: worst p95 93.2 ms (the search by six sellers) and 72.5 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the keyboard over the search and the price with the
  panel (С5); a real Telegram's buzz; the search on 100+ models in
  Telegram's web view (С3).
- **Left:** «Замовлення»'s P1-1…P1-3 (the conflict's words with P1-2),
  P2-1…P2-5.
