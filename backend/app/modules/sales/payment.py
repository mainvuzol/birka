"""How a customer paid. Owner decisions, 2026-10-04; ADR-0012.

The owner decided (business-rules.md, "cash and card, the day's close"):

- three ways of paying, one list for every store: cash, card on the
  terminal, and a transfer to the shop's card or account;
- one way for each payment: a sale is never split between cash and card, and
  each payment toward a debt has its own way;
- an order says at «Клієнт забрав» how it was paid: in advance by transfer,
  cash on delivery through the carrier, or at the counter — and at the
  counter by cash, card or transfer (answered the same day);
- only cash paid at the counter is the drawer's.

So the till, a payment toward a debt and the money handed back on a return
take one of `TILL_METHODS`; «Клієнт забрав» takes one of `ORDER_METHODS`; and
the drawer counts `DRAWER_METHOD` alone. The order-only ways never pass
through the till.

It lives in `sales` because every money module already imports `sales`, so
no new module and no new boundary is needed for it (ADR-0012, C16). Pure
Python: the database keeps the same five values as a CHECK on each column
(revision 0035), and a row written before that revision has none at all —
it reads «не вказано», and nothing guesses it.
"""

from __future__ import annotations

from enum import StrEnum

from app.core.errors import ValidationFailedError


class PaymentMethod(StrEnum):
    CASH = "CASH"  # «Готівка»
    CARD = "CARD"  # «Картка» — the terminal
    TRANSFER = "TRANSFER"  # «Переказ» — to the shop's card or account
    PREPAID_TRANSFER = "PREPAID_TRANSFER"  # «Переказ наперед» — orders only
    CARRIER_COD = "CARRIER_COD"  # «Накладений платіж» — orders only


# The till, a payment toward a debt, and money handed back on a return.
TILL_METHODS: frozenset[PaymentMethod] = frozenset(
    {PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER}
)
# Never through the till: paid before the parcel left, or to the carrier.
OFF_TILL_METHODS: frozenset[PaymentMethod] = frozenset(
    {PaymentMethod.PREPAID_TRANSFER, PaymentMethod.CARRIER_COD}
)
# «Клієнт забрав»: the two above, or at the counter now.
ORDER_METHODS: frozenset[PaymentMethod] = TILL_METHODS | OFF_TILL_METHODS
# The only way the drawer counts.
DRAWER_METHOD = PaymentMethod.CASH


def stated_way(
    method: PaymentMethod | None, *, takes: frozenset[PaymentMethod], required: bool = True
) -> PaymentMethod | None:
    """The way a new money command says it was paid, checked after the
    command's replay lookup (ADR-0012, B2, B13).

    Optional in every request: an attempt a phone kept from before the way was
    asked must still reach the replay lookup and be answered with what it did,
    so a request schema that required it would leave that attempt stuck for
    good with its sale recorded. A **new** command states one, and one this
    command takes. Both refusals are decided after the lookup proved nothing
    was recorded under the command, so they say `recorded: false`
    (ADR-0008 §9): a phone that did not know whether its attempt went through
    may settle it.

    `required=False` is for the services' own unit tests only; the replay of
    old commands is proved against rows forged from the old prints (D2).
    """
    if method is None:
        if required:
            raise ValidationFailedError(
                "Say how the customer pays", reason="PAYMENT_METHOD_REQUIRED", recorded=False
            )
        return None
    if method not in takes:
        raise ValidationFailedError(
            "This operation is not paid this way",
            reason="METHOD_NOT_FOR_THIS",
            recorded=False,
            payment_method=str(method),
        )
    return PaymentMethod(method)


def print_of(method: PaymentMethod | None) -> dict[str, str]:
    """What a command's prints carry of its way: nothing when none is stated,
    so every command recorded before the way was asked keeps the print it was
    stored with and still replays (ADR-0012, B13)."""
    return {"payment_method": str(method)} if method is not None else {}


__all__ = [
    "DRAWER_METHOD",
    "OFF_TILL_METHODS",
    "ORDER_METHODS",
    "TILL_METHODS",
    "PaymentMethod",
    "print_of",
    "stated_way",
]
