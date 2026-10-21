"""Break «Каса»'s kept command (cash task list, P1-1) and the dark card one
way at a time: each must fail a journey. A kept drawer command's banner
names what waits and for how much from the attempt alone, says the phone
checks it itself with nothing on paper (owner decision, 2026-10-21, В2),
and its button names it; confirmed, it says it was recorded once, with what;
a count that came too late the same evening — the drawer's day, 06:00 to
06:00 — the drawer still to close, says to count again and opens the count
once, and on another day, with the drawer closed meanwhile, or while it
cannot be read, says to close as usual and opens nothing (В3); a command on
its first sending shows no banner; the
«Закрити касу» card stays dark in the dark theme, with an edge.

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
KEPT = "frontend/src/cash/Kept.tsx"
CASH = "frontend/src/cash/Cash.tsx"
ERRORS = "frontend/src/cash/errors.ts"
REACH = "frontend/src/shared/reach.ts"
CSS = "frontend/src/styles.css"

BANNER = ["e2e/cash-kept.spec.ts", "-g", "names what waits"]
LATE = ["e2e/cash-kept.spec.ts", "-g", "too late"]
FIRST = ["e2e/cash-kept.spec.ts", "-g", "first sending"]
OUTAGE = ["e2e/outage.spec.ts", "-g", "a close whose answer was lost"]
THEME = ["e2e/cash-close.spec.ts", "-g", "theme"]

M = [
    ("the heading not by what it is", KEPT,
     "`${name.heading} ще не підтверджено`", "`Незавершена операція каси`", BANNER),
    ("the banner while checked not saying so", KEPT,
     "{busy ? `Перевіряємо ${lower}…`", "{false ? `Перевіряємо ${lower}…`", BANNER),
    ("the count's own sum not named", KEPT,
     "      return sum === null ? name.line : `${name.line} ${sum}`;", "      return name.line;", BANNER),
    ("a take-out's kind not named", KEPT,
     "          ? kinds[body.movement_kind]", "          ? undefined", BANNER),
    ("the ways of a fix not named", KEPT,
     "        : `${name.line}: ${from} → ${to}`;", "        : name.line;", BANNER),
    ("cash put in called a take-out", KEPT,
     'return directionOf(body.movement_kind) === "IN"', 'return directionOf(body.movement_kind) === "NONE"', BANNER),
    ("the button by no name", KEPT,
     "        Перевірити {lower}", "        Перевірити результат", BANNER),
    ("the paper line kept for the drawer", REACH,
     "  return `${waitsSince(since)}Телефон перевірить сам. Нічого не повторюйте, поки він не скаже «не записано».`;",
     "  return `${waitsSince(since)}Запишіть цю операцію на папері з позначкою «у телефоні — Оля» і не вносьте її з паперу: телефон перевірить її сам. Вносьте з паперу, лише якщо застосунок скаже «не записано».`;",
     BANNER + OUTAGE),
    ("since when it waits not said", REACH,
     "  return `${waitsSince(since)}Телефон", "  return `Телефон", BANNER),
    ("confirmed without «один раз»", CASH,
     "        recorded(attempt.body, outcome.result, true, attempt.since);",
     "        recorded(attempt.body, outcome.result);", BANNER),
    ("a confirmed count not said", CASH,
     '        if (once) setDone("Підрахунок записано один раз.");\n', "", BANNER),
    ("a confirmed take-out's kind not said", CASH,
     "        ? `Видачу записано один раз: ${movementLabels[movement.kind]}, ${money(movement.amount)}`",
     "        ? `Видачу записано один раз: ${money(movement.amount)}`", BANNER),
    ("a confirmed fix's ways not said", CASH,
     "`Зміну способу оплати записано один раз: ${ways}`", "`Зміну способу оплати записано один раз`", BANNER),
    ("a confirmed reason without «один раз»", CASH,
     '  const written = kept ? "Причину записано один раз." : "Причину записано.";',
     '  const written = "Причину записано.";', BANNER),
    ("a kept reason's words judged by when it was confirmed", CASH,
     "  if (kept && !(since - closedAt > window))", "  if (false)", BANNER),
    ("a reason first sent past the bot's wait said to be seen only", CASH,
     "  if (kept && !(since - closedAt > window))", "  if (kept)", BANNER),
    ("cash put in said taken before a close", CASH,
     '  return movement.direction === "IN"', '  return movement.direction === "NONE"', BANNER),
    ("the banner on a first sending", CASH,
     "      {pending && !sending && (", "      {pending && (", FIRST),
    ("the late count never opened again", CASH,
     "    useCashLastCommand.setState({ recounted: error });\n    setStep({ name: \"count\" });",
     "    useCashLastCommand.setState({ recounted: error });", LATE),
    ("any refusal opening the count", CASH,
     "    if (error === null || recounted === error || !staleToday(error)) return;",
     "    if (error === null || recounted === error) return;", LATE),
    ("the count opened again on every return to «Каса»", CASH,
     "    if (error === null || recounted === error || !staleToday(error)) return;",
     "    if (error === null || !staleToday(error)) return;", LATE),
    ("the count opened on the drawer's old read", CASH,
     "    if (drawer.isFetching || !closeNow || step.name !== \"main\") return;",
     "    if (!closeNow || step.name !== \"main\") return;", LATE),
    ("the late words while the drawer cannot be read", CASH,
     "    !drawer.error && drawer.data !== undefined && isDue(drawer.data);",
     "    drawer.data !== undefined && isDue(drawer.data);", LATE),
    ("the late count's words blind to the drawer closed meanwhile", CASH,
     "            closeNow,\n          )}", "            true,\n          )}", LATE),
    ("a late count of an earlier day taken for today's", ERRORS,
     "    drawerDay(new Date(at)) === drawerDay(new Date())", "    true", LATE),
    ("the calendar's day for the drawer's", ERRORS,
     "  return new Date(at.getTime() - 6 * 60 * 60 * 1000).toDateString();",
     "  return at.toDateString();", LATE),
    ("the same evening said as before", ERRORS,
     "      return closeNow && staleToday(error)", "      return false && staleToday(error)", LATE),
    ("the drawer's state lost on the way to the words", ERRORS,
     "    return cashErrorText(error, closeNow);", "    return cashErrorText(error);", LATE),
    ("the dark card light in the dark theme", CSS,
     "  --active-shadow: rgb(0 0 0 / 30%);\n  --dark-card: #222c29;",
     "  --active-shadow: rgb(0 0 0 / 30%);\n  --dark-card: #f1f4f2;", THEME),
    ("the dark card without its edge", CSS,
     "  border: 1px solid var(--dark-card-line);\n  border-radius: 20px;\n  background: var(--dark-card);",
     "  border-radius: 20px;\n  background: var(--dark-card);", THEME),
    ("the edge lost on the dark card", CSS,
     "  --on-dark-card: #f1f4f2;\n  --dark-card-line: #66726d;\n  color-scheme: dark;\n}",
     "  --on-dark-card: #f1f4f2;\n  --dark-card-line: #222c29;\n  color-scheme: dark;\n}", THEME),
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
