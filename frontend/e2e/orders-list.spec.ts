import {
  test,
  expect,
  expectPlate,
  openStore,
  section,
  shippedFace,
  expectEmpty,
  expectOneSticker,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Замовлення» (spec S16; «Усе на бірці» sections task list, P0-1): the
 * string of places — «До відправлення», «Відправлено», «Прибув на пошту»
 * counted, «Клієнт забрав» — as the filter, a list a place, newest first
 * (owner decision, 2026-10-23); those to be sent by their warehouse; a row
 * a tag with no sum, its next step its verb; the cancelled and come back a
 * screen of their own; a waybill found as it is typed; «+» for a new one.
 * And a cancel asked first (orders task list, P0-4), by Telegram's own
 * popup where it has one (P0-2). The orders are stubbed.
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
  from: string = randomUUID(),
): Record<string, unknown> {
  return {
    id: randomUUID(),
    product_variant_id: randomUUID(),
    size_id: randomUUID(),
    source_location_id: from,
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

/** A warehouse as `/stock-locations` answers it. */
function warehouse(id: string, name: string): Record<string, unknown> {
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

interface Server {
  open: Stubbed[];
  closed: Stubbed[];
  found: Record<string, Stubbed[]>;
  asked: string[];
  cancels: unknown[];
  arrives: unknown[];
  dispatches: unknown[];
  /** A waybill whose search waits for `gate`. */
  heldFor?: string;
  gate?: Promise<void>;
  /** The cancel's answer, once `gate` opens: refused, or recorded. */
  cancelRefused?: boolean;
  /** The next «Прибув на пошту»'s answer: refused, or lost on the way. */
  arriveAnswer?: "refused" | "lost";
  /** The next «Прибув на пошту» answered only once this opens. */
  arriveHeld?: Promise<void>;
  /** The open orders answered only once this opens. */
  openHeld?: Promise<void>;
  /** The open orders' read fails with the server's own error. */
  openFails?: boolean;
  /** The store's warehouses, where they are stubbed. */
  places?: Record<string, unknown>[];
  /** The warehouses answered only once this opens. */
  placesHeld?: Promise<void>;
  /** The warehouses' read refused. */
  placesRefused?: boolean;
  /** How many times the warehouses were asked. */
  placesAsked?: number;
  /** Pages refused once, by what was asked: «open||100», «closed||50»,
   * «|2045|50». */
  pageFails?: Set<string>;
  /** An order's own read answered only once this opens. */
  detailHeld?: Promise<void>;
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
      const asked = `${status ?? ""}|${waybill ?? ""}|${String(offset)}`;
      server.asked.push(asked);
      if (server.pageFails?.delete(asked)) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL_ERROR", message: "Internal error" },
        });
        return;
      }
      if (waybill !== null && waybill === server.heldFor) await server.gate;
      if (status === "open" && server.openHeld) await server.openHeld;
      if (status === "open" && server.openFails) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL_ERROR", message: "Internal error" },
        });
        return;
      }
      const closed = ["COLLECTED", "CANCELLED", "RETURNED"];
      const all =
        waybill !== null
          ? (server.found[waybill] ?? [])
          : status === "open"
            ? server.open.filter((each) => !closed.includes(each.status))
            : status === "closed"
              ? server.closed
              : [...server.open, ...server.closed];
      // Newest first, a page may hold the last row of the one before: an
      // order made meanwhile moves the pages' edge.
      const start = offset > 0 ? offset - 1 : offset;
      await route.fulfill({
        json: {
          orders: all.slice(start, offset + limit),
          has_more: all.length > offset + limit,
        },
      });
    },
  );
  await page.route("**/api/v1/orders/*", async (route, request) => {
    if (server.detailHeld) await server.detailHeld;
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
  for (const [step, becomes, sent] of [
    ["arrive", "ARRIVED", server.arrives],
    ["dispatch", "DISPATCHED", server.dispatches],
  ] as const)
    await page.route(`**/api/v1/orders/*/${step}`, async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      sent.push(body);
      const answer = step === "arrive" ? server.arriveAnswer : undefined;
      delete server.arriveAnswer;
      const held = step === "arrive" ? server.arriveHeld : undefined;
      delete server.arriveHeld;
      if (held) await held;
      if (answer === "lost") {
        await route.abort("failed");
        return;
      }
      if (answer === "refused") {
        await route.fulfill({
          status: 409,
          json: { code: "CONFLICT", message: "Conflict", details: {} },
        });
        return;
      }
      const id = new URL(request.url()).pathname.split("/").at(-2);
      const found = server.open.find((each) => each.id === id);
      if (found) {
        found.status = becomes;
        if (typeof body.waybill === "string") found.waybill = body.waybill;
      }
      await route.fulfill({ json: found });
    });
  // Read as asked: the warehouses may be renamed between entries.
  if (server.places)
    await page.route("**/api/v1/stock-locations?**", async (route) => {
      server.placesAsked = (server.placesAsked ?? 0) + 1;
      if (server.placesHeld) await server.placesHeld;
      if (server.placesRefused) {
        await route.fulfill({
          status: 403,
          json: { code: "FORBIDDEN", message: "Forbidden" },
        });
        return;
      }
      await route.fulfill({ json: server.places ?? [] });
    });
}

function server(over: Partial<Server> = {}): Server {
  return {
    open: [],
    closed: [],
    found: {},
    asked: [],
    cancels: [],
    arrives: [],
    dispatches: [],
    ...over,
  };
}

/** Everything the app tells Telegram, heard. */
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
        host.told.push([event, data ? (JSON.parse(data) as unknown) : null]);
      },
    };
  });
}

/** What Telegram was told of one kind. */
async function told(page: Page, event: string): Promise<unknown[]> {
  const all = await page.evaluate(
    () => (window as unknown as { told: [string, unknown][] }).told,
  );
  return all.filter(([each]) => each === event).map(([, data]) => data);
}

/** Its buzzes, by their kind: «selection», «success», «error»… */
async function buzzes(page: Page): Promise<string[]> {
  return (await told(page, "web_app_trigger_haptic_feedback")).map((data) => {
    const buzz = data as { type: string; notification_type?: string };
    return buzz.notification_type ?? buzz.type;
  });
}

/** Telegram tells the app something. */
async function fire(
  page: Page,
  eventType: string,
  eventData?: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([type, data]) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: type, eventData: data }),
          source: window.parent,
        }),
      );
    },
    [eventType, eventData] as const,
  );
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

/** The string of places, the list's filter. */
function knots(page: Page): Locator {
  return page.getByRole("group", { name: "Замовлення", exact: true });
}

function knot(page: Page, name: string): Locator {
  return knots(page).getByRole("button", { name, exact: true });
}

/** A place's rows, or a warehouse's. */
function rows(page: Page, name: string): Locator {
  return page.getByRole("list", { name, exact: true }).locator(".order-row");
}

