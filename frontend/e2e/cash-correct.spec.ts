import {
  test,
  expect,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The owner's and managers' correction (cash task list, P2-4): the day as a
 * switch — «Сьогодні», «Вчора», each the drawer's day from 06:00, and
 * «Інший день» on a calendar — its operations a row each, the way under
 * the goods and the sum on the right, one that may not be changed saying
 * so; one chosen, the card of P1-3 with the line of the close it explains
 * under it, as the server names it. The drawer and the day's events are
 * stubbed.
 */

interface Fixture {
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
const owner = fixture.network_owner_telegram_user_id;

function launch(theme?: Record<string, string>): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${owner},"first_name":"Власник"}`,
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
  return `/#${hash.toString()}`;
}

/** The calendar day of a moment, by this machine's clock, which the phone
 * shares. */
function calendarDay(at: Date): string {
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** The drawer's day `days` back, at its noon: 06:00 to 06:00 (G8), by the
 * hour the clock shows, as the server counts it — six hours back would be
 * an hour off the nights the clocks change. */
function drawerDay(days: number): Date {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days - (now.getHours() < 6 ? 1 : 0),
    12,
  );
}

/** The drawer's day `days` back: 06:00 to 06:00 (G8). */
function dayOf(days: number): string {
  return calendarDay(drawerDay(days));
}

/** A moment of the drawer's day `days` back, at `time` (06:00 to 23:59). */
function momentOf(days: number, time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const at = drawerDay(days);
  at.setHours(hours, minutes, 0, 0);
  return at.toISOString();
}

/** «20.10» of a day. */
function short(day: string): string {
  const [, month = "", date = ""] = day.split("-");
  return `${date}.${month}`;
}

/** Yesterday's close: the close yesterday's operations fell in. */
const yesterdayClose = {
  id: randomUUID(),
  number: 7,
  business_day: dayOf(1),
  closed_at: momentOf(1, "21:00"),
  closed_by: "Оля",
  mine: false,
  store_id: store,
  store_name: "Каса",
  opening: false,
  since: momentOf(2, "21:00"),
  counted: "2000.00",
  expected: "2050.00",
  difference: "-50.00",
  card: { came_in: "0.00", went_out: "0.00", corrected: "0.00", net: "0.00" },
  transfer: {
    came_in: "0.00",
    went_out: "0.00",
    corrected: "0.00",
    net: "0.00",
  },
  unclosed_days: [],
  reason: null,
  reason_by: null,
  reason_required: true,
  opening_float: "1000.00",
  cash_in: "1050.00",
  cash_out: "0.00",
  taken_out: null,
  put_in: null,
  cash_corrected: null,
  prepaid_transfer: null,
  carrier_cod: null,
  not_stated: null,
  explained: "0.00",
  unexplained: "-50.00",
  explanations: [],
};

function event(over: Record<string, unknown>): Record<string, unknown> {
  return {
    target: "SALE",
    target_id: randomUUID(),
    at: momentOf(0, "10:05"),
    by: "Оля",
    amount: "700.00",
    direction: "IN",
    stated_method: "CARD",
    method: "CARD",
    corrected: false,
    closed: false,
    close_day: null,
    label: "Лоран шоколад · M",
    is_order: false,
    may_change: true,
    ...over,
  };
}

const today = [event({})];
const yesterday = [
  event({
    at: momentOf(1, "18:40"),
    label: "Пальто Ірис · L",
    closed: true,
    close_day: dayOf(1),
    corrected: true,
  }),
  event({
    target: "REFUND",
    at: momentOf(1, "12:15"),
    by: "Марко",
    amount: "500.00",
    direction: "OUT",
    method: "CASH",
    stated_method: "CASH",
    closed: true,
    close_day: dayOf(1),
    label: "Шарф · єдиний",
  }),
  // A collected order's longest way, long goods, and a Telegram name of
  // one long word.
  event({
    target: "PAYMENT",
    at: momentOf(1, "11:30"),
    by: "oleksandra_kravchuk_podilska",
    amount: "12500.00",
    method: "CARRIER_COD",
    stated_method: "CARRIER_COD",
    closed: true,
    close_day: dayOf(1),
    corrected: true,
    is_order: true,
    label: "Пальто подовжене вовняне Ірис · XL",
  }),
];
/** A day of long ago, whose close the phone has not read. */
const longAgo = [
  event({
    at: momentOf(20, "16:10"),
    label: "Светр Ліра · S",
    closed: true,
    close_day: dayOf(20),
  }),
];
/** A day before the drawer was first counted: nothing to explain. */
const beforeCash = [
  event({
    at: momentOf(40, "13:20"),
    label: "Сукня Мія · M",
    may_change: false,
  }),
];
const byDay: Record<string, Record<string, unknown>[]> = {
  [dayOf(0)]: today,
  [dayOf(1)]: yesterday,
  [dayOf(20)]: longAgo,
  [dayOf(40)]: beforeCash,
};

