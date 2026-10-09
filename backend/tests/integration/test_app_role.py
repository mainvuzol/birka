"""The app's own database role (`scripts.app_role`, ADR-0016), on real PostgreSQL.

`birka_app` reads and writes rows and nothing more: it may not truncate,
create, or alter, drop or disable a table or a trigger, so the triggers that
keep the ledger hold against the API itself. The tests give it its rights as
the owner does on the server, then sign in as it.
"""

from __future__ import annotations

import base64
import os
import secrets
import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest
from scripts import app_role
from scripts.app_role import APP_ROLE, RefusedError, give_rights, scram_verifier
from sqlalchemy import exc as sa_exc
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, async_sessionmaker
from structlog.testing import capture_logs

from app.api.internal import database_state
from app.core.config import Settings
from app.core.db import create_engine
from tests.conftest import requires_database

pytestmark = [pytest.mark.integration, requires_database()]

ROW_RIGHTS = ("SELECT", "INSERT", "UPDATE", "DELETE")


def owner_url() -> str:
    return os.environ["BIRKA_TEST_DATABASE_URL"]


def app_url(password: str) -> str:
    return (
        make_url(owner_url())
        .set(username=APP_ROLE, password=password)
        .render_as_string(hide_password=False)
    )


def new_password() -> str:
    return base64.b64encode(secrets.token_bytes(32)).decode()


@pytest.fixture
async def owner() -> AsyncIterator[AsyncEngine]:
    engine = create_engine(Settings(database_url=owner_url()))
    yield engine
    await engine.dispose()


@pytest.fixture
async def given(owner: AsyncEngine) -> AsyncIterator[tuple[str, list[str]]]:
    """The rights given, as on the server; the password and what was said."""
    password = new_password()
    async with owner.begin() as connection:
        said = await give_rights(connection, password)
    yield password, said


@pytest.fixture
async def as_app(given: tuple[str, list[str]]) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(Settings(database_url=app_url(given[0])))
    yield engine
    await engine.dispose()


async def stored_password(owner: AsyncEngine) -> str:
    async with owner.connect() as connection:
        stored = await connection.scalar(
            text("SELECT rolpassword FROM pg_authid WHERE rolname = :role"), {"role": APP_ROLE}
        )
    assert isinstance(stored, str)
    return stored


async def refused(connection: AsyncConnection, statement: str) -> str:
    """The error PostgreSQL gives `birka_app` for `statement`, in a savepoint
    so the next statement still runs."""
    savepoint = await connection.begin_nested()
    with pytest.raises(sa_exc.DBAPIError) as error:
        await connection.exec_driver_sql(statement)
    await savepoint.rollback()
    return str(error.value.orig)


async def test_the_verifier_is_the_one_postgresql_makes(owner: AsyncEngine) -> None:
    """PostgreSQL hashes a plain password itself; the command's verifier,
    with PostgreSQL's salt, must come out the same, or the API could not
    sign in with the password in `.env`."""
    role = f"birka_verifier_{uuid.uuid4().hex[:8]}"
    password = new_password()
    async with owner.begin() as connection:
        await connection.exec_driver_sql("SET LOCAL password_encryption = 'scram-sha-256'")
        await connection.exec_driver_sql(f"CREATE ROLE {role} PASSWORD '{password}'")
        stored = await connection.scalar(
            text("SELECT rolpassword FROM pg_authid WHERE rolname = :role"), {"role": role}
        )
        await connection.exec_driver_sql(f"DROP ROLE {role}")
    method, rest = stored.split("$", 1)
    iterations, salt = rest.split("$", 1)[0].split(":")
    assert method == "SCRAM-SHA-256"
    made = scram_verifier(password, salt=base64.b64decode(salt), iterations=int(iterations))
    assert made == stored
    # A new salt every time it runs.
    assert scram_verifier(password) != scram_verifier(password)


