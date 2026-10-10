"""Break the stocktake of a whole warehouse one way at a time: each must fail its tests.

Server mutants run the stocktake's tests (and the drawer's messages, for the
shared outbox). Screen mutants reseed the isolated E2E database first: a
journey's stocktake stays open, or finished, after it runs.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
R = Path.home() / ".cache/birka-runtime"
PY = R / "python/bin/python"
SP = Path(sys.argv[1])  # the scratchpad: st-e2e.sh and the E2E fixture
DB = "postgresql+asyncpg://birka_review@127.0.0.1:55446/birka_stocktake"
UNIT = {**os.environ, "BIRKA_DATABASE_URL": DB, "BIRKA_TEST_DATABASE_URL": DB,
        "BIRKA_PG_BIN": str(R / "python/lib/python3.12/site-packages/pgserver/pginstall/bin")}
E2E = {**os.environ, "BIRKA_E2E_FIXTURE": str(SP / "st-fixture.json"),
       "PLAYWRIGHT_BROWSERS_PATH": str(R / "browsers")}

BACKEND = ["backend", [str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x",
                       "tests/integration/test_warehouse_stocktake.py",
                       "tests/unit/test_stocktake_message.py"], UNIT]
DRAWER = ["backend", [str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x",
                      "tests/integration/test_cash_watch.py",
                      "tests/integration/test_cash_messages.py"], UNIT]
FRONTEND = ["frontend", ["./node_modules/.bin/playwright", "test", "e2e/stocktake.spec.ts",
                         "--reporter=line"], E2E]
SERVICE = "backend/app/modules/stocktake/service.py"
SCREEN = "frontend/src/inventory/Stocktake.tsx"

M = [
    ("server: a moved balance not refused", BACKEND, SERVICE,
     "        if held[key] != expected_quantity:\n", "        if False:\n"),
    ("server: the difference taken the wrong way round", BACKEND, SERVICE,
     "        delta = counted_quantity - held[key]\n", "        delta = held[key] - counted_quantity\n"),
    ("server: a finished stocktake still counted", BACKEND, SERVICE,
     "        if not still_open:\n", "        if False:\n"),
    ("server: a count resent after the finish refused before its lookup", BACKEND, SERVICE,
     "    original = await recorded_count(\n",
     "    if stocktake.finished_at is not None:\n        raise StocktakeFinishedError(stocktake_id=str(stocktake_id))\n    original = await recorded_count(\n"),
    ("server: refusals after the lookup without recorded:false", BACKEND, SERVICE,
     "    with nothing_recorded():\n        # Shared", "    if True:\n        # Shared"),
    ("server: a size not known counted upwards", BACKEND, SERVICE,
     "        if delta > 0 and size_id in await unknown_size_ids(", "        if False and size_id in await unknown_size_ids("),
    ("server: the count left out of its fingerprint", BACKEND, SERVICE,
     '            "counted_quantity": counted_quantity,\n', ""),
    ("server: a position counted twice summed by its last count", BACKEND, SERVICE,
     '            func.sum(StocktakeCount.quantity_delta).label("net"),', '            func.max(StocktakeCount.quantity_delta).label("net"),'),
    ("server: what was counted told as not checked", BACKEND, SERVICE,
     "            Inventory.quantity > 0,\n            _not_counted(stocktake.id),\n        )\n    )\n    return Sums(",
     "            Inventory.quantity > 0,\n        )\n    )\n    return Sums("),
    ("server: counted positions still listed as not counted", BACKEND, SERVICE,
     "                    Inventory.quantity > 0,\n                    _not_counted(stocktake.id),\n                )\n                .order_by(",
     "                    Inventory.quantity > 0,\n                )\n                .order_by("),
    ("server: whoever finished hears it too", BACKEND, SERVICE,
     "        session, [owner for owner in owners if owner != stocktake.finished_by_user_id]\n",
     "        session, list(owners)\n"),
    ("server: nobody hears it", BACKEND, SERVICE,
     "        await _queue_message(session, stocktake, now=now)\n", ""),
    ("server: finishing again sums it again", BACKEND, SERVICE,
     "    if stocktake.finished_at is None:\n        sums = await _sums(", "    if True:\n        sums = await _sums("),
    ("server: «Брак» counted", BACKEND, SERVICE,
     "        raise DamagedStockClosedError(location_ids=[str(location_id)])\n", "        pass\n"),
    ("server: a warehouse waiting for its list counted", BACKEND, SERVICE,
     "        raise OpeningListPendingError(location_ids=[str(location_id)])\n", "        pass\n"),
    ("server: whoever sees stock counts", BACKEND, SERVICE,
     "        capability=LocationCapability.RECEIVE,\n        permission=Permission.INVENTORY_ADJUST,",
     "        capability=LocationCapability.RECEIVE,\n        permission=Permission.INVENTORY_VIEW,"),
    ("server: another network's stocktake found by its id", BACKEND, SERVICE,
     "            Stocktake.id == stocktake_id, Stocktake.organization_id == scope.organization_id\n",
     "            Stocktake.id == stocktake_id\n"),
    ("server: joining the open one answered as started", BACKEND, "backend/app/api/v1/stocktakes.py",
     "    if not started:\n        response.status_code = status.HTTP_200_OK\n", ""),
    ("server: the watcher never tells stocktakes", BACKEND, "backend/scripts/backup_watch.py",
     '            "stocktakes",\n', '            "stocktakes-off",\n'),
    ("server: the shared outbox keeps a refused chat waiting", DRAWER, "backend/app/modules/telegram/outbox.py",
     "                message.status = REFUSED\n", "                pass\n"),
    ("phone: a count sent against nothing", FRONTEND, SCREEN,
     "        expected_quantity: system,\n", "        expected_quantity: 0,\n"),
    ("phone: the server's balance not taken after a refusal", FRONTEND, SCREEN,
     "        setSystem(actual);\n", ""),
    ("phone: the count's stocktake sent in its body", FRONTEND, "frontend/src/inventory/stocktakeCommands.ts",
     "  payload: (body) => ({\n    store_id: body.store_id,", "  payload: (body) => ({\n    stocktake_id: body.stocktake_id,\n    store_id: body.store_id,"),
    ("phone: a kept count holds no other screen", FRONTEND, "frontend/src/App.tsx",
     "    countStorageError ||\n    countCommand.busy ||\n    countCommand.pending !== null;", "    countStorageError;"),
    ("phone: found goods counted against what the list showed", FRONTEND, SCREEN,
     "            sizeIsUnknown: false,\n            quantity: 0,\n", "            sizeIsUnknown: false,\n            quantity: 1,\n"),
    ("phone: the surplus left out of the sums", FRONTEND, SCREEN,
     "  if (sums.surplus_units)\n", "  if (false)\n"),
    ("phone: a stocktake offered without inventory:adjust", FRONTEND, "frontend/src/inventory/Stock.tsx",
     "                  canCount={adjustable}\n", "                  canCount={true}\n"),
    ("phone: the counted list shows no count", FRONTEND, SCREEN,
     "      {counted && (\n        <span>", "      {false && (\n        <span>"),
]


def fresh() -> None:
    subprocess.run([str(SP / "st-e2e.sh")], check=True, capture_output=True, timeout=120)


def run(cmd, where, env):
    return subprocess.run(cmd, cwd=ROOT / where, env=env, capture_output=True, text=True, timeout=900)


fresh()
baseline = run(FRONTEND[1], FRONTEND[0], FRONTEND[2])
print(f"baseline journeys: {'pass' if baseline.returncode == 0 else 'FAIL'}")
caught = 0
for name, (where, cmd, env), rel, old, new in M:
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)")
        continue
    if where == "frontend":
        fresh()
    path.write_text(text.replace(old, new))
    try:
        result = run(cmd, where, env)
    finally:
        path.write_bytes(original)
    ok = result.returncode != 0
    caught += ok
    lines = result.stdout.splitlines()
    why = next((l.strip() for l in lines if l.startswith("FAILED")), "")
    if not why:
        why = next((l.strip() for l in lines if re.search(r"Error:|expect\(", l)), "")
    print(f"- {name}: {'caught' if ok else 'SURVIVED'} {why[:180]}")
print(f"{caught} of {len(M)} caught")
