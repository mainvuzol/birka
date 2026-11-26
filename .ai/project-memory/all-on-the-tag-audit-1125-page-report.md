# «Усе на бірці», audit 2026-11-25, batch A: «Сторінка лягла» — a file or lines added felt and said on the list; a cancel's sheet closed after no answer reads the card again; the cash tag keeps its look while it reads; a debt of nothing advises no next payment; a choice felt when it changes; the phone's own failure felt as nothing — 2026-11-26

Baseline: `d594ae60` (main after #249).

Points: goods P1-1; money P2-1 and the price sheet's read; orders-cash
P2-1, P2-2 and Д2; sale P2-1 and `selection` on «Зарахувати
повернення»'s radio; frame P2-1 (б); the two comments #249 left stale
(sale Д4). The user's pick after audit 2026-11-25: «Keep it, build A» —
owner pack № 5's half built in #249 stays (its own entry in
business-rules.md), and this batch. Frame P2-1 (а) is not in it: it waits
for № 5 / В25-К1.

Only the hand, a look, a toast and a read: no word of the server's, no
right, no journal, no command, no step; no server change, no migration.

Status: built and reviewed; the touched specs pass locally, 46 of 46 mutants caught.
Not committed; not yet felt on a real phone.
- Journeys: 1295 (twelve new, ten extended).
- Branch: `feat/audit-1125-page`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-25 (audit
  2026-11-25: owner pack № 5 kept as built; batch A «Сторінка лягла»)".

## What exists now

- **A file or lines added are felt and said** (goods P1-1): recorded — one
  `success`; back on the list once it is read again, a toast from the
  write's own answer (Д1): «Рядки додано: N.», «Файл додано: рядків N.»,
  and with repeats «Файл додано: рядків N, повторів M.» with «Файли
  списку» to the file's card, where it is removed. Д5 applied: the
  TZ's longer sentence took three lines at 360 beside the action; the
  short one takes at most two in both themes. No answer, nothing; refused,
  an `error` and the form's words. A kept file that finds its part removed
  — one success, one toast, by the second send's answer (Д2); lines whose
  part is removed — neither (Д3). The toast is the list's: «←» to the
  list's place or a line opened, it goes (Д4); a list decided while the
  form sent still says the write (Д6, by the code).
