"""Break the debts' search by each word, and «Борги»'s refusals in their own
words, one way at a time: each must fail a test. A name found by each word
typed, in any order and letter case, literally; a payment or a write-off
refused with nothing more than a 409 or a 422 says what was not recorded,
live and kept, never an order's words, and a kept one not proven unrecorded
is never told to try again; a write-off is never called a payment, not
even for one render, nor asked about as one.

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
DEBT = "frontend/src/credits/Debt.tsx"
ERRORS = "frontend/src/cash/errors.ts"
APP = "frontend/src/App.tsx"

FOUND = ["backend:tests/integration/test_customer_credit.py"]
LIVE = ["e2e/credits-debt.spec.ts", "-g", "P2-2"]
KEPT = ["e2e/outage.spec.ts", "-g", "P2-2"]

M = [
    ("the name searched as one string", SEARCH,
     "    conditions: list[Any] = [and_(*(name.contains(word, autoescape=True) for word in words))]\n",
     "    conditions: list[Any] = [name.contains(wanted.lower(), autoescape=True)]\n", FOUND),
    ("a «%» typed read as a pattern", SEARCH,
     "name.contains(word, autoescape=True)", "name.contains(word)", FOUND),
    ("the letter case of the words read", SEARCH,
     "    words = dict.fromkeys(wanted.lower().split())\n",
     "    words = dict.fromkeys(wanted.split())\n", FOUND),
    ("a live conflict in an order's words", DEBT,
     "  if (said === CONFLICT_TEXT)\n", "  if (false)\n", LIVE),
    ("a live request refused in an order's words", DEBT,
     "  if (said === INVALID_TEXT)\n", "  if (false)\n", LIVE),
    ("a live write-off refused called a payment", DEBT,
     '  const what = kind === "payment" ? "Внесок" : "Списання";\n', '  const what = "Внесок";\n',
     LIVE),
    ("a kept conflict not proven unrecorded in an order's words", ERRORS,
     "    if (text === CONFLICT_TEXT)\n      return `${what} ще не",
     "    if (false)\n      return `${what} ще не", KEPT),
    ("a kept request refused not proven unrecorded in an order's words", ERRORS,
     "    if (text === INVALID_TEXT)\n      return `${what} ще не",
     "    if (false)\n      return `${what} ще не", KEPT),
    ("a kept write-off still unconfirmed called «він»", ERRORS,
     '    const twice = `Перевірте результат ще раз — двічі ${kind === "payment" ? "він" : "воно"} не запишеться.`;\n',
     "    const twice = `Перевірте результат ще раз — двічі він не запишеться.`;\n", KEPT),
    ("a kept write-off still unconfirmed called a payment", APP,
     "            creditCommand.pending?.body.kind ?? creditRefused.kind,\n",
     "            creditRefused.kind,\n", KEPT),
    ("a refused write-off's kind drawn after its words", APP,
     "        flushSync(() => {\n",
     "        ((f: () => void) => {\n          f();\n        })(() => {\n", KEPT),
    ("a kept write-off's button named a payment's", APP,
     '              : "Перевірити результат списання"}\n',
     '              : "Перевірити результат внеску"}\n', KEPT),
    ("a kept conflict recorded nothing in an order's words", ERRORS,
     "  if (why === CONFLICT_TEXT)\n", "  if (false)\n", KEPT),
    ("a kept request refused recorded nothing in an order's words", ERRORS,
     "  if (why === INVALID_TEXT)\n", "  if (false)\n", KEPT),
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
