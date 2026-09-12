# Current Milestone

**Milestone 1: Production Foundation Without Irreversible Catalog Assumptions**

Status: **PLAN APPROVED IN PRINCIPLE — revision 2 corrections applied. Awaiting final planning diff review before M1-001 starts.**

Plan: [`milestone-1-plan.md`](milestone-1-plan.md) · 28 tasks · 35 physical tables · 4 gates
Branch: `feat/foundation-milestone-1`

## Gates

| Gate | Scope | Tasks | Exit criterion |
|---|---|---|---|
| **M1A** | Platform & foundation | M1-001 … M1-009 (9) | `docker compose up` gives a running API with migrations, Telegram auth and RBAC; CI green |
| **M1B** | First complete Sale vertical slice | M1-010 … M1-016, M1-019 (8) | A product can be created, stock received and sold — including `FOUND_DURING_SALE` — with every M1B invariant proven by test |
| **M1C** | Refund, transfer, catalog pipeline, legacy import | M1-017, M1-018, M1-020 … M1-023 (6) | Mistakes recoverable, goods move between stores, NL intake works on a real corpus, legacy lists imported as traceable opening balances |
| **M1D** | Client, E2E, release | M1-024 … M1-028 (5) | Sellers can work in Telegram, golden paths pass E2E, restore drill executed |

## Ready / blocked

- **M1A is unblocked** and depends on no open question.
- **M1-013 blocked by Q2** — is stock counted per size, or model + colour only?
- **M1-016 blocked by Q1** — currency; price from a price list or typed at sale; discounts?
- **M1-023 blocked by U11** — two or three real notebook/PDF pages are needed for the parser corpus.
- Q4 (users and devices) and Q5 (transfer confirmation) have working defaults and block nothing.

## Standing constraints for this milestone

- Do not freeze the final taxonomy or aggressive auto-match thresholds.
- No LLM parsing, no embeddings (confirmed).
- `ProductFamily` has independent identity; `(concept, source, garment_type)` is a matching signal, never a unique constraint — see ADR-0002.
- Sentinel rows only where the business genuinely has that state; use `UNIQUE NULLS NOT DISTINCT` where a unique constraint truly belongs. PostgreSQL ≥ 15, pinned to 17.
- Continue collecting real store datasets in parallel with M1A/M1B.
