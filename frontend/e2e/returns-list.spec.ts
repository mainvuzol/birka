import { test, expect, openStore } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Повернення»'s list (returns task list, P0-1, P0-2; owner decisions,
 * 2026-10-17): «Що повертають?» searched as it is typed, sales by day with
 * their goods and hour and never a sum or a way (G32, for everyone), the
 * whole row opening a sale, and «Показати ще» reading twenty more at a
 * time. The store's sales are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
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

interface Summary {
  id: string;
  store_id: string;
  store_name: string;
  sold_at: string;
  currency_code: string;
  total: string;
  paid_in_parts: boolean;
  outage: Record<string, unknown> | null;
  items: Record<string, unknown>[];
}

function sale(
  name: string,
  soldAt: Date,
  extra: Partial<Summary> & { refunded?: number } = {},
): Summary {
  const { refunded = 0, ...rest } = extra;
  return {
    id: randomUUID(),
    store_id: fixture.store_id,
    store_name: "Основний",
    sold_at: soldAt.toISOString(),
    currency_code: "UAH",
    total: "3000.00",
    paid_in_parts: false,
    outage: null,
    items: [
      {
        id: randomUUID(),
        display_name: name,
        size: "M",
        source_location_id: fixture.till_location_id,
        quantity: 1,
        final_unit_price: "3000.00",
        line_total: "3000.00",
        refunded,
        back_to_sold_from: true,
      },
    ],
    ...rest,
  };
}

/** The store's sales, answered page by page as the server pages them;
 * what each read asked. */
async function sales(
  page: Page,
  every: Summary[],
  answer?: (offset: number) => { status: number } | null,
): Promise<URLSearchParams[]> {
  const asked: URLSearchParams[] = [];
  await page.route("**/api/v1/sales?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push(params);
    const limit = Number(params.get("limit") ?? "20");
    const offset = Number(params.get("offset") ?? "0");
    const refused = answer?.(offset) ?? null;
    if (refused) {
      await route.fulfill({
        status: refused.status,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    if (limit > 50) {
      await route.fulfill({
        status: 422,
        json: { code: "VALIDATION_ERROR", message: "limit", details: {} },
      });
      return;
    }
    const q = params.get("q");
    const found = q
      ? every.filter((each) =>
          JSON.stringify(each.items).toLowerCase().includes(q.toLowerCase()),
        )
      : every;
    await route.fulfill({
      json: {
        sales: found.slice(offset, offset + limit),
        has_more: found.length > offset + limit,
      },
    });
  });
  return asked;
}

async function returns(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
}

const ago = (days: number, hours = 0): Date => {
  const at = new Date();
  at.setDate(at.getDate() - days);
  at.setHours(at.getHours() - hours);
  return at;
};

test("the list shows no sum and no way, the sale opened shows its sum; a row opens whole, a sale returned whole opens nothing", async ({
  page,
}) => {
  await sales(page, [
    sale("Лоран шоколад", ago(0)),
    sale("Альпака сіра", ago(0, 1), {
      paid_in_parts: true,
      outage: {
        sold_by_user_id: null,
        sold_by: null,
        sold_at: null,
        first_days: true,
      },
    }),
    sale("Деінде беж", ago(0, 2), { refunded: 1 }),
  ]);
  await returns(page);
  const list = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Повернення" }),
  });
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(list).not.toContainText(/грн|готів|картк|переказ/i);
  await expect(page.getByRole("article").nth(1)).toContainText(
    "Оплата частинами",
  );
  await expect(page.getByRole("article").nth(1)).toContainText(
    "Продано з паперу",
  );
  // A screen reader hears the marks too: the row's description.
  await expect(
    page.getByRole("button", { name: /^Оформити повернення: Альпака сіра/ }),
  ).toHaveAccessibleDescription(/Оплата частинами.*Продано з паперу/);
  // Returned whole: said, and nothing to press.
  const whole = page.getByRole("article").nth(2);
  await expect(whole).toContainText("Усе вже повернено");
  await expect(whole.getByRole("button")).toHaveCount(0);

  await page
    .getByRole("button", { name: /^Оформити повернення: Лоран шоколад · M, / })
    .click();
  await expect(page.getByText(/^Продаж .* · 3\s000,00 грн$/)).toBeVisible();
});

