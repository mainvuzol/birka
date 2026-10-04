"""The API with the store hold as it was before the fix (FOR NO KEY UPDATE), for an A/B reading."""
import uuid

from sqlalchemy import select

import app.modules.tenancy.service as tenancy
from app.core.errors import NotFoundError
from app.modules.tenancy.models import Store, StoreState


async def old_hold_stores(session, *, organization_id: uuid.UUID, store_ids: set[uuid.UUID]):
    if not store_ids:
        return {}
    rows = (
        await session.execute(
            select(Store.id, Store.state)
            .where(Store.id.in_(store_ids), Store.organization_id == organization_id)
            .order_by(Store.id)
            .with_for_update(key_share=True)
        )
    ).all()
    if {row.id for row in rows} != store_ids:
        raise NotFoundError("Unknown store")
    return {row.id: StoreState(row.state) for row in rows}


tenancy.hold_stores = old_hold_stores

from app.main import app  # noqa: E402
