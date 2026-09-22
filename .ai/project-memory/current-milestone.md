# Current Milestone

**Milestone 1: Production Foundation Without Irreversible Catalog Assumptions**

Status: **M1A implemented. M1B met and merged. M1C: M1-017 (refund), M1-029 (stock locations) and M1-030 («фізично відсутній») merged; M1-018 (transfers between warehouses) implemented, independently reviewed and verified on PostgreSQL 17.11 on branch `feat/m1-018-transfers` — awaiting the owner's review, push and merge.** The stock key lives on the physical warehouse rather than the selling store, so one shared pile is one balance that two stores contend on, and goods now move between warehouses only as a paired, audited transfer. M1-020…M1-023 are untouched. Docker/PostgreSQL 17 verified the previous baseline on 2026-09-16; the new foundation has local PostgreSQL 16.2 evidence and still needs PostgreSQL 17 CI. Public deployment and Telegram E2E remain separate.

Plan: [`milestone-1-plan.md`](milestone-1-plan.md) · 29 tasks · 38 physical tables · 24 invariants · 4 gates
Branch: `main` at `6a015f1` (M1-030 merged through PR #18). M1-018: `feat/m1-018-transfers`, local commits, not pushed.

Evidence: [M1B gate assessment](m1b-completion-report.md) · [M1B review fixes](m1b-review-fixes.md) · [M1-017 refund report](m1-017-refund-report.md) · [Docker/PostgreSQL 17 verification](docker-postgresql17-verification.md).
[ADR-0004 stock locations](../decisions/ADR-0004-stock-locations.md) · [design and migration plan](m1-018-stock-location-design.md) · [M1-029 foundation report](m1-029-foundation-report.md) · [M1-029 completion report](m1-029-completion-report.md) · [M1-030 report](m1-030-missing-at-sale-report.md) · [M1-018 transfer report](m1-018-transfer-report.md).

## Gates

| Gate | Scope | Tasks | Exit criterion |
|---|---|---|---|
| **M1A** | Platform & foundation | M1-001 … M1-009 (9) | `docker compose up` gives a running API with migrations, Telegram auth and RBAC; CI green |
| **M1B** | First complete Sale vertical slice | M1-010 … M1-016, M1-019 (8) | A product can be created, stock received and sold — including `FOUND_DURING_SALE` — with every M1B invariant proven by test |
| **M1C** | Refund, transfer, catalog pipeline, legacy import | M1-017 ✅, **M1-029 ✅**, M1-030 ✅, **M1-018 ✅** (branch, awaiting merge), M1-020 … M1-023 (8) | Mistakes recoverable, goods move between stores, NL intake works on a real corpus, legacy lists imported as traceable opening balances |
| **M1D** | Client, E2E, release | M1-024 … M1-028 (5) | Sellers can work in Telegram, golden paths pass E2E, restore drill executed |

## Gate progress

**M1B — met.** A product can be created, stock received and sold, including `FOUND_DURING_SALE`, with every M1B invariant proven by test. Re-verified on 2026-09-15 at `d85cc13`: 288 tests passing with no skips, all lint/type/boundary/migration checks clean.

**M1-018 — transfers between warehouses. Implemented, reviewed and verified; not merged** ([report](m1-018-transfer-report.md)). `POST /api/v1/transfers` writes a `TRANSFER_OUT` and a matching `TRANSFER_IN` in one transaction — never a sale, never money — all or nothing, decided before anything is written. Invariant I24's pairing half is now enforced at the ledger's door for every caller; its "no disguised transfer" half is kept by construction and review, because the mechanical rule refused a real sale. Three independent reviews found no blocking defect; five major and ten minor findings are fixed or put to the owner. Five questions are the owner's: transfer confirmation (Q5), whether `can_sell` alone may take goods out of a warehouse, what closing a warehouse means, the return path from the child warehouse, and organization-wide managers.

**M1C — 4 of 8 tasks** (M1-017, M1-029, M1-030 merged; M1-018 on its branch). `POST /sales/{sale_id}/refunds` returns goods and money against a sale without touching it, capped by what was actually sold minus prior returns, with restocking stated per line. Two independent reviewers found six major defects — a one-way migration, a replay that reordered its own lines, an untested advisory lock, an untestable authorization test, an API-wide 500 on text the database cannot store, and a closed store refunding money but refusing goods. All are fixed. See the [M1-017 report](m1-017-refund-report.md) for evidence and for the original questions and the [owner’s confirmed refinements](owner-decisions-2026-09-15.md). These refinements are not implemented by the existing refund command.

**M1-029 — stock locations. Implemented and verified** ([completion report](m1-029-completion-report.md)). The owner answered all four blocking questions on 2026-09-17; migration `0006_stock_rekey` moved the stock key to the warehouse, creating one warehouse per existing store and **merging nothing**. What follows is why it was needed.

**Background.** The owner confirmed on 2026-09-15 that one primary warehouse serves both stores and that store of sale, storage location and ownership are three different things. Today `inventory` is keyed `(store_id, variant, size)`, which cannot express that: the shared pile must either be recorded twice — two rows that never contend, so two sellers can sell the same last coat — or kept under one store, where the other store's sellers reach it only by minting stock through `FOUND_DURING_SALE`. Both corrupt the balance silently.

[ADR-0004](../decisions/ADR-0004-stock-locations.md) introduced `stock_location` + `store_location_access`, re-keyed inventory/lot/ledger/snapshot to the location, and recorded the source location on each sale line. An architecture review found four blocking defects in the first draft — including a migration that could not run, because `stock_movement` is append-only — and all were fixed before implementation. **Shipped in two migrations:** `0005_stock_locations` (the empty foundation tables) and `0006_stock_rekey` (the re-key, backfill and API change). A second independent review of the shipped work found two blocking defects — a downgrade that stranded rows and permanently blocked re-upgrade, and an undocumented capability asymmetry in the in-sale correction — plus five major ones; all are fixed and pinned by tests. Verification: **394 tests** on isolated PostgreSQL 16.2 and again on **real PostgreSQL 17.11** in an isolated Docker run (2026-09-17), migration round trip lossless inside its stated bounds, no schema drift. **Still not measured: the `POST /sales` p95 budget with the added access join.**

## Ready / blocked

**M1-018 (transfers between warehouses) is implemented** on `feat/m1-018-transfers` and waits for the owner's review, push and merge; its five open questions refine defaults that are already safe and block nothing. The catalog track (M1-020…M1-023) is independent of it and not started. **M1-030 («фізично відсутній») is done**: the owner answered Q-E on 2026-09-17 — the sale proceeds for the quantity that is actually there — and it shipped bounded by invariant I25, with its own permission and migration `0007`. See the [report](m1-030-missing-at-sale-report.md). The four questions that blocked M1-029 are answered (ADR-0004 §6). Define store-state permissions and installment accounting before implementing those behaviors. The arbitrary-price question is resolved: it is a negotiated final price, below or above the suggested price, not a partial payment. Other independent work may continue. Q1 (money), Q2 (inventory granularity) and U11 (parser corpus) were answered at revision 3. Q4 (users and devices) and Q5 (transfer confirmation) refine already-safe defaults and can be answered during M1C/M1D.

Verification limits on the current development machine — these constrain evidence, not design:

- **Docker and PostgreSQL 17 are no longer a gap.** Both were closed on 2026-09-16 in a disposable VM; see the section below. The host itself still has no Docker, so day-to-day work runs against a `pgserver` PostgreSQL 16.2 and anything version-sensitive needs the isolated run to confirm it.
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
- Inventory is `location + variant + size` since M1-029 (ADR-0004), previously `store + variant + size`. A sale is attributed to the store that made it, the goods belong to a warehouse, and the two are never conflated. `UNKNOWN_SIZE` is a real domain state; reclassification is audited.
- Sentinel rows only where the business genuinely has that state; use `UNIQUE NULLS NOT DISTINCT` where a unique constraint truly belongs. PostgreSQL ≥ 15, pinned to 17.
- Continue collecting real store datasets in parallel with M1A/M1B.

## New scope confirmed on 2026-09-15

[Owner decisions](owner-decisions-2026-09-15.md): shared and child warehouses, blocked/archived store states, intact/damaged returned units, negotiated final prices and full/installment payment, purchase installments and no age-based return cutoff. Current `store + variant + size` inventory is the implemented baseline, not the final warehouse design. Update the architecture/migration plan before M1-018; do not treat a shared-warehouse sale as an inter-store transfer. Payment tracking extends the existing roadmap and needs explicit task placement; no implementation or completion is implied by recording it.
