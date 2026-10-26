"""Break «Ще» by groups (navigation task list, P0-4) one way at a time: each
must fail a journey. «Ще» is a screen of its own, in the row only when it
holds something, marked on it and on its sections; its groups in order,
none empty, its rows named as their screens and held by their own rules;
«← Ще» over every section opened from it; the focus kept on «Ще»;
«Змінити магазин» at its bottom, held as the row is, in the header only
over a store that cannot be worked in; «Ще» and «← Ще» held while a first
send is in flight. With it, the two texts the owner changed after #142.

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
MORE = "frontend/src/shared/More.tsx"
CSS = "frontend/src/styles.css"
PRICE = "frontend/src/sales/PriceHint.tsx"
OPENINGS = "frontend/src/openings/Openings.tsx"

SECTIONS = "e2e/till-sections.spec.ts"
SELLER = [SECTIONS, "-g", "a seller's sections are the counter's four"]
OWNER = [SECTIONS, "-g", "the owner's row is the same four"]
MANAGER = [SECTIONS, "-g", "a manager's «Ще»"]
REDESIGN = "e2e/till-redesign.spec.ts"
VISIBLE = [REDESIGN, "-g", "only when it holds something"]
TWO_STORES = [REDESIGN, "-g", "two stores are chosen each time"]
PAUSED = [REDESIGN, "-g", "cannot be worked in, among two"]
HELD_SALE = ["e2e/till-receipt.spec.ts", "-g", "while a sale is being sent"]
HELD_STORE = ["e2e/stores.spec.ts", "-g", "the owner blocks a store; its seller sees only that"]
CASH = ["e2e/cash.spec.ts", "-g", "until they give the reason only «Каса» is open"]
PRICE_HINT = ["e2e/till-search.spec.ts", "-g", "a model with no price: its field takes the cursor"]
OPENING = ["e2e/openings.spec.ts", "-g", "a split the list does not state asks who counted"]

M = [
    ("«Ще» unmarked on its own screen", APP,
     "  const inMore = !counter.has(tab);",
     "  const inMore = !counter.has(tab) && tab !== \"more\";", SELLER),
    ("«Ще» shown when it holds nothing", APP,
     "  const hasMore = rest.length > 0 || changeStore !== undefined;",
     "  const hasMore = true;", VISIBLE),
    ("«Ще» hidden when it holds «Змінити магазин» alone", APP,
     "  const hasMore = rest.length > 0 || changeStore !== undefined;",
     "  const hasMore = rest.length > 0;", VISIBLE),
    ("«Ще» free while a sale is sent", APP,
     "              disabled={sending}\n", "              disabled={false}\n", HELD_SALE),
    ("«← Ще» free while a section's change is sent", MORE,
     "      disabled={back.held}\n", "      disabled={false}\n", HELD_STORE),
    ("an empty group shown", MORE,
     "  const shown = groups.filter((group) => group.rows.length > 0);",
     "  const shown = groups;", SELLER),
    ("no «Гроші»", APP,
     "    { title: \"Гроші\", tabs: [\"report\"] },\n", "", MANAGER),
    ("a row free while its section is held", APP,
     "          disabled: section.disabled,", "          disabled: false,", CASH),
    ("«Змінити магазин» free while the row is held", APP,
     "          changeHeld={blocked}\n", "          changeHeld={false}\n", CASH),
    ("«Змінити магазин» in the header inside a store", APP,
     "      <StoreLine store={store.name} person={me.display_name} />",
     "      <StoreLine\n        store={store.name}\n        person={me.display_name}\n        changeStore={changeStore}\n      />",
     TWO_STORES),
    ("no «Змінити магазин» in «Ще»", APP,
     "          groups={moreGroups}\n          changeStore={changeStore}\n",
     "          groups={moreGroups}\n          changeStore={undefined}\n", TWO_STORES),
    ("no «Змінити магазин» over a store that cannot be worked in", APP,
     "            person={me.data.display_name}\n            changeStore={changeStore}\n",
     "            person={me.data.display_name}\n            changeStore={undefined}\n", PAUSED),
    ("no «← Ще» over «Резервні копії»", APP,
     "          <Backups token={token} scopeKey={backupsKey} back={moreBack} />",
     "          <Backups token={token} scopeKey={backupsKey} />", OWNER),
    ("«← Ще» read as «Ще»", MORE,
     "      aria-label=\"Назад до «Ще»\"\n", "", SELLER),
    ("the focus lost after a row", APP,
     "            setTab(section.tab);\n            moreButton.current?.focus();\n",
     "            setTab(section.tab);\n", SELLER),
    ("the focus lost after «← Ще»", APP,
     "    setTab(\"more\");\n    moreButton.current?.focus();\n",
     "    setTab(\"more\");\n", SELLER),
    ("rows not the list's width", CSS,
     "nav:not(.sections, .more-list),\n", "nav:not(.sections),\n", OWNER),
    ("«Каталог» as before", APP,
     "      label: \"Перевірка каталогу\",", "      label: \"Каталог\",", SELLER),
    ("the price hint's old «Залишках»", PRICE,
     "менеджер у «Товарі».", "менеджер у «Залишках».", PRICE_HINT),
    ("«Початкові залишки»'s old «Приймання»", OPENINGS,
     "прийміть через «Товар» › «Прийшов товар».", "прийміть через «Приймання».", OPENING),
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
