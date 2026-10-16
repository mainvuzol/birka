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

- **Server tests** (`test_first_days_mark.py`, 10):
  - a sale of the first days: marked so, dated today, its paper day kept,
    and «з паперу» in its answer, read back, in the store's list and in
    «Звіт»;
  - the first days' paper goes back to the thirteenth day before today
    and no further; an outage's to yesterday; each refusal says its days;
  - the first days' paper says nothing of the shelf, and its shortfall is
    never correctable;
  - the kind is part of the command, for a sale, a return and a payment:
    the other kind conflicts, the same replays, and an outage's stated
    `first_days: false` is the outage's own; the prints of both kinds;
  - a return and a payment of the first days carry it, with the same two
    weeks;
  - the database keeps it: never without the mark, never changed on a
    sale, a return or the debt's ledger;
  - `/stock-locations` says a warehouse that has recorded nothing awaits,
    with its list typed or not, and one delivery opens it;
  - revision 0041 goes back only while no row carries the mark.
  The tests that pin the mark's exact shape now say `first_days: false`,
  and `test_old_prints_are_pinned.py` is unchanged: an outage's prints are
  the same bytes.
- **Journeys** (`till-first-days.spec.ts`, 6, and one in
  `outage-mark-debts-returns.spec.ts`):
  - a warehouse with nothing recorded says to sell on paper, with nothing
    to search, no basket hint and no catalogue;
  - an empty warehouse names itself, and a coat from the catalogue goes in
    the basket at its price and is sold through «Товар на місці», the second
    body saying the coat found; against the real API, a model never
    received is sold so;
  - a search that finds nothing offers the catalogue; from paper, or
    without the rights, it does not, and an open panel closes as the paper
    mode comes on;
  - the paper switch asks which paper it is and holds the pay buttons until
    it is said; the first days' band, hint, receipt and money line say «з
    паперу» and never «збою»; the day's range is today and the thirteen
    days before; a time without its day, or a day without its time, is held;
    the series keeps its kind for the next sale and asks the day anew;
  - an outage's paper is sent as it always was; a refusal of a time too
    old says the outage's words for an outage and the first days' for the
    first days; another kind asks the day and time anew; a new series asks
    which paper again;
  - a return and a payment of the first days, from a day nine days back:
    the return held until the kind is said, «Повернено з паперу» and «…
    повернули раніше», «Внесок з паперу», «оплату вже провели», the bodies
    with `first_days`, and «Звіт» saying it.
- **Every journey that types paper** now says which paper it is
  (`fixtures.ts`: `fromPaper`), «Сервер не відповідав» for an outage; the
  reminder's button says it too. The outage payment journey sees its
  buttons held until it is said.
- **A reminder journey of #93 was made steady:** it lost the server while a
  request of the till's was still in flight, whose late answer rightly
  counted as the server's return; it now waits for the till's requests to
  settle first.
- **Mutation:** thirty-five ways of breaking it, one at a time — thirteen
  on the server against its tests, twenty-two on the screens against the
  journeys meant to catch each, on a fresh seed — after the unchanged tree
  passed both ways: all caught
  (`output/verification/2026-10-16-till-first-days/`).
  - A first run caught 32 of 35, and each survivor is closed: a sold-out
    warehouse, its movements without stock, is checked to stay open; «Це
    було вчора» is checked absent once the first days' time is typed; and
    «a new series keeps the kind» was equivalent — the kind it kept while
    the switch was off is never read — and is replaced by one that carries
    the kind into the next series, which the journeys catch.
  - The backups journey that counts nights is left out of the screens'
    verdicts: the shared E2E database keeps every run's nights.

## Review

An independent review of the change before its first commit found no
blocker, the migration, the prints, the idempotency and the texts by kind
right, and the following, all addressed in `8a215eb`:
- **«Знайти в каталозі» on a warehouse that has recorded nothing** — no list
  typed yet — would write its first movement and close it to its opening
  list for good. Asked of the owner: such a warehouse says to sell on
  paper, as one waiting for its list, and `/stock-locations` says
  `awaiting_first_stock`, in one query.
- **The first days' day was guessed as today** when only a time was typed,
  and a day without a time was dropped: they now go together, or the send
  waits with a hint.
- **Another kind kept the other's day, time and «вчора»:** asked anew now.
- **«Повернення» spoke of an outage before the kind was said;** the sends
  relied on held buttons alone: both fixed.
- **«Two weeks» read as fifteen days:** today and the thirteen days before,
  the same on the server, the field and the texts.
- **Docs:** the catalogue lists every active model, not only those the
  store holds none of; the guides said the till names a waiting warehouse
  only once its list is typed.
- **Tests that could pass broken, and gaps:** the catalogue's absence from
  paper re-checked beside the no-result text, a realistic too-old refusal
  and the outage's own words, the panel closing on paper, the kind
  conflict of returns and payments, a warehouse opened by a delivery.

## Evidence

TODO(final)

## Not covered here

- **On a real phone:** the date picker of «День з паперу» and the
  catalogue panel are not seen on a device yet.
- **The rest of the task list:** P1-3, P1-4 and the P2 tasks.
