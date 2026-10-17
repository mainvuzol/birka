# A kept return named, the paper's line and the buzz — 2026-10-18

Baseline: `4aaa57b` (one sale's return and its result, PR #100).
Status: built, reviewed and proven: the whole CI run locally passed, and
sixteen of sixteen ways of breaking it caught, one after its journey was
strengthened. Not yet tried on a real phone.
Branch: `feat/returns-kept-paper-buzz`. Tasks: [the returns task list](redesign/2026-10-17-redesign-tz-returns.md),
P1-2, P1-4, P2-5. Owner: business-rules.md, "«Повернення»: two words after
#100, and what next" (2026-10-18).

## Why this was next

After #100 the owner chose the task list's next three, the small ones its
order puts after the result: a buzz on the server's answer, a kept return
that says which it is, and one line under the button from paper; and
answered two wordings #100 had left to them.

Until now a return whose answer was lost said «Незавершене повернення» and
«Невідомо, чи записано попереднє повернення. Перевірте результат…»: which
customer, which goods, what money — nothing. Confirmed later, it said
«Повернення оформлено» in the old words. From paper the warning not to hand
money back twice was said twice, in the band and again under the button.
And the till buzzed on the server's answer; a return did not.

## What exists now

- **A kept return's banner** (P1-2): «Повернення ще не підтверджено»,
  and «Повернення: Лоран шоколад · M × 1 · 3 000,00 грн готівкою — сервер
  не відповів. Двічі воно не запишеться, і гроші двічі не повернуться.
  Поки чекаємо, інші дії недоступні.»
  - In parts, no sum: «Повернення частинами: Лоран шоколад · M × 1 — …».
  - An attempt kept before, or whose goods do not read: «Повернення 2 шт.
    · готівкою — …».
  - **The goods and the sum are the attempt's own,** kept beside what is
    sent and never sent: `payload` leaves them out, so a resend is byte for
    byte the same, and storage that does not read them still resends.
- **Confirmed later** (P1-2): «Повернення записано один раз» with the
  result's block, compact — the sum, «Якщо гроші ще не повернули — …»
  (owner, 2026-10-08), from paper «… повернули під час збою — вдруге не
  повертайте.», the goods where they went — and «Зрозуміло».
- **From paper, one line under the button** (P1-4): «Хто прийняв: Ганна ·
  за папером вчора, 19:40»; «вдруге не віддавайте» is said once, in the
  band.
- **A buzz in the hand** (P2-5), inside Telegram where it can: success
  once a return is recorded, error once it is refused; none for a lost
  answer, and none when a kept one is confirmed later.
- **The owner's two wordings:** from paper the panel keeps «З паперу ·
  Повернути …»; in parts a way not read says «Не вдалося прочитати, як
  платили. Якщо буде що повертати — оберіть, як.»

Nothing about money, stock or who may do what changes; the body sent is the
same, and the server is untouched. The sellers' page, the administrator's
guide, the runbook, the known risks and ADR-0021 name the new heading.

## Decided here, not by the owner

- **The paper's time under the button** reads «сьогодні, 19:40» or «вчора,
  19:40», and the first days' «08.10, 12:30»; nothing when no time is
  given.
- **The kept notice shows the sentence,** «Якщо гроші ще не повернули —
  …», where the live result shows a pill and a sum and lets a screen reader
  hear the sentence: confirmed later, whether to give the money is the
  point. Its pill names the way alone, «Готівка»: «Поверніть» is said only
  under «Якщо гроші ще не повернули» (owner, 2026-10-08).
- **A refusal that asks for the way** («Покупцю повертаємо гроші — оберіть,
  як.») buzzes as an error, as every refusal of a return does; the till's
  own question about the shelf does not buzz.
- **Several goods** in the banner are joined by commas, «Лоран шоколад · M
  × 1, Альпака сіра · M × 1».
- **What the attempt kept for the banner is read as untrusted:** a part
  that does not read leaves the goods unsaid, never the attempt unsent.

## How it was built and proven

- **The buzz and the kept return** (`returns-sale-screen.spec.ts`, the sale
  stubbed, a Telegram bridge stubbed): one error buzz on a refusal, one
  success buzz on a return recorded; another's answer lost: its banner
  «Повернення: Лоран шоколад · M × 1, Альпака сіра · M × 1 · 6 000,00 грн
  готівкою — …»; the app opened again, the phone confirms it by itself and
  buzzes nothing; the notice «Повернення записано один раз», the sum, the
  pill «Готівка» and no other «Поверніть», «Якщо гроші ще не повернули —
  …», the goods where they went, no «Новий продаж», «Зрозуміло» closing it;
  the resend the lost body itself, with nothing of the banner's.
- **In parts, a way not read:** «… Якщо буде що повертати — оберіть, як.»,
  and «Повернути товар на …» still pressable.
- **From paper:** «Хто прийняв: не вказано», then «… · за папером сьогодні,
  10:15» once the time is given; with «Ганна» and yesterday's 19:40, «Хто
  прийняв: Ганна · за папером вчора, 19:40»; the first days', «… · за
  папером 08.10, 12:30»; «вдруге не віддавайте» once, in the band, for
  either paper (`outage-mark-debts-returns.spec.ts`).
- **Reopened kept attempts** (`outage.spec.ts`): one that kept its goods
  names them, «Повернення: Пальто «Затишок» · M × 1 · 3 000,00 грн
  готівкою — …»; one whose goods are not a list, or not even an object,
  names its units and way and is still resent, the same bytes, nothing of
  the banner's sent; a kept attempt from before names «Повернення 1 шт. ·
  переказом — …»; in parts with nothing back, «0,00 грн», «Грошей покупцю
  не повертаємо.» and no «Поверніть».
- **The journeys before:** the banner's heading and words in `returns`,
  `returns-elsewhere`, `credits` (in parts, no sum), `failures` and
  `outage`; the confirmed notice's heading and the goods' words; in
  `credits`, the cash to give back «only if nobody did», exactly.
- **Mutation:** sixteen ways of breaking it, one at a time, each against
  the journeys meant to catch it, after the unchanged tree passed
  (`output/verification/2026-10-18-returns-kept-paper-buzz/`). Fifteen were
  caught on the first run (`mutants-run-1.txt`) — the banner naming no
  goods, or a sum in parts; what it names sent, or not kept; goods that do
  not read holding the attempt; confirmed later, the pill or the sentence
  saying to hand the money back plainly, or the old heading; the banner's
  old heading; no buzz on a return recorded or refused; the paper's time
  unsaid, yesterday's said as today's, the warning said twice; in parts, a
  way asked as if needed. **One survived:** a lost answer buzzing too — the
  journey reloaded the app before looking at the buzzes, and the reload
  wiped them. The journey now looks before the reload, and catches it
  (`mutants-run-2.txt`).

## Review

An independent review of the change, on a snapshot, before the first
commit, found what the banner names never sent nor able to break it, every
figure on it said to be unconfirmed, the kept notice's money said «only if
nobody did», the chosen warehouse still named, the paper's time from the
same choice as the mark sent, and a buzz once per answer, never for a lost
one or a kept one confirmed. It found the following, all addressed before
the first commit:
- **The kept notice's pill said «Готівка · Поверніть покупцю»** over the
  sum, unconditionally, on a notice that may come hours later: a seller on
  another shift could hand the money over twice. It names the way alone
  now, and the journeys say no other «Поверніть» is there.
- **A stored summary that is not an object** would have held the whole
  attempt as broken, and the app with it: it is not checked now, only read
  where it is shown.
- **The record of 2026-10-07's texts** still named the old warehouse
  words: a dated note says what the screen says now.
- **Weakly proven:** the cash «only if nobody did» matched by a substring;
  a kept return in parts with nothing back; the paper's «сьогодні» and the
  line with no time; «вдруге» once for the first days' paper; no buzz when
  the phone confirms by itself — each proven now.

## Evidence

- [`output/verification/2026-10-18-returns-kept-paper-buzz/`](../../output/verification/2026-10-18-returns-kept-paper-buzz/):
  `mutants.py`, `mutants-run-1.txt` (fifteen of sixteen caught) and
  `mutants-run-2.txt` (the survivor caught once its journey looked before
  the reload).
- **CI, run locally at `699f7a0`** ([summary](../../output/verification/2026-10-18-returns-kept-paper-buzz-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 445 on PostgreSQL 17 (unchanged by this work);
  - e2e: 383 journeys;
  - hot path: worst p95 90.3 ms (the search by six sellers) and 144.5 ms
    (`POST /sales`), within 300 and 500;
  - restore drill, frontend, python-audit and edge passed.

## Not covered here

- **On a real phone:** the buzz in Telegram on Android and iOS; the
  banner's length at 360 px with several goods.
- **The rest of the task list:** P1-1's words and chips, P1-3 (each word
  searched), P1-5 («Помилилися?» on the result), P1-6 (goods sold before
  Бірка), P2-1 to P2-4, P2-6.
