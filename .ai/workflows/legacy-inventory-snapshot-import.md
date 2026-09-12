# Workflow: Legacy Inventory Snapshot Import

1. Register source document/snapshot metadata.
2. Preserve each original line.
3. Parse rows without writing authoritative stock.
4. Review AMBIGUOUS rows and unknown quantity/size distribution.
5. Resolve or explicitly preserve unknowns according to migration policy.
6. Approve snapshot.
7. Create traceable opening-balance StockMovements.
8. Verify aggregate quantities against the approved source.
