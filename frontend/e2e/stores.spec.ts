import { test, expect, more, openStore, section, sections } from "./fixtures";
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
  await market
    .getByRole("button", { name: "Так, заблокувати «Ринок»" })
    .click();
  await expect(market.getByText("Заблоковано", { exact: true })).toBeVisible();
  await expect(market.getByText("Причина: Ревізія каси")).toBeVisible();
  expect(changes.bodies).toEqual([
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
    "+ Нове замовлення",
    "Приймання",
    "Повернення",
    "Каталог",
    "Початкові залишки",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(
    page.getByRole("button", { name: "Залишки", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Борги", exact: true }).click();
  // The store's own notice says it does not trade; «Борги» says who takes
  // the payments, once (credits task list, P0-1).
  await expect(
    page.getByText("Внески приймає будь-який магазин мережі, що працює.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/лише для перегляду/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Борг магазину, що зараз не працює?" }),
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
    await page.getByRole("button", { name: "Борги", exact: true }).click();
    // Everyone on the store's own list, paid too; not on another's.
    await page
      .getByRole("button", { name: "Показати сплачені й списані" })
      .click();
    // Asked for under the results (credits task list, P0-1).
    await page
      .getByRole("button", { name: "Борг магазину, що зараз не працює?" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Магазини, що не працюють" }),
    ).toBeVisible();
    const askForPhone = page.getByText(
      /Введіть повний номер телефону покупця, наприклад 067 123 45 67/,
    );
    await expect(askForPhone).toBeVisible();
    // Only what is still owed, so nothing to choose (owner, 2026-10-10).
    await expect(
      page.getByRole("button", { name: "Лише ті, хто винен" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Показати сплачені й списані" }),
    ).toHaveCount(0);
    // Neither a name nor a part of the number finds another store's
    // customers, typed or entered: the phone does not even ask (owner
    // decision, 2026-10-10).
    const search = page.getByLabel("Повний номер телефону покупця");
    for (const partial of [name, phone.slice(0, 6)]) {
      await search.fill(partial);
      await search.press("Enter");
      await expect(askForPhone).toBeVisible();
    }
    // Past the pause a search waits for, still nothing asked.
    await page.waitForTimeout(500);
    expect(searches.filter((url) => url.includes("elsewhere=true"))).toEqual(
      [],
    );
    // The whole number, pasted from the phone's contacts between the two
    // invisible direction marks they add.
    await search.fill(`\u202a+38 ${phone.slice(0, 3)} ${phone.slice(3)}\u202c`);
    const found = page.getByRole("button", { name: `Відкрити борг: ${name},` });
    await expect(found).toContainText("Магазин «Ринок»");
    const asked = searches.filter((url) => url.includes("elsewhere=true"));
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked)
      expect(new URL(url).searchParams.get("status")).toBe("OPEN");
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
    await expect(
      page.getByText(
        "Внесок 500,00 грн прийнято карткою. Залишок боргу 1 500,00 грн.",
      ),
    ).toBeVisible();
    expect(payments.bodies).toEqual([
      {
        command_id: expect.any(String) as string,
        amount: "500.00",
        payment_method: "CARD",
        store_id: fixture.network_centre_store_id,
      },
    ]);
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
    await page.getByRole("button", { name: "Борги", exact: true }).click();
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
      page.getByRole("button", { name: "Борги", exact: true }),
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
      page.getByRole("button", { name: "Борги", exact: true }),
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
