import {
  test,
  expect,
  dockOnMenu,
  expectOwed,
  expectStub,
  openStore,
  toTill,
  listRow,
  section,
  tillWays,
  expectEmpty,
} from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * One debt in «Покупці» (credits task list, P0-3, P0-4; spec S20, S21):
 * who and what in one line, what is owed first and large with how much of
 * it is paid, the history a row an entry; «Внесок» opens S21, the payment's
 * sum on the app's keypad and its three ways under the thumb; the owner's
 * write-off and erasing behind the debt's ⋯. The store's debts are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  /** «Другий», where «Оля» works too. */
  second_store_id: string;
  till_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function launch(theme?: Record<string, string>, version?: string): string {
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
  if (version) hash.set("tgWebAppVersion", version);
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

/** Her other debt here, a scarf: her card lists both, each opening its
 * own detail. */
function aside(): Debt {
  return debt({
    goods: ["Шарф «Затишок»"],
    amount: "500.00",
    paid: "0.00",
    returned: "0.00",
    cash_back: "0.00",
    owed: "500.00",
    opened_at: `${String(thisYear)}-09-20T10:00:00Z`,
    last_payment_at: null,
    entries: [],
  });
}

/** «Основний»'s list holds this one debt — with `also`, her others; payments
 * are answered as `paid` says, and every body sent is kept. */
async function serve(
  page: Page,
  one: Debt,
  // Paid in all, the payment's sum on top: never this payment's alone, so
  // a result that shows it is seen.
  paid: (body: { amount: string }) => Debt = (body) => ({
    ...one,
    paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
  }),
  also: readonly Debt[] = [],
): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    const here =
      new URL(route.request().url()).searchParams.get("store_id") ===
      fixture.store_id;
    await route.fulfill({
      json: here
        ? { owed: String(one.owed), customers: 1, debts: 1 + also.length }
        : { owed: "0.00", customers: 0, debts: 0 },
    });
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const here =
      new URL(route.request().url()).searchParams.get("store_id") ===
      fixture.store_id;
    const credits = [one, ...also];
    await route.fulfill({
      json: {
        items: here
          ? [
              {
                phone_digits: "0671234567",
                customer_name: one.customer_name,
                customer_phone: one.customer_phone,
                owed: one.owed,
                open_debts: credits.filter((each) => each.status === "OPEN")
                  .length,
                credits,
              },
            ]
          : [],
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

/** The debt among her two: her card lists them, and this one opens. */
async function serveDebt(
  page: Page,
  one: Debt,
  paid?: (body: { amount: string }) => Debt,
): Promise<unknown[]> {
  return serve(page, one, paid, [aside()]);
}

/** Every section of the screen on the paper, never a card (audit after
 * stage 2, frame P0-1, sale P0-1). */
async function onPaper(page: Page, screen: string): Promise<void> {
  const drawn = await page.locator("main > section").evaluateAll((all) =>
    all.map((node) => {
      const style = getComputedStyle(node);
      return [
        style.backgroundColor,
        style.borderTopWidth,
        style.borderTopLeftRadius,
        style.paddingLeft,
      ];
    }),
  );
  expect(drawn.length, screen).toBeGreaterThan(0);
  for (const each of drawn)
    expect(each, screen).toEqual(["rgba(0, 0, 0, 0)", "0px", "0px", "0px"]);
}

/** «Ще» › «Покупці», her row, her card, and the debt's row (spec S19,
 * S20): its detail. */
async function opened(
  page: Page,
  theme?: Record<string, string>,
  version?: string,
): Promise<void> {
  await page.goto(launch(theme, version));
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Покупці");
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  await page
    .getByRole("list", { name: "Борги в магазині «Основний»" })
    .getByRole("button", { name: /^Відкрити борг: Лоран/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
  ).toBeVisible();
}

/** S21's form: the keypad and the three ways. */
function panel(page: Page): Locator {
  return page.getByRole("group", { name: "Внесок", exact: true });
}

/** A key of the app's keypad: a digit, «Кома» or «Стерти». */
function key(page: Page, name: string): Locator {
  return page.locator(".keypad").getByRole("button", { name, exact: true });
}

async function keyIn(page: Page, keys: string): Promise<void> {
  for (const one of keys) await key(page, one === "," ? "Кома" : one).click();
}

/** The detail's «Внесок»: outside Telegram, the dock's one button. */
function deposit(page: Page): Locator {
  return page.getByRole("button", { name: "Внесок", exact: true });
}

/** The owner's ⋯ on the debt, and one of its ways, once the sheet takes
 * taps: a tap carried from the ⋯ is let go. */
async function act(page: Page, way: string): Promise<void> {
  await page.getByRole("button", { name: "Дії з боргом" }).click();
  const menu = page.getByRole("dialog");
  await expect(menu).toHaveAttribute("data-ready", "");
  await menu.getByRole("button", { name: way, exact: true }).click();
}

/** «Списати борг» behind the ⋯, its reason, and its «Так, списати …». */
async function writeOff(page: Page, sum: string): Promise<void> {
  await act(page, "Списати борг");
  const sheet = page.getByRole("dialog", { name: "Списати борг" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByLabel("Чому списуємо").fill("виїхала");
  await sheet.getByRole("button", { name: `Так, списати ${sum}` }).click();
}

test("«Покупці», her card and the debt's detail lie on the paper, never a card; the card's blocks 4 round (audit after stage 2, frame P0-1, sale P0-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await serveDebt(page, debt());
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Покупці");
  const her = page.getByRole("button", { name: /^Відкрити борг: Оксана/ });
  await expect(her).toBeVisible();
  await onPaper(page, "S19");
  // A list's row by §6.8 (audit after stage 2, frame P2-2).
  await listRow(page, her, ".debt-name");
  await her.click();
  const debts = page.getByRole("list", {
    name: "Борги в магазині «Основний»",
  });
  await expect(debts).toBeVisible();
  await onPaper(page, "S20");
  await listRow(page, debts.getByRole("button").first(), ".debt-name");
  // On the card's own white, never a block in a block: the rows the card's
  // width inside its outline (review).
  const card = page.locator(".customer-block").filter({ has: debts });
  const cardBox = await card.boundingBox();
  const rowBox = await debts.getByRole("button").first().boundingBox();
  expect(
    cardBox &&
      rowBox &&
      Math.abs(rowBox.x - (cardBox.x + 1)) <= 0.5 &&
      Math.abs(rowBox.width - (cardBox.width - 2)) <= 0.5,
  ).toBe(true);
  expect(
    await debts.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  const blocks = page.locator(".customer-block");
  await expect(blocks.first()).toBeVisible();
  for (const block of await blocks.all())
    await expect(block).toHaveCSS("border-top-left-radius", "4px");
  await debts.getByRole("button", { name: /^Відкрити борг: Лоран/ }).click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
  ).toBeVisible();
  await onPaper(page, "the debt's detail");
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
});

test("«Ще» › «Покупці» opened again on a debt brings the list's first screen («Усе на бірці» task list, P0-4)", async ({
  page,
}) => {
  await serveDebt(page, debt());
  await opened(page);
  await expect(page.locator(".debt-detail")).toBeVisible();
  await section(page, "Покупці");
  await expect(
    page.getByRole("heading", { name: "Покупці", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".debt-detail")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Відкрити борг: Оксана/ }),
  ).toBeVisible();
});

test("a debt says who and what in one line, what is owed first and large, how much is paid, and its history a row an entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await serveDebt(page, debt());
  await opened(page);

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
    /^13\.10, \d\d:\d\d · Оля · повернено 500,00\sгрн на картку$/,
  );
  await expect(rows.locator(".history-sum")).toHaveText([
    "1 000,00 грн",
    "500,00 грн",
    "500,00 грн",
  ]);
  // «Внесок» never hides the last of it.
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  const row = await last.boundingBox();
  const below = await page.locator(".order-dock").boundingBox();
  if (!row || !below) throw new Error("not laid out");
  expect(row.y + row.height).toBeLessThanOrEqual(below.y + 1);
  // The owner's, and rare: behind the ⋯ by the name (spec S20); no
  // payment's form here, S21 is (P0-5).
  await expect(
    page.getByRole("button", { name: "Дії з боргом" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Списати борг" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel(/^Сума/)).toHaveCount(0);
});

test("«Винні» one look on her card and on the debt's own screen as on S21: the debt's glyph, money-xl, «120 000,00 грн» one line at 360; «Історія» the section's caption (audit 2026-11-13, sale P2-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // And a coat written off long ago, listed under the open two.
  await serve(
    page,
    debt({
      amount: "125000.00",
      paid: "5000.00",
      returned: "0.00",
      cash_back: "0.00",
      owed: "120000.00",
    }),
    undefined,
    [
      aside(),
      debt({
        goods: ["Пальто «Затишок» · M"],
        status: "WRITTEN_OFF",
        paid: "0.00",
        returned: "0.00",
        cash_back: "0.00",
        written_off: "3000.00",
        owed: "0.00",
        opened_at: `${String(thisYear)}-03-01T10:00:00Z`,
        closed_at: `${String(thisYear)}-04-01T10:00:00Z`,
        last_payment_at: null,
        entries: [],
      }),
    ],
  );
  // Another store's block, its read held: its place the money-xl line
  // what is owed is (review).
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (
      params.get("limit") !== "5" ||
      params.get("store_id") === fixture.store_id
    ) {
      await route.fallback();
      return;
    }
    await held;
    await route.fallback();
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Покупці");
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  const reading = page.locator(".customer-block .owed-lines .owed-sum").first();
  await expect(reading).toBeAttached();
  expect(Math.round((await reading.boundingBox())?.height ?? 0)).toBe(56);
  await expect(reading.locator(".sum")).toHaveCSS("line-height", "56px");
  release();
  await expect(page.locator(".customer-block .owed-lines")).toHaveCount(0);
  const colours = await page.evaluate(() => {
    const probe = document.createElement("i");
    document.body.append(probe);
    const read = (name: string): string => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const said = { debt: read("--debt"), pencil: read("--pencil") };
    probe.remove();
    return said;
  });
  /** The sum's figures in money-xl, on one line with what stands beside
   * them, inside the screen. */
  const oneLine = async (line: Locator): Promise<void> => {
    const sum = line.locator(".sum");
    await expect(sum).toHaveCSS("font-size", "56px");
    await expect(sum).toHaveCSS("line-height", "56px");
    await expect(sum).toHaveCSS("font-weight", "800");
    const box = await line.boundingBox();
    const figures = await sum.boundingBox();
    if (!box || !figures) throw new Error("not laid out");
    expect(figures.height).toBeLessThan(1.5 * 56);
    expect(box.height).toBeLessThan(1.5 * 56);
    // The figures inside their line, never past it (review).
    expect(figures.x + figures.width).toBeLessThanOrEqual(
      box.x + box.width + 1,
    );
    const glyph = line.locator("svg.icon");
    if ((await glyph.count()) === 1) {
      const mark = await glyph.boundingBox();
      if (!mark) throw new Error("not laid out");
      expect(mark.y).toBeGreaterThanOrEqual(figures.y);
      expect(mark.y + mark.height).toBeLessThanOrEqual(
        figures.y + figures.height,
      );
    }
  };
  // Her card (spec S20 p. 5): the debt's glyph by what is owed.
  const card = page.locator(".customer-owed");
  await expect(card).toHaveText("120 000,00 грн");
  await expect(card.locator("svg.icon")).toHaveCount(1);
  await oneLine(card);
  // Its written-off row closed for good, in `offline`'s grey (audit
  // 2026-11-13, sale P2-5).
  await expect(
    page
      .getByRole("list", { name: "Борги в магазині «Основний»" })
      .getByRole("button", { name: /^Відкрити борг: Пальто/ })
      .getByText("Списано", { exact: true }),
  ).toHaveClass("sticker tone-offline");
  await page.screenshot({ path: "test-results/credits-customer-owed-360.png" });
  await page
    .getByRole("list", { name: "Борги в магазині «Основний»" })
    .getByRole("button", { name: /^Відкрити борг: Лоран/ })
    .click();
  // The debt's own screen: «Винні» as S21 says it, the glyph at 20 and the
  // word in the debt's colour; what is owed in money-xl.
  const owed = page.getByRole("group", { name: "Скільки винні" });
  const what = owed.locator(".owed-what");
  await expect(what).toHaveText("Винні");
  const glyph = await what.locator("svg.icon").boundingBox();
  expect([glyph?.width, glyph?.height]).toEqual([20, 20]);
  await expect(what).toHaveCSS("color", colours.debt);
  await expect(owed.locator(".owed-sum")).toHaveText("120 000,00 грн");
  await oneLine(owed.locator(".owed-sum"));
  // «Історія» the section's caption, as on her card.
  const history = page.getByRole("heading", { name: "Історія", exact: true });
  await expect(history).toHaveCSS("font-size", "13px");
  await expect(history).toHaveCSS("font-weight", "700");
  await expect(history).toHaveCSS("text-transform", "uppercase");
  await expect(history).toHaveCSS("color", colours.pencil);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/credits-debt-owed-360.png" });
});

test("a usual debt at 360 × 640 shows who, what is owed, and «Внесок» without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await serveDebt(
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
    page.getByRole("heading", { level: 1 }),
    page.locator(".debt-context"),
    owed.locator(".owed-sum"),
    deposit(page),
  ])
    await expect(part).toBeInViewport();
  // The whole of «Винні», its figures now 56, over the dock (audit
  // 2026-11-13, sale P2-4; review).
  await expect(owed).toBeInViewport({ ratio: 1 });
  const card = await owed.boundingBox();
  const dock = await page.locator(".order-dock").boundingBox();
  if (!card || !dock) throw new Error("not laid out");
  expect(card.y + card.height).toBeLessThanOrEqual(dock.y);
});

test("nothing written off or returned is said unless it is, and what is written off is", async ({
  page,
}) => {
  await serveDebt(
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
  await serveDebt(
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
  await expect(page.locator(".debt-closed .sticker")).toHaveText("Списано");
  // Closed for good: `offline`'s grey, apart from «Сплачено» (spec §6.18;
  // audit 2026-11-13, sale P2-5).
  await expect(page.locator(".debt-closed .sticker")).toHaveClass(
    /\btone-offline\b/,
  );
  await expect(page.locator(".debt-closed")).toContainText(
    "Сплачено 1 000,00 грн з 3 000,00 грн · списано 2 000,00 грн",
  );
});

test("«Внесок» on a debt opens S21 on it: the sum keyed in, a way, the result in the debt's words and the server's owed; then the debt again, and back by her name to the list as searched", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const one = debt();
  // The server's answer: what is owed after is its own, never worked out.
  const sent = await serveDebt(page, one, (body) => ({
    ...one,
    paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
    owed: "777.00",
  }));
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Покупці");
  await page.getByLabel("Ім’я або телефон").fill("Окс");
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  await page
    .getByRole("list", { name: "Борги в магазині «Основний»" })
    .getByRole("button", { name: /^Відкрити борг: Лоран/ })
    .click();
  await deposit(page).click();

  // S21 on this debt: what she took, the keypad, the menu aside.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Лоран шоколад · M",
  );
  await expect(page.getByRole("navigation", { name: "Розділи" })).toHaveCount(
    0,
  );
  for (const way of ["Готівка", "Картка", "Переказ"])
    await expect(panel(page).getByRole("button", { name: way })).toBeDisabled();
  await keyIn(page, "400");
  await panel(page).getByRole("button", { name: "Переказ" }).click();

  const paid = page.locator(".paid-result");
  const heading = paid.getByRole("heading", { name: "Внесок записано" });
  await expect(heading).toBeFocused();
  // Heard with its sentence as focus comes (review, 2026-10-18).
  await expect(heading).toHaveAccessibleDescription(
    "Внесок 400,00 грн прийнято переказом. Залишок боргу 777,00 грн.",
  );
  await expectStub(paid, {
    way: "Переказ",
    say: "Перевірте, що переказ надійшов",
    sum: "400,00 грн",
  });
  // Seen on its own line, not only inside the sentence a screen reader hears.
  await expect(
    paid.getByText("Залишок боргу 777,00 грн", { exact: true }),
  ).toBeVisible();
  // In the debt's colour, with its arrow (audit 2026-11-13, sale P2-3).
  await expectOwed(paid, "777,00 грн");
  // Its own result's screen (spec S22; audit 2026-11-13, sale P1-1): its
  // title the page's one heading where the coat stood, no «←»; the stub in
  // the spec's order — the way, what to do, the sum, the perforation, what
  // she took, what is left, what she owes the store in all.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Внесок записано",
  );
  await expect(page.locator(".screen-header .back")).toHaveCount(0);
  const order = [
    ".way-pill",
    ".stub-say",
    ".stub-sum",
    ".perforation",
    ".paid-goods",
    ".paid-owed",
    ".paid-total",
  ];
  expect(
    await paid
      .locator(".stub")
      .evaluate(
        (stub, names) =>
          [...stub.querySelectorAll(names.join(", "))].map((node) =>
            names.find((name) => node.matches(name)),
          ),
        order,
      ),
  ).toEqual(order);
  await expect(paid.locator(".paid-goods")).toHaveText(
    "Лоран шоколад · M + ще 1",
  );
  // Outside Telegram, the way back the screen's one main, in its dock at
  // the menu's top, nothing to scroll; «Відкрити борг» quiet under the stub.
  await dockOnMenu(page);
  // «+ ще 1»: every good, where the line was; the result longer than the
  // screen now, its dock sticking on the menu.
  await paid.getByRole("button", { name: "+ ще 1" }).click();
  await expect(
    paid.getByRole("list", { name: "Товари боргу" }).getByRole("listitem"),
  ).toHaveText(["Лоран шоколад · M", "Альпака сіра · L"]);
  await expect(paid.getByRole("list", { name: "Товари боргу" })).toBeFocused();
  const dock = await dockOnMenu(page, { scrolls: true });
  await expect(dock.getByRole("button")).toHaveText("Оксана Петренко");
  await expect(dock.getByRole("button")).toHaveClass(/\bprimary\b/);
  await expect(paid.locator(".result-body > .paid-more")).toHaveText(
    "Відкрити борг",
  );
  await expect(page.locator("main button.primary:visible")).toHaveCount(1);
  expect(sent).toEqual([
    {
      amount: "400.00",
      command_id: expect.any(String) as string,
      payment_method: "TRANSFER",
    },
  ]);
  // In place of the form: nothing to pay again under it.
  await expect(panel(page)).toHaveCount(0);

  // The debt again, as the server answered it.
  await page
    .getByRole("button", { name: "Відкрити борг", exact: true })
    .click();
  await expect(page.locator(".owed-sum")).toHaveText("777,00 грн");
  await keyIn(page, "100");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(paid.locator(".way-pill")).toHaveText("Готівка");
  // Back by her name: the debt, then her card, then the list as searched.
  await paid
    .getByRole("button", { name: "Оксана Петренко", exact: true })
    .click();
  // The detail as the server answered, nothing of S21 left on it.
  await expect(page.locator(".debt-detail:not(.debt-till)")).toBeVisible();
  await expect(page.locator(".paid-result")).toHaveCount(0);
  await expect(page.locator(".owed-sum")).toHaveText("777,00 грн");
  await page
    .getByRole("button", { name: "Оксана Петренко", exact: true })
    .click();
  await page.getByRole("button", { name: "Покупці", exact: true }).click();
  await expect(page.getByLabel("Ім’я або телефон")).toHaveValue("Окс");
});

test("Telegram buzzes once the server has answered a payment: success when recorded, error when refused; a lost answer a warning, its confirmation later nothing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
    };
    host.buzzes = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
      },
    };
  });
  const one = debt();
  let refuse = false;
  let lose = false;
  await serveDebt(page, one);
  await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
    if (lose) {
      await route.abort("connectionreset");
      return;
    }
    if (refuse) {
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "More than owed",
          details: { reason: "MORE_THAN_OWED", owed: "300.00" },
        },
      });
      return;
    }
    await route.fallback();
  });
  await opened(page, undefined, "8.0");
  // The answers' buzzes: a choice's are telegram-rules.spec's.
  const buzzes = async (): Promise<object[]> =>
    (
      await page.evaluate(
        () => (window as unknown as { buzzes: string[] }).buzzes,
      )
    )
      .map((data) => JSON.parse(data) as { type: string })
      .filter((buzz) => buzz.type === "notification");
  // Telegram's MainButton, «Внесок» on the debt, «Відкрити борг» on its
  // result («Усе на бірці» task list, P1-2).
  const mainButton = async (): Promise<void> => {
    await page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: "main_button_pressed" }),
          source: window.parent,
        }),
      );
    });
  };
  await expect(deposit(page)).toHaveCount(0);
  await mainButton();

  await keyIn(page, "400");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(page.locator(".paid-result")).toBeVisible();
  expect(await buzzes()).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
  await mainButton();
  refuse = true;
  await keyIn(page, "300");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(page.getByRole("alert")).toContainText("Це більше, ніж винні");
  const twice = [
    { type: "notification", notification_type: "success" },
    { type: "notification", notification_type: "error" },
  ];
  expect(await buzzes()).toEqual(twice);

  // A lost answer is not an answer, but a payment kept on the phone: felt
  // once, a warning (spec §4.4; «Усе на бірці» task list, P1-2); confirmed
  // later, nothing.
  refuse = false;
  lose = true;
  await key(page, "Стерти").click();
  await key(page, "Стерти").click();
  await key(page, "Стерти").click();
  await keyIn(page, "100");
  await panel(page).getByRole("button", { name: "Готівка" }).click();
  await expect(
    page.getByRole("heading", { name: "Внесок ще не підтверджено" }),
  ).toBeVisible();
  lose = false;
  await page
    .getByRole("button", { name: "Перевірити результат внеску" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Внесок записано один раз" }),
  ).toBeVisible();
  expect(await buzzes()).toEqual([
    ...twice,
    { type: "notification", notification_type: "warning" },
  ]);
});

