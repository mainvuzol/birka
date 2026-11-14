import { test, expect, menu, openModel, openStore, section } from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The search on «Сьогодні» (frame task list, P2-2; spec S04 #3, §6.6):
 * «Модель, покупець або ТТН» under the title's line; from two letters, a
 * pause after the last key — Enter at once — the open store's groups in the
 * day's place, each by its own right: «Товар», «Покупці», «Замовлення» by
 * a waybill alone. A row opens the model's detail or the customer's card,
 * «← Сьогодні» over each, or the order's card in «Замовлення». Оля owns
 * «Основний» and «Другий», and opens «Основний». The stock and the
 * customers are stubbed, matched word by word as the server matches them;
 * the orders are the server's.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  second_store_id: string;
  variant_id: string;
  size_id: string;
  location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(): string {
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
  return fields.toString();
}

function launch(version?: string): string {
  const hash = new URLSearchParams({ tgWebAppData: initData() });
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
}

// --- the stock, stubbed -----------------------------------------------------

const MAIN = "10000000-0000-4000-8000-000000000001";
const OWN = "10000000-0000-4000-8000-000000000002";
const sizeIds = {
  S: "20000000-0000-4000-8000-000000000001",
  M: "20000000-0000-4000-8000-000000000002",
  L: "20000000-0000-4000-8000-000000000003",
} as const;
type Letter = keyof typeof sizeIds;
const LORAN = "30000000-0000-4000-8000-000000000001";
const MILK = "30000000-0000-4000-8000-000000000002";
const KOKON = "30000000-0000-4000-8000-000000000003";

function row(
  variant: string,
  name: string,
  location: string,
  size: Letter,
  quantity: number,
  reserved = 0,
) {
  return {
    location_id: location,
    product_variant_id: variant,
    size_id: sizeIds[size],
    display_name: name,
    size_label: size,
    size_is_unknown: false,
    quantity,
    reserved_quantity: reserved,
    available_quantity: quantity - reserved,
    suggested_price: "3600.00",
  };
}
type Row = ReturnType<typeof row>;

/** «Основний»'s stock: «Лоран шоколад» free in S and M at its two
 * warehouses, its L held by an order; «Лоран молочний», every unit held;
 * «Кокон графіт». */
const stock: Row[] = [
  row(LORAN, "Лоран шоколад", MAIN, "S", 2),
  row(LORAN, "Лоран шоколад", MAIN, "M", 2, 1),
  row(LORAN, "Лоран шоколад", OWN, "M", 1),
  row(LORAN, "Лоран шоколад", OWN, "L", 1, 1),
  row(MILK, "Лоран молочний", MAIN, "M", 1, 1),
  row(KOKON, "Кокон графіт", MAIN, "S", 3),
];

const words = (query: string): string[] =>
  query.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * «Основний»'s warehouses, sizes and stock: every word of a query in the
 * model's name, as the server matches it, a hundred rows a page; `answer`
 * in its place where it gives one. Another store's are the server's.
 */
async function shelves(
  page: Page,
  rows: Row[] = stock,
  answer?: (query: string) => { items: Row[]; has_more: boolean } | null,
): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  const place = (id: string, name: string) => ({
    id,
    name,
    code: name,
    is_active: true,
    can_sell: true,
    can_receive: true,
    damaged_returns: false,
  });
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    if (!route.request().url().includes(fixture.store_id)) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: [place(MAIN, "Основний"), place(OWN, "Свій")],
    });
  });
  await page.route("**/api/v1/catalog/sizes?**", async (route) => {
    await route.fulfill({
      json: (["S", "M", "L"] as const).map((size) => ({
        size_id: sizeIds[size],
        code: size,
        system: "LETTER",
      })),
    });
  });
  await page.route(
    "**/api/v1/catalog/stock-options?**",
    async (route: Route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get("store_id") !== fixture.store_id) {
        await route.fallback();
        return;
      }
      asked.push(params);
      const query = params.get("query") ?? "";
      const given = answer?.(query) ?? null;
      if (given) {
        await route.fulfill({ json: given });
        return;
      }
      const location = params.get("location_id");
      const offset = Number(params.get("offset") ?? "0");
      const limit = Number(params.get("limit") ?? "100");
      const found = rows.filter(
        (one) =>
          (location === null || one.location_id === location) &&
          words(query).every((word) =>
            one.display_name.toLowerCase().includes(word),
          ),
      );
      await route.fulfill({
        json: {
          items: found.slice(offset, offset + limit),
          has_more: found.length > offset + limit,
        },
      });
    },
  );
  return asked;
}

