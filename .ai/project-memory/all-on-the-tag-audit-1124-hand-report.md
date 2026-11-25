# «Усе на бірці», audit 2026-11-24, batch 2: «В руці — те, що на екрані» — `error` only for a refusal the server said; a cancel's gateway answer keeps its sheet; «Продажу немає» and a kept operation confirmed later felt as recorded — 2026-11-25

Baseline: `efe55c26` (main after #248).

Points: frame P2-1, money P2-1 (а)(б), sale P2-1. The user's pick after
audit 2026-11-24: «Both, goods first» — this is the second batch, after
«Корінець каже, що і де» (#248).

Only the hand changes, and one sheet's place (a cancel's on a gateway's
answer). Nothing sent, when or how often, no word, no right, no journal,
no command, no step; no server change, no migration.

Status: built and reviewed; the touched specs pass locally, 28 of 28 mutants caught. Not committed; not yet felt on a real phone.
- Journeys: 1283 (nine new, six extended).
- Branch: `feat/audit-1124-hand`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-25 (audit
  2026-11-24, batch 2: «В руці — те, що на екрані» …)".

## What exists now

- **`error` only for a refusal the server said** (frame P2-1):
  `serverRefused` in `shared/api.ts`, `buzzRefusal` in
  `shared/telegram.ts`. With no answer (the network, a gateway's 502–504,
  `SlowAnswer`) nothing. The nine direct sends, «Новий список» and the
  three cancels use it.
- **A cancel's 502–504 keeps its sheet** (money P2-1 (а)): the reason in
  it, «Немає відповіді сервера. Натисніть ще раз — повторне натискання
  безпечне.», nothing on the card, the paper's words once (the plate);
  pressed again, one «… скасовано» and one success.
- **«Додати постачальника» refused, an `error`** (money P2-1 (б)); one on
  the list already and no answer, nothing.
- **Recorded is felt** (sale P2-1): «Продажу немає» a success; a kept
  sale, shortage, return, payment or write-off confirmed later — by its
  button or by the phone itself — a success, once. A check left
  unanswered and a refusal on a later check, nothing. An invoice's, a
  supplier return's and a catalog change's confirmed later stay as they
  were, nothing — sale P2-1 named the four alone (see «Left»).

## How it was built and proven

Sources:
- `frontend/src/shared/api.ts` (`serverRefused`),
  `frontend/src/shared/telegram.ts` (`buzzRefusal`, `buzz`'s comment).
- frame P2-1: `prices/SuggestedPrice.tsx`, `suppliers/SupplierList.tsx`,
  `damaged/Damaged.tsx`, `inventory/Stocktake.tsx` (×2),
  `openings/Openings.tsx` (×3), `openings/Parts.tsx`, `openings/Line.tsx`.
- money P2-1: `suppliers/InvoiceActions.tsx` (×2),
  `suppliers/ReturnDetail.tsx`, `suppliers/Picker.tsx`.
- sale P2-1: `sales/Sale.tsx` (the `nothing-sold` branch), `App.tsx`
  (`checkSale` ×2, `checkReturn`, `checkCredit`) — beside the stub, never
  in an effect (Д3).

Journeys (inside Telegram, `tgWebAppVersion` 8.0; the shared
`loseOnce` in `e2e/fixtures.ts` — the network lost or a gateway's
502–504, after the server recorded it when asked):
- New:
  - `price`: a price — network, 503, 422, saved;
  - `stocktake`: a stocktake's start and finish — the same;
  - `openings`: a line's answer, a part removed, «Затвердити» (its
    answer the journey's own) and «Відхилити» — the same;
  - `suppliers`: «Додати постачальника» — network, 503, 422, one on the
    list, added; «Змінити постачальника» — network, 503, 422, saved;
  - `shelf`: «Продажу немає» a success, the question nothing; kept, a
    warning; a check unanswered, nothing; «Продажу не було», a success;
    the tab left and come back to, nothing more;
  - `outage`: a kept sale confirmed by the phone on opening, a success
    once, nothing on coming back; checked unanswered, nothing, then
    confirmed — by «Перевірити результат продажу», or by the phone first —
    a success once; refused on its check (a 409 recording nothing), its
    warning alone, the refusal said;
  - `credits-debt`: a kept write-off — a warning, a check unanswered
    nothing, confirmed a success.
- Extended:
  - `damaged`: a decision's MainButton — network, 503, 422, recorded;
  - `supplier-invoices`: the cancel journey turned over — a payment's
    503 and network loss keep the sheet with its reason (360 × 640, both
    themes), an invoice's 502 and a 504 after the server cancelled it
    too; pressed again, one line, one success;
  - `suppliers`: a return's cancel answered 504 after the server
    cancelled it — the sheet with its reason; again, cancelled once, the
    goods back once;
  - `returns-sale-screen`: a kept return confirmed after a reload —
    `[success]`;
  - `credits-debt`: a kept payment confirmed — `[…, warning, success]`;
  - `telegram-rules`: a sale kept on Telegram 9.1, confirmed — once, a
    success (it said «not felt» before; the review found it outside the
    touched specs).

Runs (local, `mobile-chromium`, the isolated stand):
- Each new or changed journey alone, as it was written.
- The twelve touched specs — credits-debt, damaged, openings,
  openings-file, outage, price, returns-sale-screen, shelf, stocktake,
  supplier-invoices, suppliers, till-receipt — 375 passed (11.8 min).
- After the review: the journeys it touched — `telegram-rules`'s kept
  sale, `outage`'s three, the invoice's and the return's cancels — three
  times each, 18 passed (58 s).
- `tsc --noEmit` and eslint clean; prettier on files it owns at HEAD,
  hand-formatted hunks elsewhere (App.tsx, Sale.tsx, credits-debt).
- The full suite runs in CI (no local full run).

Mutants (`mutate92.py`, each applied, its journey run, the source
restored) — 28 of 28 caught:
- frame P2-1 — `error` on any failure, one place at a time: the helper
  itself, a gateway's answer taken as a refusal, the price, «Змінити
  постачальника», «Брак», a stocktake's start and finish, «Затвердити»,
  «Відхилити», «Новий список», a part removed, a line's answer (12).
- money P2-1 — a gateway's answer closing the sheet again, for a payment's,
  an invoice's and a return's cancel; «Додати постачальника» refused
  silent; one already on the list felt as an error (5).
- sale P2-1 — «Продажу немає» silent or a warning; a kept sale confirmed
  silent (by the phone on opening, by its button, on Telegram 9.1), felt
  twice, a refusal on its check felt; a kept shortage, return, payment and
  write-off confirmed silent (11).

## Review

An independent read of the diff (read-only): no defect in the sources —
no `error` on no answer at any of the thirteen places, every refusal still
felt, the sheets closed only on a refusal said, no `success` twice (the
`busy` guards) and none on entering a screen, no import cycle. Its points,
each settled:
- High: `telegram-rules`' kept sale (Telegram 9.1) still said «not felt»
  and would have failed in CI — it expects one success now.
- Medium: a refusal on a later check was proven silent by no journey —
  `outage` has one inside Telegram now (its mutant below).
- Low: `outage`'s button journey could race the phone's own check — it
  takes either now, as `telegram-rules` does; the invoice cancel's plate
  was «fewer than two» — exactly one now, none in the sheet; `loseOnce`
  could hang if the server's fetch threw — it answers the request lost in
  any case; two stale comments (`App.tsx`, `returns-sale-screen`) and a
  rule worded wider than built (`business-rules.md`) — narrowed, the rest
  under «Left».
- Accepted knowingly: `SlowAnswer` not reproduced (the same branch as the
  network lost; a route's `timedout` gives `Unreachable`, not it).

## Left

- Owner-held: В24-К1, В24-Г1, В24-Т1; orders-cash Н1 (a new server read
  field, needs consent); В23-К1; the «Перевірка каталогу» hold reading.
- Not reproduced by a journey: `SlowAnswer` (60 s) — the same branch as
  the network lost; money Д3 (an invoice of a closed store at 360) not
  measured.
- Seen while building, not in this batch: «Додати рядки» on a list
  records without a buzz.
- Seen by the review, not in this batch: an invoice's and a supplier
  return's kept operations (`checkInvoice`, `checkSupplierReturn`) and a
  catalog change's (`catalog/Models.tsx`) confirmed later are felt as
  nothing, unlike the four of sale P2-1; an `error` for the app's own
  failure (an attempt not written before sending — orders, «Перевірка
  каталогу», a new model) and for an order's or a store's later check
  refused — all before this batch.
- «Nothing» felt on iOS and Android — a real phone (e2e sees Telegram's
  events only).
