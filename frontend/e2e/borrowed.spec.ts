import { test, expect } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Goods borrowed from another shop, and goods under consignment (owner
 * decisions, 2026-10-01): taken through «Приймання» from a supplier at a
 * price agreed for each, by the owner and managers only; marked sold in
 * «Постачальникам», which is an invoice in «Накладні»; sent back unsold for
 * nothing. A mistaken «Продано» is undone by cancelling its invoice.
 *
 * In the stores' own network: Ганна holds every right at «Центр», Ліда sells
 * there with a seller's rights.
 */
interface Fixture {
  network_centre_seller_telegram_user_id: string;
  network_centre_cashier_telegram_user_id: string;
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
const lida = fixture.network_centre_cashier_telegram_user_id;
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

async function openAs(page: Page, telegramUserId: string): Promise<void> {
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId) }).toString()}`,
  );
  await page.getByRole("button", { name: "Центр CENTRE" }).click();
}

async function headers(page: Page): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(hanna) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

function posts(page: Page, ending: RegExp): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && ending.test(request.url()))
      seen.bodies.push(request.postDataJSON());
  });
  return seen;
}

interface Coat {
  model: string;
  variant: string;
  size: string;
}

async function aModel(page: Page): Promise<Coat> {
  const model = `Позичене ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...(await headers(page)), "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
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
  return {
    model,
    variant: product.product_variant_id,
    size: product.sizes[0]?.size_id ?? "",
  };
}

async function aSupplier(page: Page): Promise<{ id: string; name: string }> {
  const name = `Сусід ${randomUUID().slice(0, 6)}`;
  const added = await page.request.post("/api/v1/suppliers", {
    headers: await headers(page),
    data: { store_id: centre, name, phone: null },
  });
  expect(added.status()).toBe(201);
  return { id: ((await added.json()) as { id: string }).id, name };
}

/** Borrowed through the API: `quantity` of the coat at `price` each. */
async function borrowed(
  page: Page,
  coat: Coat,
  supplierId: string,
  quantity: number,
  price = "1000.00",
): Promise<string> {
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...(await headers(page)), "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      supplier_id: supplierId,
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          quantity,
          acquisition_type: "BORROWED",
          unit_cost: price,
        },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  const { lines } = (await received.json()) as {
    lines: { stock_lot_id: string }[];
  };
  return lines[0]?.stock_lot_id ?? "";
}

async function onHand(page: Page, lotId: string): Promise<number | undefined> {
  const page_ = await page.request.get(
    `/api/v1/borrowed?store_id=${centre}&on_hand=false&limit=50`,
    { headers: await headers(page) },
  );
  const { items } = (await page_.json()) as {
    items: { stock_lot_id: string; on_hand: number }[];
  };
  return items.find((item) => item.stock_lot_id === lotId)?.on_hand;
}

function card(page: Page, coat: Coat, supplier: string) {
  return page
    .getByRole("region", { name: "Позичене й під реалізацію" })
    .getByRole("article", { name: `${coat.model} графіт, M від ${supplier}` });
}

