import {
  test,
  expect,
  menu,
  more,
  openStore,
  section,
  storeLine,
  tapSize,
  tillWays,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The sections and the header in the new design (sale-slice TZ, P1-6), and
 * the till's reminder once the server is back (P1-7; owner decisions,
 * 2026-10-15: the reminder is the till's alone, В7 (б)).
 *
 * The menu at the bottom («Усе на бірці» task list, P0-4) — «Продаж»,
 * «Замовлення», «Каса» for whoever reads no report, and «Ще», each for
 * whoever may open it; «Повернення» and «Внесок» are «Продаж»'s other ways
 * (navigation task list, P0-1; «Усе на бірці» task list, P0-3) — and every
 * other place under «Ще», by the design's groups and the same rights as
 * before. Each screen's own title heads the page, the line «{Магазин} ·
 * {Ім’я}» under it with «Змінити магазин» at its right for whoever has two
 * stores (P0-4, part 2).
 */

interface Fixture {
  owner_telegram_user_id: string;
  network_centre_manager_telegram_user_id: string;
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
  return tillWays(page);
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

/** The bottom menu's tabs («Усе на бірці» task list, P0-4). */
function tabs(page: Page): Locator {
  return menu(page).getByRole("button");
}

function moreButton(page: Page): Locator {
  return menu(page).getByRole("button", { name: /^Ще( ⚠)?$/ });
}

/** What «Ще» holds, by its rows' labels, while its screen is open
 * (navigation task list, P0-4). */
function underMore(page: Page): Locator {
  return page.getByRole("navigation", { name: "Ще" }).locator(".more-label");
}

/** «Ще»'s rows themselves. */
function moreRows(page: Page): Locator {
  return page.getByRole("navigation", { name: "Ще" }).getByRole("button");
}

/** A row of «Ще» by its label. */
function moreRow(page: Page, name: string | RegExp): Locator {
  return page
    .getByRole("navigation", { name: "Ще" })
    .getByRole(
      "button",
      typeof name === "string" ? { name, exact: true } : { name },
    );
}

/** «Ще»'s groups, by their labels. */
function groups(page: Page): Locator {
  return page.locator(".more-group h3");
}

/** «← Ще» over a section opened from «Ще». */
function toMore(page: Page): Locator {
  return page.getByRole("button", { name: "Назад до «Ще»" });
}

/** A colour token as the page draws it. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${variable})`;
    document.body.append(probe);
    const drawn = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return drawn;
  }, name);
}

/**
 * The menu stands at the bottom of the screen, its tabs on one line, each
 * 64 px tall or more, none past the screen's edge, and none with its word
 * cut short.
 */
async function atTheBottom(page: Page): Promise<void> {
  const bar = await menu(page).boundingBox();
  const viewport = page.viewportSize();
  expect(Math.round((bar?.y ?? 0) + (bar?.height ?? 0))).toBe(
    viewport?.height,
  );
  const boxes = await Promise.all(
    (await tabs(page).all()).map((tab) => tab.boundingBox()),
  );
  const tops = new Set(boxes.map((box) => Math.round(box?.y ?? -1)));
  expect(tops.size).toBe(1);
  for (const box of boxes) {
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(64);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (viewport?.width ?? 0) + 0.5,
    );
  }
  for (const word of await menu(page).locator(".tab-label").all())
    expect(
      await word.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

/** Every tap counted from now: `taps()` reads them, `untapped()` starts
 * again. */
async function counting(page: Page): Promise<{
  taps: () => Promise<number>;
  untapped: () => Promise<void>;
}> {
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
  return {
    taps: () =>
      page.evaluate(() => (window as unknown as { taps: number }).taps),
    untapped: () =>
      page.evaluate(() => {
        (window as unknown as { taps: number }).taps = 0;
      }),
  };
}

test("a seller's menu is «Продаж · Замовлення · Каса · Ще» at the bottom at 360 px, a glyph over each word, the open one on its pill, under a one-line header («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Продаж");
  await expect(storeLine(page)).toHaveText("Центр · Ліда");
  await expect(page.getByText("РОБОЧЕ МІСЦЕ ПРОДАВЦЯ")).toHaveCount(0);
  await expect(tabs(page)).toHaveText(["Продаж", "Замовлення", "Каса", "Ще"]);
  await expect(tabs(page).first()).toHaveAttribute("aria-current", "page");
  await expect(menu(page).locator(".tab-pill svg")).toHaveCount(4);
  // The open tab's glyph on the primary pill; the others on nothing.
  const pills = menu(page).locator(".tab-pill");
  expect(
    await pills.first().evaluate((pill) => getComputedStyle(pill).backgroundColor),
  ).toBe(await token(page, "--primary"));
  expect(
    await pills.nth(1).evaluate((pill) => getComputedStyle(pill).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  const pill = await pills.first().boundingBox();
  expect(Math.round(pill?.width ?? 0)).toBe(56);
  expect(Math.round(pill?.height ?? 0)).toBe(30);
  await atTheBottom(page);
  // The rest is on «Ще»'s own screen (navigation task list, P0-4).
  await expect(underMore(page)).toHaveCount(0);

  // Two taps to any other place, by the same rights as before.
  await moreButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Ще", exact: true }),
  ).toBeVisible();
  await expect(moreButton(page)).toHaveAttribute("aria-current", "page");
  await expect(tabs(page).first()).not.toHaveAttribute("aria-current");
  // A seller's groups: people, goods, this phone.
  await expect(groups(page)).toHaveText(["Люди", "Товар", "Цей телефон"]);
  await expect(underMore(page)).toHaveText([
    "Борги",
    "Прийшов товар",
    /^Брак( |$)/,
    "Залишки",
    "Перевірка каталогу",
    "Вношу продаж з паперу",
  ]);
  // One store: nothing to change to, here or on the line.
  await expect(
    page.getByRole("button", { name: "Змінити магазин" }),
  ).toHaveCount(0);
  await underMore(page).filter({ hasText: "Перевірка каталогу" }).click();
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  // The focus stays on «Ще», never lost to the page.
  await expect(moreButton(page)).toBeFocused();
  // «Ще» marks the place open from it, not as its own page; «← Ще» over its
  // heading leads back
  // to the groups, and so does «Ще» pressed again.
  await expect(moreButton(page)).toHaveAttribute("aria-current", "true");
  await toMore(page).click();
  await expect(
    page.getByRole("heading", { name: "Ще", exact: true }),
  ).toBeVisible();
  await expect(moreButton(page)).toBeFocused();
  await underMore(page).filter({ hasText: "Перевірка каталогу" }).click();
  await moreButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Ще", exact: true }),
  ).toBeVisible();

  // A tab: «Ще» is no longer marked, and «Каса» a tab has no «← Ще».
  await tabs(page).filter({ hasText: "Каса" }).click();
  await expect(page.getByRole("heading", { name: "Каса" })).toBeVisible();
  await expect(moreButton(page)).not.toHaveAttribute("aria-current");
  await expect(underMore(page)).toHaveCount(0);
  await expect(toMore(page)).toHaveCount(0);
});

test("selling and taking back are one section's two ways: «Продати | Повернути» under the heading, a tap each, «Продаж» marked in the menu on both (navigation task list, P0-1)", async ({
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
  // A tap: the returns, «Продаж» still the menu's mark.
  await back.click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await expect(back).toHaveAttribute("aria-current", "page");
  // The focus on the way now open, never lost to the page.
  await expect(back).toBeFocused();
  await expect(tabs(page).filter({ hasText: "Продаж" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(moreButton(page)).not.toHaveAttribute("aria-current");
  // A tap back: the till.
  await sell.click();
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(sell).toHaveAttribute("aria-current", "page");
  await expect(sell).toBeFocused();
});

test("«Замовлення» is a tab of its own and «Борги» a row of «Ще» › «Люди»: the orders a tap, a new order two, the debts two with «← Ще» back; no «Борги | Замовлення» («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  const { taps, untapped } = await counting(page);
  const orders = tabs(page).filter({ hasText: "Замовлення" });
  await orders.click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  expect(await taps()).toBe(1);
  await expect(orders).toHaveAttribute("aria-current", "page");
  await expect(orders).toBeFocused();
  await expect(
    page.getByRole("group", { name: "Борги або замовлення" }),
  ).toHaveCount(0);
  // A new order: «+» in the heading, the second tap, «Замовлення» marked.
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Нове замовлення" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Нове замовлення" }),
  ).toBeVisible();
  expect(await taps()).toBe(2);
  await expect(orders).toHaveAttribute("aria-current", "page");
  // Pressed again: its first screen.
  await orders.click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  // The debts: «Ще», «Борги» — «Ще» marked, «← Ще» back.
  await untapped();
  await moreButton(page).click();
  await moreRow(page, "Борги").click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  expect(await taps()).toBe(2);
  await expect(moreButton(page)).toHaveAttribute("aria-current", "true");
  await expect(orders).not.toHaveAttribute("aria-current");
  await expect(
    page.getByRole("group", { name: "Борги або замовлення" }),
  ).toHaveCount(0);
  await toMore(page).click();
  await expect(
    page.getByRole("heading", { name: "Ще", exact: true }),
  ).toBeVisible();
});

test("the goods are rows of «Ще» › «Товар»: «Прийшов товар», «Брак» and «Залишки», two taps each from the till, «← Ще» back from each; no «Товар» left anywhere («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  const { taps, untapped } = await counting(page);
  for (const [row, heading] of [
    ["Прийшов товар", "Приймання товару"],
    [/^Брак( |$)/, "Брак"],
    ["Залишки", "Залишки"],
  ] as const) {
    await tabs(page).filter({ hasText: "Продаж" }).click();
    await untapped();
    await moreButton(page).click();
    await moreRow(page, row).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(await taps()).toBe(2);
    await expect(moreButton(page)).toHaveAttribute("aria-current", "true");
    // «← Ще» read as where it goes.
    await toMore(page).click();
    await expect(
      page.getByRole("heading", { name: "Ще", exact: true }),
    ).toBeVisible();
  }
  // The stock's own screen is «Залишки», its list as before.
  await moreRow(page, "Залишки").click();
  await expect(
    page.getByRole("button", { name: "Оновити залишки" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Товар", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Товар", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".goods-tiles")).toHaveCount(0);
});

test("«Брак»'s row says how many units wait to be inspected, as its screen counts them; nothing waiting, «нічого не чекає»; grey while read, and unread, no line and nothing said («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  // What the server answers; held, the read waits and then fails.
  const answer: { units: object[]; held: boolean; failed: boolean } = {
    units: [
      { status: "AWAITING" },
      { status: "AWAITING" },
      { status: "INSPECTING" },
      { status: "CONFIRMED" },
    ],
    held: false,
    failed: false,
  };
  let release: () => void = () => undefined;
  await page.route("**/api/v1/damaged-units?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    if (answer.failed) {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    if (!answer.held) {
      await route.fulfill({ json: { units: answer.units } });
      return;
    }
    await new Promise<void>((done) => {
      release = done;
    });
    await route.fulfill({
      status: 500,
      json: { code: "INTERNAL_ERROR", message: "Internal error" },
    });
  });
  const damaged = moreRow(page, /^Брак( |$)/);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await more(page);
  // Two waiting; one on inspection and one confirmed are not.
  await expect(damaged.locator(".more-label")).toHaveText(
    "Брак 2 очікують перевірки",
  );
  // Nothing waiting.
  answer.units = [];
  // Read anew: the same address is not a new page.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await more(page);
  await expect(damaged.locator(".more-meta")).toHaveText("нічого не чекає");
  // One: «очікує».
  answer.units = [{ status: "AWAITING" }];
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await more(page);
  await expect(damaged.locator(".more-meta")).toHaveText("1 очікує перевірки");
  // Read again as «Ще» opens again, and refused: no line, though one was
  // read before — as the screen says no count (review, 2026-10-26).
  answer.failed = true;
  await tabs(page).filter({ hasText: "Продаж" }).click();
  await more(page);
  await expect(damaged.locator(".more-label")).toHaveText(/^Брак\s*$/);
  await expect(damaged.locator(".more-meta")).toHaveCount(0);
  answer.failed = false;
  // Grey while read; unread, the row alone, no alarm.
  answer.held = true;
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await more(page);
  await expect(damaged.locator(".skeleton")).toBeVisible();
  release();
  await expect(damaged.locator(".skeleton")).toHaveCount(0);
  await expect(damaged.locator(".more-meta")).toHaveCount(0);
  await expect(damaged.locator(".more-label")).toHaveText(/^Брак\s*$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

/** This person's rights in every store, less `without`. */
async function holdingNone(page: Page, without: string[]): Promise<void> {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (permission) => !without.includes(permission),
      );
    await route.fulfill({ response, json: body });
  });
}

