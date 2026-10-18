"""Break «Борги»'s list, and the owner's answers on returns after #105, one
way at a time: each must fail a test or a journey. «Магазину винні» first,
the list searched as it is typed from two letters, a row a customer with
what they owe and never a sale's sum, a customer of more debts read by
their phone, «Показати ще» by pages under fifty; and a kept return learned
by whoever recorded it when the warehouse is no longer reached, the money
handed back said.

A mutant in the server runs its tests against the isolated test cluster
(`unit-env.sh`); one in the screens runs its journeys against the isolated
E2E API (`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run. The
unchanged tree runs first, with everything any mutant names, and must pass;
each mutant names what failed. An optional argument runs only the mutants
whose names contain one of its parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
ROUTE = "backend/app/api/v1/refunds.py"
SERVICE = "backend/app/modules/refunds/service.py"
ERRORS = "frontend/src/cash/errors.ts"
LIST = "frontend/src/credits/Credits.tsx"
ROW = "frontend/src/credits/CustomerRow.tsx"
CARD = "frontend/src/credits/Customer.tsx"

WAREHOUSE = [
    "backend:tests/integration/test_shared_warehouse.py",
    "backend:tests/integration/test_private_locations.py",
]
ELSEWHERE = ["backend:tests/integration/test_returns_elsewhere.py"]
OUTAGE = ["e2e/outage.spec.ts", "-g", "kept return"]
DEBTS = ["e2e/credits-list.spec.ts"]
CLOSED = ["e2e/stores.spec.ts"]

M = [
    ("a warehouse refused answers nothing of one's own", ROUTE,
     "            refusal = refused\n", "            raise\n", WAREHOUSE),
    ("nothing recorded under a warehouse refused, not said", SERVICE,
     '            refusal.details.setdefault("recorded", False)\n',
     "            pass\n", WAREHOUSE),
    ("no word of the money handed back", ERRORS,
     " Якщо гроші вже повернули — передайте папір менеджеру, щоб внести повернення з паперу.`",
     "`", OUTAGE),
    ("a closed warehouse not a place lost", ERRORS,
     '    error.details.reason === "WAREHOUSE_UNAVAILABLE" ||\n', "", OUTAGE),
    ("a «Брак» undone without the money said", ERRORS,
     '    error.code === "DAMAGED_RETURNS_UNAVAILABLE" ||\n', "", OUTAGE),
    ("a lost choice without the money said", ERRORS,
     '    error.details.reason === "CHOOSE_A_WAREHOUSE" ||\n', "", OUTAGE),
    ("a lost choice refused only in the command", SERVICE,
     "    _check_choices(lines, sale_items, elsewhere)\n    destinations = {\n",
     "    destinations = {\n", ELSEWHERE),
    ("judged by where it would go now", SERVICE,
     "            destinations=went,\n", "            destinations=None,\n", ELSEWHERE),
    ("a closed warehouse not named", ROUTE,
     '                refused.details.setdefault("reason", "WAREHOUSE_UNAVAILABLE")\n',
     "                pass\n", ELSEWHERE),
    ("the limit grows again", LIST,
     "limit=${String(pageSize)}&offset=${String(pageParam)}",
     "limit=${String(pageSize + pageParam)}&offset=0", DEBTS),
    ("a customer read twice shown twice", LIST,
     "        .map((customer) => [keyOf(customer), customer]),\n",
     "        .map((customer, n) => [String(n), customer]),\n", DEBTS),
    ("searched at every letter, without the pause", LIST,
     "  const search = pressed !== \"\" && pressed === query.trim() ? pressed : typed;\n",
     "  const search = query.trim();\n", DEBTS),
    ("a sale's sum in the row", ROW,
     "            {only ? goodsOf(only) : debtsCount(customer.credits.length)}\n",
     "            {only ? `${goodsOf(only)} з ${money(only.amount as string)}` : debtsCount(customer.credits.length)}\n",
     DEBTS),
    ("what is owed summed of one debt", ROW,
     '        <span className="debt-owed">{money(customer.owed)}</span>\n',
     '        <span className="debt-owed">{money(customer.credits[0]?.owed ?? customer.owed)}</span>\n',
     DEBTS),
    ("the card shows the list's sums, not the phone's", CARD,
     "  const customer = found ?? first;\n", "  const customer = first;\n", DEBTS),
    ("a customer gone stays on the card", CARD,
     "    if (gone) back();\n", "    if (gone && !gone) back();\n", DEBTS),
    ("the card of a closed store's customer read here", CARD,
     '        }${elsewhere ? "&elsewhere=true" : ""}`,\n', "        }`,\n", DEBTS),
    ("the paid shown as those who owe while read", LIST,
     "      before?.queryKey[3] === elsewhere && before.queryKey[5] === openOnly\n",
     "      before?.queryKey[3] === elsewhere\n", DEBTS),
    ("how many owe said as one form", LIST,
     '            {plural(summary.data.customers, "покупець", "покупці", "покупців")}{" "}\n',
     '            {"покупців"}{" "}\n', DEBTS),
    ("a cleared search searched again", "frontend/src/sales/StockSearch.tsx",
     '  return typed === "" ? "" : settled;\n', "  return settled;\n", DEBTS),
    ("a cleared search waited for", "frontend/src/sales/StockSearch.tsx",
     '      typed === "" ? 0 : 300,\n', "      300,\n", DEBTS),
    ("the switch gone while the other reads", LIST,
     "      {!elsewhere && (\n        // Under the list, and under an empty one",
     "      {!elsewhere && !!customers.data && (\n        // Under the list, and under an empty one",
     DEBTS),
    ("a closed store's debts said read-only again", LIST,
     "        <p className=\"hint\">\n          Внески приймає будь-який магазин мережі, що працює.\n        </p>\n",
     "        <p className=\"hint\">\n          Магазин не торгує: його борги тут лише для перегляду.\n        </p>\n",
     CLOSED),
]

KNOWN = "the owner is shown last night's failed copy, and why Telegram did not say so"


def env() -> dict[str, str]:
    """The isolated test cluster's variables, as `unit-env.sh` sets them."""
    out = subprocess.run(["zsh", "-c", f"source {H / 'unit-env.sh'} && env"], check=True,
                         capture_output=True, text=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


def screen(specs: list[str]) -> subprocess.CompletedProcess[str]:
    if specs[0].startswith("backend:"):
        values = env()
        return subprocess.run([str(PYTHON), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                               specs[0].removeprefix("backend:")], cwd=ROOT / "backend",
                              capture_output=True, text=True, timeout=1800,
                              env=os.environ | values)
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run([str(H / "e2e-run.sh"), *specs], cwd=ROOT / "frontend", capture_output=True,
                          text=True, timeout=1800)


def failed(run: subprocess.CompletedProcess[str]) -> list[str]:
    titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                     if re.match(r"^\s+\[mobile-chromium\] › ", l)})
    titles += sorted({l.split("::", 1)[-1].split(" ")[0] for l in run.stdout.splitlines()
                      if l.startswith("FAILED ")})
    if run.returncode != 0 and not titles:
        titles = [f"the run itself failed ({run.returncode})"]
    return [t for t in titles if t != KNOWN]


