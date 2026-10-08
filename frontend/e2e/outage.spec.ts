import { test, expect } from "./fixtures";
import type { Page, Request, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The server is unreachable (owner decisions, 2026-10-04 and 2026-10-07;
 * ADR-0013): the shop sells on paper and types it in once the server
 * answers.
 *
 * - Every screen says so in the owner's words when no answer came, and an
 *   error of the app's own code never does.
 * - A kept operation is checked by the phone itself: once when the server
 *   comes back, and once when the app is opened again — the identical
 *   attempt, never a new one, and never in a loop.
 * - A sale typed from paper carries the mark «продано під час збою», with
 *   who sold and the paper's time, and offers nothing that describes the
 *   shelf now. A live sale is untouched.
 * - A kept sale, debt payment or «Клієнт забрав» refused on resend says what
 *   to do with the customer's goods or money.
 *
 * The server is played with stubs, as `failures.spec.ts` does: its answers
 * are another part's work. Kyiv's clock, as the shops': "yesterday" on paper
 * is a day in the store's zone.
 */
test.use({ timezoneId: "Europe/Kyiv" });

const UNREACHABLE =
  "Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.";

// A person nobody else's journey knows, signed in by stubs alone.
const telegramId = "777000222";
const ids = {
  organization: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c01",
  user: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c02",
  store: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c03",
  own: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c04",
  shared: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c05",
  variant: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c06",
  size: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c07",
  unknownSize: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c08",
  colleague: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c09",
  credit: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c0a",
  sale: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c0b",
};
const person = "Олена Шевчук";
const colleague = "Марина Коваль";
const saleKey = `birka:sale-pending:${ids.organization}:${ids.user}:${ids.store}`;
const creditKey = `birka:credit-pending:${ids.organization}:${ids.user}:${ids.store}`;
const orderKey = `birka:pending:${ids.organization}:${ids.user}:${ids.store}`;
const coat = "Пальто «Затишок»";

const me = {
  user_id: ids.user,
  organization_id: ids.organization,
  display_name: person,
  organization_permissions: [],
  stores: [
    {
      id: ids.store,
      name: "Подільський",
      code: "POD",
      state: "ACTIVE",
      state_since: null,
      permissions: [
        "sale:create",
        "sale:credit",
        "inventory:correct_during_sale",
        "inventory:report_missing_during_sale",
        "inventory:receive",
        "cash:close",
      ],
    },
  ],
};

function warehouse(id: string, name: string): object {
  return {
    id,
    name,
    code: name.toUpperCase(),
    is_active: true,
    can_sell: true,
    can_receive: true,
    damaged_returns: false,
  };
}

const stockItems = [
  {
    product_variant_id: ids.variant,
    size_id: ids.size,
    display_name: coat,
    size_label: "M",
    size_is_unknown: false,
    quantity: 3,
    reserved_quantity: 0,
    available_quantity: 3,
    suggested_price: "3000.00",
  },
  {
    product_variant_id: ids.variant,
    size_id: ids.unknownSize,
    display_name: coat,
    size_label: "?",
    size_is_unknown: true,
    quantity: 1,
    reserved_quantity: 0,
    available_quantity: 1,
    suggested_price: "3000.00",
  },
];

interface SaleBody {
  lines: { unit_price: string; quantity: number }[];
  payment_method?: string;
  outage?: { sold_by_user_id: string | null; sold_at: string | null };
  found_in_store?: unknown[];
}

/** The server's receipt for `body`, as `POST /sales` answers it. */
function receiptOf(body: SaleBody): object {
  const total = body.lines
    .reduce((sum, line) => sum + Number(line.unit_price) * line.quantity, 0)
    .toFixed(2);
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
      display_name: `${coat} · M`,
    })),
    corrections: [],
    shortages: [],
    size_reclassifications: [],
    credit: null,
    payment_method: body.payment_method ?? null,
    outage: body.outage
      ? {
          sold_by_user_id: body.outage.sold_by_user_id,
          sold_by:
            body.outage.sold_by_user_id === ids.colleague ? colleague : null,
          // The store's wall clock, read back in the phone's zone: the same.
          sold_at: body.outage.sold_at ? `${body.outage.sold_at}:00` : null,
        }
      : null,
  };
}

/** The app opened from Telegram by the stubbed person; nothing is checked. */
function launch(): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramId},"first_name":"Олена"}`,
    hash: "0".repeat(64),
  });
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

type Handler = (route: Route, request: Request) => Promise<void>;

/** Answers `path` under `/api/v1` (any query) with `handler`. */
async function on(page: Page, path: string, handler: Handler): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/v1${path}`,
    (route, request) => handler(route, request),
  );
}

/**
 * The whole server gone at once: from now on nothing under `/api/v1` gets an
 * answer, whatever the stubs say. Returns what was asked meanwhile, as
 * «GET /api/v1/…».
 */
async function gone(page: Page): Promise<string[]> {
  const asked: string[] = [];
  // Registered last, so it answers before every stub.
  await page.route("**/api/v1/**", async (route, request) => {
    asked.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.abort("connectionreset");
  });
  return asked;
}

const drawer = {
  store_id: ids.store,
  store_name: "Подільський",
  store_state: "ACTIVE",
  last_close: {
    id: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c10",
    number: 1,
    business_day: "2026-10-01",
    closed_at: "2026-10-01T18:00:00Z",
    closed_by: colleague,
    mine: false,
  },
  next_is_opening: false,
  closed_today: false,
  may_close: true,
  movement_kinds: [],
  may_correct: false,
  movements: [],
  unclosed_days: [],
  reason_owed: null,
};

interface Server {
  /** Every `POST /sales`, with its key and body as sent. */
  sales: { key: string | null; body: string }[];
  /** How many times `/ready` was asked. */
  readies: number;
  /** What `POST /sales` answers next: a receipt, by default. */
  sale: (route: Route, body: SaleBody) => Promise<void>;
  /** What `/ready` answers. */
  ready: "503" | "html" | "ok";
  /** What the drawer read does: no answer, or the server's own error. */
  drawer: "ok" | "lost" | "error";
  /** What the till's stock read does: a captive portal's page answers it. */
  stock: "ok" | "lost" | "portal";
}

/** A captive portal's page, answering for the server with a 200. */
const portal = {
  status: 200,
  contentType: "text/html",
  body: "<html><body>Увійдіть у мережу Wi-Fi</body></html>",
};

/**
 * The server, stubbed: a seller of «Подільський» with the default rights,
 * one warehouse or two, and a readiness that says not ready until told.
 */
async function serve(
  page: Page,
  warehouses: object[] = [warehouse(ids.shared, "Спільний")],
): Promise<Server> {
  const server: Server = {
    sales: [],
    readies: 0,
    sale: async (route, body) => {
      await route.fulfill({ status: 201, json: receiptOf(body) });
    },
    ready: "503",
    drawer: "ok",
    stock: "ok",
  };
  // Anything not stubbed below is a mistake of the journey's.
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
    await route.fulfill({ json: me });
  });
  await on(page, "/stock-locations", async (route) => {
    await route.fulfill({ json: warehouses });
  });
  await on(page, "/catalog/stock-options", async (route) => {
    if (server.stock === "lost") await route.abort("connectionreset");
    else if (server.stock === "portal") await route.fulfill(portal);
    else await route.fulfill({ json: { items: stockItems, has_more: false } });
  });
  await on(page, "/catalog/sizes", async (route) => {
    await route.fulfill({
      json: [{ size_id: ids.size, code: "M", system: "ALPHA" }],
    });
  });
  await on(page, `/stores/${ids.store}/sellers`, async (route) => {
    await route.fulfill({
      json: {
        sellers: [
          { user_id: ids.colleague, display_name: colleague },
          { user_id: ids.user, display_name: person },
        ],
      },
    });
  });
  await on(page, "/cash/drawer", async (route) => {
    if (server.drawer === "lost") await route.abort("connectionreset");
    else if (server.drawer === "error")
      // The server answered, with a fault of its own code.
      await route.fulfill({
        status: 500,
        headers: { "X-Request-ID": "7d1e5b20-4c3a-4f6e-9a8b-0c1d2e3f4a5b" },
        json: { code: "INTERNAL_ERROR", message: "Внутрішня помилка сервера." },
      });
    else await route.fulfill({ json: drawer });
  });
  await on(page, "/ready", async (route) => {
    server.readies += 1;
    if (server.ready === "ok")
      await route.fulfill({ json: { status: "ready" } });
    else if (server.ready === "html") await route.fulfill(portal);
    else
      await route.fulfill({
        status: 503,
        json: { status: "not_ready", reason: "database" },
      });
  });
  await on(page, "/sales", async (route, request) => {
    server.sales.push({
      key: await request.headerValue("Idempotency-Key"),
      body: request.postData() ?? "",
    });
    await server.sale(route, request.postDataJSON() as SaleBody);
  });
  return server;
}

/** The app, its store, and the till. */
async function openTill(page: Page): Promise<void> {
  await page.goto(launch());
  await page.getByRole("button", { name: /Подільський/ }).click();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
}

