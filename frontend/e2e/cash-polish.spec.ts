import {
  test,
  expect,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Каса»'s last touches (cash task list, P2-1..P2-3): its own words for a
 * refusal it does not name, never an order's; grey places while it is read, the card where it will stand;
 * a server that does not answer, a warning's plate. Stubbed where the
 * answer must be one the server gives only now and then.
 */

interface Fixture {
  network_cash_seller_telegram_user_id: string;
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
const olya = fixture.network_cash_seller_telegram_user_id;
const owner = fixture.network_owner_telegram_user_id;

function initData(who: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${who},"first_name":"Оля"}`,
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

function launch(who = olya, theme?: Record<string, string>): string {
  const hash = new URLSearchParams({ tgWebAppData: initData(who) });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  return `/#${hash.toString()}`;
}

const lastClose = {
  id: "7b1c2d3e-0000-4000-8000-00000000c101",
  number: 3,
  business_day: "2026-10-20",
  closed_at: "2026-10-20T17:14:00Z",
  closed_by: "Олена",
  mine: false,
};

function drawer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    store_id: store,
    store_name: "Каса",
    store_state: "ACTIVE",
    last_close: lastClose,
    next_is_opening: false,
    closed_today: false,
    may_close: true,
    movement_kinds: ["EXPENSES", "SUPPLIER_COURIER"],
    may_correct: false,
    movements: [],
    unclosed_days: [],
    reason_owed: null,
    ...over,
  };
}

const sale = {
  target: "SALE",
  target_id: randomUUID(),
  amount_taken: "700.00",
  method: "CARD",
  corrected: false,
  may_change: true,
  is_order: false,
};

/** A request held until released, then answered by the routes under it. */
async function hold(
  page: Page,
  pattern: string,
): Promise<{ release: () => void; arrived: () => boolean }> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = false;
  await page.route(pattern, async (route: Route) => {
    arrived = true;
    await gate;
    await route.fallback();
  });
  return { release, arrived: () => arrived };
}

/** «Каса» stubbed: the drawer, its closes, the seller's operations and one
 * operation's way. */
