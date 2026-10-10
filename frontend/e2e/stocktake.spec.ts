import { test, expect } from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A stocktake of a whole warehouse (owner decisions, 2026-10-10; ADR-0022),
 * against the real server. Each journey has a warehouse of its own: a
 * stocktake stays open until it is finished, and one is open per warehouse.
 */

interface Fixture {
  telegram_user_id: string;
  stocktake_location_id: string;
  recount_location_id: string;
  kept_count_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

interface CountBody {
  store_id: string;
  command_id: string;
  product_variant_id: string;
  size_id: string;
  counted_quantity: number;
  expected_quantity: number;
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

async function enter(page: Page, location: string): Promise<void> {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Залишки", exact: true }).click();
  await page.getByLabel("Склад для перегляду").selectOption(location);
}

/** Start one, or carry on with the one a retry left open. */
async function begin(page: Page): Promise<void> {
  const section = page.getByRole("region", { name: "Інвентаризація складу" });
  const carry = section.getByRole("button", {
    name: "Продовжити інвентаризацію",
  });
  const start = section.getByRole("button", {
    name: "Почати інвентаризацію складу",
  });
  await expect(carry.or(start)).toBeVisible();
  if (await carry.isVisible()) {
    await carry.click();
    return;
  }
  await start.click();
  await expect(section.getByText("Склад продає далі.")).toBeVisible();
  await section.getByRole("button", { name: "Почати інвентаризацію" }).click();
}

function line(page: Page, size = "M"): Locator {
  return page
    .getByRole("region", { name: "Інвентаризація", exact: true })
    .getByRole("article")
    .filter({ hasText: `Розмір: ${size}` })
    .first();
}

async function onRecord(page: Page, size = "M"): Promise<number> {
  const text = await line(page, size)
    .getByText(/^В обліку:/)
    .first()
    .textContent();
  return Number(/\d+/.exec(text ?? "")?.[0]);
}

function counts(page: Page): CountBody[] {
  const sent: CountBody[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && /\/counts$/.test(request.url()))
      sent.push(request.postDataJSON() as CountBody);
  });
  return sent;
}

test("a warehouse is counted position by position, each difference applied at once, and finished as one record", async ({
  page,
}) => {
  const sent = counts(page);
  await enter(page, fixture.stocktake_location_id);
  await begin(page);
  const counting = page.getByRole("region", {
    name: "Інвентаризація",
    exact: true,
  });
  await expect(
    counting.getByRole("heading", {
      name: "Інвентаризація: Склад інвентаризації",
    }),
  ).toBeVisible();
  const system = await onRecord(page);
  await line(page)
    .getByLabel("Фактично на складі, од.")
    .fill(String(system - 2));
  await expect(
    line(page).getByText(
      `Облік ${String(system)} → ${String(system - 2)} (−2)`,
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/stocktake-mobile.png",
    fullPage: true,
  });
  await line(page).getByRole("button", { name: "Записати кількість" }).click();
  await expect(counting.getByRole("status").first()).toContainText(
    "Пораховано позицій: 1 · не перевірено: 0 · нестача: 2 од. (позицій: 1)",
  );
  await expect(
    counting.getByText(`облік ${String(system)} → ${String(system - 2)} (−2).`),
  ).toBeVisible();
  await expect(
    counting.getByText("Усі позиції з залишком пораховано."),
  ).toBeVisible();

  // Goods the list does not show: counted against nothing.
  await counting
    .getByRole("button", { name: "Знайшли товар, якого немає в списку" })
    .click();
  await page.getByLabel("Пошук у каталозі").fill("лоран");
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "L" });
  await page.getByLabel("Фактично на складі, од.").fill("1");
  await page.getByRole("button", { name: "Записати кількість" }).click();
  await expect(counting.getByRole("status").first()).toContainText(
    "надлишок: 1 од. (позицій: 1)",
  );

  await counting
    .getByRole("radio", { name: "Пораховані", exact: true })
    .click();
  await expect(line(page)).toContainText(
    `Пораховано: ${String(system - 2)} — облік змінено на −2`,
  );
  await expect(line(page, "L")).toContainText(
    "Пораховано: 1 — облік змінено на +1",
  );

  // Each count travels with the balance it was counted against.
  expect(sent).toHaveLength(2);
  expect(sent[0]).toMatchObject({
    product_variant_id: fixture.variant_id,
    size_id: fixture.size_id,
    counted_quantity: system - 2,
    expected_quantity: system,
  });
  expect(sent[1]).toMatchObject({ counted_quantity: 1, expected_quantity: 0 });
  expect(Object.keys(sent[0]).sort()).toEqual([
    "command_id",
    "counted_quantity",
    "expected_quantity",
    "product_variant_id",
    "size_id",
    "store_id",
  ]);

  await counting
    .getByRole("button", { name: "Завершити інвентаризацію" })
    .click();
  await expect(
    counting.getByText(
      "Після завершення рахувати в цій інвентаризації вже не можна. Власнику надійде підсумок.",
    ),
  ).toBeVisible();
  await counting.getByRole("button", { name: "Так, завершити" }).click();
  const done = page.getByRole("region", { name: "Інвентаризацію завершено" });
  await expect(done.getByRole("status")).toHaveText(
    "Пораховано позицій: 2 · не перевірено: 0 · нестача: 2 од. (позицій: 1) · надлишок: 1 од. (позицій: 1).",
  );
  await done.getByRole("button", { name: "Повернутися до залишків" }).click();

  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Розмір: M" })
      .getByText(`На складі: ${String(system - 2)}`, { exact: true }),
  ).toBeVisible();
  const section = page.getByRole("region", { name: "Інвентаризація складу" });
  await section.getByText("Попередні інвентаризації").click();
  await section
    .getByRole("button", { name: "Показати розбіжності" })
    .first()
    .click();
  const differences = section.getByRole("list", { name: "Розбіжності" });
  await expect(differences.getByRole("listitem")).toHaveCount(2);
  await expect(differences).toContainText(" — −2 од. (пораховано");
  await expect(differences).toContainText(" — +1 од. (пораховано 1, Оля)");
});

