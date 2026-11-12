import {
  test,
  expect,
  basketDone,
  basketSheet,
  countTaps,
  openModel,
  openStore,
  readsOf,
  receiveModel,
  refuseOnce,
  section,
  sellsFrom,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The suggested selling price (owner decisions, 2026-10-01; Q-F).
 *
 * The owner and managers set it — shared for every store, or a store's own
 * that overrides it — where goods arrive and on a model's detail, opened
 * from the till's search («Усе на бірці» sections task list, P0-6); the till
 * prefills it and the seller may still agree another. The shared price needs
 * the permission over every till: organization-wide, as the owner holds it,
 * or in every store. The seed's shop has one store and «Оля» holds every
 * permission in it, so she may set either.
 *
 * Each test prices models of its own, received into the returns warehouse, so
 * nothing here changes what another journey's till suggests.
 */
interface Fixture {
  telegram_user_id: string;
  owner_telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(telegramUserId: string, name: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"${name}"}`,
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

const seller = { id: fixture.telegram_user_id, name: "Оля" };
const owner = { id: fixture.owner_telegram_user_id, name: "Власниця" };

async function enter(
  page: Page,
  who: { id: string; name: string },
  tab?: string,
): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(who.id, who.name) }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  if (tab !== undefined) await section(page, tab);
}

async function token(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(seller.id, seller.name) },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

/** A model of this test's own, three of it in the returns warehouse. */
async function model(
  page: Page,
  bearer: string,
): Promise<{ name: string; variant: string; option: string }> {
  const name = `Ціна ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: name,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.returns_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: product.sizes[0]?.size_id,
          quantity: 3,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  return {
    name,
    variant: product.product_variant_id,
    option: `${product.product_variant_id}:${product.sizes[0]?.size_id ?? ""}`,
  };
}

/** The model's detail (spec S23), from the till's search: its hero tag
 * holds the price. */
async function detail(page: Page, name: string): Promise<Locator> {
  await openModel(page, name, new RegExp(name));
  return page.getByRole("group", { name: new RegExp(name) });
}

/** For all stores or for this one (stage 2, admin task list, P1-2):
 * «Для всіх магазинів» · «Лише «Основний»». */
function scope(
  within: Page | Locator,
  appliesTo: "ORGANIZATION" | "STORE",
  store = "Основний",
): Locator {
  return within
    .getByRole("group", { name: "Яку ціну змінюємо" })
    .getByRole("button", {
      name:
        appliesTo === "ORGANIZATION" ? "Для всіх магазинів" : `Лише «${store}»`,
      exact: true,
    });
}

/** The form's one button, «Зберегти · 1 850,50 грн»: the sheet's own
 * outside Telegram, in its foot; on a screen, under the form. */
function save(within: Page | Locator, sum?: string): Locator {
  return within.getByRole("button", {
    name: sum === undefined ? "Зберегти" : `Зберегти · ${sum} грн`,
    exact: true,
  });
}

/** A key of the price's keypad: a digit, «Кома» or «Стерти». */
async function keys(sheet: Locator, ...pressed: string[]): Promise<void> {
  for (const key of pressed)
    await sheet
      .locator(".keypad-keys")
      .getByRole("button", { name: key, exact: true })
      .click();
}

/** «Змінити ціну», the price editor in a sheet named by the model. */
async function priceSheet(page: Page, name: string): Promise<Locator> {
  await page.getByRole("button", { name: "Змінити ціну", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: new RegExp(name) });
  // A tap carried from the button is let go for a moment.
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

test("a store's price set on a model's detail is what its till suggests", async ({
  page,
}) => {
  const bearer = await token(page);
  const priced = await model(page, bearer);
  const unpriced = await model(page, bearer);
  // Its till sells from the warehouse the models are in (P0-5).
  await sellsFrom(page, fixture.returns_location_id);
  await enter(page, seller);
  const hero = await detail(page, priced.name);
  await expect(hero).toContainText("Ціна продажу не задана");

  const sheet = await priceSheet(page, priced.name);
  await scope(sheet, "STORE").click();
  // A sum of nothing is said so as it is typed, and saves nothing.
  await sheet.getByLabel("Нова ціна, грн").fill("0");
  await expect(sheet.getByRole("alert")).toContainText("більше нуля");
  await expect(save(sheet)).toBeDisabled();
  // While it is saved, the sheet stays, though asked to close: its answer
  // is the sheet's to say (review, 2026-11-01).
  let answer = (): void => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = () => {
      resolve();
    };
  });
  await page.route("**/api/v1/catalog/prices", async (route) => {
    if (route.request().method() === "POST") await answered;
    await route.fallback();
  });
  await sheet.getByLabel("Нова ціна, грн").fill("1850,50");
  const saving = save(sheet, "1 850,50");
  await saving.click();
  await expect(saving).toBeDisabled();
  await page.locator(".sheet-scrim").click({ position: { x: 20, y: 20 } });
  await expect(sheet).toBeVisible();
  answer();
  // The sheet closes; a stub over the grid says it, and the tag is read
  // again.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    `Ціну продажу збережено: ${priced.name}`,
  );
  await expect(hero).toContainText("Ціна продажу 1 850,50 грн");

  // The till: the price is there before the seller types anything.
  const sent: { lines: { unit_price: string }[] }[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/sales"))
      sent.push(request.postDataJSON() as { lines: { unit_price: string }[] });
  });
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Знайти модель" });
  const lines = page.getByRole("dialog", { name: "Кошик" }).locator(".line");
  // A model with none: the basket's sheet opens by itself («Усе на бірці»
  // task list, P0-5), the line's price empty and in focus, and the ways wait
  // for it (redesign P0-3).
  await search.fill(unpriced.name);
  await page
    .locator(`button.size-cell[data-stock="${unpriced.option}"]`)
    .click();
  const unpricedPrice = lines.first().getByLabel("Ціна, грн");
  await expect(unpricedPrice).toHaveValue("");
  await expect(unpricedPrice).toBeFocused();
  await expect(
    lines.first().getByText("Ціни продажу ще немає — впишіть домовлену."),
  ).toBeVisible();
  await basketDone(page);
  await expect(
    page.getByRole("button", { name: "Готівка", exact: true }),
  ).toBeDisabled();
  // The priced one starts from its price, and the other keeps none.
  await search.fill(priced.name);
  await expect(
    page.getByRole("group", { name: new RegExp(priced.name) }),
  ).toContainText("1 850,50 грн");
  await page.locator(`button.size-cell[data-stock="${priced.option}"]`).click();
  await basketSheet(page);
  await expect(lines.nth(1).getByLabel("Ціна, грн")).toHaveValue("1850,50");
  await expect(
    lines
      .nth(1)
      .getByText("Ціна продажу 1 850,50 грн. Домовилися про іншу — змініть."),
  ).toBeVisible();
  await expect(unpricedPrice).toHaveValue("");
  await lines
    .first()
    .getByRole("button", { name: `Прибрати ${unpriced.name}` })
    .click();
  await expect(lines).toHaveCount(1);
  await basketDone(page);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sent[0]?.lines[0]?.unit_price).toBe("1850.50");
});

