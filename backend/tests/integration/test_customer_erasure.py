"""A debt's customer erased (owner decisions, 2026-10-09; ADR-0015), over HTTP
and the watcher's erasure against real PostgreSQL.

- A debt paid or returned keeps its customer's name and phone a year after it
  closed; a written-off one three.
- Then the name and phone are erased, and every sum stays.
- The owner erases a closed debt's customer at once when the customer asks:
  every closed debt under their phone, the network's owner in the network,
  a store's owner in that store. An open debt keeps them.
- A write-off's reason is erased with the customer, and never copied to the
  audit log.

Debts are backdated to a closing far in the past, so the erasure run at a
moment after it reaches this file's debts and no other test's. All data is
synthetic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from scripts.backup_watch import watch
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.core.config import Settings
from app.modules.audit.models import AuditLog
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.credit.erasure import erase_expired, years_before
from app.modules.credit.models import CreditEntry, CustomerCredit
from tests.conftest import TEST_BOT_TOKEN, requires_database
from tests.integration.test_shared_warehouse import (
    TwoShops,
    api,
    key,
    make_two_shops,
    sale_body,
    stock_a_coat,
)
from tests.integration.test_stock_rekey_migration import _admin, _alembic, _engine, _run

pytestmark = [pytest.mark.integration, requires_database()]

SELLER = DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
OWNER = DEFAULT_ROLE_PERMISSIONS[RoleCode.OWNER]
NAME = "Ірина Коваль"
PHONE = "+38 (067) 123-45-67"
# Far enough back that no other test's debt was closed then.
CLOSED = datetime(2001, 3, 15, 12, 0, tzinfo=UTC)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def network_owner(shops: TwoShops) -> RequestScope:
    return RequestScope(
        user_id=shops.user_id, organization_id=shops.organization_id, org_permissions=OWNER
    )


async def in_parts(
    maker,
    shops: TwoShops,
    *,
    store: uuid.UUID | None = None,
    name: str = NAME,
    phone: str = PHONE,
) -> str:
    """A coat at 1500 sold for 500 now, 1000 owed; its debt's id."""
    store = store or shops.primary_store
    warehouse = shops.shared_warehouse if store == shops.primary_store else shops.child_warehouse
    async with api(maker, shops.scope(store)) as client:
        variant, size = await stock_a_coat(client, shops, store=store, warehouse=warehouse, qty=2)
        response = await client.post(
            "/api/v1/sales",
            json=sale_body(store, warehouse, variant, size)
            | {"credit": {"customer_name": name, "customer_phone": phone, "paid_now": "500.00"}},
            headers=key(),
        )
    assert response.status_code == 201, response.text
    return response.json()["credit"]["credit_id"]


async def paid_off(maker, shops: TwoShops, credit_id: str, *, store: uuid.UUID | None = None):
    async with api(maker, shops.scope(store or shops.primary_store)) as client:
        response = await client.post(
            f"/api/v1/credits/{credit_id}/payments",
            json={"command_id": str(uuid.uuid4()), "amount": "1000.00", "payment_method": "CASH"},
        )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "SETTLED"


async def written_off(maker, shops: TwoShops, credit_id: str, reason: str) -> None:
    async with api(maker, shops.scope(shops.primary_store, OWNER)) as client:
        response = await client.post(
            f"/api/v1/credits/{credit_id}/write-off",
            json={"command_id": str(uuid.uuid4()), "reason": reason},
        )
    assert response.status_code == 200, response.text


async def closed_on(engine: AsyncEngine, credit_id: str, moment: datetime = CLOSED) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text("UPDATE customer_credit SET closed_at = :at WHERE id = :id"),
            {"at": moment, "id": credit_id},
        )


async def read(maker, shops: TwoShops, credit_id: str) -> dict:
    async with api(maker, shops.scope(shops.primary_store)) as client:
        response = await client.get(f"/api/v1/credits/{credit_id}")
    assert response.status_code == 200, response.text
    return response.json()


async def row(maker, credit_id: str) -> CustomerCredit:
    async with maker() as session:
        credit = await session.get(CustomerCredit, uuid.UUID(credit_id))
        assert credit is not None
        return credit


