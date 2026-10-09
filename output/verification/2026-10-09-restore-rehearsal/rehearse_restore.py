"""A rehearsal of the backup runbook's "restoring for real", on this Mac.

An "old server" (Compose project birka-rehearsal-old) is set up as the
server runbook says, filled through the real API, backed up by its first
night, changed after that night, collected by the owner's computer, and
destroyed. A "new server" (birka-rehearsal-new) is then restored from the
owner's copy, step by step, with the runbook's own commands, run as written
in a shell that has not sourced `.env`, as a fresh SSH session would be.

Isolation: its own Compose projects and volumes, Caddy on 127.0.0.1 only
(58280/58643, then 58281/58644), working files in
~/.cache/birka-runtime/rehearsal, images already built here (nothing pulled
or built: `build: !reset null`, `pull_policy: never`), test secrets made for
this run. Everything it starts it removes at the end; the images stay.

Every step is logged with its command, its output and whether it held, to
the evidence directory given as the first argument.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode

import httpx

REPO = Path("/Users/nikitahlushak/birka")
INFRA = REPO / "infra"
HOME = Path.home() / ".cache/birka-runtime/rehearsal"
DOCKER_BIN = Path.home() / ".docker/bin"
BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-secret"
OWNER_TG = 700_000_001
SELLER_TG = 700_000_002

OVERRIDE = """\
# The rehearsal's own: images already built on this Mac, nothing pulled or
# built, and Caddy on this Mac's loopback only.
services:
  api:
    image: birka-ci-local-api
    build: !reset null
    pull_policy: never
  backup-watch:
    image: birka-ci-local-api
    build: !reset null
    pull_policy: never
  ops:
    image: birka-ci-local-ops
    build: !reset null
    pull_policy: never
  web:
    image: birka-edge-check-web
    build: !reset null
    pull_policy: never
  caddy:
    ports: !override
      - "127.0.0.1:${REHEARSAL_HTTP}:80"
      - "127.0.0.1:${REHEARSAL_HTTPS}:443"
      - "127.0.0.1:${REHEARSAL_HTTPS}:443/udp"
"""


class Log:
    def __init__(self, out: Path) -> None:
        self.out = out
        out.mkdir(parents=True, exist_ok=True)
        self.lines: list[str] = []
        self.findings: list[str] = []

    def write(self, text: str) -> None:
        print(text, flush=True)
        self.lines.append(text)
        (self.out / "rehearsal.md").write_text("\n".join(self.lines) + "\n")

    def finding(self, text: str) -> None:
        self.findings.append(text)
        self.write(f"\n> **Finding:** {text}\n")


def redact(text: str, env: dict[str, str]) -> str:
    for key in ("POSTGRES_PASSWORD", "BIRKA_SESSION_SECRET"):
        if env.get(key):
            text = text.replace(env[key], f"<{key}>")
    return text


class Server:
    """One Compose project, driven as an administrator would drive it."""

    def __init__(self, name: str, log: Log, env_file: Path, override: Path, http: int, https: int):
        self.name = name
        self.log = log
        self.env_file = env_file
        self.http, self.https = http, https
        self.values = dict(
            line.split("=", 1) for line in env_file.read_text().splitlines() if "=" in line
        )
        # What `docker compose` sees on the server: its own .env (here passed
        # as COMPOSE_ENV_FILES) and nothing exported in the shell.
        self.shell = {
            "PATH": f"{DOCKER_BIN}:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(Path.home()),
            "COMPOSE_PROJECT_NAME": name,
            "COMPOSE_FILE": f"{INFRA / 'docker-compose.yml'}:{override}",
            "COMPOSE_ENV_FILES": str(env_file),
            "DOCKER_CONFIG": str(Path.home() / ".docker"),
        }

    def sh(
        self,
        command: str,
        *,
        title: str,
        expect: int | None = 0,
        timeout: int = 900,
        cwd: Path = INFRA,
    ) -> subprocess.CompletedProcess[str]:
        """A runbook command, run as written in /bin/sh, from infra/ unless
        `cwd` says otherwise; nothing typed into it (stdin is empty)."""
        started = time.monotonic()
        try:
            done = subprocess.run(
                ["/bin/sh", "-c", command],
                cwd=cwd,
                env=self.shell,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as hung:
            done = subprocess.CompletedProcess(
                hung.cmd, 124, (hung.stdout or b"").decode() if isinstance(hung.stdout, bytes) else (hung.stdout or ""),
                f"(still running after {timeout} s: stopped)",
            )
        took = time.monotonic() - started
        held = expect is None or done.returncode == expect
        output = redact((done.stdout + done.stderr).strip(), self.values)
        tail = "\n".join(output.splitlines()[-25:])
        self.log.write(
            f"\n**{title}** — {'ran' if expect is None else 'held' if held else 'DID NOT HOLD'} "
            f"(exit {done.returncode}, {took:.1f} s)\n\n"
            f"```sh\n{redact(command, self.values)}\n```\n\n```\n{tail}\n```"
        )
        if not held:
            raise RuntimeError(f"{self.name}: {title} exited {done.returncode}")
        return done

    def psql(self, sql: str, *, title: str) -> str:
        """The runbook's `psql`, with `-T` and `-At` for a script."""
        done = self.sh(
            "docker compose exec -T db sh -c 'psql -U \"$POSTGRES_USER\" \"$POSTGRES_DB\" -At' <<'SQL'\n"
            f"{sql}\nSQL",
            title=title,
        )
        return done.stdout.strip()

    @property
    def url(self) -> str:
        return f"https://localhost:{self.https}"


