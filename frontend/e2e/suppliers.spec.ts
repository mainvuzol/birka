import {
  test,
  expect,
  addSupplier,
  more,
  openStore,
  readsOf,
  refuseOnce,
  section,
  sections,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Returns to a supplier (owner decisions, 2026-10-01): the owner and
 * managers send goods back from a warehouse as one document with a list, or
 * a confirmed unit from «Брак»; pick the supplier from the network's list or
 * add one on the spot; and cancel a return whole, saying why.
 *
 * In the stores' own network: Ганна works at «Центр», Петро at «Ринок»,
 * which has its «Брак».
 */
interface Fixture {
  network_centre_seller_telegram_user_id: string;
  network_market_seller_telegram_user_id: string;
  network_centre_store_id: string;
  network_market_store_id: string;
  network_shared_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
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

async function openAs(page: Page, telegramUserId: string): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId) }).toString()}`,
  );
}

async function headersOf(
  page: Page,
  telegramUserId: string,
): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

interface Coat {
  model: string;
  variant: string;
  size: string;
}

/** A model of its own, `quantity` of it received by `who` at `store`. */
async function received(
  page: Page,
  who: string,
  store: string,
  quantity: number,
): Promise<Coat> {
  const headers = await headersOf(page, who);
  const model = `Постачальнику ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: store,
      concept: model,
      variant: { color: "беж" },
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
      store_id: store,
      location_id: fixture.network_shared_location_id,
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
  return { model, variant: product.product_variant_id, size };
}

