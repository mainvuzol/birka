import { test, expect, openStore, sellsFrom, toTill } from "./fixtures";
import type { Page, Route } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * What is being read keeps its place (sale-slice TZ, P2-6): the till shows
 * the places of the field and the tags to come, and a screen reader still
 * hears «Завантажуємо…»; a search typed keeps the list where it was until
 * the new one comes, so the pay panel does not move under the finger. Each
 * read is held back here until the journey lets it go.
 */

interface Fixture {
  telegram_user_id: string;
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

/** A read answered only once `release()` is called; `fetch()` answers it
 * as the server does, unless `answer` says otherwise. */
async function heldBack(
  page: Page,
  pattern: string,
  answer?: (route: Route) => Promise<void>,
): Promise<{ release: () => void }> {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(pattern, async (route) => {
    await held;
    if (answer) await answer(route);
    else await route.fallback();
  });
  return { release };
}

const coats = {
  items: [
    {
      location_id: fixture.till_location_id,
      product_variant_id: fixture.variant_id,
      size_id: fixture.size_id,
      display_name: "Лоран шоколад",
      size_label: "M",
      size_is_unknown: false,
      quantity: 3,
      reserved_quantity: 0,
      available_quantity: 3,
      suggested_price: "1850.00",
    },
  ],
  has_more: false,
};

const said = (page: Page) => page.getByRole("status");

test("signing in keeps a first screen's places, and says «Входимо в магазин…»", async ({
  page,
}) => {
  const me = await heldBack(page, "**/api/v1/me");
  await page.goto(launch());
  await expect(said(page)).toHaveText("Входимо в магазин…");
  // Before the rights, which screen comes first is not known: a title, a
  // line, a field and three rows, no tag of the till's (spec S02; «Усе на
  // бірці» task list, P1-4).
  await expect(page.locator(".skeleton-field")).toBeVisible();
  await expect(page.locator(".placeholder .sale-row")).toHaveCount(3);
  await expect(page.locator(".placeholder .model-tag")).toHaveCount(0);
  me.release();
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await expect(page.locator(".placeholder")).toHaveCount(0);
});

test("the warehouses being read keep the field's and the tags' places, and say so", async ({
  page,
}) => {
  const places = await heldBack(page, "**/api/v1/stock-locations?**");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await expect(
    said(page).filter({ hasText: "Завантажуємо склади…" }),
  ).toBeAttached();
  await expect(page.locator(".placeholder .skeleton-field")).toBeVisible();
  await expect(page.locator(".placeholder .model-tag")).toHaveCount(3);
  places.release();
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toBeVisible();
  await expect(page.getByText("Завантажуємо склади…")).toHaveCount(0);
});

test("the goods being read keep three tags' places, and say «Завантажуємо товари…»", async ({
  page,
}) => {
  const goods = await heldBack(
    page,
    "**/api/v1/catalog/stock-options?**",
    async (route) => {
      await route.fulfill({ json: coats });
    },
  );
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await expect(
    said(page).filter({ hasText: "Завантажуємо товари…" }),
  ).toBeAttached();
  await expect(page.locator(".placeholder .model-tag")).toHaveCount(3);
  await expect(page.locator("button.size-cell")).toHaveCount(0);
  goods.release();
  await expect(page.locator("button.size-cell").first()).toBeVisible();
  await expect(page.locator(".placeholder")).toHaveCount(0);
});

test("a search typed keeps the list where it was until the new one comes, and the pay panel with it", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("query")) await held;
    await route.fulfill({ json: coats });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await page.locator("button.size-cell").first().click();
  await expect(page.locator(".pay-panel")).toBeVisible();
  // The terminal's hint stands under the list, the basket's lines in their
  // sheet («Усе на бірці» task list, P0-5): where it is on the page says
  // whether the list jumped, which the tray pinned to the screen's foot
  // would not (review, 2026-10-17).
  const under = page.getByText(/^Спершу натисніть, як платить покупець/);
  const onPage = () =>
    under.evaluate((node) => node.getBoundingClientRect().top + window.scrollY);

