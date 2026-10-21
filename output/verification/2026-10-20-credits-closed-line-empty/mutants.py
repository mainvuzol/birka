"""Break a letter pasted in two parts, the till's line of a closed store's
debt, and an empty «Борги» that teaches, one way at a time: each must fail a
test. «ї» in two parts the letter, in the name stored and in the words typed;
the closed stores asked for what is still owed there, by name, the lines
coming together; the empty list saying where a debt begins, «Новий продаж»
only for whoever may sell, leading to the till's search.

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
TERMS = "frontend/src/credits/Terms.tsx"
LIST = "frontend/src/credits/Credits.tsx"
APP = "frontend/src/App.tsx"
STYLES = "frontend/src/styles.css"

FOUND = ["backend:tests/integration/test_customer_credit.py"]
TILL = ["e2e/credits.spec.ts", "-g", "written off, and says nothing"]
EMPTY = ["e2e/credits-list.spec.ts", "-g", "empty «Борги»"]

M = [
    ("a stored letter in two parts not the letter", SEARCH,
     "    name = func.normalize(\n        func.translate(func.lower(CustomerCredit.customer_name), _SAME_FROM, _SAME_TO),\n        literal_column(\"NFC\"),\n    )\n",
     "    name = func.translate(func.lower(CustomerCredit.customer_name), _SAME_FROM, _SAME_TO)\n",
     FOUND),
    ("a typed letter in two parts not the letter", SEARCH,
     'unicodedata.normalize("NFC", wanted.lower().translate(_SAME))',
     "wanted.lower().translate(_SAME)", FOUND),
    ("one form before the fold, a Latin «i» and its dots not «ї»", SEARCH,
     'unicodedata.normalize("NFC", wanted.lower().translate(_SAME))',
     'unicodedata.normalize("NFC", wanted.lower()).translate(_SAME)', FOUND),
    ("the closed stores not asked", TERMS,
     "&status=OPEN&elsewhere=true&query=", "&status=OPEN&query=", TILL),
    ("a closed store's line after this store's", TERMS,
     "    !read.isPending &&\n    (!away.isPending || waited);\n", "    !read.isPending;\n", TILL),
    ("this store's line held while the closed stores are slow", TERMS,
     "(!away.isPending || waited)", "!away.isPending", TILL),
    ("this store's line held when the closed stores fail", TERMS,
     "(!away.isPending || waited)", "(away.isSuccess || waited)", TILL),
    ("the closed store not named", TERMS,
     "awayStores.length === 1", "awayStores.length === 0", TILL),
    ("closed stores counted by name", TERMS,
     "[credit.store_id, visible(credit.store_name)]",
     "[credit.store_name, visible(credit.store_name)]", TILL),
    ("the closed store's line on two lines", STYLES,
     ".number-debt .away {\n  white-space: nowrap;\n", ".number-debt .away {\n", TILL),
    ("an empty list that does not teach", LIST,
     "        ) : owedOnly && !readOnly ? (\n", "        ) : false ? (\n", EMPTY),
    ("a store that does not trade taught to sell", LIST,
     "        ) : owedOnly && !readOnly ? (\n", "        ) : owedOnly ? (\n", EMPTY),
    ("the paid and written off taught where a debt begins", LIST,
     "        ) : owedOnly && !readOnly ? (\n", "        ) : !readOnly ? (\n", EMPTY),
    ("«Новий продаж» for whoever may not sell", APP,
     '              trading && store.permissions.includes("sale:create")\n                ? () => {\n                    setSearchFirst(true);\n',
     '              trading\n                ? () => {\n                    setSearchFirst(true);\n', EMPTY),
    ("«Новий продаж» not at the till's search", APP,
     '              trading && store.permissions.includes("sale:create")\n                ? () => {\n                    setSearchFirst(true);\n',
     '              trading && store.permissions.includes("sale:create")\n                ? () => {\n                    setSearchFirst(false);\n', EMPTY),
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