async def test_it_reads_and_writes_rows_and_nothing_more(as_app: AsyncEngine) -> None:
    async with as_app.connect() as connection:
        assert (
            await connection.execute(
                text("SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user")
            )
        ).one() == (APP_ROLE, False)
        assert await connection.scalar(text("SELECT count(*) >= 0 FROM credit_entry"))
        assert await connection.scalar(text("SELECT version_num FROM alembic_version"))

        assert "must be owner" in await refused(
            connection, "ALTER TABLE credit_entry DISABLE TRIGGER ALL"
        )
        assert "must be owner" in await refused(
            connection, "DROP TRIGGER IF EXISTS credit_entry_guard ON credit_entry"
        )
        assert "must be owner" in await refused(connection, "DROP TABLE audit_log")
        assert "permission denied" in await refused(connection, "TRUNCATE audit_log")
        assert "permission denied" in await refused(
            connection, "UPDATE alembic_version SET version_num = version_num"
        )
        assert "permission denied" in await refused(
            connection, "INSERT INTO alembic_version VALUES ('0001')"
        )
        assert "permission denied" in await refused(connection, "DELETE FROM alembic_version")
        assert "permission denied" in await refused(connection, "CREATE TABLE later (a int)")
        # One named like a table a trigger reads would be read in its place.
        assert "permission denied" in await refused(
            connection, "CREATE TEMPORARY TABLE cash_close (store_id uuid, number int)"
        )
        assert "permission denied" in await refused(connection, "CREATE SCHEMA birka_app")
        assert "permission denied" in await refused(connection, "CREATE ROLE later")
        assert "permission denied" in await refused(connection, "COPY (SELECT 1) TO PROGRAM 'id'")
        assert "permission denied" in await refused(
            connection, "SELECT pg_read_file('/etc/hostname')"
        )


async def test_every_table_is_read_and_written_and_the_version_only_read(
    owner: AsyncEngine, given: tuple[str, list[str]]
) -> None:
    async with owner.connect() as connection:
        more = ["TRUNCATE", "TRIGGER", "REFERENCES"]
        version = await connection.scalar(text("SELECT current_setting('server_version_num')"))
        if int(version) >= 170000:
            more.append("MAINTAIN")
        rows = (
            await connection.execute(
                text(
                    "SELECT tablename, r,"
                    " has_table_privilege(:role, format('public.%I', tablename), r)"
                    " FROM pg_tables, unnest(CAST(:rights AS text[])) AS r"
                    " WHERE schemaname = 'public'"
                ),
                {"role": APP_ROLE, "rights": [*ROW_RIGHTS, *more]},
            )
        ).all()
    held = {(table, right) for table, right, has in rows if has}
    tables = {table for table, _, _ in rows}
    assert "alembic_version" in tables and "credit_entry" in tables
    expected = {
        (table, right)
        for table in tables
        for right in (("SELECT",) if table == "alembic_version" else ROW_RIGHTS)
    }
    assert held == expected
    assert f"{len(tables) - 1} tables: read and write" in given[1]


async def test_a_table_created_later_is_granted_too(
    owner: AsyncEngine, given: tuple[str, list[str]], as_app: AsyncEngine
) -> None:
    """A later migration's table needs nothing run again: the owner's
    default privileges, which this run gives, give it."""
    table = f"later_{uuid.uuid4().hex[:8]}"
    async with owner.begin() as connection:
        await connection.exec_driver_sql(
            f"ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM {APP_ROLE}"
        )
    async with owner.begin() as connection:
        await give_rights(connection, given[0])
    async with owner.begin() as connection:
        await connection.exec_driver_sql(f"CREATE TABLE {table} (id int PRIMARY KEY, note text)")
    try:
        async with as_app.begin() as connection:
            await connection.exec_driver_sql(f"INSERT INTO {table} VALUES (1, 'a')")  # noqa: S608
            await connection.exec_driver_sql(f"UPDATE {table} SET note = 'b'")  # noqa: S608
            assert await connection.scalar(text(f"SELECT note FROM {table}")) == "b"  # noqa: S608
            await connection.exec_driver_sql(f"DELETE FROM {table}")  # noqa: S608
            assert "permission denied" in await refused(connection, f"TRUNCATE {table}")
    finally:
        async with owner.begin() as connection:
            await connection.exec_driver_sql(f"DROP TABLE {table}")