async def erased_entries(maker, credit_id: str) -> list[AuditLog]:
    async with maker() as session:
        return list(
            (
                await session.scalars(
                    select(AuditLog).where(
                        AuditLog.entity_id == uuid.UUID(credit_id),
                        AuditLog.action == "credit.customer_erased",
                    )
                )
            ).all()
        )


async def erase_at(maker, moment: datetime, **options) -> int:
    async with maker() as session:
        return await erase_expired(session, now=moment, **options)


async def erase_on_request(maker, scope: RequestScope, credit_id: str):
    async with api(maker, scope) as client:
        return await client.post(f"/api/v1/credits/{credit_id}/erase-customer")


# --- the terms ------------------------------------------------------------------


def test_a_year_before_29_february_is_28_february():
    assert years_before(datetime(2028, 2, 29, 3, 15, tzinfo=UTC), 1) == datetime(
        2027, 2, 28, 3, 15, tzinfo=UTC
    )
    assert years_before(datetime(2027, 3, 1, tzinfo=UTC), 3) == datetime(2024, 3, 1, tzinfo=UTC)


async def test_a_paid_debt_keeps_its_customer_a_year_and_then_only_its_sums(maker, engine):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await paid_off(maker, shops, credit_id)
    await closed_on(engine, credit_id)
    before = await read(maker, shops, credit_id)

    await erase_at(maker, years_before(CLOSED, -1) - timedelta(seconds=1))
    kept = await read(maker, shops, credit_id)
    erased_count = await erase_at(maker, years_before(CLOSED, -1))
    after = await read(maker, shops, credit_id)

    assert kept["customer_name"] == NAME
    assert kept["customer_erased_at"] is None
    assert erased_count >= 1
    assert after["customer_name"] is None
    assert after["customer_phone"] is None
    assert after["customer_erased_at"] is not None
    # Every sum stays, and the history with them.
    for field in ("amount", "paid", "owed", "returned", "cash_back", "written_off", "status"):
        assert after[field] == before[field]
    assert [(e["kind"], e["amount"]) for e in after["entries"]] == [
        (e["kind"], e["amount"]) for e in before["entries"]
    ]
    stored = await row(maker, credit_id)
    assert stored.phone_digits is None
    assert stored.customer_erased_by_user_id is None
    [audited] = await erased_entries(maker, credit_id)
    assert audited.actor_user_id is None
    assert audited.after == {"by": "term"}


async def test_a_written_off_debt_keeps_its_customer_three_years_and_loses_its_reason(
    maker, engine
):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await written_off(maker, shops, credit_id, f"{NAME} поїхала, телефон {PHONE}")
    await closed_on(engine, credit_id)

    await erase_at(maker, years_before(CLOSED, -3) - timedelta(seconds=1))
    kept = await read(maker, shops, credit_id)
    await erase_at(maker, years_before(CLOSED, -3))
    after = await read(maker, shops, credit_id)

    assert kept["customer_name"] == NAME
    assert kept["entries"][-1]["note"] == f"{NAME} поїхала, телефон {PHONE}"
    assert after["customer_name"] is None
    assert after["status"] == "WRITTEN_OFF"
    assert after["written_off"] == "1000.00"
    assert after["entries"][-1]["kind"] == "WRITE_OFF"
    assert after["entries"][-1]["note"] is None


async def test_the_write_off_reason_never_reaches_the_audit_log(maker):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await written_off(maker, shops, credit_id, f"{NAME} не платить")

    async with maker() as session:
        [audited] = (
            await session.scalars(
                select(AuditLog).where(
                    AuditLog.entity_id == uuid.UUID(credit_id),
                    AuditLog.action == "credit.written_off",
                )
            )
        ).all()
    assert audited.reason is None
    assert NAME not in str(audited.before) + str(audited.after)


async def test_an_open_debt_is_never_erased_by_the_term(maker, engine):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    async with engine.begin() as connection:
        await connection.execute(
            text("UPDATE customer_credit SET created_at = :at WHERE id = :id"),
            {"at": CLOSED, "id": credit_id},
        )

    # Long past any term of a debt closed when it was opened.
    await erase_at(maker, years_before(CLOSED, -10))

    assert (await read(maker, shops, credit_id))["customer_name"] == NAME