def init_data(telegram_id: int, name: str) -> str:
    fields = {
        "auth_date": str(int(time.time())),
        "user": json.dumps({"id": telegram_id, "first_name": name}, ensure_ascii=False, separators=(",", ":")),
    }
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


class Shop:
    """The app, as a phone reaches it through Caddy."""

    def __init__(self, server: Server, log: Log, telegram_id: int, name: str):
        self.client = httpx.Client(base_url=server.url, verify=False, timeout=30)
        self.log = log
        signed = self.client.post("/api/v1/auth/telegram", json={"init_data": init_data(telegram_id, name)})
        signed.raise_for_status()
        self.client.headers["Authorization"] = f"Bearer {signed.json()['access_token']}"
        self.me = self.get("/api/v1/me")
        self.store = next(s for s in self.me["stores"] if s["code"] == "MAIN")["id"]
        self.locations = self.get(f"/api/v1/stock-locations?store_id={self.store}")
        self.warehouse = next(l for l in self.locations if l["can_sell"] and not l["damaged_returns"])["id"]

    def get(self, path: str) -> dict | list:
        response = self.client.get(path)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, body: dict, *, key: bool = False, expect: int = 200) -> dict:
        headers = {"Idempotency-Key": str(uuid.uuid4())} if key else {}
        response = self.client.post(path, json=body, headers=headers)
        if response.status_code != expect:
            raise RuntimeError(f"POST {path}: {response.status_code} {response.text[:400]}")
        return response.json()

    def coat(self, name: str, quantity: int) -> tuple[str, str]:
        product = self.post(
            "/api/v1/catalog/products",
            {
                "store_id": self.store,
                "concept": name,
                "variant": {"color": "шоколад"},
                "sizes": [{"system": "ALPHA", "code": "M"}],
            },
            key=True,
            expect=201,
        )
        variant, size = product["product_variant_id"], product["sizes"][0]["size_id"]
        self.post(
            "/api/v1/inventory/receipts",
            {
                "store_id": self.store,
                "location_id": self.warehouse,
                "command_id": str(uuid.uuid4()),
                "lines": [
                    {
                        "product_variant_id": variant,
                        "size_id": size,
                        "quantity": quantity,
                        "acquisition_type": "PURCHASE",
                        "unit_cost": None,
                    }
                ],
                "notes": None,
            },
            key=True,
            expect=201,
        )
        return variant, size

    def sell(self, variant: str, size: str, *, credit: dict | None = None) -> dict:
        body = {
            "store_id": self.store,
            "command_id": str(uuid.uuid4()),
            "lines": [
                {
                    "product_variant_id": variant,
                    "size_id": size,
                    "source_location_id": self.warehouse,
                    "quantity": 1,
                    "unit_price": "1500.00",
                }
            ],
            "payment_method": "CASH",
        }
        if credit:
            body["credit"] = credit
        return self.post("/api/v1/sales", body, key=True, expect=201)

    def pay_off(self, credit_id: str) -> None:
        owed = self.get(f"/api/v1/credits/{credit_id}")["owed"]
        self.post(
            f"/api/v1/credits/{credit_id}/payments",
            {"command_id": str(uuid.uuid4()), "amount": owed, "payment_method": "CASH"},
            expect=201,
        )


