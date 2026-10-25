import {
  test,
  expect,
  fillLine,
  more,
  openStore,
  section,
  tapSize,
  waitsFor,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
function initData(): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${fixture.telegram_user_id},"first_name":"Оля"}`,
  });
  const check = [...fields]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}
function launch(): string {
  return `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`;
}
function collects(page: Page): unknown[] {
  const bodies: unknown[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/collect"))
      bodies.push(request.postDataJSON());
  });
  return bodies;
}
async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  // The till opens first for whoever sells (redesign P0-1).
  await section(page, "Замовлення");
}

/** The app opened again: a kept order turns to «Замовлення» by itself. */
async function reopen(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
}
/** A new order of one coat as a seller makes it (orders task list, P0-5):
 * its model found by name, its size tapped from the fixture's warehouse,
 * its price typed over the store's, and its carrier a chip. */
async function draft(page: Page): Promise<void> {
  await section(page, "+ Нове замовлення");
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("Лоран");
  await tapSize(page, fixture.variant_id, fixture.size_id, fixture.location_id);
  await fillLine(page, { price: "1200,15" });
  await page
    .getByRole("group", { name: "Перевізник" })
    .getByRole("button", { name: "Нова пошта", exact: true })
    .click();
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
/** «Замовити та зарезервувати», what it did read before the next step
 * (orders task list, P0-5). */
async function reserve(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Зарезервовано: 1 шт\. Чекає відправлення\.$/ }),
  ).toBeVisible();
  await readTheAnswer(page);
}

test("reserve, dispatch, arrive, collect through real API", async ({
  page,
}) => {
  await enter(page);
  await draft(page);
  await reserve(page);
  await expect(page.locator(".order-context")).toBeVisible();
  await expect(
    page.getByText("До відправлення", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  await expect(
    page.getByText("Відправлено. ТТН можна вписати пізніше.", { exact: true }),
  ).toBeVisible();
  await readTheAnswer(page);
  await page
    .getByRole("button", { name: "Прибув на пошту", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Прибув на пошту$/ }),
  ).toBeVisible();
  await readTheAnswer(page);
  // How it was paid is said at «Клієнт забрав», and nothing is chosen for
  // the seller (owner decisions, 2026-10-04): each way is the step itself
  // (orders task list, P0-3; owner decision, 2026-10-23, В2 (а)).
  const sent = collects(page);
  const ways = page.getByRole("group", {
    name: "Клієнт забрав — як оплачено?",
  });
  await expect(
    ways.getByRole("group", { name: "Зараз, у магазині" }).getByRole("button"),
  ).toHaveText(["Готівка", "Картка", "Переказ"]);
  await expect(
    ways
      .getByRole("group", { name: "Наперед чи перевізнику" })
      .getByRole("button"),
  ).toHaveText(["Переказ наперед", "Накладений платіж"]);
  await expect(
    page.getByText("Продаж записуємо, коли покупець забрав товар.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(sent).toEqual([]);
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/api\/v1\/orders\/[0-9a-f-]+$/.test(new URL(response.url()).pathname),
  );
  await ways.getByRole("button", { name: "Готівка", exact: true }).click();
  const { sale_id: saleId } = (await (await answered).json()) as {
    sale_id: string;
  };
  // The sale, as the till says one: the way, the sum large.
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeFocused();
  await expect(page.locator(".order-collected .way-pill")).toHaveText(
    "Готівка",
  );
  await expect(page.locator(".order-collected .hand-back-sum")).toHaveText(
    "1 200,15 грн",
  );
  expect(sent).toEqual([
    { command_id: expect.any(String) as string, payment_method: "CASH" },
  ]);
  // A line's sum on its right; «за 1 шт.» only for more than one, as at
  // the till (orders task list, P0-2).
  await expect(page.locator(".order-line .history-sum")).toHaveText(
    "1 200,15 грн",
  );
  await expect(page.getByText(/за 1 шт\./)).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: "test-results/order-collected-mobile.png",
    fullPage: true,
  });
  // Its sale, as the receipt's: a mistake in goods or price returned, from
  // «Повернення» opened on that very sale — no search.
  const itsSale = page.waitForRequest((request) =>
    request.url().includes(`/cash/sales/${saleId}/method`),
  );
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await itsSale;
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "До списку", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/ · 1\s200,15 грн$/)).toBeVisible();
  // «Замовлення» pressed again: the store's list.
  await section(page, "Замовлення");
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-context")).toHaveCount(0);
});
test("lost committed response survives reopening and reuses the same command", async ({
  page,
  context,
}) => {
  await enter(page);
  await draft(page);
  const commands: string[] = [];
  await context.route("**/api/v1/orders", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { command_id: string };
    commands.push(body.command_id);
    if (commands.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  await expect(
    page.getByRole("button", { name: "Перевірити результат замовлення" }),
  ).toBeEnabled();
  // Which step and which order (orders task list, P1-1).
  await waitsFor(page, /Операцію «Резервування замовлення» ще не підтверджено/);
  await page.close();
  const reopened = await context.newPage();
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3), and its own tab opens (redesign P0-1).
  await reopen(reopened);
  await expect(reopened.locator(".order-context")).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  // Asked first (orders task list, P0-4).
  await reopened
    .getByRole("button", { name: "Скасувати замовлення", exact: true })
    .click();
  await reopened.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(reopened.getByText("Скасовано", { exact: true })).toBeVisible();
});
test("a kept order its check cannot settle opens on «Замовлення», not on the till", async ({
  page,
  context,
}) => {
  await enter(page);
  await draft(page);
  let answered = false;
  let lost = 0;
  const commands: string[] = [];
  await context.route("**/api/v1/orders", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { command_id: string };
    commands.push(body.command_id);
    if (answered) await route.continue();
    else {
      await route.fetch();
      await route.abort("failed");
      lost += 1;
    }
  });
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  await expect(
    page.getByRole("button", { name: "Перевірити результат замовлення" }),
  ).toBeEnabled();
  await page.close();
  // Reopened, the phone's own check loses its answer too: the kept order
  // still holds the app, and its own tab shows, not the till (redesign P0-1).
  const reopened = await context.newPage();
  await reopen(reopened);
  const retry = reopened.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  // Its own check on opening, and once more if another read answers after
  // that check was lost — the server is back (`useAutoCheck`): which comes
  // first is timing. The command is the same each time (below).
  await expect.poll(() => lost).toBeGreaterThanOrEqual(2);
  await expect(retry).toBeEnabled();
  await expect(reopened.getByRole("heading", { name: "Продаж" })).toHaveCount(
    0,
  );
  answered = true;
  await retry.click();
  await expect(reopened.locator(".order-context")).toBeVisible();
  expect(new Set(commands).size).toBe(1);
  // Asked first (orders task list, P0-4).
  await reopened
    .getByRole("button", { name: "Скасувати замовлення", exact: true })
    .click();
  await reopened.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(reopened.getByText("Скасовано", { exact: true })).toBeVisible();
});
test("goods come back as their own step: the warehouse named, physical confirmation required, the result naming it (orders task list, P2-4)", async ({
  page,
}) => {
  const returned: unknown[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/return"))
      returned.push(request.postDataJSON());
  });
  await enter(page);
  await draft(page);
  await reserve(page);
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  await expect(
    page.getByText("Відправлено. ТТН можна вписати пізніше.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Товар повернувся на склад" }).click();
  // Its own screen: what comes back where read first, the card's step gone.
  await expect(
    page.getByRole("heading", { name: "Товар повернувся на склад" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Прибув на пошту", exact: true }),
  ).toHaveCount(0);
  const where = page
    .getByRole("list", { name: "Куди повернеться товар" })
    .getByRole("listitem");
  await expect(where).toHaveText([/^Повернеться на склад «.+»: Лоран/]);
  const warehouse = /«(.+)»/.exec((await where.textContent()) ?? "")?.[1];
  const confirm = page.getByRole("button", {
    name: "Прийняти повернення",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await expect(
    page.getByLabel("Причина повернення"),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await page
    .getByLabel("Причина повернення")
    .fill("Клієнт не забрав, товар повернувся");
  await expect(confirm).toBeDisabled();
  // The tick says the goods are in hand: a tap within 0.7 s of the screen
  // opening is taken as carried from the row (review, 2026-10-25).
  await readTheAnswer(page);
  await page
    .getByLabel("Усі товари фізично отримані на складах відправлення")
    .check();
  await confirm.click();
  // Back on the card: how many went back to which warehouse.
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Повернено на склад «${warehouse ?? ""}»: 1 шт.` }),
  ).toBeVisible();
  await expect(page.locator(".order-status .badge")).toHaveText(
    "Повернено на склад",
  );
  expect(returned).toEqual([
    {
      command_id: expect.any(String) as string,
      reason: "Клієнт не забрав, товар повернувся",
      physically_received: true,
    },
  ]);
  await expect(
    page.getByRole("button", { name: "Товар повернувся на склад" }),
  ).toHaveCount(0);
});
test("browser without Telegram shows entry guidance", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  // The app's name as the owner writes it (2026-10-15, В4).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Бірка");
  await expect(page).toHaveTitle("Бірка");
  await expect(
    page.getByRole("button", { name: "+ Нове замовлення" }),
  ).toHaveCount(0);
});