test("the owner sets the shared price where goods arrive, and the store's own overrides it", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  await enter(page, owner, "Приймання");
  await receiveModel(page, priced.name);
  await expect(page.getByText("Ціна продажу: не задана")).toBeVisible();

  await page.getByRole("button", { name: "Задати ціну продажу" }).click();
  // The same price first as before, one tap away from the other (stage 2,
  // admin task list, P1-2).
  await expect(scope(page, "ORGANIZATION")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(scope(page, "STORE")).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Нова ціна, грн").fill("2000");
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25).
  await refuseOnce(page, "**/api/v1/catalog/prices", 422);
  // On a screen, the form's own button under it, and «Скасувати».
  await expect(page.getByRole("button", { name: "Скасувати" })).toBeVisible();
  await save(page, "2 000,00").click();
  await expect(
    page.getByText("Ціну не збережено. Перевірте суму.", {
      exact: true,
    }),
  ).toBeVisible();
  const priceReads = readsOf(page, /\/api\/v1\/catalog\/prices$/);
  await refuseOnce(page, "**/api/v1/catalog/prices", 409);
  await save(page, "2 000,00").click();
  await expect(
    page.getByText(
      "Ціну не збережено: її щойно змінили — перевірте й збережіть ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(priceReads).toBeGreaterThan(0);
  await page.getByLabel("Нова ціна, грн").fill("2000");
  // The server's own failure, or a request naming nothing: what was not
  // done, then the step — never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/catalog/prices", 500);
  await save(page, "2 000,00").click();
  await expect(
    page.getByText(
      "Ціну не збережено. Натисніть ще раз — повторити безпечно. Номер запиту: 3f9c2a7e.",
      { exact: true },
    ),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/catalog/prices", 404);
  await save(page, "2 000,00").click();
  await expect(
    page.getByText("Ціну не збережено. Перевірте суму.", { exact: true }),
  ).toBeVisible();
  await save(page, "2 000,00").click();
  await expect(
    page.getByText("Ціна продажу: 2 000,00 грн — спільна для всіх магазинів"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Змінити ціну продажу" }).click();
  await scope(page, "STORE").click();
  await expect(
    page.getByText("Зараз: своєї ціни немає, діє спільна 2 000,00 грн."),
  ).toBeVisible();
  await page.getByLabel("Нова ціна, грн").fill("1900");
  await save(page, "1 900,00").click();
  await expect(
    page.getByText("Ціна продажу: 1 900,00 грн — ціна магазину «Основний»"),
  ).toBeVisible();

  // Removing the store's own price brings the shared one back.
  await page.getByRole("button", { name: "Змінити ціну продажу" }).click();
  await expect(scope(page, "STORE")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Прибрати ціну «Основний»" }).click();
  await expect(
    page.getByText("Ціна продажу: 2 000,00 грн — спільна для всіх магазинів"),
  ).toBeVisible();
});

test("for all stores or for this one: two segments on one row at 360 px, the same one first, one tap to the other, a long store's name cut short and read whole (stage 2, admin task list, P1-2)", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  await sellsFrom(page, fixture.returns_location_id);
  const long = "Основний на Хрещатику, біля центрального входу до ЦУМу";
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { code: string; name: string }[];
    };
    await route.fulfill({
      response,
      json: {
        ...me,
        stores: me.stores.map((store) =>
          store.code === "MAIN" ? { ...store, name: long } : store,
        ),
      },
    });
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(seller.id, seller.name) }).toString()}`,
  );
  await openStore(page, new RegExp(`^${long} MAIN`));
  await detail(page, priced.name);
  const sheet = await priceSheet(page, priced.name);
  const all = scope(sheet, "ORGANIZATION");
  const one = scope(sheet, "STORE", long);
  await expect(sheet.getByRole("combobox")).toHaveCount(0);
  // No price of its own yet, and the shared one may be set: that one first,
  // as before.
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(one).toHaveAttribute("aria-pressed", "false");
  const [left, right] = await Promise.all([
    all.boundingBox(),
    one.boundingBox(),
  ]);
  if (!left || !right) throw new Error("the segments are not drawn");
  expect(Math.abs(left.y - right.y)).toBeLessThan(1);
  expect(right.x + right.width).toBeLessThanOrEqual(360);
  // The long name is cut short with «…», never wrapped.
  expect(
    await one.locator("span").evaluate((node) => ({
      cut: node.scrollWidth > node.clientWidth,
      overflow: getComputedStyle(node).textOverflow,
      lines: node.getClientRects().length,
    })),
  ).toEqual({ cut: true, overflow: "ellipsis", lines: 1 });
  // «Для всіх магазинів» whole beside it (review).
  expect(
    await all.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(right.height).toBeLessThan(50);
  await one.click();
  await expect(one).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");
});

test("in the model's sheet a price is two taps and its sum: «Змінити ціну», the sum on the app's keypad, with its comma, and «Зберегти · 3 600,00 грн» in the sheet's foot; no «Скасувати» — «Назад» leaves, nothing saved; «Прибрати ціну «Основний»» quiet; at 360 px nothing goes past the screen (stage 2, goods task list, P1-4)", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  await sellsFrom(page, fixture.returns_location_id);
  const posted: unknown[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/catalog/prices")
    )
      posted.push(request.postDataJSON());
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await enter(page, seller);
  const hero = await detail(page, priced.name);
  const taps = await countTaps(page);
  let sheet = await priceSheet(page, priced.name);
  await expect(sheet.getByRole("button", { name: "Скасувати" })).toHaveCount(0);
  const sum = sheet.getByLabel("Нова ціна, грн");
  // The phone's keyboard never opens over it.
  await expect(sum).toHaveAttribute("inputmode", "none");
  const foot = sheet.locator(".sheet-foot").getByRole("button");
  await expect(foot).toHaveText(["Зберегти"]);
  await expect(foot).toBeDisabled();
  await keys(sheet, "3", "6", "0", "0");
  await expect(sum).toHaveValue(/^3\s600$/);
  await expect(foot).toHaveText(["Зберегти · 3 600,00 грн"]);
  // «Для всіх магазинів» whole beside a short store's name too.
  expect(
    await scope(sheet, "ORGANIZATION").evaluate(
      (node) => node.scrollWidth <= node.clientWidth,
    ),
  ).toBe(true);
  // Light and dark: the sheet on the card's ground, nothing past the screen.
  for (const [scheme, card] of [
    ["light", "rgb(255, 255, 255)"],
    ["dark", "rgb(24, 26, 20)"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(sheet).toHaveCSS("background-color", card);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/price-sheet-${scheme}.png` });
  }
  await foot.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    `Ціну продажу збережено: ${priced.name}`,
  );
  await expect(hero).toContainText("Ціна продажу 3 600,00 грн");
  expect(await taps()).toBe(2 + 4);
  expect(posted).toEqual([
    expect.objectContaining({
      applies_to: "ORGANIZATION",
      suggested_price: "3600.00",
    }),
  ]);

  // The store's own, its kopecks after the comma.
  sheet = await priceSheet(page, priced.name);
  await scope(sheet, "STORE").click();
  // Empty, «Зараз» naming the price that stands: a sum full to its kopecks
  // would take no figure (review, 2026-11-07).
  await expect(
    sheet.getByText("Зараз: своєї ціни немає, діє спільна 3 600,00 грн."),
  ).toBeVisible();
  await expect(sum).toHaveValue("");
  await keys(sheet, "3", "6", "0", "0", "Кома");
  await expect(save(sheet, "3 600,00")).toBeEnabled();
  await keys(sheet, "5");
  await expect(sum).toHaveValue(/^3\s600,5$/);
  await save(sheet, "3 600,50").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(hero).toContainText("Ціна продажу 3 600,50 грн");
  expect(posted[1]).toMatchObject({
    applies_to: "STORE",
    expected_price: null,
    suggested_price: "3600.50",
  });

  // Removed, quietly: the shared one stands again.
  sheet = await priceSheet(page, priced.name);
  await expect(scope(sheet, "STORE")).toHaveAttribute("aria-pressed", "true");
  const remove = sheet.getByRole("button", {
    name: "Прибрати ціну «Основний»",
    exact: true,
  });
  await expect(remove).toHaveClass(/\bquiet\b/);
  await remove.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(hero).toContainText("Ціна продажу 3 600,00 грн");
  expect(posted[2]).toMatchObject({
    applies_to: "STORE",
    expected_price: "3600.50",
    suggested_price: null,
  });

  // «Назад» leaves it, nothing saved.
  sheet = await priceSheet(page, priced.name);
  await keys(sheet, "9");
  await expect(sum).toHaveValue("9");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Змінити ціну", exact: true }),
  ).toBeFocused();
  expect(posted).toHaveLength(3);
});

