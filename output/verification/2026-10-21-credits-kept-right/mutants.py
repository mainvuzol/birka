"""Break the owner's four answers after #117 and #118 one way at a time: each
must fail a journey or a test. The server answers a payment or a write-off
resent by whoever may no longer make it what their own command recorded,
or that nothing was; never anyone else's, nor another request under the
same command; a store that does not trade, or one this person no longer
belongs to, is refused as before. The phone says «Борги»'s words for the
right — a write-off's naming the owner — and after a payment proven
unrecorded the paper's line; the answer is their own entry alone, no phone,
looked up under the debt's lock, which a first sending holds; «not found»
and a request not taken count towards a manager in one row, a payment's
422 among them; «Магазину винні» that cannot be read keeps its place, and is
read again.

Each mutant runs its journeys against the isolated E2E API
(`e2e-fresh.sh`, `e2e-run.sh`), reseeded before every run, or its backend
test on the isolated test cluster. The unchanged tree runs first, with
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
SERVICE = "backend/app/modules/credit/service.py"
ERRORS = "frontend/src/cash/errors.ts"
JOURNAL = "frontend/src/shared/journal.ts"
CREDITS = "frontend/src/credits/Credits.tsx"
CSS = "frontend/src/styles.css"

PAYMENT = ["backend:tests/integration/test_customer_credit.py::test_a_payment_resent_by_whoever_may_no_longer_take_payments_is_answered_what_it_recorded"]
WRITE_OFF = ["backend:tests/integration/test_customer_credit.py::test_a_write_off_resent_by_whoever_may_no_longer_write_off_is_answered_what_it_recorded"]
WAIT = ["backend:tests/integration/test_customer_credit.py::test_a_payment_resent_without_the_right_waits_for_a_first_sending_still_running"]
BLOCKED = ["backend:tests/integration/test_refusals_record_nothing.py::test_every_command_resent_after_its_store_was_blocked_claims_nothing"]
RIGHT = ["e2e/outage.spec.ts", "-g", "may no longer open «Борги», answered"]
MANAGER = ["e2e/outage.spec.ts", "-g", "three times in a row that the server did not take"]
SUMMARY = ["e2e/credits-list.spec.ts", "-g", "«Магазину винні» that cannot be read"]

M = [
    ("a payment of whoever lost the right taken as new", SERVICE,
     "    if not scope.can(Permission.SALE_CREDIT, taking):", "    if False:", PAYMENT),
    ("nothing recorded not said", SERVICE,
     '        refusal.details.setdefault("recorded", False)\n', "", PAYMENT),
    ("another request under the same command answered", SERVICE,
     "        entry.command_fingerprint != fingerprint\n        or ", "        ", PAYMENT),
    ("the customer's phone answered to whoever may no longer read debts", SERVICE,
     "        customer_phone=None,\n", "", PAYMENT),
    ("a colleague's entry answered with their own", SERVICE,
     "        entries=[own for own in whole.entries if own.id == entry.id],\n", "", PAYMENT),
    ("the debt's row never locked, a resend not waiting", SERVICE,
     "        .with_for_update()\n    )\n    if credit is None:\n        raise NotFoundError(\"Unknown debt\"",
     "    )\n    if credit is None:\n        raise NotFoundError(\"Unknown debt\"", WAIT),
    ("a write-off of whoever lost the right taken as new", SERVICE,
     "        if not scope.can(Permission.CREDIT_WRITE_OFF, credit.store_id):", "        if False:", WRITE_OFF),
    ("a closed store's write-off by its own people not refused first", SERVICE,
     "        scope.require(Permission.CREDIT_WRITE_OFF)\n", "        pass\n", BLOCKED),
    ("a store not trading looked up for its payment", SERVICE,
     "    scope.require_store(taking)\n", "", BLOCKED),
    ("the right's words never said", ERRORS,
     '    error.code === "PERMISSION_DENIED"', '    error.code === "NO_SUCH_CODE"', RIGHT),
    ("a write-off's right sent to a manager, not the owner", ERRORS,
     '"у вас більше немає права списувати борги. Зверніться до власника."',
     '"у вас більше немає права списувати борги. Зверніться до менеджера."', RIGHT),
    ("the paper's line missing after a payment unrecorded", ERRORS,
     '        ? " Якщо гроші вже взяли — передайте папір менеджеру, щоб внести внесок з паперу."',
     '        ? ""', RIGHT),
    ("a request not taken never counted", JOURNAL,
     "  return error.status === 404 || error.status === 400 || error.status === 422;",
     "  return error.status === 404;", MANAGER),
    ("a 422 never counted", JOURNAL,
     "  return error.status === 404 || error.status === 400 || error.status === 422;",
     "  return error.status === 404 || error.status === 400;", MANAGER),
    ("a payment's 422 in its old words, without a manager", ERRORS,
     "    // third in a row (owner decision, 2026-10-21).\n    return (",
     "    // third in a row (owner decision, 2026-10-21).\n    if (text === INVALID_TEXT)\n      return `${what} ще не підтверджено: сервер не прийняв запит. ${twice}`;\n    return (",
     MANAGER),
    ("«Магазину винні» gone when it cannot be read", CREDITS,
     "(summary.isPending || summary.isError) && (", "summary.isPending && (", SUMMARY),
    ("what is said gone while it is read again", CREDITS,
     "  const unread = summary.data === undefined && summary.errorUpdateCount > 0;",
     "  const unread = summary.isError;", SUMMARY),
    ("«Спробувати ще раз» open while it reads", CREDITS,
     "                    disabled={summary.isFetching}\n", "", SUMMARY),
    ("«Спробувати ще раз» under the thumb's size", CSS,
     ".owed-retry button {\n  min-height: 44px;", ".owed-retry button {\n  min-height: 0;", SUMMARY),
    ("«Магазину винні» never read again", CREDITS,
     "                      void summary.refetch();\n", "", SUMMARY),
    ("what is said over the lines moving the field", CSS,
     ".owed-retry {\n  position: absolute;", ".owed-retry {\n  position: static;", SUMMARY),
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