async function stub(
  page: Page,
  now: Record<string, unknown> = drawer(),
): Promise<void> {
  await page.route("**/api/v1/cash/drawer?**", async (route) => {
    await route.fulfill({ json: now });
  });
  await page.route("**/api/v1/cash/closes?**", async (route) => {
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await page.route("**/api/v1/cash/events?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            target: "SALE",
            target_id: sale.target_id,
            at: new Date().toISOString(),
            label: "Лоран шоколад · M",
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/cash/*/*/method?**", async (route) => {
    await route.fulfill({ json: sale });
  });
}

async function open(page: Page, who = olya): Promise<void> {
  await page.goto("about:blank");
  await page.goto(launch(who));
  await openStore(page, /^Каса CASH/);
}

function said(page: Page): Locator {
  return page.locator('[role="status"].visually-hidden');
}

test("«Каса» read keeps the card where it will stand, and still says «Завантажуємо касу…» (cash task list, P2-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stub(page);
  const read = await hold(page, "**/api/v1/cash/drawer?**");
  await open(page);
  await section(page, "Каса");
  await expect(said(page)).toHaveText("Завантажуємо касу…");
  const place = page.locator(".cash-card-skeleton");
  await expect(place).toBeVisible();
  await expect(page.getByText("Завантажуємо касу…")).toHaveClass(
    /visually-hidden/,
  );
  const before = await place.boundingBox();
  read.release();
  const card = page.getByRole("button", { name: "Закрити касу", exact: true });
  await expect(card).toBeVisible();
  await expect(place).toHaveCount(0);
  const after = await card.boundingBox();
  if (!before || !after) throw new Error("not laid out");
  // Nothing jumps: the card where its place was, as large.
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test("the seller's operations, one of them, and the closes read keep their places, and say what is read (cash task list, P2-2)", async ({
  page,
}) => {
  await stub(page);
  await open(page);
  await section(page, "Каса");
  const mine = await hold(page, "**/api/v1/cash/events?**");
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  await expect(said(page)).toHaveText("Завантажуємо…");
  await expect(page.locator(".placeholder .sale-row")).toHaveCount(3);
  await expect(page.locator(".placeholder .skeleton-day")).toHaveCount(0);
  mine.release();
  const rows = page.getByRole("list", { name: "Ваші операції" });
  await expect(rows.getByRole("listitem")).toHaveCount(1);
  const way = await hold(page, "**/api/v1/cash/*/*/method?**");
  await rows.getByRole("button").first().click();
  await expect(said(page)).toHaveText("Завантажуємо операцію…");
  await expect(page.locator(".placeholder .skeleton-way")).toHaveCount(3);
  way.release();
  await expect(
    page.getByRole("group", { name: "Новий спосіб оплати" }),
  ).toBeVisible();
  await expect(page.locator(".placeholder")).toHaveCount(0);
});

test("«Закриття» read keeps four rows' places, and says «Завантажуємо закриття…» (cash task list, P2-2)", async ({
  page,
}) => {
  await stub(page, drawer({ may_correct: true }));
  await open(page, owner);
  await section(page, "Каса");
  const closes = await hold(page, "**/api/v1/cash/closes?**");
  await page.getByRole("button", { name: "Закриття", exact: true }).click();
  await expect(said(page)).toHaveText("Завантажуємо закриття…");
  await expect(page.locator(".placeholder .sale-row")).toHaveCount(4);
  closes.release();
  await expect(
    page.getByText("Касу цього магазину ще не закривали."),
  ).toBeVisible();
});

for (const [path, name, notTaken] of [
  [
    "movements",
    "cash taken out",
    "Не записано. Перевірте суму та примітку й спробуйте ще раз.",
  ],
  [
    "corrections",
    "a way changed",
    "Не записано. Перевірте пояснення й спробуйте ще раз.",
  ],
] as const)
  test(`${name}, refused for what «Каса»'s words do not name, says the drawer's words — never an order's (cash task list, P2-1)`, async ({
    page,
  }) => {
    await stub(page);
    const answers = [409, 422];
    await page.route(`**/api/v1/cash/${path}`, async (route) => {
      const status = answers.shift() ?? 500;
      await route.fulfill({
        status,
        json:
          status === 409
            ? { code: "CONFLICT", message: "Conflict", details: {} }
            : {
                code: "VALIDATION_ERROR",
                message: "Request failed validation",
                details: {},
              },
      });
    });
    await open(page);
    await section(page, "Каса");
    let press: Locator;
    if (path === "movements") {
      await page
        .getByRole("button", { name: "Видати з каси", exact: true })
        .click();
      await page
        .getByRole("group", { name: "Кому чи на що" })
        .getByRole("button", { name: "Витрати", exact: true })
        .click();
      await page.getByLabel("Сума", { exact: true }).fill("150");
      press = page.getByRole("button", { name: "Видати 150,00 грн" });
    } else {
      await page
        .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
        .click();
      await page
        .getByRole("list", { name: "Ваші операції" })
        .getByRole("button")
        .first()
        .click();
      await page
        .getByRole("group", { name: "Новий спосіб оплати" })
        .getByRole("button", { name: "Готівка", exact: true })
        .click();
      press = page.getByRole("button", { name: "Змінити на «Готівка»" });
    }
    await press.click();
    await expect(page.getByRole("alert")).toHaveText(
      "Не записано: дані каси змінилися, поки ви працювали. Спробуйте ще раз.",
    );
    if (path === "corrections")
      // A way read again: chosen anew.
      await page
        .getByRole("group", { name: "Новий спосіб оплати" })
        .getByRole("button", { name: "Готівка", exact: true })
        .click();
    await press.click();
    // Not taken: what it holds to check — a sum and a note, or an
    // explanation — never a sum where there is none.
    await expect(page.getByRole("alert")).toHaveText(notTaken);
    await expect(
      page.getByRole("alert").filter({ hasText: /замовлення/ }),
    ).toHaveCount(0);
  });

test("a note the server cannot keep says so in «Каса»'s words, what was typed kept (cash task list, P2-1)", async ({
  page,
}) => {
  await stub(page);
  await page.route("**/api/v1/cash/movements", async (route) => {
    await route.fulfill({
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "A note is at most 200 characters",
        details: { reason: "NOTE", recorded: false },
      },
    });
  });
  await open(page);
  await section(page, "Каса");
  await page
    .getByRole("button", { name: "Видати з каси", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await page.getByLabel("Сума", { exact: true }).fill("150");
  await page.getByLabel("На що (необов’язково)").fill("пакети");
  await page.getByRole("button", { name: "Видати 150,00 грн" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Не записано: у примітці є знаки, яких не зберегти. Приберіть їх і спробуйте ще раз.",
  );
  await expect(page.getByLabel("На що (необов’язково)")).toHaveValue("пакети");
});

/** Where Оля's drawer journal is kept on the phone. */
async function journalKey(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(olya) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const me = (await (
    await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    })
  ).json()) as { organization_id: string; user_id: string };
  return `birka:cash-pending:${me.organization_id}:${me.user_id}:${store}`;
}

test("a kept take-out the server says changed is still unconfirmed, by its own name; proven unrecorded, it says to send it again (cash task list, P2-1)", async ({
  page,
}) => {
  const key = await journalKey(page);
  await page.goto("/");
  await page.evaluate(
    ([name, saved]) => {
      localStorage.setItem(name, saved);
    },
    [
      key,
      JSON.stringify({
        key: randomUUID(),
        body: {
          command: "movement",
          store_id: store,
          command_id: randomUUID(),
          movement_kind: "EXPENSES",
          amount: "150.00",
          note: null,
          after_close_id: lastClose.id,
        },
        ambiguous: true,
      }),
    ] as const,
  );
  await stub(page);
  let proven = false;
  await page.route("**/api/v1/cash/movements", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "CONFLICT",
        message: "Conflict",
        details: proven ? { recorded: false } : {},
      },
    });
  });
  await open(page);
  await section(page, "Каса");
  await expect(page.getByRole("alert")).toHaveText(
    "Видачу ще не підтверджено: сервер відповів, що дані змінилися. Перевірте результат ще раз — двічі цю операцію не запишуть.",
  );
  expect(
    await page.evaluate((stored) => localStorage.getItem(stored), key),
  ).not.toBeNull();
  proven = true;
  await page.getByRole("button", { name: "Перевірити видачу" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Видачу не записано. Дані каси змінилися, поки сервер не відповідав. Спробуйте ще раз.",
  );
  expect(
    await page.evaluate((stored) => localStorage.getItem(stored), key),
  ).toBeNull();
  await expect(
    page.getByRole("alert").filter({ hasText: /замовлення/ }),
  ).toHaveCount(0);
});

