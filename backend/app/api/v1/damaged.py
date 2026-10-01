"""The «Брак» section (owner decisions, 2026-10-01).

Every unit a return put in the store's «Брак», and the four steps anyone who
takes returns may do with it: take it for inspection, put it back on sale in
the warehouse it was sold from, confirm it damaged, write it off. The owner
and managers may also return a confirmed unit to its supplier, and cancel
that return.

Each step answers with the unit as it now is. A step repeated after it
succeeded answers the same way, so a client that lost the answer only has to
ask again; a step that finds the unit somewhere else is refused with
`DAMAGED_UNIT_CHANGED`, and nothing is written.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ScopeDep, SessionDep
from app.core.correlation import get_correlation_id
from app.core.text import CleanText
from app.modules.damaged import service as damaged
from app.modules.damaged.models import DamagedUnit
from app.modules.identity.service import display_names
from app.modules.tenancy.service import back_on_sale_locations, location_names

router = APIRouter(prefix="/damaged-units", tags=["damaged"])


class DamagedUnitResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    size: str | None
    status: str
    # When the return put it in «Брак».
    returned_at: datetime
    # Who last changed its status, and when; while INSPECTING, who is looking.
    status_by: str | None
    status_at: datetime | None
    # Where it goes if it goes back on sale: the warehouse it was sold from.
    sold_from_location_id: uuid.UUID
    sold_from_location_name: str
    # False for a unit handed back at a store that does not reach that
    # warehouse: it then goes to one of this store's that the person chooses.
    back_to_sold_from: bool = True
    note: str | None


class DamagedListResponse(BaseModel):
    units: list[DamagedUnitResponse]


class ReturnToSaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The warehouse the person was shown and confirmed. It must still be the
    # one the unit was sold from — or, where the store does not reach that
    # one, one of the store's own they chose.
    destination_location_id: uuid.UUID


class NoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: CleanText | None = Field(default=None, max_length=1000)


async def _shaped(
    session: SessionDep, organization_id: uuid.UUID, units: list[DamagedUnit]
) -> list[DamagedUnitResponse]:
    names = await display_names(
        session, {unit.status_by_user_id for unit in units if unit.status_by_user_id}
    )
    places = await location_names(
        session,
        organization_id=organization_id,
        location_ids={unit.sold_from_location_id for unit in units},
    )
    reached = {
        store_id: await back_on_sale_locations(
            session, organization_id=organization_id, store_id=store_id
        )
        for store_id in {unit.store_id for unit in units}
    }
    return [
        DamagedUnitResponse(
            id=unit.id,
            display_name=unit.display_name,
            size=unit.size_label,
            status=unit.status,
            returned_at=unit.created_at,
            status_by=names.get(unit.status_by_user_id) if unit.status_by_user_id else None,
            status_at=unit.status_at,
            sold_from_location_id=unit.sold_from_location_id,
            sold_from_location_name=places.get(unit.sold_from_location_id, ""),
            back_to_sold_from=unit.sold_from_location_id in reached[unit.store_id],
            note=unit.note,
        )
        for unit in units
    ]


async def _answer(
    session: SessionDep, organization_id: uuid.UUID, unit: DamagedUnit
) -> DamagedUnitResponse:
    await session.commit()
    return (await _shaped(session, organization_id, [unit]))[0]


@router.get("", response_model=DamagedListResponse)
async def list_units(
    scope: ScopeDep, session: SessionDep, store_id: Annotated[uuid.UUID, Query()]
) -> DamagedListResponse:
    units = await damaged.units_in_bin(session, scope=scope, store_id=store_id)
    return DamagedListResponse(units=await _shaped(session, scope.organization_id, units))


@router.post("/{unit_id}/take", response_model=DamagedUnitResponse)
async def take(unit_id: uuid.UUID, scope: ScopeDep, session: SessionDep) -> DamagedUnitResponse:
    unit = await damaged.take(session, scope=scope, unit_id=unit_id)
    return await _answer(session, scope.organization_id, unit)


@router.post("/{unit_id}/return-to-sale", response_model=DamagedUnitResponse)
async def return_to_sale(
    unit_id: uuid.UUID, payload: ReturnToSaleRequest, scope: ScopeDep, session: SessionDep
) -> DamagedUnitResponse:
    unit = await damaged.return_to_sale(
        session,
        scope=scope,
        unit_id=unit_id,
        destination_location_id=payload.destination_location_id,
        correlation_id=get_correlation_id(),
    )
    return await _answer(session, scope.organization_id, unit)


@router.post("/{unit_id}/confirm", response_model=DamagedUnitResponse)
async def confirm(
    unit_id: uuid.UUID, payload: NoteRequest, scope: ScopeDep, session: SessionDep
) -> DamagedUnitResponse:
    unit = await damaged.confirm(session, scope=scope, unit_id=unit_id, note=payload.note)
    return await _answer(session, scope.organization_id, unit)


@router.post("/{unit_id}/write-off", response_model=DamagedUnitResponse)
async def write_off(
    unit_id: uuid.UUID, payload: NoteRequest, scope: ScopeDep, session: SessionDep
) -> DamagedUnitResponse:
    unit = await damaged.write_off(
        session,
        scope=scope,
        unit_id=unit_id,
        note=payload.note,
        correlation_id=get_correlation_id(),
    )
    return await _answer(session, scope.organization_id, unit)


class ToSupplierRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supplier_id: uuid.UUID
    note: CleanText | None = Field(default=None, max_length=1000)


class CancelToSupplierRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The return being cancelled: a unit may go back, come back and go again.
    supplier_return_id: uuid.UUID
    reason: CleanText = Field(min_length=1, max_length=1000)


@router.post("/{unit_id}/return-to-supplier", response_model=DamagedUnitResponse)
async def return_to_supplier(
    unit_id: uuid.UUID, payload: ToSupplierRequest, scope: ScopeDep, session: SessionDep
) -> DamagedUnitResponse:
    """A confirmed unit back to its supplier instead of written off (owner
    decision, 2026-10-01). The owner's and managers' (`supplier:return`)."""
    unit = await damaged.return_to_supplier(
        session,
        scope=scope,
        unit_id=unit_id,
        supplier_id=payload.supplier_id,
        note=payload.note,
        correlation_id=get_correlation_id(),
    )
    return await _answer(session, scope.organization_id, unit)


@router.post("/{unit_id}/cancel-supplier-return", response_model=DamagedUnitResponse)
async def cancel_supplier_return(
    unit_id: uuid.UUID, payload: CancelToSupplierRequest, scope: ScopeDep, session: SessionDep
) -> DamagedUnitResponse:
    """That return cancelled, saying why: the unit is confirmed damaged in
    «Брак» again."""
    unit = await damaged.cancel_supplier_return(
        session,
        scope=scope,
        unit_id=unit_id,
        supplier_return_id=payload.supplier_return_id,
        reason=payload.reason,
        correlation_id=get_correlation_id(),
    )
    return await _answer(session, scope.organization_id, unit)
