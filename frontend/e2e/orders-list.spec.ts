import { test, expect, openStore, section } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Замовлення» (orders task list, P0-1): what is to be sent and what is on
 * its way on top, oldest first, a row a parcel's tag with no sum; the
 * closed under «Показати завершені»; a waybill found as it is typed; «+»
 * for a new one. And a cancel asked first (P0-4). The orders are stubbed.
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
  if (options.version) hash.set("tgWebAppVersion", options.version);
  return `/#${hash.toString()}`;
}

/** A moment `days` back. */
function ago(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** «21.10» of a moment, by this machine's calendar, which the phone shares. */
function short(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}`;
}

function item(
  name: string,
  size: string | null,
  quantity = 1,
): Record<string, unknown> {
  return {
    id: randomUUID(),
    product_variant_id: randomUUID(),
    size_id: randomUUID(),
    source_location_id: randomUUID(),
    quantity,
    unit_price: "600.00",
    discount_amount: "0.00",
    display_name: name,
    size_label: size,
  };
}

type Stubbed = Record<string, unknown> & { id: string; status: string };

function order(over: Record<string, unknown> = {}): Stubbed {
  return {
    id: randomUUID(),
    store_id: fixture.store_id,
    status: "READY_TO_DISPATCH",
    sale_id: null,
    currency_code: "UAH",
    total: "1200.00",
    created_at: ago(2),
    items: [item("Лоран шоколад", "M")],
    destination: "UKRAINE",
    carrier: "NOVA_POSHTA",
    waybill: null,
    abroad_note: null,
    payment_method: null,
    ...over,
  };
}

interface Server {
  open: Stubbed[];
  closed: Stubbed[];
  found: Record<string, Stubbed[]>;
  asked: string[];
  cancels: unknown[];
  /** A waybill whose search waits for `gate`. */
  heldFor?: string;
  gate?: Promise<void>;
  /** The cancel's answer, once `gate` opens: refused, or recorded. */
  cancelRefused?: boolean;
}

async function stub(page: Page, server: Server): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/v1/orders",
    async (route, request) => {
      const params = new URL(request.url()).searchParams;
      const status = params.get("status");
      const waybill = params.get("waybill");
      const limit = Number(params.get("limit") ?? "50");
      const offset = Number(params.get("offset") ?? "0");
      server.asked.push(`${status ?? ""}|${waybill ?? ""}|${String(offset)}`);
      if (waybill !== null && waybill === server.heldFor) await server.gate;
      const all =
        waybill !== null
          ? (server.found[waybill] ?? [])
          : status === "open"
            ? server.open
            : status === "closed"
              ? server.closed
              : [...server.open, ...server.closed];
      // Newest first, a page may hold the last row of the one before: an
      // order made meanwhile moves the pages' edge.
      const start = offset > 0 && status !== "open" ? offset - 1 : offset;
      await route.fulfill({
        json: {
          orders: all.slice(start, offset + limit),
          has_more: all.length > offset + limit,
        },
      });
    },
  );
  await page.route("**/api/v1/orders/*", async (route, request) => {
    const id = new URL(request.url()).pathname.split("/").at(-1);
    const found = [...server.open, ...server.closed].find(
      (each) => each.id === id,
    );
    await route.fulfill(found ? { json: found } : { status: 404, json: {} });
  });
  await page.route("**/api/v1/orders/*/cancel", async (route, request) => {
    server.cancels.push(request.postDataJSON());
    await server.gate;
    if (server.cancelRefused) {
      await route.fulfill({
        status: 409,
        json: { code: "CONFLICT", message: "Conflict", details: {} },
      });
      return;
    }
    const id = new URL(request.url()).pathname.split("/").at(-2);
    const found = server.open.find((each) => each.id === id);
    if (found) found.status = "CANCELLED";
    await route.fulfill({ json: found });
  });
}

function server(over: Partial<Server> = {}): Server {
  return { open: [], closed: [], found: {}, asked: [], cancels: [], ...over };
}

async function enter(
  page: Page,
  options: { theme?: Record<string, string>; version?: string } = {},
): Promise<void> {
  await page.goto("about:blank");
  await page.goto(launch(options));
  await openStore(page, "Основний MAIN");
  await section(page, "Замовлення");
}

const toSend = order({
  created_at: ago(3),
  items: [
    item("Лоран шоколад", "M", 2),
    item("Пальто Ірис", "L"),
    item("Шарф", null),
  ],
});
const sent = order({
  status: "DISPATCHED",
  created_at: ago(5),
  waybill: "20450012345678",
});
const arrived = order({
  status: "ARRIVED",
  created_at: ago(4),
  carrier: "UKRPOSHTA",
  waybill: "0505012345678",
  items: [item("Пальто подовжене вовняне Ірис з поясом", "XL")],
});
/** Abroad, a tracking link pasted whole into its note. */
const note =
  "https://tracking.example.com/parcel/PL12345678901234567890123456789 Варшава, Польща";
const abroad = order({
  status: "DISPATCHED",
  created_at: ago(6),
  destination: "ABROAD",
  carrier: null,
  abroad_note: note,
});
const collected = order({
  status: "COLLECTED",
  created_at: ago(9),
  payment_method: "CARD",
  waybill: "20450087654321",
});

test("what is to be sent and what is on its way on top, a row a parcel's tag with no sum; the closed under «Показати завершені» (orders task list, P0-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const orders = server({
    open: [sent, arrived, toSend],
    closed: [collected],
  });
  await stub(page, orders);
  await enter(page);
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  for (const gone of ["Оновити", "Знайти", "Попередні", "Наступні"])
    await expect(
      page.getByRole("button", { name: gone, exact: true }),
    ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Потрібно відправити · 1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "В дорозі · 2" }),
  ).toBeVisible();
  const ready = page
    .getByRole("list", { name: "Потрібно відправити" })
    .getByRole("button");
  await expect(ready.locator(".sale-goods")).toHaveText(
    "Лоран шоколад · M × 2Пальто Ірис · L+ ще 1",
  );
  await expect(ready.locator(".sale-meta")).toHaveText(
    `Нова пошта · ТТН ще немає · з\u00a0${short(toSend.created_at as string)}`,
  );
  await expect(ready.locator(".badge")).toHaveText("До відправлення");
  // On its way: oldest first, as the server reads them.
  const onWay = page
    .getByRole("list", { name: "В дорозі" })
    .getByRole("button");
  await expect(onWay.locator(".badge")).toHaveText([
    "Відправлено",
    "Прибув на пошту",
  ]);
  await expect(onWay.nth(1).locator(".sale-meta")).toHaveText(
    `Укрпошта · ТТН 0505012345678 · з\u00a0${short(arrived.created_at as string)}`,
  );
  // No sum, no way, no id's characters on any row (G32; В1).
  for (const row of await page.locator(".order-row").all()) {
    const text = await row.innerText();
    expect(text).not.toMatch(/грн|Готівка|Картка|Переказ|№/);
    expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // Under the heading and «+», only the field before the first row.
  const field = await page.getByLabel("Номер ТТН").boundingBox();
  const first = await page.locator(".order-row").first().boundingBox();
  expect(field && first && first.y > field.y + field.height).toBe(true);
  // The closed: none until asked for, not even read.
  await expect(page.getByRole("list", { name: "Завершені" })).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 500);
      }),
  );
  expect(orders.asked.filter((asked) => asked.startsWith("closed|"))).toEqual(
    [],
  );
  await page.getByRole("button", { name: "Показати завершені" }).click();
  const done = page
    .getByRole("list", { name: "Завершені" })
    .getByRole("button");
  await expect(done.locator(".badge")).toHaveText("Клієнт забрав");
  await expect(page.getByRole("heading", { name: "Завершені" })).toBeVisible();
  await page.getByRole("button", { name: "Сховати завершені" }).click();
  await expect(page.getByRole("list", { name: "Завершені" })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  // «+»: a new order.
  await page.getByRole("button", { name: "Нове замовлення" }).click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toBeVisible();
});

test("a waybill is found as it is typed, from two characters, Enter at once; kept while an order is opened; nothing found is said of what was typed only, and «Очистити» brings the list back (orders task list, P0-1)", async ({
  page,
}) => {
  const orders = server({
    open: [sent, toSend],
    closed: [collected],
    found: { "2045": [sent, collected], "2046": [toSend] },
  });
  await stub(page, orders);
  // The search's pause of 300 ms held back while `slowPause` is set: what
  // is then found was found by Enter.
  await page.addInitScript(() => {
    const host = window as unknown as {
      slowPause: boolean;
      setTimeout: typeof setTimeout;
    };
    const original = window.setTimeout.bind(window);
    host.slowPause = false;
    host.setTimeout = ((handler: TimerHandler, delay?: number) =>
      original(
        handler,
        host.slowPause && delay === 300 ? 600_000 : delay,
      )) as typeof setTimeout;
  });
  await enter(page);
  await expect(
    page.getByRole("heading", { name: "Потрібно відправити · 1" }),
  ).toBeVisible();
  const field = page.getByLabel("Номер ТТН");
  await field.fill("2");
  // One character asks nothing.
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 500);
      }),
  );
  const searched = (): string[] =>
    orders.asked
      .map((asked) => asked.split("|")[1] ?? "")
      .filter((waybill) => waybill !== "");
  expect(searched()).toEqual([]);
  await field.fill("2045");
  const found = page
    .getByRole("list", { name: "Знайдені замовлення" })
    .getByRole("button");
  await expect(found).toHaveCount(2);
  // Every status, with its pill; no group.
  await expect(found.locator(".badge")).toHaveText([
    "Відправлено",
    "Клієнт забрав",
  ]);
  await expect(page.getByRole("heading", { name: /Потрібно/ })).toHaveCount(0);
  // An order opened and left: the search as it was.
  await found.first().click();
  await page.getByRole("button", { name: "← До списку" }).click();
  await expect(field).toHaveValue("2045");
  await expect(found).toHaveCount(2);
  const none = page.getByText(
    "За «9999» замовлень не знайдено. Перевірте номер ТТН.",
  );
  await field.fill("9999");
  await expect(none).toBeVisible();
  // Another typed after nothing found: «not found» is never said of it
  // before its answer (review, 2026-10-23).
  let open = (): void => undefined;
  orders.heldFor = "2046";
  orders.gate = new Promise((done) => {
    open = done;
  });
  await field.fill("2046");
  await expect(page.getByText("Шукаємо…")).toBeVisible();
  await expect(page.getByText(/замовлень не знайдено/)).toHaveCount(0);
  open();
  await expect(found).toHaveCount(1);
  // Enter: at once, the pause held back.
  const slow = (on: boolean): Promise<void> =>
    page.evaluate((value) => {
      (window as unknown as { slowPause: boolean }).slowPause = value;
    }, on);
  await slow(true);
  await field.fill("99999");
  await field.press("Enter");
  await expect(
    page.getByText("За «99999» замовлень не знайдено. Перевірте номер ТТН."),
  ).toBeVisible();
  expect(searched()).toContain("99999");
  await slow(false);
  await page.getByRole("button", { name: "Очистити" }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Потрібно відправити · 1" }),
  ).toBeVisible();
});

test("more than a hundred open: «Показати ще» reads the rest, the groups counted once all are read; the closed fifty at a time, a row read twice shown once (orders task list, P0-1)", async ({
  page,
}) => {
  const many = Array.from({ length: 105 }, (_, index) =>
    order({ created_at: ago(30 - index / 10) }),
  );
  const done = Array.from({ length: 55 }, (_, index) =>
    order({ status: "COLLECTED", created_at: ago(40 + index / 10) }),
  );
  await stub(page, server({ open: many, closed: done }));
  await enter(page);
  const rows = page
    .getByRole("list", { name: "Потрібно відправити" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(100);
  // Not counted while there are more.
  await expect(
    page.getByRole("heading", { name: "Потрібно відправити", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(rows).toHaveCount(105);
  await expect(
    page.getByRole("heading", { name: "Потрібно відправити · 105" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Показати завершені" }).click();
  // The focus on what came in the button's place.
  await expect(page.getByRole("heading", { name: "Завершені" })).toBeFocused();
  const closedRows = page
    .getByRole("list", { name: "Завершені" })
    .getByRole("listitem");
  await expect(closedRows).toHaveCount(50);
  await page.getByRole("button", { name: "Показати ще" }).click();
  // The second page holds the first's last row again: shown once.
  await expect(closedRows).toHaveCount(55);
  await page.getByRole("button", { name: "Сховати завершені" }).click();
  await expect(
    page.getByRole("button", { name: "Показати завершені" }),
  ).toBeFocused();
});

test("no order yet says what an order does, with «Нове замовлення»; none open, but closed ones, says nothing is to be sent (orders task list, P0-1)", async ({
  page,
}) => {
  const orders = server();
  await stub(page, orders);
  await enter(page);
  await expect(
    page.getByText(
      "Замовлень ще немає. Замовлення тримає товар у резерві, поки його не відправили.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Показати завершені" }),
  ).toHaveCount(0);
  await page
    .locator(".orders-empty")
    .getByRole("button", { name: "Нове замовлення" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toBeVisible();

  orders.closed = [collected];
  await enter(page);
  await expect(
    page.getByText("Зараз нічого не треба відправляти."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Показати завершені" }).click();
  await expect(
    page.getByRole("list", { name: "Завершені" }).getByRole("button"),
  ).toHaveCount(1);
  await expect(
    page.getByText("Зараз нічого не треба відправляти."),
  ).toHaveCount(0);
});

test("«Скасувати замовлення» asks first, «Ні, залишити» keeps it, and «Так, скасувати» cancels once, with a buzz and what it did (orders task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
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
  const orders = server({ open: [{ ...toSend, id: randomUUID() }] });
  await stub(page, orders);
  await enter(page, { version: "6.1" });
  await page.locator(".order-row").first().click();
  const ask = page.getByRole("button", {
    name: "Скасувати замовлення",
    exact: true,
  });
  await ask.click();
  const question = page.getByRole("group", { name: /^Скасувати замовлення\?/ });
  await expect(question).toHaveText(
    /^Скасувати замовлення\? Резерв звільниться — товар знову можна продати\. Відновити замовлення не можна\./,
  );
  // The safe one under the finger.
  await expect(
    question.getByRole("button", { name: "Ні, залишити" }),
  ).toBeFocused();
  expect(orders.cancels).toEqual([]);
  await question.getByRole("button", { name: "Ні, залишити" }).click();
  await expect(question).toHaveCount(0);
  await expect(ask).toBeFocused();
  expect(orders.cancels).toEqual([]);
  await ask.click();
  await page.screenshot({ path: "test-results/order-cancel-ask.png" });
  await page.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(
    page.getByText("Замовлення скасовано, резерв звільнено."),
  ).toBeVisible();
  await expect(page.getByText("Скасовано", { exact: true })).toBeVisible();
  expect(orders.cancels).toEqual([{ command_id: expect.any(String) }]);
  const buzzes = await page.evaluate(
    () => (window as unknown as { buzzes: string[] }).buzzes,
  );
  expect(buzzes.map((data) => JSON.parse(data) as object)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
});

test("a cancel on its way holds «Ні, залишити» too; refused, it buzzes and brings why to the finger, the order kept (orders task list, P0-4)", async ({
  page,
}) => {
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
  let open = (): void => undefined;
  const orders = server({
    open: [{ ...toSend, id: randomUUID() }],
    cancelRefused: true,
    gate: new Promise((done) => {
      open = done;
    }),
  });
  await stub(page, orders);
  await enter(page, { version: "6.1" });
  await page.locator(".order-row").first().click();
  await page
    .getByRole("button", { name: "Скасувати замовлення", exact: true })
    .click();
  await page.getByRole("button", { name: "Так, скасувати" }).click();
  await expect.poll(() => orders.cancels.length).toBe(1);
  // On its way: it may still be recorded, so nothing says «kept».
  await expect(
    page.getByRole("button", { name: "Ні, залишити" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Так, скасувати" }),
  ).toBeDisabled();
  open();
  const why = page.getByRole("alert");
  await expect(why).toBeVisible();
  await expect(why).toBeFocused();
  const buzzes = await page.evaluate(
    () => (window as unknown as { buzzes: string[] }).buzzes,
  );
  expect(buzzes.map((data) => JSON.parse(data) as object)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await expect(
    page.getByText("До відправлення", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Замовлення скасовано/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ні, залишити" }),
  ).toBeEnabled();
});

test("a store that does not trade lists its orders with no «+» (orders task list, P0-1)", async ({
  page,
}) => {
  await stub(page, server({ open: [toSend] }));
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { id: string; state: string }[];
    };
    body.stores = body.stores.map((store) =>
      store.id === fixture.store_id ? { ...store, state: "BLOCKED" } : store,
    );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Замовлення");
  await expect(
    page.getByRole("heading", { name: "Потрібно відправити · 1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Нове замовлення" }),
  ).toHaveCount(0);
});

/** The WCAG contrast of an element's text against what it is drawn on. */
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
  test(`in the ${name} theme the list reads at 4.5:1, nothing wider than the phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await stub(page, server({ open: [abroad, sent, arrived, toSend] }));
    await enter(page, { theme });
    const first = page.locator(".order-row").first();
    await expect(first).toBeVisible();
    // A note pasted whole: its first sixty characters, broken where they
    // must, inside the row.
    const far = page
      .getByRole("list", { name: "В дорозі" })
      .getByRole("button")
      .first();
    await expect(far.locator(".sale-meta")).toHaveText(
      `За кордон · ${note.slice(0, 60)}… · з\u00a0${short(abroad.created_at as string)}`,
    );
    const row = await far.boundingBox();
    const meta = await far.locator(".sale-meta").boundingBox();
    expect(row && meta && meta.x + meta.width <= row.x + row.width).toBe(true);
    for (const part of [
      page.getByRole("heading", { name: "Потрібно відправити · 1" }),
      first.locator(".sale-goods span").first(),
      first.locator(".sale-meta"),
      first.locator(".badge"),
      page.getByRole("button", { name: "Нове замовлення" }),
      page.getByRole("button", { name: "Показати завершені" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/orders-list-${name}.png`,
      fullPage: true,
    });
  });
