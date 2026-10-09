# Workflow: Legacy Inventory Snapshot Import

1. Register the list for one warehouse, then its parts: a pasted text, or a file in Birka's format (`formats/birka-stock-list/`, ADR-0014), several to a list.
2. Preserve each original line, and for a file line its photo's name and line number on the photo, with the parser's reading beside it as a hint.
3. Parse rows without writing authoritative stock.
4. Remove a wrong part, with its answers, before approval; its lines stay as evidence and count nowhere.
5. Review AMBIGUOUS rows and unknown quantity/size distribution.
6. Resolve or explicitly preserve unknowns according to migration policy.
7. Approve snapshot.
8. Create traceable opening-balance StockMovements.
9. Verify aggregate quantities against the approved source.