async function available(page: Page, coat: Coat): Promise<number> {
  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.network_centre_store_id}&location_id=${fixture.network_shared_location_id}&limit=100&offset=0`,
    { headers: await headersOf(page, hanna) },
  );
  const { items } = (await response.json()) as {
    items: { product_variant_id: string; available_quantity: number }[];
  };
  return (
    items.find((item) => item.product_variant_id === coat.variant)
      ?.available_quantity ?? 0
  );
}

function posts(page: Page, ending: string): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith(ending))
      seen.bodies.push(request.postDataJSON());
  });
  return seen;
}

/** The new return's form, at «Центр», on the shared warehouse. */
async function newReturn(page: Page): Promise<void> {
  await openAs(page, hanna);
  await openStore(page, "Центр CENTRE");
  await section(page, "Постачальникам");
  await page
    .getByRole("button", { name: "+ Повернути товар постачальнику" })
    .click();
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption({
      label: "Склад мережі",
    });
}

/** The new return's form, under «Постачальникам»'s own filter. */
function returnForm(page: Page): Locator {
  return page.getByRole("group", { name: "Нове повернення постачальнику" });
}

/** A supplier added from a field (stage 2, money task list, P0-3) — the
 * return form's, or «Брак»'s — with a phone: added, or found on the list,
 * it is picked. */
async function addOne(page: Page, name: string, of?: Locator): Promise<void> {
  await addSupplier(page, name, "067 123 45 67", of ? { of } : {});
}

/** The return's field: the supplier picked, as it shows it. */
function supplierField(page: Page): Locator {
  return returnForm(page).getByRole("button", { name: /^Постачальник / });
}

test("goods go back to a supplier from a warehouse, and come back when it is cancelled", async ({
  page,
}) => {
  const coat = await received(page, hanna, fixture.network_centre_store_id, 4);
  const supplier = `Беларді ${randomUUID().slice(0, 6)}`;
  const sent = posts(page, "/api/v1/supplier-returns");
  await newReturn(page);
  await addOne(page, supplier, returnForm(page));
  await expect(supplierField(page)).toHaveAccessibleName(
    `Постачальник ${supplier} · 067 123 45 67`,
  );
  await page.getByLabel("Пошук моделі").fill(coat.model);
  await page.getByLabel(`Повернути: ${coat.model}`, { exact: false }).fill("2");
  await page.getByLabel("Примітка (необов’язково)").fill("не продалось");
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25).
  const returnReads = readsOf(page, /\/api\/v1\/supplier-returns$/);
  await refuseOnce(page, "**/api/v1/supplier-returns", 409);
  await page
    .getByRole("button", { name: "Повернути постачальнику 2 шт." })
    .click();
  await expect(
    page.getByText(
      "Не записано: дані повернення змінилися — перегляньте їх і спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(returnReads).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Повернути постачальнику 2 шт." })
    .click();
  await expect(
    page.getByText(`Повернено постачальнику «${supplier}»: 2 шт.`),
  ).toBeVisible();
  // The one refused above, then the same return as a new command.
  expect(sent.bodies).toHaveLength(2);
  expect({ ...(sent.bodies[0] as object), command_id: null }).toEqual({
    ...(sent.bodies[1] as object),
    command_id: null,
  });
  expect(sent.bodies.slice(1)).toEqual([
    {
      command_id: expect.any(String) as string,
      store_id: fixture.network_centre_store_id,
      location_id: fixture.network_shared_location_id,
      supplier_id: expect.any(String) as string,
      lines: [
        { product_variant_id: coat.variant, size_id: coat.size, quantity: 2 },
      ],
      note: "не продалось",
    },
  ]);
  expect(await available(page, coat)).toBe(2);

  const card = page.getByRole("article", {
    name: new RegExp(`^Повернення ${supplier}`),
  });
  await expect(card).toContainText(coat.model);
  await expect(card).toContainText("склад «Склад мережі»");
  await card.getByRole("button", { name: "Скасувати повернення" }).click();
  await expect(
    card.getByRole("button", { name: "Так, скасувати повернення" }),
  ).toBeDisabled();
  await card.getByLabel("Чому скасовуємо").fill("постачальник не взяв");
  const cancelReads = readsOf(page, /\/api\/v1\/supplier-returns$/);
  await refuseOnce(page, "**/api/v1/supplier-returns/*/cancel", 409);
  await card.getByRole("button", { name: "Так, скасувати повернення" }).click();
  await expect(
    card.getByText(
      "Не записано: дані повернення змінилися — перегляньте їх і спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(cancelReads).toBeGreaterThan(0);
  await card.getByRole("button", { name: "Так, скасувати повернення" }).click();
  await expect(
    card.getByText(/^Скасовано .* постачальник не взяв/),
  ).toBeVisible();
  expect(await available(page, coat)).toBe(4);

  // The supplier edited, refused for a reason the screen does not name: its
  // own words; a conflict reads the list again (owner decision, 2026-10-25).
  await page.getByText("Список постачальників").click();
  await page.getByRole("button", { name: `Змінити ${supplier}` }).click();
  const list = page.getByRole("list", { name: "Постачальники" });
  await refuseOnce(page, "**/api/v1/suppliers/*", 422);
  await list.getByRole("button", { name: "Зберегти" }).click();
  await expect(
    page.getByText(
      "Постачальника не збережено. Перевірте назву й телефон та спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  const supplierReads = readsOf(page, /\/api\/v1\/suppliers$/);
  await refuseOnce(page, "**/api/v1/suppliers/*", 409);
  await list.getByRole("button", { name: "Зберегти" }).click();
  await expect(
    page.getByText(
      "Постачальника не збережено: дані змінилися — перегляньте їх і спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(supplierReads).toBeGreaterThan(0);
  await list.getByRole("button", { name: "Скасувати" }).click();
});

test("goods held for an order are not offered to go back", async ({ page }) => {
  const coat = await received(page, hanna, fixture.network_centre_store_id, 1);
  const held = await page.request.post("/api/v1/orders", {
    headers: await headersOf(page, hanna),
    data: {
      store_id: fixture.network_centre_store_id,
      command_id: randomUUID(),
      carrier: "NOVA_POSHTA",
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          source_location_id: fixture.network_shared_location_id,
          quantity: 1,
          unit_price: "1500.00",
        },
      ],
    },
  });
  expect(held.status()).toBe(201);
  await newReturn(page);
  await page.getByLabel("Пошук моделі").fill(coat.model);
  await expect(
    page.getByText("На цьому складі немає вільного товару."),
  ).toBeVisible();
  await expect(
    page.getByLabel(`Повернути: ${coat.model}`, { exact: false }),
  ).toHaveCount(0);
});

test("a supplier is never written twice: the one on the list is picked", async ({
  page,
}) => {
  const supplier = `Арно ${randomUUID().slice(0, 6)}`;
  await newReturn(page);
  await addOne(page, supplier, returnForm(page));
  await addOne(page, `  ${supplier.toUpperCase()} `, returnForm(page));
  await expect(
    page.getByText(`«${supplier}» уже є у списку — обрано його.`),
  ).toBeVisible();
  // Picked, never added twice: the field shows the one on the list.
  await expect(supplierField(page)).toHaveAccessibleName(
    `Постачальник ${supplier} · 067 123 45 67`,
  );
  await expect(
    page.getByRole("combobox", { name: /Постачальник/ }),
  ).toHaveCount(0);
});

test("the returns are narrowed to a supplier from its sheet: «Усі постачальники» first, the phone under each, nothing to add", async ({
  page,
}) => {
  const supplier = `Фільтр ${randomUUID().slice(0, 6)}`;
  const added = await page.request.post("/api/v1/suppliers", {
    headers: await headersOf(page, hanna),
    data: {
      store_id: fixture.network_centre_store_id,
      name: supplier,
      phone: "067 765 43 21",
    },
  });
  expect(added.status()).toBe(201);
  const supplierId = ((await added.json()) as { id: string }).id;
  await openAs(page, hanna);
  await openStore(page, "Центр CENTRE");
  await section(page, "Постачальникам");
  // One field, never a native list (stage 2, money task list, P0-3).
  await expect(
    page.getByRole("combobox", { name: /Постачальник/ }),
  ).toHaveCount(0);
  const field = page.getByRole("button", {
    name: "Постачальник Усі постачальники",
    exact: true,
  });
  await field.click();
  const sheet = page.getByRole("dialog", { name: "Постачальник" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(
    sheet.getByRole("searchbox", { name: "Пошук постачальника" }),
  ).toBeFocused();
  await expect(sheet.locator(".supplier-row").first()).toHaveText(
    "Усі постачальники",
  );
  await expect(sheet.locator(".supplier-row").first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    sheet.getByRole("button", { name: /Новий постачальник/ }),
  ).toHaveCount(0);
  // Nothing found: said, for a reader too.
  await sheet
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(`${supplier} нікого`);
  await expect(sheet.locator(".supplier-row")).toHaveCount(0);
  await expect(sheet.getByRole("status")).toHaveText(
    `Нічого не знайшли за «${supplier} нікого»`,
  );
  // Every word typed, of a name or a phone.
  await sheet
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(`${supplier.split(" ")[1] ?? ""} 765`);
  const row = sheet.locator(".supplier-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".t-meta")).toHaveText("067 765 43 21");
  const narrowed = page.waitForRequest(
    (request) =>
      request.url().includes("/api/v1/supplier-returns?") &&
      request.url().includes(`supplier_id=${supplierId}`),
  );
  await row.click();
  await narrowed;
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Постачальник ${supplier}`, exact: true }),
  ).toBeVisible();
});