test("a debt of more goods than one names the first, and all of them on a tap", async ({
  page,
}) => {
  await serveDebt(page, debt());
  await opened(page);
  await expect(page.getByRole("list", { name: "Товари боргу" })).toHaveCount(0);
  const more = page.getByRole("button", { name: "+ ще 1" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(
    page.getByRole("list", { name: "Товари боргу" }).getByRole("listitem"),
  ).toHaveText(["Лоран шоколад · M", "Альпака сіра · L"]);
  // The tapped «+ ще 1» is gone: focus is on what it opened.
  await expect(page.getByRole("list", { name: "Товари боргу" })).toBeFocused();
  await expect(page.getByRole("button", { name: "+ ще 1" })).toHaveCount(0);
});

test("the owner's write-off behind the ⋯, at the end of a long history, asks why in a sheet and says what was done where it is seen", async ({
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
  await serveDebt(page, one);
  const sent: unknown[] = [];
  await page.route(`**/api/v1/credits/${one.id}/write-off`, async (route) => {
    sent.push(route.request().postDataJSON());
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
  // The ⋯'s sheet names the debt, and holds what may be done to it.
  await page.getByRole("button", { name: "Дії з боргом" }).click();
  const menu = page.getByRole("dialog", { name: "Лоран шоколад · M + ще 1" });
  await expect(menu.getByRole("button")).toHaveText(["Списати борг"]);
  await expect(menu).toHaveAttribute("data-ready", "");
  await menu.getByRole("button", { name: "Списати борг" }).click();
  const sheet = page.getByRole("dialog", { name: "Списати борг" });
  await expect(sheet).toContainText(
    "Борг 1 234,56 грн закриється без оплати. Скасувати це потім не можна.",
  );
  // No reason, nothing to press.
  const yes = sheet.getByRole("button", { name: "Так, списати 1 234,56 грн" });
  await expect(yes).toBeDisabled();
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByLabel("Чому списуємо").fill("виїхала");
  await yes.click();
  // Its result, in view: what was done, and the sum written off (P0-5).
  const done = page.locator(".paid-result");
  await expect(
    done.getByRole("heading", { name: "Борг списано" }),
  ).toBeInViewport();
  await expect(done.locator(".hand-back-sum")).toHaveText("1 234,56 грн");
  await expect(page.getByText("Борг списано: 1 234,56 грн.")).toBeAttached();
  await expect(sheet).toHaveCount(0);
  expect(sent).toEqual([expect.objectContaining({ reason: "виїхала" })]);
  // Its own result's screen (audit 2026-11-13, sale P1-1): «✓ Борг списано»
  // the page's one heading, no «←», no ⋯; the way back the screen's main in
  // its dock at the menu's top, «Відкрити борг» quiet under the stub.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Борг списано",
  );
  await expect(done.locator(".result-title .recorded-mark")).toHaveCount(1);
  await expect(page.locator(".screen-header .back")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Дії з боргом" })).toHaveCount(
    0,
  );
  const dock = await dockOnMenu(page);
  await expect(dock.getByRole("button")).toHaveText("Оксана Петренко");
  await expect(dock.getByRole("button")).toHaveClass(/\bprimary\b/);
  await expect(page.locator("main button.primary:visible")).toHaveCount(1);
  await done.locator(".result-body > .paid-more").click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
  ).toBeFocused();
  await expect(page.locator(".paid-result")).toHaveCount(0);
});

test("inside Telegram a write-off's result keeps its own way back: the dock's main, «Відкрити борг» quiet under the stub, Telegram's MainButton put away with the debt's «Внесок» (owner, 2026-10-18; audit 2026-11-13, sale P1-1)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      mains: unknown[];
    };
    host.mains = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_main_button")
          host.mains.push(JSON.parse(data));
      },
    };
  });
  const one = debt();
  await serveDebt(page, one);
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
  const mains = (): Promise<{ is_visible: boolean; text?: string }[]> =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            mains: { is_visible: boolean; text?: string }[];
          }
        ).mains,
    );
  await opened(page, undefined, "8.0");
  // The debt's «Внесок» is Telegram's.
  await expect
    .poll(async () => (await mains()).at(-1))
    .toEqual(expect.objectContaining({ is_visible: true, text: "Внесок" }));
  await page.getByRole("button", { name: "Дії з боргом" }).click();
  const menu = page.getByRole("dialog", { name: "Лоран шоколад · M + ще 1" });
  await expect(menu).toHaveAttribute("data-ready", "");
  await menu.getByRole("button", { name: "Списати борг" }).click();
  const sheet = page.getByRole("dialog", { name: "Списати борг" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByLabel("Чому списуємо").fill("виїхала");
  await sheet.getByRole("button", { name: /^Так, списати/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Борг списано",
  );
  // In Telegram too, the screen's two its own: the way back the dock's
  // main, «Відкрити борг» quiet — never Telegram's MainButton.
  const dock = await dockOnMenu(page);
  await expect(dock.getByRole("button")).toHaveText("Оксана Петренко");
  await expect(dock.getByRole("button")).toHaveClass(/\bprimary\b/);
  await expect(
    page.locator(".paid-result .result-body > .paid-more"),
  ).toHaveText("Відкрити борг");
  await expect
    .poll(async () => (await mains()).at(-1))
    .toEqual({ is_visible: false });
  expect(
    (await mains()).filter((main) => main.text === "Відкрити борг"),
  ).toEqual([]);
});

// What was not recorded, then the step — never «спробуйте ще раз» on a
// write (owner, 2026-11-11, В-П1 (б); audit after stage 2, sale P2-5); a
// refusal naming nothing at all, what to check, as a 422.
for (const [kind, status, said] of [
  [
    "payment",
    409,
    "Внесок не записано. Дані боргу змінилися, поки ви працювали: перевірте залишок.",
  ],
  ["payment", 422, "Внесок не записано. Перевірте суму."],
  ["payment", 400, "Внесок не записано. Перевірте суму."],
  [
    "write-off",
    409,
    "Списання не записано. Дані боргу змінилися, поки ви працювали: перевірте залишок.",
  ],
  ["write-off", 422, "Списання не записано. Перевірте причину."],
  ["write-off", 400, "Списання не записано. Перевірте причину."],
] as const)
  test(`a ${kind} refused with nothing more than a ${String(status)} says what was not recorded in the debt's words, never an order's, nor «спробуйте ще раз» (P2-2; audit after stage 2, sale P2-5)`, async ({
    page,
  }) => {
    const one = debt();
    await serveDebt(page, one);
    await page.route(
      `**/api/v1/credits/${one.id}/${kind === "payment" ? "payments" : "write-off"}`,
      async (route) => {
        await route.fulfill({
          status,
          json: {
            code:
              status === 409
                ? "CONFLICT"
                : status === 422
                  ? "VALIDATION_ERROR"
                  : "BAD_REQUEST",
            message: "Refused",
            details: {},
          },
        });
      },
    );
    await opened(page);
    if (kind === "payment") {
      await deposit(page).click();
      await keyIn(page, "100");
      await panel(page).getByRole("button", { name: "Готівка" }).click();
    } else await writeOff(page, "1 234,56 грн");
    await expect(page.getByRole("alert")).toHaveText(said);
    await expect(page.getByRole("alert")).not.toContainText(/спробуйте/i);
    // «Замовлення»'s «+» aside: the debt never says it.
    await expect(page.locator(".debt-detail")).not.toContainText("замовлення");
  });

test("a closed debt says how it closed and when, and takes no payment", async ({
  page,
}) => {
  await serveDebt(
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
  await expect(closed.locator(".sticker")).toHaveText("Сплачено");
  await expect(closed.locator(".sticker")).toHaveClass("sticker tone-paid");
  await expect(closed).toContainText("Закрито 14.10");
  await expect(closed).toContainText("Сплачено 2 500,00 грн з 3 000,00 грн");
  await expect(page.getByRole("group", { name: "Скільки винні" })).toHaveCount(
    0,
  );
  await expect(deposit(page)).toHaveCount(0);
  await expect(page.locator(".keypad")).toHaveCount(0);
});

test("another store's debt says once where it was sold and who takes the payment", async ({
  page,
}) => {
  await serveDebt(
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

/** The theme's accent for text, as the page resolves its token. */
async function accentText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent-text)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}

for (const [name, theme, scheme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
] as const)
  test(`in the ${name} theme a debt's sums, its phone, its history, its ⋯ and «Внесок» read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await serveDebt(page, debt());
    await opened(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    // «Винні» as on S21, the glyph and the word in the debt's colour, what
    // is owed in money-xl; «Історія» the section's caption (audit
    // 2026-11-13, sale P2-4).
    const debtColour = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--debt)";
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    await expect(page.locator(".owed-what")).toHaveCSS("color", debtColour);
    await expect(page.locator(".owed-sum .sum")).toHaveCSS("font-size", "56px");
    for (const part of [
      page.locator(".owed-what"),
      page.getByRole("heading", { name: "Історія", exact: true }),
      page.locator(".owed-sum"),
      page.locator(".owed-count"),
      page.locator(".debt-context"),
      page.locator(".history-what").first(),
      page.locator(".history-meta").first(),
      page.locator(".history-sum").first(),
      page.locator(".debt-context a"),
      deposit(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // The phone to call in the theme's accent, never the browser's blue,
    // which would read at 4.5:1 too.
    await expect(page.locator(".debt-context a")).toHaveCSS(
      "color",
      await accentText(page),
    );
    // How much is paid: a bar of 6 with the sticker's corner 3, its track
    // the fold with a hairline, filled in the paid's colour — never the
    // hand's accent (spec §6.24; audit after stage 2, sale P2-2).
    const bar = page.locator(".debt-bar");
    const drawn = await bar.evaluate((node) => {
      const resolve = (value: string): string => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
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
      const track = getComputedStyle(node);
      const fill = node.querySelector("span");
      const filled = fill ? getComputedStyle(fill).backgroundColor : "";
      const a = luminance(rgb(filled));
      const b = luminance(rgb(track.backgroundColor));
      return {
        height: node.getBoundingClientRect().height,
        radius: track.borderTopLeftRadius,
        border: `${track.borderTopWidth} ${track.borderTopStyle} ${track.borderTopColor}`,
        track: track.backgroundColor,
        filled,
        // The paid part against the rest of the track: 3:1, as a part one
        // needs to see (WCAG 1.4.11).
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        hairline: resolve("var(--hairline)"),
        fold: resolve("var(--fold)"),
        paid: resolve("var(--paid)"),
      };
    });
    expect(drawn.height).toBe(6);
    expect(drawn.radius).toBe("3px");
    expect(drawn.border).toBe(`1px solid ${drawn.hairline}`);
    expect(drawn.track).toBe(drawn.fold);
    expect(drawn.filled).toBe(drawn.paid);
    expect(drawn.ratio).toBeGreaterThanOrEqual(3);
    // The ⋯ a 44 target, read as the text is.
    const more = page.getByRole("button", { name: "Дії з боргом" });
    const box = await more.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(await contrast(more)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/credits-debt-${name}.png` });
    await more.click();
    await expect(page.getByRole("dialog")).toHaveAttribute("data-ready", "");
    await page.getByRole("button", { name: "Списати борг" }).click();
    const sheet = page.getByRole("dialog", { name: "Списати борг" });
    await expect(sheet).toHaveAttribute("data-ready", "");
    await sheet.getByLabel("Чому списуємо").fill("виїхала");
    for (const part of [
      sheet.getByRole("heading", { name: "Списати борг" }),
      sheet.getByText(/^Борг 1\s234,56/),
      sheet.getByRole("button", { name: "Так, списати 1 234,56 грн" }),
      sheet.getByRole("button", { name: "Скасувати" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({
      path: `test-results/credits-write-off-${name}.png`,
    });
  });

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme a debt's goods and a payment's result read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await serveDebt(page, debt());
    await opened(page, theme);
    const more = page.locator(".more-goods");
    expect(await contrast(more)).toBeGreaterThanOrEqual(4.5);
    await more.click();
    expect(
      await contrast(page.locator(".debt-goods li").first()),
    ).toBeGreaterThanOrEqual(4.5);
    await deposit(page).click();
    await keyIn(page, "400");
    await panel(page).getByRole("button", { name: "Картка" }).click();
    const paid = page.locator(".paid-result");
    for (const part of [
      paid.getByRole("heading"),
      paid.locator(".way-pill"),
      paid.locator(".hand-back-sum .sum"),
      paid.getByText(/^Залишок боргу /),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/credits-paid-${name}.png` });
  });

test("a payment and a write-off sent: the pressed one turns its ring, the payment's other ways step back, past 3 s «Ще надсилаємо…» over them, and nothing kept is shown («Усе на бірці» task list, P0-2)", async ({
  page,
}) => {
  await page.clock.install();
  const one = debt();
  await serveDebt(page, one);
  let answer: (() => void) | undefined;
  const held = new Promise<void>((done) => {
    answer = done;
  });
  await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
    const body = route.request().postDataJSON() as { amount: string };
    await held;
    await route.fulfill({
      status: 201,
      json: {
        ...one,
        paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
      },
    });
  });
  await opened(page);
  await deposit(page).click();
  await keyIn(page, "400");
  const card = panel(page).getByRole("button", { name: "Картка", exact: true });
  await card.click();
  await expect(card).toHaveClass(/\bpressed\b/);
  await expect(card.locator(".eyelet-spin")).toHaveCount(1);
  for (const way of ["Готівка", "Переказ"])
    await expect(
      panel(page).getByRole("button", { name: way, exact: true }),
    ).toHaveClass(/\bstepped-back\b/);
  await page.clock.runFor(2_900);
  await expect(page.getByText("Ще надсилаємо…")).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Ще надсилаємо…" }),
  ).toBeVisible();
  await expect(page.locator(".stub-kept, .banner-kept")).toHaveCount(0);
  answer?.();
  const paid = page.locator(".paid-result");
  await expect(
    paid.getByRole("heading", { name: "Внесок записано" }),
  ).toBeVisible();
  await expect(paid.locator(".stub")).toHaveClass(/\bstub-recorded\b/);
  await expect(page.locator(".eyelet-spin, .sending-line")).toHaveCount(0);

  // The write-off: its own button turns its ring.
  let written: (() => void) | undefined;
  const writing = new Promise<void>((done) => {
    written = done;
  });
  await page.route(`**/api/v1/credits/${one.id}/write-off`, async (route) => {
    await writing;
    await route.fulfill({
      json: { ...one, status: "WRITTEN_OFF", owed: "0.00" },
    });
  });
  await paid
    .getByRole("button", { name: "Оксана Петренко", exact: true })
    .click();
  await page.getByRole("button", { name: "Дії з боргом" }).click();
  // A sheet takes taps a moment after it rises.
  await page.clock.runFor(800);
  await page.getByRole("button", { name: "Списати борг" }).click();
  await page.clock.runFor(800);
  await page.getByLabel("Чому списуємо").fill("виїхала");
  const writeOff = page.getByRole("button", { name: /^Так, списати / });
  await writeOff.click();
  await expect(writeOff).toHaveClass(/\bpressed\b/);
  await expect(writeOff.locator(".eyelet-spin")).toHaveCount(1);
  await expect(page.locator(".stub-kept, .banner-kept")).toHaveCount(0);
  written?.();
  await expect(
    page.locator(".paid-result").getByRole("heading", { name: "Борг списано" }),
  ).toBeVisible();
  await expect(page.locator(".eyelet-spin")).toHaveCount(0);
});

test("the owner erases a closed debt's customer behind the ⋯: outside Telegram a sheet, its words, and the debt kept with every sum", async ({
  page,
}) => {
  const one = debt({
    status: "SETTLED",
    owed: "0.00",
    paid: "2500.00",
    closed_at: `${String(thisYear)}-10-14T09:00:00Z`,
  });
  await serveDebt(page, one);
  const sent: unknown[] = [];
  await page.route(
    `**/api/v1/credits/${one.id}/erase-customer`,
    async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          erased: 1,
          still_open: 1,
          network: false,
          credit: {
            ...one,
            customer_name: null,
            customer_phone: null,
            customer_erased_at: `${String(thisYear)}-10-20T09:00:00Z`,
          },
        },
      });
    },
  );
  await opened(page);
  await act(page, "Стерти дані покупця");
  const sheet = page.getByRole("dialog", { name: "Стерти дані покупця?" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet
    .getByRole("button", { name: "Так, стерти дані покупця", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Дані покупця стерто із закритих боргів цього магазину: 1.",
  );
  expect(sent).toEqual([{}]);
});

test("inside a Telegram that has its own popup, «Стерти дані покупця» asks there — «Так, стерти дані покупця» the destructive one — and only that erases (spec S20)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data?: string) => void;
      };
      popups: unknown[];
    };
    host.popups = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_open_popup" && data)
          host.popups.push(JSON.parse(data));
      },
    };
  });
  const one = debt({
    status: "SETTLED",
    owed: "0.00",
    paid: "2500.00",
    closed_at: `${String(thisYear)}-10-14T09:00:00Z`,
  });
  await serveDebt(page, one);
  const sent: unknown[] = [];
  await page.route(
    `**/api/v1/credits/${one.id}/erase-customer`,
    async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          erased: 1,
          still_open: 1,
          network: false,
          credit: {
            ...one,
            customer_name: null,
            customer_phone: null,
            customer_erased_at: `${String(thisYear)}-10-20T09:00:00Z`,
          },
        },
      });
    },
  );
  const popups = (): Promise<unknown[]> =>
    page.evaluate(() => (window as unknown as { popups: unknown[] }).popups);
  const closed = async (button?: string): Promise<void> => {
    await page.evaluate((id) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            eventType: "popup_closed",
            eventData: id === undefined ? {} : { button_id: id },
          }),
          source: window.parent,
        }),
      );
    }, button);
  };
  const asked = {
    title: "Стерти дані покупця?",
    message:
      "Ім’я й телефон покупця зникнуть з усіх закритих боргів цього магазину з цим телефоном. Суми лишаються. Скасувати це не можна.",
    buttons: [
      { id: "keep", type: "default", text: "Скасувати" },
      {
        id: "erase",
        type: "destructive",
        text: "Так, стерти дані покупця",
      },
    ],
  };
  await opened(page, undefined, "7.0");
  await act(page, "Стерти дані покупця");
  await expect.poll(popups).toEqual([asked]);
  // Asked there, not in the page.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await closed("keep");
  await page.waitForTimeout(300);
  expect(sent).toEqual([]);
  // Closed without a button: nothing either.
  await act(page, "Стерти дані покупця");
  await expect.poll(popups).toEqual([asked, asked]);
  await closed();
  await page.waitForTimeout(300);
  expect(sent).toEqual([]);
  await act(page, "Стерти дані покупця");
  await expect.poll(popups).toEqual([asked, asked, asked]);
  await closed("erase");
  await expect(page.getByRole("status")).toContainText(
    "Дані покупця стерто із закритих боргів цього магазину: 1.",
  );
  expect(sent).toEqual([{}]);
});

test("written off on her card, «Внесок» waits while the card is read again: nothing is paid on what was owed before (review, 2026-11-01)", async ({
  page,
}) => {
  const one = debt();
  await serve(page, one);
  const done = {
    ...one,
    status: "WRITTEN_OFF",
    owed: "0.00",
    written_off: one.owed,
    closed_at: `${String(thisYear)}-10-16T09:00:00Z`,
  };
  await page.route(`**/api/v1/credits/${one.id}/write-off`, async (route) => {
    await route.fulfill({ json: done });
  });
  // Once written off, the card's read waits.
  let written = false;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const asked = new URL(route.request().url()).searchParams;
    if (!written || asked.get("store_id") !== fixture.store_id) {
      await route.fallback();
      return;
    }
    await held;
    await route.fulfill({
      json: {
        items: [
          {
            phone_digits: "0671234567",
            customer_name: one.customer_name,
            customer_phone: one.customer_phone,
            owed: "0.00",
            open_debts: 0,
            credits: [done],
          },
        ],
        has_more: false,
      },
    });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Покупці");
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  const pay = deposit(page);
  await expect(pay).toBeEnabled();
  await act(page, "Списати борг");
  const sheet = page.getByRole("dialog", { name: "Списати борг" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await page.getByLabel("Чому списуємо").fill("виїхала");
  written = true;
  await sheet.getByRole("button", { name: /^Так, списати / }).click();
  await expect(page.getByRole("status")).toContainText("Борг списано");
  await expect(pay).toBeDisabled();
  release();
  await expect(pay).toHaveCount(0);
  await expect(page.locator(".customer-debt .sticker")).toHaveText("Списано");
});

test("the owner's ⋯ open on her card when it is read again into two debts: the sheet goes with it, and Telegram's «Внесок» comes back (review, 2026-11-01)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data?: string) => void;
      };
      mains: unknown[];
    };
    host.mains = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_main_button" && data)
          host.mains.push(JSON.parse(data));
      },
    };
  });
  const one = debt();
  const scarf = aside();
  await serve(page, one);
  // Read again — Telegram back in front — a second debt of hers has come.
  let two = false;
  await page.route("**/api/v1/credits/customers?**", async (route) => {
    const asked = new URL(route.request().url()).searchParams;
    if (!two || asked.get("store_id") !== fixture.store_id) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        items: [
          {
            phone_digits: "0671234567",
            customer_name: one.customer_name,
            customer_phone: one.customer_phone,
            owed: (Number(one.owed) + Number(scarf.owed)).toFixed(2),
            open_debts: 2,
            credits: [one, scarf],
          },
        ],
        has_more: false,
      },
    });
  });
  const main = (): Promise<unknown> =>
    page.evaluate(() =>
      (window as unknown as { mains: unknown[] }).mains.at(-1),
    );
  await page.goto(launch(undefined, "7.0"));
  await openStore(page, "Основний MAIN");
  await toTill(page);
  await section(page, "Покупці");
  await page.getByRole("button", { name: /^Відкрити борг: Оксана/ }).click();
  await expect(
    page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
  ).toBeVisible();
  await expect.poll(main).toMatchObject({ is_visible: true, text: "Внесок" });
  await page.getByRole("button", { name: "Дії з боргом" }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("data-ready", "");
  await expect.poll(main).toMatchObject({ is_visible: false });
  two = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page
      .getByRole("list", { name: "Борги в магазині «Основний»" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(main).toMatchObject({ is_visible: true, text: "Внесок" });
});

test.describe("«Продаж» › «Внесок»: a payment on a debt from the till, its sum on the app's keypad («Усе на бірці» task list, P0-3; spec S08, S21, S22)", () => {
  /** «Продаж», its «Внесок» way, and the store's debtors under «Продаж». */
  async function atTheTill(
    page: Page,
    theme?: Record<string, string>,
  ): Promise<void> {
    await page.goto(launch(theme));
    await openStore(page, "Основний MAIN");
    await toTill(page);
    await tillWays(page)
      .getByRole("button", { name: "Внесок", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 1 }),
    ).toBeVisible();
  }

  /** A debt of one coat: 3 000, 1 000 paid, 2 000 owed. */
  function coat(extra: Record<string, unknown> = {}): Debt {
    return debt({
      goods: ["Лоран шоколад · M"],
      paid: "1000.00",
      returned: "0.00",
      cash_back: "0.00",
      owed: "2000.00",
      entries: [],
      ...extra,
    });
  }

  /** The customer as `GET /credits/customers` answers them, owing `owed`
   * the store in all. */
  function customerOf(one: Debt, owed: string): Record<string, unknown> {
    return {
      phone_digits: "0671234567",
      customer_name: one.customer_name,
      customer_phone: one.customer_phone,
      owed,
      open_debts: 1,
      credits: [one],
    };
  }

  test("«Внесок»'s field is the till's: where «Знайти модель» stood, 52 high, its name heard, the magnifier, «×» emptying it with the cursor kept (audit after stage 2, sale P1-1)", async ({
    page,
  }) => {
    await serve(page, coat());
    // The till sells from its one warehouse, which has its goods: its
    // search stands under the switch, nothing said over it.
    await page.route("**/api/v1/stock-locations?**", async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as { id: string }[];
      await route.fulfill({
        response,
        json: rows
          .filter((row) => row.id === fixture.till_location_id)
          .map((row) => ({
            ...row,
            is_active: true,
            can_sell: true,
            awaiting_first_stock: false,
          })),
      });
    });
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(launch());
    await openStore(page, "Основний MAIN");
    await toTill(page);
    const tillSearch = page.getByRole("searchbox", { name: "Знайти модель" });
    await expect(tillSearch).toBeVisible();
    const tillField = await tillSearch.boundingBox();
    await tillWays(page)
      .getByRole("button", { name: "Внесок", exact: true })
      .click();
    // Switching moves nothing under the finger.
    const search = page.getByRole("searchbox", { name: "Ім’я або телефон" });
    await expect(search).toBeVisible();
    const box = await search.boundingBox();
    if (!tillField || !box) throw new Error("not laid out");
    expect(Math.round(box.y)).toBe(Math.round(tillField.y));
    expect(box.height).toBe(tillField.height);
    expect(box.height).toBe(52);
    await expect(search).toHaveAttribute("placeholder", "Ім’я або телефон");
    await expect(page.locator(".credits .search-field svg.icon")).toBeVisible();
    await search.fill("Окс");
    await page.getByRole("button", { name: "Очистити пошук" }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
  });

  test("S21 at 360 × 640: who and where the header's one line, and «Винні» with what is owed over the dock unscrolled, its keys 44 at least (audit after stage 2, sale P1-3)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await serve(page, coat());
    await atTheTill(page);
    await page
      .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Лоран шоколад · M",
    );
    // One line under the title: the debt's, in the store's and the
    // person's place.
    const line = page.locator(".store-line");
    await expect(line).toHaveCount(1);
    await expect(line.locator(".t-meta")).toHaveText(
      "Оксана Петренко · «Основний» · з 01.10",
    );
    await expect(page.locator(".debt-context")).toHaveCount(0);
    // As it opened: nothing scrolled, what is owed over the dock.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const owed = page.getByRole("group", { name: "Скільки винні" });
    const what = await owed.locator(".owed-what").boundingBox();
    const sum = await owed.locator(".owed-sum").boundingBox();
    const dock = await page.locator(".till-dock").boundingBox();
    if (!what || !sum || !dock) throw new Error("not laid out");
    expect(what.y).toBeGreaterThanOrEqual(0);
    expect(sum.y + sum.height).toBeLessThanOrEqual(dock.y);
    await page.screenshot({ path: "test-results/debt-till-360x640.png" });
    // Its keys 44 on a short phone, never less, and the sum's field 64, as
    // the cash count's (spec §6.25).
    await expect(page.locator(".till-dock .keypad-sum")).toHaveCSS(
      "height",
      "64px",
    );
    // «Винні» and the sum one line in money-l (32/34), the TZ's fallback.
    await expect(owed.locator(".owed-sum .sum")).toHaveCSS("font-size", "32px");
    for (const each of await page.locator(".keypad-key").all()) {
      const box = await each.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("three taps from the till — «Внесок», the row, a way: S21 names the goods, the menu steps aside, the sum is keyed in, and S22's stub says what the customer owes the store in all", async ({
    page,
  }) => {
    const one = coat();
    // The customer's other debt here: 1 000 more, so the store's total is
    // never this debt's own.
    let inAll = "3000.00";
    const sent = await serve(page, one, (body) => {
      inAll = "1500.00";
      return {
        ...one,
        paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
        owed: "500.00",
      };
    });
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      await route.fulfill({
        json: { items: [customerOf(one, inAll)], has_more: false },
      });
    });
    await atTheTill(page);
    await expect(
      tillWays(page).getByRole("button", { name: "Внесок", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    // The till's list is a store's screen: «Змінити магазин» on its line.
    const change = page
      .locator(".store-line")
      .getByRole("button", { name: "Змінити магазин" });
    await expect(change).toBeEnabled();
    await page
      .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
      .click();

    // S21: what she took for a title, who and where under it; the menu out
    // of the way.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Лоран шоколад · M",
    );
    await expect(page.locator(".store-line .t-meta")).toHaveText(
      "Оксана Петренко · «Основний» · з 01.10",
    );
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toHaveCount(0);
    // Nor another store from the header: «←» is S21's only way out (review,
    // 2026-10-29), and a task's screen has no «Змінити магазин» at all
    // (audit 2026-11-13, frame P2-1; before, it stood held).
    await expect(change).toHaveCount(0);
    const owed = page.getByRole("group", { name: "Скільки винні" });
    await expect(owed.locator(".owed-what")).toHaveText("Винні");
    await expect(owed.locator(".owed-what svg")).toHaveCount(1);
    await expect(owed.locator(".owed-sum")).toHaveText("2 000,00 грн");
    await expect(owed.locator(".owed-count")).toHaveText(
      "Сплачено 1 000,00 грн з 3 000,00 грн · останній внесок 12.10",
    );
    await onPaper(page, "S21");
    // No write-off nor erasing here: they are the debt's from «Покупці».
    await expect(
      page.getByRole("button", { name: "Списати борг" }),
    ).toHaveCount(0);
    // The phone's keyboard never opens over the ways.
    const sum = page.getByLabel("Сума, грн");
    await expect(sum).toHaveAttribute("inputmode", "none");
    for (const way of ["Готівка", "Картка", "Переказ"])
      await expect(panel(page).getByRole("button", { name: way })).toBeDisabled();
    await keyIn(page, "1500");
    await expect(sum).toHaveValue(/^1\s500$/);
    await panel(page).getByRole("button", { name: "Готівка" }).click();

    // S22: the stub torn off, what is left on this debt, and on them all.
    const paid = page.locator(".paid-result");
    await expect(
      paid.getByRole("heading", { name: "Внесок записано" }),
    ).toBeFocused();
    await expectStub(paid, {
      way: "Готівка",
      say: "У касу",
      sum: "1 500,00 грн",
    });
    await expect(paid.locator(".stub")).toHaveClass(/\bstub-recorded\b/);
    await onPaper(page, "S22");
    await expect(
      paid.getByText("Залишок боргу 500,00 грн", { exact: true }),
    ).toBeVisible();
    await expect(paid.locator(".paid-total")).toHaveText(
      "Усього винні магазину «Основний» 1 500,00 грн",
    );
    // The task done, the menu is back.
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toBeVisible();
    expect(sent).toEqual([
      expect.objectContaining({ amount: "1500.00", payment_method: "CASH" }),
    ]);

    // «Відкрити борг»: S21 again, with what is left, the menu aside again.
    await page
      .getByRole("button", { name: "Відкрити борг", exact: true })
      .click();
    await expect(page.locator(".owed-sum")).toHaveText("500,00 грн");
    await expect(page.getByLabel("Сума, грн")).toHaveValue("");
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toHaveCount(0);
  });

  /** Her two debts here — the coat, 2 000 owed; the scarf, 500 — as the
   * till's list and the sheet's read by her phone answer them; `byPhone`
   * answers the sheet's own read instead, once given, and the list no
   * longer has her once `listed` says so. */
  async function serveTwo(
    page: Page,
    one: Debt,
    byPhone?: (route: Route) => Promise<void>,
    listed: () => boolean = () => true,
  ): Promise<void> {
    const other = aside();
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("store_id") !== fixture.store_id) {
        await route.fulfill({ json: { items: [], has_more: false } });
        return;
      }
      if (byPhone && url.searchParams.get("limit") === "5") {
        await byPhone(route);
        return;
      }
      if (!listed()) {
        await route.fulfill({ json: { items: [], has_more: false } });
        return;
      }
      await route.fulfill({
        json: {
          items: [
            {
              ...customerOf(one, "2500.00"),
              open_debts: 2,
              credits: [one, other],
            },
          ],
          has_more: false,
        },
      });
    });
  }

  test("her two debts at the till: «На який борг вносить?» a sheet over the list, as on her card — four taps, «Внесок», her row, a debt, a way; who and what she owes here one line under its title; none chosen; «← До боргів» back to the list (audit after stage 2, sale P2-4)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const one = coat();
    const sent = await serve(page, one, (body) => ({
      ...one,
      paid: (Number(one.paid) + Number(body.amount)).toFixed(2),
      owed: "500.00",
    }));
    await serveTwo(page, one);
    // One: «Внесок».
    await atTheTill(page);
    const her = page.getByRole("button", {
      name: /^Відкрити борг: Оксана Петренко,/,
    });
    // Two: her row.
    await her.click();
    const which = page.getByRole("dialog", { name: "На який борг вносить?" });
    await expect(which).toHaveAttribute("data-ready", "");
    // Over the list, never instead of it: the till stays under it.
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 1 }),
    ).toBeAttached();
    await expect(her).toBeAttached();
    // Who, and what she owes this store in all — the server's sum — one
    // line, read with the title; no card of its own, no phone to call:
    // she is at the counter.
    const line = "Оксана Петренко · винні всього 2 500,00 грн";
    await expect(which.locator(".debts-line")).toHaveText(line);
    await expect(which).toHaveAccessibleDescription(line);
    await expect(page.locator(".owed-card")).toHaveCount(0);
    await expect(which.locator('a[href^="tel:"]')).toHaveCount(0);
    const debts = which
      .getByRole("list", { name: "Борги: Оксана Петренко" })
      .getByRole("button");
    await expect(debts).toHaveCount(2);
    await expect(debts.nth(0)).toHaveAccessibleName(
      "Лоран шоколад · M, винні 2 000,00 грн",
    );
    await expect(debts.nth(1)).toHaveAccessibleName(
      "Шарф «Затишок», винні 500,00 грн",
    );
    // Its rows the card's sheet's: the debt's glyph by what is owed, the
    // set's chevron, no block of their own.
    await expect(which.locator(".debt-owed svg")).toHaveCount(2);
    await expect(which.locator("svg.sale-open")).toHaveCount(2);
    await expect(which.locator(".list-block")).toHaveCount(0);
    // None chosen beforehand (owner decision, 2026-10-01): the sheet holds
    // the cursor, no debt does.
    await expect(which).toBeFocused();
    await expect(
      which.locator("[aria-pressed], [aria-current], [aria-selected]"),
    ).toHaveCount(0);
    // A sheet by §6.29: the card's colour, 16 round on top, at most 92 %
    // of the screen, nothing past its width — in both themes.
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const card = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.background = "var(--card)";
        document.body.append(probe);
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return colour;
      });
      await expect(which).toHaveCSS("background-color", card);
      // The line in pencil, under the title.
      const pencil = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.color = "var(--pencil)";
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      });
      await expect(which.locator(".debts-line")).toHaveCSS("color", pencil);
      await expect(which).toHaveCSS("border-top-left-radius", "16px");
      await expect(which).toHaveCSS("border-bottom-left-radius", "0px");
      const box = await which.boundingBox();
      if (!box) throw new Error("not laid out");
      expect(box.height).toBeLessThanOrEqual(640 * 0.92 + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
    await page.emulateMedia({ colorScheme: "light" });

    // Three: the coat's debt. The sheet is done with; S21 on it, and its
    // «←» the till's «До боргів» — back to the list, the sheet closed.
    await debts.nth(0).click();
    await expect(which).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Лоран шоколад · M",
    );
    await page.getByRole("button", { name: "До боргів" }).click();
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(her).toBeVisible();
    // Again: her row, the coat, the sum keyed in, and four: a way.
    await her.click();
    await expect(which).toHaveAttribute("data-ready", "");
    await debts.nth(0).click();
    await keyIn(page, "1500");
    await panel(page).getByRole("button", { name: "Готівка" }).click();
    const paid = page.locator(".paid-result");
    await expect(
      paid.getByRole("heading", { name: "Внесок записано" }),
    ).toBeFocused();
    expect(sent).toEqual([
      expect.objectContaining({ amount: "1500.00", payment_method: "CASH" }),
    ]);
    // S22's way back is named as S21's «←»: the list, no sheet over it.
    await paid
      .getByRole("button", { name: "До боргів", exact: true })
      .click();
    await expect(her).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the sheet reads her debts by her phone: refused, it says so over the rows as they were, «Спробувати ще раз» its one way; read again and gone, it closes on the list, which is read again without her (audit after stage 2, sale P2-4; review)", async ({
    page,
  }) => {
    const one = coat();
    await serve(page, one);
    let reads = 0;
    let paidOff = false;
    const asked: (string | null)[] = [];
    await serveTwo(
      page,
      one,
      async (route) => {
        reads += 1;
        asked.push(new URL(route.request().url()).searchParams.get("status"));
        // Paid off meanwhile on another phone, from the second read on.
        paidOff = reads > 1;
        await route.fulfill(
          reads === 1
          ? {
              status: 500,
              json: {
                code: "INTERNAL_ERROR",
                message: "Внутрішня помилка сервера.",
                details: {},
              },
            }
            : { json: { items: [], has_more: false } },
        );
      },
      () => !paidOff,
    );
    await atTheTill(page);
    const her = page.getByRole("button", {
      name: /^Відкрити борг: Оксана Петренко,/,
    });
    await her.click();
    const which = page.getByRole("dialog", { name: "На який борг вносить?" });
    const unread = which.locator(".read-failure");
    await expect(unread).toBeVisible();
    await expect(which.locator(".debts-line")).toHaveText(
      "Оксана Петренко · винні всього 2 500,00 грн",
    );
    await expect(which.getByRole("listitem")).toHaveCount(2);
    // Once the sheet takes taps: the second of the one that opened it is
    // let go.
    await expect(which).toHaveAttribute("data-ready", "");
    await unread.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect(which).toHaveCount(0);
    // The list under it read again: her row goes with the sheet, never a
    // row that opens nothing (review).
    await expect(her).toHaveCount(0);
    // Only what is still owed, as the till's list reads them.
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((status) => status === "OPEN")).toBe(true);
  });

  test("among the stores that do not trade, the sheet names her alone, never a sum: each debt its own store's, said on its row (audit after stage 2, sale P2-4; sections task list, P0-5)", async ({
    page,
  }) => {
    // «Ринок», blocked: its debts are paid at any store that trades.
    const market = {
      store_id: randomUUID(),
      store_name: "Ринок",
      store_state: "BLOCKED",
    };
    const first = coat(market);
    const debts = [first, { ...aside(), ...market }];
    await serve(page, coat());
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      const url = new URL(route.request().url());
      const elsewhere = url.searchParams.get("elsewhere") === "true";
      await route.fulfill({
        json: {
          items: elsewhere
            ? [
                {
                  ...customerOf(first, "2500.00"),
                  open_debts: 2,
                  credits: debts,
                },
              ]
            : [],
          has_more: false,
        },
      });
    });
    await atTheTill(page);
    const search = page.getByRole("searchbox", { name: "Ім’я або телефон" });
    await search.fill("0671234567");
    await page
      .getByRole("button", {
        name: "Борг магазину, що зараз не працює? Шукати за цим номером",
      })
      .click();
    await page
      .getByRole("button", { name: /^Відкрити борг: Оксана Петренко,/ })
      .click();
    const which = page.getByRole("dialog", { name: "На який борг вносить?" });
    await expect(which.locator(".debts-line")).toHaveText("Оксана Петренко");
    await expect(which).not.toContainText("винні всього");
    const rows = which.getByRole("button");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAccessibleName(
      "Лоран шоколад · M, винні 2 000,00 грн, магазин «Ринок»",
    );
    await expect(rows.nth(1)).toContainText("Магазин «Ринок»");
  });

  test("more than is owed darkens the ways and says so in the error's colour, and nothing is sent; the keypad keeps a sum to the kopeck", async ({
    page,
  }) => {
    const sent = await serve(page, coat());
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    const sum = page.getByLabel("Сума, грн");
    await keyIn(page, "2500");
    const over = page.getByRole("alert");
    await expect(over).toHaveText(
      "Це більше, ніж винні: залишок боргу 2 000,00 грн.",
    );
    await expect(over).toHaveCSS(
      "color",
      await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--danger)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }),
    );
    await expect(sum).toHaveAttribute("aria-invalid", "true");
    for (const way of ["Готівка", "Картка", "Переказ"])
      await expect(panel(page).getByRole("button", { name: way })).toBeDisabled();
    // One figure off: under the debt, the ways back, the line gone.
    await key(page, "Стерти").click();
    await expect(sum).toHaveValue("250");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: "Картка" }),
    ).toBeEnabled();
    // At most two figures after the comma; a leading zero dropped; a comma
    // first is «0,».
    await key(page, "Стерти").click();
    await key(page, "Стерти").click();
    await key(page, "Стерти").click();
    await keyIn(page, "05,505");
    await expect(sum).toHaveValue("5,50");
    // ⌫ held clears the sum.
    await key(page, "Стерти").hover();
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await expect(sum).toHaveValue("");
    // A touch held to its end often sends no click: a later press of
    // «Стерти», from a keyboard, still deletes (review, 2026-10-29).
    const erase = key(page, "Стерти");
    await erase.dispatchEvent("pointerdown");
    await page.waitForTimeout(800);
    await erase.dispatchEvent("pointerup");
    await expect(sum).toHaveValue("");
    await sum.pressSequentially("12");
    await page.waitForTimeout(600);
    await erase.focus();
    await page.keyboard.press("Enter");
    await expect(sum).toHaveValue("1");
    // What a key made of the sum is said: the key keeps the focus.
    await expect(page.locator(".keypad [aria-live]")).toHaveText(
      "Сума, грн: 1",
    );
    await erase.click();
    await keyIn(page, ",5");
    await expect(sum).toHaveValue("0,5");
    // The whole debt in one tap.
    await page
      .getByRole("button", { name: "Увесь залишок 2 000,00 грн" })
      .click();
    await expect(sum).toHaveValue(/^2\s000,00$/);
    // A computer's keyboard still types into the sum, in the keypad's
    // terms.
    await sum.fill("");
    await sum.pressSequentially("12a3,456");
    await expect(sum).toHaveValue("123,45");
    expect(sent).toHaveLength(0);
  });

  test("a debt lowered on another phone meanwhile: the server's refusal in the debt's words, and the debt read again", async ({
    page,
  }) => {
    const one = coat();
    await serve(page, one);
    const now = { ...one, paid: "2500.00", owed: "500.00" };
    await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
      await route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "More than owed",
          details: { reason: "MORE_THAN_OWED", owed: "500.00" },
        },
      });
    });
    await page.route(`**/api/v1/credits/${one.id}`, async (route) => {
      await route.fulfill({ json: now });
    });
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await keyIn(page, "1000");
    await panel(page).getByRole("button", { name: "Картка" }).click();
    // The server's words alone, in view above the dock: the sum still
    // keyed in is over the debt read again, and said once.
    const told = page.getByRole("alert");
    await expect(told).toHaveText(
      "Це більше, ніж винні: залишок боргу 500,00 грн. Прийміть 500,00 грн, а решту поверніть покупцю на картку через термінал.",
    );
    await expect(told).toBeInViewport();
    await expect(page.locator(".owed-sum")).toHaveText("500,00 грн");
    await expect(page.locator(".paid-result")).toHaveCount(0);
    for (const way of ["Готівка", "Картка", "Переказ"])
      await expect(panel(page).getByRole("button", { name: way })).toBeDisabled();
    // The whole of what is left now: the refusal goes, and the ways are back.
    await page
      .getByRole("button", { name: "Увесь залишок 500,00 грн" })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: "Картка" }),
    ).toBeEnabled();
  });

  test("S21 at its full height says «Винні» as a debt's own screen — the glyph and the word in the debt's colour, what is owed in money-xl; written off meanwhile, its «Списано» in `offline`'s grey (audit 2026-11-13, sale P2-4, P2-5; review)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const one = coat();
    await serve(page, one);
    await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
      await route.fulfill({
        status: 409,
        json: { code: "CONFLICT", message: "Credit changed", details: {} },
      });
    });
    // Read again after the refusal: written off on another phone.
    await page.route(`**/api/v1/credits/${one.id}`, async (route) => {
      await route.fulfill({
        json: {
          ...one,
          status: "WRITTEN_OFF",
          owed: "0.00",
          written_off: one.owed,
          closed_at: `${String(thisYear)}-10-16T09:00:00Z`,
        },
      });
    });
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    const debtColour = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--debt)";
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    });
    const what = page.locator(".debt-till .owed-what");
    await expect(what).toHaveText("Винні");
    await expect(what.locator("svg.icon")).toHaveCount(1);
    await expect(what).toHaveCSS("color", debtColour);
    const sum = page.locator(".debt-till .owed-sum .sum");
    await expect(sum).toHaveCSS("font-size", "56px");
    await expect(sum).toHaveCSS("line-height", "56px");
    await keyIn(page, "500");
    await panel(page).getByRole("button", { name: "Готівка" }).click();
    await expect(page.getByRole("alert")).toContainText("Внесок не записано.");
    const closed = page.locator(".debt-till .debt-closed .sticker");
    await expect(closed).toHaveText("Списано");
    await expect(closed).toHaveClass("sticker tone-offline");
  });

  test("paid off in full, the stub is knotted and names no total the customer no longer owes", async ({
    page,
  }) => {
    const one = coat();
    let inAll = "2000.00";
    await serve(page, one, () => {
      inAll = "0.00";
      return {
        ...one,
        status: "SETTLED",
        paid: "3000.00",
        owed: "0.00",
        closed_at: `${String(thisYear)}-10-20T10:00:00Z`,
      };
    });
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      await route.fulfill({
        json: { items: [customerOf(one, inAll)], has_more: false },
      });
    });
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await page
      .getByRole("button", { name: "Увесь залишок 2 000,00 грн" })
      .click();
    await panel(page).getByRole("button", { name: "Переказ" }).click();
    const paid = page.locator(".paid-result");
    await expect(paid.locator(".stub")).toHaveClass(/\bstub-settled\b/);
    await expect(paid.locator(".stub > .eyelet")).toHaveClass(
      /\beyelet-knot\b/,
    );
    await expect(
      paid.getByText("Борг сплачено повністю.", { exact: true }),
    ).toBeVisible();
    // Read, and nothing owed: no line, and no place left for one.
    await expect(paid.locator(".paid-total")).toHaveCount(0);
  });

  test("a whole number that owes nothing here is asked of this person's other store: found, its row says «Внесок приймає «Другий»» and opens nothing; with no right there, the words as before", async ({
    page,
  }) => {
    const there = coat({
      store_id: fixture.second_store_id,
      store_name: "Другий",
    });
    const asked: string[] = [];
    await page.route("**/api/v1/credits/customers?**", async (route) => {
      const url = new URL(route.request().url());
      const store = url.searchParams.get("store_id");
      if (url.searchParams.get("query")) asked.push(store ?? "");
      await route.fulfill({
        json: {
          items:
            store === fixture.second_store_id && url.searchParams.get("query")
              ? [customerOf(there, "2000.00")]
              : [],
          has_more: false,
        },
      });
    });
    await atTheTill(page);
    await page.getByLabel("Ім’я або телефон").fill("067 123 45 67");
    const row = page
      .getByRole("list", { name: "Хто винен" })
      .getByRole("listitem");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Оксана Петренко");
    await expect(row).toContainText("Внесок приймає «Другий»");
    await expect(row).toContainText("2 000,00 грн");
    await expect(row.getByRole("button")).toHaveCount(0);
    // On a list's white block, as the store's own (audit after stage 2,
    // frame P2-2).
    expect(
      await page
        .getByRole("list", { name: "Хто винен" })
        .evaluate(
          (node) =>
            node.classList.contains("list-block") &&
            getComputedStyle(node).backgroundColor !== "rgba(0, 0, 0, 0)",
        ),
    ).toBe(true);
    expect(asked).toContain(fixture.second_store_id);

    // This person no longer takes payments there: nothing asked of it.
    await page.route("**/api/v1/me", async (route) => {
      const response = await route.fetch();
      const me = (await response.json()) as {
        stores: { id: string; permissions: string[] }[];
      };
      await route.fulfill({
        response,
        json: {
          ...me,
          stores: me.stores.map((store) =>
            store.id === fixture.store_id
              ? store
              : {
                  ...store,
                  permissions: store.permissions.filter(
                    (permission) => permission !== "sale:credit",
                  ),
                },
          ),
        },
      });
    });
    asked.length = 0;
    await page.goto("about:blank");
    await atTheTill(page);
    await page.getByLabel("Ім’я або телефон").fill("067 123 45 67");
    const none = page.locator(".orders-empty");
    await expectEmpty(none, "За цим номером у цьому магазині боргів немає.");
    await expect(none.locator(".t-meta")).toHaveText(
      "Внесок приймає магазин, де продали.",
    );
    await expect(page.getByText(/Внесок приймає «/)).toHaveCount(0);
    expect(asked).not.toContain(fixture.second_store_id);
  });

  test("the till's «Внесок» and «Ще» › «Покупці» are two screens: a stub left at the till is never «Покупці»'s, nor S21 opened there the till's (review, 2026-10-29; «Усе на бірці» task list, P0-4; sections task list, P0-5)", async ({
    page,
  }) => {
    await serve(page, coat());
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await keyIn(page, "500");
    await panel(page).getByRole("button", { name: "Картка" }).click();
    await expect(
      page.getByRole("heading", { name: "Внесок записано" }),
    ).toBeFocused();
    await section(page, "Покупці");
    await expect(
      page.getByRole("heading", { name: "Покупці", level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".paid-result")).toHaveCount(0);

    // And back: S21 opened from her card, with its sum keyed in, is
    // «Покупці»'s — left by its «←», back to her card.
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await page.getByRole("button", { name: "Внесок", exact: true }).click();
    await expect(panel(page)).toBeVisible();
    await keyIn(page, "300");
    await page
      .getByRole("button", { name: "Оксана Петренко", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Оксана Петренко", level: 1 }),
    ).toBeVisible();
    // The task left, the menu is back.
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toBeVisible();
    await section(page, "Продаж");
    await tillWays(page)
      .getByRole("button", { name: "Внесок", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 1 }),
    ).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Відкрити борг: / }),
    ).toBeVisible();
  });

  test("a payment whose answer is lost is kept over «Продаж» › «Внесок», and after a reload the till opens there", async ({
    page,
  }) => {
    const one = coat();
    await serve(page, one);
    await page.route(`**/api/v1/credits/${one.id}/payments`, async (route) => {
      await route.abort("connectionfailed");
    });
    await atTheTill(page);
    await page.getByRole("button", { name: /^Відкрити борг: / }).click();
    await keyIn(page, "700");
    await panel(page).getByRole("button", { name: "Готівка" }).click();
    const kept = page.locator(".stub-notice .stub-kept");
    await expect(
      kept.getByRole("heading", { name: "Внесок ще не підтверджено" }),
    ).toBeVisible();

    await page.goto("about:blank");
    await page.goto(launch());
    await openStore(page, "Основний MAIN");
    await expect(
      page.getByRole("heading", { name: "Продаж", level: 1 }),
    ).toBeVisible();
    await expect(
      tillWays(page).getByRole("button", { name: "Внесок", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page
        .locator(".stub-notice .stub-kept")
        .getByRole("heading", { name: "Внесок ще не підтверджено" }),
    ).toBeVisible();
    await expect(page.locator("section.banner-kept")).toHaveCount(0);
  });

  for (const [name, theme, scheme] of [
    ["light", { bg_color: "#ffffff", text_color: "#000000" }, "light"],
    ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }, "dark"],
  ] as const)
    test(`at 360 × 640 in the ${name} theme, S21's keypad and its three ways are in view without scrolling, and read at 4.5:1; its line one line, no «Змінити магазин» beside it (audit 2026-11-13, frame P2-1)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      await serve(page, coat());
      await atTheTill(page, theme);
      expect(
        await page.evaluate(() => document.documentElement.dataset.theme),
      ).toBe(scheme);
      await page.getByRole("button", { name: /^Відкрити борг: / }).click();
      // Who owes and where, the whole width: one line of the meta's 19 at
      // 360 — wider than the 186 left beside the button, where it took two.
      const line = page.locator(".store-line .t-meta");
      await expect(line).toHaveText("Оксана Петренко · «Основний» · з 01.10");
      await expect(
        page
          .locator(".store-line")
          .getByRole("button", { name: "Змінити магазин" }),
      ).toHaveCount(0);
      expect(
        await line.evaluate((node) => node.getBoundingClientRect().height),
      ).toBeLessThanOrEqual(19 * 1.5);
      expect(
        await line.evaluate((node) => node.getBoundingClientRect().width),
      ).toBeGreaterThan(186);
      await keyIn(page, "2500");
      for (const one of [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "Кома",
        "0",
        "Стерти",
      ])
        await expect(key(page, one)).toBeInViewport({ ratio: 1 });
      for (const way of ["Готівка", "Картка", "Переказ"])
        await expect(
          panel(page).getByRole("button", { name: way }),
        ).toBeInViewport({ ratio: 1 });
      await expect(page.getByLabel("Сума, грн")).toBeInViewport({ ratio: 1 });
      for (const part of [
        key(page, "5"),
        page.getByLabel("Сума, грн"),
        page.locator(".keypad-label"),
        page.getByRole("button", { name: /^Увесь залишок / }),
        page.getByRole("alert"),
      ])
        expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
      await key(page, "Стерти").click();
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      for (const part of [
        page.locator(".owed-sum"),
        page.locator(".owed-what"),
        page.locator(".store-line .t-meta"),
      ])
        expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: `test-results/debt-till-${name}.png` });
    });
});
