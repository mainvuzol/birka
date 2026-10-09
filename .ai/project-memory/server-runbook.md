# Server — runbook

How birka goes onto a server, is kept up to date, and is put back. Written
on 2026-10-01 for the Milestone 1 release gate; see the
[release checklist](release-checklist.md). Step 9 was rewritten on
2026-10-02: as first written, its "receive the first real delivery" would
have shut the shared warehouse to the shops' existing stock for good.

**Not done yet:** none of this has been carried out on a production server.
Each command is the one the repository's own checks run, or was run in the
isolated Docker verification of 2026-09-16
([report](docker-postgresql17-verification.md)).

Backups have their own [runbook](backup-restore-runbook.md). This one links
to it at the step where it belongs.

## What it needs

| | |
|---|---|
| A server | Linux with Docker Engine and the Compose plugin. 2 vCPU, 2 GB RAM and 20 GB of disk is an estimate for two shops. The CPU part rests on CI: a two-CPU runner served six sellers asking back to back within budget, while also running the load ([figures](hot-path-budget-report.md#update--2026-10-01-the-first-postgresql-17-figures-and-what-ci-fails-on)). The nightly drill restores a full copy beside the database, so leave room for two. |
| A domain name | its DNS `A` record pointing at the server, and no `AAAA` record: compose gives its network no IPv6, so every IPv6 client would reach the API as one address and share one sign-in limit. Telegram opens a Mini App only over HTTPS; Caddy gets the certificate itself. |
| Open ports | 22 (SSH), 80, and 443 over TCP and UDP (UDP for HTTP/3). Nothing else: the database and the API are never published. |
| The clock | synchronized (`timedatectl` says `System clock synchronized: yes`). Telegram's sign-in data is refused when its time is in the future, or more than an hour old. |
| A Telegram bot | made with @BotFather. Its token signs every sign-in; the server must have the same one. |
| The owner's age key | made on the owner's computer ([backup runbook, step 1](backup-restore-runbook.md#1-the-owners-key-on-the-owners-computer)). Only the public half goes to the server. |
| Who hears of trouble | the owner, through the bot, and an administrator: their Telegram user id (owner decision, 2026-10-03). Not named yet. |
| An outside check-in service | in the owner's name, so a server that dies whole is noticed ([step 8a](#8a-being-told-when-something-fails)). |

Set the server's time zone to Kyiv, so the backup schedule's 03:15 is the
shop's night:

```sh
sudo timedatectl set-timezone Europe/Kyiv
```

## First install

### 1. The code

```sh
sudo mkdir -p /srv/birka && sudo chown "$USER" /srv/birka
git clone https://github.com/mainvuzol/birka.git /srv/birka
cd /srv/birka && git checkout <the release commit>
```

Deploy a commit whose CI passed, all of it.

### 2. The settings

```sh
cd /srv/birka/infra
cp .env.example .env && chmod 600 .env
```

In `.env`:

| | |
|---|---|
| `BIRKA_APP_ENV` | `production`, the default since 2026-10-03. The API then refuses to start without the bot token and a session secret of at least 32 bytes, and hides its API docs. |
| `BIRKA_DOMAIN` | the domain, e.g. `shop.example.com` |
| `POSTGRES_PASSWORD` | long and random: `openssl rand -base64 32` |
| `BIRKA_TELEGRAM_BOT_TOKEN` | from @BotFather |
| `BIRKA_SESSION_SECRET` | `openssl rand -base64 48` |
| `BIRKA_BACKUP_AGE_RECIPIENTS` | the owner's public key, `age1…` |
| `BIRKA_ADMIN_TELEGRAM_IDS` | the administrator's Telegram user id, comma-separated if there are several ([step 8a](#8a-being-told-when-something-fails)) |
| `BIRKA_HEARTBEAT_URL` | the outside service's check-in address ([step 8a](#8a-being-told-when-something-fails)). Anyone holding it could check in on the server's behalf, so it stays in `.env` |
| `BIRKA_SENTRY_DSN` | empty: error details stay in the server's log (owner decision, 2026-10-03). Setting it turns Sentry on, scrubbed as ADR-0010 says |

**Keep a copy of `.env` in the password manager.** It is in no backup.

### 3. Build, and the database

```sh
export BIRKA_RELEASE=$(git -C /srv/birka rev-parse --short HEAD)   # the version the app and its errors name
docker compose build
docker compose --profile ops build ops
docker compose up -d --wait db
docker compose run --rm --no-deps api alembic upgrade head
docker compose run --rm --no-deps api alembic check     # "No new upgrade operations detected."
```

Migrations never run by themselves when the API starts. Each one is a step
a person takes.

### 4. Start it

```sh
docker compose up -d
curl -fsS https://<domain>/api/v1/health    # {"status":"ok","environment":"production"}
curl -fsS https://<domain>/api/v1/ready     # {"status":"ready"}: the database answers and its schema is current
docker compose ps                           # the api says (healthy) within a minute or two
```

`up -d` starts five things:
- the database;
- the API;
- `backup-watch`;
- Caddy;
- `web`, which builds the app into Caddy's volume and exits. That is the one
  container that is supposed to stop.

### 5. The bot opens the app

In @BotFather:
1. Choose the bot.
2. Open Bot Settings, then Menu Button.
3. Set the button's URL to `https://<domain>/`.

Then open the bot in Telegram and press the button. The app shows «Доступу
ще немає», with the Telegram number of whoever opened it.

### 6. The owner, and the shop's places

The owner opens the app as in step 5 and passes on the number it shows.
Then:

```sh
docker compose run --rm --no-deps api python -m scripts.seed_organization \
  --telegram-user-id <the owner's number> --owner-name "<name>" --org-name "<shop>" \
  --main-name "<the main store's name>" --second-name "<the second store's name>"
```

This creates:
- the stores `MAIN` and `SECOND`, with the names given (by default
  «Основний магазин» and «Другий магазин»);
- one warehouse both stores share;
- each store's own «Брак»;
- the default roles;
- the owner, with the owner's role in every store.

Add `--with-child-warehouse` if the second store has a warehouse of its
own. That warehouse is private to `SECOND`. Even the owner reaches it only
with a role in `SECOND` itself (`scripts.people grant … --store SECOND`, step
7). The seed is safe to run again: it keeps what exists.

**A name is changed later on the owner's word**, as people are:

```sh
docker compose run --rm --no-deps api python -m scripts.stores rename \
  --approved-by <the owner's number> --store MAIN --name "<the new name>"
```

The owner presses «Спробувати ще раз» and is in.

### 7. The people

Each seller opens the app as in step 5 and passes on their number. On the
owner's word:

```sh
docker compose run --rm --no-deps api python -m scripts.people grant \
  --approved-by <the owner's number> --telegram-user-id <their number> \
  --store MAIN --role SELLER
docker compose run --rm --no-deps api python -m scripts.people list
```

See the [people report](people-report.md) for removing someone, or turning
them off in every store.

**A lost phone** (owner decision, 2026-10-03): on the owner's word, end
every sign-in of that person. They keep their stores and roles, and open the
app again on the new phone.

```sh
docker compose run --rm --no-deps api python -m scripts.people sign-out \
  --approved-by <the owner's number> --telegram-user-id <their number>
```

Whoever holds the lost phone could still open the app through the person's
Telegram: the person must also end that phone's Telegram session
(Telegram → Settings → Devices). Turning someone off in every store ends
their sign-ins too, and a later grant does not bring the old ones back.

### 8. Backups

Follow the [backup runbook](backup-restore-runbook.md#setting-it-up), steps
2–4, from `/srv/birka/infra`:
- the first night by hand;
- the owner pressing «Start» in the bot, so the bot may write to them;
- the crontab line;
- the read-only user for the owner's computer.

**The release is not done until the owner's «Резервні копії» section shows
a good night.**

### 8a. Being told when something fails

The owner decided on 2026-10-03 who hears of trouble on the server, and how
([ADR-0011](../decisions/ADR-0011-failures-are-visible.md)). `backup-watch`
looks every minute. When the app has not answered for 5 minutes, the disk is
nearly full, or nobody has managed to sign in for 10 minutes, the bot tells:
- the owner;
- the administrators in `BIRKA_ADMIN_TELEGRAM_IDS`.

It writes once when the trouble starts, once a day while it lasts, and once
when it works again. From 9:00 to 20:00, Kyiv time, its messages arrive with
a sound; at other hours, silently. The «Резервні копії» section shows the
same troubles, and when the watcher last looked.

Since 2026-10-04 the same watcher also tells **a drawer's difference** found
at a store's close ([ADR-0012](../decisions/ADR-0012-cash-and-card.md)).
That message is about the shop, not the server:
- it goes to the network's owner only, never the administrators, and never
  to whoever closed;
- it is always silent, at any hour, as backup messages are;
- it is sent once the reason is written, or 15 minutes after the close, and
  retried for a day;
- it needs nothing set up beyond the owner's «Start» in the bot (step 8).

1. **The administrator** opens the shop's bot and presses «Start», then
   opens the app from it: «Доступу ще немає» shows their Telegram number. Put
   it in `BIRKA_ADMIN_TELEGRAM_IDS`, and `docker compose up -d backup-watch`.
   `docker compose logs backup-watch | grep backup_watch.started` shows how
   many administrators it has: a part of the setting that is not a number is
   dropped, rather than stopping the watcher and every alert with it.
2. **The outside service.** A dead server cannot say so, so the owner opens an
   account with a service that waits for check-ins, for example
   Healthchecks.io or UptimeRobot:
   - **a check-in check** ("heartbeat" or "cron job"): every 10 minutes,
     with 10 minutes' grace. Its URL goes in `BIRKA_HEARTBEAT_URL`, then
     `docker compose up -d backup-watch`. The watcher checks in only while
     it is looking, the bot works, and someone can be told, so the
     service also hears of a hung watcher or a revoked bot token;
   - **an address check** of `https://<domain>/api/v1/ready`, every 5
     minutes, if the service offers one;
   - its alerts go to the owner's Telegram or e-mail.

   The service learns the site's address and that the server is alive,
   nothing of the shop's.
3. **Try it, before the shops use the app:**
   ```sh
   docker compose stop api       # wait 6 minutes: the bot says the app is not answering
   docker compose start api      # within a minute: it works again
   docker compose stop backup-watch   # wait 25 minutes: the outside service writes to the owner
   docker compose start backup-watch
   ```

What each message means, for whoever looks after the server:

| The bot says | Look at |
|---|---|
| the app's server does not answer | `docker compose ps` and `docker compose logs --since 15m api`: a setting the API refuses to start with is named in its last lines |
| the database does not answer | `docker compose ps db`, `docker compose logs --since 15m db`, and the disk (`df -h /`) |
| the database is not updated for this version | the migration was not run, or failed: [a new version](#a-new-version) |
| the disk is running out | `docker system df`, then `docker image prune -f && docker builder prune -f --filter until=720h`; the backups directory; a night that kept failing keeps every copy (backup runbook) |
| nobody can sign in, maybe the clock | `timedatectl`: `System clock synchronized: yes` |
| nobody can sign in, maybe the bot token | the token in `.env` against @BotFather; after changing it, `docker compose up -d api backup-watch` |

### 9. The shops' existing stock, before anything moves

**Nothing is received, sold or corrected until this step is done.** A
warehouse takes an opening balance only while nothing has ever been
recorded in it (owner decision, 2026-09-29, Q1). Its first receipt, sale,
«фізично є» or stock correction closes it to an opening list for good, and
so does an approved list: each warehouse takes one. Both stores sell from
the one shared warehouse, so a single delivery received there ends this way
in for everything the shops already hold.

On 2026-10-01 the owner allowed two ways in, and on 2026-10-08 chose the
second (business rules, "going live" and "the shops' existing stock"):
photos of the notebooks, read by a parser into files in Birka's format,
which go into the warehouse's list in «Початкові залишки» and are reviewed
there, line by line. Lines typed or pasted in the app remain, and may join
the same list: a page the parser could not read is typed by hand (owner,
2026-10-08). Nothing in a file becomes stock on its own word.

**First, the largest warehouse is counted** (owner, 2026-10-08). Before
anything is photographed for a list, the shops count the notebooks of their
largest warehouse roughly: pages × lines per page. If it comes out above
5 000, stop: the limit is raised first, by a separate change to the ledger
(the approval and its reading of the reservations), before going live. A
warehouse is not taken in parts across several lists: it takes one list,
once. See "how large a list may be", below.

For each warehouse, in this order:

1. **The count.** Photograph the notebooks and tables as they stand on one
   day. The shop goes on selling on paper and keeps those sales. The photos
   stay with the shop: Birka keeps only each photo's name and the line's
   number on it, so the photos keep the names the parser read them under.
2. **The files.** The parser reads the photos into files in Birka's format
   ([`formats/birka-stock-list/`](../../formats/birka-stock-list/README.md)):
   one notebook a file, or one file per group of whole photos, at most
   1 000 lines each. Check every file before it goes to the shop, with the
   reference validator, from `backend/` of the repository with its
   requirements installed:

   ```bash
   python -m scripts.check_stock_file FILE.json
   ```

   It prints `OK` with the file's lines and photos; otherwise it prints every
   problem with its line, and exits 1. The file then reaches the phone of
   whoever uploads it, saved to the phone's files (from a Telegram chat,
   say). The drill on an Android, an iPhone and Telegram Desktop (release
   checklist, row 26) has not been run yet: Telegram Desktop is expected to
   work but has not been tried either.
3. **The catalogue.** A line is answered by picking a model, so every model
   the list names is created in «Каталог», before or during the review.
   Sellers may do this too. A split confirmed by a tap (step 5) needs each of
   its sizes in the catalogue under the same spelling.
4. **The list.** The owner or a manager (`snapshot:import`):
   - in «Початкові залишки», «Новий список», chooses the warehouse and
     «Завантажити файл» with the first file. Before it is sent, the app
     shows its lines, photos and price kind, and the warehouse it goes to;
   - in the list, «Додати файл» for every further file, and «Додати рядки
     вручну» for a page the parser could not read;
   - «Прибрати файл» for a file put in by mistake, the wrong notebook or the
     wrong warehouse: its lines and their answers go, and the rest of the
     list stays. No reason is asked; the history shows who and when. The
     last file is not removed: reject the list instead, which releases the
     warehouse. A removed file may be added again, as a new file.

   The same file is refused a second time. A file whose photos and lines
   are already in another file of the list is taken, and the app says how
   many: remove it if it is a repeat. A list typed by hand starts with
   «Вставити текст» instead, and takes files the same way.
5. **The review.** Answer every line, file by file:
   - the model;
   - the size, or «Розмір невідомий»;
   - where the count came from;
   - or «Це не товар», with a reason.

   Each line shows its photo and line («Фото: IMG_0412.jpg, рядок 4») and
   the parser's reading, as a hint. The parser's count is only a hint unless
   the line itself says «шт»: a person states the count, with a note. A line
   that writes each size joined to its count by a sign («S-1 M-2 L-1»,
   «Лоран M-3»), and nothing beside them but a price, a count with «шт» or
   a length, is confirmed by a tap, «Як у рядку, по розмірах»; «M 3», with
   a space alone, is a bare number, and «S-1 M-2 L-1 разом 5» is answered
   with a note. A record that may also be a range of sizes is asked about
   first, «Запис «42-44» — це:»: a number size whose count, also a number,
   reads as a larger size after it («42-44», «98-104»), whatever the
   catalogue holds, or a record whose count or whole is a size of the
   catalogue («M-3» with a size «3»). The tap is offered only
   after «Розмір 42 — 44 шт» is chosen; a range is answered with the sizes
   and a note (owner, 2026-10-09). Headings, totals and crossed-out lines
   come with the parser's note, and a person decides each (owner,
   2026-10-08).

   **Create sizes before answering by size.** A size created after a line
   is answered by size can make its record a possible range («M-3» once a
   size «3» exists): the approval is then refused, naming the lines, «Рядки
   … треба розібрати ще раз: запис у них тепер може бути діапазоном
   розмірів.» Open each, say what the record means, and approve again.
6. **The approval.** The owner (`snapshot:approve`) approves the list, and
   it becomes the warehouse's stock. It cannot be undone. A rejected list
   changes nothing, and a new one may be started.

   **A child store's own warehouse** (`--with-child-warehouse`) is private
   to `SECOND` (step 6). Its list is filled and answered by someone holding
   `snapshot:import` in `SECOND` itself, and approved by whoever holds the
   owner's role there (Q5). The network's owner and managers do not reach
   it through their network-wide roles.
7. **The paper sales.** Sales made on paper since the count are entered at
   the till as ordinary sales, only after the approval (Q2). Each is dated
   the day it is entered. One entered before the approval closes the
   warehouse to its list.
8. **Only then** are new deliveries received and sales made in the app.

**How large a list may be.** One list opens a warehouse, once, and its
approval writes it in one transaction (ADR-0014 §10, measured 2026-10-08;
the owner kept the limit the same day):
- at most **5 000 lines**, a removed file's lines not counted, and **5 000
  answers** of a model, a size and a count; a line naming several sizes
  takes one answer per size, so count each size of such a line;
- each file, or each text typed in, at most 1 000 lines and 100 000
  characters; at most 1 000 files.

The list shows how much of both is used.

**A warehouse larger than that cannot be taken in one list yet,** and a
warehouse takes only one: never in parts across lists. The shops' rough
count comes first (above); the validator then gives each file's exact lines
before the first is uploaded. Above 5 000, the limit is raised first, by a
separate change to the ledger under its own review, measured again, before
going live (owner, 2026-10-08). Above about 6 500 answers the ledger's own
read of the reservations fails, whatever limit the code sets.

**The shared warehouse's list belongs to both stores** (owner, 2026-10-08).
The managers of either store who may import lists there see it in
«Початкові залишки», add files to it and answer its lines, and the owner
approves it from either store. The app offers no second list for a
warehouse whose list waits: it names that list and opens it. Two people
starting lists for one warehouse at the same moment from the two stores
can still make two. Only one can be approved: reject the other, and add
its files to the first. While the warehouse is paused, its list is seen
only from the store that started it.

**The store that started the list stops trading** (owner, 2026-10-09).
While it is blocked or archived, its list is not approved, nor filled or
answered: the list page, seen through the other store, says so and offers
only «Відхилити список». Then:
1. a manager of the other store, or the owner, opens the list in
   «Початкові залишки» through that store and rejects it, saying why. The
   warehouse is released at once;
2. through the same store, «Новий список» for that warehouse, and its files
   added again, the same files from the shop. Their lines are answered
   anew: the answers of the rejected list stay only in its history.

If the warehouse is paused too, the other store does not reach the list:
open the warehouse first, or let the store trade again.

**The same, when that store may no longer receive goods there** (review,
2026-10-09), its access row to the warehouse having been changed. Through
the other store the list is then only rejected too, and a refused command
says «Магазин «…», що почав цей список, більше не може приймати товар на цей
склад: список можна лише відхилити.» Reject it, and start the new list, as
above.

**While a list waits, the warehouse waits** (owner, 2026-10-02), for the
whole review, even days (owner, 2026-10-08). The app refuses every receipt,
sale and correction there until the list is approved or rejected, and says
so; the shops sell from it on paper meanwhile, and those sales are typed
after the approval. So start the list when its files are ready. A list
typed for a warehouse that already has history holds nothing back.

**A delivery that arrives after the count** is received only after the
approval (Q1). Keeping that order is the responsibility of whoever enters the
goods (owner, 2026-10-02). A paper sale of goods from such a delivery needs
the delivery received first, or the till finds the shelf short.

**Goods found later go in through «Приймання», with their size**: whoever
enters them knows it (owner, 2026-10-02). The warehouse takes no second
list.

### 10. Check it, with nothing invented

Everything recorded in production is real, so do not test with made-up
sales. The owner, from a phone:
- signs in, and chooses a store. Its address in `docker compose logs api` is
  the phone's, not a `172.…` one: the sign-in limit counts by it;
- opens «Залишки», and finds there what the approved list said, less the
  paper sales entered since.

Then the first real delivery proves «Приймання», and the first real sale
proves the till.

## Keeping it running

| | |
|---|---|
| Is it up? | `docker compose ps` (the api says `healthy`), and `curl -fsS https://<domain>/api/v1/ready`. `backup-watch` asks the same every minute and the bot tells the owner and the administrators ([step 8a](#8a-being-told-when-something-fails)). |
| The API's log | `docker compose logs --since 1h api`. Each service keeps at most 5 × 10 MB. A request is logged without its query string, so a debt search by name or phone never reaches it; it shows the seller's address. Every line of a request carries its `request_id`. |
| A seller's «Номер запиту» | the first 8 characters of a `request_id`: `docker compose logs api \| grep <them>` finds the request and its error. |
| A broken screen | the app notes it in the API's log as `client.error`: which screen, which error, the version and the request's number, nothing about the person. `docker compose logs api \| grep client.error`. |
| The watcher | `docker compose logs --since 1h backup-watch`. `backup_watch.server_trouble` is a trouble told; `checked_in` / `check_in_withheld` the outside check-in; `bot_token_refused` a bot token Telegram no longer accepts; `idempotency_purged` the hourly cleanup. |
| Last night's backup | `docker compose run --rm backup-watch python -m scripts.backup_watch --status` (exit 0 only if OK). The owner sees the same in the app. |
| Disk | `df -h /`. The database, the server's ~10 backups and the nightly scratch copy share it. Under 15 % or 3 GB free, the bot says so. Old images build up with each update: see [a new version](#a-new-version). |
| Errors | In the API's log (owner decision, 2026-10-03: not Sentry yet). Setting `BIRKA_SENTRY_DSN` turns Sentry on for the API and `backup-watch`. Request bodies, query strings, sign-in data, tokens and the values a refused database row repeats are scrubbed before anything leaves; an event is tagged with its request id, the build (`BIRKA_RELEASE`) and the process. |
| The site's certificate | `backup-watch` asks Caddy for it on every look. A week before it runs out the owner hears from the bot, at most once a day (owner decision, 2026-10-03). `backup_watch.certificate_unread` in its log is expected before the first certificate is issued, or while Caddy restarts. |

**Never run `docker compose down -v`.** `-v` deletes the database's volume,
and with it everything since last night's backup.

## When the server does not answer

The owner decided on 2026-10-04 that the shops go on selling on paper, and
type it in when the server answers
([ADR-0013](../decisions/ADR-0013-the-server-is-unreachable.md)).

**What has already happened by the time anyone looks:**
- After 5 minutes the bot has told the owner and the administrators:
  «⚠️ Сервер застосунку не відповідає. Продавці продають на папері.»
  ([step 8a](#8a-being-told-when-something-fails)). Nobody needs to phone.
- The sellers' phones say «Сервер не відповідає. Продавайте на папері…», and
  the shops sell on paper as their page says:
  [paper-when-the-server-is-down.md](paper-when-the-server-is-down.md).
- A phone whose operation got no answer keeps it, shows since when it waits,
  and its paper line is marked «у телефоні — <ім’я>».
- When the whole server is dead, the app does not open at all. Only the
  outside service tells ([step 8a](#8a-being-told-when-something-fails), 2),
  once it is set up.
- When one shop has no internet, the app does not open there either, and
  nobody is told, not even by the outside service: the server answers
  everyone else. The seller checks the shop's internet and, if there is
  none, tells a manager, and the shop sells on paper meanwhile (owner,
  2026-10-08).

**What the administrator checks,** in this order:
1. `docker compose ps`: is every service up, and the api `healthy`?
2. `curl -sS https://<domain>/api/v1/ready` from outside: `ready`, or the
   reason, `database` or `schema`. Not `-f`: on a 503 it hides the body, and
   with it the reason.
3. `docker compose logs --since 15m api` and `docker compose logs --since 15m db`.
   A request refused because the database did not answer is the line
   `request.unavailable`, with `DATABASE` or `SCHEMA`: the phone got a 503
   and the paper text, not an error with a number.
4. The disk: `df -h /`.
5. Then the table under [step 8a](#8a-being-told-when-something-fails), for
   what the bot's message names.

**When it answers again:**
- The bot says «✅ Сервер знову відповідає: продажі з паперу можна вносити.»
  It tells the owner and the administrators, not the shops: **tell the shops**
  to type everything from paper before the drawer is closed (their page,
  step 6). If it answers before 6:00 the same night, the seller types
  everything from paper first, then closes the drawer; if it does not, the
  drawer is closed the next evening (owner, 2026-10-07).
- **Open the app on every phone that holds a kept operation.** It checks it
  by itself once the store is chosen: «… підтверджено» (a return:
  «Повернення оформлено»), or «… не записано», and only then is its paper
  line typed. A phone left closed keeps it. A
  lost phone's lines go to a manager, who checks its sales and returns in
  «Звіт» and its debt payments in «Борги» before typing them: «Звіт» shows
  debt payments only as one sum, and each debt's history in «Борги» names
  who took each payment and when (owner, 2026-10-08).
- **A store blocked, or a warehouse closed, while a phone keeps an
  operation there** holds that phone in that store until the store trades
  again or the warehouse reopens: the server refuses the resend before it
  looks the operation up. Once it does, the phone checks it by itself the
  next time the app is opened in that store, or at its button. The phone
  works in other stores meanwhile (owner, 2026-10-08;
  [risk register](known-risks.md#the-server-is-unreachable--2026-10-08)).
- **Expect the pair** if a close came between: a cash sale of the outage
  typed after that day's close shows +X on that close and −X on the next,
  each with its reason «Продаж під час збою».
- **A sale typed from paper is dated the day it is typed,** with its mark
  «продано під час збою» in the receipt, the sales list and «Звіт». A past
  day's report does not change.

## A new version

**While the shops are closed,** in the evening or at night (owner decision,
2026-10-03): an app left open keeps the old version until it is opened
again. An urgent security fix is the exception.

```sh
cd /srv/birka/infra
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /srv/birka fetch && git -C /srv/birka checkout <the new release commit>
export BIRKA_RELEASE=$(git -C /srv/birka rev-parse --short HEAD)
docker compose build && docker compose --profile ops build ops
docker compose run --rm --no-deps api alembic upgrade head   # if this fails, stop here: see below
docker compose up -d
curl -fsS https://<domain>/api/v1/ready
docker image prune -f && docker builder prune -f --filter until=720h   # what the old images left
```

**The backup tools are installed once and reused.** The `ops` image installs
the PostgreSQL 17 client and `age` before the code, so a release reuses them
rather than downloading them again. Refresh them every month or so, and after
a PostgreSQL security release, so the server runs what CI's fresh build does:

```sh
docker compose --profile ops build --no-cache ops
```

**If `alembic upgrade head` fails, do not run `up -d`.** The running version
still matches the database. New code on a schema not brought up to date
fails every request; `/api/v1/ready` would then answer `schema`, and the bot
would tell the owner within 5 minutes. Read the error, and go back (below)
if it cannot be fixed.

Read the release's reports first. A migration that changes how stock or
money is recorded says so, and says what its downgrade refuses.

**After the update that brings `0035` (cash and card), close and reopen the
app on every phone.** A page of the previous version left open has no way
buttons: its sales, payments, returns and «Клієнт забрав» are refused, with
«Перевірте дані та поточний статус замовлення.», until it is opened again.
Operations kept on a phone from before are resent: a recorded one replays,
and one never recorded is refused and says to do it again.

**The update that brings `0036` (the mark «продано під час збою»)** needs
nothing more. A page left open sends no mark and shows the old texts; its
kept sale refused on resend now settles too. Reopen the app after it, as
always.

The build installs exactly the library versions CI tested
(`backend/requirements.lock`). The new app's page is never cached, and the
previous version's files stay for 30 days after they are replaced, so a
phone that opens the app during or after the update gets a working page.

## Going back

1. **The code alone.**
   - Check out the previous commit, `export BIRKA_RELEASE=$(git -C /srv/birka rev-parse --short HEAD)`,
     build, and `up -d`. The build installs
     that commit's `requirements.lock`, so its library versions come back
     too.
   - Safe while the new version's migrations only added things; most do.
   - A migration's own report says when an older build is unsafe beside
     its data.
   - **Not across `0035` once phones run the new version.** Prefer a fix
     forward. Going back by the code alone there:
     - a sale recorded with its way whose answer was lost, resent to the old
       server, gets a 409, and the phone holds it until the server is
       upgraded again;
     - payments, returns and «Клієнт забрав» from a page of the new version
       are refused by the old code;
     - what the old code records has no way: it reads «не вказано», it is in
       no expected sum, and the next close shows a false surplus until a
       manager fixes each from «не вказано».

     If it cannot be avoided, reopen the app on every phone after going
     back, and again after the next upgrade.
   - **Across `0036` (the mark) it is safe.** The old code leaves the mark's
     columns to their defaults. A marked sale from a page of the new version
     is refused by it, and nothing is sold. One narrow case holds a phone: a
     marked sale recorded whose answer was lost, resent to the old server,
     is refused before its lookup and stays kept until the server is
     upgraded again.
2. **Code and schema: a migration's downgrade.**
   - Only where its report says the downgrade is lossless.
   - Several refuse while data they cannot keep exists, by design, rather
     than lose it.
   - `0035` refuses once any drawer was closed, any cash was taken out or
     put in, any way was corrected, or any sale, payment or return was
     recorded with its way: `0034` cannot say how anything was paid. In
     practice, once the shops have sold, only a fix forward or the backup
     goes back.
   - `0036` refuses once any sale carries the mark «продано під час збою»:
     `0035` cannot hold it, and the mark is never changed.
3. **Everything: the backup taken before the update.**
   - Follow [restoring for real](backup-restore-runbook.md#restoring-for-real).
   - Whatever was recorded since that backup is lost: minutes, if it was
     taken as above.

## The hot path on this server (optional)

The release reading (checklist row 22) is taken on a laptop. Before the
shops start, it can be repeated on the server itself, in a database of its
own that is dropped afterwards, while nobody uses the app. Untried on a
server; the commands are those of the
[hot path report](hot-path-budget-report.md):

```sh
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" birka_perf'
docker compose run -d --name birka-perf-api --no-deps \
  -e BIRKA_APP_ENV=ci -e BIRKA_LOG_LEVEL=WARNING \
  -e BIRKA_DATABASE_URL=postgresql+asyncpg://<user>:<password>@db:5432/birka_perf \
  api sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 58043 --no-access-log"
docker compose run --rm --no-deps \
  -e BIRKA_PERF_DATABASE_URL=postgresql+asyncpg://<user>:<password>@db:5432/birka_perf \
  -e BIRKA_PERF_API_URL=http://birka-perf-api:58043 -e BIRKA_PERF_GATE=all \
  api python -m scripts.measure_hot_path
docker rm -f birka-perf-api
docker compose exec db sh -c 'dropdb -U "$POSTGRES_USER" birka_perf'
```

`<user>` and `<password>` are `POSTGRES_USER` and `POSTGRES_PASSWORD` from
`.env`. Both containers run with the server's own bot token, which the
harness signs its launch data with. Every case must pass (owner, 2026-10-03).

## Security

- **SSH:** keys only. Run `ufw` or the provider's firewall with 22, 80 and
  443 open (`ufw allow 443`, which covers TCP and UDP).
- **The database** listens only on the compose network.
- **`.env`** is `chmod 600`. The bot token and session secret are in it,
  and nowhere in the repository.
- **Only Telegram may show the app in a frame** (`frame-ancestors`). The
  API is reachable by anyone on the domain; what keeps it to the shop's
  people is Telegram's signed sign-in data and their roles.
- **What anyone may send:** a request body of at most 1 MB (Caddy), and 30
  sign-ins a minute from one address (the API). Neither is near what a shop
  sends.
- **A secret leaked:**
  - the session secret: put a new `BIRKA_SESSION_SECRET` in `.env` and
    `docker compose up -d api`. Everyone is signed out and opens the app
    again;
  - the bot token: revoke it in @BotFather, put the new one in `.env`, and
    `docker compose up -d api backup-watch` (both hold it).
- **People are added on the server** (`scripts.people`). Whoever can run it
  can name any owner, so access to the server is access to the shop.

## Not covered

- **Nobody is named to hear of trouble yet**, and no outside check-in
  service exists: until both are set up ([step 8a](#8a-being-told-when-something-fails)),
  a server that dies whole is noticed only by the sellers.
- **Nothing here has run on a production server.** Public HTTPS issuance
  has never been tried. The 2026-09-16 run used Caddy's own local
  certificate.
- **The images `postgres:17-alpine`, `caddy:2-alpine` and `node:24-alpine`
  float.** A build picks up their newest minor versions. The API's Python
  is pinned (`python:3.12.14-slim`) and its libraries are locked, without
  hashes yet.
- **The server size is an estimate.** The hot-path budgets are measured on
  a laptop and on a two-CPU CI runner, not on the server or on a phone in a
  shop.
