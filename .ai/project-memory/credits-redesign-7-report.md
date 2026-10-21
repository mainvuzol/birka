# «Борги»: a closed store's debt at the till, a letter in two parts, and an empty list that teaches — 2026-10-20

Baseline: `a16d198` (P1-5, the till's line of what a number owes, PR #112,
on #111's `aiohttp` 3.14.4). This branch goes to main after it.
Status: built, reviewed and proven: the whole CI run locally passed, and
fifteen of fifteen ways of breaking it caught. Not yet tried on a real
phone.
Branch: `feat/credits-closed-line-empty`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P1-4, and the owner's answers of 2026-10-19 on P1-5. Owner:
business-rules.md, "seven readings after #110 and P1-5, and what next"
(2026-10-19).

## Why this was next

The owner answered seven readings after #110 was merged. Four needed
nothing built; three did, and P1-4 was chosen with them. Two more — every
kept command's words for a server's error, and a manager after three «not
found» — come in the next change.
- **A closed store's debt of a number** was not said at the till, though
  this store takes its payments; the owner chose to say it, on a line of
  its own.
- **A name with «ї» or «й» pasted in two parts** — the letter and its mark
  — was not found by the letter typed as one.
- **An empty «Борги»,** in the first weeks, said «Зараз ніхто не винен цьому
  магазину.» and nothing more: neither where a debt begins nor a way there.

## What exists now

- **At the till, under «Телефон покупця»,** once the number is whole, the
  stores that do not trade are asked for it too — what is still owed there,
  as «Борги» asks them — and said: «Винні 1 500,00 грн магазину «Ринок»»,
  or «… магазинам, що не працюють» for more than one, in the debt's colour,
  on one line: the sum first, a long name cut. Both answers are waited for,
  so the lines come together — this store's line a moment and a half at
  most, and not once the closed stores fail. Alone, it stands in the line's
  room; beside this store's debt — rare — it is a second line.
- **A letter pasted in two parts is the letter** in the debts' search: the
  name stored and the words typed are compared in one form (NFC), after the
  apostrophes and the Latin «i» are folded — a Latin «i» and its dots is
  «ї» too.
- **An empty «Борги»:** «Зараз ніхто не винен. Борг з’являється, коли
  продають частинами.», and «Новий продаж» to the till's search for whoever
  may sell there, held while a kept command waits.

What is sent, the money and the rules are unchanged; no migration.

## Decided here, not by the owner

- **«Винні 1 500,00 грн магазину «Ринок»», one line,** the sum first and a
  long name cut, where the owner's option read «У магазині «Ринок» за
  номером винні …» — at 360 px that, a six-figure sum, a long name or the
  plural take two lines in the till's column.
- **Both answers before either line,** so nothing comes in two steps; a
  closed store's debt beside this store's moves what is below by one line,
  once — rare, where reserving two lines for every number would cost the
  till's room each time.
- **«Новий продаж», not «До каси»:** «Каса» names the drawer in this app; the
  till is «Продаж». A search that finds nothing, the paid and written off
  asked for, and a store that does not trade keep their words.

## How it was built and proven

- **Backend:** «крайній» finds «Крайній» stored with «й» in two parts;
  «їжакевич», typed as one letter, in two parts, or as a Latin «i» and its
  dots, finds «Їжакевич».
- **`credits.spec.ts`** (the till at 360 px, «Борги» stubbed): this store's
  debt and a closed store's — two lines, «Магазину «Ринок» винні 1 500,00
  грн» the second, in the debt's colour, every text the line took recorded
  and never one line before the other, though the closed stores answer
  later; the closed stores asked by the whole number, for what is still
  owed; a closed store's debt alone — its line, one line; two closed stores
  of one name — the plural, one line; a long name and six figures — one
  line; the closed stores failing — this store's line; the closed stores
  five seconds slow — this store's line within three; every «nothing said»
  waited for both answers before it is checked.
- **`credits-list.spec.ts`:** an empty «Борги» says where a debt begins; a
  search that finds nothing says so instead, and the paid and written off
  asked for keep their words; «Новий продаж» opens the till, its search
  focused; for whoever may not sell, no button; a store that does not trade
  keeps its words, no button.
- **Mutation:** fifteen ways of breaking it, one at a time, each against
  the tests meant to catch it, after the unchanged tree passed: all caught.
  A first run caught fourteen: this store's line held until the closed
  stores' failure or the moment and a half passed — the check allowed five
  seconds; it wants the line within one now
  (`output/verification/2026-10-20-credits-closed-line-empty/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found the closed stores read with the same right as «Борги»'s own
search — by the whole number, what is still owed, less than «Борги» shows —
from a trading store only; the customer keyed as the server keys one; one
request more per number; NFC valid and changing no plan; the empty list
shown only where it should be. It found the following, all addressed before
the first commit:
- **The closed store's line often took two lines** — a six-figure sum, a
  longer name, the plural — so the room kept for one did not hold it, and
  the sum's field moved under the finger. It is one line now, the sum first,
  a long name cut, proven at 360 px for each.
- **This store's line waited on the closed stores:** a hang held it back
  for up to twenty seconds, and a failure was untested. It waits a moment
  and a half at most now, and not once they fail; journeys prove both.
- **Three «nothing said» checks proved nothing,** looking before the second
  answer came; they wait for both now.
- **A Latin «i» and its dots was not «ї»:** the one form came before the
  fold. It comes after now.
- **Smaller:** the empty list's kept words untested (now tested); stores of
  one name counted as one (counted by who they are now); «Новий продаж» not
  held while a kept command waits (held now, as the till's button); «з
  «Оплата частинами»» in the wrong case (now «коли продають частинами»);
  the rules saying a stored name changes (it does not).

**For the owner,** not decided here:
- the closed store's line: «Винні 1 500,00 грн магазину «Ринок»», one line
  and a long name cut, as built — or other words;
- a number whose debt here was written off but which owes a closed store:
  both lines, as built, or the closed store's alone;
- a Latin «ï» typed as one letter, from a Latin keyboard: «ї» too, as the
  catalogue reads it.

## Evidence

- [`output/verification/2026-10-20-credits-closed-line-empty/`](../../output/verification/2026-10-20-credits-closed-line-empty/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `cd2ad48`** ([summary](../../output/verification/2026-10-20-credits-closed-line-empty-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 458 on PostgreSQL 17;
  - e2e: 455 journeys;
  - hot path: worst p95 125.0 ms (the stock of every warehouse by six
    sellers) and 121.5 ms (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities;
  - restore drill, frontend and edge passed.

## Not covered here

- **Next:** every kept command's words for a server's error, and a manager
  after three «not found» (the owner's answers of 2026-10-19).
- **«Борг із зошита»** (В3 (а)) waits in the backlog: a new rule, server and
  migration.
- **On a real phone:** the till's lines with the keyboard open.
- **«Новий продаж» held while a kept command waits** is the till's own rule,
  passed through; no journey keeps a command to see it held.
