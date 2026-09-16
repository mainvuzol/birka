import asyncio,os,subprocess
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.engine import make_url
from sqlalchemy import text
url=os.environ['BIRKA_DATABASE_URL']
async def database(create):
    e=create_async_engine(url,isolation_level='AUTOCOMMIT')
    async with e.connect() as c:
        await c.execute(text(('CREATE' if create else 'DROP')+' DATABASE birka_migration_check'))
    await e.dispose()
asyncio.run(database(True))
try:
    env=dict(os.environ,BIRKA_DATABASE_URL=make_url(url).set(database='birka_migration_check').render_as_string(hide_password=False))
    for args in [('upgrade','head'),('downgrade','base'),('upgrade','head'),('check',)]:
        subprocess.run(['alembic',*args],env=env,check=True)
    print('PASS isolated PostgreSQL17 migration round trip and drift check')
finally:asyncio.run(database(False))
