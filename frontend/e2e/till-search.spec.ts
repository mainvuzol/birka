import { test, expect, openStore } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till in the new design, second part (sale-slice TZ, P0-2, P0-3): a
 * model is found by a few letters of its name, and a tap on its size puts
 * the coat in the basket at its price, so a sale of one priced coat takes
 * three taps. The server's search itself is proven by its own tests
 * (`test_till_search.py`); here the list is the server's shape, stubbed.
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

interface Row {
  product_variant_id: string;
  size_id: string;
  display_name: string;
  size_label: string;
  size_is_unknown: boolean;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  suggested_price: string | null;
}

function coat(
  name: string,
  size: string,
  held: number,
  extra: Partial<Row> = {},
): Row {
  return {
    product_variant_id: randomUUID(),
    size_id: randomUUID(),
    display_name: name,
    size_label: size,
    size_is_unknown: false,
    quantity: held,
    reserved_quantity: 0,
    available_quantity: held,
    suggested_price: "1200.00",
    ...extra,
  };
}

/** «Лоран шоколад», size M, two of them, at 1850,00 грн. */
const laurent = coat("Лоран шоколад", "M", 2, {
  product_variant_id: fixture.variant_id,
  size_id: fixture.size_id,
  suggested_price: "1850.00",
});

/** A hundred models that read before «Лоран»: it is on the second page. */
const alpacas = Array.from({ length: 100 }, (_, index) =>
  coat(`Альпака ${String(index + 1).padStart(3, "0")}`, "S", 1),
);

/**
 * The warehouse as the server lists it: in the order given, every word of
 * the search in the name, a hundred rows a page. Returns what was searched.
 */
async function stubList(page: Page, rows: Row[]): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query") ?? "";
    asked.push(query);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = rows.filter((row) =>
      words.every((word) => row.display_name.toLowerCase().includes(word)),
    );
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    await route.fulfill({
      json: {
        items: found.slice(offset, offset + limit),
        has_more: offset + limit < found.length,
      },
    });
  });
  return asked;
}

interface Sent {
  command_id: string;
  lines: { quantity: number; unit_price: string }[];
  found_in_store: unknown[];
  missing_in_store: unknown[];
  size_clarified: unknown[];
  payment_method: string;
}

/** The server's answer to a sale: recorded, unless told the shelf is short. */
async function stubSale(
  page: Page,
  short: { requested: number; available: number } | null = null,
  refusals = 1,
): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    if (short && sent.length <= refusals) {
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Not enough stock for this operation",
          details: {
            location_id: fixture.till_location_id,
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            ...short,
            correctable: true,
          },
        },
      });
      return;
    }
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
      },
    });
  });
  return sent;
}

async function onTheTill(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
}

function search(page: Page) {
  return page.getByRole("searchbox", { name: "Знайти модель" });
}

function chip(page: Page, model: string, text: string) {
  return page
    .getByRole("group", { name: model, exact: true })
    .getByRole("button", { name: text, exact: true });
}

function pay(page: Page, way: string) {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: way, exact: true });
}

test("a model past the first hundred is found by three letters and sold in three taps", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const asked = await stubList(page, [...alpacas, laurent]);
  const sent = await stubSale(page);
  await onTheTill(page);
  // The app's name as the owner writes it (2026-10-15, В4).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Бірка / магазин",
  );
  await expect(
    page.getByText("Кошик порожній — знайдіть модель угорі."),
  ).toBeVisible();
  // Without a search it is on the second page.
  await expect(chip(page, "Альпака 001", "S · 1")).toBeVisible();
  await expect(page.getByRole("group", { name: "Лоран шоколад" })).toHaveCount(
    0,
  );

  // One: the search, typed. Two: the size. Three: the way.
  await search(page).click();
  // One letter, and a pause longer than the search waits: no search.
  await search(page).pressSequentially("л");
  await page.waitForTimeout(600);
  expect(asked.filter((query) => query !== "")).toEqual([]);
  await expect(chip(page, "Альпака 001", "S · 1")).toBeVisible();
  await search(page).pressSequentially("ор", { delay: 40 });
  const tag = page.getByRole("group", { name: "Лоран шоколад", exact: true });
  await expect(tag).toContainText("1850,00 грн");
  await expect(page.getByRole("group", { name: "Альпака 001" })).toHaveCount(0);
  await chip(page, "Лоран шоколад", "M · 2").click();
  const line = page.locator(".line");
  await expect(line).toHaveCount(1);
  await expect(line.getByLabel("Ціна, грн")).toHaveValue("1850,00");
  await expect(
    line.getByText("Ціна продажу 1850,00 грн. Домовилися про іншу — змініть."),
  ).toBeVisible();
  await expect(page.getByText("Разом 1850,00 грн")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: "test-results/till-search-light.png" });
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[0]?.lines).toEqual([
    expect.objectContaining({ quantity: 1, unit_price: "1850.00" }),
  ]);
  // The search waited for two letters at least, and a pause.
  expect(asked.filter((query) => query !== "")).toEqual(["лор"]);

  // The next customer: «Новий продаж», the size, the way.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
  await chip(page, "Альпака 002", "S · 1").click();
  await pay(page, "Картка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[1]?.lines).toEqual([
    expect.objectContaining({ quantity: 1, unit_price: "1200.00" }),
  ]);
});

