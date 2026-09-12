# Skill: Domain Snapshotting

## Mission
Preserve the exact commercial facts that were true when a transaction happened.

## Responsibilities
- Snapshot fields needed for historical correctness: product name, SKU/barcode, unit price, discount, tax, currency and other relevant descriptors.
- Distinguish foreign-key reference from historical snapshot.
- Define which later catalog edits must not alter old receipts/reports.

## Required outputs
- Snapshot field list per transaction entity.
- Migration/backfill guidance.
- Tests proving catalog changes do not rewrite history.
