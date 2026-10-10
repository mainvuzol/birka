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

On 2026-10-10, before building:
- **how a seller finds the debt:** only by the customer's whole phone
  (chosen), or a name of three letters with no paging, or as it was;
- **which debts:** only those still owed (chosen), or all, paid and written
  off too.

After the independent review, the same day:
- **a seller added to every store:** sees a closed store only as its state
  (chosen), or reads it whole, as a manager does, as it was built;
- **«8 067…» and «0038 067…»:** the same number as «067…» (chosen), or
  only as written.

The same day the owner also confirmed the reading left open by PR #83: the
limit's text without «нічого не записано».

## What exists now

- **`GET /credits/customers?elsewhere=true`** takes as `query` only a whole
  phone: 10 to 15 digits, with spaces, «+», brackets, «-», «.», «/» and the
  invisible marks a phone's contacts add to a number copied from them.
  Anything else, a name, «06», nine digits, is refused with 422
  `PHONE_REQUIRED`. It finds the customer whose number that is, exactly.
- **One phone is one customer, written more ways:** «+38 (067) 123-45-67»,
  «380671234567», «067-123-45-67», «8 067 123 45 67» and «0038 067 123 45
  67» are one number (`customer_key`, and `CUSTOMER` in SQL). That holds
  everywhere a customer is one: this search, a store's list of customers,
  and erasing a customer on request. Nothing stored changes.
- **Only open debts** are answered there, whatever `status` asks; there is
  one customer at most, so nothing to page.
- **A debt is read by its id from another store only while it is owed**
  (`GET /credits/{id}?store_id=…`); paid or written off, it answers 403. The
  payment that closes it answers with it, paid, so the seller still sees
  «Борг сплачено повністю».
- **A store that does not trade is read only by the network's owner and
  managers:** a person holding `report:view_financial` for the whole
  network, by default the owner's and the manager's roles. A seller added to
  every store is told the store's state and nothing else, as its own
  sellers are, and finds its debts like any seller.
- **«Борги», «Де брали в борг: У магазині, що заблокований чи закритий»:**
  - the field is «Повний номер телефону покупця», with the phone's
    keyboard;
  - «Показати» is gone, as only what is owed is shown;
  - until a whole number is typed, neither «Знайти» nor «Оновити» asks the
    server, and the screen says «Введіть повний номер телефону покупця,
    наприклад 067 123 45 67. За іменем чи частиною номера борги інших
    магазинів не шукають.»;
  - nobody found: «За цим номером боргів магазинів, що не працюють, не
    знайдено. Перевірте номер або зверніться до менеджера.»
- **Unchanged:** a store's own debts, searched by name or a part of a phone;
  the closed store's debts read in that store by the network's owner and
  managers.

## How it was built and proven

- **Server tests** (`test_store_states.py`):
  - `test_a_debt_elsewhere_is_found_by_the_whole_phone_and_only_while_owed`:
    six debts in a blocked store. Four are one customer's, under the number
    written «+38 (067)…», «067…», «8 (067)…» and «0038 067…»; one is a
    customer a digit away; one a number from abroad, «+48 067 123 45 67»,
    whose digits hold the first number whole.
    - The database reads each stored number as the same customer the code
      does.
    - Eight queries are refused with `PHONE_REQUIRED`: empty, one letter,
      the name, the name with the number, «06», nine digits written with
      spaces, nine digits, sixteen digits.
    - Seven spellings of the number, one pasted between direction marks,
      find that customer alone, with their four debts. The neighbour and the
      number from abroad are each found by their own number alone.
    - A debt paid in full leaves the search, whether `status` is left out,
      `OPEN` or `SETTLED`, and is no longer read by its id from there; one
      still owed is.
    - A debt the network's owner writes off leaves the search, and is not
      read by its id either.
    - A manager of the network reads the blocked store itself by name: all
      six.
  - `test_a_seller_in_every_store_sees_a_closed_one_only_as_its_state`: a
    seller added to every store is refused the blocked store's debts, its
    list, its total and a debt by its id with `STORE_NOT_TRADING`; `/me`
    shows the store blocked with no permissions; from their own store they
    find the debt by the whole phone. A manager still reads the store.
  - The test of paying elsewhere searches by the number now.
- **Unit tests** (`test_customer_phone.py`): the spellings that are one
  number, the numbers kept as written («+48…», «+1…», nine digits,
  «0380…»), and which queries are a whole phone.
- **A journey** (`stores.spec.ts`, «a debt of a blocked store is found by
  the whole phone and paid at a store that trades»): with «Усі» chosen on
  the store's own list, the closed store's search has no «Показати»; the
  name and six digits leave the screen asking for the number without a
  request; the number written «+38 067 …» finds the debt, every search asks
  `status=OPEN`, and the debt is paid.
- **Mutation:** twenty-one ways of breaking it, one at a time, each caught:
  fourteen on the server, seven on the screen
  ([list](../../output/verification/2026-10-10-closed-store-debt-search/mutants.txt)).

## Review of the built change

An independent review read the first commit (`48f21dc`). It found the new
search sound: whole numbers only, compared exactly, open debts only, and no
other way for a seller of one store to list another's customers. It found,
all addressed:
- **A seller added to every store read a closed store whole,** its debts
  paid and written off too, by name and page by page: any role held in
  every store made a closed store readable. Put to the owner, who chose the
  state only; the scope now reads closed stores only for whoever holds the
  financial report for the whole network.
- **A debt was read by its id from any store that trades, in any status,**
  the write-off's reason and history too. Now only while it is owed, as the
  owner's "only what is still owed" says.
- **The tests did not prove the match exact,** nor a write-off. The test now
  has a number from abroad holding the first whole, and a write-off.
- **«Nobody owes» claimed more than a search can know,** and «8 067…» was
  another customer. The text now says nothing was found and to check the
  number or ask a manager; the owner made «8 067…» and «0038 067…» one
  number with «067…».
- **«Оновити» asked the server without a whole number.** It does not now.
- **A number pasted from a phone's contacts was refused**: the marks
  around it, «.» and «/». They are allowed now; the digits' count and the
  equality keep it exact.
- **Docs:** the checklist's row 27 said "another store", and the
  store-states report listed the routes without the change. Both corrected.

Left as they are, and said so in the risk register: a number can be
guessed within the per-person limit, and the server takes digits other than
0–9 as written, which the app never sends.

## Evidence

TODO(final)

## Not covered here

- **Whoever knows a customer's number** learns that they owe a closed store,
  how much and for what; a seller of the store that sold them knows as much.
- **A number can be guessed** within the per-person limit: 300 searches a
  minute.
- **Another country's number,** or a Ukrainian one written in some other way
  («+380 0 67…»), is found only as it was written.
- **A store's own list** is searched by name and pages, as before, for its
  own people and the network's owner and managers.
- **Another store's sales** for a return are still found by two letters of
  the goods' name; they show goods, prices and dates, never a customer.
