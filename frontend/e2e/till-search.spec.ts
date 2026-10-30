import {
  test,
  expect,
  basketDone,
  basketSheet,
  fromPaper,
  openStore,
  storeLine,
  sellsFrom,
  shortage,
} from "./fixtures";
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

/** «Лоран шоколад», size M, two of them, at 1 850,00 грн. */
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
  await sellsFrom(page, fixture.till_location_id);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

function search(page: Page) {
  return page.getByRole("searchbox", { name: "Знайти модель" });
}

/** A size's cell under a model's tag, by what it reads aloud first: «M,
 * вільно 2» — then what orders hold and the basket has, if any (P0-5). */
function chip(page: Page, model: string, text: string) {
  return page
    .getByRole("group", { name: model, exact: true })
    .locator(
      `button.size-cell:is([aria-label="${text}"], [aria-label^="${text},"])`,
    );
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
  // The screen's title heads the page, the store and who works in it the
  // line under it (redesign P1-6; «Усе на бірці» task list, P0-4); the
  // app's name is on the screens before a store opens (owner, В4).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Продаж");
  await expect(storeLine(page)).toHaveText("Основний · Оля");
  await expect(
    page.getByText("Кошик порожній — знайдіть модель угорі."),
  ).toBeVisible();
  // Without a search it is on the second page.
  await expect(chip(page, "Альпака 001", "S, вільно 1")).toBeVisible();
  await expect(page.getByRole("group", { name: "Лоран шоколад" })).toHaveCount(
    0,
  );

  // One: the search, typed. Two: the size. Three: the way.
  await search(page).click();
  // One letter, and a pause longer than the search waits: no search.
  await search(page).pressSequentially("л");
  await page.waitForTimeout(600);
  expect(asked.filter((query) => query !== "")).toEqual([]);
  await expect(chip(page, "Альпака 001", "S, вільно 1")).toBeVisible();
  await search(page).pressSequentially("ор", { delay: 40 });
  const tag = page.getByRole("group", { name: "Лоран шоколад", exact: true });
  await expect(tag).toContainText("1 850,00 грн");
  await expect(page.getByRole("group", { name: "Альпака 001" })).toHaveCount(0);
  await chip(page, "Лоран шоколад", "M, вільно 2").click();
  // The line, looked at in the basket's sheet: no tap of the sale's
  // («Усе на бірці» task list, P0-5).
  const line = (await basketSheet(page)).locator(".line");
  await expect(line).toHaveCount(1);
  await expect(line.getByLabel("Ціна, грн")).toHaveValue("1850,00");
  await expect(
    line.getByText("Ціна продажу 1 850,00 грн. Домовилися про іншу — змініть."),
  ).toBeVisible();
  await basketDone(page);
  await expect(page.getByText("Разом 1 850,00 грн")).toBeInViewport();
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
  await chip(page, "Альпака 002", "S, вільно 1").click();
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
  await expect(chip(page, "Альпака 100", "S, вільно 1")).toBeVisible();
  await page.getByRole("button", { name: "Ще товари" }).click();
  await expect(chip(page, "Лоран шоколад", "M, вільно 2")).toBeVisible();
  await expect(chip(page, "Альпака 001", "S, вільно 1")).toBeVisible();
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
  await page.getByRole("button", { name: "Очистити", exact: true }).click();
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
  await expect(chip(page, "Лоран шоколад", "M, вільно 2")).toBeVisible();
});

