import {
  test,
  expect,
  expectStub,
  openStore,
  section,
  tillWays,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * One debt in «Борги» (credits task list, P0-3, P0-4): who and what in one
 * line, what is owed first and large with how much of it is paid, the
 * history a row an entry; the payment's sum under it and its three ways
 * under the thumb, none pressable without a sum. The store's debts are
 * stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  /** «Другий», where «Оля» works too. */
  second_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function launch(theme?: Record<string, string>, version?: string): string {
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
  const hash = new URLSearchParams({ tgWebAppData: fields.toString() });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
}

type Debt = Record<string, unknown> & { id: string };

const thisYear = new Date().getFullYear();

/** A debt of «Основний», sold at 3 000: 1 000 paid now, 500 later in cash,
 * a coat of 500 brought back with its money on the card. What is owed is
 * the server's, and on purpose no sum of the others: 1 234,56. */
function debt(extra: Record<string, unknown> = {}): Debt {
  return {
    id: randomUUID(),
    sale_id: randomUUID(),
    store_id: fixture.store_id,
    store_name: "Основний",
    store_state: "ACTIVE",
    customer_name: "Оксана Петренко",
    customer_phone: "067 123 45 67",
    customer_erased_at: null,
    amount: "3000.00",
    currency_code: "UAH",
    status: "OPEN",
    paid: "1500.00",
    returned: "500.00",
    cash_back: "500.00",
    written_off: "0.00",
    owed: "1234.56",
    opened_at: `${String(thisYear)}-10-01T10:00:00Z`,
    last_payment_at: `${String(thisYear)}-10-12T09:30:00Z`,
    closed_at: null,
    goods: ["Лоран шоколад · M", "Альпака сіра · L"],
    entries: [
      {
        kind: "PAYMENT",
        amount: "1000.00",
        cash_back: "0.00",
        at: `${String(thisYear)}-10-01T10:00:00Z`,
        by: "Оля",
        note: null,
        taken_at: null,
        payment_method: "CASH",
        corrected: false,
        outage: null,
      },
      {
        kind: "PAYMENT",
        amount: "500.00",
        cash_back: "0.00",
        at: `${String(thisYear)}-10-12T09:30:00Z`,
        by: "Ганна",
        note: null,
        taken_at: "Центр",
        payment_method: "CASH",
        corrected: false,
        outage: null,
      },
      {
        kind: "RETURN",
        amount: "500.00",
        cash_back: "500.00",
        at: `${String(thisYear)}-10-13T11:00:00Z`,
        by: "Оля",
        note: null,
        taken_at: null,
        payment_method: "CARD",
        corrected: false,
        outage: null,
      },
    ],
    ...extra,
  };
}

/** The list holds this one debt; payments are answered as `paid` says, and
 * every body sent is kept. */
async function serve(
  page: Page,
  one: Debt,
  // Paid in all, the payment's sum on top: never this payment's alone, so
  // a result that shows it is seen.
  paid: (body: { amount: string }) => Debt = (body) => ({
    ...one,
    paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
  }),
): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    await route.fulfill({
      json: { owed: String(one.owed), customers: 1, debts: 1 },
    });
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            phone_digits: "0671234567",
            customer_name: one.customer_name,
            customer_phone: one.customer_phone,
            owed: one.owed,
            open_debts: one.status === "OPEN" ? 1 : 0,
            credits: [one],
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
    const body = route.request().postDataJSON() as { amount: string };
    sent.push(body);
    await route.fulfill({ status: 201, json: paid(body) });
  });
  return sent;
}

async function opened(
  page: Page,
  theme?: Record<string, string>,
  version?: string,
): Promise<void> {
  await page.goto(launch(theme, version));
  await openStore(page, "Основний MAIN");
  await section(page, "Борги");
  await page.getByRole("button", { name: /^Відкрити борг: / }).click();
}

function panel(page: Page): Locator {
  return page.getByRole("group", { name: "Внесок", exact: true });
}

test("«Клієнти» pressed again on a debt brings the debts' first screen (navigation task list, P0-2)", async ({
  page,
}) => {
  await serve(page, debt());
  await opened(page);
  await expect(panel(page)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Розділи" })
    .getByRole("button", { name: "Клієнти", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Відкрити борг: / }),
  ).toBeVisible();
});

