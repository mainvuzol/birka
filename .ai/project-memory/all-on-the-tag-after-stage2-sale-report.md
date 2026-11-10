# «Усе на бірці», after stage 2's audit, batch 8: the sale's quick wins — «Внесок»'s and «Покупці»' search the shared field; the till's and the debts' empty places the blank tag, a block's unread a warning's line; S22's one main in Telegram; Telegram asks before closing for a return counted or kept and a payment kept; the paid bar and the price's error in their meanings' colours — 2026-11-10

Baseline: `a72db3a7` (the audit's seventh batch, PR #189, merged), and five
tasks of the sale task list after stage 2 (its quick wins and empty
places, §8):
- [P1-1](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — «Внесок»
  and «Покупці» search with the shared field §6.6;
- [P1-2](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — the
  till's and the debts' empty places the blank tag; «Не вдалося
  прочитати» in a store's block a warning's line;
- [P1-5](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — S22's one
  main in Telegram;
- [P2-1](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — the
  question before closing for a return's units, a kept return and a kept
  payment;
- [P2-2](redesign/2026-11-09-redesign-tz-after-stage2-sale.md) — the paid
  bar and the price's error by their meanings.

P2-4 («{Ім’я} · винні всього {сума}» in a sheet) waits for its words'
approval; P1-3, P1-4, P2-3 and P2-5 are later batches.

Status: built; proof below — 1048 of 1050 journeys on a fresh seed, the two
failing for the stand's database and the door's timing on this Mac, as in
batch 7's run. 35 of 36 mutants caught, one equivalent. CI is GitHub's, on
the pull request. Not yet seen on a real phone.
Branch: `feat/after-stage2-sale`. Task: the audit's eighth batch, chosen in
chat after #189 was merged (2026-11-10, «merged go next»). Chosen:
business-rules.md, "Chosen in chat — 2026-11-10 (audit after stage 2,
batch 8: …)".

Where it stood:
- «Внесок» and «Покупці» searched with the old form: «Ім’я або телефон» a
  line over the field, corner 14, no magnifier, no «×»; «Магазини, що не
  працюють» a plain heading;
- the till with no warehouse or no goods, and its search with nothing
  found, said so in a paragraph, no tag; «Внесок»'s and a store's
  «Покупці»' found nothing too, while «Повернути» drew the blank tag;
- «Не вдалося прочитати» in a store's block header was a refusal's red
  with its crossed circle, over what is owed;
- S22 inside Telegram had two mains: Telegram's «Відкрити борг» and the
  app's way back, filled;
- Telegram let Бірка close with a return's units counted, and with a
  return or a payment kept on the phone after a reload;
- the paid bar was the hand's accent (lime in the dark), round 999 on the
  field's grey; the price's error was the debts' colour, its only use there
  not about a debt.

## What exists now

- **The shared search field** (spec §6.6): «Внесок» and «Покупці» search
  with `SearchField`, as the till and «Повернути» do — 52, corner 8, the
  magnifier, «Ім’я або телефон» its hint and its name heard, no line over
  it; «×» empties it with the cursor kept. From two characters after the
  pause, Enter at once; a letter more or «×» forgets an Enter, as
  «Очистити» does. At the till its field stands where «Знайти модель»
  stood. In «Магазини, що не працюють» a number's keys (`inputmode="tel"`)
  under the section's caption 13/700 in capitals, with the quiet «← У
  цьому магазині». The old form's `.search` and `.till-search` rules are
  gone.
- **The blank tag** (spec §6.28): the till with no warehouse, with no goods
  on one warehouse or on all, its search with nothing found or no goods;
  «Внесок»'s and a single store's «Покупці»' found nothing (a name, a
  whole number), the closed stores' found nothing, «Зараз ніхто не винен.»
  and «Зараз ніхто не винен цьому магазину.» — the shared `Empty`: the tag
  64 in the edge, the line 17/600, what to do its one line of meta, the
  words as before split at the full stop. «Очистити» quiet, its one
  button; «Знайти в каталозі» under the till's; the offer to ask the closed
  stores centred under it. A network's blocks keep their lines.
- **A block that could not be read** (spec §4): «Не вдалося прочитати» in a
  store's block header is a warning's line in its place — the triangle 16,
  the warning's colour, no plate, no crossed circle; its retry as before.
- **S22 inside Telegram**: Telegram's «Відкрити борг» is the screen's one
  main; the way back is quiet under the stub. Outside Telegram the way back
  is the one primary, as before.
- **Before closing** (В-Т7 (а)): Telegram asks while units are counted on a
  return, and while a return or a payment whose answer was lost is kept on
  the phone, after a reload too, until it is checked.
- **The meanings' colours**: the paid bar on S20, S21 and a debt's detail
  (and the supplier's invoice, which shares it) is 6 with the corner 3, its
  track the fold with a hairline, filled in the paid's colour; the price's
  error is the danger's colour with its crossed circle 16, at the till and
  in «Нове замовлення».

## The independent review

An independent reviewer read the diff against `main` with the five tasks,
the spec's §4, §6.6, §6.24 and §6.28 and the decisions above; it ran the
type check and ESLint, not the journeys. No high or medium finding; four
low, four nits. Settled:
- **«Внесок»'s field at the till stood 18 higher** than «Знайти модель»
  and «Що повертають?»: switching the segment still moved it. It takes the
  return's margin now; a journey switches from «Продати» and finds the
  field where it stood, 52 high, named, with its magnifier and «×».
- **«×» kept an Enter**, while «Очистити» forgot it: the same letters
  typed again were searched at once. A letter more or «×» forgets it now,
  as on «Повернути» and «Замовлення»; a journey on a stopped clock holds
  it.
- **The offer to ask the closed stores stood at the left** under the
  centred tag on a wide screen: centred now, as the return's; a journey at
  900 reads it.
- **Weaker checks:** the 360 × 640 reading of the empty till now holds the
  page unscrolled; the till's empty search reads as the tag in three
  journeys; the closed stores' found nothing has a journey; the warning's
  line is read in both themes.
- Nits: the stale doc line on `notFound` gone; the first weeks' words one
  copy (`NobodyOwes` draws the block's line too); the invoice bar's own
  fill rule gone.
- Seen and kept: the bar's fill is 4 inside its 1 px hairline (§6.24 read
  as the track's edge).

## How it was built and proven

- **Code:**
  - `frontend/src/shared/SearchField.tsx`: `inputMode`;
  - `frontend/src/credits/Credits.tsx`: the shared field, the caption, the
    blank tags, `NobodyOwes`, the block's warning line, «×» forgetting an
    Enter;
  - `frontend/src/sales/Sale.tsx`, `frontend/src/sales/StockSearch.tsx`:
    the till's blank tags;
  - `frontend/src/credits/Paid.tsx`: S22's way back quiet under the
    MainButton;
  - `frontend/src/returns/Returns.tsx`, `frontend/src/App.tsx`: the
    question before closing;
  - `frontend/src/sales/PriceHint.tsx`: the danger's sign;
  - `frontend/src/styles.css`: the bar, the price's error, the warning's
    line, «Внесок»'s field margin, the offer centred; `.search`,
    `.till-search`, `.line .price-error`, `.owed-retry p` and
    `.invoice-bar span` gone.
  - No backend change; no word changed.
- **Journeys:** 1050 in all, 1041 before.
  - New: `telegram-rules` — a return's units ask and let go, a kept return
    and a kept payment ask after a reload until checked; `till-search` —
    the price's error in both themes; `credits-debt` — «Внесок»'s field
    where the till's stood; `credits-list` — the closed stores' found
    nothing and the offer centred, «×» forgetting an Enter, a network's
    block keeping its lines, the warning's line in the dark theme.
  - Changed: `credits-list` (the field, the tags, the caption, `tel`, the
    warning's line), `credits-debt` (the bar in both themes, the tag),
    `till-first-days`, `till-two-warehouses`, `till-cells`, `till-search`
    (the tags), `telegram-rules` (S22's one main, in and out of Telegram),
    `stores` (the words split), `design-system` (the old rules gone).

## Mutants

`~/.cache/birka-runtime/helpers/mutate38.py`: 36 mutants, each undoing
one thing this batch made. `mutants38.sh` ran each against the journeys
that should catch it, on a fresh seed each, one failure ending the run.
- **The shared field:** no `inputMode` passed on; no `tel` in the closed
  stores; the caption a plain heading; `.till-search` back; «Внесок»'s
  field margin gone at the till; «×» keeping an Enter.
- **The blank tag:** each till's empty a line again or its meta joined to
  its title (no warehouse, one, all); the till's found nothing without its
  meta, with «Очистити» filled, «Знайти в каталозі» out of the tag;
  «Внесок»'s and «Покупці»' found nothing without its meta (a name, a whole
  number); «Зараз ніхто не винен.» without its meta; a network's block
  drawn as the tag; the read-only empty a line again; the closed stores'
  found nothing without its meta; «Очистити» filled; the offer not centred.
- **The block's unread:** the danger's colour, the crossed circle, the
  plate, no triangle.
- **S22:** the way back with no class, the primary in Telegram; quiet
  outside it.
- **Before closing:** a return's units not asking; a kept return, a kept
  payment not asking.
- **The bar and the price:** the accent's fill; the round corner; the
  field's track; no hairline; the debts' colour; no sign.
- **35 caught, one equivalent.** The first pass: 34 of 37. The three left:
  - «Очистити» filled under «Покупці»' tag: run against the search's
    journey, where it is only pressed; the empty «Покупці»'s journey reads
    its class — caught there;
  - the bar without its own `box-sizing`: every element is `border-box`
    already — the rule was redundant and is gone, and so is the mutant;
  - the track `--field` for `--fold`: equivalent — `--field` is
    `var(--fold)`; the spec names `fold`, kept.
- Logs: `go-mutants38-first.log`, `go-mutants38-second.log`.

## Evidence

- **Type check, ESLint, build:** `tsc --noEmit`, `eslint src e2e` clean;
  `npm run build` built. The e2e type check's errors are main's own
  (`expect.any(…) as string`, two design-system imports).
- **The touched journeys,** on a fresh seed: 253 of 255 first; the two
  were the new closing journeys' last step — the app resent the kept return
  by itself once answers came back, and the kept payment's debt was stubbed
  again under a new id after the reload; the routes now stay across the
  reload and the check waits for the result whichever way it comes: 4 of 4.
  After the review's fixes: 185 of 185, then the two new journeys 2 of 2.
- **Every journey,** on a fresh seed, one worker: 1048 of 1050 in 28.3
  minutes (`b8-full.log`). The two:
  - `backups.spec.ts:93` — 14 nights listed where it reads 3: the stand's
    database keeps every seed's nights (the seed is additive); it fails
    alone too; nothing of this batch touches «Резервні копії»;
  - `cash-kept.spec.ts:630` — the door's timing in a full run, passing
    alone, as in batch 7's.
- **Mutants:** 35 of 36 caught, one equivalent (above).

## Not covered

- A real phone; a real Telegram asking before closing (its event is what
  the journeys hear).
- On a phone the offer to ask the closed stores wraps to the column's
  width, so it was already centred there; it is centred now where it is
  narrower than the column (a wide Telegram Desktop window).
- The bar's fill is 4 of its 6 inside the hairline; a fill the full 6 over
  the track's edge would be the other reading of §6.24.
- «Нове замовлення» takes the price's new error as the till does; its
  journeys read the words, the till's journey reads the colour and the
  sign.
- P2-4 (the debt's chooser at the till a sheet, «{Ім’я} · винні всього
  {сума}») waits for its words; P1-3, P1-4, P2-3 and P2-5 are later
  batches.

## For the owner

- Nothing to answer for these tasks. One thing waits on you: the sheet's
  line «{Ім’я} · винні всього {сума}» for choosing which debt to pay at the
  till (sale P2-4).
- What changes for the eye: «Внесок» and «Покупці» search with the same
  field as the till — a magnifier, «×» to clear — and «Внесок»'s stands
  where the till's does, so nothing moves when you switch; an empty till or
  a search that found nothing shows the blank tag, the fact on one line and
  what to do under it; a store's sum that could not be read is an amber
  warning line, not red; after a payment, inside Telegram, only Telegram's
  «Відкрити борг» is the main button; Telegram asks before closing while a
  return is being counted or a return or payment is still unconfirmed; the
  «Сплачено» bar is green on a pale track, and a price typed wrong is red
  with its sign, never the debts' colour.
