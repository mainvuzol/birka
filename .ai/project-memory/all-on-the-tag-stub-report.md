# «Усе на бірці», the stub: «Корінець», the eyelet, banners and the dock while sending — 2026-10-28

Baseline: `cb3b7ae` (#147, on main), and the frame's task list
([P0-2](redesign/2026-10-27-redesign-tz-all-on-the-tag.md)).
Status: built and reviewed; every journey passes locally. CI is GitHub's,
on the pull request. Not yet seen on a real phone.
Branch: `feat/stub`. Task: the frame's P0-2.
Chosen: business-rules.md, "Chosen in chat — 2026-10-28 (the stub of «Усе
на бірці»)".

## What exists now

- **The stub «Корінець»** (`shared/Stub.tsx`, spec §6.30), in three
  states, each named by its shape as well as its colour:
  - kept: still attached, a dashed perforation along its top and two
    notches, its eyelet a dashed ring, «Ще не підтверджено» on it in the
    warning colour; it sways once as it comes (300 ms);
  - recorded: torn off along a toothed top, its eyelet filled; it tears
    as it comes (220 ms) and never holds the next tap;
  - settled: torn off, its eyelet knotted, the knot tied in 300 ms — a
    debt paid off in full.
- **The eyelet** (`shared/Eyelet.tsx`) at 8, 12 and 20 px: filled,
  dashed, knotted, or a ring turning once in 900 ms while the server is
  asked — the app's only spinner. Where motion is reduced the ring stands
  still, dashed, and «Чекаємо на сервер» beside it says what it would.
  Over a result, the check in its eyelet (28): the ring closes, then the
  tick is drawn.
- **S11, the till's receipt:** «Продаж записано» with the check, then the
  stub — the way's sticker with its glyph («Картка»), what to do with the
  money under it (card «Проведіть на терміналі», cash «У касу», transfer
  «Перевірте, що переказ надійшов, перш ніж віддати товар»), the sum in
  money-xl, a perforation, the goods «{Модель} · {розмір} · {склад}» with
  «{к-сть} × {ціна}». The paper's mark is a sticker. In parts the stub
  begins with «Зараз» and its sum, then «Разом за товар», «Покупець
  винен» and «Наступні внески — у розділі «Клієнти».». With no way named,
  «Разом» before the sum, and no sticker. «Змінити спосіб оплати» is quiet
  under the stub; «Новий продаж» is in the dock under the thumb.
- **S12, a kept operation:** on its own screen, its stub still attached —
  «Ще не підтверджено», its title, the approved words (`keptSaleText`,
  `keptText`), the check line, and «Перевірити результат продажу» quiet.
  Over any other screen, the same words in a banner. Confirmed, the stub
  tears off: «Продаж записано один раз». A kept return and a kept payment
  or write-off are drawn the same way on «Повернення» and «Клієнти».
- **The check line:** «Перевіряємо кожні 20 с · остання перевірка
  11:42:20», with its ring, while the server does not answer or a resend
  is under way. Before the first check there is no last check to tell.
  The time is that of the last question about what is kept — the probe,
  or a kept attempt resent by the phone or by its button — kept in memory
  only (`reach.ts`, `checked`).
- **The dock while sending** (spec §6.5), at the till, a return and a
  payment: the pressed button keeps its colours and shows the turning
  ring; the others step back, dashed. Past 3 s, «Ще надсилаємо…» over the
  dock. Nothing is said while nothing is sent.
- **Banners** (`shared/Banner.tsx`, spec §6.23): paper, kept, back,
  recorded, blocked — a glyph, the words as they were, the colours of
  what they are. Used by the paper mode, «Сервер знову відповідає», the
  store blocked, «Продажу не було», and the kept and confirmed operations
  over another screen.
- **A return's result:** «Повернення записано», then its stub — the way's
  sticker, what to do («Поверніть покупцю», «Поверніть на картку через
  термінал», «Надішліть покупцю переказом»), the sum, the debt's lines, a
  perforation, and «Цілі: …», «Пошкоджені: …». «Новий продаж» first,
  «Ще повернення» and «До списку» quiet.
