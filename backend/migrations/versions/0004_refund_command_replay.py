"""Persist the original refund command fingerprint and response.

Same problem ADR-0003 solved for `sale`, arriving with the refund command
itself: the permanent `uq_refund_org_command` stops a retry from creating a
second refund, but on its own it turns a late retry into an unhandled unique
violation instead of the original answer. The fingerprint proves the retry is
the same request; the snapshot is what it answered.

Both columns are **nullable**, exactly as 0003 made them on `sale`.

An earlier draft made `command_fingerprint` NOT NULL, reasoning that no code
had ever written `refund` so no unverifiable row could exist. That is true
precisely once — at first deploy — and false from the first refund onward, and
the independent review demonstrated the cost: `downgrade()` drops the column,
and the re-`upgrade` then fails with `NotNullViolationError` on any database
that has taken a refund, because there is nothing to backfill from. The
migration became a one-way door, forfeiting the very thing ADR-0003 asks for —
"prefer rolling back application code while retaining additive columns".

A NULL therefore means what it means on `sale`: this row's original request
cannot be proven. The service refuses to guess that a retry matches it,
returning a conflict rather than a replay, and never a second refund — the
permanent unique constraint on `(organization_id, command_id)` is what carries
invariant I20, and it is untouched by a downgrade.

Revision ID: 0004_refund_replay
Revises: 0003_sale_replay
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_refund_replay"
down_revision: str | None = "0003_sale_replay"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("refund", sa.Column("command_fingerprint", sa.String(64), nullable=True))
    op.add_column("refund", sa.Column("response_snapshot", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    """Reversible, and re-appliable afterwards.

    Refund rows and `uq_refund_org_command` survive, so a downgraded database
    still cannot produce a duplicate refund. What is lost is exact replay for
    commands issued before the rollback: those retries become conflicts.
    """
    op.drop_column("refund", "response_snapshot")
    op.drop_column("refund", "command_fingerprint")
