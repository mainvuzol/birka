# Money in one format, the till's words, its refusals — 2026-10-17

Baseline: `7fe4051` (the first sign-in and the kept sale's banner, PR #95).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-eight of twenty-eight ways of breaking it caught. Not yet tried on
a real phone.
Branch: `feat/till-money-and-words`. Tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P2-1, P2-2, P2-4. Owner: business-rules.md, "money in one format; the till's
words; its refusals" (2026-10-17).

## Why this was next

Three small things a seller reads many times a day. A sum read «12500,00
грн», slower than «12 500,00», and figures under one another danced. One
thing had several names at the till — «без розміру», read as «безрозмірна»
and so a way to sell the wrong coat, beside «розмір невідомий»; «од.»
beside «шт.»; «Клієнт» beside «Покупець»; three ways to say try again. And
a sale refused for a reason the server did not name spoke of an order:
«Оновіть замовлення», «поточний статус замовлення». The owner chose these
next and took the task list's glossary as it is.

## What exists now

- **Money** reads «1 850,00 грн» wherever the app writes a sum, the
  thousands apart by a no-break space, so the figure never breaks across
  two lines; every figure is in even digits. A price is typed as before,
  «1850,50».
- **The till's words** are the glossary's:
  - «Не читали — продати як «розмір невідомий»»; a line sold with the
    label's size from unknown stock, «Розмір з етикетки; в обліку —
    «розмір невідомий»»; the shelf's offer, «Розмір з етикетки — продати як
    M»;
  - counts in «шт.»: «У кошику: 3 шт.», «На місці фактично є, шт.»,
    «Знято з обліку: 1 шт.»; a short shelf, «у кошику 2 шт., в обліку 1
    шт.», and «поза резервом замовлення» when an order holds the rest; a
    word in a sentence stays a word, «частина цих одиниць»;
  - «Покупець сплачує все одразу»; «Спробувати ще раз» where a read
    failed, the catalogue's search too;
  - «Кошик» names only the lines to pay, a group of its own, no longer the
    whole form;
  - a kept sale confirmed, «Продаж записано один раз» / «Разом 3 000,00
    грн карткою.».
- **Where the glossary names screens beyond the till:** the order's card
  («Розмір невідомий», «… за 1 шт.», «покупець винен», «Продаж записано.»,
  «Продаж записуємо, коли покупець забрав товар.») and form («З якого
  складу віддаєте?», «Ціна, грн», «Прибрати», «Покупець забирає
  замовлення…», a coat of unknown size as «розмір невідомий», where it read
  «UNKNOWN»); a return's «за 1 шт.»; the supplier screens' «розмір
  невідомий», where a coat of unknown size read «UNKNOWN».
- **Every banner that said «Нові операції заблоковано.»** — a kept
  delivery, return, payment, correction, count, order, and the drawer's —
  ends «Поки чекаємо, інші дії недоступні.», as the kept sale's does.
- **A refusal the till knows no more of:** a conflict says «Дані змінилися,
  поки ви працювали. Спробуйте ще раз.», a request it could not read
  «Перевірте товар, кількість і ціну.», each with «Кошик збережено — нічого
  не продано.». A kept sale so refused on its resend says «Продаж не
  записано (дані змінилися, поки сервер не відповідав).»: its basket is
  gone, and it is typed from paper. Other screens keep their words.

Nothing about money, stock or who may do what changes. The server's code
is untouched; two of its comments, which said the app prints money as the
bot does, now say it no longer does.

## Decided here, not by the owner

- **Kept as they were:** «Клієнт забрав», an order's status (ADR-0012);
  the kept banners of the catalogue, models, stores, suppliers and stock
  lists, which never said «Нові операції заблоковано»; «Повторити
  завантаження» and «од.» on the screens the glossary does not name.
- **A kept sale confirmed** splits P1-4's «Продаж записано один раз: разом
  …» into its heading and its line, so the glossary's «Продаж записано один
  раз» heads it.
- **The kept banners of every command** that said «Нові операції
  заблоковано.», not only the sale's, end «Поки чекаємо, інші дії
  недоступні.»: they hold the till too.
- **A kept sale's conflict** is not told to try again.
- **The bot's message of a close's difference** is the server's and keeps
  «6100,00 грн»; the owner was told the server does not change.

## How it was built and proven

- **Journeys** (`till-money-words.spec.ts`, 4, the goods and the server's
  answers stubbed):
  - seven coats at 1850,00: «Разом 12 950,00 грн» with a no-break space,
    read by a regex, which is not normalised, and in even digits; the
    price typed «1850,50» stays so, and the receipt says «7 × 1 850,50 грн»
    and «12 953,50 грн»;
  - two lines: «У кошику: 3 шт.», the lines a group named «Кошик», and no
    «Кошик» or «од.» on the screen;
  - a short shelf an order holds: «у кошику 2 шт., в обліку 1 шт. поза
    резервом замовлення.»;
  - a conflict (`IDEMPOTENCY_CONFLICT`) and an unread request (422): the
    till's own words with «Кошик збережено — нічого не продано.», nothing
    of «замовлення», and the basket kept.
- **The journeys before:**
  - 158 sums of a thousand or more read in the new format: strings with a
    plain space, which Playwright normalises, regexes with `\s`; `grn()`
    in the fixtures writes a sum as the app does;
  - every check of an old word reads the new one;
  - six kept banners a journey shows — a delivery, a payment, a return, a
    correction, an order, the drawer's — are seen to end «Поки чекаємо,
    інші дії недоступні.» (`waitsFor()`);
  - a kept sale refused on resend for a conflict says «дані змінилися,
    поки сервер не відповідав»;
  - the order's card «… за 1 шт.», a return's «за 1 шт. · продано 2», and
    the unread label's «Не читали — продати як «розмір невідомий»».
- **Mutation:** 28 ways of breaking it, one at a time, each against the
  journeys meant to catch it on a fresh seed, after the unchanged tree
  passed: all caught on the first run
  (`output/verification/2026-10-17-till-money-and-words/`) — the thousands
  run together or apart by a plain space, proportional digits, each
  refusal and each old word back, the form named «Кошик» or the lines not,
  four kept banners blocked again, the order's words, a return's, and a
  kept sale's conflict told to try again.

## Review

An independent review before the first commit found the money's
arithmetic, the refusals' order and every owner-approved text right, and
the following, all addressed in `5af53d7`:
- **A blocker:** the blind count's check that the seller is not shown what
  the drawer should hold looked for «2050,00», which the app no longer
  writes, so it could not fail. It reads «2 050,00» now.
- **A coat of unknown size read «UNKNOWN»** on an order's card and form and
  on the supplier screens: the server sends the code, not nothing. Now
  «розмір невідомий».
- **The catalogue's search at the till** still said «Повторити
  завантаження»; the order's card and form still said «клієнт».
- **«Продаж підтверджено» kept** departed from the glossary the owner took
  as written: now «Продаж записано один раз».
- **The docs claimed more than the code:** the banners that changed are
  those that said «Нові операції заблоковано.»; the screens that keep «од.»
  and «Повторити завантаження» are named as they are.
- **Smaller:** a kept sale's conflict no longer told to try again; the
  unknown-size refusal «з невідомим розміром», as the owner's text says it;
  the lines a group named «Кошик»; checks that wait rather than read once;
  «the figure never breaks», not «the sum»; old quotes in ADR-0013 and
  comments.

## Evidence

- [`output/verification/2026-10-17-till-money-and-words/`](../../output/verification/2026-10-17-till-money-and-words/):
  `mutants.py` and `mutants.txt`, twenty-eight ways of breaking it, all
  caught.
- **CI, run locally at `74b4857`** ([summary](../../output/verification/2026-10-17-till-money-and-words-ci-local/summary.md)):
  every job passed, the backend with its declared gap.
  - backend: 3 431 on PostgreSQL 17 (unchanged by this work);
  - e2e: 338 journeys;
  - hot path: worst p95 88.4 ms (the search by six sellers) and 73.9 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.
- **The run before it, at `040e95a`** ([summary and log](../../output/verification/2026-10-17-till-money-and-words-ci-local-first/)),
  failed one journey this work did not touch: a kept order reopened was
  checked three times, not two. Its own check on opening was lost, then the
  order list's read answered, and `useAutoCheck` took the server as back
  and checked once more (ADR-0013 §4.3), with the same command. Which comes
  first is timing; the journey now counts at least two, and still checks
  the command is one (`74b4857`).

## Not covered here

- **On a real phone:** the no-break space and the even digits in
  Telegram's own web view, on Android and on iOS, are not tried on a device
  yet.
- **No journey reads:** a coat of unknown size on an order's card and form
  or on the supplier screens; the order form's «З якого складу віддаєте?»
  and «Прибрати»; the catalogue search's «Спробувати ще раз» at the till;
  the orders' failed read; and the kept count's banner. Each is a word, and
  read in the code review.
- **A refusal for unknown-size stock** after a found answer
  (`UNKNOWN_SIZE_STOCK`) is told, as before, as a conflict, now «Спробуйте
  ще раз», though trying again meets the same refusal; rare, and as it was.
- **The bot's money**, «6100,00 грн» in its message of a close's
  difference: a change of the server's, for the owner to decide.
- **«од.» and «Повторити завантаження» beyond the till**, on the screens
  the glossary does not name.
- **В8, «Сьогодні ви продали N шт.»,** decided, not built; P2-5 and P2-6.
