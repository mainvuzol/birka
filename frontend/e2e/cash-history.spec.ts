import { test, expect, openStore, section, expectOneSticker } from "./fixtures";
import { icons } from "../src/shared/icons";
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

async function stub(
  page: Page,
  /** Offsets of the closes' pages refused once. */
  failing: Set<number> = new Set(),
): Promise<{ asked: string[]; held: Map<number, Promise<void>> }> {
  const asked: string[] = [];
  /** Offsets of the closes' pages answered only once their gate opens. */
  const held = new Map<number, Promise<void>>();
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
    // The history's pages alone: «Каса»'s own reads of the closes ask no
    // offset.
    const paged = url.searchParams.has("offset");
    if (paged) await held.get(offset);
    if (paged && failing.delete(offset)) {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: all.slice(offset, offset + limit),
        has_more: offset + limit < all.length,
      },
    });
  });
  return { asked, held };
}

async function history(
  page: Page,
  theme?: Record<string, string>,
): Promise<Locator> {
  await page.goto("about:blank");
  await page.goto(launch(theme));
  await openStore(page, /^Каса CASH/);
  await section(page, "Каса");
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
  await expect(short.locator(".close-pill")).toHaveText("Нестача 50,00 грн");
  await expect(short.locator(".close-pill")).toHaveClass(/\btone-warn\b/);
  // Each sticker with its sign but the neutral ones; a ring at the row's
  // left only while a reason waits, a knot on every other close (stage 2,
  // money task list, P1-2).
  await expect(short.locator(".close-pill svg.icon")).toHaveCount(1);
  await expect(short.locator(".close-node .close-ring")).toHaveCount(1);
  await expect(short.locator(".close-node .eyelet-knot")).toHaveCount(0);
  // The days nobody closed, newest first, after the close they came into.
  const unclosed = list.locator(".close-unclosed");
  await expect(unclosed).toHaveCount(2);
  await expect(unclosed.nth(0)).toHaveAccessibleName("19.10 — не закрито");
  await expect(unclosed.nth(0).locator(".close-pill")).toHaveText("Не закрито");
  await expect(unclosed.nth(0).locator(".close-pill")).toHaveClass(
    "sticker close-pill",
  );
  await expect(unclosed.nth(0).locator(".close-pill svg")).toHaveCount(0);
  await expect(unclosed.nth(0).locator(".close-node > *")).toHaveCount(0);
  await expect(unclosed.nth(1)).toHaveAccessibleName("18.10 — не закрито");
  const over = row(list, "17.10");
  await expect(over.locator(".sale-meta")).toHaveText(
    /^\d{2}:\d{2} · порахували 2\s350,00 · мало бути 2\s000,00 · пояснено \+50,00$/,
  );
  await expect(over.locator(".close-pill")).toHaveText("Надлишок 350,00 грн");
  await expect(over.locator(".close-pill")).toHaveClass(/\btone-warn\b/);
  await expect(over.locator(".close-pill svg.icon")).toHaveCount(1);
  await expect(over.locator(".close-node .eyelet-knot")).toHaveCount(1);
  await expect(over.locator(".close-node .close-ring")).toHaveCount(0);
  await expectOneSticker(list);
  const same = row(list, "16.10");
  await expect(same.locator(".sale-meta")).toHaveText(
    /^\d{2}:\d{2} · порахували 2\s000,00 · мало бути 2\s000,00$/,
  );
  await expect(same.locator(".close-pill")).toHaveText("Збіглося");
  // The till's own match, not the paid's green (orders and «Каса» task
  // list after stage 2, P1-4).
  await expect(same.locator(".close-pill")).toHaveClass(
    "sticker tone-match close-pill",
  );
  await expect(same.locator(".close-pill svg.icon")).toHaveCount(1);
  await expect(same.locator(".close-node .eyelet-knot")).toHaveCount(1);
  // The signs are not one: the triangle, the knot.
  expect(await short.locator(".close-pill svg").innerHTML()).not.toBe(
    await same.locator(".close-pill svg").innerHTML(),
  );
  // The ring stands only where a reason waits.
  await expect(list.locator(".close-ring")).toHaveCount(1);
  // A close's row 64 at least, its chevron the set's 16 in pencil, never a
  // «›» (P2-4).
  await expect(list).not.toContainText("›");
  expect(
    await list.locator(".close-row").evaluateAll((rows) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--pencil)";
      document.body.append(probe);
      const pencil = getComputedStyle(probe).color;
      probe.remove();
      return [
        ...new Set(
          rows.map((row) => {
            const chevron = row.querySelector(":scope > svg.sale-open");
            return JSON.stringify([
              row.getBoundingClientRect().height >= 64,
              chevron?.getBoundingClientRect().width,
              chevron ? getComputedStyle(chevron).color === pencil : false,
            ]);
          }),
        ),
      ];
    }),
  ).toEqual([JSON.stringify([true, 16, true])]);
  // The pills one column down the list, under each day.
  const lefts = await list
    .locator(".close-row .close-pill, .close-unclosed .close-pill")
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
  // Its store, when and who, in the screen's one line: no second line under
  // the title (orders and «Каса» task list after stage 2, P2-1).
  await expect(page.locator(".store-line p")).toHaveText(
    /^Каса · \d{2}:\d{2} · Марко$/,
  );
  await expect(page.locator(".cash-context")).toHaveCount(0);
  const figures = page.getByRole("group", { name: "Закриття каси" });
  await expect(figures.locator(".cash-sum").nth(0)).toHaveText("2 000,00 грн");
  await expect(figures.locator(".cash-sum").nth(1)).toHaveText("2 350,00 грн");
  await expect(figures.locator(".cash-difference")).toHaveText(
    "Надлишок 350,00 грн",
  );
  // Read later, a line with its sign: the warning's triangle before its
  // words, 16 (P1-4).
  const sign = figures.locator(".cash-difference > svg.difference-sign");
  expect(await sign.innerHTML()).toBe(
    await sign.evaluate((svg, want) => {
      const probe = document.createElementNS(svg.namespaceURI, "svg");
      probe.innerHTML = want;
      return probe.innerHTML;
    }, icons.warning),
  );
  expect((await sign.boundingBox())?.width).toBe(16);
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
  // One to the kopeck, read later: its knot before «Збіглося до копійки»,
  // in the accent (P1-4).
  await row(list, "16.10").getByRole("button").click();
  const exact = page
    .getByRole("group", { name: "Закриття каси" })
    .locator(".cash-difference");
  await expect(exact).toHaveText("Збіглося до копійки");
  const knot = exact.locator("svg.difference-sign");
  expect(await knot.innerHTML()).toBe(
    await knot.evaluate((svg, want) => {
      const probe = document.createElementNS(svg.namespaceURI, "svg");
      probe.innerHTML = want;
      return probe.innerHTML;
    }, icons["eyelet-knot"]),
  );
  await page.getByRole("button", { name: "Назад до закриттів" }).click();
  await expect(row(list, "16.10")).toBeVisible();
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
  await page.setViewportSize({ width: 360, height: 640 });
  const server = await stub(page);
  const list = await history(page);
  await expect(list.locator(".close-row")).toHaveCount(20);
  expect(server.asked.some((search) => /limit=20&offset=0/.test(search))).toBe(
    true,
  );
  // «Показати ще» keeps the list where it was read to, never back at its
  // start (audit after stage 2, frame P1-3).
  const showMore = page.getByRole("button", { name: "Показати ще" });
  await showMore.scrollIntoViewIfNeeded();
  const at = await page.evaluate(() => window.scrollY);
  expect(at).toBeGreaterThan(0);
  await showMore.click();
  await expect(list.locator(".close-row")).toHaveCount(21);
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - at),
  ).toBeLessThanOrEqual(4);
  const opening = row(list, "11.09");
  await expect(opening.locator(".sale-meta")).toHaveText(
    /^\d{2}:\d{2} · порахували 1\s000,00$/,
  );
  await expect(opening.locator(".close-pill")).toHaveText("Перший підрахунок");
  await expect(opening.locator(".close-pill")).toHaveClass(
    "sticker close-pill",
  );
  await expect(opening.locator(".close-pill svg")).toHaveCount(0);
  await expect(opening.locator(".close-node .eyelet-knot")).toHaveCount(1);
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

