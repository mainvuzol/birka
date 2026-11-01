import {
  test,
  expect,
  basketDone,
  gridCell,
  more,
  openModel,
  openStore,
  sections,
  tapSize,
  toTill,
  units,
} from "./fixtures";
import type { Page, Route } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A model's detail (spec S23; «Усе на бірці» sections task list, P0-6):
 * opened by its name on the till's search, its sizes on every warehouse the
 * store reads, «Можна продати» under them, nothing in the grid pressed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  count_location_id: string;
  till_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
function launch(): string {
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
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

const lorans = /^Лоран шоколад 70(?:\.0)? см$/;

// The store's warehouses as a phone of the TZ's acceptance reads them.
const MAIN = "10000000-0000-4000-8000-000000000001";
const OWN = "10000000-0000-4000-8000-000000000002";
const BIN = "10000000-0000-4000-8000-000000000003";
const PAUSED = "10000000-0000-4000-8000-000000000004";
const place = (
  id: string,
  name: string,
  look: Partial<{
    is_active: boolean;
    can_sell: boolean;
    damaged_returns: boolean;
  }> = {},
) => ({
  id,
  name,
  code: name,
  is_active: true,
  can_sell: true,
  can_receive: true,
  damaged_returns: false,
  ...look,
});
const sizeIds = {
  XS: "20000000-0000-4000-8000-000000000001",
  S: "20000000-0000-4000-8000-000000000002",
  M: "20000000-0000-4000-8000-000000000003",
  L: "20000000-0000-4000-8000-000000000004",
  XL: "20000000-0000-4000-8000-000000000005",
  XXL: "20000000-0000-4000-8000-000000000006",
  "?": "20000000-0000-4000-8000-000000000007",
} as const;
type Letter = keyof typeof sizeIds;
const MODEL = "Кокон графіт";
function row(
  location: string,
  size: Letter,
  quantity: number,
  reserved = 0,
  variant = fixture.variant_id,
  name = MODEL,
) {
  return {
    location_id: location,
    product_variant_id: variant,
    size_id: sizeIds[size],
    display_name: name,
    size_label: size === "?" ? "UNKNOWN" : size,
    size_is_unknown: size === "?",
    quantity,
    reserved_quantity: reserved,
    available_quantity: quantity - reserved,
    suggested_price: "3600.00",
  };
}

/**
 * The store's warehouses, its stock and its sizes as given: `selling`, what
 * a listing of every warehouse it sells from answers, a page a list;
 * `at`, each other warehouse's own. Another store's asking is the server's.
 */
async function shelves(
  page: Page,
  {
    locations,
    selling,
    at = {},
    sizes = ["XS", "S", "M", "L", "XL", "XXL"],
  }: {
    locations: ReturnType<typeof place>[];
    selling: ReturnType<typeof row>[][];
    at?: Record<string, ReturnType<typeof row>[]>;
    sizes?: Letter[];
  },
): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    if (!route.request().url().includes(fixture.store_id)) {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: locations });
  });
  await page.route("**/api/v1/catalog/sizes?**", async (route) => {
    await route.fulfill({
      json: sizes.map((size) => ({
        size_id: sizeIds[size],
        code: size,
        system: "LETTER",
      })),
    });
  });
  await page.route(
    "**/api/v1/catalog/stock-options?**",
    async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("store_id") !== fixture.store_id) {
        await route.fallback();
        return;
      }
      asked.push(url.search);
      const location = url.searchParams.get("location_id");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (location !== null && location in at) {
        await route.fulfill({
          json: { items: at[location] ?? [], has_more: false },
        });
        return;
      }
      // One warehouse sold from is asked by its own address.
      const pageOf = (selling[offset / 100] ?? []).filter(
        (item) => location === null || item.location_id === location,
      );
      await route.fulfill({
        json: {
          items: pageOf,
          has_more: offset / 100 < selling.length - 1,
        },
      });
    },
  );
  return asked;
}

async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
}

