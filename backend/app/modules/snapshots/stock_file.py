"""The file a parser writes for Birka: `birka.stock-list`, version 1 (ADR-0014 §1).

The shops photograph their notebooks, a parser outside Birka reads the photos
into this file, and «Початкові залишки» takes it into a warehouse's list
(owner decision, 2026-10-08). This model *is* the format: the JSON Schema
parser authors get is generated from it, and the reference validator
(`scripts/check_stock_file.py`) runs it. So this module imports only
pydantic, the standard library and `app.core.text`, never the database.

**The format is strict.** A parser's output is a machine's, so its rules are
a machine's too, not a shop's (`core/text.py` keeps a shop's own text as
written, and still does: `text` is stored verbatim):

- unknown keys are refused at every level, except `$schema`;
- types are strict: `"7"` is not `7`, `true` is not `1`, `3.0` is not `3`;
- an optional key is absent or `null`, never `""` or `[]`;
- no string holds a control character, so no line break inside `text`;
- `(photo, photo_line)` appears once per file, and a `size_counts` names
  each size once, ignoring case;
- a file holds at most 100 000 characters of `text`, and at most 950 000
  bytes as compact UTF-8 JSON without its nulls (§11).

A duplicate key and a number written as `3.0` are lost once JSON is parsed;
`load_stock_file_text` refuses them for the reference validator and the
tests, and the phone refuses them before it sends (ADR-0014 §15).

Every refusal inside `lines` names its line, 1-based, as `ctx.line`.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Sequence
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    ValidationInfo,
    field_validator,
    model_validator,
)
from pydantic_core import InitErrorDetails, PydanticCustomError, PydanticKnownError

from app.core.text import reject_unstorable

FORMAT = "birka.stock-list"
VERSION = 1

MAX_PART_LINES = 1000
# The parser's cost grows faster than a line's length, and every line's parse
# is kept for good. Real lines are a few dozen characters (the store corpus has
# none over 40); these bounds hold the worst part to about a second of
# parsing, off the event loop (M1-023 security review).
MAX_LINE_CHARS = 500
MAX_PART_TEXT_CHARS = 100_000
# A file part as compact UTF-8 JSON without its nulls. With the rest of the
# body it stays under the edge's `1MB`, which is 1 000 000 bytes (§11).
MAX_PART_BYTES = 950_000

MAX_PHOTO_CHARS = 200
MAX_PHOTO_LINE = 10_000
MAX_MODEL_CHARS = 200
MAX_LIST_ITEMS = 10
MAX_COLOUR_CHARS = 60
MAX_SIZE_CHARS = 20
MAX_PRICE_CHARS = 40
MAX_NOTE_CHARS = 200
MAX_SOURCE_CHARS = 300
MAX_COUNTED_ON_CHARS = 40
MAX_PARSER_CHARS = 100
MAX_SCHEMA_CHARS = 2000
# A count stock could be. `rules` re-exports it for a line's answer.
MAX_QUANTITY = 10_000

# The refusals this format adds to pydantic's own, by `type`. A client maps
# each to its own words (ADR-0014 §15); the English here is for logs and the
# reference validator's fallback.
MESSAGES = {
    "stock_file_text_blank": "The line's text is blank",
    "stock_file_control_character": (
        "The field {field} holds a control character, such as a line break or a tab"
    ),
    "stock_file_photo_line_repeated": "This photo and line are already line {first_line}",
    "stock_file_sizes_and_size_counts": "A line gives sizes or counts per size, never both",
    "stock_file_size_repeated": "The size {size} is named twice",
    "stock_file_text_too_long_in_all": "A file holds at most {limit} characters of text in all",
    "stock_file_too_large": (
        "A file is at most {limit} bytes written compactly; this one is {bytes}"
    ),
    "stock_file_duplicate_key": "The key {key} appears twice in one object",
    "stock_file_not_finite": "{constant} is not a number a file may hold",
}


def _refusal(kind: str, **context: Any) -> PydanticCustomError:
    return PydanticCustomError(kind, MESSAGES[kind], context)


def _plain(value: str, info: ValidationInfo) -> str:
    """No control character, U+0000–U+001F and U+007F, in any string.

    A line break inside `text` would show one written line as two. Then the
    rule every stored text follows: nothing PostgreSQL cannot hold.
    """
    if any(character < " " or character == "\x7f" for character in value):
        raise _refusal("stock_file_control_character", field=info.field_name)
    return reject_unstorable(value)


def _integer(value: Any) -> Any:
    """`true`, `1.0` and `Decimal("1")` all equal 1, and a `Literal[1]` takes
    them even in strict mode. A version is an integer, as written."""
    if type(value) is not int:
        raise PydanticKnownError("int_type")
    return value


LineText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_LINE_CHARS), AfterValidator(_plain)
]
PhotoName = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_PHOTO_CHARS), AfterValidator(_plain)
]
ModelText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_MODEL_CHARS), AfterValidator(_plain)
]
ColourText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_COLOUR_CHARS), AfterValidator(_plain)
]
SizeText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_SIZE_CHARS), AfterValidator(_plain)
]
PriceText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_PRICE_CHARS), AfterValidator(_plain)
]
NoteText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_NOTE_CHARS), AfterValidator(_plain)
]
SourceText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_SOURCE_CHARS), AfterValidator(_plain)
]
CountedOnText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_COUNTED_ON_CHARS), AfterValidator(_plain)
]
ParserText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_PARSER_CHARS), AfterValidator(_plain)
]
SchemaText = Annotated[
    str, StringConstraints(min_length=1, max_length=MAX_SCHEMA_CHARS), AfterValidator(_plain)
]
Count = Annotated[int, Field(ge=1, le=MAX_QUANTITY)]


class SizeCountV1(BaseModel):
    """One size as written, with its own count: «M-2» is `{"size": "M", "count": 2}`."""

    model_config = ConfigDict(extra="forbid", strict=True)

    size: SizeText
    count: Count


class StockFileLineV1(BaseModel):
    """One written line, as the parser read it. Only `text` is evidence; the
    rest is the parser's reading of it, a hint for the person who reviews."""

    model_config = ConfigDict(extra="forbid", strict=True)

    # The written line verbatim, its count and price included.
    text: LineText
    # The photo's file name, as the shop keeps it, and the line's number on
    # it from the top. On a spread or in columns, the left page or column
    # first, the numbering continuing.
    photo: PhotoName
    photo_line: Annotated[int, Field(ge=1, le=MAX_PHOTO_LINE)]
    model: ModelText | None = None
    colours: Annotated[list[ColourText], Field(min_length=1, max_length=MAX_LIST_ITEMS)] | None = (
        None
    )
    # Each size as written, when no count is written per size.
    sizes: Annotated[list[SizeText], Field(min_length=1, max_length=MAX_LIST_ITEMS)] | None = None
    # Each size as written with its own count. One size counts too: «Лоран
    # M-3» is a size with its count, as «S-1 M-2 L-1» is (owner, 2026-10-08).
    size_counts: (
        Annotated[list[SizeCountV1], Field(min_length=1, max_length=MAX_LIST_ITEMS)] | None
    ) = None
    # The line's written total, a single integer: «3+2» is no count.
    count: Count | None = None
    # As written. Never parsed, never a price in Birka: only shown.
    price: PriceText | None = None
    # The parser's word to the person who reviews («закреслено»).
    note: NoteText | None = None

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise _refusal("stock_file_text_blank")
        return value

    @field_validator("size_counts")
    @classmethod
    def _each_size_once(cls, value: list[SizeCountV1] | None) -> list[SizeCountV1] | None:
        seen: set[str] = set()
        for pair in value or ():
            key = pair.size.strip().casefold()
            if key in seen:
                raise _refusal("stock_file_size_repeated", size=pair.size)
            seen.add(key)
        return value

    @model_validator(mode="after")
    def _sizes_or_counts(self) -> StockFileLineV1:
        if self.sizes is not None and self.size_counts is not None:
            raise _refusal("stock_file_sizes_and_size_counts")
        return self


