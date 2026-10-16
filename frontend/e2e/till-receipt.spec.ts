import {
  test,
  expect,
  fillLine,
  more,
  openStore,
  sections,
  tapSize,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till's receipt and its small things (sale-slice TZ, P1-1, P1-2, P1-8,
 * P1-9): each line as a tag with its size, the shelf's corrections in coats,
 * a buzz when the server answers, the way to return a sale sold by mistake,
 * a warning on a gift's 0,00 грн, and the till's ticks as targets of 44 px.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  till_location_id: string;
  returns_location_id: string;
  variant_id: string;
  size_id: string;
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

/** Opened from Telegram; `version` as its launch data names it. */
function launch(version?: string): string {
  const hash = new URLSearchParams({ tgWebAppData: initData() });
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
}

const laurent = {
  product_variant_id: fixture.variant_id,
  size_id: fixture.size_id,
  display_name: "Лоран шоколад",
  size_label: "M",
  size_is_unknown: false,
  quantity: 3,
  reserved_quantity: 0,
  available_quantity: 3,
  suggested_price: "1850.00",
};

async function stubList(page: Page): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({ json: { items: [laurent], has_more: false } });
  });
}

/** The server's answer to a sale, as given; returns what was sent. */
async function stubSale(
  page: Page,
  answer: Record<string, unknown>,
  status = 201,
): Promise<{ lines: { unit_price: string }[] }[]> {
  const sent: { lines: { unit_price: string }[] }[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    const body = route.request().postDataJSON() as {
      lines: { unit_price: string }[];
      payment_method: string;
    };
    sent.push(body);
    await route.fulfill({
      status,
      json:
        status === 201
          ? {
              id: randomUUID(),
              store_id: fixture.store_id,
              currency_code: "UAH",
              subtotal: "1850.00",
              discount_total: "0.00",
              total: "1850.00",
              items: [],
              corrections: [],
              shortages: [],
              size_reclassifications: [],
              payment_method: body.payment_method,
              ...answer,
            }
          : answer,
    });
  });
  return sent;
}

function item(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    product_variant_id: fixture.variant_id,
    size_id: fixture.size_id,
    source_location_id: fixture.till_location_id,
    quantity: 1,
    unit_price: "1850.00",
    discount_amount: "0.00",
    final_unit_price: "1850.00",
    line_total: "1850.00",
    display_name: "Лоран шоколад",
    ...extra,
  };
}

async function onTheTill(page: Page, version?: string): Promise<void> {
  await page.goto(launch(version));
  await openStore(page, "Основний MAIN");
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
}

function pay(page: Page, way: string) {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: way, exact: true });
}

test("the receipt names each line's size, and the shelf's corrections in coats", async ({
  page,
}) => {
  await stubList(page);
  await stubSale(page, {
    items: [item({ size: "M" })],
    // Two coats found, one movement: the receipt says two.
    corrections: [randomUUID()],
    size_reclassifications: [randomUUID(), randomUUID()],
    found_quantity: 2,
    missing_quantity: 0,
    clarified: [{ size: "L", quantity: 1 }],
  });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  const line = page.locator(".line");
  await expect(line.locator("strong")).toHaveText("Лоран шоколад · M");
  await expect(line.locator("span")).toHaveText("1 × 1850,00 грн");
  await expect(
    page.getByText("Знайдене на полиці додано в облік: 2 шт."),
  ).toBeVisible();
  await expect(
    page.getByText("Розмір з етикетки записано: 1 шт. як L."),
  ).toBeVisible();
  // Nothing was written off: nothing said of it.
  await expect(page.getByText(/На полиці не знайшли/)).toHaveCount(0);
  await expect(page.getByText(/рух\(и\)/)).toHaveCount(0);
});