async def test_the_erasure_goes_batch_by_batch_and_skips_a_debt_held_by_a_return(maker, engine):
    shops = await make_two_shops(maker)
    debts = [await in_parts(maker, shops) for _ in range(3)]
    for credit_id in debts:
        await paid_off(maker, shops, credit_id)
        await closed_on(engine, credit_id, CLOSED - timedelta(days=400))
    held = debts[0]

    async with maker() as holder:
        await holder.execute(
            select(CustomerCredit).where(CustomerCredit.id == uuid.UUID(held)).with_for_update()
        )
        await erase_at(maker, CLOSED, batch=1)
        while_held = await row(maker, held)
        await holder.rollback()
    await erase_at(maker, CLOSED, batch=1)

    assert while_held.customer_name == NAME
    for credit_id in debts[1:]:
        assert (await row(maker, credit_id)).customer_name is None
    assert (await row(maker, held)).customer_name is None


async def test_the_watcher_erases_as_it_starts(maker, engine):
    """What the `backup-watch` service runs erases at once, then hourly."""
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await paid_off(maker, shops, credit_id)
    await closed_on(engine, credit_id, datetime.now(UTC) - timedelta(days=367))
    settings = Settings(
        _env_file=None,
        database_url=maker.kw["bind"].url.render_as_string(hide_password=False),
        telegram_bot_token=TEST_BOT_TOKEN,
        api_url="http://127.0.0.1:1",
        admin_telegram_ids=[],
    )
    stop = asyncio.Event()
    running = asyncio.create_task(watch(settings, 600, stop=stop))
    try:
        for _ in range(100):
            if (await row(maker, credit_id)).customer_erased_at is not None:
                break
            await asyncio.sleep(0.1)
    finally:
        stop.set()
        await asyncio.wait_for(running, 5)

    assert (await row(maker, credit_id)).customer_name is None


# --- on the customer's request ---------------------------------------------------


async def test_the_owner_erases_every_closed_debt_of_the_network_under_the_customers_phone(
    maker,
):
    shops = await make_two_shops(maker)
    here = await in_parts(maker, shops)
    there = await in_parts(maker, shops, store=shops.child_store, phone="0671234567")
    still_owed = await in_parts(maker, shops, name="Ірина К.", phone="380671234567")
    unpaid = await in_parts(maker, shops)
    someone_else = await in_parts(maker, shops, name="Олег", phone="0501112233")
    other_network = await make_two_shops(maker)
    elsewhere = await in_parts(maker, other_network)
    await paid_off(maker, shops, here)
    await paid_off(maker, shops, there, store=shops.child_store)
    await written_off(maker, shops, unpaid, f"{NAME} не платить")
    await paid_off(maker, shops, someone_else)
    await paid_off(maker, other_network, elsewhere)

    response = await erase_on_request(maker, network_owner(shops), here)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["erased"], body["still_open"], body["network"]) == (3, 1, True)
    assert body["credit"]["customer_name"] is None
    assert (await row(maker, there)).customer_name is None
    assert (await read(maker, shops, unpaid))["entries"][-1]["note"] is None
    # The same phone in another network is another shop's customer.
    assert (await row(maker, elsewhere)).customer_name == NAME
    assert (await row(maker, still_owed)).customer_phone == "380671234567"
    assert (await row(maker, someone_else)).customer_name == "Олег"
    assert (await row(maker, here)).customer_erased_by_user_id == shops.user_id
    [audited] = await erased_entries(maker, there)
    assert audited.actor_user_id == shops.user_id
    assert audited.after == {"by": "request"}

    again = await erase_on_request(maker, network_owner(shops), here)
    assert again.status_code == 200, again.text
    assert (again.json()["erased"], again.json()["still_open"]) == (0, 0)
    assert len(await erased_entries(maker, here)) == 1


async def test_an_open_debt_keeps_its_customer_even_when_asked(maker):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)

    response = await erase_on_request(maker, network_owner(shops), credit_id)

    assert response.status_code == 422, response.text
    assert response.json()["details"]["reason"] == "STILL_OWED"
    assert (await row(maker, credit_id)).customer_name == NAME


