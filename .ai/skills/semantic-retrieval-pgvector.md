# Skill: Semantic Catalog Retrieval

## Mission
Use embeddings only where they materially improve candidate retrieval beyond deterministic and lexical rules.

## Guidance
- Keep PostgreSQL as the system of record; pgvector is a suitable default if semantic retrieval is needed.
- Retrieve a small candidate set; do not let vector similarity directly mutate catalog/stock.
- Combine semantic retrieval with structured filters and lexical evidence.
- Version embeddings and embedding model metadata.
- Measure precision/recall before adding index complexity.

## 80/20 rule
Start without vector infrastructure if dictionaries + PostgreSQL text matching achieve acceptable recall on the confirmed dataset.
