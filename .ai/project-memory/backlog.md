# What to build next

Work the owner asked for, or that waits on the owner, and is not built yet.
None of it blocks the release (see the [release checklist](release-checklist.md)).
Before anything here is built, the owner answers the open questions under it.
Nothing is invented in the meantime.

What is built leaves this list for its report. Where an order goes is built
([report](order-shipping-report.md)).

## The JSON stock import

Existing stock from photos of the notebooks: a separate parser turns them
into JSON, which the app imports into a list for review (owner, 2026-10-01).
It waits for the owner to choose this way, and for the parser's format.

## Settling money between stores

A store records money it paid out for another store's sale (returns at
another store), and payments it took for another store's debt (store
states). Nothing adds these up between stores, or marks them settled. It
waits for the owner's rules.