- **A cancel's sheet closed after no answer reads the card again** (money
  P2-1): what the server cancelled is said as its answer would have said
  it («Оплату 500,00 грн скасовано. Залишок 2 000,00 грн.»), «Скасовано»
  on its line, the debt as the server has it; not reached, nothing said;
  the read failed, the card as it was and its plate once; closed with
  nothing pressed, nothing read. While it reads, «Сплатити» is held
  (review). Never felt — a read, not an answer. An
  invoice (Telegram's «Назад» too), a payment or set-off, a supplier
  return (from «Брак» too). **The price sheet** the same: closed after no
  answer, the price and the stock read again — recorded, the price that
  stands; not reached, the price as it was.
- **The cash tag keeps its look while the drawer is read again**
  (orders-cash P2-1): «Закрити касу» or «Перший підрахунок» pressed — not
  faded, its eyelet the turning ring (`eyelet-spin`), dashed and still
  where motion is reduced; a second press reads nothing; then «Підрахунок
  каси», focused. A kept operation waiting (`working`) wins: «не зараз»,
  faded, no ring (Д3).
- **A debt of nothing says no next payment** (orders-cash P2-2):
  «Покупець винен 0,00 грн» stays (Д1); «Наступні внески…» neither seen
  nor heard. **Д2**: the order's thread's comment says when «Відправлено»
  has no day.
- **A choice is felt when it changes** (sale P2-1 (а)): the till's
  warehouse from the catalogue, a size read off a label, a return's
  warehouse, «З паперу»'s radios, and the set-off's return in
  «Зарахувати повернення» (the user's addition) — `selection`; the same
  again, nothing (Д1); a size the basket already holds — an `error` and
  its words, no `selection` (Д2). **«Стерти дані покупця»** (б): erased, a
  success; refused, an `error`; no answer, nothing (Д3). The two stale
  comments of #249 corrected (Д4).
- **The phone's own failure is felt as nothing** (frame P2-1 (б)): an
  order's, «Перевірка каталогу»'s and a new model's attempt the phone
  could not write before sending — nothing was sent, the app's words say
  so, nothing felt; a refusal the server said, an `error` as before.

## How it was built and proven

Sources:
- goods P1-1: `openings/Parts.tsx` (`AddFile`, `AddLines` — the buzz and
  the part handed on), `openings/Openings.tsx` (`addedText`, the toast,
  the effect that clears it).
- money P2-1: `suppliers/InvoiceActions.tsx` (`lost` on close, for the
  invoice and the entry), `suppliers/Invoices.tsx` (`readAfterLost`),
  `suppliers/ReturnDetail.tsx` (close reads the return again),
  `prices/SuggestedPrice.tsx` (`onUnanswered`, the reads on close).
- orders-cash: `cash/Cash.tsx` (`reading` on the tag), `styles.css`
  (`.cash-card.reading`), `orders/Collected.tsx` (P2-2),
  `orders/Knots.tsx` (Д2).
- sale P2-1: `sales/Sale.tsx` (`relabel`, the warehouse chip),
  `returns/Returns.tsx`, `sales/paperMark.tsx`,
  `suppliers/InvoiceActions.tsx` (the set-off radio), `credits/Debt.tsx`
  (erase; Д4), `returns/Returns.tsx` (Д4).
- frame P2-1 (б): `App.tsx`, `catalog/Catalog.tsx`,
  `catalog/NewModel.tsx` — `buzzRefusal` in place of `buzz("error")`.

Money Д1 «before»: the sheet closed after no answer did not read the card
— no «Скасовано» on the line, the debt as it was, until the card was left
and opened again. The mutants `lostinvoice`, `lostentry`, `lostreturn`,
`lostdamaged` and `pricelost` put that close back, one place at a time.

Journeys (inside Telegram, `tgWebAppVersion` 8.0, where felt):
- New:
  - `openings-file`: a kept file whose part was removed since — one
    success and one toast for its two sends; «Додати файл» left by «←»
    before a write, no toast; the network lost, a gateway's 503, nothing;
    422, an `error` and «Файл не додано. Перевірте його.»; added, a
    success and the toast; a file repeating another file's photo and line
    — the toast with «повторів 1» at 360 in both themes (within the
    screen, at most two lines), «Файли списку» to the file's warning,
    where it is removed;
  - `supplier-invoices`: a cancel left with no answer, its sheet closed —
    nothing pressed, no read; a 502 not reached, read, nothing said; the
    read aborted, the card as it was, its plate once; a 504 the server
    recorded, «Сплатити» held while it is read (pressed, nothing opens),
    then said, «Скасовано», the debt; an invoice's 504 recorded, closed by
    Telegram's «Назад», said, «Скасовано», the MainButton gone; nothing
    felt;
  - `suppliers`: «Брак»'s return — the journey runs twice: its cancel
    answered, as before this batch, and a 504 the server recorded with
    «Не скасовувати» — read again on the supplier's second page,
    «Скасовано», the unit back in «Брак»;
  - `price`: a price saved and left with no answer — closed with nothing
    pressed, no read; a 502 not reached, «не задана»; a 504 recorded, the
    price that stands;
  - `cash-close` (four: light and dark × «Закрити касу» and «Перший
    підрахунок»): opacity 1, the face and title as before, the eyelet's
    `eyelet-spin` running, its rim and top colours; motion reduced —
    none, dashed; a second press, no second read; the read answered,
    «Підрахунок каси» focused;
  - `size`: a size read off a label — another, `selection`; the same,
    nothing; «Не читали», `selection`; one the basket holds, an `error`
    and its words;
  - `orders-new`, `catalog`: the phone's memory refuses the attempt —
    nothing sent, the app's words, nothing felt; a 409, an `error`.
- Extended:
  - `openings`: «Додати рядки» — the network lost and 503, nothing; 422,
    an `error` and «Рядки не додано. Перевірте їх.»; added, a success
    and «Рядки додано: 1.»;
  - `openings-file`: the first file's journey hears «Файл додано: рядків
    1.»;
  - `suppliers`: a return's cancel, a 502 not reached and its sheet closed
    — read again (its reads counted), as it was;
  - `cash-kept`: a kept money taken out — the tag disabled, faded 0.45,
    its eyelet still;
  - `orders-card`: a debt of nothing — no next payment, seen or heard;
  - `till-two-warehouses`, `returns-elsewhere`, `telegram-rules`,
    `supplier-invoices`: the till's and a return's warehouse chips, «З
    паперу»'s radios, the set-off's radio — each change `selection`, the
    same again nothing;
  - `credits-debt`: erase in Telegram's popup — a 409, an `error`; a 503,
    nothing; erased, a success; every popup's words checked.

Runs (local, `mobile-chromium`, the isolated stand):
- Each new or changed journey alone, as it was written.
- The eighteen touched specs — openings-file, openings, orders-card,
  orders-new, catalog, till-two-warehouses, size, returns-elsewhere,
  telegram-rules, credits-debt, credits, supplier-invoices, suppliers,
  price, cash-close, cash-kept, cash, cash-polish — 430 passed (16.1 min).
- After the review, on the stand reseeded: the journeys it touched —
  openings-file's two, credits-debt's erase, suppliers' «Брак» both ways
  and the regular return, supplier-invoices' lost cancel, price's — 8
  passed (47 s); supplier-invoices' lost cancel with «Сплатити» held —
  passed.
- `returns-sale-screen` (sale Д5: it compares the whole list of buzzes) —
  22 passed.
- `tsc --noEmit`, eslint and `npm run build` clean; prettier on files it
  owns at HEAD, hand-formatted hunks elsewhere (Sale.tsx, Returns.tsx,
  Debt.tsx, styles.css, till-two-warehouses, credits-debt).
- The full suite runs in CI (no local full run).

Mutants (`mutate93.py`, each applied, its journey run, the source
restored) — 46 of 46 caught, each at its own step:
- orders-cash P2-2 — the next payments said at a debt of nothing, in the
  sentence heard or in the line seen (2).
- frame P2-1 (б) — the phone's own failure felt as an `error` again: the
  order, «Перевірка каталогу», a new model (3).
- sale P2-1 — the till's warehouse, a label's size and a return's
  warehouse felt on every tap or never (6); a duplicate size without its
  `error` (1); each of «З паперу»'s three radios silent (3); the set-off
  radio felt on the same return (1); erase: success gone, any failure an
  `error`, a refusal silent (3).
- orders-cash P2-1 — the tag faded while it reads, its eyelet still, the
  reduced-motion rule gone, the ring while a kept operation waits, a
  second press read again (5).
- money P2-1 — the invoice's, the entry's and the return's close without
  a read (the return twice: regular and «Брак») (4); the entry's close
  reading always; the entry said though not cancelled; the read felt as a
  success; «Сплатити» not held while it reads; the price's close without
  a read, and reading always (6 more: 10 in all).
- goods P1-1 — lines: the success gone, a refusal silent or any failure
  an `error`, the toast gone (4); a file: the success gone or felt on
  both sends, a refusal silent or any failure an `error`, the toast gone,
  the toast back after «←» (6); the repeat's action and words gone (2).

## Review

An independent read of the diff (read-only): no serious defect — one
buzz per real change, no buzz on no answer, the toast gone with the
list, no stale closure (`Sheet` keeps its `close` in a ref), the late
read guarded, the CSS in both themes and reduced motion, the spinner
always let go. Its points, each settled:
- Low, a race: a cancel's sheet closed after no answer brought «Сплатити»
  back while the card was read; tapped fast on a cancelled invoice, the
  pay screen opened and «… скасовано» was lost. «Сплатити» is held
  (`rereading`) until the read is in — the MainButton inactive, the
  dock's button disabled; `supplier-invoices` holds the read and presses
  it (mutant `payheld`).
- Weak tests: the «←» toast check retried past the toast's own 4 s —
  read at once now; the repeat toast could leave by itself while measured
  — held by focus first; `credits-debt` checked the popups' count, not
  their words — all of them now; the «Брак» cancel answered was proven by
  no journey after this batch turned it to a lost answer — the journey
  runs both ways.
- Nits: `listName`'s comment left above `addedText` — back on its own;
  `buzz`'s doc names the wrong entry refused at the press (a size the
  basket holds, a file too large); the price sheet's flag uses
  `serverRefused`.
- Accepted knowingly: orders-cash Д3 not reproduced (see «Left»); the
  price sheet's flag is the last press's (a lost save then a
  `PRICE_CHANGED` refusal reads the price, not the stock — rare,
  idempotent); a «no answer» plate from an earlier step could satisfy a
  later step's text in two Telegram journeys (low; the silence checks
  poll after it).
