import { test, expect, openStore, toTill, sellsFrom } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till's tray and its basket's sheet («Усе на бірці» task list, P0-5;
 * spec §6.15, §6.16, §6.29, S08–S10): the tray comes with the first coat —
 * the basket in one row, what is paid, the three ways — and its row opens
 * the sheet with the lines, their prices and «Оплата частинами»; the sheet
 * closes by «Готово», the keyboard's «Готово», Telegram's «Назад», Escape,
 * the scrim and its handle, the basket kept. The till opens with the cursor
 * in its search, and on a phone's screen the search, a whole tag and the
 * tray are in view at once. The goods are stubbed; the store sells from its
 * till's warehouse alone.
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

/** Opened from Telegram, of `version` when given. */
function launch(version?: string): string {
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
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
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

/** M two free and one held, L every unit held, three of no size known; at
 * 1 850,00 грн, or with no price. */
async function goods(page: Page, priced = true): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          row(fixture.size_id, "M", 2, 1),
          row(sizeL, "L", 0, 2),
          row(unknown, "UNKNOWN", 3),
        ].map((one) => (priced ? one : { ...one, suggested_price: null })),
        has_more: false,
      },
    });
  });
}

async function onTheTill(page: Page, version?: string): Promise<void> {
  await sellsFrom(page, till);
  await page.goto(launch(version));
  await openStore(page, "Основний MAIN");
  await toTill(page);
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

function tray(page: Page): Locator {
  return page.locator(".till-tray");
}

function sheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Кошик" });
}

/** The tray's row tapped: its sheet, once it takes taps — a tap carried from
 * what opened it is let go for a moment. */
async function opened(page: Page): Promise<Locator> {
  await tray(page).locator(".tray-basket").click();
  await expect(sheet(page)).toHaveAttribute("data-ready", "");
  return sheet(page);
}

/** Nothing behind the sheet in reach: no tab, tap or reader. */
async function behind(page: Page): Promise<string | null> {
  return page.locator("#root").getAttribute("inert");
}

/** What the app tells Telegram of its «Назад», in order: shown or not. */
async function hearBack(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      backs: boolean[];
    };
    host.backs = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_back_button")
          host.backs.push(
            (JSON.parse(data) as { is_visible: boolean }).is_visible,
          );
      },
    };
  });
}

async function backs(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as { backs: boolean[] }).backs);
}

/** Telegram's «Назад» pressed. */
async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
}

/** Twelve models of one coat each, «Альпака 1» to «Альпака 12». */
async function alpacas(page: Page): Promise<void> {
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
}

test("the till opens with the cursor in its search", async ({ page }) => {
  // For whoever reads no report: whoever does opens on «Сьогодні», and
  // «Продаж» leaves the cursor on the tab pressed (review, 2026-10-17).
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (right) => right !== "report:view_financial",
      );
    await route.fulfill({ response, json: body });
  });
  await goods(page);
  await onTheTill(page);
  await expect(search(page)).toBeFocused();
});

test("the tray comes with the first coat: the basket in one row, «Разом», the three ways at 56 — and none with the basket empty", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  await expect(tray(page)).toHaveCount(0);
  await cell(page, fixture.size_id).click();
  const row = tray(page).locator(".tray-basket");
  await expect(row).toHaveAccessibleName("Кошик · 1 · Лоран шоколад · M");
  await expect(row).toHaveAttribute("aria-haspopup", "dialog");
  await expect(row.locator(".tray-count")).toHaveText("Кошик · 1");
  expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(tray(page).locator(".pay-total")).toHaveText(
    /^Разом\s1\s850,00\sгрн$/,
  );
  for (const way of ["Готівка", "Картка", "Переказ"]) {
    const button = tray(page).getByRole("button", { name: way, exact: true });
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
      56,
    );
  }
  // What is paid and how is one group; the basket's row is not of it.
  const paying = page.getByRole("group", {
    name: "Продати — як платить покупець",
  });
  await expect(paying.getByRole("button")).toHaveText([
    "Готівка",
    "Картка",
    "Переказ",
  ]);
  // The basket's lines are in its sheet, not on the page.
  await expect(page.locator(".line")).toHaveCount(0);
  await expect(sheet(page)).toHaveCount(0);
  await cell(page, fixture.size_id).click();
  await expect(row).toHaveAccessibleName("Кошик · 2 · Лоран шоколад · M");
});