  const asked = page.waitForRequest((request) =>
    request.url().includes("query=%D0%BB%D0%BE%D1%80"),
  );
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("лор");
  await asked;
  // The new search not answered yet: the list as it was, and no places.
  // (The way to the catalogue comes under any search, and is under it now.)
  await expect(page.locator("button.size-cell").first()).toBeVisible();
  await expect(page.locator(".placeholder")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Знайти в каталозі" }),
  ).toBeVisible();
  const before = await onPage();
  const answered = page.waitForResponse((response) =>
    response.url().includes("query=%D0%BB%D0%BE%D1%80"),
  );
  release();
  await answered;
  await expect(page.locator("button.size-cell").first()).toBeVisible();
  expect(await onPage()).toBe(before);
});

test("a search with nothing found, typed further, never says «нічого немає» under the new words before they are searched", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("query");
    if (query === "абв") await held;
    await route.fulfill({
      json: query ? { items: [], has_more: false } : coats,
    });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  const search = page.getByRole("searchbox", { name: "Знайти модель" });
  await search.fill("аб");
  await expect(page.getByText(/^За «аб» .* нічого немає/)).toBeVisible();
  const asked = page.waitForRequest((request) =>
    request.url().includes("query=%D0%B0%D0%B1%D0%B2"),
  );
  await search.fill("абв");
  await asked;
  await expect(page.getByText(/нічого немає/)).toHaveCount(0);
  await expect(
    said(page).filter({ hasText: "Завантажуємо товари…" }),
  ).toBeAttached();
  release();
  await expect(page.getByText(/^За «абв» .* нічого немає/)).toBeVisible();
});

test("the catalogue's sizes being read keep four cells' places, 60 × 60 and the cell's corner, «Завантажуємо розміри…» said to a reader alone; come, the cells where they stood (audit after stage 2, sale P2-3)", async ({
  page,
}) => {
  await sellsFrom(page, fixture.till_location_id);
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({ json: coats });
  });
  await page.route(
    "**/api/v1/catalog/receivable-variants?**",
    async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              product_variant_id: fixture.variant_id,
              display_name: "Лоран беж",
            },
          ],
          has_more: false,
        },
      });
    },
  );
  await page.route("**/api/v1/catalog/prices?**", async (route) => {
    await route.fulfill({
      json: {
        product_variant_id: fixture.variant_id,
        currency_code: "UAH",
        shared_price: null,
        store_price: null,
        suggested_price: "2400.00",
        may_set_shared: false,
      },
    });
  });
  const sizes = await heldBack(
    page,
    "**/api/v1/catalog/sizes?**",
    async (route) => {
      await route.fulfill({
        json: [{ size_id: fixture.size_id, code: "M", system: "ALPHA" }],
      });
    },
  );
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("лор");
  await page.getByRole("button", { name: "Знайти в каталозі" }).click();
  const panel = page.getByRole("region", { name: "Товар з каталогу" });
  await panel.getByLabel("Пошук у каталозі").fill("лоран");
  await panel.getByRole("radio", { name: "Лоран беж" }).click();
  const grey = panel.locator(".placeholder.cells > .size-cell");
  await expect(grey).toHaveCount(4);
  const before = await grey.first().boundingBox();
  expect([before?.width ?? 0, before?.height ?? 0].map(Math.round)).toEqual([
    60, 60,
  ]);
  await expect(grey.first()).toHaveCSS("border-top-left-radius", "6px");
  // Said to a reader alone, never on the screen.
  await expect(
    said(page).filter({ hasText: "Завантажуємо розміри…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  sizes.release();
  const cell = panel
    .getByRole("group", { name: "Розмір: Лоран беж" })
    .getByRole("button", { name: "M", exact: true });
  await expect(cell).toBeVisible();
  await expect(grey).toHaveCount(0);
  await expect(page.getByText("Завантажуємо розміри…")).toHaveCount(0);
  const after = await cell.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(4);
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(1);
});
