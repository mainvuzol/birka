import {
  test,
  expect,
  more,
  openStore,
  toTill,
  sellsFrom,
  shortage,
  paperSheet,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till's shelf question as a sheet, and its paper switch as a row
 * («Усе на бірці» task list, P0-5, items 5 and 7; spec §4.3, §6.29, S08,
 * S09): a way pressed with more in the basket than the books raises
 * «Залишку не вистачає» over the till in its words and answers; closed, it
 * sells nothing and keeps the basket. «Вношу продаж з паперу» is a switch
 * under the search, the state «Ще»'s switch shows. The goods and the sale's
 * answer are stubbed; the store sells from its till's warehouse alone.
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

/** M, two free, at 1 850,00 грн. */
async function goods(page: Page): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            location_id: till,
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            display_name: "Лоран шоколад",
            size_label: "M",
            size_is_unknown: false,
            quantity: 2,
            reserved_quantity: 0,
            available_quantity: 2,
            suggested_price: "1850.00",
          },
        ],
        has_more: false,
      },
    });
  });
}

interface Sent {
  command_id: string;
  lines: { unit_price: string; quantity: number }[];
  found_in_store: { line_index: number; quantity: number }[];
  missing_in_store: { line_index: number; quantity: number }[];
  payment_method: string;
}

/** The shelf's question for the first `refusals` presses — `requested` in
 * the basket, `available` in the books — then the sale recorded. */
async function stubSale(
  page: Page,
  short: { requested: number; available: number },
  refusals = 1,
): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/api/v1/sales", async (route) => {
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    if (sent.length <= refusals) {
      await route.fulfill({
        status: 409,
        json: {
          code: "INSUFFICIENT_STOCK",
          message: "Not enough stock for this operation",
          details: {
            location_id: till,
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            ...short,
            correctable: true,
          },
        },
      });
      return;
    }
    const total = body.lines
      .reduce((sum, line) => sum + Number(line.unit_price) * line.quantity, 0)
      .toFixed(2);
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: total,
        discount_total: "0.00",
        total,
        items: [],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
        payment_method: body.payment_method,
      },
    });
  });
  return sent;
}

