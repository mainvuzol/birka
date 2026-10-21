# A kept payment answered to whoever lost the right, «Магазину винні» kept, a manager after three requests not taken — 2026-10-21

Baseline: `6d559a8` (main, with #119).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-one of twenty-one ways of breaking it caught. Not yet tried on a
real phone; four readings wait for the owner (Review).
Branch: `feat/credits-kept-right`. Owner: business-rules.md, "six readings
after #117 and #118" (2026-10-21).

## Why this was next

The owner answered six readings left by #117 («Борги»'s task list closed)
and #118 (a kept command's count), each as recommended. Two kept what was
built; four ask for something built:
- a kept payment or write-off of a person who lost the right held the till
  until a manager gave the right back — answered now as a kept return is;
- «Магазину винні» that could not be read left its place and moved the
  field;
- a kept payment refused for the right said the shared «Немає доступу до
  цієї операції або складу»;
- three requests not taken in a row asked for no one.

## What exists now

- **The server answers a payment or a write-off resent by whoever may no
  longer make it** with their own command's entry and the debt's sums now —
  no phone, no one else's entry — or refuses for the right saying nothing
  was recorded (`recorded: false`). The phone settles it either
  way, and the till is free: «Внесок записано один раз», or «Внесок не
  записано: у вас більше немає права приймати внески. Зверніться до
  менеджера. Якщо гроші вже взяли — передайте папір менеджеру, щоб внести
  внесок з паперу.». A refusal that says nothing — someone else's command,
  an older server — is «Внесок ще не підтверджено: у вас більше немає права
  приймати внески. Зверніться до менеджера.», the command kept. A
  write-off's words name the owner: «… списувати борги. Зверніться до
  власника.»
- **«Магазину винні» that cannot be read** keeps its place: «Не вдалося
  прочитати» and «Спробувати ще раз», nothing moving.
- **A manager from the third** «not found» or request not taken in a row,
  whichever comes.

What is sent and the money are unchanged; no migration. One rule of
access changes, as the owner chose: a kept payment or write-off is answered
to its own person without the right, as a kept return has been since
2026-10-18 (`scope.require`'s exceptions now name `credit.service._own`).

## Decided here, not by the owner

- **What the answer shows:** the person's own entry and the debt's sums
  now, never the phone nor anyone else's entry, since they may no longer
  read debts. The sums are the debt's now, not only what their payment did:
  to be confirmed.
- **The words for the right,** «… у вас більше немає права приймати внески.
  Зверніться до менеджера.» and «… списувати борги. Зверніться до
  власника.», and the paper line after a payment proven unrecorded, as a
  return's: to be confirmed.
- **A store this person no longer belongs to, a store that does not trade,
  and a closed store's debt's write-off** are refused before the lookup, as
  a return's are: the phone keeps the command — a store that does not trade
  until it trades again (2026-10-08).
- **«Not found» and «not taken» count in one row,** whichever comes.

## How it was built and proven

- **Backend** (`test_customer_credit.py`): a payment recorded, another
  person's payment after it, then the first resent by its person without
  `sale:credit` — its own entry alone, no phone, the debt's sums now; a
  command never recorded — 403 with `recorded: false`; another request
  under it, and another person's — 403 saying nothing. A write-off resent
  by its person without `credit:write_off` — the same, another reason and
  another person refused. A first sending still holding its lock while the
  resend arrives — the resend waits for it, and is answered what it
  recorded. Every debts-related backend test (446) passed; the
  blocked store's resends still claim nothing.
- **`outage.spec.ts`:** a kept payment and a kept write-off of a person
  without «Борги», answered as recorded, as recorded nothing, and saying
  nothing — each over the till, its words, the till free or held as it
  should be, never «Борги», never «Немає доступу»; a kept payment answered
  400, 400 and 422 — a manager at the third, a 500 beginning again.
- **`credits-list.spec.ts`:** «Магазину винні» refused while the list is
  read — its place, «Не вдалося прочитати», the field where it was; read
  again — the sum, the field still there.
- **Related journeys:** 250 — debts, the outage and its paper, failures,
  returns, the drawer, the till and its sections — passed with it.
- **Mutation:** 21 ways of breaking it, one at a time, after the unchanged tree passed with everything they name: all 21 caught ([`mutants.txt`](../../output/verification/2026-10-21-credits-kept-right/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that what is sent and the money are unchanged, that anyone else's
command and another request under the same command are refused as before,
and that a blocked store's resends still claim nothing. It found, all
addressed before the first commit:
- **The answer gave the whole debt** to someone who may no longer read
  debts: the customer's phone, a colleague's payments, a later write-off's
  reason. It is now their own entry alone, with no phone; the debt's sums
  stay, as the phone says what is left.
- **Nothing proved a first sending still running is waited for.** A test
  now holds the first sending after the debt's lock and proves the resend
  waits for it and is given its answer.
- **«Спробувати ще раз» unmounted itself:** a read again after an error
  puts the query back to pending, and the card went with it. The card now
  says it could not read until there is something to show, its button
  waiting while it reads.
- **The button was under 44 px;** it is 44.
- **A write-off said «Зверніться до менеджера»,** though only the owner
  gives that right back: «Зверніться до власника».
- **The right's words stood for any refusal for a permission;** now only
  for one that names its store.
- **The ADR, the backlog, the risk register and `scope.require`'s
  docstring** still said only a return is answered so: updated, with the
  narrow window of a first sending stalled before the debt's lock recorded
  as a risk.
- **Smaller:** the stubs' shapes (the answer's own entry, no phone), doc
  comments, and two lines of the rules.

**For the owner,** asked after the merge:
- the answer's sums: the debt's now, as built, or only what their own
  payment did;
- the words for the right, «Зверніться до менеджера» for a payment and
  «Зверніться до власника» for a write-off, and the paper line after a
  payment proven unrecorded;
- a payment proven unrecorded on a debt paid off meanwhile: the paper line,
  as built, or «поверніть гроші покупцю»;
- the narrow window above: accept it, as a return's was (2026-10-18), or
  not.

## Evidence

- [`output/verification/2026-10-21-credits-kept-right/`](../../output/verification/2026-10-21-credits-kept-right/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `1cba3da`** ([summary](../../output/verification/2026-10-21-credits-kept-right-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 461 on PostgreSQL 17;
  - e2e: 500 journeys;
  - hot path: worst p95 131.0 ms (the search by six sellers) and 125.6 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** a person's right taken away while a payment waits.
- **No journey reaches the real server for the kept payment of a person
  without the right:** its words are proven against a stub, its answers
  against the server in the backend's tests.
- **A refusal for a permission that names no store** — a closed store's
  debt's write-off, the network owner's — keeps the shared words; no
  journey proves it.
