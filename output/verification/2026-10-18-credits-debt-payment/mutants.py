"""Break «Борги»'s debt and its payment one way at a time: each must fail a
journey. What is owed, large, the server's; how much of it is paid, and of
what; the history a row an entry; the payment's sum under it and its three
ways under the thumb, none pressable without a sum; a refusal in view above
them; a closed debt taking none; from paper, who took it under the ways.

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
DEBT = "frontend/src/credits/Debt.tsx"
LIST = "frontend/src/credits/Credits.tsx"

DEBTS = ["e2e/credits-debt.spec.ts"]
PAPER = ["e2e/outage-mark-debts-returns.spec.ts", "-g", "card payment typed from paper"]

M = [
    ("what is owed summed on the phone", DEBT,
     "            <Sum value={money(credit.owed)} />\n",
     "            <Sum value={money(decimal((kopecks(credit.amount) ?? 0n) - (kopecks(credit.paid) ?? 0n)))} />\n",
     DEBTS),
    ("paid, not of what", DEBT,
     "  const parts = [`Сплачено ${money(credit.paid)} з ${money(credit.amount)}`];\n",
     "  const parts = [`Сплачено ${money(credit.paid)}`];\n", DEBTS),
    ("a return not said", DEBT,
     "  if ((kopecks(credit.returned) ?? 0n) > 0n)\n    parts.push(\n",
     "  if (false)\n    parts.push(\n", DEBTS),
    ("the ways pressable without a sum", DEBT,
     "disabled={blocked || working || !paperMark.ready || !typed}",
     "disabled={blocked || working || !paperMark.ready}", DEBTS),
    ("the panel's sum not what is typed", DEBT,
     "                <Sum value={money(decimal(cents))} />\n",
     "                <Sum value={money(credit.owed)} />\n", DEBTS),
    ("the whole left something else", DEBT,
     "                setAmount(asInput(credit.owed));\n",
     "                setAmount(asInput(credit.paid));\n", DEBTS),
    ("a history row without its sum", DEBT,
     '            <span className="history-sum">{money(entry.amount)}</span>\n', "", DEBTS),
    ("who took it elsewhere not said", DEBT,
     "  if (entry.taken_at)\n", "  if (false)\n", DEBTS),
    ("a refusal left out of view", DEBT,
     "    if (told > 0) said.current", "    if (told < 0) said.current", DEBTS),
    ("a closed debt takes a payment", DEBT,
     '  const takes = credit.status === "OPEN" && !readOnly;\n',
     "  const takes = !readOnly;\n", DEBTS),
    ("who took it from paper not said", DEBT,
     '            <p className="pay-seller">{takenBy(paperMark)}</p>\n',
     "            <p />\n", PAPER),
    ("another store's debt not said", DEBT,
     "      {elsewhere && (\n        <p className=\"notice\">\n          Продано в «",
     "      {false && (\n        <p className=\"notice\">\n          Продано в «", DEBTS),
    ("what was done left out of view", DEBT,
     "    if (done !== null) result.current", "    if (done === null) result.current", DEBTS),
    ("a sum not read left to dead buttons", DEBT,
     "            ) : unreadable ? (\n", "            ) : false ? (\n", DEBTS),
    ("a store's taking said as the person's", DEBT,
     "    parts.push(`прийняв магазин «", "    parts.push(`прийняв «", DEBTS),
    ("back to the list from a customer's debt", LIST,
     "          ? { backTo: visible(chosen.customer_name ?? erasedCustomer) }\n",
     "          ? {}\n", ["e2e/credits-list.spec.ts"]),
    ("a closed debt says not when", DEBT,
     "            {credit.closed_at && ` Закрито ${shortDay(credit.closed_at)}`}\n", "", DEBTS),
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
