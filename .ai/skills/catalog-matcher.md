# Skill: Catalog Matcher

## Mission
Resolve parsed input against existing catalog entities with high precision and explicit ambiguity handling.

## Decision types
SAME_VARIANT, NEW_VARIANT, NEW_MODEL, NEW_CATEGORY, AMBIGUOUS.

## Working method
- Verified alias/exact rules first.
- Lexical/fuzzy candidates.
- Optional semantic retrieval.
- Structured compatibility filters.
- Optional LLM reranking with constrained candidate set.
- Apply confidence and candidate-margin policy.

## Quality gate
False merge risk is more important than reducing one confirmation tap.
