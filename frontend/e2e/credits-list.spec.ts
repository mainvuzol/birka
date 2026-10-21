import { test, expect, openStore } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Борги»'s list (credits task list, P0-1, P0-2): what the store is owed
 * first, large; «Ім’я або телефон» searched as it is typed; a row a
 * customer with what they owe and never a sale's sum or a way; a customer
 * of more debts shown to choose from, read by their phone; and «Показати
 * ще» reading twenty more at a time. The store's debts are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function launch(theme?: Record<string, string>): string {
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
  return `/#${hash.toString()}`;
}

type Status = "OPEN" | "SETTLED" | "WRITTEN_OFF";

interface StubCredit {
  id: string;
  status: Status;
  owed: string;
  goods: string[];
  opened_at: string;
  [field: string]: unknown;
}

interface StubCustomer {
  phone_digits: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  owed: string;
  open_debts: number;
  credits: StubCredit[];
}

/** A debt of «Основний», sold at 3 000 with 1 000 paid now. */
function debt(
  goods: string,
  owed: string,
  extra: Partial<StubCredit> = {},
): StubCredit {
  return {
    id: randomUUID(),
    sale_id: randomUUID(),
    store_id: fixture.store_id,
    store_name: "Основний",
    store_state: "ACTIVE",
    customer_name: null,
    customer_phone: null,
    customer_erased_at: null,
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
    ...extra,
  };
}

/** One phone, one customer: what they owe in all is the debts' sum. */
function customer(
  name: string,
  phone: string,
  credits: StubCredit[],
): StubCustomer {
  const owed = credits
    .filter((each) => each.status === "OPEN")
    .reduce((sum, each) => sum + Number(each.owed), 0);
  return {
    phone_digits: phone.replace(/\D/g, ""),
    customer_name: name,
    customer_phone: phone,
    owed: owed.toFixed(2),
    open_debts: credits.filter((each) => each.status === "OPEN").length,
    credits: credits.map((each) => ({
      ...each,
      customer_name: name,
      customer_phone: phone,
    })),
  };
}

/** The store's customers, answered page by page as the server pages them;
 * what each read asked. `answer` refuses or reshapes a read. */
async function customers(
  page: Page,
  every: StubCustomer[],
  answer?: (
    params: URLSearchParams,
  ) => { status: number } | { items: StubCustomer[] } | null,
): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push(params);
    const limit = Number(params.get("limit") ?? "20");
    const offset = Number(params.get("offset") ?? "0");
    const shaped = answer?.(params) ?? null;
    if (shaped && "status" in shaped) {
      await route.fulfill({
        status: shaped.status,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    if (limit > 50) {
      await route.fulfill({
        status: 422,
        json: { code: "VALIDATION_ERROR", message: "limit", details: {} },
      });
      return;
    }
    const query = (params.get("query") ?? "").toLowerCase();
    // As the server: a query written as a phone is looked for among phones,
    // however it is spelled.
    const digits = query.replace(/\D/g, "");
    const phoneLike = /^[\d\s()+.-]+$/.test(query) && digits !== "";
    const open = params.get("status") === "OPEN";
    const found = (shaped?.items ?? every)
      .map((each) => ({
        ...each,
        credits: open
          ? each.credits.filter((one) => one.status === "OPEN")
          : each.credits,
      }))
      .filter((each) => each.credits.length > 0)
      .filter(
        (each) =>
          !query ||
          (each.customer_name ?? "").toLowerCase().includes(query) ||
          (phoneLike && (each.phone_digits ?? "").includes(digits)),
      );
    await route.fulfill({
      json: {
        items: found.slice(offset, offset + limit),
        has_more: found.length > offset + limit,
      },
    });
  });
  return asked;
}

async function summary(
  page: Page,
  owed = "12400.00",
  people = 8,
  debts = 11,
): Promise<void> {
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    await route.fulfill({ json: { owed, customers: people, debts } });
  });
}

async function credits(
  page: Page,
  theme?: Record<string, string>,
): Promise<void> {
  await page.goto(launch(theme));
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Борги", exact: true }).click();
}

