"""Undo one wrap at a time on the screens the journey walks: each must fail it."""
import os
import subprocess
from pathlib import Path

FRONT = Path("/Users/nikitahlushak/birka/frontend")
R = Path.home() / ".cache/birka-runtime"
ENV = {**os.environ, "BIRKA_E2E_FIXTURE": str(R / "e2e-fixture.json"), "BIRKA_E2E_PYTHON": str(R / "python/bin/python"),
       "BIRKA_DATABASE_URL": "postgresql+asyncpg://birka_review@127.0.0.1:55442/birka_orders_ui",
       "PLAYWRIGHT_BROWSERS_PATH": str(R / "browsers")}
M = [
    ("header: the seller's own name", "src/App.tsx", "<span>{visible(me.data.display_name)}</span>", "<span>{me.data.display_name}</span>"),
    ("till: the model in the list", "src/sales/Sale.tsx", "{visible(item.display_name)} ·{\" \"}", "{item.display_name} ·{\" \"}"),
    ("«Залишки»: the label read aloud", "src/inventory/Stock.tsx", "aria-label={`${visible(item.display_name)} ·", "aria-label={`${item.display_name} ·"),
    ("«Моделі»: a found model", "src/catalog/Models.tsx", "                  {visible(item.display_name)}\n                  {item.status", "                  {item.display_name}\n                  {item.status"),
    ("«Борги»: the customer", "src/credits/Credits.tsx", "                {visible(customer.customer_name ?? erasedCustomer)}", "                {customer.customer_name ?? erasedCustomer}"),
    ("«Борги»: who took the payment", "src/credits/Credits.tsx", "{entryWay(entry)} · {visible(entry.by)}", "{entryWay(entry)} · {entry.by}"),
    ("«Борги»: the reason", "src/credits/Credits.tsx", "{entry.note && ` · ${visible(entry.note)}`}", "{entry.note && ` · ${entry.note}`}"),
    ("«Звіт»: the model", "src/reports/SalesReport.tsx", "<strong>{visible(model.display_name)}</strong>", "<strong>{model.display_name}</strong>"),
    ("«Повернення»: the model", "src/returns/Returns.tsx", "{visible(item.display_name)}, {sizeLabel(item.size)}", "{item.display_name}, {sizeLabel(item.size)}"),
    ("«Каса»: the goods", "src/cash/Cash.tsx", "{visible(event.label)} · {money(event.amount)}", "{event.label} · {money(event.amount)}"),
    ("«Накладні»: the supplier", "src/suppliers/Invoices.tsx", "<strong>{visible(invoice.supplier.name)}</strong>", "<strong>{invoice.supplier.name}</strong>"),
    ("«Постачальникам»: the edit button", "src/suppliers/Suppliers.tsx", "Змінити {visible(supplier.name)}", "Змінити {supplier.name}"),
]
caught = 0
for name, rel, old, new in M:
    path = FRONT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) == 0:
        print(f"- {name}: NOT APPLIED"); continue
    path.write_text(text.replace(old, new))
    try:
        run = subprocess.run(["./node_modules/.bin/playwright", "test", "e2e/outside-text.spec.ts", "--reporter=line"],
                             cwd=FRONT, env=ENV, capture_output=True, text=True, timeout=600)
    finally:
        path.write_bytes(original)
    ok = run.returncode != 0
    caught += ok
    why = next((l.strip() for l in run.stdout.splitlines() if "shown as itself" in l or "Locator:" in l), "")
    print(f"- {name}: {'caught' if ok else 'SURVIVED'} {why[:150]}")
print(f"{caught} of {len(M)} caught")
