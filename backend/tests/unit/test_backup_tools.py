"""The parts of the backup and the restore drill that need no database."""

from __future__ import annotations

import pytest
from scripts.postgres_tools import Database, ToolError, require_compatible
from scripts.restore_drill import SCRATCH_PREFIX, compare, create_statement

ICU = {
    "provider": "i",
    "collate": "C.UTF-8",
    "ctype": "C.UTF-8",
    "locale": "uk-UA",
    "encoding": "UTF8",
}


def description(**changes: object) -> dict[str, object]:
    base: dict[str, object] = {
        "alembic_revision": "0017_stock_adjustment",
        "tables": {"sale": 1, "stock_movement": 2},
        "triggers": [["stock_movement", "stock_movement_is_append_only", "O"]],
        "locale": ICU,
        "lower_probe": "оля",
    }
    return {**base, **changes}


def test_the_password_reaches_the_tools_through_the_environment_only():
    database = Database("postgresql+asyncpg://birka:s3cret@db:5432/birka")
    env = database.libpq_env()
    assert env["PGPASSWORD"] == "s3cret"
    assert (env["PGHOST"], env["PGPORT"], env["PGUSER"], env["PGDATABASE"]) == (
        "db",
        "5432",
        "birka",
        "birka",
    )
    assert database.on("scratch").name == "scratch"
    assert "s3cret" in database.on("scratch").url, "the scratch copy uses the same login"


def test_a_client_older_than_the_server_is_refused_in_words():
    require_compatible("pg_dump", 17, 17)
    require_compatible("pg_dump", 18, 17)
    with pytest.raises(ToolError, match="PostgreSQL 16 but the server is 17"):
        require_compatible("pg_dump", 16, 17)


def test_the_scratch_database_keeps_the_source_locale():
    statement = create_statement(f"{SCRATCH_PREFIX}20260930_abc123", ICU)
    assert "TEMPLATE template0" in statement
    assert "LOCALE_PROVIDER icu ICU_LOCALE 'uk-UA'" in statement
    assert "LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'" in statement
    libc = create_statement(f"{SCRATCH_PREFIX}x", {**ICU, "provider": "c", "locale": None})
    assert "LOCALE_PROVIDER libc" in libc


@pytest.mark.parametrize(
    "locale",
    [
        {**ICU, "locale": "uk-UA'; DROP DATABASE birka; --"},
        {**ICU, "collate": "C' OWNER postgres"},
        {**ICU, "encoding": "UTF8 TEMPLATE birka"},
    ],
)
def test_a_manifest_cannot_smuggle_sql_into_create_database(locale):
    with pytest.raises(ValueError, match="not one"):
        create_statement(f"{SCRATCH_PREFIX}x", locale)


@pytest.mark.parametrize(
    "name", ["birka", "postgres", f'{SCRATCH_PREFIX}x"; DROP', "Birka_restore"]
)
def test_only_a_scratch_name_is_ever_created(name):
    with pytest.raises(ValueError, match="Not a scratch database name"):
        create_statement(name, ICU)


def test_a_faithful_copy_passes_every_comparison():
    checks = compare(description(), description())
    assert [(check.name, check.ok) for check in checks] == [
        ("migration", True),
        ("rows", True),
        ("triggers", True),
        ("locale", True),
        ("cyrillic", True),
    ]


@pytest.mark.parametrize(
    ("restored", "failing"),
    [
        (description(alembic_revision="0016_goods_receipt"), {"migration"}),
        (description(tables={"sale": 1}), {"rows"}),
        (description(tables={"sale": 1, "stock_movement": 2, "extra": 0}), {"rows"}),
        (description(tables={"sale": 0, "stock_movement": 2}), {"rows"}),
        (
            description(triggers=[["stock_movement", "stock_movement_is_append_only", "D"]]),
            {"triggers"},
        ),
        (description(triggers=[]), {"triggers"}),
        (description(locale={**ICU, "provider": "c"}), {"locale"}),
        (description(lower_probe="ОЛЯ"), {"locale", "cyrillic"}),
    ],
)
def test_every_difference_fails_its_own_check(restored, failing):
    checks = compare(description(), restored)
    assert {check.name for check in checks if not check.ok} == failing


def test_a_trigger_disabled_on_both_sides_still_fails():
    off = description(triggers=[["stock_movement", "stock_movement_is_append_only", "D"]])
    checks = {check.name: check for check in compare(off, off)}
    assert not checks["triggers"].ok
    assert "stock_movement.stock_movement_is_append_only" in checks["triggers"].detail
