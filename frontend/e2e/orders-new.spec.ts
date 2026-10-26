import { test, expect, openStore, section } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Нове замовлення» as the till sells (orders task list, P0-5): a few
 * letters find the model, a tap on its size puts a line in the order at the
 * store's price, «−»/«+» and «Прибрати» change it; where it goes by a
 * switch, the carrier a chip; «Замовити та зарезервувати» under the thumb,
 * and the card says what it reserved. The warehouses, the goods and the
 * server's answers are stubbed.
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

function launch(
  options: { theme?: Record<string, string>; version?: string } = {},
): string {
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
  if (options.theme)
    hash.set("tgWebAppThemeParams", JSON.stringify(options.theme));
  hash.set("tgWebAppVersion", options.version ?? "6.1");
  return `/#${hash.toString()}`;
}

const own = randomUUID();
const shared = randomUUID();
const loran = randomUUID();
const milan = randomUUID();
const sizeM = randomUUID();
const sizeL = randomUUID();
const sizeS = randomUUID();

function place(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    code: name.toUpperCase(),
    is_active: true,
    can_sell: true,
    can_receive: true,
    damaged_returns: false,
    awaiting_first_stock: false,
  };
}

/** A size held: «Лоран шоколад» M, three of it free, at 1 850,00 грн. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    location_id: own,
    product_variant_id: loran,
    size_id: sizeM,
    display_name: "Лоран шоколад",
    size_label: "M",
    size_is_unknown: false,
    quantity: 3,
    reserved_quantity: 0,
    available_quantity: 3,
    suggested_price: "1850.00",
    ...over,
  };
}

/** Its L all held for other orders, and «Мілан графіт» with no price. */
function goods(): Record<string, unknown>[] {
  return [
    row(),
    row({
      size_id: sizeL,
      size_label: "L",
      quantity: 2,
      reserved_quantity: 2,
      available_quantity: 0,
    }),
    row({
      product_variant_id: milan,
      size_id: sizeS,
      display_name: "Мілан графіт",
      size_label: "S",
      quantity: 5,
      available_quantity: 5,
      suggested_price: null,
    }),
  ];
}

interface Server {
  places: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  /** Each `POST /orders` body. */
  made: Record<string, unknown>[];
  /** Each read of the goods, by its query string. */
  reads: string[];
  /** The next `POST /orders` refused for want of stock, with these details. */
  refuse?: Record<string, unknown>;
  orders: Record<string, unknown>[];
  /** Each step sent on an order. */
  steps: string[];
  /** The next `POST /orders` refused with this answer instead. */
  fail?: { status: number; json: Record<string, unknown> };
  /** The next `POST /orders` never answered, the server never reached. */
  lose?: boolean;
  /** The next read of an order fails with the server's own error. */
  loseRead?: boolean;
}

function server(over: Partial<Server> = {}): Server {
  return {
    places: [place(own, "Свій")],
    rows: goods(),
    made: [],
    reads: [],
    orders: [],
    steps: [],
    ...over,
  };
}

/** The order the server makes of a body: its lines named as listed. */
function made(server: Server, body: Record<string, unknown>) {
  const at = new Date().toISOString();
  const lines = body.lines as Record<string, unknown>[];
  const cents = lines.reduce(
    (sum, line) =>
      sum + Math.round(Number(line.unit_price) * 100) * Number(line.quantity),
    0,
  );
  return {
    id: randomUUID(),
    store_id: fixture.store_id,
    status: "READY_TO_DISPATCH",
    sale_id: null,
    currency_code: "UAH",
    total: (cents / 100).toFixed(2),
    created_at: at,
    items: lines.map((line) => {
      const listed = server.rows.find(
        (each) =>
          each.product_variant_id === line.product_variant_id &&
          each.size_id === line.size_id,
      );
      return {
        id: randomUUID(),
        ...line,
        display_name: listed?.display_name,
        size_label: listed?.size_label,
      };
    }),
    destination: body.destination,
    carrier: body.carrier ?? null,
    waybill: null,
    abroad_note: null,
    payment_method: null,
    shipping_history: [
      {
        kind: "CREATED",
        by: "Оля",
        at,
        destination: body.destination,
        carrier: body.carrier ?? null,
        waybill: null,
        abroad_note: null,
      },
    ],
    same_waybill: [],
  };
}

