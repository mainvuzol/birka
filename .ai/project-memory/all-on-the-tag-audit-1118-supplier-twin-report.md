# «Усе на бірці», audit 2026-11-18, batch 4: «Повернути постачальнику» the twin of «Прийшов товар» — «У поверненні» rows on a white block, its choices and refusals felt; the return's and «Позичене»'s results a result's screen; a held stepper drawn, never faded; «Надійшло»'s row names meta; a whole list's nothing found the empty place — 2026-11-18

Baseline: `f94468bc` (main after #227).

Points, all P2: money P2-1 (а)(б), P2-2 and P2-4 (а)(б)(в). This is the
money task list's own batch, «Близнець приходу». Picked by «merged, go
next».

P2-3 is not built. It waits for Д1: whether Telegram's «Далі» moves the
cursor by itself on iOS and Android. Only a real phone shows that.

Nothing recorded, sent or counted changes. No request, check, journal,
right or word changes.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1200 (1198 before).
- Branch: `feat/audit-1118-supplier-twin`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-18 (audit
  2026-11-18, batch 4: …)".

## What exists now

- **«У поверненні» rows on a white block** (money P2-1 (а)), drawn as «У
  поставці»:
  - the list is `ul.receive-lines.list-block`;
  - each row shows «{модель} · {розмір}» 17/600 in ink, with «N шт.» under
    it in the meta's 14;
  - «Прибрати {модель}» is a quiet button under them;
  - «вільно N» is a warning's sticker under «N шт.»; its
    `aria-describedby` is as before.
- **Felt as its twin** (money P2-1 (б)):
  - Choosing a warehouse's chip or taking a model gives `selection`, only
    when the choice changes.
  - «Оберіть постачальника.», «Такий рядок уже в списку…» and «В одному
    поверненні — до 100 рядків…» give `error` when pressed; nothing while
    typing.
- **The return's result and «Позичене»'s are a result's screen** (money
  P2-2):
  - Outside Telegram, «Готово» sits in the result's dock at the menu's
    top and sticks there on a long stub.
  - Inside Telegram, it is Telegram's MainButton, with no dock.
  - The return keeps «← Постачальникам» and Telegram's «Назад» over its
    title. «Позичене» keeps its screen's header.
  - The form's dock lets its room go on the result: only the result's dock
    is kept clear.
  - By the review, the menu is back under the return's result before it is
    painted, as on «Прийшов товар»'s and «Борги»'s. The form keeps it
    aside.
- **A held stepper is drawn, never faded** (money P2-4 (а)):
  - Where: «Менше» / «Більше» held at their bound in a size's cell of
    «Повернути постачальнику» and «Прийшов товар» (one rule), and in a
    lot's sheet on «Позичене».
  - How: the fold, a dashed edge and pencil, at 4.5:1 in both themes.
  - Nothing is felt and nothing changes at a held press, and the cursor
    stays on it, as before.
- **«Надійшло»'s row names are meta** (money P2-4 (б)):
  - the ways' names and «грн» are 14/19 500 in pencil;
  - «Разом» is 14/700 in ink.
  - Decided here: line height 19, from `meta`; the report's is 18.
- **A whole list's nothing found is the empty place** (money P2-4 (в)):
  - «Список постачальників» shows the blank tag with «Нічого не знайшли за
    «…»», and no empty list under it.
  - The return's «…вільного товару немає.» and the supplier sheet's
    «Нічого не знайшли…» stay lines: `.nothing-yet`, meta 14 in pencil.

## How it was built and proven

Sources:
- `suppliers/NewReturn.tsx`:
  - `selection` on a changed place or model;
  - `refuse()` = the line + `error`;
  - the rows as «У поставці»;
  - the result a `ResultScreen` with «Готово» in its dock outside
    Telegram;
  - the form's `usePanelRoom` only while the form is shown;
  - `recorded` told in a layout effect while the result stands;
  - `.nothing-yet` on the none line.
- `suppliers/Suppliers.tsx`: the menu aside only while the form stands
  (`making` = the new screen and no result), set in a layout effect.
- `suppliers/Borrowed.tsx`: both results a `ResultScreen` (`as="div"`);
  its own dock and `usePanelRoom` are gone.
- `suppliers/SupplierList.tsx`: the list is drawn only when something is
  found; else `Empty` in a `role="status"`.
- `suppliers/Picker.tsx`: `.nothing-yet` on the sheet's line.
- `styles.css`:
  - one held-stepper rule for `.receive-size` and `.lot-count .stepper`;
    the old opacity rules removed;
  - `.money-table` row names and `.money-unit` 14/19.

Journeys (4 specs):
- `suppliers`:
  - the result's screen and no dock in Telegram;
  - `dockOnMenu` at 360×640 and 390×844, the menu shown;
  - the list's empty place in both themes, with no list drawn;
  - the none lines 14 in pencil, in both themes;
  - a held «Менше» pressed keeps the cursor;
  - the rows checked by `blockRow`/`rowTitle` in both themes, with
    screenshots;
  - 2 new journeys:
    - haptics, a model put away felt as nothing among them;
    - a 10-line result outside Telegram: the form's room let go; the dock
      on the menu at 360×640 and 390×844; it stays while the stub scrolls
      at 360×640 and 390×700. At 390×844 ten lines fit over it.
