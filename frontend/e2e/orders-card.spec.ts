import {
  test,
  expect,
  chevronTurn,
  dockOnMenu,
  expectCaption,
  expectGlyphBeside,
  expectLinkChevron,
  expectStub,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * One order (orders task list, P0-2; «Усе на бірці» sections task list,
 * P0-2, P0-3): what it is on top, the string of where it stands with its
 * days, «У посилці» with the sums and «Разом» large, «Доставка» with its
 * waybill to copy; the next step Telegram's MainButton — «Відправити» a
 * sheet with the waybill's field, «Клієнт забрав» a sheet of five ways —
 * a buzz and what it did after it; the rare at the foot. The orders are
 * stubbed.
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

/** Inside Telegram 6.1, unless `version` is null: a browser's page, with
 * no MainButton. */
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
  price = "1200.15",
  discount = "0.00",
): Record<string, unknown> {
  return {
    id: randomUUID(),
    product_variant_id: randomUUID(),
    size_id: randomUUID(),
    source_location_id: randomUUID(),
    quantity,
    unit_price: price,
    discount_amount: discount,
    display_name: name,
    size_label: size,
  };
}

type Stubbed = Record<string, unknown> & { id: string; status: string };

function order(over: Record<string, unknown> = {}): Stubbed {
  const created = ago(2);
  return {
    id: randomUUID(),
    store_id: fixture.store_id,
    status: "READY_TO_DISPATCH",
    sale_id: null,
    currency_code: "UAH",
    total: "1200.15",
    created_at: created,
    items: [item("Лоран шоколад", "M")],
    destination: "UKRAINE",
    carrier: "NOVA_POSHTA",
    waybill: null,
    abroad_note: null,
    payment_method: null,
    shipping_history: [
      {
        kind: "CREATED",
        by: "Оля",
        at: created,
        destination: "UKRAINE",
        carrier: "NOVA_POSHTA",
        waybill: null,
        abroad_note: null,
      },
    ],
    same_waybill: [],
    ...over,
  };
}

interface Server {
  order: Stubbed;
  sent: { step: string; body: unknown }[];
  /** A step refused, with a conflict. */
  refuse?: boolean;
  /** A step whose answer never comes, the server never reached. */
  lose?: boolean;
  /** How many times the order was read. */
  reads?: number;
  /** The total the server answers «Клієнт забрав» with. */
  collectedTotal?: string;
  /** The next step refused with this answer, the order become `becomes`
   * meanwhile — another phone's doing. */
  answer?: {
    status: number;
    json: Record<string, unknown>;
    becomes?: Record<string, unknown>;
  };
  /** How many times the list was read. */
  listReads?: number;
  /** The next read of the order fails with the server's own error. */
  loseRead?: boolean;
  /** The next step waits for this before it is answered. */
  hold?: Promise<void>;
  /** Other orders, read by their id: the same waybill's. */
  others?: Record<string, Stubbed>;
  /** The next read of the order answered only once this opens. */
  readHeld?: Promise<void>;
}

async function stub(page: Page, server: Server): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/v1/orders",
    async (route) => {
      server.listReads = (server.listReads ?? 0) + 1;
      // Open or closed, as asked; a waybill's search, either.
      const asked = new URL(route.request().url()).searchParams.get("status");
      const closed = ["COLLECTED", "CANCELLED", "RETURNED"].includes(
        server.order.status,
      );
      const listed =
        asked === null || (asked === "closed") === closed ? [server.order] : [];
      await route.fulfill({ json: { orders: listed, has_more: false } });
    },
  );
  await page.route("**/api/v1/orders/*", async (route) => {
    server.reads = (server.reads ?? 0) + 1;
    if (server.readHeld) {
      const held = server.readHeld;
      delete server.readHeld;
      await held;
    }
    if (server.loseRead) {
      server.loseRead = false;
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({ json: server.others?.[id ?? ""] ?? server.order });
  });
  for (const step of [
    "dispatch",
    "arrive",
    "collect",
    "cancel",
    "shipping",
    "return",
  ])
    await page.route(`**/api/v1/orders/*/${step}`, async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      server.sent.push({ step, body });
      if (server.hold) {
        const held = server.hold;
        delete server.hold;
        await held;
      }
      if (server.answer) {
        const { status, json, becomes } = server.answer;
        delete server.answer;
        if (becomes) server.order = { ...server.order, ...becomes };
        await route.fulfill({ status, json });
        return;
      }
      if (server.lose) {
        server.lose = false;
        await route.abort("failed");
        return;
      }
      if (server.refuse) {
        await route.fulfill({
          status: 409,
          json: { code: "CONFLICT", message: "Conflict", details: {} },
        });
        return;
      }
      server.order = {
        ...server.order,
        status:
          step === "dispatch"
            ? "DISPATCHED"
            : step === "arrive"
              ? "ARRIVED"
              : step === "cancel"
                ? "CANCELLED"
                : step === "shipping"
                  ? server.order.status
                  : step === "return"
                    ? "RETURNED"
                    : "COLLECTED",
        ...(typeof body.waybill === "string" ? { waybill: body.waybill } : {}),
        ...(step === "collect"
          ? {
              sale_id: randomUUID(),
              payment_method: body.payment_method,
              // The server's sum, whatever the phone showed.
              total: server.collectedTotal ?? server.order.total,
              ...(typeof body.credit === "object" && body.credit !== null
                ? {
                    credit: {
                      credit_id: randomUUID(),
                      paid: (body.credit as { paid_now: string }).paid_now,
                      owed: "2500.00",
                    },
                  }
                : {}),
            }
          : {}),
      };
      await route.fulfill({ json: server.order });
    });
}

/** The answers' buzzes: a choice's and a tap's are telegram-rules.spec's
 * («Усе на бірці» task list, P1-2). */
async function buzzes(page: Page): Promise<object[]> {
  const sent = await page.evaluate(
    () => (window as unknown as { buzzes: string[] }).buzzes,
  );
  return sent
    .map((data) => JSON.parse(data) as { type: string })
    .filter((buzz) => buzz.type === "notification");
}

/** Telegram heard: all it is told, its buzzes, and what its MainButton was
 * told — pressed the moment it says `pressWhen`, as a double tap's second
 * half would land on it. */
async function hear(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      told: [string, unknown][];
      buzzes: string[];
      mains: Record<string, unknown>[];
      pressWhen: string | null;
    };
    host.told = [];
    host.buzzes = [];
    host.mains = [];
    host.pressWhen = null;
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        host.told.push([event, data ? (JSON.parse(data) as unknown) : null]);
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
        if (event !== "web_app_setup_main_button") return;
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
}

/** What Telegram's MainButton was last told: nothing, before it was. */
async function main(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    () =>
      (window as unknown as { mains: Record<string, unknown>[] }).mains.at(
        -1,
      ) ?? null,
  );
}

/** Telegram's MainButton pressed, once it says `text`. */
async function pressMain(page: Page, text: string): Promise<void> {
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, is_active: true, text });
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
}

/** Telegram's MainButton pressed the moment it is told `text`. */
async function pressAsShown(page: Page, text: string): Promise<void> {
  await page.evaluate((wanted) => {
    (window as unknown as { pressWhen: string }).pressWhen = wanted;
  }, text);
}

/** What Telegram's «Назад» was last told: nothing, before it was. */
async function back(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      (window as unknown as { told: [string, unknown][] }).told
        .filter(([event]) => event === "web_app_setup_back_button")
        .map(([, data]) => data)
        .at(-1) ?? null,
  );
}

/** Its MainButton put away, or never shown. */
async function noMain(page: Page): Promise<void> {
  await expect
    .poll(async () => (await main(page))?.is_visible ?? false)
    .toBe(false);
}

/** A sheet over the card, once a tap in it is taken: the one that opened
 * it is let go for a moment. */
async function sheet(page: Page, name: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name, exact: true });
  await expect(dialog).toHaveAttribute("data-ready", "");
  return dialog;
}

/** «Змінити доставку» or «ТТН ще немає — вписати»: the sheet «Доставка»
 * over the card (stage 2, orders task list, P1-1). */
async function shipping(page: Page, row: string): Promise<Locator> {
  await page.getByRole("button", { name: row, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Доставка", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** «Відправити» by the MainButton, its waybill typed, and «Відправлено». */
async function send(page: Page, waybill?: string): Promise<void> {
  await pressMain(page, "Відправити");
  const sending = await sheet(page, "Відправити");
  if (waybill !== undefined)
    await sending
      .getByLabel("Номер ТТН (можна дописати пізніше)")
      .fill(waybill);
  await pressMain(page, "Відправлено");
}

/** «Клієнт забрав» by the MainButton: its five ways. */
async function ways(page: Page): Promise<Locator> {
  await pressMain(page, "Клієнт забрав");
  return sheet(page, "Клієнт забрав — як оплачено?");
}

/** The order's place on its string, or its sticker once it has none. */
function standing(page: Page): Locator {
  return page.locator(
    ".knot-string [aria-current='step'] .knot-label, .knot-sticker .sticker",
  );
}

/** The places it has passed. */
function passed(page: Page): Locator {
  return page.locator(".knot-string .knot.done .knot-label");
}

/** The place an order is listed at, by its knot's word. */
const placeOf: Record<string, string | null> = {
  READY_TO_DISPATCH: null,
  DISPATCHED: "Відправлено",
  ARRIVED: "Прибув на пошту",
};

/** «Замовлення», the place the order is at, and its row. */
async function toOrder(page: Page, status: string): Promise<void> {
  await section(page, "Замовлення");
  const place = status in placeOf ? placeOf[status] : "Клієнт забрав";
  if (place)
    await page
      .getByRole("group", { name: "Замовлення", exact: true })
      .getByRole("button", { name: new RegExp(`^${place}`) })
      .click();
  if (status === "CANCELLED" || status === "RETURNED")
    await page
      .getByRole("button", { name: "Скасовані й повернені на склад" })
      .click();
  await page.locator(".order-row").first().click();
}

async function open(
  page: Page,
  server: Server,
  theme?: Record<string, string>,
  version?: string | null,
): Promise<void> {
  await hear(page);
  await stub(page, server);
  await page.goto("about:blank");
  await page.goto(
    launch({
      ...(theme ? { theme } : {}),
      ...(version !== undefined ? { version } : {}),
    }),
  );
  await openStore(page, "Основний MAIN");
  await toOrder(page, server.order.status);
  // Nothing in flight before a step is lost: an answer after it is the
  // server back, and the step is checked by itself — «Сьогодні»'s reads at
  // entry among them («Усе на бірці» task list, P0-6).
  if (server.lose) await page.waitForLoadState("networkidle");
}

/** What a step did is read before the next is pressed: a tap within 0.7 s
 * of its answer is taken as meant for the step before (review,
 * 2026-10-24). */
async function readTheAnswer(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 800);
      }),
  );
}

/** A rare step's panel under the thumb; outside Telegram, the card's dock
 * too. */
function panel(page: Page): Locator {
  return page.locator(".order-panel");
}

