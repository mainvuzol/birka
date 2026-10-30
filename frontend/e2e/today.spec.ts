import { test, expect, menu, openStore, section } from "./fixtures";
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

/** A store's parcels to send, oldest first: each order's goods as «Замовлення»
 * gets them — a model and colour, a size, how many. */
async function parcels(
  page: Page,
  store: string,
  goods: [string, string, number][][],
  hasMore = false,
): Promise<void> {
  await page.route(`**/api/v1/orders?store_id=${store}&**`, async (route) => {
    const url = route.request().url();
    if (!url.includes("status=open") || url.includes("offset=")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        // Newest first, as the server answers: the tag says the oldest
        // first.
        orders: goods
          .map((items, at) => ({
            id: `00000000-0000-4000-8000-9${String(at).padStart(11, "0")}`,
            store_id: store,
            status: "READY_TO_DISPATCH",
            created_at: new Date(Date.now() - (goods.length - at) * 60_000)
              .toISOString(),
            items: items.map(([display_name, size_label, quantity], n) => ({
              id: `00000000-0000-4000-8000-8${String(at)}${String(n).padStart(10, "0")}`,
              display_name,
              size_label,
              quantity,
            })),
          }))
          .reverse()
          .concat([
            {
              id: "00000000-0000-4000-8000-700000000000",
              store_id: store,
              status: "DISPATCHED",
              created_at: new Date().toISOString(),
              items: [
                {
                  id: "00000000-0000-4000-8000-710000000000",
                  display_name: "Вже в дорозі",
                  size_label: "M",
                  quantity: 1,
                },
              ],
            },
          ]),
        has_more: hasMore,
      },
    });
  });
}

/** A store's «Брак»: the units awaiting inspection, oldest first, and one
 * already being looked at, which waits on nobody here. */
async function damaged(
  page: Page,
  store: string,
  units: [string, string | null][],
): Promise<void> {
  const unit = (
    [name, size]: [string, string | null],
    at: number,
    status: string,
  ): Record<string, unknown> => ({
    id: `00000000-0000-4000-8000-6${String(at).padStart(11, "0")}`,
    display_name: name,
    size,
    status,
    returned_at: new Date(Date.now() - (units.length - at) * 86_400_000)
      .toISOString(),
    status_by: null,
    status_at: null,
    sold_from_location_id: "00000000-0000-4000-8000-500000000000",
    sold_from_location_name: "Основний",
    back_to_sold_from: true,
    note: null,
  });
  await page.route(
    `**/api/v1/damaged-units?store_id=${store}`,
    async (route) => {
      await route.fulfill({
        json: {
          units: [
            ...units.map((one, at) => unit(one, at, "AWAITING")).reverse(),
            unit(["Оглядають", "S"], 99, "INSPECTING"),
          ],
        },
      });
    },
  );
}

/** A store's lists of existing stock: those in review, each its lines;
 * one approved, and one of a warehouse it shares, kept by another store. */
async function lists(
  page: Page,
  store: string,
  inReview: number[],
): Promise<void> {
  const list = (
    at: number,
    status: string,
    lines: number,
    keeper = store,
  ): Record<string, unknown> => {
    const id = `00000000-0000-4000-8000-4${String(at).padStart(11, "0")}`;
    const basis = (n: number): Record<string, number> => ({
      STATED: n,
      STATED_BY_SIZE: 0,
      LINE_IMPLIES_ONE: 0,
      RECOUNTED: 0,
      OWNER_KNOWLEDGE: 0,
    });
    return {
      snapshot_id: id,
      command_id: id,
      store_id: keeper,
      store_name: "Центр",
      store_state: "ACTIVE",
      location_id: "00000000-0000-4000-8000-500000000000",
      status,
      source_document_ref: "Зошит",
      captured_at: null,
      review_revision: 1,
      created_at: new Date().toISOString(),
      rejection_reason: null,
      decided_at: null,
      summary: {
        lines,
        pending: 0,
        needs_review: 0,
        resolved: lines,
        skipped: 0,
        allocations: lines,
        units: lines,
        lines_differing_from_source: 0,
        lines_by_basis: basis(lines),
        units_by_basis: basis(lines),
        parts: 1,
        parts_removed: 0,
        limits: { lines: 5000, allocations: 20000 },
      },
      ready_to_approve: true,
      application: null,
    };
  };
  await page.route(`**/api/v1/snapshots?store_id=${store}&**`, async (route) => {
    await route.fulfill({
      json: {
        items: [
          ...inReview.map((lines, at) => list(at, "IN_REVIEW", lines)),
          list(50, "APPLIED", 30),
          list(51, "IN_REVIEW", 7, "00000000-0000-4000-8000-300000000000"),
        ],
        has_more: false,
      },
    });
  });
}