/** The rows drawn: the open orders read and, for whoever reads the stock,
 * the warehouses — the rows come where their places stood, and a tap within
 * 0.7 s of that is let go. So a journey's pause starts from there, never
 * from the screen opened: on CI the warehouses once answered 650 ms before
 * the tap (2026-11-11). */
async function drawn(page: Page): Promise<void> {
  await expect(
    page.getByRole("status").filter({
      hasText: /^Завантажуємо (замовлення|склади)…$/,
    }),
  ).toHaveCount(0);
}

/** A tap within 0.7 s of the list changing is taken as meant for the list
 * before (review, 2026-10-24). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 800);
      }),
  );
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
const cancelled = order({
  status: "CANCELLED",
  created_at: ago(10),
  items: [item("Ріо графіт", "L")],
});
const returned = order({
  status: "RETURNED",
  created_at: ago(11),
  waybill: "20450011112222",
  items: [item("Нора бордо", "M")],
});
const collected = order({
  status: "COLLECTED",
  created_at: ago(9),
  payment_method: "CARD",
  waybill: "20450087654321",
});

/** Seven open, three · two · two, and three closed. */
function seven(): Server {
  return server({
    open: [
      toSend,
      order({ created_at: ago(2), items: [item("Кокон графіт", "M")] }),
      order({ created_at: ago(1), items: [item("Мишка чорний", "S")] }),
      sent,
      abroad,
      arrived,
      order({
        status: "ARRIVED",
        created_at: ago(7),
        waybill: "20450099990000",
      }),
    ],
    closed: [collected, cancelled, returned],
  });
}

