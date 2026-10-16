# The first sign-in and the kept sale's banner — 2026-10-16

Baseline: `911bcd3` (the till's empty states and the first days' paper,
PR #94).
Status: TODO(final).
Branch: `feat/till-first-sign-in`. Tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P1-3, P1-4. Owner: business-rules.md, "the first sign-in and the kept sale;
the guides; В8" (2026-10-16).

## Why this was next

Two moments where a person was left guessing. Someone the shop had not
added yet read «Ваш номер у Telegram: 123456789. Передайте його власнику
магазину.» — an account number, taken for a phone number — and «Спробувати
ще раз», which works for an hour only; past it, the sign-in screen said
«Сесія завершилась… Незавершену команду збережено» about a command they
never had. And a sale whose answer was lost held the till under «Незавершений
продаж» / «Невідомо, чи записано попередній продаж… Нові операції
заблоковано.», naming neither the sum nor the way: at that moment the
seller must know which customer it was, and whether to take the money
again. The owner chose these next, confirmed the guides' new words, and
answered В8.

## What exists now

- **Someone not yet added** (P1-3) sees «Ваш Telegram ID: 777000444 — це
  не номер телефону. Надішліть його власнику магазину. Коли вас додадуть,
  закрийте застосунок і відкрийте його знову кнопкою в боті.»
  - «Скопіювати ID» copies it where the phone lets the app copy, and says
    «ID скопійовано.», or, refused, to select it; where the phone cannot,
    there is no button, and the ID is selected whole at a touch.
  - «Спробувати ще раз» stays. People are still added on the server, on the
    owner's word.
- **Launch data the server refuses** (past its hour, or not the shop's
  bot's) says «Відкрийте застосунок знову кнопкою в боті вашого магазину.»,
  never a kept command: opened from the bot, the app finds any. A session
  ending later keeps its words.
- **A kept sale's banner** (P1-4) says «Продаж ще не підтверджено» and
  which sale it was, from the attempt the phone kept: «Продаж на 3000,00 грн
  · Картка — сервер не відповів. Двічі він не запишеться. Поки чекаємо,
  інші дії недоступні.»
  - A line answered «на місці лише N» counts N; paid in parts, it names the
    part paid now, «Продаж частинами, зараз 1000,00 грн · Переказ»; an
    attempt kept from before the way was asked names no way.
  - An empty shelf kept says «Запис нестачі ще не підтверджено».
  - The owner's line under it (G17, G18) and «Перевірити результат
    продажу» are unchanged.
- **A kept sale confirmed** says «Продаж записано один раз: разом 3000,00
  грн карткою.», and what it said of the card before.

Nothing about money, stock or who may do what changes; the server is
untouched.

## How it was built and proven

- **Journeys** (`first-sign-in.spec.ts`, 3, with the server stubbed):
  - someone not yet added: the ID said not to be a phone number, the
    exact words, «Скопіювати ID» copying exactly the ID and saying so,
    «Спробувати ще раз» kept, no sideways scroll at 360 px, and in the dark
    theme the ID at a contrast of 4.5 or more;
  - a copy refused says to select the ID; a phone that cannot copy shows
    no button, and the ID is selected whole;
  - launch data the server refuses (`INVALID_INIT_DATA`, as it refuses data
    past its hour) says to open the app again from the bot, nothing of a
    kept command, and keeps «Спробувати ще раз».
- **The kept sale** (`outage.spec.ts`): from attempts kept on the phone,
  the banner says a line answered «на місці лише 1» of two at its one,
  the part paid now and its way when in parts, no way for an attempt kept
  from before it was asked, and only the way for one whose figures do not
  read — never a broken screen. A sale confirmed says «Продаж записано один
  раз: разом 3000,00 грн готівкою.», and by card the same and when to charge.
  `sale.spec.ts` sees the sum and way of a sale whose answer was lost;
  `shelf.spec.ts` sees an empty shelf kept said as one.
- **Twenty checks on the old heading** read the new one; none of them met
  a kept empty shelf. A check that passed while the banner still read
  «Перевіряємо продаж…» (`person-limit.spec.ts`) now waits for the sale
  confirmed.
- **Mutation:** fifteen ways of breaking it, one at a time, each against
  the journeys meant to catch it on a fresh seed, after the unchanged tree
  passed: all caught on the first run
  (`output/verification/2026-10-16-till-first-sign-in/`) — the ID called a
  number, the copy offered where none can be made, a copy made or refused
  unsaid, the wrong text copied, refused launch data speaking of a kept
  command, a session ending after sign-in losing its words, the ID not
  selectable whole, the banner counting what was asked, the whole sum when
  in parts, no way named, an unreadable attempt breaking it, an empty shelf
  said as a sale, and the old words of the heading and the confirmation.

## Review

An independent review before the first commit found no blocker, the
order of the sign-in's refusals and the banner's arithmetic right against
the server's, and the following, all addressed in `174d923`:
- **A kept attempt whose figures do not read** — a price that is not text,
  a count that is not whole — made the banner throw, and every reopening
  with it: now it names only its way. A discount that does not read gives
  no sum, never a larger one.
- **The reason given for the sign-in's words was not true:** a command
  kept from an earlier opening may be on the phone when launch data is
  refused; opening from the bot finds it. Said so now, and for any refused
  launch data, not only data past its hour.
- **The confirmation with its way was never checked:** it is, for cash and
  for a card.
- **Smaller:** a guarded copy, a status line present from the start, the
  way kept when the sum does not read, the real server code in the
  journey, the dark theme's contrast, the server guides' «номер» now
  «Telegram ID», and the new words recorded where the task list's differ.

## Evidence

TODO(final)

## Not covered here

- **On a real phone:** copying in Telegram's own web view, on Android and
  on iOS, is not tried on a device yet.
- **В8, «Сьогодні ви продали N шт.»,** is decided, not built: it needs a
  count from the server.
- **Money's thousands space** (P2-1) and the rest of the P2 tasks.
