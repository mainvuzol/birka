# «Усе на бірці», audit 2026-11-15, batch 7: «Каса»'s tail — «Змінити спосіб оплати» on a collected order only while the server says the way may be changed; «Операції дня»'s rows that open with their chevron — 2026-11-17

Baseline: `9e5291c5` (main after #220). The orders-cash task list's last open
points (`.ai/project-memory/redesign/2026-11-15-redesign-tz-audit-orders-cash.md`):
- P2-3, by its option (а): the owner's question В15-З1 is still open, and the
  task list says to build (а) until it is answered;
- P2-4.

Picked by «merged, go next».

Nothing recorded, sent or counted changes. Who may change a way, and when,
is the server's, as before: the phone shows only what the server answers. No
word on a screen changes.

Status: built and proven; not committed; not yet seen on a real phone.
- Journeys: 1181 (1179 before).
- Branch: `feat/audit-1115-cash-tail`.
- Decisions: business-rules.md, "Chosen in chat — 2026-11-17 (audit 2026-11-15, batch 7: «Каса»'s tail …)".
- Owner: В15-З1 still open. At (б), the link comes back as it was.

## What exists now

- **«Змінити спосіб оплати» on a collected order** (P2-3 (а)):
  - offered, as before, where «Каса» is opened and the server gives this
    person the sale's way (G32);
  - now only while the server says the way may be changed now: `may_change`
    of «Каса»'s own read of the sale's way (`/cash/sales/{id}/method`,
    under «Каса»'s own key, so its screen opens on the same answer);
  - its read failed: no link, nothing said; «Оформити повернення» as before.
- **The card and its way read together:**
  - from its row in the list or «Сьогодні»'s search, both are asked at once;
  - the card is drawn once both are answered, so nothing comes under it later;
  - a way read before is read again first, so a close since is never drawn
    as «may» (review);
  - the way is waited for a second at most past the order's own answer, then
    the card is drawn (review).
- **A card already drawn** («Клієнт забрав» just pressed, kept and confirmed
  later, read again collected, or its way slow):
  - the link's place is held under the stub, unseen and out of reach;
  - the link comes into it, nothing under it moving;
  - where the server says no, the place goes once.
- **«Операції дня»** (P2-4):
  - a row that opens its card has the chevron of 16 in pencil, on the
    title's first line beside the sum, as «Ваші операції»'s;
  - a row that may not be changed has none, and keeps its sum in the same
    column.

## How it was built and proven

Sources:
- `App.tsx`: the way's read beside the card's, the card's wait (its cap and
  its reset on leaving), the link only on `may_change`;
- `orders/Order.tsx`, `orders/Collected.tsx`: the link's held place in
  `SaleLinks`;
- `cash/Cash.tsx`: the chevron in the row's head, beside the sum;
- `styles.css`: `.link-held`, `.correct-end`.

New and changed journeys:
- `orders-card.spec.ts`:
  - a stub of the way's read (`may_change` as asked, by default «may»;
    failed; held);
  - **a collected order seen later**:
    - «may not»: no link, the return there;
    - failed: no link, nothing said;
    - «may»: the way asked while the order's own read is held. The order
      answered, the card still waits. Answered, the link, and «Доставка»
      unmoved;
    - left and opened again with «may not» held: the card waits, never the
      «may» read before;
    - the way slow: drawn within a second, the place held and unseen, the
      link into it, nothing moving;
    - the link leads to the operation's card in «Каса», nothing sent;
  - **«Клієнт забрав» just recorded**:
    - the place held, unseen, unfocused, then the link in it and «Доставка»
      unmoved;
    - where it may not, no link and no place.
- `cash-correct.spec.ts`:
  - yesterday's rows each have a chevron of 16 in pencil, on the title's line
    with the sum, at 360, with no «›»;
  - the row from before the first count has none, its sum in the same column
    (28 inside the row's padding);
  - taps 7 and 6 as before.

Touched specs on a fresh seed:
- first run: 72/74 (P2-4's measure taken from the row's edge, not its
  padding);
- the order and cash specs around it on a fresh seed: 355/355 (`orders`,
  `orders-card`, `orders-list`, `order-shipping`, `outage`, `credits`,
  `cash`, `cash-correct`, `cash-polish`, `cash-move-fix`, `telegram-rules`);
- after the review's fixes, `orders-card` and `cash-correct`: 74/74.

## The review

An independent review covered:
- the card's wait for every way a card opens;
- the shared key with «Каса»;
- financial integrity;
- the held place's reach;
- P2-4 at 360;
- the tests.

It found nothing High. `tsc` and `eslint` are clean.

Checked and found right:
- **Every way a card opens:** the list's row, another order's row with the
  same waybill (no row read), «Сьогодні»'s search, «Клієнт забрав» on the
  card or from a row's sheet, a kept one confirmed later, a re-read turning
  it collected. No placeholder stuck or flashing back, and no link for
  another sale.
- **The shared key:** the same URL and answer as «Каса»'s screen.
  `changed()` reads it again after a close or a correction.
- **Financial integrity:** nothing is decided on the phone; the server
  checks who and when again at the press.

Medium, fixed:
- **A slow way held the whole card**, up to the 20 s timeout, with its
  delivery, waybill and return. Now the card waits a second at most past
  the order's answer, then is drawn with the link's place held.

Low, fixed:
- **The drawn card was never forgotten.** Back on the list, it was still
  «drawn», and a way read before (a «may» from before a close on another
  phone) was drawn at once, then taken away. Now:
  - leaving the card forgets it;
  - a first draw also waits for the way's re-read.
- **The waiting check could pass with the wait gone.** The card was looked
  at before the order's answer was drawn. Now the journey waits for that
  answer and two frames, then looks once; it also shows the two reads asked
  together.
- **A held place answered «may not» goes, and what is under it moves up
  once.** Recorded as decided here.
- **Nits:**
  - the held place is no longer `disabled` (unseen, it needs no look of its
    own);
  - the 28 px column is explained in the CSS.

Left with a reason:
- **The return's own read of the same way** (`Returns.tsx`, another key)
  stays as it is: another screen, no collision.
- **Past the second, a way read before stands until read again.** A rare
  slow re-read, and the server refuses at the press as before.

## Mutants

`~/.cache/birka-runtime/helpers/mutate67.py`, run with `mutants67.sh` on the
seed above. Each mutant is applied, its journey is run once (`pw-slow`, no
retries), and the source is restored.

15 of 15 caught, each by the journey named for it: 11 for P2-3 (а), 3 of them
added after the review, and 4 for P2-4.

- P2-3 (а):
  - `maychange` (the link whatever the server says);
  - `cardwaits` (the card not waiting);
  - `parallel` (the way asked only after the order);
  - `saleid` (the link to no sale);
  - `drawn` (a drawn card back to waiting);
  - `heldprop`, `heldplace` (no place held);
  - `heldhidden` (the place seen);
  - after the review: `refetch` (a way read before drawn at once), `reset`
    (the card never forgotten), `cap` (no second's cap).
- P2-4:
  - `chevronall`, `chevronnone`;
  - `endcolumn` (a disabled row's sum out of the column);
  - `endline` (the chevron under the sum).

Not a mutant:
- `aria-hidden` and `tabIndex` on the held place: the unseen place is already
  out of reach.

## Not covered

- The look on a real phone.
- The full suite is left to CI.
- В15-З1: the owner's answer may undo P2-3.