async function stub(page: Page, server: Server): Promise<void> {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    await route.fulfill({ json: server.places });
  });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const url = new URL(route.request().url());
    server.reads.push(url.search);
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    await route.fulfill({
      json: {
        items: server.rows.filter(
          (each) =>
            !query || String(each.display_name).toLowerCase().includes(query),
        ),
        has_more: false,
      },
    });
  });
  await page.route(
    (url) => url.pathname === "/api/v1/orders",
    async (route, request) => {
      if (request.method() !== "POST") {
        const open = new URL(request.url()).searchParams.get("status");
        await route.fulfill({
          json: {
            orders: open === "closed" ? [] : server.orders,
            has_more: false,
          },
        });
        return;
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      server.made.push(body);
      if (server.lose) {
        server.lose = false;
        await route.abort("failed");
        return;
      }
      if (server.fail) {
        const answer = server.fail;
        delete server.fail;
        await route.fulfill(answer);
        return;
      }
      if (server.refuse) {
        const details = server.refuse;
        delete server.refuse;
        await route.fulfill({
          status: 409,
          json: {
            code: "INSUFFICIENT_STOCK",
            message: "Not enough stock for this operation",
            details,
          },
        });
        return;
      }
      const order = made(server, body);
      server.orders.unshift(order);
      await route.fulfill({ status: 201, json: order });
    },
  );
  await page.route("**/api/v1/orders/*", async (route) => {
    if (server.loseRead) {
      server.loseRead = false;
      await route.fulfill({
        status: 500,
        json: {
          code: "INTERNAL_ERROR",
          message: "Internal error",
          details: {},
        },
      });
      return;
    }
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({
      json: server.orders.find((each) => each.id === id),
    });
  });
  await page.route("**/api/v1/orders/*/dispatch", async (route) => {
    server.steps.push("dispatch");
    const id = new URL(route.request().url()).pathname.split("/").at(-2);
    const order = server.orders.find((each) => each.id === id);
    if (order) order.status = "DISPATCHED";
    await route.fulfill({ json: order });
  });
}

async function open(
  page: Page,
  server: Server,
  theme?: Record<string, string>,
): Promise<void> {
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
  await stub(page, server);
  await page.goto("about:blank");
  await page.goto(launch(theme ? { theme } : {}));
  await openStore(page, "Основний MAIN");
  await section(page, "+ Нове замовлення");
}

async function buzzes(page: Page): Promise<object[]> {
  const sent = await page.evaluate(
    () => (window as unknown as { buzzes: string[] }).buzzes,
  );
  return sent.map((data) => JSON.parse(data) as object);
}

function search(page: Page): Locator {
  return page.getByRole("searchbox", { name: "Знайти модель" });
}

function chip(page: Page, size: string, at = own): Locator {
  return page.locator(
    `button.chip[data-stock="${size}"][data-location="${at}"]`,
  );
}

function panel(page: Page): Locator {
  return page.locator(".pay-panel");
}

function press(page: Page): Locator {
  return panel(page).getByRole("button");
}

async function carrier(page: Page, name: string): Promise<void> {
  await page
    .getByRole("group", { name: "Перевізник" })
    .getByRole("button", { name, exact: true })
    .click();
}

async function pause(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (wait) =>
      new Promise((done) => {
        setTimeout(done, wait);
      }),
    ms,
  );
}

