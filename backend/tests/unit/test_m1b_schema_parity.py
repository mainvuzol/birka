"""The M1B migration must match the models exactly.

`alembic check` proves this too, but only against a live database — that is,
only in CI. This test proves it locally, in milliseconds, by re-rendering the
models and comparing with the SQL the migration executes. If someone edits a
model and forgets the migration (or edits the generated SQL by hand), this
fails immediately rather than at the next deploy.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import Enum as SAEnum
from sqlalchemy import MetaData
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

import app.models_registry  # noqa: F401  — registers every table
from app.core.db import metadata

PG = postgresql.dialect()
BACKEND_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_SQL = BACKEND_ROOT / "migrations" / "versions" / "0002_m1b_schema.sql"

M1A_TABLES = frozenset(
    {"organization", "store", "app_user", "role", "role_permission", "membership"}
)

HEADER = (
    "-- M1B schema: catalog identity, evidence, inventory ledger, sales.\n"
    "-- GENERATED from the SQLAlchemy models; do not hand-edit.\n"
    "-- backend/tests/unit/test_m1b_schema_parity.py re-renders the models and\n"
    "-- fails if this file drifts from them.\n\n"
)


def m1b_tables() -> list:
    """Every M1B table, in an order that satisfies foreign keys."""
    # Freeze the historical 0002 projection; later migrations are checked
    # against the complete current metadata with live `alembic check`.
    baseline = MetaData(naming_convention=metadata.naming_convention)
    for table in metadata.sorted_tables:
        clone = table.to_metadata(baseline)
        originals = {constraint.name: constraint for constraint in table.constraints}
        for constraint in clone.constraints:
            constraint._creation_order = originals[constraint.name]._creation_order
    for name in ("command_fingerprint", "response_snapshot"):
        baseline.tables["sale"]._columns.remove(baseline.tables["sale"].c[name])
    return [t for t in baseline.sorted_tables if t.name not in M1A_TABLES]


def render_schema_sql() -> str:
    """Render the M1B schema exactly as the migration file should contain it."""
    tables = m1b_tables()

    enums: dict[str, list[str]] = {}
    for table in tables:
        for column in table.columns:
            if isinstance(column.type, SAEnum) and column.type.native_enum and column.type.name:
                enums.setdefault(column.type.name, list(column.type.enums))

    lines: list[str] = []
    for name, values in sorted(enums.items()):
        rendered = ", ".join(f"'{value}'" for value in values)
        lines.append(f"CREATE TYPE {name} AS ENUM ({rendered});")
    lines.append("")

    for table in tables:
        lines.append(str(CreateTable(table).compile(dialect=PG)).strip() + ";")
        for index in sorted(table.indexes, key=lambda i: i.name or ""):
            lines.append(str(CreateIndex(index).compile(dialect=PG)).strip() + ";")
        lines.append("")

    # SQLAlchemy's DDL compiler leaves a trailing space on wrapped lines.
    # Strip them so the generated file already satisfies the
    # trailing-whitespace pre-commit hook; otherwise the hook rewrites the
    # file on every commit and this parity test fails right afterwards.
    body = "\n".join(lines)
    return HEADER + "\n".join(line.rstrip() for line in body.split("\n"))


@pytest.fixture(scope="module")
def committed_sql() -> str:
    return SCHEMA_SQL.read_text(encoding="utf-8")


def test_migration_sql_matches_the_models(committed_sql: str) -> None:
    """The single most valuable check in this file.

    Regenerate with:
        python -c "from tests.unit.test_m1b_schema_parity import render_schema_sql, SCHEMA_SQL; \\
                   SCHEMA_SQL.write_text(render_schema_sql(), encoding='utf-8', newline='\\n')"
    """
    assert committed_sql == render_schema_sql(), (
        "0002_m1b_schema.sql has drifted from the models — regenerate it"
    )


def test_all_thirty_m1b_tables_are_present(committed_sql: str) -> None:
    assert len(m1b_tables()) == 30
    assert committed_sql.count("CREATE TABLE ") == 30


def test_total_schema_is_the_thirty_six_tables_the_plan_names() -> None:
    assert len(metadata.tables) == 36


def test_product_family_signature_is_indexed_but_not_unique(committed_sql: str) -> None:
    """ADR-0002, the correction that started revision 2.

    A unique constraint here would be a schema-level silent merge of two
    genuinely different products that happen to share a signature.
    """
    assert "CREATE INDEX ix_product_family_signature" in committed_sql
    assert "UNIQUE" not in _statement_for(committed_sql, "ix_product_family_signature")


def test_product_variant_identity_uses_nulls_not_distinct(committed_sql: str) -> None:
    """A variant IS its attribute combination, so here uniqueness is right —
    and an unstated attribute must collapse to one row, not many."""
    statement = _statement_for(committed_sql, "uq_product_variant_attributes")
    assert "UNIQUE NULLS NOT DISTINCT" in statement


def test_inventory_cannot_go_negative(committed_sql: str) -> None:
    """Invariant I1, the floor under every stock operation."""
    assert "CONSTRAINT ck_inventory_quantity_not_negative CHECK (quantity >= 0)" in committed_sql


def test_inventory_key_has_no_nullable_column(committed_sql: str) -> None:
    """Invariant I2: a NULL in the unique key would let duplicate rows exist.

    `size_id` is NOT NULL and points at a real Size row, including the
    "size unknown" one.
    """
    inventory = metadata.tables["inventory"]
    for column_name in ("store_id", "product_variant_id", "size_id"):
        assert not inventory.columns[column_name].nullable, column_name
    assert "uq_inventory_store_variant_size" in committed_sql


def test_stock_movement_rejects_a_no_op(committed_sql: str) -> None:
    assert "CHECK (quantity_delta <> 0)" in committed_sql


def test_adjustment_always_carries_a_reason(committed_sql: str) -> None:
    """`.ai/workflows/inventory-adjustment.md`: an untraceable stock edit must
    be impossible, not merely discouraged."""
    assert "ck_stock_movement_adjustment_requires_reason" in committed_sql


def test_found_during_sale_is_its_own_reason_code(committed_sql: str) -> None:
    """Business fact F30. How often stock was wrong is a measurable signal,
    not an anonymous adjustment."""
    assert "'FOUND_DURING_SALE'" in committed_sql


@pytest.mark.parametrize("table", ["sale", "refund", "transfer"])
def test_command_identity_is_permanent_and_unique(table: str, committed_sql: str) -> None:
    """Invariant I20. The idempotency record expires after 7 days; this does
    not, so a late replay can never create a second business operation."""
    assert f"uq_{table}_org_command" in committed_sql


def test_sale_line_arithmetic_is_a_database_guarantee(committed_sql: str) -> None:
    """Invariant I22: a rounding bug cannot persist an inconsistent line."""
    assert "CHECK (final_unit_price = unit_price - discount_amount)" in committed_sql
    assert "CHECK (line_total = final_unit_price * quantity)" in committed_sql


def test_money_columns_are_numeric_not_float() -> None:
    """Invariant I7. Binary floating point is banned for money."""
    money_columns = [
        (t.name, c.name, type(c.type).__name__)
        for t in metadata.tables.values()
        for c in t.columns
        if c.name
        in {
            "unit_price",
            "discount_amount",
            "final_unit_price",
            "line_total",
            "subtotal",
            "discount_total",
            "total",
            "total_amount",
            "amount",
            "unit_cost",
            "suggested_price",
        }
    ]
    assert money_columns, "expected money columns to exist"
    for table_name, column_name, type_name in money_columns:
        assert type_name == "Numeric", f"{table_name}.{column_name} is {type_name}"


def test_an_ambiguous_match_can_resolve_to_nothing(committed_sql: str) -> None:
    """Invariant I14 as a constraint: uncertainty must not name a winner."""
    assert "ck_catalog_match_decision_ambiguous_resolves_nothing" in committed_sql
    assert "ck_catalog_match_decision_applied_requires_resolution" in committed_sql


def test_parse_result_is_unique_per_parser_version(committed_sql: str) -> None:
    """Invariant I21: re-running the same parser is a no-op, which is what
    makes reprocessing deterministic."""
    assert "uq_parse_result_input_version" in committed_sql


def test_raw_input_has_no_status_column() -> None:
    """A mutable status on an append-only table is a contradiction; the
    lifecycle lives in raw_input_processing."""
    assert "status" not in metadata.tables["raw_input"].columns
    assert "status" in metadata.tables["raw_input_processing"].columns


def _load_migration_module():
    """Load the migration by path: `versions/` is not an importable package
    and the file name starts with a digit."""
    import importlib.util

    path = BACKEND_ROOT / "migrations" / "versions" / "0002_m1b_catalog_inventory_sales.py"
    spec = importlib.util.spec_from_file_location("m1b_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_append_only_tables_get_a_trigger() -> None:
    module = _load_migration_module()
    assert set(module.APPEND_ONLY_TABLES) == {
        "raw_input",
        "stock_movement",
        "alias_evidence",
        "audit_log",
    }


def test_downgrade_drops_every_table_and_type() -> None:
    module = _load_migration_module()
    assert set(module.DROP_ORDER) == {t.name for t in m1b_tables()}
    # Enum types survive DROP TABLE and would block a re-upgrade.
    rendered = render_schema_sql()
    for enum_name in module.ENUM_TYPES:
        assert f"CREATE TYPE {enum_name} " in rendered


def _statement_for(sql: str, needle: str) -> str:
    """The single SQL statement containing `needle`."""
    for statement in sql.split(";"):
        if needle in statement:
            return statement
    raise AssertionError(f"{needle} not found in the schema SQL")


def test_migration_statement_splitting() -> None:
    """asyncpg refuses more than one command per execute, so the migration
    sends the generated DDL statement by statement. If the splitter is wrong,
    the migration fails on a real database and nowhere else — which is exactly
    what happened before this test existed."""
    module = _load_migration_module()
    parts = module.statements(SCHEMA_SQL.read_text(encoding="utf-8"))

    assert sum(1 for p in parts if p.startswith("CREATE TABLE ")) == 30
    assert sum(1 for p in parts if p.startswith("CREATE TYPE ")) == 21
    assert all(p.rstrip().endswith(";") for p in parts)
    # Exactly one command each: no semicolon anywhere but the very end.
    for part in parts:
        assert part.rstrip()[:-1].count(";") == 0, part[:80]
    # Nothing was dropped on the floor.
    assert sum(1 for p in parts if p.startswith("CREATE INDEX ")) == (len(parts) - 30 - 21)


def test_migration_splitter_rejects_an_unterminated_statement() -> None:
    module = _load_migration_module()

    with pytest.raises(RuntimeError, match="unterminated"):
        module.statements("CREATE TABLE broken (\n  id UUID\n")
