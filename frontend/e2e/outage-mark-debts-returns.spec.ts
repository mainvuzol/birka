import { test, expect } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Returns and debt payments typed from paper (owner decision, 2026-10-10;
 * ADR-0021), against the real server: the till's switch «з паперу» on
 * «Повернення» and «Борги», the mark naming who took it and the paper's
 * hour, the money never handed over or charged a second time, and the mark
 * in «Звіт» and in the debt's history.
 */
// A phone in a shop in Kyiv: the paper's hour reads as the store's clock,
// as in `outage.spec.ts`, whatever zone the machine running the journeys is in.
test.use({ timezoneId: "Europe/Kyiv" });

interface Fixture {
  network_owner_telegram_user_id: string;
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

/** Telegram's launch data for a person the seed knows, signed. */
function initData(telegramUserId: string, name: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"${name}"}`,
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

/** The app, opened from Telegram by this person, at «Центр». */
async function openAs(
  page: Page,
  telegramUserId: string,
  name: string,
): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId, name) }).toString()}`,
  );
  await page.getByRole("button", { name: "Центр CENTRE" }).click();
}

async function headersOf(page: Page): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: {
      init_data: initData(
        fixture.network_centre_seller_telegram_user_id,
        "Ганна",
      ),
    },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

/** One coat of a model of the journey's own, received and sold by «Ганна»
 * at 2500: in cash, or 500 now and 2000 owed by a customer of its own. */
async function soldAtCentre(
  page: Page,
  credit?: { customer_name: string; customer_phone: string },
): Promise<{ model: string; credit: string | null }> {
  const headers = await headersOf(page);
  const model = `Папір ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_centre_store_id,
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
  const size = product.sizes[0]?.size_id ?? "";
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_centre_store_id,
      location_id: fixture.network_shared_location_id,
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
  expect(received.status()).toBe(201);
  const sold = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_centre_store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: size,
          source_location_id: fixture.network_shared_location_id,
          quantity: 1,
          unit_price: "2500.00",
        },
      ],
      payment_method: "CASH",
      ...(credit ? { credit: { ...credit, paid_now: "500.00" } } : {}),
    },
  });
  expect(sold.status()).toBe(201);
  const body = (await sold.json()) as { credit?: { credit_id: string } | null };
  return { model, credit: body.credit?.credit_id ?? null };
}

/** dd.mm of yesterday, by the phone's clock. */
async function yesterdayOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const at = new Date();
    at.setDate(at.getDate() - 1);
    return `${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}`;
  });
}

function bodiesOf(page: Page, path: string): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith(path)
    )
      bodies.push(request.postDataJSON() as Record<string, unknown>);
  });
  return bodies;
}

test("a return typed from paper by «Ліда» naming «Ганна» says not to give the money back again, and shows in «Звіт» with who took it and who typed it", async ({
  page,
}) => {
  const { model } = await soldAtCentre(page);
  const sent = bodiesOf(page, "/refunds");

  await openAs(page, fixture.network_centre_cashier_telegram_user_id, "Ліда");
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await page.getByLabel("Пошук за назвою товару").fill(model);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page
    .getByRole("article")
    .filter({ hasText: model })
    .getByRole("button", { name: "Оформити повернення" })
    .click();
  await page.getByLabel("Вношу повернення з паперу").check();
  await expect(
    page.getByRole("region", { name: "Режим: з паперу" }),
  ).toContainText("Гроші, які віддали під час збою, вдруге не віддавайте.");
  await page
    .getByRole("combobox", { name: "Хто прийняв" })
    .selectOption({ label: "Ганна" });
  await page.getByLabel("Час з паперу").fill("19:40");
  await page.getByLabel("Це було вчора").check();
  await page.getByLabel("Цілих").fill("1");
  await expect(page.getByText("Хто прийняв: Ганна.")).toBeVisible();
  await page
    .getByRole("button", {
      name: "З паперу · Повернути покупцю 2500,00 грн готівкою",
    })
    .click();

  const yesterday = await yesterdayOf(page);
  const mark = `Повернено під час збою · хто прийняв: Ганна · за папером ${yesterday}, 19:40`;
  const done = page
    .getByRole("status")
    .filter({ hasText: "Повернення оформлено" });
  await expect(done).toContainText(mark);
  await expect(done).toContainText(
    "2500,00 грн готівкою повернули під час збою — вдруге не повертайте.",
  );
  await expect(done).not.toContainText("Поверніть покупцю");
  expect(sent).toHaveLength(1);
  const outage = sent[0]?.outage as { by_user_id: unknown; at: unknown };
  expect(typeof outage.by_user_id).toBe("string");
  expect(outage.at).toMatch(/^\d{4}-\d{2}-\d{2}T19:40$/);

  // The owner reads it in today's «Звіт»: taken by «Ганна», typed by «Ліда».
  await openAs(page, fixture.network_owner_telegram_user_id, "Власник мережі");
  await page.getByRole("button", { name: "Звіт", exact: true }).click();
  const entry = page
    .getByRole("list", { name: "Продажі й повернення" })
    .getByRole("listitem")
    .filter({ hasText: model })
    .filter({ hasText: "Повернення" });
  await expect(entry).toContainText(`${mark} · внесено: Ліда`);
});

test("a card payment typed from paper never says to charge the card, and the debt's history names who took it", async ({
  page,
}) => {
  const name = `Папір ${randomUUID().slice(0, 6)}`;
  const phone = `067${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
  await soldAtCentre(page, { customer_name: name, customer_phone: phone });
  const sent = bodiesOf(page, "/payments");

  await openAs(page, fixture.network_centre_cashier_telegram_user_id, "Ліда");
  await page.getByRole("button", { name: "Борги", exact: true }).click();
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("button", { name: `Відкрити борг ${name}` }).click();
  await page.getByLabel("Вношу внесок з паперу").check();
  await expect(
    page.getByRole("region", { name: "Режим: з паперу" }),
  ).toContainText("на терміналі нічого не проводьте");
  await page
    .getByRole("combobox", { name: "Хто прийняв" })
    .selectOption({ label: "Ганна" });
  await page.getByLabel("Сума внеску, грн").fill("300");
  await page
    .getByRole("group", { name: "Внесок", exact: true })
    .getByRole("button", { name: "З паперу · Картка" })
    .click();

  await expect(
    page.getByText(
      "Внесок 300,00 грн з паперу записано: карткою — оплату провели під час збою, на терміналі не проводьте ще раз. Залишок боргу 1700,00 грн.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Історія боргу" })).toContainText(
    "Внесок під час збою · хто прийняв: Ганна · внесено: Ліда",
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]?.payment_method).toBe("CARD");
  expect(sent[0]?.outage).toEqual({
    by_user_id: expect.any(String) as string,
    at: null,
  });
});

