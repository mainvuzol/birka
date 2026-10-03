"""A real PostgreSQL error, through the application's engine, keeps no customer.

The unit tests (tests/unit/test_log_privacy.py) build the error as asyncpg and
SQLAlchemy build it; this reads PostgreSQL's own wording from a running server,
so a change in that wording shows here. Only temporary tables are used.
"""

from __future__ import annotations

import os
import traceback

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.core.db import create_engine
from app.core.logging import redact_database_values
from tests.conftest import requires_database
from tests.unit.test_log_privacy import DIGITS, NAME, PHONE, assert_no_customer

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.mark.parametrize(
    ("refused", "kept"),
    [
        # A CHECK violation prints the whole row.
        ("insert into debt values (:name, :phone, :digits, -1)", "debt_amount_positive"),
        # A unique violation prints the key.
        ("insert into debt values (:name, :phone, :digits, 1)", "debt_digits_once"),
    ],
)
async def test_a_refused_row_leaves_no_customer_in_the_error(refused: str, kept: str) -> None:
    engine = create_engine(Settings(database_url=os.environ["BIRKA_TEST_DATABASE_URL"]))
    values = {"name": NAME, "phone": PHONE, "digits": DIGITS}
    try:
        async with engine.connect() as connection:
            await connection.execute(
                text(
                    "create temporary table debt (customer_name text, customer_phone text, "
                    "phone_digits text constraint debt_digits_once unique, amount numeric "
                    "constraint debt_amount_positive check (amount > 0))"
                )
            )
            await connection.execute(
                text("insert into debt values (:name, :phone, :digits, 1)"), values
            )
            with pytest.raises(IntegrityError) as caught:
                await connection.execute(text(refused), values)
            await connection.rollback()
    finally:
        await engine.dispose()

    error = caught.value
    written = "".join(traceback.format_exception(error))
    # The statement's values are never written by SQLAlchemy...
    assert "[SQL parameters hidden due to hide_parameters=True]" in str(error)
    # ...but PostgreSQL repeats them in its DETAIL, which is why it is cut.
    assert DIGITS in written
    redacted = redact_database_values(written)
    assert "(values hidden)" in redacted
    assert kept in redacted
    assert_no_customer(redacted)
