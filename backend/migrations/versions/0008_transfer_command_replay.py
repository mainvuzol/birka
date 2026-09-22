"""Transfer command replay, and tenant-bound transfer references. M1-018.

The `transfer` table has existed since `0002` and nothing has ever written it.
M1-018 is its first writer, which makes this the cheap moment for two changes
that get expensive once rows exist.

**1. Durable replay** — `command_fingerprint` and `response_snapshot`, exactly
as `0003` added them to `sale` and `0004` to `refund` (ADR-0003). The permanent
`uq_transfer_org_command` stops a retry from moving the goods twice; on its own
it turns a retry that arrives after the 7-day idempotency cache into an
unhandled unique violation instead of the original answer. The fingerprint
proves the retry is the same request, the snapshot is what it answered.

Both columns are **nullable**, for the reason `0004` gives in full: a NOT NULL
column is dropped by `downgrade()` and cannot be re-added over rows that exist,
so the migration would become a one-way door the first time anyone moved a
coat. A NULL means what it means on `sale` and `refund` — this row's original
request cannot be proven — and the service answers a retry of it with a
conflict, never with a second transfer.

**2. References bound through the organization.** `0006` gave `transfer`
single-column foreign keys to its two locations and its store, although the
table carries `organization_id` — and the other tables that carry one beside
a location (`stock_movement`, `stock_lot`, `inventory_snapshot`,
`store_location_access`) bind it compositely (ADR-0004 §2.2). Tables with no
`organization_id` of their own (`inventory`, `sale_item`, `refund_item`)
cannot, and are unchanged. The stock movements a transfer writes are already
bound that way, so goods could not actually cross a tenant boundary; the
transfer row itself could still *name* another organization's warehouse if a
service check were ever missed. The composite keys make that row
unrepresentable, which is the difference between invariant I12 being
`DB_ENFORCED` on this table or merely hoped for.

At first deploy the table is empty — no code before M1-018 writes it — so the
new constraints validate nothing. On a later re-upgrade they validate the
rows a downgrade left behind, which were written under the same rule.

Rolling back below this revision is bounded by `0006`, not by this file.
`0006`'s downgrade puts stock back under stores only while every store maps
to exactly one warehouse. Every transfer needs a store that reaches two, and
while the access rows still say so, `0006` refuses by name. If they were
edited back to one-to-one while transfer rows remain, it instead fails
re-adding `transfer.to_store_id` as `NOT NULL` over those rows — still inside
its transaction, so nothing is half-applied, but with a database error rather
than a reason. Prefer rolling back application code and keeping the schema
(ADR-0003); the M1-018 report (`.ai/project-memory/m1-018-transfer-report.md`)
has the detail.

Revision ID: 0008_transfer_replay
Revises: 0007_missing_at_sale
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_transfer_replay"
down_revision: str | None = "0007_missing_at_sale"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (single-column name from 0006, composite name, column, referred table)
REFERENCES = (
    (
        "fk_transfer_from_location_id_stock_location",
        "fk_transfer_org_from_location",
        "from_location_id",
        "stock_location",
    ),
    (
        "fk_transfer_to_location_id_stock_location",
        "fk_transfer_org_to_location",
        "to_location_id",
        "stock_location",
    ),
    (
        "fk_transfer_initiating_store_id_store",
        "fk_transfer_org_initiating_store",
        "initiating_store_id",
        "store",
    ),
)


def upgrade() -> None:
    op.add_column("transfer", sa.Column("command_fingerprint", sa.String(64), nullable=True))
    op.add_column("transfer", sa.Column("response_snapshot", postgresql.JSONB(), nullable=True))

    for single, composite, column, referred in REFERENCES:
        op.drop_constraint(single, "transfer", type_="foreignkey")
        op.create_foreign_key(
            composite,
            "transfer",
            referred,
            ["organization_id", column],
            ["organization_id", "id"],
            ondelete="RESTRICT",
        )


def downgrade() -> None:
    """Reversible, and re-appliable afterwards.

    The single-column keys come back under the exact names `0006` gave them,
    because `0006`'s own downgrade drops and renames them by name. Transfer
    rows and `uq_transfer_org_command` survive, so a downgraded database still
    cannot move the same goods twice; what is lost is exact replay for
    transfers made before the rollback — their retries become conflicts.
    """
    for single, composite, column, referred in REFERENCES:
        op.drop_constraint(composite, "transfer", type_="foreignkey")
        op.create_foreign_key(
            single,
            "transfer",
            referred,
            [column],
            ["id"],
            ondelete="RESTRICT",
        )

    op.drop_column("transfer", "response_snapshot")
    op.drop_column("transfer", "command_fingerprint")
