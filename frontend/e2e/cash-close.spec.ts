import {
  confirmClose,
  test,
  expect,
  menu,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Каса»'s close under the approved design (cash task list, P0-1..P0-3):
 * where the drawer stands in one line and the count as one large card; the
 * count on a screen of its own, «Закрити касу» under the thumb; the close's
 * three figures large, every one the server's. The drawer is stubbed, so
 * each state is the one each journey asks for.
 */

interface Fixture {
  network_cash_seller_telegram_user_id: string;
  network_owner_telegram_user_id: string;
  network_cash_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const store = fixture.network_cash_store_id;
const olya = fixture.network_cash_seller_telegram_user_id;
const owner = fixture.network_owner_telegram_user_id;

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

function launch(
  telegramUserId: string,
  options: { theme?: Record<string, string>; version?: string } = {},
): string {
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
  const hash = new URLSearchParams({ tgWebAppData: fields.toString() });
  if (options.theme)
    hash.set("tgWebAppThemeParams", JSON.stringify(options.theme));
  if (options.version) hash.set("tgWebAppVersion", options.version);
  return `/#${hash.toString()}`;
}

const lastClose = {
  id: "7b1c2d3e-0000-4000-8000-00000000c101",
  number: 3,
  business_day: "2026-10-20",
  closed_at: "2026-10-20T17:14:00Z",
  closed_by: "Олена",
  mine: false,
};

type Drawer = Record<string, unknown>;

function drawer(over: Drawer = {}): Drawer {
  return {
    store_id: store,
    store_name: "Каса",
    store_state: "ACTIVE",
    last_close: lastClose,
    next_is_opening: false,
    closed_today: false,
    may_close: true,
    movement_kinds: ["EXPENSES", "SUPPLIER_COURIER"],
    may_correct: false,
    movements: [],
    unclosed_days: [],
    reason_owed: null,
    ...over,
  };
}

const zero = {
  came_in: "0.00",
  went_out: "0.00",
  corrected: "0.00",
  net: "0.00",
};

function closeOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    number: 4,
    business_day: "2026-10-21",
    closed_at: new Date().toISOString(),
    closed_by: "Оля",
    mine: true,
    store_id: store,
    store_name: "Каса",
    opening: false,
    since: lastClose.closed_at,
    counted: "2000.00",
    expected: "2000.00",
    difference: "0.00",
    card: {
      came_in: "700.00",
      went_out: "0.00",
      corrected: "0.00",
      net: "700.00",
    },
    transfer: zero,
    unclosed_days: [],
    reason: null,
    reason_by: null,
    reason_required: false,
    opening_float: null,
    cash_in: null,
    cash_out: null,
    taken_out: null,
    put_in: null,
    cash_corrected: null,
    prepaid_transfer: null,
    carrier_cod: null,
    not_stated: null,
    explained: null,
    unexplained: null,
    explanations: [],
    ...over,
  };
}

/**
 * The drawer as the server would say it: `now` read on every GET, and a
 * close answered with `answer` — or refused, when it is a status. Returns
 * the closes sent and how many times the drawer was read.
 */
async function stubDrawer(
  page: Page,
  state: {
    now: Drawer;
    answer: Record<string, unknown> | number;
    /** The server out of reach for the drawer's reads. */
    lost?: boolean;
  },
): Promise<{ closes: Request[]; reads: () => number }> {
  const closes: Request[] = [];
  let reads = 0;
  await page.route("**/api/v1/cash/drawer?**", async (route) => {
    reads += 1;
    if (state.lost) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ json: state.now });
  });
  await page.route("**/api/v1/cash/closes?**", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({ json: { items: [], has_more: false } });
      return;
    }
    closes.push(request);
    if (typeof state.answer === "number") {
      await route.fulfill({
        status: state.answer,
        json: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          details: {
            reason: "ALREADY_CLOSED_TODAY",
            recorded: false,
            closed_at: new Date().toISOString(),
            closed_by: "Олена",
          },
        },
      });
      return;
    }
    const answered = state.answer;
    // Read again after the close: closed today, by this person.
    state.now = drawer({
      last_close: { ...lastClose, ...answered, mine: true },
      closed_today: true,
      reason_owed:
        answered.reason_required === true && answered.reason === null
          ? answered
          : null,
    });
    await route.fulfill({ status: 201, json: answered });
  });
  await page.route("**/api/v1/cash/closes/*", async (route) => {
    await route.fulfill({
      json: typeof state.answer === "number" ? {} : state.answer,
    });
  });
  return { closes, reads: () => reads };
}

