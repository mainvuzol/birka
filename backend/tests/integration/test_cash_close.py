"""The day's close (owner decisions, 2026-10-04; ADR-0012, B4, B7), through
the service and over HTTP, against real PostgreSQL, with real people signed
in by a session token.

- The seller on duty counts the drawer blind: nothing they reach before the
  count says what it should hold. Then they see the difference, and write
  its reason as a second command; until they do, their phone owes it.
- What was counted is where the next period starts. The first close, and the
  first after the archive, only records what is there.
- Once a business day, 06:00 to 06:00: a close at 00:10 is the evening
  before's. A day nobody closed goes into the next close, and shows.
- A count that reaches the server more than ten minutes late, or after
  somebody else closed, is not recorded, and says so (`recorded: false`).
- A blocked store is closed by the network's owner alone, decided on the
  store's row the close holds.
- The worked examples of B7, with their exact figures. Money rows are written
  straight into their tables where only the drawer's arithmetic is at stake:
  the database stamps every insert path alike (`test_cash_schema.py`).

All data is synthetic.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Awaitable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine as new_engine

from app.api.deps import session_dependency
from app.core.errors import (
    DomainError,
    StoreNotTradingError,
    ValidationFailedError,
)
from app.main import create_app
from app.modules.authz.models import Membership
from app.modules.authz.permissions import RoleCode
from app.modules.authz.service import resolve_scope, seed_default_roles
from app.modules.cash.models import CashClose, CashMovement, MovementKind
from app.modules.cash.read import reason_owed
from app.modules.cash.service import Target as CorrectionTarget
from app.modules.cash.service import close_day, correct, newest_close, record_movement
from app.modules.credit.models import CreditEntry, CustomerCredit
from app.modules.identity.models import AppUser
from app.modules.identity.session import issue_session_token
from app.modules.orders.models import CustomerOrder
from app.modules.refunds.models import Refund
from app.modules.sales.models import Sale
from app.modules.sales.payment import PaymentMethod
from tests.conftest import requires_database
from tests.integration.test_shared_warehouse import (
    SETTINGS,
    TwoShops,
    api,
    key,
    make_two_shops,
    sale_body,
    stock_a_coat,
)

pytestmark = [pytest.mark.integration, requires_database()]

KYIV = ZoneInfo("Europe/Kyiv")
PRINT = "0" * 64
# `after_close_id` as a fresh screen would send it: the newest close.
NEWEST: Any = object()

DRAWER_KEYS = {
    "store_id",
    "store_name",
    "store_state",
    "last_close",
    "next_is_opening",
    "closed_today",
    "may_close",
    "movement_kinds",
    "may_correct",
    "movements",
    "unclosed_days",
    "reason_owed",
}
# What a seller never sees of a close, even their own (G27).
STARRED = (
    "opening_float",
    "cash_in",
    "cash_out",
    "taken_out",
    "put_in",
    "cash_corrected",
    "prepaid_transfer",
    "carrier_cod",
    "not_stated",
    "explained",
    "unexplained",
)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    instance = new_engine(os.environ["BIRKA_TEST_DATABASE_URL"])
    yield instance
    await instance.dispose()


@pytest.fixture
def maker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def at(day: int, hour: int, minute: int = 0, *, month: int = 10) -> datetime:
    """A moment in Kyiv, October 2026 (B7's week)."""
    return datetime(2026, month, day, hour, minute, tzinfo=KYIV)


def d(value: str) -> Decimal:
    return Decimal(value)


# --- the network -----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Net:
    shops: TwoShops
    # The network's owner and a manager of the whole network.
    owner: uuid.UUID
    manager: uuid.UUID
    # Two sellers of the store, «Марина» and «Олена».
    seller: uuid.UUID
    colleague: uuid.UUID
    # The other store's own owner and seller.
    child_owner: uuid.UUID
    child_seller: uuid.UUID
    chats: Mapping[uuid.UUID, int]

    @property
    def org(self) -> uuid.UUID:
        return self.shops.organization_id

    @property
    def store(self) -> uuid.UUID:
        return self.shops.primary_store

    @property
    def other(self) -> uuid.UUID:
        return self.shops.child_store


PEOPLE = (
    ("owner", "Власниця", RoleCode.OWNER, None),
    ("manager", "Ганна", RoleCode.MANAGER, None),
    ("seller", "Марина", RoleCode.SELLER, "store"),
    ("colleague", "Олена", RoleCode.SELLER, "store"),
    ("child_owner", "Ірина", RoleCode.OWNER, "other"),
    ("child_seller", "Петро", RoleCode.SELLER, "other"),
)


async def network(maker: async_sessionmaker[AsyncSession]) -> Net:
    shops = await make_two_shops(maker)
    async with maker() as session:
        roles = await seed_default_roles(session, shops.organization_id)
        people: dict[str, uuid.UUID] = {}
        chats: dict[uuid.UUID, int] = {}
        for key, name, role, where in PEOPLE:
            chat = uuid.uuid4().int % 2**52
            user = AppUser(telegram_user_id=chat, display_name=name)
            session.add(user)
            await session.flush()
            store = {"store": shops.primary_store, "other": shops.child_store}.get(where or "")
            session.add(
                Membership(
                    user_id=user.id,
                    organization_id=shops.organization_id,
                    store_id=store,
                    role_id=roles[role.value].id,
                )
            )
            people[key] = user.id
            chats[user.id] = chat
        await session.commit()
    return Net(shops=shops, chats=chats, **people)


@asynccontextmanager
async def as_(
    maker: async_sessionmaker[AsyncSession], net: Net, user_id: uuid.UUID
) -> AsyncIterator[httpx.AsyncClient]:
    """Signed in as this person: a real token, and the scope the server
    builds for it on every request."""
    app = create_app(SETTINGS)

    async def sessions() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[session_dependency] = sessions
    token, _ = issue_session_token(
        user_id=user_id,
        organization_id=net.org,
        secret=SETTINGS.session_secret.get_secret_value(),
        ttl_seconds=3600,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        yield client


async def set_state(maker, net: Net, store: uuid.UUID, state: str) -> None:
    async with as_(maker, net, net.owner) as client:
        changed = await client.post(
            f"/api/v1/stores/{store}/state",
            json={"command_id": str(uuid.uuid4()), "state": state, "reason": "перевірка"},
        )
    assert changed.status_code == 200, changed.text


# --- money rows, written as a script would ---------------------------------------------


async def row(maker: async_sessionmaker[AsyncSession], model: Any, **values: Any) -> uuid.UUID:
    async with maker() as session:
        found = await session.scalar(insert(model).values(**values).returning(model.id))
        await session.commit()
    assert found is not None
    return found


async def sold(
    maker,
    net: Net,
    total: str,
    method: str | None,
    *,
    store: uuid.UUID | None = None,
    seller: uuid.UUID | None = None,
    when: datetime | None = None,
) -> uuid.UUID:
    """A sale paid in full."""
    return await row(
        maker,
        Sale,
        organization_id=net.org,
        store_id=store or net.store,
        seller_user_id=seller or net.seller,
        command_id=uuid.uuid4(),
        command_fingerprint=PRINT,
        currency_code="UAH",
        subtotal=d(total),
        total=d(total),
        payment_method=method,
        **({"sold_at": when} if when else {}),
    )


@dataclass(frozen=True, slots=True)
class InParts:
    sale_id: uuid.UUID
    credit_id: uuid.UUID
    first_payment: uuid.UUID


async def sold_in_parts(
    maker,
    net: Net,
    total: str,
    paid_now: str,
    method: str,
    *,
    store: uuid.UUID | None = None,
    seller: uuid.UUID | None = None,
) -> InParts:
    """A sale paid in parts: the sale, its debt, and the first payment, which
    shares the sale's command."""
    command = uuid.uuid4()
    where = store or net.store
    who = seller or net.seller
    async with maker() as session:
        sale_id = await session.scalar(
            insert(Sale)
            .values(
                organization_id=net.org,
                store_id=where,
                seller_user_id=who,
                command_id=command,
                command_fingerprint=PRINT,
                currency_code="UAH",
                subtotal=d(total),
                total=d(total),
                payment_method=method,
            )
            .returning(Sale.id)
        )
        credit_id = await session.scalar(
            insert(CustomerCredit)
            .values(
                organization_id=net.org,
                store_id=where,
                sale_id=sale_id,
                customer_name="Оксана",
                customer_phone="0671234567",
                phone_digits="0671234567",
                amount=d(total),
                currency_code="UAH",
                opened_by_user_id=who,
            )
            .returning(CustomerCredit.id)
        )
        first = await session.scalar(
            insert(CreditEntry)
            .values(
                organization_id=net.org,
                credit_id=credit_id,
                kind="PAYMENT",
                amount=d(paid_now),
                command_id=command,
                command_fingerprint=PRINT,
                actor_user_id=who,
                payment_method=method,
            )
            .returning(CreditEntry.id)
        )
        await session.commit()
    assert sale_id and credit_id and first
    return InParts(sale_id, credit_id, first)


async def paid(
    maker,
    net: Net,
    credit_id: uuid.UUID,
    amount: str,
    method: str | None,
    *,
    taken_at: uuid.UUID | None = None,
    actor: uuid.UUID | None = None,
) -> uuid.UUID:
    """A later payment toward a debt."""
    return await row(
        maker,
        CreditEntry,
        organization_id=net.org,
        credit_id=credit_id,
        kind="PAYMENT",
        amount=d(amount),
        command_id=uuid.uuid4(),
        command_fingerprint=PRINT,
        actor_user_id=actor or net.seller,
        payment_method=method,
        taken_at_store_id=taken_at,
    )


async def handed_back(
    maker,
    net: Net,
    sale_id: uuid.UUID,
    amount: str,
    method: str | None,
    *,
    taken_at: uuid.UUID | None = None,
    actor: uuid.UUID | None = None,
    credit_id: uuid.UUID | None = None,
    cash_back: str | None = None,
) -> uuid.UUID:
    """A refund: goods worth `amount` came back; for a sale in parts only
    `cash_back` of it went back as money."""
    async with maker() as session:
        sold_at = await session.scalar(select(Sale.store_id).where(Sale.id == sale_id))
        refund_id = await session.scalar(
            insert(Refund)
            .values(
                organization_id=net.org,
                store_id=sold_at,
                sale_id=sale_id,
                taken_at_store_id=taken_at or sold_at,
                actor_user_id=actor or net.seller,
                command_id=uuid.uuid4(),
                command_fingerprint=PRINT,
                total_amount=d(amount),
                currency_code="UAH",
                payment_method=method,
            )
            .returning(Refund.id)
        )
        if credit_id is not None:
            back = d(cash_back or "0")
            await session.execute(
                insert(CreditEntry).values(
                    organization_id=net.org,
                    credit_id=credit_id,
                    kind="RETURN",
                    amount=d(amount) - back,
                    cash_back=back,
                    refund_id=refund_id,
                    actor_user_id=actor or net.seller,
                )
            )
        await session.commit()
    assert refund_id is not None
    return refund_id


async def collected(
    maker, net: Net, total: str, method: str, *, collector: uuid.UUID | None = None
) -> uuid.UUID:
    """An order the customer collected, and the sale «Клієнт забрав» made."""
    sale_id = await sold(maker, net, total, method, seller=collector)
    await row(
        maker,
        CustomerOrder,
        organization_id=net.org,
        store_id=net.store,
        created_by_user_id=collector or net.seller,
        status="COLLECTED",
        sale_id=sale_id,
    )
    return sale_id


async def moved(
    maker,
    net: Net,
    kind: str,
    amount: str,
    *,
    by: uuid.UUID | None = None,
    when: datetime | None = None,
    store: uuid.UUID | None = None,
) -> uuid.UUID:
    """Cash taken out or put in, written straight into the table."""
    return await row(
        maker,
        CashMovement,
        organization_id=net.org,
        store_id=store or net.store,
        kind=kind,
        direction="IN" if kind == "CHANGE" else "OUT",
        amount=d(amount),
        actor_user_id=by or net.owner,
        command_id=uuid.uuid4(),
        command_fingerprint=PRINT,
        **({"created_at": when} if when else {}),
    )


# --- closes, through the service ----------------------------------------------------------


async def close(
    maker,
    net: Net,
    counted: str,
    *,
    now: datetime | None,
    by: uuid.UUID | None = None,
    store: uuid.UUID | None = None,
    after: Any = NEWEST,
    age: int = 0,
    command_id: uuid.UUID | None = None,
    counted_at: datetime | None = None,
) -> CashClose:
    """A close as a phone sends it, with `now` standing in for the server's
    clock (`close_day(now=…)`, tests only)."""
    drawer = store or net.store
    async with maker() as session:
        scope = await resolve_scope(session, by or net.seller)
        if after is NEWEST:
            newest = await newest_close(session, drawer)
            after = newest.id if newest else None
        found = await close_day(
            session,
            scope=scope,
            store_id=drawer,
            command_id=command_id or uuid.uuid4(),
            counted=d(counted),
            counted_at=counted_at or now or datetime.now(UTC),
            after_close_id=after,
            age=age,
            now=now,
        )
        await session.commit()
    return found


async def refused(attempt: Awaitable[Any]) -> DomainError:
    try:
        await attempt
    except DomainError as error:
        return error
    raise AssertionError("not refused")


async def seen(maker, net: Net, close_id: uuid.UUID, by: uuid.UUID) -> dict[str, Any]:
    async with as_(maker, net, by) as client:
        answer = await client.get(f"/api/v1/cash/closes/{close_id}")
    assert answer.status_code == 200, answer.text
    return answer.json()


def figures(view: Any, *keys: str) -> tuple[Any, ...]:
    """These fields of an answer, or of a row."""
    if isinstance(view, Mapping):
        return tuple(view[key] for key in keys)
    return tuple(getattr(view, key) for key in keys)


# --- B7: the worked examples ---------------------------------------------------------------


async def test_d_the_first_close_only_records_what_is_there(maker):
    """Example D (G6): nothing counted before; the count is where the next
    period starts, with no expected sum and no difference."""
    net = await network(maker)
    await sold(maker, net, "3000.00", "CASH")
    await sold(maker, net, "400.00", "CARD")
    first = await close(maker, net, "2000.00", now=at(6, 20))
    assert (first.number, first.is_opening, first.business_day) == (1, True, date(2026, 10, 6))
    assert (first.opening_float, first.expected, first.difference) == (None, None, None)
    # Still summed and frozen, for the slip.
    assert first.cash_in == d("3000.00")
    view = await seen(maker, net, first.id, net.owner)
    assert view["opening"] is True and view["reason_required"] is False
    assert view["expected"] is None and view["difference"] is None
    assert view["card"] == {
        "came_in": "400.00",
        "went_out": "0.00",
        "corrected": "0.00",
        "net": "400.00",
    }
    assert view["unclosed_days"] == []


async def test_the_ordinary_day_with_its_exact_figures(maker):
    """B7, Tuesday: float 2000; S1 cash 3000; S2 card 2500; S3 4000 in parts,
    1000 cash now; P1 500 by transfer; R1 1200 cash back; R2 2500 to the card;
    «Витрати» 150; O1 1800 cash on delivery; O2 900 cash at the counter; S4
    700 recorded card, fixed to cash by its seller before the close. Counted
    6100: expected 6250, 150 short."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    s1 = await sold(maker, net, "3000.00", "CASH")
    s2 = await sold(maker, net, "2500.00", "CARD")
    s3 = await sold_in_parts(maker, net, "4000.00", "1000.00", "CASH")
    await paid(maker, net, s3.credit_id, "500.00", "TRANSFER")
    await handed_back(maker, net, s1, "1200.00", "CASH")
    await handed_back(maker, net, s2, "2500.00", "CARD")
    await moved(maker, net, "EXPENSES", "150.00", by=net.seller)
    await collected(maker, net, "1800.00", "CARRIER_COD")
    await collected(maker, net, "900.00", "CASH")
    s4 = await sold(maker, net, "700.00", "CARD")
    async with maker() as session:
        scope = await resolve_scope(session, net.seller)
        await correct(
            session,
            scope=scope,
            command_id=uuid.uuid4(),
            target=CorrectionTarget.SALE,
            target_id=s4,
            from_method=PaymentMethod.CARD,
            to_method=PaymentMethod.CASH,
        )
        await session.commit()

    second = await close(maker, net, "6100.00", now=at(7, 20, 14))
    assert figures(
        second,
        "number",
        "is_opening",
        "opening_float",
        "cash_in",
        "cash_out",
        "taken_out",
        "put_in",
        "cash_corrected",
        "expected",
        "difference",
    ) == (
        2,
        False,
        d("2000.00"),
        d("4900.00"),
        d("1200.00"),
        d("150.00"),
        d("0.00"),
        d("700.00"),
        d("6250.00"),
        d("-150.00"),
    )
    full = await seen(maker, net, second.id, net.owner)
    assert full["card"] == {
        "came_in": "3200.00",
        "went_out": "2500.00",
        "corrected": "-700.00",
        "net": "0.00",
    }
    assert full["transfer"] == {
        "came_in": "500.00",
        "went_out": "0.00",
        "corrected": "0.00",
        "net": "500.00",
    }
    assert (full["carrier_cod"], full["prepaid_transfer"]) == ("1800.00", "0.00")
    assert full["not_stated"] == {
        "came_in": "0.00",
        "went_out": "0.00",
        "corrected": "0.00",
        "net": "0.00",
    }
    assert full["reason_required"] is True and full["reason"] is None
    # Fixed before the close, so nothing is left to explain later.
    assert (full["explained"], full["unexplained"], full["explanations"]) == (
        "0.00",
        "-150.00",
        [],
    )


async def test_a_a_wrong_way_found_after_the_close_explains_that_close(maker):
    """Example A (G7): 350 over on Tuesday; on Wednesday the manager finds
    S5 was cash, not card. Tuesday's close keeps its figures and reads
    «пояснено 350, не пояснено 0»; Wednesday starts from what was counted and
    is not moved again."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    await sold(maker, net, "4250.00", "CASH")
    s5 = await sold(maker, net, "350.00", "CARD")
    tuesday = await close(maker, net, "6600.00", now=at(7, 20))
    assert (tuesday.expected, tuesday.difference) == (d("6250.00"), d("350.00"))

    async with maker() as session:
        scope = await resolve_scope(session, net.manager)
        found = await correct(
            session,
            scope=scope,
            command_id=uuid.uuid4(),
            target=CorrectionTarget.SALE,
            target_id=s5,
            from_method=PaymentMethod.CARD,
            to_method=PaymentMethod.CASH,
            note="за чеком терміналу",
        )
        await session.commit()
    assert found.explains_close_id == tuesday.id

    view = await seen(maker, net, tuesday.id, net.owner)
    assert figures(view, "expected", "counted", "difference", "explained", "unexplained") == (
        "6250.00",
        "6600.00",
        "350.00",
        "350.00",
        "0.00",
    )
    [explanation] = view["explanations"]
    assert figures(explanation, "kind", "by", "cash", "text") == (
        "CORRECTION",
        "Ганна",
        "350.00",
        "Картка → Готівка: за чеком терміналу",
    )

    await sold(maker, net, "1000.00", "CASH")
    wednesday = await close(maker, net, "7600.00", now=at(8, 20))
    assert figures(wednesday, "opening_float", "cash_corrected", "expected", "difference") == (
        d("6600.00"),
        d("0.00"),
        d("7600.00"),
        d("0.00"),
    )


async def test_b_a_forgotten_take_out_explains_the_shortage_and_lowers_nothing_again(maker):
    """Example B: the owner took 1000 at 15:00 and recorded nothing; 1000
    short. On Wednesday they record «Власнику, 1000, до закриття 07.10»."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    await sold(maker, net, "4250.00", "CASH")
    tuesday = await close(maker, net, "5250.00", now=at(7, 20))
    assert tuesday.difference == d("-1000.00")

    async with maker() as session:
        scope = await resolve_scope(session, net.owner)
        late = await record_movement(
            session,
            scope=scope,
            store_id=net.store,
            command_id=uuid.uuid4(),
            kind=MovementKind.OWNER,
            amount=d("1000.00"),
            note=None,
            after_close_id=tuesday.id,
            for_close_id=tuesday.id,
        )
        await session.commit()
    assert (late.for_close_id, late.moved_to_close) == (tuesday.id, False)

    view = await seen(maker, net, tuesday.id, net.owner)
    assert figures(view, "difference", "explained", "unexplained") == (
        "-1000.00",
        "-1000.00",
        "0.00",
    )
    assert figures(view["explanations"][0], "kind", "cash", "text") == (
        "TAKE_OUT",
        "-1000.00",
        "Власнику",
    )

    await sold(maker, net, "1000.00", "CASH")
    wednesday = await close(maker, net, "6250.00", now=at(8, 20))
    assert figures(wednesday, "taken_out", "expected", "difference") == (
        d("0.00"),
        d("6250.00"),
        d("0.00"),
    )


async def test_f_a_day_nobody_closed_goes_into_the_next_close_and_shows(maker):
    """Example F (G9): nobody closes on Wednesday 08.10; Thursday's close
    holds it and says so. The counted day itself is never listed, and a sale
    at 03:00 on Thursday belongs to Wednesday."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    await close(maker, net, "2000.00", now=at(7, 20))
    await sold(maker, net, "500.00", "CASH", when=at(8, 12))
    await sold(maker, net, "100.00", "CASH", when=at(9, 3))
    await sold(maker, net, "300.00", "CASH", when=at(9, 11))
    await moved(maker, net, "EXPENSES", "50.00", when=at(9, 12))
    thursday = await close(maker, net, "2850.00", now=at(9, 20))
    assert thursday.expected == d("2850.00") and thursday.difference == d("0.00")
    view = await seen(maker, net, thursday.id, net.owner)
    assert view["unclosed_days"] == ["2026-10-08"]

    # Two days nobody closed.
    await sold(maker, net, "100.00", "CASH", when=at(10, 12))
    await sold(maker, net, "100.00", "CASH", when=at(11, 12))
    sunday = await close(maker, net, "3050.00", now=at(12, 20))
    assert (await seen(maker, net, sunday.id, net.owner))["unclosed_days"] == [
        "2026-10-10",
        "2026-10-11",
    ]


async def test_a_day_not_closed_is_read_with_the_six_oclock_boundary_too(maker):
    """G8, G9: the days nobody closed are found in SQL with the same 06:00
    boundary as the close. A sale at 05:00 on 07.10 is 06.10's, the day the
    last close counted, so 07.10 is not listed for it; one at 03:00 on 09.10
    is 08.10's, which nobody closed."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    await sold(maker, net, "100.00", "CASH", when=at(7, 5))
    await sold(maker, net, "200.00", "CASH", when=at(9, 3))
    second = await close(maker, net, "2300.00", now=at(9, 20))
    assert (second.business_day, second.difference) == (date(2026, 10, 9), d("0.00"))
    view = await seen(maker, net, second.id, net.owner)
    assert view["unclosed_days"] == ["2026-10-08"]


async def test_g_money_taken_or_handed_back_at_another_store_is_that_drawers(maker):
    """Example G: a payment on the other store's debt taken here in cash, and
    the other store's card sale returned here — once in cash, once to the
    card — are this drawer's; the other drawer never sees them."""
    net = await network(maker)
    await close(maker, net, "0.00", now=at(6, 20))
    await close(maker, net, "0.00", now=at(6, 20), by=net.child_seller, store=net.other)
    debt = await sold_in_parts(
        maker, net, "1000.00", "200.00", "CARD", store=net.other, seller=net.child_seller
    )
    await paid(maker, net, debt.credit_id, "400.00", "CASH", taken_at=net.store)
    card_sale = await sold(maker, net, "1200.00", "CARD", store=net.other, seller=net.child_seller)
    await handed_back(maker, net, card_sale, "600.00", "CASH", taken_at=net.store)
    await handed_back(maker, net, card_sale, "600.00", "CARD", taken_at=net.store)

    here = await close(maker, net, "0.00", now=at(7, 20), after=NEWEST)
    assert figures(here, "cash_in", "cash_out", "expected") == (
        d("400.00"),
        d("600.00"),
        d("-200.00"),
    )
    assert here.others["CARD"] == {"came_in": "0.00", "went_out": "600.00", "corrected": "0.00"}
    there = await close(maker, net, "0.00", now=at(7, 20), by=net.child_seller, store=net.other)
    assert (there.cash_in, there.cash_out) == (d("0.00"), d("0.00"))
    assert there.others["CARD"]["came_in"] == "1400.00"


async def test_a_return_of_a_sale_paid_in_parts_hands_back_only_its_cash_back(maker):
    """Owner decision, 2026-10-01: returned goods first lower the debt; only
    what was paid beyond the worth of what is kept goes back, and only that
    leaves the drawer. One that only lowered the debt moved no money."""
    net = await network(maker)
    await close(maker, net, "1000.00", now=at(6, 20))
    debt = await sold_in_parts(maker, net, "1500.00", "1200.00", "CASH")
    await handed_back(
        maker, net, debt.sale_id, "500.00", "CASH", credit_id=debt.credit_id, cash_back="200.00"
    )
    other = await sold_in_parts(maker, net, "1000.00", "100.00", "CARD")
    await handed_back(maker, net, other.sale_id, "300.00", None, credit_id=other.credit_id)
    second = await close(maker, net, "2000.00", now=at(7, 20))
    assert figures(second, "cash_in", "cash_out", "expected", "difference") == (
        d("1200.00"),
        d("200.00"),
        d("2000.00"),
        d("0.00"),
    )
    assert second.others["NOT_STATED"]["went_out"] == "0.00"


async def test_a_voided_sale_is_not_the_drawers(maker):
    net = await network(maker)
    await close(maker, net, "0.00", now=at(6, 20))
    voided = await sold(maker, net, "900.00", "CASH")
    async with maker() as session:
        await session.execute(update(Sale).where(Sale.id == voided).values(status="VOIDED"))
        await session.commit()
    await sold(maker, net, "100.00", "CASH")
    second = await close(maker, net, "100.00", now=at(7, 20))
    assert (second.cash_in, second.difference) == (d("100.00"), d("0.00"))


async def test_an_order_collected_in_parts_paid_off_the_till_is_not_the_drawers_cash(maker):
    """G2, G24: the part paid now of an order collected in parts, paid by
    cash on delivery or in advance by transfer, is its first payment, and it
    never went through the drawer: the count does not expect it, and the
    owner sees it beside cash. Paid at the counter in cash, it is cash."""
    net = await network(maker)
    await close(maker, net, "1000.00", now=at(6, 20))
    for total, paid_now, way in (
        ("3000.00", "1000.00", "CARRIER_COD"),
        ("2000.00", "500.00", "PREPAID_TRANSFER"),
        ("1500.00", "300.00", "CASH"),
    ):
        order = await sold_in_parts(maker, net, total, paid_now, way)
        await row(
            maker,
            CustomerOrder,
            organization_id=net.org,
            store_id=net.store,
            created_by_user_id=net.seller,
            status="COLLECTED",
            sale_id=order.sale_id,
        )
    second = await close(maker, net, "1300.00", now=at(7, 20))
    assert figures(second, "cash_in", "expected", "difference") == (
        d("300.00"),
        d("1300.00"),
        d("0.00"),
    )
    full = await seen(maker, net, second.id, net.owner)
    assert (full["carrier_cod"], full["prepaid_transfer"]) == ("1000.00", "500.00")


async def test_h_a_blocked_store_is_closed_by_the_network_owner_alone(maker):
    """Example H (G14): neither a network manager, nor the store's own owner,
    nor its seller; the owner's answer is in full."""
    net = await network(maker)
    await close(maker, net, "100.00", now=datetime.now(UTC) - timedelta(days=2))
    await sold(maker, net, "3100.00", "CASH")
    await set_state(maker, net, net.store, "BLOCKED")

    async def attempt(user: uuid.UUID) -> httpx.Response:
        async with as_(maker, net, user) as client:
            newest = (await client.get(f"/api/v1/cash/drawer?store_id={net.store}")).json()
            return await client.post(
                "/api/v1/cash/closes",
                json={
                    "store_id": str(net.store),
                    "command_id": str(uuid.uuid4()),
                    "counted": "3200.00",
                    "counted_at": datetime.now(UTC).isoformat(),
                    "after_close_id": (newest.get("last_close") or {}).get("id"),
                },
            )

    for someone in (net.manager, net.child_owner, net.seller):
        answer = await attempt(someone)
        assert answer.status_code == 403, answer.text
        assert answer.json()["code"] in {"STORE_NOT_TRADING", "FORBIDDEN_STORE"}
    answer = await attempt(net.owner)
    assert answer.status_code == 201, answer.text
    body = answer.json()
    assert figures(body, "expected", "difference", "cash_in", "mine") == (
        "3200.00",
        "0.00",
        "3100.00",
        True,
    )


async def test_i_cash_put_in_for_change_keeps_the_count_from_showing_a_surplus(maker):
    """Example I (G29): close #2 counted 6100; the owner takes it all, and
    brings 500 for change in the morning; cash sales 1000."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    await sold(maker, net, "4100.00", "CASH")
    await close(maker, net, "6100.00", now=at(7, 20))
    await moved(maker, net, "OWNER", "6100.00")
    await moved(maker, net, "CHANGE", "500.00")
    await sold(maker, net, "1000.00", "CASH")
    third = await close(maker, net, "1500.00", now=at(8, 20))
    assert figures(third, "taken_out", "put_in", "expected", "difference") == (
        d("6100.00"),
        d("500.00"),
        d("1500.00"),
        d("0.00"),
    )


async def test_k_a_kept_close_resent_the_next_day_is_refused_and_settles(maker):
    """Example K (G31): Tuesday's count never arrived; resent at 09:30 on
    Wednesday it is refused as stale, records nothing, and Wednesday's
    evening close covers both days."""
    net = await network(maker)
    first = await close(maker, net, "2000.00", now=at(6, 20))
    await sold(maker, net, "4250.00", "CASH", when=at(7, 12))
    kept = uuid.uuid4()
    error = await refused(
        close(
            maker,
            net,
            "6100.00",
            now=at(8, 9, 30),
            counted_at=at(7, 20),
            after=first.id,
            age=48_600,
            command_id=kept,
        )
    )
    assert isinstance(error, ValidationFailedError)
    assert error.details["reason"] == "COUNT_IS_STALE"
    assert error.details["recorded"] is False
    assert error.details["counted_at"] == at(7, 20).isoformat()

    await sold(maker, net, "1200.00", "CASH", when=at(8, 8))
    wednesday = await close(maker, net, "7450.00", now=at(8, 20), after=first.id)
    assert (wednesday.number, wednesday.business_day) == (2, date(2026, 10, 8))
    assert (wednesday.expected, wednesday.difference) == (d("7450.00"), d("0.00"))
    assert (await seen(maker, net, wednesday.id, net.owner))["unclosed_days"] == ["2026-10-07"]


# --- once a business day (G8) -----------------------------------------------------------------


async def test_once_a_business_day_and_a_close_before_six_is_the_evening_befores(maker):
    net = await network(maker)
    first = await close(maker, net, "100.00", now=at(6, 20), by=net.colleague)
    for too_early in (at(6, 23), at(7, 0, 10), at(7, 5, 59)):
        error = await refused(close(maker, net, "100.00", now=too_early))
        assert isinstance(error, ValidationFailedError)
        assert error.details == {
            "reason": "ALREADY_CLOSED_TODAY",
            "recorded": False,
            "closed_at": error.details["closed_at"],
            "closed_by": "Олена",
        }
        assert datetime.fromisoformat(error.details["closed_at"]) == first.closed_at
    morning = await close(maker, net, "100.00", now=at(7, 6))
    assert (morning.number, morning.business_day) == (2, date(2026, 10, 7))


async def test_a_close_after_midnight_leaves_the_evening_free(maker):
    net = await network(maker)
    await close(maker, net, "100.00", now=at(5, 20))
    night = await close(maker, net, "100.00", now=at(7, 0, 10))
    assert night.business_day == date(2026, 10, 6)
    evening = await close(maker, net, "100.00", now=at(7, 20))
    assert evening.business_day == date(2026, 10, 7)


# --- a count that no longer describes the drawer (G31) ------------------------------------------


async def test_a_count_older_than_ten_minutes_is_refused_and_ten_minutes_is_not(maker):
    net = await network(maker)
    async with as_(maker, net, net.seller) as client:

        async def send(age: int) -> httpx.Response:
            return await client.post(
                f"/api/v1/cash/closes?age={age}",
                json={
                    "store_id": str(net.store),
                    "command_id": str(uuid.uuid4()),
                    "counted": "100.00",
                    "counted_at": datetime.now(UTC).isoformat(),
                    "after_close_id": None,
                },
            )

        stale = await send(601)
        assert stale.status_code == 422, stale.text
        assert stale.json()["details"]["reason"] == "COUNT_IS_STALE"
        assert stale.json()["details"]["recorded"] is False
        fresh = await send(600)
        assert fresh.status_code == 201, fresh.text


async def test_a_count_after_somebody_elses_close_is_not_recorded(maker):
    net = await network(maker)
    olena = await close(maker, net, "100.00", now=at(6, 20), by=net.colleague)
    error = await refused(close(maker, net, "100.00", now=at(7, 20), after=None))
    assert isinstance(error, ValidationFailedError)
    assert error.details == {
        "reason": "CLOSED_BY_ANOTHER",
        "recorded": False,
        "closed_at": error.details["closed_at"],
        "closed_by": "Олена",
    }
    assert datetime.fromisoformat(error.details["closed_at"]) == olena.closed_at
    async with maker() as session:
        assert (await newest_close(session, net.store)).id == olena.id  # type: ignore[union-attr]


# --- one command, one close --------------------------------------------------------------------


async def test_a_close_resent_is_answered_with_itself_and_its_id_is_never_reused(maker):
    net = await network(maker)
    body = {
        "store_id": str(net.store),
        "command_id": str(uuid.uuid4()),
        "counted": "100.00",
        "counted_at": datetime.now(UTC).isoformat(),
        "after_close_id": None,
    }
    async with as_(maker, net, net.seller) as client:
        first = await client.post("/api/v1/cash/closes", json=body)
        # A resend later: its age is greater, and outside the print.
        again = await client.post("/api/v1/cash/closes?age=900", json=body)
        other = await client.post("/api/v1/cash/closes", json=body | {"counted": "101.00"})
    assert first.status_code == again.status_code == 201, again.text
    assert first.json() == again.json()
    assert other.status_code == 409, other.text
    assert other.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert "recorded" not in other.json().get("details", {})


async def test_a_close_resent_from_a_phone_whose_clock_went_back_is_answered_with_itself(maker):
    """The phone's clock was set back after the count, so its resend works
    out an age below nothing: taken as none, never refused before the replay
    is looked up, which would leave the attempt unsettled."""
    net = await network(maker)
    body = {
        "store_id": str(net.store),
        "command_id": str(uuid.uuid4()),
        "counted": "100.00",
        "counted_at": datetime.now(UTC).isoformat(),
        "after_close_id": None,
    }
    async with as_(maker, net, net.seller) as client:
        first = await client.post("/api/v1/cash/closes?age=0", json=body)
        again = await client.post("/api/v1/cash/closes?age=-3", json=body)
    assert first.status_code == again.status_code == 201, again.text
    assert again.json()["id"] == first.json()["id"]


# --- the store's state ---------------------------------------------------------------------------


async def test_an_archived_store_is_not_closed_and_comes_back_with_an_opening_count(maker):
    """G14, G30: the drawer of a store in the archive is not closed; the
    first close after it opens again only records what is there."""
    net = await network(maker)
    two_days_ago = datetime.now(UTC) - timedelta(days=2)
    await close(maker, net, "500.00", now=two_days_ago, by=net.child_seller, store=net.other)
    await set_state(maker, net, net.other, "ARCHIVED")
    error = await refused(close(maker, net, "0.00", now=None, by=net.owner, store=net.other))
    assert isinstance(error, StoreNotTradingError)
    assert error.details["state"] == "ARCHIVED"

    await set_state(maker, net, net.other, "ACTIVE")
    await sold(maker, net, "700.00", "CASH", store=net.other, seller=net.child_seller)
    again = await close(maker, net, "300.00", now=None, by=net.child_seller, store=net.other)
    assert (again.number, again.is_opening) == (2, True)
    assert (again.opening_float, again.expected, again.difference) == (None, None, None)


async def test_a_block_that_commits_after_the_request_began_refuses_the_sellers_close(maker):
    """Authorised on the store's row the close holds, never on the scope read
    at the request's start (B4 steps 1-3)."""
    net = await network(maker)
    async with maker() as session:
        stale_scope = await resolve_scope(session, net.seller)
    await set_state(maker, net, net.store, "BLOCKED")
    async with maker() as session:
        error = await refused(
            close_day(
                session,
                scope=stale_scope,
                store_id=net.store,
                command_id=uuid.uuid4(),
                counted=d("100.00"),
                counted_at=datetime.now(UTC),
                after_close_id=None,
            )
        )
    assert isinstance(error, StoreNotTradingError)
    assert error.details["state"] == "BLOCKED"
    async with maker() as session:
        assert await newest_close(session, net.store) is None


async def test_a_close_and_a_reason_recorded_before_the_store_stopped_trading_are_answered(maker):
    """Their answers were lost, and the store was blocked or archived
    meanwhile: each resend is answered with what it did, and settles; a new
    command is refused, saying nothing was recorded, so it settles too."""
    net = await network(maker)

    async def send(user: uuid.UUID, path: str, body: dict[str, Any]) -> httpx.Response:
        async with as_(maker, net, user) as client:
            return await client.post(path, json=body)

    def counted(store: uuid.UUID, amount: str, after: Any) -> dict[str, Any]:
        return {
            "store_id": str(store),
            "command_id": str(uuid.uuid4()),
            "counted": amount,
            "counted_at": datetime.now(UTC).isoformat(),
            "after_close_id": str(after) if after else None,
        }

    # A network manager closes a store that trades; it is blocked, which
    # only the network's owner closes.
    by_manager = counted(net.store, "100.00", None)
    first = await send(net.manager, "/api/v1/cash/closes", by_manager)
    assert first.status_code == 201, first.text
    await set_state(maker, net, net.store, "BLOCKED")
    again = await send(net.manager, "/api/v1/cash/closes", by_manager)
    assert again.status_code == 201, again.text
    assert again.json()["id"] == first.json()["id"]
    new = await send(net.manager, "/api/v1/cash/closes", counted(net.store, "100.00", None))
    assert new.status_code == 403, new.text
    assert new.json()["details"] == {
        "store_id": str(net.store),
        "state": "BLOCKED",
        "recorded": False,
    }

    # The owner closes the other store short, writes why, and it is archived.
    opening = await close(maker, net, "500.00", now=at(6, 20), by=net.owner, store=net.other)
    kept = {
        "now": at(7, 20),
        "by": net.owner,
        "store": net.other,
        "after": opening.id,
        "command_id": uuid.uuid4(),
    }
    short = await close(maker, net, "400.00", **kept)
    reason = {"command_id": str(uuid.uuid4()), "reason": "здача"}
    written = await send(net.owner, f"/api/v1/cash/closes/{short.id}/reason", reason)
    assert written.status_code == 200, written.text
    await set_state(maker, net, net.other, "ARCHIVED")
    assert (await close(maker, net, "400.00", **kept)).id == short.id
    resent = await send(net.owner, f"/api/v1/cash/closes/{short.id}/reason", reason)
    assert resent.status_code == 200, resent.text
    assert resent.json()["id"] == str(short.id)
    assert resent.json()["reason"] == "здача"
    for path, body in (
        (
            f"/api/v1/cash/closes/{short.id}/reason",
            {"command_id": str(uuid.uuid4()), "reason": "ні"},
        ),
        ("/api/v1/cash/closes", counted(net.other, "400.00", short.id)),
    ):
        refused_now = await send(net.owner, path, body)
        assert refused_now.status_code == 403, refused_now.text
        assert refused_now.json()["details"] == {
            "store_id": str(net.other),
            "state": "ARCHIVED",
            "recorded": False,
        }


# --- who sees what -----------------------------------------------------------------------------


async def test_a_seller_sees_only_her_own_close_and_only_its_result(maker):
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20), by=net.colleague)
    await sold(maker, net, "4250.00", "CASH")
    await sold(maker, net, "500.00", "CARD")
    await collected(maker, net, "300.00", "CARRIER_COD")
    mine = await close(maker, net, "6100.00", now=at(7, 20))

    own = await seen(maker, net, mine.id, net.seller)
    assert figures(own, "expected", "counted", "difference", "mine") == (
        "6250.00",
        "6100.00",
        "-150.00",
        True,
    )
    assert own["card"]["came_in"] == "500.00"
    assert all(own[key] is None for key in STARRED), own
    assert own["explanations"] == []

    async with as_(maker, net, net.colleague) as client:
        hers = await client.get(f"/api/v1/cash/closes/{mine.id}")
        history = await client.get(f"/api/v1/cash/closes?store_id={net.store}")
        everywhere = await client.get("/api/v1/cash/closes")
    assert hers.status_code == 403, hers.text
    assert history.status_code == 403 and everywhere.status_code == 403

    full = await seen(maker, net, mine.id, net.manager)
    assert full["mine"] is False
    assert figures(full, "opening_float", "cash_in", "carrier_cod") == (
        "2000.00",
        "4250.00",
        "300.00",
    )