// --- the customers, stubbed -------------------------------------------------

interface StubCustomer {
  phone_digits: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  owed: string;
  open_debts: number;
  credits: Record<string, unknown>[];
}

/** One customer of «Основний», a debt of theirs owed. */
function customer(
  name: string | null,
  phone: string | null,
  goods: string,
  owed: string,
): StubCustomer {
  return {
    phone_digits: phone === null ? null : phone.replace(/\D/g, ""),
    customer_name: name,
    customer_phone: phone,
    owed,
    open_debts: 1,
    credits: [
      {
        id: randomUUID(),
        sale_id: randomUUID(),
        store_id: fixture.store_id,
        store_name: "Основний",
        store_state: "ACTIVE",
        customer_name: name,
        customer_phone: phone,
        customer_erased_at: name === null ? "2026-10-01T10:00:00Z" : null,
        amount: "3000.00",
        currency_code: "UAH",
        status: "OPEN",
        paid: "1000.00",
        returned: "0.00",
        cash_back: "0.00",
        written_off: "0.00",
        owed,
        opened_at: "2026-10-01T10:00:00Z",
        last_payment_at: null,
        closed_at: null,
        goods: [goods],
        entries: [],
      },
    ],
  };
}

const daryna = customer(
  "Дарина Коваль",
  "067 555 12 34",
  "Лоран шоколад · M",
  "2000.00",
);
const iryna = customer(
  "Ірина Лоранська",
  "050 765 43 21",
  "Кокон графіт · S",
  "1500.00",
);

/**
 * «Основний»'s customers: by every word of a query in the name, or by the
 * phone's digits where the query is written as a phone, as the server
 * finds them; `fails`, a 500 in its place. Another store's has none.
 */
async function customers(
  page: Page,
  every: StubCustomer[] = [daryna, iryna],
  fails?: (params: URLSearchParams) => boolean,
): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push(params);
    if (fails?.(params) === true) {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    if (params.get("store_id") !== fixture.store_id) {
      await route.fulfill({ json: { items: [], has_more: false } });
      return;
    }
    const query = (params.get("query") ?? "").toLowerCase();
    const digits = query.replace(/\D/g, "");
    const phoneLike = /^[\d\s()+.-]+$/.test(query) && digits !== "";
    const limit = Number(params.get("limit") ?? "20");
    const found = every.filter((one) =>
      phoneLike
        ? (one.phone_digits ?? "").includes(digits)
        : words(query).every((word) =>
            (one.customer_name ?? "").toLowerCase().includes(word),
          ),
    );
    await route.fulfill({
      json: { items: found.slice(0, limit), has_more: found.length > limit },
    });
  });
  return asked;
}

// --- the way in --------------------------------------------------------------

async function enter(page: Page, version?: string): Promise<void> {
  await page.goto(launch(version));
  await openStore(page, "Основний MAIN");
  await expect(
    page.getByRole("heading", { name: "Сьогодні", exact: true }),
  ).toBeVisible();
}

function field(page: Page): Locator {
  return page.getByRole("searchbox", { name: "Модель, покупець або ТТН" });
}