async def test_only_an_owner_erases_a_customer(maker):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await paid_off(maker, shops, credit_id)

    by_seller = await erase_on_request(maker, shops.scope(shops.primary_store), credit_id)
    # Refused before any debt is looked for.
    unknown_to_a_seller = await erase_on_request(
        maker, shops.scope(shops.primary_store), str(uuid.uuid4())
    )
    network_manager = RequestScope(
        user_id=shops.user_id,
        organization_id=shops.organization_id,
        org_permissions=DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER],
    )
    by_network_manager = await erase_on_request(maker, network_manager, credit_id)
    unknown_to_a_manager = await erase_on_request(maker, network_manager, str(uuid.uuid4()))
    by_the_other_stores_owner = await erase_on_request(
        maker, shops.scope(shops.child_store, OWNER), credit_id
    )
    other = await make_two_shops(maker)
    by_another_network = await erase_on_request(maker, network_owner(other), credit_id)

    assert by_seller.status_code == 403
    assert unknown_to_a_seller.status_code == 403
    assert by_network_manager.status_code == 403
    assert unknown_to_a_manager.status_code == 403
    assert by_the_other_stores_owner.status_code == 403
    assert by_another_network.status_code == 404
    assert (await row(maker, credit_id)).customer_name == NAME


async def test_a_stores_owner_erases_the_customer_in_that_store_alone(maker):
    """Owner, 2026-10-09 (C-c): the owner of one store erases its debts; the
    network's owner, every store's."""
    shops = await make_two_shops(maker)
    here = await in_parts(maker, shops)
    owing_here = await in_parts(maker, shops)
    there = await in_parts(maker, shops, store=shops.child_store, phone="0671234567")
    await paid_off(maker, shops, here)
    await paid_off(maker, shops, there, store=shops.child_store)

    response = await erase_on_request(maker, shops.scope(shops.primary_store, OWNER), here)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["erased"], body["still_open"], body["network"]) == (1, 1, False)
    assert (await row(maker, here)).customer_erased_by_user_id == shops.user_id
    assert (await row(maker, owing_here)).customer_name == NAME
    assert (await row(maker, there)).customer_name == NAME

    by_network_owner = await erase_on_request(maker, network_owner(shops), there)
    assert by_network_owner.json()["network"] is True
    assert (await row(maker, there)).customer_name is None


# --- what reads after --------------------------------------------------------------


async def test_an_erased_customer_is_never_found_and_their_debt_stands_alone(maker):
    shops = await make_two_shops(maker)
    closed = await in_parts(maker, shops)
    await paid_off(maker, shops, closed)
    owing = await in_parts(maker, shops)
    erased = await erase_on_request(maker, network_owner(shops), closed)
    assert erased.status_code == 200, erased.text

    async with api(maker, shops.scope(shops.primary_store)) as client:
        found = {
            query: (
                await client.get(
                    "/api/v1/credits/customers",
                    params={"store_id": str(shops.primary_store), "query": query},
                )
            ).json()["items"]
            for query in ("Коваль", "067 123", "")
        }
        listed = (
            await client.get("/api/v1/credits", params={"store_id": str(shops.primary_store)})
        ).json()["items"]
        searched = {
            query: [
                item["id"]
                for item in (
                    await client.get(
                        "/api/v1/credits",
                        params={"store_id": str(shops.primary_store), "query": query},
                    )
                ).json()["items"]
            ]
            for query in ("Коваль", "067 123")
        }
        summary = (
            await client.get(
                "/api/v1/credits/summary", params={"store_id": str(shops.primary_store)}
            )
        ).json()

    for query in ("Коваль", "067 123"):
        assert [[c["id"] for c in customer["credits"]] for customer in found[query]] == [[owing]]
    everyone = {
        customer["phone_digits"]: [c["id"] for c in customer["credits"]] for customer in found[""]
    }
    assert everyone == {"0671234567": [owing], None: [closed]}
    [alone] = [customer for customer in found[""] if customer["phone_digits"] is None]
    assert (alone["customer_name"], alone["customer_phone"]) == (None, None)
    assert {item["id"]: item["customer_name"] for item in listed} == {owing: NAME, closed: None}
    assert searched == {"Коваль": [owing], "067 123": [owing]}
    assert summary == {"owed": "1000.00", "customers": 1, "debts": 1}


