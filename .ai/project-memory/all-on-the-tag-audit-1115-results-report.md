# «Усе на бірці», audit 2026-11-15, batch 4: results in one look — a receipt's and «Продажу немає»'s title in focus at the results' size; a return's stub names what came back; a write-off on the card its own result's screen; the debt left with its arrow in the last four places; «Клієнт забрав» in parts as the receipt — 2026-11-16

Baseline: `07a9a4e8` (main after #217). The results' batch:
- sale P2-1, P2-2, P2-3, P2-4
  (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-sale.md`);
- orders-cash P2-1
  (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-orders-cash.md`).

Picked by «merged, go next».

Nothing recorded, sent or counted changes, and no sum is computed anew:
every sum on these screens is the server's answer, as before. No word on a
screen changes, with two exceptions:
- one sentence is split into two lines;
- a write-off on the card has its own screen in place of a line.

Status: built and proven; not committed; not yet seen on a real phone.
- Touched specs on a fresh seed: 403 of 405 (13 files). Both failures were
  this batch's:
  - S22 drew the arrow in its hidden sentence too, so a sum stood twice in
    its markup. The hidden copy is now plain.
  - A journey expected a model's name without its colour.

  After the fixes, 103 of 103 (`credits`, `credits-debt`,
  `returns-elsewhere`, `returns-sale-screen`, `outage-mark-debts-returns`).
- After the review's fixes: 182 of 182 (the same five, `orders-card` and
  `stores`).
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 34 of 35 caught; the one alive is equivalent (see «Mutants»).
- One independent review; its findings are fixed or left with a reason.
- Journeys: 1171 (1167 before).
- Branch: `feat/audit-1115-results`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-16 (audit 2026-11-15, batch 4: results in one look …)".

## What exists now

- **The receipt's and «Продажу немає»'s title** (sale P2-1):
  - «Продаж записано» takes the focus as the receipt opens, as every other
    result's title does; no field has it, so no keyboard opens.
  - «Продажу немає» is a result's title at the results' size, with no mark
    and no «←», and takes the focus too.
- **A return's stub names what came back** (sale P2-2):
  - First under the perforation, one line per sale line: «Лоран шоколад · M
    × 2». The intact and the damaged of one line are counted together.
  - Under them, where they went, as before.
  - Past three lines, «+ ще N»; a tap shows them all and puts the focus on
    the list.
  - The names are the answer's; the sizes are the sale's, kept as the
    return is settled.
  - A return confirmed later, in its notice, stays compact, with no lines.
- **A write-off on the card is its own result's screen** (sale P2-3):
  - It is S22's screen, as from the debt's detail: «Борг списано» in focus,
    no «←», what was written off on its stub.
  - Its main, named after the customer, leads back to the card, read again.
    «Відкрити борг» is quiet and opens that debt.
  - While it stands, the card under it does not leave by itself. If the
    card has nothing left to show, the main goes on to «Покупці».
  - Back on the card, its title takes the focus.
  - Telegram's «Внесок» is put away while it stands.
- **The debt left, with its arrow, in four more places** (sale P2-4):
  1. S22 for a payment typed from paper, inside the sentence it shows;
  2. a sale in parts confirmed later;
  3. a payment and a write-off confirmed later;
  4. the basket's line for a closed store's debt.

  The words stay, and the reader hears each sentence as before. Nothing
  left, nothing in the debt's colour. The sum stays on one line, at 4.5:1
  or more, on the card and on a notice in both themes.
- **«Клієнт забрав» in parts, as the receipt** (orders-cash P2-1):
  - The stub says «Покупець винен» with the sum as the debt, and
    «Наступні внески — …» on a line of its own.
  - An order opened later has the same two lines, owing what the server
    says is left.
  - The reader hears one sentence, as before.

## How it was built and proven

Sources:
- `sales/Sale.tsx`;
- `returns/Result.tsx`, `returns/Returns.tsx`;
- `credits/Customer.tsx`, `credits/Paid.tsx`, `credits/Terms.tsx`;
- `App.tsx`;
- `orders/Collected.tsx`;
- `styles.css` (`.return-lines`).

New and changed journeys:
- `fixtures.ts`: `expectOwed` also checks that the sum stays on one line
  and reads at 4.5:1 on the first ground under it; given a theme, that the
  debt's colour is that theme's.
- `till-receipt.spec.ts`: the receipt's title in focus.
- `shelf.spec.ts`: «Продажу немає» in focus, at the results' size, with no
  mark.
- `returns-sale-screen.spec.ts`:
  - the four taps' return names its line between the perforation and where
    it went, at 360 with no side scroll;
  - a new journey: four lines, intact and damaged together, «+ ще 1»,
    the focus on the list named «Що повернули», no bullets.
- `returns-elsewhere.spec.ts`: another store's goods named on the stub; the
  kept return's notice lists none.
