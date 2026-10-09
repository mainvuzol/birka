"""The pure parts of the legacy snapshot import (M1-023, ADR-0005).

What a line says about its own quantity, the import's retry proof, and the
request shapes that keep a person's answer unambiguous. The database-backed
workflow is in `tests/integration/test_snapshot_import.py`.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.api.v1.snapshots import (
    AddPartRequest,
    AllocationPayload,
    ImportRequest,
    RemovePartRequest,
    ResolutionRequest,
)
from app.core.errors import ValidationFailedError
from app.modules.catalog.parser import parse_catalog_line
from app.modules.catalog.raw_lines import text_of
from app.modules.snapshots import service
from app.modules.snapshots.file_lines import SplitReading
from app.modules.snapshots.models import (
    InventorySnapshotRow,
    SnapshotQuantityBasis,
    SnapshotQuantityState,
)
from app.modules.snapshots.rules import lines_import_request
from app.modules.snapshots.service import (
    MAX_PART_LINES,
    MAX_PART_TEXT_CHARS,
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
STATED_BY_SIZE = SnapshotQuantityBasis.STATED_BY_SIZE

A_FILE = {
    "format": "birka.stock-list",
    "version": 1,
    "lines": [{"text": "Лоран M-1 L-2", "photo": "IMG_1.jpg", "photo_line": 1}],
}


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
    longest = MAX_PART_TEXT_CHARS // MAX_PART_LINES
    ImportRequest(
        command_id=uuid.uuid4(),
        store_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        lines=["x" * longest] * MAX_PART_LINES,
    )
    ImportRequest(
        command_id=uuid.uuid4(),
        store_id=uuid.uuid4(),
        location_id=uuid.uuid4(),
        lines=["x" * 500] * (MAX_PART_TEXT_CHARS // 500),
    )


def test_a_list_takes_what_its_approval_was_measured_to_write() -> None:
    """ADR-0014 §10: the largest measured size whose approval passed, and the
    bounds derived from it. 10 000 answers were refused outright: the
    ledger's reservation read names every answer in one statement, which
    PostgreSQL 16 refuses past about 6 500 (2026-10-08 measurement). A raise
    needs a new measurement, not an edit here."""
    assert service.MAX_LIST_ALLOCATIONS == 5_000
    assert service.MAX_LIST_LINES == service.MAX_LIST_ALLOCATIONS == 5_000
    assert service.MAX_LIST_ROWS == 2 * service.MAX_LIST_LINES == 10_000
    assert service.MAX_LIST_PARTS == 1_000
    # A list's line numbers stay within the API's bounds.
    assert service.MAX_LIST_ROWS >= service.MAX_LIST_LINES >= MAX_PART_LINES


def test_the_lines_import_fingerprint_is_unchanged() -> None:
    """The retry proof of an import of typed lines, byte for byte as M1-023
    computed it before ADR-0014, so a retry across the deploy replays
    (ADR-0014 §8). Computed from `service.request_fingerprint` at 8b32a05,
    before the service changed."""
    request = lines_import_request(
        store_id=uuid.UUID("00000000-0000-4000-8000-000000000001"),
        location_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
        source_document_ref="зошит, сторінка 4",
        captured_at="осінь 2025",
        lines=["Лоран шоколад S M L", "Мышка чорний М 2 шт", "Куртки"],
    )

    assert request_fingerprint(request) == (
        "7d9102abdb6a2d8eca363ff5d037dc460f5e0ebf9ff1fd467fcc38739ff8d447"
    )


def test_an_import_gives_lines_or_a_file_never_both() -> None:
    ids = {"command_id": uuid.uuid4(), "store_id": uuid.uuid4(), "location_id": uuid.uuid4()}
    ImportRequest.model_validate({**ids, "lines": ["Куртки"]})
    ImportRequest.model_validate({**ids, "file": A_FILE, "file_name": "зошит-1.json"})
    for invalid in (
        {},
        {"lines": ["Куртки"], "file": A_FILE, "file_name": "зошит-1.json"},
        # A file comes with its name, and only a file does.
        {"file": A_FILE},
        {"lines": ["Куртки"], "file_name": "зошит-1.json"},
        {"file": A_FILE, "file_name": ""},
        {"file": A_FILE, "file_name": "зошит\n1.json"},
        {"file": A_FILE, "file_name": "x" * 201},
        {"lines": None},
        {"lines": ["x" * 500] * (MAX_PART_TEXT_CHARS // 500 + 1)},
    ):
        with pytest.raises(ValidationError):
            ImportRequest.model_validate({**ids, **invalid})


def test_a_part_gives_lines_or_a_file_never_both() -> None:
    command = {"command_id": uuid.uuid4()}
    AddPartRequest.model_validate({**command, "lines": ["Куртки"]})
    AddPartRequest.model_validate(
        {**command, "lines": ["Куртки"], "source": "сторінка 7", "counted_on": "осінь"}
    )
    AddPartRequest.model_validate({**command, "file": A_FILE, "file_name": "зошит-2.json"})
    for invalid in (
        {},
        {"lines": ["Куртки"], "file": A_FILE, "file_name": "зошит-2.json"},
        {"file": A_FILE},
        {"lines": ["Куртки"], "file_name": "зошит-2.json"},
        # A file says where it came from itself.
        {"file": A_FILE, "file_name": "зошит-2.json", "source": "сторінка 7"},
        {"file": A_FILE, "file_name": "зошит-2.json", "counted_on": "осінь"},
        {"lines": ["Куртки"], "source": ""},
        {"lines": ["Куртки"] * (MAX_PART_LINES + 1)},
        {"lines": ["Куртки"], "store_id": str(uuid.uuid4())},
    ):
        with pytest.raises(ValidationError):
            AddPartRequest.model_validate({**command, **invalid})
    with pytest.raises(ValidationError):
        AddPartRequest.model_validate({"lines": ["Куртки"]})
    # Removing a part takes no body, and no reason (owner, 2026-10-08).
    RemovePartRequest.model_validate({})
    with pytest.raises(ValidationError):
        RemovePartRequest.model_validate({"reason": "не той зошит"})


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


def test_what_a_person_said_of_a_split_names_the_records_it_was_said_of() -> None:
    """Review, third round, 2026-10-09: `split_read_as` goes with the records
    the editor asked about (`split_read_records`), each once, as the line
    writes it, and only with an answer by size."""
    allocation = {"product_variant_id": str(uuid.uuid4()), "size_unknown": True, "quantity": 2}
    by_size = {"allocations": [allocation], "quantity_basis": "STATED_BY_SIZE"}
    said = {"split_read_as": "SIZE_WITH_COUNT"}
    ResolutionRequest.model_validate(by_size)
    assert ResolutionRequest.model_validate(
        {**by_size, **said, "split_read_records": ["42-44", "46-2"]}
    ).split_read_records == ["42-44", "46-2"]
    for invalid in (
        # The word without the records it was said of, or records without it.
        {**by_size, **said},
        {**by_size, "split_read_records": ["42-44"]},
        {**by_size, **said, "split_read_records": None},
        {**by_size, **said, "split_read_records": []},
        # Each record once, as a line can write it.
        {**by_size, **said, "split_read_records": ["42-44", "42-44"]},
        {**by_size, **said, "split_read_records": [""]},
        {**by_size, **said, "split_read_records": ["4" * 501]},
        {**by_size, **said, "split_read_records": [f"M-{n}" for n in range(11)]},
        {**by_size, **said, "split_read_records": ["42-44\x00"]},
        # Only with an answer by size.
        {
            "allocations": [allocation],
            "quantity_basis": "OWNER_KNOWLEDGE",
            "note": "так на фото",
            **said,
            "split_read_records": ["42-44"],
        },
        {"skip_reason": "заголовок", "split_read_records": ["42-44"]},
    ):
        with pytest.raises(ValidationError):
            ResolutionRequest.model_validate(invalid)


def shown_pair(size: str, count: int, written: str | None, may_be_range: bool) -> dict:
    """A pair of a line's split as `_shown_splits` reads it now."""
    return {
        "size": size,
        "count": count,
        "size_id": uuid.uuid4(),
        "written": written,
        "may_be_range": may_be_range,
    }


