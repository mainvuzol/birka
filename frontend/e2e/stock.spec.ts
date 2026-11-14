import { test, expect, menu, more, openStore, section } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  variant_id: string;
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
function launch(): string {
  return `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`;
}

/** The store's warehouses, as the server lists them to this person. */
async function places(page: Page): Promise<Place[]> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const listed = await page.request.get(
    `/api/v1/stock-locations?store_id=${fixture.store_id}`,
    { headers: { Authorization: `Bearer ${access_token}` } },
  );
  expect(listed.status()).toBe(200);
  return (await listed.json()) as Place[];
}
/**
 * «Залишки» is for whoever reads the stock with no till in the store: for
 * anyone else the till's search and a model's detail are the stock's place
 * («Усе на бірці» sections task list, P0-6). The seed's «Оля» sells, so the
 * till is taken from her here, with whatever else `without` names.
 */
async function noTill(page: Page, without: string[] = []): Promise<void> {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "sale:create" && !without.includes(p),
      );
    await route.fulfill({ response, json: body });
  });
}

async function enter(page: Page): Promise<void> {
  await noTill(page);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Залишки");
}

interface Place {
  id: string;
  name: string;
  is_active: boolean;
  can_sell: boolean;
  damaged_returns: boolean;
}

interface Row {
  product_variant_id: string;
  size_id: string;
  display_name: string;
  size_label: string;
  size_is_unknown: boolean;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}

/** A warehouse's chip (stage 2, goods task list, P2-5). */
function chip(page: Page, name: string): Locator {
  return page
    .getByRole("group", { name: "Склад", exact: true })
    .getByRole("button", { name, exact: true });
}

/** A model's tag on «Залишки». */
function tagOf(page: Page, variant: string): Locator {
  return page.locator(`.stock-tag[data-model="${variant}"]`);
}

/** A size's cell, read aloud in one go: «M, вільно 2, у резерві 1» where
 * the store sells from the warehouse, «M, 3 шт.» where it does not. */
