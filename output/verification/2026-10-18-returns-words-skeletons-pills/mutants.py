"""Break the closing of «Повернення»'s task list one way at a time: each
must fail a test or a journey (P2-1, P2-3, P2-4, and the owner's answers of
2026-10-18 on a kept return's words and the other stores' two letters).

A mutant in the server runs its tests against the isolated test cluster
(`unit-env.sh`); one in the screens runs its journeys against the isolated
E2E API (`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run. The
unchanged tree runs first, with everything any mutant names, and must pass;
each mutant names what failed. An optional argument runs only the mutants
whose names contain one of its parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
SALES = "backend/app/api/v1/sales.py"
APP = "frontend/src/App.tsx"
ERRORS = "frontend/src/cash/errors.ts"
RETURNS = "frontend/src/returns/Returns.tsx"
ROW = "frontend/src/returns/SaleRow.tsx"
CSS = "frontend/src/styles.css"

BACK = ["backend:tests/integration/test_returns_elsewhere.py"]
OUTAGE = ["e2e/outage.spec.ts", "-g", "kept return"]
LIST = ["e2e/returns-list.spec.ts"]
SCREEN = ["e2e/returns-sale-screen.spec.ts"]

M = [
    ("one-letter words pass the other stores' rule", SALES,
     '        if not any(len(word) >= 2 for word in (q or "").split()):\n',
     '        if len((q or "").strip()) < 2:\n', BACK),
    ("a kept return turns to «Повернення» without the right", APP,
     '        if (canReturnNow.current) setTab("returns");\n', '        setTab("returns");\n', OUTAGE),
    ("an unconfirmed return's conflict in the shared words", ERRORS,
     "    return errorText(error) === CONFLICT_TEXT\n", "    return false\n", OUTAGE),
    ("a kept conflict names no section", ERRORS,
     "Поверніться до списку в «Поверненні» й спробуйте ще раз.", "Поверніться до списку й спробуйте ще раз.",
     OUTAGE),
    ("one-letter words offer the other stores", RETURNS,
     "    .some((word) => Array.from(word).length >= 2);\n",
     "    .some((word) => word.length >= 1);\n", LIST),
    ("the rows' places not kept while read", RETURNS,
     '        <Placeholder said="Завантажуємо продажі…" rows={3} />\n',
     '        <p role="status">Завантажуємо продажі…</p>\n', LIST),
    ("a debt's pill like any other", ROW, '          <span className="badge debt">Оплата частинами</span>\n',
     '          <span className="badge">Оплата частинами</span>\n', LIST),
    ("the paper's pill not a warning", ROW, '          <span className="badge warn">\n',
     '          <span className="badge">\n', LIST),
    ("all returned not neutral", ROW, '          <span className="badge neutral">Усе вже повернено</span>\n',
     '          <span className="badge">Усе вже повернено</span>\n', LIST),
    ("the returns screens' meta at 13 px", CSS, ".return-result .hint {\n  font-size: 14px;\n",
     ".return-result .hint {\n  font-size: 13px;\n", SCREEN),
    ("«Пошкоджені» not in «Брак»'s colour", CSS, ".damaged-line {\n  color: var(--damaged);\n",
     ".damaged-line {\n  color: inherit;\n", SCREEN),
    ("the chips not brought into view", RETURNS,
     '    (tag?.querySelector(".return-place") ?? tag)?.scrollIntoView({\n',
     "    tag?.scrollIntoView({\n", SCREEN),
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
