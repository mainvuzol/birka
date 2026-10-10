"""Break the whole-phone search one way at a time: each must fail its tests."""
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
                       "tests/unit/test_customer_phone.py", "tests/integration/test_store_states.py",
                       "-k", "phone or whole_phone or paid_at_one or every_store"], UNIT]
FRONTEND = ["frontend", ["./node_modules/.bin/playwright", "test", "e2e/stores.spec.ts",
                         "-g", "found by the whole phone", "--reporter=line"], E2E]
SERVICE = "backend/app/modules/credit/service.py"
SCOPE = "backend/app/modules/authz/service.py"
SCREEN = "frontend/src/credits/Credits.tsx"

M = [
    ("server: a part of the number still matches", BACKEND, SERVICE,
     "        grouped = grouped.where(CUSTOMER == phone)\n",
     "        grouped = grouped.where(CUSTOMER.contains(phone))\n"),
    ("server: two digits are a number", BACKEND, SERVICE,
     "    if len(digits(wanted)) not in PHONE_DIGITS:\n        return None\n    return customer_key",
     "    if len(digits(wanted)) < 2:\n        return None\n    return customer_key"),
    ("server: a name with a number is a number", BACKEND, SERVICE,
     "        not (char.isspace() or char in _PHONE_MARKS",
     "        not (True or char in _PHONE_MARKS"),
    ("server: a number pasted from contacts refused", BACKEND, SERVICE,
     ' or unicodedata.category(char) == "Cf")', ")"),
    ("server: paid debts answered too", BACKEND, SERVICE,
     "        status = CreditStatus.OPEN\n", ""),
    ("server: a name searched as before", BACKEND, SERVICE,
     "        if phone is None:\n            raise",
     "        if phone is None and not wanted:\n            raise"),
    ("server: «+38» not one number with «0»", BACKEND, SERVICE,
     "    return customer_key(digits(wanted))\n", "    return digits(wanted)\n"),
    ("server: the old partial search kept for elsewhere", BACKEND, SERVICE,
     "    if elsewhere:\n        grouped = grouped.where(CUSTOMER == phone)\n    elif wanted:",
     "    if wanted:"),
    ("server: «8 067» another customer", BACKEND, SERVICE,
     '_UKRAINIAN = (("380", 12), ("80", 11), ("00380", 14))',
     '_UKRAINIAN = (("380", 12), ("00380", 14))'),
    ("server: «0038 067» another customer", BACKEND, SERVICE,
     '_UKRAINIAN = (("380", 12), ("80", 11), ("00380", 14))',
     '_UKRAINIAN = (("380", 12), ("80", 11))'),
    ("server: the database's key not the code's", BACKEND, SERVICE,
     "        for prefix, length in _UKRAINIAN\n    ),\n    else_",
     "        for prefix, length in _UKRAINIAN[:1]\n    ),\n    else_"),
    ("server: a paid debt read by its id elsewhere", BACKEND, SERVICE,
     "        if credit.status != CreditStatus.OPEN.value:\n            # Only what is still owed",
     "        if False:\n            # Only what is still owed"),
    ("server: a seller in every store reads a closed one", BACKEND, SCOPE,
     "    reads_closed = Permission.REPORT_VIEW_FINANCIAL in _coerce(org_codes)\n",
     "    reads_closed = True\n"),
    ("server: nobody reads a closed store", BACKEND, SCOPE,
     "    reads_closed = Permission.REPORT_VIEW_FINANCIAL in _coerce(org_codes)\n",
     "    reads_closed = False\n"),
    ("phone: six digits asked of the server", FRONTEND, SCREEN,
     "digits >= 10 && digits <= 15", "digits >= 2 && digits <= 15"),
    ("phone: a number pasted from contacts refused", FRONTEND, SCREEN,
     "/^[\\d\\s()+./\\p{Cf}-]+$/u", "/^[\\d\\s()+./-]+$/u"),
    ("phone: paid debts asked for elsewhere", FRONTEND, SCREEN,
     "  const openOnly = owedOnly || elsewhere;\n", "  const openOnly = owedOnly;\n"),
    ("phone: «Показати» offered elsewhere", FRONTEND, SCREEN,
     "      {!elsewhere && (\n        <label>\n          Показати", "      {(\n        <label>\n          Показати"),
    ("phone: the field still says a name", FRONTEND, SCREEN,
     '            ? "Повний номер телефону покупця"', '            ? "Пошук за ім’ям або телефоном"'),
    ("phone: no request ever sent elsewhere", FRONTEND, SCREEN,
     "  const searched = !elsewhere || wholePhone(search);", "  const searched = !elsewhere;"),
    ("phone: «Оновити» asks without a number", FRONTEND, SCREEN,
     "            if (searched) void customers.refetch();", "            void customers.refetch();"),
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
