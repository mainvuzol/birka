import {
  test,
  expect,
  countTaps,
  expectStub,
  menu,
  more,
  openStore,
  refuseOnce,
  section,
  sections,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Store states (owner decisions, 2026-10-01): the owner of the network
 * blocks a store, archives one that stopped trading and opens either again,
 * from the app, saying why. A store that does not trade does nothing: the
 * owner reads it, its own people see only that it is blocked, and its
 * customers' debts are paid at a store that trades. Only an empty store is
 * archived.
 *
 * A network of its own, so that blocking a store stops nothing another
 * journey sells in: «Центр» (Ганна), «Ринок» (Петро), and «Старий», archived.
 */
interface Fixture {
  network_owner_telegram_user_id: string;
  network_centre_seller_telegram_user_id: string;
  network_market_seller_telegram_user_id: string;
  network_centre_store_id: string;
  network_market_store_id: string;
  network_old_store_id: string;
  network_shared_location_id: string;
  network_market_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const owner = fixture.network_owner_telegram_user_id;
const hanna = fixture.network_centre_seller_telegram_user_id;
const petro = fixture.network_market_seller_telegram_user_id;

function initData(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Тест"}`,
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

/** The app, opened from Telegram 8.0 by this person: its «Назад», its
 * buzzes and its MainButton are Telegram's — or, `outside`, from a Telegram
 * too old for them, the MainButton the page's own dock. */
async function openAs(
  page: Page,
  telegramUserId: string,
  {
    theme,
    outside = false,
  }: { theme?: Record<string, string>; outside?: boolean } = {},
): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  const hash = new URLSearchParams({ tgWebAppData: initData(telegramUserId) });
  if (!outside) hash.set("tgWebAppVersion", "8.0");
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  await page.goto(`/#${hash.toString()}`);
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

/** What the app tells Telegram: its buzzes. */
async function hearBuzzes(page: Page): Promise<() => Promise<unknown[]>> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
    };
    host.buzzes = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
      },
    };
  });
  return () =>
    page.evaluate(() =>
      (window as unknown as { buzzes: string[] }).buzzes.map(
        (data) => JSON.parse(data) as unknown,
      ),
    );
}

async function tokenOf(page: Page, telegramUserId: string): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId) },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

interface StoreRecord {
  id: string;
  state: "ACTIVE" | "BLOCKED" | "ARCHIVED";
}

/** Put a store in a state through the API, whatever state a journey left it in. */
async function settle(
  page: Page,
  store: string,
  state: StoreRecord["state"],
): Promise<void> {
  const headers = { Authorization: `Bearer ${await tokenOf(page, owner)}` };
  const stores = (await (
    await page.request.get("/api/v1/stores", { headers })
  ).json()) as StoreRecord[];
  if (stores.find((s) => s.id === store)?.state === state) return;
  const changed = await page.request.post(`/api/v1/stores/${store}/state`, {
    headers,
    data: { command_id: randomUUID(), state, reason: "підготовка тесту" },
  });
  expect(changed.status()).toBe(200);
}

function posts(
  page: Page,
  ending: string,
): { bodies: unknown[]; keys: string[] } {
  const seen = { bodies: [] as unknown[], keys: [] as string[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith(ending)) {
      seen.bodies.push(request.postDataJSON());
      seen.keys.push(request.headers()["idempotency-key"] ?? "");
    }
  });
  return seen;
}

/** A coat received by Петро at «Ринок» into `warehouse`. */
async function received(
  page: Page,
  warehouse: string,
  quantity: number,
): Promise<{ variant: string; size: string; headers: Record<string, string> }> {
  const headers = { Authorization: `Bearer ${await tokenOf(page, petro)}` };
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_market_store_id,
      concept: `Ринкове ${randomUUID().slice(0, 8)}`,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const size = product.sizes[0]?.size_id ?? "";
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_market_store_id,
      location_id: warehouse,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: size,
          quantity,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(receipt.status()).toBe(201);
  return { variant: product.product_variant_id, size, headers };
}

/** A coat sold at «Ринок» and handed back damaged there, into its «Брак». */
async function damagedAtTheMarket(page: Page): Promise<void> {
  const coat = await received(page, fixture.network_shared_location_id, 1);
  const sold = await page.request.post("/api/v1/sales", {
    headers: { ...coat.headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_market_store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          source_location_id: fixture.network_shared_location_id,
          quantity: 1,
          unit_price: "2000.00",
        },
      ],
      payment_method: "CASH",
    },
  });
  expect(sold.status()).toBe(201);
  const sale = (await sold.json()) as { id: string; items: { id: string }[] };
  const back = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers: { ...coat.headers, "Idempotency-Key": randomUUID() },
    data: {
      command_id: randomUUID(),
      lines: [
        {
          sale_item_id: sale.items[0]?.id,
          quantity: 1,
          restock: true,
          condition: "DAMAGED",
        },
      ],
      payment_method: "CASH",
    },
  });
  expect(back.status()).toBe(201);
}

/** The app's keypad: the digits of a sum. */
async function keyIn(page: Page, sum: string): Promise<void> {
  for (const one of sum)
    await page
      .locator(".keypad")
      .getByRole("button", { name: one, exact: true })
      .click();
}

/** A store's own screen (stage 2, admin task list, P0-3). */
function card(page: Page, name: string) {
  return page.getByRole("article", { name: `Магазин ${name}` });
}

/** A store's tag on «Магазини», as a reader hears it: its name, and its
 * state with since when while it does not trade. */
