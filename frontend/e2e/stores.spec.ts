import {
  test,
  expect,
  more,
  openStore,
  refuseOnce,
  section,
  sections,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
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

/** The app, opened from Telegram by this person. */
async function openAs(page: Page, telegramUserId: string): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId) }).toString()}`,
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

function card(page: Page, name: string) {
  return page.getByRole("article", { name: `Магазин ${name}` });
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
  await storesSection(page);
  const market = card(page, "Ринок");
  await market.getByRole("button", { name: "Заблокувати" }).click();
  // Never without a reason.
  await expect(
    market.getByRole("button", { name: "Так, заблокувати «Ринок»" }),
  ).toBeDisabled();
  await market.getByLabel(/^Причина/).fill("Ревізія каси");
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25).
  await refuseOnce(page, "**/api/v1/stores/*/state", 409);
  await market
    .getByRole("button", { name: "Так, заблокувати «Ринок»" })
    .click();
  await expect(
    market.getByText(
      "Стан магазину не змінено: його змінили — перегляньте його й спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await market
    .getByRole("button", { name: "Так, заблокувати «Ринок»" })
    .click();
  await expect(market.getByText("Заблоковано", { exact: true })).toBeVisible();
  await expect(market.getByText("Причина: Ревізія каси")).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: /^Заблоковано власником з/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/Роботу в цьому магазині зупинено/),
  ).toBeVisible();
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
    "Приймання",
    "Повернення",
    "Повернути",
    "Каталог",
    "Початкові залишки",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(
    page.getByRole("button", { name: "Залишки", exact: true }),
  ).toBeVisible();
  await section(page, "Борги");
  // The store's own notice says it does not trade; «Борги» says who takes
  // the payments, once (credits task list, P0-1).
  await expect(
    page.getByText("Внески приймає будь-який магазин мережі, що працює.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/лише для перегляду/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Борг магазину, що зараз не працює\?/ }),
  ).toHaveCount(0);
  // Its orders read, none made: no «+» in «Замовлення»'s heading
  // (navigation task list, P0-2).
  await section(page, "Замовлення");
  await expect(
    page
      .locator(".orders-head")
      .getByRole("button", { name: "Нове замовлення" }),
  ).toHaveCount(0);
  // «Брак» is shown as it stands, with nothing to press.
  await section(page, "Брак");
  await expect(page.getByText(/тут лише перегляд/)).toBeVisible();
  await expect(
    page.locator("[data-status=AWAITING] .damaged-unit").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Взяти на перевірку" }),
  ).toHaveCount(0);

  // Unblocked, Петро works as before.
  await section(page, "Магазини");
  await card(page, "Ринок")
    .getByRole("button", { name: "Розблокувати" })
    .click();
  await card(page, "Ринок")
    .getByLabel(/^Причина/)
    .fill("Ревізію завершено");
  await card(page, "Ринок")
    .getByRole("button", { name: "Так, магазин працює «Ринок»" })
    .click();
  await expect(
    card(page, "Ринок").getByText("Працює", { exact: true }),
  ).toBeVisible();
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
    await openAs(page, hanna);
    await openStore(page, "Центр CENTRE");
    await section(page, "Борги");
    // Everyone on the store's own list, paid too; not on another's.
    await page
      .getByRole("button", { name: "Показати сплачені й списані" })
      .click();
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
    for (const mode of ["Лише ті, хто винен", "Показати сплачені й списані"])
      await expect(page.getByRole("button", { name: mode })).toHaveCount(0);
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
      page.getByRole("heading", { name: "Борги", exact: true }),
    ).toBeFocused();
    await expect(search).toHaveValue(phone);
    await expect(
      page.getByText(/^За цим номером у цьому магазині боргів немає/),
    ).toBeVisible();
    await ask.click();
    await found.click();
    await expect(
      page.getByText(
        "Продано в «Ринок» (заблоковано). Внесок приймаєте ви, борг — за «Ринок».",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByLabel("Сума внеску, грн").fill("500");
    // Paid by card at «Центр»: its terminal takes it (ADR-0012 §B7 G).
    await page
      .getByRole("group", { name: "Внесок", exact: true })
      .getByRole("button", { name: "Картка" })
      .click();
    const paid = page.locator(".paid-result");
    await expect(paid.locator(".way-pill")).toHaveText(
      "Картка · Проведіть на терміналі",
    );
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
    await expect(
      page.getByRole("list", { name: "Історія боргу" }),
    ).toContainText("прийняв магазин «Центр»");
    await expect(
      page.getByRole("list", { name: "Історія боргу" }),
    ).toContainText("Внесок · картка");

    // In the blocked store itself the owner reads the debt: no payment is
    // taken there, and the network's owner may still write it off.
    await openAs(page, owner);
    await openStore(page, /^Ринок MARKET/);
    await section(page, "Борги");
    // Its whole number: the debt here, and never the closed stores asked
    // for — this store takes no payments (credits task list, P1-1).
    // Once this store has answered for the number itself, not the list
    // as it opened, which shows the debt too.
    const answered = page.waitForResponse(
      (response) =>
        response.url().includes("/credits/customers?") &&
        new URL(response.url()).searchParams.get("query") === phone,
    );
    await page.getByLabel("Ім’я або телефон").fill(phone);
    await answered;
    await expect(
      page.getByRole("button", { name: `Відкрити борг: ${name},` }),
    ).toBeVisible();
    await page.waitForTimeout(300);
    expect(
      await page
        .getByRole("button", { name: /^Борг магазину, що зараз не працює\?/ })
        .count(),
    ).toBe(0);
    // A whole number owing nothing here: the fact alone, as anyone trading
    // takes the payment (review, 2026-10-19).
    await page.getByLabel("Ім’я або телефон").fill(`099${phone.slice(3)}`);
    await expect(
      page.getByText("За цим номером у цьому магазині боргів немає.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Ім’я або телефон").fill(name);
    await page.getByRole("button", { name: `Відкрити борг: ${name},` }).click();
    await expect(
      page.getByLabel("Скільки винні").locator(".owed-sum"),
    ).toHaveText("1 500,00 грн");
    await expect(
      page.getByRole("group", { name: "Внесок", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Списати борг" }),
    ).toBeVisible();
  } finally {
    await settle(page, fixture.network_market_store_id, "ACTIVE");
  }
});

test("only an empty store is archived, and the refusal says what is left", async ({
  page,
}) => {
  await settle(page, fixture.network_market_store_id, "ACTIVE");
  await received(page, fixture.network_market_location_id, 2);
  await storesSection(page);
  const market = card(page, "Ринок");
  await market.getByRole("button", { name: "Закрити в архів" }).click();
  await expect(
    market.getByText(/Закрити можна лише порожній магазин/),
  ).toBeVisible();
  await market.getByLabel(/^Причина/).fill("Закриваємо ринок");
  await market
    .getByRole("button", { name: "Так, закрити в архів «Ринок»" })
    .click();
  await expect(
    market.getByText(/Закрити в архів можна лише порожній магазин/),
  ).toBeVisible();
  await expect(
    market.getByRole("list", { name: "Що лишилось у магазині" }),
  ).toContainText(/Власний склад «Склад ринку»: \d+ од\./);
  await expect(market.getByText("Працює", { exact: true })).toBeVisible();
});

test("an archived store opens again, and is archived again once empty", async ({
  page,
}) => {
  await settle(page, fixture.network_old_store_id, "ARCHIVED");
  await storesSection(page);
  const old = card(page, "Старий");
  await expect(old.getByText("В архіві", { exact: true })).toBeVisible();
  // An archived store opens to trade; it is never blocked.
  await expect(old.getByRole("button", { name: "Заблокувати" })).toHaveCount(0);
  await old.getByRole("button", { name: "Відкрити знову" }).click();
  await old.getByLabel(/^Причина/).fill("Відкриваємось");
  await old
    .getByRole("button", { name: "Так, магазин працює «Старий»" })
    .click();
  await expect(old.getByText("Працює", { exact: true })).toBeVisible();

  await old.getByRole("button", { name: "Закрити в архів" }).click();
  await old.getByLabel(/^Причина/).fill("Знову закрили");
  await old
    .getByRole("button", { name: "Так, закрити в архів «Старий»" })
    .click();
  await expect(old.getByText("В архіві", { exact: true })).toBeVisible();
  await old.getByText("Історія змін").click();
  await expect(
    old.getByRole("list", { name: "Історія: Старий" }),
  ).toContainText("Працює → В архіві");
  await expect(
    old.getByRole("list", { name: "Історія: Старий" }),
  ).toContainText("В архіві → Працює");
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
    await card(page, "Ринок")
      .getByRole("button", { name: "Заблокувати" })
      .click();
    await card(page, "Ринок")
      .getByLabel(/^Причина/)
      .fill("Перевірка");
    await card(page, "Ринок")
      .getByRole("button", { name: "Так, заблокувати «Ринок»" })
      .click();
    await expect(page.getByText("Незавершена зміна стану")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Клієнти", exact: true }),
    ).toBeDisabled();
    // Its own section stays open under «Ще», every other is held (P1-6).
    await more(page);
    await expect(
      sections(page).getByRole("button", { name: "Магазини", exact: true }),
    ).toBeEnabled();
    await expect(
      sections(page).getByRole("button", { name: "Залишки", exact: true }),
    ).toBeDisabled();
    // Written down before it was sent: a reload still knows what to ask about.
    await page.reload();
    await openStore(page, "Центр CENTRE");
    await expect(page.getByText("Незавершена зміна стану")).toBeVisible();
    await page.getByRole("button", { name: "Перевірити результат" }).click();
    await expect(page.getByText("«Ринок»: заблоковано.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Клієнти", exact: true }),
    ).toBeEnabled();
    expect(changes.bodies).toHaveLength(2);
    expect(changes.bodies[1]).toEqual(changes.bodies[0]);
    expect(changes.keys[1]).toBe(changes.keys[0]);
    const headers = { Authorization: `Bearer ${await tokenOf(page, owner)}` };
    const stores = (await (
      await page.request.get("/api/v1/stores", { headers })
    ).json()) as (StoreRecord & { changes: unknown[] })[];
    const market = stores.find((s) => s.id === fixture.network_market_store_id);
    expect(market?.state).toBe("BLOCKED");
  } finally {
    await settle(page, fixture.network_market_store_id, "ACTIVE");
  }
});
