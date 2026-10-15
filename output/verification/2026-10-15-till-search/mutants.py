"""Break the till's search and one tap of a size one way at a time: each must fail a test.

Server mutants run the server's tests on the branch's isolated database
(`~/.cache/birka-runtime/helpers/unit-env.sh`); screen mutants run the
journeys against the isolated E2E API (`e2e-fresh.sh`, `e2e-run.sh`),
reseeded before every run. The unchanged tree runs first, both ways, and
must pass; each mutant names the tests that failed. An optional argument
runs only the mutants whose name contains it.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
R = Path.home() / ".cache/birka-runtime"
H = R / "helpers"
SERVICE = "backend/app/modules/inventory/service.py"
SALE = "frontend/src/sales/Sale.tsx"
SEARCH = "frontend/src/sales/StockSearch.tsx"
APP = "frontend/src/App.tsx"

PYTEST = [str(R / "python/bin/python"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
          "tests/integration/test_till_search.py", "tests/integration/test_order_read_api.py",
          "tests/integration/test_receiving_reads.py"]
E2E = [str(H / "e2e-run.sh"), "e2e/till-search.spec.ts", "e2e/sale.spec.ts", "e2e/price.spec.ts",
       "e2e/size.spec.ts", "e2e/outage.spec.ts", "e2e/orders.spec.ts", "e2e/till-redesign.spec.ts",
       "e2e/shelf.spec.ts"]

M = [
    # The server.
    ("the search needs only its first word", SERVICE, "        for word in words:\n            pattern",
     "        for word in words[:1]:\n            pattern"),
    ("a typed % or _ is a wildcard", SERVICE,
     '    return "%" + value.replace("\\\\", "\\\\\\\\").replace("%", "\\\\%").replace("_", "\\\\_") + "%"',
     '    return "%" + value + "%"'),
    ("a merged model's old name finds nothing", SERVICE,
     "            select(func.coalesce(named.merged_into_id, named.id))", "            select(named.id)"),
    ("the source is not searched", SERVICE,
     '                    named_source.normalized_name.like(pattern, escape="\\\\"),\n', ""),
    ("the colour is not searched", SERVICE,
     '                    named_colour.normalized_name.like(pattern, escape="\\\\"),\n', ""),
    ("sizes are not in receiving's order", SERVICE,
     "    size_order = case(ranks, value=Inventory.size_id, else_=len(ranks)) if ranks else literal(0)",
     "    size_order = literal(0)"),
    ("a size not known comes first", SERVICE,
     "case(ranks, value=Inventory.size_id, else_=len(ranks))", "case(ranks, value=Inventory.size_id, else_=-1)"),
    ("the list is not by name", SERVICE,
     "            statement.order_by(\n                CanonicalConcept.normalized_name,\n",
     "            statement.order_by(\n"),
    ("the list is not by colour", SERVICE,
     "                colour.normalized_name.nulls_first(),\n", ""),
    ("a sold-out size is listed", SERVICE,
     "        .outerjoin(colour, colour.id == ProductVariant.color_term_id)\n        .where(Inventory.location_id.in_(granted), Inventory.quantity > 0)",
     "        .outerjoin(colour, colour.id == ProductVariant.color_term_id)\n        .where(Inventory.location_id.in_(granted))"),
    ("an unreadable search is taken", SERVICE,
     '    if len(query) > 200 or not is_storable(query):\n        raise ValidationFailedError("Search text must contain at most 200 valid characters")\n    granted = await _readable_places(',
     '    granted = await _readable_places('),
    ("the till's list skips the warehouse check", SERVICE,
     "        if location_id not in granted:\n            raise PermissionDeniedError",
     "        if False:\n            raise PermissionDeniedError"),
    # The screen.
    ("one letter is a search", SEARCH, "text.trim().length >= 2", "text.trim().length >= 1"),
    ("«Ще товари» replaces the list", SEARCH,
     "    () => tags((stock.data?.pages ?? []).flatMap((page) => page.items)),",
     "    () => tags((stock.data?.pages ?? []).slice(-1).flatMap((page) => page.items)),"),
    ("a size an order holds whole can be tapped", SEARCH,
     "(size.available_quantity <= 0 && !offerHeld) ||", "false ||"),
    ("nothing found says nothing", SEARCH, "        query ? (\n", "        false ? (\n"),
    ("«Очистити» leaves the cursor", SEARCH,
     '                  type("");\n                  searchRef.current?.focus();\n', '                  type("");\n'),
    ("the tag does not say what orders hold", SEARCH, "{tag.reserved > 0 && (", "{false && ("),
    ("the same chip again is a second line", SALE, "    if (at >= 0) {\n", "    if (false) {\n"),
    ("a changed line keeps the sale's command", SALE,
     "    edit: { quantity?: number; price?: string },\n  ): void {\n    replaceDraft(",
     "    edit: { quantity?: number; price?: string },\n  ): void {\n    setDraft("),
    ("the ways do not wait for a price", SALE,
     "disabled={blocked || working || !priced || labelledOnPaper}", "disabled={blocked || working || labelledOnPaper}"),
    ("a line without a price does not take the cursor", SALE,
     "    if (!item.suggested_price) setFocusPrice(id);\n", ""),
    ("the line does not show the model's price", SALE,
     '        price: item.suggested_price ? asInput(item.suggested_price) : "",',
     '        price: "",'),
    ("«Менше» takes a line to nothing", SALE, "disabled={d.line.quantity <= 1}", "disabled={false}"),
    ("a price that is not money says nothing", SALE,
     '{d.line.unit_price === "" && (d.price.trim() || d.suggested) ? (', "{false ? ("),
    ("«Новий продаж» leaves the cursor", SALE, "          setDropped([]);\n          setFocusSearch(true);\n",
     "          setDropped([]);\n"),
    ("a searched sale leaves the search", SALE,
     '      if (query) {\n        setText("");\n', "      if (query) {\n"),
    ("one warehouse is asked", SALE, "        ) : onlyWarehouse ? (", "        ) : false ? ("),
    ("the paper band names «Звіт»", SALE,
     "Він увійде в сьогоднішні\n            продажі й у касу",
     "Він увійде в сьогоднішній\n            «Звіт» і в касу"),
    ("the label's text in paper mode is the old one", SALE,
     "Товар з невідомим розміром вносьте як «розмір невідомий».",
     "Товар без розміру вносьте як «розмір невідомий»."),
    # The review's fixes, 2026-10-15.
    ("a line forgets its model is held with no size", SALE, "      shortDraft.unknownNearby ||\n", ""),
    ("a warehouse no longer sold from stays the till's", SALE,
     "location.id === locationId && location.is_active && location.can_sell", "location.id === locationId"),
    ("a size read off a label is sold from paper", SALE,
     "disabled={blocked || working || !priced || labelledOnPaper}", "disabled={blocked || working || !priced}"),
    ("the sum shows before every price", SALE, "            {!priced ? (\n", "            {false ? (\n"),
    ("from paper a size an order holds is not offered", SALE, "            offerHeld={paper}", "            offerHeld={false}"),
    ("«Новий продаж» after an empty shelf leaves the cursor", SALE,
     "          setNothingSold(null);\n          setFocusSearch(true);\n", "          setNothingSold(null);\n"),
    ("the app is «birka» on the sign-in screen", APP, "        <h1>Бірка</h1>\n        <h2>Вхід через Telegram</h2>",
     "        <h1>birka</h1>\n        <h2>Вхід через Telegram</h2>"),
]


def env_for_unit() -> dict[str, str]:
    out = subprocess.run(["zsh", "-c", f"source {H / 'unit-env.sh'}; env"], capture_output=True, text=True,
                         check=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


UNIT_ENV = env_for_unit()


def server() -> subprocess.CompletedProcess[str]:
    return subprocess.run(PYTEST, cwd=ROOT / "backend", env=UNIT_ENV, capture_output=True, text=True,
                          timeout=1200)


def screen() -> subprocess.CompletedProcess[str]:
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run(E2E, cwd=ROOT / "frontend", capture_output=True, text=True, timeout=1800)


def failed(run: subprocess.CompletedProcess[str], journeys: bool) -> str:
    if journeys:
        titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                         if re.match(r"^\s+\[mobile-chromium\] › ", l)})
    else:
        titles = sorted({l.split("::", 1)[-1].split(" ")[0] for l in run.stdout.splitlines()
                         if l.startswith("FAILED ")})
    return "; ".join(t[:90] for t in titles)


only = sys.argv[1] if len(sys.argv) > 1 else ""
chosen = [m for m in M if not only or only in m[0]]
for label, run, journeys in (("server", server, False), ("screen", screen, True)):
    if not any((m[1] == SERVICE) != journeys for m in chosen):
        continue
    base = run()
    print(f"- unchanged tree ({label}): {'passed' if base.returncode == 0 else 'FAILED'} {failed(base, journeys)}",
          flush=True)
    if base.returncode != 0:
        sys.exit(1)
caught = ran = 0
for name, rel, old, new in chosen:
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)", flush=True)
        continue
    path.write_text(text.replace(old, new))
    journeys = rel != SERVICE
    try:
        result = screen() if journeys else server()
    finally:
        path.write_bytes(original)
    ran += 1
    ok = result.returncode != 0
    caught += ok
    print(f"- {name}: {'caught by ' + failed(result, journeys) if ok else 'SURVIVED'}", flush=True)
print(f"{caught} of {ran} caught")
