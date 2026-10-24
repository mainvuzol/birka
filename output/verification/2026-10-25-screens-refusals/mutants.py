"""Break the other screens' refusals in their own words (owner decisions,
2026-10-25) one way at a time: each must fail a journey. A refusal no screen
names said in that screen's words, never an order's — models, «Брак», a
delivery, a correction, a stocktake, the price, a store's state, suppliers,
their returns, invoices and borrowed goods, erasing a customer's data, the
sign-in; a conflict re-read where it says to look again; «Брак» named; a
kept command met by a conflict without proof still unconfirmed; a kept
delivery, correction or model change recorded nowhere in its own words.

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
API = "frontend/src/shared/api.ts"
ERRORS = "frontend/src/cash/errors.ts"
MODELS = "frontend/src/catalog/Models.tsx"
DAMAGED = "frontend/src/damaged/Damaged.tsx"
RECEIVE = "frontend/src/inventory/Receive.tsx"
CORRECTION = "frontend/src/inventory/Correction.tsx"
STOCKTAKE = "frontend/src/inventory/Stocktake.tsx"
PRICE = "frontend/src/prices/SuggestedPrice.tsx"
STORES = "frontend/src/stores/Stores.tsx"
SUPPLIERS = "frontend/src/suppliers/Suppliers.tsx"
PICKER = "frontend/src/suppliers/Picker.tsx"
INVOICES = "frontend/src/suppliers/Invoices.tsx"
BORROWED = "frontend/src/suppliers/Borrowed.tsx"
DEBT = "frontend/src/credits/Debt.tsx"
APP = "frontend/src/App.tsx"

RENAME = ["e2e/models.spec.ts", "-g", "a rename warns of a similar word"]
MERGE = ["e2e/models.spec.ts", "-g", "a duplicate is merged after a preview"]
RETIRE = ["e2e/models.spec.ts", "-g", "a retired model is not received"]
KEPT_MODEL = ["e2e/models.spec.ts", "-g", "refused on its check for a conflict no screen names"]
KEPT_MODEL_FORM = ["e2e/models.spec.ts", "-g", "refused on its check for a form no screen names"]
DAMAGED_J = ["e2e/damaged.spec.ts", "-g", "taken for inspection"]
RECEIVE_J = ["e2e/receive.spec.ts"]
CORRECT = ["e2e/correct.spec.ts", "-g", "a stocktake states what the shelf holds"]
STOCKTAKE_J = ["e2e/stocktake.spec.ts", "-g", "counted position by position"]
PRICE_J = ["e2e/price.spec.ts"]
STORES_J = ["e2e/stores.spec.ts"]
SUPPLIERS_J = ["e2e/suppliers.spec.ts", "-g", "goods go back to a supplier from a warehouse"]
INVOICES_J = ["e2e/supplier-invoices.spec.ts", "-g", "an invoice is recorded and paid in parts"]
BORROWED_J = ["e2e/borrowed.spec.ts"]
ERASE = ["e2e/credits.spec.ts", "-g", "erases a closed debt"]
SIGN_IN = ["e2e/session.spec.ts", "-g", "a sign-in refused"]
KEPT_DELIVERY = ["e2e/outage.spec.ts", "-g", "a kept delivery"]
KEPT_CORRECTION = ["e2e/outage.spec.ts", "-g", "a kept stock correction refused for its form"]

M = [
    ("the shared words kept for a form", API,
     "  if (said === INVALID_TEXT) return invalid;\n", "", RENAME),
    ("the shared words kept for a conflict", API,
     "  if (said === CONFLICT_TEXT) return conflict;\n", "", RETIRE),
    ("no conflict seen", API,
     "  return errorText(error) === CONFLICT_TEXT;", "  return false;", RETIRE),
    ("«Брак» said as a conflict", API,
     "  if (error.code === \"DAMAGED_STOCK_CLOSED\")", "  if (false)", CORRECT),
    ("a kept conflict told it failed", ERRORS,
     "  if (text === CONFLICT_TEXT)\n    return `${what} ще не підтверджено: сервер відповів, що дані змінилися.",
     "  if (false)\n    return `${what} ще не підтверджено: сервер відповів, що дані змінилися.", KEPT_DELIVERY),
    ("a kept delivery recorded nowhere in the shared words", ERRORS,
     "        \"Дані змінилися, поки сервер не відповідав: перевірте список і внесіть його ще раз.\",",
     "        CONFLICT_TEXT,", KEPT_DELIVERY),
    ("a rename refused in the shared words", MODELS,
     "\"Назву не змінено. Перевірте поля та спробуйте ще раз.\"", "\"Перевірте дані та поточний статус замовлення.\"", RENAME),
    ("a merge refused in the shared words", MODELS,
     "\"Моделі не об’єднано. Спробуйте ще раз.\"", "\"Перевірте дані та поточний статус замовлення.\"", MERGE),
    ("a retire's conflict in the shared words", MODELS,
     "\"Модель не прибрано: її щойно змінили — перегляньте її й спробуйте ще раз.\"", "\"Модель не прибрано.\"", RETIRE),
    ("a restore refused in the shared words", MODELS,
     "\"Модель не повернуто. Спробуйте ще раз.\"", "\"Модель не повернуто.\"", RETIRE),
    ("a model's conflict not read again", MODELS,
     "      if (isConflict(outcome.error)) await reread();\n", "", RETIRE),
    ("a kept model change's conflict not read again", MODELS,
     "                if (isConflict(outcome.error)) void reread();\n", "", KEPT_MODEL),
    ("a kept model change in the shared words", MODELS,
     "                    \"Внесіть її ще раз.\",", "                    \"\",", KEPT_MODEL_FORM),
    ("«Брак»'s action refused in the shared words", DAMAGED,
     "                \"Не записано. Перевірте дані та спробуйте ще раз.\",", "                errorText(error),", DAMAGED_J),
    ("a delivery refused in the shared words", RECEIVE,
     "    \"Нічого не прийнято. Перевірте рядки та спробуйте ще раз — список збережено.\",",
     "    \"Перевірте дані та поточний статус замовлення.\",", RECEIVE_J),
    ("a delivery's conflict in the shared words", RECEIVE,
     "    \"Нічого не прийнято: поки ви працювали, дані змінилися. Перевірте рядки та спробуйте ще раз — список збережено.\",",
     "    \"Дані змінилися.\",", RECEIVE_J),
    ("a correction refused in the shared words", CORRECTION,
     "    \"Перевірте кількість та спробуйте ще раз.\",", "    \"Перевірте дані та поточний статус замовлення.\",", CORRECT),
    ("a count refused in the shared words", STOCKTAKE,
     "  return `${inOwnWords(\n    errorText(error),\n    \"Перевірте кількість та спробуйте ще раз.\",",
     "  return `${inOwnWords(\n    errorText(error),\n    \"Перевірте дані.\",", STOCKTAKE_J),
    ("a stocktake's start's conflict not read again", STOCKTAKE,
     "      if (isConflict(error)) void list.refetch();\n", "", STOCKTAKE_J),
    ("a stocktake's finish's conflict not read again", STOCKTAKE,
     "      if (isConflict(error)) void current.refetch();\n", "", STOCKTAKE_J),
    ("a price refused in the shared words", PRICE,
     "\"Ціну не збережено. Перевірте суму та спробуйте ще раз.\"", "\"Перевірте дані та поточний статус замовлення.\"", PRICE_J),
    ("a price's conflict not read again", PRICE,
     "        if (isConflict(error)) await refetch();\n", "", PRICE_J),
    ("a store's state refused in the shared words", STORES,
     "    \"Стан магазину не змінено: його змінили — перегляньте його й спробуйте ще раз.\",",
     "    \"Дані змінилися або команда конфліктує з попередньою. Оновіть замовлення.\",", STORES_J),
    ("a supplier edited in the shared words", SUPPLIERS,
     "\"Постачальника не збережено. Перевірте назву й телефон та спробуйте ще раз.\"", "\"Перевірте дані та поточний статус замовлення.\"", SUPPLIERS_J),
    ("a supplier's conflict not read again", SUPPLIERS,
     "      if (isConflict(error))\n        await cache.invalidateQueries({ queryKey: [\"suppliers\", store.id] });\n", "", SUPPLIERS_J),
    ("a return's conflict in the shared words", SUPPLIERS,
     "    \"Не записано: дані повернення змінилися — перегляньте їх і спробуйте ще раз.\",",
     "    \"Дані змінилися або команда конфліктує з попередньою. Оновіть замовлення.\",", SUPPLIERS_J),
    ("a return's conflict not read again", SUPPLIERS,
     "              if (isConflict(outcome.error))\n                await cache.invalidateQueries({\n                  queryKey: [\"supplier-returns\", store.id],\n                });\n", "", SUPPLIERS_J),
    ("a cancel's conflict not read again", SUPPLIERS,
     "      if (isConflict(error)) changed();\n", "", SUPPLIERS_J),
    ("a supplier added in the shared words", PICKER,
     "\"Постачальника не додано. Перевірте назву й телефон та спробуйте ще раз.\"", "\"Перевірте дані та поточний статус замовлення.\"", INVOICES_J),
    ("an invoice's conflict in the shared words", INVOICES,
     "    \"Не записано: дані змінилися — перегляньте їх і спробуйте ще раз.\",",
     "    \"Дані змінилися або команда конфліктує з попередньою. Оновіть замовлення.\",", INVOICES_J),
    ("borrowed goods refused in the shared words", BORROWED,
     "    \"Не записано. Перевірте кількість та спробуйте ще раз.\",", "    \"Перевірте дані та поточний статус замовлення.\",", BORROWED_J),
    ("borrowed goods' conflict not read again", BORROWED,
     "                // Changed in a way it does not name: the lots read again.\n                if (isConflict(outcome.error))\n                  await cache.invalidateQueries({\n                    queryKey: [\"borrowed\", store.id],\n                  });\n                return refusalText(outcome.error);\n              }}\n              sendBack",
     "                return refusalText(outcome.error);\n              }}\n              sendBack", BORROWED_J),
    ("erasing refused in the shared words", DEBT,
     "\"Дані покупця не стерто: борг щойно змінився — перегляньте його й спробуйте ще раз.\"", "\"Дані змінилися.\"", ERASE),
    ("erasing's conflict not read again", DEBT,
     "      if (isConflict(error))\n        try {\n          changed(", "      if (false)\n        try {\n          changed(", ERASE),
    ("a sign-in refused in the shared words", APP,
     "                inOwnWords(\n                  errorText(failure),", "                ((said: string) => said)(\n                  errorText(failure),", SIGN_IN),
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
