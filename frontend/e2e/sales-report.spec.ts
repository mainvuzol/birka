import { test, expect } from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The sales report (owner decisions, 2026-10-02): what each store sold and
 * took back, and the money through its till, for today or any days. The
 * owner and managers read it, each for the stores they hold it in, and the
 * stores together when there are several. A sale and its returns are the
 * store's that sold; money is the store's whose till it went through.
 *
 * In the stores' own network: the owner reads every store; Ганна holds every
 * right at «Центр», Петро at «Ринок»; Марко manages «Центр», Ліда sells there.
 * Other journeys sell in the same network the same day, so the figures are
 * checked as what these sales added to the report read before them.
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
  await page.getByRole("button", { name: "Центр CENTRE" }).click();
  await page.getByRole("button", { name: "Звіт", exact: true }).click();
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

/** `quantity` coats of a new model at 1500, sold by `store` from the shared
 * warehouse; paid in part when `paidNow` is given. */
async function sold(
  page: Page,
  headers: Record<string, string>,
  store: string,
  quantity: number,
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

async function takenBack(
  page: Page,
  headers: Record<string, string>,
  sale: Sale,
  at: string,
): Promise<void> {
  const refund = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      command_id: randomUUID(),
      store_id: at,
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
  cash: string;
}
interface Report {
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

// As the screen writes it: «3000,00 грн», «−1500,00 грн».
function uah(amount: bigint): string {
  const sign = amount < 0n ? "−" : "";
  const size = amount < 0n ? -amount : amount;
  return `${sign}${(size / 100n).toString()},${(size % 100n).toString().padStart(2, "0")} грн`;
}

/** What a store's block reads once `added` is added to `before`. */
function expected(
  before: Figures,
  added: Partial<Record<keyof Figures, number>>,
): { terms: string[]; sums: string[] } {
  const count = (name: keyof Figures): number =>
    (before[name] as number) + (added[name] ?? 0);
  const sum = (name: keyof Figures): bigint =>
    kopecks(before[name] as string) + BigInt((added[name] ?? 0) * 100);
  const out = (amount: bigint): string =>
    amount === 0n ? uah(0n) : uah(-amount);
  return {
    terms: [
      `Продажі: ${String(count("sales"))} (${String(count("units"))} од.)`,
      `Повернення: ${String(count("returns"))} (${String(count("returned_units"))} од.)`,
    ],
    sums: [
      uah(sum("sold")),
      out(sum("returned")),
      uah(sum("net")),
      uah(sum("paid_in_full")),
      uah(sum("debt_payments")),
      out(sum("paid_back")),
      uah(sum("cash")),
    ],
  };
}

async function readsAs(
  page: Page,
  title: string,
  shown: { terms: string[]; sums: string[] },
): Promise<void> {
  const block = page.getByRole("group", { name: title, exact: true });
  await expect(block.locator("dt").nth(0)).toHaveText(shown.terms[0] ?? "");
  await expect(block.locator("dt").nth(1)).toHaveText(shown.terms[1] ?? "");
  await expect(block.locator("dd")).toHaveText(shown.sums);
}

test("the owner reads each store, the stores together, and the money through each till", async ({
  page,
}) => {
  const before = await today(page);
  const fromHanna = await as(page, hanna, "Ганна");
  const fromPetro = await as(page, petro, "Петро");
  // «Центр» sells two coats paid in full and takes one back for its money.
  const atCentre = await sold(page, fromHanna, centre, 2);
  await takenBack(page, fromHanna, atCentre.sale, centre);
  // «Ринок» sells two in parts, 500 paid; «Центр» takes one back. The 1500
  // the other is worth is more than was paid, so the return only lowers the
  // debt and hands nothing back.
  const atMarket = await sold(page, fromPetro, market, 2, "500.00");
  await takenBack(page, fromHanna, atMarket.sale, centre);

  await reportAs(page, owner);

  await expect(
    page.getByRole("heading", { name: /^за \d\d\.\d\d\.\d{4}$/ }),
  ).toBeVisible();
  await readsAs(
    page,
    "Центр",
    expected(of(before, centre), {
      sales: 1,
      units: 2,
      sold: 3000,
      returns: 1,
      returned_units: 1,
      returned: 1500,
      net: 1500,
      paid_in_full: 3000,
      paid_back: 1500,
      cash: 1500,
    }),
  );
  // The coat came back at «Центр», yet the sale and its return are
  // «Ринок»'s; «Ринок»'s till kept the 500 it took.
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
      cash: 500,
    }),
  );
  await expect(
    page.getByRole("group", { name: "Старий", exact: true }),
  ).toContainText("в архіві");
  await expect(
    page.getByRole("group", { name: "Усі магазини разом" }),
  ).toBeVisible();

  // Every store's sales at first, each named by its store.
  await expect(
    page
      .getByRole("list", { name: "Продажі й повернення" })
      .getByRole("listitem")
      .filter({ hasText: atMarket.model })
      .filter({ hasText: "Продаж 3000,00 грн" }),
  ).toContainText("частинами, внесено 500,00 грн · «Ринок»");
  await page
    .getByRole("combobox", { name: "Моделі й продажі" })
    .selectOption({ label: "Центр" });
  // «Ринок» sold that model: it is not among «Центр»'s.
  await expect(page.getByRole("list", { name: "Моделі" })).not.toContainText(
    atMarket.model,
  );
  await expect(
    page
      .getByRole("list", { name: "Моделі" })
      .getByRole("listitem")
      .filter({ hasText: atCentre.model }),
  ).toContainText("2 шт. на 3000,00 грн · повернено 1 шт. на 1500,00 грн");
  const entries = page.getByRole("list", { name: "Продажі й повернення" });
  await expect(
    entries.getByRole("listitem").filter({ hasText: atMarket.model }),
  ).toContainText("лише зменшило борг · продав «Ринок», прийняв «Центр»");
  await expect(
    entries
      .getByRole("listitem")
      .filter({ hasText: atCentre.model })
      .filter({ hasText: "Продаж 3000,00 грн" }),
  ).toContainText("Ганна");
  await expect(
    entries
      .getByRole("listitem")
      .filter({ hasText: atCentre.model })
      .filter({ hasText: "Повернення −1500,00 грн" }),
  ).toContainText("віддано 1500,00 грн");
});