test("the string of places is the filter: «До відправлення 3 · Відправлено 2 · Прибув на пошту 2 · Клієнт забрав», a list a place, a row a tag with no sum, felt on a knot and never on a scroll; the cancelled and come back a screen of their own («Усе на бірці» sections task list, P0-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await hear(page);
  const orders = seven();
  await stub(page, orders);
  await enter(page, { version: "7.0" });
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await expect(knots(page).getByRole("button")).toHaveText([
    "До відправлення 3",
    "Відправлено 2",
    "Прибув на пошту 2",
    "Клієнт забрав",
  ]);
  // To be sent, chosen: a mode, never an action.
  await expect(knot(page, "До відправлення 3")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const other of ["Відправлено 2", "Прибув на пошту 2", "Клієнт забрав"])
    await expect(knot(page, other)).toHaveAttribute("aria-pressed", "false");
  // In one row, each 44 to the touch.
  const tops = new Set<number>();
  for (const each of await knots(page).getByRole("button").all()) {
    const box = await each.boundingBox();
    tops.add(Math.round(box?.y ?? -1));
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(tops.size).toBe(1);
  // No group headings of before.
  for (const gone of ["Потрібно відправити", "В дорозі", "Показати завершені"])
    await expect(page.getByText(gone)).toHaveCount(0);

  const ready = rows(page, "До відправлення");
  await expect(ready).toHaveCount(3);
  await expect(ready.first().locator(".order-tag-title")).toHaveText(
    "Лоран шоколад · M × 2Пальто Ірис · L+ ще 1",
  );
  await expect(ready.first().locator(".order-tag-meta")).toHaveText(
    `Нова пошта · ТТН ще немає · з\u00a0${short(toSend.created_at as string)}`,
  );
  // Its eyelet filled in the waiting's colour, no sticker: the place says
  // it.
  await expect(
    page.locator("article.order-tag.filled.tone-online"),
  ).toHaveCount(3);
  await expect(page.locator(".order-tag .sticker")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "До відправлення" }).getByRole("button", {
      name: "Відправити",
    }),
  ).toHaveCount(3);
  // No sum, no way, no id's characters on any tag (G32; В1); a tag 76 high.
  for (const tag of await page.locator("article.order-tag").all()) {
    const text = await tag.innerText();
    expect(text).not.toMatch(/грн|Готівка|Картка|Переказ|№/);
    expect(text).not.toContain(toSend.id.slice(0, 8));
    expect((await tag.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(76);
  }
  // Under the heading and «+», the field and the string before the first
  // row, which stands whole over the menu.
  const field = await page.getByLabel("Номер ТТН").boundingBox();
  const string = await knots(page).boundingBox();
  const first = await page.locator("article.order-tag").first().boundingBox();
  const menu = await page
    .getByRole("navigation", { name: "Розділи" })
    .boundingBox();
  expect(field && string && string.y > field.y + field.height).toBe(true);
  expect(first && string && first.y > string.y + string.height).toBe(true);
  expect(first && menu && first.y + first.height <= menu.y).toBe(true);
  // The closed: not read until their place is chosen.
  await settle(page);
  expect(orders.asked.filter((asked) => asked.startsWith("closed|"))).toEqual(
    [],
  );

  // On their way: rings in transit's colour, their next step on each. The
  // menu's tap that opened «Замовлення» felt before.
  const felt = (await buzzes(page)).length;
  const knotsFelt = async (): Promise<string[]> =>
    (await buzzes(page)).slice(felt);
  await knot(page, "Відправлено 2").click();
  await expect(knot(page, "Відправлено 2")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rows(page, "Відправлено")).toHaveCount(2);
  await expect(page.locator("article.order-tag.ring.tone-transit")).toHaveCount(
    2,
  );
  await expect(
    page
      .getByRole("list", { name: "Відправлено" })
      .getByRole("button", { name: "Прибув на пошту" }),
  ).toHaveCount(2);
  expect(await knotsFelt()).toEqual(["selection_change"]);
  // A scroll is never felt.
  await page.mouse.wheel(0, 400);
  await settle(page);
  expect(await knotsFelt()).toEqual(["selection_change"]);

  await knot(page, "Прибув на пошту 2").click();
  await expect(rows(page, "Прибув на пошту")).toHaveCount(2);
  await expect(rows(page, "Прибув на пошту").first()).toContainText(
    `Укрпошта · ТТН 0505012345678 · з\u00a0${short(arrived.created_at as string)}`,
  );
  await expect(
    page
      .getByRole("list", { name: "Прибув на пошту" })
      .getByRole("button", { name: "Клієнт забрав" }),
  ).toHaveCount(2);

  // Collected: read now, each with its sticker and its knot, no verb.
  await knot(page, "Клієнт забрав").click();
  const done = page.getByRole("list", { name: "Клієнт забрав" });
  await expect(done.locator(".order-row")).toHaveCount(1);
  await expect(done.locator(".sticker")).toHaveText("Клієнт забрав");
  await expect(done.locator(".sticker")).toHaveClass("sticker tone-paid");
  await expectOneSticker(done);
  await expect(done.locator("article.order-tag.tied.tone-paid")).toHaveCount(1);
  await expect(done.locator(".tag-verb")).toHaveCount(0);
  expect(await knotsFelt()).toEqual([
    "selection_change",
    "selection_change",
    "selection_change",
  ]);

  // The cancelled and come back, a screen of their own.
  const link = page.getByRole("button", {
    name: "Скасовані й повернені на склад",
  });
  await link.click();
  const heading = page.getByRole("heading", {
    name: "Скасовані й повернені на склад",
  });
  await expect(heading).toBeFocused();
  const gone = page.getByRole("list", {
    name: "Скасовані й повернені на склад",
  });
  await expect(gone.locator(".sticker")).toHaveText([
    "Скасовано",
    "Повернено на склад",
  ]);
  await expect(gone.locator(".sticker").first()).toHaveClass(
    "sticker tone-offline",
  );
  await expectOneSticker(gone);
  await expect(gone.locator(".sticker > svg.icon")).toHaveCount(2);
  await expect(knots(page)).toHaveCount(0);
  await page.getByRole("button", { name: "До замовлень", exact: true }).click();
  await expect(knot(page, "Клієнт забрав")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(link).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  // «+»: a new order.
  await page.getByRole("button", { name: "Нове замовлення" }).click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toBeVisible();
});

test("those to be sent by their warehouse: «Склад «Основний» · 2», «Склад «Свій» · 1», «З кількох складів · 1», each order once; without the stock's right, one list («Усе на бірці» sections task list, P0-1)", async ({
  page,
}) => {
  const main = randomUUID();
  const own = randomUUID();
  const grouped = server({
    open: [
      order({ items: [item("Лоран шоколад", "M", 1, main)] }),
      order({ items: [item("Кокон графіт", "L", 1, own)] }),
      order({
        items: [
          item("Мишка чорний", "S", 1, main),
          item("Нора бордо", "M", 1, own),
        ],
      }),
      order({ items: [item("Ріо графіт", "L", 1, main)] }),
    ],
    places: [warehouse(main, "Основний"), warehouse(own, "Свій")],
  });
  await stub(page, grouped);
  await enter(page);
  await expect(page.locator(".order-place-label")).toHaveText([
    "Склад «Основний» · 2",
    "Склад «Свій» · 1",
    "З кількох складів · 1",
  ]);
  await expect(rows(page, "Склад «Основний»")).toHaveText([
    /^Лоран шоколад · M/,
    /^Ріо графіт · L/,
  ]);
  await expect(rows(page, "Склад «Свій»")).toHaveText([/^Кокон графіт · L/]);
  await expect(rows(page, "З кількох складів")).toHaveText([
    /^Мишка чорний · SНора бордо · M/,
  ]);
  await expect(page.locator(".order-row")).toHaveCount(4);

  // The warehouses read after the list: the rows' places, a label's over
  // them, never one list the labels come over later — the rows come under
  // their labels where their places stood, and none moves once shown
  // (orders and «Каса» task list after stage 2, P1-1); a tap as they come
  // is let go (review, 2026-11-01).
  let release = (): void => undefined;
  grouped.placesHeld = new Promise<void>((done) => {
    release = done;
  });
  await enter(page);
  const placed = page.locator(".placeholder .order-tag");
  await expect(placed).toHaveCount(3);
  await expect(page.locator(".order-row")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Завантажуємо склади…" }),
  ).toBeAttached();
  await settle(page);
  const firstPlace = await placed.first().boundingBox();
  const labelPlace = await page.locator(".skeleton-place-label").boundingBox();
  release();
  await expect(page.locator("h3.order-place-label")).toHaveCount(3);
  await expect(placed).toHaveCount(0);
  const firstRow = page.locator("article.order-tag").first();
  const came = await firstRow.boundingBox();
  expect(Math.abs((came?.y ?? 0) - (firstPlace?.y ?? 0))).toBeLessThanOrEqual(
    1,
  );
  expect(
    Math.abs(
      ((await page.locator("h3.order-place-label").first().boundingBox())?.y ??
        0) - (labelPlace?.y ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  const verb = page
    .getByRole("list", { name: "Склад «Основний»", exact: true })
    .getByRole("button", { name: "Відправити" })
    .first();
  await verb.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settle(page);
  // Shown, no row moved under the finger.
  expect((await firstRow.boundingBox())?.y).toBe(came?.y);
  await verb.click();
  await expect(page.getByRole("dialog", { name: "Відправити" })).toBeVisible();
  delete grouped.placesHeld;

  // The warehouses refused: one list, as before — its rows come where
  // their places stood, and a tap as they do is let go (review).
  grouped.placesRefused = true;
  let refuse = (): void => undefined;
  grouped.placesHeld = new Promise<void>((done) => {
    refuse = done;
  });
  await enter(page);
  await expect(placed).toHaveCount(3);
  await settle(page);
  refuse();
  await expect(rows(page, "До відправлення")).toHaveCount(4);
  const send = page
    .getByRole("list", { name: "До відправлення", exact: true })
    .getByRole("button", { name: "Відправити" })
    .first();
  await send.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settle(page);
  await send.click();
  await expect(page.getByRole("dialog", { name: "Відправити" })).toBeVisible();
  delete grouped.placesHeld;
  await enter(page);
  await expect(rows(page, "До відправлення")).toHaveCount(4);
  await expect(page.locator(".order-place-label")).toHaveCount(0);
  // Read again on return to the app, its answer not come yet: the rows
  // shown stay, no places come over them (review).
  const askedBefore = grouped.placesAsked ?? 0;
  let answer = (): void => undefined;
  grouped.placesHeld = new Promise<void>((done) => {
    answer = done;
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => grouped.placesAsked ?? 0)
    .toBeGreaterThan(askedBefore);
  await settle(page);
  await expect(rows(page, "До відправлення")).toHaveCount(4);
  await expect(page.locator(".placeholder")).toHaveCount(0);
  answer();
  await expect(page.locator(".order-place-label")).toHaveCount(0);
  await settle(page);
  delete grouped.placesHeld;
  delete grouped.placesRefused;

  // A warehouse named longer than the phone, in one word: its label breaks,
  // never past the screen's edge (P1-1).
  await page.setViewportSize({ width: 360, height: 640 });
  grouped.places = [
    warehouse(main, "СкладМагазинНаЦентральномуРинкуБіляЗалізничногоВокзалу"),
    warehouse(own, "Свій"),
  ];
  await enter(page);
  const long = page.locator(".order-place-label").first();
  await expect(long).toHaveText(
    "Склад «СкладМагазинНаЦентральномуРинкуБіляЗалізничногоВокзалу» · 2",
  );
  expect(
    await long.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);

  // A line from a warehouse not read: no labels, one list, each order in it.
  grouped.open = [
    ...grouped.open,
    order({ items: [item("Шарф", "M", 1, randomUUID())] }),
  ];
  await enter(page);
  await expect(rows(page, "До відправлення")).toHaveCount(5);
  await expect(page.locator(".order-place-label")).toHaveCount(0);

  // Whoever does not read the stock: no labels, one list.
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { id: string; permissions: string[] }[];
    };
    body.stores = body.stores.map((store) =>
      store.id === fixture.store_id
        ? {
            ...store,
            permissions: store.permissions.filter(
              (right) => right !== "inventory:view",
            ),
          }
        : store,
    );
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  await expect(rows(page, "До відправлення")).toHaveCount(5);
  await expect(page.locator(".order-place-label")).toHaveCount(0);
});

test("«Прибув на пошту» on its row: a tap carried from the knot let go, then recorded once with a buzz, said, and the row gone to its place («Усе на бірці» sections task list, P0-1)", async ({
  page,
}) => {
  await hear(page);
  const orders = server({
    open: [
      { ...sent, id: randomUUID() },
      { ...toSend, id: randomUUID() },
    ],
  });
  await stub(page, orders);
  await enter(page, { version: "7.0" });
  await drawn(page);
  await knot(page, "Відправлено 1").click();
  const verb = page
    .getByRole("list", { name: "Відправлено" })
    .getByRole("button", { name: "Прибув на пошту" });
  // At once after the list changed: meant for the knot.
  await verb.click();
  await page.waitForTimeout(300);
  expect(orders.arrives).toEqual([]);
  await settle(page);
  await verb.click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Прибув на пошту: Лоран шоколад · M",
    }),
  ).toBeVisible();
  expect(orders.arrives).toEqual([{ command_id: expect.any(String) }]);
  expect(
    (await buzzes(page)).filter((buzz) => buzz !== "selection_change"),
  ).toEqual(["success"]);
  // Gone to its place: the list stays, counted again.
  await expect(knot(page, "Відправлено 0")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Тут посилок немає.")).toBeVisible();
  await expect(knot(page, "Прибув на пошту 1")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
});

test("«Прибув на пошту» on its way: the ring on the pressed verb alone, in its colour, the others held as before; answered, held with its ring till the list is read again, then said and gone to its place, one buzz (audit after stage 2, orders-cash P2-5; review)", async ({
  page,
}) => {
  await hear(page);
  let answer = (): void => undefined;
  const orders = server({
    open: [
      { ...sent, id: randomUUID() },
      { ...sent, id: randomUUID(), created_at: ago(7) },
    ],
    arriveHeld: new Promise((done) => {
      answer = done;
    }),
  });
  await stub(page, orders);
  await enter(page, { version: "7.0" });
  await drawn(page);
  await knot(page, "Відправлено 2").click();
  await settle(page);
  const verbs = page
    .getByRole("list", { name: "Відправлено" })
    .getByRole("button", { name: "Прибув на пошту" });
  await expect(verbs).toHaveCount(2);
  const color = await verbs
    .first()
    .evaluate((node) => getComputedStyle(node).color);
  await verbs.first().click();
  // The pressed one: its ring, its words, its colour; the other waits
  // without one.
  await expect(verbs.first()).toHaveClass(/\bpressed\b/);
  await expect(verbs.first().locator(".eyelet-spin")).toHaveCount(1);
  await expect(verbs.first()).toHaveAccessibleName("Прибув на пошту");
  expect(
    await verbs.first().evaluate((node) => getComputedStyle(node).color),
  ).toBe(color);
  expect(
    await verbs.first().evaluate((node) => getComputedStyle(node).opacity),
  ).toBe("1");
  await expect(verbs.nth(1)).toBeDisabled();
  await expect(verbs.nth(1)).not.toHaveClass(/\bpressed\b/);
  await expect(page.locator(".order-rows .eyelet-spin")).toHaveCount(1);
  // Still on its way a while later: the ring stays, nothing sent twice.
  await page.waitForTimeout(1_000);
  await expect(verbs.first().locator(".eyelet-spin")).toHaveCount(1);
  expect(orders.arrives).toHaveLength(1);
  // Answered, the list read again: till it comes, the ring stays on a verb
  // that takes no second tap (review).
  let reread = (): void => undefined;
  orders.openHeld = new Promise((done) => {
    reread = done;
  });
  const again = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/v1/orders" &&
      url.searchParams.get("status") === "open"
    );
  });
  answer();
  await again;
  await expect(verbs.first()).toBeDisabled();
  await expect(verbs.first()).toHaveClass(/\bpressed\b/);
  await expect(verbs.first().locator(".eyelet-spin")).toHaveCount(1);
  expect(
    await verbs.first().evaluate((node) => getComputedStyle(node).opacity),
  ).toBe("1");
  await verbs.first().click({ force: true });
  expect(orders.arrives).toHaveLength(1);
  delete orders.openHeld;
  reread();
  await expect(
    page.getByRole("status").filter({
      hasText: "Прибув на пошту: Лоран шоколад · M",
    }),
  ).toBeVisible();
  await expect(page.locator(".order-rows .eyelet-spin")).toHaveCount(0);
  await expect(knot(page, "Прибув на пошту 1")).toBeVisible();
  await expect(verbs).toHaveCount(1);
  await expect(verbs.first()).toBeEnabled();
  await expect(verbs.first()).not.toHaveClass(/\bpressed\b/);
  expect(
    (await buzzes(page)).filter((buzz) => buzz !== "selection_change"),
  ).toEqual(["success"]);
});

