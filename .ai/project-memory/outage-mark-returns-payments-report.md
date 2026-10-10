# Returns and payments typed from paper — 2026-10-10

Baseline: `50dbac4` (a closed store's debts, merged as PR #84).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-seven ways of breaking it each caught. The sellers' page's steps 2,
6 and 7 wait for the owner's confirmation.
Branch: `feat/outage-mark-debts-returns`. Decision:
[ADR-0021](../decisions/ADR-0021-outage-mark-on-returns-and-payments.md);
owner: business-rules.md, "returns and payments typed from paper"
(2026-10-10).

## Why this was next

After PR #84 the owner chose two things: this one first, from the backlog,
then a stocktake of a whole warehouse. The mark «продано під час збою» was
on sales only (owner, 2026-10-07). A return typed from paper then said
«Поверніть покупцю … готівкою» of money handed back during the outage, and
a card payment typed from paper said nothing about the terminal; «Звіт»
and «Борги» named only who typed them.

## What the owner was asked

On 2026-10-10, each answer the recommended one:
- **what the mark holds:** as a sale's, who took it and at what hour, both
  optional; or the mark alone;
- **how it is switched on:** the till's «З паперу» switch, kept for a
  series; or a checkbox each time;
- **what the screen says of the money:** already handed over, not a second
  time; or the texts unchanged;
- **where it shows:** «Звіт» for a return, the debt's history for a
  payment; or a separate sum in «Звіт» as well.

## What exists now

- **The request:** `outage: {by_user_id, at}` on `POST
  /sales/{id}/refunds` and `POST /credits/{id}/payments`; `{}` is the mark
  with nothing named. Answered as `outage: {by_user_id, by, at}` on the
  return and on the debt's entry.
- **Checked after the replay lookup,** by the store taking it: whoever is
  named may take returns (`sale:refund`), or payments (`sale:credit`),
  there now; the hour is that store's today or yesterday, never ahead; each
  refusal `recorded: false`. A return taken at another store, and a closed
  store's debt paid at one that trades, name that store's people.
- **`GET /stores/{id}/sellers?for=refund|credit`** lists exactly whom each
  check accepts; `for=sale`, or nothing, is the till's list as before.
- **Prints:** the mark is in the return's two prints and the payment's one,
  only when present. Every earlier print is unchanged, and the marked ones
  are pinned beside them.
- **The schema** (`0039_outage_mark_debts_returns`): three columns on
  `refund` and on `credit_entry`; a guard on `refund`'s, the ledger's own
  guard on `credit_entry`'s; only a payment is marked; the downgrade
  refuses once anything is marked.
- **«Повернення»:** «Вношу повернення з паперу», «Хто прийняв», «Час з
  паперу», «Це було вчора»; the button «З паперу · Повернути покупцю …»;
  under it «Гроші повернули під час збою…» and who took it. «Повернення
  оформлено» shows the mark and «… повернули під час збою — вдруге не
  повертайте.», also when the phone confirms a kept one.
- **«Борги»:** «Вношу внесок з паперу» with the same fields, buttons «З
  паперу · Готівка/Картка/Переказ», and «Внесок … з паперу записано:
  карткою — оплату провели під час збою, на терміналі не проводьте ще
  раз.»; a kept one confirmed later says the same by its way, never to
  charge the card. The history: «Внесок під час збою · хто прийняв: … ·
  внесено: …».
- **«Звіт»:** a marked return reads «Повернено під час збою · хто прийняв:
  … · за папером … · внесено: …».
- **One switch** for the till, «Повернення» and «Борги» of a store; who is
  named is each screen's own, the hour each operation's.
- **The sellers' page,** steps 2, 6 and 7: write down who took a payment or
  a return and when, and tick the switch for them too. The new wording
  waits for the owner's confirmation.
- **The server runbook:** the update that brings `0039`, and going back
  across it.

## How it was built and proven

- **Server tests** (`test_outage_mark_returns_payments.py`, 13):
  - a return typed by the manager naming the seller: stored, answered,
    today's, in the same drawer as a live one, and in «Звіт» with who took
    it and who typed it;
  - a payment the same, in the debt's history beside a live one and the
    sale's first payment, which carry none;
  - the mark with nothing named;
  - the mark part of the command: the same resent replays; another person,
    another time or none conflicts, for both;
  - who may be named: a cashier who only sells, someone who left, another
    store's seller and a stranger refused; the seller, manager and owner
    accepted; someone who takes returns and no payments named on a return,
    refused on a payment, and listed so;
  - the lists for `refund` and `credit` are exactly whom the checks accept,
    the till's still includes the cashier, and only whoever may take one
    reads its list;
  - the paper's time: two days old and tomorrow refused, with `details.at`;
    seconds or a space refused by shape before the lookup;
  - a marked return and payment typed while the clock read two days ago
    replay now, when a new one with that time is refused; and replay after
    their person left, when a new one naming them is refused;
  - another store's: the taking store's people only;
  - the mark never changed, nor a live return marked afterwards;
  - `0039` goes down and up, and refuses once a payment is marked.
- **Pinned prints:** a marked return's two and a marked payment's one,
  naming someone and naming nobody (`{}`), beside the earlier ones, all
  unchanged.
- **Journeys:**
  - against the real server (`outage-mark-debts-returns.spec.ts`): a return
    typed by «Ліда» naming «Ганна» says the money went back, sends the
    mark, and shows in «Звіт» with who typed it; a card payment says not to
    charge, sends the mark, and shows in the history with who typed it;
    the switch ticked at the till is on on «Повернення» and in «Борги»,
    the name chosen at the till is not taken for a return, and unticked at
    the till it is off;
  - stubbed (`outage.spec.ts`): a kept return and a kept card payment typed
    from paper, confirmed by the phone, say the money was handed over and
    are resent with their mark.
- **Mutation:** twenty-seven ways of breaking it, one at a time, each
  caught: seventeen on the server, ten on the screens, four of them added
  after the review (a mark checked before either lookup, the payments'
  list the returns', the till's name taken for a return)
  ([list](../../output/verification/2026-10-10-outage-mark-returns-payments/mutants.txt)).

## Review of the built change

An independent review read the first commit (`8102e7f`). It found no
defect in the commands, the schema or the prints: the old prints keep their
values, the checks sit after the lookup in both commands, the ledger's
guard does freeze the new columns, and a name is sent only when listed. It
found, all addressed:
- **"Replays after its day passed" was claimed, not tested:** the test
  never moved the clock. It does now, as the sale's does, for both.
- **The name chosen at the till was pre-selected for a return,** where a
  wrong mark is permanent; and the ADR credited the owner with the shared
  switch and the carried name, which the business rules list as readings.
  Who is named is now each screen's own, and the ADR says what is a
  reading. The switch left on after a series, turning a live payment into
  one «з паперу», is in the risk register.
- **No runbook entry for `0039`:** added, for the update and for going
  back.
- **Texts untrue in two cases:** a return of a sale paid in parts that only
  lowers the debt, and one taken at another store. Reworded: «Гроші, які
  віддали під час збою, вдруге не віддавайте», «Як повертали гроші під час
  збою (якщо повертали)», «гроші віддавав ваш магазин».
- **A kept transfer payment typed from paper said nothing:** it says what
  the till says of a transfer now.
- **Test gaps:** the two permissions could be swapped unnoticed (now a role
  with only `sale:refund`), and the mark naming nobody had no pinned print
  (now pinned).
- **Nits:** the checklist's journey count, the sellers' page's step 2, the
  report docstrings, «внесено:» in the debt's history, and «Нічого не
  записано.» after a mark's refusal in paper mode.

## Evidence

- [`output/verification/2026-10-10-outage-mark-returns-payments/`](../../output/verification/2026-10-10-outage-mark-returns-payments/):
  `mutants.py` and `mutants.txt`, twenty-seven ways of breaking it, each
  caught.
- **CI, run locally at `c7dad9a`** ([summary](../../output/verification/2026-10-10-outage-mark-returns-payments-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 378 on PostgreSQL 17;
  - e2e: 273 journeys;
  - hot path: worst p95 68.4 ms (catalogue read) and 70.8 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.
- A first run at `ade4e8d` failed on two tests and the runner, not the
  change: the new journeys ran the browser in CI's UTC, so the paper's
  19:40 in Kyiv read 16:40 (they use Kyiv's clock now, as `outage.spec.ts`
  does); a server test fixed the order of names, which PostgreSQL 17's
  uk-UA collation sorts otherwise (sets now); and the runner's edge job
  migrated with an `ops` image an earlier run had kept, built before
  `0039` (it now removes that one image first, as a fresh runner has
  none; the server runbook builds `ops` on every update).

## Not covered here

- **A switch left off** types an ordinary return or payment, whose screen
  says to hand the money over.
- **The mark is the typist's word,** and permanent.
- **Debt payments stay one sum in «Звіт»**; their marks are in «Борги».
- **The sellers' page's new steps** are not yet confirmed by the owner.
- **The store's zone:** both stores of the tests are in Kyiv, so the taking
  store's zone and the selling store's are never told apart.
- **Journeys not walked:** a card or transfer return from paper, a return
  of a sale paid in parts from paper, a corrupt kept mark on reload.
