# The till's empty states and the first days' paper — 2026-10-16

Baseline: `7d6835d` (the sections and the reminder, PR #93).
Status: TODO(final).
Branch: `feat/till-first-days`. Tasks: [the till's task list](redesign/2026-10-11-redesign-tz-sale.md),
P1-5. Owner: business-rules.md, "the till's empty states; the first days'
paper" (2026-10-16), with В1 (а) of 2026-10-14 and В2 (в) of 2026-10-15.

## Why this was next

The till met an empty warehouse with «На цьому складі немає товарів із
додатним залишком.» and no next step, and that is how it looks in a shop's
first days, while a warehouse waits for its opening list: nothing can be
sold there, and the till did not say why. A coat in hand whose balance is
none was not on the till's list at all, though the rules let it sell
through «Товар на місці» (F30): a dead end at the counter. And the paper of
the first days could only be typed as an outage's, «продано під час збою»,
for an outage that never was. The owner chose this next and decided the
rest on 2026-10-16: the first days' money goes into the drawer as now, the
paper says once which it is, its time may be two weeks old, and its returns
and payments are «з паперу» too.

## What exists now

- **A warehouse where nothing is recorded yet**, its opening list typed or
  not, says so at the till: «На складі «Спільний» зараз немає товару в
  обліку. Поки власник не затвердить початкові залишки, продавайте на
  папері.» Nothing to search or sell, and no coat from the catalogue: a
  «Товар на місці» there would close it to its list for good (owner,
  2026-10-16, asked when the review found it). `GET /stock-locations` says
  `awaiting_first_stock`.
- **An empty warehouse** that has recorded stock names itself, «На складі
  «Спільний» зараз немає товару в обліку.», and with a search that finds
  nothing, nothing at all, or under what a search found, the till asks
  «Товар у руках, а в списку його немає?» with «Знайти в каталозі».
  - The panel finds the model in the whole catalogue; a size tapped puts
    the line in the basket at the store's price, and the list comes back.
  - Pressed, the sale says the books hold none, and «Товар на місці —
    продати N» records the coat found, exactly the shortfall (F30, I18).
  - For whoever may answer «Товар на місці» and read the catalogue
    (`inventory:correct_during_sale`, `inventory:receive`); never from
    paper. The server needed no change: a sale's «фізично є» on a key the
    warehouse never held already worked, and is tested.
- **The mark «з паперу»** (ADR-0013 §5.8, revision 0041): the outage mark
  with `first_days`, on sales, returns and debt payments.
  - Shown as «Продано з паперу», «Повернено з паперу», «Внесок з паперу»:
    on the receipt, the confirmation, the returns list, «Борги» and «Звіт».
    The paper mode's texts say «з паперу» and «вже взяли»: no word of an
    outage.
  - Its paper time may be of the last 14 days, today among them, its day
    picked («День з паперу») and its time together, never one guessed for
    the other; an outage's stays today or yesterday with «Це було вчора».
  - Everything else is the outage mark's: the shelf's rule, who may be
    named, permanence, the sale's day and drawer, its money in the drawer.
  - An outage's mark is sent and printed exactly as before.
- **Which paper it is, said once per series:** ticking the paper switch
  asks «Що вносите з паперу?» — «Перші дні, до затвердження залишків» or
  «Сервер не відповідав». Until it is said, the buttons that send are held,
  at the till, on «Повернення» and in «Борги». The till's reminder that the
  server is back says «Сервер не відповідав»; it can be changed, and
  another kind asks the day and time anew.
- **«Каса»** offers a third quick reason for a difference, «Продажі з
  паперу перших днів».
- **The guides:** the server guides' cutover step types the first days'
  paper with its mark; the seller's paper guide adds «Сервер не
  відповідав».

## How it was built and proven

TODO(final)

## Review

TODO(final)

## Evidence

TODO(final)

## Not covered here

- **On a real phone:** the date picker of «День з паперу» and the
  catalogue panel are not seen on a device yet.
- **The rest of the task list:** P1-3, P1-4 and the P2 tasks.