test("a debt says who and what in one line, what is owed first and large, how much is paid, and its history a row an entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await serve(page, debt());
  await opened(page);

  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 2 }),
  ).toBeVisible();
  await expect(page.locator(".debt-context")).toHaveText(
    "067 123 45 67 · Лоран шоколад · M + ще 1 · з 01.10",
  );
  await expect(page.locator(".debt-context a")).toHaveAttribute(
    "href",
    "tel:0671234567",
  );
  // What they owe is the server's: never the sum less what is paid.
  const owed = page.getByRole("group", { name: "Скільки винні" });
  await expect(owed.locator(".owed-what")).toHaveText("Винні");
  await expect(owed.locator(".owed-sum")).toHaveText("1 234,56 грн");
  await expect(owed.locator(".owed-count")).toHaveText(
    "Сплачено 1 500,00 грн з 3 000,00 грн · повернено товару на 500,00 грн, з них грошима 500,00 грн",
  );
  const rows = page
    .getByRole("list", { name: "Історія боргу" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator(".history-what")).toHaveText([
    "Внесок · готівка",
    "Внесок · готівка",
    "Повернення товару",
  ]);
  await expect(rows.nth(0).locator(".history-meta")).toHaveText(
    /^01\.10, \d\d:\d\d · Оля$/,
  );
  await expect(rows.nth(1).locator(".history-meta")).toHaveText(
    /^12\.10, \d\d:\d\d · Ганна · прийняв магазин «Центр»$/,
  );
  await expect(rows.nth(2).locator(".history-meta")).toHaveText(
    /^13\.10, \d\d:\d\d · Оля · повернено 500,00\sгрн на картку$/,
  );
  await expect(rows.locator(".history-sum")).toHaveText([
    "1 000,00 грн",
    "500,00 грн",
    "500,00 грн",
  ]);
  // The panel never hides the last of it.
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  const row = await last.boundingBox();
  const below = await panel(page).boundingBox();
  if (!row || !below) throw new Error("not laid out");
  expect(row.y + row.height).toBeLessThanOrEqual(below.y + 1);
  // The owner's, and rare: after the history (P0-3).
  const writeOff = await page
    .getByRole("button", { name: "Списати борг" })
    .boundingBox();
  if (!writeOff) throw new Error("not laid out");
  expect(writeOff.y).toBeGreaterThan(row.y);
});

test("a usual debt at 360 × 640 shows who, what is owed, and the payment's sum and ways without scrolling, none under the panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await serve(
    page,
    debt({
      goods: ["Лоран шоколад · M"],
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      owed: "2000.00",
    }),
  );
  await opened(page);
  const owed = page.getByRole("group", { name: "Скільки винні" });
  for (const part of [
    page.getByRole("heading", { level: 2 }),
    page.locator(".debt-context"),
    owed.locator(".owed-sum"),
    page.getByLabel("Сума внеску, грн"),
    page.getByRole("button", { name: "Увесь залишок" }),
    panel(page).getByRole("button", { name: "Готівка" }),
    panel(page).getByRole("button", { name: "Переказ" }),
  ])
    await expect(part).toBeInViewport();
  // …and none of it under the panel.
  const under = await panel(page).boundingBox();
  const field = await page.getByLabel("Сума внеску, грн").boundingBox();
  const whole = await page
    .getByRole("button", { name: "Увесь залишок" })
    .boundingBox();
  if (!under || !field || !whole) throw new Error("not laid out");
  expect(field.y + field.height).toBeLessThanOrEqual(under.y);
  expect(whole.y + whole.height).toBeLessThanOrEqual(under.y);
});

test("nothing written off or returned is said unless it is, and what is written off is", async ({
  page,
}) => {
  await serve(
    page,
    debt({
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      owed: "2000.00",
      entries: [],
    }),
  );
  await opened(page);
  await expect(page.locator(".owed-count")).toHaveText(
    "Сплачено 1 000,00 грн з 3 000,00 грн",
  );
  await expect(page.locator(".owed-sum")).toHaveText("2 000,00 грн");
  await page.unroute("**/api/v1/credits/customers?**");
  await page.unroute("**/api/v1/credits/summary?**");
  await serve(
    page,
    debt({
      status: "WRITTEN_OFF",
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      written_off: "2000.00",
      owed: "0.00",
      closed_at: `${String(thisYear)}-10-15T09:00:00Z`,
      entries: [],
    }),
  );
  await page.goto("about:blank");
  await opened(page);
  await expect(page.locator(".debt-closed .badge")).toHaveText("Списано");
  await expect(page.locator(".debt-closed .badge")).toHaveClass(/\bneutral\b/);
  await expect(page.locator(".debt-closed")).toContainText(
    "Сплачено 1 000,00 грн з 3 000,00 грн · списано 2 000,00 грн",
  );
});

test("the payment's sum is typed under what is owed, and its three ways wait under the thumb for one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const sent = await serve(page, debt());
  await opened(page);

  // Nothing typed: nothing to press, and nothing sent.
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Впишіть суму внеску",
  );
  await expect(panel(page).getByRole("button")).toHaveText([
    "Готівка",
    "Картка",
    "Переказ",
  ]);
  for (const way of await panel(page).getByRole("button").all())
    await expect(way).toBeDisabled();
  await page.getByLabel("Сума внеску, грн").fill("0");
  await expect(
    panel(page).getByRole("button", { name: "Готівка" }),
  ).toBeDisabled();
  // Typed, but not a sum to the kopeck: said, never left to dead buttons.
  for (const unread of ["12,345", "500 грн"]) {
    await page.getByLabel("Сума внеску, грн").fill(unread);
    await expect(panel(page).locator(".pay-total")).toHaveText(
      "Вкажіть суму внеску з точністю до копійок.",
    );
    await expect(
      panel(page).getByRole("button", { name: "Готівка" }),
    ).toBeDisabled();
  }

  // The whole of what is owed, in one tap, the keyboard left closed.
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await expect(page.getByLabel("Сума внеску, грн")).toHaveValue("1234,56");
  await expect(page.getByLabel("Сума внеску, грн")).not.toBeFocused();
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Внесок 1 234,56 грн",
  );
  // What the panel says is what is sent.
  await page.getByLabel("Сума внеску, грн").fill("400");
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Внесок 400,00 грн",
  );
  await panel(page).getByRole("button", { name: "Картка" }).click();
  await expect(
    page.getByText("Внесок 400,00 грн прийнято карткою.", { exact: false }),
  ).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({
    amount: "400.00",
    command_id: expect.any(String) as string,
    payment_method: "CARD",
  });
  await expect(
    page.getByText("Внесок 400,00 грн прийнято карткою.", { exact: false }),
  ).toBeVisible();
});

