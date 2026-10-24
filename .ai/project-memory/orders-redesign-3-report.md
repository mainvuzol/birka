# «Замовлення»: «Клієнт забрав» by its ways — 2026-10-24

Baseline: `b1c79e7` (#128, the order's card, on main), and «Замовлення»'s
task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
nineteen of nineteen ways of breaking it caught. The result's screen waits
for the owner's approval; not yet tried on a real phone.
Branch: `feat/orders-collect`. Task: P0-3, and a discount for every unit.
Owner: business-rules.md, "after #128 was merged" (2026-10-24).

## Why this was next

The owner approved the card and chose «Клієнт забрав». It was five radio
buttons, nothing chosen, then «Клієнт забрав» in a row with «Товар
повернувся на склад»; its result a paragraph, «Продаж записано. Оплачено
готівкою.», in the middle of the card, a card's «Проведіть» never said, and
from a collected order neither «Змінити спосіб оплати» nor «Оформити
повернення», which the till's receipt has.

## What exists now

- **The five ways are the step,** under the thumb in two rows: «Зараз, у
  магазині» — «Готівка», «Картка», «Переказ»; «Наперед чи перевізнику» —
  «Переказ наперед», «Накладений платіж». «Разом» large, in parts «Зараз …
  · винен …». Four taps from «Ще».
- **Recorded:** «Продаж записано», the way with what to do, the server's
  sum large, what is owed in parts, a buzz; «До замовлень», «Змінити спосіб
  оплати» and «Оформити повернення». Later, a line.
- **A discount for every unit,** said so.

What is sent and the money are unchanged; no backend change.

## Decided here, not by the owner

- **The result's screen,** from the task list: to be approved from the
  [screenshots](../../output/verification/2026-10-24-orders-collect/screens/).
- **The ways named by their own word,** their groups by the rows' captions:
  the task list's «Клієнт забрав: готівкою — зараз, на касі» for whoever
  listens would not hold the word seen, «Готівка».
- **«Повернення» opens on the order's sale while it is among the store's
  newest sales,** as from the receipt; past them, its list.
- **«Разом» not over the result:** the sum taken stands alone — in parts,
  the part paid now.
- **A tap within 0.7 s of a step's answer, on the next step's buttons, is
  let go:** a double tap's second half.
- **«Змінити спосіб оплати» only for whoever is given the way.**

## How it was built and proven

- **`orders-card.spec.ts`, 8 more journeys (16):**
  - at 360×640, an arrived order: «Лоран шоколад · M · Нова пошта»,
    «Разом 1 200,15 грн», the ways in two rows under their captions, each
    at least 44 px and all on the screen; one line over them, never the
    drawer's words; nothing sent until a way; «Картка» sends `{command_id,
    payment_method: "CARD"}`; «Продаж записано» focused, «Картка ·
    Проведіть на терміналі», the server's «1 100,00 грн» — not the
    phone's — heard as «1 100,00 грн карткою.», one buzz, no panel;
    «До замовлень», and the order seen again: «Продаж записано · Картка»;
  - four taps from «Ще»: «Ще», «Замовлення», the order, «Готівка»;
  - both themes at 4.5:1 — what it is, «Разом», the captions, «Готівка»,
    «Накладений платіж» — nothing wider than the phone, with screenshots;
  - in parts: terms not taken said over the panel, focused, nothing sent;
    «Зараз 500,00 грн · винен 2 500,00 грн»; `credit` and `CASH` sent; the
    part paid large, no «Разом», «Покупець винен 2 500,00 грн. …», with a
    screenshot;
  - a card's «Клієнт забрав» whose answer never came: «Повторити ту саму
    команду» sends the same; «Продаж записано один раз», «Картка» alone,
    «Якщо картку ще не провели — …, — не проводьте вдруге.»;
  - a tap on the next step's button the moment it is drawn — «Прибув на
    пошту» after «Відправлено», «Накладений платіж» after «Прибув на пошту»
    — sends nothing; a moment later, as meant, it does;
  - a collected order whose way is not given: no «Змінити спосіб оплати».
  - arrived after «Прибув на пошту»: the ways' panel; a discount «за 1
    шт.».
- **`orders.spec.ts`** (the real API): the five ways under their
  captions; «Готівка» `CASH`, the result's pill and sum; «Оформити
  повернення» opens «Повернення» on that very sale — its id read back from
  the order and asked for by «Повернення»; «Накладений платіж»
  `CARRIER_COD`. The journeys that step an order read each answer before
  the next step, as a person does.
- **`credits.spec.ts`** (the real API): in parts, «Покупець сплачує все
  одразу …» before anything is sent; «Зараз 500,00 грн · винен 2 500,00
  грн» in the panel; `credit` and `CASH` sent; the part paid large, «Покупець
  винен 2 500,00 грн. Наступні внески — у «Боргах».»; five ways, none
  pressed, nothing sent until one is; refused and kept as before; without
  `sale:credit`, the ways and no «Оплата частинами».
- **`order-shipping.spec.ts`:** collected by «Накладений платіж».
- **Related journeys:** 322 — orders, their list, card and shipping, the
  till, its places, sections and receipt, debts and their list, returns and
  their sale's screen, «Каса» and its corrections, the outage and its
  paper, failures, outside text, sessions and the first sign-in — passed
  with it. One run before the review's fixes failed once under load in
  «Борги»' return of a sale paid in parts (its kept banner checked away
  before the journey read it), not on an order's way, and passed three of
  three alone.
- **Mutation:** 19 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 19 caught
  ([`mutants.txt`](../../output/verification/2026-10-24-orders-collect/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that no way can be sent twice and none is chosen first, that the
body is as before and the server takes each of the five ways — in parts
too — that the result's sum is always the server's, that «Каса»'s fix
takes an order's sale, and that the groups' names hold what is seen. It
found, all addressed before the first commit:
- **A card's «Клієнт забрав» kept and confirmed later said «Проведіть на
  терміналі»:** the card may have been charged meanwhile, by the paper's
  words — charged twice. Now «Продаж записано один раз», the way alone,
  and charge it only if nobody did, as the till and «Борги» say it.
- **A double tap on «Прибув на пошту» could record a sale:** the ways stand
  where it stood. Now a tap within 0.7 s of a step's answer is let go —
  «Відправлено» and «Прибув на пошту» too.
- **In parts, two large sums:** «Разом» over the part paid. Now the sum
  taken alone.
- **Terms not taken said under the panel.** Now focused, over it.
- **«Змінити спосіб оплати» for whoever is not given the way,** which
  «Каса» would then say. Now only with it.
- **The return's journey proved a sale of that sum opened, not that
  sale.** Now its id.

Not changed: «Сплачено зараз» read later says all paid so far; the
panel's height with the keyboard is for the phone (Not covered).

## Evidence

- [`output/verification/2026-10-24-orders-collect/`](../../output/verification/2026-10-24-orders-collect/):
  `mutants.py`, `mutants.txt`, and `screens/` — the ways, light and dark,
  the result by card, and the result in parts.
- **CI, run locally at `a0d2a55`**
  ([summary](../../output/verification/2026-10-24-orders-collect-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 464 on PostgreSQL 17;
  - e2e: 576 journeys;
  - hot path: worst p95 91.4 ms (the search by six sellers) and 69.7 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the panel of five with the keyboard of «Оплата
  частинами»; a real Telegram's buzz.
- **Left:** «Замовлення»'s P0-5, P1-1…P1-3 (the conflict's words with
  P1-2), P2-1…P2-5.
