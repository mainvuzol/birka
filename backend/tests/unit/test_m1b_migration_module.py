"""What the frozen `0002` migration promises about itself.

These four tests used to live in `test_m1b_schema_parity.py`, which was removed
because its main job — re-rendering the current models and comparing them with
the frozen 0002 SQL — became impossible once `0006` moved the stock key off
`store_id`. None of the four ever depended on that re-rendering: they ask
whether the migration module is internally consistent, which is still worth
asking and still cheap. `test_migration_history_is_frozen.py` covers the file's
integrity; `alembic check` in CI covers drift against the live schema.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
VERSIONS = BACKEND_ROOT / "migrations" / "versions"
SCHEMA_SQL = VERSIONS / "0002_m1b_schema.sql"


def _load_migration_module():
    """Load the migration by path: `versions/` is not an importable package
    and the file name starts with a digit."""
    path = VERSIONS / "0002_m1b_catalog_inventory_sales.py"
    spec = importlib.util.spec_from_file_location("m1b_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _tables_created_by_the_schema_sql() -> set[str]:
    """The tables 0002 actually creates, read from the frozen SQL itself.

    Deliberately not "the tables the models declare": later migrations add
    tables, and this is a statement about a migration that will never change.
    """
    return set(re.findall(r"^CREATE TABLE (\w+)", SCHEMA_SQL.read_text(encoding="utf-8"), re.M))


def test_append_only_tables_get_a_trigger() -> None:
    """Invariants I10/I11. More relevant since 0006, not less: that migration
    suspends this very trigger to backfill the ledger, so the set it protects
    is worth pinning somewhere that cannot be edited along with it."""
    module = _load_migration_module()
    assert set(module.APPEND_ONLY_TABLES) == {
        "raw_input",
        "stock_movement",
        "alias_evidence",
        "audit_log",
    }


def test_downgrade_drops_every_table_and_type() -> None:
    module = _load_migration_module()
    assert set(module.DROP_ORDER) == _tables_created_by_the_schema_sql()
    # Enum types survive DROP TABLE and would block a re-upgrade.
    rendered = SCHEMA_SQL.read_text(encoding="utf-8")
    for enum_name in module.ENUM_TYPES:
        assert f"CREATE TYPE {enum_name} " in rendered


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
