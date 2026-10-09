"""Raw evidence for workflows that live outside catalog, written by catalog.

A line of a legacy stock list (M1-023) is catalog evidence like any other text
a person wrote: an append-only `RawInput`, the pure parser's `ParseResult` and
a mutable `RawInputProcessing` row. This module is the door other modules use
to create and read that evidence, so its rules stay in one place (ADR-0001
rule 1) and nobody else constructs catalog rows.

Nothing here matches, learns or decides identity. The caller owns the
transaction.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, ScalarSelect, Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import QueryableAttribute

from app.core.errors import ValidationFailedError
from app.modules.catalog.evidence import (
    ParseResult,
    ProcessingStatus,
    RawInput,
    RawInputProcessing,
    RawInputSource,
)
from app.modules.catalog.parser import ParsePreview, parse_catalog_line


@dataclass(frozen=True, slots=True)
class RecordedLine:
    raw_input_id: uuid.UUID
    parse_result_id: uuid.UUID
    # `ParsePreview.to_dict()`: what the parser read, exactly as stored.
    parsed: dict[str, Any]


@dataclass(frozen=True, slots=True)
class StoredLine:
    raw_input_id: uuid.UUID
    raw_text: str
    parsed: dict[str, Any] | None


async def record_lines(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    store_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    source_kind: RawInputSource,
    source_refs: Sequence[str],
    lines: Sequence[str],
) -> list[RecordedLine]:
    """Keep each line verbatim, beside the parser's reading of it.

    Every line is parsed before anything is written, so one line the parser
    refuses fails the whole call rather than leaving part of a list behind.
    The parser refuses only text that is not a line at all — blank, over 2000
    characters, or containing a character PostgreSQL cannot store. A line it
    cannot *interpret* is accepted and kept; that is the point of evidence.

    Parsing runs in a worker thread: it is pure CPU, a list may be a thousand
    lines, and the event loop serves every other request meanwhile. Callers
    bound what they pass; a stock list is capped in lines and in characters.
    """
    if len(source_refs) != len(lines):
        raise ValueError("Every line needs exactly one source reference")
    previews = await asyncio.to_thread(_parse_all, list(lines))

    raws = [
        RawInput(
            id=uuid.uuid4(),
            organization_id=organization_id,
            store_id=store_id,
            source_kind=source_kind,
            source_ref=source_ref,
            raw_text=line,
            content_hash=hashlib.sha256(line.encode("utf-8")).hexdigest(),
            created_by_user_id=actor_user_id,
        )
        for line, source_ref in zip(lines, source_refs, strict=True)
    ]
    session.add_all(raws)
    await session.flush()

    parses = []
    for raw, preview in zip(raws, previews, strict=True):
        parsed: dict[str, Any] = preview.to_dict()
        fields: dict[str, list[dict[str, Any]]] = parsed["fields"]
        parses.append(
            ParseResult(
                id=uuid.uuid4(),
                raw_input_id=raw.id,
                parser_version=preview.parser_version,
                parsed=parsed,
                field_confidence={
                    name: [candidate["confidence"] for candidate in candidates]
                    for name, candidates in fields.items()
                },
                unclassified=parsed["unclassified_descriptors"],
            )
        )
    session.add_all(parses)
    await session.flush()

    session.add_all(
        RawInputProcessing(
            raw_input_id=raw.id,
            status=ProcessingStatus.PARSED,
            attempts=1,
            parser_version=parse.parser_version,
            last_parse_result_id=parse.id,
        )
        for raw, parse in zip(raws, parses, strict=True)
    )
    await session.flush()
    return [
        RecordedLine(raw_input_id=raw.id, parse_result_id=parse.id, parsed=parse.parsed)
        for raw, parse in zip(raws, parses, strict=True)
    ]


def _parse_all(lines: list[str]) -> list[ParsePreview]:
    previews = []
    for number, line in enumerate(lines, start=1):
        try:
            previews.append(parse_catalog_line(line))
        except ValueError as exc:
            raise ValidationFailedError(
                "This line cannot be kept as evidence", line_no=number, reason=str(exc)
            ) from exc
    return previews


async def mark_lines(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    raw_input_ids: Collection[uuid.UUID],
    resolved: bool,
) -> None:
    """Record whether a person has said what these lines mean.

    `RESOLVED` when they were resolved to stock; back to `PARSED` when that
    answer was withdrawn or replaced by "this line is not stock". The raw
    evidence itself never changes (invariant I10).
    """
    if not raw_input_ids:
        return
    owned = select(RawInput.id).where(
        RawInput.id.in_(list(raw_input_ids)), RawInput.organization_id == organization_id
    )
    await session.execute(
        update(RawInputProcessing)
        .where(RawInputProcessing.raw_input_id.in_(owned))
        .values(status=ProcessingStatus.RESOLVED if resolved else ProcessingStatus.PARSED)
        .execution_options(synchronize_session=False)
    )


async def read_lines(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    raw_input_ids: Collection[uuid.UUID],
) -> dict[uuid.UUID, StoredLine]:
    """The exact text and the latest parse of each line, tenant-scoped."""
    if not raw_input_ids:
        return {}
    rows = (
        await session.execute(
            select(RawInput.id, RawInput.raw_text, ParseResult.parsed)
            .outerjoin(RawInputProcessing, RawInputProcessing.raw_input_id == RawInput.id)
            .outerjoin(ParseResult, ParseResult.id == RawInputProcessing.last_parse_result_id)
            .where(
                RawInput.id.in_(list(raw_input_ids)),
                RawInput.organization_id == organization_id,
            )
        )
    ).all()
    return {
        raw_input_id: StoredLine(raw_input_id=raw_input_id, raw_text=raw_text, parsed=parsed)
        for raw_input_id, raw_text, parsed in rows
    }


def text_of(
    raw_input_id: ColumnElement[uuid.UUID] | QueryableAttribute[uuid.UUID],
    *,
    organization_id: uuid.UUID,
) -> ScalarSelect[str]:
    """The exact text of the line `raw_input_id` names, tenant-scoped,
    without its parse, as a column of the caller's own query: a check over
    every line of a long list reads each text beside its row, in the one
    statement that reads the rows (review, 2026-10-09)."""
    return (
        select(RawInput.raw_text)
        .where(RawInput.id == raw_input_id, RawInput.organization_id == organization_id)
        .scalar_subquery()
    )


async def repeated_lines(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    raw_input_ids: Collection[uuid.UUID],
    among: Select[tuple[uuid.UUID]] | None = None,
) -> dict[uuid.UUID, int]:
    """For each line, how many of the given lines have exactly its text.

    A list may repeat a line on purpose — one line per piece — or by a slip of
    transcription. Which, only a person can say; this only makes the repeat
    visible, beside each line it concerns.

    `among` counts across the lines it selects instead (a query of raw input
    ids), in the database: a page of a long list is then compared with the
    whole list without sending every line of it on every page (ADR-0014 §18).
    A given line it does not select is counted among them all the same, and
    may be counted 0 times.
    """
    if not raw_input_ids:
        return {}
    if among is not None:
        given = (
            await session.execute(
                select(RawInput.id, RawInput.content_hash).where(
                    RawInput.id.in_(list(raw_input_ids)),
                    RawInput.organization_id == organization_id,
                )
            )
        ).all()
        counted = dict(
            (
                await session.execute(
                    select(RawInput.content_hash, func.count())
                    .where(
                        RawInput.id.in_(among),
                        RawInput.organization_id == organization_id,
                        RawInput.content_hash.in_({content_hash for _, content_hash in given}),
                    )
                    .group_by(RawInput.content_hash)
                )
            )
            .tuples()
            .all()
        )
        return {raw_input_id: counted.get(content_hash, 0) for raw_input_id, content_hash in given}
    rows = (
        await session.execute(
            select(RawInput.id, RawInput.content_hash).where(
                RawInput.id.in_(list(raw_input_ids)),
                RawInput.organization_id == organization_id,
            )
        )
    ).all()
    counts: dict[str, int] = {}
    for _, content_hash in rows:
        counts[content_hash] = counts.get(content_hash, 0) + 1
    return {raw_input_id: counts[content_hash] for raw_input_id, content_hash in rows}


__all__ = [
    "RecordedLine",
    "StoredLine",
    "mark_lines",
    "read_lines",
    "record_lines",
    "repeated_lines",
    "text_of",
]
