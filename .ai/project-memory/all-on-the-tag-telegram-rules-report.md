# «Усе на бірці», Telegram's rules for the build: closing, keyboard, MainButton, buzz, the screen's turn — 2026-10-31

Baseline: `d1ff250` (#158, on main), and the frame's task list
([P1-2](redesign/2026-10-27-redesign-tz-all-on-the-tag.md), items 1–6 and
its acceptance; В-Т7), with the spec's §4.4 (its global rules, the
per-screen table and the haptic vocabulary).
Status: built, reviewed and proven on this Mac; evidence below. CI is
GitHub's, on the pull request. Not yet seen on a real phone (С2, С3).
Branch: `feat/telegram-rules`. Task: the frame's P1-2.
Chosen: business-rules.md, "Chosen in chat — 2026-10-31 (Telegram's rules
for the build, «Усе на бірці» P1-2)".

Бірка told Telegram little more than that it was ready, its colours, its
«Назад» and a buzz for an answer. A swipe could close it with a basket
full in front of a customer — a slip a notebook does not know; the
keyboard stayed over the tray after a cell was tapped; a turned phone
moved the till under the finger. Now Telegram asks before Бірка closes
while something would be lost, the keyboard goes when what was typed is
done with, the screen stays upright while a sale is under way, S22's next
step is Telegram's own button, and each kind of tap is felt as the spec's
vocabulary says. Nothing changes on the server.

## What exists now

