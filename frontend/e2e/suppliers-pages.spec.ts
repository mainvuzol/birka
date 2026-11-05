import { test, expect, openStore, section } from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The suppliers' lists read page by page (stage 2, money task list, P0-7):
 * «Показати ще» asked the server for twenty more each time in one page —
 * 20, 40, 60 — and the server takes fifty at most, so the third was refused
 * and the list gave way to the refusal. Now each press reads the twenty
 * after those read: to the end, none asked past fifty, each row once, and a
 * page that fails keeps what was read. Ганна holds every right at «Центр»;
 * the lists are stubbed, sixty-one rows each, paged as the server pages
 * them.
 */

interface Fixture {
  network_centre_seller_telegram_user_id: string;
  network_centre_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const hanna = fixture.network_centre_seller_telegram_user_id;
const centre = fixture.network_centre_store_id;

function initData(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Ганна"}`,
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

const ROWS = 61;

/** The n-th row's moment: an hour apart, the newest first. */
function hoursBack(n: number): string {
  return new Date(Date.UTC(2026, 9, 30, 12) - n * 3_600_000).toISOString();
}

function supplier(n: number) {
  return { id: randomUUID(), name: `Постачальник ${String(n)}`, phone: null };
}

function invoice(n: number) {
  return {
    id: randomUUID(),
    store_id: centre,
    store_name: "Центр",
    store_state: "ACTIVE",
    supplier: supplier(n),
    amount: "1000.00",
    currency_code: "UAH",
    note: null,
    status: "OPEN",
    paid: "0.00",
    set_off: "0.00",
    written_off: "0.00",
    owed: "1000.00",
    by: "Ганна",
    at: hoursBack(n),
    last_payment_at: null,
    closed_at: null,
    cancelled: null,
    entries: [],
  };
}

function sentBack(n: number) {
  return {
    id: randomUUID(),
    store_id: centre,
    location_id: randomUUID(),
    location_name: "Основний",
    supplier: supplier(n),
    damaged_unit_id: null,
    note: null,
    by: "Ганна",
    at: hoursBack(n),
    lines: [
      {
        product_variant_id: randomUUID(),
        size_id: randomUUID(),
        quantity: 1,
        display_name: "Пальто",
        size: "M",
      },
    ],
    cancelled: null,
    set_offs: [],
  };
}

function lot(n: number) {
  const variant = randomUUID();
  return {
    stock_lot_id: randomUUID(),
    acquisition_type: "BORROWED",
    supplier: supplier(n),
    location_id: randomUUID(),
    location_name: "Основний",
    product_variant_id: variant,
    held_as_variant_id: variant,
    size_id: randomUUID(),
    display_name: `Позичене ${String(n)}`,
    size: "M",
    unit_cost: "500.00",
    currency_code: "UAH",
    received: 1,
    sold: 0,
    returned: 0,
    on_hand: 1,
    at: hoursBack(n),
  };
}

/**
 * «Центр»'s list at `path`, paged as the server pages it — fifty at most,
 * a longer page refused — newest first. Once the first page is read, one
 * more row is written at its top, so the next page begins with the last
 * row already read; the page at `fails`, once, is a 500.
 */
async function listed(
  page: Page,
  path: string,
  rows: unknown[],
  written: unknown,
  fails?: number,
): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  const all = [...rows];
  let failed = false;
  await page.route(`**/api/v1/${path}?**`, async (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("store_id") !== centre) {
      await route.fallback();
      return;
    }
    asked.push(params);
    const limit = Number(params.get("limit") ?? "20");
    const offset = Number(params.get("offset") ?? "0");
    if (limit > 50) {
      await route.fulfill({
        status: 422,
        json: { code: "VALIDATION_ERROR", message: "Invalid request" },
      });
      return;
    }
    if (offset === fails && !failed) {
      failed = true;
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    const answer = {
      items: all.slice(offset, offset + limit),
      has_more: offset + limit < all.length,
    };
    if (offset === 0 && all.length === rows.length) all.unshift(written);
    await route.fulfill({ json: answer });
  });
  return asked;
}

async function enter(page: Page, to: string): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(hanna) }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await section(page, to);
}

