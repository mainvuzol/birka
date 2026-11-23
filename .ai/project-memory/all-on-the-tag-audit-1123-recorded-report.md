# «Усе на бірці», audit 2026-11-23, batch 1: «Що записано — те й сказано» — a supplier screen held by its own unread journal; a cancel felt and said as a record is; «Модель додано», «Колір додано» or «Модель обрано» by what the server made; /me read again never the sign-in — 2026-11-24

Baseline: `f16fff36` (main after #245).

Points: money Н1 (`financial-integrity`), money P2-1 (`financial-integrity`),
goods P1-1 (catalogue identity: words only), frame P2-1.

The user's pick after audit 2026-11-23: «Both batches, money first» — this
batch first; batch 2 is the small points (frame P2-2, P2-3; sale P2-1,
P2-2; orders-cash P2-1, Д1, Д2; money P2-2; goods P2-1, P2-2).

No right, check, journal or step changes; nothing recorded or sent
changes; no server change, no migration.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1267 (four new, six extended).
- Branch: `feat/audit-1123-recorded` (carries the audit's ten documents).
- Decisions: business-rules.md, "Chosen in chat — 2026-11-24 (audit
  2026-11-23, batch 1: «Що записано — те й сказано» …)".

## What exists now

- **A supplier screen held by its own unread journal** (money Н1): a return
  to a supplier the phone cannot read holds «Постачальникам» and «Позичене
  й під реалізацію»; an invoice operation it cannot read holds «Накладні».
  The screens still open, the plate at the top says why, nothing sends.
- **A cancel felt and said** (money P2-1): a payment's, a set-off's and a
  whole invoice's cancel buzz `success` on the server's answer and `error`
  on its refusal, nothing with no answer; over the sum, «Оплату 500,00 грн
  скасовано. Залишок 2 000,00 грн.», «Залік … скасовано. Залишок …»,
  «Накладну «…» на … скасовано.».
- **What the sheet made, by the server's answer** (goods P1-1): «Модель
  додано», «Колір додано» or «Модель обрано» — in the sheet's stub and
  «Пропозиція» alike; «Додати колір · N розміри» in «Інший колір нашої
  моделі».
- **/me read again never the sign-in** (frame P2-1): the not-trading
  store and «Магазинів поки немає» keep their screen, the failure the plate
  of every place unread with its one retry, no paper's words; the owner
  who changed a store's state keeps her store and basket.

## How it was built and proven

Sources:
- `frontend/src/App.tsx`: the three supplier screens' `blocked`
  (`|| supplierStorageError`, `|| invoiceStorageError`); `shown` (a token
  and `me.data`) keeps a failed re-read off the sign-in screen; `tryAgain`
  the `Unread` plate while a re-read failed (`retry` the text button
  otherwise, the sign-in's own); `NoAccess`'s doc comment back over it.
- `frontend/src/suppliers/InvoiceActions.tsx` (`cancelInvoice`,
  `EntryCancel`'s `undo`): `buzz`.
- `frontend/src/suppliers/invoiceWords.ts` (`cancelledText`),
  `frontend/src/suppliers/Invoices.tsx`: the line over the sum.
- `frontend/src/catalog/types.ts` (`decidedName`, `decidedText`; the
  creation's `family_created`, `variant_created`),
  `frontend/src/catalog/NewModel.tsx` (stub, button),
  `frontend/src/catalog/Catalog.tsx` (its own copy gone).

Journeys:
- New:
  - `borrowed`: the returns' journal unread — «Постачальникам»'s «Повернути
    товар постачальнику» and «Позичене»'s «Продано» held; the invoices'
    unread — the card's «Сплатити» and ⋯ held; nothing sent;
  - `supplier-invoices`: inside Telegram, a payment's cancel refused (error,
    no line), unanswered (nothing felt, the sheet says so), answered
    (success, its line); the invoice's cancel refused, then answered;
  - `receive`: «Інший колір нашої моделі» with the colour the model has —
    «Додати колір · 1 розмір», nothing made, «Модель обрано: … Кількість
    впишіть тут.», no «додано»;
  - `session`: the owner's basket at the till, «Ринок» blocked, /me after
    it unanswered — no sign-in, the stub, the paper's banner, «Кошик · 1».
- Extended:
  - `supplier-invoices`: the cancel journey's two lines; the set-off
    journey's «Залік 1 200,00 грн скасовано. Залишок 4 000,00 грн.»;
  - `catalog`: «Це вона» — «Додати колір · 1 розмір», «Колір додано: …»;
    the family search — «Додати колір · 1 розмір»;
  - `session`: the blocked store's re-read lost — its screen, the plate,
    no paper, no sign-in; the plate's retry pressed and held;
  - `stores`: «Магазинів поки немає» read again unanswered — the plate,
    no paper, no sign-in;
  - `fixtures` `addModel`: either word.

Runs on the stand (seed of 2026-11-24):
- Each point's journeys alone: Н1 1/1; cancels 2/2, then 4/4 with the
  set-off line and the invoice's refusal; `catalog` + `receive` 60/63 —
  the three failures Vite reloading `App.tsx` mid-run while a first edit
  had `failure` read before it was declared, 3/3 after; `session` +
  `stores` 27/27.
- Before the review, the 15 specs that read the touched screens
  (`borrowed`, `supplier-invoices`, `suppliers`, `suppliers-pages`,
  `credits-debt`, `receive`, `returns`, `till-redesign`, `correct`,
  `openings`, `stocktake`, `outage`, `first-sign-in`, `design-system`,
  `orders`): 424/424.
- After the review's fixes, the 7 specs they touch (`supplier-invoices`,
  `session`, `stores`, `catalog`, `receive`, `suppliers`, `borrowed`):
  150/155 — the five `catalog` journeys waiting for «Це вона: Лоран
  шоколад 70 см», the crowded shared catalogue of three runs that day
  (they had passed in the first); on a fresh seed 5/5.
- CI runs all 1267.

Mutants (mutate89, 25, each against its journey, after the review's
fixes): 25/25 caught.
- Held: «Постачальникам», «Позичене», «Накладні» each free of its own
  journal.
- Felt: the invoice's cancel and an entry's, each without its success or
  its error; no answer felt as success, on an entry's and on the
  invoice's; a gateway's 503 felt as a refusal.
- Said: either cancel's line gone; a set-off said «Оплату»; «Залишок»
  dropped.
- The catalogue: «Додати модель» in the colour mode; a colour said
  «Модель додано»; nothing made said «Модель додано»; the sheet's and
  «Пропозиція»'s old words.
- /me: the sign-in again (blocked store, no stores, the owner); no plate;
  the plate's retry not held; «Доступу ще немає» forgotten.

## The review

An independent review read the diff against the four points' TZ
sections, TanStack Query 5's own code and the server's catalogue answer.
One real regression, the rest low.
- **Medium, fixed:** once «Доступу ще немає» was answered (its `data`
  kept by TanStack), a later read that went unanswered let the person
  back into the store with the rights read before — invited to sell,
  even on paper. «Доступу ще немає» now stands until /me is answered
  again; that read unanswered is the sign-in's screen, as before.
  `session` proves it (a third read lost between the access ended and the
  store open again).
- **Low, fixed:** a gateway's 502–504 — no answer to the app everywhere
  else — buzzed an error on a cancel: not now, on the invoice's, the
  entry's and a return's cancel alike. `supplier-invoices` answers an
  entry's cancel 503 and counts no error felt.
- **Low, fixed:** the decisions recorded (business rules, written while
  the review read).
- **Low, fixed:** acceptance checks the TZs asked: the plate in the blank
  tag at 360 × 640 in both themes (`stores`), the cancel's line at 360 ×
  640 in both themes, the sum under it (`supplier-invoices`), a whole
  invoice's cancel unanswered — nothing felt, the sheet says so
  (`supplier-invoices`).
- **Nit, fixed:** the entry's sum read from the server's answer, the
  card's own read only if absent; a repeat answered as it stands on an
  invoice cancelled or written off since says no «Залишок»;
  `decidedText` reads a missing creation as none; the old `addedSaid`'s
  doc comment, left over `Failure`, gone.
- **Checked fine:** every `blocked` its own journal's; kept checks outside
  `blocked`; «Ще» and «Гроші» rows open; success only on the server's
  answer, one status line; the catalogue's words exactly the server's
  three outcomes, the MainButton's and the button's one `words_`; with
  `data`, TanStack keeps `error` through the next read, so the plate stays
  held; 401 and `NO_ACCESS` as they were; the Workspace keeps its place in
  the tree, the basket kept; no hook order or use-before-declaration
  issue; journeys pass only with the change.
- **Known:** a return's cancel answered 502–504 is not proven by a
  journey (no Telegram journey cancels a return with a gateway's answer).

## Left

- Batch 2: frame P2-2, P2-3; sale P2-1, P2-2; orders-cash P2-1, Д1, Д2;
  money P2-2; goods P2-1, P2-2.
- Owner-held: В23-К1; money P2-5 (Д4, В22-Г1); goods P2-3 (б) (В22-Т1 /
  Н2); goods P2-5 of 2026-11-20 (В20-Т1).
- Screenshots at 360 × 640 in both themes (money P2-1's line, frame
  P2-1's plate in the blank tag) — a separate stand, on the user's yes.
