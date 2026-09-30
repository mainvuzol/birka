import { test, expect } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A coat a legacy list loaded with its size not known, sold with its size.
 *
 * The seed opens «Старі залишки» from a list — three of the coat with their
 * size not known — and then delivers one M. The first three tests sell from
 * it against the real API, in order; each reads the balance it starts from,
 * so a fresh seed runs any of them alone. The rest are about what the till
 * does with an answer, and state their own.
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  legacy_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

interface Option {
  product_variant_id: string;
  size_id: string;
  size_label: string;
  size_is_unknown: boolean;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}

interface SaleBody {
  command_id: string;
  found_in_store: unknown[];
  missing_in_store: unknown[];
  size_clarified?: { line_index: number; quantity: number }[];
}

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

/** Open the till at «Старі залишки» and return the balances it listed. */
async function enter(page: Page): Promise<Option[]> {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  const listed = page.waitForResponse(
    (r) => r.url().includes("/catalog/stock-options?") && r.status() === 200,
  );
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.legacy_location_id);
  return ((await (await listed).json()) as { items: Option[] }).items;
}

function sales(page: Page): SaleBody[] {
  const sent: SaleBody[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/sales"))
      sent.push(request.postDataJSON() as SaleBody);
  });
  return sent;
}

async function pick(page: Page, option: Option): Promise<void> {
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${option.product_variant_id}:${option.size_id}`);
}

async function addToBasket(page: Page, quantity: number): Promise<void> {
  await page.getByLabel("Кількість").fill(String(quantity));
  await page.getByLabel("Ціна за одиницю, грн").fill("9000.00");
  await page.getByRole("button", { name: "Додати в кошик" }).click();
}

function unknownOf(options: Option[]): Option {
  const row = options.find((o) => o.size_is_unknown);
  if (!row) throw new Error("The seed holds the coat with its size not known");
  return row;
}

test("a coat held with its size not known is sold with the size on its label", async ({
  page,
}) => {
  const sent = sales(page);
  const unknown = unknownOf(await enter(page));
  await pick(page, unknown);
  await page
    .getByRole("combobox", { name: "Розмір з етикетки" })
    .selectOption({ label: "L" });
  await addToBasket(page, 1);
  await expect(page.getByText(/· L$/)).toBeVisible();
  await expect(
    page.getByText("Розмір з етикетки товару без розміру"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Продати" }).click();

  // The system holds no L, so the server names the shortfall; the till knows
  // the coat came from the size-not-known balance and offers only that.
  await expect(page.getByText("Залишку не вистачає")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Товар на місці/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/size-clarified-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Це товар без розміру — продати як L" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByText("Уточнено розмір: 2 рух(и) складу."),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[0]?.size_clarified).toEqual([]);
  expect(sent[1]?.size_clarified).toEqual([{ line_index: 0, quantity: 1 }]);
  expect(sent[1]?.found_in_store).toEqual([]);
  // One sale, one command, answered twice.
  expect(sent[1]?.command_id).toBe(sent[0]?.command_id);

  // The till read the shelf again after the sale: one coat fewer without a size.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await expect(
    page.locator("option", {
      hasText: `розмір невідомий · доступно ${String(unknown.available_quantity - 1)}`,
    }),
  ).toHaveCount(1);
});

test("a sized line short of stock is answered from the coats without a size", async ({
  page,
}) => {
  const sent = sales(page);
  const options = await enter(page);
  const m = options.find((o) => o.size_id === fixture.size_id);
  if (!m) throw new Error("The seed delivers one M after the list");
  await pick(page, m);
  await addToBasket(page, m.available_quantity + 1);
  await page.getByRole("button", { name: "Продати" }).click();
  await expect(
    page.getByText(
      `у кошику ${String(m.available_quantity + 1)}, в обліку доступно ${String(m.available_quantity)}`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/є на складі з невідомим розміром/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Це товар без розміру — продати як M" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[1]?.size_clarified).toEqual([{ line_index: 0, quantity: 1 }]);
});

test("when the till cannot see the coats without a size, the server's refusal of «товар на місці» brings the answer that fits", async ({
  page,
}) => {
  const sent = sales(page);
  // The list as a page that does not reach the size-not-known row would show
  // it: only the M, at whatever the ledger holds.
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const response = await route.fetch();
    const { items } = (await response.json()) as { items: Option[] };
    const m = items.find((o) => o.size_id === fixture.size_id);
    await route.fulfill({
      response,
      json: {
        items: [
          m ?? {
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            display_name: "Лоран шоколад",
            size_label: "M",
            size_is_unknown: false,
            quantity: 0,
            reserved_quantity: 0,
            available_quantity: 0,
          },
        ],
        has_more: false,
      },
    });
  });
  const [m] = await enter(page);
  if (!m) throw new Error("stubbed");
  await pick(page, m);
  await addToBasket(page, m.available_quantity + 1);
  await page.getByRole("button", { name: "Продати" }).click();
  await page.getByRole("button", { name: /Товар на місці/ }).click();

  // Refused as UNKNOWN_SIZE_STOCK: the same shortfall stands, with the answer
  // the server will take.
  await expect(page.getByText("Залишку не вистачає")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Товар на місці/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Це товар без розміру — продати як M" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent).toHaveLength(3);
  expect(sent[1]?.found_in_store).toEqual([{ line_index: 0, quantity: 1 }]);
  expect(sent[2]?.found_in_store).toEqual([]);
  expect(sent[2]?.size_clarified).toEqual([{ line_index: 0, quantity: 1 }]);
});

test("a line sold as size not known is never offered «товар на місці» or a clarification", async ({
  page,
}) => {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            display_name: "Лоран шоколад",
            size_label: "UNKNOWN",
            size_is_unknown: true,
            quantity: 1,
            reserved_quantity: 0,
            available_quantity: 1,
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "INSUFFICIENT_STOCK",
        details: {
          location_id: fixture.legacy_location_id,
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          requested: 2,
          available: 1,
          correctable: true,
        },
      },
    });
  });
  const [unknown] = await enter(page);
  if (!unknown) throw new Error("stubbed");
  await pick(page, unknown);
  await addToBasket(page, 2);
  await expect(
    page.getByText("Лоран шоколад · розмір невідомий", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Продати" }).click();
  await expect(page.getByText("Залишку не вистачає")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Товар на місці/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Це товар без розміру/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Прибрати цей рядок із кошика" }),
  ).toBeVisible();
});

test("a clarification refused for its own reason is explained and withdrawn", async ({
  page,
}) => {
  const sent = sales(page);
  const answers = [
    {
      code: "INSUFFICIENT_STOCK",
      details: {
        location_id: fixture.legacy_location_id,
        product_variant_id: fixture.variant_id,
        size_id: fixture.size_id,
        requested: 1,
        available: 0,
        correctable: true,
      },
    },
    // Shaped like a shortfall, and must not be read as one.
    {
      code: "INSUFFICIENT_STOCK",
      details: {
        reason: "SIZE_NOT_KNOWN_SHORT",
        line_index: 0,
        location_id: fixture.legacy_location_id,
        product_variant_id: fixture.variant_id,
        size_id: fixture.size_id,
        requested: 1,
        available: 0,
        correctable: false,
      },
    },
  ];
  await page.route("**/api/v1/sales", async (route) => {
    const answer = answers.shift();
    if (!answer) throw new Error("The till sent more than two sales");
    await route.fulfill({ status: 409, json: answer });
  });
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
            quantity: 1,
            reserved_quantity: 0,
            available_quantity: 1,
          },
          {
            product_variant_id: fixture.variant_id,
            size_id: randomUUID(),
            display_name: "Лоран шоколад",
            size_label: "UNKNOWN",
            size_is_unknown: true,
            quantity: 1,
            reserved_quantity: 0,
            available_quantity: 1,
          },
        ],
        has_more: false,
      },
    });
  });
  const [m] = await enter(page);
  if (!m) throw new Error("stubbed");
  await pick(page, m);
  await addToBasket(page, 1);
  await page.getByRole("button", { name: "Продати" }).click();
  await page
    .getByRole("button", { name: "Це товар без розміру — продати як M" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Одиниць цієї моделі без розміру на складі менше",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Кошик збережено — нічого не продано.",
  );
  await expect(page.getByText("Залишку не вистачає")).toHaveCount(0);
  await expect(page.getByText(/Розмір уточнено:/)).toHaveCount(0);
  expect(sent[1]?.size_clarified).toEqual([{ line_index: 0, quantity: 1 }]);
});

test("a sale written down before clarifications existed is resent exactly as stored", async ({
  page,
}) => {
  const me = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/me") && r.status() === 200,
  );
  await page.goto(launch());
  const who = (await (await me).json()) as {
    user_id: string;
    organization_id: string;
  };
  const stored = {
    key: randomUUID(),
    ambiguous: true,
    body: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          source_location_id: fixture.legacy_location_id,
          quantity: 1,
          unit_price: "9000.00",
          discount_amount: "0.00",
        },
      ],
      found_in_store: [],
      missing_in_store: [],
    },
  };
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [
      `birka:sale-pending:${who.organization_id}:${who.user_id}:${fixture.store_id}`,
      JSON.stringify(stored),
    ] as const,
  );
  const resent: { key: string | null; body: string | null }[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    resent.push({
      key: await route.request().headerValue("Idempotency-Key"),
      body: route.request().postData(),
    });
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "9000.00",
        discount_total: "0.00",
        total: "9000.00",
        items: [],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
      },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(page.getByText("Незавершений продаж")).toBeVisible();
  await page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click();
  await expect(page.getByText("Продаж підтверджено")).toBeVisible();
  expect(resent).toHaveLength(1);
  expect(resent[0]?.key).toBe(stored.key);
  expect(JSON.parse(resent[0]?.body ?? "{}")).toEqual(stored.body);
});
