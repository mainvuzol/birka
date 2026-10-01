"""Review queue is scoped; rejection is final, audited and safely repeatable."""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.errors import CatalogAmbiguousError, IdempotencyConflictError
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import Permission
from app.modules.catalog.decisions import get_decision
from app.modules.catalog.evidence import MatchDecisionStatus, ProductAlias, RawInput
from app.modules.catalog.models import CanonicalConcept
from app.modules.catalog.review import list_decisions, reject_decision
from tests.conftest import requires_database
from tests.integration.test_catalog_decisions import confirm, proposal, scope
from tests.integration.test_sale_command import make_shop
from tests.integration.test_transfer_command import api

pytestmark = [pytest.mark.integration, requires_database()]


@pytest.fixture
async def maker():
    engine = create_async_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def reject(session, shop, result, reason="Це інша модель"):
    return await reject_decision(
        session, scope=scope(shop), decision_id=uuid.UUID(result["decision_id"]), reason=reason
    )


async def test_rejection_keeps_evidence_and_replays_without_learning(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop, raw_text="  Куртка 1636\n")
        await session.commit()
        before = await session.scalar(select(func.count()).select_from(ProductAlias))
        reason = "  Це інша модель\n"
        result = await reject(session, shop, first, reason)
        await session.commit()
        assert result["status"] == "REJECTED"
        assert not result["requires_confirmation"] and result["resolved_variant_id"] is None
        assert result["preview"] == first["preview"]
        assert result["rejection"] == {"reason": reason, "actor_user_id": str(shop.user_id)}
        assert await reject(session, shop, first, reason) == result
        assert await session.scalar(select(func.count()).select_from(ProductAlias)) == before
        raw = await session.get(RawInput, uuid.UUID(first["raw_input_id"]))
        assert raw.raw_text == "  Куртка 1636\n"
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.entity_id == uuid.UUID(first["decision_id"]),
                    AuditLog.action == "catalog.match_rejected",
                )
            )
            == 1
        )
        with pytest.raises(IdempotencyConflictError):
            await reject(session, shop, first, "Змінена причина")
        with pytest.raises(CatalogAmbiguousError):
            await confirm(session, shop, first)


async def test_default_queue_filters_terminal_states_and_paginates(maker):
    async with maker() as session:
        shop = await make_shop(session)
        rows = [await proposal(session, shop) for _ in range(4)]
        await reject(session, shop, rows[0])
        await confirm(session, shop, rows[1])
        first = await list_decisions(session, scope=scope(shop), store_id=shop.store_id, limit=1)
        second = await list_decisions(
            session, scope=scope(shop), store_id=shop.store_id, limit=1, offset=1
        )
        assert first["has_more"] and not second["has_more"]
        assert {first["items"][0]["decision_id"], second["items"][0]["decision_id"]} == {
            rows[2]["decision_id"],
            rows[3]["decision_id"],
        }
        rejected = await list_decisions(
            session, scope=scope(shop), store_id=shop.store_id, status=MatchDecisionStatus.REJECTED
        )
        assert [item["decision_id"] for item in rejected["items"]] == [rows[0]["decision_id"]]
        with pytest.raises((CatalogAmbiguousError, IdempotencyConflictError)):
            await reject(session, shop, rows[1])


