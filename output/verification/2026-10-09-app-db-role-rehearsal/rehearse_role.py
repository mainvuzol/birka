"""The app's own database role (ADR-0016), rehearsed through an update and a
restore, on this Mac.

One server (Compose project birka-rehearsal-role) runs from its own git
checkout, a local clone standing for /srv/birka. It is installed at main
(the release before the role), where the API connects as the database's
owner, and used through the real API. Then:

1. updated to the role's release with "a new version", once `.env` has the
   new line: the API and backup-watch now connect as `birka_app`;
2. used as `birka_app`: sales, a payment, a customer erased on request, the
   people's and stores' commands, the night's backup;
3. taken back by the code alone to main, and forward again;
4. restored on a new server from the owner's copy of the night, by the
   backup runbook's "restoring for real" (its step 5 now gives the role its
   rights); first without the rights, to see what the API says.

The runbook's commands run as written, in /bin/sh from the checkout's
infra/, in a shell that has not read `.env`. Stand-ins, named in the log:
the checkouts live under ~/.cache/birka-runtime/role-rehearsal; the build
is make-images.sh, each release's backend code over the images built here
(a build would fetch base images); the web bundle stays the one built here.
The containers sit on an internal network: nothing reaches Telegram.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
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
HOME = Path.home() / ".cache/birka-runtime/role-rehearsal"
DOCKER_BIN = Path.home() / ".docker/bin"
BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-secret"
OWNER_TG = 700_000_301
OLD_PROJECT, NEW_PROJECT = "birka-rehearsal-role", "birka-rehearsal-role-new"
OLD_PORTS, NEW_PORTS = (58580, 58943), (58581, 58944)

OVERRIDE = """\
# The rehearsal's own: each release's images made here (make-images.sh),
# named by BIRKA_RELEASE as the runbook exports it; nothing pulled or built;
# no way out of the compose network but Caddy's loopback ports.
networks:
  default:
    internal: true
  edge: {}
services:
  api:
    image: birka-rehearsal-role-api:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
    build: !reset null
    pull_policy: never
  backup-watch:
    image: birka-rehearsal-role-api:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
    build: !reset null
    pull_policy: never
  ops:
    image: birka-rehearsal-role-ops:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
    build: !reset null
    pull_policy: never
  web:
    image: birka-edge-check-web
    build: !reset null
    pull_policy: never
  caddy:
    networks: [default, edge]
    ports: !override
      - "127.0.0.1:${REHEARSAL_HTTP}:80"
      - "127.0.0.1:${REHEARSAL_HTTPS}:443"
      - "127.0.0.1:${REHEARSAL_HTTPS}:443/udp"
