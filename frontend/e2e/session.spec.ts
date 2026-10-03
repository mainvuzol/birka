import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Signing in (owner decision, 2026-10-03): a seller stays signed in for 12
 * hours after opening the app, then closes it and opens it again in Telegram.
 * The server takes Telegram's launch data for an hour only, so the app signs
 * in with it once, and reads everything after that — what each store lets the
 * person do, after a store's state changed, on «Оновити», on «Спробувати ще
 * раз» — with the token it was given.
 *
 * Launch data past its hour is played by answering every sign-in sent after
 * the app opened as the server answers it then.
 *
 * The network of stores.spec.ts: «Центр», and «Ринок» (Петро), which a
 * journey here blocks and opens again.
 */
interface Fixture {
  network_owner_telegram_user_id: string;
  network_centre_seller_telegram_user_id: string;
  network_market_seller_telegram_user_id: string;
  network_market_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const owner = fixture.network_owner_telegram_user_id;
const hanna = fixture.network_centre_seller_telegram_user_id;
const petro = fixture.network_market_seller_telegram_user_id;
const market = fixture.network_market_store_id;

function initData(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Тест"}`,
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

/** The app, opened from Telegram by this person. */
async function openAs(page: Page, telegramUserId: string): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId) }).toString()}`,
  );
}

/** Put a store in a state through the API, whatever state a journey left it in. */
async function settle(
  page: Page,
  store: string,
  state: "ACTIVE" | "BLOCKED",
): Promise<void> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(owner) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const stores = (await (
    await page.request.get("/api/v1/stores", { headers })
  ).json()) as { id: string; state: string }[];
  if (stores.find((s) => s.id === store)?.state === state) return;
  const changed = await page.request.post(`/api/v1/stores/${store}/state`, {
    headers,
    data: { command_id: randomUUID(), state, reason: "підготовка тесту" },
  });
  expect(changed.status()).toBe(200);
}

/**
 * From now on the launch data is past its hour: each sign-in the app sends is
 * refused as the server refuses it then, and counted.
 */
async function launchDataExpired(page: Page): Promise<{ sent: number }> {
  const signIns = { sent: 0 };
  await page.route("**/api/v1/auth/telegram", async (route) => {
    signIns.sent += 1;
    await route.fulfill({
      status: 401,
      json: { code: "INVALID_INIT_DATA", message: "init data has expired" },
    });
  });
  return signIns;
}

test("the owner changes a store's state over an hour after opening the app, and keeps working", async ({
  page,
}) => {
  await settle(page, market, "ACTIVE");
  try {
    await openAs(page, owner);
    await page.getByRole("button", { name: "Центр CENTRE" }).click();
    const signIns = await launchDataExpired(page);
    await page.getByRole("button", { name: "Магазини", exact: true }).click();
    const card = page.getByRole("article", { name: "Магазин Ринок" });
    await card.getByRole("button", { name: "Заблокувати" }).click();
    await card.getByLabel(/^Причина/).fill("Ревізія каси");
    await card
      .getByRole("button", { name: "Так, заблокувати «Ринок»" })
      .click();
    await expect(card.getByText("Заблоковано", { exact: true })).toBeVisible();

    // What the app knows of the stores is read again, with the token.
    await page.getByRole("button", { name: "Змінити магазин" }).click();
    await expect(
      page.getByRole("button", { name: /^Ринок MARKET/ }),
    ).toContainText("Заблоковано власником з");
    await expect(
      page.getByRole("heading", { name: "Вхід через Telegram" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Центр CENTRE" }).click();
    await expect(
      page.getByRole("button", { name: "Продаж", exact: true }),
    ).toBeVisible();
    expect(signIns.sent).toBe(0);
  } finally {
    await settle(page, market, "ACTIVE");
  }
});

test("a seller at a blocked store reads it again with the token, however the reading goes", async ({
  page,
}) => {
  await settle(page, market, "BLOCKED");
  try {
    await openAs(page, petro);
    await page.getByRole("button", { name: /^Ринок MARKET/ }).click();
    await expect(
      page.getByText(/Роботу в цьому магазині зупинено/),
    ).toBeVisible();
    const signIns = await launchDataExpired(page);
    // The first reading is lost on the way; the second finds the access
    // ended; by the third it is back.
    let reads = 0;
    await page.route("**/api/v1/me", async (route) => {
      reads += 1;
      if (reads === 1) await route.abort("connectionreset");
      else if (reads === 2)
        await route.fulfill({
          status: 401,
          json: { code: "NO_ACCESS", message: "No access" },
        });
      else await route.continue();
    });

    await page.getByRole("button", { name: "Оновити" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Немає відповіді сервера. Перевірте зв’язок і повторіть спробу.",
    );
    await page.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect(
      page.getByRole("heading", { name: "Доступу ще немає" }),
    ).toBeVisible();

    // Meanwhile the owner opened the store again.
    await settle(page, market, "ACTIVE");
    await page.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect(
      page.getByRole("button", { name: "Продаж", exact: true }),
    ).toBeVisible();
    expect(reads).toBe(3);
    expect(signIns.sent).toBe(0);
  } finally {
    await settle(page, market, "ACTIVE");
  }
});

test("a session past its 12 hours asks for the app to be opened again, and never signs in with the old launch data", async ({
  page,
}) => {
  await settle(page, market, "BLOCKED");
  try {
    await openAs(page, petro);
    await page.getByRole("button", { name: /^Ринок MARKET/ }).click();
    const signIns = await launchDataExpired(page);
    let reads = 0;
    await page.route("**/api/v1/me", async (route) => {
      reads += 1;
      await route.fulfill({
        status: 401,
        json: { code: "SESSION_EXPIRED", message: "Session has expired" },
      });
    });

    await page.getByRole("button", { name: "Оновити" }).click();
    const told = page.getByRole("alert");
    await expect(told).toHaveText(
      "Сесія завершилась. Закрийте й відкрийте застосунок у Telegram. Незавершену команду збережено.",
    );
    await page.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect.poll(() => reads).toBe(2);
    await expect(told).toHaveText(/^Сесія завершилась/);
    expect(signIns.sent).toBe(0);
  } finally {
    await settle(page, market, "ACTIVE");
  }
});

test("a sign-in refused for too many attempts says to wait, and the next one signs in", async ({
  page,
}) => {
  let refused = true;
  await page.route("**/api/v1/auth/telegram", async (route) => {
    if (refused)
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "60" },
        json: {
          code: "RATE_LIMITED",
          message: "Too many sign-in attempts from this address",
          details: { retry_after: 60 },
        },
      });
    else await route.continue();
  });
  await openAs(page, hanna);
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "Забагато спроб входу. Зачекайте хвилину й спробуйте ще раз.",
  );

  // No token yet: trying again signs in with the launch data.
  refused = false;
  await page.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(
    page.getByRole("button", { name: "Центр CENTRE" }),
  ).toBeVisible();
});
