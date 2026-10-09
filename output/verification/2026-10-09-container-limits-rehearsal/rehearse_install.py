"""The server runbook's first install, rehearsed again with every container
held (ADR-0017): read-only images, no kernel privilege but the one each
uses, memory limits; and the app's own database role (ADR-0016). Through
every step the first install rehearsal ran: the people, a store's name, the
first night, the trouble the watcher records, the shops' existing stock,
and the check.

One server (Compose project birka-rehearsal-limits-install), from this
checkout's infra/, with this commit's backend code put over the images built
here (make-images.sh; nothing pulled or built). Its containers sit on an internal network with no way out: the
watcher's messages to Telegram fail where they would leave, and nothing
reaches Telegram with the tests' fake bot token. Caddy alone also joins a
second network, to publish on this Mac's loopback.

The runbook's commands run as written, in /bin/sh from infra/, in a shell
that has not read `.env`; the API is used through Caddy, as a phone would.
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
INFRA = REPO / "infra"
HOME = Path.home() / ".cache/birka-runtime/limits-rehearsal"
DOCKER_BIN = Path.home() / ".docker/bin"
PY = Path.home() / ".cache/birka-runtime/python/bin/python"
BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-secret"
OWNER_TG, SELLER_TG, ADMIN_TG = 700_000_201, 700_000_202, 700_000_901
PROJECT = "birka-rehearsal-limits-install"
HTTP, HTTPS = 58682, 59045
RELEASE = sys.argv[2] if len(sys.argv) > 2 else ""

OVERRIDE = """\
# The rehearsal's own: images built here, nothing pulled or built; no way
# out of the compose network but Caddy's loopback ports.
networks:
  default:
    internal: true
  edge: {}
services:
  api:
    image: birka-rehearsal-limits-api:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
    build: !reset null
    pull_policy: never
  backup-watch:
    image: birka-rehearsal-limits-api:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
    build: !reset null
    pull_policy: never
  ops:
    image: birka-rehearsal-limits-ops:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
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

