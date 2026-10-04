"""Domain errors and their HTTP mapping.

Rules from `.ai/conventions.md`:
  - services raise domain exceptions, they never build HTTP responses;
  - the API boundary maps them to a stable, machine-readable error code.

Error codes are part of the client contract. Renaming one is a breaking change.
"""

from __future__ import annotations

from typing import Any, Literal

# Why launch data was refused, as a fixed word the log and the API's status
# (`GET /internal/status`) carry instead of anything from the payload. The
# watcher reads them to say what is wrong when nobody can sign in: launch data
# expired or dated in the future points at the server's clock, a signature
# that does not match at the bot token.
InitDataRefusal = Literal["expired", "future", "signature", "malformed"]


class DomainError(Exception):
    """Base class for every business failure that the API reports to a client."""

    code: str = "INTERNAL_ERROR"
    http_status: int = 500
    message: str = "Unexpected error"
    # Headers the response carries, e.g. `Retry-After`. Most errors carry none.
    headers: dict[str, str] | None = None

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
    """Launch data that is not a currently valid, correctly signed payload.

    `reason` says which check refused it (`InitDataRefusal`). It is for the
    server's log and status only, not the client: the answer stays the same
    for every reason.

    Who sent it, for the server's count of refused sign-ins
    (`identity/sign_ins.py`) and nothing else; neither is logged or sent:

    - `sender`: the Telegram user id a payload that passed its signature
      names (refused as `expired` or `future`). Telegram signed it, so it is
      that person's launch.
    - `claimed_sender`: the id a payload whose signature failed claims
      (`signature`). Anyone can write it: it is trusted for nothing but
      asking whether it names one of the shop's people.
    """

    code = "INVALID_INIT_DATA"
    message = "Telegram init data could not be verified"

    def __init__(
        self,
        message: str | None = None,
        *,
        reason: InitDataRefusal,
        sender: int | None = None,
        claimed_sender: int | None = None,
    ) -> None:
        super().__init__(message)
        self.reason: InitDataRefusal = reason
        self.sender = sender
        self.claimed_sender = claimed_sender


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


class RateLimitedError(DomainError):
    """Too many sign-ins from one address (`app/core/rate_limit.py`).

    A technical limit, not an owner rule: it is set so that a whole shop
    behind one address never meets it. `details.retry_after` and the
    `Retry-After` header say in how many seconds the next sign-in is taken.
    """

    code = "RATE_LIMITED"
    http_status = 429
    message = "Too many sign-in attempts from this address; wait and try again"

    def __init__(self, retry_after: int, message: str | None = None) -> None:
        super().__init__(message, retry_after=retry_after)
        self.headers = {"Retry-After": str(retry_after)}


class PayloadTooLargeError(DomainError):
    """A body larger than the endpoint takes, refused before it is read
    whole (`POST /client-errors`)."""

    code = "PAYLOAD_TOO_LARGE"
    http_status = 413
    message = "The request body is too large"


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


class CatalogSimilarError(DomainError):
    """A typed word looks like one the catalogue already uses (owner decision,
    2026-10-03): Latin letters in place of Cyrillic, case, spaces.

    Refused once. `details.similar` lists each such word with the spelling in
    use and a few models that use it, so the person can take one; sending the
    same request with `similar_confirmed` creates it as typed.
    """

    code = "CATALOG_SIMILAR"
    http_status = 409
    message = "A similar name is already in the catalogue; take it, or confirm this is another"


class SameAsError(DomainError):
    """The corrected name is another model's (ADR-0008 §2).

    `details.same_as` names the model it leads to, so the app can offer to
    merge the two. Nothing is changed.
    """

    code = "SAME_AS"
    http_status = 409
    message = "Another model already has this name; merge them instead"


class ModelMergedError(DomainError):
    """The model was merged into another (ADR-0008 §5).

    `details.merged_into` names the model that stays. Raised after the
    command's `command_id` was looked up under its lock, so it proves this
    command recorded nothing: `details.recorded` is false, and a client may
    treat it as final even after an attempt whose outcome it did not know.
    """

    code = "MODEL_MERGED"
    http_status = 409
    message = "This model was merged into another; use the model that stays"

    def __init__(self, message: str | None = None, **details: Any) -> None:
        super().__init__(message, **details, recorded=False)


class ModelRetiredError(DomainError):
    """The model is retired: its stock still sells, but nothing new is taken
    in (owner decision, 2026-10-03). `details.product_variant_id` names it.
    Final in the same way as `ModelMergedError`."""

    code = "MODEL_RETIRED"
    http_status = 409
    message = "This model is retired; bring it back before taking new goods in"

    def __init__(self, message: str | None = None, **details: Any) -> None:
        super().__init__(message, **details, recorded=False)


class MergeBlockedError(DomainError):
    """Something of the duplicate is still open, or out of reach (ADR-0008 §3).

    `details.reasons` lists each, with what to finish first. Nothing is
    changed.
    """

    code = "MERGE_BLOCKED"
    http_status = 409
    message = "The models cannot be merged yet; finish what is listed first"


class PriceChangedError(DomainError):
    """The suggested price is no longer the one the person saw.

    `details.current` is the price that stands now, or null if there is none.
    Someone else changed it in between; nothing is written.
    """

    code = "PRICE_CHANGED"
    http_status = 409
    message = "The suggested price changed since it was shown; look at it again"


class PaymentMethodChangedError(DomainError):
    """The way a sale, a payment or a refund was paid is no longer the one
    the person saw (ADR-0012, B6.1).

    `details.current` is the way that stands now, or null for «не вказано»:
    someone corrected it in between. Raised after the correction's
    `command_id` was looked up under its lock, so it proves this command
    recorded nothing: `details.recorded` is false, as with `ModelMergedError`,
    and a phone may treat it as final even after an attempt whose outcome it
    did not know.
    """

    code = "PAYMENT_METHOD_CHANGED"
    http_status = 409
    message = "The way of paying changed since it was shown; look at it again"

    def __init__(self, message: str | None = None, **details: Any) -> None:
        super().__init__(message, **details, recorded=False)


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
    "CatalogSimilarError",
    "CorrectionExceedsShortfallError",
    "DamagedReturnsUnavailableError",
    "DamagedStockClosedError",
    "DamagedUnitChangedError",
    "DomainError",
    "ForbiddenStoreError",
    "IdempotencyConflictError",
    "IdempotencyInProgressError",
    "InitDataRefusal",
    "InsufficientStockError",
    "InvalidInitDataError",
    "LocationAccessDeniedError",
    "MergeBlockedError",
    "ModelMergedError",
    "ModelRetiredError",
    "NoAccessError",
    "NotFoundError",
    "OpeningBalanceConflictError",
    "PayloadTooLargeError",
    "PaymentMethodChangedError",
    "PermissionDeniedError",
    "PriceChangedError",
    "RateLimitedError",
    "RefundExceedsSoldError",
    "SameAsError",
    "SessionExpiredError",
    "SnapshotConflictError",
    "StoreNotTradingError",
    "UnknownSizeStockError",
    "ValidationFailedError",
]
