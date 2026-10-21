"""Break «Борги»'s task list's last three and the owner's two answers after
#112, one way at a time: each must fail a journey or a test. A number
written off here and owing a closed store says what it owes there, alone,
never the write-off, even for a moment, however late the closed stores
answer; a Latin «ï» typed as one sign is «ї» in the debts' search; a kept
payment on a phone whose person may not open «Борги» never turns to it,
and whoever may still does; while «Борги» is read, the store's card and
three rows of debts keep their places, round marks and grey lines whose
sizing text is never seen, the card hidden from a screen reader, and the
field does not move; the pills by what they mean, a payment from paper's
mark in the warning's colour, each at 4.5:1 in both themes, the meta at
14 px.

Each mutant runs its journeys against the isolated E2E API
(`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run, or its backend
test on the isolated test cluster. The unchanged tree runs first, with
everything any mutant names, and must pass; each mutant names what failed.
An optional argument runs only the mutants whose names contain one of its
parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
TERMS = "frontend/src/credits/Terms.tsx"
APP = "frontend/src/App.tsx"
LIST = "frontend/src/credits/Credits.tsx"
ROW = "frontend/src/credits/CustomerRow.tsx"
CSS = "frontend/src/styles.css"
SERVICE = "backend/app/modules/credit/service.py"

TILL = ["e2e/credits.spec.ts", "-g", "written off, and says nothing"]
RIGHT = ["e2e/outage.spec.ts", "-g", "may no longer open «Борги»"]
WITH = ["e2e/outage.spec.ts", "-g", "may take payments still turns"]
PLACES = ["e2e/credits-list.spec.ts", "-g", "while «Борги» is read"]
THEMES = ["e2e/credits-list.spec.ts", "-g", "each pill is by what it means"]
LETTER = ["backend:tests/integration/test_customer_credit.py::test_a_letter_pasted_in_two_parts_is_the_letter"]

M = [
    ("a write-off here said beside a closed store's debt", TERMS,
     "        !away.isPending &&\n        !owesAway ? (", "        !away.isPending ? (", TILL),
    ("a write-off here never said", TERMS,
     "writtenOff !== undefined &&\n        !away.isPending &&\n        !owesAway ? (",
     "writtenOff !== undefined &&\n        !away.isPending &&\n        false ? (", TILL),
    ("a write-off here said before slow closed stores answer", TERMS,
     "        !away.isPending &&\n        !owesAway ? (", "        !owesAway ? (", TILL),
    ("a Latin «ï» not folded", SERVICE,
     "chr(0x0456) + chr(0x0457)", "chr(0x0456) + chr(0x00EF)", LETTER),
    ("a kept payment turns to «Борги» without the right", APP,
     'if (canSeeCreditsNow.current) setTab("credits");', 'setTab("credits");', RIGHT),
    ("a kept payment never turns to «Борги»", APP,
     'if (canSeeCreditsNow.current) setTab("credits");', 'if (false) setTab("credits");', WITH),
    ("«Завантажуємо борги…» in words where the rows will be", LIST,
     '<Placeholder said="Завантажуємо борги…" rows={3} debts />',
     '<p role="status">Завантажуємо борги…</p>', PLACES),
    ("the rows' places as a return's", LIST,
     '<Placeholder said="Завантажуємо борги…" rows={3} debts />',
     '<Placeholder said="Завантажуємо борги…" rows={3} />', PLACES),
    ("no place for the store's card", LIST,
     "        summary.isPending && (\n", "        false && (\n", PLACES),
    ("the card's place read to a screen reader", LIST,
     '<div className="owed-card owed-place" aria-hidden="true">',
     '<div className="owed-card owed-place">', PLACES),
    ("a placeholder row's mark square", CSS,
     ".debt-mark.skeleton {\n  border-radius: 999px;", ".debt-mark.skeleton {\n  border-radius: 10px;", PLACES),
    ("the card's sizing figures seen", CSS,
     ".skeleton-line > span {\n  visibility: hidden;", ".skeleton-line > span {\n  visibility: visible;", PLACES),
    ("a payment from paper's mark not a warning", CSS,
     ".paper-meta {\n  color: var(--warn);", ".paper-meta {\n  color: var(--text-2);", THEMES),
    ("«Сплачено» neutral", ROW,
     '"SETTLED" ? "badge" : "badge neutral"', '"SETTLED" ? "badge neutral" : "badge neutral"', THEMES),
    ("«Списано» and «Нічого не винні» in the accent", ROW,
     '"SETTLED" ? "badge" : "badge neutral"', '"SETTLED" ? "badge" : "badge"', THEMES),
    ("another store's pill in the accent", ROW,
     '            <span className="badge neutral">\n', '            <span className="badge">\n', THEMES),
    ("a neutral pill unreadable", CSS,
     ".badge.neutral {\n  background: var(--field);\n  color: var(--text-2);",
     ".badge.neutral {\n  background: var(--field);\n  color: var(--line-strong);", THEMES),
    ("the meta at 13 px", CSS,
     ".credits .sale-meta {\n  font-size: 14px;", ".credits .sale-meta {\n  font-size: 13px;", THEMES),
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
