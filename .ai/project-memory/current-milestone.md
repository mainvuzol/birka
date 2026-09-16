# Current Milestone

**Milestone 1: Production Foundation Without Irreversible Catalog Assumptions**

Status: **M1A implemented. M1B met and merged. M1C opened: M1-017 (refund) is implemented, independently reviewed twice and verified; M1-018 and M1-020…M1-023 are untouched.** The local Docker Compose/PostgreSQL17 verification gap was closed on2026-09-16 in an isolated VM:361tests passed. Public production deployment and Telegram E2E remain separate.

Plan: [`milestone-1-plan.md`](milestone-1-plan.md) · 28 tasks · 36 physical tables · 22 invariants · 4 gates
Branch: `main` (M1B merged through PR #12, `d85cc13`).

Evidence: [M1B gate assessment](m1b-completion-report.md) · [M1B review fixes](m1b-review-fixes.md) · [M1-017 refund report](m1-017-refund-report.md).

## Gates

| Gate | Scope | Tasks | Exit criterion |
|---|---|---|---|
| **M1A** | Platform & foundation | M1-001 … M1-009 (9) | `docker compose up` gives a running API with migrations, Telegram auth and RBAC; CI green |
| **M1B** | First complete Sale vertical slice | M1-010 … M1-016, M1-019 (8) | A product can be created, stock received and sold — including `FOUND_DURING_SALE` — with every M1B invariant proven by test |
| **M1C** | Refund, transfer, catalog pipeline, legacy import | M1-017 ✅, M1-018, M1-020 … M1-023 (6) | Mistakes recoverable, goods move between stores, NL intake works on a real corpus, legacy lists imported as traceable opening balances |
| **M1D** | Client, E2E, release | M1-024 … M1-028 (5) | Sellers can work in Telegram, golden paths pass E2E, restore drill executed |

## Gate progress

**M1B — met.** A product can be created, stock received and sold, including `FOUND_DURING_SALE`, with every M1B invariant proven by test. Re-verified on 2026-09-15 at `d85cc13`: 288 tests passing with no skips, all lint/type/boundary/migration checks clean.

**M1C — 1 of 6 tasks.** `POST /sales/{sale_id}/refunds` returns goods and money against a sale without touching it, capped by what was actually sold minus prior returns, with restocking stated per line. Two independent reviewers found six major defects — a one-way migration, a replay that reordered its own lines, an untested advisory lock, an untestable authorization test, an API-wide 500 on text the database cannot store, and a closed store refunding money but refusing goods. All are fixed. See the [M1-017 report](m1-017-refund-report.md) for evidence and for the original questions and the [owner’s confirmed refinements](owner-decisions-2026-09-15.md). These refinements are not implemented by the existing refund command.

## Ready / blocked

**Before M1-018, update the stock-location design for the owner-confirmed shared primary warehouse and separate child warehouse.** Define store-state permissions and installment accounting before implementing those behaviors. The arbitrary-price question is resolved: it is a negotiated final price, below or above the suggested price, not a partial payment. Other independent work may continue. Q1 (money), Q2 (inventory granularity) and U11 (parser corpus) were answered at revision 3. Q4 (users and devices) and Q5 (transfer confirmation) refine already-safe defaults and can be answered during M1C/M1D.

Verification limits on the current development machine — these constrain evidence, not design:

- no Docker → the compose stack is parsed and every `${VAR}` cross-checked against `.env.example`, but **`docker compose up` has never been executed**, here or in CI;
- PostgreSQL is not installed. Sessions on Windows used a throwaway **17.9** cluster; the macOS session of 2026-09-15 had only the **16.2** build bundled in the `pgserver` wheel, so the refund work is **not verified on the pinned version 17**. Neither host reproduces the compose locale exactly: one paired ICU `uk-UA` with `--locale=C`, the other ran C libc with no ICU at all;
- the API itself does run: started under uvicorn against real PostgreSQL, it serves `/health` and completes Telegram sign-in → create product → receive → sell → refund over real HTTP. That is the release *path* exercised without the release *container*;
- frontend locked install, lint, typecheck and build pass (Node 26.5.0, 0 advisories), and the built bundle loads and renders. Telegram and E2E remain M1D.

## Docker verification update — 2026-09-16

The environment limitations above describe prior sessions and are superseded for Docker/PostgreSQL by the [isolated verification report](docker-postgresql17-verification.md): real Docker builds/startup, PostgreSQL17.11 with the exact Compose locale,361tests, migration round trip, TLS proxy and real HTTP sale/refund flow all passed. The disposable VM and its resources were removed afterward. No host Docker installation or work-environment configuration was changed.

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

## New scope confirmed on 2026-09-15

[Owner decisions](owner-decisions-2026-09-15.md): shared and child warehouses, blocked/archived store states, intact/damaged returned units, negotiated final prices and full/installment payment, purchase installments and no age-based return cutoff. Current `store + variant + size` inventory is the implemented baseline, not the final warehouse design. Update the architecture/migration plan before M1-018; do not treat a shared-warehouse sale as an inter-store transfer. Payment tracking extends the existing roadmap and needs explicit task placement; no implementation or completion is implied by recording it.
