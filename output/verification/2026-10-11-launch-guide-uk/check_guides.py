"""Check the Ukrainian launch instructions against what they translate and name.

1. Every command in server-setup-uk.md's code blocks — each line, with its
   trailing comment and placeholders left out — is in the English server or
   backup runbook, as written there.
2. Every relative link in both pages points at a file that exists.
3. Every «…» the managers' guide quotes is a word the app's screens use: it
   appears in frontend/src (a quote naming a screen or a section counts if
   any source file holds it).

Exit 1, naming each miss, if anything fails.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/Users/nikitahlushak/birka")
MEMORY = ROOT / ".ai/project-memory"
UK = MEMORY / "server-setup-uk.md"
GUIDE = MEMORY / "managers-stock-uk.md"
ENGLISH = (MEMORY / "server-runbook.md").read_text() + (MEMORY / "backup-restore-runbook.md").read_text()

misses: list[str] = []


def normal(line: str) -> str:
    line = line.split("  #")[0].rstrip()
    line = re.sub(r"<[^>]+>", "<>", line)  # placeholders differ by language
    return " ".join(line.split())


english_lines = {normal(l) for l in ENGLISH.splitlines()}
commands = 0
for block in re.findall(r"```[a-z]*\n(.*?)```", UK.read_text(), flags=re.S):
    for line in block.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        commands += 1
        if normal(line) not in english_lines:
            misses.append(f"command not in the English runbooks: {stripped}")

for page in (UK, GUIDE):
    for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", page.read_text()):
        if target.startswith("http"):
            continue
        if not (page.parent / target).resolve().exists():
            misses.append(f"{page.name}: link to a missing file: {target}")

source = "\n".join(p.read_text() for p in (ROOT / "frontend/src").rglob("*.ts*"))
quotes = 0
for quote in re.findall(r"«([^«»]+)»", GUIDE.read_text()):
    quotes += 1
    quote = " ".join(quote.split())  # a quote may break across lines
    probe = quote.split("…")[0].split("«")[0].rstrip(" .")
    if probe and probe not in source:
        misses.append(f"managers' guide quotes a word no screen uses: «{quote}»")

print(f"{commands} command lines, {quotes} quoted words checked")
for miss in misses:
    print("MISS", miss)
print("OK" if not misses else f"{len(misses)} misses")
sys.exit(1 if misses else 0)
