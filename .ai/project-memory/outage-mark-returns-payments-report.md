# Returns and payments typed from paper — 2026-10-10

Baseline: `50dbac4` (a closed store's debts, merged as PR #84).
Status: TODO(final).
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
  раз.»; a kept one confirmed later never says to charge the card. The
  history: «Внесок під час збою · хто прийняв: …».
- **«Звіт»:** a marked return reads «Повернено під час збою · хто прийняв:
  … · за папером … · внесено: …».
- **One switch** for the till, «Повернення» and «Борги» of a store; the
  person named carries across, the hour is each operation's.
- **The sellers' page,** steps 6 and 7: tick the switch for a payment and a
  return too. The new wording waits for the owner's confirmation.

## How it was built and proven

- **Server tests** (`test_outage_mark_returns_payments.py`, 11):
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
    accepted;
  - the lists for `refund` and `credit` are exactly whom the checks accept,
    the till's still includes the cashier, and only whoever may take one
    reads its list;
  - the paper's time: two days old and tomorrow refused, with `details.at`;
    seconds or a space refused by shape before the lookup;
  - a marked return and payment replay after their person left and their
    day passed;
  - another store's: the taking store's people only;
  - the mark never changed, nor a live return marked afterwards;
  - `0039` goes down and up, and refuses once a payment is marked.
- **Pinned prints:** a marked return's two and a marked payment's one,
  beside the earlier ones, all unchanged.
- **Journeys:**
  - against the real server (`outage-mark-debts-returns.spec.ts`): a return
    typed by «Ліда» naming «Ганна» says the money went back, sends the
    mark, and shows in «Звіт» with who typed it; a card payment says not to
    charge, sends the mark, and shows in the history; the switch ticked on
    «Повернення» is on at the till, and unticked there is off;
  - stubbed (`outage.spec.ts`): a kept return and a kept card payment typed
    from paper, confirmed by the phone, say the money was handed over and
    are resent with their mark.
- **Mutation:** TODO(final).

## Review of the built change

TODO(final)

## Evidence

TODO(final)

## Not covered here

- **A switch left off** types an ordinary return or payment, whose screen
  says to hand the money over.
- **The mark is the typist's word,** and permanent.
- **Debt payments stay one sum in «Звіт»**; their marks are in «Борги».
- **The sellers' page's new steps** are not yet confirmed by the owner.