STOCK_FILE = {
    "format": "birka.stock-list",
    "version": 1,
    "source": "Зошит 1, куртки",
    "counted_on": "9 жовтня",
    "price_kind": "purchase",
    "parser": "rehearsal",
    "lines": [
        {"text": "Лоран шоколад M 3 шт 1850", "photo": "IMG_0001.jpg", "photo_line": 1, "model": "Лоран",
         "colours": ["шоколад"], "sizes": ["M"], "count": 3, "price": "1850"},
        {"text": "Лоран бежевий S-1 M-2 L-1", "photo": "IMG_0001.jpg", "photo_line": 2, "model": "Лоран",
         "colours": ["бежевий"], "size_counts": [{"size": "S", "count": 1}, {"size": "M", "count": 2},
                                                {"size": "L", "count": 1}]},
        {"text": "Разом 7 шт", "photo": "IMG_0001.jpg", "photo_line": 3, "note": "підсумок сторінки"},
    ],
}


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
    def __init__(self, log: Log, env_file: Path, override: Path) -> None:
        self.log = log
        self.env_file = env_file
        self.override = override
        self.values = dict(l.split("=", 1) for l in env_file.read_text().splitlines() if "=" in l)
        self.shell = {
            "PATH": f"{DOCKER_BIN}:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(Path.home()),
            "COMPOSE_PROJECT_NAME": PROJECT,
            "COMPOSE_FILE": f"{INFRA / 'docker-compose.yml'}:{override}",
            "COMPOSE_ENV_FILES": str(env_file),
            "DOCKER_CONFIG": str(Path.home() / ".docker"),
            "BIRKA_RELEASE": RELEASE,
        }

    def redact(self, text: str) -> str:
        for key in ("POSTGRES_PASSWORD", "BIRKA_APP_DB_PASSWORD", "BIRKA_SESSION_SECRET"):
            if self.values.get(key):
                text = text.replace(self.values[key], f"<{key}>")
        return text

    def sh(self, command: str, *, title: str, expect: int | None = 0, timeout: int = 900, tail: int = 30) -> subprocess.CompletedProcess[str]:
        started = time.monotonic()
        try:
            done = subprocess.run(["/bin/sh", "-c", command], cwd=INFRA, env=self.shell, stdin=subprocess.DEVNULL,
                                  capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            done = subprocess.CompletedProcess(command, 124, "", f"(still running after {timeout} s: stopped)")
        took = time.monotonic() - started
        held = expect is None or done.returncode == expect
        output = "\n".join(self.redact((done.stdout + done.stderr).strip()).splitlines()[-tail:])
        verdict = "ran" if expect is None else "held" if held else "DID NOT HOLD"
        self.log.write(f"\n**{title}** — {verdict} (exit {done.returncode}, {took:.1f} s)\n\n"
                       f"```sh\n{self.redact(command)}\n```\n\n```\n{output}\n```")
        if not held:
            raise RuntimeError(f"{title} exited {done.returncode}")
        return done

    def psql(self, sql: str, *, title: str) -> str:
        return self.sh("docker compose exec -T db sh -c 'psql -U \"$POSTGRES_USER\" \"$POSTGRES_DB\" -At' <<'SQL'\n"
                       f"{sql}\nSQL", title=title).stdout.strip()

    def set_env(self, key: str, value: str) -> None:
        lines = [l for l in self.env_file.read_text().splitlines() if not l.startswith(f"{key}=")]
        self.env_file.write_text("\n".join(lines + [f"{key}={value}", ""]))


def init_data(telegram_id: int, name: str) -> str:
    fields = {"auth_date": str(int(time.time())),
              "user": json.dumps({"id": telegram_id, "first_name": name}, ensure_ascii=False, separators=(",", ":"))}
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


class Phone:
    """Someone's app, through Caddy."""

    def __init__(self, telegram_id: int, name: str) -> None:
        self.client = httpx.Client(base_url=f"https://localhost:{HTTPS}", verify=False, timeout=60)
        signed = self.client.post("/api/v1/auth/telegram", json={"init_data": init_data(telegram_id, name)})
        self.signed_in = signed.status_code
        if signed.status_code == 200:
            self.client.headers["Authorization"] = f"Bearer {signed.json()['access_token']}"

    def get(self, path: str):
        response = self.client.get(path)
        if response.status_code != 200:
            raise RuntimeError(f"GET {path}: {response.status_code} {response.text[:300]}")
        return response.json()

    def call(self, method: str, path: str, body: dict | None = None, *, key: bool = False) -> httpx.Response:
        headers = {"Idempotency-Key": str(uuid.uuid4())} if key else {}
        return self.client.request(method, path, json=body, headers=headers)


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


def wait_ready() -> None:
    for _ in range(90):
        try:
            if httpx.get(f"https://localhost:{HTTPS}/api/v1/ready", verify=False, timeout=5).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise RuntimeError("never ready")


def main() -> int:
    out = Path(sys.argv[1])
    log = Log(out)
    work = HOME / "work-install"
    shutil.rmtree(work, ignore_errors=True)
    backups = work / "backups"
    backups.mkdir(parents=True)
    override = work / "override.yml"
    override.write_text(OVERRIDE)
    keygen = subprocess.run([str(DOCKER_BIN / "docker"), "run", "--rm", "--network", "none", "--entrypoint", "age-keygen",
                             "birka-ci-local-ops"], capture_output=True, text=True, check=True)
    recipient = next(l.split(": ", 1)[1] for l in (keygen.stderr + keygen.stdout).splitlines() if "public key:" in l.lower())
    env_file = work / ".env"
    env_file.write_text("\n".join([
        f"POSTGRES_PASSWORD={base64.b64encode(secrets.token_bytes(32)).decode()}",
        f"BIRKA_APP_DB_PASSWORD={base64.b64encode(secrets.token_bytes(32)).decode()}",
        f"BIRKA_TELEGRAM_BOT_TOKEN={BOT_TOKEN}",
        f"BIRKA_SESSION_SECRET={base64.b64encode(secrets.token_bytes(48)).decode()}",
        f"BIRKA_BACKUP_AGE_RECIPIENTS={recipient}", f"BIRKA_BACKUP_DIR={backups}", "BIRKA_DOMAIN=localhost",
        f"REHEARSAL_HTTP={HTTP}", f"REHEARSAL_HTTPS={HTTPS}", "",
    ]))
    server = Server(log, env_file, override)
    commit = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    log.write(f"# Rehearsal: the first install, every container held\n\nCommit {commit}, images of `{RELEASE}`; started {time.strftime('%Y-%m-%d %H:%M:%S %Z')}. "
              "Test secrets, the tests' fake bot token; the containers have no way out of their network.")
    try:
        # --- steps 3, 4 and 6 ------------------------------------------------
        log.write("\n## Steps 3, 4 and 6: the database, the start, the owner and the shop's places")
        server.sh("docker compose up -d --wait db\n"
                  "docker compose --profile ops run --rm --no-deps ops alembic upgrade head\n"
                  "docker compose --profile ops run --rm --no-deps ops alembic check\n"
                  "docker compose --profile ops run --rm --no-deps ops python -m scripts.app_role",
                  title="3. Database, migration, check, the app's role")
        server.sh("docker compose up -d", title="4. Start")
        server.sh(f"curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:{HTTPS}/api/v1/health\n"
                  f"curl -kfsS https://localhost:{HTTPS}/api/v1/ready", title="4. Health and readiness (-k: the local certificate)")
        for service in ("api", "backup-watch"):
            who = server.sh(f"docker compose exec -T {service} python -c {WHO}", title=f"Who {service} is to the database").stdout.strip()
            log.check(who == "birka_app False", f"{service} connects as birka_app, no superuser: `{who}`")
        shapes = server.sh(
            "for s in db api backup-watch caddy web; do for id in $(docker compose ps -a -q $s); do printf '%s ' $s; "
            "docker inspect -f '{{.HostConfig.Privileged}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} "
            "{{.HostConfig.CapAdd}} {{.HostConfig.Memory}} {{.HostConfig.MemorySwap}}' $id; done; done",
            title="Each container as Docker runs it").stdout.strip().splitlines()
        held = all(" false true [ALL] " in f" {line} " and line.split()[-1] == line.split()[-2] != "0"
                   for line in shapes)
        log.check(held and len(shapes) >= 5, "every container: not privileged, read-only, every privilege dropped "
                  "but its own, a memory limit and no swap beyond it")
        wrote = server.sh("docker compose exec -T api sh -c 'touch /app/probe'", title="A write into the API's image",
                          expect=None)
        log.check(wrote.returncode != 0 and "Read-only file system" in wrote.stdout + wrote.stderr,
                  "refused: Read-only file system")
        tried = server.sh("docker compose run --rm --no-deps api alembic downgrade -1",
                          title="The old command, from api: a migration's downgrade", expect=None)
        rev = server.sh("docker compose exec -T db sh -c 'psql -U \"$POSTGRES_USER\" \"$POSTGRES_DB\" -Atc \"SELECT version_num FROM alembic_version\"'",
                        title="The schema after it").stdout.strip()
        log.check(tried.returncode != 0 and ("must be owner" in tried.stdout + tried.stderr or "permission denied" in tried.stdout + tried.stderr)
                  and rev == "0038_customer_erasure",
                  f"from api, as birka_app, the schema cannot be changed: refused, and it stays `{rev}`")
        server.sh(f"docker compose run --rm --no-deps api python -m scripts.seed_organization \\\n"
                  f"  --telegram-user-id {OWNER_TG} --owner-name \"Власниця\" --org-name \"Перший день\" \\\n"
                  f"  --main-name \"Магазин на Ринку\" --second-name \"Магазин у ТЦ\"", title="6. The owner, and the shop's places")
        owner = Phone(OWNER_TG, "Власниця")
        stores = {s["code"]: s for s in owner.get("/api/v1/me")["stores"]}
        log.check(stores["MAIN"]["name"] == "Магазин на Ринку" and stores["SECOND"]["name"] == "Магазин у ТЦ",
                  f"the owner signs in and sees both stores by their names: {[s['name'] for s in stores.values()]}")
        server.sh(f"docker compose run --rm --no-deps api python -m scripts.stores rename \\\n"
                  f"  --approved-by {OWNER_TG} --store MAIN --name \"Магазин на Ринку, ряд 5\"", title="6. A name changed on the owner's word")
        renamed = next(s for s in owner.get("/api/v1/me")["stores"] if s["code"] == "MAIN")["name"]
        log.check(renamed == "Магазин на Ринку, ряд 5", f"the owner's app shows the new name: «{renamed}»")
        main = stores["MAIN"]["id"]
        locations = owner.get(f"/api/v1/stock-locations?store_id={main}")
        shared = next(l for l in locations if l["can_sell"] and not l["damaged_returns"])["id"]

        # --- step 7, the people ----------------------------------------------
        log.write("\n## Step 7: the people")
        before = Phone(SELLER_TG, "Оксана")
        no_access = before.get("/api/v1/me") if before.signed_in == 200 else None
        log.write(f"\nThe seller opens the app before being added: sign-in {before.signed_in}, stores "
                  f"{[s['code'] for s in (no_access or {}).get('stores', [])]} («Доступу ще немає»).")
        server.sh(f"docker compose run --rm --no-deps api python -m scripts.people grant \\\n"
                  f"  --approved-by {OWNER_TG} --telegram-user-id {SELLER_TG} \\\n"
                  f"  --store MAIN --role SELLER\n"
                  "docker compose run --rm --no-deps api python -m scripts.people list", title="7. A seller added on the owner's word")
        seller = Phone(SELLER_TG, "Оксана")
        seller_stores = [s["code"] for s in seller.get("/api/v1/me")["stores"]]
        log.check(seller_stores == ["MAIN"], f"the seller signs in and works in MAIN alone: {seller_stores}")
        server.sh(f"docker compose run --rm --no-deps api python -m scripts.people sign-out \\\n"
                  f"  --approved-by {OWNER_TG} --telegram-user-id {SELLER_TG}", title="7. A lost phone: every sign-in ended")
        lost = seller.client.get("/api/v1/me").status_code
        again = Phone(SELLER_TG, "Оксана")
        log.check(lost == 401 and again.signed_in == 200,
                  f"the lost phone's sign-in is refused ({lost}); the seller opens the app again ({again.signed_in})")
        seller = again

        # --- step 8 and 8a ---------------------------------------------------
        log.write("\n## Step 8: backups; 8a: being told")
        server.sh("docker compose --profile ops run --rm ops\n"
                  "docker compose run --rm backup-watch python -m scripts.backup_watch --status",
                  title="8. The first night by hand, and its state")
        server.set_env("BIRKA_ADMIN_TELEGRAM_IDS", f"{ADMIN_TG}, not-a-number")
        server.sh("docker compose up -d backup-watch\nsleep 5\n"
                  "docker compose logs backup-watch | grep backup_watch.started | tail -1",
                  title="8a.1. An administrator in .env, a part of it not a number")
        started = server.sh("docker compose logs backup-watch | grep backup_watch.started | tail -1",
                            title="The watcher's start", expect=None).stdout
        log.check('"administrators": 1' in started, "the watcher has one administrator; the part not a number is dropped")
        log.write("\n8a.3. Try it: the app stopped for 6 minutes, then started again.")
        server.sh("docker compose stop api", title="8a.3. docker compose stop api")
        time.sleep(400)
        opened = server.psql("SELECT kind, reason FROM server_incident WHERE ended_at IS NULL;",
                             title="What the watcher recorded while the app did not answer")
        log.check(opened == "NOT_ANSWERING|Сервер застосунку не відповідає.",
                  f"an incident is open while the app does not answer: `{opened}`")
        server.sh("docker compose start api", title="8a.3. docker compose start api")
        wait_ready()
        time.sleep(90)
        section = owner.get("/api/v1/backups")
        server_part = section.get("server", {})
        recent = [(r["kind"], r["reason"]) for r in server_part.get("recent", [])]
        log.write(f"\nThe owner's «Резервні копії», the server: open {server_part.get('open')}, recent {recent}.")
        log.check(not server_part.get("open") and ("NOT_ANSWERING", "Сервер застосунку не відповідає.") in recent,
                  "within a minute or two of the start the incident is closed, and the owner's section shows it")
        sends = server.sh("docker compose logs backup-watch | grep -c -i 'send\\|deliver\\|telegram' || true",
                          title="The watcher's attempts to tell (none can leave)", expect=None).stdout.strip()
        log.write(f"\nLines about telling in the watcher's log: {sends}. Nothing left the network.")

        # --- step 9, the shops' existing stock -------------------------------
        log.write("\n## Step 9: the shops' existing stock, before anything moves")
        stock_file = work / "zoshyt-1.json"
        stock_file.write_text(json.dumps(STOCK_FILE, ensure_ascii=False, indent=1))
        checked = subprocess.run([str(PY), "-m", "scripts.check_stock_file", str(stock_file)], cwd=REPO / "backend",
                                 capture_output=True, text=True)
        log.write(f"\n**9.2. The validator** — exit {checked.returncode}\n\n```sh\npython -m scripts.check_stock_file zoshyt-1.json\n```\n\n"
                  f"```\n{(checked.stdout + checked.stderr).strip()}\n```")
        log.check(checked.returncode == 0, "the reference validator passes the parser's file")
        models = {}
        for colour, sizes in (("шоколад", ["M"]), ("бежевий", ["S", "M", "L"])):
            made = owner.call("POST", "/api/v1/catalog/products", {
                "store_id": main, "concept": f"Лоран {colour}", "variant": {"color": colour},
                "sizes": [{"system": "ALPHA", "code": c} for c in sizes]}, key=True)
            if made.status_code != 201:
                raise RuntimeError(f"catalogue: {made.status_code} {made.text[:300]}")
            body = made.json()
            models[colour] = (body["product_variant_id"], {s["code"]: s["size_id"] for s in body["sizes"]})
        log.write("\n9.3. The catalogue: «Лоран шоколад» (M) and «Лоран бежевий» (S, M, L), created by the owner.")
        listed = owner.call("POST", "/api/v1/snapshots", {
            "command_id": str(uuid.uuid4()), "store_id": main, "location_id": shared,
            "file": STOCK_FILE, "file_name": "zoshyt-1.json"})
        if listed.status_code != 201:
            raise RuntimeError(f"list: {listed.status_code} {listed.text[:400]}")
        snapshot = listed.json()
        snapshot_id = snapshot.get("snapshot_id") or snapshot.get("id")
        log.write(f"\n9.4. «Новий список» for the shared warehouse with the file: {snapshot.get('status')}, "
                  f"{snapshot.get('row_count') or snapshot.get('lines') or ''}.")
        choc_variant, choc_sizes = models["шоколад"]
        held_receipt = owner.call("POST", "/api/v1/inventory/receipts", {
            "store_id": main, "location_id": shared, "command_id": str(uuid.uuid4()),
            "lines": [{"product_variant_id": choc_variant, "size_id": choc_sizes["M"], "quantity": 1,
                       "acquisition_type": "PURCHASE", "unit_cost": None}], "notes": None}, key=True)
        log.check(held_receipt.status_code >= 400,
                  f"while the list waits, a delivery into its warehouse is refused ({held_receipt.status_code}: "
                  f"{held_receipt.text[:200]})")
        beige_variant, beige_sizes = models["бежевий"]
        answers = {
            1: {"allocations": [{"product_variant_id": choc_variant, "size_id": choc_sizes["M"], "quantity": 3}],
                "quantity_basis": "STATED"},
            2: {"allocations": [{"product_variant_id": beige_variant, "size_id": beige_sizes[c], "quantity": n}
                                for c, n in (("S", 1), ("M", 2), ("L", 1))],
                "quantity_basis": "STATED_BY_SIZE"},
            3: {"skip_reason": "Підсумок сторінки, не товар"},
        }
        for line_no, answer in answers.items():
            done = owner.call("PUT", f"/api/v1/snapshots/{snapshot_id}/lines/{line_no}", answer)
            log.write(f"\n9.5. Line {line_no} answered: {done.status_code}.")
            if done.status_code != 200:
                log.finding(f"line {line_no} not taken: {done.text[:300]}")
        revision = owner.get(f"/api/v1/snapshots/{snapshot_id}")["review_revision"]
        approved = owner.call("POST", f"/api/v1/snapshots/{snapshot_id}/approve", {"expected_review_revision": revision})
        log.check(approved.status_code == 200, f"9.6. the owner approves the list ({approved.status_code})")
        def on_hand() -> dict[str, int]:
            items = owner.get(f"/api/v1/catalog/stock-options?store_id={main}&location_id={shared}")["items"]
            return {f"{i['display_name']} {i['size_label']}": i["quantity"] for i in items}
        opening = on_hand()
        log.check(sum(opening.values()) == 7, f"«Залишки» hold what the list said, 7 coats: {opening}")
        paper = seller.call("POST", "/api/v1/sales", {
            "store_id": main, "command_id": str(uuid.uuid4()),
            "lines": [{"product_variant_id": beige_variant, "size_id": beige_sizes["M"], "source_location_id": shared,
                       "quantity": 1, "unit_price": "2400.00"}], "payment_method": "CASH"}, key=True)
        log.check(paper.status_code == 201, f"9.7. a paper sale typed at the till by the seller after the approval ({paper.status_code})")
        delivery = owner.call("POST", "/api/v1/inventory/receipts", {
            "store_id": main, "location_id": shared, "command_id": str(uuid.uuid4()),
            "lines": [{"product_variant_id": choc_variant, "size_id": choc_sizes["M"], "quantity": 2,
                       "acquisition_type": "PURCHASE", "unit_cost": None}], "notes": None}, key=True)
        log.check(delivery.status_code == 201, f"9.8. then a delivery is received ({delivery.status_code})")
        second = owner.call("POST", "/api/v1/snapshots", {
            "command_id": str(uuid.uuid4()), "store_id": main, "location_id": shared,
            "file": STOCK_FILE, "file_name": "zoshyt-1-again.json"})
        second_id = second.json().get("snapshot_id") or second.json().get("id")
        log.write(f"\nA second list started for the same warehouse, now with history: {second.status_code}, "
                  f"{second.json().get('status')}.")
        not_held = owner.call("POST", "/api/v1/inventory/receipts", {
            "store_id": main, "location_id": shared, "command_id": str(uuid.uuid4()),
            "lines": [{"product_variant_id": choc_variant, "size_id": choc_sizes["M"], "quantity": 1,
                       "acquisition_type": "PURCHASE", "unit_cost": None}], "notes": None}, key=True)
        log.check(not_held.status_code == 201, f"it holds nothing back: a delivery is still received ({not_held.status_code})")
        for line_no, answer in answers.items():
            owner.call("PUT", f"/api/v1/snapshots/{second_id}/lines/{line_no}", answer)
        revision = owner.get(f"/api/v1/snapshots/{second_id}")["review_revision"]
        refused = owner.call("POST", f"/api/v1/snapshots/{second_id}/approve", {"expected_review_revision": revision})
        log.check(refused.status_code >= 400,
                  f"its approval is refused: the warehouse takes one opening list ({refused.status_code}: {refused.text[:220]})")
        rejected = owner.call("POST", f"/api/v1/snapshots/{second_id}/reject", {"reason": "Склад уже відкрито"})
        log.write(f"\nThe second list rejected: {rejected.status_code}.")

        # --- step 10 ---------------------------------------------------------
        log.write("\n## Step 10: check it")
        final = on_hand()
        log.check(sum(final.values()) == 9, f"«Залишки»: the list's 7, less the paper sale, plus deliveries of 2 and 1: {final}")
        signed = server.sh("docker compose logs api | grep -i 'auth/telegram' | tail -2", title="10. The sign-in's address in the API's log", expect=None).stdout
        caddy_ip = server.sh("docker compose exec -T caddy hostname -i", title="Caddy's own address", expect=None).stdout.strip()
        log.check(bool(signed) and caddy_ip.split()[0] not in signed if caddy_ip else bool(signed),
                  f"the API logs the client's address, not Caddy's ({caddy_ip}); on Docker Desktop the client is the VM's gateway")
    finally:
        try:
            server.sh("docker compose down -v", title="Removed", expect=None)
        except Exception as error:  # noqa: BLE001
            log.write(f"\nCould not remove: {error!r}")
        log.write("\n## Findings\n")
        log.write("\n".join(f"- {f}" for f in log.findings) or "None.")
    return 1 if log.findings else 0


if __name__ == "__main__":
    sys.exit(main())
