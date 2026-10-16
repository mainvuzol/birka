"""Break the till's empty states and the first days' paper one way at a time: each must fail a test.

Server mutants run the server's tests on the branch's isolated database
(`~/.cache/birka-runtime/helpers/unit-env.sh`); screen mutants run the
journeys meant to catch them against the isolated E2E API (`e2e-fresh.sh`,
`e2e-run.sh`), reseeded before every run. The unchanged tree runs first,
both ways, and must pass; each mutant names the tests that failed. An
optional argument runs only the mutants whose name contains it.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
R = Path.home() / ".cache/birka-runtime"
H = R / "helpers"
OUTAGE = "backend/app/modules/sales/outage.py"
SALES_SERVICE = "backend/app/modules/sales/service.py"
REFUNDS = "backend/app/modules/refunds/service.py"
CREDIT = "backend/app/modules/credit/service.py"
REPORT = "backend/app/modules/reports/sales.py"
API_SALES = "backend/app/api/v1/sales.py"
API_LOCATIONS = "backend/app/api/v1/locations.py"
REPO = "backend/app/modules/inventory/repository.py"
SALE = "frontend/src/sales/Sale.tsx"
PAPER = "frontend/src/sales/paper.ts"
MARK = "frontend/src/sales/paperMark.tsx"
TYPES = "frontend/src/sales/types.ts"
CATALOG = "frontend/src/sales/FromCatalog.tsx"
RETURNS = "frontend/src/returns/Returns.tsx"
CREDITS = "frontend/src/credits/Credits.tsx"
SERVER = {OUTAGE, SALES_SERVICE, REFUNDS, CREDIT, REPORT, API_SALES, API_LOCATIONS, REPO}

PYTEST = [str(R / "python/bin/python"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
          "tests/integration/test_first_days_mark.py", "tests/integration/test_outage_mark.py",
          "tests/integration/test_outage_mark_returns_payments.py",
          "tests/unit/test_old_prints_are_pinned.py"]
TILL = ["e2e/till-first-days.spec.ts"]
PAPER_RETURNS = ["e2e/outage-mark-debts-returns.spec.ts"]
SECTIONS = ["e2e/till-sections.spec.ts"]

M = [
    # The server.
    ("an outage's mark is printed with the first days' key", OUTAGE,
     "    if mark.first_days:\n        printed[\"first_days\"] = True\n    return {\"outage\": printed}\n\n\nasync def nameable",
     "    printed[\"first_days\"] = mark.first_days\n    return {\"outage\": printed}\n\n\nasync def nameable",
     None),
    ("the first days' kind is left out of a sale's print", OUTAGE,
     "    if mark.first_days:\n        printed[\"first_days\"] = True\n    return {\"outage\": printed}\n\n\nasync def nameable",
     "    return {\"outage\": printed}\n\n\nasync def nameable", None),
    ("the first days' kind is left out of a return's and a payment's print", OUTAGE,
     "    if mark.first_days:\n        printed[\"first_days\"] = True\n    return {\"outage\": printed}\n\n\nasync def checked_paper",
     "    return {\"outage\": printed}\n\n\nasync def checked_paper", None),
    ("the first days' paper is held to yesterday", OUTAGE,
     "    back = FIRST_DAYS_PAPER_DAYS - 1 if first_days else 1\n", "    back = 1\n", None),
    ("an outage's paper goes two weeks back", OUTAGE,
     "    back = FIRST_DAYS_PAPER_DAYS - 1 if first_days else 1\n",
     "    back = FIRST_DAYS_PAPER_DAYS - 1\n", None),
    ("the first days' paper goes fifteen days back", OUTAGE,
     "    back = FIRST_DAYS_PAPER_DAYS - 1 if first_days else 1\n",
     "    back = FIRST_DAYS_PAPER_DAYS if first_days else 1\n", None),
    ("a sale's kind is not stored", SALES_SERVICE,
     "        sale.outage_first_days = mark.first_days\n", "", None),
    ("a sale read back says no kind", OUTAGE,
     "            first_days=sale.outage_first_days,\n", "", None),
    ("a return's kind is not stored", REFUNDS,
     "            outage_first_days=mark is not None and mark.first_days,\n", "", None),
    ("a payment's kind is not stored", CREDIT,
     "                outage_first_days=mark is not None and mark.first_days,\n", "", None),
    ("«Звіт» says no kind of a sale", REPORT,
     "                    first_days=sale.outage_first_days,\n", "", None),
    ("an outage's body states its kind in the 7-day print", API_SALES,
     "        mark.pop(\"first_days\", None)\n", "        pass\n", None),
    ("a warehouse with history is said to await its first stock", REPO,
     "    return set((await session.scalars(select(asked.c.id).where(~moved, ~held))).all())\n",
     "    return set((await session.scalars(select(asked.c.id).where(~held))).all())\n", None),
    # The screens.
    ("the till sends no kind", SALE,
     "          ...(firstDays === true ? { first_days: true as const } : {}),\n", "", TILL),
    ("a return and a payment send no kind", MARK,
     "        ...(firstDays === true ? { first_days: true as const } : {}),\n", "", PAPER_RETURNS),
    ("the first days' day is left out", MARK,
     "  return /^\\d{4}-\\d{2}-\\d{2}$/.test(day) ? `${day}T${at}` : null;\n",
     "  return `${paperDay(false)}T${at}`;\n", TILL),
    ("a time without its day is sent", MARK,
     "  if (hasTime && !hasDay) return \"Вкажіть день з паперу.\";\n", "", TILL),
    ("a day without its time is sent", MARK,
     "  if (hasDay && !hasTime)\n", "  if (false)\n", TILL),
    ("the till sells before the kind is said", SALE,
     "                  (paper && (firstDays === null || paperProblem !== null))\n",
     "                  (paper && paperProblem !== null)\n", TILL),
    ("a return is sent before the kind is said", RETURNS,
     "            !ready || !mark.ready || (!sale.paid_in_parts && way === null)\n",
     "            !ready || (!sale.paid_in_parts && way === null)\n", PAPER_RETURNS),
    ("a payment is sent before the kind is said", CREDITS,
     "                disabled={!paperMark.ready}\n", "", PAPER_RETURNS),
    ("a new series keeps the kind", PAPER,
     "    firstDays: on ? firstDays : null,\n", "    firstDays: on ? firstDays : usePaper.getState().firstDays,\n",
     TILL),
    ("another kind keeps the day and time", SALE,
     "  }, [firstDays]);\n", "  }, []);\n", TILL),
    ("the reminder leaves the kind unsaid", SALE,
     "                turnPaper(true, false);\n", "                turnPaper(true);\n", SECTIONS),
    ("the first days' paper is still «під час збою» on the receipt", TYPES,
     "    mark.first_days === true ? \"Продано з паперу\" : \"Продано під час збою\",\n",
     "    \"Продано під час збою\",\n", TILL + PAPER_RETURNS),
    ("a return of the first days is «під час збою»", MARK,
     "  const how = mark.first_days === true ? \"з паперу\" : \"під час збою\";\n",
     "  const how = \"під час збою\";\n", PAPER_RETURNS),
    ("the first days' card money says an outage", TYPES,
     "      return firstDays\n        ? \"оплату вже провели, на терміналі не проводьте ще раз\"\n",
     "      return false\n        ? \"оплату вже провели, на терміналі не проводьте ще раз\"\n",
     TILL + PAPER_RETURNS),
    ("the first days' day reaches fifteen days back", MARK,
     "            min={daysAgo(firstDaysSpan - 1)}\n", "            min={daysAgo(firstDaysSpan)}\n", TILL),
    ("the first days ask «Це було вчора»", MARK,
     "      {firstDays !== true && time && (\n", "      {time && (\n", TILL + PAPER_RETURNS),
    ("a warehouse with nothing recorded offers goods", SALE,
     "  const waiting = chosen?.awaiting_first_stock === true;\n", "  const waiting = false;\n", TILL),
    ("the catalogue is offered from paper", SALE,
     "  const mayFindInCatalog = mayReadLabel && !paper;\n", "  const mayFindInCatalog = mayReadLabel;\n",
     TILL),
    ("the catalogue is offered without the rights", SALE,
     "  const mayFindInCatalog = mayReadLabel && !paper;\n", "  const mayFindInCatalog = !paper;\n", TILL),
    ("a coat from the catalogue comes with no price", CATALOG,
     "                    suggested_price: prices.data?.suggested_price ?? null,\n",
     "                    suggested_price: null,\n", TILL),
    ("the catalogue panel stays after a size", CATALOG,
     "                  close();\n", "", TILL),
    ("the paper mode leaves the catalogue panel open", SALE,
     "    // From paper nobody stands at the shelf: no coat is found in hand.\n    setFromCatalog(false);\n",
     "", TILL),
]


def env_for_unit() -> dict[str, str]:
    out = subprocess.run(["zsh", "-c", f"source {H / 'unit-env.sh'}; env"], capture_output=True, text=True,
                         check=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


UNIT_ENV = env_for_unit()
KNOWN = "the owner is shown last night's failed copy, and why Telegram did not say so"


def server() -> subprocess.CompletedProcess[str]:
    return subprocess.run(PYTEST, cwd=ROOT / "backend", env=UNIT_ENV, capture_output=True, text=True,
                          timeout=1200)


def screen(specs: list[str]) -> subprocess.CompletedProcess[str]:
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run([str(H / "e2e-run.sh"), *specs], cwd=ROOT / "frontend", capture_output=True,
                          text=True, timeout=1800)


def failed(run: subprocess.CompletedProcess[str], journeys: bool) -> list[str]:
    if journeys:
        titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                         if re.match(r"^\s+\[mobile-chromium\] › ", l)})
        return [t for t in titles if t != KNOWN]
    return sorted({l.split("::", 1)[-1].split(" ")[0] for l in run.stdout.splitlines()
                   if l.startswith("FAILED ")})


only = sys.argv[1] if len(sys.argv) > 1 else ""
chosen = [m for m in M if not only or only in m[0]]
journeys_all = sorted({spec for m in chosen if m[4] for spec in m[4]})
if any(m[1] in SERVER for m in chosen):
    base = server()
    names = failed(base, False)
    print(f"- unchanged tree (server): {'passed' if base.returncode == 0 else 'FAILED'} "
          f"{'; '.join(names)}", flush=True)
    if base.returncode != 0:
        sys.exit(1)
if journeys_all:
    base = screen(journeys_all)
    names = failed(base, True)
    print(f"- unchanged tree (screens): {'passed' if not names else 'FAILED'} {'; '.join(names)}",
          flush=True)
    if names:
        sys.exit(1)
caught = ran = 0
for name, rel, old, new, specs in chosen:
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)", flush=True)
        continue
    path.write_text(text.replace(old, new))
    journeys = specs is not None
    try:
        result = screen(specs) if journeys else server()
    finally:
        path.write_bytes(original)
    ran += 1
    names = failed(result, journeys)
    ok = bool(names) if journeys else result.returncode != 0
    caught += ok
    print(f"- {name}: {'caught by ' + '; '.join(n[:90] for n in names) if ok else 'SURVIVED'}",
          flush=True)
print(f"{caught} of {ran} caught")
