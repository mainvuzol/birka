import { test, expect, openStore, section, tillWays } from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Telegram's «Назад» (direction §6.8; «Усе на бірці» task list, P1-1): a
 * screen opened from another — an order's card, a step over it, «Залишки»
 * under «← Ще», S21 — has Telegram show its «Назад», and pressed it does
 * what the screen's «←» does; a tab's first screen has it hidden, Telegram
 * offering «Закрити» there. Where a screen has two ways back, the inner
 * one. Hidden while the «←» is held — a payment in flight or kept on the
 * phone. A Telegram before 6.1 is told nothing of it.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
}

const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

/** Opened from Telegram of `version`. */
function launch(version: string): string {
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
  const hash = new URLSearchParams({
    tgWebAppData: fields.toString(),
    tgWebAppVersion: version,
  });
  return `/#${hash.toString()}`;
}

/** What the app tells Telegram of its «Назад», in order: shown or not. */
async function hearBack(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      backs: boolean[];
    };
    host.backs = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_back_button")
          host.backs.push(
            (JSON.parse(data) as { is_visible: boolean }).is_visible,
          );
      },
    };
  });
}

async function backs(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as { backs: boolean[] }).backs);
}

/** Telegram's «Назад» pressed. */
async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
}

/** An order sent with its waybill, the list holding only it. */
async function oneOrder(page: Page): Promise<void> {
  const created = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const order = {
    id: randomUUID(),
    store_id: fixture.store_id,
    status: "DISPATCHED",
    sale_id: null,
    currency_code: "UAH",
    total: "1200.15",
    created_at: created,
    items: [
      {
        id: randomUUID(),
        product_variant_id: randomUUID(),
        size_id: randomUUID(),
        source_location_id: randomUUID(),
        quantity: 1,
        unit_price: "1200.15",
        discount_amount: "0.00",
        display_name: "Лоран шоколад",
        size_label: "M",
      },
    ],
    destination: "UKRAINE",
    carrier: "NOVA_POSHTA",
    waybill: "20451234",
    abroad_note: null,
    payment_method: null,
    shipping_history: [
      {
        kind: "CREATED",
        by: "Оля",
        at: created,
        destination: "UKRAINE",
        carrier: "NOVA_POSHTA",
        waybill: "20451234",
        abroad_note: null,
      },
    ],
    same_waybill: [],
  };
  await page.route(
    (url) => url.pathname === "/api/v1/orders",
    async (route) => {
      await route.fulfill({ json: { orders: [order], has_more: false } });
    },
  );
  await page.route("**/api/v1/orders/*", async (route) => {
    await route.fulfill({ json: order });
  });
}