/** The night's copy, made today at 03:15. */
function night(ok: boolean): Record<string, unknown> {
  const at = new Date();
  at.setHours(3, 15, 0, 0);
  return {
    started_at: new Date(at.getTime() - 120_000).toISOString(),
    finished_at: at.toISOString(),
    ok,
    archive: ok ? "birka-2026.dump" : null,
    archive_bytes: ok ? 1_048_576 : null,
    drill_ok: ok ? true : null,
    restore_seconds: ok ? 4.2 : null,
    reasons: ok ? [] : ["Немає місця на диску"],
  };
}

/** The network's backups: in order by default; `edit` breaks them. */
async function backups(
  page: Page,
  edit: (body: Record<string, unknown>) => void = () => undefined,
): Promise<void> {
  await page.route("**/api/v1/backups", async (route) => {
    const good = night(true);
    const body: Record<string, unknown> = {
      state: "OK",
      checked_at: new Date().toISOString(),
      due_hours: 26,
      latest: good,
      last_good: good,
      nights: [good],
      your_last_message: null,
      server: { looked_at: new Date().toISOString(), open: [], recent: [] },
    };
    edit(body);
    await route.fulfill({ json: body });
  });
}

// Nothing waits but what a journey says: «Брак» empty, no list to approve,
// the backups in order. A journey's own stubs, set later, come first.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/damaged-units?**", async (route) => {
    await route.fulfill({ json: { units: [] } });
  });
  await page.route("**/api/v1/snapshots?**", async (route) => {
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await backups(page);
});

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
    damaged: 2,
    lists: 2,
    backups: 1,
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

// --- what waits -------------------------------------------------------------

function waiting(page: Page): Locator {
  return page.getByRole("region", { name: /^Чекає на вас/ });
}

function tags(page: Page): Locator {
  return waiting(page).locator(".today-tag");
}

/** The backups failed last night, and the disk is filling now. */
async function failedBackups(page: Page): Promise<void> {
  await backups(page, (body) => {
    const bad = night(false);
    body.state = "FAILED";
    body.latest = bad;
    body.nights = [bad];
    body.server = {
      looked_at: new Date().toISOString(),
      open: [
        {
          kind: "DISK_LOW",
          reason: "Вільно 3 %",
          started_at: new Date().toISOString(),
          told_at: null,
        },
      ],
      recent: [],
    };
  });
}

test("what waits: a tag a kind and a store, in the frame's order, each from its read, the badge its count", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  await twoStores(page);
  await failedBackups(page);
  await parcels(page, centre, [
    [["Лоран шоколад", "M", 1]],
    [
      ["Кокон графіт", "S", 2],
      ["Мишка чорний", "L", 1],
    ],
    [["Лагуна персик", "XL", 1]],
  ]);
  await parcels(page, market, [[["Мишка чорний", "S", 1]]]);
  await damaged(page, centre, [
    ["Кокон графіт", "M"],
    ["Лагуна персик", "L"],
    ["Марсель молочний", null],
  ]);
  await lists(page, centre, [412]);
  await lists(page, market, [12, 30]);
  await onToday(page);
  await expect(
    page.getByRole("heading", { name: "Чекає на вас · 6", exact: true }),
  ).toBeVisible();
  // The backups first, the network's; then each kind, «Центр», open, first.
  await expect(tags(page).locator("h3")).toHaveText([
    "Остання нічна копія не вдалася",
    "Відправити 3 посилки",
    "Відправити 1 посилку",
    "У «Браку» «Центр» 3 речі очікують перевірки",
    "Затвердьте початкові залишки",
    "Затвердьте початкові залишки",
  ]);
  await expect(tags(page).locator(".today-tag-meta")).toHaveText([
    "Закінчується місце на диску",
    // Its goods oldest first, three of them and how many more.
    "Центр · Лоран шоколад M · Кокон графіт S × 2 · Мишка чорний L · + ще 1",
    "Ринок · Мишка чорний S",
    // Two of the three, oldest first; the one looked at waits on nobody.
    "Кокон графіт M · Лагуна персик L",
    // A list kept by another store is not this one's to approve.
    "Центр · 412 рядків",
    "Ринок · 2 списки",
  ]);
  // A verb where it is done from here: «Ринок»'s are done there.
  await expect(tags(page).locator(".today-verb")).toHaveText([
    "Переглянути",
    "Зібрати й відправити",
    "Оглянути",
    "Переглянути й затвердити",
  ]);
  await expect(tags(page).nth(2).getByRole("button")).toHaveCount(0);
  await expect(tags(page).nth(5).getByRole("button")).toHaveCount(0);
  // The badge counts them: drawn on the glyph, said as the tab's
  // description, the tab's name its own.
  await expect(tab(page, "Сьогодні")).toHaveAccessibleDescription(
    "Чекає на вас: 6",
  );
  await expect(tab(page, "Сьогодні").locator(".tab-pill")).toHaveAttribute(
    "data-badge",
    "6",
  );
  // Something is wrong: no line saying the copies are in order, and no
  // «⚠» on «Сьогодні»'s own blocks — the menu's «Ще ⚠» stays until P1-5.
  await expect(page.locator(".today-backups")).toHaveCount(0);
  await expect(waiting(page)).not.toContainText("⚠");
});

