"""Break shipping as its own step (orders task list, P1-3) one way at a
time: each must fail a journey or a server test. «ТТН ще немає — вписати»
only once sent, the cursor in the waybill's field, back to the row that
opened it; no carrier, no save; «Доставку збережено» on a card mounted
afresh after every step; the history a row a version by the phone's clock;
the same waybill's other order its row by its goods, several said so,
opened at its top; the server naming it by its first line and how many,
and never one its reader could not open, the list unchanged; and the
banner's two phrasings the owner changed after #136.

Each mutant runs its journeys against the isolated E2E API
(`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run, or its server
tests on the isolated test cluster. The unchanged tree runs first, with
everything any mutant names, and must pass; each mutant names what failed.
An optional argument runs only the mutants whose names contain one of its
parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
APP = "frontend/src/App.tsx"
CARD = "frontend/src/orders/Order.tsx"
SHIP = "frontend/src/orders/Shipping.tsx"
SERVICE = "backend/app/modules/orders/service.py"

SPEC = "e2e/orders-card.spec.ts"
REAL = "e2e/order-shipping.spec.ts"
CORRECTED = [REAL, "-g", "corrected while it is open"]
LATER = [REAL, "-g", "a waybill written after"]
UNCHANGED = [REAL, "-g", "saved as it was"]
ONE_WAYBILL = [REAL, "-g", "one waybill on two orders"]
SAME = [SPEC, "-g", "the same waybill's other orders"]
HISTORY = [SPEC, "-g", "where it went, a row a version"]
STUBBED = [SPEC, "-g", "a waybill written later on a stubbed parcel"]
KEPT = [SPEC, "-g", "names its step and its order"]
FITS = [SPEC, "-g", "an order to send fits the phone"]
REFUSED = [SPEC, "-g", "a save refused for its waybill"]
CARRIED = [SPEC, "-g", "a tap carried from «Змінити доставку»"]
BEFORE = ["e2e/outage.spec.ts", "-g", "spoiled on the phone"]
NAMED = ["backend:tests/integration/test_order_shipping.py"]
LISTED = ["backend:tests/integration/test_order_read_api.py"]

M = [
    ("«вписати» before it is sent", CARD,
     'order.status !== "READY_TO_DISPATCH";', "true;", CORRECTED),
    ("«вписати» never offered", CARD,
     '{writeLater ? "ТТН ще немає — вписати" : "Змінити доставку"}',
     '{false ? "ТТН ще немає — вписати" : "Змінити доставку"}', LATER),
    ("the cursor not in the waybill's field", SHIP,
     "if (writing) field.current?.focus();", "if (false) field.current?.focus();", LATER),
    ("back, the row not in focus", CARD,
     "      shippingRow.current?.focus();", "", LATER),
    ("saved with no carrier", SHIP,
     "disabled={blocked || noCarrier}", "disabled={blocked}", CORRECTED),
    ("the press never asks for a carrier", SHIP,
     '{noCarrier ? "Оберіть перевізника" : "Зберегти доставку"}', '{"Зберегти доставку"}',
     CORRECTED),
    ("the order not named over the press", SHIP,
     '<p className="pay-what">{title}</p>', '<p className="pay-what" />', STUBBED),
    ("saved, nothing said", CARD,
     'if (action === "shipping") return "Доставку збережено";', "", STUBBED),
    ("the card not afresh after a step", APP, ":${String(orderEpoch)}", "", UNCHANGED),
    ("the steps not counted", APP, "setOrderEpoch((epoch) => epoch + 1);", "", UNCHANGED),
    ("the other order by its id", CARD,
     '<span className="sale-goods">{sameTitle(other)}</span>',
     '<span className="sale-goods">{other.id.slice(0, 8)}</span>', ONE_WAYBILL + SAME),
    ("several said as one", CARD,
     "{order.same_waybill.length === 1", "{true", SAME),
    ("the other order's more lines not said", CARD,
     "const more = (other.lines ?? 1) - 1;", "const more = 0;", SAME),
    ("the other order not opened", CARD, "openOther(other.id);", "", ONE_WAYBILL),
    ("the other order opened where the page was", APP, "window.scrollTo(0, 0);", "", SAME),
    ("the history's month a month off", CARD,
     "${two(when.getMonth() + 1)}", "${two(when.getMonth())}", HISTORY),
    ("the history not saying how it went", CARD,
     '<span className="shipping-how">{shippingText(change)}</span>',
     '<span className="shipping-how" />', HISTORY),
    ("the banner's old «Операцію …» before a line kept", APP,
     ": `Операція «${visible(pending.label)}» — `}",
     ": `Операцію «${visible(pending.label)}» — `}", BEFORE),
    ("the banner's old «Двічі вона не запишеться»", APP,
     '"сервер не відповів. Двічі цю операцію не запишуть."',
     '"сервер не відповів. Двічі вона не запишеться."', KEPT),
    ("an order its reader could not open named", SERVICE,
     "~_unreadable(scope, order.store_id),", "", NAMED),
    ("the other order's last line named as its first", SERVICE,
     "first = min(items, key=lambda item: str(item.id), default=None)",
     "first = max(items, key=lambda item: str(item.id), default=None)", NAMED),
    ("its lines not counted", SERVICE, '"lines": len(items),', '"lines": 1,', NAMED),
    ("the list naming what it may not", SERVICE,
     "~_unreadable(scope, store_id),", "", LISTED),
    ("a private warehouse's order named to whoever holds the right network-wide", SERVICE,
     "if Permission.SALE_VIEW in scope.store_permissions.get(store_id, frozenset())",
     "if True", NAMED),
    # The review's (2026-10-25).
    ("a failed read again drops the card and what was typed", APP,
     "detail.data === undefined ? (", "detail.data === undefined || detail.error ? (", REFUSED),
    ("the card not kept under where it goes", CARD,
     "      <Card\n        {...props}\n        away={shipping !== null}",
     "      <Card\n        key={String(shipping !== null)}\n        {...props}\n"
     "        away={shipping !== null}", FITS),
    ("a tap carried onto «Зберегти доставку» taken", SHIP,
     "if (event.timeStamp - shownAt < CARRIED_TAP) return;", "", CARRIED),
    ("a tap carried onto «← До замовлень» taken", CARD,
     "if (event.timeStamp - backAt.current < CARRIED_TAP) return;", "", CARRIED),
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
