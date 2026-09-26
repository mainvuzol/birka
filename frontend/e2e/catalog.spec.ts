import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  variant_id: string;
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
    .map(([key, value]) => `${key}=${value}`)
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
  await page.getByRole("button", { name: "Каталог", exact: true }).click();
}
async function draft(page: Page, raw: string): Promise<void> {
  await page.getByRole("button", { name: "+ Нова пропозиція" }).click();
  await page.getByLabel("Початковий опис товару").fill(raw);
}
async function create(page: Page, raw: string): Promise<void> {
  await draft(page, raw);
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  await expect(
    page.getByRole("button", { name: "Підтвердити обраний товар" }),
  ).toBeVisible();
}

test("explicit catalog choice and opt-in alias feedback through real API", async ({
  page,
}) => {
  await enter(page);
  await create(page, `  Мій виріб для перевірки ${randomUUID().slice(0, 8)}\n`);
  const confirm = page.getByRole("button", {
    name: "Підтвердити обраний товар",
  });
  await expect(confirm).toBeDisabled();
  await page.getByRole("radio", { name: /Лоран шоколад 70 см/ }).check();
  let feedbackCount = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/alias-feedback")) feedbackCount += 1;
  });
  await confirm.click();
  await expect(page.getByLabel("Зберегти підтвердження назви")).toBeVisible();
  expect(feedbackCount).toBe(0);
  await page.getByLabel("Зберегти підтвердження назви").check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/alias-feedback") && r.status() === 200,
  );
  await page.getByRole("button", { name: "Підтвердити зв’язок назви" }).click();
  const body = (await (await response).json()) as {
    status: string;
    confirm_count: number;
  };
  expect(body.status).toBe("LEARNING");
  expect(body.confirm_count).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/catalog-confirmed-mobile.png",
    fullPage: true,
  });
});

test("reject proposal and retrieve its preserved reason from history", async ({
  page,
}) => {
  const raw = `Помилковий запис ${randomUUID().slice(0, 8)}`;
  await enter(page);
  await create(page, raw);
  await page.getByLabel("Причина відхилення").fill("Це інша модель");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/reject") && r.status() === 200,
  );
  await page
    .getByRole("button", { name: "Відхилити пропозицію", exact: true })
    .click();
  await response;
  await expect(
    page.getByText("Причина відхилення: Це інша модель", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Каталог", exact: true }).click();
  await page.getByLabel("Стан пропозицій").selectOption({ label: "Відхилені" });
  await page.getByRole("button", { name: new RegExp(raw) }).click();
  await expect(
    page.getByText("Причина відхилення: Це інша модель", { exact: true }),
  ).toBeVisible();
});

test("lost proposal response survives reopening with the same UUID", async ({
  page,
  context,
}) => {
  await enter(page);
  await draft(page, "Запис зі зниклою відповіддю");
  const ids: string[] = [];
  await context.route("**/api/v1/catalog/match-decisions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    ids.push(
      (route.request().postDataJSON() as { decision_id: string }).decision_id,
    );
    if (ids.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  await expect(
    page.getByRole("button", { name: "Повторити ту саму операцію" }),
  ).toBeEnabled();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(launch());
  await reopened.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(
    reopened.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  await reopened
    .getByRole("button", { name: "Повторити ту саму операцію" })
    .click();
  await expect(
    reopened.getByRole("button", { name: "Підтвердити обраний товар" }),
  ).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test("catalog change rejects stale confirmation through real API", async ({
  page,
}) => {
  let authorization = "";
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/me"))
      authorization = request.headers()["authorization"] ?? "";
  });
  await enter(page);
  await create(page, "Запис для перевірки актуальності");
  await page.getByRole("radio", { name: /Лоран шоколад 70 см/ }).check();
  const mutation = await page.request.post("/api/v1/catalog/products", {
    headers: { Authorization: authorization, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      concept: `Нова модель ${randomUUID()}`,
      variant: { color: "чорний" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(mutation.status()).toBe(201);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/confirm") && r.status() === 409,
  );
  await page.getByRole("button", { name: "Підтвердити обраний товар" }).click();
  await response;
  await expect(page.getByRole("alert")).toContainText(
    /зміни|застар|нову пропозицію/i,
  );
  await expect(page.getByLabel("Зберегти підтвердження назви")).toHaveCount(0);
});

test("catalog navigation requires catalog permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "catalog:confirm",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(
    page.getByRole("button", { name: "Каталог", exact: true }),
  ).toHaveCount(0);
});

test("lost alias-feedback response reuses the same evidence UUID after reopening", async ({
  page,
  context,
}) => {
  await enter(page);
  await create(page, `Назва для повтору доказу ${randomUUID().slice(0, 8)}`);
  await page.getByRole("radio", { name: /Лоран шоколад 70 см/ }).check();
  await page.getByRole("button", { name: "Підтвердити обраний товар" }).click();
  await page.getByLabel("Зберегти підтвердження назви").check();
  const ids: string[] = [];
  await context.route(
    "**/api/v1/catalog/match-decisions/*/alias-feedback",
    async (route) => {
      ids.push(
        (route.request().postDataJSON() as { feedback_id: string }).feedback_id,
      );
      if (ids.length === 1) {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Підтвердити зв’язок назви" }).click();
  await expect(
    page.getByRole("button", { name: "Повторити ту саму операцію" }),
  ).toBeEnabled();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(launch());
  await reopened.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(
    reopened.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  const response = reopened.waitForResponse(
    (r) => r.url().endsWith("/alias-feedback") && r.status() === 200,
  );
  await reopened
    .getByRole("button", { name: "Повторити ту саму операцію" })
    .click();
  const body = (await (await response).json()) as { confirm_count: number };
  expect(body.confirm_count).toBe(1);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test("copied decision from another store cannot be mutated by a scoped journal", async ({
  page,
}) => {
  await enter(page);
  await create(page, "Перевірка магазину перед дією");
  await page.getByRole("radio", { name: /Лоран шоколад 70 см/ }).check();
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/confirm")) posts += 1;
  });
  await page.route("**/api/v1/catalog/match-decisions/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as { store_id: string };
    body.store_id = randomUUID();
    await route.fulfill({ response, json: body });
  });
  await page.getByRole("button", { name: "Підтвердити обраний товар" }).click();
  await expect(page.getByRole("alert")).toContainText("Немає доступу");
  expect(posts).toBe(0);
});

test("uncertain catalog operation remains recoverable after access denial", async ({
  page,
  context,
}) => {
  await enter(page);
  await draft(page, "Перевірка втрати доступу");
  let requests = 0;
  let denied = false;
  await context.route("**/api/v1/catalog/match-decisions**", async (route) => {
    if (denied) {
      await route.fulfill({ status: 403, json: { code: "PERMISSION_DENIED" } });
      return;
    }
    if (route.request().method() === "POST") {
      requests += 1;
      if (requests === 1) {
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  const retry = page.getByRole("button", {
    name: "Повторити ту саму операцію",
  });
  await expect(retry).toBeEnabled();
  denied = true;
  await retry.click();
  await expect(page.getByRole("alert")).toContainText("Немає доступу");
  await expect(retry).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "+ Нова пропозиція" }),
  ).toBeDisabled();
  denied = false;
  await retry.click();
  await expect(
    page.getByRole("button", { name: "Підтвердити обраний товар" }),
  ).toBeVisible();
});