test("an order to send fits the phone: its goods as its title, when it was ordered and its number small, the string with its day, «У посилці», «Доставка», and «Відправити» Telegram's MainButton («Усе на бірці» sections task list, P0-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const ready = order();
  await open(page, { order: ready, sent: [] });
  const title = page.getByRole("heading", {
    name: "Лоран шоколад · M",
    exact: true,
  });
  await expect(title).toBeVisible();
  // When it was ordered, its number small beside it (В1), in the screen's
  // one line after the store and the person, no second line under it — at
  // 360, two lines at most where the line has the width; beside «Змінити
  // магазин», kept at its right (spec §6.2), a store named as long as
  // «Основний» takes a third (orders and «Каса» task list after stage 2,
  // P2-1; decided here).
  const line = page.locator(".store-line p:visible");
  await expect(line).toHaveText(
    new RegExp(
      ` · замовлено ${short(ready.created_at as string)} · № ${ready.id.slice(0, 8)}$`,
    ),
  );
  await expect(page.locator(".order-context")).toHaveCount(0);
  await expect(line.locator(".order-number")).toHaveText(
    `№ ${ready.id.slice(0, 8)}`,
  );
  await expect(line.locator(".order-number")).toHaveCSS("font-size", "12px");
  const lines = (): Promise<number> =>
    line.evaluate((node) =>
      Math.round(
        node.getBoundingClientRect().height /
          parseFloat(getComputedStyle(node).lineHeight),
      ),
    );
  const change = page.locator(".store-line button", {
    hasText: "Змінити магазин",
  });
  await expect(change).toBeVisible();
  const [words, button] = await Promise.all([
    line.boundingBox(),
    change.boundingBox(),
  ]);
  expect(
    words && button && button.x > words.x + words.width,
    "«Змінити магазин» at the line's right",
  ).toBe(true);
  expect(await lines()).toBeLessThanOrEqual(3);
  await change.evaluate((node) => {
    (node as HTMLElement).style.display = "none";
  });
  expect(await lines()).toBeLessThanOrEqual(2);
  await change.evaluate((node) => {
    (node as HTMLElement).style.display = "";
  });

  // Where it stands: to be sent since the day it was ordered, the rest to
  // come.
  const knots = page.locator(".knot-string .knot");
  await expect(knots.locator(".knot-label")).toHaveText([
    "До відправлення",
    "Відправлено",
    "Прибув на пошту",
    "Клієнт забрав",
  ]);
  await expect(standing(page)).toHaveText("До відправлення");
  await expect(passed(page)).toHaveCount(0);
  await expect(page.locator(".knot-string .knot-date")).toHaveText([
    short(ready.created_at as string),
  ]);
  for (const later of [1, 2, 3])
    await expect(knots.nth(later)).toHaveClass(/\bfuture\b/);
  // What is in it, and how it goes.
  await expect(
    page.getByRole("heading", { name: "У посилці", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-line .history-sum")).toHaveText(
    "1 200,15 грн",
  );
  await expect(page.locator(".order-total .sum")).toHaveText("1 200,15 грн");
  await expect(
    page.getByRole("heading", { name: "Доставка", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-goes")).toHaveText(
    "Нова пошта · ТТН ще немає",
  );
  // No waybill yet: nothing to copy.
  await expect(
    page.getByRole("button", { name: "Скопіювати ТТН" }),
  ).toHaveCount(0);
  // One explanation, and never the money's words before «Клієнт забрав».
  await expect(
    page.getByText("Товар у резерві — на касі його не продадуть."),
  ).toBeVisible();
  await expect(page.getByText(/Продаж записуємо/)).toHaveCount(0);
  for (const gone of ["Оновити", "← До списку"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  // Where it went, folded.
  await expect(
    page.getByRole("button", { name: "Історія доставки" }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("list", { name: "Історія доставки" }),
  ).toHaveCount(0);
  // The next step Telegram's own button, in the app's colours: no field and
  // no panel of the card's own.
  await expect
    .poll(() => main(page))
    .toMatchObject({
      is_visible: true,
      is_active: true,
      text: "Відправити",
      color: expect.any(String),
      text_color: expect.any(String),
    });
  await expect(page.getByLabel(/Номер ТТН/)).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  // Its top at once, without a scroll.
  for (const part of [
    title,
    page.locator(".store-line"),
    page.locator(".knot-string"),
    page.locator(".order-line"),
    page.locator(".order-total"),
  ])
    await expect(part).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "test-results/order-card-send.png" });
  // The rare at the foot.
  const cancel = page.getByRole("button", {
    name: "Скасувати замовлення",
    exact: true,
  });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  // Left: its MainButton put away.
  await page.getByRole("button", { name: "До замовлень", exact: true }).click();
  await noMain(page);
});

test("outside Telegram the MainButton is the dock's one button under the thumb, its room kept, gone under a rare step and back; the sheet's «Відправлено» at its own foot («Усе на бірці» sections task list, P0-2, P0-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = { order: order(), sent: [] };
  await open(page, server, undefined, null);
  const step = panel(page).getByRole("button", { name: "Відправити" });
  await expect(step).toBeInViewport({ ratio: 1 });
  expect(await main(page)).toBeNull();
  // The MainButton's own place, never the screen's primary: 50 high,
  // Telegram's corner 10 (spec §6.4; orders and «Каса» task list after
  // stage 2, P2-4).
  expect((await step.boundingBox())?.height).toBe(50);
  await expect(step).toHaveCSS("border-top-left-radius", "10px");
  // The panel's height kept clear wherever the page scrolls to — a field
  // the keyboard brings up (`shared/panel.ts`) — and none while it is gone.
  const room = (): Promise<string> =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--pay-panel-h"),
    );
  const height = (await panel(page).boundingBox())?.height ?? 0;
  expect(Math.abs(parseFloat(await room()) - height)).toBeLessThanOrEqual(1);
  // Where it goes changed: a sheet over the card, its own press at the
  // sheet's foot in reach (stage 2, orders task list, P1-1).
  const changing = await shipping(page, "Змінити доставку");
  const save = changing.locator(".sheet-foot").getByRole("button");
  await expect(save).toHaveText("Зберегти доставку");
  await expect(save).toBeInViewport({ ratio: 1 });
  // Closed by «Назад» (Escape here): the card's press and its room, the
  // row that opened it in focus.
  await expect(changing).toHaveAttribute("data-ready", "");
  await page.keyboard.press("Escape");
  await expect(changing).toHaveCount(0);
  await expect(step).toBeVisible();
  // Its press let go a moment, as after any sheet over the card.
  await readTheAnswer(page);
  await expect
    .poll(async () => Math.abs(parseFloat(await room()) - height))
    .toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: "Змінити доставку" }),
  ).toBeFocused();
  // The rare at the foot, the dock never over the last of them.
  const cancel = page.getByRole("button", {
    name: "Скасувати замовлення",
    exact: true,
  });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  const under = await cancel.boundingBox();
  const over = await panel(page).boundingBox();
  expect(under && over && under.y + under.height <= over.y).toBe(true);
  // Asked in the page, «Ні, залишити» focused, over the dock.
  await cancel.click();
  const keep = page.getByRole("button", { name: "Ні, залишити" });
  await expect(keep).toBeFocused();
  const kept = await keep.boundingBox();
  const below = await panel(page).boundingBox();
  expect(kept && below && kept.y + kept.height <= below.y + 1).toBe(true);
  await keep.click();
  // «Відправити»: its sheet, the field in focus, «Відправлено» at its foot
  // under it.
  await step.click();
  const sending = await sheet(page, "Відправити");
  const field = sending.getByLabel("Номер ТТН (можна дописати пізніше)");
  await expect(field).toBeFocused();
  const sent = sending.getByRole("button", { name: "Відправлено" });
  await expect(sent).toBeInViewport({ ratio: 1 });
  const typed = await field.boundingBox();
  const pressed = await sent.boundingBox();
  expect(typed && pressed && typed.y + typed.height <= pressed.y).toBe(true);
  await page.screenshot({ path: "test-results/order-send-sheet.png" });
  await field.fill("20451234");
  await sent.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Відправлено · ТТН 20451234", { exact: true }),
  ).toBeVisible();
  await expect(panel(page).getByRole("button")).toHaveText("Прибув на пошту");
  expect(server.sent).toEqual([
    {
      step: "dispatch",
      body: { command_id: expect.any(String), waybill: "20451234" },
    },
  ]);
});

test("sent with its waybill by the MainButton, then arrived: what is sent is as before, each a buzz and what it did, the string moved on; arrived, «Клієнт забрав» its sheet (orders task list, P0-2; «Усе на бірці» sections task list, P0-2, P0-3)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [] };
  await open(page, server);
  await send(page, " 0500012345678 ");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // What it did takes the cursor: the sheet went with the card it was on
  // (review, 2026-11-01).
  // Said in its place over the thread, the cursor on it.
  const said = page.locator(".order-done");
  await expect(said).toHaveText("Відправлено · ТТН 0500012345678");
  await expect(said).toBeFocused();
  await expect(standing(page)).toHaveText("Відправлено");
  await expect(passed(page)).toHaveText(["До відправлення"]);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  // Sent, nothing held in reserve any more.
  await expect(page.getByText(/^Товар у резерві/)).toHaveCount(0);
  await readTheAnswer(page);
  await pressMain(page, "Прибув на пошту");
  await expect(
    page.getByRole("status").filter({ hasText: /^Прибув на пошту$/ }),
  ).toBeVisible();
  expect(await buzzes(page)).toHaveLength(2);
  expect(server.sent).toEqual([
    {
      step: "dispatch",
      body: { command_id: expect.any(String), waybill: "0500012345678" },
    },
    { step: "arrive", body: { command_id: expect.any(String) } },
  ]);
  await expect(standing(page)).toHaveText("Прибув на пошту");
  // Arrived: no line on the card; «Клієнт забрав» by its ways, its money's
  // words in its sheet.
  await expect(page.getByText(/^Продаж записуємо/)).toHaveCount(0);
  await readTheAnswer(page);
  const taking = await ways(page);
  await expect(taking.getByText(/^Продаж записуємо/)).toBeVisible();
  // Its ways are never the MainButton.
  await noMain(page);
});

test("sent without a waybill says it may come later; refused, a buzz of its own and why brought to the finger in the sheet (orders task list, P0-2; «Усе на бірці» sections task list, P0-3)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [], refuse: true };
  await open(page, server);
  const read = server.reads ?? 0;
  await send(page);
  const sending = page.getByRole("dialog", { name: "Відправити" });
  const why = sending.getByRole("alert");
  await expect(why).toBeFocused();
  // The owner's words for a conflict (2026-10-24, after #128; P1-2).
  await expect(why).toHaveText(
    "Не записано: дані замовлення змінилися, поки ви працювали. Перевірте замовлення й спробуйте ще раз.",
  );
  // The order read again, as it is now.
  await expect.poll(() => server.reads ?? 0).toBeGreaterThan(read);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await expect(standing(page)).toHaveText("До відправлення");
  // Answered: the sheet no longer held — Telegram's «Назад» shown again
  // (audit 2026-11-13, orders-cash P2-3).
  await expect.poll(() => back(page)).toEqual({ is_visible: true });
  server.refuse = false;
  await pressMain(page, "Відправлено");
  await expect(sending).toHaveCount(0);
  await expect(
    page.getByText("Відправлено. ТТН можна вписати пізніше.", { exact: true }),
  ).toBeVisible();
  expect(server.sent.map((each) => each.body)).toEqual([
    { command_id: expect.any(String) },
    { command_id: expect.any(String) },
  ]);
});

/** A step refused as no longer allowed: the order already `status`. */
function moved(status: string, action: string): Server["answer"] {
  return {
    status: 422,
    json: {
      code: "VALIDATION_ERROR",
      message: "Invalid order transition",
      details: { status, action, recorded: false },
    },
    becomes: { status },
  };
}

for (const [pressed, before, now, word] of [
  ["Відправлено", "READY_TO_DISPATCH", "CANCELLED", "Скасовано"],
  ["Прибув на пошту", "DISPATCHED", "RETURNED", "Повернено на склад"],
  ["Скасувати замовлення", "READY_TO_DISPATCH", "DISPATCHED", "Відправлено"],
] as const)
  test(`«${pressed}» on an order another phone already made «${word}»: not recorded, said with what it is now, focused, its sheet closed; the card and the list read again (orders task list, P1-2)`, async ({
    page,
  }) => {
    const action =
      pressed === "Відправлено"
        ? "dispatch"
        : pressed === "Прибув на пошту"
          ? "arrive"
          : "cancel";
    const server: Server = {
      order: order({ status: before }),
      sent: [],
      answer: moved(now, action),
    };
    await open(page, server);
    const reads = server.reads ?? 0;
    const lists = server.listReads ?? 0;
    if (action === "cancel") {
      await page
        .getByRole("button", { name: "Скасувати замовлення", exact: true })
        .click();
      await page.getByRole("button", { name: "Так, скасувати" }).click();
    } else if (action === "dispatch") await send(page);
    else await pressMain(page, pressed);
    const why = page.getByRole("alert");
    await expect(why).toHaveText(
      `Не записано: замовлення вже «${word}» — картку оновлено.`,
    );
    await expect(why).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await buzzes(page)).toEqual([
      { type: "notification", notification_type: "error" },
    ]);
    // The card as it is now: where it stands, and no longer the step
    // pressed.
    await expect.poll(() => server.reads ?? 0).toBeGreaterThan(reads);
    await expect(standing(page)).toHaveText(word);
    if (action === "cancel")
      await expect(
        page.getByRole("button", { name: pressed, exact: true }),
      ).toHaveCount(0);
    else await noMain(page);
    await expect.poll(() => server.listReads ?? 0).toBeGreaterThan(lists);
    // Never the shared words.
    await expect(page.getByText(/поточний статус замовлення/)).toHaveCount(0);
    expect(server.sent.map((each) => each.step)).toEqual([action]);
  });

test("where a closed order goes is not changed: said so, and the card read again (orders task list, P1-2)", async ({
  page,
}) => {
  const server: Server = { order: order({ status: "DISPATCHED" }), sent: [] };
  await open(page, server);
  // Sent with no waybill: written later (orders task list, P1-3).
  const writing = await shipping(page, "ТТН ще немає — вписати");
  server.answer = {
    status: 422,
    json: {
      code: "VALIDATION_ERROR",
      message: "The order is closed: where it went stays as it was",
      details: { reason: "ORDER_CLOSED", status: "COLLECTED", recorded: false },
    },
    becomes: {
      status: "COLLECTED",
      sale_id: randomUUID(),
      payment_method: "CASH",
    },
  };
  const reads = server.reads ?? 0;
  await writing.getByLabel("Номер ТТН", { exact: true }).fill("20451234");
  await readTheAnswer(page);
  await pressMain(page, "Зберегти доставку");
  const why = page.getByRole("alert");
  await expect(why).toHaveText(
    "Не записано: замовлення вже закрито, доставку більше не змінюють.",
  );
  await expect(why).toBeFocused();
  await expect.poll(() => server.reads ?? 0).toBeGreaterThan(reads);
  await expect(passed(page).last()).toHaveText("Клієнт забрав");
});

test("a shipping change whose answer never came, resent after the order closed: says which was not recorded, and why (orders task list, P1-2)", async ({
  page,
}) => {
  const server: Server = {
    order: order({ status: "DISPATCHED" }),
    sent: [],
    lose: true,
  };
  await open(page, server);
  const writing = await shipping(page, "ТТН ще немає — вписати");
  await writing.getByLabel("Номер ТТН", { exact: true }).fill("20451234");
  await readTheAnswer(page);
  await pressMain(page, "Зберегти доставку");
  const retry = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  await expect(retry).toBeEnabled();
  server.answer = {
    status: 422,
    json: {
      code: "VALIDATION_ERROR",
      message: "The order is closed: where it went stays as it was",
      details: { reason: "ORDER_CLOSED", status: "COLLECTED", recorded: false },
    },
    becomes: {
      status: "COLLECTED",
      sale_id: randomUUID(),
      payment_method: "CASH",
    },
  };
  await retry.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Операцію «Зміна доставки» не записано: замовлення вже закрито, доставку більше не змінюють.",
  );
  await expect(retry).toHaveCount(0);
  expect(server.sent.map((each) => each.step)).toEqual([
    "shipping",
    "shipping",
  ]);
  expect(server.sent[1]?.body).toEqual(server.sent[0]?.body);
});

test("a step whose answer never came, met by a conflict on its check: still unconfirmed, never «try again» (orders task list, P1-2)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [], lose: true };
  await open(page, server);
  await send(page);
  const retry = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  await expect(retry).toBeEnabled();
  server.refuse = true;
  await retry.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Операцію «Відправлено» ще не підтверджено: сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі вона не запишеться.",
  );
  await expect(retry).toBeEnabled();
  await expect(page.getByText(/конфліктує|спробуйте ще раз/i)).toHaveCount(0);
});

for (const [what, answer, said] of [
  [
    "a conflict",
    {
      status: 409,
      json: {
        code: "CONFLICT",
        message: "Conflict",
        details: { recorded: false },
      },
    },
    "Операцію «Відправлено» не записано: дані замовлення змінилися, поки сервер не відповідав. Перевірте замовлення й спробуйте ще раз.",
  ],
  [
    "its waybill",
    {
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "A waybill has letters or digits",
        details: { reason: "WAYBILL", recorded: false },
      },
    },
    "Операцію «Відправлено» не записано: номер ТТН має містити цифри або латинські літери.",
  ],
] as const)
  test(`a step whose answer never came, refused on its check for ${what} and recorded nowhere: says which, and why as a resend's (review, 2026-10-24)`, async ({
    page,
  }) => {
    const server: Server = { order: order(), sent: [], lose: true };
    await open(page, server);
    await send(page, "НП");
    const retry = page.getByRole("button", {
      name: "Перевірити результат замовлення",
    });
    await expect(retry).toBeEnabled();
    server.answer = { status: answer.status, json: { ...answer.json } };
    await retry.click();
    await expect(page.getByRole("alert")).toHaveText(said);
    await expect(retry).toHaveCount(0);
  });