test("«Ще товари» reads the next hundred under the first", async ({ page }) => {
  await stubList(page, [...alpacas, laurent]);
  await onTheTill(page);
  await expect(chip(page, "Альпака 100", "S · 1")).toBeVisible();
  await page.getByRole("button", { name: "Ще товари" }).click();
  await expect(chip(page, "Лоран шоколад", "M · 2")).toBeVisible();
  await expect(chip(page, "Альпака 001", "S · 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ще товари" })).toHaveCount(0);
});

test("nothing found says where, and «Очистити» brings the list back", async ({
  page,
}) => {
  await stubList(page, [laurent]);
  await onTheTill(page);
  await search(page).fill("зима");
  await expect(
    page.getByText(
      /^За «зима» на складі «.+» нічого немає\. Перевірте назву або очистіть пошук\.$/,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Очистити" }).click();
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
  await expect(chip(page, "Лоран шоколад", "M · 2")).toBeVisible();
});

test("a size whose every coat an order holds offers nothing, and the tag says so", async ({
  page,
}) => {
  await stubList(page, [
    { ...laurent, quantity: 2, reserved_quantity: 2, available_quantity: 0 },
    coat("Лоран шоколад", "L", 3, {
      product_variant_id: fixture.variant_id,
      reserved_quantity: 1,
      available_quantity: 2,
    }),
  ]);
  await onTheTill(page);
  await expect(chip(page, "Лоран шоколад", "M · 0")).toBeDisabled();
  await expect(chip(page, "Лоран шоколад", "L · 2")).toBeEnabled();
  await expect(
    page.getByRole("group", { name: "Лоран шоколад" }),
  ).toContainText("Ще 3 шт. у резерві замовлення");
  // From paper it is offered: the server's refusal says what to do then
  // (ADR-0013 §6), as before the chips.
  await page.getByLabel("Вношу продаж з паперу").check();
  await expect(chip(page, "Лоран шоколад", "M · 0")).toBeEnabled();
});

test("the same size twice is one line of two, and «Менше» never takes a line away", async ({
  page,
}) => {
  await stubList(page, [laurent]);
  const sent = await stubSale(page);
  await onTheTill(page);
  await chip(page, "Лоран шоколад", "M · 2").click();
  await chip(page, "Лоран шоколад", "M · 2").click();
  const line = page.locator(".line");
  await expect(line).toHaveCount(1);
  await expect(line.locator("output")).toHaveText("2");
  await expect(page.getByText("Лоран шоколад · M × 2")).toBeVisible();
  await expect(page.getByText("Разом 3700,00 грн")).toBeVisible();
  await line.getByRole("button", { name: "Менше" }).click();
  await expect(line.locator("output")).toHaveText("1");
  await expect(line.getByRole("button", { name: "Менше" })).toBeDisabled();
  await line.getByRole("button", { name: "Більше" }).click();
  await line.getByLabel("Ціна, грн").fill("1700");
  await expect(page.getByText("Разом 3400,00 грн")).toBeVisible();
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[0]?.lines).toEqual([
    expect.objectContaining({ quantity: 2, unit_price: "1700.00" }),
  ]);
});

test("a model with no price: its field takes the cursor, and the ways wait for a price", async ({
  page,
}) => {
  await stubList(page, [{ ...laurent, suggested_price: null }]);
  const sent = await stubSale(page);
  await onTheTill(page);
  await chip(page, "Лоран шоколад", "M · 2").click();
  const price = page.locator(".line").getByLabel("Ціна, грн");
  await expect(price).toBeFocused();
  await expect(price).toHaveValue("");
  await expect(
    page.getByText(
      "Ціни продажу ще немає — впишіть домовлену. Ціну для всіх задає менеджер у «Залишках».",
    ),
  ).toBeVisible();
  await expect(pay(page, "Готівка")).toBeDisabled();
  await expect(page.getByText("Разом —")).toBeVisible();
  await price.fill("1500,5");
  await expect(pay(page, "Готівка")).toBeEnabled();
  await price.fill("15,5,5");
  await expect(
    page.getByText("Впишіть ціну: гривні й копійки, напр. 1850 або 1850,50."),
  ).toBeVisible();
  await expect(pay(page, "Готівка")).toBeDisabled();
  await price.fill("1500,50");
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[0]?.lines[0]?.unit_price).toBe("1500.50");
});