test("whoever only takes returns has «Продаж» open them, with no switch (navigation task list, P0-1)", async ({
  page,
}) => {
  await holdingNone(page, ["sale:create", "sale:credit"]);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await tabs(page).filter({ hasText: "Продаж" }).click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  await expect(tabs(page).filter({ hasText: "Продаж" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(saleOrReturn(page)).toHaveCount(0);
});

test("whoever takes returns and payments but does not sell has «Повернути · Внесок» under «Продаж» («Усе на бірці» task list, P0-3)", async ({
  page,
}) => {
  await holdingNone(page, ["sale:create"]);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await tabs(page).filter({ hasText: "Продаж" }).click();
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  const ways = page.getByRole("group", { name: "Повернення або внесок" });
  await expect(ways.getByRole("button")).toHaveText(["Повернути", "Внесок"]);
  await ways.getByRole("button", { name: "Внесок", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Ім’я або телефон")).toBeVisible();
});

test("whoever only takes payments has «Продаж» open «Внесок», with no switch («Усе на бірці» task list, P0-3)", async ({
  page,
}) => {
  await holdingNone(page, ["sale:create", "sale:refund"]);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await tabs(page).filter({ hasText: "Продаж" }).click();
  await expect(
    page.getByRole("heading", { name: "Продаж", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Ім’я або телефон")).toBeVisible();
  await expect(tabs(page).filter({ hasText: "Продаж" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(saleOrReturn(page)).toHaveCount(0);
});

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme «Продати | Повернути», the menu and «Ще» read at 4.5:1, the open tab's glyph at 3:1, nothing wider than the phone («Усе на бірці» task list, P0-4)`, async ({
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
    // The menu: every word, and the open tab's glyph on its pill.
    for (const word of await menu(page).locator(".tab-label").all())
      expect(await contrast(word)).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrast(
        menu(page).locator('.tab[aria-current="page"] .tab-pill svg'),
      ),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/menu-${name}.png` });
    // «Ще»'s screen the same: its heading, groups, rows and the line under
    // «Брак».
    await more(page);
    await expect(moreRow(page, /^Брак( |$)/).locator(".more-meta")).toBeVisible();
    for (const part of [
      groups(page).first(),
      underMore(page).first(),
      moreRow(page, /^Брак( |$)/).locator(".more-meta"),
      page.getByRole("heading", { name: "Ще", exact: true }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/more-${name}.png` });
  });

test("whoever neither sells nor takes money but reads orders opens on them: «Замовлення» and «Ще», holding only what they may open («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await holdingNone(page, [
    "sale:create",
    "sale:refund",
    "sale:credit",
    "cash:close",
    "cash:expense",
    "report:view_financial",
  ]);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await expect(tabs(page)).toHaveText(["Замовлення", /^Ще( ⚠)?$/]);
  await expect(tabs(page).first()).toHaveAttribute("aria-current", "page");
  await more(page);
  // No debts, no paper switch: neither right is held.
  await expect(groups(page)).toHaveText(["Товар"]);
  await expect(underMore(page)).toHaveText([
    "Прийшов товар",
    /^Брак( |$)/,
    "Залишки",
    "Перевірка каталогу",
  ]);
});

test("whoever may not read orders nor sell has only «Ще», opens on it, and is never told of the rule (orders task list, P2-1; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await holdingNone(page, [
    "sale:view",
    "sale:create",
    "sale:refund",
    "sale:credit",
    "cash:close",
    "cash:expense",
    "report:view_financial",
  ]);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByRole("heading", { name: "Ще", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Немає права переглядати замовлення/),
  ).toHaveCount(0);
  await expect(tabs(page)).toHaveText([/^Ще( ⚠)?$/]);
  await expect(tabs(page).first()).toHaveAttribute("aria-current", "page");
  await expect(underMore(page)).toHaveText([
    "Прийшов товар",
    /^Брак( |$)/,
    "Залишки",
    "Перевірка каталогу",
  ]);
});

test("whoever sells but may not read orders has no «Замовлення» anywhere: «Продаж · Каса · Ще», the debts in «Ще» alone, no «+» — an order made is an order seen (owner decision after #139, 2026-10-26; «Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await holdingNone(page, ["sale:view"]);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  // The till first, as for whoever sells.
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(tabs(page)).toHaveText(["Продаж", "Каса", /^Ще( ⚠)?$/]);
  await more(page);
  await expect(moreRow(page, "Замовлення")).toHaveCount(0);
  await moreRow(page, "Борги").click();
  await expect(page.getByRole("heading", { name: "Борги" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Борги або замовлення" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Замовлення/ })).toHaveCount(0);
});

test("whoever holds no right of the drawer has no «Каса»: no tab, no row, no «Гроші» for it alone («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await holdingNone(page, ["cash:close", "cash:expense", "report:view_financial"]);
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await expect(tabs(page)).toHaveText(["Продаж", "Замовлення", /^Ще( ⚠)?$/]);
  await more(page);
  await expect(moreRow(page, "Каса")).toHaveCount(0);
  expect(await groups(page).allTextContents()).not.toContain("Гроші");
});

test("the owner's menu is «Продаж · Замовлення · Ще» at 360 px; «Ще» holds five groups in the design's order, «Каса» among the money, «← Ще» back from each («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(fixture.owner_telegram_user_id, "Власник"));
  await openStore(page, "Основний MAIN");
  await expect(tabs(page)).toHaveText([
    "Продаж",
    "Замовлення",
    /^Ще( ⚠)?$/,
  ]);
  await atTheBottom(page);
  await more(page);
  await expect(groups(page)).toHaveText([
    "Люди",
    "Товар",
    "Гроші",
    "Мережа",
    "Цей телефон",
  ]);
  await expect(underMore(page)).toHaveText([
    "Борги",
    "Прийшов товар",
    /^Брак( |$)/,
    "Залишки",
    "Товар і каталог перевірка, моделі, початкові залишки",
    "Каса",
    "Звіт про продажі",
    "Накладні",
    "Постачальникам",
    "Магазини",
    /^Резервні копії( ⚠)?$/,
    "Змінити магазин",
    "Вношу продаж з паперу",
  ]);
  // 52 px or more each, its label whole; scrolled, never wider than the
  // phone.
  const list = await page.getByRole("navigation", { name: "Ще" }).boundingBox();
  for (const button of await moreRows(page).all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(52);
    // The whole width, its chevron at the edge (review of the screens).
    expect(Math.round(box?.width ?? -1)).toBe(Math.round(list?.width ?? -2));
    expect(
      await button.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: "test-results/more-owner.png",
    fullPage: true,
  });
  // From each row's screen, «← Ще» back to the groups.
  for (const [row, heading] of [
    ["Борги", "Борги"],
    ["Прийшов товар", "Приймання товару"],
    [/^Брак( |$)/, "Брак"],
    ["Залишки", "Залишки"],
    ["Каса", "Каса"],
    ["Звіт про продажі", "Звіт про продажі"],
    ["Накладні", "Накладні"],
    ["Постачальникам", "Постачальникам"],
    ["Магазини", "Магазини"],
    [/^Резервні копії( ⚠)?$/, "Резервні копії"],
  ] as const) {
    await moreRow(page, row).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await toMore(page).click();
    await expect(
      page.getByRole("heading", { name: "Ще", exact: true }),
    ).toBeVisible();
  }
  // «Товар і каталог»: a list of its own, «← Ще» over it; each of its
  // screens leads back to «Ще».
  const catalogue = page
    .getByRole("navigation", { name: "Товар і каталог" })
    .getByRole("button");
  for (const name of ["Перевірка каталогу", "Моделі", "Початкові залишки"]) {
    await moreRow(page, /^Товар і каталог/).click();
    await expect(
      page.getByRole("heading", { name: "Товар і каталог", exact: true }),
    ).toBeVisible();
    await expect(catalogue).toHaveText([
      /^Перевірка каталогу/,
      /^Моделі/,
      /^Початкові залишки/,
    ]);
    await expect(toMore(page)).toBeVisible();
    await catalogue.filter({ hasText: name }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await toMore(page).click();
    await expect(
      page.getByRole("heading", { name: "Ще", exact: true }),
    ).toBeVisible();
  }
});

test("a manager's «Ще» is people, goods, money and this phone, with no network («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(
    launch(fixture.network_centre_manager_telegram_user_id, "Марта"),
  );
  await openStore(page, "Центр CENTRE");
  await expect(tabs(page)).toHaveText([
    "Продаж",
    "Замовлення",
    /^Ще( ⚠)?$/,
  ]);
  await more(page);
  await expect(groups(page)).toHaveText([
    "Люди",
    "Товар",
    "Гроші",
    "Цей телефон",
  ]);
  await expect(moreRow(page, "Магазини")).toHaveCount(0);
  await expect(moreRow(page, /^Резервні копії/)).toHaveCount(0);
  await expect(moreRow(page, "Каса")).toBeVisible();
});

