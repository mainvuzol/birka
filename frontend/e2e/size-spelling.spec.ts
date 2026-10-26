import { test, expect, openStore, section } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// One size, one spelling (owner decision, 2026-10-03; ADR-0009).

interface Fixture {
  telegram_user_id: string;
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
async function open(page: Page, name: string): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, name);
}

/** Creates a model from a description with the size as typed. */
async function createWithSize(
  page: Page,
  name: string,
  system: string,
  size: string,
): Promise<void> {
  await open(page, "Перевірка каталогу");
  await page.getByRole("button", { name: "+ Нова пропозиція" }).click();
  await page.getByLabel("Початковий опис товару").fill(`${name} опис`);
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  await page.getByRole("button", { name: "Створити товар з опису" }).click();
  await page.getByLabel("Назва моделі", { exact: true }).fill(name);
  await page.getByLabel("Система розмірів").selectOption(system);
  await page.getByLabel("Розмір", { exact: true }).fill(size);
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
  await expect(page.getByText(`Збережений товар: ${name}.`)).toBeVisible();
}

/** The sizes «Приймання» offers for a model. */
async function receivableSizes(page: Page, name: string): Promise<string[]> {
  await open(page, "Приймання");
  await page.getByLabel("Пошук у каталозі").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: new RegExp(name) }).click();
  return page
    .getByRole("combobox", { name: "Розмір" })
    .locator("option")
    .allTextContents();
}

test("a size typed «м» under another system is the shop's M, and says so", async ({
  page,
}) => {
  const name = `Модель ${randomUUID().slice(0, 8)}`;
  await createWithSize(page, name, "UNSPECIFIED", "м");
  // The seed's M is a letter size: the model takes it, in its own system.
  await expect(
    page.getByText(`Збережений товар: ${name}. Розміри: M (ALPHA)`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Набрано «м» — це розмір «M»." }),
  ).toBeVisible();

  const sizes = await receivableSizes(page, name);
  expect(sizes.filter((size) => size === "M")).toHaveLength(1);
  expect(sizes).not.toContain("м");
  // Letter sizes read first, in the order a seller reads them.
  expect(sizes.indexOf("M")).toBeLessThan(sizes.indexOf("L"));
});

test("«2хл» is written XXL, and XXL typed later is the same size", async ({
  page,
}) => {
  const first = `Модель ${randomUUID().slice(0, 8)}`;
  await createWithSize(page, first, "ALPHA", "2хл");
  await expect(
    page.getByText(`Збережений товар: ${first}. Розміри: XXL (ALPHA)`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Набрано «2хл» — це розмір «XXL»." }),
  ).toBeVisible();

  const second = `Модель ${randomUUID().slice(0, 8)}`;
  await createWithSize(page, second, "ALPHA", "XXL");
  await expect(
    page.getByText(`Збережений товар: ${second}. Розміри: XXL (ALPHA)`, {
      exact: true,
    }),
  ).toBeVisible();
  // Typed as it is written: nothing to explain.
  await expect(page.getByText(/Набрано «/)).toHaveCount(0);

  const sizes = await receivableSizes(page, second);
  expect(sizes.filter((size) => size === "XXL")).toHaveLength(1);
  expect(sizes).not.toContain("2хл");
  expect(sizes).not.toContain("2XL");
});

test("«46 – 48» is 46-48, and 46/48 stays another size", async ({ page }) => {
  const dash = `Модель ${randomUUID().slice(0, 8)}`;
  await createWithSize(page, dash, "NUMERIC_EU", "46 – 48");
  await expect(
    page.getByText(`Збережений товар: ${dash}. Розміри: 46-48 (NUMERIC_EU)`, {
      exact: true,
    }),
  ).toBeVisible();

  const slash = `Модель ${randomUUID().slice(0, 8)}`;
  await createWithSize(page, slash, "NUMERIC_EU", "46/48");
  await expect(
    page.getByText(`Збережений товар: ${slash}. Розміри: 46/48 (NUMERIC_EU)`, {
      exact: true,
    }),
  ).toBeVisible();

  const sizes = await receivableSizes(page, slash);
  expect(sizes.filter((size) => size === "46-48")).toHaveLength(1);
  expect(sizes.filter((size) => size === "46/48")).toHaveLength(1);
  expect(sizes).not.toContain("46 – 48");
});
