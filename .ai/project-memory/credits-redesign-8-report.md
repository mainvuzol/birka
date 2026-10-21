# «Борги»'s task list closed, and the owner's two answers after #112 — 2026-10-21

Baseline: `09ac3eb` (every kept command's words for a server's error, on a
closed store's debt at the till and an empty «Борги», on #112's merge);
rebased on #116 (those words) once #113 and #114 were merged. This branch
goes to main after #116.
Status: built, reviewed and proven: the whole CI run locally passed, and
eighteen of eighteen ways of breaking it caught. Not yet tried on a real
phone.
Branch: `feat/credits-finish`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P2-1, P2-3 and P2-4. Owner: business-rules.md, "«Борги»: three readings
after #112, and what next" (2026-10-21).

## Why this was next

The owner answered three readings after #112 was merged, each as
recommended: a closed store's line at the till stays as built; a number
written off here that owes a closed store says what it owes there, alone;
a Latin «ï» typed as one sign is «ї». The two that change something are
built here, not in #113, which stays as it was proven. Next, the owner
chose the task list's last three that wait on nothing: P2-1, P2-3, P2-4.
P2-5 waits on the bottom menu.

## What exists now

- **At the till,** a number whose debt here was written off and which owes
  a closed store says «Винні 1 500,00 грн магазину «Ринок»» alone, never
  «За номером борг списано …» — what is owed comes before what was
  written off, anywhere.
- **In the debts' search,** a Latin «ï» typed as one sign, or «Ï», is «ї»,
  typed or stored; nothing stored changes.
- **A kept payment or write-off on a phone whose person may no longer open
  «Борги»** shows its banner over the till, or whatever is open; «Борги»
  is not turned to, and «Немає доступу до боргів.» is said nowhere. The
  command stays kept, and the till held, until the right is given back, as
  before: the server refuses such a person before it looks the command up.
- **While «Борги» is read,** «Магазину винні» stands in its place, its sum
  and count grey, and three rows of a debt's shape under the field; a
  screen reader hears «Завантажуємо борги…». Nothing moves when they come.
- **A payment from paper's mark in a debt's history** is in the warning's
  colour, its words as they were. The pills were already by what they
  mean; now proven, with a debt, its history, its panel and a payment's
  result, at 4.5:1 in both themes, the meta at 14 px.

What is sent, the money and the rules are unchanged; no migration.

## Decided here, not by the owner

- **A write-off here waits for the closed stores' answer, or their
  failure,** however long, so it is never said and taken back; this
  store's own debt still waits for them a moment and a half at most.
- **A kept payment whose person lost the right stays held,** as before;
  unlike a kept return, which the owner chose to answer and free the till
  (2026-10-18). Asked of the owner, below.
- **«Борги» renders nothing without the right,** as «Повернення» does; the
  section's button is not shown to such a person, so it is not reached.
- **The card's place shows its label, «Магазину винні»,** its sum and count
  as grey lines whose sizing text is hidden, even where a phone forces its
  own colours. A summary that cannot be read leaves no place, so what is
  under it moves up once; a sum of seven figures takes two lines at 360 px
  and moves it down once.
- **The paper's mark in the history is coloured, not a pill:** it is a
  long line — who took it and when. «Покупця стерто» stays a name; pills
  stay 12 px, as in «Повернення».

## How it was built and proven

- **Backend:** «ïжакевич» and «ÏЖАКЕВИЧ» find «Їжакевич»; «ївга» finds a
  name stored as «Ïвга Король».
- **`credits.spec.ts`** (the till at 360 px, «Борги» stubbed): written off
  here, owing a closed store — its line alone, one line, every text the
  line took recorded: never «списано», with the closed stores answering
  in 0.4 s and in 2.5 s, past this store's moment and a half; owing
  nowhere, the closed stores slow — the write-off, once they answer.