test("a payment's result says what was done, how, the sum large and what is owed by the server; then the list as searched, or the debt read again", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const one = debt();
  // The server's answer: what is owed after is its own, never worked out.
  await serve(page, one, (body) => ({
    ...one,
    paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
    owed: "777.00",
  }));
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Борги");
  await page.getByLabel("Ім’я або телефон").fill("Окс");
  await page.getByRole("button", { name: /^Відкрити борг: / }).click();
  await page.getByLabel("Сума внеску, грн").fill("400");
  await panel(page).getByRole("button", { name: "Переказ" }).click();

  const paid = page.locator(".paid-result");
  const heading = paid.getByRole("heading", { name: "Внесок записано" });
  await expect(heading).toBeFocused();
  // Heard with its sentence as focus comes (review, 2026-10-18).
  await expect(heading).toHaveAccessibleDescription(
    "Внесок 400,00 грн прийнято переказом. Залишок боргу 777,00 грн.",
  );
  await expectStub(paid, {
    way: "Переказ",
    say: "Перевірте, що переказ надійшов",
    sum: "400,00 грн",
  });
  // Seen on its own line, not only inside the sentence a screen reader hears.
  await expect(
    paid.getByText("Залишок боргу 777,00 грн", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Внесок 400,00 грн прийнято переказом. Залишок боргу 777,00 грн.",
    ),
  ).toBeAttached();
  // In place of the form: nothing to pay again under it.
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel("Сума внеску, грн")).toHaveCount(0);

  // The debt again, as the server answered it, begun at its name.
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await expect(page.locator(".owed-sum")).toHaveText("777,00 грн");
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 2 }),
  ).toBeFocused();
  await page.getByLabel("Сума внеску, грн").fill("100");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(paid.locator(".way-pill")).toHaveText("Готівка");
  // The list, as it was searched.
  await paid.getByRole("button", { name: "До боргів" }).click();
  await expect(page.getByLabel("Ім’я або телефон")).toHaveValue("Окс");
});

test("Telegram buzzes once the server has answered a payment: success when recorded, error when refused; a lost answer, and its confirmation later, nothing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
    };
    host.buzzes = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
      },
    };
  });
  const one = debt();
  let refuse = false;
  let lose = false;
  await serve(page, one);
  await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
    if (lose) {
      await route.abort("connectionreset");
      return;
    }
    if (refuse) {
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "More than owed",
          details: { reason: "MORE_THAN_OWED", owed: "300.00" },
        },
      });
      return;
    }
    await route.fallback();
  });
  await opened(page, undefined, "8.0");
  const buzzes = (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { buzzes: string[] }).buzzes);

  await page.getByLabel("Сума внеску, грн").fill("400");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(page.locator(".paid-result")).toBeVisible();
  expect((await buzzes()).map((data) => JSON.parse(data) as object)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  refuse = true;
  await page.getByLabel("Сума внеску, грн").fill("300");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(page.getByRole("alert")).toContainText("Це більше, ніж винні");
  const twice = [
    { type: "notification", notification_type: "success" },
    { type: "notification", notification_type: "error" },
  ];
  expect((await buzzes()).map((data) => JSON.parse(data) as object)).toEqual(
    twice,
  );

  // A lost answer is not an answer; confirmed later, nothing either.
  refuse = false;
  lose = true;
  await page.getByLabel("Сума внеску, грн").fill("100");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(
    page.getByRole("heading", { name: "Внесок ще не підтверджено" }),
  ).toBeVisible();
  lose = false;
  await page
    .getByRole("button", { name: "Перевірити результат внеску" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Внесок записано один раз" }),
  ).toBeVisible();
  expect((await buzzes()).map((data) => JSON.parse(data) as object)).toEqual(
    twice,
  );
});

test("a debt of more goods than one names the first, and all of them on a tap", async ({
  page,
}) => {
  await serve(page, debt());
  await opened(page);
  await expect(page.getByRole("list", { name: "Товари боргу" })).toHaveCount(0);
  const more = page.getByRole("button", { name: "+ ще 1" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(
    page.getByRole("list", { name: "Товари боргу" }).getByRole("listitem"),
  ).toHaveText(["Лоран шоколад · M", "Альпака сіра · L"]);
  // The tapped «+ ще 1» is gone: focus is on what it opened.
  await expect(page.getByRole("list", { name: "Товари боргу" })).toBeFocused();
  await expect(page.getByRole("button", { name: "+ ще 1" })).toHaveCount(0);
});

test("more than is owed is said above the panel, in view, and nothing is sent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const sent = await serve(page, debt());
  await opened(page);
  await page.getByLabel("Сума внеску, грн").fill("5000");
  // Tapped where the thumb finds it with the page at its top, where the
  // refusal would come below the fold: it is brought into view.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const way = await panel(page)
    .getByRole("button", { name: "Переказ" })
    .boundingBox();
  if (!way) throw new Error("not laid out");
  await page.mouse.click(way.x + way.width / 2, way.y + way.height / 2);
  const told = page.getByRole("alert");
  await expect(told).toHaveText(
    "Це більше, ніж винні: залишок боргу 1 234,56 грн. Прийміть 1 234,56 грн, а решту поверніть покупцю переказом.",
  );
  await expect(told).toBeInViewport();
  const said = await told.boundingBox();
  const under = await panel(page).boundingBox();
  if (!said || !under) throw new Error("not laid out");
  expect(said.y + said.height).toBeLessThanOrEqual(under.y + 1);
  expect(sent).toHaveLength(0);
});

test("after a payment, the debt opened again keeps the panel's room: more than is owed is said above it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const sent = await serve(page, debt());
  await opened(page);
  await page.getByLabel("Сума внеску, грн").fill("100");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await page.getByLabel("Сума внеску, грн").fill("5000");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const way = await panel(page)
    .getByRole("button", { name: "Переказ" })
    .boundingBox();
  if (!way) throw new Error("not laid out");
  await page.mouse.click(way.x + way.width / 2, way.y + way.height / 2);
  const told = page.getByRole("alert");
  await expect(told).toContainText("Це більше, ніж винні");
  await expect(told).toBeInViewport();
  const said = await told.boundingBox();
  const under = await panel(page).boundingBox();
  if (!said || !under) throw new Error("not laid out");
  expect(said.y + said.height).toBeLessThanOrEqual(under.y + 1);
  expect(sent).toHaveLength(1);
});

