"""Break the order's card and the lists' newest first (orders task list,
P0-2; owner decision, 2026-10-23) one way at a time: each must fail a
journey or a test. What a step said — the waybill, abroad, arrived — a
buzz after it and none for a step whose answer never came, an error's buzz
and the order read again for a refusal; lines with their sums less their
discount for every unit, «за 1 шт.» only for more than one; the reserve's
line only to send, the money's words on «Клієнт забрав»'s step; one panel
for whoever may step, none on an arrived order or over a form, naming the
order as its title; the number beside the pill; the server's lists newest
first.

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
CARD = "frontend/src/orders/Order.tsx"
APP = "frontend/src/App.tsx"
CSS = "frontend/src/styles.css"
SERVICE = "backend/app/modules/orders/service.py"

SPEC = "e2e/orders-card.spec.ts"
FIRST = [SPEC, "-g", "an order to send fits the phone"]
STEPS = [SPEC, "-g", "sent with its waybill, then arrived"]
REFUSED = [SPEC, "-g", "sent without a waybill"]
LINES = [SPEC, "-g", "lines with their sums"]
NO_PANEL = [SPEC, "-g", "a closed order"]
KEPT = [SPEC, "-g", "a step whose answer never came"]
SHIPPING = ["e2e/order-shipping.spec.ts"]
SERVER = ["backend:tests/integration/test_order_read_api.py"]

M = [
    ("sent said without its waybill", CARD,
     "    ? `Відправлено · ТТН ${visible(order.waybill)}`", "    ? \"Відправлено.\"", STEPS),
    ("arrived said nothing", CARD,
     "  if (action === \"arrive\") return \"Прибув на пошту\";", "  if (action === \"arrive\") return null;", STEPS),
    ("abroad sent said as within Ukraine", CARD,
     "  if (order.destination === \"ABROAD\") return \"Відправлено.\";\n", "", SHIPPING),
    ("a line's sum without its discount", CARD,
     "    (kopecks(item.unit_price) ?? 0n) - (kopecks(item.discount_amount) ?? 0n);",
     "    kopecks(item.unit_price) ?? 0n;", LINES),
    ("a line's sum for one unit", CARD,
     "  return money(decimal(each * BigInt(item.quantity)));", "  return money(decimal(each));", LINES),
    ("«за 1 шт.» for one", CARD,
     "                {(item.quantity > 1 || discounted) && (", "                {true && (", LINES),
    ("the reserve's line on every status", CARD,
     "      {order.status === \"READY_TO_DISPATCH\" && (\n        <p className=\"hint\">Товар у резерві",
     "      {true && (\n        <p className=\"hint\">Товар у резерві", STEPS),
    ("the money's words gone from «Клієнт забрав»", CARD,
     "          <p className=\"hint\">{collectHint}</p>\n", "", STEPS),
    ("the panel over the shipping form", CARD,
     "    !changingShipping &&\n", "", FIRST),
    ("the panel for whoever may not step", CARD,
     "  const panelStep =\n    mayStep &&", "  const panelStep =\n    true &&", NO_PANEL),
    ("a panel on an arrived order", CARD,
     "    (next === \"dispatch\" || next === \"arrive\")\n      ? next", "    next !== undefined\n      ? next", STEPS),
    ("the panel naming the first coat only", CARD,
     "            {title}\n", "            {first ? tagOf(first) : \"\"}\n", LINES),
    ("no room kept for the panel", CARD,
     "  usePanelRoom(panel, panelStep !== null);", "  usePanelRoom(panel, false);", FIRST),
    ("no number beside the pill", CARD,
     "        <small className=\"order-number\">№ {order.id.slice(0, 8)}</small>",
     "        <small className=\"order-number\" />", FIRST),
    ("a kept step buzzing", APP,
     "      step !== \"\" &&\n      settled.pending === null &&", "      step !== \"\" &&", KEPT),
    ("a refused step silent", APP,
     "      buzz(\"error\");\n      setStepRefused((count) => count + 1);",
     "      setStepRefused((count) => count + 1);", REFUSED),
    ("a refused step's order not read again", APP,
     "      void cache.invalidateQueries({\n        queryKey: [\"order\", store.id, command.orderId],\n      });\n",
     "", REFUSED),
    ("a step done silently", APP,
     "      if (text !== null) {\n        buzz(\"success\");", "      if (text !== null) {", STEPS),
    ("a step done unsaid", APP,
     "      const text = step === \"\" ? null : stepDone(step, order);",
     "      const text = step === \"\" ? null : stepDone(\"\", order);", KEPT),
    ("the server's lists oldest first", "backend/app/modules/orders/service.py",
     "                .order_by(CustomerOrder.created_at.desc(), CustomerOrder.id.desc())",
     "                .order_by(CustomerOrder.created_at.asc(), CustomerOrder.id.asc())", SERVER),
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