function storeTag(page: Page, name: string): Locator {
  return page.getByRole("button", {
    name: new RegExp(`^Магазин ${name}(, |$)`),
  });
}

/** A store's own screen, opened by its tag: its name takes the cursor. */
async function storeScreen(page: Page, name: string): Promise<Locator> {
  await storeTag(page, name).click();
  const screen = card(page, name);
  await expect(
    screen.getByRole("heading", { name, exact: true, level: 1 }),
  ).toBeFocused();
  return screen;
}

/** The question a state's button asks (P0-4), once it takes taps. */
async function stateSheet(page: Page, title: string): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

async function storesSection(page: Page): Promise<void> {
  await openAs(page, owner);
  await openStore(page, "Центр CENTRE");
  await section(page, "Магазини");
}

test("the owner blocks a store; its seller sees only that, and the owner reads it", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "ACTIVE");
  await damagedAtTheMarket(page);
  const changes = posts(page, "/state");
  const buzzes = await hearBuzzes(page);
  await storesSection(page);
  // Nothing to press on the list but a store's tag: its state's buttons
  // are on its own screen (stage 2, admin task list, P0-3).
  await expect(page.getByRole("button", { name: "Заблокувати" })).toHaveCount(
    0,
  );
  const market = await storeScreen(page, "Ринок");
  await market.getByRole("button", { name: "Заблокувати" }).click();
  // Asked in a sheet, a reason needed: what follows, and who reads the
  // reason under its field (P0-4).
  const sheet = await stateSheet(page, "Заблокувати «Ринок»?");
  const yes = sheet.getByRole("button", { name: "Так, заблокувати «Ринок»" });
  // Never without a reason.
  await expect(yes).toBeDisabled();
  await expect(sheet).toContainText(
    "Борги його покупців приймає будь-який магазин, що працює.",
  );
  const why = sheet.getByLabel(/^Причина/);
  await expect(why).toHaveAccessibleDescription(
    "Її бачите ви й менеджери мережі, не продавці.",
  );
  await why.fill("Ревізія каси");
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25) — in the same sheet,
  // the reason kept.
  await refuseOnce(page, "**/api/v1/stores/*/state", 409);
  await yes.click();
  await expect(sheet.getByRole("alert")).toHaveText(
    "Стан магазину не змінено: його змінили — перегляньте його й спробуйте ще раз.",
  );
  // The cursor on why, in the sheet: the button it was on was held
  // (review, 2026-11-07). Felt as an error (spec §4.4).
  await expect(sheet.getByRole("alert")).toBeFocused();
  expect(await buzzes()).toContainEqual({
    type: "notification",
    notification_type: "error",
  });
  await expect(why).toHaveValue("Ревізія каси");
  // While the change is sent, no way out: Telegram's «Назад» and
  // «Скасувати» are held, its answer is said here (navigation task list,
  // P0-4; review, 2026-10-26).
  let letGo: () => void = () => undefined;
  const sending = new Promise<void>((done) => {
    letGo = done;
  });
  await page.route("**/api/v1/stores/*/state", async (route) => {
    await sending;
    await route.fallback();
  });
  await yes.click();
  await expect(sheet.getByRole("button", { name: "Скасувати" })).toBeDisabled();
  await pressBack(page);
  // A frame for a close to be drawn, were it one.
  await page.evaluate(
    () => new Promise((drawn) => requestAnimationFrame(drawn)),
  );
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Скасувати" })).toBeDisabled();
  // Its answer said at once, the list read again meanwhile and never
  // waited for: the button is never there to be pressed twice (review,
  // 2026-11-07).
  let readBack: () => void = () => undefined;
  const reading = new Promise<void>((done) => {
    readBack = done;
  });
  await page.route("**/api/v1/stores", async (route) => {
    if (route.request().method() === "GET") await reading;
    await route.fallback();
  });
  letGo();
  // Recorded: the sheet gone, the stub torn off on the store's screen —
  // what, at what time and why, the cursor on it — and its sticker
  // changed.
  await expect(sheet).toHaveCount(0);
  const stub = market.locator(".stub-recorded");
  await expect(stub.locator("p").first()).toHaveText("«Ринок»: заблоковано.");
  await expect(stub.locator(".t-meta")).toHaveText(
    /^\d{2}:\d{2} · Причина: Ревізія каси$/,
  );
  await expect(market.locator(".stores-notices")).toBeFocused();
  expect(await buzzes()).toContainEqual({
    type: "notification",
    notification_type: "success",
  });
  readBack();
  await expect(market.locator(".store-tag-state")).toHaveText(
    /^Заблоковано з \d{2}\.\d{2}$/,
  );
  await expect(
    market.getByText("Причина: Ревізія каси", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Назад до магазинів" }),
  ).toBeEnabled();
  // The one refused above, then the same change as a new command.
  expect(changes.bodies).toHaveLength(2);
  expect({
    ...(changes.bodies[0] as object),
    command_id: null,
  }).toEqual({ ...(changes.bodies[1] as object), command_id: null });
  expect(changes.bodies.slice(1)).toEqual([
    {
      command_id: expect.any(String) as string,
      state: "BLOCKED",
      reason: "Ревізія каси",
    },
  ]);

  // Петро sees that it is blocked, and since when — never why.
  await openAs(page, petro);
  // His one store opens straight on its state (redesign P0-1).
  // One blank tag: the state and since when its title, one line, «Спробувати
  // ще раз» (spec S08; stage 2, admin task list, P1-1).
  const tag = page.locator(".blank-tag");
  await expect(
    tag.getByRole("heading", {
      name: /^Магазин заблоковано власником з \d{2}\.\d{2}\.\d{4}$/,
    }),
  ).toBeVisible();
  await expect(tag.getByRole("status")).toHaveText(
    "Продажі, приймання, повернення й оплати тут зупинено. Зверніться до власника.",
  );
  await expect(
    tag.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
  // The line over it, as on any screen of a store.
  await expect(page.locator(".store-line")).toContainText("Ринок");
  // Said as a status, never a refusal's plate (stage 2, orders task list,
  // P0-2).
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".banner-blocked")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Оновити" })).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByText(/Ревізія/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toHaveCount(0);

  // The owner reads it, and nothing else.
  await openAs(page, owner);
  await openStore(page, /^Ринок MARKET/);
  await expect(page.getByText(/Лише перегляд/)).toBeVisible();
  await more(page);
  for (const name of [
    "Продаж",
    "Повернення",
    "Повернути",
    "Перевірка каталогу",
    "Початкові залишки",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  // «Ще» › «Товар» without «Прийшов товар»: nothing is received here;
  // «Брак» and «Залишки» read (navigation task list, P0-3; «Усе на бірці»
  // task list, P0-4).
  const goods = page.getByRole("navigation", { name: "Ще" });
  await expect(goods.getByRole("button", { name: /^Брак( |$)/ })).toBeVisible();
  await expect(
    goods.getByRole("button", { name: "Залишки", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Прийшов товар/ }),
  ).toHaveCount(0);
  await section(page, "Покупці");
  // The store's own notice says it does not trade; «Покупці» says who
  // takes the payments, once (credits task list, P0-1).
  await expect(
    page.getByText("Внески приймає будь-який магазин мережі, що працює.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/лише для перегляду/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Борг магазину, що зараз не працює\?/ }),
  ).toHaveCount(0);
  // The server silent over a store that does not trade: no paper banner —
  // nothing is sold here, on paper or not — and the place not read says
  // only «Сервер не відповідає.» (stage 2, orders task list, P0-3; review,
  // 2026-11-05).
  // Every call unanswered, so no other read says the server is back.
  await page.route("**/api/v1/**", (route) => route.abort("connectionfailed"));
  await section(page, "Замовлення");
  const unread = page.locator(".read-failure");
  await expect(unread.locator("p")).toHaveText("Сервер не відповідає.");
  await expect(
    page.getByRole("status", { name: "Сервер не відповідає" }),
  ).toHaveCount(0);
  await expect(page.getByText(/Продавайте на папері/)).toHaveCount(0);
  await page.unroute("**/api/v1/**");
  await unread.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(unread).toHaveCount(0);
  // Its orders read, none made: no «+» in «Замовлення»'s heading
  // (navigation task list, P0-2).
  await expect(
    page
      .locator(".screen-title")
      .getByRole("button", { name: "Нове замовлення" }),
  ).toHaveCount(0);
  // «Брак» is shown as it stands, with nothing to press.
  await section(page, "Брак");
  await expect(page.getByText(/тут лише перегляд/)).toBeVisible();
  await expect(
    page.locator(".damaged-unit[data-status=AWAITING]").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Взяти на перевірку" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Вирішити" })).toHaveCount(0);

  // Unblocked, Петро works as before.
  await section(page, "Магазини");
  const blocked = await storeScreen(page, "Ринок");
  await blocked.getByRole("button", { name: "Розблокувати" }).click();
  const unblock = await stateSheet(page, "Розблокувати «Ринок»?");
  // Nothing of debts: the store takes its own again.
  await expect(unblock).not.toContainText("Борги його покупців");
  await unblock.getByLabel(/^Причина/).fill("Ревізію завершено");
  await unblock
    .getByRole("button", { name: "Так, магазин працює «Ринок»" })
    .click();
  await expect(blocked.locator(".stub-recorded")).toContainText(
    "«Ринок»: працює.",
  );
  await expect(blocked.locator(".store-tag-state")).toHaveCount(0);
  await expect(page.getByText(/Лише перегляд/)).toHaveCount(0);
  await openAs(page, petro);
  await openStore(page, /^Ринок MARKET/);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeVisible();
  // The stores' states are the network owner's alone.
  await more(page);
  await expect(
    page.getByRole("button", { name: "Магазини", exact: true }),
  ).toHaveCount(0);
});