test("«Прибув на пошту» on its row refused says why with a buzz, the row kept; one whose answer never came is the card's kept step, checked and recorded once («Усе на бірці» sections task list, P0-1)", async ({
  page,
}) => {
  await hear(page);
  const first = { ...sent, id: randomUUID() };
  const orders = server({ open: [first], arriveAnswer: "refused" });
  await stub(page, orders);
  await enter(page, { version: "7.0" });
  await drawn(page);
  await knot(page, "Відправлено 1").click();
  await settle(page);
  const verb = page
    .getByRole("list", { name: "Відправлено" })
    .getByRole("button", { name: "Прибув на пошту" });
  await verb.click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    (await buzzes(page)).filter((buzz) => buzz !== "selection_change"),
  ).toEqual(["error"]);
  await expect(rows(page, "Відправлено")).toHaveCount(1);

  // Lost on its way: kept, named, and nothing more pressed meanwhile.
  orders.arriveAnswer = "lost";
  await settle(page);
  await verb.click();
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", {
      name: "Операцію «Прибув на пошту» ще не підтверджено",
    }),
  });
  await expect(banner).toContainText(
    "Лоран шоколад · M · Нова пошта · ТТН 20450012345678 — сервер не відповів.",
  );
  await expect(verb).toBeDisabled();
  await banner
    .getByRole("button", { name: "Перевірити результат замовлення" })
    .click();
  await expect(
    page.getByRole("status").filter({
      hasText: /^Операцію «Прибув на пошту» записано один раз$/,
    }),
  ).toBeVisible();
  expect(orders.arrives).toHaveLength(3);
  expect(orders.arrives[2]).toEqual(orders.arrives[1]);
});

