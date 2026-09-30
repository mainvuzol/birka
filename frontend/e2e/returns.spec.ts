import { test, expect } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
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

interface ReturnBody {
  command_id: string;
  lines: {
    sale_item_id: string;
    quantity: number;
    restock: boolean;
    condition: string;
  }[];
  reason: string | null;
}

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

/** The returns tab, searched down to one model's sales. */
async function find(page: Page, model: string): Promise<void> {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await page.getByLabel("Пошук за назвою товару").fill(model);
  await page.getByRole("button", { name: "Знайти" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
}

function returns(page: Page): { bodies: ReturnBody[]; keys: string[] } {
  const seen = { bodies: [] as ReturnBody[], keys: [] as string[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/refunds")) {
      seen.bodies.push(request.postDataJSON() as ReturnBody);
      seen.keys.push(request.headers()["idempotency-key"] ?? "");
    }
  });
  return seen;
}

test("one coat back intact goes where it was sold, one damaged to the store's «Брак»", async ({
  page,
}) => {
  const { model, variant, token } = await sold(page, 2);
  const before = await held(page, token, fixture.returns_location_id, variant);
  const sent = returns(page);
  await find(page, model);
  await expect(page.getByRole("article")).toContainText(model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();

  await page.getByLabel("Цілих").fill("1");
  await page.getByLabel("Пошкоджених").fill("1");
  await page
    .getByLabel("Причина повернення (необов’язково)")
    .fill("не підійшов");
  await page
    .getByRole("button", { name: "Повернути покупцю 6000,00 грн" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Повернення оформлено" }),
  ).toBeVisible();
  await expect(page.getByText("Поверніть покупцю 6000,00 грн.")).toBeVisible();
  await expect(
    page.getByText("Пошкоджений товар — на складі «Брак» магазину."),
  ).toBeVisible();
  expect(sent.bodies).toHaveLength(1);
  expect(sent.bodies[0]?.lines.map((l) => l.condition).sort()).toEqual([
    "DAMAGED",
    "INTACT",
  ]);
  expect(sent.bodies[0]?.reason).toBe("не підійшов");
  // The store and the sale are the journal's own, never sent.
  expect(Object.keys(sent.bodies[0] ?? {}).sort()).toEqual([
    "command_id",
    "lines",
    "reason",
  ]);

  expect(await held(page, token, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(1);
  await expect(page.getByRole("article")).toContainText("(повернено 2)");
  await expect(page.getByText("Усе вже повернено")).toBeVisible();
});

test("more than is left to return is stopped before anything is sent", async ({
  page,
}) => {
  const { model } = await sold(page, 2);
  const sent = returns(page);
  await find(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await page.getByLabel("Цілих").fill("2");
  await page.getByLabel("Пошкоджених").fill("1");
  await expect(page.getByRole("alert")).toContainText(
    "можна повернути не більше 2",
  );
  await expect(
    page.getByRole("button", { name: "Вкажіть, що повертають" }),
  ).toBeDisabled();
  expect(sent.bodies).toEqual([]);
});

test("a return whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  const { model } = await sold(page, 1);
  const sent = returns(page);
  let first = true;
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    if (first) {
      first = false;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await find(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await page.getByLabel("Цілих").fill("1");
  await page
    .getByRole("button", { name: "Повернути покупцю 3000,00 грн" })
    .click();

  await expect(page.getByText("Незавершене повернення")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(page.getByText("Незавершене повернення")).toHaveCount(0);
  expect(sent.bodies).toHaveLength(2);
  expect(sent.bodies[1]).toEqual(sent.bodies[0]);
  expect(sent.keys[1]).toBe(sent.keys[0]);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
});

test("a store without a «Брак» is told so, and nothing is returned", async ({
  page,
}) => {
  const { model } = await sold(page, 1);
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "DAMAGED_RETURNS_UNAVAILABLE",
        message: "The store has no «Брак» warehouse to take damaged goods",
        details: { reason: "NOT_SET_UP" },
      },
    });
  });
  await find(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await page.getByLabel("Пошкоджених").fill("1");
  await page
    .getByRole("button", { name: "Повернути покупцю 3000,00 грн" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "ще немає складу «Брак» для пошкодженого товару",
  );
  await expect(page.getByRole("alert")).toContainText("Нічого не повернено.");
  await expect(page.getByText("Незавершене повернення")).toHaveCount(0);
});

test("the search says when no sale has such goods", async ({ page }) => {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await page.getByLabel("Пошук за назвою товару").fill(`немає ${randomUUID()}`);
  await page.getByRole("button", { name: "Знайти" }).click();
  await expect(
    page.getByText("Продажів із таким товаром не знайдено."),
  ).toBeVisible();
});

test("taking returns needs its own permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => p !== "sale:refund");
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(page.getByRole("button", { name: "Залишки" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Повернення", exact: true }),
  ).toHaveCount(0);
});

test("the «Брак» takes no deliveries, and is named in the stock", async ({
  page,
}) => {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Приймання", exact: true }).click();
  const offered = page.locator(`option[value="${fixture.bin_location_id}"]`);
  await expect(offered).toHaveAttribute("disabled", "");
  await expect(offered).toContainText("брак, лише для повернень");
  await page.getByRole("button", { name: "Залишки", exact: true }).click();
  await expect(
    page.locator(`option[value="${fixture.bin_location_id}"]`),
  ).toContainText("брак, не продається");
});
