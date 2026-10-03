"""Correcting the catalogue. Owner decision, 2026-10-03; ADR-0008.

The owner decided that a model may be renamed, merged into the model that
stays, retired and brought back (business-rules.md, "correcting the
catalogue"). This revision gives the schema what those need:

- **`catalog_entity_status` gains `RETIRED`**: a model no longer offered or
  received, whose stock still sells.
- **`movement_reason` gains `CATALOG_MERGE_OUT` and `CATALOG_MERGE_IN`**: the
  two halves of moving a duplicate's stock to the model that stays. A CHECK
  makes each an `ADJUSTMENT` naming its correction. It compares the reason as
  text, since a value added here cannot be used in this same transaction.
- **`catalog_correction`**: one row per correction, under its permanent
  `command_id` (I20).
- **`product_variant`:**
  - `merged_requires_target`, as concepts and families already have;
  - the attribute key covers only models not merged, so the model that stays
    may take a merged duplicate's name (ADR-0008 §4).

**Downgrade** refuses while anything uses what this adds: a retired model, a
merge's movement, a recorded correction (every merge records one). A rollback must never quietly
turn a merged model back into a live duplicate, or leave a ledger reason no
earlier revision can explain. The enums' labels stay, as 0010's and 0026's
do: PostgreSQL cannot drop them in place, and an unused label is harmless.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0031_catalog_correction"
down_revision: str | None = "0030_opening_list_hold"
branch_labels: str | None = None
depends_on: str | None = None

NAME_COLUMNS = (
    "product_family_id, color_term_id, material_term_id, texture_term_id, "
    "fur_term_id, collar_term_id, length_cm"
)


def upgrade() -> None:
    # PostgreSQL 12+ allows these inside a transaction; the values cannot be
    # *used* until it commits, and nothing below uses them as enum values.
    op.execute("ALTER TYPE catalog_entity_status ADD VALUE IF NOT EXISTS 'RETIRED'")
    op.execute("ALTER TYPE movement_reason ADD VALUE IF NOT EXISTS 'CATALOG_MERGE_OUT'")
    op.execute("ALTER TYPE movement_reason ADD VALUE IF NOT EXISTS 'CATALOG_MERGE_IN'")

    op.create_check_constraint(
        "catalog_merge_names_its_correction",
        "stock_movement",
        "reason_code IS NULL"
        " OR reason_code::text NOT IN ('CATALOG_MERGE_OUT', 'CATALOG_MERGE_IN')"
        " OR (movement_type = 'ADJUSTMENT'"
        " AND reference_type = 'catalog_correction' AND reference_id IS NOT NULL)",
    )

    # Nothing merged a model before this revision; a row marked so by hand
    # cannot be given the model it was merged into without a person.
    op.execute(
        """DO $$ BEGIN
        IF EXISTS (
            SELECT 1 FROM product_variant
            WHERE (status = 'MERGED') <> (merged_into_id IS NOT NULL)
        ) THEN
            RAISE EXCEPTION
                'Cannot upgrade: a model is marked merged without the model it was merged '
                'into, or names one without being merged; correct it by hand first';
        END IF;
        END $$"""
    )
    op.create_check_constraint(
        "merged_requires_target",
        "product_variant",
        "(status = 'MERGED') = (merged_into_id IS NOT NULL)",
    )
    op.drop_constraint("uq_product_variant_attributes", "product_variant", type_="unique")
    op.execute(
        f"CREATE UNIQUE INDEX uq_product_variant_attributes ON product_variant ({NAME_COLUMNS}) "
        "NULLS NOT DISTINCT WHERE status <> 'MERGED'"
    )

    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "catalog_correction",
        sa.Column("id", uuid, nullable=False),
        sa.Column("organization_id", uuid, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("product_variant_id", uuid, nullable=False),
        sa.Column("into_variant_id", uuid, nullable=True),
        sa.Column("acting_store_id", uuid, nullable=False),
        sa.Column("created_by_user_id", uuid, nullable=False),
        sa.Column("command_id", uuid, nullable=False),
        sa.Column("command_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("name_before", sa.Text(), nullable=False),
        sa.Column("name_after", sa.Text(), nullable=False),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("response_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("correlation_id", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('RENAME', 'MERGE', 'RETIRE', 'RESTORE')",
            name="kind_known",
        ),
        sa.CheckConstraint(
            "(kind = 'MERGE') = (into_variant_id IS NOT NULL)",
            name="merge_names_target",
        ),
        sa.CheckConstraint(
            "into_variant_id IS NULL OR into_variant_id <> product_variant_id",
            name="no_self_merge",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organization.id"],
            name="fk_catalog_correction_organization_id_organization",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["product_variant_id"],
            ["product_variant.id"],
            name="fk_catalog_correction_product_variant_id_product_variant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["into_variant_id"],
            ["product_variant.id"],
            name="fk_catalog_correction_into_variant_id_product_variant",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["app_user.id"],
            name="fk_catalog_correction_created_by_user_id_app_user",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "acting_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_catalog_correction_org_store",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_catalog_correction"),
        sa.UniqueConstraint(
            "organization_id", "command_id", name="uq_catalog_correction_org_command"
        ),
    )
    op.create_index("ix_catalog_correction_variant", "catalog_correction", ["product_variant_id"])
    # Append-only, as the ledger and the audit log: a correction is history,
    # and the downgrade's refusal relies on its rows still being there.
    op.execute(
        "CREATE TRIGGER catalog_correction_is_append_only "
        "BEFORE DELETE OR UPDATE ON catalog_correction "
        "FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation()"
    )


def downgrade() -> None:
    op.execute(
        """DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM product_variant WHERE status::text = 'RETIRED') THEN
            RAISE EXCEPTION
                'Cannot downgrade: a model is retired, which the schema before this '
                'revision has no way to say';
        END IF;
        IF EXISTS (
            SELECT 1 FROM stock_movement
            WHERE reason_code::text IN ('CATALOG_MERGE_OUT', 'CATALOG_MERGE_IN')
        ) THEN
            RAISE EXCEPTION
                'Cannot downgrade: the ledger records a merge, and no other reason '
                'means the same thing';
        END IF;
        IF EXISTS (SELECT 1 FROM catalog_correction) THEN
            RAISE EXCEPTION 'Cannot downgrade: corrections of the catalogue are recorded';
        END IF;
        END $$"""
    )
    op.drop_index("ix_catalog_correction_variant", table_name="catalog_correction")
    op.drop_table("catalog_correction")

    op.execute("DROP INDEX uq_product_variant_attributes")
    op.execute(
        "ALTER TABLE product_variant ADD CONSTRAINT uq_product_variant_attributes "
        f"UNIQUE NULLS NOT DISTINCT ({NAME_COLUMNS})"
    )
    op.drop_constraint("merged_requires_target", "product_variant", type_="check")
    op.drop_constraint("catalog_merge_names_its_correction", "stock_movement", type_="check")