test("a waybill another order has: recorded with a warning's buzz, the sheet kept with what to check over the order sent, «Готово» closes it, the card names the other (owner decision, 2026-10-01; «Усе на бірці» sections task list, P0-3)", async ({
  page,
}) => {
  const ready = order();
  const other = randomUUID();
  const sent = {
    status: "DISPATCHED",
    waybill: "20451234",
    same_waybill: [
      {
        id: other,
        status: "DISPATCHED",
        created_at: ago(1),
        display_name: "Ріо графіт",
        size_label: "L",
        quantity: 1,
        lines: 1,
      },
    ],
  };
  const server: Server = {
    order: ready,
    sent: [],
    answer: { status: 200, json: { ...ready, ...sent }, becomes: sent },
  };
  await open(page, server);
  await send(page, "20451234");
  const sending = page.getByRole("dialog", { name: "Відправити" });
  // Saved anyway: several orders may go in one parcel.
  await expect(sending.locator(".send-same")).toHaveText(
    "Ця ТТН є також у замовленні — перевірте, чи це один пакунок.",
  );
  await expect(sending.locator(".send-same svg")).toHaveCount(1);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "warning" },
  ]);
  // Sent: the field as it was, nothing more to send from it.
  await expect(
    sending.getByLabel("Номер ТТН (можна дописати пізніше)"),
  ).toHaveJSProperty("readOnly", true);
  await expect(standing(page)).toHaveText("Відправлено");
  // Sent: never held over its warning — Telegram's «Назад» shown (audit
  // 2026-11-13, orders-cash P2-3).
  await expect.poll(() => back(page)).toEqual({ is_visible: true });
  // «Готово» pressed a while later, and again the moment the card's
  // «Прибув на пошту» stands in its place: let go (review, 2026-11-01).
  await wait(page, 800);
  await pressAsShown(page, "Прибув на пошту");
  await pressMain(page, "Готово");
  await expect(sending).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^Відправлено/ }),
  ).toBeFocused();
  await wait(page, 300);
  expect(server.sent.map((each) => each.step)).toEqual(["dispatch"]);
  // Which, on the card.
  await expect(
    page
      .getByRole("list", { name: "Замовлення з цією ТТН" })
      .locator(".sale-goods"),
  ).toHaveText("Ріо графіт · L");
  await expect
    .poll(() => main(page))
    .toMatchObject({
      text: "Прибув на пошту",
    });
});

test("a waybill of no digit or Latin letter: said as the field's own fault, the field kept in its sheet (orders task list, P1-2; «Усе на бірці» sections task list, P0-3)", async ({
  page,
}) => {
  const server: Server = {
    order: order(),
    sent: [],
    answer: {
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "A waybill has letters or digits",
        details: { reason: "WAYBILL", recorded: false },
      },
    },
  };
  await open(page, server);
  // Its letters Latin, as a waybill's: «НП» alone is none.
  await send(page, "НП");
  const sending = page.getByRole("dialog", { name: "Відправити" });
  const field = sending.getByLabel("Номер ТТН (можна дописати пізніше)");
  const why = sending.getByRole("alert");
  await expect(why).toHaveText(
    "Номер ТТН має містити цифри або латинські літери. Перевірте його.",
  );
  await expect(why).toBeFocused();
  // What to check is still there.
  await expect(field).toHaveValue("НП");
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  expect(server.sent).toEqual([
    {
      step: "dispatch",
      body: { command_id: expect.any(String), waybill: "НП" },
    },
  ]);
});

test("lines with their sums: two of a coat less its discount, «за 1 шт.» for more than one; the title names the first and how many more (orders task list, P0-2)", async ({
  page,
}) => {
  const many = order({
    total: "2360.00",
    items: [
      item("Лоран шоколад", "M", 2, "600.00", "20.00"),
      item("Пальто Ірис", "L", 1, "1200.00"),
    ],
  });
  await open(page, { order: many, sent: [] });
  await expect(
    page.getByRole("heading", {
      name: "Лоран шоколад · M × 2 + ще 1",
      exact: true,
    }),
  ).toBeVisible();
  const lines = page.locator(".order-line");
  await expect(lines.nth(0).locator(".sale-meta")).toHaveText(
    "600,00 грн за 1 шт. · знижка 20,00 грн за 1 шт.",
  );
  await expect(lines.locator(".history-sum")).toHaveText([
    "1 160,00 грн",
    "1 200,00 грн",
  ]);
  await expect(lines.nth(1).locator(".sale-meta")).toHaveCount(0);
  await expect(page.locator(".order-total .sum")).toHaveText("2 360,00 грн");
  // «Відправити» names each line of the parcel.
  await pressMain(page, "Відправити");
  const sending = await sheet(page, "Відправити");
  await expect(sending.locator(".send-parcel")).toHaveText(
    "У посилці: Лоран шоколад · M × 2, Пальто Ірис · L",
  );
});

test("a step whose answer never came names its step and its order, and is never typed from paper; checked again and recorded, it says it was recorded once, with a buzz (orders task list, P0-2, P1-1)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [], lose: true };
  await open(page, server);
  await send(page, "20451234");
  // Kept: the sheet gone, the banner says it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const again = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  await expect(again).toBeEnabled();
  // Which step, and which order: its goods, how it goes, its waybill.
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", {
      name: "Операцію «Відправлено» ще не підтверджено",
    }),
  });
  await expect(banner).toContainText(
    "Лоран шоколад · M · Нова пошта · ТТН 20451234 — сервер не відповів. Двічі цю операцію не запишуть. Поки чекаємо, інші дії недоступні.",
  );
  // Never from paper: the phone checks it itself (owner decision,
  // 2026-10-23, В4 (а)).
  await expect(banner).toContainText(
    "Телефон перевірить сам. Нічого не повторюйте, поки він не скаже «не записано».",
  );
  await expect(banner).not.toContainText("на папері");
  // What it names is kept beside it on the phone, never sent.
  const kept = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("birka:pending:"))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as object),
  );
  expect(kept).toEqual([
    expect.objectContaining({
      shown: "Лоран шоколад · M · Нова пошта · ТТН 20451234",
    }),
  ]);
  // Kept: nothing is said to be recorded; it is felt once, a warning (spec
  // §4.4; «Усе на бірці» task list, P1-2).
  const warned = { type: "notification", notification_type: "warning" };
  expect(await buzzes(page)).toEqual([warned]);
  await expect(page.getByText(/^Відправлено ·/)).toHaveCount(0);
  await again.click();
  await expect(
    page.getByRole("status").filter({
      hasText: /^Операцію «Відправлено» записано один раз$/,
    }),
  ).toBeVisible();
  expect(await buzzes(page)).toEqual([
    warned,
    { type: "notification", notification_type: "success" },
  ]);
  // The same command, resent, byte for byte, and nothing only shown in it.
  expect(server.sent).toHaveLength(2);
  expect(server.sent[1]).toEqual(server.sent[0]);
  expect(server.sent[0]?.body).toEqual({
    command_id: expect.any(String),
    waybill: "20451234",
  });
});

test("a step answered whose order could not be read says it is recorded, never to wait for «не записано»; read again, recorded once (orders task list, P1-1; review, 2026-10-25)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [] };
  await open(page, server);
  server.loseRead = true;
  await send(page);
  const again = page.getByRole("button", { name: "Оновити результат" });
  await expect(again).toBeEnabled();
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", {
      name: "Операцію «Відправлено» записано",
    }),
  });
  await expect(banner).toContainText(
    "Лоран шоколад · M · Нова пошта — замовлення ще не вдалося показати. Поки чекаємо, інші дії недоступні.",
  );
  await expect(banner).not.toContainText("не записано");
  await again.click();
  await expect(
    page.getByRole("status").filter({
      hasText: /^Операцію «Відправлено» записано один раз$/,
    }),
  ).toBeVisible();
  expect(server.sent).toHaveLength(1);
});

test("while a step's first press is on its way, no banner says the server did not answer (orders task list, P1-1; review, 2026-10-25)", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const server: Server = {
    order: order(),
    sent: [],
    hold: new Promise<void>((done) => {
      release = done;
    }),
  };
  await open(page, server);
  await pressMain(page, "Відправити");
  const sending = await sheet(page, "Відправити");
  // «Відправлено» pressed twice before the first is drawn: one asked, the
  // sheet kept while it is (review, 2026-11-01).
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, is_active: true, text: "Відправлено" });
  await page.evaluate(() => {
    for (let press = 0; press < 2; press += 1)
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: "main_button_pressed" }),
          source: window.parent,
        }),
      );
  });
  await expect.poll(() => server.sent.length).toBe(1);
  await wait(page, 300);
  await expect(sending).toBeVisible();
  await expect(page.getByText(/сервер не відповів/)).toHaveCount(0);
  await expect(page.locator("section.notice h3")).toHaveCount(0);
  // Telegram's button turns, its words kept, and takes no second press.
  await expect
    .poll(() => main(page))
    .toMatchObject({
      is_visible: true,
      is_active: false,
      is_progress_visible: true,
      text: "Відправлено",
    });
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  release();
  await expect(
    page.getByText("Відправлено. ТТН можна вписати пізніше.", { exact: true }),
  ).toBeVisible();
  expect(server.sent).toHaveLength(1);
});

test("a closed order, and an order seen by whoever may not step it, have no MainButton (orders task list, P0-2)", async ({
  page,
}) => {
  await open(page, {
    order: order({ status: "COLLECTED", payment_method: "CARD" }),
    sent: [],
  });
  // Collected: every place passed, its last knot tied.
  await expect(passed(page)).toHaveText([
    "До відправлення",
    "Відправлено",
    "Прибув на пошту",
    "Клієнт забрав",
  ]);
  await expect(page.locator(".knot-string .knot-loop")).toHaveCount(1);
  await expect(page.locator(".knot-string [aria-current]")).toHaveCount(0);
  await expect(page.locator(".order-title")).toBeVisible();
  await noMain(page);
  await expect(panel(page)).toHaveCount(0);

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
              (permission) => permission !== "sale:create",
            ),
          }
        : store,
    );
    await route.fulfill({ response, json: body });
  });
  await stub(page, { order: order(), sent: [] });
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Замовлення");
  await page.locator(".order-row").first().click();
  await expect(standing(page)).toHaveText("До відправлення");
  await noMain(page);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel(/Номер ТТН/)).toHaveCount(0);
});

test("«Клієнт забрав»: its sheet of five ways in two rows, each the step itself, nothing chosen first; card, and the sale said large with what to do, the server's sum, a buzz, the string tied; later a line (orders task list, P0-3; «Усе на бірці» sections task list, P0-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = {
    order: order({ status: "ARRIVED", waybill: "20450012345678" }),
    sent: [],
    collectedTotal: "1100.00",
  };
  await open(page, server);
  const taking = await ways(page);
  await expect(
    taking.getByRole("heading", { name: "Клієнт забрав — як оплачено?" }),
  ).toBeVisible();
  await expect(taking.locator(".pay-what")).toHaveText(
    "Лоран шоколад · M · Нова пошта",
  );
  await expect(taking.locator(".pay-total")).toHaveText("Разом 1 200,15 грн");
  const now = taking.getByRole("group", { name: "Зараз, у магазині" });
  const ahead = taking.getByRole("group", { name: "Наперед чи перевізнику" });
  await expect(now.getByRole("button")).toHaveText([
    "Готівка",
    "Картка",
    "Переказ",
  ]);
  await expect(ahead.getByRole("button")).toHaveText([
    "Переказ наперед",
    "Накладений платіж",
  ]);
  // Nothing chosen for the seller.
  await expect(taking.locator("[aria-pressed='true']")).toHaveCount(0);
  // Their captions the section's, as the card's «У посилці» (audit
  // 2026-11-13, orders-cash P2-2).
  for (const group of [now, ahead])
    await expectCaption(group.locator(".pay-caption"));
  // Two rows, each under the thumb's size, all on the screen — «Оплата
  // частинами» under them, the fifth way still in sight.
  const rows = [
    await now.getByRole("button").first().boundingBox(),
    await ahead.getByRole("button").first().boundingBox(),
  ];
  expect(rows[0] && rows[1] && rows[1].y > rows[0].y).toBe(true);
  for (const way of await taking
    .locator(".collect-ways")
    .getByRole("button")
    .all()) {
    expect((await way.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(way).toBeInViewport({ ratio: 1 });
  }
  // A switch row, as the till's (audit 2026-11-13, sale P2-6).
  await expect(
    taking.getByRole("switch", { name: "Оплата частинами" }),
  ).toBeVisible();
  // One line above them, never the drawer's words.
  await expect(
    taking.getByText("Продаж записуємо, коли покупець забрав товар.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/order-collect-sheet.png" });
  expect(server.sent).toEqual([]);
  await now.getByRole("button", { name: "Картка", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Продаж записано" });
  await expect(heading).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // A sale, so its stub torn off as the till's: the way's sticker, what
  // to do under it, the sum (stage 2, orders task list, P1-2).
  await expect(page.locator(".order-collected .stub-recorded")).toBeVisible();
  await expect(page.locator(".order-collected .way-pill")).toHaveText("Картка");
  await expect(page.locator(".order-collected .stub-say")).toHaveText(
    "Проведіть на терміналі",
  );
  // The server's sum, not what the phone showed.
  await expect(page.locator(".order-collected .stub-sum")).toHaveText(
    "1 100,00 грн",
  );
  await expect(heading).toHaveAccessibleDescription(
    "1 100,00 грн карткою. Проведіть на терміналі.",
  );
  expect(server.sent).toEqual([
    {
      step: "collect",
      body: { command_id: expect.any(String), payment_method: "CARD" },
    },
  ]);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  // Tied: nothing is left to do on it.
  await expect(passed(page).last()).toHaveText("Клієнт забрав");
  await expect(page.locator(".knot-string .knot-loop")).toHaveCount(1);
  await noMain(page);
  // The card the sale's result now: «До замовлень» its main, in the dock at
  // the menu's top; the receipt's quiet ways under the stub (audit
  // 2026-11-13, frame P2-9).
  const dock = await dockOnMenu(page, { scrolls: true });
  await expect(dock.getByRole("button")).toHaveText("До замовлень");
  await expect(dock.getByRole("button")).toHaveClass(/\bprimary\b/);
  await expect(page.locator("main button.primary:visible")).toHaveCount(1);
  await expect(
    page
      .locator(".order-collected > .return-offer")
      .getByRole("button", { name: "Оформити повернення" }),
  ).toHaveClass("quiet");
  await page.screenshot({ path: "test-results/order-collected-card.png" });
  // «← До замовлень» over the title, and the order seen again: a line.
  await page
    .locator(".screen-header")
    .getByRole("button", { name: "До замовлень", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Замовлення", exact: true })
    .getByRole("button", { name: "Клієнт забрав", exact: true })
    .click();
  await page.locator(".order-row").first().click();
  await expect(page.getByText("Продаж записано · Картка")).toBeVisible();
  await expect(page.locator(".order-collected")).toHaveCount(0);
  // Seen later, a card again: no result's dock (audit 2026-11-13, frame
  // P2-9).
  await expect(page.locator(".result-screen, .result-dock")).toHaveCount(0);
});

test("«Клієнт забрав» is four taps from the menu: «Замовлення», «Прибув на пошту», its row's «Клієнт забрав» and its way (orders task list, P0-3; «Усе на бірці» sections task list, P0-1)", async ({
  page,
}) => {
  const server: Server = { order: order({ status: "ARRIVED" }), sent: [] };
  await stub(page, server);
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
  // The warehouses' names, read for whoever reads the stock, change the
  // list as they come, and a tap within 0.7 s of that is let go: the
  // knot's tap waits for them. On CI they once came 280 ms after it, and
  // the row's tap 800 ms after it was let go (2026-11-12).
  const places = page.waitForRequest((request) =>
    request.url().includes("/api/v1/stock-locations?"),
  );
  await section(page, "Замовлення");
  await (await places).response();
  await page
    .getByRole("group", { name: "Замовлення", exact: true })
    .getByRole("button", { name: /^Прибув на пошту/ })
    .click();
  // The list just changed under the finger: a tap now is let go.
  await readTheAnswer(page);
  await page
    .getByRole("list", { name: "Прибув на пошту" })
    .getByRole("button", { name: "Клієнт забрав" })
    .click();
  const taking = await sheet(page, "Клієнт забрав — як оплачено?");
  await taking
    .getByRole("group", { name: "Зараз, у магазині" })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(4);
});

/** Taps `name` in a sheet the moment it is drawn, as a double tap's
 * second half would land: within milliseconds of the press that opened it.
 * A finger's tap, never a key's press. */
async function tapAsDrawn(page: Page, name: string): Promise<void> {
  await page.evaluate((wanted) => {
    const watch = new MutationObserver(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(".sheet button"),
      ].find((each) => each.textContent.trim() === wanted);
      if (!button) return;
      watch.disconnect();
      button.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      );
    });
    watch.observe(document.body, { childList: true, subtree: true });
  }, name);
}

/** A moment, as the phone's clock counts it. */
async function wait(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (delay) =>
      new Promise((done) => {
        setTimeout(done, delay);
      }),
    ms,
  );
}

