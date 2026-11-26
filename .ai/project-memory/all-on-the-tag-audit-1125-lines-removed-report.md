# «Усе на бірці», audit 2026-11-25, goods Н1: typed lines removed since come back as new ones — 2026-11-26

Baseline: `2f9cbda9` (main after #250).

Point: goods Н1 of audit 2026-11-25 (a finding outside the redesign). The
user's pick after #250: «Fix goods Н1» over a new audit.

Only the phone's resend: no word, no right, no journal, no server change,
no migration.

Status: built and reviewed; the touched specs pass locally, 5 of 5 mutants caught. Not committed.
- Journeys: 1295 (one extended).
- Branch: `fix/goods-lines-removed`.
- Decision: business-rules.md, "Chosen in chat — 2026-11-26 (audit
  2026-11-25, goods Н1 …)"; ADR-0014's «Додати рядки вручну» bullet.

## What exists now

«Додати рядки вручну» keeps its text and command on the phone until the
server has them. When the answer is lost and the lines it added are
removed meanwhile, the same command sent again is answered with that part,
removed. Before, the phone took that as added: the draft cleared, the
screen closed, nothing in the list. Now the lines go once more under a new
command — kept with the text until the server has it — as «Додати файл»
has done since 2026-10-09: added once, one `success` and one toast «Рядки
додано: N.», by the answer that adds them. Its answer lost too, the next
press repeats the new command: never added twice.

## How it was built and proven

Source: `frontend/src/openings/Parts.tsx` — `AddLines.send(fresh)`: the
kept command answered with a removed part takes a new command, stored on
the phone with the text before it is sent (`saveLines`, then `setDraft`),
and sends once more under it.

Journey (`openings-file`, «answers lost on their way back …», extended):
typed lines, their answer lost; removed in «Файли списку»; the same text
pressed again — the kept command answered (removed), the new one's answer
lost: the text kept, «Невідомо, чи додано рядки…»; left and opened again,
pressed — the new command repeated from the phone, added once, «Рядки
додано: 1.»; «Файли списку · 5»
with «7. Рядки, внесені вручну», not removed; the next «Додати рядки
вручну» empty. Its route lets `spare` answers through before it loses the
next `lose`.

Runs (local, `mobile-chromium`, the isolated stand):
- The journey alone, as it was written and after the review.
- The touched specs — openings-file and openings — 35 passed (3.0 min) on
  the stand reseeded. Before the reseed, `openings.spec:262` («a list is
  typed …») failed twice on the stand's own state: a waiting list, then two
  «Зошит 1» lists left by earlier runs (strict mode); alone after a
  reseed, and in the run above, it passes. It does not use «Додати рядки
  вручну».
- `tsc --noEmit`, eslint and `npm run build` clean; prettier clean on both
  files.
- The full suite runs in CI (no local full run).

Mutants (`mutate94.py`) — 5 of 5 caught: the behaviour before (the draft
cleared, the screen closed); sent again under the kept command; never sent
again; the new command not kept; the new command kept in the screen's
state alone, never on the phone (left and opened again, a third copy).

## Review

An independent read of the diff (read-only, as an inventory-ledger
specialist): no loop (one resend per press), busy never let go between the
two sends, the resend's body the first press's, a fresh command never a
conflict, too many requests and a list decided meanwhile handled. Its
points, each settled:
- Bug, narrow: the new command reached the phone's storage only when the
  screen was drawn again — after its request left. Recorded, and the app
  closed before that, the next press would send the old command and add
  the lines a third time (typed lines have no content check on the
  server). It is stored before it is sent now, as «Додати файл» stores
  its own.
- Weak test: the last press ran on the same form, proving the screen's
  state, not the phone's — the journey leaves and opens the form again
  first (mutant `n1screenonly`).
- Accepted knowingly: «felt once» for lines is proven by the code, not in
  Telegram (the file's twin is: `openings-file`'s Telegram journey); the
  toast is keyed, so a second say would replace the first.

## Left

- The owner's word, if she sees it as a rule of her own (the question in
  business-rules.md).
- Seen by the review, before this change, not in it:
  - the answer lost, the lines removed, then the text changed and pressed:
    `IDEMPOTENCY_CONFLICT` says «Рядки, надіслані перед цим, уже є в
    списку…», though they were removed — nothing recorded wrongly, the
    next press adds the lines as new;
  - typing while `done` reads the list again saves the draft back with
    the command already answered; the next «Додати рядки вручну» with the
    same text replays the old part and says «Рядки додано» for nothing
    new.
- Owner-held as before: frame P2-1 (а) (№ 5 / В25-К1), В25-К1, В24-К1,
  В24-Г1, В24-Т1, orders-cash Н1, В23-К1; money Д3 of 2026-11-24 not
  measured.
