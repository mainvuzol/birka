# ADR-0006 — A goods receipt is a business operation

Status: accepted (2026-09-29), implemented in `0016_goods_receipt`.
Extends [ADR-0003](ADR-0003-sale-command-replay.md). Invariant I20.

## Context

Invariant I20 says a critical command can never create a second business
operation, **at any distance in time**, and it is `DB_ENFORCED` by a permanent
`UNIQUE (organization_id, command_id)`. It was applied to `sale`, `refund`,
`transfer` and, since M1-023, `inventory_snapshot`.

`POST /inventory/receipts` had no `command_id` at all. Its only protection was
the `IdempotencyRecord` cache, which the idempotency module's own docstring
describes as *"a cache, not an invariant… Deleting every row here must never
allow a duplicate sale."* For a receipt, deleting a row here allowed exactly
that. Reproduced against the code before this revision:

| step | result |
|---|---|
| receive 10 units | 10 units, 1 lot |
| replay the same Idempotency-Key | replayed, still 10 units |
| delete the idempotency record (what 7 days do) | — |
| replay the same Idempotency-Key | **20 units, 2 lots** |

Nothing in the plan, the ADRs or the tests recorded a decision to exempt
receipts. It reads as an omission rather than a choice.

The window is not theoretical. The client pattern that reaches past seven days
is the ordinary one this project already uses: a command written to durable
storage *before* it is sent and replayed when the app is opened again. That is
exactly what the till does for a sale, and it is what a receiving screen would
do for a delivery.

## Decision

**Receiving goods becomes a first-class operation with a permanent identity**,
modelled on `transfer`.

- A new `goods_receipt` row per delivery: the warehouse that received the
  goods and the store on whose authority they arrived — two facts, because a
  shared warehouse is where they differ (ADR-0004 §2.5) — the actor, the
  notes, and `command_id` under `UNIQUE (organization_id, command_id)`.
- Following ADR-0003, `command_fingerprint` and `response_snapshot`, so a
  retry arriving after the cache expires receives the original receipt rather
  than an unhandled unique violation. Both nullable, for the reason `0004`
  gives: a NOT NULL column dropped by `downgrade()` cannot be re-added over
  existing rows, which would make the revision a one-way door.
- `stock_lot.goods_receipt_id`, nullable and `RESTRICT`. Most lots have no
  receipt and never will — an opening balance comes from a legacy list, a
  restocking refund makes a lot from goods already here — and lots that
  predate this revision keep NULL rather than being given an invented one.
- `command_id` is **required** on `POST /inventory/receipts`. An optional
  permanent identity is not an invariant.

The permanent fingerprint covers the warehouse, the lines, the acting store
and the actor. The warehouse is in it deliberately: without it, the same
`command_id` retried against a different warehouse would be judged a retry and
answered "received" about goods that never went there.

## Consequences

Positive:

- I20 now covers every command that creates stock from outside the system.
- A delivery has an identity, which the domain wanted anyway: lots that
  arrived together are linked, and `notes` has one home instead of being
  copied onto every lot.
- The receiving screen can use the same durable journal as the till without
  risking a doubled delivery.

Negative:

- A breaking API change. Every caller must send `command_id`; 35 in-repo call
  sites were updated. There are no external callers.
- Rolling back `0016` keeps the stock but loses every receipt's permanent
  identity, so re-upgrading leaves those receipts unprotected against a replay
  of their own `command_id`. Prefer rolling back code and keeping the schema,
  as ADR-0003 already prefers.
- **`POST /inventory/adjustments` still has the same defect** and is not fixed
  here. Reproduced the same way: a `STOCKTAKE` of +7 replayed after the cache
  expires leaves 14. The fix shape is genuinely different, which is why it is
  not bundled: an adjustment writes one ledger row and has no aggregate, and
  `quantity_before`/`quantity_after` are computed rather than stored, so there
  is nothing to replay a response from. The options are a `stock_adjustment`
  aggregate mirroring this one, a `command_id` on `stock_movement` under a
  partial unique index that refuses a duplicate instead of replaying it, or
  accepting the 7-day window for a manager-only command. That is a decision,
  not an oversight, and it belongs in its own revision.

## Alternatives considered

- **`command_id` on `stock_lot`.** A receipt makes one lot per line, so the
  uniqueness would have to include the stock key, and a partial duplicate
  would still get through. There would also be nowhere to keep the response.
- **Leave it to the cache and make the client's journal session-only.** This
  is the status quo dressed as a decision: it weakens the client to protect a
  server contract, and any retry infrastructure or script reaches past it.
- **Make `command_id` optional.** Then the invariant holds only for callers
  that opt in, which is not what `DB_ENFORCED` means.