async function cash(
  page: Page,
  who = olya,
  options: { theme?: Record<string, string>; version?: string } = {},
): Promise<void> {
  await page.goto("about:blank");
  await page.goto(launch(who, options));
  await openStore(page, /^Каса CASH/);
  await section(page, "Каса");
  await expect(
    page.getByRole("heading", { name: "Каса", exact: true }),
  ).toBeVisible();
}

function card(page: Page): Locator {
  return page.getByRole("button", { name: "Закрити касу", exact: true });
}

function field(page: Page): Locator {
  return page.getByLabel("Скільки готівки в касі зараз");
}

test("«Каса» says where the drawer stands in one line, the count as one large card, and the other tasks as rows — nothing to read before the count", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stubDrawer(page, { now: drawer(), answer: closeOf() });
  await cash(page);
  await expect(page.locator(".cash-context")).toHaveText(
    /^Каса відкрита · останнє закриття 20\.10, \d{2}:\d{2} · Олена$/,
  );
  await expect(card(page)).toHaveAccessibleDescription(
    "Скільки мало бути — покажемо після підрахунку",
  );
  // The seller's rows: cash out, and the way of their own operations.
  const rows = page.locator(".cash-row");
  await expect(rows).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Видати з каси", exact: true }),
  ).toHaveAccessibleDescription("Витрати, кур’єру постачальника");
  await expect(
    page.getByRole("button", { name: "Змінити спосіб оплати", exact: true }),
  ).toHaveAccessibleDescription("Ваші операції до закриття");
  for (const gone of ["Внести в касу", "Закриття", "Оновити"])
    await expect(
      page.getByRole("button", { name: gone, exact: true }),
    ).toHaveCount(0);
  // Above the first row only the heading, the line and the card: the
  // reminders are on the count's screen (owner decision, 2026-10-21, В1 (а)).
  for (const reminder of [
    /Поки рахуєте/,
    /Перед підрахунком/,
    /Якщо сервер не відповідав/,
    /на іншому телефоні/,
  ])
    await expect(page.getByText(reminder)).toHaveCount(0);
  const above = await page.locator("section.cash").evaluate((section) => {
    const first = section.querySelector(".cash-row");
    if (!first) return [];
    const top = first.getBoundingClientRect().top;
    return [...section.children]
      .filter((child) => child.getBoundingClientRect().bottom <= top + 1)
      .map((child) => child.tagName.toLowerCase() + "." + child.className);
  });
  expect(above).toEqual(["h2.", "p.cash-context", "button.cash-card"]);
  // Blind: no sum is said before the count (G32).
  await expect(page.getByText(/Мало бути|грн/)).toHaveCount(0);
});