test("«Відправити» on its row opens the card with its sheet, the cursor in the waybill's field: sent with it by the MainButton, three taps from the menu («Усе на бірці» sections task list, P0-1, P0-3)", async ({
  page,
}) => {
  await hear(page);
  const ready = { ...toSend, id: randomUUID() };
  const orders = server({ open: [ready] });
  await stub(page, orders);
  // Its card read after the sheet came: Telegram's «Назад» closes the sheet
  // still, the card kept (review, 2026-11-01).
  let release = (): void => undefined;
  orders.detailHeld = new Promise<void>((done) => {
    release = done;
  });
  await enter(page, { version: "7.0" });
  await drawn(page);
  await settle(page);
  await page
    .getByRole("list", { name: "До відправлення" })
    .getByRole("button", { name: "Відправити" })
    .click();
  await expect(page.getByRole("dialog", { name: "Відправити" })).toBeVisible();
  release();
  await expect(page.locator(".order-number")).toHaveCount(1);
  await fire(page, "back_button_pressed");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".order-number")).toBeVisible();
  delete orders.detailHeld;
  await enter(page, { version: "7.0" });
  // The list just come under the finger: a tap now is let go.
  await drawn(page);
  await settle(page);
  await page
    .getByRole("list", { name: "До відправлення" })
    .getByRole("button", { name: "Відправити" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Відправити" });
  await expect(sheet).toBeVisible();
  const field = sheet.getByLabel("Номер ТТН (можна дописати пізніше)");
  await expect(field).toBeFocused();
  await expect(sheet).toContainText(
    "У посилці: Лоран шоколад · M × 2, Пальто Ірис · L, Шарф · розмір невідомий",
  );
  await field.fill("20451234");
  await expect
    .poll(async () => (await told(page, "web_app_setup_main_button")).at(-1))
    .toMatchObject({ is_visible: true, text: "Відправлено" });
  await settle(page);
  await fire(page, "main_button_pressed");
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Відправлено · ТТН 20451234" }),
  ).toBeVisible();
  expect(orders.dispatches).toEqual([
    { command_id: expect.any(String), waybill: "20451234" },
  ]);

  // «Клієнт забрав» on its row: its sheet, no way chosen.
  const there = order({ status: "ARRIVED", waybill: "20450055554444" });
  orders.open = [there];
  await enter(page, { version: "7.0" });
  await drawn(page);
  await knot(page, "Прибув на пошту 1").click();
  await settle(page);
  await page
    .getByRole("list", { name: "Прибув на пошту" })
    .getByRole("button", { name: "Клієнт забрав" })
    .click();
  const ways = page.getByRole("dialog", {
    name: "Клієнт забрав — як оплачено?",
  });
  await expect(ways).toBeVisible();
  for (const way of [
    "Готівка",
    "Картка",
    "Переказ",
    "Переказ наперед",
    "Накладений платіж",
  ])
    await expect(
      ways.getByRole("button", { name: way, exact: true }),
    ).toBeVisible();
  await expect(ways.locator("[aria-pressed='true']")).toHaveCount(0);
});

test("whoever reads the orders but takes no step has no verb on any row, and no «+» («Усе на бірці» sections task list, P0-1)", async ({
  page,
}) => {
  await stub(page, seven());
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { id: string; permissions: string[] }[];
    };
    body.stores = body.stores.map((store) =>
      store.id === fixture.store_id
        ? {
            ...store,
            permissions: store.permissions.filter(
              (right) => right !== "sale:create",
            ),
          }
        : store,
    );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Замовлення");
  for (const place of [
    "До відправлення 3",
    "Відправлено 2",
    "Прибув на пошту 2",
  ]) {
    await knot(page, place).click();
    await expect(page.locator(".order-row").first()).toBeVisible();
    await expect(page.locator(".tag-verb")).toHaveCount(0);
  }
  await expect(
    page.getByRole("button", { name: "Нове замовлення" }),
  ).toHaveCount(0);
});