- **S22, a payment's result:** «Внесок записано» with the check, its stub
  — sticker, what to do, the sum, «Залишок боргу …» — knotted once the
  debt is paid off. Its layout on the till is P0-3's.

No backend change. No sum is worked out on the phone: the receipt, the
return and the payment show the server's answer; a kept one, what the
attempt kept, as before. «Записано» only after an answer.

## Decided here, not by the owner

- **A first send is the dock's to say.** An attempt is written down before
  it is sent, so the old notice («Перевіряємо продаж…») came up on every
  press, with the paper's instructions. Now the command's store knows
  whether the attempt in flight was ever sent before (`first`, in
  `shared/journal.ts` and `sales/commands.ts`): while it was not, only
  the pressed way's ring and «Ще надсилаємо…» show; the kept stub comes
  once its answer is lost. An attempt read back from storage, resent by
  its button or by the phone when the server returns, was sent before,
  and its stub stays up while it is checked.
- **The toast is left to its first user** (P0-6's «Бачу», P1-4's «ID
  скопійовано»). Nothing in P0-2 shows one, and a component nobody draws
  cannot be proven by a journey.
- **The till's form while a sale is kept** stays drawn and disabled, as
  it was (`fieldset disabled`), rather than `aria-disabled`: nothing hides
  or moves, and a disabled control is still announced.
- **The kept banner over another screen** is drawn where the old notice
  stood, under the sections; on its own screen the stub stands there too.
- **The check line is shown only while the phone does check**: with the
  server answering and nothing sent, nothing checks by itself, and
  nothing says it does.
- **A kept operation confirmed later** keeps its sticker but not what to
  do: «Проведіть» or «Поверніть» are said only under «Якщо … ще не …», as
  the owner chose on 2026-10-07 and 2026-10-08.
- **The settled stub** is used where the debt is paid off in full, the
  only "nothing left to check" a result now knows.

## How it was built and proven

- **Files:**
  - new: `shared/Stub.tsx` (`Stub`, `Perforation`, `WaySticker`),
    `shared/Eyelet.tsx` (`Eyelet`, `Waiting`, `RecordedMark`),
    `shared/Banner.tsx`, `shared/Kept.tsx` (`Kept`, `Settled`,
    `CheckLine`), `shared/Sending.tsx` (`SendingLine`);
  - `sales/Sale.tsx`: the receipt, the dock, the banners;
  - `App.tsx`: the kept and confirmed operations, the blocked store;
  - `returns/Result.tsx`, `returns/Returns.tsx`;
  - `credits/Paid.tsx`, `credits/Debt.tsx`;
  - `shared/reach.ts`: `checked`, `noteChecked`, `secondsOf`;
  - `shared/journal.ts`, `sales/commands.ts`: `first`;
  - `styles.css`;
  - `vite.config.ts`: the design's parts (`Banner`, `Eyelet`, `Icon`,
    `Sending`, `Sum`) in a file of their own, 2.6 kB, importing nothing of
    the app's, so the app's own file stays under the 500 kB warning;
  - `e2e/fixtures.ts`: `expectStub`.
- **Journeys:** seven new. Five in `outage.spec.ts`, "11. the stub
  «Корінець»", on the stubbed server:
  - a slow answer: the ring only on the pressed way, turning once in
    0.9 s, the other two stepped back, nothing said before 3 s and «Ще
    надсилаємо…» after, gone with the answer;
  - the receipt at 360 × 640: torn, its eyelet filled, the sticker with
    its glyph, «Проведіть на терміналі», the sum at 40 px or more, the
    perforation, the line, and the sticker, the sum and «Новий продаж» in
    view;
  - a kept sale: its stub attached, «Ще не підтверджено», the button
    quiet; the check line with no last check, then a time after the
    probe, and another time 20 s later; checked again by its button, the
    stub staying and the dock quiet; over «Ще», a banner with the same
    words and a plain button, the till held; the server back, the same
    sale under the same key, the till opened on its stub torn off;
  - where motion is reduced: the ring still, «Чекаємо на сервер», the
    receipt with no motion;
  - no style but the eyelet's turns a whole turn.

  One in `returns.spec.ts`: a return held on the way, its button's ring and
  nothing kept shown, then its stub torn off. One in
  `credits-debt.spec.ts`: a payment held, the pressed way's ring, the
  others stepped back, «Ще надсилаємо…» past 3 s, nothing kept shown, its
  stub; then a write-off held, its button's ring.

  `expectStub` reads a result's sticker, what to do and its sum. Every
  journey that read «Готівка · Разом …», «Картка · Проведіть на
  терміналі», «Сплачено зараз …» or a way's pill with its sentence now
  reads them through it: in `sale`, `shelf`, `till-sold-today`,
  `till-money-words`, `credits`, `credits-debt`, `stores`, `returns`,
  `returns-elsewhere`, `returns-sale-screen` and `outage`. A journey that
  pressed «Перевірити результат продажу» while the phone could check it
  by itself now takes either (`credits.spec.ts`).
