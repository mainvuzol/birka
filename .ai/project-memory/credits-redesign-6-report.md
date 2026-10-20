# «Борги» at the till: what a number already owes — 2026-10-19

Baseline: `aba7e77` (PR #110, merged while this was built; its tree is
`cee27af`'s, which this branch was begun on).
Status: built, reviewed and proven: the whole CI run locally passed, and
twelve of twelve ways of breaking it caught. Not yet tried on a real phone.
Branch: `feat/credits-till-debt-line`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P1-5. Owner: business-rules.md, В4 (а) of 2026-10-18; rules as built, "«Борги»
at the till: what a number already owes (P1-5)".

## Why this was next

Asked to go on as recommended once #110 was opened. In the notebook a
seller remembers «ця вже винна»; Бірка knew, and said nothing at the till:
- **Ticking «Оплата частинами»** opened two lines of explanation, «Покупець
  забирає товар зараз, решту доплачує, коли зможе. Внески приймає лише цей
  магазин, у розділі «Борги».», above the till's own two.
- **A number that already owes this store, or had a debt written off,**
  was taken in parts again with nothing said; the owner keeps a written-off
  debt's customer three years, so that whom not to sell to in parts again
  stays visible.

## What exists now

- **Under «Телефон покупця», once it holds a whole number,** however
  written or pasted, one line from the same read as «Борги», this store's:
  - «За номером уже винні 2 000,00 грн», in the debt's colour — the
    server's sum, said before any write-off;
  - «За номером борг списано 12.03.2026», neutral, when nothing is owed
    and a debt was written off — the latest;
  - nothing for a new number, one only paid off, or when «Борги» cannot be
    read: the sale as any.
  Only for the number in the field, and only that very number's customer.
  A digit changed, the line goes at once; never an answer from before a
  sale in parts. Its room is kept once the number is whole: nothing below
  moves when it comes. It forbids nothing and slows nothing: the seller
  decides. The same at «Клієнт забрав», asked of the order's store.
- **What paying in parts means, in one line:** «Решту — у «Боргах» цього
  магазину.», at the till and at «Клієнт забрав»; «Лишиться винен …» as it
  was.

What is sent, the money and the rules are unchanged; no migration.

## Decided here, not by the owner

- **«Решту — у «Боргах» цього магазину.»,** where the task list gives
  «Решту покупець доплачує в «Боргах» цього магазину.»: at 360 px the
  till's column holds 262 px, and that line takes 346 — two lines, where
  the task list asks for one. The order's «… магазину замовлення» the same;
  an order is this store's, as its words before said.
- **«За номером …», where the owner's В4 example reads «За цим номером …»:**
  at 360 px that line takes 268 px of 262 in bold, a six-figure sum 285,
  the write-off 271 — two lines, where В4 asks for one; «За номером …»
  takes at most 255, right under the phone it speaks of.
- **The line's room is kept once the number is whole,** a line under the
  phone even for a new number: nothing moves under the finger.
- **A debt owed is said before one written off;** only the latest write-off
  is dated; a debt only paid off says nothing.
- **Read once the number is whole and settled,** a third of a second after
  the last digit, as «Борги»'s search.

## How it was built and proven

- **`credits.spec.ts`** (real API, the till at 360 px):
  - a new customer: the explanation in one line; «Борги» asked for the
    number and nothing said; «Лишиться винен 2 000,00 грн»; the sale's
    terms as they were;
  - a number owing 2 000,00 грн, written down as «+38 …» and typed another
    way: the line with the server's sum, in the debt's colour, one line,
    the sum's field not moved by it; another digit — the line gone at once;
    the debt's first ten digits — read, and nothing said; part of a number
    — not even asked; the sale in parts goes on, its terms as typed; the
    older debt then paid off elsewhere, the same number's next sale in the
    same app — 2 000,00 грн, every text the line took recorded as it was
    drawn, never the 4 000,00 грн read before;
  - «Борги» answering 123 456,00 грн owed and a debt written off: what is
    owed, on one line at 360 px; two write-offs and a later debt paid off:
    «борг списано 12.03.2026», the latest, neutral; «Борги» failing with a
    500: nothing said, and the sale recorded;
  - an order collected in parts: its explanation in one line; what its
    number owes, asked of the order's store.
- **Contrast:** the line owed is the debt's colour used throughout «Борги»,
  about 6.6:1 in either theme.
- **Mutation:** twelve ways of breaking it, one at a time, each against
  the journeys meant to catch it, after the unchanged tree passed: all
  caught. On the way, two checks were found to prove less than they said: a
  «digit less» of a «+38 …» number was still a whole number, and a sum
  kept from before showed for less than a check's interval — the first now
  types part of a number, the second records every text the line takes
  (`output/verification/2026-10-19-credits-till-debt-line/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found the read the same right as «Борги», this store's debts alone,
one request per number settled, nothing awaited by the sale, the text
heard when it comes, and the colours above 4.5:1. It found the following,
all addressed before the first commit:
- **The line moved the sum's field when it came,** a third of a second and
  a round trip after the last digit — under the pay panel, or under a tap
  aimed at it. Its room is kept now once the number is whole, and a
  journey checks the field does not move.
- **A number that merely held the digits typed was taken for it:** the
  first ten digits of a «+38 …» number found that debt. Only that very
  number's customer is said now, keyed as the server keys one.
- **An answer from before a sale in parts showed first** on the same
  number's next sale. It is never kept now, and «Борги» is read again
  after a sale or an order in parts.
- **Smaller:** tests that would have passed with the earliest write-off, a
  write-off before what is owed, the order's line not wired, or a long sum
  on two lines; the line not read with the phone by a screen reader; the
  dates sorted as text; the order's store taken from the screen, not the
  order; a comment on the wrong function.

**For the owner,** not decided here:
- «За номером …» for one line at 360 px, where В4's example reads «За цим
  номером …», and «Решту — у «Боргах» цього магазину.» for the task list's
  longer explanation;
- a number that owes now and had a debt written off: the line says what is
  owed only — whether it says the write-off too, which is the stronger
  "not in parts again", though tight on one line;
- a closed store's debt of this number, which the seller may read by the
  whole phone and whose payments are taken here: whether the till says it
  too.

## Evidence

- [`output/verification/2026-10-19-credits-till-debt-line/`](../../output/verification/2026-10-19-credits-till-debt-line/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `a68d034`** ([summary](../../output/verification/2026-10-19-credits-till-debt-line-ci-local/summary.md)),
  once rebased on #111, on the host's Node 24.18: every job passed, the
  backend with its declared gap.
  - backend: 3 457 on PostgreSQL 17;
  - e2e: 452 journeys;
  - hot path: worst p95 88.8 ms (the search by six sellers) and 70.0 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities;
  - restore drill, frontend and edge passed.
- **An earlier run, at `018f282`,** before the rebase, passed every job but
  python-audit, which found three advisories published on 2026-10-19 for
  `aiohttp` 3.14.3, a package this change does not touch; #111 moved both
  locks to 3.14.4, and this branch was rebased on it. The rebased commit
  differs from `018f282` by #111's files alone.

## Not covered here

- **On a real phone:** the line under the phone with the keyboard open.
- **The rest of the task list:** P1-4 (В3, «Борг із зошита» waits in the
  backlog), P2-1, P2-3, P2-4, P2-5.