function grid(page: Page) {
  return page.getByRole("table", { name: "Залишок за розмірами, шт." });
}

test("the grid: a row a warehouse, what orders hold under it, «Брак» by its own look, «Можна продати» — what is free where the store sells — and nothing pressed (sections task list, P0-6)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await shelves(page, {
    // «Брак» first in the store's order: the warehouses sold from come
    // first all the same.
    locations: [
      place(BIN, "Брак", { can_sell: false, damaged_returns: true }),
      place(MAIN, "Основний"),
      place(OWN, "Свій"),
    ],
    selling: [[row(MAIN, "M", 3, 1), row(OWN, "M", 1)]],
    at: { [BIN]: [row(BIN, "M", 1)] },
  });
  await enter(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  await openModel(page, "кокон", MODEL);
  // Its name in capitals, the till's price beside «Ціна продажу».
  const name = page.getByRole("heading", { level: 1, name: MODEL });
  await expect(name).toHaveCSS("text-transform", "uppercase");
  await expect(name).toHaveCSS("font-size", "40px");
  await expect(page.locator(".model-price-row p")).toHaveText(
    "Ціна продажу 3 600,00 грн",
  );
  const table = grid(page);
  await expect(table.getByRole("rowheader")).toHaveText([
    "Основний",
    "з них у резерві",
    "Свій",
    "Брак",
    "Можна продати",
  ]);
  const heads = table.getByRole("columnheader");
  await expect(heads).toHaveText(["M", "Разом"]);
  expect(await units(gridCell(page, MAIN, sizeIds.M))).toBe(3);
  expect(await units(gridCell(page, MAIN, sizeIds.M, true))).toBe(1);
  expect(await units(gridCell(page, OWN, sizeIds.M))).toBe(1);
  await expect(page.locator(`tr[data-held="${OWN}"]`)).toHaveCount(0);
  expect(await units(gridCell(page, BIN, sizeIds.M))).toBe(1);
  await expect(page.locator(`tr[data-location="${BIN}"]`)).toHaveClass(
    /grid-damaged/,
  );
  await expect(
    page.locator(`tr[data-location="${BIN}"] th svg.icon`),
  ).toHaveCount(1);
  // Free where it sells: 2 at «Основний», 1 at «Свій»; «Брак» never.
  const free = table.locator("tfoot tr");
  await expect(free.locator(`td[data-size="${sizeIds.M}"]`)).toHaveText("3");
  await expect(free.locator('td[data-size="total"]')).toHaveText("3");
  // Read only: a coat is sold from the till's cells, one «←» away.
  await expect(table.getByRole("button")).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/model-grid-${scheme}.png`,
      fullPage: true,
    });
  }
  // What may be corrected: a cell a size and a warehouse, never «Брак»;
  // one an order holds is dark, and a tap on it opens nothing.
  await page.getByRole("button", { name: "Виправити залишок" }).click();
  const sheet = page.getByRole("dialog", { name: MODEL });
  await expect(sheet).toHaveAttribute("data-ready", "");
  const cells = sheet
    .getByRole("group", { name: "Який розмір виправити" })
    .getByRole("button");
  expect(
    await cells.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    ),
  ).toEqual(["M, Основний, в обліку 3, у резерві 1", "M, Свій, в обліку 1"]);
  await expect(cells.first()).toHaveAttribute("aria-disabled", "true");
  await expect(cells.nth(1)).not.toHaveAttribute("aria-disabled");
  await cells.first().click({ force: true });
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  await expect(
    sheet.getByText(
      "Є резерв замовлення — виправити залишок можна після його видачі або скасування.",
    ),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("six sizes, «?» and «Разом» fit a 360 phone without the grid scrolling; a paused warehouse is grey, said once under the grid (sections task list, P0-6)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const letters: Letter[] = ["XS", "S", "M", "L", "XL", "XXL", "?"];
  await shelves(page, {
    locations: [
      place(MAIN, "Основний"),
      place(PAUSED, "Склад на ремонті", { is_active: false }),
    ],
    selling: [letters.map((size, at) => row(MAIN, size, 12 + at * 13))],
    at: { [PAUSED]: [row(PAUSED, "M", 2), row(PAUSED, "?", 1)] },
  });
  await enter(page);
  await openModel(page, "кокон", MODEL);
  const table = grid(page);
  const heads = table.getByRole("columnheader");
  await expect(heads).toHaveCount(8);
  for (const [at, said] of [
    "XS",
    "S",
    "M",
    "L",
    "XL",
    "XXL",
    "розмір невідомий",
    "Разом",
  ].entries())
    await expect(heads.nth(at)).toHaveAccessibleName(said);
  await expect(heads.nth(6)).toHaveText(/^\?/);
  expect(await units(gridCell(page, MAIN, "total"))).toBe(
    letters.reduce((sum, _, at) => sum + 12 + at * 13, 0),
  );
  const paused = page.locator(`tr[data-location="${PAUSED}"]`);
  await expect(paused).toHaveClass(/grid-paused/);
  await expect(gridCell(page, PAUSED, sizeIds.S)).toHaveAccessibleName("0");
  await expect(gridCell(page, PAUSED, sizeIds.S)).toHaveClass(/grid-zero/);
  expect(await units(gridCell(page, PAUSED, sizeIds["?"]))).toBe(1);
  await expect(
    page.getByText("Склад на паузі. Залишки доступні для перегляду.", {
      exact: true,
    }),
  ).toHaveCount(1);
  // Not sold from: not free.
  await expect(table.locator(`tfoot td[data-size="${sizeIds.M}"]`)).toHaveText(
    String(12 + 2 * 13),
  );
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const wrap = page.locator(".size-grid-wrap");
    expect(
      await wrap.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/model-sizes-${scheme}.png`,
      fullPage: true,
    });
  }
  // A paused warehouse is never corrected: «Основний»'s cells alone.
  await page.getByRole("button", { name: "Виправити залишок" }).click();
  const sheet = page.getByRole("dialog", { name: MODEL });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(sheet.getByRole("button", { name: /, Основний, / })).toHaveCount(
    letters.length,
  );
  await expect(
    sheet.getByRole("button", { name: /Склад на ремонті/ }),
  ).toHaveCount(0);
});

