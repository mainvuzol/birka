import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  variant_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
function launch(): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${fixture.telegram_user_id},"first_name":"Оля"}`,
  });
  const check = [...fields]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}
async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Залишки", exact: true }).click();
}

test("stock screen explicitly selects warehouse and shows real API balances without mutations", async ({
  page,
}) => {
  const writes: string[] = [];
  await enter(page);
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  await expect(page.getByLabel("Склад для перегляду")).toHaveValue("");
  const request = page.waitForResponse(
    (r) => r.url().includes("/catalog/stock-options?") && r.status() === 200,
  );
  await page
    .getByLabel("Склад для перегляду")
    .selectOption({ label: "Основний склад" });
  const result = (await (await request).json()) as {
    items: {
      quantity: number;
      reserved_quantity: number;
      available_quantity: number;
    }[];
  };
  expect(result.items.length).toBeGreaterThan(0);
  const row = result.items[0];
  if (!row) throw new Error("Missing stock fixture");
  await expect(
    page.getByText(`На складі: ${String(row.quantity)}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(`У резерві: ${String(row.reserved_quantity)}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(`Доступно: ${String(row.available_quantity)}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toBeVisible();
  await expect(page.getByText(/^На складі:/).first()).toBeVisible();
  await expect(page.getByText(/^У резерві:/).first()).toBeVisible();
  await expect(page.getByText(/^Доступно:/).first()).toBeVisible();
  await page.getByRole("button", { name: "Оновити залишки" }).click();
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/stock-mobile.png",
    fullPage: true,
  });
});

test("stock navigation requires inventory permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "inventory:view",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(
    page.getByRole("button", { name: "Залишки", exact: true }),
  ).toHaveCount(0);
});

test("stock access denial hides stale balances and offers retry", async ({
  page,
}) => {
  await enter(page);
  await page
    .getByLabel("Склад для перегляду")
    .selectOption({ label: "Основний склад" });
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toBeVisible();
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({ status: 403, json: { code: "PERMISSION_DENIED" } });
  });
  await page.getByRole("button", { name: "Оновити залишки" }).click();
  await expect(page.getByRole("alert")).toContainText("Немає доступу");
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toHaveCount(0);
});

test("paused stock, full reservation and explicit unknown-size metadata stay readable across pages", async ({
  page,
}) => {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as {
      is_active: boolean;
      can_sell: boolean;
    }[];
    for (const row of rows) {
      row.is_active = false;
      row.can_sell = false;
    }
    await route.fulfill({ response, json: rows });
  });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const next =
      new URL(route.request().url()).searchParams.get("offset") === "50";
    await route.fulfill({
      json: {
        items: [
          {
            product_variant_id: fixture.variant_id,
            size_id: "fixture-size",
            display_name: next ? "Друга сторінка" : "Повністю зарезервований",
            size_label: "UNKNOWN",
            size_is_unknown: !next,
            quantity: 4,
            reserved_quantity: 4,
            available_quantity: 0,
          },
        ],
        has_more: !next,
      },
    });
  });
  await enter(page);
  await page
    .getByLabel("Склад для перегляду")
    .selectOption({ label: "Основний склад — на паузі" });
  await expect(
    page.getByText("Склад на паузі. Залишки доступні для перегляду."),
  ).toBeVisible();
  await expect(
    page.getByText("Розмір невідомий", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Доступно: 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Наступні товари" }).click();
  await expect(page.getByText("Друга сторінка")).toBeVisible();
  await expect(
    page.getByText("Розмір: UNKNOWN", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Повністю зарезервований")).toHaveCount(0);
  await page.getByRole("button", { name: "Попередні товари" }).click();
  await expect(page.getByText("Повністю зарезервований")).toBeVisible();
});

test("revoked warehouse clears its visible stock and selection", async ({
  page,
}) => {
  await enter(page);
  await page
    .getByLabel("Склад для перегляду")
    .selectOption({ label: "Основний склад" });
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toBeVisible();
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.getByRole("button", { name: "Оновити залишки" }).click();
  await expect(
    page.getByText("Доступних складів немає. Зверніться до менеджера."),
  ).toBeVisible();
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toHaveCount(0);
  await expect(page.getByLabel("Склад для перегляду")).toHaveValue("");
});