test("a confirmed unit goes back to its supplier from «Брак», and comes back there when cancelled", async ({
  page,
}) => {
  const coat = await received(page, petro, fixture.network_market_store_id, 1);
  const headers = await headersOf(page, petro);
  const sold = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
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
  const sale = (await sold.json()) as { id: string; items: { id: string }[] };
  const back = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
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

  const supplier = `Брак-постачальник ${randomUUID().slice(0, 6)}`;
  await openAs(page, petro);
  await openStore(page, /^Ринок MARKET/);
  await section(page, "Брак");
  const unit = page.getByRole("article", { name: coat.model });
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  await unit.getByRole("button", { name: "Брак підтверджений" }).click();
  await unit.getByRole("button", { name: "Так, брак підтверджений" }).click();
  await unit.getByRole("button", { name: "Повернути постачальнику" }).click();
  await expect(
    unit.getByLabel("Примітка для постачальника (необов’язково)"),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await expect(
    unit.getByRole("button", { name: "Так, повернути постачальнику" }),
  ).toBeDisabled();
  // The supplier's field, its sheet: never a native list (stage 2, money
  // task list, P0-3).
  await expect(
    unit.getByRole("combobox", { name: /Постачальник/ }),
  ).toHaveCount(0);
  await addOne(page, supplier);
  await unit
    .getByRole("button", { name: "Так, повернути постачальнику" })
    .click();
  await expect(unit).toHaveCount(0);

  await section(page, "Постачальникам");
  const card = page.getByRole("article", {
    name: new RegExp(`^Повернення ${supplier}`),
  });
  await expect(card).toContainText("з «Браку» «Брак ринку»");
  await card.getByRole("button", { name: "Скасувати повернення" }).click();
  await card.getByLabel("Чому скасовуємо").fill("постачальник відмовив");
  await card.getByRole("button", { name: "Так, скасувати повернення" }).click();
  await expect(card.getByText(/^Скасовано/)).toBeVisible();

  await section(page, "Брак");
  await expect(
    page
      .locator("[data-status=CONFIRMED]")
      .getByRole("article", { name: coat.model }),
  ).toBeVisible();
});

test("a return whose answer is lost is resent unchanged, and takes the goods once", async ({
  page,
}) => {
  const coat = await received(page, hanna, fixture.network_centre_store_id, 3);
  const sent = posts(page, "/api/v1/supplier-returns");
  let first = true;
  await page.route("**/api/v1/supplier-returns", async (route) => {
    if (route.request().method() === "POST" && first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await newReturn(page);
  await addOne(page, `Втрачений ${randomUUID().slice(0, 6)}`, returnForm(page));
  await page.getByLabel("Пошук моделі").fill(coat.model);
  await page.getByLabel(`Повернути: ${coat.model}`, { exact: false }).fill("1");
  await page
    .getByRole("button", { name: "Повернути постачальнику 1 шт." })
    .click();
  // On «Постачальникам», its own screen: the stub, still attached, checked
  // by its button alone (G11; stage 2, money task list, P0-6).
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect(kept.locator(".stub-head")).toHaveText("Ще не підтверджено");
  await expect(
    kept.getByRole("heading", {
      name: "Повернення постачальнику ще не підтверджено",
    }),
  ).toBeVisible();
  await expect(kept).toContainText(
    "Невідомо, чи записано повернення постачальнику. Перевірте результат — те саме повернення не запишеться двічі.",
  );
  await expect(kept).toContainText(/Чекає відповіді сервера з \d{2}:\d{2}\./);
  await expect(page.getByText(/Перевіряємо кожні 20 с/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Замовлення", exact: true }),
  ).toBeDisabled();
  // Its own section stays open under «Ще», every other is held (P1-6); over
  // «Ще», a banner with the same check.
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: "Постачальникам", exact: true }),
  ).toBeEnabled();
  await expect(
    sections(page).getByRole("button", { name: "Інвентаризація", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".banner-kept").getByRole("button", {
      name: "Перевірити результат повернення",
    }),
  ).toBeVisible();
  // Written down before it was sent: a reload still knows what to ask about.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await kept
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect(
    kept.getByRole("heading", {
      name: "Повернення постачальнику записано один раз",
    }),
  ).toBeVisible();
  await expect(kept).toContainText(
    /Повернено постачальнику «Втрачений .*»: 1 шт\./,
  );
  // The till is the seller's again.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  expect(sent.bodies).toHaveLength(2);
  expect(sent.bodies[1]).toEqual(sent.bodies[0]);
  expect(await available(page, coat)).toBe(2);
});