test("a new order as a sale: the cursor in the search, two letters find the model, its size a line at the store's price, «−»/«+» to what is free, the carrier a chip, one press under the thumb, the card says what it reserved (orders task list, P0-5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const stubbed = server();
  await open(page, stubbed);
  await expect(
    page.getByRole("heading", { name: "Нове замовлення", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "← До замовлень" }),
  ).toBeVisible();
  // One warehouse: named, not chosen; the cursor in the search at once.
  await expect(page.getByText("Склад: Свій", { exact: true })).toBeVisible();
  await expect(page.locator(".order-new").getByRole("combobox")).toHaveCount(0);
  await expect(search(page)).toBeFocused();
  // Nothing of the old form.
  for (const gone of [
    /Оберіть склад і товар/,
    /Вкажіть остаточну ціну/,
    /Номер накладної вписують/,
  ])
    await expect(page.getByText(gone)).toHaveCount(0);
  for (const gone of ["Додати товар", "Попередні товари", "Наступні товари"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  await expect(page.getByLabel("Кількість", { exact: true })).toHaveCount(0);
  // Nothing in it yet: no panel.
  await expect(panel(page)).toHaveCount(0);

  await search(page).fill("ло");
  await expect
    .poll(() => stubbed.reads.some((q) => q.includes("query=%D0%BB%D0%BE")))
    .toBe(true);
  await expect(page.getByRole("group", { name: "Мілан графіт" })).toHaveCount(
    0,
  );
  const tag = page.getByRole("group", { name: "Лоран шоколад" });
  await expect(tag.locator(".tag-price")).toHaveText("1 850,00 грн");
  // L all held for other orders: no line of it, said under the tag.
  await expect(chip(page, `${loran}:${sizeL}`)).toBeDisabled();
  await expect(tag.getByText("Ще 2 шт. у резерві замовлення")).toBeVisible();
  await page.screenshot({ path: "test-results/order-new-search.png" });
  await chip(page, `${loran}:${sizeM}`).click();

  const line = page
    .getByRole("group", { name: "У замовленні" })
    .locator(".line");
  await expect(line).toHaveCount(1);
  await expect(line.locator("strong")).toHaveText("Лоран шоколад · M");
  // The store's price, which the seller may change (В3 (а)).
  await expect(line.getByLabel("Ціна, грн")).toHaveValue("1850,00");
  await expect(
    line.getByText("Ціна продажу 1 850,00 грн. Домовилися про іншу — змініть."),
  ).toBeVisible();
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M",
  );
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Разом 1 850,00 грн",
  );
  // No carrier yet: the press asks for one.
  await expect(press(page)).toHaveText("Оберіть перевізника");
  await expect(press(page)).toBeDisabled();
  await expect(page.getByText("ТТН впишете, коли відправите.")).toBeVisible();

  // «+» to what is free, three; its chip then takes no more.
  const more = line.getByRole("button", { name: "Більше" });
  await more.click();
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M × 2",
  );
  await chip(page, `${loran}:${sizeM}`).click();
  await expect(line.locator("output")).toHaveText("3");
  await expect(more).toBeDisabled();
  await expect(chip(page, `${loran}:${sizeM}`)).toBeDisabled();
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Разом 5 550,00 грн",
  );
  await line.getByRole("button", { name: "Менше" }).click();
  await line.getByRole("button", { name: "Менше" }).click();
  await expect(line.getByRole("button", { name: "Менше" })).toBeDisabled();

  await carrier(page, "Нова пошта");
  await expect(
    page
      .getByRole("group", { name: "Перевізник" })
      .getByRole("button", { name: "Нова пошта" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(press(page)).toHaveText("Замовити та зарезервувати");
  // The three carriers in one row at 360 px, each its word on one line.
  const rows = new Set<number>();
  for (const each of await page
    .getByRole("group", { name: "Перевізник" })
    .getByRole("button")
    .all()) {
    const box = await each.boundingBox();
    expect(box?.height).toBeLessThanOrEqual(56);
    rows.add(Math.round(box?.y ?? -1));
  }
  expect(rows.size).toBe(1);
  // Under the thumb, 54 px at least, on the screen.
  await expect(press(page)).toBeInViewport({ ratio: 1 });
  expect((await press(page).boundingBox())?.height).toBeGreaterThanOrEqual(54);
  // The page keeps the panel's height free (`shared/panel.ts`): the
  // carriers never under it.
  const room = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--pay-panel-h"),
  );
  const height = (await panel(page).boundingBox())?.height ?? 0;
  expect(Math.abs(parseFloat(room) - height)).toBeLessThanOrEqual(1);
  const chips = page.getByRole("group", { name: "Перевізник" });
  await chips.scrollIntoViewIfNeeded();
  const over = await chips.boundingBox();
  const bar = await panel(page).boundingBox();
  expect(over && bar && over.y + over.height <= bar.y).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);

  await press(page).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Зарезервовано: 1 шт\. Чекає відправлення\.$/ }),
  ).toBeVisible();
  // The body as before, its keys and values.
  expect(stubbed.made).toEqual([
    {
      store_id: fixture.store_id,
      command_id: expect.any(String) as string,
      lines: [
        {
          product_variant_id: loran,
          size_id: sizeM,
          source_location_id: own,
          quantity: 1,
          unit_price: "1850.00",
          discount_amount: "0.00",
        },
      ],
      destination: "UKRAINE",
      carrier: "NOVA_POSHTA",
    },
  ]);
  // The card from its top, never from where the form's foot left the page.
  await expect(
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(page.getByText(/^Зарезервовано: 1 шт\./)).toBeInViewport({
    ratio: 1,
  });
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  await page.screenshot({ path: "test-results/order-new-reserved.png" });
});

