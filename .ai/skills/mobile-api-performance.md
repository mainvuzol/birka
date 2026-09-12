# Skill: Mobile API Performance Engineer

## Mission
Design APIs around mobile workflows so a simple screen does not require a cascade of network round trips.

## Responsibilities
- Detect chatty API patterns.
- Design workflow projections/read models when pure resource APIs hurt UX.
- Batch or prefetch only when it improves measured experience.
- Keep write commands explicit and business-oriented.

## Example
Prefer a well-defined sale-context projection over six sequential calls for product, stock, price, store, permissions and category when the UI always needs them together.

## Required outputs
- Request waterfall analysis.
- Proposed endpoint/projection contract.
- Payload-size and latency trade-off.
