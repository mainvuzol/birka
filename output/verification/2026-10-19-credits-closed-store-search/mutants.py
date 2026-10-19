"""Break the closed stores' search, the debts' search by any apostrophe or a
Latin «i», and a kept command's words for a server's error, one way at a
time: each must fail a test. The closed stores asked for only by a whole
number, by a quiet button under this store's results, the same number kept
both ways, the rule said where nothing is owed here; «Мар'яна» found as
«Мар’яна», «iрина» as «Ірина»; a kept payment, write-off or return answered
with a server's error or a request not found never told to try again, its
request's number kept.

Each mutant runs its tests: the backend's against the isolated test cluster
(`unit-env.sh`), the journeys against the isolated E2E API (`e2e-fresh.sh`,
`e2e-run.sh`), reseeded before every run. The unchanged tree runs first,
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
SEARCH = "backend/app/modules/credit/service.py"
LIST = "frontend/src/credits/Credits.tsx"
ERRORS = "frontend/src/cash/errors.ts"

FOUND = ["backend:tests/integration/test_customer_credit.py"]
CLOSED = ["e2e/stores.spec.ts", "-g", "blocked store is found",
          "e2e/credits-list.spec.ts", "-g", "closed store's customer|what the store is owed comes first"]
KEPT = ["e2e/outage.spec.ts", "-g", "P2-2"]
RETURNS = ["e2e/outage.spec.ts", "-g", "a kept return still unconfirmed"]
PASTED = ["e2e/credits.spec.ts", "-g", "a sale paid in parts leaves the rest owed"]

M = [
    ("a stored name's apostrophe read as written", SEARCH,
     "    name = func.translate(func.lower(CustomerCredit.customer_name), _SAME_FROM, _SAME_TO)\n",
     "    name = func.lower(CustomerCredit.customer_name)\n", FOUND),
    ("a typed apostrophe read as typed", SEARCH,
     "    words = dict.fromkeys(wanted.lower().translate(_SAME).split())\n",
     "    words = dict.fromkeys(wanted.lower().split())\n", FOUND),
    ("a Latin «i» not the Ukrainian «і»", SEARCH,
     '_SAME_FROM = "’ʼ`´‘i"\n_SAME_TO = "\'\'\'\'\'" + chr(0x0456)',
     '_SAME_FROM = "’ʼ`´‘"\n_SAME_TO = "\'\'\'\'\'"', FOUND),
    ("a number pasted from contacts read here as a name", SEARCH,
     "    if _written_as_phone(wanted):\n",
     '    if re.fullmatch(r"[\\d\\s()+\\-]+", wanted) and digits(wanted):\n',
     FOUND + PASTED),
    ("the closed stores offered before this store answers", LIST,
     "    customers.isSuccess &&\n    !customers.isPlaceholderData;\n", "    true;\n", CLOSED),
    ("the closed stores offered for a number typed before", LIST,
     "    search === query.trim() &&\n", "", CLOSED),
    ("a store that does not trade offers the closed stores", LIST,
     "    !readOnly &&\n    !elsewhere &&\n", "    !elsewhere &&\n", CLOSED),
    ("focus left behind at a switch", LIST,
     "    (elsewhere ? elsewhereHeading : heading).current?.focus();\n", "", CLOSED),
    ("a store that does not trade says where to pay", LIST,
     "                : readOnly\n", "                : false\n", CLOSED),
    ("the closed stores asked for before a whole number", LIST,
     "    wholePhone(search) &&\n    search === query.trim() &&\n",
     "    search === query.trim() &&\n", CLOSED),
    ("the number cleared on the way there", LIST,
     "            setElsewhere(true);\n",
     '            setElsewhere(true);\n            setQuery("");\n', CLOSED),
    ("the number cleared on the way back", LIST,
     "              setElsewhere(false);\n",
     '              setElsewhere(false);\n              setQuery("");\n', CLOSED),
    ("the rule unsaid where a whole number owes nothing here", LIST,
     "              {!wholePhone(search)\n", "              {true\n", CLOSED),
    ("a kept payment's server error told to try again", ERRORS,
     "    return serverFailed(error, text, what, twice) ?? text;\n",
     "    return text;\n", KEPT),
    ("a kept return's server error told to try again", ERRORS,
     "      serverFailed(\n        error,\n",
     "      (null as string | null) && serverFailed(\n        error,\n", RETURNS),
    ("a server error's request number dropped", ERRORS,
     "  const number = text.slice(FAILED_TEXT.length).trim();\n",
     '  const number = "";\n', KEPT + RETURNS),
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
