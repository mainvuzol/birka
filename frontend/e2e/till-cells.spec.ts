import { test, expect, fromPaper, openStore, sellsFrom } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till's search, tags and size cells («Усе на бірці» task list, P0-5;
 * spec §6.6, §6.12, §6.13): a model's tag with its name and price, a cell
 * per size — its letter large, what is free under it, the pin of what
 * orders hold — and the search field with its «×». Nothing is chosen above
 * the search: a store with no warehouse to sell from is told so. The goods
 * and the sale's answer are stubbed; the store sells from its till's
 * warehouse alone.
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

const till = fixture.till_location_id;

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

const sizeL = randomUUID();
const unknown = randomUUID();

function row(
  sizeId: string,
  label: string,
  free: number,
  held = 0,
): Record<string, unknown> {
  return {
    location_id: till,
    product_variant_id: fixture.variant_id,
    size_id: sizeId,
    display_name: "Лоран шоколад",
    size_label: label,
    size_is_unknown: sizeId === unknown,
    quantity: free + held,
    reserved_quantity: held,
    available_quantity: free,
    suggested_price: "1850.00",
  };
}

/** M two free and one held, L every unit held, three of no size known. */
async function goods(page: Page): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          row(fixture.size_id, "M", 2, 1),
          row(sizeL, "L", 0, 2),
          row(unknown, "UNKNOWN", 3),
        ],
        has_more: false,
      },
    });
  });
}

async function onTheTill(page: Page): Promise<void> {
  await sellsFrom(page, till);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

function tag(page: Page): Locator {
  return page.getByRole("group", { name: "Лоран шоколад", exact: true });
}

function cell(page: Page, sizeId: string): Locator {
  return tag(page).locator(
    `button.size-cell[data-stock="${fixture.variant_id}:${sizeId}"]`,
  );
}

function search(page: Page): Locator {
  return page.getByRole("searchbox", { name: "Знайти модель" });
}

test("a model's tag: its name and price, then a cell per size — the letter large, what is free under it, 60 × 60 at least, and the pin of what orders hold, never counted as free", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  await onTheTill(page);
  await expect(tag(page).locator(".model-head")).toHaveText(
    "Лоран шоколад1 850,00 грн",
  );
  const m = cell(page, fixture.size_id);
  await expect(m.locator(".size-letter")).toHaveText("M");
  await expect(m.locator(".size-free")).toHaveText("2");
  await expect(m.locator(".size-held")).toHaveText("1");
  await expect(m).toHaveAttribute("aria-label", "M, вільно 2, у резерві 1");
  for (const each of await tag(page).locator("button.size-cell").all()) {
    const box = await each.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(60);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(60);
  }
  // No line of what is held under the tag: the pin says it.
  await expect(tag(page)).not.toContainText("у резерві замовлення");
});

test("every unit held: the cell dashed, «у резерві», and a tap puts nothing in the basket — but from paper", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  const l = cell(page, sizeL);
  await expect(l).toHaveClass(/held-only/);
  await expect(l.locator(".size-free")).toHaveText("у резерві");
  await expect(l.locator(".size-held")).toHaveText("2");
  await expect(l).toHaveAttribute("aria-label", "L, вільно 0, у резерві 2");
  await expect(l).toHaveAttribute("aria-disabled", "true");
  await l.click({ force: true });
  await expect(page.locator(".line")).toHaveCount(0);
  // From paper, the server's refusal says what to do (ADR-0013 §6).
  await fromPaper(page);
  await expect(l).not.toHaveAttribute("aria-disabled");
  await l.click();
  await expect(page.locator(".line")).toHaveCount(1);
});

test("a tap fills the cell and says «×1», the next «×2», and its name says what the basket has; the line names its warehouse under it", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  const m = cell(page, fixture.size_id);
  await expect(m.locator(".size-in")).toHaveCount(0);
  await m.click();
  await expect(m).toHaveClass(/chosen/);
  await expect(m.locator(".size-in")).toHaveText("×1");
  // The pin of the held moves aside for it, still there.
  await expect(m.locator(".size-held")).toHaveText("1");
  await m.click();
  await expect(m.locator(".size-in")).toHaveText("×2");
  await expect(m).toHaveAttribute(
    "aria-label",
    "M, вільно 2, у резерві 1, у кошику 2",
  );
  const line = page.getByRole("group", { name: "Кошик" }).locator(".line");
  await expect(line.locator("strong")).toHaveText("Лоран шоколад · M");
  await expect(line.locator(".line-place")).toHaveText("Склад: Каса-склад");
  // Out of the basket: the cell as it was.
  await line.getByRole("button", { name: /^Прибрати/ }).click();
  await expect(m).not.toHaveClass(/chosen/);
  await expect(m).toHaveAttribute("aria-label", "M, вільно 2, у резерві 1");
});

test("a size read off a coat's label puts its «×1» on that size's cell, the one a tap then adds to", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  const what = cell(page, unknown);
  const m = cell(page, fixture.size_id);
  await what.click();
  await expect(what.locator(".size-in")).toHaveText("×1");
  await page
    .getByRole("combobox", { name: "Розмір з етикетки" })
    .selectOption(fixture.size_id);
  await expect(what.locator(".size-in")).toHaveCount(0);
  await expect(m.locator(".size-in")).toHaveText("×1");
  await m.click();
  await expect(m.locator(".size-in")).toHaveText("×2");
  await expect(page.locator(".line")).toHaveCount(1);
});

