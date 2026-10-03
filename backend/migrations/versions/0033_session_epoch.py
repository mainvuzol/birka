"""Ending a person's sign-ins. Owner decision, 2026-10-03.

The owner decided (business-rules.md, "before the public domain") that when a
phone is lost, the administrator ends every sign-in of that person on the
server, on the owner's word, and the person keeps their access. A session
token cannot be revoked by itself — there is no session store — so this
revision gives each person a number their tokens are checked against:

**`app_user.session_epoch`** — how many times this person's sign-ins were
ended. A token carries the number it was issued under, and a token issued
under a lower one is refused as an expired session. Ending sign-ins is one
`+ 1`; the next sign-in takes the new number. Turning a person off ends their
sign-ins too, so a later grant does not bring an old token back.

Every person starts at 0, and a token issued before this revision carries no
number, which counts as 0: deploying it signs nobody out.

**Downgrade** drops the column. Tokens then go back to being checked by the
active flag and memberships alone, as before.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0033_session_epoch"
down_revision: str | None = "0032_size_spelling"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "app_user",
        sa.Column("session_epoch", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("app_user", "session_epoch")
