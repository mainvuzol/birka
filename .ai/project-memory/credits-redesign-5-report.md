# «Борги»: a closed store's debt by the number typed, a name by any apostrophe, and a server's error kept unconfirmed — 2026-10-19

Baseline: `9ee97fe` (a debt found by each word, and refusals in their own
words, PR #109).
Status: built, reviewed and proven: the whole CI run locally passed, and
sixteen of sixteen ways of breaking it caught. Not yet tried on a real
phone.
Branch: `feat/credits-closed-store-search`. Tasks: [the debts task list](redesign/2026-10-18-redesign-tz-credits.md),
P1-1. Owner: business-rules.md, "«Борги»: four readings after #109, and
what next" (2026-10-18).

## Why this was next

After #109 the owner confirmed its words and kept the words of two debts
apart, and answered two questions the review raised, each the option
recommended: a name is found whatever apostrophe it is typed with, a Latin
«i» the Ukrainian «і»; a kept payment, write-off or return answered with a
server's error is never told to try again. Next, P1-1:
- **A closed store's debt was a mode chosen first:** «Борг магазину, що
  зараз не працює?» under every store's results, though in a usual day no
  store is closed. It emptied the field, renamed it «Повний номер телефону
  покупця», and asked for the number again, in two lines.
- **«Мар'яна» typed on Android did not find «Мар’яна» written on an iPhone,**
  nor «iрина» with a Latin «i» «Ірина».
- **A kept payment the server failed to answer said «Не вдалося виконати
  операцію. Спробуйте ще раз.»** under «Внесок ще не підтверджено»: read as
  "it failed", a card could be charged again.

## What exists now

- **A closed store's debt, by the number typed** (P1-1; В2 (а)):
  - one field, «Ім’я або телефон»;
  - when it holds a whole number, however written or pasted, a quiet button
    under this store's results for it, and under none, once this store has
    answered for that very number: «Борг магазину, що зараз не працює?
    Шукати за цим номером»;
  - a whole number that owes nothing here says the rule: «За цим номером у
    цьому магазині боргів немає. Внесок приймає магазин, де продали.»; in a
    store that does not trade, the fact alone;
  - a number pasted from contacts, or written with dots or slashes, is a
    phone in this store's search too, as among the closed stores;
  - the tap asks the stores that do not trade for the same number, only
    what is still owed, under «Магазини, що не працюють»; «← У цьому
    магазині» comes back; the number stays in the field both ways; focus
    goes to what each opened;
  - nothing is asked of them before the tap, for a name or for a part of a
    number; a store that does not trade shows no button.
- **A name by any apostrophe:** ' ’ ʼ, and ` ´ ‘ typed in their place, are
  one sign, and a Latin «i» in either case is the Ukrainian «і», in the
  name stored and in the words typed; every other letter as typed.
- **A server's error, kept:** a payment, a write-off or a return asked about
  again and answered by a server's error or a request not found says
  «Внесок ще не підтверджено: сервер не зміг відповісти. Перевірте
  результат ще раз — двічі він не запишеться.» («Списання», «Повернення» …
  «воно»), and the request's number. A 502–504 is the server out of reach,
  with the outage's words; the till's sale, an order's step, the drawer,
  and a refusal as pressed keep theirs.

What is sent, the money and the rules are unchanged; no migration.

## Decided here, not by the owner

- **The number stays in the field both ways,** so «← У цьому магазині»
  reads this store's again, and the button asks again.
- **A number changed among the closed stores into anything else** asks for
  the whole number, in the words it had.
- **No button in a store that does not trade:** it takes no payments.
- **Of the catalogue's folded letters, only the Latin «i»,** as the owner's
  answer named; the catalogue's apostrophes all.
- **A server's error is what the shared words met with «Не вдалося …»:** a
  5xx, a request not found, any other the app has no words for.

## How it was built and proven

- **`credits.spec.ts`** (real API): a number owed at this store, pasted
  from contacts between invisible marks, shows its row, never the rule.
- **`stores.spec.ts`** (real API, a blocked store's debt paid at «Центр»):
  no button without a number; a name and nine digits, typed and entered,
  nothing asked of the closed stores; the whole number pasted between two
  invisible marks — the rule said, still nothing asked; the tap — the
  heading, no «Показати сплачені й списані», the row «Магазин «Ринок»»,
  every ask `status=OPEN`; changed into part of a number there — asked for
  the whole one, nothing more asked; back here, the number kept, the rule
  again; focus on «Магазини, що не працюють», and on «Борги» back; the
  payment by card, its `store_id` «Центр»; in «Ринок» itself, which does not
  trade, its customer's whole number shows the debt and no button, and a
  number owing nothing there the fact alone.
- **`credits-list.spec.ts`:** no button under a usual list; a whole number
  owed here — its row, the button under it; a whole number owing nothing
  here, its answer slow — no button while it loads, then the rule and the
  button under it, nothing asked before the tap; a digit more — no button
  at once, for a number not yet searched; the tap keeps the number; a
  customer of two debts read among the closed stores.
- **Backend:** a debt here found by its number pasted between invisible
  marks, written with dots or with slashes, and by part of it pasted so;
  «Мар'яна» typed with each of six apostrophes finds
  «Мар’яна Коваль»; «василіна» and «ВАСИЛIНА» find «Василiна» stored with a
  Latin «i»; «марияна» nothing. The query's plan, one word and two: the
  store's index, then the words as a filter (`search-plan.txt`).
- **`outage.spec.ts`:** a kept payment answered with a 500 and a kept
  write-off with a 404 — still unconfirmed, their exact words, the number
  where the server gave one, every alert recorded as it is drawn; a kept
  return with a 500 the same.
- **Mutation:** sixteen ways of breaking it, one at a time, each against
  the tests meant to catch it, after the unchanged tree passed: all caught.
  A first run, after the review's fixes, caught fourteen: the check of the
  button while this store's answer loads ran before the number was asked,
  and the check in a store that does not trade before it had answered for
  the number; both wait for the number's own request now
  (`output/verification/2026-10-19-credits-closed-store-search/`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found the closed stores still asked for nothing but a whole phone —
by the server, and by the client's every path — no list carried across the
switch, the folded letters what the owner named, bound as parameters, and
the server's error words reached only where meant. It found the following,
all addressed before the first commit:
- **A whole number pasted from contacts, or written «067.123.45.67», missed
  this store's own debt** — read here as a name, where the closed stores
  read it as a phone — and the new words then said nothing was owed here.
  Both searches read a number one way now; a real journey proves it.
- **The button did not wait for this store's answer:** under its loading,
  its refusal, the rows of a search before, and for a number typed before
  the one shown. It waits for that number's answer now.
- **A store that does not trade, a whole number found nowhere,** asked for
  the phone just typed: it says the fact alone.
- **Focus was lost at each switch:** it goes to what opened.
- **Smaller:** tests that would have passed without the store that does
  not trade, or with the button only under an empty list; the docs said a
  5xx where 502–504 keep the outage's words, and a kept command where only
  payments, write-offs and returns change; the journeys counted as the
  closed store's were the server's errors'.

**For the owner,** not decided here:
- a kept sale, delivery, stock correction, drawer command or order step
  answered with a server's error still says «Спробуйте ще раз»: the same
  rule for them, the sale at least, as it is money;
- a kept command answered again and again with a request not found keeps
  the app waiting, «Перевірте результат ще раз» each time: whether, after a
  few, it says to call a manager;
- a name stored with a letter written in two parts (an «ї» as «і» and its
  dots) is not found by the letter written as one: whether that, too, is
  read as one.

## Evidence

- [`output/verification/2026-10-19-credits-closed-store-search/`](../../output/verification/2026-10-19-credits-closed-store-search/):
  `mutants.py`, `mutants.txt`, `search-plan.txt`.
- **CI, run locally at `4b88442`** ([summary](../../output/verification/2026-10-19-credits-closed-store-search-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 457 on PostgreSQL 17;
  - e2e: 450 journeys;
  - hot path: worst p95 94.6 ms (the search by six sellers) and 108.8 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** the button under the results with the keyboard open.
- **Not measured:** the taps to a closed store's debt on three sellers. A
  number typed first costs what it did — the switch, then the number,
  before; the number, then the button, now; a number searched here first
  is no longer typed again.
- **The rest of the task list:** P1-4 (В3, «Борг із зошита» waits in the
  backlog), P1-5 (В4), P2-1, P2-3, P2-4, P2-5.
