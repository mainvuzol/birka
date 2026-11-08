# «Усе на бірці», stage 2's twelfth batch: «Моделі» — the live search, the model's big tag with ⋯, the rename sheet, the merge's own screen asked by Telegram's popup; «Залишки» for those without the till — 2026-11-08

Baseline: `62bb7a0f` (batch 11, PR #180, merged), and the last two points
of the stage-2 goods task list ([P1-2,
P2-5](redesign/2026-11-05-redesign-tz-stage2-goods.md)), their decisions
and acceptance. With them the goods task list is built whole.
Status: built; proof below — 992 of 993 journeys on a fresh seed, the
one left failing on this Mac alone, as before; 60 of 61 mutants caught.
CI is GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/stage2-models`. Task: the twelfth batch, chosen in chat
after #180 was merged (2026-11-08, «merged, go next»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-08 (stage 2 batch 12:
«Моделі» — …; goods P1-2, P2-5)". No owner's question was open for these
two points; В-Г6 (а) — «Джерело» one word — already stood.

Where these screens still did their own way:
- «Моделі» searched on «Знайти»; a model opened as a form-like card with
  four buttons under it — «Перейменувати», «Об’єднати з іншою»,
  «Повернути модель», «Прибрати модель»; renaming unfolded a form of ten
  fields in the page; merging was a box to tick, «Розумію: об’єднання не
  можна скасувати.», and «Об’єднати» at the end of the preview, the stock
  as lines «Склад повернень · M · 3 шт.». «Старі чеки…» used the word the
  app does not use; «у «Прийманні»» named a section that is now «Прийшов
  товар». About twelve taps to a merge.
- «Залишки»: a select «Склад для перегляду», a card per size — «Розмір:
  M», «На складі: 3», «У резерві: 1», «Доступно: 2» — pages back and
  forth, and the correction's and the price's forms on each card.

## What exists now

- **«Моделі» (P1-2):**
  - **The search** is asked as it is typed, from two letters, once typing
    pauses; a row a model, «Прибрана» on a retired one; «Нічого не
    знайшли за «…».» where nothing is.
  - **The card** is a big tag: the name large, «Джерело: …», the state's
    sticker where it is not «Діє», «Веде до моделі «…».», and for a
    retired one «Прибрану модель не пропонують у «Прийшов товар» і
    пошуку; …». ⋯ opens a sheet named by the model: «Перейменувати»,
    «Об’єднати з іншою» (where the card says it may), «Прибрати модель»
    or «Повернути модель» — no question for these two. «← Моделі» goes
    back to the search, the cursor on the row it came from.
  - **The rename sheet:** «Змінюється лише ця модель. Старі продажі
    зберігають назву, під якою продали.», «Назва моделі» and «Колір»,
    «Ще ознаки» folding the rest; «Зберегти назву» is Telegram's
    MainButton (outside it, the sheet's own button), held while its
    answer is on its way, the sheet standing meanwhile. A similar word, a
    name another model has, and a name of several models are answered in
    the sheet as before; refused for another reason, «Ще ознаки» unfolds
    by itself.
  - **The merge's screen** «Об’єднати моделі», «← {модель}»: the search
    «Модель, що лишиться», the cursor in it, the duplicate never offered;
    then two tags — «Зникне», «Лишається», «Прибрана» where it is — with
    the price and the stock as cells, a row a warehouse, «є» where the
    count is not this person's to read; what stops it as rows under «Поки
    що не можна об’єднати»; «Поміняти місцями», «Обрати іншу модель».
    «Об’єднати» is Telegram's MainButton, active while nothing stops it;
    pressed, Telegram's popup asks «Об’єднати «А» з «Б»? Скасувати не
    можна.» — «Ні» and the destructive «Об’єднати». Outside Telegram, or
    in one older than 6.2, a sheet of the same words. The box to tick is
    gone. From the duplicate's row to a merge recorded: six taps.
  - **A kept correction:** the sheet gone, «Зміну каталогу ще не
    підтверджено» over the screen with the words every kept operation now
    has («Телефон перевірить сам»); checked by itself as the server comes
    back and once as the app opens with it kept; everything else held
    until it is settled.
- **«Залишки» (P2-5)**, for whoever reads the stock with no till: the
  warehouses as chips, none taken while there are several, the only one
  said — «Склад «…»» — and taken; a tag a model, glued across the pages
  read, its name and price, a cell a size with what is free (or «у
  резерві», dashed) and the held pin, «Можна продати N шт.» where the
  store sells from it, the quantities where it does not; «Оновити»; a tap
  on the tag opens the model's detail with «← Залишки», «Ще» marked, and
  back to the same warehouse. «Виправити залишок» and the price are the
  detail's.
- In passing: the order tags of «Позичене» and «Накладні» drew list
  bullets; gone.

## Decided here, not by the owner

All in business-rules.md under the heading above. In short:
- **The popup with no title, the question its message:** Telegram's
  title holds 64 characters, two models' names do not fit; an empty title
  is left out of the call, as Telegram's own library does; the message
  holds 256, and longer names are shortened alike with «…», the question
  whole.
- **Outside Telegram, a sheet of the popup's words,** «Об’єднати» outlined
  in red: red on a main button's black is under 3:1.
- **Retiring and bringing back ask nothing,** as the TZ's acceptance says.
- **«Ще ознаки» unfolds by itself** on a refusal that is not of a similar
  word, a name in use or several models: it may be of a word folded there.
- **A kept correction speaks as every kept operation** and is checked by
  itself; no paper line — a catalogue correction is not done on paper.
- **A first answer buzzes,** a kept one's later checks do not.
- **«Залишки»: the only warehouse said and taken;** a tag a model, the
  till's words in its cells («вільно», «у резерві»); quantities where the
  store does not sell from the warehouse; the detail read with no search,
  a name not being a search's words; the warehouse kept across the
  detail.
- **The correction and the price leave «Залишки»** for the detail (P1-3,
  P1-4 built them there); a stock correction kept with no answer still
  stands and is settled on «Залишки», as before.

## How it was built and proven

- **Files:**
  - `frontend/src/catalog/Models.tsx` (rewritten): the live search, the
    card and its ⋯ sheet, the rename sheet, the merge's screen with its
    tags, cells, blockers, MainButton, popup and ask sheet, the kept stub
    and its auto-check, `mergeQuestion`;
  - `frontend/src/inventory/Stock.tsx` (rewritten): chips, tags glued
    across pages, cells, the tap to the detail;
  - `frontend/src/App.tsx`: the correction's journal read from the phone
    marks it loaded; the warehouse «Залишки» shows kept across the
    detail and forgotten once left; «← Залишки» and the mark;
  - `frontend/src/shared/telegram.ts`: an empty popup title left out of
    the call;
  - `frontend/src/styles.css`: the screens above, the bullets, and a long
    name wrapping in a sheet's title and a «←».
  - No backend change.
- **Journeys:** 993 in all, 983 before: 13 new or rewritten, 3 of them in
  place of old ones.
  - `e2e/models.spec.ts`, 7 new: a kept correction resent as the server
    answers again with no tap; checked once «Моделі» opens again; checked
    once the app opens again (G11); inside Telegram the six taps of a
    merge, the popup with no title and its destructive button, one buzz;
    «Зберегти назву» as the rename sheet's MainButton, held and inactive;
    the popup's question with long names; 360 px, light and dark, with
    screenshots. The old ones rewritten to the new screens: the search as
    typed, ⋯ and its ways, the rename sheet, the merge's screen and its
    question, the search's words and cursor kept, the heading's focus.
  - `e2e/stock.spec.ts`, 5 new, 2 replaced: the chips with none taken; a
    tap on the tag to the detail and back to the same warehouse, then
    forgotten once left; the only warehouse said; a paused warehouse and
    a size all held, the tags glued across a page's edge, the last one
    held back and «Показати ще»'s cursor; «Можна продати» where the store
    sells.
  - `e2e/damaged.spec.ts`, 1 replaced: «Брак» on «Залишки» — what lies
    there, no price, nothing to sell. `returns`, `outage` and
    `outside-text` changed to the new words.

## The independent review

An independent reviewer read the diff against `62bb7a0f` with the TZ,
the rules and the journeys, and ran nothing. One P1 and about twenty P2;
each settled in the code or the journeys, and the ones that change what a
person sees written in business-rules.md («Settled in the review»):
- **P1 — the search's words lost on a merge:** «← Моделі» after the
  merge's screen came back to an empty search. Now its words are the
  screen's, kept across the card and the merge; a journey goes back and
  finds them, the cursor on the row.
- **A kept correction:** not checked when «Моделі» opened again with it
  kept (only when the server came back or the app opened) — now checked
  once, at once; settled by itself while the person was on the search, it
  pulled them to the card — now it is said where they are; its answer lost
  with nothing kept, the sheet closed on words not saved — now it stands;
  the cursor now on the stub as it comes. Trigger 1 (the server back, no
  tap) had no journey — now it has one.
- **The rename sheet:** Enter in a field did not save — a hidden submit
  now; a similar word taken for a folded field did not unfold «Ще ознаки»
  — now it does; `in` on the fields read the prototype — `hasOwnProperty`.
- **The merge:** the cursor nowhere after the model that stays was chosen,
  after a swap and after a retirement refused — now on the heading or the
  name; a stale preview's rows after «Обрати іншу модель» — not shown;
  the dock's room measured with the MainButton — not; a visible line
  before the search; the question cut inside an emoji — cut by code
  points; the popup's empty title — left out.
- **The live search** blinked «Нічого не знайшли…» between two answers —
  the rows kept until the next one; the words read aloud as a status.
- **«Залишки»:** a stock correction kept with no answer had lost its
  screen once «Залишки» stopped being one of a correction's — it is one
  again, as before; the last model of a page could show a count cut by
  the next page — held back until it is read; «Показати ще» left the cursor on nothing — now on the
  first tag it brings; the warehouse remembered across visits — forgotten
  once left; the tag read twice to a screen reader — once.
- **Journeys:** the first kept-merge journey could deadlock on a held
  attempt — now later attempts fail until released; the «Брак» journey
  was true of any screen — now it reads the cells and the note.
- **The rest:** a long name overflowing a sheet's title or a «←» — wraps.
- **Found before the review,** by the old journey «stock access denial
  hides stale balances»: a refresh refused left the tags read before
  under the error — now they go, and a next page refused keeps them
  under its own retry.
- **Not changed:** the detail opened from «Залишки» reads the whole list
  until the model (Not covered below); `stock.spec`'s first journey
  repeats the screen's rules, the literal journeys pinning them;
  «Показати ще»'s focus on «Моделі» is as it was at the baseline.

## Mutants

`~/.cache/birka-runtime/helpers/mutate29.py`: 61 mutants, each undoing
one thing this batch made — 48 of its two points, 13 of the fixes after
them (the review's, and the refused refresh's) — run by `mutants29.sh` against the journeys that should catch it,
on a fresh seed each, one failure ending the run.
- **First pass:** 57 caught; 2 of them (`rowstate`, `searchkept`) by a
  wait for the row the mutant changes, which never comes. 4 lived:
  - `mergeactive` — the MainButton «Об’єднати» pressable before the
    preview is read: the six-taps journey now holds the preview's first
    answer and finds the button shown and inactive;
  - `takemore` — a similar word taken for a folded field, «Ще ознаки»
    left shut: the similar-word journey now takes one for «Матеріал»
    (the refusal stubbed: the seed has no such word) and finds it unfolded;
  - `binprice` — «Брак» priced: the journey's model had no price at all,
    so «no price» held whatever the screen did; its stock's answer now
    carries a price for every model;
  - `loadedapp` — the journal read from the phone not marked: lives, and
    no journey can tell it. The read happens as the app opens and turns
    to «Моделі» itself, so «Моделі» opens with the correction kept and
    checks it at once (`keptOnOpen`); the mark is left as a guard for a
    journal read while «Моделі» is already open.
- **Second pass** (the three, the journeys tightened): caught, each at its
  new assertion.
- **60 of 61 caught;** one equivalent as far as the journeys reach.
  Logs: `go-mutants29.log`, `go-mutants29-pass2.log`.

## Evidence

- **Checks:** `npm run lint`, `npm run typecheck` and `npm run build` in
  `frontend/` clean; Prettier clean on the files written whole, and on
  every hunk of this batch in the files not clean at the baseline
  (`App.tsx`, `styles.css`, `returns.spec.ts`, `outage.spec.ts`).
- **The specs this batch touches,** after the review's fixes, on a fresh
  seed: 118 of 118 (`models`, `stock`, `damaged`, `returns`,
  `outside-text`, `model`, `orders-list`, `credits-debt`) and the kept
  stock correction's journey in `outage`, 2 of 2 —
  `go-b12-specs3.log`; the three journeys tightened for the mutants, 3 of
  3 — `go-b12-three.log`.
- **Every journey,** on a fresh seed, one worker: 992 of 993 in 26.3
  minutes — `go-b12-full1.log`. The one: `backups.spec.ts:93`, «the owner
  is shown last night's failed copy…», 14 nights listed for 3 — this
  Mac's backups' history, failing alike on the baseline's run
  (`go-b11-full1.log`); GitHub's run is the proof.
- **Screenshots** (`frontend/test-results/`, wiped by the next Playwright
  run): `models-card-360-{light,dark}.png` — the model's big tag;
  `models-merge-360-{light,dark}.png` — the merge's two tags and
  «Об’єднати» at the foot; `models-ask-360-{light,dark}.png` — the sheet
  of the popup's words, «Об’єднати» outlined in red; `stock-mobile.png` —
  «Залишки» with its chips, the main warehouse taken, the tag «Лоран
  шоколад 70.0 см», «M 18», the held pin «2», «Можна продати 18 шт.» (the
  E2E base's many warehouses make the chips long; the bar halfway down
  is a whole-page capture of a fixed bar).
- **GitHub's first run** (PR #181, `33b5a7f7`): 992 of 993 — batch 11's
  «a list ready to approve is three taps from «Сьогодні»» held its
  teardown past 30 s: approved, the warehouses are read again through a
  route that asks the real server, one still on its way as the journey
  ended (as #176, #177). It now ends once that read is asked and every
  read is answered; 8 of 8 on repeat and `today.spec` 37 of 37 here.
- Logs are in `~/.cache/birka-runtime/helpers/`.

## For the owner

Nothing new to ask. The decisions above are theirs to overturn, each in
business-rules.md.

## Not covered

- A real phone: Telegram's popup over the merge, the MainButton in the
  rename sheet with the keyboard up.
- CI's font: the 360 px bounds are checked on GitHub's run.
- The detail opened from «Залишки» reads the whole list until the model
  (no search): fine for a shop's catalogue, slower for thousands of
  models.
- The rest of stage 2: money P1-1; `Borrowed.tsx` and `Invoices.tsx`
  still search their own way.
