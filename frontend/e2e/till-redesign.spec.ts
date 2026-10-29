import {
  more,
  test,
  expect,
  fillLine,
  fromPaper,
  openStore,
  tapSize,
  tillWays,
  sellsFrom,
} from "./fixtures";
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
  await sellsFrom(page, fixture.till_location_id);
  await page.goto(launch(theme));
  await openStore(page, "Основний MAIN");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

async function oneLine(page: Page, quantity = 1): Promise<void> {
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await fillLine(page, { quantity });
}

test("under «Продати | Повернути», the till's search and its first tag's name are still in view on a phone of 360 × 640, with no scroll, and its sizes begin there — no warehouse is chosen above the search (navigation task list, P0-1; «Усе на бірці» task list, P0-5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stubStock(page, 3);
  await onTheTill(page);
  await expect(tillWays(page)).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toBeInViewport({ ratio: 1 });
  const tag = page.getByRole("group", { name: "Лоран шоколад" });
  await expect(tag.locator(".model-head")).toBeInViewport({ ratio: 1 });
  // Its sizes begin in view (to be seen on a phone, navigation task list
  // С1).
  await expect(tag.getByRole("button").first()).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

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
  // Nothing to change to, in «Ще» either (navigation task list, P0-4).
  await more(page);
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
    page.getByText("Продажі запишуться на той магазин, у якому ви зараз."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Продаж" })).toHaveCount(0);
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  // «Змінити магазин» is one tap, on the store's line, and a row of «Ще» ›
  // «Цей телефон» («Усе на бірці» task list, P0-4).
  const change = page
    .locator(".store-line")
    .getByRole("button", { name: "Змінити магазин" });
  await expect(change).toBeVisible();
  await more(page);
  await expect(
    page
      .getByRole("navigation", { name: "Ще" })
      .getByRole("button", { name: "Змінити магазин", exact: true }),
  ).toBeVisible();
  await change.click();
  await expect(
    page.getByRole("heading", { name: "Оберіть магазин" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  // Opened again, nothing is remembered: the choice again (owner, В6).
  await page.goto("about:blank");
  await page.goto(launch());
  await expect(
    page.getByRole("heading", { name: "Оберіть магазин" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Продаж" })).toHaveCount(0);
});

test("«Ще» only when it holds something: nothing under it and one store, no «Ще»; two stores, «Ще» holds «Цей телефон» › «Змінити магазин» alone (navigation task list, P0-4; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  // The orders and the drawer alone: nothing of «Ще»'s — whoever sells has
  // «Вношу продаж з паперу» there.
  const tabsOnly = ["sale:view", "cash:close"];
  let stores = 1;
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      organization_permissions: string[];
      stores: MeStore[];
    };
    body.organization_permissions = [];
    body.stores = body.stores
      .sort((a, b) => Number(b.code === "MAIN") - Number(a.code === "MAIN"))
      .slice(0, stores)
      .map((s) => ({
        ...s,
        permissions: s.permissions.filter((p) => tabsOnly.includes(p)),
      }));
    await route.fulfill({ response, json: body });
  });
  const row = page
    .getByRole("navigation", { name: "Розділи" })
    .getByRole("button");
  await page.goto(launch());
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await expect(row).toHaveText(["Замовлення", "Каса"]);
  // Two stores: «Ще», for «Змінити магазин» alone, under «Цей телефон».
  stores = 2;
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(row).toHaveText(["Замовлення", "Каса", "Ще"]);
  await more(page);
  await expect(page.locator(".more-group h3")).toHaveText(["Цей телефон"]);
  await expect(
    page.getByRole("navigation", { name: "Ще" }).getByRole("button"),
  ).toHaveText([/^Змінити магазин/]);
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
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  // Nothing to make an order with (orders task list, P0-1).
  await expect(
    page.getByRole("button", { name: "Нове замовлення" }),
  ).toHaveCount(0);
});

test("a store that cannot be worked in, among two, keeps «Змінити магазин» in its header: it has no «Ще» (navigation task list, P0-4)", async ({
  page,
}) => {
  await stubMe(page, (stores) =>
    stores.map((s) =>
      s.code === "MAIN" ? { ...s, state: "BLOCKED", permissions: [] } : s,
    ),
  );
  await page.goto(launch());
  await page.getByRole("button", { name: /^Основний MAIN/ }).click();
  await expect(page.getByRole("button", { name: "Оновити" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Розділи" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Змінити магазин" }).click();
  await expect(
    page.getByRole("heading", { name: "Оберіть магазин" }),
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
  // An empty basket shows no panel (direction §5).
  await expect(
    page.getByRole("group", { name: "Продати — як платить покупець" }),
  ).toHaveCount(0);
  await oneLine(page);
  const panel = page.getByRole("group", {
    name: "Продати — як платить покупець",
  });
  await expect(panel.getByText("Лоран шоколад · M")).toBeInViewport();
  await expect(panel.getByText("Разом 1 850,00 грн")).toBeInViewport();
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
    panel.getByText("Зараз 1 000,00 грн · винен 850,00 грн"),
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
      "Немає на полиці? Приберіть рядок і попросіть менеджера виправити залишок.",
    ),
  ).toBeVisible();
  // All of it above the panel, never under it (review, 2026-10-15).
  const remove = answer.getByRole("button", { name: "Прибрати з кошика" });
  await expect(remove).toBeVisible();
  const removeBox = await remove.boundingBox();
  const panelTop = (
    await page
      .getByRole("group", { name: "Продати — як платить покупець" })
      .boundingBox()
  )?.y;
  expect(
    removeBox !== null &&
      panelTop !== undefined &&
      removeBox.y + removeBox.height <= panelTop + 1,
  ).toBe(true);
  await expect(page.locator(".line.short")).toHaveCount(1);
});

test("an unreadable kept invoice holds the till, as it holds the other tabs", async ({
  page,
}) => {
  let invoiceKey = "";
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      organization_id: string;
      user_id: string;
      stores: MeStore[];
    };
    body.stores = body.stores.map((s) => ({
      ...s,
      permissions: [...new Set([...s.permissions, "supplier:debt"])],
    }));
    invoiceKey = `birka:supplier-invoice-pending:${body.organization_id}:${body.user_id}:${fixture.store_id}`;
    await route.fulfill({ response, json: body });
  });
  await stubStock(page, 3);
  await onTheTill(page);
  // The phone keeps an invoice operation it cannot read; the app is opened
  // again and still opens on the till.
  await page.evaluate((key) => {
    localStorage.setItem(key, "{not an invoice");
  }, invoiceKey);
  await page.goto("about:blank");
  await onTheTill(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "збережену операцію з накладною" }),
  ).toBeVisible();
  // Nothing can be put in the basket, so nothing can be sold.
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Вношу продаж з паперу")).toBeDisabled();
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

    await fromPaper(page);
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
      hasText: "Продаж ще не підтверджено",
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