test("the search runs as it is typed, from two letters; Enter at once; one letter lists every sale", async ({
  page,
}) => {
  const asked = await sales(page, [
    sale("Лоран шоколад", ago(0)),
    sale("Альпака сіра", ago(0, 1)),
  ]);
  await page.clock.install();
  await returns(page);
  await expect(page.getByRole("article")).toHaveCount(2);
  // The clock moves only when told: a search the pause would make cannot
  // happen by itself.
  await page.clock.pauseAt(Date.now() + 60_000);
  const field = page.getByLabel("Що повертають?");
  const searched = (q: string) => asked.some((params) => params.get("q") === q);
  // The clock moved in small steps: the pause's timer is set once the page
  // has drawn what was typed, which this does not wait for.
  const wait = async (ms: number) => {
    for (let gone = 0; gone < ms; gone += 100) await page.clock.runFor(100);
  };

  // One letter, the pause gone by: nothing new is asked.
  await field.fill("л");
  await wait(800);
  expect(asked.every((params) => !params.has("q"))).toBe(true);
  await expect(page.getByRole("article")).toHaveCount(2);

  // Three letters, no key: not before the pause, searched once it has gone
  // by.
  await field.fill("лор");
  await wait(200);
  expect(searched("лор")).toBe(false);
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return searched("лор");
    })
    .toBe(true);
  // The answer is drawn on the query's own timer, which moves only when
  // the clock is moved: moved until it is (the pause already proven above).
  await expect
    .poll(async () => {
      await page.clock.runFor(100);
      return page.getByRole("article").count();
    })
    .toBe(1);
  await expect(page.getByRole("article")).toContainText("Лоран шоколад · M");
  expect(searched("лор")).toBe(true);

  // Enter: at once, the clock not moved.
  await field.fill("альп");
  await field.press("Enter");
  await expect.poll(() => searched("альп")).toBe(true);
  // Asked with the clock still: by Enter, not the pause. From here the
  // clock runs as it does (the list is drawn on the query's own timers).
  await page.clock.resume();
  await expect(page.getByRole("article")).toContainText("Альпака сіра · M");

  // Nothing found: said, and cleared in one tap, the cursor back.
  await field.fill("немає такого");
  await field.press("Enter");
  await expect(
    page.getByText(
      "За «немає такого» продажів не знайдено. Перевірте назву або очистіть пошук.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Очистити" }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("«Показати ще» reads twenty more at a time, never past the server's fifty, each sale once", async ({
  page,
}) => {
  const every = Array.from({ length: 45 }, (_, n) =>
    sale(`Модель ${String(n + 1)}`, ago(0, n)),
  );
  const asked = await sales(page, every);
  await returns(page);
  await expect(page.getByRole("article")).toHaveCount(20);
  const more = page.getByRole("button", { name: "Показати ще" });
  await more.click();
  await expect(page.getByRole("article")).toHaveCount(40);
  await more.click();
  await expect(page.getByRole("article")).toHaveCount(45);
  await expect(more).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const pages = asked.map((params) => [
    Number(params.get("limit")),
    Number(params.get("offset")),
  ]);
  expect(pages).toEqual([
    [20, 0],
    [20, 20],
    [20, 40],
  ]);
});

test("a sale read twice across a page's edge is shown once", async ({
  page,
}) => {
  const every = Array.from({ length: 25 }, (_, n) =>
    sale(`Модель ${String(n + 1)}`, ago(0, n)),
  );
  let shifted = false;
  await page.route("**/api/v1/sales?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("offset") ?? "0");
    // A sale made meanwhile: the second page starts one row earlier.
    const start = offset > 0 && !shifted ? offset - 1 : offset;
    if (offset > 0) shifted = true;
    await route.fulfill({
      json: {
        sales: every.slice(start, offset + 20),
        has_more: every.length > offset + 20,
      },
    });
  });
  await returns(page);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(page.getByRole("article")).toHaveCount(25);
});

