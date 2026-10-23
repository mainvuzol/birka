# «Замовлення»: the list by what is to be done, and a cancel asked first — 2026-10-23

Baseline: `8dda082` (#126, «Каса»'s correction, on main `14dff48`), and
«Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty-eight of twenty-eight ways of breaking it caught. The list's new
places wait for the owner's approval; not yet tried on a real phone.
Stacked on #126.
Branch: `feat/orders-redesign`, stacked on #126. Tasks: P0-1, P0-4. Owner:
business-rules.md, "«Замовлення»'s task list" (2026-10-23).

## Why this was next

The owner chose «Замовлення»'s task list after «Каса», answered its seven
questions, and chose P0-1 and P0-4 first. «Замовлення» opened as fifty
cards newest first, the orders to send among the collected and the
cancelled, each with its sum and «№ 3f2a9c1b» but no size; a waybill was
found only with «Знайти»; and «Скасувати та звільнити резерв» cancelled for
good, in one tap, beside «Відправлено».

## What exists now

- **«Потрібно відправити · N» and «В дорозі · N» on top,** oldest first;
  the closed under «Показати завершені».
- **A row a parcel's tag:** goods with their sizes, how it goes and since
  when, the status as a pill under them; no sum, no way, no id.
- **«Номер ТТН» found as it is typed;** «Очистити» when nothing is found;
  what was typed kept while an order is opened.
- **«+» for a new order** beside the heading; words for an empty list.
- **«Скасувати замовлення» asked first,** at the card's foot, both answers
  held while it is on its way; cancelled, a buzz and «Замовлення
  скасовано, резерв звільнено.»; refused, a buzz and why brought to the
  finger.
- **The server reads the open or the closed** (`status=open|closed`),
  read-only.

What is sent and the stock are unchanged; no migration.

## Decided here, not by the owner

- **The pill under the goods,** where the task list put it on the right:
  at 360 px «Прибув на пошту» on the right left the goods a word a line. As
  «Закриття»'s pill and «Каса»'s correction, both approved.
- **The groups counted once every open order is read;** past a hundred,
  no number until «Показати ще» has read the rest.
- **An abroad note by its first sixty characters** in a row: it may hold a
  thousand.
- **«з 21.10» never broken after «з».**
- **«+ Нове замовлення» stays under «Ще»** until the bottom menu (P2-5).
- **The cancel at the card's foot, after the history,** its result a line
  under the pill — the card itself is P0-2's.
- **«Завершені» and the order within the groups** were not drawn in the
  reference: to be approved from the
  [screenshots](../../output/verification/2026-10-23-orders-list/screens/).
- **«Немає права переглядати замовлення.», «Завантажуємо…» and the pills'
  one colour** are left for P2-1, P2-2 and P2-3.

## How it was built and proven

- **`orders-list.spec.ts` (new, stubbed, Оля), 9 journeys:**
  - at 360×640: no «Оновити», «Знайти», «Попередні», «Наступні»;
    «Потрібно відправити · 1» and «В дорозі · 2»; a row «Лоран шоколад ·
    M × 2», «Пальто Ірис · L», «+ ще 1», «Нова пошта · ТТН ще немає · з
    20.10», «До відправлення»; on their way oldest first; no «грн», way or
    «№» on any row, each at least 44 px; only the field between the heading
    and the first row; the collected only after «Показати завершені», gone
    with «Сховати завершені»; «+» opens «Нове замовлення»;
  - one character asks nothing; «2045» finds two orders of every status,
    with no group; an order opened and left, the search as it was; after
    «not found», another waybill typed says «Шукаємо…», never «not found»,
    until its answer; Enter at once — proven with the search's pause held
    back; «Очистити» empties the field, focuses it, and brings the groups
    back;
  - 105 open: a hundred, no number, «Показати ще», 105 rows, «Потрібно
    відправити · 105»; the closed fifty, then fifty-five with the row read
    twice shown once; the focus on «Завершені», and back on «Показати
    завершені»;
  - no order yet: the words and «Нове замовлення»; none open but a closed
    one: «Зараз нічого не треба відправляти.»;
  - «Скасувати замовлення»: the question, «Ні, залишити» under the finger,
    nothing sent; kept, the focus back; «Так, скасувати»: one `cancel` with
    its `command_id`, «Скасовано», «Замовлення скасовано, резерв
    звільнено.», one buzz;
  - a cancel on its way: «Так» and «Ні» held; refused: an error's buzz,
    the alert focused, the order «До відправлення», «Ні» open again;
  - a store that does not trade: its orders, no «+»;
  - both themes at 4.5:1 — a group's heading, a row's goods, how it goes,
    its pill, «+», «Показати завершені» — a tracking link pasted into an
    abroad note cut at sixty characters and inside its row, nothing wider
    than the phone, with screenshots.
- **`test_order_read_api.py`:** `status=open` the open statuses oldest
  first, paged; `status=closed` a collected and a cancelled order, newest
  first; none, every order newest first, as before; any other word
  refused.
- **`orders.spec.ts`, `order-shipping.spec.ts`** (the real API): the
  heading «Замовлення»; a cancel asked first; an arrived order found by its
  own waybill, as a row names no id; two orders of one waybill found as it
  is typed, the newest opened.
- **`till-redesign.spec.ts`, `till-sections.spec.ts`:** whoever does not
  sell opens on «Замовлення»; without `sale:create` no «+».
- **Related journeys:** 248 — orders and their shipping, the till, its
  places, sections and receipt, debts, returns, «Каса», the outage and its
  paper, failures, outside text, sessions and the first sign-in — passed
  with it.
- **Mutation:** 28 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: 27 caught at first; the closed
  read with the open survived, changing nothing seen, and the list's first
  journey now asks that nothing closed is read before «Показати
  завершені»: caught, 28 of 28
  ([`mutants.txt`](../../output/verification/2026-10-23-orders-list/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed the lists' keys and their reading again after a step, the probe
of the closed when nothing is open, the server's access filter before the
page, the result line's order, and the wording. It found, all addressed
before the first commit:
- **«Not found» said before the search's answer,** the empty rows of the
  search before standing in. Now «Шукаємо…» until its own answer.
- **«Ні, залишити» open while the cancel was on its way:** the question
  closed, the order looking kept, while the cancel could still be
  recorded. Now held with «Так».
- **What was typed and the closed shown lost** on opening an order. Now
  kept by the workspace, afresh when «Замовлення» is chosen again.
- **A refused cancel silent, its why a screen above.** Now an error's
  buzz, the alert focused, the order read again.
- **A pasted note or a long waybill wider than the row.** Now broken where
  it must, a note cut at sixty characters.
- **The list read without `sale:view`.** Now only with it.
- **Tests:** Enter not proven; the stub's pages modelled the wrong shift
  for the open list; the closed read proven with one cancelled order; no
  store that does not trade. All now proven.
- **Smaller:** the lists read again on a step while not shown; no words
  while the closed are read or when there are none; the focus lost when
  «Показати» and «Сховати завершені» swap; «В дорозі» by name; the docs'
  «under the finger» for a button only focused.

Not changed: past a hundred open orders, one closed on another phone
between two pages moves the second page's edge, and one row may be missed
until the list is read again — a cursor instead of an offset would close
it.

## Evidence

- [`output/verification/2026-10-23-orders-list/`](../../output/verification/2026-10-23-orders-list/):
  `mutants.py`, `mutants.txt`, and `screens/` — the list, light and dark,
  and the cancel's question.
- **CI, run locally at `52d01a5`**
  ([summary](../../output/verification/2026-10-23-orders-list-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 464 on PostgreSQL 17;
  - e2e: 560 journeys;
  - hot path: worst p95 115.5 ms (every warehouse, six sellers) and
    114.5 ms (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the field and the keyboard over the list; a buzz on
  a real Telegram.
- **More than a hundred open orders** read across a close on another
  phone: one row may be missed until the list is read again (Review).
- **Left:** «Замовлення»'s P0-2, P0-3, P0-5, P1-1…P1-3, P2-1…P2-5; the
  prepayment mark in the [backlog](backlog.md).
