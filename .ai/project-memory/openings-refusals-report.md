# «Початкові залишки»: refusals in its own words — 2026-10-24

Baseline: `5e62161` (#130, on main).
Status: built, reviewed and proven: the whole CI run locally passed at
`d37dbce`, and nineteen of nineteen ways of breaking it caught. Merged as
#131 (`09431ee`); its words approved by the owner on 2026-10-25.
Branch: `feat/openings-refusals`. Asked on 2026-10-24.
Rules: business-rules.md, "«Початкові залишки»'s refusals in its own words".

## Why

A refusal the opening-stock screens did not name fell to the app's shared
words, which speak of an order: «Перевірте дані та поточний статус
замовлення.» for a form the server did not take, «Дані змінилися або
команда конфліктує з попередньою. Оновіть замовлення.» for a conflict —
on a stock list, where there is no order and no «Оновити». It was seen
while the orders' refusals were rewritten (P1-2), and asked for here.

## What exists now

- **Each command says what was not done and what to check:** a new list,
  by its lines or its file; a line's answer; typed lines or a file added or
  removed; a list approved or rejected.
- **A new list sent again while the send before it never answered** never
  says «не збережено»: that one may have made the list.
- **A conflict** says the list changed while the person worked, and the
  screen reads it again.
- **A reject that lost a race,** and **nothing in a list being stock,**
  said as they are.
- **Lines typed past what the server takes at once** — 1 000 lines,
  100 000 characters — said before sending, with where the rest goes.
- **The catalogue's search** takes no more than the server reads (200
  characters), so no read of it can fall to the shared words either.
- **Every answer the screens already name,** and every shared one that is
  not about an order — no server, a session ended, no access — keeps its
  words.

No backend change.

## Decided here, not by the owner

- **All of the words,** for the owner to approve; they follow the screens'
  own («збережено», «додано», «прибрано», «затвердили або відхилили»).
- **«Перегляньте його», not «оновіть»:** a list's view has no «Оновити»,
  and each screen reads the list again itself after a conflict.
- **A removal or an approval refused** says only «Спробуйте ще раз.»: the
  list is read again by itself just after.
- **A reject answered as a conflict of its command** — the list already
  rejected for another reason — is said as one already decided.
- **«Нічого затверджувати»** is said with what to do: reject the list, if
  nothing in it is stock.

## How it was built and proven

- **`openings.spec.ts`** (the real API, each refusal stubbed once for the
  command alone, never its reads):
  - a new list: its form refused, «… Перевірте рядки …»; a conflict, its own
    words and the warehouse read again; 1 001 lines pasted, said, «Зберегти
    список» held; saved, then rejected;
  - a list: a line's answer refused for its form, then a conflict, said and
    the lines read again, then no access in the shared words; typed lines
    past 1 000 lines and past 100 000 characters said and held; refused for
    their form, then a conflict and the parts read again; removed, refused
    for its form and for a conflict; approved, refused for its form, for a
    conflict, and for nothing in it being stock; rejected, refused for its
    form, and as already rejected for another reason; rejected for real;
    the catalogue's search 200 characters at most.
- **`openings-file.spec.ts`:** a file added refused for its form, «Файл не
  додано. …»; a file removed refused for a conflict, «Файл не прибрано. …»;
  a list's send refused while the send before it never answered: «Сервер
  не прийняв цей запит, а чи збережено список попередньою спробою — ще
  невідомо. …».
- **Related journeys:** both opening-stock specs, and those that share the
  catalogue's picker — deliveries, stocktakes, stock, corrections, the
  shelf, the first days' till, the catalogue and models — 88, passed.
- **Mutation:** 19 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 19 caught
  ([`mutants.txt`](../../output/verification/2026-10-24-openings-refusals/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed every command on these screens falling to the list's words, no
more specific text hidden, the shared answers kept, and the words matching
each action. It found, all addressed before the first commit:
- **«Список не збережено» while a send before it may have made the list.**
  Now said as unknown.
- **A reject that lost a race said «не відхилено».** Now as already
  decided.
- **«Оновіть його» asked for what the screen does, or has no button for.**
  Now «перегляньте його», and each screen reads the list again after a
  conflict.
- **A new list's words spoke of the warehouse and of a list not made
  yet.** Now by its lines or its file, with its own conflict.
- **Too many lines pasted were refused with a check that could not be
  acted on.** Now said before sending, with where the rest goes.
- **The catalogue's search could be longer than the server reads.** Now
  200 characters.
- **Gaps in the journeys:** a new list's conflict, a file added and
  removed, an approval's form, a reject's race, nothing to approve, a
  shared answer kept, the stubs' codes. All now covered.

Not changed here: a gateway's 502–504 on a line's answer, a decision or a
part's removal is said as no answer at all, where a new list says it as
unknown — as before; the other screens that still fall to the shared words
(below).

## Left for another change

Other screens whose unnamed refusals still fall to the shared order words:
models (create, merge, rename, retire and restore, a kept catalogue
change), «Брак», a delivery, a stock correction, a stocktake (a count,
start and finish), the suggested price, a store's state, suppliers (adding
one, returns, invoices, borrowed goods), erasing a customer's data, and the
sign-in screen; and the kept receipt and correction commands, whose
unconfirmed words map only a form refused, not a conflict (an order's is
mended by P1-2, `feat/orders-refusals`).

## Evidence

- [`output/verification/2026-10-24-openings-refusals/`](../../output/verification/2026-10-24-openings-refusals/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `d37dbce`**
  ([summary](../../output/verification/2026-10-24-openings-refusals-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 464 on PostgreSQL 17;
  - e2e: 593 journeys;
  - hot path: worst p95 90.6 ms (the search by six sellers) and 70.8 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.