async def test_goods_returned_after_the_erasure_still_come_back(maker):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await paid_off(maker, shops, credit_id)
    sale_id = (await read(maker, shops, credit_id))["sale_id"]
    assert (await erase_on_request(maker, network_owner(shops), credit_id)).status_code == 200

    async with api(maker, shops.scope(shops.primary_store)) as client:
        sale = (await client.get(f"/api/v1/sales/{sale_id}")).json()
        refund = await client.post(
            f"/api/v1/sales/{sale_id}/refunds",
            json={
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "sale_item_id": sale["items"][0]["id"],
                        "quantity": 1,
                        "restock": True,
                        "condition": "INTACT",
                    }
                ],
                "payment_method": "CASH",
            },
            headers=key(),
        )

    assert refund.status_code == 201, refund.text
    after = await read(maker, shops, credit_id)
    assert after["customer_name"] is None
    assert after["returned"] == "1500.00"
    assert after["cash_back"] == "1500.00"


# --- what the database refuses -------------------------------------------------------


async def refused(engine: AsyncEngine, statement: str, **values) -> str:
    with pytest.raises(DBAPIError) as caught:
        async with engine.begin() as connection:
            await connection.execute(text(statement), values)
    return str(caught.value)


async def test_the_database_never_erases_an_open_debt_nor_half_a_customer(maker, engine):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)

    open_erased = await refused(
        engine,
        "UPDATE customer_credit SET customer_name = NULL, customer_phone = NULL, "
        "phone_digits = NULL, customer_erased_at = now() WHERE id = :id",
        id=credit_id,
    )
    half = await refused(
        engine, "UPDATE customer_credit SET customer_name = NULL WHERE id = :id", id=credit_id
    )
    by_without_erasing = await refused(
        engine,
        "UPDATE customer_credit SET customer_erased_by_user_id = opened_by_user_id WHERE id = :id",
        id=credit_id,
    )

    assert "customer_erased_when_closed" in open_erased
    assert "customer_erased_whole" in half
    assert "customer_erased_by_when_erased" in by_without_erasing


async def test_an_erased_customer_stays_erased(maker, engine):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await paid_off(maker, shops, credit_id)
    assert (await erase_on_request(maker, network_owner(shops), credit_id)).status_code == 200

    written_back = await refused(
        engine,
        "UPDATE customer_credit SET customer_name = 'Ірина', customer_phone = '0671234567', "
        "phone_digits = '0671234567', customer_erased_at = NULL, "
        "customer_erased_by_user_id = NULL WHERE id = :id",
        id=credit_id,
    )
    moved = await refused(
        engine,
        "UPDATE customer_credit SET customer_erased_at = now() - interval '1 day' WHERE id = :id",
        id=credit_id,
    )
    reassigned = await refused(
        engine,
        "UPDATE customer_credit SET customer_erased_by_user_id = NULL WHERE id = :id",
        id=credit_id,
    )

    for refusal in (written_back, moved, reassigned):
        assert "stays erased" in refusal


async def test_the_ledger_lets_only_an_erased_customers_write_off_reason_go(maker, engine):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await written_off(maker, shops, credit_id, "поїхала")
    write_off = "SELECT id FROM credit_entry WHERE credit_id = :id AND kind = 'WRITE_OFF'"

    before_erasure = await refused(
        engine,
        f"UPDATE credit_entry SET note = NULL WHERE id = ({write_off})",  # noqa: S608
        id=credit_id,
    )
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "UPDATE customer_credit SET customer_name = NULL, customer_phone = NULL, "
                "phone_digits = NULL, customer_erased_at = now() WHERE id = :id"
            ),
            {"id": credit_id},
        )
    reworded = await refused(
        engine,
        f"UPDATE credit_entry SET note = 'інше' WHERE id = ({write_off})",  # noqa: S608
        id=credit_id,
    )
    with_the_amount = await refused(
        engine,
        f"UPDATE credit_entry SET note = NULL, amount = amount + 1 "  # noqa: S608
        f"WHERE id = ({write_off})",
        id=credit_id,
    )
    a_payment = await refused(
        engine,
        "UPDATE credit_entry SET correlation_id = 'x' WHERE credit_id = :id AND kind = 'PAYMENT'",
        id=credit_id,
    )
    deleted = await refused(
        engine,
        f"DELETE FROM credit_entry WHERE id = ({write_off})",  # noqa: S608
        id=credit_id,
    )
    async with engine.begin() as connection:
        await connection.execute(
            text(f"UPDATE credit_entry SET note = NULL WHERE id = ({write_off})"),  # noqa: S608
            {"id": credit_id},
        )

    for refusal in (before_erasure, reworded, with_the_amount, a_payment, deleted):
        assert "append-only" in refusal
    async with maker() as session:
        entry = await session.scalar(
            select(CreditEntry).where(
                CreditEntry.credit_id == uuid.UUID(credit_id), CreditEntry.kind == "WRITE_OFF"
            )
        )
    assert entry is not None
    assert entry.note is None
    assert entry.amount == 1000


