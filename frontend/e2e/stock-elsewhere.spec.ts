import { test, expect, openStore, toTill } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A search at the till says what is free in the person's other stores
 * (spec S09, the owner's; «Усе на бірці» task list, P2-3): under each
 * model, a line a store, «Ще в магазині «Ринок»: M 1 · L 1» — said, never
 * pressed. Each trading store where they read the stock is asked once a
 * search; a warehouse this till sells from is on the tag already, held
 * units are not free, and a store whose answer did not end says nothing.
 * The stock is the server's shape, stubbed: the specs share the network's
 * warehouses.
 */
interface Fixture {
  network_owner_telegram_user_id: string;
  network_centre_seller_telegram_user_id: string;
  network_centre_store_id: string;
  network_market_store_id: string;
  network_north_store_id: string;
  network_south_store_id: string;
  network_paused_store_id: string;
  network_shared_location_id: string;
  network_market_location_id: string;
  network_north_south_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function launch(telegramUserId: string, name: string): string {
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
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

interface Row {
  location_id: string;
  product_variant_id: string;
  size_id: string;
  display_name: string;
  size_label: string;
  size_is_unknown: boolean;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  suggested_price: string | null;
}

const graphite = randomUUID();
const grey = randomUUID();
const sizes = { S: randomUUID(), M: randomUUID(), L: randomUUID() };

function units(
  location: string,
  model: string,
  name: string,
  size: keyof typeof sizes | "?",
  held: number,
  reserved = 0,
): Row {
  return {
    location_id: location,
    product_variant_id: model,
    size_id: size === "?" ? randomUUID() : sizes[size],
    display_name: name,
    size_label: size === "?" ? "" : size,
    size_is_unknown: size === "?",
    quantity: held,
    reserved_quantity: reserved,
    available_quantity: held - reserved,
    suggested_price: "1850.00",
  };
}

const shared = fixture.network_shared_location_id;
const marketOwn = fixture.network_market_location_id;

/** Each store's answer: «Центр» sells from the network's warehouse alone;
 * «Ринок» from it too and from its own; «Північ» holds more than a page. */
const answers: Record<string, { items: Row[]; has_more: boolean }> = {
  [fixture.network_centre_store_id]: {
    items: [
      units(shared, graphite, "Кокон графіт", "S", 1),
      units(shared, grey, "Кокон сірий", "M", 2),
    ],
    has_more: false,
  },
  [fixture.network_market_store_id]: {
    items: [
      // Seen at «Центр» already: the warehouse both sell from.
      units(shared, graphite, "Кокон графіт", "S", 1),
      units(marketOwn, graphite, "Кокон графіт", "M", 1),
      units(marketOwn, graphite, "Кокон графіт", "L", 2, 1),
      units(marketOwn, graphite, "Кокон графіт", "?", 1),
      // Every one held for an order: none free.
      units(marketOwn, grey, "Кокон сірий", "L", 1, 1),
    ],
    has_more: false,
  },
  [fixture.network_north_store_id]: {
    items: [
      units(
        fixture.network_north_south_location_id,
        graphite,
        "Кокон графіт",
        "M",
        5,
      ),
    ],
    has_more: true,
  },
};

/** The stock as each store's till lists it, whatever was typed; who was
 * asked, and for what. Every warehouse has its opening list approved: the
 * network's waits for one on the seed, and the till would sell on paper. */
async function stubStock(
  page: Page,
): Promise<{ store: string; query: string }[]> {
  const asked: { store: string; query: string }[] = [];
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as object[];
    await route.fulfill({
      response,
      json: rows.map((row) => ({ ...row, awaiting_first_stock: false })),
    });
  });
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const url = new URL(route.request().url());
    const store = url.searchParams.get("store_id") ?? "";
    asked.push({ store, query: url.searchParams.get("query") ?? "" });
    await route.fulfill({
      json: answers[store] ?? { items: [], has_more: false },
    });
  });
  return asked;
}

function search(page: Page): Locator {
  return page.getByRole("searchbox", { name: "Знайти модель" });
}

function model(page: Page, name: string): Locator {
  return page.getByRole("group", { name, exact: true });
}