function rows(page: Page): Locator {
  return page.getByRole("list", { name: "Хто винен" }).getByRole("listitem");
}

function field(page: Page): Locator {
  return page.getByLabel("Ім’я або телефон");
}

const oksana = (): StubCustomer =>
  customer("Оксана Петренко", "067 123 45 67", [
    debt("Лоран шоколад · M", "2000.00"),
  ]);
const iryna = (): StubCustomer =>
  customer("Ірина Коваль", "050 765 43 21", [
    debt("Альпака сіра · L", "2500.00", {
      opened_at: "2026-10-12T10:00:00Z",
    }),
    debt("Лоран шоколад · M", "1500.00", {
      last_payment_at: "2026-10-14T10:00:00Z",
    }),
  ]);

test("what the store is owed comes first, large, and a row a customer: what they owe, never a sale's sum or a way", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await summary(page);
  await customers(page, [oksana(), iryna()]);
  await credits(page);

  const owed = page.getByLabel("Скільки винні магазину");
  await expect(owed).toContainText("Магазину винні");
  await expect(owed.locator(".owed-sum")).toHaveText("12 400,00 грн");
  await expect(owed).toContainText("8 покупців · 11 боргів");

  const one = page.getByRole("button", { name: /^Відкрити борг: Оксана/ });
  await expect(one).toHaveAccessibleName(
    "Відкрити борг: Оксана Петренко, винні 2 000,00 грн",
  );
  await expect(one).toContainText("067 123 45 67 · Лоран шоколад · M");
  await expect(one).not.toContainText("3 000,00");
  await expect(one).not.toContainText(/готівк|картк|переказ/i);
  const two = page.getByRole("button", { name: /^Відкрити борг: Ірина/ });
  await expect(two).toHaveAccessibleName(
    "Відкрити борг: Ірина Коваль, винні 4 000,00 грн",
  );
  await expect(two).toContainText("050 765 43 21 · 2 борги");
  await expect(two).not.toContainText("Альпака");
  // What they owe in all, as the server summed it.
  await expect(two.locator(".debt-owed")).toHaveText("4 000,00 грн");

  // Above the first row only the heading, the store's sum and the field;
  // nothing to refresh, explain or choose (credits task list, P0-1).
  for (const gone of ["Оновити", "Знайти"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  const input = await field(page).boundingBox();
  const first = await rows(page).first().boundingBox();
  if (!input || !first) throw new Error("not laid out");
  expect(first.y - (input.y + input.height)).toBeLessThanOrEqual(16);
  expect(first.height).toBeGreaterThanOrEqual(44);
  // The rest is asked for under the results; the closed stores only for a
  // whole number (credits task list, P1-1).
  const paid = await page
    .getByRole("button", { name: "Показати сплачені й списані" })
    .boundingBox();
  const last = await rows(page).last().boundingBox();
  if (!paid || !last) throw new Error("not laid out");
  expect(paid.y).toBeGreaterThan(last.y);
  await expect(
    page.getByRole("button", { name: /^Борг магазину, що зараз не працює\?/ }),
  ).toHaveCount(0);
  // A whole number owed here: its row, and under it the closed stores
  // asked for, never instead of it.
  await field(page).fill("050 765 43 21");
  await expect(rows(page)).toHaveCount(1);
  const closed = await page
    .getByRole("button", {
      name: "Борг магазину, що зараз не працює? Шукати за цим номером",
    })
    .boundingBox();
  const owing = await rows(page).first().boundingBox();
  if (!closed || !owing) throw new Error("not laid out");
  expect(closed.y).toBeGreaterThan(owing.y + owing.height - 1);
});

test("while «Борги» is read, the store's card and three rows keep their places, and the field does not move", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await summary(page);
  await customers(page, [oksana(), iryna()]);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const read of [
    "**/api/v1/credits/summary?**",
    "**/api/v1/credits/customers?**",
  ])
    await page.route(read, async (route) => {
      await held;
      await route.fallback();
    });
  await credits(page);
  // Being read (credits task list, P2-3): the store's card's and three
  // rows' places, said to a screen reader, no words where the rows will be.
  const list = page.locator("section.credits");
  await expect(list.locator(".placeholder .debt-row")).toHaveCount(3);
  await expect(list.locator(".placeholder .debt-mark")).toHaveCount(3);
  // A row's mark, round, as the row's own.
  await expect(list.locator(".placeholder .debt-mark").first()).toHaveCSS(
    "border-radius",
    "999px",
  );
  await expect(list.locator(".owed-place")).toBeVisible();
  await expect(list.locator(".owed-place")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  // Grey lines, what sizes them never seen (review, 2026-10-21).
  const sizing = list.locator(".owed-place .skeleton-line > span");
  await expect(sizing).toHaveCount(2);
  for (const each of await sizing.all()) await expect(each).toBeHidden();
  await expect(list.getByRole("status")).toHaveText("Завантажуємо борги…");
  await expect(page.getByLabel("Скільки винні магазину")).toHaveCount(0);
  await page.screenshot({ path: "test-results/credits-reading.png" });
  const before = await field(page).boundingBox();
  const place = await list
    .locator(".placeholder .debt-row")
    .first()
    .boundingBox();
  release();
  await expect(rows(page)).toHaveCount(2);
  await expect(
    page.getByLabel("Скільки винні магазину").locator(".owed-sum"),
  ).toHaveText("12 400,00 грн");
  await expect(list.locator(".placeholder")).toHaveCount(0);
  await expect(list.locator(".owed-place")).toHaveCount(0);
  const after = await field(page).boundingBox();
  const first = await rows(page).first().boundingBox();
  if (!before || !after || !place || !first) throw new Error("not laid out");
  // Nothing moves: the field, nor where the first row comes.
  expect(after.y).toBe(before.y);
  expect(Math.abs(first.y - place.y)).toBeLessThanOrEqual(2);
});

