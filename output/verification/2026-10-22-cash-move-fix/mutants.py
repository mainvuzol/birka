"""Break «Каса»'s cash taken out and put in (cash task list, P1-2) and a way
of payment changed (P1-3) one way at a time: each must fail a journey. What
for as chips, nothing chosen for the person; the chip puts the cursor in
the sum; cash put in starts in the sum; a sum still typed is no error, and
nothing is not to be sent; the button names the sum, and is not to be
pressed without a kind; a buzz when recorded or refused, the cursor back
after a refusal; unanswered, the form held with what was typed, left once
confirmed; from the count, «← Підрахунок». The operation's time, sum and way; the way it has now
marked and not to be chosen; read again, a way it now has is no longer
chosen and the cursor on a way to choose; an order's five ways a row each;
an earlier day by its date; the manager's refusal said; the panel saying
what to choose; the seller's two kinds in one row, the chosen way marked.

Each mutant runs its journeys against the isolated E2E API
(`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run. The unchanged
tree runs first, with everything any mutant names, and must pass; each
mutant names what failed. An optional argument runs only the mutants whose
names contain one of its parts, separated by "|".
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
MOVE = "frontend/src/cash/Move.tsx"
FIX = "frontend/src/cash/Fix.tsx"
CSS = "frontend/src/styles.css"

OUT = ["e2e/cash-move-fix.spec.ts", "-g", "«Видати з каси»: what for as chips"]
IN = ["e2e/cash-move-fix.spec.ts", "-g", "«Внести в касу»: one kind"]
REFUSED = ["e2e/cash-move-fix.spec.ts", "-g", "cash taken out and refused"]
UNANSWERED = ["e2e/cash-move-fix.spec.ts", "-g", "cash taken out and unanswered"]
FROM_COUNT = ["e2e/cash-close.spec.ts", "-g", "cash taken out is recorded from the count"]
SELLER = ["e2e/cash-move-fix.spec.ts", "-g", "the seller's operations as rows"]
ORDER = ["e2e/cash-move-fix.spec.ts", "-g", "an order's sale offers its five ways"]
MANAGER = ["e2e/cash-move-fix.spec.ts", "-g", "the owner's and managers' correction"]
THEME = ["e2e/cash-move-fix.spec.ts", "-g", "theme cash taken out and a way changed"]

M = [
    ("a kind chosen for the person", MOVE,
     "    kinds.length === 1 ? (kinds[0] ?? null) : null,", "    kinds[0] ?? null,", OUT),
    ("the chip leaving the cursor on itself", MOVE,
     "                // Chosen: the sum next, the keyboard already up.\n                field.current?.focus();\n",
     "", OUT),
    ("cash put in without the cursor in the sum", MOVE,
     "    if (kinds.length === 1) field.current?.focus();", "    if (false) field.current?.focus();", IN),
    ("a sum of nothing to be sent", MOVE,
     "  const sum = cents !== null && cents > 0n ? cents : null;", "  const sum = cents;", OUT),
    ("a sum still being typed said to be wrong", MOVE,
     'kopecks(amount.trim().replace(/[.,]$/, ""))', "kopecks(amount.trim())", OUT),
    ("the button pressed without a kind", MOVE,
     "          disabled={disabled || kind === null || sum === null}",
     "          disabled={disabled || sum === null}", OUT),
    ("the button not naming the sum", MOVE,
     "          {sum === null ? verb : `${verb} ${money(decimal(sum))}`}", "          {verb}", OUT),
    ("no buzz for cash recorded", MOVE,
     '      buzz("success");\n      back(movementDone', "      back(movementDone", OUT),
    ("no buzz for cash refused", MOVE,
     '      buzz("error");\n      setProblem(cashErrorText(outcome.error));',
     "      setProblem(cashErrorText(outcome.error));", REFUSED),
    ("cash unanswered taken off its form", MOVE,
     "      requestAnimationFrame(() => field.current?.focus());\n    }\n",
     "      requestAnimationFrame(() => field.current?.focus());\n    } else if (outcome.kind === \"unknown\") back(null);\n",
     UNANSWERED),
    ("the cursor not back in the sum after a refusal", MOVE,
     "      requestAnimationFrame(() => field.current?.focus());\n", "", REFUSED),
    ("the way back from the count called «Каса»", MOVE,
     '        {from === "count" ? "Підрахунок" : "Каса"}', '        {"Каса"}', FROM_COUNT),
    ("confirmed under its form, the form left open", "frontend/src/cash/Cash.tsx",
     "        else\n          setStep((now) =>\n            now.name === \"move\"",
     "        else\n          ((now: Step) =>\n            now.name === \"move\"",
     UNANSWERED),
    ("the operation's time not said", FIX,
     '              chosen.at === undefined ? "" : ` · ${momentOf(chosen.at)}`', '              ""', SELLER),
    ("the way it has now to be chosen", FIX,
     "            disabled={disabled || way === current}", "            disabled={disabled}", SELLER),
    ("«зараз» not said", FIX,
     '            {way === current && <span className="fix-now"> зараз</span>}',
     '            {false && <span className="fix-now"> зараз</span>}', SELLER),
    ("the pill without the way", FIX,
     "          Зараз: {wayName(current)}", "          Зараз:", SELLER),
    ("the panel not saying what to choose", FIX,
     '            ? "Оберіть новий спосіб"', '            ? "Змінити"', SELLER),
    ("a way read again still chosen", FIX,
     "  const to = picked === current ? null : picked;", "  const to = picked;", ORDER),
    ("an order's ways cut to the till's", FIX,
     "            ways={waysFor(answer.is_order)}", "            ways={waysFor(false)}", ORDER),
    ("no buzz for a way changed", FIX,
     '                buzz("success");\n                back(correctionDone(outcome.result as Correction));\n              } else if (outcome.kind === "refused") {\n                buzz("error");\n                // A way',
     '                back(correctionDone(outcome.result as Correction));\n              } else if (outcome.kind === "refused") {\n                buzz("error");\n                // A way',
     SELLER),
    ("no buzz for a way refused", FIX,
     '                buzz("error");\n                // A way changed meanwhile is read again (B6.1).',
     "                // A way changed meanwhile is read again (B6.1).", ORDER),
    ("the manager's refusal lost with its card", "frontend/src/cash/Cash.tsx",
     "                setChosen(null);\n                setProblem(cashErrorText(outcome.error));\n",
     "                setChosen(null);\n", MANAGER),
    ("a way refused, the cursor nowhere", FIX,
     '                if (text !== null)\n                  requestAnimationFrame(',
     '                if (text === "never")\n                  requestAnimationFrame(', ORDER),
    ("an earlier day by its time alone", FIX,
     "    ? timeOf(at)\n    : whenOf(at);", "    ? timeOf(at)\n    : timeOf(at);", SELLER),
    ("the manager's card without its way changed", "frontend/src/cash/Cash.tsx",
     '                buzz("success");\n                back(correctionDone(outcome.result as Correction));\n              } else if (outcome.kind === "refused") {\n                buzz("error");\n                setChosen(null);',
     '                back(correctionDone(outcome.result as Correction));\n              } else if (outcome.kind === "refused") {\n                buzz("error");\n                setChosen(null);',
     MANAGER),
    ("the seller's two kinds in two rows", CSS,
     ".cash-move .chip {\n  padding: 8px 10px;\n  font-size: 15px;",
     ".cash-move .chip {\n  padding: 8px 14px;\n  font-size: 17px;", OUT),
    ("an order's five ways in three columns", CSS,
     ".fix-ways-rows {\n  grid-template-columns: minmax(0, 1fr);",
     ".fix-ways-rows {\n  grid-template-columns: repeat(3, minmax(0, 1fr));", ORDER),
    ("the chosen way not marked", CSS,
     '.fix-ways button[aria-pressed="true"] {\n  border-color: var(--accent);\n  background: var(--accent);',
     '.fix-ways button[aria-pressed="true"] {\n  border-color: var(--accent);\n  background: var(--field);', THEME),
]

KNOWN = "the owner is shown last night's failed copy, and why Telegram did not say so"


def screen(specs: list[str]) -> subprocess.CompletedProcess[str]:
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
