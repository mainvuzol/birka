"""Seed a unique synthetic shop in an explicitly named isolated E2E database."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models_registry  # noqa: F401  - every table on the metadata, like migrations/env.py
from app.modules.authz.models import Membership, Role, RolePermission
from app.modules.authz.permissions import DEFAULT_ROLE_PERMISSIONS, Permission, RoleCode
from app.modules.authz.scope import RequestScope
from app.modules.backups.models import AlertKind, AlertStatus, BackupAlert, BackupRun
from app.modules.cash.models import CashClose
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    CanonicalConcept,
    ProductFamily,
    ProductVariant,
    Size,
    SizeSystem,
    SizeSystemCode,
)
from app.modules.identity.models import AppUser
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementRequest, apply_movements
from app.modules.snapshots.models import SnapshotQuantityBasis
from app.modules.snapshots.service import (
    AllocationInput,
    approve_snapshot,
    import_snapshot,
    resolve_row,
)
from app.modules.suppliers.models import Supplier, SupplierInvoice
from app.modules.tenancy.models import (
    Organization,
    StockLocation,
    Store,
    StoreKind,
    StoreLocationAccess,
    StoreState,
)


async def main() -> None:
    url = os.environ["BIRKA_TEST_DATABASE_URL"]
    # Refuse accidental use of a developer's normal database.
    if not url.startswith("postgresql+asyncpg://birka_review@127.0.0.1:55442/") or not url.endswith(
        "/birka_orders_ui"
    ):
        raise RuntimeError("This fixture only accepts the isolated birka_orders_ui database")
    engine = create_async_engine(url)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker.begin() as session:
        org = Organization(name=f"e2e-{uuid.uuid4().hex}", currency_code="UAH")
        session.add(org)
        await session.flush()
        store = Store(organization_id=org.id, name="Основний", code="MAIN", kind=StoreKind.PRIMARY)
        location = StockLocation(organization_id=org.id, name="Основний склад", code="E2E")
        # A second warehouse for the till's own flows. The order specs reserve
        # stock on the first one, and a reservation makes a shortfall
        # uncorrectable by design — so a sale test sharing that shelf could
        # never reach «фізично є».
        till = StockLocation(organization_id=org.id, name="Каса-склад", code="E2E-TILL")
        # A third for stock corrections, which change balances the till and
        # receiving specs would otherwise have to guess at.
        counted = StockLocation(organization_id=org.id, name="Склад перерахунку", code="E2E-COUNT")
        # A fourth opened from a legacy list, the one way stock is ever held
        # with its size not known (ADR-0005 §3): what a seller gives a size to
        # at the counter.
        legacy = StockLocation(organization_id=org.id, name="Старі залишки", code="E2E-LEGACY")
        # A fifth for returns, whose goods come back into it and would move
        # the balances the other specs count; and the store's «Брак», where a
        # damaged return goes and nothing sells (owner decision, 2026-10-01).
        returns = StockLocation(organization_id=org.id, name="Склад повернень", code="E2E-RETURNS")
        damaged = StockLocation(organization_id=org.id, name="Брак", code="E2E-BIN")
        # A sixth that nothing has ever moved in: the one warehouse a stock
        # list may still be approved into (ADR-0005 §5), once per seed.
        opening = StockLocation(organization_id=org.id, name="Новий склад", code="E2E-OPENING")
        # A seventh, empty too: a list typed for it holds it, and nothing
        # moves there until the list is decided (owner decision, 2026-10-02).
        waiting = StockLocation(organization_id=org.id, name="Склад, що чекає", code="E2E-WAITING")
        # Empty ones for lists filled from a parser's file (ADR-0014), one per
        # journey, so each list waits at a warehouse of its own: one approved
        # from files, one where a file is removed and added again, one for the
        # files refused before they are sent, and one where an answer is slow.
        file_opening = StockLocation(
            organization_id=org.id, name="Склад для файлу", code="E2E-FILE"
        )
        file_removal = StockLocation(
            organization_id=org.id, name="Склад, де прибирають файл", code="E2E-FILE-REMOVE"
        )
        file_checks = StockLocation(
            organization_id=org.id, name="Склад для перевірки файлів", code="E2E-FILE-CHECKS"
        )
        file_slow = StockLocation(
            organization_id=org.id, name="Склад повільних відповідей", code="E2E-FILE-SLOW"
        )
        # One where a record may be a size with its count or a range of
        # sizes («42-44»), and the person is asked (owner decision, 2026-10-09).
        file_range = StockLocation(
            organization_id=org.id, name="Склад для діапазону", code="E2E-FILE-RANGE"
        )
        # And one both stores may import into: its list belongs to both
        # (owner decision, 2026-10-08).
        shared_opening = StockLocation(
            organization_id=org.id, name="Спільний новий склад", code="E2E-SHARED-OPENING"
        )
        # A second store of the network, with its own warehouse, that also
        # sells from the returns warehouse: where goods come from that are
        # taken back at the first (owner decisions, 2026-10-01).
        second = Store(
            organization_id=org.id, name="Другий", code="SECOND", kind=StoreKind.SECONDARY
        )
        second_own = StockLocation(
            organization_id=org.id, name="Склад другого магазину", code="E2E-SECOND"
        )
        concept = CanonicalConcept(organization_id=org.id, name="Лоран", normalized_name="лоран")
        system = SizeSystem(organization_id=org.id, code=SizeSystemCode.ALPHA, name="Alpha")
        user = AppUser(telegram_user_id=uuid.uuid4().int % 2**52, display_name="Оля")
        colour = AttributeTerm(
            organization_id=org.id,
            kind=AttributeKind.COLOR,
            name="шоколад",
            normalized_name="шоколад",
        )
        session.add_all(
            [
                store,
                location,
                till,
                counted,
                legacy,
                returns,
                damaged,
                opening,
                waiting,
                file_opening,
                file_removal,
                file_checks,
                file_slow,
                file_range,
                shared_opening,
                second,
                second_own,
                concept,
                system,
                user,
                colour,
            ]
        )
        await session.flush()
        size = Size(size_system_id=system.id, code="M")
        # Held nowhere: what a stocktake finds on a shelf the system says is empty.
        unheld = Size(size_system_id=system.id, code="L")
        family = ProductFamily(organization_id=org.id, canonical_concept_id=concept.id)
        session.add_all([size, unheld, family])
        await session.flush()
        variant = ProductVariant(
            product_family_id=family.id, color_term_id=colour.id, length_cm=Decimal("70")
        )
        session.add(variant)
        for reachable in (
            location,
            till,
            counted,
            legacy,
            returns,
            opening,
            waiting,
            file_opening,
            file_removal,
            file_checks,
            file_slow,
            file_range,
            shared_opening,
        ):
            session.add(
                StoreLocationAccess(
                    organization_id=org.id,
                    store_id=store.id,
                    location_id=reachable.id,
                    can_sell=True,
                    can_receive=True,
                )
            )
        session.add(
            StoreLocationAccess(
                organization_id=org.id,
                store_id=store.id,
                location_id=damaged.id,
                can_sell=False,
                can_receive=True,
                damaged_returns=True,
            )
        )
        for reachable in (second_own, returns, shared_opening):
            session.add(
                StoreLocationAccess(
                    organization_id=org.id,
                    store_id=second.id,
                    location_id=reachable.id,
                    can_sell=True,
                    can_receive=True,
                )
            )
        await session.flush()
        await apply_movements(
            session,
            organization_id=org.id,
            actor_user_id=user.id,
            requests=[
                MovementRequest(
                    location_id=stocked.id,
                    acting_store_id=store.id,
                    product_variant_id=variant.id,
                    size_id=size.id,
                    quantity_delta=30 if stocked is not counted else 10,
                    movement_type=MovementType.DELIVERY,
                )
                for stocked in (location, till, counted)
            ],
        )
        role = Role(organization_id=org.id, code="E2E", name="Тестовий продавець")
        session.add(role)
        await session.flush()
        session.add_all(
            [RolePermission(role_id=role.id, permission_code=p.value) for p in Permission]
        )
        # «Оля» works in both stores, as she did when there was one: the
        # shared price is set by whoever holds `catalog:set_price` in every
        # store. What a return taken at one store reaches is that store's.
        session.add_all(
            [
                Membership(
                    user_id=user.id,
                    organization_id=org.id,
                    store_id=shop.id,
                    role_id=role.id,
                )
                for shop in (store, second)
            ]
        )
        owner = await seed_backups(session, organization_id=org.id, role_id=role.id)
        network = await seed_network(session)
        data = network | {
            "telegram_user_id": str(user.telegram_user_id),
            "owner_telegram_user_id": str(owner.telegram_user_id),
            "store_id": str(store.id),
            "location_id": str(location.id),
            "till_location_id": str(till.id),
            "count_location_id": str(counted.id),
            "legacy_location_id": str(legacy.id),
            "returns_location_id": str(returns.id),
            "bin_location_id": str(damaged.id),
            "opening_location_id": str(opening.id),
            "waiting_location_id": str(waiting.id),
            "file_location_id": str(file_opening.id),
            "file_removal_location_id": str(file_removal.id),
            "file_checks_location_id": str(file_checks.id),
            "file_slow_location_id": str(file_slow.id),
            "file_range_location_id": str(file_range.id),
            "shared_opening_location_id": str(shared_opening.id),
            "second_store_id": str(second.id),
            "second_location_id": str(second_own.id),
            "variant_id": str(variant.id),
            "size_id": str(size.id),
        }
    await open_from_a_legacy_list(
        maker,
        scope=RequestScope(
            user_id=user.id,
            organization_id=org.id,
            store_permissions={store.id: frozenset(Permission)},
        ),
        store_id=store.id,
        location_id=legacy.id,
        variant_id=variant.id,
        size_id=size.id,
    )
    await engine.dispose()
    Path(os.environ["BIRKA_E2E_FIXTURE"]).write_text(json.dumps(data))


async def seed_network(session: AsyncSession) -> dict[str, str]:
    """A second network, for the store states (owner decisions, 2026-10-01):
    blocking a store of the first would stop every journey that sells there.

    «Центр» and «Ринок» share a warehouse, and «Ринок» manages one of its
    own and has its «Брак»; «Старий» stopped trading and is archived, still
    owing a supplier for an invoice. Its owner holds the E2E role
    network-wide; «Ганна» works in «Центр» only, «Петро» in «Ринок» only;
    «Марко» manages «Центр» with a manager's default rights, and «Ліда» sells
    there with a seller's. The drawers' own stores, «Каса» and «Зупинений»,
    are `seed_drawer`'s; «Північний» and «Південний», sharing an empty
    warehouse, are `seed_sharing_pair`'s."""
    org = Organization(name=f"e2e-states-{uuid.uuid4().hex}", currency_code="UAH")
    session.add(org)
    await session.flush()
    centre = Store(organization_id=org.id, name="Центр", code="CENTRE", kind=StoreKind.PRIMARY)
    market = Store(organization_id=org.id, name="Ринок", code="MARKET", kind=StoreKind.SECONDARY)
    old = Store(
        organization_id=org.id,
        name="Старий",
        code="OLD",
        kind=StoreKind.SECONDARY,
        state=StoreState.ARCHIVED.value,
        state_since=datetime.now(UTC) - timedelta(days=30),
    )
    shared = StockLocation(organization_id=org.id, name="Склад мережі", code="NET-SHARED")
    session.add_all([centre, market, old, shared])
    await session.flush()
    market_own = StockLocation(
        organization_id=org.id,
        name="Склад ринку",
        code="NET-MARKET",
        managing_store_id=market.id,
    )
    market_bin = StockLocation(organization_id=org.id, name="Брак ринку", code="NET-MARKET-BIN")
    session.add_all([market_own, market_bin])
    await session.flush()
    session.add(
        StoreLocationAccess(
            organization_id=org.id,
            store_id=market.id,
            location_id=market_bin.id,
            can_sell=False,
            can_receive=True,
            damaged_returns=True,
        )
    )
    for shop, place in ((centre, shared), (market, shared), (market, market_own)):
        session.add(
            StoreLocationAccess(
                organization_id=org.id,
                store_id=shop.id,
                location_id=place.id,
                can_sell=True,
                can_receive=True,
            )
        )
    role = Role(organization_id=org.id, code="E2E", name="Тестовий продавець")
    session.add(role)
    await session.flush()
    session.add_all([RolePermission(role_id=role.id, permission_code=p.value) for p in Permission])
    manager = Role(organization_id=org.id, code="E2E-MANAGER", name="Тестовий менеджер")
    session.add(manager)
    await session.flush()
    cashier = Role(organization_id=org.id, code="E2E-SELLER", name="Тестова продавчиня")
    session.add(cashier)
    await session.flush()
    session.add_all(
        [
            RolePermission(role_id=manager.id, permission_code=p.value)
            for p in DEFAULT_ROLE_PERMISSIONS[RoleCode.MANAGER]
        ]
        + [
            RolePermission(role_id=cashier.id, permission_code=p.value)
            for p in DEFAULT_ROLE_PERMISSIONS[RoleCode.SELLER]
        ]
    )
    people: dict[str, str] = {}
    staff: tuple[tuple[str, str, Store | None, Role], ...] = (
        ("network_owner", "Власник мережі", None, role),
        ("network_centre_seller", "Ганна", centre, role),
        ("network_market_seller", "Петро", market, role),
        ("network_centre_manager", "Марко", centre, manager),
        ("network_centre_cashier", "Ліда", centre, cashier),
    )
    staff_ids: dict[str, uuid.UUID] = {}
    for key, name, works_in, held in staff:
        person = AppUser(telegram_user_id=uuid.uuid4().int % 2**52, display_name=name)
        session.add(person)
        await session.flush()
        session.add(
            Membership(
                user_id=person.id,
                organization_id=org.id,
                store_id=works_in.id if works_in is not None else None,
                role_id=held.id,
            )
        )
        people[f"{key}_telegram_user_id"] = str(person.telegram_user_id)
        staff_ids[key] = person.id
    drawer = await seed_drawer(
        session,
        organization_id=org.id,
        cashier=cashier,
        manager_id=staff_ids["network_centre_manager"],
        manager_role=manager,
    )
    sharing = await seed_sharing_pair(session, organization_id=org.id, manager_role=manager)
    # What the archived store still owes: any store of the network that trades
    # pays it (owner decision, 2026-10-01).
    owed_to = Supplier(
        organization_id=org.id,
        name="Постачальник Старого",
        normalized_name="постачальник старого",
        created_by_user_id=staff_ids["network_owner"],
    )
    session.add(owed_to)
    await session.flush()
    session.add(
        SupplierInvoice(
            organization_id=org.id,
            store_id=old.id,
            supplier_id=owed_to.id,
            amount=Decimal("5000.00"),
            currency_code="UAH",
            note="накладна до закриття",
            created_by_user_id=staff_ids["network_owner"],
            command_id=uuid.uuid4(),
            command_fingerprint="0" * 64,
        )
    )
    return (
        people
        | drawer
        | sharing
        | {
            "network_centre_store_id": str(centre.id),
            "network_market_store_id": str(market.id),
            "network_old_store_id": str(old.id),
            "network_shared_location_id": str(shared.id),
            "network_market_location_id": str(market_own.id),
        }
    )


