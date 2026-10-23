# «Замовлення»: newest first, and the order's card — 2026-10-23

Baseline: `07fa5fc` (#127, «Замовлення»'s list, on main `363e013`), and
«Замовлення»'s task list
([redesign/2026-10-23-redesign-tz-orders.md](redesign/2026-10-23-redesign-tz-orders.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
twenty of twenty ways of breaking it caught. The card waits for the
owner's approval; not yet tried on a real phone. Stacked on #127.
Branch: `feat/orders-card`, stacked on #127. Task: P0-2, and the owner's
newest first. Owner: business-rules.md, "after #127 was opened"
(2026-10-23).

## Why this was next

The owner approved #127's list but for its order — newest first — approved
the cancel's question, and chose the order's card. The card opened on
«Замовлення № 3f2a9c1b» and «Оновити», «Доставка: …» a line of its own, a
line's goods in three lines, the money's words on every status, the step a
button in the flow beside two others of its height, and nothing said after
it.

## What exists now

- **Newest first** in every list of orders.
- **The card's top:** the goods as the title, how it goes and since when in
  one line, the status's pill with the number small beside it.
- **Lines with their sums,** «Разом» large; to send, «Товар у резерві — на
  касі його не продадуть.»
- **The next step one button in the panel under the thumb:**
  «Відправлено», with «Номер ТТН (можна дописати пізніше)» under the sum,
  then «Прибув на пошту»; a buzz and what it did after it, «Відправлено ·
  ТТН …»; refused, a buzz of its own and why brought to the finger.
- **The rare at the foot;** «Оновити» gone; «Клієнт забрав» as before.
- **The card in its own file,** `frontend/src/orders/Order.tsx`, with its
  shipping form and the cancel's question, out of `App.tsx`.

What is sent and the stock are unchanged; no migration. The server's one
change is the open orders' order.

## Decided here, not by the owner

- **The screen,** from the task list: to be approved from the
  [screenshots](../../output/verification/2026-10-23-orders-card/screens/).
- **The number beside the pill,** where the task list put it at the
  context's end: there it took a second line at 360 px, and the waybill's
  field went under the panel.
- **The waybill's field under the sum, over the panel,** not in it.
- **What a step says:** abroad «Відправлено.»; the others as the task list
  wrote them — «Прибув на пошту» over its pill of the same words, for the
  owner to hear.
- **The panel names the order as its title does,** «+ ще N» too; none
  while where it goes is changed or it comes back.
- **A discount's words as before:** «600,00 грн за 1 шт. · знижка 20,00
  грн», the discount for every unit — for the owner to hear.
- **Abroad, the card says the note in full** in its context; the list cuts
  it at sixty.
- **A refused step buzzes for every step,** not only the cancel.

## How it was built and proven

- **`orders-card.spec.ts` (new, stubbed, Оля), 8 journeys:**
  - at 360×640: «Лоран шоколад · M» the title; «Нова пошта · ТТН ще немає
    · з 21.10»; «№ …» beside «До відправлення»; the line's sum; one
    explanation and no money's words; no «Оновити»; «Лоран шоколад · M ·
    Нова пошта» over «Відправлено»; the title, the context, the pill, the
    line, «Разом», the waybill's field and the button all on the first
    screen, the field clear of the panel and its height kept clear for the
    page; «Змінити доставку» opened: no panel, no second waybill's field,
    no room kept; the rare at the foot, the panel never over the last of
    them, «Ні, залишити» focused over it;
  - sent with « 0500012345678 », then arrived: `{command_id, waybill}`
    and `{command_id}`, «Відправлено · ТТН 0500012345678», «Прибув на
    пошту», a buzz each; arrived, no panel, «Клієнт забрав» as before;
  - refused: an error's buzz, the alert focused, the order read again,
    «До відправлення» still; then sent with no waybill: «Відправлено. ТТН
    можна вписати пізніше.»;
  - a step whose answer never came: kept, no buzz, nothing said recorded;
    «Повторити ту саму команду» sends the same command, then «Відправлено
    · ТТН 20451234» and a buzz;
  - two of a coat less a discount: «600,00 грн за 1 шт. · знижка 20,00
    грн», «1 160,00 грн», the title «Лоран шоколад · M × 2 + ще 1»,
    «Разом» «2 360,00 грн», the panel naming it so;
  - a collected order, and whoever may not step one: no panel, no field;
  - both themes at 4.5:1 — the title, the context, a line, «Разом», the
    panel's line and button — nothing wider than the phone, with
    screenshots.
- **`orders-list.spec.ts`:** newest first in the groups; «← До замовлень».
- **`orders.spec.ts`, `order-shipping.spec.ts`** (the real API): the
  card's context line, its number beside the pill, the line's sum, «Номер
  ТТН (можна дописати пізніше)», «Відправлено · ТТН …» and «Відправлено.».
- **`test_order_read_api.py`:** the open orders newest first.
- **Related journeys:** 256 — orders, their list and shipping, the till,
  its places, sections and receipt, debts, returns, «Каса», the outage and
  its paper, failures, outside text, sessions and the first sign-in —
  passed with it.
- **Mutation:** 20 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: 19 caught at first; the panel's
  room not kept survived — the browser here centres a focused button, so
  it never showed — and the card's first journey now asks for the room
  while the panel shows and none while it is gone: caught, 20 of 20
  ([`mutants.txt`](../../output/verification/2026-10-23-orders-card/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed nothing the card did was lost in its move — the same waybill's
notice, the sale and its way, the debt, «Клієнт забрав»'s checks, the
return and its rights, the shipping form and history, the cancel's
question, every control held — that what a step says comes from the order
read back, so a kept step confirmed later says it too, that a step whose
answer was lost never buzzes, and that the lines' sums are the server's.
It found, all addressed before the first commit:
- **The real API's journeys looked for the number in the context line,**
  moved beside the pill. Now so.
- **The panel live over «Змінити доставку» and the return,** two waybill
  fields on the screen at once. Now no panel while either is open.
- **A long waybill wider than the phone** in the line of what was done.
  Now broken where it must, the whole card.
- **The panel naming only the first coat.** Now as the title.
- **Tests:** a kept step's silence and its later confirmation, the order
  read again after a refusal, the pill and the line on the first screen.
  All now proven.

For the owner to hear, not changed: «Оновіть замовлення.» in a conflict's
words, though «Оновити» is gone — the card reads itself again (P1-2's
words); the discount «for every unit» unsaid; «Прибув на пошту» over its
pill of the same words.

## Evidence

- [`output/verification/2026-10-23-orders-card/`](../../output/verification/2026-10-23-orders-card/):
  `mutants.py`, `mutants.txt`, and `screens/` — the card to send, light
  and dark.
- **CI, run locally at `48655af`**
  ([summary](../../output/verification/2026-10-23-orders-card-ci-local/summary.md)),
  on the host's Node 24.18, every job with TZ=UTC: every job passed, the
  backend with its declared gap.
  - backend: 3 464 on PostgreSQL 17;
  - e2e: 568 journeys;
  - hot path: worst p95 98.4 ms (the search by six sellers) and 73.4 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** the keyboard over the waybill's field and the
  panel; a real Telegram's buzz.
- **Left:** «Замовлення»'s P0-3, P0-5, P1-1…P1-3, P2-1…P2-5.
