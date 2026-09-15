"""Catalog endpoints.

`POST /catalog/products` is the structured way a product comes into existence:
a person names it in the shop's own words and says which sizes it comes in.
There is no parsing here and no matching — natural-language intake arrives in
gate M1C (`POST /catalog/entries`, tasks M1-020/M1-021) and will create the
same rows through the same service.

The request carries a `store_id`. That is the working context that authorizes
the action — a seller holds `catalog:create` through a store membership — not a
statement about where the product lives: catalog identity belongs to the
organization, and stock is what belongs to a store.

No item code is accepted. Staff very rarely record one (owner confirmation,
2026-09-14), the schema does not model it yet, and a field that looks optional
is the fastest way to end up with codes being treated as identity.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Header, Response, status
from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.api.deps import ScopeDep, SessionDep
from app.core import idempotency
from app.modules.authz.permissions import Permission
from app.modules.catalog.models import SizeSystemCode
from app.modules.catalog.service import (
    ProductDraft,
    SizeDraft,
    VariantDraft,
    create_product,
)

router = APIRouter(prefix="/catalog", tags=["catalog"])

PRODUCTS_ENDPOINT = "POST /catalog/products"

# Every label is trimmed and must survive trimming. A name made of spaces is a
# slip of the finger, and storing it would create a catalog row nobody can
# ever type again.
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ShortLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
SizeCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]


class VariantPayload(BaseModel):
    """The attributes that make this variant a different thing to sell.

    All optional: a shop that has not decided whether an item is замш or
    екошкіра should be able to stock it anyway. Absent means absent — it is
    never filled with a placeholder.
    """

    color: ShortLabel | None = None
    material: ShortLabel | None = None
    texture: ShortLabel | None = None
    fur: ShortLabel | None = None
    collar: ShortLabel | None = None
    length_cm: Decimal | None = Field(default=None, gt=0, max_digits=5, decimal_places=1)


class SizePayload(BaseModel):
    """One size, in the system the person says it belongs to.

    `system` is required rather than guessed: "46" is a numeric size in one
    shop's notebook and could be an alpha label in another, and picking for
    them would put stock under a size they did not mean.
    """

    system: SizeSystemCode
    code: SizeCode


class ProductRequest(BaseModel):
    store_id: uuid.UUID

    # Either the product is named…
    concept: Label | None = None
    source: Label | None = None
    business_category: ShortLabel | None = None
    garment_type: ShortLabel | None = None

    # …or it already exists and the caller points at it.
    product_family_id: uuid.UUID | None = None

    # ADR-0002: a second family may share the whole signature, but only when a
    # human says it is a different model and writes down how.
    new_model: bool = False
    distinction_note: str | None = Field(default=None, max_length=1000)

    variant: VariantPayload = Field(default_factory=VariantPayload)
    sizes: list[SizePayload] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _identity_is_stated_once(self) -> ProductRequest:
        named = self.concept is not None
        pointed = self.product_family_id is not None
        if named == pointed:
            raise ValueError("Give either a concept name or a product_family_id, not both")
        if pointed and any(
            value is not None for value in (self.source, self.business_category, self.garment_type)
        ):
            raise ValueError(
                "An existing product_family_id already carries its name, source and garment type"
            )
        if pointed and self.new_model:
            raise ValueError("new_model creates a family; it cannot point at an existing one")
        if self.new_model and not self.distinction_note:
            raise ValueError("new_model requires distinction_note explaining how it differs")
        return self


class SizeResponse(BaseModel):
    size_id: uuid.UUID
    system: SizeSystemCode
    code: str
    created: bool


class ProductResponse(BaseModel):
    product_family_id: uuid.UUID
    product_variant_id: uuid.UUID
    canonical_concept_id: uuid.UUID
    source_identity_id: uuid.UUID | None
    business_category_id: uuid.UUID | None
    garment_type_id: uuid.UUID | None
    # What the sale will freeze on the receipt if this variant is sold today.
    display_name: str
    sizes: list[SizeResponse]
    family_created: bool
    variant_created: bool


@router.post("/products", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create(
    payload: ProductRequest,
    scope: ScopeDep,
    session: SessionDep,
    response: Response,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=200)],
) -> ProductResponse:
    """Create (or find) the product identity that stock can be received against.

    Most of this command is naturally repeatable — naming the same colour twice
    returns the same term. The exception is `new_model`, which deliberately
    creates a second family, so a retried request would create a third. The
    idempotency key is what stops that. It is a 7-day cache, not a permanent
    guarantee: unlike a sale, a product has no `command_id`, because a
    duplicate family is recoverable by merging (invariant I14) and a duplicate
    sale is not.
    """
    scope.require(Permission.CATALOG_CREATE, payload.store_id)

    outcome = await idempotency.claim(
        session,
        organization_id=scope.organization_id,
        endpoint=PRODUCTS_ENDPOINT,
        key=idempotency_key,
        request_fingerprint=idempotency.fingerprint(
            payload.model_dump(mode="json"),
            actor_user_id=scope.user_id,
            store_id=payload.store_id,
        ),
    )
    if isinstance(outcome, idempotency.Replay):
        response.status_code = outcome.http_status
        return ProductResponse.model_validate(outcome.response)

    result = await create_product(
        session,
        organization_id=scope.organization_id,
        actor_user_id=scope.user_id,
        draft=ProductDraft(
            concept=payload.concept,
            source=payload.source,
            business_category=payload.business_category,
            garment_type=payload.garment_type,
            product_family_id=payload.product_family_id,
            new_model=payload.new_model,
            distinction_note=payload.distinction_note,
            variant=VariantDraft(
                color=payload.variant.color,
                material=payload.variant.material,
                texture=payload.variant.texture,
                fur=payload.variant.fur,
                collar=payload.variant.collar,
                length_cm=payload.variant.length_cm,
            ),
            sizes=tuple(SizeDraft(system=size.system, code=size.code) for size in payload.sizes),
        ),
    )

    body = ProductResponse(
        product_family_id=result.product_family_id,
        product_variant_id=result.product_variant_id,
        canonical_concept_id=result.canonical_concept_id,
        source_identity_id=result.source_identity_id,
        business_category_id=result.business_category_id,
        garment_type_id=result.garment_type_id,
        display_name=result.display_name,
        sizes=[
            SizeResponse(
                size_id=size.size_id, system=size.system, code=size.code, created=size.created
            )
            for size in result.sizes
        ],
        family_created=result.family_created,
        variant_created=result.variant_created,
    )
    await idempotency.complete(
        session,
        outcome.record_id,
        response=body.model_dump(mode="json"),
        http_status=status.HTTP_201_CREATED,
    )
    await session.commit()
    return body


__all__ = ["router"]
