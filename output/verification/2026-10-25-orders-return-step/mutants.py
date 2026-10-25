"""Break the goods coming back as their own step (orders task list, P2-4)
one way at a time: each must fail a journey. «Товар повернувся на склад ›»
opens its screen, its heading in focus; which warehouse each coat goes back
to, a line a warehouse, and unnamed when the warehouses are not read;
«Прийняти повернення» held until a reason and the tick; the card's own step
not under it; back, the row in focus; taken, a sentence a warehouse from
the warehouses the screen read, or unnamed; and «Каса»'s banner in the
order banner's words (the owner's answer after #137).

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
APP = "frontend/src/App.tsx"
CARD = "frontend/src/orders/Order.tsx"
BACK = "frontend/src/orders/Returned.tsx"
KEPT = "frontend/src/cash/Kept.tsx"

SPEC = "e2e/orders-card.spec.ts"
NAMED = [SPEC, "-g", "each warehouse they go back to named"]
UNNAMED = [SPEC, "-g", "whoever may not see the store's warehouses"]
REAL = ["e2e/orders.spec.ts", "-g", "goods come back as their own step"]
CASH = ["e2e/cash-kept.spec.ts"]
PAUSED = [SPEC, "-g", "neighbour's warehouse paused"]
NOT_RECEIVING = [SPEC, "-g", "neighbour's warehouse not receiving"]
TICK = [SPEC, "-g", "onto the tick is let go"]
REVOKED = [SPEC, "-g", "the right to see the warehouses gone"]

M = [
    ("the row opens nothing", CARD, "onClick={takeBack}", "onClick={() => undefined}", REAL),
    ("the heading not in focus", BACK, "    heading.current?.focus();\n", "", REAL),
    ("the warehouse not named", BACK, "Повернеться на склад «{visible(names.get(id) ?? \"\")}»:",
     "Повернеться на склад:", NAMED),
    ("the lines not by warehouse", BACK,
     "    places.set(item.source_location_id, [\n      ...(places.get(item.source_location_id)",
     "    places.set(\"\", [\n      ...(places.get(\"\")", NAMED),
    ("warehouses not read named anyway", BACK,
     "const named = lines.every(([id]) => taking.has(id));", "const named = true;", UNNAMED),
    ("taken without the tick", BACK,
     "disabled={blocked || !received || !reason.trim()}", "disabled={blocked || !reason.trim()}",
     UNNAMED),
    ("taken without a reason", BACK,
     "disabled={blocked || !received || !reason.trim()}", "disabled={blocked || !received}",
     UNNAMED),
    ("the card's step under the screen", CARD,
     "const panelStep = mayStep && open && away === null ? next : null;",
     "const panelStep = mayStep && open ? next : null;", NAMED),
    ("back, the return's row not in focus", CARD,
     "(opened.current === \"return\" ? returnRow : shippingRow).current?.focus();",
     "shippingRow.current?.focus();", UNNAMED),
    ("taken, nothing said", CARD,
     "  if (action === \"return\") return returnedText(order, places ?? []);\n", "", NAMED),
    ("the result not naming the warehouse", CARD,
     "`Повернено на склад «${visible(names.get(id) ?? \"\")}»: ${units(items)}`",
     "`Повернено на склад: ${units(items)}`", NAMED + REAL),
    ("the result's units the whole order's", CARD,
     "»: ${units(items)}`", "»: ${units(order.items)}`", NAMED),
    ("warehouses not read named in the result", CARD,
     "if (!lines.every(([id]) => names.has(id)))", "if (false)", UNNAMED),
    ("the result without the screen's warehouses", APP,
     "placesRead(cache, store.id)", "undefined", NAMED),
    # The review's (2026-10-25).
    ("a paused warehouse named", BACK,
     "place.is_active && place.can_receive", "place.can_receive", PAUSED),
    ("a warehouse not receiving named", BACK,
     "place.is_active && place.can_receive", "place.is_active", NOT_RECEIVING),
    ("a tap carried onto the tick taken", BACK,
     "if (event.timeStamp - shownAt < CARRIED_TAP) return;", "", TICK),
    ("names from a read refused", BACK,
     'places.status === "success" ? places.data : []', "places.data ?? []", REVOKED),
    ("the result named from a read refused", BACK,
     'return read?.status === "success" ? read.data : undefined;', "return read?.data;",
     REVOKED),
    ("«Каса»'s banner in its old words", KEPT,
     "Двічі цю операцію не\n        запишуть.", "Двічі вона не\n        запишеться.", CASH),
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