test("a waybill is found as it is typed, from two characters, Enter at once, in the shared field — its name heard, «Номер ТТН» its hint, the magnifier, «×» — kept while an order is opened; nothing found is the blank tag, said of what was typed only, and «Очистити» or «×» brings the list back (orders task list, P0-1; orders and «Каса» task list after stage 2, P1-1)", async ({
  page,
}) => {
  const orders = server({
    open: [toSend, sent],
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
  await page.setViewportSize({ width: 360, height: 640 });
  await enter(page);
  await expect(knot(page, "До відправлення 1")).toBeVisible();
  const field = page.getByLabel("Номер ТТН");
  // The shared field (spec §6.6): 52, the magnifier, «Номер ТТН» its hint —
  // no line over it naming it.
  const search = page.getByRole("search");
  await expect(search.locator(".search-field svg.icon")).toBeVisible();
  await expect(field).toHaveAttribute("placeholder", "Номер ТТН");
  expect((await field.boundingBox())?.height).toBe(52);
  await expect(field).toHaveCSS("border-top-left-radius", "8px");
  await expect(search.locator("label")).toHaveText("Номер ТТН");
  await expect(search.locator("label .visually-hidden")).toHaveText(
    "Номер ТТН",
  );
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
  const found = rows(page, "Знайдені замовлення");
  await expect(found).toHaveCount(2);
  // Every status, with its sticker: no place says it; no string.
  await expect(found.locator(".sticker")).toHaveText([
    "Відправлено",
    "Клієнт забрав",
  ]);
  await expect(knots(page)).toHaveCount(0);
  // An order opened and left: the search as it was.
  await found.first().click();
  await page.getByRole("button", { name: "До замовлень", exact: true }).click();
  await expect(field).toHaveValue("2045");
  await expect(found).toHaveCount(2);
  const none = page.getByText(
    "За «9999» замовлень не знайдено. Перевірте номер ТТН.",
  );
  await field.fill("9999");
  await expect(none).toBeVisible();
  // The blank tag, «Очистити» its one button (spec §6.28).
  const blank = page.locator(".orders-empty");
  await expectEmpty(
    blank,
    "За «9999» замовлень не знайдено. Перевірте номер ТТН.",
  );
  await expect(blank.getByRole("button")).toHaveText(["Очистити"]);
  // Another typed after nothing found: «not found» is never said of it
  // before its answer (review, 2026-10-23).
  let open = (): void => undefined;
  orders.heldFor = "2046";
  orders.gate = new Promise((done) => {
    open = done;
  });
  await field.fill("2046");
  // The rows' places while searched, heard as «Шукаємо…» (orders task
  // list, P2-2).
  await expect(
    page.getByRole("status").filter({ hasText: "Шукаємо…" }),
  ).toBeAttached();
  await expect(page.locator(".placeholder .order-tag")).toHaveCount(3);
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
  await page.getByRole("button", { name: "Очистити", exact: true }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(knot(page, "До відправлення 1")).toBeVisible();
  // «×» is «Очистити»: the field emptied, the cursor in it, the list back.
  await field.fill("2045");
  await expect(found).toHaveCount(2);
  await page.getByRole("button", { name: "Очистити пошук" }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(knot(page, "До відправлення 1")).toBeVisible();
  await expect(found).toHaveCount(0);
});

test("more than a hundred open: «Показати ще» reads the rest, a row read twice shown once, the places counted once all are read; the collected fifty at a time (orders task list, P0-1)", async ({
  page,
}) => {
  const main = randomUUID();
  const many = Array.from({ length: 105 }, (_, index) =>
    order({
      created_at: ago(index / 10),
      items: [item("Лоран шоколад", "M", 1, main)],
    }),
  );
  const done = Array.from({ length: 55 }, (_, index) =>
    order({ status: "COLLECTED", created_at: ago(40 + index / 10) }),
  );
  await stub(
    page,
    server({
      open: many,
      closed: done,
      places: [warehouse(main, "Основний")],
    }),
  );
  await enter(page);
  const ready = rows(page, "Склад «Основний»");
  await expect(ready).toHaveCount(100);
  // Not counted while there are more: the knots, the warehouse — and a
  // place none is in yet not said empty (review, 2026-11-01).
  await expect(knots(page).getByRole("button")).toHaveText([
    "До відправлення",
    "Відправлено",
    "Прибув на пошту",
    "Клієнт забрав",
  ]);
  await expect(page.locator(".order-place-label")).toHaveText([
    "Склад «Основний»",
  ]);
  await knot(page, "Прибув на пошту").click();
  await expect(page.getByRole("button", { name: "Показати ще" })).toBeVisible();
  await expect(page.getByText("Тут посилок немає.")).toHaveCount(0);
  await knot(page, "До відправлення").click();
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(ready).toHaveCount(105);
  await expect(page.locator(".order-place-label")).toHaveText([
    "Склад «Основний» · 105",
  ]);
  await expect(knot(page, "До відправлення 105")).toBeVisible();
  await expect(knot(page, "Відправлено 0")).toBeVisible();
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  await knot(page, "Клієнт забрав").click();
  const closedRows = rows(page, "Клієнт забрав");
  await expect(closedRows).toHaveCount(50);
  await page.getByRole("button", { name: "Показати ще" }).click();
  // The second page holds the first's last row again: shown once.
  await expect(closedRows).toHaveCount(55);
});

/** The one plate where «Показати ще» stood: under the last row, no second
 * one over the rows, «Показати ще» gone meanwhile. */
async function pageFailed(page: Page, last: Locator): Promise<Locator> {
  const plate = page.locator(".notice.read-failure");
  await expect(plate).toHaveCount(1);
  await expect(plate).toHaveAttribute("role", "alert");
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  const [row, under] = await Promise.all([
    last.boundingBox(),
    plate.boundingBox(),
  ]);
  expect(row && under && under.y >= row.y + row.height).toBe(true);
  return plate;
}

test("a next page that could not be read is one plate where «Показати ще» stood, its «Спробувати ще раз» reading that page, the rows read kept — to be sent, collected and found (orders and «Каса» task list after stage 2, P2-6)", async ({
  page,
}) => {
  const main = randomUUID();
  const many = Array.from({ length: 105 }, (_, index) =>
    order({
      created_at: ago(index / 10),
      items: [item("Лоран шоколад", "M", 1, main)],
    }),
  );
  const done = Array.from({ length: 55 }, (_, index) =>
    order({ status: "COLLECTED", created_at: ago(40 + index / 10) }),
  );
  const orders = server({
    open: many,
    closed: done,
    found: { "2045": done },
    places: [warehouse(main, "Основний")],
    pageFails: new Set(["open||100", "closed||50", "|2045|50"]),
  });
  await stub(page, orders);
  await enter(page);
  const ready = rows(page, "Склад «Основний»");
  await expect(ready).toHaveCount(100);
  await page.getByRole("button", { name: "Показати ще" }).click();
  const plate = await pageFailed(page, ready.last());
  await expect(ready).toHaveCount(100);
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(ready).toHaveCount(105);
  await expect(plate).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  expect(orders.asked.filter((asked) => asked === "open||100")).toHaveLength(2);

  await knot(page, "Клієнт забрав").click();
  const closedRows = rows(page, "Клієнт забрав");
  await expect(closedRows).toHaveCount(50);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await pageFailed(page, closedRows.last());
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(closedRows).toHaveCount(55);
  await expect(plate).toHaveCount(0);

  await page.getByLabel("Номер ТТН").fill("2045");
  const found = rows(page, "Знайдені замовлення");
  await expect(found).toHaveCount(50);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await pageFailed(page, found.last());
  // Read again whole on return to the app while that page is said: the
  // plate stays where «Показати ще» stood, its retry held till answered,
  // nothing said over the rows; answered, «Показати ще» is back (review).
  let reread = (): void => undefined;
  orders.heldFor = "2045";
  orders.gate = new Promise<void>((done) => {
    reread = done;
  });
  const whole = orders.asked.length;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => orders.asked.slice(whole).includes("|2045|0"))
    .toBe(true);
  await settle(page);
  await pageFailed(page, found.last());
  await expect(
    plate.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeDisabled();
  reread();
  delete orders.heldFor;
  await expect(plate).toHaveCount(0);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(found).toHaveCount(55);
  await expect(plate).toHaveCount(0);
});

test("no order yet says what an order does, with «Нове замовлення»; none open, but collected ones, says nothing is to be sent, and an empty place «Тут посилок немає.» (orders task list, P0-1)", async ({
  page,
}) => {
  const orders = server();
  await stub(page, orders);
  await enter(page);
  // A blank tag drawn, the words under it, «Нове замовлення» a second
  // button (spec §6.28; stage 2, orders task list, P1-4).
  const empty = page.locator(".orders-empty");
  await expect(empty.locator(".orders-empty-mark")).toBeVisible();
  await expect(empty.locator(".t-row")).toHaveText("Замовлень ще немає.");
  await expect(empty.locator(".t-meta")).toHaveText(
    "Замовлення тримає товар у резерві, поки його не відправили.",
  );
  await expect(knots(page)).toHaveCount(0);
  await expect(
    empty.getByRole("button", { name: "Нове замовлення" }),
  ).toHaveClass(/\bquiet\b/);
  await empty.getByRole("button", { name: "Нове замовлення" }).click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toBeVisible();

  orders.closed = [collected];
  await enter(page);
  await expect(
    page.getByText("Зараз нічого не треба відправляти."),
  ).toBeVisible();
  // Each the blank tag, the words as before, in both themes (spec §6.28;
  // orders and «Каса» task list after stage 2, P1-1).
  await expectEmpty(
    page.locator(".orders-empty"),
    "Зараз нічого не треба відправляти.",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expectEmpty(
    page.locator(".orders-empty"),
    "Зараз нічого не треба відправляти.",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await knot(page, "Відправлено 0").click();
  await expect(page.getByText("Тут посилок немає.")).toBeVisible();
  await expectEmpty(page.locator(".orders-empty"), "Тут посилок немає.");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectEmpty(page.locator(".orders-empty"), "Тут посилок немає.");
  await page.emulateMedia({ colorScheme: "light" });
  await knot(page, "Клієнт забрав").click();
  await expect(rows(page, "Клієнт забрав")).toHaveCount(1);
  await expect(
    page.getByText("Зараз нічого не треба відправляти."),
  ).toHaveCount(0);
});

/** The title and «Нове замовлення» as drawn: beside it, 8 px from it or
 * more, or under it — never over it — the title one line, the button's
 * words whole, nothing past the screen's edge. */
async function titleLine(page: Page, width = 360): Promise<"beside" | "under"> {
  const title = page.getByRole("heading", { name: "Замовлення", level: 1 });
  const add = page
    .locator(".screen-title")
    .getByRole("button", { name: "Нове замовлення", exact: true });
  await expect(add).toHaveText("Нове замовлення");
  await expect(add.locator("svg.icon")).toHaveCount(1);
  const [heading, button] = await Promise.all([
    title.boundingBox(),
    add.boundingBox(),
  ]);
  if (!heading || !button) throw new Error("the title's line is not drawn");
  expect(button.height).toBeGreaterThanOrEqual(44);
  // The title is one line — its word never broken — and the button's
  // words are not cut.
  const lineHeight = await title.evaluate((node) =>
    parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(heading.height).toBeLessThan(lineHeight * 1.5);
  expect(
    await add.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(button.x + button.width).toBeLessThanOrEqual(width);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(width);
  if (button.y >= heading.y + heading.height - 1) return "under";
  // Beside: on the title's line, 8 px from it.
  expect(button.y).toBeLessThan(heading.y + heading.height);
  expect(heading.y).toBeLessThan(button.y + button.height);
  expect(button.x - (heading.x + heading.width)).toBeGreaterThanOrEqual(7.5);
  return "beside";
}

test("«Нове замовлення» is said in words beside «Замовлення», its «+» before them, on the title's line at 360 px and never cut (stage 2, orders task list, P1-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  // In the app's face, as it is meant to be seen (review: measured only
  // once it is drawn).
  await shippedFace(page);
  await stub(page, server());
  await enter(page);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      document.fonts.check(
        '800 34px "Fira Sans Extra Condensed"',
        "Замовлення",
      ),
    ),
  ).toBe(true);
  expect(await titleLine(page)).toBe("beside");
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Нове замовлення", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toBeVisible();
});

test("in the device's face «Нове замовлення» goes under «Замовлення» when the two do not fit, whole, the title's word never broken (stage 2, orders task list, P1-4; review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  // The app's face never comes: `optional`, a phone may draw its own.
  await page.route("**/fira-sans-extra-condensed-800.woff2*", (route) =>
    route.abort(),
  );
  await stub(page, server());
  await enter(page);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        (face) =>
          face.family.includes("Fira Sans Extra Condensed") &&
          face.status === "loaded",
      ),
    ),
  ).toBe(false);
  await titleLine(page);
  // And narrower still, as a phone's larger text draws it: under it, in
  // any face.
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await titleLine(page, 320)).toBe("under");
});

