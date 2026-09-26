"""Raw input, parsing, aliases and matching decisions.

Two separations matter here and are easy to lose in a refactor:

* **Evidence vs interpretation.** `RawInput` is what a human actually typed and
  is never rewritten (invariant I10, enforced by a database trigger). Its
  processing state lives in a separate mutable row, because a `status` column
  on an append-only table is a contradiction.
* **Parsing vs learning** (§4.7 of the plan, invariant I21). A `ParseResult` is
  a pure function of `(raw_text, parser_version)` — the parser reads no catalog
  state. Everything learned enters at `CatalogMatchDecision`, which records the
  matcher version *and* the catalog knowledge revision it saw, so an old
  decision stays explainable after the catalog has moved on.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UpdatedAtMixin, UUIDPrimaryKey


class RawInputSource(StrEnum):
    MANUAL_ENTRY = "MANUAL_ENTRY"
    BOT_MESSAGE = "BOT_MESSAGE"
    SNAPSHOT_IMPORT = "SNAPSHOT_IMPORT"
    API = "API"


class ProcessingStatus(StrEnum):
    """Lifecycle of one raw line.

    PENDING --parse ok--------> PARSED --applied--> RESOLVED
       |                          |
       |                          +--low confidence--> AMBIGUOUS --human--> RESOLVED
       +--parser raised---------> FAILED --retry--> PENDING
    """

    PENDING = "PENDING"
    PARSED = "PARSED"
    AMBIGUOUS = "AMBIGUOUS"
    FAILED = "FAILED"
    RESOLVED = "RESOLVED"


class AliasStatus(StrEnum):
    """Promotion is derived from evidence counts, never hand-set."""

    NEW = "NEW"
    LEARNING = "LEARNING"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    AMBIGUOUS = "AMBIGUOUS"


class AliasTargetType(StrEnum):
    CONCEPT = "CONCEPT"
    FAMILY = "FAMILY"
    VARIANT = "VARIANT"
    ATTRIBUTE_TERM = "ATTRIBUTE_TERM"
    SIZE = "SIZE"
    SOURCE = "SOURCE"


class AliasEvidenceEvent(StrEnum):
    CONFIRM = "CONFIRM"
    REJECT = "REJECT"


class MatchDecisionType(StrEnum):
    """The five outcomes required by `.ai/ADAPTIVE_CATALOG_LEARNING.md`.

    Reducing this to existing/new is explicitly forbidden: AMBIGUOUS is what
    stops an uncertain interpretation from touching stock.
    """

    SAME_VARIANT = "SAME_VARIANT"
    NEW_VARIANT = "NEW_VARIANT"
    NEW_MODEL = "NEW_MODEL"
    NEW_CATEGORY = "NEW_CATEGORY"
    AMBIGUOUS = "AMBIGUOUS"


class MatchMode(StrEnum):
    AUTO = "AUTO"
    CONFIRMED = "CONFIRMED"
    MANUAL = "MANUAL"


class MatchDecisionStatus(StrEnum):
    PENDING = "PENDING"
    APPLIED = "APPLIED"
    REJECTED = "REJECTED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class RawInput(UUIDPrimaryKey, TimestampMixin, Base):
    """Exactly what someone typed or what a legacy line contained.

    APPEND-ONLY. A trigger rejects UPDATE and DELETE, because "we keep the
    original" is a promise the database should hold, not a convention the next
    developer has to remember.
    """

    __tablename__ = "raw_input"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="SET NULL"), nullable=True
    )
    source_kind: Mapped[RawInputSource] = mapped_column(
        Enum(RawInputSource, name="raw_input_source", native_enum=True), nullable=False
    )
    source_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Lets re-submission of an identical line be recognised without comparing
    # long text, and gives the parser a cheap cache key.
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_raw_input_org_hash", "organization_id", "content_hash"),
        CheckConstraint("length(raw_text) > 0", name="raw_text_not_empty"),
    )


class RawInputProcessing(TimestampMixin, UpdatedAtMixin, Base):
    """Mutable lifecycle for one immutable RawInput, one row each."""

    __tablename__ = "raw_input_processing"

    raw_input_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("raw_input.id", ondelete="CASCADE"),
        primary_key=True,
    )
    status: Mapped[ProcessingStatus] = mapped_column(
        Enum(ProcessingStatus, name="raw_input_processing_status", native_enum=True),
        nullable=False,
        server_default=ProcessingStatus.PENDING.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    parser_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_parse_result_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parse_result.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_raw_input_processing_status", "status"),
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
    )


class ParseResult(UUIDPrimaryKey, TimestampMixin, Base):
    """Structured interpretation of one raw line by one parser version.

    Unique on `(raw_input_id, parser_version)`: re-running the same parser over
    the same text is a no-op, which is exactly what makes retries safe and
    repeatable. A new parser version produces a new row beside the old one, so
    a regression can be diagnosed by comparing them.
    """

    __tablename__ = "parse_result"

    raw_input_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("raw_input.id", ondelete="CASCADE"),
        nullable=False,
    )
    parser_version: Mapped[str] = mapped_column(String(40), nullable=False)
    parsed: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="{}"
    )
    # Per-field confidence: a certain model and size must not be thrown away
    # because garment_type is uncertain.
    field_confidence: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="{}"
    )
    # Terms whose role is not proven. They survive the workflow rather than
    # being forced into a column to make parsing look complete.
    unclassified: Mapped[list[Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="[]"
    )

    __table_args__ = (
        UniqueConstraint("raw_input_id", "parser_version", name="uq_parse_result_input_version"),
    )


class ProductAlias(UUIDPrimaryKey, TimestampMixin, UpdatedAtMixin, Base):
    """A normalized phrase this shop uses for a catalog entity."""

    __tablename__ = "product_alias"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    normalized_phrase: Mapped[str] = mapped_column(String(200), nullable=False)
    target_type: Mapped[AliasTargetType] = mapped_column(
        Enum(AliasTargetType, name="alias_target_type", native_enum=True), nullable=False
    )
    target_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    status: Mapped[AliasStatus] = mapped_column(
        Enum(AliasStatus, name="alias_status", native_enum=True),
        nullable=False,
        server_default=AliasStatus.NEW.value,
    )
    confirm_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    reject_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "normalized_phrase",
            "target_type",
            "target_id",
            name="uq_product_alias_org_phrase_target",
        ),
        Index("ix_product_alias_lookup", "organization_id", "normalized_phrase"),
        CheckConstraint("confirm_count >= 0 AND reject_count >= 0", name="counts_not_negative"),
    )


class AliasEvidence(UUIDPrimaryKey, TimestampMixin, Base):
    """One human confirmation or rejection. APPEND-ONLY."""

    __tablename__ = "alias_evidence"

    alias_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_alias.id", ondelete="CASCADE"),
        nullable=False,
    )
    raw_input_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("raw_input.id", ondelete="SET NULL"),
        nullable=True,
    )
    decision_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("catalog_match_decision.id", ondelete="SET NULL"),
        nullable=True,
    )
    event: Mapped[AliasEvidenceEvent] = mapped_column(
        Enum(AliasEvidenceEvent, name="alias_evidence_event", native_enum=True), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_alias_evidence_alias", "alias_id"),
        Index(
            "uq_alias_evidence_decision_alias",
            "alias_id",
            "decision_id",
            unique=True,
            postgresql_where=text("decision_id IS NOT NULL"),
        ),
    )


class CatalogMatchDecision(UUIDPrimaryKey, TimestampMixin, Base):
    """What the matcher concluded, and on what basis.

    Stores the predicted target, the resolved target, per-field scores, the
    candidate margin and the conflicts — which is also why a separate
    `CatalogFeedback` table is not needed in M1: this row already is the
    evaluation dataset.
    """

    __tablename__ = "catalog_match_decision"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    raw_input_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("raw_input.id", ondelete="CASCADE"),
        nullable=False,
    )
    parse_result_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parse_result.id", ondelete="SET NULL"),
        nullable=True,
    )
    decision_type: Mapped[MatchDecisionType] = mapped_column(
        Enum(MatchDecisionType, name="match_decision_type", native_enum=True), nullable=False
    )
    resolved_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=True,
    )
    top_candidate_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="SET NULL"),
        nullable=True,
    )
    top_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)
    second_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)
    # A high top score is not enough if the runner-up is almost equal.
    margin: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)
    field_scores: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="{}"
    )
    conflicts: Mapped[list[Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="[]"
    )
    matcher_version: Mapped[str] = mapped_column(String(40), nullable=False)
    # Monotonic counter bumped whenever verified aliases or catalog identity
    # change, so a decision can be explained against the knowledge it saw.
    knowledge_revision: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")
    mode: Mapped[MatchMode] = mapped_column(
        Enum(MatchMode, name="match_mode", native_enum=True), nullable=False
    )
    status: Mapped[MatchDecisionStatus] = mapped_column(
        Enum(MatchDecisionStatus, name="match_decision_status", native_enum=True),
        nullable=False,
        server_default=MatchDecisionStatus.PENDING.value,
    )
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index("ix_catalog_match_decision_review", "organization_id", "status"),
        # An applied decision must have resolved to something; an ambiguous one
        # must not have. This is invariant I14 written as a constraint.
        CheckConstraint(
            "(status <> 'APPLIED') OR (resolved_variant_id IS NOT NULL)",
            name="applied_requires_resolution",
        ),
        CheckConstraint(
            "(decision_type <> 'AMBIGUOUS') OR (resolved_variant_id IS NULL)",
            name="ambiguous_resolves_nothing",
        ),
    )


__all__ = [
    "AliasEvidence",
    "AliasEvidenceEvent",
    "AliasStatus",
    "AliasTargetType",
    "CatalogMatchDecision",
    "MatchDecisionStatus",
    "MatchDecisionType",
    "MatchMode",
    "ParseResult",
    "ProcessingStatus",
    "ProductAlias",
    "RawInput",
    "RawInputProcessing",
    "RawInputSource",
]
