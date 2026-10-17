"""Break both warehouses in the till's search, and the screen kept in place, one way at a time: each must fail a test or a journey.

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
SERVICE = "backend/app/modules/inventory/service.py"
CATALOG = "backend/app/api/v1/catalog.py"
SALE = "frontend/src/sales/Sale.tsx"
SEARCH = "frontend/src/sales/StockSearch.tsx"
PLACE = "frontend/src/shared/Placeholder.tsx"
APP = "frontend/src/App.tsx"
CSS = "frontend/src/styles.css"

TESTS = ["backend:tests/integration/test_till_search_warehouses.py"]
BOTH = ["e2e/till-two-warehouses.spec.ts"]
PLACES = ["e2e/till-placeholders.spec.ts"]

M = [
    ("every warehouse it may read is listed, selling or not", SERVICE,
     "            capability=LocationCapability.SELL,\n", "            capability=None,\n", TESTS),
    ("a paused warehouse is listed", SERVICE,
     "StockLocation.id.in_(selling), StockLocation.is_active.is_(True)",
     "StockLocation.id.in_(selling)", TESTS),
    ("rows do not say their warehouse", CATALOG, "                location_id=row.location_id,\n", "",
     TESTS + BOTH),
    ("a private warehouse is listed through a network-wide right", SERVICE,
     "        granted &= set(\n", "        granted = set(\n", TESTS),
    ("a model's sizes ranked across every model listed", SEARCH,
     "  const ranked = new Map<string, number>();\n  for (const item of items) {\n"
     "    const key = `${item.product_variant_id}:${item.size_id}`;\n"
     "    if (!sizeRank.has(key)) {\n"
     "      const next = ranked.get(item.product_variant_id) ?? 0;\n"
     "      sizeRank.set(key, next);\n"
     "      ranked.set(item.product_variant_id, next + 1);\n    }\n  }\n"
     "  const rankOf = (item: StockOption): number =>\n"
     "    sizeRank.get(`${item.product_variant_id}:${item.size_id}`) ?? 0;\n",
     "  for (const item of items)\n"
     "    if (!sizeRank.has(item.size_id)) sizeRank.set(item.size_id, sizeRank.size);\n"
     "  const rankOf = (item: StockOption): number => sizeRank.get(item.size_id) ?? 0;\n",
     BOTH),
    ("a basket's lines do not say their warehouse", SALE,
     "    searchAll || spans\n      ? ", "    false\n      ? ", BOTH),
    ("a receipt's lines do not say their warehouse", SALE,
     "          searchAll ||\n          new Set(receipt.items",
     "          false &&\n          new Set(receipt.items", BOTH),
    ("the catalogue remembers the last warehouse", SALE, '                          setCatalogAt("");\n',
     "", BOTH),
    ("a two-warehouse store asks for one first", SALE,
     'const searchAll = sellable.length >= 2 && locationId === "";',
     'const searchAll = false && locationId === "";', BOTH),
    ("chips do not name their warehouse", SALE, "                places={places}\n",
     "                places={null}\n", BOTH),
    ("the coat leaves from the warehouse chosen, not the chip's", SALE,
     "const place = item.location_id || locationId;", "const place = locationId;", BOTH),
    ("a size's chips are in the server's order", SEARCH,
     "  for (const tag of byModel.values())\n    tag.sizes.sort(",
     "  for (const tag of [] as Tag[])\n    tag.sizes.sort(", BOTH),
    ("a waiting warehouse is not said", SALE, "{searchAll && stillWaiting.length > 0 && (",
     "{false && stillWaiting.length > 0 && (", BOTH),
    ("both waiting, the goods are still asked for", SALE,
     ") : searchAll && ready.length === 0 ? (", ") : false ? (", BOTH),
    ("the catalogue does not ask the warehouse", SALE, ") : fromCatalog && searchAll ? (",
     ") : false ? (", BOTH),
    ("a stale empty list speaks under the new words", SEARCH,
     "(stock.isPending || (stock.isPlaceholderData && models.length === 0) ? (",
     "(stock.isPending ? (", PLACES),
    ("a search blanks the list", SEARCH, "    placeholderData: (", "    placeholderDataOff: (",
     PLACES),
    ("another warehouse's list is kept while the new one is read", SEARCH,
     '(before?.queryKey[3] === (locationId ?? "all") ? previous : undefined)', "(previous)", BOTH),
    ("the places say nothing to a screen reader", PLACE,
     '<p role="status" className="visually-hidden">', '<p className="visually-hidden">', PLACES),
    ("no field's place while signing in", APP, '<Placeholder said="Входимо в магазин…" field />',
     '<Placeholder said="Входимо в магазин…" />', PLACES),
    ("the field's place takes no room", CSS, ".skeleton-field {\n  height: 52px;\n",
     ".skeleton-field {\n", PLACES),
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
