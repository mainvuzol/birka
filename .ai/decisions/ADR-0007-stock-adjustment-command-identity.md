# ADR-0007 — A stock adjustment is a business operation

Status: accepted (2026-09-30, owner), implemented in `0017_stock_adjustment`.
Completes [ADR-0006](ADR-0006-goods-receipt-command-identity.md). Invariant I20.

## Context

ADR-0006 gave receiving goods a permanent `command_id` and recorded, as a
consequence, that `POST /inventory/adjustments` still had the same defect. It
was reproduced the same way: a `STOCKTAKE` of +7, replayed with its original
Idempotency-Key after the 7-day record is gone, left 14. It was the last
command that writes stock outside invariant I20.

ADR-0006 set out three options:

1. an aggregate row of its own, mirroring `goods_receipt` and `transfer`;
2. a `command_id` on `stock_movement` under a partial unique index, which
   refuses a duplicate instead of replaying it;
3. accept the 7-day window for a manager-only command.

The fix was not bundled into ADR-0006 because the shape needed a choice. An
adjustment writes one ledger row and has no aggregate, and the
`quantity_before`/`quantity_after` it reports are computed rather than stored,
so option 2 has nothing to replay a response from.

## Decision

**Option 1**, confirmed by the owner on 2026-09-30 ("keep it the way that is
most logical and correct"). It is the only option under which an adjustment
behaves exactly like every other stock command: a late retry receives the
original answer rather than a refusal.

- `stock_adjustment` holds only what the ledger cannot say: the warehouse and
  acting store (bound compositely, ADR-0004 §2.2), the actor, the permanent
  `command_id` under `UNIQUE (organization_id, command_id)`, the note, and
  ADR-0003's `command_fingerprint` and `response_snapshot`.
- **The change itself stays in the ledger.** The one `stock_movement` an
  adjustment writes names this row through `reference_type =
  'stock_adjustment'`. No ledger fact is repeated, so the two cannot disagree.
  Before this, a manual correction's ledger row named nothing at all, and its
  note survived only in an audit entry.
- `command_id` is required on the endpoint.
- **The permanent fingerprint covers the stock facts** — warehouse, stock key,
  delta, reason, actor and store — **and not the note.** A note is commentary:
  the same change under the same command with a reworded note is a retry and
  gets the original answer, including the original note, which is never
  rewritten. The same command aimed at another amount, reason or warehouse is
  a client bug and is refused. The receipt's fingerprint leaves its notes out
  for the same reason.

The durable-replay logic for receipts and adjustments is one function
(`_permanent_answer`), so the two cannot drift.

## Consequences

- I20 now covers every command that writes stock through the API: sales,
  refunds, transfers, legacy imports, receipts and adjustments.
- A breaking API change: every caller must send `command_id`; six in-repo call
  sites were updated, and there are no external ones.
- Manual adjustments made before `0017` keep a NULL reference; inventing a
  command for them would record a fact nobody stated.
- The quick-correction screen can now use a durable client journal, as the
  till and the receiving screen do, without risk of applying a correction
  twice.
- Rolling back `0017` keeps every stock and ledger row but loses each
  adjustment's permanent identity. Prefer rolling back code and keeping the
  schema, as ADR-0003 already prefers.

## Addendum — 2026-09-30: a count carries its balance

The stock correction screen states a stocktake as a count, and the command
takes a change. So the request gained an optional `expected_quantity`: given,
the correction applies only while the warehouse still holds exactly that
many, compared under the stock lock, and is otherwise refused as
`STOCK_CHANGED` with nothing written.

It is a precondition and **not** part of the permanent fingerprint, which
keeps to the stock facts above. A retry is answered from the permanent record
before any balance is compared, so a correction that did apply is never
refused for a balance that has since moved on. See the
[stock correction report](../project-memory/stock-correction-ui-report.md).
