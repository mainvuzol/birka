import {
  test,
  expect,
  basketDone,
  basketSheet,
  expectStub,
  fillLine,
  fromPaper,
  grn,
  more,
  openStore,
  toTill,
  readsOf,
  refuseOnce,
  returnUnits,
  section,
  tapSize,
  waitsFor,
  tillWays,
  sellsFrom,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
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
 *
 * A closed debt's customer is erased by the network's owner when the customer
 * asks, and every sum stays (owner decisions, 2026-10-09; ADR-0015).
 */
interface Fixture {
  telegram_user_id: string;
  /** Holds every permission network-wide: the network's owner. */
  owner_telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
  /** «Другий», where «Оля» works too, and its own warehouse. */
  second_store_id: string;
  second_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(telegramUserId: string = fixture.telegram_user_id): string {
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

function launch(telegramUserId?: string): string {
  return `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId) }).toString()}`;
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

/** Two coats in the till's basket, at 1500 each; typed from paper if said. */
async function basket(page: Page, coat: Coat, paper = false): Promise<void> {
  await sellsFrom(page, fixture.returns_location_id);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  // Ticked first: ticking it empties a basket (G20).
  if (paper) await fromPaper(page);
  // The warehouse holds every journey's own models: «Ще товари» is read
  // until this one is listed.
  await tapSize(page, coat.variant, coat.size);
  await fillLine(page, { quantity: 2, price: "1500" });
}

/** The till's ways to take a payment on a debt, under «Внесок». */
function paying(page: Page) {
  return page.getByRole("group", { name: "Внесок", exact: true });
}

/** «Борги»'s search, looked for as it is typed (credits task list, P0-1). */
function searchField(page: Page) {
  return page.getByLabel("Ім’я або телефон");
}

/** «Борги»'s rows, a customer each. */
function rows(page: Page) {
  return page.getByRole("list", { name: "Хто винен" }).getByRole("listitem");
}

/** One customer's row: the whole row opens their debt, or their debts. */
function customerRow(page: Page, name: string) {
  return page.getByRole("button", { name: `Відкрити борг: ${name},` });
}

/** «Борги», searched down to one customer, and that debt opened. */
async function debt(page: Page, name: string): Promise<void> {
  // A launch link that differs only in its hash would not reload the app.
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Борги");
  await searchField(page).fill(name);
  await expect(rows(page)).toHaveCount(1);
  await customerRow(page, name).click();
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

  await page.setViewportSize({ width: 360, height: 740 });
  // In the basket's sheet (spec S10; «Усе на бірці» task list, P0-5).
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  // What paying in parts means, in one line at 360 px (credits task list,
  // P1-5).
  const means = page.getByText("Решту — у «Боргах» цього магазину.", {
    exact: true,
  });
  await expect(means).toBeVisible();
  expect(await lines(means)).toBe(1);
  await page.getByLabel("Ім’я покупця").fill(name);
  // A new customer's number: «Борги» asked, and nothing said.
  const asked = bothAnswered(page, written);
  await page.getByLabel("Телефон покупця").fill(written);
  await asked;
  await page.waitForTimeout(300);
  await expect(page.locator(".number-debt")).toHaveText("");
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await expect(page.getByText("Лишиться винен 2 000,00 грн")).toBeVisible();
  // The keyboard's «Готово» after the sum closes the sheet (P0-5).
  await page.getByLabel("Сплачує зараз, грн").press("Enter");
  // The way is for the part paid now.
  await page.getByRole("button", { name: "Готівка", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  // What is paid now leads the stub (spec S11; «Усе на бірці» task list,
  // P0-2).
  await expectStub(page, {
    way: "Готівка",
    say: "У касу",
    sum: "Зараз 1 000,00 грн",
  });
  await expect(page.getByText("Покупець винен 2 000,00 грн")).toBeVisible();
  // Where the next payments go: the row's button (owner decision after
  // #141, 2026-10-26).
  await expect(
    page.getByText("Наступні внески — у «Продажі» › «Внесок».", { exact: true }),
  ).toBeVisible();
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
  // The next customer starts without these terms: the next coat's sheet
  // has the box unticked.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await tapSize(page, coat.variant, coat.size);
  await expect(
    (await basketSheet(page)).getByLabel("Оплата частинами"),
  ).not.toBeChecked();
  await basketDone(page);

  await section(page, "Борги");
  // Pasted from the phone's contacts, between the two invisible direction
  // marks they add: owed here, so its row, never the rule that nothing is
  // owed here (review, 2026-10-19).
  await searchField(page).fill(
    `\u202a+38 ${tel.slice(0, 3)} ${tel.slice(3)}\u202c`,
  );
  await expect(customerRow(page, name)).toBeVisible();
  await expect(page.getByText(/у цьому магазині боргів немає/)).toHaveCount(0);
  await searchField(page).fill(tel);
  // What is owed, never the sale's sum or a way (credits task list, P0-1).
  const row = customerRow(page, name);
  await expect(row).toHaveAccessibleName(
    `Відкрити борг: ${name}, винні 2 000,00 грн`,
  );
  await expect(row).toContainText(coat.model);
  await expect(row).toContainText("2 000,00 грн");
  await expect(row).not.toContainText("3 000,00");
  await expect(row).not.toContainText(/готівк|картк|переказ/i);
  await row.click();

  const payments = posts(page, "/payments");
  // «Прийняти внесок» is the way the customer pays (ADR-0012 G23).
  await expect(paying(page).getByRole("button")).toHaveText([
    "Готівка",
    "Картка",
    "Переказ",
  ]);
  // Nothing to press without a sum (credits task list, P0-4).
  for (const way of await paying(page).getByRole("button").all())
    await expect(way).toBeDisabled();
  await expect(paying(page)).toContainText("Впишіть суму внеску");
  await page.getByLabel("Сума внеску, грн").fill("500");
  await paying(page).getByRole("button", { name: "Готівка" }).click();
  // The result in place of the form (P0-5): what was done, the way, the sum
  // large, what is owed after — heard as one sentence.
  const paid = page.locator(".paid-result");
  await expect(
    paid.getByRole("heading", { name: "Внесок записано" }),
  ).toBeVisible();
  await expectStub(paid, { way: "Готівка", say: "У касу", sum: "500,00 грн" });
  await expect(paid.locator(".paid-owed")).toHaveText(
    "Залишок боргу 1 500,00 грн",
  );
  await expect(
    page.getByText(
      "Внесок 500,00 грн прийнято готівкою. Залишок боргу 1 500,00 грн.",
    ),
  ).toBeAttached();
  await expect(paying(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await expect(page.getByLabel("Сума внеску, грн")).toHaveValue("1500,00");
  await paying(page).getByRole("button", { name: "Картка" }).click();
  // By card, what to do (owner decision, 2026-10-18, В1 (а)).
  await expectStub(paid, {
    way: "Картка",
    say: "Проведіть на терміналі",
    sum: "1 500,00 грн",
  });
  await expect(paid.locator(".paid-owed")).toHaveText(
    "Борг сплачено повністю.",
  );
  await expect(
    page.getByText(
      "Внесок 1 500,00 грн прийнято карткою. Борг сплачено повністю.",
    ),
  ).toBeAttached();
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await expect(page.locator(".debt-closed .badge")).toHaveText("Сплачено");
  await expect(paying(page)).toHaveCount(0);
  const history = page
    .getByRole("list", { name: "Історія боргу" })
    .getByRole("listitem");
  await expect(history).toHaveCount(3);
  // A row an entry: what it was and how it was paid, then when and who,
  // its sum on the right; the first is the sale's own (P0-3).
  for (const [sum, what] of [
    ["1 000,00 грн", "Внесок · готівка"],
    ["500,00 грн", "Внесок · готівка"],
    ["1 500,00 грн", "Внесок · картка"],
  ] as const) {
    const row = history.filter({ has: page.getByText(sum, { exact: true }) });
    await expect(row.locator(".history-what")).toHaveText(what);
    await expect(row.locator(".history-meta")).toContainText(" · Оля");
  }
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
  await page.getByRole("button", { name: "До боргів" }).click();
  await searchField(page).fill(name);
  await expect(
    page.getByText(
      `За «${name}» боргів не знайдено. Перевірте ім’я або введіть номер телефону.`,
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Показати сплачені й списані" })
    .click();
  await expect(customerRow(page, name)).toContainText("Сплачено");
});

test("the till checks the customer's terms before anything is sent", async ({
  page,
}) => {
  const coat = await stocked(page);
  const sales = posts(page, "/api/v1/sales");
  await basket(page, coat);
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  const sell = page.getByRole("button", { name: "Готівка", exact: true });
  // Pressed with terms missing: the sheet opens again, what is missing said
  // in it, over its fields (P0-5).
  const said = page.getByRole("dialog", { name: "Кошик" }).getByRole("alert");
  const pressed = async (): Promise<void> => {
    await basketDone(page);
    await sell.click();
  };

  await pressed();
  await expect(said).toContainText(
    "Вкажіть ім’я покупця, який платить частинами.",
  );
  await page.getByLabel("Ім’я покупця").fill(customer());
  await page.getByLabel("Телефон покупця").fill("12345");
  await pressed();
  await expect(said).toContainText(
    "Телефон покупця має містити від 10 до 15 цифр.",
  );
  await page.getByLabel("Телефон покупця").fill("+380671234567");
  await pressed();
  await expect(said).toContainText("Вкажіть, скільки покупець сплачує зараз");
  await page.getByLabel("Сплачує зараз, грн").fill("3000");
  await pressed();
  await expect(said).toContainText(
    "Покупець сплачує все одразу (3 000,00 грн) — це звичайний продаж.",
  );
  expect(sales.bodies).toEqual([]);

  // Unticked, the same basket is an ordinary sale: the sheet taken once it
  // takes taps.
  await (await basketSheet(page)).getByLabel("Оплата частинами").uncheck();
  await pressed();
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
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill(customer());
  await page.getByLabel("Телефон покупця").fill(newPhone());
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await basketDone(page);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();

  await expect(page.getByText("Продаж ще не підтверджено")).toBeVisible();
  // Pressed — unless the phone, answered meanwhile by another read, checks
  // it by itself first: either way, the same sale under the same key.
  const settled = page.getByRole("heading", {
    name: "Продаж записано один раз",
  });
  const pressed = page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click()
    .catch(() => undefined);
  await Promise.race([pressed, settled.waitFor()]);
  await expect(settled).toBeVisible();
  await expect(
    page.getByText(/Оплата частинами: сплачено зараз 1\s000,00\sгрн/),
  ).toBeVisible();
  await expect(page.getByText(/покупець винен 2\s000,00\sгрн/)).toBeVisible();
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

  // Which payment: its sum, way and goods, as the attempt kept them (P1-2).
  await expect(
    page.getByRole("heading", { name: "Внесок ще не підтверджено" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /^Внесок 700,00\sгрн переказом за «.+» — сервер не відповів\. Двічі він не запишеться\. Поки чекаємо, інші дії недоступні\.$/,
    ),
  ).toBeVisible();
  await waitsFor(page, /^Внесок ще не підтверджено$/);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  // Written down before it was sent: a reload still knows what to ask
  // about, and asks at once, with no tap (ADR-0013 §4.3).
  await page.reload();
  await openStore(page, "Основний MAIN");
  await expect(
    page.getByRole("heading", { name: "Внесок записано один раз" }),
  ).toBeVisible();
  await expect(
    page.getByText(`${name}: залишок боргу 1 300,00 грн.`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  expect(payments.bodies).toHaveLength(2);
  expect(payments.bodies[1]).toEqual(payments.bodies[0]);
  expect(payments.keys[1]).toBe(payments.keys[0]);
  // The goods are kept for the banner only, never sent.
  expect(payments.bodies[0]).not.toHaveProperty("goods");
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
    "Це більше, ніж винні: залишок боргу 2 000,00 грн.",
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
  await expect(
    page.getByRole("heading", { name: "Внесок ще не підтверджено" }),
  ).toHaveCount(0);
  // Read again: what is owed now, large.
  await expect(
    page.getByRole("group", { name: "Скільки винні" }).locator(".owed-sum"),
  ).toHaveText("500,00 грн");
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
    page.getByText("Борг 2 000,00 грн закриється без оплати."),
  ).toBeVisible();
  // Names are erased from a debt in time; written in its reason, they would
  // stay (owner decision, 2026-10-09).
  await expect(page.getByLabel("Чому списуємо")).toHaveAccessibleName(
    "Чому списуємо",
  );
  await expect(page.getByLabel("Чому списуємо")).toHaveAccessibleDescription(
    "Без імен і телефонів покупців.",
  );
  await expect(page.getByText("Без імен і телефонів покупців.")).toBeVisible();
  const confirm = page.getByRole("button", {
    name: "Так, списати 2 000,00 грн",
  });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Чому списуємо").fill("виїхав за кордон");
  await confirm.click();
  await expect(
    page.locator(".paid-result").getByRole("heading", { name: "Борг списано" }),
  ).toBeVisible();
  await expect(page.locator(".paid-result .hand-back-sum")).toHaveText(
    "2 000,00 грн",
  );
  await expect(page.getByText("Борг списано: 2 000,00 грн.")).toBeAttached();
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await expect(page.locator(".debt-closed .badge")).toHaveText("Списано");
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
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Повернення");
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  // Its own sale, never the recent ones still shown while the search is
  // read (it raced them on a loaded machine, 2026-10-22).
  const sold = page.getByRole("article").filter({ hasText: model });
  await expect(sold).toContainText("Оплата частинами");
  await sold.getByRole("button", { name: "Оформити повернення" }).click();
  await expect(page.locator(".sale-marks")).toHaveText("Оплата частинами");
  // In the debt's colours (returns task list, P2-4).
  await expect(page.locator(".sale-marks .badge")).toHaveClass(/\bdebt\b/);
  await returnUnits(page, { intact: 1 });
  // The till cannot say up front what goes back in cash (owner decision,
  // 2026-10-17, В6 (а)): the goods' worth, and what comes after.
  await expect(
    page.getByRole("button", { name: /Повернути покупцю/ }),
  ).toHaveCount(0);
  const panel = page.getByRole("group", { name: "Повернення: сума і спосіб" });
  await expect(panel.locator(".pay-total")).toHaveText("Товар на 1 500,00 грн");
  await expect(panel).toContainText(
    "Спершу зменшимо борг; скільки віддати — покажемо після.",
  );
  // How money would go back is the sale's way, asked only if any does
  // (ADR-0012 G5, G35): one payment, in cash.
  const way = page.getByRole("group", {
    name: "Як повертаємо гроші (якщо буде що повертати)",
  });
  await expect(way.getByRole("radio", { name: "Готівкою" })).toBeChecked();
  await page
    .getByRole("button", { name: "Повернути товар на 1 500,00 грн" })
    .click();

  // Paid 1000 of 3000, keeps a coat worth 1500: owes 500, gets nothing back.
  await expect(page.locator(".hand-back-sum")).toHaveText("0,00 грн");
  await expect(
    page.getByText("Борг покупця зменшено на 1 500,00 грн."),
  ).toBeVisible();
  await expect(page.getByText("Грошей покупцю не повертаємо.")).toBeVisible();
  await expect(page.getByText("Покупець ще винен 500,00 грн.")).toBeVisible();
  // A mistake with a sale in parts is the owner's (owner decision,
  // 2026-10-17, В2 (а); P1-5).
  await expect(
    page.getByText(
      "Помилилися з поверненням? Помилку з продажем частинами вирішує власник.",
      { exact: true },
    ),
  ).toBeVisible();

  // The last coat back, with its answer lost: the settled return still says
  // what to give back.
  let first = true;
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    if (first) {
      first = false;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Ще повернення" }).click();
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await returnUnits(page, { intact: 1 });
  await page
    .getByRole("button", { name: "Повернути товар на 1 500,00 грн" })
    .click();
  // In parts, the banner names the goods and no sum: the cash is the
  // server's to work out (returns task list, P1-2).
  await expect(
    page.getByText(
      new RegExp(
        `^Повернення частинами: ${model}.* · [^ ]+ × 1 — сервер не відповів\\.`,
      ),
    ),
  ).toBeVisible();
  // «Повернення ще не підтверджено», or «Перевіряємо повернення…» while the
  // phone checks it by itself.
  await waitsFor(page, /повернення/i);
  await page
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(
    page.getByText("Борг покупця зменшено на 500,00 грн."),
  ).toBeVisible();
  // Confirmed later: to give the cash back only if nobody did (owner,
  // 2026-10-08), never plainly.
  await expect(
    page.getByText(
      "Якщо гроші ще не повернули — поверніть покупцю 1 000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Готівка · Поверніть покупцю")).toHaveCount(0);
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

/** Both of «Борги»'s answers for a number at the till read — this store's
 * and the closed stores' — before anything is said of it. */
function bothAnswered(page: Page, query: string): Promise<unknown> {
  const of = (elsewhere: boolean) =>
    page.waitForResponse((response) => {
      if (!response.url().includes("/credits/customers?")) return false;
      const params = new URL(response.url()).searchParams;
      return (
        params.get("query") === query &&
        (params.get("elsewhere") === "true") === elsewhere
      );
    });
  return Promise.all([of(false), of(true)]);
}

/** How many lines a piece of text takes, by its height and line height. */
async function lines(text: Locator): Promise<number> {
  return text.evaluate((node) => {
    const style = getComputedStyle(node);
    return Math.round(
      node.getBoundingClientRect().height / parseFloat(style.lineHeight),
    );
  });
}

test("the till says what a number already owes, and still sells in parts as the seller decides", async ({
  page,
}) => {
  const tel = newPhone();
  // Written down as «+38 …»: a number that merely holds the digits typed is
  // never taken for it (review, 2026-10-19).
  const prior = await onCredit(page, customer(), `+38 ${tel}`);
  const coat = await stocked(page);
  // A second, for the same number's next sale, on the shelf the till reads.
  const more = await stocked(page);
  const name = customer();
  const sales = posts(page, "/api/v1/sales");
  await page.setViewportSize({ width: 360, height: 740 });
  await basket(page, coat);
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill(name);
  // Written another way than the debt's: the same number (owner decision,
  // 2026-10-18, В4 (а); credits task list, P1-5).
  const written = `+38 (${tel.slice(0, 3)}) ${tel.slice(3)}`;
  const queries: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/credits/customers?"))
      queries.push(new URL(request.url()).searchParams.get("query") ?? "");
  });
  // The line's room is kept once the number is whole: nothing under it
  // moves when it comes (review, 2026-10-19).
  const sum = page.getByLabel("Сплачує зараз, грн");
  await page.getByLabel("Телефон покупця").fill(written);
  const before = await sum.boundingBox();
  const owes = page.locator(".number-debt");
  await expect(owes).toHaveText("За номером уже винні 2 000,00 грн");
  await expect(owes.locator(".owing")).toHaveText(
    "За номером уже винні 2 000,00 грн",
  );
  expect(await lines(owes)).toBe(1);
  expect((await sum.boundingBox())?.y).toBe(before?.y);
  // Another digit is another number: the line goes at once — never the
  // number before it while the field settles.
  const other = `${written.slice(0, -1)}${written.endsWith("9") ? "8" : "9"}`;
  await page.getByLabel("Телефон покупця").fill(other);
  expect(await owes.textContent()).toBe("");
  // The start of the debt's «+38 …», ten digits: read, and another number.
  const start = `+38 ${tel.slice(0, 8)}`;
  const read = bothAnswered(page, start);
  await page.getByLabel("Телефон покупця").fill(start);
  await read;
  await page.waitForTimeout(300);
  await expect(owes).toHaveText("");
  // Part of a number is no number: «Борги» not even asked.
  const part = tel.slice(0, 8);
  await page.getByLabel("Телефон покупця").fill(part);
  await page.waitForTimeout(500);
  await expect(owes).toHaveText("");
  expect(queries).not.toContain(part);
  await page.getByLabel("Телефон покупця").fill(written);
  await expect(owes).toHaveText("За номером уже винні 2 000,00 грн");
  // Nothing refused: sold in parts as any sale.
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await basketDone(page);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect((sales.bodies[0] as { credit: unknown }).credit).toEqual({
    customer_name: name,
    customer_phone: written,
    paid_now: "1000.00",
  });

  // The older debt paid off elsewhere meanwhile; the same number again, in
  // the same app: what it owes now, never a sum read before, not even for a
  // moment (review, 2026-10-19).
  await payOff(page, prior.token, prior.sale.credit.credit_id);
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await tapSize(page, more.variant, more.size);
  await fillLine(page, { quantity: 2, price: "1500" });
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill(name);
  // Every text the line takes, as it is drawn.
  await owes.evaluate((node) => {
    const seen: string[] = [];
    (window as unknown as { said: string[] }).said = seen;
    new MutationObserver(() => {
      const text = node.textContent;
      if (text) seen.push(text.replace(/\s/g, " "));
    }).observe(node, { subtree: true, childList: true, characterData: true });
  });
  await page.getByLabel("Телефон покупця").fill(written);
  await expect(owes).toHaveText("За номером уже винні 2 000,00 грн");
  expect(
    new Set(
      await page.evaluate(() => (window as unknown as { said: string[] }).said),
    ),
  ).toEqual(new Set(["За номером уже винні 2 000,00 грн"]));
});

test("the till says a number's debt was written off, and says nothing when «Борги» cannot be read, the sale going on", async ({
  page,
}) => {
  const coat = await stocked(page);
  let answer: "owes a lot" | "written off" | "nothing here" | "failed" =
    "owes a lot";
  // The stores that do not trade, asked of the same number: nothing owed
  // there, until said otherwise.
  let away: unknown[] = [];
  let awayFails = false;
  // Slower than this store's: the lines still come together.
  let awayDelay = 400;
  const awayAsked: URLSearchParams[] = [];
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("elsewhere") === "true") {
      awayAsked.push(params);
      await new Promise((resolve) => setTimeout(resolve, awayDelay));
      if (awayFails)
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL_ERROR", message: "Internal error" },
        });
      else await route.fulfill({ json: { items: away, has_more: false } });
      return;
    }
    if (answer === "nothing here") {
      await route.fulfill({ json: { items: [], has_more: false } });
      return;
    }
    if (answer === "failed") {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    if (answer === "owes a lot") {
      // Owed, and a debt written off before: what is owed is said.
      await route.fulfill({
        json: {
          items: [
            {
              phone_digits: "0671234567",
              customer_name: "Оксана",
              customer_phone: "067 123 45 67",
              owed: "123456.00",
              open_debts: 1,
              credits: [
                {
                  id: randomUUID(),
                  status: "WRITTEN_OFF",
                  owed: "0.00",
                  written_off: "800.00",
                  closed_at: "2026-03-12T10:00:00Z",
                },
              ],
            },
          ],
          has_more: false,
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            phone_digits: "0671234567",
            customer_name: "Оксана",
            customer_phone: "067 123 45 67",
            owed: "0.00",
            open_debts: 0,
            credits: [
              {
                id: randomUUID(),
                status: "WRITTEN_OFF",
                owed: "0.00",
                written_off: "800.00",
                closed_at: "2026-03-12T10:00:00Z",
              },
              // An older write-off, listed after: the latest is said.
              {
                id: randomUUID(),
                status: "WRITTEN_OFF",
                owed: "0.00",
                written_off: "300.00",
                closed_at: "2025-11-05T10:00:00.123456Z",
              },
              {
                id: randomUUID(),
                status: "SETTLED",
                owed: "0.00",
                written_off: "0.00",
                closed_at: "2026-05-02T10:00:00Z",
              },
            ],
          },
        ],
        has_more: false,
      },
    });
  });
  const sales = posts(page, "/api/v1/sales");
  await page.setViewportSize({ width: 360, height: 740 });
  await basket(page, coat);
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill("Оксана");
  await page.getByLabel("Телефон покупця").fill("067 123 45 67");
  const said = page.locator(".number-debt");
  // Six figures owed, still one line at 360 px.
  await expect(said).toHaveText("За номером уже винні 123 456,00 грн");
  expect(await lines(said)).toBe(1);
  answer = "written off";
  await page.getByLabel("Телефон покупця").fill("+38 067 123 45 67");
  // Neutral: what was, not a debt owed (owner decision, 2026-10-18, В4 (а)).
  await expect(said).toHaveText("За номером борг списано 12.03.2026");
  await expect(said.locator(".owing")).toHaveCount(0);

  // A closed store's debt of the number, whose payments are taken here, on
  // a line of its own (owner decision, 2026-10-19) — with this store's,
  // both lines together, never one and then the other.
  away = [
    {
      phone_digits: "0671234567",
      customer_name: "Оксана",
      customer_phone: "067 123 45 67",
      owed: "1500.00",
      open_debts: 1,
      credits: [
        {
          id: randomUUID(),
          status: "OPEN",
          store_id: randomUUID(),
          store_name: "Ринок",
          owed: "1500.00",
          written_off: "0.00",
          closed_at: null,
        },
      ],
    },
  ];
  answer = "owes a lot";
  await said.evaluate((node) => {
    const seen: string[] = [];
    (window as unknown as { said: string[] }).said = seen;
    new MutationObserver(() => {
      const text = node.textContent;
      if (text) seen.push(text.replace(/\s/g, " "));
    }).observe(node, { subtree: true, childList: true, characterData: true });
  });
  await page.getByLabel("Телефон покупця").fill("067 123 45 67");
  await expect(said.locator("span")).toHaveText([
    "За номером уже винні 123 456,00 грн",
    "Винні 1 500,00 грн магазину «Ринок»",
  ]);
  await expect(said.locator(".owing")).toHaveCount(2);
  expect(
    new Set(
      await page.evaluate(() => (window as unknown as { said: string[] }).said),
    ),
  ).toEqual(
    new Set([
      "За номером уже винні 123 456,00 грнВинні 1 500,00 грн магазину «Ринок»",
    ]),
  );
  // Asked of the closed stores by the whole number, for what is still owed.
  const asked = awayAsked.at(-1);
  expect(asked?.get("query")).toBe("067 123 45 67");
  expect(asked?.get("status")).toBe("OPEN");
  // Owed only there: its line alone, in the room kept.
  answer = "nothing here";
  await page.getByLabel("Телефон покупця").fill("+38 067 123 45 67");
  await expect(said.locator("span")).toHaveText([
    "Винні 1 500,00 грн магазину «Ринок»",
  ]);
  expect(await lines(said)).toBe(1);
  // Written off here and owed in a closed store: what is owed, alone, as
  // what is owed here is said over a write-off (owner decision, 2026-10-21)
  // — the write-off never said, even for a moment, though the closed stores
  // answer later than this store's debt waits for them (review,
  // 2026-10-21).
  answer = "written off";
  const owedAtRynok = away;
  for (const [delay, typed] of [
    [400, "067 123 45 67"],
    [2500, "+38 (067) 123 45 67"],
  ] as const) {
    awayDelay = delay;
    await page.evaluate(() => {
      (window as unknown as { said: string[] }).said.length = 0;
    });
    const writtenOffHere = bothAnswered(page, typed);
    await page.getByLabel("Телефон покупця").fill(typed);
    await writtenOffHere;
    await expect(said.locator("span")).toHaveText([
      "Винні 1 500,00 грн магазину «Ринок»",
    ]);
    expect(await lines(said)).toBe(1);
    expect(
      (
        await page.evaluate(
          () => (window as unknown as { said: string[] }).said,
        )
      ).filter((text) => text.includes("списано")),
    ).toEqual([]);
  }
  // Owing nowhere, the closed stores slow: the write-off, once they answer.
  away = [];
  const nowhere = bothAnswered(page, "0671234567");
  await page.getByLabel("Телефон покупця").fill("0671234567");
  await nowhere;
  await expect(said).toHaveText("За номером борг списано 12.03.2026");
  awayDelay = 400;
  away = owedAtRynok;
  answer = "nothing here";
  // One line however long: the sum first, a long name cut, never the sum
  // (review, 2026-10-20). Two stores; then one, its name long, six figures.
  const owedAway = (
    owed: string,
    stores: { name: string; owed: string }[],
  ): unknown[] => [
    {
      phone_digits: "0671234567",
      customer_name: "Оксана",
      customer_phone: "067 123 45 67",
      owed,
      open_debts: stores.length,
      credits: stores.map((store) => ({
        id: randomUUID(),
        status: "OPEN",
        store_id: randomUUID(),
        store_name: store.name,
        owed: store.owed,
        written_off: "0.00",
        closed_at: null,
      })),
    },
  ];
  away = owedAway("1500.00", [
    { name: "Ринок", owed: "1000.00" },
    { name: "Ринок", owed: "500.00" },
  ]);
  await page.getByLabel("Телефон покупця").fill("(067) 123-45-67");
  await expect(said.locator(".away")).toHaveText(
    "Винні 1 500,00 грн магазинам, що не працюють",
  );
  expect(await lines(said.locator(".away"))).toBe(1);
  away = owedAway("123456.00", [
    { name: "Барабашова Центральний Великий Ринок", owed: "123456.00" },
  ]);
  await page.getByLabel("Телефон покупця").fill("067-123-45-67");
  await expect(said.locator(".away")).toHaveText(
    "Винні 123 456,00 грн магазину «Барабашова Центральний Великий Ринок»",
  );
  expect(await lines(said.locator(".away"))).toBe(1);
  expect(await lines(said)).toBe(1);
  // The closed stores failing, or slow: this store's line all the same.
  answer = "owes a lot";
  awayFails = true;
  awayDelay = 0;
  // Not waited for once they fail: at once, well before the moment and a
  // half a slow answer is given.
  await page.getByLabel("Телефон покупця").fill("067.123.45.67");
  await expect(said.locator("span")).toHaveText(
    ["За номером уже винні 123 456,00 грн"],
    { timeout: 1000 },
  );
  awayFails = false;
  away = [];
  awayDelay = 5000;
  const slow = bothAnswered(page, "+380671234567");
  await page.getByLabel("Телефон покупця").fill("+380671234567");
  await expect(said.locator("span")).toHaveText(
    ["За номером уже винні 123 456,00 грн"],
    { timeout: 3000 },
  );
  // Its late answer let through before going on.
  await slow;
  awayDelay = 400;

  // «Борги» not read: nothing said, and the sale as any.
  answer = "failed";
  const failed = bothAnswered(page, "067 765 43 21");
  await page.getByLabel("Телефон покупця").fill("067 765 43 21");
  await failed;
  await page.waitForTimeout(300);
  await expect(said).toHaveText("");
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await basketDone(page);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  expect(sales.bodies).toHaveLength(1);
});

function hryvnias(kopecks: bigint): string {
  return grn(
    `${String(kopecks / 100n)}.${String(kopecks % 100n).padStart(2, "0")}`,
  );
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
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Борги");
  const total = page.getByLabel("Скільки винні магазину");
  await expect(total).toContainText("Магазину винні");
  await expect(total.locator(".owed-sum")).toHaveText(
    hryvnias(before + 200000n),
  );
  // Found by the name only the older debt carries, then shown with both.
  await searchField(page).fill(`${name} Коваль`);
  await expect(rows(page)).toHaveCount(1);
  // The newest debt names the customer; what they owe in all, as summed.
  const row = customerRow(page, name);
  await expect(row).toHaveAccessibleName(
    `Відкрити борг: ${name}, винні 4 000,00 грн`,
  );
  await expect(row).toContainText("2 борги");
  await row.click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator(".owed-sum")).toHaveText("4 000,00 грн");
  const debts = page.getByRole("list", { name: `Борги: ${name}` });
  await expect(debts.getByRole("listitem")).toHaveCount(2);

  // The seller chooses which debt the money goes to: the older one.
  await debts.getByRole("listitem").nth(1).getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: `${name} Коваль` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await paying(page).getByRole("button", { name: "Переказ" }).click();
  const paid = page.locator(".paid-result");
  await expectStub(paid, {
    way: "Переказ",
    say: "Перевірте, що переказ надійшов",
  });
  await expect(paid.locator(".paid-owed")).toHaveText(
    "Борг сплачено повністю.",
  );
  await expect(
    page.getByText(
      "Внесок 2 000,00 грн прийнято переказом. Борг сплачено повністю.",
    ),
  ).toBeAttached();
  expect(await owed(page, first.token, first.sale.credit.credit_id)).toBe(
    "0.00",
  );
  expect(await owed(page, first.token, second.sale.credit.credit_id)).toBe(
    "2000.00",
  );

  // Back to the customer's debts, by their name, as «←» says, read again:
  // one is left (review, 2026-10-18).
  await paid.getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".owed-sum")).toHaveText("2 000,00 грн");
  await expect(debts.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "До боргів" }).click();
  await expect(total.locator(".owed-sum")).toHaveText(hryvnias(before));
  await searchField(page).fill(tel);
  await expect(customerRow(page, name)).toHaveAccessibleName(
    `Відкрити борг: ${name}, винні 2 000,00 грн`,
  );
  await expect(rows(page)).toHaveCount(1);
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
  await openStore(page, "Основний MAIN");
  await toTill(page);
  // The till opens first (redesign P0-1); the order is in «Замовлення».
  await section(page, "Замовлення");
  await page.getByRole("button", { name: new RegExp(model) }).click();
  await expect(
    page.getByText("Прибув на пошту", { exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 360, height: 740 });
  await page.getByLabel("Оплата частинами").check();
  // One line at 360 px (credits task list, P1-5).
  const means = page.getByText("Решту — у «Боргах» цього магазину.", {
    exact: true,
  });
  await expect(means).toBeVisible();
  expect(await lines(means)).toBe(1);
  await page.getByLabel("Ім’я покупця").fill(name);
  // What the number owes, asked of the order's store (review, 2026-10-19).
  const askedOf: (string | null)[] = [];
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    askedOf.push(params.get("store_id"));
    if (params.get("elsewhere") === "true") {
      await route.fulfill({ json: { items: [], has_more: false } });
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            phone_digits: tel,
            customer_name: name,
            customer_phone: tel,
            owed: "700.00",
            open_debts: 1,
            credits: [],
          },
        ],
        has_more: false,
      },
    });
  });
  await page.getByLabel("Телефон покупця").fill(tel);
  await expect(page.locator(".number-debt")).toHaveText(
    "За номером уже винні 700,00 грн",
  );
  expect(new Set(askedOf)).toEqual(new Set([fixture.store_id]));
  await page.unroute("**/api/v1/credits/customers?**");
  await page.getByLabel("Сплачує зараз, грн").fill("3000");
  // The part paid now, in cash at the counter (ADR-0012 G2, G33): the way
  // is the step itself (orders task list, P0-3).
  const collect = page
    .getByRole("group", { name: "Клієнт забрав — як оплачено?" })
    .getByRole("button", { name: "Готівка", exact: true });
  await collect.click();
  await expect(page.getByRole("alert")).toContainText(
    "Покупець сплачує все одразу (3 000,00 грн) — це звичайний продаж.",
  );
  expect(collected.bodies).toEqual([]);

  await page.getByLabel("Сплачує зараз, грн").fill("500");
  await expect(page.getByText("Лишиться винен 2 500,00 грн")).toBeVisible();
  // As the till's panel says it.
  await expect(page.locator(".order-panel .pay-total")).toHaveText(
    /^Зараз 500,00\sгрн · винен 2\s500,00\sгрн$/,
  );
  await collect.click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  // The part paid now large, what is owed from the server's answer.
  await expect(page.locator(".order-collected .hand-back-sum")).toHaveText(
    "500,00 грн",
  );
  await expect(page.locator(".order-collected .paid-owed")).toHaveText(
    /^Покупець винен 2\s500,00\sгрн\. Наступні внески — у «Боргах»\.$/,
  );
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
  await section(page, "Борги");
  await searchField(page).fill(tel);
  const row = customerRow(page, name);
  await expect(row).toHaveAccessibleName(
    `Відкрити борг: ${name}, винні 2 500,00 грн`,
  );
  await expect(row).toContainText(model);
});