async def test_run_again_it_takes_back_what_is_more(
    owner: AsyncEngine, given: tuple[str, list[str]]
) -> None:
    async with owner.begin() as connection:
        await connection.exec_driver_sql(f"GRANT TRUNCATE, TRIGGER ON audit_log TO {APP_ROLE}")
        await connection.exec_driver_sql("GRANT TRUNCATE ON credit_entry TO PUBLIC")
        await connection.exec_driver_sql(f"GRANT UPDATE ON alembic_version TO {APP_ROLE}")
        await connection.exec_driver_sql(f"GRANT pg_read_server_files TO {APP_ROLE}")
        await connection.exec_driver_sql(
            f"ALTER ROLE {APP_ROLE} CREATEDB CREATEROLE REPLICATION BYPASSRLS INHERIT"
            " VALID UNTIL '2000-01-01' CONNECTION LIMIT 0"
        )
    async with owner.begin() as connection:
        said = await give_rights(connection, new_password())
    assert said[0] == f"{APP_ROLE}: password set"
    assert "no longer a member of pg_read_server_files" in said
    async with owner.connect() as connection:
        assert (
            await connection.execute(
                text(
                    "SELECT has_table_privilege(:role, 'audit_log', 'TRUNCATE'),"
                    " has_table_privilege(:role, 'audit_log', 'TRIGGER'),"
                    " has_table_privilege(:role, 'credit_entry', 'TRUNCATE'),"
                    " has_table_privilege(:role, 'alembic_version', 'UPDATE'),"
                    " pg_has_role(:role, 'pg_read_server_files', 'MEMBER'),"
                    " (SELECT rolcreatedb OR rolsuper OR rolcreaterole OR rolinherit"
                    "  OR rolreplication OR rolbypassrls OR rolconnlimit <> -1"
                    "  OR rolvaliduntil <> 'infinity' FROM pg_roles WHERE rolname = :role)"
                ),
                {"role": APP_ROLE},
            )
        ).one() == (False, False, False, False, False, False)


async def test_what_it_set_on_itself_is_reset(
    owner: AsyncEngine, given: tuple[str, list[str]], as_app: AsyncEngine
) -> None:
    """A role may set its own defaults: a compromised API could make every
    later connection read-only, or look elsewhere first. Run again, they
    are gone."""
    async with as_app.begin() as connection:
        database = await connection.scalar(text("SELECT quote_ident(current_database())"))
        await connection.exec_driver_sql(
            f"ALTER ROLE {APP_ROLE} SET default_transaction_read_only = on"
        )
        await connection.exec_driver_sql(
            f"ALTER ROLE {APP_ROLE} IN DATABASE {database} SET search_path = pg_temp, public"
        )
    async with owner.begin() as connection:
        said = await give_rights(connection, given[0])
        left = await connection.scalar(
            text(
                "SELECT count(*) FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole"
                " WHERE r.rolname = :role"
            ),
            {"role": APP_ROLE},
        )
    assert "its own settings reset (2)" in said
    assert left == 0


