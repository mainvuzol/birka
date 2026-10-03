"""A similar name, caught before it becomes a second model (ADR-0008 §7).

The owner decided on 2026-10-03 that creating a model whose name looks like
one the catalogue already uses — Latin letters in place of Cyrillic, case,
extra spaces — shows the similar model and offers to take it; if the person
confirms it is another, it is still created.

`normalize_label` deliberately does not fold look-alikes: it decides identity,
and two different words must never become one row. This module only *warns*.
It folds harder — NFKC, the Latin letters that look Cyrillic, ï and ё, the
different apostrophes — and asks whether another spelling of the same kind
folds the same and is in use. It never changes what is stored.
"""

from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CatalogSimilarError
from app.modules.catalog.models import AttributeKind
from app.modules.catalog.read import current_variants, describe_variants

# Lower case only: a word is casefolded before it is folded. b, h, m and t look
# Cyrillic only in upper case, which a person typing in capitals produces, so
# they are folded too; a false warning costs one confirmation.
_LATIN = "aceiopxykmtbh"
_CYRILLIC = "асеіорхукмтвн"
_EXTRA_FROM = "ïё"
_EXTRA_TO = "їе"
_APOSTROPHES_FROM = "’ʼ`´‘"
_APOSTROPHES_TO = "'''''"

_FOLD = str.maketrans(
    _LATIN + _EXTRA_FROM + _APOSTROPHES_FROM, _CYRILLIC + _EXTRA_TO + _APOSTROPHES_TO
)
# The same fold in SQL, applied to a stored `normalized_name` (already
# casefolded, its whitespace collapsed). Kept beside the Python one so the two
# cannot drift apart.
_FOLD_SQL = (
    "translate(lower(normalize({column}, NFKC)), "
    f"'{_LATIN + _EXTRA_FROM + _APOSTROPHES_FROM}', "
    f"'{_CYRILLIC + _EXTRA_TO + _APOSTROPHES_TO.replace(chr(39), chr(39) * 2)}')"
)


def fold(normalized: str) -> str:
    """Fold an already normalized label (`normalize_label`) for comparison."""
    folded = unicodedata.normalize("NFKC", normalized).lower().translate(_FOLD)
    return " ".join(folded.split())


@dataclass(frozen=True, slots=True)
class TypedWord:
    """One word of a model's name as a person typed it, normalized."""

    field: str  # concept, source, color, material, texture, fur, collar
    name: str
    normalized: str


_TERM_FIELDS = {
    "color": AttributeKind.COLOR,
    "material": AttributeKind.MATERIAL,
    "texture": AttributeKind.TEXTURE,
    "fur": AttributeKind.FUR,
    "collar": AttributeKind.COLLAR,
}

# For each kind of word: its table, how to narrow it to its kind, and which
# models use a word of it. "In use" means by a model not merged.
_CONCEPT_USERS = (
    "SELECT v.id, v.status, v.merged_into_id FROM product_family f "
    "JOIN product_variant v ON v.product_family_id = f.id "
    "WHERE f.canonical_concept_id = w.id"
)
_SOURCE_USERS = (
    "SELECT v.id, v.status, v.merged_into_id FROM product_family f "
    "JOIN product_variant v ON v.product_family_id = f.id "
    "WHERE f.source_identity_id = w.id"
)


def _term_users(field: str) -> str:
    # `field` is one of `_TERM_FIELDS`, never a caller's text.
    return f"SELECT v.id, v.status, v.merged_into_id FROM product_variant v WHERE v.{field}_term_id = w.id"  # noqa: S608, E501