test("the tray's row opens the basket's sheet: the line, «Склад», −/+ and the price, which the tray then sums; «Готово» closes it, the basket kept", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  expect(await behind(page)).toBeNull();
  await opened(page);
  expect(await behind(page)).toBe("");
  await expect(
    sheet(page).getByRole("heading", { name: "Кошик" }),
  ).toBeVisible();
  const line = sheet(page).locator(".line");
  await expect(line.locator("strong")).toHaveText("Лоран шоколад · M");
  await expect(line.locator(".line-place")).toHaveText("Склад: Каса-склад");
  await line.getByRole("button", { name: "Більше" }).click();
  await expect(line.locator("output")).toHaveText("2");
  const price = line.getByLabel("Ціна, грн");
  await expect(price).toHaveAttribute("enterkeyhint", "done");
  await price.fill("1000");
  await sheet(page).getByRole("button", { name: "Готово", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(await behind(page)).toBeNull();
  // The cursor back on the row that opened it.
  await expect(tray(page).locator(".tray-basket")).toBeFocused();
  await expect(tray(page).locator(".tray-count")).toHaveText("Кошик · 2");
  await expect(tray(page).locator(".pay-total")).toHaveText(
    /^Разом\s2\s000,00\sгрн$/,
  );
  // Open again: as it was left.
  await opened(page);
  await expect(sheet(page).getByLabel("Ціна, грн")).toHaveValue("1000");
});

test("the sheet closes by Telegram's «Назад», shown only while it is open, by Escape, the scrim and its handle pulled down — never by a short pull — and the basket stays", async ({
  page,
}) => {
  await hearBack(page);
  await goods(page);
  await onTheTill(page, "7.0");
  await cell(page, fixture.size_id).click();
  const row = tray(page).locator(".tray-basket");
  // A tab's first screen: Telegram's «Закрити», never told otherwise.
  await opened(page);
  await expect.poll(() => backs(page)).toEqual([true]);
  await pressBack(page);
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => backs(page)).toEqual([true, false]);
  await expect(row).toHaveAccessibleName("Кошик · 1 · Лоран шоколад · M");

  await opened(page);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);

  await opened(page);
  await page.locator(".sheet-scrim").click({ position: { x: 20, y: 20 } });
  await expect(sheet(page)).toHaveCount(0);

  await opened(page);
  // Measured once it has risen.
  await sheet(page).evaluate((node) =>
    Promise.all(node.getAnimations().map((motion) => motion.finished)),
  );
  const grip = page.locator(".sheet-grip");
  const box = await grip.boundingBox();
  if (box === null) throw new Error("no handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Pulled a little and let go: it stays.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 30, { steps: 3 });
  await page.mouse.up();
  await expect(sheet(page)).toBeVisible();
  // Pulled down: closed.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 160, { steps: 6 });
  await page.mouse.up();
  await expect(sheet(page)).toHaveCount(0);
  await expect(row).toHaveAccessibleName("Кошик · 1 · Лоран шоколад · M");
});

test("a model with no price opens the sheet by itself, the cursor in its price; the keyboard's «Готово» closes it, the price kept", async ({
  page,
}) => {
  // On 360 × 640 the tray that comes with the coat covers its cell.
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page, false);
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await expect(sheet(page)).toBeVisible();
  const price = sheet(page).getByLabel("Ціна, грн");
  await expect(price).toBeFocused();
  await expect(price).toHaveValue("");
  await price.fill("1500");
  await price.press("Enter");
  await expect(sheet(page)).toHaveCount(0);
  await expect(tray(page).locator(".pay-total")).toHaveText(
    /^Разом\s1\s500,00\sгрн$/,
  );
  // The cursor back where it was before the sheet, and the cell in sight
  // over the tray.
  const back = cell(page, fixture.size_id);
  await expect(back).toBeFocused();
  const box = await back.boundingBox();
  const top = await tray(page).boundingBox();
  if (box === null || top === null) throw new Error("not drawn");
  expect(box.y + box.height).toBeLessThanOrEqual(top.y);
});

test("closed with a price missing, the ways wait, and a way pressed opens the sheet at that line, the cursor in its price — nothing sent", async ({
  page,
}) => {
  await goods(page, false);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/sales"))
      sent.push(request.url());
  });
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await expect(sheet(page)).toHaveAttribute("data-ready", "");
  await sheet(page).getByRole("button", { name: "Готово", exact: true }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(tray(page).locator(".pay-total")).toHaveText(/^Разом\s—$/);
  const cash = tray(page).getByRole("button", { name: "Готівка", exact: true });
  await expect(cash).toBeDisabled();
  // Dimmed, but pressed it takes the seller to what it waits for.
  await cash.click({ force: true });
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByLabel("Ціна, грн")).toBeFocused();
  await expect(
    sheet(page).getByText(/^Ціни продажу ще немає — впишіть домовлену\./),
  ).toBeVisible();
  expect(sent).toEqual([]);
});

test("a tap carried into the sheet from what opened it is let go — the scrim's, as a double tap's second — and taken a moment later", async ({
  page,
}) => {
  await goods(page, false);
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await expect(sheet(page)).toBeVisible();
  await page.locator(".sheet-scrim").click({ position: { x: 20, y: 20 } });
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toHaveAttribute("data-ready", "");
  await page.locator(".sheet-scrim").click({ position: { x: 20, y: 20 } });
  await expect(sheet(page)).toHaveCount(0);
});