async def test_on_a_database_shaped_otherwise_the_rights_are_the_same(
    owner: AsyncEngine, given: tuple[str, list[str]]
) -> None:
    """A restored or older database may let everyone create in `public`, or
    not let everyone connect or use it, and the role may have been made a
    superuser: the command gives `birka_app` its own rights all the same."""
    async with owner.begin() as connection:
        database = await connection.scalar(text("SELECT quote_ident(current_database())"))
        await connection.exec_driver_sql("GRANT CREATE ON SCHEMA public TO PUBLIC")
        await connection.exec_driver_sql("REVOKE USAGE ON SCHEMA public FROM PUBLIC")
        await connection.exec_driver_sql(f"REVOKE CONNECT ON DATABASE {database} FROM PUBLIC")
        await connection.exec_driver_sql(f"GRANT TEMPORARY ON DATABASE {database} TO PUBLIC")
        await connection.exec_driver_sql(
            f"GRANT CREATE, TEMPORARY ON DATABASE {database} TO {APP_ROLE}"
        )
        # And what the role was given before, so only this run's grants count.
        await connection.exec_driver_sql(f"REVOKE USAGE ON SCHEMA public FROM {APP_ROLE}")
        await connection.exec_driver_sql(f"GRANT CREATE ON SCHEMA public TO {APP_ROLE}")
        await connection.exec_driver_sql(f"REVOKE CONNECT ON DATABASE {database} FROM {APP_ROLE}")
        await connection.exec_driver_sql(f"ALTER ROLE {APP_ROLE} SUPERUSER")
    password = new_password()
    try:
        async with owner.begin() as connection:
            await give_rights(connection, password)
        engine = create_engine(Settings(database_url=app_url(password)))
        try:
            async with engine.connect() as connection:
                assert (
                    await connection.execute(
                        text(
                            "SELECT current_user, rolsuper FROM pg_roles"
                            " WHERE rolname = current_user"
                        )
                    )
                ).one() == (APP_ROLE, False)
                assert await connection.scalar(text("SELECT count(*) >= 0 FROM credit_entry"))
                created = await refused(connection, "CREATE TABLE later (a int)")
                assert "permission denied" in created
                temporary = await refused(connection, "CREATE TEMPORARY TABLE later (a int)")
                assert "permission denied" in temporary
                schema = await refused(connection, "CREATE SCHEMA later")
                assert "permission denied" in schema
        finally:
            await engine.dispose()
    finally:
        async with owner.begin() as connection:
            await connection.exec_driver_sql("GRANT USAGE ON SCHEMA public TO PUBLIC")
            await connection.exec_driver_sql(f"GRANT CONNECT ON DATABASE {database} TO PUBLIC")


async def test_refused_when_another_role_gave_it_more(
    owner: AsyncEngine, given: tuple[str, list[str]]
) -> None:
    """The owner takes back only what the owner gave: a right another role
    gave stays. The command names it, and changes nothing."""
    other = f"birka_grantor_{uuid.uuid4().hex[:8]}"
    async with owner.begin() as connection:
        database = await connection.scalar(text("SELECT quote_ident(current_database())"))
        await connection.exec_driver_sql(f"CREATE ROLE {other}")
        await connection.exec_driver_sql(
            f"GRANT TRUNCATE ON audit_log TO {other} WITH GRANT OPTION"
        )
        await connection.exec_driver_sql(
            f"GRANT CREATE ON DATABASE {database} TO {other} WITH GRANT OPTION"
        )
        await connection.exec_driver_sql(f"SET LOCAL ROLE {other}")
        await connection.exec_driver_sql(f"GRANT TRUNCATE ON audit_log TO {APP_ROLE}")
        await connection.exec_driver_sql(f"GRANT CREATE ON DATABASE {database} TO {APP_ROLE}")
    try:
        before = await stored_password(owner)
        with pytest.raises(RefusedError, match=r"audit_log TRUNCATE, the database: create"):
            async with owner.begin() as connection:
                await give_rights(connection, new_password())
        assert await stored_password(owner) == before
    finally:
        async with owner.begin() as connection:
            await connection.exec_driver_sql(f"REVOKE TRUNCATE ON audit_log FROM {other} CASCADE")
            await connection.exec_driver_sql(
                f"REVOKE CREATE ON DATABASE {database} FROM {other} CASCADE"
            )
            await connection.exec_driver_sql(f"DROP ROLE {other}")


