import {
  test,
  expect,
  countTaps,
  grn,
  menu,
  more,
  openStore,
  section,
  storeLine,
} from "./fixtures";
import type { Locator, Page, Request, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The sales report (owner decisions, 2026-10-02): what each store sold and
 * took back, and the money through its till, for today or any days. The
 * owner and managers read it, each for the stores they hold it in, and the
 * stores together when there are several. A sale and its returns are the
 * store's that sold; money is the store's whose till it went through. Since
 * 2026-10-04 the money is split by the way it was paid — «Готівка», «Картка»,
 * «Переказ» — and an order paid off the till stays outside «Разом»
 * (ADR-0012 §B11, §G24).
 *
 * In the stores' own network: the owner reads every store; Ганна holds every
 * right at «Центр», Петро at «Ринок»; Марко manages «Центр», Ліда sells there.
 * Other journeys sell in the same network the same day, so the figures are
 * checked as what these sales added to the report read before them.
 *
 * Since stage 2 (money task list, P1-1): «Гроші»'s periods as one switch,
 * days of one's own in «Інші дні»; one table, a column a store and «Усі
 * разом»; «Моделі» and «Продажі й повернення» each a screen of its own,
 * with a switch of the store. Its layout, by stubbed reads.
 */
interface Fixture {
  network_owner_telegram_user_id: string;
  network_centre_seller_telegram_user_id: string;
  network_market_seller_telegram_user_id: string;
  network_centre_manager_telegram_user_id: string;
  network_centre_cashier_telegram_user_id: string;
  network_centre_store_id: string;
  network_market_store_id: string;
  network_shared_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const owner = fixture.network_owner_telegram_user_id;
const hanna = fixture.network_centre_seller_telegram_user_id;
const petro = fixture.network_market_seller_telegram_user_id;
const marko = fixture.network_centre_manager_telegram_user_id;
const lida = fixture.network_centre_cashier_telegram_user_id;
const centre = fixture.network_centre_store_id;
const market = fixture.network_market_store_id;
const shared = fixture.network_shared_location_id;

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

async function reportAs(
  page: Page,
  telegramUserId: string,
  name = "Тест",
): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId, name) }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await section(page, "Звіт про продажі");
}

async function as(
  page: Page,
  telegramUserId: string,
  name: string,
): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId, name) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

interface Sale {
  id: string;
  items: { id: string }[];
}

type Method = "CASH" | "CARD" | "TRANSFER";

/** `quantity` coats of a new model at 1500, sold by `store` from the shared
 * warehouse, paid `method`; paid in part when `paidNow` is given. */
