"""M1B: catalog identity, evidence, inventory ledger, sales

Creates the 30 remaining Milestone 1 tables and the append-only triggers.

The table DDL lives in the sibling file `0002_m1b_schema.sql`, rendered
directly from the SQLAlchemy models. Two reasons it is generated rather than
hand-written: 30 tables of `op.create_table` calls are no more reviewable than
SQL, and generating removes the whole class of model/migration drift bugs —
`tests/unit/test_m1b_schema_parity.py` re-renders the models and fails if the
file and the models disagree, which is a check that runs without a database.

Revision ID: 0002_m1b
Revises: 0001_m1a
Create Date: 2026-09-13

"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0002_m1b"
down_revision: str | None = "0001_m1a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA_SQL = Path(__file__).with_name("0002_m1b_schema.sql")

# Tables whose rows are evidence, not state. Invariants I10 and I11: raw human
# input, the stock ledger, alias evidence and the audit log are written once
# and never changed. Enforcing that in the application would mean trusting
# every future code path; enforcing it here means the database refuses.
APPEND_ONLY_TABLES = ("raw_input", "stock_movement", "alias_evidence", "audit_log")

REJECT_MUTATION_FUNCTION = """
CREATE OR REPLACE FUNCTION birka_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'Table % is append-only: % is not permitted (invariants I10/I11)',
        TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
"""

# Order matters: children before parents.
DROP_ORDER = (
    "stock_movement",
    "refund_item",
    "alias_evidence",
    "variant_price",
    "transfer_item",
    "stock_lot",
    "sale_item",
    "inventory_snapshot_row",
    "inventory",
    "catalog_match_decision",
    "raw_input_processing",
    "product_variant",
    "size_alias",
    "refund",
    "product_family",
    "parse_result",
    "transfer",
    "size",
    "sale",
    "raw_input",
    "inventory_snapshot",
    "canonical_concept",
    "source_identity",
    "size_system",
    "product_alias",
    "idempotency_record",
    "garment_type",
    "business_category",
    "audit_log",
    "attribute_term",
)

ENUM_TYPES = (
    "acquisition_type",
    "alias_evidence_event",
    "alias_status",
    "alias_target_type",
    "attribute_kind",
    "catalog_entity_status",
    "idempotency_status",
    "match_decision_status",
    "match_decision_type",
    "match_mode",
    "movement_reason",
    "movement_type",
    "raw_input_processing_status",
    "raw_input_source",
    "sale_status",
    "size_system_code",
    "snapshot_quantity_state",
    "snapshot_row_status",
    "snapshot_status",
    "source_semantic_type",
    "transfer_status",
)


def upgrade() -> None:
    op.execute(SCHEMA_SQL.read_text(encoding="utf-8"))

    op.execute(REJECT_MUTATION_FUNCTION)
    for table in APPEND_ONLY_TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_is_append_only "
            f"BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION birka_reject_mutation();"
        )


def downgrade() -> None:
    for table in APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_is_append_only ON {table};")
    op.execute("DROP FUNCTION IF EXISTS birka_reject_mutation();")

    for table in DROP_ORDER:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
    # Enum types survive DROP TABLE and would block a re-upgrade.
    for enum_name in ENUM_TYPES:
        op.execute(f"DROP TYPE IF EXISTS {enum_name};")
