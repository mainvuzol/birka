import {
  test,
  expect,
  basketDone,
  basketSheet,
  expectPlate,
  menu,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Нове замовлення» as the till sells (orders task list, P0-5; stage 2,
 * orders task list, P0-5, P1-3): a task screen, the menu stepped aside; a
 * few letters find the model, a tap on its size puts a line in the order at
 * the store's price, kept in the tray «У замовленні» and its sheet, where
 * «−»/«+» and «Прибрати» change it; where it goes one row of chips;
 * «Замовити та зарезервувати» Telegram's MainButton, or the dock's one
 * button outside it, and the card tears off what it reserved. The
 * warehouses, the goods and the server's answers are stubbed.
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
  options: { theme?: Record<string, string>; version?: string | null } = {},
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
  if (options.version !== null)
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
  /** Every `POST /orders` never answered while set: any other answer
   * meanwhile has the phone check a kept order at once (CI, #176). */
  loseAll?: boolean;
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
      if (server.lose || server.loseAll) {
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
  options: {
    theme?: Record<string, string>;
    /** Outside Telegram: no MainButton, the dock's one button. */
    outside?: boolean;
    version?: string;
  } = {},
): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
      mains: Record<string, unknown>[];
      closing: boolean[];
      pressWhen: string | null;
    };
    host.buzzes = [];
    host.mains = [];
    host.closing = [];
    host.pressWhen = null;
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
        if (event === "web_app_setup_closing_behavior")
          host.closing.push(
            (JSON.parse(data) as { need_confirmation: boolean })
              .need_confirmation,
          );
        if (event !== "web_app_setup_main_button") return;
        // Its MainButton, pressed the moment it says `pressWhen`, as a
        // double tap's second half would land on it.
        const told = JSON.parse(data) as Record<string, unknown>;
        host.mains.push(told);
        if (host.pressWhen === null || told.text !== host.pressWhen) return;
        host.pressWhen = null;
        setTimeout(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ eventType: "main_button_pressed" }),
              source: window.parent,
            }),
          );
        }, 0);
      },
    };
  });
  await stub(page, server);
  await page.goto("about:blank");
  await page.goto(
    launch({
      ...(options.theme ? { theme: options.theme } : {}),
      ...(options.outside
        ? { version: null }
        : options.version
          ? { version: options.version }
          : {}),
    }),
  );
  await openStore(page, "Основний MAIN");
  await section(page, "+ Нове замовлення");
}

/** Every buzz, as Telegram was told it. */
async function felt(page: Page): Promise<Record<string, string>[]> {
  const sent = await page.evaluate(
    () => (window as unknown as { buzzes: string[] }).buzzes,
  );
  return sent.map((data) => JSON.parse(data) as Record<string, string>);
}

/** The answers' buzzes: a choice's and a tap's are telegram-rules.spec's
 * («Усе на бірці» task list, P1-2). */
async function buzzes(page: Page): Promise<object[]> {
  return (await felt(page)).filter((buzz) => buzz.type === "notification");
}

function search(page: Page): Locator {
  return page.getByRole("searchbox", { name: "Знайти модель" });
}

function chip(page: Page, size: string, at = own): Locator {
  return page.locator(
    `button.size-cell[data-stock="${size}"][data-location="${at}"]`,
  );
}

/** The tray «У замовленні» under the thumb (stage 2, orders task list,
 * P0-5). */
function tray(page: Page): Locator {
  return page.locator(".order-tray");
}

/** The sheet «У замовленні», where the lines are changed. */
function sheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "У замовленні" });
}

/** Where it goes: one row of chips (P0-5; В-ЗП3 (а)). */
function whereTo(page: Page): Locator {
  return page.getByRole("group", { name: "Куди" });
}

async function carrier(page: Page, name: string): Promise<void> {
  await whereTo(page).getByRole("button", { name, exact: true }).click();
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

/** Telegram's MainButton pressed: the moment it says `text`, or now. */
async function pressMain(page: Page, text?: string): Promise<void> {
  await page.evaluate((wanted) => {
    if (wanted !== undefined) {
      (window as unknown as { pressWhen: string }).pressWhen = wanted;
      return;
    }
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  }, text);
}

/** What Telegram's MainButton was last told. */
async function main(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    () =>
      (window as unknown as { mains: Record<string, unknown>[] }).mains.at(
        -1,
      ) ?? null,
  );
}