test("while the open orders are read, the string not counted and three row tags hold their places, a warehouse's label's over them: the field, the label and the first row stand where they will, heard as «Завантажуємо замовлення…» (orders task list, P2-2; orders and «Каса» task list after stage 2, P1-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let release = (): void => undefined;
  const main = randomUUID();
  const orders = server({
    open: [
      order({
        created_at: ago(3),
        items: [item("Лоран шоколад", "M", 2, main)],
      }),
      sent,
    ],
    places: [warehouse(main, "Основний")],
    openHeld: new Promise((done) => {
      release = done;
    }),
  });
  await stub(page, orders);
  await enter(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Завантажуємо замовлення…" }),
  ).toBeAttached();
  // Row tags, as the rows' own (P1-1), never a list's rows.
  const placed = page.locator(".placeholder .order-tag");
  await expect(placed).toHaveCount(3);
  await expect(page.locator(".placeholder .sale-row")).toHaveCount(0);
  for (const tag of await placed.all())
    expect((await tag.boundingBox())?.height).toBe(76);
  await expect(knots(page).getByRole("button")).toHaveText([
    "До відправлення",
    "Відправлено",
    "Прибув на пошту",
    "Клієнт забрав",
  ]);
  const field = await page.getByLabel("Номер ТТН").boundingBox();
  const string = await knots(page).boundingBox();
  const place = await placed.first().boundingBox();
  const label = await page.locator(".skeleton-place-label").boundingBox();
  release();
  await expect(knot(page, "До відправлення 1")).toBeVisible();
  const first = page.locator("article.order-tag").first();
  await expect(first).toBeVisible();
  const row = await first.boundingBox();
  expect(Math.abs((row?.y ?? 0) - (place?.y ?? 0))).toBeLessThanOrEqual(1);
  const heading = await page.locator("h3.order-place-label").boundingBox();
  expect(Math.abs((heading?.y ?? 0) - (label?.y ?? 0))).toBeLessThanOrEqual(1);
  expect((await page.getByLabel("Номер ТТН").boundingBox())?.y).toBe(field?.y);
  expect((await knots(page).boundingBox())?.height).toBe(string?.height);
});

test("a list that could not be read says so on a warning's plate, never a debt's red, with «Спробувати ще раз» (orders task list, P2-3)", async ({
  page,
}) => {
  const orders = server({ open: [toSend], openFails: true });
  await stub(page, orders);
  await enter(page);
  const plate = page.locator(".notice.read-failure");
  await expect(plate).toHaveAttribute("role", "alert");
  await expect(plate.getByRole("button")).toHaveText("Спробувати ще раз");
  // The warning's colours, as «Каса»'s plate.
  const colours = await plate.evaluate((node) => {
    const probe = document.createElement("p");
    probe.className = "notice";
    document.body.append(probe);
    const notice = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { plate: getComputedStyle(node).backgroundColor, notice };
  });
  expect(colours.plate).toBe(colours.notice);
  // And its triangle, in both themes (stage 2, orders task list, P0-2).
  await expectPlate(plate, "unread");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPlate(plate, "unread", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  orders.openFails = false;
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(page.locator(".order-row")).toHaveCount(1);
  await expect(plate).toHaveCount(0);
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
  // A card on the page, its corner 4 (spec §4; orders and «Каса» task list
  // after stage 2, P2-4).
  await expect(question).toHaveCSS("border-top-left-radius", "4px");
  expect(
    await question.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--card)";
      document.body.append(probe);
      const card = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return getComputedStyle(node).backgroundColor === card;
    }),
  ).toBe(true);
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
  await expect(page.locator(".knot-sticker")).toHaveText("Скасовано");
  expect(orders.cancels).toEqual([{ command_id: expect.any(String) }]);
  const buzzes = await page.evaluate(
    () => (window as unknown as { buzzes: string[] }).buzzes,
  );
  // The answer's buzz: a choice's are telegram-rules.spec's.
  expect(
    buzzes
      .map((data) => JSON.parse(data) as { type: string })
      .filter((buzz) => buzz.type === "notification"),
  ).toEqual([{ type: "notification", notification_type: "success" }]);
});