async def test_a_membership_another_role_gave_is_taken_back_too(
    owner: AsyncEngine, given: tuple[str, list[str]]
) -> None:
    """Revoked by whoever gave it: a role holding ADMIN OPTION on
    `pg_read_server_files` made `birka_app` a member."""
    other = f"birka_admin_{uuid.uuid4().hex[:8]}"
    async with owner.begin() as connection:
        await connection.exec_driver_sql(f"CREATE ROLE {other}")
        await connection.exec_driver_sql(f"GRANT pg_read_server_files TO {other} WITH ADMIN OPTION")
        await connection.exec_driver_sql(f"SET LOCAL ROLE {other}")
        await connection.exec_driver_sql(f"GRANT pg_read_server_files TO {APP_ROLE}")
    try:
        async with owner.begin() as connection:
            said = await give_rights(connection, given[0])
            member = await connection.scalar(
                text("SELECT pg_has_role(:role, 'pg_read_server_files', 'MEMBER')"),
                {"role": APP_ROLE},
            )
        assert "no longer a member of pg_read_server_files" in said
        assert member is False
    finally:
        async with owner.begin() as connection:
            await connection.exec_driver_sql(f"DROP ROLE {other}")


async def test_refused_unless_run_by_a_superuser(owner: AsyncEngine) -> None:
    """Only the owner, a superuser, may make a role no superuser; anyone
    else is told to run it from `ops`."""
    role, password = f"birka_not_owner_{uuid.uuid4().hex[:8]}", new_password()
    async with owner.begin() as connection:
        await connection.exec_driver_sql(
            f"CREATE ROLE {role} LOGIN CREATEROLE PASSWORD '{password}'"
        )
    engine = create_engine(
        Settings(
            database_url=make_url(owner_url())
            .set(username=role, password=password)
            .render_as_string(hide_password=False)
        )
    )
    try:
        async with engine.begin() as connection:
            with pytest.raises(RefusedError, match="POSTGRES_USER"):
                await give_rights(connection, new_password())
    finally:
        await engine.dispose()
        async with owner.begin() as connection:
            await connection.exec_driver_sql(f"DROP ROLE {role}")


async def test_the_new_password_is_the_one_that_signs_in(owner: AsyncEngine) -> None:
    """Changing `BIRKA_APP_DB_PASSWORD` and running it again changes the
    password: PostgreSQL keeps the new one's verifier, the new one signs in,
    and the old one is refused where the database asks for a password."""
    old, new = new_password(), new_password()
    async with owner.begin() as connection:
        await give_rights(connection, old)
    async with owner.begin() as connection:
        await give_rights(connection, new)
        stored = await connection.scalar(
            text("SELECT rolpassword FROM pg_authid WHERE rolname = :role"), {"role": APP_ROLE}
        )
        trusted = "trust" in set(
            (
                await connection.scalars(
                    text("SELECT auth_method FROM pg_hba_file_rules WHERE type = 'host'")
                )
            ).all()
        )
    iterations, salt = stored.split("$")[1].split(":")
    kept = {"salt": base64.b64decode(salt), "iterations": int(iterations)}
    assert scram_verifier(new, **kept) == stored
    assert scram_verifier(old, **kept) != stored

    engine = create_engine(Settings(database_url=app_url(new), app_db_password=""))
    try:
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT current_user")) == APP_ROLE
    finally:
        await engine.dispose()
    stale = create_engine(Settings(database_url=app_url(old), app_db_password=""))
    try:
        # A sign-in refused arrives as asyncpg's own error, not SQLAlchemy's.
        async with stale.connect() as connection:
            await connection.scalar(text("SELECT 1"))
    except asyncpg.exceptions.InvalidPasswordError as error:
        assert "password authentication failed" in str(error)
    else:
        assert trusted, "a wrong password signed in where one is asked for"
    finally:
        await stale.dispose()


async def test_a_role_that_cannot_sign_in_is_not_ready_and_says_why() -> None:
    """After a restore onto an empty database, before the command, the role
    is not there at all: the log names the refused sign-in."""
    nobody = make_url(owner_url()).set(
        username=f"birka_nobody_{uuid.uuid4().hex[:8]}", password=new_password()
    )
    engine = create_engine(Settings(database_url=nobody.render_as_string(hide_password=False)))
    try:
        with capture_logs() as lines:
            async with async_sessionmaker(engine)() as session:
                assert await database_state(session) == "unreachable"
    finally:
        await engine.dispose()
    [line] = [line for line in lines if line["event"] == "database.unreachable"]
    # Where passwords are asked for, PostgreSQL does not say the role is
    # missing; where every connection is trusted, it does.
    assert line["error"] in {"InvalidPasswordError", "InvalidAuthorizationSpecificationError"}