/** Whether Telegram was last told to ask before closing. */
async function asks(page: Page): Promise<boolean | null> {
  return page.evaluate(
    () => (window as unknown as { closing: boolean[] }).closing.at(-1) ?? null,
  );
}

/** The reserve torn off as recorded over the thread (stage 2, orders task
 * list, P1-3): «До відправлення», what is held and from where, how many. */
async function reserved(
  page: Page,
  units: number,
  lines?: string[],
): Promise<void> {
  const stub = page.locator(".order-done .stub-recorded");
  await expect(stub.locator(".sticker")).toHaveText("До відправлення");
  await expect(stub.locator(".stub-line").last()).toHaveText(
    `Зарезервовано: ${String(units)} шт. Чекає відправлення.`,
  );
  if (lines) await expect(stub.locator(".stub-line strong")).toHaveText(lines);
}

test("a new order as a sale: a task screen, the cursor in the search, two letters find the model, its size a line in the tray at the store's price, «−»/«+» in its sheet to what is free, the carrier a chip, the MainButton, the card tears off what it reserved (stage 2, orders task list, P0-5, P1-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const stubbed = server();
  await open(page, stubbed, { version: "8.0" });
  await expect(
    page.getByRole("heading", { name: "Нове замовлення", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "До замовлень", exact: true }),
  ).toBeVisible();
  // A task screen: the menu steps aside (В-ЗП6 (а)).
  await expect(menu(page)).toBeHidden();
  // One warehouse: named in the screen's line, not chosen; the cursor in
  // the search at once.
  await expect(page.locator(".store-line .t-meta")).toHaveText(
    /^Склад: Свій · /,
  );
  await expect(page.locator(".order-new").getByRole("combobox")).toHaveCount(0);
  await expect(search(page)).toBeFocused();
  // The search scrolls with the form: only the till's stays at the top.
  await expect(page.locator(".find")).toHaveCSS("position", "static");
  // Nothing of the old form.
  for (const gone of [
    /Оберіть склад і товар/,
    /Вкажіть остаточну ціну/,
    /Номер накладної вписують/,
  ])
    await expect(page.getByText(gone)).toHaveCount(0);
  for (const gone of ["Додати товар", "Попередні товари", "Наступні товари"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByLabel("Кількість", { exact: true })).toHaveCount(0);
  // Nothing in it yet: no tray, and the MainButton set, held.
  await expect(tray(page)).toHaveCount(0);
  await expect
    .poll(() => main(page))
    .toMatchObject({
      is_visible: true,
      is_active: false,
      text: "Замовити та зарезервувати",
    });
  expect(await asks(page)).not.toBe(true);

  await search(page).fill("ло");
  await expect
    .poll(() => stubbed.reads.some((q) => q.includes("query=%D0%BB%D0%BE")))
    .toBe(true);
  await expect(page.getByRole("group", { name: "Мілан графіт" })).toHaveCount(
    0,
  );
  const tag = page.getByRole("group", { name: "Лоран шоколад" });
  await expect(tag.locator(".model-price")).toHaveText("1 850,00 грн");
  // L all held for other orders: no line of it, said on its cell — «у
  // резерві», and the pin of the two held («Усе на бірці» task list, P0-5).
  await expect(chip(page, `${loran}:${sizeL}`)).toBeDisabled();
  await expect(chip(page, `${loran}:${sizeL}`)).toHaveAttribute(
    "aria-label",
    "L, вільно 0, у резерві 2",
  );
  await expect(chip(page, `${loran}:${sizeL}`)).toContainText("у резерві");
  await expect(
    chip(page, `${loran}:${sizeL}`).locator(".size-held"),
  ).toHaveText("2");
  await page.screenshot({ path: "test-results/order-new-search.png" });
  await chip(page, `${loran}:${sizeM}`).click();
  // In the tray, felt; the search done with; Telegram asks before closing.
  await expect(tray(page).locator(".tray-count")).toHaveText(
    "У замовленні · 1",
  );
  await expect(tray(page).locator(".tray-what")).toHaveText(
    "Лоран шоколад · M",
  );
  // Its «›» as before, 24, until orders' own task (orders-cash P2-4;
  // review).
  await expect(tray(page).locator(".tray-open")).toHaveCSS("font-size", "24px");
  await expect(tray(page).locator(".pay-total")).toHaveText(
    "Разом 1 850,00 грн",
  );
  await expect(search(page)).not.toBeFocused();
  expect(await felt(page)).toContainEqual({
    type: "impact",
    impact_style: "light",
  });
  await expect.poll(() => asks(page)).toBe(true);
  // No carrier yet: the MainButton asks for one, held.
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_active: false, text: "Оберіть перевізника" });
  await expect(page.getByText("ТТН впишете, коли відправите.")).toBeVisible();

  // Its sheet: the line, where it leaves from, the store's price, which the
  // seller may change (В3 (а)); «+» to what is free.
  const lines = (await basketSheet(page)).locator(".line");
  await expect(lines).toHaveCount(1);
  await expect(lines.locator("strong")).toHaveText("Лоран шоколад · M");
  await expect(lines.locator(".line-place")).toHaveText("Склад: Свій");
  await expect(lines.getByLabel("Ціна, грн")).toHaveValue("1850,00");
  await expect(lines.getByLabel("Ціна, грн")).toHaveAttribute(
    "enterkeyhint",
    "done",
  );
  await expect(
    lines.getByText(
      "Ціна продажу 1 850,00 грн. Домовилися про іншу — змініть.",
    ),
  ).toBeVisible();
  await lines.getByRole("button", { name: "Більше" }).click();
  await expect(lines.locator("output")).toHaveText("2");
  await basketDone(page);
  await expect(tray(page).locator(".tray-count")).toHaveText(
    "У замовленні · 2",
  );
  // Its cell once more: three, and it takes no more, and looks it.
  await chip(page, `${loran}:${sizeM}`).click();
  await expect(chip(page, `${loran}:${sizeM}`)).toBeDisabled();
  await expect(chip(page, `${loran}:${sizeM}`)).toHaveCSS("opacity", "0.45");
  await expect(chip(page, `${loran}:${sizeM}`)).toHaveAttribute(
    "aria-label",
    "M, вільно 3, у замовленні 3",
  );
  await expect(tray(page).locator(".pay-total")).toHaveText(
    "Разом 5 550,00 грн",
  );
  const again = (await basketSheet(page)).locator(".line");
  await expect(again.locator("output")).toHaveText("3");
  await expect(again.getByRole("button", { name: "Більше" })).toBeDisabled();
  await again.getByRole("button", { name: "Менше" }).click();
  await again.getByRole("button", { name: "Менше" }).click();
  await expect(again.getByRole("button", { name: "Менше" })).toBeDisabled();
  await basketDone(page);

  // Nothing chosen for the seller: four chips, one row of where it goes.
  await expect(whereTo(page).getByRole("button")).toHaveText([
    "Нова пошта",
    "Укрпошта",
    "Міст",
    "За кордон",
  ]);
  await expect(
    whereTo(page).locator('button[aria-pressed="true"]'),
  ).toHaveCount(0);
  // The menu's tab is a choice felt too: only the chip's own counts here.
  const before = (await felt(page)).length;
  await carrier(page, "Нова пошта");
  const chosen = whereTo(page).getByRole("button", { name: "Нова пошта" });
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  // The chosen colours (spec §6.13), as a size cell chosen.
  const colours = await page.evaluate(() => {
    const probe = document.createElement("i");
    document.body.append(probe);
    probe.style.color = "var(--chosen)";
    const back = getComputedStyle(probe).color;
    probe.style.color = "var(--on-chosen)";
    const fore = getComputedStyle(probe).color;
    probe.remove();
    return { back, fore };
  });
  await expect(chosen).toHaveCSS("background-color", colours.back);
  await expect(chosen).toHaveCSS("color", colours.fore);
  expect((await felt(page)).slice(before)).toContainEqual({
    type: "selection_change",
  });
  await expect
    .poll(() => main(page))
    .toMatchObject({
      is_visible: true,
      is_active: true,
      text: "Замовити та зарезервувати",
    });
  // Each its word on one line, nothing wider than the phone.
  for (const each of await whereTo(page).getByRole("button").all())
    expect((await each.boundingBox())?.height).toBeLessThanOrEqual(56);
  // The page keeps the tray's height free (`shared/panel.ts`): the chips
  // never under it.
  const room = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--pay-panel-h"),
  );
  const height = (await tray(page).boundingBox())?.height ?? 0;
  expect(Math.abs(parseFloat(room) - height)).toBeLessThanOrEqual(1);
  await whereTo(page).scrollIntoViewIfNeeded();
  const over = await whereTo(page).boundingBox();
  const bar = await tray(page).boundingBox();
  expect(over && bar && over.y + over.height <= bar.y).toBe(true);
  // One result at 360 × 640: where it goes and the tray in view together.
  await expect(whereTo(page)).toBeInViewport({ ratio: 1 });
  await expect(tray(page)).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);

  await pressMain(page);
  await reserved(page, 1, ["Лоран шоколад · M · склад «Свій»"]);
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
  // The card from its top, never from where the form's foot left the page;
  // the menu back, the card's MainButton, nothing asked before closing.
  await expect(
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".order-done .stub-recorded")).toBeInViewport({
    ratio: 1,
  });
  await expect(menu(page)).toBeVisible();
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, text: "Відправити" });
  await expect.poll(() => asks(page)).toBe(false);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  await page.screenshot({ path: "test-results/order-new-reserved.png" });
});

