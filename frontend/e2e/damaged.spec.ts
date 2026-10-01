import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
  bin_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(): string {
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
  return fields.toString();
}

function launch(): string {
  return `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`;
}

/**
 * A coat of a model of this test's own — so the list's search finds exactly
 * its sale — received into the returns warehouse and sold, through the API.
 */
async function sold(
  page: Page,
  quantity: number,
): Promise<{ model: string; variant: string; size: string; token: string }> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token: token } = (await auth.json()) as {
    access_token: string;
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    "Idempotency-Key": randomUUID(),
  };
  const model = `Повернення ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers,
    data: {
      store_id: fixture.store_id,
      concept: model,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const variant = product.product_variant_id;
  const size = product.sizes[0]?.size_id ?? "";
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.returns_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          quantity: 5,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  const sale = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          source_location_id: fixture.returns_location_id,
          quantity,
          unit_price: "3000.00",
        },
      ],
    },
  });
  expect(sale.status()).toBe(201);
  return { model, variant, size, token };
}

async function held(
  page: Page,
  token: string,
  location: string,
  variant: string,
): Promise<number> {
  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.store_id}&location_id=${location}&limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const { items } = (await response.json()) as {
    items: { product_variant_id: string; quantity: number }[];
  };
  return items.find((i) => i.product_variant_id === variant)?.quantity ?? 0;
}

/** Coats of this test's own model, sold and brought back damaged. */
async function damaged(
  page: Page,
  quantity: number,
): Promise<{ model: string; variant: string; token: string }> {
  const { model, variant, token } = await sold(page, quantity);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Idempotency-Key": randomUUID(),
  };
  const list = await page.request.get(
    `/api/v1/sales?store_id=${fixture.store_id}&q=${encodeURIComponent(model)}`,
    { headers },
  );
  const { sales } = (await list.json()) as {
    sales: { id: string; items: { id: string }[] }[];
  };
  const sale = sales[0];
  if (!sale) throw new Error("The sale was just made");
  const returned = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers,
    data: {
      command_id: randomUUID(),
      lines: [
        {
          sale_item_id: sale.items[0]?.id,
          quantity,
          restock: true,
          condition: "DAMAGED",
        },
      ],
    },
  });
  expect(returned.status()).toBe(201);
  return { model, variant, token };
}

async function open(page: Page): Promise<void> {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Брак", exact: true }).click();
}

function units(page: Page, model: string) {
  return page.getByRole("article").filter({ hasText: model });
}

test("a damaged coat is taken for inspection and goes back on sale where it was sold", async ({
  page,
}) => {
  const { model, variant, token } = await damaged(page, 1);
  const before = await held(page, token, fixture.returns_location_id, variant);
  await open(page);
  const unit = units(page, model);
  await expect(unit).toHaveCount(1);
  await expect(
    page.locator('[data-status="AWAITING"]').filter({ hasText: model }),
  ).toBeVisible();
  await expect(unit).toContainText("продано зі складу «Склад повернень»");

  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  await expect(
    page.locator('[data-status="INSPECTING"]').filter({ hasText: model }),
  ).toBeVisible();
  await expect(unit).toContainText("На перевірці: Оля");

  await unit.getByRole("button", { name: "Повернути в продаж" }).click();
  await expect(unit).toContainText(
    "Повернути в продаж на склад «Склад повернень», звідки його продали?",
  );
  await unit
    .getByRole("button", { name: "Так, повернути на «Склад повернень»" })
    .click();
  await expect(unit).toHaveCount(0);
  expect(await held(page, token, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(0);
});

test("a coat confirmed damaged stays, marked, until it is written off", async ({
  page,
}) => {
  const { model, variant, token } = await damaged(page, 1);
  await open(page);
  const unit = units(page, model);
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  await unit.getByRole("button", { name: "Брак підтверджений" }).click();
  await unit
    .getByLabel("Що з товаром (необов’язково)")
    .fill("пропалений рукав");
  await unit.getByRole("button", { name: "Так, брак підтверджений" }).click();
  await expect(
    page.locator('[data-status="CONFIRMED"]').filter({ hasText: model }),
  ).toBeVisible();
  await expect(unit).toContainText("Примітка: пропалений рукав");
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(1);

  await unit.getByRole("button", { name: "Списати" }).click();
  await unit
    .getByLabel("Чому списуємо (необов’язково)")
    .fill("не ремонтується");
  await unit.getByRole("button", { name: "Так, списати" }).click();
  await expect(unit).toHaveCount(0);
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(0);
});

test("someone else getting there first is said plainly, and the list is read again", async ({
  page,
}) => {
  const { model } = await damaged(page, 1);
  await page.route("**/api/v1/damaged-units/*/take", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "DAMAGED_UNIT_CHANGED",
        message:
          "The damaged unit changed since it was shown; look at it again",
        details: { actual: "INSPECTING" },
      },
    });
  });
  await open(page);
  await units(page, model)
    .getByRole("button", { name: "Взяти на перевірку" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Цю одиницю щойно змінив хтось інший",
  );
});

test("the «Брак» section needs its own permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "damaged:handle",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(page.getByRole("button", { name: "Залишки" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Брак", exact: true }),
  ).toHaveCount(0);
});

test("the stock screen shows «Брак» and offers no correction there", async ({
  page,
}) => {
  await damaged(page, 1);
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Залишки", exact: true }).click();
  await page
    .getByLabel("Склад для перегляду")
    .selectOption(fixture.bin_location_id);
  await expect(
    page.getByText("Він змінюється лише через розділ «Брак».", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Виправити залишок" }),
  ).toHaveCount(0);
});