function group(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/** The groups shown, by their headings. */
function groups(page: Page): Locator {
  return page.locator(".today-found .found-group > h2");
}

function day(page: Page): Locator {
  return page.getByRole("region", { name: "Сьогодні", exact: true });
}

function tab(page: Page, name: string): Locator {
  return menu(page).getByRole("button", { name, exact: true });
}

/** Typed, and the groups it asks for answered. */
async function search(page: Page, text: string): Promise<void> {
  const answered = page.waitForResponse(
    (response) =>
      response.url().includes("/catalog/stock-options?") &&
      new URL(response.url()).searchParams.get("query") === text.trim(),
  );
  await field(page).fill(text);
  await answered;
}

/** A row's words: its title, then what is under it. */
async function texts(rows: Locator): Promise<string[]> {
  return rows.evaluateAll((all) =>
    all.map((one) =>
      [...one.querySelectorAll(".cash-row-title, .debt-name, .sale-meta")]
        .map((part) => part.textContent)
        .join(" | "),
    ),
  );
}

// --- the field and the groups ----------------------------------------------

test("under the title's line, the field; from two letters the open store's «Товар» and «Покупці» in the day's place, every word in every row; «×» brings the day back as it was", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 741 });
  const stockAsked = await shelves(page);
  const customersAsked = await customers(page);
  const orders: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("waybill=")) orders.push(request.url());
  });
  await enter(page);
  // Between the title's line and the day-tag, named and placeholdered.
  const box = field(page);
  await expect(box).toHaveAttribute("placeholder", "Модель, покупець або ТТН");
  await expect(box).toHaveAttribute("enterkeyhint", "search");
  const line = await page.locator(".store-line").boundingBox();
  const at = await box.boundingBox();
  const tag = await day(page).boundingBox();
  expect(line && at && tag).toBeTruthy();
  if (line && at && tag) {
    expect(at.y).toBeGreaterThanOrEqual(line.y + line.height);
    expect(at.y + at.height).toBeLessThanOrEqual(tag.y);
    expect(at.height).toBe(52);
  }
  // What waits, and the line a reader hears, standing all along, silent.
  await expect(page.locator(".today-waiting, .today-empty")).toBeVisible();
  const said = page.locator(".found-said");
  await expect(said).toHaveAttribute("role", "status");
  await expect(said).toHaveText("");
  // One letter: nothing searched, the day as it was.
  await box.fill("л");
  await page.waitForTimeout(600);
  expect(stockAsked.filter((params) => params.has("query"))).toHaveLength(0);
  await expect(day(page)).toBeVisible();

  await search(page, "лоран");
  await expect(groups(page)).toHaveText(["Товар", "Покупці"]);
  await expect(said).toHaveText("");
  // Asked of the open store alone, with the till's request and «Покупці»'s
  // with no status; «Замовлення» never, for a word that is no waybill.
  const asked = stockAsked.find((params) => params.get("query") === "лоран");
  expect(asked?.get("store_id")).toBe(fixture.store_id);
  expect(asked?.get("limit")).toBe("100");
  expect(asked?.has("location_id")).toBe(false);
  const people = customersAsked.find(
    (params) => params.get("query") === "лоран",
  );
  expect(people?.get("store_id")).toBe(fixture.store_id);
  expect(people?.get("limit")).toBe("5");
  expect(people?.has("status")).toBe(false);
  expect(orders).toHaveLength(0);
  // The models, what is free by size, the store's warehouses summed; the
  // customers as «Покупці» lists them.
  await expect
    .poll(() => texts(group(page, "Товар").getByRole("button")))
    .toEqual(["Лоран шоколад | S 2 · M 2", "Лоран молочний | Усе в резерві"]);
  await expect(
    group(page, "Товар").getByRole("button", { name: "Лоран шоколад" }),
  ).toHaveAccessibleDescription("S 2 · M 2");
  await expect(group(page, "Покупці").getByRole("button")).toHaveAccessibleName(
    "Відкрити борг: Ірина Лоранська, винні 1 500,00 грн",
  );
  // Every word typed, in every row, as typed.
  await search(page, "лоран шоколад");
  for (const one of await texts(
    page.locator(".today-found").getByRole("button"),
  ))
    for (const word of ["лоран", "шоколад"])
      expect(one.toLowerCase()).toContain(word);
  await expect(groups(page)).toHaveText(["Товар"]);
  // The day and what waits, unseen while searched.
  await expect(day(page)).toBeHidden();
  await expect(page.locator(".today-waiting, .today-empty")).toBeHidden();

  await page.getByRole("button", { name: "Очистити пошук" }).click();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  await expect(page.locator(".today-found")).toHaveCount(0);
  await expect(day(page)).toBeVisible();
  await expect(page.locator(".today-waiting, .today-empty")).toBeVisible();
  // Under two letters again, the day too.
  await search(page, "кокон");
  await expect(day(page)).toBeHidden();
  await box.fill("к");
  await expect(day(page)).toBeVisible();
  await expect(page.locator(".today-found")).toHaveCount(0);
});