async function onTheTill(page: Page): Promise<void> {
  await sellsFrom(page, till);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

function cell(page: Page): Locator {
  return page
    .getByRole("group", { name: "Лоран шоколад", exact: true })
    .locator(
      `button.size-cell[data-stock="${fixture.variant_id}:${fixture.size_id}"]`,
    );
}

function tray(page: Page): Locator {
  return page.locator(".till-tray");
}

function pay(page: Page, way: string): Locator {
  return tray(page).getByRole("button", { name: way, exact: true });
}

function question(page: Page): Locator {
  return page.getByRole("dialog", { name: "Залишку не вистачає" });
}

/** The basket's line of `quantity` coats, through its sheet. */
async function coats(page: Page, quantity: number): Promise<void> {
  await cell(page).click();
  await tray(page).locator(".tray-basket").click();
  const sheet = page.getByRole("dialog", { name: "Кошик" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  for (let held = 1; held < quantity; held += 1)
    await sheet.getByRole("button", { name: "Більше" }).click();
  await sheet.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(sheet).toHaveCount(0);
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

test("a way pressed with more in the basket than the books raises the shelf's question as a sheet over the till, in its words — the till out of reach behind it, its search still held at the top", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  await stubSale(page, { requested: 3, available: 2 });
  await onTheTill(page);
  await coats(page, 3);
  await pay(page, "Готівка").click();
  const sheet = await shortage(page);
  await expect(sheet.locator(".short-sheet > p").first()).toHaveText(
    "Лоран шоколад · M: у кошику 3 шт., в обліку 2 шт.",
  );
  // Read with its title: what the question is about, not its name alone.
  await expect(sheet).toHaveAccessibleDescription(
    "Лоран шоколад · M: у кошику 3 шт., в обліку 2 шт.",
  );
  for (const name of [
    "Товар на місці — продати 3 · Готівка",
    "На полиці немає жодної — записати нестачу",
    "Продати стільки, скільки є · Готівка",
    "Прибрати з кошика",
  ])
    await expect(sheet.getByRole("button", { name })).toBeVisible();
  await expect(sheet.getByLabel("На місці фактично є, шт.")).toBeVisible();
  // Over the till and within the screen; nothing behind it in reach.
  await expect(sheet).toBeInViewport({ ratio: 1 });
  expect(await page.locator("#root").getAttribute("inert")).toBe("");
  // The question no longer stands in the page: the search keeps its place.
  await expect(page.locator(".find.sticky")).toHaveCount(1);
  await expect(page.locator(".notice[role='alert']")).toHaveCount(0);
});

test("closed — by Escape, the scrim or Telegram's «Назад» — the question sells nothing: the basket stays, and a way pressed again asks the server afresh", async ({
  page,
}) => {
  await goods(page);
  const sent = await stubSale(page, { requested: 3, available: 2 }, 3);
  await onTheTill(page);
  await coats(page, 3);
  const close: ((sheet: Locator) => Promise<void>)[] = [
    async () => {
      await page.keyboard.press("Escape");
    },
    async () => {
      await page.locator(".sheet-scrim").click({ position: { x: 20, y: 20 } });
    },
    async () => {
      await pressBack(page);
    },
  ];
  for (const [index, closeIt] of close.entries()) {
    await pay(page, "Картка").click();
    const sheet = await shortage(page);
    await closeIt(sheet);
    await expect(question(page)).toHaveCount(0);
    expect(await page.locator("#root").getAttribute("inert")).toBeNull();
    // Nothing sold, the basket kept, nothing sent for the close.
    await expect(
      page.getByRole("heading", { name: "Продаж записано" }),
    ).toHaveCount(0);
    await expect(tray(page).locator(".tray-count")).toHaveText("Кошик · 3");
    expect(sent).toHaveLength(index + 1);
  }
  // Each press the same sale, asked again with nothing answered.
  expect(new Set(sent.map((body) => body.command_id)).size).toBe(1);
  expect(sent.every((body) => body.found_in_store.length === 0)).toBe(true);
});

test("a tap carried from the way pressed is let go: «Товар на місці» tapped as the sheet rises sends nothing, and a moment later sells", async ({
  page,
}) => {
  await goods(page);
  const sent = await stubSale(page, { requested: 3, available: 2 });
  await onTheTill(page);
  await coats(page, 3);
  await pay(page, "Готівка").click();
  await expect(question(page)).toBeVisible();
  const found = question(page).getByRole("button", {
    name: "Товар на місці — продати 3 · Готівка",
  });
  // At once, as a double press's second tap — a finger's, `detail` 1 — not
  // waiting for the sheet to settle on the screen.
  await found.dispatchEvent("click", { detail: 1 });
  await expect(question(page)).toBeVisible();
  expect(sent).toHaveLength(1);
  await shortage(page);
  await found.click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[1]?.found_in_store).toEqual([{ line_index: 0, quantity: 1 }]);
});

test("a count the shelf cannot hold is said in the sheet, by its field — never on the page under it, nor once the line is taken out", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  const sent = await stubSale(page, { requested: 3, available: 2 });
  await onTheTill(page);
  await coats(page, 3);
  await pay(page, "Готівка").click();
  const sheet = await shortage(page);
  const field = sheet.getByLabel("На місці фактично є, шт.");
  await field.fill("5");
  await sheet
    .getByRole("button", { name: "Продати стільки, скільки є · Готівка" })
    .click();
  const said = sheet.getByRole("alert");
  await expect(said).toHaveText(
    "Вкажіть від 1 до 2 шт. Якщо немає жодної — натисніть «На полиці немає жодної».",
  );
  await expect(said).toBeInViewport();
  // Right under the field, the field still in view with it.
  await expect(field).toBeInViewport();
  const at = await field.boundingBox();
  const under = await said.boundingBox();
  if (at === null || under === null) throw new Error("not drawn");
  expect(under.y).toBeGreaterThanOrEqual(at.y + at.height);
  expect(under.y - (at.y + at.height)).toBeLessThan(24);
  expect(sent).toHaveLength(1);
  // The line taken out: its refusal goes with it, and with the basket empty
  // the cursor is in the search.
  await sheet.getByRole("button", { name: "Прибрати з кошика" }).click();
  await expect(question(page)).toHaveCount(0);
  await expect(tray(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toBeFocused();
});

test("an answer that leaves less to sell than is paid now opens the basket's sheet for the terms; closed, the shelf's question is back", async ({
  page,
}) => {
  await goods(page);
  const sent = await stubSale(page, { requested: 2, available: 1 });
  await onTheTill(page);
  await cell(page).click();
  await tray(page).locator(".tray-basket").click();
  const basket = page.getByRole("dialog", { name: "Кошик" });
  await expect(basket).toHaveAttribute("data-ready", "");
  await basket.getByRole("button", { name: "Більше" }).click();
  await basket.getByLabel("Оплата частинами").check();
  await basket.getByLabel("Ім’я покупця").fill("Ігор");
  await basket.getByLabel("Телефон покупця").fill("0501234567");
  await basket.getByLabel(/^Сплачує зараз/).fill("3000");
  await basket.getByLabel(/^Сплачує зараз/).press("Enter");
  await expect(basket).toHaveCount(0);
  await pay(page, "Готівка").click();
  const sheet = await shortage(page);
  await sheet.getByLabel("На місці фактично є, шт.").fill("1");
  await sheet
    .getByRole("button", { name: "Продати стільки, скільки є · Готівка" })
    .click();
  // One sheet at a time: the terms, the question waiting under them.
  await expect(basket).toBeVisible();
  await expect(basket.getByRole("alert")).toHaveText(
    /^Покупець сплачує все одразу \(1\s850,00\sгрн\) — це звичайний продаж\. Зніміть «Оплата частинами»\.$/,
  );
  await expect(page.getByRole("dialog")).toHaveCount(1);
  // The line the question is about, marked among the basket's.
  await expect(basket.locator(".line.short")).toHaveCount(1);
  expect(sent).toHaveLength(1);
  await expect(basket).toHaveAttribute("data-ready", "");
  await basket.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(question(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  // The terms' words went with their sheet: the question says its own.
  await expect(question(page).getByRole("alert")).toHaveCount(0);
});

test("«Вношу продаж з паперу» is a switch row under the search, 44 high, over the list — the same switch «Ще» shows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  await onTheTill(page);
  const toggle = page.getByRole("switch", { name: "Вношу продаж з паперу" });
  await expect(toggle).not.toBeChecked();
  const row = page.locator(".switch-row");
  const field = await page
    .getByRole("searchbox", { name: "Знайти модель" })
    .boundingBox();
  const box = await row.boundingBox();
  const tag = await page
    .getByRole("group", { name: "Лоран шоколад", exact: true })
    .boundingBox();
  if (field === null || box === null || tag === null)
    throw new Error("not drawn");
  expect(box.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(box.y + box.height).toBeLessThanOrEqual(tag.y);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // The whole row is its target: a tap on its words turns it.
  await row.click({ position: { x: 24, y: box.height / 2 } });
  await expect(toggle).toBeChecked();
  await expect(
    page.getByRole("region", { name: "Режим: продаж з паперу" }),
  ).toBeVisible();
  // «З паперу» in the same tap; closed, the series' row under the switch,
  // still over the list (stage 2, orders task list, P0-4).
  await (
    await paperSheet(page)
  )
    .getByRole("button", { name: "Готово" })
    .click();
  const who = await page.locator(".paper-series").boundingBox();
  if (who === null) throw new Error("not drawn");
  expect(who.y).toBeGreaterThan(box.y);
  await more(page);
  await expect(
    page.getByRole("switch", { name: "Вношу продаж з паперу" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("while the warehouses are read, the switch row stands under the search's place, and stays there once the search comes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  await sellsFrom(page, till);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  const row = page.locator(".switch-row");
  const place = page.locator(".placeholder .skeleton-field");
  await expect(place).toBeVisible();
  await expect(row).toHaveCount(1);
  const waiting = await row.boundingBox();
  const field = await place.boundingBox();
  if (waiting === null || field === null) throw new Error("not drawn");
  expect(waiting.y).toBeGreaterThanOrEqual(field.y + field.height);
  release();
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toBeVisible();
  await expect(row).toHaveCount(1);
  const come = await row.boundingBox();
  if (come === null) throw new Error("not drawn");
  // The grey field still has a label over it, as the other screens' fields
  // do: the till's search, labelled for a reader only, is 6 px less.
  expect(Math.abs(come.y - waiting.y)).toBeLessThanOrEqual(8);
});

/** «Лоран шоколад» first, and `more` models under it: a list longer than
 * the screen. */
async function longList(page: Page, more: number): Promise<void> {
  const models = [
    fixture.variant_id,
    ...Array.from({ length: more }, () => randomUUID()),
  ];
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: models.map((variant, n) => ({
          location_id: till,
          product_variant_id: variant,
          size_id: fixture.size_id,
          display_name: n === 0 ? "Лоран шоколад" : `Модель ${String(n)}`,
          size_label: "M",
          size_is_unknown: false,
          quantity: 2,
          reserved_quantity: 0,
          available_quantity: 2,
          suggested_price: "1850.00",
        })),
        has_more: false,
      },
    });
  });
}

/** A finger's tap where `button` stands, the page as it is: a locator's
 * click would first scroll the sticky tray's button "into view", moving the
 * page under a long list as no finger does. Returns where it stood. */
async function tapInPlace(
  page: Page,
  button: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(button).toBeEnabled();
  const box = await button.boundingBox();
  if (box === null) throw new Error("not drawn");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return box;
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

for (const scheme of ["light", "dark"] as const)
  test(`in the ${scheme} theme a way refused is said in the tray, over the ways, in the error's colour and its crossed circle 16 — the page not moved, the ways where they were; the basket emptied, it goes with the tray (audit 2026-11-13, sale P1-3)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.emulateMedia({ colorScheme: scheme });
    // One line in the basket, ten tags in the list.
    await longList(page, 9);
    let sales = 0;
    await page.route("**/api/v1/sales", async (route) => {
      sales += 1;
      await route.fulfill({
        status: 409,
        json: {
          code: "IDEMPOTENCY_CONFLICT",
          message:
            "This idempotency key was already used with a different request",
          details: {},
        },
      });
    });
    await onTheTill(page);
    await cell(page).click();
    await expect(tray(page)).toBeVisible();
    await expect(page.locator(".model-tag")).toHaveCount(10);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight > window.innerHeight,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const before = await tapInPlace(page, pay(page, "Готівка"));
    const refused = tray(page).getByRole("alert");
    await expect(refused).toHaveText(
      "Дані змінилися, поки ви працювали. Кошик збережено — нічого не продано. Натисніть спосіб оплати ще раз.",
    );
    expect(sales).toBe(1);
    // The page's one refusal, where «Ще надсилаємо…» stood: between
    // «Разом» and the ways; over the tray only the terminal's hint.
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(
      tray(page).locator(".pay-total + .tray-refused + .pay-ways"),
    ).toHaveCount(1);
    // Nothing moved: the page where it stood, the ways where they were.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const after = await pay(page, "Готівка").boundingBox();
    if (after === null) throw new Error("not drawn");
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    await expect(refused).toBeInViewport({ ratio: 1 });
    // The error's own: its colour, its crossed circle 16, 14/500, no plate
    // — the tray is its plate; four lines at most at 360 px.
    const danger = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--danger)";
      document.body.append(probe);
      const said = getComputedStyle(probe).color;
      probe.remove();
      return said;
    });
    expect(
      await refused.evaluate((node) => {
        const style = getComputedStyle(node);
        const sign = getComputedStyle(node, "::before");
        return [
          style.color,
          style.fontSize,
          style.fontWeight,
          style.backgroundColor,
          sign.width,
          sign.height,
          sign.maskImage.startsWith("url("),
          sign.maskSize,
        ];
      }),
    ).toEqual([
      danger,
      "14px",
      "500",
      "rgba(0, 0, 0, 0)",
      "16px",
      "16px",
      true,
      "16px 16px",
    ]);
    expect((await refused.boundingBox())?.height ?? 0).toBeLessThanOrEqual(
      4 * 19,
    );
    expect(await contrast(refused)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `test-results/till-tray-refused-${scheme}.png`,
    });
    // The basket emptied: the tray goes, and what it said with it; the next
    // coat's tray says nothing of a basket gone.
    await tray(page).locator(".tray-basket").click();
    const basket = page.getByRole("dialog", { name: "Кошик" });
    await expect(basket).toHaveAttribute("data-ready", "");
    await basket
      .getByRole("button", { name: /^Прибрати Лоран шоколад/ })
      .click();
    await expect(basket).toHaveCount(0);
    await expect(tray(page)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await cell(page).click();
    await expect(tray(page)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

test("what the terms need, the basket's sheet closed over it, is said in the tray over the ways, never under the list (audit 2026-11-13, sale P1-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await longList(page, 9);
  let sales = 0;
  await page.route("**/api/v1/sales", async (route) => {
    sales += 1;
    await route.abort();
  });
  await onTheTill(page);
  await cell(page).click();
  await tray(page).locator(".tray-basket").click();
  const basket = page.getByRole("dialog", { name: "Кошик" });
  await expect(basket).toHaveAttribute("data-ready", "");
  await basket.getByLabel("Оплата частинами").check();
  await basket.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(basket).toHaveCount(0);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  // Pressed with no name: the sheet opens on what is missing.
  const before = await tapInPlace(page, pay(page, "Готівка"));
  await expect(basket).toBeVisible();
  await expect(basket.getByRole("alert")).toHaveText(
    "Вкажіть ім’я покупця, який платить частинами.",
  );
  // Said in the sheet alone while it is open.
  await expect(page.getByRole("alert")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(basket).toHaveCount(0);
  // Closed over it: said in the tray, the page's only one.
  const said = tray(page).getByRole("alert");
  await expect(said).toHaveText(
    "Вкажіть ім’я покупця, який платить частинами.",
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(
    tray(page).locator(".pay-total + .tray-refused + .pay-ways"),
  ).toHaveCount(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const after = await pay(page, "Готівка").boundingBox();
  if (after === null) throw new Error("not drawn");
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(sales).toBe(0);
});

test("a way refused, then pressed with the terms unmet: the tray says only what the terms need — one line, never the old «натисніть ще раз»; the terms turned off, it says nothing (audit 2026-11-13, sale P1-3; review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await longList(page, 9);
  let sales = 0;
  await page.route("**/api/v1/sales", async (route) => {
    sales += 1;
    await route.fulfill({
      status: 409,
      json: {
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "This idempotency key was already used with a different request",
        details: {},
      },
    });
  });
  await onTheTill(page);
  await cell(page).click();
  await tapInPlace(page, pay(page, "Готівка"));
  const said = tray(page).getByRole("alert");
  await expect(said).toContainText("Натисніть спосіб оплати ще раз.");
  expect(sales).toBe(1);
  await tray(page).locator(".tray-basket").click();
  const basket = page.getByRole("dialog", { name: "Кошик" });
  await expect(basket).toHaveAttribute("data-ready", "");
  await basket.getByLabel("Оплата частинами").check();
  await basket.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(basket).toHaveCount(0);
  // Pressed again, nothing to send: the old refusal is no longer so.
  await tapInPlace(page, pay(page, "Готівка"));
  await expect(basket).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(basket).toHaveCount(0);
  await expect(said).toHaveText(
    "Вкажіть ім’я покупця, який платить частинами.",
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
  expect(sales).toBe(1);
  // The terms changed — paid at once after all: what they needed goes.
  await tray(page).locator(".tray-basket").click();
  await expect(basket).toHaveAttribute("data-ready", "");
  await basket.getByLabel("Оплата частинами").uncheck();
  await basket.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(basket).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an answer refused for its own reason under a long list is said in the tray, over the ways, the basket kept (audit 2026-11-13, sale P1-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  // «Лоран шоколад» first, and seven models more under it.
  await longList(page, 7);
  const answers = [
    {
      code: "INSUFFICIENT_STOCK",
      details: {
        location_id: till,
        product_variant_id: fixture.variant_id,
        size_id: fixture.size_id,
        requested: 3,
        available: 2,
        correctable: true,
      },
    },
    // Held for an order while the seller answered.
    {
      code: "INSUFFICIENT_STOCK",
      details: {
        reason: "RESERVED",
        location_id: till,
        product_variant_id: fixture.variant_id,
        size_id: fixture.size_id,
        requested: 3,
        available: 2,
        correctable: false,
      },
    },
  ];
  await page.route("**/api/v1/sales", async (route) => {
    const answer = answers.shift();
    if (!answer) throw new Error("The till sent more than two sales");
    await route.fulfill({ status: 409, json: answer });
  });
  await onTheTill(page);
  await coats(page, 3);
  const before = await tapInPlace(page, pay(page, "Готівка"));
  await (
    await shortage(page)
  )
    .getByRole("button", { name: "Товар на місці — продати 3 · Готівка" })
    .click();
  const refused = tray(page).getByRole("alert");
  await expect(refused).toContainText(
    "Частина цих одиниць у резерві замовлення",
  );
  await expect(refused).toContainText("Кошик збережено — нічого не продано.");
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(refused).toBeInViewport({ ratio: 1 });
  const after = await pay(page, "Готівка").boundingBox();
  if (after === null) throw new Error("not drawn");
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  await expect(tray(page).locator(".tray-count")).toHaveText("Кошик · 3");
});

test("with a coat in the basket, the switch row turned on asks «З паперу» over the tray, and closed, brings the series' row into view over the tray, under the held search", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await goods(page);
  await onTheTill(page);
  await cell(page).click();
  await expect(tray(page)).toBeVisible();
  await page.getByRole("switch", { name: "Вношу продаж з паперу" }).check();
  // The paper asked in the same tap, in «З паперу» (stage 2, orders task
  // list, P0-4).
  const sheet = await paperSheet(page);
  await expect(
    sheet.getByRole("group", { name: "Що вносите з паперу?" }),
  ).toBeInViewport();
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toHaveCount(0);
  const series = page.locator(".paper-series");
  await expect(series).toBeInViewport({ ratio: 1 });
  const row = await series.boundingBox();
  const find = await page.locator(".find.sticky").boundingBox();
  const panel = await tray(page).boundingBox();
  if (row === null || find === null || panel === null)
    throw new Error("not drawn");
  // Its row read whole between the search and the tray.
  expect(row.y).toBeGreaterThanOrEqual(find.y + find.height);
  expect(row.y + row.height).toBeLessThanOrEqual(panel.y);
});