- **The question before closing** (`web_app_setup_closing_behavior`,
  В-Т7 (а)): on while the till's basket holds goods — on the till or left
  for another tab — while a sale kept on the phone waits to be checked,
  and while a sum is typed on S21 (the till's «Внесок» and «Борги» alike);
  off as the basket empties or sells, the kept sale is settled, the sum is
  wiped or taken — and as a basket from paper goes with the paper switch
  turned off in «Ще».
- **The screen upright** (`web_app_toggle_orientation_lock`, 8.0) while
  the basket holds goods and the phone is upright: Telegram's lock keeps
  the screen as it is, so held sideways it is not locked so; turned
  upright, it is locked then.
- **The keyboard goes** (`web_app_hide_keyboard`, 9.1; and everywhere the
  field lets go of the cursor, which a tap on a button does not take in a
  phone's WebView — so putting it back brings the keyboard back): a till's
  cell of a model with a price, or of a coat already in the basket; a
  return's sale
  found; a debt's customer found; the price, and what is paid now,
  confirmed by the keyboard's key.
- **Every field of part 1 says its key** (`enterkeyhint`): the searches
  «search», the paper's time and the price «done», the customer's name and
  phone «next», what is paid now «done», the reasons «enter»; the keypad's
  sum opens no keyboard.
- **The MainButton** (`web_app_setup_main_button`, `main_button_pressed`):
  S22's «Відкрити борг» for a payment's result, in `primary` /
  `on-primary` and painted again when Telegram's theme turns; pressed, the
  debt opens again, and the button goes with the result. The screen then
  draws no «Відкрити борг» of its own. Never on the till, a return or a
  payment, and never one that pays. One list of the screens that want it,
  told once they settle, as Telegram's «Назад» is — a screen mounted twice,
  as React's checks do, never makes it blink.
- **The buzz, by the vocabulary:**
  - a choice: a store at its door, a way of the till, «Бачу»;
  - a light tap: a coat into the basket by its cell, «Менше» / «Більше» in
    the basket, a tag's verb on «Сьогодні»;
  - a warning: an operation first kept on the phone — a sale, an order's
    step, a return, a payment, every journal's command, a catalog's
    proposal — once; a close short or over by any sum, under a hryvnia
    too, in place of its success;
  - success and error as before; never on a scroll, a key or a screen
    opening.
- **Only where Telegram names a version that knows it:** the question from
  6.2 (the SDK here takes it for any), the turn from 8.0, the keyboard from
  9.1, the buzz from 6.1, the MainButton in any; where Telegram names no
  version, nothing at all, and S22 draws its own «Відкрити борг».

## Decided here, not by the owner

Recorded in business-rules.md (the entry above):
- the sum typed is S21's in «Борги» too; a payment kept on the phone keeps
  its sum, and the question;
- «while a basket is open» read as a sale under way, not its sheet open;
- the lock asked only while the phone is upright, and as it turns upright;
- a basket from paper gone with the switch turned off elsewhere holds
  nothing: no question, no lock;
- the keyboard's places, and none of «Каса»'s (part 2);
- the reasons' key «enter»; the keypad none;
- S22's MainButton for a payment's result only, at the till's «Внесок»
  and in «Борги» — the frame's «в внеске — никогда» read as the payment's
  form, as the spec's rule 4 forbids a MainButton in the sale's loop and
  the payment's form only; a write-off's result keeps both its buttons;
- a cell felt once, as the coat — S09 names a choice and a tap;
- a kept operation a warning in every journal, once, replacing the
  returns' and orders' «nothing»;
- the question from 6.2, against the SDK's «any».

## How it was built and proven

- **Files:**
  - `frontend/src/shared/telegram.ts`: the buzz's kinds; the held things —
    the question and the turn — told once screens settle, only on change;
    the keyboard; the MainButton's list, its colours, its press;
  - `frontend/src/App.tsx`: the question and the turn by the basket and
    the kept sale; the store's door;
  - `frontend/src/sales/basket.ts`: whether the basket holds goods, for
    the app to read;
  - `frontend/src/sales/Sale.tsx`, `sales/paperMark.tsx`: the light taps,
    the keyboard, the keys;
  - `frontend/src/credits/Debt.tsx`, `Paid.tsx`, `Credits.tsx`,
    `Terms.tsx`: S21's question, S22's MainButton, the keyboard;
  - `frontend/src/returns/Returns.tsx`, `shared/ModeSwitch.tsx`,
    `today/Today.tsx`, `cash/Cash.tsx`;
  - `frontend/src/shared/journal.ts`, `sales/commands.ts`,
    `orders/commands.ts`: a kept operation's warning.
- **Journeys** — `frontend/e2e/telegram-rules.spec.ts` (new), each
  hearing everything the app tells Telegram:
  - the till at 9.1: the door's choice; a cell — keyboard, light, the
    question, upright; ± light; emptied, both let go; again and the
    price's key; left for «Ще» and back, nothing; sold — success, both let
    go; no MainButton the whole sale long;
  - a kept sale: one warning, checked once more still unanswered and not
    felt again; Бірка reopened, the basket gone, the question still asked
    and nothing felt; the question until it is settled;
  - Telegram 9.1, 8.0, 7.0, 6.1: the field lets go of the cursor at each;
    Telegram's keyboard only at 9.1, the turn only from 8.0, the question
    only from 6.2;
  - held sideways as the first coat goes in: not locked; turned upright:
    locked;
  - a basket from paper, the paper turned off in «Ще»: the basket gone,
    the question and the lock with it;
  - a model without a price: its first cell leaves the keyboard to the
    price; tapped again, the keyboard goes;
  - S21 and S22 at 9.1: a way's choice, the same way nothing; the customer
    found, the keyboard; a sum typed, the question, wiped, off; paid —
    success, off, the MainButton in the light's colours, in the dark's
    when the theme turns; pressed, the debt again and the button gone; no
    «Відкрити борг» on the screen;
  - no version: none of it, and S22's own «Відкрити борг» works;
  - a return's sale found, the keyboard; its reason's key;
  - every field's key on the till, a return and S21; what is paid now
    confirmed, the keyboard.
  - `today.spec.ts`: «Бачу» a choice, a verb a light tap, opening nothing;
    `cash-close.spec.ts`: a close short by 0,50 грн, which wants no
    reason, a warning; `catalog.spec.ts`: a proposal kept on the phone, one
    warning, its later checks — lost again, then answered — nothing.
  - **Changed:** the journeys of an answer's buzz (`till-receipt`,
    `credits-debt`, `returns-sale-screen`, `orders-card`, `orders-new`,
    `orders-list`) count the answers' buzzes alone — a choice's and a
    tap's are this spec's; their kept operations are now a warning; the
    debt's «Відкрити борг» at 8.0 is pressed as Telegram's MainButton.
- **Mutants:** 46, each applied alone and its journey run. 43 failed it,
  at the check written for it — among them the review's eight: the lock
  asked sideways, never again upright, the field kept at 9.1, a catalog
  proposal kept unfelt or felt at every check, a paper basket kept past
  its switch, a priceless coat's second cell, a difference under a
  hryvnia felt as a success. Two first survived and their
  journeys were made to see them: a sale kept on the phone now reopens Бірка,
  the basket gone with it and the question still asked; a catalog proposal
  is now checked once more while still lost. Three change nothing a
  journey can reach:
  - the question told outside a version Telegram names: each message
    already asks its own version first;
  - the question kept once a payment is taken: the sum is wiped in the
    same moment;
  - the held things told at once rather than once the screens settle:
    every holder today starts off as it mounts — the basket lives in
    memory and goes with the store, a kept sale is read from the phone
    after the first look — so nothing can blink yet. Kept for «Каса»'s
    count (S26), whose screen will hold the question as it mounts.

## Review

An independent review of the whole change, before the evidence below:
- **Fixed:**
  - the lock asked while the phone was held sideways would keep it so —
    now asked only while upright, and again as it turns upright;
  - a close short or over by less than a hryvnia, drawn in the warning's
    colour, buzzed success — now any difference warns;
  - a catalog proposal kept on the phone, its own journal, buzzed nothing
    — now a warning, once;
  - a basket from paper, the paper turned off in «Ще», kept the question
    and the lock until the till opened again — now gone with the switch;
  - at 9.1 the field kept the cursor once Telegram hid the keyboard, so
    putting it back might not bring the keyboard back — now it lets go
    there too;
  - a second cell of a priceless coat already in the basket left the
    keyboard up — now it goes.
- **For the owner:** S22's MainButton at the till's «Внесок» (below).
- **Not verifiable here:** after Telegram's «Reload», the bridge starts
  with nothing told; a client that keeps the question, the lock or the
  MainButton across a reload would keep them until Бірка next tells them.
  Telegram's «Назад» has always worked the same way. Not changed: no
  client to check it on (below).

## Evidence

- **Full run** on a fresh seed, on this Mac: 811 of 812 journeys passed
  (14.3 min) — 795 before, 14 in `telegram-rules.spec.ts`, one each in
  `today`, `cash-close` and `catalog`. The one failure is
  `backups.spec.ts:76`, which fails only on this Mac, as on main.
- Four `catalog` journeys failed once on the shared E2E database, crowded
  by a day's runs (the model they pick was no longer on its first page);
  on a fresh seed all 17 passed. The change there is a buzz alone.
- `tsc -b` and `eslint .` clean; the build passes — its main chunk
  542.70 kB, with main's warning over 500 kB.
- GitHub's checks run on the pull request.

## For the owner

Each built by its (а) until answered:
- the question before closing — В-Т7 (а) against your В7 (а) of
  2026-10-26;
- S22's MainButton — the frame's «Відкрити борг» against the spec's
  «Готово»;
- S22's MainButton at the till's «Внесок», against the frame's «в кассе,
  возврате и внеске — никогда» if it means the deposit's result too;
- a kept operation now felt as a warning, where returns' P2-5 and orders
  felt it as nothing;
- a cell felt once, as the coat, where S09 names a choice and a tap.

## Not covered here

- **On a real phone** (С2, С3): Telegram's question as it is drawn, the
  keyboard going over the tray, the turn held.
- **After Telegram's «Reload»:** whether a client keeps the question, the
  lock or the MainButton across it (the review's suspicion above).
- **The count's upright screen and question** («Каса», S26): the
  sections' task list, as the frame says.
- **The MainButtons of S17, S18, S20, S24, S27, S28:** the sections' task
  lists.
