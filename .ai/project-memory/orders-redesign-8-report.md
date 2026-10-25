# «Замовлення»: the goods come back, their own step — 2026-10-25

Baseline: `bd8b9b0` (#137, on main), and «Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`d0c23be`, and twenty of twenty ways of breaking it caught. The screen and its words wait for the owner's
approval; not yet tried on a real phone.
Branch: `feat/orders-return-step`. Task: P2-4.
Owner: business-rules.md, "after #137 was merged" (2026-10-25).

## Why this was next

The owner chose P2-4 after #137, and «Каса»'s banners in the order banner's
words. A parcel not collected came back by a toggle among the card's rare
rows, which opened «Фізичне повернення всього замовлення» in the card's flow
— «Товар повернеться на ті склади, звідки його відправили.», a field, a tick
and «Прийняти повернення» among the rest; taken, the card showed only its
pill «Повернено на склад», no warehouse named.

## What exists now

- **Its own step:** «Товар повернувся на склад ›» opens a screen of that
  name with «← Замовлення»: «Повернеться на склад «Свій»: Лоран шоколад · M
  × 2», a line a warehouse, as the server puts each coat back where it left
  from; under «Фізичне повернення всього замовлення», the reason with «Без
  імен і телефонів покупців.» and the tick, as they were; «Прийняти
  повернення» under the thumb, held until both. What is sent is unchanged.
- **Taken:** back on the card, «Повернено на склад «Свій»: 2 шт. Повернено
  на склад «Сусідній»: 1 шт.», with a buzz.
- **Seven taps from «Ще» with the typing.**
- **«Каса»'s banners:** «Видача 1 150,00 грн · Витрати — сервер не
  відповів. Двічі цю операцію не запишуть.», as the order's.

No backend change: the warehouses' names come from `GET /stock-locations`,
which whoever takes returns can read.

## Decided here, not by the owner

- **A line a warehouse,** its goods after it; taken, a sentence a
  warehouse.
- **Named only where the server takes them back:** a warehouse not read —
  whoever may not see the store's warehouses, or a read refused since — or
  paused, or not receiving, and the screen says the old sentence, the result
  «Повернено на склад відправлення: N шт.» («… склади …» for several).
- **The heading in focus, not the reason:** what comes back where is read
  before the keyboard opens.
- **The tick only meant:** a tap within 0.7 s of the screen opening, carried
  from the row, is let go.
- **A kept return confirmed later** says «Операцію «Прийняти повернення»
  записано один раз», never which warehouse: the phone may not have read
  them.
- **«Каса»'s refusals** keep «… двічі вона не запишеться.»: the owner was
  asked of its banners. To be asked.

## How it was built and proven

- **`orders.spec.ts`, against the real API:** a sent order comes back as its
  own step — its heading in focus, the card's step gone, its warehouse
  named, the press held without a reason and without the tick, the body as
  before, the card naming the warehouse after, no row to take it back again.
- **`orders-card.spec.ts`, stubbed:** two warehouses named, a line each, the
  result a sentence each with a buzz, seven taps from «Ще»; to whoever may
  not see the warehouses, the old sentence and the result unnamed, back with
  the row in focus, neither the reason alone nor the tick alone; a
  warehouse unknown, paused or not receiving, unnamed; the right gone while
  the screen is open, unnamed after a read again; a refusal keeping the
  screen, the reason and the tick; taken back meanwhile by another phone,
  the card as it is now; a lost answer named in the banner and recorded once;
  a carried tap on the tick let go; both themes at 4.5:1 and 360 px.
- **`cash-kept.spec.ts`, `cash-move-fix.spec.ts`, `outage.spec.ts`:**
  «Каса»'s banners in the new words.
- **Related journeys:** 255 — orders, their list, card, shipping and new
  order, the outage, «Каса»'s close, kept commands, moves and polish —
  passed with it before the review; after its fixes, the return's own, the
  real one and 11 stubbed; 636 in the whole run.
- **Mutation:** 20 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 20 caught, the review's fixes
  and «Каса»'s banner among them
  ([`mutants.txt`](../../output/verification/2026-10-25-orders-return-step/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
found nothing serious: the server puts every line back on the warehouse it
left from, so a name shown is always the right one; the body is unchanged;
a refusal keeps the screen; the texts sound. It found, all addressed before
the first commit:
- **A warehouse paused, or not receiving, was named** though the server
  refuses the return there. Now unnamed.
- **Names stayed after a read refused** — the right to see the warehouses
  gone. Now only from a read that stands.
- **The tick could take a tap carried from the row.** Now let go.
- **The legend «Фізичне повернення всього замовлення» was dropped,** and
  with it, unnamed, that the whole order comes back. Now kept.
- **The places while read** were one row for several warehouses. Now as
  many.
- **Tests:** a refusal, an order taken back by another phone, a lost answer,
  a warehouse unknown or paused, the press as pressed in the themes. Now
  each has its journey.

Not changed: the till's, «Борги»'s and «Повернення»'s banners keep their
own words, outside the owner's answer.

## Evidence

- [`output/verification/2026-10-25-orders-return-step/`](../../output/verification/2026-10-25-orders-return-step/):
  `mutants.py`, `mutants.txt`, `screens/` (the screen in both themes).
- **CI, run locally at `d0c23be`**
  ([summary](../../output/verification/2026-10-25-orders-return-step-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 468 on PostgreSQL 17;
  - e2e: 636 journeys;
  - hot path: worst p95 90.5 ms (the search by six sellers) and 110.4 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** a parcel come back to a shop's warehouse, and a real
  Telegram's buzz.
- **Long warehouse names at 360 px:** the journeys' are short.
- **Left:** «Замовлення»'s P2-1, P2-2, P2-3, and P2-5 with the bottom menu.
