"""Break an order's refusals in its own words (orders task list, P1-2) one
way at a time: each must fail a journey. A step another phone made
impossible said by the order's status, «картку оновлено» only from its
screen, the card and its row read again; a closed order's shipping; a
waybill's own fault, its letters Latin, its field's check only live; the
owner's conflict words live, a resend's «поки сервер не відповідав»; a
saved step resent and refused, which and why; a kept conflict never
«спробуйте ще раз»; a recorded step never «Не записано».

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
ERRORS = "frontend/src/cash/errors.ts"
APP = "frontend/src/App.tsx"

CARD = "e2e/orders-card.spec.ts"
MOVED = [CARD, "-g", "another phone already made"]
CLOSED = [CARD, "-g", "where a closed order goes"]
CLOSED_KEPT = [CARD, "-g", "resent after the order closed"]
WAYBILL = [CARD, "-g", "a waybill of no digit"]
RESENT = [CARD, "-g", "refused on its check for"]
KEPT_CONFLICT = [CARD, "-g", "met by a conflict on its check"]
LIVE_CONFLICT = [CARD, "-g", "refused, a buzz of its own"]
OUTAGE = ["e2e/outage.spec.ts", "-g", "a kept order step refused on resend"]
REAL = ["e2e/orders.spec.ts", "-g", "another phone already made impossible"]
REJECTED = ["e2e/orders.spec.ts", "-g", "first definitive rejection"]

M = [
    ("the status not said by its pill", ERRORS,
     "    return `замовлення вже «${statusLabels[status as Status]}»${live ? \" — картку оновлено\" : \"\"}.`;",
     "    return `замовлення вже «${status}»${live ? \" — картку оновлено\" : \"\"}.`;", MOVED),
    ("«картку оновлено» on a resend too", ERRORS,
     "${live ? \" — картку оновлено\" : \"\"}", "${\" — картку оновлено\"}", OUTAGE),
    ("a transition in the shared words", ERRORS,
     "    Object.hasOwn(statusLabels, status)\n", "    false\n", REAL),
    ("a closed order in the shared words", ERRORS,
     "  if (reason === \"ORDER_CLOSED\")\n    return \"замовлення вже закрито, доставку більше не змінюють.\";\n", "", CLOSED),
    ("a waybill's fault in the shared words", ERRORS,
     "  if (reason === \"WAYBILL\")\n", "  if (false)\n", WAYBILL),
    ("any letter said to do for a waybill", ERRORS,
     "    return `номер ТТН має містити цифри або латинські літери.${live ? \" Перевірте його.\" : \"\"}`;",
     "    return `номер ТТН має містити цифри чи літери.${live ? \" Перевірте його.\" : \"\"}`;", WAYBILL),
    ("a resend told to check a field it no longer has", ERRORS,
     "літери.${live ? \" Перевірте його.\" : \"\"}`;", "літери. Перевірте його.`;", RESENT),
    ("a resend's conflict said as met at work", ERRORS,
     "поки ${live ? \"ви працювали\" : \"сервер не відповідав\"}.", "поки ви працювали.", RESENT),
    ("a conflict in the shared words", ERRORS,
     "  if (errorText(error) === CONFLICT_TEXT)\n    return `дані замовлення змінилися,", "  if (false)\n    return `дані замовлення змінилися,", REJECTED),
    ("a resend refused in the shared words", ERRORS,
     "    return why === null\n      ? `Операцію «${resent}» не записано. ${errorText(error)}`\n      : `Операцію «${resent}» не записано: ${why}`;",
     "    return `Операцію «${resent}» не записано. ${errorText(error)}`;", OUTAGE),
    ("a kept conflict told to try again", ERRORS,
     "      return `${what} ще не підтверджено: сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі вона не запишеться.`;\n",
     "      return orderReason(error, true) ?? \"\";\n", KEPT_CONFLICT),
    ("a waybill's fault said as not recorded", ERRORS,
     "      ? why.charAt(0).toUpperCase() + why.slice(1)\n      : `Не записано: ${why}`;", "      ? `Не записано: ${why}`\n      : `Не записано: ${why}`;", WAYBILL),
    ("its row not read again after a refusal", APP,
     "        // Its row too: back on the list, it is where it is now (orders\n        // task list, P1-2).\n        void cache.invalidateQueries({\n          queryKey: [\"orders\", store.id],\n          refetchType: \"all\",\n        });\n", "", MOVED),
    ("the card not read again after a refusal", APP,
     "        void cache.invalidateQueries({\n          queryKey: [\"order\", store.id, command.orderId],\n        });\n        // Its row too", "        // Its row too", MOVED),
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
