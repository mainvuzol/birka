import {
  test,
  expect,
  basketDone,
  basketSheet,
  fillLine,
  fromPaper,
  openStore,
  sellsFrom,
} from "./fixtures";
import type { Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till's empty states and the first days' paper (sale-slice TZ, P1-5;
 * owner decisions, 2026-10-14 В1 (а), 2026-10-15 В2 and 2026-10-16):
 *
 * - a warehouse waiting for its opening list says to sell on paper, and
 *   offers nothing to sell;
 * - an empty warehouse, or a search that finds nothing, offers a coat in
 *   hand from the catalogue, sold through «Товар на місці»;
 * - the paper switch asks once which paper it is: the first days' is
 *   «з паперу», dated any of the last two weeks, with no word of an outage.
 *
 * The server is stubbed for the till's states, against the real API for the
 * coat found in the catalogue.
 */
test.use({ timezoneId: "Europe/Kyiv" });

const ids = {
  organization: "5d1a6b20-1b3d-4f5a-8c7e-9d0f1a2b3c01",
  user: "5d1a6b20-1b3d-4f5a-8c7e-9d0f1a2b3c02",
  store: "5d1a6b20-1b3d-4f5a-8c7e-9d0f1a2b3c03",
  shared: "5d1a6b20-1b3d-4f5a-8c7e-9d0f1a2b3c05",
  variant: "5d1a6b20-1b3d-4f5a-8c7e-9d0f1a2b3c06",
  size: "5d1a6b20-1b3d-4f5a-8c7e-9d0f1a2b3c07",
  other: "5d1a6b20-1b3d-4f5a-8c7e-9d0f1a2b3c08",
};
const coat = "Пальто «Затишок»";
const rights = [
  "sale:create",
  "sale:credit",
  "inventory:correct_during_sale",
  "inventory:receive",
];

function me(permissions: string[]): object {
  return {
    user_id: ids.user,
    organization_id: ids.organization,
    display_name: "Олена",
    organization_permissions: [],
    stores: [
      {
        id: ids.store,
        name: "Подільський",
        code: "POD",
        state: "ACTIVE",
        state_since: null,
        permissions,
      },
    ],
  };
}

function warehouse(waiting = false): object {
  return {
    id: ids.shared,
    name: "Спільний",
    code: "SHARED",
    is_active: true,
    can_sell: true,
    can_receive: true,
    damaged_returns: false,
    awaiting_first_stock: waiting,
  };
}

const onShelf = {
  product_variant_id: ids.variant,
  size_id: ids.size,
  display_name: coat,
  size_label: "M",
  size_is_unknown: false,
  quantity: 3,
  reserved_quantity: 0,
  available_quantity: 3,
  suggested_price: "3000.00",
};

interface Body {
  lines: { unit_price: string; quantity: number }[];
  payment_method?: string;
  outage?: Record<string, unknown>;
  found_in_store?: unknown[];
}

function receiptOf(body: Body): object {
  const total = body.lines
    .reduce((sum, line) => sum + Number(line.unit_price) * line.quantity, 0)
    .toFixed(2);
  const mark = body.outage as
    { sold_at: string | null; first_days?: boolean } | undefined;
  return {
    id: randomUUID(),
    store_id: ids.store,
    currency_code: "UAH",
    subtotal: total,
    discount_total: "0.00",
    total,
    items: body.lines.map((line) => ({
      ...line,
      id: randomUUID(),
      final_unit_price: line.unit_price,
      line_total: (Number(line.unit_price) * line.quantity).toFixed(2),
      display_name: coat,
      size: "M",
    })),
    corrections: [],
    shortages: [],
    size_reclassifications: [],
    credit: null,
    payment_method: body.payment_method ?? null,
    found_quantity: 0,
    missing_quantity: 0,
    clarified: [],
    outage: mark
      ? {
          sold_by_user_id: null,
          sold_by: null,
          sold_at: mark.sold_at ? `${mark.sold_at}:00` : null,
          first_days: mark.first_days === true,
        }
      : null,
  };
}

function launch(): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: '{"id":777000333,"first_name":"Олена"}',
    hash: "0".repeat(64),
  });
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