test("the sizes stand in the organization's order, a size only in «Брак» among them; without receiving's right, as the warehouses list them (sections task list, P0-6)", async ({
  page,
}) => {
  const stock = {
    locations: [
      place(MAIN, "Основний"),
      place(OWN, "Свій"),
      place(BIN, "Брак", { can_sell: false, damaged_returns: true }),
    ],
    // As the server lists them, by size and then warehouse: the first
    // warehouse has no S (review, 2026-11-01); a size not known, listed
    // first, stands last.
    selling: [
      [row(OWN, "?", 1), row(OWN, "S", 1), row(MAIN, "L", 2), row(OWN, "L", 1)],
    ],
    at: { [BIN]: [row(BIN, "M", 1)] },
    sizes: ["S", "M", "L"] as Letter[],
  };
  await shelves(page, stock);
  await enter(page);
  await openModel(page, "кокон", MODEL);
  await expect(grid(page).getByRole("columnheader")).toHaveText([
    "S",
    "M",
    "L",
    /^\?/,
    "Разом",
  ]);

  await page.unrouteAll({ behavior: "wait" });
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "inventory:receive",
      );
    await route.fulfill({ response, json: body });
  });
  await shelves(page, stock);
  // Opened afresh: its rights read again.
  await page.goto("about:blank");
  await enter(page);
  await openModel(page, "кокон", MODEL);
  await expect(grid(page).getByRole("columnheader")).toHaveText([
    "S",
    "L",
    "M",
    /^\?/,
    "Разом",
  ]);
  await expect(page.getByRole("button", { name: "Прийшов товар" })).toHaveCount(
    0,
  );
});