interface Server {
  days: string[];
  sent: Record<string, unknown>[];
}

async function stub(page: Page): Promise<Server> {
  const server: Server = { days: [], sent: [] };
  await page.route("**/api/v1/cash/drawer?**", async (route) => {
    await route.fulfill({
      json: {
        store_id: store,
        store_name: "Каса",
        store_state: "ACTIVE",
        last_close: {
          id: yesterdayClose.id,
          number: 7,
          business_day: yesterdayClose.business_day,
          closed_at: yesterdayClose.closed_at,
          closed_by: "Оля",
          mine: false,
        },
        next_is_opening: false,
        closed_today: false,
        may_close: true,
        movement_kinds: ["OWNER", "EXPENSES", "SUPPLIER_COURIER", "CHANGE"],
        may_correct: true,
        movements: [],
        unclosed_days: [],
        reason_owed: null,
      },
    });
  });
  await page.route("**/api/v1/cash/closes?**", async (route) => {
    await route.fulfill({ json: { items: [yesterdayClose], has_more: false } });
  });
  await page.route("**/api/v1/cash/events?**", async (route, request) => {
    const day = new URL(request.url()).searchParams.get("day") ?? "";
    server.days.push(day);
    await route.fulfill({
      json: { items: byDay[day] ?? [] },
    });
  });
  await page.route("**/api/v1/cash/corrections", async (route, request) => {
    const body = request.postDataJSON() as Record<string, unknown>;
    server.sent.push(body);
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        seq: 1,
        store_id: store,
        target: body.target,
        target_id: body.target_id,
        amount: "700.00",
        direction: "IN",
        from_method: body.from_method,
        to_method: body.to_method,
        explains_close_id: yesterdayClose.id,
        explains_day: yesterdayClose.business_day,
        at: new Date().toISOString(),
        by: "Власник",
        note: null,
      },
    });
  });
  return server;
}

async function countTaps(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const host = window as unknown as { taps: number };
    host.taps = 0;
    document.addEventListener(
      "click",
      (event) => {
        if ((event.target as Element).closest("button, label")) host.taps += 1;
      },
      true,
    );
  });
  return () =>
    page.evaluate(() => (window as unknown as { taps: number }).taps);
}

async function open(page: Page, theme?: Record<string, string>): Promise<void> {
  await page.goto("about:blank");
  await page.goto(launch(theme));
  await openStore(page, /^Каса CASH/);
}

async function correct(page: Page): Promise<void> {
  await section(page, "Каса");
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
}

function rows(page: Page): Locator {
  return page.getByRole("list", { name: "Операції дня" });
}

