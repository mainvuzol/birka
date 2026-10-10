# Requests per person — 2026-10-10

Baseline: `519b264` (what the server is built from, merged as PR #82).
Status: TODO(final).
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
  after the session token is read, before any database query.
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
    helper, `refusedOutright`.
- **The log:** `person.rate_limited`, once a minute per person, with how
  many were refused; not the general `domain_error` line for each.
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
  - the refill, and each app counting on its own;
  - heavy requests in their own bucket and the general one;
  - a forged token takes nothing;
  - the log once a minute with the count;
  - the measured numbers;
  - every path the API has asked twice: exactly the five heavy ones refuse
    the second.
- **A journey** (`e2e/person-limit.spec.ts`):
  - a new sale refused shows the wait, blocks nothing, never says «не
    записано», and is sold again as a new sale;
  - a sale kept after a lost answer, refused when checked, stays kept and
    the till blocked, and the next check settles it with the same key.
- **Mutation:** seventeen ways of breaking it, one at a time, each caught.
- **The text:** the example the owner was shown ended «— нічого не
  записано». That is left out, because a kept operation's banner reserves
  those words for typing it from paper. It is put to the owner as a reading
  (business rules).

## Evidence

TODO(final)

## Not covered here

- **A stolen token spends its person's budget,** and the person is refused
  with it; `scripts.people sign-out` ends both.
- **The buckets are in the API's memory;** a restart forgets them.
- **The heavy requests are a list in the code;** a new one is added on
  purpose, as the test says.
- **A refused query** (a list, a report) shows the same text where the
  screen shows its error; only the sale's two cases are walked by the
  journey, the other commands share the helper.
- **The owner's confirmation of the text** without «нічого не записано» is
  pending.