test("a manager reads their store alone, and a seller has no report", async ({
  page,
}) => {
  await reportAs(page, marko);
  await expect(
    page.getByRole("group", { name: "Центр", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Ринок", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Усі магазини разом" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Моделі й продажі" }),
  ).toHaveCount(0);

  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(lida, "Ліда") }).toString()}`,
  );
  await page.getByRole("button", { name: "Центр CENTRE" }).click();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Звіт", exact: true }),
  ).toHaveCount(0);
});

test("yesterday, this week, this month, or any days", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request: Request) => {
    if (request.url().includes("/api/v1/reports/sales?"))
      asked.push(new URL(request.url()).search);
  });
  await reportAs(page, owner);
  const heading = page.getByRole("heading", {
    name: /^за \d\d\.\d\d\.\d{4}$/,
  });
  await expect(heading).toBeVisible();
  const day = /^за (\d\d)\.(\d\d)\.(\d{4})$/.exec(
    (await heading.textContent()) ?? "",
  );
  const now = new Date(
    Date.UTC(Number(day?.[3]), Number(day?.[2]) - 1, Number(day?.[1])),
  );
  const iso = (value: Date): string => value.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));

  await page.getByRole("button", { name: "Вчора" }).click();
  await expect(page.getByRole("heading", { name: /^за / })).toHaveText(
    `за ${yesterday.toLocaleDateString("uk-UA", { timeZone: "UTC" })}`,
  );
  await expect(page.getByRole("button", { name: "Вчора" })).toHaveClass(
    "active",
  );
  await page.getByRole("button", { name: "Цей тиждень" }).click();
  await expect
    .poll(() => asked.at(-1))
    .toBe(`?date_from=${iso(monday)}&date_to=${iso(now)}`);
  await page.getByRole("button", { name: "Цей місяць" }).click();
  await expect
    .poll(() => asked.at(-1))
    .toBe(`?date_from=${iso(now).slice(0, 8)}01&date_to=${iso(now)}`);

  await page.getByLabel("Від").fill("2026-03-09");
  await page.getByLabel("До").fill("2026-03-10");
  await expect(page.getByRole("heading", { name: /^з / })).toHaveText(
    "з 09.03.2026 по 10.03.2026",
  );
  // The last day before the first is refused.
  await page.getByLabel("Від").fill("2026-03-11");
  await expect(page.getByRole("alert")).toHaveText(
    "Оберіть період від одного дня до року; перший день — не пізніше останнього.",
  );
});