test("yesterday's operation is changed in seven taps, without a calendar — «Каса» under «Ще» for whoever reads the report, one more; its row says its close, and its card the close it explains (cash task list, P2-4; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const server = await stub(page);
  await open(page);
  const taps = await countTaps(page);
  await correct(page);
  const days = page.getByRole("group", { name: "Який день" });
  await expect(days.getByRole("radio", { name: "Сьогодні" })).toBeChecked();
  await expect(page.getByLabel("День", { exact: true })).toHaveCount(0);
  await days.getByRole("radio", { name: "Вчора" }).check();
  await expect.poll(() => server.days.at(-1)).toBe(dayOf(1));
  const first = rows(page).getByRole("button").first();
  await expect(first.locator(".cash-row-title")).toHaveText(
    /^Продаж · \d{2}:\d{2} · Оля$/,
  );
  await expect(first.locator(".sale-meta")).toHaveText(
    `Пальто Ірис · L · закриття ${short(yesterdayClose.business_day)}`,
  );
  await expect(first.locator(".history-sum")).toHaveText("700,00 грн");
  await expect(first.locator(".badge")).toHaveText("Картка · виправлено");
  // A closed refund may be changed by the owner as any other (B6.2).
  await expect(rows(page).getByRole("button").nth(1)).toBeEnabled();
  await first.click();
  // The closed day's line under the card, never a plate.
  await expect(page.locator(".fix-note")).toHaveText(
    `Пояснить різницю закриття ${short(yesterdayClose.business_day)}`,
  );
  await expect(page.locator(".notice")).toHaveCount(0);
  await page
    .getByRole("group", { name: "Новий спосіб оплати" })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  await expect(
    page.getByText(
      `Спосіб оплати змінено: Картка → Готівка. Пояснює різницю закриття ${short(yesterdayClose.business_day)}.`,
      { exact: true },
    ),
  ).toBeVisible();
  // What is sent is as before.
  expect(server.sent).toEqual([
    {
      command_id: expect.any(String) as string,
      target: "SALE",
      target_id: yesterday[0]?.target_id,
      from_method: "CARD",
      to_method: "CASH",
    },
  ]);
  expect(await taps()).toBe(7);
});

test("today's operation is changed in six taps — «Каса» under «Ще» for whoever reads the report, one more (cash task list, P2-4; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  const server = await stub(page);
  await open(page);
  const taps = await countTaps(page);
  await correct(page);
  await rows(page).getByRole("button").first().click();
  await page
    .getByRole("group", { name: "Новий спосіб оплати" })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  await expect(
    page.getByText(/^Спосіб оплати змінено: Картка → Готівка\./),
  ).toBeVisible();
  expect(server.days[0]).toBe(dayOf(0));
  expect(await taps()).toBe(6);
});

test("another day is chosen on the calendar: nothing is read until one is, and a day long ago names its own close (cash task list, P2-4)", async ({
  page,
}) => {
  const server = await stub(page);
  await open(page);
  await correct(page);
  await expect.poll(() => server.days.length).toBe(1);
  const days = page.getByRole("group", { name: "Який день" });
  await days.getByRole("radio", { name: "Вчора" }).check();
  await expect.poll(() => server.days.length).toBe(2);
  await expect(page.getByLabel("День", { exact: true })).toHaveCount(0);
  await days.getByRole("radio", { name: "Інший день" }).check();
  await expect(page.getByText("Оберіть день.")).toBeVisible();
  // Long enough for a read to be asked, were one.
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 500);
      }),
  );
  expect(server.days).toHaveLength(2);
  await page.getByLabel("День", { exact: true }).fill(dayOf(20));
  await expect.poll(() => server.days.at(-1)).toBe(dayOf(20));
  // The close it fell in, as the server names it: the phone has read only
  // yesterday's.
  const row = rows(page).getByRole("button");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".sale-meta")).toHaveText(
    `Светр Ліра · S · закриття ${short(dayOf(20))}`,
  );
  await row.click();
  await expect(page.locator(".fix-note")).toHaveText(
    `Пояснить різницю закриття ${short(dayOf(20))}`,
  );
});

test("a refusal is said over the day it was about, and goes with another day (cash task list, P2-4)", async ({
  page,
}) => {
  const server = await stub(page);
  await page.route("**/api/v1/cash/corrections", async (route) => {
    await route.fulfill({
      status: 409,
      json: { code: "CONFLICT", message: "Conflict", details: {} },
    });
  });
  await open(page);
  await correct(page);
  await page
    .getByRole("group", { name: "Який день" })
    .getByRole("radio", { name: "Інший день" })
    .check();
  await page.getByLabel("День", { exact: true }).fill(dayOf(20));
  await rows(page).getByRole("button").first().click();
  await page
    .getByRole("group", { name: "Новий спосіб оплати" })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  const refused = page.getByRole("alert");
  await expect(refused).toHaveText(
    "Не записано: дані каси змінилися, поки ви працювали. Спробуйте ще раз.",
  );
  // Over that day's list, read again.
  await expect(rows(page).getByRole("button")).toHaveCount(1);
  await page.getByLabel("День", { exact: true }).fill(dayOf(1));
  await expect.poll(() => server.days.at(-1)).toBe(dayOf(1));
  await expect(rows(page).getByRole("button")).toHaveCount(3);
  await expect(refused).toHaveCount(0);
});