test("an order collected without paying in parts stays an ordinary sale", async ({
  page,
}) => {
  const { model } = await arrived(page);
  const collected = posts(page, "/collect");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  // The till opens first (redesign P0-1); the order is in «Замовлення».
  await section(page, "Замовлення");
  await page.getByRole("button", { name: new RegExp(model) }).click();
  // How it was paid is asked, never guessed: nothing is preselected, and
  // nothing is sent until a way is pressed (owner decision, 2026-10-04;
  // orders task list, P0-3).
  const paid = page.getByRole("group", {
    name: "Клієнт забрав — як оплачено?",
  });
  await expect(paid.getByRole("button")).toHaveCount(5);
  for (const way of await paid.getByRole("button").all())
    await expect(way).not.toHaveAttribute("aria-pressed");
  expect(collected.bodies).toEqual([]);
  const collect = paid.getByRole("button", {
    name: "Накладений платіж",
    exact: true,
  });
  // Refused at its first press, «not found»: nothing kept, so the shared
  // words — never «ще не підтверджено» (review, 2026-10-20).
  const answers = [404, 500];
  await page.route("**/api/v1/orders/*/collect", async (route) => {
    const status = answers.shift();
    if (status === undefined) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status,
      json: {
        code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
        message: "Refused",
      },
    });
  });
  await collect.click();
  await expect(
    page.getByText("Не вдалося виконати операцію. Спробуйте ще раз.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/ще не підтверджено/)).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Операцію «Клієнт забрав» ще не підтверджено",
    }),
  ).toHaveCount(0);
  // A server's error at its first press: kept, unconfirmed, and named from
  // the first, not only once resent (review, 2026-10-20).
  await collect.click();
  await expect(
    page.getByText(
      "Операцію «Клієнт забрав» ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі вона не запишеться.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Перевірити результат замовлення" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.getByText(/Покупець винен/)).toHaveCount(0);
  expect(collected.bodies).toHaveLength(3);
  // Resent as it was first sent.
  expect(collected.bodies[2]).toEqual(collected.bodies[1]);
  expect(collected.bodies[2]).not.toHaveProperty("credit");
  expect(
    (collected.bodies[2] as { payment_method: unknown }).payment_method,
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
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(page.getByLabel("Оплата частинами")).toHaveCount(0);
  // «Замовлення» opens the orders, with no switch to debts; «Ще» has no
  // «Борги» (navigation task list, P0-2; «Усе на бірці» task list, P0-4).
  await section(page, "Замовлення");
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Борги або замовлення" }),
  ).toHaveCount(0);
  await more(page);
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
  await openStore(page, "Основний MAIN");
  await toTill(page);
  // The till opens first (redesign P0-1); the order is in «Замовлення».
  await section(page, "Замовлення");
  await page.getByRole("button", { name: new RegExp(model) }).click();
  await expect(
    page.getByRole("group", { name: "Клієнт забрав — як оплачено?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Оплата частинами")).toHaveCount(0);
});