test("whoever may not pay suppliers' invoices has no «Накладні» («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await holdingNone(page, ["supplier:debt"]);
  await page.goto(launch(fixture.owner_telegram_user_id, "Власник"));
  await openStore(page, "Основний MAIN");
  await more(page);
  await expect(moreRow(page, "Накладні")).toHaveCount(0);
  await expect(moreRow(page, "Звіт про продажі")).toBeVisible();
});

test("«Змінити магазин» is one tap from the line over any screen of a store, for whoever has two, and in «Ще» › «Цей телефон» («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.goto(launch(fixture.owner_telegram_user_id, "Власник"));
  const line = page
    .locator(".store-line")
    .getByRole("button", { name: "Змінити магазин" });
  const choice = page.getByRole("heading", { name: "Оберіть магазин" });
  // From the till.
  await openStore(page, "Основний MAIN");
  // On the line under the screen's title, at its right (spec §6.2).
  const words = await storeLine(page).boundingBox();
  const button = await line.boundingBox();
  expect(button?.x ?? 0).toBeGreaterThanOrEqual(
    (words?.x ?? 0) + (words?.width ?? 0),
  );
  const middle = (box: typeof words): number =>
    (box?.y ?? 0) + (box?.height ?? 0) / 2;
  expect(Math.abs(middle(button) - middle(words))).toBeLessThanOrEqual(2);
  const { taps } = await counting(page);
  await line.click();
  await expect(choice).toBeVisible();
  expect(await taps()).toBe(1);
  // From a screen under «Ще».
  await openStore(page, "Основний MAIN");
  await section(page, "Залишки");
  await line.click();
  await expect(choice).toBeVisible();
  // From «Ще» › «Цей телефон».
  await openStore(page, "Основний MAIN");
  await more(page);
  await moreRow(page, "Змінити магазин").click();
  await expect(choice).toBeVisible();
});

