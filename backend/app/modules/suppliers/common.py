"""What the returns and the invoices both say about a supplier, and how
both check what a person typed. Kept apart from either, so the invoices,
which move no goods, never reach the ledger through the returns."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from app.core.errors import ValidationFailedError
from app.core.text import is_storable
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.suppliers.models import Supplier

MAX_TEXT = 1000


@dataclass(frozen=True, slots=True)
class SupplierView:
    id: uuid.UUID
    name: str
    phone: str | None


@dataclass(frozen=True, slots=True)
class Cancellation:
    reason: str
    by: str
    at: datetime


def supplier_view(supplier: Supplier) -> SupplierView:
    return SupplierView(id=supplier.id, name=supplier.name, phone=supplier.phone)


def clean_text(value: str | None, *, limit: int, reason: str, required: bool) -> str | None:
    clean = " ".join((value or "").split()) if reason == "NAME" else (value or "").strip()
    if not clean:
        if required:
            raise ValidationFailedError("Say it, please", reason=reason)
        return None
    if len(clean) > limit or not is_storable(clean):
        raise ValidationFailedError(f"At most {limit} characters", reason=reason)
    return clean


def require_keeper(scope: RequestScope, store_id: uuid.UUID) -> None:
    """Whoever returns goods here, or records what the store owes its
    suppliers: both pick a supplier from the list, or add one, and both see
    what was borrowed."""
    if scope.can(Permission.SUPPLIER_DEBT, store_id):
        scope.require_store(store_id)
        return
    scope.require(Permission.SUPPLIER_RETURN, store_id)


def clean_reason(reason: str) -> str:
    why = clean_text(reason, limit=MAX_TEXT, reason="NO_REASON", required=True)
    assert why is not None
    return why


def clean_note(note: str | None) -> str | None:
    return clean_text(note, limit=MAX_TEXT, reason="NOTE", required=False)


__all__ = [
    "MAX_TEXT",
    "Cancellation",
    "SupplierView",
    "clean_note",
    "clean_reason",
    "clean_text",
    "require_keeper",
    "supplier_view",
]