/** One coat of size M in the basket at 3000,00 грн. */
async function basket(page: Page, size = ids.size): Promise<void> {
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${ids.variant}:${size}`);
  await page.getByLabel("Ціна за одиницю, грн").fill("3000");
  await page.getByRole("button", { name: "Додати в кошик" }).click();
}

function pay(page: Page, label: string) {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: label, exact: true });
}

/** A sale whose answer never comes: the seller pressed, the server is gone. */
async function soldWithNoAnswer(
  page: Page,
  server: Server,
  way = "Готівка",
): Promise<void> {
  server.sale = async (route) => {
    await route.abort("connectionreset");
  };
  await pay(page, way).click();
  await expect(
    page.getByRole("heading", { name: "Незавершений продаж" }),
  ).toBeVisible();
}

/** «14:20» of the kept sale's `since`, as the phone shows it. */
async function keptSince(page: Page): Promise<string> {
  return page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as {
      since?: string;
    };
    return new Date(saved.since ?? "").toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, saleKey);
}

/** Puts entries in the phone's storage, as an earlier visit left them. */
async function seed(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  // Outside Telegram the app only asks to be opened from the bot.
  await page.goto("/");
  await page.evaluate((saved) => {
    for (const [key, value] of Object.entries(saved))
      localStorage.setItem(key, value);
  }, entries);
  await page.goto("about:blank");
}

/** A sale kept on the phone by an earlier visit, its answer never heard. */
function keptSale(way: string): string {
  return JSON.stringify({
    key: randomUUID(),
    ambiguous: true,
    since: new Date(Date.now() - 30 * 60_000).toISOString(),
    body: {
      store_id: ids.store,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: ids.variant,
          size_id: ids.size,
          source_location_id: ids.shared,
          quantity: 1,
          unit_price: "3000.00",
          discount_amount: "0.00",
        },
      ],
      found_in_store: [],
      missing_in_store: [],
      size_clarified: [],
      payment_method: way,
    },
  });
}

test.describe("1. the seller is told to sell on paper", () => {
  test("at sign-in, for 503, 502, 504 and no answer at all", async ({
    page,
  }) => {
    let answer: "502" | "503" | "504" | "lost" = "503";
    await page.route("**/api/v1/auth/telegram", async (route) => {
      if (answer === "lost") await route.abort("connectionreset");
      else if (answer === "503")
        // The server's own: its database does not answer (ADR-0013 §2).
        await route.fulfill({
          status: 503,
          headers: { "X-Request-ID": "3f9c2a7e-1b2c-4d5e-8f90-a1b2c3d4e5f6" },
          json: {
            code: "SERVER_UNAVAILABLE",
            message: "Сервер тимчасово недоступний.",
            details: { reason: "DATABASE" },
          },
        });
      // The edge's own: no body, no number.
      else await route.fulfill({ status: Number(answer) });
    });
    const said = page.getByRole("alert");
    const again = page.getByRole("button", { name: "Спробувати ще раз" });
    await page.goto(launch());
    await expect(
      page.getByRole("heading", { name: "Вхід через Telegram" }),
    ).toBeVisible();
    await expect(said).toHaveText(UNREACHABLE);
    for (const next of ["502", "504", "lost"] as const) {
      answer = next;
      await again.click();
      await expect(said).toHaveText(UNREACHABLE);
    }
  });

  test("at the till, whose stock read went unanswered, with «Повторити завантаження»", async ({
    page,
  }) => {
    const server = await serve(page);
    server.stock = "lost";
    await openTill(page);
    const failed = page.getByRole("alert");
    await expect(failed).toContainText(UNREACHABLE);
    await expect(
      failed.getByRole("button", { name: "Повторити завантаження" }),
    ).toBeVisible();

    server.stock = "ok";
    await failed
      .getByRole("button", { name: "Повторити завантаження" })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Товар і розмір", exact: true }),
    ).toBeVisible();
  });

  test("at the till, whose stock read a captive portal's page answered", async ({
    page,
  }) => {
    const server = await serve(page);
    server.stock = "portal";
    await openTill(page);
    const failed = page.getByRole("alert");
    await expect(failed).toContainText(UNREACHABLE);
    await expect(failed).not.toContainText("Не вдалося виконати операцію");
  });

  test("at «Каса», whose drawer read went unanswered, with how to close later", async ({
    page,
  }) => {
    const server = await serve(page);
    server.drawer = "lost";
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    const failed = page.getByRole("alert");
    await expect(failed).toContainText(UNREACHABLE);
    await expect(failed).toContainText(
      "Касу зараз не закрити: сервер не відповідає. Перерахуйте гроші й запишіть суму для себе. Якщо сервер відповість сьогодні — спершу внесіть усе з паперу, потім закрийте касу; якщо ні — закриєте наступного вечора.",
    );
    await expect(
      page.getByRole("button", { name: "Закрити касу" }),
    ).toHaveCount(0);
  });

  test("not at «Каса» when the server answered its drawer read with its own error", async ({
    page,
  }) => {
    const server = await serve(page);
    server.drawer = "error";
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    const failed = page.getByRole("alert");
    await expect(failed).toContainText(
      "Не вдалося виконати операцію. Спробуйте ще раз. Номер запиту: 7d1e5b20.",
    );
    await expect(failed).not.toContainText("Продавайте на папері");
    await expect(failed).not.toContainText("Касу зараз не закрити");
  });

  test("never for an error of the app's own code", async ({ page }) => {
    const server = await serve(page);
    await openTill(page);
    await basket(page);
    // An old web view's `crypto.randomUUID` that fails: a TypeError, as no
    // network is — and still not the connection's.
    await page.evaluate(() => {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: () => {
          throw new TypeError("crypto.randomUUID is not a function");
        },
      });
    });
    await pay(page, "Готівка").click();
    const said = page.getByRole("alert");
    await expect(said).toHaveText(
      "Не вдалося виконати операцію. Спробуйте ще раз. Кошик збережено — нічого не продано.",
    );
    await expect(said).not.toContainText("Продавайте на папері");
    expect(server.sales).toHaveLength(0);
  });
});

test.describe("2. a kept sale is checked by the phone itself", () => {
  test("once the server is back: the same sale under the same key, the time it began to wait kept, and a captive portal's page is no answer", async ({
    page,
  }) => {
    await page.clock.install();
    const server = await serve(page);
    await openTill(page);
    await basket(page);
    await soldWithNoAnswer(page, server);
    const banner = page.locator("section.notice", {
      has: page.getByRole("heading", { name: /продаж/ }),
    });
    const since = await keptSince(page);
    await expect(banner).toContainText(
      `Чекає відповіді сервера з ${since}. Запишіть цю операцію на папері з позначкою «у телефоні — ${person}» і не вносьте її з паперу: телефон перевірить її сам. Вносьте з паперу, лише якщо застосунок скаже «не записано».`,
    );

    // Ten seconds on, the phone asks whether the server is ready: not yet.
    await page.clock.fastForward("00:10");
    await expect.poll(() => server.readies).toBe(1);
    // Then every 20 s, never sooner: nineteen seconds on, still once.
    await page.waitForTimeout(300);
    await page.clock.runFor("00:19");
    await page.waitForTimeout(300);
    expect(server.readies).toBe(1);
    // A captive portal's 200 answers for the server: no answer either.
    server.ready = "html";
    await page.clock.runFor("00:01");
    await expect.poll(() => server.readies).toBe(2);
    // Two minutes later still: a time written again would show here.
    await page.clock.fastForward("02:00");
    await expect.poll(() => server.readies).toBe(3);
    expect(server.sales).toHaveLength(1);
    await expect(
      page.getByRole("heading", { name: "Незавершений продаж" }),
    ).toBeVisible();

    // The server is back, and the phone hears it: the sale is resent with
    // no tap. Held on its way, so the banner can be read meanwhile.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.sale = async (route, body) => {
      await held;
      await route.fulfill({ status: 201, json: receiptOf(body) });
    };
    server.ready = "ok";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.sales.length).toBe(2);
    await expect(banner).toContainText(`Чекає відповіді сервера з ${since}.`);
    release();
    await expect(
      page.getByRole("heading", { name: "Продаж підтверджено" }),
    ).toBeVisible();
    const [first, second] = server.sales;
    expect(second?.key).toBe(first?.key);
    expect(second?.body).toBe(first?.body);
    // The waiting time is the phone's own, beside the sale, never in it.
    expect(JSON.parse(first?.body ?? "{}")).not.toHaveProperty("since");
    expect(
      await page.evaluate((key) => localStorage.getItem(key), saleKey),
    ).toBeNull();

    // Settled: nothing more is sent, however long the phone waits.
    await page.clock.fastForward("01:00");
    await page.waitForTimeout(500);
    expect(server.sales).toHaveLength(2);
  });

  test("once per return: a resend answered with an error is not sent again", async ({
    page,
  }) => {
    const server = await serve(page);
    await openTill(page);
    await basket(page);
    await soldWithNoAnswer(page, server);

    // Back, but the resend meets a server error: an answer, so the server is
    // still reachable, and nothing is resent until it goes and comes back.
    server.sale = async (route) => {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Внутрішня помилка сервера." },
      });
    };
    server.ready = "ok";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => server.sales.length).toBe(2);
    await expect(
      page.getByText("Не вдалося виконати операцію. Спробуйте ще раз."),
    ).toBeVisible();
    // More answers come: the app shown again reads the till anew, and the
    // phone says it is online. None of them is a return.
    const reads = page.waitForResponse((response) =>
      response.url().includes("/api/v1/catalog/stock-options"),
    );
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      window.dispatchEvent(new Event("online"));
    });
    await reads;
    await page.waitForTimeout(1500);
    expect(server.sales).toHaveLength(2);
    await expect(
      page.getByRole("heading", { name: "Незавершений продаж" }),
    ).toBeVisible();

    // The whole server goes again, and the till's reads get no answer. Going
    // away is no return either: nothing is sent to a server that is gone.
    const asked = await gone(page);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    });
    await expect
      .poll(() => asked)
      .toContain("GET /api/v1/catalog/stock-options");
    await page.waitForTimeout(1500);
    expect(asked).not.toContain("POST /api/v1/sales");
    expect(server.sales).toHaveLength(2);
  });

  test("asked while something is kept, even when the server was already gone before it was", async ({
    page,
  }) => {
    await page.clock.install();
    const server = await serve(page, [
      warehouse(ids.own, "Свій"),
      warehouse(ids.shared, "Спільний"),
    ]);
    await openTill(page);
    const warehouses = page.getByRole("combobox", {
      name: "Склад",
      exact: true,
    });
    await warehouses.selectOption(ids.own);
    await basket(page);
    // The server goes before the press: a read of the other warehouse gets
    // no answer.
    server.stock = "lost";
    await warehouses.selectOption(ids.shared);
    await expect(page.getByRole("alert")).toContainText(UNREACHABLE);
    expect(server.readies).toBe(0);

    // Now a sale is kept as well: the phone starts asking.
    await soldWithNoAnswer(page, server);
    await page.clock.fastForward("00:10");
    await expect.poll(() => server.readies).toBe(1);
  });

  test("never asked while nothing is kept, however long the server is gone", async ({
    page,
  }) => {
    await page.clock.install();
    const server = await serve(page);
    server.stock = "lost";
    await openTill(page);
    await expect(page.getByRole("alert")).toContainText(UNREACHABLE);
    await page.clock.fastForward("00:10");
    await page.clock.fastForward("01:00");
    await page.waitForTimeout(1000);
    expect(server.readies).toBe(0);
  });

  test("a sale kept before the waiting time was written down is given none", async ({
    page,
  }) => {
    const kept = JSON.parse(keptSale("CASH")) as { since?: string };
    delete kept.since;
    await seed(page, { [saleKey]: JSON.stringify(kept) });
    const server = await serve(page);
    // Checked by itself on opening, and held until the till has read its
    // stock: an answer after the resend's failure would be a return.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.sale = async (route) => {
      await held;
      await route.abort("connectionreset");
    };
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByRole("combobox", { name: "Товар і розмір", exact: true }),
    ).toBeVisible();
    await expect.poll(() => server.sales.length).toBe(1);
    // Still no answer: kept, with no time it would wrongly claim to wait
    // since.
    release();
    const check = page.getByRole("button", {
      name: "Перевірити результат продажу",
    });
    await expect(check).toBeEnabled();
    const banner = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Незавершений продаж" }),
    });
    await expect(banner).toContainText(
      `Запишіть цю операцію на папері з позначкою «у телефоні — ${person}»`,
    );
    await expect(banner).not.toContainText("Чекає відповіді сервера");
    expect(
      await page.evaluate(
        (key) =>
          (JSON.parse(localStorage.getItem(key) ?? "{}") as { since?: string })
            .since,
        saleKey,
      ),
    ).toBeUndefined();
    expect(server.sales).toHaveLength(1);
  });

  test("once when the app is opened again, with no tap", async ({ page }) => {
    await seed(page, { [saleKey]: keptSale("CASH") });
    const server = await serve(page);
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByRole("heading", { name: "Продаж підтверджено" }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    expect(server.sales).toHaveLength(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), saleKey),
    ).toBeNull();
  });

  test("a card sale it confirms says not to charge the card twice", async ({
    page,
  }) => {
    await seed(page, { [saleKey]: keptSale("CARD") });
    const server = await serve(page);
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    const confirmed = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Продаж підтверджено" }),
    });
    await expect(confirmed).toContainText(
      "Якщо картку ще не провели — проведіть на терміналі 3000,00 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
    );
    await expect(confirmed).not.toContainText(
      /Проведіть на терміналі 3000,00 грн\./,
    );
    expect(server.sales).toHaveLength(1);
  });

  test("a card sale in parts it confirms says not to charge the part paid now twice", async ({
    page,
  }) => {
    const kept = JSON.parse(keptSale("CARD")) as {
      body: Record<string, unknown>;
    };
    kept.body.credit = {
      customer_name: "Оксана Петренко",
      customer_phone: "+380 67 123 45 67",
      paid_now: "1000.00",
    };
    await seed(page, { [saleKey]: JSON.stringify(kept) });
    const server = await serve(page);
    server.sale = async (route, body) => {
      await route.fulfill({
        status: 201,
        json: {
          ...receiptOf(body),
          credit: {
            credit_id: ids.credit,
            paid_now: "1000.00",
            owed: "2000.00",
          },
        },
      });
    };
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    const confirmed = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Продаж підтверджено" }),
    });
    await expect(confirmed).toContainText(
      "Оплата частинами: сплачено зараз 1000,00 грн карткою, покупець винен 2000,00 грн. Якщо картку ще не провели — проведіть на терміналі 1000,00 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
    );
    await expect(confirmed).not.toContainText(/Проведіть на терміналі/);
    expect(server.sales).toHaveLength(1);
  });
});

test.describe("3. a kept sale refused on resend settles the phone", () => {
  for (const refusal of [
    {
      name: "goods gone from the ledger",
      status: 409,
      json: {
        code: "INSUFFICIENT_STOCK",
        message: "Insufficient stock",
        details: {
          location_id: ids.shared,
          product_variant_id: ids.variant,
          size_id: ids.size,
          requested: 1,
          available: 0,
          correctable: true,
          reserved: false,
          recorded: false,
        },
      },
      reason:
        "цього товару вже немає в обліку — спершу попросіть менеджера виправити залишок",
    },
    {
      // A manager decides about the order, never the balance (owner
      // decision, 2026-10-07).
      name: "units reserved for an order meanwhile",
      status: 409,
      json: {
        code: "INSUFFICIENT_STOCK",
        message: "Insufficient stock",
        details: {
          location_id: ids.shared,
          product_variant_id: ids.variant,
          size_id: ids.size,
          requested: 1,
          available: 0,
          correctable: false,
          reserved: true,
          recorded: false,
        },
      },
      reason:
        "частина цих одиниць у резерві замовлення — спершу менеджер має вирішити із замовленням",
    },
    {
      name: "too few coats of no size to clarify",
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "Request failed validation",
        details: {
          reason: "SIZE_NOT_KNOWN_SHORT",
          available: 0,
          recorded: false,
        },
      },
      reason:
        "одиниць цієї моделі без розміру на складі менше, ніж треба уточнити (є 0). Зменшіть кількість або продайте товар без розміру",
    },
  ])
    test(`${refusal.name}: said, and nothing sold later`, async ({ page }) => {
      const server = await serve(page);
      await openTill(page);
      await basket(page);
      await soldWithNoAnswer(page, server);

      server.sale = async (route) => {
        await route.fulfill({ status: refusal.status, json: refusal.json });
      };
      await page
        .getByRole("button", { name: "Перевірити результат продажу" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Незавершений продаж" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          `Продаж не записано (${refusal.reason}). Якщо товар віддали покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати знову.`,
        ),
      ).toBeVisible();
      await expect(
        page.getByText("Перевірте дані та поточний статус замовлення."),
      ).toHaveCount(0);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), saleKey),
      ).toBeNull();
      await expect(
        page.getByRole("button", { name: "Змінити магазин" }),
      ).toBeEnabled();

      // The goods come in later, and the server comes back: the refused sale
      // is never sold.
      server.sale = async (route, body) => {
        await route.fulfill({ status: 201, json: receiptOf(body) });
      };
      server.ready = "ok";
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForTimeout(1000);
      expect(server.sales).toHaveLength(2);
    });
});

test("4. an offline phone never leaves «Повторити» waiting, and reads again by itself once online", async ({
  page,
  context,
}) => {
  const server = await serve(page, [
    warehouse(ids.own, "Свій"),
    warehouse(ids.shared, "Спільний"),
  ]);
  await openTill(page);
  const warehouses = page.getByRole("combobox", { name: "Склад", exact: true });
  await warehouses.selectOption(ids.own);
  const goods = page.getByRole("combobox", {
    name: "Товар і розмір",
    exact: true,
  });
  await expect(goods).toBeVisible();
  // Vite's development client reloads the whole page when its socket comes
  // back: this tells a page read again by itself from a page loaded anew.
  await page.evaluate(() => Object.assign(window, { samePage: 1 }));

  // The web view says it is offline, and nothing reaches the server: the
  // stubs answer whatever the browser's state, so they are told too.
  await context.setOffline(true);
  server.stock = "lost";
  await warehouses.selectOption(ids.shared);
  const failed = page.getByRole("alert");
  await expect(failed).toContainText(UNREACHABLE, { timeout: 3000 });
  await failed.getByRole("button", { name: "Повторити завантаження" }).click();
  await expect(failed).toContainText(UNREACHABLE, { timeout: 3000 });
  await expect(page.getByText("Завантажуємо товари…")).toHaveCount(0);

  server.stock = "ok";
  await context.setOffline(false);
  await expect(goods).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { samePage?: number }).samePage,
    ),
  ).toBe(1);
});

test("5. a live sale is untouched: no switch ticked, no mark sent, the three ways", async ({
  page,
}) => {
  const server = await serve(page);
  await openTill(page);
  await expect(page.getByLabel("Вношу продаж з паперу")).not.toBeChecked();
  await expect(page.getByText("Режим: продаж з паперу")).toHaveCount(0);
  await basket(page);
  const ways = page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button");
  await expect(ways).toHaveText(["Готівка", "Картка", "Переказ"]);
  await pay(page, "Картка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  const [sent] = server.sales;
  expect(JSON.parse(sent?.body ?? "{}")).not.toHaveProperty("outage");
  await expect(page.getByText("Продано під час збою")).toHaveCount(0);
  await expect(page.getByText(/Проведіть на терміналі/)).toBeVisible();
});

test("6. a sale typed from paper carries the mark, says who sold and from where, and the next one keeps the mode but not the time", async ({
  page,
}) => {
  const server = await serve(page);
  await openTill(page);
  await page.getByLabel("Вношу продаж з паперу").check();
  await expect(
    page.getByRole("heading", { name: "Режим: продаж з паперу" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Продаж позначать «продано під час збою». Він увійде в сьогоднішній «Звіт» і в касу до наступного закриття.",
    ),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Хто продав" })
    .selectOption({ label: colleague });
  await page.getByLabel("Час з паперу").fill("19:40");
  await page.getByLabel("Це було вчора").check();
  await basket(page);
  await expect(pay(page, "З паперу · Картка")).toBeVisible();
  await expect(
    page.getByText(`Продавець: ${colleague} · склад: Спільний`),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Оплату взяли під час збою: натисніть, як оплатили. На терміналі нічого не проводьте.",
    ),
  ).toBeVisible();
  await pay(page, "З паперу · Картка").click();

  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  const yesterday = await page.evaluate(() => {
    const at = new Date();
    at.setDate(at.getDate() - 1);
    return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  });
  const body = JSON.parse(server.sales[0]?.body ?? "{}") as SaleBody;
  expect(body.outage).toEqual({
    sold_by_user_id: ids.colleague,
    sold_at: `${yesterday}T19:40`,
  });
  expect(body.payment_method).toBe("CARD");
  const [, month = "", day = ""] = yesterday.split("-");
  await expect(
    page.getByText(
      `Продано під час збою · продавець: ${colleague} · за папером ${day}.${month}, 19:40`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "— оплату провели під час збою, на терміналі не проводьте ще раз",
    ),
  ).toBeVisible();
  await expect(page.getByText(/Проведіть на терміналі/)).toHaveCount(0);

  // The next paper sale of the series: the mode and who sold stay, the
  // paper's time and «вчора» do not.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await expect(
    page.getByRole("heading", { name: "Режим: продаж з паперу" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Хто продав" })).toHaveValue(
    ids.colleague,
  );
  await expect(page.getByLabel("Час з паперу")).toHaveValue("");
  await expect(page.getByLabel("Це було вчора")).toHaveCount(0);
  await basket(page);
  await pay(page, "З паперу · Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(
    (JSON.parse(server.sales[1]?.body ?? "{}") as SaleBody).outage,
  ).toEqual({ sold_by_user_id: ids.colleague, sold_at: null });
});

test("6b. the series ends when the switch is unticked, and when the store is left", async ({
  page,
}) => {
  await serve(page);
  await openTill(page);
  const paper = page.getByLabel("Вношу продаж з паперу");
  const who = page.getByRole("combobox", { name: "Хто продав" });
  await paper.check();
  await who.selectOption({ label: colleague });
  // Unticked and ticked again: a new series, nobody named yet.
  await paper.uncheck();
  await paper.check();
  await expect(who).toHaveValue("");

  // Leaving the store ends the series: back at its till, the switch is off.
  await who.selectOption({ label: colleague });
  await page.getByRole("button", { name: "Змінити магазин" }).click();
  await page.getByRole("button", { name: /Подільський/ }).click();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Товар і розмір", exact: true }),
  ).toBeVisible();
  await expect(paper).not.toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Режим: продаж з паперу" }),
  ).toHaveCount(0);
});

test("6c. a paper time with no «вчора» is today's, and «вчора» goes with a cleared time", async ({
  page,
}) => {
  const server = await serve(page);
  await openTill(page);
  await page.getByLabel("Вношу продаж з паперу").check();
  const time = page.getByLabel("Час з паперу");
  const yesterday = page.getByLabel("Це було вчора");
  await time.fill("00:05");
  await yesterday.check();
  // The time cleared and typed again: «вчора» is asked anew, unticked.
  await time.fill("");
  await expect(yesterday).toHaveCount(0);
  await time.fill("00:05");
  await expect(yesterday).not.toBeChecked();
  await basket(page);
  await pay(page, "З паперу · Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  const today = await page.evaluate(() => {
    const at = new Date();
    return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  });
  expect(
    (JSON.parse(server.sales[0]?.body ?? "{}") as SaleBody).outage,
  ).toEqual({ sold_by_user_id: null, sold_at: `${today}T00:05` });
});

test("6d. the pay buttons name the basket's warehouses, not the one chosen to look at", async ({
  page,
}) => {
  const server = await serve(page, [
    warehouse(ids.own, "Свій"),
    warehouse(ids.shared, "Спільний"),
  ]);
  await openTill(page);
  const warehouses = page.getByRole("combobox", { name: "Склад", exact: true });
  await warehouses.selectOption(ids.own);
  await page.getByLabel("Вношу продаж з паперу").check();
  await basket(page);
  // Another warehouse looked at: the coat still leaves from «Свій».
  await warehouses.selectOption(ids.shared);
  await expect(
    page.getByText("Продавець: не вказано · склад: Свій", { exact: true }),
  ).toBeVisible();
  // A second coat from there: both named.
  await basket(page);
  await expect(
    page.getByText("Продавець: не вказано · склади: Свій, Спільний", {
      exact: true,
    }),
  ).toBeVisible();
  await pay(page, "З паперу · Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  const body = JSON.parse(server.sales[0]?.body ?? "{}") as {
    lines: { source_location_id: string }[];
  };
  expect(body.lines.map((line) => line.source_location_id)).toEqual([
    ids.own,
    ids.shared,
  ]);
});

test.describe("7. a paper sale refused on stock offers no way around it", () => {
  const offers = [
    /Товар на місці/,
    /На полиці немає жодної/,
    /На місці фактично є/,
    /Це товар без розміру/,
  ];

  for (const shortfall of [
    {
      correctable: true,
      reserved: false,
      said: "Цього товару вже немає в обліку — продаж з паперу не записано. Попросіть менеджера спершу виправити залишок, потім внесіть цей продаж ще раз. Кошик збережено — нічого не продано.",
    },
    {
      correctable: false,
      reserved: false,
      said: "Цього товару вже немає в обліку — продаж з паперу не записано. Попросіть менеджера спершу виправити залишок, потім внесіть цей продаж ще раз. Кошик збережено — нічого не продано.",
    },
    {
      correctable: false,
      reserved: true,
      said: "Частина цих одиниць у резерві замовлення — продаж з паперу не записано. Менеджер має вирішити із замовленням, потім внесіть цей продаж ще раз. Кошик збережено — нічого не продано.",
    },
  ])
    test(`correctable ${String(shortfall.correctable)}, reserved ${String(shortfall.reserved)}`, async ({
      page,
    }) => {
      const server = await serve(page);
      server.sale = async (route) => {
        await route.fulfill({
          status: 409,
          json: {
            code: "INSUFFICIENT_STOCK",
            message: "Insufficient stock",
            details: {
              location_id: ids.shared,
              product_variant_id: ids.variant,
              size_id: ids.size,
              requested: 1,
              available: 0,
              correctable: shortfall.correctable,
              reserved: shortfall.reserved,
              recorded: false,
            },
          },
        });
      };
      await openTill(page);
      await page.getByLabel("Вношу продаж з паперу").check();
      await basket(page);
      await pay(page, "З паперу · Готівка").click();
      await expect(page.getByText(shortfall.said)).toBeVisible();
      for (const offer of offers)
        await expect(page.getByRole("button", { name: offer })).toHaveCount(0);
      await expect(page.getByLabel(/На місці фактично є/)).toHaveCount(0);
    });

  test("no size read off a label in paper mode", async ({ page }) => {
    await serve(page);
    await openTill(page);
    await page
      .getByRole("combobox", { name: "Товар і розмір", exact: true })
      .selectOption(`${ids.variant}:${ids.unknownSize}`);
    await expect(page.getByLabel("Розмір з етикетки")).toBeVisible();
    await page.getByLabel("Вношу продаж з паперу").check();
    await expect(page.getByLabel("Розмір з етикетки")).toHaveCount(0);
    await expect(
      page.getByText("Товар без розміру вносьте як «розмір невідомий»."),
    ).toBeVisible();
  });

  test("7b. unticking the switch clears the refused basket", async ({
    page,
  }) => {
    const server = await serve(page);
    server.sale = async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Insufficient stock",
          details: {
            location_id: ids.shared,
            product_variant_id: ids.variant,
            size_id: ids.size,
            requested: 1,
            available: 0,
            correctable: true,
            reserved: false,
            recorded: false,
          },
        },
      });
    };
    await openTill(page);
    await page.getByLabel("Вношу продаж з паперу").check();
    await basket(page);
    await pay(page, "З паперу · Готівка").click();
    await expect(page.getByText("Залишку не вистачає")).toBeVisible();

    await page.getByLabel("Вношу продаж з паперу").uncheck();
    await expect(page.getByText("Залишку не вистачає")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Прибрати ${coat}` }),
    ).toHaveCount(0);
    await expect(pay(page, "Готівка")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Товар на місці/ }),
    ).toHaveCount(0);
    expect(server.sales).toHaveLength(1);
  });

  test("7c. ticking the switch drops a live sale's question about the shelf", async ({
    page,
  }) => {
    const server = await serve(page);
    server.sale = async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Insufficient stock",
          details: {
            location_id: ids.shared,
            product_variant_id: ids.variant,
            size_id: ids.size,
            requested: 1,
            available: 0,
            correctable: true,
            reserved: false,
            recorded: false,
          },
        },
      });
    };
    await openTill(page);
    await basket(page);
    await pay(page, "Готівка").click();
    await expect(page.getByText("Залишку не вистачає")).toBeVisible();

    // The seller turns to the paper instead: the question about the shelf
    // goes, and nothing says a paper sale was refused.
    await page.getByLabel("Вношу продаж з паперу").check();
    await expect(page.getByText("Залишку не вистачає")).toHaveCount(0);
    await expect(page.getByText(/продаж з паперу не записано/)).toHaveCount(0);
    for (const offer of offers)
      await expect(page.getByRole("button", { name: offer })).toHaveCount(0);
    // The basket stays, for the paper's line.
    await expect(pay(page, "З паперу · Готівка")).toBeEnabled();
    expect(server.sales).toHaveLength(1);
  });
});

