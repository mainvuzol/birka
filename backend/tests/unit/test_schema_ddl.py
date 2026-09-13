"""Schema shape, verified by compiling DDL — no database required.

ADR-0002 turns on two behaviours that are easy to lose in a refactor and
impossible to notice afterwards. These tests fail loudly if either disappears.
"""

from __future__ import annotations

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

import app.models_registry  # noqa: F401  — registers every table
from app.core.db import metadata

PG = postgresql.dialect()


def ddl(table_name: str) -> str:
    return str(CreateTable(metadata.tables[table_name]).compile(dialect=PG))


def test_all_m1a_tables_are_registered() -> None:
    """The gate-M1A tables specifically. M1B added 30 more; their own parity
    test in test_m1b_schema_parity.py covers the full set."""
    assert {
        "organization",
        "store",
        "app_user",
        "role",
        "role_permission",
        "membership",
    } <= set(metadata.tables)


def test_role_uniqueness_uses_nulls_not_distinct() -> None:
    """A system role has organization_id IS NULL and must still be unique.

    Without NULLS NOT DISTINCT, PostgreSQL treats each NULL as distinct and the
    constraint silently permits duplicates (ADR-0002).
    """
    sql = ddl("role")

    assert "NULLS NOT DISTINCT" in sql
    assert "uq_role_organization_id_code" in sql


def test_membership_uniqueness_uses_nulls_not_distinct() -> None:
    """An organization-wide membership has store_id IS NULL."""
    sql = ddl("membership")

    assert "NULLS NOT DISTINCT" in sql
    assert "uq_membership_user_id_organization_id_store_id" in sql


def test_tables_without_nullable_unique_columns_do_not_use_it() -> None:
    """The clause is applied deliberately, not sprayed across the schema."""
    for table in ("organization", "store", "app_user", "role_permission"):
        assert "NULLS NOT DISTINCT" not in ddl(table), table


def test_currency_code_is_constrained_at_the_database() -> None:
    sql = ddl("organization")

    assert "ck_organization_currency_code_iso4217" in sql
    assert "char_length(currency_code) = 3" in sql


def test_every_timestamp_is_timezone_aware() -> None:
    """Naive timestamps are a correctness bug: everything is stored in UTC."""
    for table in metadata.tables.values():
        for column in table.columns:
            if column.type.__class__.__name__ == "DateTime":
                assert column.type.timezone is True, f"{table.name}.{column.name}"


def test_constraint_names_follow_the_naming_convention() -> None:
    """Unnamed constraints cannot be dropped in a downgrade."""
    for table in metadata.tables.values():
        for constraint in table.constraints:
            assert constraint.name, f"unnamed constraint on {table.name}"
        for index in table.indexes:
            assert index.name, f"unnamed index on {table.name}"


@pytest.mark.parametrize(
    ("table", "column"),
    [
        ("store", "organization_id"),
        ("membership", "user_id"),
        ("membership", "organization_id"),
        ("membership", "role_id"),
        ("role_permission", "role_id"),
    ],
)
def test_tenant_links_are_foreign_keys(table: str, column: str) -> None:
    """Tenant boundaries rely on real referential integrity, not conventions."""
    assert metadata.tables[table].columns[column].foreign_keys


def test_store_kind_is_a_named_enum_type() -> None:
    sql = ddl("store")

    assert "store_kind" in sql