async function sold(
  page: Page,
  headers: Record<string, string>,
  store: string,
  quantity: number,
  method: Method,
  paidNow?: string,
): Promise<{ model: string; sale: Sale }> {
  const model = `Звіт ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: store,
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
  const line = {
    product_variant_id: product.product_variant_id,
    size_id: product.sizes[0]?.size_id ?? "",
  };
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: store,
      location_id: shared,
      command_id: randomUUID(),
      lines: [
        { ...line, quantity, acquisition_type: "PURCHASE", unit_cost: null },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  const sale = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: store,
      command_id: randomUUID(),
      lines: [
        {
          ...line,
          source_location_id: shared,
          quantity,
          unit_price: "1500.00",
        },
      ],
      payment_method: method,
      ...(paidNow
        ? {
            credit: {
              customer_name: "Ірина Коваль",
              customer_phone: "0671234567",
              paid_now: paidNow,
            },
          }
        : {}),
    },
  });
  expect(sale.status()).toBe(201);
  return { model, sale: (await sale.json()) as Sale };
}

/** One coat of `sale` back at `at`, its money handed back `method`: a return
 * that only lowers a debt is stored with no way (ADR-0012 §G35). */
async function takenBack(
  page: Page,
  headers: Record<string, string>,
  sale: Sale,
  at: string,
  method: Method,
): Promise<void> {
  const refund = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      command_id: randomUUID(),
      store_id: at,
      payment_method: method,
      lines: [
        {
          sale_item_id: sale.items[0]?.id ?? "",
          quantity: 1,
          restock: true,
          condition: "INTACT",
        },
      ],
    },
  });
  expect(refund.status()).toBe(201);
}

type Way = "CASH" | "CARD" | "TRANSFER" | "NOT_STATED";
interface WayFigures {
  method: Way;
  came_in: string;
  went_out: string;
  corrected: string;
  net: string;
}
interface OffTill {
  came_in: string;
  corrected: string;
  net: string;
}
interface Figures {
  sales: number;
  units: number;
  sold: string;
  returns: number;
  returned_units: number;
  returned: string;
  net: string;
  paid_in_full: string;
  debt_payments: string;
  paid_back: string;
  corrected_into_till: string;
  money: string;
  ways: WayFigures[];
  off_till: { prepaid_transfer: OffTill; carrier_cod: OffTill };
}
type Count = "sales" | "units" | "returns" | "returned_units";
type Sum =
  | "sold"
  | "returned"
  | "net"
  | "paid_in_full"
  | "debt_payments"
  | "paid_back"
  | "money";
interface Report {
  today: string;
  stores: (Figures & { store_id: string })[];
}

async function today(page: Page): Promise<Report> {
  const response = await page.request.get("/api/v1/reports/sales", {
    headers: await as(page, owner, "Тест"),
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Report;
}

function of(report: Report, store: string): Figures {
  const found = report.stores.find((each) => each.store_id === store);
  if (!found) throw new Error(`no figures for ${store}`);
  return found;
}

function kopecks(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = "00"] = value.replace("-", "").split(".");
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -amount : amount;
}

// As the table writes it, «грн» said once in its corner: «3 000,00»,
// «−1 500,00».
function figure(amount: bigint): string {
  const sign = amount < 0n ? "−" : "";
  const size = amount < 0n ? -amount : amount;
  return `${sign}${grn(`${(size / 100n).toString()}.${(size % 100n).toString().padStart(2, "0")}`)}`.replace(
    /\u00a0грн$/,
    "",
  );
}

const wayLabels: Record<Way, string> = {
  CASH: "Готівка",
  CARD: "Картка",
  TRANSFER: "Переказ",
  NOT_STATED: "Не вказано",
};

// What these journeys add: counts and sums, and each till way's money in and
// out.
type Added = Partial<Record<Count | Sum, number>> & {
  ways?: Partial<Record<Way, { came_in?: number; went_out?: number }>>;
};

/** What a store's column reads once `added` is added to `before`, row by
 * row: «Продажі» and «Повернення» with what they count under the sum. «Не
 * вказано» and a correction across the till are asked only where this
 * store has them: their rows stand where any store has them. */
function expected(before: Figures, added: Added): [string, string][] {
  const count = (name: Count): number => before[name] + (added[name] ?? 0);
  const sum = (name: Sum): bigint =>
    kopecks(before[name]) + BigInt((added[name] ?? 0) * 100);
  const out = (amount: bigint): string =>
    amount === 0n ? figure(0n) : figure(-amount);
  const into = kopecks(before.corrected_into_till);
  const ways = before.ways.flatMap((way): [string, string][] => {
    const more = added.ways?.[way.method] ?? {};
    const came = kopecks(way.came_in) + BigInt((more.came_in ?? 0) * 100);
    const went = kopecks(way.went_out) + BigInt((more.went_out ?? 0) * 100);
    const corrected = kopecks(way.corrected);
    const held = came !== 0n || went !== 0n || corrected !== 0n;
    return way.method !== "NOT_STATED" || held
      ? [[wayLabels[way.method], figure(came - went + corrected)]]
      : [];
  });
  return [
    [
      "Продажі",
      `${figure(sum("sold"))}${String(count("sales"))} · ${String(count("units"))} шт.`,
    ],
    [
      "Повернення",
      `${out(sum("returned"))}${String(count("returns"))} · ${String(count("returned_units"))} шт.`,
    ],
    ["З урахуванням повернень", figure(sum("net"))],
    ["Оплачено одразу повністю", figure(sum("paid_in_full"))],
    ["Внески за борг", figure(sum("debt_payments"))],
    ["Віддано при поверненнях", out(sum("paid_back"))],
    ...(into === 0n
      ? []
      : ([
          [
            "Виправлення способу оплати",
            into > 0n ? `+${figure(into)}` : figure(into),
          ],
        ] as [string, string][])),
    ["Разом", figure(sum("money"))],
    ...ways,
  ];
}

const table = (page: Page): Locator => page.locator(".report-table");

/** The column of a store, by its name in the head: «Центр». */
async function columnOf(page: Page, name: string): Promise<number> {
  await expect(table(page)).toBeVisible();
  const heads = await table(page).locator("thead th").allTextContents();
  const at = heads.findIndex(
    (head) => head === name || head.startsWith(`«${name}»`),
  );
  expect(at, `${name} among ${heads.join(", ")}`).toBeGreaterThanOrEqual(0);
  return at;
}

/** A row's cell in a column. */
function cell(page: Page, row: string, column: number): Locator {
  return table(page)
    .locator("tbody tr")
    .filter({
      has: page.locator("th[scope='row']", {
        hasText: new RegExp(`^${row}$`),
      }),
    })
    .locator("td")
    .nth(column);
}

async function readsAs(
  page: Page,
  name: string,
  rows: [string, string][],
): Promise<void> {
  const column = await columnOf(page, name);
  for (const [row, text] of rows)
    await expect(cell(page, row, column), row).toHaveText(text);
}

/** «Моделі ›», «Продажі й повернення ›»: the report's own screens. */
async function toScreen(
  page: Page,
  name: "Моделі" | "Продажі й повернення",
): Promise<void> {
  await page
    .getByRole("navigation", { name: "Звіт про продажі" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeFocused();
}

async function backToReport(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Назад до «Звіт про продажі»" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Звіт про продажі", exact: true }),
  ).toBeVisible();
}

const stores = (page: Page): Locator =>
  page.getByRole("group", { name: "Магазин", exact: true });

const periods = (page: Page): Locator =>
  page.getByRole("group", { name: "Період", exact: true });

test("the owner reads each store, the stores together, and the money through each till, in one table (stage 2, money task list, P1-1)", async ({
  page,
}) => {
  const before = await today(page);
  const fromHanna = await as(page, hanna, "Ганна");
  const fromPetro = await as(page, petro, "Петро");
  // «Центр» sells two coats paid in full by card and takes one back, its
  // money going back to the card, and one coat by transfer.
  const atCentre = await sold(page, fromHanna, centre, 2, "CARD");
  await takenBack(page, fromHanna, atCentre.sale, centre, "CARD");
  await sold(page, fromHanna, centre, 1, "TRANSFER");
  // «Ринок» sells two in parts, 500 paid in cash; «Центр» takes one back.
  // The 1500 the other is worth is more than was paid, so the return only
  // lowers the debt and hands nothing back.
  const atMarket = await sold(page, fromPetro, market, 2, "CASH", "500.00");
  await takenBack(page, fromHanna, atMarket.sale, centre, "CASH");

  await reportAs(page, owner);

  await expect(
    periods(page).getByRole("button", { name: "Сьогодні" }),
  ).toHaveAttribute("aria-pressed", "true");
  // A card returned to the card leaves the cash as it was.
  await readsAs(
    page,
    "Центр",
    expected(of(before, centre), {
      sales: 2,
      units: 3,
      sold: 4500,
      returns: 1,
      returned_units: 1,
      returned: 1500,
      net: 3000,
      paid_in_full: 4500,
      paid_back: 1500,
      money: 3000,
      ways: {
        CARD: { came_in: 3000, went_out: 1500 },
        TRANSFER: { came_in: 1500 },
      },
    }),
  );
  // The coat came back at «Центр», yet the sale and its return are
  // «Ринок»'s; «Ринок»'s till kept the 500 it took, in cash.
  await readsAs(
    page,
    "Ринок",
    expected(of(before, market), {
      sales: 1,
      units: 2,
      sold: 3000,
      returns: 1,
      returned_units: 1,
      returned: 1500,
      net: 1500,
      debt_payments: 500,
      money: 500,
      ways: { CASH: { came_in: 500 } },
    }),
  );
  await expect(
    table(page)
      .locator("thead th")
      .nth(await columnOf(page, "Старий")),
  ).toContainText("в архіві");
  // The stores together are the server's own column, its last.
  await expect(table(page).locator("thead th").last()).toHaveText("Усі разом");
  // «Гроші», not «Гроші в касі»: card and transfer are in it (§G24).
  await expect(table(page).locator(".report-section")).toContainText([
    "Продажі",
    "Гроші",
    "За способом оплати",
  ]);

  // Every store's sales at first, each named by its store.
  await toScreen(page, "Продажі й повернення");
  const entries = page.getByRole("list", { name: "Продажі й повернення" });
  await expect(
    entries
      .getByRole("listitem")
      .filter({ hasText: atMarket.model })
      .filter({ hasText: "Продаж 3 000,00 грн" }),
  ).toContainText("частинами, внесено 500,00 грн готівкою · «Ринок»");
  await stores(page).getByRole("button", { name: "«Центр»" }).click();
  await expect(
    stores(page).getByRole("button", { name: "«Центр»" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    entries.getByRole("listitem").filter({ hasText: atMarket.model }),
  ).toContainText("лише зменшило борг · продав «Ринок», прийняв «Центр»");
  const sale = entries
    .getByRole("listitem")
    .filter({ hasText: atCentre.model })
    .filter({ hasText: "Продаж 3 000,00 грн" });
  await expect(sale).toContainText("Ганна");
  await expect(sale).toContainText("оплачено повністю карткою");
  await expect(sale).not.toContainText("«Центр»");
  await expect(
    entries
      .getByRole("listitem")
      .filter({ hasText: atCentre.model })
      .filter({ hasText: "Повернення −1 500,00 грн" }),
  ).toContainText("віддано 1 500,00 грн на картку");

  // Back, «Моделі ›» opens on the store chosen.
  await backToReport(page);
  await expect(
    page.getByRole("button", { name: "Продажі й повернення", exact: true }),
  ).toBeFocused();
  await toScreen(page, "Моделі");
  await expect(
    stores(page).getByRole("button", { name: "«Центр»" }),
  ).toHaveAttribute("aria-pressed", "true");
  const models = page.getByRole("list", { name: "Моделі" });
  // «Ринок» sold that model: it is not among «Центр»'s.
  await expect(
    models.getByRole("listitem").filter({ hasText: atCentre.model }),
  ).toHaveText(
    `${atCentre.model} графіт2 шт. · повернено 1 шт. на 1 500,00 грн3 000,00 грн`,
  );
  await expect(models).not.toContainText(atMarket.model);
  await stores(page).getByRole("button", { name: "Усі", exact: true }).click();
  await expect(
    models.getByRole("listitem").filter({ hasText: atMarket.model }),
  ).toContainText("2 шт. · повернено 1 шт. на 1 500,00 грн");
});

test("a manager reads their store alone, with no store to choose; a seller has no report", async ({
  page,
}) => {
  await reportAs(page, marko);
  await expect(table(page).locator("thead th")).toHaveText(["«Центр»"]);
  await toScreen(page, "Моделі");
  await expect(stores(page)).toHaveCount(0);
  await backToReport(page);
  await toScreen(page, "Продажі й повернення");
  await expect(stores(page)).toHaveCount(0);

  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(lida, "Ліда") }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeVisible();
  await more(page);
  await expect(
    page.getByRole("button", { name: "Звіт про продажі", exact: true }),
  ).toHaveCount(0);
});

test("«Сьогодні», «Вчора», «Тиждень» and «Місяць» as on «Гроші», from the server's today; days of one's own in «Інші дні», refused when they make no period", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request: Request) => {
    if (request.url().includes("/api/v1/reports/sales?"))
      asked.push(new URL(request.url()).search);
  });
  const { today: day } = await today(page);
  const now = new Date(`${day}T00:00:00Z`);
  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  const short = (value: string): string =>
    value.slice(0, 4) === day.slice(0, 4)
      ? `${value.slice(8, 10)}.${value.slice(5, 7)}`
      : `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
  const days = (from: string, to: string): string =>
    from === to ? short(from) : `${short(from)} – ${short(to)}`;
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const first = `${day.slice(0, 8)}01`;

  await reportAs(page, owner);
  const period = (name: string): Locator =>
    periods(page).getByRole("button", { name, exact: true });
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "true");
  await expect(storeLine(page)).toHaveText(`Сьогодні · ${short(day)} · Тест`);

  await period("Вчора").click();
  await expect(period("Вчора")).toHaveAttribute("aria-pressed", "true");
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "false");
  await expect(storeLine(page)).toHaveText(
    `Вчора · ${short(iso(yesterday))} · Тест`,
  );
  await expect
    .poll(() => asked.at(-1))
    .toBe(`?date_from=${iso(yesterday)}&date_to=${iso(yesterday)}`);
  await period("Тиждень").click();
  await expect
    .poll(() => asked.at(-1))
    .toBe(`?date_from=${iso(monday)}&date_to=${day}`);
  await expect(storeLine(page)).toHaveText(
    `Тиждень · ${days(iso(monday), day)} · Тест`,
  );
  await period("Місяць").click();
  await expect
    .poll(() => asked.at(-1))
    .toBe(`?date_from=${first}&date_to=${day}`);
  await expect(storeLine(page)).toHaveText(
    `Місяць · ${days(first, day)} · Тест`,
  );

  // Days of one's own: in a sheet, shown once «Показати» is pressed.
  await page.getByRole("button", { name: "Інші дні", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Інші дні" });
  // A tap carried from the one that opened it is let go: ready first.
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(sheet.getByLabel("Від")).toHaveValue(first);
  await sheet.getByLabel("Від").fill("2026-03-09");
  await sheet.getByLabel("До", { exact: true }).fill("2026-03-10");
  expect(asked.at(-1)).toBe(`?date_from=${first}&date_to=${day}`);
  await sheet.getByRole("button", { name: "Показати", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect
    .poll(() => asked.at(-1))
    .toBe("?date_from=2026-03-09&date_to=2026-03-10");
  await expect(storeLine(page)).toHaveText(
    `${days("2026-03-09", "2026-03-10")} · Тест`,
  );
  // None of «Гроші»'s periods is these days.
  for (const name of ["Сьогодні", "Вчора", "Тиждень", "Місяць"])
    await expect(period(name)).toHaveAttribute("aria-pressed", "false");
  const change = page.getByRole("button", {
    name: `${days("2026-03-09", "2026-03-10")} · Змінити`,
  });
  await expect(change).toBeVisible();

  // The last day before the first is refused, in the server's words.
  await change.click();
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(sheet.getByLabel("До", { exact: true })).toHaveValue(
    "2026-03-10",
  );
  await sheet.getByLabel("Від").fill("2026-03-11");
  await sheet.getByRole("button", { name: "Показати", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Оберіть період від одного дня до року; перший день — не пізніше останнього.",
  );
  await expect(
    page.getByRole("button", { name: "Моделі", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toHaveCount(0);
  await period("Сьогодні").click();
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Інші дні", exact: true }),
  ).toBeVisible();
  await expect(table(page)).toBeVisible();

  // Days of another year carry it.
  await page.getByRole("button", { name: "Інші дні", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByLabel("Від").fill("2025-12-30");
  await sheet.getByLabel("До", { exact: true }).fill("2026-01-02");
  await sheet.getByRole("button", { name: "Показати", exact: true }).click();
  await expect(storeLine(page)).toHaveText(
    `${days("2025-12-30", "2026-01-02")} · Тест`,
  );
  expect(days("2025-12-30", "2026-01-02")).toMatch(/^30\.12\.2025 – /);
});

// --- the report's screens, by stubbed reads ---------------------------------

/** A store's figures, its sums as given. */
function figures(sold: string, money: string): Figures {
  const way = (method: Way, net: string): WayFigures => ({
    method,
    came_in: net,
    went_out: "0.00",
    corrected: "0.00",
    net,
  });
  const none = { came_in: "0.00", corrected: "0.00", net: "0.00" };
  return {
    sales: 12,
    units: 15,
    sold,
    returns: 1,
    returned_units: 1,
    returned: "1850.00",
    net: sold,
    paid_in_full: money,
    debt_payments: "0.00",
    paid_back: "1850.00",
    corrected_into_till: "0.00",
    money,
    ways: [
      way("CASH", money),
      way("CARD", "0.00"),
      way("TRANSFER", "0.00"),
      way("NOT_STATED", "0.00"),
    ],
    off_till: { prepaid_transfer: none, carrier_cod: none },
  };
}

/** The report of today, `serverToday`, as the stores given; their sums
 * the server's own, «Усі разом» a sum no phone would make. */
async function stubReport(
  page: Page,
  names: string[],
  serverToday = "2026-11-05",
  shape: (figures: Figures, at: number) => Figures = (figures) => figures,
): Promise<void> {
  await page.route(
    /\/api\/v1\/reports\/sales(\?.*)?$/,
    async (route: Route) => {
      const url = new URL(route.request().url());
      const from = url.searchParams.get("date_from") ?? serverToday;
      const to = url.searchParams.get("date_to") ?? serverToday;
      await route.fulfill({
        json: {
          date_from: from,
          date_to: to,
          today: serverToday,
          currency_code: "UAH",
          stores: names.map((name, at) => ({
            store_id: `00000000-0000-4000-8000-00000000000${String(at + 1)}`,
            store_name: name,
            store_state: "ACTIVE",
            ...shape(
              figures(
                `${String(13100 + at * 1000)}.00`,
                `${String(11250 + at * 1000)}.00`,
              ),
              at,
            ),
          })),
          total: names.length > 1 ? figures("99999.00", "88888.00") : null,
        },
      });
    },
  );
}

test("at 390 × 844 with two stores the switch, «ПРОДАЖІ» and «ГРОШІ» are seen without a scroll; a week three taps from «Гроші», one store's yesterday five, its row a scroll down; no list to pick from, one line that explains", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubReport(page, ["Центр", "Ринок"]);
  await page.route(
    "**/api/v1/reports/sales/entries?**",
    async (route: Route) => {
      await route.fulfill({
        json: {
          date_from: "2026-11-04",
          date_to: "2026-11-04",
          today: "2026-11-05",
          entries: [],
          has_more: false,
        },
      });
    },
  );
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(owner, "Тест") }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Гроші", exact: true }),
  ).toBeVisible();
  const taps = await countTaps(page);
  await page
    .getByRole("navigation", { name: "Гроші" })
    .getByRole("button", { name: "Звіт про продажі" })
    .click();
  await periods(page).getByRole("button", { name: "Тиждень" }).click();
  await expect(storeLine(page)).toHaveText("Тиждень · 02.11 – 05.11 · Тест");
  // «Гроші»'s tab, the report's row, «Тиждень».
  expect((await taps()) + 1).toBe(3);

  // Under the menu nothing is read: the switch, «ПРОДАЖІ» and «ГРОШІ»
  // whole above it.
  const fold = (await menu(page).boundingBox())?.y ?? 844;
  const total = table(page)
    .locator("tbody tr")
    .filter({ has: page.locator("th[scope='row']", { hasText: /^Разом$/ }) });
  for (const part of [periods(page), total])
    expect(
      ((await part.boundingBox())?.y ?? 9999) +
        ((await part.boundingBox())?.height ?? 0),
    ).toBeLessThanOrEqual(fold);
  await expect(table(page).locator("thead th")).toHaveText([
    "«Центр»",
    "«Ринок»",
    "Усі разом",
  ]);
  // «Усі разом» is the server's, never the stores' sum.
  await expect(cell(page, "Продажі", 2)).toHaveText("99 999,0012 · 15 шт.");
  await expect(cell(page, "Разом", 2)).toHaveText("88 888,00");
  await expect(cell(page, "Повернення", 0)).toHaveText("−1 850,001 · 1 шт.");
  await expect(cell(page, "Віддано при поверненнях", 1)).toHaveText(
    "−1 850,00",
  );
  // No store has money of no way, a correction or an order's: none of
  // their rows.
  await expect(
    table(page).locator("tbody").nth(2).locator("th[scope='row']"),
  ).toHaveText(["Готівка", "Картка", "Переказ"]);
  await expect(table(page).locator(".report-section")).toHaveText([
    "Продажі",
    "Гроші",
    "За способом оплати",
  ]);
  await expect(page.locator(".report-note")).toHaveCount(0);
  // Where the table fits, no room is left after it: nothing to scroll.
  expect(
    await page.locator(".report-table-wrap").evaluate((node) => {
      const wide =
        (node.querySelector("table")?.offsetWidth ?? 0) > node.clientWidth;
      return wide ? 0 : node.scrollWidth - node.clientWidth;
    }),
  ).toBe(0);
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.locator(".hint")).toHaveCount(0);
  await page.screenshot({ path: "test-results/report-390.png" });

  // One store's sales yesterday: «Вчора», its row, its store. The rows
  // stand under the table, as the task list draws them: at 844 with two
  // stores, one scroll down (the report says so; owner's question).
  await periods(page).getByRole("button", { name: "Вчора" }).click();
  await expect(storeLine(page)).toHaveText("Вчора · 04.11 · Тест");
  await page
    .getByRole("button", { name: "Продажі й повернення", exact: true })
    .click();
  await stores(page).getByRole("button", { name: "«Ринок»" }).click();
  await expect(page.getByText("Ні продажів, ні повернень.")).toBeVisible();
  // «Гроші», the report's row, «Вчора», its row, its store — «Тиждень»
  // above was another way.
  expect((await taps()) + 1 - 1).toBe(5);
  // Its own screen opens at its top.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // How it counts: a row, its sentences in a sheet.
  await backToReport(page);
  await page.getByRole("button", { name: "Як рахуємо", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Як рахуємо" })).toHaveText(
    "Як рахуємоПродажі й повернення рахуються магазину, який продав, гроші — магазину, через чию касу пройшли. Повернення — у день, коли його прийняли, виправлення способу оплати — у день, коли його записали.",
  );
});

/** The owner's report opened as Бірка opens, in a theme if one is given. */
async function ownReport(
  page: Page,
  theme?: Record<string, string>,
): Promise<void> {
  const hash = new URLSearchParams({ tgWebAppData: initData(owner, "Тест") });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  await page.goto("about:blank");
  await page.goto(`/#${hash.toString()}`);
  await openStore(page, "Центр CENTRE");
  await section(page, "Звіт про продажі");
  await expect(table(page)).toBeVisible();
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
  test(`in the ${name} theme at 360 px, three stores: the table alone scrolls, its first column in view, and it reads at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    // «Вокзал» took 150,00 of no way, moved 350,00 paid ahead into the
    // till, and an order brought 500,00 paid ahead.
    await stubReport(
      page,
      ["Центр", "Ринок", "Вокзал"],
      "2026-11-05",
      (figures, at) =>
        at !== 2
          ? figures
          : {
              ...figures,
              corrected_into_till: "350.00",
              ways: figures.ways.map((way) =>
                way.method === "NOT_STATED"
                  ? { ...way, came_in: "150.00", net: "150.00" }
                  : way.method === "CASH"
                    ? { ...way, corrected: "350.00" }
                    : way,
              ),
              off_till: {
                ...figures.off_till,
                prepaid_transfer: {
                  came_in: "500.00",
                  corrected: "-350.00",
                  net: "150.00",
                },
              },
            },
    );
    await ownReport(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    await expect(table(page).locator("thead th")).toHaveText([
      "«Центр»",
      "«Ринок»",
      "«Вокзал»",
      "Усі разом",
    ]);
    // Rows only «Вокзал» has: they stand, «0,00» in the others.
    await expect(cell(page, "Не вказано", 2)).toHaveText("150,00");
    await expect(cell(page, "Не вказано", 0)).toHaveText("0,00");
    await expect(cell(page, "Виправлення способу оплати", 2)).toHaveText(
      "+350,00",
    );
    await expect(cell(page, "Виправлення способу оплати", 0)).toHaveText(
      "0,00",
    );
    await expect(table(page).locator(".report-section").last()).toHaveText(
      "Окремо від «Разом» — замовлення",
    );
    await expect(
      table(page).locator("tbody").last().locator("th[scope='row']"),
    ).toHaveText(["Переказ наперед"]);
    await expect(cell(page, "Переказ наперед", 2)).toHaveText("150,00");
    await expect(page.locator(".report-note")).toHaveText([
      "Виправлення способу оплати: переказ наперед −350,00 грн, готівка +350,00 грн («Вокзал»)",
    ]);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    const wrap = page.locator(".report-table-wrap");
    expect(
      await wrap.evaluate((node) => node.scrollWidth > node.clientWidth),
    ).toBe(true);
    for (const part of [
      periods(page).getByRole("button", { name: "Сьогодні" }),
      periods(page).getByRole("button", { name: "Тиждень" }),
      page.getByRole("button", { name: "Інші дні", exact: true }),
      table(page).locator("thead th").first(),
      table(page).locator(".report-section .t-label").first(),
      table(page).locator("tbody th[scope='row']").first(),
      table(page).locator("tbody td").first(),
      table(page).locator(".report-meta").first(),
      table(page).locator(".money-total td").first(),
      page.getByRole("button", { name: "Моделі", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `test-results/report-${name}.png`,
      fullPage: true,
    });
    // Scrolled to «Усі разом», the rows' words stay where they were.
    const label = table(page).locator("tbody th[scope='row']").first();
    const at = (await label.boundingBox())?.x ?? -1;
    await wrap.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await expect
      .poll(() => wrap.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/report-${name}-scrolled.png` });
    expect((await label.boundingBox())?.x).toBe(at);
    const last = await table(page).locator("thead th").last().boundingBox();
    expect((last?.x ?? 999) + (last?.width ?? 0)).toBeLessThanOrEqual(360);
    // It stops on a whole column beside the rows' words: none half under
    // them.
    expect(Math.abs((last?.x ?? 0) - (at + 118))).toBeLessThanOrEqual(1);
    expect(await contrast(label)).toBeGreaterThanOrEqual(4.5);
    // Each section's name whole in view, «Окремо від «Разом» —
    // замовлення» too: never cut to «РАЗОМ» — ЗАМОВЛЕННЯ».
    const names = table(page).locator(".report-section .t-label");
    await expect(names).toHaveCount(4);
    for (const section of await names.all()) {
      const box = await section.boundingBox();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(at - 1);
      expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(360);
    }
    const end = await wrap.evaluate((node) => node.scrollLeft);

    // Three stores: a switch of four.
    await toScreen(page, "Моделі");
    await expect(stores(page).locator("button")).toHaveText([
      "Усі",
      "«Центр»",
      "«Ринок»",
      "«Вокзал»",
    ]);
    await expect(page.locator(".report-stores")).toBeVisible();
    // Back, the stores scrolled as they were left.
    await backToReport(page);
    await expect(table(page)).toBeVisible();
    expect(await wrap.evaluate((node) => node.scrollLeft)).toBe(end);
    // Four: a row of chips that scrolls alone.
    await stubReport(page, ["Центр", "Ринок", "Вокзал", "Поділ"]);
    await page.getByRole("button", { name: "Оновити", exact: true }).click();
    await expect(table(page).locator("thead th")).toHaveCount(5);
    await toScreen(page, "Моделі");
    await expect(stores(page).locator(".chip")).toHaveText([
      "Усі",
      "«Центр»",
      "«Ринок»",
      "«Вокзал»",
      "«Поділ»",
    ]);
    await expect(page.locator(".report-stores")).toHaveCount(0);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
  });

/** An entry of the report's list, as the server answers it. */
function entry(
  id: number,
  kind: "SALE" | "RETURN",
  at: string,
  more: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind,
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    sale_id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    at,
    store_id: "00000000-0000-4000-8000-000000000001",
    store_name: "Центр",
    taken_at_store_id: null,
    taken_at_store_name: null,
    by: "Оля",
    units: 1,
    amount: "1850.00",
    money: "1850.00",
    payment_method: "CASH",
    method_now: null,
    paid_in_parts: false,
    goods: ["Кокон графіт, M"],
    outage: null,
    ...more,
  };
}

test("«Продажі й повернення»: a thread by day, the newest first, the day said once; the paper it was typed from; «Показати ще» a page at a time, an entry never twice; «Моделі» and nothing sold", async ({
  page,
}) => {
  await stubReport(page, ["Центр", "Ринок"]);
  const evening = new Date(2026, 10, 5, 20, 5).toISOString();
  const noon = new Date(2026, 10, 5, 12, 0).toISOString();
  const before = new Date(2026, 10, 4, 18, 30).toISOString();
  const offsets: string[] = [];
  let failed = false;
  await page.route(
    "**/api/v1/reports/sales/entries?**",
    async (route: Route) => {
      const url = new URL(route.request().url());
      const offset = url.searchParams.get("offset") ?? "";
      offsets.push(`${url.searchParams.get("store_id") ?? "—"}:${offset}`);
      // The next page fails once.
      if (offset === "50" && !failed) {
        failed = true;
        await route.fulfill({
          status: 500,
          json: { detail: "Internal Server Error" },
        });
        return;
      }
      await route.fulfill({
        json: {
          date_from: "2026-11-05",
          date_to: "2026-11-05",
          today: "2026-11-05",
          entries:
            offset === "0"
              ? [
                  entry(1, "SALE", evening),
                  entry(2, "RETURN", noon, { money: "1850.00" }),
                ]
              : [
                  // Read again as the next page came: shown once.
                  entry(2, "RETURN", noon, { money: "1850.00" }),
                  entry(3, "SALE", before, {
                    by: "Ліда",
                    outage: { sold_by: "Ганна", sold_at: "2026-11-04T19:40" },
                  }),
                  // Days of one's own may reach into another year.
                  entry(4, "SALE", new Date(2025, 11, 31, 10, 0).toISOString()),
                ],
          has_more: offset === "0",
        },
      });
    },
  );
  await page.route(
    /\/api\/v1\/reports\/sales\/models(\?.*)?$/,
    async (route: Route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        json: {
          date_from: "2026-11-05",
          date_to: "2026-11-05",
          today: "2026-11-05",
          models: url.searchParams.has("store_id")
            ? []
            : [
                {
                  product_variant_id: "00000000-0000-4000-8000-000000000101",
                  display_name: "Кокон графіт",
                  units: 15,
                  sold: "27750.00",
                  returned_units: 1,
                  returned: "1850.00",
                },
              ],
        },
      });
    },
  );
  await ownReport(page);

  await toScreen(page, "Продажі й повернення");
  await expect(storeLine(page)).toContainText("Сьогодні · 05.11 · ");
  const thread = page.getByRole("list", { name: "Продажі й повернення" });
  await expect(thread.getByRole("listitem")).toHaveCount(2);
  await expect(thread.getByRole("listitem").first()).toHaveText(
    "05.11Продаж 1 850,00 грн20:05 · Оля · Кокон графіт, Mоплачено повністю готівкою · «Центр»",
  );
  // The day once, at its first entry; a reader hears it at each.
  await expect(thread.locator(".timeline-day").nth(1)).toHaveText("05.11");
  await expect(
    thread.locator(".timeline-day").nth(1).locator(".visually-hidden"),
  ).toHaveCount(1);
  await expect(thread.getByRole("listitem").nth(1)).toContainText(
    "Повернення −1 850,00 грн12:00 · Оля · Кокон графіт, M",
  );
  await page.getByRole("button", { name: "Показати ще", exact: true }).click();
  // The page failed: asked again by its own retry, one button, not two.
  const retry = page.getByRole("button", { name: "Спробувати ще раз" });
  await expect(retry).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Показати ще", exact: true }),
  ).toHaveCount(0);
  await expect(thread.getByRole("listitem")).toHaveCount(2);
  await retry.click();
  await expect(thread.getByRole("listitem")).toHaveCount(4);
  await expect(retry).toHaveCount(0);
  expect(offsets).toEqual(["—:0", "—:50", "—:50"]);
  // A day of another year than the server's today: its year under it.
  const old = thread.getByRole("listitem").last();
  await expect(old.locator(".timeline-day")).toHaveText("31.12 2025");
  await expect(old.locator(".timeline-year")).toHaveText("2025");
  const typed = thread.getByRole("listitem").nth(2);
  await expect(typed).toContainText("04.11Продаж 1 850,00 грн18:30 · Ліда");
  // Another day: its first entry says it.
  await expect(typed.locator(".timeline-day .visually-hidden")).toHaveCount(0);
  await expect(typed.locator(".paper-meta")).toHaveText(
    /^Продано під час збою · продавець: Ганна · за папером .*19:40 · внесено: Ліда$/,
  );
  await expect(
    page.getByRole("button", { name: "Показати ще", exact: true }),
  ).toHaveCount(0);
  // One store's: its own pages from the first, nothing said of whose.
  await stores(page).getByRole("button", { name: "«Центр»" }).click();
  await expect
    .poll(() => offsets.at(-1))
    .toBe("00000000-0000-4000-8000-000000000001:0");
  await expect(thread.getByRole("listitem").first()).toHaveText(
    "05.11Продаж 1 850,00 грн20:05 · Оля · Кокон графіт, Mоплачено повністю готівкою",
  );

  await backToReport(page);
  await toScreen(page, "Моделі");
  // The store chosen there is kept here.
  await expect(
    stores(page).getByRole("button", { name: "«Центр»" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Нічого не продано.")).toBeVisible();
  await stores(page).getByRole("button", { name: "Усі", exact: true }).click();
  await expect(
    page.getByRole("list", { name: "Моделі" }).getByRole("listitem"),
  ).toHaveText([
    "Кокон графіт15 шт. · повернено 1 шт. на 1 850,00 грн27 750,00 грн",
  ]);
  // Telegram's «Назад» is the screen's own: back to the report, its row in
  // hand.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Моделі", exact: true }),
  ).toBeFocused();

  // Read again and failed: the rows read stand, and it is said.
  await page.route(
    /\/api\/v1\/reports\/sales\/models(\?.*)?$/,
    async (route: Route) => {
      await route.fulfill({
        status: 500,
        json: { detail: "Internal Server Error" },
      });
    },
  );
  await toScreen(page, "Моделі");
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Моделі" }).getByRole("listitem"),
  ).toHaveCount(1);
});

