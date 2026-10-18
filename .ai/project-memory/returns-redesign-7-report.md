# A kept return learned without the right, and its own words for a request not taken — 2026-10-18

Baseline: `a2c64af` («Повернення»'s task list closed, PR #104).
Status: built, reviewed and proven: the whole CI run locally passed, and
ten of ten ways of breaking it caught. Not yet tried on a real phone.
Branch: `feat/returns-kept-without-right`. Owner: business-rules.md,
"«Повернення»: two readings after #104, and what next" (2026-10-18).

## Why this was next

After #104 the owner answered its two readings. A phone keeps a return
whose answer it never heard, and holds its till until it learns the
outcome (ADR-0013). Were its person's right to take returns taken away
meanwhile, the server refused the resend before looking it up (invariant
I13): the phone could never learn it, and its till stayed held for good.
And a kept return still unconfirmed, refused as a request the server could
not take, said «Перевірте дані та поточний статус замовлення.», an order's
words.

## What exists now

- **A return learned without the right** (owner, 2026-10-18): whoever
  recorded it is answered what it recorded, and the phone shows its result
  over the till, «Повернення записано один раз», with what to give back if
  nobody did; nothing recorded under it, the server says so, and the phone
  says «Повернення не записано. Немає доступу до цієї операції або складу.
  Зверніться до менеджера.» and frees the till. A new return without the
  right is refused, as before.
- **A request not taken, its own words** (owner, 2026-10-18): a kept return
  still unconfirmed says «Повернення ще не підтверджено: сервер не прийняв
  запит. Перевірте результат ще раз — двічі воно не запишеться.», and stays
  kept.

Nothing about money or stock changes; no migration.

## Decided here, not by the owner

- **Only whoever recorded the return, for the very request that recorded
  it,** is answered without the right. Anyone else's is refused, never
  answered its success nor told that nothing was recorded; the same
  request changed is a conflict, as every replay's is.
- **A store the person no longer belongs to, or one that does not trade,**
  refuses as before: its kept returns wait until it trades again (owner,
  2026-10-08).
- **The warehouses' access is passed over with the right** for such an
  answer, which moves no goods. A person who still may take returns, but
  whose store no longer reaches the warehouse, stays held as before (a
  reading for the owner, below).
- **A first sending still running is waited for:** the resend claims the
  key first and is given that sending's answer, never «nothing recorded»
  while it may still record. The claim is never committed: nothing is
  written for such an answer.
- **A key of one person sent by another** is a conflict, as it is to
  anyone, not a refusal of the right.

## How it was built and proven

- **The server** (`refunds.own_refund`, the router's branch for whoever
  lacks `sale:refund` where the return is taken):
  - `test_refund_command.py`: once only `sale:refund` is taken away, the
    return is answered as first given, cached and durable, with a typed
    reason trimmed as when recorded; the same command with another request
    is a conflict, without `refund_id`; a new return is refused
    `PERMISSION_DENIED` with `recorded: false`; no key, audit entry,
    return or movement is added by any of it. Someone else who may not
    take returns is not given it, cached or durable, nor `recorded`. A
    blocked store answers `STORE_NOT_TRADING`, and a store no longer theirs
    `FORBIDDEN_STORE`, neither with `recorded`.
  - The first sending still running: a real request with the right, held
    at the store's lock after claiming its key; the resend without the right
    waits behind that key, a lock wait PostgreSQL itself reports, and is
    answered what the first recorded.
  - `test_returns_elsewhere.py`: a return taken at another store, its intact
    part to a warehouse chosen there, its damaged part to that store's
    «Брак», a reason typed, answered whole to its person without the right;
    a new one without the right says it recorded nothing.
  - `test_outage_mark_returns_payments.py`: a return typed from paper, its
    person's role then without `sale:refund`, answered as recorded, its
    mark and all; a new one refused with `recorded: false`.
- **The phone** (`outage.spec.ts`, stubbed): a kept return on a phone whose
  person may not take returns, answered as recorded — its result over the
  till, the banner gone, the attempt cleared, the till free, no
  «Повернення» and no «Немає права»; refused with `recorded: false` — «Повернення
  не записано. Немає доступу …», the attempt cleared, the till free; refused
  without `recorded` — still kept, the till held. Still unconfirmed and
  refused for a conflict, then as a request not taken — each in its own
  words, kept, sent once, no word of an order.
- **Mutation:** ten ways of breaking it, one at a time, each against the
  tests or journeys meant to catch it, after the unchanged tree passed: all
  caught on the first run
  (`output/verification/2026-10-18-returns-kept-without-right/`) — the
  right asked before the lookup again; anyone's return answered; nothing
  recorded not said; someone else's said to have recorded nothing; another
  request answered as recorded; the paper's mark left out of the identity;
  the lines not normalized as a new return's are; a first sending still
  running not waited for; the key kept for an answer; a request not taken
  in the shared words.

## Review

An independent review of the change, on a snapshot, before the first
commit, found no blocker. It found people with the right, blocked and
archived stores, non-members and other organizations answered as before;
nothing written; the identity the same as a new return's; the phone
settling both answers over the till, and the owner's words exact. It found
the following, all addressed before the first commit:
- **A first sending still running** could have recorded after the resend
  was told nothing was: the key is claimed first now, and a journey of two
  real requests proves the resend waits for it.
- **Unproven:** no key or audit kept, every part of a return taken
  elsewhere, a reason typed, a store no longer theirs — proven now; the till
  free, or held, proven by the till's own controls.
- **The documents** said only the right was passed over, and that anyone
  else learned nothing of what was recorded: both corrected; the risk
  register now names what is still held; comments stating the old rule
  were brought up to date.

**For the owner,** not decided here:
- a kept sale, debt payment, delivery, stock correction or order's step
  whose person lost the right still holds that phone in that store until
  the right is back: whether they should be answered as a return is;
- a person who still may take returns, but whose store no longer reaches
  the warehouse, stays held, while one without the right is answered;
- «Повернення не записано …» said to someone without the right says
  nothing of money already handed back: whether it should say to give the
  paper to a manager;
- a first sending stalled before it even claims its key, for longer than
  the phone waits and the right is taken away meanwhile, may record after
  the resend was told nothing was (risk register): whether that is
  accepted.

## Evidence

- [`output/verification/2026-10-18-returns-kept-without-right/`](../../output/verification/2026-10-18-returns-kept-without-right/):
  `mutants.py` and `mutants.txt`, ten ways of breaking it, all caught.
- **CI, run locally at `5006d6d`** ([summary](../../output/verification/2026-10-18-returns-kept-without-right-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 452 on PostgreSQL 17 (five new);
  - e2e: 399 journeys;
  - hot path: worst p95 92.7 ms (the search by six sellers) and 69.9 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** the result over the till in Telegram's own web view.
- **The rest of the kept operations** whose person lost the right, above.
- **A real revoked right end to end:** the phone's journeys stub the
  server's two answers; the server's are proven against PostgreSQL.
