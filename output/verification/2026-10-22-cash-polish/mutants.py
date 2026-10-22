"""Break «Каса»'s last touches (cash task list, P2-1..P2-3) one way at a time:
each must fail a journey. A refusal «Каса» does not name says the drawer's
words, never an order's — at the press, kept and unconfirmed, kept and
proven unrecorded — while one it names still says why; cash put in is of
the kind «Розмін»; the drawer read keeps the card's place and size; the
lists, an operation and the closes keep theirs, without a day's heading;
the card's place only for whoever may close, the drawer's line in its own
slot over what is kept; a drawer that cannot be read is a warning's plate;
a note the server cannot keep, a take-out named by its way, a request not
taken by what it holds.

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
ERRORS = "frontend/src/cash/errors.ts"
CASH = "frontend/src/cash/Cash.tsx"
FIX = "frontend/src/cash/Fix.tsx"
HISTORY = "frontend/src/cash/History.tsx"
CSS = "frontend/src/styles.css"

LIVE = ["e2e/cash-polish.spec.ts", "-g", "refused for what"]
KEPT = ["e2e/cash-polish.spec.ts", "-g", "a kept take-out the server says changed"]
DRAWER = ["e2e/cash-polish.spec.ts", "-g", "«Каса» read keeps the card"]
LISTS = ["e2e/cash-polish.spec.ts", "-g", "the seller's operations, one of them"]
CLOSES = ["e2e/cash-polish.spec.ts", "-g", "«Закриття» read keeps"]
PLATE = ["e2e/cash-polish.spec.ts", "-g", "warning's plate"]
NOTE = ["e2e/cash-polish.spec.ts", "-g", "a note the server cannot keep"]
NO_CARD = ["e2e/cash-polish.spec.ts", "-g", "whoever may not close"]
BANNER = ["e2e/cash-polish.spec.ts", "-g", "opened on a kept command"]
PUT_IN = ["e2e/cash-move-fix.spec.ts", "-g", "«Внести в касу»: one kind"]
# The drawer's day is a serial journey: the whole spec, its steps in order.
NAMED = ["e2e/cash.spec.ts"]

M = [
    ("a live conflict in an order's words", ERRORS,
     '  if (text === CONFLICT_TEXT)\n    return "Не записано: дані каси змінилися',
     '  if (false)\n    return "Не записано: дані каси змінилися', LIVE),
    ("a live request not taken in an order's words", ERRORS,
     "  if (text === INVALID_TEXT)\n    return command === undefined",
     "  if (false)\n    return command === undefined", LIVE),
    ("«Перевірте суму» for a way changed", ERRORS,
     '  correction: "Не записано. Перевірте пояснення й спробуйте ще раз.",',
     '  correction: "Не записано. Перевірте суму й спробуйте ще раз.",', LIVE),
    ("a note the server cannot keep in an order's words", ERRORS,
     '    case "NOTE":\n', '    case "NOTE_NEVER":\n', NOTE),
    ("a kept command the server says changed in an order's words", ERRORS,
     "    if (errorText(error) === CONFLICT_TEXT)", "    if (false)", KEPT),
    ("proven unrecorded, an order's words", ERRORS,
     "    if (text === CONFLICT_TEXT)\n      return `${not} Дані каси змінилися",
     "    if (false)\n      return `${not} Дані каси змінилися", KEPT),
    ("a take-out named «видачу чи внесення»", ERRORS,
     "  const not =\n    command === \"movement\" && direction",
     "  const not =\n    false && direction", KEPT),
    ("a named refusal said in the generic words", ERRORS,
     "  if (error instanceof ApiError && namedText(error, closeNow) === null) {",
     "  if (error instanceof ApiError) {", NAMED),
    ("cash put in of the old kind", "frontend/src/cash/types.ts",
     '  CHANGE: "Розмін",', '  CHANGE: "Внесено в касу (розмін)",', PUT_IN),
    ("«Каса» read as words in its place", CASH,
     '        <DrawerPlaceholder\n          card={store.permissions.includes("cash:close") || networkOwner}\n        />',
     '        <p role="status">Завантажуємо касу…</p>', DRAWER),
    ("the card's place of another size", CSS,
     ".cash-card-skeleton > span {\n  visibility: hidden;", ".cash-card-skeleton > span {\n  display: none;", DRAWER),
    ("the card's place for everyone", CASH,
     '          card={store.permissions.includes("cash:close") || networkOwner}',
     "          card={true}", NO_CARD),
    ("the drawer's line drawn below what is kept", CASH,
     "        drawer.isPending && (\n          <ContextPlaceholder",
     "        false && (\n          <ContextPlaceholder", BANNER),
    ("the operations read as words", FIX,
     '        <Placeholder said="Завантажуємо…" rows={3} day={false} />',
     '        <p role="status">Завантажуємо…</p>', LISTS),
    ("an operation read as words", FIX,
     "          <OperationPlaceholder />", '          <p role="status">Завантажуємо операцію…</p>', LISTS),
    ("a day's heading over «Каса»'s lists", "frontend/src/shared/Placeholder.tsx",
     "          {!debts && day && <span", "          {!debts && <span", LISTS),
    ("«Закриття» read as words", HISTORY,
     '        <Placeholder said="Завантажуємо закриття…" rows={4} day={false} />',
     '        <p role="status">Завантажуємо закриття…</p>', CLOSES),
    ("a drawer that cannot be read in a debt's red", CASH,
     '        <div className="notice" role="alert">', '        <div role="alert">', PLATE),
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