test("the owner's write-off, at the end of a long history, says what was done where it is seen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const long = debt();
  const many = Array.from({ length: 12 }, (_, n) => ({
    kind: "PAYMENT",
    amount: "100.00",
    cash_back: "0.00",
    at: `${String(thisYear)}-10-${String(n + 2).padStart(2, "0")}T10:00:00Z`,
    by: "Оля",
    note: null,
    taken_at: null,
    payment_method: "CASH",
    corrected: false,
    outage: null,
  }));
  const one = { ...long, entries: [...(long.entries as object[]), ...many] };
  await serve(page, one);
  await page.route(`**/api/v1/credits/${one.id}/write-off`, async (route) => {
    await route.fulfill({
      json: {
        ...one,
        status: "WRITTEN_OFF",
        owed: "0.00",
        written_off: "1234.56",
        closed_at: `${String(thisYear)}-10-16T09:00:00Z`,
      },
    });
  });
  await opened(page);
  await page.getByRole("button", { name: "Списати борг" }).click();
  await page.getByLabel("Чому списуємо").fill("виїхала");
  await page.getByRole("button", { name: "Так, списати 1 234,56 грн" }).click();
  // Its result, in view: what was done, and the sum written off (P0-5).
  const done = page.locator(".paid-result");
  await expect(
    done.getByRole("heading", { name: "Борг списано" }),
  ).toBeInViewport();
  await expect(done.locator(".hand-back-sum")).toHaveText("1 234,56 грн");
  await expect(page.getByText("Борг списано: 1 234,56 грн.")).toBeAttached();
});

for (const [kind, status, said] of [
  [
    "payment",
    409,
    "Внесок не записано. Дані боргу змінилися, поки ви працювали: перевірте залишок і спробуйте ще раз.",
  ],
  ["payment", 422, "Внесок не записано. Перевірте суму й спробуйте ще раз."],
  [
    "write-off",
    409,
    "Списання не записано. Дані боргу змінилися, поки ви працювали: перевірте залишок і спробуйте ще раз.",
  ],
  [
    "write-off",
    422,
    "Списання не записано. Перевірте причину й спробуйте ще раз.",
  ],
] as const)
  test(`a ${kind} refused with nothing more than a ${String(status)} says what was not recorded in the debt's words, never an order's (P2-2)`, async ({
    page,
  }) => {
    const one = debt();
    await serve(page, one);
    await page.route(
      `**/api/v1/credits/${one.id}/${kind === "payment" ? "payments" : "write-off"}`,
      async (route) => {
        await route.fulfill({
          status,
          json: {
            code: status === 409 ? "CONFLICT" : "VALIDATION_ERROR",
            message: "Refused",
            details: {},
          },
        });
      },
    );
    await opened(page);
    if (kind === "payment") {
      await page.getByLabel("Сума внеску, грн").fill("100");
      await panel(page).getByRole("button", { name: "Готівка" }).click();
    } else {
      await page.getByRole("button", { name: "Списати борг" }).click();
      await page.getByLabel("Чому списуємо").fill("виїхала");
      await page
        .getByRole("button", { name: "Так, списати 1 234,56 грн" })
        .click();
    }
    await expect(page.getByRole("alert")).toHaveText(said);
    // «Замовлення»'s «+» aside: the debt never says it.
    await expect(page.locator(".debt-detail")).not.toContainText("замовлення");
  });

test("a closed debt says how it closed and when, and takes no payment", async ({
  page,
}) => {
  await serve(
    page,
    debt({
      status: "SETTLED",
      owed: "0.00",
      paid: "2500.00",
      closed_at: `${String(thisYear)}-10-14T09:00:00Z`,
    }),
  );
  await opened(page);
  const closed = page.locator(".debt-closed");
  await expect(closed.locator(".badge")).toHaveText("Сплачено");
  await expect(closed.locator(".badge")).toHaveClass("badge paid");
  await expect(closed).toContainText("Закрито 14.10");
  await expect(closed).toContainText("Сплачено 2 500,00 грн з 3 000,00 грн");
  await expect(page.getByRole("group", { name: "Скільки винні" })).toHaveCount(
    0,
  );
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel("Сума внеску, грн")).toHaveCount(0);
});

