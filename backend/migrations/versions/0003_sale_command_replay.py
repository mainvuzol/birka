"""Persist the original sale command fingerprint and response.

Preexisting sales deliberately keep NULL: line facts cannot prove the complete
original command, actor or correction payload. Such command retries remain
conflicts, with no duplicate writes. The historical 0002 DDL stays untouched.

Revision ID: 0003_sale_replay
Revises: 0002_m1b
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_sale_replay"
down_revision: str | None = "0002_m1b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sale", sa.Column("command_fingerprint", sa.String(64), nullable=True))
    op.add_column("sale", sa.Column("response_snapshot", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("sale", "response_snapshot")
    op.drop_column("sale", "command_fingerprint")
