# Durable Business Rules

- The application must simplify the existing notebook-based workflow rather than impose technical IDs on store staff.
- Owner clarification (2026-09-15): the primary and child stores both sell from the primary store’s shared warehouse; the child store also has a separate warehouse. Selling store and stock location are distinct concepts. This supersedes the earlier assumption that each store sells only its own store-specific inventory.
- Transfers between stores are explicit transfer movements, not sales.
  - **Implemented 2026-09-22 (M1-018)**, between *warehouses*: a `TRANSFER_OUT` and a matching `TRANSFER_IN` in one transaction — never a sale, never money. Historical defaults at implementation time (superseded where answered in the 2026-09-22 review): single-step (goods recorded as arrived the moment they leave, Q5); `can_sell` at the source is enough to take goods out; a closed warehouse is refused at either end; a manager whose stores reach neither warehouse is refused. See the [M1-018 report](m1-018-transfer-report.md).
- Business category and garment type are separate concepts.
- Raw catalog input is immutable evidence.
- Catalog identity uses CanonicalConcept -> ProductFamily -> ProductVariant; same shop name across sources is not automatically the same family.
- Source-like labels are stored separately and may remain semantically UNKNOWN until confirmed.
- Slash-separated values may represent multiple variants; slash is not automatically alias syntax.
- Size inventory must support both alpha and numeric size systems.
- Unknown terms remain unclassified until evidence supports classification.
- Owner confirmation (2026-09-14): staff very rarely record a product using its known item code instead of a descriptive name. Preserve such codes as optional identifiers when supported by evidence; do not require codes for everyday entry, infer their issuer or uniqueness, treat every bare number as a code, or merge products solely because their codes match.
- Legacy PDFs/availability sheets represent inventory snapshots, not transaction history.
- Adaptive matching requires explicit ambiguity handling and human confirmation when evidence is insufficient.
- User corrections improve alias/retrieval evidence; no online fine-tuning after each correction.

## Owner decisions — 2026-09-15

Confirmed requirements; documentation only, not claims of implemented behavior. Detailed scope and unresolved semantics: [warehouse, store status and payment decisions](owner-decisions-2026-09-15.md).

- One primary warehouse supplies both stores; a separate child warehouse also exists. Keep sales attribution separate from the physical stock location; never duplicate the shared quantity under both stores. **Implemented 2026-09-17** as stock locations plus explicit store access — [ADR-0004](../decisions/ADR-0004-stock-locations.md), [design and migration plan](m1-018-stock-location-design.md), [M1-029 report](m1-029-completion-report.md).
- Add explicit store states: temporarily blocked by an administrator and ceased trading/archived. These are not the daily end of a shift. Exact allowed operations and responsible roles require a permission matrix before implementation.
- Returned units are marked intact or damaged. One return may contain both conditions from the same sale line; their aggregate quantity is capped by the remaining returnable quantity. Damaged is a condition, not an automatic write-off or permission to sell it again.
- Owner clarification (2026-09-15): an arbitrary sale amount is the agreed final selling price after negotiation, either below or above the suggested price (for example, +200 UAH). It is not a partial payment and does not itself create debt. Price agreement and payment timing are separate: sales may be paid in full or on installments. Installments concern sales, not paying customer refunds in installments. Freeze the agreed price in the sale; do not rewrite the catalog suggested price.
- Record separately when the store itself acquires goods on installments. Keep the store’s purchase obligations distinct from customer payments and the selling price.
- No automatic return cutoff based on sale age. Existing authorization, original-sale linkage and cumulative quantity limits still apply.

## Owner decisions — 2026-09-17 (warehouses)

Confirmed and, except where noted, implemented by M1-029.

- All current data is test data. Whether to import existing balances or start from nothing is decided separately before launch; **nothing is cleaned or merged automatically**.
- The child store chooses explicitly which warehouse it sells from. The shared balance is never duplicated between stores.
- A seller at the child store may perform «фізично є» and «фізично відсутній» at a warehouse they can reach, **with the appropriate rights**. Reaching a warehouse never by itself confers the right to change what is in it, and arbitrary balance correction is not given to every seller.
  - Concretely, for «фізично є» (`FOUND_DURING_SALE`): the store needs `can_sell` at that warehouse and the person needs `inventory:correct_during_sale`. `can_receive` is **not** required here, and this is the only stock-increasing path where it is not — receipts, adjustments and refund restocks all demand it. The reason it is safe is the cap: the correction may not exceed the shortfall the sale immediately consumes, so the warehouse is never left fuller than it was found. Tightening this to `can_receive` is an owner's decision, not a code detail.
  - Reading is separate again: any access row lets a store see what is in a warehouse, including a closed one. Closing a warehouse freezes it; it does not hide it. *(Clarified 2026-09-22: this sentence is M1-029's engineering wording about reads, not something the owner said. What a closed warehouse may still do — for example, be emptied by a transfer — is an open owner question; see the [M1-018 report](m1-018-transfer-report.md).)*
- The warehouse is stated explicitly for each sale line. A client may prefill it when only one is available. **Automatically switching to another warehouse when one is short is forbidden.**
- A refund that restocks returns the goods to the warehouse that line was sold from. Another warehouse requires a separate transfer. Sale and refund stay attributed to the store that made the sale.
- **«Фізично відсутній» is implemented (M1-030), bounded.** The owner answered the open question on 2026-09-17: **the sale proceeds for the quantity that is actually there.**
  - The seller states **how many units are present** for the line they are selling, never the size of the shortage. The line is sold for that many, and the customer pays for that many.
  - The shortfall is removed by a negative `ADJUSTMENT` with reason `MISSING_AT_SALE`, in the sale's own transaction, audited with before and after.
  - **Two bounds, both enforced (invariant I25):** the line being sold, and what the ledger already believed was there. So it can never empty a shelf (that is a stocktake, and needs `inventory:adjust`), never drive a balance negative, and never *add* stock.
  - It is **not a write-off.** `MISSING_AT_SALE` is deliberately not `LOST` or `DAMAGED`: at the counter nobody knows whether the coat was stolen, misfiled, already sold or standing in the other warehouse, so the reason records the observation and no more.
  - It needs its own permission, `inventory:report_missing_during_sale`, which is **not in the default seller role** and is not implied by `inventory:correct_during_sale` or by reaching the warehouse.
  - A line where **nothing** is present is refused rather than dropped from the basket: an empty shelf with no sale behind it is a stocktake. See the open note in [physically-absent-proposal.md](physically-absent-proposal.md).

## Owner clarification — 2026-09-22

See [business model review and implementation implications](business-model-review-2026-09-22.md). These are requirements; no runtime change was made by recording them.

- The primary store's warehouse is shared by the primary and all its children. Each child may optionally have its own warehouse, operated by that child. No sibling access is implied.
- Goods have an in-transit stage and a later arrival event. Postal arrival versus actual warehouse acceptance is not yet settled; never silently credit sellable stock merely from a shipping status.
- A closed child warehouse means temporarily paused, consistent with current behavior: visible balances, no stock mutations. Do not conflate this with pausing the shared warehouse or deleting stock.
- Shared↔own-child transfers must be possible with actor/store/time attribution. This does not abolish person-level permissions or authorize arbitrary stock adjustments.
- Organization-wide manager access without explicit warehouse grants is unanswered; retain existing checks.