async def seed_drawer(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    cashier: Role,
    manager_id: uuid.UUID,
    manager_role: Role,
) -> dict[str, str]:
    """The drawers the «Каса» journeys count (owner decisions, 2026-10-04;
    ADR-0012, D3).

    «Каса» is a store of its own, so that no other journey's sales move the
    figures its close is checked against. «Оля» sells there with a seller's
    default rights, and its drawer was first counted yesterday evening: close
    #1, an opening count of 1000,00 грн, written here directly, as the
    database's checks allow. A close in the run then has an expected sum and
    an exact difference. Its warehouse starts empty; the journeys receive
    their own coats.

    «Зупинений» is blocked, and nothing was ever counted there: only the
    network's owner may still count and close its day. «Марко» manages it
    with a manager's default rights, which give nothing in a store that does
    not trade.
    """
    till = Store(
        organization_id=organization_id,
        name="Каса",
        code="CASH",
        kind=StoreKind.SECONDARY,
        timezone="Europe/Kyiv",
    )
    paused = Store(
        organization_id=organization_id,
        name="Зупинений",
        code="PAUSED",
        kind=StoreKind.SECONDARY,
        state=StoreState.BLOCKED.value,
        state_since=datetime.now(UTC) - timedelta(days=1),
    )
    session.add_all([till, paused])
    await session.flush()
    shelf = StockLocation(organization_id=organization_id, name="Склад каси", code="NET-CASH")
    seller = AppUser(telegram_user_id=uuid.uuid4().int % 2**52, display_name="Оля")
    session.add_all([shelf, seller])
    await session.flush()
    session.add_all(
        [
            StoreLocationAccess(
                organization_id=organization_id,
                store_id=till.id,
                location_id=shelf.id,
                can_sell=True,
                can_receive=True,
            ),
            Membership(
                user_id=seller.id,
                organization_id=organization_id,
                store_id=till.id,
                role_id=cashier.id,
            ),
            Membership(
                user_id=manager_id,
                organization_id=organization_id,
                store_id=paused.id,
                role_id=manager_role.id,
            ),
        ]
    )
    # Yesterday's business day in the store's time zone, which runs from
    # 06:00 to 06:00 (G8), counted at 20:00.
    kyiv = ZoneInfo("Europe/Kyiv")
    yesterday = (datetime.now(kyiv) - timedelta(hours=6)).date() - timedelta(days=1)
    first = CashClose(
        organization_id=organization_id,
        store_id=till.id,
        number=1,
        is_opening=True,
        business_day=yesterday,
        closed_at=datetime.combine(yesterday, time(20, 0), tzinfo=kyiv),
        since=None,
        actor_user_id=seller.id,
        command_id=uuid.uuid4(),
        command_fingerprint="0" * 64,
        opening_float=None,
        counted=Decimal("1000.00"),
        cash_in=Decimal("0.00"),
        cash_out=Decimal("0.00"),
        taken_out=Decimal("0.00"),
        put_in=Decimal("0.00"),
        cash_corrected=Decimal("0.00"),
        expected=None,
        difference=None,
        others={},
    )
    session.add(first)
    await session.flush()
    return {
        "network_cash_store_id": str(till.id),
        "network_cash_location_id": str(shelf.id),
        "network_cash_seller_telegram_user_id": str(seller.telegram_user_id),
        "network_cash_first_close_id": str(first.id),
        "network_paused_store_id": str(paused.id),
    }