- `borrowed`: both results a result's screen, the menu shown; the held
  «Менше» drawn and at contrast; `dockOnMenu` at both sizes.
- `money`: the table's names and «Разом».
- `receive`: the held «Менше» drawn.

Runs on a fresh seed:
- Touched specs: 153 passed, 2 failed — my own check. «Позичене»'s themed
  result at 360×640 scrolls: its 40-letter name makes it 669 high. The
  check there now allows the scroll.
- Rerun: 4/4.
- After the review's fixes, on a fresh seed: the four specs 79/79, then
  `suppliers-pages`, `supplier-invoices` and `outside-text` 32/32.

## The review

An independent review read the diff against the three points and the
twin «Прийшов товар». It found nothing High. `tsc` and ESLint are clean on
the changed files.

Checked and found right:
- the haptics:
  - the same chip again and typing give nothing;
  - `refuse` gives one `error` per press;
  - the server's refusal and ±1 are as before;
- the room: `--pay-panel-h` is let go on the result; inside Telegram there
  is no dock and no room;
- focus, the heading, «Назад» and every `aria-describedby` target; a kept
  operation's stub gets no place under a result's title;
- the held rule's reach:
  - only Receive, the return and the lot's sheet hold a stepper by
    `aria-disabled`;
  - the basket, «Нове замовлення» and «Пошкоджені» use `disabled` and the
    shared rule;
- the money table: the report's own later rules keep it 14/18;
- no P2-3 haptics leaked in; the new journeys use their own goods and
  suppliers.

Medium, fixed:
- **M1, the long result's scroll proved nothing at 390 × 844.** Ten lines
  fit over the dock there. The journey now says at each size whether the
  page scrolls: at 390 × 844 it does not, and the whole stub stands over
  the dock. The scroll is proven at 360 × 640 and, added, 390 × 700.

Low:
- **L1, fixed: the menu stayed aside on the return's result.**
  - So «Готово» stood at the screen's foot, not over the menu as P2-2's
    criterion says.
  - `NewReturn` now tells «Постачальникам» once its result stands. The
    menu is back before the result is painted, as on «Прийшов товар»'s and
    «Борги»'s.
  - Both return journeys and «Позичене»'s two check the menu is shown.
    Mutants: `returnmenu`, `returnmenulong`.
- **L2, fixed:** the two none lines are checked in both themes.
- **L3, fixed:** a held «Менше» pressed keeps the cursor on it.
- **L4, fixed:** a model put away is felt as nothing (mutant `changefelt`).
- **L5, fixed:** the held rule's comment names the lot's sheet.
- **L6, fixed:** a dead `returned === null` in the form's dock button.
- **L7, fixed:** a name in `money.spec.ts` that shadowed the theme's.
- **L8, kept:** "nothing felt" sees only a buzz in the same turn; every buzz
  here is.

## Mutants

`~/.cache/birka-runtime/helpers/mutate73.py`, run with `mutants73.sh`. Each
mutant is applied, its journey is run once with no retries, and the source
is restored.

27 of 27 caught, each at its own check:
- money P2-1 (а): `linesblock`, `rowclass`, `whatplain`;
- money P2-1 (б): `placefelt`, `modelfelt`, `refusesupplier`,
  `refusetwice`;
- money P2-1 (б), by the review: `changefelt` (a model put away felt);
- money P2-2: `returnscreen`, `returnlong`, `returndockin`, `returnroom`,
  `borrowedscreen`, `borrowedunsold`, `borroweddockin`, and by the review
  `returnmenu`, `returnmenulong` (the menu left aside on the result);
- money P2-4 (а): `stepfade`, `stepdash`, `lotold`, `receivefade`;
- money P2-4 (б): `tablesize`, `tableline`;
- money P2-4 (в): `emptyline`, `emptylist`, `pencilreturn`,
  `pencilpicker`.

Two first survived:
- `returnroom`: the result kept the form's `--pay-panel-h`.
- `emptylist`: the empty list was drawn but hidden by `.list-block:empty`.

The checks were tightened: the long result reads both variables, and the
list is checked absent from the DOM. The plain journeys passed (2/2), then
both mutants were caught.

After the review's fixes all 27 were run again: caught, `returnroom` at
`suppliers.spec.ts:1269` and `emptylist` at `:603`.

## Not covered

- The look and the haptics on a real phone, in Telegram.
- The full suite is left to CI.
- «В одному поверненні — до 100 рядків…» is reached by no journey. It goes
  through the same `refuse` as the other two.
- What is left of the audit 2026-11-18:
  - sale P2-1, and P2-4 (waits for «Прибрати» to be read);
  - orders-cash P2-3, P2-4;
  - money P2-3 (waits for Д1, a real phone);
  - goods P2-1..P2-6.

  В18-К1 and the set-off limit wait for the user's pick too.