test("an operation from before the drawer was first counted says it may not be changed, as readable as any (cash task list, P2-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stub(page);
  await open(page);
  await correct(page);
  await page
    .getByRole("group", { name: "Який день" })
    .getByRole("radio", { name: "Інший день" })
    .check();
  await page.getByLabel("День", { exact: true }).fill(dayOf(40));
  const row = rows(page).getByRole("button");
  await expect(row.locator(".sale-meta")).toHaveText(
    "Сукня Мія · M · змінити не можна",
  );
  await expect(row).toBeDisabled();
  // Not faded: why is to be read.
  expect(await row.evaluate((node) => getComputedStyle(node).opacity)).toBe(
    "1",
  );
  for (const part of [
    row.locator(".cash-row-title"),
    row.locator(".sale-meta"),
    row.locator(".history-sum"),
    row.locator(".badge"),
  ])
    expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
});

test("at 00:30 «Сьогодні» is the evening before's, as the drawer's day is (G8; cash task list, P2-4)", async ({
  page,
}) => {
  const night = new Date();
  night.setHours(0, 30, 0, 0);
  const before = (days: number): string => {
    const at = new Date(night);
    at.setDate(at.getDate() - days);
    return calendarDay(at);
  };
  await page.clock.setFixedTime(night);
  const server = await stub(page);
  await open(page);
  await correct(page);
  await expect.poll(() => server.days[0]).toBe(before(1));
  const days = page.getByRole("group", { name: "Який день" });
  await days.getByRole("radio", { name: "Вчора" }).check();
  await expect.poll(() => server.days.at(-1)).toBe(before(2));
  await days.getByRole("radio", { name: "Інший день" }).check();
  await expect(page.getByLabel("День", { exact: true })).toHaveAttribute(
    "max",
    before(1),
  );
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

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme the days and the day's operations read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await stub(page);
    await open(page, theme);
    await correct(page);
    await page
      .getByRole("group", { name: "Який день" })
      .getByRole("radio", { name: "Вчора" })
      .check();
    const first = rows(page).getByRole("button").first();
    await expect(first).toBeVisible();
    await expect(rows(page).getByRole("button")).toHaveCount(3);
    // Each row's sum beside what it is, the goods the row's whole width
    // under them, its way under the goods and inside the row, however long
    // the name, the goods or the way.
    for (const row of await rows(page).getByRole("button").all()) {
      const box = async (part: Locator) => {
        const found = await part.boundingBox();
        if (!found) throw new Error("not laid out");
        return found;
      };
      const main = await box(row.locator(".sale-main"));
      const title = await box(row.locator(".cash-row-title"));
      const sum = await box(row.locator(".history-sum"));
      const meta = await box(row.locator(".sale-meta"));
      const way = await box(row.locator(".badge"));
      expect(sum.x).toBeGreaterThanOrEqual(title.x + title.width);
      expect(sum.x + sum.width).toBeLessThanOrEqual(main.x + main.width + 0.5);
      expect(sum.height).toBeLessThan(30);
      expect(meta.y).toBeGreaterThanOrEqual(title.y + title.height);
      expect(meta.width).toBeGreaterThanOrEqual(main.width - 0.5);
      expect(way.y).toBeGreaterThanOrEqual(meta.y + meta.height);
      expect(way.x + way.width).toBeLessThanOrEqual(main.x + main.width + 0.5);
    }
    for (const part of [
      page.locator(".correct-days span").first(),
      first.locator(".cash-row-title"),
      first.locator(".sale-meta"),
      first.locator(".history-sum"),
      first.locator(".badge"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // Nothing wider than the phone.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/cash-correct-${name}.png`,
      fullPage: true,
    });
  });