test("a debt of a blocked store is found by the whole phone and paid at a store that trades", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "ACTIVE");
  const coat = await received(page, fixture.network_shared_location_id, 1);
  const name = `Боржник ${randomUUID().slice(0, 8)}`;
  const phone = `067${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
  const sold = await page.request.post("/api/v1/sales", {
    headers: { ...coat.headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_market_store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          source_location_id: fixture.network_shared_location_id,
          quantity: 1,
          unit_price: "3000.00",
        },
      ],
      credit: {
        customer_name: name,
        customer_phone: phone,
        paid_now: "1000.00",
      },
      payment_method: "CASH",
    },
  });
  expect(sold.status()).toBe(201);
  await settle(page, fixture.network_market_store_id, "BLOCKED");
  try {
    const searches: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/credits/customers?"))
        searches.push(request.url());
    });
    const payments = posts(page, "/payments");
    // «Внесок» the dock's button.
    await openAs(page, hanna, { outside: true });
    await openStore(page, "Центр CENTRE");
    await section(page, "Покупці");
    // The store's own list: never another's.
    // The closed stores are asked for only by a whole number, under this
    // store's results for it: never a choice made first (owner decision,
    // 2026-10-18, В2 (а); credits task list, P1-1).
    const ask = page.getByRole("button", {
      name: "Борг магазину, що зараз не працює? Шукати за цим номером",
    });
    const search = page.getByLabel("Ім’я або телефон");
    await expect(ask).toHaveCount(0);
    // Neither a name nor a part of the number, typed or entered.
    for (const partial of [name, phone.slice(0, 9)]) {
      await search.fill(partial);
      await search.press("Enter");
      await expect(page.getByText(/боргів не знайдено/)).toBeVisible();
      await expect(ask).toHaveCount(0);
    }
    // Past the pause a search waits for, still nothing asked of them.
    await page.waitForTimeout(500);
    expect(searches.filter((url) => url.includes("elsewhere=true"))).toEqual(
      [],
    );
    // The whole number, pasted from the phone's contacts between the two
    // invisible direction marks they add: owed nothing here, the rule said,
    // and the closed stores asked for under it.
    await search.fill(`\u202a+38 ${phone.slice(0, 3)} ${phone.slice(3)}\u202c`);
    await expect(
      page.getByText(
        "За цим номером у цьому магазині боргів немає. Внесок приймає магазин, де продали.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(searches.filter((url) => url.includes("elsewhere=true"))).toEqual(
      [],
    );
    await ask.click();
    // Brought to what it opened: the tapped button is gone (review,
    // 2026-10-19).
    await expect(
      page.getByRole("heading", { name: "Магазини, що не працюють" }),
    ).toBeFocused();
    // Only what is still owed, so nothing to choose (owner, 2026-10-10).
    await expect(
      page.getByRole("group", { name: "Які борги показати" }),
    ).toHaveCount(0);
    const found = page.getByRole("button", { name: `Відкрити борг: ${name},` });
    await expect(found).toContainText("Магазин «Ринок»");
    const asked = searches.filter((url) => url.includes("elsewhere=true"));
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked)
      expect(new URL(url).searchParams.get("status")).toBe("OPEN");
    // Changed there into a part of a number: asked for the whole one, and
    // not asked of them.
    await search.fill(phone.slice(0, 6));
    await expect(
      page.getByText(
        /Введіть повний номер телефону покупця, наприклад 067 123 45 67/,
      ),
    ).toBeVisible();
    await page.waitForTimeout(500);
    expect(
      searches.filter((url) => url.includes("elsewhere=true")),
    ).toHaveLength(asked.length);
    // Back here, the number kept; and again among them.
    await search.fill(phone);
    await expect(found).toBeVisible();
    await page.getByRole("button", { name: "У цьому магазині" }).click();
    await expect(
      page.getByRole("heading", { name: "Покупці", exact: true }),
    ).toBeFocused();
    await expect(search).toHaveValue(phone);
    await expect(
      page.getByText(/^За цим номером у цьому магазині боргів немає/),
    ).toBeVisible();
    await ask.click();
    // Her card, the closed store's debt on it, and its «Внесок» here
    // (spec S20, S21).
    await found.click();
    await page.getByRole("button", { name: "Внесок", exact: true }).click();
    await expect(
      page.getByText(
        "Продано в «Ринок» (заблоковано). Внесок приймаєте ви, борг — за «Ринок».",
        { exact: true },
      ),
    ).toBeVisible();
    await keyIn(page, "500");
    // Paid by card at «Центр»: its terminal takes it (ADR-0012 §B7 G).
    await page
      .getByRole("group", { name: "Внесок", exact: true })
      .getByRole("button", { name: "Картка" })
      .click();
    const paid = page.locator(".paid-result");
    await expectStub(paid, { way: "Картка", say: "Проведіть на терміналі" });
    await expect(paid.locator(".paid-owed")).toHaveText(
      "Залишок боргу 1 500,00 грн",
    );
    await expect(
      page.getByText(
        "Внесок 500,00 грн прийнято карткою. Залишок боргу 1 500,00 грн.",
      ),
    ).toBeAttached();
    expect(payments.bodies).toEqual([
      {
        command_id: expect.any(String) as string,
        amount: "500.00",
        payment_method: "CARD",
        store_id: fixture.network_centre_store_id,
      },
    ]);
    await page
      .getByRole("button", { name: "Відкрити борг", exact: true })
      .click();
    await page.getByRole("button", { name: /^Історія · \d+/ }).click();
    await expect(
      page.getByRole("list", { name: "Історія боргу" }),
    ).toContainText("прийняв магазин «Центр»");
    await expect(
      page.getByRole("list", { name: "Історія боргу" }),
    ).toContainText("Внесок · картка");

    // In the blocked store itself the owner reads the debt: no payment is
    // taken there, and the network's owner may still write it off. Outside
    // Telegram, so that no «Внесок» means no dock's button either.
    await openAs(page, owner, { outside: true });
    await openStore(page, /^Ринок MARKET/);
    await section(page, "Покупці");
    // Its whole number: the debt here, and never the closed stores asked
    // for — this store takes no payments (credits task list, P1-1).
    // Once this store has answered for the number itself, not the list
    // as it opened, which shows the debt too. Its block is the first; the
    // owner's other stores that trade have their own.
    const market = page.getByRole("region", { name: "Магазину «Ринок» винні" });
    const answered = page.waitForResponse((response) => {
      if (!response.url().includes("/credits/customers?")) return false;
      const asked = new URL(response.url()).searchParams;
      return (
        asked.get("query") === phone &&
        asked.get("store_id") === fixture.network_market_store_id
      );
    });
    await page.getByLabel("Ім’я або телефон").fill(phone);
    await answered;
    await expect(
      market.getByRole("button", { name: `Відкрити борг: ${name},` }),
    ).toBeVisible();
    await page.waitForTimeout(300);
    expect(
      await page
        .getByRole("button", { name: /^Борг магазину, що зараз не працює\?/ })
        .count(),
    ).toBe(0);
    // A whole number owing nothing here: the fact alone, as anyone trading
    // takes the payment (review, 2026-10-19) — among blocks, each says it
    // found no one.
    await page.getByLabel("Ім’я або телефон").fill(`099${phone.slice(3)}`);
    await expect(market.getByText("Нікого не знайдено.")).toBeVisible();
    await page.getByLabel("Ім’я або телефон").fill(name);
    await market
      .getByRole("button", { name: `Відкрити борг: ${name},` })
      .click();
    // Her card: what is owed here, no «Внесок», and the owner's ⋯ with its
    // write-off (spec S20).
    const owed = page.getByRole("region", { name: "Магазину «Ринок» винні" });
    await expect(owed.locator(".owed-sum")).toHaveText("1 500,00 грн");
    await expect(
      page.getByRole("button", { name: "Внесок", exact: true }),
    ).toHaveCount(0);
    await owed.getByRole("button", { name: "Дії з боргом" }).click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Списати борг" }),
    ).toBeVisible();
  } finally {
    await settle(page, fixture.network_market_store_id, "ACTIVE");
  }
});

test("a change made meanwhile elsewhere is refused as done already: said in the sheet, felt as an error, and its «Так» dark once the store is read again (stage 2, admin task list, P0-4)", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "ACTIVE");
  try {
    const buzzes = await hearBuzzes(page);
    await storesSection(page);
    const market = await storeScreen(page, "Ринок");
    await market.getByRole("button", { name: "Заблокувати" }).click();
    const sheet = await stateSheet(page, "Заблокувати «Ринок»?");
    await sheet.getByLabel(/^Причина/).fill("Перевірка");
    // Blocked meanwhile from another phone.
    await settle(page, fixture.network_market_store_id, "BLOCKED");
    const yes = sheet.getByRole("button", { name: "Так, заблокувати «Ринок»" });
    await yes.click();
    await expect(sheet.getByRole("alert")).toHaveText(
      "Магазин уже в цьому стані. Список оновлено.",
    );
    expect(await buzzes()).toContainEqual({
      type: "notification",
      notification_type: "error",
    });
    // Nothing more to send from this question, the reason typed or not.
    await expect(yes).toBeDisabled();
    await expect(sheet.getByLabel(/^Причина/)).toHaveValue("Перевірка");
    await sheet.getByRole("button", { name: "Скасувати" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(market.locator(".store-tag-state")).toHaveText(
      /^Заблоковано з \d{2}\.\d{2}$/,
    );
  } finally {
    await settle(page, fixture.network_market_store_id, "ACTIVE");
  }
});

test("only an empty store is archived: Telegram's «Назад» closes the question while nothing is sent, and the refusal, felt as a warning, says what is left in the same sheet (stage 2, admin task list, P0-4)", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "ACTIVE");
  await received(page, fixture.network_market_location_id, 2);
  const buzzes = await hearBuzzes(page);
  await storesSection(page);
  const market = await storeScreen(page, "Ринок");
  const archive = market.getByRole("button", { name: "Закрити в архів" });
  await archive.click();
  let sheet = await stateSheet(page, "Закрити «Ринок» в архів?");
  await expect(
    sheet.getByText(/^Закрити можна лише порожній магазин/),
  ).toBeVisible();
  await expect(sheet).toContainText(
    "Борги його покупців приймає будь-який магазин, що працює.",
  );
  // Nothing sent: Telegram's «Назад» closes it, the cursor back where it was.
  await pressBack(page);
  await expect(sheet).toHaveCount(0);
  await expect(archive).toBeFocused();
  await archive.click();
  sheet = await stateSheet(page, "Закрити «Ринок» в архів?");
  await sheet.getByLabel(/^Причина/).fill("Закриваємо ринок");
  await sheet
    .getByRole("button", { name: "Так, закрити в архів «Ринок»" })
    .click();
  await expect(sheet.getByRole("alert")).toContainText(
    "Закрити в архів можна лише порожній магазин.",
  );
  // What is left a line each, in «шт.».
  await expect(
    sheet.getByRole("list", { name: "Що лишилось у магазині" }),
  ).toContainText(/Власний склад «Склад ринку» · \d+ шт\./);
  await expect(sheet).not.toContainText(/од\./);
  expect(await buzzes()).toContainEqual({
    type: "notification",
    notification_type: "warning",
  });
  await sheet.getByRole("button", { name: "Скасувати" }).click();
  await expect(sheet).toHaveCount(0);
  // Still trading: no sticker.
  await expect(market.locator(".store-tag-state")).toHaveCount(0);
});

test("an archived store opens again, and is archived again once empty", async ({
  page,
}) => {
  await settle(page, fixture.network_old_store_id, "ARCHIVED");
  await storesSection(page);
  // On the list, its sticker says since when (P0-3).
  await expect(storeTag(page, "Старий")).toHaveAccessibleName(
    /^Магазин Старий, В архіві з \d{2}\.\d{2}$/,
  );
  await expect(storeTag(page, "Старий").locator(".store-tag-state")).toHaveText(
    /^В архіві з \d{2}\.\d{2}$/,
  );
  const old = await storeScreen(page, "Старий");
  // An archived store opens to trade; it is never blocked.
  await expect(old.getByRole("button", { name: "Заблокувати" })).toHaveCount(0);
  await old.getByRole("button", { name: "Відкрити знову" }).click();
  const reopen = await stateSheet(page, "Відкрити «Старий» знову?");
  await reopen.getByLabel(/^Причина/).fill("Відкриваємось");
  await reopen
    .getByRole("button", { name: "Так, магазин працює «Старий»" })
    .click();
  await expect(old.locator(".stub-recorded")).toContainText(
    "«Старий»: працює.",
  );
  await expect(old.locator(".store-tag-state")).toHaveCount(0);

  await old.getByRole("button", { name: "Закрити в архів" }).click();
  const close = await stateSheet(page, "Закрити «Старий» в архів?");
  await close.getByLabel(/^Причина/).fill("Знову закрили");
  await close
    .getByRole("button", { name: "Так, закрити в архів «Старий»" })
    .click();
  await expect(old.locator(".stub-recorded")).toContainText(
    "«Старий»: в архіві.",
  );
  await expect(old.locator(".store-tag-state")).toHaveText(
    /^В архіві з \d{2}\.\d{2}$/,
  );
  // Its history a thread, newest first, never folded; every change a knot.
  const history = old.getByRole("list", { name: "Історія: Старий" });
  await expect(history.locator("li").first()).toContainText(
    "Працює → В архіві",
  );
  await expect(history.locator("li").first()).toContainText("Знову закрили");
  await expect(history.locator("li").nth(1)).toContainText("В архіві → Працює");
  await expect(history.locator(".timeline-node.knot")).toHaveCount(
    await history.locator("li").count(),
  );
  await expect(page.locator("details")).toHaveCount(0);
});

test("a change whose answer is lost is resent unchanged, and done once", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "ACTIVE");
  const changes = posts(page, "/state");
  let first = true;
  await page.route("**/api/v1/stores/*/state", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  try {
    await storesSection(page);
    const market = await storeScreen(page, "Ринок");
    await market.getByRole("button", { name: "Заблокувати" }).click();
    const sheet = await stateSheet(page, "Заблокувати «Ринок»?");
    await sheet.getByLabel(/^Причина/).fill("Перевірка");
    await sheet
      .getByRole("button", { name: "Так, заблокувати «Ринок»" })
      .click();
    // Its answer lost: the sheet gone, the stub still attached on the
    // store's screen — «Ще не підтверджено», since when, the same change
    // checked by its own button (stage 2, admin task list, P0-4).
    await expect(sheet).toHaveCount(0);
    const kept = market.locator(".stub-kept");
    await expect(
      kept.getByRole("heading", { name: "Незавершена зміна стану" }),
    ).toBeVisible();
    await expect(kept).toContainText("Ще не підтверджено");
    await expect(kept).toContainText(/Чекає відповіді сервера з \d{2}:\d{2}\./);
    // No answer says nothing more than the stub: never the error's own
    // name (review, 2026-11-07). The cursor on it.
    await expect(market.getByRole("alert")).toHaveCount(0);
    await expect(kept).not.toContainText("UNREACHABLE");
    await expect(market.locator(".stores-notices")).toBeFocused();
    await expect(
      market.getByRole("button", { name: "Заблокувати" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Замовлення", exact: true }),
    ).toBeDisabled();
    // On the list too: it is the section's.
    await page.getByRole("button", { name: "Назад до магазинів" }).click();
    await expect(
      page.locator(".stub-kept").getByRole("heading", {
        name: "Незавершена зміна стану",
      }),
    ).toBeVisible();
    // Its own section stays open under «Ще», every other is held (P1-6).
    await more(page);
    await expect(
      sections(page).getByRole("button", { name: "Магазини", exact: true }),
    ).toBeEnabled();
    await expect(
      sections(page).getByRole("button", {
        name: "Інвентаризація",
        exact: true,
      }),
    ).toBeDisabled();
    // Written down before it was sent: a reload still knows what to ask about.
    await page.reload();
    await openStore(page, "Центр CENTRE");
    await expect(
      page.locator(".stub-kept").getByRole("heading", {
        name: "Незавершена зміна стану",
      }),
    ).toBeVisible();
    // Checked, and answered with no proof: still kept, said why in the
    // shared words — never a manager to ask, its reader the owner (review,
    // 2026-11-07).
    await refuseOnce(page, "**/api/v1/stores/*/state", 409);
    await page.getByRole("button", { name: "Перевірити результат" }).click();
    await expect(page.locator(".stub-kept")).toContainText(
      "Зміну стану ще не підтверджено: сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі вона не виконається.",
    );
    await expect(page.locator(".stub-kept")).not.toContainText("менеджер");
    await expect(page.locator(".stores-notices")).toBeFocused();
    await page.getByRole("button", { name: "Перевірити результат" }).click();
    // Answered: the stub torn off — what, when and why.
    const settled = page.locator(".stub-recorded");
    await expect(settled.locator("p").first()).toHaveText(
      "«Ринок»: заблоковано.",
    );
    await expect(settled.locator(".t-meta")).toHaveText(
      /^\d{2}:\d{2} · Причина: Перевірка$/,
    );
    await expect(page.locator(".stub-kept")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Замовлення", exact: true }),
    ).toBeEnabled();
    expect(changes.bodies).toHaveLength(3);
    expect(changes.bodies[1]).toEqual(changes.bodies[0]);
    expect(changes.bodies[2]).toEqual(changes.bodies[0]);
    expect(changes.keys[1]).toBe(changes.keys[0]);
    const headers = { Authorization: `Bearer ${await tokenOf(page, owner)}` };
    const stores = (await (
      await page.request.get("/api/v1/stores", { headers })
    ).json()) as (StoreRecord & { changes: unknown[] })[];
    const record = stores.find((s) => s.id === fixture.network_market_store_id);
    expect(record?.state).toBe("BLOCKED");
  } finally {
    await settle(page, fixture.network_market_store_id, "ACTIVE");
  }
});

test("«Магазини» are the door's tags, a store's own screen two taps from «Ще»: Telegram's «Назад» to the list and on to «Ще», a tag's tap felt, its history a thread (stage 2, admin task list, P0-3, В-А3 (а))", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "BLOCKED");
  try {
    const buzzes = await hearBuzzes(page);
    await openAs(page, owner);
    await openStore(page, "Центр CENTRE");
    await more(page);
    const taps = await countTaps(page);
    await sections(page)
      .getByRole("button", { name: "Магазини", exact: true })
      .click();
    // No hint over them: its facts are the sheet's now (P0-4).
    await expect(page.getByText(/нічого не робить: ні продажів/)).toHaveCount(
      0,
    );
    // A tag a store, the order the server's; its code under its name, a
    // store that does not trade with its state and since when.
    await expect(storeTag(page, "Старий")).toBeVisible();
    expect(
      await page.locator(".stores-list > .store-tag").count(),
    ).toBeGreaterThanOrEqual(3);
    await expect(storeTag(page, "Центр")).toHaveAccessibleName("Магазин Центр");
    await expect(storeTag(page, "Ринок")).toHaveAccessibleName(
      /^Магазин Ринок, Заблоковано з \d{2}\.\d{2}$/,
    );
    await expect(storeTag(page, "Ринок").locator(".store-tag-code")).toHaveText(
      "MARKET",
    );
    // The tag's own buzz, not «Ще»'s before it.
    const heard = (await buzzes()).length;
    await storeTag(page, "Ринок").click();
    const market = card(page, "Ринок");
    // Its ways at its foot, under the thread (P0-3: «Зона действия внизу»).
    await expect(
      market.getByRole("button", { name: "Розблокувати" }),
    ).toBeVisible();
    // «Магазини», then the store's tag.
    expect(await taps()).toBe(2);
    await expect(
      market.getByRole("heading", { name: "Ринок", exact: true, level: 1 }),
    ).toBeFocused();
    expect((await buzzes()).slice(heard)).toContainEqual({
      type: "selection_change",
    });
    // Why it does not trade, under its sticker; its history a thread, the
    // newest first, every change recorded, nothing folded.
    await expect(market.locator(".store-hero-why")).toHaveText(/^Причина: /);
    const history = market.getByRole("list", { name: "Історія: Ринок" });
    await expect(history.locator("li").first()).toContainText(
      "Працює → Заблоковано",
    );
    await expect(
      history.locator("li").first().locator(".timeline-node"),
    ).toHaveClass(/knot/);
    await expect(page.locator("details")).toHaveCount(0);
    // Its buttons ordinary ones, never the action's colour; the archive's
    // the quiet one. No MainButton on either screen.
    const accent = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--accent)";
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    for (const name of ["Розблокувати", "Закрити в архів"])
      await expect(market.getByRole("button", { name })).not.toHaveCSS(
        "background-color",
        accent,
      );
    await expect(
      market.getByRole("button", { name: "Закрити в архів" }),
    ).toHaveClass(/quiet/);
    // Telegram's «Назад»: the list, its heading taking the cursor; then «Ще».
    await pressBack(page);
    await expect(
      page.getByRole("heading", { name: "Магазини", exact: true }),
    ).toBeFocused();
    await pressBack(page);
    await expect(
      page.getByRole("heading", { name: "Ще", exact: true }),
    ).toBeVisible();
    // And from the keyboard: a tag is a button like any.
    await sections(page)
      .getByRole("button", { name: "Магазини", exact: true })
      .click();
    await storeTag(page, "Старий").focus();
    await page.keyboard.press("Enter");
    await expect(
      card(page, "Старий").getByRole("heading", { name: "Старий", level: 1 }),
    ).toBeFocused();
  } finally {
    await settle(page, fixture.network_market_store_id, "ACTIVE");
  }
});

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme at 360 × 640 five stores' tags, a store's screen and its question read at 4.5:1, nothing wider than the phone (stage 2, admin task list, P0-3, P0-4)`, async ({
    page,
  }) => {
    await settle(page, fixture.network_market_store_id, "BLOCKED");
    try {
      // Five stores, two of them long-named, as the server would send them.
      await page.route("**/api/v1/stores", async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        const response = await route.fetch();
        const stores = (await response.json()) as object[];
        const more = (storeName: string, code: string) => ({
          id: randomUUID(),
          name: storeName,
          code,
          kind: "SECONDARY",
          state: "ACTIVE",
          state_since: null,
          changes: [],
        });
        await route.fulfill({
          response,
          json: [
            ...stores,
            more(
              "Магазин на Привокзальній площі біля фонтану",
              "STATION-SQUARE",
            ),
            more("Торговий центр «Дафі», третій поверх", "DAFI-3"),
          ],
        });
      });
      await page.setViewportSize({ width: 360, height: 640 });
      await openAs(page, owner, { theme });
      await openStore(page, "Центр CENTRE");
      // At its top, however far down «Ще» its row was — read before, so
      // drawn whole at once, never short while it loads.
      await section(page, "Магазини");
      await expect(storeTag(page, "Ринок")).toBeVisible();
      await more(page);
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await sections(page)
        .getByRole("button", { name: "Магазини", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Магазини", exact: true }),
      ).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      // The two long names last, under the network's own (five at least).
      const tags = page.locator(".stores-list > .store-tag");
      await expect(tags.last()).toHaveAccessibleName(
        "Магазин Торговий центр «Дафі», третій поверх",
      );
      expect(await tags.count()).toBeGreaterThanOrEqual(5);
      const market = storeTag(page, "Ринок");
      for (const part of [
        market.locator(".store-tag-name"),
        market.locator(".store-tag-code"),
        market.locator(".store-tag-state"),
      ])
        expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
      await page.screenshot({
        path: `test-results/stores-${name}.png`,
        fullPage: true,
      });

      const screen = await storeScreen(page, "Ринок");
      for (const part of [
        screen.locator(".store-tag-name"),
        screen.locator(".store-tag-code"),
        screen.locator(".store-tag-state"),
        screen.locator(".store-hero-why"),
        screen.locator(".customer-history-title"),
        screen.locator(".timeline-day").first(),
        screen.locator(".timeline-what").first(),
        screen.locator(".timeline-meta").first(),
        screen.getByRole("button", { name: "Розблокувати" }),
        screen.getByRole("button", { name: "Закрити в архів" }),
      ])
        expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
      await page.screenshot({
        path: `test-results/store-${name}.png`,
        fullPage: true,
      });

      await screen.getByRole("button", { name: "Розблокувати" }).click();
      const sheet = await stateSheet(page, "Розблокувати «Ринок»?");
      // The reason's button in view with its field.
      await expect(
        sheet.getByRole("button", { name: "Так, магазин працює «Ринок»" }),
      ).toBeInViewport();
      for (const part of [
        sheet.locator(".sheet-title"),
        sheet.locator(".sheet-body > p").first(),
        sheet.locator(".store-why-hint"),
        sheet.getByRole("button", { name: "Скасувати" }),
      ])
        expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
      await page.screenshot({ path: `test-results/store-sheet-${name}.png` });
    } finally {
      await settle(page, fixture.network_market_store_id, "ACTIVE");
    }
  });