async def test_stale_proposal_can_be_rejected_and_rollback_preserves_queue(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()
        await session.execute(
            update(CanonicalConcept)
            .where(CanonicalConcept.id == shop.concept_id)
            .values(name="Змінена модель")
        )
        await session.commit()
        assert (await reject(session, shop, first))["status"] == "REJECTED"
        await session.rollback()
        assert (
            await get_decision(
                session, scope=scope(shop), decision_id=uuid.UUID(first["decision_id"])
            )
            == first
        )


async def test_queue_and_rejection_api_authorization_validation(maker):
    async with maker() as session:
        local, foreign = await make_shop(session), await make_shop(session)
        first = await proposal(session, local)
        other = await proposal(session, foreign)
        await session.commit()
    path = "/api/v1/catalog/match-decisions"
    async with api(maker, local.scope()) as client:
        assert (await client.get(path, params={"store_id": str(local.store_id)})).status_code == 403
        assert (
            await client.post(f"{path}/{first['decision_id']}/reject", json={"reason": "помилка"})
        ).status_code == 403
    async with api(maker, scope(local)) as client:
        response = await client.get(path, params={"store_id": str(local.store_id)})
        assert response.status_code == 200, response.text
        assert [row["decision_id"] for row in response.json()["items"]] == [first["decision_id"]]
        assert str(foreign.organization_id) not in response.text
        assert (
            await client.get(path, params={"store_id": str(foreign.store_id)})
        ).status_code == 403
        assert (
            await client.post(f"{path}/{other['decision_id']}/reject", json={"reason": "помилка"})
        ).status_code == 404
        for value in ("", " ", "\x00", "\ud800", "x" * 1001):
            response = await client.post(
                f"{path}/{first['decision_id']}/reject",
                content=json.dumps({"reason": value}),
                headers={"Content-Type": "application/json"},
            )
            assert response.status_code == 422, response.text
        for params in (
            {"limit": 0},
            {"limit": 101},
            {"offset": -1},
            {"offset": 10001},
            {"status": "bad"},
        ):
            response = await client.get(path, params={"store_id": str(local.store_id), **params})
            assert response.status_code == 422
        response = await client.post(
            f"{path}/{first['decision_id']}/reject", json={"reason": "помилка"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["rejection"]["reason"] == "помилка"


async def test_concurrent_rejections_create_one_audit(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()

    async def run():
        async with maker() as session:
            result = await reject(session, shop, first)
            await session.commit()
            return result

    a, b = await asyncio.wait_for(asyncio.gather(run(), run()), timeout=10)
    assert a == b
    async with maker() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(
                    AuditLog.entity_id == uuid.UUID(first["decision_id"]),
                    AuditLog.action == "catalog.match_rejected",
                )
            )
            == 1
        )


async def test_confirm_vs_reject_has_only_one_winner(maker):
    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()

    async def run(action):
        async with maker() as session:
            try:
                result = await action(session, shop, first)
                await session.commit()
                return result["status"]
            except (CatalogAmbiguousError, IdempotencyConflictError):
                await session.rollback()
                return "CONFLICT"

    states = await asyncio.wait_for(asyncio.gather(run(confirm), run(reject)), timeout=10)
    assert states.count("CONFLICT") == 1
    assert len(set(states) & {"APPLIED", "REJECTED"}) == 1


async def test_store_queues_are_separate_within_one_organization(maker):
    from dataclasses import replace

    from app.core.errors import ForbiddenStoreError
    from app.modules.catalog.decisions import create_decision
    from app.modules.tenancy.models import Store, StoreKind

    async with maker() as session:
        shop = await make_shop(session)
        child = Store(
            organization_id=shop.organization_id,
            name="Дочірній",
            code="CHILD",
            kind=StoreKind.SECONDARY,
        )
        session.add(child)
        await session.flush()
        both = replace(
            scope(shop),
            store_permissions={
                shop.store_id: frozenset(Permission),
                child.id: frozenset(Permission),
            },
        )
        parent_result = await proposal(session, shop)
        child_result = await create_decision(
            session, scope=both, decision_id=uuid.uuid4(), store_id=child.id, raw_text="виріб дочки"
        )
        parent_queue = await list_decisions(session, scope=both, store_id=shop.store_id)
        child_queue = await list_decisions(session, scope=both, store_id=child.id)
        assert [row["decision_id"] for row in parent_queue["items"]] == [
            parent_result["decision_id"]
        ]
        assert [row["decision_id"] for row in child_queue["items"]] == [child_result["decision_id"]]
        with pytest.raises(ForbiddenStoreError):
            await list_decisions(session, scope=scope(shop), store_id=child.id)
        with pytest.raises(ForbiddenStoreError):
            await reject_decision(
                session,
                scope=scope(shop),
                decision_id=uuid.UUID(child_result["decision_id"]),
                reason="помилка",
            )


async def test_inactive_store_history_is_readable_but_rejection_is_refused(maker):
    from app.core.errors import NotFoundError
    from app.modules.tenancy.models import Store, StoreState

    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.execute(
            update(Store).where(Store.id == shop.store_id).values(state=StoreState.BLOCKED)
        )
        await session.commit()
        page = await list_decisions(session, scope=scope(shop), store_id=shop.store_id)
        assert [row["decision_id"] for row in page["items"]] == [first["decision_id"]]
        with pytest.raises(NotFoundError):
            await reject(session, shop, first)


async def test_deleted_candidate_does_not_prevent_rejection(maker):
    from sqlalchemy import delete

    from app.modules.catalog.models import ProductVariant

    async with maker() as session:
        shop = await make_shop(session)
        first = await proposal(session, shop)
        await session.commit()
        await session.execute(delete(ProductVariant).where(ProductVariant.id == shop.variant_id))
        await session.commit()
        result = await reject(session, shop, first)
        assert result["status"] == "REJECTED"
        assert result["preview"] == first["preview"]
