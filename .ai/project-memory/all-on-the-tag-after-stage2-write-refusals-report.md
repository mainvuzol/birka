# «Усе на бірці», after stage 2's audit, batch 15: a refused write says what was not done, then the step — the catalogue, «Моделі», prices, receiving, corrections, stocktakes, «Брак», suppliers and stores (owner, В-П1 (б)) — 2026-11-12

Baseline: `ab7e28b7` (the audit's fourteenth batch, PR #197, merged). This
batch carries the owner's answer В-П1 (б) of 2026-11-11 — «The same rule
reaches every section» — to every section it named that was not yet
rewritten: the catalogue («Перевірка каталогу», «Нова модель»), «Моделі»,
prices, «Прийшов товар», corrections, stocktakes, «Брак», suppliers
(borrowed goods, invoices, returns, the supplier picker and list) and
«Магазини». The till, returns and debts (batch 11) and «Початкові
залишки» (batch 10) were done before.

Left of the goods task list: P1-2, P1-3, P1-4, P1-5 and P2-4, each marked
«нужно утверждение» (the design or the words).

Status: built and proven in the journeys (1086 of 1087, the stand's own
`backups:93`); 38 of 38 mutants caught; the review's findings fixed; not
committed.
Not yet seen on a real phone.
- Branch: `feat/after-stage2-write-refusals`.
- Task: the audit's fifteenth batch, chosen in chat after #197 was merged
  (2026-11-12, «merged, go next»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-12 (audit after
  stage 2, batch 15: …)".

Where it stood:
- Every one of these screens said «… та спробуйте ще раз» (or «Спробуйте
  ще раз.») after a refused write, and its conflict «… перегляньте … й
  спробуйте ще раз».
- A refusal naming nothing (a 400 or a 404 no screen has words for) and
  the server's own failure (a 5xx) said the shared «Не вдалося виконати
  операцію. Спробуйте ще раз.» — never what was not done.

## What exists now

- **One rule, one helper** (`refusedWrite`, `frontend/src/shared/api.ts`):
  - a request not taken (422), or one naming nothing (400, 404): «{не
    зроблено} {що перевірити}»;
  - a conflict (409): «{не зроблено}: {що змінилося} — перегляньте …»;
    what each screen reads again after it does not change;
  - the server's own failure (5xx) on a command sent directly, never kept
    (a price, a stocktake started or finished, «Брак»'s steps, a supplier
    added or saved): «{не зроблено} Натисніть ще раз — повторити безпечно.
    Номер запиту: …»;
  - a reason the server names, no server, a session ended, no access:
    their own words, as before.
  - Where the fate is said after the step — a count, a correction —
    `refusalStep`: «Перевірте кількість. Нічого не записано.»
  - The catalogue's `catalogRefusal` (`frontend/src/catalog/commands.ts`):
    - refused as pressed: «Операцію каталогу не записано.» first — then
      «Перевірте модель і назву.» for a request naming nothing (a
      rejection's sheet: «Перевірте причину відхилення.»), or the words of
      a request not taken or a conflict it does not name;
    - still kept on the phone, its outcome unknown: «Операцію каталогу ще
      не підтверджено: сервер не зміг відповісти. Перевірте результат ще
      раз — двічі вона не запишеться. Номер запиту: …», as every kept
      command says it;
    - kept, then refused as having recorded nothing: «Операцію каталогу не
      записано.» before why, as before — in the rejection's sheet too now.
  - «Початкові залишки»' `listRefusal` moved onto it, its words unchanged.
- **The words, screen by screen:** the business rules' entry lists every
  one, was → now.
- **The kept operations' words stay** (owner): a count, a correction, a
  «Моделі» change, an invoice's payment, set-off or write-off, a return to
  a supplier, borrowed goods marked sold and a store's state, kept on the
  phone and refused later, say what they said — each by a branch of its
  own. A 5xx on a kept command keeps it on the phone, as before.
- «Прийшов товар» says its fate in one order: «{чому} Нічого не прийнято,
  список збережено.» after a reason the server names too.
- The supplier picker's conflict reads the list again, as its words say.
- Not reached: «Каса»'s refusals as pressed and an order's conflict as
  pressed still say «спробуйте ще раз» — В-П1's list named neither; a
  question for the owner. The app's own failure before anything is sent
  keeps the shared words, as in batch 10.

## The independent review

An independent review (a fresh agent, the diff and the owner's rule; no
conclusions handed to it) found:
- **High, fixed:** a catalogue operation still kept on the phone — a resend
  answered 400/404 with no proof, a read failing after it was taken — said
  «Операцію каталогу не записано. Перевірте модель і назву.» beside its
  stub «Результат ще не підтверджено»: a seller could type again what may
  have been recorded. Now `catalogRefusal` knows whether the phone still
  keeps it (`held`): «… ще не підтверджено …», as every kept command.
- **Medium, fixed:**
  1. The kept words of invoices, supplier returns, borrowed goods, a
     store's state and «Моделі» changed with the pressed ones (they share
     a function). Now each takes `kept` and says the old words; journeys
     for a kept payment and a kept store change refused with
     `recorded: false`, and a «Моделі» change refused 404.
  2. A catalogue 5xx said «Спробуйте ще раз» beside the kept stub — now
     the kept words (with the high one); a journey.
  3. The report claimed «спробуйте ще раз» was gone from every write but
     the kept ones: «Каса» and orders as pressed still say it. Corrected
     here and in the rules, as a question for the owner.
- **Low, fixed:** the receipt's journey checked the refused send, not the
  accepted one (`sent[3]` now); the catalogue's 422 and plain 409 said no
  fate (now «Операцію каталогу не записано.» first, a journey); the
  receipt's fate in two orders (one now); the picker's conflict did not
  read the list it names (it does, checked).
- **Low, left:** the fate after the step for a count and a correction
  («Перевірте кількість. Нічого не записано.») — as the owner's own words
  for a return put it last; the steps' words the owner did not give, in
  the readings below; a 401 saying «Незавершену команду збережено.» and a
  502–504 «продавайте на папері» on commands never kept — older than this
  batch, not of it.

## How it was built and proven

**Code:**
- `frontend/src/shared/api.ts`: `refusedWrite`, `refusalStep`.
- `frontend/src/catalog/commands.ts`: `catalogRefusal` (pressed, kept,
  held); «Модель неоднозначна…» without its last clause.
- `frontend/src/catalog/Catalog.tsx`, `NewModel.tsx`, `Models.tsx`.
- `frontend/src/inventory/Receive.tsx`, `Correction.tsx`, `Stocktake.tsx`.
- `frontend/src/damaged/Damaged.tsx`, `frontend/src/prices/SuggestedPrice.tsx`.
- `frontend/src/suppliers/Borrowed.tsx`, `invoiceWords.ts`,
  `returnWords.ts` (each with its kept words), `Picker.tsx` (its conflict
  reads the list), `SupplierList.tsx`.
- `frontend/src/stores/Stores.tsx` (its kept words),
  `frontend/src/openings/types.ts`, `frontend/src/App.tsx` (a kept
  invoice's or return's refusal in its kept words).
- `frontend/e2e/fixtures.ts`: `refuseOnce` answers a 404 and a 500 too
  (`FAILED_REQUEST_ID`).
- No backend change.

**Journeys:** 1087 in all; 1084 before.
- New (3): `models` — a catalogue operation the server failed stays kept,
  said unconfirmed; a kept «Моделі» change refused 404 keeps its words (a
  row of the kept-rename table); `supplier-invoices` — a kept payment
  refused for a conflict with `recorded: false` keeps its words; `stores` —
  a kept store change refused so keeps its words.
- New steps in the journeys that already refused (each after a step whose
  words differ, so none can pass on the words before):
  - a 500 with a request's number: a price, a stocktake started and
    finished, «Брак», a supplier added and saved;
  - a 404: each of those, «Моделі»'s rename, merge and retire, a receipt,
    a correction, borrowed goods marked sold, an invoice's payment, a
    return to a supplier, a store's state, a rejection's sheet and a new
    model from «Перевірка каталогу»;
  - a 409: the merge, the supplier picker (its list read again); a 422
    and a plain 409 on a new model; «Модель неоднозначна…»;
  - the request counts of `correct`, `receive`, `stores`, `suppliers` and
    `supplier-invoices` follow their extra refused sends.
- Changed words: `borrowed`, `correct`, `damaged`, `models`, `price`,
  `receive`, `stocktake`, `stores`, `suppliers`, `supplier-invoices`,
  `openings` (the receipt's named reason).
- `frontend/e2e/fixtures.ts`: `refuseOnce` answers 404 and 500
  (`FAILED_REQUEST_ID`).

## Mutants

`mutate45.py`, 38 mutants, each applied alone, its journey run, the source
restored (`mutants45.sh`): 38 of 38 caught, each at the check meant for it.
- The helpers (4): `refusedWrite`'s 5xx and 404 ways and its 422 words;
  `refusalStep`'s 404.
- The catalogue (10): its 404 way and words, the fate before a 422 or a
  plain 409, the held words and whether it is held, the kept prefix — in
  the queue's line and in «Нова модель» —, the rejection's words,
  «Модель неоднозначна…»'s clause back.
- Each screen's words (20): «Моделі» (rename, merge and its conflict,
  retire), a stocktake started and finished, a count, a correction and
  its kept branch, a receipt, «Брак», a price,
  borrowed goods, an invoice, a return, the picker's step and conflict,
  a supplier saved, a store, «Початкові залишки»' conflict.
- The review's fixes (4): a kept invoice's and a kept store change's
  words, the picker's list read on a conflict, the receipt's named
  reason's order.
- Two of the first pass passed: `cattop` and `catsheet` were run against
  journeys whose refusal is not shown in that place; run against the ones
  that show it (the queue's line after the sheet is left; «Нова модель»),
  both caught.
- Not covered by a mutant: the kept «Моделі» change's words (its 404 row
  checks them; a mutant would need an import the file lacks).

## Evidence

- Full run, a fresh seed, one worker: 1086 of 1087 in 30.0 min. The one:
  `backups:93` — the stand's own (the additive seed's nights), as in every
  full run since batch 8.
- The affected specs (`borrowed`, `catalog`, `correct`, `damaged`,
  `models`, `openings`, `price`, `receive`, `stocktake`, `stores`,
  `suppliers`, `supplier-invoices`) before and after the review's fixes;
  `catalog`'s «Лоран» choices and `openings`' typed list needed a fresh
  seed on the crowded stand, as before.
- Types: `tsc -p tsconfig.json` clean; the journeys'
  (`tsconfig.eslint.json`) 44 errors, as on main — none on a line of this
  batch. ESLint clean on every file touched; Prettier on the files
  touched, `App.tsx`'s unrelated hunks left as they were.

## Not covered

- A real phone.
- A count refused for a request naming nothing: its journey counts the
  requests it sends by place; the correction's journey proves the same
  helper.

## For the owner

- **Done:** wherever a change is refused, the screen says what was not
  done, then what to check — never «спробуйте ще раз»; the server's own
  failure says to press again, safely, with the request's number. What an
  operation kept on the phone says stays as it was.
- **A question:** «Каса»'s refusals as pressed and an order's conflict
  still say «спробуйте ще раз» — your list did not name them. Carry the
  same rule there?
- **To read** (decided here): the words of what to check where you gave
  none — «Перевірте склад.», «Перегляньте підрахунок.», «Перевірте, яка
  модель лишається.», «Перегляньте її картку.», «Перевірте дані
  одиниці.», «Перевірте дані накладної.», «Перевірте модель і назву.»,
  «Перевірте причину відхилення.».
- **Waiting for your approval** (the goods task list): P1-2, P1-3, P1-4,
  P1-5, P2-4.
- **Still open:** «Закриття · Центр» (batch 12); «Продано»'s stub words
  (batch 13); the «Початкові залишки» hold line (batch 10).
