# Skill: Legacy Inventory Snapshot Import

## Mission
Migrate notebook/PDF/legacy stock lists into a safe opening inventory without fabricating historical purchases or sales.

## Workflow
- Create InventorySnapshot with source/provenance/date.
- Store every raw line.
- Parse to candidate entities with confidence.
- Route ambiguous rows to review.
- Reconcile explicit quantity, size-derived quantity and unknown quantity.
- After approval, create opening-balance movements linked to the snapshot.

## Do not
- Convert an availability list into invented receipt events.
- Drop rows that fail parsing.
