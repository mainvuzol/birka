"""Break the other stores' offer, the warehouse chips, a mistake's mending
and the line for goods sold before Бірка one way at a time: each must fail a
journey (returns task list, P1-1, P1-5, P1-6).

A mutant in the screens runs its journeys against the isolated E2E API
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
RETURNS = "frontend/src/returns/Returns.tsx"
RESULT = "frontend/src/returns/Result.tsx"
PLACES = "frontend/src/returns/places.ts"

LIST = ["e2e/returns-list.spec.ts"]
ELSEWHERE = ["e2e/returns-elsewhere.spec.ts"]
SCREEN = ["e2e/returns-sale-screen.spec.ts"]
RET = ["e2e/returns.spec.ts", "-g", "one coat back"]
CRED = ["e2e/credits.spec.ts", "-g", "a return of a sale paid in parts"]

M = [
    ("the other stores offered before two letters", RETURNS,
     "  const offerElsewhere = !away && search.length >= 2 && search === query.trim();\n",
     "  const offerElsewhere = !away;\n", LIST),
    ("the other stores never offered", RETURNS,
     "  const offerElsewhere = !away && search.length >= 2 && search === query.trim();\n",
     "  const offerElsewhere = false;\n", LIST + ELSEWHERE),
    ("switching shows this store's rows under the other stores' heading", RETURNS,
     "    ) => (before?.queryKey[2] === away ? previous : undefined),\n",
     "    ) => previous,\n", LIST),
    ("the other stores' results unheaded", RETURNS,
     "          <h3>В інших магазинах мережі</h3>\n", "", LIST),
    ("no way back to this store", RETURNS,
     '            onClick={() => {\n              setElsewhere(false);\n            }}\n          >\n            <span aria-hidden="true">← </span>',
     '            onClick={() => undefined}\n          >\n            <span aria-hidden="true">← </span>',
     LIST),
    ("the field cleared keeps the other stores", RETURNS,
     "    if (!words) setElsewhere(false);\n", "    if (false) setElsewhere(false);\n", LIST),
    ("goods before Бірка said in the other stores too", RETURNS,
     "      {!away &&\n        search !== \"\" &&\n", "      {true &&\n        search !== \"\" &&\n", LIST),
    ("goods before Бірка never said", RETURNS,
     "      {!away &&\n        search !== \"\" &&\n", "      {false &&\n        search !== \"\" &&\n", LIST),
    ("a warehouse chosen beforehand", RETURNS,
     "    const place = places[item.id];\n",
     "    const place = places[item.id] ?? ownPlaces.data?.[0]?.id;\n", ELSEWHERE),
    ("«Брак» offered as a chip", PLACES, "          !location.damaged_returns,\n",
     "          true,\n", ELSEWHERE),
    ("a mistake's mending not said", RESULT,
     '        <p className="hint return-mistake">\n',
     '        <p className="hint return-mistake" hidden>\n', RET + SCREEN),
    ("the till offered to whoever may not sell", RESULT, "  const sell = sells\n",
     "  const sell = true\n", SCREEN),
    ("«Брак» offered to whoever may not handle it", RESULT, "    : handlesDamaged\n",
     "    : true\n", SCREEN),
    ("«Брак» said when nothing damaged came back", RESULT, "  const first = !damaged\n",
     "  const first = false\n", SCREEN),
    ("a sale in parts mended at the till", RESULT, "  if (inParts)\n", "  if (false)\n", CRED),
    ("a mistake's mending on a kept notice", RESULT,
     "      {!kept && (\n        // How a mistaken return is mended",
     "      {true && (\n        // How a mistaken return is mended", SCREEN),
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