test("in Telegram's dark theme the shortage answer and a paper sale's mark read at 4.5:1", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await stubStock(page, 2);
  let answer: "short" | "sold" = "short";
  await page.route("**/api/v1/sales", async (route) => {
    const body = route.request().postDataJSON() as { payment_method: string };
    if (answer === "short") {
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
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: "11111111-1111-4111-8111-111111111111",
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "1850.00",
        discount_total: "0.00",
        total: "1850.00",
        items: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            source_location_id: fixture.till_location_id,
            quantity: 1,
            unit_price: "1850.00",
            discount_amount: "0.00",
            final_unit_price: "1850.00",
            line_total: "1850.00",
            display_name: "Лоран шоколад",
          },
        ],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
        payment_method: body.payment_method,
        outage: { sold_by_user_id: null, sold_by: null, sold_at: null },
      },
    });
  });
  await onTheTill(page, DARK);
  await oneLine(page, 3);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  const short = page.getByRole("alert", { name: "Залишку не вистачає" });
  await expect(short).toBeVisible();
  expect(await contrast(short.locator("p").first())).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(
    await contrast(short.getByRole("button", { name: "Прибрати з кошика" })),
  ).toBeGreaterThanOrEqual(4.5);

  await short.getByRole("button", { name: "Прибрати з кошика" }).click();
  answer = "sold";
  await fromPaper(page);
  await oneLine(page);
  await page
    .getByRole("button", { name: "З паперу · Готівка", exact: true })
    .click();
  const mark = page.locator(".badge", { hasText: "Продано під час збою" });
  await expect(mark).toBeVisible();
  expect(await contrast(mark)).toBeGreaterThanOrEqual(4.5);
});