test("a press meant for the step just taken, landing on the MainButton the next step took, is let go; a way tapped as its sheet is drawn too (review, 2026-10-24; «Усе на бірці» sections task list, P0-2)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [] };
  await open(page, server);
  // «Відправити», and the MainButton pressed again the moment the sheet's
  // «Відправлено» stands in its place: let go, nothing sent.
  await pressAsShown(page, "Відправлено");
  await pressMain(page, "Відправити");
  await sheet(page, "Відправити");
  expect(server.sent).toHaveLength(0);
  // «Відправлено», and the MainButton pressed again the moment it says
  // «Прибув на пошту».
  await pressAsShown(page, "Прибув на пошту");
  await pressMain(page, "Відправлено");
  await expect(
    page.getByText("Відправлено. ТТН можна вписати пізніше.", { exact: true }),
  ).toBeVisible();
  await wait(page, 300);
  expect(server.sent.map((each) => each.step)).toEqual(["dispatch"]);
  // Pressed a moment later, as meant: taken — and «Клієнт забрав» pressed
  // the moment it is shown, let go.
  await wait(page, 700);
  await pressAsShown(page, "Клієнт забрав");
  await pressMain(page, "Прибув на пошту");
  await expect(
    page.getByRole("status").filter({ hasText: /^Прибув на пошту$/ }),
  ).toBeVisible();
  await wait(page, 300);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await wait(page, 700);
  await tapAsDrawn(page, "Накладений платіж");
  await pressMain(page, "Клієнт забрав");
  await expect(
    page.getByRole("group", { name: "Наперед чи перевізнику" }),
  ).toBeVisible();
  await wait(page, 300);
  // Never a sale by a tap meant for «Клієнт забрав».
  expect(server.sent.map((each) => each.step)).toEqual(["dispatch", "arrive"]);
});

test("a card's «Клієнт забрав» whose answer never came, confirmed later, says it was recorded once and to charge the card only if nobody did (review, 2026-10-24)", async ({
  page,
}) => {
  const server: Server = {
    order: order({ status: "ARRIVED" }),
    sent: [],
    lose: true,
  };
  await open(page, server);
  const taking = await ways(page);
  await taking
    .getByRole("group", { name: "Зараз, у магазині" })
    .getByRole("button", { name: "Картка", exact: true })
    .click();
  // Kept: the sheet gone, the banner says it, and the step held while it
  // stands, as the dock's is (review, 2026-11-01).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() => main(page))
    .toMatchObject({
      is_visible: true,
      is_active: false,
      text: "Клієнт забрав",
    });
  await page
    .getByRole("button", { name: "Перевірити результат замовлення" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано один раз" }),
  ).toBeVisible();
  // The result's heading as the till's (audit 2026-11-13, orders-cash
  // P2-8).
  await expect(
    page.getByRole("heading", { name: "Продаж записано один раз" }),
  ).toHaveCSS("font-size", "24px");
  await expect(
    page.getByText("Операцію «Клієнт забрав» записано один раз"),
  ).toHaveCount(0);
  // The way alone, never «Проведіть»: it may have been charged meanwhile.
  await expect(page.locator(".order-collected .way-pill")).toHaveText("Картка");
  await expect(page.locator(".order-collected .stub-say")).toHaveCount(0);
  await expect(
    page.getByText(
      "Якщо картку ще не провели — проведіть на терміналі 1 200,15 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
    ),
  ).toBeVisible();
  expect(server.sent).toHaveLength(2);
  expect(server.sent[1]).toEqual(server.sent[0]);
});

test("«Клієнт забрав» in parts: terms not taken said over the ways, nothing sent; the part paid now large, alone, and what is owed (orders task list, P0-3; «Усе на бірці» sections task list, P0-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = {
    order: order({ status: "ARRIVED", total: "3000.00" }),
    sent: [],
  };
  await open(page, server);
  const taking = await ways(page);
  await taking.getByLabel("Оплата частинами").check();
  await taking.getByLabel("Ім’я покупця").fill("Оксана");
  await taking.getByLabel("Телефон покупця").fill("0501234567");
  await taking.getByLabel("Сплачує зараз, грн").fill("3000");
  const cash = taking
    .getByRole("group", { name: "Зараз, у магазині" })
    .getByRole("button", { name: "Готівка", exact: true });
  await cash.click();
  // Why, at the finger, over the ways — never under them.
  const why = taking.getByRole("alert");
  await expect(why).toContainText("Покупець сплачує все одразу");
  await expect(why).toBeFocused();
  const box = await why.boundingBox();
  const first = await taking.locator(".collect-ways").boundingBox();
  expect(box && first && box.y + box.height <= first.y + 1).toBe(true);
  expect(server.sent).toEqual([]);
  await taking.getByLabel("Сплачує зараз, грн").fill("500");
  await expect(taking.locator(".pay-total")).toHaveText(
    /^Зараз 500,00\sгрн · винен 2\s500,00\sгрн$/,
  );
  await cash.click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeFocused();
  // The part paid now large, the order's whole not over it.
  await expect(page.locator(".order-collected .stub-sum")).toHaveText(
    /^Сплачено зараз 500,00\sгрн$/,
  );
  await expect(page.locator(".order-total")).toHaveCount(0);
  await expect(page.locator(".order-collected .paid-owed")).toHaveText(
    /^Покупець винен 2\s500,00\sгрн\. Наступні внески — у «Продажі» › «Внесок»\.$/,
  );
  expect(server.sent).toEqual([
    {
      step: "collect",
      body: {
        command_id: expect.any(String),
        payment_method: "CASH",
        credit: {
          customer_name: "Оксана",
          customer_phone: "0501234567",
          paid_now: "500.00",
        },
      },
    },
  ]);
  await page.screenshot({ path: "test-results/order-collected-parts.png" });
});

test("a collected order whose way is not given to this person offers no «Змінити спосіб оплати» (G32; review, 2026-10-24)", async ({
  page,
}) => {
  await open(page, {
    order: order({
      status: "COLLECTED",
      sale_id: randomUUID(),
      payment_method: null,
    }),
    sent: [],
  });
  await expect(
    page.getByText("Продаж записано", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Змінити спосіб оплати" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Оформити повернення" }),
  ).toBeVisible();
});

/** «22.10, 14:05» of a moment, by this machine's clock, which the phone
 * shares. */
