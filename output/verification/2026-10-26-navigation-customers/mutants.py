"""Break «Клієнти» (navigation task list, P0-2) one way at a time: each must
fail a journey. «Клієнти» in the row stands for the debts, the orders and a
new order, marked on each, opening the debts — or the one of them this
person has — shown with either right; pressed again, its way's first
screen. «Борги | Замовлення» under each list's heading for whoever has
both, held as the row is.

Each mutant runs its journeys against the isolated E2E API
(`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run. The unchanged
tree runs first, with everything any mutant names, and must pass; each
mutant names what failed. An optional argument runs only the mutants whose
names contain one of its parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
APP = "frontend/src/App.tsx"
CREDITS = "frontend/src/credits/Credits.tsx"
ORDERS = "frontend/src/orders/Orders.tsx"

SECTIONS = "e2e/till-sections.spec.ts"
TWO = [SECTIONS, "-g", "«Клієнти»'s two ways"]
READS_ONLY = [SECTIONS, "-g", "none of the counter's work but reads orders"]
NEITHER = [SECTIONS, "-g", "whoever may not read orders has no"]
NO_ORDERS = [SECTIONS, "-g", "sells but may not read orders"]
NO_CREDIT = ["e2e/credits.spec.ts", "-g", "paying in parts needs its own permission"]
DEBT_AGAIN = ["e2e/credits-debt.spec.ts", "-g", "pressed again on a debt"]
CARD_AGAIN = ["e2e/orders-card.spec.ts", "-g", "pressed again on an order"]
KEPT = ["e2e/outage.spec.ts", "-g", "also reads orders"]

M = [
    ("«Клієнти» not marked on the orders", APP,
     "      also: [\"credits\", \"list\", \"new\"],\n",
     "      also: [\"credits\", \"new\"],\n", TWO),
    ("«Клієнти» not marked on a new order", APP,
     "      also: [\"credits\", \"list\", \"new\"],\n",
     "      also: [\"credits\", \"list\"],\n", TWO),
    ("«Ще» marked on the orders", APP,
     "  \"list\",\n  \"new\",\n", "  \"new\",\n", TWO),
    ("«Клієнти» opens the orders for whoever has both", APP,
     "      tab: canSeeCredits ? \"credits\" : \"list\",",
     "      tab: \"list\",", TWO),
    ("«Клієнти» opens the debts for whoever has no right to them", APP,
     "      tab: canSeeCredits ? \"credits\" : \"list\",",
     "      tab: \"credits\",", NO_CREDIT),
    ("no «Клієнти» for whoever only reads orders", APP,
     "      shown: canSeeCredits || canSeeOrders,",
     "      shown: canSeeCredits,", READS_ONLY),
    ("«Клієнти» for whoever has neither", APP,
     "      shown: canSeeCredits || canSeeOrders,",
     "      shown: true,", NEITHER),
    ("the switch for whoever may not read orders", APP,
     "    canSeeCredits && canSeeOrders ? (", "    canSeeCredits ? (", NO_ORDERS),
    ("the switch for whoever may not take debts", APP,
     "    canSeeCredits && canSeeOrders ? (", "    canSeeOrders ? (", NO_CREDIT),
    ("no switch under the debts", CREDITS,
     "        Борги\n      </h2>\n      {mode}\n", "        Борги\n      </h2>\n", TWO),
    ("no switch under the orders", ORDERS,
     "      </div>\n      {mode}\n", "      </div>\n", TWO),
    ("«Клієнти» pressed again goes to the debts", APP,
     "        if (section.again && standsFor(section)) {",
     "        if (section.again && false) {", TWO),
    ("«Клієнти» pressed again keeps the debt open", APP,
     "        if (tab === \"credits\") setCreditEpoch((epoch) => epoch + 1);",
     "        if (tab === \"credits\") void 0;", DEBT_AGAIN),
    ("«Клієнти» pressed again keeps the order open", APP,
     "          setTab(\"list\");\n          setSelectedId(null);\n          setOrdersView(freshOrdersView);\n        }\n      },",
     "          setTab(\"list\");\n          setOrdersView(freshOrdersView);\n        }\n      },", CARD_AGAIN),
    ("the switch free while the row is held", APP,
     "          { mode: \"list\", label: \"Замовлення\" },\n        ]}\n        current={current}\n        disabled={blocked}",
     "          { mode: \"list\", label: \"Замовлення\" },\n        ]}\n        current={current}\n        disabled={false}", KEPT),
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