test("a store with two warehouses: each chip says its own, the line leaves from the chip's (orders task list, P0-5; owner decision, 2026-10-17)", async ({
  page,
}) => {
  const stubbed = server({
    places: [place(own, "Свій"), place(shared, "Спільний")],
    rows: [row(), row({ location_id: shared, available_quantity: 2 })],
  });
  await open(page, stubbed);
  // Every warehouse at once, none chosen.
  await expect(page.getByText(/^Склад:/)).toHaveCount(0);
  await expect(chip(page, `${loran}:${sizeM}`, own)).toHaveText("M · Свій 3");
  await expect(chip(page, `${loran}:${sizeM}`, shared)).toHaveText(
    "M · Спільний 2",
  );
  expect(stubbed.reads.every((q) => !q.includes("location_id"))).toBe(true);
  await chip(page, `${loran}:${sizeM}`, shared).click();
  await expect(
    page.getByRole("group", { name: "У замовленні" }).locator(".line strong"),
  ).toHaveText("Лоран шоколад · M · Спільний");
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M · Спільний",
  );
  await carrier(page, "Укрпошта");
  await press(page).click();
  await expect(page.getByText(/^Зарезервовано: 1 шт\./)).toBeVisible();
  const lines = stubbed.made[0]?.lines as Record<string, unknown>[];
  expect(lines.map((each) => each.source_location_id)).toEqual([shared]);
  expect(stubbed.made[0]?.carrier).toBe("UKRPOSHTA");
});

test("a model with no price: its field empty and focused, the panel's sum a dash and its press held; 0,00 asked about, what is no price said; «Прибрати» takes the line out (orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await search(page).fill("мі");
  await chip(page, `${milan}:${sizeS}`).click();
  const line = page
    .getByRole("group", { name: "У замовленні" })
    .locator(".line");
  const price = line.getByLabel("Ціна, грн");
  await expect(price).toHaveValue("");
  await expect(price).toBeFocused();
  await expect(
    line.getByText(
      "Ціни продажу ще немає — впишіть домовлену. Ціну для всіх задає менеджер у «Залишках».",
    ),
  ).toBeVisible();
  await carrier(page, "Міст");
  await expect(panel(page).locator(".pay-total")).toHaveText("Разом —");
  await expect(press(page)).toHaveText("Замовити та зарезервувати");
  await expect(press(page)).toBeDisabled();
  await price.fill("15,5,5");
  await expect(
    line.getByText("Впишіть ціну: гривні й копійки, напр. 1850 або 1850,50."),
  ).toBeVisible();
  await expect(press(page)).toBeDisabled();
  await price.fill("0");
  await expect(
    line.getByText("Ціна 0,00 грн. Це справді подарунок? Перевірте ціну."),
  ).toBeVisible();
  await expect(press(page)).toBeEnabled();
  await price.fill("1700");
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Разом 1 700,00 грн",
  );
  await line.getByRole("button", { name: "Прибрати Мілан графіт · S" }).click();
  await expect(line).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  expect(stubbed.made).toEqual([]);
});