- **Journeys:** 697.

## Review

An independent review of the uncommitted tree found that `firstSend`
cannot hide a kept attempt: one read from storage, one resent by its
button or by the phone, and one blocked by another command all count as
sent before; a shortfall's answer follows a refusal that cleared the
attempt, and is a first send. It found the following, fixed before the
first commit:
- **The dock came back on every check of a kept attempt**: its pressed way
  was never cleared, so a resend turned the ring on the dock as well as on
  the check line, and said «Ще надсилаємо…». The dock now reads the way
  of the attempt sent for the first time: the till's way as the basket
  keeps it, the payment's from its body, the return's own button. A kept
  sale checked again by its button is a journey now.
- **A shortfall's answer after leaving the till, and a write-off, showed
  nothing while sent**: the first had lost its pressed way, the second had
  no ring. Both have them now, and the write-off's button is held while
  it is sent, as the ways are.
- **A sale typed from paper in cash said «У касу»** for money taken
  during the outage. As before, it says nothing of cash; a card or a
  transfer says what the paper says.
- **A return typed from paper with no money back lost its paper
  sticker.** It keeps it.
- **«остання перевірка» could be an older outage's.** A new outage starts
  with none.
- **A check while the server answers said «Перевіряємо кожні 20 с»**: it
  is the ring alone now.
- **«Ще надсилаємо…» moved the dock** by its line's height. It stands
  over the dock now.
- **A confirmed stub's title ran under its eyelet** at 360 px. It keeps
  clear of it.
- **Journeys that proved less than they said:** the receipt is now in
  view whole, its sum above the dock; the return's and the payment's docks
  have journeys of their own.

Not changed:
- **A focus under the result's dock** (keyboard only): the dock is not
  registered as a panel. The till's own panel already is, and two of them
  would clear each other's room. Rare on a phone.
- **The stub's toothed edge would clip a sum wider than the stub**, with
  nothing seen to overflow. The sum is 40–56 px and held together by
  no-break spaces; at 360 px six figures should fit, by the face's
  advances — estimated, not measured.
- **The journey that presses «Перевірити результат продажу» in parts**
  (`credits.spec.ts`) takes the phone's own check too: on the real API
  another read may answer first. That the button resends the same attempt
  is proven in `outage.spec.ts`.

## Evidence

- Locally on `feat/stub`, against the E2E API and PostgreSQL 17 on a fresh
  seed:
  - 697 journeys: 696 passed. `backups.spec.ts` alone failed, finding 14
    nights rather than 3: the local seed only adds. It is not this change,
    and it passed on GitHub for #147;
  - the stubbed server's new journeys passed twice more each, run alone;
  - eslint, tsc and the build are clean: app 499.82 kB, parts 2.61 kB,
    icons 6.56 kB, vendor 207.60 kB, one woff2.
- **CI:** GitHub Actions on the pull request.

## Not covered here

- **On a real phone:** the tear and the sway in Telegram's webview, and
  the turning ring on a slow network.
- **The toast** (item 7), with P0-6 or P1-4, whichever comes first.
- **«До відправлення»** is still a warning (В5 (а)); the design draws it
  `online`. To ask the owner.
- **The app's own file is at 499.82 kB**, with no room left under the
  500 kB warning. The next screen's task will cross it: then either the
  warning is raised, or screens load when opened, which the build does not
  do now on purpose (`vite.config.ts`). To choose then.
- **Next in the frame's order:** P0-3 → P0-4 → P1-1.