test.describe("8. the real server keeps the mark", () => {
  interface Fixture {
    network_owner_telegram_user_id: string;
    network_centre_seller_telegram_user_id: string;
    network_centre_cashier_telegram_user_id: string;
    network_centre_store_id: string;
    network_shared_location_id: string;
  }
  const fixture = JSON.parse(
    readFileSync(
      process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
      "utf8",
    ),
  ) as Fixture;

  /** Telegram's launch data for a person the seed knows, signed. */
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
    fields.set(
      "hash",
      createHmac("sha256", secret).update(check).digest("hex"),
    );
    return fields.toString();
  }

  /** The app, opened from Telegram by this person, at «Центр». Telegram's
   * first name is the name the app shows. */
  async function openAs(
    page: Page,
    telegramUserId: string,
    name: string,
  ): Promise<void> {
    // A change of the hash alone would not reload the app.
    await page.goto("about:blank");
    await page.goto(
      `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId, name) }).toString()}`,
    );
    await page.getByRole("button", { name: "Центр CENTRE" }).click();
  }

  async function headersOf(
    page: Page,
    telegramUserId: string,
    name: string,
  ): Promise<Record<string, string>> {
    const auth = await page.request.post("/api/v1/auth/telegram", {
      data: { init_data: initData(telegramUserId, name) },
    });
    const { access_token } = (await auth.json()) as { access_token: string };
    return { Authorization: `Bearer ${access_token}` };
  }

  /** One coat of a model of the journey's own, in the network's warehouse,
   * received by «Ганна». */
  async function coatAtCentre(
    page: Page,
  ): Promise<{ model: string; variant: string; size: string }> {
    const headers = await headersOf(
      page,
      fixture.network_centre_seller_telegram_user_id,
      "Ганна",
    );
    const model = `Збій ${randomUUID().slice(0, 8)}`;
    const created = await page.request.post("/api/v1/catalog/products", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        store_id: fixture.network_centre_store_id,
        concept: model,
        variant: { color: "графіт" },
        sizes: [{ system: "ALPHA", code: "M" }],
      },
    });
    expect(created.status()).toBe(201);
    const product = (await created.json()) as {
      product_variant_id: string;
      sizes: { size_id: string }[];
    };
    const size = product.sizes[0]?.size_id ?? "";
    const received = await page.request.post("/api/v1/inventory/receipts", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        store_id: fixture.network_centre_store_id,
        location_id: fixture.network_shared_location_id,
        command_id: randomUUID(),
        lines: [
          {
            product_variant_id: product.product_variant_id,
            size_id: size,
            quantity: 1,
            acquisition_type: "PURCHASE",
            unit_cost: null,
          },
        ],
        notes: null,
      },
    });
    expect(received.status()).toBe(201);
    return { model, variant: product.product_variant_id, size };
  }

  test("a sale typed by «Ліда» naming «Ганна» shows in «Звіт» as sold during the outage, with who sold, the paper's time and who typed it", async ({
    page,
  }) => {
    const coat = await coatAtCentre(page);

    // «Ліда» types yesterday's paper line: «Ганна» sold it at 19:40.
    await openAs(page, fixture.network_centre_cashier_telegram_user_id, "Ліда");
    await page.getByRole("button", { name: "Продаж", exact: true }).click();
    await page.getByLabel("Вношу продаж з паперу").check();
    await page
      .getByRole("combobox", { name: "Хто продав" })
      .selectOption({ label: "Ганна" });
    await page.getByLabel("Час з паперу").fill("19:40");
    await page.getByLabel("Це було вчора").check();
    await page
      .getByRole("combobox", { name: "Товар і розмір", exact: true })
      .selectOption(`${coat.variant}:${coat.size}`);
    await page.getByLabel("Ціна за одиницю, грн").fill("2500");
    await page.getByRole("button", { name: "Додати в кошик" }).click();
    await expect(page.getByText("Продавець: Ганна · склад:")).toBeVisible();
    const sold = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/sales") && r.request().method() === "POST",
    );
    await pay(page, "З паперу · Готівка").click();
    expect((await sold).status()).toBe(201);
    const yesterday = await page.evaluate(() => {
      const at = new Date();
      at.setDate(at.getDate() - 1);
      return `${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}`;
    });
    const mark = `Продано під час збою · продавець: Ганна · за папером ${yesterday}, 19:40`;
    await expect(page.getByText(mark)).toBeVisible();

    // The owner reads it in today's «Звіт»: sold by «Ганна», typed by
    // «Ліда», counted the day it was typed.
    await openAs(
      page,
      fixture.network_owner_telegram_user_id,
      "Власник мережі",
    );
    await page.getByRole("button", { name: "Звіт", exact: true }).click();
    const entry = page
      .getByRole("list", { name: "Продажі й повернення" })
      .getByRole("listitem")
      .filter({ hasText: coat.model });
    await expect(entry).toContainText(`${mark} · внесено: Ліда`);
    await expect(entry).toContainText("Продаж 2500,00 грн");
  });

  test("a kept sale refused by the real server for goods gone settles the phone, and says to type it from paper", async ({
    page,
  }) => {
    const coat = await coatAtCentre(page);
    const line = {
      product_variant_id: coat.variant,
      size_id: coat.size,
      source_location_id: fixture.network_shared_location_id,
      quantity: 1,
      unit_price: "2500.00",
      discount_amount: "0.00",
    };
    // «Ганна» sells the only coat meanwhile.
    const elsewhere = await page.request.post("/api/v1/sales", {
      headers: {
        ...(await headersOf(
          page,
          fixture.network_centre_seller_telegram_user_id,
          "Ганна",
        )),
        "Idempotency-Key": randomUUID(),
      },
      data: {
        store_id: fixture.network_centre_store_id,
        command_id: randomUUID(),
        lines: [line],
        payment_method: "CASH",
      },
    });
    expect(elsewhere.status()).toBe(201);
    // «Ліда»'s phone kept a sale of the same coat, its answer never heard.
    const who = (await (
      await page.request.get("/api/v1/me", {
        headers: await headersOf(
          page,
          fixture.network_centre_cashier_telegram_user_id,
          "Ліда",
        ),
      })
    ).json()) as { organization_id: string; user_id: string };
    const key = `birka:sale-pending:${who.organization_id}:${who.user_id}:${fixture.network_centre_store_id}`;
    await seed(page, {
      [key]: JSON.stringify({
        key: randomUUID(),
        ambiguous: true,
        body: {
          store_id: fixture.network_centre_store_id,
          command_id: randomUUID(),
          lines: [line],
          found_in_store: [],
          missing_in_store: [],
          size_clarified: [],
          payment_method: "CASH",
        },
      }),
    });
    // Checked by itself as the store opens: refused, recording nothing.
    const answered = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/sales") && r.request().method() === "POST",
    );
    await openAs(page, fixture.network_centre_cashier_telegram_user_id, "Ліда");
    const response = await answered;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details: { recorded: false },
    });
    await expect(
      page.getByText(
        "Продаж не записано (цього товару вже немає в обліку — спершу попросіть менеджера виправити залишок). Якщо товар віддали покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати знову.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Незавершений продаж" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate((name) => localStorage.getItem(name), key),
    ).toBeNull();
  });
});

