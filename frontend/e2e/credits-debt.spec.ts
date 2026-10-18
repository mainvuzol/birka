import { test, expect, openStore } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * One debt in «Борги» (credits task list, P0-3, P0-4): who and what in one
 * line, what is owed first and large with how much of it is paid, the
 * history a row an entry; the payment's sum under it and its three ways
 * under the thumb, none pressable without a sum. The store's debts are
 * stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function launch(theme?: Record<string, string>): string {
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
  const hash = new URLSearchParams({ tgWebAppData: fields.toString() });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  return `/#${hash.toString()}`;
}

type Debt = Record<string, unknown> & { id: string };

const thisYear = new Date().getFullYear();

/** A debt of «Основний», sold at 3 000: 1 000 paid now, 500 later in cash,
 * a coat of 500 brought back with its money on the card. What is owed is
 * the server's, and on purpose no sum of the others: 1 234,56. */
function debt(extra: Record<string, unknown> = {}): Debt {
  return {
    id: randomUUID(),
    sale_id: randomUUID(),
    store_id: fixture.store_id,
    store_name: "Основний",
    store_state: "ACTIVE",
    customer_name: "Оксана Петренко",
    customer_phone: "067 123 45 67",
    customer_erased_at: null,
    amount: "3000.00",
    currency_code: "UAH",
    status: "OPEN",
    paid: "1500.00",
    returned: "500.00",
    cash_back: "500.00",
    written_off: "0.00",
    owed: "1234.56",
    opened_at: `${String(thisYear)}-10-01T10:00:00Z`,
    last_payment_at: `${String(thisYear)}-10-12T09:30:00Z`,
    closed_at: null,
    goods: ["Лоран шоколад · M", "Альпака сіра · L"],
    entries: [
      {
        kind: "PAYMENT",
        amount: "1000.00",
        cash_back: "0.00",
        at: `${String(thisYear)}-10-01T10:00:00Z`,
        by: "Оля",
        note: null,
        taken_at: null,
        payment_method: "CASH",
        corrected: false,
        outage: null,
      },
      {
        kind: "PAYMENT",
        amount: "500.00",
        cash_back: "0.00",
        at: `${String(thisYear)}-10-12T09:30:00Z`,
        by: "Ганна",
        note: null,
        taken_at: "Центр",
        payment_method: "CASH",
        corrected: false,
        outage: null,
      },
      {
        kind: "RETURN",
        amount: "500.00",
        cash_back: "500.00",
        at: `${String(thisYear)}-10-13T11:00:00Z`,
        by: "Оля",
        note: null,
        taken_at: null,
        payment_method: "CARD",
        corrected: false,
        outage: null,
      },
    ],
    ...extra,
  };
}

/** The list holds this one debt; payments are answered as `paid` says, and
 * every body sent is kept. */
async function serve(
  page: Page,
  one: Debt,
  paid: (body: { amount: string }) => Debt = (body) => ({
    ...one,
    paid: body.amount,
  }),
): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    await route.fulfill({
      json: { owed: String(one.owed), customers: 1, debts: 1 },
    });
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            phone_digits: "0671234567",
            customer_name: one.customer_name,
            customer_phone: one.customer_phone,
            owed: one.owed,
            open_debts: one.status === "OPEN" ? 1 : 0,
            credits: [one],
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
    const body = route.request().postDataJSON() as { amount: string };
    sent.push(body);
    await route.fulfill({ status: 201, json: paid(body) });
  });
  return sent;
}

async function opened(
  page: Page,
  theme?: Record<string, string>,
): Promise<void> {
  await page.goto(launch(theme));
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Борги", exact: true }).click();
  await page.getByRole("button", { name: /^Відкрити борг: / }).click();
}

function panel(page: Page): Locator {
  return page.getByRole("group", { name: "Внесок", exact: true });
}

test("a debt says who and what in one line, what is owed first and large, how much is paid, and its history a row an entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await serve(page, debt());
  await opened(page);

  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 2 }),
  ).toBeVisible();
  await expect(page.locator(".debt-context")).toHaveText(
    "067 123 45 67 · Лоран шоколад · M + ще 1 · з 01.10",
  );
  await expect(page.locator(".debt-context a")).toHaveAttribute(
    "href",
    "tel:0671234567",
  );
  // What they owe is the server's: never the sum less what is paid.
  const owed = page.getByRole("group", { name: "Скільки винні" });
  await expect(owed.locator(".owed-what")).toHaveText("Винні");
  await expect(owed.locator(".owed-sum")).toHaveText("1 234,56 грн");
  await expect(owed.locator(".owed-count")).toHaveText(
    "Сплачено 1 500,00 грн з 3 000,00 грн · повернено товару на 500,00 грн, з них грошима 500,00 грн",
  );
  const rows = page
    .getByRole("list", { name: "Історія боргу" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.locator(".history-what")).toHaveText([
    "Внесок · готівка",
    "Внесок · готівка",
    "Повернення товару",
  ]);
  await expect(rows.nth(0).locator(".history-meta")).toHaveText(
    /^01\.10, \d\d:\d\d · Оля$/,
  );
  await expect(rows.nth(1).locator(".history-meta")).toHaveText(
    /^12\.10, \d\d:\d\d · Ганна · прийняв магазин «Центр»$/,
  );
  await expect(rows.nth(2).locator(".history-meta")).toHaveText(
    /^13\.10, \d\d:\d\d · Оля · повернено 500,00 грн на картку$/,
  );
  await expect(rows.locator(".history-sum")).toHaveText([
    "1 000,00 грн",
    "500,00 грн",
    "500,00 грн",
  ]);
  // The panel never hides the last of it.
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  const row = await last.boundingBox();
  const below = await panel(page).boundingBox();
  if (!row || !below) throw new Error("not laid out");
  expect(row.y + row.height).toBeLessThanOrEqual(below.y + 1);
  // The owner's, and rare: after the history (P0-3).
  const writeOff = await page
    .getByRole("button", { name: "Списати борг" })
    .boundingBox();
  if (!writeOff) throw new Error("not laid out");
  expect(writeOff.y).toBeGreaterThan(row.y);
});

