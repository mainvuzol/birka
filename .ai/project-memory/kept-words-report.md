# A kept command's words for a server's error, and a manager after three «not found» — 2026-10-20

Baseline: `0914d5d` (a closed store's debt at the till, a letter in two
parts and an empty «Борги»; on P1-5, PR #112); rebased on main once #113
and #114 (`vite` 8.3.3, `certifi` 2026.10.19) were merged.
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-four of twenty-four ways of breaking it caught. Not yet tried on a
real phone.
Branch: `feat/kept-words`. Owner: business-rules.md, "seven readings after
#110 and P1-5, and what next" (2026-10-19), its first two answers.

## Why this was next

A kept payment, write-off or return answered with a server's error already
said «… ще не підтверджено: сервер не зміг відповісти …» (#110). Every
other kept command still said the shared «Не вдалося виконати операцію.
Спробуйте ще раз.» — read as "it failed", where nothing proved it: a sale
could be sold, a card charged, a delivery received again. And a kept
command answered «not found» again and again kept the app waiting with the
same words each time. The owner answered on 2026-10-19: the same words for
every kept command, and from the third «not found» in a row, a manager.

## What exists now

- **A kept sale, delivery, stock correction, stocktake count, drawer
  command or order step,** answered by a server's error, a request not
  found, or any answer the app has no words for while its outcome is
  unknown — at its first press, or asked about again — says what it is and
  that it is still unconfirmed, its request's number where the server gave
  one:
  - «Продаж ще не підтверджено: сервер не зміг відповісти. Перевірте
    результат ще раз — двічі він не запишеться. Номер запиту: 5a6b7c8d.»;
  - «Приймання … воно», «Коригування … воно», «Підрахунок … він», «Зміну
    способу оплати … вона», «Причину … вона», «Видачу … вона», «Внесення …
    воно», «Операцію «Клієнт забрав» … вона» — named from its first press;
  - an order's step or a sale the server answered, whose reading alone
    failed, keeps the shared words: it is recorded; refused at its first
    press, too: it never was.
- **From the third «not found» in a row** for one kept command — a sale, an
  order's step, or any of the journal's, a payment among them — the words
  add «Зверніться до менеджера: нехай перевірить, чи записано.» Any other
  answer begins the count again; no answer at all leaves it; an attempt
  read from the phone's storage begins it afresh.

What is sent, the money and the rules are unchanged.

## Decided here, not by the owner

- **«нехай перевірить»,** where the owner's answer read «він перевірить»:
  the app's words name no one's gender.
- **The stocktake's count too:** a kept command beside the correction,
  though the answer named the five.
- **The count is the phone's, for the session:** reopened, it begins again.
- **Not changed:** the suppliers', invoices', stores' and catalogue's kept
  commands, which the answer did not name; a refusal that proves nothing was
  recorded; a phone that cannot reach the server; the app's own failure.

## How it was built and proven

- **`outage.spec.ts`:**
  - a kept sale: a 500 — still unconfirmed, the number; then «not found»
    once and twice — still unconfirmed; the third — a manager; a 500 again
    — the count begun again, the number back; «not found» — no manager;
    each read only once the check is free again;
  - a kept stock correction, delivery and stocktake count: a 500 — each by
    its own name, the number, still kept; then «not found» three times on
    its own banner — a manager at the third;
  - a kept order step: a 500 — «Операцію «Відправлено» …», the number;
    «not found» three times — a manager; a 500 — the count begun again;
    answered, its order unread — the shared words;
  - a kept payment, the shared journal's, and a kept return: «not found»
    three times — a manager; the payment's count begun again by a 500;
  - a kept sale's resend meeting a 500 after an outage: the new words.
- **`cash.spec.ts`:** the drawer's kept commands answered with a 500 — a
  change of a payment's way, a count at the close, a reason, money taken
  out, money put in — each by its own name; the change counting «not
  found» to a manager.
- **`credits.spec.ts`** (real API): «Клієнт забрав» refused at its first
  press with «not found» — the shared words, nothing kept; then a 500 —
  «Операцію «Клієнт забрав» ще не підтверджено …», kept, resent as sent.
- **Mutation:** twenty-four ways of breaking it, one at a time, each
  against the journeys meant to catch it, after the unchanged tree passed:
  all caught. A first run, before the review, caught thirteen of thirteen;
  after its fixes, a sale read back after its answer had no journey, and
  has one now (`output/verification/2026-10-20-kept-words/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found no blocker: the new words only for an unknown outcome, never
for a refusal that proves nothing recorded nor for a phone that cannot reach
the server; every kept banner wired; the counter growing only for «not
found» on a kept attempt; every noun and its word after agreeing; the
manager's sentence without a gender. It found the following, all addressed
before the first commit:
- **The count belonged to the journal, not the attempt:** read from the
  phone's storage — another store's kept command — it carried the last
  count, and the manager came at the first «not found». It begins afresh
  now; and the orders' store no longer counts a refusal that settled.
- **An order's step the server answered, whose order could not be read,**
  was called unconfirmed: it keeps the shared words now, as a sale read back
  so.
- **No answer at all between two «not found»** began the count again: it
  leaves it now.
- **Tests that would have passed:** the count's wiring for a delivery, a
  correction, a count, a return and the drawer; its new beginning in the
  journal and the orders; an order's first press; the drawer's other
  commands; the manager's threshold by one either way. Each has a journey
  and a mutant now.
- **Smaller:** a movement named «Видачу чи внесення» where its way is known;
  an order's step unnamed at its first press; the rules and the milestone
  saying more than was built; a stale comment; a test placed between a
  helper and its comment.

**For the owner,** not decided here:
- «Зверніться до менеджера: нехай перевірить, чи записано.», where the
  answer read «— він перевірить …»;
- whether the three «not found» are remembered when Telegram closes and
  reopens the app, as it often does;
- what an order's step the server confirmed says when its order cannot be
  shown after: the shared words, as now, or its own;
- a kept command refused with an answer the app has no words for (a 400):
  «сервер не зміг відповісти», as now.

## Evidence

- [`output/verification/2026-10-20-kept-words/`](../../output/verification/2026-10-20-kept-words/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally again at `e6dbb6e`,** rebased on #113 and #114
  ([summary](../../output/verification/2026-10-20-kept-words-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 458 on PostgreSQL 17;
  - e2e: 469 journeys;
  - hot path: worst p95 93.5 ms (the search by six sellers) and 107.4 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.
  - An earlier run, at `56a40dc` before the rebase, passed every job too;
    since then two advisories made both audits fail on main, which #114
    fixed.

## Not covered here

- **On a real phone:** a kept command's words over the till.
- **No answer between two «not found»** leaving the count: built, no
  journey loses the connection between them.
- **The other kept commands** — suppliers, invoices, stores, the catalogue —
  keep the shared words.
