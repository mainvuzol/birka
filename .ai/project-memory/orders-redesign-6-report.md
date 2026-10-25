# «Замовлення»: a kept step says which step and which order — 2026-10-25

Baseline: `b99c4ba` (#134 and #135, on main), and «Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`746b76a`, and twelve of twelve ways of breaking it caught. The words
wait for the owner's approval; not yet tried on a real phone.
Branch: `feat/orders-kept-step`. Task: P1-1.
Owner: business-rules.md, "after #134 was merged" (2026-10-25), and В4 (а)
(2026-10-23).

## Why this was next

The owner chose P1-1 after #132, once the other screens had their words.
An order step whose answer was lost showed «Незавершена операція» and
«Відправлено. Поки чекаємо, інші дії недоступні.» — no order named, though
two sellers work the same parcels; its button «Повторити ту саму команду»;
the paper line every other journal has, «Запишіть цю операцію на папері …
Вносьте з паперу, лише якщо застосунок скаже «не записано».», though an
order's step is never typed from paper; and once confirmed, the card opened
saying nothing of it.

## What exists now

- **The banner names the step,** as an order's refusals name it:
  «Операцію «Відправлено» ще не підтверджено», while checked «Перевіряємо
  операцію «Відправлено»…».
- **And the order:** «Лоран шоколад · M · Нова пошта · ТТН 20451234 —
  сервер не відповів. Двічі вона не запишеться. Поки чекаємо, інші дії
  недоступні.» — kept beside the command on the phone only to be shown,
  never sent; a shipping change names the delivery it sets; a command kept
  before this, «Операцію «Відправлено» — сервер не відповів. …».
- **Never from paper** (В4 (а)): «Телефон перевірить сам. Нічого не
  повторюйте, поки він не скаже «не записано».».
- **«Перевірити результат замовлення».**
- **Confirmed later:** «Операцію «Відправлено» записано один раз», with a
  buzz.
- **No banner while a first press is on its way.**

What is sent is unchanged; no backend change.

## Decided here, not by the owner

- **An answered step whose order could not be read** says «Операцію
  «Відправлено» записано» and «… — замовлення ще не вдалося показати.»,
  with no paper line: it is recorded, and nothing will say «не записано».
- **A new order confirmed later still says what it reserved** (P0-5,
  approved), or «… записано один раз» if it moved on meanwhile; a collect,
  its sale (P0-3). A step on an order confirmed later says «… записано один
  раз» in place of what it did when pressed — a shipping change and a
  return now say it too, with a buzz.
- **What is shown is dropped unless a string of at most 1 000 characters,**
  the command kept as ever; a stored label is shown through `visible()`.
- **A new order of several goods is named as its card will be:** «Лоран
  шоколад · M + ще 2 · Нова пошта».
- **For the owner, the task list's own words:** «Операцію «Відправлено» —
  сервер не відповів» leaves «Операцію» without its verb, and «Двічі вона
  не запишеться» after a line of goods leans on the heading's «операцію».
  Kept as written; to be asked.

## How it was built and proven

- **`orders-card.spec.ts`:** a kept dispatch names its step and its order,
  goods, carrier and waybill; never from paper; what is shown is kept in the
  phone's copy beside the command; resent byte for byte, nothing only shown
  in its body; confirmed, «Операцію «Відправлено» записано один раз» and one
  buzz. An answered step whose order could not be read: «… записано», «…
  замовлення ще не вдалося показати.», no «не записано»; read again, «…
  записано один раз». A first press on its way: no banner. A collect
  confirmed later keeps its sale's words alone.
- **`order-shipping.spec.ts`:** a shipping change to another carrier whose
  answer is lost names the carrier it sets with its waybill; reopened and
  checked by itself, «Операцію «Зміна доставки» записано один раз».
- **`orders-new.spec.ts`:** a kept new order names what is ordered and how
  it goes; resent byte for byte, nothing only shown; answered but unread,
  «Операцію «Резервування замовлення» записано».
- **`outage.spec.ts`:** a command kept before this, said by its step alone,
  with the phone's own line; one whose line to show is spoiled, or past its
  length, kept and checked as ever, said by its step alone, the phone's copy
  rewritten without it.
- **`orders.spec.ts`, `credits.spec.ts`:** their kept journeys in the new
  words.
- **Related journeys:** 263 — orders, their list, card, shipping and new
  order, debts, the outage and its paper, the till, returns, «Каса»'s kept
  commands, sessions and failures — passed with it before the review;
  after its fixes, the four specs it touched, 167.
- **Mutation:** 12 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 12 caught
  ([`mutants.txt`](../../output/verification/2026-10-25-orders-kept-step/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that what is shown is never sent and gives no new reason to
refuse a kept command; that a resend is the body byte for byte; that «…
записано один раз» is said only for a step proven recorded and read; that
an order adds no customer's name or phone; that nothing shown can crash or
inject; and every text against the task list. It found, all addressed before
the first commit:
- **The answered banner said to wait for «не записано».** Now no paper line
  once answered.
- **A shipping change named the old carrier with the new waybill.** Now the
  delivery it sets, whole.
- **Every first press showed «сервер не відповів» while it was on its way.**
  Now no banner until it comes back unanswered, as «Каса».
- **Smaller:** a stored label shown through `visible()`; a long line
  dropped only past 1 000 characters; a new order of several goods named as
  its card; a new order confirmed late and moved on said once; comments.

Not changed: a sale's and a payment's banners flash the same way on a first
press (their own screens); the task list's two phrasings above, for the
owner.

## Evidence

- [`output/verification/2026-10-25-orders-kept-step/`](../../output/verification/2026-10-25-orders-kept-step/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `746b76a`**
  ([summary](../../output/verification/2026-10-25-orders-kept-step-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 467 on PostgreSQL 17;
  - e2e: 616 journeys;
  - hot path: worst p95 104.8 ms (the search by six sellers) and 183.4 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** a parcel's step lost on a shop's network, and a real
  Telegram's buzz.
- **A new order confirmed late and moved on meanwhile** says «… записано
  один раз»: no journey makes a new order move on between its press and
  its check.
- **Left:** «Замовлення»'s P1-3 (shipping its own step) and P2-1…P2-5.