/** Pay off what is left of a debt, through the API. */
async function payOff(page: Page, token: string, id: string): Promise<void> {
  const paid = await page.request.post(`/api/v1/credits/${id}/payments`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      command_id: randomUUID(),
      amount: await owed(page, token, id),
      payment_method: "CASH",
    },
  });
  expect(paid.status()).toBe(201);
}

/** «Борги» of every state, searched down to one customer. */
async function everyDebtOf(
  page: Page,
  query: string,
  telegramUserId?: string,
): Promise<void> {
  await page.goto("about:blank");
  await page.goto(launch(telegramUserId));
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Борги");
  await page
    .getByRole("button", { name: "Показати сплачені й списані" })
    .click();
  await expect(
    page.getByRole("button", { name: "Лише ті, хто винен" }),
  ).toBeVisible();
  if (query) await searchField(page).fill(query);
}

test("the network's owner erases a closed debt's customer who asks, and every sum stays", async ({
  page,
}) => {
  const name = customer();
  const phone = newPhone();
  const paidOff = await onCredit(page, name, phone);
  await payOff(page, paidOff.token, paidOff.sale.credit.credit_id);
  const stillOwed = await onCredit(page, name, phone);

  await everyDebtOf(page, name, fixture.owner_telegram_user_id);
  await expect(rows(page)).toHaveCount(1);
  // Two debts: the customer's, and the paid one chosen.
  await customerRow(page, name).click();
  await page.getByRole("button", { name: /, сплачено$/ }).click();
  // «Скасувати» changes nothing.
  await page.getByRole("button", { name: "Стерти дані покупця" }).click();
  await page.getByRole("button", { name: "Скасувати" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.getByRole("button", { name: "Стерти дані покупця" }).click();
  await expect(
    page.getByText(
      "Ім’я й телефон покупця зникнуть з усіх закритих боргів мережі з цим телефоном. Суми лишаються. Скасувати це не можна.",
    ),
  ).toBeVisible();
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25).
  // The debt itself, never the list or the summary.
  const debtReads = readsOf(
    page,
    /\/api\/v1\/credits\/(?!summary$|customers$)[^/]+$/,
  );
  await refuseOnce(page, "**/api/v1/credits/*/erase-customer", 409);
  await page.getByRole("button", { name: "Так, стерти дані покупця" }).click();
  await expect(
    page.getByText(
      "Дані покупця не стерто: борг щойно змінився — перегляньте його й спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(debtReads).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Стерти дані покупця" }).click();
  await page.getByRole("button", { name: "Так, стерти дані покупця" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Дані покупця стерто із закритих боргів: 1. Відкритих боргів цього покупця: 1. З них дані не стирають; коли їх закриють, стерти можна так само.",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Покупця стерто",
  );
  await expect(page.getByText(/^Ім’я й телефон стерто /)).toBeVisible();
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator(".debt-closed")).toContainText("з 3 000,00 грн");
  await expect(page.locator(".debt-closed .badge")).toHaveText("Сплачено");
  await expect(
    page.getByRole("button", { name: "Стерти дані покупця" }),
  ).toHaveCount(0);

  // Found by neither the name nor the phone: only the debt still owed is.
  for (const query of [name, phone]) {
    await everyDebtOf(page, query, fixture.owner_telegram_user_id);
    await expect(rows(page)).toHaveCount(1);
    await expect(customerRow(page, name)).toHaveAccessibleName(
      `Відкрити борг: ${name}, винні 2 000,00 грн`,
    );
  }
  // Every debt listed, it stands alone, with no name and no phone.
  await everyDebtOf(page, "", fixture.owner_telegram_user_id);
  // Each journey sells a model of its own.
  const alone = page
    .getByRole("button", { name: /^Відкрити борг: Покупця стерто, / })
    .filter({ hasText: paidOff.model });
  await expect(alone).toHaveCount(1);
  await expect(alone.locator(".debt-name")).toHaveText("Покупця стерто");
  await expect(alone).not.toContainText(phone);
  await expect(alone).toContainText("Сплачено");
  const erased = await page.request.get(
    `/api/v1/credits/${paidOff.sale.credit.credit_id}`,
    { headers: { Authorization: `Bearer ${paidOff.token}` } },
  );
  expect(
    ((await erased.json()) as { customer_name: string | null }).customer_name,
  ).toBeNull();
  expect(
    await owed(page, stillOwed.token, stillOwed.sale.credit.credit_id),
  ).toBe("2000.00");
});

test("a store's owner erases in that store, and nobody erases an open debt", async ({
  page,
}) => {
  const name = customer();
  const closed = await onCredit(page, name);
  await payOff(page, closed.token, closed.sale.credit.credit_id);

  // «Оля» holds every permission in her stores, not network-wide: her
  // store's debts only (owner, 2026-10-09).
  await everyDebtOf(page, name);
  await customerRow(page, name).click();
  await page.getByRole("button", { name: "Стерти дані покупця" }).click();
  await expect(
    page.getByText(
      "Ім’я й телефон покупця зникнуть з усіх закритих боргів цього магазину з цим телефоном. Суми лишаються. Скасувати це не можна.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Так, стерти дані покупця" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Дані покупця стерто із закритих боргів цього магазину: 1.",
  );

  // Without the permission, no button.
  const kept = customer();
  const other = await onCredit(page, kept);
  await payOff(page, other.token, other.sale.credit.credit_id);
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      organization_permissions: string[];
      stores: { permissions: string[] }[];
    };
    body.organization_permissions = body.organization_permissions.filter(
      (p) => p !== "credit:erase_customer",
    );
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "credit:erase_customer",
      );
    await route.fulfill({ response, json: body });
  });
  await everyDebtOf(page, kept);
  await customerRow(page, kept).click();
  await expect(page.locator(".debt-closed .badge")).toHaveText("Сплачено");
  await expect(
    page.getByRole("button", { name: "Стерти дані покупця" }),
  ).toHaveCount(0);
  await page.unroute("**/api/v1/me");

  const open = customer();
  await onCredit(page, open);
  await everyDebtOf(page, open, fixture.owner_telegram_user_id);
  await customerRow(page, open).click();
  await expect(
    paying(page).getByRole("button", { name: "Готівка" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Стерти дані покупця" }),
  ).toHaveCount(0);
});