test("no store to choose: one blank tag, the owner the one to ask, never an administrator (stage 2, admin task list, P2-3)", async ({
  page,
}) => {
  let none = true;
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as object;
    await route.fulfill({
      response,
      json: none ? { ...me, stores: [] } : me,
    });
  });
  await openAs(page, hanna);
  const tag = page.locator(".blank-tag");
  await expect(
    tag.getByRole("heading", { name: "Магазинів поки немає", level: 1 }),
  ).toBeVisible();
  await expect(
    tag.getByText("Зверніться до власника.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/адміністратор/)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Де ви сьогодні?" }),
  ).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  // Added to a store meanwhile: read again, and in.
  none = false;
  await tag.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(
    page.getByRole("heading", { name: "Магазинів поки немає" }),
  ).toHaveCount(0);
  await expect(menu(page)).toBeVisible();
});

test("a kept change the phone cannot read says so, and where to look — never to ask the owner, who reads it (stage 2, admin task list, P2-3)", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "ACTIVE");
  const headers = { Authorization: `Bearer ${await tokenOf(page, owner)}` };
  const me = (await (
    await page.request.get("/api/v1/me", { headers })
  ).json()) as { organization_id: string; user_id: string };
  await storesSection(page);
  const market = await storeScreen(page, "Ринок");
  // Written on the phone meanwhile, and not as the app writes it.
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ body: {} }));
  }, `birka:store-state-pending:${me.organization_id}:${me.user_id}:${fixture.network_centre_store_id}`);
  const changes = posts(page, "/state");
  await market.getByRole("button", { name: "Заблокувати" }).click();
  const sheet = await stateSheet(page, "Заблокувати «Ринок»?");
  await sheet.getByLabel(/^Причина/).fill("Перевірка");
  await sheet.getByRole("button", { name: "Так, заблокувати «Ринок»" }).click();
  const unreadable =
    "Збережену зміну стану магазину не прочитати. Перевірте стан магазину в списку.";
  await expect(market.getByRole("alert")).toHaveText(unreadable);
  await expect(market.locator(".stores-notices")).toBeFocused();
  expect(changes.bodies).toEqual([]);
  await expect(market.locator(".store-tag-state")).toHaveCount(0);
  // Cut short, not even JSON: the same words, never the parser's (review,
  // 2026-11-07).
  await page.evaluate((key) => {
    localStorage.setItem(key, '{"key":"');
  }, `birka:store-state-pending:${me.organization_id}:${me.user_id}:${fixture.network_centre_store_id}`);
  await market.getByRole("button", { name: "Заблокувати" }).click();
  const again = await stateSheet(page, "Заблокувати «Ринок»?");
  await again.getByLabel(/^Причина/).fill("Перевірка");
  await again.getByRole("button", { name: "Так, заблокувати «Ринок»" }).click();
  await expect(market.getByRole("alert")).toHaveText(unreadable);
  expect(changes.bodies).toEqual([]);
  // Found so as the app opens: said on its plate, and nothing to change a
  // state with (review, 2026-11-07).
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByText(
      "Не вдалося прочитати збережену зміну стану магазину. Не очищайте дані застосунку.",
    ),
  ).toBeVisible();
  await more(page);
  await sections(page)
    .getByRole("button", { name: "Магазини", exact: true })
    .click();
  const held = await storeScreen(page, "Ринок");
  await expect(
    held.getByRole("button", { name: "Заблокувати" }),
  ).toBeDisabled();
  expect(changes.bodies).toEqual([]);
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
