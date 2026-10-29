# «Усе на бірці», Telegram's «Назад» as the screen's «←» — 2026-10-29

Baseline: `1feb458` (#151, on main), and the frame's task list
([P1-1](redesign/2026-10-27-redesign-tz-all-on-the-tag.md)).
Status: built and reviewed; every journey passes locally but the backups'
seed one. CI is GitHub's, on the pull request. Not yet seen on a real
phone (С6).
Branch: `feat/frame-back`. Task: the frame's P1-1, next after P0-4 in the
task list's order.
Chosen: business-rules.md, "Chosen in chat — 2026-10-29 (Telegram's
«Назад», «Усе на бірці» P1-1)".

Inside Telegram, the button at the top left was always «Закрити»: on an
order's card or a debt, the habit of pressing «back» closed Бірка halfway
through. Now a screen opened from another shows Telegram's «Назад», and it
does what the screen's «←» does.

## What exists now

- **One «←» for every screen** (`shared/Back.tsx`): the button over the
  title, or beside it as «До списку», and Telegram's «Назад» doing the same
  through one handler (direction §6.8).
- **Shown** (`web_app_setup_back_button`, `is_visible: true`) while a
  screen's «←» is drawn and free:
  - the order's card, the step over it («Доставка», «Товар повернувся на
    склад»), «Нове замовлення»;
  - a debt, S21, a customer's card;
  - the cash's count, movements, fixes, closes and the close's result
    with what is owed;
  - a return's sale («← До списку»);
  - every screen under «Ще» («← Ще») and «Товар і каталог»'s own list;
  - inside a screen of «Ще»: a model opened from the search («До пошуку»),
    a proposal or a row of the catalogue's queue («← До черги
    перевірки»), an invoice («До списку накладних»), an opening's list
    («До списків»).
- **Hidden** on a tab's first screen — «Продаж» on each of its ways,
  «Замовлення», a seller's «Каса», «Ще» — where Telegram offers «Закрити»
  in its place; and while the screen's «←» is held: a payment in flight or
  kept on S21 and a debt, a first send in flight under «Ще».
- **Pressed** (`back_button_pressed`), it does what the «←» does; pressed
  while the «←» is held, nothing.
- **The innermost way back:** where a screen has two, «← Ще» and «До
  пошуку», Telegram's is the one that came last; the order's card, kept
  mounted and hidden under its step, gives way to the step's «← Замовлення».
- **Told once the screen has settled and only on a change:** a step's «←»
  comes as its card's goes, and Telegram's never blinks between them.
- **Only inside Telegram, from 6.1**, where Telegram knows the button.
- **One look for every «←» over a title:** the orders' «← До замовлень»
  and «← Замовлення» are quiet lines now, as «← Ще» and «← Каса» are.
- **Kept as it was:** every word and every name read aloud; what holds
  each «←»; the order's card letting go of a tap carried from its step
  onto «← До замовлень» (Telegram's «Назад» is not under the finger, so it
  is never taken as carried); «← У своєму магазині» and «← У цьому
  магазині», a search's switch, not a way back.

No backend change. No right, rule or word changes.

## Decided here, not by the owner

- **Every screen's way back is connected, not only those the task list
  names:** an invoice's «До списку накладних», an opening's «До списків»
  and a model's «До пошуку» are the way back of a screen opened from
  another, as the design's rule (§6.8) asks.
- **Where two ways back stand on one screen, the innermost:** a model's «До
  пошуку» before «← Ще».
- **Hidden whenever the «←» is held, by what already held it:** a payment
  kept on the phone holds S21's and a debt's «←», as before; «← Ще» is
  held only while a first send is in flight, so Telegram's «Назад» shows
  under «Ще» with an operation kept, as «← Ще» does.
- **A result with no «←» shows none** — the receipt, «Продажу немає»,
  «Товар прийнято», S22's stub, a return's: where each would lead is its
  own question; Telegram's «Закрити» stands there as before.
- **The orders' «←» take the quiet line** of every other «←» over a title,
  as part 2 left for this task.