async def seed_sharing_pair(
    session: AsyncSession, *, organization_id: uuid.UUID, manager_role: Role
) -> dict[str, str]:
    """Two stores of their own that share one empty warehouse, for a shared
    list whose own store stops trading (owner decision, 2026-10-09): the
    journey blocks «Північний» after it starts a list there, and «Ніна»,
    who manages «Південний» with a manager's default rights, rejects it.
    Stores of their own, so that blocking one stops nothing another journey
    sells in; nothing sells from their warehouse."""
    north = Store(
        organization_id=organization_id, name="Північний", code="NORTH", kind=StoreKind.SECONDARY
    )
    south = Store(
        organization_id=organization_id, name="Південний", code="SOUTH", kind=StoreKind.SECONDARY
    )
    between = StockLocation(
        organization_id=organization_id, name="Склад півночі й півдня", code="NET-NORTH-SOUTH"
    )
    manager = AppUser(telegram_user_id=uuid.uuid4().int % 2**52, display_name="Ніна")
    session.add_all([north, south, between, manager])
    await session.flush()
    session.add_all(
        [
            StoreLocationAccess(
                organization_id=organization_id,
                store_id=shop.id,
                location_id=between.id,
                can_sell=False,
                can_receive=True,
            )
            for shop in (north, south)
        ]
        + [
            Membership(
                user_id=manager.id,
                organization_id=organization_id,
                store_id=south.id,
                role_id=manager_role.id,
            )
        ]
    )
    await session.flush()
    return {
        "network_north_store_id": str(north.id),
        "network_south_store_id": str(south.id),
        "network_north_south_location_id": str(between.id),
        "network_south_manager_telegram_user_id": str(manager.telegram_user_id),
    }


