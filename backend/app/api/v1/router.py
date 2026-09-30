"""API v1 routes.

Authentication and the store directory land in gate M1A; the catalog,
inventory and sale endpoints that make up the first vertical slice land in
gate M1B; the refund that makes a mistake recoverable opens gate M1C, the
transfer that moves goods between warehouses follows it, and the legacy stock
list that opens a warehouse's ledger closes it (M1-023).

Routers parse the request, call one service and shape the response. They hold
no business rules of their own (`.ai/conventions.md`). The one thing they do
decide is authorization, and only because of where it has to happen: a command
must be refused before it claims an idempotency key or replays a stored
answer, or a seller whose grant was revoked would keep receiving the success
they were once entitled to. See `authz/scope.py` and invariant I13.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.api.v1.backups import router as backups_router
from app.api.v1.catalog import router as catalog_router
from app.api.v1.catalog_decisions import router as catalog_decisions_router
from app.api.v1.catalog_matching import router as catalog_matching_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.locations import router as locations_router
from app.api.v1.orders import router as orders_router
from app.api.v1.refunds import router as refunds_router
from app.api.v1.sales import router as sales_router
from app.api.v1.snapshots import router as snapshots_router
from app.api.v1.transfers import router as transfers_router
from app.modules.identity.service import authenticate_with_init_data
from app.modules.tenancy.models import Store

router = APIRouter()
router.include_router(catalog_router)
router.include_router(catalog_matching_router)
router.include_router(catalog_decisions_router)
router.include_router(inventory_router)
router.include_router(locations_router)
router.include_router(orders_router)
router.include_router(sales_router)
router.include_router(refunds_router)
router.include_router(transfers_router)
router.include_router(snapshots_router)
router.include_router(backups_router)


# --- schemas ---------------------------------------------------------------


class TelegramAuthRequest(BaseModel):
    init_data: str = Field(
        ...,
        min_length=1,
        max_length=8192,
        description="Raw Telegram WebApp initData string, verified server-side.",
    )


class TelegramAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105  — a scheme name, not a secret
    expires_in: int
    user_id: uuid.UUID
    organization_id: uuid.UUID


class StoreAccessResponse(BaseModel):
    id: uuid.UUID
    name: str
    code: str
    permissions: list[str]


class MeResponse(BaseModel):
    user_id: uuid.UUID
    display_name: str
    organization_id: uuid.UUID
    organization_permissions: list[str]
    stores: list[StoreAccessResponse]


class HealthResponse(BaseModel):
    status: str
    environment: str


# --- routes ----------------------------------------------------------------


@router.get("/health", response_model=HealthResponse, tags=["ops"])
async def health(settings: SettingsDep) -> HealthResponse:
    """Liveness probe. Deliberately does not touch the database."""
    return HealthResponse(status="ok", environment=settings.app_env)


@router.post("/auth/telegram", response_model=TelegramAuthResponse, tags=["auth"])
async def auth_telegram(
    payload: TelegramAuthRequest, session: SessionDep, settings: SettingsDep
) -> TelegramAuthResponse:
    token, user, scope = await authenticate_with_init_data(
        session, init_data=payload.init_data, settings=settings
    )
    return TelegramAuthResponse(
        access_token=token,
        expires_in=settings.session_ttl_seconds,
        user_id=user.id,
        organization_id=scope.organization_id,
    )


@router.get("/me", response_model=MeResponse, tags=["auth"])
async def me(scope: ScopeDep, session: SessionDep) -> MeResponse:
    from app.modules.identity.models import AppUser

    user = (await session.execute(select(AppUser).where(AppUser.id == scope.user_id))).scalar_one()

    stores = (
        (
            await session.execute(
                select(Store).where(Store.id.in_(scope.store_ids)).order_by(Store.code)
            )
        )
        .scalars()
        .all()
    )

    return MeResponse(
        user_id=scope.user_id,
        display_name=user.display_name,
        organization_id=scope.organization_id,
        organization_permissions=sorted(p.value for p in scope.org_permissions),
        stores=[
            StoreAccessResponse(
                id=store.id,
                name=store.name,
                code=store.code,
                permissions=sorted(p.value for p in scope.permissions_for(store.id)),
            )
            for store in stores
        ],
    )


__all__ = ["router"]