test("«Вношу продаж з паперу» in «Ще» › «Цей телефон» is the till's own switch: on there, ticked at the till; off at the till, off there («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  await more(page);
  const paper = page.getByRole("switch", { name: "Вношу продаж з паперу" });
  await expect(paper).toHaveAttribute("aria-checked", "false");
  await paper.click();
  await expect(paper).toHaveAttribute("aria-checked", "true");
  await tabs(page).filter({ hasText: "Продаж" }).click();
  const tick = page.getByRole("checkbox", { name: "Вношу продаж з паперу" });
  await expect(tick).toBeChecked();
  await tick.uncheck();
  await more(page);
  await expect(paper).toHaveAttribute("aria-checked", "false");
});

for (const [width, height] of [
  [360, 640],
  [390, 844],
] as const)
  test(`at ${String(width)} × ${String(height)} the till's dock stands over the menu with a coat in the basket: the menu in view, none of the dock's buttons under it («Усе на бірці» task list, P0-4; В6 (а))`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const variant = randomUUID();
    const size = randomUUID();
    await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
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
    await page.goto(launch(lida, "Ліда"));
    await openStore(page, "Центр CENTRE");
    await tapSize(page, variant, size);
    const dock = page.locator(".pay-panel");
    await expect(dock).toBeVisible();
    await expect(menu(page)).toBeVisible();
    const bar = await menu(page).boundingBox();
    const docked = await dock.boundingBox();
    expect((docked?.y ?? 0) + (docked?.height ?? 0)).toBeLessThanOrEqual(
      (bar?.y ?? 0) + 0.5,
    );
    for (const button of await dock.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
        (bar?.y ?? 0) + 0.5,
      );
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    }
    await page.screenshot({
      path: `test-results/dock-over-menu-${String(width)}.png`,
    });
  });

