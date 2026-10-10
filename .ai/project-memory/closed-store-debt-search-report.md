# A closed store's debts — 2026-10-10

Baseline: `f807c34` (requests per person, merged as PR #83).
Status: TODO(final).
Branch: `feat/closed-store-debt-search`. Owner: business-rules.md, "a
closed store's debts" (2026-10-10).

## Why this was next

After PR #83 the owner chose two of what was left that needs neither a
server nor a person: this one first, then the mark «продано під час збою»
on debt payments and returns typed from paper (backlog).

While a store is blocked or archived, any store of the network that trades
takes its debts' payments (owner, 2026-10-01). A seller found them in
«Борги» by a search of two letters or more, with «Показати ще». That was a
rule of how it was built, not the owner's, and it did not hold: «06» finds
nearly every phone, and the pages went on to 10 000, so a seller could go
through the closed store's customers, their names and phones, page by page.

## What the owner was asked

On 2026-10-10:
- **how a seller finds the debt:** only by the customer's whole phone
  (chosen), or a name of three letters with no paging, or as it was;
- **which debts:** only those still owed (chosen), or all, paid and written
  off too.

The same day the owner also confirmed the reading left open by PR #83: the
limit's text without «нічого не записано».

## What exists now

- **`GET /credits/customers?elsewhere=true`** takes as `query` only a whole
  phone: the characters a phone is written with, and 10 to 15 digits. It
  finds the customer whose number that is, one phone being one customer:
  «+38 (067) 123-45-67», «380671234567» and «067-123-45-67» are one. Anything
  else, a name, «06», nine digits, is refused with 422 `PHONE_REQUIRED`.
- **Only open debts** are answered there, whatever `status` asks; there is
  one customer at most, so nothing to page.
- **«Борги», «Де брали в борг: У магазині, що заблокований чи закритий»:**
  the field is «Повний номер телефону покупця», with the phone's keyboard;
  «Показати» is gone, as only what is owed is shown. Until a whole number is
  typed, the screen asks nothing of the server and says «Введіть повний номер
  телефону покупця, наприклад 067 123 45 67. За іменем чи частиною номера
  борги інших магазинів не шукають.» Nobody found: «За цим номером ніхто не
  винен магазинам, що не працюють.»
- **Unchanged:** a store's own debts, searched by name or a part of a phone;
  the closed store's debts read in that store by the network's owner and
  managers; a debt read by its id from the store taking its payments, so the
  seller who took the last payment sees it paid.

## How it was built and proven

- **Server test** (`test_store_states.py`,
  `test_a_debt_elsewhere_is_found_by_the_whole_phone_and_only_while_owed`):
  three debts in a blocked store, two of one customer under two spellings of
  the number, one of a customer a digit away. Then:
  - eight queries refused with `PHONE_REQUIRED`: empty, one letter, the
    name, the name with the number, «06», nine digits written with spaces,
    nine digits, sixteen digits;
  - four spellings of the number find that customer alone, with both
    debts, and not the neighbour; the neighbour's number finds only theirs;
  - a debt paid in full leaves the search, whether `status` is left out,
    `OPEN` or `SETTLED`, and stays readable by its id;
  - a manager of the network reads the blocked store itself by name: all
    three.
  The test of paying elsewhere searches by the number now.
- **A journey** (`stores.spec.ts`, «a debt of a blocked store is found by
  the whole phone and paid at a store that trades»): the name and six digits
  leave the screen asking for the number without a request; the number
  written «+38 067 …» finds the debt, every search asks `status=OPEN`, and
  «Показати» is not there.
- **Mutation:** TODO(final).

## Review of the built change

TODO(final)

## Evidence

TODO(final)

## Not covered here

- **Whoever knows a customer's number** learns that they owe a closed store,
  how much and for what; a seller of the store that sold them knows as much.
- **A number written otherwise when the debt was opened,** «8 067…», is
  found only as it was written: one phone is one customer for «+38» and
  «0», as everywhere in the app.
- **A store's own list** is searched by name and pages, as before, for its
  own people and the network's owner and managers.
- **Another store's sales** for a return are still found by two letters of
  the goods' name; they show goods, prices and dates, never a customer.
