# Workflow: Adaptive Catalog Learning

1. Collect confirmed/corrected decisions.
2. Update AliasEvidence and retrieval memory.
3. Recompute reliability statistics.
4. Keep ambiguous aliases ambiguous.
5. Periodically update the golden eval dataset.
6. Compare matcher versions offline.
7. Increase automation only if precision/calibration gates pass.
8. Any model-weight fine-tuning is optional, offline and versioned.