test("while a way's press is sent, the tray's row opens no sheet: the shelf's answer comes on the till, not under it", async ({
  page,
}) => {
  await goods(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/sales", async (route) => {
    await held;
    await route.abort();
  });
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await tray(page).getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(tray(page).locator(".pay-ways .pressed")).toHaveCount(1);
  await tray(page).locator(".tray-basket").click();
  // A frame drawn after the tap: a sheet it opened would be on the page.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
  await expect(sheet(page)).toHaveCount(0);
  expect(await behind(page)).toBeNull();
  release();
});

test("with the keyboard up, the sheet keeps within what is left of the screen, its inside scrolling to the field", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await opened(page);
  await sheet(page).getByLabel("Оплата частинами").check();
  // Telegram's stable height stays as it was while the keyboard takes the
  // rest of the screen (Android).
  await page.evaluate(() => {
    document.documentElement.style.setProperty(
      "--tg-viewport-stable-height",
      "640px",
    );
  });
  await page.setViewportSize({ width: 360, height: 320 });
  const box = await sheet(page).boundingBox();
  if (box === null) throw new Error("not drawn");
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(321);
  // The field in focus, scrolled to as the keyboard comes: within the
  // sheet's inside, never off the screen.
  const name = sheet(page).getByLabel("Ім’я покупця");
  await expect(name).toBeFocused();
  const page0 = await page.evaluate(() => window.scrollY);
  await name.scrollIntoViewIfNeeded();
  await expect(name).toBeInViewport({ ratio: 1 });
  // The sheet's inside moved, not the till behind it.
  expect(await page.evaluate(() => window.scrollY)).toBe(page0);
  expect(
    await sheet(page)
      .locator(".sheet-body")
      .evaluate((body) => body.scrollHeight > body.clientHeight),
  ).toBe(true);
  await expect(
    sheet(page).getByRole("button", { name: "Готово", exact: true }),
  ).toBeInViewport({ ratio: 1 });
});

test("paying in parts is in the sheet: the tray says what is paid now and what is left, and the keyboard's «Готово» after the sum closes the sheet", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await opened(page);
  await sheet(page).getByLabel("Оплата частинами").check();
  await expect(sheet(page).getByLabel("Ім’я покупця")).toBeFocused();
  await sheet(page).getByLabel("Ім’я покупця").fill("Марта");
  await sheet(page).getByLabel("Телефон покупця").fill("0630007812");
  const paid = sheet(page).getByLabel("Сплачує зараз, грн");
  await paid.fill("1000");
  await paid.press("Enter");
  await expect(sheet(page)).toHaveCount(0);
  await expect(tray(page).locator(".pay-total")).toHaveText(
    /^Зараз\s1\s000,00\sгрн\s·\sвинен\s850,00\sгрн$/,
  );
});

test("the basket emptied in its sheet closes it, and the tray goes; the next coat brings the tray, not the sheet", async ({
  page,
}) => {
  await goods(page);
  await onTheTill(page);
  await cell(page, fixture.size_id).click();
  await opened(page);
  await sheet(page)
    .getByRole("button", { name: /^Прибрати Лоран шоколад/ })
    .click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(tray(page)).toHaveCount(0);
  // The cursor in the search, where the next model is found.
  await expect(search(page)).toBeFocused();
  await cell(page, fixture.size_id).click();
  await expect(tray(page)).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
});

for (const [width, height, whole] of [
  [360, 640, 1],
  [390, 844, 2],
] as const)
  test(`on ${String(width)} × ${String(height)}, a coat in the basket, the search, ${String(whole)} whole tag${whole > 1 ? "s" : ""} and the tray are in view at once`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await alpacas(page);
    await onTheTill(page);
    await page
      .getByRole("group", { name: "Альпака 1", exact: true })
      .locator("button.size-cell")
      .click();
    await expect(tray(page)).toBeVisible();
    // The seller scrolls to the next tags: they stand between the two.
    await page
      .getByRole("group", { name: "Альпака 4", exact: true })
      .evaluate((tag) => {
        tag.scrollIntoView({ block: "nearest" });
      });
    await expect(search(page)).toBeInViewport({ ratio: 1 });
    await expect(tray(page)).toBeInViewport({ ratio: 1 });
    const field = await search(page).boundingBox();
    const panel = await tray(page).boundingBox();
    if (field === null || panel === null) throw new Error("not drawn");
    const tags = await page.locator(".tags .model-tag").all();
    let seen = 0;
    for (const one of tags) {
      const box = await one.boundingBox();
      if (
        box !== null &&
        box.y >= field.y + field.height &&
        box.y + box.height <= panel.y
      )
        seen += 1;
    }
    expect(seen).toBeGreaterThanOrEqual(whole);
  });
