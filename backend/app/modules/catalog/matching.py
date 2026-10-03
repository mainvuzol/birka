"""Bounded advisory matching. Never persists decisions or resolves product identity.

The fingerprint identifies preview evidence; the durable knowledge revision
invalidates it when organization catalog inputs change. Scores are lexical
similarities, not calibrated probabilities.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationFailedError
from app.core.text import is_storable
from app.modules.catalog.parser import ParsePreview, parse_catalog_line

MATCHER_VERSION = "1.0.0-preview"
_POOL_LIMIT = 200
_TERMS = ("color", "material", "texture", "fur", "collar")


@dataclass(frozen=True)
class MatchPreview:
    decision_type: str
    parser_preview: dict[str, object]
    candidates: list[dict[str, Any]]
    knowledge_fingerprint: str
    knowledge_revision: int
    margin: str | None
    review_reasons: list[str]
    truncated: bool
    matcher_version: str = MATCHER_VERSION
    requires_confirmation: bool = True
    resolved_variant_id: None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_type": self.decision_type,
            "parser_preview": self.parser_preview,
            "parser_version": self.parser_preview["parser_version"],
            "raw_text": self.parser_preview["raw_text"],
            "candidates": self.candidates,
            "knowledge_fingerprint": self.knowledge_fingerprint,
            "knowledge_revision": self.knowledge_revision,
            "margin": self.margin,
            "review_reasons": self.review_reasons,
            "truncated": self.truncated,
            "matcher_version": self.matcher_version,
            "requires_confirmation": self.requires_confirmation,
            "resolved_variant_id": self.resolved_variant_id,
        }


def _normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def _context(value: str | None, maximum: int = 120) -> str | None:
    if value is None:
        return None
    if not value.strip() or len(value) > maximum or not is_storable(value):
        raise ValidationFailedError(f"Context names must contain 1..{maximum} storable characters")
    return _normalized(value)


# All joined labels must belong to the same tenant, including nullable links.
# A single SQL statement keeps candidates and context existence on one MVCC snapshot.
_TERM_COLUMNS = ", ".join(f"t_{name}.name AS {name}" for name in _TERMS)
_TERM_JOINS = "\n".join(
    f"LEFT JOIN attribute_term t_{name} ON t_{name}.id = v.{name}_term_id "
    f"AND t_{name}.organization_id = :org AND t_{name}.kind = '{name.upper()}'"
    for name in _TERMS
)
_TERM_GUARDS = " AND ".join(
    f"(v.{name}_term_id IS NULL OR t_{name}.id IS NOT NULL)" for name in _TERMS
)
_QUERY = text(f"""
WITH labels AS (
 SELECT v.id AS variant_id, v.merged_into_id, f.id AS family_id, c.name AS concept,
        s.name AS source, g.name AS garment_type,
        bc.name AS category, f.distinction_note,
        v.status AS variant_status, f.status AS family_status, c.status AS concept_status,
        v.length_cm, v.attributes, {_TERM_COLUMNS},
        (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id,
                  'target_type', a.target_type, 'target_id', a.target_id,
                  'confirm_count', a.confirm_count, 'reject_count', a.reject_count)
                  ORDER BY a.id), '[]'::jsonb)
         FROM product_alias a WHERE a.organization_id = :org
           AND a.status = 'VERIFIED' AND a.normalized_phrase = :query
           AND ((a.target_type = 'VARIANT' AND a.target_id = v.id)
             OR (a.target_type = 'FAMILY' AND a.target_id = f.id)
             OR (a.target_type = 'CONCEPT' AND a.target_id = c.id))) AS aliases
 FROM product_variant v
 JOIN product_family f ON f.id = v.product_family_id AND f.organization_id = :org
 JOIN canonical_concept c ON c.id = f.canonical_concept_id AND c.organization_id = :org
 LEFT JOIN source_identity s ON s.id = f.source_identity_id AND s.organization_id = :org
 LEFT JOIN garment_type g ON g.id = f.garment_type_id AND g.organization_id = :org
 LEFT JOIN business_category bc ON bc.id = c.business_category_id AND bc.organization_id = :org
 {_TERM_JOINS}
 -- A merged model's family may be merged too, once the merge emptied it;
 -- its name still leads to the model that stays.
 WHERE (v.status = 'MERGED' OR (f.status <> 'MERGED' AND c.status <> 'MERGED'))
   AND (f.source_identity_id IS NULL OR s.id IS NOT NULL)
   AND (f.garment_type_id IS NULL OR g.id IS NOT NULL)
   AND (c.business_category_id IS NULL OR bc.id IS NOT NULL)
   AND {_TERM_GUARDS}
), named AS (
 SELECT *, concat_ws(' ', concept, source, color, material, texture, fur, collar,
         CASE WHEN length_cm IS NOT NULL THEN trim(trailing '.' FROM
           trim(trailing '0' FROM length_cm::text)) || ' см' END) AS display_name
 FROM labels
), scored AS (
 SELECT *, similarity(lower(display_name), :query) AS own_score,
        lower(regexp_replace(trim(display_name), '\\s+', ' ', 'g')) = :query AS own_exact
 FROM named
), formers AS (
 -- A merged model's name, and a learned alias naming it, lead to the model
 -- that stays (ADR-0008 §5). Alias rows are human evidence: read, not moved.
 SELECT m.merged_into_id AS variant_id, max(m.own_score) AS score,
        bool_or(m.own_exact) AS exact,
        coalesce(jsonb_agg(alias) FILTER (WHERE alias IS NOT NULL), '[]'::jsonb) AS aliases
 FROM scored m
 LEFT JOIN LATERAL jsonb_array_elements(m.aliases) alias
   ON alias->>'target_type' = 'VARIANT'
 WHERE m.variant_status = 'MERGED'
 GROUP BY m.merged_into_id
), ranked AS (
 SELECT n.*, greatest(n.own_score, coalesce(fm.score, 0)) AS lexical_score,
        n.own_exact OR coalesce(fm.exact, false) AS exact_name,
        jsonb_array_length(n.aliases) > 0
          OR coalesce(jsonb_array_length(fm.aliases), 0) > 0 AS verified_alias
 FROM scored n LEFT JOIN formers fm ON fm.variant_id = n.variant_id
 -- A retired model is no longer offered (owner decision, 2026-10-03).
 WHERE n.variant_status NOT IN ('MERGED', 'RETIRED')
   AND (CAST(:family AS uuid) IS NULL OR n.family_id = CAST(:family AS uuid))
), pool AS (
 SELECT * FROM ranked ORDER BY verified_alias DESC, exact_name DESC,
 lexical_score DESC, variant_id LIMIT 201
)
SELECT coalesce((SELECT jsonb_agg(to_jsonb(pool) ORDER BY verified_alias DESC,
          exact_name DESC, lexical_score DESC, variant_id) FROM pool), '[]'::jsonb) AS rows,
 EXISTS(SELECT 1 FROM product_family WHERE organization_id = :org
        AND id = CAST(:family AS uuid) AND status <> 'MERGED') AS family_exists,
 EXISTS(SELECT 1 FROM canonical_concept WHERE organization_id = :org
        AND normalized_name = :concept) AS concept_exists,
 EXISTS(SELECT 1 FROM business_category WHERE organization_id = :org
        AND normalized_name = :category) AS category_exists,
 (SELECT revision FROM catalog_knowledge_revision WHERE organization_id = :org)
        AS knowledge_revision