test("«Магазину винні» that cannot be read keeps its place, says so, and is read again — the field never moves (owner decision, 2026-10-21)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await customers(page, [oksana(), iryna()]);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fails = true;
  // The read again, held: the card keeps saying so, its button waiting.
  let again: () => void = () => undefined;
  const heldAgain = new Promise<void>((resolve) => {
    again = resolve;
  });
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    await held;
    if (!fails) await heldAgain;
    if (fails) {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    await route.fulfill({
      json: { owed: "12400.00", customers: 8, debts: 11 },
    });
  });
  await credits(page);
  await expect(page.locator("section.credits .owed-place")).toBeVisible();
  const before = await field(page).boundingBox();
  release();
  const card = page.getByRole("group", { name: "Скільки винні магазину" });
  await expect(card.getByRole("alert")).toHaveText("Не вдалося прочитати");
  const failed = await field(page).boundingBox();
  fails = false;
  const retry = card.getByRole("button", { name: "Спробувати ще раз" });
  expect((await retry.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await retry.click();
  await expect(retry).toBeDisabled();
  await expect(card.getByRole("alert")).toHaveText("Не вдалося прочитати");
  again();
  await expect(card.locator(".owed-sum")).toHaveText("12 400,00 грн");
  const read = await field(page).boundingBox();
  if (!before || !failed || !read) throw new Error("not laid out");
  expect(failed.y).toBe(before.y);
  expect(read.y).toBe(before.y);
});

/** What an empty «Борги» teaches (credits task list, P1-4). */
const beginsAt =
  "Зараз ніхто не винен. Борг з’являється, коли продають частинами.";

