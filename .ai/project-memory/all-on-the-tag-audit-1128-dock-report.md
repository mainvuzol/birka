# Audit 2026-11-28, batch «Над доком» — 2026-11-28

Baseline: `c799fdd6` (main after #253).

Points: money P2-1 (а) and (б), sale P2-2, goods P2-1 of audit 2026-11-28,
and the owner pack's fixes of sale Н1. The user's pick: «Audit 8 + Д3»,
then «Both, «Над доком» first» (the second batch, «Видно, що чекаємо», comes
after this one is merged).

Only the phone: no right, no journal, no server change, no migration. Who
pays or takes a payment, for whom, and what is sent are as before.

Status: built, reviewed; 14 of 15 mutants caught, the fifteenth
equivalent. Not committed.
- Journeys: 1301 (four new, six changed).
- Branch: `feat/audit-1128-dock`.
- Decision: business-rules.md, "Chosen in chat — 2026-11-28 (audit
  2026-11-28, batch «Над доком» …)".

## What exists now

- **Another store's invoice paid (money P2-1 (а)).** The payment's order:
  what is owed («Винні», the sum, «Сплачено …»), the refusal if one is
  said, the plate «Накладна магазину «…» (закрито). Сплачуєте ви, борг — за
  «…».», the dock. At 360 × 640 «Винні», the sum and the words of what is
  paid stand over the dock as the screen opens (before: under it, Д3 — the
  plate over «Винні» pushed them down ≈ 150 px); the plate is a short
  scroll below, over the keypad. At 390 × 844 all of it is over the dock.
  On the card, with no keypad, the plate stays over «Винні».
- **A refusal on a payment is brought over the keypad each time it is said
  (money P2-1 (б))** — the same words again included — and once more when
  the invoice is read again after it (what is paid may take another
  line). Before, only its first appearance could be seen, if at all: the
  line stood under what is owed, under the dock on a short phone.
- **Another store's debt's «Внесок» (sale P2-2): the same order** —
  «Винні» and the progress, «Історія · N», the paper's fields, the
  refusal, the plate «Продано в «…» (…). Внесок приймаєте ви, борг — за
  «…».», the dock. At 360 × 640 «Винні» and the sum over the dock (before:
  under it); at 390 × 844 the whole card. The detail keeps the plate over
  «Винні». The refusal was already brought over the dock.