async def _words_like(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    word: TypedWord,
    ignore: frozenset[uuid.UUID],
) -> list[dict[str, Any]]:
    """Every word of the same kind that folds like this one, with the models
    using it: `(spelling, normalized, live users, merged users' survivors)`.
    Models in `ignore`, and models merged into them, are not counted."""
    if word.field == "concept":
        table, kind_filter, users = "canonical_concept", "", _CONCEPT_USERS
    elif word.field == "source":
        table, kind_filter, users = "source_identity", "", _SOURCE_USERS
    else:
        table = "attribute_term"
        kind_filter = f"AND w.kind = '{_TERM_FIELDS[word.field].value}'"
        users = _term_users(word.field)
    statement = text(
        f"""
        SELECT w.name, w.normalized_name AS normalized,
          ARRAY(SELECT u.id FROM ({users}) u WHERE u.status <> 'MERGED'
                AND u.id <> ALL(CAST(:ignore AS uuid[]))
                ORDER BY u.id LIMIT 5) AS live,
          ARRAY(SELECT DISTINCT u.merged_into_id FROM ({users}) u
                WHERE u.status = 'MERGED'
                AND u.merged_into_id <> ALL(CAST(:ignore AS uuid[]))) AS merged_into
        FROM {table} w
        WHERE w.organization_id = :org {kind_filter}
          AND {_FOLD_SQL.format(column="w.normalized_name")} = :folded
        ORDER BY w.normalized_name
        """  # noqa: S608 — fixed internal names; every value is bound.
    )
    rows = await session.execute(
        statement,
        {"org": organization_id, "folded": fold(word.normalized), "ignore": sorted(ignore)},
    )
    return [dict(row) for row in rows.mappings()]


async def similar_words(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    words: list[TypedWord],
    ignore: frozenset[uuid.UUID] = frozenset(),
) -> list[dict[str, Any]]:
    """What a person should see before a name that looks like another is used.

    A word is reported when another spelling folds the same and is used by a
    model not merged, or when the word itself is used only by merged models:
    the typo a merge left behind. Each report names the spelling in use and a
    few models, so the person can take one.

    `ignore` names the model a rename corrects: the typo being fixed is its
    own, and the name a duplicate merged into it left is its own to take.
    """
    reports: list[dict[str, Any]] = []
    for word in words:
        found = await _words_like(
            session, organization_id=organization_id, word=word, ignore=ignore
        )
        own = next((row for row in found if row["normalized"] == word.normalized), None)
        others = [row for row in found if row["normalized"] != word.normalized and row["live"]]
        left_by_merge = own is not None and not own["live"] and bool(own["merged_into"])
        if not others and not left_by_merge:
            continue
        model_ids: list[uuid.UUID] = []
        for row in others:
            model_ids.extend(row["live"])
        if left_by_merge and own is not None:
            model_ids.extend(own["merged_into"])
        reports.append(
            {
                "field": word.field,
                "typed": word.name,
                "existing": [row["name"] for row in others],
                "left_by_merge": left_by_merge,
                "model_ids": list(dict.fromkeys(model_ids))[:5],
            }
        )
    return reports


async def refuse_similar(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    words: list[TypedWord],
    ignore: frozenset[uuid.UUID] = frozenset(),
) -> None:
    """Refuse once with `CATALOG_SIMILAR` when any typed word looks like another."""
    reports = await similar_words(
        session, organization_id=organization_id, words=words, ignore=ignore
    )
    if not reports:
        return
    all_ids = [model_id for report in reports for model_id in report["model_ids"]]
    leading = await current_variants(session, organization_id=organization_id, variant_ids=all_ids)
    names = await describe_variants(session, list(set(leading.values())))
    similar = []
    for report in reports:
        models = list(dict.fromkeys(leading[model_id] for model_id in report["model_ids"]))
        similar.append(
            {
                "field": report["field"],
                "typed": report["typed"],
                "existing": report["existing"],
                "left_by_merge": report["left_by_merge"],
                "models": [
                    {"product_variant_id": str(model), "display_name": names[model].display_name}
                    for model in models
                    if model in names
                ],
            }
        )
    raise CatalogSimilarError(similar=similar)


__all__ = ["TypedWord", "fold", "refuse_similar", "similar_words"]
