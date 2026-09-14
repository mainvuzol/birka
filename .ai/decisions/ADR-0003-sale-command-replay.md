# ADR-0003 — Durable sale replay and complete basket locks

Status: Implemented and independently reviewed, 2026-09-14.

A retained unique command ID prevents duplicate sales, but cannot prove payload equality or recover the original API response after the short-lived idempotency cache expires. The prior implementation returned an unhandled unique-constraint error in that case.

Persist a SHA-256 fingerprint of normalized, validated command facts (actor, store, currency, ordered lines, corrections) and the original response on Sale. Revision `0003_sale_replay` adds nullable fields; 0002 stays immutable. Existing rows retain NULL because historical receipt facts do not establish the original request. Such retries return 409, disclose the existing sale ID only with current view permission, and remain readable through the authorized GET route.

Acquire a transaction advisory lock derived from organization and command UUID before stock locks. Its only purpose is serializing duplicate permanent commands, including simultaneous requests with different cache keys. A hash collision merely serializes unrelated commands; exact identity and payload equality still use persisted data and the unique constraint.

Inventory safety uses row locks, not advisory locks: validate all referenced stores, variants and sizes, materialize missing zero-quantity rows, then lock all distinct basket keys in the same order. Hold locks until the caller commits or rolls back. Corrections use the aggregate basket demand and exact shortfall under those locks. Zero-row materialization changes no quantity and requires no ledger movement.

Cached and durable replays recheck current permissions. Receipt responses remain frozen; no catalog lookup can rewrite a historical receipt. Transactions remain composed by the caller/API; inventory helpers never commit independently.

Downgrading 0003 drops replay metadata, not sales or their permanent unique IDs. It forfeits exact replay for those commands; production rollback therefore requires the normal migration review. Prefer rolling back application code while retaining additive columns. No production migration was run as part of this change.
