import { test, expect, openStore } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
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
  await page.getByRole("button", { name: "Замовлення", exact: true }).click();
}

/** The app opened again: a kept order turns to «Замовлення» by itself. */
async function reopen(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
}
async function draft(page: Page): Promise<void> {
  await page.getByRole("button", { name: "+ Нове замовлення" }).click();
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.location_id);
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${fixture.variant_id}:${fixture.size_id}`);
  await page.getByLabel("Домовлена ціна за одиницю, грн").fill("1200,15");
  await page.getByRole("button", { name: "Додати товар", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Перевізник", exact: true })
    .selectOption("NOVA_POSHTA");
}
test("reserve, dispatch, arrive, collect through real API", async ({
  page,
}) => {
  await enter(page);
  await draft(page);
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  await expect(
    page.getByRole("heading", { name: /Замовлення №/ }),
  ).toBeVisible();
  await expect(
    page.getByText("До відправлення", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  await page
    .getByRole("button", { name: "Прибув на пошту", exact: true })
    .click();
  // How it was paid is said at «Клієнт забрав», and nothing is chosen for
  // the seller (owner decisions, 2026-10-04).
  const sent = collects(page);
  const ways = page.getByRole("group", { name: "Як оплачено замовлення" });
  await expect(ways.getByRole("radio")).toHaveCount(5);
  for (const name of [
    "Переказом наперед",
    "Накладеним платежем",
    "Готівкою — зараз, на касі",
    "Карткою — зараз, на терміналі",
    "Переказом — зараз",
  ])
    await expect(
      ways.getByRole("radio", { name, exact: true }),
    ).not.toBeChecked();
  await expect(
    page.getByText(
      "Продаж фіксуємо, коли клієнт забрав товар. У касу йде лише готівка, яку дали зараз; накладений платіж звіримо з перевізником окремо.",
    ),
  ).toBeVisible();
  const collect = page.getByRole("button", {
    name: "Клієнт забрав",
    exact: true,
  });
  await collect.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Вкажіть, як оплачено замовлення.",
  );
  expect(sent).toEqual([]);
  await ways
    .getByRole("radio", { name: "Готівкою — зараз, на касі", exact: true })
    .check();
  await collect.click();
  await expect(page.getByText("Продаж зафіксовано.")).toBeVisible();
  await expect(page.getByText("Оплачено готівкою.")).toBeVisible();
  expect(sent).toEqual([
    { command_id: expect.any(String) as string, payment_method: "CASH" },
  ]);
  await expect(page.getByText("1200,15 грн", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: "test-results/order-collected-mobile.png",
    fullPage: true,
  });
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
    page.getByRole("button", { name: "Повторити ту саму команду" }),
  ).toBeEnabled();
  await page.close();
  const reopened = await context.newPage();
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3), and its own tab opens (redesign P0-1).
  await reopen(reopened);
  await expect(
    reopened.getByRole("heading", { name: /Замовлення №/ }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toBe(commands[0]);
  await reopened
    .getByRole("button", { name: "Скасувати та звільнити резерв" })
    .click();
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
    page.getByRole("button", { name: "Повторити ту саму команду" }),
  ).toBeEnabled();
  await page.close();
  // Reopened, the phone's own check loses its answer too: the kept order
  // still holds the app, and its own tab shows, not the till (redesign P0-1).
  const reopened = await context.newPage();
  await reopen(reopened);
  const retry = reopened.getByRole("button", {
    name: "Повторити ту саму команду",
  });
  await expect.poll(() => lost).toBe(2);
  await expect(retry).toBeEnabled();
  await expect(reopened.getByRole("heading", { name: "Продаж" })).toHaveCount(
    0,
  );
  answered = true;
  await retry.click();
  await expect(
    reopened.getByRole("heading", { name: /Замовлення №/ }),
  ).toBeVisible();
  expect(new Set(commands).size).toBe(1);
  await reopened
    .getByRole("button", { name: "Скасувати та звільнити резерв" })
    .click();
  await expect(reopened.getByText("Скасовано", { exact: true })).toBeVisible();
});
test("return requires physical confirmation", async ({ page }) => {
  await enter(page);
  await draft(page);
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  await page.getByRole("button", { name: "Товар повернувся на склад" }).click();
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
  await page
    .getByLabel("Усі товари фізично отримані на складах відправлення")
    .check();
  await confirm.click();
  await expect(
    page.getByText("Повернено на склад", { exact: true }),
  ).toBeVisible();
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
  const retry = page.getByRole("button", { name: "Повторити ту саму команду" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.getByRole("alert")).toContainText("Немає доступу");
  await expect(
    page.getByRole("button", { name: "+ Нове замовлення" }),
  ).toBeDisabled();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(
    page.getByRole("heading", { name: /Замовлення №/ }),
  ).toBeVisible();
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
  await expect(page.getByRole("alert")).toContainText("конфліктує");
  await expect(
    page.getByRole("button", { name: "Замовити та зарезервувати" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Повторити ту саму команду" }),
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

/** An order of one coat, sent and arrived — through the API. */
async function arrived(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
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
      data: { command_id: randomUUID() },
    });
    expect(moved.status()).toBe(200);
  }
  return id;
}

test("an order paid by cash on delivery is collected outside the till", async ({
  page,
}) => {
  const order = await arrived(page);
  const sent = collects(page);
  await enter(page);
  await page
    .getByRole("button", { name: new RegExp(`№ ${order.slice(0, 8)}`) })
    .click();
  await page
    .getByRole("group", { name: "Як оплачено замовлення" })
    .getByRole("radio", { name: "Накладеним платежем", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Клієнт забрав", exact: true })
    .click();
  await expect(page.getByText("Продаж зафіксовано.")).toBeVisible();
  await expect(page.getByText("Оплачено накладеним платежем.")).toBeVisible();
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
    name: "Повторити ту саму команду",
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
  await expect(
    page.getByRole("button", { name: "+ Нове замовлення" }),
  ).toBeEnabled();
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(
    null,
  );
});