async def seed_backups(
    session: AsyncSession, *, organization_id: uuid.UUID, role_id: uuid.UUID
) -> AppUser:
    """The owner, and what their «Резервні копії» section shows: two good
    nights, then last night's drill failing on the ledger, and Telegram
    refusing to deliver the warning because the owner never started the bot.

    The owner holds the E2E role organization-wide; «Оля» holds it for one
    store, which is not enough to see the server's backups."""
    owner = AppUser(telegram_user_id=uuid.uuid4().int % 2**52, display_name="Власниця")
    session.add(owner)
    await session.flush()
    session.add(Membership(user_id=owner.id, organization_id=organization_id, role_id=role_id))
    now = datetime.now(UTC)
    for days, problems in [
        (3, []),
        (2, []),
        (1, [{"step": "drill", "checks": ["ledger"], "detail": "ledger: 1 balance"}]),
    ]:
        finished = now - timedelta(days=days) + timedelta(hours=12)
        session.add(
            BackupRun(
                started_at=finished - timedelta(minutes=3),
                finished_at=finished,
                ok=not problems,
                archive=f"birka-{finished:%Y%m%dT%H%M%SZ}.dump.age",
                archive_bytes=2_500_000,
                drill_ok=not problems,
                restore_seconds=0.42,
                problems=problems,
            )
        )
    session.add(
        BackupAlert(
            key=f"e2e:{uuid.uuid4()}",
            kind=AlertKind.FAILED.value,
            user_id=owner.id,
            text="⚠️ Нічна резервна копія не вдалася.",
            status=AlertStatus.REFUSED.value,
            attempts=1,
            last_error="Forbidden: bot can't initiate conversation with a user",
        )
    )
    await session.flush()
    return owner