test("an empty «Борги» says where a debt begins, and «Новий продаж» leads to the till", async ({
  page,
}) => {
  await summary(page, "0.00", 0, 0);
  await customers(page, []);
  await credits(page);
  const empty = page.getByText(beginsAt, { exact: true });
  await expect(empty).toBeVisible();
  // A search that finds nothing says so, never where debts begin.
  await field(page).fill("Оксана");
  await expect(page.getByText(/За «Оксана» боргів не знайдено/)).toBeVisible();
  await expect(empty).toHaveCount(0);
  await field(page).fill("");
  await expect(empty).toBeVisible();
  // The paid and written off asked for: their own words.
  await page
    .getByRole("button", { name: "Показати сплачені й списані" })
    .click();
  await expect(
    page.getByText("У цьому магазині ще не продавали частинами.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(empty).toHaveCount(0);
  await page.getByRole("button", { name: "Лише ті, хто винен" }).click();
  await expect(empty).toBeVisible();
  // «Продаж» is the till; «Каса» is the drawer.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await expect(page.getByLabel("Знайти модель")).toBeFocused();
});

test("a store that does not trade keeps its words for an empty «Борги»: no debt begins there", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { code: string; state: string }[];
    };
    for (const store of body.stores)
      if (store.code === "MAIN") store.state = "BLOCKED";
    await route.fulfill({ response, json: body });
  });
  await summary(page, "0.00", 0, 0);
  await customers(page, []);
  await credits(page);
  await expect(
    page.getByText("Зараз ніхто не винен цьому магазину.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(beginsAt, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Новий продаж" })).toHaveCount(
    0,
  );
});

test("for whoever may not sell, an empty «Борги» says where a debt begins and leads nowhere", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (right) => right !== "sale:create",
      );
    await route.fulfill({ response, json: body });
  });
  await summary(page, "0.00", 0, 0);
  await customers(page, []);
  await credits(page);
  await expect(page.getByText(beginsAt, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Новий продаж" })).toHaveCount(
    0,
  );
});

test("how many owe is said as a person says it", async ({ page }) => {
  await customers(page, [oksana()]);
  for (const [people, debts, said] of [
    [1, 1, "1 покупець · 1 борг"],
    [2, 3, "2 покупці · 3 борги"],
    [5, 21, "5 покупців · 21 борг"],
    [12, 14, "12 покупців · 14 боргів"],
  ] as const) {
    await page.unroute("**/api/v1/credits/summary?**");
    await summary(page, "100.00", people, debts);
    await page.goto("about:blank");
    await credits(page);
    await expect(page.getByLabel("Скільки винні магазину")).toContainText(said);
  }
});

test("«Ім’я або телефон» is searched as it is typed from two letters, Enter at once, and one letter lists everyone", async ({
  page,
}) => {
  await summary(page);
  const asked = await customers(page, [oksana(), iryna()]);
  await credits(page);
  await expect(rows(page)).toHaveCount(2);

  // No button: two letters, and the list follows.
  await field(page).fill("Ір");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Ірина Коваль");
  // One letter is everyone again.
  await field(page).fill("І");
  await expect(rows(page)).toHaveCount(2);
  // Enter searches what is typed.
  await field(page).fill("Окс");
  await field(page).press("Enter");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Оксана Петренко");
  // A phone, however it is written.
  await field(page).fill("063");
  await expect(rows(page)).toHaveCount(0);
  await field(page).fill("050 765");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Ірина Коваль");
  for (const params of asked) {
    const query = params.get("query");
    if (query !== null) expect(query.length).toBeGreaterThanOrEqual(2);
  }

  // Typed at a seller's pace, only what is settled on is looked for.
  await field(page).fill("");
  await expect(rows(page)).toHaveCount(2);
  const typed = asked.length;
  await field(page).pressSequentially("Ірина", { delay: 40 });
  await expect(rows(page)).toHaveCount(1);
  expect(
    asked
      .slice(typed)
      .map((params) => params.get("query"))
      .filter((query) => query !== null),
  ).toEqual(["Ірина"]);

  // Nothing found: what was typed, what to try, and a way back.
  await field(page).fill("Зоя");
  await expect(
    page.getByText(
      "За «Зоя» боргів не знайдено. Перевірте ім’я або введіть номер телефону.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Очистити" }).click();
  await expect(field(page)).toHaveValue("");
  await expect(field(page)).toBeFocused();
  await expect(rows(page)).toHaveCount(2);
});

