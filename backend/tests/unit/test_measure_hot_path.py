"""The hot-path harness: what it asks the API, and which of its cases gate.

The harness itself runs against a live API and a disposable database. These
check what can go wrong without either: a case that silently changed, a sale
paid in parts the API would refuse, or a run that cannot say what made it.
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal
from typing import Any

import httpx
import pytest
from scripts import measure_hot_path as harness

from app.api.v1.sales import SaleRequest
from app.modules.credit.service import customer_key, digits, terms
from app.modules.identity.telegram_init_data import verify_init_data
from app.modules.sales.payment import DRAWER_METHOD
from tests.conftest import TEST_BOT_TOKEN

# The six cases every earlier reading measured (2026-09-29, 2026-10-01): name,
# how many, sellers at once. Their figures compare only while these hold.
EARLIER = [
    ("GET /catalog/stock-options", 200, 1),
    ("GET /catalog/stock-options (6 sellers)", 300, 6),
    ("POST /sales · 1 line", 200, 1),
    ("POST /sales · 1 line (6 sellers)", 300, 6),
    ("POST /sales · 4 lines (6 sellers)", 200, 6),
    ("POST /sales · same coat, 6 sellers", 120, 6),
]
IN_PARTS = [
    ("POST /sales · paid in parts", 200, 1),
    ("POST /sales · paid in parts (6 sellers)", 300, 6),
]
WARM_UP = 20


def a_world() -> harness.World:
    return harness.World(
        telegram_user_id=1,
        store_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        keys=[(uuid.uuid4(), uuid.uuid4()) for _ in range(len(harness.SIZES) * 10)],
    )


async def bodies_sent(builder: harness.RequestBuilder, count: int) -> list[dict[str, Any]]:
    """What a case sends for indexes 0..count-1, as `drive` would ask them."""
    sent: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content) if request.content else {})
        return httpx.Response(201, json={})

    transport = httpx.MockTransport(answer)
    async with httpx.AsyncClient(transport=transport, base_url="http://perf") as client:
        for index in range(count):
            await builder(client, index)
    return sent


def test_the_six_earlier_cases_run_first_and_unchanged() -> None:
    cases = harness.cases(a_world(), {"Authorization": "Bearer t"})

    assert [(name, count, sellers) for name, _, count, sellers in cases[:6]] == EARLIER


async def test_the_earlier_sales_send_no_credit() -> None:
    cases = harness.cases(a_world(), {"Authorization": "Bearer t"})

    for name, builder, _, _ in cases[2:6]:
        for body in await bodies_sent(builder, 3):
            assert set(body) == {"store_id", "command_id", "lines", "payment_method"}, name


async def test_every_sale_says_it_is_paid_in_cash() -> None:
    """A sale without a way is refused (ADR-0012, B2): every case states one,
    the one the drawer counts, and one the till's request takes."""
    cases = harness.cases(a_world(), {"Authorization": "Bearer t"})

    for name, builder, _, _ in cases[2:]:
        for body in await bodies_sent(builder, 3):
            assert body["payment_method"] == DRAWER_METHOD.value, name
            assert SaleRequest.model_validate(body).payment_method == "CASH", name


@pytest.mark.parametrize("gate", harness.GATES)
def test_a_sale_paid_in_parts_is_measured_alone_and_by_six_sellers(
    monkeypatch: pytest.MonkeyPatch, gate: str
) -> None:
    monkeypatch.setattr(harness, "GATE", gate)
    cases = harness.cases(a_world(), {"Authorization": "Bearer t"})

    assert [(name, count, sellers) for name, _, count, sellers in cases[6:]] == IN_PARTS
    for name, _, count, sellers in cases[6:]:
        row = harness.summarise(name, sellers, [1.0] * count)
        assert row["budget"] == 500.0
        # The release reading gates every case, six sellers included (owner
        # decision, 2026-10-03); CI's gates what one seller sees.
        assert row["gated"] is (gate == "all" or sellers == 1)


async def test_every_sale_paid_in_parts_is_a_new_customer_the_till_accepts() -> None:
    cases = harness.cases(a_world(), {"Authorization": "Bearer t"})

    credits: list[tuple[dict[str, str], Decimal]] = []
    for _, builder, count, _ in cases[6:]:
        # The warm-up asks the same indexes again before the measured run.
        for body in await bodies_sent(builder, WARM_UP) + await bodies_sent(builder, count):
            total = sum(Decimal(line["unit_price"]) * line["quantity"] for line in body["lines"])
            credits.append((body["credit"], total))

    assert len(credits) == sum(WARM_UP + count for _, count, _ in IN_PARTS)
    for credit, total in credits:
        # The API's own check of the seller's statement.
        accepted = terms(
            customer_name=credit["customer_name"],
            customer_phone=credit["customer_phone"],
            paid_now=Decimal(credit["paid_now"]),
        )
        # Above nothing and below the total: anything else is not a debt.
        assert Decimal(0) < accepted.paid_now < total
    phones = {customer_key(digits(credit["customer_phone"])) for credit, _ in credits}
    names = {credit["customer_name"] for credit, _ in credits}
    assert len(phones) == len(names) == len(credits)


async def test_the_run_names_the_environment_the_api_says_it_runs_as() -> None:
    asked: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        return httpx.Response(200, json={"status": "ok", "environment": "ci"})

    transport = httpx.MockTransport(answer)
    async with httpx.AsyncClient(transport=transport, base_url="http://perf") as client:
        assert await harness.api_environment(client) == "ci"
    assert asked == ["/api/v1/health"]


async def test_an_api_that_does_not_answer_stops_the_run_before_it_seeds() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(503))
    async with httpx.AsyncClient(transport=transport, base_url="http://perf") as client:
        with pytest.raises(httpx.HTTPStatusError):
            await harness.api_environment(client)


def test_the_launch_data_signs_with_the_token_it_is_given() -> None:
    signed = harness.init_data_for(4242, TEST_BOT_TOKEN)

    verified = verify_init_data(signed, TEST_BOT_TOKEN, max_age_seconds=60)

    assert verified.user.telegram_user_id == 4242
