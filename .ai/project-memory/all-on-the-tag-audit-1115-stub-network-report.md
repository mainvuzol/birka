# «Усе на бірці», audit 2026-11-15, batch 9: a kept operation's stub on its own screen under the title and line, as S12; «Покупці»'s empty block among several one look — 2026-11-18

Baseline: `c3f7447f` (main after #222). Open points:
- frame P2-9, a kept operation's stub on its own screen
  (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-frame.md`);
- sale P2-6, «Покупці»'s empty block among several
  (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-sale.md`).

Picked by «merged, go next».

Nothing recorded, sent or counted changes. No request, check or journal
changes. No word on a screen changes: a stub's and a banner's words are as
before, and «Покупці»'s two sentences are only split at the full stop.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1193 (1190 before).
- Branch: `feat/audit-1115-stub-network`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-18 (audit
  2026-11-15, batch 9: …; frame P2-9, sale P2-6)".
- The sale TZ after the audit 2026-11-15 is built whole. The frame's last
  point, P2-5, waits for В15-К1.

## What exists now

- **A kept operation's stub on its own screen** (frame P2-9; spec S12):
  - On the screen it belongs to, the stub («… ще не підтверджено») and its
    torn-off form («… записано один раз») stand right under the title and
    its line, over the screen's own blocks: the paper's plate, the title and
    the line, the stub.
  - This holds for every journal: the sale, the delivery, the return, a
    payment or write-off, a correction, a stocktake's count, an invoice's
    operation, a return to a supplier, an order's step.
  - Over any other screen it is a banner over the title, as before. The
    paper's plate stays over everything, as before.
  - A server's red plate that settles nothing yet stands right under its
    stub, wherever the stub stands.
  - A result's screen (a receipt, «Внесок записано», a return's, a
    delivery's, a collected order) and a screen kept hidden under another
    give no place: another operation's stub stands over them, as before.
  - Drawn again elsewhere on its tab — after «←», over a sale's receipt
    made meanwhile, under a list's row's card — the stub keeps still. It
    sways or tears only where it first stood, and when its tab opens anew.
- **«Покупці»'s empty block among several** (sale P2-6): one look whatever
  the reason. Its lines are `meta` 14/500 in pencil, one sentence a line,
  the fact first, then the step:
  - nobody owes the open store: two lines, «Новий продаж» under them;
  - nobody owes another store;
  - a search that found nobody;
  - none paid, none written off.

  One store alone is as before: the blank tag, and its «none paid» and
  «none written off» stay the short pencil line.

## How it was built and proven

Sources:
- `shared/ScreenHeader.tsx`: `UnderHeaderContext`. While it is given, each
  header draws `.under-header` after itself and hands it over; it takes it
  back as it goes. Nothing is drawn otherwise;
- `shared/Kept.tsx`:
  - `StubPlaceContext`;
  - `OwnStub`: the own stub portaled into the place, or drawn where it
    stood when there is none. It is still when its place is not the one it
    first stood in;
  - `UnderStub`: a kept op's red plate portaled after its stub;
- `shared/Stub.tsx`: `still`;
- `shared/ResultScreen.tsx`: no place while a result is on or the screen is
  hidden;
- `App.tsx`:
  - the places, the first on the page in DOM order;
  - `stubUnder`: every journal's kept-or-settled state and its own screen,
    the same terms its `own` prop is given;
  - the place given to the journal stubs' region only;
  - each journal's error plate in `UnderStub`;
- `credits/Credits.tsx`: `BlockEmpty`;
- `styles.css`: `.under-header` (`display: contents`), `.stub.stub-still`
  and `.block-empty p` in pencil.

New in `e2e/fixtures.ts`: `ownStub`. It checks the stub right after the
header in its place, after its sway or tear has finished. It checks the
place has no box, and the header's bottom over the stub's top. A null title
means a header with no h1 (the model's screen).

New and changed journeys:
- P2-9:
  - `outage.spec.ts`, a new journey at 360×640:
    - a kept sale's stub under «Продаж» and its line, the paper's plate
      over both, swaying; seen in both themes;
    - over «Ще», a banner over its title, no place;
    - recorded, under the title, torn;
    - a new sale's receipt: no place, the stub over the result, still;
    - «Новий продаж»: under «Продаж» again, still.
  - `outage.spec.ts`, the kept kinds: the delivery's red plate under its
    stub under «Прийшов товар». A count, whose list is not open, stands over
    «Продаж» as a banner with its plate right under it, and no place;
  - `ownStub` in each journal's «outcome unknown» journey: `receive`,
    `returns`, `orders-card`, `stocktake`, `correct` (the stub over the
    model's name), `supplier-invoices`, `credits`, `suppliers`.
- P2-6, `credits-list.spec.ts`:
  - `credits()` takes a third store;
  - a new journey in both themes at 360×640. In a network of three stores,
    one owed and two empty:
    - the open store's two lines with «Новий продаж» under them;
    - the other store's line;
    - search, «Сплачені», «Списані» — three lines each;
    - all twelve looks equal to `meta` in pencil;
  - the network's journey expects two lines;
  - the alone journey: the short line `.hint`, no `.block-empty`.

Touched specs on a fresh seed:
- first run: 793/794. One real fault: the order's card under «Товар
  повернувся на склад» is kept hidden (`ResultScreen hidden`). The stub was
  portaled into it and hidden too. Fixed: a hidden screen gives no place;
- after the review's fixes, 793/794: the model's screen has no h1 title,
  so `ownStub` takes a null title;
- the kept kinds' plate check assumed the count's own screen. A kept count
  opens over «Продаж», where its stub is a banner. The check was split by
  kind;
- the ten touched specs whole on a fresh seed: 376/377. The one was the
  check's own selector: a banner is `.banner-kept`, not `.stub-notice`.
  Fixed, both kinds passed.

## The review

An independent review covered:
- the effects' order;
- `stubUnder` against every `own` prop;
- other `Kept` users;
- the CSS;
- P2-6's contrast (≈6.3:1 light, 7.3:1 dark);
- the journeys.

`tsc`, `eslint` and Prettier are clean on the changed files.

High, fixed:
- **The stub was portaled into a hidden screen** (the order's card under
  «Товар повернувся на склад»). Now a hidden screen gives no place.

Medium, fixed:
- **A result's screen took the place**: another operation's stub stood
  between a receipt's title and what it says. Now a result gives none.
- **A kept op's red plate stood apart from its stub**: over the title,
  with the stub under it. Now it follows its stub (`UnderStub`).
- **«Still» was told by time** (a stub drawn some ms after the first). Now
  it is told by place: the one it first stood in.

Low, fixed:
- **`getAnimations({subtree})` could wait on another animation**: the
  helper now waits on the stub's own, and lets an animation cancelled by a
  redraw go.
- **Untested:** a network of three stores (two empty blocks at once), and
  the alone list's short line.

Left with a reason:
- **A stub moved to another place may be read out again** (`role="status"`
  drawn anew). It moves only when its screen changes, and that is when it
  should be heard.

## Mutants

`~/.cache/birka-runtime/helpers/mutate69.py`, run with `mutants69.sh`. Each
mutant is applied, its journey is run once (`pw-slow`, no retries), and the
source is restored.

30 of 30 caught, each by the journey named for it, at its own check.
`termcount` first failed on the base's state: the touched run had left a
stocktake open in its warehouse, so the journey stopped before its count.
On a fresh seed it was caught at its stub's check. `understubcount`, the
same mutation as `understub` against the count, was dropped: over «Продаж»
the count's stub is a banner, which has no place to move to.

- the place: `slot`, `stubunder`, `noportal`, `contents`, `resultplace`,
  `resultonly`, `hiddenplace`;
- the plate under its stub: `understub`;
- still: `stillnever`, `stillalways`, `stillcss`;
- each journal's own screen: `termsale`, `termsettled`, `termreceipt`,
  `termreturn`, `termcredit`, `termadjust`, `termcount`, `terminvoice`,
  `termsupplier`, `termstep`;
- P2-6: `blockmeta`, `blockpencil`, `blockjoin`, `blocksearch`,
  `blocksettled`, `blockwritten`, `blockother`, `blockbutton`,
  `alonehint`.

## Not covered

- The look on a real phone, in Telegram.
- The full suite is left to CI.
- Frame P2-5 waits for В15-К1.
