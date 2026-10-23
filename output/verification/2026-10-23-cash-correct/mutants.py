"""Break the owner's and managers' correction (cash task list, P2-4) one way
at a time: each must fail a journey or a test. The day a switch —
«Вчора» yesterday, «Інший день» nothing until a day is chosen, the calendar
only for it, each the drawer's day from 06:00; a row an operation — its
title, its sum beside it, its goods the row's width, the close it fell in
as the server names it, why it may not be changed, not pressed and not
faded, its way under the goods, «· виправлено», long words broken; a
refusal gone with another day; one chosen, the line of the close it
explains under its card, never a plate; the server's «Розмін» where cash
put in explains a close.

Each mutant runs its journeys against the isolated E2E API
(`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run, or its tests on
the isolated test cluster (`unit-env.sh`). The unchanged tree runs first,
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
CASH = "frontend/src/cash/Cash.tsx"
FIX = "frontend/src/cash/Fix.tsx"
CSS = "frontend/src/styles.css"

YESTERDAY = ["e2e/cash-correct.spec.ts", "-g", "yesterday's operation"]
TODAY = ["e2e/cash-correct.spec.ts", "-g", "today's operation"]
OTHER = ["e2e/cash-correct.spec.ts", "-g", "another day is chosen"]
BEFORE = ["e2e/cash-correct.spec.ts", "-g", "before the drawer was first counted"]
NIGHT = ["e2e/cash-correct.spec.ts", "-g", "at 00:30"]
REFUSED = ["e2e/cash-correct.spec.ts", "-g", "a refusal is said over the day"]
THEMES = ["e2e/cash-correct.spec.ts", "-g", "theme the days"]
OUTSIDE = ["e2e/outside-text.spec.ts"]
SERVER = ["backend:tests/integration/test_cash_corrections.py", "backend:tests/integration/test_cash_movements.py"]

M = [
    ("«Вчора» reads today", CASH,
     '"yesterday" ? cashDay(1) : other;', '"yesterday" ? cashDay(0) : other;', YESTERDAY),
    ("«Сьогодні» by the calendar, not the drawer's day", CASH,
     'which === "today" ? cashDay(0) :', 'which === "today" ? isoDay(new Date()) :', NIGHT),
    ("the drawer's day from midnight", "frontend/src/cash/format.ts",
     "  const at = new Date(Date.now() - 6 * 60 * 60 * 1000);\n  at.setDate(at.getDate() - days);",
     "  const at = new Date(Date.now());\n  at.setDate(at.getDate() - days);", NIGHT),
    ("«Інший день» opens on today", CASH,
     '  const [other, setOther] = useState("");',
     "  const [other, setOther] = useState(() => cashDay(0));", OTHER),
    ("«Інший день» reads with no day", CASH,
     "    enabled: valid,\n    retry: false,\n  });\n  return (\n    <section className=\"cash-fix\">",
     "    enabled: true,\n    retry: false,\n  });\n  return (\n    <section className=\"cash-fix\">", OTHER),
    ("the calendar for every day", CASH,
     '          {which === "other" && (', "          {true && (", YESTERDAY),
    ("a refusal kept over another day", CASH,
     "                  setOther(event.target.value);\n                  setProblem(null);",
     "                  setOther(event.target.value);", REFUSED),
    ("a row's title out of order", CASH,
     '{targetLabels[event.target]} · {timeOf(event.at)} ·{" "}',
     '{timeOf(event.at)} · {targetLabels[event.target]} ·{" "}', YESTERDAY),
    ("a row's goods with their hidden characters", CASH,
     "                          visible(event.label),", "                          event.label,",
     OUTSIDE),
    ("a row without the close it fell in", CASH,
     "                          event.close_day\n                            ? `закриття ${dayOf(event.close_day)}`",
     "                          null\n                            ? `закриття ${dayOf(event.close_day)}`", OTHER),
    ("the card without the close it explains", CASH,
     "                ? chosen.close_day\n", "                ? null\n", OTHER),
    ("a row that may not be changed silent why", CASH,
     '                          event.may_change ? null : "змінити не можна",',
     "                          null,", BEFORE),
    ("a row that may not be changed pressed", CASH,
     "                    disabled={!event.may_change}\n", "", BEFORE),
    ("a row that may not be changed faded", CSS,
     ".correct-row:disabled {\n  opacity: 1;", ".correct-row:disabled {\n  opacity: 0.45;", BEFORE),
    ("a corrected way without «виправлено»", CASH,
     '                        {event.corrected ? " · виправлено" : ""}',
     '                        {""}', YESTERDAY),
    ("the sum before what it is", CSS,
     ".correct-row .history-sum {\n  white-space: nowrap;",
     ".correct-row .history-sum {\n  order: -1;\n  white-space: nowrap;", THEMES),
    ("the goods beside the sum, not under", CSS,
     ".correct-head {\n  display: flex;", ".correct-head {\n  display: contents;", THEMES),
    ("a long name under the sum", CSS,
     ".correct-row {\n  overflow-wrap: anywhere;", ".correct-row {\n  overflow-wrap: normal;", THEMES),
    ("a closed day's note back on a plate", FIX,
     '      {closedNote && <p className="fix-note">{closedNote}</p>}',
     '      {closedNote && <p className="notice">{closedNote}</p>}', YESTERDAY),
    ("the server naming no close", "backend/app/modules/cash/read.py",
     "            close_day=None if event.row.period is None else days.get(event.row.period),",
     "            close_day=None,", SERVER),
    ("the server naming the close before", "backend/app/modules/cash/read.py",
     "    return {row.number: row.business_day for row in rows}",
     "    return {row.number + 1: row.business_day for row in rows}", SERVER),
    ("cash put in explained in the old words", "backend/app/modules/cash/read.py",
     '    MovementKind.CHANGE.value: "Розмін",',
     '    MovementKind.CHANGE.value: "Внесено в касу (розмін)",', SERVER),
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