/**
 * «Показати ще» to the end: twenty a page, the row read twice shown once,
 * the page after forty failing once with what was read standing, and no
 * page asked for more than the server takes.
 */
async function toTheEnd(
  rows: Locator,
  more: Locator,
  failure: Locator,
  asked: URLSearchParams[],
): Promise<void> {
  await expect(rows).toHaveCount(20);
  await more.click();
  // The row the page's edge moved past is shown once.
  await expect(rows).toHaveCount(39);
  await more.click();
  await expect(failure).toBeVisible();
  await expect(rows).toHaveCount(39);
  await more.click();
  await expect(rows).toHaveCount(59);
  await expect(failure).toHaveCount(0);
  await more.click();
  await expect(rows).toHaveCount(ROWS);
  await expect(more).toHaveCount(0);
  expect(asked.map((params) => params.get("limit"))).not.toContain(null);
  expect(asked.every((params) => Number(params.get("limit")) === 20)).toBe(
    true,
  );
  expect(asked.map((params) => params.get("offset"))).toEqual(
    expect.arrayContaining(["0", "20", "40", "60"]),
  );
}

test("«Накладні»: «Показати ще» to the sixty-first invoice, twenty a page, each once, a failed page keeping the forty read", async ({
  page,
}) => {
  const asked = await listed(
    page,
    "supplier-invoices",
    Array.from({ length: ROWS }, (_, n) => invoice(n)),
    invoice(-1),
    40,
  );
  await enter(page, "Накладні");
  const list = page.locator("section", {
    has: page.getByRole("article", { name: /^Накладна Постачальник / }),
  });
  await toTheEnd(
    page.getByRole("article", { name: /^Накладна Постачальник / }),
    page.getByRole("button", { name: "Показати ще", exact: true }),
    list.last().getByRole("alert"),
    asked,
  );
  // Asked as before: what is still owed, of this store.
  expect(asked[0]?.get("status")).toBe("OPEN");
});

test("«Постачальникам»: the returns to the sixty-first, twenty a page, each once, a failed page keeping what was read", async ({
  page,
}) => {
  const asked = await listed(
    page,
    "supplier-returns",
    Array.from({ length: ROWS }, (_, n) => sentBack(n)),
    sentBack(-1),
    40,
  );
  // Nothing borrowed: one «Показати ще» on the screen.
  await page.route("**/api/v1/borrowed?**", async (route) => {
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await enter(page, "Постачальникам");
  const list = page.locator("section", {
    has: page.getByRole("article", { name: /^Повернення Постачальник / }),
  });
  await toTheEnd(
    page.getByRole("article", { name: /^Повернення Постачальник / }),
    page.getByRole("button", { name: "Показати ще", exact: true }),
    list.last().getByRole("alert"),
    asked,
  );
});

test("«Позичене й під реалізацію»: the lots to the sixty-first, twenty a page, each once, a failed page keeping what was read", async ({
  page,
}) => {
  await page.route("**/api/v1/supplier-returns?**", async (route) => {
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  const asked = await listed(
    page,
    "borrowed",
    Array.from({ length: ROWS }, (_, n) => lot(n)),
    lot(-1),
    40,
  );
  await enter(page, "Постачальникам");
  const region = page.getByRole("region", {
    name: "Позичене й під реалізацію",
  });
  await toTheEnd(
    region.getByRole("article", { name: /^Позичене \d+, M від / }),
    region.getByRole("button", { name: "Показати ще", exact: true }),
    region.getByRole("alert"),
    asked,
  );
  // Asked as before: what is still on hand.
  expect(asked[0]?.has("on_hand")).toBe(false);
});
