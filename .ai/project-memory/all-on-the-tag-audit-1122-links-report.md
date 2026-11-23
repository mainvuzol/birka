# «Усе на бірці», audit 2026-11-22, batch 4: «Знак, а не рамка» and «Модель своїм ім’ям» — a way of its sentence told by its sign, never a frame; a similar model's chip named by its model, never by one of its colours; a row repeated across pages shown once — 2026-11-23

Baseline: `bb29b2eb` (main after #243).

Points: money P2-2, orders-cash P2-2, goods P2-2, goods Н1, goods Н4.

Taken as the next after «merged go next»: what was left of the audit that
waits for no owner's answer. Money P2-2 and orders-cash P2-2 waited for a
«before» screenshot, taken here on the isolated stand. Goods P2-2 needs
four read-only fields from the server; the user agreed in chat
(2026-11-23). Not in it: money P2-5 (Д4 and В22-Г1), goods P2-3 (б)
(В22-Т1 / Н2), goods P2-5 of 2026-11-20 (В20-Т1).

No right, check, journal or step changes; nothing recorded or sent
changes; no migration.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1261 (six new, five extended).
- Branch: `feat/audit-1122-links`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-23 (audit
  2026-11-22, batch 4: …)".

## What exists now

- **The «before» screenshot** (money Д1, orders-cash §10): four journeys
  on the stand, screenshots on the profile's phone. «Відкрити накладну ›»
  (a return's card, «Продано»'s stub) and «Позичене й під реалізацію ›»
  (an invoice's card): a frame of 1 with no padding, the words against its
  edge. «Скасовані й повернені на склад ›» under «Показати ще»: two frames
  of one weight. Both tasks' condition held.
- **A way of its sentence told by its sign** (money P2-2, orders-cash
  P2-2): the four ways are drawn as «Спершу запишіть видане з каси ›» —
  nothing round them, the link's colour 15/600, 44 high, their words'
  width at their block's left edge, the chevron 16 in pencil after them,
  never underlined; taking no tap, their words in pencil, nothing round
  them. One rule, `.sign-link`, the till's `.cash-first` folded into it.
  «Показати ще» keeps the list's bar.
- **A similar model's chip names its model** (goods P2-2): «Лоран — Понте
  — Пальто — Пальто — довге», as «Пошук моделі в каталозі» says it, never
  «Лоран Понте шоколад»; tapped, «Модель: …» says the same; the same
  `product_family_id` sent. A proposal saved before the server said a
  model's names: the candidate's name, and what tells the model apart.
- **A row repeated across pages, shown once** (goods Н1): «Пошук у
  каталозі» and «Пошук моделі в каталозі» keep each model once by its id.
- **«Схожі»'s size recorded as it is** (goods Н4): twenty at most.

## How it was built and proven

Sources:
- `frontend/src/styles.css`: `.sign-link` after `.link-chevron`;
  `.cash-first` and `.set-off-open` gone; `.orders-gone`'s margin;
  `.sign-link` in the text buttons' «taking no tap» list and out of the
  dashed «not now».
- `frontend/src/cash/Count.tsx`, `frontend/src/suppliers/ReturnDetail.tsx`,
  `frontend/src/suppliers/Borrowed.tsx`, `frontend/src/suppliers/Invoices.tsx`,
  `frontend/src/orders/Orders.tsx`: the class; the chevrons'
  `link-chevron`.
- `backend/app/modules/catalog/matching.py` (`_candidate`) and
  `backend/app/api/v1/catalog_matching.py` (`CandidateResponse`): the four
  names, read from the candidates' query; its garment type the model's
  own, else its name's (`cg`, joined for this), as `search.py` says it —
  the matcher still weighs the model's own. The fingerprint hashes the
  query's rows, so it takes the name's garment type too; nothing compares
  it.
- `frontend/src/catalog/types.ts`, `frontend/src/catalog/NewModel.tsx`
  (`candidateFamily`): the chip and its choice.
- `frontend/src/catalog/FamilySearch.tsx`,
  `frontend/src/inventory/CatalogPicker.tsx`: `found` by id.

Decided here: see the business rules' entry — the held way in pencil; the
16 under «Показати ще»; an older proposal's chip saying what tells its
model apart; Н4's record corrected, the limit kept.

Journeys:
- New:
  - `orders-list` (both themes, 360 × 640): «Скасовані й повернені на
    склад ›» under «Показати ще» a way told by its sign, 4.5:1, 16 under
    the bar, narrower than the list; «Показати ще» the list's bar with its
    edge; it still leads to its screen;
  - `models`: two models of one name and colour, the second with no
    garment type of its own — the chips name each as the search does,
    never «шоколад»; nothing wider than 360; tapped, «Модель: …» as after
    choosing by the search; the chip's model sent;
  - `models`: an older proposal (its candidates' names taken out): the
    candidate's name and what tells it apart;
  - `catalog`: «Пошук моделі в каталозі»'s next page repeating the last
    row — shown once, the cursor on the first new, no key said twice;
  - `receive`: «Пошук у каталозі»'s the same.
- Extended:
  - `cash-close`: «Спершу запишіть видане з каси ›» by the shared check;
  - `borrowed` (both themes, 360 × 640): «Відкрити накладну ›» on the
    stub, and taking no tap; the invoice card's «Позичене й під
    реалізацію ›»;
  - `supplier-invoices`: a return card's «Відкрити накладну ›»;
  - `design-system`: the probe's way on the shared class.
- `fixtures`: `expectSignLink` (measured as laid out, so «Продано»'s stub,
  turned 1.5°, is measured true); `expectLinkChevron`'s size the same way.
- Backend: `test_a_candidate_names_its_model_never_one_of_its_colours` —
  the matcher's candidate (the garment type from the name, then the
  model's own) and the API's answer.

Runs on a fresh seed:
- Before the review: the 23 specs that read the touched screens, in three
  passes for the shared stand's order (`design-system`, `stocktake`,
  `borrowed`, `supplier-invoices`; `suppliers`, `suppliers-pages`,
  `money`, `correct`, `cash-close`, `cash-move-fix`, `cash-kept`;
  `catalog`, `models`, `receive`, `openings`, `openings-file`,
  `goods-places`, `orders-list`, `orders-card`, `till-first-days`,
  `till-placeholders`, `till-sections`, `till-two-warehouses`): 94/94,
  128/128, 294/294. Earlier, on the batch's own journeys, two failures,
  both the new check's: «Продано»'s stub is turned 1.5°, so a drawn box
  measured the chevron 16.27 — the checks now measure as laid out; and a
  tap in «Приймання» chooses and closes the list, so its «one chosen» was
  dropped.
- After the review's fixes: the goods journeys 9/9; the catalogue's
  backend tests 59/59.
- CI runs all 1261.

Mutants (mutate87, 19, each against its journey or the backend test):
19/19 caught.
- The way: an edge; ink; underlined; held in the link's colour; the
  cancelled link a quiet button; under the bar with no gap; a return
  card's, an invoice card's and the till's a quiet button; the stub's
  chevron not the set's.
- The chip: a colour's name; the chosen line by the variant; an older
  proposal's chip blank.
- The server: the model's name the variant's; no source; the garment
  type the model's own alone (after the review); the API dropping the
  names.
- Н1: each picker keeping a row twice.

## The review

An independent review read the diff on a snapshot (the mutants ran
meanwhile) against the three tasks and Н1, and checked CSS specificity,
the stored proposals and the fingerprint. No High, one Medium.
- **Medium, fixed:** a chip said a model's own garment type only, the
  search under it the model's, else its name's (`search.py`); for a model
  added as «Окрема модель» with no garment type, the chip and «Модель: …»
  lost «Пальто» that the search row said. The candidate says it as the
  search does; the backend test and the journey's second model have none
  of their own.
- **Low, known:** the return card's and the invoice card's ways are
  checked at the profile's width in the light theme (the dark theme's
  colour by the shared check, which reads both); a way taking no tap by
  `disabled` set on the stub's, not by a kept operation; the order card's
  rare ways are not measured — the batch does not touch their rules.
- **Nit, recorded:** an older proposal's chip says what tells its model
  apart (Д3 said «as now») — in the business rules' entry.
- **Nit, known:** a next page bringing only rows already shown leaves the
  cursor nowhere, as an empty page did before.
- **Nit, fixed:** `receive`'s Н1 journey checks the cursor on the first
  new row too.
- **Checked fine:** the fingerprint, the retried proposal and feedback
  read nothing new; `CandidateResponse` must declare the names (the API
  test proves it); the names are the candidate's own model's, a merged
  model's former names adding only score; `.sign-link` over the button,
  the held rule and the dashed rule; the cancelled link inline-flex on its
  own line, 16 under; `.cash-first` and `.set-off-open` read nowhere else;
  the journeys fail on main.

## Left

- money P2-5: Д4 (the server's read, which needs the user's consent) and
  В22-Г1.
- goods P2-3 (б) waits for В22-Т1 or a count (Н2), and a server field.
- goods P2-5 (2026-11-20) waits for В20-Т1.
- Dependabot pull request #223 is closed only on the user's word.