test("a written-off debt's reason is erased with its customer", async ({
  page,
}) => {
  const name = customer();
  const { sale, token } = await onCredit(page, name);
  const written = await page.request.post(
    `/api/v1/credits/${sale.credit.credit_id}/write-off`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { command_id: randomUUID(), reason: `${name} виїхав` },
    },
  );
  expect(written.status()).toBe(200);

  await everyDebtOf(page, name, fixture.owner_telegram_user_id);
  await customerRow(page, name).click();
  const history = page.getByRole("list", { name: "Історія боргу" });
  await expect(history).toContainText(`${name} виїхав`);
  await page.getByRole("button", { name: "Стерти дані покупця" }).click();
  await page.getByRole("button", { name: "Так, стерти дані покупця" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Дані покупця стерто із закритих боргів: 1.",
  );
  await expect(page.locator(".debt-closed .badge")).toHaveText("Списано");
  await expect(history).not.toContainText(name);
  const closed = history.getByRole("listitem").filter({ hasText: "Списано" });
  await expect(closed.locator(".history-what")).toHaveText("Списано");
  await expect(closed.locator(".history-meta").first()).toContainText(" · Оля");
  await expect(closed).toContainText("причину стерто разом з даними покупця");
  await expect(closed.locator(".history-sum")).toHaveText("2 000,00 грн");
});

