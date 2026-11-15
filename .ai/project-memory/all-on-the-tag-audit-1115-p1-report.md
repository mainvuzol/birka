# «Усе на бірці», audit 2026-11-15, batch 1: a session's end one screen; a kept attempt's fate on its stub alone; «Покупці»'s rows dated; the cash move on Бірка's keypad; one order of stores; a cancellable line's chevron; a return's short line marked — 2026-11-15

Baseline: `de66d769` (audit 2026-11-13, batch 12, PR #213, merged). The
audit 2026-11-15 (its ten files, carried on this branch) has no P0 and
seven P1s: frame P1-1, P1-2; sale P1-1; orders-cash P1-1; money P1-1, P1-2,
P1-3. The user chose all seven as one batch.

No request body, right or rule of what is recorded changes, and nothing
is counted on the phone. One word on a screen changes: the move's sum is
labelled «Сума, грн». P1-3's refusal words wait on В15-Г1 and are as they
were.

Status: built and proven; not committed; not yet seen on a real phone.
- Touched specs on a fresh seed, 403 of 403:
  - `session`, `outage`, `credits-list`, `today-search`;
  - `cash-move-fix`, `cash`, `cash-close`, `cash-polish`;
  - `money`, `supplier-invoices`, `suppliers`;
  - `failures`, `returns`, `credits`, `cash-kept`.
- After the reviews' fixes and the mutants' stronger journeys, nine specs were run again on a fresh seed, 307 of 307: `suppliers`, `outage`, `session`, `credits-list`, `credits-debt`, `supplier-invoices`, `cash-move-fix`, `first-sign-in`, `today-search`.
- The whole suite is left to GitHub CI, by the user's word.
- Mutants: 43 of 44 caught; one is equivalent (see «Mutants»).
- Backend: `test_supplier_returns.py::test_only_goods_free_to_sell_go_back` passes against the E2E database.
- Two reviews ran: an independent one, and one for money and stock safety. Their findings are fixed, or left with a reason.
- Journeys: 1155 (1143 before).
- Branch: `feat/audit-1115-p1`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-15 (audit 2026-11-15, batch 1: …)".

## What exists now

- **A session's end is one screen** (frame P1-1).
  - What triggers it: a 401 to a request sent with the token, of any code but `NO_ACCESS`. `api()` notes it in `frontend/src/shared/sessionEnd.ts`, a zustand flag kept in memory only.
  - What `App` draws instead of the workplace: the blank «Вхід через Telegram» in S02's words. « Незавершене збережено.» is added only where the phone keeps this person's operation.
  - What is gone: the menu, the plates and «Спробувати ще раз», mid-work and at the door.
  - `/me` is no longer asked with the token, and the workplace's reads leave with it.
  - Telegram's question before closing stays as it stood when the session ended (review).
  - `NO_ACCESS` is unchanged: S03 at the door, a read's plate mid-work.
- **A kept attempt's fate on its stub alone** (frame P1-2). `onStub(kept, error)` in `Workspace` holds back a journal's red plate while it keeps its attempt and its last send had no answer. The journals are the sale's, a delivery's, a return's, a debt's payment, a correction, a count and an order's step. Any server answer, and an attempt the phone could not keep, keep their plate.
- **«Покупці»'s rows dated** (sale P1-1).
  - `rowWhen(customer)` in `credits/format.ts` gives «останній внесок дд.мм» (latest payment), «з дд.мм» (earliest opened) or «закрито дд.мм» (latest close).
  - The date is in `.debt-when`, which does not wrap, after the goods.
  - Dated only in «Покупці»'s own rows: never at the till's «Внесок», nor its other-store rows, nor «Сьогодні»'s search.
- **The cash move on the keypad** (orders-cash P1-1).
  - `Move` takes the sum on `Keypad` (label «Сума, грн»).
  - The phone's keyboard never opens over «Видати … грн».
  - Nothing is focused on open or on a chip; a refusal puts the cursor back in the sum.
  - At ≤ 700 px tall, keys are 44 and the sum's box is 64.
- **One order of stores** (money P1-1). «Ви винні постачальникам» keeps the report's order. The open store's column is still the one way to «Накладні». This revises "It comes first", which had been chosen in chat.
- **A cancellable line's chevron** (money P1-2).
  - An invoice's history line that may be cancelled ends in the set's chevron, 16 px, in pencil.
  - The others keep the place empty (`.timeline-open`), so the sums stand in one column.
  - The pressed line is at least `--touch` high.
- **A return's short line marked** (money P1-3 (а)).
  - On `INSUFFICIENT_STOCK` the warehouse's goods are read again, and a model left open with nothing counted is put away.
  - The line the server named, for the return's warehouse, carries a warn sticker «вільно N» under its count. Its «Прибрати» is described by it.
  - The mark goes with that line's «Прибрати», another warehouse, or the next send.

## The reviews

Independent review (correctness, regressions, specs):
- **Medium: fixed.** Telegram's question before closing was released as the workplace unmounted on the end screen. A sale kept after a 401 closed without asking.
  - Now `App` reads whether the question is held (`askingBeforeClosing()`, new in `shared/telegram.ts`) as the session ends, and holds it on the end screen.
  - The question settles a microtask later, so Telegram is told nothing new.
  - At the door nothing held it, so nothing is asked.
  - The 401 sale journey now runs in Telegram and checks it.
- **Low: fixed.** A model open as the return was refused kept its old «вільно N». It is put away, and the journey checks it.
- **Low: left.** The keypad takes nothing malformed, so «Вкажіть суму з точністю до копійок.» can no longer show. It stays as the TZ's guard, and the comment now says so.
- **Low: fixed in part.** The chevron's absence is now checked on a write-off line and on a payment on a closed store's invoice: there it is cancellable and the chevron shows. No journey covers a non-trading open store (`readOnly`); its guard is unchanged.

Money and stock safety review: no High, no Medium.
- Verified:
  - the keypad's «1500,5» → 150050 kopecks → «1500.50» sent and shown alike;
  - zero, empty and «150,» are handled (the last is sent as 150,00, as the button says);
  - a fresh `command_id` per press; the busy guard;
  - the kept path is unchanged;
  - «Гроші» only reordered, no cross-store total;
  - `available` is on-hand minus held, at the return's location, under lock;
  - the invoices' cancel is unchanged.
- **Low: fixed.** Taking out any line cleared the mark. Now only the marked line's own «Прибрати» clears it.
- **Low: fixed.** The refusal's warehouse was not checked. `shortOf` now requires `location_id` to be the return's, and the mark is drawn only on that warehouse.
- **Low: left.**
  - The server names the first short line only, so a second one is marked on the next send.
  - The mark is what was free at the refusal; the server checks again on each send.
  - The 2026-10-22 rule's "cursor in «Сума»" is revised in business-rules.

Found and left for its own task: a sale whose attempt the phone cannot write (storage full) is never sent and says «Не вдалося виконати операцію. Спробуйте ще раз.». Its stub, held in memory alone, still says not to type it from paper. This is the sale journal's logic (`frontend/src/sales/commands.ts`, `pending` set before `localStorage.setItem`). It is outside this batch.

## How it was built and proven

- `frontend/src/shared/sessionEnd.ts` (new), `shared/api.ts`, `shared/telegram.ts`, `App.tsx`.
- `credits/format.ts`, `credits/CustomerRow.tsx`, `credits/Credits.tsx`.
- `cash/Move.tsx`, `money/Money.tsx`, `suppliers/Invoices.tsx`, `suppliers/NewReturn.tsx`, `styles.css`.
- Backend test only.

New and rewritten journeys:
- `session.spec.ts`:
  - the P2-6 journey rewritten: each memory state is a new opening, with no «Спробувати ще раз»;
  - a session ending mid-work, as a seller from the till and as the owner from «Сьогодні», with the 360 × 640 light and dark check;
  - `NO_ACCESS` mid-work.
- `outage.spec.ts`, group 12 (frame P1-2):
  - a sale with no answer;
  - a return, a payment and an order's step checked as the store opens;
  - a 500 keeps its plate;
  - a sale the phone could not keep;
  - a 401 on a sale, in Telegram.
- `credits-list.spec.ts`: rows' dates. `credits-debt.spec.ts`: no date at the till.
- `cash-move-fix.spec.ts`: the keypad, its layout at 44 and taps 4/3.
- `money.spec.ts`: the order from «Ринок».
- `supplier-invoices.spec.ts`: the chevron, its place, the write-off and closed-store lines.
- `suppliers.spec.ts`: the short line, the open model, another warehouse, another line taken out.

## Mutants

`~/.cache/birka-runtime/helpers/mutate61.py`, run with `mutants61.sh`. Each mutant is applied, its journey run once (`pw-slow`, no retries), then restored. After the run, `check` was clean and no keep file was left.

- frame P1-1 (all caught):
  - `noteend` — `noteSessionEnded` removed;
  - `noteaccess` — `NO_ACCESS` ends the session;
  - `notetoken` — a 401 with no token ends it;
  - `meenabled` — `/me` asked after the end;
  - `overended` — the end not drawn mid-work;
  - `overaccess` — `NO_ACCESS` at the door drawn as the end;
  - `endbutton` — «Спробувати ще раз» kept;
  - `endasks` — the closing question let go;
  - `endwords` — another reading's words.
- frame P1-2 (all caught): `stubsale`, `stubunreach`, `stubreturn`, `stubcredit`, `stubstep`, `stubreceipt`, `stubadjust`, `stubcount`.
- sale P1-1 (all caught): `paidlatest`, `openedearliest`, `closedlatest`, `nopaid`, `owingflag`, `datedtill`, `datedrows`, `datedsearch`, `nowrap`.
- orders-cash P1-1 (all caught): `keyheight`, `sumheight`, `chipfocus`, `refusalfocus`, `keypadlabel`.
- money P1-1 (caught): `owingorder`.
- money P1-2:
  - caught: `chevron`, `emptyplace`;
  - `pressheight` (`.timeline-press` with no min-height) is equivalent here: every history line has its words and its meta line, so it is 44 or more anyway. The min-height stays as a guard.
- money P1-3 (all caught): `reread`, `openmodel`, `mark`, `marktone`, `describedby`, `clearremove`, `clearany`, `markplace`, `marksize`.

The first run left eight alive, and seven were caught after fixes:
- two journeys had been aimed wrong:
  - `notetoken` was aimed at a 422 sign-in, so it now runs on «launch data too old» (`first-sign-in`);
  - `meenabled` now runs on the door's rewritten journey, where `/me` would read again as the app comes back;
- `stubreceipt`, `stubadjust` and `stubcount`: the stage-2 journals' journey now checks that no plate repeats the paper's sentence;
- `sumheight`: the sum's box is measured;
- `clearremove`: the size added to the list again is checked to carry no old mark.

## Not covered

- A non-trading open store's invoice history (`readOnly`) — no journey; the
  chevron follows `cancel`, whose `!readOnly` is unchanged.
- The keypad's rejection of a pasted malformed sum (shared `Keypad`
  behaviour, not new here).
- The end screen's look on a real phone; screenshots of the seven points.