test("a usual debt at 360 × 640 shows who, what is owed, and the payment's sum and ways without scrolling, none under the panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await serve(
    page,
    debt({
      goods: ["Лоран шоколад · M"],
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      owed: "2000.00",
    }),
  );
  await opened(page);
  const owed = page.getByRole("group", { name: "Скільки винні" });
  for (const part of [
    page.getByRole("heading", { level: 2 }),
    page.locator(".debt-context"),
    owed.locator(".owed-sum"),
    page.getByLabel("Сума внеску, грн"),
    page.getByRole("button", { name: "Увесь залишок" }),
    panel(page).getByRole("button", { name: "Готівка" }),
    panel(page).getByRole("button", { name: "Переказ" }),
  ])
    await expect(part).toBeInViewport();
  // …and none of it under the panel.
  const under = await panel(page).boundingBox();
  const field = await page.getByLabel("Сума внеску, грн").boundingBox();
  const whole = await page
    .getByRole("button", { name: "Увесь залишок" })
    .boundingBox();
  if (!under || !field || !whole) throw new Error("not laid out");
  expect(field.y + field.height).toBeLessThanOrEqual(under.y);
  expect(whole.y + whole.height).toBeLessThanOrEqual(under.y);
});

test("nothing written off or returned is said unless it is, and what is written off is", async ({
  page,
}) => {
  await serve(
    page,
    debt({
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      owed: "2000.00",
      entries: [],
    }),
  );
  await opened(page);
  await expect(page.locator(".owed-count")).toHaveText(
    "Сплачено 1 000,00 грн з 3 000,00 грн",
  );
  await expect(page.locator(".owed-sum")).toHaveText("2 000,00 грн");
  await page.unroute("**/api/v1/credits/customers?**");
  await page.unroute("**/api/v1/credits/summary?**");
  await serve(
    page,
    debt({
      status: "WRITTEN_OFF",
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      written_off: "2000.00",
      owed: "0.00",
      closed_at: `${String(thisYear)}-10-15T09:00:00Z`,
      entries: [],
    }),
  );
  await page.goto("about:blank");
  await opened(page);
  await expect(page.locator(".debt-closed .badge")).toHaveText("Списано");
  await expect(page.locator(".debt-closed .badge")).toHaveClass(/\bneutral\b/);
  await expect(page.locator(".debt-closed")).toContainText(
    "Сплачено 1 000,00 грн з 3 000,00 грн · списано 2 000,00 грн",
  );
});

test("the payment's sum is typed under what is owed, and its three ways wait under the thumb for one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const sent = await serve(page, debt());
  await opened(page);

  // Nothing typed: nothing to press, and nothing sent.
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Впишіть суму внеску",
  );
  await expect(panel(page).getByRole("button")).toHaveText([
    "Готівка",
    "Картка",
    "Переказ",
  ]);
  for (const way of await panel(page).getByRole("button").all())
    await expect(way).toBeDisabled();
  await page.getByLabel("Сума внеску, грн").fill("0");
  await expect(
    panel(page).getByRole("button", { name: "Готівка" }),
  ).toBeDisabled();
  // Typed, but not a sum to the kopeck: said, never left to dead buttons.
  for (const unread of ["12,345", "500 грн"]) {
    await page.getByLabel("Сума внеску, грн").fill(unread);
    await expect(panel(page).locator(".pay-total")).toHaveText(
      "Вкажіть суму внеску з точністю до копійок.",
    );
    await expect(
      panel(page).getByRole("button", { name: "Готівка" }),
    ).toBeDisabled();
  }

  // The whole of what is owed, in one tap, the keyboard left closed.
  await page.getByRole("button", { name: "Увесь залишок" }).click();
  await expect(page.getByLabel("Сума внеску, грн")).toHaveValue("1234,56");
  await expect(page.getByLabel("Сума внеску, грн")).not.toBeFocused();
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Внесок 1 234,56 грн",
  );
  // What the panel says is what is sent.
  await page.getByLabel("Сума внеску, грн").fill("400");
  await expect(panel(page).locator(".pay-total")).toHaveText(
    "Внесок 400,00 грн",
  );
  await panel(page).getByRole("button", { name: "Картка" }).click();
  await expect(
    page.getByText("Внесок 400,00 грн прийнято карткою.", { exact: false }),
  ).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({
    amount: "400.00",
    command_id: expect.any(String) as string,
    payment_method: "CARD",
  });
  await expect(
    page.getByText("Внесок 400,00 грн прийнято карткою.", { exact: false }),
  ).toBeVisible();
});

