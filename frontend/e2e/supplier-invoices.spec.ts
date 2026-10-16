import {
  test,
  expect,
  grn,
  more,
  openStore,
  section,
  sections,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * What a store owes its suppliers (owner decisions, 2026-10-01): an invoice
 * recorded on its own and paid in parts with no schedule; goods returned to
 * that supplier set off against it; a payment, a set-off or the invoice
 * itself recorded by mistake cancelled saying why; what is left written off
 * by the owner only; and an archived store's invoices paid by a store that
 * trades.
 *
 * In the stores' own network: Ганна holds every right at «Центр», Марко
 * manages it with a manager's default rights, and «Старий», archived, still
 * owes «Постачальник Старого».
 */
interface Fixture {
  network_centre_seller_telegram_user_id: string;
  network_centre_manager_telegram_user_id: string;
  network_centre_store_id: string;
  network_shared_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const hanna = fixture.network_centre_seller_telegram_user_id;
const marko = fixture.network_centre_manager_telegram_user_id;
const centre = fixture.network_centre_store_id;

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

/** «Накладні» at «Центр», as this person. */
async function invoicesAt(page: Page, telegramUserId: string): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId) }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await section(page, "Накладні");
}

function posts(page: Page, ending: RegExp): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && ending.test(request.url()))
      seen.bodies.push(request.postDataJSON());
  });
  return seen;
}

/** A supplier of its own, on the network's list. */
async function aSupplier(page: Page, name: string): Promise<string> {
  const added = await page.request.post("/api/v1/suppliers", {
    headers: await headersOf(page, hanna),
    data: { store_id: centre, name, phone: null },
  });
  expect(added.status()).toBe(201);
  return ((await added.json()) as { id: string }).id;
}

async function anInvoice(
  page: Page,
  supplierId: string,
  amount: string,
  paidNow = "0",
): Promise<string> {
  const recorded = await page.request.post("/api/v1/supplier-invoices", {
    headers: await headersOf(page, hanna),
    data: {
      command_id: randomUUID(),
      store_id: centre,
      supplier_id: supplierId,
      amount,
      paid_now: paidNow,
      note: null,
    },
  });
  expect(recorded.status()).toBe(201);
  return ((await recorded.json()) as { id: string }).id;
}

async function owed(page: Page, invoiceId: string, elsewhere = false) {
  const response = await page.request.get(
    `/api/v1/supplier-invoices?store_id=${centre}&limit=50${elsewhere ? "&elsewhere=true" : ""}`,
    { headers: await headersOf(page, hanna) },
  );
  const { items } = (await response.json()) as {
    items: { id: string; owed: string }[];
  };
  return items.find((item) => item.id === invoiceId)?.owed;
}

/** One supplier's invoice, opened from the list. */
async function open(page: Page, supplier: string): Promise<void> {
  await page
    .getByRole("combobox", { name: "Показати", exact: true })
    .selectOption("ALL");
  await page
    .getByRole("button", {
      name: new RegExp(`^Відкрити накладну ${supplier} `),
    })
    .click();
}

test("an invoice is recorded and paid in parts until it is settled", async ({
  page,
}) => {
  const supplier = `Накладна ${randomUUID().slice(0, 6)}`;
  const recorded = posts(page, /\/api\/v1\/supplier-invoices$/);
  const paid = posts(page, /\/payments$/);
  await invoicesAt(page, hanna);
  await page.getByRole("button", { name: "+ Записати накладну" }).click();
  await page.getByRole("button", { name: "+ Новий постачальник" }).click();
  await page.getByLabel("Назва постачальника").fill(supplier);
  await page.getByRole("button", { name: "Додати постачальника" }).click();
  await expect(
    page.getByRole("combobox", { name: "Постачальник", exact: true }).first(),
  ).toHaveValue(/.+/);
  await page.getByLabel("Сума за накладною, грн").fill("5000");
  await page.getByLabel("Сплачено одразу, грн").fill("1000,50");
  await page.getByLabel("Примітка (необов’язково)").fill("накладна № 7");
  await page
    .getByRole("button", { name: "Записати накладну", exact: true })
    .click();
  await expect(
    page.getByText(
      `Накладну «${supplier}» на 5 000,00 грн записано. Залишок 3 999,50 грн.`,
    ),
  ).toBeVisible();
  expect(recorded.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      store_id: centre,
      supplier_id: expect.any(String) as string,
      amount: "5000.00",
      paid_now: "1000.50",
      note: "накладна № 7",
    },
  ]);

  await page.getByLabel("Сума оплати, грн").fill("999,50");
  await page.getByRole("button", { name: "Сплатити" }).click();
  await expect(
    page.getByText("Оплату 999,50 грн записано. Залишок 3 000,00 грн."),
  ).toBeVisible();
  await page.getByRole("button", { name: "До списку накладних" }).click();
  await expect(
    page.getByRole("list", { name: "Борги за постачальниками" }),
  ).toContainText(`${supplier} — 3 000,00 грн`);

  await open(page, supplier);
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await expect(page.getByLabel("Сума оплати, грн")).toHaveValue("3000,00");
  await page.getByRole("button", { name: "Сплатити" }).click();
  await expect(
    page.getByText("Оплату 3 000,00 грн записано. Накладну сплачено повністю."),
  ).toBeVisible();
  await expect(
    page.getByText("Сплачено повністю", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Сума оплати, грн")).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Історія накладної" }).getByRole("listitem"),
  ).toHaveCount(3);
  expect(paid.bodies).toEqual([
    { command_id: expect.any(String) as string, amount: "999.50" },
    { command_id: expect.any(String) as string, amount: "3000.00" },
  ]);
  await page.getByRole("button", { name: "До списку накладних" }).click();
  await expect(
    page.locator('[aria-label="Скільки магазин винен постачальникам"]'),
  ).not.toContainText(supplier);
});