/** Every read of the report answered — «Оновити» free again: none comes
 * after the clock moves. */
async function settled(page: Page): Promise<void> {
  await expect(table(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Оновити", exact: true }),
  ).toBeEnabled();
}

test("how old the report is is said only while today is in it, and only once older than five minutes", async ({
  page,
}) => {
  await page.clock.install();
  await stubReport(page, ["Центр", "Ринок"]);
  await ownReport(page);
  const stamp = page.locator(".report .day-stamp");
  await expect(stamp).toHaveCount(0);
  await settled(page);
  await page.clock.fastForward("06:00");
  await expect(stamp).toHaveText(/^дані на \d\d:\d\d$/);
  // Days gone by do not change (business rules): never said to be old.
  await periods(page).getByRole("button", { name: "Вчора" }).click();
  await expect(storeLine(page)).toContainText("Вчора · 04.11 · ");
  await settled(page);
  await page.clock.fastForward("06:00");
  await expect(table(page)).toBeVisible();
  await expect(stamp).toHaveCount(0);
  await periods(page).getByRole("button", { name: "Тиждень" }).click();
  // Its days answered before the clock moves: an answer that came after
  // would be new.
  await settled(page);
  await page.clock.fastForward("06:00");
  await expect(stamp).toHaveText(/^дані на \d\d:\d\d$/);
});

/** «Гроші» of the open store, as Бірка opens. */
async function ownMoney(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(owner, "Тест") }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Гроші", exact: true }),
  ).toBeVisible();
}

