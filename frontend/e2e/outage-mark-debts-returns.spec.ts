import {
  test,
  expect,
  fromPaper,
  openStore,
  returnUnits,
  section,
} from "./fixtures";
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
  await openStore(page, "Центр CENTRE");
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
  await section(page, "Повернення");
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  await page
    .getByRole("article")
    .filter({ hasText: model })
    .getByRole("button", { name: "Оформити повернення" })
    .click();
  await fromPaper(page, "Вношу повернення з паперу");
  await expect(
    page.getByRole("region", { name: "Режим: з паперу" }),
  ).toContainText("Гроші, які віддали під час збою, вдруге не віддавайте.");
  // A seller does not see «Звіт» (owner, 2026-10-15).
  await expect(
    page.getByRole("region", { name: "Режим: з паперу" }),
  ).toContainText(
    "Воно увійде в сьогоднішні повернення й у касу до наступного закриття.",
  );
  await page
    .getByRole("combobox", { name: "Хто прийняв" })
    .selectOption({ label: "Ганна" });
  await page.getByLabel("Час з паперу").fill("19:40");
  await page.getByLabel("Це було вчора").check();
  await returnUnits(page, { intact: 1 });
  // One line under the button (returns task list, P1-4), and the warning
  // not to hand money back twice said once, in the band.
  await expect(
    page.getByText("Хто прийняв: Ганна · за папером вчора, 19:40", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/вдруге не віддавайте/)).toHaveCount(1);
  await page
    .getByRole("button", {
      name: "З паперу · Повернути покупцю 2 500,00 грн готівкою",
    })
    .click();

  const yesterday = await yesterdayOf(page);
  const mark = `Повернено під час збою · хто прийняв: Ганна · за папером ${yesterday}, 19:40`;
  // Handed back already: what went, large, and never «Поверніть»
  // (returns task list, P0-5).
  const done = page.locator("section.return-result");
  await expect(
    done.getByRole("heading", { name: "Повернення записано" }),
  ).toBeVisible();
  await expect(done).toContainText(mark);
  // The paper's mark as a warning (returns task list, P2-4).
  await expect(done.locator(".badge").first()).toHaveClass(/\bwarn\b/);
  await expect(done.locator(".hand-back-what")).toHaveText(
    "Уже повернули під час збою",
  );
  await expect(done.locator(".hand-back-sum")).toHaveText("2 500,00 грн");
  await expect(done).toContainText(
    "2 500,00 грн готівкою повернули під час збою — вдруге не повертайте.",
  );
  await expect(done).not.toContainText(/Поверніть/i);
  expect(sent).toHaveLength(1);
  const outage = sent[0]?.outage as { by_user_id: unknown; at: unknown };
  expect(typeof outage.by_user_id).toBe("string");
  expect(outage.at).toMatch(/^\d{4}-\d{2}-\d{2}T19:40$/);

  // The owner reads it in today's «Звіт»: taken by «Ганна», typed by «Ліда».
  await openAs(page, fixture.network_owner_telegram_user_id, "Власник мережі");
  await section(page, "Звіт про продажі");
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
  await section(page, "Борги");
  await page.getByLabel("Ім’я або телефон").fill(name);
  await page.getByRole("button", { name: `Відкрити борг: ${name},` }).click();
  // Ticked, nothing is paid until the series says which paper it is.
  await page.getByLabel("Вношу внесок з паперу").check();
  await page.getByLabel("Сума внеску, грн").fill("300");
  await expect(
    page
      .getByRole("group", { name: "Внесок", exact: true })
      .getByRole("button", { name: "З паперу · Картка" }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Сервер не відповідав" }).check();
  await expect(
    page.getByRole("region", { name: "Режим: з паперу" }),
  ).toContainText("на терміналі нічого не проводьте");
  await page
    .getByRole("combobox", { name: "Хто прийняв" })
    .selectOption({ label: "Ганна" });
  await page.getByLabel("Сума внеску, грн").fill("300");
  // Said once, in the band; under the ways, who took it, in one line
  // (credits task list, P0-4).
  await expect(page.getByText(/на терміналі нічого не проводьте/i)).toHaveCount(
    1,
  );
  const panel = page.getByRole("group", { name: "Внесок", exact: true });
  await expect(panel.locator(".pay-seller")).toHaveText("Хто прийняв: Ганна");
  await expect(panel).toContainText("З паперу · Внесок 300,00 грн");
  await panel.getByRole("button", { name: "З паперу · Картка" }).click();

  await expect(
    page.getByText(
      "Внесок 300,00 грн з паперу записано: карткою — оплату провели під час збою, на терміналі не проводьте ще раз. Залишок боргу 1 700,00 грн.",
    ),
  ).toBeVisible();
  // From paper, the money was taken already: the mark, never «Проведіть»
  // (credits task list, P0-5).
  const paid = page.locator(".paid-result");
  // The paper's mark as the history says it (review, 2026-10-18).
  await expect(paid.locator(".badge.warn")).toHaveText(
    "Внесок під час збою · хто прийняв: Ганна",
  );
  await expect(paid).toContainText("Уже взяли під час збою");
  await expect(paid).not.toContainText("Проведіть");
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
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
  await fromPaper(page);
  await page
    .getByRole("combobox", { name: "Хто продав" })
    .selectOption({ label: "Ганна" });

  // «Повернення»: in paper mode too, and nobody named for the return.
  await section(page, "Повернення");
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
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
  await section(page, "Борги");
  await page.getByLabel("Ім’я або телефон").fill(name);
  await page.getByRole("button", { name: `Відкрити борг: ${name},` }).click();
  await expect(page.getByLabel("Вношу внесок з паперу")).toBeChecked();
  await expect(
    page
      .getByRole("group", { name: "Внесок", exact: true })
      .getByRole("button", { name: "З паперу · Готівка" }),
  ).toBeVisible();

  // Unticked at the till: off on «Повернення».
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await page.getByLabel("Вношу продаж з паперу").uncheck();
  await section(page, "Повернення");
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  await page
    .getByRole("article")
    .filter({ hasText: model })
    .getByRole("button", { name: "Оформити повернення" })
    .click();
  await expect(page.getByLabel("Вношу повернення з паперу")).not.toBeChecked();
  await returnUnits(page, { intact: 1 });
  await expect(
    page.getByRole("button", {
      name: "Повернути покупцю 2 500,00 грн готівкою",
    }),
  ).toBeVisible();
});

