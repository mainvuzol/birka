import { test, expect, openStore } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till in the new design, first part (redesign direction 2026-10-11;
 * sale-slice TZ, P0-1, P0-4, P0-5): the app opens on the till, the total and
 * the three ways are held under the thumb, and what warns stays readable in
 * Telegram's dark theme.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
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

/** Telegram's own dark theme, as its launch data carries it. */
const DARK = {
  bg_color: "#17212b",
  text_color: "#f5f5f5",
  hint_color: "#708499",
  button_color: "#5288c1",
  button_text_color: "#ffffff",
  secondary_bg_color: "#232e3c",
};
const LIGHT = { bg_color: "#ffffff", text_color: "#000000" };

function launch(theme?: Record<string, string>): string {
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
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  return `/#${hash.toString()}`;
}

interface MeStore {
  id: string;
  code: string;
  state: string;
  permissions: string[];
}

/** What /me says, changed for one journey: fewer stores or rights. */
async function stubMe(
  page: Page,
  change: (stores: MeStore[]) => MeStore[],
): Promise<void> {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { stores: MeStore[] };
    body.stores = change(body.stores);
    await route.fulfill({ response, json: body });
  });
}

/** One coat of the till's warehouse, as many on the shelf as said. */
async function stubStock(page: Page, available: number): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            display_name: "Лоран шоколад",
            size_label: "M",
            size_is_unknown: false,
            quantity: available,
            reserved_quantity: 0,
            available_quantity: available,
            suggested_price: "1850.00",
          },
        ],
        has_more: false,
      },
    });
  });
}

async function onTheTill(page: Page, theme?: Record<string, string>) {
  await page.goto(launch(theme));
  await openStore(page, "Основний MAIN");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

async function oneLine(page: Page, quantity = 1): Promise<void> {
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.till_location_id);
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${fixture.variant_id}:${fixture.size_id}`);
  await page.getByLabel("Кількість").fill(String(quantity));
  await page.getByRole("button", { name: "Додати в кошик" }).click();
}

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

// --- P0-1: the app opens on the till -------------------------------------------

test("one store opens straight on the till, with nothing to change to", async ({
  page,
}) => {
  await stubMe(page, (stores) => stores.filter((s) => s.code === "MAIN"));
  await page.goto(launch());
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Оберіть магазин" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toHaveCount(0);
});

test("two stores are chosen each time, nothing chosen beforehand, and the till comes first", async ({
  page,
}) => {
  await page.goto(launch());
  await expect(
    page.getByRole("heading", { name: "Оберіть магазин" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Оберіть магазин, у якому ви зараз: продажі запишуться на нього.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Продаж" })).toHaveCount(0);
  await openStore(page, "Основний MAIN");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toBeVisible();
});

test("whoever does not sell opens on the orders, as before", async ({
  page,
}) => {
  await stubMe(page, (stores) =>
    stores.map((s) => ({
      ...s,
      permissions: s.permissions.filter((p) => p !== "sale:create"),
    })),
  );
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(
    page.getByRole("heading", { name: "Замовлення магазину" }),
  ).toBeVisible();
});

test("a single store that does not trade shows its state, with nothing to change to", async ({
  page,
}) => {
  await stubMe(page, (stores) =>
    stores
      .filter((s) => s.code === "MAIN")
      .map((s) => ({ ...s, state: "BLOCKED", permissions: [] })),
  );
  await page.goto(launch());
  await expect(page.getByRole("button", { name: "Оновити" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toHaveCount(0);
});

// --- P0-4: under the thumb -------------------------------------------------------

test("the total and the three ways are in view on a small phone, below the basket", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stubStock(page, 3);
  await onTheTill(page);
  await oneLine(page);
  const panel = page.getByRole("group", {
    name: "Продати — як платить покупець",
  });
  await expect(panel.getByText("Разом 1850,00 грн")).toBeInViewport();
  for (const way of ["Готівка", "Картка", "Переказ"])
    await expect(
      panel.getByRole("button", { name: way, exact: true }),
    ).toBeInViewport();
  // The basket's last line is not under the panel.
  const line = page.locator(".line").last();
  await line.scrollIntoViewIfNeeded();
  const lineBox = await line.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(
    lineBox && panelBox && lineBox.y + lineBox.height <= panelBox.y + 1,
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: "test-results/till-panel-light.png" });
});

test("paid in parts, the panel says what is paid now and what is left", async ({
  page,
}) => {
  await stubStock(page, 3);
  await onTheTill(page);
  await oneLine(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  const panel = page.getByRole("group", {
    name: "Продати — як платить покупець",
  });
  await expect(
    panel.getByText("Зараз 1000,00 грн · винен 850,00 грн"),
  ).toBeVisible();
});

test("the server's shortage opens above the panel, in view and focused; a seller who may not write a shelf off is told what to do", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stubMe(page, (stores) =>
    stores.map((s) => ({
      ...s,
      permissions: s.permissions.filter(
        (p) => p !== "inventory:report_missing_during_sale",
      ),
    })),
  );
  await stubStock(page, 2);
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "INSUFFICIENT_STOCK",
        message: "Not enough stock for this operation",
        details: {
          location_id: fixture.till_location_id,
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          requested: 3,
          available: 2,
          correctable: true,
        },
      },
    });
  });
  await onTheTill(page);
  await oneLine(page, 3);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  const answer = page.getByRole("alert", { name: "Залишку не вистачає" });
  await expect(answer).toBeInViewport();
  await expect(answer).toBeFocused();
  await expect(
    answer.getByText(
      "Немає на полиці? Приберіть рядок і скажіть менеджеру — залишок виправить він.",
    ),
  ).toBeVisible();
  await expect(
    answer.getByRole("button", { name: "Прибрати з кошика" }),
  ).toBeVisible();
  await expect(page.locator(".line.short")).toHaveCount(1);
});

// --- P0-5: Telegram's dark theme -------------------------------------------------

for (const [name, theme, scheme] of [
  ["dark", DARK, "dark"],
  ["light", LIGHT, "light"],
] as const) {
  test(`in Telegram's ${name} theme every warning on the till reads at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await stubStock(page, 3);
    // The sale's answer is lost, and keeps being lost while the phone checks
    // it by itself: it is kept, and its banner shows. Then it is refused.
    let lost = true;
    await page.route("**/api/v1/sales", async (route) => {
      if (lost) {
        await route.abort("connectionfailed");
        return;
      }
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          details: { recorded: false },
        },
      });
    });
    await onTheTill(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);

    await page.getByLabel("Вношу продаж з паперу").check();
    const band = page.getByRole("region", { name: "Режим: продаж з паперу" });
    await expect(band).toBeVisible();
    expect(await contrast(band.locator("p"))).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrast(page.locator(".hint").first()),
    ).toBeGreaterThanOrEqual(4.5);
    await page.getByLabel("Вношу продаж з паперу").uncheck();

    await oneLine(page);
    await page.getByRole("button", { name: "Готівка", exact: true }).click();
    const kept = page.locator("section.notice", {
      hasText: "Незавершений продаж",
    });
    await expect(kept).toBeVisible();
    expect(await contrast(kept.locator("p").first())).toBeGreaterThanOrEqual(
      4.5,
    );
    await page.screenshot({
      path: `test-results/till-${name}.png`,
      fullPage: true,
    });

    lost = false;
    await page
      .getByRole("button", { name: "Перевірити результат продажу" })
      .click();
    const alert = page.getByRole("alert").first();
    await expect(alert).toBeVisible();
    expect(await contrast(alert)).toBeGreaterThanOrEqual(4.5);
  });
}
