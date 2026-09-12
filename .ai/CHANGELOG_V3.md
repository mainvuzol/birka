# Changelog v3 — Adaptive Catalog & Retail Intelligence Edition

Version 3 keeps the 80/20 Product Excellence operating model and adds the project-specific catalog architecture learned from real inventory records from the two stores.

## High-leverage additions

- Flexible catalog identity: BusinessCategory -> GarmentType -> CanonicalConcept -> ProductFamily -> ProductVariant -> Size.
- SourceIdentity is separate from model identity; Belardi/Ponte/Garcia-like labels are not silently assumed to be brands.
- Raw input is immutable evidence and is never discarded after parsing.
- Slash (`/`) is contextual: it can enumerate variant values and is never treated as an alias separator by default.
- Size-level inventory supports alpha and numeric size systems.
- InventorySnapshot supports safe migration from notebooks/PDF/legacy stock lists without inventing transaction history.
- Adaptive catalog matching: verified aliases, deterministic normalization, lexical/fuzzy retrieval, structured attributes, optional embeddings, optional LLM reranking.
- Per-field confidence, candidate-margin checks, contradiction checks and explicit ambiguity states.
- Match outcomes: SAME_VARIANT, NEW_VARIANT, NEW_MODEL, NEW_CATEGORY, AMBIGUOUS.
- Human confirmation is required for uncertain matches; corrections become feedback evidence.
- AliasEvidence and CatalogFeedback improve matching immediately without unsafe online fine-tuning.
- ProductFamily prevents over-merging models with the same shop name but different source identities/construction.
- Unknown terms are preserved as unclassified descriptors instead of being guessed.
- Taxonomy remains extensible-first while core platform development begins immediately.
- A stabilization rule is defined before promoting optional descriptors into rigid schema fields.

## New workflows

- catalog-ingestion.md
- adaptive-catalog-learning.md
- legacy-inventory-snapshot-import.md
- taxonomy-stabilization.md

## New specialist skills

See `SKILL_INDEX.md` and `manifest.json` for the complete list.