test("a model's rows are read page after page while they may go on, and never past them; opened with no search, the list is asked with none (sections task list, P0-6)", async ({
  page,
}) => {
  const OTHER = "30000000-0000-4000-8000-000000000001";
  const LATER = "30000000-0000-4000-8000-000000000002";
  const before = Array.from({ length: 99 }, (_, at) =>
    row(MAIN, "M", 1 + at, 0, OTHER, `Альфа ${String(at).padStart(2, "0")}`),
  );
  const asked = await shelves(page, {
    locations: [
      place(MAIN, "Основний"),
      place(OWN, "Свій"),
      place(BIN, "Брак", { can_sell: false, damaged_returns: true }),
    ],
    selling: [
      [...before, row(MAIN, "S", 2)],
      [
        row(OWN, "S", 1),
        row(MAIN, "M", 4),
        row(MAIN, "L", 5),
        row(MAIN, "S", 9, 0, LATER, "Яблуко"),
      ],
      [row(MAIN, "XL", 7)],
    ],
  });
  // «Брак» holds other models first: its own read goes on to this one's
  // rows, though none came on its first page.
  await page.route(
    `**/api/v1/catalog/stock-options?**location_id=${BIN}**`,
    async (route) => {
      const offset = new URL(route.request().url()).searchParams.get("offset");
      await route.fulfill({
        json:
          offset === "0"
            ? {
                items: Array.from({ length: 100 }, (_, at) =>
                  row(BIN, "M", 1, 0, OTHER, `Альфа ${String(at)}`),
                ),
                has_more: true,
              }
            : { items: [row(BIN, "M", 6)], has_more: false },
      });
    },
  );
  await enter(page);
  // The whole list, no search typed: the model's tag is its last row.
  await toTill(page);
  await page
    .getByRole("group", { name: MODEL, exact: true })
    .locator("button.model-open")
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: MODEL }),
  ).toBeVisible();
  expect(await units(gridCell(page, MAIN, sizeIds.S))).toBe(2);
  expect(await units(gridCell(page, OWN, sizeIds.S))).toBe(1);
  expect(await units(gridCell(page, MAIN, sizeIds.M))).toBe(4);
  expect(await units(gridCell(page, MAIN, sizeIds.L))).toBe(5);
  expect(await units(gridCell(page, BIN, sizeIds.M))).toBe(6);
  // The third page holds another model's rows only: never asked.
  await expect(grid(page).getByRole("columnheader")).toHaveText([
    "S",
    "M",
    "L",
    "Разом",
  ]);
  const listed = asked.filter((search) => !search.includes("location_id"));
  expect(listed.filter((search) => search.includes("offset=100"))).toHaveLength(
    1,
  );
  expect(listed.some((search) => search.includes("offset=200"))).toBe(false);
  expect(listed.every((search) => !search.includes("query="))).toBe(true);
  // «Альфа» and «Яблуко» are not this model's: nowhere in its grid.
  await expect(grid(page)).not.toContainText("Альфа");
});

