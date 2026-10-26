# The bottom menu, fifth step: the till's basket kept — 2026-10-27

Baseline: `a885c71` (#143, on main), and the bottom menu's task list
([redesign/2026-10-26-redesign-tz-navigation.md](redesign/2026-10-26-redesign-tz-navigation.md)).
Status: built, reviewed and proven: the whole CI run locally passed at
`e0525fe`, and 15 of 15 ways of breaking it caught, as the runner stands. One question waits for the owner
(below); not yet tried on a real phone.
Branch: `feat/navigation-basket`. Task: P0-5.
Owner: business-rules.md, "after #143 was merged" (2026-10-26), and В6 (а).

## Why this was next

When #143 was merged the owner approved «Ще» as built and chose P0-5: the
basket was the till's own state, and the till is gone the moment another
section opens — «Повернути», «Клієнти», «Ще» — so a seller looking up
whether a customer still owes, with her waiting, typed every size again.
In the notebook nothing written disappears; and the bottom menu (P0-6) will
put a tab a centimetre from «Готівка».

## What exists now

- **The basket stays while the till is left** and comes back as it was:
  its lines, quantities and prices, paying in parts, the answers about the
  shelf and its question, the way pressed and its `command_id`, together;
  the warehouse chosen with it.
- **It is gone as before:** once sold, after «Новий продаж», with another
  store, on reload, once a kept sale settles. Kept under the store and the
  count of settled kept sales: the till then opens empty and never takes a
  command already answered; a sale answered forgets it at once.
- **The paper switch, one series across the screens, is followed as the
  till's own switch would be:** a basket from paper is gone once the switch
  moved elsewhere, however often; an unmarked one keeps its lines, not its
  shelf's answers or question, when the paper was ticked elsewhere.
- **An emptied basket keeps nothing.**
- **The taps** ([hot-path-budget-report.md](hot-path-budget-report.md)): the
  basket again after another section, every chip again → 0.

No backend change; nothing new on the phone's disk; no new words.

## Decided here, not by the owner

- **«Новий продаж» from a return's result and from «Борги»** opens the till
  on the basket kept, as В6 (а) keeps it until sold or the store changed.
  The button says a new sale; whether it should empty the basket is the
  owner's to say (asked after the merge).
- **The paper's day and time are not kept** with the basket: asked again,
  since a wrong one is permanent.
- **The warehouse chosen is kept** with the basket.
- **The paper switch's moves are counted** (`usePaper`'s `moved`) so that a
  switch moved on another screen and back is seen.
- **An emptied basket keeps nothing,** the part-payment's customer with it.

## How it was built and proven

- **`sales/basket.ts`:** the basket's line (`Draft`, moved from the till),
  the basket, and where it is kept — in memory, under the store and the
  settled kept sales; forgotten when the store is left and when a sale is
  answered.
- **`Sale.tsx`:** starts from the basket kept, as the switch would leave it;
  keeps it as it changes. **`App.tsx`:** the key, and forgetting it with the
  store. **`paper.ts`:** every move of the switch counted.
- **`till-basket.spec.ts`, ten journeys:** the basket after «Повернути»,
  «Клієнти» and «Ще» — its line, two coats, price, «Разом», warehouse;
  pressed again, the same lines under the same command, refused as ever;
  the phone's storage keys unchanged; sold, gone. «Новий продаж», another
  store and a reload: empty. A kept sale settled while the till was left:
  empty, the check under the kept command. From paper: back with the paper
  on and sent marked; gone once unticked elsewhere, and once unticked and
  ticked again. Unmarked, the paper ticked elsewhere: the lines without the
  open question; an answer given never sent with the mark. Paying in parts
  back with its customer; an answer about the shelf back and sent with the
  basket under the same command; an emptied basket keeps no terms.
- **Journeys:** 668 — the whole run after the review's fixes passed but for
  the backups' night copy, known to fail on this machine.
- **Mutation:** 15 ways of breaking it, one at a time, after the unchanged tree passed
  with everything they name: 14 caught. The one left — the store left not
  forgetting the basket — was covered twice: the paper's clearing counted
  as a move of its switch and dropped the basket by itself. It no longer
  counts; the store left clears the basket by `forgetBasket` alone, and
  that mutant was caught: 15 of 15 as the runner stands
  ([`mutants.txt`](../../output/verification/2026-10-27-navigation-basket/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
with money first, found no path where a basket kept is sent under a command
already answered, or a kept sale's command reused for another basket;
`replaceDraft` untouched; nothing on the disk; a kept sale settled while the
till is left opening it empty. It found, all addressed before the first
commit:
- **A paper basket survived the switch unticked and ticked again** on
  another screen — and could go in another series. Every move is counted
  now.
- **Paying in parts outlived an emptied basket:** the last customer's name
  and number for the next. An emptied basket keeps nothing now.
- **Journeys that proved less:** the paper basket never pressed; the
  shelf's answers never pressed after the paper ticked; paying in parts,
  the warehouse and the reload unproven. Each is now.
- **Insurance:** a sale answered forgets the basket at once, though nothing
  reaches that path while the till's send holds the row and «Ще».

For the owner: «Новий продаж» from a return or «Борги» (above).

## Evidence

- [`output/verification/2026-10-27-navigation-basket/`](../../output/verification/2026-10-27-navigation-basket/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `e0525fe`**
  ([summary](../../output/verification/2026-10-27-navigation-basket-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 468 on PostgreSQL 17;
  - e2e: 668 journeys;
  - hot path: worst p95 96.1 ms (the search by six sellers) and 104.6 ms
    (`POST /sales`, the same coat by six sellers), within 300 and 500;
  - frontend: eslint and tsc clean, the build; `npm audit` 0;
  - python-audit: 43 packages, 0 known vulnerabilities;
  - restore drill and edge passed.

## Not covered here

- **On a real phone:** the basket kept across a real Telegram session.
- **For the owner:** «Новий продаж» from a return or «Борги».
- **Left:** the task list's P0-6, P1-1, P1-2 and P2.
