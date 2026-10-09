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
blocked the release, is built ([report](json-stock-import-report.md)).

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

## A mark on debt payments and returns typed from paper

The mark «продано під час збою» is on sales only. Debt payments and returns
typed from paper are ordinary ones: «Звіт» names who typed a return, and
«Борги» who took a payment (owner, 2026-10-07, corrected 2026-10-08). A mark
for them may be added later (owner, 2026-10-07); it would add the same
columns to their records, additively.