test("on a Monday «Тиждень» is today alone and stays «Тиждень», on the 1st «Місяць» stays «Місяць»; opened on «Гроші»'s period and read again; «Сьогодні» needs no day said; a re-read that fails is said", async ({
  page,
}) => {
  const period = (name: string): Locator =>
    periods(page).getByRole("button", { name, exact: true });
  const asked: string[] = [];
  page.on("request", (request: Request) => {
    if (request.url().includes("/api/v1/reports/sales?"))
      asked.push(new URL(request.url()).search);
  });
  // The server's today a Monday: the week is that day alone.
  await stubReport(page, ["Центр", "Ринок"], "2026-11-09");
  await ownMoney(page);
  await period("Тиждень").click();
  await expect(period("Тиждень")).toHaveAttribute("aria-pressed", "true");
  const report = page
    .getByRole("navigation", { name: "Гроші" })
    .getByRole("button", { name: "Звіт про продажі" });
  await report.click();
  await expect(
    page.getByRole("heading", { name: "Звіт про продажі", exact: true }),
  ).toBeVisible();
  await expect(period("Тиждень")).toHaveAttribute("aria-pressed", "true");
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "false");
  await expect(storeLine(page)).toHaveText("Тиждень · 09.11 · Тест");
  // Read again each time it opens, whatever «Гроші» read a moment ago.
  const week = (): number =>
    asked.filter((query) => query.includes("2026-11-09")).length;
  await settled(page);
  const read = week();
  await page.getByRole("button", { name: "Назад до «Гроші»" }).click();
  await expect(period("Тиждень")).toHaveAttribute("aria-pressed", "true");
  await report.click();
  await expect.poll(week).toBe(read + 1);
  await settled(page);
  await period("Сьогодні").click();
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "true");
  await expect(period("Тиждень")).toHaveAttribute("aria-pressed", "false");
  await expect(storeLine(page)).toHaveText("Сьогодні · 09.11 · Тест");
  await period("Тиждень").click();
  await expect(period("Тиждень")).toHaveAttribute("aria-pressed", "true");
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "false");
  await expect(storeLine(page)).toHaveText("Тиждень · 09.11 · Тест");

  // The 1st: the month is that day alone.
  await stubReport(page, ["Центр", "Ринок"], "2026-12-01");
  await ownReport(page);
  await period("Місяць").click();
  await expect(period("Місяць")).toHaveAttribute("aria-pressed", "true");
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "false");
  await expect(storeLine(page)).toHaveText("Місяць · 01.12 · Тест");

  // Days that cannot be read: today unknown, «Сьогодні» alone can be
  // chosen — it needs no day said.
  await stubReport(page, ["Центр", "Ринок"], "2026-11-09");
  await page.route(
    /\/api\/v1\/reports\/sales\?date_from=/,
    async (route: Route) => {
      await route.fulfill({
        status: 500,
        json: { detail: "Internal Server Error" },
      });
    },
  );
  await ownMoney(page);
  await period("Вчора").click();
  await page
    .getByRole("navigation", { name: "Гроші" })
    .getByRole("button", { name: "Звіт про продажі" })
    .click();
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
  await expect(period("Вчора")).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Вчора", "Тиждень", "Місяць"])
    await expect(period(name)).toBeDisabled();
  await expect(period("Сьогодні")).toBeEnabled();
  await period("Сьогодні").click();
  await expect(period("Сьогодні")).toHaveAttribute("aria-pressed", "true");
  await expect(table(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toHaveCount(0);

  // «Оновити» failed: what was read stands, and it is said.
  await page.route(/\/api\/v1\/reports\/sales$/, async (route: Route) => {
    await route.fulfill({
      status: 500,
      json: { detail: "Internal Server Error" },
    });
  });
  await page.getByRole("button", { name: "Оновити", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
  await expect(table(page)).toBeVisible();
});
