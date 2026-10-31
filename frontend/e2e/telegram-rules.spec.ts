import {
  test,
  expect,
  basketDone,
  basketSheet,
  fromPaper,
  menu,
  more,
  openStore,
  section,
  sellsFrom,
  tapSize,
  tillWays,
  toTill,
} from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Telegram's rules for the build (spec §4.4; «Усе на бірці» task list,
 * P1-2): Telegram asks before Бірка closes while a basket holds goods, a
 * payment's sum is typed or a sale waits to be checked (В-Т7 (а)); the
 * screen is kept upright while the basket holds goods; the keyboard goes on
 * a size cell, a search's result and a sum confirmed; the MainButton is
 * S22's «Відкрити борг» alone, never the till's; a choice, a coat, a verb,
 * an answer and a kept operation are each felt as the spec's vocabulary
 * says. Each only where Telegram names a version that knows it, and nothing
 * where it names none.
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

/** Opened from Telegram; `version` as its launch data names it. */
function launch(version?: string): string {
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
  const hash = new URLSearchParams({ tgWebAppData: fields.toString() });
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
}

type Told = [string, unknown];

/** Everything the app tells Telegram, in order, with what it says. */
async function hear(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data?: string) => void;
      };
      told: [string, unknown][];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        host.told.push([
          event,
          data === undefined ? null : (JSON.parse(data) as unknown),
        ]);
      },
    };
  });
}

async function told(page: Page): Promise<Told[]> {
  return page.evaluate(() => (window as unknown as { told: Told[] }).told);
}

/** What P1-2 tells Telegram, of all it is told. */
const ruled = [
  "web_app_setup_closing_behavior",
  "web_app_toggle_orientation_lock",
  "web_app_hide_keyboard",
  "web_app_setup_main_button",
  "web_app_trigger_haptic_feedback",
];

async function rules(page: Page): Promise<Told[]> {
  return (await told(page)).filter(([event]) => ruled.includes(event));
}

/** Of one kind: `rules` filtered to `event`. */
async function only(page: Page, event: string): Promise<unknown[]> {
  return (await told(page))
    .filter(([each]) => each === event)
    .map(([, data]) => data);
}

const asks = (on: boolean): Told => [
  "web_app_setup_closing_behavior",
  { need_confirmation: on },
];
const upright = (on: boolean): Told => [
  "web_app_toggle_orientation_lock",
  { locked: on },
];
const keyboard: Told = ["web_app_hide_keyboard", null];
const haptic = "web_app_trigger_haptic_feedback";
const selection: Told = [haptic, { type: "selection_change" }];
const light: Told = [haptic, { type: "impact", impact_style: "light" }];
const notified = (kind: string): Told => [
  haptic,
  { type: "notification", notification_type: kind },
];

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

/** The sale's answer: recorded, as the server says it. */
function sold(): Record<string, unknown> {
  return {
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
  };
}

async function onTheTill(page: Page, version?: string): Promise<void> {
  await sellsFrom(page, fixture.till_location_id);
  await page.goto(launch(version));
  await openStore(page, "Основний MAIN");
  await toTill(page);
}

function pay(page: Page, way: string): Locator {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: way, exact: true });
}

function cell(page: Page): Locator {
  return page.locator(
    `button.size-cell[data-stock="${fixture.variant_id}:${fixture.size_id}"]`,
  );
}

function search(page: Page): Locator {
  return page.getByRole("searchbox", { name: "Знайти модель" });
}

