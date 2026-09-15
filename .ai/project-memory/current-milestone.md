# Current Milestone

**Milestone 1: Production Foundation Without Irreversible Catalog Assumptions**

Status: **M1A implemented. M1B implemented end to end — a product can be created, received into stock and sold, including `FOUND_DURING_SALE` — reviewed by three independent reviewers, four blocking defects fixed, and verified on PostgreSQL 17.9 with 278 passing tests and no skips (2026-09-15). The one gate element still unverified is the release environment: `docker compose up` has never been executed anywhere.**

Plan: [`milestone-1-plan.md`](milestone-1-plan.md) · 28 tasks · 36 physical tables · 22 invariants · 4 gates
Branch: `feat/m1b-product-creation` (baseline: `1683dfb`, PR #10 merged).

Evidence: [M1B gate assessment](m1b-completion-report.md) · [M1B review fixes](m1b-review-fixes.md).

## Gates

| Gate | Scope | Tasks | Exit criterion |
|---|---|---|---|
| **M1A** | Platform & foundation | M1-001 … M1-009 (9) | `docker compose up` gives a running API with migrations, Telegram auth and RBAC; CI green |
| **M1B** | First complete Sale vertical slice | M1-010 … M1-016, M1-019 (8) | A product can be created, stock received and sold — including `FOUND_DURING_SALE` — with every M1B invariant proven by test |
| **M1C** | Refund, transfer, catalog pipeline, legacy import | M1-017, M1-018, M1-020 … M1-023 (6) | Mistakes recoverable, goods move between stores, NL intake works on a real corpus, legacy lists imported as traceable opening balances |
| **M1D** | Client, E2E, release | M1-024 … M1-028 (5) | Sellers can work in Telegram, golden paths pass E2E, restore drill executed |

## Ready / blocked

**No task is blocked by an open question.** Q1 (money), Q2 (inventory granularity) and U11 (parser corpus) were answered at revision 3. Q4 (users and devices) and Q5 (transfer confirmation) refine already-safe defaults and can be answered during M1C/M1D.

Verification limits on the current development machine — these constrain evidence, not design:

- no Docker → the compose stack is parsed and cross-checked against `.env.example`, but **`docker compose up` has never been executed**, here or in CI;
- PostgreSQL is not installed; a throwaway **17.9** cluster is created per session on a non-standard port and destroyed afterwards. Windows cannot use the `C.UTF-8` libc locale the compose file sets, so the local cluster pairs ICU `uk-UA` with `--locale=C`; the ICU half matches production, the libc half does not;
- frontend locked install, lint and build pass locally on Node 24 with 0 advisories. Telegram and E2E remain M1D.

## Standing constraints for this milestone

- Do not freeze the final taxonomy or aggressive auto-match thresholds.
- No LLM parsing, no embeddings (confirmed).
- `ProductFamily` has independent identity; `(concept, source, garment_type)` is a matching signal, never a unique constraint — see ADR-0002.
- Business uniqueness of critical commands rests on a permanent `command_id`, never on idempotency-record retention.
- `ParseResult` is deterministic per `(raw_text, parser_version)`; catalog knowledge enters only at matching.
- Currency is UAH; `SaleItem` freezes its own money values; acquisition cost lives on `StockLot`; no discount engine.
- Inventory is `store + variant + size`; `UNKNOWN_SIZE` is a real domain state; reclassification is audited.
- Sentinel rows only where the business genuinely has that state; use `UNIQUE NULLS NOT DISTINCT` where a unique constraint truly belongs. PostgreSQL ≥ 15, pinned to 17.
- Continue collecting real store datasets in parallel with M1A/M1B.
