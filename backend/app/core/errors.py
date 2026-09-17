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


class PermissionDeniedError(DomainError):
    code = "PERMISSION_DENIED"
    http_status = 403
    message = "You do not have permission to perform this action"


class ForbiddenStoreError(DomainError):
    code = "FORBIDDEN_STORE"
    http_status = 403
    message = "You do not have access to this store"


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


class CorrectionExceedsShortfallError(DomainError):
    code = "CORRECTION_EXCEEDS_SHORTFALL"
    http_status = 422
    message = "A found-in-store correction may only cover the exact shortfall"


class RefundExceedsSoldError(DomainError):
    code = "REFUND_EXCEEDS_SOLD"
    http_status = 409
    message = "Refund exceeds the quantity originally sold"


class CatalogAmbiguousError(DomainError):
    code = "CATALOG_AMBIGUOUS"
    http_status = 409
    message = "Catalog interpretation is ambiguous and needs review"


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
    "DomainError",
    "ForbiddenStoreError",
    "IdempotencyConflictError",
    "IdempotencyInProgressError",
    "InsufficientStockError",
    "InvalidInitDataError",
    "LocationAccessDeniedError",
    "NotFoundError",
    "PermissionDeniedError",
    "RefundExceedsSoldError",
    "SessionExpiredError",
    "ValidationFailedError",
]
