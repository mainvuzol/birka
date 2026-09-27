"""Reproducible, rollback-only matcher regression evaluation on synthetic identities.

Run from backend: python -m scripts.evaluate_catalog --output /tmp/catalog-eval.json
Only BIRKA_TEST_DATABASE_URL databases named birka_test or birka_catalog_eval are
accepted. No score is interpreted as a calibrated probability or promotion gate.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import uuid
from decimal import Decimal
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.modules.catalog.evidence import AliasStatus, AliasTargetType, ProductAlias
from app.modules.catalog.matching import MATCHER_VERSION, preview_match
from app.modules.catalog.models import (
    AttributeKind,
    AttributeTerm,
    BusinessCategory,
    CanonicalConcept,
    GarmentType,
    ProductFamily,
    ProductVariant,
    SourceIdentity,
)
from app.modules.catalog.parser import PARSER_VERSION, parse_catalog_line
from app.modules.tenancy.models import Organization

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
DEFAULT_DATASET = FIXTURES / "catalog_match_eval_v1.json"
REAL_ROWS = FIXTURES / "catalog_store_rows_v1.json"
ALLOWED_DATABASES = frozenset({"birka_test", "birka_catalog_eval"})
NAMESPACE = uuid.UUID("ea39779d-90e1-4a8c-94a7-8b68c5b51bf3")
Decision = Literal["SAME_VARIANT", "NEW_VARIANT", "NEW_MODEL", "NEW_CATEGORY", "AMBIGUOUS"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Product(StrictModel):
    key: str
    concept: str
    family: str | None = None
    source: str | None = None
    business_category: str | None = None
    garment_type: str | None = None
    color: str | None = None
    material: str | None = None
    texture: str | None = None
    fur: str | None = None
    collar: str | None = None
    length_cm: Decimal | None = Field(default=None, gt=0)
    new_model: bool = False
    distinction_note: str | None = None


class Alias(StrictModel):
    phrase: str
    target: str
    status: AliasStatus


class Case(StrictModel):
    id: str
    raw_text: str
    expected_decision: Decision
    target: str | None = None
    family: str | None = None
    concept_name: str | None = None
    business_category_name: str | None = None
    expected_conflicts: dict[str, list[str]] = Field(default_factory=dict)


class Dataset(StrictModel):
    version: str
    provenance: str
    products: list[Product]
    aliases: list[Alias] = Field(default_factory=list)
    cases: list[Case]

    @model_validator(mode="after")
    def references(self) -> Dataset:
        keys = {p.key for p in self.products}
        if len(keys) != len(self.products) or len({c.id for c in self.cases}) != len(self.cases):
            raise ValueError("Product keys and case IDs must be unique")
        seen: set[str] = set()
        products = {product.key: product for product in self.products}
        classifications: dict[str, tuple[str | None, str | None]] = {}
        for product in self.products:
            if product.family is not None and product.family not in seen:
                raise ValueError("Product family must reference an earlier product")
            if product.new_model and (
                not product.distinction_note or not product.distinction_note.strip()
            ):
                raise ValueError("A declared new model requires a distinction note")
            classification = tuple(
                _normalized(value) if value else None
                for value in (product.business_category, product.garment_type)
            )
            concept = _normalized(product.concept)
            previous = classifications.get(concept)
            if previous is not None and previous != classification:
                raise ValueError("Shared concept classification must be consistent")
            classifications[concept] = (classification[0], classification[1])
            if product.family:
                parent = products[product.family]
                for name in (
                    "concept",
                    "source",
                    "garment_type",
                    "business_category",
                    "distinction_note",
                ):
                    value, expected = getattr(product, name), getattr(parent, name)
                    if value is not None and _normalized(value) != _normalized(expected or ""):
                        raise ValueError("Family reference identity must match its declared family")
                if product.new_model:
                    raise ValueError("An existing family cannot declare a new model")
            seen.add(product.key)
        for alias in self.aliases:
            if alias.target not in keys:
                raise ValueError("Alias target must name a fixture product")
        for case in self.cases:
            references = [case.target, case.family, *case.expected_conflicts]
            if any(key is not None and key not in keys for key in references):
                raise ValueError("Case references unknown fixture product")
            if case.expected_decision == "SAME_VARIANT" and case.target is None:
                raise ValueError("SAME_VARIANT requires an expected identity target")
        return self


ParserField = Literal[
    "color",
    "concept",
    "garment_type",
    "hood",
    "length_cm",
    "material",
    "price",
    "quantity",
    "size",
    "texture",
    "fur",
    "collar",
    "pockets",
]


class ParserRow(StrictModel):
    id: str
    raw_text: str
    expected_candidates: dict[ParserField, list[str]] = Field(default_factory=dict)
    absent_fields: list[ParserField] = Field(default_factory=list)
    must_preserve_unknown: list[str] = Field(default_factory=list)


class ParserCorpus(StrictModel):
    corpus_version: str
    provenance: str
    rows: list[ParserRow] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_ids(self) -> ParserCorpus:
        if len({row.id for row in self.rows}) != len(self.rows):
            raise ValueError("Parser row IDs must be unique")
        return self


def _id(key: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, key)


def _normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def _rate(numerator: int, denominator: int) -> str | None:
    return (
        str((Decimal(numerator) / denominator).quantize(Decimal("0.000001")))
        if denominator
        else None
    )


async def _seed(
    session: AsyncSession, dataset: Dataset
) -> tuple[uuid.UUID, dict[str, uuid.UUID], dict[str, uuid.UUID]]:
    org_id = _id("organization")
    session.add(Organization(id=org_id, name="Catalog evaluation (synthetic)", currency_code="UAH"))
    await session.flush()
    labels: dict[tuple[str, str], uuid.UUID] = {}

    async def label(
        model: Any, value: str | None, *, kind: AttributeKind | None = None
    ) -> uuid.UUID | None:
        if value is None:
            return None
        normalized = _normalized(value)
        key = (model.__tablename__ + (kind.value if kind else ""), normalized)
        if key not in labels:
            identifier = _id("label:" + repr(key))
            values: dict[str, Any] = {
                "id": identifier,
                "organization_id": org_id,
                "name": value,
                "normalized_name": normalized,
            }
            if kind:
                values["kind"] = kind
            session.add(model(**values))
            await session.flush()
            labels[key] = identifier
        return labels[key]

    families: dict[str, uuid.UUID] = {}
    variants: dict[str, uuid.UUID] = {}
    for product in dataset.products:
        concept_id = await label(CanonicalConcept, product.concept)
        concept = await session.get(CanonicalConcept, concept_id)
        assert concept is not None
        category_id = await label(BusinessCategory, product.business_category)
        garment_id = await label(GarmentType, product.garment_type)
        if category_id is not None:
            concept.business_category_id = category_id
        if garment_id is not None:
            concept.garment_type_id = garment_id
        if product.family:
            family_id = families[product.family]
        else:
            family_id = _id("family:" + product.key)
            source_id = await label(SourceIdentity, product.source)
            session.add(
                ProductFamily(
                    id=family_id,
                    organization_id=org_id,
                    canonical_concept_id=concept_id,
                    source_identity_id=source_id,
                    garment_type_id=garment_id,
                    distinction_note=product.distinction_note,
                )
            )
            await session.flush()
        fields: dict[str, Any] = {}
        for name in ("color", "material", "texture", "fur", "collar"):
            fields[name + "_term_id"] = await label(
                AttributeTerm, getattr(product, name), kind=AttributeKind(name.upper())
            )
        variant_id = _id("variant:" + product.key)
        session.add(
            ProductVariant(
                id=variant_id, product_family_id=family_id, length_cm=product.length_cm, **fields
            )
        )
        await session.flush()
        families[product.key], variants[product.key] = family_id, variant_id
    for index, alias in enumerate(dataset.aliases):
        session.add(
            ProductAlias(
                id=_id(f"alias:{index}"),
                organization_id=org_id,
                normalized_phrase=_normalized(alias.phrase),
                target_type=AliasTargetType.VARIANT,
                target_id=variants[alias.target],
                status=alias.status,
            )
        )
    await session.flush()
    return org_id, families, variants


def parser_report(path: Path = REAL_ROWS) -> dict[str, Any]:
    content = path.read_bytes()
    corpus = ParserCorpus.model_validate_json(content).model_dump()
    assertions = passed = preserved = annotated_rows = 0
    failures: list[dict[str, Any]] = []
    for row in corpus["rows"]:
        parsed = parse_catalog_line(row["raw_text"])
        preserved += parsed.raw_text == row["raw_text"]
        checks: list[tuple[str, bool]] = []
        for name, expected in row.get("expected_candidates", {}).items():
            checks.append(
                (
                    "expected_candidates." + name,
                    {c.value for c in parsed.fields.get(name, ())} == set(expected),
                )
            )
        for name in row.get("absent_fields", []):
            checks.append(("absent_fields." + name, not parsed.fields.get(name)))
        for value in row.get("must_preserve_unknown", []):
            checks.append(
                (
                    "must_preserve_unknown:" + value,
                    value in [part.text for part in parsed.unclassified_descriptors],
                )
            )
        annotated_rows += bool(checks)
        assertions += len(checks)
        passed += sum(valid for _, valid in checks)
        failed = [label for label, valid in checks if not valid]
        if parsed.raw_text != row["raw_text"]:
            failed.append("raw_preservation")
        if failed:
            failures.append({"id": row["id"], "failed_assertions": failed})
    return {
        "corpus_version": corpus["corpus_version"],
        "dataset_sha256": hashlib.sha256(content).hexdigest(),
        "provenance": corpus["provenance"],
        "rows": len(corpus["rows"]),
        "identity_labeled_rows": 0,
        "excluded_from_identity_metrics": len(corpus["rows"]),
        "annotated_rows": annotated_rows,
        "unannotated_rows": len(corpus["rows"]) - annotated_rows,
        "assertions": assertions,
        "passed_assertions": passed,
        "assertion_accuracy": _rate(passed, assertions),
        "raw_preserved_rows": preserved,
        "failures": failures,
        "limitation": "Partial extraction expectations only; no reviewed product identity labels.",
    }


async def evaluate_catalog(
    session: AsyncSession, dataset_path: Path = DEFAULT_DATASET
) -> dict[str, Any]:
    """Seed under a savepoint and roll back every evaluation write, even on error."""
    database = await session.scalar(text("SELECT current_database()"))
    if database not in ALLOWED_DATABASES:
        raise ValueError("Catalog evaluation requires birka_test or birka_catalog_eval")
    database_metadata = dict(
        (
            await session.execute(
                text(
                    "SELECT current_setting('server_version') AS postgres_version, "
                    "datcollate AS collation, datctype AS character_classification, "
                    "pg_encoding_to_char(encoding) AS encoding "
                    "FROM pg_database WHERE datname = current_database()"
                )
            )
        )
        .mappings()
        .one()
    )
    content = dataset_path.read_bytes()
    dataset = Dataset.model_validate_json(content)
    transaction = await session.begin_nested()
    try:
        organization, families, variants = await _seed(session, dataset)
        expected_targets = retrieved = correct = same = unsafe = reviews = 0
        failures: list[dict[str, Any]] = []
        outcomes: list[dict[str, Any]] = []
        classes = {
            name: {"expected_count": 0, "correct_count": 0}
            for name in ("SAME_VARIANT", "NEW_VARIANT", "NEW_MODEL", "NEW_CATEGORY", "AMBIGUOUS")
        }
        if not dataset.cases:
            failures.append({"id": "dataset", "reasons": ["EMPTY_CASES"]})
        for case in dataset.cases:
            result = (
                await preview_match(
                    session,
                    organization_id=organization,
                    raw_text=case.raw_text,
                    family_id=families.get(case.family) if case.family else None,
                    concept_name=case.concept_name,
                    business_category_name=case.business_category_name,
                    limit=10,
                )
            ).to_dict()
            candidates = result["candidates"]
            reasons: list[str] = []
            by_id = {c["variant_id"]: c for c in candidates}
            target_id = str(variants[case.target]) if case.target else None
            if target_id:
                expected_targets += 1
                retrieved += target_id in by_id
                if target_id not in by_id:
                    reasons.append("TARGET_NOT_RETRIEVED")
            matched = result["decision_type"] == case.expected_decision
            correct += matched
            classes[case.expected_decision]["expected_count"] += 1
            classes[case.expected_decision]["correct_count"] += matched
            if not matched:
                reasons.append("DECISION_MISMATCH")
            for key, conflicts in case.expected_conflicts.items():
                candidate = by_id.get(str(variants[key]))
                if candidate is None or not set(conflicts).issubset(candidate["conflicts"]):
                    reasons.append("EXPECTED_CONFLICT_MISSING:" + key)
            needs_review = (
                result["requires_confirmation"] is True and result["resolved_variant_id"] is None
            )
            reviews += needs_review
            if not needs_review:
                reasons.append("CONFIRMATION_REQUIREMENT_LOWERED")
            is_same = result["decision_type"] == "SAME_VARIANT"
            same += is_same
            bad_same = is_same and (
                case.expected_decision != "SAME_VARIANT"
                or not candidates
                or candidates[0]["variant_id"] != target_id
                or bool(candidates[0]["conflicts"])
            )
            unsafe += bad_same
            if bad_same:
                reasons.append("UNSAFE_SAME_VARIANT_SUGGESTION")
            if result["truncated"]:
                reasons.append("CANDIDATE_POOL_TRUNCATED")
            if reasons:
                failures.append({"id": case.id, "reasons": reasons})
            outcomes.append(
                {
                    "id": case.id,
                    "expected_decision": case.expected_decision,
                    "actual_decision": result["decision_type"],
                    "candidate_keys": [
                        key
                        for c in candidates
                        for key, identifier in variants.items()
                        if str(identifier) == c["variant_id"]
                    ],
                    "requires_confirmation": result["requires_confirmation"],
                }
            )
        real = parser_report()
        return {
            "report_version": "1.0.0",
            "database": database_metadata,
            "dataset_version": dataset.version,
            "dataset_sha256": hashlib.sha256(content).hexdigest(),
            "provenance": dataset.provenance,
            "matcher_version": MATCHER_VERSION,
            "parser_version": PARSER_VERSION,
            "synthetic_identity": {
                "cases": len(dataset.cases),
                "target_cases": expected_targets,
                "retrieved_targets_at_10": retrieved,
                "retrieval_recall_at_10": _rate(retrieved, expected_targets),
                "correct_decisions": correct,
                "decision_accuracy": _rate(correct, len(dataset.cases)),
                "same_variant_suggestions": same,
                "unsafe_same_variant_suggestions": unsafe,
                "unsafe_same_suggestion_rate": _rate(unsafe, same),
                "human_review_cases": reviews,
                "human_review_rate": _rate(reviews, len(dataset.cases)),
                "by_expected_decision": {
                    name: {
                        **counts,
                        "accuracy": _rate(counts["correct_count"], counts["expected_count"]),
                    }
                    for name, counts in classes.items()
                },
                "cases_results": outcomes,
                "failures": failures,
            },
            "real_store_extraction": real,
            "gates_passed": not failures and not real["failures"],
            "promotion_ready": False,
            "owner_reviewed_heldout_identity_samples": 0,
            "owner_reviewed_heldout_identity_precision": None,
            "limitations": [
                "Synthetic identities are not owner-reviewed held-out production identities.",
                "Unsafe SAME suggestions are not actual merges; "
                "human confirmation remains required.",
                "Scores are not calibrated probabilities; "
                "thresholds and promotion policies remain unchanged.",
            ],
        }
    finally:
        await transaction.rollback()


async def _run(output: Path) -> int:
    database_url = os.environ.get("BIRKA_TEST_DATABASE_URL", "")
    if (
        not database_url
        or make_url(database_url).database not in ALLOWED_DATABASES
        or make_url(database_url).host not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise ValueError(
            "Set BIRKA_TEST_DATABASE_URL to a localhost birka_test or birka_catalog_eval"
        )
    engine = create_async_engine(database_url)
    try:
        async with async_sessionmaker(engine)() as session:
            report = await evaluate_catalog(session)
            await session.rollback()
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        return 0 if report["gates_passed"] else 1
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return asyncio.run(_run(args.output))


if __name__ == "__main__":
    raise SystemExit(main())