function said(row: Row, selling: boolean): string {
  return [
    row.size_is_unknown ? "розмір невідомий" : row.size_label,
    selling
      ? `вільно ${String(Math.max(row.available_quantity, 0))}`
      : `${String(row.quantity)} шт.`,
    row.reserved_quantity > 0
      ? `у резерві ${String(row.reserved_quantity)}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

test("«Залишки»: a chip a warehouse, none taken until tapped; its models as tags, a cell a size with what is free, «Можна продати N шт.»; nothing written (stage 2, goods task list, P2-5)", async ({
  page,
}) => {
  const writes: string[] = [];
  await enter(page);
  const main = (await places(page)).find(
    (place) => place.name === "Основний склад",
  );
  if (!main) throw new Error("Missing the seed's main warehouse");
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  // Several warehouses: none is taken for the person.
  await expect(chip(page, "Основний склад")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(".stock-tag")).toHaveCount(0);
  const request = page.waitForResponse(
    (r) =>
      r.url().includes("/catalog/stock-options?") &&
      r.url().includes(`location_id=${main.id}`) &&
      r.status() === 200,
  );
  await chip(page, "Основний склад").click();
  await expect(chip(page, "Основний склад")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const result = (await (await request).json()) as { items: Row[] };
  expect(result.items.length).toBeGreaterThan(0);
  const row = result.items[0];
  if (!row) throw new Error("Missing stock fixture");
  const selling = main.is_active && main.can_sell && !main.damaged_returns;
  // One tag a model: its sizes its cells, each said in one go.
  const sizes = result.items.filter(
    (item) => item.product_variant_id === row.product_variant_id,
  );
  const tag = tagOf(page, row.product_variant_id);
  await expect(tag).toHaveCount(1);
  await expect(tag.locator(".size-cell .visually-hidden")).toHaveText(
    sizes.map((size) => said(size, selling)),
  );
  const free = sizes.reduce(
    (sum, size) => sum + Math.max(size.available_quantity, 0),
    0,
  );
  if (selling && free > 0)
    await expect(tag.locator(".stock-free")).toHaveText(
      `Можна продати ${String(free)} шт.`,
    );
  else await expect(tag.locator(".stock-free")).toHaveCount(0);
  await expect(
    page
      .locator(".stock-tag")
      .getByRole("button", { name: /^Лоран шоколад 70(?:\.0)? см$/ }),
  ).toHaveCount(1);
  // The words of the old rows are gone (P2-5).
  await expect(page.getByText(/^(На складі|Доступно|Розмір):/)).toHaveCount(0);
  await page.getByRole("button", { name: "Оновити", exact: true }).click();
  await expect(tag).toBeVisible();
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/stock-mobile.png",
    fullPage: true,
  });
});

test("a tap on a model's tag — its name or anywhere on it — opens its detail with «← Залишки», «Ще» marked; back, the same warehouse and its tags (stage 2, goods task list, P2-5)", async ({
  page,
}) => {
  await enter(page);
  await chip(page, "Основний склад").click();
  const tag = page.locator(".stock-tag").filter({
    has: page.getByRole("button", { name: /^Лоран шоколад 70(?:\.0)? см$/ }),
  });
  for (const where of ["name", "cells"] as const) {
    if (where === "name")
      await tag
        .getByRole("button", { name: /^Лоран шоколад 70(?:\.0)? см$/ })
        .click();
    else await tag.getByRole("list", { name: "Розміри" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /^Лоран шоколад 70(?:\.0)? см$/,
      }),
    ).toBeVisible();
    const back = page.getByRole("button", { name: "Назад до «Залишки»" });
    await expect(back).toHaveText("← Залишки");
    await expect(
      menu(page).getByRole("button", { name: "Ще", exact: true }),
    ).toHaveAttribute("aria-current", "true");
    await back.click();
    await expect(page.getByRole("heading", { name: "Залишки" })).toBeVisible();
    await expect(chip(page, "Основний склад")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(tag).toBeVisible();
  }
  // Left for another section: chosen afresh next time, none taken.
  await section(page, "Прийшов товар");
  await section(page, "Залишки");
  await expect(chip(page, "Основний склад")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(".stock-tag")).toHaveCount(0);
});

test("the only warehouse is no choice: said and taken, its tags shown at once (stage 2, goods task list, P2-5)", async ({
  page,
}) => {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Place[];
    await route.fulfill({
      response,
      json: rows.filter((row) => row.name === "Основний склад"),
    });
  });
  await enter(page);
  await expect(
    page.getByText("Склад «Основний склад»", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Склад", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".stock-tag").first()).toBeVisible();
});

test("without the right to read the stock, «Ще» › «Товар» has no «Залишки», its other rows stay, and nothing is said of the rule (navigation task list, P0-3; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await noTill(page, ["inventory:view"]);
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  // «Ще» › «Товар» without «Залишки»: no stock, and nothing said of the rule
  // (navigation task list, P0-3; «Усе на бірці» task list, P0-4).
  await more(page);
  const goods = page.getByRole("navigation", { name: "Ще" });
  await expect(
    goods.getByRole("button", { name: "Прийшов товар", exact: true }),
  ).toBeVisible();
  await expect(goods.getByRole("button", { name: /^Брак( |$)/ })).toBeVisible();
  await expect(
    goods.getByRole("button", { name: "Залишки", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Оновити", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Склад" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("whoever has the till reads the stock on its search and a model's detail: «Ще» › «Товар» has no «Залишки» (sections task list, P0-6)", async ({
  page,
}) => {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await more(page);
  const goods = page.getByRole("navigation", { name: "Ще" });
  await expect(
    goods.getByRole("button", { name: "Інвентаризація", exact: true }),
  ).toBeVisible();
  await expect(
    goods.getByRole("button", { name: "Залишки", exact: true }),
  ).toHaveCount(0);
});

test("without the stock, receiving and «Брак», no «Товар» in the menu and «Ще» › «Товар» holds the catalogue alone (navigation task list, P0-3; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  const goods = ["inventory:view", "inventory:receive", "damaged:handle"];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => !goods.includes(p));
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  const sections = page.getByRole("navigation", { name: "Розділи" });
  await expect(
    sections.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeVisible();
  await expect(
    sections.getByRole("button", { name: "Товар", exact: true }),
  ).toHaveCount(0);
  await more(page);
  const under = page.getByRole("navigation", { name: "Ще" });
  for (const name of ["Залишки", "Прийшов товар", /^Брак( |$)/])
    await expect(
      under.getByRole(
        "button",
        typeof name === "string" ? { name, exact: true } : { name },
      ),
    ).toHaveCount(0);
  await expect(
    under.getByRole("button", { name: /^Товар і каталог/ }),
  ).toBeVisible();
});

test("stock access denial hides stale balances and offers retry", async ({
  page,
}) => {
  await enter(page);
  await chip(page, "Основний склад").click();
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toBeVisible();
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({ status: 403, json: { code: "PERMISSION_DENIED" } });
  });
  await page.getByRole("button", { name: "Оновити", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Немає доступу");
  // The warning's plate, «Спробувати ще раз» (audit after stage 2, goods
  // P1-1).
  const plate = page.locator(".read-failure");
  await expect(plate).toContainText("Немає доступу");
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toHaveCount(0);
  await expect(page.locator(".stock-tag")).toHaveCount(0);
});

test("read again and refused for anything but the right: the tags read stand under the plate, its «Спробувати ще раз» reads them again (audit 2026-11-13, goods P1-1)", async ({
  page,
}) => {
  await enter(page);
  await chip(page, "Основний склад").click();
  const loran = page.getByText(/Лоран шоколад 70(?:\.0)? см/);
  await expect(loran).toBeVisible();
  let failing = true;
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL", message: "boom" },
      });
      return;
    }
    await route.fallback();
  });
  await page.getByRole("button", { name: "Оновити", exact: true }).click();
  const plate = page.locator(".read-failure");
  await expect(plate).toBeVisible();
  await expect(loran).toBeVisible();
  // Over the tags read, not under them.
  const tag = await page.locator(".stock-tag").first().boundingBox();
  const over = await plate.boundingBox();
  expect(tag && over && over.y < tag.y).toBe(true);
  failing = false;
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(plate).toHaveCount(0);
  await expect(loran).toBeVisible();
});

test("a paused warehouse, a size all held and one of unknown size stay readable, the tags glued across a page's edge — the last model shown once whole, a row read twice counted once; nothing to sell where the store does not sell from it (stage 2, goods task list, P2-5)", async ({
  page,
}) => {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Place[];
    for (const row of rows) {
      row.is_active = false;
      row.can_sell = false;
    }
    await route.fulfill({ response, json: rows });
  });
  const other = randomUUID();
  const first = randomUUID();
  const row = (over: Partial<Row>): Row => ({
    product_variant_id: fixture.variant_id,
    size_id: "fixture-size",
    display_name: "Повністю зарезервований",
    size_label: "UNKNOWN",
    size_is_unknown: true,
    quantity: 4,
    reserved_quantity: 4,
    available_quantity: 0,
    ...over,
  });
  // The next page refused once (audit 2026-11-13, goods P1-1).
  let refused = false;
  const asked: string[] = [];
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const next =
      new URL(route.request().url()).searchParams.get("offset") === "50";
    asked.push(next ? "offset=50" : "offset=0");
    if (next && !refused) {
      refused = true;
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL", message: "boom" },
      });
      return;
    }
    await route.fulfill({
      json: next
        ? {
            // The page's edge moved: its last row read again, then the
            // model's next size, then another model.
            items: [
              row({}),
              row({
                size_id: "fixture-size-l",
                size_label: "L",
                size_is_unknown: false,
                quantity: 2,
                reserved_quantity: 0,
                available_quantity: 2,
              }),
              row({
                product_variant_id: other,
                size_id: "other-size",
                display_name: "Друга сторінка",
                size_label: "M",
                size_is_unknown: false,
                quantity: 1,
                reserved_quantity: 0,
                available_quantity: 1,
              }),
            ],
            has_more: false,
          }
        : {
            items: [
              row({
                product_variant_id: first,
                size_id: "first-size",
                display_name: "Перша сторінка",
                size_label: "S",
                size_is_unknown: false,
                quantity: 1,
                reserved_quantity: 0,
                available_quantity: 1,
              }),
              row({}),
            ],
            has_more: true,
          },
    });
  });
  await enter(page);
  await chip(page, "Основний склад").click();
  await expect(
    page.getByText("Склад на паузі. Залишки доступні для перегляду."),
  ).toBeVisible();
  const held = tagOf(page, fixture.variant_id);
  // The page ends on a model that may go on: shown once it is whole.
  await expect(tagOf(page, first)).toBeVisible();
  await expect(held).toHaveCount(0);
  const showMore = page.getByRole("button", { name: "Показати ще" });
  await showMore.click();
  // Refused: the tags read stand, one «Спробувати ще раз» at their foot
  // where «Показати ще» stood (audit 2026-11-13, goods P1-1).
  const foot = page.locator(".read-failure");
  await expect(foot).toBeVisible();
  await expect(tagOf(page, first)).toBeVisible();
  await expect(showMore).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toHaveCount(1);
  const tag = await tagOf(page, first).boundingBox();
  const plate = await foot.boundingBox();
  expect(tag && plate && plate.y > tag.y).toBe(true);
  asked.length = 0;
  await foot.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(foot).toHaveCount(0);
  expect(asked).toEqual(["offset=50"]);
  // The cursor on the first tag the page brought.
  await expect(
    held.getByRole("button", { name: "Повністю зарезервований" }),
  ).toBeFocused();
  // Its rows glued, the one read twice counted once. Where the store does
  // not sell from the warehouse: what lies there, and the held pin.
  await expect(held.locator(".size-cell .visually-hidden")).toHaveText([
    "розмір невідомий, 4 шт., у резерві 4",
    "L, 2 шт.",
  ]);
  await expect(held.locator(".size-letter")).toHaveText(["?", "L"]);
  await expect(held.locator(".size-free")).toHaveText(["4", "2"]);
  await expect(held.locator(".size-held")).toHaveText(["4"]);
  await expect(held.getByText("? — розмір невідомий")).toBeVisible();
  await expect(tagOf(page, other)).toBeVisible();
  await expect(page.locator(".stock-tag")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  await expect(page.locator(".stock-free")).toHaveCount(0);
});

test("where the store sells from the warehouse, a cell says what is free, a size all held says «у резерві», and the tag «Можна продати N шт.» (stage 2, goods task list, P2-5)", async ({
  page,
}) => {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Place[];
    for (const row of rows) {
      row.is_active = true;
      row.can_sell = true;
      row.damaged_returns = false;
    }
    await route.fulfill({ response, json: rows });
  });
  const sizes: (Row & { suggested_price: string })[] = [
    ["S", 3, 1, 2],
    ["M", 1, 1, 0],
    ["L", 2, 0, 2],
  ].map(([label, quantity, reserved, available]) => ({
    product_variant_id: fixture.variant_id,
    size_id: `size-${String(label)}`,
    display_name: "Три розміри",
    suggested_price: "1500.00",
    size_label: String(label),
    size_is_unknown: false,
    quantity: Number(quantity),
    reserved_quantity: Number(reserved),
    available_quantity: Number(available),
  }));
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({ json: { items: sizes, has_more: false } });
  });
  await enter(page);
  await chip(page, "Основний склад").click();
  const tag = tagOf(page, fixture.variant_id);
  await expect(tag.locator(".size-cell .visually-hidden")).toHaveText([
    "S, вільно 2, у резерві 1",
    "M, вільно 0, у резерві 1",
    "L, вільно 2",
  ]);
  await expect(tag.locator(".size-free")).toHaveText(["2", "у резерві", "2"]);
  await expect(tag.locator(".size-cell.held-only")).toHaveCount(1);
  await expect(tag.locator(".stock-free")).toHaveText("Можна продати 4 шт.");
  await expect(tag.locator(".model-price")).toHaveText(/^1\s500,00\sгрн$/);
});

test("revoked warehouse clears its visible stock and selection", async ({
  page,
}) => {
  await enter(page);
  await chip(page, "Основний склад").click();
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toBeVisible();
  // Taken from this person: the chosen one gone, the rest stay.
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Place[];
    await route.fulfill({
      response,
      json: rows.filter((row) => row.name !== "Основний склад"),
    });
  });
  await page.getByRole("button", { name: "Оновити", exact: true }).click();
  await expect(
    page.getByText("Обраний склад більше не доступний. Оберіть інший склад."),
  ).toBeVisible();
  await expect(chip(page, "Основний склад")).toHaveCount(0);
  await expect(
    page
      .getByRole("group", { name: "Склад", exact: true })
      .locator('[aria-pressed="true"]'),
  ).toHaveCount(0);
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toHaveCount(0);
  // Then every one.
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.getByRole("button", { name: "Оновити", exact: true }).click();
  // Nothing said of the rule (stage 2, goods task list, P1-5); the blank
  // tag, the same words (audit 2026-11-13, goods P2-1).
  const none = page.locator(".orders-empty", {
    hasText: "Тут немає складів.",
  });
  await expect(none).toBeVisible();
  await expect(none.locator(".orders-empty-mark")).toBeVisible();
  await expect(page.getByText(/Зверніться/)).toHaveCount(0);
  await expect(page.getByText(/Лоран шоколад 70(?:\.0)? см/)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Склад" })).toHaveCount(0);
});
