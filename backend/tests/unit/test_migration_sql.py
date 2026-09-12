"""The migration is rendered offline and inspected.

This runs without a database. It cannot prove the migration *applies* — only
CI against real PostgreSQL does that — but it does prove the script is valid
and that the constraints ADR-0002 depends on are actually emitted.
"""

from __future__ import annotations

import contextlib
import io
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def migration_sql() -> str:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        command.upgrade(config, "head", sql=True)
    return buffer.getvalue()


def test_migration_creates_every_m1a_table(migration_sql: str) -> None:
    for table in ("organization", "store", "app_user", "role", "role_permission", "membership"):
        assert f"CREATE TABLE {table} " in migration_sql, table


def test_role_constraint_is_emitted_with_nulls_not_distinct(migration_sql: str) -> None:
    """Losing this clause would silently disable the constraint (ADR-0002)."""
    assert "CONSTRAINT uq_role_organization_id_code UNIQUE NULLS NOT DISTINCT" in migration_sql


def test_membership_constraint_is_emitted_with_nulls_not_distinct(migration_sql: str) -> None:
    assert (
        "CONSTRAINT uq_membership_user_id_organization_id_store_id UNIQUE NULLS NOT DISTINCT"
        in migration_sql
    )


def test_timestamps_are_timezone_aware_in_sql(migration_sql: str) -> None:
    assert "TIMESTAMP WITH TIME ZONE" in migration_sql
    assert "TIMESTAMP WITHOUT TIME ZONE" not in migration_sql


def test_foreign_keys_declare_their_delete_behaviour(migration_sql: str) -> None:
    """An undeclared ON DELETE leaves tenant cleanup to chance."""
    assert "ON DELETE RESTRICT" in migration_sql
    assert "ON DELETE CASCADE" in migration_sql


def test_currency_check_is_emitted(migration_sql: str) -> None:
    assert "ck_organization_currency_code_iso4217" in migration_sql


def test_migration_is_a_single_head() -> None:
    """Two heads mean an ambiguous upgrade path."""
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))

    assert len(ScriptDirectory.from_config(config).get_heads()) == 1
