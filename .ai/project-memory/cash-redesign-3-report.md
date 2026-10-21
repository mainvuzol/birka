# «Каса»: cash taken out and a way changed under the design — 2026-10-22

Baseline: `f5993ed` (main, with #121), and «Каса»'s task list
([redesign/2026-10-21-redesign-tz-cash.md](redesign/2026-10-21-redesign-tz-cash.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-nine of twenty-nine ways of breaking it caught. The screens wait
for the owner's approval; not yet tried on a real phone.
Branch: `feat/cash-move-fix`. Tasks: P1-2, P1-3. Owner: business-rules.md,
"three readings after #121" (2026-10-22).

## Why this was next

After #121 the owner kept the built words, added a line to the sellers'
page, and chose P1-2 and P1-3 together. «Взяли 150 на пакети» is one line
in the notebook; in «Каса» it was a radio group nothing was chosen in, a
plain field, a note and «Записати» at the end, its error only after the
press. Changing a way — a card the terminal refused, paid in cash — was a
three-line explanation, quiet buttons «20:05 · Продаж: …», a radio group
and «Так, змінити» in the flow, while the customer waits at the counter.
Neither screen was drawn in the direction: they are built from the task
list and shown for approval.

## What exists now

- **«Видати з каси»:** what for as chips, nothing chosen; the chip puts the
  cursor in «Сума», its figures large; «Видати 150,00 грн» in the panel
  under the thumb. Four taps and the sum, where it was five. **«Внести в
  касу»:** the cursor in «Сума» at once, «Внести 100,00 грн» — three taps and
  the sum. A buzz when recorded or refused; refused, why over the panel,
  the sum kept and the cursor in it; unanswered, the form held under
  «Каса»'s banner with what was typed, to record again if refused, left
  with «Видачу записано один раз: …» if confirmed. From the count, «←
  Підрахунок».
- **«Змінити спосіб оплати»:** the seller's operations a row each — the
  time, «Продаж» / «Внесок» / «Повернення», the goods — never a sum nor a
  way (G32); a day nobody closed by its date. One operation: «Продаж ·
  20:05», its sum large, «Зараз: Картка» as a pill, the ways as the till's
  buttons — an order's five a row each — the one it has now «зараз» and not
  to be chosen, «Змінити на «Готівка»» under the thumb. Five taps from
  «Каса», three from the receipt. The owner's and managers' correction
  takes the same card, and says why it was refused.
- **The sellers' page:** «Натиснули «Видати з каси», а телефон пише «Видачу
  ще не підтверджено» — на папір не пишіть: телефон перевірить сам.»

What is sent and the money are unchanged; no backend change, no migration.

## Decided here, not by the owner

- **The screens themselves,** from the task list: to be approved from the
  [screenshots](../../output/verification/2026-10-22-cash-move-fix/screens/),
  light and dark at 360×640.
- **The chips at 15 px,** so a seller's two kinds stand in one row at
  360 px; the owner's three wrap.
- **The panel without a sum or a way:** «Видати» / «Внести», and «Оберіть
  новий спосіб», not to be pressed.
- **The time in «Продаж · 20:05»** only when the list said it: the
  receipt's way to the operation reads no time.
- **Unanswered, the form stays,** held, with what was typed, **and
  «Каса»'s banner shows on it,** as on the count's — it showed nothing
  there before. **Confirmed while the form is open, «Каса» leaves it** for
  where it came from, its words shown: before, the form stayed open to be
  pressed again.
- **An order's five ways a row each,** as the task list says; the till's
  three a row.
- **An operation of a day nobody closed** says its date, as cash moved
  does on «Каса».
- **«← Підрахунок»** when cash is taken out from the count.
- **A way read again as the one it now has** drops the choice.
- **The owner's and managers' correction** takes the same card; its day
  and list wait for P2-4.

## How it was built and proven

- **`cash-move-fix.spec.ts` (new, stubbed):**
  - «Видати з каси» at 360×640: two chips 48 px or more in one row, none
    chosen, the button «Видати» not to be pressed; the chip pressed, the
    cursor in «Сума»; «150,» still being typed is no error, «150,555» is,
    «0» is not to be sent; the field and the panel together, the button
    54 px; recorded — the words on «Каса», the body as before, four taps, a
    buzz;
  - «Внести в касу»: no chips, the cursor in «Сума» at once, «Внести 100,00
    грн», the body as before, three taps;
  - refused — why over the panel, the sum kept, the cursor in it, a buzz;
    pressed again — a new command, recorded;
  - unanswered — refused on the phone's own check, the form there with the
    sum; pressed again, lost, the server failing the check: held under the
    banner naming it, nothing to press; checked, «Видачу записано один раз:
    Витрати, 150,00 грн.» on «Каса», each resend byte for byte;
  - «Змінити спосіб оплати» at 360×640: the context line, three rows by
    time, kind and goods — the last of yesterday, by its date — no «грн» nor
    a way; the operation's time, sum and
    pill; three ways, «Картка зараз» not to be chosen; «Оберіть новий
    спосіб», then «Змінити на «Готівка»»; the ways and the panel together;
    the body as before, five taps, a buzz;
  - an order's sale at 360 px: five ways a row each, every name within its
    button; refused as changed meanwhile — read again,
    «Зараз: Готівка», «Готівка зараз» not to be chosen, the panel back to
    «Оберіть новий спосіб», a buzz;
  - the owner's and managers' correction: the same card from the day's
    list, «Інша операція», refused — why over the list — and changed;
  - both themes at 4.5:1: the chips, the sum, the button, the rows, the
    card, the ways chosen and not (the way it has now, not to be chosen,
    is not measured), with screenshots.
- **`cash.spec.ts`** (the real API): the receipt's way changed in three
  taps, the card's sum and pill, three ways; cash taken out by chips,
  refused as a close came in between, sent again; the owner's three kinds
  and «Коли?».
- **`cash-close.spec.ts`:** cash taken out from the count, «← Підрахунок»,
  by chip, back to the count with the sum.
- **Related journeys:** 279 — «Каса», its kept commands, close and moves, the
  receipt, the report, debts, the outage and its paper, failures, returns,
  outside text, the till and its sections — passed with it.
- **Mutation:** 29 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 29 caught
  ([`mutants.txt`](../../output/verification/2026-10-22-cash-move-fix/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that what is sent is unchanged (a movement's and a correction's
body, the journal's cut), that money stays in kopecks, that «Коли?», the
courier's hint, an order's ways, `may_change` and `DAY_CLOSED` are kept,
that no sum or way leaks into the seller's list (G32), the words of each
task, the stubs' shapes and the tap counts. It found, all addressed before
the first commit:
- **An order's five ways overflowed at 360 px** in the till's three
  columns, «Накладений платіж» past its button. Now a row each, as the task
  list says, with a journey checking every name fits.
- **Unanswered cash went back to «Каса», losing what was typed,** and a
  refusal on the phone's own check then named neither the sum nor the
  kind. The form now stays, held under the banner, and «Каса» leaves it
  only once the command is confirmed — where before the form stayed open
  to be pressed again.
- **The manager's refused correction buzzed with no reason:** the card
  left, its words lost with it. Now over the day's list.
- **Nothing drove the manager's correction through the new card:** a
  journey now does.
- **Smaller:** the focus after a refusal; «← Каса» that led to the count;
  an earlier day's operation by its time alone; the sellers' page's note,
  the risk register's «closed», and the docs' «back to «Каса»».

Not changed, for the owner to hear: the chips in one row rest on 5 px at
360 px with this font, and a phone's own font may wrap them; a put-in the
phone keeps is not on the sellers' page, which never asks to write one on
paper.

## Evidence

- [`output/verification/2026-10-22-cash-move-fix/`](../../output/verification/2026-10-22-cash-move-fix/):
  `mutants.py`, `mutants.txt`, and `screens/` — cash taken out, the
  seller's operations and one operation's card, light and dark.
- **CI, run locally at `141d702`** ([summary](../../output/verification/2026-10-22-cash-move-fix-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 461 on PostgreSQL 17;
  - e2e: 527 journeys;
  - hot path: worst p95 93.2 ms (the search by six sellers) and 92.6 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the keyboard over the sum and the panel, the chips
  in one row with the phone's own font, and a way changed while the
  customer waits.
- **The way it has now,** drawn not to be chosen, is not measured for
  contrast: the pill says it at 4.5:1.
- **Next:** «Каса»'s P1-4 and the P2 tasks.