test("the switch is one for the store: ticked on «Повернення», the till and «Борги» are in paper mode too, a name chosen at the till is not taken for a return, and unticked at the till it is off everywhere", async ({
  page,
}) => {
  const name = `Перемикач ${randomUUID().slice(0, 6)}`;
  const phone = `067${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
  await soldAtCentre(page, { customer_name: name, customer_phone: phone });
  const { model } = await soldAtCentre(page);
  await openAs(page, fixture.network_centre_cashier_telegram_user_id, "Ліда");

  // At the till: paper mode, «Ганна» named as having sold.
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await page.getByLabel("Вношу продаж з паперу").check();
  await page
    .getByRole("combobox", { name: "Хто продав" })
    .selectOption({ label: "Ганна" });

  // «Повернення»: in paper mode too, and nobody named for the return.
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await page.getByLabel("Пошук за назвою товару").fill(model);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page
    .getByRole("article")
    .filter({ hasText: model })
    .getByRole("button", { name: "Оформити повернення" })
    .click();
  await expect(page.getByLabel("Вношу повернення з паперу")).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Хто прийняв" })).toHaveValue(
    "",
  );

  // «Борги»: the same.
  await page.getByRole("button", { name: "Борги", exact: true }).click();
  await page.getByLabel("Пошук за ім’ям або телефоном").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("button", { name: `Відкрити борг ${name}` }).click();
  await expect(page.getByLabel("Вношу внесок з паперу")).toBeChecked();
  await expect(
    page
      .getByRole("group", { name: "Внесок", exact: true })
      .getByRole("button", { name: "З паперу · Готівка" }),
  ).toBeVisible();

  // Unticked at the till: off on «Повернення».
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await page.getByLabel("Вношу продаж з паперу").uncheck();
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  await page.getByLabel("Пошук за назвою товару").fill(model);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page
    .getByRole("article")
    .filter({ hasText: model })
    .getByRole("button", { name: "Оформити повернення" })
    .click();
  await expect(page.getByLabel("Вношу повернення з паперу")).not.toBeChecked();
  await page.getByLabel("Цілих").fill("1");
  await expect(
    page.getByRole("button", {
      name: "Повернути покупцю 2500,00 грн готівкою",
    }),
  ).toBeVisible();
});
