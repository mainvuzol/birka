# A stocktake of a whole warehouse — 2026-10-10

Baseline: `a886c69` (returns and payments typed from paper, merged as PR
#85).
Status: TODO(final).
Branch: `feat/warehouse-stocktake`. Decision:
[ADR-0022](../decisions/ADR-0022-warehouse-stocktake.md); owner:
business-rules.md, "a stocktake of a whole warehouse" (2026-10-10).

## Why this was next

After PR #84 the owner chose two things: the mark on returns and payments
typed from paper (PR #85), then a stocktake of a whole warehouse. A
stocktake changed one balance at a time (`POST /inventory/adjustments` with
the reason `STOCKTAKE`). Nothing said which corrections were one count of a
warehouse, what it found in all, or what nobody counted: the risk register
said "one balance at a time".

## What the owner was asked

On 2026-10-10, each answer the recommended one:
- **selling during the count:** the warehouse keeps selling, each position
  checked against its balance when saved and counted again alone if it
  moved; or the warehouse stopped until the end;
- **what nobody counted:** stays as it is, and the end says how many; or
  set to zero; or the end refused until everything is counted;
- **who counts:** a manager or the owner, each count applied at once; or
  sellers count and a manager approves the differences;
- **what the owner learns:** one record and a silent bot message of its
  sum, as a drawer's difference; or the record alone; or nothing beyond
  ordinary corrections.

## What exists now

- **`POST /stocktakes`** starts one for a warehouse, or answers the one
  open there (200), which whoever starts it then joins. One is open per
  warehouse; two starting at once get one.
- **`POST /stocktakes/{id}/counts`** records one position: what the shelf
  holds and the balance it was counted against, with a permanent
  `command_id` and an `Idempotency-Key`, as a correction (ADR-0007).
  - Under the stock lock the balance must still be the one counted
    against, else `STOCK_CHANGED` with `expected` and `actual`.
  - A count that differs is a stock adjustment with the reason
    `STOCKTAKE`: its row, its movement, its audit entry. One that matches
    is recorded and changes nothing.
  - Refused after the lookup, with `recorded: false`: a finished stocktake
    (`STOCKTAKE_FINISHED`), a moved balance, a difference on a balance an
    order holds (`reason: RESERVED`), a size not known counted upwards.
  - A late resend is answered from its record, even after the finish.
- **`POST /stocktakes/{id}/finish`** freezes the sums: positions counted,
  positions with stock nobody counted, the shortage and the surplus in units
  and in positions. Finishing again answers it as it was. The bot's message
  to the network's owners is written in the same transaction.
- **Reading:** `GET /stocktakes` (a warehouse's, the open one first),
  `GET /stocktakes/{id}`, and `GET /stocktakes/{id}/positions` (those not
  counted, those counted with their last count and what the stocktake
  changed, or only the differences), for whoever sees the warehouse's
  stock.
- **Who:** counting, starting and finishing ask what a correction asks
  (`inventory:adjust`, the store's `can_receive` there); «Брак» and a
  warehouse waiting for its opening list are refused. Another store sharing
  the warehouse counts for itself.
- **The message:** to whoever holds `store:manage` across the network, never
  to whoever finished it; sent by `backup-watch`, silently, retried for a
  day. «Інвентаризація: склад «…», магазин «…».», positions counted and not
  checked, the shortage and the surplus, the start and the finish with who.
- **The schema** (`0040_warehouse_stocktake`): `stocktake` (changes once,
  from open to finished; never deleted), `stocktake_count` (append-only),
  `stocktake_message`. The downgrade refuses once a stocktake exists.
- **One sending algorithm** for the shop's messages: the drawer's moved to
  `telegram.outbox`, and the stocktake's uses it. The backups keep theirs.
- **«Залишки»:** «Інвентаризація складу» under a warehouse — «Почати
  інвентаризацію складу» with what it means, «Продовжити інвентаризацію»,
  and «Попередні інвентаризації» with «Показати розбіжності». Counting
  replaces the list:
  - «Ще не пораховані» and «Пораховані», each position with «В обліку»,
    «Фактично на складі, од.» and «Записати кількість»; «Облік 6 → 4 (−2)»
    or «Збігається з обліком.» before it is sent; «Перерахувати» on a
    counted one;
  - «Знайшли товар, якого немає в списку»: a model and size from the
    catalogue, counted against zero; if held after all, the server says how
    many;
  - «Завершити інвентаризацію» says how many positions will stay as they
    are, then the sums.
- **A count kept on the phone** until it is settled, as a correction: the
  banner «Незавершений підрахунок», «Перевірити результат підрахунку», and
  «Підрахунок підтверджено». A correction and a count each wait for the
  other; either holds every other screen.

## How it was built and proven

- **Server tests** (`test_warehouse_stocktake.py`, 14; `test_stocktake_message.py`, 3):
  - a matching count changes nothing and writes no movement; a differing
    one applies at once as an adjustment with the reason `STOCKTAKE`;
  - a position sold while it was counted is refused, nothing written, and
    counted again; a sale after the count is no shortage;
  - a position counted again counts once in the sums; the positions read
    as counted, with the last count and what changed, and as differences;
  - what nobody counted stays as it was, and is told at the finish;
  - goods the list does not show are a surplus counted against zero;
  - one open per warehouse, two starting at once get one, another store
    joins it, another warehouse has its own;
  - a finished stocktake takes no count and answers as it was; a new one
    starts after it;
  - a count resent after its cache was purged, and after the finish, is
    answered from its record and applied once; another count under its
    `command_id` conflicts;
  - who: a seller reads but neither starts, counts nor finishes; the other
    store's owner counts for their store; another network reads nothing;
  - «Брак» refused; a reserved balance only checked; a size not known only
    counted down; a warehouse waiting for its list not started;
  - the owner hears the sum, the manager who finished does not, the
    other store's owner does not; the watcher sends it once; an owner who
    finishes hears nothing;
  - the database refuses any change of a finished stocktake or a count,
    and any deletion;
  - `0040` goes down and up, and refuses once a stocktake exists.
- **Journeys** (`stocktake.spec.ts`, 4, against the real server): a
  warehouse counted, a found coat added, finished and read back with its
  differences; a position sold while counted refused and counted again; a
  count whose answer was lost holds the app and is resent unchanged; a
  person without `inventory:adjust` is offered no stocktake.
- **Mutation:** TODO(final).

## Review of the built change

TODO(final).

## Evidence

TODO(final).

## Not covered here

- **The counter sees the balance,** as on the correction screen.
- **A coat that left before its sale was recorded** is counted missing and
  then sold again.
- **A stocktake left open** is never summed or told.
- **A reserved position that differs** stays unchanged until its order is
  dispatched or cancelled.
- **The list is in «Залишки»'s order,** by model, not by name or shelf.
- **Not walked in a browser:** a reserved position, «Брак», another store
  counting the same warehouse, and a seller reading a finished record.
