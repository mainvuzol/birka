# The other screens' refusals in their own words — 2026-10-25

Baseline: `1f14716` (#132, an order's refusals, on main).
Status: built, reviewed and proven: the whole CI run locally passed at
`6ff94cf`, and thirty-five of thirty-five ways of breaking it caught. The
words wait for the owner's approval.
Branch: `feat/screens-refusals`.
Owner: business-rules.md, "after #131" and "after #132" (2026-10-25).

## Why

A refusal a screen does not name falls to the app's shared words, which
speak of an order: «Перевірте дані та поточний статус замовлення.» for a
request the server did not take, «Дані змінилися або команда конфліктує з
попередньою. Оновіть замовлення.» for a conflict. Orders, «Каса»,
«Повернення», «Борги», the till and «Початкові залишки» already said their
own. The owner chose, after #131, to give every other screen its own words
in one change, after P1-2.

## What exists now

- **`inOwnWords(said, invalid, conflict)`** beside the shared words: a
  screen passes its own for the two that speak of an order; any other
  answer — no server, a session ended, no access — passes as it was said.
- **Each screen's own words** for a request not taken and for a conflict:
  models (rename, merge, restore, retire, a kept change refused on its
  check), «Брак», a delivery (and a kept one recorded nowhere), a stock
  correction and a stocktake's count (and kept ones), a stocktake's start
  and finish, the price, a store's state, a supplier edited or added, a
  supplier return made or cancelled, invoices, borrowed goods, a customer's
  data erased, and the sign-in.
- **A conflict whose words say to look again re-reads what the screen
  shows.**
- **«Брак» refused by its own rule** is said as the rule, never a conflict.
- **Any kept command met by a conflict that proves nothing** stays
  unconfirmed in the shared kept words, now in one place.

No backend change; nothing sent changes.

## Decided here, not by the owner

- **All of the words,** for the owner to approve; each follows its
  screen's own («не записано», «не збережено», «не прийнято», «не
  змінено»…), and those spoken by one function for several commands are
  plain enough for each (invoices, supplier returns, a store's state).
- **A conflict's words** say to look again only where the screen now reads
  again what it shows.
- **«Брак»'s rule named once, for every screen,** since a correction's or
  a count's conflict words would otherwise send the person to count again.
- **The kept conflict words** extended from orders, returns, payments and
  «Каса» to a sale, a delivery, a correction and a count, and the copies of
  them folded into the shared one.

## How it was built and proven

- **A refusal stubbed once for the command alone (`refuseOnce`, never its
  reads), then the journey carried on as before,** in each screen's own
  spec: models (rename for its form and a conflict, merge, retire for a
  conflict with the card read again, restore), «Брак» (taken for
  inspection), a delivery (its form and a conflict, the list kept), a
  correction (its form, a conflict, and «Брак»'s rule), a stocktake (its
  start for its form and a conflict with the list read again, a count, its
  finish for a conflict with the record read again), the price (its form,
  a conflict with the prices read again), a store blocked (a conflict),
  suppliers (a return for a conflict and its cancel for a conflict, each
  with the returns read again; a supplier edited for its form and a
  conflict with the list read again), invoices (a new supplier, a
  payment), borrowed goods («продано» for its form and a conflict with the
  lots read again), a customer's data erased (a conflict with the debts read
  again). Where a journey counts what it sent, the refused body is checked
  to be the same as the one sent after it.
- **New journeys:** a sign-in refused for its form; a kept model change
  refused on its check for its form and for a conflict, recorded nowhere;
  a kept delivery met by a conflict without proof, then refused for its
  form; a kept delivery refused for a conflict, recorded nowhere; a kept
  stock correction refused for its form.
- **Related journeys:** 331 of 332 — every screen above, «Початкові
  залишки», orders, returns, debts, «Каса»'s kept commands, the catalogue
  and the first sign-in — passed with it before the review; after its fixes,
  the 13 specs changed, 214, passed. The one that did not, at 01:23 on
  25 October, counts a drawer's day across 05:50 and 06:10 of today: that
  night Kyiv's clocks go back an hour, both fall on one day by the app's
  «minus six hours», and it passes with every job's TZ=UTC, as CI runs it
  (below, Not covered).
- **Mutation:** 35 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 35 caught — 34 at first;
  the one that survived, erasing's conflict not read again, showed that
  the debt shown is no cached query, and it now reads the debt itself
  ([`mutants.txt`](../../output/verification/2026-10-25-screens-refusals/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that only the two shared strings are replaced, never a more
specific text; that «Борги»' payments still compare their own words; that
nothing unproven says «не записано» or «спробуйте ще раз»; and that the
kept conflict words reach every caller unchanged where they were already.
It found, all addressed before the first commit:
- **The new words not in the business rules.** Now there, each screen's.
- **Conflicts saying to look again where nothing is read again.** Now
  each of those screens reads again what it shows.
- **Changed places no journey reached:** a supplier edited, a kept delivery
  refused for a conflict, a kept correction, a delivery's form, a
  correction's conflict. Now reached.
- **Smaller:** a resend's model words now speak of the catalogue; invoices'
  and supplier returns' words fit each of their commands; a stocktake's
  finish speaks of the warehouse; «Брак»'s rule named; the vocabulary made
  one per screen; stale comments; the duplicate kept branches folded; the
  refused bodies compared; the imports in order.

Not changed: a kept command answered `IDEMPOTENCY_CONFLICT` keeps asking to
check again and never reaches a manager — as before, and now the same for
every kept command; a resend of a store's state, a supplier return or an
invoice refused as recorded nowhere cannot happen today, those services
never saying so.

## Evidence

- [`output/verification/2026-10-25-screens-refusals/`](../../output/verification/2026-10-25-screens-refusals/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `6ff94cf`**
  ([summary](../../output/verification/2026-10-25-screens-refusals-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 464 on PostgreSQL 17;
  - e2e: 609 journeys;
  - hot path: worst p95 93.1 ms (the search by six sellers) and 80.9 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **The drawer's day on the night the clocks change:** «Каса» tells a
  count that came too late «the same evening» or «another day» by the
  phone's time less six hours, an hour off on the night Kyiv's clocks go
  back; seen in a local run, not this change's, and left for its own.
- **Reads** that fail with a 422 still show the shared words: only a bad
  parameter makes one, and the catalogue's search is now held to the
  server's length.