test("goods returned are set off against an invoice, and their return waits for the set-off", async ({
  page,
}) => {
  const supplier = `Залік ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  const headers = await headersOf(page, hanna);
  const model = `Залікове ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      concept: model,
      variant: { color: "сірий" },
      sizes: [{ system: "ALPHA", code: "L" }],
    },
  });
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const line = {
    product_variant_id: product.product_variant_id,
    size_id: product.sizes[0]?.size_id ?? "",
  };
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: [{ ...line, quantity: 2, acquisition_type: "PURCHASE" }],
      notes: null,
    },
  });
  expect(receipt.status()).toBe(201);
  const returned = await page.request.post("/api/v1/supplier-returns", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      supplier_id: supplierId,
      lines: [{ ...line, quantity: 2 }],
      note: null,
    },
  });
  expect(returned.status()).toBe(201);
  const returnId = ((await returned.json()) as { id: string }).id;
  // Another return to that supplier, cancelled: its goods came back, so it
  // is never counted.
  const receiptAgain = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: [{ ...line, quantity: 1, acquisition_type: "PURCHASE" }],
      notes: null,
    },
  });
  expect(receiptAgain.status()).toBe(201);
  const undone = await page.request.post("/api/v1/supplier-returns", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      supplier_id: supplierId,
      lines: [{ ...line, quantity: 1 }],
      note: null,
    },
  });
  const undoneId = ((await undone.json()) as { id: string }).id;
  expect(
    (
      await page.request.post(`/api/v1/supplier-returns/${undoneId}/cancel`, {
        headers,
        data: { reason: "постачальник не взяв" },
      })
    ).status(),
  ).toBe(200);
  const invoiceId = await anInvoice(page, supplierId, "4000.00");
  const counted = posts(page, /\/set-offs$/);

  await invoicesAt(page, hanna);
  await open(page, supplier);
  await page.getByRole("button", { name: "Залік за повернений товар" }).click();
  const returns = page.getByRole("combobox", {
    name: "Повернення",
    exact: true,
  });
  await expect(returns.getByRole("option")).toHaveText([
    "Оберіть повернення",
    / · 2 од\.$/,
  ]);
  await returns.selectOption({ index: 1 });
  await page.getByLabel("Скільки зарахував постачальник, грн").fill("1200");
  await page.getByRole("button", { name: "Зарахувати" }).click();
  await expect(
    page.getByText("Залік 1 200,00 грн записано. Залишок 2 800,00 грн."),
  ).toBeVisible();
  expect(counted.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      supplier_return_id: returnId,
      amount: "1200.00",
    },
  ]);

  // The goods stay with the supplier while it counts them.
  await section(page, "Постачальникам");
  const card = page
    .getByRole("article", { name: new RegExp(`^Повернення ${supplier}`) })
    .filter({ hasText: "× 2" });
  await expect(card).toContainText(
    "Постачальник зарахував 1 200,00 грн у накладну",
  );
  await expect(card).toContainText(
    "Щоб скасувати повернення, спершу скасуйте залік у «Накладних».",
  );
  await expect(
    card.getByRole("button", { name: "Скасувати повернення" }),
  ).toHaveCount(0);

  await section(page, "Накладні");
  await open(page, supplier);
  await page
    .getByRole("button", {
      name: "Скасувати: залік за повернення 1 200,00 грн",
    })
    .click();
  await page.getByLabel("Чому скасовуємо").fill("постачальник передумав");
  await page.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(
    page
      .getByRole("list", { name: "Історія накладної" })
      .getByText(/^Скасовано .* постачальник передумав/),
  ).toBeVisible();
  expect(await owed(page, invoiceId)).toBe("4000.00");

  await section(page, "Постачальникам");
  await expect(
    card.getByRole("button", { name: "Скасувати повернення" }),
  ).toBeVisible();
});