test("a next page that cannot be read keeps the sales read, and offers to try again", async ({
  page,
}) => {
  const every = Array.from({ length: 30 }, (_, n) =>
    sale(`Модель ${String(n + 1)}`, ago(0, n)),
  );
  let refusals = 1;
  await sales(page, every, (offset) =>
    offset === 20 && refusals-- > 0 ? { status: 500 } : null,
  );
  await returns(page);
  await page.getByRole("button", { name: "Показати ще" }).click();
  const failed = page.getByRole("alert");
  await expect(failed).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(20);
  await failed.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(page.getByRole("article")).toHaveCount(30);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("at 360 px only the heading and the field stand above the sales, by day; a row is a target of 44 px; the other stores are under them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await sales(page, [
    sale("Лоран шоколад", ago(0)),
    sale("Альпака сіра", ago(1)),
    sale("Деінде беж", ago(9)),
  ]);
  await returns(page);
  const field = await page.getByLabel("Що повертають?").boundingBox();
  const first = await page.getByRole("article").first().boundingBox();
  const today = await page
    .getByRole("heading", { name: "Сьогодні" })
    .boundingBox();
  if (!field || !first || !today) throw new Error("not laid out");
  // Between the field and the first sale, only the day's heading: the gap
  // holds it and its margins, and nothing else.
  expect(today.y).toBeGreaterThan(field.y + field.height);
  expect(first.y - (field.y + field.height)).toBeLessThanOrEqual(
    today.height + 40,
  );
  await expect(page.getByRole("heading", { name: "Сьогодні" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Вчора" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);
  for (const row of await page.getByRole("article").all()) {
    const box = await row.getByRole("button").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // Nothing typed, nothing offered of the other stores (P1-1).
  await expect(page.getByRole("button", { name: "Шукати там" })).toHaveCount(0);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the other stores' sales show no sum and no way either", async ({
  page,
}) => {
  await page.route("**/api/v1/sales?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const there = params.get("elsewhere") === "true";
    await route.fulfill({
      json: {
        sales: there
          ? [
              sale("Деінде графіт", ago(0), {
                store_id: randomUUID(),
                store_name: "Другий",
                paid_in_parts: true,
              }),
            ]
          : [sale("Лоран шоколад", ago(0))],
        has_more: false,
      },
    });
  });
  await returns(page);
  await page.getByLabel("Що повертають?").fill("деінде");
  await page.getByLabel("Що повертають?").press("Enter");
  await page.getByRole("button", { name: "Шукати там" }).click();
  const row = page.getByRole("article");
  await expect(row).toContainText("Магазин «Другий»");
  await expect(row).not.toContainText(/грн|готів|картк|переказ/i);
});

test("the list read again and refused says so above the rows it had, and is read again on asking", async ({
  page,
}) => {
  let refuse = false;
  await page.route("**/api/v1/sales?**", async (route) => {
    if (refuse) {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    await route.fulfill({
      json: { sales: [sale("Лоран шоколад", ago(0))], has_more: false },
    });
  });
  await returns(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  refuse = true;
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await page.getByRole("button", { name: "Повернення", exact: true }).click();
  const failed = page.getByRole("alert");
  await expect(failed).toBeVisible();
  // The rows as they were, under what is said of them.
  await expect(page.getByRole("article")).toHaveCount(1);
  refuse = false;
  await failed.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("back from a sale, the list is read again", async ({ page }) => {
  const asked = await sales(page, [sale("Лоран шоколад", ago(0))]);
  await returns(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  const before = asked.length;
  await page
    .getByRole("button", { name: /^Оформити повернення: Лоран шоколад/ })
    .click();
  await page.getByRole("button", { name: "До списку", exact: true }).click();
  await expect.poll(() => asked.length).toBeGreaterThan(before);
});

test("a search typed keeps the list where it was until the new one comes", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const every = [
    sale("Лоран шоколад", ago(0)),
    sale("Альпака сіра", ago(0, 1)),
  ];
  await page.route("**/api/v1/sales?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q) await held;
    await route.fulfill({
      json: {
        sales: q
          ? every.filter((each) =>
              JSON.stringify(each.items).toLowerCase().includes(q),
            )
          : every,
        has_more: false,
      },
    });
  });
  await returns(page);
  await expect(page.getByRole("article")).toHaveCount(2);
  const asked = page.waitForRequest((request) =>
    request.url().includes("q=%D0%BB%D0%BE%D1%80"),
  );
  await page.getByLabel("Що повертають?").fill("лор");
  await asked;
  // Not answered yet: the rows as they were, and no «Завантажуємо…».
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByText("Завантажуємо продажі…")).toHaveCount(0);
  release();
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("the other stores are offered from two letters under this store's results, headed, and left in one tap; clearing the field leaves them", async ({
  page,
}) => {
  const asked = await sales(page, [
    sale("Лоран шоколад", ago(0)),
    sale("Альпака сіра", ago(0, 1)),
  ]);
  await returns(page);
  await expect(page.getByRole("article")).toHaveCount(2);
  const field = page.getByLabel("Що повертають?");
  const offer = page.getByRole("button", { name: "Шукати там" });
  // Nothing typed, or one letter: not offered, never asked.
  await expect(offer).toHaveCount(0);
  await field.fill("л");
  await expect(offer).toHaveCount(0);
  await field.fill("лор");
  await expect(page.getByRole("article")).toHaveCount(1);
  // Under this store's results.
  const row = await page.getByRole("article").boundingBox();
  const under = await offer.boundingBox();
  if (!row || !under) throw new Error("not laid out");
  expect(under.y).toBeGreaterThan(row.y);
  expect(asked.some((params) => params.get("elsewhere") === "true")).toBe(
    false,
  );
  await offer.click();
  await expect(
    page.getByRole("heading", { name: "В інших магазинах мережі" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      asked.some(
        (params) =>
          params.get("elsewhere") === "true" && params.get("q") === "лор",
      ),
    )
    .toBe(true);
  await expect(offer).toHaveCount(0);
  // Back in one tap, what was typed kept.
  await page.getByRole("button", { name: "У своєму магазині" }).click();
  await expect(
    page.getByRole("heading", { name: "В інших магазинах мережі" }),
  ).toHaveCount(0);
  await expect(field).toHaveValue("лор");
  await expect(offer).toBeVisible();
  // There again, and one letter left: this store's list.
  await offer.click();
  await field.fill("л");
  await expect(
    page.getByRole("heading", { name: "В інших магазинах мережі" }),
  ).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(2);
  // Typed again, it is this store's again, the other stores offered anew.
  await field.fill("лор");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(offer).toBeVisible();
  // Nothing of the other stores was ever asked without two letters.
  const there = asked.filter((params) => params.get("elsewhere") === "true");
  expect(there.length).toBeGreaterThan(0);
  expect(there.every((params) => (params.get("q") ?? "").length >= 2)).toBe(
    true,
  );
});

test("switching to the other stores never shows this store's rows under their heading", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/sales?**", async (route) => {
    const there =
      new URL(route.request().url()).searchParams.get("elsewhere") === "true";
    if (there) await held;
    await route.fulfill({
      json: {
        sales: there
          ? [
              sale("Лоран деінде", ago(0), {
                store_id: randomUUID(),
                store_name: "Другий",
              }),
            ]
          : [sale("Лоран шоколад", ago(0))],
        has_more: false,
      },
    });
  });
  await returns(page);
  await page.getByLabel("Що повертають?").fill("лор");
  await expect(page.getByRole("article")).toContainText("Лоран шоколад");
  await page.getByRole("button", { name: "Шукати там" }).click();
  await expect(
    page.getByRole("heading", { name: "В інших магазинах мережі" }),
  ).toBeVisible();
  // Their answer held: being read, and this store's row is gone.
  await expect(page.getByRole("status")).toContainText("Завантажуємо продажі…");
  await expect(page.getByRole("article")).toHaveCount(0);
  release();
  await expect(page.getByRole("article")).toContainText("Магазин «Другий»");
  await expect(page.getByText("Лоран шоколад")).toHaveCount(0);
});

test("nothing found here says to call the manager for goods sold before Бірка; nothing found elsewhere, not", async ({
  page,
}) => {
  await sales(page, [sale("Лоран шоколад", ago(0))]);
  await returns(page);
  const before = page.getByText(
    "Продали ще до Бірки? Покличте менеджера — таке повернення вирішує він.",
    { exact: true },
  );
  await page.getByLabel("Що повертають?").fill("немає");
  await page.getByLabel("Що повертають?").press("Enter");
  await expect(
    page.getByText(
      "За «немає» продажів не знайдено. Перевірте назву або очистіть пошук.",
    ),
  ).toBeVisible();
  // В5 (а): the manager decides (returns task list, P1-6).
  await expect(before).toBeVisible();
  await page.getByRole("button", { name: "Шукати там" }).click();
  await expect(
    page.getByText(
      "В інших магазинах мережі за «немає» продажів не знайдено.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(before).toHaveCount(0);
  // «Очистити» there: this store's list again.
  await page.getByRole("button", { name: "Очистити" }).click();
  await expect(
    page.getByRole("heading", { name: "В інших магазинах мережі" }),
  ).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(1);
});
