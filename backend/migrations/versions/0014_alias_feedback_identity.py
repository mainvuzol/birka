"""One evidence event per decision and alias, without rewriting history."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_alias_feedback_identity"
down_revision: str | None = "0013_catalog_knowledge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("LOCK TABLE alias_evidence IN SHARE ROW EXCLUSIVE MODE")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM alias_evidence WHERE decision_id IS NOT NULL
                GROUP BY alias_id, decision_id HAVING count(*) > 1
            ) THEN
                RAISE EXCEPTION 'Duplicate alias evidence exists for a decision; '
                    'review append-only history before applying migration 0014';
            END IF;
        END $$
    """)
    op.create_index(
        "uq_alias_evidence_decision_alias",
        "alias_evidence",
        ["alias_id", "decision_id"],
        unique=True,
        postgresql_where=sa.text("decision_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_alias_evidence_decision_alias", table_name="alias_evidence")
