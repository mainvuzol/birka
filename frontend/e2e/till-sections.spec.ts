import { test, expect, more, openStore, sections, tapSize } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The sections and the header in the new design (sale-slice TZ, P1-6), and
 * the till's reminder once the server is back (P1-7; owner decisions,
 * 2026-10-15: the reminder is the till's alone, В7 (б)).
 *
 * The counter's work stands in one row — «Продаж», «Клієнти», «Каса», each
 * for whoever may do it; «Повернення» is «Продаж»'s other way, «Борги» and
 * «Замовлення» are «Клієнти»'s (navigation task list, P0-1, P0-2) — and
 * every other section is under «Ще», by the same rights as before. The
 * header is one line, «{Магазин} · {Ім’я}».
 */

interface Fixture {
  owner_telegram_user_id: string;
  network_centre_cashier_telegram_user_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
// «Ліда»: the default seller's rights, at «Центр» alone.
const lida = fixture.network_centre_cashier_telegram_user_id;

function launch(
  telegramUserId: string,
  name: string,
  theme?: Record<string, string>,
): string {
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
  const hash = new URLSearchParams({ tgWebAppData: fields.toString() });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  return `/#${hash.toString()}`;
}

/** «Продати | Повернути» (navigation task list, P0-1). */
function saleOrReturn(page: Page): Locator {
  return page.getByRole("group", { name: "Продаж або повернення" });
}

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

const UNREACHABLE =
  "Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.";

function row(page: Page): Locator {
  return sections(page).locator(".row").getByRole("button");
}

function moreButton(page: Page): Locator {
  return sections(page).getByRole("button", { name: /^Ще( ⚠)?$/ });
}

/** Whatever «Ще» holds, while it is open. */
function underMore(page: Page): Locator {
  return sections(page).locator(".more").getByRole("button");
}

/**
 * The row's buttons stand on one line, none taller than a target, none past
 * the row's edge or the screen's, and none with its label cut short.
 */
async function oneLine(page: Page): Promise<void> {
  const boxes = await Promise.all(
    (await row(page).all()).map((button) => button.boundingBox()),
  );
  const tops = new Set(boxes.map((box) => Math.round(box?.y ?? -1)));
  expect(tops.size).toBe(1);
  const line = sections(page).locator(".row");
  const box = await line.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(48);
  const width = page.viewportSize()?.width ?? 0;
  for (const button of boxes)
    expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(
      (box?.x ?? 0) + (box?.width ?? 0) + 0.5,
    );
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  expect(
    await line.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(0);
  for (const button of await row(page).all())
    expect(
      await button.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
}

test("a seller's sections are the counter's four and «Ще» in one row at 360 px, under a one-line header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Центр · Ліда",
  );
  await expect(page.getByText("РОБОЧЕ МІСЦЕ ПРОДАВЦЯ")).toHaveCount(0);
  await expect(page.getByText("/ магазин")).toHaveCount(0);
  // One store: nothing to change to.
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toHaveCount(0);

  await expect(row(page)).toHaveText(["Продаж", "Клієнти", "Каса", "Ще"]);
  await expect(row(page).first()).toHaveAttribute("aria-current", "page");
  await oneLine(page);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // The rest is not shown until asked for.
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(underMore(page)).toHaveCount(0);

  // Two taps to any other section, by the same rights as before.
  await moreButton(page).click();
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(underMore(page)).toHaveText([
    "Каталог",
    "Приймання",
    "Залишки",
    "Брак",
  ]);
  await oneLine(page);
  await underMore(page).filter({ hasText: "Залишки" }).click();
  await expect(page.getByRole("heading", { name: "Залишки" })).toBeVisible();
  // Chosen, «Ще» closes, keeps the focus the chosen button had, and marks
  // that the section open is one of its own.
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(moreButton(page)).toBeFocused();
  await expect(moreButton(page)).toHaveClass(/active/);
  await expect(moreButton(page)).toHaveAttribute("aria-current", "true");
  await expect(row(page).first()).toHaveClass(/quiet/);
  await expect(row(page).first()).not.toHaveAttribute("aria-current");
  await moreButton(page).click();
  await expect(underMore(page).filter({ hasText: "Залишки" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Pressed again, it closes on the same section.
  await moreButton(page).click();
  await expect(underMore(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Залишки" })).toBeVisible();

  // One of the counter's, from the row: «Ще» is no longer marked.
  await moreButton(page).click();
  await row(page).filter({ hasText: "Каса" }).click();
  await expect(page.getByRole("heading", { name: "Каса" })).toBeVisible();
  await expect(moreButton(page)).toHaveClass(/quiet/);
  await expect(moreButton(page)).not.toHaveAttribute("aria-current");
  await expect(underMore(page)).toHaveCount(0);

  // Opened over the till and left by one of its own, «Ще» does not open
  // again when the till is back (review, 2026-10-16).
  await row(page).filter({ hasText: "Продаж" }).click();
  await moreButton(page).click();
  await underMore(page).filter({ hasText: "Залишки" }).click();
  await expect(page.getByRole("heading", { name: "Залишки" })).toBeVisible();
  await row(page).filter({ hasText: "Продаж" }).click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(underMore(page)).toHaveCount(0);
  // Nor when a section open under it is pressed again.
  await moreButton(page).click();
  await underMore(page).filter({ hasText: "Залишки" }).click();
  await moreButton(page).click();
  await underMore(page).filter({ hasText: "Залишки" }).click();
  await expect(underMore(page)).toHaveCount(0);
  await row(page).filter({ hasText: "Клієнти" }).click();
  await row(page).filter({ hasText: "Продаж" }).click();
  await moreButton(page).click();
  await row(page).filter({ hasText: "Продаж" }).click();
  await expect(underMore(page)).toHaveCount(0);
});

test("selling and taking back are one section's two ways: «Продати | Повернути» under the heading, a tap each, «Продаж» marked in the row on both (navigation task list, P0-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  const ways = saleOrReturn(page);
  const sell = ways.getByRole("button", { name: "Продати", exact: true });
  const back = ways.getByRole("button", { name: "Повернути", exact: true });
  await expect(sell).toHaveAttribute("aria-current", "page");
  await expect(back).not.toHaveAttribute("aria-current", "page");
  // One line at 360 px, under the heading.
  const left = await sell.boundingBox();
  const right = await back.boundingBox();
  expect(Math.round(left?.y ?? -1)).toBe(Math.round(right?.y ?? -2));
  expect(left?.height).toBeGreaterThanOrEqual(44);
  // A tap: the returns, «Продаж» still the row's mark.
  await back.click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await expect(back).toHaveAttribute("aria-current", "page");
  // The focus on the way now open, never lost to the page.
  await expect(back).toBeFocused();
  await expect(row(page).filter({ hasText: "Продаж" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(moreButton(page)).not.toHaveAttribute("aria-current", "true");
  // A tap back: the till.
  await sell.click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(sell).toHaveAttribute("aria-current", "page");
  await expect(sell).toBeFocused();
});

test("debts and orders are «Клієнти»'s two ways: opened on «Борги», «Борги | Замовлення» under each list's heading, the way open marked and focused, «Клієнти» marked on both; a debt a tap, the orders two, a new order three (navigation task list, P0-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await page.evaluate(() => {
    const host = window as unknown as { taps: number };
    host.taps = 0;
    document.addEventListener(
      "pointerdown",
      () => {
        host.taps += 1;
      },
      true,
    );
  });
  const taps = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { taps: number }).taps);
  const customers = row(page).filter({ hasText: "Клієнти" });
  await customers.click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  expect(await taps()).toBe(1);
  const ways = page.getByRole("group", { name: "Борги або замовлення" });
  const debts = ways.getByRole("button", { name: "Борги", exact: true });
  const orders = ways.getByRole("button", { name: "Замовлення", exact: true });
  await expect(debts).toHaveAttribute("aria-current", "page");
  await expect(customers).toHaveAttribute("aria-current", "page");
  await orders.click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  expect(await taps()).toBe(2);
  await expect(orders).toHaveAttribute("aria-current", "page");
  await expect(orders).toBeFocused();
  await expect(customers).toHaveAttribute("aria-current", "page");
  await expect(moreButton(page)).not.toHaveAttribute("aria-current", "true");
  // One line at 360 px.
  const left = await debts.boundingBox();
  const right = await orders.boundingBox();
  expect(Math.round(left?.y ?? -1)).toBe(Math.round(right?.y ?? -2));
  // A new order: «+» in the heading, the third tap.
  await page
    .locator(".orders-head")
    .getByRole("button", { name: "Нове замовлення" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toBeVisible();
  expect(await taps()).toBe(3);
  await expect(customers).toHaveAttribute("aria-current", "page");
  // «Клієнти» pressed again: its way's first screen, the orders.
  await customers.click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  // And back to the debts.
  await debts.click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  await expect(debts).toBeFocused();
});

test("whoever only takes returns has «Продаж» open them, with no switch (navigation task list, P0-1)", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (permission) => permission !== "sale:create",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await row(page).filter({ hasText: "Продаж" }).click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await expect(row(page).filter({ hasText: "Продаж" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(saleOrReturn(page)).toHaveCount(0);
});

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme «Продати | Повернути» reads at 4.5:1, nothing wider than the phone (navigation task list, P0-1)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(launch(lida, "Ліда", theme));
    await openStore(page, "Центр CENTRE");
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(name);
    const ways = saleOrReturn(page);
    await expect(ways).toBeVisible();
    for (const part of [
      ways.getByRole("button", { name: "Продати", exact: true }),
      ways.getByRole("button", { name: "Повернути", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // «Борги | Замовлення» the same (P0-2).
    await row(page).filter({ hasText: "Клієнти" }).click();
    const debtsOrOrders = page.getByRole("group", {
      name: "Борги або замовлення",
    });
    for (const part of [
      debtsOrOrders.getByRole("button", { name: "Борги", exact: true }),
      debtsOrOrders.getByRole("button", { name: "Замовлення", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/debts-or-orders-${name}.png`,
    });
    await row(page).filter({ hasText: "Продаж" }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/sale-or-return-${name}.png` });
  });

test("whoever does none of the counter's work but reads orders has «Клієнти» and «Ще», holding only what they may open", async ({
  page,
}) => {
  const counterRights = [
    "sale:create",
    "sale:refund",
    "sale:credit",
    "cash:close",
    "cash:expense",
    "report:view_financial",
  ];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (permission) => !counterRights.includes(permission),
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  // Orders read, nothing else of the counter's: «Клієнти» and «Ще»
  // (navigation task list, P0-2).
  await expect(row(page)).toHaveText(["Клієнти", "Ще"]);
  await expect(row(page).first()).toHaveAttribute("aria-current", "page");
  await more(page);
  await expect(underMore(page)).toHaveText([
    "Каталог",
    "Приймання",
    "Залишки",
    "Брак",
  ]);
});

test("whoever may not read orders has no «Замовлення» in «Ще», opens on the first section shown, and is never told of the rule (orders task list, P2-1); nor debts: no «Клієнти» (navigation task list, P0-2)", async ({
  page,
}) => {
  const taken = [
    "sale:view",
    "sale:create",
    "sale:refund",
    "sale:credit",
    "cash:close",
    "cash:expense",
    "report:view_financial",
  ];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (permission) => !taken.includes(permission),
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  // The first section shown, not «Замовлення».
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Немає права переглядати замовлення/),
  ).toHaveCount(0);
  await expect(row(page)).toHaveText([/^Ще( ⚠)?$/]);
  await more(page);
  await expect(underMore(page)).toHaveText([
    "Каталог",
    "Приймання",
    "Залишки",
    "Брак",
  ]);
});

test("whoever sells but may not read orders has «Клієнти» open the debts alone: no «Замовлення», no switch, no «+» — an order made is an order seen (owner decision after #139, 2026-10-26; navigation task list, P0-2)", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (permission) => permission !== "sale:view",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  // The till first, as for whoever sells.
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(row(page)).toHaveText([
    "Продаж",
    "Клієнти",
    "Каса",
    /^Ще( ⚠)?$/,
  ]);
  const customers = row(page).filter({ hasText: "Клієнти" });
  await customers.click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  await expect(customers).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("group", { name: "Борги або замовлення" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Замовлення/ })).toHaveCount(0);
  // Pressed again, the debts still.
  await customers.click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  await more(page);
  await expect(underMore(page).filter({ hasText: "Замовлення" })).toHaveCount(
    0,
  );
  await expect(underMore(page)).not.toHaveCount(0);
});

test("the owner's row is the same four and «Ще», on one line at 360 px; «Ще» holds the owner's sections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(fixture.owner_telegram_user_id, "Власник"));
  await openStore(page, "Основний MAIN");
  await expect(row(page)).toHaveText([
    "Продаж",
    "Клієнти",
    "Каса",
    /^Ще( ⚠)?$/,
  ]);
  await oneLine(page);
  await more(page);
  for (const name of ["Звіт", "Накладні", "Постачальникам", "Моделі"])
    await expect(
      underMore(page).filter({ hasText: new RegExp(`^${name}$`) }),
    ).toHaveCount(1);
  await expect(
    underMore(page).filter({ hasText: /^Резервні копії/ }),
  ).toHaveCount(1);
});

/** The till's warehouses, read while the server does not answer. */
function failed(page: Page): Locator {
  return page.getByRole("alert").filter({ hasText: UNREACHABLE });
}

function reminder(page: Page): Locator {
  return page.getByRole("region", { name: "Сервер знову відповідає" });
}

/**
 * Ліда at «Центр»'s till; then the server answers nothing while `down`
 * says so, and the till, opened again, cannot read its warehouses: the
 * phone has seen it lost. Any answer of the server's own is its return.
 */
async function tillAfterOutage(page: Page): Promise<{ down: boolean }> {
  const server = { down: false };
  await page.route("**/api/v1/**", async (route) => {
    if (server.down) await route.fulfill({ status: 503, body: "" });
    else await route.fallback();
  });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(till(page)).toBeVisible();
  // Nothing lost yet: nothing to remind of.
  await expect(reminder(page)).toHaveCount(0);
  // Nothing in flight: an answer sent before the outage would be its end.
  await page.waitForLoadState("networkidle");
  server.down = true;
  await tillAgain(page);
  await expect(failed(page).first()).toBeVisible();
  // Not back yet: still nothing.
  await expect(reminder(page)).toHaveCount(0);
  return server;
}

/** The till, its warehouses read: a choice of one, or the search. */
function till(page: Page): Locator {
  return page
    .getByRole("combobox", { name: "Склад", exact: true })
    .or(page.getByRole("searchbox", { name: "Знайти модель" }))
    .first();
}

/**
 * The server answers again: whatever the till could not read is read once
 * more — the warehouses, the goods with them, and the sellers in paper mode.
 */
async function answered(page: Page, server: { down: boolean }): Promise<void> {
  server.down = false;
  await expect(async () => {
    if ((await failed(page).count()) > 0)
      await failed(page)
        .first()
        .getByRole("button", { name: "Спробувати ще раз" })
        .click({ timeout: 1000 });
    await expect(failed(page)).toHaveCount(0, { timeout: 1000 });
  }).toPass();
}

/** Another section, and the till again: it reads its warehouses anew. */
async function tillAgain(page: Page): Promise<void> {
  await sections(page).getByRole("button", { name: "Клієнти" }).click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  await sections(page).getByRole("button", { name: "Продаж" }).click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
}

test("a phone that saw the server come back says once, at the till, to type the paper, and its button ticks the switch", async ({
  page,
}) => {
  const server = await tillAfterOutage(page);
  await answered(page, server);
  await expect(reminder(page)).toHaveText(
    /^Сервер знову відповідає: продажі з паперу можна вносити\. Внесіть їх до закриття каси\./,
  );
  const paper = page.getByLabel("Вношу продаж з паперу");
  await expect(paper).not.toBeChecked();
  await reminder(page)
    .getByRole("button", { name: "Вношу продаж з паперу" })
    .click();
  // The same as the tick: the mode is on, and the reminder is answered.
  await expect(paper).toBeChecked();
  // The paper of an outage the phone saw, said so (owner, 2026-10-16).
  await expect(
    page.getByRole("radio", { name: "Сервер не відповідав" }),
  ).toBeChecked();
  await expect(page.getByText("Режим: продаж з паперу")).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  // The paper typed, the switch is unticked: the reminder does not return.
  await paper.uncheck();
  await expect(page.getByText("Режим: продаж з паперу")).toHaveCount(0);
  await expect(reminder(page)).toHaveCount(0);
  await tillAgain(page);
  await expect(reminder(page)).toHaveCount(0);
});

test("«Пізніше» puts the reminder away until the server is lost and back again; the tick answers it too", async ({
  page,
}) => {
  const server = await tillAfterOutage(page);
  await answered(page, server);
  await expect(reminder(page)).toBeVisible();
  // Lost again before it is answered: nothing said while it does not answer.
  // Nothing in flight: an answer sent before the outage would be its end.
  await page.waitForLoadState("networkidle");
  server.down = true;
  await tillAgain(page);
  await expect(failed(page).first()).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await answered(page, server);
  await expect(reminder(page)).toBeVisible();
  await reminder(page).getByRole("button", { name: "Пізніше" }).click();
  await expect(reminder(page)).toHaveCount(0);
  // Left and opened again, the till still says nothing.
  await tillAgain(page);
  await expect(till(page)).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);

  // Lost again: nothing said while it does not answer.
  // Nothing in flight: an answer sent before the outage would be its end.
  await page.waitForLoadState("networkidle");
  server.down = true;
  await tillAgain(page);
  await expect(failed(page).first()).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  // Back again: said again.
  await answered(page, server);
  await expect(reminder(page)).toBeVisible();
  // Ticked by hand, it is answered as by its button.
  await page.getByLabel("Вношу продаж з паперу").check();
  await page.getByLabel("Вношу продаж з паперу").uncheck();
  await expect(reminder(page)).toHaveCount(0);
});

test("the reminder's button waits while a sale is being sent, as the tick does", async ({
  page,
}) => {
  const server = await tillAfterOutage(page);
  const variant = randomUUID();
  const size = randomUUID();
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    if (server.down) await route.fulfill({ status: 503, body: "" });
    else
      await route.fulfill({
        json: {
          items: [
            {
              product_variant_id: variant,
              size_id: size,
              display_name: "Лоран шоколад",
              size_label: "M",
              size_is_unknown: false,
              quantity: 2,
              reserved_quantity: 0,
              available_quantity: 2,
              suggested_price: "1850.00",
            },
          ],
          has_more: false,
        },
      });
  });
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/sales", async (route) => {
    await held;
    await route.fulfill({ status: 503, body: "" });
  });
  await answered(page, server);
  const paper = reminder(page).getByRole("button", {
    name: "Вношу продаж з паперу",
  });
  await expect(paper).toBeEnabled();
  await tapSize(page, variant, size);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  // The paper mode is never turned on under a sale on its way.
  await expect(page.getByLabel("Вношу продаж з паперу")).toBeDisabled();
  await expect(paper).toBeDisabled();
  release();
  // No answer: the sale is kept, and the server lost again.
  await expect(page.getByText("Продаж ще не підтверджено")).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
});

test("a server back while the paper is being typed is the reminder answered, and the switch unticked says nothing", async ({
  page,
}) => {
  const server = await tillAfterOutage(page);
  const paper = page.getByLabel("Вношу продаж з паперу");
  await paper.check();
  await expect(page.getByText("Режим: продаж з паперу")).toBeVisible();
  await answered(page, server);
  await expect(till(page)).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await paper.uncheck();
  await expect(page.getByText("Режим: продаж з паперу")).toHaveCount(0);
  await expect(reminder(page)).toHaveCount(0);
});

test("a phone that never lost the server is never reminded", async ({
  page,
}) => {
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(till(page)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(reminder(page)).toHaveCount(0);
});
