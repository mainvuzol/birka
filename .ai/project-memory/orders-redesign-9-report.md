# «Замовлення»: its words and rights, its places while read, its pills — 2026-10-25

Baseline: `9fea492` (#138, on main), and «Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`c068c33`, and fifteen of fifteen ways of breaking it caught. The screens wait for the owner's approval;
not yet tried on a real phone. With this, «Замовлення»'s task list is done
but for P2-5, which waits on the bottom menu.
Branch: `feat/orders-finish`. Tasks: P2-1, P2-2, P2-3.
Owner: business-rules.md, "after #138 was merged" (2026-10-25).

## Why this was next

The owner chose the last three tasks together after #138, and «Каса»'s
refusals in its banners' words. «Замовлення» stood in «Ще» for everyone,
and whoever could not read orders read «Немає права переглядати
замовлення.»; the list and the card said «Завантажуємо…» in place of what
was coming; every status was the one accent pill; what is said under a step
was 13 px; and a list or a card that could not be read was a debt's red.

## What exists now

- **«Замовлення» only for whoever may read them:** not in «Ще» otherwise,
  the rule said nowhere, the app opened on the first section shown.
- **Places while read:** the list, a group's heading and three rows; a
  search, three rows; the card, in its own frame, its title, context, pill
  and two lines — the field and the first row stand where they will.
- **Pills by what they mean** (В5 (а)): to be sent, a warning's; on its
  way, «в дорозі»'s blue; collected, the accent; cancelled or come back,
  grey.
- **14 px under a step,** the card still whole at 360 × 640.
- **What could not be read, on a warning's plate,** as «Каса»'s, with
  «Спробувати ще раз»; a step refused stays red.
- **«Каса»'s refusals:** «Видачу ще не підтверджено: … Перевірте результат
  ще раз — двічі цю операцію не запишуть.», as its banners.

No backend change.

Also here, a fix of two server tests (`c068c33`): a paper time aged out
was moved two days back by 48 hours in UTC, which across the night the
clocks changed (2026-10-25) landed on the next day of Kyiv's between 23:00
and midnight, two days long — the first CI run at `2ee9ce0` failed so. Now
two days back on the store's wall clock; both failed at 23:22 before it,
and passed after.

## Decided here, not by the owner

- **The first section shown,** for whoever opens on «Замовлення» without the
  right; a kept operation keeps its own tab; a kept order step of whoever
  may not read orders turns to none, its banner over any.
- **«Товар у резерві — на касі його не продадуть.» kept close to what it
  explains,** at 14 px two lines, so the waybill's field stays over the
  panel at 360 × 640.
- **A new order's goods that could not be read** on the same plate.
- **«Каса»'s refusals only:** every other screen's «… двічі він (вона, воно)
  не запишеться.» unchanged.
- **To be asked:** a role that sells but may not read orders still has «+
  Нове замовлення»; its order, recorded, cannot be shown — the phone reads
  it back — and its banner waits on «Оновити результат». No default role is
  so; whether to offer it only with the right to read orders is the
  owner's.

## How it was built and proven

- **`till-sections.spec.ts`:** a role that may not read orders — no
  «Замовлення» in «Ще», opened on «Перевірка каталогу», the rule said
  nowhere.
- **`outage.spec.ts`:** a kept delivery of such a role opens on «Приймання»,
  never on the first section instead.
- **`orders-list.spec.ts`:** the open orders' places — a heading and three
  rows, the first row and the field where they will stand, «Завантажуємо
  замовлення…» heard; a search's three rows and «Шукаємо…»; a list that
  could not be read on a warning's plate, in its colours; each pill's class,
  «в дорозі» in its own colours, every pill at 4.5:1 in both themes.
- **`orders-card.spec.ts`:** the card's places in its frame, the title where
  its place was, 14 px under a step; read again and failed, a warning's
  plate in its colours; still whole at 360 × 640.
- **`cash.spec.ts`, `cash-polish.spec.ts`:** «Каса»'s refusals in the new
  words.
- **Related journeys:** 321 — orders, their list, card, shipping and new
  order, the sections, the outage, «Каса», debts, returns, stocktakes,
  deliveries and corrections — passed with it before the review; 641 in the
  whole run.
- **Mutation:** 15 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: 14 caught; the one that survived —
  «Відправлено» given the accent — got its test, «В дорозі»'s second row
  checked too, and was caught on the rerun
  ([`mutants.txt`](../../output/verification/2026-10-25-orders-finish/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
found nothing of high severity: every other screen's refusal words
byte-identical, every pill at 4.5:1 in both themes, a refused step still
red, nothing of §9 left. It found, all addressed before the first commit
but the one asked of the owner:
- **The first section took a kept operation's own tab** — a kept delivery
  opened on «Каталог». Now only from «Замовлення» still.
- **A role that sells but may not read orders** loses what its new order
  did. The phone already could not show it, before this; to be asked.
- **The card's place for a pill** overrode «Каса»'s. Now «Каса»'s own.
- **The tightened hint reached the card's other lines.** Now only «Товар у
  резерві …».
- **The card's place stood 4 px off its title,** hidden by the test's
  tolerance. Now 0, checked to 1 px.
- **Two places at once** while nothing was open and the closed were read.
  Now one.
- **The card's plate's colours** were unchecked. Now checked.

Not changed: «Клієнт забрав»'s captions stay 13 px (the panel's, approved
in P0-3); a store where nothing is shown at all opens on nothing.

## Evidence

- [`output/verification/2026-10-25-orders-finish/`](../../output/verification/2026-10-25-orders-finish/):
  `mutants.py`, `mutants.txt`, `screens/` (the list and the card in both
  themes).
- **CI, run locally at `c068c33`**
  ([summary](../../output/verification/2026-10-25-orders-finish-ci-local/summary.md)),
  23:23–23:51, inside the hour the two tests failed in before their fix; on
  the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 468 on PostgreSQL 17;
  - e2e: 641 journeys;
  - hot path: worst p95 98.2 ms (the search by six sellers) and 116.5 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.
  The run before it, at `2ee9ce0`, failed on those two tests alone, every
  other job passed.

## Not covered here

- **On a real phone:** the places while read on a slow shop network.
- **Left:** «Замовлення»'s P2-5, with the bottom menu.
