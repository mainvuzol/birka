"""Break the owner's two answers after #104 one way at a time: each must
fail a test or a journey. A return resent by whoever took it, once they may
no longer take returns, is answered what it recorded, or refused as having
recorded nothing, a first sending still running waited for; anyone else is
refused as before; and a kept return still unconfirmed, refused as a request
not taken, says its own words.

A mutant in the server runs its tests against the isolated test cluster
(`unit-env.sh`); one in the screens runs its journeys against the isolated
E2E API (`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run. The
unchanged tree runs first, with everything any mutant names, and must pass;
each mutant names what failed. An optional argument runs only the mutants
whose names contain one of its parts, separated by "|".
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
H = Path.home() / ".cache/birka-runtime/helpers"
PYTHON = Path.home() / ".cache/birka-runtime/python/bin/python"
ROUTE = "backend/app/api/v1/refunds.py"
SERVICE = "backend/app/modules/refunds/service.py"
ERRORS = "frontend/src/cash/errors.ts"

COMMAND = ["backend:tests/integration/test_refund_command.py"]
BACK = [*COMMAND, "backend:tests/integration/test_returns_elsewhere.py",
        "backend:tests/integration/test_outage_mark_returns_payments.py"]
OUTAGE = ["e2e/outage.spec.ts", "-g", "kept return"]

M = [
    ("the right asked before the lookup again", ROUTE,
     "    if not scope.can(Permission.SALE_REFUND, store_id):\n",
     "    scope.require(Permission.SALE_REFUND, store_id)\n    if False:\n", BACK),
    ("anyone's return answered without the right", SERVICE,
     "    if existing is None or existing.actor_user_id != scope.user_id:\n",
     "    if existing is None:\n", COMMAND),
    ("nothing recorded, not said", SERVICE,
     '            refusal.details["recorded"] = False\n', "            pass\n", BACK),
    ("someone else's said to have recorded nothing", SERVICE,
     "        if existing is None:\n            # Under the command's lock, and no refund under it: proven to\n",
     "        if True:\n            # Under the command's lock, and no refund under it: proven to\n", COMMAND),
    ("another request answered as recorded", SERVICE,
     "    _same_request(\n        existing,\n        _fingerprint(\n",
     "    (lambda *_, **__: None)(\n        existing,\n        _fingerprint(\n", COMMAND),
    ("the paper's mark left out of the identity", SERVICE,
     "            outage=outage,\n        ),\n        command_id=command_id,\n",
     "            outage=None,\n        ),\n        command_id=command_id,\n",
     ["backend:tests/integration/test_outage_mark_returns_payments.py"]),
    ("the lines not normalized as a new return's are", SERVICE,
     "    lines, reason = _normalize(lines, reason)\n    preview = {\n        item.id: item\n        for item in (\n            await session.scalars(select(SaleItem).where(SaleItem.sale_id == sale.id))\n        ).all()\n    }\n    elsewhere = await _elsewhere(\n        session, organization_id=scope.organization_id, sale=sale, taking=taking\n    )\n    damaged",
     "    preview = {\n        item.id: item\n        for item in (\n            await session.scalars(select(SaleItem).where(SaleItem.sale_id == sale.id))\n        ).all()\n    }\n    elsewhere = await _elsewhere(\n        session, organization_id=scope.organization_id, sale=sale, taking=taking\n    )\n    damaged",
     BACK),
    ("a first sending still running not waited for", ROUTE,
     "        outcome = await idempotency.claim(\n            session,\n            organization_id=scope.organization_id,\n            endpoint=REFUNDS_ENDPOINT,\n            key=idempotency_key,\n            request_fingerprint=request_fingerprint,\n        )\n        if isinstance(outcome, idempotency.Replay):\n            response.status_code = outcome.http_status\n            return RefundResponse.model_validate(outcome.response)\n        return _answer(\n",
     "        return _answer(\n", COMMAND),
    ("the key kept for an answer without the right", ROUTE,
     "        return _answer(\n            await own_refund(\n",
     "        await session.commit()\n        return _answer(\n            await own_refund(\n", COMMAND),
    ("a request not taken in the shared words", ERRORS,
     "    if (text === INVALID_TEXT)\n", "    if (text === CONFLICT_TEXT + INVALID_TEXT)\n", OUTAGE),
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
