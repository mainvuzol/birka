"""Break the sections, the header and the till's reminder one way at a time: each must fail a journey.

Every mutant is in the screens, so each runs the journeys that should catch
it against the isolated E2E API (`e2e-fresh.sh`, `e2e-run.sh`), reseeded
before every run. The unchanged tree runs first, with every journey any
mutant names, and must pass; each mutant names the journeys that failed.
An optional argument runs only the mutants whose name contains it.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
APP = "frontend/src/App.tsx"
SALE = "frontend/src/sales/Sale.tsx"
REACH = "frontend/src/shared/reach.ts"
PAPER = "frontend/src/sales/paper.ts"
CSS = "frontend/src/styles.css"

SECTIONS = ["e2e/till-sections.spec.ts"]

M = [
    # The row and «Ще».
    ("«Повернення» is left under «Ще»", APP,
     '  "sale",\n  "returns",\n  "credits",\n', '  "sale",\n  "credits",\n', SECTIONS),
    ("«Ще» opens again on the section it was opened on", APP,
     "        setMoreAt(null);\n      }}\n", "      }}\n", SECTIONS),
    ("«Ще» stays open when the app turns to another section", APP,
     "  const moreOpen = moreAt === tab;\n", "  const moreOpen = moreAt !== null;\n",
     ["e2e/till-receipt.spec.ts"]),
    ("the focus is lost when «Ще» closes", APP,
     "        if (moreOpen && !counter.has(section.tab)) moreButton.current?.focus();\n", "", SECTIONS),
    ("«Ще» does not say the section open is its own", APP,
     '            aria-current={inMore ? "true" : undefined}\n', "", SECTIONS),
    ("«Ще» is not marked for a section of its own", APP,
     '            className={inMore ? "active" : "quiet"}\n', '            className="quiet"\n', SECTIONS),
    ("the section open is not told", APP,
     '      aria-current={tab === section.tab ? "page" : undefined}\n', "", SECTIONS),
    ("«Ще» shows everything before it is asked", APP,
     '        <div id={moreId} className="more" hidden={!moreOpen}>\n',
     '        <div id={moreId} className="more">\n', SECTIONS),
    ("«Ще» says nothing of the backups", APP,
     '            Ще{backupsNeedYou ? " ⚠" : ""}\n', "            Ще\n",
     ["e2e/backups.spec.ts", "e2e/failures.spec.ts"]),
    ("«Залишки» are shown without the right", APP,
     '      label: "Залишки",\n      shown: store.permissions.includes("inventory:view"),\n',
     '      label: "Залишки",\n      shown: true,\n', ["e2e/stock.spec.ts"]),
    ("«Звіт» is shown without the right", APP,
     '      label: "Звіт",\n      shown: canSeeReport,\n', '      label: "Звіт",\n      shown: true,\n',
     ["e2e/sales-report.spec.ts"]),
    ("«Каса» is held like every other section", APP,
     '      label: "Каса",\n      shown: canSeeCash,\n      disabled: otherThanCash,\n',
     '      label: "Каса",\n      shown: canSeeCash,\n      disabled: blocked,\n', ["e2e/cash.spec.ts"]),
    ("«Постачальникам» is held like every other section", APP,
     '      shown: canReturnToSupplier,\n      disabled: otherThanSuppliers,\n',
     '      shown: canReturnToSupplier,\n      disabled: blocked,\n', ["e2e/suppliers.spec.ts"]),
    ("«Накладні» are held like every other section", APP,
     '      shown: canSeeInvoices,\n      disabled: otherThanInvoices,\n',
     '      shown: canSeeInvoices,\n      disabled: blocked,\n', ["e2e/supplier-invoices.spec.ts"]),
    ("«Моделі» are held like every other section", APP,
     '      shown: canCorrect,\n      disabled: otherThanCorrections,\n',
     '      shown: canCorrect,\n      disabled: blocked,\n', ["e2e/models.spec.ts"]),
    ("«Магазини» are held like every other section", APP,
     '      shown: canManageStores,\n      disabled: otherThanStores,\n',
     '      shown: canManageStores,\n      disabled: blocked,\n', ["e2e/stores.spec.ts"]),
    ("«Замовлення» keeps the order left open", APP,
     '      label: "Замовлення",\n      shown: true,\n      disabled: blocked,\n      forgetsOrder: true,\n',
     '      label: "Замовлення",\n      shown: true,\n      disabled: blocked,\n',
     ["e2e/orders.spec.ts"]),
    ("a label is cut short at 360 px", CSS,
     "nav.sections .row button {\n  flex: 1 1 auto;\n  min-width: 0;\n  padding: 12px 4px;\n",
     "nav.sections .row button {\n  flex: 1 1 auto;\n  min-width: 0;\n  padding: 12px 10px;\n", SECTIONS),
    ("the row wraps at 360 px", CSS,
     "nav.sections .row {\n  display: flex;\n  gap: 4px;\n}\n",
     "nav.sections .row {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 12px;\n}\n", SECTIONS),
    # The header.
    ("the header names nobody", APP,
     "        <span> · {visible(person)}</span>\n", "", SECTIONS + ["e2e/till-search.spec.ts"]),
    ("«Змінити магазин» is offered with one store", APP,
     "        changeStore={changeStore}\n        blocked={blocked}\n",
     "        changeStore={changeStore ?? (() => undefined)}\n        blocked={blocked}\n",
     SECTIONS + ["e2e/till-redesign.spec.ts"]),
    ("«Змінити магазин» is not held", APP,
     "        changeStore={changeStore}\n        blocked={blocked}\n",
     "        changeStore={changeStore}\n", ["e2e/sale.spec.ts", "e2e/cash.spec.ts"]),
    # The reminder.
    ("the server's return is not remembered", REACH,
     "    useReach.setState({ down: false, since: null, back: true });\n",
     "    useReach.setState({ down: false, since: null });\n", SECTIONS),
    ("the reminder stays while the server is lost again", REACH,
     "      since: new Date().toISOString(),\n      back: false,\n",
     "      since: new Date().toISOString(),\n", SECTIONS),
    ("the switch does not answer the reminder", PAPER, "  if (on) backNoted();\n", "", SECTIONS),
    ("«Пізніше» puts nothing away", SALE,
     '            <button className="quiet" onClick={backNoted}>\n',
     '            <button className="quiet" onClick={() => undefined}>\n', SECTIONS),
    ("a server back in paper mode leaves the reminder to say", PAPER,
     "  if (state.back && !previous.back && usePaper.getState().storeId !== null)\n    backNoted();\n",
     "  if (state.back && !previous.back && usePaper.getState().storeId !== null)\n    return;\n", SECTIONS),
    ("the reminder's button does not tick the switch", SALE,
     "              onClick={() => {\n                turnPaper(true);\n              }}\n            >\n              Вношу продаж з паперу\n",
     "              onClick={backNoted}\n            >\n              Вношу продаж з паперу\n", SECTIONS),
    ("the reminder does not say the drawer", SALE,
     "            Сервер знову відповідає: продажі з паперу можна вносити. Внесіть їх\n            до закриття каси.\n",
     "            Сервер знову відповідає: продажі з паперу можна вносити.\n", SECTIONS),
    ("the reminder's button ticks the switch under a sale on its way", SALE,
     "            <button\n              disabled={blocked || working}\n              onClick={() => {\n                turnPaper(true);\n",
     "            <button\n              onClick={() => {\n                turnPaper(true);\n", SECTIONS),
    ("a phone that never lost the server is reminded", REACH,
     "  since: null,\n  back: false,\n}));\n", "  since: null,\n  back: true,\n}));\n", SECTIONS),
]


def screen(specs: list[str]) -> subprocess.CompletedProcess[str]:
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run([str(H / "e2e-run.sh"), *specs], cwd=ROOT / "frontend", capture_output=True,
                          text=True, timeout=1800)


def failed(run: subprocess.CompletedProcess[str]) -> str:
    titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                     if re.match(r"^\s+\[mobile-chromium\] › ", l)})
    return "; ".join(t[:90] for t in titles)


only = sys.argv[1] if len(sys.argv) > 1 else ""
chosen = [m for m in M if not only or only in m[0]]
every = sorted({spec for m in chosen for spec in m[4]})
base = screen(every)
# The shared E2E database keeps every run's backup nights: the backups
# journey that counts them fails on it alone, as it does unchanged.
base_failed = failed(base)
print(f"- unchanged tree: {'passed' if base.returncode == 0 else 'FAILED'} {base_failed}", flush=True)
if base.returncode != 0 and base_failed != "the owner is shown last night's failed copy, and why Telegram did not say so":
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
    try:
        result = screen(specs)
    finally:
        path.write_bytes(original)
    ran += 1
    names = failed(result)
    if "backups.spec.ts" in " ".join(specs):
        names = "; ".join(n for n in names.split("; ")
                          if n != "the owner is shown last night's failed copy, and why Telegram did not say so")
    ok = bool(names)
    caught += ok
    print(f"- {name}: {'caught by ' + names if ok else 'SURVIVED'}", flush=True)
print(f"{caught} of {ran} caught")
