import {
  test,
  expect,
  basketDone,
  basketSheet,
  fromPaper,
  openStore,
  toTill,
  shortage,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A store that sells from two warehouses (sale-slice TZ, P2-5; owner
 * decisions, 2026-10-17): the till lists both at once, a cell per warehouse
 * — «M» over «Свій 1», «M» over «Спільний 2» — and the coat leaves from the
 * cell's; none is chosen above the search («Усе на бірці» task list, P0-5).
 * A warehouse waiting for its opening list is said to sell on paper while
 * the other's goods are listed; a coat in hand from the catalogue is asked
 * its warehouse. The stores' warehouses, the goods and the sale's answer
 * are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
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

const own = fixture.till_location_id;
const shared = fixture.location_id;
const sizeL = randomUUID();

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

/** Exactly the two warehouses, «Свій» and «Спільний», either waiting. */
async function twoWarehouses(
  page: Page,
  waiting: { own?: boolean; shared?: boolean } = {},
  sharedName = "Спільний",
): Promise<void> {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as { id: string }[];
    await route.fulfill({
      response,
      // «Свій» first: the order the store lists them in.
      json: rows
        .filter((row) => row.id === own || row.id === shared)
        .sort((a, b) => Number(b.id === own) - Number(a.id === own))
        .map((row) => ({
          ...row,
          name: row.id === own ? "Свій" : sharedName,
          is_active: true,
          can_sell: true,
          awaiting_first_stock:
            row.id === own ? waiting.own === true : waiting.shared === true,
        })),
    });
  });
}

function coat(at: string, sizeId: string, label: string, held: number) {
  return {
    location_id: at,
    product_variant_id: fixture.variant_id,
    size_id: sizeId,
    display_name: "Лоран шоколад",
    size_label: label,
    size_is_unknown: false,
    quantity: held,
    reserved_quantity: 0,
    available_quantity: held,
    suggested_price: "1850.00",
  };
}

/** M at both, L at the shared one; each URL answered as the server would. */
async function goods(page: Page, asked: string[]): Promise<void> {
  const every = [
    coat(shared, fixture.size_id, "M", 2),
    coat(own, fixture.size_id, "M", 1),
    coat(shared, sizeL, "L", 1),
  ];
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const at = url.searchParams.get("location_id");
    await route.fulfill({
      json: {
        items:
          at === null ? every : every.filter((row) => row.location_id === at),
        has_more: false,
      },
    });
  });
}

/** What each sale sent, answered as recorded. */
function sales(page: Page): { lines: { source_location_id: string }[] }[] {
  const sent: { lines: { source_location_id: string }[] }[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/sales"))
      sent.push(
        request.postDataJSON() as { lines: { source_location_id: string }[] },
      );
  });
  return sent;
}

async function onTheTill(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
}

/** What a model's cells read aloud, in their order. */
function said(page: Page, model: string): Promise<(string | null)[]> {
  return page
    .getByRole("group", { name: model })
    .locator("button.size-cell")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("aria-label")),
    );
}

function chip(page: Page, at: string, sizeId = fixture.size_id) {
  return page.locator(
    `button.size-cell[data-stock="${fixture.variant_id}:${sizeId}"][data-location="${at}"]`,
  );
}

function pay(page: Page) {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: "Готівка", exact: true });
}

test("both warehouses are listed at once, a cell each, none chosen above the search, and the coat leaves from the cell's", async ({
  page,
}) => {
  const asked: string[] = [];
  await twoWarehouses(page);
  await goods(page, asked);
  const sent = sales(page);
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
  });
  await onTheTill(page);
  // Nothing to choose, nor said, above the search: it is there, and asks
  // for both.
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText(/^Склад: /)).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toBeVisible();
  // Each cell: the size, under it its warehouse and what is free there.
  await expect(chip(page, own)).toHaveText("MСвій 1");
  await expect(chip(page, shared)).toHaveText("MСпільний 2");
  // A size's cells stand together, the store's own order of warehouses.
  expect(await said(page, "Лоран шоколад")).toEqual([
    "M, Свій, вільно 1",
    "M, Спільний, вільно 2",
    "L, Спільний, вільно 1",
  ]);
  expect(asked[0]).not.toContain("location_id");

  await chip(page, shared).click();
  await chip(page, own).click();
  // Two «Лоран шоколад · M», told apart by their warehouses under them, in
  // the basket's sheet («Усе на бірці» task list, P0-5).
  const sheet = await basketSheet(page);
  await expect(sheet.locator(".line strong")).toHaveText([
    "Лоран шоколад · M",
    "Лоран шоколад · M",
  ]);
  await expect(sheet.locator(".line .line-place")).toHaveText([
    "Склад: Спільний",
    "Склад: Свій",
  ]);
  await expect(
    sheet.getByRole("button", { name: "Прибрати Лоран шоколад · Свій" }),
  ).toBeVisible();
  await basketDone(page);
  await pay(page).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]?.lines.map((line) => line.source_location_id)).toEqual([
    shared,
    own,
  ]);
});