test("a store with two warehouses: each cell says its own, the line leaves from the cell's (orders task list, P0-5; owner decision, 2026-10-17)", async ({
  page,
}) => {
  const stubbed = server({
    places: [place(own, "Свій"), place(shared, "Спільний")],
    rows: [row(), row({ location_id: shared, available_quantity: 2 })],
  });
  await open(page, stubbed);
  // Every warehouse at once, none chosen: the screen's line is the store's.
  await expect(page.getByText(/^Склад:/)).toHaveCount(0);
  await expect(chip(page, `${loran}:${sizeM}`, own)).toHaveText("MСвій 3");
  await expect(chip(page, `${loran}:${sizeM}`, own)).toHaveAttribute(
    "aria-label",
    "M, Свій, вільно 3",
  );
  await expect(chip(page, `${loran}:${sizeM}`, shared)).toHaveAttribute(
    "aria-label",
    "M, Спільний, вільно 2",
  );
  expect(stubbed.reads.every((q) => !q.includes("location_id"))).toBe(true);
  await chip(page, `${loran}:${sizeM}`, shared).click();
  const line = (await basketSheet(page)).locator(".line");
  await expect(line.locator("strong")).toHaveText("Лоран шоколад · M");
  await expect(line.locator(".line-place")).toHaveText("Склад: Спільний");
  await expect(
    line.getByRole("button", { name: "Прибрати Лоран шоколад · M · Спільний" }),
  ).toBeVisible();
  await basketDone(page);
  await carrier(page, "Укрпошта");
  await pressMain(page);
  await reserved(page, 1, ["Лоран шоколад · M · склад «Спільний»"]);
  const lines = stubbed.made[0]?.lines as Record<string, unknown>[];
  expect(lines.map((each) => each.source_location_id)).toEqual([shared]);
  expect(stubbed.made[0]?.carrier).toBe("UKRPOSHTA");
});

