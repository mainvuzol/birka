"""Break «Каса»'s close under the approved design (cash task list, P0-1..P0-3)
one way at a time: each must fail a journey. The card reads the drawer
again, so the count names the newest close; the count's field holds the
cursor, an empty sum sends nothing and «Скасувати» keeps it; cash taken out
from the count comes back to it; the close's figures are the server's, a
shortage or a surplus a warning, to the kopeck the accent; a reason owed
waits under the thumb with the cursor out of its field, its button held
until written; a buzz for a close recorded and one for a refusal; the card
is gone once the day is closed; the owner's rows say what each is for; cash
put in is «+»; the card's hint reads in both themes; the panel's button is
under the thumb at 54 px; a reason owed never holds «Каса»'s own tasks; a
sum typed is not kept once the count is left; the focus follows the
confirmation, which keeps the sum large; a separator just typed is a sum
still being typed.

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
CASH = "frontend/src/cash/Cash.tsx"
COUNT = "frontend/src/cash/Count.tsx"
CLOSED = "frontend/src/cash/Closed.tsx"
CSS = "frontend/src/styles.css"

SPEC = "e2e/cash-close.spec.ts"
MAIN = [SPEC, "-g", "says where the drawer stands"]
COUNTING = [SPEC, "-g", "the count: the card reads the drawer again"]
OUT = [SPEC, "-g", "cash taken out is recorded from the count"]
FIGURES = [SPEC, "-g", "figures are the server's"]
KOPECK = [SPEC, "-g", "to the kopeck is the accent's"]
REASON = [SPEC, "-g", "a difference owes its reason"]
BUZZ = [SPEC, "-g", "Telegram buzzes once"]
THEMES = [SPEC, "-g", "theme the card, the count"]
OWNER = [SPEC, "-g", "the owner's «Каса»"]

M = [
    ("the card not reading the drawer again", CASH,
     "                void drawer.refetch().then((read) => {",
     "                void Promise.resolve(drawer).then((read) => {", COUNTING),
    ("an empty sum may close", COUNT,
     "              disabled={disabled || reading || cents === null}",
     "              disabled={disabled || reading}", COUNTING),
    ("the cursor not in the count's field", COUNT,
     "    field.current?.focus();\n", "", COUNTING),
    ("«Скасувати» clearing the sum", COUNT,
     "                  setAsking(null);\n                  requestAnimationFrame(() => closeButton.current?.focus());\n                }}\n              >\n                Скасувати",
     "                  setAsking(null);\n                  setTyped(\"\");\n                  requestAnimationFrame(() => closeButton.current?.focus());\n                }}\n              >\n                Скасувати",
     COUNTING),
    ("the count not coming back after cash out", CASH,
     'setStep(step.then === "count" ? { name: "count" } : { name: "main" });',
     'setStep({ name: "main" });', OUT),
    ("«Мало бути» not the server's", CLOSED,
     '          <Sum value={money(close.expected ?? "0.00")} />', "          <Sum value={money(close.counted)} />",
     FIGURES),
    ("a difference in the debt's colour", CLOSED,
     '      <p className={`cash-difference ${difference.match ? "match" : "warn"}`}>',
     '      <p className={`cash-difference ${difference.match ? "match" : "debt"}`}>', FIGURES + REASON),
    ("to the kopeck a warning", CLOSED,
     '  if (nothing(difference)) return { text: "Збіглося до копійки", match: true };',
     '  if (nothing(difference)) return { text: "Збіглося до копійки", match: false };', KOPECK),
    # The reason's field taking the cursor (`autoFocus`) changes nothing: the
    # result's heading takes it after, so the figures are read first. What
    # keeps the cursor out of the field is that focus, broken here.
    ("the result's heading not taking the focus", CLOSED,
     "    heading.current?.focus();\n", "", FIGURES),
    ("the reason sent empty", CLOSED,
     '          disabled={disabled || reason.trim() === ""}', "          disabled={disabled}", REASON),
    ("no buzz for a close recorded", CASH, '      buzz("success");\n', "", BUZZ),
    ("no buzz for a refusal", CASH, '      buzz("error");\n', "", BUZZ),
    ("the card shown once the day is closed", CASH,
     "  const due = data !== undefined && isDue(data);", "  const due = data !== undefined;", FIGURES),
    ("the owner's take-out row said as a seller's", CASH,
     '                  kinds.includes("OWNER")', "                  false", OWNER),
    ("cash put in said as taken out", CASH,
     '        {movement.direction === "OUT" ? "−" : "+"}', '        {"−"}', OWNER),
    ("the card's hint unreadable in its card", CSS,
     ".cash-card-hint {\n  font-size: 15px;\n  font-weight: 500;\n}",
     ".cash-card-hint {\n  font-size: 15px;\n  font-weight: 500;\n  color: var(--text-2);\n}", THEMES),
    ("«Каса» held while a reason is owed", CLOSED,
     '      {owedId !== null && (\n        <button\n          type="button"\n          className="quiet back"',
     '      {false && (\n        <button\n          type="button"\n          className="quiet back"', REASON),
    ("the typed count kept after leaving it", CASH,
     '          // Kept only on the way to cash taken out and back.\n          setCounting("");\n', "", OUT),
    ("the focus left behind by the confirmation", COUNT,
     "    if (asking !== null) yes.current?.focus();\n", "", COUNTING),
    ("a separator just typed said to be wrong", COUNT,
     'kopecks(typed.trim().replace(/[.,]$/, ""))', "kopecks(typed.trim())", COUNTING),
    ("the confirmed sum small", COUNT,
     '            <p className="pay-total">\n              Закрити касу: у касі',
     '            <p className="pay-what">\n              Закрити касу: у касі', COUNTING),
    ("the panel's button under 54 px", CSS,
     ".cash-panel-button {\n  width: 100%;\n  min-height: 54px;",
     ".cash-panel-button {\n  width: 100%;\n  min-height: 44px;", COUNTING),
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