test.describe("9. what to do with money after the outage", () => {
  test("«Каса»: the close form reminds to type the paper first, and one tap gives the reason", async ({
    page,
  }) => {
    await serve(page);
    const close = {
      ...drawer.last_close,
      id: "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c11",
      number: 2,
      business_day: "2026-10-08",
      closed_at: new Date().toISOString(),
      closed_by: person,
      mine: true,
      store_id: ids.store,
      store_name: "Подільський",
      opening: false,
      since: "2026-10-01T18:00:00Z",
      counted: "850.00",
      expected: "1000.00",
      difference: "-150.00",
      card: {
        came_in: "0.00",
        went_out: "0.00",
        corrected: "0.00",
        net: "0.00",
      },
      transfer: {
        came_in: "0.00",
        went_out: "0.00",
        corrected: "0.00",
        net: "0.00",
      },
      unclosed_days: [],
      reason: null,
      reason_by: null,
      reason_required: true,
      opening_float: null,
      cash_in: null,
      cash_out: null,
      taken_out: null,
      put_in: null,
      cash_corrected: null,
      prepaid_transfer: null,
      carrier_cod: null,
      not_stated: null,
      explained: null,
      unexplained: null,
      explanations: [],
    };
    await on(page, "/cash/closes", async (route) => {
      await route.fulfill({ status: 201, json: close });
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    await expect(
      page.getByText(
        "Якщо сервер не відповідав — спершу внесіть усе, що записали на папері, потім рахуйте касу.",
      ),
    ).toBeVisible();
    await page.getByLabel("Скільки готівки в касі зараз, грн").fill("850");
    await page.getByRole("button", { name: "Закрити касу" }).click();
    await page.getByRole("button", { name: "Так, закрити" }).click();
    const reason = page.getByLabel("Чому не збігається? (обов’язково)");
    await expect(reason).toBeVisible();
    await page.getByRole("button", { name: "Продаж під час збою" }).click();
    await expect(reason).toHaveValue("Продаж під час збою");
    await page
      .getByRole("button", { name: "Повернення чи внесок під час збою" })
      .click();
    await expect(reason).toHaveValue("Повернення чи внесок під час збою");
    // Words to edit, never a rule: the reason stays free text.
    await reason.fill("Продаж під час збою, 6 жовтня");
    await expect(reason).toHaveValue("Продаж під час збою, 6 жовтня");
  });

  test("«Каса»: a close whose answer was lost is marked on paper as kept on this phone, by whose it is", async ({
    page,
  }) => {
    await serve(page);
    await on(page, "/cash/closes", async (route) => {
      await route.abort("connectionreset");
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    await page.getByLabel("Скільки готівки в касі зараз, грн").fill("850");
    await page.getByRole("button", { name: "Закрити касу" }).click();
    await page.getByRole("button", { name: "Так, закрити" }).click();
    const banner = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Незавершена операція каси" }),
    });
    await expect(banner).toContainText(
      `Запишіть цю операцію на папері з позначкою «у телефоні — ${person}» і не вносьте її з паперу: телефон перевірить її сам.`,
    );
  });

  const credit = {
    id: ids.credit,
    sale_id: ids.sale,
    store_id: ids.store,
    store_name: "Подільський",
    store_state: "ACTIVE",
    customer_name: "Оксана Петренко",
    customer_phone: "+380 67 123 45 67",
    amount: "3000.00",
    currency_code: "UAH",
    status: "OPEN",
    paid: "1000.00",
    returned: "0.00",
    cash_back: "0.00",
    written_off: "0.00",
    owed: "2000.00",
    opened_at: "2026-10-01T10:00:00Z",
    last_payment_at: null,
    closed_at: null,
    goods: [coat],
    entries: [],
  };
  const notOwed = {
    code: "VALIDATION_ERROR",
    message: "Request failed validation",
    details: { reason: "NOT_OWED", recorded: false },
  };

  /** «Борги», stubbed: one customer, one debt; payments refused NOT_OWED. */
  async function debts(page: Page): Promise<string[]> {
    const payments: string[] = [];
    await on(page, "/credits/customers", async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              phone_digits: "0671234567",
              customer_name: credit.customer_name,
              customer_phone: credit.customer_phone,
              owed: credit.owed,
              open_debts: 1,
              credits: [credit],
            },
          ],
          has_more: false,
        },
      });
    });
    await on(page, "/credits/summary", async (route) => {
      await route.fulfill({
        json: { owed: "2000.00", customers: 1, debts: 1 },
      });
    });
    await on(page, `/credits/${ids.credit}`, async (route) => {
      // Paid off meanwhile, by a colleague.
      await route.fulfill({
        json: { ...credit, status: "SETTLED", paid: "3000.00", owed: "0.00" },
      });
    });
    await on(
      page,
      `/credits/${ids.credit}/payments`,
      async (route, request) => {
        payments.push(request.postData() ?? "");
        await route.fulfill({ status: 422, json: notOwed });
      },
    );
    return payments;
  }

  // The money goes back the way it came, never another: cash from the
  // drawer, a card through the terminal, a transfer by transfer (owner
  // decision, 2026-10-07; G9).
  for (const way of [
    {
      button: "Готівка",
      said: "За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю. Поки не повернули, вони зайві в касі: при закритті вкажіть причину.",
      more: "Це більше, ніж винні: залишок боргу 2000,00 грн. Прийміть 2000,00 грн, а решту поверніть покупцю.",
    },
    {
      button: "Картка",
      said: "За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю на картку через термінал. На касу це не впливає.",
      more: "Це більше, ніж винні: залишок боргу 2000,00 грн. Прийміть 2000,00 грн, а решту поверніть покупцю на картку через термінал.",
    },
    {
      button: "Переказ",
      said: "За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю переказом. На касу це не впливає.",
      more: "Це більше, ніж винні: залишок боргу 2000,00 грн. Прийміть 2000,00 грн, а решту поверніть покупцю переказом.",
    },
  ]) {
    test(`«Борги»: a payment by ${way.button} refused as not owed says to give the money back`, async ({
      page,
    }) => {
      await serve(page);
      await debts(page);
      await page.goto(launch());
      await page.getByRole("button", { name: /Подільський/ }).click();
      await page.getByRole("button", { name: "Борги", exact: true }).click();
      await page
        .getByRole("button", { name: /^Відкрити борг Оксана Петренко/ })
        .click();
      await page.getByLabel("Сума внеску, грн").fill("500");
      await page
        .getByRole("group", { name: "Внесок", exact: true })
        .getByRole("button", { name: way.button, exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveText(way.said);
    });

    test(`«Борги»: more than is owed by ${way.button} says to take what is owed and give the rest back`, async ({
      page,
    }) => {
      await serve(page);
      const payments = await debts(page);
      await page.goto(launch());
      await page.getByRole("button", { name: /Подільський/ }).click();
      await page.getByRole("button", { name: "Борги", exact: true }).click();
      await page
        .getByRole("button", { name: /^Відкрити борг Оксана Петренко/ })
        .click();
      await page.getByLabel("Сума внеску, грн").fill("2500");
      await page
        .getByRole("group", { name: "Внесок", exact: true })
        .getByRole("button", { name: way.button, exact: true })
        .click();
      await expect(page.getByRole("alert")).toHaveText(way.more);
      expect(payments).toEqual([]);
    });
  }

  for (const { status, meanwhile } of [
    { status: "CANCELLED", meanwhile: "cancelled the order" },
    { status: "RETURNED", meanwhile: "took the order back" },
  ])
    test(`«Клієнт забрав» kept, refused once another phone ${meanwhile}: typed as a paper sale at the order's prices`, async ({
      page,
    }) => {
      const order = "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c12";
      await seed(page, {
        [orderKey]: JSON.stringify({
          path: `/orders/${order}/collect`,
          body: { command_id: randomUUID(), payment_method: "CASH" },
          label: "Клієнт забрав",
          orderId: order,
          ambiguous: true,
        }),
      });
      await serve(page);
      const collects: string[] = [];
      await on(page, `/orders/${order}/collect`, async (route, request) => {
        collects.push(request.postData() ?? "");
        await route.fulfill({
          status: 422,
          json: {
            code: "VALIDATION_ERROR",
            message: "Invalid order transition",
            details: { status, action: "collect", recorded: false },
          },
        });
      });
      await page.goto(launch());
      await page.getByRole("button", { name: /Подільський/ }).click();
      await expect(
        page.getByText(
          "Замовлення вже скасовано або повернено — «Клієнт забрав» не записано. Якщо товар віддали — внесіть його як продаж з паперу, за цінами замовлення.",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Незавершена операція" }),
      ).toHaveCount(0);
      expect(collects).toHaveLength(1);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), orderKey),
      ).toBeNull();
    });

  test("«Борги»: a kept card payment the phone confirms says not to charge the card twice", async ({
    page,
  }) => {
    await seed(page, {
      [creditKey]: JSON.stringify({
        key: randomUUID(),
        ambiguous: true,
        body: {
          kind: "payment",
          store_id: ids.store,
          credit_id: ids.credit,
          command_id: randomUUID(),
          amount: "500.00",
          payment_method: "CARD",
        },
      }),
    });
    await serve(page);
    await debts(page);
    const payments: string[] = [];
    await on(
      page,
      `/credits/${ids.credit}/payments`,
      async (route, request) => {
        payments.push(request.postData() ?? "");
        await route.fulfill({
          status: 201,
          json: { ...credit, paid: "1500.00", owed: "1500.00" },
        });
      },
    );
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    const confirmed = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Внесок підтверджено" }),
    });
    await expect(confirmed).toContainText(
      "Його було записано один раз: 500,00 грн карткою. Оксана Петренко: залишок боргу 1500,00 грн. Якщо картку ще не провели — проведіть на терміналі 500,00 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
    );
    await expect(confirmed).not.toContainText(/Проведіть на терміналі/);
    expect(payments).toHaveLength(1);
  });

  test("«Борги»: a payment refused because the store that sold trades again says to pass the paper to a manager", async ({
    page,
  }) => {
    await serve(page);
    await debts(page);
    // Taken on paper here while the store that sold was blocked (G25).
    await on(page, `/credits/${ids.credit}/payments`, async (route) => {
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "The store that sold takes the payments while it trades",
          details: {
            reason: "PAID_WHERE_SOLD",
            store_id: ids.store,
            recorded: false,
          },
        },
      });
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await page.getByRole("button", { name: "Борги", exact: true }).click();
    await page
      .getByRole("button", { name: /^Відкрити борг Оксана Петренко/ })
      .click();
    await page.getByLabel("Сума внеску, грн").fill("500");
    await page
      .getByRole("group", { name: "Внесок", exact: true })
      .getByRole("button", { name: "Готівка", exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveText(
      "Магазин, де продали, знову працює — внесок приймає він. Передайте папір менеджеру.",
    );
  });

  test("«Борги»: a kept write-off refused on resend as not owed says the write-off was not recorded, with no money to give back", async ({
    page,
  }) => {
    await seed(page, {
      [creditKey]: JSON.stringify({
        key: randomUUID(),
        ambiguous: true,
        body: {
          kind: "write-off",
          store_id: ids.store,
          credit_id: ids.credit,
          command_id: randomUUID(),
          reason: "Покупець виїхав",
        },
      }),
    });
    await serve(page);
    await debts(page);
    const writeOffs: string[] = [];
    await on(
      page,
      `/credits/${ids.credit}/write-off`,
      async (route, request) => {
        writeOffs.push(request.postData() ?? "");
        await route.fulfill({ status: 422, json: notOwed });
      },
    );
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByText(
        "Списання не записано. За цим продажем уже нічого не винні.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Незавершений внесок" }),
    ).toHaveCount(0);
    expect(writeOffs).toHaveLength(1);
  });

  test("«Борги»: a kept transfer payment refused on resend as more than owed says to send the rest back by transfer", async ({
    page,
  }) => {
    await seed(page, {
      [creditKey]: JSON.stringify({
        key: randomUUID(),
        ambiguous: true,
        body: {
          kind: "payment",
          store_id: ids.store,
          credit_id: ids.credit,
          command_id: randomUUID(),
          amount: "500.00",
          payment_method: "TRANSFER",
        },
      }),
    });
    await serve(page);
    await debts(page);
    const payments: string[] = [];
    await on(
      page,
      `/credits/${ids.credit}/payments`,
      async (route, request) => {
        payments.push(request.postData() ?? "");
        await route.fulfill({
          status: 422,
          json: {
            code: "VALIDATION_ERROR",
            message: "Request failed validation",
            details: {
              reason: "MORE_THAN_OWED",
              owed: "300.00",
              recorded: false,
            },
          },
        });
      },
    );
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByText(
        "Внесок не записано. Це більше, ніж винні: залишок боргу 300,00 грн. Прийміть 300,00 грн, а решту поверніть покупцю переказом.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Незавершений внесок" }),
    ).toHaveCount(0);
    expect(payments).toHaveLength(1);
  });

  test("«Борги»: a kept payment refused on resend as not owed says the same, not an order's words", async ({
    page,
  }) => {
    await seed(page, {
      [creditKey]: JSON.stringify({
        key: randomUUID(),
        ambiguous: true,
        body: {
          kind: "payment",
          store_id: ids.store,
          credit_id: ids.credit,
          command_id: randomUUID(),
          amount: "500.00",
          payment_method: "CASH",
        },
      }),
    });
    await serve(page);
    const payments = await debts(page);
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    // Checked by itself on opening, and refused: settled.
    await expect(
      page.getByText(
        "За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю. Поки не повернули, вони зайві в касі: при закритті вкажіть причину.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Перевірте дані та поточний статус замовлення."),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Незавершений внесок" }),
    ).toHaveCount(0);
    expect(payments).toHaveLength(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), creditKey),
    ).toBeNull();
  });
});

