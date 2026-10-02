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
| A domain name | its DNS `A` record pointing at the server. Telegram opens a Mini App only over HTTPS; Caddy gets the certificate itself. |
| Open ports | 22 (SSH), 80 and 443. Nothing else: the database is never published. |
| The clock | synchronized (`timedatectl` says `System clock synchronized: yes`). Telegram's sign-in data is refused when its time is in the future, or more than an hour old. |
| A Telegram bot | made with @BotFather. Its token signs every sign-in; the server must have the same one. |
| The owner's age key | made on the owner's computer ([backup runbook, step 1](backup-restore-runbook.md#1-the-owners-key-on-the-owners-computer)). Only the public half goes to the server. |

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
| `BIRKA_APP_ENV` | `production`. The API then refuses to start without the bot token and a session secret of at least 32 bytes, and hides its API docs. |
| `BIRKA_DOMAIN` | the domain, e.g. `shop.example.com` |
| `POSTGRES_PASSWORD` | long and random: `openssl rand -base64 32` |
| `BIRKA_TELEGRAM_BOT_TOKEN` | from @BotFather |
| `BIRKA_SESSION_SECRET` | `openssl rand -base64 48` |
| `BIRKA_BACKUP_AGE_RECIPIENTS` | the owner's public key, `age1…` |
| `BIRKA_SENTRY_DSN` | optional |

**Keep a copy of `.env` in the password manager.** It is in no backup.

### 3. Build, and the database

```sh
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

### 8. Backups

Follow the [backup runbook](backup-restore-runbook.md#setting-it-up), steps
2–4, from `/srv/birka/infra`:
- the first night by hand;
- the owner pressing «Start» in the bot, so the bot may write to them;
- the crontab line;
- the read-only user for the owner's computer.

**The release is not done until the owner's «Резервні копії» section shows
a good night.**

### 9. The shops' existing stock, before anything moves

**Nothing is received, sold or corrected until this step is done.** A
warehouse takes an opening balance only while nothing has ever been
recorded in it (owner decision, 2026-09-29, Q1). Its first receipt, sale,
«фізично є» or stock correction closes it to an opening list for good, and
so does an approved list: each warehouse takes one. Both stores sell from
the one shared warehouse, so a single delivery received there ends this way
in for everything the shops already hold.

On 2026-10-01 the owner allowed two ways in, and has not yet chosen between
them (business rules, "going live"). Ask which, before anything else:
- **lists with review**, which the app has: «Початкові залишки»;
- **photos of the notebooks**, read by a separate parser into JSON. That
  does not exist yet. If the owner picks it, the rules that stand keep each
  warehouse untouched until its JSON goes in as its opening balance. The
  JSON's shape, and whether its lines pass through review, are not decided.

If the owner chooses lists, then for each warehouse, in this order:

1. **The count.** Count the goods, or take the notebooks as they stand on
   one day. The shop goes on selling on paper and keeps those sales.
2. **The catalogue.** A line is answered by picking a model, so every model
   the list names is created in «Каталог» first. Sellers may do this too.
3. **The list.** The owner or a manager (`snapshot:import`) types or pastes
   it in «Початкові залишки» for that warehouse, then answers every line:
   - the model;
   - the size, or «Розмір невідомий»;
   - where the count came from;
   - or «Це не товар», with a reason.

   **A warehouse's stock fits in one list**, since it takes one:
   - at most 1 000 lines and 100 000 characters;
   - at most 5 000 answers of a model, a size and a count.
4. **The approval.** The owner (`snapshot:approve`) approves the list, and
   it becomes the warehouse's stock. It cannot be undone. A rejected list
   changes nothing, and a new one may be typed.

   **A child store's own warehouse** (`--with-child-warehouse`) is private
   to `SECOND` (step 6). Its list is typed and answered by someone holding
   `snapshot:import` in `SECOND` itself, and approved by whoever holds the
   owner's role there (Q5). The network's owner and managers do not reach
   it through their network-wide roles.
5. **The paper sales.** Sales made on paper since the count are entered at
   the till as ordinary sales, only after the approval (Q2). Each is dated
   the day it is entered. One entered before the approval closes the
   warehouse to its list.
6. **Only then** are new deliveries received and sales made in the app.

**Nothing in the app stops a receipt or a sale while a list waits for its
approval.** Tell everyone who works there to wait.

**A delivery that arrives after the count** waits for the approval too
(Q1). The owner has not said whether it is received before or after the
paper sales are entered; ask. A paper sale of goods from such a delivery,
entered before the delivery is received, finds the shelf short. «Фізично є»
would then record those goods as found, which they were not.

**Whatever turns up later is added one by one** (owner, 2026-10-01). The
owner has not said how; ask before the first one. What stands:
- **the warehouse takes no second list**;
- **«Приймання» records a delivery**: purchased, consigned or borrowed goods
  (business rules, M1-023), which goods the shop already held are not;
- **the nearest the app has** is a manager's correction in «Залишки»,
  «Знайшли товар, якого немає в списку»;
- **nothing done one by one adds «Розмір невідомий»**: only a list does.

### 10. Check it, with nothing invented

Everything recorded in production is real, so do not test with made-up
sales. The owner, from a phone:
- signs in, and chooses a store;
- opens «Залишки», and finds there what the approved list said, less the
  paper sales entered since.

Then the first real delivery proves «Приймання», and the first real sale
proves the till.

## Keeping it running

| | |
|---|---|
| Is it up? | `docker compose ps`, and `curl -fsS https://<domain>/api/v1/health` |
| The API's log | `docker compose logs --since 1h api`. Each service keeps at most 5 × 10 MB. |
| Last night's backup | `docker compose run --rm backup-watch python -m scripts.backup_watch --status` (exit 0 only if OK). The owner sees the same in the app. |
| Disk | `df -h /`. The database, the server's ~10 backups and the nightly scratch copy share it. |
| Errors | Sentry, if `BIRKA_SENTRY_DSN` is set. Request bodies, sign-in data and tokens are scrubbed before anything leaves. |

**Never run `docker compose down -v`.** `-v` deletes the database's volume,
and with it everything since last night's backup.

## A new version

```sh
cd /srv/birka/infra
docker compose --profile ops run --rm ops                 # a backup now, before anything changes
git -C /srv/birka fetch && git -C /srv/birka checkout <the new release commit>
docker compose build && docker compose --profile ops build ops
docker compose run --rm --no-deps api alembic upgrade head
docker compose up -d
curl -fsS https://<domain>/api/v1/health
```

Read the release's reports first. A migration that changes how stock or
money is recorded says so, and says what its downgrade refuses.

## Going back

1. **The code alone.**
   - Check out the previous commit, build, and `up -d`.
   - Safe while the new version's migrations only added things; most do.
   - A migration's own report says when an older build is unsafe beside
     its data.
2. **Code and schema: a migration's downgrade.**
   - Only where its report says the downgrade is lossless.
   - Several refuse while data they cannot keep exists, by design, rather
     than lose it.
3. **Everything: the backup taken before the update.**
   - Follow [restoring for real](backup-restore-runbook.md#restoring-for-real).
   - Whatever was recorded since that backup is lost: minutes, if it was
     taken as above.

## Security

- **SSH:** keys only. Run `ufw` or the provider's firewall with 22, 80 and
  443 open.
- **The database** listens only on the compose network.
- **`.env`** is `chmod 600`. The bot token and session secret are in it,
  and nowhere in the repository.
- **The app only opens inside Telegram.** Caddy sends `frame-ancestors`
  for Telegram only.
- **People are added on the server** (`scripts.people`). Whoever can run it
  can name any owner, so access to the server is access to the shop.

## Not covered

- **Nothing here has run on a production server.** Public HTTPS issuance
  has never been tried. The 2026-09-16 run used Caddy's own local
  certificate.
- **The images use `postgres:17-alpine` and `caddy:2-alpine`.** A build
  picks up their newest minor versions.
- **The server size is an estimate.** The hot-path budgets are measured on
  a laptop and on a two-CPU CI runner, not on the server or on a phone in a
  shop.