- `credits.spec.ts`:
  - the card's write-off: its result's screen, its focus, no «←», its stub,
    «Відкрити борг» to the closed debt and its «←» to the card, the main
    named after her;
  - the kept sale in parts and the kept payment: the sum as the debt, the
    notice in both themes;
  - the basket's closed store: the sum as the debt, whole when a long name
    is cut;
  - the collected order in parts: two lines.
- `credits-debt.spec.ts`:
  - written off on her card: back by her name from the result, her card's
    title in focus;
  - a new journey inside Telegram: the card's «Внесок» put away while the
    result stands, the card's read held;
  - a new journey: her last debt written off, the card read again with
    nothing to show, the result stays and its main goes to «Покупці»;
  - the kept write-off: «залишок боргу 0,00 грн» plain.
- `outage-mark-debts-returns.spec.ts`: S22 from paper, the sum as the debt
  once, heard as before, in both themes.
- `outage.spec.ts`: the kept card payment, the sum left as the debt.
- `orders-card.spec.ts`:
  - «Клієнт забрав» in parts: two lines, the sum as the debt in both
    themes, the sentence heard as before;
  - a new journey: an order in parts seen later, owing and settled.

## The review

An independent review (behaviour, money on the screen, the reader, CSS,
tests) found nothing High or Medium. `tsc` and `eslint` are clean.

Checked and found right:
- `owedIn` colours only the sum after «залишок боргу», from the same answer.
  The card's charge sentence, with the same sum, is never coloured. Nothing
  matched, nothing coloured.
- No sum is seen twice.
- Every sentence is heard once, word for word.
- A return's sizes are the sale's, read before it is let go.
- The basket's icon fits the line.

Low, fixed:
- **The card's dock.** It stayed registered while the result stood (outside
  Telegram), and the card's dock was not registered again on the way back.
  It now leaves with the card. No journey shows it: the dock's room is a
  variable, and nothing on these screens moves by it.
- **The focus on the way back to the card** was lost. Her card's title now
  takes it, as a debt's does.
- **Telegram's «Внесок» over the result** was untested. A new journey holds
  the card's read and proves it put away.
- **The kept return's notice**: now proven to list nothing.
- **The dark theme's checks** proved nothing about the theme. `expectOwed`
  now checks the theme's own debt colour when one is named.

Low, left with a reason:
- **A card read that fails while the result stands** brings the card back
  as it was, under the plate saying it could not be read. A payment on the
  closed debt is refused by the server. Seeding the card from the answer
  would need the customer's total computed on the phone.
- **«Що повернули»**, named by the review as new words, is the supplier's
  return's own label (`suppliers/ReturnDetail.tsx`). It is kept, and the
  journey checks it.
- **The result's main is named after her but goes to «Покупці»** when her
  card has nothing left. This is decided here, and a journey shows it.
- **The «one line» check** means little while `.owed-left` keeps its words
  together. It is kept for the basket's long line.
- **The notice's own ground.** The kept notices draw their sum on the
  stub's card, which is what the journeys check. The banner's ground
  computes at about 5.8:1 light and 7.0:1 dark.

## Mutants

`~/.cache/birka-runtime/helpers/mutate64.py`, run with `mutants64.sh` on a
fresh seed. Each mutant is applied, its journey is run once (`pw-slow`, no
retries), and the source is restored.

- sale P2-1: `receiptfocus`, `nothingfocus`, `nothingclass`.
- sale P2-2:
  - the stub's lines: `returnlines`, `returnorder`, `returnsize`,
    `returnunits`, `returnthree`, `returnfocus`;
  - their look: `returnpencil`, `returnpad`, `returnbullets`.
- sale P2-3:
  - the result: `writtenresult`, `writtenname`, `writtenback`,
    `writtendebt`;
  - the card under it: `writtengone`, `cardfocus`, `tgmain`.
- sale P2-4:
  - S22: `paperowed`, `paidshown`, `paidcredit`, `owedzero`;
  - the kept ones: `owedlower`, `owedlowercard`, `keptsale`;
  - the basket: `awayowed`.
- orders-cash P2-1:
  - the stub: `collectedowed`, `collectedowedcredits`, `collectedsplit`,
    `collectedheard`, `linestub`;
  - seen later: `collectedzero`, `lineheard`.

The one left alive is equivalent: `keptlines`, the stub's lines drawn for a
return confirmed later. The kept notice returns before the lines are used
(`returns/Result.tsx`), so nothing is drawn; the guard only narrows the
type for the sale's sizes.

## Not covered

- The look on a real phone, and CI's font (DejaVu) against the Mac's at
  360.
- Telegram's «Внесок» over the write-off's result: outside Telegram no
  MainButton is drawn; the condition is the same as the card's other
  screens'.