test("opened at «Ринок»: its tags first of their kind, with the verbs; «Центр»'s say what waits there; trouble on the server with the copies in order", async ({
  page,
}) => {
  await twoStores(page);
  await backups(page, (body) => {
    body.server = {
      looked_at: new Date().toISOString(),
      open: [
        {
          kind: "NOT_ANSWERING",
          reason: "Не відповідає 3 хв",
          started_at: new Date().toISOString(),
          told_at: null,
        },
      ],
      recent: [],
    };
  });
  await parcels(page, centre, [[["Лоран шоколад", "M", 1]]]);
  await parcels(page, market, [[["Мишка чорний", "S", 1]]]);
  await me(page);
  await page.goto(owner());
  await openStore(page, "Ринок");
  await expect(
    page.getByRole("heading", { name: "Сьогодні", exact: true }),
  ).toBeVisible();
  await expect(tags(page).locator("h3")).toHaveText([
    "Проблема на сервері",
    "Відправити 1 посилку",
    "Відправити 1 посилку",
  ]);
  await expect(tags(page).locator(".today-tag-meta")).toHaveText([
    "Сервер не відповідає",
    "Ринок · Мишка чорний S",
    "Центр · Лоран шоколад M",
  ]);
  await expect(tags(page).locator(".today-verb")).toHaveText([
    "Переглянути",
    "Зібрати й відправити",
  ]);
  await expect(page.locator(".today-backups")).toHaveCount(0);
});

