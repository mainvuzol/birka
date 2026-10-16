"""Break the money format, the till's words and its refusals one way at a time: each must fail a journey.

Every mutant is in the screens, so each runs the journeys meant to catch it
against the isolated E2E API (`e2e-fresh.sh`, `e2e-run.sh`), reseeded
before every run. The unchanged tree runs first, with every journey any
mutant names, and must pass; each mutant names the journeys that failed.
An optional argument runs only the mutants whose names contain one of its
parts, separated by "|".
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
APP = "frontend/src/App.tsx"
SALE = "frontend/src/sales/Sale.tsx"
CASH = "frontend/src/cash/Cash.tsx"
TYPES = "frontend/src/orders/types.ts"
CSS = "frontend/src/styles.css"

MONEY = ["e2e/till-money-words.spec.ts", "-g", "sums read"]
BASKET = ["e2e/till-money-words.spec.ts", "-g", "basket of two lines"]
RESERVED = ["e2e/till-money-words.spec.ts", "-g", "a shelf short"]
REFUSED = ["e2e/till-money-words.spec.ts", "-g", "a conflict"]
SIZE = ["e2e/size.spec.ts"]
SHORT = ["e2e/sale.spec.ts", "-g", "answers a real refusal|на місці лише стільки"]
SHELF = ["e2e/shelf.spec.ts"]
TILL_READ = ["e2e/outage.spec.ts", "-g", "whose stock read went unanswered"]
RECEIPT_KEPT = ["e2e/models.spec.ts", "-g", "a delivery whose answer was lost"]
ORDER_KEPT = ["e2e/orders.spec.ts", "-g", "lost committed response survives"]
ORDER = ["e2e/orders.spec.ts", "-g", "reserve, dispatch, arrive, collect through real API"]
ORDER_IN_PARTS = ["e2e/credits.spec.ts", "-g", "an order collected may be paid in parts"]
PAYMENT_KEPT = ["e2e/credits.spec.ts", "-g", "a payment whose answer is lost"]
CLOSE_KEPT = ["e2e/outage.spec.ts", "-g", "a close whose answer was lost"]
RETURN = ["e2e/returns.spec.ts", "-g", "one coat back intact"]
KEPT_SALE = ["e2e/outage.spec.ts", "-g", "the same sale under the same key|once when the app is opened again",
             "e2e/person-limit.spec.ts"]
KEPT_CONFLICT = ["e2e/outage.spec.ts", "-g", "a conflict the server names no more of"]

M = [
    ("thousands run together again", TYPES,
     r'whole.replace(/\B(?=(\d{3})+$)/g, "\u00a0")', "whole", MONEY),
    ("thousands apart by a plain space", TYPES, r'"\u00a0")},', '" ")},', MONEY),
    ("figures in proportional digits", CSS, "  font-variant-numeric: tabular-nums;\n", "", MONEY),
    ("a conflict at the till speaks of an order", SALE,
     "if (text === CONFLICT_TEXT) return TILL_CONFLICT_TEXT;",
     "if (false) return TILL_CONFLICT_TEXT;", REFUSED),
    ("a request the till could not read speaks of an order", SALE,
     '      if (text === INVALID_TEXT) return "Перевірте товар, кількість і ціну.";\n', "",
     REFUSED),
    ("the whole form is «Кошик» again", SALE,
     "      <fieldset disabled={blocked || working}>\n",
     "      <fieldset disabled={blocked || working}>\n        <legend>Кошик</legend>\n", BASKET),
    ("the basket counts «од.»", SALE, "0))} шт.`}", "0))} од.`}", BASKET),
    ("a short shelf does not say an order holds the rest", SALE,
     '{shortfall.reserved === true && " поза резервом замовлення."}',
     '{shortfall.reserved === true && "."}', RESERVED),
    ("a short shelf says «доступно», not «шт.»", SALE,
     "кошику {shortfall.requested} шт., в обліку {shortfall.available}",
     "кошику {shortfall.requested}, в обліку доступно {shortfall.available}", SHORT + SIZE),
    ("the unread label sells «без розміру»", SALE,
     "Не читали — продати як «розмір невідомий»", "Не читали — продати без розміру", SIZE),
    ("a label's size from unknown stock is «без розміру»", SALE,
     "Розмір з етикетки; в обліку — «розмір невідомий»", "Розмір з етикетки товару без розміру",
     SIZE),
    ("the shelf offers «Це товар без розміру»", SALE,
     'Розмір з етикетки — продати як{" "}', 'Це товар без розміру — продати як{" "}', SIZE),
    ("too few of unknown size says «без розміру»", SALE,
     "з невідомим розміром на складі менше", "без розміру на складі менше", SIZE),
    ("the count present asks «одиниць»", SALE,
     "                        На місці фактично є, шт.\n",
     "                        На місці фактично є, одиниць\n", SHORT),
    ("nothing sold counts «од.»", SALE,
     "Знято з обліку: ${String(line.removed)} шт.`", "Знято з обліку: ${String(line.removed)} од.`",
     SHELF),
    ("a till read that failed says «Повторити завантаження»", SALE,
     "        Спробувати ще раз\n", "        Повторити завантаження\n", TILL_READ),
    ("a kept delivery says new operations are blocked", APP,
     "сама поставка не буде прийнята двічі. Поки чекаємо, інші дії\n            недоступні.",
     "сама поставка не буде прийнята двічі. Нові операції заблоковано.", RECEIPT_KEPT),
    ("a kept order says new operations are blocked", APP,
     "<p>{pending.label}. Поки чекаємо, інші дії недоступні.</p>",
     "<p>{pending.label}. До підтвердження результату нові операції заблоковано.</p>",
     ORDER_KEPT),
    ("a kept payment says new operations are blocked", APP,
     "Перевірте результат — та сама операція не запишеться двічі. Поки\n"
     "            чекаємо, інші дії недоступні.\n          </p>\n          <p>{keptText(creditCommand",
     "Перевірте результат — та сама операція не запишеться двічі. Нові\n"
     "            операції заблоковано.\n          </p>\n          <p>{keptText(creditCommand",
     PAYMENT_KEPT),
    ("a kept close says new operations are blocked", CASH,
     "двічі. Поки\n            чекаємо, інші дії недоступні.",
     "двічі. Нові\n            операції заблоковано.", CLOSE_KEPT),
    ("an order's line is priced «за одиницю»", APP,
     "{money(item.unit_price)} за 1 шт.\n", "{money(item.unit_price)} за одиницю\n", ORDER),
    ("an order sold says «Продаж зафіксовано»", APP,
     "          Продаж записано.\n", "          Продаж зафіксовано.\n", ORDER),
    ("an order's form asks «Домовлена ціна за одиницю»", APP,
     "            Ціна, грн\n", "            Домовлена ціна за одиницю, грн\n", ORDER),
    ("a kept sale confirmed is «Продаж підтверджено» again", APP,
     "<h3>Продаж записано один раз</h3>", "<h3>Продаж підтверджено</h3>", KEPT_SALE),
    ("a kept sale's conflict says to try again", "frontend/src/cash/errors.ts",
     '  if (tillRefusalText(error) === TILL_CONFLICT_TEXT)\n    return "дані змінилися, поки сервер не відповідав";\n',
     "", KEPT_CONFLICT),
    ("the lines are not named «Кошик»", SALE, '<div role="group" aria-label="Кошик">', "<div>",
     BASKET),
    ("a return's line is priced «за одиницю»", "frontend/src/returns/Returns.tsx",
     "{money(item.final_unit_price)} за 1 шт. · продано",
     "{money(item.final_unit_price)} за одиницю · продано", RETURN),
    ("an order paid in parts says «клієнт винен»", APP,
     "сплачено {money(order.credit.paid)}, покупець винен",
     "сплачено {money(order.credit.paid)}, клієнт винен", ORDER_IN_PARTS),
]

KNOWN = "the owner is shown last night's failed copy, and why Telegram did not say so"


def screen(specs: list[str]) -> subprocess.CompletedProcess[str]:
    subprocess.run([str(H / "e2e-fresh.sh")], check=True, capture_output=True)
    return subprocess.run([str(H / "e2e-run.sh"), *specs], cwd=ROOT / "frontend", capture_output=True,
                          text=True, timeout=1800)


def failed(run: subprocess.CompletedProcess[str]) -> list[str]:
    titles = sorted({l.split(" › ", 2)[-1].strip(" ─") for l in run.stdout.splitlines()
                     if re.match(r"^\s+\[mobile-chromium\] › ", l)})
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
