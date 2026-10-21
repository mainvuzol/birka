import {
  test,
  expect,
  fillLine,
  fromPaper,
  openStore,
  section,
  tapSize,
  waitsFor,
} from "./fixtures";
import type { Locator, Page, Request, Route } from "@playwright/test";
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
  await openStore(page, /Подільський/);
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
}

/** One coat of size M in the basket at 3 000,00 грн. */
async function basket(page: Page, size = ids.size): Promise<void> {
  await tapSize(page, ids.variant, size);
  await fillLine(page, { price: "3000" });
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
    page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
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

/**
 * A kept command's check pressed while the server answers «not found»,
 * `before` of them already in a row — once, by the phone itself on opening,
 * by default: its words ask for a manager only at the third (owner
 * decision, 2026-10-19). `sent` counts what reached the server.
 */
async function thriceNotFound(
  check: Locator,
  sent: () => number,
  said: Locator,
  unconfirmed: string,
  before = 1,
): Promise<void> {
  const first = sent();
  for (let more = 1; more <= 3 - before; more += 1) {
    await check.click();
    await expect.poll(sent).toBe(first + more);
    await expect(check).toBeEnabled();
    await expect(said).toHaveText(
      before + more === 3
        ? `${unconfirmed} Зверніться до менеджера: нехай перевірить, чи записано.`
        : unconfirmed,
    );
  }
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

test("a kept sale the server answered, whose reading back failed, keeps the shared words: it is recorded (review, 2026-10-20)", async ({
  page,
}) => {
  const sale = randomUUID();
  const kept = JSON.parse(keptSale("CARD")) as Record<string, unknown>;
  await seed(page, {
    [saleKey]: JSON.stringify({ ...kept, acknowledged: true, saleId: sale }),
  });
  await serve(page);
  await on(page, `/sales/${sale}`, async (route) => {
    await route.fulfill({
      status: 500,
      headers: { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" },
      json: { code: "INTERNAL_ERROR", message: "Internal error" },
    });
  });
  await page.goto(launch());
  await openStore(page, /Подільський/);
  await expect(
    page.getByText(
      "Не вдалося виконати операцію. Спробуйте ще раз. Номер запиту: 5a6b7c8d.",
      { exact: true },
    ),
  ).toBeVisible();
  // The alert's words, not the banner's heading, which names it as before.
  await expect(
    page.getByRole("alert").filter({ hasText: /ще не підтверджено/ }),
  ).toHaveCount(0);
});

test("a kept sale a server fails to answer is still unconfirmed, and three «not found» in a row ask for a manager (owner decisions, 2026-10-19)", async ({
  page,
}) => {
  await seed(page, { [saleKey]: keptSale("CARD") });
  const server = await serve(page);
  let status = 500;
  server.sale = async (route) => {
    await route.fulfill({
      status,
      headers:
        status === 500
          ? { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }
          : {},
      json: {
        code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
        message: "Refused",
      },
    });
  };
  await page.goto(launch());
  await openStore(page, /Подільський/);
  const said = page.getByRole("alert");
  const unconfirmed =
    "Продаж ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі він не запишеться.";
  // Asked by itself on opening: a server's error, its number kept.
  await expect(said).toHaveText(`${unconfirmed} Номер запиту: 5a6b7c8d.`);
  const check = page.getByRole("button", {
    name: "Перевірити результат продажу",
  });
  status = 404;
  for (const asked of [2, 3]) {
    await check.click();
    await expect.poll(() => server.sales.length).toBe(asked);
    // Answered: the check is free again, and only then is it read.
    await expect(check).toBeEnabled();
    // Once and twice «not found»: still only unconfirmed.
    await expect(said).toHaveText(unconfirmed);
  }
  await check.click();
  await expect.poll(() => server.sales.length).toBe(4);
  await expect(check).toBeEnabled();
  // The third in a row: someone to look.
  await expect(said).toHaveText(
    `${unconfirmed} Зверніться до менеджера: нехай перевірить, чи записано.`,
  );
  // Any other answer begins the count again.
  status = 500;
  await check.click();
  await expect.poll(() => server.sales.length).toBe(5);
  await expect(check).toBeEnabled();
  await expect(said).toHaveText(`${unconfirmed} Номер запиту: 5a6b7c8d.`);
  status = 404;
  await check.click();
  await expect.poll(() => server.sales.length).toBe(6);
  await expect(check).toBeEnabled();
  await expect(said).toHaveText(unconfirmed);
});

test("a kept sale's «not found» count is kept when Telegram reopens the app: the third, across reopening, asks for a manager (owner decision, 2026-10-21)", async ({
  page,
}) => {
  await seed(page, { [saleKey]: keptSale("CARD") });
  const server = await serve(page);
  server.sale = async (route) => {
    await route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: "Refused" },
    });
  };
  await page.goto(launch());
  await openStore(page, /Подільський/);
  const said = page.getByRole("alert");
  const unconfirmed =
    "Продаж ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі він не запишеться.";
  // Asked by itself on opening, then by its button: twice «not found».
  await expect(said).toHaveText(unconfirmed);
  const check = page.getByRole("button", {
    name: "Перевірити результат продажу",
  });
  await check.click();
  await expect.poll(() => server.sales.length).toBe(2);
  await expect(check).toBeEnabled();
  await expect(said).toHaveText(unconfirmed);
  // Kept beside the sale, never in what is sent.
  const kept = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}") as unknown,
    saleKey,
  );
  expect(kept).toMatchObject({ misses: 2 });
  for (const sent of server.sales) expect(sent.body).not.toContain("misses");
  // Telegram closes the app and opens it again: the check it makes by
  // itself is the third in a row.
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, /Подільський/);
  await expect.poll(() => server.sales.length).toBe(3);
  await expect(said).toHaveText(
    `${unconfirmed} Зверніться до менеджера: нехай перевірить, чи записано.`,
  );
  // Each resend the same, byte for byte, under the same key.
  expect(
    new Set(server.sales.map((sent) => `${sent.key ?? ""}|${sent.body}`)).size,
  ).toBe(1);
});

