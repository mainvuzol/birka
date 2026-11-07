# «Усе на бірці», stage 2's sixth batch: the return in the new system, here and at another store; «Клієнт забрав» as a stub; «Щось пішло не так» and «Застосунок не завантажився» — 2026-11-06

Baseline: `7bf04efc` (#174, on main), and five points of the stage-2
orders-and-paper task list ([P0-6, P2-1, P1-2, P1-5, P2-2](redesign/2026-11-05-redesign-tz-stage2-orders-paper.md)),
their decisions and acceptance. With them that task list is built whole.
Status: built; proof below. CI is GitHub's, on the pull request. Not yet
seen on a real phone.
Branch: `feat/stage2-returns`. Task: the sixth batch proposed after #174
(chosen in chat, 2026-11-06, «Returns + orders' end»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-06 (stage 2 batch 6:
…)". The owner's questions stand by their (а): В-ЗП6 (a sale's return a
task's screen, the menu aside) and В-ЗП7 («Продали ще до Бірки? …» under
the other stores' empty search too).

Where these screens still did their own way:
- A sale's return opened under the bottom menu, with «Продаж» held; its
  stickers were colour alone; each line a block of 700 with «Цілі» over
  «Пошкоджені», a hint under it; the counts and the way's switch were
  felt as nothing.
- Nothing found was a sentence; «В інших магазинах мережі» a plain
  heading; «Продали ще до Бірки? …» said only in this store's search.
- Returned at another store, «Товар куплено в іншому магазині мережі —
  гроші віддаєте ви.» stood under the stub, away from the money.
- «Клієнт забрав» was a pill and a large sum, not a sale's stub.
- «Щось пішло не так» was «Бірка» as its first heading, the title second,
  and the server's silence an alert in the error's red.
- The words before the app's code arrived were black on white in either
  theme, a plain paragraph.

## What exists now

- **A sale's return, a task's screen (P0-6):** the menu steps aside while
  one sale's return is open; «← До списку» and Telegram's «Назад» lead
  back and the menu comes back there; kept, «← До списку» held as before.
  - «Оплата частинами» with the owed arrow, «Продано з паперу» / «…під
    час збою» with the warning's triangle.
  - A line a row of 64: «{Модель} · {розмір}» 17/600, its price and what
    may come back in meta; «Цілі» and «Пошкоджені» side by side, each its
    name over «− N +», the buttons 44, «Пошкоджені» with «Брак»'s torn
    tag; each «−» and «+» a light tap.
  - The way's switch felt as a choice; it stays three radios (decided
    here).
  - The warehouse for the intact ones: deciding chips 44, the chosen one
    in the chosen colours (from the review).
  - «В інших магазинах мережі» the section's caption, in capitals.
  - Nothing found, here or there, and no sale yet: the blank mark, the
    words under it; «Продали ще до Бірки? …» under the other stores'
    empty search too (В-ЗП7 (а)).
- **Another store's line inside the stub (P2-1):** under the way's
  sticker and over the sum; confirmed later, the same, with the money
  under its way; first in the stub, clear of its eyelet, when no sticker
  heads it (from the review).
- **«Клієнт забрав» a sale's stub (P1-2):** «Продаж записано» with the
  check in its eyelet; the way's sticker with its glyph (cash, card,
  transfer), what to do under it, the server's sum large; in parts
  «Сплачено зараз» over it and what is owed in meta; what to do heard too
  (from the review). Kept and confirmed later: «…один раз», the way alone,
  «Якщо картку ще не провели…» in ink.
- **«Щось пішло не так» (P1-5):** the app's name and mark over the blank
  tag; the title its one heading; the server's silence the paper's
  warning in a status heard as it comes; «Перезапустити» one primary, 52
  high; «Версія …» in meta.
- **«Застосунок не завантажився» (P2-2):** the app's paper and ink and
  their dark by the device's setting; the owner's words on the warning's
  plate with its triangle; still only after 8 s; `index.html` +1 371
  bytes (the task list allows 2 KB).

## Decided here, not by the owner