test("a position sold while it was counted is refused and counted again, alone", async ({
  page,
}) => {
  // The list shows one more than the warehouse holds, as it would if a sale
  // had taken a coat after the list was read.
  let stale = true;
  await page.route("**/api/v1/stocktakes/*/positions?**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { size_label: string; quantity: number }[];
    };
    if (stale)
      for (const item of body.items)
        if (item.size_label === "M") item.quantity += 1;
    await route.fulfill({ response, json: body });
  });
  await enter(page, fixture.recount_location_id);
  await begin(page);
  const shown = await onRecord(page);
  stale = false;
  await line(page)
    .getByLabel("Фактично на складі, од.")
    .fill(String(shown - 1));
  await line(page).getByRole("button", { name: "Записати кількість" }).click();
  await expect(line(page).getByRole("alert")).toContainText(
    `облік змінився: було ${String(shown)}, тепер ${String(shown - 1)}`,
  );
  await expect(line(page).getByRole("alert")).toContainText(
    "Нічого не записано.",
  );
  await expect(
    line(page).getByText(`В обліку: ${String(shown - 1)}`),
  ).toBeVisible();
  await expect(line(page).getByLabel("Фактично на складі, од.")).toHaveValue(
    "",
  );
  await line(page)
    .getByLabel("Фактично на складі, од.")
    .fill(String(shown - 1));
  await expect(line(page).getByText("Збігається з обліком.")).toBeVisible();
  await line(page).getByRole("button", { name: "Записати кількість" }).click();
  await expect(
    page.getByText(`збігається з обліком (${String(shown - 1)})`),
  ).toBeVisible();
  await expect(page.getByText("Незавершений підрахунок")).toHaveCount(0);
});

test("a count whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  const keys: (string | null)[] = [];
  const commands: string[] = [];
  await page.route("**/api/v1/stocktakes/*/counts", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    commands.push((route.request().postDataJSON() as CountBody).command_id);
    if (keys.length === 1) {
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });
  await enter(page, fixture.kept_count_location_id);
  await begin(page);
  const system = await onRecord(page);
  await line(page)
    .getByLabel("Фактично на складі, од.")
    .fill(String(system - 1));
  await line(page).getByRole("button", { name: "Записати кількість" }).click();
  await expect(page.getByText("Незавершений підрахунок")).toBeVisible();
  // The till waits too, and so does a correction: nothing else happens
  // until this is settled.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат підрахунку" })
    .click();
  await expect(page.getByText("Підрахунок підтверджено")).toBeVisible();
  await expect(
    page.getByText(
      `Його було записано один раз: облік ${String(system)} → ${String(system - 1)}.`,
    ),
  ).toBeVisible();
  expect(keys[1]).toBe(keys[0]);
  expect(commands[1]).toBe(commands[0]);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
});

test("a stocktake is started only by whoever may correct stock; a seller sees it", async ({
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
  await enter(page, fixture.stocktake_location_id);
  const section = page.getByRole("region", { name: "Інвентаризація складу" });
  await expect(
    section.getByRole("heading", { name: "Інвентаризація складу" }),
  ).toBeVisible();
  await expect(page.getByText(/^На складі:/).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Почати інвентаризацію складу" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Продовжити інвентаризацію" }),
  ).toHaveCount(0);
});