async function on(
  page: Page,
  path: string,
  handler: (route: Route) => Promise<void>,
): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/v1${path}`,
    (route) => handler(route),
  );
}

interface Server {
  sent: Body[];
  sale: (route: Route, body: Body) => Promise<void>;
}

/** The till of «Подільський», stubbed: one warehouse, its goods as told. */
async function serve(
  page: Page,
  {
    items = [onShelf],
    waiting = false,
    permissions = rights,
  }: { items?: object[]; waiting?: boolean; permissions?: string[] } = {},
): Promise<Server> {
  const server: Server = {
    sent: [],
    sale: async (route, body) => {
      await route.fulfill({ status: 201, json: receiptOf(body) });
    },
  };
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: route.request().url() },
    });
  });
  await on(page, "/client-errors", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await on(page, "/auth/telegram", async (route) => {
    await route.fulfill({ json: { access_token: "stubbed-session" } });
  });
  await on(page, "/me", async (route) => {
    await route.fulfill({ json: me(permissions) });
  });
  await on(page, "/stock-locations", async (route) => {
    await route.fulfill({ json: [warehouse(waiting)] });
  });
  await on(page, "/catalog/stock-options", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    await route.fulfill({
      json: { items: query ? [] : items, has_more: false },
    });
  });
  await on(page, `/stores/${ids.store}/sellers`, async (route) => {
    await route.fulfill({
      json: { sellers: [{ user_id: ids.user, display_name: "Олена" }] },
    });
  });
  await on(page, "/catalog/receivable-variants", async (route) => {
    await route.fulfill({
      json: {
        items: [{ product_variant_id: ids.other, display_name: "Лоран беж" }],
        has_more: false,
      },
    });
  });
  await on(page, "/catalog/sizes", async (route) => {
    await route.fulfill({
      json: [
        { size_id: ids.size, code: "M", system: "ALPHA" },
        { size_id: randomUUID(), code: "L", system: "ALPHA" },
      ],
    });
  });
  await on(page, "/catalog/prices", async (route) => {
    await route.fulfill({
      json: {
        product_variant_id: ids.other,
        currency_code: "UAH",
        shared_price: "2400.00",
        store_price: null,
        suggested_price: "2400.00",
        may_set_shared: false,
      },
    });
  });
  await on(page, "/sales", async (route) => {
    const body = route.request().postDataJSON() as Body;
    server.sent.push(body);
    await server.sale(route, body);
  });
  return server;
}

async function openTill(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, /Подільський/);
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

function chip(page: Page): ReturnType<Page["locator"]> {
  return page.locator(
    `button.size-cell[data-stock="${ids.variant}:${ids.size}"]`,
  );
}

function pay(page: Page, way: string): ReturnType<Page["getByRole"]> {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: way });
}

/** The phone's own date `days` ago: the form's value and as a receipt
 * writes it. */
async function daysAgo(
  page: Page,
  days: number,
): Promise<{ value: string; shown: string }> {
  return page.evaluate((back) => {
    const at = new Date();
    at.setDate(at.getDate() - back);
    const two = (n: number): string => String(n).padStart(2, "0");
    return {
      value: `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
      shown: `${two(at.getDate())}.${two(at.getMonth() + 1)}`,
    };
  }, days);
}

