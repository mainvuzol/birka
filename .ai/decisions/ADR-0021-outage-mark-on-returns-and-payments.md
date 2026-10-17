# ADR-0021: The outage mark on returns and debt payments

Status: Accepted (2026-10-10). Built on `feat/outage-mark-debts-returns`;
see the [report](../project-memory/outage-mark-returns-payments-report.md).
Owner decision: business-rules.md, "returns and payments typed from paper"
(2026-10-10). Extends: [ADR-0013](ADR-0013-the-server-is-unreachable.md) §5
(the mark), §7 (the till's paper mode) and §8 (debts and returns typed
later). Supersedes: G2, "the mark is on sales only" (owner, 2026-10-07).

## Context

While the server does not answer, the shops sell on paper, and take debt
payments and returns on paper too; when it answers, the lines are typed in
(owner, 2026-10-04). A sale typed from paper carries the mark «продано під
час збою», which may name who sold and the paper's hour (ADR-0013 §5). On
2026-10-07 the owner kept returns and payments ordinary, and said a mark
for them might be added later (backlog). Without it:
- «Повернення оформлено» said «Поверніть покупцю … готівкою» of money
  handed back during the outage, and a card payment's screen nothing about
  not charging the terminal again; only the sellers' page warned;
- «Звіт» and «Борги» named only who typed a return or a payment, not who
  took it on paper, nor when.

## Decision

1. **The mark holds what a sale's does** (owner, 2026-10-10): who took the
   return or the payment, and the paper's hour, today or «вчора», as the
   paper says; both optional. Who typed it is recorded as always. The day,
   «Звіт»'s day and the drawer are those of the moment it is typed. A wrong
   mark is permanent.
2. **The till's switch** (owner): on «Повернення» and on a debt's «Внесок»,
   «Вношу повернення з паперу» and «Вношу внесок з паперу», kept for a
   series; in paper mode the buttons say «З паперу · …», and under them who
   took it. How it is carried out, not decided by the owner:
   - it is the till's own state: one series per store on the phone,
     whichever screen it is ticked on, cleared when the store is left;
   - who is named is each screen's own (who sold, who took a return, who
     took a payment), kept for that screen's series, so a name chosen on
     one is never sent, unseen, for another (found by the review: a wrong
     mark is permanent);
   - the hour is each operation's.
3. **The screens say the money was already handed over** (owner):
   - a return: «… повернули під час збою — вдруге не повертайте.», with
     the mark, on «Повернення оформлено», and the same when the phone
     confirms a kept one by itself; *the headings since 2026-10-18 (the
     returns task list, P0-5, P1-2): «Повернення записано», and for a kept
     one «Повернення записано один раз»; the words about the money and this
     rule are unchanged;*
   - a payment: «Внесок … з паперу записано: карткою — оплату провели під
     час збою, на терміналі не проводьте ще раз.» (a transfer: «отримано
     під час збою, звірте з папером»), and a kept one confirmed later says
     the same, never «проведіть на терміналі».
4. **Where it shows** (owner): a return in «Звіт», «Повернено під час
   збою · хто прийняв: … · за папером …» and «внесено: …»; a payment in the
   debt's history in «Борги», «Внесок під час збою · хто прийняв: …».
   «Звіт» keeps debt payments as one sum.
5. **The request:** `outage: {by_user_id, at}` on `POST
   /sales/{id}/refunds` and `POST /credits/{id}/payments`, `{}` for the mark
   with nothing named; answered as `outage: {by_user_id, by, at}` on the
   refund and on the debt's entry. Named so, not as a sale's `sold_by`:
   nobody sold here. Only the shape is checked before the replay lookup.
6. **Checked after the lookup, by the store taking it** (as ADR-0013 §5.3;
   how it is carried out, as a sale's "one of the store's people" reads for
   a return and a payment):
   - whoever is named may take one there now: `sale:refund` for a return,
     `sale:credit` for a payment, by a grant for that store or for the
     whole network, active, of this network; else `OUTAGE_SELLER_UNKNOWN`;
   - the hour is that store's today or yesterday, and not ahead of the
     server by more than 5 minutes: `OUTAGE_TIME_TOO_OLD`,
     `OUTAGE_TIME_FUTURE`, with the time under `details.at`;
   - each with `recorded: false`. A return taken back at another store, and
     a closed store's debt paid at one that trades, are the taking store's.
   - `GET /stores/{id}/sellers?for=refund|credit` lists exactly whom each
     check accepts, for whoever may take one there.
7. **Prints:** the mark is in the return's two prints and the payment's
   permanent one, as the literal the body carried, and only when present:
   every return and payment before it keeps its print, pinned in
   `test_old_prints_are_pinned.py` beside the marked ones.
8. **The schema** (`0039_outage_mark_debts_returns`):
   - `during_outage`, `outage_taken_by`, `outage_taken_at` on `refund` and
     on `credit_entry`, with `outage_details_need_the_mark` on both and
     `only_a_payment_is_marked` on the ledger;
   - on `refund` a guard `BEFORE UPDATE OF` the three columns refuses any
     change; on `credit_entry` the ledger's own guard (0038) already
     refuses every change but a write-off's reason being erased;
   - the downgrade refuses once a return or a payment carries the mark.
9. **Not marked:** the first payment of a sale paid in parts, which is the
   sale's own and carries the sale's mark; a write-off, the owner's; an
   order collected, which is typed as a sale.

**The first days' paper** (owner decision, 2026-10-16). A return or a debt
payment typed from the paper of a warehouse's first days, while it waited
for its opening list, carries `first_days`, «з паперу», as a sale does
(ADR-0013 §5.8): the same rules, its time of the last two weeks, no word of
an outage.

## Consequences

- **The seller must tick the switch.** A return or payment typed from paper
  without it is an ordinary one, and its screen says to hand the money over,
  as before. The sellers' page says to tick it always.
- **One switch for three screens** means a series ticked on «Повернення»
  is on at the till and in «Борги» too, and one left on at the till turns a
  live payment into one «з паперу»: its screen then says not to charge the
  card. The buttons say «З паперу» before every press, as they do at the
  till, and the screen's band «Режим: з паперу» shows it.
- **The mark is the typist's word,** as a sale's is (ADR-0013 §5): nothing
  checks who took the money or when.

## Rejected

- **A checkbox per operation, reset after each:** safer against a forgotten
  switch, slower for a series; not chosen (owner).
- **The texts unchanged:** the seller would have to remember the money was
  handed over; not chosen (owner).
- **A separate sum in «Звіт» of what was typed from paper:** not chosen
  (owner).
- **Reusing the sale's `sold_by_user_id`/`sold_at`:** it would say that
  somebody sold.