test("the menu steps aside while the phone's keyboard is up, and only then: a cursor in the till's search with no keyboard keeps it («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  const search = page.getByRole("searchbox", { name: "Знайти модель" });
  await search.click();
  await expect(search).toBeFocused();
  await expect(menu(page)).toBeVisible();
  // The keyboard comes up: what is seen of the screen is shorter.
  await page.evaluate(() => {
    const view = window.visualViewport;
    if (!view) return;
    Object.defineProperty(view, "height", {
      configurable: true,
      get: () => 300,
    });
    view.dispatchEvent(new Event("resize"));
  });
  await expect(menu(page)).toHaveCount(0);
  // The field let go: the menu is back, however short the screen.
  await page.getByRole("heading", { name: "Продаж" }).click();
  await expect(search).not.toBeFocused();
  await expect(menu(page)).toBeVisible();
});

test("on a computer's wide window the screen is 560 px at most, the menu's tabs with it («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  const main = await page.locator("main").boundingBox();
  expect(main?.width ?? 0).toBeLessThanOrEqual(560);
  const row = await menu(page).locator(".tab-row").boundingBox();
  expect(row?.width ?? 0).toBeLessThanOrEqual(560);
  // Centred, as the screen is.
  expect(Math.abs((row?.x ?? 0) - (main?.x ?? 0))).toBeLessThanOrEqual(1);
});

