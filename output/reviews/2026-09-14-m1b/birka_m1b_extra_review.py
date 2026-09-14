import asyncio
import json
import os
from unittest.mock import patch

from fastapi import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.api.v1 import inventory as inventory_api
from app.modules.authz.permissions import Permission
from app.modules.audit.models import AuditLog
from app.modules.catalog.models import AttributeTerm, AttributeKind, ProductVariant
from app.modules.catalog.read import describe_variants
from tests.integration.test_sale_command import make_shop, give_stock


async def main():
    engine=create_async_engine(os.environ['REVIEW_DATABASE_URL'])
    maker=async_sessionmaker(engine,expire_on_commit=False)
    outputs={}
    async with maker() as s:
        shop=await make_shop(s)
        await give_stock(s,shop,10)
        original=inventory_api.current_quantity
        async def race_read(*args,**kwargs):
            quantity=await original(*args,**kwargs)
            async with maker() as other:
                await give_stock(other,shop,1)
            return quantity
        with patch.object(inventory_api,'current_quantity',race_read):
            result=await inventory_api.adjust_inventory(
                inventory_api.AdjustmentRequest(store_id=shop.store_id,product_variant_id=shop.variant_id,size_id=shop.size_id,quantity_delta=1,reason_code='CORRECTION'),
                scope=shop.scope(frozenset(Permission)),session=s,response=Response(),idempotency_key=str(shop.store_id))
        audit=(await s.execute(select(AuditLog).where(AuditLog.entity_id==result.movement_id))).scalar_one()
        outputs['stale_adjustment_audit']={'actual_before':11,'reported_before':result.quantity_before,'reported_after':result.quantity_after,'audit_before':audit.before}
        original_variant=await s.get(ProductVariant,shop.variant_id)
        smooth=AttributeTerm(organization_id=shop.organization_id,kind=AttributeKind.TEXTURE,name='гладкая',normalized_name='гладкая')
        grain=AttributeTerm(organization_id=shop.organization_id,kind=AttributeKind.TEXTURE,name='зернистая',normalized_name='зернистая')
        s.add_all([smooth,grain]);await s.flush()
        original_variant.texture_term_id=smooth.id
        second=ProductVariant(product_family_id=original_variant.product_family_id,color_term_id=original_variant.color_term_id,length_cm=70,texture_term_id=grain.id)
        s.add(second);await s.flush()
        descriptions=await describe_variants(s,[original_variant.id,second.id])
        outputs['texture_snapshot']={'same_name':descriptions[original_variant.id].display_name==descriptions[second.id].display_name,'same_snapshot':descriptions[original_variant.id].snapshot==descriptions[second.id].snapshot,'snapshot_keys':list(descriptions[second.id].snapshot)}
        await s.rollback()
    await engine.dispose()
    print('REVIEW_RESULTS='+json.dumps(outputs,ensure_ascii=False))

asyncio.run(main())