class StockFileV1(BaseModel):
    """A file of one notebook, or of whole photos of one. The warehouse is
    not in it: a person chooses the warehouse in the app (ADR-0014 §1)."""

    model_config = ConfigDict(extra="forbid", strict=True)

    # Editors add it; it is ignored, and not part of the file's content.
    schema_: SchemaText | None = Field(default=None, alias="$schema")
    format: Literal["birka.stock-list"]
    version: Annotated[Literal[1], BeforeValidator(_integer)]
    # Which notebook, as people call it.
    source: SourceText | None = None
    # Free text, like a list's date today: «осінь 2025».
    counted_on: CountedOnText | None = None
    # The kind of every price in the file: one notebook, one kind (owner).
    price_kind: Literal["sale", "purchase"] | None = None
    # Which parser, and which version of it, wrote the file.
    parser: ParserText | None = None
    lines: Annotated[list[StockFileLineV1], Field(min_length=1, max_length=MAX_PART_LINES)]

    @field_validator("lines", mode="wrap")
    @classmethod
    def _name_the_line(cls, value: Any, handler: Callable[[Any], Any]) -> Any:
        """A refusal inside a line has its index in `loc`; it also carries
        the line's number, 1-based, as `ctx.line`."""
        try:
            return handler(value)
        except ValidationError as refused:
            raise _with_line_numbers(refused) from None

    @model_validator(mode="after")
    def _bounded_and_unique(self) -> StockFileV1:
        problems: list[InitErrorDetails] = []
        first: dict[tuple[str, int], int] = {}
        for index, line in enumerate(self.lines):
            seen = first.setdefault((line.photo, line.photo_line), index)
            if seen != index:
                problems.append(
                    _detail(
                        "stock_file_photo_line_repeated",
                        ("lines", index, "photo_line"),
                        line.photo_line,
                        line=index + 1,
                        first_line=seen + 1,
                    )
                )
        written = 0
        for index, line in enumerate(self.lines):
            written += len(line.text)
            if written > MAX_PART_TEXT_CHARS:
                problems.append(
                    _detail(
                        "stock_file_text_too_long_in_all",
                        ("lines", index, "text"),
                        None,
                        line=index + 1,
                        limit=MAX_PART_TEXT_CHARS,
                    )
                )
                break
        size = len(canonical_bytes(self))
        if size > MAX_PART_BYTES:
            problems.append(
                _detail("stock_file_too_large", (), None, limit=MAX_PART_BYTES, bytes=size)
            )
        if problems:
            raise ValidationError.from_exception_data(type(self).__name__, problems)
        return self