The whole list is in business-rules.md under the heading above. In short:
- the way's switch stays a group of three radios drawn as §6.7's switch:
  «nothing chosen» (the sale's way not read) is a state a mode switch does
  not have;
- «без прокрутки» at 360 × 640 read as the person scrolling nothing: the
  line over the panel and both whole; the app's own bringing of the
  counted tag above the panel stays (21 px for one plain line, 138 px
  paid in parts from paper with both stickers);
- the crash screen's banner a status, not an alert; its place on the
  screen from the start;
- `index.html`'s colours set on the page's element, so the app's own
  `:root` always wins; the dark by the device's setting, Telegram's theme
  not being known before the code;
- the blank tag one shared piece (`shared/BlankTag.tsx`) for the door and
  the crash screen;
- from the review: the warehouse chips in the chosen colours; another
  store's line clear of the eyelet; «Клієнт забрав»'s what-to-do heard.

## How it was built and proven

- **Files:**
  - `frontend/src/returns/Returns.tsx`: the task's screen reported, the
    stickers' glyphs, the line's row and steppers, the buzzes, the caption,
    the empty states, the manager's line;
  - `frontend/src/App.tsx`: the menu aside while a return is made; the
    blank tag moved out;
  - `frontend/src/shared/BlankTag.tsx` (new): the blank tag, shared;
  - `frontend/src/returns/Result.tsx`: another store's line in the stub;
  - `frontend/src/orders/Collected.tsx`: «Клієнт забрав» as a stub;
  - `frontend/src/shared/CrashScreen.tsx`: the crash screen on the blank
    tag, its status;
  - `frontend/index.html`: the words before the app, by theme;
  - `frontend/src/styles.css`: the line's row and steppers, the stickers,
    the chips, the empty states, the crash screen, the eyelet's room.
  - No backend change: every read and command is the one before.
- **Journeys:** 949 in all (939 after #174).
  - **10 new:**
    - a sale's return a task's screen: the menu aside, Telegram's «Назад»
      its «До списку», its stickers with their glyphs, the two counts in
      one row felt as a light tap, the way's switch felt as a choice;
    - the light and the dark theme at 360 × 640: the stickers, counts, the
      way's switch and a refusal's plate at 4.5:1, the one line over the
      panel;
    - «Клієнт забрав» by each of its five ways: the stub, the sticker and
      its glyph where the till has one, what to do (seen and heard), the
      server's sum;
    - the light and the dark theme: «Клієнт забрав»'s stub at 4.5:1,
      nothing wider than the phone;
    - the light and the dark theme at 360 × 640: «Щось пішло не так» on
      the blank tag, «Перезапустити» in view, the server's silence the
      paper's warning, never an error's or a debt's colours, at 4.5:1;
    - the app's code never arriving, in the dark theme: the paper's dark,
      the warning's plate, its triangle at 3:1, its words at 4.5:1;
    - paid in parts at another store, nothing back: whose money it is the
      stub's first line, clear of its eyelet (from the review).
  - **Rewritten or extended:** `returns-sale-screen` (the line's meta;
    one plain line over the panel at 360 × 640; the warehouse chips 44 in
    the chosen colours), `returns-elsewhere` (the caption; the line inside
    the stub, at 360 × 640; confirmed later inside its money),
    `returns-list` (the manager's line under the other stores' empty
    search, the blank mark), `returns` (the line's meta; kept, the menu
    aside and «← До списку» held), `failures` (the crash screen's heading,
    name and blank tag; its status from the start; the light load's paper
    and contrast), `orders-card` (the stub's sum, sticker and say; heard),
    `orders`, `outage-mark-debts-returns`, `till-basket` (back to the list
    by «← До списку» before the menu), `till-receipt` (a sale's return from
    its receipt: the menu aside), `credits` (the stub's sum in parts).

## The independent review

An agent read the change cold (2026-11-06). It found nothing that loses
money words, a sum, a way or a held button. The menu comes back on every
way out of the form, StrictMode's double effects included. The new CSS
does not leak, no dark token is missing, and `index.html`'s colours lose
to the app's own. What else it found, and what was done:
- **Fixed:**
  - **Another store's line under the eyelet:** paid in parts there with
    nothing back, no sticker heads the stub, and the line's first words ran
    under its eyelet. It now keeps the head's room; a journey proves it.
  - **A fit check that could not fail:** the line «in view» was also «in
    view» under the panel, which stands over the page's foot. The check is
    now the line's foot over the panel's top, as the refusal's was; a
    mutant without the app's own scroll proves it fails.
  - **The warehouse chips:** the task list asks for deciding chips 44 in
    the chosen colours; they were 52 in the action's colour. Built.
  - **«Проведіть на терміналі» not heard:** the stub's say and sticker are
    hidden from a reader and the spoken sentence had only the sum and its
    way. It now ends with what to do, as the till's stub reads.
  - **The server's silence maybe not heard:** a status put on the screen
    already holding its words is often not read. Its place is now there
    from the start, empty.
- **Recorded, left as built:**
  - the banner's name «Сервер не відповідає» and its first words read the
    same, as the app's own banner does;
  - «Перезапустити» in view on CI's DejaVu font is estimated, not seen;
    the journey checks it there.

## Mutants

35 changes to the source, each applied alone and run against the journeys
that should catch it (`~/.cache/birka-runtime/helpers/mutate23.py`,
`mutants23.sh`); 34 were caught:
- **A sale's return (P0-6):** the menu not stepping aside (the app's
  task, its prop, the form's report); a sticker without its glyph («Оплата
  частинами», the warning's), «Пошкоджені» without «Брак»'s tag; a count
  or the way's switch felt as nothing; the line's meta unnamed; the
  caption a plain heading; nothing found without its blank mark; the
  manager's line only in this store's search; the counts one under the
  other; the steppers' buttons 36; the counted tag not brought above the
  panel; the warehouse chips 52.
- **Another store's line (P2-1):** under the money, not over it; confirmed
  later, outside the money; first in the stub and under its eyelet.
- **«Клієнт забрав» (P1-2):** a kept stub, not a recorded one; no check in
  the eyelet; nothing to do said, or not heard; the sticker without its
  glyph; in parts, no «Сплачено зараз».
- **«Щось пішло не так» (P1-5):** without the app's name; the server's
  silence an alert, or in the error's colours; «Перезапустити» not 52; the
  status put on the screen with its words.
- **«Застосунок не завантажився» (P2-2):** the light's or the dark's paper
  gone; the words off the warning's plate; the dark triangle the plate's
  own colour.
- **Three were first run against the wrong journey** (the warning's glyph,
  the line's meta, the app's name): run against the journeys that check
  them, each was caught.
- **One cannot be caught:** the chosen chip in the action's colour, not
  the chosen one. Today `--accent` and `--chosen` are the same colours in
  both themes, so the two are one on the screen; the rule names the chosen
  colour so it follows if they part.

## Evidence

- **Every journey on a fresh seed:** 944 of 949 passed in 26.1 min
  (`go-full23.log`). `backups.spec.ts:78` fails on the Mac alone as before
  and passes on CI. The other four (`till-basket` :403, :431, :459 and
  `till-receipt` :444) reached for the menu on a sale's return, where it
  now steps aside (В-ЗП6 (а)): they now leave by «← До списку» first, or
  check the menu aside; the two specs then passed 21 of 21.
- **The specs this batch touches** (`returns-sale-screen`,
  `returns-elsewhere`, `failures`, `orders-card`) after the review's
  fixes: 101 of 101 with the one old description updated; `orders`,
  `credits` and `orders-card` again: 90 of 91 on the crowded database,
  the one a till journey not finding its coat among the other journeys'
  models — it passed in the full run on the fresh seed.
- **The checks:** `tsc -b`, `eslint src e2e` and Prettier on my own hunks
  are clean. No backend change.

## For the owner

Nothing new to ask: the task's screen is В-ЗП6 (а), the manager's line
В-ЗП7 (а). What was decided here is in business-rules.md under the
heading above. Words were not changed; what is new is where they stand.
The one reading for the owner to look at: «Товар куплено в іншому
магазині мережі — гроші віддаєте ви.» is said even when a sale in parts
gives no money back (as before).

## Not covered

- **A real phone:** Telegram's «Назад», the buzzes and a reader's speech
  are checked by their stubs and the accessibility tree in Chromium, not
  on a phone or with VoiceOver / TalkBack.
- **`index.html` in Telegram's own theme:** before the code, only the
  device's setting is known; a Telegram theme unlike the device's shows
  the device's colours for those 8 s.
- **The rest:** the orders-and-paper task list is built whole; the money
  task list's P1-1 and the others wait for the next pick.