test("abroad: no carrier, how it went said when it is sent, the press at once; the body without a carrier (orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  // Within Ukraine unless said otherwise (owner decisions, 2026-10-01).
  await expect(
    page.getByRole("radio", { name: "По Україні", exact: true }),
  ).toBeChecked();
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Укрпошта");
  await page.getByRole("radio", { name: "За кордон", exact: true }).check();
  await expect(page.getByRole("group", { name: "Перевізник" })).toHaveCount(0);
  await expect(
    page.getByText("Куди і як відправили — впишете, коли відправите.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(press(page)).toHaveText("Замовити та зарезервувати");
  // Back within Ukraine: a carrier is asked again, none kept.
  await page.getByRole("radio", { name: "По Україні", exact: true }).check();
  await expect(press(page)).toHaveText("Оберіть перевізника");
  await page.getByRole("radio", { name: "За кордон", exact: true }).check();
  await press(page).click();
  await expect(page.getByText(/^Зарезервовано: 1 шт\./)).toBeVisible();
  expect(stubbed.made[0]?.destination).toBe("ABROAD");
  expect(stubbed.made[0]).not.toHaveProperty("carrier");
});

test("short of stock: the line the server names marked with what is free, focused, the rest as typed and the goods read again; changed, sent again (orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${milan}:${sizeS}`).click();
  await page
    .getByRole("group", { name: "У замовленні" })
    .locator(".line")
    .first()
    .getByLabel("Ціна, грн")
    .fill("1700");
  await chip(page, `${loran}:${sizeM}`).click();
  const lines = page
    .getByRole("group", { name: "У замовленні" })
    .locator(".line");
  await lines.nth(1).getByRole("button", { name: "Більше" }).click();
  await carrier(page, "Нова пошта");
  stubbed.refuse = {
    location_id: own,
    product_variant_id: loran,
    size_id: sizeM,
    requested: 2,
    available: 1,
    correctable: false,
    reserved: true,
  };
  const reads = stubbed.reads.length;
  await press(page).click();
  const note = lines
    .nth(1)
    .getByText("Доступно лише 1 шт. — решта в резерві інших замовлень.", {
      exact: true,
    });
  await expect(note).toBeFocused();
  await expect(lines.nth(1)).toHaveClass(/short/);
  await expect(lines.nth(0)).not.toHaveClass(/short/);
  // Said on its line, not over the page in other words.
  await expect(page.getByText(/Доступного товару вже недостатньо/)).toHaveCount(
    0,
  );
  // Nothing lost: both lines, as typed, and the carrier.
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0).getByLabel("Ціна, грн")).toHaveValue("1700");
  await expect(lines.nth(1).locator("output")).toHaveText("2");
  await expect(
    lines.nth(1).getByRole("button", { name: "Більше" }),
  ).toBeDisabled();
  await expect.poll(() => stubbed.reads.length).toBeGreaterThan(reads);
  await expect(press(page)).toHaveText("Замовити та зарезервувати");
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await page.screenshot({ path: "test-results/order-new-short.png" });
  // Another line's price changed: the short one still short, still said.
  await lines.nth(0).getByLabel("Ціна, грн").fill("1750");
  await expect(note).toBeVisible();
  // One fewer: the mark gone, and it is reserved.
  await lines.nth(1).getByRole("button", { name: "Менше" }).click();
  await expect(note).toHaveCount(0);
  await expect(lines.nth(1)).not.toHaveClass(/short/);
  await press(page).click();
  await expect(page.getByText(/^Зарезервовано: 2 шт\./)).toBeVisible();
  expect(stubbed.made).toHaveLength(2);
  expect(
    (stubbed.made[1]?.lines as Record<string, unknown>[]).map(
      (each) => each.quantity,
    ),
  ).toEqual([1, 1]);
});

