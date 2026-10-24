"""Break «Початкові залишки»'s own refusal words one way at a time: each
must fail a journey. A refusal its screens do not name in the list's words,
never an order's: a new list by what was sent, and never «не збережено»
while a send before it may have made it; a line's answer, typed lines and a
file added or removed, approved, rejected; a conflict read again by its
caller; a reject that lost a race, and nothing to approve, said as they
are; typed lines past what the server takes at once said before sending;
the catalogue's search as long as the server reads.

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
TYPES = "frontend/src/openings/types.ts"
LISTS = "frontend/src/openings/Openings.tsx"
PARTS = "frontend/src/openings/Parts.tsx"
PICKER = "frontend/src/inventory/CatalogPicker.tsx"

SPEC = "e2e/openings.spec.ts"
NEW = [SPEC, "-g", "a new list refused"]
REFUSED = [SPEC, "-g", "refusals the server does not name"]
FILES = ["e2e/openings-file.spec.ts", "-g", "a file added by mistake"]
UNSURE = ["e2e/openings-file.spec.ts", "-g", "an answer too slow to wait for"]

M = [
    ("a list's unnamed form in an order's words", TYPES,
     "  if (text === INVALID_TEXT) return `${notDone} ${check}`;\n", "", REFUSED),
    ("a list's conflict in an order's words", TYPES,
     "  if (text === CONFLICT_TEXT) return `${notDone} ${changed}`;\n", "", REFUSED),
    ("too many typed lines unsaid", TYPES,
     "  if (lines.length > MAX_PART_LINES)", "  if (false)", NEW),
    ("too many characters unsaid", TYPES,
     "  if (lines.reduce((sum, line) => sum + line.length, 0) > MAX_PART_TEXT_CHARS)",
     "  if (false)", REFUSED),
    ("a new list said by its warehouse", LISTS,
     "  const what = mode === \"file\" ? \"файл\" : \"рядки\";", "  const what = \"склад і рядки\";", NEW),
    ("unsure said as not saved", LISTS,
     "  return unsure\n    ? listRefusal(", "  return false\n    ? listRefusal(", UNSURE),
    ("a new list's conflict said as a list's", LISTS,
     "        \"Поки ви працювали, дані змінилися — спробуйте ще раз.\",",
     "        \"Поки ви працювали, список змінився — перегляньте його й спробуйте ще раз.\",", NEW),
    ("a new list's conflict not read again", LISTS,
     "      if (error instanceof SlowAnswer || conflict || listConflict(error))",
     "      if (error instanceof SlowAnswer || conflict)", NEW),
    ("too many typed lines sent in a new list", LISTS,
     "      ? lines.length > 0 && !tooLong && !tooMuch", "      ? lines.length > 0 && !tooLong", NEW),
    ("a line's conflict not read again", LISTS,
     "      if (reason === \"SPLIT_MAY_BE_RANGE\" || listConflict(error)) reread();",
     "      if (reason === \"SPLIT_MAY_BE_RANGE\") reread();", REFUSED),
    ("a reject that lost a race said not rejected", LISTS,
     "reasonCode === \"ALREADY_DECIDED\" ||\n                      error.code === \"IDEMPOTENCY_CONFLICT\"",
     "reasonCode === \"ALREADY_DECIDED\"", REFUSED),
    ("nothing to approve said as a change", LISTS,
     "                    : reasonCode === \"NOTHING_TO_APPLY\"",
     "                    : reasonCode === \"NOTHING_TO_APPLY_\"", REFUSED),
    ("an approval told to refresh", LISTS,
     "\"Список не затверджено.\",\n                                \"Спробуйте ще раз.\",",
     "\"Список не затверджено.\",\n                                \"Оновіть його та спробуйте ще раз.\",", REFUSED),
    ("a removal told to refresh", PARTS,
     "                      : \"Рядки не прибрано.\",\n                    \"Спробуйте ще раз.\",",
     "                      : \"Рядки не прибрано.\",\n                    \"Оновіть список і спробуйте ще раз.\",", REFUSED),
    ("a file's removal said as lines'", PARTS,
     "                      ? \"Файл не прибрано.\"", "                      ? \"Рядки не прибрано.\"", FILES),
    ("a file refused said as lines", PARTS,
     "          [\"Файл не додано.\", \"Перевірте його та спробуйте ще раз.\"],",
     "          [\"Рядки не додано.\", \"Перевірте їх та спробуйте ще раз.\"],", FILES),
    ("added lines' conflict not read again", PARTS,
     "          [\"Рядки не додано.\", \"Перевірте їх та спробуйте ще раз.\"],\n        ),\n      );\n      // Changed in a way it does not name: read again (review, 2026-10-24).\n      if (error instanceof SlowAnswer || listConflict(error)) await refresh();",
     "          [\"Рядки не додано.\", \"Перевірте їх та спробуйте ще раз.\"],\n        ),\n      );\n      if (error instanceof SlowAnswer) await refresh();", REFUSED),
    ("too many typed lines added", PARTS,
     "            lines.length === 0 || !!tooLong || !!tooMuch || busy || blocked",
     "            lines.length === 0 || !!tooLong || busy || blocked", REFUSED),
    ("the catalogue's search unbounded", PICKER,
     "            maxLength={200}\n", "", REFUSED),
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