test("a read that fails says so, and «Спробувати ще раз» reads it again (sections task list, P0-6)", async ({
  page,
}) => {
  await shelves(page, {
    locations: [
      place(MAIN, "Основний"),
      place(BIN, "Брак", { can_sell: false, damaged_returns: true }),
    ],
    selling: [[row(MAIN, "M", 3)]],
    at: { [BIN]: [row(BIN, "M", 1)] },
  });
  let refused = 0;
  await page.route(
    `**/api/v1/catalog/stock-options?**location_id=${BIN}**`,
    async (route) => {
      if (refused > 0) {
        await route.fallback();
        return;
      }
      refused += 1;
      await route.fulfill({
        status: 403,
        json: { code: "PERMISSION_DENIED", message: "No", details: {} },
      });
    },
  );
  await enter(page);
  await toTill(page);
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("кокон");
  await page
    .getByRole("group", { name: MODEL, exact: true })
    .locator("button.model-open")
    .click();
  await expect(page.getByRole("alert")).toContainText("Немає доступу");
  await expect(grid(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(grid(page)).toBeVisible();
  expect(await units(gridCell(page, BIN, sizeIds.M))).toBe(1);
});

test("a name tapped while a new search is read opens the model as the till shows it, by the search it was found by (review, 2026-11-01)", async ({
  page,
}) => {
  const asked = await shelves(page, {
    locations: [place(MAIN, "Основний")],
    selling: [[row(MAIN, "M", 3)]],
  });
  // The new search's answer waits until the name is tapped.
  let answer = (): void => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = () => {
      resolve();
    };
  });
  let waiting = false;
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("query") !== "інше") {
      await route.fallback();
      return;
    }
    waiting = true;
    await answered;
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await enter(page);
  await toTill(page);
  const field = page.getByRole("searchbox", { name: "Знайти модель" });
  // Its tag found by «кокон», answered, not by the whole list before it.
  const found = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("query") === "кокон",
  );
  await field.fill("кокон");
  await found;
  const name = page
    .getByRole("group", { name: MODEL, exact: true })
    .locator("button.model-open");
  await expect(name).toBeVisible();
  await field.fill("інше");
  await expect.poll(() => waiting).toBe(true);
  asked.length = 0;
  await name.click();
  answer();
  await expect(grid(page)).toBeVisible();
  expect(await units(gridCell(page, MAIN, sizeIds.M))).toBe(3);
  expect(
    asked.map((search) => new URLSearchParams(search).get("query")),
  ).toContain("кокон");
});

test("a model sold out since it was found: no grid, and nothing said of its price (review, 2026-11-01)", async ({
  page,
}) => {
  await shelves(page, {
    locations: [place(MAIN, "Основний")],
    selling: [[row(MAIN, "M", 3)]],
  });
  let gone = false;
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    if (!gone) {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await enter(page);
  await toTill(page);
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("кокон");
  const name = page
    .getByRole("group", { name: MODEL, exact: true })
    .locator("button.model-open");
  await expect(name).toBeVisible();
  gone = true;
  await name.click();
  await expect(
    page.getByText("Зараз цієї моделі немає на складах магазину."),
  ).toBeVisible();
  await expect(grid(page)).toHaveCount(0);
  const hero = page.getByRole("group", { name: MODEL });
  await expect(hero).not.toContainText("Ціна продажу");
  await expect(
    page.getByRole("button", { name: "Змінити ціну", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Виправити залишок" }),
  ).toHaveCount(0);
});

test("the real stock of a model, as the server lists it; «← Продаж» is the till with its search and basket as they were, «Продаж» marked all along (sections task list, P0-6)", async ({
  page,
}) => {
  const answers: { items: ReturnType<typeof row>[] }[] = [];
  const searched: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.pathname.endsWith("/catalog/stock-options") &&
      url.searchParams.get("store_id") === fixture.store_id &&
      response.status() === 200
    ) {
      searched.push(url.search);
      void response.json().then((body: { items: ReturnType<typeof row>[] }) => {
        answers.push(body);
      });
    }
  });
  await enter(page);
  await toTill(page);
  const field = page.getByRole("searchbox", { name: "Знайти модель" });
  await field.fill("Лоран");
  await tapSize(
    page,
    fixture.variant_id,
    fixture.size_id,
    fixture.till_location_id,
  );
  // A price to type opens the basket: closed, as the seller leaves it.
  await basketDone(page);
  await expect(page.locator(".tray-count")).toHaveText("Кошик · 1");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  // From here on, the detail's own reads.
  answers.length = 0;
  searched.length = 0;
  await page
    .getByRole("group", { name: lorans })
    .locator("button.model-open")
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: lorans }),
  ).toBeVisible();
  const tab = sections(page).getByRole("button", {
    name: "Продаж",
    exact: true,
  });
  await expect(tab).toHaveAttribute("aria-current", "page");
  // The name tapped is gone: the focus stays on «Продаж», never lost to the
  // page (review, 2026-11-01).
  await expect(tab).toBeFocused();
  // Its basket's tray steps aside: nothing is sold from here.
  await expect(page.locator(".tray-count")).toHaveCount(0);
  const counted = () =>
    answers
      .flatMap((answer) => answer.items)
      .find(
        (item) =>
          item.product_variant_id === fixture.variant_id &&
          item.size_id === fixture.size_id &&
          item.location_id === fixture.count_location_id,
      )?.quantity;
  await expect.poll(counted).toBeGreaterThan(0);
  expect(
    await units(gridCell(page, fixture.count_location_id, fixture.size_id)),
  ).toBe(counted());
  // Asked by the till's own words.
  expect(searched.every((search) => search.includes("query="))).toBe(true);
  expect(writes).toEqual([]);

  await page.getByRole("button", { name: "Назад до «Продаж»" }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж", level: 1 }),
  ).toBeVisible();
  await expect(field).toHaveValue("Лоран");
  await expect(page.locator(".tray-count")).toHaveText("Кошик · 1");
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(tab).toBeFocused();
  // Elsewhere and back, the search starts afresh.
  await more(page);
  await tab.click();
  await expect(field).toHaveValue("");
});