- **`outage.spec.ts`:** a kept payment, and a kept write-off, on a phone
  whose person no longer holds `sale:credit` — its banner, the app's words
  for a refused right, the command kept; the till beneath it, held; no
  «Борги», no «Немає доступу до боргів». A kept payment of whoever may take
  payments still turns to «Борги».
- **`credits-list.spec.ts`:** «Борги» held while it is read — the card's
  place, hidden from a screen reader, its sizing text never seen, three
  rows' places with their round marks, the status heard; released, neither
  the field nor the first row moves; a screenshot of it. In the light
  theme and the dark, at 360 px: «Сплачено» in the accent, «Списано»,
  «Нічого не винні» and a closed store's «Магазин «Ринок»» neutral; a
  debt's sum, its history with a payment from paper in the warning's
  colour, its panel and a payment's result paying it off, each at 4.5:1 or
  more; the meta at 14 px; screenshots of the list, the debt and the
  result.
- **Mutation:** eighteen ways of breaking it, one at a time, each against
  the journeys or the test meant to catch it, after the unchanged tree
  passed: all caught. A first run, before the review's fixes, caught
  fourteen of fourteen; the fixes added four
  (`output/verification/2026-10-21-credits-finish/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found no blocker: the fold's two strings of one length, no index
on the name, «Ï» lowered by the cluster's ICU locale as the Cyrillic
letters are, the history's text unchanged for a screen reader, the
warning's colour at 7.2:1 and 8.5:1, no hidden signs. It found the
following, all addressed before the first commit:
- **The rules said a kept payment without the right behaves as a kept
  return:** only its banner's place does. It stays held, the till with it,
  as before this change; the rules say so now, and the owner is asked.
- **The till's write-off could be said and taken back** when the closed
  stores answered after the moment and a half, and a wait in the journey
  proved nothing: it waits for them now, and a journey answers them in
  2.5 s.
- **Nothing proved a kept payment still opens «Борги»** for whoever may
  take payments, nor a kept write-off without the right: both have
  journeys.
- **The card's place held figures made transparent,** which a phone that
  forces its own colours would show: they are hidden now.
- **The rules said a card that cannot be read moves nothing:** it moves
  what is under it once, and a sum of seven figures does; said now.
- **Smaller:** the theme journey's debts made ones the app can show; a
  docstring reflowed.

**For the owner,** not decided here:
- a kept payment or write-off whose person lost the right: answered to
  whoever took it and the till freed, as a kept return since 2026-10-18,
  or held until a manager gives the right back, as now — and if held, what
  the manager is told to do;
- «Магазину винні» that cannot be read: its place kept with a quiet line,
  or gone and the field moving up once, as now;
- a kept payment refused for the right: the app's «Немає доступу до цієї
  операції або складу. Зверніться до менеджера.», as now, or «Борги»'s own
  words.

## Evidence

- [`output/verification/2026-10-21-credits-finish/`](../../output/verification/2026-10-21-credits-finish/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `10f91a7`** ([summary](../../output/verification/2026-10-21-credits-finish-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 458 on PostgreSQL 17;
  - e2e: 475 journeys;
  - hot path: worst p95 141.2 ms (the search by six sellers) and 106.0 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.
  - A first run, at the first commit before the rebase, failed three jobs:
    the theme journey wrote the paper's time in Kyiv's zone where CI runs
    in UTC (it reads the phone's own zone now), and two advisories had made
    both audits fail on main, which #114 fixed.

## Not covered here

- **On a real phone:** the places while «Борги» is read, and the dark
  theme in Telegram's own colours.
- **«Борги» opened, then the right taken away while it is open:** it
  renders nothing, as «Повернення» does; the app reads a person's rights
  again only from «Магазини» or a stopped store's screen, so no journey
  reaches it.
- **«Магазину винні» that cannot be read,** and a sum of seven figures: the
  field moves once; no journey answers the summary with an error.
- **P2-5** («Борги» in «Клієнти») waits on the bottom menu, with
  «Повернення»'s P2-6.
- **«Борг із зошита»** (В3 (а)) waits in the backlog.