test("a model with no price: its sheet opens by itself, the cursor in its empty field, «Разом» a dash and the MainButton held; 0,00 asked about, what is no price said; «Прибрати» takes the line out, the tray with it (stage 2, orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await search(page).fill("мі");
  await chip(page, `${milan}:${sizeS}`).click();
  await expect(sheet(page)).toBeVisible();
  const line = sheet(page).locator(".line");
  const price = line.getByLabel("Ціна, грн");
  await expect(price).toHaveValue("");
  await expect(price).toBeFocused();
  // The keyboard's «Готово» puts it away and closes the sheet, nothing
  // sent.
  await expect(price).toHaveAttribute("enterkeyhint", "done");
  await price.press("Enter");
  await expect(sheet(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Нове замовлення", exact: true }),
  ).toBeVisible();
  await carrier(page, "Міст");
  await expect(tray(page).locator(".pay-total")).toHaveText("Разом —");
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_active: false, text: "Замовити та зарезервувати" });
  const field = (await basketSheet(page)).getByLabel("Ціна, грн");
  await field.focus();
  await expect(
    sheet(page).getByText(
      "Ціни продажу ще немає — впишіть домовлену. Ціну для всіх задає менеджер: «Продаж» › назва моделі › «Змінити ціну».",
    ),
  ).toBeVisible();
  await field.fill("15,5,5");
  await expect(
    sheet(page).getByText(
      "Впишіть ціну: гривні й копійки, напр. 1850 або 1850,50.",
    ),
  ).toBeVisible();
  await expect.poll(() => main(page)).toMatchObject({ is_active: false });
  await field.fill("0");
  await expect(
    sheet(page).getByText(
      "Ціна 0,00 грн. Це справді подарунок? Перевірте ціну.",
    ),
  ).toBeVisible();
  await expect.poll(() => main(page)).toMatchObject({ is_active: true });
  await field.fill("1700");
  await basketDone(page);
  await expect(tray(page).locator(".pay-total")).toHaveText(
    "Разом 1 700,00 грн",
  );
  await (
    await basketSheet(page)
  )
    .getByRole("button", { name: "Прибрати Мілан графіт · S" })
    .click();
  // Nothing left: the sheet and the tray go, the cursor to the search.
  await expect(sheet(page)).toHaveCount(0);
  await expect(tray(page)).toHaveCount(0);
  await expect(search(page)).toBeFocused();
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_active: false, text: "Замовити та зарезервувати" });
  expect(stubbed.made).toEqual([]);
});

