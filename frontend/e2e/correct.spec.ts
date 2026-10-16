import { test, expect, openStore, section, waitsFor } from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  count_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

interface AdjustmentBody {
  command_id: string;
  location_id: string;
  size_id: string;
  quantity_delta: number;
  reason_code: string;
  note: string | null;
  expected_quantity: number | null;
}

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

/** The stocktake warehouse, which no other spec sells from or receives into. */
async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Залишки");
  await page
    .getByLabel("Склад для перегляду")
    .selectOption(fixture.count_location_id);
}

function row(page: Page, size = "M"): Locator {
  return page
    .getByRole("article")
    .filter({ hasText: `Розмір: ${size}` })
    .first();
}

async function onHand(page: Page, size = "M"): Promise<number> {
  const text = await row(page, size)
    .getByText(/^На складі:/)
    .textContent();
  return Number(/\d+/.exec(text ?? "")?.[0]);
}

function adjustments(page: Page): AdjustmentBody[] {
  const sent: AdjustmentBody[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/inventory/adjustments")
    )
      sent.push(request.postDataJSON() as AdjustmentBody);
  });
  return sent;
}

test("a stocktake states what the shelf holds, and the ledger takes the difference", async ({
  page,
}) => {
  const sent = adjustments(page);
  await enter(page);
  const system = await onHand(page);
  await row(page).getByRole("button", { name: "Виправити залишок" }).click();
  await expect(page.getByText(`В обліку: ${String(system)}`)).toBeVisible();
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, од.").fill(String(system - 2));
  await expect(
    page.getByText(`Облік ${String(system)} → ${String(system - 2)} (−2)`),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/correct-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Записати коригування" }).click();

  await expect(page.getByRole("status")).toContainText(
    `Перерахунок, облік ${String(system)} → ${String(system - 2)}.`,
  );
  await expect(
    row(page).getByText(`На складі: ${String(system - 2)}`, { exact: true }),
  ).toBeVisible();
  // The count travels as a change *and* the balance it was worked out from.
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    location_id: fixture.count_location_id,
    size_id: fixture.size_id,
    quantity_delta: -2,
    reason_code: "STOCKTAKE",
    expected_quantity: system,
    note: null,
  });
});

test("damaged goods are written off by how many, whatever the balance", async ({
  page,
}) => {
  const sent = adjustments(page);
  await enter(page);
  const system = await onHand(page);
  await row(page).getByRole("button", { name: "Виправити залишок" }).click();
  await page.getByRole("radio", { name: "Пошкоджено" }).click();
  await page.getByLabel("Скільки списати, од.").fill("1");
  await page.getByLabel("Примітка").fill("Пляма на рукаві");
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(page.getByRole("status")).toContainText(
    `Пошкоджено, облік ${String(system)} → ${String(system - 1)}.`,
  );
  expect(sent[0]).toMatchObject({
    quantity_delta: -1,
    reason_code: "DAMAGED",
    expected_quantity: null,
    note: "Пляма на рукаві",
  });
});

test("a count made against a balance that has since moved is refused, and asks for a recount", async ({
  page,
}) => {
  // The screen shows one more than the warehouse holds, as it would if a sale
  // had taken a coat after the list was read.
  let stale = true;
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { size_label: string; quantity: number }[];
    };
    if (stale)
      for (const item of body.items)
        if (item.size_label === "M") item.quantity += 1;
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  const shown = await onHand(page);
  stale = false;
  await row(page).getByRole("button", { name: "Виправити залишок" }).click();
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, од.").fill(String(shown - 3));
  await page.getByRole("button", { name: "Записати коригування" }).click();

  await expect(page.getByRole("alert")).toContainText(
    `облік змінився: було ${String(shown)}, тепер ${String(shown - 1)}`,
  );
  await expect(page.getByRole("alert")).toContainText("Нічого не записано.");
  // The form now judges the count from what the server saw.
  await expect(page.getByText(`В обліку: ${String(shown - 1)}`)).toBeVisible();
  await expect(page.getByLabel("Фактично на складі, од.")).toHaveValue("");
  await expect(page.getByText("Незавершене коригування")).toHaveCount(0);
});

