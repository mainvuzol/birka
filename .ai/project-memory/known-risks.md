# Known Risks

- Over-merging distinct products because they share a shop nickname/model name.
- Treating source identities as brands without business confirmation.
- Treating slash-separated values as aliases instead of distinct variants.
- Fabricating size/color quantity distribution during legacy import.
- Prematurely freezing taxonomy before enough real inventory samples are collected.
- LLM overconfidence on unfamiliar descriptors.
- Duplicate sales/stock corruption under retry/concurrency.
- Incorrect cross-store inventory authorization/transfer behavior.
- Client-supplied text that Python accepts and PostgreSQL cannot store (NUL, lone surrogates) turning an authorized request into a 500 after the write has begun. Guarded by `app/core/text.py`; any new free-text field must use it.
- Refund money drifting from the receipt if any future code path recomputes an amount instead of reading the frozen `SaleItem`.
- Shared stock recorded as two per-store balances: the two rows never contend, so the conditional update that prevents overselling has nothing to serialise on, and one coat can be sold twice. **Addressed by M1-029**: the balance is keyed by warehouse, so two stores selling one pile contend on one row. The risk returns for any future table that keys stock by store again.
- Granting a store `can_sell` on a warehouse whose contents were recorded under a different store. The migration deliberately grants nothing beyond today's reach; every shared arrangement is a deliberate data step, and combining two balances is never automatic.
- Combining the two stores' existing balances on the assumption that they are the same goods. Whether they are is unknowable from the database; a wrong merge is an irreversible loss of stock identity. Any correction must be an audited adjustment, never a migration.
- A seller in one store minting stock into a shared warehouse through `FOUND_DURING_SALE`, inflating a balance the other store depends on.
- Over-refunding under concurrency: invariant I9 has no database backstop and rests on one `FOR UPDATE`, so the reconciliation query cannot detect a violation — stock and ledger stay consistent while more is refunded than was sold.

### M1-029 foundation verification — 2026-09-17

Stock is keyed by warehouse as of `0006_stock_rekey`, and location access is enforced on every read and write. Live risks, in order:

- **PostgreSQL 17 is verified for this change set** (2026-09-17, isolated Docker run: 6 revisions, round trip, 394 tests, invariant sweep — [report](docker-postgresql17-verification.md#run-2--2026-09-17--the-m1-029-stock-re-key)). No longer a risk; kept here so nobody re-opens it.
- **`POST /sales` p95 was not re-measured** with the added access join, against the ≤ 500 ms budget the design sets. Still open: a functional run on PostgreSQL 17 is not a load profile.
- **`0006` refuses to run if `stock_location` or `store_location_access` already has rows.** Do not provision a warehouse by hand on a database still at `0005`.
- **Rollback of `0006` has hard bounds** and refuses outside them: a shared warehouse, a store with two warehouses, or a warehouse no store reaches. All three are states normal operation will reach — the shared-access data step and M1-018 both close the window. Prefer rolling back application code while keeping the schema, as ADR-0003 already prefers.
- **A migrated warehouse is always active**, never inheriting the store's flag; do not read a location's state as a statement about a shop.

### M1-018 transfers — 2026-09-22

Goods now move between warehouses (`POST /api/v1/transfers`, [report](m1-018-transfer-report.md)). Live risks, in order:

- **`can_sell` at the source is enough to take goods out, and that rule is a design proposal, not an owner decision.** With design §3's rows, a child-store manager can move the whole shared pile into the child's own warehouse, and then neither store can move it back: the child has no `can_receive` at the shared warehouse, the primary store no `can_sell` at the child's. Recovery is an access row or two audited adjustments. Pinned by `test_can_sell_alone_at_the_source_is_enough_to_move_goods_out`, so changing it is a decision rather than a drift. Owner question 2 in the report.
- **A closed warehouse cannot be emptied by a transfer.** Its stock stays readable but cannot move until it is reopened. Nothing in the application closes a warehouse today — only a direct operator action does, and the same action reopens it — so the risk is operational. Owner question 3.
- **Single-step transfers record goods as arrived the moment they leave** (assumption A8, Q5). Goods lost in transit would still be on the destination's books until a stocktake finds them.
- **Half of invariant I24 has no mechanical check.** Pairing is enforced at the ledger's door; "nothing else moves goods between places" holds only because every command is built that way. A new stock command must be reviewed against it; the cheap enforcement point, if one is wanted, is a per-location net ≤ 0 check inside the sale command, which has both of its ledger calls in hand.
- **A non-HTTP caller must build its scope from the database.** Real requests do, so a deactivated store is refused on replay; a hand-built or stale scope would replay a success for it. The future Telegram handler must use the same scope resolution.
- **Rolling back below `0007` is bounded by `0006`.** Every transfer needs a store that reaches two warehouses, which `0006`'s downgrade refuses by name; if the access rows were edited back to one-to-one while transfer rows remain, it fails on `NOT NULL` inside its own transaction instead. Safe, but not a friendly message. Prefer rolling back code and keeping the schema.

## Business review — 2026-09-22

See [review evidence and priorities](business-model-review-2026-09-22.md). Fresh migrate→seed reproduced two stores but zero warehouses/access (setup blocker). Existing single-step transfers immediately credit destination stock and do not implement the newly requested in-transit/arrival process. Shared/private topology needs explicit provisioning/policy; current generic grants only represent it when correctly configured. Postal arrival versus acceptance and organization-manager authority remain unanswered. 475 tests passed locally on PostgreSQL 16.2; this does not cover the missing setup or new staged behavior.