async def test_without_its_rights_the_api_is_not_ready_and_says_why(
    owner: AsyncEngine, as_app: AsyncEngine
) -> None:
    """A restore that skipped the command leaves the role with no rights:
    readiness says the database does not answer, as for a database that is
    down, and the log tells the two apart."""
    async with owner.begin() as connection:
        await connection.exec_driver_sql(f"REVOKE SELECT ON alembic_version FROM {APP_ROLE}")  # noqa: S608
    try:
        with capture_logs() as lines:
            async with async_sessionmaker(as_app)() as session:
                assert await database_state(session) == "unreachable"
    finally:
        async with owner.begin() as connection:
            await give_rights(connection, new_password())
    assert [line for line in lines if line["event"] == "database.unreachable"] == [
        {
            "logger": "app.api.internal",
            "event": "database.unreachable",
            "log_level": "warning",
            "error": "ProgrammingError",
            "cause": "InsufficientPrivilegeError",
        }
    ]


async def test_refused_with_a_placeholder_or_as_the_app_itself(
    owner: AsyncEngine, as_app: AsyncEngine
) -> None:
    async with owner.begin() as connection:
        before = await connection.scalar(
            text("SELECT rolpassword FROM pg_authid WHERE rolname = :role"), {"role": APP_ROLE}
        )
        for weak in (
            "change-me-locally-too-but-made-long-enough",
            base64.b64encode(secrets.token_bytes(24)).decode()[:31],
        ):
            with pytest.raises(RefusedError, match="at least 32"):
                await give_rights(connection, weak)
        # 32 characters, base64 of 24 random bytes: enough.
        await give_rights(connection, base64.b64encode(secrets.token_bytes(24)).decode())
        await connection.rollback()
    async with owner.connect() as connection:
        after = await connection.scalar(
            text("SELECT rolpassword FROM pg_authid WHERE rolname = :role"), {"role": APP_ROLE}
        )
    assert after == before
    async with as_app.begin() as connection:
        with pytest.raises(RefusedError, match=f"not as {APP_ROLE}"):
            await give_rights(connection, new_password())


async def test_refused_before_the_first_migration(owner: AsyncEngine) -> None:
    """Run too early, it would grant nothing on the tables yet to come, and
    the default privileges would make `alembic_version` writable."""
    name = f"birka_unmigrated_{uuid.uuid4().hex[:8]}"
    async with owner.connect() as connection:
        await connection.execution_options(isolation_level="AUTOCOMMIT")
        await connection.exec_driver_sql(f"CREATE DATABASE {name}")
    unmigrated = make_url(owner_url()).set(database=name).render_as_string(hide_password=False)
    empty = create_engine(Settings(database_url=unmigrated))
    try:
        async with empty.begin() as connection:
            with pytest.raises(RefusedError, match="not migrated yet"):
                await give_rights(connection, new_password())
    finally:
        await empty.dispose()
        async with owner.connect() as connection:
            await connection.execution_options(isolation_level="AUTOCOMMIT")
            await connection.exec_driver_sql(f"DROP DATABASE {name}")


async def test_refused_without_a_password(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        app_role, "get_settings", lambda: Settings(database_url=owner_url(), app_db_password="")
    )
    with pytest.raises(RefusedError, match="BIRKA_APP_DB_PASSWORD is not set"):
        await app_role.run()


def test_the_command_says_refused_and_exits_2(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        app_role, "get_settings", lambda: Settings(database_url=owner_url(), app_db_password="")
    )
    with pytest.raises(SystemExit) as exited:
        app_role.main([])
    assert exited.value.code == 2
    assert capsys.readouterr().err.startswith("refused: BIRKA_APP_DB_PASSWORD is not set")