test("goods the system holds none of are found in the catalogue and counted from zero", async ({
  page,
}) => {
  const sent = adjustments(page);
  await enter(page);
  await expect(page.getByText("Розмір: L", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Знайшли товар, якого немає в списку" })
    .click();
  await page.getByLabel("Пошук у каталозі").fill("лоран");
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "L" });
  await expect(page.getByText("В обліку: 0")).toBeVisible();
  // Nothing to write off where nothing is held.
  await expect(page.getByRole("radio", { name: "Пошкоджено" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Втрачено" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, од.").fill("2");
  await page.getByRole("button", { name: "Записати коригування" }).click();

  await expect(page.getByRole("status")).toContainText(
    "L — Перерахунок, облік 0 → 2.",
  );
  await expect(
    row(page, "L").getByText("На складі: 2", { exact: true }),
  ).toBeVisible();
  expect(sent[0]).toMatchObject({ quantity_delta: 2, expected_quantity: 0 });
});

test("found goods that turn out to be held are counted against what is held", async ({
  page,
}) => {
  await enter(page);
  const held = await onHand(page);
  await page
    .getByRole("button", { name: "Знайшли товар, якого немає в списку" })
    .click();
  await page.getByLabel("Пошук у каталозі").fill("лоран");
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "M" });
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, од.").fill("1");
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(page.getByRole("alert")).toContainText(
    `уже є в обліку цього складу: ${String(held)} од.`,
  );
  await expect(page.getByText(`В обліку: ${String(held)}`)).toBeVisible();
  await expect(row(page).getByText(`На складі: ${String(held)}`)).toBeVisible();
});

test("a correction whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  const keys: (string | null)[] = [];
  const commands: string[] = [];
  await page.route("**/api/v1/inventory/adjustments", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    commands.push(
      (route.request().postDataJSON() as AdjustmentBody).command_id,
    );
    if (keys.length === 1) {
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });
  await enter(page);
  const system = await onHand(page);
  await row(page).getByRole("button", { name: "Виправити залишок" }).click();
  await page.getByRole("radio", { name: "Втрачено" }).click();
  await page.getByLabel("Скільки списати, од.").fill("1");
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(page.getByText("Незавершене коригування")).toBeVisible();
  await waitsFor(page, /коригування/);
  // The till waits too: nothing else happens until this is settled.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат коригування" })
    .click();
  await expect(page.getByText("Коригування підтверджено")).toBeVisible();
  await expect(
    page.getByText(
      `Його було записано один раз: облік ${String(system)} → ${String(system - 1)}.`,
    ),
  ).toBeVisible();
  await expect(page.getByText("Незавершене коригування")).toHaveCount(0);
  expect(keys[1]).toBe(keys[0]);
  expect(commands[1]).toBe(commands[0]);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
});

test("correcting stock needs inventory:adjust, which a seller does not hold", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "inventory:adjust",
      );
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  await expect(row(page).getByText(/^На складі:/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Виправити залишок" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Знайшли товар, якого немає в списку" }),
  ).toHaveCount(0);
});

test("a reserved balance offers no correction, and a size not known is only reduced", async ({
  page,
}) => {
  const sent = adjustments(page);
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            display_name: "Зарезервований",
            size_label: "M",
            size_is_unknown: false,
            quantity: 4,
            reserved_quantity: 1,
            available_quantity: 3,
          },
          {
            product_variant_id: fixture.variant_id,
            size_id: "00000000-0000-4000-8000-000000000000",
            display_name: "Без розміру",
            size_label: "UNKNOWN",
            size_is_unknown: true,
            quantity: 3,
            reserved_quantity: 0,
            available_quantity: 3,
          },
        ],
        has_more: false,
      },
    });
  });
  await enter(page);
  const reserved = page
    .getByRole("article")
    .filter({ hasText: "Зарезервований" });
  await expect(reserved.getByText(/Є резерв замовлення/)).toBeVisible();
  await expect(
    reserved.getByRole("button", { name: "Виправити залишок" }),
  ).toHaveCount(0);

  const unknown = page.getByRole("article").filter({ hasText: "Без розміру" });
  await unknown.getByRole("button", { name: "Виправити залишок" }).click();
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, од.").fill("5");
  await expect(
    page.getByText("Облік товару з невідомим розміром можна лише зменшити."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await page.getByRole("radio", { name: "Помилка обліку" }).click();
  await expect(
    page.getByRole("radio", { name: "Додати до обліку" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: "Списати з обліку" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(sent).toEqual([]);
});
