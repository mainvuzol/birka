# «Усе на бірці», stage 2's tenth batch: a new model where the coat is in hand; «Перевірка каталогу» as a queue and a proposal's screen; «Джерело» one word — 2026-11-08

Baseline: `1f8e9f65` (batch 9, PR #178, stacked on it), and three points of
the stage-2 goods task list ([P0-1, P1-1,
P2-4](redesign/2026-11-05-redesign-tz-stage2-goods.md)), their decisions
and acceptance.
Status: built; proof below — 978 journeys, every one passed after the
review's fixes but the Mac-only `backups.spec.ts:93`; 40 of 40 mutants
caught. CI is GitHub's, on the pull request. Not yet seen on a real phone.
Branch: `feat/stage2-new-model`. Task: the tenth batch, chosen in chat
after #178 was opened (2026-11-08, «go next do»).
Chosen: business-rules.md, "Chosen in chat — 2026-11-08 (stage 2 batch 10:
a new model where the coat is in hand — …; goods P0-1, P1-1, P2-4)". The
owner's questions stand by their (а): В-Г1 (a model is added from an empty
search where goods arrive, are found and are listed), В-Г2 (not at the
till), В-Г6 («Джерело», one neutral word).

Where these screens still did their own way:
- The catalogue's search asked only on «Знайти», and found nothing it
  said «Нічого не знайдено. Якщо це новий товар, спершу створіть його в
  каталозі.»: a dead end. A coat the catalogue did not have meant leaving
  the delivery — its lines lost — for «Ще» › «Товар і каталог» ›
  «Перевірка каталогу» › «+ Нова пропозиція» › «Зберегти пропозицію» ›
  «Створити товар з опису», a form of seventeen fields that sent one size.
- «Перевірка каталогу» was one long page: a native list for the queue's
  state, the proposal's candidates as radio buttons, its refusal's field,
  the product form and «Свідчення про назву — за бажанням» under one
  scroll, about thirty things at once.
- One field `source` had two names, «Джерело / постачальник» and «Фабрика
  або бренд», each saying what it is, which nobody knows.

## What exists now

- **The search (P0-1):** asked as it is typed, from two letters, 300 ms
  after the last; no «Знайти». Rows of the models found; a tap puts the
  keyboard away and chooses. Nothing found: «Нічого не знайшли за «…»» and,
  where the screen may add one and the person may create and confirm in
  this store, a quiet «Додати нову модель «…»». The till's search is live
  too and has no such button.
- **The sheet «Нова модель»** over «Прийшов товар», both forms of
  «Знайшли товар…» and a line of «Початкові залишки»; the lines under it
  stay.
  - «Як записано» — the search, as typed — and «Далі», which saves the
    proposal;
  - «Може, це модель, що вже є?»: the catalogue's candidates with «Це
    вона», none chosen, «Підтвердити: …» once one is; «Ні, це нова
    модель»;
  - «Нова модель · Інший колір нашої моделі», «Назва моделі» or the model
    found, «Колір», every size as a cell, several at once; «Іншого розміру
    немає — впишіть» with its system asked; «Ще ознаки» folded;
    «Залишок не додається — кількість впишете тут.»; «Додати модель · 2
    розміри».
  - Recorded: the sheet goes, the model is chosen on the screen and the
    stub says «Модель додано: … Кількість впишіть тут.».
  - Telegram's MainButton is the sheet's while it is open: «Далі»,
    «Оберіть модель» held, «Підтвердити: …», «Додати модель · …».
- **«Перевірка каталогу» (P1-1):** «Чекають · Підтверджені · Відхилені»
  over rows of the words in quotes and their sticker; «Оновити» and «Нова
  пропозиція» in the header. A proposal is its own screen: its words
  large, the reasons, the candidates with «Це вона», «Підтвердити: …»
  docked, «Створити нову» (the sheet at its third step) and «Відхилити» (a
  sheet with the reason). The name's answer is folded under «Цей опис —
  назва товару?».
- **«Джерело» (P2-4):** the one word for `source`.

