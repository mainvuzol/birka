"""The transfer command — goods move from one warehouse to another.

A transfer is the only way stock leaves one place for another. It writes a
`TRANSFER_OUT` at the source and a matching `TRANSFER_IN` at the destination,
in one transaction, and nothing else: no `sale` row, no money, no revenue
(invariant I16). `inventory.apply_movements` refuses half a pair, or a move
dressed up as anything else (invariant I24), so this module is the only
writer that can satisfy it.

**Single-step, by default and not by decision.** Sending and receiving happen
in the same transaction and the transfer is born `RECEIVED` (assumption A8).
Whether the receiving side should confirm arrival is open question Q5; the
`DRAFT`/`SENT` states and the `transfer:receive` capability exist so that
answering it later is a service change, not a migration. Until then
`transfer:receive` guards nothing.

**Two independent checks, as for every stock command.** `transfer:create`
asks whether this *person* may move goods on this store's authority. Access
rows ask whether the *store* may take goods out of the source (`can_sell`) and
put them into the destination (`can_receive`) — ADR-0004 §1.6. The store must
hold both. Whether an organization-wide manager may move goods between
warehouses none of their stores reaches is a roles question the owner has not
answered, so it is not assumed: such a transfer is refused.

**One call, both legs.** The two legs go to `apply_movements` together, so the
source and destination keys are locked in one globally sorted batch. Two
calls would lock the destination after the source — out of global order — and
two opposing transfers would deadlock (ADR-0004 §2.5).

**All or nothing.** A shortfall at the source refuses the whole transfer. Goods
are never partially moved, and never made up from another warehouse.

**The initiating store is recorded as the acting store** on both ledger rows.
The ledger allows a transfer to have none, for a move no single store is
responsible for; this one has a store, and the ledger says so. It also keeps
the rule every stock command already obeys — a store that is not trading does
not move goods — without inventing a new one for transfers.

**A closed warehouse can be neither source nor destination.** The design
proposed that an inactive location stay "transferable-out" (ADR-0004 §1.11,
marked PROPOSED) while the owner's own words are that closing a warehouse
"freezes it". The two disagree, and this module takes the one that refuses:
reopening a warehouse is always possible, an unwanted move out of a frozen one
is not undoable. Recorded as an open question.

Lock order, identical to the sale and refund commands: the router's
idempotency-row insert, then the advisory lock on the permanent command, then
the inventory keys in their sorted order.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import idempotency
from app.core.errors import IdempotencyConflictError, ValidationFailedError
from app.core.logging import get_logger
from app.modules.audit import service as audit
from app.modules.authz.permissions import Permission
from app.modules.authz.scope import RequestScope
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import (
    TRANSFER_REFERENCE,
    MovementRequest,
    apply_movements,
    transfer_movement_ids,
)
from app.modules.tenancy.service import LocationCapability, require_location_access
from app.modules.transfers.models import Transfer, TransferItem, TransferStatus

logger = get_logger(__name__)

MAX_LINES = 100
MAX_QUANTITY = 1000


@dataclass(frozen=True, slots=True)
class TransferLineInput:
    """How many of one product, in one size, move."""

    product_variant_id: uuid.UUID
    size_id: uuid.UUID
    quantity: int


@dataclass(frozen=True, slots=True)
class TransferResult:
    transfer: Transfer
    items: list[TransferItem]
    # Both legs of every line, in the order `transfer_movement_ids` reads them
    # back, so creation and durable replay answer identically.
    movements: list[uuid.UUID]


def _normalize(
    lines: list[TransferLineInput],
    *,
    from_location_id: uuid.UUID,
    to_location_id: uuid.UUID,
) -> list[TransferLineInput]:
    """Reject at the service boundary what the HTTP schema also rejects.

    The service is callable directly — by a future Telegram command handler,
    by a test — so it validates for itself.
    """
    if from_location_id == to_location_id:
        raise ValidationFailedError(
            "A transfer must move goods between two different locations",
            location_id=str(from_location_id),
        )
    if not lines:
        raise ValidationFailedError("A transfer must contain at least one line")
    if len(lines) > MAX_LINES:
        raise ValidationFailedError(f"A transfer may not contain more than {MAX_LINES} lines")

    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for line in lines:
        if type(line.quantity) is not int or not 0 < line.quantity <= MAX_QUANTITY:
            raise ValidationFailedError(f"Quantity must be an integer between 1 and {MAX_QUANTITY}")
        key = (line.product_variant_id, line.size_id)
        if key in seen:
            # Two lines for one product and size are two statements about the
            # same goods. Adding them up is the client's to do, visibly — the
            # server summing them would record a transfer nobody wrote down.
            raise ValidationFailedError(
                "A product and size may appear only once in a transfer",
                product_variant_id=str(line.product_variant_id),
                size_id=str(line.size_id),
            )
        seen.add(key)
    return lines


def _fingerprint(
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    from_location_id: uuid.UUID,
    to_location_id: uuid.UUID,
    lines: list[TransferLineInput],
) -> str:
    """Everything that makes this transfer *this* transfer.

    Both warehouses are in it on purpose. The 7-day idempotency cache picks
    every payload field up by itself; this permanent fingerprint is built by
    hand, and without them the same `command_id` retried towards a different
    warehouse would be judged a retry — and told "moved" about goods that
    never went there.
    """
    return idempotency.fingerprint(
        {
            "from_location_id": str(from_location_id),
            "to_location_id": str(to_location_id),
            "lines": [
                {
                    "product_variant_id": str(line.product_variant_id),
                    "size_id": str(line.size_id),
                    "quantity": line.quantity,
                }
                for line in lines
            ],
        },
        actor_user_id=scope.user_id,
        store_id=store_id,
    )


def _result(
    transfer: Transfer, items: list[TransferItem], movements: list[uuid.UUID]
) -> TransferResult:
    """Assemble a result in the one canonical order.

    Items are ordered by what they are rather than by how the request listed
    them: nothing persists the request's order, so honouring it would make the
    answer depend on whether it was built now or read back later.
    """
    return TransferResult(
        transfer=transfer,
        items=sorted(items, key=lambda item: (str(item.product_variant_id), str(item.size_id))),
        movements=movements,
    )


async def _read_transfer(session: AsyncSession, transfer: Transfer) -> TransferResult:
    """Rebuild a transfer result from committed rows, for a durable replay."""
    items = list(
        (
            await session.scalars(
                select(TransferItem).where(TransferItem.transfer_id == transfer.id)
            )
        ).all()
    )
    return _result(
        transfer,
        items,
        await transfer_movement_ids(
            session, organization_id=transfer.organization_id, transfer_id=transfer.id
        ),
    )


async def _existing_command(
    session: AsyncSession,
    *,
    scope: RequestScope,
    command_id: uuid.UUID,
    request_fingerprint: str,
) -> TransferResult | None:
    """Durable replay: has this permanent command already moved goods?

    Taken before any stock lock, and only ever serializes two requests carrying
    the same `command_id` — which are by definition the same business
    operation. A hash collision costs two unrelated commands a short wait; the
    identity decision below still uses the exact UUID pair.
    """
    lock_key = int.from_bytes(
        hashlib.sha256(scope.organization_id.bytes + command_id.bytes).digest()[:8],
        byteorder="big",
        signed=True,
    )
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    existing = await session.scalar(
        select(Transfer).where(
            Transfer.organization_id == scope.organization_id, Transfer.command_id == command_id
        )
    )
    if existing is None:
        return None
    if existing.command_fingerprint != request_fingerprint:
        # Same permanent command, different request. Never execute: one of the
        # two payloads is a client bug, and guessing which would move goods
        # nobody asked to move. A NULL fingerprint — a transfer made while
        # revision 0008 was rolled back — is the same refusal for a different
        # reason: there is nothing to compare against.
        details = {"command_id": str(command_id)}
        if existing.initiating_store_id in scope.store_ids and scope.can(
            Permission.TRANSFER_CREATE, existing.initiating_store_id
        ):
            details["transfer_id"] = str(existing.id)
        raise IdempotencyConflictError(
            "The original request for this existing transfer cannot be verified"
            if existing.command_fingerprint is None
            else "This command_id was already used with a different request",
            **details,
        )
    # The right to replay is the right to have issued the command: a client
    # that timed out must be able to learn the outcome of its own transfer.
    scope.require(Permission.TRANSFER_CREATE, existing.initiating_store_id)
    return await _read_transfer(session, existing)


async def create_transfer(
    session: AsyncSession,
    *,
    scope: RequestScope,
    store_id: uuid.UUID,
    command_id: uuid.UUID,
    from_location_id: uuid.UUID,
    to_location_id: uuid.UUID,
    lines: list[TransferLineInput],
    correlation_id: str | None = None,
) -> TransferResult:
    """Move goods between two warehouses, or raise and roll back.

    Everything below commits together or not at all: the transfer, its lines,
    both legs of every line in the ledger, and the audit entry.
    """
    lines = _normalize(lines, from_location_id=from_location_id, to_location_id=to_location_id)

    # Re-checked here even though the router already decided: this service is
    # the command boundary for any caller that is not an HTTP request.
    scope.require(Permission.TRANSFER_CREATE, store_id)
    # Invariant I23, twice over, and before the durable replay rather than
    # after it: a store whose access was revoked must not be handed a stored
    # success, whichever door it came in through.
    await require_location_access(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        location_ids={from_location_id},
        capability=LocationCapability.SELL,
    )
    await require_location_access(
        session,
        organization_id=scope.organization_id,
        store_id=store_id,
        location_ids={to_location_id},
        capability=LocationCapability.RECEIVE,
    )

    request_fingerprint = _fingerprint(
        scope=scope,
        store_id=store_id,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        lines=lines,
    )
    existing = await _existing_command(
        session, scope=scope, command_id=command_id, request_fingerprint=request_fingerprint
    )
    if existing is not None:
        return existing

    # One timestamp for both halves of a single-step transfer, taken from the
    # transaction so it agrees with every other row this command writes.
    moved_at = await session.scalar(select(func.now()))
    transfer = Transfer(
        organization_id=scope.organization_id,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        initiating_store_id=store_id,
        created_by_user_id=scope.user_id,
        command_id=command_id,
        command_fingerprint=request_fingerprint,
        status=TransferStatus.RECEIVED,
        sent_at=moved_at,
        received_at=moved_at,
        correlation_id=correlation_id,
    )
    session.add(transfer)
    await session.flush()

    items = [
        TransferItem(
            transfer_id=transfer.id,
            product_variant_id=line.product_variant_id,
            size_id=line.size_id,
            quantity=line.quantity,
        )
        for line in lines
    ]
    session.add_all(items)
    await session.flush()

    legs = [
        MovementRequest(
            location_id=location_id,
            acting_store_id=store_id,
            product_variant_id=line.product_variant_id,
            size_id=line.size_id,
            quantity_delta=delta,
            movement_type=movement_type,
            reference_type=TRANSFER_REFERENCE,
            reference_id=transfer.id,
        )
        for line in lines
        for location_id, delta, movement_type in (
            (from_location_id, -line.quantity, MovementType.TRANSFER_OUT),
            (to_location_id, line.quantity, MovementType.TRANSFER_IN),
        )
    ]
    # ONE call, both legs: see the module docstring. A shortfall at the source
    # raises here, before anything is committed, and nothing moves at all.
    applied = await apply_movements(
        session,
        organization_id=scope.organization_id,
        requests=legs,
        actor_user_id=scope.user_id,
        correlation_id=correlation_id,
    )
    quantity_after = {
        (a.request.location_id, a.request.product_variant_id, a.request.size_id): a.quantity_after
        for a in applied
    }

    def balances(line: TransferLineInput, *, moved: int) -> dict[str, object]:
        # Each (location, variant, size) key carries exactly one leg, because
        # a product and size appear once per transfer, so this is exact.
        return {
            "product_variant_id": str(line.product_variant_id),
            "size_id": str(line.size_id),
            "from_quantity": quantity_after[
                (from_location_id, line.product_variant_id, line.size_id)
            ]
            + moved,
            "to_quantity": quantity_after[(to_location_id, line.product_variant_id, line.size_id)]
            - moved,
        }

    await audit.record(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        action="inventory.transferred",
        entity_type="transfer",
        entity_id=transfer.id,
        # "Quantity was 3, is now 2" is not a complete statement once the same
        # coat exists in two warehouses, so every figure names its place
        # (ADR-0004 design §1.7).
        before={
            "from_location_id": str(from_location_id),
            "to_location_id": str(to_location_id),
            "lines": [balances(line, moved=line.quantity) for line in lines],
        },
        after={
            "transfer_id": str(transfer.id),
            "store_id": str(store_id),
            "status": transfer.status.value,
            "from_location_id": str(from_location_id),
            "to_location_id": str(to_location_id),
            "lines": [{**balances(line, moved=0), "quantity": line.quantity} for line in lines],
        },
    )

    logger.info(
        "transfer.created",
        transfer_id=str(transfer.id),
        store_id=str(store_id),
        from_location_id=str(from_location_id),
        to_location_id=str(to_location_id),
        lines=len(items),
        units=sum(line.quantity for line in lines),
    )

    return _result(
        transfer,
        items,
        await transfer_movement_ids(
            session, organization_id=scope.organization_id, transfer_id=transfer.id
        ),
    )


__all__ = ["TransferLineInput", "TransferResult", "create_transfer"]