def env_file(path: Path, *, backups: Path, recipient: str, http: int, https: int, password: str, secret: str) -> Path:
    path.write_text(
        "\n".join(
            [
                f"POSTGRES_PASSWORD={password}",
                f"BIRKA_TELEGRAM_BOT_TOKEN={BOT_TOKEN}",
                f"BIRKA_SESSION_SECRET={secret}",
                f"BIRKA_BACKUP_AGE_RECIPIENTS={recipient}",
                f"BIRKA_BACKUP_DIR={backups}",
                "BIRKA_DOMAIN=localhost",
                f"REHEARSAL_HTTP={http}",
                f"REHEARSAL_HTTPS={https}",
                "",
            ]
        )
    )
    return path


def wait_ready(server: Server, log: Log) -> None:
    for _ in range(90):
        try:
            if httpx.get(f"{server.url}/api/v1/ready", verify=False, timeout=5).status_code == 200:
                log.write(f"\n`{server.url}/api/v1/ready` answers 200.")
                return
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise RuntimeError(f"{server.name}: never ready")


def main() -> int:
    out = Path(sys.argv[1])
    log = Log(out)
    if HOME.exists():
        shutil.rmtree(HOME / "work", ignore_errors=True)
    work = HOME / "work"
    old_backups, new_backups, owner = work / "old-backups", work / "new-backups", work / "owner"
    for folder in (old_backups, new_backups, owner):
        folder.mkdir(parents=True)
    override = work / "override.yml"
    override.write_text(OVERRIDE)
    password = base64.b64encode(secrets.token_bytes(24)).decode().replace("/", "_").replace("+", "-")
    secret = base64.b64encode(secrets.token_bytes(48)).decode()
    log.write(
        "# Rehearsal: restoring for real\n\n"
        f"Commit {subprocess.run(['git', '-C', str(REPO), 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()}; "
        f"started {time.strftime('%Y-%m-%d %H:%M:%S %Z')}. Test secrets made for this run; the bot token is the tests' fake one."
    )
    servers: list[Server] = []
    try:
        # --- The owner's key (backup runbook, step 1) ----------------------
        log.write("\n## The owner's key (backup runbook, setting it up, step 1)")
        keygen = subprocess.run(
            [str(DOCKER_BIN / "docker"), "run", "--rm", "--entrypoint", "age-keygen", "birka-ci-local-ops"],
            capture_output=True, text=True, check=True,
        )
        (owner / "birka-backup-key.txt").write_text(keygen.stdout)
        recipient = next(l.split(": ", 1)[1] for l in keygen.stderr.splitlines() + keygen.stdout.splitlines() if "public key:" in l.lower())
        log.write(
            "\n`age-keygen -o birka-backup-key.txt`, run in the ops image (age is not installed on this Mac; "
            f"the owner's computer has it). Public key `{recipient[:12]}…`."
        )

        # --- The old server --------------------------------------------------
        log.write("\n## The old server (server runbook, steps 3, 4 and 6; backup runbook, step 2)")
        old = Server(
            "birka-rehearsal-old", log,
            env_file(work / "old.env", backups=old_backups, recipient=recipient, http=58280, https=58643,
                     password=password, secret=secret),
            override, 58280, 58643,
        )
        servers.append(old)
        old.sh("docker compose up -d --wait db", title="Database up")
        old.sh("docker compose run --rm --no-deps api alembic upgrade head", title="Migrate")
        old.sh("docker compose run --rm --no-deps api alembic check", title="alembic check")
        old.sh("docker compose up -d", title="Start it")
        wait_ready(old, log)
        old.sh(
            f"docker compose run --rm --no-deps api python -m scripts.seed_organization "
            f"--telegram-user-id {OWNER_TG} --owner-name \"Власниця\" --org-name \"Репетиція\"",
            title="The owner and the shop's places",
        )

        owner_app = Shop(old, log, OWNER_TG, "Власниця")
        sold, size = owner_app.coat("Лоран репетиція", 10)
        plain = owner_app.sell(sold, size)
        paid_long_ago = owner_app.sell(sold, size, credit={"customer_name": "Ганна Давня", "customer_phone": "0671110001", "paid_now": "500.00"})
        asked_later = owner_app.sell(sold, size, credit={"customer_name": "Олена Пізня", "customer_phone": "0671110002", "paid_now": "500.00"})
        still_owing = owner_app.sell(sold, size, credit={"customer_name": "Ірина Винна", "customer_phone": "0671110003", "paid_now": "500.00"})
        for credit in (paid_long_ago, asked_later):
            owner_app.pay_off(credit["credit"]["credit_id"])
        log.write(
            "\nThrough the app (Caddy, the owner signed in): a coat model received 10; four sales, three of them "
            "in parts (Ганна and Олена paid off, Ірина still owes 1000)."
        )
        # Ганна's debt closed two years ago: past her term, kept in the backup
        # because the watcher has already made its first look.
        for _ in range(60):
            seen = old.sh("docker compose logs backup-watch", title="The watcher's log", expect=None)
            if "backup_watch.started" in seen.stdout:
                break
            time.sleep(2)
        # Its first erasure runs as it starts: give it time to end, so the
        # backdated debt is still named in the night's copy (checked below).
        time.sleep(15)
        old.psql(
            f"UPDATE customer_credit SET closed_at = now() - interval '2 years' WHERE id = '{paid_long_ago['credit']['credit_id']}'",
            title="Ганна's debt closed two years ago (SQL, for the rehearsal only)",
        )

        log.write("\n## The first night (backup runbook, step 2)")
        old.sh("ls -ld \"$(sed -n 's/^BIRKA_BACKUP_DIR=//p' \"$COMPOSE_ENV_FILES\")\"", title="The backup directory", expect=None)
        old.sh("docker compose --profile ops run --rm ops", title="The first night, by hand", timeout=1200)
        kept = old.psql(
            f"SELECT customer_name FROM customer_credit WHERE id = '{paid_long_ago['credit']['credit_id']}'",
            title="Ганна is still named in the night's copy",
        )
        if kept != "Ганна Давня":
            log.write("\n**The rehearsal's premise broke:** Ганна was erased before the night; step 7's term check proves nothing.")
        last = json.loads((old_backups / "last-run.json").read_text())
        log.write(f"\n`cat backups/last-run.json`: `\"ok\": {json.dumps(last.get('ok'))}`.")
        if last.get("ok") is not True:
            log.finding("the first night did not hold")
        old.sh("docker compose run --rm backup-watch python -m scripts.backup_watch --status", title="The backups' state now", expect=None)

        log.write("\n## After the night: what a restore of it loses, or brings back")
        after = owner_app.sell(sold, size)
        erased = owner_app.post(f"/api/v1/credits/{asked_later['credit']['credit_id']}/erase-customer", {})
        log.write(
            f"\nA fifth sale ({after['id'][:8]}), and Олена asked to be erased: erased {erased['erased']}, "
            f"network {erased['network']}."
        )

        log.write("\n## The owner's computer collects (backup runbook, step 4)")
        collected = subprocess.run(
            ["/bin/sh", str(INFRA / "pull-backups.sh")],
            env={"PATH": "/usr/bin:/bin", "HOME": str(Path.home()), "BIRKA_BACKUP_SOURCE": f"{old_backups}/", "BIRKA_BACKUP_DEST": str(owner)},
            capture_output=True, text=True,
        )
        log.write(
            f"\n**`sh infra/pull-backups.sh`**, the server's directory as a local path (the SSH leg, step 3, is not "
            f"rehearsed) — exit {collected.returncode}\n\n```\n{(collected.stdout + collected.stderr).strip()}\n```"
        )

        log.write("\n## Before the old server goes: who asked since that night (restoring, step 7)")
        night = sorted(p.name for p in owner.glob("birka-*Z.json"))[-1]
        stamp = night.removeprefix("birka-").removesuffix(".json")
        taken = f"{stamp[0:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]}+00"
        asked = old.psql(
            "SELECT entity_id AS credit_id, created_at FROM audit_log "
            "WHERE action = 'credit.customer_erased' AND after->>'by' = 'request' "
            f"AND created_at > '{taken}' ORDER BY created_at;",
            title="The runbook's query, on the old database",
        )
        asked_ids = [line.split("|")[0] for line in asked.splitlines() if line]
        if asked_ids != [asked_later["credit"]["credit_id"]]:
            log.finding(f"the query listed {asked_ids}, expected Олена's debt alone")
        old.sh("docker compose down -v", title="The old server is gone")
        servers.remove(old)

        # --- The new server: restoring for real ----------------------------
        log.write("\n## Restoring for real (backup runbook), on a new server")
        new = Server(
            "birka-rehearsal-new", log,
            env_file(work / "new.env", backups=new_backups, recipient=recipient, http=58281, https=58644,
                     password=password, secret=secret),
            override, 58281, 58644,
        )
        servers.append(new)
        drilled = [
            p.name.removesuffix(".drill.json")
            for p in sorted(owner.glob("birka-*.drill.json"))
            if json.loads(p.read_text()).get("ok") is True
        ]
        log.write(f"\n**1.** The newest night whose drill held: `{drilled[-1]}`.")
        archive = owner / f"{drilled[-1]}.dump.age"
        subprocess.run(
            [str(DOCKER_BIN / "docker"), "run", "--rm", "-v", f"{owner}:/owner", "--entrypoint", "age",
             "birka-ci-local-ops", "--decrypt", "-i", "/owner/birka-backup-key.txt", "-o", "/owner/birka.dump",
             f"/owner/{archive.name}"],
            check=True, capture_output=True, text=True,
        )
        digest = hashlib.sha256((owner / "birka.dump").read_bytes()).hexdigest()
        manifest = json.loads((owner / f"{drilled[-1]}.json").read_text())
        log.write(
            "\n**2.** `age --decrypt -i birka-backup-key.txt -o birka.dump …` (in the ops image: no age on this Mac), "
            f"then `shasum -a 256 birka.dump`: {'equals' if digest == manifest['archive_sha256'] else 'DIFFERS FROM'} "
            "`archive_sha256`."
        )
        if digest != manifest["archive_sha256"]:
            log.finding("the decrypted archive is not the one drilled")
        shutil.copy(owner / "birka.dump", new_backups / "birka.dump")
        # The server's infra/ holds its backups/ directory; here a link to it.
        (work / "backups").symlink_to(new_backups)
        new.sh("docker compose up -d --wait db", title="3. The database only")
        written = (
            "docker compose --profile ops run --rm \\\n"
            "  -e PGHOST=db -e PGUSER=\"$POSTGRES_USER\" -e PGPASSWORD=\"$POSTGRES_PASSWORD\" -e PGDATABASE=\"$POSTGRES_DB\" \\\n"
            "  ops sh -c '\"$BIRKA_PG_BIN/pg_restore\" --exit-on-error --single-transaction --no-owner --no-privileges "
            "--dbname=\"$PGDATABASE\" /backups/birka.dump'"
        )
        first = new.sh(written, title="4. Restore, the runbook's command as written", expect=None, timeout=120)
        if first.returncode != 0:
            log.finding(
                "step 4 as written does not restore: in a shell that has not read `.env` (a fresh SSH "
                "session) `$POSTGRES_USER`, `$POSTGRES_PASSWORD` and `$POSTGRES_DB` are empty, so "
                "`pg_restore` has no password; on a terminal it asks for one, unattended it waits for "
                "ever (the first run here was stopped after 900 s). Fixed: restore through the database "
                "container, which holds those values and needs no password for a local connection"
            )
            new.sh(
                "docker compose exec -T db sh -c 'pg_restore --username=\"$POSTGRES_USER\" "
                "--dbname=\"$POSTGRES_DB\" --exit-on-error --single-transaction --no-owner --no-privileges' "
                "< backups/birka.dump",
                title="4. Restore, as the runbook now says",
                cwd=work,
            )
        new.sh("docker compose run --rm --no-deps api alembic upgrade head", title="5. Migrate (the code is not newer)")
        new.sh("docker compose up -d", title="6. Start it")
        wait_ready(new, log)
        new.sh("docker compose ps --format '{{.Service}} {{.State}} {{.Health}}'", title="6. docker compose ps", expect=None)

        back = Shop(new, log, OWNER_TG, "Власниця")
        options = back.get(
            f"/api/v1/catalog/stock-options?store_id={back.store}&location_id={back.warehouse}"
        )
        on_hand = sum(o["quantity"] for o in options["items"] if o["product_variant_id"] == sold)
        log.write(f"\n**6.** A stock view: the coat stands at {on_hand} (10 received, 4 sold before the night: 6).")
        if on_hand != 6:
            log.finding(f"the restored stock is {on_hand}, not 6")
        sales = back.get(f"/api/v1/sales?store_id={back.store}&limit=50")
        ids = {s["id"] for s in sales["sales"]}
        log.write(
            f"\n**6.** Signed in as the owner. Sales: {len(ids)}; the night's four "
            f"{'are' if {plain['id'], paid_long_ago['id'], asked_later['id'], still_owing['id']} <= ids else 'are NOT all'} there, "
            f"the one after it {'is not' if after['id'] not in ids else 'IS'} (lost, at most a day by the policy)."
        )
        for title, credit, expect_name in (
            ("Ірина, still owing", still_owing, "Ірина Винна"),
            ("Олена, erased after the night", asked_later, "Олена Пізня"),
        ):
            got = back.get(f"/api/v1/credits/{credit['credit']['credit_id']}")["customer_name"]
            log.write(f"\n{title}: `{got}`.")
            if got != expect_name:
                log.finding(f"{title} reads {got!r}")

        log.write("\n**7.** Customers erased since that night")
        for _ in range(30):
            if back.get(f"/api/v1/credits/{paid_long_ago['credit']['credit_id']}")["customer_name"] is None:
                break
            time.sleep(2)
        gone = back.get(f"/api/v1/credits/{paid_long_ago['credit']['credit_id']}")["customer_name"] is None
        log.write(f"\nГанна, past her term: erased by the watcher as it started: {'yes' if gone else 'NO'}.")
        if not gone:
            log.finding("the watcher did not erase a customer past her term after the restore")
        names = new.psql(
            "SELECT id, customer_name FROM customer_credit WHERE id IN ('" + "', '".join(asked_ids) + "');",
            title="The runbook's query, on the restored server",
        )
        for line in names.splitlines():
            credit_id, name = line.split("|")
            found = back.get(f"/api/v1/credits/customers?store_id={back.store}&query={name.split()[0]}")
            log.write(f"\nThe owner finds «{name}» in «Борги»: {len(found['items'])} customer(s).")
            again = back.post(f"/api/v1/credits/{credit_id}/erase-customer", {})
            log.write(f"\n«Стерти дані покупця» again: erased {again['erased']}.")
        final = back.get(f"/api/v1/credits/{asked_later['credit']['credit_id']}")["customer_name"]
        if final is not None:
            log.finding("Олена is not erased after step 7")
        log.write(f"\nОлена after step 7: `{final}`.")
        new.sh(
            "docker compose run --rm backup-watch python -m scripts.backup_watch --status",
            title="The backups' state on the new server, before step 8",
            expect=None,
        )
        log.write("\n**8.** Backups on the new server: the same key, the first night by hand, the owner's computer pointed at it")
        new.sh("docker compose --profile ops run --rm ops", title="8. The new server's first night", timeout=1200)
        new.sh(
            "docker compose run --rm backup-watch python -m scripts.backup_watch --status",
            title="8. The backups' state now",
        )
        recollected = subprocess.run(
            ["/bin/sh", str(INFRA / "pull-backups.sh")],
            env={"PATH": "/usr/bin:/bin", "HOME": str(Path.home()), "BIRKA_BACKUP_SOURCE": f"{new_backups}/", "BIRKA_BACKUP_DEST": str(owner)},
            capture_output=True, text=True,
        )
        nights = sorted(p.name for p in owner.glob("birka-*Z.json"))
        log.write(
            f"\n**8.** `sh infra/pull-backups.sh` from the new server — exit {recollected.returncode}; the owner's "
            f"computer now holds {len(nights)} nights: {', '.join(n.removesuffix('.json') for n in nights)}.\n\n"
            f"```\n{(recollected.stdout + recollected.stderr).strip()}\n```"
        )
        if recollected.returncode != 0 or len(nights) != 2:
            log.finding("the owner's computer did not collect the new server's first night beside the old one")
        new.sh("rm -f \"$(sed -n 's/^BIRKA_BACKUP_DIR=//p' \"$COMPOSE_ENV_FILES\")/birka.dump\"", title="6. The plaintext dump deleted")
        (owner / "birka.dump").unlink()
        log.write("\nThe plaintext `birka.dump` on the owner's side deleted too.")
    finally:
        for server in servers:
            try:
                server.sh("docker compose down -v", title=f"{server.name} removed", expect=None)
            except Exception as error:  # noqa: BLE001
                log.write(f"\n{server.name}: could not remove: {error!r}")
        log.write("\n## Findings\n")
        log.write("\n".join(f"- {f}" for f in log.findings) or "None.")
    return 1 if log.findings else 0


if __name__ == "__main__":
    sys.exit(main())