def runs(specs: list[str]) -> list[list[str]]:
    """A `-g` belongs to the spec before it: each spec with its filter is a
    run of its own, so the filter never narrows another spec."""
    out: list[list[str]] = []
    for part in specs:
        if out and out[-1][-1] == "-g":
            out[-1].append(part)
        elif part == "-g":
            out[-1].append(part)
        else:
            out.append([part])
    return out


only = [part for part in (sys.argv[1] if len(sys.argv) > 1 else "").split("|") if part]
chosen = [m for m in M if not only or any(part in m[0] for part in only)]
for name, rel, old, new, specs in chosen:
    count = (ROOT / rel).read_text().count(old)
    if count != 1:
        print(f"- {name}: NOT APPLIED ({count} matches)", flush=True)
        sys.exit(1)
every: list[list[str]] = []
for m in chosen:
    for run in runs(m[4]):
        if run not in every:
            every.append(run)
names: list[str] = []
for run in every:
    names += failed(screen(run))
print(f"- unchanged tree: {'passed' if not names else 'FAILED'} {'; '.join(names)}", flush=True)
if names:
    sys.exit(1)
caught = ran = 0
for name, rel, old, new, specs in chosen:
    path = ROOT / rel
    original = path.read_bytes()
    path.write_text(original.decode().replace(old, new))
    found: list[str] = []
    try:
        for run in runs(specs):
            found += failed(screen(run))
    finally:
        path.write_bytes(original)
    ran += 1
    ok = bool(found)
    caught += ok
    print(f"- {name}: {'caught by ' + '; '.join(n[:90] for n in found) if ok else 'SURVIVED'}",
          flush=True)
print(f"{caught} of {ran} caught")
