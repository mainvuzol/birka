import { test, expect, openStore, toTill, sellsFrom } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A sale's taps at the till («Усе на бірці» task list, P0-5, its acceptance;
 * spec S09): a coat with a price is sold in three — the search, its size's
 * cell, a way — in a store with one warehouse and in one with two; paid in
 * parts, in five — and the tray's row and «Оплата частинами» besides, the
 * keyboard moving through the customer's fields and closing the sheet. The
 * counter is the page's own: every press, typing not counted. The goods and
 * the sale's answer are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
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

const own = fixture.till_location_id;
const shared = fixture.location_id;

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

function coat(at: string, free: number): Record<string, unknown> {
  return {
    location_id: at,
    product_variant_id: fixture.variant_id,
    size_id: fixture.size_id,
    display_name: "Лоран шоколад",
    size_label: "M",
    size_is_unknown: false,
    quantity: free,
    reserved_quantity: 0,
    available_quantity: free,
    suggested_price: "1850.00",
  };
}

/** «Лоран шоколад» M at 1 850,00 грн, at each warehouse given. */
async function goods(page: Page, at: string[]): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: { items: at.map((one) => coat(one, 2)), has_more: false },
    });
  });
}

/** The store sells from «Свій» and «Спільний», both listed at once. */
async function twoWarehouses(page: Page): Promise<void> {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as { id: string }[];
    await route.fulfill({
      response,
      json: rows
        .filter((row) => row.id === own || row.id === shared)
        .map((row) => ({
          ...row,
          name: row.id === own ? "Свій" : "Спільний",
          is_active: true,
          can_sell: true,
          awaiting_first_stock: false,
        })),
    });
  });
}

interface Sent {
  lines: {
    unit_price: string;
    quantity: number;
    source_location_id: string;
  }[];
  payment_method: string;
  credit?: { paid_now: string };
}

/** Every sale recorded, paid in parts when it says so. */
async function stubSale(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    const total = body.lines
      .reduce((sum, line) => sum + Number(line.unit_price) * line.quantity, 0)
      .toFixed(2);
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: total,
        discount_total: "0.00",
        total,
        items: [],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
        payment_method: body.payment_method,
        ...(body.credit
          ? {
              credit: {
                credit_id: randomUUID(),
                paid_now: body.credit.paid_now,
                owed: (Number(total) - Number(body.credit.paid_now)).toFixed(
                  2,
                ),
              },
            }
          : {}),
      },
    });
  });
  return sent;
}

async function onTheTill(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

/** Every press from now on: a finger's, typing not counted. */
async function countTaps(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const host = window as unknown as { taps: number };
    host.taps = 0;
    document.addEventListener(
      "pointerdown",
      () => {
        host.taps += 1;
      },
      true,
    );
  });
  return () =>
    page.evaluate(() => (window as unknown as { taps: number }).taps);
}

function cell(page: Page, at: string): Locator {
  return page.locator(
    `button.size-cell[data-stock="${fixture.variant_id}:${fixture.size_id}"][data-location="${at}"]`,
  );
}

function pay(page: Page, way: string): Locator {
  return page
    .locator(".till-tray")
    .getByRole("button", { name: way, exact: true });
}

/** The search tapped and «лор» typed. */
async function look(page: Page): Promise<void> {
  const search = page.getByRole("searchbox", { name: "Знайти модель" });
  await search.click();
  await page.keyboard.type("лор");
  await expect(search).toHaveValue("лор");
}

for (const [store, at] of [
  ["one warehouse", [own]],
  ["two warehouses, a cell each", [own, shared]],
] as const)
  test(`a coat with a price is sold in three taps — the search, its size, a way — in a store with ${store}`, async ({
    page,
  }) => {
    await goods(page, [...at]);
    if (at.length > 1) await twoWarehouses(page);
    else await sellsFrom(page, own);
    const sent = await stubSale(page);
    await onTheTill(page);
    const taps = await countTaps(page);
    await look(page);
    // The second warehouse's cell where there are two: the cell says where
    // the coat leaves from.
    await cell(page, at[at.length - 1] ?? own).click();
    await pay(page, "Картка").click();
    await expect(
      page.getByRole("heading", { name: "Продаж записано" }),
    ).toBeVisible();
    expect(await taps()).toBe(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.lines).toEqual([
      expect.objectContaining({
        quantity: 1,
        unit_price: "1850.00",
        source_location_id: at[at.length - 1],
      }),
    ]);
    expect(sent[0]?.payment_method).toBe("CARD");
  });

test("paid in parts, in five taps: the search, its size, the tray's row, «Оплата частинами», a way — the keyboard moving through the customer and closing the sheet", async ({
  page,
}) => {
  await goods(page, [own]);
  await sellsFrom(page, own);
  const sent = await stubSale(page);
  await onTheTill(page);
  const taps = await countTaps(page);
  await look(page);
  await cell(page, own).click();
  await page.locator(".till-tray .tray-basket").click();
  const sheet = page.getByRole("dialog", { name: "Кошик" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByLabel("Оплата частинами").check();
  // The cursor in the name, and the keyboard's key on to the next field.
  await expect(sheet.getByLabel("Ім’я покупця")).toBeFocused();
  await page.keyboard.type("Ігор");
  await page.keyboard.press("Enter");
  await expect(sheet.getByLabel("Телефон покупця")).toBeFocused();
  await page.keyboard.type("0501234567");
  await page.keyboard.press("Enter");
  await expect(sheet.getByLabel("Сплачує зараз, грн")).toBeFocused();
  await page.keyboard.type("1000");
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveCount(0);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(await taps()).toBe(5);
  expect(sent[0]?.credit).toEqual(
    expect.objectContaining({ paid_now: "1000.00" }),
  );
});
