"""Break «Сьогодні ви продали N шт.» one way at a time: each must fail a test or a journey.

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
COUNT = "backend/app/modules/cash/sold_today.py"
API = "backend/app/api/v1/sales.py"
SALE = "frontend/src/sales/Sale.tsx"
CSS = "frontend/src/styles.css"

TESTS = ["backend:tests/integration/test_sold_today.py"]
SPEC = ["e2e/till-sold-today.spec.ts"]

M = [
    ("a paper sale counts for whoever typed it", COUNT,
     "func.coalesce(Sale.outage_sold_by, Sale.seller_user_id) == scope.user_id,",
     "Sale.seller_user_id == scope.user_id,", TESTS),
    ("everyone's sales count", COUNT,
     "        func.coalesce(Sale.outage_sold_by, Sale.seller_user_id) == scope.user_id,\n", "",
     TESTS),
    ("a collected order counts", COUNT,
     "        ~select(CustomerOrder.id).where(CustomerOrder.sale_id == Sale.id).exists(),\n", "",
     TESTS),
    ("returns are not taken off", COUNT,
     "units=int(sold or 0) - int(returned or 0)", "units=int(sold or 0)", TESTS),
    ("the day begins at midnight", COUNT, "DAY_BEGINS = time(6)", "DAY_BEGINS = time(0)", TESTS),
    ("the day is counted by UTC", COUNT,
     "    start = datetime.combine(day, DAY_BEGINS, zone)\n"
     "    end = datetime.combine(day + timedelta(days=1), DAY_BEGINS, zone)\n",
     "    start = datetime.combine(day, DAY_BEGINS, UTC)\n"
     "    end = datetime.combine(day + timedelta(days=1), DAY_BEGINS, UTC)\n", TESTS),
    ("the store's returns of the day are taken off, whoever's sale", COUNT,
     ".where(SaleItem.sale_id.in_(counted), Refund.created_at < end)",
     ".join(Sale, Sale.id == SaleItem.sale_id)"
     ".where(Sale.store_id == store.id, Refund.created_at >= start, Refund.created_at < end)",
     TESTS),
    ("a return after the day's end is taken off", COUNT,
     ".where(SaleItem.sale_id.in_(counted), Refund.created_at < end)",
     ".where(SaleItem.sale_id.in_(counted))", TESTS),
    ("another store's sales count", COUNT, "        Sale.store_id == store.id,\n", "", TESTS),
    ("the day never ends", COUNT, "        Sale.sold_at < end,\n", "", TESTS),
    ("the days before count", COUNT, "        Sale.sold_at >= start,\n", "", TESTS),
    ("anyone reads it", API,
     "    scope.require(Permission.SALE_CREATE, store_id)\n    figure = await sold_today(",
     "    figure = await sold_today(", TESTS),
    ("the receipt never says it", SALE,
     "`Сьогодні ви продали ${String(sold.data.units)} шт.`", '""', SPEC),
    ("the path doubles /api/v1", SALE,
     "`/sales/sold-today?store_id=${encodeURIComponent(storeId)}`",
     "`/api/v1/sales/sold-today?store_id=${encodeURIComponent(storeId)}`", SPEC),
    ("the store is not named", SALE,
     "`/sales/sold-today?store_id=${encodeURIComponent(storeId)}`", "`/sales/sold-today`", SPEC),
    ("a paper sale for someone else says it", SALE,
     "        mark.sold_by_user_id === userId) && (", "        true) && (", SPEC),
    ("a paper sale for the seller says nothing", SALE,
     "        mark.sold_by_user_id === userId) && (", "        false) && (", SPEC),
    ("a paper sale naming nobody says nothing", SALE,
     "        mark.sold_by_user_id === null ||\n", "        false ||\n", SPEC),
    ("the line is not kept while the figure comes", CSS, "  min-height: 1.55em;\n", "", SPEC),
    ("the figure is not announced", SALE,
     '<p className="sold-today" role="status">', '<p className="sold-today">', SPEC),
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
