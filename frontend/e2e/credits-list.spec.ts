import { test, expect, openStore, section } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Покупці» (spec S19, S20; «Усе на бірці» sections task list, P0-4,
 * P0-5): a block a store where this person takes payments, the open one
 * first, each with what that store is owed as the server summed it, never
 * added to another's; «Ім’я або телефон» searched as it is typed, in every
 * block; «Винні зараз · Сплачені · Списані» choosing which debts; a row a
 * customer with what they owe and never a sale's sum or a way; «Показати
 * ще» reading twenty more of its own store. A row opens the customer's
 * card: their letters and phone, a block a store read by the phone, the
 * history, and «Внесок». The stores' debts are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  /** «Другий», where «Оля» takes payments too. */
  second_store_id: string;
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

/** A debt of «Другий». */
function second(
  goods: string,
  owed: string,
  extra: Partial<StubCredit> = {},
): StubCredit {
  return debt(goods, owed, {
    store_id: fixture.second_store_id,
    store_name: "Другий",
    ...extra,
  });
}

/** One phone, one customer: what they owe in all is the debts' sum. */
function customer(
  name: string,
  phone: string,
  credits: StubCredit[],
): StubCustomer {
  return shaped({
    phone_digits: phone.replace(/\D/g, ""),
    customer_name: name,
    customer_phone: phone,
    owed: "0.00",
    open_debts: 0,
    credits: credits.map((each) => ({
      ...each,
      customer_name: name,
      customer_phone: phone,
    })),
  });
}

/** As the server sums a customer: over the debts it answers with. */
function shaped(one: StubCustomer): StubCustomer {
  return {
    ...one,
    owed: one.credits
      .reduce((sum, each) => sum + Number(each.owed), 0)
      .toFixed(2),
    open_debts: one.credits.filter((each) => each.status === "OPEN").length,
  };
}

/** Each store's customers, answered page by page as the server pages them,
 * by the status asked; what each read asked. `every` is «Основний»'s, and
 * any other store's not named in `stores`. `answer` refuses or reshapes a
 * read. */
async function customers(
  page: Page,
  every: StubCustomer[],
  answer?: (
    params: URLSearchParams,
  ) => { status: number } | { items: StubCustomer[] } | null,
  stores: Record<string, StubCustomer[]> = {},
): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push(params);
    const limit = Number(params.get("limit") ?? "20");
    const offset = Number(params.get("offset") ?? "0");
    const reshaped = answer?.(params) ?? null;
    if (reshaped && "status" in reshaped) {
      await route.fulfill({
        status: reshaped.status,
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
    const status = params.get("status");
    const found = (
      reshaped?.items ??
      stores[params.get("store_id") ?? ""] ??
      every
    )
      .map((each) =>
        shaped({
          ...each,
          credits:
            status === null
              ? each.credits
              : each.credits.filter((one) => one.status === status),
        }),
      )
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

interface Owed {
  owed: string;
  customers: number;
  debts: number;
}

/** What each store is owed: «Основний»'s, and any other's not named in
 * `stores`. */
async function summary(
  page: Page,
  owed = "12400.00",
  people = 8,
  debts = 11,
  stores: Record<string, Owed> = {},
): Promise<void> {
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    const store =
      new URL(route.request().url()).searchParams.get("store_id") ?? "";
    await route.fulfill({
      json: stores[store] ?? { owed, customers: people, debts },
    });
  });
}

interface MeStore {
  id: string;
  state: string;
  permissions: string[];
}

/**
 * «Покупці» opened in «Основний». Оля's stores as `/me` gives them, only
 * those of `ids` — «Основний» alone unless more are named: one block, a
 * store's own words — each as `edit` leaves it.
 */
async function credits(
  page: Page,
  {
    theme,
    ids = [fixture.store_id],
    edit,
  }: {
    theme?: Record<string, string>;
    ids?: readonly string[];
    edit?: (store: MeStore) => void;
  } = {},
): Promise<void> {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { stores: MeStore[] };
    body.stores = body.stores.filter((store) => ids.includes(store.id));
    if (edit) for (const store of body.stores) edit(store);
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch(theme));
  await openStore(page, "Основний MAIN");
  await section(page, "Покупці");
}

/** «Основний» and «Другий»: two blocks. */
const both = [fixture.store_id, fixture.second_store_id] as const;

function rows(page: Page, name = "Хто винен"): Locator {
  return page.getByRole("list", { name, exact: true }).getByRole("listitem");
}

function field(page: Page): Locator {
  return page.getByLabel("Ім’я або телефон");
}

