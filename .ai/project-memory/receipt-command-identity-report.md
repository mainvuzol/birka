# A goods receipt becomes a business operation — 2026-09-29

Baseline: `b5f8988` (the till, PR #34) plus the hot-path branch.
Status: implemented and verified locally. Migration `0016_goods_receipt`.
Decision: [ADR-0006](../decisions/ADR-0006-goods-receipt-command-identity.md).

## How this came up

The next increment was meant to be the receiving screen — the app can sell but
cannot take delivery, so stock only enters through the legacy import or the
seed. Reading `POST /inventory/receipts` before building on it, the payload had
no `command_id`, unlike every other command that writes stock.

Checked rather than assumed, against the code as it was:

| step | result |
|---|---|
| receive 10 units | 10 units, 1 lot |
| replay the same Idempotency-Key | replayed, still 10 — the cache works |
| delete the idempotency record (what 7 days do) | — |
| replay the same Idempotency-Key | **20 units, 2 lots** |

So a goods receipt was idempotent for exactly as long as its response cache.
Invariant I20 exists to prevent precisely this — "a critical command can never
create a second business operation, **at any distance in time**" — and it had
been applied to sales, refunds, transfers and legacy imports, but not to
receiving. Nothing in the plan, the ADRs or the tests recorded a decision to
exempt it.

The window is reachable by the ordinary client pattern, not an exotic one: a
command written to durable storage *before* it is sent and replayed when the
app is opened again. That is exactly what the till does for a sale, and it is
what the receiving screen was about to do for a delivery. Building that screen
first would have shipped the bug with a client that reaches it.

## What changed

A delivery is now a row, not just its side effects. `goods_receipt` mirrors
`transfer`: the warehouse that received the goods and the store on whose
authority they arrived, the actor, the notes, a permanent `command_id` under
`UNIQUE (organization_id, command_id)`, and — following ADR-0003 —
`command_fingerprint` and `response_snapshot`, so a retry arriving after the
cache expires receives the original receipt instead of a unique violation.

`stock_lot.goods_receipt_id` links the lots a delivery created. Nullable,
because most lots have no receipt: an opening balance comes from a legacy list
and a restocking refund makes a lot from goods already here. Lots predating
`0016` keep NULL rather than being given an invented delivery.

The warehouse is in the permanent fingerprint deliberately. Without it, the
same `command_id` retried against a *different* warehouse would be judged a
retry and answered "received" about goods that never went there. That is one
of the mutations below.

`command_id` is **required**. An optional permanent identity is not an
invariant; 35 in-repo call sites were updated and there are no external ones.

## Changed files

- `backend/migrations/versions/0016_goods_receipt.py` — new.
- `backend/app/modules/inventory/models.py` — `GoodsReceipt`, `StockLot.goods_receipt_id`.
- `backend/app/api/v1/inventory.py` — required `command_id`, permanent
  fingerprint, durable replay, the receipt row, `id` on the response.
- `backend/app/models_registry.py` — the new model.
- `backend/tests/integration/test_receipt_command_identity.py` — new, 6 tests.
- `backend/tests/unit/test_migration_history_is_frozen.py` — froze `0015`,
  which has shipped; `0016` is now the one under development.
- 10 test files — `command_id` on every receipt payload.
- `.ai/decisions/ADR-0006-…`, plan (I20), this report.

## Verification

- **916 backend tests passed**, 0 skipped (910 at baseline + 6), isolated
  PostgreSQL 16.2.
- Migration `0016` applies, **downgrades and re-upgrades cleanly**;
  `alembic check` reports no drift.
- Ruff, ruff-format (157 files), `mypy app scripts` (85 files),
  import-linter, all clean.

**Mutation testing.** Three mutations, two caught, one survived and was
informative:

| Mutation | Result |
|---|---|
| The durable replay check never matches | **caught** — 4 tests fail |
| The warehouse is dropped from the permanent fingerprint | **caught** — the wrong-warehouse test fails |
| The replay path skips its permission recheck | **survived** |

The survivor was a real finding about the new code rather than a missing test.
The permanent fingerprint binds the actor and the acting store, so a request
can only reach the replay path if it matches one *this same person* made from
*this same store* — and the handler has already required `inventory:receive`
there, and access to that warehouse, before the claim. The inner recheck could
never refuse anything. It was removed and the reason written down, rather than
left as a line no test can reach. The test that covered it still earns its
place: it proves the endpoint refuses a revoked receiver (invariant I13),
which it does at the top.

## Still open

**`POST /inventory/adjustments` has the identical defect**, reproduced the same
way: a `STOCKTAKE` of +7 replayed after the cache expires leaves 14. It is not
fixed here because the fix shape is genuinely different and deserves its own
decision — an adjustment writes one ledger row, has no aggregate to hang a
`command_id` on, and its `quantity_before`/`quantity_after` are computed rather
than stored, so there is nothing to replay a response from. Three options are
set out in ADR-0006's consequences. Manager-only and rarer than receiving, but
it is a silent stock change and it should not stay open long.

**The receiving screen is still not built.** That was the original intent of
this increment and remains the next one; the backend it needs is now safe to
build on.
