# ADR-0020: Requests per person

Status: Accepted (2026-10-10). Built on `feat/per-person-limit`; see the
[report](../project-memory/per-person-limit-report.md).
Owner decision: business-rules.md, "requests per person" (2026-10-10).
Extends: ADR-0010 §2 (the sign-in limit per address). Closes: the risk
register's "signed-in requests are not limited per person".

## Context

Only signing in was limited (30 a minute per address). Once signed in, a
person's token could ask without end, and one process serves the API. Most
requests are cheap. A few parse text on the event loop: a catalogue decision
or preview, up to about 70 ms for a hostile 2 000-character line, and an
opening list's file, 0.25–0.33 s for 1 000 lines. So one seller's token, or
one stolen, could keep the API busy for every shop.

Measured on 2026-10-10, with every request the app made in the 265
end-to-end journeys counted by its person:
- the busiest journey makes 51 requests, in 2 s;
- the busiest makes 7 heavy ones;
- an opened app asks about 30 at once;
- the whole run, as one person at a machine's speed (265 journeys in 3
  minutes), peaks at 35 a second, 231 in 10 s and 817 in a minute.

Replayed through token buckets, no single journey starting from a full
bucket was refused at 120 a minute, nor its heavy requests at 10.

## Decision

1. **Every signed-in request counts against its person** (owner,
   2026-10-10): one bucket per person, on all their phones together, the
   owner's included.
   - The person is the session token's `sub`, with its session epoch, read
     before the database is asked anything, so a refusal costs an HMAC and
     no query. Every phone of a person shares the epoch; ending their
     sign-ins (`scripts.people sign-out`) raises it, and their next sign-in
     starts a new bucket, so a stolen token that keeps the old one empty
     does not keep them out.
   - **300 at once, refilled at 300 a minute.** That is six times the
     busiest journey's whole count, and 5 a second for as long as it lasts.
2. **The heavy requests count twice:** in that bucket and in one of their
   own, **20 at once, refilled at 20 a minute**. They are the requests that
   parse a file or a catalogue line, or approve a list:
   - `POST /catalog/match-decisions` and `POST /catalog/match-preview`;
   - `POST /snapshots`;
   - `POST /snapshots/{id}/parts`;
   - `POST /snapshots/{id}/approve`.

   They take `HeavyScopeDep`; a test names them, so a new one is added on
   purpose.
3. **The refusal:** 429, code `TOO_MANY_REQUESTS` (not `RATE_LIMITED`, which
   the app reads as a sign-in's), with `details.retry_after` and
   `Retry-After` in whole seconds.
   - The app says «Забагато дій за короткий час. Зачекайте N с і
     повторіть.».
   - A new command so refused was never recorded: the journal lets it go,
     and the person does it again.
   - A command already kept on the phone, whose first sending may have been
     recorded, stays kept, and is checked again later, as after an outage
     (owner, 2026-10-10).
4. **The refusal's text never says «не записано».** A kept operation's
   banner tells the seller to type it from paper only when the app says
   those words. A resend refused here proves nothing about the first
   sending, so the text does not say them. The owner chose a text with the
   wait time; the words «нічого не записано» in the example they were shown
   are left out for this reason, and put to the owner as a reading. A screen
   that knows its command was new may still say it, truly: a stock
   correction adds «Нічого не записано.» to every refusal of a new one, and
   keeps the count to send again. Adding a file keeps its command too.
5. **The server's log only** (owner, 2026-10-10): `person.rate_limited`,
   with the person's id, `requests` or `heavy`, how many were refused and
   the wait. A person's first refusal is written at once; the ones after it
   in its minute, as one line with their count, once that minute is over
   (by the next request anyone makes). The general `domain_error` line is
   not written for this refusal. uvicorn's access line is, for every
   request, as before: a flood of any request, signed in or not, still
   turns over Docker's 50 MB of the API's log. The bot says nothing.
6. **Raised only for the journeys and the hot path,** each of which acts as
   one person far faster than anyone works. The hot path still takes the
   limit on every request, so its cost is in the figures. A server keeps the
   defaults; compose passes no setting for them.

## Consequences

- **A stolen token can spend its person's budget,** and the person is
  refused with it until the bucket refills. The owner chose one limit per
  person; ending the person's sign-ins (`scripts.people sign-out`) ends
  the stolen token, and the person's next sign-in counts in a new bucket.
- **The buckets live in the API's memory.** A restart forgets them, which
  only lets people in.
- **A kept operation refused when checked** keeps the till blocked until it
  is checked again, as any unknown outcome does.
- **Requests without a session** are not counted here: a forged token fails
  its signature before any bucket; signing in has its own limit.

## Rejected

- **Per sign-in rather than per person:** a person with a few sessions, or
  whoever steals more than one, would have more than one budget.
- **One bucket with costs per route:** the five heavy routes are few and
  plain; a second bucket says what they are.
- **Telling the owner in Telegram:** not wanted (owner, 2026-10-10).
- **Retrying by itself after the wait:** the journals never resend in a
  loop (ADR-0013); a person repeats, or checks again.