test("short of stock with none free: said so, and to take the line out (orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  stubbed.refuse = {
    location_id: own,
    product_variant_id: loran,
    size_id: sizeM,
    requested: 1,
    available: 0,
    correctable: false,
    reserved: false,
  };
  await press(page).click();
  await expect(
    page.getByText("Доступних уже немає. Приберіть рядок.", { exact: true }),
  ).toBeFocused();
});

test("a shortfall's screen left: never said over the list, nor on the next new order (review, 2026-10-24)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  stubbed.refuse = {
    location_id: own,
    product_variant_id: loran,
    size_id: sizeM,
    requested: 1,
    available: 0,
    correctable: false,
    reserved: true,
  };
  await press(page).click();
  await expect(page.getByText(/^Доступних уже немає/)).toBeFocused();
  await page.getByRole("button", { name: "← До замовлень" }).click();
  await expect(
    page.getByRole("button", { name: "Нове замовлення" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Нове замовлення" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".order-lines")).toHaveCount(0);
});

test("refused for another reason: said over the page and brought to the finger, with its buzz; the lines and the carrier kept (orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  const line = page
    .getByRole("group", { name: "У замовленні" })
    .locator(".line");
  await line.getByRole("button", { name: "Більше" }).click();
  await carrier(page, "Міст");
  stubbed.fail = {
    status: 409,
    json: { code: "IDEMPOTENCY_CONFLICT", message: "Conflict", details: {} },
  };
  await press(page).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "Не записано: дані замовлення змінилися, поки ви працювали. Перевірте замовлення й спробуйте ще раз.",
  );
  await expect(alert).toBeFocused();
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await expect(line.locator("output")).toHaveText("2");
  await expect(
    page
      .getByRole("group", { name: "Перевізник" })
      .getByRole("button", { name: "Міст" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(press(page)).toBeEnabled();
  await expect(page.locator(".line.short")).toHaveCount(0);
});

test("a new order whose answer never came: checked again with the same command, it says what it reserved (orders task list, P0-5; review, 2026-10-24)", async ({
  page,
}) => {
  const stubbed = server({ lose: true });
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  await press(page).click();
  const retry = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  await expect(retry).toBeEnabled();
  // Which order: what is ordered and how it goes (P1-1).
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", {
      name: "Операцію «Резервування замовлення» ще не підтверджено",
    }),
  });
  await expect(banner).toContainText(
    "Лоран шоколад · M · Нова пошта — сервер не відповів. Двічі цю операцію не запишуть. Поки чекаємо, інші дії недоступні.",
  );
  // Kept, never refused: no buzz.
  expect(await buzzes(page)).toEqual([]);
  await retry.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Зарезервовано: 1 шт\. Чекає відправлення\.$/ }),
  ).toBeVisible();
  expect(stubbed.made).toHaveLength(2);
  expect(stubbed.made[1]?.command_id).toBe(stubbed.made[0]?.command_id);
  // Byte for byte, and nothing only shown in it (P1-1).
  expect(stubbed.made[1]).toEqual(stubbed.made[0]);
  expect(stubbed.made[0]).not.toHaveProperty("shown");
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
});

test("a new order answered whose reading failed: «Оновити результат» says what it reserved (review, 2026-10-24)", async ({
  page,
}) => {
  const stubbed = server({ loseRead: true });
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  await press(page).click();
  const again = page.getByRole("button", { name: "Оновити результат" });
  await expect(again).toBeEnabled();
  // Answered: recorded, only not yet shown (P1-1).
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", {
      name: "Операцію «Резервування замовлення» записано",
    }),
  });
  await expect(banner).toContainText(
    "Лоран шоколад · M · Нова пошта — замовлення ще не вдалося показати. Поки чекаємо, інші дії недоступні.",
  );
  await again.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Зарезервовано: 1 шт\. Чекає відправлення\.$/ }),
  ).toBeVisible();
  expect(stubbed.made).toHaveLength(1);
});