test("a kept sale answered that the server did not take the request — a 400, or a 422 the shared words call «перевірте дані» — is still unconfirmed, in those words (owner decision, 2026-10-21)", async ({
  page,
}) => {
  await seed(page, { [saleKey]: keptSale("CARD") });
  const server = await serve(page);
  let status = 400;
  let reason: string | null = null;
  server.sale = async (route) => {
    await route.fulfill({
      status,
      headers: { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" },
      json: {
        code: status === 400 ? "BAD_REQUEST" : "VALIDATION_ERROR",
        message: "Refused",
        details: reason ? { reason } : {},
      },
    });
  };
  await page.goto(launch());
  await openStore(page, /Подільський/);
  const said = page.getByRole("alert");
  const notTaken =
    "Продаж ще не підтверджено: сервер не прийняв запит. Перевірте результат ще раз — двічі він не запишеться.";
  // A request's number is said for a server's own failure only.
  await expect(said).toHaveText(notTaken);
  const check = page.getByRole("button", {
    name: "Перевірити результат продажу",
  });
  status = 422;
  await check.click();
  await expect.poll(() => server.sales.length).toBe(2);
  await expect(check).toBeEnabled();
  await expect(said).toHaveText(notTaken);
  // A 422 with words of its own keeps them.
  reason = "CUSTOMER_PHONE";
  await check.click();
  await expect.poll(() => server.sales.length).toBe(3);
  await expect(check).toBeEnabled();
  await expect(said).toHaveText(
    "Телефон покупця має містити від 10 до 15 цифр.",
  );
  // Still kept: nothing proves it was not recorded.
  expect(
    await page.evaluate((key) => localStorage.getItem(key), saleKey),
  ).not.toBeNull();
});

test("a kept sale's banner says which sale it was: its sum and way, the part paid now, or no way for an attempt kept from before", async ({
  page,
}) => {
  const lost = async (route: Route): Promise<void> => {
    await route.abort("connectionreset");
  };
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
  });
  const waits =
    "сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.";

  // A line answered «на місці лише 1» of two sells one.
  const short = JSON.parse(keptSale("CARD")) as {
    body: { lines: { quantity: number }[]; missing_in_store: unknown[] };
  };
  const [line] = short.body.lines;
  if (line) line.quantity = 2;
  short.body.missing_in_store = [{ line_index: 0, quantity: 1 }];
  await seed(page, { [saleKey]: JSON.stringify(short) });
  let server = await serve(page);
  server.sale = lost;
  await page.goto(launch());
  await openStore(page, /Подільський/);
  await expect(banner).toContainText(
    `Продаж на 3 000,00 грн · Картка — ${waits}`,
  );
  // Not the old words, which named neither.
  await expect(banner).not.toContainText("Нові операції заблоковано");

  // Paid in parts: the part paid now.
  const parts = JSON.parse(keptSale("TRANSFER")) as {
    body: Record<string, unknown>;
  };
  parts.body.credit = {
    customer_name: "Оксана Петренко",
    customer_phone: "+380 67 123 45 67",
    paid_now: "1000.00",
  };
  await page.unrouteAll({ behavior: "wait" });
  await seed(page, { [saleKey]: JSON.stringify(parts) });
  server = await serve(page);
  server.sale = lost;
  await page.goto(launch());
  await openStore(page, /Подільський/);
  await expect(banner).toContainText(
    `Продаж частинами, зараз 1 000,00 грн · Переказ — ${waits}`,
  );

  // Kept from before the way was asked: no way named.
  const old = JSON.parse(keptSale("CASH")) as {
    body: Record<string, unknown>;
  };
  delete old.body.payment_method;
  await page.unrouteAll({ behavior: "wait" });
  await seed(page, { [saleKey]: JSON.stringify(old) });
  server = await serve(page);
  server.sale = lost;
  await page.goto(launch());
  await openStore(page, /Подільський/);
  await expect(banner).toContainText(`Продаж на 3 000,00 грн — ${waits}`);
  // Its own lines, by the person's own phone, as before (G17).
  await expect(banner).toContainText("Запишіть цю операцію на папері");

  // Figures that do not read never break the banner: the way alone.
  const odd = JSON.parse(keptSale("CARD")) as {
    body: { lines: Record<string, unknown>[] };
  };
  const [oddLine] = odd.body.lines;
  if (oddLine) oddLine.unit_price = 3000;
  await page.unrouteAll({ behavior: "wait" });
  await seed(page, { [saleKey]: JSON.stringify(odd) });
  server = await serve(page);
  server.sale = lost;
  await page.goto(launch());
  await openStore(page, /Подільський/);
  await expect(banner).toContainText(`Продаж · Картка — ${waits}`);
});

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

  test("at the till, whose stock read went unanswered, with «Спробувати ще раз»", async ({
    page,
  }) => {
    const server = await serve(page);
    server.stock = "lost";
    await openTill(page);
    const failed = page.getByRole("alert");
    await expect(failed).toContainText(UNREACHABLE);
    await expect(
      failed.getByRole("button", { name: "Спробувати ще раз" }),
    ).toBeVisible();

    server.stock = "ok";
    await failed.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect(
      page.getByRole("searchbox", { name: "Знайти модель" }),
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
    await openStore(page, /Подільський/);
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
    await openStore(page, /Подільський/);
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
      has: page.getByRole("heading", { name: /продаж/i }),
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
      page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
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
      page.getByRole("heading", { name: "Продаж записано один раз" }),
    ).toBeVisible();
    // Said once, with its way (redesign P1-4).
    await expect(
      page.getByText("Разом 3 000,00 грн готівкою.", {
        exact: true,
      }),
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
    // Still unconfirmed, never «спробуйте ще раз» (owner decision,
    // 2026-10-19).
    await expect(
      page.getByText(
        "Продаж ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі він не запишеться.",
        { exact: true },
      ),
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
      page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("searchbox", { name: "Знайти модель" }),
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
      has: page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("heading", { name: "Продаж записано один раз" }),
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
    await openStore(page, /Подільський/);
    const confirmed = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Продаж записано один раз" }),
    });
    await expect(confirmed).toContainText(
      "Разом 3 000,00 грн карткою. Якщо картку ще не провели — проведіть на терміналі 3 000,00 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
    );
    await expect(confirmed).not.toContainText(
      /Проведіть на терміналі 3\s000,00 грн\./,
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
    await openStore(page, /Подільський/);
    const confirmed = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Продаж записано один раз" }),
    });
    await expect(confirmed).toContainText(
      "Оплата частинами: сплачено зараз 1 000,00 грн карткою, покупець винен 2 000,00 грн. Якщо картку ще не провели — проведіть на терміналі 1 000,00 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
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
      // A conflict the till knows no more of: not «спробуйте ще раз», the
      // basket being gone (sale-slice TZ, P2-4).
      name: "a conflict the server names no more of",
      status: 409,
      json: {
        code: "CONFLICT",
        message: "Conflict",
        details: { recorded: false },
      },
      reason: "дані змінилися, поки сервер не відповідав",
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
        "одиниць цієї моделі з невідомим розміром на складі менше, ніж треба уточнити (є 0 шт.). Зменшіть кількість або продайте як «розмір невідомий»",
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
        page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          `Продаж не записано (${refusal.reason}). Якщо товар віддали покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати знову.`,
        ),
      ).toBeVisible();
      await expect(
        page.getByText("Перевірте товар, кількість і ціну."),
      ).toHaveCount(0);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), saleKey),
      ).toBeNull();
      // Settled: nothing holds the phone. Its person has one store, so its
      // sections say so (redesign P0-1).
      await expect(
        page.getByRole("button", { name: "Продаж", exact: true }),
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

test("4. an offline phone never leaves «Спробувати ще раз» waiting, and reads again by itself once online", async ({
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
  const goods = page.getByRole("searchbox", { name: "Знайти модель" });
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
  await failed.getByRole("button", { name: "Спробувати ще раз" }).click();
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
  await fromPaper(page);
  await expect(
    page.getByRole("heading", { name: "Режим: продаж з паперу" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Продаж позначать «продано під час збою». Він увійде в сьогоднішні продажі й у касу до наступного закриття.",
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
  // A second store to leave for: one store has nothing to change to
  // (redesign P0-1).
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      json: {
        ...me,
        stores: [
          ...me.stores,
          {
            id: "6a3c1f0e-0000-4000-8000-0000000000c3",
            name: "Ринок",
            code: "RIN",
            state: "ACTIVE",
            state_since: null,
            permissions: [],
          },
        ],
      },
    });
  });
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
  await openStore(page, /Подільський/);
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
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
  await fromPaper(page);
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
  await fromPaper(page);
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
    /Розмір з етикетки — продати як/,
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
      await fromPaper(page);
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
    await tapSize(page, ids.variant, ids.unknownSize);
    await expect(page.getByLabel("Розмір з етикетки")).toBeVisible();
    await fromPaper(page);
    await expect(page.getByLabel("Розмір з етикетки")).toHaveCount(0);
    // Owner decision, 2026-10-15 (В5): «без розміру» read as «безрозмірна».
    await expect(
      page.getByText(
        "Товар з невідомим розміром вносьте як «розмір невідомий».",
      ),
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
    await fromPaper(page);
    await basket(page);
    await pay(page, "З паперу · Готівка").click();
    await expect(page.getByText("Залишку не вистачає")).toBeVisible();

    await page.getByLabel("Вношу продаж з паперу").uncheck();
    await expect(page.getByText("Залишку не вистачає")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Прибрати ${coat}` }),
    ).toHaveCount(0);
    // An empty basket shows no ways at all (redesign direction §5).
    await expect(pay(page, "Готівка")).toHaveCount(0);
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
    await fromPaper(page);
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
    await openStore(page, "Центр CENTRE");
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
    await fromPaper(page);
    await page
      .getByRole("combobox", { name: "Хто продав" })
      .selectOption({ label: "Ганна" });
    await page.getByLabel("Час з паперу").fill("19:40");
    await page.getByLabel("Це було вчора").check();
    await tapSize(page, coat.variant, coat.size);
    await fillLine(page, { price: "2500" });
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
    await section(page, "Звіт");
    const entry = page
      .getByRole("list", { name: "Продажі й повернення" })
      .getByRole("listitem")
      .filter({ hasText: coat.model });
    await expect(entry).toContainText(`${mark} · внесено: Ліда`);
    await expect(entry).toContainText("Продаж 2 500,00 грн");
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
      page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
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
    await openStore(page, /Подільський/);
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
    await openStore(page, /Подільський/);
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    await page.getByLabel("Скільки готівки в касі зараз, грн").fill("850");
    await page.getByRole("button", { name: "Закрити касу" }).click();
    await page.getByRole("button", { name: "Так, закрити" }).click();
    const banner = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Незавершена операція каси" }),
    });
    await waitsFor(page, /Незавершена операція каси/);
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
      more: "Це більше, ніж винні: залишок боргу 2 000,00 грн. Прийміть 2 000,00 грн, а решту поверніть покупцю.",
    },
    {
      button: "Картка",
      said: "За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю на картку через термінал. На касу це не впливає.",
      more: "Це більше, ніж винні: залишок боргу 2 000,00 грн. Прийміть 2 000,00 грн, а решту поверніть покупцю на картку через термінал.",
    },
    {
      button: "Переказ",
      said: "За цим продажем уже нічого не винні — внесок не записано. Якщо гроші вже взяли, поверніть їх покупцю переказом. На касу це не впливає.",
      more: "Це більше, ніж винні: залишок боргу 2 000,00 грн. Прийміть 2 000,00 грн, а решту поверніть покупцю переказом.",
    },
  ]) {
    test(`«Борги»: a payment by ${way.button} refused as not owed says to give the money back`, async ({
      page,
    }) => {
      await serve(page);
      await debts(page);
      await page.goto(launch());
      await openStore(page, /Подільський/);
      await page.getByRole("button", { name: "Борги", exact: true }).click();
      await page
        .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
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
      await openStore(page, /Подільський/);
      await page.getByRole("button", { name: "Борги", exact: true }).click();
      await page
        .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
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
      await openStore(page, /Подільський/);
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
    await openStore(page, /Подільський/);
    // The payment's result, compact (credits task list, P1-2): the way alone
    // over the sum; the card charged only if nobody did.
    const confirmed = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Внесок записано один раз" }),
    });
    await expect(confirmed.locator(".way-pill")).toHaveText("Картка");
    await expect(confirmed.locator(".hand-back-sum")).toHaveText("500,00 грн");
    // The pill and the sum, heard (review, 2026-10-18).
    await expect(
      confirmed.getByText("Внесок 500,00 грн карткою.", { exact: true }),
    ).toBeAttached();
    await expect(confirmed).toContainText(
      "Оксана Петренко: залишок боргу 1 500,00 грн. Якщо картку ще не провели — проведіть на терміналі 500,00 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
    );
    await expect(confirmed).not.toContainText(/Проведіть на терміналі/);
    expect(payments).toHaveLength(1);
  });

  test("«Борги»: a kept card payment typed from paper the phone confirms never says to charge the card, and is resent with its mark", async ({
    page,
  }) => {
    const outage = { by_user_id: null, at: null };
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
          outage,
        },
      }),
    });
    await serve(page);
    await debts(page);
    const payments: unknown[] = [];
    await on(
      page,
      `/credits/${ids.credit}/payments`,
      async (route, request) => {
        payments.push(request.postDataJSON());
        await route.fulfill({
          status: 201,
          json: { ...credit, paid: "1500.00", owed: "1500.00" },
        });
      },
    );
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const confirmed = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Внесок записано один раз" }),
    });
    await expect(confirmed.locator(".badge.warn")).toHaveText(
      "Внесок під час збою",
    );
    await expect(confirmed).toContainText("Уже взяли під час збою");
    await expect(
      confirmed.getByText("Внесок з паперу 500,00 грн карткою.", {
        exact: true,
      }),
    ).toBeAttached();
    await expect(confirmed).toContainText(
      "Оплату провели під час збою, на терміналі не проводьте ще раз.",
    );
    await expect(confirmed).not.toContainText("Якщо картку ще не провели");
    await expect(confirmed).not.toContainText("Проведіть");
    expect(payments).toEqual([
      {
        command_id: expect.any(String) as string,
        amount: "500.00",
        payment_method: "CARD",
        outage,
      },
    ]);
  });

  for (const kept of [
    {
      what: "names its sum, way and goods",
      body: {
        kind: "payment",
        amount: "500.00",
        payment_method: "CARD",
        goods: ["Лоран шоколад · M", "Альпака сіра · L"],
      },
      heading: "Внесок ще не підтверджено",
      said: "Внесок 500,00 грн карткою за «Лоран шоколад · M + ще 1» — сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.",
    },
    {
      what: "from paper says so",
      body: {
        kind: "payment",
        amount: "500.00",
        payment_method: "CASH",
        outage: { by_user_id: null, at: null },
        goods: ["Лоран шоколад · M"],
      },
      heading: "Внесок ще не підтверджено",
      said: "Внесок з паперу 500,00 грн готівкою за «Лоран шоколад · M» — сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.",
    },
    {
      what: "kept before its goods were names its sum and way",
      body: { kind: "payment", amount: "500.00", payment_method: "TRANSFER" },
      heading: "Внесок ще не підтверджено",
      said: "Внесок 500,00 грн переказом — сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.",
    },
    {
      what: "kept before its way was names its sum, and goods it cannot read none",
      body: { kind: "payment", amount: "500.00", goods: "Лоран шоколад" },
      heading: "Внесок ще не підтверджено",
      said: "Внесок 500,00 грн — сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.",
    },
    {
      what: "whose goods hold something not a name names its sum and way alone",
      body: {
        kind: "payment",
        amount: "500.00",
        payment_method: "CARD",
        goods: ["Лоран шоколад · M", 7],
      },
      heading: "Внесок ще не підтверджено",
      said: "Внесок 500,00 грн карткою — сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.",
    },
    {
      what: "whose first good is empty names its sum and way alone",
      body: {
        kind: "payment",
        amount: "500.00",
        payment_method: "CASH",
        goods: ["", "Альпака сіра · L"],
      },
      heading: "Внесок ще не підтверджено",
      said: "Внесок 500,00 грн готівкою — сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.",
    },
    {
      what: "of a write-off says so",
      body: { kind: "write-off", reason: "виїхав" },
      heading: "Списання ще не підтверджено",
      said: "Списання боргу — сервер не відповів. Двічі воно не запишеться. Поки чекаємо, інші дії недоступні.",
    },
  ])
    test(`«Борги»: a kept payment's banner ${kept.what} (credits task list, P1-2)`, async ({
      page,
    }) => {
      await seed(page, {
        [creditKey]: JSON.stringify({
          key: randomUUID(),
          ambiguous: true,
          body: {
            store_id: ids.store,
            credit_id: ids.credit,
            command_id: randomUUID(),
            ...kept.body,
          },
        }),
      });
      await serve(page);
      await debts(page);
      const sent: unknown[] = [];
      const answer = async (route: Route, request: Request): Promise<void> => {
        sent.push(request.postDataJSON());
        // Still no answer: kept.
        await route.abort("connectionreset");
      };
      await on(page, `/credits/${ids.credit}/payments`, answer);
      await on(page, `/credits/${ids.credit}/write-off`, answer);
      await page.goto(launch());
      await openStore(page, /Подільський/);
      await expect(
        page.getByRole("heading", { name: kept.heading }),
      ).toBeVisible();
      await expect(page.getByText(kept.said, { exact: true })).toBeVisible();
      // Resent as kept, the goods never sent.
      await expect.poll(() => sent.length).toBeGreaterThan(0);
      expect(sent[0]).not.toHaveProperty("goods");
    });

  for (const refused of [
    {
      what: "a payment answered with a conflict that proves nothing is still unconfirmed",
      body: { kind: "payment", amount: "500.00", payment_method: "CASH" },
      status: 409,
      recorded: undefined,
      said: "Внесок ще не підтверджено: сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі він не запишеться.",
      kept: "Внесок ще не підтверджено",
    },
    {
      what: "a write-off answered with a request refused that proves nothing is still unconfirmed",
      body: { kind: "write-off", reason: "виїхав" },
      status: 422,
      recorded: undefined,
      said: "Списання ще не підтверджено: сервер не прийняв запит. Перевірте результат ще раз — двічі воно не запишеться.",
      kept: "Списання ще не підтверджено",
    },
    // Not an answer about the command: never «спробуйте ще раз», the
    // request's number kept (owner decision, 2026-10-18).
    {
      what: "a payment answered with a server's error is still unconfirmed",
      body: { kind: "payment", amount: "500.00", payment_method: "CARD" },
      status: 500,
      recorded: undefined,
      said: "Внесок ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі він не запишеться. Номер запиту: 5a6b7c8d.",
      kept: "Внесок ще не підтверджено",
    },
    {
      what: "a write-off answered that its request was not found is still unconfirmed",
      body: { kind: "write-off", reason: "виїхав" },
      status: 404,
      recorded: undefined,
      said: "Списання ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі воно не запишеться.",
      kept: "Списання ще не підтверджено",
    },
    {
      what: "a payment the server says it did not record after a conflict",
      body: { kind: "payment", amount: "500.00", payment_method: "CARD" },
      status: 409,
      recorded: false,
      said: "Внесок не записано. Дані змінилися, поки сервер не відповідав. Відкрийте борг у «Боргах» і спробуйте ще раз.",
      kept: null,
    },
    {
      what: "a write-off the server says it did not record, its request refused",
      body: { kind: "write-off", reason: "виїхав" },
      status: 422,
      recorded: false,
      said: "Списання не записано. Сервер не прийняв запит. Відкрийте борг у «Боргах» і спробуйте ще раз.",
      kept: null,
    },
  ])
    test(`«Борги»: ${refused.what}, in the debt's words, never an order's (credits task list, P2-2)`, async ({
      page,
    }) => {
      // Every alert's words, as each is drawn: never, even for a moment,
      // another's — a write-off called «Внесок» (review, 2026-10-18).
      await page.addInitScript(() => {
        const seen: string[] = [];
        (window as unknown as { alerts: string[] }).alerts = seen;
        new MutationObserver(() => {
          for (const alert of document.querySelectorAll("[role=alert]")) {
            const text = alert.textContent;
            if (text && seen.at(-1) !== text) seen.push(text);
          }
        }).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      await seed(page, {
        [creditKey]: JSON.stringify({
          key: randomUUID(),
          ambiguous: true,
          body: {
            store_id: ids.store,
            credit_id: ids.credit,
            command_id: randomUUID(),
            ...refused.body,
          },
        }),
      });
      await serve(page);
      await debts(page);
      const answer = async (route: Route): Promise<void> => {
        await route.fulfill({
          status: refused.status,
          // A number only where a server's error gives one.
          headers:
            refused.status === 500
              ? { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }
              : {},
          json: {
            code:
              refused.status === 409
                ? "CONFLICT"
                : refused.status === 422
                  ? "VALIDATION_ERROR"
                  : refused.status === 404
                    ? "NOT_FOUND"
                    : "INTERNAL_ERROR",
            message: "Refused",
            details: refused.recorded === false ? { recorded: false } : {},
          },
        });
      };
      await on(page, `/credits/${ids.credit}/payments`, answer);
      await on(page, `/credits/${ids.credit}/write-off`, answer);
      await page.goto(launch());
      await openStore(page, /Подільський/);
      // Said once, in the debt's words alone.
      await expect(page.getByRole("alert")).toHaveText([refused.said]);
      expect(
        await page.evaluate(
          () => (window as unknown as { alerts: string[] }).alerts,
        ),
      ).toEqual([refused.said]);
      if (refused.kept === null)
        // Proven to have recorded nothing: settled, the app free again.
        await expect(
          page.getByRole("heading", { name: /ще не підтверджено$/ }),
        ).toHaveCount(0);
      else {
        await expect(
          page.getByRole("heading", { name: refused.kept }),
        ).toBeVisible();
        // Asked about by its own name.
        await expect(
          page.getByRole("button", {
            name:
              refused.body.kind === "payment"
                ? "Перевірити результат внеску"
                : "Перевірити результат списання",
          }),
        ).toBeVisible();
      }
    });

  test("«Борги»: a kept payment answered «not found» three times in a row asks for a manager (owner decision, 2026-10-19)", async ({
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
    await debts(page);
    const sent: unknown[] = [];
    let status = 404;
    await on(
      page,
      `/credits/${ids.credit}/payments`,
      async (route, request) => {
        sent.push(request.postDataJSON());
        await route.fulfill({
          status,
          json: {
            code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
            message: "Refused",
          },
        });
      },
    );
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const unconfirmed =
      "Внесок ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі він не запишеться.";
    const said = page.getByRole("alert");
    await expect(said).toHaveText(unconfirmed);
    const check = page.getByRole("button", {
      name: "Перевірити результат внеску",
    });
    await thriceNotFound(check, () => sent.length, said, unconfirmed);
    // Any other answer begins the count again.
    status = 500;
    await check.click();
    await expect.poll(() => sent.length).toBe(4);
    await expect(check).toBeEnabled();
    await expect(said).toHaveText(unconfirmed);
    status = 404;
    await check.click();
    await expect.poll(() => sent.length).toBe(5);
    await expect(check).toBeEnabled();
    await expect(said).toHaveText(unconfirmed);
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
    await openStore(page, /Подільський/);
    await page.getByRole("button", { name: "Борги", exact: true }).click();
    await page
      .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByText(
        "Списання не записано. За цим продажем уже нічого не винні.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /^(Внесок|Списання) ще не підтверджено$|^Перевіряємо (внесок|списання)…$/,
      }),
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByText(
        "Внесок не записано. Це більше, ніж винні: залишок боргу 300,00 грн. Прийміть 300,00 грн, а решту поверніть покупцю переказом.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /^(Внесок|Списання) ще не підтверджено$|^Перевіряємо (внесок|списання)…$/,
      }),
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
    await openStore(page, /Подільський/);
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
      page.getByRole("heading", {
        name: /^(Внесок|Списання) ще не підтверджено$|^Перевіряємо (внесок|списання)…$/,
      }),
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

  test("a kept stock correction a server fails to answer is still unconfirmed, its request's number kept (owner decision, 2026-10-19)", async ({
    page,
  }) => {
    await seed(page, {
      [adjustmentKey]: keptAdjustment({
        quantity_delta: -2,
        reason_code: "LOST",
        expected_quantity: null,
      }),
    });
    await serve(page);
    await holding(page, ["inventory:view", "inventory:adjust"]);
    let status = 500;
    let sent = 0;
    await on(page, "/inventory/adjustments", async (route) => {
      sent += 1;
      await route.fulfill({
        status,
        headers:
          status === 500
            ? { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }
            : {},
        json: {
          code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
          message: "Refused",
        },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const unconfirmed =
      "Коригування ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі воно не запишеться.";
    await expect(page.getByRole("alert")).toHaveText(
      `${unconfirmed} Номер запиту: 5a6b7c8d.`,
    );
    expect(
      await page.evaluate((key) => localStorage.getItem(key), adjustmentKey),
    ).not.toBeNull();
    status = 404;
    await thriceNotFound(
      page.getByRole("button", { name: "Перевірити результат коригування" }),
      () => sent,
      page.getByRole("alert"),
      unconfirmed,
      0,
    );
  });

  const stocktake = randomUUID();
  for (const kept of [
    {
      name: "delivery",
      scope: "receipt-pending",
      path: "/inventory/receipts",
      body: {
        location_id: ids.shared,
        notes: null,
        lines: [
          {
            product_variant_id: ids.variant,
            size_id: ids.size,
            quantity: 1,
            acquisition_type: "PURCHASE",
            unit_cost: "1000.00",
          },
        ],
      },
      said: "Приймання ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі воно не запишеться. Номер запиту: 5a6b7c8d.",
      check: "Перевірити результат приймання",
    },
    {
      name: "stocktake's count",
      scope: "stocktake-count-pending",
      path: `/stocktakes/${stocktake}/counts`,
      body: {
        stocktake_id: stocktake,
        product_variant_id: ids.variant,
        size_id: ids.size,
        counted_quantity: 3,
        expected_quantity: 5,
      },
      said: "Підрахунок ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі він не запишеться. Номер запиту: 5a6b7c8d.",
      check: "Перевірити результат підрахунку",
    },
  ])
    test(`a kept ${kept.name} a server fails to answer is still unconfirmed, by its own name (owner decision, 2026-10-19)`, async ({
      page,
    }) => {
      const key = `birka:${kept.scope}:${ids.organization}:${ids.user}:${ids.store}`;
      await seed(page, {
        [key]: JSON.stringify({
          key: randomUUID(),
          ambiguous: true,
          since: new Date(Date.now() - 30 * 60_000).toISOString(),
          body: { store_id: ids.store, command_id: randomUUID(), ...kept.body },
        }),
      });
      await serve(page);
      let status = 500;
      let sent = 0;
      await on(page, kept.path, async (route) => {
        sent += 1;
        await route.fulfill({
          status,
          headers:
            status === 500
              ? { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }
              : {},
          json: {
            code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
            message: "Refused",
          },
        });
      });
      await page.goto(launch());
      await openStore(page, /Подільський/);
      // Its own alert, whatever else the stub's rights make the screen say.
      await expect(
        page.getByRole("alert").filter({ hasText: kept.said }),
      ).toHaveText(kept.said);
      expect(
        await page.evaluate((stored) => localStorage.getItem(stored), key),
      ).not.toBeNull();
      // Its own banner counts its «not found».
      status = 404;
      const unconfirmed = kept.said.replace(" Номер запиту: 5a6b7c8d.", "");
      await thriceNotFound(
        page.getByRole("button", { name: kept.check }),
        () => sent,
        page.getByRole("alert").filter({ hasText: unconfirmed }),
        unconfirmed,
        0,
      );
    });

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
      await openStore(page, /Подільський/);
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
    await openStore(page, /Подільський/);
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByText(
        "Операцію «Відправлено» ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі вона не запишеться. Номер запиту: 5a6b7c8d.",
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

  test("a kept order step the server answered, whose order could not be read, says it is recorded and how to read it again, never «спробуйте ще раз» (owner decision, 2026-10-21)", async ({
    page,
  }) => {
    const order = randomUUID();
    await seed(page, {
      [orderKey]: JSON.stringify({
        path: `/orders/${order}/dispatch`,
        body: { command_id: randomUUID() },
        label: "Відправлено",
        orderId: order,
        acknowledged: true,
        ambiguous: false,
      }),
    });
    await serve(page);
    let answer: "failed" | "busy" | "lost" = "failed";
    let reads = 0;
    await on(page, `/orders/${order}`, async (route) => {
      reads += 1;
      if (answer === "lost") {
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill(
        answer === "busy"
          ? {
              status: 429,
              json: {
                code: "TOO_MANY_REQUESTS",
                message: "Too many requests",
                details: { retry_after: 30 },
              },
            }
          : {
              status: 500,
              headers: {
                "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d",
              },
              json: { code: "INTERNAL_ERROR", message: "Internal error" },
            },
      );
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const recorded =
      "Операцію «Відправлено» записано. Замовлення не вдалося показати — натисніть «Оновити результат».";
    // A server's own failure keeps its request's number.
    await expect(
      page.getByText(`${recorded} Номер запиту: 5a6b7c8d.`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/ще не підтверджено|Спробуйте ще раз/),
    ).toHaveCount(0);
    // The banner's own button reads the order again.
    const again = page.getByRole("button", { name: "Оновити результат" });
    await expect(again).toBeEnabled();
    // An answer with words of its own keeps them (review, 2026-10-21).
    answer = "busy";
    let before = reads;
    await again.click();
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(
      page.getByText(
        "Забагато дій за короткий час. Зачекайте 30 с і повторіть.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(page.getByText(/записано\. Замовлення/)).toHaveCount(0);
    // Out of reach: told so, as anywhere.
    answer = "lost";
    before = reads;
    await again.click();
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(
      page.getByRole("alert").filter({ hasText: /^Сервер не відповідає/ }),
    ).toBeVisible();
    await expect(page.getByText(recorded, { exact: true })).toHaveCount(0);
  });

  test("a kept order step answered «not found» three times in a row asks for a manager (owner decision, 2026-10-19)", async ({
    page,
  }) => {
    const order = randomUUID();
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
    let status = 404;
    await on(page, `/orders/${order}/dispatch`, async (route, request) => {
      dispatches.push(request.postData() ?? "");
      await route.fulfill({
        status,
        json: {
          code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
          message: "Refused",
        },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const unconfirmed =
      "Операцію «Відправлено» ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі вона не запишеться.";
    const said = page.getByText(/^Операцію «Відправлено» ще не підтверджено/);
    await expect(said).toHaveText(unconfirmed);
    const again = page.getByRole("button", {
      name: "Повторити ту саму команду",
    });
    await thriceNotFound(again, () => dispatches.length, said, unconfirmed);
    // Any other answer begins the count again.
    status = 500;
    await again.click();
    await expect.poll(() => dispatches.length).toBe(4);
    await expect(again).toBeEnabled();
    await expect(said).toHaveText(unconfirmed);
    status = 404;
    await again.click();
    await expect.poll(() => dispatches.length).toBe(5);
    await expect(again).toBeEnabled();
    await expect(said).toHaveText(unconfirmed);
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
      live: "Поверніть покупцю 3 000,00 грн готівкою.",
      said: "Якщо гроші ще не повернули — поверніть покупцю 3 000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
    },
    {
      way: "CARD",
      live: "Поверніть 3 000,00 грн на картку покупця через термінал.",
      said: "Якщо гроші ще не повернули — поверніть 3 000,00 грн на картку покупця через термінал. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
    },
    {
      way: "TRANSFER",
      live: "Надішліть покупцю 3 000,00 грн переказом.",
      said: "Якщо гроші ще не повернули — надішліть покупцю 3 000,00 грн переказом. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
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
      await openStore(page, /Подільський/);
      // Checked by itself on opening, with no tap, and recorded.
      await expect(
        page.getByRole("heading", { name: "Повернення записано один раз" }),
      ).toBeVisible();
      await expect(page.getByText(said, { exact: true })).toBeVisible();
      await expect(page.getByText(live, { exact: true })).toHaveCount(0);
      expect(sent).toHaveLength(1);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), returnKey),
      ).toBeNull();
    });

  test("a kept return typed from paper the phone confirms says the money went back during the outage, and is resent with its mark", async ({
    page,
  }) => {
    const stored = JSON.parse(keptReturn("CASH")) as {
      body: Record<string, unknown>;
    };
    const outage = { by_user_id: null, at: null };
    stored.body.outage = outage;
    await seed(page, { [returnKey]: JSON.stringify(stored) });
    await serve(page);
    const sent = await returns(page, async (route, way) => {
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
          outage: { by_user_id: null, by: null, at: null },
        },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("heading", { name: "Повернення записано один раз" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "3 000,00 грн готівкою повернули під час збою — вдруге не повертайте.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("Повернено під час збою")).toBeVisible();
    await expect(page.getByText(/Якщо гроші ще не повернули/)).toHaveCount(0);
    expect(sent).toHaveLength(1);
    expect(
      (JSON.parse(sent[0] ?? "{}") as { outage?: unknown }).outage,
    ).toEqual(outage);
  });

  for (const kept of [
    {
      name: "names the goods, the sum and the way it kept",
      shown: { lines: [{ name: coat, size: "M", units: 1 }], sum: "3000.00" },
      said: `Повернення: ${coat} · M × 1 · 3 000,00 грн готівкою — сервер не відповів. Двічі воно не запишеться, і гроші двічі не повернуться. Поки чекаємо, інші дії недоступні.`,
    },
    {
      name: "whose goods are not even a list names its units and way, and is still resent",
      shown: null,
      said: "Повернення 1 шт. · готівкою — сервер не відповів. Двічі воно не запишеться, і гроші двічі не повернуться. Поки чекаємо, інші дії недоступні.",
    },
    {
      name: "whose goods do not read names its units and way, and is still resent",
      shown: { lines: "щось інше", sum: 3000 },
      said: "Повернення 1 шт. · готівкою — сервер не відповів. Двічі воно не запишеться, і гроші двічі не повернуться. Поки чекаємо, інші дії недоступні.",
    },
  ])
    test(`a kept return reopened ${kept.name}, and never sends them`, async ({
      page,
    }) => {
      const stored = JSON.parse(keptReturn("CASH")) as {
        body: Record<string, unknown>;
      };
      stored.body.shown = kept.shown;
      await seed(page, { [returnKey]: JSON.stringify(stored) });
      await serve(page);
      // Still being written by its first send: kept, its banner shown.
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
      await openStore(page, /Подільський/);
      await expect(page.getByText(kept.said, { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "Перевірити результат повернення" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Повернення записано один раз" }),
      ).toBeVisible();
      expect(sent).toHaveLength(2);
      expect(sent[1]).toBe(sent[0]);
      expect(JSON.parse(sent[0] ?? "{}")).not.toHaveProperty("shown");
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByText(
        "Попередня спроба ще виконується. Зачекайте кілька секунд і перевірте результат.",
      ),
    ).toBeVisible();
    // Kept before it said its goods: its units and its way (P1-2).
    await expect(
      page.getByText(
        "Повернення 1 шт. · переказом — сервер не відповів. Двічі воно не запишеться, і гроші двічі не повернуться. Поки чекаємо, інші дії недоступні.",
        { exact: true },
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("heading", { name: "Повернення записано один раз" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Якщо гроші ще не повернули — поверніть покупцю 1 000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Поверніть покупцю 1 000,00 грн готівкою.", {
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("a kept return of a sale paid in parts with nothing beyond the goods kept says no money goes back", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
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
            debt_reduced: "3000.00",
            cash_back: "0.00",
            owed_after: "500.00",
          },
          payment_method: way,
        },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const notice = page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Повернення записано один раз" }),
    });
    await expect(notice).toBeVisible();
    await expect(notice.locator(".hand-back-sum")).toHaveText("0,00 грн");
    await expect(notice).toContainText("Грошей покупцю не повертаємо.");
    await expect(notice).toContainText(
      "Борг покупця зменшено на 3 000,00 грн.",
    );
    await expect(notice).toContainText("Покупець ще винен 500,00 грн.");
    await expect(notice).not.toContainText(/Поверніть/i);
  });

  /** The kept return's notice, once the phone has settled it. */
  function confirmedReturn(page: Page) {
    return page.locator("section.notice", {
      has: page.getByRole("heading", { name: "Повернення записано один раз" }),
    });
  }

  test("a kept return of this store's own sale the phone confirms by itself says the goods went back where they were sold from", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
    const sent = await returns(page, recorded);
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const confirmed = confirmedReturn(page);
    await expect(confirmed).toBeVisible();
    await expect(
      confirmed.getByText("Цілі: 1 шт. — на склад, з якого продали.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(confirmed.getByText(/вашого магазину/)).toHaveCount(0);
    await expect(confirmed.getByText(/гроші віддаєте ви/)).toHaveCount(0);
    expect(sent).toHaveLength(1);
  });

  /** Another store of the network, which sold from its own warehouse. */
  const otherStore = "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c16";

  /**
   * A return taken here of the other store's sale, kept on the phone: this
   * store does not reach the warehouse it was sold from, so its coat goes to
   * `place`, one of this store's the seller chose (owner decisions,
   * 2026-10-01).
   */
  function keptElsewhere(place: string): string {
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
            location_id: place,
          },
        ],
        reason: null,
        elsewhere: true,
        payment_method: "CASH",
      },
    });
  }

  for (const read of [
    {
      name: "names the warehouse chosen",
      warehouses: [
        warehouse(ids.shared, "Спільний"),
        warehouse(ids.own, "Склад Б"),
      ],
      said: "Цілі: 1 шт. — на склад «Склад Б» вашого магазину.",
    },
    {
      // Closed since the seller chose it: no longer among this store's.
      name: "with that warehouse closed since, names none",
      warehouses: [warehouse(ids.shared, "Спільний")],
      said: "Цілі: 1 шт. — на склад вашого магазину.",
    },
  ])
    test(`a kept return of another store's sale, its warehouse chosen, the phone confirms by itself ${read.name}, and never says it went where it was sold from`, async ({
      page,
    }) => {
      await seed(page, { [returnKey]: keptElsewhere(ids.own) });
      await serve(page, read.warehouses);
      const sent = await returns(page, async (route, way) => {
        await route.fulfill({
          status: 201,
          json: {
            id: randomUUID(),
            sale_id: ids.sale,
            store_id: otherStore,
            taken_at_store_id: ids.store,
            total_amount: "3000.00",
            items: [
              {
                sale_item_id: item,
                quantity: 1,
                amount: "3000.00",
                condition: "INTACT",
                destination_location_id: ids.own,
                display_name: `${coat} · M`,
              },
            ],
            credit: null,
            payment_method: way,
          },
        });
      });
      // This store's warehouses, read for the name once the form is gone.
      let reads = 0;
      page.on("requestfinished", (request) => {
        if (new URL(request.url()).pathname === "/api/v1/stock-locations")
          reads += 1;
      });
      await page.goto(launch());
      await openStore(page, /Подільський/);
      const confirmed = confirmedReturn(page);
      await expect(confirmed).toBeVisible();
      await expect(
        confirmed.getByText(
          "Товар куплено в іншому магазині мережі — гроші віддаєте ви.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        confirmed.getByText(
          "Якщо гроші ще не повернули — поверніть покупцю 3 000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(confirmed.getByText(/з якого продали/)).toHaveCount(0);
      await expect.poll(() => reads).toBeGreaterThan(0);
      await expect(
        confirmed.getByText(read.said, { exact: true }),
      ).toBeVisible();
      // The identical attempt, the warehouse it named included.
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0] ?? "{}")).toMatchObject({
        store_id: ids.store,
        lines: [{ location_id: ids.own }],
      });
    });

  for (const refusal of [
    {
      status: 409,
      code: "CONFLICT",
      said: "Повернення не записано. Дані змінилися, поки сервер не відповідав. Поверніться до списку в «Поверненні» й спробуйте ще раз.",
    },
    {
      status: 422,
      code: "VALIDATION_ERROR",
      said: "Повернення не записано. Перевірте, що повертають, і спробуйте ще раз.",
    },
  ])
    test(`a kept return refused on resend (${String(refusal.status)}) for a reason nothing more is known of says so in «Повернення»'s words, never an order's`, async ({
      page,
    }) => {
      await seed(page, { [returnKey]: keptReturn("CASH") });
      await serve(page);
      const sent = await returns(page, async (route) => {
        await route.fulfill({
          status: refusal.status,
          json: {
            code: refusal.code,
            message: "Refused",
            details: { recorded: false },
          },
        });
      });
      await page.goto(launch());
      await openStore(page, /Подільський/);
      await expect(page.getByText(refusal.said, { exact: true })).toBeVisible();
      // Not a word of an order in what is said (the sections' row names theirs).
      await expect(
        page.getByRole("alert").filter({ hasText: /замовлен/i }),
      ).toHaveCount(0);
      expect(sent).toHaveLength(1);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), returnKey),
      ).toBeNull();
    });

  for (const refusal of [
    {
      status: 409,
      code: "CONFLICT",
      why: "a conflict",
      said: "Повернення ще не підтверджено: сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі воно не запишеться.",
    },
    {
      status: 422,
      code: "VALIDATION_ERROR",
      why: "a request not taken",
      said: "Повернення ще не підтверджено: сервер не прийняв запит. Перевірте результат ще раз — двічі воно не запишеться.",
    },
    // Not an answer about the return: never «спробуйте ще раз», the
    // request's number kept (owner decision, 2026-10-18).
    {
      status: 500,
      code: "INTERNAL_ERROR",
      why: "a server's error",
      said: "Повернення ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі воно не запишеться. Номер запиту: 5a6b7c8d.",
    },
  ])
    test(`a kept return still unconfirmed, refused for ${refusal.why}, says so in its own words and stays kept`, async ({
      page,
    }) => {
      await seed(page, { [returnKey]: keptReturn("CASH") });
      await serve(page);
      // Refused, but not said to have recorded nothing: an unknown outcome.
      const sent = await returns(page, async (route) => {
        await route.fulfill({
          status: refusal.status,
          headers: { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" },
          json: { code: refusal.code, message: "Refused", details: {} },
        });
      });
      await page.goto(launch());
      await openStore(page, /Подільський/);
      await expect(page.getByText(refusal.said, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
      ).toBeVisible();
      // Not a word of an order in what is said (owner decisions, 2026-10-18).
      await expect(
        page.getByRole("alert").filter({ hasText: /замовлен/i }),
      ).toHaveCount(0);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), returnKey),
      ).not.toBeNull();
      // Sent once, by the phone itself; nothing invites another.
      expect(sent).toHaveLength(1);
    });

  test("a kept return answered «not found» three times in a row asks for a manager (owner decision, 2026-10-19)", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
    const sent = await returns(page, async (route) => {
      await route.fulfill({
        status: 404,
        json: { code: "NOT_FOUND", message: "Not found" },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const unconfirmed =
      "Повернення ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі воно не запишеться.";
    const said = page.getByRole("alert");
    await expect(said).toHaveText(unconfirmed);
    await thriceNotFound(
      page.getByRole("button", { name: "Перевірити результат повернення" }),
      () => sent.length,
      said,
      unconfirmed,
    );
  });

  // The server answers whoever took a return what it recorded, though they
  // may no longer take returns, and says when nothing was (owner decision,
  // 2026-10-18). This person holds neither `sale:refund` nor `sale:view`.
  test("a kept return on a phone whose person may no longer take returns is answered as recorded: its result over the till, and the till free", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
    const sent: string[] = [];
    await on(page, `/sales/${ids.sale}/refunds`, async (route, request) => {
      sent.push(request.postData() ?? "");
      await recorded(route, "CASH");
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("heading", { name: "Повернення записано один раз" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Якщо гроші ще не повернули — поверніть покупцю 3 000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), returnKey),
    ).toBeNull();
    // Over the till, never «Повернення», which this person does not have;
    // the till free.
    await expect(
      page.getByRole("heading", { name: "Продаж", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Вношу продаж з паперу" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Повернення", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Немає права/)).toHaveCount(0);
    expect(sent).toHaveLength(1);
  });

  test("a kept return on a phone whose person may no longer take returns, proven to have recorded nothing, says so and frees the till", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
    const sent: string[] = [];
    await on(page, `/sales/${ids.sale}/refunds`, async (route, request) => {
      sent.push(request.postData() ?? "");
      await route.fulfill({
        status: 403,
        json: {
          code: "PERMISSION_DENIED",
          message: "Missing permission sale:refund",
          details: {
            permission: "sale:refund",
            store_id: ids.store,
            recorded: false,
          },
        },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    // What to do of money already handed back (owner decision, 2026-10-18).
    await expect(
      page.getByText(
        "Повернення не записано. Немає доступу до цієї операції або складу. Зверніться до менеджера. Якщо гроші вже повернули — передайте папір менеджеру, щоб внести повернення з паперу.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), returnKey),
    ).toBeNull();
    // The till free.
    await expect(
      page.getByRole("heading", { name: "Продаж", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Вношу продаж з паперу" }),
    ).toBeEnabled();
    await expect(page.getByText(/Немає права/)).toHaveCount(0);
    expect(sent).toHaveLength(1);
  });

  const paper =
    "Якщо гроші вже повернули — передайте папір менеджеру, щоб внести повернення з паперу.";
  for (const refusal of [
    {
      status: 403,
      code: "LOCATION_ACCESS_DENIED",
      details: {},
      why: "warehouse is no longer reached",
      said: `Повернення не записано. Немає доступу до цієї операції або складу. Зверніться до менеджера. ${paper}`,
    },
    {
      status: 404,
      code: "NOT_FOUND",
      details: { reason: "WAREHOUSE_UNAVAILABLE" },
      why: "warehouse is closed",
      said: `Повернення не записано. Склад, куди йшов цей товар, закрито. Зверніться до менеджера. ${paper}`,
    },
    {
      status: 422,
      code: "VALIDATION_ERROR",
      details: { reason: "CHOOSE_A_WAREHOUSE" },
      why: "sold-from warehouse is no longer reached",
      said: `Повернення не записано. Цілий товар цього продажу йде на склад вашого магазину — оберіть його ще раз. ${paper}`,
    },
    {
      status: 409,
      code: "DAMAGED_RETURNS_UNAVAILABLE",
      details: { reason: "NOT_SET_UP" },
      why: "«Брак» is undone",
      said: `Повернення не записано. У цього магазину ще немає складу «Брак» для пошкодженого товару. Зверніться до власника. ${paper}`,
    },
    {
      // A 404 naming nothing is no warehouse of its: the shared words.
      status: 404,
      code: "NOT_FOUND",
      details: {},
      why: "sale is not found",
      said: "Повернення не записано. Не вдалося виконати операцію. Спробуйте ще раз.",
    },
  ])
    test(`a kept return whose ${refusal.why}, proven to have recorded nothing, says so, and frees the till`, async ({
      page,
    }) => {
      await seed(page, { [returnKey]: keptReturn("CASH") });
      await serve(page);
      // Its person still takes returns; the store's reach is what went
      // (owner decision, 2026-10-18).
      const sent = await returns(page, async (route) => {
        await route.fulfill({
          status: refusal.status,
          json: {
            code: refusal.code,
            message: "Refused",
            details: { ...refusal.details, recorded: false },
          },
        });
      });
      await page.goto(launch());
      await openStore(page, /Подільський/);
      await expect(page.getByText(refusal.said, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
      ).toHaveCount(0);
      expect(
        await page.evaluate((key) => localStorage.getItem(key), returnKey),
      ).toBeNull();
      expect(sent).toHaveLength(1);
    });

  test("a kept return refused for the right, with nothing said of what was recorded, stays kept over the till, never «Немає права»", async ({
    page,
  }) => {
    await seed(page, { [returnKey]: keptReturn("CASH") });
    await serve(page);
    // A refusal that does not say nothing was recorded — a private
    // warehouse's rule, say, or a server from before 2026-10-18 — leaves
    // the outcome unknown.
    let asked = 0;
    await on(page, `/sales/${ids.sale}/refunds`, async (route) => {
      asked += 1;
      await route.fulfill({
        status: 403,
        json: {
          code: "PERMISSION_DENIED",
          message: "Permission denied",
          details: {},
        },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
    ).toBeVisible();
    await expect.poll(() => asked).toBeGreaterThan(0);
    // Under the banner, what the server answered and whom to see; the
    // return stays kept, and the till beneath it is held while it does.
    await expect(
      page.getByText(
        "Немає доступу до цієї операції або складу. Зверніться до менеджера.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), returnKey),
    ).not.toBeNull();
    // The till beneath it, held, never «Повернення» (returns task list,
    // P2-1).
    await expect(
      page.getByRole("heading", { name: "Продаж", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Вношу продаж з паперу" }),
    ).toBeDisabled();
    await expect(page.getByText(/Немає права/)).toHaveCount(0);
  });

  /** A payment or a write-off of «Борги», kept, its answer never heard. */
  function keptDebt(kind: "payment" | "write-off"): string {
    return JSON.stringify({
      key: randomUUID(),
      ambiguous: true,
      body:
        kind === "payment"
          ? {
              kind,
              store_id: ids.store,
              credit_id: ids.credit,
              command_id: randomUUID(),
              amount: "500.00",
              payment_method: "CASH",
            }
          : {
              kind,
              store_id: ids.store,
              credit_id: ids.credit,
              command_id: randomUUID(),
              reason: "Покупець виїхав",
            },
    });
  }

  for (const [kind, path, heading] of [
    ["payment", "payments", "Внесок ще не підтверджено"],
    ["write-off", "write-off", "Списання ще не підтверджено"],
  ] as const)
    test(`a kept ${kind} on a phone whose person may no longer open «Борги» stays kept over the till, as it is held now, never «Немає доступу до боргів»`, async ({
      page,
    }) => {
      await seed(page, { [creditKey]: keptDebt(kind) });
      await serve(page);
      // This person no longer holds `sale:credit` here.
      await on(page, "/me", async (route) => {
        await route.fulfill({
          json: {
            ...me,
            stores: me.stores.map((store) => ({
              ...store,
              permissions: store.permissions.filter(
                (permission) => permission !== "sale:credit",
              ),
            })),
          },
        });
      });
      // The server refuses whoever may not take payments, or write off,
      // before it looks the command up, and says nothing of what was
      // recorded.
      let asked = 0;
      await on(page, `/credits/${ids.credit}/${path}`, async (route) => {
        asked += 1;
        await route.fulfill({
          status: 403,
          json: {
            code: "PERMISSION_DENIED",
            message: "Permission denied",
            details: {},
          },
        });
      });
      await page.goto(launch());
      await openStore(page, /Подільський/);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect.poll(() => asked).toBeGreaterThan(0);
      await expect(
        page.getByText(
          "Немає доступу до цієї операції або складу. Зверніться до менеджера.",
          { exact: true },
        ),
      ).toBeVisible();
      // Kept, and the till beneath it held, as before this change. Whether
      // it should be answered as a kept return is, freeing the till, is
      // the owner's to say (queued 2026-10-21).
      expect(
        await page.evaluate((key) => localStorage.getItem(key), creditKey),
      ).not.toBeNull();
      // The till beneath it, never «Борги» (credits task list, P2-1).
      await expect(
        page.getByRole("heading", { name: "Продаж", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("checkbox", { name: "Вношу продаж з паперу" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Борги", exact: true }),
      ).toHaveCount(0);
      await expect(page.getByText(/Немає доступу до боргів/)).toHaveCount(0);
    });

  test("a kept payment's «not found» count is kept when Telegram reopens the app, and a count found on the phone is read, a malformed one as none (owner decision, 2026-10-21)", async ({
    page,
  }) => {
    await seed(page, { [creditKey]: keptDebt("payment") });
    await serve(page);
    const sent: string[] = [];
    await on(
      page,
      `/credits/${ids.credit}/payments`,
      async (route, request) => {
        sent.push(request.postData() ?? "");
        await route.fulfill({
          status: 404,
          json: { code: "NOT_FOUND", message: "Refused" },
        });
      },
    );
    await page.goto(launch());
    await openStore(page, /Подільський/);
    const unconfirmed =
      "Внесок ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі він не запишеться.";
    const said = page
      .getByRole("alert")
      .filter({ hasText: /^Внесок ще не підтверджено/ });
    await expect(said).toHaveText(unconfirmed);
    const check = page.getByRole("button", {
      name: "Перевірити результат внеску",
    });
    await check.click();
    await expect.poll(() => sent.length).toBe(2);
    await expect(check).toBeEnabled();
    await expect(said).toHaveText(unconfirmed);
    for (const body of sent) expect(body).not.toContain("misses");
    // Reopened: its own check is the third in a row.
    await page.goto("about:blank");
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect.poll(() => sent.length).toBe(3);
    await expect(said).toHaveText(
      `${unconfirmed} Зверніться до менеджера: нехай перевірить, чи записано.`,
    );
    // A count that is not one, on the phone — written as text, though it
    // reads as three: none, and the payment read as ever, never «cannot be
    // read».
    await page.evaluate((key) => {
      const kept = JSON.parse(localStorage.getItem(key) ?? "{}") as object;
      localStorage.setItem(key, JSON.stringify({ ...kept, misses: "3" }));
    }, creditKey);
    await page.goto("about:blank");
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect.poll(() => sent.length).toBe(4);
    await expect(check).toBeEnabled();
    await expect(said).toHaveText(unconfirmed);
    await expect(
      page.getByText("Не вдалося прочитати збережений внесок", {
        exact: false,
      }),
    ).toHaveCount(0);
  });

  test("a kept order step's «not found» count is kept when Telegram reopens the app (owner decision, 2026-10-21)", async ({
    page,
  }) => {
    const order = randomUUID();
    // Two «not found» already counted on an earlier visit.
    await seed(page, {
      [orderKey]: JSON.stringify({
        path: `/orders/${order}/dispatch`,
        body: { command_id: randomUUID() },
        label: "Відправлено",
        orderId: order,
        ambiguous: true,
        misses: 2,
      }),
    });
    await serve(page);
    const dispatches: string[] = [];
    await on(page, `/orders/${order}/dispatch`, async (route, request) => {
      dispatches.push(request.postData() ?? "");
      await route.fulfill({
        status: 404,
        json: { code: "NOT_FOUND", message: "Refused" },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect.poll(() => dispatches.length).toBe(1);
    // Its own check on opening is the third in a row.
    await expect(
      page.getByText(/^Операцію «Відправлено» ще не підтверджено/),
    ).toHaveText(
      "Операцію «Відправлено» ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі вона не запишеться. Зверніться до менеджера: нехай перевірить, чи записано.",
    );
    expect(dispatches[0]).not.toContain("misses");
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "{}") as unknown,
        orderKey,
      ),
    ).toMatchObject({ misses: 3 });
  });

  test("a kept payment answered that the server did not take the request (a 400) says so, as one answered with a 422 (owner decision, 2026-10-21)", async ({
    page,
  }) => {
    await seed(page, { [creditKey]: keptDebt("payment") });
    await serve(page);
    await on(page, `/credits/${ids.credit}/payments`, async (route) => {
      await route.fulfill({
        status: 400,
        json: { code: "BAD_REQUEST", message: "Refused", details: {} },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("alert").filter({ hasText: /^Внесок ще не підтверджено/ }),
    ).toHaveText(
      "Внесок ще не підтверджено: сервер не прийняв запит. Перевірте результат ще раз — двічі він не запишеться.",
    );
  });

  test("a kept payment on a phone whose person may take payments still turns to «Борги»", async ({
    page,
  }) => {
    await seed(page, { [creditKey]: keptDebt("payment") });
    await serve(page);
    await on(page, `/credits/${ids.credit}/payments`, async (route) => {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
    });
    await page.goto(launch());
    await openStore(page, /Подільський/);
    await expect(
      page.getByRole("heading", { name: "Внесок ще не підтверджено" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Борги", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Борги", exact: true }),
    ).toHaveAttribute("aria-current", "page");
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
    await openStore(page, /Подільський/);
    await expect(
      page.getByText(
        "Повернення не записано. Частину цього товару вже повернули. Поверніться до списку: він покаже, що можна повернути тепер.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
    ).toHaveCount(0);
    expect(sent).toHaveLength(1);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), returnKey),
    ).toBeNull();
  });
});
