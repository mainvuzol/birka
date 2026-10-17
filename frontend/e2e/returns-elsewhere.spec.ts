import { test, expect, openStore, returnUnits, section } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Returns at another store (owner decisions, 2026-10-01): any store of the
 * network takes back goods another of its stores sold, finds that sale by a
 * search, and hands the money back. Intact goods go back where they were
 * sold from; where this store does not reach that warehouse, to one of its
 * own the seller chooses. Damaged goods stay in this store's «Брак».
 *
 * The owner sells at «Другий»; «Оля» takes the goods back at «Основний».
 */
interface Fixture {
  telegram_user_id: string;
  owner_telegram_user_id: string;
  store_id: string;
  second_store_id: string;
  second_location_id: string;
  returns_location_id: string;
  bin_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Оля"}`,
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

function launch(): string {
  return `/#${new URLSearchParams({ tgWebAppData: initData(fixture.telegram_user_id) }).toString()}`;
}

async function tokenOf(page: Page, telegramUserId: string): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId) },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

interface Sold {
  model: string;
  variant: string;
  sale: { id: string; items: { id: string }[] };
}

/** Two coats at 3000 sold by «Другий» from `warehouse`, by the owner, paid `way`. */
async function soldAtTheOtherStore(
  page: Page,
  warehouse: string,
  way: "CASH" | "CARD" | "TRANSFER" = "CASH",
): Promise<Sold> {
  const token = await tokenOf(page, fixture.owner_telegram_user_id);
  const headers = { Authorization: `Bearer ${token}` };
  const model = `Деінде ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.second_store_id,
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
      store_id: fixture.second_store_id,
      location_id: warehouse,
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
      store_id: fixture.second_store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          source_location_id: warehouse,
          quantity: 2,
          unit_price: "3000.00",
        },
      ],
      payment_method: way,
    },
  });
  expect(sale.status()).toBe(201);
  return { model, variant, sale: (await sale.json()) as Sold["sale"] };
}

async function held(
  page: Page,
  location: string,
  variant: string,
): Promise<number> {
  const token = await tokenOf(page, fixture.owner_telegram_user_id);
  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.store_id}&location_id=${location}&limit=100&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const { items } = (await response.json()) as {
    items: { product_variant_id: string; quantity: number }[];
  };
  return items.find((i) => i.product_variant_id === variant)?.quantity ?? 0;
}

/** «Повернення» at «Основний», looking among the other stores' sales. */
async function findElsewhere(page: Page, model: string): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  // Under this store's list (owner decision, 2026-10-17, В3 (а)).
  await page
    .getByRole("button", { name: "Шукати в інших магазинах мережі" })
    .click();
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  await expect(page.getByRole("article")).toHaveCount(1);
}

function refunds(page: Page): { bodies: unknown[]; keys: string[] } {
  const seen = { bodies: [] as unknown[], keys: [] as string[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/refunds")) {
      seen.bodies.push(request.postDataJSON());
      seen.keys.push(request.headers()["idempotency-key"] ?? "");
    }
  });
  return seen;
}

test("goods bought at another store come back here, and this store hands the money back", async ({
  page,
}) => {
  const { model, variant } = await soldAtTheOtherStore(
    page,
    fixture.returns_location_id,
    "CARD",
  );
  const before = await held(page, fixture.returns_location_id, variant);
  const sent = refunds(page);
  const searches: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("elsewhere=true")) searches.push(request.url());
  });

  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  // Under this store's list (owner decision, 2026-10-17, В3 (а)).
  await page
    .getByRole("button", { name: "Шукати в інших магазинах мережі" })
    .click();
  // The other stores' sales are found, never browsed.
  await expect(
    page.getByText("Введіть назву товару, щоб знайти продаж іншого магазину."),
  ).toBeVisible();
  expect(searches).toEqual([]);
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  const card = page.getByRole("article");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Магазин «Другий»");

  await card.getByRole("button", { name: "Оформити повернення" }).click();
  await expect(page.getByText(/ · магазин «Другий»$/)).toBeVisible();
  // One line of explanation (returns task list, P0-3).
  await expect(
    page.getByText(
      "Куплено в іншому магазині: гроші віддаєте ви, пошкоджене лишається у вашому «Браку».",
      { exact: true },
    ),
  ).toBeVisible();
  await returnUnits(page, { intact: 1, damaged: 1 });
  // The other store's sale says how it was paid, for this one return only:
  // by card, so the money goes back to the card, through this terminal.
  await expect(
    page.getByRole("radio", { name: "На картку", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", {
      name: "Повернути покупцю 6 000,00 грн на картку",
      exact: true,
    })
    .click();

  await expect(
    page.getByText(
      "Товар куплено в іншому магазині мережі — гроші віддаєте ви.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Картка · Поверніть на картку через термінал"),
  ).toBeVisible();
  await expect(page.locator(".hand-back-sum")).toHaveText("6 000,00 грн");
  await expect(
    page.getByText("Поверніть 6 000,00 грн на картку покупця через термінал.", {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Цілі: 1 шт. — на склад, з якого продали.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Пошкоджені: 1 шт\. — у «Брак»\./),
  ).toBeVisible();
  expect(sent.bodies).toHaveLength(1);
  expect((sent.bodies[0] as { store_id: string }).store_id).toBe(
    fixture.store_id,
  );
  expect((sent.bodies[0] as { payment_method: string }).payment_method).toBe(
    "CARD",
  );
  expect(await held(page, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
  // The damaged one stays here, in «Основний»'s «Брак».
  expect(await held(page, fixture.bin_location_id, variant)).toBe(1);
  await section(page, "Брак");
  await expect(
    page.getByRole("article").filter({ hasText: model }),
  ).toHaveCount(1);
});

test("goods sold from the other store's own warehouse go to one of this store's, chosen", async ({
  page,
}) => {
  const { model, variant } = await soldAtTheOtherStore(
    page,
    fixture.second_location_id,
  );
  const before = await held(page, fixture.returns_location_id, variant);
  const sent = refunds(page);
  await findElsewhere(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  // Asked only once an intact one is counted.
  const place = page.getByLabel("Цілий товар — на склад вашого магазину");
  await expect(place).toHaveCount(0);
  await returnUnits(page, { intact: 1 });
  await expect(
    page.getByRole("button", { name: "Оберіть склад для цілого товару" }),
  ).toBeDisabled();
  // Offered once this store's warehouses are read: never «Брак», and never
  // the other store's own.
  await expect(
    place.locator(`option[value="${fixture.returns_location_id}"]`),
  ).toHaveCount(1);
  await expect(
    place.locator(`option[value="${fixture.bin_location_id}"]`),
  ).toHaveCount(0);
  await expect(
    place.locator(`option[value="${fixture.second_location_id}"]`),
  ).toHaveCount(0);
  await place.selectOption(fixture.returns_location_id);
  await page
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();

  await expect(
    page.getByText(
      "Цілі: 1 шт. — на склад «Склад повернень» вашого магазину.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/з якого продали/)).toHaveCount(0);
  const body = sent.bodies[0] as {
    store_id: string;
    lines: { location_id?: string }[];
  };
  expect(body.store_id).toBe(fixture.store_id);
  expect(body.lines[0]?.location_id).toBe(fixture.returns_location_id);
  expect(await held(page, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
});

test("a unit from the other store's own warehouse goes back on sale here, where chosen", async ({
  page,
}) => {
  const { model, variant, sale } = await soldAtTheOtherStore(
    page,
    fixture.second_location_id,
  );
  const token = await tokenOf(page, fixture.telegram_user_id);
  const returned = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      command_id: randomUUID(),
      store_id: fixture.store_id,
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
  expect(returned.status()).toBe(201);
  const before = await held(page, fixture.returns_location_id, variant);

  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Брак");
  const unit = page.getByRole("article").filter({ hasText: model });
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  await unit.getByRole("button", { name: "Повернути в продаж" }).click();
  const confirm = unit.getByRole("button", { name: /Так, повернути на/ });
  await expect(confirm).toHaveCount(0);
  await unit
    .getByLabel("Повернути в продаж на склад вашого магазину")
    .selectOption(fixture.returns_location_id);
  await unit
    .getByRole("button", { name: "Так, повернути на «Склад повернень»" })
    .click();
  await expect(unit).toHaveCount(0);
  expect(await held(page, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
});

test("a return taken elsewhere whose answer is lost is resent unchanged, and says who pays", async ({
  page,
}) => {
  const { model } = await soldAtTheOtherStore(
    page,
    fixture.returns_location_id,
  );
  const sent = refunds(page);
  let first = true;
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    if (first) {
      first = false;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await findElsewhere(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await returnUnits(page, { intact: 1 });
  await page
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();

  await expect(page.getByText("Незавершене повернення")).toBeVisible();
  await page
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(
    page.getByText(
      "Товар куплено в іншому магазині мережі — гроші віддаєте ви.",
    ),
  ).toBeVisible();
  expect(sent.bodies).toHaveLength(2);
  expect(sent.bodies[1]).toEqual(sent.bodies[0]);
  expect(sent.keys[1]).toBe(sent.keys[0]);
  expect((sent.bodies[0] as { store_id: string }).store_id).toBe(
    fixture.store_id,
  );
  await expect(
    page.getByText("Поверніть покупцю 3 000,00 грн готівкою."),
  ).toBeVisible();
});

test("a kept return of goods from the other store's own warehouse, checked by the phone itself on reopening, names the warehouse chosen", async ({
  page,
}) => {
  const { model, variant } = await soldAtTheOtherStore(
    page,
    fixture.second_location_id,
  );
  const before = await held(page, fixture.returns_location_id, variant);
  const sent = refunds(page);
  // No answer while the app is open: the attempt stays on the phone.
  let answered = false;
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    if (answered) await route.continue();
    else await route.abort("connectionreset");
  });
  await findElsewhere(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await returnUnits(page, { intact: 1 });
  await page
    .getByLabel("Цілий товар — на склад вашого магазину")
    .selectOption(fixture.returns_location_id);
  await page
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();
  await expect(page.getByText("Незавершене повернення")).toBeVisible();

  // Closed, and opened again once the server answers: the form and its
  // choice are gone, and the phone checks what it kept by itself.
  await page.goto("about:blank");
  answered = true;
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  const confirmed = page.locator("section.notice", {
    has: page.getByRole("heading", { name: "Повернення оформлено" }),
  });
  await expect(confirmed).toBeVisible();
  await expect(
    confirmed.getByText(
      "Цілий товар повернуто на склад «Склад повернень» вашого магазину.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(confirmed.getByText(/з якого його продали/)).toHaveCount(0);
  await expect(
    confirmed.getByText(
      "Товар куплено в іншому магазині мережі — гроші віддаєте ви.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    confirmed.getByText(
      "Якщо гроші ще не повернули — поверніть покупцю 3 000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
      { exact: true },
    ),
  ).toBeVisible();
  // The identical attempt, the warehouse chosen included, and the coat is
  // there.
  expect(sent.bodies).toHaveLength(2);
  expect(sent.bodies[1]).toEqual(sent.bodies[0]);
  expect(sent.keys[1]).toBe(sent.keys[0]);
  const body = sent.bodies[0] as { lines: { location_id?: string }[] };
  expect(body.lines[0]?.location_id).toBe(fixture.returns_location_id);
  expect(await held(page, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
});

test("a sale of this store is returned as before, with no store named", async ({
  page,
}) => {
  const sent = refunds(page);
  const token = await tokenOf(page, fixture.telegram_user_id);
  const headers = { Authorization: `Bearer ${token}` };
  const model = `Тут ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      concept: model,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const size = product.sizes[0]?.size_id ?? "";
  await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.returns_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: size,
          quantity: 1,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  const sale = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: size,
          source_location_id: fixture.returns_location_id,
          quantity: 1,
          unit_price: "3000.00",
        },
      ],
      payment_method: "CASH",
    },
  });
  expect(sale.status()).toBe(201);

  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  await expect(page.getByRole("article")).not.toContainText("Магазин «");
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await returnUnits(page, { intact: 1 });
  await page
    .getByRole("button", {
      name: "Повернути покупцю 3 000,00 грн готівкою",
      exact: true,
    })
    .click();
  await expect(page.getByText("Готівка · Поверніть покупцю")).toBeVisible();
  await expect(
    page.getByText("Поверніть покупцю 3 000,00 грн готівкою.", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText(/гроші віддаєте ви/)).toHaveCount(0);
  expect(Object.keys(sent.bodies[0] ?? {}).sort()).toEqual([
    "command_id",
    "lines",
    "payment_method",
    "reason",
  ]);
});
