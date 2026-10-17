"""Break one sale's return and its result one way at a time: each must
fail a journey (returns task list, P0-3, P0-4, P0-5).

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
APP = "frontend/src/App.tsx"
SALE = "frontend/src/sales/Sale.tsx"

SCREEN = ["e2e/returns-sale-screen.spec.ts"]
RET = ["e2e/returns.spec.ts"]
CRED = ["e2e/credits.spec.ts", "-g", "a return of a sale paid in parts"]
PAPER = ["e2e/outage-mark-debts-returns.spec.ts"]
ELSEWHERE = ["e2e/returns-elsewhere.spec.ts"]
RECEIPT = ["e2e/till-receipt.spec.ts", "-g", "returned from its own receipt"]
TILL = ["e2e/till-redesign.spec.ts", "-g", "panel"]

M = [
    ("a unit is preset intact", RETURNS, "const none = { intact: 0, damaged: 0 };",
     "const none = { intact: 1, damaged: 0 };", SCREEN + RET),
    ("«+» goes past what may come back", RETURNS,
     "          const room = entered.intact + entered.damaged < left;\n",
     "          const room = true;\n", RET),
    ("«−» goes below none", RETURNS, "          disabled={value <= 0}\n",
     "          disabled={false}\n", RET),
    ("«Пошкоджені» counts as intact", RETURNS,
     '                    set(item.id, "damaged", value, from);\n',
     '                    set(item.id, "intact", value, from);\n', RET),
    ("the reason is open from the start", RETURNS,
     "  const [asking, setAsking] = useState(false);\n",
     "  const [asking, setAsking] = useState(true);\n", RET),
    ("the panel shows before a unit is counted", RETURNS, "  const shown = units > 0;\n",
     "  const shown = true;\n", SCREEN),
    ("the panel's sum is the sale's", RETURNS, "            <Sum value={sum} />\n",
     "            <Sum value={money(sale.total)} />\n", SCREEN),
    ("a way not read is not said", RETURNS, "          {paid.isError && (\n",
     "          {false && (\n", SCREEN),
    ("the sale's way is not offered", RETURNS,
     "  const way = chosenWay ?? (isTillMethod(suggested) ? suggested : null);\n",
     "  const way = chosenWay;\n", SCREEN + RET),
    ("the panel's button is not held with the app", RETURNS,
     "              blocked ||\n              working ||\n              !ready ||\n",
     "              !ready ||\n", RET),
    ("the panel's ways are not held with the app", RETURNS,
     '          <fieldset className="way-switch" disabled={blocked || working}>\n',
     '          <fieldset className="way-switch">\n', RET),
    ("the counted tag is left under the panel", RETURNS,
     '    touched.current?.scrollIntoView({ block: "nearest" });\n  }, [counts]);\n',
     "    void 0;\n  }, [counts]);\n", SCREEN),
    ("the count is heard without its row", RETURNS,
     '          <span className="visually-hidden">{name}: </span>\n', "", SCREEN),
    ("from paper, the panel's large line hides it", RETURNS,
     '            {mark.paper && "З паперу · "}\n', "", SCREEN),
    ("from paper, the parts' note says what comes later", RETURNS,
     "          {sale.paid_in_parts && !mark.paper && (\n",
     "          {sale.paid_in_parts && (\n", SCREEN),
    ("a sale in parts must have a way", RETURNS,
     "              (!sale.paid_in_parts && way === null)\n", "              (way === null)\n",
     SCREEN),
    ("a refusal is left where it is", RETURNS,
     '      refusalRef.current?.scrollIntoView({ block: "nearest" });\n', "      void 0;\n",
     SCREEN),
    ("the warehouse is not asked for", RETURNS,
     "    if (intact > 0 && !item.back_to_sold_from && !place) unplaced = true;\n", "",
     ELSEWHERE),
    ("the parts' note is not said", RETURNS,
     "          {sale.paid_in_parts && !mark.paper && (\n            // How far the debt falls",
     "          {false && (\n            // How far the debt falls", CRED),
    ("the result does not replace the form", RETURNS, "  if (done)\n    return (\n",
     "  if (false)\n    return (\n", SCREEN),
    ("«Ще повернення» loses the search", RETURNS,
     "        more={() => {\n          setDone(null);\n        }}\n",
     '        more={() => {\n          setDone(null);\n          setQuery("");\n        }}\n', RET),
    ("the result's sum is worked out, not the server's", RESULT,
     "  const amount = credit ? credit.cash_back : refund.total_amount;\n",
     '  const amount = credit\n    ? credit.cash_back\n    : String(sent.reduce((n, part) => n + part.quantity * 3000, 0)) + ".00";\n',
     SCREEN),
    ("a paper return says to hand the money back", RESULT, "        ) : paper ? (\n",
     "        ) : false ? (\n", PAPER),
    ("nothing back shows a sum to hand", RESULT,
     "  const nothingBack = !!credit && (kopecks(credit.cash_back) ?? 0n) <= 0n;\n",
     "  const nothingBack = false;\n", CRED),
    ("the screen reader hears no sentence", RESULT,
     '            <p className="visually-hidden">{handBack(amount, way)}</p>\n',
     '            <p className="visually-hidden"></p>\n', RET),
    ("«Брак» is pointed to for everyone", RESULT,
     '            {store.permissions.includes("damaged:handle") &&\n',
     "            {true &&\n", SCREEN),
    ("«Новий продаж» for whoever may not sell", APP,
     '              store.permissions.includes("sale:create")\n                ? () => {\n',
     "              true\n                ? () => {\n", SCREEN),
    ("«Новий продаж» leaves the search without the cursor", APP,
     "                    setSearchFirst(true);\n", "                    setSearchFirst(false);\n",
     RECEIPT),
    ("the till's panel keeps no room", SALE, "  usePanelRoom(panelRef, draft.length > 0);\n",
     "  usePanelRoom(panelRef, false);\n", TILL),
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