test("jackets borrowed from another shop are taken at a price, marked sold, and owed in «Накладні»", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const receipts = posts(page, /\/inventory\/receipts$/);
  await openAs(page, hanna);
  await page.getByRole("button", { name: "Приймання", exact: true }).click();
  await page.getByLabel("Пошук у каталозі").fill(coat.model);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: new RegExp(coat.model) }).click();
  await page.getByRole("combobox", { name: "Розмір" }).selectOption("M");
  await page.getByLabel("Кількість").fill("3");
  await page
    .getByRole("combobox", { name: "Як надійшов", exact: true })
    .selectOption("BORROWED");
  // Whose goods is asked as soon as they are borrowed.
  await expect(
    page.getByRole("combobox", { name: "Постачальник", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Додати до поставки" }).click();
  await expect(
    page.getByText(
      "Вкажіть ціну за одиницю, домовлену з постачальником: її сплатять, коли товар продадуть.",
    ),
  ).toBeVisible();
  await page.getByLabel("Домовлена ціна за од., грн").fill("1500");
  await page.getByRole("button", { name: "Додати до поставки" }).click();
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  await expect(
    page.getByText("Оберіть постачальника, чий це товар."),
  ).toBeVisible();
  expect(receipts.bodies).toHaveLength(0);
  await page
    .getByRole("combobox", { name: "Постачальник", exact: true })
    .selectOption({ label: supplier.name });
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  await expect(
    page.getByRole("heading", { name: "Товар прийнято" }),
  ).toBeVisible();
  expect(receipts.bodies).toEqual([
    expect.objectContaining({
      supplier_id: supplier.id,
      lines: [
        expect.objectContaining({
          acquisition_type: "BORROWED",
          quantity: 3,
          unit_cost: "1500.00",
        }),
      ],
    }),
  ]);

  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  const lot = card(page, coat, supplier.name);
  await expect(lot).toContainText(
    "1500,00 грн за од. · взято 3 · продано 0 · повернено 0 · на руках 3",
  );
  await lot.getByLabel("Скільки одиниць").fill("2");
  await lot.getByRole("button", { name: "Продано" }).click();
  await expect(
    page.getByText(
      `Продано 2 од.: у «Накладних» борг «${supplier.name}» 3000,00 грн.`,
    ),
  ).toBeVisible();
  await expect(lot).toContainText("продано 2 · повернено 0 · на руках 1");

  await page.getByRole("button", { name: "Накладні", exact: true }).click();
  await expect(
    page.getByRole("article", {
      name: new RegExp(`^Накладна ${supplier.name}`),
    }),
  ).toContainText(`За продане позичене: ${coat.model} графіт, M × 2`);
});

test("unsold borrowed jackets go back to their supplier for nothing", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const lotId = await borrowed(page, coat, supplier.id, 2);
  const returns = posts(page, /\/supplier-returns$/);
  await openAs(page, hanna);
  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  const lot = card(page, coat, supplier.name);
  await lot.getByLabel("Скільки одиниць").fill("3");
  await lot.getByRole("button", { name: "Повернути постачальнику" }).click();
  await expect(lot.getByText("На руках лише 2 од.")).toBeVisible();
  await lot.getByLabel("Скільки одиниць").fill("2");
  await lot.getByRole("button", { name: "Повернути постачальнику" }).click();
  await expect(
    page.getByText(`Повернено постачальнику «${supplier.name}»: 2 од.`),
  ).toBeVisible();
  await expect(lot).toHaveCount(0);
  expect(returns.bodies).toEqual([
    expect.objectContaining({
      supplier_id: supplier.id,
      stock_lot_id: lotId,
      lines: [
        { product_variant_id: coat.variant, size_id: coat.size, quantity: 2 },
      ],
    }),
  ]);
  await expect(
    page.getByRole("article", {
      name: new RegExp(`^Повернення ${supplier.name}`),
    }),
  ).toContainText(`${coat.model} графіт, M × 2`);
  expect(await onHand(page, lotId)).toBe(0);
});

test("a mistaken «Продано» is undone by cancelling its invoice", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const lotId = await borrowed(page, coat, supplier.id, 1);
  const marked = await page.request.post("/api/v1/supplier-invoices/sold", {
    headers: await headers(page),
    data: {
      command_id: randomUUID(),
      store_id: centre,
      stock_lot_id: lotId,
      quantity: 1,
    },
  });
  expect(marked.status()).toBe(201);
  expect(await onHand(page, lotId)).toBe(0);

  await openAs(page, hanna);
  await page.getByRole("button", { name: "Накладні", exact: true }).click();
  await page
    .getByRole("button", {
      name: new RegExp(`^Відкрити накладну ${supplier.name} `),
    })
    .click();
  await expect(
    page.getByText(/Якщо позначили помилково — скасуйте накладну/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Скасувати накладну" }).click();
  await page.getByLabel("Чому скасовуємо").fill("ще не продали");
  await page.getByRole("button", { name: "Так, скасувати накладну" }).click();
  await expect(
    page.getByText(/^Скасовано .* ще не продали/).first(),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  await expect(card(page, coat, supplier.name)).toContainText(
    "продано 0 · повернено 0 · на руках 1",
  );
});

test("a seller takes only the shop's own goods", async ({ page }) => {
  await openAs(page, lida);
  await page.getByRole("button", { name: "Приймання", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Приймання товару" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Як надійшов", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Постачальникам", exact: true }),
  ).toHaveCount(0);
});

test("a «Продано» whose answer is lost is resent unchanged, and counted once", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const lotId = await borrowed(page, coat, supplier.id, 2);
  const marks = posts(page, /\/supplier-invoices\/sold$/);
  let first = true;
  await page.route("**/api/v1/supplier-invoices/sold", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await openAs(page, hanna);
  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  await card(page, coat, supplier.name)
    .getByRole("button", { name: "Продано" })
    .click();
  await expect(
    page.getByText(
      "Незавершена операція з накладною: перевірте її в «Накладних».",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Борги", exact: true }),
  ).toBeDisabled();
  // Written down before it was sent: a reload still knows what to ask about.
  await page.reload();
  await page.getByRole("button", { name: "Центр CENTRE" }).click();
  await page
    .getByRole("button", { name: "Перевірити результат операції" })
    .click();
  await expect(
    page.getByText(new RegExp(`^Продано з позиченого: ${coat.model}`)),
  ).toBeVisible();
  expect(marks.bodies).toHaveLength(2);
  expect(marks.bodies[1]).toEqual(marks.bodies[0]);
  expect(await onHand(page, lotId)).toBe(1);
});
