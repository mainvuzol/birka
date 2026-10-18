# «Борги»'s list, and a kept return learned when where it went is lost — 2026-10-18

Baseline: `e04e2f5` (a kept return learned without the right, PR #105).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-three of twenty-three ways of breaking it caught. Not yet tried on a real phone.
Branch: `feat/credits-list`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P0-1, P0-2. Owner: business-rules.md, "«Повернення»: four readings after
#105" and "«Борги» in the new design: its task list's questions"
(2026-10-18).

## Why this was next

After #105 the owner answered its four readings, and the five questions of
«Борги»'s task list, and chose its list first. «Борги» opened on a
paragraph of explanation, two native lists and a «Знайти» button; what the
store was owed stood in small type under them; every customer was a card of
six to ten lines with a button «Відкрити борг …» each, the sale's sum
among them; and the third «Показати ще» asked the server for sixty, which
it refuses above fifty, and the whole list turned into «Перевірте дані та
поточний статус замовлення.». And a kept return whose store no longer
reached the warehouse it went to still held its phone for good.

## What exists now

- **The owner's answers on returns:**
  - a kept return is learned by whoever recorded it also when the store no
    longer reaches the warehouse it went to — the one sold from or the one
    chosen — or the warehouse is closed, or the «Брак» undone: what it
    recorded, or that nothing was, and the phone settles it;
  - when nothing was, it adds «Якщо гроші вже повернули — передайте папір
    менеджеру, щоб внести повернення з паперу.»;
  - a first sending stalled before it claims its key is accepted as a
    risk; the same rule for the other kept operations is in the backlog.
- **«Борги»'s list** (P0-1):
  - «Магазину винні» first, in large type in the debt's colour, with «8
    покупців · 11 боргів» as a person says it;
  - one field, «Ім’я або телефон», searched as it is typed from two letters
    after a pause, Enter at once; a phone however it is written;
  - a row a customer: their initial, name, phone and, with one debt, its
    goods, else «2 борги»; on the right what they owe, as the server summed
    it, in the debt's colour; never a sale's sum or a payment's way;
  - one debt opens at once; more, the customer's debts to choose from —
    what they owe in all, large, and a row a debt, «з 01.10 · останній
    внесок 14.10», read by the customer's phone whatever was searched;
  - «Показати сплачені й списані» and «Борг магазину, що зараз не працює?»
    under the results; a closed store says once who takes the payments;
    nothing found says what was typed, what to try, and «Очистити».
- **«Показати ще»** (P0-2): twenty more at a time by `offset`, never over
  fifty; a customer read twice, when a debt opened meanwhile, shown once; a
  page that cannot be read leaves those read, with «Спробувати ще раз».
- **A search cleared is cleared at once,** at the till, in «Повернення» and
  in «Борги»: what was searched before is never looked for again while the
  seller starts over.

Nothing about money or stock changes; no migration.

## Decided here, not by the owner

- **A customer of more than one debt opens a card** — P0-3's, built with the
  list it is reached from; the debt itself is as it was until P0-3.
- **«Борг магазину, що зараз не працює?» stands under the results,** where
  В2 puts it; how it looks for those debts is as before until P1-1.
- **A customer whose one debt is closed** says on the row how it closed,
  «Сплачено» or «Списано»; of more, «Нічого не винні».
- **A phone in a row is never broken across lines,** nor parted from what
  follows it.
- **On returns:** every refusal of where the goods would go — a store's
  reach, a private warehouse's own rule, a warehouse closed, a «Брак»
  undone, a choice to make again — sends the resend to the recorder's
  answer; the recorder is judged by where it went as recorded, not where the
  store's setup would send it now, so past the days a key is kept too; a
  warehouse closed is named (`WAREHOUSE_UNAVAILABLE`) and reads «Склад, куди
  йшов цей товар, закрито. Зверніться до менеджера.».

## How it was built and proven

- **The server:**
  - `test_returns_elsewhere.py`: a return taken back at another store, an
    intact part and a damaged one, once the store no longer reaches the
    warehouse, its «Брак» undone, or the warehouse closed — answered to its
    recorder past the days its key is kept, a new one refused with
    `recorded: false` and its reason, anyone else told nothing;
  - `test_shared_warehouse.py`: a store that may no longer receive into the
    warehouse — the recorder answered, cached and durable, a new return
    `LOCATION_ACCESS_DENIED` with `recorded: false`, anyone else refused as
    before, nothing moved;
  - `test_private_locations.py`: a private warehouse's own rule — a sale's or
    a transfer's replay refused, a return's recorder answered.
- **The phone** (`credits-list.spec.ts`, stubbed; 360 px):
  - what the store is owed first, its count in every plural; a row's name,
    phone, goods and sum, never «3 000,00» nor a way; nothing between the
    field and the first row; rows of 44 px or more;
  - searched from two letters without a button, Enter, a phone however
    written, one letter for everyone, a word typed at a seller's pace asked
    for once, nothing found and «Очистити»;
  - forty-five customers: limits of twenty, offsets 0, 20, 40, one read
    twice shown once; a page refused, those read kept and asked again;
  - one debt opened at once; two, the card, read by the phone with its own
    sums, its older debt opened and back; a customer gone, the list;
  - the paid and written off asked for, each pill by what it means; the
    switch never showing one mode's rows as the other's while it reads; a
    closed store's customer read among the closed stores, never with a
    number typed before the switch;
  - in both themes, what is owed, the names and the meta at 4.5:1 or more;
    screenshots of the list and the card.
- **On the real API:** `credits.spec.ts`, `stores.spec.ts`,
  `outage-mark-debts-returns.spec.ts`, `outage.spec.ts`,
  `outside-text.spec.ts` walk the new list: a payment, a customer of two
  debts, a closed store's debt by its whole phone, a debt from paper, text
  from outside.
- **Kept returns** (`outage.spec.ts`): the warehouse no longer reached, the
  one sold from no longer reached, the warehouse closed, the «Брак» undone —
  each in its words with the owner's sentence, the till free; a 404 naming
  nothing, the shared words.
- **Mutation:** twenty-three ways of breaking it, one at a time, each against the
  tests or journeys meant to catch it, after the unchanged tree passed: all
  caught on the first run (`output/verification/2026-10-18-credits-list/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found sums only the server's, no sale's sum or way in the list, the
closed stores searched only by the whole phone, the paging matching the
server's, the card's phone read exact, and people with the right answered as
before. It found the following, all addressed before the first commit:
- **A return taken back at another store, once that store no longer
  reached the warehouse it was sold from,** still held the phone: its
  choice was refused only inside the command, before the lookup. It is
  refused before the key is claimed now, and the recorder is judged by
  where the return went as recorded, so past the days a key is kept, and
  with a «Брак» undone, too.
- **«Склад … закрито»** was said of any 404: the server names a closed
  warehouse now, and only that reads so; a «Брак» undone and a choice to make
  again carry the owner's sentence too.
- **A number typed before switching to the closed stores** could be asked
  of them, and a cleared search still filtered for a moment: neither now.
- **Smaller:** the switch of the paid and written off kept in place while
  read; a row's initial taken past invisible marks; the store's sum a
  labelled group; tests for each refusal through the recorder's answer; a
  stub that searched phones unlike the server; a test's name no longer true.

**For the owner,** not decided here:
- the customer card (marked «нужно утверждение» in the task list): «Винні
  всього» large, a row a debt «з 01.10 · останній внесок 12.10», a pill for a
  closed one;
- a row whose one debt is closed saying «Сплачено» or «Списано», not «Нічого
  не винні»;
- «Склад, куди йшов цей товар, закрито. Зверніться до менеджера.», decided
  here;
- a person who lost their right only at a private warehouse answered as a
  store that lost its reach;
- a «Брак» undone, or a choice to make again, also saying what to do with
  money handed back.

## Evidence

- [`output/verification/2026-10-18-credits-list/`](../../output/verification/2026-10-18-credits-list/):
  `mutants.py` and `mutants.txt`; the list and the card at 360 px, light
  and dark (`credits-list-*.png`, `credits-customer-*.png`).
- **CI, run locally at `e99771e`** ([summary](../../output/verification/2026-10-18-credits-list-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 455 on PostgreSQL 17 (three new);
  - e2e: 416 journeys;
  - hot path: worst p95 97.5 ms (the search by six sellers) and 72.7 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** the list, the card and the field in Telegram's own
  web view; a call from the phone link.
- **Not measured:** the taps and the time of a payment on three sellers.
- **Forty-five customers on the real API:** «Показати ще» is proven against
  a stub that pages as the server does; the server's paging by customer is
  proven by its own tests.
- **The rest of the task list:** the debt itself (P0-3), the payment under
  the thumb (P0-4), its result (P0-5), and P1, P2.
