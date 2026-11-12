# «Усе на бірці», after stage 2's audit, batch 11: the till's «На який борг вносить?» a sheet over the list, as on the card, «{Ім’я} · винні всього {сума}» its one line; the sale tab's write refusals by В-П1 (б); sale P2-3's approved words — the sale task list closed — 2026-11-11

Baseline: `a84182a1` (the audit's tenth batch, PR #193, merged). This batch
covers three items of the sale task list after stage 2:
- [P2-4](redesign/2026-11-09-redesign-tz-after-stage2-sale.md): at the
  till, the seller chooses which debt a payment goes to in a sheet, as on
  the card;
- [P2-5](redesign/2026-11-09-redesign-tz-after-stage2-sale.md): write
  refusals without «спробуйте ще раз»;
- P2-3's words, which the owner approved on 2026-11-11. Batch 9 built
  their look and kept the old words until then.

With this batch, every task of the sale task list is built.

Status: built. 1062 of 1063 journeys passed on a fresh seed; the one that
failed did so for the stand's database, as in batches 7–10. 31 of 31
mutants were caught. CI is GitHub's, on the pull request. Not yet seen on
a real phone.
- Branch: `feat/after-stage2-sale-debt-sheet`.
- Task: the audit's eleventh batch, chosen in chat after #193 was merged
  (2026-11-11, «Yes, sale first»).
- Chosen: business-rules.md, "Chosen in chat — 2026-11-11 (audit after
  stage 2, batch 11: …)".

Where it stood:
- At the till's «Внесок», a customer with two debts or more opened a whole
  screen. It was headed by her name with «← До боргів» over it. It had her
  phone as a link and a card «Винні всього» of radius 20, then the list.
  - The till left the finger, and S21 went back to that screen by her
    name.
- The tab's write refusals ended in «спробуйте ще раз»:
  - the till's conflict, the return's conflict and the return's request not
    taken;
  - a payment's and a write-off's conflict and request not taken;
  - both of erasing's refusals.
  - A refusal naming nothing said the shared «Не вдалося виконати
    операцію. Спробуйте ще раз.».
- «Знайти в каталозі» said two sentences, its way back «Назад до списку».
  The label's chip showed the whole «Не читали — продати як «розмір
  невідомий»».

## What exists now

- **«На який борг вносить?»** (P2-4; §3, §6.29, S20):
  - The sheet rises over the till's list when a customer of two debts or
    more is tapped. The list stays under it, out of reach, its search kept.
  - Under the title, one line in pencil, read with the title: «Оксана
    Петренко · винні всього 2 500,00 грн». This is the server's sum for
    this store. Among «Магазини, що не працюють» it shows her name alone.
  - The rows are the card's sheet's: what was sold, since when, another
    store's sticker, what is owed with the debt's glyph, and the chevron.
    - Only open debts are read, as the till's list reads them.
    - None is chosen beforehand.
  - A refused read again puts the warning's plate over the rows as they
    were. Gone means every debt was paid meanwhile. Then the sheet closes,
    and the list under it is read again without her (review).
  - A debt tapped opens S21 on it. Its «← До боргів» goes back to the list
    with no sheet over it, and S22's way back has the same name.
  - Telegram's «Назад», Escape, the scrim and the handle close the sheet.
  - The old screen is gone.
  - Four taps for a payment on one of two debts: «Внесок», her row, the
    debt, a way.
- **Write refusals** (P2-5; owner, В-П1 (б)): what happened, the fate,
  the step:
  - the till: «Дані змінилися, поки ви працювали. Кошик збережено — нічого
    не продано. Натисніть спосіб оплати ще раз.»;
  - a return: «Дані змінилися, поки ви працювали. Поверніться до списку й
    відкрийте продаж знову. Нічого не повернено.» and «Перевірте, що
    повертають. Нічого не повернено.»;
  - a payment: «Внесок не записано. Дані боргу змінилися, поки ви
    працювали: перевірте залишок.» and «Внесок не записано. Перевірте
    суму.» (a write-off «… причину.»);
  - erasing: «Дані покупця не стерто.» and «Дані покупця не стерто: борг
    щойно змінився — перегляньте його.».
  - A refusal naming nothing at all (a 400 or 404 without words) says the
    fate, then what to check. This is batch 10's rule for «Початкові
    залишки».
  - A server failure on erasing gives «Дані покупця не стерто. Натисніть
    ще раз — повторити безпечно. Номер запиту: …».
  - A return to a warehouse closed meanwhile says «Склад, куди йшов цей
    товар, закрито. Зверніться до менеджера.» (review).
  - One helper, `failedWrite` in `frontend/src/shared/api.ts`, now does
    this for the till, the return, the debt and «Початкові залишки».
  - The kept operations' words do not change (owner). Each was compared
    with main for every kind of answer.