function stamp(iso: string): string {
  const at = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(at.getHours())}:${two(at.getMinutes())}`;
}

test("where it went, folded, then the history's thread: a version's day at the left, a filled eyelet, what it was, how it went under it, when by the phone's clock and by whom; the string's days, ordered and last sent (orders task list, P1-3; «Усе на бірці» sections task list, P0-2; orders and «Каса» task list after stage 2, P2-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const times = [
    "2026-01-05T08:07:00.000Z",
    "2026-02-14T19:41:00.000Z",
    "2026-11-30T23:59:00.000Z",
  ];
  const created = ago(3);
  await open(page, {
    order: order({
      created_at: created,
      status: "DISPATCHED",
      destination: "ABROAD",
      carrier: null,
      abroad_note: "Варшава, Польща",
      shipping_history: [
        {
          kind: "CREATED",
          by: "Оля",
          at: times[0],
          destination: "UKRAINE",
          carrier: "NOVA_POSHTA",
          waybill: null,
          abroad_note: null,
        },
        {
          kind: "DISPATCHED",
          by: "Петро",
          at: times[1],
          destination: "UKRAINE",
          carrier: "NOVA_POSHTA",
          waybill: "20451234567890",
          abroad_note: null,
        },
        {
          kind: "CORRECTED",
          by: "Оля",
          at: times[2],
          destination: "ABROAD",
          carrier: null,
          waybill: null,
          abroad_note: "Варшава, Польща",
        },
      ],
    }),
    sent: [],
  });
  // Sent, the day of its last sending under «Відправлено»; none for the
  // two after, whose days the server keeps not.
  await expect(standing(page)).toHaveText("Відправлено");
  await expect(passed(page)).toHaveText(["До відправлення"]);
  await expect(page.locator(".knot-string .knot-date")).toHaveText([
    short(created),
    short(times[1] ?? ""),
  ]);
  const folded = page.getByRole("button", { name: "Історія доставки" });
  await expect(folded).toHaveAttribute("aria-expanded", "false");
  const rows = page.getByRole("list", { name: "Історія доставки" });
  await expect(rows).toHaveCount(0);
  await folded.click();
  await expect(folded).toHaveAttribute("aria-expanded", "true");
  await expect(rows.getByRole("listitem")).toHaveCount(3);
  // The history's thread (spec §6.21): first version first, as before.
  await expect(rows).toHaveClass(/(?:^|\s)timeline(?:\s|$)/);
  await expect(rows.locator(".timeline-row")).toHaveCount(3);
  await expect(rows.locator(".timeline-day")).toHaveText([
    short(times[0] ?? ""),
    short(times[1] ?? ""),
    short(times[2] ?? ""),
  ]);
  await expect(rows.locator(".timeline-node")).toHaveCount(3);
  await expect(rows.locator(".timeline-what")).toHaveText([
    "Вказано при створенні",
    "Вписано при відправленні",
    "Змінено",
  ]);
  await expect(rows.locator(".timeline-meta")).toHaveText([
    `${stamp(times[0] ?? "")} · Оля`,
    `${stamp(times[1] ?? "")} · Петро`,
    `${stamp(times[2] ?? "")} · Оля`,
  ]);
  await expect(rows.locator(".shipping-how")).toHaveText([
    "Нова пошта · ТТН ще немає",
    "Нова пошта · ТТН 20451234567890",
    "За кордон · Варшава, Польща",
  ]);
  // What it was 16/600 with how it went under it, in ink; the day 52 at
  // the left with its gap, the eyelet filled on the thread.
  const kind = await rows.locator(".timeline-what").nth(1).boundingBox();
  const how = await rows.locator(".shipping-how").nth(1).boundingBox();
  expect(kind && how && how.y >= kind.y + kind.height - 1).toBe(true);
  expect(kind && how && Math.abs(how.x - kind.x) < 1).toBe(true);
  expect(
    await rows
      .locator(".timeline-what")
      .first()
      .evaluate((node) => [
        getComputedStyle(node).fontSize,
        getComputedStyle(node).fontWeight,
      ]),
  ).toEqual(["16px", "600"]);
  const thread = await rows.evaluate((list) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    probe.style.color = "var(--success)";
    const success = getComputedStyle(probe).color;
    probe.style.color = "var(--ink)";
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const row = list.querySelector(".timeline-row");
    const day = list.querySelector(".timeline-day");
    const node = list.querySelector(".timeline-node");
    const how = list.querySelector(".shipping-how");
    if (!row || !day || !node || !how) return null;
    return {
      day: day.getBoundingClientRect().left - row.getBoundingClientRect().left,
      node: [
        getComputedStyle(node).backgroundColor === success,
        node.getBoundingClientRect().width,
      ],
      how: getComputedStyle(how).color === ink,
      line: getComputedStyle(row, "::before").width,
    };
  });
  expect(thread).toEqual({
    day: 0,
    node: [true, 8],
    how: true,
    line: "1.5px",
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  // Abroad, sent: nothing to «вписати» — changed; no waybill to copy.
  await expect(
    page.getByRole("button", { name: "Змінити доставку", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Скопіювати ТТН" }),
  ).toHaveCount(0);
  // Folded again.
  await folded.click();
  await expect(rows).toHaveCount(0);
});

test("«Скопіювати ТТН» puts the waybill exactly as it was written on the clipboard, with a buzz and «ТТН скопійовано»; refused, says to copy it by hand («Усе на бірці» sections task list, P0-2)", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  // Written as it was typed: the server keeps it so.
  const waybill = "2045 0012 3456 78";
  await open(page, {
    order: order({ status: "DISPATCHED", waybill }),
    sent: [],
  });
  await expect(page.locator(".order-goes")).toHaveText(
    `Нова пошта · ТТН ${waybill}`,
  );
  const copy = page.getByRole("button", { name: "Скопіювати ТТН" });
  expect((await copy.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await copy.click();
  await expect(
    page.getByRole("status").filter({ hasText: /^ТТН скопійовано$/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    waybill,
  );
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  // The clipboard refused.
  await page.addInitScript(() => {
    Clipboard.prototype.writeText = () =>
      Promise.reject(new Error("Not allowed"));
  });
  await page.reload();
  await openStore(page, "Основний MAIN");
  await toOrder(page, "DISPATCHED");
  await copy.click();
  await expect(
    page.getByRole("status").filter({
      hasText: /^Не вдалося скопіювати — виділіть ТТН і скопіюйте її\.$/,
    }),
  ).toBeVisible();
  expect(await buzzes(page)).toEqual([]);
});

test("«Відправити»'s sheet: the parcel by its warehouses, Нова пошта's one line and Укрпошта's none, abroad its note and no customer's data; Enter puts the keyboard away and sends nothing; while typed Telegram asks before closing, and its «Назад» closes the sheet («Усе на бірці» sections task list, P0-3)", async ({
  page,
}) => {
  await warehouses(page);
  const server: Server = {
    order: order({
      items: [
        { ...item("Кокон графіт", "M"), source_location_id: OWN[0] },
        { ...item("Ріо графіт", null), source_location_id: NEXT[0] },
      ],
    }),
    sent: [],
  };
  // A Telegram that asks before closing: from 6.2.
  await open(page, server, undefined, "7.0");
  await pressMain(page, "Відправити");
  let sending = await sheet(page, "Відправити");
  await expect(sending).toHaveAccessibleDescription(
    "У посилці: Кокон графіт · M · склад «Свій», Ріо графіт · розмір невідомий · склад «Сусідній»",
  );
  await expect(
    sending.getByText("Пишемо як є — з Новою поштою не звіряємо.", {
      exact: true,
    }),
  ).toBeVisible();
  const field = sending.getByLabel("Номер ТТН (можна дописати пізніше)");
  await expect(field).toHaveAttribute("enterkeyhint", "done");
  // Never a number pad: a waybill may hold Latin letters.
  await expect(field).not.toHaveAttribute("inputmode", /.+/);
  const closing = (): Promise<unknown[]> =>
    page.evaluate(() =>
      (window as unknown as { told: [string, unknown][] }).told
        .filter(([event]) => event === "web_app_setup_closing_behavior")
        .map(([, data]) => data),
    );
  await field.click();
  await page.keyboard.type("20451234");
  await expect.poll(closing).toContainEqual({ need_confirmation: true });
  await page.keyboard.press("Enter");
  await expect(field).not.toBeFocused();
  await wait(page, 300);
  expect(server.sent).toEqual([]);
  // Telegram's «Назад»: the sheet closed, nothing sent, the question gone.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await expect(sending).toHaveCount(0);
  await expect
    .poll(async () => (await closing()).at(-1))
    .toEqual({
      need_confirmation: false,
    });
  await expect(standing(page)).toHaveText("До відправлення");
  expect(server.sent).toEqual([]);
  await expect.poll(() => main(page)).toMatchObject({ text: "Відправити" });

  // Укрпошта: no line of Нова пошта's.
  server.order = order({ carrier: "UKRPOSHTA" });
  await page.reload();
  await openStore(page, "Основний MAIN");
  await toOrder(page, "READY_TO_DISPATCH");
  await pressMain(page, "Відправити");
  sending = await sheet(page, "Відправити");
  await expect(sending.locator(".send-note")).toHaveCount(0);
  // Abroad: where and how, never the customer's name or phone.
  server.order = order({ destination: "ABROAD", carrier: null });
  await page.reload();
  await openStore(page, "Основний MAIN");
  await toOrder(page, "READY_TO_DISPATCH");
  await pressMain(page, "Відправити");
  sending = await sheet(page, "Відправити");
  const note = sending.getByLabel(
    "Куди і як відправили: місто, країна, спосіб (можна дописати пізніше)",
  );
  await expect(note).toBeFocused();
  await expect(note).toHaveAccessibleDescription(
    "Без імен і телефонів покупців.",
  );
  await expect(sending.locator(".send-note")).toHaveCount(0);
  await note.fill("Варшава, Польща, InPost");
  await pressMain(page, "Відправлено");
  await expect(sending).toHaveCount(0);
  expect(server.sent).toEqual([
    {
      step: "dispatch",
      body: {
        command_id: expect.any(String),
        abroad_note: "Варшава, Польща, InPost",
      },
    },
  ]);
});

test("the same waybill's other orders: each its row — its goods as its card's title, since when, its pill; several said so; one kept from before «Замовлення»; a tap opens it at its top (orders task list, P1-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const made = ago(1);
  const other = order({
    created_at: made,
    items: [
      item("Лоран шоколад", "M", 2),
      item("Ріо графіт", "L"),
      item("Ріо графіт", "XL"),
    ],
  });
  const before = randomUUID();
  const first = randomUUID();
  // It names this one back.
  other.same_waybill = [
    {
      id: first,
      status: "DISPATCHED",
      created_at: ago(2),
      display_name: "Лоран шоколад",
      size_label: "M",
      quantity: 1,
      lines: 1,
    },
  ];
  const server: Server = {
    order: order({
      id: first,
      status: "DISPATCHED",
      waybill: "20451234",
      same_waybill: [
        {
          id: other.id,
          status: "READY_TO_DISPATCH",
          created_at: made,
          display_name: "Лоран шоколад",
          size_label: "M",
          quantity: 2,
          lines: 3,
        },
        { id: before, status: "DISPATCHED" },
      ],
    }),
    sent: [],
    others: { [other.id]: other },
  };
  await open(page, server);
  await expect(
    page.getByText(
      "Ця ТТН є також у замовленнях — перевірте, чи це один пакунок.",
      { exact: true },
    ),
  ).toBeVisible();
  const rows = page
    .getByRole("list", { name: "Замовлення з цією ТТН" })
    .getByRole("button");
  await expect(rows.locator(".sale-goods")).toHaveText([
    "Лоран шоколад · M × 2 + ще 2",
    "Замовлення",
  ]);
  await expect(rows.nth(0).locator(".sale-meta")).toHaveText(
    `з\u00a0${short(made)}`,
  );
  await expect(rows.nth(1).locator(".sale-meta")).toHaveCount(0);
  await expect(rows.locator(".sticker")).toHaveText([
    "До відправлення",
    "Відправлено",
  ]);
  // Never their eight characters (В1).
  for (const id of [other.id, before])
    await expect(page.getByText(id.slice(0, 8))).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await rows.nth(0).click();
  await expect(
    page.getByRole("heading", {
      name: "Лоран шоколад · M × 2 + ще 2",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".order-number")).toHaveText(
    `№ ${other.id.slice(0, 8)}`,
  );
  // Back by its row to the first, read already: opened at its top, from
  // wherever the page was.
  const back = page
    .getByRole("list", { name: "Замовлення з цією ТТН" })
    .getByRole("button");
  await back.scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await back.click();
  await expect(page.locator(".order-number")).toHaveText(
    `№ ${first.slice(0, 8)}`,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // Read anew — the phone back from the carrier's app — and moved on
  // meanwhile: the same order's card drawn again keeps where it was read
  // to, never back at its top (audit after stage 2, frame P1-3; review).
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  server.order = { ...server.order, status: "ARRIVED" };
  // A read still on its way from the card's opening answers the first
  // return: back again until the new answer is drawn.
  await expect(async () => {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(standing(page)).toHaveText("Прибув на пошту", {
      timeout: 1_000,
    });
  }).toPass();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("a save refused for its waybill keeps where it goes and what was typed; the card read again and failed says so over it (review, 2026-10-25)", async ({
  page,
}) => {
  const server: Server = { order: order({ status: "DISPATCHED" }), sent: [] };
  await open(page, server);
  const writing = await shipping(page, "ТТН ще немає — вписати");
  const field = writing.getByLabel("Номер ТТН", { exact: true });
  await field.fill("НП");
  await readTheAnswer(page);
  server.answer = {
    status: 422,
    json: {
      code: "VALIDATION_ERROR",
      message: "A waybill has letters or digits",
      details: { reason: "WAYBILL", recorded: false },
    },
  };
  server.loseRead = true;
  const reads = server.reads ?? 0;
  await pressMain(page, "Зберегти доставку");
  // Said in the sheet, over what was typed.
  await expect(
    writing
      .getByRole("alert")
      .filter({ hasText: /^Номер ТТН має містити цифри або латинські літери/ }),
  ).toBeVisible();
  await expect.poll(() => server.reads ?? 0).toBeGreaterThan(reads);
  // The read again failed: what was typed is still in the sheet to check;
  // the card under it says it was not read, and is read once the sheet is
  // closed (stage 2, orders task list, P1-1).
  await expect(writing).toBeVisible();
  await expect(field).toHaveValue("НП");
  // Answered: the sheet no longer held — Telegram's «Назад» shown, Escape
  // closes it (audit 2026-11-13, orders-cash P2-3).
  await expect.poll(() => back(page)).toEqual({ is_visible: true });
  await page.keyboard.press("Escape");
  await expect(writing).toHaveCount(0);
  const again = page.getByRole("button", { name: "Спробувати ще раз" });
  await expect(again).toBeVisible();
  await again.click();
  await expect(again).toHaveCount(0);
  expect(server.sent.map((each) => each.step)).toEqual(["shipping"]);
});

test("a tap carried from «Змінити доставку» onto «Зберегти доставку» is let go, the sheet's own or Telegram's MainButton (review, 2026-10-25; stage 2, orders task list, P1-1)", async ({
  page,
}) => {
  const server: Server = {
    order: order({ status: "DISPATCHED", waybill: "20451234" }),
    sent: [],
  };
  await open(page, server);
  await shipping(page, "Змінити доставку");
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, text: "Зберегти доставку" });
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await readTheAnswer(page);
  expect(server.sent).toEqual([]);
  // Meant, it saves.
  await pressMain(page, "Зберегти доставку");
  await expect
    .poll(() => server.sent.map((each) => each.step))
    .toEqual(["shipping"]);
});

test("outside Telegram a tap carried from «Змінити доставку» onto the sheet's «Зберегти доставку» is let go (review, 2026-10-25; stage 2, orders task list, P1-1)", async ({
  page,
}) => {
  const server: Server = {
    order: order({ status: "DISPATCHED", waybill: "20451234" }),
    sent: [],
  };
  await open(page, server, undefined, null);
  const changing = await shipping(page, "Змінити доставку");
  await changing.getByRole("button", { name: "Зберегти доставку" }).click();
  await readTheAnswer(page);
  expect(server.sent).toEqual([]);
  await changing.getByRole("button", { name: "Зберегти доставку" }).click();
  await expect
    .poll(() => server.sent.map((each) => each.step))
    .toEqual(["shipping"]);
});

test("a waybill written later on a stubbed parcel: five taps from the menu with the typing — «Відправлено» among them — the cursor in its field, back on the card with a buzz (orders task list, P1-3; «Усе на бірці» task list, P0-4; sections task list, P0-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = { order: order({ status: "DISPATCHED" }), sent: [] };
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
      mains: Record<string, unknown>[];
      closing: boolean[];
    };
    host.buzzes = [];
    host.mains = [];
    host.closing = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
        if (event === "web_app_setup_main_button")
          host.mains.push(JSON.parse(data) as Record<string, unknown>);
        if (event === "web_app_setup_closing_behavior")
          host.closing.push(
            (JSON.parse(data) as { need_confirmation: boolean })
              .need_confirmation,
          );
      },
    };
  });
  // A Telegram that asks before closing (from 6.2).
  const asks = (): Promise<boolean | null> =>
    page.evaluate(
      () =>
        (window as unknown as { closing: boolean[] }).closing.at(-1) ?? null,
    );
  await stub(page, server);
  await page.goto("about:blank");
  await page.goto(launch({ version: "8.0" }));
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
  await toOrder(page, "DISPATCHED");
  const writing = await shipping(page, "ТТН ще немає — вписати");
  await expect(writing.getByLabel("Номер ТТН", { exact: true })).toBeFocused();
  // A waybill, never a word the phone would offer to finish.
  await expect(
    writing.getByLabel("Номер ТТН", { exact: true }),
  ).toHaveAttribute("autocomplete", "off");
  expect(await asks()).not.toBe(true);
  // Which order, in the sheet's line (stage 2, orders task list, P1-1).
  await expect(writing.locator(".send-parcel")).toHaveText("Лоран шоколад · M");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.keyboard.type("20451234");
  // Typed: Telegram asks before closing, until it is saved.
  await expect.poll(asks).toBe(true);
  await readTheAnswer(page);
  // Four taps on the page, the fifth on Telegram's MainButton.
  await pressMain(page, "Зберегти доставку");
  await expect(writing).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^Доставку збережено$/ }),
  ).toBeVisible();
  await expect.poll(asks).toBe(false);
  // In one line, its eyelet filled in the colour of where the order
  // stands (stage 2, orders task list, P1-3).
  const transit = await page.evaluate(() => {
    const probe = document.createElement("i");
    document.body.append(probe);
    probe.style.color = "var(--transit)";
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  await expect(page.locator(".order-done .step-done .eyelet-filled")).toHaveCSS(
    "background-color",
    transit,
  );
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(4);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  expect(server.sent).toEqual([
    {
      step: "shipping",
      body: {
        command_id: expect.any(String),
        destination: "UKRAINE",
        carrier: "NOVA_POSHTA",
        waybill: "20451234",
      },
    },
  ]);
  await expect(page.locator(".order-goes")).toHaveText(
    "Нова пошта · ТТН 20451234",
  );
  await expect(
    page.getByRole("button", { name: "Скопіювати ТТН" }),
  ).toBeVisible();
});

/** Two warehouses, the store's own and the neighbour's, as
 * `/stock-locations` names them; or refused, as to whoever may not see the
 * store's warehouses; or the neighbour's not among them, paused, or not
 * receiving. */
type Warehouses = "both" | "refused" | "unknown" | "paused" | "not receiving";
async function warehouses(
  page: Page,
  as: Warehouses = "both",
  /** Asked again, refused from then on. */
  after?: { refused: boolean },
): Promise<void> {
  await page.route("**/api/v1/stock-locations?*", async (route) => {
    if (as === "refused" || after?.refused) {
      await route.fulfill({
        status: 403,
        json: { code: "PERMISSION_DENIED", message: "Permission denied" },
      });
      return;
    }
    await route.fulfill({
      json: (as === "unknown" ? [OWN] : [OWN, NEXT]).map(([id, name]) => ({
        id,
        name,
        code: name.toUpperCase(),
        is_active: !(as === "paused" && id === NEXT[0]),
        can_sell: true,
        can_receive: !(as === "not receiving" && id === NEXT[0]),
        damaged_returns: false,
        awaiting_first_stock: false,
      })),
    });
  });
}
const OWN = [randomUUID(), "Свій"] as const;
const NEXT = [randomUUID(), "Сусідній"] as const;

/** A parcel come back from two warehouses: two coats from the store's own,
 * one from the neighbour's. */
function cameBack(): Stubbed {
  return order({
    status: "DISPATCHED",
    waybill: "20451234",
    items: [
      { ...item("Лоран шоколад", "M", 2), source_location_id: OWN[0] },
      { ...item("Ріо графіт", "L"), source_location_id: NEXT[0] },
    ],
  });
}

test("goods come back as their own step: each warehouse they go back to named, seven taps from the menu with the typing — «Відправлено» among them, the last Telegram's MainButton — the result a sentence a warehouse with a buzz (orders task list, P2-4; «Усе на бірці» task list, P0-4; sections task list, P0-1; orders and «Каса» task list after stage 2, P1-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = { order: cameBack(), sent: [] };
  await warehouses(page);
  await hear(page);
  await stub(page, server);
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page.evaluate(() => {
    const host = window as unknown as { taps: number };
    host.taps = 0;
    document.addEventListener(
      "pointerdown",
      () => {
        host.taps += 1;
      },
      true,
    );
  });
  await toOrder(page, "DISPATCHED");
  const row = page.getByRole("button", { name: "Товар повернувся на склад" });
  await row.click();
  await expect(
    page.getByRole("heading", { name: "Товар повернувся на склад" }),
  ).toBeFocused();
  await expect(
    page
      .getByRole("list", { name: "Куди повернеться товар" })
      .getByRole("listitem"),
  ).toHaveText([
    "Повернеться на склад «Свій»: Лоран шоколад · M × 2",
    "Повернеться на склад «Сусідній»: Ріо графіт · L",
  ]);
  // The order's goods the line under the title, no window repeating them
  // over the button (P1-2).
  await expect(page.locator(".store-line p:visible")).toHaveText(
    "Основний · Лоран шоколад · M × 2 + ще 1",
  );
  await expect(page.locator(".pay-what")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  // A text's key makes a new line (audit 2026-11-13, orders-cash P2-3).
  await expect(page.getByLabel("Причина повернення")).toHaveAttribute(
    "enterkeyhint",
    "enter",
  );
  await page.getByLabel("Причина повернення").click();
  await page.keyboard.type("Не забрали з пошти");
  await readTheAnswer(page);
  await page
    .getByLabel("Усі товари фізично отримані на складах відправлення")
    .check();
  await pressMain(page, "Прийняти повернення");
  await expect(
    page.getByRole("status").filter({
      hasText:
        /^Повернено на склад «Свій»: 2 шт\. Повернено на склад «Сусідній»: 1 шт\.$/,
    }),
  ).toBeVisible();
  // Six taps in the app; the seventh Telegram's MainButton.
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(6);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  expect(server.sent).toEqual([
    {
      step: "return",
      body: {
        command_id: expect.any(String),
        reason: "Не забрали з пошти",
        physically_received: true,
      },
    },
  ]);
});

test("goods come back to whoever may not see the store's warehouses: said as before, unnamed, the result too (orders task list, P2-4)", async ({
  page,
}) => {
  const server: Server = { order: cameBack(), sent: [] };
  await warehouses(page, "refused");
  // Outside Telegram: the dock's one button (P1-2).
  await open(page, server, undefined, null);
  const row = page.getByRole("button", { name: "Товар повернувся на склад" });
  // Back without taking it: nothing sent, the row in focus.
  await row.click();
  await page
    .locator(".screen-header")
    .getByRole("button", { name: "Замовлення", exact: true })
    .click();
  await expect(row).toBeFocused();
  expect(server.sent).toEqual([]);
  await row.click();
  await expect(
    page.getByText("Товар повернеться на ті склади, звідки його відправили.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Куди повернеться товар" }),
  ).toHaveCount(0);
  const press = panel(page).getByRole("button", {
    name: "Прийняти повернення",
  });
  // Neither the reason alone nor the tick alone.
  await page.getByLabel("Причина повернення").fill("Не забрали");
  await expect(press).toBeDisabled();
  await page.getByLabel("Причина повернення").fill("   ");
  await readTheAnswer(page);
  await page
    .getByLabel("Усі товари фізично отримані на складах відправлення")
    .check();
  await expect(press).toBeDisabled();
  await page.getByLabel("Причина повернення").fill("Не забрали");
  await press.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Повернено на склади відправлення: 3 шт\.$/ }),
  ).toBeVisible();
});

for (const as of ["unknown", "paused", "not receiving"] as const)
  test(`goods come back with the neighbour's warehouse ${as}: said as before, unnamed — never a warehouse the server would not take them back to (review, 2026-10-25)`, async ({
    page,
  }) => {
    await warehouses(page, as);
    await open(page, { order: cameBack(), sent: [] });
    await page
      .getByRole("button", { name: "Товар повернувся на склад" })
      .click();
    await expect(
      page.getByText(
        "Товар повернеться на ті склади, звідки його відправили.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText(/Повернеться на склад/)).toHaveCount(0);
  });

test("goods come back on a task's screen: the menu aside, the order's goods the line under its title, «Прийняти повернення» Telegram's MainButton held until the reason and the tick and turning while answered; Telegram's «Назад» back to the card (orders and «Каса» task list after stage 2, P1-2; В-ЗП6 (а))", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = { order: cameBack(), sent: [] };
  await warehouses(page);
  await open(page, server);
  const sections = page.getByRole("navigation", { name: "Розділи" });
  await expect(sections).toBeVisible();
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, text: "Прибув на пошту" });
  const row = page.getByRole("button", { name: "Товар повернувся на склад" });
  await row.click();
  await expect(
    page.getByRole("heading", { name: "Товар повернувся на склад" }),
  ).toBeFocused();
  // A task's screen: the menu steps aside, «Змінити магазин» held.
  await expect(sections).toHaveCount(0);
  await expect(
    page
      .locator(".store-line")
      .getByRole("button", { name: "Змінити магазин" }),
  ).toBeDisabled();
  // Its one line: the store and the goods, two lines at most at 360.
  const line = page.locator(".store-line p:visible");
  await expect(line).toHaveText("Основний · Лоран шоколад · M × 2 + ще 1");
  expect(
    await line.evaluate(
      (node) =>
        node.getBoundingClientRect().height /
        parseFloat(getComputedStyle(node).lineHeight),
    ),
  ).toBeLessThanOrEqual(2.1);
  // Telegram's MainButton, the card's put away; no button of the app's.
  await expect(page.locator(".order-dock")).toHaveCount(0);
  await expect(page.locator(".order-returned button")).toHaveCount(0);
  await expect
    .poll(() => main(page))
    .toMatchObject({
      is_visible: true,
      is_active: false,
      text: "Прийняти повернення",
    });
  // Telegram's «Назад» is «← Замовлення»: the card, its row in focus, the
  // menu back, its own MainButton again.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await expect(row).toBeFocused();
  await expect(sections).toBeVisible();
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_visible: true, text: "Прибув на пошту" });
  // Again: held while the reason or the tick is missing — a press then
  // sends nothing.
  await row.click();
  const pressed = (): Promise<void> =>
    page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: "main_button_pressed" }),
          source: window.parent,
        }),
      );
    });
  await page.getByLabel("Причина повернення").fill("Не забрали з пошти");
  await readTheAnswer(page);
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_active: false, text: "Прийняти повернення" });
  await pressed();
  await page
    .getByLabel("Усі товари фізично отримані на складах відправлення")
    .check();
  await page.getByLabel("Причина повернення").fill("   ");
  await expect
    .poll(() => main(page))
    .toMatchObject({ is_active: false, text: "Прийняти повернення" });
  await pressed();
  await readTheAnswer(page);
  expect(server.sent).toEqual([]);
  await page.getByLabel("Причина повернення").fill("Не забрали з пошти");
  // Answered late: Telegram's button turns, its words kept.
  let release = (): void => undefined;
  server.hold = new Promise<void>((done) => {
    release = done;
  });
  await pressMain(page, "Прийняти повернення");
  await expect
    .poll(() => main(page))
    .toMatchObject({
      is_visible: true,
      is_active: false,
      is_progress_visible: true,
      text: "Прийняти повернення",
    });
  // No way out while it is answered: Telegram's «Назад» hidden, and pressed
  // anyway, the screen and what was typed stay (review).
  const backs = (): Promise<unknown[]> =>
    page.evaluate(() =>
      (window as unknown as { told: [string, unknown][] }).told
        .filter(([event]) => event === "web_app_setup_back_button")
        .map(([, data]) => data),
    );
  await expect
    .poll(async () => (await backs()).at(-1))
    .toEqual({ is_visible: false });
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await readTheAnswer(page);
  await expect(
    page.getByRole("heading", { name: "Товар повернувся на склад" }),
  ).toBeVisible();
  await expect(page.getByLabel("Причина повернення")).toHaveValue(
    "Не забрали з пошти",
  );
  await expect(sections).toHaveCount(0);
  release();
  await expect(
    page.getByRole("status").filter({
      hasText:
        /^Повернено на склад «Свій»: 2 шт\. Повернено на склад «Сусідній»: 1 шт\.$/,
    }),
  ).toBeVisible();
  // Taken: the card, the menu back.
  await expect(sections).toBeVisible();
  expect(server.sent).toHaveLength(1);
});

