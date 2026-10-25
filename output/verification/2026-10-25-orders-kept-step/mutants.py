"""Break a kept order step's words (orders task list, P1-1) one way at a
time: each must fail a journey. Its banner names the step and the order —
the goods, how they go, the waybill; a shipping change the delivery it sets;
never from paper; «Перевірити результат замовлення»; answered, recorded and
never told to wait for «не записано»; no banner while the first press flies;
what is shown kept beside it only while a short string; confirmed later,
recorded once.

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
APP = "frontend/src/App.tsx"
COMMANDS = "frontend/src/orders/commands.ts"
CARD = "frontend/src/orders/Order.tsx"

SPEC = "e2e/orders-card.spec.ts"
KEPT = [SPEC, "-g", "names its step and its order"]
ANSWERED = [SPEC, "-g", "a step answered whose order could not be read"]
FIRST = [SPEC, "-g", "while a step's first press is on its way"]
SHIPPING = ["e2e/order-shipping.spec.ts", "-g", "a correction whose answer is lost"]
SPOILED = ["e2e/outage.spec.ts", "-g", "spoiled on the phone"]
LONG = ["e2e/outage.spec.ts", "-g", "past its length"]

M = [
    ("the banner names no step", APP,
     "                : `Операцію «${visible(pending.label)}» ще не підтверджено`}",
     "                : `Незавершена операція`}", KEPT),
    ("the banner names no order", APP,
     "            {pending.shown\n              ? `${visible(pending.shown)} — `",
     "            {false\n              ? `${visible(pending.shown)} — `", KEPT),
    ("an order's step told to type it from paper", APP,
     "          {!pending.acknowledged && <p>{keptCashText(pending.since)}</p>}",
     "          {!pending.acknowledged && <p>{keptText(pending.since, me.display_name)}</p>}", KEPT),
    ("an answered step told to wait for «не записано»", APP,
     "          {!pending.acknowledged && <p>{keptCashText(pending.since)}</p>}",
     "          {<p>{keptCashText(pending.since)}</p>}", ANSWERED),
    ("the old button", APP,
     "              : \"Перевірити результат замовлення\"}", "              : \"Повторити ту саму команду\"}", KEPT),
    ("confirmed later said as fresh", APP,
     "          : resent && step !== \"reserve\" && step !== \"collect\"",
     "          : false", KEPT),
    ("a banner while the first press flies", APP,
     "      {pending && !firstSend && (", "      {pending && (", FIRST),
    ("anything kept as what is shown", COMMANDS,
     "    ...(typeof shown === \"string\" && shown.length <= 1000 ? { shown } : {}),",
     "    ...(shown !== undefined ? { shown } : {}),", SPOILED),
    ("what is shown kept however long", COMMANDS,
     "shown.length <= 1000 ? { shown }", "shown.length <= 100000 ? { shown }", LONG),
    ("what is shown never kept", COMMANDS,
     "    ...(typeof shown === \"string\" && shown.length <= 1000 ? { shown } : {}),",
     "    ...({}),", KEPT),
    ("a shipping change named by the old delivery", CARD,
     "  const goes = setting\n", "  const goes = false\n", SHIPPING),
    ("the waybill not named", CARD,
     "goes, waybill ? `ТТН ${visible(waybill)}` : null]", "goes, null]", KEPT),
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