def _detail(kind: str, loc: tuple[str | int, ...], value: Any, **context: Any) -> InitErrorDetails:
    return {"type": _refusal(kind, **context), "loc": loc, "input": value}


def _with_line_numbers(refused: ValidationError) -> ValidationError:
    details: list[InitErrorDetails] = []
    for error in refused.errors(include_url=False):
        context = dict(error.get("ctx") or {})
        location = error["loc"]
        if location and isinstance(location[0], int):
            context["line"] = location[0] + 1
        kind = error["type"]
        detail: InitErrorDetails = {
            "type": _refusal(kind, **context) if kind in MESSAGES else kind,
            "loc": location,
            "input": error["input"],
        }
        if kind not in MESSAGES:
            detail["ctx"] = context
        details.append(detail)
    return ValidationError.from_exception_data(refused.title, details)


# ---------------------------------------------------------------------------
# The canonical encoding and the content fingerprint
# ---------------------------------------------------------------------------


def canonical(file: StockFileV1) -> dict[str, Any]:
    """The file as Birka keeps and fingerprints it: nulls and `$schema` left out."""
    return file.model_dump(mode="json", by_alias=True, exclude_none=True, exclude={"schema_"})


def canonical_bytes(file: StockFileV1) -> bytes:
    """Compact UTF-8 JSON: what the phone sends, and what `MAX_PART_BYTES` bounds.
    The phone's key order may differ, its length cannot."""
    return json.dumps(canonical(file), ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _content_fingerprint(kind: str, lines: Sequence[Any]) -> str:
    content = json.dumps(
        {"kind": kind, "lines": list(lines)},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def content_fingerprint_of_file(file: StockFileV1) -> str:
    """What a file says, line by line: no file name, no envelope, key order
    ignored. The same content twice in one list is refused (ADR-0014 §8)."""
    return _content_fingerprint(
        "FILE", [line.model_dump(mode="json", exclude_none=True) for line in file.lines]
    )


def content_fingerprint_of_lines(lines: Sequence[str]) -> str:
    """The same, for hand-typed lines; never equal to a file's."""
    return _content_fingerprint("PASTED", list(lines))


# ---------------------------------------------------------------------------
# Reading a file's text: for the reference validator and the tests, never the API
# ---------------------------------------------------------------------------


class _Repeated(dict[str, Any]):
    """An object that named a key twice; which key is kept for the refusal."""

    def __init__(self, pairs: list[tuple[str, Any]], key: str) -> None:
        super().__init__(pairs)
        self.key = key


class _NotFinite:
    def __init__(self, constant: str) -> None:
        self.constant = constant


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    seen: set[str] = set()
    for key, _ in pairs:
        if key in seen:
            return _Repeated(pairs, key)
        seen.add(key)
    return dict(pairs)


def _found(value: Any, loc: tuple[str | int, ...]) -> list[InitErrorDetails]:
    """Every repeated key and every NaN or Infinity, where it stands."""
    line = (
        {"line": loc[1] + 1} if len(loc) >= 2 and loc[0] == "lines" and type(loc[1]) is int else {}
    )
    if isinstance(value, _NotFinite):
        return [_detail("stock_file_not_finite", loc, None, constant=value.constant, **line)]
    found: list[InitErrorDetails] = []
    if isinstance(value, dict):
        if isinstance(value, _Repeated):
            found.append(_detail("stock_file_duplicate_key", loc, None, key=value.key, **line))
        for key, item in value.items():
            found.extend(_found(item, (*loc, key)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(_found(item, (*loc, index)))
    return found


def load_stock_file_text(text: str) -> StockFileV1:
    """Read a file's text as strictly as the format reads.

    A BOM is stripped. A duplicate key, `NaN` and `Infinity` are refused where
    they stand, and a number with a point or an exponent is kept as a
    `Decimal`, which no integer field takes: `3.0` is not `3`. Every refusal
    is a `ValidationError`, as the model's own are.
    """
    if text.startswith("﻿"):
        text = text[1:]
    try:
        data = json.loads(
            text, object_pairs_hook=_object, parse_float=Decimal, parse_constant=_NotFinite
        )
    except json.JSONDecodeError as broken:
        raise ValidationError.from_exception_data(
            StockFileV1.__name__,
            [
                {
                    "type": "json_invalid",
                    "loc": (),
                    "input": None,
                    "ctx": {"error": f"{broken.msg}: line {broken.lineno} column {broken.colno}"},
                }
            ],
        ) from None
    problems = _found(data, ())
    if problems:
        raise ValidationError.from_exception_data(StockFileV1.__name__, problems)
    return StockFileV1.model_validate(data)


__all__ = [
    "FORMAT",
    "MAX_COLOUR_CHARS",
    "MAX_COUNTED_ON_CHARS",
    "MAX_LINE_CHARS",
    "MAX_LIST_ITEMS",
    "MAX_MODEL_CHARS",
    "MAX_NOTE_CHARS",
    "MAX_PARSER_CHARS",
    "MAX_PART_BYTES",
    "MAX_PART_LINES",
    "MAX_PART_TEXT_CHARS",
    "MAX_PHOTO_CHARS",
    "MAX_PHOTO_LINE",
    "MAX_PRICE_CHARS",
    "MAX_QUANTITY",
    "MAX_SCHEMA_CHARS",
    "MAX_SIZE_CHARS",
    "MAX_SOURCE_CHARS",
    "MESSAGES",
    "VERSION",
    "SizeCountV1",
    "StockFileLineV1",
    "StockFileV1",
    "canonical",
    "canonical_bytes",
    "content_fingerprint_of_file",
    "content_fingerprint_of_lines",
    "load_stock_file_text",
]