/** The phone's own date `days` ago: the form's value and as a receipt
 * writes it. */
async function daysAgoOf(
  page: Page,
  days: number,
): Promise<{ value: string; shown: string }> {
  return page.evaluate((back) => {
    const at = new Date();
    at.setDate(at.getDate() - back);
    const two = (n: number): string => String(n).padStart(2, "0");
    return {
      value: `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
      shown: `${two(at.getDate())}.${two(at.getMonth() + 1)}`,
    };
  }, days);
}

test("the first days' paper: a return and a payment typed from it are «з паперу», of a day nine days back, with no word of an outage, in «Звіт» and the debt's history", async ({
  page,
}) => {
  const name = `Перші ${randomUUID().slice(0, 6)}`;
  const phone = `067${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
  await soldAtCentre(page, { customer_name: name, customer_phone: phone });
  const { model } = await soldAtCentre(page);
  const returns = bodiesOf(page, "/refunds");
  const payments = bodiesOf(page, "/payments");
  const day = await daysAgoOf(page, 9);

  await openAs(page, fixture.network_centre_cashier_telegram_user_id, "Ліда");
  await section(page, "Повернення");
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  await page
    .getByRole("article")
    .filter({ hasText: model })
    .getByRole("button", { name: "Оформити повернення" })
    .click();
  await page.getByLabel("Вношу повернення з паперу").check();
  // Nothing is sent until the series says which paper it is.
  await returnUnits(page, { intact: 1 });
  const press = page.getByRole("button", {
    name: "Оберіть, що вносите з паперу",
  });
  await expect(press).toBeDisabled();
  await page
    .getByRole("radio", { name: "Перші дні, до затвердження залишків" })
    .check();
  const band = page.getByRole("region", { name: "Режим: з паперу" });
  await expect(band).toContainText(
    "Повернення позначать «з паперу». Воно увійде в сьогоднішні повернення й у касу до наступного закриття. Гроші, які вже віддали, вдруге не віддавайте.",
  );
  // Said once, in the band (P1-4).
  await expect(page.getByText(/вдруге не віддавайте/)).toHaveCount(1);
  await expect(band).not.toContainText("збою");
  await expect(page.getByLabel("Це було вчора")).toHaveCount(0);
  await page.getByLabel("День з паперу").fill(day.value);
  await page.getByLabel("Час з паперу").fill("12:30");
  await expect(
    page.getByText(`Хто прийняв: не вказано · за папером ${day.shown}, 12:30`, {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "З паперу · Повернути покупцю 2 500,00 грн готівкою",
    })
    .click();
  const mark = `Повернено з паперу · за папером ${day.shown}, 12:30`;
  const done = page.locator("section.return-result");
  await expect(done).toContainText(mark);
  await expect(done.locator(".hand-back-what")).toHaveText(
    "Уже повернули раніше",
  );
  await expect(done).not.toContainText(/Поверніть/i);
  await expect(done).toContainText(
    "2 500,00 грн готівкою повернули раніше — вдруге не повертайте.",
  );
  expect(returns[0]?.outage).toEqual({
    by_user_id: null,
    at: `${day.value}T12:30`,
    first_days: true,
  });

  // «Борги»: the series is the first days' paper there too.
  await section(page, "Борги");
  await page.getByLabel("Ім’я або телефон").fill(name);
  await page.getByRole("button", { name: `Відкрити борг: ${name},` }).click();
  await expect(
    page.getByRole("radio", { name: "Перші дні, до затвердження залишків" }),
  ).toBeChecked();
  await page.getByLabel("Сума внеску, грн").fill("300");
  await page
    .getByRole("group", { name: "Внесок", exact: true })
    .getByRole("button", { name: "З паперу · Картка" })
    .click();
  await expect(
    page.getByText(
      "Внесок 300,00 грн з паперу записано: карткою — оплату вже провели, на терміналі не проводьте ще раз. Залишок боргу 1 700,00 грн.",
    ),
  ).toBeVisible();
  await expect(page.locator(".paid-result .badge.warn")).toHaveText(
    "Внесок з паперу",
  );
  await expect(page.locator(".paid-result")).toContainText("Уже взяли раніше");
  await expect(page.locator(".paid-result")).not.toContainText("Проведіть");
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await expect(page.getByRole("list", { name: "Історія боргу" })).toContainText(
    "Внесок з паперу · внесено: Ліда",
  );
  expect(payments[0]?.outage).toEqual({
    by_user_id: null,
    at: null,
    first_days: true,
  });

  await openAs(page, fixture.network_owner_telegram_user_id, "Власник мережі");
  await section(page, "Звіт про продажі");
  await expect(
    page
      .getByRole("list", { name: "Продажі й повернення" })
      .getByRole("listitem")
      .filter({ hasText: model })
      .filter({ hasText: "Повернення" }),
  ).toContainText(`${mark} · внесено: Ліда`);
});