test("the till: a cell puts the keyboard away and is felt, ± too; while the basket holds goods — on the till or left for «Ще» — Telegram asks before closing and keeps it upright; emptied or sold, both let go; never a MainButton", async ({
  page,
}) => {
  await hear(page);
  await stubList(page);
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({ status: 201, json: sold() });
  });
  await onTheTill(page, "9.1");
  // The store chosen at its door: a choice, felt. Opening a screen, nothing.
  await expect(cell(page)).toBeVisible();
  expect(await rules(page)).toEqual([selection]);

  await tapSize(page, fixture.variant_id, fixture.size_id);
  await expect
    .poll(() => rules(page))
    .toEqual([selection, keyboard, light, asks(true), upright(true)]);

  // ±1 in the basket's sheet, each a light tap; the sheet itself, nothing.
  const sheet = await basketSheet(page);
  await sheet.getByRole("button", { name: "Більше" }).click();
  await expect(sheet.locator(".line output")).toHaveText("2");
  await sheet.getByRole("button", { name: "Менше" }).click();
  await expect(sheet.locator(".line output")).toHaveText("1");
  expect((await rules(page)).slice(5)).toEqual([light, light]);

  // Emptied: nothing left to lose, the screen free to turn.
  await sheet.getByRole("button", { name: /^Прибрати Лоран шоколад/ }).click();
  await expect(page.getByRole("dialog", { name: "Кошик" })).toHaveCount(0);
  await expect
    .poll(async () => (await rules(page)).slice(7))
    .toEqual([asks(false), upright(false)]);

  // Again, and the price confirmed by the keyboard's key: it goes.
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await (await basketSheet(page)).getByLabel("Ціна, грн").press("Enter");
  await expect(page.getByRole("dialog", { name: "Кошик" })).toHaveCount(0);
  await expect
    .poll(async () => (await rules(page)).slice(9))
    .toEqual([keyboard, light, asks(true), upright(true), keyboard]);

  // Left for «Ще», the basket is still there: so is the question.
  await more(page);
  await expect(
    page.getByRole("heading", { name: "Ще", level: 1 }),
  ).toBeVisible();
  await menu(page).getByRole("button", { name: "Продаж", exact: true }).click();
  await expect(pay(page, "Готівка")).toBeVisible();
  expect(await rules(page)).toHaveLength(14);

  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await rules(page)).slice(14))
    .toEqual([notified("success"), asks(false), upright(false)]);
  // The till's MainButton: never, the whole sale long.
  expect((await told(page)).map(([event]) => event)).not.toContain(
    "web_app_setup_main_button",
  );
});

test("a sale kept on the phone is felt once, a warning, and Telegram asks before closing until it is checked", async ({
  page,
}) => {
  await hear(page);
  await stubList(page);
  let lose = true;
  let sent = 0;
  await page.route("**/api/v1/sales", async (route) => {
    sent += 1;
    if (lose) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ status: 201, json: sold() });
  });
  await onTheTill(page, "9.1");
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
  ).toBeVisible();
  await expect
    .poll(() => only(page, haptic))
    .toEqual([selection[1], light[1], notified("warning")[1]]);
  expect(await only(page, asks(true)[0])).toEqual([asks(true)[1]]);

  // Checked while the server still says nothing: kept still, felt no more.
  const check = page.getByRole("button", {
    name: "Перевірити результат продажу",
  });
  await check.click();
  await expect.poll(() => sent).toBeGreaterThanOrEqual(2);
  await expect(check).toBeEnabled();
  expect(await only(page, haptic)).toEqual([
    selection[1],
    light[1],
    notified("warning")[1],
  ]);

  // Reopened: the basket is gone with it — it lives in memory alone — and
  // the sale still waits, so Telegram still asks, told once; checked by the
  // phone itself, still lost, not felt.
  await page.reload();
  await openStore(page, "Основний MAIN");
  await expect(
    page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
  ).toBeVisible();
  await expect.poll(() => sent).toBeGreaterThanOrEqual(3);
  await expect(check).toBeEnabled();
  await expect.poll(() => only(page, asks(true)[0])).toEqual([asks(true)[1]]);
  const answers = async (): Promise<unknown[]> =>
    (await only(page, haptic)).filter(
      (each) => (each as { type: string }).type === "notification",
    );
  expect(await answers()).toEqual([]);

  // Pressed — unless the phone checks it by itself first: either way, the
  // question goes once it is settled, and the confirmation is not felt.
  lose = false;
  const settled = page.getByRole("heading", {
    name: "Продаж записано один раз",
  });
  const pressed = check.click().catch(() => undefined);
  await Promise.race([pressed, settled.waitFor()]);
  await expect(settled).toBeVisible();
  await expect
    .poll(() => only(page, asks(true)[0]))
    .toEqual([asks(true)[1], asks(false)[1]]);
  expect(await answers()).toEqual([]);
});