test("a long product's line under «Товар повернувся на склад» is three lines at most at 360 beside «Змінити магазин», two without it, never past the screen (orders and «Каса» task list after stage 2, P1-2; review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = {
    order: order({
      status: "DISPATCHED",
      waybill: "20451234",
      items: [
        {
          ...item("Пальто вовняне подовжене з поясом", "XXL"),
          source_location_id: OWN[0],
        },
        { ...item("Ріо графіт", "L"), source_location_id: NEXT[0] },
        { ...item("Кокон графіт", "M"), source_location_id: NEXT[0] },
      ],
    }),
    sent: [],
  };
  await warehouses(page);
  await open(page, server);
  await page.getByRole("button", { name: "Товар повернувся на склад" }).click();
  const line = page.locator(".store-line p:visible");
  await expect(line).toHaveText(
    "Основний · Пальто вовняне подовжене з поясом · XXL + ще 2",
  );
  const lines = (): Promise<number> =>
    line.evaluate((node) =>
      Math.round(
        node.getBoundingClientRect().height /
          parseFloat(getComputedStyle(node).lineHeight),
      ),
    );
  // The screen's own, not the card's hidden under it.
  const change = page
    .locator(".store-line:visible")
    .locator("button", { hasText: "Змінити магазин" });
  await expect(change).toBeVisible();
  expect(await lines()).toBeLessThanOrEqual(3);
  await change.evaluate((node) => {
    (node as HTMLElement).style.display = "none";
  });
  expect(await lines()).toBeLessThanOrEqual(2);
  await change.evaluate((node) => {
    (node as HTMLElement).style.display = "";
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});

/** On «Товар повернувся на склад», a reason typed and the goods ticked in
 * hand. */
async function readyToTake(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Товар повернувся на склад" }).click();
  await page.getByLabel("Причина повернення").fill("Не забрали з пошти");
  await readTheAnswer(page);
  await page
    .getByLabel("Усі товари фізично отримані на складах відправлення")
    .check();
}

test("a return refused as changed keeps its screen, the reason and the tick, why under the tick and the title where it was; one another phone already took back shows the card as it is now, why at its foot (review, 2026-10-25; audit 2026-11-13, orders P1-1)", async ({
  page,
}) => {
  const server: Server = { order: cameBack(), sent: [] };
  await warehouses(page);
  await open(page, server, undefined, null);
  await readyToTake(page);
  server.answer = {
    status: 409,
    json: {
      code: "CONFLICT",
      message: "Conflict",
      details: { recorded: false },
    },
  };
  const take = panel(page).getByRole("button", { name: "Прийняти повернення" });
  // Outside Telegram, the MainButton's own place: 50, Telegram's corner 10
  // (spec §6.4; orders and «Каса» task list after stage 2, P1-2).
  await expect(take).toHaveClass("main-mimic");
  expect((await take.boundingBox())?.height).toBe(50);
  await expect(take).toHaveCSS("border-top-left-radius", "10px");
  const heading = page.getByRole("heading", {
    name: "Товар повернувся на склад",
  });
  // Where it stands on the page, wherever the cursor scrolls it.
  const onPage = (): Promise<number> =>
    heading.evaluate(
      (node) => node.getBoundingClientRect().top + window.scrollY,
    );
  const headingBefore = await onPage();
  await take.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(heading).toBeVisible();
  // Under the tick, in the return's own section, the cursor on it; its
  // title where it stood.
  const why = page.locator("section.order-returned > fieldset + [role=alert]");
  await expect(why).toBeVisible();
  await expect(why).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(1);
  expect(await onPage()).toBe(headingBefore);
  await expect(page.getByLabel("Причина повернення")).toHaveValue(
    "Не забрали з пошти",
  );
  await expect(
    page.getByLabel("Усі товари фізично отримані на складах відправлення"),
  ).toBeChecked();
  // Back to the card: why was the return's, never carried onto the card,
  // nor back on the return opened again (review, 2026-11-13).
  await page
    .locator(".screen-header")
    .getByRole("button", { name: "Замовлення", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Товар повернувся на склад" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await readyToTake(page);
  await expect(heading).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Pressed again, it was taken back meanwhile by another phone: the card
  // as it is now, nothing more to take back.
  server.answer = {
    status: 409,
    json: {
      code: "CONFLICT",
      message: "Conflict",
      details: { recorded: false },
    },
    becomes: { status: "RETURNED" },
  };
  await take.click();
  await expect(standing(page)).toHaveText("Повернено на склад");
  await expect(
    page.getByRole("heading", { name: "Товар повернувся на склад" }),
  ).toHaveCount(0);
  // Its screen gone with the card as it is now: why at the card's foot.
  await expect(page.locator("section.order > [role=alert]")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Товар повернувся на склад" }),
  ).toHaveCount(0);
});

test("a return whose answer never came names its step and its order; checked again and recorded, it says so once, with a buzz (orders task list, P1-1, P2-4)", async ({
  page,
}) => {
  const server: Server = { order: cameBack(), sent: [], lose: true };
  await warehouses(page);
  await open(page, server);
  await readyToTake(page);
  await pressMain(page, "Прийняти повернення");
  const again = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  await expect(again).toBeEnabled();
  await expect(
    page.locator("section.notice", {
      has: page.getByRole("heading", {
        name: "Операцію «Прийняти повернення» ще не підтверджено",
      }),
    }),
  ).toContainText(
    "Лоран шоколад · M × 2 + ще 1 · Нова пошта · ТТН 20451234 — сервер не відповів. Двічі цю операцію не запишуть.",
  );
  await again.click();
  await expect(
    page.getByRole("status").filter({
      hasText: /^Операцію «Прийняти повернення» записано один раз$/,
    }),
  ).toBeVisible();
  // Kept, it was felt once, a warning (spec §4.4; «Усе на бірці» task
  // list, P1-2); recorded, a success.
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "warning" },
    { type: "notification", notification_type: "success" },
  ]);
  expect(server.sent).toHaveLength(2);
  expect(server.sent[1]).toEqual(server.sent[0]);
});