test("a warehouse where nothing is recorded yet says to sell on paper, and offers nothing to sell", async ({
  page,
}) => {
  await serve(page, { waiting: true });
  await openTill(page);
  await expect(
    page.getByText(
      "На складі «Спільний» зараз немає товару в обліку. Поки власник не затвердить початкові залишки, продавайте на папері.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toHaveCount(0);
  await expect(page.getByText("Кошик порожній")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Знайти в каталозі" }),
  ).toHaveCount(0);
});

test("an empty warehouse names itself, and a coat in hand is found in the catalogue and sold through «Товар на місці»", async ({
  page,
}) => {
  const server = await serve(page, { items: [] });
  let first = true;
  server.sale = async (route, body) => {
    if (first) {
      first = false;
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Not enough stock for this operation",
          details: {
            location_id: ids.shared,
            product_variant_id: ids.other,
            size_id: ids.size,
            requested: 1,
            available: 0,
            correctable: true,
            reserved: false,
            recorded: false,
          },
        },
      });
      return;
    }
    await route.fulfill({ status: 201, json: receiptOf(body) });
  };
  await openTill(page);
  await expect(
    page.getByText("На складі «Спільний» зараз немає товару в обліку."),
  ).toBeVisible();
  await expect(
    page.getByText("Товар у руках, а в списку його немає?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Знайти в каталозі" }).click();

  const panel = page.getByRole("region", { name: "Товар з каталогу" });
  await expect(panel).toContainText(
    "На складі «Спільний» його немає в обліку.",
  );
  await panel.getByLabel("Пошук у каталозі").fill("лоран");
  await panel.getByRole("button", { name: "Знайти" }).click();
  await panel.getByRole("radio", { name: "Лоран беж" }).click();
  await panel
    .getByRole("group", { name: "Розмір: Лоран беж" })
    .getByRole("button", { name: "M", exact: true })
    .click();
  // In the basket at its price; the panel gives the list back.
  await expect(panel).toHaveCount(0);
  const line = (await basketSheet(page)).locator(".line").last();
  await expect(line).toContainText("Лоран беж · M");
  await expect(line.getByLabel("Ціна, грн")).toHaveValue("2400,00");
  await basketDone(page);

  await pay(page, "Готівка").click();
  await page
    .getByRole("button", { name: "Товар на місці — продати 1" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(server.sent).toHaveLength(2);
  expect(server.sent[0]?.found_in_store).toEqual([]);
  expect(server.sent[1]?.found_in_store).toEqual([
    { line_index: 0, quantity: 1 },
  ]);
  expect(server.sent[1]?.lines[0]).toMatchObject({
    product_variant_id: ids.other,
    size_id: ids.size,
    unit_price: "2400.00",
    quantity: 1,
  });
});

test("a search that finds nothing offers the catalogue; without the rights, or from paper, it is not offered", async ({
  page,
}) => {
  await serve(page);
  await openTill(page);
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("ябко");
  await expect(
    page.getByText("За «ябко» на складі «Спільний» нічого немає."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Знайти в каталозі" }),
  ).toBeVisible();
  // From paper nobody stands at the shelf: no coat in hand is found.
  await fromPaper(page);
  await expect(
    page.getByText("За «ябко» на складі «Спільний» нічого немає."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Знайти в каталозі" }),
  ).toHaveCount(0);
  // An open panel closes as the paper mode comes on.
  await page.getByLabel("Вношу продаж з паперу").uncheck();
  await page.getByRole("button", { name: "Знайти в каталозі" }).click();
  await expect(
    page.getByRole("region", { name: "Товар з каталогу" }),
  ).toBeVisible();
  await page.getByLabel("Вношу продаж з паперу").check();
  await expect(
    page.getByRole("region", { name: "Товар з каталогу" }),
  ).toHaveCount(0);

  await page.unrouteAll({ behavior: "wait" });
  await serve(page, {
    items: [],
    permissions: ["sale:create", "inventory:correct_during_sale"],
  });
  await page.goto("about:blank");
  await openTill(page);
  await expect(
    page.getByText("На складі «Спільний» зараз немає товару в обліку."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Знайти в каталозі" }),
  ).toHaveCount(0);
});

test("the paper switch asks which paper it is; the first days' is «з паперу», of a day picked within two weeks, with no word of an outage", async ({
  page,
}) => {
  const server = await serve(page);
  await openTill(page);
  await page.getByLabel("Вношу продаж з паперу").check();
  await expect(
    page.getByText("Оберіть, що вносите: позначка залишиться назавжди."),
  ).toBeVisible();
  await chip(page).click();
  // Nothing typed from paper is sent until the series says which it is.
  await expect(pay(page, "З паперу · Картка")).toBeDisabled();
  await expect(
    page.getByText("Оберіть угорі, що вносите з паперу."),
  ).toBeVisible();

  await page
    .getByRole("radio", { name: "Перші дні, до затвердження залишків" })
    .check();
  const band = page.getByRole("region", { name: "Режим: продаж з паперу" });
  await expect(band).toContainText(
    "Продаж позначать «з паперу». Він увійде в сьогоднішні продажі й у касу до наступного закриття.",
  );
  await expect(band).not.toContainText("збою");
  await expect(
    page.getByText(
      "Оплату вже взяли: натисніть, як оплатили. На терміналі нічого не проводьте.",
    ),
  ).toBeVisible();
  const day = page.getByLabel("День з паперу");
  // Two weeks: today and the thirteen days before it.
  const earliest = await daysAgo(page, 13);
  const today = await daysAgo(page, 0);
  await expect(day).toHaveAttribute("min", earliest.value);
  await expect(day).toHaveAttribute("max", today.value);
  await expect(page.getByLabel("Це було вчора")).toHaveCount(0);
  // A time without its day, or a day without its time: held, never guessed.
  const time = page.getByLabel("Час з паперу");
  await time.fill("12:30");
  // «Це було вчора» is an outage's: the first days pick their day.
  await expect(page.getByLabel("Це було вчора")).toHaveCount(0);
  await expect(page.getByText("Вкажіть день з паперу.")).toBeVisible();
  await expect(pay(page, "З паперу · Картка")).toBeDisabled();
  const written = await daysAgo(page, 9);
  await time.fill("");
  await day.fill(written.value);
  await expect(
    page.getByText(
      "Вкажіть і час з паперу або очистіть день: без часу день не запишеться.",
    ),
  ).toBeVisible();
  await expect(pay(page, "З паперу · Картка")).toBeDisabled();
  await time.fill("12:30");
  await pay(page, "З паперу · Картка").click();

  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(server.sent[0]?.outage).toEqual({
    sold_by_user_id: null,
    sold_at: `${written.value}T12:30`,
    first_days: true,
  });
  await expect(
    page.getByText(`Продано з паперу · за папером ${written.shown}, 12:30`),
  ).toBeVisible();
  await expect(
    page.getByText("оплату вже провели, на терміналі не проводьте ще раз"),
  ).toBeVisible();
  await expect(page.getByText(/під час збою/)).toHaveCount(0);

  // The series stays the first days': the next sale's day is asked anew.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await expect(
    page.getByRole("radio", { name: "Перші дні, до затвердження залишків" }),
  ).toBeChecked();
  await expect(page.getByLabel("День з паперу")).toHaveValue("");
  await expect(page.getByLabel("Час з паперу")).toHaveValue("");
  await chip(page).click();
  await pay(page, "З паперу · Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(server.sent[1]?.outage).toEqual({
    sold_by_user_id: null,
    sold_at: null,
    first_days: true,
  });
});

test("an outage's paper is sent as it always was; a time too old is said for its kind; another kind, or a new series, asks anew", async ({
  page,
}) => {
  const server = await serve(page);
  await openTill(page);
  await fromPaper(page);
  const band = page.getByRole("region", { name: "Режим: продаж з паперу" });
  await expect(band).toContainText("Продаж позначать «продано під час збою».");
  await expect(page.getByLabel("День з паперу")).toHaveCount(0);
  await chip(page).click();
  await pay(page, "З паперу · Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(server.sent[0]?.outage).toEqual({
    sold_by_user_id: null,
    sold_at: null,
  });
  await expect(page.getByText(/^Продано під час збою/)).toBeVisible();

  // The server refuses a time too old by the days it takes back: one for
  // an outage's paper, thirteen for the first days'.
  server.sale = async (route, body) => {
    const mark = body.outage as { sold_at: string; first_days?: boolean };
    await route.fulfill({
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "too old",
        details: {
          reason: "OUTAGE_TIME_TOO_OLD",
          days: mark.first_days === true ? 13 : 1,
          sold_at: mark.sold_at,
          recorded: false,
        },
      },
    });
  };
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await chip(page).click();
  const time = page.getByLabel("Час з паперу");
  await time.fill("23:10");
  await page.getByLabel("Це було вчора").check();
  await pay(page, "З паперу · Готівка").click();
  await expect(
    page.getByText(
      "Час з паперу можна вказати лише за сьогодні або вчора. Для давнішого продажу залиште час порожнім. Кошик збережено — нічого не продано.",
    ),
  ).toBeVisible();

  // Another kind: the day and time are asked anew.
  await page
    .getByRole("radio", { name: "Перші дні, до затвердження залишків" })
    .check();
  await expect(time).toHaveValue("");
  await expect(page.getByLabel("Це було вчора")).toHaveCount(0);
  const old = await daysAgo(page, 14);
  await page.getByLabel("День з паперу").fill(old.value);
  await time.fill("10:00");
  await fillLine(page, {});
  await pay(page, "З паперу · Готівка").click();
  await expect(
    page.getByText(
      "Час з паперу перших днів можна вказати лише за останні 14 днів. Для давнішого залиште час порожнім. Кошик збережено — нічого не продано.",
    ),
  ).toBeVisible();
  expect(server.sent.at(-1)?.outage).toEqual({
    sold_by_user_id: null,
    sold_at: `${old.value}T10:00`,
    first_days: true,
  });

  // Unticked and ticked again: a new series, which is asked again.
  await page.getByLabel("Вношу продаж з паперу").uncheck();
  await page.getByLabel("Вношу продаж з паперу").check();
  await expect(
    page.getByRole("radio", { name: "Перші дні, до затвердження залишків" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Сервер не відповідав" }),
  ).not.toBeChecked();
  await chip(page).click();
  await expect(pay(page, "З паперу · Готівка")).toBeDisabled();
});

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  till_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

/** «Оля», signed by the test bot's token, as Telegram signs a launch. */
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

test("against the real API: a coat the books hold none of, found in the catalogue, sells once «Товар на місці» says it is there", async ({
  page,
}) => {
  // A model created and never received: the till's list never shows it.
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const bearer = ((await auth.json()) as { access_token: string }).access_token;
  const name = `Руки ${randomUUID().slice(0, 8)}`;
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

  await sellsFrom(page, fixture.till_location_id);
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill(name);
  await page.getByRole("button", { name: "Знайти в каталозі" }).click();
  const panel = page.getByRole("region", { name: "Товар з каталогу" });
  await panel.getByLabel("Пошук у каталозі").fill(name);
  await panel.getByRole("button", { name: "Знайти" }).click();
  await panel.getByRole("radio", { name: new RegExp(name) }).click();
  await panel.getByRole("button", { name: "M", exact: true }).click();
  await fillLine(page, { price: "1500" });
  await pay(page, "Готівка").click();
  await page
    .getByRole("button", { name: "Товар на місці — продати 1" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByText("Знайдене на полиці додано в облік: 1 шт."),
  ).toBeVisible();
});
