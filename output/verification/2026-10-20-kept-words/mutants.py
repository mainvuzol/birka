"""Break a kept command's words for a server's error, and the manager asked
for after three «not found», one way at a time: each must fail a journey.
A kept sale, delivery, stock correction, stocktake count, drawer command and
order step answered with a server's error or «not found» is still
unconfirmed, by its own name, never «спробуйте ще раз», the request's number
kept; from the third «not found» in a row a manager is asked, and any other
answer begins the count again — in the sale's store, the shared journal and
the orders' store; an order's step refused at its first press, or answered
and only its reading failed, keeps the shared words; a step kept at its
first press is named; a movement of the drawer by its way.

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
ERRORS = "frontend/src/cash/errors.ts"
STOCKTAKE = "frontend/src/inventory/Stocktake.tsx"
SALES = "frontend/src/sales/commands.ts"
JOURNAL = "frontend/src/shared/journal.ts"
ORDERS = "frontend/src/orders/commands.ts"

SALE = ["e2e/outage.spec.ts", "-g", "a kept sale a server fails to answer|once per return"]
STOCK = ["e2e/outage.spec.ts", "-g", "a kept stock correction a server fails|a kept delivery a server|a kept stocktake's count"]
ORDER = ["e2e/outage.spec.ts", "-g", "kept order step whose resend|kept order step answered «not found»"]
CREDIT = ["e2e/outage.spec.ts", "-g", "a kept payment answered «not found»"]
CASH = ["e2e/cash.spec.ts", "-g", "server fails to answer"]
RETURN = ["e2e/outage.spec.ts", "-g", "a kept return answered «not found»"]
ACK = ["e2e/outage.spec.ts", "-g", "order step the server answered"]
READBACK = ["e2e/outage.spec.ts", "-g", "reading back failed"]
FIRST = ["e2e/credits.spec.ts", "-g", "order collected without paying"]
APP = "frontend/src/App.tsx"

M = [
    ("a kept sale's server error told to try again", ERRORS,
     '  return keptUnconfirmed(error, "Продаж", "він", misses) ?? errorText(error);\n',
     "  return errorText(error);\n", SALE),
    ("a kept delivery's server error told to try again", ERRORS,
     '    : (keptUnconfirmed(error, "Приймання", "воно", misses) ?? errorText(error));\n',
     "    : errorText(error);\n", STOCK),
    ("a kept correction's server error told to try again", ERRORS,
     '      keptUnconfirmed(error, "Коригування", "воно", misses) ?? errorText(error)\n',
     "      errorText(error)\n", STOCK),
    ("a kept count's server error told to try again", STOCKTAKE,
     '      keptUnconfirmed(error, "Підрахунок", "він", misses) ?? errorText(error)\n',
     "      errorText(error)\n", STOCK),
    ("a kept drawer command's server error told to try again", ERRORS,
     "          : keptNames[command]),\n        misses,\n      ) ?? errorText(error)",
     "          : keptNames[command]),\n        misses,\n      ) && errorText(error)", CASH),
    ("a drawer command named as another", ERRORS,
     '  correction: ["Зміну способу оплати", "вона"],\n', '  correction: ["Підрахунок", "він"],\n', CASH),
    ("a drawer's movement not named by its way", ERRORS,
     '        ...(command === "movement" && direction\n', '        ...(false && direction\n', CASH),
    ("a kept order step's server error told to try again", ERRORS,
     "  if (kept && !recordedNothing(error))\n", "  if (false)\n", ORDER),
    ("a step answered and only its reading failed called unconfirmed", APP,
     "            pending !== null && !pending.acknowledged,\n", "            pending !== null,\n", ACK),
    ("an order refused at its first press called unconfirmed", APP,
     "            pending !== null && !pending.acknowledged,\n", "            true,\n", FIRST),
    ("a step kept at its first press not named", APP,
     "            pending?.label ?? null,\n", "            null,\n", FIRST),
    ("a sale answered and only its reading failed called unconfirmed", ERRORS,
     "  if (recorded) return errorText(error);\n", "", READBACK),
    ("the request's number dropped", ERRORS,
     "    text.slice(FAILED_TEXT.length).trim(),\n", '    "",\n', SALE + ORDER),
    ("a manager never asked", ERRORS,
     '    misses >= 3 ? ASK_A_MANAGER : "",\n', '    "",\n', SALE),
    ("a manager asked at the first", ERRORS, "misses >= 3 ? ASK", "misses >= 1 ? ASK", SALE),
    ("a manager asked at the second", ERRORS, "misses >= 3 ? ASK", "misses >= 2 ? ASK", SALE),
    ("a manager asked only at the fourth", ERRORS, "misses >= 3 ? ASK", "misses >= 4 ? ASK", SALE),
    ("the sale's count never begun again", SALES,
     "            ? useSaleCommand.getState().misses + 1\n            : 0,\n",
     "            ? useSaleCommand.getState().misses + 1\n            : useSaleCommand.getState().misses,\n",
     SALE),
    ("the shared journal's count never kept", JOURNAL,
     "              ? use.getState().misses + 1\n", "              ? 0\n", CREDIT + RETURN),
    ("the shared journal's count never begun again", JOURNAL,
     "              ? use.getState().misses + 1\n              : 0,\n",
     "              ? use.getState().misses + 1\n              : use.getState().misses,\n", CREDIT),
    ("the orders' count never kept", ORDERS,
     "            ? misses + 1\n", "            ? 0\n", ORDER),
    ("the orders' count never begun again", ORDERS,
     "            ? misses + 1\n            : 0,\n", "            ? misses + 1\n            : misses,\n", ORDER),
    ("a delivery's banner not counting", APP,
     "receiptCommand.misses)", "0)", STOCK),
    ("a return's banner not counting", APP,
     "returnCommand.misses)", "0)", RETURN),
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
