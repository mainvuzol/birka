import { test, expect, more, openStore, refuseOnce, section } from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
  bin_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(): string {
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
  return fields.toString();
}

function launch(version?: string): string {
  return `/#${new URLSearchParams({
    tgWebAppData: initData(),
    ...(version === undefined ? {} : { tgWebAppVersion: version }),
  }).toString()}`;
}

/**
 * A coat of a model of this test's own — so the list's search finds exactly
 * its sale — received into the returns warehouse and sold, through the API.
 */
async function sold(
  page: Page,
  quantity: number,
): Promise<{ model: string; variant: string; size: string; token: string }> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token: token } = (await auth.json()) as {
    access_token: string;
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    "Idempotency-Key": randomUUID(),
  };
  const model = `Повернення ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers,
    data: {
      store_id: fixture.store_id,
      concept: model,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const variant = product.product_variant_id;
  const size = product.sizes[0]?.size_id ?? "";
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.returns_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          quantity: 5,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  const sale = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          source_location_id: fixture.returns_location_id,
          quantity,
          unit_price: "3000.00",
        },
      ],
      payment_method: "CASH",
    },
  });
  expect(sale.status()).toBe(201);
  return { model, variant, size, token };
}

async function held(
  page: Page,
  token: string,
  location: string,
  variant: string,
): Promise<number> {
  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.store_id}&location_id=${location}&limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const { items } = (await response.json()) as {
    items: { product_variant_id: string; quantity: number }[];
  };
  return items.find((i) => i.product_variant_id === variant)?.quantity ?? 0;
}

/** Coats of this test's own model, sold and brought back damaged. */
async function damaged(
  page: Page,
  quantity: number,
): Promise<{ model: string; variant: string; token: string }> {
  const { model, variant, token } = await sold(page, quantity);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Idempotency-Key": randomUUID(),
  };
  const list = await page.request.get(
    `/api/v1/sales?store_id=${fixture.store_id}&q=${encodeURIComponent(model)}`,
    { headers },
  );
  const { sales } = (await list.json()) as {
    sales: { id: string; items: { id: string }[] }[];
  };
  const sale = sales[0];
  if (!sale) throw new Error("The sale was just made");
  const returned = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers,
    data: {
      command_id: randomUUID(),
      lines: [
        {
          sale_item_id: sale.items[0]?.id,
          quantity,
          restock: true,
          condition: "DAMAGED",
        },
      ],
      payment_method: "CASH",
    },
  });
  expect(returned.status()).toBe(201);
  return { model, variant, token };
}

async function open(page: Page, version?: string): Promise<void> {
  await page.goto(launch(version));
  await openStore(page, "Основний MAIN");
  await section(page, "Брак");
}

function units(page: Page, model: string): Locator {
  return page.getByRole("article").filter({ hasText: model });
}

/** «Чекають · На перевірці · Підтверджений». */
function segment(page: Page, name: RegExp): Locator {
  return page
    .getByRole("group", { name: "Які речі" })
    .getByRole("button", { name });
}

/** A unit's sheet, once it takes taps. */
async function sheetOf(page: Page, model: string): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: new RegExp(model) });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** A decision's yes, the sheet's own outside Telegram, once it takes taps. */
async function yes(sheet: Locator, name: string): Promise<void> {
  const button = sheet.getByRole("button", { name, exact: true });
  await expect(button).toHaveAttribute("data-ready", "");
  await button.click();
}

/** The stub over the list: what was recorded. */
function said(page: Page): Locator {
  return page.locator(".stub-notice p");
}

/** «Брак» as a journey has it, read and not: `units` in the server's
 * order. */
async function bin(page: Page, units: () => unknown[]): Promise<void> {
  await page.route(
    `**/api/v1/damaged-units?store_id=${fixture.store_id}`,
    async (route) => {
      await route.fulfill({ json: { units: units() } });
    },
  );
}

let made = 0;
/** A unit as the server answers it: returned `days` ago. */
function aUnit(
  name: string,
  size: string | null,
  status: string,
  days: number,
  more: Record<string, unknown> = {},
): Record<string, unknown> {
  made += 1;
  return {
    id: `00000000-0000-4000-8000-7${String(made).padStart(11, "0")}`,
    display_name: name,
    size,
    status,
    returned_at: new Date(Date.now() - days * 86_400_000).toISOString(),
    status_by: status === "AWAITING" ? null : "Тетяна",
    status_at:
      status === "AWAITING"
        ? null
        : new Date(Date.now() - days * 86_400_000).toISOString(),
    sold_from_location_id: fixture.returns_location_id,
    sold_from_location_name: "Склад повернень",
    back_to_sold_from: true,
    note: null,
    ...more,
  };
}

/** Telegram 8.0, the journey's own: what the app tells it, and its
 * MainButton and «Назад» pressed. Before the page opens. */
async function telegram(page: Page): Promise<{
  main: () => Promise<unknown>;
  buzzes: () => Promise<unknown[]>;
  pressMain: () => Promise<void>;
  pressBack: () => Promise<void>;
}> {
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
  const press = (eventType: string): Promise<void> =>
    page.evaluate((type) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: type }),
          source: window.parent,
        }),
      );
    }, eventType);
  return {
    main: async () => (await told("web_app_setup_main_button")).at(-1) ?? null,
    buzzes: () => told("web_app_trigger_haptic_feedback"),
    pressMain: () => press("main_button_pressed"),
    pressBack: () => press("back_button_pressed"),
  };
}

test("a damaged coat waits under «Чекають», is taken for inspection in one tap — its sheet at once — and goes back on sale where it was sold, in two steps, the warehouse named; a stub says so, the cursor on it, the row's place held (stage 2, goods task list, P0-4; В-Г4 (а))", async ({
  page,
}) => {
  const { model, variant, token } = await damaged(page, 1);
  const before = await held(page, token, fixture.returns_location_id, variant);
  await open(page);
  // Something waits: it opens there.
  await expect(segment(page, /^Чекають \d+$/)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const unit = units(page, model);
  await expect(unit).toHaveCount(1);
  await expect(unit).toHaveAttribute("data-status", "AWAITING");
  await expect(unit).toHaveClass(/\bdashed\b/);
  await expect(unit.locator(".order-tag-title")).toHaveText(
    `${model} графіт · M`,
  );
  await expect(unit).toContainText("продано зі складу «Склад повернень»");
  // One verb.
  await expect(unit.getByRole("button")).toHaveText(["Взяти на перевірку"]);

  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25); no sheet.
  await refuseOnce(page, "**/api/v1/damaged-units/*/take", 422);
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  await expect(
    page.getByText("Не записано. Перевірте дані та спробуйте ще раз.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  const sheet = await sheetOf(page, model);
  await expect(sheet.getByRole("heading")).toHaveText(`${model} графіт · M`);
  await expect(sheet).toContainText(/Оглядає Оля з \d\d:\d\d/);
  await expect(sheet.getByRole("button")).toHaveText([
    "Повернути в продаж",
    "Брак підтверджений",
  ]);
  // Behind it, its stub; the others see who is looking.
  await expect(said(page)).toHaveText(`Ви оглядаєте: ${model} графіт · M`);

  // A tap carried from «Повернути в продаж» onto the yes risen in its place
  // is let go: nothing is sent (review, 2026-11-07). Pressed within the
  // page, so a slow runner is never past the 0.7 s.
  const returned: string[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/return-to-sale")
    )
      returned.push(request.url());
  });
  await sheet.evaluate(async (node) => {
    const button = (name: string): HTMLButtonElement | undefined =>
      [...node.querySelectorAll("button")].find(
        (one) => one.textContent === name,
      );
    // As a finger's tap, the cursor on it first: gone with it, the sheet
    // takes it back.
    button("Повернути в продаж")?.focus();
    button("Повернути в продаж")?.click();
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
    button("Так, повернути на «Склад повернень»")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail: 1 }),
    );
  });
  await expect(sheet).toBeFocused();
  await expect(sheet).toContainText(
    "Повернути в продаж на склад «Склад повернень», звідки його продали?",
  );
  // «Скасувати» is Telegram's «Назад», the sheet's own way out.
  await expect(sheet.getByRole("button")).toHaveText([
    "Так, повернути на «Склад повернень»",
  ]);
  expect(returned).toEqual([]);
  await yes(sheet, "Так, повернути на «Склад повернень»");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(said(page)).toHaveText(
    `Повернули в продаж: ${model} графіт · M → «Склад повернень»`,
  );
  expect(returned).toHaveLength(1);
  await expect(said(page)).toBeFocused();
  // Gone from «Чекають»: its place held while the stub stands, among what
  // else waits there — or, nothing else, the segment says so.
  await expect(unit).toHaveCount(0);
  await expect(page.locator(".damaged-held")).toHaveCount(
    (await page.locator(".orders-empty").count()) === 0 ? 1 : 0,
  );
  expect(await held(page, token, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(0);
  // Another segment: the stub goes, and the place with it. Nothing else in
  // «Брак» — the seed's own —: it says so under the stub, and there is no
  // segment to choose.
  if ((await page.getByRole("group", { name: "Які речі" }).count()) === 0)
    await expect(page.locator(".orders-empty")).toHaveText(
      "У «Брак» зараз нічого немає.",
    );
  else {
    await segment(page, /^На перевірці/).click();
    await expect(said(page)).toHaveCount(0);
    await expect(page.locator(".damaged-held")).toHaveCount(0);
  }
});

test("a coat confirmed damaged waits under «Підтверджений», its eyelet «Брак»'s and its edge torn, until it is written off: each decision a second step with its note, and a stub (stage 2, goods task list, P0-4)", async ({
  page,
}) => {
  const { model, variant, token } = await damaged(page, 1);
  await open(page);
  const unit = units(page, model);
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  let sheet = await sheetOf(page, model);
  await sheet.getByRole("button", { name: "Брак підтверджений" }).click();
  await expect(
    sheet.getByLabel("Що з товаром (необов’язково)"),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await sheet
    .getByLabel("Що з товаром (необов’язково)")
    .fill("пропалений рукав");
  await yes(sheet, "Так, брак підтверджений");
  await expect(said(page)).toHaveText(
    `Брак підтверджений: ${model} графіт · M`,
  );
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(1);

  await segment(page, /^Підтверджений \d+$/).click();
  await expect(unit).toHaveAttribute("data-status", "CONFIRMED");
  await expect(unit).toHaveClass(/\btorn\b/);
  await expect(unit).toContainText("Примітка: пропалений рукав");
  await expect(unit.getByRole("button")).toHaveText(["Вирішити"]);
  await unit.getByRole("button", { name: "Вирішити" }).click();
  sheet = await sheetOf(page, model);
  // Whoever returns goods to suppliers may send it back instead.
  await expect(sheet.getByRole("button")).toHaveText([
    "Списати",
    "Повернути постачальнику",
    "Перевірити ще раз",
  ]);
  await sheet.getByRole("button", { name: "Списати" }).click();
  await expect(
    sheet.getByLabel("Чому списуємо (необов’язково)"),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await sheet
    .getByLabel("Чому списуємо (необов’язково)")
    .fill("не ремонтується");
  await yes(sheet, "Так, списати");
  await expect(said(page)).toHaveText(`Списали: ${model} графіт · M`);
  await expect(said(page)).toBeFocused();
  await expect(unit).toHaveCount(0);
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(0);
});

test("«Перевірити ще раз» records at once and the sheet asks what the unit under inspection becomes; «Назад» closes it, nothing more recorded, the cursor on the stub (stage 2, goods task list, P0-4)", async ({
  page,
}) => {
  const { model } = await damaged(page, 1);
  await open(page);
  const unit = units(page, model);
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  let sheet = await sheetOf(page, model);
  await sheet.getByRole("button", { name: "Брак підтверджений" }).click();
  await yes(sheet, "Так, брак підтверджений");
  await segment(page, /^Підтверджений/).click();
  await unit.getByRole("button", { name: "Вирішити" }).click();
  sheet = await sheetOf(page, model);
  const steps: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/damaged-units/")
    )
      steps.push(new URL(request.url()).pathname.split("/").at(-1) ?? "");
  });
  await sheet.getByRole("button", { name: "Перевірити ще раз" }).click();
  await expect(sheet.getByRole("button")).toHaveText([
    "Повернути в продаж",
    "Брак підтверджений",
  ]);
  await expect(sheet).toBeFocused();
  await expect(sheet).toContainText(/Оглядає Оля з \d\d:\d\d/);
  await expect(said(page)).toHaveText(`Ви оглядаєте: ${model} графіт · M`);
  expect(steps).toEqual(["take"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The row gone from «Підтверджений», the button that opened the sheet
  // with it: the cursor on the stub.
  await expect(said(page)).toBeFocused();
  await expect(unit).toHaveCount(0);
  await segment(page, /^На перевірці/).click();
  await expect(unit).toHaveAttribute("data-status", "INSPECTING");
  await expect(unit).toHaveClass(/\bring\b/);
  await expect(unit).toContainText(/Оглядає Оля з \d\d:\d\d/);
  expect(steps).toEqual(["take"]);
});

test("someone else getting there first is said plainly, and the list is read again", async ({
  page,
}) => {
  const { model } = await damaged(page, 1);
  await page.route("**/api/v1/damaged-units/*/take", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "DAMAGED_UNIT_CHANGED",
        message:
          "The damaged unit changed since it was shown; look at it again",
        details: { actual: "INSPECTING" },
      },
    });
  });
  await open(page);
  await units(page, model)
    .getByRole("button", { name: "Взяти на перевірку" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Цю одиницю щойно змінив хтось інший",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("«Брак» opens on its first segment with something in it, oldest first, each counted; an empty one says so, and an empty «Брак» has no switch; at 360 px nothing goes past the screen, and the confirmed one is «Брак»'s colour in both themes (stage 2, goods task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  let shown: unknown[] = [
    aUnit("Оглядають", "S", "INSPECTING", 1),
    aUnit("Новіша", "M", "AWAITING", 1),
    aUnit("Найстаріша з дуже довгою назвою моделі", "L", "AWAITING", 3),
    aUnit("Підтверджена", null, "CONFIRMED", 2, { note: "пляма" }),
  ];
  await bin(page, () => shown);
  await open(page);
  await expect(page.getByRole("group", { name: "Які речі" })).toHaveText(
    "Чекають 2На перевірці 1Підтверджений 1",
  );
  await expect(segment(page, /^Чекають/)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".order-tag-title")).toHaveText([
    "Найстаріша з дуже довгою назвою моделі · L",
    "Новіша · M",
  ]);
  await expect(page.locator(".order-tag-meta").first()).toHaveText(
    /^Повернули \d\d\.\d\d · продано зі складу «Склад повернень»$/,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  // Each segment's words whole, «Підтверджений 1» too; the tags on the
  // paper, never a list's bullets (review, 2026-11-07).
  for (const each of await page
    .getByRole("group", { name: "Які речі" })
    .getByRole("button")
    .all())
    expect(
      await each.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  expect(
    await page
      .locator(".order-tags > li")
      .first()
      .evaluate((node) => getComputedStyle(node).listStyleType),
  ).toBe("none");
  await page.screenshot({ path: "test-results/damaged-360-light.png" });
  await segment(page, /^На перевірці/).click();
  await expect(page.locator(".order-tag-meta").first()).toHaveText(
    /^Оглядає Тетяна з \d\d\.\d\d, \d\d:\d\d$/,
  );
  await segment(page, /^Підтверджений/).click();
  const confirmed = units(page, "Підтверджена");
  await expect(confirmed.locator(".order-tag-title")).toHaveText(
    "Підтверджена · розмір невідомий",
  );
  const eyelet = confirmed.locator(".order-tag-eyelet");
  await expect(eyelet).toHaveCSS("background-color", "rgb(140, 41, 104)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(eyelet).toHaveCSS("background-color", "rgb(242, 140, 202)");
  await page.emulateMedia({ colorScheme: "light" });

  // Taken, its place held among the rest, so nothing jumps; the last one
  // taken, the segment says it is empty, the stub over it (review,
  // 2026-11-07).
  await page.route("**/api/v1/damaged-units/*/take", async (route) => {
    const id = route.request().url().split("/").at(-2);
    shown = shown.map((one) =>
      (one as { id: string }).id === id
        ? {
            ...(one as object),
            status: "INSPECTING",
            status_by: "Оля",
            status_at: new Date().toISOString(),
          }
        : one,
    );
    await route.fulfill({
      json: shown.find((one) => (one as { id: string }).id === id),
    });
  });
  await segment(page, /^Чекають/).click();
  await units(page, "Найстаріша")
    .getByRole("button", { name: "Взяти на перевірку" })
    .click();
  await sheetOf(page, "Найстаріша");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(said(page)).toHaveText(
    "Ви оглядаєте: Найстаріша з дуже довгою назвою моделі · L",
  );
  await expect(segment(page, /^Чекають/)).toHaveText("Чекають 1");
  await expect(page.locator(".order-tags > li")).toHaveCount(2);
  await expect(page.locator(".order-tags > li").first()).toHaveClass(
    "damaged-held",
  );
  await units(page, "Новіша")
    .getByRole("button", { name: "Взяти на перевірку" })
    .click();
  await sheetOf(page, "Новіша");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(said(page)).toHaveText("Ви оглядаєте: Новіша · M");
  await expect(page.locator(".orders-empty")).toHaveText(
    "Нічого не чекає перевірки.",
  );
  await expect(page.locator(".damaged-held")).toHaveCount(0);
  // Another segment chosen: the stub goes.
  await segment(page, /^На перевірці/).click();
  await expect(said(page)).toHaveCount(0);

  // Nothing waits: it opens where something is.
  shown = [shown[0], shown[3]];
  await section(page, "Брак");
  await expect(segment(page, /^На перевірці/)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(segment(page, /^Чекають/)).toHaveText("Чекають");
  await segment(page, /^Чекають/).click();
  await expect(page.locator(".orders-empty")).toHaveText(
    "Нічого не чекає перевірки.",
  );
  await expect(page.locator(".orders-empty-mark")).toBeVisible();
  shown = [shown[1]];
  await page.getByRole("button", { name: "Оновити" }).click();
  await segment(page, /^На перевірці/).click();
  await expect(page.locator(".orders-empty")).toHaveText(
    "Зараз ніхто не оглядає.",
  );
  // The last one decided: what became of it said over the empty «Брак», the
  // cursor on it, no switch (review, 2026-11-07).
  await page.route("**/api/v1/damaged-units/*/write-off", async (route) => {
    const gone = { ...(shown[0] as object), status: "WRITTEN_OFF" };
    shown = [];
    await route.fulfill({ json: gone });
  });
  await segment(page, /^Підтверджений/).click();
  await units(page, "Підтверджена")
    .getByRole("button", { name: "Вирішити" })
    .click();
  const last = await sheetOf(page, "Підтверджена");
  await last.getByRole("button", { name: "Списати" }).click();
  await yes(last, "Так, списати");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(said(page)).toHaveText(
    "Списали: Підтверджена · розмір невідомий",
  );
  await expect(said(page)).toBeFocused();
  await expect(page.locator(".orders-empty")).toHaveText(
    "У «Брак» зараз нічого немає.",
  );
  await expect(page.getByRole("group", { name: "Які речі" })).toHaveCount(0);
  await page.getByRole("button", { name: "Оновити" }).click();
  await expect(said(page)).toHaveCount(0);
  await expect(page.locator(".orders-empty")).toHaveText(
    "У «Брак» зараз нічого немає.",
  );
});

test("without returning goods to suppliers, a confirmed unit's sheet offers no «Повернути постачальнику» (stage 2, goods task list, P0-4)", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "supplier:return",
      );
    await route.fulfill({ response, json: body });
  });
  await bin(page, () => [aUnit("Підтверджена", "M", "CONFIRMED", 1)]);
  await open(page);
  await expect(segment(page, /^Підтверджений/)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await units(page, "Підтверджена")
    .getByRole("button", { name: "Вирішити" })
    .click();
  const sheet = await sheetOf(page, "Підтверджена");
  await expect(sheet.getByRole("button")).toHaveText([
    "Списати",
    "Перевірити ще раз",
  ]);
});

test("«Брак»'s warehouses read slowly: two choices in grey, 44 high and the chip's corner, where they come, «Завантажуємо склади…» said to a reader alone (audit after stage 2, frame P1-4)", async ({
  page,
}) => {
  await bin(page, () => [
    aUnit("Чужа", "M", "INSPECTING", 1, {
      back_to_sold_from: false,
      sold_from_location_id: "00000000-0000-4000-8000-500000000001",
      sold_from_location_name: "Свій склад Ринку",
      status_by: "Оля",
    }),
  ]);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  let answer = (): void => undefined;
  // Let go by itself in ten seconds, should the journey fail before it
  // answers: no read is left hanging as it ends.
  const held = new Promise<void>((resolve) => {
    answer = resolve;
    setTimeout(resolve, 10_000);
  });
  await page.route("**/api/v1/stock-locations?*", async (route) => {
    await held;
    await route.fallback();
  });
  await section(page, "Брак");
  await units(page, "Чужа").getByRole("button", { name: "Вирішити" }).click();
  const sheet = await sheetOf(page, "Чужа");
  await sheet.getByRole("button", { name: "Повернути в продаж" }).click();
  const grey = sheet.locator(".placeholder.chips.damaged-place > .chip");
  await expect(grey).toHaveCount(2);
  expect(Math.round((await grey.first().boundingBox())?.height ?? 0)).toBe(44);
  await expect(grey.first()).toHaveCSS("border-top-left-radius", "8px");
  await expect(
    sheet.getByRole("status").filter({ hasText: "Завантажуємо склади…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  answer();
  await expect(
    sheet
      .getByRole("group", { name: "Склад вашого магазину" })
      .getByRole("button", { name: "Склад повернень", exact: true }),
  ).toBeVisible();
  await expect(grey).toHaveCount(0);
});

test("inside Telegram a decision's yes is its MainButton — for a unit sold from another store's own warehouse, inactive until one of this store's is chosen as a chip —, felt when recorded; «Назад» closes the sheet, nothing recorded (stage 2, goods task list, P0-4)", async ({
  page,
}) => {
  const { main, buzzes, pressMain, pressBack } = await telegram(page);
  const away = aUnit("Чужа", "M", "INSPECTING", 1, {
    back_to_sold_from: false,
    sold_from_location_id: "00000000-0000-4000-8000-500000000001",
    sold_from_location_name: "Свій склад Ринку",
    status_by: "Оля",
  });
  let shown: unknown[] = [away];
  await bin(page, () => shown);
  const sent: unknown[] = [];
  await page.route(
    "**/api/v1/damaged-units/*/return-to-sale",
    async (route) => {
      sent.push(route.request().postDataJSON());
      shown = [];
      await route.fulfill({ json: { ...away, status: "RETURNED" } });
    },
  );
  await open(page, "8.0");
  const unit = units(page, "Чужа");
  await unit.getByRole("button", { name: "Вирішити" }).click();
  let sheet = await sheetOf(page, "Чужа");
  // Two decisions, no yes yet.
  await expect
    .poll(
      async () =>
        ((await main()) as { is_visible?: boolean } | null)?.is_visible ??
        false,
    )
    .toBe(false);
  await pressBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(unit.getByRole("button", { name: "Вирішити" })).toBeFocused();

  await unit.getByRole("button", { name: "Вирішити" }).click();
  sheet = await sheetOf(page, "Чужа");
  await sheet.getByRole("button", { name: "Повернути в продаж" }).click();
  await expect(sheet).toContainText(
    "Його продали з власного складу іншого магазину. Оберіть склад вашого магазину.",
  );
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Оберіть склад",
  });
  // Telegram's, never one of the sheet's own.
  await expect(sheet.locator(".main-mimic")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  const places = sheet.getByRole("group", { name: "Склад вашого магазину" });
  await expect(
    places.getByRole("button", { name: "Брак", exact: true }),
  ).toHaveCount(0);
  await places
    .getByRole("button", { name: "Склад повернень", exact: true })
    .click();
  await expect(
    places.getByRole("button", { name: "Склад повернень", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Так, повернути на «Склад повернень»",
  });
  await pressMain();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent).toEqual([
    { destination_location_id: fixture.returns_location_id },
  ]);
  await expect(said(page)).toHaveText(
    "Повернули в продаж: Чужа · M → «Склад повернень»",
  );
  expect(await buzzes()).toContainEqual({
    type: "notification",
    notification_type: "success",
  });
  await expect
    .poll(
      async () =>
        ((await main()) as { is_visible?: boolean } | null)?.is_visible ??
        false,
    )
    .toBe(false);
});

test("the «Брак» section needs its own permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "damaged:handle",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  // «Ще» › «Товар» without its row, the others as they are (navigation task
  // list, P0-3; «Усе на бірці» task list, P0-4).
  await more(page);
  const goods = page.getByRole("navigation", { name: "Ще" });
  await expect(
    goods.getByRole("button", { name: "Прийшов товар", exact: true }),
  ).toBeVisible();
  await expect(
    goods.getByRole("button", { name: "Інвентаризація", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Брак/ })).toHaveCount(0);
});

test("the stock screen shows «Брак»: what lies there, no price and nothing to sell (stage 2, goods task list, P2-5)", async ({
  page,
}) => {
  await damaged(page, 1);
  // «Залишки» is for whoever reads the stock with no till («Усе на бірці»
  // sections task list, P0-6): the seed's «Оля» without hers.
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => p !== "sale:create");
    await route.fulfill({ response, json: body });
  });
  // Every model priced, so that «no price» is the screen's and not the
  // seed's: the damaged one has none of its own.
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { suggested_price: string | null }[];
    };
    for (const item of body.items) item.suggested_price = "1500.00";
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Залишки");
  await page
    .getByRole("group", { name: "Склад", exact: true })
    .getByRole("button", { name: "Брак", exact: true })
    .click();
  await expect(
    page.getByText("Змінюється лише через розділ «Брак».", {
      exact: false,
    }),
  ).toBeVisible();
  // Its models as tags (stage 2, goods task list, P2-5): what lies there,
  // in pieces, nothing to sell.
  await expect(page.locator(".stock-tag").first()).toBeVisible();
  await expect(
    page.locator(".stock-tag .size-cell .visually-hidden").first(),
  ).toHaveText(/, \d+ шт\./);
  await expect(page.locator(".stock-free")).toHaveCount(0);
  // Nothing in «Брак» is for sale, so it shows no price.
  await expect(page.locator(".stock-tag .model-price")).toHaveCount(0);
});