test("a line changed after the server's shortage answer is a new sale, its answers gone", async ({
  page,
}) => {
  await stubList(page, [laurent]);
  // The shelf is short, and still short after «Товар на місці»: the answer
  // stands on the basket when its price is changed.
  const sent = await stubSale(page, { requested: 3, available: 2 }, 2);
  await onTheTill(page);
  await chip(page, "Лоран шоколад", "M · 2").click();
  const line = page.locator(".line");
  await line.getByRole("button", { name: "Більше" }).click();
  await line.getByRole("button", { name: "Більше" }).click();
  await pay(page, "Готівка").click();
  const short = page.getByRole("alert", { name: "Залишку не вистачає" });
  await short
    .getByRole("button", { name: "Товар на місці — продати 3 · Готівка" })
    .click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]?.found_in_store).toEqual([{ line_index: 0, quantity: 1 }]);
  expect(sent[1]?.command_id).toBe(sent[0]?.command_id);
  await expect(short).toBeVisible();
  // The price agreed again: another sale, the answer gone with the old one.
  await line.getByLabel("Ціна, грн").fill("1800");
  await expect(short).toHaveCount(0);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent).toHaveLength(3);
  expect(sent[2]?.command_id).not.toBe(sent[0]?.command_id);
  expect(sent[2]?.found_in_store).toEqual([]);
  expect(sent[2]?.missing_in_store).toEqual([]);
  expect(sent[2]?.size_clarified).toEqual([]);
  expect(sent[2]?.lines).toEqual([
    expect.objectContaining({ quantity: 3, unit_price: "1800.00" }),
  ]);
});

test("a size read off a label holds the ways once the sale is from paper", async ({
  page,
}) => {
  await stubList(page, [
    coat("Лоран шоколад", "?", 3, {
      product_variant_id: fixture.variant_id,
      size_is_unknown: true,
    }),
  ]);
  await stubSale(page);
  await onTheTill(page);
  await chip(page, "Лоран шоколад", "Розмір невідомий · 3").click();
  const label = page.locator(".line").getByLabel("Розмір з етикетки");
  await label.selectOption({ index: 1 });
  await expect(
    page.getByText("Розмір з етикетки товару без розміру"),
  ).toBeVisible();
  await expect(pay(page, "Готівка")).toBeEnabled();
  // From paper no size is read off a label (G3).
  await page.getByLabel("Вношу продаж з паперу").check();
  await expect(
    page.getByText("Товар з невідомим розміром вносьте як «розмір невідомий»."),
  ).toBeVisible();
  await expect(pay(page, "З паперу · Готівка")).toBeDisabled();
  await page
    .locator(".line")
    .getByRole("button", { name: /^Прибрати/ })
    .click();
  await chip(page, "Лоран шоколад", "Розмір невідомий · 3").click();
  await expect(pay(page, "З паперу · Готівка")).toBeEnabled();
});

test("a warehouse that stops selling is not the till's any more", async ({
  page,
}) => {
  const own = {
    id: randomUUID(),
    name: "Свій",
    is_active: true,
    can_sell: true,
  };
  const shared = {
    id: randomUUID(),
    name: "Спільний",
    is_active: true,
    can_sell: true,
  };
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    await route.fulfill({ json: [own, shared] });
  });
  await stubList(page, [laurent]);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(shared.id);
  await expect(chip(page, "Лоран шоколад", "M · 2")).toBeVisible();
  // A manager stops «Спільний» selling; the till reads its warehouses again.
  shared.can_sell = false;
  const listed = page.waitForRequest((request) =>
    request.url().includes(`location_id=${own.id}`),
  );
  // What TanStack Query hears when the app comes back to the screen.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Склад: Свій")).toBeVisible();
  // The till lists, and sells from, the warehouse it names.
  await listed;
  await expect(chip(page, "Лоран шоколад", "M · 2")).toBeVisible();
});

test("a line keeps knowing its model is held with no size, whatever is searched after", async ({
  page,
}) => {
  await stubList(page, [
    { ...laurent, quantity: 1, available_quantity: 1 },
    coat("Лоран шоколад", "?", 2, {
      product_variant_id: fixture.variant_id,
      size_is_unknown: true,
    }),
    coat("Мілан бордо", "S", 1),
  ]);
  await stubSale(page, { requested: 2, available: 1 });
  await onTheTill(page);
  // Each search narrows the list before anything is tapped: the list on
  // screen at the press is the one for «міл», with no Лоран in it.
  await search(page).fill("лор");
  await expect(page.getByRole("group", { name: "Мілан бордо" })).toHaveCount(0);
  await chip(page, "Лоран шоколад", "M · 1").click();
  await page.locator(".line").getByRole("button", { name: "Більше" }).click();
  await search(page).fill("міл");
  await expect(
    page.getByRole("group", { name: "Лоран шоколад", exact: true }),
  ).toHaveCount(0);
  await chip(page, "Мілан бордо", "S · 1").click();
  await pay(page, "Готівка").click();
  // The coat in hand may be one held with no size: that answer, and not
  // «Товар на місці», which the server refuses for it.
  const short = page.getByRole("alert", { name: "Залишку не вистачає" });
  await expect(
    short.getByRole("button", {
      name: "Це товар без розміру — продати як M · Готівка",
    }),
  ).toBeVisible();
  await expect(
    short.getByRole("button", { name: /Товар на місці/ }),
  ).toHaveCount(0);
});
