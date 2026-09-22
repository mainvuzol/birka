# Business model and warehouse review — 2026-09-22

Status: **review completed; one reproduced setup defect and business-model extensions remain open.** Reviewed merged commit `8481348` (PR #19), after M1-029 and M1-030. Application code and historical migrations were not changed in this review.

## Owner's latest decisions

These supersede the open questions in the M1-018 report where explicitly answered; implementation is separate.

1. Sending goods must have an **in-transit** state; arrival must be recorded later. The owner mentions receipt by a customer or arrival at the post office. Whether postal arrival makes stock available is **not settled**; do not silently equate carrier arrival with physical warehouse acceptance. Also distinguish an inter-warehouse recipient from a retail customer: customer delivery is not a warehouse-to-warehouse stock transfer.
2. There is a primary store and its shared warehouse, used by the primary store and all its child stores. Each child may optionally have its own warehouse. A child's own warehouse is operated by that child, not by siblings. Warehouse control/access does not establish ownership of each garment or lot.
3. A closed child warehouse means **temporarily paused**, following the current behavior: stock operations at either end are refused, existing balances remain visible to authorized users. This does not archive goods or zero balances. Store state and warehouse state remain separate; pausing a child must not pause the shared warehouse.
4. Shared-to-own and own-to-shared movement must fit this topology, with the acting store, user and time visible. The owner's answer does not specify that all sellers may transfer, adjust or receive without separate person permissions.
5. Organization-wide manager bypass was **not answered**. Keep the existing refusal of unauthorized warehouse access until decided. Asked explicitly whether such a manager should require explicit access or operate every warehouse.

Two clarification questions were sent: postal arrival versus stock acceptance, and organization-wide manager authority. No answer had arrived when this report was written.

## Findings

### P1 — documented clean setup provisions no warehouses

`README.md:66` instructs organization seeding after migrations. `backend/scripts/seed_organization.py:43–58` creates stores but no locations/access. Migration `0006_stock_location_rekey.py:93–106` only provisions locations for stores already present when it runs.

**Reproduced on a fresh, isolated PostgreSQL database:** upgrade through 0008, then run the documented seed with synthetic user/org. Result: **2 stores, 0 stock locations, 0 access rows**. This blocks using the documented fresh installation for stock receipt, sale and transfer. The passing suite provisions warehouses in its fixtures, so does not catch the setup gap.

Required fix: an idempotent, explicit onboarding/provisioning service used by the seed and future administration. Create the shared warehouse and approved grants; optional child warehouse must be a deliberate choice. Preserve existing grants, identifiers and balances on repeated setup. Do not change 0006 or infer permissions from `PRIMARY`/`SECONDARY` names. Regression: fresh migration → seed twice → discover warehouse → receive → sell.

### High-priority requirement gap — transfers make goods available before arrival

`backend/app/modules/transfers/service.py:369–416` assigns `RECEIVED`, sets equal sent/received timestamps and writes both source decrement and destination increment immediately. This was the old single-step default, not a failure of its implementation; it now conflicts with the owner's in-transit requirement. A destination can sell a coat still in transport.

Adding a status label is insufficient. `inventory/service.py:131–187` requires both transfer legs in the same call (I24); `transfers/models.py:38–45` has no postal-arrival state, and each transfer currently has one permanent command identity/response. A staged workflow needs explicit stage commands, replay protection, receiver attribution and a revised conservation invariant. The older report's claim that confirmation is only a small service change is incomplete.

### Medium-priority requirement gap — topology is expressible, not provisioned or enforced

`tenancy/models.py:29–33,71–121` contains label-only store kinds and generic tenant-scoped access rows. Correct grants can represent a shared warehouse plus private child warehouses. But no onboarding policy ensures all children receive approved shared access, and no business policy distinguishes a child-private warehouse from another generic location. Tenant isolation is present; within-organization privacy still depends on manual grant correctness.

Add the smallest explicit organizational configuration identifying the shared warehouse and the store responsible for each child-private warehouse, plus an audited grant/provisioning service. This is control of a location, not ownership of its contents. A flat primary-with-children model is enough now; no generic recursive organization tree is required.

### Medium-priority requirement gap — transfer grants are coupled to sale/receipt

`transfers/service.py:302–320` requires both person-level transfer permissions and the **same initiating store's** `can_sell` at source plus `can_receive` at destination. This cannot express transfer-only access independently of receiving stock. Broadening primary access to the child's warehouse merely to allow a return conflicts with the child-private model.

Recommended: separate location capabilities for outbound/inbound transfer, retaining person-level `transfer:create`/`transfer:receive`. In staged transfers the sender authorizes dispatch, the receiver authorizes acceptance. Validate an allowed same-organization route and intended recipient before dispatch; do not grant the sender general read/sale/adjustment access to the destination merely because it can ship there. Define the shared warehouse's receiving responsibility explicitly.

**Corrections to the question premises:**

- Default sellers lack both transfer permissions (`authz/permissions.py:65–89`); `can_sell` alone does not let an ordinary seller empty a warehouse.
- `can_receive` alone does not confer arbitrary adjustment: `inventory:adjust` is a separate person permission. It does broaden receipt/refund access for roles that already hold those permissions.
- A blocked return path depends on actual grants; it is not true for every installation.
- An organization-wide manager receives scope over all active stores (`authz/service.py:97–109`), but cannot combine separate stores' endpoint grants or bypass location access. One selected initiating store must currently reach both ends.

### Client readiness — backend evidence exists, operator workflow does not

The ledger records location, acting store, actor and time; transfer audit records before/after. However, there is no operator-facing movement-history/transfer-list UI. `/me` lists stores, not accessible warehouses (`api/v1/router.py:61–73`), and stock rows cannot discover a warehouse that has no stock. `frontend/src/App.tsx` remains a scaffold.

Before seller UI work, expose authorized warehouse discovery (including empty/paused warehouses, names, capabilities), transfer detail/list and operation history. Use existing journal/audit facts; do not introduce a second independently editable stock history.

## Recommended transit design — proposal, not shipped behavior

| Stage | Source available | In transit | Destination available |
|---|---|---|---|
| Dispatch q | decreases by q | increases by q | unchanged |
| Postal arrival | unchanged | unchanged | unchanged (pending owner confirmation) |
| Physical acceptance q | unchanged | decreases by q | increases by q |

Suggested user states: **in transit → arrived at pickup point → accepted by warehouse**. Direct delivery can skip postal arrival. Record sender and receiver separately, with timestamps and audit. Do not mark a retail customer as a warehouse.

The implementation must account for transit explicitly, for example from per-line dispatched/accepted/resolved quantities and immutable linked events. It must be reconciliable and unavailable for ordinary sales. Retain the existing paired-movement path for historical completed transfers; design new stage-specific ledger operations rather than simply removing the current pair validation.

Each dispatch/acceptance command needs a permanent identity, fingerprint and original response; a transfer UUID alone does not identify multiple lifecycle actions. Receipt, duplicate receipt and cancellation must serialize on the transfer/line state, and stock locks remain globally ordered. A retry must not credit stock twice. Never automatically reverse dispatch just by changing status to CANCELLED: physically shipped goods need a traced return/resolution. Before shipping the workflow, specify partial receipt, shortage/damage, and what happens if the destination pauses while goods are on the way. Unreceived units must remain accounted for; never auto-credit or discard them.

Conservation: dispatched quantity = accepted quantity + unresolved transit quantity + explicitly resolved return/loss quantity, with every resolution evidenced. Existing completed transfers stay completed; do not invent postal events or receiving actors for history. New migrations only.

## Recommended next work, in order

1. Repair clean setup and add its end-to-end backend regression.
2. Agree explicit shared/private provisioning and capability matrix; test primary + two children, shared access and sibling isolation.
3. Implement staged transfers together with stage permissions, transit accounting, replay handling and migration. Settle the pending arrival/manager questions before dependent behavior.
4. Expose warehouse discovery and journal/transfer reads for the client. Then resume catalog work M1-020…M1-023 and client gate M1D.

Keep the modular monolith, location-keyed balances, immutable ledger, Decimal/frozen sale prices and explicit permissions. No evidence here calls for microservices, another database or a wholesale rewrite. Installments, damaged returns, archived-store rules and actual goods ownership remain separate requirements; today's model is not a completed ERP/accounting product.

## Verification and limits

- Commit inspected: `8481348`, PR #19 already merged locally; initial worktree clean.
- Fresh Python 3.12 venv and PostgreSQL **16.2** installed only under task-specific `/tmp` paths. New cluster on `127.0.0.1:55442`; no work database, global Docker resource or other code project touched.
- The test cluster was stopped after verification. Temporary runtime/data/logs remain under the task-specific `/tmp/birka-business-review*` paths; no persistent host service was installed.
- All eight migrations applied to a fresh database. `alembic check`: **no drift**.
- Full backend suite: **475 passed, zero skipped**, two dependency deprecation warnings.
- Ruff: passed; format check: **102 files**; mypy: **59 files**; import boundaries: **11 contracts kept**.
- Separate setup probe reproduced the 2/0/0 defect above despite green tests.
- Independent static access/tenancy review corroborated setup and business-policy findings. No newly demonstrated oversell, cross-tenant bypass or duplicate stock write in the exercised flows.
- Docker/PostgreSQL 17, frontend build, Telegram E2E, production deployment, performance and restore drill were **not rerun** here. Prior reports are historical evidence, not this run. This review is not a production-readiness certification.

Only project documentation was changed. No application code, database migration file, commit, push or merge was performed.