test("«Каса» opened on a kept command keeps its banner where it stands while the drawer is read (cash task list, P2-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const key = await journalKey(page);
  await page.goto("/");
  await page.evaluate(
    ([name, saved]) => {
      localStorage.setItem(name, saved);
    },
    [
      key,
      JSON.stringify({
        key: randomUUID(),
        body: {
          command: "movement",
          store_id: store,
          command_id: randomUUID(),
          movement_kind: "EXPENSES",
          amount: "150.00",
          note: null,
          after_close_id: lastClose.id,
        },
        ambiguous: true,
      }),
    ] as const,
  );
  await stub(page);
  // The server fails its check: the banner stays.
  await page.route("**/api/v1/cash/movements", async (route) => {
    await route.fulfill({
      status: 500,
      json: { code: "INTERNAL_ERROR", message: "Internal error" },
    });
  });
  const read = await hold(page, "**/api/v1/cash/drawer?**");
  await open(page);
  const banner = page.locator("section.notice");
  await expect(banner).toBeVisible();
  await expect(said(page)).toHaveText("Завантажуємо касу…");
  const before = await banner.boundingBox();
  read.release();
  await expect(
    page.getByRole("button", { name: "Закрити касу", exact: true }),
  ).toBeVisible();
  const after = await banner.boundingBox();
  if (!before || !after) throw new Error("not laid out");
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test("whoever may not close never sees the card's place while «Каса» is read (cash task list, P2-2)", async ({
  page,
}) => {
  await stub(page, drawer({ may_close: false }));
  // Оля here takes cash out but no longer closes.
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    await route.fulfill({
      response,
      json: {
        ...me,
        stores: me.stores.map((each) => ({
          ...each,
          permissions: each.permissions.filter(
            (permission) => permission !== "cash:close",
          ),
        })),
      },
    });
  });
  const read = await hold(page, "**/api/v1/cash/drawer?**");
  await open(page);
  await section(page, "Каса");
  await expect(said(page)).toHaveText("Завантажуємо касу…");
  await expect(page.locator(".placeholder .cash-row")).toHaveCount(2);
  await expect(page.locator(".cash-card-skeleton")).toHaveCount(0);
  read.release();
  await expect(
    page.getByRole("button", { name: "Видати з каси", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cash-card")).toHaveCount(0);
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
  test(`in the ${name} theme a server that does not answer is a warning's plate on «Каса», read at 4.5:1 (cash task list, P2-3)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.route("**/api/v1/cash/drawer?**", async (route) => {
      await route.abort("connectionreset");
    });
    await page.goto("about:blank");
    await page.goto(launch(olya, theme));
    await openStore(page, /^Каса CASH/);
    await section(page, "Каса");
    const plate = page.locator(".cash .notice[role='alert']");
    await expect(plate).toContainText(
      "Касу зараз не закрити: сервер не відповідає.",
    );
    // A warning's, never a debt's red.
    const colours = await plate.evaluate((node) => {
      const probe = document.createElement("div");
      probe.style.background = "var(--warn-bg)";
      document.body.append(probe);
      const warn = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { plate: getComputedStyle(node).backgroundColor, warn };
    });
    expect(colours.plate).toBe(colours.warn);
    for (const part of [
      plate.locator("p").first(),
      plate.locator("p").nth(1),
      plate.getByRole("button", { name: "Спробувати ще раз" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `test-results/cash-unreachable-${name}.png`,
    });
  });
