import { test, expect, openStore, section } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The suggested selling price (owner decisions, 2026-10-01; Q-F).
 *
 * The owner and managers set it — shared for every store, or a store's own
 * that overrides it — where goods arrive and on the stock screen; the till
 * prefills it and the seller may still agree another. The shared price needs
 * the permission over every till: organization-wide, as the owner holds it,
 * or in every store. The seed's shop has one store and «Оля» holds every
 * permission in it, so she may set either.
 *
 * Each test prices models of its own, received into the returns warehouse, so
 * nothing here changes what another journey's till suggests.
 */
interface Fixture {
  telegram_user_id: string;
  owner_telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(telegramUserId: string, name: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"${name}"}`,
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

const seller = { id: fixture.telegram_user_id, name: "Оля" };
const owner = { id: fixture.owner_telegram_user_id, name: "Власниця" };

async function enter(
  page: Page,
  who: { id: string; name: string },
  tab: string,
): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(who.id, who.name) }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await section(page, tab);
}

async function token(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(seller.id, seller.name) },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

/** A model of this test's own, three of it in the returns warehouse. */
async function model(
  page: Page,
  bearer: string,
): Promise<{ name: string; variant: string; option: string }> {
  const name = `Ціна ${randomUUID().slice(0, 8)}`;
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
          quantity: 3,
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
    variant: product.product_variant_id,
    option: `${product.product_variant_id}:${product.sizes[0]?.size_id ?? ""}`,
  };
}

function row(page: Page, name: string) {
  return page.getByRole("article").filter({ hasText: name });
}

async function stockOf(page: Page): Promise<void> {
  await page
    .getByLabel("Склад для перегляду")
    .selectOption(fixture.returns_location_id);
}

test("a store's price set on the stock screen is what its till suggests", async ({
  page,
}) => {
  const bearer = await token(page);
  const priced = await model(page, bearer);
  const unpriced = await model(page, bearer);
  await enter(page, seller, "Залишки");
  await stockOf(page);
  await expect(row(page, priced.name)).toContainText("Ціна продажу: не задана");

  await row(page, priced.name)
    .getByRole("button", { name: "Змінити ціну продажу" })
    .click();
  await row(page, priced.name)
    .getByRole("combobox", { name: "Яку ціну змінюємо" })
    .selectOption("STORE");
  await row(page, priced.name).getByLabel("Нова ціна, грн").fill("0");
  await row(page, priced.name)
    .getByRole("button", { name: "Зберегти ціну" })
    .click();
  await expect(row(page, priced.name).getByRole("alert")).toContainText(
    "більше нуля",
  );
  await row(page, priced.name).getByLabel("Нова ціна, грн").fill("1850,50");
  await row(page, priced.name)
    .getByRole("button", { name: "Зберегти ціну" })
    .click();
  await expect(
    page.getByText(`Ціну продажу збережено: ${priced.name}`),
  ).toBeVisible();
  await expect(row(page, priced.name)).toContainText(
    "Ціна продажу: 1850,50 грн",
  );

  // The till: the price is there before the seller types anything.
  const sent: { lines: { unit_price: string }[] }[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/sales"))
      sent.push(request.postDataJSON() as { lines: { unit_price: string }[] });
  });
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.returns_location_id);
  const search = page.getByRole("searchbox", { name: "Знайти модель" });
  const lines = page.locator(".line");
  // A model with none: the line's price is empty and takes the cursor, and
  // the ways wait for it (redesign P0-3).
  await search.fill(unpriced.name);
  await page.locator(`button.chip[data-stock="${unpriced.option}"]`).click();
  const unpricedPrice = lines.first().getByLabel("Ціна, грн");
  await expect(unpricedPrice).toHaveValue("");
  await expect(unpricedPrice).toBeFocused();
  await expect(
    lines.first().getByText("Ціни продажу ще немає — впишіть домовлену."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Готівка", exact: true }),
  ).toBeDisabled();
  // The priced one starts from its price, and the other keeps none.
  await search.fill(priced.name);
  await expect(
    page.getByRole("group", { name: new RegExp(priced.name) }),
  ).toContainText("1850,50 грн");
  await page.locator(`button.chip[data-stock="${priced.option}"]`).click();
  await expect(lines.nth(1).getByLabel("Ціна, грн")).toHaveValue("1850,50");
  await expect(
    lines
      .nth(1)
      .getByText("Ціна продажу 1850,50 грн. Домовилися про іншу — змініть."),
  ).toBeVisible();
  await expect(unpricedPrice).toHaveValue("");
  await lines
    .first()
    .getByRole("button", { name: `Прибрати ${unpriced.name}` })
    .click();
  await expect(lines).toHaveCount(1);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[0]?.lines[0]?.unit_price).toBe("1850.50");
});

test("the owner sets the shared price where goods arrive, and the store's own overrides it", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  await enter(page, owner, "Приймання");
  await page.getByLabel("Пошук у каталозі").fill(priced.name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: new RegExp(priced.name) }).click();
  await expect(page.getByText("Ціна продажу: не задана")).toBeVisible();

  await page.getByRole("button", { name: "Задати ціну продажу" }).click();
  await expect(
    page.getByRole("combobox", { name: "Яку ціну змінюємо" }),
  ).toHaveValue("ORGANIZATION");
  await page.getByLabel("Нова ціна, грн").fill("2000");
  await page.getByRole("button", { name: "Зберегти ціну" }).click();
  await expect(
    page.getByText("Ціна продажу: 2000,00 грн — спільна для всіх магазинів"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Змінити ціну продажу" }).click();
  await page
    .getByRole("combobox", { name: "Яку ціну змінюємо" })
    .selectOption("STORE");
  await expect(
    page.getByText("Зараз: своєї ціни немає, діє спільна 2000,00 грн."),
  ).toBeVisible();
  await page.getByLabel("Нова ціна, грн").fill("1900");
  await page.getByRole("button", { name: "Зберегти ціну" }).click();
  await expect(
    page.getByText("Ціна продажу: 1900,00 грн — ціна магазину «Основний»"),
  ).toBeVisible();

  // Removing the store's own price brings the shared one back.
  await page.getByRole("button", { name: "Змінити ціну продажу" }).click();
  await expect(
    page.getByRole("combobox", { name: "Яку ціну змінюємо" }),
  ).toHaveValue("STORE");
  await page.getByRole("button", { name: "Прибрати ціну магазину" }).click();
  await expect(
    page.getByText("Ціна продажу: 2000,00 грн — спільна для всіх магазинів"),
  ).toBeVisible();
});

test("a price someone else changed meanwhile is not overwritten unseen", async ({
  page,
}) => {
  const bearer = await token(page);
  const priced = await model(page, bearer);
  await enter(page, seller, "Залишки");
  await stockOf(page);
  await row(page, priced.name)
    .getByRole("button", { name: "Змінити ціну продажу" })
    .click();
  await row(page, priced.name).getByLabel("Нова ціна, грн").fill("1850");

  // Someone else sets the same, shared, price first.
  const elsewhere = await page.request.post("/api/v1/catalog/prices", {
    headers: { Authorization: `Bearer ${bearer}` },
    data: {
      store_id: fixture.store_id,
      product_variant_id: priced.variant,
      applies_to: "ORGANIZATION",
      expected_price: null,
      suggested_price: "1700.00",
    },
  });
  expect(elsewhere.status()).toBe(200);

  await row(page, priced.name)
    .getByRole("button", { name: "Зберегти ціну" })
    .click();
  await expect(row(page, priced.name).getByRole("alert")).toContainText(
    "Цю ціну щойно змінив хтось інший: тепер 1700,00 грн",
  );
  await expect(
    row(page, priced.name).getByText("Зараз: 1700,00 грн"),
  ).toBeVisible();
  // Now seen, it is saved over.
  await row(page, priced.name)
    .getByRole("button", { name: "Зберегти ціну" })
    .click();
  await expect(row(page, priced.name)).toContainText(
    "Ціна продажу: 1850,00 грн",
  );
});

test("whoever may set only this store's price is told so, and sets that", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  // As for a manager of one store in a shop of several: the server answers
  // that the shared price is not theirs to change.
  await page.route("**/api/v1/catalog/prices?**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...((await response.json()) as object), may_set_shared: false },
    });
  });
  await enter(page, seller, "Залишки");
  await stockOf(page);
  await row(page, priced.name)
    .getByRole("button", { name: "Змінити ціну продажу" })
    .click();
  await expect(
    row(page, priced.name).getByText(
      "Ця ціна діятиме лише в магазині «Основний».",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    row(page, priced.name).getByRole("combobox", { name: "Яку ціну змінюємо" }),
  ).toHaveCount(0);
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/catalog/prices"),
  );
  await row(page, priced.name).getByLabel("Нова ціна, грн").fill("1850");
  await row(page, priced.name)
    .getByRole("button", { name: "Зберегти ціну" })
    .click();
  expect((await sent).postDataJSON()).toMatchObject({
    applies_to: "STORE",
    suggested_price: "1850.00",
  });
  await expect(row(page, priced.name)).toContainText(
    "Ціна продажу: 1850,00 грн",
  );
});

test("whoever does not set prices sees them and is offered no change", async ({
  page,
}) => {
  const bearer = await token(page);
  const priced = await model(page, bearer);
  const set = await page.request.post("/api/v1/catalog/prices", {
    headers: { Authorization: `Bearer ${bearer}` },
    data: {
      store_id: fixture.store_id,
      product_variant_id: priced.variant,
      applies_to: "STORE",
      expected_price: null,
      suggested_price: "1850.00",
    },
  });
  expect(set.status()).toBe(200);
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of me.stores)
      store.permissions = store.permissions.filter(
        (permission) => permission !== "catalog:set_price",
      );
    await route.fulfill({ response, json: me });
  });

  await enter(page, seller, "Залишки");
  await stockOf(page);
  await expect(row(page, priced.name)).toContainText(
    "Ціна продажу: 1850,00 грн",
  );
  await expect(
    row(page, priced.name).getByRole("button", {
      name: "Змінити ціну продажу",
    }),
  ).toHaveCount(0);

  await section(page, "Приймання");
  await page.getByLabel("Пошук у каталозі").fill(priced.name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: new RegExp(priced.name) }).click();
  await expect(
    page.getByText("Ціна продажу: 1850,00 грн — ціна магазину «Основний»"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /ціну продажу/ })).toHaveCount(
    0,
  );
});