test("each verb opens its section, and its «←» comes back to «Сьогодні»", async ({
  page,
}) => {
  await twoStores(page);
  await failedBackups(page);
  await parcels(page, centre, [[["Лоран шоколад", "M", 1]]]);
  await damaged(page, centre, [["Кокон графіт", "M"]]);
  await lists(page, centre, [5]);
  await onToday(page);
  const back = page.getByRole("button", { name: "Назад до «Сьогодні»" });
  for (const [verb, heading] of [
    ["Переглянути", "Резервні копії"],
    ["Переглянути й затвердити", "Початкові залишки"],
    ["Оглянути", "Брак"],
  ] as const) {
    await waiting(page).getByRole("button", { name: verb, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    // The cursor on «Сьогодні», never lost with the verb, as a row of «Ще»
    // leaves it on «Ще».
    await expect(tab(page, "Сьогодні")).toBeFocused();
    await expect(back).toHaveText("← Сьогодні");
    await back.click();
    await expect(
      page.getByRole("heading", { name: "Сьогодні", exact: true }),
    ).toBeVisible();
    await expect(tab(page, "Сьогодні")).toBeFocused();
  }
  // Left by the menu, the section a tag opened is opened afresh from «Ще»:
  // «← Ще», as before.
  await waiting(page).getByRole("button", { name: "Оглянути" }).click();
  await expect(back).toBeVisible();
  await tab(page, "Продаж").click();
  await section(page, "Брак");
  await expect(
    page.getByRole("button", { name: "Назад до «Ще»" }),
  ).toHaveText("← Ще");
  await tab(page, "Сьогодні").click();
  await waiting(page)
    .getByRole("button", { name: "Зібрати й відправити", exact: true })
    .click();
  await expect(tab(page, "Замовлення")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "Замовлення")).toBeFocused();
});

test("a tag goes by itself once its work is done, at the next read, and the badge with it", async ({
  page,
}) => {
  await page.clock.install();
  await twoStores(page);
  await orders(page, centre, [0, 1, 0]);
  await orders(page, market, [0, 0, 0]);
  let units: [string, string | null][] = [["Кокон графіт", "M"]];
  await page.route(
    `**/api/v1/damaged-units?store_id=${centre}`,
    async (route) => {
      await route.fulfill({
        json: {
          units: units.map(([display_name, size], at) => ({
            id: `00000000-0000-4000-8000-6${String(at).padStart(11, "0")}`,
            display_name,
            size,
            status: "AWAITING",
            returned_at: new Date().toISOString(),
            status_by: null,
            status_at: null,
            sold_from_location_id: "00000000-0000-4000-8000-500000000000",
            sold_from_location_name: "Основний",
            back_to_sold_from: true,
            note: null,
          })),
        },
      });
    },
  );
  await onToday(page);
  await expect(tags(page)).toHaveText([/У «Браку» «Центр» 1 річ очікує/]);
  await expect(tab(page, "Сьогодні")).toHaveAccessibleDescription(
    "Чекає на вас: 1",
  );
  // Inspected meanwhile: a minute on, back on the tab, it is read again.
  units = [];
  await tab(page, "Продаж").click();
  await page.clock.fastForward("01:01");
  await tab(page, "Сьогодні").click();
  await expect(
    page.getByRole("heading", { name: "Вас нічого не чекає.", exact: true }),
  ).toBeVisible();
  await expect(tags(page)).toHaveCount(0);
  await expect(tab(page, "Сьогодні")).toHaveAccessibleDescription("");
  await expect(
    tab(page, "Сьогодні").locator(".tab-pill"),
  ).not.toHaveAttribute("data-badge");
});

test("past seven, «+ ще N»: tapped, the rest, the cursor on the first of them; the badge «9+» past nine", async ({
  page,
}) => {
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
  for (const store of [centre, market, old]) {
    await drawer(page, store, null);
    await debts(page, store, "0.00", 0);
    await parcels(page, store, [[["Лоран шоколад", "M", 1]]]);
    await damaged(page, store, [["Кокон графіт", "M"]]);
    await lists(page, store, [3]);
  }
  await failedBackups(page);
  await onToday(page, owner(), (store) => {
    if (store.id === old) store.state = "ACTIVE";
  });
  await expect(
    page.getByRole("heading", { name: "Чекає на вас · 10", exact: true }),
  ).toBeVisible();
  await expect(tags(page)).toHaveCount(7);
  await expect(tab(page, "Сьогодні").locator(".tab-pill")).toHaveAttribute(
    "data-badge",
    "9+",
  );
  await expect(tab(page, "Сьогодні")).toHaveAccessibleDescription(
    "Чекає на вас: 10",
  );
  await waiting(page).getByRole("button", { name: "+ ще 3" }).click();
  await expect(tags(page)).toHaveCount(10);
  await expect(waiting(page).getByRole("button", { name: /^\+ ще/ })).toHaveCount(
    0,
  );
  // The first that was folded: «Центр»'s list, the lists last of all.
  await expect(tags(page).nth(7)).toBeFocused();
  await expect(tags(page).nth(7).locator("h3")).toHaveText(
    "Затвердьте початкові залишки",
  );
  await expect(tags(page).nth(7).locator(".today-tag-meta")).toHaveText(
    "Центр · 3 рядки",
  );
});

test("nothing waiting: «Вас нічого не чекає.», no count, and the copies in order under it", async ({
  page,
}) => {
  await twoStores(page);
  await orders(page, centre, [0, 1, 0]);
  await orders(page, market, [0, 0, 0]);
  await onToday(page);
  await expect(
    page.getByRole("heading", { name: "Вас нічого не чекає.", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/^Чекає на вас/)).toHaveCount(0);
  await expect(page.locator(".today-backups")).toHaveText(
    "Копії в порядку · сьогодні о 03:15",
  );
  await expect(
    tab(page, "Сьогодні").locator(".tab-pill"),
  ).not.toHaveAttribute("data-badge");
});

test("a read that fails holds its tag's place and says so: nothing is said to be done, and the rest stands", async ({
  page,
}) => {
  await twoStores(page);
  await orders(page, centre, [0, 1, 0]);
  await orders(page, market, [0, 0, 0]);
  await page.route(
    `**/api/v1/damaged-units?store_id=${market}`,
    async (route) => {
      await route.fulfill({ status: 500, json: { code: "INTERNAL" } });
    },
  );
  await onToday(page);
  const place = waiting(page).locator(".today-tag-wait");
  await expect(place).toBeVisible();
  await expect(place).toContainText("не вдалося прочитати");
  await expect(tags(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Вас нічого не чекає.", exact: true }),
  ).toHaveCount(0);
  // The day-tag and the copies' line stand.
  await expect(dayTag(page).locator(".day-total")).toContainText(
    "12 050,00 грн",
  );
  await expect(page.locator(".today-backups")).toBeVisible();
});

test("a read that fails again: what waits says how old it is by its heading, its tags as they were", async ({
  page,
}) => {
  await page.clock.install();
  await twoStores(page);
  await parcels(page, centre, [[["Лоран шоколад", "M", 1]]]);
  await orders(page, market, [0, 0, 0]);
  await onToday(page);
  await expect(tags(page)).toHaveText([/^Відправити 1 посилку/]);
  const stamp = page.locator(".today-waiting-head .day-stamp");
  await expect(stamp).toHaveCount(0);
  // The parcels' read fails a minute on: the tag stays as it was, and the
  // block says how old.
  await page.route(`**/api/v1/orders?store_id=${centre}&**`, async (route) => {
    const url = route.request().url();
    if (!url.includes("status=open") || url.includes("offset=")) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 500, json: { code: "INTERNAL" } });
  });
  await tab(page, "Продаж").click();
  await page.clock.fastForward("01:01");
  await tab(page, "Сьогодні").click();
  await expect(stamp).toHaveText(/^дані на \d\d:\d\d$/);
  await expect(tags(page)).toHaveText([/^Відправити 1 посилку/]);
});

test("«Вас нічого не чекає.» from a read that has failed since says how old", async ({
  page,
}) => {
  await page.clock.install();
  await twoStores(page);
  await orders(page, centre, [0, 1, 0]);
  await orders(page, market, [0, 0, 0]);
  await onToday(page);
  const empty = page.locator(".today-empty");
  await expect(empty).toContainText("Вас нічого не чекає.");
  await expect(empty.locator(".day-stamp")).toHaveCount(0);
  await page.route(
    `**/api/v1/damaged-units?store_id=${market}`,
    async (route) => {
      await route.fulfill({ status: 500, json: { code: "INTERNAL" } });
    },
  );
  await tab(page, "Продаж").click();
  await page.clock.fastForward("01:01");
  await tab(page, "Сьогодні").click();
  await expect(empty.locator(".day-stamp")).toHaveText(
    /^дані на \d\d:\d\d$/,
  );
});

test("a manager of one store: no backups and no lists to approve, «Брак» and the parcels by their rights", async ({
  page,
}) => {
  await report(page, [[centre, "Центр", centreDay]], null);
  await drawer(page, centre, null);
  await debts(page, centre, "0.00", 0);
  await parcels(page, centre, [[["Лоран шоколад", "M", 1]]]);
  await damaged(page, centre, [["Кокон графіт", "M"]]);
  await lists(page, centre, [5]);
  const urls = asked(page);
  await onToday(
    page,
    launch(fixture.network_centre_manager_telegram_user_id, "Марко"),
  );
  // One store: its tags unnamed.
  await expect(tags(page).locator("h3")).toHaveText([
    "Відправити 1 посилку",
    "У «Браку» «Центр» 1 річ очікує перевірки",
  ]);
  await expect(tags(page).first().locator(".today-tag-meta")).toHaveText(
    "Лоран шоколад M",
  );
  await expect(page.locator(".today-backups")).toHaveCount(0);
  expect(urls.filter((url) => /\/(backups|snapshots)/.test(url))).toEqual([]);
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

/** How many of «Сьогодні»'s own reads were asked: the report, each
 * store's drawer, debts and open orders; its «Брак» and lists to approve;
 * the network's backups. */
function dayReads(urls: readonly string[]): Record<string, number> {
  const count = (pattern: RegExp): number =>
    urls.filter((url) => pattern.test(url)).length;
  return {
    report: count(/^\/api\/v1\/reports\/sales$/),
    drawers: count(/^\/api\/v1\/cash\/drawer\?/),
    debts: count(/^\/api\/v1\/credits\/summary\?/),
    orders: count(/^\/api\/v1\/orders\?.*status=open/),
    damaged: count(/^\/api\/v1\/damaged-units\?/),
    lists: count(/^\/api\/v1\/snapshots\?/),
    backups: count(/^\/api\/v1\/backups$/),
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
  const once = {
    report: 1,
    drawers: 2,
    debts: 2,
    orders: 2,
    damaged: 2,
    lists: 2,
    backups: 1,
  };
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
    .toEqual({
      report: 2,
      drawers: 4,
      debts: 4,
      orders: 4,
      damaged: 4,
      lists: 4,
      backups: 2,
    });
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
