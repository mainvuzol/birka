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
}

async function stub(page: Page, server: Server): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/v1/orders",
    async (route) => {
      server.listReads = (server.listReads ?? 0) + 1;
      await route.fulfill({
        json: { orders: [server.order], has_more: false },
      });
    },
  );
  await page.route("**/api/v1/orders/*", async (route) => {
    server.reads = (server.reads ?? 0) + 1;
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
  // Where it goes changed: its own screen, its own press under the thumb
  // and its room kept, no second field for the waybill (review,
  // 2026-10-23; orders task list, P1-3) — and what was typed on the card
  // kept for it (review, 2026-10-25).
  await page.getByLabel("Номер ТТН (можна дописати пізніше)").fill("2045");
  await page.getByRole("button", { name: "Змінити доставку" }).click();
  await expect(panel(page).getByRole("button")).toHaveText("Зберегти доставку");
  await expect
    .poll(async () =>
      Math.abs(
        parseFloat(await room()) -
          ((await panel(page).boundingBox())?.height ?? 0),
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(
    page.getByLabel("Номер ТТН (можна дописати пізніше)"),
  ).toHaveCount(0);
  // Back: the card's press and its room, the row that opened it in focus.
  await page.getByRole("button", { name: "← Замовлення" }).click();
  await expect(
    panel(page).getByRole("button", { name: "Відправлено" }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.abs(parseFloat(await room()) - height))
    .toBeLessThanOrEqual(1);
  await expect(
    page.getByLabel("Номер ТТН (можна дописати пізніше)"),
  ).toHaveValue("2045");
  // The rare at the foot, the panel never over the last of them.
  await expect(
    page.getByRole("button", { name: "Змінити доставку" }),
  ).toBeFocused();
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
  // The owner's words for a conflict (2026-10-24, after #128; P1-2).
  await expect(why).toHaveText(
    "Не записано: дані замовлення змінилися, поки ви працювали. Перевірте замовлення й спробуйте ще раз.",
  );
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
  test(`«${pressed}» on an order another phone already made «${word}»: not recorded, said with what it is now, focused; the card and the list read again (orders task list, P1-2)`, async ({
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
    } else await panel(page).getByRole("button", { name: pressed }).click();
    const why = page.getByRole("alert");
    await expect(why).toHaveText(
      `Не записано: замовлення вже «${word}» — картку оновлено.`,
    );
    await expect(why).toBeFocused();
    expect(await buzzes(page)).toEqual([
      { type: "notification", notification_type: "error" },
    ]);
    // The card as it is now: its pill, and no longer the step pressed.
    await expect.poll(() => server.reads ?? 0).toBeGreaterThan(reads);
    await expect(page.locator(".order-status .badge")).toHaveText(word);
    await expect(
      page.getByRole("button", { name: pressed, exact: true }),
    ).toHaveCount(0);
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
  await page
    .getByRole("button", { name: "ТТН ще немає — вписати", exact: true })
    .click();
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
  await page.getByLabel("Номер ТТН", { exact: true }).fill("20451234");
  await readTheAnswer(page);
  await page.getByRole("button", { name: "Зберегти доставку" }).click();
  const why = page.getByRole("alert");
  await expect(why).toHaveText(
    "Не записано: замовлення вже закрито, доставку більше не змінюють.",
  );
  await expect(why).toBeFocused();
  await expect.poll(() => server.reads ?? 0).toBeGreaterThan(reads);
  await expect(page.locator(".order-status .badge")).toHaveText(
    "Клієнт забрав",
  );
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
  await page
    .getByRole("button", { name: "ТТН ще немає — вписати", exact: true })
    .click();
  await page.getByLabel("Номер ТТН", { exact: true }).fill("20451234");
  await readTheAnswer(page);
  await page.getByRole("button", { name: "Зберегти доставку" }).click();
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
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
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
    await page.getByLabel("Номер ТТН (можна дописати пізніше)").fill("НП");
    await panel(page).getByRole("button", { name: "Відправлено" }).click();
    const retry = page.getByRole("button", {
      name: "Перевірити результат замовлення",
    });
    await expect(retry).toBeEnabled();
    server.answer = { status: answer.status, json: { ...answer.json } };
    await retry.click();
    await expect(page.getByRole("alert")).toHaveText(said);
    await expect(retry).toHaveCount(0);
  });

test("a waybill of no digit or Latin letter: said as the field's own fault, the field kept (orders task list, P1-2)", async ({
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
  const field = page.getByLabel("Номер ТТН (можна дописати пізніше)");
  await field.fill("НП");
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
  const why = page.getByRole("alert");
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
  // The panel names it as its title does.
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M × 2 + ще 1 · Нова пошта",
  );
});

test("a step whose answer never came names its step and its order, and is never typed from paper; checked again and recorded, it says it was recorded once, with a buzz (orders task list, P0-2, P1-1)", async ({
  page,
}) => {
  const server: Server = { order: order(), sent: [], lose: true };
  await open(page, server);
  await page.getByLabel("Номер ТТН (можна дописати пізніше)").fill("20451234");
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
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
  // Kept: nothing is said to be recorded, nothing buzzes.
  expect(await buzzes(page)).toEqual([]);
  await expect(page.getByText(/^Відправлено ·/)).toHaveCount(0);
  await again.click();
  await expect(
    page.getByRole("status").filter({
      hasText: /^Операцію «Відправлено» записано один раз$/,
    }),
  ).toBeVisible();
  expect(await buzzes(page)).toEqual([
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
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
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
  await panel(page).getByRole("button", { name: "Відправлено" }).click();
  await expect.poll(() => server.sent.length).toBe(1);
  await expect(page.getByText(/сервер не відповів/)).toHaveCount(0);
  await expect(page.locator("section.notice h3")).toHaveCount(0);
  release();
  await expect(
    page.getByText("Відправлено. ТТН можна вписати пізніше.", { exact: true }),
  ).toBeVisible();
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
  await page
    .getByRole("button", { name: "Перевірити результат замовлення" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано один раз" }),
  ).toBeVisible();
  await expect(
    page.getByText("Операцію «Клієнт забрав» записано один раз"),
  ).toHaveCount(0);
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

/** «22.10, 14:05» of a moment, by this machine's clock, which the phone
 * shares. */
function stamp(iso: string): string {
  const at = new Date(iso);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(at.getDate())}.${two(at.getMonth() + 1)}, ${two(at.getHours())}:${two(at.getMinutes())}`;
}

test("where it went, a row a version: what it was, when by the phone's clock and by whom, how it went on the right (orders task list, P1-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const times = [
    "2026-01-05T08:07:00.000Z",
    "2026-02-14T19:41:00.000Z",
    "2026-11-30T23:59:00.000Z",
  ];
  await open(page, {
    order: order({
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
  const rows = page.getByRole("list", { name: "Історія доставки" });
  await expect(rows.getByRole("listitem")).toHaveCount(3);
  await expect(rows.locator(".shipping-kind")).toHaveText([
    "Вказано при створенні",
    "Вписано при відправленні",
    "Змінено",
  ]);
  await expect(rows.locator(".sale-meta")).toHaveText([
    `${stamp(times[0] ?? "")} · Оля`,
    `${stamp(times[1] ?? "")} · Петро`,
    `${stamp(times[2] ?? "")} · Оля`,
  ]);
  await expect(rows.locator(".shipping-how")).toHaveText([
    "Нова пошта · ТТН ще немає",
    "Нова пошта · ТТН 20451234567890",
    "За кордон · Варшава, Польща",
  ]);
  // How it went on the right of what it was, in one row.
  const kind = await rows.locator(".shipping-kind").nth(1).boundingBox();
  const how = await rows.locator(".shipping-how").nth(1).boundingBox();
  expect(kind && how && how.x >= kind.x + kind.width).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  // Abroad, sent: nothing to «вписати» — changed.
  await expect(
    page.getByRole("button", { name: "Змінити доставку", exact: true }),
  ).toBeVisible();
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
  await expect(rows.locator(".badge")).toHaveText([
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
  await page.evaluate(() => {
    window.scrollTo(0, 120);
  });
  await expect(back).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await back.click();
  await expect(page.locator(".order-number")).toHaveText(
    `№ ${first.slice(0, 8)}`,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("a save refused for its waybill keeps where it goes and what was typed; the card read again and failed says so over it (review, 2026-10-25)", async ({
  page,
}) => {
  const server: Server = { order: order({ status: "DISPATCHED" }), sent: [] };
  await open(page, server);
  await page
    .getByRole("button", { name: "ТТН ще немає — вписати", exact: true })
    .click();
  const field = page.getByLabel("Номер ТТН", { exact: true });
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
  await page.getByRole("button", { name: "Зберегти доставку" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /^Номер ТТН має містити цифри або латинські літери/ }),
  ).toBeVisible();
  await expect.poll(() => server.reads ?? 0).toBeGreaterThan(reads);
  // The read again failed: said, and what was typed is still there to check.
  const again = page.getByRole("button", { name: "Спробувати ще раз" });
  await expect(again).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Доставка", exact: true }),
  ).toBeVisible();
  await expect(field).toHaveValue("НП");
  await again.click();
  await expect(again).toHaveCount(0);
  await expect(field).toHaveValue("НП");
  expect(server.sent.map((each) => each.step)).toEqual(["shipping"]);
});

test("a tap carried from «Змінити доставку» onto «Зберегти доставку», or from «← Замовлення» onto «← До замовлень», is let go (review, 2026-10-25)", async ({
  page,
}) => {
  const server: Server = {
    order: order({ status: "DISPATCHED", waybill: "20451234" }),
    sent: [],
  };
  await open(page, server);
  await page.getByRole("button", { name: "Змінити доставку" }).click();
  await page.getByRole("button", { name: "Зберегти доставку" }).click();
  await readTheAnswer(page);
  expect(server.sent).toEqual([]);
  await page.getByRole("button", { name: "← Замовлення" }).click();
  await page.getByRole("button", { name: "← До замовлень" }).click();
  await readTheAnswer(page);
  await expect(
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
  ).toBeVisible();
  // Meant, it goes.
  await page.getByRole("button", { name: "← До замовлень" }).click();
  await expect(page.locator(".order-row").first()).toBeVisible();
});

test("a waybill written later on a stubbed parcel: five taps from «Ще» with the typing, the cursor in its field, back on the card with a buzz (orders task list, P1-3)", async ({
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
    .getByRole("button", { name: "ТТН ще немає — вписати", exact: true })
    .click();
  await expect(page.getByLabel("Номер ТТН", { exact: true })).toBeFocused();
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.keyboard.type("20451234");
  await readTheAnswer(page);
  await panel(page).getByRole("button", { name: "Зберегти доставку" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Доставку збережено$/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(5);
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
  await expect(page.locator(".order-context")).toHaveText(
    /^Нова пошта · ТТН 20451234 · з/,
  );
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

test("goods come back as their own step: each warehouse they go back to named, seven taps from «Ще» with the typing, the result a sentence a warehouse with a buzz (orders task list, P2-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server: Server = { order: cameBack(), sent: [] };
  await warehouses(page);
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
  await section(page, "Замовлення");
  await page.locator(".order-row").first().click();
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
  await expect(panel(page).locator(".pay-what")).toHaveText(
    "Лоран шоколад · M × 2 + ще 1",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.getByLabel("Причина повернення").click();
  await page.keyboard.type("Не забрали з пошти");
  await readTheAnswer(page);
  await page
    .getByLabel("Усі товари фізично отримані на складах відправлення")
    .check();
  await panel(page)
    .getByRole("button", { name: "Прийняти повернення" })
    .click();
  await expect(
    page.getByRole("status").filter({
      hasText:
        /^Повернено на склад «Свій»: 2 шт\. Повернено на склад «Сусідній»: 1 шт\.$/,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(7);
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
  await open(page, server);
  const row = page.getByRole("button", { name: "Товар повернувся на склад" });
  // Back without taking it: nothing sent, the row in focus.
  await row.click();
  await page.getByRole("button", { name: "← Замовлення" }).click();
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

test("a return refused as changed keeps its screen, the reason and the tick; one another phone already took back shows the card as it is now (review, 2026-10-25)", async ({
  page,
}) => {
  const server: Server = { order: cameBack(), sent: [] };
  await warehouses(page);
  await open(page, server);
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
  await take.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Товар повернувся на склад" }),
  ).toBeVisible();
  await expect(page.getByLabel("Причина повернення")).toHaveValue(
    "Не забрали з пошти",
  );
  await expect(
    page.getByLabel("Усі товари фізично отримані на складах відправлення"),
  ).toBeChecked();
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
  await expect(page.locator(".order-status .badge")).toHaveText(
    "Повернено на склад",
  );
  await expect(
    page.getByRole("heading", { name: "Товар повернувся на склад" }),
  ).toHaveCount(0);
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
  await panel(page)
    .getByRole("button", { name: "Прийняти повернення" })
    .click();
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
  expect(await buzzes(page)).toEqual([
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
  await open(page, { order: cameBack(), sent: [] });
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
    for (const part of [
      page.locator(".same-waybill p"),
      page.locator(".same-waybill .sale-goods"),
      page.locator(".same-waybill .sale-meta"),
      page.locator(".same-waybill .badge"),
      page.locator(".shipping-changes-title"),
      page.locator(".shipping-kind"),
      page.locator(".shipping-changes .sale-meta"),
      page.locator(".shipping-how"),
      page.getByRole("button", { name: "Змінити доставку" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    // Scrolled to the foot, the panel held over nothing.
    await page
      .getByRole("button", { name: "Товар повернувся на склад" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/order-history-${name}.png` });
    await page.getByRole("button", { name: "Змінити доставку" }).click();
    for (const part of [
      page.getByRole("heading", { name: "Доставка", exact: true }),
      page.locator(".way-switch label").first(),
      page.locator(".way-switch label").last(),
      page.getByRole("button", { name: "Нова пошта", exact: true }),
      page.getByRole("button", { name: "Укрпошта", exact: true }),
      page.locator(".order-shipping label", { hasText: "Номер ТТН" }),
      panel(page).locator(".pay-what"),
      panel(page).getByRole("button"),
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
    await open(page, { order: cameBack(), sent: [] }, theme);
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
      panel(page).locator(".pay-what"),
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
