"""Break «Товар» (navigation task list, P0-3) one way at a time: each must
fail a journey. «Товар» in the row stands for the stock, receiving and
«Брак», marked on each, shown with any of their rights; «Прийшов товар» and
«Брак» are tiles over the stock, each by its own right, held as the row is,
«Брак» saying how many units wait to be inspected; «← Товар» back from
either, held as the row is. With it, the receipt's «Наступні внески — у
розділі «Клієнти».» (the owner's answer after #141).

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
GOODS = "frontend/src/inventory/Goods.tsx"
SALE = "frontend/src/sales/Sale.tsx"
DAMAGED = "frontend/src/damaged/Damaged.tsx"

SECTIONS = "e2e/till-sections.spec.ts"
TAPS = [SECTIONS, "-g", "the goods are «Товар»"]
COUNT = [SECTIONS, "-g", "tile says how many units wait"]
NO_VIEW = ["e2e/stock.spec.ts", "-g", "without the right to read the stock"]
NO_RECEIVE = ["e2e/receive.spec.ts", "-g", "receiving needs its own permission"]
NO_DAMAGED = ["e2e/damaged.spec.ts", "-g", "needs its own permission"]
KEPT_DELIVERY = ["e2e/outage.spec.ts", "-g", "kept delivery of whoever may not read orders"]
KEPT_CORRECTION = ["e2e/outage.spec.ts", "-g", "kept stock correction a server fails"]
RECEIPT = ["e2e/credits.spec.ts", "-g", "a sale paid in parts leaves the rest owed"]

M = [
    ("«Товар» not marked on receiving", APP,
     "      also: [\"receive\", \"damaged\"],", "      also: [\"damaged\"],", TAPS),
    ("«Товар» not marked on «Брак»", APP,
     "      also: [\"receive\", \"damaged\"],", "      also: [\"receive\"],", TAPS),
    ("«Ще» marked on receiving", APP,
     "  \"stock\",\n  \"receive\",\n  \"damaged\",\n", "  \"stock\",\n  \"damaged\",\n", TAPS),
    ("«Товар» only for whoever may read the stock", APP,
     "      shown: canSeeGoods,", "      shown: canSeeStock,", NO_VIEW),
    ("no tiles alone for whoever may not read the stock", APP,
     "        ) : canSeeGoods ? (", "        ) : false ? (", NO_VIEW),
    ("no tiles over the stock", APP,
     "            tiles={goodsTiles}\n", "", TAPS),
    ("«Прийшов товар» without its right", APP,
     "      receive={\n        canReceive\n", "      receive={\n        true\n", NO_RECEIVE),
    ("«Брак» without its right", APP,
     "      damaged={\n        canSeeDamaged\n", "      damaged={\n        true\n", NO_DAMAGED),
    ("the tiles free while the row is held", APP,
     "      token={token}\n      disabled={blocked}\n      receive={",
     "      token={token}\n      disabled={false}\n      receive={", KEPT_CORRECTION),
    ("no «← Товар» from receiving", APP,
     "            back={toGoods}\n            backHeld={blocked}\n",
     "            backHeld={blocked}\n", TAPS),
    ("«← Товар» free while a delivery waits", APP,
     "            backHeld={blocked}\n", "            backHeld={false}\n", KEPT_DELIVERY),
    ("every unit counted, not those waiting", GOODS,
     "    (unit) => unit.status === \"AWAITING\",",
     "    (unit) => unit.status !== \"WRITTEN_OFF\",", COUNT),
    ("one said as many", GOODS,
     "  const one = count % 10 === 1 && count % 100 !== 11;",
     "  const one = false;", COUNT),
    ("nothing waiting said as a number", GOODS,
     "  if (count === 0) return \"нічого не чекає\";\n", "", COUNT),
    ("no grey line while read", GOODS,
     "          {units.isPending ? (", "          {false ? (", COUNT),
    # The two closes the first run named apart — the tile's and «← Товар»'s
    # — each covered the other, so neither alone was seen: one helper now.
    ("«Ще» opened again by a tile or «← Товар»", APP,
     "    setTab(to);\n    setMoreAt(null);\n", "    setTab(to);\n", TAPS),
    ("«← Товар» read as the row's «Товар»", DAMAGED,
     "          aria-label=\"Назад до товару\"\n", "", TAPS),
    ("an old count kept after a failed read", GOODS,
     "          ) : !units.isError && awaiting !== undefined ? (",
     "          ) : awaiting !== undefined ? (", COUNT),
    ("the receipt's old «Борги»", SALE,
     "Наступні внески — у розділі «Клієнти».",
     "Наступні внески — у розділі «Борги».", RECEIPT),
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
