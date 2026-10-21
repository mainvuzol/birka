# What to build next

Work the owner asked for, or that waits on the owner, and is not built yet.
None of it blocks the release ([release checklist](release-checklist.md)).
The shops' largest warehouse comes to at most 5 000 (owner, 2026-10-09), so
raising the opening list's limit (below) waits for a warehouse that turns
out larger.
Before anything here is built, the owner answers the open questions under it.
Nothing is invented in the meantime.

What is built leaves this list for its report. Where an order goes is built
([report](order-shipping-report.md)), and so are goods borrowed from another
shop ([report](borrowed-goods-report.md)) and the sales report the owner
chose next ([report](sales-report-report.md)). Settling money between the
network's stores left it too: the owner decided on 2026-10-01 that stores of
one network do not settle with each other. The JSON stock import, which
blocked the release, is built ([report](json-stock-import-report.md)), and
so is the mark on debt payments and returns typed from paper, chosen on
2026-10-10 ([report](outage-mark-returns-payments-report.md)).

## Raising the opening list's limit above 5 000 answers

A warehouse's list takes at most 5 000 answers and 5 000 lines, measured
on 2026-10-08, and a warehouse takes one list, once (ADR-0014 §10). The
owner kept that limit the same day: the shops first count the notebooks of
their largest warehouse roughly (pages × lines per page), and if it comes
out above 5 000, the limit is raised by a separate change to the ledger
before going live. **The count came to at most 5 000** (owner, 2026-10-09),
so this waits for a warehouse whose list turns out larger: the validator's
exact lines, or a list refused as full (`LIST_FULL`). The change: the
approval and its read of the reservations, which fails above about 6 500
answers, batched in `inventory` under their own review, and the approval
measured again. Nothing is built for it.

## An offline mode, judged on real outages

When the server does not answer, the shops sell on paper and type the sales
in when it answers (owner, 2026-10-04). An offline mode in the app, the
phone recording sales and sending them later, may be judged later, on real
outages (owner, the same day). Nothing is built for it. It would reopen the
page that is never cached (ADR-0010 §4) and the drawer's commit order
(ADR-0012 §3), with stock of unknown age and screens for conflicts; see
[ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md), "Rejected".

## A kept operation learned without its right, as a return is

A phone keeps an operation whose answer it never heard and holds its till
until it learns the outcome (ADR-0013). Since 2026-10-18 a return is
answered to whoever recorded it once they may no longer take returns there,
or their store no longer reaches the warehouse
([report](credits-redesign-1-report.md)). The owner chose the same for a
kept sale, debt payment, delivery, stock correction and order's step,
later — after «Борги»'s list (owner, 2026-10-18). A debt payment and a
write-off are built (2026-10-21,
[report](credits-kept-right-report.md)); the sale, delivery, stock
correction and order's step still hold that phone in that store until the
right is back (risk register).

## «Борг із зошита»: debts from before Бірка

Debts written in the notebook before the shop began with Бірка are typed
one by one: the customer's name and phone, what they owe and what they
bought, by a manager or the owner (owner, 2026-10-18, «Борги» В3 (а)). A
debt opens only with its sale today, so this is a new operation, on the
server and with a migration; «Магазину винні» shows every debt only once
it is built. Its questions — whether it enters the drawer's count, how it
is marked in the history, who may correct it — go to the owner before it is
built ([the task list](redesign/2026-10-18-redesign-tz-credits.md), P1-4).
