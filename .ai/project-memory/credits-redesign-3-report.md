# «Борги»: a payment's result, and a payment kept unconfirmed — 2026-10-18

Baseline: `d5282a2` (one debt and its payment, PR #107).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-nine of twenty-nine ways of breaking it caught. Not yet tried on a
real phone.
Branch: `feat/credits-paid-kept`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P0-5, P1-2. Owner: business-rules.md, "«Борги»: four readings after #107,
and what next" (2026-10-18), and В1 (а) of the task list.

## Why this was next

After #107 the owner kept its four readings — «← До боргів», the sum named
in its field, «Вношу внесок з паперу» under the sum — asked for every good
of a debt on a tap, and chose the payment's result and a payment kept
unconfirmed. A payment's result was a paragraph between what is owed and
the form: «Внесок 500,00 грн прийнято карткою. Залишок боргу 1 500,00 грн.»
— for a card nothing said to charge it, for a transfer nothing said to
check it, as the till's receipt does, and nothing buzzed. The form stayed
under it, ready to take the same money again. A payment whose answer was
lost said «Незавершений внесок» and «Невідомо, чи записано попередній
внесок або списання боргу» — neither the sum, nor the way, nor whose — and
«Перевірте результат», where the phone checks by itself.

## What exists now

- **A payment's result** (P0-5), in place of the debt's sum, its form and
  its history:
  - «Внесок записано», focused and in view, heard with its sentence;
  - the way a pill, with what to do, as at the till (В1 (а)): «Готівка»,
    «Картка · Проведіть на терміналі», «Переказ · Перевірте, що переказ
    надійшов»;
  - the sum taken, large; under it «Залишок боргу 1 500,00 грн» or «Борг
    сплачено повністю.» — from the server's answer, never worked out;
  - from paper, never «Проведіть»: the paper's mark as the history says it
    («Внесок під час збою · хто прийняв: Ганна · за папером …», or «Внесок
    з паперу»), «Уже взяли раніше» or «Уже взяли під час збою» over the
    sum, and the sentence as it was, seen;
  - «До боргів» — the list as it was searched — or, for a debt opened from
    a customer's card, their name, back to the card, as «←» says; and,
    quiet, «Відкрити борг» — the debt with its new numbers and history,
    begun at its name;
  - a write-off: «Борг списано» and what was written off, neutral, no pill;
  - a buzz in the hand once the server answers: success when recorded,
    error when refused; a lost answer, and one confirmed later, none;
  - a screen reader hears the sentence it did: «Внесок 500,00 грн прийнято
    карткою. Залишок боргу 1 500,00 грн.».
- **A payment kept unconfirmed** (P1-2):
  - «Внесок ще не підтверджено» («Перевіряємо внесок…» while it asks), and
    which: «Внесок 500,00 грн карткою за «Лоран шоколад · M + ще 1» —
    сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії
    недоступні.»; from paper «Внесок з паперу …»; an attempt kept before
    this, by its sum and way; a write-off, «Списання ще не підтверджено» and
    «Списання боргу — сервер не відповів. Двічі воно не запишеться. …»;
  - the goods are kept with the attempt for these words alone and never
    sent: the payment resent is the one sent, byte for byte; no customer's
    name or phone is kept on the phone (ADR-0015);
  - confirmed later: «Внесок записано один раз» («Списання записано один
    раз»), the same block compact — the way alone over the sum, never
    «Проведіть» as a pill — and the lines it had: «Якщо картку ще не
    провели — …», «Оплату провели під час збою …»; «Зрозуміло»; a screen
    reader hears «Внесок 500,00 грн карткою.» before them, as it heard «Його
    було записано один раз: …» before.
- **Every good of a debt on a tap:** «+ ще 1» after the first opens
  «Товари боргу», a list of them all, which focus moves to.
- **Asked for in the session: the customer's phone** — on a debt and on
  their card — in the theme's accent, the same once called; it was the
  browser's own blue, and in the dark theme its purple.

What is sent, the money and the rules are unchanged; no migration.

## Decided here, not by the owner

- **The result takes the place of the debt below its name and line,** its
  history too, until «Відкрити борг»: nothing to pay again under it, and
  the debt's numbers read once, fresh.
- **Its main button is named as «←» is:** from a customer's card, their
  name, back to the card — where the task list, written before the card,
  says «До боргів».
- **The sentence a screen reader hears is the one it heard;** the eye reads
  the pill, the sum and what is owed. From paper the sentence is seen, as it
  carries «на терміналі не проводьте ще раз».
- **Confirmed later, the way alone over the sum:** «Проведіть» only inside
  «Якщо картку ще не провели» (owner decision, 2026-10-07), since someone may
  have charged it meanwhile. From paper, the mark and its time without a
  name: the attempt keeps who took it by an id alone.
- **The kept banner names the first good and «+ ще N»,** as the debt's
  line does; goods that are not a list of names name none.
- **«Перевіряємо списання…»,** as «Перевіряємо внесок…», while a write-off
  is asked about; and «+ ще N» opens the list once, with no «Сховати».

## How it was built and proven

- **`credits-debt.spec.ts`** (stubbed; 360 × 640 and 740):
  - a result with the server's own «owed», which a phone could not work
    out, and paid in all that is not this payment: the heading focused and
    described by the sentence, the pill «Переказ · Перевірте, що переказ
    надійшов», the sum large, «Залишок боргу 777,00 грн» on its own line,
    no form and no panel under it; «Відкрити борг» reads 777, its name
    focused; «До боргів» keeps the search «Окс»;
  - after a payment and «Відкрити борг», more than is owed is still said
    above the panel, not under it;
  - buzzes with Telegram's bridge stubbed: one success, one error on the
    server's `MORE_THAN_OWED`; a lost answer, and its confirmation later,
    none;
  - «+ ще 1» opens «Товари боргу», focused;
  - a write-off's result in view at the end of a long history;
  - both themes: the goods' link and list, the result's heading, pill, sum
    and what is owed, and the phone at 4.5:1 or more, the phone in the
    theme's accent (the browser's blue reads at 4.5:1 too); screenshots.