test("abroad: one chip of the row, no carrier, how it went said when it is sent, the MainButton at once; the body without a carrier (stage 2, orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Укрпошта");
  await carrier(page, "За кордон");
  // One chosen at a time.
  await expect(whereTo(page).locator('button[aria-pressed="true"]')).toHaveText(
    ["За кордон"],
  );
  await expect(
    page.getByText("Куди і як відправили — впишете, коли відправите.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("ТТН впишете, коли відправите.")).toHaveCount(0);
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_active: true, text: "Замовити та зарезервувати" });
  // Within Ukraine again by its carrier, then abroad once more.
  await carrier(page, "Нова пошта");
  await expect(page.getByText("ТТН впишете, коли відправите.")).toBeVisible();
  await carrier(page, "За кордон");
  await pressMain(page);
  await reserved(page, 1);
  expect(stubbed.made[0]?.destination).toBe("ABROAD");
  expect(stubbed.made[0]).not.toHaveProperty("carrier");
});

test("short of stock: the sheet opens on the line the server names, marked with what is free, focused, the rest as typed and the goods read again; changed, sent again (stage 2, orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${milan}:${sizeS}`).click();
  await (
    await basketSheet(page)
  )
    .locator(".line")
    .first()
    .getByLabel("Ціна, грн")
    .fill("1700");
  await basketDone(page);
  await chip(page, `${loran}:${sizeM}`).click();
  await (
    await basketSheet(page)
  )
    .locator(".line")
    .nth(1)
    .getByRole("button", { name: "Більше" })
    .click();
  await basketDone(page);
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
  await pressMain(page);
  // Taps taken once it has risen.
  await expect(sheet(page)).toHaveAttribute("data-ready", "");
  const lines = sheet(page).locator(".line");
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
  await expect(
    whereTo(page).getByRole("button", { name: "Нова пошта" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => stubbed.reads.length).toBeGreaterThan(reads);
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_active: true, text: "Замовити та зарезервувати" });
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
  await basketDone(page);
  await pressMain(page);
  await reserved(page, 2);
  expect(stubbed.made).toHaveLength(2);
  expect(
    (stubbed.made[1]?.lines as Record<string, unknown>[]).map(
      (each) => each.quantity,
    ),
  ).toEqual([1, 1]);
});

