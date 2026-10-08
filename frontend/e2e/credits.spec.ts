import { test, expect } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Paying in parts (owner decisions, 2026-10-01): the customer takes the goods
 * now, pays part and owes the rest to the store that sold; payments come
 * when they can; returned goods lower the debt first; the owner may write a
 * debt off, saying why.
 *
 * Each payment is paid one way, given by the button that takes it: «Готівка»,
 * «Картка» or «Переказ» (owner decision, 2026-10-04; ADR-0012 §B12).
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
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

function launch(): string {
  return `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`;
}

interface Coat {
  model: string;
  variant: string;
  size: string;
  token: string;
}

/** A model of this test's own, five of it received where the till sells. */
async function stocked(page: Page): Promise<Coat> {
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
  const model = `Частинами ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers,
    data: {
      store_id: fixture.store_id,
      concept: model,
      variant: { color: "оливковий" },
      sizes: [{ system: "ALPHA", code: "L" }],
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
  return { model, variant, size, token };
}

/**
 * Two coats at 1500, 3000 in all, 1000 paid now — through the API. One phone
 * is one customer, so each journey's customer has a number of their own.
 */
async function onCredit(
  page: Page,
  customer: string,
  phone: string = newPhone(),
): Promise<Coat & { sale: { id: string; credit: { credit_id: string } } }> {
  const coat = await stocked(page);
  const response = await page.request.post("/api/v1/sales", {
    headers: {
      Authorization: `Bearer ${coat.token}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          source_location_id: fixture.returns_location_id,
          quantity: 2,
          unit_price: "1500.00",
        },
      ],
      credit: {
        customer_name: customer,
        customer_phone: phone,
        paid_now: "1000.00",
      },
      // The part paid now, in cash.
      payment_method: "CASH",
    },
  });
  expect(response.status()).toBe(201);
  return {
    ...coat,
    sale: (await response.json()) as {
      id: string;
      credit: { credit_id: string };
    },
  };
}

