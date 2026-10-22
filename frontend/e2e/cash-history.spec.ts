import { test, expect, openStore } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Закриття» (cash task list, P1-4): a row a close — its day and who
 * closed, what was counted and expected, what it came to as a pill — and a
 * row each day nobody closed; a close tapped, all of it, as its result
 * showed it. The closes are stubbed, so each is the one each journey needs.
 */

interface Fixture {
  network_owner_telegram_user_id: string;
  network_cash_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const store = fixture.network_cash_store_id;
const owner = fixture.network_owner_telegram_user_id;

function launch(theme?: Record<string, string>): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${owner},"first_name":"Власник"}`,
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

const zero = {
  came_in: "0.00",
  went_out: "0.00",
  corrected: "0.00",
  net: "0.00",
};

/** A close as the server answers it, for the owner: with its period. */
function closeOf(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: randomUUID(),
    number: 4,
    business_day: "2026-10-20",
    closed_at: "2026-10-20T17:14:00Z",
    closed_by: "Оля",
    mine: false,
    store_id: store,
    store_name: "Каса",
    opening: false,
    since: "2026-10-19T17:10:00Z",
    counted: "2000.00",
    expected: "2000.00",
    difference: "0.00",
    card: {
      came_in: "700.00",
      went_out: "0.00",
      corrected: "0.00",
      net: "700.00",
    },
    transfer: zero,
    unclosed_days: [],
    reason: null,
    reason_by: null,
    reason_required: false,
    opening_float: "1000.00",
    cash_in: "1200.00",
    cash_out: "0.00",
    taken_out: "150.00",
    put_in: null,
    cash_corrected: null,
    prepaid_transfer: null,
    carrier_cod: null,
    not_stated: null,
    // The owner's: what explains the difference, and what does not.
    explained: "0.00",
    unexplained: "0.00",
    explanations: [],
    ...over,
  };
}

/** Newest first: a shortage no reason was given for, a day nobody closed
 * before it; a surplus explained in part; to the kopeck; the first count. */
const shortage = closeOf({
  business_day: "2026-10-20",
  closed_at: "2026-10-20T17:14:00Z",
  counted: "2000.00",
  expected: "2050.00",
  difference: "-50.00",
  reason_required: true,
  unexplained: "-50.00",
  unclosed_days: ["2026-10-18", "2026-10-19"],
});
const surplus = closeOf({
  business_day: "2026-10-17",
  closed_at: "2026-10-17T17:02:00Z",
  closed_by: "Марко",
  counted: "2350.00",
  expected: "2000.00",
  difference: "350.00",
  reason: "Розмін не записали",
  reason_by: "Марко",
  reason_required: true,
  // Change put in and recorded late explains 50 of it.
  explained: "50.00",
  unexplained: "300.00",
  explanations: [
    {
      kind: "PUT_IN",
      at: "2026-10-17T09:00:00Z",
      by: "Марко",
      cash: "50.00",
      text: "розмін",
    },
  ],
});
// To the kopeck, then a way fixed against it: nothing to explain, so the
// row says nothing of it, as the close does not.
const exact = closeOf({
  business_day: "2026-10-16",
  closed_at: "2026-10-16T16:58:00Z",
  explained: "-50.00",
  unexplained: "50.00",
});
const first = closeOf({
  business_day: "2026-09-11",
  closed_at: "2026-09-11T08:01:00Z",
  opening: true,
  counted: "1000.00",
  expected: null,
  difference: null,
  opening_float: null,
  cash_in: null,
  explained: null,
  unexplained: null,
});

/** Twenty to the page, as the screen asks; the rest on the next. */
function pages(): Record<string, unknown>[] {
  const older = Array.from({ length: 17 }, (_, index) =>
    closeOf({
      business_day: `2026-09-${String(28 - index).padStart(2, "0")}`,
      closed_at: `2026-09-${String(28 - index).padStart(2, "0")}T17:00:00Z`,
    }),
  );
  return [shortage, surplus, exact, ...older, first];
}

async function stub(page: Page): Promise<{ asked: string[] }> {
  const asked: string[] = [];
  const all = pages();
  await page.route("**/api/v1/cash/drawer?**", async (route) => {
    await route.fulfill({
      json: {
        store_id: store,
        store_name: "Каса",
        store_state: "ACTIVE",
        last_close: {
          id: String(shortage.id),
          number: 4,
          business_day: "2026-10-20",
          closed_at: "2026-10-20T17:14:00Z",
          closed_by: "Оля",
          mine: false,
        },
        next_is_opening: false,
        closed_today: false,
        may_close: true,
        movement_kinds: ["OWNER", "EXPENSES", "SUPPLIER_COURIER", "CHANGE"],
        may_correct: true,
        movements: [],
        unclosed_days: [],
        reason_owed: null,
      },
    });
  });
  // One close read by its id: as it is now — the shortage's reason written
  // meanwhile.
  await page.route("**/api/v1/cash/closes/*", async (route, request) => {
    const id = new URL(request.url()).pathname.split("/").pop();
    const close = all.find((each) => each.id === id);
    await route.fulfill({
      json:
        close === shortage
          ? { ...close, reason: "Здача", reason_by: "Оля" }
          : close,
    });
  });
  await page.route("**/api/v1/cash/closes?**", async (route, request) => {
    const url = new URL(request.url());
    asked.push(url.search);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    await route.fulfill({
      json: {
        items: all.slice(offset, offset + limit),
        has_more: offset + limit < all.length,
      },
    });
  });
  return { asked };
}

async function history(
  page: Page,
  theme?: Record<string, string>,
): Promise<Locator> {
  await page.goto("about:blank");
  await page.goto(launch(theme));
  await openStore(page, /^Каса CASH/);
  await page.getByRole("button", { name: "Каса", exact: true }).click();
  await page.getByRole("button", { name: "Закриття", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Закриття", exact: true }),
  ).toBeVisible();
  return page.getByRole("list", { name: "Закриття каси" });
}

function row(list: Locator, day: string): Locator {
  return list.getByRole("listitem", { name: `Закриття ${day}` });
}

test("«Закриття»: a row a close — its day and who, what was counted and expected, what it came to as a pill — and a row each day nobody closed (cash task list, P1-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stub(page);
  const list = await history(page);
  const short = row(list, "20.10");
  await expect(short.locator(".cash-row-title")).toHaveText("20.10 · Оля");
  await expect(short.locator(".sale-meta")).toHaveText(
    /^\d{2}:\d{2} · порахували 2\s000,00 · мало бути 2\s050,00 · причину не вказано$/,
  );
  await expect(short.locator(".badge")).toHaveText("Нестача 50,00 грн");
  await expect(short.locator(".badge")).toHaveClass(/\bwarn\b/);
  // The days nobody closed, newest first, after the close they came into.
  const unclosed = list.locator(".close-unclosed");
  await expect(unclosed).toHaveCount(2);
  await expect(unclosed.nth(0)).toHaveAccessibleName("19.10 — не закрито");
  await expect(unclosed.nth(0).locator(".badge")).toHaveText("Не закрито");
  await expect(unclosed.nth(0).locator(".badge")).toHaveClass(/\bneutral\b/);
  await expect(unclosed.nth(1)).toHaveAccessibleName("18.10 — не закрито");
  const over = row(list, "17.10");
  await expect(over.locator(".sale-meta")).toHaveText(
    /^\d{2}:\d{2} · порахували 2\s350,00 · мало бути 2\s000,00 · пояснено \+50,00$/,
  );
  await expect(over.locator(".badge")).toHaveText("Надлишок 350,00 грн");
  await expect(over.locator(".badge")).toHaveClass(/\bwarn\b/);
  const same = row(list, "16.10");
  await expect(same.locator(".sale-meta")).toHaveText(
    /^\d{2}:\d{2} · порахували 2\s000,00 · мало бути 2\s000,00$/,
  );
  await expect(same.locator(".badge")).toHaveText("Збіглося");
  await expect(same.locator(".badge")).not.toHaveClass(/\b(warn|neutral)\b/);
  // The pills one column down the list, under each day.
  const lefts = await list
    .locator(".close-row .badge, .close-unclosed .badge")
    .evaluateAll((pills) =>
      pills.map((pill) => pill.getBoundingClientRect().x),
    );
  expect(new Set(lefts).size).toBe(1);
  const opening = list.getByRole("listitem", { name: "Закриття 11.09" });
  // The first count is on the next page.
  await expect(opening).toHaveCount(0);
  // Nothing wider than the phone.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});

test("a close tapped shows all of it as its result did — the figures, the slip, the reason, the period — and «← Закриття» leads back (cash task list, P1-4)", async ({
  page,
}) => {
  await stub(page);
  const list = await history(page);
  await row(list, "17.10").getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: "Закриття 17.10" }),
  ).toBeFocused();
  await expect(page.locator(".cash-context")).toHaveText(
    /^\d{2}:\d{2} · Марко$/,
  );
  const figures = page.getByRole("group", { name: "Закриття каси" });
  await expect(figures.locator(".cash-sum").nth(0)).toHaveText("2 000,00 грн");
  await expect(figures.locator(".cash-sum").nth(1)).toHaveText("2 350,00 грн");
  await expect(figures.locator(".cash-difference")).toHaveText(
    "Надлишок 350,00 грн",
  );
  await expect(
    page.getByText("Причина: «Розмін не записали» · Марко"),
  ).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "1 200,00 грн" }),
  ).toBeVisible();
  await expect(
    page.getByText("Пояснено: +50,00 грн. Не пояснено: 300,00 грн."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Назад до закриттів" }).click();
  await expect(row(list, "17.10")).toBeVisible();
  // A close far down the list, left: the list where it was.
  const far = list.locator(".close-row").nth(15);
  await far.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await far.click();
  await page.getByRole("button", { name: "Назад до закриттів" }).click();
  await expect(far).toBeInViewport();
  await expect(far).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // A day nobody closed is said, under the close it came into.
  await row(list, "20.10").getByRole("button").click();
  await expect(
    page.getByText(
      /^Не закрито: 18\.10, 19\.10 — ці дні увійшли в це закриття\.$/,
    ),
  ).toBeVisible();
  // Read again by its id: the reason written since the list was read.
  await expect(page.getByText("Причина: «Здача» · Оля")).toBeVisible();
});

test("twenty closes to a page, «Показати ще» for the rest; the first count's pill says so (cash task list, P1-4)", async ({
  page,
}) => {
  const server = await stub(page);
  const list = await history(page);
  await expect(list.locator(".close-row")).toHaveCount(20);
  expect(server.asked.some((search) => /limit=20&offset=0/.test(search))).toBe(
    true,
  );
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(list.locator(".close-row")).toHaveCount(21);
  const opening = row(list, "11.09");
  await expect(opening.locator(".sale-meta")).toHaveText(
    /^\d{2}:\d{2} · порахували 1\s000,00$/,
  );
  await expect(opening.locator(".badge")).toHaveText("Перший підрахунок");
  await expect(opening.locator(".badge")).toHaveClass(/\bneutral\b/);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  // Tapped: a first count by its name, and nothing of «next time», long
  // come.
  await opening.getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: "Перший підрахунок 11.09" }),
  ).toBeVisible();
  await expect(page.getByText("Порахували")).toBeVisible();
  await expect(page.getByText(/наступного разу/)).toHaveCount(0);
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

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme the closes and their pills read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await stub(page);
    const list = await history(page, theme);
    for (const part of [
      row(list, "20.10").locator(".cash-row-title"),
      row(list, "20.10").locator(".sale-meta"),
      row(list, "20.10").locator(".badge"),
      row(list, "17.10").locator(".badge"),
      row(list, "16.10").locator(".badge"),
      list.locator(".close-unclosed .badge").first(),
      list.locator(".close-unclosed .cash-row-title").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-history-${name}.png` });
    await row(list, "20.10").getByRole("button").click();
    await page.screenshot({
      path: `test-results/cash-history-close-${name}.png`,
    });
  });