test("uncertain command stays blocked after access denial, then reconciles", async ({
  page,
  context,
}) => {
  await enter(page);
  await draft(page);
  let attempts = 0;
  const commands: string[] = [];
  await context.route("**/api/v1/orders", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    commands.push(
      (route.request().postDataJSON() as { command_id: string }).command_id,
    );
    attempts += 1;
    if (attempts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else if (attempts === 2)
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: '{"code":"PERMISSION_DENIED"}',
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  const retry = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("alert")).toContainText("Немає доступу");
  await more(page);
  await expect(
    page.getByRole("button", { name: "+ Нове замовлення" }),
  ).toBeDisabled();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.locator(".order-context")).toBeVisible();
  expect(new Set(commands).size).toBe(1);
  expect(commands).toHaveLength(3);
});

test("first definitive rejection leaves draft editable", async ({
  page,
  context,
}) => {
  await enter(page);
  await draft(page);
  await context.route("**/api/v1/orders", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: '{"code":"IDEMPOTENCY_CONFLICT"}',
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  // The owner's words for a conflict (2026-10-24, after #128; orders task
  // list, P1-2), and what was typed kept.
  await expect(page.getByRole("alert")).toHaveText(
    "Не записано: дані замовлення змінилися, поки ви працювали. Перевірте замовлення й спробуйте ще раз.",
  );
  await expect(page.locator(".order-lines .line")).toHaveCount(1);
  await expect(page.getByLabel("Ціна, грн")).toHaveValue("1200,15");
  await expect(
    page
      .getByRole("group", { name: "Перевізник" })
      .getByRole("button", { name: "Нова пошта" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Замовити та зарезервувати" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Перевірити результат замовлення" }),
  ).toHaveCount(0);
});

test("Telegram bridge signals readiness and takes light or dark from the launch theme without storing credentials", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: { postEvent: (event: string) => void };
      hostEvents: string[];
    };
    host.hostEvents = [];
    host.TelegramWebviewProxy = {
      postEvent: (event) => {
        host.hostEvents.push(event);
      },
    };
  });
  await page.goto(
    `${launch()}&tgWebAppThemeParams=${encodeURIComponent(JSON.stringify({ bg_color: "#eeeeee" }))}`,
  );
  await expect(
    page.getByRole("heading", { name: "Оберіть магазин" }),
  ).toBeVisible();
  const state = await page.evaluate(() => ({
    ready: (window as unknown as { hostEvents: string[] }).hostEvents.includes(
      "web_app_ready",
    ),
    // The app paints its own palette and takes only light or dark from
    // Telegram (redesign P0-5).
    theme: document.documentElement.dataset.theme,
    storage: [...Object.keys(localStorage), ...Object.keys(sessionStorage)],
  }));
  expect(state.ready).toBe(true);
  expect(state.theme).toBe("light");
  expect(state.storage).toEqual([]);
});

