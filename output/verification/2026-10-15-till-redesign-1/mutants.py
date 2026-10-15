"""Break the till's first redesign part one way at a time: each must fail a journey.

Runs the journeys that prove it against the isolated E2E API
(`~/.cache/birka-runtime/helpers/e2e-fresh.sh`, `e2e-run.sh`), reseeded before
every run: the orders journeys reserve the fixture's stock, and a second run on
the same seed fails for want of it, whatever the mutant. The unchanged tree
runs first and must pass; each mutant names the journeys it failed.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
RUN = [str(H / "e2e-run.sh"), "e2e/till-redesign.spec.ts", "e2e/credits.spec.ts",
       "e2e/orders.spec.ts", "-g", "paid in parts|store|till|orders|panel|shortage|theme|lost committed"]
APP = "frontend/src/App.tsx"
SALE = "frontend/src/sales/Sale.tsx"
CSS = "frontend/src/styles.css"

M = [
    ("one store asks to be chosen", APP, "  const store = chosen ?? only;", "  const store = chosen;"),
    ("one store offers «Змінити магазин»", APP, "    only === undefined\n      ? () => {", "    true\n      ? () => {"),
    ("the till is not the first tab", APP, '      ? "sale"\n      : "list",', '      ? "list"\n      : "list",'),
    ("the till comes first without the right to sell", APP,
     'store.state === "ACTIVE" && store.permissions.includes("sale:create")', 'store.state === "ACTIVE"'),
    ("a kept order does not open «Замовлення»", APP, '        setTab("list");\n        loadedFromDisk("orders");', '        loadedFromDisk("orders");'),
    ("Telegram's dark theme is taken as light", "frontend/src/shared/telegram.ts",
     '  return isColorDark(bg) ? "dark" : "light";', '  return "light";'),
    ("the dark warning background is light", CSS, "  --warn-bg: #2a2414;\n  --warn-line: #5a4a22;",
     "  --warn-bg: #fbf1de;\n  --warn-line: #5a4a22;"),
    ("the dark alert text is the light one", CSS, "  --debt: #f08a5d;\n  --debt-bg: #2e1d15;",
     "  --debt: #a33a0b;\n  --debt-bg: #2e1d15;"),
    ("the panel is not held at the bottom", CSS, ".pay-panel {\n  position: sticky;", ".pay-panel {\n  position: static;"),
    ("the shortage answer is not focused", SALE, "    shortRef.current?.focus({ preventScroll: true });\n", ""),
    ("the shortage answer is not scrolled into view", SALE, '    shortRef.current?.scrollIntoView({ block: "nearest" });\n', ""),
    ("a seller who may not write a shelf off is not told", SALE, "{mayCorrect && !mayReportMissing && (", "{false && ("),
    ("the short line is not marked", SALE, 'index === shortIndex ? "line short" : "line"', '"line"'),
    ("the panel ignores a part payment", SALE, "            {owing ? (", "            {false ? ("),
    ("the panel shows on an empty basket", SALE, "      {draft.length > 0 && (\n        <div\n          className=\"pay-panel\"",
     "      {true && (\n        <div\n          className=\"pay-panel\""),
    ("the panel does not say what is sold", SALE, '          <p className="pay-what">', '          <p className="pay-what" hidden>'),
    ("the panel's height is not kept clear", CSS, "  scroll-padding-bottom: calc(var(--pay-panel-h, 0px) + 12px);", "  scroll-padding-bottom: 0;"),
    ("an unreadable kept invoice does not hold the till", APP,
     "              invoiceUnsettled ||\n              correctionUnsettled\n            }", "              correctionUnsettled\n            }"),
    ("a part payment's receipt leads with the whole", SALE,
     "            <strong>{money(receipt.credit.paid_now)}</strong>\n            {paid !== null",
     "            <strong>{money(receipt.total)}</strong>\n            {paid !== null"),
    ("a card part payment does not say to charge the terminal", SALE,
     '{way === "CARD" && paid === null\n              ? "Проведіть на терміналі"\n              : "Зараз"}',
     '{"Зараз"}'),
    ("a card part payment from paper says to charge the terminal", SALE,
     '{way === "CARD" && paid === null\n              ? "Проведіть на терміналі"',
     '{way === "CARD"\n              ? "Проведіть на терміналі"'),
    ("a transfer part payment says nothing of checking it", SALE, '              : way === "TRANSFER" &&', "              : false &&"),
    ("the receipt does not say the whole price", SALE, "            Разом за товар <strong>", "            Разом <strong>"),
]

def journeys() -> subprocess.CompletedProcess[str]:
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run(RUN, capture_output=True, text=True, timeout=1200)


def failed(run: subprocess.CompletedProcess[str]) -> str:
    titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                     if re.match(r"^\s+\[mobile-chromium\] › ", l)})
    return "; ".join(t[:90] for t in titles)


only = sys.argv[1] if len(sys.argv) > 1 else ""
base = journeys()
summary = next((l.strip() for l in base.stdout.splitlines() if re.search(r"^\s+\d+ passed", l)), "")
print(f"- unchanged tree: {'passed' if base.returncode == 0 else 'FAILED'} {summary} {failed(base)}", flush=True)
if base.returncode != 0:
    sys.exit(1)
caught = ran = 0
for name, rel, old, new in M:
    if only and only not in name:
        continue
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)")
        continue
    path.write_text(text.replace(old, new))
    try:
        run = journeys()
    finally:
        path.write_bytes(original)
    ran += 1
    ok = run.returncode != 0
    caught += ok
    print(f"- {name}: {'caught by ' + failed(run) if ok else 'SURVIVED'}", flush=True)
print(f"{caught} of {ran} caught")
