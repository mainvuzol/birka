import { test, expect, menu, openStore } from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Гроші» (spec S29; «Усе на бірці» sections task list, P0-7): the owner's
 * and managers' tab — where the money is now, a place a tag and a line a
 * store, and what came in over a period, the ways down and the stores
 * across. Every figure is the answer of its own stubbed read; none is ever
 * the sum of two stores or two places. The people and stores are the
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
const old = fixture.network_old_store_id;

/** Opened from Telegram, in a theme if one is given. */
function launch(
  who: string,
  name: string,
  theme?: Record<string, string>,
): string {
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
  const hash = new URLSearchParams({ tgWebAppData: fields.toString() });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  return `/#${hash.toString()}`;
}

const owner = (theme?: Record<string, string>): string =>
  launch(fixture.network_owner_telegram_user_id, "Власник", theme);

// --- days and moments, as the phone counts them -----------------------------

const two = (n: number): string => String(n).padStart(2, "0");
function isoOf(at: Date): string {
  return `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** The drawer's day `days` ago, 06:00 to 06:00, as «Каса» counts it. */
function drawerDay(days: number): Date {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (now.getHours() < 6 ? 1 : 0) - days,
    12,
  );
}

/** A moment of a drawer day, by the phone's clock: «20:06». */
function at(days: number, hours: number, minutes: number): string {
  const day = drawerDay(days);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
  ).toISOString();
}

const today = isoOf(new Date());

// --- the reads, stubbed -----------------------------------------------------

interface Ways {
  cash: string;
  card: string;
  transfer: string;
  notStated?: string;
  money: string;
  debtPayments?: string;
  cod?: string;
  prepaid?: string;
}

function figures(ways: Ways): Record<string, unknown> {
  // What came in and went out are never the net, which alone is shown.
  const more = (net: string): string => (Number(net) + 75).toFixed(2);
  const sum = (net: string): Record<string, string> => ({
    came_in: more(net),
    corrected: "-75.00",
    net,
  });
  const way = (method: string, net: string): Record<string, string> => ({
    method,
    came_in: more(net),
    went_out: "75.00",
    corrected: "0.00",
    net,
  });
  return {
    sales: 3,
    units: 3,
    sold: ways.money,
    returns: 0,
    returned_units: 0,
    returned: "0.00",
    net: ways.money,
    paid_in_full: ways.money,
    debt_payments: ways.debtPayments ?? "0.00",
    paid_back: "0.00",
    corrected_into_till: "0.00",
    money: ways.money,
    ways: [
      way("CASH", ways.cash),
      way("CARD", ways.card),
      way("TRANSFER", ways.transfer),
      way("NOT_STATED", ways.notStated ?? "0.00"),
    ],
    off_till: {
      prepaid_transfer: sum(ways.prepaid ?? "0.00"),
      carrier_cod: sum(ways.cod ?? "0.00"),
    },
  };
}

/** S29's day: «Центр» 1 700 · 1 850 · 2 700, «Ринок» 3 900 · 1 200 · 0.
 * «Центр»'s «Разом» is the report's own, not its ways' 6 250: a sum made on
 * the phone would show. */
const centreDay: Ways = {
  cash: "1700.00",
  card: "1850.00",
  transfer: "2700.00",
  money: "6150.00",
  debtPayments: "500.00",
  cod: "1200.00",
};
const marketDay: Ways = {
  cash: "3900.00",
  card: "1200.00",
  transfer: "0.00",
  money: "5100.00",
};

type Days = Record<string, [string, string, Ways, string?][]>;

/** The report of a period's days, by its `date_from` — none, today — the
 * stores' figures as given; what was asked kept in `asked`. */
async function report(
  page: Page,
  days: Days,
  serverToday = today,
): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/\/api\/v1\/reports\/sales(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const from = url.searchParams.get("date_from") ?? serverToday;
    const to = url.searchParams.get("date_to") ?? serverToday;
    const stores = days[from] ?? days.today ?? [];
    await route.fulfill({
      json: {
        date_from: from,
        date_to: to,
        today: serverToday,
        currency_code: "UAH",
        stores: stores.map(([id, name, ways, state]) => ({
          store_id: id,
          store_name: name,
          store_state: state ?? "ACTIVE",
          ...figures(ways),
        })),
        total: null,
      },
    });
  });
  return asked;
}

interface LastClose {
  id: string;
  days: number;
  closedAt: string;
  counted: string;
}

/** A drawer, its last close — or none yet — and whether it closed today;
 * the close itself read by its id, with what was to be there too, which
 * «Гроші» never shows (G13). */
async function drawer(
  page: Page,
  store: string,
  last: LastClose | null,
  closedToday = false,
): Promise<void> {
  const brief = last && {
    id: last.id,
    number: 7,
    business_day: isoOf(drawerDay(last.days)),
    closed_at: last.closedAt,
    closed_by: "Наталя",
    mine: false,
  };
  await page.route(`**/api/v1/cash/drawer?store_id=${store}`, async (route) => {
    await route.fulfill({
      json: {
        store_id: store,
        store_name: "",
        store_state: "ACTIVE",
        last_close: brief,
        next_is_opening: last === null,
        closed_today: closedToday,
        may_close: true,
        movement_kinds: [],
        may_correct: false,
        movements: [],
        unclosed_days: [],
        reason_owed: null,
      },
    });
  });
  if (!last || !brief) return;
  const ways = {
    came_in: "0.00",
    went_out: "0.00",
    corrected: "0.00",
    net: "0.00",
  };
  await page.route(`**/api/v1/cash/closes/${last.id}`, async (route) => {
    await route.fulfill({
      json: {
        ...brief,
        store_id: store,
        store_name: "",
        opening: false,
        since: null,
        counted: last.counted,
        expected: "9999.00",
        difference: "-4619.00",
        card: ways,
        transfer: ways,
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
      },
    });
  });
}

/** Cash taken out and put in during today's drawer day; one named for an
 * earlier close by its id, recorded late against it. */
async function movements(
  page: Page,
  store: string,
  items: [string, "OUT" | "IN", string, string, string?][],
): Promise<void> {
  await page.route(
    `**/api/v1/cash/movements?store_id=${store}`,
    async (route) => {
      await route.fulfill({
        json: {
          items: items.map(([kind, direction, amount, when, close], n) => ({
            id: `00000000-0000-4000-8000-${store.slice(0, 4)}${String(n).padStart(8, "0")}`,
            store_id: store,
            kind,
            direction,
            amount,
            note: null,
            at: when,
            by: "Наталя",
            for_close_id: close ?? null,
            for_day: close ? isoOf(drawerDay(1)) : null,
            moved_to_close: false,
          })),
        },
      });
    },
  );
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

async function suppliers(
  page: Page,
  store: string,
  owed: string,
  invoices: number,
): Promise<void> {
  await page.route(
    `**/api/v1/supplier-invoices/summary?store_id=${store}`,
    async (route) => {
      await route.fulfill({ json: { owed, invoices, suppliers: [] } });
    },
  );
}

const centreClose = "33333333-3333-4333-8333-333333333331";
const marketClose = "33333333-3333-4333-8333-333333333332";

/** S29 at 11:40: both drawers counted last night, cash taken out at
 * «Ринок» this morning, what customers and suppliers are owed. */
async function s29(page: Page): Promise<string[]> {
  const asked = await report(page, {
    today: [
      [centre, "Центр", centreDay],
      [market, "Ринок", marketDay],
    ],
  });
  await drawer(page, centre, {
    id: centreClose,
    days: 1,
    closedAt: at(1, 20, 6),
    counted: "5380.00",
  });
  await drawer(page, market, {
    id: marketClose,
    days: 1,
    closedAt: at(1, 20, 2),
    counted: "2450.00",
  });
  await movements(page, centre, [["CHANGE", "IN", "200.00", at(0, 9, 0)]]);
  // The courier at 11:30; and 300 taken out last night, recorded this
  // morning against last night's close.
  await movements(page, market, [
    ["SUPPLIER_COURIER", "OUT", "1040.00", at(0, 11, 30)],
    ["SUPPLIER_COURIER", "OUT", "300.00", at(0, 10, 0), marketClose],
  ]);
  await debts(page, centre, "8400.00", 4);
  await debts(page, market, "2600.00", 2);
  await suppliers(page, centre, "38000.00", 3);
  await suppliers(page, market, "9500.00", 1);
  return asked;
}

interface MeStore {
  id: string;
  state: string;
  permissions: string[];
}

/** `/me` with «Центр» and «Ринок» alone — and «Старий», archived, where a
 * journey asks for it: the seed gives its owner more stores, for other
 * journeys. `edit` changes a store where a journey needs it. */
async function me(
  page: Page,
  {
    withOld = false,
    edit = () => undefined,
  }: {
    withOld?: boolean;
    edit?: (store: MeStore) => void;
  } = {},
): Promise<void> {
  const network = [centre, market, ...(withOld ? [old] : [])];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { stores: MeStore[] };
    body.stores = body.stores.filter((store) => network.includes(store.id));
    body.stores.forEach(edit);
    await route.fulfill({ response, json: body });
  });
}

/** «Гроші» opened from the menu, «Центр» the store. */
async function onMoney(page: Page, url = owner()): Promise<void> {
  await page.goto(url);
  await openStore(page, "Центр");
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Гроші", exact: true }),
  ).toBeVisible();
}

function place(page: Page, name: string): Locator {
  return page.getByRole("article", { name, exact: true });
}

function lines(page: Page, name: string): Locator {
  return place(page, name).locator(".money-line");
}

function table(page: Page): Locator {
  return page.locator(".money-table tr");
}

function period(page: Page, name: string): Locator {
  return page
    .getByRole("group", { name: "Період" })
    .getByRole("button", { name, exact: true });
}

function moneyRow(page: Page, name: string | RegExp): Locator {
  return page
    .getByRole("navigation", { name: "Гроші" })
    .getByRole("button", { name });
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

// --- where the money is now --------------------------------------------------

test("the owner's fourth tab is «Гроші»: each place on its own, a line a store, each figure its read's and never two added up; at 360 × 640 the title, the day and «У касах» without a scroll (S29 acceptance)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await me(page);
  await s29(page);
  await onMoney(page);
  await expect(menu(page).getByRole("button")).toHaveText([
    "Сьогодні",
    "Продаж",
    "Замовлення",
    "Гроші",
    /^Ще( — є що перевірити)?$/,
  ]);
  await expect(
    menu(page).getByRole("button", { name: "Гроші", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  // The day and who, under the title; how old it is beside the label.
  const now = new Date();
  await expect(page.locator(".store-line > p")).toHaveText(
    `${weekdays[now.getDay()] ?? ""}, ${String(now.getDate())} ${months[now.getMonth()] ?? ""} · Власник`,
  );
  await expect(page.locator(".money-head .day-stamp").first()).toHaveText(
    /^наживо · \d\d:\d\d$/,
  );
  await expect(
    page.getByRole("heading", { name: "Гроші", exact: true }),
  ).toBeInViewport();
  await expect(page.locator(".store-line > p")).toBeInViewport();
  await expect(place(page, "У касах")).toBeInViewport({ ratio: 1 });
  // In the drawers: last night's counts, each its close's — never what was
  // to be there; out today, only what left today, not the late record of
  // last night's.
  await expect(lines(page, "У касах")).toHaveText([
    "«Центр»: учора порахували 5 380,00 грн о 20:06",
    "«Ринок»: учора порахували 2 450,00 грн о 20:02",
    "«Ринок» · Кур’єру постачальника 1 040,00 грн · 11:30",
  ]);
  await expect(place(page, "У касах").locator(".money-note")).toHaveText(
    "Сьогоднішня готівка — після вечірнього підрахунку.",
  );
  await expect(place(page, "У касах").locator(".money-subhead")).toHaveText(
    "Видано сьогодні",
  );
  await expect(page.getByText(/9\s999,00|4\s619,00/)).toHaveCount(0);
  // Change brought in is no cash taken out.
  await expect(page.getByText(/Розмін/)).toHaveCount(0);
  await expect(lines(page, "Картка сьогодні · звірте з чеком")).toHaveText([
    "«Центр»: 1 850,00 грн",
    "«Ринок»: 1 200,00 грн",
  ]);
  await expect(lines(page, "Перекази сьогодні")).toHaveText([
    "«Центр»: 2 700,00 грн",
    "«Ринок»: 0,00 грн",
  ]);
  await expect(lines(page, "Вам винні клієнти")).toHaveText([
    "«Центр»: Винні 8 400,00 грн · 4 покупці",
    "«Ринок»: Винні 2 600,00 грн · 2 покупці",
  ]);
  await expect(lines(page, "Ви винні постачальникам")).toHaveText([
    "«Центр»: 38 000,00 грн · 3 накладні",
    "«Ринок»: 9 500,00 грн · 1 накладна",
  ]);
  await expect(page.locator(".money-rule")).toHaveText(
    "Кожне місце окремо — ніколи не складаємо в одну суму.",
  );
  // No sum of two stores, nor of two places, anywhere.
  const text = await page.locator("#root").innerText();
  for (const sum of [
    /7\s830,00/, // the two drawers
    /3\s050,00/, // the two terminals
    /11\s000,00/, // the two stores' customers
    /47\s500,00/, // the two stores' suppliers
    /11\s250,00/, // the two stores' «Разом»
    /6\s250,00/, // «Центр»'s ways
    /4\s550,00/, // «Центр»'s card and transfer
  ])
    expect(text).not.toMatch(sum);
  // What came in today: the ways down, the stores across, «грн» once.
  await expect(period(page, "Сьогодні")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(table(page)).toHaveText([
    "грн«Центр»«Ринок»",
    "Готівка1 700,003 900,00",
    "Картка1 850,001 200,00",
    "Переказ2 700,000,00",
    "Разом6 150,005 100,00",
  ]);
  await expect(page.locator(".money-outside")).toHaveText([
    "Окремо від «Разом» — замовлення: переказ наперед 0,00 грн · накладений платіж 1 200,00 грн («Центр»)",
    "З них внески за борг: «Центр» 500,00 грн",
  ]);
  await expect(moneyRow(page, /./)).toHaveText([
    "Звіт про продажі›",
    "Закриття›",
    "Каса · Центр›",
  ]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  // Two stores: the table itself does not scroll either.
  expect(
    await page
      .locator(".money-table-wrap")
      .evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(0);
  // Each period whole in its way.
  for (const way of await page
    .getByRole("group", { name: "Період" })
    .getByRole("button")
    .all())
    expect(
      await way.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(0);
  for (const cell of await page.locator(".money-table td").all())
    expect(
      await cell.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: "test-results/money.png" });
  await page.screenshot({
    path: "test-results/money-full.png",
    fullPage: true,
  });
});

test("«Ще» › «Гроші» keeps only «Постачальникам» for whoever has the tab: «Каса», the report and «Накладні» are opened from «Гроші»", async ({
  page,
}) => {
  await me(page);
  await s29(page);
  await onMoney(page);
  await menu(page)
    .getByRole("button", { name: /^Ще( — є що перевірити)?$/ })
    .click();
  const more = page.getByRole("navigation", { name: "Ще" });
  await expect(more.locator(".more-group h3")).toContainText(["Гроші"]);
  const group = more
    .locator(".more-group")
    .filter({ has: page.getByRole("heading", { name: "Гроші" }) });
  await expect(group.getByRole("button")).toHaveText([/^Постачальникам/]);
  for (const gone of ["Каса", "Звіт про продажі", "Накладні"])
    await expect(
      more.getByRole("button", { name: gone, exact: true }),
    ).toHaveCount(0);
});

test("each way from «Гроші» comes back with «← Гроші»: «Покупці», «Накладні», «Каса · Центр», «Закриття» — the tab marked on each", async ({
  page,
}) => {
  await me(page);
  await s29(page);
  await onMoney(page);
  const tab = menu(page).getByRole("button", { name: "Гроші", exact: true });
  const back = page.getByRole("button", { name: "Назад до «Гроші»" });
  for (const [open, heading] of [
    [
      place(page, "Вам винні клієнти").getByRole("button", {
        name: "Вам винні клієнти",
      }),
      "Покупці",
    ],
    [
      place(page, "Ви винні постачальникам").getByRole("button", {
        name: "Ви винні постачальникам",
      }),
      "Накладні",
    ],
    [moneyRow(page, "Каса · Центр"), "Каса"],
    [moneyRow(page, "Закриття"), "Закриття"],
  ] as const) {
    await open.click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(back).toHaveText("← Гроші");
    await back.click();
    await expect(
      page.getByRole("heading", { name: "Гроші", exact: true }),
    ).toBeVisible();
    await expect(tab).toBeFocused();
  }
});

/** «Центр» and «Ринок»'s drawers as given, nothing taken out today. */
async function drawers(
  page: Page,
  centreLast: LastClose | null,
  marketLast: LastClose | null,
  closedToday: [boolean, boolean],
): Promise<void> {
  await me(page);
  await report(page, {
    today: [
      [centre, "Центр", centreDay],
      [market, "Ринок", marketDay],
    ],
  });
  await drawer(page, centre, centreLast, closedToday[0]);
  await drawer(page, market, marketLast, closedToday[1]);
  await movements(page, centre, []);
  await movements(page, market, []);
}

test("a count of today says «сьогодні», an older one its day; a drawer still open today, the line about tonight's count", async ({
  page,
}) => {
  await drawers(
    page,
    { id: centreClose, days: 0, closedAt: at(0, 20, 6), counted: "6100.00" },
    { id: marketClose, days: 3, closedAt: at(3, 19, 55), counted: "800.00" },
    [true, false],
  );
  await onMoney(page);
  const day = drawerDay(3);
  await expect(lines(page, "У касах")).toHaveText([
    "«Центр»: сьогодні порахували 6 100,00 грн о 20:06",
    `«Ринок»: ${two(day.getDate())}.${two(day.getMonth() + 1)} порахували 800,00 грн о 19:55`,
  ]);
  // «Ринок» is still open today: its cash of today is not counted yet.
  await expect(place(page, "У касах").locator(".money-note")).toBeVisible();
  await expect(place(page, "У касах").locator(".money-subhead")).toHaveCount(0);
});

test("a drawer never counted says «Каса ще не рахувалась»", async ({
  page,
}) => {
  await drawers(
    page,
    { id: centreClose, days: 0, closedAt: at(0, 20, 6), counted: "6100.00" },
    null,
    [true, false],
  );
  await onMoney(page);
  await expect(lines(page, "У касах")).toHaveText([
    "«Центр»: сьогодні порахували 6 100,00 грн о 20:06",
    "«Ринок»: Каса ще не рахувалась",
  ]);
  await expect(place(page, "У касах").locator(".money-note")).toBeVisible();
});

test("every drawer counted today: no line about tonight's count", async ({
  page,
}) => {
  await drawers(
    page,
    { id: centreClose, days: 0, closedAt: at(0, 20, 6), counted: "100.00" },
    { id: marketClose, days: 0, closedAt: at(0, 20, 1), counted: "200.00" },
    [true, true],
  );
  await onMoney(page);
  await expect(lines(page, "У касах")).toHaveText([
    "«Центр»: сьогодні порахували 100,00 грн о 20:06",
    "«Ринок»: сьогодні порахували 200,00 грн о 20:01",
  ]);
  await expect(place(page, "У касах").locator(".money-note")).toHaveCount(0);
});

test("a place that cannot be read keeps its plate with «Спробувати ще раз», the others stand; read again, it fills", async ({
  page,
}) => {
  await me(page);
  await s29(page);
  let failing = true;
  await page.route(
    `**/api/v1/supplier-invoices/summary?store_id=${centre}`,
    async (route: Route) => {
      if (failing) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL", message: "boom" },
        });
        return;
      }
      await route.fulfill({
        json: { owed: "38000.00", invoices: 3, suppliers: [] },
      });
    },
  );
  await onMoney(page);
  const owing = place(page, "Ви винні постачальникам");
  await expect(owing.locator(".money-line")).toHaveText([
    "«Центр»: не вдалося прочитати",
    "«Ринок»: 9 500,00 грн · 1 накладна",
  ]);
  const retry = owing.getByRole("button", { name: "Спробувати ще раз" });
  await expect(retry).toBeVisible();
  // The others stand, each with its own figures.
  await expect(lines(page, "Вам винні клієнти")).toHaveText([
    "«Центр»: Винні 8 400,00 грн · 4 покупці",
    "«Ринок»: Винні 2 600,00 грн · 2 покупці",
  ]);
  await expect(lines(page, "Картка сьогодні · звірте з чеком")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toHaveCount(1);
  failing = false;
  await retry.click();
  await expect(owing.locator(".money-line")).toHaveText([
    "«Центр»: 38 000,00 грн · 3 накладні",
    "«Ринок»: 9 500,00 грн · 1 накладна",
  ]);
  await expect(retry).toHaveCount(0);
});

test("a place read before whose asking again fails keeps its figures, «дані на …» on it alone", async ({
  page,
}) => {
  await page.clock.install();
  await me(page);
  await s29(page);
  await onMoney(page);
  const owing = place(page, "Ви винні постачальникам");
  const owed = "«Центр»: 38 000,00 грн · 3 накладні";
  await expect(owing.locator(".money-line").first()).toHaveText(owed);
  await expect(owing.locator(".day-stamp")).toHaveCount(0);
  // Away for two minutes; meanwhile «Центр»'s invoices cannot be read.
  await menu(page).getByRole("button", { name: "Продаж", exact: true }).click();
  await page.route(
    `**/api/v1/supplier-invoices/summary?store_id=${centre}`,
    async (route: Route) => {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL", message: "boom" },
      });
    },
  );
  await page.clock.fastForward("02:00");
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  await expect(owing.locator(".day-stamp")).toHaveText(/^дані на \d\d:\d\d/);
  await expect(owing.locator(".money-line").first()).toHaveText(owed);
  await expect(
    owing.getByRole("button", { name: "Спробувати ще раз" }),
  ).toHaveCount(0);
  await expect(
    place(page, "Вам винні клієнти").locator(".day-stamp"),
  ).toHaveCount(0);
});

// --- what came in -----------------------------------------------------------

test("«Вчора», «Тиждень» and «Місяць» ask from the server's own today; «Не вказано» only where a store has any; the report opens on the period chosen, «← Гроші» back to it", async ({
  page,
}) => {
  await me(page);
  await s29(page);
  // The server's today is a Thursday, whatever the phone's is.
  const asked = await report(
    page,
    {
      "2026-10-22": [
        [centre, "Центр", centreDay],
        [market, "Ринок", marketDay],
      ],
      "2026-10-21": [
        [centre, "Центр", { ...centreDay, cash: "4300.00", money: "9400.00" }],
        [market, "Ринок", marketDay],
      ],
      "2026-10-19": [
        [
          centre,
          "Центр",
          {
            cash: "13100.00",
            card: "13650.00",
            transfer: "8150.00",
            money: "34900.00",
          },
        ],
        [
          market,
          "Ринок",
          {
            cash: "9400.00",
            card: "7650.00",
            transfer: "2700.00",
            notStated: "150.00",
            money: "19900.00",
          },
        ],
      ],
      "2026-10-01": [
        [
          centre,
          "Центр",
          {
            cash: "58400.00",
            card: "61900.00",
            transfer: "33350.00",
            money: "153650.00",
          },
        ],
        [
          market,
          "Ринок",
          {
            cash: "33200.00",
            card: "29100.00",
            transfer: "12600.00",
            money: "74900.00",
          },
        ],
      ],
    },
    "2026-10-22",
  );
  await onMoney(page);
  await expect(table(page).nth(1)).toHaveText("Готівка1 700,003 900,00");
  await period(page, "Вчора").click();
  await expect(period(page, "Вчора")).toHaveAttribute("aria-pressed", "true");
  await expect(table(page).nth(1)).toHaveText("Готівка4 300,003 900,00");
  await period(page, "Тиждень").click();
  await expect(table(page)).toHaveText([
    "грн«Центр»«Ринок»",
    "Готівка13 100,009 400,00",
    "Картка13 650,007 650,00",
    "Переказ8 150,002 700,00",
    "Не вказано0,00150,00",
    "Разом34 900,0019 900,00",
  ]);
  await period(page, "Місяць").click();
  await expect(table(page).last()).toHaveText("Разом153 650,0074 900,00");
  // The places of now stay today's, whatever the period.
  await expect(lines(page, "Картка сьогодні · звірте з чеком")).toHaveText([
    "«Центр»: 1 850,00 грн",
    "«Ринок»: 1 200,00 грн",
  ]);
  // Nothing orders brought in this month, and no debt paid: no lines.
  await expect(page.locator(".money-outside")).toHaveCount(0);

  await moneyRow(page, "Звіт про продажі").click();
  await expect(
    page.getByRole("heading", { name: "Звіт про продажі", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".choices[aria-label='Період']")
      .getByRole("button", { name: "Цей місяць" }),
  ).toHaveClass(/\bactive\b/);
  await expect(page.locator("input[type='date']").first()).toHaveValue(
    "2026-10-01",
  );
  await expect(
    menu(page).getByRole("button", { name: "Гроші", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Назад до «Гроші»" }).click();
  await expect(period(page, "Місяць")).toHaveAttribute("aria-pressed", "true");
  await expect(table(page).last()).toHaveText("Разом153 650,0074 900,00");
  // Only the server's days were asked, here and by the report: none of the
  // phone's own clock.
  expect(
    new Set(
      asked.map((search) => {
        const query = new URLSearchParams(search);
        return `${query.get("date_from") ?? "—"}…${query.get("date_to") ?? "—"}`;
      }),
    ),
  ).toEqual(
    new Set([
      "—…—",
      "2026-10-21…2026-10-21",
      "2026-10-19…2026-10-22",
      "2026-10-01…2026-10-22",
    ]),
  );
});

test("«Надійшло»'s periods wait for the server's today", async ({ page }) => {
  await me(page);
  await s29(page);
  let release = (): void => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const early: string[] = [];
  await page.route(/\/api\/v1\/reports\/sales(\?.*)?$/, async (route) => {
    early.push(new URL(route.request().url()).search);
    await held;
    await route.fallback();
  });
  await page.goto(owner());
  await openStore(page, "Центр");
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  for (const name of ["Сьогодні", "Вчора", "Тиждень", "Місяць"])
    await expect(period(page, name)).toBeDisabled();
  await expect(page.locator(".money-table")).toHaveCount(0);
  // Nothing dated is asked before the server has said its today.
  expect(early.length).toBeGreaterThan(0);
  expect(early.filter((search) => search.includes("date_"))).toEqual([]);
  release();
  await expect(period(page, "Тиждень")).toBeEnabled();
  await expect(table(page)).toHaveCount(5);
});

test("a period kept while today's report was forgotten, and it cannot be read again: «Надійшло» says so with «Спробувати ще раз», never waits without end", async ({
  page,
}) => {
  await page.clock.install();
  await me(page);
  await s29(page);
  await onMoney(page);
  await period(page, "Тиждень").click();
  await expect(period(page, "Тиждень")).toHaveAttribute("aria-pressed", "true");
  await expect(table(page)).toHaveCount(5);
  // At the till for longer than a read is kept, the server gone meanwhile.
  await menu(page).getByRole("button", { name: "Продаж", exact: true }).click();
  let failing = true;
  await page.route(/\/api\/v1\/reports\/sales(\?.*)?$/, async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL", message: "boom" },
      });
      return;
    }
    await route.fallback();
  });
  await page.clock.fastForward("31:00");
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  const came = page.getByRole("region", { name: "Надійшло", exact: true });
  const retry = came.getByRole("button", { name: "Спробувати ще раз" });
  await expect(retry).toBeVisible();
  await expect(period(page, "Тиждень")).toHaveAttribute("aria-pressed", "true");
  failing = false;
  await retry.click();
  await expect(table(page)).toHaveCount(5);
  await expect(retry).toHaveCount(0);
});

// --- who sees what ----------------------------------------------------------

test("a store that does not trade is the report's column with its mark, and a line of each place it is read in; three wide columns at 360 scroll in the table alone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await me(page, { withOld: true });
  await s29(page);
  await report(page, {
    today: [
      [
        centre,
        "Центр",
        {
          cash: "1311125400.00",
          card: "1311118650.00",
          transfer: "1310996300.00",
          money: "3933240350.00",
        },
      ],
      [
        market,
        "Ринок",
        {
          cash: "1311088900.00",
          card: "1311104200.00",
          transfer: "1310851750.00",
          money: "3933044850.00",
        },
      ],
      [
        old,
        "Старий",
        { cash: "0.00", card: "0.00", transfer: "0.00", money: "0.00" },
        "ARCHIVED",
      ],
    ],
  });
  // «Центр» and «Ринок» counted today; «Старий» never will be: no line
  // about tonight's count.
  await drawer(
    page,
    centre,
    { id: centreClose, days: 0, closedAt: at(0, 20, 6), counted: "100.00" },
    true,
  );
  await drawer(
    page,
    market,
    { id: marketClose, days: 0, closedAt: at(0, 20, 1), counted: "200.00" },
    true,
  );
  await drawer(page, old, null);
  await movements(page, old, []);
  await debts(page, old, "0.00", 0);
  await suppliers(page, old, "0.00", 0);
  await onMoney(page);
  await expect(table(page).first()).toHaveText(
    "грн«Центр»«Ринок»«Старий» в архіві",
  );
  await expect(lines(page, "У касах").nth(2)).toHaveText(
    "«Старий» в архіві: Каса ще не рахувалась",
  );
  await expect(place(page, "У касах").locator(".money-note")).toHaveCount(0);
  await expect(lines(page, "Вам винні клієнти").nth(2)).toHaveText(
    "«Старий» в архіві: Ніхто не винен",
  );
  await expect(lines(page, "Ви винні постачальникам").nth(2)).toHaveText(
    "«Старий» в архіві: Нічого не винні",
  );
  // Three wide stores — wider than the phone in any font: the table alone
  // scrolls, the page never; scrolled, its last store comes whole into
  // sight.
  const wrap = page.locator(".money-table-wrap");
  expect(
    await wrap.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  const last = page.locator(".money-table thead th").last();
  await wrap.scrollIntoViewIfNeeded();
  await expect(last).not.toBeInViewport({ ratio: 0.99 });
  await wrap.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  // Whole but for a part of a pixel.
  await expect(last).toBeInViewport({ ratio: 0.99 });
});

test("a store of `/me` where this person does not read the report has no line in any place", async ({
  page,
}) => {
  await me(page, {
    edit: (store) => {
      if (store.id === market)
        store.permissions = store.permissions.filter(
          (permission) => permission !== "report:view_financial",
        );
    },
  });
  await s29(page);
  await report(page, { today: [[centre, "Центр", centreDay]] });
  await onMoney(page);
  for (const name of [
    "У касах",
    "Картка сьогодні · звірте з чеком",
    "Перекази сьогодні",
    "Вам винні клієнти",
    "Ви винні постачальникам",
  ])
    await expect(lines(page, name)).toHaveText([/^«Центр»: /]);
  await expect(page.getByText(/«Ринок»/)).toHaveCount(0);
});

test("a manager of one store: one column, and no suppliers' place without «supplier:debt»; a cashier has no «Гроші», «Каса» a tab of their own", async ({
  page,
}) => {
  await me(page, {
    edit: (store) => {
      store.permissions = store.permissions.filter(
        (permission) => permission !== "supplier:debt",
      );
    },
  });
  await s29(page);
  await report(page, { today: [[centre, "Центр", centreDay]] });
  await onMoney(
    page,
    launch(fixture.network_centre_manager_telegram_user_id, "Марко"),
  );
  await expect(table(page).first()).toHaveText("грн«Центр»");
  await expect(lines(page, "У касах")).toHaveText([
    "«Центр»: учора порахували 5 380,00 грн о 20:06",
  ]);
  await expect(place(page, "Ви винні постачальникам")).toHaveCount(0);
  await expect(page.getByText(/«Ринок»/)).toHaveCount(0);

  await page.goto("about:blank");
  await page.goto(
    launch(fixture.network_centre_cashier_telegram_user_id, "Ліда"),
  );
  await expect(menu(page).getByRole("button").first()).toHaveText("Продаж");
  await expect(
    menu(page).getByRole("button", { name: "Гроші", exact: true }),
  ).toHaveCount(0);
  await expect(
    menu(page).getByRole("button", { name: "Каса", exact: true }),
  ).toBeVisible();
});

// --- both themes ------------------------------------------------------------

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
  test(`in the ${name} theme at 360 × 640 every place, the table and the rows read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await me(page);
    await s29(page);
    await onMoney(page, owner(theme));
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    await expect(table(page)).toHaveCount(5);
    for (const part of [
      page.locator(".money-head h2").first(),
      page.locator(".money-head .day-stamp").first(),
      page.locator(".money-place-title").first(),
      page.locator(".money-place-open").first(),
      page.locator(".money-line .money-store").first(),
      page.locator(".money-line .money-said").first(),
      page.locator(".money-note"),
      page.locator(".money-subhead"),
      page.locator(".money-rule"),
      period(page, "Сьогодні"),
      period(page, "Тиждень"),
      page.locator(".money-table thead th").nth(1),
      page.locator(".money-table tbody th").first(),
      page.locator(".money-table tbody td").first(),
      page.locator(".money-total td").first(),
      page.locator(".money-outside").first(),
      moneyRow(page, "Закриття"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `test-results/money-${name}.png`,
      fullPage: true,
    });
  });
