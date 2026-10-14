import { test, expect, openStore } from "./fixtures";
import { execFileSync } from "node:child_process";
import { createHmac, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * People (owner decisions, 2026-10-01): a person is added on the server, by
 * the number of their Telegram account, on an owner's word. Someone the shop
 * has not added sees that number in the app, to pass on.
 *
 * The server command is the real one, run against the same database as the
 * API under test.
 */
interface Fixture {
  owner_telegram_user_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const backend = fileURLToPath(new URL("../../backend", import.meta.url));

function initData(telegramUserId: number): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${String(telegramUserId)},"first_name":"Ніна"}`,
  });
  const check = [...fields]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

/** What the technical administrator types on the server. */
function people(...args: string[]): string {
  return execFileSync(
    process.env.BIRKA_E2E_PYTHON ?? "python",
    ["-m", "scripts.people", ...args],
    { cwd: backend, encoding: "utf8" },
  );
}

test("someone the shop has not added sees their number, and is let in once added", async ({
  page,
}) => {
  const stranger = randomInt(2 ** 40, 2 ** 47);
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(stranger) }).toString()}`,
  );

  await expect(
    page.getByRole("heading", { name: "Доступу ще немає" }),
  ).toBeVisible();
  await expect(page.getByText(String(stranger))).toBeVisible();
  // Not "the session ended": nothing the person does here would help.
  await expect(page.getByText(/Сесія завершилась/)).toHaveCount(0);

  expect(
    people(
      "grant",
      "--approved-by",
      fixture.owner_telegram_user_id,
      "--telegram-user-id",
      String(stranger),
      "--store",
      "MAIN",
      "--role",
      "E2E",
    ),
  ).toBe(`granted: ${String(stranger)} is E2E in MAIN\n`);
  await page.getByRole("button", { name: "Спробувати ще раз" }).click();
  // One store: the app opens on it, at the till (redesign P0-1).
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();

  // Turned off, they are told so on their next request, and not let back in.
  people(
    "deactivate",
    "--approved-by",
    fixture.owner_telegram_user_id,
    "--telegram-user-id",
    String(stranger),
  );
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Залишки", exact: true }).click();
  await expect(
    page.getByText("Доступ до магазину закрито. Зверніться до власника."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Доступу ще немає" }),
  ).toBeVisible();
});