- **P2-3's words**:
  - «Знайти в каталозі» says «На складі «…» його немає в обліку.» alone.
  - Both ways back from it say «До списку».
  - The label's chip shows «Не читали», and a reader hears the whole
    words.

## The independent review

An independent reviewer read the diff against `main` with the TZ, the
owner's answers and the decisions above. It ran the type check and ESLint,
not the journeys. It saw P2-3's words arrive mid-review and did not read
them. It found one medium, one low–medium, two low and three nits.

Settled:
- **A customer paid off meanwhile stayed on the list, and her row opened
  nothing** (medium).
  - The old screen remounted the list on its way back, which read it
    again. The sheet leaves the list mounted.
  - The sheet's read found her gone and closed, but her row stayed. Tapped
    again, the cached empty answer closed the sheet at once.
  - Fix: on gone, the sheet forgets its read and the till's list is read
    again.
  - The journey now answers the list without her and expects her row gone.
- **A return to a warehouse closed meanwhile would have said to check the
  goods** (low–medium). The server names it `WAREHOUSE_UNAVAILABLE` in a
  404, which the shared words call a failure. It says the kept return's
  words for it now, and a journey presses into it.
- **«The cursor goes back to her row»** (low): only where a keyboard or a
  reader had it there. A tap on iOS focuses no button, as on the card's
  sheet. The words in business-rules.md now say so. No fallback was added:
  a cursor sent to the search field would open the phone's keyboard.

Seen and kept:
- The phone's own failure at the till, before anything is sent, still
  says the shared words. The case is `crypto.randomUUID` missing, and
  `outage.spec.ts` pins it. Batch 10 decided the same, and pressing again
  would not help that phone. This is named for the owner below.
- The 5xx branch of `failedWrite` cannot be reached for a sale, a return
  or a payment (nit). Those are kept on the phone when the server fails;
  only erasing is sent directly.
- After erasing's 5xx, «Натисніть ще раз» means ⋯ and «Стерти дані
  покупця» again, because the confirmation is closed (nit; batch 10's
  words).
- The return list's plate for a read refused with a conflict or a request
  not taken says the return's new words too (nit). The plate has its own
  «Спробувати ще раз».

## How it was built and proven

**Code:**
- `frontend/src/credits/Debts.tsx`: the sheet. It was the screen.
- `frontend/src/credits/Credits.tsx`: the sheet over the list. S21's
  «←» from the till is always «До боргів».
- `frontend/src/sales/Sale.tsx`, `frontend/src/returns/Returns.tsx`,
  `frontend/src/credits/Debt.tsx`: the pressed refusals.
- `frontend/src/shared/api.ts`: `failedWrite`.
- `frontend/src/openings/types.ts`: `listRefusal` on it, unchanged in
  behaviour.
- `frontend/src/cash/errors.ts`: the kept return's 422 kept by a branch of
  its own.
- `frontend/src/sales/FromCatalog.tsx`, `frontend/src/sales/Sale.tsx`:
  P2-3's words.
- `frontend/src/styles.css`: `.debts-line`.
- No backend change.

**Journeys:** 1063 in all; 1057 before.
- New in `credits-debt`:
  - her two debts at the till: four taps, the one line and its pencil,
    the rows, none chosen, the sheet's colour, radius and height in both
    themes, «← До боргів» and S22's way back to the list;
  - the sheet's read refused, then gone: the plate, the list read again
    without her, only open debts asked for;
  - «Магазини, що не працюють»: her name alone, the store on each row.
- New in `telegram-back`: «Назад» shown with the sheet; pressed, it closes
  the sheet, and the till hides it again.
