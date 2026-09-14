import asyncio, os, uuid
from unittest.mock import patch
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from tests.integration.test_sale_command import make_shop, give_stock, sell, basket
from app.modules.sales import service as sales
from app.modules.sales.service import FoundInStore
from app.modules.catalog.models import ProductVariant
from app.modules.inventory.service import MovementRequest, apply_movements, current_quantity
from app.modules.inventory.models import MovementType

async def main():
 engine=create_async_engine(os.environ['REVIEW_DATABASE_URL'])
 maker=async_sessionmaker(engine,expire_on_commit=False)
 async with maker() as s:
  shop=await make_shop(s)
  result=await sell(s,shop,found_in_store=[FoundInStore(0,1)]*100)
  await s.commit()
  q=await current_quantity(s,store_id=shop.store_id,product_variant_id=shop.variant_id,size_id=shop.size_id)
  print('DUPLICATE_CORRECTION',dict(corrections=len(result.corrections),sold=1,stock_after=q))
 async with maker() as setup:
  shop=await make_shop(setup)
 read=asyncio.Event(); receipt_done=asyncio.Event()
 original=sales.current_quantity
 async def paused_read(*a,**kw):
  q=await original(*a,**kw);read.set();await receipt_done.wait();return q
 async def sale_race():
  async with maker() as s:
   with patch.object(sales,'current_quantity',paused_read):
    result=await sell(s,shop,found_in_store=[FoundInStore(0,1)])
    await s.commit()
 async def receipt_race():
  await read.wait()
  async with maker() as s: await give_stock(s,shop,1)
  receipt_done.set()
 await asyncio.gather(sale_race(),receipt_race())
 async with maker() as s:
  q=await current_quantity(s,store_id=shop.store_id,product_variant_id=shop.variant_id,size_id=shop.size_id)
  rows=(await s.execute(text('select movement_type,quantity_delta from stock_movement where store_id=:s'),dict(s=shop.store_id))).all()
  print('STALE_CORRECTION',dict(stock_after=q,movements=[tuple(x) for x in rows]))
 async with maker() as s:
  shop=await make_shop(s)
  first=await s.get(ProductVariant,shop.variant_id)
  second=ProductVariant(product_family_id=first.product_family_id,attributes={'review':'second'})
  s.add(second); await s.flush()
  ids=sorted([shop.variant_id,second.id],key=str)
  for vid in ids:
   await apply_movements(s,organization_id=shop.organization_id,requests=[MovementRequest(shop.store_id,vid,shop.size_id,1,MovementType.DELIVERY)])
  await s.commit()
 barrier=asyncio.Barrier(2);orig_apply=sales.apply_movements
 async def barrier_apply(*a,**kw):
  result=await orig_apply(*a,**kw)
  if kw['requests'][0].movement_type==MovementType.ADJUSTMENT:
   await barrier.wait()
  return result
 async def concurrent_sale(n):
  async with maker() as s:
   lines=basket(shop)+basket(shop)
   from dataclasses import replace
   lines=[replace(lines[0],product_variant_id=ids[0],quantity=1 if n==0 else 2),replace(lines[1],product_variant_id=ids[1],quantity=2 if n==0 else 1)]
   try:
    result=await sell(s,shop,lines=lines,found_in_store=[FoundInStore(1 if n==0 else 0,1)])
    await s.commit();return 'committed'
   except Exception as exc:
    await s.rollback();return str(exc).splitlines()[0]
 with patch.object(sales,'apply_movements',barrier_apply):
  outcomes=await asyncio.wait_for(asyncio.gather(concurrent_sale(0),concurrent_sale(1)),20)
 print('DEADLOCK',outcomes)
 await engine.dispose()
asyncio.run(main())