for (const [version, turns, asked] of [
  ["9.1", true, true],
  ["8.0", true, true],
  ["7.0", false, true],
  ["6.1", false, false],
] as const)
  test(`a Telegram of ${version}: the keyboard goes${version === "9.1" ? " Telegram's way, and" : ""} by the field letting go${turns ? ", the screen kept upright" : ", the screen's turn untold"}${asked ? ", asked before closing" : ", the question before closing untold"}; a coat felt`, async ({
    page,
  }) => {
    await hear(page);
    await stubList(page);
    await onTheTill(page, version);
    // As a phone's WebView taps a button: the field keeps the cursor.
    await search(page).focus();
    await cell(page).evaluate((button: HTMLElement) => {
      button.click();
    });
    await expect(page.locator(".till-tray .tray-basket")).toContainText(
      "Лоран шоколад",
    );
    await expect(search(page)).not.toBeFocused();
    await expect.poll(() => only(page, haptic)).toContainEqual(light[1]);
    const events = (await told(page)).map(([event]) => event);
    expect(events.includes("web_app_hide_keyboard")).toBe(version === "9.1");
    expect(events.includes("web_app_toggle_orientation_lock")).toBe(turns);
    expect(events.includes("web_app_setup_closing_behavior")).toBe(asked);
  });

test("held sideways as the first coat goes in, the screen is not locked so: turned upright, it is locked then", async ({
  page,
}) => {
  await hear(page);
  await stubList(page);
  await page.setViewportSize({ width: 740, height: 390 });
  await onTheTill(page, "9.1");
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await expect.poll(() => only(page, asks(true)[0])).toEqual([asks(true)[1]]);
  expect(await only(page, upright(true)[0])).toEqual([]);
  await page.setViewportSize({ width: 390, height: 740 });
  await expect
    .poll(() => only(page, upright(true)[0]))
    .toEqual([upright(true)[1]]);
});

test("a basket from paper, the paper turned off in «Ще»: gone, and the question and the lock with it", async ({
  page,
}) => {
  await hear(page);
  await stubList(page);
  await onTheTill(page, "9.1");
  await fromPaper(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await expect.poll(() => only(page, asks(true)[0])).toEqual([asks(true)[1]]);
  await more(page);
  await page.getByRole("switch", { name: /^Вношу продаж з паперу/ }).click();
  await expect
    .poll(() => only(page, asks(true)[0]))
    .toEqual([asks(true)[1], asks(false)[1]]);
  expect(await only(page, upright(true)[0])).toEqual([
    upright(true)[1],
    upright(false)[1],
  ]);
  // Back on the till: the basket is gone, as the question said.
  await menu(page).getByRole("button", { name: "Продаж", exact: true }).click();
  await expect(search(page)).toBeVisible();
  await expect(page.locator(".till-tray .tray-basket")).toHaveCount(0);
});

test("a model without a price: its first cell leaves the keyboard to the price; tapped again, the keyboard goes", async ({
  page,
}) => {
  await hear(page);
  const plain = randomUUID();
  const size = randomUUID();
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            ...laurent,
            product_variant_id: plain,
            size_id: size,
            display_name: "Кокон графіт",
            suggested_price: null,
          },
        ],
        has_more: false,
      },
    });
  });
  await onTheTill(page, "9.1");
  await tapSize(page, plain, size);
  const sheet = await basketSheet(page);
  await expect(sheet.getByLabel("Ціна, грн")).toBeFocused();
  expect(await only(page, keyboard[0])).toEqual([]);
  await basketDone(page);
  await tapSize(page, plain, size);
  await expect.poll(() => only(page, keyboard[0])).toEqual([null]);
});

/** A debt of one coat at the till's «Внесок», its payments answered by
 * `pay`. */
