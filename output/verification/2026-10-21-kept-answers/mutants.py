"""Break the owner's four answers about kept commands, one way at a time:
each must fail a journey. A kept command's «not found» count is written
beside it on the phone and read back when Telegram reopens the app — the
sale's, the shared journal's (a payment) and an order's step's — never sent,
and a count that is not one is none; a request the server did not take, a
400 or a 422 the shared words call «перевірте дані», says «… сервер не
прийняв запит …»; an order's step the server confirmed whose order cannot
be read says it is recorded and which button reads it again, but for a
phone that cannot reach the server.

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
JOURNAL = "frontend/src/shared/journal.ts"
SALES = "frontend/src/sales/commands.ts"
ORDERS = "frontend/src/orders/commands.ts"
APP = "frontend/src/App.tsx"
ERRORS = "frontend/src/cash/errors.ts"

SALE = ["e2e/outage.spec.ts", "-g", "a kept sale's «not found» count is kept"]
PAYMENT = ["e2e/outage.spec.ts", "-g", "a kept payment's «not found» count is kept"]
ORDER = ["e2e/outage.spec.ts", "-g", "a kept order step's «not found» count is kept"]
NOT_TAKEN = ["e2e/outage.spec.ts", "-g", "did not take the request"]
RECORDED = ["e2e/outage.spec.ts", "-g", "says it is recorded and how to read it again"]

M = [
    ("the shared journal's count never written", JOURNAL,
     "        keepCount(storageKey, current, misses);\n", "", PAYMENT),
    ("a payment's count never read back", APP,
     "useCreditCommand.setState({\n        pending: saved,\n        error: null,\n        // Its own count, kept beside it (owner decision, 2026-10-21).\n        misses: saved?.misses ?? 0,",
     "useCreditCommand.setState({\n        pending: saved,\n        error: null,\n        // Its own count, kept beside it (owner decision, 2026-10-21).\n        misses: 0,", PAYMENT),
    ("a count that is not one taken as one", JOURNAL,
     "      misses: countOf(value.misses),", "      misses: value.misses as number,", PAYMENT),
    ("the sale's count never written", SALES,
     "      keepCount(storageKey, current, misses);\n", "", SALE),
    ("a sale's count never read back", APP,
     "useSaleCommand.setState({\n        pending: saved,\n        error: null,\n        // Its own count, kept beside it (owner decision, 2026-10-21).\n        misses: saved?.misses ?? 0,",
     "useSaleCommand.setState({\n        pending: saved,\n        error: null,\n        // Its own count, kept beside it (owner decision, 2026-10-21).\n        misses: 0,", SALE),
    ("the sale's count sent with it", SALES,
     "sale = await api<Sale>(\"/sales\", token, current.body, current.key);",
     "sale = await api<Sale>(\n        \"/sales\",\n        token,\n        { ...current.body, misses: current.misses },\n        current.key,\n      );", SALE),
    ("an order step's count never read back", ORDERS,
     "    set({ pending, error: null, misses: pending?.misses ?? 0 });", "    set({ pending, error: null, misses: 0 });", ORDER),
    ("an order step's count never written", ORDERS,
     "      keepCount(key, current, misses);\n", "", ORDER),
    ("a request not taken said as a server's failure", ERRORS,
     "  const notTaken = (failed && error.status === 400) || text === INVALID_TEXT;",
     "  const notTaken = false;", NOT_TAKEN),
    ("a 400 not a request not taken", ERRORS,
     "  const notTaken = (failed && error.status === 400) || text === INVALID_TEXT;",
     "  const notTaken = text === INVALID_TEXT;", NOT_TAKEN),
    ("a 422 left in an order's words", ERRORS,
     "  const notTaken = (failed && error.status === 400) || text === INVALID_TEXT;",
     "  const notTaken = failed && error.status === 400;", NOT_TAKEN),
    ("a confirmed step told to try again", ERRORS,
     "  if (recorded) {", "  if (false) {", RECORDED),
    ("a confirmed step's words over an answer with words of its own", ERRORS,
     "    if (text.startsWith(FAILED_TEXT))\n      return [\n        `Операцію",
     "    if (true)\n      return [\n        `Операцію", RECORDED),
    ("a confirmed step's request number dropped", ERRORS,
     "        text.slice(FAILED_TEXT.length).trim(),\n      ]", "        \"\",\n      ]", RECORDED),
    ("a 422 of its own words said as a request not taken", ERRORS,
     "  const notTaken = (failed && error.status === 400) || text === INVALID_TEXT;",
     "  const notTaken =\n    (failed && error.status === 400) ||\n    (error instanceof ApiError && error.status === 422);", NOT_TAKEN),
    ("the step's being answered not passed", APP,
     "            // Answered: the step is recorded (owner decision, 2026-10-21).\n            pending?.acknowledged === true,",
     "            // Answered: the step is recorded (owner decision, 2026-10-21).\n            false,", RECORDED),
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