def refused_records(split: list[dict], read_as: str | None, records: list[str] | None) -> dict:
    reading = SplitReading(read_as) if read_as else None
    with pytest.raises(ValidationFailedError) as refused:
        service._stated_split(split, reading, records)
    return refused.value.details


def test_an_answer_by_size_covers_the_records_it_names_and_no_other() -> None:
    """Review, third round, 2026-10-09: the person's word is checked at the
    answer against the records it names. A record that may be a range as
    the answer arrives and is not among them, made so by a size created
    after the editor read the line, refuses it by name; a record that is
    not the line's is refused too."""
    asked = [shown_pair("42", 44, "42-44", True), shown_pair("46", 2, "46-2", False)]
    since = [shown_pair("42", 44, "42-44", True), shown_pair("46", 2, "46-2", True)]

    assert len(service._stated_split(asked, SplitReading.SIZE_WITH_COUNT, ["42-44"])) == 2
    assert refused_records(asked, None, None) == {
        "reason": "SPLIT_MAY_BE_RANGE",
        "records": ["42-44"],
    }
    assert refused_records(since, "SIZE_WITH_COUNT", ["42-44"]) == {
        "reason": "SPLIT_MAY_BE_RANGE",
        "records": ["46-2"],
    }
    assert len(service._stated_split(since, SplitReading.SIZE_WITH_COUNT, ["46-2", "42-44"])) == 2
    # A record named as the line does not write it is none of its records.
    for unknown in (["42-44", "Парка"], ["42 – 44"], ["42"]):
        assert refused_records(asked, "SIZE_WITH_COUNT", unknown) == {
            "reason": "SPLIT_RECORD_UNKNOWN"
        }, unknown
    # A record the text no longer shows is named by its size.
    unseen = [shown_pair("42", 44, None, True)]
    assert len(service._stated_split(unseen, SplitReading.SIZE_WITH_COUNT, ["42"])) == 1


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


