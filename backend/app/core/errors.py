"""Domain errors and their HTTP mapping.

Rules from `.ai/conventions.md`:
  - services raise domain exceptions, they never build HTTP responses;
  - the API boundary maps them to a stable, machine-readable error code.

Error codes are part of the client contract. Renaming one is a breaking change.
"""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Base class for every business failure that the API reports to a client."""

    code: str = "INTERNAL_ERROR"
    http_status: int = 500
    message: str = "Unexpected error"

    def __init__(self, message: str | None = None, **details: Any) -> None:
        self.message = message or self.message
        self.details: dict[str, Any] = details
        super().__init__(self.message)

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            payload["details"] = self.details
        return payload


# --- authentication / authorization ----------------------------------------


class AuthenticationFailedError(DomainError):
    code = "AUTHENTICATION_FAILED"
    http_status = 401
    message = "Authentication failed"


class InvalidInitDataError(AuthenticationFailedError):
    code = "INVALID_INIT_DATA"
    message = "Telegram init data could not be verified"


class SessionExpiredError(AuthenticationFailedError):
    code = "SESSION_EXPIRED"
    message = "Session has expired"


class NoAccessError(AuthenticationFailedError):
    """A Telegram account no store has let in, or has let go.

    Its own code so the app can tell the person what to do: pass their
    Telegram number to the owner, who has them added on the server (owner
    decision, 2026-10-01).
    """

    code = "NO_ACCESS"
    message = "This Telegram account has no access to any store"


class PermissionDeniedError(DomainError):
    code = "PERMISSION_DENIED"
    http_status = 403
    message = "You do not have permission to perform this action"


class ForbiddenStoreError(DomainError):
    code = "FORBIDDEN_STORE"
    http_status = 403
    message = "You do not have access to this store"


class StoreNotTradingError(DomainError):
    """The store is blocked or archived, and nothing is done in it.

    Its own code so the app can say which, and since when (owner decisions,
    2026-10-01): the owner and the network's managers still read it, and
    nobody changes it until the owner lets it trade again.
    """

    code = "STORE_NOT_TRADING"
    http_status = 403
    message = "This store is not trading"


class LocationAccessDeniedError(DomainError):
    """The person may act; their store may not act *here*.

    Distinct from `FORBIDDEN_STORE` and `PERMISSION_DENIED` on purpose: those
    say the caller is not who they need to be, this says the goods are not
    somewhere this store can reach (ADR-0004, invariant I23).
    """

    code = "LOCATION_ACCESS_DENIED"
    http_status = 403
    message = "This store has no access to that stock location"


# --- validation -------------------------------------------------------------


class ValidationFailedError(DomainError):
    code = "VALIDATION_ERROR"
    http_status = 422
    message = "Request failed validation"


class NotFoundError(DomainError):
    code = "NOT_FOUND"
    http_status = 404
    message = "Resource not found"


# --- inventory / sales (contract reserved in M1A, raised from M1B onward) ---


class InsufficientStockError(DomainError):
    code = "INSUFFICIENT_STOCK"
    http_status = 409
    message = "Not enough stock for this operation"


class StockChangedError(DomainError):
    """A count was made against a balance that has since moved.

    A stocktake states a count, and the client turns it into a change against
    the balance it showed. If a sale, a receipt or another correction moved
    that balance in between, the same change would record a shortage or a
    surplus nobody observed — so the correction is refused and nothing is
    written. `details` carry `expected` and `actual`; count again.
    """

    code = "STOCK_CHANGED"
    http_status = 409
    message = "The balance changed after it was counted; count again"


class CorrectionExceedsShortfallError(DomainError):
    code = "CORRECTION_EXCEEDS_SHORTFALL"
    http_status = 422
    message = "A found-in-store correction may only cover the exact shortfall"


class RefundExceedsSoldError(DomainError):
    code = "REFUND_EXCEEDS_SOLD"
    http_status = 409
    message = "Refund exceeds the quantity originally sold"


class DamagedReturnsUnavailableError(DomainError):
    """A unit came back damaged, and the store has nowhere to put it.

    The owner decided on 2026-10-01 that a damaged unit goes to the store's
    own «Брак», where nothing sells. `details.reason` says why it cannot:
    `NOT_SET_UP` — the store has no «Брак» yet; `SOLD_FROM` — some store sells
    from the warehouse marked as it, so damaged goods would be back on sale.
    Nothing is written; set the warehouse up, then take the return.
    """

    code = "DAMAGED_RETURNS_UNAVAILABLE"
    http_status = 409
    message = "The store has no «Брак» warehouse to take damaged goods"


class DamagedStockClosedError(DomainError):
    """Stock in a store's «Брак» changes only one way.

    The owner decided on 2026-10-01 that what is in «Брак» changes only
    through a return taken damaged and through the «Брак» section — its
    inspection, its return to sale and its write-off — never through a
    delivery, a transfer, a stock correction or a stock list. That is what
    keeps the list of damaged units equal to the stock that is there.
    """

    code = "DAMAGED_STOCK_CLOSED"
    http_status = 409
    message = "Stock in «Брак» changes only through returns and the «Брак» section"


class DamagedUnitChangedError(DomainError):
    """The damaged unit is no longer where the person saw it.

    `details` carry `expected` and `actual` status: someone else took it for
    inspection, or decided its fate, in between. Nothing is written; look at
    the unit again.
    """

    code = "DAMAGED_UNIT_CHANGED"
    http_status = 409
    message = "The damaged unit changed since it was shown; look at it again"


class CatalogAmbiguousError(DomainError):
    code = "CATALOG_AMBIGUOUS"
    http_status = 409
    message = "Catalog interpretation is ambiguous and needs review"


class PriceChangedError(DomainError):
    """The suggested price is no longer the one the person saw.

    `details.current` is the price that stands now, or null if there is none.
    Someone else changed it in between; nothing is written.
    """

    code = "PRICE_CHANGED"
    http_status = 409
    message = "The suggested price changed since it was shown; look at it again"


# --- legacy snapshot import (M1-023, ADR-0005) --------------------------------


class SnapshotConflictError(DomainError):
    """The list is not in a state where this can happen.

    `details.reason` says which: `ROWS_NEED_REVIEW`, `NOTHING_TO_APPLY`,
    `REVISION_CHANGED` or `ALREADY_DECIDED`. One code with a reason rather than
    four codes, because a client does the same thing for all of them — show
    the list again.
    """

    code = "SNAPSHOT_CONFLICT"
    http_status = 409
    message = "This stock list cannot do that in its current state"


class OpeningBalanceConflictError(DomainError):
    """An opening balance opens a warehouse's ledger — once (ADR-0005 §5).

    Distinct from `SNAPSHOT_CONFLICT` because nothing about the list can fix
    it: the warehouse itself already records stock, and correcting that to a
    count is a stocktake, not an opening balance.
    """

    code = "OPENING_BALANCE_CONFLICT"
    http_status = 409
    message = "This warehouse already has stock history; an opening balance cannot be added to it"


class OpeningListPendingError(DomainError):
    """A warehouse waits for its opening list (owner decision, 2026-10-02).

    A list was typed for it, and nothing has been recorded there yet: its
    first movement would close it to that list for good (ADR-0005 §5). So
    nothing moves there until the list is approved or rejected.
    `details.location_ids` names the warehouses that wait.
    """

    code = "OPENING_LIST_PENDING"
    http_status = 409
    message = "An opening list waits for this warehouse; approve or reject it first"


class UnknownSizeStockError(DomainError):
    """«Фізично є» would count a coat twice (M1-023, ADR-0005).

    Either the same model is held at this warehouse with its size not known —
    a legacy list loaded it that way — and adding a sized unit would leave the
    size-unknown balance counting the same coat a second time; say instead
    that it is one of those coats (`size_clarified` on the sale), or sell it
    as size not known. Or the correction would add a unit with its size not
    known (`details.reason = FOUND_AS_SIZE_NOT_KNOWN`), which only a list may
    state; sell it by its size.
    """

    code = "UNKNOWN_SIZE_STOCK"
    http_status = 409
    message = (
        "This product is held here with its size not known; clarify its size, "
        "or sell it as size not known"
    )


# --- idempotency / command identity ----------------------------------------


class IdempotencyConflictError(DomainError):
    code = "IDEMPOTENCY_CONFLICT"
    http_status = 409
    message = "This idempotency key was already used with a different request"


class IdempotencyInProgressError(DomainError):
    code = "IDEMPOTENCY_IN_PROGRESS"
    http_status = 409
    message = "An identical request is currently being processed"


__all__ = [
    "AuthenticationFailedError",
    "CatalogAmbiguousError",
    "CorrectionExceedsShortfallError",
    "DamagedReturnsUnavailableError",
    "DamagedStockClosedError",
    "DamagedUnitChangedError",
    "DomainError",
    "ForbiddenStoreError",
    "IdempotencyConflictError",
    "IdempotencyInProgressError",
    "InsufficientStockError",
    "InvalidInitDataError",
    "LocationAccessDeniedError",
    "NoAccessError",
    "NotFoundError",
    "OpeningBalanceConflictError",
    "PermissionDeniedError",
    "PriceChangedError",
    "RefundExceedsSoldError",
    "SessionExpiredError",
    "SnapshotConflictError",
    "StoreNotTradingError",
    "UnknownSizeStockError",
    "ValidationFailedError",
]