test("searched once the typing pauses, not before; Enter at once, and what it found stands while more is typed, until the pause", async ({
  page,
}) => {
  const asked = await shelves(page);
  await customers(page);
  await page.clock.install();
  await enter(page);
  // The clock moves only when told.
  await page.clock.pauseAt(Date.now() + 60_000);
  const searched = (query: string): boolean =>
    asked.some((params) => params.get("query") === query);
  const wait = async (ms: number): Promise<void> => {
    for (let gone = 0; gone < ms; gone += 100) await page.clock.runFor(100);
  };
  await field(page).fill("кок");
  await wait(200);
  expect(searched("кок")).toBe(false);
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return searched("кок");
    })
    .toBe(true);
  // Enter: at once, the clock not moved.
  await field(page).fill("кокон");
  await field(page).press("Enter");
  await expect.poll(() => searched("кокон")).toBe(true);
  // The answer is drawn on the query's own timer: the clock moved until it
  // is.
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return group(page, "Товар")
        .getByRole("button", { name: "Кокон графіт" })
        .count();
    })
    .toBe(1);
  // Typed on: what Enter found stands, never the day nor what the pause
  // found before it, until this pause.
  await field(page).fill("кокон г");
  await wait(200);
  expect(searched("кокон г")).toBe(false);
  await expect(day(page)).toBeHidden();
  await expect(
    group(page, "Товар").getByRole("button", { name: "Кокон графіт" }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return searched("кокон г");
    })
    .toBe(true);
  await expect(day(page)).toBeHidden();
  // Under two letters, then two again: the day until the pause, nothing
  // searched before.
  await field(page).fill("к");
  await expect(day(page)).toBeVisible();
  await field(page).fill("ко");
  await wait(200);
  await expect(day(page)).toBeVisible();
  await expect(page.locator(".today-found")).toHaveCount(0);
});

