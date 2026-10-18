# «Повернення»'s task list closed: one set of words, the list's places, pills by meaning — 2026-10-18

Baseline: `98123f4` (a sale found by each word, a return's own refusals,
PR #103).
Status: TODO
Branch: `feat/returns-words-skeletons-pills`. Tasks: [the returns task list](redesign/2026-10-17-redesign-tz-returns.md),
P2-1, P2-3, P2-4 — the last of it but P2-6, which the owner's В4 (а) leaves
undone. Owner: business-rules.md, "«Повернення»: three readings after
#103, and the task list closed" (2026-10-18).

## Why this was next

After #103 the owner answered its three readings and chose the task list's
last three. A kept return whose person could no longer take returns turned
the app to «Повернення» to say «Немає права приймати повернення.»; the list
said «Завантажуємо продажі…» where its rows would be, and jumped when they
came; every pill was the same green, «Оплата частинами» as «Усе вже
повернено»; the returns screens' meta was 13 px.

## What exists now

- **The owner's answers:**
  - a kept return still unconfirmed, refused for a conflict: «Повернення ще
    не підтверджено: сервер відповів, що дані змінилися. Перевірте
    результат ще раз — двічі воно не запишеться.», and it stays kept;
  - the other stores' sales are found by a word of two letters at least,
    on the server and in the list: «о о» is refused and not offered;
  - a kept return refused on resend for a conflict: «… Поверніться до
    списку в «Поверненні» й спробуйте ще раз.»
- **One set of words** (P2-1): nothing the glossary cancelled is left in
  «Повернення»; a kept return on a phone whose person may no longer take
  returns shows its banner over the till, and «Немає права приймати
  повернення.» is said nowhere. Under the banner the server's refusal of
  that person is said as every screen says it, «Немає доступу до цієї
  операції або складу. Зверніться до менеджера.», and the till beneath is
  held while the return is unsettled, as it always was.
- **The list's places** (P2-3): a day's heading's and three rows' places
  while it is read; neither the field nor the first row moves when the
  rows come; a screen reader hears «Завантажуємо продажі…».
- **Pills by what they mean** (P2-4): «Оплата частинами» in the debt's
  colours; «Продано з паперу» / «Продано під час збою» and the result's
  paper mark as a warning; «Усе вже повернено» neutral; «Пошкоджені» on the
  result in the colour of «Брак»; the returns screens' meta and the panel's
  notes at 14 px — each at 4.5:1 or more, light and dark.

Nothing about money or stock changes; no migration.

## Decided here, not by the owner

- **«Магазин «Другий»» keeps the accent pill:** the task list names no
  meaning for it.
- **A tag that asks for a warehouse may be taller than the room above the
  panel on a 360 × 640 phone;** then its chips, and the «Цілі» row just
  tapped, are what is brought into view, not the tag's name.
- **Only a conflict of an unconfirmed return** has the owner's words; a
  request the server could not take, left unconfirmed, says the words every
  journal says of an unknown outcome.
- **A word is counted and split as the server does** — by letters, not
  code units; on Python's whitespace — so the list never offers the other
  stores a search the server refuses; the list's own refusals speak a
  return's words.
- **A warning pill on a warning's notice** keeps a thin edge.

## How it was built and proven

- **The server** (`test_returns_elsewhere.py`): «», « Л », «о о», «л ш к»
  refused as `SEARCH_REQUIRED` among the other stores; a model's start and
  «ш» found.
- **The list** (`returns-list.spec.ts`, stubbed): «о о» searched in this
  store and the other stores not offered; while read, a day's heading's and
  three rows' places, the status heard, and neither the field nor the first
  row moving when the rows come; in both themes, «Оплата частинами» as a
  debt, «Продано з паперу» as a warning and «Усе вже повернено» neutral, by
  class and at 4.5:1 or more, with the goods, the meta and the day's
  heading; screenshots at 360 px.
- **The form and the result** (`returns-sale-screen.spec.ts`): in both
  themes, «Пошкоджені» on the result in the colour of the form's
  «Пошкоджені», the meta of the form and the result at 14 px, at 4.5:1 or
  more; screenshots at 360 px. The chips and the «Цілі» row just tapped
  above the panel.
- **Kept returns** (`outage.spec.ts`): still unconfirmed and refused for a
  conflict — the owner's words, kept, sent once; refused on resend for a
  conflict — «… до списку в «Поверненні» …»; on a phone whose person may
  not take returns — the banner over the till, the server's 403 said as
  every screen says it, never «Немає права».
- **The pills on the real API:** the form's «Оплата частинами» as a debt
  (`credits.spec.ts`), the result's paper mark as a warning
  (`outage-mark-debts-returns.spec.ts`).
- **Mutation:** twelve ways of breaking it, one at a time, each against
  the tests or journeys meant to catch it, after the unchanged tree passed:
  all caught on the first run
  (`output/verification/2026-10-18-returns-words-skeletons-pills/`) —
  one-letter words passing the other stores' rule on the server or offering
  them in the list; a kept return turning to «Повернення» without the
  right; an unconfirmed return's conflict in the shared words; a kept
  conflict naming no section; the rows' places not kept; a debt's, the
  paper's or the all-returned pill like any other; the meta at 13 px;
  «Пошкоджені» not in the colour of «Брак»; the chips not brought into view.

## Review

An independent review of the change, on a snapshot, before the first
commit, found the owner's three answers exact, the other stores' two
letters held on the server and in the list, the `null` tab unreachable,
the till's placeholders unchanged, and every pill at 4.5:1 or more by its
tokens. It found the following, all addressed before the first commit:
- **The journey of a person without the right** let the server's answer
  fall to a stub's 404: it now answers 403, as the server does, and says
  what that person sees — the banner, the server's refusal as every screen
  says it, never «Немає права» — and that the till is held, not open.
- **Reading the right in the load's effect** would have run it again when
  a store was blocked and opened, wiping what was said: it is read, not
  watched.
- **The list's places** left out the day's heading, so the first row came
  lower than its place: the heading has one now, and the journey measures
  the first row.
- **A word counted by code units** could offer the other stores a search
  the server refuses: counted and split as the server does now.
- **Smaller:** the panel's notes at 14 px; an unused pill; a warning pill
  invisible on a warning's notice; the form's and the result's pills
  proven; a single resend proven.

**For the owner,** not decided here:
- a phone whose person can no longer take returns keeps its unconfirmed
  return, kept under that person's own name, and the till beneath is held
  until it is settled — which needs that person's right back; how such a
  phone is set free is the owner's to say;
- an unconfirmed return refused for a request the server could not take
  still says the shared words, which name an order.

## Evidence

TODO

## Not covered here

- **On a real phone:** the pills and the list's places in Telegram's own
  web view, on Android and on iOS; the keyboard over the reason field.
- **Not measured:** the taps and the time of a return on three sellers
  (the task list's §13).
- **A kept return still unconfirmed** with a request the server could not
  take keeps the shared words.
- **Many warehouses on a short phone:** when a tag's chips and steppers
  together are taller than the room above the panel, the chips come into
  view and the steppers may pass above it.
