import { test, expect, more, openStore, section } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  till_location_id: string;
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
    .map(([key, value]) => `${key}=${value}`)
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

async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Приймання");
}

async function find(page: Page, query: string): Promise<void> {
  await page.getByLabel("Пошук у каталозі").fill(query);
  await page.getByRole("button", { name: "Знайти" }).click();
}

async function addLine(
  page: Page,
  product: RegExp,
  size: string,
  quantity: number,
): Promise<void> {
  await page.getByRole("radio", { name: product }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: size });
  await page.getByLabel("Кількість").fill(String(quantity));
  await page.getByRole("button", { name: "Додати до поставки" }).click();
}

test("a delivery of a known model is received into an explicitly chosen warehouse", async ({
  page,
}) => {
  await enter(page);
  // Two warehouses can receive, so nothing is chosen for the seller.
  await expect(
    page.getByRole("combobox", { name: "Склад", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  await find(page, "лоран шоколад");
  await addLine(page, /Лоран шоколад/, "M", 5);
  await expect(page.getByText("Разом 5 од.")).toBeVisible();
  await page
    .getByLabel("Примітка (накладна, постачальник)")
    .fill("Накладна 17");
  const posted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/inventory/receipts") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const sent = response.request().postDataJSON() as {
    command_id: string;
    location_id: string;
    notes: string;
  };
  // The delivery's permanent identity travels with it (ADR-0006).
  expect(sent.command_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(sent.location_id).toBe(fixture.till_location_id);
  expect(sent.notes).toBe("Накладна 17");
  expect(await response.request().headerValue("Idempotency-Key")).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  const receipt = (await response.json()) as {
    lines: { quantity_received: number; quantity_after: number }[];
  };
  await expect(
    page.getByRole("heading", { name: "Товар прийнято" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `+5 · тепер на складі ${String(receipt.lines[0]?.quantity_after)}`,
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/receive-mobile.png",
    fullPage: true,
  });
});

test("a delivery carries what the shop paid, and shows back what was stored", async ({
  page,
}) => {
  // The owner's answer of 2026-09-30: a seller may enter and see the cost.
  await enter(page);
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "M" });
  await page.getByLabel("Кількість").fill("5");

  // Money is typed as a person writes it, and refused when it is not money.
  await page.getByLabel("Закупівельна ціна за од., грн").fill("12,345");
  await page.getByRole("button", { name: "Додати до поставки" }).click();
  await expect(page.getByText(/до копійок, наприклад 1850,50/)).toBeVisible();
  await page.getByLabel("Закупівельна ціна за од., грн").fill("1850,50");
  await page.getByRole("button", { name: "Додати до поставки" }).click();
  await expect(
    page.getByText("5 од. · Закупівля · 1 850,50 грн за од."),
  ).toBeVisible();

  // A second line with no price: counted in units, left out of the value.
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "M" });
  await page.getByLabel("Кількість").fill("2");
  await page.getByLabel("Закупівельна ціна за од., грн").fill("");
  await page.getByRole("button", { name: "Додати до поставки" }).click();
  await expect(page.getByText("Разом 7 од.")).toBeVisible();
  await expect(
    page.getByText("Закупівельна вартість 9 252,50 грн"),
  ).toBeVisible();
  await expect(page.getByText(/Рядків без ціни: 1/)).toBeVisible();

  const posted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/inventory/receipts") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const sent = response.request().postDataJSON() as {
    lines: { quantity: number; unit_cost: string | null }[];
  };
  expect(sent.lines.map((line) => [line.quantity, line.unit_cost])).toEqual([
    [5, "1850.50"],
    [2, null],
  ]);
  // What is shown back is what the server stored, not what was typed.
  await expect(
    page.getByRole("heading", { name: "Товар прийнято" }),
  ).toBeVisible();
  await expect(
    page.getByText(/\+5 · тепер на складі \d+ · 1\s850,50 грн за од\./),
  ).toBeVisible();
  await expect(
    page.getByText("Закупівельна вартість 9 252,50 грн"),
  ).toBeVisible();
});

test("a brand-new model nobody holds any of can be received", async ({
  page,
}) => {
  // The property this screen exists for: the till's stock search could never
  // offer a model with no balance, and a delivery is usually exactly that.
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const model = `Прийом ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: model,
      variant: { color: "смарагд" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);

  await enter(page);
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  await find(page, model);
  await expect(page.getByRole("radio")).toHaveCount(1);
  await addLine(page, new RegExp(model), "M", 3);
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  await expect(
    page.getByRole("heading", { name: "Товар прийнято" }),
  ).toBeVisible();
  await expect(page.getByText("+3 · тепер на складі 3")).toBeVisible();
});

test("a definite refusal keeps the list and says nothing was received", async ({
  page,
}) => {
  await page.route("**/api/v1/inventory/receipts", async (route) => {
    await route.fulfill({
      status: 403,
      json: { code: "LOCATION_ACCESS_DENIED", message: "No" },
    });
  });
  await enter(page);
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  await find(page, "лоран");
  await addLine(page, /Лоран шоколад/, "M", 2);
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  await expect(page.getByText(/нічого не прийнято/)).toBeVisible();
  await expect(page.getByText("2 од. · Закупівля")).toBeVisible();
  await expect(page.getByText("Незавершене приймання")).toHaveCount(0);
});

test("a delivery whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  const keys: (string | null)[] = [];
  const commands: string[] = [];
  await page.route("**/api/v1/inventory/receipts", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    commands.push(
      (route.request().postDataJSON() as { command_id: string }).command_id,
    );
    if (keys.length === 1) {
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });
  await enter(page);
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  await find(page, "лоран");
  await addLine(page, /Лоран шоколад/, "M", 1);
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  await expect(page.getByText("Незавершене приймання")).toBeVisible();
  // The till, too, waits: nothing else happens until this is settled.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат приймання" })
    .click();
  await expect(page.getByText("Незавершене приймання")).toHaveCount(0);
  expect(keys[1]).toBe(keys[0]);
  expect(commands[1]).toBe(commands[0]);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
});

test("receiving needs its own permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "inventory:receive",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await more(page);
  await expect(
    page.getByRole("button", { name: "Приймання", exact: true }),
  ).toHaveCount(0);
});