test("five rows a group at most, and «Знайдено більше — уточніть пошук.»; a model whose rows may go on past the page is not shown", async ({
  page,
}) => {
  const alphas = Array.from({ length: 7 }, (_, at) =>
    row(
      `40000000-0000-4000-8000-00000000000${String(at)}`,
      `Альфа ${String(at + 1)}`,
      MAIN,
      "M",
      1,
    ),
  );
  // «Гама одна» in 99 rows of the page's hundred, «Гама друга» in its last
  // and past it: what is free of the second is not known.
  const first = Array.from({ length: 99 }, (_, at) => ({
    ...row(
      "50000000-0000-4000-8000-000000000001",
      "Гама одна",
      `60000000-0000-4000-8000-${String(at).padStart(12, "0")}`,
      (["S", "M", "L"] as const)[at % 3] ?? "S",
      1,
    ),
  }));
  await shelves(page, alphas, (query) =>
    query === "гама"
      ? {
          items: [
            ...first,
            row(
              "50000000-0000-4000-8000-000000000002",
              "Гама друга",
              MAIN,
              "M",
              1,
            ),
          ],
          has_more: true,
        }
      : null,
  );
  await customers(
    page,
    Array.from({ length: 6 }, (_, at) =>
      customer(
        `Альфа Покупчиня ${String(at + 1)}`,
        `067 000 00 0${String(at)}`,
        "Альфа 1 · M",
        "100.00",
      ),
    ),
  );
  await enter(page);
  await search(page, "альфа");
  await expect(group(page, "Товар").getByRole("button")).toHaveCount(5);
  await expect(
    group(page, "Товар").getByRole("button").first(),
  ).toHaveAccessibleName("Альфа 1");
  await expect(group(page, "Товар").locator(".found-more")).toHaveText(
    "Знайдено більше — уточніть пошук.",
  );
  // «Покупці» asked five: one more said by the server.
  await expect(group(page, "Покупці").getByRole("button")).toHaveCount(5);
  await expect(group(page, "Покупці").locator(".found-more")).toHaveText(
    "Знайдено більше — уточніть пошук.",
  );

  await search(page, "гама");
  await expect(group(page, "Товар").getByRole("button")).toHaveText([
    /^Гама одна/,
  ]);
  await expect(
    group(page, "Товар").getByRole("button", { name: "Гама одна" }),
  ).toHaveAccessibleDescription("S 33 · M 33 · L 33");
  await expect(group(page, "Товар").locator(".found-more")).toBeVisible();
});

test("nothing found: «Нічого не знайшли за «…»»; a group that fails says why in its place, the others standing, and «Спробувати ще раз» reads it again", async ({
  page,
}) => {
  await shelves(page);
  let failing = true;
  await customers(
    page,
    [daryna, iryna],
    (params) => failing && params.get("query") === "кокон",
  );
  await enter(page);
  // Read, and said so in the line that stands.
  let release = (): void => undefined;
  const reading = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await reading;
    await route.fallback();
  });
  await field(page).fill("зебра");
  await expect(page.locator(".found-said")).toHaveText("Шукаємо…");
  release();
  await expect(page.locator(".today-found .found-none")).toHaveText(
    "Нічого не знайшли за «зебра»",
  );
  // Said in the line that stood all along.
  await expect(page.locator(".found-said")).toHaveText(
    "Нічого не знайшли за «зебра»",
  );
  await expect(groups(page)).toHaveCount(0);

  await search(page, "кокон");
  await expect(groups(page)).toHaveText(["Товар", "Покупці"]);
  await expect(
    group(page, "Товар").getByRole("button", { name: "Кокон графіт" }),
  ).toBeVisible();
  const failed = group(page, "Покупці").getByRole("alert");
  await expect(failed).toBeVisible();
  await expect(page.locator(".found-none")).toHaveCount(0);
  await expect(page.locator(".found-said")).toHaveText("");
  failing = false;
  await failed.getByRole("button", { name: "Спробувати ще раз" }).click();
  // Read again, nothing of theirs: the group goes, the model stands.
  await expect(groups(page)).toHaveText(["Товар"]);
  await expect(page.locator(".found-none")).toHaveCount(0);
});

// --- what a row opens --------------------------------------------------------

test("a model: its detail read by what found it, «← Сьогодні» over it, «Продаж» marked; back, the search as left; anywhere else it is forgotten, and the till's model goes back to «Продаж»", async ({
  page,
}) => {
  const asked = await shelves(page);
  await customers(page);
  await enter(page);
  await search(page, "лоран шоколад");
  await group(page, "Товар")
    .getByRole("button", { name: "Лоран шоколад" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Лоран шоколад" }),
  ).toBeVisible();
  // Read by the search that found it.
  expect(
    asked.filter((params) => params.get("query") === "лоран шоколад").length,
  ).toBeGreaterThanOrEqual(2);
  const back = page.getByRole("button", { name: "Назад до «Сьогодні»" });
  await expect(back).toHaveText("← Сьогодні");
  await expect(tab(page, "Продаж")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "Сьогодні")).toBeFocused();

  await back.click();
  await expect(field(page)).toHaveValue("лоран шоколад");
  await expect(
    group(page, "Товар").getByRole("button", { name: "Лоран шоколад" }),
  ).toBeVisible();
  await expect(tab(page, "Сьогодні")).toBeFocused();

  // Opened again, then «Продаж» from the menu: the till's own model goes
  // back to «Продаж», as before.
  await group(page, "Товар")
    .getByRole("button", { name: "Лоран шоколад" })
    .click();
  await tab(page, "Продаж").click();
  await openModel(page, "лоран", "Лоран шоколад");
  await expect(
    page.getByRole("button", { name: "Назад до «Продаж»" }),
  ).toBeVisible();
  // And the search, forgotten.
  await tab(page, "Сьогодні").click();
  await expect(field(page)).toHaveValue("");
  await expect(day(page)).toBeVisible();
});

