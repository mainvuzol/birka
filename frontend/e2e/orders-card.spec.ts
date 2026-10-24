import { test, expect, openStore, section } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * One order (orders task list, P0-2): what it is and where it goes on top,
 * its lines with their sums and «Разом» large; the next step one button in
 * the panel under the thumb, a buzz and what it did after it; the rare at
 * the foot. The orders are stubbed.
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
}

async function stub(page: Page, server: Server): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/v1/orders",
    async (route) => {
      await route.fulfill({
        json: { orders: [server.order], has_more: false },
      });
    },
  );
  await page.route("**/api/v1/orders/*", async (route) => {
    server.reads = (server.reads ?? 0) + 1;
    await route.fulfill({ json: server.order });
  });
  for (const step of ["dispatch", "arrive", "collect"])
    await page.route(`**/api/v1/orders/*/${step}`, async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      server.sent.push({ step, body });
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

async function buzzes(page: Page): Promise<object[]> {
  const sent = await page.evaluate(
    () => (window as unknown as { buzzes: string[] }).buzzes,
  );
  return sent.map((data) => JSON.parse(data) as object);
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
  await section(page, "Замовлення");
  // A closed one under «Показати завершені».
  if (
    !["READY_TO_DISPATCH", "DISPATCHED", "ARRIVED"].includes(
      server.order.status,
    )
  )
    await page.getByRole("button", { name: "Показати завершені" }).click();
  await page.locator(".order-row").first().click();
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

function panel(page: Page): Locator {
  return page.locator(".order-panel");
}

test("an order to send fits the phone: its goods as its title, how it goes, its sum, the waybill's field and «Відправлено» under the thumb (orders task list, P0-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const ready = order();
  await open(page, { order: ready, sent: [] });
  await expect(
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-context")).toHaveText(
    `Нова пошта · ТТН ще немає · з\u00a0${short(ready.created_at as string)}`,
  );
  // Its number small, beside its status (В1).
  await expect(page.locator(".order-number")).toHaveText(
    `№ ${ready.id.slice(0, 8)}`,
  );
  await expect(
    page.getByText("До відправлення", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-line .history-sum")).toHaveText(
    "1 200,15 грн",
  );
  // One explanation, and never the money's words before «Клієнт забрав».
  await expect(
    page.getByText("Товар у резерві — на касі його не продадуть."),
  ).toBeVisible();
  await expect(page.getByText(/Продаж записуємо/)).toHaveCount(0);
  for (const gone of ["Оновити", "← До списку"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M · Нова пошта",
  );
  // All of it at once, without a scroll.
  for (const part of [
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
    page.locator(".order-context"),
    page.locator(".order-status .badge"),
    page.locator(".order-line"),
    page.locator(".order-total"),
    page.getByLabel("Номер ТТН (можна дописати пізніше)"),
    panel(page).getByRole("button", { name: "Відправлено" }),
  ])
    await expect(part).toBeInViewport({ ratio: 1 });
  // The waybill's field over the panel, never under it.
  const field = await page
    .getByLabel("Номер ТТН (можна дописати пізніше)")
    .boundingBox();
  const bar = await panel(page).boundingBox();
  expect(field && bar && field.y + field.height <= bar.y).toBe(true);
  // The panel's height kept clear wherever the page scrolls to — a field
  // the keyboard brings up (`shared/panel.ts`) — and none while it is gone.
  const room = (): Promise<string> =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--pay-panel-h"),
    );
  const height = (await panel(page).boundingBox())?.height ?? 0;
  expect(Math.abs(parseFloat(await room()) - height)).toBeLessThanOrEqual(1);
  // Where it goes changed: that form alone, no panel and no second field
  // for the waybill (review, 2026-10-23).
  await page.getByRole("button", { name: "Змінити доставку" }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(await room()).toBe("");
  await expect(
    page.getByLabel("Номер ТТН (можна дописати пізніше)"),
  ).toHaveCount(0);
  await page
    .getByRole("group", { name: "Доставка" })
    .getByRole("button", { name: "Скасувати" })
    .click();
  await expect(panel(page)).toBeVisible();
  // The rare at the foot, the panel never over the last of them.
  await expect(
    page.getByRole("button", { name: "Змінити доставку" }),
  ).toBeVisible();
  const cancel = page.getByRole("button", {
    name: "Скасувати замовлення",
    exact: true,
  });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  const under = await cancel.boundingBox();
  const over = await panel(page).boundingBox();
  expect(under && over && under.y + under.height <= over.y).toBe(true);
  // Asked, «Ні, залишити» focused, over the panel.
  await cancel.click();
  const keep = page.getByRole("button", { name: "Ні, залишити" });
  await expect(keep).toBeFocused();
  const kept = await keep.boundingBox();
  const below = await panel(page).boundingBox();
  expect(kept && below && kept.y + kept.height <= below.y + 1).toBe(true);
});

test("sent with its waybill, then arrived: what is sent is as before, each a buzz and what it did; arrived, no panel and «Клієнт забрав» as before (orders task list, P0-2)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [] };
  await open(page, server);
  await page
    .getByLabel("Номер ТТН (можна дописати пізніше)")
    .fill(" 0500012345678 ");
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
  await expect(
    page.getByText("Відправлено · ТТН 0500012345678", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Відправлено", { exact: true })).toBeVisible();
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  // Sent, nothing held in reserve any more.
  await expect(page.getByText(/^Товар у резерві/)).toHaveCount(0);
  await expect(panel(page).getByRole("button")).toHaveText("Прибув на пошту");
  await readTheAnswer(page);
  await panel(page).getByRole("button", { name: "Прибув на пошту" }).click();
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
  // Arrived: «Клієнт забрав» by its ways, its money's words on its step.
  await expect(
    page.getByRole("group", { name: "Клієнт забрав — як оплачено?" }),
  ).toBeVisible();
  await expect(page.getByText(/^Продаж записуємо/)).toBeVisible();
});

test("sent without a waybill says it may come later; refused, a buzz of its own and why brought to the finger (orders task list, P0-2)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [], refuse: true };
  await open(page, server);
  const read = server.reads ?? 0;
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
  const why = page.getByRole("alert");
  await expect(why).toBeFocused();
  // The order read again, as it is now.
  await expect.poll(() => server.reads ?? 0).toBeGreaterThan(read);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await expect(
    page.getByText("До відправлення", { exact: true }),
  ).toBeVisible();
  server.refuse = false;
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
  await expect(
    page.getByText("Відправлено. ТТН можна вписати пізніше.", { exact: true }),
  ).toBeVisible();
  expect(server.sent.map((each) => each.body)).toEqual([
    { command_id: expect.any(String) },
    { command_id: expect.any(String) },
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
  // The panel names it as its title does.
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M × 2 + ще 1 · Нова пошта",
  );
});

test("a step whose answer never came is kept, with no buzz; checked again and recorded, a buzz and what it did (orders task list, P0-2)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [], lose: true };
  await open(page, server);
  await page.getByLabel("Номер ТТН (можна дописати пізніше)").fill("20451234");
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
  const again = page.getByRole("button", { name: "Повторити ту саму команду" });
  await expect(again).toBeEnabled();
  // Kept: nothing is said to be recorded, nothing buzzes.
  expect(await buzzes(page)).toEqual([]);
  await expect(page.getByText(/^Відправлено ·/)).toHaveCount(0);
  await again.click();
  await expect(
    page.getByText("Відправлено · ТТН 20451234", { exact: true }),
  ).toBeVisible();
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  // The same command, resent.
  expect(server.sent).toHaveLength(2);
  expect(server.sent[1]).toEqual(server.sent[0]);
});

test("a closed order, and an order seen by whoever may not step it, have no panel (orders task list, P0-2)", async ({
  page,
}) => {
  await open(page, {
    order: order({ status: "COLLECTED", payment_method: "CARD" }),
    sent: [],
  });
  await expect(page.getByText("Клієнт забрав", { exact: true })).toBeVisible();
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
  await expect(
    page.getByText("До відправлення", { exact: true }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel(/Номер ТТН/)).toHaveCount(0);
});

test("«Клієнт забрав»: five ways in two rows, each the step itself, nothing chosen first; card, and the sale said large with what to do, the server's sum, a buzz; later a line (orders task list, P0-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = {
    order: order({ status: "ARRIVED", waybill: "20450012345678" }),
    sent: [],
    collectedTotal: "1100.00",
  };
  await open(page, server);
  const ways = page.getByRole("group", {
    name: "Клієнт забрав — як оплачено?",
  });
  await expect(ways.locator(".pay-what")).toHaveText(
    "Лоран шоколад · M · Нова пошта",
  );
  await expect(ways.locator(".pay-total")).toHaveText("Разом 1 200,15 грн");
  const now = ways.getByRole("group", { name: "Зараз, у магазині" });
  const ahead = ways.getByRole("group", { name: "Наперед чи перевізнику" });
  await expect(now.getByRole("button")).toHaveText([
    "Готівка",
    "Картка",
    "Переказ",
  ]);
  await expect(ahead.getByRole("button")).toHaveText([
    "Переказ наперед",
    "Накладений платіж",
  ]);
  // Two rows, each under the thumb's size, all on the screen.
  const rows = [
    await now.getByRole("button").first().boundingBox(),
    await ahead.getByRole("button").first().boundingBox(),
  ];
  expect(rows[0] && rows[1] && rows[1].y > rows[0].y).toBe(true);
  for (const way of await ways.getByRole("button").all()) {
    expect((await way.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(way).toBeInViewport({ ratio: 1 });
  }
  // One line above them, never the drawer's words.
  await expect(
    page.getByText("Продаж записуємо, коли покупець забрав товар.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(server.sent).toEqual([]);
  await now.getByRole("button", { name: "Картка", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Продаж записано" });
  await expect(heading).toBeFocused();
  await expect(page.locator(".order-collected .way-pill")).toHaveText(
    "Картка · Проведіть на терміналі",
  );
  // The server's sum, not what the phone showed.
  await expect(page.locator(".order-collected .hand-back-sum")).toHaveText(
    "1 100,00 грн",
  );
  await expect(heading).toHaveAccessibleDescription("1 100,00 грн карткою.");
  expect(server.sent).toEqual([
    {
      step: "collect",
      body: { command_id: expect.any(String), payment_method: "CARD" },
    },
  ]);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  await expect(panel(page)).toHaveCount(0);
  await page.screenshot({ path: "test-results/order-collected-card.png" });
  // «До замовлень», and the order seen again: a line.
  await page.getByRole("button", { name: "До замовлень", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Показати завершені" }).click();
  await page.locator(".order-row").first().click();
  await expect(page.getByText("Продаж записано · Картка")).toBeVisible();
  await expect(page.locator(".order-collected")).toHaveCount(0);
});

test("«Клієнт забрав» is four taps from «Ще» (orders task list, P0-3)", async ({
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
  await section(page, "Замовлення");
  await page.locator(".order-row").first().click();
  await page
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

/** Clicks `name` in the panel the moment it is drawn, as a double tap's
 * second half would land: within milliseconds of the step's answer. */
async function tapAsDrawn(page: Page, name: string): Promise<void> {
  await page.evaluate((wanted) => {
    const watch = new MutationObserver(() => {
      const button = [
        ...document.querySelectorAll<HTMLButtonElement>(".order-panel button"),
      ].find((each) => each.textContent.trim() === wanted);
      if (!button) return;
      watch.disconnect();
      button.click();
    });
    watch.observe(document.body, { childList: true, subtree: true });
  }, name);
}

test("a tap meant for the step just taken, landing on the next step's button drawn in its place, is let go (review, 2026-10-24)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [] };
  await open(page, server);
  // «Відправлено», and «Прибув на пошту» at once in its place.
  await tapAsDrawn(page, "Прибув на пошту");
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
  await expect(panel(page).getByRole("button")).toHaveText("Прибув на пошту");
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 300);
      }),
  );
  expect(server.sent.map((each) => each.step)).toEqual(["dispatch"]);
  // Pressed a moment later, as meant: taken.
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 700);
      }),
  );
  await tapAsDrawn(page, "Накладений платіж");
  await panel(page).getByRole("button", { name: "Прибув на пошту" }).click();
  await expect(
    page.getByRole("group", { name: "Наперед чи перевізнику" }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 300);
      }),
  );
  // Never a sale by a tap meant for «Прибув на пошту».
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
  await page
    .getByRole("group", { name: "Зараз, у магазині" })
    .getByRole("button", { name: "Картка", exact: true })
    .click();
  await page.getByRole("button", { name: "Повторити ту саму команду" }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано один раз" }),
  ).toBeVisible();
  // The way alone, never «Проведіть»: it may have been charged meanwhile.
  await expect(page.locator(".order-collected .way-pill")).toHaveText("Картка");
  await expect(
    page.getByText(
      "Якщо картку ще не провели — проведіть на терміналі 1 200,15 грн. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.",
    ),
  ).toBeVisible();
  expect(server.sent).toHaveLength(2);
  expect(server.sent[1]).toEqual(server.sent[0]);
});

test("«Клієнт забрав» in parts: terms not taken said over the panel, nothing sent; the part paid now large, alone, and what is owed (orders task list, P0-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = {
    order: order({ status: "ARRIVED", total: "3000.00" }),
    sent: [],
  };
  await open(page, server);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill("Оксана");
  await page.getByLabel("Телефон покупця").fill("0501234567");
  await page.getByLabel("Сплачує зараз, грн").fill("3000");
  const cash = page
    .getByRole("group", { name: "Зараз, у магазині" })
    .getByRole("button", { name: "Готівка", exact: true });
  await cash.click();
  // Why, at the finger, over the panel — never under it.
  const why = page.getByRole("alert");
  await expect(why).toContainText("Покупець сплачує все одразу");
  await expect(why).toBeFocused();
  const box = await why.boundingBox();
  const bar = await panel(page).boundingBox();
  expect(box && bar && box.y + box.height <= bar.y + 1).toBe(true);
  expect(server.sent).toEqual([]);
  await page.getByLabel("Сплачує зараз, грн").fill("500");
  await expect(panel(page).locator(".pay-total")).toHaveText(
    /^Зараз 500,00 грн · винен 2\s500,00 грн$/,
  );
  await cash.click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeFocused();
  // The part paid now large, the order's whole not over it.
  await expect(page.locator(".order-collected .hand-back-sum")).toHaveText(
    "500,00 грн",
  );
  await expect(page.locator(".order-total")).toHaveCount(0);
  await expect(page.locator(".order-collected .paid-owed")).toHaveText(
    /^Покупець винен 2\s500,00 грн\. Наступні внески — у «Боргах»\.$/,
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
  test(`in the ${name} theme the order reads at 4.5:1, nothing wider than the phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page, { order: order(), sent: [] }, theme);
    for (const part of [
      page.locator(".order-title"),
      page.locator(".order-context"),
      page.locator(".order-line .cash-row-title"),
      page.locator(".order-line .history-sum"),
      page.locator(".order-total"),
      panel(page).locator(".pay-what"),
      panel(page).getByRole("button"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-card-${name}.png` });
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
    const ways = page.getByRole("group", {
      name: "Клієнт забрав — як оплачено?",
    });
    for (const part of [
      ways.locator(".pay-what"),
      ways.locator(".pay-total"),
      ways.locator(".pay-caption").first(),
      ways.locator(".pay-caption").last(),
      ways.getByRole("button", { name: "Готівка", exact: true }),
      ways.getByRole("button", { name: "Накладений платіж", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/order-collect-${name}.png` });
  });
