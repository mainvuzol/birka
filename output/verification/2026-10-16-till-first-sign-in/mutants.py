"""Break the first sign-in and the kept sale's banner one way at a time: each must fail a journey.

Every mutant is in the screens, so each runs the journeys meant to catch it
against the isolated E2E API (`e2e-fresh.sh`, `e2e-run.sh`), reseeded
before every run. The unchanged tree runs first, with every journey any
mutant names, and must pass; each mutant names the journeys that failed.
An optional argument runs only the mutants whose names contain one of its
parts, separated by "|".
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
APP = "frontend/src/App.tsx"
COMMANDS = "frontend/src/sales/commands.ts"
CSS = "frontend/src/styles.css"

SIGN_IN = ["e2e/first-sign-in.spec.ts"]
SESSION = ["e2e/session.spec.ts"]
BANNER = ["e2e/outage.spec.ts", "-g", "banner says which sale|a card sale it confirms|captive portal"]
SHELF = ["e2e/shelf.spec.ts"]
SALE = ["e2e/sale.spec.ts"]

M = [
    ("the ID is called a number again", APP,
     "          Ваш Telegram ID: <strong className=\"telegram-id\">{id}</strong> — це не\n",
     "          Ваш номер у Telegram: <strong className=\"telegram-id\">{id}</strong> — це не\n",
     SIGN_IN),
    ("the copy is offered where the phone cannot copy", APP,
     "    id !== null && write !== undefined\n", "    id !== null\n", SIGN_IN),
    ("a copy made is not said", APP, "                setCopied(\"yes\");\n", "", SIGN_IN),
    ("a copy refused is not said", APP,
     "              () => {\n                setCopied(\"no\");\n              },\n",
     "              () => undefined,\n", SIGN_IN),
    ("the wrong text is copied", APP, "            write(String(id)).then(\n",
     "            write(\"\").then(\n", SIGN_IN),
    ("refused launch data speaks of a kept command", APP,
     "            : token === undefined &&\n", "            : false &&\n", SIGN_IN),
    ("a session ending after sign-in loses its words", APP,
     "            : token === undefined &&\n                failure instanceof ApiError &&\n",
     "            : failure instanceof ApiError &&\n", SESSION),
    ("the ID cannot be selected whole", CSS,
     "  user-select: all;\n  -webkit-user-select: all;\n", "", SIGN_IN),
    ("a line answered at the shelf counts what was asked", COMMANDS,
     "    const present = report === undefined ? asked : count(report.quantity);\n",
     "    const present = asked;\n", BANNER),
    ("paid in parts says the whole sum", COMMANDS, "  if (body.credit) {\n", "  if (false) {\n",
     BANNER),
    ("the banner names no way", APP,
     "  const how = way ? ` · ${methodLabels[way]}` : \"\";\n", "  const how = \"\";\n", BANNER),
    ("an attempt that does not read breaks the banner", COMMANDS,
     "    typeof value === \"string\" ? kopecks(value) : null;\n",
     "    kopecks(value as string);\n", BANNER),
    ("a kept empty shelf is said as a sale", APP,
     "                ? \"Запис нестачі ще не підтверджено\"\n",
     "                ? \"Продаж ще не підтверджено\"\n", SHELF),
    ("the confirmation says the old words", APP,
     "        Продаж записано один раз: разом {money(sale.total)}\n",
     "        Операцію було записано. Разом {money(sale.total)}\n", BANNER + ["e2e/sale.spec.ts"]),
    ("the heading keeps the old words", APP,
     "                : \"Продаж ще не підтверджено\"}\n", "                : \"Незавершений продаж\"}\n",
     SALE),
]

KNOWN = "the owner is shown last night's failed copy, and why Telegram did not say so"


def screen(specs: list[str]) -> subprocess.CompletedProcess[str]:
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run([str(H / "e2e-run.sh"), *specs], cwd=ROOT / "frontend", capture_output=True,
                          text=True, timeout=1800)


def failed(run: subprocess.CompletedProcess[str]) -> list[str]:
    titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                     if re.match(r"^\s+\[mobile-chromium\] › ", l)})
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
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)", flush=True)
        continue
    path.write_text(text.replace(old, new))
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