test("the right to see the warehouses gone while goods come back: read again on return to the app and refused, the screen and the result say them unnamed (review, 2026-10-25)", async ({
  page,
}) => {
  const after = { refused: false };
  await warehouses(page, "both", after);
  await open(page, { order: cameBack(), sent: [] }, undefined, null);
  await readyToTake(page);
  await expect(page.getByText(/^Повернеться на склад «Свій»/)).toBeVisible();
  after.refused = true;
  // Back in the app: what it shows is read again.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByText("Товар повернеться на ті склади, звідки його відправили.", {
      exact: true,
    }),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Прийняти повернення" })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Повернено на склади відправлення: 3 шт\.$/ }),
  ).toBeVisible();
});

test("a tap carried from «Товар повернувся на склад» onto the tick is let go: the goods are ticked in hand only meant (review, 2026-10-25)", async ({
  page,
}) => {
  await warehouses(page);
  await open(page, { order: cameBack(), sent: [] });
  await page.getByRole("button", { name: "Товар повернувся на склад" }).click();
  const tick = page.getByLabel(
    "Усі товари фізично отримані на складах відправлення",
  );
  await tick.click();
  await expect(tick).not.toBeChecked();
  await readTheAnswer(page);
  await tick.click();
  await expect(tick).toBeChecked();
});