/** Forty-five customers, a debt each, the newest first. */
function many(): StubCustomer[] {
  return Array.from({ length: 45 }, (_, n) =>
    customer(
      `Покупець ${String(n + 1).padStart(2, "0")}`,
      `067 000 00 ${String(n + 10).padStart(2, "0")}`,
      [debt("Лоран шоколад · M", "1000.00")],
    ),
  );
}

test("«Показати ще» reads twenty more each time, never over fifty, and a customer read twice is shown once", async ({
  page,
}) => {
  await summary(page);
  const every = many();
  // A debt opened meanwhile, after the first page, moves every later page's
  // edge by one: the newest of those read comes again.
  const asked = await customers(page, every, (params) =>
    Number(params.get("offset")) >= 20
      ? { items: [every[0] as StubCustomer, ...every] }
      : null,
  );
  await credits(page);
  await expect(rows(page)).toHaveCount(20);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(rows(page)).toHaveCount(39);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(rows(page)).toHaveCount(45);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  const reads = asked.filter((params) => params.get("limit") !== "5");
  expect(reads.map((params) => params.get("limit"))).toEqual([
    "20",
    "20",
    "20",
  ]);
  expect(reads.map((params) => params.get("offset"))).toEqual([
    "0",
    "20",
    "40",
  ]);
});

test("a page that cannot be read leaves those read, and is asked again", async ({
  page,
}) => {
  await summary(page);
  let refuse = true;
  await customers(page, many(), (params) =>
    refuse && params.get("offset") === "20" ? { status: 500 } : null,
  );
  await credits(page);
  await page.getByRole("button", { name: "Показати ще" }).click();
  const told = page.getByRole("alert");
  await expect(told).toContainText("Спробувати ще раз");
  await expect(rows(page)).toHaveCount(20);
  refuse = false;
  await told.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(rows(page)).toHaveCount(40);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("one debt opens at once; more, the customer's debts to choose from, read by their phone", async ({
  page,
}) => {
  await summary(page);
  // Read by the phone, the customer is as the server says now.
  const asked = await customers(page, [oksana(), iryna()], (params) =>
    params.get("query") === "0507654321" && params.get("limit") === "5"
      ? {
          items: [
            customer("Ірина Коваль", "050 765 43 21", [
              debt("Альпака сіра · L", "2000.00"),
              debt("Лоран шоколад · M", "1500.00", {
                last_payment_at: "2026-10-14T10:00:00Z",
              }),
            ]),
          ],
        }
      : null,
  );
  await credits(page);

  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "До боргів" }).click();
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole("button", { name: /^Відкрити борг: Ірина/ }).click();
  await expect(
    page.getByRole("heading", { name: "Ірина Коваль", level: 2 }),
  ).toBeVisible();
  await expect(page.locator(".owed-sum")).toHaveText("3 500,00 грн");
  const debts = page
    .getByRole("list", { name: "Борги: Ірина Коваль" })
    .getByRole("listitem");
  await expect(debts).toHaveCount(2);
  const older = debts.nth(1).getByRole("button");
  await expect(older).toHaveAccessibleName(
    "Відкрити борг: Лоран шоколад · M, з 01.10 · останній внесок 14.10, винні 1 500,00 грн",
  );
  expect(
    asked.some(
      (params) =>
        params.get("query") === "0507654321" && params.get("status") === "OPEN",
    ),
  ).toBe(true);
  // None is chosen beforehand; the seller's choice opens.
  await older.click();
  await expect(
    page.locator(".debt-detail h2", { hasText: "Ірина Коваль" }),
  ).toBeVisible();
  await expect(page.locator(".debt-context")).toHaveText(
    "050 765 43 21 · Лоран шоколад · M · з 01.10",
  );
  // Back to the card it was opened from, by the customer's name.
  await page.getByRole("button", { name: "Ірина Коваль", exact: true }).click();
  await expect(debts).toHaveCount(2);
  await page.getByRole("button", { name: "До боргів" }).click();
  await expect(rows(page)).toHaveCount(2);
});

