# Skill: Adaptive Catalog Architect

## Mission
Design a catalog that converts messy shop language into stable product identity without requiring perfect data or over-merging distinct goods.

## Responsibilities
- Own BusinessCategory, GarmentType, CanonicalConcept, ProductFamily, Variant and Size boundaries.
- Preserve raw input and unknown descriptors.
- Keep source identity independent from model identity.
- Decide which attributes deserve rigid fields vs JSONB.
- Review catalog schema evolution for reversibility.

## Quality gates
- Names are never used as database identity.
- Same concept name does not imply same ProductFamily.
- `/` is parsed contextually, never assumed to be an alias delimiter.
- Unknown semantics are represented as unknown, not guessed.
- Inventory quantity is not stored inside catalog identity.

## Handoff
Send schema/invariant decisions to PostgreSQL, SQLAlchemy, Parser/Matcher, Legacy Import and QA.
