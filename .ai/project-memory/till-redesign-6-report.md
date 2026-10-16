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

TODO(final)

## Review

TODO(final)

## Evidence

TODO(final)

## Not covered here

- **On a real phone:** copying in Telegram's own web view, on Android and
  on iOS, is not tried on a device yet.
- **В8, «Сьогодні ви продали N шт.»,** is decided, not built: it needs a
  count from the server.
- **Money's thousands space** (P2-1) and the rest of the P2 tasks.
