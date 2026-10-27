# «Усе на бірці», first work: no rule said, and «Так, закрити» held — 2026-10-28

Baseline: `379cc15` (#145, on main), and the two task lists for «Усе на
бірці» ([the frame](redesign/2026-10-27-redesign-tz-all-on-the-tag.md),
[the sections](redesign/2026-10-27-redesign-tz-all-on-the-tag-sections.md)),
which land with this work.
Status: built and proven by its journeys and mutants; CI run locally
(below). Not yet tried on a real phone.
Branch: `feat/no-rule-refusals`. Tasks: the frame's P2-1; of the sections'
P1-2, the guard against a carried tap alone.
Chosen: business-rules.md, "Chosen in chat — 2026-10-28"; every question
to the owner built as its (а).

## Why these first

Both are small and stand on nothing the frame has still to build. A
refusal that names a rule reads as being checked on; a seller needs to see
what to do, not someone else's rights. And «Так, закрити» was drawn where
«Закрити касу» stood with nothing to let a double tap's second half go: a
close that cannot be changed, made without the sum seen.

## What exists now

- **A kept operation turns only to a screen its person may open.** A kept
  sale, delivery, stock correction or stocktake count opens its screen only
  with `sale:create`, `inventory:receive` or `inventory:view`, as kept
  returns, payments and orders already did. Anyone else sees its banner
  over the section open, a section of theirs marked beneath it, and the
  phone checks it by itself; settled, its words stand there too, and the
  till opens only for whoever may sell.
- **No section says a rule.** Opened without its right — a kept operation
  of another day, a right taken while it was open — a section draws
  nothing; twelve sentences are gone from `App.tsx` and `Stock.tsx`. The
  till's shortfall, where neither correction is allowed, says the next
  step alone: «Покличте менеджера або зменшіть кількість.»
- **«Так, закрити» lets a double tap go.** A tap on it sooner than 0.7 s
  (`CARRIED_TAP`) after «Закрити касу» does nothing, and a key held down
  from «Закрити касу» does not close it by its repeats; pressed once the sum
  is read, it closes. The close is still four taps and the sum.

No backend change; nothing new on the phone's disk; one sentence shortened.

## Decided here, not by the owner

- **Three sentences stay:** «Немає доступу до перевірки каталогу.
  Зверніться до менеджера.» (the task list keeps it: the catalogue's kept
  operation is checked on its own screen); the words for the server's
  refusal of a command, «Немає доступу до цієї операції або складу.
  Зверніться до менеджера.», which say what the server answered and are
  not among the task list's; and «Цей розділ бачить лише власник.» in the
  hint of «Резервні копії», said to the owner on the owner's own screen.
  The task list's search for its sentences finds that last one; it is not
  a refusal.
- **The guard counts from the press of «Закрити касу»**, the first half's
  own moment, rather than from when «Так, закрити» was drawn.

## How it was built and proven

- **`App.tsx`:** the goods' rights read before the kept delivery,
  correction and count, each turn behind a ref read, not watched, as
  `canReturnNow`; the sale's the same, on loading and once settled; eleven
  branches without their right draw `null`. **`Stock.tsx`:** the same. **`Sale.tsx`:** the shortfall's
  sentence. **`Count.tsx`:** `askedAt`, the moment «Закрити касу» was
  pressed, and «Так, закрити» letting go a tap within `CARRIED_TAP` of it,
  and a key's repeats.
- **Journeys:** `confirmClose` in `fixtures.ts` presses «Так, закрити» as a
  person does, the sum read first; the 15 presses in four specs use it.
  New: the double tap on «Закрити касу» — the second half lands on «Так,
  закрити», 100 ms later, and nothing is sent; pressed again after the sum
  is read, one close; Enter held on «Закрити касу» past 0.7 s — its
  repeats on «Так, закрити» send nothing, a fresh press closes
  (`cash-close.spec.ts`). A kept delivery, stock correction and stocktake
  count without their right — the till beneath the banner, held, the check
  sent by itself, no «Немає права»; a kept count with `inventory:view`
  still on «Товар»; a kept sale without `sale:create`, unanswered and
  answered already — a section of the person's beneath it, marked, never
  the till (`outage.spec.ts`). The shortfall's journey reads
  the new sentence and no «Немає права» (`sale.spec.ts`).
- **Journeys:** 676.
- **Mutation:** 9 ways of breaking it, one at a time: 9 caught as the
  journeys stand. The kept sale turned without its right survived at first
  — its journey asserted only what was absent, and a till without its right
  now draws nothing — and is caught since that journey asks for a marked
  section ([`mutants.txt`](../../output/verification/2026-10-28-all-on-the-tag-quick-wins/mutants.txt)).

## Review

An independent review of the uncommitted tree, money first, found the
moved rights used nowhere before their new place and the guard sound on
every path a phone takes: reset on each «Закрити касу», after «Скасувати»
and after a refusal; a deliberate press after 0.7 s goes through; the
double tap's journey proves the second half lands on «Так, закрити». It
found, all addressed before the first commit:
- **A kept sale settled turned to the till without its right** — sold,
  nothing sold or refused — onto a till that now draws nothing, no
  section marked. It turns only with `sale:create` now.
- **A key held down** on «Закрити касу» closed by its repeats once past
  0.7 s (a keyboard's path, not a phone's). Repeats are let go now.
- **Journeys that said more than they proved:** «may no longer» where the
  stub never held the right; «Немає доступу» asserted absent where only
  a server that never answered keeps it away — a server that answers says
  it refused the command in its own words, which name no rule, as the
  kept return's journey shows. Now «may not», and «Немає права» alone. A
  kept count with its right still turning to «Товар» was unproven; it is
  now.
- **Found, not changed (as before this work):** in a store that does not
  trade, `/me` gives the network's owner the network's rights, so a kept
  catalogue correction still turns to «Моделі», which needs a trading
  store and draws nothing — before, a wrong refusal; either way the
  correction waits with every other section held. Below.

## Evidence

- [`output/verification/2026-10-28-all-on-the-tag-quick-wins/`](../../output/verification/2026-10-28-all-on-the-tag-quick-wins/):
  `mutants.txt`.
- CI: CILOCAL

## Not covered here

- **On a real phone:** a double tap on a real Telegram screen, with its
  touch timing.
- **Left of the sections' P1-2:** the keypad, the dock and the sheet with
  MainButton, after the frame's components.
- **A kept catalogue correction in a store that does not trade** turns
  to «Моделі», which draws nothing there, and its check lives on that
  screen: it waits with every other section held. As before this work,
  where it said a wrong refusal; to settle with the owner.
- **Next in the frame's order:** P0-1 → P0-2 → P0-3 → P0-4 → P1-1.