test("an order's card and the step over it show Telegram's «Назад»; pressed, it goes back as their «←» does, and on the list it is hidden again", async ({
  page,
}) => {
  await hearBack(page);
  await oneOrder(page);
  await page.goto(launch("8.0"));
  await openStore(page, "Основний MAIN");
  await section(page, "Замовлення");
  await expect(page.locator(".order-row").first()).toBeVisible();
  // A tab's first screen: Telegram's own «Закрити», never told otherwise.
  expect(await backs(page)).toEqual([]);

  await page.locator(".order-row").first().click();
  const card = page.getByRole("heading", {
    name: "Лоран шоколад · M",
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect.poll(() => backs(page)).toEqual([true]);

  // The step over the card: its own «←», and Telegram's never blinks
  // between the two.
  await page.getByRole("button", { name: "Змінити доставку" }).click();
  await expect(
    page.getByRole("button", { name: "← Замовлення" }),
  ).toBeVisible();
  await expect(card).toBeHidden();
  expect(await backs(page)).toEqual([true]);

  // «Назад»: the step's «← Замовлення», the card again.
  await pressBack(page);
  await expect(card).toBeVisible();
  await expect(page.getByRole("button", { name: "← Замовлення" })).toHaveCount(
    0,
  );
  expect(await backs(page)).toEqual([true]);

  // «Назад» again: the card's «← До замовлень», the list, and Telegram's
  // «Закрити» in its place.
  await pressBack(page);
  await expect(page.locator(".order-row").first()).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect.poll(() => backs(page)).toEqual([true, false]);
});

test("a screen of «Ще» shows Telegram's «Назад» and pressed it is «← Ще»; «Ще» itself, a tab's first screen, hides it", async ({
  page,
}) => {
  await hearBack(page);
  await page.goto(launch("8.0"));
  await openStore(page, "Основний MAIN");
  await section(page, "Залишки");
  await expect(
    page.getByRole("heading", { name: "Залишки", level: 1 }),
  ).toBeVisible();
  await expect.poll(() => backs(page)).toEqual([true]);

  await pressBack(page);
  await expect(
    page.getByRole("heading", { name: "Ще", level: 1 }),
  ).toBeVisible();
  await expect.poll(() => backs(page)).toEqual([true, false]);
});

/** A debt of one coat at the till's «Внесок», its payments answered by
 * `pay`; S21 opened, Telegram's «Назад» shown. */
async function toS21(
  page: Page,
  pay: (route: Route, debt: Record<string, unknown>) => Promise<void>,
): Promise<Locator> {
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
    pay(route, debt),
  );
  await hearBack(page);
  await page.goto(launch("8.0"));
  await openStore(page, "Основний MAIN");
  await tillWays(page)
    .getByRole("button", { name: "Внесок", exact: true })
    .click();
  // «Продаж» › «Внесок»: the till's own way, a tab's first screen.
  await expect(
    page.getByRole("heading", { name: "Продаж", level: 1 }),
  ).toBeVisible();
  expect(await backs(page)).toEqual([]);

  await page
    .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
    .click();
  const s21 = page.getByRole("heading", {
    name: "Лоран шоколад · M",
    level: 1,
  });
  await expect(s21).toBeVisible();
  await expect.poll(() => backs(page)).toEqual([true]);
  return s21;
}

/** 700 in cash, on S21's keypad. */
async function pay700(page: Page): Promise<void> {
  for (const key of "700")
    await page
      .locator(".keypad")
      .getByRole("button", { name: key, exact: true })
      .click();
  await page
    .getByRole("group", { name: "Внесок", exact: true })
    .getByRole("button", { name: "Готівка" })
    .click();
}

/** Telegram's «Назад» pressed, and the screen given time to answer it. */
async function pressAndSettle(page: Page): Promise<void> {
  await pressBack(page);
  await page.evaluate(
    () =>
      new Promise((done) => {
        requestAnimationFrame(() => setTimeout(done, 100));
      }),
  );
}

test("S21 shows Telegram's «Назад»; while its payment is in flight its «←» is held and Telegram's hidden, and pressed meanwhile it does nothing", async ({
  page,
}) => {
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((done) => {
    answer = done;
  });
  const s21 = await toS21(page, async (route, debt) => {
    await answered;
    await route.fulfill({
      status: 201,
      json: { ...debt, paid: "1700.00", owed: "1300.00" },
    });
  });
  await pay700(page);
  const back = page.locator(".screen-header .back");
  await expect(back).toBeDisabled();
  await expect.poll(() => backs(page)).toEqual([true, false]);
  // Pressed anyway, as Telegram may have sent it before it hid: nothing.
  await pressAndSettle(page);
  await expect(s21).toBeVisible();
  await expect(back).toBeDisabled();

  answer();
  await expect(
    page.getByRole("heading", { name: "Внесок записано" }),
  ).toBeVisible();
});

test("a payment kept on the phone holds S21's «←», and Telegram's «Назад» stays hidden; pressed, nothing", async ({
  page,
}) => {
  const s21 = await toS21(page, async (route) => {
    await route.abort("connectionfailed");
  });
  await pay700(page);
  await expect(
    page
      .locator(".stub-notice .stub-kept")
      .getByRole("heading", { name: "Внесок ще не підтверджено" }),
  ).toBeVisible();
  await expect(s21).toBeVisible();
  await expect(page.locator(".screen-header .back")).toBeDisabled();
  await expect.poll(() => backs(page)).toEqual([true, false]);
  await pressAndSettle(page);
  await expect(s21).toBeVisible();
  expect(await backs(page)).toEqual([true, false]);
});

test("two ways back on one screen: Telegram's «Назад» is the inner one, «← До черги перевірки», then «← Ще»", async ({
  page,
}) => {
  await hearBack(page);
  await page.goto(launch("8.0"));
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
  await expect.poll(() => backs(page)).toEqual([true]);
  await page.getByRole("button", { name: "+ Нова пропозиція" }).click();
  const inner = page.getByRole("button", { name: "← До черги перевірки" });
  await expect(inner).toBeVisible();

  await pressBack(page);
  await expect(inner).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "+ Нова пропозиція" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу", level: 1 }),
  ).toBeVisible();
  expect(await backs(page)).toEqual([true]);

  await pressBack(page);
  await expect(page.getByRole("heading", { name: "Ще", level: 1 })).toBeVisible();
  await expect.poll(() => backs(page)).toEqual([true, false]);
});

test("a Telegram before 6.1 is told nothing of «Назад», on an order's card or on the list", async ({
  page,
}) => {
  await hearBack(page);
  await oneOrder(page);
  await page.goto(launch("6.0"));
  await openStore(page, "Основний MAIN");
  await section(page, "Замовлення");
  await page.locator(".order-row").first().click();
  await expect(
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "← До замовлень" }).click();
  await expect(page.locator(".order-row").first()).toBeVisible();
  expect(await backs(page)).toEqual([]);
});
