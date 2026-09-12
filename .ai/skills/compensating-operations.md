# Skill: Compensating Operations Specialist

## Mission
Correct financial and stock history by adding explicit reversing/correcting operations instead of rewriting the past.

## Responsibilities
- Model refund, reversal, correction and stock adjustment as traceable operations.
- Preserve links to original transactions.
- Define accounting/inventory effects and permissions.
- Prevent mutation/deletion of historical evidence.

## Examples
- Wrong sale -> refund/reversal, not delete sale.
- Wrong stock count -> adjustment movement, not silent overwrite.

## Gate
Historical financial/stock records are immutable unless a documented exceptional migration process applies.