- New in the refusal table: a payment's and a write-off's unnamed 400.
- Changed:
  - `credits` (two debts on one phone in the sheet, Escape; erasing's 5xx
    and conflict);
  - `till-money-words` (the conflict's step, an unnamed 400);
  - `returns-sale-screen` (the conflict, the request not taken, an unnamed
    400, a closed warehouse);
  - `till-two-warehouses` (the catalogue's one line, its own «До
    списку», and the till's);
  - `size` (the chip's «Не читали»).

## Mutants

`~/.cache/birka-runtime/helpers/mutate41.py` has 31 mutants. Each one
undoes one thing this batch made. `mutants41.sh` ran each against the
journeys that should catch it, on a fresh seed each time.
- **The sheet:**
  - the sheet never shown;
  - `chosen` kept after a debt was chosen;
  - the line's sum gone, or shown among the stores that do not trade;
  - the line not read with the title;
  - the line in ink;
  - the sheet still open when her debts are gone;
  - the list not read again after that;
  - no plate for a refused read;
  - every status asked for;
  - another store not heard on a row;
  - no glyph by what is owed;
  - the list not named by her.
- **The refusals:**
  - the till's conflict with «Спробуйте ще раз» again, without its step,
    or with no rule for a refusal naming nothing;
  - the return's conflict and its request not taken with the old words,
    no rule for a refusal naming nothing, no words for a closed warehouse;
  - the kept return's 422 changed with the pressed one;
  - a payment's conflict, a write-off's request not taken and an unnamed
    400 with the old words;
  - erasing's conflict with the old words, and no rule for its 5xx;
  - `failedWrite` with no 5xx branch, or without its check.
- **P2-3's words:** the catalogue's two sentences, «Назад до списку», the
  chip's whole words.
- **31 caught.** The first pass caught 24 of 31.
  - Six ran no journey: their grep's «?» was read as a regex, and it
    matched no title. They are escaped now and all six were caught.
  - One survived: the catalogue's own «Назад до списку». The journey
    pressed the till's other way back. It now checks the catalogue's
    button too, and the mutant is caught.
- Logs: `go-mutants41-first.log`, `go-mutants41-second.log`.

## Evidence

- **Type check, ESLint, build:** `tsc --noEmit` and ESLint on every
  touched file are clean. `npm run build` built. The e2e type check's
  errors are main's own (48 before and after).
- **The touched journeys,** on a fresh seed:
  - 13 of 15 first. Both were the journeys' own fault. One tapped the
    sheet's retry before the sheet takes taps; it now waits for
    `data-ready`. One reloaded under an open sheet; it now closes the
    sheet with Escape.
  - The affected spec files whole (credits, returns, the till's words,
    Telegram's «Назад», stores, «Початкові залишки» and outage): 315 of
    315.
  - P2-3's: 46 of 46.
  - After the review's fixes: 7 of 7.
- **Every journey:** 1062 of 1063 on a fresh seed, one worker, in 29.1 minutes
  (`b11-full.log`). The one is `backups.spec.ts:93`: 14 nights listed where
  it reads 3, because the stand's database keeps every seed's nights (the
  seed is additive), as in batches 7–10. Nothing of this batch touches
  «Резервні копії».
- **Mutants:** 31 of 31 caught (above).

## Not covered

- A real phone, and Telegram's own sheet height.
- No journey checks where the cursor goes after the sheet closes on a
  phone.
- The 5xx words for a sale, a return or a payment pressed: they cannot be
  reached, because those are kept on the phone.
- The other sections' write refusals (the catalogue, stocktake, receiving,
  «Брак», suppliers, stores) wait for their batches, as the owner's answer
  says.

## For the owner

- **Done:** the sale tab's task list is closed.
  - At the till, which debt a payment goes to is chosen in a sheet, as on
    the card. Its one line says who it is and how much she owes this
    store.
  - Nothing in the tab says «спробуйте ще раз» after a write. Each refusal
    says what happened, what became of the basket or the money, and what
    to do.
  - The catalogue's screen says its one line, and the label's chip says
    «Не читали».
- **Decided here; tell us if you want otherwise:**
  - From the sheet, the payment's «← До боргів» goes back to the list, not
    to the sheet.
  - A refusal the screens have no words for says the fate, then what to
    check, as «Початкові залишки» does since batch 10.
  - A return to a warehouse closed meanwhile says «Склад, куди йшов цей
    товар, закрито. Зверніться до менеджера.».
- **One exception remains:** if the phone itself fails before sending a
  sale, the till still says «Не вдалося виконати операцію. Спробуйте ще
  раз.». This happens only on a phone that cannot make a sale's number;
  pressing again would not help there either.
- **Still open from batch 10:** the «Початкові залишки» line that takes
  four lines at 360 px. Keep it, or shorten it?
