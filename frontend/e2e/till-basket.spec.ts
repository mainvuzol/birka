import {
  test,
  expect,
  basketDone,
  basketSheet,
  changeStore,
  fillLine,
  fromPaper,
  openStore,
  toTill,
  section,
  tapSize,
  tillWays,
  sellsFrom,
  shortage,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till's basket kept while the till is left and come back to (the
 * bottom menu's task list, P0-5; the owner's В6 (а), 2026-10-26): the same
 * lines, prices, «Разом» and the same command; gone as before once sold,
 * after «Новий продаж», another store, a kept sale settled, or the paper
 * unticked under a basket built from it.
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

/** One model on the till's list, priced. */
async function stubList(page: Page): Promise<void> {
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
}

type Answer = "sold" | "refused" | "short" | "lost";

/** What a press sent. */
interface Sent {
  command_id: string;
  lines: unknown[];
  found_in_store: unknown[];
  /** The paper's mark: present only on a sale typed from paper. */
  outage?: unknown;
}

/** The server's answers to the sales pressed, in turn; what was sent. */
async function serveSales(page: Page, answers: Answer[]): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as Sent & {
      payment_method: string;
    };
    sent.push(body);
    const answer = answers.shift() ?? "sold";
    if (answer === "lost") await route.abort("connectionfailed");
    else if (answer === "refused")
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          details: {},
        },
      });
    else if (answer === "short")
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Insufficient stock",
          details: {
            location_id: fixture.till_location_id,
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            requested: 2,
            available: 1,
            correctable: true,
            reserved: false,
            recorded: false,
          },
        },
      });
    else
      await route.fulfill({
        status: 201,
        json: {
          id: randomUUID(),
          store_id: fixture.store_id,
          currency_code: "UAH",
          subtotal: "3400.00",
          discount_total: "0.00",
          total: "3400.00",
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

/** «Повернення»'s list, one sale of this store's on it, and how it was
 * paid: a return's screen to open. */
async function oneSaleToReturn(page: Page): Promise<void> {
  const saleId = randomUUID();
  await page.route("**/api/v1/sales?**", async (route) => {
    await route.fulfill({
      json: {
        sales: [
          {
            id: saleId,
            store_id: fixture.store_id,
            store_name: "Основний",
            sold_at: new Date().toISOString(),
            currency_code: "UAH",
            total: "1850.00",
            paid_in_parts: false,
            outage: null,
            items: [
              {
                id: randomUUID(),
                display_name: "Лоран шоколад",
                size: "M",
                quantity: 1,
                final_unit_price: "1850.00",
                refunded: 0,
                back_to_sold_from: true,
                source_location_id: fixture.till_location_id,
                line_total: "1850.00",
              },
            ],
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route("**/api/v1/cash/sales/*/method?**", async (route) => {
    await route.fulfill({
      json: {
        sale_id: saleId,
        target: "SALE",
        target_id: saleId,
        amount_taken: "1850.00",
        method: "CASH",
        corrected: false,
        refund_method: "CASH",
        may_change: true,
      },
    });
  });
}

async function onTheTill(page: Page): Promise<void> {
  await sellsFrom(page, fixture.till_location_id);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
}

/** Two coats of «Лоран шоколад · M» at 1 700,00 грн each. */
async function twoCoats(page: Page): Promise<void> {
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await fillLine(page, { quantity: 2, price: "1700" });
}

function pay(page: Page, way: string) {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: way, exact: true });
}

/** The basket's row on the tray (spec §6.15; «Усе на бірці» task list,
 * P0-5). */
function basket(page: Page) {
  return page.locator(".till-tray .tray-basket");
}

/** The basket as it was: its one line, two coats, its price — read in its
 * sheet, closed again — and «Разом» or, paid in parts, what is paid now and
 * what is owed. */
async function asItWas(
  page: Page,
  total: RegExp = /Разом\s*3\s400,00\sгрн/,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Продаж", exact: true }),
  ).toBeVisible();
  await expect(basket(page)).toHaveAccessibleName(
    /^Кошик · 2 · Лоран шоколад · \S+$/,
  );
  const line = (await basketSheet(page)).locator(".line");
  await expect(line).toHaveCount(1);
  await expect(line).toContainText("Лоран шоколад");
  await expect(line.locator("output")).toHaveText("2");
  await expect(line.getByLabel("Ціна, грн")).toHaveValue("1700");
  // Where it leaves from, under the line («Усе на бірці» task list, P0-5).
  await expect(line.locator(".line-place")).toHaveText("Склад: Каса-склад");
  await basketDone(page);
  await expect(page.locator(".pay-total")).toContainText(total);
}

/** The till, its basket empty. */
async function empty(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Продаж", exact: true }),
  ).toBeVisible();
  await expect(basket(page)).toHaveCount(0);
}

function row(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Розділи" })
    .getByRole("button", { name, exact: true });
}

/** The phone's storage, by its keys. */
async function stored(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage).sort());
}

test("the basket stays while the till is left — «Повернути», «Замовлення», «Ще» — and comes back as it was; pressed again, the same lines under the same command; nothing new on the phone (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  const sent = await serveSales(page, ["refused", "refused", "sold"]);
  await onTheTill(page);
  const before = await stored(page);
  await twoCoats(page);
  await asItWas(page);
  // Refused: nothing sold, the basket kept — as ever.
  await pay(page, "Готівка").click();
  await expect(
    page.getByText(/Кошик збережено — нічого не продано\.$/),
  ).toBeVisible();
  // «Повернути», and back by «Продати».
  const ways = tillWays(page);
  await ways.getByRole("button", { name: "Повернути", exact: true }).click();
  await expect(
    page.getByRole("searchbox", { name: "Що повертають?" }),
  ).toBeVisible();
  await ways.getByRole("button", { name: "Продати", exact: true }).click();
  await asItWas(page);
  // «Замовлення», and back by «Продаж» («Усе на бірці» task list, P0-4).
  await row(page, "Замовлення").click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await row(page, "Продаж").click();
  await asItWas(page);
  // «Ще», and back.
  await row(page, "Ще").click();
  await expect(
    page.getByRole("heading", { name: "Ще", exact: true }),
  ).toBeVisible();
  await row(page, "Продаж").click();
  await asItWas(page);
  // Pressed again: the same basket, the same operation; refused, said as
  // ever.
  await pay(page, "Готівка").click();
  await expect(
    page.getByText(/Кошик збережено — нічого не продано\.$/),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[1]?.command_id).toBe(sent[0]?.command_id);
  expect(sent[1]?.lines).toEqual(sent[0]?.lines);
  // Nothing new on the phone's disk.
  expect(await stored(page)).toEqual(before);
  // Sold: gone, and gone still after leaving and coming back.
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await row(page, "Замовлення").click();
  await row(page, "Продаж").click();
  await empty(page);
});

test("«Новий продаж» and another store leave the till empty, as before (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  await serveSales(page, ["sold"]);
  await onTheTill(page);
  await twoCoats(page);
  await pay(page, "Готівка").click();
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await empty(page);
  // A basket, then another store and back: none.
  await twoCoats(page);
  await changeStore(page);
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await empty(page);
  // A basket, then the app opened again: none — nothing is on the disk.
  await twoCoats(page);
  await page.reload();
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await empty(page);
});

test("a kept sale settled while the till is left opens it empty: the basket never comes back under a command already answered (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  const sent = await serveSales(page, ["lost", "sold"]);
  await onTheTill(page);
  await twoCoats(page);
  await pay(page, "Готівка").click();
  await expect(page.getByText("Продаж ще не підтверджено")).toBeVisible();
  // «Ще» is free while the sale is kept; the till is left. Opened, «Ще»
  // reads «Брак»'s line: the server answers, and the kept sale is checked
  // at once, as its button would (ADR-0013 §4.3).
  await row(page, "Ще").click();
  // Settled: the till, empty, as after any kept sale.
  await empty(page);
  expect(sent).toHaveLength(2);
  expect(sent[1]?.command_id).toBe(sent[0]?.command_id);
});

test("a basket from paper comes back with the paper on, and is sent marked (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  const sent = await serveSales(page, ["sold"]);
  await onTheTill(page);
  await fromPaper(page);
  await twoCoats(page);
  await row(page, "Замовлення").click();
  await row(page, "Продаж").click();
  await asItWas(page);
  await expect(page.getByLabel("Вношу продаж з паперу")).toBeChecked();
  await pay(page, "З паперу · Готівка").click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]?.outage).toBeDefined();
});

