# «Усе на бірці», the till's «Внесок»: the segment, S21 on the app's keypad, S22's total — 2026-10-29

Baseline: `df246f3` (#148, on main), and the frame's task list
([P0-3](redesign/2026-10-27-redesign-tz-all-on-the-tag.md)).
Status: built and reviewed; every journey passes locally. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/deposit`. Task: the frame's P0-3.
Chosen: business-rules.md, "Chosen in chat — 2026-10-29 (the till's
«Внесок» of «Усе на бірці»)".

## What exists now

- **«Продаж» › «Внесок»:** the till's segment is «Продати · Повернути ·
  Внесок», each way by its own right — «Внесок» by `sale:credit` in a
  store that trades — and drawn once two are open. Its reader name names
  the ways it holds: «Продаж, повернення або внесок», «Продаж або
  внесок», «Повернення або внесок», «Продаж або повернення». Whoever only
  takes payments gets «Продаж» opening «Внесок», with no segment.
- **S08 in «Внесок»:** the heading «Продаж», «Ім’я або телефон», and the
  store's debtors as «Клієнти» lists them, a row a customer. No «Магазину
  винні» card and no «Показати сплачені й списані» here: the list is the
  open debts.
- **Another store's debt:** a whole number this store lists nobody for is
  asked of each other store where this person takes payments; one found
  is a row that is not a button, «Внесок приймає «Другий»», with its sum.
  With no right there, the words are as before.
- **S21, a debt at the till** (`credits/Debt.tsx`, its `till` branch):
  - the goods for a title, «+ ще N» opening the rest; «{покупець} ·
    «{магазин}» · з dd.mm» under it;
  - «Винні» with its glyph, the sum large, the bar, «Сплачено … з … ·
    останній внесок dd.mm»;
  - «Історія · N ›» opening the history in place, not drawn for a debt
    with no entries;
  - the bottom menu steps aside while the payment's form stands, and is
    back on S22;
  - the dock: «Сума, грн» and «Увесь залишок {сума}» on one row, the sum
    in a 72 px box, the keypad, and «Готівка · Картка · Переказ» at 56 px,
    disabled until 0 < the sum ≤ the debt on screen; more says «Це
    більше, ніж винні: залишок боргу {сума}.» in the error's colour, and
    nothing is sent;
  - from paper, «Внесок з паперу»'s fields over the dock and the ways «З
    паперу · …», as before.
- **The keypad** (`shared/Keypad.tsx`, spec §6.25), for S26 too:
  «1 2 3 · 4 5 6 · 7 8 9 · , 0 ⌫», at most two figures after the comma, a
  leading zero dropped, a comma first «0,», ten whole figures at most; the
  phone's keyboard never opens (`inputmode="none"`), a computer's still
  types into the sum in the keypad's terms; ⌫ held 600 ms clears it, and
  never opens the phone's menu; each key's sum is said to a screen reader.
- **S22:** P0-2's stub, and «Усього винні магазину «{магазин}» {сума}» —
  the customer's `owed` from `GET /credits/customers`, read again by
  their phone once the payment is recorded, its place held while read.
  Paid off with nothing else owed, the knot and «Борг сплачено
  повністю.» say it, and no total. «Відкрити борг» is S21 again with what
  is left.
- **A kept payment** is kept over «Продаж» › «Внесок», and a reload turns
  there for whoever may take payments; a kept write-off, never made at the
  till, still turns to «Клієнти» › «Борги».
- **«Клієнти»'s debt is as it was:** its field, the write-off and erasing.
  The keypad is S21's. Until P0-4 moves the list to «Ще» › «Люди».

No backend change. No sum is worked out on the phone: the over line and
the disabled ways only read the debt on screen; the server still refuses
more than is owed (G9), in the debt's own words, and the debt is read
again. The same command, the same `command_id`, the same check of a kept
one.

## Decided here, not by the owner

- **«Усього винні магазину «Основний» 1 500,00 грн»**, not «Усього винні
  «Центру» …»: a store's name is typed by the owner and cannot be put in
  the dative; the generic «магазину» is, the name in its quotes stays as
  typed, as «Магазин «X»» and «прийняв магазин «X»» already do. To ask the
  owner.
- **The total is said only while the customer still owes the store.**
  Read again by the customer's phone, without the open-only filter, so a
  debt just paid off is found; another store's debt taken here names no
  total.
- **The menu steps aside on S21 only**, while the payment's form stands;
  on S22 it is back, for «Продаж» in one tap.
- **The segment's reader name names the ways it holds.**
- **«Внесок» only in a store that trades**: one that does not takes no
  payment; its debts stay in «Клієнти», read.
- **Whoever only takes payments** gets «Продаж» opening «Внесок», with no
  segment.
- **«Сума, грн» and «Увесь залишок …» on one row** over the sum, not the
  sum between them: 52 px back at 360 × 640.
- **No «Магазину винні» card and no «Показати сплачені й списані» at the
  till**: S08 draws neither, and the list is the open debts.
- **Another store's debt** is asked only for a whole number this store
  lists nobody for; its row is not a button; its place is held while
  asked; the closed stores' button stays under it, as before.
- **A refusal of the sum pressed speaks alone** until the sum is changed,
  which clears it: read again, the sum still keyed in is over the new
  debt, and two alerts would say one thing twice.
- **The till's «Внесок» and «Клієнти» are two screens**: a debt, a stub
  or a search left in one is not carried to the other.
- **A kept write-off turns to «Борги»**, never to the till.

## How it was built and proven

- **Files:**
  - new: `shared/Keypad.tsx` (`Keypad`, `pressed`);
  - `App.tsx`: the `deposit` tab, its rights, `tillModes`, the kept
    turn, the menu stepping aside;
  - `credits/Credits.tsx`: `till` — the heading, no summary, the other
    stores asked;
  - `credits/Debt.tsx`: the till's S21, `History`, the over line, the
    total;
  - `credits/Paid.tsx`: `total`;
  - `credits/CustomerRow.tsx`: a row taken elsewhere;
  - `styles.css`: the segment of three, S21, the keypad;
  - `e2e/fixtures.ts`: `tillWays`, the segment by any of its names.
- **Journeys:** fifteen new.
  - `credits-debt.spec.ts`, on the stubbed server (nine): three taps from
    the till to S22 and its total; more than owed, the keypad's grammar,
    ⌫ held, a hold with no click, the keypad's voice, the chip, a
    computer's keys; a debt lowered meanwhile, one alert; paid off, the
    knot and no total; another store's row, and the words with no right
    there; a kept payment over «Внесок» after a reload; the till and
    «Клієнти» two screens; 360 × 640 in both themes.
  - `credits.spec.ts`, against the server (three): a payment from the
    till and the server's total; a debt lowered by another payment,
    refused; a debt at «Другий» named at «Основний»'s till.
  - `till-sections.spec.ts` (two): «Повернути · Внесок» with no sale's
    right; only payments, «Продаж» opening «Внесок».
  - `outage.spec.ts` (one): a kept write-off turns to «Борги».
  - Changed: the segment found by `tillWays` in `outage`, `returns`,
    `till-basket`, `till-receipt`, `till-redesign` and `till-sections`; a
    kept payment's turn in `outage` is now «Продаж» › «Внесок»; «only
    takes returns» strips `sale:credit` too.
- **Journeys:** 712.

## Review

An independent review of the uncommitted tree found the money and the
rights sound: nothing is sent over the debt on screen, the server still
decides, the other stores are asked only where this person takes
payments, and the segment's rights are each its own. It found, fixed
before the first commit:
- **«Внесок» and «Клієнти» shared one screen**: both were the same
  `Credits` under the same key, so a stub, a debt or a search left at the
  till was «Клієнти»'s on the next tap. Each has its own key now, and a
  journey proves it both ways.
- **A kept write-off turned to the till's «Внесок»** on a reload. It
  turns to «Борги»; a journey proves it.
- **A held ⌫ whose click never came** — a touch often sends none —
  swallowed the next press of «Стерти» from a keyboard or a screen
  reader. Only a click within 500 ms of letting go is taken for the
  hold's; the phone's menu never opens on a hold.
- **The keypad said nothing**: a key keeps the focus, and the sum it made
  was never heard. It is said now, politely.
- **«Історія»'s `aria-controls`** named a list not drawn. It names it
  only while open.

Not changed:
- **At 360 × 640 the dock covers «Винні»** until the screen is scrolled:
  the dock is 478 px, the keypad and three ways the task list's
  criterion. The chip «Увесь залишок …» says the debt in the dock itself.

## Evidence

- Locally on `feat/deposit`, against the E2E API and PostgreSQL 17 on a
  fresh seed:
  - 712 journeys: 711 passed. `backups.spec.ts` alone failed, finding 14
    nights rather than 3: the local seed only adds. It is not this change;
    GitHub's CI runs it on a fresh database;
  - the journeys of «Внесок», «Борги», the outage and the till's sections
    passed again after the review's fixes (228);
  - eslint, tsc and the build are clean: app 508.26 kB, parts 2.61 kB,
    icons 6.56 kB, vendor 210.85 kB. The app's own file is past the
    500 kB warning (it was 499.82 kB); the build only warns.
  - Screenshots at 360 × 640: `frontend/test-results/debt-till-light.png`
    and `debt-till-dark.png`.
- **CI:** GitHub Actions on the pull request.

## Not covered here

- **On a real phone:** the keypad under the thumb, ⌫ held in Telegram's
  webview, and how a screen reader reads the sum.
- **Telegram's closing confirmation and BackButton** on S21: the app has
  no helper for either yet; P0-4's frame.
- **«Винні» under the dock at 640 px**, as above.
- **The 500 kB warning:** either it is raised, or screens load when
  opened, which the build does not do now on purpose (`vite.config.ts`).
  To choose.
- **«До відправлення»** is still a warning (В5 (а)). To ask the owner.
- **Next in the frame's order:** P0-4 → P1-1.
