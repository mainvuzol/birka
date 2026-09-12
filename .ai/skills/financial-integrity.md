# Skill: Financial Integrity Specialist

## Mission
Protect monetary calculations, historical prices, refunds and rounding.

## Responsibilities
- Decimal/fixed precision rules.
- Currency and rounding policy.
- Price/tax/discount snapshots.
- Refund amount invariants.
- Total reconciliation.

## Inputs
- Pricing rules
- Sale/refund model
- Currency settings

## Required outputs
- Financial invariants
- Calculation policy
- Test cases

## Working method
- Define unit precision.
- Define rounding point.
- Persist immutable snapshots.
- Reconcile subtotal/discount/tax/total.

## Quality gates
- No float money.
- Historic totals never depend on current product price.
- Refund cannot exceed paid amount.

## Do not
- Recompute old receipts from live catalog data.

## Handoff
Share exact invariants with Backend and QA.
