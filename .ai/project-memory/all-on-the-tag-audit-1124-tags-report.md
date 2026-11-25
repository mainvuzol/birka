# «Усе на бірці», audit 2026-11-24, batch 1: «Корінець каже, що і де» — a proposal's outcome said by the server's answer; the new model's stub gone once its delivery is received; a correction's stub names its warehouse — 2026-11-25

Baseline: `bfcedcbf` (main after #247).

Points: goods P1-1 (catalogue identity: words only), goods P2-1, goods
P2-2. The user's pick after audit 2026-11-24: «Both, goods first» — this
is the first batch; «В руці — те, що на екрані» (frame P2-1, money P2-1,
sale P2-1) follows.

No right, check, journal, command or step changes; nothing recorded or
sent changes; no server change, no migration.

Status: built; the touched specs pass locally, the mutants are killed.
Not committed; not yet seen on a real phone.
- Journeys: 1274 (three new, seven extended).
- Branch: `feat/audit-1124-tags` (carries audit 2026-11-24's ten
  documents).
- Decisions: business-rules.md, "Chosen in chat — 2026-11-25 (audit
  2026-11-24, batch 1: «Корінець каже, що і де» …)".

## What exists now

- **«Пропозиція» says what a command came to** (goods P1-1): by the
  status the server read after it — decided, `decidedText` as the sheet
  says it («Модель обрано: Лоран шоколад 70 см.»); rejected, «Пропозицію
  відхилено.» (a cancelled creation too); open, «Пропозицію збережено.».
  «Рішення збережено.» is gone. A confirmed proposal shows «Обраний
  товар: …» in view, its fold shut; none of its candidates named, no line
  and «Модель обрано.» alone (Д1).
- **«Прийняти ще» without the old stub** (goods P2-1): the new model's
  «… Кількість впишіть тут.» goes once its delivery is received; a refusal
  keeps it (Д4).
- **The correction's stub names its warehouse** (goods P2-2): «Коригування
  записано: Кокон графіт · M · склад «Свій» — Перерахунок, облік 1 → 0.»,
  where the model's correction cells stand on more than one warehouse.
  One warehouse alone, none (Д5, taken: «Кокон оверсайз графітовий
  меланж» on «Склад біля примірочної, другий поверх» made it five lines
  at 360; without the warehouse, three at most).

## How it was built and proven

Sources:
- `frontend/src/catalog/types.ts` (`decidedText` without «: .»; new
  `outcomeText`), `frontend/src/catalog/Catalog.tsx` (`run` says
  `outcomeText` of the answer, a name's answer as before; the cancelled
  creation's `close` — said only when cancelled, on «Нова пропозиція»
  and «Створити нову» alike; `confirmed` — «Обраний товар: …»),
  `frontend/src/catalog/NewModel.tsx` (`close(decision, cancelled)`).
- `frontend/src/inventory/Receive.tsx` (`setAdded(null)` on a recorded
  delivery).
- `frontend/src/inventory/Model.tsx` (`Said` carries the warehouse when
  the cells stand on more than one; the stub names it).

Journeys:
- New:
  - `model`: a correction on «M, Свій» at 360 × 640, a size on two
    warehouses — its stub with «склад «Свій»», three lines at most in
    both themes, the body sent to that warehouse;
  - `model`: one warehouse, long names (Д5) — the stub without the
    warehouse, three lines at most in both themes;
  - `catalog`: «Створити нову» on a proposal's own screen — closed, no
    stub; an unfinished creation cancelled, «Пропозицію відхилено.».
- Extended:
  - `catalog`: confirmed at 360 — «Модель обрано: …», «Обраний товар: …»
    in view with the fold shut, both themes, again from «Підтверджені»
    with no stub (its list answered by a route, not the DB); rejected —
    «Пропозицію відхилено.» over its reason; the creation cancelled — the
    same, and when another reviewer rejected it first; a kept «Далі»
    reopened — «Пропозицію збережено.»;
  - `receive`: «Інший колір нашої моделі» chosen, its stub through a
    refused delivery, gone after «Прийняти ще», the model kept;
  - `correct`: the stocktake's correction on a model's detail with
    «склад «Склад перерахунку»».

Runs (local, `mobile-chromium`, the isolated stand):
- catalog, receive, model, correct — 88 passed (3.4 min), after one
  additive reseed (a crowded «Лоран» made six catalogue journeys miss
  their row).
- `tsc --noEmit`, eslint and prettier on the touched files clean.
- The full suite runs in CI (no local full run).

## Review

An independent review (catalog-domain, inventory-ledger) found, fixed:
- Medium: «Створити нову» on a proposal's own screen dropped the cancel's
  stub — now said as «Нова пропозиція»'s (`made(result)` on cancel).
- Medium: the «Підтверджені» step read the shared DB — now its list is
  answered by a route.
- Low: another reviewer's rejection had no stub pinned — pinned.
- Low: a sheet merely closed could speak, whatever its proposal came to —
  only a cancel speaks now (`cancelled`).
- Low: Д5 was not really proven — long names measured: five lines on two
  warehouses; Д5 taken, a journey of its own.
- Nit: «Обраний товар» under the sticker in both themes — checked.
Left as the TZ chose: the word is the status the server read, so another
reviewer's decision is said too. Out of scope: a kept correction settled
later from the app's notice names nothing (as before).

Mutants (`mutate91`, each applied alone, its journey run, the source
restored): 15 of 15 caught —
- goods P1-1: the old «Рішення збережено.» (confirmed, rejected); no
  «відхилено» word; a kept «Далі» said as decided; a cancel unsaid on
  «Нова пропозиція»; `close(result)` without the cancel flag; a merely
  closed sheet speaking (both sheets); a cancel unsaid on «Створити
  нову»; «Обраний товар» hidden;
- goods P2-1: the stub kept after the delivery; the stub dropped on a
  refusal;
- goods P2-2: no warehouse (model detail, stocktake); the warehouse named
  on one warehouse (Д5).

## Left

- Owner-held: В24-Т1 (goods Н1); goods P2-3 (б) (В22-Т1 / Н2); goods P2-5
  of 2026-11-20 (В20-Т1); Н3 waits a measurement.
- Not proven by a journey: Д1 (a confirmed proposal none of whose
  candidates is named any more — an older proposal).
- Long names on two warehouses still take the correction's stub past
  three lines at 360 (five measured): the warehouse is what tells them
  apart, kept as Д5 says.
- Screenshots at 360 × 640 in both themes — a separate stand, on the
  user's yes.