test("on a 360 screen a long warehouse name gives way in its cell, never the count, and nothing runs past the screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  // Longer than a tag is wide.
  const long = "Склад на вулиці Тараса Шевченка, будинок 12, другий поверх";
  await twoWarehouses(page, {}, long);
  await goods(page, []);
  await onTheTill(page);
  const cell = chip(page, shared);
  await expect(cell).toHaveAttribute(
    "aria-label",
    `M, ${long}, вільно 2`,
  );
  const drawn = await cell.evaluate((button) => {
    const free = button.querySelector(".size-free");
    const place = button.querySelector(".size-place");
    const count = free?.lastChild;
    if (!free || !place || !count) return null;
    const range = document.createRange();
    range.selectNodeContents(count);
    const box = button.getBoundingClientRect();
    const said = range.getBoundingClientRect();
    return {
      count: count.textContent,
      cut: place.scrollWidth > place.clientWidth,
      inside:
        said.width > 0 && said.left >= box.left && said.right <= box.right,
    };
  });
  expect(drawn).toEqual({ count: " 2", cut: true, inside: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a warehouse waiting for its opening list is said to sell on paper, and the other's goods are listed", async ({
  page,
}) => {
  await twoWarehouses(page, { shared: true });
  await goods(page, []);
  await onTheTill(page);
  await expect(
    page.getByText(
      "Склад «Спільний» ще чекає початкових залишків: його товар продавайте на папері.",
    ),
  ).toBeVisible();
  await expect(chip(page, own)).toHaveAttribute(
    "aria-label",
    "M, Свій, вільно 1",
  );
});

test("both waiting, the till says to sell on paper, and lists nothing", async ({
  page,
}) => {
  const asked: string[] = [];
  await twoWarehouses(page, { own: true, shared: true });
  await goods(page, asked);
  await onTheTill(page);
  await expect(
    page.getByText(
      "На складах магазину зараз немає товару в обліку. Поки власник не затвердить початкові залишки, продавайте на папері.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("a coat in hand from the catalogue is asked its warehouse, and leaves from the one said", async ({
  page,
}) => {
  await twoWarehouses(page);
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await page.route(
    "**/api/v1/catalog/receivable-variants?**",
    async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              product_variant_id: fixture.variant_id,
              display_name: "Лоран беж",
            },
          ],
          has_more: false,
        },
      });
    },
  );
  await page.route("**/api/v1/catalog/sizes?**", async (route) => {
    await route.fulfill({
      json: [{ size_id: fixture.size_id, code: "M", system: "ALPHA" }],
    });
  });
  await page.route("**/api/v1/catalog/prices?**", async (route) => {
    await route.fulfill({
      json: {
        product_variant_id: fixture.variant_id,
        currency_code: "UAH",
        shared_price: null,
        store_price: null,
        suggested_price: "2400.00",
        may_set_shared: false,
      },
    });
  });
  const sent = sales(page);
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
  });
  await onTheTill(page);
  await expect(
    page.getByText("На складах магазину зараз немає товару в обліку."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Знайти в каталозі" }).click();
  const from = page.getByLabel("З якого складу віддаєте?");
  await expect(from).toHaveValue("");
  // Nothing is offered until the warehouse is said.
  await expect(
    page.getByRole("region", { name: "Товар з каталогу" }),
  ).toHaveCount(0);
  await from.selectOption(shared);
  const panel = page.getByRole("region", { name: "Товар з каталогу" });
  await expect(panel).toContainText(
    "На складі «Спільний» його немає в обліку.",
  );
  await panel.getByLabel("Пошук у каталозі").fill("лоран");
  await panel.getByRole("button", { name: "Знайти" }).click();
  await panel.getByRole("radio", { name: "Лоран беж" }).click();
  await panel
    .getByRole("group", { name: "Розмір: Лоран беж" })
    .getByRole("button", { name: "M", exact: true })
    .click();
  await expect((await basketSheet(page)).locator(".line")).toContainText(
    "Лоран беж · M",
  );
  await basketDone(page);
  // The next coat from the catalogue is asked its warehouse anew.
  await page.getByRole("button", { name: "Знайти в каталозі" }).click();
  await expect(page.getByLabel("З якого складу віддаєте?")).toHaveValue("");
  await expect(
    page.getByRole("region", { name: "Товар з каталогу" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Назад до списку" }).click();
  await pay(page).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]?.lines.map((line) => line.source_location_id)).toEqual([
    shared,
  ]);
});

/** Each sale answered by `answers`, in turn; what each sent. */
function answered(
  page: Page,
  answers: { status: number; json: object }[],
): Promise<{ lines: { source_location_id: string }[] }[]> {
  const sent: { lines: { source_location_id: string }[] }[] = [];
  return page
    .route("**/api/v1/sales", async (route) => {
      sent.push(
        route.request().postDataJSON() as {
          lines: { source_location_id: string }[];
        },
      );
      await route.fulfill(
        answers[Math.min(sent.length, answers.length) - 1] ?? {
          status: 500,
          json: {},
        },
      );
    })
    .then(() => sent);
}

function short(at: string): { status: number; json: object } {
  return {
    status: 409,
    json: {
      code: "INSUFFICIENT_STOCK",
      message: "Not enough stock for this operation",
      details: {
        location_id: at,
        product_variant_id: fixture.variant_id,
        size_id: fixture.size_id,
        requested: 1,
        available: 0,
        correctable: true,
      },
    },
  };
}

test("a model's sizes keep its own order, whatever another model lists first", async ({
  page,
}) => {
  const sizeS = randomUUID();
  await twoWarehouses(page);
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            ...coat(own, sizeL, "L", 1),
            product_variant_id: randomUUID(),
            display_name: "Альпака",
          },
          coat(own, sizeS, "S", 1),
          coat(own, fixture.size_id, "M", 1),
          coat(own, sizeL, "L", 1),
        ],
        has_more: false,
      },
    });
  });
  await onTheTill(page);
  await expect(chip(page, own)).toBeVisible();
  expect(await said(page, "Лоран шоколад")).toEqual([
    "S, Свій, вільно 1",
    "M, Свій, вільно 1",
    "L, Свій, вільно 1",
  ]);
});