test("in Telegram, a row's tap lets the keyboard go", async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: { postEvent: (event: string) => void };
      told: string[];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event) => {
        host.told.push(event);
      },
    };
  });
  await shelves(page);
  await customers(page);
  await enter(page, "9.1");
  await search(page, "кокон");
  const told = (): Promise<number> =>
    page.evaluate(
      () =>
        (window as unknown as { told: string[] }).told.filter(
          (event) => event === "web_app_hide_keyboard",
        ).length,
    );
  const before = await told();
  await group(page, "Товар")
    .getByRole("button", { name: "Кокон графіт" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Кокон графіт" }),
  ).toBeVisible();
  expect(await told()).toBe(before + 1);
});

test("a customer: «Покупці»'s row, their card with «← Сьогодні», «Ще» marked; back, the search as left; an erased one is not shown; «Покупці» from «Ще» opens on its list", async ({
  page,
}) => {
  await shelves(page);
  const owing = customer(
    "Дарина Коваль",
    "067 555 12 34",
    "Лоран шоколад · M",
    "2000.00",
  );
  await customers(page, [
    owing,
    iryna,
    // As a debt whose customer is erased reads: no phone.
    customer("Дарина Стерта", null, "Лоран шоколад · S", "300.00"),
  ]);
  await enter(page);
  await search(page, "дарина");
  await expect(groups(page)).toHaveText(["Покупці"]);
  const rows = group(page, "Покупці").getByRole("button");
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAccessibleName(
    "Відкрити борг: Дарина Коваль, винні 2 000,00 грн",
  );
  await rows.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Дарина Коваль" }),
  ).toBeVisible();
  const back = page.getByRole("button", { name: "Назад до «Сьогодні»" });
  await expect(back).toHaveText("← Сьогодні");
  await expect(tab(page, "Ще")).toHaveAttribute("aria-current", "true");
  await expect(tab(page, "Сьогодні")).toBeFocused();

  // Paid meanwhile: back, what was owed before is never shown while they
  // are read again.
  owing.owed = "1500.00";
  let release = (): void => undefined;
  const reading = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    await reading;
    await route.fallback();
  });
  await back.click();
  await expect(field(page)).toHaveValue("дарина");
  await expect(group(page, "Покупці")).toBeVisible();
  await expect(group(page, "Покупці").getByRole("button")).toHaveCount(0);
  release();
  await expect(group(page, "Покупці").getByRole("button")).toHaveAccessibleName(
    "Відкрити борг: Дарина Коваль, винні 1 500,00 грн",
  );

  // From «Ще», «Покупці» is its list, «← Ще» over it; the search forgotten.
  await section(page, "Покупці");
  await expect(
    page.getByRole("heading", { level: 1, name: "Покупці" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Назад до «Ще»" }),
  ).toBeVisible();
  await tab(page, "Сьогодні").click();
  await expect(field(page)).toHaveValue("");
});

