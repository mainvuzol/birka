"""Break «Замовлення»'s list and its cancel (orders task list, P0-1, P0-4)
one way at a time: each must fail a journey or a test. To be sent and on
the way on top, oldest first, counted once all are read; a row a parcel's
tag — its goods and sizes, how it goes, since when, its pill — with no sum
and no id; the closed apart, newest first, read only when asked for or
when nothing is open; a waybill found as it is typed and at Enter, «not
found» only of its own answer, kept while an order is opened; «+» only for
whoever may make one; a cancel asked first, both answers held while it is
on its way, its result buzzed and said, its refusal buzzed and brought to
the finger; the server's open and closed reads.

Each mutant runs its journeys against the isolated E2E API
(`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run, or its tests on
the isolated test cluster (`unit-env.sh`). The unchanged tree runs first,
with everything any mutant names, and must pass; each mutant names what
failed. An optional argument runs only the mutants whose names contain one
of its parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
LIST = "frontend/src/orders/Orders.tsx"
APP = "frontend/src/App.tsx"
CSS = "frontend/src/styles.css"
SERVICE = "backend/app/modules/orders/service.py"

SPEC = "e2e/orders-list.spec.ts"
GROUPS = [SPEC, "-g", "what is to be sent and what is on its way"]
SEARCH = [SPEC, "-g", "a waybill is found as it is typed"]
MANY = [SPEC, "-g", "more than a hundred open"]
EMPTY = [SPEC, "-g", "no order yet"]
CANCEL = [SPEC, "-g", "asks first"]
REFUSED = [SPEC, "-g", "a cancel on its way"]
NOT_TRADING = [SPEC, "-g", "a store that does not trade"]
THEMES = [SPEC, "-g", "theme the list"]
REAL = ["e2e/orders.spec.ts"]
SERVER = ["backend:tests/integration/test_order_read_api.py"]

M = [
    ("the sent among the ones to send", LIST,
     '    (order) => order.status === "READY_TO_DISPATCH",\n  );\n  const onWay',
     '    (order) => order.status !== "CANCELLED",\n  );\n  const onWay', GROUPS),
    ("the groups counted with more to read", LIST,
     "  const counted = !opened.pages.hasNextPage;", "  const counted = true;", MANY),
    ("a group never counted", LIST,
     "          {count ? ` · ${String(orders.length)}` : \"\"}", "          {\"\"}", GROUPS),
    ("«× N» never said", LIST,
     "    item.quantity > 1 ? ` × ${String(item.quantity)}` : \"\"", "    \"\"", GROUPS),
    ("every line named", LIST,
     "  const named = order.items.slice(0, NAMED);", "  const named = order.items;", GROUPS),
    ("«з 21.10» never said", LIST,
     "          {since(order.created_at)}\n", "", GROUPS),
    ("the sum back on a row", LIST,
     "          {goesBy(order)}\n", "          {goesBy(order)} · {order.total}\n", GROUPS),
    ("the closed read with the open", LIST,
     "    mayRead && (closedShown || nothingOpen),", "    mayRead,", GROUPS),
    ("the closed never read when nothing is open", LIST,
     "    mayRead && (closedShown || nothingOpen),", "    mayRead && closedShown,", EMPTY),
    ("a row read twice shown twice", LIST,
     "        .map((order) => [order.id, order]),", "        .map((order, index) => [`${order.id}:${String(index)}`, order]),", MANY),
    ("one character searched", "frontend/src/sales/StockSearch.tsx",
     "  const typed = text.trim().length >= 2 ? text.trim() : \"\";",
     "  const typed = text.trim().length >= 1 ? text.trim() : \"\";", SEARCH),
    ("Enter waits for the pause", LIST,
     "                pressed: query.trim().length >= 2 ? query.trim() : \"\",",
     "                pressed: \"\",", SEARCH),
    ("«not found» before its answer", LIST,
     "            (found.pages.isPlaceholderData && found.orders.length === 0) ? (",
     "            false ? (", SEARCH),
    ("the search forgotten when an order is opened", APP,
     "          view={ordersView}\n          change={setOrdersView}",
     "          view={freshOrdersView}\n          change={() => undefined}", SEARCH),
    ("the focus left where the closed button was", LIST,
     "    setFocusTo(shown ? \"closed\" : \"show\");", "    setFocusTo(null);", MANY),
    ("«+» for whoever may not make an order", LIST,
     "        {mayCreate && (\n          <button\n            type=\"button\"\n            className=\"orders-add\"",
     "        {true && (\n          <button\n            type=\"button\"\n            className=\"orders-add\"", NOT_TRADING),
    ("a cancel in one tap", APP,
     "      onClick={() => {\n        setAsking(true);\n        setAsked(true);\n      }}",
     "      onClick={() => {\n        cancel();\n      }}", CANCEL),
    ("«Ні, залишити» open while the cancel is on its way", APP,
     "          // still be recorded (review, 2026-10-23).\n          disabled={blocked}\n",
     "          // still be recorded (review, 2026-10-23).\n", REFUSED),
    ("a cancel recorded without a word", APP,
     "          text: \"Замовлення скасовано, резерв звільнено.\",", "          text: \"\",", CANCEL),
    ("a cancel recorded without a buzz", APP,
     "      if (command.path.endsWith(\"/cancel\")) {\n        buzz(\"success\");",
     "      if (command.path.endsWith(\"/cancel\")) {", CANCEL),
    ("a refused cancel silent", APP,
     "      buzz(\"error\");\n      setCancelRefused((count) => count + 1);",
     "      setCancelRefused((count) => count + 1);", REFUSED),
    ("a refused cancel's why left out of reach", APP,
     "    if (cancelRefused > 0) orderAlert.current?.focus();", "    void cancelRefused;", REFUSED),
    ("an abroad note shown whole", LIST,
     "  return order.destination === \"ABROAD\" && points.length > NOTE_SHOWN",
     "  return order.destination === \"ABROAD\" && false", THEMES),
    ("a long waybill under the row's edge", CSS,
     ".order-row .sale-meta {\n  overflow-wrap: anywhere;", ".order-row .sale-meta {\n  overflow-wrap: normal;", THEMES),
    ("the real list's row unfound by its waybill", LIST,
     "    `&waybill=${encodeURIComponent(search)}`,", "    `&q=${encodeURIComponent(search)}`,", REAL),
    ("the server's open read newest first", SERVICE,
     "                        (CustomerOrder.created_at.asc(), CustomerOrder.id.asc())",
     "                        (CustomerOrder.created_at.desc(), CustomerOrder.id.desc())", SERVER),
    ("the server's closed read holding the open", SERVICE,
     "*([open_] if status == \"open\" else [~open_] if status == \"closed\" else [])",
     "*([open_] if status == \"open\" else [])", SERVER),
    ("the server's open read holding a collected order", SERVICE,
     "    open_ = CustomerOrder.status.in_([each.value for each in OPEN_STATUSES])",
     "    open_ = CustomerOrder.status.in_([each.value for each in OPEN_STATUSES] + [\"COLLECTED\"])", SERVER),
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