test("short of stock with none free: said so in the sheet, and to take the line out (orders task list, P0-5)", async ({
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
  await pressMain(page);
  await expect(
    sheet(page).getByText("Доступних уже немає. Приберіть рядок.", {
      exact: true,
    }),
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
  await pressMain(page);
  await expect(page.getByText(/^Доступних уже немає/)).toBeFocused();
  await basketDone(page);
  await page.getByRole("button", { name: "До замовлень", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Нове замовлення" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Нове замовлення" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(tray(page)).toHaveCount(0);
});

test("refused for another reason: said over «Куди» and brought to the finger, with its buzz; the lines and the carrier kept (stage 2, orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await (
    await basketSheet(page)
  )
    .getByRole("button", { name: "Більше" })
    .click();
  await basketDone(page);
  await carrier(page, "Міст");
  stubbed.fail = {
    status: 409,
    json: { code: "IDEMPOTENCY_CONFLICT", message: "Conflict", details: {} },
  };
  await pressMain(page);
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "Не записано: дані замовлення змінилися, поки ви працювали. Перевірте замовлення й спробуйте ще раз.",
  );
  await expect(alert).toBeFocused();
  // On its screen, over the row it was about to go by.
  await expect(page.locator(".order-new [role=alert]")).toHaveCount(1);
  const plate = await alert.boundingBox();
  const row = await whereTo(page).boundingBox();
  expect(plate && row && plate.y + plate.height <= row.y).toBe(true);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  // A refusal's plate, never a debt's, in both themes (stage 2, orders task
  // list, P0-2).
  await expectPlate(alert, "refused");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPlate(alert, "refused", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(tray(page).locator(".tray-count")).toHaveText(
    "У замовленні · 2",
  );
  await expect(
    whereTo(page).getByRole("button", { name: "Міст" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => main(page)).toMatchObject({ is_active: true });
  await expect(page.locator(".line.short")).toHaveCount(0);
});

test("the MainButton pressed over the sheet «У замовленні»: the sheet goes, a refusal said on the page and brought to the finger, a lost answer's check in reach (review, 2026-11-05)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await carrier(page, "Нова пошта");
  await search(page).fill("мі");
  // A model with no price: its sheet opens by itself, the price typed in
  // it, and the MainButton pressed from there.
  await chip(page, `${milan}:${sizeS}`).click();
  await expect(sheet(page)).toHaveAttribute("data-ready", "");
  await sheet(page).getByLabel("Ціна, грн").fill("1700");
  stubbed.fail = {
    status: 409,
    json: { code: "IDEMPOTENCY_CONFLICT", message: "Conflict", details: {} },
  };
  await pressMain(page);
  await expect(sheet(page)).toHaveCount(0);
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    "Не записано: дані замовлення змінилися, поки ви працювали. Перевірте замовлення й спробуйте ще раз.",
  );
  await expect(alert).toBeFocused();
  await expect(tray(page).locator(".pay-total")).toHaveText(
    "Разом 1 700,00 грн",
  );
  // Its answer lost, pressed over the sheet again: the check is on the
  // page, under the finger.
  // (Each answer once: the refusal is spent.)
  stubbed.loseAll = true;
  await basketSheet(page);
  await pressMain(page);
  await expect(sheet(page)).toHaveCount(0);
  const retry = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  await expect(retry).toBeEnabled();
  stubbed.loseAll = false;
  const settled = page.locator(".order-done .stub-recorded");
  const pressed = retry.click().catch(() => undefined);
  await Promise.race([pressed, settled.waitFor()]);
  await reserved(page, 1);
});

test("a new order whose answer never came: checked again with the same command, it says what it reserved (orders task list, P0-5; review, 2026-10-24)", async ({
  page,
}) => {
  // Every answer lost until the check is pressed: the phone's own checks
  // meanwhile lost too, so the check stays to press.
  const stubbed = server({ loseAll: true });
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  await pressMain(page);
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
  // Kept, never refused: felt once, a warning (spec §4.4; «Усе на бірці»
  // task list, P1-2) — and the MainButton held meanwhile.
  const warned = { type: "notification", notification_type: "warning" };
  expect(await buzzes(page)).toEqual([warned]);
  await expect.poll(() => main(page)).toMatchObject({ is_active: false });
  // Pressed — unless the phone, answered meanwhile by another read, checks
  // it by itself first (ADR-0013 §4.3): either way, the same command, and
  // the same stub as at once (P1-3).
  stubbed.loseAll = false;
  const stub = page.locator(".order-done .stub-recorded");
  const pressed = retry.click().catch(() => undefined);
  await Promise.race([pressed, stub.waitFor()]);
  await reserved(page, 1);
  // Each time the same command: byte for byte, and nothing only shown in
  // it (P1-1).
  expect(stubbed.made.length).toBeGreaterThanOrEqual(2);
  expect(stubbed.made[0]?.command_id).toEqual(expect.any(String));
  for (const sent of stubbed.made) expect(sent).toEqual(stubbed.made[0]);
  expect(stubbed.made[0]).not.toHaveProperty("shown");
  expect(await buzzes(page)).toEqual([
    warned,
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
  await pressMain(page);
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
  await reserved(page, 1);
  expect(stubbed.made).toHaveLength(1);
});

test("a new order is five taps, the search typed: «Замовлення», «+», the size, the carrier and the MainButton (stage 2, orders task list, P0-5; «Усе на бірці» task list, P0-4: «Замовлення» a tab, 2 to the form)", async ({
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
  // Four taps on the page, the fifth on Telegram's MainButton.
  await pressMain(page);
  await reserved(page, 1);
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(4);
  expect(stubbed.made).toHaveLength(1);
});

test("a double tap on «Замовити та зарезервувати» never sends the parcel: the card's MainButton «Відправити» shown in its place lets that tap go (orders task list, P0-5; review, 2026-10-24; «Усе на бірці» sections task list, P0-2)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await chip(page, `${loran}:${sizeM}`).click();
  await carrier(page, "Нова пошта");
  await pressMain(page, "Відправити");
  await pressMain(page);
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, text: "Відправити" });
  await pause(page, 300);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(stubbed.steps).toEqual([]);
  expect(stubbed.made).toHaveLength(1);
  // A moment later, as meant: its sheet, and sent from it.
  await pause(page, 600);
  await pressMain(page);
  const sending = page.getByRole("dialog", { name: "Відправити" });
  await expect(sending).toHaveAttribute("data-ready", "");
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, text: "Відправлено" });
  await pressMain(page);
  await expect.poll(() => stubbed.steps).toEqual(["dispatch"]);
});