test("whoever sells only: «Прийшов товар» alone — no price to change, no correction, no ⋯, and no «Інвентаризація» in «Ще» (sections task list, P0-6, P1-5)", async ({
  page,
}) => {
  const manager = ["catalog:set_price", "inventory:adjust"];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => !manager.includes(p));
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  await openModel(page, "Лоран", lorans);
  await expect(grid(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Прийшов товар" }),
  ).toBeVisible();
  for (const name of ["Змінити ціну", "Виправити залишок", "Ще дії з моделлю"])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await more(page);
  const goods = page.getByRole("navigation", { name: "Ще" });
  await expect(
    goods.getByRole("button", { name: "Прийшов товар", exact: true }),
  ).toBeVisible();
  for (const name of ["Інвентаризація", "Залишки"])
    await expect(goods.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
});

test("«Прийшов товар» opens receiving with the model chosen, and ⋯ «Інвентаризація»; each says «← {модель}» and marks «Продаж» (sections task list, P0-6, P1-5)", async ({
  page,
}) => {
  await enter(page);
  await openModel(page, "Лоран", lorans);
  const name =
    (await page
      .getByRole("heading", { level: 1, name: lorans })
      .textContent()) ?? "";
  const tab = sections(page).getByRole("button", {
    name: "Продаж",
    exact: true,
  });
  await page.getByRole("button", { name: "Прийшов товар" }).click();
  await expect(
    page.getByRole("heading", { name: "Приймання товару", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(`Обрано: ${name}`, { exact: true }),
  ).toBeVisible();
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(tab).toBeFocused();
  await page.getByRole("button", { name: `Назад до «${name}»` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: lorans }),
  ).toBeVisible();
  await expect(tab).toBeFocused();

  await page.getByRole("button", { name: "Ще дії з моделлю" }).click();
  const sheet = page.getByRole("dialog", { name });
  // A tap carried from the ⋯ is let go for a moment.
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: "Інвентаризація" }).click();
  await expect(
    page.getByRole("heading", { name: "Інвентаризація", level: 1 }),
  ).toBeVisible();
  await expect(tab).toHaveAttribute("aria-current", "page");
  // The warehouses that may be corrected; «Брак» never among them.
  const chips = page.getByRole("group", { name: "Склад" });
  await expect(
    chips.getByRole("button", { name: "Склад перерахунку", exact: true }),
  ).toBeVisible();
  await expect(
    chips.getByRole("button", { name: "Брак", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: `Назад до «${name}»` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: lorans }),
  ).toBeVisible();
  // From «Ще», its own way back.
  await more(page);
  await page
    .getByRole("navigation", { name: "Ще" })
    .getByRole("button", { name: "Інвентаризація", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Назад до «Ще»" }),
  ).toBeVisible();
});
