# «Каса»: a kept command named by what and how much — 2026-10-22

Baseline: `3e5cb2f` (main, with #120), and «Каса»'s task list
([redesign/2026-10-21-redesign-tz-cash.md](redesign/2026-10-21-redesign-tz-cash.md)).
Status: built, reviewed and proven: the whole CI run locally passed, and
thirty-one of thirty-one ways of breaking it caught. Not yet tried on a
real phone; three readings wait for the owner (Review).
Branch: `feat/cash-kept-drawer`. Task: P1-1, and the dark card in the dark
theme. Owner: the task list's В2 and В3 (2026-10-21), the dark card
(business-rules.md, after #119), and four readings after #120 (2026-10-22).

## Why this was next

The owner chose «Каса»'s P1-1 after #119, once the debts' answers (#120)
were in. When the server did not answer a count, the banner said only
«Незавершена операція каси» and «Невідомо, чи записано закриття каси»: not
which count, nor for how much, and it told the seller to check while the
phone checks by itself. Its paper line told them not to type from paper
what nothing of the drawer is ever typed from. A count that came too late
the same evening said to close «як завжди, увечері», which on that evening
reads as tomorrow. The owner answered В2 and В3 as recommended, and chose
the dark card to stay dark in the dark theme.

## What exists now

- **A kept drawer command's banner says what waits:** «Підрахунок ще не
  підтверджено», «Причину …», «Видачу …», «Внесення …», «Зміну способу
  оплати …»; «Перевіряємо підрахунок…» while it is checked. Its line, from
  the attempt alone: «Підрахунок 2 000,00 грн — сервер не відповів. Двічі
  він не запишеться. Поки чекаємо, інші дії недоступні.», «Видача 150,00 грн
  · Витрати — …», «Внесення 100,00 грн — …», «Зміна способу оплати: Картка →
  Готівка — …», «Причина різниці — …». Its button: «Перевірити підрахунок»
  and so on. Nothing of it while the first sending is still under way.
- **Under it, the drawer's own line (В2):** «Чекає відповіді сервера з
  14:20. Телефон перевірить сам. Нічого не повторюйте, поки він не скаже
  «не записано».» No paper mark, no name.
- **Confirmed:** «Підрахунок записано один раз.» under the close's figures;
  «Видачу записано один раз: Витрати, 150,00 грн.»; «Внесення записано один
  раз: 100,00 грн.»; «Зміну способу оплати записано один раз: Картка →
  Готівка.»; «Причину записано один раз.» with the words about the owner's
  message, judged by when it was first sent.
- **A count that came too late the same evening (В3)** — the drawer's day,
  06:00 to 06:00 — the drawer still to close: «Підрахунок не записано — він
  дійшов надто пізно. Перерахуйте касу ще раз і закрийте.», and the count
  opens by itself, once, when the drawer is read anew. On another day, with
  the drawer closed meanwhile, or while it cannot be read, the words as
  before, and nothing opens.
- **The «Закрити касу» card stays dark in the dark theme:** a dark surface,
  light text, an edge.

What is sent and the money are unchanged; the rules change only as the
owner answered (В2, В3). No backend change, no migration. The `person`
prop «Каса» no longer uses is gone.

## Decided here, not by the owner

- **The words of each banner, button and confirmation** above, as the task
  list proposed them; cash the server put on a colleague's close, confirmed:
  «… — до закриття 07.10, гроші взяли до нього.», and «… внесли …» for cash
  put in — which the words of one answered at once now say too, where they
  said «взяли» for both.
- **A kept reason's words about the owner's message** go by when it was
  first sent, since it was recorded when it first reached the server:
  «Власник отримає повідомлення.» within the bot's 15 minutes of the close,
  «Власник уже отримав повідомлення без причини — побачить її в
  застосунку.» when first sent after them, and otherwise «Власник побачить
  її в застосунку.» — true either way.
- **«The same evening»** is the drawer's day, 06:00 to 06:00 (G8), of the
  count and of now, by the phone's clock; **«still to close»** is the
  drawer's last read, when it could be read: whoever may close, and not
  closed today.
- **The count opens again only on a fresh read of the drawer,** never while
  it is read or cannot be (G26), as the card does; from «Каса»'s own screen,
  and once for each refusal, however often «Каса» is opened again.
- **No banner during a command's first sending:** it would say the server
  did not answer while it still may.
- **The dark card's colours:** `#222C29` with `#F1F4F2` text and a `#66726D`
  edge, at 3:1 on the section and the page.

## How it was built and proven

- **`cash-kept.spec.ts` (new, stubbed):**
  - ten kept commands — a count; a reason to a close just made, to one of an
    hour ago kept before the phone said since when, and one first sent past
    the bot's wait; cash taken out and put in, each also put by the server
    on a colleague's close; a way changed, also one explaining a close —
    each checked by itself on opening and still unconfirmed: its heading,
    its line with the sum and kind or ways, the drawer's own line with or
    without since when, no paper; «Перевіряємо …» and its button disabled
    while checked again; confirmed, its «… записано один раз: …», the
    banner gone, the phone's storage cleared, the second send byte for byte
    the first; the count's result after a confirmed count;
  - a count that came too late the same evening — 20:15 refused at 20:30,
    and 23:50 refused at 00:15, the browser's clock fixed — the drawer still
    to close: the owner's words over the count, opened after a read that
    came after the refusal, its field empty; left, and «Каса» opened again
    from «Продаж»: no count by itself; counted again — its own command, sum
    and moment — and closed;
  - a count that came too late on an earlier day, at 05:50 refused at 06:10
    (another day of the drawer), with the drawer closed meanwhile, and with
    the drawer found closed by the read after the refusal: the words as
    before, «Каса» itself after that read, and no count drawn even for a
    moment;
  - the drawer not read after the refusal: «Касу зараз не закрити» and the
    words as before, no count; read again with «Спробувати ще раз», the
    count opens with the owner's words;
  - a count on its first sending: no banner while it is under way; closed.
- **`outage.spec.ts`:** a close whose answer was lost says which count
  waits and that the phone checks it itself, with no paper mark or name.
- **`cash-close.spec.ts`:** in both themes the card is dark, with its edge;
  in the dark one the edge and the card differ from each other and from the
  page.
- **`cash.spec.ts`:** a kept fix of a way's «not found» counted from its
  own button.
- **Related journeys:** 268 — «Каса», its kept commands and close, debts,
  the outage and its paper, failures, returns, the till and its sections —
  passed with it.
- **Mutation:** 31 ways of breaking it, one at a time, after the unchanged
  tree passed with everything they name: all 31 caught
  ([`mutants.txt`](../../output/verification/2026-10-22-cash-kept-drawer/mutants.txt)).

## Review

An independent review on a snapshot of the tree, before the first commit,
confirmed that what is sent is unchanged (a resend byte for byte, the
recount a command of its own), that no sum before the count is shown
(G32), that the recount waits for a fresh read (G26), the Ukrainian's cases
and genders, the stubs' shapes, and that the tokens are in every theme
block. It found, all addressed before the first commit:
- **«The same evening» compared calendar dates;** the drawer's day runs
  06:00 to 06:00. A count kept at 05:50 and refused at 06:10 would have
  opened a count of the new day, taking that evening's close; one of 23:50
  refused at 00:15 would have said to close later. Now by the drawer's day,
  with journeys at fixed moments either side of 06:00 and midnight.
- **The count opened by itself again each time «Каса» was opened,** and
  could be marked opened while another screen of «Каса» was shown. Now
  once per refusal, kept beside the journal, and only from «Каса»'s own
  screen.
- **The owner's words beside «Касу зараз не закрити»:** the drawer not read
  after the refusal still counted as to be closed. Now it does not.
- **Cash put in, put on a colleague's close, said «гроші взяли до нього»** —
  in the new words and the old: «внесли» for cash put in.
- **A kept reason's words about the owner's message went by when it was
  confirmed,** not when it was recorded: a reason recorded at 20:05 and
  confirmed at 20:30 said the owner already had the message without it.
  Now by when it was first sent, with words true either way when unknown.
- **The banner showed during every first sending,** saying the server did
  not answer while the request was still under way. Now not.
- **Journeys:** a read count that the screen's own reads already satisfied,
  a drawer that never changed after the refusal, an absent count that could
  pass before it would open, no case for a close's day, a move onto a
  close, or a correction explaining one, and a minute after midnight that
  could fail: all replaced or added.
- **The dark card's edge** was 1.9:1 on the dark page: now 3:1. The
  journeys check the edge is the card's own, not a button's transparent
  one, which a mutant had shown.
- **Docs:** the styles' comment, the rules' «to be confirmed» about the
  card, «over» the close's figures, and the server guides' paper mark,
  which «Каса» no longer has.

**For the owner**, asked after the merge:
- **Cash taken out during an outage:** the sellers' page says to write it on
  paper and record it later with «Видати з каси» (В5), while «Каса»'s banner
  marks no paper line (В2). One pressed, kept by the phone and also written
  on paper may be recorded twice. Should the page say: «Натиснули «Видати з
  каси», а телефон пише «Видачу ще не підтверджено» — на папір не пишіть:
  телефон перевірить сам»? Recorded in the risk register meanwhile.
- **A kept reason's words** when it is unknown whether the bot's message
  carried it: «Власник побачить її в застосунку.»
- **The words beside the banner** after a check the server failed to answer
  still say «Перевірте результат ще раз — двічі … не запишеться.», as the
  task list said to keep, now beside «Нічого не повторюйте, поки він не
  скаже «не записано».» and a button that names the command.

## Evidence

- [`output/verification/2026-10-22-cash-kept-drawer/`](../../output/verification/2026-10-22-cash-kept-drawer/):
  `mutants.py`, `mutants.txt`.
- **CI, run locally at `1d08146`** ([summary](../../output/verification/2026-10-22-cash-kept-drawer-ci-local/summary.md)),
  on the host's Node 24.18: every job passed, the backend with its
  declared gap.
  - backend: 3 461 on PostgreSQL 17;
  - e2e: 518 journeys;
  - hot path: worst p95 99.3 ms (the search by six sellers) and 113.8 ms
    (`POST /sales`), within 300 and 500;
  - python-audit: 43 packages, 0 known vulnerabilities; `npm audit` 0;
  - restore drill, frontend and edge passed.

## Not covered here

- **On a real phone:** a count kept through a real outage, and the dark
  card on a real Telegram dark theme.
- **Next:** «Каса»'s P1-2 to P1-4 and the P2 tasks.