async function owed(page: Page, token: string, id: string): Promise<string> {
  const response = await page.request.get(`/api/v1/credits/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await response.json()) as { owed: string }).owed;
}

function customer(): string {
  return `Покупець ${randomUUID().slice(0, 8)}`;
}

/** A Ukrainian mobile number nobody else in the run has: «0671234567». */
function newPhone(): string {
  return `067${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
}

/** Two coats in the till's basket, at 1500 each. */
async function basket(page: Page, coat: Coat): Promise<void> {
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  const loaded = () =>
    page.waitForResponse(
      (r) => r.url().includes("/catalog/stock-options?") && r.status() === 200,
    );
  const first = loaded();
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.returns_location_id);
  // The till offers a hundred models a page; the warehouse holds every
  // journey's own, so this one may be further on.
  let response = await first;
  for (;;) {
    const body = (await response.json()) as {
      items: { product_variant_id: string }[];
      has_more: boolean;
    };
    if (body.items.some((item) => item.product_variant_id === coat.variant))
      break;
    if (!body.has_more) throw new Error("The till does not offer the coat");
    const next = loaded();
    await page.getByRole("button", { name: "Наступні товари" }).click();
    response = await next;
  }
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${coat.variant}:${coat.size}`);
  await page.getByLabel("Кількість").fill("2");
  await page.getByLabel("Ціна за одиницю, грн").fill("1500");
  await page.getByRole("button", { name: "Додати в кошик" }).click();
}

/** The till's ways to take a payment on a debt, under «Внесок». */
function paying(page: Page) {
  return page.getByRole("group", { name: "Внесок", exact: true });
}

/** «Борги», searched down to one customer, and that debt opened. */
async function debt(page: Page, name: string): Promise<void> {
  // A launch link that differs only in its hash would not reload the app.
  await page.goto("about:blank");
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Борги", exact: true }).click();
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: `Відкрити борг ${name}` }).click();
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

test("a sale paid in parts leaves the rest owed, and «Борги» takes it until nothing is", async ({
  page,
}) => {
  const coat = await stocked(page);
  const name = customer();
  const tel = newPhone();
  const written = `${tel.slice(0, 3)} ${tel.slice(3, 6)} ${tel.slice(6, 8)} ${tel.slice(8)}`;
  const sales = posts(page, "/api/v1/sales");
  await basket(page, coat);

  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill(name);
  await page.getByLabel("Телефон покупця").fill(written);
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await expect(page.getByText("Лишиться винен 2000,00 грн")).toBeVisible();
  // The way is for the part paid now.
  await page.getByRole("button", { name: "Готівка", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByText("Сплачено зараз 1000,00 грн готівкою"),
  ).toBeVisible();
  await expect(page.getByText("Покупець винен 2000,00 грн")).toBeVisible();
  expect(sales.bodies).toHaveLength(1);
  // The way travels at the top of the body; the terms are as they were.
  expect((sales.bodies[0] as { payment_method: unknown }).payment_method).toBe(
    "CASH",
  );
  expect((sales.bodies[0] as { credit: unknown }).credit).toEqual({
    customer_name: name,
    customer_phone: written,
    paid_now: "1000.00",
  });
  // The next customer starts without these terms.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await expect(page.getByLabel("Оплата частинами")).not.toBeChecked();

  await page.getByRole("button", { name: "Борги", exact: true }).click();
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(tel);
  await page.getByRole("button", { name: "Знайти" }).click();
  const card = page.getByRole("article").filter({ hasText: name });
  await expect(card).toContainText("Винні 2000,00 грн з 3000,00 грн");
  await expect(card).toContainText(coat.model);
  await card.getByRole("button", { name: `Відкрити борг ${name}` }).click();

  const payments = posts(page, "/payments");
  // «Прийняти внесок» is the way the customer pays (ADR-0012 G23).
  await expect(paying(page).getByRole("button")).toHaveText([
    "Готівка",
    "Картка",
    "Переказ",
    "Увесь залишок",
  ]);
  await page.getByLabel("Сума внеску, грн").fill("500");
  await paying(page).getByRole("button", { name: "Готівка" }).click();
  await expect(
    page.getByText(
      "Внесок 500,00 грн прийнято готівкою. Залишок боргу 1500,00 грн.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await expect(page.getByLabel("Сума внеску, грн")).toHaveValue("1500,00");
  await paying(page).getByRole("button", { name: "Картка" }).click();
  await expect(
    page.getByText(
      "Внесок 1500,00 грн прийнято карткою. Борг сплачено повністю.",
    ),
  ).toBeVisible();
  await expect(page.locator("p.badge")).toHaveText("Сплачено");
  await expect(paying(page)).toHaveCount(0);
  const history = page
    .getByRole("list", { name: "Історія боргу" })
    .getByRole("listitem");
  await expect(history).toHaveCount(3);
  // Each payment says how it was paid; the first is the sale's own.
  await expect(history.filter({ hasText: "Внесок 1000,00 грн" })).toContainText(
    "Внесок 1000,00 грн · готівка ·",
  );
  await expect(history.filter({ hasText: "Внесок 500,00 грн" })).toContainText(
    "Внесок 500,00 грн · готівка ·",
  );
  await expect(history.filter({ hasText: "Внесок 1500,00 грн" })).toContainText(
    "Внесок 1500,00 грн · картка ·",
  );
  // Two payments, two commands; the store and the debt are the journal's own.
  expect(payments.bodies).toHaveLength(2);
  const [first, second] = payments.bodies as {
    command_id: string;
    amount: string;
    payment_method: string;
  }[];
  expect(Object.keys(first ?? {}).sort()).toEqual([
    "amount",
    "command_id",
    "payment_method",
  ]);
  expect(first?.amount).toBe("500.00");
  expect(first?.payment_method).toBe("CASH");
  expect(second?.amount).toBe("1500.00");
  expect(second?.payment_method).toBe("CARD");
  expect(first?.command_id).not.toBe(second?.command_id);

  // Settled debts leave the list of those who owe.
  await page.getByRole("button", { name: "До списку боргів" }).click();
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await expect(
    page.getByText("Боргів за таким ім’ям чи телефоном не знайдено."),
  ).toBeVisible();
  await page.getByLabel("Показати").selectOption("ALL");
  await expect(page.getByRole("article")).toContainText("Сплачено");
});

test("the till checks the customer's terms before anything is sent", async ({
  page,
}) => {
  const coat = await stocked(page);
  const sales = posts(page, "/api/v1/sales");
  await basket(page, coat);
  await page.getByLabel("Оплата частинами").check();
  const sell = page.getByRole("button", { name: "Готівка", exact: true });

  await sell.click();
  await expect(page.getByRole("alert")).toContainText(
    "Вкажіть ім’я покупця, який платить частинами.",
  );
  await page.getByLabel("Ім’я покупця").fill(customer());
  await page.getByLabel("Телефон покупця").fill("12345");
  await sell.click();
  await expect(page.getByRole("alert")).toContainText(
    "Телефон покупця має містити від 10 до 15 цифр.",
  );
  await page.getByLabel("Телефон покупця").fill("+380671234567");
  await sell.click();
  await expect(page.getByRole("alert")).toContainText(
    "Вкажіть, скільки покупець сплачує зараз",
  );
  await page.getByLabel("Сплачує зараз, грн").fill("3000");
  await sell.click();
  await expect(page.getByRole("alert")).toContainText(
    "Покупець сплачує все одразу (3000,00 грн) — це звичайний продаж.",
  );
  expect(sales.bodies).toEqual([]);

  // Unticked, the same basket is an ordinary sale.
  await page.getByLabel("Оплата частинами").uncheck();
  await sell.click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.getByText("Оплата частинами")).toHaveCount(0);
  expect(sales.bodies).toHaveLength(1);
  expect(sales.bodies[0]).not.toHaveProperty("credit");
});

test("a sale paid in parts whose answer is lost is resent with the same terms", async ({
  page,
}) => {
  const coat = await stocked(page);
  const sales = posts(page, "/api/v1/sales");
  let first = true;
  await page.route("**/api/v1/sales", async (route) => {
    if (first && route.request().method() === "POST") {
      first = false;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await basket(page, coat);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill(customer());
  await page.getByLabel("Телефон покупця").fill(newPhone());
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await page.getByRole("button", { name: "Готівка", exact: true }).click();

  await expect(page.getByText("Незавершений продаж")).toBeVisible();
  await page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click();
  await expect(page.getByText("Продаж підтверджено")).toBeVisible();
  await expect(
    page.getByText(/Оплата частинами: сплачено зараз 1000,00 грн/),
  ).toBeVisible();
  await expect(page.getByText(/покупець винен 2000,00 грн/)).toBeVisible();
  expect(sales.bodies).toHaveLength(2);
  expect(sales.bodies[1]).toEqual(sales.bodies[0]);
  expect((sales.bodies[0] as { payment_method: unknown }).payment_method).toBe(
    "CASH",
  );
  expect(sales.keys[1]).toBe(sales.keys[0]);
});

test("a payment whose answer is lost blocks the app until it is resent unchanged, and counts once", async ({
  page,
}) => {
  const name = customer();
  const { sale, token } = await onCredit(page, name);
  const payments = posts(page, "/payments");
  let first = true;
  await page.route("**/api/v1/credits/*/payments", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await debt(page, name);
  await page.getByLabel("Сума внеску, грн").fill("700");
  await paying(page).getByRole("button", { name: "Переказ" }).click();

  await expect(page.getByText("Незавершений внесок")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  // Written down before it was sent: a reload still knows what to ask
  // about, and asks at once, with no tap (ADR-0013 §4.3).
  await page.reload();
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await expect(page.getByText("Внесок підтверджено")).toBeVisible();
  await expect(
    page.getByText(`${name}: залишок боргу 1300,00 грн.`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  expect(payments.bodies).toHaveLength(2);
  expect(payments.bodies[1]).toEqual(payments.bodies[0]);
  expect(payments.keys[1]).toBe(payments.keys[0]);
  expect(
    (payments.bodies[0] as { payment_method: unknown }).payment_method,
  ).toBe("TRANSFER");
  expect(await owed(page, token, sale.credit.credit_id)).toBe("1300.00");
});

test("more than is owed is refused, and the debt is shown as it is now", async ({
  page,
}) => {
  const name = customer();
  const { sale, token } = await onCredit(page, name);
  const payments = posts(page, "/payments");
  await debt(page, name);

  await page.getByLabel("Сума внеску, грн").fill("2000,01");
  await paying(page).getByRole("button", { name: "Готівка" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Це більше, ніж винні: залишок боргу 2000,00 грн.",
  );
  expect(payments.bodies).toEqual([]);

  // Another seller takes 1500 meanwhile; this screen still shows 2000.
  const elsewhere = await page.request.post(
    `/api/v1/credits/${sale.credit.credit_id}/payments`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        command_id: randomUUID(),
        amount: "1500.00",
        payment_method: "CASH",
      },
    },
  );
  expect(elsewhere.status()).toBe(201);
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await paying(page).getByRole("button", { name: "Готівка" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Це більше, ніж винні: залишок боргу 500,00 грн.",
  );
  await expect(page.getByText("Незавершений внесок")).toHaveCount(0);
  await expect(page.locator(".debt")).toContainText("500,00 грн");
  expect(await owed(page, token, sale.credit.credit_id)).toBe("500.00");
});

test("the owner writes a debt off, saying why, and a seller is not offered it", async ({
  page,
}) => {
  const name = customer();
  const { sale, token } = await onCredit(page, name);
  await debt(page, name);

  await page.getByRole("button", { name: "Списати борг" }).click();
  await expect(
    page.getByText("Борг 2000,00 грн закриється без оплати."),
  ).toBeVisible();
  const confirm = page.getByRole("button", {
    name: "Так, списати 2000,00 грн",
  });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Чому списуємо").fill("виїхав за кордон");
  await confirm.click();
  await expect(page.getByText("Борг списано: 2000,00 грн.")).toBeVisible();
  await expect(page.locator("p.badge")).toHaveText("Списано");
  await expect(page.getByRole("list", { name: "Історія боргу" })).toContainText(
    "виїхав за кордон",
  );
  expect(await owed(page, token, sale.credit.credit_id)).toBe("0.00");

  const other = customer();
  await onCredit(page, other);
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "credit:write_off",
      );
    await route.fulfill({ response, json: body });
  });
  await debt(page, other);
  await expect(
    paying(page).getByRole("button", { name: "Готівка" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Списати борг" })).toHaveCount(
    0,
  );
});

test("a return of a sale paid in parts lowers the debt first, and says what cash goes back", async ({
  page,
}) => {
  const name = customer();
  const { model, sale, token } = await onCredit(page, name);
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await page.getByLabel("Пошук за назвою товару").fill(model);
  await page.getByRole("button", { name: "Знайти" }).click();
  await expect(page.getByRole("article")).toContainText("Оплата частинами");
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await expect(
    page.getByText("Цей продаж оплачували частинами."),
  ).toBeVisible();
  await page.getByLabel("Цілих").fill("1");
  // The till cannot say up front what goes back in cash.
  await expect(
    page.getByRole("button", { name: /Повернути покупцю/ }),
  ).toHaveCount(0);
  // How money would go back is the sale's way, asked only if any does
  // (ADR-0012 G5, G35): one payment, in cash.
  const way = page.getByRole("group", {
    name: "Як повертаємо гроші (якщо буде що повертати)",
  });
  await expect(way.getByRole("radio", { name: "Готівкою" })).toBeChecked();
  await page
    .getByRole("button", { name: "Оформити повернення на 1500,00 грн" })
    .click();

  // Paid 1000 of 3000, keeps a coat worth 1500: owes 500, gets nothing back.
  await expect(
    page.getByText("Борг покупця зменшено на 1500,00 грн."),
  ).toBeVisible();
  await expect(page.getByText("Грошей покупцю не повертаємо.")).toBeVisible();
  await expect(page.getByText("Покупець ще винен 500,00 грн.")).toBeVisible();

  // The last coat back, with its answer lost: the settled return still says
  // what to give back.
  let first = true;
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    if (first) {
      first = false;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await page.getByLabel("Цілих").fill("1");
  await page
    .getByRole("button", { name: "Оформити повернення на 1500,00 грн" })
    .click();
  await expect(page.getByText("Незавершене повернення")).toBeVisible();
  await page
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(
    page.getByText("Борг покупця зменшено на 500,00 грн."),
  ).toBeVisible();
  await expect(
    page.getByText("Поверніть покупцю 1000,00 грн готівкою."),
  ).toBeVisible();
  await expect(
    page.getByText("Покупець більше нічого не винен."),
  ).toBeVisible();
  expect(await owed(page, token, sale.credit.credit_id)).toBe("0.00");
});

/** What the store is owed now, through the API. */
async function storeOwed(page: Page, token: string): Promise<bigint> {
  const response = await page.request.get(
    `/api/v1/credits/summary?store_id=${fixture.store_id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const { owed: sum } = (await response.json()) as { owed: string };
  const [whole = "0", fraction = "00"] = sum.split(".");
  return BigInt(whole) * 100n + BigInt(fraction);
}

function hryvnias(kopecks: bigint): string {
  return `${String(kopecks / 100n)},${String(kopecks % 100n).padStart(2, "0")} грн`;
}

test("one phone is one customer, whatever the name, and the store sees what it is owed", async ({
  page,
}) => {
  const tel = newPhone();
  const name = customer();
  const first = await onCredit(
    page,
    `${name} Коваль`,
    `+38 (${tel.slice(0, 3)}) ${tel.slice(3)}`,
  );
  const before = await storeOwed(page, first.token);
  const second = await onCredit(page, name, tel);
  // The second debt adds what it leaves owing to the store's total.
  expect(await storeOwed(page, first.token)).toBe(before + 200000n);

  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Борги", exact: true }).click();
  const total = page.getByLabel("Скільки винні магазину");
  await expect(total).toContainText(
    `Магазину винні ${hryvnias(before + 200000n)}`,
  );
  // Found by the name only the older debt carries, then shown with both.
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(`${name} Коваль`);
  await page.getByRole("button", { name: "Знайти" }).click();
  const card = page.getByRole("article");
  await expect(card).toHaveCount(1);
  // The newest debt names the customer.
  await expect(card.locator("strong").first()).toHaveText(name);
  await expect(card).toContainText("Винні всього 4000,00 грн · боргів: 2");
  const debts = card.getByRole("list", { name: `Борги: ${name}` });
  await expect(debts.getByRole("listitem")).toHaveCount(2);

  // The seller chooses which debt the money goes to: the older one.
  await debts
    .getByRole("listitem")
    .nth(1)
    .getByRole("button", { name: /Відкрити борг/ })
    .click();
  await expect(
    page.getByRole("heading", { name: `${name} Коваль` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await paying(page).getByRole("button", { name: "Переказ" }).click();
  await expect(
    page.getByText(
      "Внесок 2000,00 грн прийнято переказом. Борг сплачено повністю.",
    ),
  ).toBeVisible();
  expect(await owed(page, first.token, first.sale.credit.credit_id)).toBe(
    "0.00",
  );
  expect(await owed(page, first.token, second.sale.credit.credit_id)).toBe(
    "2000.00",
  );

  await page.getByRole("button", { name: "До списку боргів" }).click();
  await expect(total).toContainText(`Магазину винні ${hryvnias(before)}`);
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(tel);
  await page.getByRole("button", { name: "Знайти" }).click();
  await expect(page.getByRole("article")).toContainText(
    "Винні всього 2000,00 грн",
  );
  await expect(page.getByRole("article").getByRole("listitem")).toHaveCount(1);
});

/** An order of two coats at 1500, sent and arrived — through the API. */
async function arrived(page: Page): Promise<Coat & { order: string }> {
  const coat = await stocked(page);
  const headers = { Authorization: `Bearer ${coat.token}` };
  const created = await page.request.post("/api/v1/orders", {
    headers,
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      carrier: "NOVA_POSHTA",
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          source_location_id: fixture.returns_location_id,
          quantity: 2,
          unit_price: "1500.00",
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const { id: order } = (await created.json()) as { id: string };
  for (const action of ["dispatch", "arrive"]) {
    const moved = await page.request.post(`/api/v1/orders/${order}/${action}`, {
      headers,
      data: { command_id: randomUUID() },
    });
    expect(moved.status()).toBe(200);
  }
  return { ...coat, order };
}

test("an order collected may be paid in parts, by the till's rules", async ({
  page,
}) => {
  const { model } = await arrived(page);
  const name = customer();
  const tel = newPhone();
  const collected = posts(page, "/collect");
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: new RegExp(model) }).click();
  await expect(
    page.getByText("Прибув на пошту", { exact: true }),
  ).toBeVisible();

  // The part paid now, in cash at the counter (ADR-0012 G2, G33).
  await page
    .getByRole("group", { name: "Як оплачено замовлення" })
    .getByRole("radio", { name: "Готівкою — зараз, на касі", exact: true })
    .check();
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill(name);
  await page.getByLabel("Телефон покупця").fill(tel);
  await page.getByLabel("Сплачує зараз, грн").fill("3000");
  const collect = page.getByRole("button", {
    name: "Клієнт забрав",
    exact: true,
  });
  await collect.click();
  await expect(page.getByRole("alert")).toContainText(
    "Покупець сплачує все одразу (3000,00 грн) — це звичайний продаж.",
  );
  expect(collected.bodies).toEqual([]);

  await page.getByLabel("Сплачує зараз, грн").fill("500");
  await expect(page.getByText("Лишиться винен 2500,00 грн")).toBeVisible();
  await collect.click();
  await expect(page.getByText("Продаж зафіксовано.")).toBeVisible();
  await expect(
    page.getByText(/Оплата частинами: сплачено 500,00 грн/),
  ).toBeVisible();
  await expect(page.getByText(/клієнт винен 2500,00 грн/)).toBeVisible();
  expect(collected.bodies).toHaveLength(1);
  const body = collected.bodies[0] as {
    command_id: string;
    credit: unknown;
    payment_method: unknown;
  };
  expect(body.credit).toEqual({
    customer_name: name,
    customer_phone: tel,
    paid_now: "500.00",
  });
  expect(body.payment_method).toBe("CASH");

  // A debt like any other, in this store's «Борги».
  await page.getByRole("button", { name: "Борги", exact: true }).click();
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(tel);
  await page.getByRole("button", { name: "Знайти" }).click();
  await expect(page.getByRole("article")).toContainText(
    "Винні 2500,00 грн з 3000,00 грн",
  );
  await expect(page.getByRole("article")).toContainText(model);
});

test("an order collected without paying in parts stays an ordinary sale", async ({
  page,
}) => {
  const { model } = await arrived(page);
  const collected = posts(page, "/collect");
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: new RegExp(model) }).click();
  const collect = page.getByRole("button", {
    name: "Клієнт забрав",
    exact: true,
  });
  // How it was paid is asked, never guessed: nothing is preselected, and
  // nothing is sent without it (owner decision, 2026-10-04).
  const paid = page.getByRole("group", { name: "Як оплачено замовлення" });
  await expect(paid.getByRole("radio")).toHaveCount(5);
  for (const radio of await paid.getByRole("radio").all())
    await expect(radio).not.toBeChecked();
  await collect.click();
  await expect(page.getByRole("alert")).toContainText(
    "Вкажіть, як оплачено замовлення.",
  );
  expect(collected.bodies).toEqual([]);
  await paid
    .getByRole("radio", { name: "Накладеним платежем", exact: true })
    .check();
  await collect.click();
  await expect(page.getByText("Продаж зафіксовано.")).toBeVisible();
  await expect(page.getByText(/Оплата частинами: сплачено/)).toHaveCount(0);
  expect(collected.bodies).toHaveLength(1);
  expect(collected.bodies[0]).not.toHaveProperty("credit");
  expect(
    (collected.bodies[0] as { payment_method: unknown }).payment_method,
  ).toBe("CARRIER_COD");
});

test("paying in parts needs its own permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => p !== "sale:credit");
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Продати — як платить покупець" }),
  ).toBeVisible();
  await expect(page.getByLabel("Оплата частинами")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Борги", exact: true }),
  ).toHaveCount(0);
});

test("collecting an order in parts needs the same permission", async ({
  page,
}) => {
  const { model } = await arrived(page);
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => p !== "sale:credit");
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: new RegExp(model) }).click();
  await expect(
    page.getByRole("button", { name: "Клієнт забрав", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Оплата частинами")).toHaveCount(0);
});
