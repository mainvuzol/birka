# «Замовлення»: an order's refusals in its own words — 2026-10-24

Baseline: `09431ee` (#131, «Початкові залишки»'s own refusal words, on
main; first built on `5e62161`, #130, and rebased), and
«Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`18739e7`, and fourteen of fourteen ways of breaking it caught. The
texts wait for the owner's approval; not yet tried on two real phones.
Branch: `feat/orders-refusals`. Task: P1-2.
Owner: business-rules.md, "after #130 was merged" (2026-10-24).

## Why this was next

The owner approved «Нове замовлення» and its two wordings, and chose an
order's refusals. Two sellers work the same orders: a step another phone
had already made impossible — sent, cancelled, taken back — was answered
«Перевірте дані та поточний статус замовлення.», the card still showing
the old status; a conflict said «Дані змінилися або команда конфліктує з
попередньою. Оновіть замовлення.» though «Оновити» is gone; a saved step
refused on resend, «Операцію «Відправлено» не записано. Перевірте дані та
поточний статус замовлення.».

## What exists now

- **A step another phone made impossible:** «Не записано: замовлення вже
  «Скасовано» — картку оновлено.», by the status pill's word; a buzz,
  focused; the card and its row read again, the step pressed gone.
- **A closed order's shipping:** «Не записано: замовлення вже закрито,
  доставку більше не змінюють.».
- **A waybill of no digit or Latin letter:** «Номер ТТН має містити цифри
  або латинські літери. Перевірте його.», the field kept.
- **A conflict as the seller works,** a new order too: «Не записано: дані
  замовлення змінилися, поки ви працювали. Перевірте замовлення й
  спробуйте ще раз.» — the owner's words; what was typed kept.
- **A saved step resent and refused:** «Операцію «Відправлено» не записано:
  замовлення вже «Скасовано».», and the same for each reason in a resend's
  words.
- **A saved step met by a conflict that proves nothing:** still
  unconfirmed, never «спробуйте ще раз».

What is sent is unchanged; no backend change.

## Decided here, not by the owner

- **The task list's texts** wait for the owner's approval at delivery, as
  it says.
- **A waybill «цифри або латинські літери»,** not «цифри чи літери»: the
  server counts only Latin letters, so «НП» alone would have been told it
  holds no letter.
- **A resend's words:** a conflict «… поки сервер не відповідав …», as
  every journal says it, since nobody was at work on it; a waybill without
  «Перевірте його», its field gone with the screen.
- **A saved step met by a conflict that proves nothing:** «Операцію
  «Відправлено» ще не підтверджено: сервер відповів, що дані змінилися.
  Перевірте результат ще раз — двічі вона не запишеться.», as a kept
  return says it — before, «… команда конфліктує …».
- **The row in the list read again after any refusal of a step,** not only
  a transition's.
- **A step recorded whose order could not be read never says «Не
  записано»,** whatever the reading answered.

## How it was built and proven

- **`orders-card.spec.ts`, 9 more journeys (stubbed):**
  - «Відправлено» on an order cancelled meanwhile, «Прибув на пошту» on one
    taken back, «Скасувати замовлення» on one sent: each «Не записано:
    замовлення вже «…» — картку оновлено.», focused, an error buzz, the card
    and the list read again, its pill the new status, the step pressed
    gone, never the shared words;
  - a closed order's shipping, and the card read again;
  - a shipping change whose answer never came, resent after the order
    closed: «Операцію «Зміна доставки» не записано: …», the same body;
  - a step met by a conflict on its check: still unconfirmed, no «спробуйте
    ще раз», the check still offered;
  - a resend refused for a conflict and for its waybill, recorded nowhere:
    which, and why in a resend's words;
  - a waybill «НП»: the field's own fault, focused, a buzz, the field kept;
  - the conflict's words on the existing refused step.
- **The real API (`orders.spec.ts`):** an order made on the screen,
  cancelled from another phone through the API, then «Відправлено»: the
  server's own refusal said «Не записано: замовлення вже «Скасовано» —
  картку оновлено.», focused, its pill «Скасовано», no «Відправлено»; a new
  order's conflict in the owner's words with its line, price and carrier
  kept.
- **`outage.spec.ts`:** a saved step refused on resend says «Операцію
  «Відправлено» не записано: замовлення вже «Скасовано».».
- **Related journeys:** 267 — orders, their list, card, shipping and new
  order, the outage and its paper, debts, the till, returns, «Каса» and its
  kept commands, failures and sessions — passed with it.
- **Mutation:** 14 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 14 caught
  ([`mutants.txt`](../../output/verification/2026-10-24-orders-refusals/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed every text the task list decides word for word on its path; only
the transition refusal carrying a status and an action with no reason;
«спробуйте ще раз» said only where the server proved nothing recorded;
«картку оновлено» only where the card and the list are read again; the
late «Клієнт забрав» and a kept step's words unchanged; and no order path
left with «команда конфліктує». It found, all addressed before the first
commit:
- **The waybill's words wrong for Cyrillic:** «НП» would have been told it
  holds no letter. Now «цифри або латинські літери».
- **Texts beyond the task list not declared.** Now in the business rules
  and above.
- **A resend's conflict said «поки ви працювали».** Now «поки сервер не
  відповідав», and a resend's waybill without «Перевірте його».
- **Smaller:** a recorded step whose reading failed otherwise could have
  said «Не записано»; the status checked as the pills' own key; the
  journeys' stubs the server's code; the waybill's journey checking its
  field, focus and buzz; the step pressed checked gone; «Спробуйте ще раз»
  matched whatever its case.

Not changed: a status the app does not know falls to the shared words —
the server's statuses are the app's; the shipping form's field is still
«Номер накладної» until P1-3, though its refusal says «Номер ТТН».

## Evidence

- [`output/verification/2026-10-24-orders-refusals/`](../../output/verification/2026-10-24-orders-refusals/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `18739e7`**,
  rebased on #131
  ([summary](../../output/verification/2026-10-24-orders-refusals-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 464 on PostgreSQL 17;
  - e2e: 603 journeys;
  - hot path: worst p95 92.3 ms (the search by six sellers) and 105.2 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** two phones on one order in a shop; a real
  Telegram's buzz.
- **Left:** «Замовлення»'s P1-1 (a saved step's words), P1-3 (shipping its
  own step), P2-1…P2-5.