test("a size not known: «?» on its cell, and the tag says what «?» is", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  const what = cell(page, unknown);
  await expect(what.locator(".size-letter")).toHaveText("?");
  await expect(what.locator(".size-free")).toHaveText("3");
  await expect(what).toHaveAttribute(
    "aria-label",
    "розмір невідомий, вільно 3",
  );
  await expect(tag(page).locator(".cell-note")).toHaveText(
    "? — розмір невідомий",
  );
});

test("the search: «Модель або колір» in it, «Знайти модель» read aloud, 52 high; «×» once typed, which empties it and keeps the cursor", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  await expect(search(page)).toHaveAttribute("placeholder", "Модель або колір");
  await expect(search(page)).toHaveAttribute("enterkeyhint", "search");
  const box = await search(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(52);
  // The old word is gone.
  await expect(page.getByText("Назва або колір")).toHaveCount(0);
  const clear = page.getByRole("button", { name: "Очистити пошук" });
  await expect(clear).toHaveCount(0);
  await search(page).fill("лор");
  await clear.click();
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
  await expect(clear).toHaveCount(0);
});

test("the search stays at the top while the tags scroll under it, and a field the page scrolls to keeps clear of it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: Array.from({ length: 12 }, (_, n) => ({
          ...row(randomUUID(), "M", 1),
          product_variant_id: randomUUID(),
          display_name: `Альпака ${String(n + 1)}`,
        })),
        has_more: false,
      },
    });
  });
  await onTheTill(page);
  await page
    .getByRole("group", { name: "Альпака 12" })
    .scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(search(page)).toBeInViewport({ ratio: 1 });
  // What the page keeps clear at its top: the band the search stands in.
  const kept = await page.evaluate(() => {
    const band = document.querySelector<HTMLElement>(".find.sticky");
    return {
      band: `${String(band?.offsetHeight)}px`,
      clear: getComputedStyle(document.documentElement).scrollPaddingTop,
    };
  });
  expect(kept.clear).toBe(kept.band);
});

test("where the search meets the bottom menu, the menu is over it, and its tabs still open", async ({
  page,
}) => {
  // Measured at the width it is looked at: only the height changes.
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  await onTheTill(page);
  // A screen just short enough for the menu to cover the search, where the
  // paper switch's panel leaves it on a phone's.
  const top = await search(page).evaluate(
    (field) => field.getBoundingClientRect().top + window.scrollY,
  );
  await page.setViewportSize({ width: 360, height: Math.round(top) + 40 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const menu = page.getByRole("navigation", { name: "Розділи" });
  const tab = menu.getByRole("button", { name: "Замовлення", exact: true });
  const box = await tab.boundingBox();
  const field = await search(page).boundingBox();
  if (box === null || field === null) throw new Error("not drawn");
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The tab's middle lies on the search too.
  expect(middle.y).toBeGreaterThan(field.y);
  expect(middle.y).toBeLessThan(field.y + field.height);
  const over = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest("nav.tab-bar") != null,
    middle,
  );
  expect(over).toBe(true);
  await tab.click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
});

test("no warehouse to sell from: said so, and no search", async ({ page }) => {
  // Every warehouse of the store marked not sold from.
  await sellsFrom(page, randomUUID());
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(
    page.getByText("Доступних складів немає. Зверніться до менеджера."),
  ).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(search(page)).toHaveCount(0);
});

test("the receipt names the one warehouse the sale left from, under its lines", async ({
  page,
}) => {
  await goods(page);
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "1850.00",
        discount_total: "0.00",
        total: "1850.00",
        items: [
          {
            id: randomUUID(),
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            source_location_id: till,
            quantity: 1,
            unit_price: "1850.00",
            discount_amount: "0.00",
            final_unit_price: "1850.00",
            line_total: "1850.00",
            display_name: "Лоран шоколад",
            size: "M",
          },
        ],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
        payment_method: "CASH",
      },
    });
  });
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  const stub = page.locator(".stub");
  await expect(stub.locator(".line strong")).toHaveText("Лоран шоколад · M");
  await expect(
    stub.getByText("Склад: Каса-склад", { exact: true }),
  ).toBeVisible();
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

for (const scheme of ["light", "dark"] as const)
  test(`in the ${scheme} theme every word of a cell reads at 4.5:1 — free, held, chosen and its badges`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await goods(page);
    await onTheTill(page);
    const m = cell(page, fixture.size_id);
    const l = cell(page, sizeL);
    await m.click();
    for (const part of [
      m.locator(".size-letter"),
      m.locator(".size-free"),
      m.locator(".size-held"),
      m.locator(".size-in"),
      l.locator(".size-letter"),
      l.locator(".size-free"),
      cell(page, unknown).locator(".size-free"),
      tag(page).locator(".cell-note"),
      tag(page).locator(".model-name"),
      tag(page).locator(".model-price"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
  });
