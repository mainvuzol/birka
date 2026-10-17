# The other stores offered, a mistake's mending, goods before Бірка — 2026-10-18

Baseline: `6643802` (a kept return named, the paper's line and the buzz,
PR #101).
Status: TODO
Branch: `feat/returns-elsewhere-mistake-before`. Tasks: [the returns task list](redesign/2026-10-17-redesign-tz-returns.md),
P1-1 (its rest), P1-5, P1-6. Owner: business-rules.md, "«Повернення» in
the new design: its task list's questions" (2026-10-17: В3, В2, В5, each
(а)); chosen next on 2026-10-18.

## Why this was next

After #101 the owner chose the three tasks they had already answered. Until
now «Шукати в інших магазинах мережі» stood under every list, typed or not,
and the other stores asked «Введіть назву товару…» first; another store's
own warehouse was chosen in a native list with two lines of hint; a return
said nothing of how to mend it if it was a mistake; and a coat sold from
the notebook, before Бірка, found nothing and said nothing more.

## What exists now

- **The other stores, offered** (P1-1, В3): once two letters are typed,
  under this store's results — or under «нічого не знайдено» — «Купили в
  іншому магазині мережі? Шукати там». Their results are headed «В інших
  магазинах мережі», with «← У своєму магазині»; what was typed is kept.
  Fewer than two letters, and it is this store's list again. Nothing of
  theirs is asked before two letters.
  - Nothing found there: «В інших магазинах мережі за «…» продажів не
    знайдено.»
- **Another store's own warehouse** (P1-1): «Цілі — на який склад?», a
  chip for each of this store's warehouses that takes goods — never its
  «Брак» — and «Продали з власного складу іншого магазину.»; none chosen
  beforehand, and the button says «Оберіть склад для цілого товару» until
  one is.
- **How a mistake is mended** (P1-5, В2), quietly under a return's result:
  «Помилилися з поверненням? Продайте ці речі знову на касі; пошкоджене
  спершу поверніть у продаж у «Браку».»
  - the «Брак» part only when damaged goods came back;
  - to whoever may not sell or handle «Брак», the same as how it is done:
    «Ці речі продають знову на касі», «… спершу повертають у продаж у
    «Браку»»;
  - a sale in parts: «Помилилися з поверненням? Помилку з продажем
    частинами вирішує власник.»
- **Goods sold before Бірка** (P1-6, В5): nothing found in this store adds
  «Продали ще до Бірки? Покличте менеджера — таке повернення вирішує він.»,
  after the other stores' offer, which comes first; nothing found in the
  other stores does not.

Nothing about money, stock or who may do what changes; the server is
untouched.

## Decided here, not by the owner

- **«Шукати там» is a quiet button under «Купили в іншому магазині
  мережі?»,** as «Помилилися з товаром чи ціною?» is on the till's receipt.
- **Fewer than two letters typed returns to this store's list,** so the
  other stores are never shown without a search.
- **P1-5's words to whoever may not use the till or «Брак»** are the same
  sentence said impersonally; the «Брак» part shows only when damaged goods
  came back; a sale in parts takes the owner's own words of В2 (а). The line
  is not on a kept return's notice.
- **P1-6's line is shown to every role,** managers and the owner included.
- **The other stores' list is read in the same render as what is typed:**
  fewer than two letters, and not one more of theirs is drawn or asked;
  the offer waits until what is looked for is what is typed.
- **This store's warehouses, while read, keep their chips' places.**

## How it was built and proven

- **The list** (`returns-list.spec.ts`, the store's sales stubbed):
  nothing typed or one letter, nothing offered; «лор» offers the other
  stores under this store's row; their heading, their request with
  `elsewhere=true&q=лор`, back in one tap with «лор» kept; one letter
  left, this store's list, typed again, this store's again; every request
  of theirs with two letters or more. **Switching:** their answer held,
  «Завантажуємо продажі…» under their heading and none of this store's
  rows, then theirs. Nothing found here: «Продали ще до Бірки? …», and
  «Шукати там»; nothing found there: «В інших магазинах мережі за «немає»
  продажів не знайдено.» without it; «Очистити» there, this store's list.
  The clock journey now proves the pause twice — nothing 200 ms in, then
  searched — and moves the clock until the list is drawn.
- **Another store's sale, on the real API** (`returns-elsewhere.spec.ts`):
  typed first, nothing of theirs asked, «Шукати там», their heading, the
  card; the chips of this store's warehouses, never «Брак» nor the other
  store's own, none pressed, the button held until one is, the chosen one
  sent and the goods there.
- **The result** (`returns.spec.ts`, `returns-sale-screen.spec.ts`,
  `credits.spec.ts`): «Помилилися з поверненням? …» with damaged goods and
  every right, with nothing damaged, without the till or «Брак», without
  either alone, and in parts; never on a kept return's notice.
- **The chips, brought above the panel** with their tag, at 360 × 640, the
  store's two warehouses stubbed.
- **Mutation:** sixteen ways of breaking it, one at a time, each against
  the journeys meant to catch it, after the unchanged tree passed: all
  caught on the first run
  (`output/verification/2026-10-18-returns-elsewhere-mistake-before/`) —
  the other stores offered before two letters or never; this store's rows
  under their heading while switching; their results unheaded; no way
  back; the field cleared keeping them; the before-Бірка line said there
  too, or never; a warehouse chosen beforehand; «Брак» as a chip; a
  mistake's mending unsaid; the till or «Брак» offered to whoever may not
  use them; «Брак» said when nothing damaged came back; a sale in parts
  mended at the till; the line on a kept return's notice.

## Review

An independent review of the change, on a snapshot, before the first
commit, found the other stores never asked without two letters — after
«Очистити», back, from a sale or a result, or on reopening — and one list
never standing in for the other. It found the following, all addressed
before the first commit:
- **«Never mixed» unproven while switching:** a journey now holds the
  other stores' answer and finds none of this store's rows under their
  heading.
- **The list's mode reset one render late,** and the offer shown while
  what was looked for lagged what was typed: the mode is read in the same
  render now, and the offer waits.
- **A journey's title said the result named no section;** it names the
  till and «Брак», as how it is done.
- **Smaller:** the before-Бірка line said before the other stores' offer,
  now after it; empty chips while the warehouses were read, now their
  places; «Шукати там» heard without its question, now described by it;
  the mixed rights of P1-5, the reset at one letter and «Очистити» there
  proven; every request of theirs checked for two letters; the clock
  journey's pause proven before as well as after; a false comment; random
  ids in a stub.
- **For the owner,** not decided here: whether someone without the till or
  «Брак» needs a next step in P1-5's line; P1-6's «Покличте менеджера»
  read by a manager or the owner; «вирішує власник» read by the owner.

## Evidence

TODO

## Not covered here

- **Not measured:** the taps of a return at another store (the task list
  counts 8 → 6).
- **On a real phone:** the chips and the offer in Telegram's own web view.
- **The rest of the task list:** P1-3 (each word searched, the server),
  P2-1 to P2-4.
