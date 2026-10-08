import { test, expect } from "./fixtures";
import type { Page, Response } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Каса» (owner decisions, 2026-10-04; ADR-0012, D3): one drawer per store,
 * closed once a day by the seller on duty, who counts it blind and sees the
 * difference only after; a difference of 1,00 грн or more needs their
 * reason, and until they write it only «Каса» is open on their phone. Cash
 * taken out is recorded with who and why; before the close a seller fixes
 * the way of their own sale; a closed day is never reopened, and the owner
 * explains its difference with what was recorded late. A blocked store is
 * closed by the network's owner alone.
 *
 * In a store of its own, «Каса», so that no other journey's sales move the
 * figures: «Оля» sells there with a seller's default rights, and its drawer
 * was first counted yesterday evening — close #1, 1000,00 грн
 * (`seed_orders_e2e.seed_drawer`).
 */
interface Fixture {
  network_owner_telegram_user_id: string;
  network_centre_manager_telegram_user_id: string;
  network_cash_seller_telegram_user_id: string;
  network_cash_store_id: string;
  network_cash_location_id: string;
  network_cash_first_close_id: string;
  network_paused_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const owner = fixture.network_owner_telegram_user_id;
const marko = fixture.network_centre_manager_telegram_user_id;
const olya = fixture.network_cash_seller_telegram_user_id;
const store = fixture.network_cash_store_id;

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

/** The app, opened from Telegram by this person. */
async function openAs(
  page: Page,
  telegramUserId: string,
  name = "Тест",
): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId, name) }).toString()}`,
  );
}

async function headersOf(
  page: Page,
  telegramUserId: string,
): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId, "Тест") },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

/** Where this person's journals are kept on the phone. */
async function journalKey(page: Page, telegramUserId: string): Promise<string> {
  const me = (await (
    await page.request.get("/api/v1/me", {
      headers: await headersOf(page, telegramUserId),
    })
  ).json()) as { organization_id: string; user_id: string };
  return `birka:cash-pending:${me.organization_id}:${me.user_id}:${store}`;
}

/** Puts an entry in the phone's storage, as an earlier visit left it. */
async function seed(page: Page, key: string, value: string): Promise<void> {
  // Outside Telegram the app only asks to be opened from the bot.
  await page.goto("/");
  await page.evaluate(
    ([name, saved]) => {
      localStorage.setItem(name, saved);
    },
    [key, value] as const,
  );
  await page.goto("about:blank");
}

interface Coat {
  variant: string;
  size: string;
}

/** Five coats in «Каса»'s warehouse, received by the network's owner. */
async function coats(page: Page): Promise<Coat> {
  const headers = await headersOf(page, owner);
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: store,
      concept: `Касове ${randomUUID().slice(0, 8)}`,
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
      store_id: store,
      location_id: fixture.network_cash_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
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
  return { variant: product.product_variant_id, size };
}

interface Sold {
  id: string;
  total: string;
  payment_method: string | null;
}

/** One coat sold at «Продаж» for `price`, paid the way pressed. */
async function sell(
  page: Page,
  coat: Coat,
  price: string,
  way: "Готівка" | "Картка" | "Переказ",
): Promise<Sold> {
  await page
    .getByRole("combobox", { name: "Товар і розмір", exact: true })
    .selectOption(`${coat.variant}:${coat.size}`);
  await page.getByLabel("Кількість").fill("1");
  await page.getByLabel("Ціна за одиницю, грн").fill(price);
  await page.getByRole("button", { name: "Додати в кошик" }).click();
  const sold = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/sales") && r.request().method() === "POST",
  );
  await page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: way, exact: true })
    .click();
  const response = await sold;
  expect(response.status()).toBe(201);
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  return (await response.json()) as Sold;
}

function isClose(response: Response): boolean {
  return (
    response.url().includes("/api/v1/cash/closes?age=") &&
    response.request().method() === "POST"
  );
}

/** «04.10» of a business day `2026-10-04`, as the screens write it. */
function dayOf(day: string): string {
  const [, month = "", date = ""] = day.split("-");
  return `${date}.${month}`;
}

/** Every tab but «Каса», as a phone held for a reason shows them. */
const otherTabs = ["Замовлення", "Продаж", "Повернення", "Борги"];

test.describe("«Оля»'s day at «Каса»", () => {
  // One day, in order: what they sell is what they count, and what they
  // count is what the owner reads.
  test.describe.configure({ mode: "serial" });
  let cashSale: Sold;
  let today: { id: string; business_day: string };

  test("they sell for cash and by card, fix the card sale from its receipt, take out for bags, and close blind; until they give the reason only «Каса» is open", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const coat = await coats(page);
    await openAs(page, olya, "Оля");
    await page.getByRole("button", { name: /^Каса CASH/ }).click();
    await page.getByRole("button", { name: "Продаж", exact: true }).click();
    cashSale = await sell(page, coat, "500", "Готівка");
    expect(cashSale.payment_method).toBe("CASH");
    await page.getByRole("button", { name: "Новий продаж" }).click();
    const cardSale = await sell(page, coat, "700", "Картка");
    expect(cardSale.payment_method).toBe("CARD");

    // The terminal refused the card and the customer paid cash: they fix
    // it from the receipt, before the close (owner decision, 2026-10-04).
    const corrections: unknown[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v1/cash/corrections")
      )
        corrections.push(request.postDataJSON());
    });
    await page.getByRole("button", { name: "Змінити спосіб оплати" }).click();
    await expect(
      page.getByText("Продаж: 700,00 грн · зараз Картка"),
    ).toBeVisible();
    const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
    await expect(ways.getByRole("radio")).toHaveCount(2);
    await ways.getByRole("radio", { name: "Готівка", exact: true }).check();
    await page.getByRole("button", { name: "Так, змінити" }).click();
    await expect(
      page.getByText("Спосіб оплати змінено: Картка → Готівка."),
    ).toBeVisible();
    expect(corrections).toEqual([
      {
        command_id: expect.any(String) as string,
        target: "SALE",
        target_id: cardSale.id,
        from_method: "CARD",
        to_method: "CASH",
      },
    ]);

    // Cash for bags, recorded before the count. A seller records expenses
    // and a supplier's courier, nothing else (G34).
    await page.getByRole("button", { name: "Видати з каси" }).click();
    const kinds = page.getByRole("group", { name: "Кому чи на що" });
    await expect(kinds.getByRole("radio")).toHaveCount(2);
    await kinds
      .getByRole("radio", { name: "Кур’єру постачальника", exact: true })
      .check();
    await expect(
      page.getByText("Накладну й оплату за нею запише менеджер."),
    ).toBeVisible();
    await kinds.getByRole("radio", { name: "Витрати", exact: true }).check();
    await page.getByLabel("Сума, грн").fill("150");
    await page.getByLabel("На що (необов’язково)").fill("пакети");
    // The first answer, made up here, is the server's refusal when a close
    // the form did not show came in between and is not the newest one made
    // in the last ten minutes (B5): nothing is recorded, the form says so
    // and keeps what they typed, and they record it again.
    const moves: { command_id: string }[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/api/v1/cash/movements")
      )
        moves.push(request.postDataJSON() as { command_id: string });
    });
    await page.route(
      "**/api/v1/cash/movements",
      (route) =>
        route.fulfill({
          status: 422,
          json: {
            code: "VALIDATION_ERROR",
            message: "Request failed validation",
            details: {
              reason: "CLOSE_IN_BETWEEN",
              recorded: false,
              closed_at: new Date().toISOString(),
              closed_by: "Олена",
            },
          },
        }),
      { times: 1 },
    );
    await page.getByRole("button", { name: "Записати", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Не записано:" }),
    ).toHaveText(
      /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\. Якщо гроші взяли чи внесли вже після закриття — запишіть ще раз\. Якщо до нього — це запише менеджер до того закриття\.$/,
    );
    await expect(page.getByLabel("Сума, грн")).toHaveValue("150");
    await page.getByRole("button", { name: "Записати", exact: true }).click();
    await expect(
      page.getByText("Записано: Витрати, 150,00 грн."),
    ).toBeVisible();
    // A new attempt, not the refused one resent.
    expect(moves).toHaveLength(2);
    expect(moves[1]?.command_id).not.toBe(moves[0]?.command_id);
    await expect(
      page.getByRole("list", { name: "Видано й внесено" }),
    ).toContainText("Витрати 150,00 грн · Оля · пакети");

    // Blind: nothing tells what the drawer should hold, and no list of their
    // sales with their sums (G32).
    await expect(page.getByText(/Мало бути/)).toHaveCount(0);
    await expect(page.getByText(/2050,00/)).toHaveCount(0);
    await expect(page.getByText(/500,00|700,00/)).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Ваші операції" })).toHaveCount(
      0,
    );

    // Three taps from anywhere: «Каса», «Закрити касу», «Так, закрити».
    await page.getByRole("button", { name: "Продаж", exact: true }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    await page.getByLabel("Скільки готівки в касі зараз, грн").fill("2000");
    await page
      .getByRole("button", { name: "Закрити касу", exact: true })
      .click();
    await expect(
      page.getByText(
        "Закрити касу: у касі 2000,00 грн? Змінити потім не можна.",
      ),
    ).toBeVisible();
    const closed = page.waitForResponse(isClose);
    await page.getByRole("button", { name: "Так, закрити" }).click();
    const response = await closed;
    expect(response.status()).toBe(201);
    const sent = response.request().postDataJSON() as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      "after_close_id",
      "command_id",
      "counted",
      "counted_at",
      "store_id",
    ]);
    expect(sent).toMatchObject({
      store_id: store,
      counted: "2000.00",
      after_close_id: fixture.network_cash_first_close_id,
    });
    today = (await response.json()) as typeof today;

    // 1000 counted yesterday + 500 cash + 700 fixed to cash − 150 for bags.
    await expect(
      page.getByText(
        "Касу закрито. Мало бути 2050,00 грн, порахували 2000,00 грн. Нестача 50,00 грн.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Картка: 0,00 грн (оплати 700,00 грн, повернення 0,00 грн, виправлено −700,00 грн). Звірте з чеком терміналу.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Переказ: 0,00 грн.")).toBeVisible();

    // The reason is required: until it is written, only «Каса» is open.
    const reason = page.getByLabel("Чому не збігається? (обов’язково)");
    await expect(reason).toBeVisible();
    for (const name of otherTabs)
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Каса", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Змінити магазин" }),
    ).toBeDisabled();

    // Read from the server: reopening the app does not lose it.
    await openAs(page, olya, "Оля");
    await page.getByRole("button", { name: /^Каса CASH/ }).click();
    await expect(reason).toBeVisible();
    await expect(page.getByText(/Нестача 50,00 грн\./)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Продаж", exact: true }),
    ).toBeDisabled();
    await reason.fill("помилилась зі здачею");
    await page.getByRole("button", { name: "Записати причину" }).click();
    await expect(
      page.getByText("Причину записано. Власник отримає повідомлення."),
    ).toBeVisible();
    for (const name of otherTabs)
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeEnabled();
    // Written once: the form and its warning go, though the answer still
    // says the difference needed a reason; the close stays, with it.
    await expect(reason).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Записати причину" }),
    ).toHaveCount(0);
    await expect(page.getByText("Поки причину не записано")).toHaveCount(0);
    await expect(
      page.getByRole("status", { name: "Закриття каси" }),
    ).toContainText("Причина: «помилилась зі здачею» · Оля");
    // Closed today: the form is gone until tomorrow.
    await expect(
      page.getByText(/^Касу сьогодні закрито о \d{2}:\d{2} · Оля\.$/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Закрити касу", exact: true }),
    ).toHaveCount(0);
  });

  test("a second close the same day is refused, and a close kept on the phone settles on that refusal", async ({
    page,
  }) => {
    const headers = await headersOf(page, olya);
    const again = await page.request.post("/api/v1/cash/closes?age=0", {
      headers,
      data: {
        store_id: store,
        command_id: randomUUID(),
        counted: "2000.00",
        counted_at: new Date().toISOString(),
        after_close_id: today.id,
      },
    });
    expect(again.status()).toBe(422);
    expect(
      ((await again.json()) as { details: Record<string, unknown> }).details,
    ).toMatchObject({ reason: "ALREADY_CLOSED_TODAY", recorded: false });

    // A close whose answer never came, kept on the phone.
    const key = await journalKey(page, olya);
    await seed(
      page,
      key,
      JSON.stringify({
        key: randomUUID(),
        body: {
          command: "close",
          store_id: store,
          command_id: randomUUID(),
          counted: "1990.00",
          counted_at: new Date().toISOString(),
          after_close_id: today.id,
        },
        ambiguous: true,
      }),
    );
    // Read from the phone's storage, it is checked at once, with no tap
    // (ADR-0013 §4.3).
    const resent = page.waitForResponse(isClose);
    await openAs(page, olya, "Оля");
    await page.getByRole("button", { name: /^Каса CASH/ }).click();
    const answer = await resent;
    expect(answer.status()).toBe(422);
    expect(
      ((await answer.json()) as { details: Record<string, unknown> }).details,
    ).toMatchObject({ reason: "ALREADY_CLOSED_TODAY", recorded: false });
    // The resend carried the same body, and its age from the phone's clock.
    expect(answer.url()).toMatch(/\?age=\d+$/);
    expect(
      (answer.request().postDataJSON() as { counted: string }).counted,
    ).toBe("1990.00");
    await expect(page.getByRole("alert")).toHaveText(
      /^Підрахунок не записано\. Касу сьогодні вже закрито о \d{2}:\d{2} · Оля\. Наступне закриття — завтра\.$/,
    );
    for (const name of otherTabs)
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeEnabled();
    expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(
      null,
    );
  });

  test("after the close their own fix is refused: the day is closed, and only a manager corrects it", async ({
    page,
  }) => {
    const fixed = await page.request.post("/api/v1/cash/corrections", {
      headers: await headersOf(page, olya),
      data: {
        command_id: randomUUID(),
        target: "SALE",
        target_id: cashSale.id,
        from_method: "CASH",
        to_method: "CARD",
      },
    });
    expect(fixed.status()).toBe(422);
    expect(
      ((await fixed.json()) as { details: Record<string, unknown> }).details,
    ).toMatchObject({ reason: "DAY_CLOSED", recorded: false });
    // Their list holds the open period only, and nothing was sold since.
    await openAs(page, olya, "Оля");
    await page.getByRole("button", { name: /^Каса CASH/ }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    await page.getByRole("button", { name: "Змінити спосіб оплати" }).click();
    await expect(
      page.getByText("Після останнього закриття ви ще нічого не провели."),
    ).toBeVisible();
  });

  test("the owner reads the closes, and explains the difference with cash taken out and recorded late", async ({
    page,
  }) => {
    await openAs(page, owner);
    await page.getByRole("button", { name: /^Каса CASH/ }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Внести в касу" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закриття", exact: true }).click();
    const closes = page.getByRole("list", { name: "Закриття каси" });
    const row = closes.getByRole("listitem", {
      name: `Закриття ${dayOf(today.business_day)}`,
    });
    await expect(row).toContainText(
      "Порахували 2000,00 грн, мало бути 2050,00 грн. Нестача 50,00 грн.",
    );
    await expect(row).toContainText("Причина: «помилилась зі здачею» · Оля");
    await expect(
      closes.getByRole("listitem").filter({ hasText: "Перший підрахунок" }),
    ).toContainText("Перший підрахунок: 1000,00 грн.");

    // The owner took 50 for themselves before that count, and recorded it
    // only now: against that close, which it explains (G7).
    await page.getByRole("button", { name: "До каси" }).click();
    await page.getByRole("button", { name: "Видати з каси" }).click();
    const kinds = page.getByRole("group", { name: "Кому чи на що" });
    await expect(kinds.getByRole("radio")).toHaveCount(3);
    await kinds.getByRole("radio", { name: "Власнику", exact: true }).check();
    await page.getByLabel("Сума, грн").fill("50");
    await page
      .getByLabel("Коли?")
      .selectOption({ label: `До закриття ${dayOf(today.business_day)}` });
    await page.getByRole("button", { name: "Записати", exact: true }).click();
    await expect(
      page.getByText(`Записано до закриття ${dayOf(today.business_day)}.`),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закриття", exact: true }).click();
    await expect(row).toContainText(
      "Пояснено: −50,00 грн. Не пояснено: 0,00 грн.",
    );
  });
});

test("a take-out kept on the phone settles on the refusal of a close in between, and says once what was not recorded", async ({
  page,
}) => {
  // A take-out whose answer never came, kept on the phone.
  const key = await journalKey(page, olya);
  await seed(
    page,
    key,
    JSON.stringify({
      key: randomUUID(),
      body: {
        command: "movement",
        store_id: store,
        command_id: randomUUID(),
        movement_kind: "EXPENSES",
        amount: "40.00",
        note: null,
        after_close_id: fixture.network_cash_first_close_id,
      },
      ambiguous: true,
    }),
  );
  // The server's answer to its resend, made up here: a close came in
  // between, and it is not the newest one made in the last ten minutes (B5).
  await page.route("**/api/v1/cash/movements", (route) =>
    route.fulfill({
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "Request failed validation",
        details: {
          reason: "CLOSE_IN_BETWEEN",
          recorded: false,
          closed_at: new Date().toISOString(),
          closed_by: "Олена",
        },
      },
    }),
  );
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3).
  await openAs(page, olya, "Оля");
  await page.getByRole("button", { name: /^Каса CASH/ }).click();
  await expect(page.getByRole("alert")).toHaveText(
    /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\. Якщо гроші взяли чи внесли вже після закриття — запишіть ще раз\. Якщо до нього — це запише менеджер до того закриття\.$/,
  );
  for (const name of otherTabs)
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(
    null,
  );
});

test("a blocked store: only the network's owner counts and closes its day", async ({
  page,
}) => {
  await openAs(page, owner);
  await page.getByRole("button", { name: /^Зупинений PAUSED/ }).click();
  await expect(page.getByText(/Лише перегляд/)).toBeVisible();
  await page.getByRole("button", { name: "Каса", exact: true }).click();
  await expect(
    page.getByText(
      "Каса ще не рахувалась — цей підрахунок запише, скільки в ній зараз",
    ),
  ).toBeVisible();
  // Nothing else is recorded in a store that does not trade (G15).
  await expect(page.getByRole("button", { name: "Видати з каси" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Виправити спосіб оплати" }),
  ).toHaveCount(0);
  await page.getByLabel("Скільки готівки в касі зараз, грн").fill("320");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  const closed = page.waitForResponse(isClose);
  await page.getByRole("button", { name: "Так, закрити" }).click();
  expect((await closed).status()).toBe(201);
  await expect(
    page.getByText(
      "Перший підрахунок: 320,00 грн. З цієї суми почнемо наступного разу.",
    ),
  ).toBeVisible();

  // «Марко» manages it: a manager's rights give nothing while it is blocked.
  await openAs(page, marko);
  await page.getByRole("button", { name: /^Зупинений PAUSED/ }).click();
  await expect(
    page.getByText(/Роботу в цьому магазині зупинено/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Каса", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Закрити касу" })).toHaveCount(
    0,
  );
});

test.describe("a screen that breaks", () => {
  test.use({ pageErrorsExpected: true });

  test("«Щось пішло не так» promises the drawer's command kept on the phone", async ({
    page,
  }) => {
    await seed(
      page,
      await journalKey(page, olya),
      JSON.stringify({
        key: randomUUID(),
        body: {
          command: "movement",
          store_id: store,
          command_id: randomUUID(),
          movement_kind: "EXPENSES",
          amount: "40.00",
          note: null,
          after_close_id: null,
        },
        ambiguous: true,
      }),
    );
    // What the server says of this person, broken: a store list that is
    // not one. The screen that lists the stores throws on it.
    await page.route("**/api/v1/me", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({ response, json: { ...body, stores: null } });
    });
    await openAs(page, olya, "Оля");
    await expect(
      page.getByRole("heading", { name: "Щось пішло не так" }),
    ).toBeVisible();
    await expect(page.locator("[data-crashed]")).toContainText(
      "Операцію, на яку сервер ще не відповів, збережено: після перезапуску застосунок покаже її для перевірки.",
    );
  });
});