test("the count: the card reads the drawer again, the cursor is in the field, an empty or unreadable sum sends nothing, and «Скасувати» keeps the sum", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const state = { now: drawer(), answer: closeOf() };
  const server = await stubDrawer(page, state);
  await cash(page);
  // «Каса»'s own read come: only the card's is counted after it.
  await expect(card(page)).toBeVisible();
  // A close made meanwhile elsewhere: the card's read names it.
  const newer = { ...lastClose, id: randomUUID(), number: 4 };
  state.now = drawer({ last_close: newer });
  const before = server.reads();
  await card(page).click();
  await expect.poll(server.reads).toBeGreaterThan(before);
  await expect(
    page.getByRole("heading", { name: "Підрахунок каси" }),
  ).toBeVisible();
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveAttribute("inputmode", "decimal");
  await expect(field(page)).toHaveAttribute("enterkeyhint", "done");
  // The reminders the owner kept, here (В1 (а)).
  for (const text of [
    "Спершу запишіть видане з каси ›",
    "Поки рахуєте, не продавайте.",
    "Спершу внесіть усе з паперу й перевірте, чи нічого не чекає на інших телефонах.",
  ])
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  const close = page.getByRole("button", { name: "Закрити касу", exact: true });
  const panel = page.locator(".pay-panel");
  // At 360×640, without the keyboard: the field, the reminders and the
  // panel together, nothing under the panel.
  const reminder = await page
    .getByText(
      "Спершу внесіть усе з паперу й перевірте, чи нічого не чекає на інших телефонах.",
    )
    .boundingBox();
  const room = await panel.boundingBox();
  const sum = await field(page).boundingBox();
  if (!reminder || !room || !sum) throw new Error("not laid out");
  expect(sum.y).toBeGreaterThanOrEqual(0);
  expect(reminder.y + reminder.height).toBeLessThanOrEqual(room.y);
  expect(room.y + room.height).toBeLessThanOrEqual(640);
  await expect(panel).toContainText("Впишіть суму");
  await expect(close).toBeDisabled();
  await field(page).fill("2000,555");
  await expect(
    page.getByText("Вкажіть суму з точністю до копійок."),
  ).toBeVisible();
  await expect(close).toBeDisabled();
  // A separator just typed is a sum still being typed, never wrong.
  await field(page).fill("2000,");
  await expect(
    page.getByText("Вкажіть суму з точністю до копійок."),
  ).toHaveCount(0);
  await expect(panel.locator(".pay-total")).toHaveText("У касі 2 000,00 грн");
  // An empty drawer is a sum.
  await field(page).fill("0");
  await expect(panel.locator(".pay-total")).toHaveText("У касі 0,00 грн");
  await expect(close).toBeEnabled();
  await field(page).fill("2000");
  await expect(panel.locator(".pay-total")).toHaveText("У касі 2 000,00 грн");
  await close.click();
  // The sum confirmed as large as it was typed; the focus on «Так».
  await expect(panel.locator(".pay-total")).toHaveText(
    "Закрити касу: у касі 2 000,00 грн?",
  );
  await expect(panel.locator(".pay-what")).toHaveText(
    "Змінити потім не можна.",
  );
  await expect(
    page.getByRole("button", { name: "Так, закрити" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Скасувати" }).click();
  await expect(field(page)).toHaveValue("2000");
  await expect(close).toBeFocused();
  expect(server.closes).toHaveLength(0);
  // Under the thumb: the panel's button at the bottom of the screen, the
  // dock standing on the menu («Усе на бірці» task list, P0-4).
  const box = await close.boundingBox();
  const bar = await menu(page).boundingBox();
  if (!box || !bar) throw new Error("not laid out");
  expect(bar.y + bar.height).toBeCloseTo(640, 0);
  expect(box.y + box.height).toBeGreaterThan(bar.y - 120);
  expect(box.height).toBeGreaterThanOrEqual(54);
  await close.click();
  await confirmClose(page);
  await expect.poll(() => server.closes.length).toBe(1);
  const sent = server.closes[0]?.postDataJSON() as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual([
    "after_close_id",
    "command_id",
    "counted",
    "counted_at",
    "store_id",
  ]);
  expect(sent).toMatchObject({ counted: "2000.00", after_close_id: newer.id });
  expect(server.closes[0]?.url()).toMatch(/\?age=\d+$/);
});

test("cash taken out is recorded from the count, and the count comes back with its sum", async ({
  page,
}) => {
  const state = { now: drawer(), answer: closeOf() };
  await stubDrawer(page, state);
  await page.route("**/api/v1/cash/movements", async (route, request) => {
    const body = request.postDataJSON() as Record<string, string>;
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: store,
        kind: body.kind,
        direction: "OUT",
        amount: body.amount,
        note: body.note ?? null,
        at: new Date().toISOString(),
        by: "Оля",
        for_close_id: null,
        for_day: null,
        moved_to_close: false,
      },
    });
  });
  await cash(page);
  await card(page).click();
  await field(page).fill("1850");
  await page
    .getByRole("button", { name: "Спершу запишіть видане з каси", exact: true })
    .click();
  // Back from here is back to the count.
  await expect(
    page.getByRole("button", { name: "Назад до підрахунку" }),
  ).toHaveText("← Підрахунок");
  await page
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await page.getByLabel("Сума", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Видати 150,00 грн" }).click();
  await expect(
    page.getByRole("heading", { name: "Підрахунок каси" }),
  ).toBeVisible();
  await expect(page.getByText("Записано: Витрати, 150,00 грн.")).toBeVisible();
  await expect(field(page)).toHaveValue("1850");
  // Left for «Каса», the sum is not kept: a count is of its moment (G31).
  await page.getByRole("button", { name: "Назад до каси" }).click();
  await card(page).click();
  await expect(field(page)).toHaveValue("");
});