- **`credits-list.spec.ts`:** a customer's card, its phone in the theme's
  accent and at 4.5:1, in both themes.
- **On the real API:**
  - `credits.spec.ts`: a payment's result to settled, what is owed on its
    own line; a debt chosen in a customer's card, its result's button by
    their name, back to the card; a payment whose answer is lost named
    «Внесок 700,00 грн переказом за «…»», waited for, learned after a
    reload as «Внесок записано один раз», resent byte for byte, `goods`
    never sent; a write-off's result;
  - `outage.spec.ts`: a kept card payment confirmed later — «Картка» alone,
    «Якщо картку ще не провели …», «Внесок 500,00 грн карткою.» heard;
    from paper, «Внесок під час збою» and «Уже взяли під час збою», no
    «Проведіть»; seven banners — with goods, from paper, without goods,
    goods not a list and no way, goods holding a number, an empty first
    good, a write-off — each in its exact words, `goods` never sent; gone,
    and not merely being checked;
  - `stores.spec.ts` (another store's debt by card: «Картка · Проведіть на
    терміналі»), `outage-mark-debts-returns.spec.ts` (the paper's pill
    «Внесок під час збою · хто прийняв: Ганна»; the first days' «Внесок з
    паперу», no «Проведіть»), `failures.spec.ts`: «Відкрити борг» before
    the history, the new banner's heading.
- **Mutation:** twenty-nine ways of breaking it, one at a time, each against
  the journeys meant to catch it, after the unchanged tree passed: all
  caught. A first run of sixteen, before the review, caught fifteen: what
  is owed after, worked out by the phone, still passed, as the sentence for
  a screen reader held the server's; the line seen is checked alone now
  (`output/verification/2026-10-18-credits-paid-kept/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found the payment's body unchanged, every sum from where it
belongs, the goods kept for the banner alone and never sent, no name or
phone kept on the phone, and the buzzes where they belong. It found the
following, all addressed before the first commit:
- **The panel's room was lost after a result:** «Відкрити борг» brought a
  new panel that was never measured, and a refusal was said under it. The
  room is taken again; a journey proves it.
- **A kept payment confirmed later was not heard by its sum or way,** which
  the old notice said: it is now.
- **The result's «До боргів» led back to the customer's card** for a debt
  opened from it: the button is named as «←» is, by the customer.
- **No journey proved that a lost answer, and one confirmed later, buzz
  nothing:** one does now.
- **Smaller:**
  - the kept notice could have shown the debt's paid in all as the
    payment's sum, were the sum ever missing: its type forbids it now;
  - focus was lost when «+ ще N» or «Відкрити борг» was tapped;
  - the paper's pill was the mark's kind alone, where the task list asks
    for the mark as the history says it;
  - the heading was heard without its sentence;
  - checks that the sentence for a screen reader satisfied however the
    lines seen were broken; a stub whose paid in all was the payment;
  - the banner read every good where it names one, and named an empty one
    as «»;
  - dead class names; and checks that a banner was gone which passed while
    it was still being checked.

**For the owner,** not decided here:
- the result's main button for a debt opened from a customer's card: their
  name, back to the card, as now, or «До боргів», to the list;
- for a card or a transfer, whether the sentence a screen reader hears says
  what to do too («Проведіть на терміналі …»), as a return's result does;
- in the list's row and the customer's card, «+ ще N» stays text in a
  button: whether all goods are to be read there too, or on the debt as
  now.

## Evidence

- [`output/verification/2026-10-18-credits-paid-kept/`](../../output/verification/2026-10-18-credits-paid-kept/):
  `mutants.py` and `mutants.txt`; at 360 px, light and dark, the result
  (`credits-paid-*.png`), the debt (`credits-debt-*.png`) and a customer's
  card (`credits-customer-*.png`), the phone in the theme's accent.
- **CI, run locally at `709f9de`** ([summary](../../output/verification/2026-10-18-credits-paid-kept-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 455 on PostgreSQL 17;
  - e2e: 439 journeys;
  - hot path: worst p95 91.3 ms (the search by six sellers) and 71.7 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** the buzz in Telegram's own web view, where its
  version has haptics, and the result in view over the keyboard as it closes.
- **Not measured:** the taps and the time of a payment on three sellers.
- **The rest of the task list:** P1-1, P1-3 – P1-5, P2; «Борг із зошита»
  (В3) waits in the backlog.
