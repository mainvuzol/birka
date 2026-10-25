"""Break «Замовлення»'s last three tasks (orders task list, P2-1, P2-2,
P2-3) and «Каса»'s refusals one way at a time: each must fail a journey.
«Замовлення» only for whoever may read them, the first section shown
otherwise; the places of the list, the search and the card while read; the
pills by what they mean, «в дорозі» in its own colours; a failure on a
warning's plate; 14 px under a step, the card still whole at 360 × 640; and
«Каса»'s refusals in its banners' words (the owner's answer after #138).

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
LIST = "frontend/src/orders/Orders.tsx"
TYPES = "frontend/src/orders/types.ts"
CSS = "frontend/src/styles.css"
CASH = "frontend/src/cash/errors.ts"

CARD = "e2e/orders-card.spec.ts"
LISTED = "e2e/orders-list.spec.ts"
NO_RIGHT = ["e2e/till-sections.spec.ts", "-g", "whoever may not read orders"]
LIST_READ = [LISTED, "-g", "while the open orders are read"]
SEARCHED = [LISTED, "-g", "a waybill is found as it is typed"]
PLATE = [LISTED, "-g", "could not be read says so on a warning"]
THEMES = [LISTED, "-g", "theme the list reads"]
CARD_READ = [CARD, "-g", "while an order is read"]
FITS = [CARD, "-g", "an order to send fits the phone"]
CASH_KEPT = ["e2e/cash.spec.ts", "-g", "a server fails to answer is still unconfirmed"]
KEPT_TAB = ["e2e/outage.spec.ts", "-g", "kept delivery of whoever may not read orders"]

M = [
    ("«Замовлення» in «Ще» for anyone", APP,
     "      label: \"Замовлення\",\n      shown: canSeeOrders,",
     "      label: \"Замовлення\",\n      shown: true,", NO_RIGHT),
    ("opened on «Замовлення» without the right", APP,
     "    if (tab === \"list\" && !canSeeOrders && firstShown !== undefined)",
     "    if (false)", NO_RIGHT),
    # The review's (2026-10-25).
    ("a kept operation's tab taken by the first section", APP,
     "setTab((now) => (now === \"list\" ? firstShown : now));", "setTab(firstShown);", KEPT_TAB),
    ("the list read in words alone", LIST,
     "            // P2-2).\n            <Placeholder said=\"Завантажуємо замовлення…\" rows={3} />",
     "            // P2-2).\n            <p role=\"status\">Завантажуємо замовлення…</p>", LIST_READ),
    ("the search in words alone", LIST,
     "<Placeholder said=\"Шукаємо…\" rows={3} day={false} />",
     "<p role=\"status\">Шукаємо…</p>", SEARCHED),
    ("the card read in words alone", APP,
     "              <CardPlaceholder />",
     "              <p role=\"status\">Завантажуємо замовлення…</p>", CARD_READ),
    ("to be sent, the accent", TYPES,
     "  READY_TO_DISPATCH: \"badge warn\",", "  READY_TO_DISPATCH: \"badge\",", THEMES),
    ("on its way, the accent", TYPES,
     "  DISPATCHED: \"badge transit\",", "  DISPATCHED: \"badge\",", THEMES),
    ("cancelled, the accent", TYPES,
     "  CANCELLED: \"badge neutral\",", "  CANCELLED: \"badge\",", THEMES),
    ("«в дорозі» in no colours of its own", CSS,
     ".badge.transit {\n  background: var(--transit-bg);\n  color: var(--transit);\n}",
     ".badge.transit {\n}", THEMES),
    ("a failure in a debt's red", CSS,
     ".cash .notice[role=\"alert\"],\n.notice.read-failure[role=\"alert\"] {",
     ".cash .notice[role=\"alert\"] {", PLATE),
    ("a failure not a plate", LIST,
     "<div className=\"notice read-failure\" role=\"alert\">", "<div role=\"alert\">", PLATE),
    ("13 px under a step", CSS,
     ".orders .hint,\n.order .hint,\n", ".orders .hint,\n", CARD_READ),
    ("the card no longer whole at 360 × 640", CSS,
     ".reserve-hint {\n  margin: 6px 0;\n  line-height: 1.4;\n}", ".reserve-hint {\n}", FITS),
    ("«Каса»'s refusals in their old words", CASH,
     "keptUnconfirmed(error, what, NEVER_TWICE, misses)",
     "keptUnconfirmed(error, what, twiceOf(\"вона\"), misses)", CASH_KEPT),
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