test("the close's figures are the server's: «Мало бути» and «Порахували» large, a shortage or a surplus a warning, to the kopeck the accent", async ({
  page,
}) => {
  const state: { now: Drawer; answer: Record<string, unknown> | number } = {
    now: drawer(),
    // Not what the phone could sum: what the server says.
    answer: closeOf({
      counted: "2000.00",
      expected: "1999.50",
      difference: "0.50",
      card: {
        came_in: "700.00",
        went_out: "100.00",
        corrected: "0.00",
        net: "600.00",
      },
    }),
  };
  await stubDrawer(page, state);
  await cash(page);
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  await expect(
    page.getByRole("heading", { name: "Касу закрито" }),
  ).toBeFocused();
  const figures = page.getByRole("group", { name: "Закриття каси" });
  await expect(figures.locator(".cash-sum")).toHaveText([
    "1 999,50 грн",
    "2 000,00 грн",
  ]);
  // Which close: its day.
  await expect(page.locator(".cash-closed .cash-context")).toHaveText(
    "Закриття 21.10",
  );
  // A seller's close holds none of the period's figures (G27).
  await expect(page.getByLabel("Готівка за період")).toHaveCount(0);
  const difference = figures.locator(".cash-difference");
  await expect(difference).toHaveText("Надлишок 0,50 грн");
  await expect(difference).toHaveClass(/\bwarn\b/);
  const slip = page
    .getByRole("list", { name: "Картка й переказ" })
    .getByRole("listitem");
  await expect(slip.first().locator(".history-meta")).toHaveText(
    "оплати 700,00 грн · повернення 100,00 грн · звірте з чеком терміналу",
  );
  await expect(slip.first().locator(".history-sum")).toHaveText("600,00 грн");
  // No reason owed: «Готово», and the day's close compact on «Каса».
  await expect(
    page.getByLabel("Чому не збігається? (обов’язково)"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Готово" }).click();
  await expect(page.locator(".cash-context")).toHaveText(
    /^Сьогодні закрито о \d{2}:\d{2} · Оля$/,
  );
  await expect(
    page.getByRole("group", { name: "Закриття каси" }),
  ).toContainText(
    "Мало бути 1 999,50 грн · Порахували 2 000,00 грн · Надлишок 0,50 грн",
  );
  await expect(card(page)).toHaveCount(0);
});

test("to the kopeck is the accent's, and the first count is one figure", async ({
  page,
}) => {
  const state: { now: Drawer; answer: Record<string, unknown> | number } = {
    now: drawer(),
    answer: closeOf(),
  };
  await stubDrawer(page, state);
  await cash(page);
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  const difference = page
    .getByRole("group", { name: "Закриття каси" })
    .locator(".cash-difference");
  await expect(difference).toHaveText("Збіглося до копійки");
  await expect(difference).toHaveClass(/\bmatch\b/);

  // Never counted: «Перший підрахунок», one figure.
  state.now = drawer({ last_close: null, next_is_opening: true });
  state.answer = closeOf({
    opening: true,
    expected: null,
    difference: null,
    counted: "320.00",
  });
  await cash(page);
  await expect(page.locator(".cash-context")).toHaveText(
    "Каса ще не рахувалась",
  );
  await expect(
    page.getByRole("button", { name: "Перший підрахунок", exact: true }),
  ).toHaveAccessibleDescription("Запишемо, скільки в касі зараз");
  await page
    .getByRole("button", { name: "Перший підрахунок", exact: true })
    .click();
  await field(page).fill("320");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  await expect(
    page.getByRole("heading", { name: "Перший підрахунок записано" }),
  ).toBeVisible();
  const first = page.getByRole("group", { name: "Підрахунок" });
  await expect(first.locator(".cash-sum")).toHaveText("320,00 грн");
  await expect(first).toContainText("З цієї суми почнемо наступного разу.");
  await expect(page.getByText("Мало бути")).toHaveCount(0);
});

test("a difference owes its reason under the thumb, the figures read first, and «Готово» once it is written", async ({
  page,
}) => {
  const owed = closeOf({
    expected: "2050.00",
    difference: "-50.00",
    reason_required: true,
  });
  const state: { now: Drawer; answer: Record<string, unknown> | number } = {
    now: drawer(),
    answer: owed,
  };
  await stubDrawer(page, state);
  await page.route("**/api/v1/cash/closes/*/reason", async (route, request) => {
    const { reason } = request.postDataJSON() as { reason: string };
    const written = { ...owed, reason, reason_by: "Оля" };
    state.answer = written;
    state.now = drawer({
      last_close: { ...lastClose, ...written, mine: true },
      closed_today: true,
    });
    await route.fulfill({ json: written });
  });
  await cash(page);
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  const difference = page
    .getByRole("group", { name: "Закриття каси" })
    .locator(".cash-difference");
  await expect(difference).toHaveText("Нестача 50,00 грн");
  await expect(difference).toHaveClass(/\bwarn\b/);
  const reason = page.getByLabel("Чому не збігається? (обов’язково)");
  // The figures are read first: the cursor is not put in the field.
  await expect(reason).not.toBeFocused();
  const write = page.getByRole("button", { name: "Записати причину" });
  await expect(write).toBeDisabled();
  await expect(page.locator(".pay-panel")).toContainText(
    "Поки причину не записано, інші розділи недоступні.",
  );
  await expect(page.getByRole("button", { name: "Готово" })).toHaveCount(0);
  // Owed, it holds the other tabs, never «Каса»'s own tasks (G12): back to
  // «Каса», its rows there, the close waiting for its reason.
  await page.getByRole("button", { name: "Назад до каси" }).click();
  await expect(
    page.getByRole("button", { name: "Видати з каси", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("group", { name: "Закриття каси" }),
  ).toContainText("Нестача 50,00 грн");
  await page.getByRole("button", { name: "Записати причину" }).click();
  await expect(reason).toBeVisible();
  await page.getByRole("button", { name: "Продаж під час збою" }).click();
  await expect(reason).toHaveValue("Продаж під час збою");
  await write.click();
  await expect(
    page.getByText("Причину записано. Власник отримає повідомлення."),
  ).toBeVisible();
  await expect(page.locator(".cash-reason")).toHaveText(
    "Причина: «Продаж під час збою» · Оля",
  );
  await expect(reason).toHaveCount(0);
  await page.getByRole("button", { name: "Готово" }).click();
  await expect(page.locator(".cash-context")).toHaveText(
    /^Сьогодні закрито о \d{2}:\d{2} · Оля$/,
  );
});

test("Telegram buzzes once when the close is recorded and once when it is refused, never for a close kept and confirmed later", async ({
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
  const buzzes = (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { buzzes: string[] }).buzzes);
  const state: { now: Drawer; answer: Record<string, unknown> | number } = {
    now: drawer(),
    answer: 422,
  };
  await stubDrawer(page, state);
  await cash(page, olya, { version: "6.1" });
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  // Refused at its press: why, over the panel; the sum still there.
  await expect(page.getByRole("alert")).toHaveText(
    /^Касу сьогодні вже закрито о \d{2}:\d{2} · Олена\. Наступне закриття — завтра\.$/,
  );
  await expect(field(page)).toHaveValue("2000");
  expect((await buzzes()).map((data) => JSON.parse(data) as object)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  state.answer = closeOf();
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  await expect(
    page.getByRole("heading", { name: "Касу закрито" }),
  ).toBeVisible();
  expect((await buzzes()).map((data) => JSON.parse(data) as object)).toEqual([
    { type: "notification", notification_type: "error" },
    { type: "notification", notification_type: "success" },
  ]);
});

/** The WCAG relative luminance of a computed `rgb(…)` colour. */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).map(Number);
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

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

for (const [name, theme, scheme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
] as const)
  test(`in the ${name} theme the card, the count and the close's figures read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const state: { now: Drawer; answer: Record<string, unknown> | number } = {
      now: drawer({
        movements: [
          {
            id: randomUUID(),
            store_id: store,
            kind: "EXPENSES",
            direction: "OUT",
            amount: "150.00",
            note: "пакети",
            at: new Date().toISOString(),
            by: "Оля",
            for_close_id: null,
            for_day: null,
            moved_to_close: false,
          },
        ],
      }),
      answer: closeOf({
        expected: "2050.00",
        difference: "-50.00",
      }),
    };
    await stubDrawer(page, state);
    await cash(page, olya, { theme });
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    for (const part of [
      page.locator(".cash-card-title"),
      page.locator(".cash-card-hint"),
      page.locator(".cash-context"),
      page.locator(".cash-row-title").first(),
      page.locator(".cash-row .sale-meta").first(),
      page.locator(".history-what").first(),
      page.locator(".history-sum").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // The card stays dark in either theme, its own edge setting it off the
    // dark background (owner decision, 2026-10-21).
    const look = await card(page).evaluate((node) => {
      const style = getComputedStyle(node);
      // What the edge's token paints, read as the card's edge is.
      const probe = document.createElement("div");
      probe.style.borderTop = "1px solid var(--dark-card-line)";
      document.body.append(probe);
      const own = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return {
        card: style.backgroundColor,
        edge: style.borderTopColor,
        own,
        width: style.borderTopWidth,
        page: getComputedStyle(document.documentElement).backgroundColor,
      };
    });
    expect(luminance(look.card)).toBeLessThan(0.05);
    expect(look.width).toBe("1px");
    expect(look.edge).toBe(look.own);
    if (scheme === "dark") {
      expect(look.edge).not.toBe(look.card);
      expect(look.card).not.toBe(look.page);
    }
    await page.screenshot({ path: `test-results/cash-main-${name}.png` });
    await card(page).click();
    await field(page).fill("2000");
    for (const part of [field(page), page.locator(".pay-total")])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-count-${name}.png` });
    await page
      .getByRole("button", { name: "Закрити касу", exact: true })
      .click();
    await confirmClose(page);
    const figures = page.getByRole("group", { name: "Закриття каси" });
    for (const part of [
      figures.locator(".cash-sum").first(),
      figures.locator(".owed-what").first(),
      figures.locator(".cash-difference"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-closed-${name}.png` });
  });

test("the owner's «Каса»: every task as a row, «Закриття» among them", async ({
  page,
}) => {
  await stubDrawer(page, {
    now: drawer({
      movement_kinds: ["OWNER", "EXPENSES", "SUPPLIER_COURIER", "CHANGE"],
      may_correct: true,
      movements: [
        {
          id: randomUUID(),
          store_id: store,
          kind: "CHANGE",
          direction: "IN",
          amount: "100.00",
          note: null,
          at: "2026-10-20T08:05:00Z",
          by: "Марко",
          for_close_id: null,
          for_day: null,
          moved_to_close: false,
        },
      ],
    }),
    answer: closeOf(),
  });
  await cash(page, owner);
  await expect(
    page.getByRole("button", { name: "Видати з каси", exact: true }),
  ).toHaveAccessibleDescription("Власнику, на витрати, кур’єру");
  await expect(
    page.getByRole("button", { name: "Внести в касу", exact: true }),
  ).toHaveAccessibleDescription("Розмін");
  await expect(
    page.getByRole("button", { name: "Змінити спосіб оплати", exact: true }),
  ).toHaveAccessibleDescription("Будь-яка операція, будь-який день");
  await expect(
    page.getByRole("button", { name: "Закриття", exact: true }),
  ).toHaveAccessibleDescription("Усі закриття й різниці");
  // Put in, an earlier day: its date, «+».
  const row = page
    .getByRole("list", { name: "Видано й внесено" })
    .getByRole("listitem");
  await expect(row.locator(".history-what")).toHaveText("Внесено · розмін");
  await expect(row.locator(".history-meta")).toHaveText(
    /^20\.10, \d{2}:\d{2} · Марко$/,
  );
  await expect(row.locator(".history-sum")).toHaveText("+100,00 грн");
});

test("the count is four taps and the sum: «Каса», the card, «Закрити касу», «Так, закрити»", async ({
  page,
}) => {
  const state = { now: drawer(), answer: closeOf() };
  const server = await stubDrawer(page, state);
  await page.goto("about:blank");
  await page.goto(launch(olya));
  await openStore(page, /^Каса CASH/);
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
  await section(page, "Каса");
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  await expect.poll(() => server.closes.length).toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as { taps: number }).taps),
  ).toBe(4);
});

test("a double tap on «Закрити касу» never closes the drawer: its second half on «Так, закрити» is let go; pressed once the sum is read, it closes («Усе на бірці» sections task list, P1-2)", async ({
  page,
}) => {
  const state = { now: drawer(), answer: closeOf() };
  const server = await stubDrawer(page, state);
  await cash(page);
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  // The second half lands on «Так, закрити»: where «Закрити касу» stood
  // when the question fits one line, lower when a wider font wraps it.
  const box = await page
    .getByRole("button", { name: "Так, закрити" })
    .boundingBox();
  if (!box) throw new Error("not laid out");
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 100);
      }),
  );
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 300);
      }),
  );
  expect(server.closes).toHaveLength(0);
  await expect(page.locator(".pay-panel .pay-total")).toHaveText(
    "Закрити касу: у касі 2 000,00 грн?",
  );
  // Pressed as meant, once the sum is read: taken, once.
  await confirmClose(page);
  await expect(
    page.getByRole("heading", { name: "Касу закрито" }),
  ).toBeVisible();
  expect(server.closes).toHaveLength(1);
});

test("Enter held on «Закрити касу» never closes the drawer: its repeats on «Так, закрити» are let go; pressed afresh, it closes («Усе на бірці» sections task list, P1-2)", async ({
  page,
}) => {
  const state = { now: drawer(), answer: closeOf() };
  const server = await stubDrawer(page, state);
  await cash(page);
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).focus();
  await page.keyboard.down("Enter");
  await expect(
    page.getByRole("button", { name: "Так, закрити" }),
  ).toBeFocused();
  // Held past 0.7 s: the key repeats onto «Так, закрити».
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 800);
      }),
  );
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 300);
      }),
  );
  expect(server.closes).toHaveLength(0);
  await page.keyboard.up("Enter");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Касу закрито" }),
  ).toBeVisible();
  expect(server.closes).toHaveLength(1);
});

test("with the server out of reach, the card never opens the count: «Каса» says to count for yourself and close later (G26)", async ({
  page,
}) => {
  const state: {
    now: Drawer;
    answer: Record<string, unknown> | number;
    lost?: boolean;
  } = { now: drawer(), answer: closeOf() };
  const server = await stubDrawer(page, state);
  await cash(page);
  await expect(card(page)).toBeVisible();
  state.lost = true;
  await card(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Касу зараз не закрити: сервер не відповідає.",
  );
  await expect(
    page.getByRole("heading", { name: "Підрахунок каси" }),
  ).toHaveCount(0);
  expect(server.closes).toHaveLength(0);
});

test("a close kept on the phone and confirmed later shows its result, with no buzz", async ({
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
  const state = { now: drawer(), answer: closeOf() };
  const server = await stubDrawer(page, state);
  // Where this person's drawer commands are kept on the phone.
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(olya) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const me = (await (
    await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    })
  ).json()) as { organization_id: string; user_id: string };
  const key = `birka:cash-pending:${me.organization_id}:${me.user_id}:${store}`;
  await page.goto("/");
  await page.evaluate(
    ([name, saved]) => {
      localStorage.setItem(name, saved);
    },
    [
      key,
      JSON.stringify({
        key: randomUUID(),
        ambiguous: true,
        body: {
          command: "close",
          store_id: store,
          command_id: randomUUID(),
          counted: "2000.00",
          counted_at: new Date().toISOString(),
          after_close_id: lastClose.id,
        },
      }),
    ] as const,
  );
  await page.goto("about:blank");
  await page.goto(launch(olya, { version: "6.1" }));
  await openStore(page, /^Каса CASH/);
  await expect.poll(() => server.closes.length).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Касу закрито" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { buzzes: string[] }).buzzes,
    ),
  ).toEqual([]);
});

test("the owner's close holds the period's figures (G27)", async ({ page }) => {
  await stubDrawer(page, {
    now: drawer({
      movement_kinds: ["OWNER", "EXPENSES", "SUPPLIER_COURIER", "CHANGE"],
      may_correct: true,
    }),
    answer: closeOf({
      opening_float: "1000.00",
      cash_in: "500.00",
      cash_out: "0.00",
      taken_out: "150.00",
      put_in: "100.00",
      cash_corrected: "0.00",
    }),
  });
  await cash(page, owner);
  await card(page).click();
  await field(page).fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  await confirmClose(page);
  const period = page.getByLabel("Готівка за період");
  await expect(period).toContainText("Готівкою отримано");
  await expect(period).toContainText("500,00 грн");
});
