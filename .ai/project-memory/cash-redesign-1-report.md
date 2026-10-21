# «Каса»: the close under the approved design — 2026-10-21

Baseline: `f51cf31` (main, with #118), and «Каса»'s task list
(`107dc81`, [redesign/2026-10-21-redesign-tz-cash.md](redesign/2026-10-21-redesign-tz-cash.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-two of twenty-two ways of breaking it caught. Not yet tried on a
real phone.
Branch: `feat/cash-close`. Tasks: P0-1, P0-2, P0-3. Owner: business-rules.md,
"«Каса»'s task list: five questions, and what first" (2026-10-21).

## Why this was next

«Борги»'s task list closed with #117, and the owner chose «Каса» next: the
last button of the counter without a task list. Its audit found the close —
the day's one task at «Каса» — under four warnings of small print, the
count's field and its button in the middle of the page, and the result one
sentence where the notebook has three figures. The owner answered the five
questions as recommended and chose the close first, its three tasks
together.

## What exists now

- **«Каса» opens on where the drawer stands, in one line,** and the count as
  one large dark card: «Закрити касу» / «Скільки мало бути — покажемо після
  підрахунку». Under it the other tasks as rows, each with what it is for;
  cash moved since the close a row each, «−150,00 грн» on the right. No
  reminder, no «Оновити», no sum before the count.
- **The count is a screen of its own:** one large field, the cursor in it;
  «Спершу запишіть видане з каси», «Поки рахуєте, не продавайте.» and «Спершу
  внесіть усе з паперу й перевірте, чи нічого не чекає на інших
  телефонах.»; «Закрити касу» and its confirmation in the panel under the
  thumb. Still four taps and the sum; what is sent is as before.
- **The result:** «Касу закрито», «Мало бути» and «Порахували» large, the
  shortage or the surplus in a warning's colour, «Збіглося до копійки» in
  the accent; the card and the transfer as rows; the reason, when one is
  owed, with its button under the thumb; then «Готово». A buzz when the
  close is recorded or refused.
- **The sellers' page** says what to do with cash taken out during an
  outage (В5).

What is sent, the money and the rules are unchanged; no migration.

## Decided here, not by the owner

- **«Змінити спосіб оплати»** for the seller's own and the manager's any
  operation, as the task list's words: one word for one action — the
  manager's screen's heading too.
- **«Мало бути» and «Порахували» one under the other,** not side by side: at
  360 px two sums of 34 px break across lines.
- **The dark card is the text's colour in either theme:** in the dark one it
  is light. To be confirmed.
- **No «До каси» under a refused count:** the screen's own «← Каса» is there.
- **A close confirmed later** shows the same result screen as one answered.
- **«Спершу запишіть видане з каси»** is a quiet line in the accent's colour,
  so the field, the reminders and the panel stand together at 360×640.

## How it was built and proven

- **`cash.spec.ts`** (the real API, the seller's day): the take-out's row,
  «Витрати · пакети», its time and person, «−150,00 грн»; blind until the
  count; «Каса», the card — the drawer read again — «Підрахунок каси», the
  sum, «Закрити касу», «Так, закрити»: five keys sent as before; «Касу
  закрито», «Мало бути» 2 050,00 грн and «Порахували» 2 000,00 грн,
  «Нестача 50,00 грн» a warning; the card's row with its parts and «звірте
  з чеком терміналу», the transfer's; the reason owed across reopening, then
  written, «Готово», and the day's close compact under «Сьогодні закрито о
  …»; the blocked store's first count, «Перший підрахунок записано».
- **`cash-close.spec.ts`** (the drawer stubbed): above the first row only the
  heading, the line and the card at 360×640, the seller's two rows and the
  owner's four, each by what it is for; the card's read naming a close made
  meanwhile; the cursor in the field, an empty or unreadable sum sending
  nothing, 0 a sum, «Скасувати» keeping it, the panel's button 54 px at the
  bottom; the field, the reminders and the panel together at 360×640; cash
  out from the count and back with the sum; the figures the server's, a
  surplus a warning, to the kopeck the accent; the first count one figure; a
  reason owed under the thumb, the cursor not in it, «← Каса» and back to
  it from «Записати причину», «Каса»'s rows open meanwhile; one buzz for a
  refusal and one for the close, none for a close kept and confirmed later;
  four taps counted from «Каса» to the close's request; the server out of
  reach at the card's read — no count, «Касу зараз не закрити …»; a sum
  typed not kept once the count is left; «2000,» never said to be wrong;
  the focus on «Так, закрити» and back; the owner's close with the period's
  figures, the seller's without; both themes at 4.5:1, screenshots.
- **`outage.spec.ts`:** the paper's reminder on the count's screen, the quick
  reasons; a close whose answer was lost held in «Каса»'s banner.
- **Related journeys:** 202 — debts, the drawer's two specs, the outage,
  the counter's sections, the receipt, text from outside, failures and the
  till — passed with it.
- **Mutation:** twenty-two ways of breaking it, one at a time, each against
  the journeys meant to catch it, after the unchanged tree passed: all
  caught. A first run, before the review's fixes, caught sixteen of
  seventeen: the reason's field taking the cursor changed nothing, the
  result's heading taking it after — so that focus is broken instead, and
  caught (`output/verification/2026-10-21-cash-close/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found the close's body byte for byte as before, every figure the
server's, no sum before the count, the new words without a gender, every
colour at 4.5:1 in both themes, the stubs the server's shapes. It found the
following, all addressed before the first commit:
- **The count opened while the server did not answer:** the card's read
  failing kept the old drawer, and a close could be sent where «Каса» says
  not to close (G26). The count opens on a fresh read alone now, and is left
  when the drawer can no longer be read or no longer asks for it; the panel
  waits while it is read.
- **A reason owed held «Каса»'s own tasks,** where it holds only the other
  tabs (G12): «← Каса» leads back now, and «Каса» shows the close waiting
  with «Записати причину».
- **The reason's form lost its key to the close owed,** so a second close
  owed could take the first one's words: keyed again, and the close whose
  reason was just written no longer owed while the drawer is read again.
- **A typed sum was kept after the count was left,** to be confirmed later
  with a new moment (G31): kept only on the way to cash taken out now.
- **The result named neither its day nor its store;** a close that could not
  be read waited for ever; the reason's button did not stay under the thumb
  below the owner's figures: each fixed.
- **Smaller:** the focus follows the confirmation; «2000,» is not said to be
  wrong; the sum confirmed is large; «← Каса» is «Назад до каси» to a
  screen reader, never a second «Каса»; the banner after the heading; the
  card's corners as the direction's; a journey's read that raced «Каса»'s
  own; the taps counted; a kept close's buzz, and the owner's figures,
  proven; the ADRs' quoted words noted.

**For the owner,** not decided here:
- the dark card in the dark theme: light, as built, or a dark surface;
- the manager's and owner's «Каса», drawn after the seller's — the task list
  asks it be confirmed;
- «Мало бути» and «Порахували» one under the other; no «До каси» under a
  refused count; «Змінити спосіб оплати» the manager's word too.

## Evidence

- [`output/verification/2026-10-21-cash-close/`](../../output/verification/2026-10-21-cash-close/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `b8374b8`** ([summary](../../output/verification/2026-10-21-cash-close-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 458 on PostgreSQL 17;
  - e2e: 494 journeys;
  - hot path: worst p95 91.1 ms (the search by six sellers) and 104.7 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the keyboard over the count's field and the panel, and
  over the reason (С2, С3); the time of a close.
- **P1-1** (a kept drawer command named by what and how much, В2, В3), P1-2
  to P1-4 and P2: next.
- **«Закриття»** (the owner's history) keeps its present look until P1-4,
  its period's table on the drawer's own class.
- **A close of another store, owed a reason,** named on the result: built,
  no journey reaches one.
