"""Break the till's receipt and its small things one way at a time: each must fail a test.

Server mutants run the server's tests on the branch's isolated database
(`~/.cache/birka-runtime/helpers/unit-env.sh`); screen mutants run the
journeys against the isolated E2E API (`e2e-fresh.sh`, `e2e-run.sh`),
reseeded before every run. The unchanged tree runs first, both ways, and
must pass; each mutant names the tests that failed. An optional argument
runs only the mutants whose name contains it.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
R = Path.home() / ".cache/birka-runtime"
H = R / "helpers"
SERVICE = "backend/app/modules/inventory/service.py"
REPO = "backend/app/modules/inventory/repository.py"
API = "backend/app/api/v1/sales.py"
SALE = "frontend/src/sales/Sale.tsx"
TG = "frontend/src/shared/telegram.ts"
RETURNS = "frontend/src/returns/Returns.tsx"
TERMS = "frontend/src/credits/Terms.tsx"
CSS = "frontend/src/styles.css"
PAPER = "frontend/src/sales/paperMark.tsx"
SERVER = {SERVICE, REPO, API}

PYTEST = [str(R / "python/bin/python"), "-m", "pytest", "-q", "-p", "no:cacheprovider",
          "tests/integration/test_sale_receipt_units.py", "tests/integration/test_sale_retry_contract.py",
          "tests/integration/test_missing_at_sale.py"]
E2E = [str(H / "e2e-run.sh"), "e2e/till-receipt.spec.ts", "e2e/sale.spec.ts", "e2e/size.spec.ts",
       "e2e/outage-mark-debts-returns.spec.ts", "e2e/credits.spec.ts", "e2e/till-search.spec.ts"]

M = [
    # The server.
    ("found goods are not counted", SERVICE, "            found += delta\n", "            pass\n"),
    ("a shortage is counted as found", SERVICE, "            missing -= delta\n", "            found -= delta\n"),
    ("both halves of a clarification are counted", REPO,
     "                    MovementReason.MISSING_AT_SALE,\n                    MovementReason.SIZE_RECLASSIFICATION_IN,\n",
     "                    MovementReason.MISSING_AT_SALE,\n                    MovementReason.SIZE_RECLASSIFICATION_IN,\n"
     "                    MovementReason.SIZE_RECLASSIFICATION_OUT,\n"),
    ("the line names no size", API,
     '                display_name=item.display_name_snapshot,\n                size=item.variant_snapshot.get("size"),\n',
     '                display_name=item.display_name_snapshot,\n'),
    ("a sale read with no stored answer counts nothing", API,
     "            outage=(await marks_of(session, [sale])).get(sale.id),\n            units=await _units(session, sale),\n",
     "            outage=(await marks_of(session, [sale])).get(sale.id),\n"),
    ("a new sale's answer counts nothing", API,
     "            (await marks_of(session, [result.sale])).get(result.sale.id),\n            await _units(session, result.sale),\n",
     "            (await marks_of(session, [result.sale])).get(result.sale.id),\n"),
    # The screens.
    ("the receipt line names no size", SALE, "              {size !== null && ` · ${size}`}\n", ""),
    ("the receipt ignores the basket's size", SALE, "            : sent !== undefined\n", "            : false\n"),
    ("the receipt counts movements, not coats", SALE,
     "          {typeof receipt.found_quantity === \"number\"\n            ? `: ${String(receipt.found_quantity)} шт.`",
     "          {typeof receipt.found_quantity === \"number\"\n            ? `: ${String(receipt.corrections.length)} шт.`"),
    ("the label's size is not said", SALE, "      {receipt.clarified\n        ? receipt.clarified.map(", "      {false\n        ? receipt.clarified.map("),
    ("a write-off is not said", SALE,
     "      {(receipt.missing_quantity ?? receipt.shortages.length) > 0 && (",
     "      {false && ("),
    ("no buzz when sold", SALE, '        buzz("success");\n', ""),
    ("no buzz when refused", SALE, '      buzz("error");\n', ""),
    ("an old Telegram is asked to buzz", TG,
     '    if (!version || !supports("web_app_trigger_haptic_feedback", version))\n      return;\n', ""),
    ("the receipt offers no return", SALE, "      {returnSale && (\n", "      {false && (\n"),
    ("the return opens the list, not the sale", RETURNS, "    if (sale) setSelected(sale);\n", ""),
    ("the return is offered without the right", APP_RETURN := "frontend/src/App.tsx",
     "            {...(canReturn\n", "            {...(true\n"),
    ("a failed list leaves the sale to open later", RETURNS,
     "    if (sales.isError) {\n      opened?.();\n      return;\n    }\n", ""),
    ("a return left before its list opens the sale later", "frontend/src/App.tsx",
     '    if (tab !== "returns") setReturnOf(null);\n', ""),
    ("the return opens from a page cached before the sale", RETURNS,
     "    if (!sales.isSuccess || sales.isFetching) return;\n", "    if (!sales.isSuccess) return;\n"),
    ("the shelf's question buzzes as an error", SALE,
     "        setShortfall(short);\n", '        setShortfall(short);\n        buzz("error");\n'),
    ("the keyboard's key does not move on", TERMS, "      if (next) next.focus();\n", ""),
    ("a 0,00 грн line is not warned about", SALE, '{d.line.unit_price === "0.00" && (', "{false && ("),
    ("ticking «Оплата частинами» leaves the cursor", TERMS,
     "    if (value.inParts && !wasInParts.current) nameRef.current?.focus();\n", ""),
    ("the ticks are 23 px", CSS, "  min-height: 44px;\n}\n.check input {", "}\n.check input {"),
    ("the return's paper band names «Звіт»", PAPER,
     "Воно увійде в сьогоднішні повернення й у касу", "Воно увійде в сьогоднішній «Звіт» і в касу"),
]


def env_for_unit() -> dict[str, str]:
    out = subprocess.run(["zsh", "-c", f"source {H / 'unit-env.sh'}; env"], capture_output=True, text=True,
                         check=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


UNIT_ENV = env_for_unit()


def server() -> subprocess.CompletedProcess[str]:
    return subprocess.run(PYTEST, cwd=ROOT / "backend", env=UNIT_ENV, capture_output=True, text=True,
                          timeout=1200)


def screen() -> subprocess.CompletedProcess[str]:
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run(E2E, cwd=ROOT / "frontend", capture_output=True, text=True, timeout=1800)


def failed(run: subprocess.CompletedProcess[str], journeys: bool) -> str:
    if journeys:
        titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                         if re.match(r"^\s+\[mobile-chromium\] › ", l)})
    else:
        titles = sorted({l.split("::", 1)[-1].split(" ")[0] for l in run.stdout.splitlines()
                         if l.startswith("FAILED ")})
    return "; ".join(t[:90] for t in titles)


only = sys.argv[1] if len(sys.argv) > 1 else ""
chosen = [m for m in M if not only or only in m[0]]
for label, run, journeys in (("server", server, False), ("screen", screen, True)):
    if not any((m[1] in SERVER) != journeys for m in chosen):
        continue
    base = run()
    print(f"- unchanged tree ({label}): {'passed' if base.returncode == 0 else 'FAILED'} {failed(base, journeys)}",
          flush=True)
    if base.returncode != 0:
        sys.exit(1)
caught = ran = 0
for name, rel, old, new in chosen:
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)", flush=True)
        continue
    path.write_text(text.replace(old, new))
    journeys = rel not in SERVER
    try:
        result = screen() if journeys else server()
    finally:
        path.write_bytes(original)
    ran += 1
    ok = result.returncode != 0
    caught += ok
    print(f"- {name}: {'caught by ' + failed(result, journeys) if ok else 'SURVIVED'}", flush=True)
print(f"{caught} of {ran} caught")