function statusWay(page: Page, name: string): Locator {
  return page
    .getByRole("group", { name: "Які борги показати" })
    .getByRole("button", { name, exact: true });
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

test("«Покупці» says who they are, the store's block what it is owed, large, and a row a customer: what they owe, never a sale's sum or a way", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await summary(page);
  const asked = await customers(page, [oksana(), iryna()]);
  await credits(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупці");
  await expect(page.locator(".credits-context")).toHaveText(
    "Ті, хто купує частинами",
  );
  await expect(
    page.getByRole("heading", { name: "Магазину «Основний» винні" }),
  ).toBeVisible();
  const owed = page.getByRole("group", {
    name: "Скільки винні магазину «Основний»",
  });
  await expect(owed.locator(".owed-sum")).toHaveText("12 400,00 грн");
  // In the debt's colour, with its glyph (spec §6.17).
  await expect(owed.locator(".owed-sum svg")).toHaveCount(1);
  await expect(owed).toContainText("8 покупців · 11 боргів");

  const one = page.getByRole("button", { name: /^Відкрити борг: Оксана/ });
  await expect(one).toHaveAccessibleName(
    "Відкрити борг: Оксана Петренко, винні 2 000,00 грн",
  );
  // Two letters (spec §6.26).
  await expect(one.locator(".debt-mark")).toHaveText("ОП");
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
  // Those who owe now, as the server selects them (В2 (а)).
  expect(asked.map((params) => params.get("status"))).toContain("OPEN");
  expect(asked.every((params) => params.get("status") === "OPEN")).toBe(true);

  // «Винні зараз · Сплачені · Списані», the first pressed; nothing to
  // refresh or explain.
  await expect(statusWay(page, "Винні зараз")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const other of ["Сплачені", "Списані"])
    await expect(statusWay(page, other)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  for (const gone of ["Оновити", "Знайти", "Показати сплачені й списані"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  // At 360 × 640 the heading, the field, the switch, the block's words and
  // the first row, without scrolling, over the menu (P0-4).
  for (const part of [
    page.getByRole("heading", { level: 1 }),
    field(page),
    page.getByRole("group", { name: "Які борги показати" }),
    page.getByRole("heading", { name: "Магазину «Основний» винні" }),
    rows(page).first(),
  ])
    await expect(part).toBeInViewport({ ratio: 1 });
  const first = await rows(page).first().boundingBox();
  const menu = await page
    .getByRole("navigation", { name: "Розділи" })
    .boundingBox();
  if (!first || !menu) throw new Error("not laid out");
  expect(first.y + first.height).toBeLessThanOrEqual(menu.y);
  expect(first.height).toBeGreaterThanOrEqual(44);
  // How long a name and a phone are kept, under the last block (В3 (а)).
  await expect(page.locator(".credits-kept")).toHaveText(
    "Покупець з’являється тут, коли купує частинами. Ім’я й телефон боргу зберігаємо рік після того, як його закрито, і 3 роки після списання.",
  );
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

test("two stores are two blocks, the open one first, each owed what its own summary says and never their sum; each searched, and each «Показати ще» reads its own store (S19 acceptance)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  // 12 400 and 2 600: 15 000 is said nowhere.
  await summary(page, "12400.00", 8, 11, {
    [fixture.second_store_id]: { owed: "2600.00", customers: 2, debts: 2 },
  });
  const every = Array.from({ length: 25 }, (_, n) =>
    customer(
      `Покупець ${String(n + 1).padStart(2, "0")}`,
      `067 000 00 ${String(n + 10).padStart(2, "0")}`,
      [debt("Лоран шоколад · M", "400.00")],
    ),
  );
  const asked = await customers(page, [oksana(), ...every], undefined, {
    [fixture.second_store_id]: [
      customer("Вікторія Савчук", "066 000 24 68", [
        second("Лагуна персик · L", "2000.00"),
      ]),
    ],
  });
  await credits(page, { ids: both });

  const heads = page.locator(".credits-block h3");
  await expect(heads).toHaveText([
    "Магазину «Основний» винні",
    "Магазину «Другий» винні",
  ]);
  await expect(
    page
      .getByRole("group", { name: "Скільки винні магазину «Основний»" })
      .locator(".owed-sum"),
  ).toHaveText("12 400,00 грн");
  const there = page.getByRole("group", {
    name: "Скільки винні магазину «Другий»",
  });
  await expect(there.locator(".owed-sum")).toHaveText("2 600,00 грн");
  await expect(there).toContainText("2 покупці · 2 борги");
  // Each block's rows, read from its store alone.
  const here = rows(page, "Хто винен магазину «Основний»");
  const away = rows(page, "Хто винен магазину «Другий»");
  await expect(here).toHaveCount(20);
  await expect(away).toHaveCount(1);
  await expect(away).toContainText("Вікторія Савчук");
  await expect(page.locator("body")).not.toContainText(/15\s000,00/);
  await page.screenshot({
    path: "test-results/customers-two-blocks.png",
    fullPage: true,
  });

  // «Показати ще» of «Основний»'s block reads «Основний» alone.
  const more = page.getByRole("button", { name: "Показати ще" });
  await expect(more).toHaveCount(1);
  const before = asked.length;
  await more.click();
  await expect(here).toHaveCount(26);
  const paged = asked.slice(before);
  expect(paged.map((params) => params.get("store_id"))).toEqual([
    fixture.store_id,
  ]);
  expect(paged[0]?.get("offset")).toBe("20");
  expect(paged[0]?.get("limit")).toBe("20");
  await expect(away).toHaveCount(1);

  // A search, in every block: where none is found, a short line.
  await field(page).fill("Вікторія");
  await expect(away).toHaveCount(1);
  await expect(here).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Магазину «Основний» винні" })
      .getByText("Нікого не знайдено.", { exact: true }),
  ).toBeVisible();
  for (const store of both)
    expect(
      asked.some(
        (params) =>
          params.get("store_id") === store &&
          params.get("query") === "Вікторія",
      ),
    ).toBe(true);

  // «Сплачені»: each block by its store's name alone, no sums.
  await field(page).fill("");
  await statusWay(page, "Сплачені").click();
  await expect(heads).toHaveText(["Магазин «Основний»", "Магазин «Другий»"]);
  await expect(page.getByRole("group", { name: /^Скільки винні/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Сплачених боргів тут немає.", { exact: true }),
  ).toHaveCount(2);
});

test("while «Покупці» is read, the store's sum and three rows keep their places, and the field does not move", async ({
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
  // Being read (credits task list, P2-3): the store's sum's and three
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

test("a store's sum that cannot be read keeps its place, says so, and is read again — the field never moves (owner decision, 2026-10-21)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await customers(page, [oksana(), iryna()]);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fails = true;
  // The read again, held: the block keeps saying so, its button waiting.
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
  const card = page.getByRole("group", {
    name: "Скільки винні магазину «Основний»",
  });
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

/** What an empty «Покупці» teaches (credits task list, P1-4). */
const beginsAt =
  "Зараз ніхто не винен. Борг з’являється, коли продають частинами.";

test("an empty «Покупці» says where a debt begins, «Сплачені» and «Списані» their own words, and «Новий продаж» leads to the till", async ({
  page,
}) => {
  await summary(page, "0.00", 0, 0);
  const asked = await customers(page, []);
  await credits(page);
  const empty = page.getByText(beginsAt, { exact: true });
  await expect(empty).toBeVisible();
  // A search that finds nothing says so, never where debts begin.
  await field(page).fill("Оксана");
  await expect(page.getByText(/За «Оксана» боргів не знайдено/)).toBeVisible();
  await expect(empty).toHaveCount(0);
  await field(page).fill("");
  await expect(empty).toBeVisible();
  // The paid and the written off: each its own words, each its own status.
  await statusWay(page, "Сплачені").click();
  await expect(
    page.getByText("Сплачених боргів тут немає.", { exact: true }),
  ).toBeVisible();
  await expect(statusWay(page, "Сплачені")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(asked.at(-1)?.get("status")).toBe("SETTLED");
  await expect(empty).toHaveCount(0);
  await statusWay(page, "Списані").click();
  await expect(
    page.getByText("Списаних боргів тут немає.", { exact: true }),
  ).toBeVisible();
  expect(asked.at(-1)?.get("status")).toBe("WRITTEN_OFF");
  await statusWay(page, "Винні зараз").click();
  await expect(empty).toBeVisible();
  // «Продаж» is the till; «Каса» is the drawer.
  await page.getByRole("button", { name: "Новий продаж" }).click();
  await expect(page.getByLabel("Знайти модель")).toBeFocused();
});

test("a store that does not trade keeps its words for an empty «Покупці»: no debt begins there", async ({
  page,
}) => {
  await summary(page, "0.00", 0, 0);
  await customers(page, []);
  await credits(page, {
    edit: (store) => {
      if (store.id === fixture.store_id) store.state = "BLOCKED";
    },
  });
  await expect(
    page.getByText("Зараз ніхто не винен цьому магазину.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(beginsAt, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Новий продаж" })).toHaveCount(
    0,
  );
  // Who takes its payments, under its block.
  await expect(
    page.getByText("Внески приймає будь-який магазин мережі, що працює.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("for whoever may not sell, an empty «Покупці» says where a debt begins and leads nowhere", async ({
  page,
}) => {
  await summary(page, "0.00", 0, 0);
  await customers(page, []);
  await credits(page, {
    edit: (store) => {
      store.permissions = store.permissions.filter(
        (right) => right !== "sale:create",
      );
    },
  });
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
  expect(reads.map((params) => params.get("status"))).toEqual([
    "OPEN",
    "OPEN",
    "OPEN",
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

test("a row opens the customer's card: one debt is the store's block, with what is paid; more are rows, each opening its debt; back by the name, then «← Покупці» (S20)", async ({
  page,
}) => {
  await summary(page);
  // Read by the phone, the customer is as the server says now, every
  // status: a debt paid off is theirs too.
  const asked = await customers(page, [oksana(), iryna()], (params) =>
    params.get("query") === "0507654321" && params.get("limit") === "5"
      ? {
          items: [
            customer("Ірина Коваль", "050 765 43 21", [
              debt("Альпака сіра · L", "2000.00"),
              debt("Лоран шоколад · M", "1500.00", {
                last_payment_at: "2026-10-14T10:00:00Z",
              }),
              debt("Пальто «Затишок» · M", "0.00", {
                status: "SETTLED",
                paid: "3000.00",
                closed_at: "2026-09-20T10:00:00Z",
                opened_at: "2026-09-01T10:00:00Z",
              }),
            ]),
          ],
        }
      : null,
  );
  await credits(page);

  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".customer-mark")).toHaveText("ОП");
  const block = page.getByRole("region", {
    name: "Магазину «Основний» винні",
  });
  await expect(block.locator(".owed-sum")).toHaveText("2 000,00 грн");
  await expect(block.locator(".customer-debt")).toContainText(
    "Лоран шоколад · M · з 01.10",
  );
  await expect(block.locator(".owed-count")).toHaveText(
    "Сплачено 1 000,00 грн з 3 000,00 грн",
  );
  // Read by their phone, every status, from the store that listed them.
  expect(
    asked.some(
      (params) =>
        params.get("query") === "0671234567" &&
        params.get("limit") === "5" &&
        params.get("status") === null &&
        params.get("store_id") === fixture.store_id,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Покупці", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole("button", { name: /^Відкрити борг: Ірина/ }).click();
  await expect(
    page.getByRole("heading", { name: "Ірина Коваль", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Магазину «Основний» винні" })
      .locator(".owed-sum"),
  ).toHaveText("3 500,00 грн");
  const debts = page
    .getByRole("list", { name: "Борги в магазині «Основний»" })
    .getByRole("listitem");
  await expect(debts).toHaveCount(3);
  const older = debts.nth(1).getByRole("button");
  await expect(older).toHaveAccessibleName(
    "Відкрити борг: Лоран шоколад · M, сплачено 1 000,00 грн з 3 000,00 грн, винні 1 500,00 грн",
  );
  // Closed: how, never an owed sum.
  await expect(debts.nth(2).getByRole("button")).toHaveAccessibleName(
    "Відкрити борг: Пальто «Затишок» · M, сплачено 3 000,00 грн з 3 000,00 грн, сплачено",
  );
  await expect(debts.nth(2).locator(".badge")).toHaveClass("badge paid");
  // None is chosen beforehand; the seller's choice opens.
  await older.click();
  await expect(
    page.getByRole("heading", { name: "Ірина Коваль", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".debt-context")).toHaveText(
    "050 765 43 21 · Лоран шоколад · M · з 01.10",
  );
  // Back to the card it was opened from, by the customer's name.
  await page.getByRole("button", { name: "Ірина Коваль", exact: true }).click();
  await expect(debts).toHaveCount(3);
  await page.getByRole("button", { name: "Покупці", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
});

test("a phone owing two stores: a block each, its sum from its own read and none added up; «Внесок» asks which of this store's debts, nothing chosen; the other store's says where it is paid (S20 acceptance)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await summary(page);
  const daryna = (
    credits: StubCredit[],
    name = "Дарина Мельник",
  ): StubCustomer => customer(name, "067 000 12 34", credits);
  const asked = await customers(
    page,
    [
      daryna([
        debt("Тоскана віскі · M", "3500.00"),
        debt("Лоран шоколад · S", "1200.00", {
          opened_at: "2026-10-05T10:00:00Z",
        }),
      ]),
    ],
    undefined,
    {
      // Written shorter there: the card is headed as the open store has
      // her, and «←» names her so (review, 2026-11-01).
      [fixture.second_store_id]: [
        daryna([second("Лагуна персик · L", "800.00")], "Дарина"),
      ],
    },
  );
  const sent: string[] = [];
  await page.route("**/api/v1/credits/*/payments", async (route) => {
    sent.push(route.request().url());
    await route.abort();
  });
  await credits(page, { ids: both });
  await rows(page, "Хто винен магазину «Другий»")
    .getByRole("button", { name: /^Відкрити борг: Дарина/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Дарина Мельник", level: 1 }),
  ).toBeVisible();
  const here = page.getByRole("region", {
    name: "Магазину «Основний» винні",
  });
  const there = page.getByRole("region", { name: "Магазину «Другий» винні" });
  await expect(here.locator(".owed-sum")).toHaveText("4 700,00 грн");
  await expect(there.locator(".owed-sum")).toHaveText("800,00 грн");
  await expect(there).toContainText("Внесок приймає «Другий»");
  // Paid there: no owner's ⋯ on it here.
  await expect(there.getByRole("button", { name: "Дії з боргом" })).toHaveCount(
    0,
  );
  // 4 700 + 800 is said nowhere.
  await expect(page.locator("body")).not.toContainText(/5\s500,00/);
  for (const store of both)
    expect(
      asked.some(
        (params) =>
          params.get("store_id") === store &&
          params.get("query") === "0670001234",
      ),
    ).toBe(true);
  // The header, the open store's block and «Внесок» at 360 × 640 without
  // scrolling (P0-5).
  const pay = page.getByRole("button", { name: "Внесок", exact: true });
  for (const part of [
    page.getByRole("heading", { level: 1 }),
    page.locator(".customer-phone"),
    here.locator(".owed-sum"),
    pay,
  ])
    await expect(part).toBeInViewport({ ratio: 1 });

  // Two debts here: which one, nothing chosen beforehand.
  await pay.click();
  const which = page.getByRole("dialog", { name: "На який борг вносить?" });
  const choices = which
    .getByRole("list", { name: "Борги, на які можна внести" })
    .getByRole("button");
  await expect(choices).toHaveText([
    /^Тоскана віскі · M\s*з 01\.10\s*3\s500,00\sгрн/,
    /^Лоран шоколад · S\s*з 05\.10\s*1\s200,00\sгрн/,
  ]);
  await expect(which.getByText("Лагуна персик")).toHaveCount(0);
  // Once it takes taps: one carried from «Внесок» is let go.
  await expect(which).toHaveAttribute("data-ready", "");
  await choices.nth(1).click();
  // S21 on the debt chosen; back to the card by her name.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Лоран шоколад · S",
  );
  await expect(page.getByLabel("Сума, грн")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Розділи" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Дарина Мельник", exact: true })
    .click();
  await expect(here.locator(".owed-sum")).toHaveText("4 700,00 грн");
  await expect(page.getByRole("navigation", { name: "Розділи" })).toBeVisible();
  expect(sent).toEqual([]);
});

test("one debt: «Внесок» opens S21 on it at once; «Скопіювати» puts the phone as it was written", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await summary(page);
  await customers(page, [oksana(), iryna()]);
  await credits(page);
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  const phone = page.locator(".customer-phone");
  await expect(phone).toHaveText("067 123 45 67");
  await expect(phone).toHaveAttribute("href", "tel:0671234567");
  await page.getByRole("button", { name: "Скопіювати телефон" }).click();
  await expect(page.getByText("Телефон скопійовано")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "067 123 45 67",
  );
  const copy = await page
    .getByRole("button", { name: "Скопіювати телефон" })
    .boundingBox();
  expect(copy?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Внесок", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Лоран шоколад · M",
  );
  await expect(
    page.getByRole("dialog", { name: "На який борг вносить?" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Оксана Петренко", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
  ).toBeVisible();
});

test("a phone with nothing to pay here shows no «Внесок»: paid off", async ({
  page,
}) => {
  await summary(page);
  await customers(page, [
    customer("Марта Бойко", "063 111 22 33", [
      debt("Альпака сіра · L", "0.00", {
        status: "SETTLED",
        paid: "3000.00",
        closed_at: "2026-10-10T10:00:00Z",
      }),
    ]),
  ]);
  await credits(page);
  await statusWay(page, "Сплачені").click();
  await page.getByRole("button", { name: /^Відкрити борг: Марта/ }).click();
  await expect(
    page.getByRole("heading", { name: "Марта Бойко", level: 1 }),
  ).toBeVisible();
  // Its block: how it closed, and when; never «винні».
  await expect(
    page.getByRole("heading", { name: "Магазин «Основний»: не винні" }),
  ).toBeVisible();
  await expect(page.locator(".customer-debt")).toContainText(
    "Сплачено Закрито 10.10",
  );
  await expect(page.locator(".customer-owed")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Внесок", exact: true }),
  ).toHaveCount(0);
});

test("a phone owing only another store shows no «Внесок» here: where it is paid, and this store owed nothing", async ({
  page,
}) => {
  await summary(page);
  await customers(page, [], undefined, {
    [fixture.second_store_id]: [
      customer("Вікторія Савчук", "066 000 24 68", [
        second("Лагуна персик · L", "2000.00"),
      ]),
    ],
  });
  await credits(page, { ids: both });
  await rows(page, "Хто винен магазину «Другий»")
    .getByRole("button", { name: /^Відкрити борг: Вікторія/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Вікторія Савчук", level: 1 }),
  ).toBeVisible();
  const there = page.getByRole("region", { name: "Магазину «Другий» винні" });
  await expect(there.locator(".owed-sum")).toHaveText("2 000,00 грн");
  await expect(there).toContainText("Внесок приймає «Другий»");
  await expect(
    page.getByText("Магазин «Основний»: не винні", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Внесок", exact: true }),
  ).toHaveCount(0);
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
  const read = page.waitForRequest((request) => {
    const params = new URL(request.url()).searchParams;
    return params.get("query") === "0507654321" && params.get("limit") === "5";
  });
  await page.getByRole("button", { name: /^Відкрити борг: Ірина/ }).click();
  // The card asked by her phone; with nothing under it, back on the list.
  await read;
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByLabel("Скільки винні магазину")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Покупці");
  await expect(page.locator(".customer-card")).toHaveCount(0);
});

test("paid off on S21 opened from her card, back on it nothing read before shows — no old sum, no «Внесок» — until it is read again (review, 2026-11-01; S20)", async ({
  page,
}) => {
  await summary(page);
  const owing = oksana();
  await customers(page, [owing, iryna()]);
  const [only] = owing.credits;
  if (!only) throw new Error("no debt");
  const paidOff: StubCredit = {
    ...only,
    status: "SETTLED",
    paid: "3000.00",
    owed: "0.00",
    closed_at: "2026-10-21T10:00:00Z",
  };
  await page.route("**/api/v1/credits/*/payments", async (route) => {
    await route.fulfill({ status: 201, json: paidOff });
  });
  // Once paid, the card's read by her phone waits.
  let paid = false;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (!paid || params.get("limit") !== "5") {
      await route.fallback();
      return;
    }
    await held;
    await route.fulfill({
      json: {
        items: [shaped({ ...owing, credits: [paidOff] })],
        has_more: false,
      },
    });
  });
  await credits(page);
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  const card = page.locator(".customer-card");
  await expect(card.locator(".customer-owed")).toHaveText("2 000,00 грн");
  await page.getByRole("button", { name: "Внесок", exact: true }).click();
  paid = true;
  await page
    .getByRole("button", { name: "Увесь залишок 2 000,00 грн" })
    .click();
  await page
    .getByRole("group", { name: "Внесок", exact: true })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  const result = page.locator(".paid-result");
  await expect(result).toBeVisible();
  await result
    .getByRole("button", { name: "Оксана Петренко", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
  ).toBeVisible();
  // Read again: nothing of before, nothing to pay on it.
  await expect(card).toBeVisible();
  await expect(card).not.toContainText(/2\s000,00/);
  await expect(
    page.getByRole("button", { name: "Внесок", exact: true }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("heading", { name: "Магазин «Основний»: не винні" }),
  ).toBeVisible();
  await expect(card.locator(".customer-debt .badge")).toHaveText("Сплачено");
  await expect(
    page.getByRole("button", { name: "Внесок", exact: true }),
  ).toHaveCount(0);
});

test("«Сплачені» and «Списані» each ask their own status, each saying how it closed", async ({
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
  await statusWay(page, "Сплачені").click();
  await expect(rows(page)).toHaveCount(1);
  expect(asked.at(-1)?.get("status")).toBe("SETTLED");
  const settled = page.getByRole("button", { name: /^Відкрити борг: Марта/ });
  await expect(settled).toHaveAccessibleName(
    "Відкрити борг: Марта Бойко, сплачено",
  );
  await expect(settled.getByText("Сплачено", { exact: true })).toHaveClass(
    "badge paid",
  );
  // The paid have no sum owed: the block is the store's name alone.
  await expect(
    page.getByRole("heading", { name: "Магазин «Основний»", exact: true }),
  ).toBeVisible();
  await statusWay(page, "Списані").click();
  await expect(rows(page)).toHaveCount(1);
  expect(asked.at(-1)?.get("status")).toBe("WRITTEN_OFF");
  await expect(
    page
      .getByRole("button", { name: /^Відкрити борг: Петро/ })
      .getByText("Списано", { exact: true }),
  ).toHaveClass(/\bneutral\b/);
  await statusWay(page, "Винні зараз").click();
  await expect(rows(page)).toHaveCount(1);
  expect(asked.at(-1)?.get("status")).toBe("OPEN");
});

test("under «Сплачені» a customer of two paid debts says «Сплачено», never «Нічого не винні»: they may owe here now (review, 2026-11-01)", async ({
  page,
}) => {
  await summary(page);
  await customers(page, [
    customer("Дарина Мельник", "067 000 12 34", [
      debt("Тоскана віскі · M", "5000.00"),
      debt("Альпака сіра · L", "0.00", { status: "SETTLED" }),
      debt("Лоран шоколад · S", "0.00", { status: "SETTLED" }),
    ]),
  ]);
  await credits(page);
  const daryna = page.getByRole("button", { name: /^Відкрити борг: Дарина/ });
  await expect(daryna).toHaveAccessibleName(
    /^Відкрити борг: Дарина Мельник, винні 5\s000,00\sгрн$/,
  );
  await statusWay(page, "Сплачені").click();
  await expect(daryna).toHaveAccessibleName(
    "Відкрити борг: Дарина Мельник, сплачено",
  );
  await expect(daryna).toContainText("2 борги");
  await expect(daryna.getByText("Сплачено", { exact: true })).toHaveClass(
    "badge paid",
  );
  await expect(daryna).not.toContainText("Нічого не винні");
});

test("switching to «Сплачені» never shows those who owe as them while it reads", async ({
  page,
}) => {
  await summary(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await customers(page, [
    oksana(),
    customer("Марта Бойко", "063 111 22 33", [
      debt("Альпака сіра · L", "0.00", { status: "SETTLED" }),
    ]),
  ]);
  // The read of the paid waits until let go.
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("status") === "SETTLED")
      await held;
    await route.fallback();
  });
  await credits(page);
  await expect(rows(page)).toHaveCount(1);
  await statusWay(page, "Сплачені").click();
  await expect(page.getByRole("status")).toHaveText("Завантажуємо борги…");
  await expect(page.locator(".placeholder .debt-row")).toHaveCount(3);
  await expect(rows(page)).toHaveCount(0);
  // The switch stays where it was pressed.
  await expect(statusWay(page, "Сплачені")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  release();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Марта Бойко");
});

test("a closed store's customer is read among the closed stores: a row a debt with its store, never their sum", async ({
  page,
}) => {
  await summary(page);
  // Found only among the stores that do not trade, by the whole phone: two
  // debts of two of them.
  const closedStores = (): StubCustomer =>
    customer("Ірина Коваль", "050 765 43 21", [
      debt("Альпака сіра · L", "2500.00", {
        store_id: randomUUID(),
        store_name: "Ринок",
        store_state: "ARCHIVED",
      }),
      debt("Лоран шоколад · M", "1500.00", {
        store_id: randomUUID(),
        store_name: "Поділ",
        store_state: "BLOCKED",
      }),
    ]);
  const asked = await customers(page, [], (params) =>
    params.get("elsewhere") === "true" ? { items: [closedStores()] } : null,
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
    page.getByRole("heading", { name: "Ірина Коваль", level: 1 }),
  ).toBeVisible();
  const closed = page.getByRole("region", { name: "Магазини, що не працюють" });
  const debts = closed
    .getByRole("list", { name: "Борги" })
    .getByRole("listitem");
  await expect(debts).toHaveCount(2);
  await expect(debts.nth(0).locator(".badge")).toHaveText("Магазин «Ринок»");
  await expect(debts.nth(1).locator(".badge")).toHaveText("Магазин «Поділ»");
  // 2 500 and 1 500, never 4 000.
  await expect(page.locator(".customer-owed")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/4\s000,00/);
  expect(
    asked.some(
      (params) =>
        params.get("limit") === "5" &&
        params.get("query") === "0507654321" &&
        params.get("elsewhere") === "true",
    ),
  ).toBe(true);
  // Taken here for them: which debt, each with its own store (spec S20;
  // review, 2026-11-01).
  await page.getByRole("button", { name: "Внесок", exact: true }).click();
  const which = page
    .getByRole("dialog", { name: "На який борг вносить?" })
    .getByRole("list", { name: "Борги, на які можна внести" })
    .getByRole("button");
  await expect(which).toHaveCount(2);
  await expect(which.nth(0)).toHaveAccessibleName(
    /^Альпака сіра · L, винні 2\s500,00\sгрн, магазин «Ринок»$/,
  );
  await expect(which.nth(0).locator(".badge")).toHaveText("Магазин «Ринок»");
  await expect(which.nth(1).locator(".badge")).toHaveText("Магазин «Поділ»");
});

test("the card's history: every debt's lines, the newest first, a debt opened «Частинами», a knot where one closed; seven, then «Ще N» opens the rest at the eighth", async ({
  page,
}) => {
  await summary(page);
  const entry = (
    at: string,
    amount: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    kind: "PAYMENT",
    amount,
    cash_back: "0.00",
    at,
    by: "Оля",
    note: null,
    taken_at: null,
    payment_method: "CASH",
    corrected: false,
    outage: null,
    ...extra,
  });
  await customers(page, [
    customer("Оксана Петренко", "067 123 45 67", [
      debt("Лоран шоколад · M", "1000.00", {
        opened_at: "2026-10-01T10:00:00Z",
        // The server's oldest first.
        entries: [
          entry("2026-10-05T10:00:00Z", "100.00"),
          entry("2026-10-10T10:00:00Z", "300.00"),
          entry("2026-10-15T10:00:00Z", "300.00", { payment_method: "CARD" }),
          entry("2026-10-20T10:00:00Z", "300.00"),
        ],
      }),
      debt("Альпака сіра · L", "0.00", {
        status: "SETTLED",
        opened_at: "2026-09-01T10:00:00Z",
        closed_at: "2026-09-25T10:00:00Z",
        entries: [
          entry("2026-09-12T10:00:00Z", "1000.00"),
          entry("2026-09-25T10:00:00Z", "1000.00"),
        ],
      }),
    ]),
  ]);
  await credits(page);
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  const lines = page
    .getByRole("list", { name: "Історія покупця" })
    .getByRole("listitem");
  await expect(lines).toHaveCount(7);
  await expect(lines.locator(".timeline-day")).toHaveText([
    "20.10",
    "15.10",
    "10.10",
    "05.10",
    "01.10",
    "25.09",
    "12.09",
  ]);
  await expect(lines.nth(1).locator(".timeline-what")).toHaveText(
    "Внесок · картка",
  );
  await expect(lines.nth(0).locator(".timeline-store")).toHaveText(
    "«Основний»",
  );
  // A debt opened: «Частинами», its sale's sum.
  await expect(lines.nth(4).locator(".timeline-what")).toHaveText("Частинами");
  await expect(lines.nth(4).locator(".timeline-sum")).toHaveText(
    "3 000,00 грн",
  );
  // The payment that paid it off, a knot.
  await expect(lines.nth(5).locator(".timeline-node")).toHaveClass(/\bknot\b/);
  await expect(page.locator(".timeline-node.knot")).toHaveCount(1);
  const more = page.getByRole("button", { name: "Ще 1" });
  await more.click();
  await expect(lines).toHaveCount(8);
  await expect(lines.nth(7)).toBeFocused();
  await expect(lines.nth(7).locator(".timeline-what")).toHaveText("Частинами");
  await expect(page.getByRole("button", { name: /^Ще \d/ })).toHaveCount(0);
  await expect(page.locator(".customer-kept")).toHaveText(
    "Ім’я й телефон зберігаємо, поки є борг, і ще рік після того, як його закрито (3 роки — після списання).",
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
  test(`in the ${name} theme at 360 × 640 the blocks, the rows, the card and its history read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await summary(page, "12400.00", 8, 11, {
      [fixture.second_store_id]: { owed: "2600.00", customers: 2, debts: 2 },
    });
    await customers(page, [oksana(), iryna()], undefined, {
      [fixture.second_store_id]: [
        customer("Вікторія Савчук", "066 000 24 68", [
          second("Лагуна персик · L", "2000.00"),
        ]),
      ],
    });
    await credits(page, { theme, ids: both });
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    // Measured once read: the places while it is read are other elements.
    await expect(
      page.getByLabel("Скільки винні магазину «Основний»").locator(".owed-sum"),
    ).toHaveText("12 400,00 грн");
    await expect(rows(page, "Хто винен магазину «Основний»")).toHaveCount(2);
    for (const part of [
      page.locator(".credits-context"),
      page.locator(".credits-block h3").first(),
      page.locator(".block-owed .owed-sum").first(),
      page.locator(".owed-count").first(),
      page.locator(".debt-mark").first(),
      page.locator(".debt-name").first(),
      page.locator(".debt-owed").first(),
      page.locator(".debt-row .sale-meta").first(),
      statusWay(page, "Винні зараз"),
      statusWay(page, "Сплачені"),
      page.locator(".credits-kept"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // The owed in the debt's colour (spec §6.17).
    await expect(page.locator(".block-owed .owed-sum").first()).toHaveCSS(
      "color",
      await token(page, "--debt"),
    );
    await page.screenshot({ path: `test-results/credits-list-${name}.png` });
    await page.screenshot({
      path: `test-results/credits-list-full-${name}.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: /^Відкрити борг: Ірина/ }).click();
    const block = page.getByRole("region", {
      name: "Магазину «Основний» винні",
    });
    await expect(block.locator(".owed-sum")).toHaveText("4 000,00 грн");
    // Their phone, to call, in the theme's accent, never the browser's blue.
    const phone = page.locator("a[href^='tel:']");
    await expect(phone).toHaveCSS("color", await token(page, "--accent-text"));
    for (const part of [
      phone,
      page.locator(".customer-mark"),
      page.getByRole("button", { name: "Скопіювати телефон" }),
      block.locator("h3"),
      block.locator(".owed-sum"),
      block.locator(".debt-name").first(),
      block.locator(".sale-meta").first(),
      page.locator(".customer-none"),
      page.locator(".timeline-what").first(),
      page.locator(".timeline-meta").first(),
      page.locator(".timeline-sum").first(),
      page.locator(".timeline-day").first(),
      page.locator(".customer-kept"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // The store's owed in the debt's colour, as on the list (spec §6.17).
    await expect(block.locator(".owed-sum")).toHaveCSS(
      "color",
      await token(page, "--debt"),
    );
    await expect(page.locator(".timeline-meta").first()).toHaveCSS(
      "font-size",
      "14px",
    );
    await page.screenshot({
      path: `test-results/credits-customer-${name}.png`,
    });
    await page.screenshot({
      path: `test-results/credits-customer-full-${name}.png`,
      fullPage: true,
    });
  });

for (const [name, theme, scheme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
] as const)
  test(`in the ${name} theme each pill is by what it means, and a card's paper payment, S21 and its result read at 4.5:1`, async ({
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
    // view shows it; paid off; written off; and two paid.
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
        status: "SETTLED",
        paid: "3000.00",
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
    await credits(page, { theme });
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    // By what it means (credits task list, P2-4): paid off is the accent's
    // green, the design's paid (P0-1); written off and another store say
    // nothing to do.
    await expect(rows(page)).toHaveCount(2);
    const ringed = page.getByText("Магазин «Ринок»", { exact: true });
    await expect(ringed).toHaveClass("badge neutral");
    expect(await contrast(ringed)).toBeGreaterThanOrEqual(4.5);
    await statusWay(page, "Сплачені").click();
    await expect(rows(page)).toHaveCount(2);
    // One debt paid or two, the same pill: never «Нічого не винні» — under
    // «Сплачені» only the paid are read, and more may be owed here (review,
    // 2026-11-01).
    const accent = page.getByText("Сплачено", { exact: true });
    await expect(accent).toHaveCount(2);
    for (const pill of await accent.all()) {
      await expect(pill).toHaveClass("badge paid");
      expect(await contrast(pill)).toBeGreaterThanOrEqual(4.5);
    }
    await expect(page.getByText("Нічого не винні")).toHaveCount(0);
    await page.screenshot({ path: `test-results/credits-pills-${name}.png` });
    await statusWay(page, "Списані").click();
    const written = page.getByText("Списано", { exact: true });
    await expect(written).toHaveClass("badge neutral");
    expect(await contrast(written)).toBeGreaterThanOrEqual(4.5);
    await statusWay(page, "Винні зараз").click();

    await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
    await expect(page.locator(".customer-owed")).toHaveText("2 000,00 грн");
    // From paper, a warning's colour, its words as they were; the paper's
    // time in the phone's own zone, as the app writes it.
    const at = await page.evaluate(() =>
      new Date("2026-10-12T16:40:00Z").toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    const paper = page.locator(".timeline-meta .paper-meta");
    await expect(paper).toHaveText(
      `Внесок під час збою · хто прийняв: Ганна · за папером 12.10, ${at}`,
    );
    await expect(paper).toHaveCSS("color", await token(page, "--warn"));
    await expect(page.locator(".timeline-meta").first()).toContainText(
      `Внесок під час збою · хто прийняв: Ганна · за папером 12.10, ${at} · внесено: Оля · Лоран шоколад · M`,
    );
    expect(await contrast(paper)).toBeGreaterThanOrEqual(4.5);
    await paper.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/credits-card-${name}.png` });

    // «Внесок»: S21, the whole of what is owed in a tap, a way.
    await page.getByRole("button", { name: "Внесок", exact: true }).click();
    const panel = page.getByRole("group", { name: "Внесок", exact: true });
    await page
      .getByRole("button", { name: "Увесь залишок 2 000,00 грн" })
      .click();
    for (const part of [
      page.locator(".owed-what"),
      page.locator(".owed-sum"),
      page.locator(".owed-count"),
      page.getByLabel("Сума, грн"),
      panel.getByRole("button", { name: "Готівка", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
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
    // Back to her card, by her name.
    await result
      .getByRole("button", { name: "Оксана Петренко", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
    ).toBeVisible();
  });
