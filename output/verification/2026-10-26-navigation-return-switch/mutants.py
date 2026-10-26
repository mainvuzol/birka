"""Break «Продати | Повернути» (navigation task list, P0-1) one way at a
time: each must fail a journey. «Продаж» in the row stands for the till and
the returns, marked on either, opening the returns for whoever only takes
them; the switch for whoever does both, under the till's heading and the
returns', the way open marked and focused, held as the row is.

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
MODE = "frontend/src/shared/ModeSwitch.tsx"
SALE = "frontend/src/sales/Sale.tsx"
BACK = "frontend/src/returns/Returns.tsx"

SECTIONS = "e2e/till-sections.spec.ts"
BOTH = [SECTIONS, "-g", "one section's two ways"]
ONLY_RETURNS = [SECTIONS, "-g", "only takes returns"]
NO_RETURNS = ["e2e/returns.spec.ts", "-g", "taking returns needs its own permission"]
KEPT = ["e2e/outage.spec.ts", "-g", "kept return confirmed by its button"]

M = [
    ("«Продаж» not marked on the returns", APP, "      also: \"returns\",\n", "", BOTH),
    ("the switch for whoever only takes returns", APP,
     "    store.permissions.includes(\"sale:create\") && canReturn ? (",
     "    canReturn ? (", ONLY_RETURNS),
    ("the switch for whoever takes no returns", APP,
     "    store.permissions.includes(\"sale:create\") && canReturn ? (",
     "    store.permissions.includes(\"sale:create\") ? (", NO_RETURNS),
    ("«Продаж» opens the till for whoever only takes returns", APP,
     "      tab: store.permissions.includes(\"sale:create\") ? \"sale\" : \"returns\",",
     "      tab: \"sale\",", ONLY_RETURNS),
    ("no «Продаж» for whoever only takes returns", APP,
     "      shown: store.permissions.includes(\"sale:create\") || canReturn,",
     "      shown: store.permissions.includes(\"sale:create\"),", ONLY_RETURNS),
    ("the way open not marked", MODE,
     "          aria-current={mode === current ? \"page\" : undefined}",
     "          aria-current={undefined}", BOTH),
    ("the focus lost to the page", MODE, "    open.current?.focus();\n", "", BOTH),
    ("no switch under the till", SALE,
     "      <h2>Продаж</h2>\n      {mode}\n", "      <h2>Продаж</h2>\n", BOTH),
    ("no switch under the returns", BACK,
     "      <h2>Повернення</h2>\n      {mode}\n", "      <h2>Повернення</h2>\n", BOTH),
    ("the switch free while the row is held", APP,
     "        disabled={blocked}\n        focus={modeChosen}",
     "        disabled={false}\n        focus={modeChosen}", KEPT),
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
