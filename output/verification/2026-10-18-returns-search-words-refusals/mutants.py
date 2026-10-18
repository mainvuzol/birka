"""Break the sale search by each word and the returns' own refusal words
one way at a time: each must fail a test or a journey (returns task list,
P1-3, P2-2).

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
READ = "backend/app/modules/sales/read.py"
RETURNS = "frontend/src/returns/Returns.tsx"
ERRORS = "frontend/src/cash/errors.ts"

BACK = ["backend:tests/integration/test_till_returns.py"]
SCREEN = ["e2e/returns-sale-screen.spec.ts", "-g", "refusal nothing more"]
OUTAGE = ["e2e/outage.spec.ts", "-g", "for a reason nothing more is known of"]

M = [
    ("the whole query one substring again", READ,
     '    words = list(dict.fromkeys((query or "").strip().lower()[:MAX_QUERY].split()))\n',
     '    words = [w for w in [(query or "").strip().lower()[:MAX_QUERY]] if w]\n', BACK),
    ("words of two lines add up", READ,
     "            exists().where(\n                SaleItem.sale_id == Sale.id,\n                *(name.contains(word, autoescape=True) for word in words),\n            )\n",
     "            *(\n                exists().where(SaleItem.sale_id == Sale.id, name.contains(word, autoescape=True))\n                for word in words\n            )\n",
     BACK),
    ("one word of many is enough", READ,
     "                *(name.contains(word, autoescape=True) for word in words),\n",
     "                *(name.contains(word, autoescape=True) for word in words[:1]),\n", BACK),
    ("the letter case matters", READ,
     "        name = func.lower(SaleItem.display_name_snapshot)\n",
     "        name = SaleItem.display_name_snapshot\n", BACK),
    ("% matches everything", READ,
     "                *(name.contains(word, autoescape=True) for word in words),\n",
     "                *(name.contains(word) for word in words),\n", BACK),
    ("a conflict says an order's words", RETURNS,
     "  if (said === CONFLICT_TEXT) return RETURN_CONFLICT_TEXT;\n", "", SCREEN),
    ("a request not taken says an order's words", RETURNS,
     "  if (said === INVALID_TEXT) return RETURN_INVALID_TEXT;\n", "", SCREEN),
    ("a kept conflict says it changed while the seller worked", ERRORS,
     "  if (returnRefusalText(error) === RETURN_CONFLICT_TEXT)\n",
     "  if (false)\n", OUTAGE),
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
