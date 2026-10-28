import { test, expect, expectStub, openStore, tapSize } from "./fixtures";
import type { Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Сьогодні ви продали N шт.» on the till's receipt (owner decisions,
 * 2026-10-16, В8, and 2026-10-17): the seller's own units today, as the
 * server counts them — the rules of the count are the backend's tests
 * (`test_sold_today.py`). Here the goods and the sale's answer are stubbed;
 * the count is the real API's, unless a journey says otherwise.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
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

/** The till's one coat, and each sale answered with `mark()` as its paper
 * mark. */
async function stubbed(
  page: Page,
  mark: () => Record<string, unknown> | null = () => null,
): Promise<void> {
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
            quantity: 3,
            reserved_quantity: 0,
            available_quantity: 3,
            suggested_price: "1850.00",
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "1850.00",
        discount_total: "0.00",
        total: "1850.00",
        items: [
          {
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
            size: "M",
          },
        ],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
        payment_method: "CASH",
        outage: mark(),
      },
    });
  });
}

/** Signed in, on the till's warehouse; who is signed in, by the server. */
async function onTheTill(page: Page): Promise<string> {
  const me = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/me") && r.status() === 200,
  );
  await page.goto(launch());
  const userId = ((await (await me).json()) as { user_id: string }).user_id;
  await openStore(page, "Основний MAIN");
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  return userId;
}

async function sell(page: Page): Promise<void> {
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
}

function soldToday(page: Page) {
  return page.locator(".sold-today");
}

test("after a sale the receipt says how many units the seller sold today, as the server counts them", async ({
  page,
}) => {
  await stubbed(page);
  await onTheTill(page);
  const asked = page.waitForResponse((r) =>
    r.url().includes("/api/v1/sales/sold-today?"),
  );
  await sell(page);
  const answer = await asked;
  expect(answer.status()).toBe(200);
  expect(new URL(answer.url()).searchParams.get("store_id")).toBe(
    fixture.store_id,
  );
  const { units } = (await answer.json()) as { units: number };
  await expect(soldToday(page)).toHaveText(
    `Сьогодні ви продали ${String(units)} шт.`,
  );
  await expect(soldToday(page)).toHaveAttribute("role", "status");
});

test("the line is kept while the figure comes, so nothing on the receipt moves", async ({
  page,
}) => {
  await stubbed(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/sales/sold-today?**", async (route: Route) => {
    await held;
    await route.fulfill({
      json: { business_day: "2026-10-17", units: 7 },
    });
  });
  await onTheTill(page);
  await sell(page);
  const next = page.getByRole("button", { name: "Новий продаж" });
  await expect(soldToday(page)).toHaveText("");
  const before = await next.boundingBox();
  expect(before).not.toBeNull();
  release();
  await expect(soldToday(page)).toHaveText("Сьогодні ви продали 7 шт.");
  expect((await next.boundingBox())?.y).toBe(before?.y);
});

test("a figure the server does not give leaves the receipt as it is", async ({
  page,
}) => {
  await stubbed(page);
  await page.route("**/api/v1/sales/sold-today?**", async (route) => {
    await route.fulfill({
      status: 500,
      json: { code: "INTERNAL_ERROR", message: "Internal error" },
    });
  });
  await onTheTill(page);
  const refused = page.waitForResponse(
    (r) => r.url().includes("/api/v1/sales/sold-today?") && r.status() === 500,
  );
  await sell(page);
  await refused;
  await expectStub(page, {
    way: "Готівка",
    say: "У касу",
    sum: "1 850,00 грн",
  });
  await expect(soldToday(page)).toHaveText("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Новий продаж" }),
  ).toBeEnabled();
});

test("a sale typed from paper for someone else says nothing of the seller's day", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/sales/sold-today?"))
      asked.push(request.url());
  });
  await stubbed(page, () => ({
    sold_by_user_id: randomUUID(),
    sold_by: "Марина",
    sold_at: null,
  }));
  await onTheTill(page);
  await sell(page);
  await expect(page.getByText("Продано під час збою")).toBeVisible();
  await expect(soldToday(page)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("a sale typed from paper naming nobody, or the seller, is the seller's, and says their day", async ({
  page,
}) => {
  let mark: Record<string, unknown> = {
    sold_by_user_id: null,
    sold_by: null,
    sold_at: null,
  };
  await stubbed(page, () => mark);
  const me = await onTheTill(page);
  await sell(page);
  await expect(page.getByText("Продано під час збою")).toBeVisible();
  await expect(soldToday(page)).toHaveText(/^Сьогодні ви продали \d+ шт\.$/);

  await page.getByRole("button", { name: "Новий продаж" }).click();
  mark = { sold_by_user_id: me, sold_by: "Оля", sold_at: null };
  await sell(page);
  await expect(soldToday(page)).toHaveText(/^Сьогодні ви продали \d+ шт\.$/);
});
