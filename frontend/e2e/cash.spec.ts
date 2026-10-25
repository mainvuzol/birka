import { test, expect, fillLine, more, openStore, tapSize } from "./fixtures";
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
 * was first counted yesterday evening — close #1, 1 000,00 грн
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
  network_market_store_id: string;
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
  await tapSize(page, coat.variant, coat.size);
  await fillLine(page, { price });
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
    // A second store, so leaving the store is offered, and held while a
    // reason is owed (G12): one store has nothing to change to (P0-1).
    await page.route("**/api/v1/me", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { stores: object[] };
      body.stores.push({
        id: "6a3c1f0e-0000-4000-8000-0000000000d4",
        name: "Ринок",
        code: "RIN",
        state: "ACTIVE",
        state_since: null,
        permissions: [],
      });
      await route.fulfill({ response, json: body });
    });
    await openAs(page, olya, "Оля");
    await openStore(page, /^Каса CASH/);
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
    // Three taps from the receipt: «Змінити спосіб оплати», the way,
    // «Змінити на «Готівка»» (cash task list, P1-3).
    await page.evaluate(() => {
      const host = window as unknown as { taps: number };
      host.taps = 0;
      document.addEventListener(
        "click",
        (event) => {
          if ((event.target as Element).closest("button")) host.taps += 1;
        },
        true,
      );
    });
    await page.getByRole("button", { name: "Змінити спосіб оплати" }).click();
    // The sale: its sum large, its way now a pill.
    await expect(page.locator(".fix-what")).toHaveText("Продаж");
    await expect(page.locator(".fix-sum")).toHaveText("700,00 грн");
    await expect(
      page.getByText("Зараз: Картка", { exact: true }),
    ).toBeVisible();
    const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
    await expect(ways.getByRole("button")).toHaveCount(3);
    await expect(
      ways.getByRole("button", { name: "Картка зараз", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Пояснення (необов’язково)"),
    ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
    await ways.getByRole("button", { name: "Готівка", exact: true }).click();
    await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
    await expect(
      page.getByText("Спосіб оплати змінено: Картка → Готівка."),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { taps: number }).taps),
    ).toBe(3);
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
    await expect(kinds.getByRole("button")).toHaveCount(2);
    await kinds
      .getByRole("button", { name: "Кур’єру постачальника", exact: true })
      .click();
    await expect(
      page.getByText("Накладну й оплату за нею запише менеджер."),
    ).toBeVisible();
    await kinds.getByRole("button", { name: "Витрати", exact: true }).click();
    await page.getByLabel("Сума", { exact: true }).fill("150");
    await expect(
      page.getByLabel("На що (необов’язково)"),
    ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
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
    await page.getByRole("button", { name: "Видати 150,00 грн" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Не записано:" }),
    ).toHaveText(
      /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\. Якщо гроші взяли чи внесли вже після закриття — запишіть ще раз\. Якщо до нього — це запише менеджер до того закриття\.$/,
    );
    await expect(page.getByLabel("Сума", { exact: true })).toHaveValue("150");
    await page.getByRole("button", { name: "Видати 150,00 грн" }).click();
    await expect(
      page.getByText("Записано: Витрати, 150,00 грн."),
    ).toBeVisible();
    // A new attempt, not the refused one resent.
    expect(moves).toHaveLength(2);
    expect(moves[1]?.command_id).not.toBe(moves[0]?.command_id);
    // A row: what for, when and who, and the sum out (cash task list, P0-1).
    const given = page
      .getByRole("list", { name: "Видано й внесено" })
      .getByRole("listitem");
    await expect(given).toHaveCount(1);
    await expect(given.locator(".history-what")).toHaveText("Витрати · пакети");
    await expect(given.locator(".history-meta")).toHaveText(
      /^\d{2}:\d{2} · Оля$/,
    );
    await expect(given.locator(".history-sum")).toHaveText("−150,00 грн");

    // Blind: nothing tells what the drawer should hold, and no list of their
    // sales with their sums (G32).
    await expect(page.getByText(/Мало бути/)).toHaveCount(0);
    await expect(page.getByText(/2\s?050,00/)).toHaveCount(0);
    await expect(page.getByText(/500,00|700,00/)).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Ваші операції" })).toHaveCount(
      0,
    );

    // Four taps from anywhere and the sum: «Каса», «Закрити касу», the
    // sum, «Закрити касу», «Так, закрити» (cash task list, P0-2).
    await page.getByRole("button", { name: "Продаж", exact: true }).click();
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    // The card reads the drawer again: the newest close is the one the
    // count names. Shown once «Каса»'s own read has come.
    await expect(
      page.getByRole("button", { name: "Закрити касу", exact: true }),
    ).toBeVisible();
    const reread = page.waitForResponse(
      (answer) =>
        answer.url().includes("/api/v1/cash/drawer") &&
        answer.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Закрити касу", exact: true })
      .click();
    await reread;
    await expect(
      page.getByRole("heading", { name: "Підрахунок каси" }),
    ).toBeVisible();
    await page.getByLabel("Скільки готівки в касі зараз").fill("2000");
    await page
      .getByRole("button", { name: "Закрити касу", exact: true })
      .click();
    await expect(page.locator(".pay-panel .pay-total")).toHaveText(
      "Закрити касу: у касі 2 000,00 грн?",
    );
    await expect(page.locator(".pay-panel .pay-what")).toHaveText(
      "Змінити потім не можна.",
    );
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

    // 1000 counted yesterday + 500 cash + 700 fixed to cash − 150 for bags:
    // «Мало бути» and «Порахували» large, the difference on its own line, a
    // warning's (cash task list, P0-3; owner decision, 2026-10-21).
    await expect(
      page.getByRole("heading", { name: "Касу закрито" }),
    ).toBeVisible();
    const figures = page.getByRole("group", { name: "Закриття каси" });
    await expect(figures.locator(".owed-what")).toHaveText([
      "Мало бути",
      "Порахували",
    ]);
    await expect(figures.locator(".cash-sum")).toHaveText([
      "2 050,00 грн",
      "2 000,00 грн",
    ]);
    await expect(figures.locator(".cash-difference")).toHaveText(
      "Нестача 50,00 грн",
    );
    await expect(figures.locator(".cash-difference")).toHaveClass(/\bwarn\b/);
    const slip = page
      .getByRole("list", { name: "Картка й переказ" })
      .getByRole("listitem");
    await expect(slip.locator(".history-what")).toHaveText([
      "Картка",
      "Переказ",
    ]);
    await expect(slip.first().locator(".history-meta")).toHaveText(
      "оплати 700,00 грн · повернення 0,00 грн · виправлено −700,00 грн · звірте з чеком терміналу",
    );
    await expect(slip.locator(".history-sum")).toHaveText([
      "0,00 грн",
      "0,00 грн",
    ]);

    // The reason is required: until it is written, only «Каса» is open.
    const reason = page.getByLabel("Чому не збігається? (обов’язково)");
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAccessibleDescription(
      "Без імен і телефонів покупців.",
    );
    await more(page);
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
    await openStore(page, /^Каса CASH/);
    await expect(reason).toBeVisible();
    await expect(figures.locator(".cash-difference")).toHaveText(
      "Нестача 50,00 грн",
    );
    await expect(
      page.getByRole("button", { name: "Продаж", exact: true }),
    ).toBeDisabled();
    await reason.fill("помилилась зі здачею");
    await page.getByRole("button", { name: "Записати причину" }).click();
    await expect(
      page.getByText("Причину записано. Власник отримає повідомлення."),
    ).toBeVisible();
    await more(page);
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
    await expect(page.locator(".cash-reason")).toHaveText(
      "Причина: «помилилась зі здачею» · Оля",
    );
    // «Готово»: closed today, the card is gone until tomorrow, and the day's
    // close stands compact, with its reason (cash task list, P0-1).
    await page.getByRole("button", { name: "Готово" }).click();
    await expect(page.locator(".cash-context")).toHaveText(
      /^Сьогодні закрито о \d{2}:\d{2} · Оля$/,
    );
    await expect(
      page.getByRole("button", { name: "Закрити касу", exact: true }),
    ).toHaveCount(0);
    const closedToday = page.getByRole("group", { name: "Закриття каси" });
    await expect(closedToday).toContainText(
      "Мало бути 2 050,00 грн · Порахували 2 000,00 грн · Нестача 50,00 грн",
    );
    await expect(closedToday).toContainText(
      "Причина: «помилилась зі здачею» · Оля",
    );
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
    await openStore(page, /^Каса CASH/);
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
    await more(page);
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
    await openStore(page, /^Каса CASH/);
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
    await openStore(page, /^Каса CASH/);
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Внести в касу" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закриття", exact: true }).click();
    // A row each: what was counted and expected, what it came to as a pill
    // (cash task list, P1-4).
    const closes = page.getByRole("list", { name: "Закриття каси" });
    const row = closes.getByRole("listitem", {
      name: `Закриття ${dayOf(today.business_day)}`,
    });
    await expect(row.locator(".sale-meta")).toHaveText(
      /^\d{2}:\d{2} · порахували 2\s000,00 · мало бути 2\s050,00$/,
    );
    await expect(row.locator(".badge")).toHaveText("Нестача 50,00 грн");
    await expect(
      closes.getByRole("listitem").filter({ hasText: "Перший підрахунок" }),
    ).toContainText("порахували 1 000,00");
    // Tapped: all of it, as its result showed it.
    await row.getByRole("button").click();
    const figures = page.getByRole("group", { name: "Закриття каси" });
    await expect(figures).toContainText("Нестача 50,00 грн");
    await expect(
      page.getByText("Причина: «помилилась зі здачею» · Оля"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Назад до закриттів" }).click();

    // The owner took 50 for themselves before that count, and recorded it
    // only now: against that close, which it explains (G7).
    await page.getByRole("button", { name: "Назад до каси" }).click();
    await page.getByRole("button", { name: "Видати з каси" }).click();
    const kinds = page.getByRole("group", { name: "Кому чи на що" });
    await expect(kinds.getByRole("button")).toHaveCount(3);
    await kinds.getByRole("button", { name: "Власнику", exact: true }).click();
    await page.getByLabel("Сума", { exact: true }).fill("50");
    await page
      .getByLabel("Коли?")
      .selectOption({ label: `До закриття ${dayOf(today.business_day)}` });
    await page.getByRole("button", { name: "Видати 50,00 грн" }).click();
    await expect(
      page.getByText(`Записано до закриття ${dayOf(today.business_day)}.`),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закриття", exact: true }).click();
    await expect(row.locator(".sale-meta")).toHaveText(
      /^\d{2}:\d{2} · порахували 2\s000,00 · мало бути 2\s050,00 · пояснено −50,00$/,
    );
    await row.getByRole("button").click();
    await expect(
      page.getByText("Пояснено: −50,00 грн. Не пояснено: 0,00 грн."),
    ).toBeVisible();
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
  await openStore(page, /^Каса CASH/);
  await expect(page.getByRole("alert")).toHaveText(
    /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\. Якщо гроші взяли чи внесли вже після закриття — запишіть ще раз\. Якщо до нього — це запише менеджер до того закриття\.$/,
  );
  await more(page);
  for (const name of otherTabs)
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(
    null,
  );
});

test("a kept fix of a way refused on its resend still says what was not recorded once another tab was opened", async ({
  page,
}) => {
  // A fix of a sale's way whose answer never came, kept on the phone.
  const key = await journalKey(page, olya);
  await seed(
    page,
    key,
    JSON.stringify({
      key: randomUUID(),
      body: {
        command: "correction",
        store_id: store,
        command_id: randomUUID(),
        target: "SALE",
        target_id: randomUUID(),
        from_method: "CASH",
        to_method: "CARD",
        note: null,
      },
      ambiguous: true,
    }),
  );
  // The server's answer to its resend, made up here: the day was closed
  // meanwhile, and a seller fixes their own operation only before the close.
  await page.route("**/api/v1/cash/corrections", (route) =>
    route.fulfill({
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "Request failed validation",
        details: { reason: "DAY_CLOSED", recorded: false },
      },
    }),
  );
  await openAs(page, olya, "Оля");
  await openStore(page, /^Каса CASH/);
  const said =
    "Зміну способу оплати не записано. Касу вже закрито: змінити спосіб оплати тепер може лише менеджер або власник.";
  await expect(page.getByRole("alert")).toHaveText(said);
  // The refusal outlives «Каса»: opened again, it names its own command,
  // not the count.
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await page.getByRole("button", { name: "Каса", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(said);
});

for (const kept of [
  {
    name: "fix of a way",
    path: "corrections",
    body: {
      command: "correction",
      target: "SALE",
      target_id: randomUUID(),
      from_method: "CASH",
      to_method: "CARD",
      note: null,
    },
    what: "Зміну способу оплати ще не підтверджено",
  },
  {
    name: "count at the close",
    path: "closes?**",
    body: {
      command: "close",
      counted: "1500.00",
      counted_at: new Date().toISOString(),
      after_close_id: null,
    },
    what: "Підрахунок ще не підтверджено",
  },
  {
    name: "reason of a difference",
    path: "closes/*/reason",
    body: { command: "reason", close_id: randomUUID(), reason: "Решта" },
    what: "Причину ще не підтверджено",
  },
  {
    name: "money taken out",
    path: "movements",
    body: {
      command: "movement",
      movement_kind: "EXPENSES",
      amount: "100.00",
      note: null,
      after_close_id: null,
    },
    what: "Видачу ще не підтверджено",
  },
  {
    name: "money put in",
    path: "movements",
    body: {
      command: "movement",
      movement_kind: "CHANGE",
      amount: "100.00",
      note: null,
      after_close_id: null,
    },
    what: "Внесення ще не підтверджено",
  },
])
  test(`a kept ${kept.name} a server fails to answer is still unconfirmed, by its own name (owner decision, 2026-10-19)`, async ({
    page,
  }) => {
    const key = await journalKey(page, olya);
    await seed(
      page,
      key,
      JSON.stringify({
        key: randomUUID(),
        body: { store_id: store, command_id: randomUUID(), ...kept.body },
        ambiguous: true,
      }),
    );
    let status = 500;
    let sent = 0;
    await page.route(`**/api/v1/cash/${kept.path}`, async (route) => {
      sent += 1;
      await route.fulfill({
        status,
        headers:
          status === 500
            ? { "X-Request-ID": "5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d" }
            : {},
        json: {
          code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
          message: "Refused",
        },
      });
    });
    await openAs(page, olya, "Оля");
    await openStore(page, /^Каса CASH/);
    await page.getByRole("button", { name: "Каса", exact: true }).click();
    // Never «спробуйте ще раз»: it may be recorded already.
    // In «Каса»'s words (owner decision after #138, 2026-10-25).
    const unconfirmed = `${kept.what}: сервер не зміг відповісти. Перевірте результат ще раз — двічі цю операцію не запишуть.`;
    const said = page.getByRole("alert");
    await expect(said).toHaveText(`${unconfirmed} Номер запиту: 5a6b7c8d.`);
    expect(
      await page.evaluate((stored) => localStorage.getItem(stored), key),
    ).not.toBeNull();
    if (kept.name !== "fix of a way") return;
    // Its banner counts its «not found»: a manager at the third.
    status = 404;
    const check = page.getByRole("button", {
      name: "Перевірити зміну способу оплати",
    });
    for (const more of [1, 2, 3]) {
      await check.click();
      await expect.poll(() => sent).toBe(1 + more);
      await expect(check).toBeEnabled();
      await expect(said).toHaveText(
        more === 3
          ? `${unconfirmed} Зверніться до менеджера: нехай перевірить, чи записано.`
          : unconfirmed,
      );
    }
  });

test("a refusal read in one store's «Каса» does not follow into another store whose kept command cannot be read", async ({
  page,
}) => {
  // In «Каса»: a fix of a way, kept on the phone and refused on its resend.
  const key = await journalKey(page, owner);
  await seed(
    page,
    key,
    JSON.stringify({
      key: randomUUID(),
      body: {
        command: "correction",
        store_id: store,
        command_id: randomUUID(),
        target: "SALE",
        target_id: randomUUID(),
        from_method: "CASH",
        to_method: "CARD",
        note: null,
      },
      ambiguous: true,
    }),
  );
  // In «Ринок»: what an earlier visit left there cannot be read.
  await seed(
    page,
    key.replace(store, fixture.network_market_store_id),
    "{not a command",
  );
  await page.route("**/api/v1/cash/corrections", (route) =>
    route.fulfill({
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "Request failed validation",
        details: { reason: "BEFORE_DRAWER", recorded: false },
      },
    }),
  );
  await openAs(page, owner);
  await openStore(page, /^Каса CASH/);
  const said =
    "Зміну способу оплати не записано. Цю операцію записано до того, як застосунок почав рахувати касу: її спосіб оплати не змінюють.";
  await expect(page.getByRole("alert")).toHaveText(said);
  await page.getByRole("button", { name: "Змінити магазин" }).click();
  await openStore(page, /^Ринок MARKET/);
  await expect(
    page.getByText(/^Не вдалося прочитати збережену операцію каси/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Каса", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Каса" })).toBeVisible();
  await expect(page.getByText(said)).toHaveCount(0);
});

test("a blocked store: only the network's owner counts and closes its day", async ({
  page,
}) => {
  await openAs(page, owner);
  await openStore(page, /^Зупинений PAUSED/);
  await expect(page.getByText(/Лише перегляд/)).toBeVisible();
  await page.getByRole("button", { name: "Каса", exact: true }).click();
  await expect(page.locator(".cash-context")).toHaveText(
    "Каса ще не рахувалась",
  );
  // Nothing else is recorded in a store that does not trade (G15).
  await expect(page.getByRole("button", { name: "Видати з каси" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Змінити спосіб оплати" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Перший підрахунок", exact: true })
    .click();
  await page.getByLabel("Скільки готівки в касі зараз").fill("320");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  const closed = page.waitForResponse(isClose);
  await page.getByRole("button", { name: "Так, закрити" }).click();
  expect((await closed).status()).toBe(201);
  await expect(
    page.getByRole("heading", { name: "Перший підрахунок записано" }),
  ).toBeVisible();
  const first = page.getByRole("group", { name: "Підрахунок" });
  await expect(first.locator(".cash-sum")).toHaveText("320,00 грн");
  await expect(first).toContainText("З цієї суми почнемо наступного разу.");

  // «Марко» manages it: a manager's rights give nothing while it is blocked.
  await openAs(page, marko);
  await openStore(page, /^Зупинений PAUSED/);
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