test("another store's debt says once where it was sold and who takes the payment", async ({
  page,
}) => {
  await serve(
    page,
    debt({
      store_id: randomUUID(),
      store_name: "Ринок",
      store_state: "BLOCKED",
    }),
  );
  await opened(page);
  await expect(
    page.getByText(
      "Продано в «Ринок» (заблоковано). Внесок приймаєте ви, борг — за «Ринок».",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/Ринок/)).toHaveCount(1);
});

/** The WCAG contrast of an element's text against what it is drawn on. */
async function contrast(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const rgb = (value: string): number[] =>
      (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]): number => {
      const channel = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel(r ?? 0) +
        0.7152 * channel(g ?? 0) +
        0.0722 * channel(b ?? 0)
      );
    };
    let ground: Element | null = node;
    let background = "rgba(0, 0, 0, 0)";
    while (ground) {
      background = getComputedStyle(ground).backgroundColor;
      const alpha = rgb(background)[3];
      if (alpha === undefined || alpha > 0) break;
      ground = ground.parentElement;
    }
    const fore = luminance(rgb(getComputedStyle(node).color));
    const back = luminance(rgb(background));
    return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
  });
}

/** The theme's accent for text, as the page resolves its token. */
async function accentText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent-text)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}

for (const [name, theme, scheme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
] as const)
  test(`in the ${name} theme a debt's sums, its phone, its history and the panel read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await serve(page, debt());
    await opened(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    await page.getByLabel("Сума внеску, грн").fill("400");
    for (const part of [
      page.locator(".owed-sum"),
      page.locator(".owed-count"),
      page.locator(".debt-context"),
      page.locator(".history-what").first(),
      page.locator(".history-meta").first(),
      page.locator(".history-sum").first(),
      panel(page).locator(".pay-total"),
      page.locator(".debt-context a"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // The phone to call in the theme's accent, never the browser's blue,
    // which would read at 4.5:1 too.
    await expect(page.locator(".debt-context a")).toHaveCSS(
      "color",
      await accentText(page),
    );
    await page.screenshot({ path: `test-results/credits-debt-${name}.png` });
  });

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme a debt's goods and a payment's result read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await serve(page, debt());
    await opened(page, theme);
    const more = page.locator(".more-goods");
    expect(await contrast(more)).toBeGreaterThanOrEqual(4.5);
    await more.click();
    expect(
      await contrast(page.locator(".debt-goods li").first()),
    ).toBeGreaterThanOrEqual(4.5);
    await page.getByLabel("Сума внеску, грн").fill("400");
    await panel(page).getByRole("button", { name: "Картка" }).click();
    const paid = page.locator(".paid-result");
    for (const part of [
      paid.getByRole("heading"),
      paid.locator(".way-pill"),
      paid.locator(".hand-back-sum .sum"),
      paid.getByText(/^Залишок боргу /),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/credits-paid-${name}.png` });
  });

test("a payment and a write-off sent: the pressed one turns its ring, the payment's other ways step back, past 3 s «Ще надсилаємо…» over them, and nothing kept is shown («Усе на бірці» task list, P0-2)", async ({
  page,
}) => {
  await page.clock.install();
  const one = debt();
  await serve(page, one);
  let answer: (() => void) | undefined;
  const held = new Promise<void>((done) => {
    answer = done;
  });
  await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
    const body = route.request().postDataJSON() as { amount: string };
    await held;
    await route.fulfill({
      status: 201,
      json: {
        ...one,
        paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
      },
    });
  });
  await opened(page);
  await page.getByLabel("Сума внеску, грн").fill("400");
  const card = panel(page).getByRole("button", { name: "Картка", exact: true });
  await card.click();
  await expect(card).toHaveClass(/\bpressed\b/);
  await expect(card.locator(".eyelet-spin")).toHaveCount(1);
  for (const way of ["Готівка", "Переказ"])
    await expect(
      panel(page).getByRole("button", { name: way, exact: true }),
    ).toHaveClass(/\bstepped-back\b/);
  await page.clock.runFor(2_900);
  await expect(page.getByText("Ще надсилаємо…")).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Ще надсилаємо…" }),
  ).toBeVisible();
  await expect(page.locator(".stub-kept, .banner-kept")).toHaveCount(0);
  answer?.();
  const paid = page.locator(".paid-result");
  await expect(
    paid.getByRole("heading", { name: "Внесок записано" }),
  ).toBeVisible();
  await expect(paid.locator(".stub")).toHaveClass(/\bstub-recorded\b/);
  await expect(page.locator(".eyelet-spin, .sending-line")).toHaveCount(0);

  // The write-off: its own button turns its ring.
  let written: (() => void) | undefined;
  const writing = new Promise<void>((done) => {
    written = done;
  });
  await page.route(`**/api/v1/credits/${one.id}/write-off`, async (route) => {
    await writing;
    await route.fulfill({
      json: { ...one, status: "WRITTEN_OFF", owed: "0.00" },
    });
  });
  await paid.getByRole("button", { name: "Відкрити борг" }).click();
  await page.getByRole("button", { name: "Списати борг" }).click();
  await page.getByLabel("Чому списуємо").fill("виїхала");
  const writeOff = page.getByRole("button", { name: /^Так, списати / });
  await writeOff.click();
  await expect(writeOff).toHaveClass(/\bpressed\b/);
  await expect(writeOff.locator(".eyelet-spin")).toHaveCount(1);
  await expect(page.locator(".stub-kept, .banner-kept")).toHaveCount(0);
  written?.();
  await expect(
    page.locator(".paid-result").getByRole("heading", { name: "Борг списано" }),
  ).toBeVisible();
  await expect(page.locator(".eyelet-spin")).toHaveCount(0);
});

