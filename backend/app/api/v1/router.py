"""API v1 routes available in gate M1A.

Routers parse the request, call one service and shape the response. They hold
no business rules and make no authorization decisions of their own
(`.ai/conventions.md`).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import ScopeDep, SessionDep, SettingsDep
from app.api.v1.inventory import router as inventory_router
from app.api.v1.sales import router as sales_router
from app.modules.identity.service import authenticate_with_init_data
from app.modules.tenancy.models import Store

router = APIRouter()
router.include_router(inventory_router)
router.include_router(sales_router)


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
