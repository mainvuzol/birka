# «Каса»: its own words, its places while read, a warning — 2026-10-22

Baseline: `a8acce1` (#124, «Закриття», on main `d8ed022`), and «Каса»'s task
list ([redesign/2026-10-21-redesign-tz-cash.md](redesign/2026-10-21-redesign-tz-cash.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
eighteen of eighteen ways of breaking it caught. The words wait for the
owner at delivery; not yet tried on a real phone. Stacked on #124.
Branch: `feat/cash-polish`, stacked on #124. Tasks: P2-1, P2-2, P2-3.
Owner: business-rules.md, "after #124 was opened" (2026-10-22).

## Why this was next

The owner approved «Закриття» and chose the three small tasks together.
«Каса» still said an order's words for a refusal it did not name («Оновіть
замовлення», «поточний статус замовлення»), could say «Немає доступу до
каси», showed «Завантажуємо касу…» in the place of its screen — which then
jumped — and a server that did not answer in a debt's red.

## What exists now

- **«Каса»'s own words for a refusal it does not name:** «Не записано: дані
  каси змінилися, поки ви працювали. Спробуйте ще раз.», and for a request
  not taken what it holds — a sum, a sum and a note, a reason, an
  explanation; a note it cannot keep; a kept command the server says
  changed, still unconfirmed by its own name — or, proven unrecorded, what
  was not and to send it again. A refusal «Каса» names says why, as before.
- **«Немає доступу до каси.» is gone:** the right gone while «Каса» was open,
  it shows nothing, as «Борги».
- **«Розмін»** for cash put in; **«← Каса»** on the owner's and managers'
  correction.
- **Grey places while «Каса» is read:** the drawer's line in its own slot,
  the card in its own size where it will stand for whoever may close, two
  rows; an operation; a close's day and figures; the lists. A screen
  reader hears the words that were there before.
- **The drawer that cannot be read** is a warning's plate; hints 14 px.

What is sent and the money are unchanged; no backend change, no migration.

## Decided here, not by the owner

- **The words** above, as the task list proposed them — to be confirmed at
  delivery; «Розмін» for «Внесено в касу (розмін)», as §9 asks of its row.
- **A kept command refused, proven unrecorded, for what «Каса» does not
  name:** «… не записано. Дані каси змінилися, поки сервер не відповідав.
  Спробуйте ще раз.», or «Сервер не прийняв запит. Спробуйте ще раз.», as
  «Борги» says it.
- **The places are sized by hidden text,** as «Магазину винні» is: the
  drawer's line wraps where the one it stands for will.
- **«Перевірте …» by what was sent,** never «суму» where there is none;
  **a note the server cannot keep** in words of its own.
- **The card's place only for whoever may close;** whoever opens «Каса»
  after today's close sees it go.
- **Left:** the server's own «Внесено в касу (розмін)» in what explains a
  close.

## How it was built and proven

- **`cash-polish.spec.ts` (new, stubbed):**
  - «Каса» read at 360×640: «Завантажуємо касу…» heard, not seen; the
    card's place, then the card at the same place and height;
  - «Каса» opened on a kept command: its banner where it stood when the
    drawer comes; whoever may not close: no card's place, no card;
  - the seller's operations, one of them and «Закриття» read: their rows'
    and ways' places, no day's heading, what is read heard;
  - cash taken out and a way changed refused with a conflict, then a
    request not taken: «Каса»'s words — a sum and a note, an explanation —
    no «замовлення» in any alert;
  - a kept take-out answered «changed» with nothing proven: unconfirmed by
    its name, kept; proven unrecorded: «Видачу не записано …», the phone's
    journal cleared;
  - a server that does not answer in both themes: a warning's plate in the
    warning's colour, its words and button at 4.5:1, with screenshots.
- **`cash.spec.ts`** (the real API): the refusals «Каса» names still say
  why — the second close of a day, a fix after the close, an operation from
  before the drawer was counted — which a first version of this change
  replaced with the generic words, and these journeys caught.
- **`cash-move-fix.spec.ts`:** cash put in, «Записано: Розмін, 100,00 грн.»
- **«Немає доступу до каси»** is in no file of the app any more. No journey
  takes the right away while «Каса» is open: the app reads who the person
  is again only when stores change, which never takes «Каса» from whoever
  changes them.
- **Related journeys:** 316 — «Каса» and every screen of it, the receipt,
  the report, debts, returns, the outage and its paper, failures, outside
  text, the till, its places and its sections — passed with it.
- **Mutation:** 18 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 18 caught
  ([`mutants.txt`](../../output/verification/2026-10-22-cash-polish/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that no kept command without proof says «спробуйте ще раз», that
every refusal the server names keeps its words on both the press and the
kept paths, that the manager after three requests not taken still comes,
the placeholders' structure and voice, and the plate's reach and contrast.
It found, all addressed before the first commit:
- **«Перевірте суму» where there is no sum** — a reason, a way changed —
  and «Не записано» for an operation that could not be read. Now by what
  was sent, and a read's own words; the server's «NOTE» named too.
- **The card's place for people whose screen never has the card.** Now
  only for whoever may close.
- **The kept banner and a close's result jumped** when what was read came,
  their lines' places drawn below them. Now in the lines' own slots.
- **Docs claiming more than was built** — every server failure a warning's
  plate, every refusal «Каса»'s own words, «it closes». Narrowed to what is.
- **Smaller:** one take-out named «Видачу» then «Видачу чи внесення»; the
  card's place breathing under reduced motion; a 1×1 element asserted
  out of the viewport.

Not changed, for the owner to hear: the server's «Внесено в касу (розмін)»
in what explains a close; the words above, at delivery as the task list
says. Not reachable today: the right gone while a drawer command is kept
would leave every tab held and «Каса» blank — no journey can bring it about,
the app reading who the person is only when stores change.

## Evidence

- [`output/verification/2026-10-22-cash-polish/`](../../output/verification/2026-10-22-cash-polish/):
  `mutants.py`, `mutants.txt`, and `screens/` — a server that does not
  answer, light and dark.
- **CI, run locally at `7547d6f`** (on #124's `a8acce1`;
  [summary](../../output/verification/2026-10-22-cash-polish-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 461 on PostgreSQL 17;
  - e2e: 543 journeys;
  - hot path: worst p95 93.4 ms (the search by six sellers) and 69.4 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.
  - The run before it, at `7a82531`, failed one backend test only:
    `test_a_limit_under_a_millisecond_is_still_a_limit`, whose 1 ms limit
    cancelled the very statement that reads it on a loaded Mac — the
    second time that day. `7547d6f` takes that cancellation as the proof
    it is; a limit read as off still fails it (broken once by hand to
    see).

## Not covered here

- **On a real phone:** the places while a slow network reads «Каса».
- **Left:** «Каса»'s P2-4 (the manager's correction by day and rows) and
  P2-5 («Каса» at the bottom, with the bottom menu).
