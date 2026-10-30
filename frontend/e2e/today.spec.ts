import { test, expect, menu, openStore } from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Сьогодні» («Усе на бірці» task list, P0-6, part 1; spec S04–S05): the
 * first tab for whoever reads the report, the day-tag of every store they
 * read it in — the total, the money's line, a column a store with its
 * drawer and its debts, the parcels' line — every figure a field the
 * server answered. The reads are stubbed; the people and stores are the
 * seed's «Центр» and «Ринок».
 */

interface Fixture {
  network_owner_telegram_user_id: string;
  network_centre_manager_telegram_user_id: string;
  network_centre_cashier_telegram_user_id: string;
  network_centre_store_id: string;
  network_market_store_id: string;
  network_old_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

const centre = fixture.network_centre_store_id;
const market = fixture.network_market_store_id;

function launch(who: string, name: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${who},"first_name":"${name}"}`,
  });
  const check = [...fields]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

const owner = (): string =>
  launch(fixture.network_owner_telegram_user_id, "Власник");

// --- the reads, stubbed -----------------------------------------------------

interface Day {
  sold: string;
  units: number;
  returned_units?: number;
  money?: string;
  cod?: string;
  prepaid?: string;
}

function figures(day: Day): Record<string, unknown> {
  const way = (net: string): Record<string, string> => ({
    came_in: net,
    corrected: "0.00",
    net,
  });
  return {
    sales: day.units,
    units: day.units,
    sold: day.sold,
    returns: day.returned_units ? 1 : 0,
    returned_units: day.returned_units ?? 0,
    returned: day.returned_units ? "1850.00" : "0.00",
    net: day.sold,
    paid_in_full: day.money ?? day.sold,
    debt_payments: "0.00",
    paid_back: "0.00",
    corrected_into_till: "0.00",
    money: day.money ?? day.sold,
    ways: ["CASH", "CARD", "TRANSFER", "NOT_STATED"].map((method) => ({
      method,
      came_in: method === "CASH" ? (day.money ?? day.sold) : "0.00",
      went_out: "0.00",
      corrected: "0.00",
      net: method === "CASH" ? (day.money ?? day.sold) : "0.00",
    })),
    off_till: {
      prepaid_transfer: way(day.prepaid ?? "0.00"),
      carrier_cod: way(day.cod ?? "0.00"),
    },
  };
}

const today = new Date();
const two = (n: number): string => String(n).padStart(2, "0");
const iso = `${String(today.getFullYear())}-${two(today.getMonth() + 1)}-${two(today.getDate())}`;

/** The day of «Центр» and «Ринок» as S04 draws it: 12 050,00 грн, six
 * coats, one back; 10 850,00 грн through the tills, 1 200,00 грн by cash
 * on delivery. */
const centreDay: Day = { sold: "6950.00", units: 4, money: "6350.00" };
const marketDay: Day = {
  sold: "5100.00",
  units: 2,
  returned_units: 1,
  money: "4500.00",
};
const totalDay: Day = {
  sold: "12050.00",
  units: 6,
  returned_units: 1,
  money: "10850.00",
  cod: "1200.00",
};

async function report(
  page: Page,
  stores: [string, string, Day][],
  total: Day | null,
): Promise<void> {
  await page.route("**/api/v1/reports/sales", async (route) => {
    await route.fulfill({
      json: {
        date_from: iso,
        date_to: iso,
        today: iso,
        currency_code: "UAH",
        stores: stores.map(([id, name, day]) => ({
          store_id: id,
          store_name: name,
          store_state: "ACTIVE",
          ...figures(day),
        })),
        total: total ? figures(total) : null,
      },
    });
  });
}

/** A drawer open since last night, or closed today at `closedAt`. */
async function drawer(
  page: Page,
  store: string,
  closedAt: string | null,
): Promise<void> {
  await page.route(`**/api/v1/cash/drawer?store_id=${store}`, async (route) => {
    const at = closedAt ?? new Date(Date.now() - 16 * 3600_000).toISOString();
    await route.fulfill({
      json: {
        store_id: store,
        store_name: "",
        store_state: "ACTIVE",
        last_close: {
          id: "33333333-3333-4333-8333-333333333333",
          number: 7,
          business_day: iso,
          closed_at: at,
          closed_by: "Наталя",
          mine: false,
        },
        next_is_opening: false,
        closed_today: closedAt !== null,
        may_close: true,
        movement_kinds: [],
        may_correct: false,
        movements: [],
        unclosed_days: [],
        reason_owed: null,
      },
    });
  });
}

async function debts(
  page: Page,
  store: string,
  owed: string,
  customers: number,
): Promise<void> {
  await page.route(
    `**/api/v1/credits/summary?store_id=${store}`,
    async (route) => {
      await route.fulfill({ json: { owed, customers, debts: customers } });
    },
  );
}

async function orders(
  page: Page,
  store: string,
  counts: [number, number, number],
  hasMore = false,
): Promise<void> {
  const statuses = ["READY_TO_DISPATCH", "DISPATCHED", "ARRIVED"];
  await page.route(`**/api/v1/orders?store_id=${store}&**`, async (route) => {
    // The day-tag's read alone: «Замовлення»'s next pages are its own.
    const url = route.request().url();
    if (!url.includes("status=open") || url.includes("offset=")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        orders: counts.flatMap((count, at) =>
          Array.from({ length: count }, (_, n) => ({
            id: `00000000-0000-4000-8000-${String(at)}${String(n).padStart(11, "0")}`,
            store_id: store,
            status: statuses[at],
            items: [],
            created_at: new Date().toISOString(),
          })),
        ),
        has_more: hasMore,
      },
    });
  });
}

/** «Центр» and «Ринок», S04's day: «Центр»'s drawer open, «Ринок»'s
 * closed at 20:06 tonight. */
async function twoStores(page: Page): Promise<string> {
  const closed = new Date();
  closed.setHours(20, 6, 0, 0);
  await report(
    page,
    [
      [centre, "Центр", centreDay],
      [market, "Ринок", marketDay],
    ],
    totalDay,
  );
  await drawer(page, centre, null);
  await drawer(page, market, closed.toISOString());
  await debts(page, centre, "8400.00", 4);
  await debts(page, market, "2600.00", 2);
  await orders(page, centre, [2, 1, 2]);
  await orders(page, market, [1, 1, 0]);
  return closed.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tab(page: Page, name: string): Locator {
  return menu(page).getByRole("button", { name, exact: true });
}

function dayTag(page: Page): Locator {
  return page.getByRole("group", { name: "Сьогодні досі" });
}

function column(page: Page, name: string): Locator {
  return dayTag(page).getByRole("group", { name, exact: true });
}

interface MeStore {
  id: string;
  state: string;
  permissions: string[];
}

/** `/me` with the seed's network alone — «Центр», «Ринок» and the archived
 * «Старий»: the seed gives its owner «Каса», «Північний» and «Південний»
 * too, for other journeys, and the day-tag would show them. `edit` changes
 * a store where a journey needs it. */
async function me(
  page: Page,
  edit: (store: MeStore) => void = () => undefined,
): Promise<void> {
  const network = [centre, market, fixture.network_old_store_id];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { stores: MeStore[] };
    body.stores = body.stores.filter((store) => network.includes(store.id));
    body.stores.forEach(edit);
    await route.fulfill({ response, json: body });
  });
}

async function onToday(
  page: Page,
  url = owner(),
  edit?: (store: MeStore) => void,
): Promise<void> {
  await me(page, edit);
  await page.goto(url);
  await openStore(page, "Центр");
  await expect(
    page.getByRole("heading", { name: "Сьогодні", exact: true }),
  ).toBeVisible();
}

const weekdays = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П’ятниця",
  "Субота",
];
const months = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

// --- the day-tag ------------------------------------------------------------

test("whoever reads the report opens on «Сьогодні»: the day of «Центр» and «Ринок», each figure the server's", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  const closedAt = await twoStores(page);
  await onToday(page);
  // The first tab, open; the day and the person under the title, «Змінити
  // магазин» at the line's right.
  const tabs = menu(page).getByRole("button");
  await expect(tabs.first()).toHaveText("Сьогодні");
  await expect(tabs.first()).toHaveAttribute("aria-current", "page");
  const weekday = weekdays[today.getDay()] ?? "";
  const month = months[today.getMonth()] ?? "";
  await expect(page.locator(".store-line > p")).toHaveText(
    `${weekday}, ${String(today.getDate())} ${month} · Власник`,
  );
  await expect(
    page
      .locator(".store-line")
      .getByRole("button", { name: "Змінити магазин" }),
  ).toBeVisible();
  const tag = dayTag(page);
  await expect(tag.locator(".day-stamp")).toHaveText(/^наживо · \d\d:\d\d$/);
  // The total and its words: `total` of the report, the stores together.
  await expect(tag.locator(".day-total")).toHaveText(
    "12 050,00 грнпродано · 6 шт. · повернули 1 шт.",
  );
  await expect(tag.locator(".day-money")).toHaveText(
    "Гроші 10 850,00 грн · поза касою: накладений платіж 1 200,00 грн",
  );
  // A column a store: its own sale, drawer and debts — never the network's.
  await expect(column(page, "Центр")).toHaveText(
    "Центр6 950,00 грн4 шт.Каса відкритаВинні 8 400,00 грн · 4 людини",
  );
  await expect(column(page, "Ринок")).toHaveText(
    `Ринок5 100,00 грн2 шт.Касу закрито о ${closedAt}Винні 2 600,00 грн · 2 людини`,
  );
  await expect(tag.getByText(/^Винні /)).toHaveCount(2);
  await expect(tag.locator(".day-columns > *")).toHaveCount(2);
  // The parcels: open orders of both stores, by their state.
  await expect(tag.locator(".day-online")).toHaveText(
    "Онлайн: відправити 3 · в дорозі 2 · на пошті 2",
  );
  // Whole over the menu with room kept for the search to come (P2-2,
  // 64 px); nothing on the screen says «⚠».
  const box = await tag.boundingBox();
  const bar = await menu(page).boundingBox();
  expect(
    box && bar && box.y >= 0 && box.y + box.height + 64 <= bar.y,
  ).toBe(true);
  await expect(page.locator(".screen-header")).not.toContainText("⚠");
  await expect(page.locator("section.today")).not.toContainText("⚠");
});

test("under 700 px the day-tag is one line, and opens in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await twoStores(page);
  await onToday(page);
  const line = page.getByRole("button", { name: /^Сьогодні досі/ });
  await expect(line).toHaveText("Сьогодні досі · 12 050,00 грн · 6 шт.");
  await expect(line).toHaveAttribute("aria-expanded", "false");
  await expect(dayTag(page)).toHaveCount(0);
  await line.click();
  await expect(dayTag(page).locator(".day-total")).toContainText(
    "12 050,00 грн",
  );
  await expect(column(page, "Центр")).toBeVisible();
  // The cursor where the line stood: on the tag's heading.
  await expect(
    dayTag(page).getByRole("heading", { name: "Сьогодні досі" }),
  ).toBeFocused();
});

test("under 700 px an old day says so in its one line", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 360, height: 640 });
  await twoStores(page);
  await onToday(page);
  const line = page.getByRole("button", { name: /^Сьогодні досі/ });
  // Live: the line alone.
  await expect(line).toHaveText("Сьогодні досі · 12 050,00 грн · 6 шт.");
  await page.clock.fastForward("06:00");
  await expect(line.locator(".day-stamp")).toHaveText(/^дані на \d\d:\d\d$/);
  await expect(line.locator(".day-stamp")).toHaveClass(/stale/);
  await expect(line).toContainText("Сьогодні досі · 12 050,00 грн · 6 шт.");
});

test("a million in a store's day stays in its column, and the day's in the tag, whatever face draws them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  const big: Day = { sold: "123456.00", units: 40 };
  const bigger: Day = { sold: "1234567.00", units: 300 };
  await report(
    page,
    [
      [centre, "Центр", big],
      [market, "Ринок", bigger],
    ],
    { sold: "1358023.00", units: 340 },
  );
  for (const store of [centre, market]) {
    await drawer(page, store, null);
    await debts(page, store, "0.00", 0);
    await orders(page, store, [0, 0, 0]);
  }
  await onToday(page);
  // The display face may come too late (`font-display: optional`), and the
  // device's is wider: the sums drawn in a wide one, Verdana here or DejaVu
  // Sans on CI's Linux.
  await page.addStyleTag({
    content: '.sum { font-family: Verdana, "DejaVu Sans", sans-serif; }',
  });
  await expect(column(page, "Ринок")).toContainText("1 234 567,00 грн");
  for (const width of [390, 360, 430]) {
    await page.setViewportSize({ width, height: 741 });
    const tag = await dayTag(page).boundingBox();
    const total = await dayTag(page)
      .locator(".day-total .t-money-hero strong")
      .boundingBox();
    expect(total && tag && total.x + total.width).toBeLessThanOrEqual(
      (tag?.x ?? 0) + (tag?.width ?? 0) + 0.5,
    );
    for (const name of ["Центр", "Ринок"]) {
      const store = await column(page, name).boundingBox();
      const sum = await column(page, name)
        .locator(".day-store-sum strong")
        .boundingBox();
      expect(sum && store && sum.x + sum.width).toBeLessThanOrEqual(
        (store?.x ?? 0) + (store?.width ?? 0) + 0.5,
      );
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

test("one store: no columns, its drawer and debts in the tag", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  await report(page, [[centre, "Центр", centreDay]], null);
  await drawer(page, centre, null);
  await debts(page, centre, "0.00", 0);
  await orders(page, centre, [0, 0, 0]);
  await onToday(
    page,
    launch(fixture.network_centre_manager_telegram_user_id, "Марко"),
  );
  const tag = dayTag(page);
  await expect(tag.locator(".day-total")).toHaveText(
    "6 950,00 грнпродано · 4 шт.",
  );
  await expect(tag.locator(".day-columns, .day-rows")).toHaveCount(0);
  await expect(tag.locator(".day-drawer")).toHaveText("Каса відкрита");
  // Nobody owes it anything: said, in pencil, without the debt's arrow.
  await expect(tag.locator(".day-owed")).toHaveText("Ніхто не винен");
  await expect(tag.locator(".day-owed")).not.toHaveClass(/owes/);
  // No open order: no parcels' line.
  await expect(tag.locator(".day-online")).toHaveCount(0);
});

test("three stores: a row each, each with its own debts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 741 });
  const old = fixture.network_old_store_id;
  await report(
    page,
    [
      [centre, "Центр", centreDay],
      [market, "Ринок", marketDay],
      [old, "Старий", { sold: "0.00", units: 0 }],
    ],
    totalDay,
  );
  for (const [store, owed, people] of [
    [centre, "8400.00", 4],
    [market, "2600.00", 2],
    [old, "500.00", 1],
  ] as const) {
    await drawer(page, store, null);
    await debts(page, store, owed, people);
    await orders(page, store, [0, 0, 0]);
  }
  // «Старий» trading again, for this journey alone.
  await onToday(page, owner(), (store) => {
    if (store.id === old) store.state = "ACTIVE";
  });
  const tag = dayTag(page);
  await expect(tag.locator(".day-rows > *")).toHaveCount(3);
  await expect(column(page, "Старий")).toHaveText(
    "Старий0,00 грн0 шт.Каса відкритаВинні 500,00 грн · 1 людина",
  );
  await expect(tag.getByText(/^Винні /)).toHaveCount(3);
});

test("one store trading beside one that does not: its lines named, in a row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  await report(
    page,
    [
      [centre, "Центр", centreDay],
      [market, "Ринок", marketDay],
    ],
    totalDay,
  );
  await drawer(page, centre, null);
  await debts(page, centre, "8400.00", 4);
  await orders(page, centre, [0, 0, 0]);
  // «Ринок» blocked, for this journey alone: the total holds its day, so
  // the drawer and debts under it are said to be «Центр»'s.
  await onToday(page, owner(), (store) => {
    if (store.id === market) store.state = "BLOCKED";
  });
  const tag = dayTag(page);
  await expect(tag.locator(".day-rows > *")).toHaveCount(1);
  await expect(column(page, "Центр")).toHaveText(
    "Центр6 950,00 грн4 шт.Каса відкритаВинні 8 400,00 грн · 4 людини",
  );
  await expect(column(page, "Ринок")).toHaveCount(0);
});

test("a store that does not trade has no column; one without the debts' right, no debts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  await report(
    page,
    [
      [centre, "Центр", centreDay],
      [market, "Ринок", marketDay],
      [fixture.network_old_store_id, "Старий", { sold: "0.00", units: 0 }],
    ],
    totalDay,
  );
  const urls = asked(page);
  await drawer(page, centre, null);
  await drawer(page, market, null);
  await debts(page, centre, "8400.00", 4);
  await orders(page, centre, [0, 0, 0]);
  await orders(page, market, [0, 0, 0]);
  await onToday(page, owner(), (store) => {
    if (store.id === market)
      store.permissions = store.permissions.filter(
        (right) => right !== "sale:credit",
      );
  });
  const tag = dayTag(page);
  // «Старий» is archived: the report reads it, the tag does not show it.
  await expect(tag.locator(".day-columns > *")).toHaveCount(2);
  await expect(column(page, "Старий")).toHaveCount(0);
  await expect(column(page, "Ринок")).toHaveText(
    "Ринок5 100,00 грн2 шт.Каса відкрита",
  );
  await expect(column(page, "Центр")).toContainText("Винні 8 400,00 грн");
  // «Ринок»'s debts are never asked for; nothing of «Старий»'s is.
  await page.waitForTimeout(500);
  expect(dayReads(urls)).toEqual({
    report: 1,
    drawers: 2,
    debts: 1,
    orders: 2,
  });
});

test("a seller has no «Сьогодні»: the till opens first", async ({ page }) => {
  await page.goto(
    launch(fixture.network_centre_cashier_telegram_user_id, "Ліда"),
  );
  await expect(menu(page).getByRole("button").first()).toHaveText("Продаж");
  await expect(
    menu(page).getByRole("button", { name: "Сьогодні" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Продаж", exact: true }),
  ).toBeVisible();
});

test("the parcels' line opens «Замовлення», with «+» when a store holds more than its hundred", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  await twoStores(page);
  await page.unroute(`**/api/v1/orders?store_id=${market}&**`);
  await orders(page, market, [1, 0, 0], true);
  await onToday(page);
  const line = dayTag(page).getByRole("button", { name: /^Онлайн:/ });
  await expect(line).toHaveText(
    "Онлайн: відправити 3+ · в дорозі 1+ · на пошті 2+",
  );
  await line.click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
});

// --- its age, its failures, its reads ---------------------------------------

test("the report unread: each store's drawer and debts stand, its figures wait", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  await twoStores(page);
  await page.unroute("**/api/v1/reports/sales");
  await page.route("**/api/v1/reports/sales", async (route: Route) => {
    await route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
  });
  await onToday(page);
  await expect(column(page, "Центр")).toContainText(
    "Каса відкритаВинні 8 400,00 грн",
  );
  await expect(column(page, "Ринок")).toContainText("Касу закрито о");
  await expect(
    column(page, "Ринок").locator(".day-store-sold .day-wait"),
  ).toBeVisible();
  await expect(dayTag(page).locator(".day-online")).toContainText("Онлайн:");
  await expect(dayTag(page).locator(".day-stamp")).toHaveText(
    /^дані на \d\d:\d\d — сервер не відповідає$/,
  );
});

test("the stamp says how old the figures are, and when the server is silent", async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 741 });
  await twoStores(page);
  await onToday(page);
  const stamp = dayTag(page).locator(".day-stamp");
  await expect(stamp).toHaveText(/^наживо · \d\d:\d\d$/);
  const at = ((await stamp.innerText()).split(" · ")[1] ?? "").trim();
  // Six minutes on «Сьогодні», nothing read again: the figures are old.
  await page.clock.fastForward("06:00");
  await expect(stamp).toHaveText(`дані на ${at}`);
  await expect(stamp).toHaveClass(/stale/);
  // Back to the app with the server silent: what was read stands, and the
  // stamp says why it is old.
  await page.route("**/api/v1/reports/sales", async (route) => {
    await route.abort("connectionrefused");
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stamp).toHaveText(`дані на ${at} — сервер не відповідає`);
  await expect(dayTag(page).locator(".day-total")).toContainText(
    "12 050,00 грн",
  );
});

test("a read that fails hides nothing else: its line holds its place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  await twoStores(page);
  await page.unroute(`**/api/v1/credits/summary?store_id=${market}`);
  await page.route(
    `**/api/v1/credits/summary?store_id=${market}`,
    async (route: Route) => {
      await route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
    },
  );
  await onToday(page);
  await expect(column(page, "Центр")).toContainText("Винні 8 400,00 грн");
  await expect(column(page, "Ринок")).toContainText("Касу закрито о");
  await expect(
    column(page, "Ринок").locator(".day-owed .day-wait"),
  ).toBeVisible();
  await expect(dayTag(page).locator(".day-total")).toContainText(
    "12 050,00 грн",
  );
  await expect(dayTag(page).locator(".day-stamp")).toHaveText(
    /^дані на \d\d:\d\d — сервер не відповідає$/,
  );
});

/** Every read from now on, by the path and query it asked. */
function asked(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.startsWith("/api/v1/"))
      urls.push(`${url.pathname}${url.search}`);
  });
  return urls;
}

/** How many of the day-tag's own reads were asked: the report, each
 * store's drawer, debts and open orders. */
function dayReads(urls: readonly string[]): Record<string, number> {
  const count = (pattern: RegExp): number =>
    urls.filter((url) => pattern.test(url)).length;
  return {
    report: count(/^\/api\/v1\/reports\/sales$/),
    drawers: count(/^\/api\/v1\/cash\/drawer\?/),
    debts: count(/^\/api\/v1\/credits\/summary\?/),
    orders: count(/^\/api\/v1\/orders\?.*status=open/),
  };
}

test("at most twenty reads as it opens, none again within a minute, each again after it", async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 741 });
  await twoStores(page);
  const urls = asked(page);
  await onToday(page);
  await expect(dayTag(page).locator(".day-online")).toBeVisible();
  await expect(dayTag(page).getByText(/^Винні /)).toHaveCount(2);
  const once = { report: 1, drawers: 2, debts: 2, orders: 2 };
  // The whole app's, as Бірка opens on «Сьогодні», once its reads have
  // settled; a drawer the app reads for its own store is the day-tag's read
  // too.
  await page.waitForTimeout(500);
  expect(urls.length).toBeLessThanOrEqual(20);
  expect(dayReads(urls)).toEqual(once);
  // To the till and back, and the app left and come back to: within the
  // minute, nothing is read again.
  await tab(page, "Продаж").click();
  await tab(page, "Сьогодні").click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dayTag(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(dayReads(urls)).toEqual(once);
  // A minute later, back on the tab: each once more.
  await tab(page, "Продаж").click();
  await page.clock.fastForward("01:01");
  await tab(page, "Сьогодні").click();
  await expect
    .poll(() => dayReads(urls))
    .toEqual({ report: 2, drawers: 4, debts: 4, orders: 4 });
});

test("in Telegram's dark theme the day-tag's debts and an old stamp read at 4.5:1", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 741 });
  await twoStores(page);
  await onToday(page);
  const owed = column(page, "Центр").locator(".day-owed");
  await expect(owed).toHaveClass(/owes/);
  expect(await contrast(owed)).toBeGreaterThanOrEqual(4.5);
  await page.clock.fastForward("06:00");
  const stamp = dayTag(page).locator(".day-stamp");
  await expect(stamp).toHaveClass(/stale/);
  expect(await contrast(stamp)).toBeGreaterThanOrEqual(4.5);
  const words = dayTag(page).locator(".day-money");
  expect(await contrast(words)).toBeGreaterThanOrEqual(4.5);
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
