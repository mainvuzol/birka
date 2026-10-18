# «Борги»: one debt, and its payment under the thumb — 2026-10-18

Baseline: `5cc9da1` («Борги»'s list, PR #106).
Status: built, reviewed and proven: the whole CI run locally passed, and
seventeen of seventeen ways of breaking it caught. Not yet tried on a real phone.
Branch: `feat/credits-debt-payment`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P0-3, P0-4. Owner: business-rules.md, "«Борги»: five readings after #106,
and what next" (2026-10-18).

## Why this was next

After #106 the owner confirmed its five readings — the customer card among
them — and chose the debt and its payment. A debt opened under «Борг» and
«До списку боргів», the customer's name a third heading down; what was
owed stood last in a table of five lines of one weight; writing off and
erasing stood between the payment and the history; every history line was
one long sentence. The payment's sum and its three ways sat inside the
form after the table, nothing kept under the thumb; «Увесь залишок» stood
in their row as a fourth way; an empty sum was refused only once pressed;
and from paper the band's «на терміналі нічого не проводьте» was said
again under the buttons.

## What exists now

- **One debt** (P0-3):
  - the customer's name as the heading, and one line: their phone, to
    call, the goods («+ ще 1» for the rest), and since when;
  - «Винні» and what is owed, large, in the debt's colour — the server's —
    a bar of how much is closed, and «Сплачено 1 500,00 грн з 3 000,00 грн»,
    with what came back or was written off only when anything did;
  - a closed debt: «Сплачено» or «Списано» by what it means, and «Закрито
    14.10»;
  - another store's: «Продано в «Ринок» (заблоковано). Внесок приймаєте
    ви, борг — за «Ринок».», once;
  - the history a row an entry: «Внесок · готівка», under it «01.10, 13:00
    · Оля», another store's «прийняв магазин «Центр»», a return's money
    back, the sum on the right;
  - writing off and erasing, the owner's, after the history.
- **The payment** (P0-4):
  - its sum under what is owed, named in the field, with «Увесь залишок»
    beside it, which fills it without opening the keyboard;
  - a panel under the thumb: «Внесок 400,00 грн», or «Впишіть суму
    внеску», or for a sum it cannot read «Вкажіть суму внеску з точністю
    до копійок.»; «Готівка», «Картка», «Переказ», none pressable without a
    sum; from paper «З паперу · …» and one line «Хто прийняв: Ганна»;
  - more than is owed, a refusal, or what was done, brought into view
    above the panel, each time it is said;
  - «Вношу внесок з паперу» under the sum, a group of its own; the band of
    paper as it was.
- **The way back:** «← До боргів» to the list; a debt opened from a
  customer's card leads back to the card, by their name.

What is sent, the money and the rules are unchanged; no migration. The
result of a payment is the paragraph it was, until P0-5.

**Also, asked for in the session: the till's size journeys made
independent** (`size.spec.ts`). The first two local CI runs of this
branch, at `1a105f9`, failed «when the till cannot see the coats without a
size…», which passed on a fresh local database and on main. Two causes:
- **A race in the journey's own stub:** it read the M it sells beyond from
  whichever warehouse's list came back last; with the debt's journeys run
  before it, that was the till's other warehouse, and the till asked to
  clarify two coats where one was left. It reads «Старі залишки» alone now.
- **Shared leftovers:** the three journeys that sell coats without a size
  used the seed's three coats and its one M, in order, and could not run
  again or alone. The one that sells an M beyond the ledger brings its own M
  in; the seed holds thirty such coats — nothing but a list brings one in,
  so a test cannot add its own; and a shelf used up says to seed again.

## Decided here, not by the owner

- **«← До боргів»,** not the task list's «← Борги», which would name a
  second button like the tab; from a debt in a card, the customer's name.
- **The sum named in its field,** and the large sum at 34 px, not 40, so a
  usual debt's sum and ways are seen at 360 × 640 without scrolling.
- **«Вношу внесок з паперу» under the sum,** where the till and
  «Повернення» put it above.
- **«Сплачено X грн з Y грн»,** each sum in its own form.
- **«прийняв магазин «Центр»»,** kept from before: the store took it.

## How it was built and proven

- **`credits-debt.spec.ts`** (stubbed; 360 × 640 and 740):
  - who and what in one line, the phone to call; what is owed the
    server's, on purpose no sum of the others; how much is paid, of what,
    a return; the history's rows, their whats, metas and sums; the panel
    never hiding the last row; writing off after the history;
  - a usual debt: its name, line, what is owed, the sum's field, «Увесь
    залишок» and the ways in view, none under the panel;
  - written off and returned said only when they are;
  - the ways disabled without a sum and with «0»; a sum not to the kopeck
    said in the panel; «Увесь залишок» filling what is owed, the keyboard
    closed; the panel's sum what is sent, the body as it was;
  - more than is owed, tapped with the page at its top, said above the
    panel and nothing sent; a write-off at the end of a long history said
    where it is seen;
  - a closed debt, how and when, no payment; another store's, once;
  - both themes at 4.5:1 or more; screenshots.
- **On the real API:** `credits.spec.ts` (a payment from the list to
  settled, with its history; two debts of one customer, back to the card
  by their name; more than is owed, read again; writing off and erasing),
  `stores.spec.ts` (a closed store's debt, «прийняв магазин «Центр»», what
  is owed), `outage-mark-debts-returns.spec.ts` (from paper: the band's
  words once, «Хто прийняв: Ганна» in the panel, «З паперу · Внесок 300,00
  грн»).
- **The size journeys:** the third alone and first; all six five times
  over on one seed (30 passed); the shelf drained on purpose, the last four
  failing with «No coat without a size is left on «Старі залишки»: the
  seed's are used up. Seed the E2E database again.»; the whole suite on a
  fresh seed.
- **Mutation:** seventeen ways of breaking it, one at a time, each against
  the journeys meant to catch it, after the unchanged tree passed: all
  caught on the first run
  (`output/verification/2026-10-18-credits-debt-payment/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found the money sent unchanged, every sum the server's, the check of
more than is owed, paper's gating and the permissions as they were, and the
moved code identical. It found the following, all addressed before the
first commit:
- **A sum the field could not read** — «1 500», «12,345» — left the ways
  dead with nothing said: the panel says it now.
- **A history line of another store** read «Оля · прийняв «Центр»», a verb
  of the person: «прийняв магазин «Центр»» again.
- **What was done, a write-off at the end of a long history, was off
  screen,** and a refusal said again in the same words was not brought back
  into view: both are now.
- **The way back from a debt in a card** said the list and led to the card:
  it says the customer's name.
- **Smaller:** the paper switch a group of its own; the panel before the
  owner's rare actions for the keyboard; the field's hint in the theme's
  colour; a race in a test; stubs whose sums agreed, so a phone summing them
  would have passed; a check of the paper's words that matched the old
  screen too.

**For the owner,** not decided here:
- the way back: «← До боргів», or «← Борги» as the task list says;
- the sum's field: named in it, or a visible label, one more line;
- «Вношу внесок з паперу»: under the sum, or above it as at the till;
- the debt names its first goods and «+ ще N»; the old screen named them
  all — whether all are to be read on the debt.

## Evidence

- [`output/verification/2026-10-18-credits-debt-payment/`](../../output/verification/2026-10-18-credits-debt-payment/):
  `mutants.py` and `mutants.txt`; the debt at 360 px, light and dark
  (`credits-debt-*.png`).
- **CI, run locally at `14162a5`** ([summary](../../output/verification/2026-10-18-credits-debt-payment-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap. Two runs before it, at `1a105f9`, failed one journey of the
  till's, «when the till cannot see the coats without a size…» — the race
  above; on main it passed.
  - backend: 3 455 on PostgreSQL 17;
  - e2e: 426 journeys;
  - hot path: worst p95 91.5 ms (the search by six sellers) and 104.7 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** the panel and the keyboard over the sum's field in
  Telegram's own web view (С7); a call from the phone link (С6).
- **A heavy debt at 360 × 640** — another store's notice, a return, two
  goods — brings its sum's field under the panel until it is scrolled.
- **Not measured:** the taps and the time of a payment on three sellers.
- **The rest of the task list:** the payment's result (P0-5), and P1, P2.