/** An order of «Основний», made and sent through the API with `waybill`. */
async function sentWith(page: Page, waybill: string): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const made = await page.request.post("/api/v1/orders", {
    headers,
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      carrier: "NOVA_POSHTA",
      lines: [
        {
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          source_location_id: fixture.location_id,
          quantity: 1,
          unit_price: "900.00",
        },
      ],
    },
  });
  expect(made.status()).toBe(201);
  const id = ((await made.json()) as { id: string }).id;
  const sent = await page.request.post(`/api/v1/orders/${id}/dispatch`, {
    headers,
    data: { command_id: randomUUID(), waybill },
  });
  expect(sent.status()).toBe(200);
  return id;
}

test("a customer owing nothing says how their debts closed: «Сплачено» paid, «Списано» in `offline`'s grey, closed both ways «Нічого не винні» neutral (audit 2026-11-13, sale P2-5)", async ({
  page,
}) => {
  await shelves(page);
  const closed = (
    name: string,
    phone: string,
    statuses: readonly ("SETTLED" | "WRITTEN_OFF")[],
  ): StubCustomer => {
    const one = customer(name, phone, "Лоран шоколад · M", "0.00");
    const [first] = one.credits;
    return {
      ...one,
      open_debts: 0,
      credits: statuses.map((status) => ({
        ...first,
        id: randomUUID(),
        status,
        owed: "0.00",
        closed_at: "2026-10-10T10:00:00Z",
      })),
    };
  };
  await customers(page, [
    closed("Олена Сплачена", "067 111 11 11", ["SETTLED"]),
    closed("Олена Списана", "067 222 22 22", ["WRITTEN_OFF"]),
    closed("Олена Обидва", "067 333 33 33", ["SETTLED", "WRITTEN_OFF"]),
  ]);
  await enter(page);
  await search(page, "олена");
  const pill = (name: string): Locator =>
    group(page, "Покупці")
      .getByRole("button", { name: new RegExp(`^Відкрити борг: ${name},`) })
      .locator(".sticker");
  await expect(pill("Олена Сплачена")).toHaveText("Сплачено");
  await expect(pill("Олена Сплачена")).toHaveClass("sticker tone-paid");
  await expect(pill("Олена Списана")).toHaveText("Списано");
  await expect(pill("Олена Списана")).toHaveClass("sticker tone-offline");
  await expect(pill("Олена Обидва")).toHaveText("Нічого не винні");
  await expect(pill("Олена Обидва")).toHaveClass("sticker tone-neutral");
});

test("«Замовлення» by a waybill alone: the server's order by part of its waybill, its goods, carrier, waybill and step, never its sum; its card in «Замовлення»; back on «Сьогодні» by the menu, the search as left; from its list, forgotten", async ({
  page,
}) => {
  // Fourteen digits no other journey writes.
  const digits = `20${String(Date.now()).slice(-12)}`;
  const waybill = `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6, 10)} ${digits.slice(10)}`;
  await enter(page);
  await sentWith(page, waybill);
  const asked: URLSearchParams[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.endsWith("/api/v1/orders") &&
      url.searchParams.has("waybill")
    )
      asked.push(url.searchParams);
  });
  // A word of letters is no waybill: «Замовлення» not asked.
  await search(page, "кокон 20");
  expect(asked).toHaveLength(0);
  // Part of it, as it is written on the parcel.
  const part = `${digits.slice(6, 10)} ${digits.slice(10)}`;
  await search(page, part);
  await expect(group(page, "Замовлення").getByRole("button")).toHaveCount(1);
  expect(asked.at(-1)?.get("waybill")).toBe(part);
  expect(asked.at(-1)?.get("store_id")).toBe(fixture.store_id);
  expect(asked.at(-1)?.get("limit")).toBe("5");
  const found = group(page, "Замовлення").getByRole("button");
  await expect(found).toHaveAccessibleName(/^Лоран шоколад.* · M$/);
  await expect(found).toHaveAccessibleDescription(
    `Нова пошта · ТТН ${waybill} · Відправлено`,
  );
  await expect(found).not.toContainText("грн");
  for (const word of part.split(" ")) await expect(found).toContainText(word);

  await found.click();
  await expect(tab(page, "Замовлення")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "Замовлення")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "До замовлень", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".order-goes")).toContainText(waybill);

  await tab(page, "Сьогодні").click();
  await expect(field(page)).toHaveValue(part);
  await expect(group(page, "Замовлення").getByRole("button")).toHaveCount(1);
  await group(page, "Замовлення").getByRole("button").click();
  await page.getByRole("button", { name: "До замовлень", exact: true }).click();
  await tab(page, "Сьогодні").click();
  await expect(field(page)).toHaveValue("");
  await expect(day(page)).toBeVisible();
});

