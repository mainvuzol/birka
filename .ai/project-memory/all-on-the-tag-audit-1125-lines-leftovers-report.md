# «Додати рядки вручну»: goods Н1's review leftovers — 2026-11-27

Baseline: `7e482bd7` (main after #252).

Points: the two «Seen by the review, before this change, not in it» of
[goods Н1's report](all-on-the-tag-audit-1125-lines-removed-report.md). The
user's pick after #252: «Fix the two leftover «Додати рядки вручну»
problems»; then «Fix notes case first» for the case the review found.

Only the phone: no right, no journal, no server change, no migration.

Status: built and reviewed three times; 15 of 15 mutants caught. Not
committed.
- Journeys: 1297 (two new, one changed).
- Branch: `fix/addlines-leftovers`.
- Decision: business-rules.md, "Chosen in chat — 2026-11-27 (goods Н1's
  review leftovers …)"; ADR-0014's «Додати рядки вручну» bullet.

## What exists now

- **Typed into after the lines are added, nothing is kept.** The server
  added the lines; the screen reads the list again before it closes. A
  keystroke in that moment used to save the draft back under the command
  answered: the next «Додати рядки вручну» showed the text, and its press
  replayed the old part — «Рядки додано» and a success for nothing new.
  Now the command answered is never kept again: the next form is empty.
  Typing while the answer is still awaited is kept, as before.
- **A conflict never says the list has what went first.** Sent again after
  a lost answer with the text changed, the same command is refused as
  another request. A conflict means the lines sent first were added, but
  the phone cannot tell whether they were removed since (the conflict
  names no part; a part's read names no command). «…уже є в списку…» was
  false when they were; now «Рядки, надіслані перед цим, уже додано, а ці
  відрізняються від них. Натисніть «Додати рядки» ще раз — ці буде додано
  як нові, окремо від тих.» What happens is unchanged.
- **«Звідки» or «Коли» changed alone: never offered as new.** The server's
  request for typed lines holds them too, so after a lost answer a change
  of only those was a conflict whose words said «ці відрізняються» and
  whose next press added the same lines twice. The phone now keeps every
  body a command sent; the lines the same, it sends again what it sent
  before with these lines under the same command, one at a time, and the
  server's replay of one says what it recorded and what became of its
  part:
  - live — «Ці рядки вже додано — вдруге їх не додають. «Звідки ці рядки» і
    «Коли перелічено» лишилися такими, як їх надіслали першого разу. Щоб
    змінити «Звідки» чи «Коли», приберіть ці рядки у «Файлах списку» й
    додайте їх знову.», the form empty;
  - removed since — the lines go at once as new with «Звідки» and «Коли» as
    typed now, «Рядки додано: 1.», as goods Н1 does for the same text;
  - no answer — «Невідомо, чи додано рядки…», all kept for the next press.
  A body refused for what it says (422) is dropped: never what the command
  records.

## How it was built and proven

Source: `frontend/src/openings/Parts.tsx` — `AddLines`:
- A ref `answered` holds the command the server added the lines under, set
  before the draft is cleared and `done` reads the list again; `setDraft`
  saves only a draft whose command is not that one.
- `LinesDraft.sent`: every body the command sent, once each and in order,
  saved with it before the request leaves; reset with every new command;
  a body refused with a 422 at its own send dropped from it.
- `addPart` (one POST) and `sendAgain` (goods Н1's new command, kept before
  it is sent) are shared by the press's send and the asks after it.
- A conflict: each kept body with the current lines, but the one just
  sent, goes again under the kept command until one is answered — removed
  → `sendAgain`, and the lines go with the current body; live → «notes
  alone»: the draft cleared, the command marked answered, the words above.
  A conflict to an ask is another body: the next is asked. Any other
  answer is said as it is. None answered, or none to ask: a new command
  and the changed lines' words. A conflict reads the list again by its
  code, not by its words.
- The conflict's words and the component's doc.

Journeys (`openings-file`):
- New: «lines added, typed into while the list is read again, keep nothing
  on the phone …». Lines added while the list's reads are held; a letter
  typed and taken back meanwhile; let go — closed, «Рядки додано: 1.»; the
  next form empty. Then lines typed and sent, their answer held — a line
  typed meanwhile — then lost; removed in «Файли списку»; the form opened
  again shows the changed text; pressed — the changed lines' words;
  pressed again — «Рядки додано: 2.»; four commands posted, the lost one
  repeated once, the answered one never.
- New: ««Звідки» changed alone after a lost answer: what the command sent
  before with these lines is asked again …», in three parts:
  - live — lost, the form left and opened again, «Звідки» changed alone:
    the conflict answered and the ask lost — «Невідомо…», the text and
    «Звідки» kept; pressed again — the notes' words, the form empty (and
    still empty opened again); the lost command posted five times,
    «Файли списку · 2» and «Файл 2» with no «Звідки»;
  - removed — lost, removed in «Файли списку», «Звідки» changed alone:
    «Рядки додано: 1.»; posted: the lost command, its conflict, the ask,
    then a new one; «Файл 4» says «Звідки: Зошит 3, сторінка 3»;
  - drift — lines refused for what they say (a 422 for their «Звідки»,
    every time), the same lines with another «Звідки» lost on their way to
    the server, other lines sent and recorded, their answer lost, «Звідки»
    changed alone: the notes' words; «Файли списку · 4», «Файл 5» with
    «Рядки 5–5» and «Звідки: Зошит 5», no «Файл 6».
- Changed: «answers lost on their way back …» asserts the new words.

Runs (local, `mobile-chromium`, the isolated stand):
- Each new journey alone, and with «answers lost on their way back …».
- The touched specs — openings-file and openings — on the stand reseeded:
  36 passed (3.2 min) with the first notes design; 37 passed (3.3 min) with
  the first body asked again; 37 passed (3.3 min) with every body kept.
  Before a reseed, five failed on the stand's own state, none of them
  «Додати рядки вручну»: same-name lists left by earlier runs (strict
  mode), and warehouses given stock by the journeys that approve once per
  seed.
- `tsc --noEmit`, eslint and `npm run build` clean; prettier clean on both
  files.
- The full suite runs in CI (no local full run).

Mutants (`mutate95.py`) — 15 of 15 caught:
- at the empty form after an add: every keystroke kept (the guard gone),
  the command never marked answered, marked only after the list is read
  again;
- at the form opened again: marked before the answer comes, nothing kept
  while busy;
- at the changed lines' conflict: the old words; any kept body asked,
  whatever its lines;
- in the notes' journey: notes alone never told apart; only the last body
  kept; only the first kept (the send that never reached the server taken
  for what was recorded); the notes' text kept under a new command; never
  asked (notes alone on the phone's word); the ask lost taken for notes
  alone, or for lines removed; a body refused for what it says kept and
  asked again.

## Review

An independent read of the diff (read-only, as an inventory-ledger
specialist), three rounds.

First round: no bug in the fix — `answered` set only once `api` resolves,
to the command sent; a lost answer, a slow one, a refusal, too many
requests and a conflict never set it; the resend of goods Н1 moves to a new
id and still keeps it; StrictMode's double updater the same; the journey
fails on the old code. Its points, each settled:
- Words: «сервер уже отримав» true but weaker than what is known; now
  «…уже додано…», as «Рядки додано: N.» says it.
- Weak test: nothing proved that text typed while the answer is awaited is
  kept. The journey now types a line while the lost answer is held and
  finds it in the form opened again.
- Older, not this change: a change of only «Звідки» or «Коли» after a lost
  answer was a conflict too; «ці відрізняються» was false, and the next
  press added the same lines twice. The user chose to fix it here.

Second round, of the first notes design (the form emptied on the phone's
word alone):
- Lines removed since, then «Звідки» changed alone: the form emptied and
  the words said «вже додано» — the lines were in no list and gone from
  the phone. Settled by asking the server again with what was sent first
  (its replay says whether the part was removed) — the removed case goes
  as new, as goods Н1 does.
- `serverRefused` counts 5xx: a server's error at the first send forgot
  what was sent though it may have been recorded. Now `refusedOutright`.
- The explicit list reads after a conflict doubled the one `refusal`
  already asks for: dropped.
- Accepted: text typed during a notes-alone press is erased with the form
  (kept under a new command, the lines added could be added a second
  time; the window is one press); the guard is one screen's (`useRef`) —
  a second tab on the same list could still save the draft back, and
  Telegram opens one.

Third round, of the ask-again design: no bug; nothing said or felt while
the lines go again as new; `send(again)` one level deep; the ask can add
nothing (a conflict means a part under the command, and the server looks
it up before the list's state). Its points, each settled:
- Test gap: the ask itself lost was never run. The live part now loses it
  and presses again.
- A duplicate still possible: a send that never reached the server, the
  lines changed and sent — recorded, the answer lost —, then «Звідки»
  alone: the first body was not the one recorded, so the changed lines'
  words, and the next press added the lines twice. Settled: every body is
  kept, each with these lines asked (the drift part).
- The list read again after a conflict hung on the conflict's words: now
  also by its code.
- A server's error to the ask says «Рядки не додано. Натисніть ще раз —
  повторити безпечно.» though the conflict proved the first lines added.
  Kept: a 5xx is said so on every write (owner, В-П1 (б)), and the next
  press asks again.
- Words: three «їх» in a row; now «Щоб змінити «Звідки» чи «Коли», …
  додайте їх знову.»

## Left

- Not covered by a journey: `sent` reset with the new command after a
  conflict of changed lines (a stale `sent` would matter only at a later
  lost answer and conflict under that command).
- Accepted knowingly: the resend of goods Н1 (a kept command answered with
  removed lines, the lines sent once more under a new one) sends the text
  as it was at the press and marks its own new command answered by the
  same line; no journey types during that resend (no mutant for it).
- Owner-held as before: № 5 (5.1, 5.2 / В25-К1), В24-К1, В24-Г1, В24-Т1,
  orders-cash Н1, В23-К1 and the rest of the owner pack (2026-11-27).
