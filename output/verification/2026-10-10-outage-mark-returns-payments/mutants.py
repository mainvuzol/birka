"""Break the mark on returns and payments one way at a time: each must fail its tests."""
import os
import re
import subprocess
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
R = Path.home() / ".cache/birka-runtime"
PY = R / "python/bin/python"
DB = "postgresql+asyncpg://birka_review@127.0.0.1:55446/birka_test"
UNIT = {**os.environ, "BIRKA_DATABASE_URL": DB, "BIRKA_TEST_DATABASE_URL": DB,
        "BIRKA_PG_BIN": str(R / "python/lib/python3.12/site-packages/pgserver/pginstall/bin")}
E2E = {**os.environ, "BIRKA_E2E_FIXTURE": str(R / "e2e-fixture.json"), "BIRKA_E2E_PYTHON": str(PY),
       "BIRKA_DATABASE_URL": "postgresql+asyncpg://birka_review@127.0.0.1:55442/birka_orders_ui",
       "PLAYWRIGHT_BROWSERS_PATH": str(R / "browsers")}

BACKEND = ["backend", [str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x",
                       "tests/integration/test_outage_mark_returns_payments.py",
                       "tests/unit/test_old_prints_are_pinned.py"], UNIT]
FRONTEND = ["frontend", ["./node_modules/.bin/playwright", "test", "e2e/outage-mark-debts-returns.spec.ts",
                         "e2e/outage.spec.ts", "-g", "from paper", "--reporter=line"], E2E]
REFUNDS = "backend/app/modules/refunds/service.py"
CREDIT = "backend/app/modules/credit/service.py"

M = [
    ("server: a return's print without its mark", BACKEND, REFUNDS,
     "            **print_of_paper(outage),\n", ""),
    ("server: a payment's print without its mark", BACKEND, CREDIT,
     "            **print_of_paper(outage),\n", ""),
    ("server: whoever sells named on a return", BACKEND, REFUNDS,
     "                may=Permission.SALE_REFUND,", "                may=Permission.SALE_CREATE,"),
    ("server: whoever sells named on a payment", BACKEND, CREDIT,
     "                may=Permission.SALE_CREDIT,", "                may=Permission.SALE_CREATE,"),
    ("server: a return's people those of the store that sold", BACKEND, REFUNDS,
     "                store_id=taking,\n                mark=outage,",
     "                store_id=sale.store_id,\n                mark=outage,"),
    ("server: a payment's people those of the store that sold", BACKEND, CREDIT,
     "                store_id=taking,\n                mark=outage,",
     "                store_id=credit.store_id,\n                mark=outage,"),
    ("server: a return's mark not stored", BACKEND, REFUNDS,
     "            during_outage=mark is not None,\n            outage_taken_by=mark.by_user_id if mark is not None else None,\n            outage_taken_at=mark.at if mark is not None else None,\n",
     ""),
    ("server: a payment's mark not stored", BACKEND, CREDIT,
     "                during_outage=mark is not None,\n                outage_taken_by=mark.by_user_id if mark is not None else None,\n                outage_taken_at=mark.at if mark is not None else None,\n",
     ""),
    ("server: a return's mark not answered", BACKEND, "backend/app/api/v1/refunds.py",
     "        outage=paper_response(result.outage),", "        outage=None,"),
    ("server: a payment's mark not in the history", BACKEND, CREDIT,
     "                outage=paper_view(\n                    entry.during_outage,",
     "                outage=None and paper_view(\n                    entry.during_outage,"),
    ("server: the returns list is the till's", BACKEND, "backend/app/api/v1/stores.py",
     '    "refund": Permission.SALE_REFUND,', '    "refund": Permission.SALE_CREATE,'),
    ("server: an unmarked return printed with the mark's absence", BACKEND, "backend/app/api/v1/refunds.py",
     '        if body["outage"] is None:\n            del body["outage"]\n', ""),
    ("server: «Звіт» shows no return's mark", BACKEND, "backend/app/modules/reports/sales.py",
     "                if refund.during_outage\n", "                if False\n"),
    ("server: the paper's time named as a sale's", BACKEND, "backend/app/modules/sales/outage.py",
     '            detail="at",', '            detail="sold_at",'),
    ("phone: a return from paper says to hand the money back", FRONTEND, "frontend/src/returns/Returns.tsx",
     "  const back = refund.outage ? handedBack : kept ? handBackOnce : handBack;",
     "  const back = kept ? handBackOnce : handBack;"),
    ("phone: a return's mark not sent", FRONTEND, "frontend/src/returns/Returns.tsx",
     "        ...(outage ? { outage } : {}),\n", ""),
    ("phone: a kept return resent without its mark", FRONTEND, "frontend/src/returns/commands.ts",
     "    ...(body.outage ? { outage: body.outage } : {}),\n", ""),
    ("phone: a kept payment resent without its mark", FRONTEND, "frontend/src/credits/commands.ts",
     "          ...(body.outage ? { outage: body.outage } : {}),\n", ""),
    ("phone: a payment from paper says nothing of the terminal", FRONTEND, "frontend/src/credits/Credits.tsx",
     "paymentTaken(body.amount, body.payment_method, !!body.outage)",
     "paymentTaken(body.amount, body.payment_method, false)"),
    ("phone: a kept card payment from paper says to charge it", FRONTEND, "frontend/src/App.tsx",
     "              (creditSettled.fromPaper\n", "              (false\n"),
    ("phone: «Звіт» words a return as a sale", FRONTEND, "frontend/src/reports/SalesReport.tsx",
     '        {entry.kind === "RETURN"\n', "        {false\n"),
    ("phone: the history shows no mark", FRONTEND, "frontend/src/credits/Credits.tsx",
     '            {entry.outage && ` · ${paperText("payment", entry.outage)}`}\n', ""),
    ("phone: the button does not say «З паперу»", FRONTEND, "frontend/src/returns/Returns.tsx",
     '            : `${mark.paper ? "З паперу · " : ""}${', '            : `${""}${'),
]

caught = 0
for name, (where, cmd, env), rel, old, new in M:
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)")
        continue
    path.write_text(text.replace(old, new))
    try:
        run = subprocess.run(cmd, cwd=ROOT / where, env=env, capture_output=True, text=True, timeout=600)
    finally:
        path.write_bytes(original)
    ok = run.returncode != 0
    caught += ok
    lines = run.stdout.splitlines()
    why = next((l.strip() for l in lines if l.startswith("FAILED")), "")
    if not why:
        why = next((l.strip() for l in lines if re.search(r"Error:|expect\(", l)), "")
    print(f"- {name}: {'caught' if ok else 'SURVIVED'} {why[:180]}")
print(f"{caught} of {len(M)} caught")