## How it was built and proven

- **Files:**
  - new: `shared/Back.tsx` (`Back`);
  - `shared/telegram.ts`: the «←»s mounted, in the order they came;
    `showBack`, told once per settled screen and on change; `addBackWay`;
    `back_button_pressed` heard while connected;
  - 18 screens' files: each «←» and way back a `Back`; `BackToMore` one
    too, so every screen under «Ще» has it;
  - new journeys: `e2e/telegram-back.spec.ts`.
- **Journeys** (`telegram-back.spec.ts`, Telegram's bridge heard, its
  «Назад» pressed by its own event):
  - an order's card shows it; the step over it keeps it shown, never
    hidden between; pressed, back to the card, pressed again, back to the
    list, and hidden there;
  - «Ще» › «Залишки» shows it; pressed, «Ще», and hidden;
  - S21 shows it; while its payment is in flight its «←» is held and
    Telegram's hidden, and pressed then, nothing; answered, S22;
  - a payment kept on the phone holds S21's «←»: Telegram's stays hidden,
    and pressed, nothing;
  - «Перевірка каталогу» › «+ Нова пропозиція»: pressed, «← До черги
    перевірки» first, then «← Ще»;
  - a Telegram of 6.0 is told nothing of it.
- **Proven to catch:** with the press doing nothing, two of them fail; told
  at once instead of once settled, the order's journey sees the blink;
  with the press ignoring a held «←», both of S21's fail; with the outer
  «←» chosen, the catalogue's fails.
- **Journeys:** 729.

## Review

An independent review of the uncommitted tree found every «←» the task
list names connected and the three unnamed ones too; no tab's first screen
registers one; every `disabled`, name read aloud and the order card's
carried tap kept, the carried tap never applied to Telegram's press; the
innermost rule right for the hidden card, two ways back on one screen and
React's double effects in development; a press while held not falling
through to an older «←». It found, fixed before the commit:
- **S21's held press was checked too soon:** the screen was looked at
  before the press could have been answered. It is looked at once the
  screen has had time to answer, with the «←» still held.
- **Untested:** a kept operation holding the «←», and two ways back on one
  screen. Both have their journeys now.
- **The «←»s' list let go of the wrong one** were a «←» ever unmounted twice:
  guarded, though React never does.

Not changed, as decided here and left to part 2's word: **the orders' «←»
lose their border**, now the quiet line of every other «←» over a title.

## Evidence

- Locally on `feat/frame-back`, against the E2E API and PostgreSQL 17, on a
  fresh seed:
  - all 727 journeys before the review: 726 passed; `backups.spec.ts`
    finds 14 nights rather than 3, the local seed only adding, as before;
  - after the review's changes, `telegram-back.spec.ts`: 6 of 6;
  - each mutation above, run and undone: the journeys named fail;
  - the throwaway screenshots at 360 × 640 — an order's card under «← До
    замовлень», «Доставка» under «← Замовлення» — show the quiet line;
  - eslint, tsc and the build are clean: app 511.77 kB, parts 2.61 kB,
    icons 6.56 kB, vendor 210.85 kB; past the 500 kB warning, as before.
- **CI:** GitHub Actions on the pull request.

## Not covered here

- **On a real phone** (С6): Telegram's «Назад» on iOS and Android, and
  Telegram on a computer.
- **Sheets:** none yet; P0-5 builds them, and `Back` or `addBackWay` gives
  them Telegram's «Назад».
- **A question before closing** with a basket full (P1-2): «Закрити» on a
  screen whose «←» is held still closes Бірка, and so does Android's own
  «back» there, Telegram's «Назад» being hidden as the task list asks. For
  the owner: until P1-2, keep Telegram's shown and let a press do nothing
  instead?
- **Results with no «←»**: where Telegram's «Назад» should lead from a
  receipt or a stub, with each section's task.
- **The 500 kB warning:** still to choose.
- **«До відправлення»** is still a warning (В5 (а)). To ask the owner.
- **Next in the task list's order:** P0-5.
