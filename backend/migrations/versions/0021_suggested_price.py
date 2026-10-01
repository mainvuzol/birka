"""Who may set a suggested selling price. M1-028, owner question Q-F.

The owner decided on 2026-10-01 (business-rules.md, "suggested selling
price") that the owner and managers set the price the till prefills, and a
seller sees it. `variant_price` has existed since `0002` for exactly this,
shared or per store; nothing could write it, because nobody had said who may.

**`catalog:set_price`** is granted to every role that holds
`inventory:adjust`, as it now is by default: the price is set by the people
who already correct the balances, whatever a role is called.

No schema change. **Downgrade** removes the grant; any prices already set
stay, and the till still reads them.
"""

from __future__ import annotations

from alembic import op

revision: str = "0021_suggested_price"
down_revision: str | None = "0020_damaged_units"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute(
        "INSERT INTO role_permission (role_id, permission_code) "
        "SELECT role_id, 'catalog:set_price' FROM role_permission "
        "WHERE permission_code = 'inventory:adjust' "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM role_permission WHERE permission_code = 'catalog:set_price'")