test.describe("«Продаж» › «Внесок»: a payment on a debt from the till, its sum on the app's keypad («Усе на бірці» task list, P0-3; spec S08, S21, S22)", () => {
  /** «Продаж», its «Внесок» way, and the store's debtors under «Продаж». */
  async function atTheTill(
    page: Page,
    theme?: Record<string, string>,
  ): Promise<void> {
    await page.goto(launch(theme));
    await openStore(page, "Основний MAIN");
    await tillWays(page)
      .getByRole("button", { name: "Внесок", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 2 }),
    ).toBeVisible();
  }

  /** A key of the app's keypad: a digit, «Кома» or «Стерти». */
  function key(page: Page, name: string): Locator {
    return page
      .locator(".keypad")
      .getByRole("button", { name, exact: true });
  }

  async function keyIn(page: Page, keys: string): Promise<void> {
    for (const one of keys) await key(page, one === "," ? "Кома" : one).click();
  }

  /** A debt of one coat: 3 000, 1 000 paid, 2 000 owed. */
  function coat(extra: Record<string, unknown> = {}): Debt {
    return debt({
      goods: ["Лоран шоколад · M"],
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      owed: "2000.00",
      entries: [],
      ...extra,
    });
  }

  /** The customer as `GET /credits/customers` answers them, owing `owed`
   * the store in all. */
  function customerOf(one: Debt, owed: string): Record<string, unknown> {
    return {
      phone_digits: "0671234567",
      customer_name: one.customer_name,
      customer_phone: one.customer_phone,
      owed,
      open_debts: 1,
      credits: [one],
    };
  }

  test("three taps from the till — «Внесок», the row, a way: S21 names the goods, the menu steps aside, the sum is keyed in, and S22's stub says what the customer owes the store in all", async ({
    page,
  }) => {
    const one = coat();
    // The customer's other debt here: 1 000 more, so the store's total is
    // never this debt's own.
    let inAll = "3000.00";
    const sent = await serve(page, one, (body) => {
      inAll = "1500.00";
      return {
        ...one,
        paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
        owed: "500.00",
      };
    });
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      await route.fulfill({
        json: { items: [customerOf(one, inAll)], has_more: false },
      });
    });
    await atTheTill(page);
    await expect(
      tillWays(page).getByRole("button", { name: "Внесок", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page
      .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
      .click();

    // S21: what she took for a title, who and where under it; the menu out
    // of the way.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "Лоран шоколад · M",
    );
    await expect(page.locator(".debt-context")).toHaveText(
      "Оксана Петренко · «Основний» · з 01.10",
    );
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toHaveCount(0);
    const owed = page.getByRole("group", { name: "Скільки винні" });
    await expect(owed.locator(".owed-what")).toHaveText("Винні");
    await expect(owed.locator(".owed-what svg")).toHaveCount(1);
    await expect(owed.locator(".owed-sum")).toHaveText("2 000,00 грн");
    await expect(owed.locator(".owed-count")).toHaveText(
      "Сплачено 1 000,00 грн з 3 000,00 грн · останній внесок 12.10",
    );
    // No write-off nor erasing here: they are the debt's from «Клієнти».
    await expect(
      page.getByRole("button", { name: "Списати борг" }),
    ).toHaveCount(0);
    // The phone's keyboard never opens over the ways.
    const sum = page.getByLabel("Сума, грн");
    await expect(sum).toHaveAttribute("inputmode", "none");
    for (const way of ["Готівка", "Картка", "Переказ"])
      await expect(panel(page).getByRole("button", { name: way })).toBeDisabled();
    await keyIn(page, "1500");
    await expect(sum).toHaveValue(/^1\s500$/);
    await panel(page).getByRole("button", { name: "Готівка" }).click();

    // S22: the stub torn off, what is left on this debt, and on them all.
    const paid = page.locator(".paid-result");
    await expect(
      paid.getByRole("heading", { name: "Внесок записано" }),
    ).toBeFocused();
    await expectStub(paid, {
      way: "Готівка",
      say: "У касу",
      sum: "1 500,00 грн",
    });
    await expect(paid.locator(".stub")).toHaveClass(/\bstub-recorded\b/);
    await expect(
      paid.getByText("Залишок боргу 500,00 грн", { exact: true }),
    ).toBeVisible();
    await expect(paid.locator(".paid-total")).toHaveText(
      "Усього винні магазину «Основний» 1 500,00 грн",
    );
    // The task done, the menu is back.
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toBeVisible();
    expect(sent).toEqual([
      expect.objectContaining({ amount: "1500.00", payment_method: "CASH" }),
    ]);

    // «Відкрити борг»: S21 again, with what is left, the menu aside again.
    await page
      .getByRole("button", { name: "Відкрити борг", exact: true })
      .click();
    await expect(page.locator(".owed-sum")).toHaveText("500,00 грн");
    await expect(page.getByLabel("Сума, грн")).toHaveValue("");
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toHaveCount(0);
  });

  test("more than is owed darkens the ways and says so in the error's colour, and nothing is sent; the keypad keeps a sum to the kopeck", async ({
    page,
  }) => {
    const sent = await serve(page, coat());
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    const sum = page.getByLabel("Сума, грн");
    await keyIn(page, "2500");
    const over = page.getByRole("alert");
    await expect(over).toHaveText(
      "Це більше, ніж винні: залишок боргу 2 000,00 грн.",
    );
    await expect(over).toHaveCSS(
      "color",
      await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--danger)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }),
    );
    await expect(sum).toHaveAttribute("aria-invalid", "true");
    for (const way of ["Готівка", "Картка", "Переказ"])
      await expect(panel(page).getByRole("button", { name: way })).toBeDisabled();
    // One figure off: under the debt, the ways back, the line gone.
    await key(page, "Стерти").click();
    await expect(sum).toHaveValue("250");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: "Картка" }),
    ).toBeEnabled();
    // At most two figures after the comma; a leading zero dropped; a comma
    // first is «0,».
    await key(page, "Стерти").click();
    await key(page, "Стерти").click();
    await key(page, "Стерти").click();
    await keyIn(page, "05,505");
    await expect(sum).toHaveValue("5,50");
    // ⌫ held clears the sum.
    await key(page, "Стерти").hover();
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await expect(sum).toHaveValue("");
    // A touch held to its end often sends no click: a later press of
    // «Стерти», from a keyboard, still deletes (review, 2026-10-29).
    const erase = key(page, "Стерти");
    await erase.dispatchEvent("pointerdown");
    await page.waitForTimeout(800);
    await erase.dispatchEvent("pointerup");
    await expect(sum).toHaveValue("");
    await sum.pressSequentially("12");
    await page.waitForTimeout(600);
    await erase.focus();
    await page.keyboard.press("Enter");
    await expect(sum).toHaveValue("1");
    // What a key made of the sum is said: the key keeps the focus.
    await expect(page.locator(".keypad [aria-live]")).toHaveText(
      "Сума, грн: 1",
    );
    await erase.click();
    await keyIn(page, ",5");
    await expect(sum).toHaveValue("0,5");
    // The whole debt in one tap.
    await page
      .getByRole("button", { name: "Увесь залишок 2 000,00 грн" })
      .click();
    await expect(sum).toHaveValue(/^2\s000,00$/);
    // A computer's keyboard still types into the sum, in the keypad's
    // terms.
    await sum.fill("");
    await sum.pressSequentially("12a3,456");
    await expect(sum).toHaveValue("123,45");
    expect(sent).toHaveLength(0);
  });

  test("a debt lowered on another phone meanwhile: the server's refusal in the debt's words, and the debt read again", async ({
    page,
  }) => {
    const one = coat();
    await serve(page, one);
    const now = { ...one, paid: "2500.00", owed: "500.00" };
    await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "More than owed",
          details: { reason: "MORE_THAN_OWED", owed: "500.00" },
        },
      });
    });
    await page.route(`**/api/v1/credits/${one.id}`, async (route) => {
      await route.fulfill({ json: now });
    });
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await keyIn(page, "1000");
    await panel(page).getByRole("button", { name: "Картка" }).click();
    // The server's words alone, in view above the dock: the sum still
    // keyed in is over the debt read again, and said once.
    const told = page.getByRole("alert");
    await expect(told).toHaveText(
      "Це більше, ніж винні: залишок боргу 500,00 грн. Прийміть 500,00 грн, а решту поверніть покупцю на картку через термінал.",
    );
    await expect(told).toBeInViewport();
    await expect(page.locator(".owed-sum")).toHaveText("500,00 грн");
    await expect(page.locator(".paid-result")).toHaveCount(0);
    for (const way of ["Готівка", "Картка", "Переказ"])
      await expect(panel(page).getByRole("button", { name: way })).toBeDisabled();
    // The whole of what is left now: the refusal goes, and the ways are back.
    await page
      .getByRole("button", { name: "Увесь залишок 500,00 грн" })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: "Картка" }),
    ).toBeEnabled();
  });

  test("paid off in full, the stub is knotted and names no total the customer no longer owes", async ({
    page,
  }) => {
    const one = coat();
    let inAll = "2000.00";
    await serve(page, one, () => {
      inAll = "0.00";
      return {
        ...one,
        status: "SETTLED",
        paid: "3000.00",
        owed: "0.00",
        closed_at: `${String(thisYear)}-10-20T10:00:00Z`,
      };
    });
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      await route.fulfill({
        json: { items: [customerOf(one, inAll)], has_more: false },
      });
    });
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await page
      .getByRole("button", { name: "Увесь залишок 2 000,00 грн" })
      .click();
    await panel(page).getByRole("button", { name: "Переказ" }).click();
    const paid = page.locator(".paid-result");
    await expect(paid.locator(".stub")).toHaveClass(/\bstub-settled\b/);
    await expect(paid.locator(".stub > .eyelet")).toHaveClass(
      /\beyelet-knot\b/,
    );
    await expect(
      paid.getByText("Борг сплачено повністю.", { exact: true }),
    ).toBeVisible();
    // Read, and nothing owed: no line, and no place left for one.
    await expect(paid.locator(".paid-total")).toHaveCount(0);
  });

  test("a whole number that owes nothing here is asked of this person's other store: found, its row says «Внесок приймає «Другий»» and opens nothing; with no right there, the words as before", async ({
    page,
  }) => {
    const there = coat({
      store_id: fixture.second_store_id,
      store_name: "Другий",
    });
    const asked: string[] = [];
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      const url = new URL(route.request().url());
      const store = url.searchParams.get("store_id");
      if (url.searchParams.get("query")) asked.push(store ?? "");
      await route.fulfill({
        json: {
          items:
            store === fixture.second_store_id && url.searchParams.get("query")
              ? [customerOf(there, "2000.00")]
              : [],
          has_more: false,
        },
      });
    });
    await atTheTill(page);
    await page.getByLabel("Ім’я або телефон").fill("067 123 45 67");
    const row = page
      .getByRole("list", { name: "Хто винен" })
      .getByRole("listitem");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Оксана Петренко");
    await expect(row).toContainText("Внесок приймає «Другий»");
    await expect(row).toContainText("2 000,00 грн");
    await expect(row.getByRole("button")).toHaveCount(0);
    expect(asked).toContain(fixture.second_store_id);

    // This person no longer takes payments there: nothing asked of it.
    await page.route("**/api/v1/me", async (route) => {
      const response = await route.fetch();
      const me = (await response.json()) as {
        stores: { id: string; permissions: string[] }[];
      };
      await route.fulfill({
        response,
        json: {
          ...me,
          stores: me.stores.map((store) =>
            store.id === fixture.store_id
              ? store
              : {
                  ...store,
                  permissions: store.permissions.filter(
                    (permission) => permission !== "sale:credit",
                  ),
                },
          ),
        },
      });
    });
    asked.length = 0;
    await page.goto("about:blank");
    await atTheTill(page);
    await page.getByLabel("Ім’я або телефон").fill("067 123 45 67");
    await expect(
      page.getByText(
        "За цим номером у цьому магазині боргів немає. Внесок приймає магазин, де продали.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText(/Внесок приймає «/)).toHaveCount(0);
    expect(asked).not.toContain(fixture.second_store_id);
  });

  test("the till's «Внесок» and «Клієнти» are two screens: a stub left at the till is never «Клієнти»'s, nor a debt opened there the till's (review, 2026-10-29)", async ({
    page,
  }) => {
    await serve(page, coat());
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await keyIn(page, "500");
    await panel(page).getByRole("button", { name: "Картка" }).click();
    await expect(
      page.getByRole("heading", { name: "Внесок записано" }),
    ).toBeFocused();
    const menu = page.getByRole("navigation", { name: "Розділи" });
    await menu.getByRole("button", { name: "Клієнти", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Борги", level: 2 }),
    ).toBeVisible();
    await expect(page.locator(".paid-result")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Відкрити борг: / }),
    ).toBeVisible();

    // And back: a debt opened in «Клієнти», with its sum typed, stays there.
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await expect(panel(page)).toBeVisible();
    await page.getByLabel("Сума внеску, грн").fill("300");
    await menu.getByRole("button", { name: "Продаж", exact: true }).click();
    await tillWays(page)
      .getByRole("button", { name: "Внесок", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 2 }),
    ).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Відкрити борг: / }),
    ).toBeVisible();
  });

  test("a payment whose answer is lost is kept over «Продаж» › «Внесок», and after a reload the till opens there", async ({
    page,
  }) => {
    const one = coat();
    await serve(page, one);
    await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
      await route.abort("connectionfailed");
    });
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await keyIn(page, "700");
    await panel(page).getByRole("button", { name: "Готівка" }).click();
    const kept = page.locator(".stub-notice .stub-kept");
    await expect(
      kept.getByRole("heading", { name: "Внесок ще не підтверджено" }),
    ).toBeVisible();

    await page.goto("about:blank");
    await page.goto(launch());
    await openStore(page, "Основний MAIN");
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 2 }),
    ).toBeVisible();
    await expect(
      tillWays(page).getByRole("button", { name: "Внесок", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page
        .locator(".stub-notice .stub-kept")
        .getByRole("heading", { name: "Внесок ще не підтверджено" }),
    ).toBeVisible();
    await expect(page.locator("section.banner-kept")).toHaveCount(0);
  });

  for (const [name, theme, scheme] of [
    ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
    ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
  ] as const)
    test(`at 360 × 640 in the ${name} theme, S21's keypad and its three ways are in view without scrolling, and read at 4.5:1`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      await serve(page, coat());
      await atTheTill(page, theme);
      expect(
        await page.evaluate(() => document.documentElement.dataset.theme),
      ).toBe(scheme);
      await page.getByRole("button", { name: /^Відкрити борг: / }).click();
      await keyIn(page, "2500");
      for (const one of [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "Кома",
        "0",
        "Стерти",
      ])
        await expect(key(page, one)).toBeInViewport({ ratio: 1 });
      for (const way of ["Готівка", "Картка", "Переказ"])
        await expect(
          panel(page).getByRole("button", { name: way }),
        ).toBeInViewport({ ratio: 1 });
      await expect(page.getByLabel("Сума, грн")).toBeInViewport({ ratio: 1 });
      for (const part of [
        key(page, "5"),
        page.getByLabel("Сума, грн"),
        page.locator(".keypad-label"),
        page.getByRole("button", { name: /^Увесь залишок / }),
        page.getByRole("alert"),
      ])
        expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
      await key(page, "Стерти").click();
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      for (const part of [
        page.locator(".owed-sum"),
        page.locator(".owed-what"),
        page.locator(".debt-context"),
      ])
        expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `test-results/debt-till-${name}.png` });
    });
});