- `buzz("error")` in `src`: 23 → 22 — three gone (frame P2-1 (б)), two
  added for a wrong entry refused at the press (`Sale.tsx` `relabel`,
  `Parts.tsx` a file too large).

## Left

- Frame P2-1 (а) — an invoice's, a supplier return's and a catalog
  change's kept operations confirmed later, still felt as nothing — waits
  for owner pack № 5 / В25-К1.
- Owner-held: В25-К1, В24-К1, В24-Г1, В24-Т1; orders-cash Н1 (a new server
  read field, needs consent); В23-К1; the «Перевірка каталогу» hold
  reading.
- Not reproduced by a journey:
  - a file over the size limit at send (goods P1-1): a file name over 200
    characters is refused when the file is read, so the body cannot pass
    the limit; the `error` there stays, as «Зберегти список» has it;
  - a list decided while «Додати файл» sent (goods Д6) — by the code: the
    form's answer sets the list's toast, «Файли списку» only where the
    list has files;
  - money Д2 (a read after a cancel pressed again) — by the code,
    `readAgain`'s guard (`suppliers/Invoices.tsx:296-303`). Money Д3 (a
    «Брак» return past the fifty newest) is proven: the «Брак» journey
    finds it on its supplier's second page;
  - orders-cash Д3 (a kept operation's own check starting while the tag
    reads) — by the code (`reading && !working`); the kept journey proves
    the tag faded and still with no read in flight;
  - money Д3 of 2026-11-24 (a closed store's invoice paid at 360) — not
    measured, again.
- Felt on iOS and Android — a real phone (e2e sees Telegram's events
  only): the choices, erasing, a file and lines added.
