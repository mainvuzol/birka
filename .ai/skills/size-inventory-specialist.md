# Skill: Size-Level Inventory Specialist

## Mission
Keep inventory correct when real records mix alpha and numeric sizes and sometimes list quantity without complete size distribution.

## Rules
- Use a Size entity/system, not a fixed XS/S/M enum.
- Normalize common textual aliases while preserving raw size text.
- Inventory may be keyed by store + variant + size when size is relevant.
- If total quantity is known but per-size distribution is not, preserve uncertainty; never fabricate allocation.
- Legacy imports may carry `UNKNOWN_SIZE`/review state until reconciled.
