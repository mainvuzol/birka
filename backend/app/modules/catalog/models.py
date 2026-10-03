"""Catalog identity.

The chain from `.ai/CATALOG_ARCHITECTURE.md`:

    BusinessCategory + GarmentType
      -> CanonicalConcept -> ProductFamily -> ProductVariant -> Size

Two rules shape this schema more than anything else, both from ADR-0002:

1. `ProductFamily` has its own identifier. `(concept, source, garment_type)` is
   a matching signal, indexed but deliberately NOT unique — several families may
   legitimately share it, and a unique constraint there would be a schema-level
   silent merge of genuinely different products.
2. Sentinel rows exist only where the business really has that state. Where a
   unique key spans nullable columns, `UNIQUE NULLS NOT DISTINCT` does the job
   instead (PostgreSQL >= 15).
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Enum,
    FetchedValue,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.orm import TimestampMixin, UpdatedAtMixin, UUIDPrimaryKey


class CatalogKnowledgeRevision(Base):
    """Transactional invalidation counter for one organization's matching inputs.

    Database triggers maintain this row, including direct SQL catalog changes.
    It deliberately excludes prices and sizes, which matching does not read.
    """

    __tablename__ = "catalog_knowledge_revision"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        primary_key=True,
    )
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default="0")

    __table_args__ = (CheckConstraint("revision >= 0", name="revision_nonnegative"),)


class EntityStatus(StrEnum):
    """Lifecycle shared by every catalog identity row.

    `MERGED` is never reached automatically — merging is an explicit,
    permissioned operation, previewed and confirmed because it cannot be
    undone (invariant I14; owner decision, 2026-10-03, ADR-0008).

    `RETIRED` is a model's alone: no longer offered or received, its stock
    still sold, returned and written off, and it can be brought back.
    """

    ACTIVE = "ACTIVE"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    MERGED = "MERGED"
    RETIRED = "RETIRED"


class SourceSemanticType(StrEnum):
    """What a source label actually *is*, once the business decides.

    `UNKNOWN` is the honest default and a real business state: nobody has yet
    established whether Belardi is a brand, a supplier or a factory.
    """

    UNKNOWN = "UNKNOWN"
    BRAND = "BRAND"
    SUPPLIER = "SUPPLIER"
    FACTORY = "FACTORY"
    LABEL = "LABEL"
    COLLECTION = "COLLECTION"


class AttributeKind(StrEnum):
    """The six promoted attribute kinds, plus a staging bucket.

    Anything else stays in `ProductVariant.attributes` JSONB until repeated
    evidence justifies promotion (taxonomy-evolution-guardian).
    """

    COLOR = "COLOR"
    MATERIAL = "MATERIAL"
    TEXTURE = "TEXTURE"
    FUR = "FUR"
    COLLAR = "COLLAR"
    OTHER = "OTHER"


class SizeSystemCode(StrEnum):
    ALPHA = "ALPHA"
    NUMERIC_EU = "NUMERIC_EU"
    UNSPECIFIED = "UNSPECIFIED"


_STATUS = Enum(EntityStatus, name="catalog_entity_status", native_enum=True)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


class BusinessCategory(UUIDPrimaryKey, TimestampMixin, Base):
    """How the shop groups merchandise: Куртки, Дубленки, Шуби, Пуховики."""

    __tablename__ = "business_category"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "normalized_name", name="uq_business_category_org_normalized"
        ),
    )


class GarmentType(UUIDPrimaryKey, TimestampMixin, Base):
    """What the item physically is: Бомбер, Парка, Косуха.

    Deliberately separate from BusinessCategory — a parka may be filed under
    the business category Пуховики.
    """

    __tablename__ = "garment_type"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "normalized_name", name="uq_garment_type_org_normalized"
        ),
    )


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


class CanonicalConcept(UUIDPrimaryKey, TimestampMixin, Base):
    """The stable shop-language name: Лоран, Мышка, Ботега, 4 кармана."""

    __tablename__ = "canonical_concept"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Nullable because evidence may simply be absent; guessing would be worse.
    business_category_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("business_category.id", ondelete="RESTRICT"),
        nullable=True,
    )
    garment_type_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("garment_type.id", ondelete="RESTRICT"),
        nullable=True,
    )
    status: Mapped[EntityStatus] = mapped_column(
        _STATUS, nullable=False, server_default=EntityStatus.ACTIVE.value
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("canonical_concept.id", ondelete="RESTRICT"),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "normalized_name", name="uq_canonical_concept_org_normalized"
        ),
        CheckConstraint(
            "(status = 'MERGED') = (merged_into_id IS NOT NULL)",
            name="merged_requires_target",
        ),
        CheckConstraint("merged_into_id IS NULL OR merged_into_id <> id", name="no_self_merge"),
    )


class SourceIdentity(UUIDPrimaryKey, TimestampMixin, Base):
    """Belardi, Ponte, Garcia, Manzari — stored apart from model identity.

    The semantic type is never inferred from spelling or position in a legacy
    line; it stays UNKNOWN until a human confirms it.
    """

    __tablename__ = "source_identity"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)
    semantic_type: Mapped[SourceSemanticType] = mapped_column(
        Enum(SourceSemanticType, name="source_semantic_type", native_enum=True),
        nullable=False,
        server_default=SourceSemanticType.UNKNOWN.value,
    )
    confirmed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "normalized_name", name="uq_source_identity_org_normalized"
        ),
    )


class ProductFamily(UUIDPrimaryKey, TimestampMixin, Base):
    """THE identity boundary (ADR-0002).

    `Лоран / Belardi` and `Лоран / Ponte` are two rows and are never merged
    automatically. Two families may even share the whole signature: creating
    the second one requires a human `NEW_MODEL` decision and a
    `distinction_note` explaining why it is separate.
    """

    __tablename__ = "product_family"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    canonical_concept_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("canonical_concept.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # NULL = not stated. No sentinel row: the signature index below is not
    # unique, so NULL semantics in a unique key are not a problem here.
    source_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("source_identity.id", ondelete="RESTRICT"),
        nullable=True,
    )
    garment_type_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("garment_type.id", ondelete="RESTRICT"),
        nullable=True,
    )
    # Why this family is distinct from a look-alike sharing the same signature.
    distinction_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[EntityStatus] = mapped_column(
        _STATUS, nullable=False, server_default=EntityStatus.ACTIVE.value
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_family.id", ondelete="RESTRICT"),
        nullable=True,
    )

    __table_args__ = (
        # Candidate key for retrieval and matching — NOT unique, on purpose.
        Index(
            "ix_product_family_signature",
            "organization_id",
            "canonical_concept_id",
            "source_identity_id",
            "garment_type_id",
        ),
        CheckConstraint(
            "(status = 'MERGED') = (merged_into_id IS NOT NULL)",
            name="merged_requires_target",
        ),
        CheckConstraint("merged_into_id IS NULL OR merged_into_id <> id", name="no_self_merge"),
    )


class AttributeTerm(UUIDPrimaryKey, TimestampMixin, Base):
    """One dictionary for шоколад, замш, гладкая, butter …, split by kind."""

    __tablename__ = "attribute_term"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[AttributeKind] = mapped_column(
        Enum(AttributeKind, name="attribute_kind", native_enum=True), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[EntityStatus] = mapped_column(
        _STATUS, nullable=False, server_default=EntityStatus.ACTIVE.value
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("attribute_term.id", ondelete="RESTRICT"),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id", "kind", "normalized_name", name="uq_attribute_term_org_kind_name"
        ),
        CheckConstraint("merged_into_id IS NULL OR merged_into_id <> id", name="no_self_merge"),
    )


def _term_fk(column_name: str) -> Mapped[uuid.UUID | None]:
    return mapped_column(
        column_name,
        postgresql.UUID(as_uuid=True),
        ForeignKey("attribute_term.id", ondelete="RESTRICT"),
        nullable=True,
    )


# What makes a variant's name within its family: its unique key, and what a
# rename restates (ADR-0008 §2).
VARIANT_NAME_COLUMNS = (
    "product_family_id",
    "color_term_id",
    "material_term_id",
    "texture_term_id",
    "fur_term_id",
    "collar_term_id",
    "length_cm",
)


class ProductVariant(UUIDPrimaryKey, TimestampMixin, Base):
    """A sellable configuration within a family.

    Unlike a family, a variant *is* its attribute combination — so here a
    unique key is correct. `NULLS NOT DISTINCT` makes "attribute not stated"
    collapse to one row instead of allowing unlimited near-duplicates.

    A merged variant keeps its attributes, for its lots and its history, but
    gives up the name (ADR-0008 §4): the key covers only rows not merged, so
    the model that stays may take the duplicate's spelling.
    """

    __tablename__ = "product_variant"

    product_family_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_family.id", ondelete="RESTRICT"),
        nullable=False,
    )
    color_term_id: Mapped[uuid.UUID | None] = _term_fk("color_term_id")
    material_term_id: Mapped[uuid.UUID | None] = _term_fk("material_term_id")
    texture_term_id: Mapped[uuid.UUID | None] = _term_fk("texture_term_id")
    fur_term_id: Mapped[uuid.UUID | None] = _term_fk("fur_term_id")
    collar_term_id: Mapped[uuid.UUID | None] = _term_fk("collar_term_id")
    length_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    # Descriptive in M1, never part of identity. A JSONB attribute that turns
    # out to define a distinct sellable item is a promotion trigger, not a
    # reason to widen this unique constraint.
    attributes: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="{}"
    )
    status: Mapped[EntityStatus] = mapped_column(
        _STATUS, nullable=False, server_default=EntityStatus.ACTIVE.value
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=True,
    )

    __table_args__ = (
        Index(
            "uq_product_variant_attributes",
            *VARIANT_NAME_COLUMNS,
            unique=True,
            postgresql_nulls_not_distinct=True,
            postgresql_where=text("status <> 'MERGED'"),
        ),
        Index("ix_product_variant_attributes_gin", "attributes", postgresql_using="gin"),
        CheckConstraint("length_cm IS NULL OR length_cm > 0", name="length_positive"),
        CheckConstraint(
            "(status = 'MERGED') = (merged_into_id IS NOT NULL)",
            name="merged_requires_target",
        ),
        CheckConstraint("merged_into_id IS NULL OR merged_into_id <> id", name="no_self_merge"),
    )


class CorrectionKind(StrEnum):
    RENAME = "RENAME"
    MERGE = "MERGE"
    RETIRE = "RETIRE"
    RESTORE = "RESTORE"


class CatalogCorrection(UUIDPrimaryKey, TimestampMixin, Base):
    """One correction of a model, as a fact with a permanent name (ADR-0008).

    Append-only: a rename, a merge, a retirement or a bringing back is
    recorded once, under its `command_id` (I20), and answered from here when
    the same command comes again. It is the history the owner can be shown;
    the audit log carries the same.

    `details` holds what the kind needs: the words before and after for a
    rename, and for a merge the stock that moved and the prices carried over.
    """

    __tablename__ = "catalog_correction"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="RESTRICT"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=False,
    )
    into_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="RESTRICT"),
        nullable=True,
    )
    acting_store_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), nullable=False
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("app_user.id", ondelete="RESTRICT"),
        nullable=False,
    )
    command_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    command_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    name_before: Mapped[str] = mapped_column(Text, nullable=False)
    name_after: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(
        postgresql.JSONB, nullable=False, server_default="{}"
    )
    response_snapshot: Mapped[dict[str, Any] | None] = mapped_column(
        postgresql.JSONB, nullable=True
    )
    correlation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    __table_args__ = (
        UniqueConstraint("organization_id", "command_id", name="uq_catalog_correction_org_command"),
        ForeignKeyConstraint(
            ["organization_id", "acting_store_id"],
            ["store.organization_id", "store.id"],
            name="fk_catalog_correction_org_store",
            ondelete="RESTRICT",
        ),
        CheckConstraint("kind IN ('RENAME', 'MERGE', 'RETIRE', 'RESTORE')", name="kind_known"),
        CheckConstraint(
            "(kind = 'MERGE') = (into_variant_id IS NOT NULL)", name="merge_names_target"
        ),
        CheckConstraint(
            "into_variant_id IS NULL OR into_variant_id <> product_variant_id",
            name="no_self_merge",
        ),
        Index("ix_catalog_correction_variant", "product_variant_id"),
    )


# ---------------------------------------------------------------------------
# Size
# ---------------------------------------------------------------------------


class SizeSystem(UUIDPrimaryKey, TimestampMixin, Base):
    """Alpha (XS…3XL) and numeric (36…44) coexist; neither is an enum."""

    __tablename__ = "size_system"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    code: Mapped[SizeSystemCode] = mapped_column(
        Enum(SizeSystemCode, name="size_system_code", native_enum=True), nullable=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)

    __table_args__ = (UniqueConstraint("organization_id", "code", name="uq_size_system_org_code"),)


class Size(UUIDPrimaryKey, TimestampMixin, Base):
    """A size, including the "not known" one.

    `is_unknown` marks a genuine business state (business fact F34): legacy
    stock really is held without a known size and must still be countable,
    sellable and reconcilable. It is NOT a placeholder invented to avoid NULL
    in the inventory key — that is why it carries a flag and a rule of its own.

    `code` is the size's one spelling (`catalog.sizes.spell_size`), and an
    organization has one size per spelling whatever its system
    (`uq_size_org_spelling`, ADR-0009). The system only orders the list.
    """

    __tablename__ = "size"

    size_system_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("size_system.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # The size system's, filled and kept by the trigger
    # `birka_size_organization` (migration 0032), so the spelling's key can
    # span every system of the organization.
    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        server_default=FetchedValue(),
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    is_unknown: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    __table_args__ = (
        # Still keeps the one "size not known" row per system, which the
        # spelling's key leaves out.
        UniqueConstraint("size_system_id", "code", name="uq_size_system_code"),
        Index(
            "uq_size_org_spelling",
            "organization_id",
            func.lower(text("code")),
            unique=True,
            postgresql_where=text("NOT is_unknown"),
        ),
    )


class SizeAlias(UUIDPrimaryKey, TimestampMixin, Base):
    """How this shop writes a size: "М", "m", "46-48", "L/XL"."""

    __tablename__ = "size_alias"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    normalized_text: Mapped[str] = mapped_column(String(60), nullable=False)
    size_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("size.id", ondelete="CASCADE"), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "normalized_text", name="uq_size_alias_org_text"),
    )


# ---------------------------------------------------------------------------
# Price
# ---------------------------------------------------------------------------


class VariantPrice(UUIDPrimaryKey, TimestampMixin, UpdatedAtMixin, Base):
    """The *suggested* selling price, so the seller does not retype it (F33).

    A convenience, never an authority: the sale request carries the actual
    prices and `SaleItem` freezes its own copy. Changing this row can never
    change what a past sale charged (invariant I8).
    """

    __tablename__ = "variant_price"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # NULL store_id = the organization-wide default; a store row overrides it.
    store_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("store.id", ondelete="CASCADE"), nullable=True
    )
    product_variant_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("product_variant.id", ondelete="CASCADE"),
        nullable=False,
    )
    suggested_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True), ForeignKey("app_user.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "store_id",
            "product_variant_id",
            name="uq_variant_price_org_store_variant",
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint("suggested_price >= 0", name="price_not_negative"),
        CheckConstraint("char_length(currency_code) = 3", name="currency_code_iso4217"),
    )


__all__ = [
    "AttributeKind",
    "AttributeTerm",
    "BusinessCategory",
    "CanonicalConcept",
    "CatalogKnowledgeRevision",
    "EntityStatus",
    "GarmentType",
    "ProductFamily",
    "ProductVariant",
    "Size",
    "SizeAlias",
    "SizeSystem",
    "SizeSystemCode",
    "SourceIdentity",
    "SourceSemanticType",
    "VariantPrice",
]