/** On a return's screen, from «Повернення»'s list. */
async function aReturnsScreen(page: Page): Promise<void> {
  await section(page, "Повернення");
  await page.getByRole("button", { name: /^Оформити повернення: / }).click();
}

test("a basket built from paper is gone once the paper is unticked on another screen — and unticked and ticked again — never sent unmarked, nor in another series (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  await oneSaleToReturn(page);
  await onTheTill(page);
  await fromPaper(page);
  await twoCoats(page);
  // Unticked on a return's screen: gone.
  await aReturnsScreen(page);
  const returnsPaper = page.getByLabel("Вношу повернення з паперу");
  await expect(returnsPaper).toBeChecked();
  await returnsPaper.uncheck();
  await row(page, "Продаж").click();
  await empty(page);
  await expect(page.getByLabel("Вношу продаж з паперу")).not.toBeChecked();
  // From paper again; unticked and ticked again elsewhere: gone too — the
  // till's own switch would have dropped it at the untick (review,
  // 2026-10-27).
  await fromPaper(page);
  await twoCoats(page);
  await aReturnsScreen(page);
  await returnsPaper.uncheck();
  await fromPaper(page, "Вношу повернення з паперу");
  await row(page, "Продаж").click();
  await empty(page);
});

test("an unmarked basket keeps its lines when the paper is ticked on another screen; its shelf's question, closed, comes back no more (navigation task list, P0-5; «Усе на бірці» task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  await oneSaleToReturn(page);
  await serveSales(page, ["short"]);
  await onTheTill(page);
  await twoCoats(page);
  await pay(page, "Готівка").click();
  const question = await shortage(page);
  // A sheet over the till: closed before the menu is in reach, nothing
  // sold.
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  // Away and back, unmarked still: the lines, and no question.
  await row(page, "Замовлення").click();
  await row(page, "Продаж").click();
  await asItWas(page);
  await expect(question).toHaveCount(0);
  // Ticked on a return's screen: the lines, no question.
  await aReturnsScreen(page);
  await fromPaper(page, "Вношу повернення з паперу");
  await row(page, "Продаж").click();
  await asItWas(page);
  await expect(page.getByLabel("Вношу продаж з паперу")).toBeChecked();
  await expect(question).toHaveCount(0);
});

