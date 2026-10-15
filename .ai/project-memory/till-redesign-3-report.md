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
    so the phone never works it out. An answer stored before gives these
    fields as null, and the till says the same without a number. «рух(и)»
    is gone from the till.
  - Telegram buzzes when the server answers the till's press: success when
    the sale is recorded, error when it is refused; never for the shelf's
    question (the server's shortage, which asks rather than fails, as the
    task list's criterion says), nor for an empty shelf recorded or a kept
    sale confirmed later. Only where Telegram has haptics (6.1 and later,
    by its launch data, from the hash or the query).
  - `GET /sales/{id}` reads the same, from the stored answer or, for a sale
    stored without one, from its rows. No migration.
- **«Помилилися з товаром чи ціною? Оформити повернення»** (P1-2) under
  «Новий продаж», for whoever may take returns: one tap, and «Повернення»
  is open on that sale, its lines, no search. It reads the store's newest
  sales afresh; a list that cannot be read, or a tab left before it came,
  opens no sale later. The return follows its usual rules.
- **Price** (P1-8): a line at 0,00 грн says «Ціна 0,00 грн. Це справді
  подарунок? Перевірте ціну.» and still sells (owner, В3 (а)); a model with
  no price says who sets one, «Ціну для всіх задає менеджер у «Залишках».»
- **Ticks** (P1-9): every tick of the app is a row of 44 px, the till's
  «Вношу продаж з паперу», «Оплата частинами» and «Це було вчора» among
  them; ticking «Оплата частинами» puts the cursor in «Ім’я покупця», and
  the keyboard's action key moves on from the name and the phone and
  closes after the sum.
- **The return's paper text** no longer names «Звіт»: «Воно увійде в
  сьогоднішні повернення й у касу до наступного закриття.»

Nothing about money, stock or who may do what changes.

## How it was built and proven

- **Server tests** (`test_sale_receipt_units.py`, 7): a plain sale names its
  size and no correction, and reads back the same; two coats found in one
  movement are two; a shortage writes off what the books believed less what
  was there (three asked, one on the shelf: two); two coats read off labels
  are two, under their size, though the clarification writes two
  movements; one sale with a coat found, a shortage and two sizes read off
  labels says each; a sale stored with no answer is counted from the
  ledger; an answer stored before the units gives them as null. The replays
  of answers kept from before (`test_payment_method_commands.py`) now expect
  those nulls too.
- **Journeys** (`till-receipt.spec.ts`, 10): the receipt's tag and its
  corrections in coats; an older answer read from the basket, without
  numbers; Telegram buzzes nothing for the shelf's question, error for a
  refusal, then success, once each, and an old Telegram is never asked; a
  sale made by mistake returned from its own receipt, by the usual rules,
  with «Повернення» read before the sale; a return asked whose list could
  not be read, or left before its list came, opens no sale later; no return
  offered without the right; a 0,00 грн line said and sold; the ticks' 44 px,
  the cursor in the name and the keyboard's action key moving on. The
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
