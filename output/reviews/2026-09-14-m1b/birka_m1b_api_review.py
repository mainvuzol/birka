import asyncio
import json
import os
import uuid

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.api.deps import get_current_scope, session_dependency
from app.core.config import Settings
from app.main import create_app
from app.modules.authz.permissions import Permission
from tests.integration.test_sale_command import make_shop, give_stock


async def main():
    engine = create_async_engine(os.environ['REVIEW_DATABASE_URL'])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        shop = await make_shop(s)
        other = await make_shop(s)
        await give_stock(s, shop, 10)
    scope = shop.scope(frozenset(Permission))
    app = create_app(Settings(_env_file=None, app_env='local'))
    async def session_override():
        async with maker() as s:
            yield s
    async def scope_override():
        return scope
    app.dependency_overrides[session_dependency] = session_override
    app.dependency_overrides[get_current_scope] = scope_override
    outputs = {}
    def headers():
        return {'Idempotency-Key': str(uuid.uuid4())}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url='http://review') as client:
        receipt = {'store_id':str(shop.store_id),'lines':[
            {'product_variant_id':str(shop.variant_id),'size_id':str(shop.size_id),'quantity':2,'unit_cost':'100.00'},
            {'product_variant_id':str(shop.variant_id),'size_id':str(shop.size_id),'quantity':3,'unit_cost':'200.00'}]}
        r = await client.post('/api/v1/inventory/receipts',json=receipt,headers=headers())
        body=r.json()
        async with maker() as s:
            rows=(await s.execute(text('SELECT sm.quantity_delta, sl.unit_cost FROM stock_movement sm JOIN stock_lot sl ON sl.id=sm.stock_lot_id WHERE sm.store_id=:s ORDER BY sm.quantity_delta'),{'s':shop.store_id})).all()
        outputs['receipt_duplicate_lines']={'status':r.status_code,'lot_ids':[x['stock_lot_id'] for x in body['lines']],'ledger_costs':[[q,str(cost)] for q,cost in rows]}
        foreign_receipt={'store_id':str(shop.store_id),'lines':[{'product_variant_id':str(other.variant_id),'size_id':str(other.size_id),'quantity':1}]}
        r=await client.post('/api/v1/inventory/receipts',json=foreign_receipt,headers=headers())
        outputs['foreign_variant_and_size_receipt']={'status':r.status_code}
        payload={'store_id':str(shop.store_id),'command_id':str(uuid.uuid4()),'lines':[{'product_variant_id':str(shop.variant_id),'size_id':str(shop.size_id),'quantity':1,'unit_price':'1200.00'}]}
        original_headers=headers()
        first=await client.post('/api/v1/sales',json=payload,headers=original_headers)
        retry=await client.post('/api/v1/sales',json=payload,headers=headers())
        outputs['same_command_new_idempotency_key']={'first':first.status_code,'retry':retry.status_code,'retry_body':retry.text}
        scope=shop.scope(frozenset({Permission.INVENTORY_VIEW}))
        denied_get=await client.get('/api/v1/sales/'+first.json()['id'])
        replay=await client.post('/api/v1/sales',json=payload,headers=original_headers)
        outputs['replay_after_permission_revocation']={'get_status':denied_get.status_code,'replay_status':replay.status_code,'same_receipt':replay.json()==first.json()}
        scope=shop.scope(frozenset(Permission))
        payload={'store_id':str(shop.store_id),'command_id':str(uuid.uuid4()),'lines':[{'product_variant_id':str(shop.variant_id),'size_id':str(other.size_id),'quantity':1,'unit_price':'1200.00'}],'found_in_store':[{'line_index':0,'quantity':1}]}
        r=await client.post('/api/v1/sales',json=payload,headers=headers())
        outputs['foreign_size_sale']={'status':r.status_code}
    await engine.dispose()
    print('REVIEW_RESULTS='+json.dumps(outputs,ensure_ascii=False))

asyncio.run(main())
