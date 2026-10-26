"""Break the till's basket kept while the till is left (navigation task list,
P0-5) one way at a time: each must fail a journey. The basket — its lines,
prices, paying in parts, the shelf's answers and question, the way and its
`command_id`, the warehouse — comes back as it was; it is gone once sold, with
another store, on reload and once a kept sale settles; it follows the paper
switch moved on another screen as the till's own switch would; an emptied
basket keeps nothing.

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
SALE = "frontend/src/sales/Sale.tsx"
BASKET = "frontend/src/sales/basket.ts"
PAPER = "frontend/src/sales/paper.ts"

SPEC = "e2e/till-basket.spec.ts"
KEEP = [SPEC, "-g", "the basket stays while the till is left"]
CLEARS = [SPEC, "-g", "«Новий продаж» and another store leave the till empty"]
SETTLED = [SPEC, "-g", "a kept sale settled while the till is left"]
PAPER_GONE = [SPEC, "-g", "a basket built from paper is gone once the paper is unticked"]
QUESTION = [SPEC, "-g", "not its shelf's open question"]
ANSWER_MARK = [SPEC, "-g", "never sent with the paper's mark"]
PARTS = [SPEC, "-g", "paying in parts comes back with the basket"]
SHELF = [SPEC, "-g", "an answer about the shelf already given comes back with the basket"]
EMPTIED = [SPEC, "-g", "an emptied basket keeps nothing"]

M = [
    ("the basket never kept", BASKET,
     "  kept = { at, basket };", "  void at;\n  void basket;", KEEP),
    ("the basket never restored", SALE,
     "    const basket = keptBasket(keptAt);", "    const basket = null as Basket | null;", KEEP),
    ("its command not restored", SALE,
     "    () => kept?.commandId ?? crypto.randomUUID(),", "    () => crypto.randomUUID(),", KEEP),
    ("its warehouse not restored", SALE,
     "useState(kept?.locationId ?? \"\")", "useState(\"\")", KEEP),
    ("paying in parts not restored", SALE,
     "useState<TermsInput>(kept?.credit ?? noTerms)", "useState<TermsInput>(noTerms)", PARTS),
    ("the shelf's answers not restored", SALE,
     "useState<Record<number, number>>(kept?.found ?? {})",
     "useState<Record<number, number>>({})", SHELF),
    ("the shelf's question not restored", SALE,
     "    kept?.shortfall ?? null,", "    null,", QUESTION),
    ("not under the settled kept sales", APP,
     "            keptAt={`${store.id}:${String(saleEpoch)}`}", "            keptAt={store.id}", SETTLED),
    # The first run's survivor: the paper's clearing counted as a move of its
    # switch, and dropped the basket on its own; the store left now clears
    # it by `forgetBasket` alone.
    ("not forgotten with the store", APP,
     "      clearPaper();\n      forgetBasket();\n", "      clearPaper();\n", CLEARS),
    ("an emptied basket keeps its terms", SALE,
     "    if (basket === null || basket.draft.length === 0) return null;",
     "    if (basket === null) return null;", EMPTIED),
    ("a paper basket back under the paper ticked again", SALE,
     "    return basket.paper || !paper\n", "    return !paper\n", PAPER_GONE),
    ("an unmarked basket dropped under the paper ticked", SALE,
     "    return basket.paper || !paper\n", "    return true\n", QUESTION),
    ("the shelf's answers kept under the paper ticked", SALE,
     "          found: {},\n", "", ANSWER_MARK),
    ("the shelf's question kept under the paper ticked", SALE,
     "          shortfall: null,\n", "", QUESTION),
    ("the paper switch's moves not counted", PAPER,
     "    firstDays: on ? firstDays : null,\n    moved: state.moved + 1,",
     "    firstDays: on ? firstDays : null,\n    moved: state.moved,", PAPER_GONE),
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