test("in Telegram the price sheet's one button is its MainButton, «Зберегти · 3 600,00 грн», there only while the sheet is, inactive till a sum is typed (stage 2, goods task list, P1-4)", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  await sellsFrom(page, fixture.returns_location_id);
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      told: [string, unknown][];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        host.told.push([event, data ? (JSON.parse(data) as unknown) : null]);
      },
    };
  });
  const told = (event: string): Promise<unknown[]> =>
    page.evaluate(
      (wanted) =>
        (window as unknown as { told: [string, unknown][] }).told
          .filter(([name]) => name === wanted)
          .map(([, data]) => data),
      event,
    );
  const main = async (): Promise<unknown> =>
    (await told("web_app_setup_main_button")).at(-1) ?? null;
  const shown = async (): Promise<boolean> =>
    ((await main()) as { is_visible?: boolean } | null)?.is_visible ?? false;
  await page.goto(
    `/#${new URLSearchParams({
      tgWebAppData: initData(seller.id, seller.name),
      tgWebAppVersion: "8.0",
    }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  const hero = await detail(page, priced.name);
  await expect.poll(shown).toBe(false);
  const sheet = await priceSheet(page, priced.name);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Зберегти",
  });
  // Telegram's, never one of the sheet's own.
  await expect(sheet.locator(".main-mimic")).toHaveCount(0);
  await keys(sheet, "3", "6", "0", "0");
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Зберегти · 3\u00a0600,00\u00a0грн",
  });
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/catalog/prices"),
  );
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  expect((await sent).postDataJSON()).toMatchObject({
    applies_to: "ORGANIZATION",
    suggested_price: "3600.00",
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(hero).toContainText("Ціна продажу 3 600,00 грн");
  expect(await told("web_app_trigger_haptic_feedback")).toContainEqual({
    type: "notification",
    notification_type: "success",
  });
  await expect.poll(shown).toBe(false);
});

test("a price someone else changed meanwhile is not overwritten unseen", async ({
  page,
}) => {
  const bearer = await token(page);
  const priced = await model(page, bearer);
  await enter(page, seller);
  const hero = await detail(page, priced.name);
  const sheet = await priceSheet(page, priced.name);
  await sheet.getByLabel("Нова ціна, грн").fill("1850");

  // Someone else sets the same, shared, price first.
  const elsewhere = await page.request.post("/api/v1/catalog/prices", {
    headers: { Authorization: `Bearer ${bearer}` },
    data: {
      store_id: fixture.store_id,
      product_variant_id: priced.variant,
      applies_to: "ORGANIZATION",
      expected_price: null,
      suggested_price: "1700.00",
    },
  });
  expect(elsewhere.status()).toBe(200);

  await save(sheet, "1 850,00").click();
  await expect(sheet.getByRole("alert")).toContainText(
    "Цю ціну щойно змінив хтось інший: тепер 1 700,00 грн",
  );
  await expect(sheet.getByText("Зараз: 1 700,00 грн")).toBeVisible();
  // Now seen, it is saved over.
  await save(sheet, "1 850,00").click();
  await expect(sheet).toHaveCount(0);
  await expect(hero).toContainText("Ціна продажу 1 850,00 грн");
});

test("whoever may set only this store's price is told so, and sets that", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  // As for a manager of one store in a shop of several: the server answers
  // that the shared price is not theirs to change.
  await page.route("**/api/v1/catalog/prices?**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...((await response.json()) as object), may_set_shared: false },
    });
  });
  await enter(page, seller);
  const hero = await detail(page, priced.name);
  const sheet = await priceSheet(page, priced.name);
  // One line, nothing said of the price it may not change (stage 2, admin
  // task list, P1-2).
  await expect(
    sheet.getByText("Ця ціна діятиме лише в магазині «Основний».", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("group", { name: "Яку ціну змінюємо" }),
  ).toHaveCount(0);
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/catalog/prices"),
  );
  await sheet.getByLabel("Нова ціна, грн").fill("1850");
  await save(sheet, "1 850,00").click();
  expect((await sent).postDataJSON()).toMatchObject({
    applies_to: "STORE",
    suggested_price: "1850.00",
  });
  await expect(hero).toContainText("Ціна продажу 1 850,00 грн");
});

test("a price read slowly is a field in grey, said to a reader alone; one that fails, the warning's plate with «Спробувати ще раз», which reads it again (audit after stage 2, frame P1-4, goods P1-1)", async ({
  page,
}) => {
  const priced = await model(page, await token(page));
  await sellsFrom(page, fixture.returns_location_id);
  let answer = (): void => undefined;
  // Let go by itself in ten seconds, should the journey fail before it
  // answers: no read is left hanging as it ends.
  const held = new Promise<void>((resolve) => {
    answer = resolve;
    setTimeout(resolve, 10_000);
  });
  let refused = false;
  await page.route("**/api/v1/catalog/prices?*", async (route) => {
    await held;
    if (!refused) {
      refused = true;
      await route.fulfill({
        status: 503,
        json: { code: "UNAVAILABLE", message: "No" },
      });
      return;
    }
    await route.fallback();
  });
  await enter(page, seller);
  await detail(page, priced.name);
  const sheet = await priceSheet(page, priced.name);
  const field = sheet.locator(".placeholder > .skeleton-field");
  await expect(field).toBeVisible();
  expect(Math.round((await field.boundingBox())?.height ?? 0)).toBe(52);
  await expect(field).toHaveCSS("border-top-left-radius", "8px");
  await expect(
    sheet.getByRole("status").filter({ hasText: "Завантажуємо ціну продажу…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  answer();
  const plate = sheet.locator(".read-failure");
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(field).toHaveCount(0);
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(sheet.getByLabel("Нова ціна, грн")).toBeVisible();
  await expect(plate).toHaveCount(0);
});

test("whoever does not set prices sees them and is offered no change", async ({
  page,
}) => {
  const bearer = await token(page);
  const priced = await model(page, bearer);
  const set = await page.request.post("/api/v1/catalog/prices", {
    headers: { Authorization: `Bearer ${bearer}` },
    data: {
      store_id: fixture.store_id,
      product_variant_id: priced.variant,
      applies_to: "STORE",
      expected_price: null,
      suggested_price: "1850.00",
    },
  });
  expect(set.status()).toBe(200);
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of me.stores)
      store.permissions = store.permissions.filter(
        (permission) => permission !== "catalog:set_price",
      );
    await route.fulfill({ response, json: me });
  });

  await enter(page, seller);
  await expect(await detail(page, priced.name)).toContainText(
    "Ціна продажу 1 850,00 грн",
  );
  await expect(
    page.getByRole("button", { name: "Змінити ціну", exact: true }),
  ).toHaveCount(0);

  await section(page, "Приймання");
  await receiveModel(page, priced.name);
  await expect(
    page.getByText("Ціна продажу: 1 850,00 грн — ціна магазину «Основний»"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /ціну продажу/ })).toHaveCount(
    0,
  );
});