test("more than is owed is said above the panel, in view, and nothing is sent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const sent = await serve(page, debt());
  await opened(page);
  await page.getByLabel("Сума внеску, грн").fill("5000");
  // Tapped where the thumb finds it with the page at its top, where the
  // refusal would come below the fold: it is brought into view.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const way = await panel(page)
    .getByRole("button", { name: "Переказ" })
    .boundingBox();
  if (!way) throw new Error("not laid out");
  await page.mouse.click(way.x + way.width / 2, way.y + way.height / 2);
  const told = page.getByRole("alert");
  await expect(told).toHaveText(
    "Це більше, ніж винні: залишок боргу 1 234,56 грн. Прийміть 1 234,56 грн, а решту поверніть покупцю переказом.",
  );
  await expect(told).toBeInViewport();
  const said = await told.boundingBox();
  const under = await panel(page).boundingBox();
  if (!said || !under) throw new Error("not laid out");
  expect(said.y + said.height).toBeLessThanOrEqual(under.y + 1);
  expect(sent).toHaveLength(0);
});

test("the owner's write-off, at the end of a long history, says what was done where it is seen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const long = debt();
  const many = Array.from({ length: 12 }, (_, n) => ({
    kind: "PAYMENT",
    amount: "100.00",
    cash_back: "0.00",
    at: `${String(thisYear)}-10-${String(n + 2).padStart(2, "0")}T10:00:00Z`,
    by: "Оля",
    note: null,
    taken_at: null,
    payment_method: "CASH",
    corrected: false,
    outage: null,
  }));
  const one = { ...long, entries: [...(long.entries as object[]), ...many] };
  await serve(page, one);
  await page.route(`**/api/v1/credits/${one.id}/write-off`, async (route) => {
    await route.fulfill({
      json: {
        ...one,
        status: "WRITTEN_OFF",
        owed: "0.00",
        written_off: "1234.56",
        closed_at: `${String(thisYear)}-10-16T09:00:00Z`,
      },
    });
  });
  await opened(page);
  await page.getByRole("button", { name: "Списати борг" }).click();
  await page.getByLabel("Чому списуємо").fill("виїхала");
  await page.getByRole("button", { name: "Так, списати 1 234,56 грн" }).click();
  const said = page.getByRole("status").filter({ hasText: "Борг списано" });
  await expect(said).toHaveText("Борг списано: 1 234,56 грн.");
  await expect(said).toBeInViewport();
});

test("a closed debt says how it closed and when, and takes no payment", async ({
  page,
}) => {
  await serve(
    page,
    debt({
      status: "SETTLED",
      owed: "0.00",
      paid: "2500.00",
      closed_at: `${String(thisYear)}-10-14T09:00:00Z`,
    }),
  );
  await opened(page);
  const closed = page.locator(".debt-closed");
  await expect(closed.locator(".badge")).toHaveText("Сплачено");
  await expect(closed.locator(".badge")).toHaveClass("badge");
  await expect(closed).toContainText("Закрито 14.10");
  await expect(closed).toContainText("Сплачено 2 500,00 грн з 3 000,00 грн");
  await expect(page.getByRole("group", { name: "Скільки винні" })).toHaveCount(
    0,
  );
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel("Сума внеску, грн")).toHaveCount(0);
});

test("another store's debt says once where it was sold and who takes the payment", async ({
  page,
}) => {
  await serve(
    page,
    debt({
      store_id: randomUUID(),
      store_name: "Ринок",
      store_state: "BLOCKED",
    }),
  );
  await opened(page);
  await expect(
    page.getByText(
      "Продано в «Ринок» (заблоковано). Внесок приймаєте ви, борг — за «Ринок».",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/Ринок/)).toHaveCount(1);
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

for (const [name, theme, scheme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
] as const)
  test(`in the ${name} theme a debt's sums, its history and the panel read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await serve(page, debt());
    await opened(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    await page.getByLabel("Сума внеску, грн").fill("400");
    for (const part of [
      page.locator(".owed-sum"),
      page.locator(".owed-count"),
      page.locator(".debt-context"),
      page.locator(".history-what").first(),
      page.locator(".history-meta").first(),
      page.locator(".history-sum").first(),
      panel(page).locator(".pay-total"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/credits-debt-${name}.png` });
  });