# --- a split the line's text shows (ADR-0014 §5) -----------------------------

COAT = uuid.UUID("00000000-0000-4000-8000-0000000000c0")
BOMBER = uuid.UUID("00000000-0000-4000-8000-0000000000b0")
S, M, L = (uuid.UUID(f"00000000-0000-4000-8000-00000000000{n}") for n in (1, 2, 3))


def stated_by_size(
    answer: list[tuple[uuid.UUID, uuid.UUID, int]],
    shown: list[tuple[uuid.UUID, int]] | None,
    *,
    state: SnapshotQuantityState = UNKNOWN_DISTRIBUTION,
    total: int | None = 3,
    note: str | None = None,
) -> None:
    check_basis(
        state=state,
        stated_total=total,
        basis=STATED_BY_SIZE,
        quantities=[quantity for _, _, quantity in answer],
        note=note,
        countless=False,
        answer=answer,
        shown=shown,
    )


def test_a_split_the_line_shows_may_be_stated_by_size() -> None:
    """«Лоран M-1 L-2»: one model, one allocation per size, each with its
    count, and no note (owner, 2026-10-08)."""
    stated_by_size([(COAT, M, 1), (COAT, L, 2)], [(M, 1), (L, 2)])
    # In any order the answer comes in.
    stated_by_size([(COAT, L, 2), (COAT, M, 1)], [(M, 1), (L, 2)])
    # One size with its count, «Лоран M-3», whatever the line's own state.
    stated_by_size([(COAT, M, 3)], [(M, 3)], state=UNKNOWN_QUANTITY, total=None)
    stated_by_size([(COAT, M, 3)], [(M, 3)], state=KNOWN, total=3)
    # A note may be added; it is not needed.
    stated_by_size([(COAT, M, 1), (COAT, L, 2)], [(M, 1), (L, 2)], note="як у рядку")


