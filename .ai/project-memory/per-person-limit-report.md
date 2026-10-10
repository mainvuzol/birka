# Requests per person — 2026-10-10

Baseline: `519b264` (what the server is built from, merged as PR #82).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty ways of breaking it each caught. The text without «нічого не
записано» waits for the owner's confirmation.
Branch: `feat/per-person-limit`. Decision: [ADR-0020](../decisions/ADR-0020-requests-per-person.md);
owner: business-rules.md, "requests per person" (2026-10-10).

## Why this was next

On 2026-10-10 the owner chose two of the risks left before the public
domain that need neither a server nor a person: what the server is built
from (PR #82), then this one. The risk register said one seller's token
could keep the API busy: signing in was limited per address, but nothing
after it, and the catalogue parser runs on the API's one event loop.

## What the owner was asked

On 2026-10-10, after a map of how the app asks the server:
- **what the person sees:** a text with how long to wait; the action not
  done, and repeated; operations kept on the phone sent later;
- **who:** everyone the same, one limit per person on all their phones;
- **who hears of it:** the server's log only, not the bot.

## Measured

Every request the app made in the 265 end-to-end journeys, counted by its
person (the session token's `sub`), on 2026-10-10:
- the busiest journey: 51 requests in 2 s; 7 heavy ones;
- an opened app: about 30 at once;
- the whole run, as one person at a machine's speed: 35 a second, 231 in
  10 s, 817 in a minute.

Replayed through token buckets: no single journey starting from a full
bucket was refused at 120 a minute, nor its heavy requests at 10. The
limits are 300 and 20.

## What exists now

- **Every signed-in request counts against its person,** on all their
  phones together: 300 at once, refilled at 300 a minute. It is taken right
  after the session token is read, before any database query. The bucket is
  the person's at their session epoch: `scripts.people sign-out` gives them
  a new one, so a stolen token emptying the old one does not keep them out.
- **The heavy requests count in a bucket of their own too,** 20 at once and
  20 a minute: a catalogue decision or preview, and an opening list made
  from a file, a file added, a list approved.
- **The refusal:** 429 `TOO_MANY_REQUESTS`, `retry_after` and `Retry-After`
  in whole seconds. The app says «Забагато дій за короткий час. Зачекайте
  N с і повторіть.».
  - A new command so refused is let go, and the person does it again.
  - A command kept on the phone stays kept and is checked again later.
  - This holds for the sale, the order and catalogue commands, and every
    journal (receipts, returns, corrections and the rest), through one
    helper, `refusedOutright`. A file being added keeps its command too.
  - A stock correction, which knows its command was new, adds «Нічого не
    записано.», true of it, and keeps the count to send again.
- **The log:** `person.rate_limited`: a person's first refusal at once,
  the rest of its minute as one line with their count once the minute is
  over; not the general `domain_error` line for each. uvicorn's access line
  for every request stays.
- **CI** raises the numbers for the journeys and the hot path, each one
  person at a machine's speed; the hot path still takes the limit on every
  request.

## How it was built and proven

- **Server tests** (`tests/unit/test_person_limit.py`): the real app with a
  light and a heavy route of the test's own, the database's two questions
  about the person answered by stand-ins that count:
  - refused past the burst, before the database is asked;
  - one person on two phones shares one bucket, another person waits for
    nothing;
  - a sign-out gives the person a new bucket, while the old token is still
    refused before the database;
  - the refill, and each app counting on its own;
  - heavy requests in their own bucket and the general one;
  - a forged token takes nothing;
  - the first refusal logged at once, the rest counted once the minute is
    over, on a clock of the test's own;
  - the measured numbers;
  - every path the API has asked twice: exactly the five heavy ones refuse
    the second.
- **A journey** (`e2e/person-limit.spec.ts`):
  - a new sale refused shows the wait, blocks nothing, never says «не
    записано», and is sold again as a new sale;
  - a sale kept after a lost answer, refused when checked, stays kept and
    the till blocked, and the next check settles it with the same key;
  - a stock correction refused keeps its count, says «Нічого не записано.»
    with the wait, and is written when sent again.
- **Mutation:** twenty ways of breaking it, one at a time, each caught:
  seventeen first, three more after the review (below).
- **The text:** the example the owner was shown ended «— нічого не
  записано». That is left out, because a kept operation's banner reserves
  those words for typing it from paper. It is put to the owner as a reading
  (business rules).

## Review of the built change

An independent review (2026-10-10) found nothing wrong in the buckets' use
on the event loop, in which requests are limited (health, readiness, the
outage probe, signing in and the watcher's status are not; every signed-in
route is), in the five heavy routes (exactly those that parse), or in the
journals. It found, all fixed:
- **A sign-out did not help:** the bucket was the person's alone, so a
  stolen token, refused only after its bucket was taken, kept the person's
  new sign-in out for up to the token's 12 hours. The bucket is now the
  person's at their session epoch; a test signs out and asks again.
- **A flood that stopped hid its size:** only the first refusal of a
  minute was written, and the rest waited for the person's next refusal,
  which might never come. They are now written out once the minute is over.
- **"A flood cannot fill the log" was not true:** uvicorn's access line is
  written for every request. Said so instead.
- **Two screens:** adding a file forgot its command on this refusal (made
  harmless by the server's refusal of the same file twice), and a stock
  correction cleared the count it could send again. Both keep them now; a
  journey walks the correction.
- **The hot path's own run** would stop at the 300th request on a laptop:
  its instructions now raise the limit, as CI does.
- **A test froze the process's own clock** to time the log lines, and one
  relied on the real clock; both now use a clock of their own.

## Evidence

All under [`output/verification/2026-10-10-per-person-limit/`](../../output/verification/2026-10-10-per-person-limit/):
- `requests.jsonl`, `count-requests.md`: every request the app made in the
  265 journeys at `519b264`, by person, and how they were counted;
- `analyse.py`, `measured.txt`: the peaks and the replay through the app's
  own `TokenBucket`;
- `mutants.py`, `mutants.txt`: twenty ways of breaking it, each caught.
- **CI, run locally at `c516393`** ([summary](../../output/verification/2026-10-10-per-person-limit-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 329 on PostgreSQL 17;
  - e2e: 268 journeys, the limits raised as for one person at a
    machine's speed;
  - hot path: worst p95 73.5 ms (catalogue read) and 112.8 ms
    (`POST /sales`), within 300 and 500, the limit taken on every request;
  - restore drill, frontend, python-audit and edge passed.
- A first run at `6010035` lost the network for its two audits and one
  outage journey, which reads Chromium's own online state; the journey
  passed three times alone once the network was back, and the run above is
  whole.

## Not covered here

- **A stolen token spends its person's budget,** and the person is refused
  with it, until `scripts.people sign-out` ends the token and gives the
  person a new bucket.
- **uvicorn's access line** is written for every request, refused or not.
- **The buckets are in the API's memory;** a restart forgets them.
- **The heavy requests are a list in the code;** a new one is added on
  purpose, as the test says.
- **A refused query** (a list, a report) shows the same text where the
  screen shows its error; the journey walks the sale's two cases and a
  correction, the other commands share the helper.
- **The owner's confirmation of the text** without «нічого не записано» is
  pending.