test("an answer stored before the server named sizes and coats is read from the basket, without numbers", async ({
  page,
}) => {
  await stubList(page);
  await stubSale(page, {
    items: [item()],
    corrections: [randomUUID()],
    shortages: [randomUUID()],
    size_reclassifications: [randomUUID(), randomUUID()],
  });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  // The receipt, not the basket's line still on screen before it.
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.locator(".line strong")).toHaveText("Лоран шоколад · M");
  await expect(
    page.getByText("Знайдене на полиці додано в облік.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "На полиці не знайшли — з обліку знято. Перевірте склад із менеджером.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Розмір з етикетки записано.", { exact: true }),
  ).toBeVisible();
});

test("Telegram buzzes once the server has answered: success when sold, error when refused, nothing for the shelf's question", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
    };
    host.buzzes = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
      },
    };
  });
  await stubList(page);
  let answers = 0;
  await page.route("**/api/v1/sales", async (route) => {
    answers += 1;
    if (answers === 1) {
      // The shelf's question: not a failure (the task list, P1-1).
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Not enough stock for this operation",
          details: {
            location_id: fixture.till_location_id,
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            requested: 1,
            available: 0,
            correctable: true,
          },
        },
      });
      return;
    }
    if (answers === 2) {
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          details: {},
        },
      });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "1850.00",
        discount_total: "0.00",
        total: "1850.00",
        items: [item({ size: "M" })],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
        payment_method: "CASH",
      },
    });
  });
  const buzzes = async () =>
    (
      await page.evaluate(
        () => (window as unknown as { buzzes: string[] }).buzzes,
      )
    ).map((data) => JSON.parse(data) as unknown);
  await onTheTill(page, "8.0");
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("alert", { name: "Залишку не вистачає" }),
  ).toBeVisible();
  expect(await buzzes()).toEqual([]);
  await page
    .getByRole("button", { name: "Товар на місці — продати 1 · Готівка" })
    .click();
  await expect(
    page.getByText(/Кошик збережено — нічого не продано/),
  ).toBeVisible();
  expect(await buzzes()).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(await buzzes()).toEqual([
    { type: "notification", notification_type: "error" },
    { type: "notification", notification_type: "success" },
  ]);
});

test("a Telegram too old for haptics is never asked to buzz", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: { postEvent: (event: string) => void };
      events: string[];
    };
    host.events = [];
    host.TelegramWebviewProxy = {
      postEvent: (event) => {
        host.events.push(event);
      },
    };
  });
  await stubList(page);
  await stubSale(page, { items: [item({ size: "M" })] });
  await onTheTill(page, "6.0");
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  const events = await page.evaluate(
    () => (window as unknown as { events: string[] }).events,
  );
  expect(events).toContain("web_app_ready");
  expect(events).not.toContain("web_app_trigger_haptic_feedback");
});

