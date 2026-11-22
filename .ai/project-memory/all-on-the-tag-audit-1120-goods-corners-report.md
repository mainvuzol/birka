# «Усе на бірці», audit 2026-11-20, batch 5: the goods' corners — «+ Нова пропозиція» as «+ Нове замовлення»; what tells a model apart named in both forks; the count's «Знайшли товар…» only for whoever may receive, and «уже є в обліку» saying nothing is recorded — 2026-11-22

Baseline: `be883f97` (main after #238).

Points: goods P2-2, P2-3 (а) and (б), P2-4 (а) and (б) with its Д1 — the
goods pass's last P2s that wait for no owner's answer (its §8, «Углы
товара»). goods P2-5 waits for В20-Т1.

Taken as the next after «merged go next».

No request, check, journal or right changes; no backend change. What is
recorded, chosen and sent, and the server's checks of it, are as before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1238 (1234 before).
- Branch: `feat/audit-1120-batch5`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-22 (audit
  2026-11-20, batch 5: …)".

## What exists now

- **«+ Нова пропозиція»** (goods P2-2):
  - Before: in «Перевірка каталогу»'s header a bordered quiet button, where
    «Нове замовлення», «Записати накладну» and «Повернути товар
    постачальнику» are said with their «+».
  - Now: the same `head-add` — the plus 20, its words in the link's colour
    on nothing, 44 high — beside the title or under it.
- **What tells a model apart, named** (goods P2-3):
  - (а) «Схожі» in «Нова модель»: «Відмінність моделі: довге» under the
    name, where «довге» stood alone.
  - (б) The rename fork in «Моделі»: «Лоран» bold, «Пальто · Пальто» under
    it, «Відмінність моделі: довге» under that — where one bold line said
    «Лоран — Пальто — Пальто — довге».
- **«Знайшли товар…» on a count only for whoever may receive** (goods P2-4
  (а)): as on the entry; without `inventory:receive` it led only to a
  refusal.
- **«уже є в обліку» says nothing is recorded** (goods P2-4 (б)): «…
  введіть кількість ще раз. Нічого не записано.», as the count's twin.

## How it was built and proven

Sources:
- `catalog/Catalog.tsx`: «Нова пропозиція» a `head-add` with the `plus`
  icon, the header `wraps`. `styles.css`: `.catalog-ways` gone; the
  `.head-add` comment names it.
- `catalog/NewModel.tsx`: «Відмінність моделі:» before a candidate's
  distinction.
- `catalog/FamilySearch.tsx`: `familyKind` — source, category, type through
  « · ». `catalog/Models.tsx`: the fork's row its name, `familyKind`, its
  distinction; «Це вона»'s `aria-label` the whole `familyLabel`, as before.
- `inventory/Stocktake.tsx`: «Знайшли товар…» drawn with `canReceive`; its
  screen goes with the right; the cursor back on it, else on the count's
  title; a found count sheet's fallback the title without the right.
- `inventory/Correction.tsx`: the «уже є в обліку» branch with its tail.

Decided here:
- a found goods' count sheet already open stays when the right goes: its
  count needs only `inventory:adjust`, which the person still has, and
  closing it would lose what was typed (review).

Journeys (+4):
- New:
  - `catalog` ×2 — «Нова пропозиція»'s look at 360 and 390 (`head-add`,
    the plus, no edge or fill, the link's colour, 44 high, beside or under
    the title, the title one line, nothing wider), and none on «Пропозиція»;
    «Схожі» with a model's distinction: «Відмінність моделі: довге» under
    its name, at most two lines at 360 in both themes, «Це вона» beside it,
    choosing it;
  - `models` — the rename fork: a full model's three lines and a bare one's
    name; heard by its whole label; in both themes «Це вона» beside them;
    chosen, the same family sent, `new_model: false`, `distinction_note:
    null`;
  - `stocktake` — without `inventory:receive` no «Знайшли товар…» on the
    entry nor on the count; with it, on both (the count stubbed, nothing in
    the shared warehouse).
- Extended:
  - `correct` — «уже є в обліку» from «Знайшли товар…» ends «Нічого не
    записано.».

Runs on a fresh seed:
- The 15 specs the change reaches (`design-system`, `stocktake` first; the
  catalogue's, «Моделі», receiving's, sizes', the corrections', stock,
  outside text, the till's first days, openings): 224/224.
- After the review's fix, its journey: 1/1.
- CI runs all 1238.

- mutate82, 11 mutants, each against its journey: 11/11 caught.
  - P2-2: the button quiet again, no plus, the header without `wraps`, shown
    on «Пропозиція»;
  - P2-3: «Схожі»'s distinction bare again; the fork one joined line, no
    kind line, no distinction line, the kind joined by dashes;
  - P2-4: «Знайшли товар…» on a count without the right; «уже є в обліку»
    without its tail.

Seen in the journeys' screenshots (360): «+ Нова пропозиція» under the
title, one line; «Схожі»'s «Відмінність моделі: …» under the name, two lines
at most, «Це вона» beside it, light and dark; the fork's three lines and a
bare model's name, «Це вона» beside each, light and dark.

## The review

An independent review read the diff against the three tasks, with the
catalogue's identity rules for the fork. `tsc` and ESLint are clean; the
journeys have no type error main has not.

Checked and found right:
- «Нова пропозиція»'s name for a reader unchanged, the icon unheard; when it
  shows, held and pressed as before; its disabled look the shared one;
  `wraps` harmless on «Пропозиція»; `.catalog-ways` nowhere else;
- every server string drawn through `visible()`; `familyKind` drops null
  and "" as `familyLabel` does; nothing of the label lost; `familyLabel`
  still read by «Це вона», «Модель: …» and «Інший колір нашої моделі»;
- what the fork chooses and sends untouched; its rows a column that wraps,
  «Це вона» kept at the right;
- «Знайшли товар…»'s screen never drawn without the right; the cursor's
  target in both cases; no other way to it;
- a kept correction passes "" and reads as before; the one journey on the
  old words updated;
- each new check fails on main's code; the route stubs reach only what they
  mean to.

Found and fixed:
- **Low:** the fork's journey checked the family and `new_model` sent, not
  `distinction_note: null`; it checks all three.

Known, kept:
- **Low:** a found goods' count sheet stays open when the right goes —
  decided above.
- **Low:** no journey takes the right away from an open count: the rights
  are read again only on the door's «Спробувати ще раз» and on a change in
  «Магазини», neither reached while a count stands. The guard's lines are
  read in code, as the entry's always were.

## Left

- goods P2-5 waits for В20-Т1 (the owner pack).
- Н3 (б): the server's filter of the collected and the cancelled (Backend).
- The set-off's return names its place as «склад «…»» where «Постачальникам»
  says «з «Браку» «…»» — for the next audit (batch 4's review).
- The owner pack's answers.
- Dependabot pull request #223 is redundant after #233. It is closed only on
  the user's word.
