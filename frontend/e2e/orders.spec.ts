import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
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
function launch(): string {
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
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}
async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
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
  await page
    .getByRole("button", { name: "Клієнт забрав", exact: true })
    .click();
  await expect(page.getByText("Продаж зафіксовано.")).toBeVisible();
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
  await enter(reopened);
  await reopened
    .getByRole("button", { name: "Повторити ту саму команду" })
    .click();
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

test("Telegram bridge signals readiness and applies launch theme without storing credentials", async ({
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
    background: document.documentElement.style.getPropertyValue(
      "--tg-theme-bg-color",
    ),
    storage: [...Object.keys(localStorage), ...Object.keys(sessionStorage)],
  }));
  expect(state.ready).toBe(true);
  expect(state.background).toBe("#eeeeee");
  expect(state.storage).toEqual([]);
});