"""

# Who the service's own settings connect as.
WHO = (
    "'import asyncio\n"
    "from sqlalchemy import text\n"
    "from app.core.config import get_settings\n"
    "from app.core.db import create_engine\n"
    "async def main():\n"
    "    engine = create_engine(get_settings())\n"
    "    async with engine.connect() as connection:\n"
    "        row = (await connection.execute(text(\"SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user\"))).one()\n"
    "    await engine.dispose()\n"
    "    print(*row)\n"
    "asyncio.run(main())'"
)


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

    def check(self, held: bool, what: str) -> None:
        self.write(f"\n- {'held' if held else 'DID NOT HOLD'}: {what}")
        if not held:
            self.finding(what)


class Server:
    def __init__(self, log: Log, srv: Path, project: str, env_file: Path, override: Path, ports: tuple[int, int]) -> None:
        self.log = log
        self.srv = srv
        self.env_file = env_file
        self.https = ports[1]
        self.shell = {
            "PATH": f"{DOCKER_BIN}:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(Path.home()),
            "COMPOSE_PROJECT_NAME": project,
            "COMPOSE_FILE": f"{srv / 'infra/docker-compose.yml'}:{override}",
            "COMPOSE_ENV_FILES": str(env_file),
            "DOCKER_CONFIG": str(Path.home() / ".docker"),
        }

    @property
    def values(self) -> dict[str, str]:
        return dict(l.split("=", 1) for l in self.env_file.read_text().splitlines() if "=" in l)

    def redact(self, text: str) -> str:
        for key in ("POSTGRES_PASSWORD", "BIRKA_APP_DB_PASSWORD", "BIRKA_SESSION_SECRET"):
            if self.values.get(key):
                text = text.replace(self.values[key], f"<{key}>")
        return text

    def sh(self, command: str, *, title: str, expect: int | None = 0, timeout: int = 900) -> subprocess.CompletedProcess[str]:
        started = time.monotonic()
        try:
            done = subprocess.run(
                ["/bin/sh", "-c", command], cwd=self.srv / "infra", env=self.shell, stdin=subprocess.DEVNULL,
                capture_output=True, text=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            done = subprocess.CompletedProcess(command, 124, "", f"(still running after {timeout} s: stopped)")
        took = time.monotonic() - started
        held = expect is None or done.returncode == expect
        output = self.redact((done.stdout + done.stderr).strip())
        tail = "\n".join(output.splitlines()[-30:])
        verdict = "ran" if expect is None else "held" if held else "DID NOT HOLD"
        self.log.write(
            f"\n**{title}** — {verdict} (exit {done.returncode}, {took:.1f} s)\n\n"
            f"```sh\n{self.redact(command)}\n```\n\n```\n{tail}\n```"
        )
        if not held:
            raise RuntimeError(f"{title} exited {done.returncode}")
        return done

    def psql(self, sql: str, *, title: str) -> str:
        done = self.sh(
            "docker compose exec -T db sh -c 'psql -U \"$POSTGRES_USER\" \"$POSTGRES_DB\" -At' <<'SQL'\n"
            f"{sql}\nSQL",
            title=title,
        )
        return done.stdout.strip()

    def release(self) -> str:
        return f"export BIRKA_RELEASE=$(git -C {self.srv} rev-parse --short HEAD)\n"

    def who(self, service: str) -> str:
        return self.sh(self.release() + f"docker compose exec -T {service} python -c {WHO}",
                       title=f"Who {service} is to the database").stdout.strip().splitlines()[-1]

    def build(self) -> str:
        return f"sh {HOME / 'make-images.sh'} \"$BIRKA_RELEASE\" {self.srv / 'backend'}"

    def wait_ready(self) -> None:
        for _ in range(90):
            try:
                if httpx.get(f"https://localhost:{self.https}/api/v1/ready", verify=False, timeout=5).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(2)
        raise RuntimeError("never ready")

    def ready_status(self) -> tuple[int, str]:
        """Through Caddy, once the API has started: Caddy answers 502 until then."""
        for _ in range(60):
            try:
                response = httpx.get(f"https://localhost:{self.https}/api/v1/ready", verify=False, timeout=10)
                if response.status_code != 502:
                    return response.status_code, response.text
            except httpx.HTTPError:
                pass
            time.sleep(2)
        return 0, "never answered"


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
    def __init__(self, https: int) -> None:
        self.client = httpx.Client(base_url=f"https://localhost:{https}", verify=False, timeout=30)
        signed = self.client.post("/api/v1/auth/telegram", json={"init_data": init_data(OWNER_TG, "Власниця")})
        signed.raise_for_status()
        self.client.headers["Authorization"] = f"Bearer {signed.json()['access_token']}"
        me = self.get("/api/v1/me")
        self.store = next(s for s in me["stores"] if s["code"] == "MAIN")["id"]
        locations = self.get(f"/api/v1/stock-locations?store_id={self.store}")
        self.warehouse = next(l for l in locations if l["can_sell"] and not l["damaged_returns"])["id"]

    def get(self, path: str):
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
            {"store_id": self.store, "concept": name, "variant": {"color": "шоколад"},
             "sizes": [{"system": "ALPHA", "code": "M"}]},
            key=True, expect=201,
        )
        variant, size = product["product_variant_id"], product["sizes"][0]["size_id"]
        self.post(
            "/api/v1/inventory/receipts",
            {"store_id": self.store, "location_id": self.warehouse, "command_id": str(uuid.uuid4()),
             "lines": [{"product_variant_id": variant, "size_id": size, "quantity": quantity,
                        "acquisition_type": "PURCHASE", "unit_cost": None}], "notes": None},
            key=True, expect=201,
        )
        return variant, size

    def sell(self, variant: str, size: str, credit: dict | None = None) -> dict:
        body = {
            "store_id": self.store, "command_id": str(uuid.uuid4()),
            "lines": [{"product_variant_id": variant, "size_id": size, "source_location_id": self.warehouse,
                       "quantity": 1, "unit_price": "1500.00"}],
            "payment_method": "CASH",
        }
        if credit:
            body["credit"] = credit
        return self.post("/api/v1/sales", body, key=True, expect=201)

    def pay(self, credit_id: str, amount: str) -> None:
        self.post(f"/api/v1/credits/{credit_id}/payments",
                  {"command_id": str(uuid.uuid4()), "amount": amount, "payment_method": "CASH"}, expect=201)

    def on_hand(self, variant: str) -> int:
        options = self.get(f"/api/v1/catalog/stock-options?store_id={self.store}&location_id={self.warehouse}")
        return sum(o["quantity"] for o in options["items"] if o["product_variant_id"] == variant)

    def sales(self) -> int:
        return len(self.get(f"/api/v1/sales?store_id={self.store}&limit=50")["sales"])

    def credit(self, credit_id: str) -> dict:
        return self.get(f"/api/v1/credits/{credit_id}")


def env(path: Path, values: dict[str, str]) -> None:
    path.write_text("\n".join(f"{k}={v}" for k, v in values.items()) + "\n")


def main() -> int:
    out = Path(sys.argv[1])
    old, new = sys.argv[2], sys.argv[3]
    log = Log(out)
    work = HOME / "work-role"
    shutil.rmtree(work, ignore_errors=True)
    srv, srv_new = work / "srv-birka", work / "new-server" / "srv-birka"
    backups, new_backups, owner = work / "backups", work / "new-server" / "backups", work / "owner"
    for d in (backups, new_backups, owner):
        d.mkdir(parents=True)
    override = work / "override.yml"
    override.write_text(OVERRIDE)
    subprocess.run(["git", "clone", "-q", str(REPO), str(srv)], check=True)
    keygen = subprocess.run([str(DOCKER_BIN / "docker"), "run", "--rm", "--network", "none", "--entrypoint", "age-keygen",
                             "birka-ci-local-ops"], capture_output=True, text=True, check=True)
    (owner / "birka-backup-key.txt").write_text(keygen.stdout)
    recipient = next(l.split(": ", 1)[1] for l in (keygen.stderr + keygen.stdout).splitlines() if "public key:" in l.lower())
    values = {
        "POSTGRES_PASSWORD": base64.b64encode(secrets.token_bytes(32)).decode(),
        "BIRKA_TELEGRAM_BOT_TOKEN": BOT_TOKEN,
        "BIRKA_SESSION_SECRET": base64.b64encode(secrets.token_bytes(48)).decode(),
        "BIRKA_BACKUP_AGE_RECIPIENTS": recipient, "BIRKA_BACKUP_DIR": str(backups), "BIRKA_DOMAIN": "localhost",
        "REHEARSAL_HTTP": str(OLD_PORTS[0]), "REHEARSAL_HTTPS": str(OLD_PORTS[1]),
    }
    env_file = work / ".env"
    env(env_file, values)
    server = Server(log, srv, OLD_PROJECT, env_file, override, OLD_PORTS)
    new_server: Server | None = None
    log.write(
        f"# Rehearsal: the app's own database role, through an update and a restore\n\nFrom `{old}` (main, the API "
        f"as the database's owner) to `{new}` (the role), on one server whose checkout is a local clone; then a "
        f"restore on a new server. Started {time.strftime('%Y-%m-%d %H:%M:%S %Z')}. Passwords are base64 as the "
        "runbook makes them; test secrets, the tests' fake bot token; no way out of the compose network."
    )
    try:
        # --- installed at main, the API as the owner -------------------------
        log.write(f"\n## Installed at {old}, as its runbook said")
        subprocess.run(["git", "-C", str(srv), "checkout", "-q", "--detach", old], check=True)
        server.sh(server.release() + f"{server.build()}\n"
                  "docker compose up -d --wait db\n"
                  "docker compose run --rm --no-deps api alembic upgrade head\n"
                  "docker compose up -d", title="Build (stand-in), database, migration, start")
        server.wait_ready()
        server.sh(server.release() + f"docker compose run --rm --no-deps api python -m scripts.seed_organization "
                  f"--telegram-user-id {OWNER_TG} --owner-name \"Власниця\" --org-name \"Роль\"",
                  title="The owner and the shop's places")
        log.check(server.who("api") == "birka True", "before: the API connects as the database's owner, a superuser")
        shop = Shop(server.https)
        variant, size = shop.coat("Лоран роль", 10)
        shop.sell(variant, size)
        paid = shop.sell(variant, size, {"customer_name": "Марія Сплатила", "customer_phone": "0673330001", "paid_now": "500.00"})
        shop.pay(paid["credit"]["credit_id"], shop.credit(paid["credit"]["credit_id"])["owed"])
        owing = shop.sell(variant, size, {"customer_name": "Ірина Винна", "customer_phone": "0673330002", "paid_now": "500.00"})
        paid_id, owing_id = paid["credit"]["credit_id"], owing["credit"]["credit_id"]
        before = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}
        log.write(f"\nUsed through the app: a model received 10, three sales, two in parts (Марія paid off, Ірина owes "
                  f"1000). Stock and sales: {before}.")

        # --- 1. a new version, to the role -----------------------------------
        log.write(f"\n## 1. A new version: {old} → {new}")
        log.write("\nOnce, for a server installed before the role (none is): `.env` gains "
                  "`BIRKA_APP_DB_PASSWORD`, made like `POSTGRES_PASSWORD` (`openssl rand -base64 32`).")
        values["BIRKA_APP_DB_PASSWORD"] = base64.b64encode(secrets.token_bytes(32)).decode()
        env(env_file, values)
        block = "\n".join([
            "docker compose --profile ops run --rm ops                 # a backup now, before anything changes",
            f"git -C {srv} fetch && git -C {srv} checkout {new}",
            f"export BIRKA_RELEASE=$(git -C {srv} rev-parse --short HEAD)",
            f"{server.build()}   # stands in for: docker compose build && docker compose --profile ops build ops",
            "docker compose --profile ops run --rm --no-deps ops alembic upgrade head   # if this fails, stop here: see below",
            "docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role   # the rights, new tables too",
            "docker compose up -d",
            f"curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:{server.https}/api/v1/ready",
        ])
        server.sh(server.release() + block, title="The runbook's block")
        server.wait_ready()
        for service in ("api", "backup-watch"):
            log.check(server.who(service) == "birka_app False", f"{service} connects as birka_app, no superuser")
        shop = Shop(server.https)
        after = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}
        log.check(after == before, f"the same stock and sales after the update: {after}")

        # --- 2. used as birka_app ---------------------------------------------
        log.write("\n## 2. Used as birka_app")
        shop.sell(variant, size)
        shop.pay(owing_id, "300.00")
        erased = shop.post(f"/api/v1/credits/{paid_id}/erase-customer", {})
        log.check(erased.get("erased") == 1, f"a sale, a payment, and Марія erased on request, through the app: {erased}")
        marija, iryna = shop.credit(paid_id), shop.credit(owing_id)
        log.check(marija["customer_name"] is None and iryna["owed"] == "700.00",
                  f"Марія's name gone ({marija['customer_name']!r}), Ірина owes {iryna['owed']}")
        server.sh(server.release() + "docker compose run --rm --no-deps api python -m scripts.people list\n"
                  "docker compose run --rm --no-deps api python -m scripts.stores rename "
                  f"--approved-by {OWNER_TG} --store MAIN --name \"Магазин після ролі\"",
                  title="The people's and stores' commands, from api, as birka_app")
        guard = server.sh(server.release() + "docker compose exec -T api python -c '"
                          "import asyncio\nfrom sqlalchemy import text\nfrom app.core.config import get_settings\n"
                          "from app.core.db import create_engine\n"
                          "async def main():\n    engine = create_engine(get_settings())\n"
                          "    async with engine.begin() as connection:\n"
                          "        await connection.execute(text(\"ALTER TABLE credit_entry DISABLE TRIGGER ALL\"))\n"
                          "asyncio.run(main())'",
                          title="The API's own connection tries to turn off the ledger's triggers", expect=None)
        log.check(guard.returncode != 0 and "must be owner" in guard.stdout + guard.stderr,
                  "refused: must be owner of table credit_entry")
        tried = server.sh(server.release() + "docker compose run --rm --no-deps api alembic downgrade -1",
                          title="The old command, from api: a migration's downgrade", expect=None)
        rev = server.psql("SELECT version_num FROM alembic_version;", title="The schema after it")
        log.check(tried.returncode != 0 and rev == "0038_customer_erasure",
                  f"from api, as birka_app, the schema cannot be changed: refused, and it stays `{rev}`")
        watch = server.sh(server.release() + "docker compose logs backup-watch | grep -c 'backup_watch.failed' || true",
                          title="The watcher's failures since it started as birka_app", expect=None).stdout.strip()
        log.check(watch.splitlines()[-1] == "0", "the watcher runs as birka_app without a failure")
        server.sh(server.release() + "docker compose --profile ops run --rm ops\n"
                  "docker compose run --rm backup-watch python -m scripts.backup_watch --status   # as birka_app",
                  title="The night's backup, by the owner's role, after it all")
        night = sorted(p.name for p in backups.glob("birka-*Z.json"))[-1].removesuffix(".json")
        at_night = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}
        log.write(f"\nThe night: `{night}`; stock and sales then: {at_night}.")

        # --- 3. going back by the code alone, and forward ------------------
        log.write(f"\n## 3. Going back, 1: the code alone, to {old}")
        server.sh(server.release() + "\n".join([
            f"git -C {srv} checkout {old}",
            f"export BIRKA_RELEASE=$(git -C {srv} rev-parse --short HEAD)",
            f"{server.build()}   # stands in for the build",
            "docker compose up -d",
        ]), title="The old code")
        server.wait_ready()
        log.check(server.who("api") == "birka True", "the old release's API connects as the owner again; the role stays, unused")
        shop = Shop(server.https)
        log.check({"on_hand": shop.on_hand(variant), "sales": shop.sales()} == at_night, "the same stock and sales")
        server.sh(server.release() + block, title="Forward again: the runbook's block")
        server.wait_ready()
        log.check(server.who("api") == "birka_app False", "the API is birka_app again")

        # --- 4. restoring for real, on a new server ------------------------
        log.write(f"\n## 4. Restoring for real, on a new server, from the night `{night}`")
        shutil.copy(backups / f"{night}.dump.age", owner / f"{night}.dump.age")
        opened = subprocess.run(
            [str(DOCKER_BIN / "docker"), "run", "--rm", "--network", "none", "-v", f"{owner}:/owner",
             "--entrypoint", "age", "birka-ci-local-ops", "--decrypt", "-i", "/owner/birka-backup-key.txt",
             "-o", "/owner/birka.dump", f"/owner/{night}.dump.age"], capture_output=True, text=True)
        log.check(opened.returncode == 0, "steps 1–2: the owner opens the night with the key, on their computer")
        subprocess.run(["git", "clone", "-q", str(REPO), str(srv_new)], check=True)
        subprocess.run(["git", "-C", str(srv_new), "checkout", "-q", "--detach", new], check=True)
        shutil.copy(owner / "birka.dump", new_backups / "birka.dump")
        new_values = dict(values, BIRKA_BACKUP_DIR=str(new_backups), REHEARSAL_HTTP=str(NEW_PORTS[0]),
                          REHEARSAL_HTTPS=str(NEW_PORTS[1]))
        new_env = work / "new-server" / ".env"
        env(new_env, new_values)
        new_server = Server(log, srv_new, NEW_PROJECT, new_env, override, NEW_PORTS)
        new_server.sh(new_server.release() + f"{new_server.build()}\n"
                      "docker compose up -d --wait db", title="Step 3: the new server's database (its .env the old one's)")
        new_server.sh(new_server.release() + "docker compose exec -T db sh -c 'pg_restore --username=\"$POSTGRES_USER\" "
                      "--dbname=\"$POSTGRES_DB\" --exit-on-error --single-transaction --no-owner --no-privileges' "
                      f"< {new_backups / 'birka.dump'}", title="Step 4: the restore")
        new_server.sh(new_server.release() + "docker compose --profile ops run --rm --no-deps ops alembic upgrade head",
                      title="Step 5, its first line: the schema (nothing to do: the code is the backup's)")
        log.write("\nStep 6 run before step 5's second line, as an administrator might: what the API does then.")
        new_server.sh(new_server.release() + "docker compose up -d", title="Started too early")
        code, body = new_server.ready_status()
        cause = new_server.sh(new_server.release() + "docker compose logs api | grep database.unreachable | tail -1",
                              title="The API's log", expect=None).stdout
        named = "InvalidPasswordError" in cause or "InsufficientPrivilegeError" in cause
        log.check(code == 503 and '"database"' in body and named,
                  f"not ready, «database» ({code} {body.strip()}), and the log names the refusal the runbook's "
                  "table of messages sends to `scripts.app_role`: the role is not there yet on an empty volume")
        new_server.sh(new_server.release() + "docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role",
                      title="Step 5, its second line: the role's rights")
        new_server.sh(new_server.release() + "docker compose up -d\n"
                      f"curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:{new_server.https}/api/v1/ready",
                      title="Step 6: start")
        log.check(new_server.who("api") == "birka_app False", "the new server's API connects as birka_app")
        shop = Shop(new_server.https)
        restored = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}
        log.check(restored == at_night, f"the night's stock and sales are back: {restored}")
        log.check(shop.credit(paid_id)["customer_name"] is None, "Марія stays erased: the night was after it")
        shop.sell(variant, size)
        log.check(shop.sales() == at_night["sales"] + 1, "a sale on the new server, as birka_app")
    finally:
        for s in (server, new_server):
            if s is None:
                continue
            try:
                s.sh(s.release() + "docker compose --profile ops down -v --remove-orphans", title=f"Removed: {s.shell['COMPOSE_PROJECT_NAME']}", expect=None)
            except Exception as error:  # noqa: BLE001
                log.write(f"\nCould not remove: {error!r}")
        log.write("\n## Findings\n")
        log.write("\n".join(f"- {f}" for f in log.findings) or "None.")
    return 1 if log.findings else 0


if __name__ == "__main__":
    sys.exit(main())