test.describe("10. a kept operation the phone settles says what became of it", () => {
  const adjustmentKey = `birka:adjustment-pending:${ids.organization}:${ids.user}:${ids.store}`;
  const returnKey = `birka:return-pending:${ids.organization}:${ids.user}:${ids.store}`;
  const item = "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c13";

  /** «Подільський», where this person also holds `more`. */
  async function holding(page: Page, more: string[]): Promise<void> {
    await on(page, "/me", async (route) => {
      await route.fulfill({
        json: {
          ...me,
          stores: me.stores.map((store) => ({
            ...store,
            permissions: [...store.permissions, ...more],
          })),
        },
      });
    });
  }

  /** A stock correction kept on the phone, its answer never heard. */
  function keptAdjustment(body: object): string {
    return JSON.stringify({
      key: randomUUID(),
      ambiguous: true,
      since: new Date(Date.now() - 30 * 60_000).toISOString(),
      body: {
        store_id: ids.store,
        location_id: ids.shared,
        command_id: randomUUID(),
        product_variant_id: ids.variant,
        size_id: ids.size,
        note: null,
        ...body,
      },
    });
  }

  for (const refusal of [
    {
      name: "a count made against a balance that moved",
      kept: {
        quantity_delta: -2,
        reason_code: "STOCKTAKE",
        expected_quantity: 5,
      },
      code: "STOCK_CHANGED",
      details: { expected: 5, actual: 4 },
      said: "Коригування не записано. Поки ви рахували, облік змінився: було 5, тепер 4. Перерахуйте товар і введіть кількість ще раз.",
    },
    {
      name: "a write-off of more than is held",
      kept: {
        quantity_delta: -2,
        reason_code: "LOST",
        expected_quantity: null,
      },
      code: "INSUFFICIENT_STOCK",
      details: {},
      said: "Коригування не записано. В обліку вже менше, ніж ви списуєте. Залишки оновлено — перевірте кількість.",
    },
  ])
    test(`a kept stock correction refused on reopen, ${refusal.name}: said not recorded, and why`, async ({
      page,
    }) => {
      const stored = keptAdjustment(refusal.kept);
      await seed(page, { [adjustmentKey]: stored });
      await serve(page);
      await holding(page, ["inventory:view", "inventory:adjust"]);
      // The balances of the warehouse shown, read again once refused.
      let reads = 0;
      await on(page, "/catalog/stock-options", async (route) => {
        reads += 1;
        await route.fulfill({ json: { items: stockItems, has_more: false } });
      });
      // The server answers the resend once the warehouse is shown.
      let answer: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        answer = resolve;
      });
      const sent: { key: string | null; body: string }[] = [];
      await on(page, "/inventory/adjustments", async (route, request) => {
        sent.push({
          key: await request.headerValue("Idempotency-Key"),
          body: request.postData() ?? "",
        });
        await answered;
        await route.fulfill({
          status: 409,
          json: {
            code: refusal.code,
            message: "Refused",
            details: { ...refusal.details, recorded: false },
          },
        });
      });
      await page.goto(launch());
      await page.getByRole("button", { name: /Подільський/ }).click();
      // Checked by itself on opening, with no tap.
      await expect(
        page.getByRole("heading", { name: "Перевіряємо коригування…" }),
      ).toBeVisible();
      await page.getByLabel("Склад для перегляду").selectOption(ids.shared);
      await expect.poll(() => reads).toBe(1);
      answer();
      // Refused: settled, and said.
      await expect(page.getByText(refusal.said, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Незавершене коригування" }),
      ).toHaveCount(0);
      await expect(page.getByText("Коригування підтверджено")).toHaveCount(0);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), adjustmentKey),
      ).toBeNull();
      // The identical attempt, once.
      const kept = JSON.parse(stored) as { key: string; body: object };
      expect(sent).toEqual([
        { key: kept.key, body: JSON.stringify(kept.body) },
      ]);
      await expect.poll(() => reads).toBe(2);
      await expect(
        page.getByRole("button", { name: "Продаж", exact: true }),
      ).toBeEnabled();
    });

  test("a kept order step refused on resend says which was not recorded", async ({
    page,
  }) => {
    const order = "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c14";
    await seed(page, {
      [orderKey]: JSON.stringify({
        path: `/orders/${order}/dispatch`,
        body: { command_id: randomUUID() },
        label: "Відправлено",
        orderId: order,
        ambiguous: true,
      }),
    });
    await serve(page);
    const dispatches: string[] = [];
    await on(page, `/orders/${order}/dispatch`, async (route, request) => {
      dispatches.push(request.postData() ?? "");
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "Invalid order transition",
          details: { status: "CANCELLED", action: "dispatch", recorded: false },
        },
      });
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByText(
        "Операцію «Відправлено» не записано. Перевірте дані та поточний статус замовлення.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Незавершена операція" }),
    ).toHaveCount(0);
    expect(dispatches).toHaveLength(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), orderKey),
    ).toBeNull();
  });

  test("a kept order step whose resend meets a server error stays kept, and is never said not recorded", async ({
    page,
  }) => {
    const order = "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c15";
    await seed(page, {
      [orderKey]: JSON.stringify({
        path: `/orders/${order}/dispatch`,
        body: { command_id: randomUUID() },
        label: "Відправлено",
        orderId: order,
        ambiguous: true,
      }),
    });
    await serve(page);
    const dispatches: string[] = [];
    await on(page, `/orders/${order}/dispatch`, async (route, request) => {
      dispatches.push(request.postData() ?? "");
      // An answer that proves nothing: it may have been recorded.
      await route.fulfill({
        status: 500,
        headers: { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" },
        json: { code: "INTERNAL_ERROR", message: "Внутрішня помилка сервера." },
      });
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByText(
        "Не вдалося виконати операцію. Спробуйте ще раз. Номер запиту: 5a6b7c8d.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText(/«Відправлено» не записано/)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Незавершена операція" }),
    ).toBeVisible();
    expect(dispatches).toHaveLength(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), orderKey),
    ).not.toBeNull();
  });

  /** A return kept on the phone, its money going back `way`. */
  function keptReturn(way: string): string {
    return JSON.stringify({
      key: randomUUID(),
      ambiguous: true,
      since: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      body: {
        store_id: ids.store,
        sale_id: ids.sale,
        command_id: randomUUID(),
        lines: [
          {
            sale_item_id: item,
            quantity: 1,
            restock: true,
            condition: "INTACT",
          },
        ],
        reason: null,
        payment_method: way,
      },
    });
  }

  /** «Повернення», stubbed: no sales to list; returns answered by `answer`. */
  async function returns(
    page: Page,
    answer: (route: Route, way: string) => Promise<void>,
  ): Promise<string[]> {
    const sent: string[] = [];
    await holding(page, ["sale:refund", "sale:view"]);
    await on(page, "/sales", async (route) => {
      await route.fulfill({ json: { sales: [], has_more: false } });
    });
    await on(page, `/sales/${ids.sale}/refunds`, async (route, request) => {
      sent.push(request.postData() ?? "");
      const body = request.postDataJSON() as { payment_method: string };
      await answer(route, body.payment_method);
    });
    return sent;
  }

  async function recorded(route: Route, way: string): Promise<void> {
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        sale_id: ids.sale,
        store_id: ids.store,
        taken_at_store_id: null,
        total_amount: "3000.00",
        items: [
          {
            sale_item_id: item,
            quantity: 1,
            amount: "3000.00",
            condition: "INTACT",
            destination_location_id: ids.shared,
            display_name: `${coat} · M`,
          },
        ],
        credit: null,
        payment_method: way,
      },
    });
  }

  const ways = [
    {
      way: "CASH",
      live: "Поверніть покупцю 3000,00 грн готівкою.",
      said: "Якщо гроші ще не повернули — поверніть покупцю 3000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
    },
    {
      way: "CARD",
      live: "Поверніть 3000,00 грн на картку покупця через термінал.",
      said: "Якщо гроші ще не повернули — поверніть 3000,00 грн на картку покупця через термінал. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
    },
    {
      way: "TRANSFER",
      live: "Надішліть покупцю 3000,00 грн переказом.",
      said: "Якщо гроші ще не повернули — надішліть покупцю 3000,00 грн переказом. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
    },
  ];

  for (const { way, live, said } of ways)
    test(`a kept return by ${way} the phone confirms by itself says to give the money back only if nobody did`, async ({
      page,
    }) => {
      const stored = keptReturn(way);
      await seed(page, { [returnKey]: stored });
      await serve(page);
      const sent = await returns(page, recorded);
      await page.goto(launch());
      await page.getByRole("button", { name: /Подільський/ }).click();
      // Checked by itself on opening, with no tap, and recorded.
      await expect(
        page.getByRole("heading", { name: "Повернення оформлено" }),
      ).toBeVisible();
      await expect(page.getByText(said, { exact: true })).toBeVisible();
      await expect(page.getByText(live, { exact: true })).toHaveCount(0);
      await expect(
        page.getByText(
          "Його було записано один раз — повторно воно не пройде.",
        ),
      ).toBeVisible();
      expect(sent).toHaveLength(1);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), returnKey),
      ).toBeNull();
    });

  test("a kept return confirmed by its button says the same", async ({
    page,
  }) => {
    const { said, live } = ways[2] ?? { said: "", live: "" };
    await seed(page, { [returnKey]: keptReturn("TRANSFER") });
    await serve(page);
    // Checked on opening, and still being written by its first send: kept,
    // with no change in whether the server answers.
    let first = true;
    const sent = await returns(page, async (route, way) => {
      if (first) {
        first = false;
        await route.fulfill({
          status: 409,
          json: {
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: "An identical request is currently being processed",
          },
        });
      } else await recorded(route, way);
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByText(
        "Попередня спроба ще виконується. Зачекайте кілька секунд і перевірте результат.",
      ),
    ).toBeVisible();
    const check = page.getByRole("button", {
      name: "Перевірити результат повернення",
    });
    await expect(check).toBeEnabled();
    expect(sent).toHaveLength(1);
    await check.click();
    await expect(page.getByText(said, { exact: true })).toBeVisible();
    await expect(page.getByText(live, { exact: true })).toHaveCount(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  });

  test("a kept return of a sale paid in parts the phone confirms by itself says to give the cash back only if nobody did", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
    // The goods' worth lowered the debt, and what was paid beyond it goes
    // back in cash.
    await returns(page, async (route, way) => {
      await route.fulfill({
        status: 201,
        json: {
          id: randomUUID(),
          sale_id: ids.sale,
          store_id: ids.store,
          taken_at_store_id: null,
          total_amount: "3000.00",
          items: [
            {
              sale_item_id: item,
              quantity: 1,
              amount: "3000.00",
              condition: "INTACT",
              destination_location_id: ids.shared,
              display_name: `${coat} · M`,
            },
          ],
          credit: {
            debt_reduced: "2000.00",
            cash_back: "1000.00",
            owed_after: "0.00",
          },
          payment_method: way,
        },
      });
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByRole("heading", { name: "Повернення оформлено" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Якщо гроші ще не повернули — поверніть покупцю 1000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Поверніть покупцю 1000,00 грн готівкою.", {
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("a kept return refused on resend, part of it returned meanwhile, says so in «Повернення»'s words", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
    const sent = await returns(page, async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          code: "REFUND_EXCEEDS_SOLD",
          message: "Refund exceeds the quantity originally sold",
          details: { recorded: false },
        },
      });
    });
    await page.goto(launch());
    await page.getByRole("button", { name: /Подільський/ }).click();
    await expect(
      page.getByText(
        "Повернення не записано. Частину цього товару вже повернули. Поверніться до списку й оновіть продаж.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Незавершене повернення" }),
    ).toHaveCount(0);
    expect(sent).toHaveLength(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), returnKey),
    ).toBeNull();
  });
});
