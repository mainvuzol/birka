"""Break the Ukrainian pages one way at a time: the checker must fail each."""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/nikitahlushak/birka")
UK = ".ai/project-memory/server-setup-uk.md"
GUIDE = ".ai/project-memory/managers-stock-uk.md"
CHECK = ["python3", "output/verification/2026-10-11-launch-guide-uk/check_guides.py", str(ROOT)]

M = [
    ("a migration command drifts", UK, "ops alembic upgrade head\n", "ops alembic upgrade heads\n"),
    ("the crontab line's hour drifts", UK, "15 3 * * * cd /srv/birka/infra", "15 4 * * * cd /srv/birka/infra"),
    ("the backup directory's owner drifts", UK, "sudo chown 10001 backups", "sudo chown 1000 backups"),
    ("the app role's command loses --no-deps", UK, "--profile ops run --rm --no-deps ops python -m scripts.app_role   #",
     "--profile ops run --rm ops python -m scripts.app_role   #"),
    ("a link points nowhere", UK, "[звіті про людей](people-report.md)", "[звіті про людей](people.md)"),
    ("the managers' guide names a button no screen has", GUIDE, "«Записати коригування»", "«Записати виправлення»"),
    ("the managers' guide names a stocktake button wrongly", GUIDE, "«Записати кількість»", "«Зберегти кількість»"),
    ("the managers' guide links nowhere", GUIDE, "(paper-when-the-server-is-down.md)", "(paper.md)"),
]
caught = 0
for name, rel, old, new in M:
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if text.count(old) < 1:
        print(f"- {name}: NOT APPLIED")
        continue
    path.write_text(text.replace(old, new, 1))
    try:
        run = subprocess.run(CHECK, cwd=ROOT, capture_output=True, text=True)
    finally:
        path.write_bytes(original)
    ok = run.returncode != 0
    caught += ok
    why = next((l for l in run.stdout.splitlines() if l.startswith("MISS")), "")
    print(f"- {name}: {'caught' if ok else 'SURVIVED'} {why[:150]}")
print(f"{caught} of {len(M)} caught")
sys.exit(0 if caught == len(M) else 1)