test("«← До замовлень» goes back to the list, nothing sent: the MainButton taken away, the menu back (stage 2, orders task list, P0-5)", async ({
  page,
}) => {
  const stubbed = server();
  await open(page, stubbed);
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, text: "Замовити та зарезервувати" });
  await page.getByRole("button", { name: "До замовлень", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Нове замовлення" }).first(),
  ).toBeVisible();
  await expect.poll(() => main(page)).toEqual({ is_visible: false });
  await expect(menu(page)).toBeVisible();
  expect(stubbed.made).toEqual([]);
});

test("outside Telegram the MainButton is the dock's one button: set on entry and held, «Оберіть перевізника» until a carrier, then ordered; its room kept (stage 2, orders task list, P0-5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const stubbed = server();
  await open(page, stubbed, { outside: true });
  expect(await main(page)).toBeNull();
  const dock = page.locator(".order-dock .main-mimic");
  await expect(dock).toHaveText("Замовити та зарезервувати");
  await expect(dock).toBeDisabled();
  // Its room kept from the first moment, before any line: nothing of the
  // page ends under it.
  const panel = page.locator(".order-dock");
  await expect
    .poll(async () => {
      const room = await page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--pay-panel-h"),
      );
      const height = (await panel.boundingBox())?.height ?? 0;
      return room !== "" && Math.abs(parseFloat(room) - height) <= 1;
    })
    .toBe(true);
  await chip(page, `${loran}:${sizeM}`).click();
  await expect(tray(page).locator(".main-mimic")).toHaveText(
    "Оберіть перевізника",
  );
  await expect(dock).toBeDisabled();
  await carrier(page, "Нова пошта");
  await expect(dock).toHaveText("Замовити та зарезервувати");
  await expect(dock).toBeEnabled();
  await expect(dock).toBeInViewport({ ratio: 1 });
  expect((await dock.boundingBox())?.height).toBeGreaterThanOrEqual(50);
  const room = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--pay-panel-h"),
  );
  const height = (await tray(page).boundingBox())?.height ?? 0;
  expect(Math.abs(parseFloat(room) - height)).toBeLessThanOrEqual(1);
  await dock.click();
  await reserved(page, 1);
  expect(stubbed.made).toHaveLength(1);
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
    await open(page, server(), { theme });
    await chip(page, `${loran}:${sizeM}`).click();
    await carrier(page, "Нова пошта");
    for (const part of [
      page.getByRole("heading", { name: "Нове замовлення" }),
      page.locator(".model-head strong").first(),
      chip(page, `${loran}:${sizeM}`),
      whereTo(page).getByRole("button", { name: "Нова пошта" }),
      whereTo(page).getByRole("button", { name: "Укрпошта" }),
      page.locator(".order-new .hint"),
      tray(page).locator(".tray-count"),
      tray(page).locator(".tray-what"),
      tray(page).locator(".pay-total"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-new-${name}.png` });
    const lines = (await basketSheet(page)).locator(".line");
    for (const part of [
      lines.locator("strong"),
      lines.locator(".line-place"),
      lines.locator(".hint").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/order-new-sheet-${name}.png` });
  });
