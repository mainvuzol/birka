"""Break the per-person limit one way at a time: each must fail its tests."""
import os
import re
import subprocess
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
R = Path.home() / ".cache/birka-runtime"
PY = R / "python/bin/python"
E2E = {**os.environ, "BIRKA_E2E_FIXTURE": str(R / "e2e-fixture.json"), "BIRKA_E2E_PYTHON": str(PY),
       "BIRKA_DATABASE_URL": "postgresql+asyncpg://birka_review@127.0.0.1:55442/birka_orders_ui",
       "PLAYWRIGHT_BROWSERS_PATH": str(R / "browsers")}

BACKEND = ["backend", [str(PY), "-m", "pytest", "-q", "-p", "no:cacheprovider", "-x", "tests/unit/test_person_limit.py"], None]
FRONTEND = ["frontend", ["./node_modules/.bin/playwright", "test", "e2e/person-limit.spec.ts", "--reporter=line"], E2E]

M = [
    ("server: no limit on signed-in requests", BACKEND, "backend/app/api/deps.py",
     "    limit_person(request, claims.user_id, claims.session_epoch)\n", ""),
    ("server: the limit after the database is asked", BACKEND, "backend/app/api/deps.py",
     "    limit_person(request, claims.user_id, claims.session_epoch)\n    # Deactivating", "    # Deactivating"),
    ("server: counted per sign-in, not per person", BACKEND, "backend/app/api/deps.py",
     "limit_person(request, claims.user_id, claims.session_epoch)", "limit_person(request, claims.session_id, claims.session_epoch)"),
    ("server: one bucket whatever the sign-outs", BACKEND, "backend/app/core/rate_limit.py",
     'f"{person}:{session_epoch}"', "str(person)"),
    ("server: the rest of a minute's refusals never written out", BACKEND, "backend/app/core/rate_limit.py",
     "    now = _clock()\n    _write_out(notes, now)\n", "    now = _clock()\n"),
    ("server: approving a list not counted as heavy", BACKEND, "backend/app/api/v1/snapshots.py",
     "    payload: ApprovalRequest,\n    scope: HeavyScopeDep,", "    payload: ApprovalRequest,\n    scope: ScopeDep,"),
    ("server: rejecting a list counted as heavy", BACKEND, "backend/app/api/v1/snapshots.py",
     "async def reject_list(\n    snapshot_id: uuid.UUID,\n    payload: RejectionRequest,\n    scope: ScopeDep,",
     "async def reject_list(\n    snapshot_id: uuid.UUID,\n    payload: RejectionRequest,\n    scope: HeavyScopeDep,"),
    ("server: heavy work in the general bucket", BACKEND, "backend/app/core/rate_limit.py",
     '_refuse_person(request, _heavy_bucket(request), "heavy",', '_refuse_person(request, _person_bucket(request), "heavy",'),
    ("server: refused as a sign-in", BACKEND, "backend/app/core/errors.py",
     '    code = "TOO_MANY_REQUESTS"\n', '    code = "RATE_LIMITED"\n'),
    ("server: the wait rounded down", BACKEND, "backend/app/core/rate_limit.py",
     "    retry_after = max(1, math.ceil(wait))\n    count, logged_at", "    retry_after = int(wait)\n    count, logged_at"),
    ("server: no Retry-After header", BACKEND, "backend/app/core/errors.py",
     '        super().__init__(None, retry_after=retry_after)\n        self.headers = {"Retry-After": str(retry_after)}\n',
     '        super().__init__(None, retry_after=retry_after)\n'),
    ("server: every refusal also logged as a domain error", BACKEND, "backend/app/core/errors.py",
     "    quiet = True\n", ""),
    ("server: every refusal logged", BACKEND, "backend/app/core/rate_limit.py",
     "    if now - logged_at >= REFUSALS_LOGGED_EVERY_SECONDS:", "    if True:"),
    ("server: other numbers than measured", BACKEND, "backend/app/core/config.py",
     "    requests_per_minute_per_person: int = Field(default=300, gt=0)", "    requests_per_minute_per_person: int = Field(default=600, gt=0)"),
    ("phone: a refused new sale kept as unknown", FRONTEND, "frontend/src/shared/api.ts",
     '      (error.status === 429 && error.code === "TOO_MANY_REQUESTS"))', "      false)"),
    ("phone: a kept sale cleared by the refusal", FRONTEND, "frontend/src/sales/commands.ts",
     "(!previouslyAmbiguous || recordedNothing(error)) &&", "(!previouslyAmbiguous || recordedNothing(error) || refusedOutright(error)) &&"),
    ("phone: the text says «нічого не записано»", FRONTEND, "frontend/src/shared/api.ts",
     "с і повторіть.`", "с і повторіть — нічого не записано.`"),
    ("phone: the wait not said", FRONTEND, "frontend/src/shared/api.ts",
     "    return Number.isInteger(seconds) && seconds > 0", "    return false"),
    ("phone: a refused correction's count cleared", FRONTEND, "frontend/src/inventory/Correction.tsx",
     '      if (outcome.error.code !== "TOO_MANY_REQUESTS") setCount("");', '      setCount("");'),
    ("phone: the general refusal text", FRONTEND, "frontend/src/shared/api.ts",
     '  if (error.code === "TOO_MANY_REQUESTS") {', '  if (error.code === "TOO_MANY_REQUESTS_NOT") {'),
]

caught = 0
for name, (where, cmd, env), rel, old, new in M:
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) != 1:
        print(f"- {name}: NOT APPLIED ({text.count(old)} matches)")
        continue
    path.write_text(text.replace(old, new))
    try:
        run = subprocess.run(cmd, cwd=ROOT / where, env=env, capture_output=True, text=True, timeout=600)
    finally:
        path.write_bytes(original)
    ok = run.returncode != 0
    caught += ok
    lines = run.stdout.splitlines()
    # Playwright's summary: "  N failed", then one indented line per failed journey.
    start = next((i for i, l in enumerate(lines) if re.fullmatch(r"\s+\d+ failed", l)), len(lines))
    failed = []
    for l in lines[start + 1:]:
        if not l.startswith("    [") or "›" not in l:
            break
        failed.append("«" + l.strip().split("› ")[-1][:60] + "…»")
    why = next((l.strip() for l in lines if l.startswith("FAILED")), "") or "; ".join(failed)
    print(f"- {name}: {'caught' if ok else 'SURVIVED'} {why[:200]}")
print(f"{caught} of {len(M)} caught")
