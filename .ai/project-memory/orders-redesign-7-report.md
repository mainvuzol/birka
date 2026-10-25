# «Замовлення»: where an order goes, its own step — 2026-10-25

Baseline: `9de402f` (#136, on main), and «Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`6a4ecd2`, and twenty-eight of twenty-eight ways of breaking it caught. The screens and words wait for the owner's
approval; not yet tried on a real phone.
Branch: `feat/orders-shipping-step`. Task: P1-3.
Owner: business-rules.md, "after #136 was merged" (2026-10-25).

## Why this was next

The owner chose P1-3 after #136, with two of P1-1's phrasings changed. Where
an order goes was a form in the card's flow — two native lists «Куди» and
«Перевізник», «Номер накладної», «Зберегти доставку» and «Скасувати» among
the rest — so a waybill that came after the parcel went took six taps and the
typing; its history was a line of five parts, «22.10.26, 14:05 · Вказано при
створенні · Нова пошта · ТТН ще немає · Оля»; and the same waybill named the
other order by eight characters of its id, «Ця накладна є також у замовленні
№ 3f2a9c1b. …», which opened nothing.

## What exists now

- **Its own step, «Доставка»,** with «← Замовлення»: «По Україні» or «За
  кордон» by a switch, the carrier by a chip (the new order's), «Номер ТТН»
  or «Куди і як відправили: місто, країна, спосіб» with «Без імен і
  телефонів покупців.», and «Зберегти доставку» under the thumb — «Оберіть
  перевізника» while within Ukraine none is chosen. What is sent is
  unchanged. Saved: back on the card, «Доставку збережено», with a buzz.
- **A waybill written later:** a parcel sent within Ukraine with no waybill
  says «ТТН ще немає — вписати ›», and «Доставка» opens with the cursor in
  «Номер ТТН» — five taps from «Ще» with the typing.
- **Its history a row a version:** «Вказано при створенні», «Вписано при
  відправленні» or «Змінено», «22.10, 14:05 · Оля» under it, how it went on
  the right.
- **The same waybill:** «Ця ТТН є також у замовленні — перевірте, чи це
  один пакунок.», and the other order's row — its goods as its card's
  title, since when, its pill and «›» — a tap opening it at its top. The
  server names it by its first line and how many lines, read only.
- **The owner's two phrasings,** in the order's banner: «Операція
  «Відправлено» — сервер не відповів.» for a step kept before what it is
  about was kept beside it, and «Двічі цю операцію не запишуть.».

No migration. The server's answer gains five fields on `same_waybill[]`, all
optional, so an answer kept from before is replayed as it was.

## Decided here, not by the owner

- **«ТТН ще немає — вписати» once it is sent.** Before, the waybill goes in
  the field over «Відправлено», and the row says «Змінити доставку»; abroad,
  and an order made before orders said where they go, «Змінити доставку».
- **Several other orders: «Ця ТТН є також у замовленнях — …».**
- **The other order named as its card's title,** «Лоран шоколад · M × 2 + ще
  2», with «з 22.10» under it; the server gives the first line's quantity and
  how many lines besides what the task list named. An answer kept from
  before names it «Замовлення».
- **An order its reader could not open is named nowhere,** as the store's
  list leaves it out: a line from a warehouse the store no longer reaches,
  or, to whoever holds the right network-wide only, from the store's private
  one. Before, it was named by its number.
- **Saved as it was:** «Доставку збережено» too, no version added.
- **The card under «Доставка»,** with what was typed there, and «← До
  замовлень» the card's own; back, the row that opened it in focus.
- **A card read again and failed** keeps what was last read, and the screen
  over it what was typed, with why and «Спробувати ще раз» over them.
- **Taps carried from a press are let go:** after every step that came back,
  the card mounted afresh, a save that changed nothing too; «Зберегти
  доставку» right after «Доставка» opened; «← До замовлень» right after «←
  Замовлення».
- **The history's how-it-went at most 45 % of a row,** wrapping on the
  right; at 360 px what it was may take two lines.
- **«Каса»'s banners keep «Двічі вона не запишеться.»:** the owner was asked
  of the order's. To be asked.

## How it was built and proven

- **Server (`test_order_shipping.py`):** each of two orders with one waybill
  names the other by its first line, how many lines and since when; an
  order of two lines of unlike quantities named by the one its card lists
  first; one with a line from a warehouse the store no longer reaches named
  to nobody, and one from a private warehouse not to whoever holds the right
  network-wide only; an answer kept from before replayed with its other
  order as it was.
- **`order-shipping.spec.ts`, against the real API:** corrected as its own
  step — the switch, «За кордон» and back, no carrier asked for, the body's
  keys as before, its history in rows, closed with no row to change it; a
  waybill written after the parcel went, the cursor in its field, back
  without saving sending nothing and the row in focus; saved as it was, back
  on the card, a tap carried onto the step under the thumb let go; the same
  waybill's other order its row, opened by a tap and naming this one; a
  correction whose answer is lost named and resent unchanged.
- **`orders-card.spec.ts`, stubbed:** the history's rows by the phone's
  clock; several other orders, a kept one's «Замовлення», opened at the top
  from a cached card; five taps from «Ще»; a save refused for its waybill
  keeps the screen and the typing while the card's read again fails; carried
  taps let go; the card's own typing kept across «Доставка»; both themes at
  4.5:1 and 360 px, for the screen, the rows and the other order.
- **Related journeys:** 289 — orders, their list, card, shipping and new
  order, the outage and its marks, debts, «Каса»'s kept commands, returns,
  sessions and failures — passed with it before the review; after its fixes,
  the shipping, card and new-order specs, 56; 625 in the whole run.
- **Mutation:** 28 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 28 caught, the review's fixes
  and the private warehouse among them
  ([`mutants.txt`](../../output/verification/2026-10-25-orders-shipping-step/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
found nothing of high severity: the server's change sound — the list's rule
moved whole, the other order's read one bounded query, a private warehouse
never reached by a network-wide right, an answer kept from before still
replayed — and the screen as the task list asks. It found, all addressed
before the first commit:
- **A card read again and failed** — the phone back from the carrier's app
  — took the screen and what was typed for an error. Now the card stays,
  why over it.
- **What was typed on the card** was lost after «Доставка». Now the card is
  kept under it.
- **A double tap** could carry from «← Замовлення» onto «← До замовлень», or
  from the row onto «Зберегти доставку». Now let go.
- **The field was focused before the panel's room was kept.** Now the room
  first.
- **Tests:** a refused save keeping the screen, the five taps, the private
  warehouse, and the other order opened at its top were unproven or proven
  by chance. Now each has its journey or test.

Not changed: an order opened from the other order's row leaves a refusal
said over the first, as an order opened from the list does; a replayed
answer names the other order as it was named then, as it names its own
goods; what the review recorded as decisions is listed above for the owner.

## Evidence

- [`output/verification/2026-10-25-orders-shipping-step/`](../../output/verification/2026-10-25-orders-shipping-step/):
  `mutants.py`, `mutants.txt`, `screens/` (the card with its history and the
  other order, and «Доставка», in both themes).
- **CI, run locally at `6a4ecd2`**
  ([summary](../../output/verification/2026-10-25-orders-shipping-step-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 468 on PostgreSQL 17;
  - e2e: 625 journeys;
  - hot path: worst p95 115.8 ms (the search by six sellers) and 136.0 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the cursor put in «Номер ТТН» by the screen, not the
  tap — whether Telegram on iOS opens the keyboard; a waybill pasted from a
  carrier's app.
- **Long names at 360 px:** the journeys' names are short.
- **Left:** «Замовлення»'s P2-1…P2-5.