// The receipt of a sale paid in parts leads with what the customer pays now,
// and how (redesign P0-6): the terminal is charged that, never the whole.
for (const [way, say] of [
  ["Картка", "Проведіть на терміналі"],
  ["Готівка", "У касу"],
  ["Переказ", "Перевірте, що переказ надійшов, перш ніж віддати товар"],
] as const) {
  test(`paid in parts by «${way}», the receipt leads with the 1000 paid now, not the 3000`, async ({
    page,
  }) => {
    const coat = await stocked(page);
    await basket(page, coat);
    await basketSheet(page);
    await page.getByLabel("Оплата частинами").check();
    await page.getByLabel("Ім’я покупця").fill(customer());
    await page.getByLabel("Телефон покупця").fill(newPhone());
    await page.getByLabel("Сплачує зараз, грн").fill("1000");
    await basketDone(page);
    await page.getByRole("button", { name: way, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Продаж записано" }),
    ).toBeVisible();
    // The stub leads with what is paid now (spec S11; P0-2).
    await expectStub(page, { way, say, sum: "Зараз 1 000,00 грн" });
    await expect(page.getByText("3 000,00 грн")).toHaveCount(1);
    await expect(page.getByText("Разом за товар 3 000,00 грн")).toBeVisible();
    await expect(page.getByText("Покупець винен 2 000,00 грн")).toBeVisible();
  });
}

test("paid in parts by card typed from paper, the receipt says the card was charged and never to charge it again", async ({
  page,
}) => {
  const coat = await stocked(page);
  await basket(page, coat, true);
  await basketSheet(page);
  await page.getByLabel("Оплата частинами").check();
  await page.getByLabel("Ім’я покупця").fill(customer());
  await page.getByLabel("Телефон покупця").fill(newPhone());
  await page.getByLabel("Сплачує зараз, грн").fill("1000");
  await basketDone(page);
  await page
    .getByRole("button", { name: "З паперу · Картка", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expectStub(page, {
    way: "Картка",
    say: "Оплату провели під час збою, на терміналі не проводьте ще раз.",
    sum: "Зараз 1 000,00 грн",
  });
  await expect(page.getByText("Проведіть на терміналі")).toHaveCount(0);
});

/** «Продаж» › «Внесок», the store's debtors under «Продаж» («Усе на бірці»
 * task list, P0-3). */
async function atTheTill(page: Page): Promise<void> {
  // A launch link that differs only in its hash would not reload the app.
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await tillWays(page)
    .getByRole("button", { name: "Внесок", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж", level: 1 }),
  ).toBeVisible();
}

/** The keypad's keys, pressed one by one: «1500», «,5». */
async function keyIn(page: Page, keys: string): Promise<void> {
  for (const one of keys)
    await page
      .locator(".keypad")
      .getByRole("button", { name: one === "," ? "Кома" : one, exact: true })
      .click();
}

/** Two coats at 1500 sold in parts at «Другий» by the owner: 1000 now, 2000
 * owed there. */
async function onCreditAtTheOther(
  page: Page,
  name: string,
  phone: string,
): Promise<void> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(fixture.owner_telegram_user_id) },
  });
  const { access_token: token } = (await auth.json()) as {
    access_token: string;
  };
  const headers = { Authorization: `Bearer ${token}` };
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.second_store_id,
      concept: `Деінде частинами ${randomUUID().slice(0, 8)}`,
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
      location_id: fixture.second_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          quantity: 2,
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
          source_location_id: fixture.second_location_id,
          quantity: 2,
          unit_price: "1500.00",
        },
      ],
      credit: { customer_name: name, customer_phone: phone, paid_now: "1000.00" },
      payment_method: "CASH",
    },
  });
  expect(sale.status()).toBe(201);
}

