"""A customer's name and phone are one line each (2026-10-03, before the public
domain): a line break would slip past what hides a refused row's values from
the logs (`app.core.logging.redact_database_values`)."""

from decimal import Decimal

from app.modules.credit.service import terms


def test_a_name_and_a_phone_are_kept_on_one_line() -> None:
    credit = terms(
        customer_name=" Ірина\nКоваль\t ",
        customer_phone="+38 067\r\n123  45 67",
        paid_now=Decimal("100"),
    )
    assert credit.customer_name == "Ірина Коваль"
    assert credit.customer_phone == "+38 067 123 45 67"
