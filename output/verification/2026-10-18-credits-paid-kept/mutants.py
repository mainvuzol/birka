"""Break a payment's result, and a payment kept unconfirmed, one way at a
time: each must fail a journey. «Внесок записано», the way and what to do
with it, the sum large, what is owed by the server; from paper never
«Проведіть»; a buzz for each answer; a kept payment named by its sum, way and
goods, which are never sent; confirmed later, the way alone, its sum and way
heard; every good of a debt on a tap; and what the review found — the
panel's room after a result, focus, the paper's pill, the way back from a
card, the phone link in the theme's colour.

Each mutant runs its journeys against the isolated E2E API (`e2e-fresh.sh`,
`e2e-run.sh`), reseeded before every run. The unchanged tree runs first,
with everything any mutant names, and must pass; each mutant names what
failed. An optional argument runs only the mutants whose names contain one
of its parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
PAID = "frontend/src/credits/Paid.tsx"
DEBT = "frontend/src/credits/Debt.tsx"
APP = "frontend/src/App.tsx"
JOURNAL = "frontend/src/credits/commands.ts"
STYLES = "frontend/src/styles.css"

DEBTS = ["e2e/credits-debt.spec.ts"]
CREDITS = ["e2e/credits.spec.ts", "-g", "sale paid in parts leaves|answer is lost"]
KEPT = ["e2e/outage.spec.ts", "-g", "Борги"]
PAPER = ["e2e/outage-mark-debts-returns.spec.ts", "-g", "card payment typed from paper"]
CARD = ["e2e/credits.spec.ts", "-g", "one phone is one customer"]
THEMES = ["e2e/credits-debt.spec.ts", "-g", "theme", "e2e/credits-list.spec.ts", "-g", "theme"]

M = [
    ("the phone to call in the browser's own blue", STYLES,
     "a,\na:visited {\n  color: var(--accent-text);\n}\n", "", THEMES),
    ("a card's result says not what to do", PAID,
     '  CARD: "Картка · Проведіть на терміналі",\n', '  CARD: "Картка",\n', CREDITS),
    ("a transfer's result says not to check it", PAID,
     '  TRANSFER: "Переказ · Перевірте, що переказ надійшов",\n', '  TRANSFER: "Переказ",\n', DEBTS),
    ("from paper, the way and «Проведіть»", PAID,
     "          (paper ? (\n", "          (false ? (\n", PAPER),
    ("confirmed later, «Проведіть» over the sum", PAID,
     "                {kept ? methodLabels[way] : wayPills[way]}\n",
     "                {wayPills[way]}\n", KEPT),
    ("what is owed after worked out, not the server's", PAID,
     "            : `Залишок боргу ${money(credit.owed)}`}\n",
     "            : `Залишок боргу ${money(credit.amount)}`}\n", DEBTS),
    ("the sum large not the one taken", PAID,
     "          <Sum value={money(amount)} />\n", "          <Sum value={money(credit.paid)} />\n",
     DEBTS),
    ("the result not focused", PAID,
     "    heading.current?.focus();\n", "", DEBTS),
    ("no buzz when recorded", DEBT, '      buzz("success");\n', "", DEBTS),
    ("no buzz when refused", DEBT, '      buzz("error");\n', "", DEBTS),
    ("a lost answer buzzes", DEBT,
     '    if (outcome.kind === "done") {\n      buzz("success");\n',
     '    if (outcome.kind !== "refused") buzz("success");\n    if (outcome.kind === "done") {\n',
     DEBTS),
    ("a payment confirmed later buzzes", APP,
     "        const body = attempt.body;\n",
     '        void import("@/shared/telegram").then((t) => { t.buzz("success"); });\n        const body = attempt.body;\n',
     DEBTS),
    ("the form left under the result", DEBT,
     "      {paid ? (\n", "      {false ? (\n", CREDITS + DEBTS),
    ("the goods not kept with the attempt", DEBT,
     "      goods: credit.goods,\n", "", CREDITS),
    ("the goods sent", JOURNAL,
     "          ...(body.outage ? { outage: body.outage } : {}),\n",
     "          ...(body.outage ? { outage: body.outage } : {}),\n          ...(body.goods ? { goods: body.goods } : {}),\n",
     CREDITS + KEPT),
    ("goods that are not a list read as one", APP,
     "  const goods: unknown[] = Array.isArray(body.goods) ? body.goods : [];\n",
     "  const goods: unknown[] = Array.from(body.goods as string);\n", KEPT),
    ("goods holding something not a name trusted", APP,
     '    typeof first === "string" && goods.every((good) => typeof good === "string")\n',
     '    typeof first === "string"\n', KEPT),
    ("an empty first good named", APP,
     "      ? visible(first).trim()\n", "      ? `${visible(first)} `\n", KEPT),
    ("a kept payment from paper not said so", APP,
     '  return `Внесок${body.outage ? " з паперу" : ""} ${money(body.amount)}',
     "  return `Внесок ${money(body.amount)}", KEPT),
    ("a kept payment's banner in the old words", APP,
     '                : "Внесок ще не підтверджено"\n', '                : "Незавершений внесок"\n',
     CREDITS + KEPT),
    ("the panel's room not taken again after a result", DEBT,
     "  usePanelRoom(panelRef, takes && paid === null);\n",
     "  usePanelRoom(panelRef, takes);\n", DEBTS),
    ("back at the debt, focus lost", DEBT, "    name.current?.focus();\n", "", DEBTS),
    ("every good opened, focus lost", DEBT,
     "    if (allGoods) goodsList.current?.focus();\n", "", DEBTS),
    ("the result's heading heard without its sentence", PAID,
     "      <h3 ref={heading} tabIndex={-1} aria-describedby={sentence}>\n",
     "      <h3 ref={heading} tabIndex={-1}>\n", DEBTS),
    ("a kept payment's sum and way not heard", PAID,
     "          {kept && (\n", "          {false && (\n", KEPT),
    ("the paper's pill without who took it", PAID,
     '                {paperText("payment", paper)}\n',
     '                {firstDays ? "Внесок з паперу" : "Внесок під час збою"}\n', PAPER),
    ("the result's way back named the list from a card", PAID,
     "            {next.backTo}\n", "            До боргів\n", CARD),
    ("a kept payment's sum the debt's paid in all", APP,
     "              amount={creditSettled.amount}\n",
     "              amount={creditSettled.credit.paid}\n", KEPT),
    ("every good not opened on a tap", DEBT,
     "                    setAllGoods(true);\n", "", DEBTS),
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
