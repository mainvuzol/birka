# The bottom menu, second step: «Клієнти» with «Борги | Замовлення» — 2026-10-26

Baseline: `944e581` (#140, on main), and the bottom menu's task list
([redesign/2026-10-26-redesign-tz-navigation.md](redesign/2026-10-26-redesign-tz-navigation.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`d990fc5`, and 15 of 15 ways of breaking it caught. The
section, its switch and its words wait for the owner's approval; not yet
tried on a real phone.
Branch: `feat/navigation-customers`. Task: P0-2.
Owner: business-rules.md, "after #140 was merged" (2026-10-26).

## Why this was next

When #140 was merged the owner approved «Продати | Повернути» as built and
chose P0-2: who owes and what to send are one notebook of customers at the
counter, but the debts were a button of the row and the orders two entries
under «Ще», a tap further, with two ways into a new order — «Ще» and the
«+» in «Замовлення»'s heading.

## What exists now

- **The row: «Продаж · Клієнти · Каса · Ще».** A seller's «Ще» holds
  «Каталог · Приймання · Залишки · Брак». «Клієнти» stands for the debts,
  the orders and a new order, marked on each; shown with the right to
  debts or to read orders, never without both.
- **«Клієнти» opens the debts,** or the one of the two this person has;
  whoever does none of the counter's work but reads orders opens on the
  orders, as before.
- **«Борги | Замовлення» under each list's heading,** for whoever has both
  — P0-1's switch, the way open marked and focused, held as the row is.
  None on a debt, a customer's card, an order's card, a new order or its
  delivery.
- **«Клієнти» pressed again** brings its way's first screen: the debts'
  list from a debt, the orders' list from an order's card or a new order.
- **A new order is the «+» in «Замовлення»'s heading,** as before;
  «Замовлення» and «+ Нове замовлення» leave «Ще».
- **The taps** ([hot-path-budget-report.md](hot-path-budget-report.md)):
  the debts 1 → 1, the orders 2 → 2, a new order's form 2 → 3, as the task
  list counts; a whole new order 5 → 6.

No backend change.

## Decided here, not by the owner

- **The headings name the way open,** «Борги» and «Замовлення» with its
  «+», as P0-1's do — the task list's own deviation, to approve. On the
  debts the heading and the segment open under it both read «Борги» (the
  screens).
- **The section opens on the debts,** the first way allowed, not on the
  last one open (the task list's Г3, to approve).
- **«Клієнти» pressed again on a debt** brings the debts' list; a sum typed
  in a payment is lost, as on leaving for any other section.
- **The receipt's «Наступні внески — у розділі «Борги».»** is kept as it
  was, though the row has no «Борги» now: the words are the owner's.

## How it was built and proven

- **`till-sections.spec.ts`:** the row «Продаж · Клієнти · Каса · Ще» and
  «Ще» without the orders; «Клієнти» opening on «Борги», the switch on one
  line at 360 px, the debts a tap, the orders two, a new order three,
  counted by the page's own `pointerdown`; the way open marked and focused,
  «Клієнти» marked on each, «Ще» not; pressed again from a new order, the
  orders; both themes at 4.5:1, nothing wider than the phone; whoever reads
  orders alone has «Клієнти» and «Ще», «Клієнти» marked; whoever has
  neither has «Ще» alone; whoever sells but may not read orders has
  «Клієнти» open the debts with no switch, no «Замовлення» and no «+».
- **`credits.spec.ts`:** without the right to debts, «Клієнти» opens the
  orders, no switch, no «Борги».
- **`credits-debt.spec.ts`, `orders-card.spec.ts`:** «Клієнти» pressed
  again on a debt, or on an order's card, brings its list.
- **`outage.spec.ts`:** a kept payment of whoever has both opens on
  «Борги», «Клієнти» and the segment «Борги» marked, the switch held;
  whoever has neither has no «Клієнти».
- **`orders.spec.ts`:** a kept order step opens on «Замовлення», «Клієнти»
  marked and held, and on its card once checked, «Клієнти» marked still.
- **`stores.spec.ts`:** a store that does not trade reads its orders with
  no «+».
- **`cash.spec.ts`, `orders.spec.ts`, `borrowed.spec.ts`,
  `supplier-invoices.spec.ts`, `suppliers.spec.ts`, `stores.spec.ts`:**
  «Клієнти» held where «Борги» or «+ Нове замовлення» was.
- **The journeys' way there:** `section(page, "Борги")` and
  `section(page, "Замовлення")` go through «Клієнти», then the way asked
  for where there is a switch; `section(page, "+ Нове замовлення")` through
  «Замовлення» and its «+». 17 direct presses of «Борги» in 6 specs moved
  to it.
- **Found on the way:** `returns-elsewhere.spec.ts` checked every sale's
  row before the search had answered, failing once the database held more
  than 20 of the day's sales (on main as well). It now waits for the one
  searched sale.
- **Journeys:** 650 in the whole run before the review — every one passed
  but the backups' night copy, known to fail on this machine, the new
  order's taps (now six) and the race above, both fixed; after the
  review's fixes, the ten it touched and the stores' blocking.
- **Mutation:** 15 ways of breaking it, one at a time, after the
  unchanged tree passed with everything they name: 15 caught
  ([`mutants.txt`](../../output/verification/2026-10-26-navigation-customers/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
found no bug: every way into the debts and the orders marks «Клієнти»; a
kept payment turns to the debts only with their right; the first section
never lands on the orders without theirs; «Клієнти» pressed again cannot be
stale and is held while anything holds the row; the switch's shared focus
flag never goes stale in this step. It found, all addressed before the
first commit:
- **Two assertions that always passed:** «Ще» without «Замовлення» for
  whoever sells without reading orders, and a store that does not trade
  without «+ Нове замовлення», true of every person now. Now «Клієнти»
  opens the debts alone, and the store's «Замовлення» has no «+».
- **Untested:** a kept payment's segment «Борги» for whoever has both, a
  kept order step's card with «Клієнти» marked, and the row without
  «Клієнти» for whoever has neither. Now each has its journey.
- **The task list's taps** were not in the hot path's report. Now they
  are.
- **Comments and titles** still naming «Борги» in the row or «+ Нове
  замовлення» in «Ще». Now they don't.

Not changed: the receipt's sentence above, for the owner; «Клієнти»
pressed again does not scroll to the top, as «Замовлення» did not.

## Evidence

- [`output/verification/2026-10-26-navigation-customers/`](../../output/verification/2026-10-26-navigation-customers/):
  `mutants.py`, `mutants.txt`, `screens/` («Борги | Замовлення», both
  themes).
- **CI, run locally at `d990fc5`**
  ([summary](../../output/verification/2026-10-26-navigation-customers-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC. The whole run
  exited 1 on the two audits alone: neither registry's name could be
  resolved at that minute (`ENOTFOUND registry.npmjs.org`, `pypi.org`), so
  neither checked anything. Those two jobs, run again alone at the same
  commit a few minutes later, passed
  ([summary](../../output/verification/2026-10-26-navigation-customers-audits-ci-local/summary.md)).
  - backend: 3 468 on PostgreSQL 17, with its declared gap;
  - e2e: 651 journeys;
  - hot path: worst p95 110.2 ms (the catalogue read by six sellers) and
    115.4 ms (`POST /sales`, the same coat by six sellers), within 300 and
    500;
  - frontend: eslint and tsc clean, the build; `npm audit` 0;
  - python-audit: 43 packages, 0 known vulnerabilities;
  - restore drill and edge passed.

## Not covered here

- **On a real phone:** «Клієнти» and the switch under a thumb.
- **For the owner:** the receipt's «Наступні внески — у розділі «Борги».».
- **Left:** the task list's P0-3…P0-6, P1-1, P1-2 and P2.
