# «Усе на бірці», audit 2026-11-20, batch 4: one look on the money screens — the till's and «Покупці»'s ways out a link of their sentence; what holds the phone on «Каса» a warning's line; «Клієнт забрав»'s refusals the tray's line; the return's found on a white block; the set-off's returns name their goods; another store's sold-borrowed invoice without what this store has not — 2026-11-22

Baseline: `d382aa42` (main after #237).

Points:
- sale P2-1;
- orders-cash P2-2, P2-3 and its Д5 (dead CSS);
- money P2-2 (а) and (б), P2-3, P2-4.

Taken as the next after «merged go next»: each a look already decided
elsewhere, carried to its last places.

No request, check, journal or right changes; no backend change. What is
recorded, held, set off or cancelled, and the server's checks of it, are as
before.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1234 (1231 before).
- Branch: `feat/audit-1120-batch4`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-22 (audit
  2026-11-20, batch 4: …)".

## What exists now

- **«Знайти в каталозі» and «Шукати за цим номером» a link of their
  sentence** (sale P2-1):
  - Before: the till's question and a bordered button in one paragraph;
    «Борг магазину, що зараз не працює? Шукати за цим номером» one bordered
    button of the whole sentence, two lines in its edge at 360.
  - Now: the question the paragraph's words, the way a link on a line of
    its own under it, read with the question; under the blank tag both
    centred. «Шукати за цим номером» is heard by its own words.
- **What holds the phone on «Каса» a warning's line** (orders-cash P2-2):
  - Before: «Поки причину не записано, інші розділи недоступні.» a field's
    grey hint on the reason's form and on «Каса», the dock's grey line out
    of Telegram — next to «Без імен і телефонів покупців.» in the same
    grey.
  - Now: in the warning's colour, its triangle 16 before the words, no
    plate, never said again. The dock's «Записати причину» where it stood.
- **«Клієнт забрав»'s refusals the tray's line** (orders-cash P2-3):
  - Before: the server's refusal and what the terms in parts need, the
    page's red plate in the sheet, 24 taller than the till's line for the
    same words.
  - Now: the till's tray's line — the crossed circle 16, 14/500/19, 22 in,
    10 over the ways; the five ways in the sheet at 360 × 640.
- **Dead CSS gone** (orders-cash Д5): `.order-card`, `.count-label`,
  `.count-field`.
- **«Повернути постачальнику»** (money P2-2):
  - (а) the models found and their grey places on a white block, rows 64,
    as «Прийшов товар»'s;
  - (б) the supplier felt only as it changes; the same again closes its
    sheet, nothing felt.
- **«Зарахувати повернення»: each return names its goods** (money P2-3):
  «Кокон графіт, M × 2 · Лоран, S × 1 · + ще 1» under its day, units and
  warehouse, as its row in «Постачальникам»; its grey places as tall.
- **Another store's sold-borrowed invoice** (money P2-4): from «Накладні
  магазинів, що не працюють», «За продане позичене: … × N.» alone — no
  cancelling it cannot do here, no batch this store does not keep.

## How it was built and proven

Sources:
- `sales/Sale.tsx`: the catalogue's offer `.catalog-offer`, its question a
  `<span id>`, «Знайти в каталозі» a `.text-button` read with it.
- `credits/Credits.tsx`: `ElsewhereAsk`, one for the store's list and one
  for each network block, each with its own id.
- `cash/Closed.tsx`, `cash/Cash.tsx`: `.reason-held` with the `warning`
  icon, in the three places.
- `orders/Collect.tsx`: both alerts `.tray-refused`.
- `suppliers/NewReturn.tsx`: `list-block` on the list and `block` on its
  Placeholder. `suppliers/Picker.tsx`: `selection` only for another
  supplier.
- `suppliers/InvoiceActions.tsx`: `goodsText` under the option's first
  line, none for a return without lines.
- `suppliers/Invoices.tsx`: the second sentence and the way only on this
  store's own invoice.
- `styles.css`: one rule for a link under its question
  (`:is(.return-offer, .elsewhere-offer, .catalog-offer, .elsewhere-ask)
  .text-button`), the till's 4 under its question, the centring under the
  blank tag; `.tray-refused[role="alert"]`; `.reason-held`; the set-off's
  grey lines each in its line's height; the dead rules gone.

Decided here:
- the till's link 4 under its question: at 8 its paragraph at 360 stood
  6.75 taller than before, past the task's 4; at 4, 2.75;
- one rule for every link under its question, in place of two copies;
- `.tray-refused[role="alert"]` rather than a rule per place: the sheet has
  no class of its own, and nothing else carries `tray-refused`;
- `.reason-held` 6 between its triangle and its words, 22 in as a
  refusal's line;
- the set-off's grey lines each in the middle of its line's own height
  (the day's `t-row` 22, the goods' `meta` 19), 2 apart as the card's: a
  return of one line exactly as tall as its place, by px alone.

Measured, at 360 × 640 out of Telegram (main's sources put back for the
measure, then restored and compared byte for byte): the dock's «Записати
причину» at y 510 before and after; the line 43.4 high before, 38 now (19 a
line, not 1.55 × 14), the dock's top 5.4 lower.

Journeys (+3):
- New:
  - `orders-card` — «Клієнт забрав» refused by the server: the owner's
    words in the sheet, the cursor on them, the error's buzz, the tray's
    line over the ways, the five ways in the sheet at 360 × 640, sent once;
  - `supplier-invoices` ×2 — «Зарахувати повернення» says each return's
    goods (two lines and «+ ще 1»; its name all it says; its place as tall;
    wrapped within the sheet at 360; the chosen's three lines in its
    colours, both themes); another store's sold-borrowed invoice says only
    its first sentence, no way, «Сплатити» kept — this store's own both.
- Extended:
  - `fixtures`: `expectAskedLink` (a text link under its question, read
    with it, 44 high, centred in a tag at its words' width) and
    `expectWarningLine` (14/500/19 in the warning's colour in both themes,
    the triangle 16 unheard, no fill, no role);
  - `till-placeholders`, `till-first-days` — the catalogue's link under
    the tags found, under the empty warehouse's and the blank tag (centred,
    at 560 too); at 360 its paragraph one line and the link 4 under it,
    nothing wider than the screen;
  - `credits-list`, `credits-debt`, `stores` — «Шукати за цим номером» by
    its own name; under the row and under the blank tag (centred, the
    question centred too); at 360 nothing wider;
  - `cash-close` — the warning's line in the dock, on «Каса» and inside
    Telegram; the dock's button 4 under it;
  - `till-shortage` — the till's tray line 22 in, the rule it shares with
    «Клієнт забрав»;
  - `orders-card` — the terms' line the tray's, the ways 10 under it, the
    five in the sheet; one check with the refusal's;
  - `suppliers` — the found on the block, light and dark at 360; the grey
    places on the block; the supplier felt once, not again for the same,
    once for another.

Runs on a fresh seed:
- The 37 specs the change reaches (`design-system`, `stocktake`,
  `borrowed`, `supplier-invoices` and `suppliers` first): 838 passed, 1
  failed — the new set-off journey: a return of one line 1.42 taller than
  its grey place, whose lines stood 8 apart at 1.2em and 0.9em. Fixed by
  measure: each grey line in its line's own height, the day's being the
  `t-row`'s 22 — a gap alone went the wrong way (3.42), and so did `1lh`
  (4.02).
- After the review's fixes, the 7 specs they reach: 207 passed, 1 failed —
  the set-off journey on the gap's first fix; after the measured fix, it and
  the older journey of the set-off's grey places: 2/2.
- CI runs all 1234.

- mutate81, 26 mutants, each against its journey: 24 caught at first. Two
  lived, each a check missing:
  - the link `inline-block` beside its question: at a phone's width it
    wraps under it anyway — the blank tag is checked at 560 too, Telegram
    on a computer, where both would fit on one line;
  - the plate's padding back in the tray's one rule: the till's own look
    check never read it — it reads its 22 now.
  Both then caught: 26/26.
  - sale P2-1: either link quiet again, not read with its question, the
    till's 8 again, not centred, the question not centred, inline;
  - orders-cash P2-2: each of the three lines a hint again, grey, no
    triangle; P2-3: either line the plate again, the rule the till's alone,
    its padding the plate's;
  - money P2-2: no block, its grey places off it, the same supplier felt;
    P2-3: no goods, the grey places 8 apart; P2-4: the second sentence on
    another store's invoice, its way there, its way on neither.

## The review

An independent review read the diff against the six tasks, with
`financial-integrity` for orders-cash P2-2, P2-3 and money P2-3, P2-4.
`tsc` and ESLint are clean; the journeys have no type error main has not.

Checked and found right:
- each `ElsewhereAsk` its own id, two side by side in a network's list;
  every `aria-describedby` to a span drawn with its button; the till's offer
  drawn once per search;
- the second sentence's space; `false` draws nothing;
- the picker's `value` is "" before a choice, so the first is felt; the same
  again still takes and closes, in every form that uses the sheet;
- every place the removed rules reached is a `.text-button` under the one
  rule; the blank tag's centring kept; Д5's classes in no source or journey;
- `.reason-held` over `.hint` and `.pay-what` by order at the same weight;
  `--warning` in both themes;
- each new check fails on main's code; no locator matches two;
- money: only classes and markup — the reason's write, the collect's pay
  and terms, the set-off's choice and body, the invoice's cancelling (still
  never another store's) as before.

Found and fixed:
- **Medium:** «Клієнт забрав»'s refusal by the server had no journey; it
  has one, one look check with the terms' line.
- **Low:** «Шукати за цим номером»'s paragraph kept a paragraph's 14 under
  it; 0 again.
- **Low:** a return with no lines would draw an empty line.
- **Low:** the till's paragraph checked by a loose bound; now its question
  one line of its paragraph, the link 4 under it.
- **Low:** centred links checked at their words' width; the set-off's sheet
  by its own scroller; «Покупці» and the till for nothing wider than 360.

Known, kept:
- **Low:** the warning's line 6 from its triangle, where the ТТН notice's
  lead has 8: the refusals' lines are its neighbours.
- **Low:** a set-off's return says «склад «…»» where «Постачальникам» says
  where it came from («з «Браку» «…»») — for the next audit.

## Left

- Audit 2026-11-20's goods P2-2, P2-3, P2-4; goods P2-5 waits for В20-Т1.
- Н3 (б): the server's filter of the collected and the cancelled (Backend).
- The owner pack's answers.
- Dependabot pull request #223 is redundant after #233. It is closed only on
  the user's word.
