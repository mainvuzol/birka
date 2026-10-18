# A sale found by each word, and a return's own refusals — 2026-10-18

Baseline: `e07a01a` (the other stores offered, a mistake's mending, goods
before Бірка, PR #102).
Status: built, reviewed and proven: the whole CI run locally passed, and
eight of eight ways of breaking it caught. Not yet tried on a real phone.
Branch: `feat/returns-search-words-refusals`. Tasks: [the returns task list](redesign/2026-10-17-redesign-tz-returns.md),
P1-3, P2-2. Owner: business-rules.md, "«Повернення»: three readings after
#102, and what next" (2026-10-18).

## Why this was next

After #102 the owner kept its three readings as built and chose the task
list's two quick wins. The till finds a coat by each word typed, in any
order; «Повернення» looked for what was typed as one piece, so «лоран
шоколад» found the sale and «шоколад лоран» did not — «на касі знайшла, а
тут ні». And a return refused for a reason it knew nothing more of spoke of
an order: «Дані змінилися або команда конфліктує з попередньою. Оновіть
замовлення.», «Перевірте дані та поточний статус замовлення.»

## What exists now

- **A sale is found by each word typed** (P1-3), in any order and letter
  case, however many spaces, literally — every word in the name of one line
  of the sale: «шоколад лоран» finds «Лоран шоколад»; a word missing finds
  nothing; words of two lines of one sale do not add up; «%» is a letter.
  The other stores' search still starts at two letters for the whole query.
- **A return's own refusals** (P2-2): a conflict nothing more is known of,
  «Дані змінилися, поки ви працювали. Поверніться до списку й спробуйте ще
  раз.»; a request the server could not take, «Перевірте, що повертають, і
  спробуйте ще раз.»; with «Нічого не повернено.» as before. A kept return
  refused so on resend: «Повернення не записано. Дані змінилися, поки сервер
  не відповідав. Поверніться до списку й спробуйте ще раз.»

Nothing about money, stock or who sees what changes; no migration.

## Decided here, not by the owner

- **A kept return's conflict says «поки сервер не відповідав»,** as a kept
  sale's does: it changed while the server did not answer, not while the
  seller worked.
- **A kept return refused without the server saying nothing was recorded**
  is an unknown outcome, and keeps the words every journal says of one
  (the established design, `cash/errors.ts`).
- **Words are split on spaces after the query is cut to its hundred
  letters,** as the whole query was cut before; a word typed twice is
  looked for once.

## How it was built and proven

- **The server** (`tests/integration/test_till_returns.py`, against
  PostgreSQL): «колір модель» in that order, the model in capitals with
  extra spaces, the start of the colour and the end of the model — each
  finds the sale; a word missing finds nothing; a sale of two coats is not
  found by a word of each, and is by two words of one; «%» found literally,
  word by word. The other stores' two-letter rule and access tests pass
  unchanged.
- **The query's plan** (`output/verification/2026-10-18-returns-search-words-refusals/explain-sales-search.txt`
  and `explain_sales.py`, the isolated E2E database, 5 093 sales, the
  parameters bound as the app binds them): one word and two make the same
  plan.
  - This store's sales: the store's sales by their index, each sale's
    lines by `ix_sale_item_sale`, the words a filter on those lines;
    0.35 ms.
  - The other stores': every line of the organisation's sales read in
    order, as one word already did, the words a filter; 3–6 ms on 5 093
    lines. This search's cost grows with the network's sales, before and
    after this change alike.
- **The refusals** (`returns-sale-screen.spec.ts`, `outage.spec.ts`): a
  live return refused by a conflict, then by a request not taken, in the
  return's words with «Нічого не повернено.», and from paper «Нічого не
  записано.»; a kept return refused on resend for a conflict, «Повернення
  не записано. Дані змінилися, поки сервер не відповідав. …», and for a
  request not taken, «Повернення не записано. Перевірте, що повертають, і
  спробуйте ще раз.»; no word of an order in what is said.
- **Mutation:** eight ways of breaking it, one at a time, each against the
  tests or journeys meant to catch it, after the unchanged tree passed: all
  caught on the first run
  (`output/verification/2026-10-18-returns-search-words-refusals/`) — the
  whole query one piece again, words of two lines adding up, one word of
  many enough, the letter case mattering, «%» matching everything, a
  conflict or a request not taken in an order's words, a kept conflict said
  to have changed while the seller worked.

## Review

An independent review of the change, on a snapshot, before the first
commit, found the letter case of Ukrainian capitals the same in Python
and PostgreSQL, every kind of space split, `%`, `_`, `/` and `\` taken
literally, who sees what unchanged, and the shared texts replaced only
where nothing more was known. It found nothing to fix before merging, and
these smaller things, addressed before the first commit:
- **The plan read only this store's search,** with values written into its
  text: it now reads the other stores' too, with the parameters bound as
  the app binds them.
- **A word typed twice** became two filters: it is looked for once.
- **A docstring and a comment** said more than was true.
- **Unproven:** a kept return refused for a request not taken, and the
  paper's «Нічого не записано.» with the new words — both proven now.

**For the owner,** not decided here:
- a kept return whose outcome is still unknown, refused for a conflict,
  still says the words every journal says of one, which name an order;
  its own words would need the owner's;
- «о о» passes the other stores' two letters, and searches as «о»: the
  rule counts the whole query, as the task list says; a word of two letters
  could be asked instead;
- «Повернення не записано. Дані змінилися, поки сервер не відповідав.
  Поверніться до списку й спробуйте ще раз.» was decided here; it may show
  over the till as well.

## Evidence

- [`output/verification/2026-10-18-returns-search-words-refusals/`](../../output/verification/2026-10-18-returns-search-words-refusals/):
  `mutants.py` and `mutants.txt`, eight ways of breaking it, all caught;
  `explain_sales.py` and `explain-sales-search.txt`, the plans.
- **CI, run locally at `31a709c`** ([summary](../../output/verification/2026-10-18-returns-search-words-refusals-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 447 on PostgreSQL 17 (two new);
  - e2e: 391 journeys;
  - hot path: worst p95 91.3 ms (the search by six sellers) and 103.4 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **A real store's sales:** the plan is read on the E2E database's 5 093
  sales; years of a network's sales are not measured, and the other
  stores' search reads every line of them, as it did.
- **The rest of the task list:** P2-1 (one set of words), P2-3 (skeletons
  in the list), P2-4 (pills by meaning, the dark theme of the returns
  screens).
