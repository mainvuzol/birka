"""The refund request's own rule: goods that came back are stated intact or
damaged, and only they (owner decisions, 2026-09-15 §3 and 2026-10-01).

Checked here without the service, which checks the same for callers that do
not come through HTTP: either one alone must hold."""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.api.v1.refunds import RefundLinePayload

LINE = {"sale_item_id": str(uuid.uuid4()), "quantity": 1}


@pytest.mark.parametrize(
    "stated",
    [
        {"restock": True},
        {"restock": True, "condition": None},
        {"restock": True, "condition": "BROKEN"},
        {"restock": False, "condition": "INTACT"},
    ],
)
def test_the_request_refuses_goods_back_unjudged_or_judged_without_goods(stated):
    with pytest.raises(ValidationError):
        RefundLinePayload.model_validate(LINE | stated)


@pytest.mark.parametrize(
    "stated",
    [
        {"restock": True, "condition": "INTACT"},
        {"restock": True, "condition": "DAMAGED"},
        {"restock": False},
    ],
)
def test_the_request_takes_every_honest_statement(stated):
    assert RefundLinePayload.model_validate(LINE | stated).restock is stated["restock"]
