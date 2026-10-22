# «Каса»: «Закриття» a row a close — 2026-10-22

Baseline: `600d1f5` (main, with #122), and «Каса»'s task list
([redesign/2026-10-21-redesign-tz-cash.md](redesign/2026-10-21-redesign-tz-cash.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty of twenty ways of breaking it caught. The screen waits for the
owner's approval; not yet tried on a real phone. Stacked on #123
(`opentelemetry-api` 1.45.1), which the audit needs.
Branch: `feat/cash-history`. Task: P1-4. Owner: business-rules.md, "after
#122" (2026-10-22).

## Why this was next

After #122 the owner approved its two screens and chose P1-4. Each close in
«Закриття» was a heading, a sentence and all its details — ten to fourteen
lines, twenty to a page — its difference not set apart, a day nobody closed
a bare line. The owner needs «where it did not add up, and why» in ten
seconds, as a notebook's page is leafed through.

## What exists now

- **A row a close:** «20.10 · Оля» with what it came to as a pill under it
  — «Нестача 50,00 грн» and «Надлишок 350,00 грн» a warning's, «Збіглося»
  the accent's, «Перший підрахунок» plain, one column down the list — and
  under them «20:14 · порахували 2 000,00 · мало бути 2 050,00», «·
  причину не вказано», «· пояснено +50,00».
- **A day nobody closed:** «19.10» and «Не закрито», a row of its own under
  the close it went into.
- **A close tapped:** all of it, as its result showed it, read again by its
  id — the figures large, the card and the transfer, the days nobody
  closed, the reason, the period's cash and what explains the difference;
  a first count by that name; «← Закриття» back to where the list was, the
  row tapped in hand.
- **«← Каса»** where «До каси» was.

What is sent, the money and the rules are unchanged; nothing is summed
here; no backend change, no migration.

## Decided here, not by the owner

- **The screen,** from the task list: to be approved from the
  [screenshots](../../output/verification/2026-10-22-cash-history/screens/).
- **The pill under the day,** one column down the list, the figures the
  row's whole width: on the right of the row at 360 px it squeezed them
  into six lines, and beside the day it wrapped for some names and not
  others.
- **A close tapped shows the same body as the close's result** — one
  component for both, so they cannot drift apart.
- **The close tapped is read again by its id** (`GET /cash/closes/{id}`),
  as it is now; **back, the list is where it was left** and the row tapped
  has the focus.
- **«пояснено» in a row only where the close says «Пояснено»:** where
  there is a difference.
- **A first count read back** is headed «Перший підрахунок 11.09» and
  leaves out «З цієї суми почнемо наступного разу» — true only when it was
  just counted.

## How it was built and proven

- **`cash-history.spec.ts` (new, stubbed, the owner):**
  - at 360×640: «20.10 · Оля», its figures with «причину не вказано», and
    «Нестача 50,00 грн» a warning's; «19.10» and «18.10» «Не закрито» in
    plain pills, newest first; «17.10 · Марко» with «пояснено +50,00» and
    «Надлишок 350,00 грн» a warning's; «16.10» «Збіглося», a way fixed
    against it not said; every pill in one column; nothing wider than the
    phone;
  - a close tapped: its heading focused, when and who, «Мало бути»
    2 000,00 and «Порахували» 2 350,00 large, «Надлишок 350,00 грн», the
    reason, the period's cash, «Пояснено: +50,00 грн. Не пояснено: 300,00
    грн.»; «← Закриття» back; a close sixteen rows down opened and left,
    the list where it was and that row focused; another close's days
    nobody closed, and its reason as read again by its id — written since
    the list was read;
  - twenty to a page asked and shown, «Показати ще» for the twenty-first —
    «Перший підрахунок», plain, «порахували 1 000,00» — and no more; it
    tapped: «Перший підрахунок 11.09», nothing of «наступного разу»;
  - both themes at 4.5:1: the rows and every pill, with screenshots.
- **`cash.spec.ts`** (the real API): the owner's day — a row's figures and
  «Нестача 50,00 грн»; the first count; tapped, the figures and the reason;
  cash taken out late against that close, and the row then «пояснено
  −50,00», tapped «Пояснено: −50,00 грн. Не пояснено: 0,00 грн.».
- **Related journeys:** 283 — «Каса» and its screens, the receipt, the
  report, debts, the outage and its paper, failures, returns, outside text,
  the till and its sections — passed with it, on a heavily loaded Mac;
  one more, a debts journey, raced the returns list there and is fixed in
  #123, beneath this branch.
- **Mutation:** 20 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 20 caught
  ([`mutants.txt`](../../output/verification/2026-10-22-cash-history/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that the close's result renders as before through the shared
body, that the tapped close shows everything the old details did and
more, that paging, dedupe and the failed page are unchanged, that nothing
is summed, the words of the task, the stubs' fields and the access
(`report:view_financial`). It found, all addressed before the first
commit:
- **An open close could vanish, and later open by itself:** it was looked
  up among the list's pages, which are read again on focus or after any
  drawer command; a close shifted off the loaded page closed the screen,
  and «Показати ще» reopened it untapped. Now read by its id.
- **A row said «пояснено» where the close says nothing** — a close to the
  kopeck, or a first count, with a way fixed against it later. Now as the
  close.
- **Back, the focus fell to the page's top.** Now on the row tapped.
- **The pill sat right for some rows and wrapped under the day for
  others,** a ragged column; the days nobody closed out of line. Now one
  column under each day.
- **A first count read back said «З цієї суми почнемо наступного разу»**
  and was headed «Закриття». Now «Перший підрахунок», without it.
- **Stubs the server cannot produce** (a surplus «explained» by cash taken
  out, the explained and unexplained not adding up, a first count dated
  among later closes), **two dead helpers** and the docs' «read as it is
  now» before it was: corrected.

Not changed: «мало бути —» for an expected sum below nothing, as the
close's figures already say it.

## Evidence

- [`output/verification/2026-10-22-cash-history/`](../../output/verification/2026-10-22-cash-history/):
  `mutants.py`, `mutants.txt`, and `screens/` — the list and a close
  tapped, light and dark.
- **CI, run locally at `f0b1751`** (on #123's `23dcac5`;
  [summary](../../output/verification/2026-10-22-cash-history-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 461 on PostgreSQL 17;
  - e2e: 532 journeys;
  - hot path: worst p95 90.4 ms (the search by six sellers) and 68.6 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.
  - The run before it, at `044c572` on main, failed on the advisory #123
    fixes, and — on a Mac at a load of 14 — on that debts journey, two
    timing tests and a step of the restore drill, all passing since.

## Not covered here

- **On a real phone:** leafing through a year of closes, Telegram's own
  scrolling under the list.
- **Next:** «Каса»'s P2 tasks.
