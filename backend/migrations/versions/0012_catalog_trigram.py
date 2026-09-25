"""Enable PostgreSQL trigram similarity for read-only catalog suggestions."""

from collections.abc import Sequence

from alembic import op

revision: str = "0012_catalog_trigram"
down_revision: str | None = "0011_customer_orders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    # It may predate this application and other objects may depend on it.
    # Retain the extension rather than dropping an operator shared by the DB.
    pass
