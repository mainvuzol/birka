"""A rehearsal of the server runbook's "a new version" and "going back", on this Mac.

One server (Compose project birka-rehearsal-update) runs from its own git
checkout, a local clone standing for /srv/birka. It is installed at an old
release (#74, schema 0037), used through the real API, then:

1. updated to the new release (main, schema 0038) with "a new version";
2. taken back by a migration's downgrade while it is lossless, and updated
   again;
3. taken back by the code alone once a customer is erased;
4. its downgrade asked again, once it is not lossless;
5. taken back whole, from the backup taken before the update, on the same
   server.

The runbook's commands run as written, in /bin/sh from the checkout's
infra/, in a shell that has not read `.env`. Two stand-ins, both named in
the log: the checkout is ~/.cache/birka-runtime/update-rehearsal/srv-birka,
not /srv/birka; and `docker compose build` is replaced by make-images.sh,
which puts the release's backend code over the images built here (a build
would fetch base images from Docker Hub). The web bundle stays the newest
release's throughout. The image prune is not run: on this Mac it would
reach other projects' images.
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
HOME = Path.home() / ".cache/birka-runtime/update-rehearsal"
SRV = HOME / "srv-birka"
INFRA = SRV / "infra"
DOCKER_BIN = Path.home() / ".docker/bin"
BOT_TOKEN = "123456:TEST-TOKEN-not-a-real-secret"
OWNER_TG = 700_000_101
PROJECT = "birka-rehearsal-update"
OLD = "6867576"
HTTP, HTTPS = 58380, 58743

OVERRIDE = """\
# The rehearsal's own: each release's images made here (make-images.sh),
# named by BIRKA_RELEASE as the runbook exports it; nothing pulled or built;
# Caddy on this Mac's loopback only.
services:
  api:
    image: birka-rehearsal-update-api:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
    build: !reset null
    pull_policy: never
  backup-watch:
    image: birka-rehearsal-update-api:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
    build: !reset null
    pull_policy: never
  ops:
    image: birka-rehearsal-update-ops:${BIRKA_RELEASE:?export BIRKA_RELEASE first}
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

BUILD = f"sh {HOME / 'make-images.sh'} \"$BIRKA_RELEASE\" {SRV / 'backend'}"


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


class Server:
    def __init__(self, log: Log, env_file: Path, override: Path) -> None:
        self.log = log
        self.values = dict(l.split("=", 1) for l in env_file.read_text().splitlines() if "=" in l)
        self.shell = {
            "PATH": f"{DOCKER_BIN}:/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": str(Path.home()),
            "COMPOSE_PROJECT_NAME": PROJECT,
            "COMPOSE_FILE": f"{INFRA / 'docker-compose.yml'}:{override}",
            "COMPOSE_ENV_FILES": str(env_file),
            "DOCKER_CONFIG": str(Path.home() / ".docker"),
        }

    def redact(self, text: str) -> str:
        for key in ("POSTGRES_PASSWORD", "BIRKA_SESSION_SECRET"):
            if self.values.get(key):
                text = text.replace(self.values[key], f"<{key}>")
        return text

    def sh(self, command: str, *, title: str, expect: int | None = 0, timeout: int = 900) -> subprocess.CompletedProcess[str]:
        started = time.monotonic()
        try:
            done = subprocess.run(
                ["/bin/sh", "-c", command], cwd=INFRA, env=self.shell, stdin=subprocess.DEVNULL,
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

    def revision(self) -> str:
        return self.psql("SELECT version_num FROM alembic_version;", title="The schema's revision")


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
    def __init__(self) -> None:
        self.client = httpx.Client(base_url=f"https://localhost:{HTTPS}", verify=False, timeout=30)
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

    def status(self, path: str) -> int:
        return self.client.get(path).status_code

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

    def pay_off(self, credit_id: str) -> None:
        owed = self.get(f"/api/v1/credits/{credit_id}")["owed"]
        self.post(f"/api/v1/credits/{credit_id}/payments",
                  {"command_id": str(uuid.uuid4()), "amount": owed, "payment_method": "CASH"}, expect=201)

    def on_hand(self, variant: str) -> int:
        options = self.get(f"/api/v1/catalog/stock-options?store_id={self.store}&location_id={self.warehouse}")
        return sum(o["quantity"] for o in options["items"] if o["product_variant_id"] == variant)

    def sales(self) -> int:
        return len(self.get(f"/api/v1/sales?store_id={self.store}&limit=50")["sales"])


def wait_ready(log: Log) -> None:
    for _ in range(90):
        try:
            if httpx.get(f"https://localhost:{HTTPS}/api/v1/ready", verify=False, timeout=5).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise RuntimeError("never ready")


def update_block(target: str) -> str:
    """The runbook's "a new version", as written but for the two stand-ins."""
    return "\n".join(
        [
            "docker compose --profile ops run --rm ops                 # a backup now, before anything changes",
            f"git -C {SRV} fetch && git -C {SRV} checkout {target}",
            f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)",
            f"{BUILD}   # stands in for: docker compose build && docker compose --profile ops build ops",
            "docker compose run --rm --no-deps api alembic upgrade head   # if this fails, stop here: see below",
            "docker compose up -d",
        ]
    )


