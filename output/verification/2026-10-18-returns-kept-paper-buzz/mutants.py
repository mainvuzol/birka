"""Break a kept return's banner and notice, the paper's line and the buzz
one way at a time: each must fail a journey (returns task list, P1-2, P1-4,
P2-5, and the owner's words of 2026-10-18).

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
COMMANDS = "frontend/src/returns/commands.ts"
APP = "frontend/src/App.tsx"

SCREEN = ["e2e/returns-sale-screen.spec.ts"]
RET = ["e2e/returns.spec.ts", "-g", "outcome is unknown"]
CRED = ["e2e/credits.spec.ts", "-g", "a return of a sale paid in parts"]
PAPER = ["e2e/outage-mark-debts-returns.spec.ts"]
REOPENED = ["e2e/outage.spec.ts", "-g", "kept return"]

M = [
    ("the banner names no goods", RESULT,
     "  const tags = isRecord(shown) ? tagsOf(shown.lines) : null;\n",
     "  const tags = null;\n", SCREEN + RET),
    ("in parts, the banner names a sum or none of the goods", RESULT,
     "  if (tags !== null && isRecord(shown) && shown.parts === true)\n",
     "  if (false)\n", CRED),
    ("what the banner names is sent", COMMANDS, "    command_id: body.command_id,\n",
     "    command_id: body.command_id,\n    shown: body.shown,\n", SCREEN + RET),
    ("goods that do not read hold the attempt as broken", COMMANDS,
     "    // `shown` is not checked here:",
     "    (body.shown === undefined || isRecord(body.shown)) &&\n    // `shown` is not checked here:",
     REOPENED),
    ("confirmed later, the pill says to hand the money back", RESULT,
     "                {kept && way\n", "                {false && way\n", SCREEN + CRED),
    ("the goods are not kept beside the body", RETURNS, "        shown: {\n",
     "        shownOff: {\n", SCREEN + RET),
    ("confirmed later, it says to hand the money back plainly", RESULT,
     "              <p>{handBackOnce(amount, way)}</p>\n",
     "              <p>{handBack(amount, way)}</p>\n", SCREEN + REOPENED),
    ("confirmed later, the old heading", RESULT,
     "        <h3>Повернення записано один раз</h3>\n",
     "        <h3>Повернення оформлено</h3>\n", SCREEN + REOPENED),
    ("the kept banner's old heading", APP,
     '              : "Повернення ще не підтверджено"}\n',
     '              : "Незавершене повернення"}\n', RET),
    ("no buzz on a return recorded", RETURNS, '      buzz("success");\n', "", SCREEN),
    ("no buzz on a refusal", RETURNS, '      buzz("error");\n', "", SCREEN),
    ("a lost answer buzzes too", RETURNS, '    } else if (outcome.kind === "refused") {\n      buzz("error");\n',
     '    } else if (outcome.kind === "refused") {\n      buzz("error");\n    } else {\n      buzz("error");\n    }\n    if (outcome.kind === "refused") {\n',
     SCREEN),
    ("the paper's time is not said", RETURNS,
     "  return `Хто прийняв: ${who} · за папером ${when}, ${time}`;\n",
     "  return `Хто прийняв: ${who}`;\n", PAPER),
    ("yesterday's paper said as today's", RETURNS, "      : mark.yesterday\n", "      : false\n",
     PAPER),
    ("the paper's warning said twice again", RETURNS,
     '          {mark.paper && <p className="pay-seller">{takenBy(mark)}</p>}\n',
     '          {mark.paper && (\n            <p className="pay-seller">\n              Гроші, які віддали під час збою, вдруге не віддавайте: оберіть, як їх віддавали, і натисніть. {takenBy(mark)}\n            </p>\n          )}\n',
     PAPER),
    ("in parts, a way not read is asked as if needed", RETURNS,
     '                ? "Не вдалося прочитати, як платили. Якщо буде що повертати — оберіть, як."\n',
     '                ? "Не вдалося прочитати, як платили. Оберіть, як повертаєте."\n', SCREEN),
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