/** A model of this test's own, received into the returns warehouse. */
async function model(page: Page): Promise<{ name: string; option: string }> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const bearer = ((await auth.json()) as { access_token: string }).access_token;
  const name = `Чек ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: name,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.returns_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: product.sizes[0]?.size_id,
          quantity: 2,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  return {
    name,
    option: `${product.product_variant_id}:${product.sizes[0]?.size_id ?? ""}`,
  };
}

test("a sale made by mistake is returned from its own receipt, by the usual rules", async ({
  page,
}) => {
  const coat = await model(page);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  // «Повернення» read before the sale: its page then is not the one opened.
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.returns_location_id);
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill(coat.name);
  const [variant = "", size = ""] = coat.option.split(":");
  await tapSize(page, variant, size);
  await fillLine(page, { price: "1300" });
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.getByText("Помилилися з товаром чи ціною?")).toBeVisible();
  // «Ще» left open over the receipt closes as the app turns to «Повернення»
  // by itself (redesign P1-6).
  await more(page);
  // One tap, and the return of this very sale is open: no search.
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await expect(
    sections(page).getByRole("button", { name: /^Ще( ⚠)?$/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "До списку продажів" }),
  ).toBeVisible();
  await expect(page.getByText(/на 1300,00 грн\./)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: new RegExp(`^${coat.name}.*, M$`) }),
  ).toBeVisible();
  // Returned as any return is: intact, the money back in cash.
  await page.getByLabel("Цілих").fill("1");
  await page
    .getByRole("button", { name: "Повернути покупцю 1300,00 грн готівкою" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Повернення оформлено" }),
  ).toBeVisible();
});

test("whoever may not take returns is not offered one on the receipt", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of me.stores)
      store.permissions = store.permissions.filter(
        (permission) => permission !== "sale:refund",
      );
    await route.fulfill({ response, json: me });
  });
  await stubList(page);
  await stubSale(page, { items: [item({ size: "M" })] });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Оформити повернення" }),
  ).toHaveCount(0);
});

test("a price of nothing is said, never refused: a gift is allowed", async ({
  page,
}) => {
  await stubList(page);
  const sent = await stubSale(page, { items: [item({ size: "M" })] });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  const line = page.locator(".line");
  await expect(
    line.getByText("Ціна 0,00 грн. Це справді подарунок?"),
  ).toHaveCount(0);
  await line.getByLabel("Ціна, грн").fill("0");
  await expect(
    line.getByText("Ціна 0,00 грн. Це справді подарунок? Перевірте ціну."),
  ).toBeVisible();
  await expect(pay(page, "Готівка")).toBeEnabled();
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[0]?.lines[0]?.unit_price).toBe("0.00");
});

test("the till's ticks are rows of 44 px, and paying in parts puts the cursor in the name", async ({
  page,
}) => {
  await stubList(page);
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  const parts = page.locator("label.check", { hasText: "Оплата частинами" });
  const paper = page.locator("label.check", {
    hasText: "Вношу продаж з паперу",
  });
  for (const row of [parts, paper])
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await parts.click();
  await expect(page.getByLabel("Ім’я покупця")).toBeFocused();
  // The keyboard's action key moves on, and closes after the sum.
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Телефон покупця")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Сплачує зараз, грн")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Сплачує зараз, грн")).not.toBeFocused();
  await expect(page.getByLabel("Ім’я покупця")).toHaveAttribute(
    "enterkeyhint",
    "next",
  );
  await expect(page.getByLabel("Сплачує зараз, грн")).toHaveAttribute(
    "enterkeyhint",
    "done",
  );
  await paper.click();
  await page.getByLabel("Час з паперу").fill("10:00");
  const yesterday = page.locator("label.check", { hasText: "Це було вчора" });
  expect((await yesterday.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

/** One coat of a model of its own sold at the till, at 1300, its receipt on screen. */
async function soldOne(page: Page): Promise<{ name: string }> {
  const coat = await model(page);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.returns_location_id);
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill(coat.name);
  const [variant = "", size = ""] = coat.option.split(":");
  await tapSize(page, variant, size);
  await fillLine(page, { price: "1300" });
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  return coat;
}

test("a return asked from the receipt whose list could not be read opens no sale later", async ({
  page,
}) => {
  const coat = await soldOne(page);
  let fail = true;
  await page.route("**/api/v1/sales?store_id=**", async (route) => {
    if (fail)
      await route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  // The list read again, on the same screen: the list, not that sale.
  fail = false;
  const read = page.waitForResponse(
    (r) => r.url().includes("/api/v1/sales?store_id=") && r.ok(),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await read;
  // A moment for what the answer would open: the list stays.
  await page.waitForTimeout(500);
  await expect(
    page.getByRole("article").filter({ hasText: coat.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "До списку продажів" }),
  ).toHaveCount(0);
});

test("a return asked from the receipt and left before its list came opens no sale later", async ({
  page,
}) => {
  const coat = await soldOne(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/api/v1/sales?store_id=**", async (route) => {
    if (first) {
      first = false;
      await held;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  // Left at once, for the till; the list comes after.
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  release();
  const read = page.waitForResponse(
    (r) => r.url().includes("/api/v1/sales?store_id=") && r.ok(),
  );
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await read;
  // A moment for what the answer would open: the list stays.
  await page.waitForTimeout(500);
  await expect(
    page.getByRole("article").filter({ hasText: coat.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "До списку продажів" }),
  ).toHaveCount(0);
});