test.describe("«Продаж» › «Внесок»: payments on debts from the till, against the server («Усе на бірці» task list, P0-3)", () => {
  test("a payment keyed in at the till is recorded once, and S22 says what is left and what the customer owes the store in all, both the server's", async ({
    page,
  }) => {
    const name = customer();
    const { sale, token } = await onCredit(page, name);
    const payments = posts(page, "/payments");
    await atTheTill(page);
    await searchField(page).fill(name);
    await expect(rows(page)).toHaveCount(1);
    await customerRow(page, name).click();
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toHaveCount(0);
    await keyIn(page, "500");
    await paying(page).getByRole("button", { name: "Картка" }).click();
    const paid = page.locator(".paid-result");
    await expect(
      paid.getByRole("heading", { name: "Внесок записано" }),
    ).toBeFocused();
    await expectStub(paid, {
      way: "Картка",
      say: "Проведіть на терміналі",
      sum: "500,00 грн",
    });
    await expect(
      paid.getByText("Залишок боргу 1 500,00 грн", { exact: true }),
    ).toBeVisible();
    await expect(paid.locator(".paid-total")).toHaveText(
      "Усього винні магазину «Основний» 1 500,00 грн",
    );
    expect(payments.bodies).toEqual([
      expect.objectContaining({ amount: "500.00", payment_method: "CARD" }),
    ]);
    expect(await owed(page, token, sale.credit.credit_id)).toBe("1500.00");
  });

  test("a debt lowered on another phone while S21 is open: within what it shows, the server refuses, and the debt is shown as it is now", async ({
    page,
  }) => {
    const name = customer();
    const { sale, token } = await onCredit(page, name);
    await atTheTill(page);
    await searchField(page).fill(name);
    await customerRow(page, name).click();
    await expect(
      page.getByRole("group", { name: "Скільки винні" }).locator(".owed-sum"),
    ).toHaveText("2 000,00 грн");
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
    await keyIn(page, "1000");
    await paying(page).getByRole("button", { name: "Переказ" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Це більше, ніж винні: залишок боргу 500,00 грн. Прийміть 500,00 грн, а решту поверніть покупцю переказом.",
    );
    await expect(
      page.getByRole("group", { name: "Скільки винні" }).locator(".owed-sum"),
    ).toHaveText("500,00 грн");
    await expect(
      page.getByRole("heading", { name: "Внесок ще не підтверджено" }),
    ).toHaveCount(0);
    expect(await owed(page, token, sale.credit.credit_id)).toBe("500.00");
  });

  test("a number that owes «Другий», where this person takes payments too, says «Внесок приймає «Другий»» at «Основний»'s till", async ({
    page,
  }) => {
    const name = customer();
    const phone = newPhone();
    await onCreditAtTheOther(page, name, phone);
    await atTheTill(page);
    await searchField(page).fill(phone);
    const row = rows(page);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(name);
    await expect(row).toContainText("Внесок приймає «Другий»");
    await expect(row).toContainText("2 000,00 грн");
    await expect(row.getByRole("button")).toHaveCount(0);
  });
});