## Decided here, not by the owner

All in business-rules.md under the heading above. In short:
- **No size-system chips over the cells.** The task list drew a system's
  chips and then its cells; ADR-0009 says a size system does not separate
  sizes — M is one size whichever system it was typed under — so every
  size is a cell, in the server's reading order. The system is asked only
  for a size typed by hand, «Літерна · Числова EU · Інша», none chosen for
  the person, as the old form's choice had no default; a typed size the
  organisation has needs none.
- **The MainButton stays the sheet's** for as long as it is open, held
  where it cannot be pressed: hidden, Telegram showed the screen's under
  it, and «Записати прихід · …» could be pressed through the sheet.
- **«Ще ознаки» opens by itself** when the server refuses a model of a
  name it has, so «Окрема модель зі схожою назвою» is in sight.
- **A cancellation that finds the model saved** shows it as added and
  chooses it, as the kept notice promises.
- **A proposal left in its sheet opens its own screen** in «Перевірка
  каталогу»: the queue is oldest first, and it would be on the last page.
- **No «Тетяна, 11:40» on the queue's rows:** the server's proposal has
  neither its author nor its time.
- **The name's answer folded is the opt-in:** the checkbox «Зберегти
  підтвердження назви» is gone; unfolding is the choice to answer. Nothing
  is sent unasked.
- **Buzzes:** a first answer's success or refusal is felt in «Перевірка
  каталогу» and in the sheet; a kept operation's later checks, nothing.
- An empty search field asks nothing; the stub's model is the catalogue's
  one name for it.

## How it was built and proven

- **Files:**
  - `frontend/src/inventory/CatalogPicker.tsx` (rewritten): the live
    search, the empty answer and its button, `AddedStub`;
  - `frontend/src/catalog/NewModel.tsx` (new): the sheet's three steps on
    the catalogue's commands;
  - `frontend/src/catalog/KeptCatalog.tsx` (new): the kept operation's
    notice, checked by the phone, shared by the screen and the sheet;
  - `frontend/src/catalog/Catalog.tsx` (rewritten): the queue's switch and
    rows, the proposal's screen, the refusal's sheet, the folded name;
  - `frontend/src/catalog/commands.ts`: `useCatalogJournal` (the journal's
    key and whose phone it is, for a sheet on any screen) and
    `catalogMessage`;
  - `frontend/src/catalog/CreateProduct.tsx`: removed;
  - `frontend/src/catalog/modelTypes.ts`: «Джерело»;
  - `frontend/src/App.tsx`: the journal's key and person set where the
    catalogue's journal is read;
  - `frontend/src/inventory/Receive.tsx`, `Stocktaking.tsx`,
    `Stocktake.tsx`, `frontend/src/openings/Openings.tsx`: `adds`, the
    model chosen from the sheet and its stub;
  - `frontend/src/styles.css`: the found rows, the empty answer, the
    sheet, the queue's rows, the proposal's screen.
  - No backend change.