def check_ready(server: Server, log: Log, *, first: bool = False) -> None:
    """The runbook's readiness check after `up -d`: as it was, once, then as
    it now says (`-k`: the rehearsal's local certificate)."""
    if first:
        was = server.sh(f"curl -kfsS https://localhost:{HTTPS}/api/v1/ready",
                        title="The readiness check, as the runbook had it", expect=None)
        if was.returncode != 0:
            log.finding(
                "the readiness check straight after `up -d` gets 502 from Caddy while the API starts (also in "
                "the first run, kept as first-run.md): an administrator reads a failed update. Fixed: curl "
                "retries until the API answers"
            )
    server.sh(f"curl -kfsS --retry 30 --retry-delay 2 --retry-all-errors https://localhost:{HTTPS}/api/v1/ready",
              title="The readiness check, as the runbook now says")


def code_alone(target: str) -> str:
    """Going back, 1: the code alone."""
    return "\n".join(
        [
            f"git -C {SRV} checkout {target}",
            f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)",
            f"{BUILD}   # stands in for the build",
            "docker compose up -d",
        ]
    )


def main() -> int:
    out = Path(sys.argv[1])
    new = sys.argv[2]
    log = Log(out)
    work = HOME / "work"
    shutil.rmtree(work, ignore_errors=True)
    backups, owner = work / "backups", work / "owner"
    backups.mkdir(parents=True)
    owner.mkdir()
    override = work / "override.yml"
    override.write_text(OVERRIDE)
    keygen = subprocess.run(
        [str(DOCKER_BIN / "docker"), "run", "--rm", "--entrypoint", "age-keygen", "birka-ci-local-ops"],
        capture_output=True, text=True, check=True,
    )
    (owner / "birka-backup-key.txt").write_text(keygen.stdout)
    recipient = next(l.split(": ", 1)[1] for l in (keygen.stderr + keygen.stdout).splitlines() if "public key:" in l.lower())
    password = base64.b64encode(secrets.token_bytes(24)).decode()
    env_file = work / ".env"
    env_file.write_text(
        "\n".join([
            f"POSTGRES_PASSWORD={password}", f"BIRKA_TELEGRAM_BOT_TOKEN={BOT_TOKEN}",
            f"BIRKA_SESSION_SECRET={base64.b64encode(secrets.token_bytes(48)).decode()}",
            f"BIRKA_BACKUP_AGE_RECIPIENTS={recipient}", f"BIRKA_BACKUP_DIR={backups}", "BIRKA_DOMAIN=localhost",
            f"REHEARSAL_HTTP={HTTP}", f"REHEARSAL_HTTPS={HTTPS}", "",
        ])
    )
    server = Server(log, env_file, override)
    log.write(
        f"# Rehearsal: a new version, and going back\n\nFrom `{OLD}` (#74, schema 0037) to `{new}` (main, 0038), on one "
        f"server whose checkout is a local clone; started {time.strftime('%Y-%m-%d %H:%M:%S %Z')}. The password is "
        "base64 as the runbook makes it; test secrets, the tests' fake bot token."
    )
    try:
        # --- installed at the old release ------------------------------------
        log.write(f"\n## Installed at {OLD} (server runbook, steps 3, 4 and 6)")
        subprocess.run(["git", "-C", str(SRV), "checkout", "-q", "--detach", OLD], check=True)
        server.sh(f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)\n{BUILD}\n"
                  "docker compose up -d --wait db\n"
                  "docker compose run --rm --no-deps api alembic upgrade head\n"
                  "docker compose up -d", title="Build, database, migration, start")
        wait_ready(log)
        server.sh(f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)\n"
                  f"docker compose run --rm --no-deps api python -m scripts.seed_organization "
                  f"--telegram-user-id {OWNER_TG} --owner-name \"Власниця\" --org-name \"Оновлення\"",
                  title="The owner and the shop's places")
        shop = Shop()
        variant, size = shop.coat("Лоран оновлення", 10)
        shop.sell(variant, size)
        paid = shop.sell(variant, size, {"customer_name": "Марія Сплатила", "customer_phone": "0672220001", "paid_now": "500.00"})
        shop.pay_off(paid["credit"]["credit_id"])
        owing = shop.sell(variant, size, {"customer_name": "Ірина Винна", "customer_phone": "0672220002", "paid_now": "500.00"})
        paid_id, owing_id = paid["credit"]["credit_id"], owing["credit"]["credit_id"]
        log.write("\nUsed through the app: a model received 10, three sales, two in parts (Марія paid off, Ірина owes 1000).")
        before = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}

        # --- 1. a new version ------------------------------------------------
        log.write(f"\n## 1. A new version: {OLD} → {new}")
        server.sh("export BIRKA_RELEASE=$(git -C {0} rev-parse --short HEAD)\n".format(SRV) + update_block(new),
                  title="The runbook's block")
        check_ready(server, log, first=True)
        wait_ready(log)
        night = sorted(p.name for p in backups.glob("birka-*Z.json"))
        pre_update = night[-1].removesuffix(".json")
        log.write(f"\nThe backup before the update: `{pre_update}`.")
        rev = server.revision()
        release = server.sh("docker compose exec -T api printenv BIRKA_RELEASE", title="The running version").stdout.strip()
        shop = Shop()
        after = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}
        log.write(f"\nSchema `{rev}`, the API runs `{release}`; stock and sales {after} (before: {before}).")
        if rev != "0038_customer_erasure" or release != new or after != before:
            log.finding("the update did not leave the new version on the same data")

        # --- 2. going back by a downgrade, while lossless --------------------
        log.write("\n## 2. Going back, 2: code and schema, by a migration's downgrade (nobody erased yet)")
        server.sh(f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)\n"
                  "docker compose run --rm --no-deps api alembic downgrade 0037_stock_list_parts",
                  title="The downgrade, with the new code that knows it")
        server.sh(code_alone(OLD), title="Then the old code")
        wait_ready(log)
        shop = Shop()
        back = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}
        names = shop.get(f"/api/v1/credits/{paid_id}")["customer_name"]
        log.write(f"\nSchema `{server.revision()}`; stock and sales {back}; Марія reads `{names}`.")
        if back != before:
            log.finding("the downgrade lost or changed data")
        server.sh("export BIRKA_RELEASE=$(git -C {0} rev-parse --short HEAD)\n".format(SRV) + update_block(new),
                  title="Updated again: the runbook's block")
        check_ready(server, log)
        wait_ready(log)

        # --- 3. going back by the code alone, once a customer is erased -----
        log.write("\n## 3. Going back, 1: the code alone, once a customer is erased")
        shop = Shop()
        erased = shop.post(f"/api/v1/credits/{paid_id}/erase-customer", {})
        log.write(f"\nOn {new}, the owner erases Марія on request: erased {erased['erased']}.")
        server.sh(code_alone(OLD), title="The old code")
        wait_ready(log)
        shop = Shop()
        checks = {
            "«Борги», who owes (status=OPEN)": shop.status(f"/api/v1/credits/customers?store_id={shop.store}&status=OPEN"),
            "«Борги», everyone": shop.status(f"/api/v1/credits/customers?store_id={shop.store}"),
            "the debts' list": shop.status(f"/api/v1/credits?store_id={shop.store}"),
            "Марія's debt": shop.status(f"/api/v1/credits/{paid_id}"),
            "Ірина's debt": shop.status(f"/api/v1/credits/{owing_id}"),
            "a sale": shop.post("/api/v1/sales", {
                "store_id": shop.store, "command_id": str(uuid.uuid4()),
                "lines": [{"product_variant_id": variant, "size_id": size, "source_location_id": shop.warehouse,
                           "quantity": 1, "unit_price": "1500.00"}], "payment_method": "CASH"},
                key=True, expect=201) and 201,
        }
        log.write("\nWith the old code on the new schema:\n\n" + "\n".join(f"- {k}: {v}" for k, v in checks.items()))
        broken = [k for k, v in checks.items() if v >= 500]
        if broken:
            log.finding(
                "going back by the code alone across `0038` breaks «Борги» once a customer is erased: the old "
                f"code cannot read a debt with no name ({', '.join(broken)} answer 500); the runbook did not say so"
            )
        server.sh("export BIRKA_RELEASE=$(git -C {0} rev-parse --short HEAD)\n".format(SRV) + update_block(new),
                  title="Fixed forward: the runbook's block")
        check_ready(server, log)
        wait_ready(log)
        shop = Shop()
        log.write(f"\nForward again, «Борги», everyone: {shop.status(f'/api/v1/credits/customers?store_id={shop.store}')}.")

        # --- 4. the downgrade, once not lossless -----------------------------
        log.write("\n## 4. Going back, 2, once a customer is erased")
        refused = server.sh(f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)\n"
                            "docker compose run --rm --no-deps api alembic downgrade 0037_stock_list_parts",
                            title="The downgrade", expect=None)
        rev = server.revision()
        log.write(f"\nRefused: {'yes' if refused.returncode != 0 else 'NO'}; the schema stays `{rev}`.")
        if refused.returncode == 0 or rev != "0038_customer_erasure":
            log.finding("the downgrade did not refuse, or changed the schema, once a customer was erased")

        # --- 5. everything, from the backup before the update ---------------
        log.write(f"\n## 5. Going back, 3: everything, from `{pre_update}`, on the same server")
        collected = subprocess.run(
            ["/bin/sh", str(SRV / "infra/pull-backups.sh")],
            env={"PATH": "/usr/bin:/bin", "HOME": str(Path.home()), "BIRKA_BACKUP_SOURCE": f"{backups}/", "BIRKA_BACKUP_DEST": str(owner)},
            capture_output=True, text=True,
        )
        log.write(f"\nThe owner's computer collected (exit {collected.returncode}).")
        subprocess.run(
            [str(DOCKER_BIN / "docker"), "run", "--rm", "-v", f"{owner}:/owner", "--entrypoint", "age",
             "birka-ci-local-ops", "--decrypt", "-i", "/owner/birka-backup-key.txt", "-o", "/owner/birka.dump",
             f"/owner/{pre_update}.dump.age"], check=True, capture_output=True,
        )
        manifest = json.loads((owner / f"{pre_update}.json").read_text())
        same = hashlib.sha256((owner / "birka.dump").read_bytes()).hexdigest() == manifest["archive_sha256"]
        log.write(f"\nDecrypted with the owner's key; SHA-256 {'equals' if same else 'DIFFERS FROM'} the drilled archive's.")
        shutil.copy(owner / "birka.dump", backups / "birka.dump")
        volume = f"{PROJECT}_db_data"
        server.sh(
            "\n".join([
                f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)",
                "docker compose --profile ops run --rm ops       # the state being left, kept too",
                f"git -C {SRV} checkout {OLD}                 # the code the backup was taken with",
                f"export BIRKA_RELEASE=$(git -C {SRV} rev-parse --short HEAD)",
                f"{BUILD}   # stands in for the build",
                "docker compose stop api backup-watch           # nothing writes while the database goes back",
                f"docker compose rm -sf db && docker volume rm {volume}   # on the server: birka_db_data",
                "docker compose up -d --wait db",
                "docker compose exec -T db sh -c 'pg_restore --username=\"$POSTGRES_USER\" --dbname=\"$POSTGRES_DB\" "
                "--exit-on-error --single-transaction --no-owner --no-privileges' "
                f"< {backups}/birka.dump   # on the server: backups/birka.dump",
                "docker compose up -d",
            ]),
            title="The proposed sequence",
        )
        wait_ready(log)
        shop = Shop()
        whole = {"on_hand": shop.on_hand(variant), "sales": shop.sales()}
        name = shop.get(f"/api/v1/credits/{paid_id}")["customer_name"]
        rev = server.revision()
        log.write(f"\nSchema `{rev}`; stock and sales {whole} (the state before the update: {before}); Марія reads `{name}`.")
        if whole != before or rev != "0037_stock_list_parts":
            log.finding("the whole going back did not return the state before the update")
        (owner / "birka.dump").unlink()
        (backups / "birka.dump").unlink()
    finally:
        try:
            server.sh("export BIRKA_RELEASE=x\ndocker compose down -v", title="Removed", expect=None)
        except Exception as error:  # noqa: BLE001
            log.write(f"\nCould not remove: {error!r}")
        for service in ("api", "ops"):
            for release in (OLD, new):
                subprocess.run([str(DOCKER_BIN / "docker"), "image", "rm", "-f", f"birka-rehearsal-update-{service}:{release}"],
                               capture_output=True)
        log.write("\n## Findings\n")
        log.write("\n".join(f"- {f}" for f in log.findings) or "None.")
    return 1 if log.findings else 0


if __name__ == "__main__":
    sys.exit(main())