""")  # noqa: S608 — fixed internal column names; all input values are bound.


def _explicit(parsed: ParsePreview, field: str) -> str | None:
    values = parsed.fields.get(field, ())
    if len(values) == 1 and values[0].confidence == "EXPLICIT":
        return values[0].value
    return None


def _catalog_value(value: str, field: str) -> str | None:
    parsed = parse_catalog_line(value)
    extracted = _explicit(parsed, field)
    if extracted is not None:
        return extracted
    # Unrecognized shop labels may be synonyms: absence of vocabulary evidence
    # is UNKNOWN, never a contradiction justifying a new variant.
    canonical = {
        "color": {
            "black",
            "white",
            "chocolate",
            "burgundy",
            "milk",
            "graphite",
            "beige",
            "peach",
            "butter",
            "whiskey",
            "walnut",
        },
        "material": {"suede", "wool"},
        "texture": {"grained", "smooth"},
        "fur": {"fox", "mink"},
        "collar": {"stand"},
        "garment_type": {
            "jacket",
            "bomber",
            "parka",
            "down_jacket",
            "shearling_coat",
            "fur_coat",
            "blazer",
            "coat",
            "biker_jacket",
        },
        "hood": {"present", "absent"},
        "pockets": {"patch"},
    }
    normalized = _normalized(value)
    return normalized if normalized in canonical.get(field, set()) else None


def _candidate(row: dict[str, Any], parsed: ParsePreview) -> dict[str, Any]:
    conflicts: list[str] = []
    scores: dict[str, str] = {}
    for field in (*_TERMS, "garment_type", "length_cm", "hood", "pockets"):
        wanted = _explicit(parsed, field)
        if wanted is None:
            continue
        actual = row.get(field)
        if field in ("hood", "pockets"):
            actual = row["attributes"].get(field)
        if actual is None:
            scores[field] = "UNKNOWN"
            continue
        if field == "length_cm":
            matches = Decimal(str(actual)) == Decimal(wanted)
        else:
            actual_value = _catalog_value(str(actual), field)
            if actual_value is None:
                scores[field] = "UNKNOWN"
                continue
            matches = actual_value == wanted
        scores[field] = "MATCH" if matches else "CONFLICT"
        if not matches:
            conflicts.append(field)
    reasons: list[str] = []
    if row["verified_alias"]:
        reasons.append("VERIFIED_ALIAS")
    if row["exact_name"]:
        reasons.append("EXACT_DISPLAY_NAME")
    if not reasons:
        reasons.append("LEXICAL_CANDIDATE")
    if any(row[key] != "ACTIVE" for key in ("variant_status", "family_status", "concept_status")):
        conflicts.append("ENTITY_NEEDS_REVIEW")
    return {
        "variant_id": row["variant_id"],
        "family_id": row["family_id"],
        "display_name": row["display_name"],
        "score": format(Decimal(str(row["lexical_score"])).quantize(Decimal("0.000001")), "f"),
        "field_scores": scores,
        "conflicts": conflicts,
        "reasons": reasons,
        "distinction_note": row["distinction_note"],
    }


async def preview_match(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    raw_text: str,
    family_id: uuid.UUID | None = None,
    concept_name: str | None = None,
    business_category_name: str | None = None,
    limit: int = 10,
) -> MatchPreview:
    """Return confirmation-only proposals. Caller enforces store permissions."""
    if not 1 <= limit <= 20:
        raise ValidationFailedError("Candidate limit must be between 1 and 20")
    try:
        parsed = parse_catalog_line(raw_text)
    except ValueError as exc:
        raise ValidationFailedError(str(exc)) from exc
    concept = _context(concept_name, maximum=200)
    category = _context(business_category_name)
    snapshot = dict(
        (
            await session.execute(
                _QUERY,
                {
                    "org": organization_id,
                    "query": parsed.normalized_text,
                    "family": family_id,
                    "concept": concept,
                    "category": category,
                },
            )
        )
        .mappings()
        .one()
    )
    if snapshot["knowledge_revision"] is None:
        raise NotFoundError("Catalog knowledge revision not found")
    if family_id is not None and not snapshot["family_exists"]:
        raise NotFoundError("Unknown product family")
    rows = snapshot["rows"]
    truncated = len(rows) > _POOL_LIMIT
    candidates = [_candidate(row, parsed) for row in rows[:_POOL_LIMIT]]
    for row, candidate in zip(rows, candidates, strict=False):
        if concept is not None and _normalized(row["concept"]) != concept:
            candidate["conflicts"].append("concept_context")
            candidate["field_scores"]["concept_context"] = "CONFLICT"
        if category is not None and (
            row["category"] is None or _normalized(row["category"]) != category
        ):
            candidate["conflicts"].append("category_context")
            candidate["field_scores"]["category_context"] = "CONFLICT"
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "organization_id": str(organization_id),
                "snapshot": snapshot,
                "context": {"family_id": str(family_id), "concept": concept, "category": category},
            },
            sort_keys=True,
            ensure_ascii=False,
            default=str,
        ).encode()
    ).hexdigest()
    reasons = list(parsed.review_reasons)
    reasons.append("HUMAN_CONFIRMATION_REQUIRED")
    decision = "AMBIGUOUS"
    strong = [
        candidate
        for candidate in candidates
        if any(
            reason in candidate["reasons"] for reason in ("VERIFIED_ALIAS", "EXACT_DISPLAY_NAME")
        )
    ]
    blocking_parse = set(parsed.review_reasons) - {
        "UNCLASSIFIED_DESCRIPTORS",
        "NO_RECOGNIZED_FIELDS",
    }
    if truncated:
        reasons.append("CANDIDATE_POOL_TRUNCATED")
    elif blocking_parse:
        reasons.append("AMBIGUOUS_PARSE_EVIDENCE")
    elif len(strong) == 1 and not strong[0]["conflicts"]:
        decision = "SAME_VARIANT"
    elif strong:
        reasons.append("CONFLICTING_OR_MULTIPLE_EXACT_CANDIDATES")
    elif (
        family_id is not None
        and candidates
        and not any(
            set(candidate["conflicts"])
            & {"concept_context", "category_context", "ENTITY_NEEDS_REVIEW"}
            for candidate in candidates
        )
        and all(
            any(field in candidate["conflicts"] for field in (*_TERMS, "length_cm"))
            for candidate in candidates
        )
    ):
        decision = "NEW_VARIANT"
        reasons.append("SELECTED_FAMILY_ATTRIBUTE_DIFFERENCE_REQUIRES_REVIEW")
    elif category is not None and not snapshot["category_exists"] and family_id is None:
        decision = "NEW_CATEGORY"
        reasons.append("EXPLICIT_NEW_CATEGORY_REQUIRES_REVIEW")
    elif concept is not None and not snapshot["concept_exists"] and family_id is None:
        decision = "NEW_MODEL"
        reasons.append("EXPLICIT_NEW_CONCEPT_REQUIRES_REVIEW")
    else:
        reasons.append("IDENTITY_NOT_ESTABLISHED")
    if any(candidate["conflicts"] for candidate in candidates):
        reasons.append("STRUCTURED_CONFLICTS_PRESENT")
    margin = None
    if len(candidates) >= 2:
        # Evidence tiers precede lexical rank, so a negative lexical gap is valid.
        margin = str(Decimal(candidates[0]["score"]) - Decimal(candidates[1]["score"]))
    return MatchPreview(
        decision,
        parsed.to_dict(),
        candidates[:limit],
        fingerprint,
        int(snapshot["knowledge_revision"]),
        margin,
        sorted(set(reasons)),
        truncated,
    )


async def duplicate_family_signatures(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """List potential duplicates; shared nullable signatures never imply a merge."""
    if not 1 <= limit <= 100 or not 0 <= offset <= 10000:
        raise ValidationFailedError("Invalid report pagination")
    rows = (
        (
            await session.execute(
                text("""
      WITH ranked AS (
        SELECT f.*, count(*) OVER signature AS signature_count,
               row_number() OVER (signature ORDER BY f.id) AS position
        FROM product_family f
        JOIN canonical_concept c ON c.id = f.canonical_concept_id AND c.organization_id = :org
        LEFT JOIN source_identity s ON s.id = f.source_identity_id AND s.organization_id = :org
        LEFT JOIN garment_type g ON g.id = f.garment_type_id AND g.organization_id = :org
        WHERE f.organization_id = :org AND f.status <> 'MERGED' AND c.status <> 'MERGED'
          AND (f.source_identity_id IS NULL OR s.id IS NOT NULL)
          AND (f.garment_type_id IS NULL OR g.id IS NOT NULL)
        WINDOW signature AS (PARTITION BY f.canonical_concept_id,
                             f.source_identity_id, f.garment_type_id)
      )
      SELECT canonical_concept_id, source_identity_id, garment_type_id,
             max(signature_count) AS family_count, max(signature_count) > 100 AS families_truncated,
             jsonb_agg(jsonb_build_object('family_id', id,
               'distinction_note', distinction_note) ORDER BY id) AS families
      FROM ranked WHERE position <= 100 AND signature_count > 1
      GROUP BY canonical_concept_id, source_identity_id, garment_type_id
      ORDER BY canonical_concept_id, source_identity_id NULLS FIRST, garment_type_id NULLS FIRST
      LIMIT :limit OFFSET :offset
    """),
                {"org": organization_id, "limit": limit + 1, "offset": offset},
            )
        )
        .mappings()
        .all()
    )
    return {
        "groups": [dict(row) for row in rows[:limit]],
        "has_more": len(rows) > limit,
        "requires_confirmation": True,
    }