- **Journeys:** 978 in all (968 after batch 9).
  - **10 new** (two of them for the review's fixes, below):
    - «Прийшов товар»: a model added from the empty search — the line
      counted before stays, none of the candidates chosen, «Оберіть
      модель» held, two sizes at once, «Додати модель · 2 розміри», the
      stub, the receipt holding both lines, the proposal confirmed with
      the words as typed;
    - without `catalog:create`, then without `catalog:confirm`: only
      «Нічого не знайшли за «…»»;
    - the live search: one letter not asked after 0.7 s; «лоран шоколад»
      typed letter by letter asked once; no «Знайти»;
    - inside Telegram at 360 px: «Далі», «Оберіть модель» held (never
      «Записати прихід» from under the sheet), «Додати модель · 2 розміри»;
      the sheet ≤ 92 % high and within the width, light and dark; the
      delivery's own button back after;
    - a similar spelling offered, never put in the field; the sheet left
      by «Назад», the delivery as it was;
    - «Інвентаризація»'s «Знайшли товар…»: a model added there, counted
      from nought;
    - a line of «Початкові залишки»: its model added, «Як у списку: 2 шт.»
      kept, the answer saved;
    - the proposal's screen at 360 px, light and dark: the words, the
      first candidate and the docked «Підтвердити: …» in sight;
      «Створити нову» and «Відхилити» clear of the dock;
    - a kept proposal refused: said in its own sheet, never in the next;
    - without `inventory:receive`: the sizes typed, none asked.
  - **Steps added:** the stocktake's found form opens the sheet with its
    search and is as it was when left; the till's empty search offers no
    model.
  - **Rewritten to the new names and roles:** every journey of
    `catalog.spec.ts`; the creations of `models.spec.ts` and
    `size-spelling.spec.ts` (shared helpers in `fixtures.ts`:
    `newModelSheet`, `propose`, `sizeCell`, `typeSize`, `addModel`,
    `leaveNewModel`); Telegram's «Назад» over «Перевірка каталогу» — the
    sheet, then the proposal, then «Ще»; the sixteen «Знайти» taps in
    nine files; «a model in two sizes in 7 taps» (8 with «Знайти»).

## The independent review

A separate agent read the uncommitted change against the TZ, the rules,
the old screens and the server, with no access to my reasoning. Ten
findings and five journeys weaker than their titles:

- **Fixed:**
  1. A size typed by hand could not be counted after the model was added:
     the screens under the sheet kept the organisation's sizes from
     before. The sizes are read again once a model is added.
  2. Both «Знайшли товар…» forms still said «Нічого не знайшли за «…»»
     beside «Модель додано», with «Додати нову модель» live for a
     duplicate; a search found empty before came back from memory. The
     remembered searches are dropped once a model is added, and the empty
     answer goes for the words it was added for.
  3. On a line of «Початкові залишки» one stub stood under every part. It
     is kept by model now.
  4. Telegram's «Назад» stayed shown, and did nothing, while the sheet
     waited for the server or kept an operation. `Sheet` takes `held`, as
     `Back` does, and «Нова модель» and «Відхилити пропозицію» pass it.
  5. A kept operation's refusal showed in any sheet opened later, with
     words of actions it does not have. A sheet says only the refusals of
     what it sent.
  6. The same letters typed twice under two systems gave two cells and two
     sizes; a system chosen for one size stayed for the next. Now the
     second is that size and the system is asked again whenever the
     letters change.
  7. The sheet got the search trimmed: it gets the words as typed.
  9. A role with `catalog:create` and `catalog:confirm` but without
     `inventory:receive` got «Немає доступу» in the sheet: the sizes are
     not asked then, and are typed, as the old form had them.
  10. The cursor dropped to the page between the steps: it stands on the
     words in quotes at the step's top.
- **Not changed:** 8. The name's buttons stay live after an answer is
  saved. It was so before; the server keeps one answer and a second tap
  says «вже збережено інше рішення». Not a regression.
- **Journeys tightened:** the Telegram journey now counts two lines first
  and presses the held «Оберіть модель» (nothing sent), and checks «Назад»
  hidden while the model is on its way; the 360 px proposal journey checks
  «Створити нову» and «Відхилити» clear of the dock at the page's end; the
  live search proves two letters are asked; the delivery keeps two lines
  around the sheet; a size typed in the sheet is counted in «Знайшли
  товар…» and the empty answer is gone.
- **New journeys for the fixes:** a kept proposal refused is said in its
  own sheet and never in the next one; a person without
  `inventory:receive` types the sizes, nothing asked or refused.

## Mutants

40 mutants (`mutate27.py`, `mutants27.sh`): each one change to the source
— the search's pause and its two letters, the empty answer's words and
its rights, the stub, the candidate never chosen, the MainButton held, the
sizes' words and cells, the typed size's system, «Ще ознаки» on
`CATALOG_AMBIGUOUS`, the refusal's words, the buzzes, the cancellation that
finds the model saved, the queue's switch, sticker and dock, the name's
fold, and every review fix — applied on a fresh seed, its journey run, the
source restored.

- First pass: 37 of 40 caught.
- Three survived, all from journeys weaker than they looked:
  - `mayconfirm`: the rights journey's second pass never re-read `/me` —
    `launch()` only changes the hash — so it kept the first pass's rights.
    Each pass now loads the page afresh.
  - `dock`: at 360 × 640 the proposal fits, so a dock that does not float
    stood where the floating one does. The journey now also checks it at
    360 × 400, where only a floating dock is whole in sight.
  - `typedsystem`: aimed at a journey that types a size the organisation
    has. Now aimed at the delivery's, which types one it has not and checks
    «Додати розмір» held until a system is chosen.
- Second pass of those (with `maycreate`, which shares the loop): all four
  caught, each where its journey says — the rights' «Додати нову модель»
  count, «Додати розмір» held, the dock whole in sight. **40 of 40.**
- Not a mutant of its own: the stub kept by model on a line of «Початкові
  залишки» with several parts — the list journey has one part; the words
  as typed with spaces at their ends.

## Evidence

- **Runs** (`~/.cache/birka-runtime/helpers/`):
  - before the review: every journey on a fresh seed, 975 of 976
    (`go-b10-full1.log`); the one failure `backups.spec.ts:93`, which
    fails on the Mac only (the copies' clock), as in every batch;
  - after its fixes: the batch's ten specs on a fresh seed, 114 of 117
    (`go-b10-fix2.log`) — three journeys' expectations corrected: Telegram's
    «Назад» now hides while «Далі» sends, a re-search is found from the
    refetch made as the model was added, the dock rests above the last two
    buttons at the end; then catalog, receive and telegram-back on a fresh
    seed, 46 of 46 (`go-b10-fix4.log`);
  - catalog.spec run twice on one seed fails on «Лоран шоколад 70 см»
    pushed out of the ten candidates — the known crowded database, not
    this change (`go-b10-fix3.log`; that run also crossed the Mac's sleep);
  - the last, after every fix: every journey on a fresh seed, 962 of 978
    (`go-b10-full2.log`). The Mac slept and woke again and again under a
    closed lid through it (`pmset -g log`), with `xcodebuild` beside it:
    the sixteen failures are page loads and sheets' «ready» timed out, in
    sections this batch does not touch but for one delivery journey.
    `backups.spec.ts:93` aside, the fifteen ran again on a fresh seed,
    after `correct.spec.ts` as in the whole order: 27 of 27
    (`go-b10-rerun1.log`). Every journey has passed after the fixes but
    the Mac-only one.
- **Checks:** `tsc --noEmit` adds no error (the ones it reports are in
  other specs, as at the baseline); Prettier clean on the files changed
  here, and on my hunks only in `Openings.tsx`, `fixtures.ts`,
  `telegram-back.spec.ts`, `App.tsx` and `styles.css`, which are not clean
  at the baseline.
- **Screenshots** (Mac's font; CI's DejaVu checks the bounds):
  `new-model-similar-360-{light,dark}.png`, `new-model-360-{light,dark}.png`,
  `catalog-proposal-360-{light,dark}.png`. Seen: the sheet's candidates,
  the cells with two chosen, the docked «Підтвердити: Лоран шоколад 70 см»
  over the menu. Small things seen: the proposal's reasons run to four
  lines at 360 px; the sheet has a wide gap over «Назва моделі».

## For the owner

Nothing new to ask. В-Г1, В-Г2 and В-Г6 were taken at their (а); the
decisions above are theirs to overturn, each in business-rules.md.

## Not covered

- A real phone: Telegram's MainButton over the sheet, the keyboard over
  «Назва моделі», the sheet's pull on a small screen.
- CI's font: the 360 px screenshots were taken on the Mac; the bounds the
  journeys hold (≤ 92 % high, within the width) are checked on GitHub's
  run.
- «Джерело» has no journey of its own: it is the label of a folded field.
- `Borrowed.tsx` and `Invoices.tsx` still search their own way — outside
  this batch's points.
- The rest of the goods list: P0-5, P0-6, P1-2, P2-5.
