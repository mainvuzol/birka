"""The pure parts of the legacy snapshot import (M1-023, ADR-0005).

What a line says about its own quantity, the import's retry proof, and the
request shapes that keep a person's answer unambiguous. The database-backed
workflow is in `tests/integration/test_snapshot_import.py`.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.api.v1.snapshots import AllocationPayload, ImportRequest, ResolutionRequest
from app.core.errors import ValidationFailedError
from app.modules.catalog.parser import parse_catalog_line
from app.modules.snapshots.models import SnapshotQuantityBasis, SnapshotQuantityState
from app.modules.snapshots.service import (
    check_basis,
    mentions_no_count,
    request_fingerprint,
    source_quantity,
)

KNOWN = SnapshotQuantityState.KNOWN
UNKNOWN_DISTRIBUTION = SnapshotQuantityState.UNKNOWN_DISTRIBUTION
UNKNOWN_QUANTITY = SnapshotQuantityState.UNKNOWN_QUANTITY
STATED = SnapshotQuantityBasis.STATED
LINE_IMPLIES_ONE = SnapshotQuantityBasis.LINE_IMPLIES_ONE
RECOUNTED = SnapshotQuantityBasis.RECOUNTED
OWNER_KNOWLEDGE = SnapshotQuantityBasis.OWNER_KNOWLEDGE


@pytest.mark.parametrize(
    ("text", "state", "total"),
    [
        ("Бомбер шоколад 3 шт", KNOWN, 3),
        ("3 шт", KNOWN, 3),
        # Invariant I15: the total is stated, the split across colours is not.
        ("Лама бежевая/персик/butter 3 шт", UNKNOWN_DISTRIBUTION, 3),
        ("Лама бежевая/персик", UNKNOWN_DISTRIBUTION, None),
        # A bare number is a possible item code, never a quantity (owner, 2026-09-14).
        ("Куртка 1636", UNKNOWN_QUANTITY, None),
        # "3 куртки" is left conservative by the parser, so here too.
        ("3 куртки", UNKNOWN_QUANTITY, None),
        # Two different quantities on one line: neither is trusted.
        ("Куртка 2 шт 3 шт", UNKNOWN_QUANTITY, None),
        ("Бомбер шоколад М", UNKNOWN_QUANTITY, None),
        ("Куртки", UNKNOWN_QUANTITY, None),
        # Several sizes or colours named without a slash: the split is just as
        # unknown (the code review's first finding).
        ("Лоран шоколад S M L 3 шт", UNKNOWN_DISTRIBUTION, 3),
        ("Лоран шоколад S M L", UNKNOWN_DISTRIBUTION, None),
        ("Бомбер чорний білий 2 шт", UNKNOWN_DISTRIBUTION, 2),
        ("Бомбер М 2 шт L 1 шт", UNKNOWN_DISTRIBUTION, None),
        # A count no stock could be is kept as evidence, never as a total.
        ("Куртка 10000 шт", KNOWN, 10_000),
        ("Куртка 10001 шт", UNKNOWN_QUANTITY, None),
        ("Куртка 3000000000 шт", UNKNOWN_QUANTITY, None),
    ],
)
def test_what_a_line_says_about_its_own_quantity(
    text: str, state: SnapshotQuantityState, total: int | None
) -> None:
    assert source_quantity(parse_catalog_line(text).to_dict()) == (state, total)


def test_a_negated_quantity_is_not_a_quantity() -> None:
    """`не 3 шт` is evidence the parser marks AMBIGUOUS, not a count to load."""
    assert source_quantity(parse_catalog_line("Куртка не 3 шт").to_dict()) == (
        UNKNOWN_QUANTITY,
        None,
    )


@pytest.mark.parametrize(
    ("text", "countless"),
    [
        ("Бомбер шоколад М", True),
        ("Куртки", True),
        ("Куртка не синя", True),
        ("Бомбер шоколад 3 шт", False),
        ("Куртка 2 шт 3 шт", False),
        ("Куртка не 3 шт", False),
        # A number the parser cannot classify may be a count, a size or an item
        # code: only a person can say which.
        ("3 куртки", False),
        ("Куртка 1636", False),
        ("Куртка 46", False),
    ],
)
def test_a_line_is_countless_only_when_nothing_in_it_could_be_a_count(
    text: str, countless: bool
) -> None:
    assert mentions_no_count(parse_catalog_line(text).to_dict()) is countless


def test_a_line_without_its_parse_is_never_countless() -> None:
    assert mentions_no_count(None) is False


def test_the_retry_proof_depends_on_content_not_on_key_order() -> None:
    lines = ["Бомбер шоколад 3 шт", "Куртки"]
    one = request_fingerprint({"store_id": "a", "location_id": "b", "lines": lines})
    same = request_fingerprint({"lines": list(lines), "location_id": "b", "store_id": "a"})
    reordered = request_fingerprint({"store_id": "a", "location_id": "b", "lines": lines[::-1]})
    retyped = request_fingerprint(
        {"store_id": "a", "location_id": "b", "lines": ["Бомбер шоколад  3 шт", "Куртки"]}
    )
    assert one == same
    # The order of a list and the exact spacing of a line are both evidence.
    assert one != reordered
    assert one != retyped


def test_a_line_is_kept_exactly_as_written() -> None:
    """No stripping and no case folding at the boundary: the raw line is evidence."""
    request = ImportRequest(
        command_id=uuid.uuid4(),
        store_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        lines=["  Бомбер  ШОКОЛАД 3 шт\t"],
    )
    assert request.lines == ["  Бомбер  ШОКОЛАД 3 шт\t"]


@pytest.mark.parametrize(
    "lines",
    [
        [],
        ["x" * 501],
        ["Куртка\x00"],
        ["Куртка"] * 1001,
        # Every line within bounds, the list as a whole not (M1-023 security review).
        ["x" * 500] * 201,
    ],
    ids=["no-lines", "line-too-long", "nul-byte", "too-many-lines", "list-too-long"],
)
def test_an_import_that_is_not_a_list_of_lines_is_refused(lines: list[str]) -> None:
    with pytest.raises(ValidationError):
        ImportRequest(
            command_id=uuid.uuid4(), store_id=uuid.uuid4(), location_id=uuid.uuid4(), lines=lines
        )


def test_the_longest_list_the_import_takes() -> None:
    ImportRequest(
        command_id=uuid.uuid4(),
        store_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        lines=["x" * 500] * 200,
    )


def test_an_allocation_names_its_size_or_says_it_is_unknown_never_both() -> None:
    variant = uuid.uuid4()
    AllocationPayload(product_variant_id=variant, size_id=uuid.uuid4(), quantity=1)
    AllocationPayload(product_variant_id=variant, size_unknown=True, quantity=1)
    with pytest.raises(ValidationError):
        AllocationPayload(product_variant_id=variant, quantity=1)
    with pytest.raises(ValidationError):
        AllocationPayload(
            product_variant_id=variant, size_id=uuid.uuid4(), size_unknown=True, quantity=1
        )
    for quantity in (0, -1, 10_001):
        with pytest.raises(ValidationError):
            AllocationPayload(product_variant_id=variant, size_unknown=True, quantity=quantity)


def test_a_line_is_answered_with_allocations_or_a_skip_reason_never_both() -> None:
    allocation = {"product_variant_id": str(uuid.uuid4()), "size_unknown": True, "quantity": 2}
    ResolutionRequest.model_validate({"allocations": [allocation], "quantity_basis": "STATED"})
    ResolutionRequest.model_validate(
        {"allocations": [allocation], "quantity_basis": "RECOUNTED", "note": "перелічено"}
    )
    ResolutionRequest.model_validate({"skip_reason": "заголовок розділу"})
    for invalid in (
        {},
        {"allocations": []},
        # Numbers always say where they came from.
        {"allocations": [allocation]},
        {"allocations": [allocation], "quantity_basis": "GUESSED"},
        {"allocations": [allocation], "quantity_basis": "STATED", "skip_reason": "заголовок"},
        {"skip_reason": "заголовок", "note": "і ще"},
        {"skip_reason": "заголовок", "quantity_basis": "STATED"},
        {"note": "лише примітка"},
    ):
        with pytest.raises(ValidationError):
            ResolutionRequest.model_validate(invalid)


# --- where the numbers came from (ADR-0005 §3) --------------------------------


@pytest.mark.parametrize(
    ("state", "stated", "basis", "quantities", "note", "countless"),
    [
        # The line says "3 шт" and the answer is exactly that, in one piece of
        # identity: nothing was added to what the list says.
        (KNOWN, 3, STATED, [3], None, False),
        # A line with no count, taken as one piece — a declared convention.
        (UNKNOWN_QUANTITY, None, LINE_IMPLIES_ONE, [1], None, True),
        # Counted, or known some other way: anything goes, with a note.
        (KNOWN, 3, RECOUNTED, [1, 1], "перелічили 27.09", False),
        (UNKNOWN_DISTRIBUTION, 3, RECOUNTED, [1, 1, 1], "перелічили 27.09", False),
        (UNKNOWN_QUANTITY, None, OWNER_KNOWLEDGE, [2], "власниця пам'ятає", False),
    ],
)
def test_an_answer_may_claim_what_its_basis_supports(
    state: SnapshotQuantityState,
    stated: int | None,
    basis: SnapshotQuantityBasis,
    quantities: list[int],
    note: str | None,
    countless: bool,
) -> None:
    check_basis(
        state=state,
        stated_total=stated,
        basis=basis,
        quantities=quantities,
        note=note,
        countless=countless,
    )


@pytest.mark.parametrize(
    ("state", "stated", "basis", "quantities", "note", "countless"),
    [
        # The known-risk case: 1+1+1 for "Лама бежевая/персик/butter 3 шт"
        # cannot pass as what the line says...
        (UNKNOWN_DISTRIBUTION, 3, STATED, [1, 1, 1], None, False),
        # ...nor all 3 of "Лоран S M L 3 шт" in one size.
        (UNKNOWN_DISTRIBUTION, 3, STATED, [3], None, False),
        # Nor can a split of a stated total across sizes...
        (KNOWN, 3, STATED, [1, 1, 1], None, False),
        # ...nor the stated count in one size plus a piece the line never mentions...
        (KNOWN, 3, STATED, [3, 1], None, False),
        # ...nor a number the line does not state...
        (KNOWN, 3, STATED, [2], None, False),
        (UNKNOWN_QUANTITY, None, STATED, [1], None, True),
        # ...nor "one piece" stretched to two, or to a line that has a count.
        (UNKNOWN_QUANTITY, None, LINE_IMPLIES_ONE, [2], None, True),
        (UNKNOWN_QUANTITY, None, LINE_IMPLIES_ONE, [1, 1], None, True),
        (KNOWN, 1, LINE_IMPLIES_ONE, [1], None, False),
        (UNKNOWN_DISTRIBUTION, None, LINE_IMPLIES_ONE, [1], None, True),
        # A line whose counts the parser could not trust is not countless:
        # "Куртка 2 шт 3 шт", "Куртка не 3 шт", "3 куртки".
        (UNKNOWN_QUANTITY, None, LINE_IMPLIES_ONE, [1], None, False),
        # Counted or known otherwise, but nobody said how.
        (KNOWN, 3, RECOUNTED, [3], None, False),
        (UNKNOWN_QUANTITY, None, OWNER_KNOWLEDGE, [1], None, True),
    ],
)
def test_an_answer_may_not_claim_more_than_its_basis(
    state: SnapshotQuantityState,
    stated: int | None,
    basis: SnapshotQuantityBasis,
    quantities: list[int],
    note: str | None,
    countless: bool,
) -> None:
    with pytest.raises(ValidationFailedError):
        check_basis(
            state=state,
            stated_total=stated,
            basis=basis,
            quantities=quantities,
            note=note,
            countless=countless,
        )