test("every screen of a store is headed by its own title, the store and who works in it on the line under it: a tab's first screen at 34, one opened from another at 28 under its «←», each over its card («Усе на бірці» task list, P0-4, part 2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(lida, "Ліда"));
  await openStore(page, "Центр CENTRE");
  const title = page.getByRole("heading", { level: 1 });
  const headed = async (name: string, size: string): Promise<void> => {
    // The page's one heading is the screen's own title.
    await expect(title).toHaveCount(1);
    await expect(title).toHaveText(name);
    await expect(title).toHaveCSS("font-size", size);
    await expect(storeLine(page)).toHaveText("Центр · Ліда");
    // The line under the title, the screen's card under both.
    const head = await title.boundingBox();
    const line = await storeLine(page).boundingBox();
    const card = await page.locator("main > section").first().boundingBox();
    expect(line?.y ?? 0).toBeGreaterThanOrEqual(
      (head?.y ?? 0) + (head?.height ?? 0) - 1,
    );
    expect(card?.y ?? 0).toBeGreaterThan((line?.y ?? 0) + (line?.height ?? 0));
  };
  await headed("Продаж", "34px");
  await tabs(page).filter({ hasText: "Замовлення" }).click();
  await headed("Замовлення", "34px");
  await tabs(page).filter({ hasText: "Каса" }).click();
  await headed("Каса", "34px");
  await more(page);
  await headed("Ще", "34px");
  await moreRow(page, "Залишки").click();
  await headed("Залишки", "28px");
  // Its «←» over it.
  const back = await page
    .getByRole("button", { name: "Назад до «Ще»" })
    .boundingBox();
  const head = await title.boundingBox();
  expect((back?.y ?? 0) + (back?.height ?? 0)).toBeLessThanOrEqual(
    (head?.y ?? 0) + 1,
  );
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
  await menu(page).getByRole("button", { name: "Замовлення" }).click();
  await expect(
    page.getByRole("heading", { name: "Замовлення", exact: true }),
  ).toBeVisible();
  await menu(page).getByRole("button", { name: "Продаж" }).click();
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
