# The till's receipt and its small things — 2026-10-15

Baseline: `99e1a40` (the till's search and one tap of a size, PR #91).
Status: TODO(final).
Branch: `feat/till-receipt`. Tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P1-1, P1-2, P1-8, P1-9. Owner: business-rules.md, "the till's receipt and
its small things; the first days' paper" (2026-10-15).

## Why this was next

After PR #91 a coat sold in three taps, and the receipt was the one part of
the till still in the system's words: its lines named the model without its
size, «1 × 1850,00 грн = 1850,00 грн», and the shelf's corrections read
«Оприходовано знайдене на місці: 1 рух(и) складу», a count of ledger
movements, two for one coat whose size was read off its label. A sale made
by mistake had no way back from the receipt; the seller had to know
«Повернення» and find the sale there. A typo of 0 sold a coat for nothing
unsaid. The owner chose these next, on 2026-10-15, answered В2 (the first
days' paper sales get a mark of their own, built later) and had the return's
paper text changed like the sale's.

## What exists now

- **The receipt by tags** (P1-1): «Лоран шоколад · M» and «1 × 1850,00 грн».
  - The server names each line's `size`, frozen with the sale («UNKNOWN»
    for one not known, shown «розмір невідомий»); an answer stored before
    takes the size from the basket the phone sent.
  - The shelf's corrections in coats, counted by the server from the
    movements the sale wrote (`found_quantity`, `missing_quantity`,
    `clarified`): «Знайдене на полиці додано в облік: 1 шт.», «На полиці не
    знайшли — з обліку знято: 2 шт. Перевірте склад із менеджером.»,
    «Розмір з етикетки записано: 1 шт. як M.» A shortage writes off what the
    books believed less what was on the shelf, which only the ledger knows,
    so the phone never works it out. An answer stored before says the same
    without a number. «рух(и)» is gone from the till.
  - Telegram buzzes once the server has answered: success when the sale is
    recorded, error when it is refused; only where Telegram has haptics
    (6.1 and later, by its launch data).
  - `GET /sales/{id}` reads the same, from the stored answer or, for a sale
    stored without one, from its rows. No migration.
- **«Помилилися з товаром чи ціною? Оформити повернення»** (P1-2) under
  «Новий продаж», for whoever may take returns: one tap, and «Повернення»
  is open on that sale, its lines, no search. It reads the store's newest
  sales afresh; the return follows its usual rules.
- **Price** (P1-8): a line at 0,00 грн says «Ціна 0,00 грн. Це справді
  подарунок? Перевірте ціну.» and still sells (owner, В3 (а)); a model with
  no price says who sets one, «Ціну для всіх задає менеджер у «Залишках».»
- **Ticks** (P1-9): «Вношу продаж з паперу», «Оплата частинами» and «Це
  було вчора» are rows of 44 px; ticking «Оплата частинами» puts the cursor
  in «Ім’я покупця», and the keyboard's action key moves on from the name
  and the phone and closes after the sum (`enterKeyHint`).
- **The return's paper text** no longer names «Звіт»: «Воно увійде в
  сьогоднішні повернення й у касу до наступного закриття.»

Nothing about money, stock or who may do what changes.

## How it was built and proven

- **Server tests** (`test_sale_receipt_units.py`, 6): a plain sale names its
  size and no correction, and reads back the same; goods found are counted
  in units; a shortage writes off what the books believed less what was
  there (three asked, one on the shelf: two); a size read off a label is one
  coat, though two movements; a sale stored with no answer is counted from
  the ledger; an answer stored before the units keeps its shape.
- **Journeys** (`till-receipt.spec.ts`, 8): the receipt's tag and its
  corrections in coats; an older answer read from the basket, without
  numbers; Telegram buzzes error then success, once each, and an old
  Telegram is never asked; a sale made by mistake returned from its own
  receipt, by the usual rules; no return offered without the right; a 0,00
  грн line said and sold; the ticks' 44 px and the cursor in the name. The
  receipt journeys of `sale.spec.ts` and `size.spec.ts` read the new words,
  and the return's paper text is checked (`outage-mark-debts-returns.spec.ts`).
- **Mutation:** TODO(final).

## Review

TODO(final).

## Evidence

TODO(final).

## Not covered here

- **On a real phone:** the buzz itself, and the keyboard's action key, are
  not felt or seen on a device yet.
- **The first days' paper mark (В2)** is decided, not built (P1-5).
- **The receipt's money** still reads «1850,00 грн», not «1 850,00 грн»
  (P2-1).
