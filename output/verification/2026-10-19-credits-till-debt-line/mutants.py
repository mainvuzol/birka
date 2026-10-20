"""Break the till's line of what a number already owes, and its one-line
hint for paying in parts, one way at a time: each must fail a journey. The
line only for a whole number, for the number in the field, owed in the
debt's colour from the server's sum, a write-off by its latest date — never
a debt paid off, never a number that merely holds the digits, never an
answer from before a sale — its room kept so nothing moves, the order's
asked of its store, and the hint on one line at 360 px.

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
TERMS = "frontend/src/credits/Terms.tsx"
SALE = "frontend/src/sales/Sale.tsx"
APP = "frontend/src/App.tsx"

TILL = ["e2e/credits.spec.ts", "-g",
        "sale paid in parts leaves|already owes|written off, and says nothing|order collected"]

M = [
    ("the line read for a part of a number", TERMS,
     "  const asked = wholePhone(settled) ? settled : null;\n",
     "  const asked = settled || null;\n", TILL),
    ("the line of a number typed before", TERMS,
     "    asked !== null && asked === phone.trim()\n", "    asked !== null\n", TILL),
    ("what is owed not in the debt's colour", TERMS,
     '${owed > 0n ? " owing" : ""}`}', '`}', TILL),
    ("the line of a number that merely holds the digits", TERMS,
     "          (customer) => customer.phone_digits === numberKey(asked),\n",
     "          (customer) => customer.phone_digits !== null,\n", TILL),
    ("the line's room not kept", TERMS,
     '${wholePhone(phone) ? " reserved" : ""}', "", TILL),
    ("the earliest write-off said", TERMS,
     "Math.max(latest ?? at, at)", "Math.min(latest ?? at, at)", TILL),
    ("a write-off said before what is owed", TERMS,
     "      {found && owed > 0n\n", "      {found && owed > 0n && writtenOff == null\n", TILL),
    ("an answer kept from before shown", TERMS, "    gcTime: 0,\n", "", TILL),
    ("the order's line asked of another store", APP,
     "              storeId={order.store_id}\n",
     "              storeId={crypto.randomUUID()}\n", TILL),
    ("a write-off not said", TERMS,
     '    .filter((credit) => credit.status === "WRITTEN_OFF" && credit.closed_at)\n',
     "    .filter(() => false)\n", TILL),
    ("a debt paid off said as written off", TERMS,
     '    .filter((credit) => credit.status === "WRITTEN_OFF" && credit.closed_at)\n',
     '    .filter((credit) => credit.status !== "OPEN" && credit.closed_at)\n', TILL),
    ("the till's hint in two lines", SALE,
     '            hint="Решту — у «Боргах» цього магазину."\n',
     '            hint="Решту покупець доплачує в «Боргах» цього магазину."\n', TILL),
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