test("a shortfall says which warehouse's shelf to look at, and the receipt where the coat left from", async ({
  page,
}) => {
  await twoWarehouses(page);
  await goods(page, []);
  const receipt = {
    status: 201,
    json: {
      id: randomUUID(),
      store_id: fixture.store_id,
      currency_code: "UAH",
      subtotal: "1850.00",
      discount_total: "0.00",
      total: "1850.00",
      items: [
        {
          id: randomUUID(),
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          source_location_id: shared,
          quantity: 1,
          unit_price: "1850.00",
          discount_amount: "0.00",
          final_unit_price: "1850.00",
          line_total: "1850.00",
          display_name: "Лоран шоколад",
          size: "M",
        },
      ],
      corrections: [randomUUID()],
      shortages: [],
      size_reclassifications: [],
      payment_method: "CASH",
    },
  };
  await answered(page, [short(shared), receipt]);
  await onTheTill(page);
  await chip(page, shared).click();
  await pay(page).click();
  const panel = await shortage(page);
  await expect(panel).toContainText(
    "Лоран шоколад · M · Спільний: у кошику 1 шт., в обліку 0 шт.",
  );
  await panel
    .getByRole("button", { name: /^Товар на місці — продати 1/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  // One warehouse: named once, under the line (spec S11; P0-5).
  await expect(page.locator(".line strong")).toHaveText("Лоран шоколад · M");
  await expect(
    page.locator(".stub").getByText("Склад: Спільний"),
  ).toBeVisible();
});

test("a model held with its size not known in one warehouse is offered «Розмір з етикетки» only for a line from there", async ({
  page,
}) => {
  const unknown = randomUUID();
  await twoWarehouses(page);
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          coat(own, fixture.size_id, "M", 1),
          { ...coat(own, unknown, "UNKNOWN", 2), size_is_unknown: true },
          coat(shared, fixture.size_id, "M", 1),
        ],
        has_more: false,
      },
    });
  });
  await page.route("**/api/v1/catalog/sizes?**", async (route) => {
    await route.fulfill({
      json: [{ size_id: fixture.size_id, code: "M", system: "ALPHA" }],
    });
  });
  let at = shared;
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill(short(at));
  });
  await onTheTill(page);
  const offer = page.getByRole("button", {
    name: /^Розмір з етикетки — продати як M/,
  });
  const panel = page.getByRole("dialog", { name: "Залишку не вистачає" });

  // From «Спільний», which holds none of no size: no label to read.
  await chip(page, shared).click();
  await pay(page).click();
  await expect(panel).toBeVisible();
  await expect(offer).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: /^Товар на місці — продати 1/ }),
  ).toBeVisible();

  // From «Свій», which does: the label may be read. The line taken out by
  // the question's own «Прибрати з кошика» (P0-5).
  await (await shortage(page))
    .getByRole("button", { name: "Прибрати з кошика" })
    .click();
  await expect(panel).toHaveCount(0);
  at = own;
  await chip(page, own).click();
  await pay(page).click();
  await expect(offer).toBeVisible();
});

test("from paper, the press names both warehouses the lines leave from", async ({
  page,
}) => {
  await twoWarehouses(page);
  await goods(page, []);
  await onTheTill(page);
  await fromPaper(page);
  await chip(page, shared).click();
  await chip(page, own).click();
  await expect(
    page.getByRole("group", { name: "Продати — як платить покупець" }),
  ).toContainText("склади: Спільний, Свій");
});
