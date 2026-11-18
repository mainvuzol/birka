# «Усе на бірці», audit 2026-11-18, batch 1: a product created says its sizes as the cells do; «Продажу не було» the sale's torn stub under «Продаж» — 2026-11-18

Baseline: `f167805e` (main after #224). This batch carries the audit
2026-11-18's task lists and owner documents
(`.ai/project-memory/redesign/2026-11-18-redesign-tz-audit-*.md`).

Points:
- goods P1-1, the audit's one P1;
- frame P2-3, the stub batch 9 missed.

Picked by «P1 + batch-9 miss».

Nothing recorded, sent or counted changes. No request, check, journal or
right changes. No word changes, but for the size system's code no longer
shown.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1194 (1193 before).
- Branch: `feat/audit-1118-p1`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-18 (audit
  2026-11-18, batch 1: …)".

## The audit 2026-11-18

Five passes from the code and e2e specs, nothing run:
- P0 none;
- P1 one (goods P1-1);
- P2 24: frame 6, sale 4, orders-cash 4, money 4, goods 6;
- one new owner question, В18-К1: how a store moves goods between
  warehouses. Two refusals say «перемістіть», and the app has no move
  screen;
- one logic finding outside the redesign: «Зарахувати повернення» reads
  only the 50 newest returns to a supplier and asks for no more. It needs
  a fix of its own, with a financial-integrity review.

## What exists now

- **A product created says its sizes as the cells do** (goods P1-1):
  «Збережений товар: {назва}. Розміри: M, L». The size system's code
  (ALPHA, NUMERIC_EU, UNSPECIFIED) is no longer shown.
  - Д1, checked against the backend:
    - an organization has one size per spelling whatever its system
      (`uq_size_org_spelling`);
    - a creation drops a spelling given twice;
    - «UNKNOWN» cannot be named there.

    So no two sizes of one creation differ by system alone.
  - The system still orders the cells and is still sent as chosen.
- **«Продажу не було» the sale's torn stub** (frame P2-3): a kept
  empty-shelf record found recorded with nothing sold.
  - On the till it is the torn stub under «Продаж» and its line, tearing
    where it stands, as «Продаж записано один раз».
  - Over any other screen it is a banner over the title, as before.
  - Its words and «Зрозуміло» are as before.

## How it was built and proven

Sources:
- `catalog/Catalog.tsx`: the sizes line by spelling only;
- `App.tsx`: «Продажу не було» as `Settled own={saleOwn}`; `shelfSettled`
  joins the sale's term in `stubUnder`.

Journeys:
- goods P1-1:
  - 13 expectations in `catalog.spec.ts`, `models.spec.ts` and
    `size-spelling.spec.ts` lose the bracket. In `size-spelling`'s «м»
    journey, the cells' order still shows the size kept its own system;
  - a new journey in `catalog.spec.ts` at 360×640: a long name with M and
    L. It checks:
    - the exact words;
    - no system code on the page;
    - the line wrapped within the screen's sides of 16;
    - no sideways scroll;
    - screenshots in both themes.
- frame P2-3, `shelf.spec.ts`'s lost-answer journey, at 360×640:
  - kept, the stub under «Продаж» (`ownStub`);
  - checked, «Продажу не було» under «Продаж», `stub-recorded`, tearing,
    not still; screenshots in both themes;
  - over «Ще», a banner over its title, no place;
  - back on the till, its own «Зрозуміло» lets it go and the place with it;
    nothing sent again.

Touched specs on a fresh seed (`catalog`, `models`, `size-spelling`,
`shelf`): 68/68. After the review's test fixes, the shelf journey passed
again.

## The review

An independent review covered:
- `stubUnder` against every own stub;
- result screens and hidden screens;
- the size resolution in the backend;
- every other place a size system could show;
- the tests;
- the announcements.

It found nothing High or Medium.

Checked and found right:
- `stubUnder` matches every own sale stub exactly;
- result screens give no place;
- the till's own stubs stay where it draws them;
- no other screen shows a size system's code;
- no two sizes of one creation can now look the same;
- `role="status"` is unchanged.

Low, fixed:
- **The tear was not checked**: the journey now checks `stub-tear` and no
  `stub-still`.
- **«Зрозуміло» on the stub itself was never pressed**: the journey now
  presses it on the till and checks the place goes too.

Left with a reason:
- **Two checks in a row**, one «sold» and one «nothing sold», stand as two
  stubs in the app's order. This was a stub and a banner before.
- **The no-till path**: it is the same banner branch the «Ще» check
  covers.
- **Latin and Cyrillic look-alikes in an odd size**: the system's code
  never told them apart.

## Mutants

`~/.cache/birka-runtime/helpers/mutate70.py`, run with `mutants70.sh`. Each
mutant is applied, its journey is run once (`pw-slow`, no retries), and the
source is restored.

8 of 8 caught, each by the journey named for it, at its own check:
- goods P1-1: `sysback`, `sysbackspell`, `sizejoin`;
- frame P2-3: `shelfbanner`, `shelfown`, `shelfunder`; after the review,
  `shelfstill`, `shelfdismiss`.

## Not covered

- The look on a real phone, in Telegram.
- The full suite is left to CI.
- The audit 2026-11-18's other 23 P2s, В18-К1 and the set-off limit wait
  for the user's pick.
