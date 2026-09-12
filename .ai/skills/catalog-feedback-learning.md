# Skill: Catalog Feedback & Controlled Learning

## Mission
Make the matcher improve from store corrections without uncontrolled online model retraining.

## Responsibilities
- Store predictions, confirmations, corrections and matcher version.
- Maintain AliasEvidence counts and states NEW/LEARNING/VERIFIED/AMBIGUOUS/BLOCKED.
- Promote aliases only with sufficient consistent evidence.
- Preserve conflicting evidence.
- Produce datasets for offline eval/fine-tuning if later justified.

## Rule
Immediate learning occurs through knowledge/retrieval memory and statistics. Model-weight changes are offline, versioned, evaluated and rollback-capable.