async def open_from_a_legacy_list(
    maker: async_sessionmaker[AsyncSession],
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    location_id: uuid.UUID,
    variant_id: uuid.UUID,
    size_id: uuid.UUID,
) -> None:
    """Three coats with their size not known, then one M delivered after them.

    Through the list's own commands — import, resolve, approve — rather than a
    ledger row written by hand, so the stock traces back to a list line as it
    would in a shop.
    """
    async with maker.begin() as session:
        view, _ = await import_snapshot(
            session,
            scope=scope,
            command_id=uuid.uuid4(),
            store_id=store_id,
            location_id=location_id,
            lines=["Лоран шоколад 3 шт"],
        )
    snapshot_id = uuid.UUID(str(view["snapshot_id"]))
    async with maker.begin() as session:
        await resolve_row(
            session,
            scope=scope,
            snapshot_id=snapshot_id,
            line_no=1,
            allocations=[
                AllocationInput(product_variant_id=variant_id, quantity=3, size_unknown=True)
            ],
            quantity_basis=SnapshotQuantityBasis.STATED,
        )
    async with maker.begin() as session:
        await approve_snapshot(session, scope=scope, snapshot_id=snapshot_id, expected_revision=1)
    async with maker.begin() as session:
        await apply_movements(
            session,
            organization_id=scope.organization_id,
            actor_user_id=scope.user_id,
            requests=[
                MovementRequest(
                    location_id=location_id,
                    acting_store_id=store_id,
                    product_variant_id=variant_id,
                    size_id=size_id,
                    quantity_delta=1,
                    movement_type=MovementType.DELIVERY,
                )
            ],
        )


if __name__ == "__main__":
    asyncio.run(main())