async function debtAtTheTill(
  page: Page,
  answer: (route: Route, debt: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const debt = {
    id: randomUUID(),
    sale_id: randomUUID(),
    store_id: fixture.store_id,
    store_name: "Основний",
    store_state: "ACTIVE",
    customer_name: "Оксана Петренко",
    customer_phone: "067 123 45 67",
    customer_erased_at: null,
    amount: "3000.00",
    currency_code: "UAH",
    status: "OPEN",
    paid: "1000.00",
    returned: "0.00",
    cash_back: "0.00",
    written_off: "0.00",
    owed: "2000.00",
    opened_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    last_payment_at: null,
    closed_at: null,
    goods: ["Лоран шоколад · M"],
    entries: [],
  };
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    await route.fulfill({ json: { owed: "2000.00", customers: 1, debts: 1 } });
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            phone_digits: "0671234567",
            customer_name: debt.customer_name,
            customer_phone: debt.customer_phone,
            owed: debt.owed,
            open_debts: 1,
            credits: [debt],
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route(`**/api/v1/credits/${debt.id}/payments`, (route) =>
    answer(route, debt),
  );
}

async function key(page: Page, keys: string): Promise<void> {
  for (const each of keys)
    await page
      .locator(".keypad")
      .getByRole("button", { name: each, exact: true })
      .click();
}

function owed(page: Page): Locator {
  return page.locator(".owed-sum");
}

test("S21 and S22: a sum typed asks before closing, wiped or taken lets go; the result's «Відкрити борг» is Telegram's MainButton in the app's colours, and pressed it opens the debt again", async ({
  page,
}) => {
  await hear(page);
  await debtAtTheTill(page, async (route, debt) => {
    await route.fulfill({
      status: 201,
      json: { ...debt, paid: "1700.00", owed: "1300.00" },
    });
  });
  await onTheTill(page, "9.1");
  await tillWays(page)
    .getByRole("button", { name: "Внесок", exact: true })
    .click();
  // A way chosen: a choice, felt. The same way again: nothing.
  await expect.poll(() => rules(page)).toEqual([selection, selection]);
  await tillWays(page)
    .getByRole("button", { name: "Внесок", exact: true })
    .click();
  // A customer found: the search done with, the keyboard goes.
  await page
    .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
    .click();
  await expect(owed(page)).toHaveText("2 000,00 грн");
  expect(await rules(page)).toEqual([selection, selection, keyboard]);

  await key(page, "7");
  await expect
    .poll(() => rules(page))
    .toEqual([selection, selection, keyboard, asks(true)]);
  await page.getByRole("button", { name: "Стерти", exact: true }).click();
  await expect
    .poll(async () => (await rules(page)).slice(4))
    .toEqual([asks(false)]);
  await key(page, "700");
  await page
    .getByRole("group", { name: "Внесок", exact: true })
    .getByRole("button", { name: "Готівка" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Внесок записано" }),
  ).toBeVisible();
  const shown: Told = [
    "web_app_setup_main_button",
    {
      is_visible: true,
      is_active: true,
      text: "Відкрити борг",
      color: "#15170f",
      text_color: "#c6ef3e",
    },
  ];
  await expect
    .poll(async () => (await rules(page)).slice(5))
    .toEqual([asks(true), notified("success"), asks(false), shown]);
  // One way on: Telegram's. The screen's own way back stays.
  await expect(
    page.getByRole("button", { name: "Відкрити борг", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".result-next button")).toHaveCount(1);

  // Telegram's theme turns dark: the button in the dark's colours.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          eventType: "theme_changed",
          eventData: { theme_params: { bg_color: "#17212b" } },
        }),
        source: window.parent,
      }),
    );
  });
  await expect
    .poll(() => only(page, "web_app_setup_main_button"))
    .toEqual([
      shown[1],
      { ...(shown[1] as object), color: "#c6ef3e", text_color: "#15170f" },
    ]);

  // Pressed: the debt again, the button gone with the result.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await expect(owed(page)).toHaveText("1 300,00 грн");
  await expect
    .poll(async () => (await only(page, "web_app_setup_main_button")).at(-1))
    .toEqual({ is_visible: false });
  expect(await only(page, "web_app_setup_main_button")).toHaveLength(3);
});