async def test_the_history_lists_the_days_closes_for_whoever_reads_the_money(maker):
    net = await network(maker)
    first = await close(maker, net, "100.00", now=at(6, 20))
    second = await close(maker, net, "90.00", now=at(7, 20))
    other = await close(maker, net, "10.00", now=at(7, 20), by=net.child_seller, store=net.other)
    async with as_(maker, net, net.owner) as client:
        week = await client.get("/api/v1/cash/closes?date_from=2026-10-06&date_to=2026-10-12")
        one = await client.get(
            f"/api/v1/cash/closes?store_id={net.store}&date_from=2026-10-06&limit=1"
        )
        too_long = await client.get("/api/v1/cash/closes?date_from=2025-01-01&date_to=2026-10-12")
    assert week.status_code == 200, week.text
    assert [item["id"] for item in week.json()["items"]][-1] == str(first.id)
    assert {item["id"] for item in week.json()["items"]} == {
        str(first.id),
        str(second.id),
        str(other.id),
    }
    assert [item["id"] for item in one.json()["items"]] == [str(first.id)]
    assert one.json()["has_more"] is False
    assert too_long.status_code == 422 and too_long.json()["details"]["reason"] == "PERIOD"


# --- the blind count (B4.3, G32) ---------------------------------------------------------------