test("a new order is six taps, the search typed: «Клієнти», «Замовлення», «+», the size, the carrier and the press (orders task list, P0-5; navigation task list, P0-2: one more than from «Ще», 2 → 3 to the form)", async ({
  page,
}) => {
  const stubbed = server();
  await stub(page, stubbed);
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page.evaluate(() => {
    const host = window as unknown as { taps: number };
    host.taps = 0;
    document.addEventListener(
      "click",
      (event) => {
        if ((event.target as Element).closest("button")) host.taps += 1;
      },
      true,
    );
  });
  await section(page, "+ Нове замовлення");
  await search(page).fill("ло");
  await expect(page.getByRole("group", { name: "Мілан графіт" })).toHaveCount(
    0,
  );
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  await press(page).click();
  await expect(page.getByText(/^Зарезервовано: 1 шт\./)).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(6);
});

/** Clicks the card's «Відправлено» the moment it is drawn, as a double
 * tap's second half on «Замовити та зарезервувати» would land. */
async function tapAsDrawn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const watch = new MutationObserver(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(".order-panel button"),
      ].find((each) => each.textContent.trim() === "Відправлено");
      if (!button) return;
      watch.disconnect();
      button.click();
    });
    watch.observe(document.body, { childList: true, subtree: true });
  });
}

test("a double tap on «Замовити та зарезервувати» never sends the parcel: «Відправлено» drawn in its place lets that tap go (orders task list, P0-5; review, 2026-10-24)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  await tapAsDrawn(page);
  await press(page).click();
  await expect(page.locator(".order-panel button")).toHaveText("Відправлено");
  await pause(page, 300);
  expect(stubbed.steps).toEqual([]);
  // A moment later, as meant: sent.
  await pause(page, 600);
  await page.locator(".order-panel button").click();
  await expect.poll(() => stubbed.steps).toEqual(["dispatch"]);
});

test("«← До замовлень» goes back to the list, nothing sent (orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await page.getByRole("button", { name: "← До замовлень" }).click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Нове замовлення" }).first(),
  ).toBeVisible();
  expect(stubbed.made).toEqual([]);
});

async function contrast(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const rgb = (value: string): number[] =>
      (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]): number => {
      const channel = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel(r ?? 0) +
        0.7152 * channel(g ?? 0) +
        0.0722 * channel(b ?? 0)
      );
    };
    let ground: Element | null = node;
    let background = "rgba(0, 0, 0, 0)";
    while (ground) {
      background = getComputedStyle(ground).backgroundColor;
      const alpha = rgb(background)[3];
      if (alpha === undefined || alpha > 0) break;
      ground = ground.parentElement;
    }
    const fore = luminance(rgb(getComputedStyle(node).color));
    const back = luminance(rgb(background));
    return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
  });
}

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme a new order reads at 4.5:1, nothing wider than the phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page, server(), theme);
    await chip(page, `${loran}:${sizeM}`).click();
    await carrier(page, "Нова пошта");
    const carriers = page.getByRole("group", { name: "Перевізник" });
    for (const part of [
      page.getByRole("heading", { name: "Нове замовлення" }),
      page.locator(".tag-head strong").first(),
      chip(page, `${loran}:${sizeM}`),
      page.locator(".order-lines h3"),
      page.locator(".order-lines .line strong"),
      page.locator(".order-lines .line .hint").first(),
      page.locator(".way-switch input:checked + span"),
      page.locator(".way-switch label span").last(),
      carriers.getByRole("button", { name: "Нова пошта" }),
      carriers.getByRole("button", { name: "Укрпошта" }),
      panel(page).locator(".pay-what"),
      panel(page).locator(".pay-total"),
      press(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-new-${name}.png` });
  });