test("a payment or an invoice recorded by mistake is cancelled, saying why", async ({
  page,
}) => {
  const supplier = `Помилка ${randomUUID().slice(0, 6)}`;
  const invoiceId = await anInvoice(
    page,
    await aSupplier(page, supplier),
    "2000.00",
    "500.00",
  );
  await invoicesAt(page, hanna);
  await open(page, supplier);
  // Not while a payment on it stands.
  await expect(
    page.getByText(
      "Щоб скасувати накладну, спершу скасуйте її оплати й заліки.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Скасувати накладну" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Скасувати: оплата 500,00 грн" })
    .click();
  await expect(
    page.getByRole("button", { name: "Так, скасувати" }),
  ).toBeDisabled();
  await page.getByLabel("Чому скасовуємо").fill("гроші не віддали");
  await page.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(
    page
      .getByRole("list", { name: "Історія накладної" })
      .getByText(/^Скасовано .* гроші не віддали/),
  ).toBeVisible();
  expect(await owed(page, invoiceId)).toBe("2000.00");

  await page.getByRole("button", { name: "Скасувати накладну" }).click();
  await page.getByLabel("Чому скасовуємо").fill("не та сума");
  await page.getByRole("button", { name: "Так, скасувати накладну" }).click();
  await expect(
    page.getByText(/^Скасовано .* не та сума/).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Сума оплати, грн")).toHaveCount(0);
  expect(await owed(page, invoiceId)).toBe("0.00");
});

test("what is left is written off by the owner, never by a manager", async ({
  page,
}) => {
  const supplier = `Списання ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "1500.00");
  await invoicesAt(page, marko);
  await open(page, supplier);
  await expect(page.getByRole("button", { name: "Сплатити" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Списати залишок" }),
  ).toHaveCount(0);

  await invoicesAt(page, hanna);
  await open(page, supplier);
  await page.getByRole("button", { name: "Списати залишок" }).click();
  await page.getByLabel("Чому списуємо").fill("постачальник пробачив");
  await page.getByRole("button", { name: "Так, списати 1 500,00 грн" }).click();
  await expect(page.getByText("Списано 1 500,00 грн.")).toBeVisible();
  await expect(
    page.getByText("Залишок списано", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Історія накладної" }),
  ).toContainText("Списано 1 500,00 грн · Тест · постачальник пробачив");
  await expect(page.getByRole("button", { name: /^Скасувати/ })).toHaveCount(0);
});

test("an archived store's invoice is paid by a store that trades", async ({
  page,
}) => {
  const paid = posts(page, /\/payments$/);
  await invoicesAt(page, hanna);
  await page
    .getByRole("combobox", { name: "Чиї накладні", exact: true })
    .selectOption("ELSEWHERE");
  const card = page.getByRole("article", {
    name: /^Накладна Постачальник Старого/,
  });
  await expect(card).toContainText("магазин «Старий»");
  await card.getByRole("button", { name: /^Відкрити накладну/ }).click();
  await expect(
    page.getByText(/^Накладна магазину «Старий», який зараз закрито/),
  ).toBeVisible();
  // Set off and cancelled only where it is owed.
  await expect(
    page.getByRole("button", { name: "Залік за повернений товар" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Скасувати накладну" }),
  ).toHaveCount(0);
  const before = Number(
    (await page.getByRole("definition").last().innerText())
      .replace(/[^\d,]/g, "")
      .replace(",", "."),
  );
  await page.getByLabel("Сума оплати, грн").fill("100");
  await page.getByRole("button", { name: "Сплатити" }).click();
  await expect(
    page.getByText(
      `Оплату 100,00 грн записано. Залишок ${grn((before - 100).toFixed(2))}.`,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Історія накладної" }),
  ).toContainText("сплатив магазин «Центр»");
  expect(paid.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      amount: "100.00",
      store_id: centre,
    },
  ]);
});

test("a payment whose answer is lost is resent unchanged, and paid once", async ({
  page,
}) => {
  const supplier = `Втрачена ${randomUUID().slice(0, 6)}`;
  const invoiceId = await anInvoice(
    page,
    await aSupplier(page, supplier),
    "1000.00",
  );
  const paid = posts(page, /\/payments$/);
  let first = true;
  await page.route("**/api/v1/supplier-invoices/*/payments", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await invoicesAt(page, hanna);
  await open(page, supplier);
  await page.getByLabel("Сума оплати, грн").fill("300");
  await page.getByRole("button", { name: "Сплатити" }).click();
  await expect(
    page.getByText("Незавершена операція з накладною"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Борги", exact: true }),
  ).toBeDisabled();
  // Its own section stays open under «Ще», every other is held (P1-6).
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: "Накладні", exact: true }),
  ).toBeEnabled();
  await expect(
    sections(page).getByRole("button", { name: "Залишки", exact: true }),
  ).toBeDisabled();
  // Written down before it was sent: a reload still knows what to ask about.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await page
    .getByRole("button", { name: "Перевірити результат операції" })
    .click();
  await expect(
    page.getByText("Оплату 300,00 грн записано. Залишок 700,00 грн."),
  ).toBeVisible();
  expect(paid.bodies).toHaveLength(2);
  expect(paid.bodies[1]).toEqual(paid.bodies[0]);
  expect(await owed(page, invoiceId)).toBe("700.00");
});