test("an answer about the shelf already given is never sent with the paper's mark once the paper is ticked on another screen (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  await oneSaleToReturn(page);
  const sent = await serveSales(page, ["short", "refused", "sold"]);
  await onTheTill(page);
  await twoCoats(page);
  await pay(page, "Готівка").click();
  // Answered, and refused for another reason: the answer is kept.
  await shortage(page);
  await page.getByRole("button", { name: /^Товар на місці — продати/ }).click();
  await expect(
    page.getByText(/Кошик збережено — нічого не продано\.$/),
  ).toBeVisible();
  expect(sent[1]?.found_in_store).not.toEqual([]);
  // Ticked on a return's screen: sent marked, the lines and no answer.
  await aReturnsScreen(page);
  await fromPaper(page, "Вношу повернення з паперу");
  await row(page, "Продаж").click();
  await asItWas(page);
  await pay(page, "З паперу · Готівка").click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]?.outage).toBeDefined();
  expect(sent[2]?.found_in_store).toEqual([]);
  expect(sent[2]?.lines).toEqual(sent[1]?.lines);
});

test("paying in parts comes back with the basket: the customer, the number and the part paid now (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  await onTheTill(page);
  await twoCoats(page);
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill("Марія Кошикова");
  await page.getByLabel("Телефон покупця").fill("067 123 45 67");
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await basketDone(page);
  await row(page, "Замовлення").click();
  await row(page, "Продаж").click();
  await asItWas(page, /^Зараз 1\s000,00\sгрн · винен 2\s400,00\sгрн$/);
  await basketSheet(page);
  await expect(page.getByLabel("Оплата частинами")).toBeChecked();
  await expect(page.getByLabel("Ім’я покупця")).toHaveValue("Марія Кошикова");
  await expect(page.getByLabel("Телефон покупця")).toHaveValue("067 123 45 67");
  await expect(page.getByLabel("Сплачує зараз, грн")).toHaveValue("1000");
});

test("an answer about the shelf already given comes back with the basket, and is sent with it under the same command (navigation task list, P0-5)", async ({
  page,
}) => {
  await stubList(page);
  const sent = await serveSales(page, ["short", "refused", "refused"]);
  await onTheTill(page);
  await twoCoats(page);
  await pay(page, "Готівка").click();
  await shortage(page);
  await page.getByRole("button", { name: /^Товар на місці — продати/ }).click();
  await expect(
    page.getByText(/Кошик збережено — нічого не продано\.$/),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[1]?.found_in_store).not.toEqual([]);
  await row(page, "Замовлення").click();
  await row(page, "Продаж").click();
  await asItWas(page);
  await pay(page, "Готівка").click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]?.found_in_store).toEqual(sent[1]?.found_in_store);
  expect(sent[2]?.command_id).toBe(sent[1]?.command_id);
});

test("an emptied basket keeps nothing: paying in parts was the last customer's (navigation task list, P0-5; review, 2026-10-27)", async ({
  page,
}) => {
  await stubList(page);
  await onTheTill(page);
  await twoCoats(page);
  const sheet = await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill("Марія Кошикова");
  await sheet.getByRole("button", { name: /^Прибрати/ }).click();
  // Emptied, the sheet closes with the tray.
  await expect(sheet).toHaveCount(0);
  await expect(basket(page)).toHaveCount(0);
  await row(page, "Замовлення").click();
  await row(page, "Продаж").click();
  await empty(page);
  await twoCoats(page);
  await basketSheet(page);
  await expect(page.getByLabel("Оплата частинами")).not.toBeChecked();
});