test("while an order is read, its title, context, string of knots, «У посилці» and two lines hold their places, heard as «Завантажуємо замовлення…»; one that could not be read says so on a warning's plate (orders task list, P2-2, P2-3; orders and «Каса» task list after stage 2, P1-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let release = (): void => undefined;
  const server: Server = {
    order: order(),
    sent: [],
    readHeld: new Promise((done) => {
      release = done;
    }),
  };
  await open(page, server);
  await expect(
    page.getByRole("status").filter({ hasText: "Завантажуємо замовлення…" }),
  ).toBeAttached();
  await expect(page.locator(".order-placeholder")).toBeVisible();
  // Its line of context the head's one line: no grey line of its own under
  // it (orders and «Каса» task list after stage 2, P2-1; review).
  await expect(page.locator(".store-line p:visible")).toBeVisible();
  await expect(page.locator(".order-placeholder .skeleton-meta")).toHaveCount(
    0,
  );
  // The string's place, where a pill stood: its four knots, «У посилці»'s
  // place under it (orders and «Каса» task list after stage 2, P1-1).
  const stringPlace = page.locator(".order-placeholder .knots");
  await expect(stringPlace.locator(".knot")).toHaveCount(4);
  await expect(page.locator(".order-placeholder .skeleton-pill")).toHaveCount(
    0,
  );
  const [knotsAt, sectionAt] = await Promise.all([
    stringPlace.boundingBox(),
    page.locator(".order-placeholder .order-section").boundingBox(),
  ]);
  const back = page.getByRole("button", { name: "До замовлень", exact: true });
  const before = await back.boundingBox();
  const place = await page.locator(".skeleton-title").boundingBox();
  release();
  const title = page.getByRole("heading", {
    name: "Лоран шоколад · M",
    exact: true,
  });
  await expect(title).toBeVisible();
  expect((await back.boundingBox())?.y).toBe(before?.y);
  expect(
    Math.abs(((await title.boundingBox())?.y ?? 0) - (place?.y ?? 0)),
  ).toBeLessThanOrEqual(1);
  // The string where its place stood, as tall; «У посилці» unmoved.
  const string = await page.locator("ol.knot-string").boundingBox();
  expect(Math.abs((string?.y ?? 0) - (knotsAt?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(
    Math.abs((string?.height ?? 0) - (knotsAt?.height ?? 0)),
  ).toBeLessThanOrEqual(1);
  const section = await page
    .getByRole("heading", { name: "У посилці" })
    .boundingBox();
  expect(Math.abs((section?.y ?? 0) - (sectionAt?.y ?? 0))).toBeLessThanOrEqual(
    1,
  );
  // What is said under a step, 14 px (P2-3).
  expect(
    await page
      .locator(".order .hint")
      .first()
      .evaluate((node) => getComputedStyle(node).fontSize),
  ).toBe("14px");
  // Read again and failed: a warning's plate, the card as last read under
  // it.
  await back.click();
  server.loseRead = true;
  await page.locator(".order-row").first().click();
  const plate = page.locator(".notice.read-failure");
  await expect(plate).toHaveAttribute("role", "alert");
  await expect(plate.getByRole("button")).toHaveText("Спробувати ще раз");
  // The warning's colours, never a debt's red.
  const colours = await plate.evaluate((node) => {
    const probe = document.createElement("p");
    probe.className = "notice";
    document.body.append(probe);
    const notice = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { plate: getComputedStyle(node).backgroundColor, notice };
  });
  expect(colours.plate).toBe(colours.notice);
});

test("opened from its row, a cancelled order read holds its sticker's place under the string, and one with no day no day's place: the sticker and «У посилці» stand where their places stood (orders and «Каса» task list after stage 2, P1-1; review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let release = (): void => undefined;
  const server: Server = {
    order: order({ status: "CANCELLED" }),
    sent: [],
    readHeld: new Promise((done) => {
      release = done;
    }),
  };
  await open(page, server);
  const pill = page.locator(".order-placeholder .knot-sticker .skeleton-pill");
  await expect(pill).toBeVisible();
  const [pillAt, sectionAt] = await Promise.all([
    page.locator(".order-placeholder .knot-sticker").boundingBox(),
    page.locator(".order-placeholder .order-section").boundingBox(),
  ]);
  release();
  const sticker = page.locator(".knot-sticker");
  await expect(sticker.locator(".sticker")).toHaveText("Скасовано");
  const [came, section] = await Promise.all([
    sticker.boundingBox(),
    page.getByRole("heading", { name: "У посилці" }).boundingBox(),
  ]);
  expect(Math.abs((came?.y ?? 0) - (pillAt?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(
    Math.abs((came?.height ?? 0) - (pillAt?.height ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs((section?.y ?? 0) - (sectionAt?.y ?? 0))).toBeLessThanOrEqual(
    1,
  );

  // No day kept: none under «До відправлення», no «замовлено» in the line.
  let again = (): void => undefined;
  server.order = order({ created_at: null });
  server.readHeld = new Promise((done) => {
    again = done;
  });
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toOrder(page, "READY_TO_DISPATCH");
  await expect(page.locator(".order-placeholder .knot")).toHaveCount(4);
  await expect(page.locator(".order-placeholder .knot-date")).toHaveCount(0);
  await expect(page.locator(".order-placeholder .skeleton-pill")).toHaveCount(
    0,
  );
  const [lineAt, stringAt, placeAt] = await Promise.all([
    page.locator(".store-line p:visible").boundingBox(),
    page.locator(".order-placeholder .knots").boundingBox(),
    page.locator(".order-placeholder .order-section").boundingBox(),
  ]);
  again();
  await expect(
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".knot-string .knot-date")).toHaveCount(0);
  const [line, string, inParcel] = await Promise.all([
    page.locator(".store-line p:visible").boundingBox(),
    page.locator("ol.knot-string").boundingBox(),
    page.getByRole("heading", { name: "У посилці" }).boundingBox(),
  ]);
  expect(
    Math.abs((line?.height ?? 0) - (lineAt?.height ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((string?.height ?? 0) - (stringAt?.height ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs((inParcel?.y ?? 0) - (placeAt?.y ?? 0))).toBeLessThanOrEqual(
    1,
  );
});

test("«Замовлення» pressed again on an order's card brings the orders' first screen (navigation task list, P0-2; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await open(page, { order: order(), sent: [] });
  await expect(page.locator(".order-title")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Розділи" })
    .getByRole("button", { name: "Замовлення", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-title")).toHaveCount(0);
  await expect(page.locator(".order-row").first()).toBeVisible();
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
  test(`in the ${name} theme the order reads at 4.5:1, nothing wider than the phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await warehouses(page);
    await open(
      page,
      {
        order: order({
          items: [
            { ...item("Лоран шоколад", "M"), source_location_id: OWN[0] },
          ],
        }),
        sent: [],
      },
      theme,
    );
    await apart(page);
    for (const part of [
      page.locator(".order-title"),
      page.locator(".store-line p:visible"),
      page.locator(".order-number"),
      page.locator(".knot-string .knot-label").first(),
      page.locator(".knot-string .knot-label").last(),
      page.locator(".knot-string .knot-date"),
      page.locator(".order-section").first(),
      page.locator(".order-line .cash-row-title"),
      page.locator(".order-line .sale-meta"),
      page.locator(".order-line .history-sum"),
      page.locator(".order-total"),
      page.locator(".order-goes"),
      page.getByRole("button", { name: "Історія доставки" }),
      page.getByRole("button", { name: "Скасувати замовлення", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-card-${name}.png` });
    // «Відправити»'s sheet.
    await pressMain(page, "Відправити");
    const sending = await sheet(page, "Відправити");
    for (const part of [
      sending.getByRole("heading", { name: "Відправити" }),
      sending.locator(".send-parcel"),
      sending.locator(".send-field"),
      sending.locator(".send-note"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-send-${name}.png` });
  });

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme «Клієнт забрав»'s ways read at 4.5:1, nothing wider than the phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page, { order: order({ status: "ARRIVED" }), sent: [] }, theme);
    const taking = await ways(page);
    for (const part of [
      taking.getByRole("heading", { name: "Клієнт забрав — як оплачено?" }),
      taking.locator(".pay-what"),
      taking.locator(".pay-total"),
      taking.locator(".hint"),
      taking.locator(".pay-caption").first(),
      taking.locator(".pay-caption").last(),
      taking.getByRole("button", { name: "Готівка", exact: true }),
      taking.getByRole("button", { name: "Накладений платіж", exact: true }),
      taking.getByText("Оплата частинами", { exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-collect-${name}.png` });
    // Recorded: «Продаж записано» the result's heading as the till's — the
    // display face 24/800 on one line at 360 (audit 2026-11-13,
    // orders-cash P2-8).
    await taking.getByRole("button", { name: "Готівка", exact: true }).click();
    const title = page
      .locator(".order-collected")
      .getByRole("heading", { name: "Продаж записано" });
    await expect(title).toBeFocused();
    const look = await title.evaluate((node) => {
      const style = getComputedStyle(node);
      const probe = document.createElement("span");
      probe.style.fontFamily = "var(--font-display)";
      document.body.append(probe);
      const display = getComputedStyle(probe).fontFamily;
      probe.remove();
      const words = [...node.childNodes].find(
        (child) =>
          child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
      );
      if (words === undefined) throw new Error("no words");
      const range = document.createRange();
      range.selectNodeContents(words);
      return {
        size: style.fontSize,
        weight: style.fontWeight,
        line: style.lineHeight,
        display: style.fontFamily === display,
        lines: range.getClientRects().length,
      };
    });
    expect(look).toEqual({
      size: "24px",
      weight: "800",
      line: "26px",
      display: true,
      lines: 1,
    });
    expect(await contrast(title)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/order-collected-title-${name}.png`,
    });
  });

test("the card's links say their way on by the set's chevron, never a typed «›»; «Історія доставки» turns it while open (audit 2026-11-13, orders-cash P2-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page, { order: order(), sent: [] });
  const history = page.getByRole("button", { name: "Історія доставки" });
  await expectLinkChevron(history, "Історія доставки");
  await expectLinkChevron(
    page.getByRole("button", { name: "Змінити доставку", exact: true }),
    "Змінити доставку",
  );
  // The thumb's 44 as before.
  expect((await history.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await chevronTurn(history)).toBe(0);
  await history.click();
  await expect(history).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => chevronTurn(history)).toBe(90);
  await history.click();
  await expect(history).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => chevronTurn(history)).toBe(0);
  // Sent with no waybill: the waybill to write, and the goods come back.
  await open(page, { order: order({ status: "DISPATCHED" }), sent: [] });
  await expectLinkChevron(
    page.getByRole("button", { name: "ТТН ще немає — вписати", exact: true }),
    "ТТН ще немає — вписати",
  );
  await expectLinkChevron(
    page.getByRole("button", { name: "Товар повернувся на склад" }),
    "Товар повернувся на склад",
  );
  await expect(page.locator("#root")).not.toContainText("›");
  await page.screenshot({ path: "test-results/order-links.png" });
});

test("«Відправлено» and «Зберегти доставку» on their way hide Telegram's «Назад», and neither it, Escape nor the scrim closes the sheet; answered, «Назад» is the card's again (audit 2026-11-13, orders-cash P2-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let answer = (): void => undefined;
  const server: Server = {
    order: order(),
    sent: [],
    hold: new Promise<void>((done) => {
      answer = done;
    }),
  };
  await open(page, server);
  const backs = (): Promise<unknown> => back(page);
  const backPressed = (): Promise<void> =>
    page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: "back_button_pressed" }),
          source: window.parent,
        }),
      );
    });
  await pressMain(page, "Відправити");
  const sending = await sheet(page, "Відправити");
  await expect.poll(backs).toEqual({ is_visible: true });
  await pressMain(page, "Відправлено");
  await expect.poll(() => server.sent.length).toBe(1);
  await expect.poll(backs).toEqual({ is_visible: false });
  await backPressed();
  await sending.focus();
  await page.keyboard.press("Escape");
  await page.mouse.click(180, 20);
  await wait(page, 300);
  await expect(sending).toBeVisible();
  expect(server.sent).toHaveLength(1);
  answer();
  await expect(sending).toHaveCount(0);
  await expect(standing(page)).toHaveText("Відправлено");
  await expect.poll(backs).toEqual({ is_visible: true });
  // «Доставка», its waybill written later: the same.
  await readTheAnswer(page);
  server.hold = new Promise<void>((done) => {
    answer = done;
  });
  await shipping(page, "ТТН ще немає — вписати");
  const editing = await sheet(page, "Доставка");
  await editing.getByLabel("Номер ТТН", { exact: true }).fill("20450012345678");
  await expect.poll(backs).toEqual({ is_visible: true });
  await pressMain(page, "Зберегти доставку");
  await expect.poll(() => server.sent.length).toBe(2);
  await expect.poll(backs).toEqual({ is_visible: false });
  await backPressed();
  await editing.focus();
  await page.keyboard.press("Escape");
  await page.mouse.click(180, 20);
  await wait(page, 300);
  await expect(editing).toBeVisible();
  expect(server.sent).toHaveLength(2);
  answer();
  await expect(editing).toHaveCount(0);
  await expect.poll(backs).toEqual({ is_visible: true });
});

test("«Клієнт забрав» by each of its five ways is a sale's stub torn off, as the till's: the way's sticker — its glyph where the till has one — what to do under it, the server's sum (stage 2, orders task list, P1-2)", async ({
  page,
}) => {
  for (const [label, glyph, say] of [
    ["Готівка", true, null],
    ["Картка", true, "Проведіть на терміналі"],
    ["Переказ", true, "Перевірте, що переказ надійшов"],
    ["Переказ наперед", false, null],
    ["Накладений платіж", false, null],
  ] as const) {
    await open(page, { order: order({ status: "ARRIVED" }), sent: [] });
    const taking = await ways(page);
    await taking.getByRole("button", { name: label, exact: true }).click();
    const done = page.locator(".order-collected");
    await expect(
      done.getByRole("heading", { name: "Продаж записано" }),
    ).toBeFocused();
    await expect(done.locator(".recorded-mark")).toBeVisible();
    await expect(done.locator(".stub-recorded")).toBeVisible();
    await expectStub(done, { way: label, say, sum: "1 200,15 грн" });
    // Heard as seen: what to do after the sum and its way, as the till's
    // stub reads (review, 2026-11-06).
    const title = done.getByRole("heading", { name: "Продаж записано" });
    if (say)
      await expect(title).toHaveAccessibleDescription(
        new RegExp(` ${say}\\.$`),
      );
    else
      await expect(title).not.toHaveAccessibleDescription(
        /Проведіть|Перевірте/,
      );
    await expect(done.locator(".way-pill svg.icon")).toHaveCount(glyph ? 1 : 0);
    if (glyph) await expectGlyphBeside(done.locator(".way-pill"));
    await expect(
      page
        .locator(".result-screen > .result-dock")
        .getByRole("button", { name: "До замовлень", exact: true }),
    ).toBeVisible();
  }
});

test("«Клієнт забрав» on its way waits as the till's dock: the pressed way's ring, the four others stepped back, «Ще надсилаємо…» past 3 s; neither Telegram's «Назад», Escape nor the scrim closes the sheet; answered, the stub as before (audit after stage 2, orders-cash P0-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let answer = (): void => undefined;
  const server: Server = {
    order: order({ status: "ARRIVED" }),
    sent: [],
    hold: new Promise<void>((done) => {
      answer = done;
    }),
  };
  await open(page, server);
  const taking = await ways(page);
  // The five ways at the till's height.
  for (const way of await taking
    .locator(".collect-ways")
    .getByRole("button")
    .all())
    expect((await way.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
  const card = taking.getByRole("button", { name: "Картка", exact: true });
  await card.click();
  await expect.poll(() => server.sent.length).toBe(1);
  await expect(card).toHaveClass(/\bpressed\b/);
  await expect(card.locator(".eyelet-spin")).toBeVisible();
  for (const other of [
    "Готівка",
    "Переказ",
    "Переказ наперед",
    "Накладений платіж",
  ]) {
    const way = taking.getByRole("button", { name: other, exact: true });
    await expect(way).toHaveClass(/\bstepped-back\b/);
    await expect(way.locator(".eyelet-spin")).toHaveCount(0);
    // Stepped back, still read.
    expect(await contrast(way)).toBeGreaterThanOrEqual(4.5);
  }
  // The ring alone at first; past 3 s, the words over the ways.
  const line = taking.locator(".sending-line");
  await expect(line).toBeAttached();
  await expect(line).not.toContainText("Ще надсилаємо…");
  await expect(line).toHaveText("Ще надсилаємо…", { timeout: 6000 });
  // Inside the sheet, just over the ways, never moving them.
  const [said, sheetBox, waysBox] = await Promise.all([
    line.locator("span").boundingBox(),
    taking.boundingBox(),
    taking.locator(".collect-ways").boundingBox(),
  ]);
  if (!said || !sheetBox || !waysBox) throw new Error("not laid out");
  expect(said.y).toBeGreaterThanOrEqual(sheetBox.y);
  expect(said.y + said.height).toBeLessThanOrEqual(waysBox.y);
  expect(waysBox.y - (said.y + said.height)).toBeLessThanOrEqual(12);
  // No way out while it is on its way: Telegram's «Назад» hidden, and
  // pressed anyway, Escape and the scrim, the sheet stays.
  const backs = (): Promise<unknown[]> =>
    page.evaluate(() =>
      (window as unknown as { told: [string, unknown][] }).told
        .filter(([event]) => event === "web_app_setup_back_button")
        .map(([, data]) => data),
    );
  await expect
    .poll(async () => (await backs()).at(-1))
    .toEqual({ is_visible: false });
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await taking.focus();
  await page.keyboard.press("Escape");
  await page.mouse.click(180, 20);
  await wait(page, 300);
  await expect(taking).toBeVisible();
  expect(server.sent).toHaveLength(1);
  // Answered: the sale's stub, as before.
  answer();
  const done = page.locator(".order-collected");
  await expect(
    done.getByRole("heading", { name: "Продаж записано" }),
  ).toBeFocused();
  await expect(taking).toHaveCount(0);
  await expectStub(done, {
    way: "Картка",
    say: "Проведіть на терміналі",
    sum: "1 200,15 грн",
  });
  // The stub the card's white on the paper, never a slip of the paper's
  // colour (audit after stage 2, frame P0-1).
  const [slip, cardWhite] = await done.locator(".stub").evaluate((node) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    probe.style.color = "var(--card)";
    const white = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(node).backgroundColor, white];
  });
  expect(slip).toBe(cardWhite);
  expect(server.sent).toHaveLength(1);
});

test("«Клієнт забрав» in parts, on its way, in the dark theme: pressed with the ways scrolled half out of the sheet, they come back into view with «Ще надсилаємо…»'s room over them; the ways stepped back read 4.5:1 (audit after stage 2, orders-cash P0-1; review, 2026-11-09)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let answer = (): void => undefined;
  const server: Server = {
    order: order({ status: "ARRIVED", total: "3000.00" }),
    sent: [],
    hold: new Promise<void>((done) => {
      answer = done;
    }),
  };
  await open(page, server, { bg_color: "#17212b", text_color: "#f5f5f5" });
  const taking = await ways(page);
  await taking.getByLabel("Оплата частинами").check();
  await taking.getByLabel("Ім’я покупця").fill("Оксана");
  await taking.getByLabel("Телефон покупця").fill("0501234567");
  await taking.getByLabel("Сплачує зараз, грн").fill("500");
  const first = taking.getByRole("group", { name: "Зараз, у магазині" });
  const cash = first.getByRole("button", { name: "Готівка", exact: true });
  // As a hand leaves it after the terms: the first way at the sheet's top,
  // its caption and the line's room over it out of view.
  await cash.evaluate((button) => {
    const body = button.closest(".sheet-body");
    // Whole pixels, the way never clipped by a fraction over it.
    if (body)
      body.scrollTop += Math.floor(
        button.getBoundingClientRect().top - body.getBoundingClientRect().top,
      );
  });
  await expect(first.locator(".pay-caption")).not.toBeInViewport();
  await expect(cash).toBeInViewport({ ratio: 1 });
  await cash.click();
  await expect.poll(() => server.sent.length).toBe(1);
  await expect(cash).toHaveClass(/\bpressed\b/);
  const line = taking.locator(".sending-line");
  await expect(line).toHaveText("Ще надсилаємо…", { timeout: 6000 });
  await expect(line).toBeInViewport({ ratio: 1 });
  await expect(cash).toBeInViewport({ ratio: 1 });
  for (const other of [
    "Картка",
    "Переказ",
    "Переказ наперед",
    "Накладений платіж",
  ]) {
    const way = taking.getByRole("button", { name: other, exact: true });
    await expect(way).toHaveClass(/\bstepped-back\b/);
    expect(await contrast(way)).toBeGreaterThanOrEqual(4.5);
  }
  answer();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeFocused();
  expect(server.sent).toEqual([
    {
      step: "collect",
      body: {
        command_id: expect.any(String),
        payment_method: "CASH",
        credit: {
          customer_name: "Оксана",
          customer_phone: "0501234567",
          paid_now: "500.00",
        },
      },
    },
  ]);
});

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme «Клієнт забрав»'s stub reads at 4.5:1 — its sticker, what to do, the sum — nothing wider than the phone (stage 2, orders task list, P1-2)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page, { order: order({ status: "ARRIVED" }), sent: [] }, theme);
    const taking = await ways(page);
    await taking.getByRole("button", { name: "Картка", exact: true }).click();
    const done = page.locator(".order-collected");
    await expect(done.locator(".stub-recorded")).toBeVisible();
    for (const part of [
      done.getByRole("heading", { name: "Продаж записано" }),
      done.locator(".way-pill"),
      done.locator(".stub-say"),
      done.locator(".stub-sum .sum"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-collected-${name}.png` });
  });

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme where an order goes, its history and the same waybill's order read at 4.5:1, nothing wider than the phone (orders task list, P1-3)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const ready = order({
      status: "DISPATCHED",
      waybill: "20451234",
      same_waybill: [
        {
          id: randomUUID(),
          status: "DISPATCHED",
          created_at: ago(1),
          display_name: "Ріо графіт",
          size_label: "L",
          quantity: 1,
          lines: 1,
        },
      ],
    });
    await open(page, { order: ready, sent: [] }, theme);
    await page.getByRole("button", { name: "Історія доставки" }).click();
    for (const part of [
      page.locator(".same-waybill p"),
      page.locator(".same-waybill .sale-goods"),
      page.locator(".same-waybill .sale-meta"),
      page.locator(".same-waybill .sticker"),
      page.locator(".order-goes"),
      page.getByRole("button", { name: "Скопіювати ТТН" }),
      page.locator(".shipping-changes-title"),
      page.locator(".shipping-changes .timeline-day"),
      page.locator(".shipping-changes .timeline-what"),
      page.locator(".shipping-changes .timeline-meta"),
      page.locator(".shipping-how"),
      page.getByRole("button", { name: "Змінити доставку" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    // The same waybill's plate a warning's, its corner 4 (spec §6.23); its
    // row's chevron the set's 16 in pencil, never a «›» (orders and «Каса»
    // task list after stage 2, P2-4).
    const plate = page.locator(".same-waybill");
    await expect(plate).toHaveCSS("border-top-left-radius", "4px");
    const other = plate.locator(".sale-row");
    await expect(other).not.toContainText("›");
    expect(
      await other.evaluate((node) => {
        const chevron = node.querySelector(":scope > svg.sale-open");
        const probe = document.createElement("span");
        probe.style.color = "var(--pencil)";
        document.body.append(probe);
        const pencil = getComputedStyle(probe).color;
        probe.remove();
        return [
          node.getBoundingClientRect().height >= 64,
          chevron?.getBoundingClientRect().width,
          chevron ? getComputedStyle(chevron).color === pencil : false,
        ];
      }),
    ).toEqual([true, 16, true]);
    // Scrolled to the foot, the panel held over nothing.
    await page
      .getByRole("button", { name: "Товар повернувся на склад" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/order-history-${name}.png` });
    const changing = await shipping(page, "Змінити доставку");
    for (const part of [
      changing.getByRole("heading", { name: "Доставка", exact: true }),
      changing.locator(".send-parcel"),
      changing.getByRole("button", { name: "Нова пошта", exact: true }),
      changing.getByRole("button", { name: "Укрпошта", exact: true }),
      changing.getByRole("button", { name: "За кордон", exact: true }),
      changing.locator("label", { hasText: "Номер ТТН" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-shipping-${name}.png` });
  });

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme goods coming back read at 4.5:1, nothing wider than the phone (orders task list, P2-4)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await warehouses(page);
    // Outside Telegram, the dock's one button read too.
    await open(page, { order: cameBack(), sent: [] }, theme, null);
    await page
      .getByRole("button", { name: "Товар повернувся на склад" })
      .click();
    await page.getByLabel("Причина повернення").fill("Не забрали з пошти");
    // Ready to take: the press as it is pressed.
    await readTheAnswer(page);
    await page
      .getByLabel("Усі товари фізично отримані на складах відправлення")
      .check();
    for (const part of [
      page.getByRole("heading", { name: "Товар повернувся на склад" }),
      page.locator(".order-returned legend"),
      page.locator(".returned-places li").first(),
      page.locator(".order-returned label").first(),
      page.locator(".order-returned .check"),
      page.locator(".store-line p:visible"),
      panel(page).getByRole("button"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    // From its top, as it opens.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: `test-results/order-returned-${name}.png` });
  });