/** Signed in as the seller, from another phone: the API's own headers. */
async function another(page: Page): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

test("a step another phone already made impossible: the server refuses it, the order says what it is now, the card read again (orders task list, P1-2)", async ({
  page,
}) => {
  await enter(page);
  await draft(page);
  const made = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/orders") &&
      response.request().method() === "POST",
  );
  await reserve(page);
  const { id } = (await (await made).json()) as { id: string };
  // Cancelled on another phone meanwhile.
  const cancelled = await page.request.post(`/api/v1/orders/${id}/cancel`, {
    headers: await another(page),
    data: { command_id: randomUUID() },
  });
  expect(cancelled.status()).toBe(200);
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  const why = page.getByRole("alert");
  await expect(why).toHaveText(
    "Не записано: замовлення вже «Скасовано» — картку оновлено.",
  );
  await expect(why).toBeFocused();
  await expect(page.locator(".order-status .badge")).toHaveText("Скасовано");
  await expect(
    page.getByRole("button", { name: "Відправлено", exact: true }),
  ).toHaveCount(0);
});

/** An order of one coat, sent and arrived — through the API. */
async function arrived(page: Page, waybill?: string): Promise<string> {
  const headers = await another(page);
  const created = await page.request.post("/api/v1/orders", {
    headers,
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      carrier: "NOVA_POSHTA",
      lines: [
        {
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          source_location_id: fixture.location_id,
          quantity: 1,
          unit_price: "900.00",
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  for (const action of ["dispatch", "arrive"]) {
    const moved = await page.request.post(`/api/v1/orders/${id}/${action}`, {
      headers,
      data: {
        command_id: randomUUID(),
        ...(action === "dispatch" && waybill ? { waybill } : {}),
      },
    });
    expect(moved.status()).toBe(200);
  }
  return id;
}

test("an order paid by cash on delivery is collected outside the till", async ({
  page,
}) => {
  // Found by its own waybill: a row names no id (owner decision,
  // 2026-10-23, В1).
  const waybill = `20${String(randomInt(100_000_000_000, 999_999_999_999))}`;
  await arrived(page, waybill);
  const sent = collects(page);
  await enter(page);
  await page.getByLabel("Номер ТТН").fill(waybill);
  await page
    .getByRole("list", { name: "Знайдені замовлення" })
    .getByRole("button")
    .click();
  await page
    .getByRole("group", { name: "Клієнт забрав — як оплачено?" })
    .getByRole("button", { name: "Накладений платіж", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.locator(".order-collected .way-pill")).toHaveText(
    "Накладений платіж",
  );
  expect(sent).toEqual([
    { command_id: expect.any(String) as string, payment_method: "CARRIER_COD" },
  ]);
});

test("a «Клієнт забрав» saved before the way was asked is refused when resent, and says so", async ({
  page,
}) => {
  // Sent by the previous version, its answer lost: no way in it. The server
  // refuses it as having recorded nothing (ADR-0012, B13), so it settles.
  const order = await arrived(page);
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const me = (await (
    await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    })
  ).json()) as { organization_id: string; user_id: string };
  const key = `birka:pending:${me.organization_id}:${me.user_id}:${fixture.store_id}`;
  await page.goto("/");
  await page.evaluate(
    ([name, value]) => {
      localStorage.setItem(name, value);
    },
    [
      key,
      JSON.stringify({
        path: `/orders/${order}/collect`,
        body: { command_id: randomUUID() },
        label: "Клієнт забрав",
        orderId: order,
        ambiguous: true,
      }),
    ] as const,
  );
  await page.goto("about:blank");
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3).
  const refused = page.waitForResponse(
    (r) => r.url().endsWith("/collect") && r.request().method() === "POST",
  );
  await enter(page);
  const resend = page.getByRole("button", {
    name: "Перевірити результат замовлення",
  });
  const answer = await refused;
  expect(answer.status()).toBe(422);
  expect(
    ((await answer.json()) as { details: Record<string, unknown> }).details,
  ).toMatchObject({ reason: "PAYMENT_METHOD_REQUIRED", recorded: false });
  await expect(page.getByRole("alert")).toHaveText(
    "Замовлення не позначено як забране — вкажіть, як оплачено, і натисніть «Клієнт забрав» ще раз.",
  );
  await expect(resend).toHaveCount(0);
  await more(page);
  await expect(
    page.getByRole("button", { name: "+ Нове замовлення" }),
  ).toBeEnabled();
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(
    null,
  );
});
