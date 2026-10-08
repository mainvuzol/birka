# What to build next

Work the owner asked for, or that waits on the owner, and is not built yet.
Of the work here, only the JSON stock import blocks the release: the owner
chose it as the way in on 2026-10-08 (row 15 of the
[release checklist](release-checklist.md)).
Before anything here is built, the owner answers the open questions under it.
Nothing is invented in the meantime.

What is built leaves this list for its report. Where an order goes is built
([report](order-shipping-report.md)), and so are goods borrowed from another
shop ([report](borrowed-goods-report.md)) and the sales report the owner
chose next ([report](sales-report-report.md)). Settling money between the
network's stores left it too: the owner decided on 2026-10-01 that stores of
one network do not settle with each other.

## The JSON stock import

Existing stock from photos of the notebooks: a separate parser turns them
into JSON, which the app imports (owner, 2026-10-01). The owner chose this
way on 2026-10-08 and answered what it needs (business rules, "the shops'
existing stock"): Birka defines the JSON's format; a line names the model,
size and count, sometimes a colour and a price, which is only shown; every
line is reviewed by a person; several files fill one warehouse's list; the
photos stay with the shops; the file is uploaded in the app. Nothing is
built yet.

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
