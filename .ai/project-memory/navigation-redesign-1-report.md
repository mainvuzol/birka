# The bottom menu, first step: «Продати | Повернути» on the till — 2026-10-26

Baseline: `a3a2dd0` (#139, on main), and the bottom menu's task list
([redesign/2026-10-26-redesign-tz-navigation.md](redesign/2026-10-26-redesign-tz-navigation.md)),
written the same day.
Status: built, reviewed and proven: the whole CI run locally passed at
`db5974f`, and ten of ten ways of breaking it caught. The switch and its words wait for the
owner's approval; not yet tried on a real phone.
Branch: `feat/navigation-return-switch`. Task: P0-1; with it, «+ Нове
замовлення» only with the right to read orders, and the task list itself.
Owner: business-rules.md, "after #139 was merged" and "the bottom menu's
task list" (2026-10-26).

## Why this was next

After #139 the owner chose the task list for the bottom menu, put off on
2026-10-14 — every counter section had closed its own but for the items
that wait on it. The strategist wrote it the same day; the owner answered
its seven questions, each (а), and chose P0-1 first: «Повернення» was a
button of its own in the row, the longest, holding the row at the edge of
one line at 360 px and leaving no room for «Товар», though selling and
taking back are one thing at the counter.

## What exists now

- **The row: «Продаж · Борги · Каса · Ще».** «Продаж» stands for the till
  and the returns, marked on either; for whoever only takes returns it
  opens them.
- **«Продати | Повернути» under the heading** of the till and of the
  returns' list, for whoever does both — a tap each way, the way open
  marked and focused, held as the row is. None on a receipt, a sale's
  return or its result.
- **«+ Нове замовлення» only with the right to read orders** (the owner's
  decision after #139): whoever makes one sees it.
- **The task list and the owner's version,** with the owner's answers in
  its status line.

No backend change.

## Decided here, not by the owner

- **The headings name the way open,** «Продаж» and «Повернення», as before
  — the task list's own deviation, to approve.
- **The switch's place:** under the heading, 18 px above and below it, the
  till's own spacing. On a phone of 360 × 640 the switch, the search and the
  first tag's name stay in view; in a store of two warehouses, where the
  choice of warehouse stands, the first tag's sizes begin at the fold — to
  be seen on a phone (С1).
- **The way just chosen takes the focus.**
- **For whoever only takes returns, «Продаж» keeps an order left open,** as
  «Повернення» did.

## How it was built and proven

- **`till-sections.spec.ts`:** the row «Продаж · Борги · Каса · Ще»; the
  switch on one line, a tap to the returns and back, «Продаж» marked on
  both, the way open marked and focused, «Ще» not marked; whoever only takes
  returns has «Продаж» open them with no switch; both themes at 4.5:1, the
  theme checked, nothing wider than the phone; whoever sells but may not
  read orders has no «+ Нове замовлення».
- **`till-redesign.spec.ts`:** under the switch, the search and the first
  tag's name in view at 360 × 640, its sizes begun.
- **`returns.spec.ts`:** without the right to take returns, no switch and no
  «Повернути».
- **`outage.spec.ts`:** a kept return opens on its tab, «Продаж» marked,
  «Повернути» the way open, the switch held.
- **`till-receipt.spec.ts`:** no switch on the receipt; its «Оформити
  повернення» opens the sale's return at once, «Продаж» marked, no switch.
- **The journeys' way there:** `section(page, "Повернення")` goes through
  «Продаж», then «Повернути» where there is one; 15 presses in 7 specs moved
  to it.
- **Related journeys:** 263 — the returns, the till, the receipt, debts,
  the outage and its marks, «Каса», stores, the text from outside and
  sessions — passed with it before the review; after its fixes, the
  receipt's, stores' and returns', 23; 647 in the whole run.
- **Mutation:** 10 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 10 caught
  ([`mutants.txt`](../../output/verification/2026-10-26-navigation-return-switch/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
found nothing serious: every way into the returns marks «Продаж»; «Ще»
never marked there; the switch held exactly when the row is; no journey
left pressing the old button. It found, all addressed before the first
commit:
- **The focus was lost to the page** after a way chosen, the button gone
  with its screen. Now on the way open.
- **Untested:** a kept return's marks and its switch held; no switch on a
  receipt or a sale's return. Now each has its journey.
- **For whoever only takes returns, «Продаж» forgot an order left open.**
  Now kept.
- **Assertions that would pass broken:** a store that does not trade
  checked for «Повернути» only; the dark theme not checked. Now both.
- **The journeys' way there** did not wait for «Повернення». Now it does.

Not changed: «Продаж», marked, tapped on the returns with both rights,
goes to the till — a return being typed is left, as the old «Продаж» did;
from a receipt to the returns' list is two taps (the switch is not on the
receipt, as the task list asks). Both for the owner with P0-5 and P0-6.

## Evidence

- [`output/verification/2026-10-26-navigation-return-switch/`](../../output/verification/2026-10-26-navigation-return-switch/):
  `mutants.py`, `mutants.txt`, `screens/` (the till with the switch, both
  themes).
- **CI, run locally at `db5974f`**
  ([summary](../../output/verification/2026-10-26-navigation-return-switch-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 468 on PostgreSQL 17;
  - e2e: 647 journeys;
  - hot path: worst p95 106.1 ms (the search of every warehouse by six
    sellers) and 111.2 ms (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the switch under a thumb, the first tag's sizes at
  the fold in a store of two warehouses.
- **Left:** the task list's P0-2…P0-6, P1-1, P1-2 and P2.
