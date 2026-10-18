# «Борги»: a debt found by each word, and refusals in their own words — 2026-10-18

Baseline: `370e2c6` (a payment's result and a payment kept unconfirmed, PR
#108).
Status: built, reviewed and proven: the whole CI run locally passed, and
fourteen of fourteen ways of breaking it caught. Not yet tried on a real
phone.
Branch: `feat/credits-words-refusals`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P1-3, P2-2. Owner: business-rules.md, "«Борги»: three readings after #108,
and what next" (2026-10-18).

## Why this was next

After #108 the owner kept the result's button by the customer's name and
every good on the debt alone, kept the sentence a screen reader hears as it
was, and chose the two quick tasks left without a question:
- **The search read a name as one string:** «Оксана Петренко» was found,
  «Петренко Оксана» and «Оксана  Петренко» (two spaces) were not — where
  the till and «Повернення» read each word. A customer who gives the
  surname first was told nothing was owed.
- **A refusal with nothing more than a conflict or a request refused** fell
  to the words every screen shares: «Дані змінилися або команда конфліктує
  з попередньою. Оновіть замовлення.», «Перевірте дані та поточний статус
  замовлення.» — of an order, to someone taking a payment; a kept one the
  same, though nothing proved it unrecorded.

## What exists now

- **A debt found by each word of a name** (P1-3), on the server: each word
  typed, literally, in any order and letter case, in the name of one debt;
  two spaces, or a space pasted from a contact, part two words as one
  does. «петренко
  оксана» finds «Оксана Петренко»; «о%а» finds nothing, «%» a letter typed.
  The customer found is shown with all their debts; a query written as a
  phone, the other stores' debts by a whole number, the pages and the
  rights are as they were. No migration: the store's index narrows the
  debts first, and the words filter them (`search-plan.txt`).
- **Refusals in the debt's words** (P2-2):
  - as pressed — proven unrecorded: «Внесок не записано. Дані боргу
    змінилися, поки ви працювали: перевірте залишок і спробуйте ще раз.»,
    «Внесок не записано. Перевірте суму й спробуйте ще раз.»; a write-off
    «Списання не записано. …», «Перевірте причину й спробуйте ще раз.»;
    the debt read again after it, as before;
  - kept, not proven unrecorded — never «спробуйте ще раз»: «Внесок ще не
    підтверджено: сервер відповів, що дані змінилися. Перевірте результат
    ще раз — двічі він не запишеться.», or «… сервер не прийняв запит. …»;
    a write-off «Списання ще не підтверджено: … двічі воно не запишеться.»,
    which before would have been called «Внесок», and «Перевірити
    результат списання» under it;
  - kept, proven unrecorded: «Внесок не записано. Дані змінилися, поки
    сервер не відповідав. Відкрийте борг у «Боргах» і спробуйте ще раз.»,
    or «Сервер не прийняв запит.» in its place; a write-off's never read,
    for one render, as «Внесок не записано», as it was before, aloud;
  - any other answer to a kept one — a server's error, a request it could
    not find — and the other reads of «Борги» keep the words they had.

What is sent, the money and the rules are unchanged.

## Decided here, not by the owner

- **Words of two debts of one customer do not add up:** each word is in the
  name of one debt, as the task list says and the returns' search does.
- **A write-off's request refused says «Перевірте причину»,** where the
  task list gives the payment's «Перевірте суму»: a write-off has a reason,
  not a sum.
- **A kept one's request refused** says «сервер не прийняв запит», as a
  return's does; the task list names only the conflict.
- The words wait for the owner's confirmation at hand-over, as the task list
  asks.

## How it was built and proven

- **Backend** (`test_customer_credit.py`, on PostgreSQL): «петренко
  оксана», «Оксана  Петренко», «ПЕТРЕНКО», «оксана оксана» find «Оксана
  Петренко»; «окс петр» finds both her and «Петро Оксанюк», «оксана петро»
  neither; «о%а» and «о_сана» nothing; «ірина коваль» not the customer
  whose debts are «Ірина» and «Коваль», and «коваль» that customer with
  both; «Оксана 067» nothing; the list of debts reads the same words. The
  other stores' search by a name still refused (`test_store_states.py`).
  A space pasted from a contact parts two words.
- **The query's plan** on the isolated E2E database, one word and two:
  the store's index, then the words as a filter, 0.1 ms
  (`search-plan.txt`).
- **`credits-debt.spec.ts`** (stubbed): a payment and a write-off refused
  with a bare 409 and a 422 — four journeys, each its exact words, the
  debt's screen never saying «замовлення».
- **`outage.spec.ts`**: four kept ones — a payment's conflict and a
  write-off's request refused, not proven unrecorded, still unconfirmed
  under their own headings, each asked about by its own name; a payment's
  conflict and a write-off's request refused, proven unrecorded, settled —
  each its exact words, said once, and every alert drawn, recorded as it
  is drawn, its own words alone, five times over.
- **Mutation:** fourteen ways of breaking it, one at a time, each against
  the tests meant to catch it, after the unchanged tree passed: all caught
  — the search's three, the refusals' nine, and the two the review found
  (`output/verification/2026-10-18-credits-words-refusals/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found no blocker: the search's words literal, never empty, in one
debt's name, the other stores' debts still out of reach by a name, the
phone's search as it was; refusals as pressed told to try again only when
the server refused the request outright; kept ones not proven unrecorded
never, for a conflict or a request refused; the words agreeing with their
nouns. It found the following, all addressed before the first commit:
- **A kept write-off was still asked about as «Перевірити результат
  внеску»:** it says «списання» now.
- **A kept write-off refused as recording nothing was read, for one render,
  as «Внесок не записано …»** — an alert, said aloud — before its own words:
  the refused command's kind was drawn after the store's error. Recorded on
  every one of five runs before; the kind is drawn first now, and a journey
  records every alert as it is drawn.
- **The rules said more than was built:** «never told to try again» and
  «never an order's words» hold for a conflict or a request refused, for a
  payment and a write-off; other answers and reads keep their words, and
  the rules say so now.
- **Smaller:** two doc comments out of their order; a test of a word typed
  twice that proved nothing of how it is looked for, now said as it is; no
  test of a space pasted from a contact, now one; the till said to find a
  sale, where it finds a model.

**For the owner,** not decided here:
- the words the task list did not give: a write-off refused for its request,
  «Перевірте причину й спробуйте ще раз.»; a kept one's request refused,
  «… ще не підтверджено: сервер не прийняв запит …», and proven unrecorded
  «… Сервер не прийняв запит. Відкрийте борг у «Боргах» і спробуйте ще
  раз.», where a return says «Перевірте, що повертають, …»;
- a customer whose debts are written «Ірина» and «Коваль»: found by «Ірина
  Коваль», or, as now, not;
- whether «Марʼяна» finds «Мар’яна» and «Мар'яна» — the apostrophes — and a
  Latin «i» the Cyrillic «і», as the catalogue's check of a similar name
  treats them;
- a kept payment, write-off or return answered with a server's error: its
  words say «Спробуйте ще раз», meaning to check again — or «ще не
  підтверджено» words of their own.

## Evidence

- [`output/verification/2026-10-18-credits-words-refusals/`](../../output/verification/2026-10-18-credits-words-refusals/):
  `mutants.py`, `mutants.txt`, `search-plan.txt`.
- **CI, run locally at `4771bbd`** ([summary](../../output/verification/2026-10-18-credits-words-refusals-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 456 on PostgreSQL 17;
  - e2e: 447 journeys;
  - hot path: worst p95 90.0 ms (the search by six sellers) and 106.2 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** nothing here changes what is seen but words.
- **A kept command whose request's shape is refused** — before the server
  looks for the command — is answered so on every check, and keeps the app
  blocked: as before, and as a return's.
- **The rest of the task list:** P1-1 (В2), P1-4 (В3, «Борг із зошита»
  waits in the backlog), P1-5 (В4), P2-1, P2-3, P2-4, P2-5.
