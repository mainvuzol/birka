import { test, expect } from "./fixtures";
import type { Page, Route } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * One person past their requests (owner decision, 2026-10-10; ADR-0020).
 *
 * The server refuses before reading anything: 429 `TOO_MANY_REQUESTS`, with
 * how many seconds to wait. A new sale so refused is simply not done, and the
 * seller sells it again; a sale already kept on the phone stays kept, as
 * after an outage, and is checked again later. The text never says
 * «не записано», the words a kept operation's banner reserves for typing it
 * from paper.
 *
 * A screen that knows the command was new says so: a stock correction adds
 * «Нічого не записано.», which is true of it, and keeps the count to send
 * again.
 *
 * The real server does not refuse anyone in these journeys (the run raises
 * the limits, as one person journeying far faster than anyone works), so the
 * refusal is the server's answer as `test_person_limit.py` proves it, given
 * here by a route.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  till_location_id: string;
  /** The stocktake warehouse: only the correction journeys count in it. */
  count_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

const WAIT = "Забагато дій за короткий час. Зачекайте 20 с і повторіть.";

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

/** Into the till, the seeded coat in the basket at 150.00, five on the shelf. */
async function basket(page: Page): Promise<void> {
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
            quantity: 5,
            reserved_quantity: 0,
            available_quantity: 5,
          },
        ],
        has_more: false,
      },
    });
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${fixture.variant_id}:${fixture.size_id}`);
  await page.getByLabel("Кількість").fill("1");
  await page.getByLabel("Ціна за одиницю, грн").fill("150.00");
  await page.getByRole("button", { name: "Додати в кошик" }).click();
}

async function tooMany(route: Route): Promise<void> {
  await route.fulfill({
    status: 429,
    headers: { "Retry-After": "20" },
    json: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests from this person; wait and try again",
      details: { retry_after: 20 },
    },
  });
}

async function sold(route: Route): Promise<void> {
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
}

test("a new sale refused for too many requests is not done, says how long to wait, and is sold again", async ({
  page,
}) => {
  const keys: (string | null)[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    await (keys.length === 1 ? tooMany(route) : sold(route));
  });
  await basket(page);

  await page.getByRole("button", { name: "Готівка", exact: true }).click();

  await expect(page.getByText(WAIT)).toBeVisible();
  await expect(page.getByText("не записано")).toHaveCount(0);
  // Nothing is kept: the till is the seller's at once, nothing blocked.
  await expect(page.getByText("Незавершений продаж")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  // A new sale, not the refused one resent.
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
});

test("a sale kept on the phone, refused for too many requests when checked, stays kept until checked again", async ({
  page,
}) => {
  const keys: (string | null)[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    if (keys.length === 1) await route.abort("connectionfailed");
    else if (keys.length === 2) await tooMany(route);
    else await sold(route);
  });
  await basket(page);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(page.getByText("Незавершений продаж")).toBeVisible();

  await page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click();

  // The first sending may have been recorded: the refusal proves nothing
  // about it, so the sale stays kept and the till stays blocked.
  await expect(page.getByText(WAIT)).toBeVisible();
  await expect(page.getByText("Незавершений продаж")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toBeDisabled();

  await page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click();
  await expect(page.getByText("Незавершений продаж")).toHaveCount(0);
  // Every check resent the very attempt it kept.
  expect(new Set(keys).size).toBe(1);
  expect(keys).toHaveLength(3);
});

test("a correction refused for too many requests keeps its count, and is written when sent again", async ({
  page,
}) => {
  const commands: string[] = [];
  await page.route("**/api/v1/inventory/adjustments", async (route) => {
    commands.push(
      (route.request().postDataJSON() as { command_id: string }).command_id,
    );
    await (commands.length === 1 ? tooMany(route) : route.continue());
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Залишки", exact: true }).click();
  await page
    .getByLabel("Склад для перегляду")
    .selectOption(fixture.count_location_id);
  const row = page
    .getByRole("article")
    .filter({ hasText: "Розмір: M" })
    .first();
  const before = Number(
    /\d+/.exec((await row.getByText(/^На складі:/).textContent()) ?? "")?.[0],
  );
  await row.getByRole("button", { name: "Виправити залишок" }).click();
  await page.getByRole("radio", { name: "Втрачено" }).click();
  await page.getByLabel("Скільки списати, од.").fill("1");
  await page.getByRole("button", { name: "Записати коригування" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(WAIT);
  await expect(alert).toContainText("Нічого не записано.");
  // The count still stands; nothing is kept as unknown.
  await expect(page.getByLabel("Скільки списати, од.")).toHaveValue("1");
  await expect(page.getByText("Незавершене коригування")).toHaveCount(0);

  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(page.getByRole("status")).toContainText(
    `Втрачено, облік ${String(before)} → ${String(before - 1)}.`,
  );
  expect(commands).toHaveLength(2);
});