async def test_nothing_a_seller_reaches_before_her_count_says_what_the_drawer_holds(maker):
    """Exact keys, as a seller with default rights: the drawer carries no
    expected sum and no sum of the period; the store's sales list carries no
    way; a colleague's sale shows no way; their own open operations are time
    and goods only."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=datetime.now(UTC) - timedelta(days=1), by=net.colleague)
    async with api(maker, net.shops.scope(net.store)) as stocking:
        variant, size = await stock_a_coat(
            stocking, net.shops, store=net.store, warehouse=net.shops.shared_warehouse, qty=2
        )
    async with as_(maker, net, net.colleague) as client:
        body = sale_body(net.store, net.shops.shared_warehouse, variant, size)
        sale = await client.post(
            "/api/v1/sales", json=body | {"payment_method": "CARD"}, headers=key()
        )
    assert sale.status_code == 201, sale.text
    theirs = sale.json()["id"]
    await moved(maker, net, "EXPENSES", "50.00", by=net.colleague)
    async with as_(maker, net, net.seller) as client:
        drawer = await client.get(f"/api/v1/cash/drawer?store_id={net.store}")
        sales = await client.get(f"/api/v1/sales?store_id={net.store}")
        colleague_sale = await client.get(f"/api/v1/sales/{theirs}")
        mine = await client.get(f"/api/v1/cash/events?store_id={net.store}&mine=true")
        day = await client.get(f"/api/v1/cash/events?store_id={net.store}")
    assert drawer.status_code == 200, drawer.text
    body = drawer.json()
    assert set(body) == DRAWER_KEYS
    assert set(body["last_close"]) == {
        "id",
        "number",
        "business_day",
        "closed_at",
        "closed_by",
        "mine",
    }
    for word in (
        "expected",
        "opening_float",
        "cash_in",
        "counted",
        "card",
        "difference",
        "came_in",
    ):
        assert word not in drawer.text
    # Their colleague's expense is not theirs to see.
    assert body["movements"] == []
    assert body["movement_kinds"] == ["EXPENSES", "SUPPLIER_COURIER"]
    assert (body["may_close"], body["may_correct"], body["next_is_opening"]) == (
        True,
        False,
        False,
    )
    assert sales.status_code == 200, sales.text
    assert all("payment_method" not in sale for sale in sales.json()["sales"])
    assert colleague_sale.status_code == 200, colleague_sale.text
    assert colleague_sale.json()["payment_method"] is None
    assert mine.status_code == 200 and mine.json() == {"items": []}
    assert day.status_code == 403, day.text


async def test_a_sellers_own_open_operations_are_listed_by_time_and_goods_only(maker):
    net = await network(maker)
    await close(maker, net, "0.00", now=datetime.now(UTC) - timedelta(days=1))
    own = await sold(maker, net, "300.00", "CARD")
    await sold(maker, net, "500.00", "CASH", seller=net.colleague)
    async with as_(maker, net, net.seller) as client:
        mine = await client.get(f"/api/v1/cash/events?store_id={net.store}&mine=true")
    assert mine.status_code == 200, mine.text
    [item] = mine.json()["items"]
    assert set(item) == {"target", "target_id", "at", "label"}
    assert (item["target"], item["target_id"]) == ("SALE", str(own))


# --- the reason (B4.3, G12, G41) ------------------------------------------------------------------


async def give(
    maker,
    net: Net,
    close_id: uuid.UUID,
    reason: str,
    *,
    by: uuid.UUID,
    command_id: str | None = None,
) -> httpx.Response:
    async with as_(maker, net, by) as client:
        return await client.post(
            f"/api/v1/cash/closes/{close_id}/reason",
            json={"command_id": command_id or str(uuid.uuid4()), "reason": reason},
        )


async def owed(maker, net: Net, by: uuid.UUID) -> Any:
    async with as_(maker, net, by) as client:
        drawer = await client.get(f"/api/v1/cash/drawer?store_id={net.store}")
    assert drawer.status_code == 200, drawer.text
    return drawer.json()["reason_owed"]


async def test_only_whoever_counted_writes_the_reason_and_her_phone_owes_it_until_then(maker):
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    await sold(maker, net, "4250.00", "CASH")
    short = await close(maker, net, "6100.00", now=at(7, 20))
    assert (await owed(maker, net, net.seller))["id"] == str(short.id)
    assert await owed(maker, net, net.colleague) is None

    for someone in (net.colleague, net.owner):
        answer = await give(maker, net, short.id, "не знаю", by=someone)
        assert answer.status_code == 403, answer.text
    blank = await give(maker, net, short.id, "   ", by=net.seller)
    assert blank.status_code == 422, blank.text
    assert blank.json()["details"] == {"reason": "NO_REASON", "recorded": False}

    command = str(uuid.uuid4())
    given = await give(
        maker, net, short.id, "помилилась зі здачею", by=net.seller, command_id=command
    )
    assert given.status_code == 200, given.text
    assert figures(given.json(), "reason", "reason_by", "reason_required") == (
        "помилилась зі здачею",
        "Марина",
        True,
    )
    again = await give(
        maker, net, short.id, "помилилась зі здачею", by=net.seller, command_id=command
    )
    assert again.status_code == 200 and again.json() == given.json()
    second = await give(maker, net, short.id, "інша причина", by=net.seller)
    assert second.status_code == 422, second.text
    assert second.json()["details"] == {"reason": "REASON_GIVEN", "recorded": False}
    reused = await give(maker, net, short.id, "інша причина", by=net.seller, command_id=command)
    assert reused.status_code == 409, reused.text
    assert await owed(maker, net, net.seller) is None
    assert (await seen(maker, net, short.id, net.owner))["reason"] == "помилилась зі здачею"


@pytest.mark.parametrize(
    ("counted", "required"),
    [
        ("6249.01", False),  # 0,99 short
        ("6250.99", False),  # 0,99 over
        ("6250.00", False),
        ("6249.00", True),  # 1,00 short
        ("6251.00", True),  # 1,00 over
    ],
)
async def test_a_difference_under_one_hryvnia_needs_no_reason(maker, counted, required):
    """G41: recorded and shown, but no reason, nothing owed, and the reason
    command answers as for none."""
    net = await network(maker)
    await close(maker, net, "2000.00", now=at(6, 20))
    await sold(maker, net, "4250.00", "CASH")
    found = await close(maker, net, counted, now=at(7, 20))
    view = await seen(maker, net, found.id, net.seller)
    assert view["difference"] == str(d(counted) - d("6250.00"))
    assert view["reason_required"] is required
    assert ((await owed(maker, net, net.seller)) is not None) is required
    answer = await give(maker, net, found.id, "округлення", by=net.seller)
    if required:
        assert answer.status_code == 200, answer.text
    else:
        assert answer.status_code == 422, answer.text
        assert answer.json()["details"] == {"reason": "NO_DIFFERENCE", "recorded": False}


async def test_an_opening_count_takes_no_reason(maker):
    net = await network(maker)
    first = await close(maker, net, "2000.00", now=at(6, 20))
    answer = await give(maker, net, first.id, "перший раз", by=net.seller)
    assert answer.status_code == 422
    assert answer.json()["details"]["reason"] == "NO_DIFFERENCE"


async def test_the_owner_writes_the_reason_of_a_blocked_stores_close(maker):
    """Example H: the owner is the closer, so their own phone asks for the reason
    before anything else, though the store does not trade."""
    net = await network(maker)
    await close(maker, net, "100.00", now=at(6, 20))
    await sold(maker, net, "3100.00", "CASH")
    await set_state(maker, net, net.store, "BLOCKED")
    hers = await close(maker, net, "3000.00", now=at(7, 11), by=net.owner)
    assert hers.difference == d("-200.00")
    assert (await owed(maker, net, net.owner))["id"] == str(hers.id)
    answer = await give(maker, net, hers.id, "забрала на розмін", by=net.owner)
    assert answer.status_code == 200, answer.text
    assert answer.json()["reason"] == "забрала на розмін"


# --- the drawer's state ------------------------------------------------------------------------


async def drawer_of(maker, net: Net, by: uuid.UUID, store: uuid.UUID | None = None) -> Any:
    async with as_(maker, net, by) as client:
        answer = await client.get(f"/api/v1/cash/drawer?store_id={store or net.store}")
    assert answer.status_code == 200, answer.text
    return answer.json()


async def test_the_drawer_says_whether_the_next_count_opens_and_whether_today_is_closed(maker):
    net = await network(maker)
    fresh = await drawer_of(maker, net, net.seller)
    assert figures(fresh, "last_close", "next_is_opening", "closed_today", "unclosed_days") == (
        None,
        True,
        False,
        [],
    )
    three_days_ago = datetime.now(UTC) - timedelta(days=3)
    first = await close(maker, net, "100.00", now=three_days_ago, by=net.colleague)
    await sold(maker, net, "50.00", "CASH", when=datetime.now(UTC) - timedelta(days=2))
    before = await drawer_of(maker, net, net.seller)
    assert figures(before, "next_is_opening", "closed_today") == (False, False)
    assert figures(before["last_close"], "id", "number", "closed_by", "mine") == (
        str(first.id),
        1,
        "Олена",
        False,
    )
    two_days_ago = (datetime.now(UTC) - timedelta(days=2)).astimezone(KYIV) - timedelta(hours=6)
    assert before["unclosed_days"] == [two_days_ago.date().isoformat()]

    async with as_(maker, net, net.seller) as client:
        answer = await client.post(
            "/api/v1/cash/closes",
            json={
                "store_id": str(net.store),
                "command_id": str(uuid.uuid4()),
                "counted": "140.00",
                "counted_at": datetime.now(UTC).isoformat(),
                "after_close_id": str(first.id),
            },
        )
    assert answer.status_code == 201, answer.text
    mine = answer.json()
    # The answer to their count is their own view (G27).
    assert figures(mine, "expected", "counted", "difference", "mine", "reason_required") == (
        "150.00",
        "140.00",
        "-10.00",
        True,
        True,
    )
    assert all(mine[key] is None for key in STARRED)
    assert mine["unclosed_days"] == [two_days_ago.date().isoformat()]
    after = await drawer_of(maker, net, net.seller)
    assert figures(after, "closed_today", "unclosed_days") == (True, [])
    assert figures(after["last_close"], "id", "mine") == (mine["id"], True)
    assert after["reason_owed"]["id"] == mine["id"]


async def test_a_store_owner_or_a_stranger_does_not_read_another_stores_drawer(maker):
    net = await network(maker)
    async with as_(maker, net, net.child_seller) as client:
        answer = await client.get(f"/api/v1/cash/drawer?store_id={net.store}")
    assert answer.status_code == 403, answer.text
    stranger = await network(maker)
    async with as_(maker, stranger, stranger.owner) as client:
        answer = await client.get(f"/api/v1/cash/drawer?store_id={net.store}")
    assert answer.status_code == 403, answer.text


async def test_a_close_of_a_store_since_archived_owes_no_reason(maker):
    """The store went to the archive before the reason was written: the
    reason can no longer be taken, so nothing holds their phone for it."""
    net = await network(maker)
    two_days_ago = datetime.now(UTC) - timedelta(days=2)
    await close(maker, net, "100.00", now=two_days_ago, by=net.child_seller, store=net.other)
    short = await close(
        maker,
        net,
        "50.00",
        now=two_days_ago + timedelta(days=1),
        by=net.child_seller,
        store=net.other,
    )
    assert short.difference == d("-50.00")
    await set_state(maker, net, net.other, "ARCHIVED")
    async with as_(maker, net, net.child_seller) as client:
        refused_reason = await client.post(
            f"/api/v1/cash/closes/{short.id}/reason",
            json={"command_id": str(uuid.uuid4()), "reason": "не знаю"},
        )
        own = await client.get(f"/api/v1/cash/closes/{short.id}")
    assert refused_reason.status_code == 403, refused_reason.text
    assert refused_reason.json()["code"] == "STORE_NOT_TRADING"
    # Their own close still reads, whatever their store's state.
    assert own.status_code == 200, own.text
    async with maker() as session:
        scope = await resolve_scope(session, net.child_seller, reading=True)
        assert await reason_owed(session, scope) is None