test("a customer who no longer owes, read by their phone, leaves for the list, never sums kept", async ({
  page,
}) => {
  await summary(page);
  await customers(page, [oksana(), iryna()], (params) =>
    params.get("query") === "0507654321" && params.get("limit") === "5"
      ? { items: [] }
      : null,
  );
  await credits(page);
  await page.getByRole("button", { name: /^Відкрити борг: Ірина/ }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByLabel("Скільки винні магазину")).toBeVisible();
});

test("the paid and written off are asked for under the list, each saying how it closed", async ({
  page,
}) => {
  await summary(page);
  const asked = await customers(page, [
    oksana(),
    customer("Марта Бойко", "063 111 22 33", [
      debt("Альпака сіра · L", "0.00", { status: "SETTLED" }),
    ]),
    customer("Петро Ткач", "097 444 55 66", [
      debt("Лоран шоколад · M", "0.00", { status: "WRITTEN_OFF" }),
    ]),
  ]);
  await credits(page);
  await expect(rows(page)).toHaveCount(1);
  await page
    .getByRole("button", { name: "Показати сплачені й списані" })
    .click();
  await expect(rows(page)).toHaveCount(3);
  expect(asked.at(-1)?.get("status")).toBeNull();
  const settled = page.getByRole("button", { name: /^Відкрити борг: Марта/ });
  await expect(settled).toHaveAccessibleName(
    "Відкрити борг: Марта Бойко, сплачено",
  );
  await expect(settled.getByText("Сплачено", { exact: true })).toHaveClass(
    "badge",
  );
  await expect(
    page
      .getByRole("button", { name: /^Відкрити борг: Петро/ })
      .getByText("Списано", { exact: true }),
  ).toHaveClass(/\bneutral\b/);
  await page.getByRole("button", { name: "Лише ті, хто винен" }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(asked.at(-1)?.get("status")).toBe("OPEN");
});

test("switching to the paid and written off never shows those who owe as them while it reads", async ({
  page,
}) => {
  await summary(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await customers(page, [oksana()]);
  // The read of everyone waits until let go.
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("status") === null)
      await held;
    await route.fallback();
  });
  await credits(page);
  await expect(rows(page)).toHaveCount(1);
  await page
    .getByRole("button", { name: "Показати сплачені й списані" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Завантажуємо борги…");
  await expect(page.locator(".placeholder .debt-row")).toHaveCount(3);
  await expect(rows(page)).toHaveCount(0);
  // The switch stays where it was pressed.
  await expect(
    page.getByRole("button", { name: "Лише ті, хто винен" }),
  ).toBeVisible();
  release();
  await expect(rows(page)).toHaveCount(1);
});

test("a closed store's customer of more debts is read among the closed stores", async ({
  page,
}) => {
  await summary(page);
  // Found only among the stores that do not trade, by the whole phone.
  const asked = await customers(page, [], (params) =>
    params.get("elsewhere") === "true" ? { items: [iryna()] } : null,
  );
  // This store's answer for the number, slow: nothing offered before it
  // (review, 2026-10-19).
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("elsewhere") !== "true" && params.get("query"))
      await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fallback();
  });
  await credits(page);
  const ask = page.getByRole("button", {
    name: "Борг магазину, що зараз не працює? Шукати за цим номером",
  });
  // A whole number searched here first, owing nothing here: the rule said,
  // and the same number asked of the closed stores, by a tap, under it
  // (owner decision, 2026-10-18, В2 (а); credits task list, P1-1).
  // The list as it opened, read first: what loads next is the number's.
  await expect(page.getByText(beginsAt, { exact: true })).toBeVisible();
  const asking = page.waitForRequest(
    (request) =>
      request.url().includes("/credits/customers?") &&
      request.url().includes("query=") &&
      !request.url().includes("elsewhere=true"),
  );
  await field(page).fill("050 765 43 21");
  await asking;
  // Its rows' places while it reads (credits task list, P2-3).
  await expect(page.locator(".placeholder .debt-row")).toHaveCount(3);
  expect(await ask.count()).toBe(0);
  const none = page.getByText(
    "За цим номером у цьому магазині боргів немає. Внесок приймає магазин, де продали.",
    { exact: true },
  );
  await expect(none).toBeVisible();
  // A digit more is a number not yet searched: nothing offered for the one
  // before it, at once.
  await expect(ask).toBeVisible();
  await field(page).fill("050 765 43 210");
  expect(await ask.count()).toBe(0);
  await field(page).fill("050 765 43 21");
  await expect(ask).toBeVisible();
  const said = await none.boundingBox();
  const under = await ask.boundingBox();
  if (!said || !under) throw new Error("not laid out");
  expect(under.y).toBeGreaterThan(said.y);
  await page.waitForTimeout(500);
  expect(asked.filter((params) => params.get("elsewhere") === "true")).toEqual(
    [],
  );
  await ask.click();
  // One field, as it was: the number typed is the one asked.
  await expect(field(page)).toHaveValue("050 765 43 21");
  await page.getByRole("button", { name: /^Відкрити борг: Ірина/ }).click();
  await expect(
    page.getByRole("heading", { name: "Ірина Коваль", level: 2 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Борги: Ірина Коваль" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  expect(
    asked.some(
      (params) =>
        params.get("limit") === "5" &&
        params.get("query") === "0507654321" &&
        params.get("elsewhere") === "true",
    ),
  ).toBe(true);
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
  test(`in the ${name} theme what is owed, the names, the meta and a customer's phone read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await summary(page);
    await customers(page, [oksana(), iryna()]);
    await credits(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    // Measured once read: the places while it is read are other elements.
    await expect(
      page.getByLabel("Скільки винні магазину").locator(".owed-sum"),
    ).toHaveText("12 400,00 грн");
    await expect(rows(page)).toHaveCount(2);
    for (const part of [
      page.locator(".owed-sum"),
      page.locator(".owed-what"),
      page.locator(".owed-count"),
      page.locator(".debt-mark").first(),
      page.locator(".debt-name").first(),
      page.locator(".debt-owed").first(),
      page.locator(".debt-row .sale-meta").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/credits-list-${name}.png` });
    await page.getByRole("button", { name: /^Відкрити борг: Ірина/ }).click();
    await expect(page.locator(".owed-sum")).toHaveText("4 000,00 грн");
    // Their phone, to call, in the theme's accent, never the browser's blue.
    const phone = page.locator("a[href^='tel:']");
    await expect(phone).toHaveCSS("color", await accentText(page));
    expect(await contrast(phone)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `test-results/credits-customer-${name}.png`,
    });
  });

