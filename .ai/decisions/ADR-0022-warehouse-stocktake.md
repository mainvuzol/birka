# ADR-0022: A stocktake of a whole warehouse

Status: Accepted (2026-10-10). Built on `feat/warehouse-stocktake`; see the
[report](../project-memory/warehouse-stocktake-report.md). Owner decision:
business-rules.md, "a stocktake of a whole warehouse" (2026-10-10). Builds
on: [ADR-0007](ADR-0007-stock-adjustment-command-identity.md) (a stock
correction's permanent identity) and the stock correction screen
(`stock-correction-ui-report.md`). Amends:
[ADR-0001](ADR-0001-module-boundaries.md) (module `stocktake`).

## Context

A manager corrected stock one balance at a time: `POST
/inventory/adjustments` with the reason `STOCKTAKE` states what the shelf
holds and the balance it was counted against, and is refused as
`STOCK_CHANGED` if a sale moved that balance meanwhile. Nothing said which
corrections were one count of one warehouse, what it found in all, or which
positions nobody counted (known risk: "one balance at a time"). After #84
the owner chose a stocktake of a whole warehouse, and on 2026-10-10 gave its
rules.

## Decision

1. **The warehouse keeps selling** (owner). Each position is counted and
   saved on its own, with the balance it was counted against. Under the
   stock lock the balance must still be that, else `STOCK_CHANGED` with
   `expected` and `actual`, nothing written, and that position alone is
   counted again.
2. **Positions nobody counted stay as they are** (owner). The finish says
   how many positions with stock on record were not counted.
3. **A manager or the owner counts, and each count applies at once**
   (owner): whoever may correct the warehouse's stock from their store
   (`inventory:adjust` and the store's `can_receive` there), as `POST
   /inventory/adjustments` asks. A count that differs from the balance is a
   stock adjustment with the reason `STOCKTAKE` (`record_adjustment`: its
   permanent row, its ledger movement, its audit entry); one that matches
   changes nothing and is recorded as checked.
4. **One record, and the owner hears of it** (owner): who started it and
   when, who finished it and when, how many positions were counted and how
   many not checked, the shortage and the surplus in units; the bot tells
   the owner its sum, silently, as a drawer's difference.

How it is carried out, not decided by the owner:

5. **What the record and the message carry beyond that:** the shortage
   and the surplus in positions too, beside the units. The
   "owner" told is whoever holds `store:manage` across the network, never
   whoever finished it, as for a drawer's difference (ADR-0012, G10).
6. **One open per warehouse.** `POST /stocktakes` starts one, or answers
   the one open there (200), which whoever starts it then joins, from any
   store that may correct that warehouse. Two starting at once get one.
7. **A position counted twice has two counts.** What it was counted at is
   its last; what the stocktake changed there is the sum of its counts'
   deltas. A mistyped count counted again cancels out, and a sale between
   two counts is no shortage.
8. **The count is a command with a permanent identity,** as an adjustment's
   (ADR-0007): `POST /stocktakes/{id}/counts` with `command_id`,
   `product_variant_id`, `size_id`, `counted_quantity` (0–10 000) and
   `expected_quantity`, and an `Idempotency-Key`. The fingerprint leaves the
   expected balance out: a late resend is answered from its record before
   any balance is compared, even after the stocktake was finished. Refusals
   after the lookup carry `recorded: false` (ADR-0013 §1): `STOCK_CHANGED`,
   `STOCKTAKE_FINISHED`, the reservation's (`reason: RESERVED`) and a size
   not known counted upwards.
9. **What is refused as a correction is refused here:** «Брак» (it changes
   only through returns and its own section), a warehouse waiting for its
   opening list, a balance an order holds when the count differs (a
   matching one is checked), and a size not known counted upwards
   (ADR-0005 §3).
10. **Finishing freezes the sums** under an exclusive lock on the stocktake,
   which every count holds shared: counts under way land first, none after.
   Finishing again answers it as it was. The message is written in the same
   transaction and sent by the watcher.
11. **Who counted** is on each count, and the store they acted for: another
    store sharing the warehouse counts for itself.
12. **Reading** (`GET /stocktakes`, `/stocktakes/{id}`, `/{id}/positions`)
    asks what reading the warehouse's stock asks (`inventory:view`). The
    positions are a page: those with stock not counted yet, in the order
    «Залишки» lists them; those counted, last first; or only the
    differences.
13. **The schema** (`0040_warehouse_stocktake`): `stocktake` (a guard lets it
    change once, from open to finished, and never deletes it; one open per
    warehouse by a partial unique index), `stocktake_count` (append-only),
    `stocktake_message` (an outbox). The downgrade refuses once any
    stocktake exists.
14. **One sending algorithm for the shop's messages.** The drawer's
    `deliver` moved to `telegram.outbox`, parameterised by the message
    table and by who a chat belongs to, and the stocktake's messages use it
    too; the backups keep their own copy (a shop module may not import that
    section).
15. **The screen:** «Інвентаризація складу» on «Залишки» for one warehouse:
    start (with what it means), continue, the finished ones with their
    differences. Counting replaces the list: the positions not counted, the
    ones counted, goods found that the list does not show (counted against
    zero), and the finish, which says how many will stay unchecked. A count
    is kept on the phone until settled, as a correction is, and each holds
    the other.

## Consequences

- The counter sees the balance, as on the correction screen; nothing makes
  them count rather than confirm it.
- A coat that left the shelf before its sale was recorded is counted
  missing, and the sale then takes it again: count a position while no sale
  of it is under way.
- A stocktake left open is never summed or told; its counts are applied.
- A reserved position that differs stays unchanged until its order is
  dispatched or cancelled; it then needs a correction.
- The sums are in units, not money.

## Rejected

- **Freezing the warehouse until the count is finished:** not chosen
  (owner).
- **Setting what nobody counted to zero, or requiring every position:** not
  chosen (owner).
- **Sellers count and a manager approves the differences:** not chosen
  (owner).
- **No record of its own, only corrections with the reason «Перерахунок»;
  or a record without the bot:** not chosen (owner).
- **A third copy of the sending algorithm:** a fix would have to be made in
  three places.
- **A count as a correction with a stocktake id:** a matching count has no
  movement, and a correction always has one.