test("where Telegram names no version, it is told none of this: the result's «Відкрити борг» is the screen's own", async ({
  page,
}) => {
  await hear(page);
  await stubList(page);
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({ status: 201, json: sold() });
  });
  await debtAtTheTill(page, async (route, debt) => {
    await route.fulfill({
      status: 201,
      json: { ...debt, paid: "1700.00", owed: "1300.00" },
    });
  });
  await onTheTill(page);
  await search(page).focus();
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await tillWays(page)
    .getByRole("button", { name: "Внесок", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
    .click();
  await key(page, "700");
  await page
    .getByRole("group", { name: "Внесок", exact: true })
    .getByRole("button", { name: "Готівка" })
    .click();
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await expect(owed(page)).toHaveText("1 300,00 грн");
  expect(await rules(page)).toEqual([]);
});

test("a return's sale found puts the keyboard away; its reason's key makes a new line", async ({
  page,
}) => {
  await hear(page);
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
  await page.goto(launch("9.1"));
  await openStore(page, "Основний MAIN");
  await section(page, "Повернення");
  await expect.poll(() => rules(page)).toEqual([selection, selection]);
  await page.getByRole("button", { name: /^Оформити повернення: / }).click();
  await expect(page.locator(".line-return")).toBeVisible();
  expect(await rules(page)).toEqual([selection, selection, keyboard]);
  // The reason's field: its key makes a new line.
  await page.getByRole("button", { name: "Додати причину" }).click();
  const found = await keys(page);
  expect(found).toContain("enter");
  expect(found).not.toContain(null);
});

/** The fields shown that type text, each with the keyboard's key it gets:
 * the keypad's sum (`inputmode="none"`) opens none. */
async function keys(page: Page): Promise<(string | null)[]> {
  return page
    .locator(
      "input:not([type=checkbox]):not([type=radio]):not([inputmode=none]), textarea",
    )
    .filter({ visible: true })
    .evaluateAll((fields) =>
      fields.map((field) => field.getAttribute("enterkeyhint")),
    );
}

test("every field of the till says what its keyboard's key does: the search, the paper's, the price, the terms'; what is paid now confirmed, the keyboard goes", async ({
  page,
}) => {
  await hear(page);
  await stubList(page);
  await onTheTill(page, "9.1");
  await fromPaper(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  const sheet = await basketSheet(page);
  await sheet.getByLabel("Оплата частинами").check();
  // The search; the paper's time — an outage's asks no day; the price; the
  // customer's name and phone, and what is paid now.
  expect(await keys(page)).toEqual([
    "search",
    "done",
    "done",
    "next",
    "next",
    "done",
  ]);
  // The sum confirmed by the keyboard's key: the keyboard goes, and the
  // sheet with it.
  const keyboards = (await only(page, keyboard[0])).length;
  await sheet.getByLabel("Сплачує зараз, грн").fill("500");
  await sheet.getByLabel("Сплачує зараз, грн").press("Enter");
  await expect(page.getByRole("dialog", { name: "Кошик" })).toHaveCount(0);
  expect(await only(page, keyboard[0])).toHaveLength(keyboards + 1);
});

test("every field of a return and of S21 says what its keyboard's key does", async ({
  page,
}) => {
  await debtAtTheTill(page, async (route) => {
    await route.abort();
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Повернення");
  await expect(page.getByRole("searchbox")).toBeVisible();
  expect(await keys(page)).toEqual(["search"]);

  await tillWays(page)
    .getByRole("button", { name: "Внесок", exact: true })
    .click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  expect(await keys(page)).toEqual(["search"]);
  await page
    .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
    .click();
  await expect(owed(page)).toBeVisible();
  // The sum on the app's own keypad, which opens no keyboard; the paper's
  // time.
  expect(await keys(page)).toEqual([]);
  await fromPaper(page, "Вношу внесок з паперу");
  expect(await keys(page)).toEqual(["done"]);
});