- **Lines added: the list on the kind where they wait (goods P2-1).** After
  «Додати файл» or «Додати рядки вручну», the list comes back on
  «Потребують уваги» if any new line needs attention, else on «Чекають» —
  the write's answer says it — with every file's lines. Those lines are read
  while the form's eyelet turns: the list never comes back on the kind it
  was, never says «Тут рядків немає.» under «Рядки додано», never waits
  for its lines. A form left, refused or unanswered: the kind and the file
  shown stay. Nothing felt for it (not the person's choice).
- **Owner pack (sale Н1):** № 76 «три рядки (на боргу покупця закритого
  магазину — теж три, на ширших телефонах — два)»; the developers' table,
  rows 1, 5, 6, 7, 8, quote the words and cite c799fdd6's lines.

## How it was built and proven

Source:
- `frontend/src/suppliers/InvoicePay.tsx` — the order; a `said` ref and a
  `told` counter: each refusal, and the invoice read again after it, bump
  it; an effect scrolls the refusal into view (`block: "nearest"`, the
  page's `scroll-padding-bottom` is the dock's height).
- `frontend/src/suppliers/OtherStoreInvoice.tsx` — its comment.
- `frontend/src/credits/Debt.tsx` — the S21 plate moved under the refusal,
  over the dock; the detail untouched.
- `frontend/src/openings/Openings.tsx` — `linesOf(status, part)` (the
  lines' query options, one source for the key and the read); `addedBack`
  used by both forms' `done`.

Measured (Д1–Д3 of the money TZ, 360 × 640, mobile-chromium, the Mac):
- Д3 before the change: the plate over «Винні», the sum under the dock;
  shorter words alone would not do (≈ 43 px short).
- After: «Сплачено …» takes two lines at 360; its words end at 239.7 with
  the dock's top at 242; the line box's foot reaches 0.375 px under the
  dock. Checked by its words; «Винні» and the sum by their boxes.
- At 390 × 844 the plate stands on the dock: its foot 0.0625 px past the
  dock's top. Checked as «under 1 px».
- Own invoice's refusal at 360 × 640 (Д1): the line stands under the dock
  as the screen is scrolled to the top — the journey proves it before
  each check that the refusal is brought over.

Journeys:
- New (`credits-debt`): «another store's debt on S21 at 360 × 640, light
  and dark …» — «Винні» and the sum over the dock unscrolled, the header's
  line naming «Ринок», the plate's words and «і», after `.owed-card` and
  before the dock, over the dock once brought into view; 390 × 844, the
  card over the dock; inside Telegram (8.0, the MainButton opens S21), the
  same. Screenshots `debt-till-elsewhere-360x640-{light,dark}.png`.
- New (`credits-debt`): «another store's debt refused on S21 …» —
  PAID_WHERE_SOLD twice: each time its words over the dock, before the
  plate; scrolled to the top in between (the words under the dock).
- New (`supplier-invoices`): «inside Telegram another store's invoice is
  paid by the app's own button …» — the card's plate over «Винні»; the
  MainButton «Сплатити», hidden on the payment; the payment's order and
  room at 360 × 640.
- New (`openings-file`): «lines added go where they wait …» — a list of
  one file; «Показати рядки» of file 1; «Додати файл» left — the file's
  lines still shown; a file of two lines (one with the parser's note,
  needing attention; one read whole, waiting): «Потребують уваги» pressed,
  no file's line, its first line in view, no «Тут рядків немає.»;
  «Розібрані 0» (empty), typed lines refused (422), lost before the
  server, a gateway's 503 — each time back on «Розібрані 0», empty; then
  added: «Чекають» (the answer's `pending: 1`), the line in view. While
  the form closes, the new kind's lines are read 800 ms late, and
  «Завантажуємо рядки…» is never drawn (a MutationObserver on added nodes).
- Changed (`supplier-invoices`): «an archived store's invoice is paid by a
  store that trades» — the card's plate over «Винні»; the payment's order
  and room at 360 × 640 light and dark and at 390 × 844; a PAID_WHERE_OWED
  refusal over the dock, before the plate, then paid; two bodies posted,
  the same. Screenshots `invoice-pay-elsewhere-360x640-{light,dark}.png`.
- Changed (`supplier-invoices`): «a payment refused as another phone paid
  meanwhile …» — at 360 × 640 the refusal over the dock once the invoice is
  read again; scrolled to the top (the words under the dock), «Увесь
  залишок» and the same refusal again: over the dock once more.
- Changed (`supplier-invoices`): the Telegram payment journey's 360 × 640
  and 390 × 844 loop checks what is paid too, by its words.
- Changed (`credits-debt`): «another store's debt says once where it was
  sold …» — on the detail the plate before «Винні».
- Changed (`openings-file`): «answers lost on their way back …» — on
  «Розібрані», the removed file added again: «Потребують уваги» and line 4,
  by the answer of the send that added it (the TZ's Н1 criterion).
- Changed (`openings`): «a list's refusals the server does not name …» —
  after its typed lines the list stands where they waited, so the journey
  goes back to «Усі» before it opens line 1 (it failed on the new
  behaviour, as it should).
- Telegram's one `success` and no `selection` for typed lines: unchanged,
  `openings.spec.ts:854` (its list of buzzes is exact).

Runs (local, `mobile-chromium`, the isolated stand):
- Each new or changed journey alone, while it was written.
- The touched specs — credits-debt, supplier-invoices, openings-file,
  openings, stores: 134 passed, 6 failed (7.2 min). Five were the stand's
  state (same-name lists, warehouses approved once per seed); one,
  `openings.spec.ts` «a list's refusals …», was this change (above).
- Reseeded, openings-file and openings: 38 passed (3.5 min).
- The detail journey and the two S21 journeys after the detail's check:
  3 passed; the Н1 journey and the new goods journey: 2 passed.
- `tsc --noEmit`, eslint and `npm run build` clean; prettier clean on
  InvoicePay, Openings, the invoices', the files' and `openings` specs;
  `credits-debt.spec.ts` and `Debt.tsx` not prettier-clean at HEAD, so
  formatted by hand (the same drift as HEAD, none added).
- The full suite runs in CI (no local full run).

Mutants (`mutate96.py`) — 14 of 15 caught:
- money: the plate over «Винні» on the payment (outside Telegram and
  inside); the refusal never scrolled; scrolled at the first refusal only;
  not scrolled again after the invoice is read again; the refusal under the
  plate;
- sale: the plate over «Винні» on S21; the plate under «Винні» on the
  detail too; the refusal under the plate on S21;
- goods: the kind never changed; one file's lines still shown; the new
  kind's lines not read before the form closes («Завантажуємо рядки…»
  drawn); «Чекають» before «Потребують уваги»; typed lines as before.
- Equivalent, not caught: the kind set after `back()`. Both run in the
  same tick after the await and React renders them once, with the new
  kind's lines already read: no frame of the old kind exists.
- Also: «the kind never changed» against the Н1 journey — caught.

## Review

An independent read of the diff (read-only, general-purpose), one round.
No bug in the code: what is sent is unchanged; `linesOf()` makes the old
key and read; nothing in `ListView` reacts to the filter while the form is
open; the plate moved only on S21. Its «bug» was a mutant applied on disk
while it read (`told < 0`); the source was restored and checked. Its
points, each settled:
- Tolerances written as rules: the words-not-box check of «Сплачено…» and
  the plate «under 1 px» at 390 were in business-rules as if chosen. Moved
  here (below, «Deviations»).
- Decisions of this batch, not the TZ's, written as chosen: the second
  scroll after the invoice is read again, and «none of either: the kind
  stays». Marked «decided here» in business-rules.
- Test gap: the Н1 criterion (the kind by the second send's answer) was
  not asserted. Now it is (above), and the no-kind mutant fails it.
- Extra reads: `refresh()` runs before the new kind renders, so the old
  kind's pages are read again for a screen that will not show them; the
  eyelet turns that much longer. Before this change they were read too
  (and shown). Accepted.
- Accepted: the goods TZ asked for its new journey in `openings.spec.ts`;
  it is in `openings-file.spec.ts`, with the files' helpers. The haptic
  rule is `openings.spec.ts:854`'s exact list (a `selection` would fail
  it).
- Older, not this change: «Внесок» does not scroll its refusal again after
  the debt is read again; the payment now does (twins apart, below).
- Nit, not changed: `package.json` allows `@tanstack/react-query`
  `^5.59.0`; `queryClient.infiniteQuery()` came later in 5.x. The lock
  pins 5.102.8, so CI and installs from the lock are fine.

## Deviations from the TZs' criteria

- money P2-1: «первая `.owed-count` — низ ≤ верха дока». At 360 × 640
  «Сплачено …» takes two lines; its words end 2.3 px over the dock, its
  line box 0.375 px under it. Checked by its words.
- money P2-1: «при 390 × 844 — все четыре над доком». The plate stands on
  the dock, 0.0625 px past its top. Checked as «under 1 px».
- money P2-1 (б): the refusal of another store's invoice is stubbed
  (PAID_WHERE_OWED, `refuseOnce`), not made by opening «Старий» through
  the API — the shared stand keeps that store closed for other journeys.
- goods P2-1: the TZ's «иначе «Чекають»» — a part with neither (removed, or
  every line already answered) keeps the kind shown.

## Left

- Not verified on CI's fonts: the text font is the device's (`system-ui`;
  Roboto in CI). The checks of what is paid (2.3 px to spare at 360) and
  the plate at 390 (on the dock) depend on where words wrap; on a stand
  reused for many runs, «Старий»'s «Сплачено …» grows by 100 a run too.
- Twins apart: «Внесок» does not bring its refusal over the dock again
  after the debt is read again; the invoice's payment does.
- Not in a journey: the goods criterion on `openings-file.spec.ts:778-784`
  (the first file journey approves its list once per seed); the same case
  — one file's lines shown, a file added — is in the new journey.
- Owner-held as before: the owner pack (2026-11-27), № 5 (5.1, 5.2),
  В24-Г1 (the plates' words), and the rest.
- Next: batch «Видно, що чекаємо» (frame P2-1 + orders-cash P2-1, sale
  P2-1, frame P2-2) from main after this is merged.
