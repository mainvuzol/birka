"""Break «Нове замовлення» as a sale (orders task list, P0-5) one way at a
time: each must fail a journey. The cursor in the search; a chip's line from
its own warehouse at the store's price, its field focused when there is
none; «−»/«+» to what is free, a chip tapped again one more; the price as
typed sent, no sum while one is missing; no press without a carrier, none
kept abroad; a shortfall's line marked with what is free — none free said so
— focused, the goods read again, the mark kept until that line changes, and
never said over the page or again once the screen is left; a buzz and
«Зарезервовано: N шт.» after it, also when it was confirmed later; the
carriers one row; the till's price words.

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
NEW = "frontend/src/orders/NewOrder.tsx"
WHERE = "frontend/src/orders/WhereTo.tsx"
CARD = "frontend/src/orders/Order.tsx"
HINT = "frontend/src/sales/PriceHint.tsx"
APP = "frontend/src/App.tsx"
CSS = "frontend/src/styles.css"

SPEC = "e2e/orders-new.spec.ts"
SALE = [SPEC, "-g", "a new order as a sale"]
TWO = [SPEC, "-g", "two warehouses"]
NO_PRICE = [SPEC, "-g", "a model with no price"]
ABROAD = [SPEC, "-g", "abroad: no carrier"]
SHORT = [SPEC, "-g", "short of stock: the line"]
NONE_FREE = [SPEC, "-g", "with none free"]
LEFT = [SPEC, "-g", "screen left"]
READ_LOST = [SPEC, "-g", "whose reading failed"]

M = [
    ("the cursor not in the search", NEW,
     "    searchRef.current.focus();\n", "", SALE),
    ("a line from another warehouse", NEW,
     "\n      source_location_id: item.location_id,\n      quantity: 1,",
     "\n      source_location_id: places ? ([...places.keys()][0] ?? item.location_id) : item.location_id,\n      quantity: 1,", TWO),
    ("a line sent at no price", NEW,
     "      unit_price: item.suggested_price ? asPrice(item.suggested_price) : \"\",",
     "      unit_price: \"\",", SALE),
    ("the field empty of the store's price", NEW,
     "        price: item.suggested_price ? asInput(item.suggested_price) : \"\",",
     "        price: \"\",", SALE),
    ("a price-less line's field not focused", NEW,
     "    if (!item.suggested_price) setFocusPrice(id);\n", "", NO_PRICE),
    ("more than is free", NEW,
     "  return Math.max(1, Math.min(d.available, 1000));", "  return 1000;", SALE),
    ("a chip tapped again adds nothing", NEW,
     "      if (held && held.line.quantity < most(held))", "      if (false)", SALE),
    ("the price typed not the price sent", NEW,
     "            unit_price: asPrice(price),", "            unit_price: d.line.unit_price,", NO_PRICE),
    ("a sum with a line unpriced", NEW,
     "            {priced ? (", "            {true ? (", NO_PRICE),
    ("no carrier asked", NEW,
     "  const noCarrier = destination === \"UKRAINE\" && carrier === \"\";",
     "  const noCarrier = false;", SALE),
    ("a short line unmarked", NEW,
     "className={index === shortIndex ? \"line short\" : \"line\"}", "className=\"line\"", SHORT),
    ("short said without the reserve", NEW,
     "    ? `Доступно лише ${String(short.available)} шт. — решта в резерві інших замовлень.`",
     "    ? `Доступно лише ${String(short.available)} шт.`", SHORT),
    ("none free said as some", NEW,
     "  if (short.available <= 0)", "  if (false)", NONE_FREE),
    ("the short line not brought to the finger", NEW,
     "    shortRef.current?.focus({ preventScroll: true });\n", "", SHORT),
    ("the goods not read again after a shortfall", NEW,
     "    void cache.invalidateQueries({\n      queryKey: [\"sale-stock\", journalKey, store.id],\n    });\n", "", SHORT),
    ("what is free not kept from the refusal", NEW,
     "          ? { ...d, available: Math.max(found.available, 0) }", "          ? d", SHORT),
    ("the mark kept after its line changed", NEW,
     "    if (index === shortIndex && edit.quantity !== undefined) setShort(null);\n", "", SHORT),
    ("the mark cleared by another line", NEW,
     "    if (index === shortIndex && edit.quantity !== undefined) setShort(null);",
     "    setShort(null);", SHORT),
    ("the panel's room not kept", NEW,
     "  usePanelRoom(panelRef, draft.length > 0);", "  usePanelRoom(panelRef, false);", SALE),
    ("abroad keeps the carrier", WHERE,
     "                change(option, option === \"UKRAINE\" ? carrier : \"\");",
     "                change(option, carrier);", ABROAD),
    ("carriers abroad", WHERE,
     "      {destination === \"UKRAINE\" && (", "      {true && (", ABROAD),
    ("a carrier chip not said pressed", WHERE,
     "              aria-pressed={carrier === key}", "              aria-pressed={false}", SALE),
    ("a new order reserved in silence", APP,
     "      command.path === \"/orders\"\n        ? \"reserve\"\n        : command.orderId",
     "      command.path === \"\"\n        ? \"reserve\"\n        : command.orderId", SALE),
    ("an answered kept order not said", APP,
     "      command.path === \"/orders\"\n        ? \"reserve\"\n        : command.orderId\n          ? (command.path.split(\"/\").at(-1) ?? \"\")\n          : \"\";",
     "      command.orderId\n        ? (command.path.split(\"/\").at(-1) ?? \"\")\n        : command.path === \"/orders\"\n          ? \"reserve\"\n          : \"\";", READ_LOST),
    ("a refused new order without a buzz", APP,
     "      buzz(\"error\");\n      setStepRefused((count) => count + 1);",
     "      setStepRefused((count) => count + 1);", SHORT),
    ("a shortfall said over the page too", APP,
     "        !(error === newRefused && shortOf(error) !== null) && (", "        true && (", SHORT),
    ("a shortfall said again once the screen is left", APP,
     "      useCommand.setState({ error: null });\n", "", LEFT),
    ("the card left at the form's foot", CARD,
     "    if (done !== null) heading.current?.scrollIntoView({ block: \"nearest\" });\n", "", SALE),
    ("reserved said without its units", CARD,
     "${String(order.items.reduce((n, item) => n + item.quantity, 0))} шт. Чекає",
     "1 шт. Чекає", SHORT),
    ("0,00 not asked about", HINT,
     "      {price === \"0.00\" && (", "      {false && (", NO_PRICE),
    ("what is no price unsaid", HINT,
     "      {price === \"\" && (typed.trim() || suggested) ? (", "      {false ? (", NO_PRICE),
    ("the carriers in two rows", CSS,
     "  padding: 8px;\n  white-space: nowrap;", "  padding: 8px 14px;\n  white-space: nowrap;", SALE),
    ("a chip tapped again adds two", NEW,
     "      if (held && held.line.quantity < most(held))\n        change(at, { quantity: held.line.quantity + 1 });",
     "      if (held && held.line.quantity < most(held))\n        change(at, { quantity: held.line.quantity + 2 });", SALE),
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