test("inside a Telegram that has its own popup, «Скасувати замовлення» asks there — «Так, скасувати» the destructive one — and only that cancels («Усе на бірці» sections task list, P0-2)", async ({
  page,
}) => {
  await hear(page);
  const orders = server({ open: [{ ...toSend, id: randomUUID() }] });
  await stub(page, orders);
  await enter(page, { version: "7.0" });
  await page.locator(".order-row").first().click();
  const ask = page.getByRole("button", {
    name: "Скасувати замовлення",
    exact: true,
  });
  await ask.click();
  await expect
    .poll(() => told(page, "web_app_open_popup"))
    .toEqual([
      {
        title: "Скасувати замовлення?",
        message:
          "Резерв звільниться — товар знову можна продати. Відновити замовлення не можна.",
        buttons: [
          { id: "keep", type: "default", text: "Ні, залишити" },
          { id: "cancel", type: "destructive", text: "Так, скасувати" },
        ],
      },
    ]);
  // Asked there, not in the page.
  await expect(page.locator(".cancel-ask")).toHaveCount(0);
  await fire(page, "popup_closed", { button_id: "keep" });
  await settle(page);
  expect(orders.cancels).toEqual([]);
  // Closed without a button: nothing either.
  await ask.click();
  await fire(page, "popup_closed", {});
  await settle(page);
  expect(orders.cancels).toEqual([]);
  // Tapped twice before it covers the page: asked once (review,
  // 2026-11-01).
  await ask.dblclick();
  await settle(page);
  expect(await told(page, "web_app_open_popup")).toHaveLength(3);
  await fire(page, "popup_closed", { button_id: "cancel" });
  await expect(
    page.getByText("Замовлення скасовано, резерв звільнено."),
  ).toBeVisible();
  expect(orders.cancels).toEqual([{ command_id: expect.any(String) }]);
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
  // The answer's buzz: a choice's are telegram-rules.spec's.
  expect(
    buzzes
      .map((data) => JSON.parse(data) as { type: string })
      .filter((buzz) => buzz.type === "notification"),
  ).toEqual([{ type: "notification", notification_type: "error" }]);
  // Where it stands: to be sent, still.
  await expect(
    page.locator(".knot-string [aria-current='step']"),
  ).toContainText("До відправлення");
  await expect(page.getByText(/Замовлення скасовано/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ні, залишити" }),
  ).toBeEnabled();
});

test("a store that does not trade lists its orders with no «+» and no verb (orders task list, P0-1)", async ({
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
  await expect(knot(page, "До відправлення 1")).toBeVisible();
  await expect(rows(page, "До відправлення")).toHaveCount(1);
  await expect(page.locator(".tag-verb")).toHaveCount(0);
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

/** Whether an element is drawn in a colour pair of the design's. */
async function inColours(
  element: Locator,
  colour: string,
  ground: string,
): Promise<boolean> {
  return element.evaluate(
    (node, [fore, back]) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${fore})`;
      probe.style.background = `var(${back})`;
      document.body.append(probe);
      const want = getComputedStyle(probe);
      const got = getComputedStyle(node);
      const same =
        got.color === want.color &&
        got.backgroundColor === want.backgroundColor;
      probe.remove();
      return same;
    },
    [colour, ground] as const,
  );
}

/** The string's words at 360 px: each inside its own column, none over the
 * next, «Відправлено» on one line — never broken (review, 2026-11-01). */
async function apart(page: Page): Promise<void> {
  await expect(page.locator(".knots .knot-label")).toHaveCount(4);
  const words = await page.locator(".knots .knot-label").evaluateAll((labels) =>
    labels.map((label) => {
      const box = label.getBoundingClientRect();
      return {
        text: label.textContent,
        left: box.left,
        right: box.left + label.scrollWidth,
        high: box.height,
      };
    }),
  );
  expect(words).toHaveLength(4);
  for (const [at, word] of words.entries()) {
    const next = words[at + 1];
    if (next) expect(word.right).toBeLessThanOrEqual(next.left);
  }
  expect(
    words.find((word) => word.text === "Відправлено")?.high,
  ).toBeLessThanOrEqual(17);
}

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme the list reads at 4.5:1, nothing wider than the phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await stub(page, seven());
    await enter(page, { theme });
    const first = page.locator("article.order-tag").first();
    await expect(first).toBeVisible();
    await apart(page);
    for (const part of [
      knot(page, "До відправлення 3").locator(".knot-label"),
      knot(page, "До відправлення 3").locator(".knot-count"),
      knot(page, "Відправлено 2").locator(".knot-label"),
      first.locator(".order-tag-title span").first(),
      first.locator(".order-tag-meta"),
      first.locator(".tag-verb"),
      page.getByRole("button", { name: "Нове замовлення" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // Each place in its colour (spec §4): to be sent, the waiting's.
    expect(
      await knot(page, "До відправлення 3")
        .locator(".knot-dot")
        .evaluate((node) => {
          const probe = document.createElement("span");
          probe.style.color = "var(--online)";
          document.body.append(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          return getComputedStyle(node).borderColor === want;
        }),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/orders-list-${name}.png`,
      fullPage: true,
    });
    // A note pasted whole: its first sixty characters, broken where they
    // must, inside the row.
    await knot(page, "Відправлено 2").click();
    const far = rows(page, "Відправлено").last();
    await expect(far.locator(".order-tag-meta")).toHaveText(
      `За кордон · ${note.slice(0, 60)}… · з\u00a0${short(abroad.created_at as string)}`,
    );
    const tag = await page.locator("article.order-tag").last().boundingBox();
    const meta = await far.locator(".order-tag-meta").boundingBox();
    expect(tag && meta && meta.x + meta.width <= tag.x + tag.width).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    // Stickers by what they mean: collected the paid's, cancelled and come
    // back nothing more to do — each at 4.5:1.
    await knot(page, "Клієнт забрав").click();
    const paid = page
      .getByRole("list", { name: "Клієнт забрав" })
      .locator(".sticker");
    await expect(paid).toHaveText("Клієнт забрав");
    expect(await inColours(paid, "--paid", "--paid-bg")).toBe(true);
    expect(await contrast(paid)).toBeGreaterThanOrEqual(4.5);
    await page
      .getByRole("button", { name: "Скасовані й повернені на склад" })
      .click();
    const over = page
      .getByRole("list", { name: "Скасовані й повернені на склад" })
      .locator(".sticker");
    await expect(over).toHaveCount(2);
    for (const each of await over.all()) {
      expect(await inColours(each, "--offline", "--offline-bg")).toBe(true);
      expect(await contrast(each)).toBeGreaterThanOrEqual(4.5);
    }
    // Each row's knot tied in its margin, clear of its words (2026-11-01).
    for (const row of await page
      .getByRole("list", { name: "Скасовані й повернені на склад" })
      .locator("article.order-tag")
      .all()) {
      const loop = await row.locator(".eyelet-loop").boundingBox();
      const title = await row.locator(".order-tag-title").boundingBox();
      expect(loop && title && loop.x + loop.width <= title.x).toBe(true);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/orders-gone-${name}.png`,
      fullPage: true,
    });
  });
