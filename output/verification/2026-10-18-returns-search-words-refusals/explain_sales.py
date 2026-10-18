"""The plan of «Повернення»'s sale search, by each word (returns task list,
P1-3), on the isolated E2E database: this store's sales and the other
stores', one word and two, with the parameters bound as the app binds them
(asyncpg), never written into the text."""
import asyncio
import sys

sys.path.insert(0, "/Users/nikitahlushak/birka/backend")
import asyncpg
from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import asyncpg as pg_asyncpg

from app.modules.sales.models import Sale, SaleItem


async def main() -> None:
    conn = await asyncpg.connect("postgresql://birka_review@127.0.0.1:55442/birka_orders_ui")
    print("sales:", await conn.fetchval("select count(*) from sale"),
          "lines:", await conn.fetchval("select count(*) from sale_item"))
    store, org = await conn.fetchrow(
        "select store_id, organization_id from sale group by 1,2 order by count(*) desc limit 1"
    )
    dialect = pg_asyncpg.dialect()
    for where, words in (("here", ["лоран"]), ("here", ["шоколад", "лоран"]),
                         ("elsewhere", ["лоран"]), ("elsewhere", ["шоколад", "лоран"])):
        name = func.lower(SaleItem.display_name_snapshot)
        st = (
            select(Sale)
            .where(Sale.organization_id == org,
                   Sale.store_id != store if where == "elsewhere" else Sale.store_id == store)
            .where(exists().where(SaleItem.sale_id == Sale.id,
                                  *(name.contains(w, autoescape=True) for w in words)))
            .order_by(Sale.sold_at.desc(), Sale.id.desc()).offset(0).limit(21)
        )
        compiled = st.compile(dialect=dialect)
        params = [compiled.params[key] for key in compiled.positiontup]
        plan = await conn.fetch("EXPLAIN (ANALYZE, BUFFERS) " + str(compiled), *params)
        print(f"--- {where} {words}")
        for row in plan:
            print(row[0])
    await conn.close()


asyncio.run(main())
