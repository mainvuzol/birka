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