/** A colour token as the page resolves it in the theme it is in. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

for (const [name, theme, scheme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
] as const)
  test(`in the ${name} theme each pill is by what it means, and a debt, its history, its panel and a payment's result read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await summary(page);
    // Owed, with a payment typed from paper in its history.
    const owing = customer("Оксана Петренко", "067 123 45 67", [
      debt("Лоран шоколад · M", "2000.00", {
        entries: [
          {
            kind: "PAYMENT",
            amount: "1000.00",
            cash_back: "0.00",
            at: "2026-10-13T09:00:00Z",
            by: "Оля",
            note: null,
            taken_at: null,
            payment_method: "CASH",
            corrected: false,
            outage: {
              by_user_id: null,
              by: "Ганна",
              at: "2026-10-12T16:40:00Z",
              first_days: false,
            },
          },
        ],
      }),
    ]);
    // Owed to a closed store, its debt named by it, as the closed stores'
    // view shows it; paid off; written off; and both, nothing owed.
    const away = customer("Ірина Коваль", "050 765 43 21", [
      debt("Альпака сіра · L", "1500.00", {
        store_id: randomUUID(),
        store_name: "Ринок",
        store_state: "ARCHIVED",
      }),
    ]);
    const paidOff = customer("Олена Шевчук", "067 222 33 44", [
      debt("Лоран шоколад · L", "0.00", {
        status: "SETTLED",
        paid: "3000.00",
        closed_at: "2026-10-10T10:00:00Z",
      }),
    ]);
    const gone = customer("Марко Бондар", "063 111 22 33", [
      debt("Пальто «Затишок» · M", "0.00", {
        status: "WRITTEN_OFF",
        written_off: "2000.00",
        closed_at: "2026-10-11T10:00:00Z",
      }),
    ]);
    const neither = customer("Галина Мельник", "093 444 55 66", [
      debt("Лоран шоколад · S", "0.00", {
        status: "SETTLED",
        paid: "3000.00",
        closed_at: "2026-10-09T10:00:00Z",
      }),
      debt("Альпака сіра · M", "0.00", {
        status: "WRITTEN_OFF",
        written_off: "1500.00",
        closed_at: "2026-10-08T10:00:00Z",
      }),
    ]);
    await customers(page, [owing, away, paidOff, gone, neither]);
    // The whole of what is owed, paid: the debt paid off.
    await page.route(`**/api/v1/credits/*/payments`, async (route) => {
      await route.fulfill({
        status: 201,
        json: {
          ...owing.credits[0],
          status: "SETTLED",
          paid: "3000.00",
          owed: "0.00",
          closed_at: "2026-10-21T10:00:00Z",
        },
      });
    });
    await credits(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    await page
      .getByRole("button", { name: "Показати сплачені й списані" })
      .click();
    await expect(rows(page)).toHaveCount(5);
    // By what it means (credits task list, P2-4): paid off is the accent's;
    // written off, nothing owed and another store say nothing to do.
    const accent = page.getByText("Сплачено", { exact: true });
    await expect(accent).toHaveClass("badge");
    for (const pill of [
      page.getByText("Списано", { exact: true }),
      page.getByText("Нічого не винні", { exact: true }),
      page.getByText("Магазин «Ринок»", { exact: true }),
    ])
      await expect(pill).toHaveClass("badge neutral");
    for (const pill of [
      accent,
      page.getByText("Списано", { exact: true }),
      page.getByText("Нічого не винні", { exact: true }),
      page.getByText("Магазин «Ринок»", { exact: true }),
    ])
      expect(await contrast(pill)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/credits-pills-${name}.png` });

    await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
    await expect(page.locator(".owed-sum")).toHaveText("2 000,00 грн");
    // From paper, a warning's colour, its words as they were; the paper's
    // time in the phone's own zone, as the app writes it.
    const at = await page.evaluate(() =>
      new Date("2026-10-12T16:40:00Z").toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    const paper = page.locator(".history-meta .paper-meta");
    await expect(paper).toHaveText(
      `Внесок під час збою · хто прийняв: Ганна · за папером 12.10, ${at}`,
    );
    await expect(paper).toHaveCSS("color", await token(page, "--warn"));
    await expect(page.locator(".history-meta").first()).toContainText(
      `Внесок під час збою · хто прийняв: Ганна · за папером 12.10, ${at} · внесено: Оля`,
    );
    await page.getByRole("button", { name: "Увесь залишок" }).click();
    const panel = page.locator(".pay-panel");
    for (const part of [
      page.locator(".owed-what"),
      page.locator(".owed-sum"),
      page.locator(".owed-count"),
      page.locator(".history-what").first(),
      page.locator(".history-meta").first(),
      paper,
      page.locator(".history-sum").first(),
      panel.locator(".pay-total"),
      panel.getByRole("button", { name: "Готівка", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // The meta of a debt's screens at 14 px (P2-4).
    for (const meta of [
      page.locator(".owed-count"),
      page.locator(".history-meta").first(),
      page.locator(".debt-context"),
    ])
      await expect(meta).toHaveCSS("font-size", "14px");
    // The history above the panel, as the seller scrolls to it.
    await paper.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/credits-debt-${name}.png` });

    await panel.getByRole("button", { name: "Готівка", exact: true }).click();
    const result = page.locator(".paid-result");
    await expect(result.locator(".hand-back-sum")).toHaveText("2 000,00 грн");
    await expect(result.locator(".paid-owed")).toHaveText(
      "Борг сплачено повністю.",
    );
    for (const part of [
      result.getByRole("heading", { name: "Внесок записано" }),
      result.locator(".way-pill"),
      result.locator(".hand-back-sum"),
      result.locator(".paid-owed"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/credits-paid-${name}.png` });
  });