async def test_a_write_off_still_says_why_when_it_is_written(maker, engine):
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    columns = (
        "INSERT INTO credit_entry (id, organization_id, credit_id, kind, amount, cash_back, "
        "command_id, command_fingerprint, actor_user_id, note) "
        "SELECT gen_random_uuid(), organization_id, id, CAST(:kind AS varchar), 1, 0, "
        "gen_random_uuid(), repeat('0', 64), opened_by_user_id, CAST(:note AS text) "
        "FROM customer_credit WHERE id = :id"
    )

    silent = await refused(engine, columns, kind="WRITE_OFF", note=None, id=credit_id)
    a_payment_with_a_note = await refused(
        engine, columns, kind="PAYMENT", note="Ірина", id=credit_id
    )

    assert "A write-off says why" in silent
    assert "only_a_write_off_says_why" in a_payment_with_a_note


async def test_the_owners_erasure_and_the_terms_erasure_never_both_erase_a_debt(maker, engine):
    """The owner's erasure waits for a debt another transaction holds; the
    term's skips it. Whichever comes second finds it erased."""
    shops = await make_two_shops(maker)
    credit_id = await in_parts(maker, shops)
    await paid_off(maker, shops, credit_id)
    await closed_on(engine, credit_id, CLOSED - timedelta(days=800))

    async with maker() as holder:
        await holder.execute(
            select(CustomerCredit)
            .where(CustomerCredit.id == uuid.UUID(credit_id))
            .with_for_update()
        )
        asked = asyncio.create_task(erase_on_request(maker, network_owner(shops), credit_id))
        await asyncio.sleep(0.5)
        waiting = not asked.done()
        await erase_at(maker, CLOSED)
        skipped = (await row(maker, credit_id)).customer_name
        await holder.rollback()
    answer = await asyncio.wait_for(asked, 10)
    await erase_at(maker, CLOSED)

    assert waiting
    assert skipped == NAME
    assert answer.status_code == 200, answer.text
    assert answer.json()["erased"] == 1
    assert len(await erased_entries(maker, credit_id)) == 1


async def test_0038_goes_down_only_while_no_customer_is_erased():
    """Down to `0037`, a debt must have its customer again: once one is
    erased, the downgrade refuses, and changes nothing."""
    name = f"birka_erasure_{uuid.uuid4().hex[:10]}"
    await _admin(f'CREATE DATABASE "{name}"')
    config = _alembic(name)
    try:
        await _run(config, "upgrade", "head", database=name)
        scratch = await _engine(name)
        try:
            maker = async_sessionmaker(scratch, expire_on_commit=False)
            shops = await make_two_shops(maker)
            kept = await in_parts(maker, shops)
            await _run(config, "downgrade", "0037_stock_list_parts", database=name)
            await _run(config, "upgrade", "head", database=name)
            await scratch.dispose()
            await paid_off(maker, shops, kept)
            assert (await erase_on_request(maker, network_owner(shops), kept)).status_code == 200

            with pytest.raises(Exception, match="A customer has been erased"):
                await _run(config, "downgrade", "0037_stock_list_parts", database=name)

            async with scratch.connect() as connection:
                version = await connection.scalar(text("SELECT version_num FROM alembic_version"))
            assert version == "0038_customer_erasure"
            assert (await row(maker, kept)).customer_erased_at is not None
        finally:
            await scratch.dispose()
    finally:
        await _admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