/** The WCAG contrast of an element's text against the first fill behind
 * it. */
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
    let behind = "rgba(0, 0, 0, 0)";
    while (ground) {
      behind = getComputedStyle(ground).backgroundColor;
      const alpha = rgb(behind)[3];
      if (alpha === undefined || alpha > 0) break;
      ground = ground.parentElement;
    }
    const a = luminance(rgb(getComputedStyle(node).color));
    const b = luminance(rgb(behind));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test("a search says what is free in the owner's other stores under each model, a line a store, asked once a search, never pressed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const asked = await stubStock(page);
  // «Південь» kept, its stock not read there: never asked.
  await page.route("**/api/v1/me", async (route) => {
    const answer = await route.fetch();
    const me = (await answer.json()) as {
      stores: { id: string; permissions: string[] }[];
    };
    await route.fulfill({
      response: answer,
      json: {
        ...me,
        stores: me.stores.map((store) =>
          store.id === fixture.network_south_store_id
            ? {
                ...store,
                permissions: store.permissions.filter(
                  (right) => right !== "inventory:view",
                ),
              }
            : store,
        ),
      },
    });
  });
  await page.goto(launch(fixture.network_owner_telegram_user_id, "Власник"));
  await openStore(page, "Центр CENTRE");
  await toTill(page);
  await expect(model(page, "Кокон графіт")).toBeVisible();
  // Nothing typed, nothing asked elsewhere.
  const elsewhere = (): { store: string; query: string }[] =>
    asked.filter((read) => read.store !== fixture.network_centre_store_id);
  expect(elsewhere()).toEqual([]);
  await expect(page.locator(".elsewhere")).toHaveCount(0);

  await search(page).fill("кокон");
  const line = model(page, "Кокон графіт").locator(".elsewhere");
  // «Ринок»'s own warehouse, by size in the server's order, the held unit
  // left out; the network's warehouse is on the tag already; «Північ»'s
  // answer did not end.
  await expect(line).toHaveText([
    "Ще в магазині «Ринок»: M 1 · L 1 · розмір невідомий 1",
  ]);
  await expect(model(page, "Кокон сірий").locator(".elsewhere")).toHaveCount(0);
  await expect(
    model(page, "Кокон графіт").getByRole("button", { name: /Ринок/ }),
  ).toHaveCount(0);
  // Once a search, a store each: the trading ones where the stock is read.
  const once = elsewhere();
  expect(once.every((read) => read.query === "кокон")).toBe(true);
  const stores = once.map((read) => read.store);
  expect(new Set(stores).size).toBe(stores.length);
  expect(stores).toEqual(
    expect.arrayContaining([
      fixture.network_market_store_id,
      fixture.network_north_store_id,
    ]),
  );
  expect(stores).not.toContain(fixture.network_south_store_id);
  expect(stores).not.toContain(fixture.network_paused_store_id);
  await page.waitForTimeout(500);
  expect(elsewhere()).toHaveLength(once.length);
  // Another search, asked again; the line reads in both themes and fits.
  await search(page).fill("кокон г");
  await expect.poll(() => elsewhere().length).toBe(2 * once.length);
  await expect(line).toHaveText([
    "Ще в магазині «Ринок»: M 1 · L 1 · розмір невідомий 1",
  ]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await contrast(line)).toBeGreaterThanOrEqual(4.5);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  // Cleared, the lines go with the search.
  await search(page).fill("");
  await expect(page.locator(".elsewhere")).toHaveCount(0);
});

test("a seller whose stock is read at «Центр» alone sees no other store's line and asks none", async ({
  page,
}) => {
  const asked = await stubStock(page);
  // «Ринок» hers too, its stock not read there: a seller there alone.
  await page.route("**/api/v1/me", async (route) => {
    const answer = await route.fetch();
    const me = (await answer.json()) as { stores: object[] };
    await route.fulfill({
      response: answer,
      json: {
        ...me,
        stores: [
          ...me.stores,
          {
            id: fixture.network_market_store_id,
            name: "Ринок",
            code: "MARKET",
            state: "ACTIVE",
            state_since: null,
            permissions: ["sale:create"],
          },
        ],
      },
    });
  });
  await page.goto(
    launch(fixture.network_centre_seller_telegram_user_id, "Ганна"),
  );
  await openStore(page, "Центр CENTRE");
  await toTill(page);
  await search(page).fill("кокон");
  await expect(model(page, "Кокон графіт")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator(".elsewhere")).toHaveCount(0);
  expect(
    asked.filter((read) => read.store !== fixture.network_centre_store_id),
  ).toEqual([]);
});
