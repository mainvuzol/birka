# Kept commands: the count across reopening, a confirmed step, a request not taken — 2026-10-21

Baseline: `c4dc47e` («Борги»'s task list closed, on #116's kept words, on
main with #113 and #114). This branch goes to main after them.
Status: built, reviewed and proven: the whole CI run locally passed, and
sixteen of sixteen ways of breaking it caught. Not yet tried on a real
phone.
Branch: `feat/kept-answers`. Owner: business-rules.md, "kept commands:
four readings after #113" (2026-10-21).

## Why this was next

The owner answered the four readings left by the kept words (#116), each as
recommended: «нехай перевірить» stays; the three «not found» are remembered
across Telegram reopening the app; an order's step the server confirmed
says its own words when its order cannot be read; a request the server did
not take says so. The last three change something; they are built here,
so #116 and the debts' branch stay as they were proven.

## What exists now

- **A kept command's «not found» count is kept beside it on the phone,**
  never in what is sent: a sale's, an order's step's, and every command of
  the shared journal. Reopened, the check the phone makes by itself counts
  on from where it was, so the third in a row asks for a manager whatever
  Telegram did meanwhile. A count that is not one is none; the command is
  read as ever.
- **A kept command answered that the server did not take its request** —
  a 400, or a 422 the shared words would answer with an order's «Перевірте
  дані та поточний статус замовлення.» — says «… ще не підтверджено: сервер
  не прийняв запит. Перевірте результат ще раз — двічі … не запишеться.»,
  as a kept payment's did.
- **An order's step the server confirmed, whose order cannot be read
  after,** says «Операцію «Відправлено» записано. Замовлення не вдалося
  показати — натисніть «Оновити результат».», with the request's number
  for a server's own failure, never «Спробуйте ще раз»; an answer with
  words of its own — out of reach, a session ended, too many requests —
  keeps them.

What is sent, the money and the rules are unchanged.

## Decided here, not by the owner

- **«натисніть «Оновити результат»»,** where the owner's option read
  «оновіть список замовлень»: the step's banner holds the screen until its
  own button reads the order. To be confirmed.
- **A 422 the shared words call «перевірте дані»** is a request not taken
  too; a 422 with words of its own keeps them. A request's number is said
  for a server's own failure only, as before.
- **The count is written only beside the very attempt it counts,** never
  over another command still unsettled; a phone that cannot write keeps it
  for the session.
- **Not changed:** a sale the server answered whose reading alone failed
  keeps the shared words — the owner was asked of an order's step.

## How it was built and proven

- **`outage.spec.ts`:**
  - a kept sale: «not found» on opening and by its button; kept beside the
    sale as 2, never in what was sent; reopened, the phone's own check is
    the third — a manager; every send the same, byte for byte, under one
    key;
  - a kept payment, the shared journal's: the same across reopening; then
    a count on the phone written as text, «3» — none, the payment read as
    ever, no «cannot be read»;
  - a kept order's step with two «not found» counted on an earlier visit:
    its check on opening is the third — a manager; 3 on the phone;
  - a kept sale answered 400 — «… сервер не прийняв запит …», no number;
    then 422 — the same; then 422 for the customer's phone — its own words;
    still kept;
  - a kept payment answered 400 — «… сервер не прийняв запит …»;
  - an order's step answered, its order unread for a server's failure —
    «… записано. Замовлення не вдалося показати — натисніть «Оновити
    результат».» and the request's number, no «Спробуйте ще раз»; read
    again and refused as too many — «Зачекайте 30 с»; with the server out
    of reach — the outage's words.
- **Related journeys:** 234 of the kept commands' specs — the outage, the
  drawer, debts, orders, failures, paper, returns, stock, stocktake, the
  till, suppliers, stores and the catalogue — passed with it.
- **Mutation:** sixteen ways of breaking it, one at a time, each against
  the journeys meant to catch it, after the unchanged tree passed: all
  caught. A first run, before the review's fixes, caught fourteen of
  fourteen; the fixes reshaped three and added two
  (`output/verification/2026-10-21-kept-answers/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found no blocker: the count never in what is sent, nor written
over another command; no count of one command reaching another; no effect
re-sending on a new attempt object; the reopening in the journeys a real
one. It found the following, all addressed before the first commit:
- **A confirmed step's words hid every other answer** — a session ended, a
  closed store, «зачекайте N с» — and the request's number: they replace
  the shared words alone now, the number kept; a journey answers 429.
- **The rules said the suppliers', invoices', stores' and models' count is
  read back:** it is now; and the rule of 2026-10-20 is marked superseded.
- **Smaller:** the request's number taken from the shared words only when
  they are the server's failure's; the till's journal's setter keeping a
  saved count, as the orders'; a count past 999 kept as 999, not dropped;
  every resend after reopening proven the same, and a 422 of its own words
  proven to keep them.

**For the owner,** not decided here:
- «натисніть «Оновити результат»», where the option read «оновіть список
  замовлень»;
- «не прийняв запит» for a 422 the shared words would call «перевірте
  дані», where the answer named a 400 — an order's step's 422 among them;
- a request the server refuses again and again (after an update, say)
  begins the count each time and never sends anyone to a manager, while
  the phone waits: a manager after so many «не прийняв запит» too?

## Evidence

- [`output/verification/2026-10-21-kept-answers/`](../../output/verification/2026-10-21-kept-answers/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `2ec65ce`** ([summary](../../output/verification/2026-10-21-kept-answers-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 458 on PostgreSQL 17;
  - e2e: 480 journeys;
  - hot path: worst p95 97.6 ms (the search by six sellers) and 110.4 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** Telegram closing and reopening the app between
  checks.
- **A phone whose storage refuses the count:** kept for the session, as
  before; no journey fills the storage.
