import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  /** The till's own warehouse: never reserved against by the order specs. */
  till_location_id: string;
  variant_id: string;
  size_id: string;
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
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
}

/** Pick the warehouse and the seeded product, returning what the ledger holds. */
async function pickFirstProduct(page: Page): Promise<number> {
  const options = page.waitForResponse(
    (r) => r.url().includes("/catalog/stock-options?") && r.status() === 200,
  );
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  const body = (await (await options).json()) as {
    items: {
      product_variant_id: string;
      size_id: string;
      available_quantity: number;
    }[];
  };
  const first = body.items[0];
  if (!first) throw new Error("Missing stock fixture");
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${first.product_variant_id}:${first.size_id}`);
  return first.available_quantity;
}

async function addToBasket(page: Page, quantity: number): Promise<void> {
  await page.getByLabel("Кількість").fill(String(quantity));
  await page.getByLabel("Ціна за одиницю, грн").fill("150.00");
  await page.getByRole("button", { name: "Додати в кошик" }).click();
}

/**
 * A fixed shelf for the cases that are about the till's own behaviour.
 *
 * The two tests above sell against the real ledger and empty it — which is
 * the point of the second one. Everything below is about what the screen does
 * with an answer, so it states its own starting balance instead of depending
 * on what is left.
 */
async function stubStock(page: Page, available: number): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            display_name: "Лоран шоколад",
            size_label: "M",
            size_is_unknown: false,
            quantity: available,
            reserved_quantity: 0,
            available_quantity: available,
          },
        ],
        has_more: false,
      },
    });
  });
}

test("a seller sells stock the ledger agrees with, and the sale is recorded once", async ({
  page,
}) => {
  await enter(page);
  await pickFirstProduct(page);
  await addToBasket(page, 2);
  await expect(page.getByText("2 × 150,00 грн")).toBeVisible();
  await expect(page.getByText("Разом 300,00 грн")).toBeVisible();
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/sales") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Продати" }).click();
  const response = await posted;
  expect(response.status()).toBe(201);
  // The command carries both identifiers, and the transport key is a header.
  expect(await response.request().headerValue("Idempotency-Key")).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  const receipt = (await response.json()) as {
    total: string;
    corrections: string[];
    shortages: string[];
  };
  expect(receipt.total).toBe("300.00");
  expect(receipt.corrections).toEqual([]);
  expect(receipt.shortages).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.getByText("Разом 300,00 грн")).toBeVisible();
  // Nothing is left in the journal to recover.
  await expect(page.getByText("Незавершений продаж")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/sale-mobile.png",
    fullPage: true,
  });
});

test("«товар на місці» answers a real refusal and completes the same sale", async ({
  page,
}) => {
  await enter(page);
  const available = await pickFirstProduct(page);
  // Deliberately one more than the ledger believes in: the coat is on the rack.
  await addToBasket(page, available + 1);
  const refused = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/sales") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Продати" }).click();
  expect((await refused).status()).toBe(409);
  await expect(page.getByText("Залишку не вистачає")).toBeVisible();
  await expect(
    page.getByText(
      `у кошику ${String(available + 1)}, в обліку доступно ${String(available)}`,
    ),
  ).toBeVisible();
  const sold = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/sales") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page
    .getByRole("button", {
      name: `Товар на місці — продати ${String(available + 1)}`,
    })
    .click();
  const receipt = (await (await sold).json()) as {
    items: { quantity: number }[];
    corrections: string[];
  };
  expect(receipt.items[0]?.quantity).toBe(available + 1);
  expect(receipt.corrections).toHaveLength(1);
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Оприходовано знайдене на місці: 1 рух/),
  ).toBeVisible();
});

test("«на місці лише стільки» sends the count present, not the shortage", async ({
  page,
}) => {
  // The one number in this flow that is easy to invert, so it is asserted on
  // the wire. The server's own bounds are covered by the backend suite; what
  // is proven here is that the till states what the seller actually saw.
  let sent: { missing_in_store: { line_index: number; quantity: number }[] }[] =
    [];
  await page.route("**/api/v1/sales", async (route) => {
    const body = route.request().postDataJSON() as {
      missing_in_store: { line_index: number; quantity: number }[];
    };
    sent = [...sent, body];
    if (body.missing_in_store.length === 0) {
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Not enough stock for this operation",
          details: {
            location_id: fixture.till_location_id,
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            requested: 3,
            available: 2,
            correctable: true,
          },
        },
      });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: "11111111-1111-4111-8111-111111111111",
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "150.00",
        discount_total: "0.00",
        total: "150.00",
        items: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            source_location_id: fixture.till_location_id,
            quantity: 1,
            unit_price: "150.00",
            discount_amount: "0.00",
            final_unit_price: "150.00",
            line_total: "150.00",
            display_name: "Лоран шоколад",
          },
        ],
        corrections: [],
        shortages: ["33333333-3333-4333-8333-333333333333"],
        size_reclassifications: [],
      },
    });
  });
  await stubStock(page, 2);
  await enter(page);
  await pickFirstProduct(page);
  await addToBasket(page, 3);
  await page.getByRole("button", { name: "Продати" }).click();
  await expect(page.getByText("Залишку не вистачає")).toBeVisible();

  // Refuses a count that is not a shortage at all, and names the zero case.
  await page.getByLabel("На місці фактично є, одиниць").fill("3");
  await page.getByRole("button", { name: "Продати стільки, скільки є" }).click();
  await expect(page.getByText(/Вкажіть від 1 до 2/)).toBeVisible();
  // None on the shelf has its own answer (owner decision, 2026-10-01; Q-G).
  await expect(
    page.getByText(/натисніть «На полиці немає жодної»/),
  ).toBeVisible();

  await page.getByLabel("На місці фактично є, одиниць").fill("1");
  await page.getByRole("button", { name: "Продати стільки, скільки є" }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Списано як фізично відсутнє: 1 рух/),
  ).toBeVisible();
  expect(sent.map((body) => body.missing_in_store)).toEqual([
    [],
    [{ line_index: 0, quantity: 1 }],
  ]);
});

test("a seller without the correction permissions is offered neither", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) =>
          p !== "inventory:correct_during_sale" &&
          p !== "inventory:report_missing_during_sale",
      );
    await route.fulfill({ response, json: body });
  });
  await stubStock(page, 2);
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "INSUFFICIENT_STOCK",
        message: "Not enough stock for this operation",
        details: {
          location_id: fixture.till_location_id,
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          requested: 3,
          available: 2,
          correctable: true,
        },
      },
    });
  });
  await enter(page);
  const available = await pickFirstProduct(page);
  await addToBasket(page, available + 1);
  await page.getByRole("button", { name: "Продати" }).click();
  await expect(page.getByText("Залишку не вистачає")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Товар на місці/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Продати стільки, скільки є" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Немає права виправляти залишок під час продажу", {
      exact: false,
    }),
  ).toBeVisible();
});

test("a reserved shortfall is not offered as correctable", async ({ page }) => {
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "INSUFFICIENT_STOCK",
        message: "Not enough stock for this operation",
        details: {
          location_id: fixture.till_location_id,
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          requested: 2,
          available: 1,
          correctable: false,
        },
      },
    });
  });
  await stubStock(page, 1);
  await enter(page);
  await pickFirstProduct(page);
  await addToBasket(page, 2);
  await page.getByRole("button", { name: "Продати" }).click();
  await expect(
    page.getByText(/частина одиниць у резерві замовлення/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Товар на місці/ }),
  ).toHaveCount(0);
});

test("a sale whose outcome is unknown blocks the till until it is settled", async ({
  page,
}) => {
  let attempts = 0;
  const keys: (string | null)[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    attempts += 1;
    keys.push(await route.request().headerValue("Idempotency-Key"));
    if (attempts === 1) {
      await route.abort("connectionfailed");
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: "44444444-4444-4444-8444-444444444444",
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "150.00",
        discount_total: "0.00",
        total: "150.00",
        items: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            source_location_id: fixture.till_location_id,
            quantity: 1,
            unit_price: "150.00",
            discount_amount: "0.00",
            final_unit_price: "150.00",
            line_total: "150.00",
            display_name: "Лоран шоколад",
          },
        ],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
      },
    });
  });
  await stubStock(page, 5);
  await enter(page);
  await pickFirstProduct(page);
  await addToBasket(page, 1);
  await page.getByRole("button", { name: "Продати" }).click();
  await expect(page.getByText("Незавершений продаж")).toBeVisible();
  // Everything else is locked while one sale's outcome is unknown.
  await expect(page.getByRole("button", { name: "Змінити магазин" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Залишки", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click();
  await expect(page.getByText("Незавершений продаж")).toHaveCount(0);
  // The journal replays the attempt it wrote down, under its own key.
  expect(keys[0]).toBe(keys[1]);
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toBeEnabled();
});

test("a store that reaches one sellable warehouse does not ask which", async ({
  page,
}) => {
  // Permitted by the sale API itself: the client may prefill when there is
  // exactly one reachable warehouse, and the server still never chooses.
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as { id: string }[];
    await route.fulfill({
      response,
      json: rows.filter((row) => row.id === fixture.till_location_id),
    });
  });
  await stubStock(page, 4);
  await enter(page);
  const warehouse = page.getByRole("combobox", { name: "Склад", exact: true });
  await expect(warehouse).toHaveValue(fixture.till_location_id);
  // No empty choice is offered, because there is no choice to make.
  await expect(warehouse.locator("option")).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Товар і розмір" })).toBeVisible();
});

test("two sellable warehouses are still chosen explicitly", async ({ page }) => {
  // Exactly two, whatever else the fixture provisions for other specs.
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as { id: string }[];
    await route.fulfill({
      response,
      json: rows.filter((row) =>
        [fixture.location_id, fixture.till_location_id].includes(row.id),
      ),
    });
  });
  await stubStock(page, 4);
  await enter(page);
  const warehouse = page.getByRole("combobox", { name: "Склад", exact: true });
  await expect(warehouse).toHaveValue("");
  await expect(warehouse.locator("option")).toHaveCount(3);
});