test("a page of closes that could not be read is one plate where «Показати ще» stood, its «Спробувати ще раз» reading that page, the closes read kept (orders and «Каса» task list after stage 2, P2-6)", async ({
  page,
}) => {
  const failing = new Set([20]);
  const server = await stub(page, failing);
  const list = await history(page);
  const closes = list.locator(".close-row");
  await expect(closes).toHaveCount(20);
  await page.getByRole("button", { name: "Показати ще" }).click();
  const plate = page.locator(".notice.read-failure");
  const atFoot = async (): Promise<void> => {
    await expect(plate).toHaveCount(1);
    await expect(plate).toHaveAttribute("role", "alert");
    await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
    await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
      0,
    );
    await expect(closes).toHaveCount(20);
    // Under the closes read, never over them.
    const [last, under] = await Promise.all([
      closes.last().boundingBox(),
      plate.boundingBox(),
    ]);
    expect(last && under && under.y >= last.y + last.height).toBe(true);
  };
  await atFoot();

  // Read again whole on return to the app meanwhile: the plate stays where
  // «Показати ще» stood, its retry held till answered, nothing said over
  // the closes; answered, «Показати ще» is back (review).
  const firsts = (): number =>
    server.asked.filter((search) => /limit=20&offset=0(&|$)/.test(search))
      .length;
  const before = firsts();
  let reread = (): void => undefined;
  server.held.set(
    0,
    new Promise<void>((done) => {
      reread = done;
    }),
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(firsts).toBeGreaterThan(before);
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 800);
      }),
  );
  await atFoot();
  await expect(
    plate.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeDisabled();
  server.held.delete(0);
  reread();
  await expect(plate).toHaveCount(0);

  failing.add(20);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await atFoot();
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(closes).toHaveCount(21);
  await expect(plate).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  expect(
    server.asked.filter((search) => /limit=20&offset=20/.test(search)),
  ).toHaveLength(3);

  // The whole list read again and refused: said over the closes, as before;
  // its retry reads it all again (review).
  failing.add(0);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(plate).toHaveCount(1);
  await expect(closes).toHaveCount(21);
  const [over, first] = await Promise.all([
    plate.boundingBox(),
    closes.first().boundingBox(),
  ]);
  expect(over && first && over.y + over.height <= first.y).toBe(true);
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(plate).toHaveCount(0);
  await expect(closes).toHaveCount(21);
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
      row(list, "20.10").locator(".close-pill"),
      row(list, "17.10").locator(".close-pill"),
      row(list, "16.10").locator(".close-pill"),
      list.locator(".close-unclosed .close-pill").first(),
      list.locator(".close-unclosed .cash-row-title").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-history-${name}.png` });
    await row(list, "20.10").getByRole("button").click();
    await page.screenshot({
      path: `test-results/cash-history-close-${name}.png`,
    });
  });