test("a size whose every coat an order holds offers nothing, and its cell says so: «у резерві» and the pin of the held (P0-5)", async ({
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
  const held = chip(page, "Лоран шоколад", "M, вільно 0");
  await expect(held).toBeDisabled();
  await expect(held).toHaveAttribute("aria-label", "M, вільно 0, у резерві 2");
  await expect(held.locator(".size-free")).toHaveText("у резерві");
  await expect(held.locator(".size-held")).toHaveText("2");
  // Tapped, nothing is put in the basket: no tray (P0-5).
  await held.click({ force: true });
  await expect(page.locator(".till-tray")).toHaveCount(0);
  // Partly held: what is free under the letter, the held on its pin.
  const part = chip(page, "Лоран шоколад", "L, вільно 2");
  await expect(part).toBeEnabled();
  await expect(part).toHaveAttribute("aria-label", "L, вільно 2, у резерві 1");
  await expect(part.locator(".size-free")).toHaveText("2");
  await expect(part.locator(".size-held")).toHaveText("1");
  // No line of what is held under the tag any more.
  await expect(
    page.getByRole("group", { name: "Лоран шоколад" }),
  ).not.toContainText("Ще 3 шт. у резерві замовлення");
  // From paper it is offered: the server's refusal says what to do then
  // (ADR-0013 §6), as before the chips.
  await fromPaper(page);
  await expect(chip(page, "Лоран шоколад", "M, вільно 0")).toBeEnabled();
});

test("the same size twice is one line of two, and «Менше» never takes a line away", async ({
  page,
}) => {
  await stubList(page, [laurent]);
  const sent = await stubSale(page);
  await onTheTill(page);
  await chip(page, "Лоран шоколад", "M, вільно 2").click();
  await chip(page, "Лоран шоколад", "M, вільно 2").click();
  // The tray counts two coats of one line (spec §6.15; P0-5).
  await expect(page.locator(".till-tray .tray-basket")).toHaveAccessibleName(
    "Кошик · 2 · Лоран шоколад · M",
  );
  await expect(page.getByText("Разом 3 700,00 грн")).toBeVisible();
  const line = (await basketSheet(page)).locator(".line");
  await expect(line).toHaveCount(1);
  await expect(line.locator("output")).toHaveText("2");
  await line.getByRole("button", { name: "Менше" }).click();
  await expect(line.locator("output")).toHaveText("1");
  await expect(line.getByRole("button", { name: "Менше" })).toBeDisabled();
  await line.getByRole("button", { name: "Більше" }).click();
  await line.getByLabel("Ціна, грн").fill("1700");
  await basketDone(page);
  await expect(page.getByText("Разом 3 400,00 грн")).toBeVisible();
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
  await chip(page, "Лоран шоколад", "M, вільно 2").click();
  // The basket's sheet opens by itself, its price in focus (P0-5).
  const price = page
    .getByRole("dialog", { name: "Кошик" })
    .locator(".line")
    .getByLabel("Ціна, грн");
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
  await basketDone(page);
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
  await chip(page, "Лоран шоколад", "M, вільно 2").click();
  const line = (await basketSheet(page)).locator(".line");
  await line.getByRole("button", { name: "Більше" }).click();
  await line.getByRole("button", { name: "Більше" }).click();
  await basketDone(page);
  await pay(page, "Готівка").click();
  const short = page.getByRole("dialog", { name: "Залишку не вистачає" });
  await shortage(page);
  await short
    .getByRole("button", { name: "Товар на місці — продати 3 · Готівка" })
    .click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]?.found_in_store).toEqual([{ line_index: 0, quantity: 1 }]);
  expect(sent[1]?.command_id).toBe(sent[0]?.command_id);
  await shortage(page);
  // Closed, the question sells nothing, and the answer stays with the sale
  // («Усе на бірці» task list, P0-5). The price agreed again: another sale,
  // the answer gone with the old one.
  await page.keyboard.press("Escape");
  await expect(short).toHaveCount(0);
  await basketSheet(page);
  await line.getByLabel("Ціна, грн").fill("1800");
  await basketDone(page);
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
  await chip(page, "Лоран шоколад", "розмір невідомий, вільно 3").click();
  // Read off the label in the basket's sheet (P0-5).
  const sheet = await basketSheet(page);
  const label = sheet.locator(".line").getByLabel("Розмір з етикетки");
  await label.selectOption({ index: 1 });
  await expect(
    sheet.getByText("Розмір з етикетки; в обліку — «розмір невідомий»"),
  ).toBeVisible();
  await basketDone(page);
  await expect(pay(page, "Готівка")).toBeEnabled();
  // From paper no size is read off a label (G3).
  await fromPaper(page);
  await expect(pay(page, "З паперу · Готівка")).toBeDisabled();
  await basketSheet(page);
  await expect(
    sheet.getByText("Товар з невідомим розміром вносьте як «розмір невідомий»."),
  ).toBeVisible();
  await sheet
    .locator(".line")
    .getByRole("button", { name: /^Прибрати/ })
    .click();
  await chip(page, "Лоран шоколад", "розмір невідомий, вільно 3").click();
  await expect(pay(page, "З паперу · Готівка")).toBeEnabled();
});

test("a warehouse that stops selling is not the till's any more: its cells go, never shown while the one left is read, and a tap sells from the one left", async ({
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
  // Each warehouse's own rows: M two at «Свій», one at «Спільний»; the
  // list of «Свій» alone waits until let go.
  let letGo = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const alone = new URL(route.request().url()).searchParams.get(
      "location_id",
    );
    const atOwn = { ...laurent, location_id: own.id };
    const atShared = {
      ...laurent,
      location_id: shared.id,
      quantity: 1,
      available_quantity: 1,
    };
    if (alone !== null) await held;
    await route.fulfill({
      json: {
        items: alone === null ? [atOwn, atShared] : [atOwn],
        has_more: false,
      },
    });
  });
  // Both at once, none chosen (P0-5): a cell each.
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(chip(page, "Лоран шоколад", "M, Свій, вільно 2")).toBeVisible();
  await expect(
    chip(page, "Лоран шоколад", "M, Спільний, вільно 1"),
  ).toBeVisible();
  // A manager stops «Спільний» selling; the till reads its warehouses again.
  shared.can_sell = false;
  const listed = page.waitForRequest((request) =>
    request.url().includes(`location_id=${own.id}`),
  );
  // What TanStack Query hears when the app comes back to the screen.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await listed;
  // While the one left is read, the list of both is not kept on screen.
  await expect(page.locator(".placeholder .model-tag").first()).toBeVisible();
  await expect(
    page.locator(`button.size-cell[data-location="${shared.id}"]`),
  ).toHaveCount(0);
  letGo();
  // The till lists, and sells from, the one left.
  const left = chip(page, "Лоран шоколад", "M, вільно 2");
  await expect(left).toBeVisible();
  await expect(page.locator("button.size-cell")).toHaveCount(1);
  await left.click();
  await expect(
    (await basketSheet(page)).locator(".line .line-place"),
  ).toHaveText("Склад: Свій");
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
  await chip(page, "Лоран шоколад", "M, вільно 1").click();
  const sheet = await basketSheet(page);
  await sheet.locator(".line").getByRole("button", { name: "Більше" }).click();
  await basketDone(page);
  await search(page).fill("міл");
  await expect(
    page.getByRole("group", { name: "Лоран шоколад", exact: true }),
  ).toHaveCount(0);
  await chip(page, "Мілан бордо", "S, вільно 1").click();
  await pay(page, "Готівка").click();
  // The coat in hand may be one held with no size: that answer, and not
  // «Товар на місці», which the server refuses for it.
  const short = page.getByRole("dialog", { name: "Залишку не вистачає" });
  await expect(
    short.getByRole("button", {
      name: "Розмір з етикетки — продати як M · Готівка",
    }),
  ).toBeVisible();
  await expect(
    short.getByRole("button", { name: /Товар на місці/ }),
  ).toHaveCount(0);
});