@pytest.mark.parametrize(
    ("answer", "shown"),
    [
        # The line shows no split: a typed line, or «M 3».
        ([(COAT, M, 3)], None),
        ([(COAT, M, 3)], []),
        # A split shown with one size twice is no split to take.
        ([(COAT, M, 1), (COAT, L, 2)], [(M, 1), (M, 2)]),
        # Another count, a size missing, a size more, another size.
        ([(COAT, M, 2), (COAT, L, 2)], [(M, 1), (L, 2)]),
        ([(COAT, M, 1)], [(M, 1), (L, 2)]),
        ([(COAT, M, 1), (COAT, L, 2), (COAT, S, 1)], [(M, 1), (L, 2)]),
        ([(COAT, S, 1), (COAT, L, 2)], [(M, 1), (L, 2)]),
        # Two models: the split names one.
        ([(COAT, M, 1), (BOMBER, L, 2)], [(M, 1), (L, 2)]),
        # The same size of two models, the counts summed: still two models.
        ([(COAT, M, 1), (BOMBER, M, 2)], [(M, 3)]),
        # The total in one size.
        ([(COAT, M, 3)], [(M, 1), (L, 2)]),
    ],
)
def test_a_split_stated_by_size_names_every_size_with_its_count_for_one_model(
    answer: list[tuple[uuid.UUID, uuid.UUID, int]], shown: list[tuple[uuid.UUID, int]] | None
) -> None:
    with pytest.raises(ValidationFailedError):
        stated_by_size(answer, shown)
    # A note does not make it what the line shows; another basis does.
    with pytest.raises(ValidationFailedError):
        stated_by_size(answer, shown, note="власниця знає")


def test_a_split_the_line_shows_is_still_not_stated() -> None:
    """`STATED` keeps its rule: one allocation of the count the line states
    with its unit. A shown split is `STATED_BY_SIZE`, never `STATED`."""
    for quantities in ([1, 2], [3]):
        with pytest.raises(ValidationFailedError):
            check_basis(
                state=UNKNOWN_DISTRIBUTION,
                stated_total=3,
                basis=STATED,
                quantities=quantities,
                note=None,
                countless=False,
                answer=[(COAT, M, 1), (COAT, L, 2)],
                shown=[(M, 1), (L, 2)],
            )


def test_a_split_stated_by_size_says_why_it_is_refused() -> None:
    """What a refusal says is what the person reads: a line that shows no
    split asks how the count is known; a split answered otherwise names
    what it must be."""
    for shown in (None, []):
        with pytest.raises(ValidationFailedError, match="does not show its split"):
            stated_by_size([(COAT, M, 3)], shown)
        with pytest.raises(ValidationFailedError, match="does not show its split"):
            stated_by_size([], shown)
    # A shown split naming one size twice is no split to take, whatever the
    # answer (a slip of `sizes_by_spelling` must never pass as one).
    with pytest.raises(ValidationFailedError, match="does not show its split"):
        stated_by_size([(COAT, M, 1), (COAT, M, 1)], [(M, 1), (M, 1)])
    for answer in (
        # The same size twice, before `_normalize_allocations` would refuse it.
        [(COAT, M, 1), (COAT, M, 1)],
        [(COAT, M, 1), (BOMBER, M, 1)],
        [(COAT, M, 2)],
    ):
        with pytest.raises(ValidationFailedError, match="names each of its sizes"):
            stated_by_size(answer, [(M, 1)])


def test_a_line_s_text_is_read_by_its_key_with_its_organization_checked() -> None:
    """Review, fourth round, 2026-10-09: `raw_lines.text_of` finds the line by
    its primary key and checks its organization in a form no index serves
    (`IS NOT DISTINCT FROM`), so no planner statistics lead to reading the
    organization's lines by their index for each row. The check is there:
    nothing else ties a row's line to its organization."""
    organization_id = uuid.uuid4()
    compiled = str(
        select(
            InventorySnapshotRow.line_no,
            text_of(InventorySnapshotRow.raw_input_id, organization_id=organization_id),
        ).compile(dialect=postgresql.dialect())
    )
    subquery = compiled[compiled.index("(SELECT") :]

    assert "raw_input.id = inventory_snapshot_row.raw_input_id" in subquery
    assert "raw_input.organization_id IS NOT DISTINCT FROM" in subquery
    assert "raw_input.organization_id =" not in subquery
