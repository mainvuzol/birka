"""Break «Закриття» (cash task list, P1-4) one way at a time: each must fail
a journey. A row a close says what was counted and expected, a reason not
given and what explains the difference, its figures without «грн»; its pill
a warning for a shortage or a surplus, the accent's to the kopeck, plain for
a first count; the days nobody closed newest first; twenty a page; a close
tapped shows its figures, the days nobody closed, the reason and the period,
read again by its id, its heading focused, a first count by its name and
without «next time»; back, the list where it was and the row in hand; the
pills one column down the list; «пояснено» only where the close says it.

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
HISTORY = "frontend/src/cash/History.tsx"
CLOSED = "frontend/src/cash/Closed.tsx"

ROWS = ["e2e/cash-history.spec.ts", "-g", "a row a close"]
TAPPED = ["e2e/cash-history.spec.ts", "-g", "a close tapped"]
PAGES = ["e2e/cash-history.spec.ts", "-g", "twenty closes to a page"]
# The owner's day is a serial journey: the whole spec, its steps in order.
OWNER = ["e2e/cash.spec.ts"]

M = [
    ("a shortage's pill not a warning", HISTORY,
     '    <span className="badge warn">{difference.text}</span>',
     '    <span className="badge">{difference.text}</span>', ROWS),
    ("«Збіглося» a warning", HISTORY,
     '    <span className="badge">Збіглося</span>',
     '    <span className="badge warn">Збіглося</span>', ROWS),
    ("the first count's pill not plain", HISTORY,
     '    return <span className="badge neutral">Перший підрахунок</span>;',
     '    return <span className="badge warn">Перший підрахунок</span>;', PAGES),
    ("what was expected not said", HISTORY,
     '      : [`мало бути ${bare(money(close.expected ?? "0.00"))}`]),', "      : []),", ROWS),
    ("a reason not given not said", HISTORY,
     '      ? ["причину не вказано"]', "      ? []", ROWS),
    ("what explains the difference not said", HISTORY,
     "      ? [`пояснено ${bare(moved(close.explained))}`]", "      ? []", ROWS),
    ("the row's figures with «грн»", HISTORY,
     '  return value.replace(/ грн$/, "");', "  return value;", ROWS),
    ("the days nobody closed oldest first", HISTORY,
     "      {[...close.unclosed_days].reverse().map((day) => (",
     "      {[...close.unclosed_days].map((day) => (", ROWS),
    ("a hundred closes a page", HISTORY,
     "const pageSize = 20;", "const pageSize = 100;", PAGES),
    ("a close tapped, its heading not focused", HISTORY,
     "    if (tapped !== null) {\n      heading.current?.focus();",
     "    if (tapped !== null) {\n      void heading;", TAPPED),
    ("back, the list at the top", HISTORY,
     "    window.scrollTo(0, place.current);", "    window.scrollTo(0, 0);", TAPPED),
    ("back, the focus not on the row tapped", HISTORY,
     "        ?.focus({ preventScroll: true });", "        ?.blur();", TAPPED),
    ("«пояснено» where nothing differs", HISTORY,
     "    ...(!isOpening(close) &&\n    close.difference !== null &&\n    !nothing(close.difference) &&\n    close.explained",
     "    ...(close.explained", ROWS),
    ("a close tapped shown as the list read it", HISTORY,
     "  const open = tapped === null ? null : (detail.data ?? tapped);",
     "  const open = tapped;", TAPPED),
    ("a first count tapped called a close", HISTORY,
     '          {isOpening(open) ? "Перший підрахунок" : "Закриття"}{" "}',
     '          {"Закриття"}{" "}', PAGES),
    ("«наступного разу» said of a first count read back", HISTORY,
     "        <CloseBody close={open} now={false} />", "        <CloseBody close={open} />", PAGES),
    ("the pills not in one column", "frontend/src/styles.css",
     ".close-head {\n  display: flex;\n  flex-direction: column;",
     ".close-head {\n  display: flex;\n  flex-direction: row;", ROWS),
    ("a close tapped without the days nobody closed", CLOSED,
     "        <p>{unclosedText(close.unclosed_days)}</p>", "        <p />", TAPPED),
    ("a close tapped without its reason", CLOSED,
     "      {reason && <ReasonLine close={close} />}", "      {false && <ReasonLine close={close} />}",
     TAPPED + OWNER),
    ("a close tapped without its period", CLOSED,
     "      <PeriodDetails close={close} />\n    </>", "    </>", TAPPED + OWNER),
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