// --- by right ----------------------------------------------------------------

test("no group without its right in the open store, and no field without any", async ({
  page,
}) => {
  const stockAsked = await shelves(page);
  const customersAsked = await customers(page);
  let without: string[] = ["inventory:view"];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { id: string; permissions: string[] }[];
    };
    for (const store of body.stores)
      if (store.id === fixture.store_id)
        store.permissions = store.permissions.filter(
          (p) => !without.includes(p),
        );
    await route.fulfill({ response, json: body });
  });
  const waybills: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("waybill=")) waybills.push(request.url());
  });
  const asked = (path: string, query: string) =>
    page.waitForRequest(
      (request) =>
        request.url().includes(path) &&
        new URL(request.url()).searchParams.get(
          path === "/orders?" ? "waybill" : "query",
        ) === query,
    );
  await enter(page);
  // No stock's right: «Покупці» and «Замовлення», «Товар» never asked.
  const people = asked("/credits/customers?", "1234");
  const parcels = asked("/orders?", "1234");
  await field(page).fill("1234");
  await people;
  await parcels;
  await expect(page.locator(".today-found")).toBeVisible();
  await expect(group(page, "Товар")).toHaveCount(0);
  expect(stockAsked.some((params) => params.has("query"))).toBe(false);

  // Neither the debts' right nor the orders': «Товар» alone.
  without = ["sale:credit", "sale:view"];
  await page.goto("about:blank");
  await enter(page);
  const before = { people: customersAsked.length, parcels: waybills.length };
  await search(page, "1234");
  await expect(page.locator(".today-found")).toBeVisible();
  expect(customersAsked.length).toBe(before.people);
  expect(waybills.length).toBe(before.parcels);
  await expect(group(page, "Покупці")).toHaveCount(0);
  await expect(group(page, "Замовлення")).toHaveCount(0);

  // None of the three: no field, the day as before.
  without = ["inventory:view", "sale:credit", "sale:view"];
  await page.goto("about:blank");
  await enter(page);
  await expect(day(page)).toBeVisible();
  await expect(field(page)).toHaveCount(0);
});

// --- on the phone ------------------------------------------------------------

for (const scheme of ["light", "dark"] as const)
  test(`at 360 × 640 in the ${scheme} theme: the field over the day's one line, the groups' words at 4.5:1, nothing wider than the screen`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 360, height: 640 });
    await shelves(page);
    await customers(page);
    await enter(page);
    const line = page.getByRole("button", { name: /^Сьогодні досі/ });
    const at = await field(page).boundingBox();
    const folded = await line.boundingBox();
    const bar = await menu(page).boundingBox();
    expect(at && folded && bar).toBeTruthy();
    if (at && folded && bar) {
      expect(at.y + at.height).toBeLessThanOrEqual(folded.y);
      expect(folded.y + folded.height).toBeLessThanOrEqual(bar.y);
    }
    await search(page, "лоран");
    for (const part of [
      group(page, "Товар").locator("h2"),
      group(page, "Товар").locator(".cash-row-title").first(),
      group(page, "Товар").locator(".sale-meta").first(),
      group(page, "Покупці").locator(".debt-name"),
      field(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await search(page, "зебра");
    expect(await contrast(page.locator(".found-none"))).toBeGreaterThanOrEqual(
      4.5,
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
