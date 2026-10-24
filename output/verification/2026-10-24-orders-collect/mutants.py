"""Break «Клієнт забрав» by its ways (orders task list, P0-3) one way at a
time: each must fail a journey. The way pressed is the way sent; in parts
the terms checked first, why focused over the panel, «Зараз … · винен …»;
the result — the server's sum, in parts the part paid now, «Разом» not
over it, the card's «Проведіть», focused, a buzz; kept and confirmed
later, «… один раз», the way alone and charge it once; a tap carried from
the step before let go; «Змінити спосіб оплати» only with the way;
«Повернення» on that very sale; a discount for every unit.

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
CARD = "frontend/src/orders/Order.tsx"
RESULT = "frontend/src/orders/Collected.tsx"
APP = "frontend/src/App.tsx"
CSS = "frontend/src/styles.css"
SERVICE = "backend/app/modules/orders/service.py"

SPEC = "e2e/orders-card.spec.ts"
COLLECT = [SPEC, "-g", "«Клієнт забрав»: five ways"]
PARTS = [SPEC, "-g", "in parts: terms not taken"]
KEPT = [SPEC, "-g", "a card's «Клієнт забрав» whose answer"]
CARRIED = [SPEC, "-g", "a tap meant for the step just taken"]
NO_WAY = [SPEC, "-g", "whose way is not given"]
LINES = [SPEC, "-g", "lines with their sums"]
REAL = ["e2e/orders.spec.ts", "-g", "reserve, dispatch, arrive, collect"]

M = [
    ("the way pressed not the way sent", CARD,
     "                      collect(way);", "                      collect(\"CASH\");", COLLECT),
    ("in parts, sent as whole", CARD,
     "    if (!credit.inParts) {", "    if (true) {", PARTS),
    ("terms not taken unsaid", CARD,
     "    if (typeof terms === \"string\") setProblem(terms);",
     "    if (typeof terms === \"string\") return;", PARTS),
    ("why not brought to the finger", CARD,
     "    if (problem) why.current?.focus();", "    void why;", PARTS),
    ("in parts, the panel says the whole", CARD,
     "    paidNow !== null && paidNow > 0n && paidNow < total", "    false", PARTS),
    ("no ways on an arrived order", CARD,
     "    mayStep && open && !changingShipping && !returning ? next : null;",
     "    mayStep && open && !changingShipping && !returning && next !== \"collect\"\n      ? next\n      : null;", COLLECT),
    ("a carried tap taken", CARD,
     "    return done !== null && event.timeStamp - shownAt < CARRIED_TAP;", "    return false;", CARRIED),
    ("«Разом» over the result", CARD,
     "      {collected === null && (", "      {true && (", PARTS),
    ("a discount for the whole line", CARD,
     "                      ? ` · знижка ${money(item.discount_amount)} за 1 шт.`",
     "                      ? ` · знижка ${money(item.discount_amount)}`", LINES),
    ("in parts, the result says the whole", RESULT,
     "  const taken = order.credit ? order.credit.paid : order.total;", "  const taken = order.total;", PARTS),
    ("a card's result without «Проведіть»", RESULT,
     "  CARD: \"Картка · Проведіть на терміналі\",", "  CARD: \"Картка\",", COLLECT),
    ("a kept card told «Проведіть»", RESULT,
     "            {kept ? methodLabels[way] : wayPills[way]}", "            {wayPills[way]}", KEPT),
    ("a kept card not told to charge it once", RESULT,
     "      {kept && way === \"CARD\" && <p>{chargeOnce(taken)}</p>}\n", "", KEPT),
    ("kept said as at its press", RESULT,
     "        {kept ? \"Продаж записано один раз\" : \"Продаж записано\"}", "        {\"Продаж записано\"}", KEPT),
    ("the result not brought to the finger", RESULT,
     "    heading.current?.focus();\n", "", COLLECT),
    ("a collect recorded without a buzz", APP,
     "      if (step === \"collect\") {\n        buzz(\"success\");", "      if (step === \"collect\") {", COLLECT),
    ("a kept collect said as fresh", APP,
     "        setCollected({ id: order.id, kept: resent });", "        setCollected({ id: order.id, kept: false });", KEPT),
    ("«Змінити спосіб оплати» without the way", APP,
     "                // else, «Каса» would say it (G32; review, 2026-10-24).\n                detail.data.payment_method\n",
     "                // else, «Каса» would say it (G32; review, 2026-10-24).\n                true\n", NO_WAY),
    ("«Повернення» on another sale", APP,
     "                      setReturnOf(detail.data.sale_id);",
     "                      setReturnOf(\"00000000-0000-4000-8000-000000000000\");", REAL),
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
