import {
  test,
  expect,
  countTaps,
  dockOnMenu,
  expectGlyphBeside,
  expectOwed,
  expectPlate,
  expectStub,
  fromPaper,
  menu,
  openStore,
  section,
  returnUnits,
  tillWays,
  toTill,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * One sale's return and its result in the new design (returns task list,
 * P0-3, P0-4, P0-5): tags whose units are counted with «−» and «+», nothing
 * preset; what comes back, its sum and the way under the thumb; and the
 * result in place of the form, its sum the server's. The sale, its way and
 * the return's answer are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  till_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

const DARK = { bg_color: "#17212b", text_color: "#f5f5f5" };
const LIGHT = { bg_color: "#ffffff", text_color: "#000000" };

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

interface Line {
  id: string;
  display_name: string;
  size: string;
  quantity: number;
  final_unit_price: string;
  refunded: number;
  back_to_sold_from: boolean;
}

function line(name: string, quantity = 2, refunded = 0): Line {
  return {
    id: randomUUID(),
    display_name: name,
    size: "M",
    quantity,
    final_unit_price: "3000.00",
    refunded,
    back_to_sold_from: true,
  };
}

/** One sale of this store's, its lines as given; how it was paid, as the
 * sale's own way says, or refused; and the return's answer, `answer`. */
async function oneSale(
  page: Page,
  lines: Line[],
  {
    way = "CASH",
    parts = false,
    firstDays,
    answer,
  }: {
    /** «NONE»: the sale suggests no way (G5). */
    way?: "CASH" | "CARD" | "TRANSFER" | "NONE" | "REFUSED";
    /** Paid in parts. */
    parts?: boolean;
    /** Typed from paper: the first days' (true) or an outage's (false). */
    firstDays?: boolean;
    answer?: (body: {
      lines: { sale_item_id: string; quantity: number; condition: string }[];
      payment_method?: string;
    }) => { status: number; json: unknown };
  } = {},
): Promise<{ sent: Record<string, unknown>[]; saleId: string }> {
  const saleId = randomUUID();
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/v1/sales?**", async (route) => {
    await route.fulfill({
      json: {
        sales: [
          {
            id: saleId,
            store_id: fixture.store_id,
            store_name: "Основний",
            sold_at: new Date().toISOString(),
            currency_code: "UAH",
            total: "6000.00",
            paid_in_parts: parts,
            outage:
              firstDays === undefined
                ? null
                : {
                    sold_by_user_id: null,
                    sold_by: null,
                    sold_at: null,
                    first_days: firstDays,
                  },
            items: lines.map((each) => ({
              ...each,
              source_location_id: fixture.till_location_id,
              line_total: "6000.00",
            })),
          },
        ],
        has_more: false,
      },
    });
  });
  await page.route("**/api/v1/cash/sales/*/method?**", async (route) => {
    if (way === "REFUSED") {
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    await route.fulfill({
      json: {
        sale_id: saleId,
        target: "SALE",
        target_id: saleId,
        amount_taken: "6000.00",
        method: way === "NONE" ? null : way,
        corrected: false,
        refund_method: way === "NONE" ? null : way,
        may_change: true,
      },
    });
  });
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    const body = route.request().postDataJSON() as Parameters<
      NonNullable<typeof answer>
    >[0];
    sent.push(body);
    const reply = answer?.(body) ?? {
      status: 201,
      json: refundOf(saleId, body.lines, body.payment_method ?? null),
    };
    await route.fulfill(reply);
  });
  return { sent, saleId };
}

/** The server's answer to a return of `lines`, at 3 000,00 грн a unit
 * unless `total` says otherwise. */
function refundOf(
  saleId: string,
  lines: { sale_item_id: string; quantity: number; condition: string }[],
  way: string | null,
  total?: string,
): Record<string, unknown> {
  const units = lines.reduce((n, each) => n + each.quantity, 0);
  return {
    id: randomUUID(),
    sale_id: saleId,
    store_id: fixture.store_id,
    taken_at_store_id: null,
    total_amount: total ?? `${String(units * 3000)}.00`,
    items: lines.map((each) => ({
      sale_item_id: each.sale_item_id,
      quantity: each.quantity,
      amount: `${String(each.quantity * 3000)}.00`,
      condition: each.condition,
      destination_location_id:
        each.condition === "INTACT" ? fixture.till_location_id : null,
      display_name: "Лоран шоколад · M",
    })),
    credit: null,
    payment_method: way,
  };
}

/** What /me says, with fewer rights in every store. */
async function without(page: Page, rights: string[]): Promise<void> {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => !rights.includes(p));
    await route.fulfill({ response, json: body });
  });
}

/** The sale opened from «Повернення»'s list, on a phone of 360 × 640. */
async function opened(
  page: Page,
  theme?: Record<string, string>,
  version?: string,
): Promise<void> {
  await page.setViewportSize({ width: 360, height: 640 });
  const asked = page.waitForResponse((r) =>
    r.url().includes("/api/v1/cash/sales/"),
  );
  await page.goto(launch(theme, version));
  await openStore(page, "Основний MAIN");
  await section(page, "Повернення");
  await page.getByRole("button", { name: /^Оформити повернення: / }).click();
  await asked;
}

/**
 * What the screen shows, counted as the task list counts it: the heading
 * and «← До списку» over it, the header's one line, each line of text, the paper switch, a tag's name and
 * meta, a whole «−/+» row as one, «Додати причину»; and the panel's lines,
 * its switch as one, its button.
 */
async function shown(page: Page): Promise<number> {
  return page
    .locator(
      [
        ".screen-header > .back",
        ".screen-title > *",
        ".store-line > .t-meta",
        "section > p",
        "fieldset > label.check",
        ".line-return > h3",
        ".line-return > p",
        ".return-step",
        ".add-reason",
        ".pay-panel > p",
        ".pay-panel > fieldset",
        ".pay-panel > button",
      ].join(", "),
    )
    .filter({ visible: true })
    .count();
}

/** Nothing wider than the screen. */
async function noSideScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
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

const panelOf = (page: Page): Locator =>
  page.getByRole("group", { name: "Повернення: сума і спосіб" });

/** One line whole on the screen and above the panel, never under it: the
 * panel stands over the page's foot (review, 2026-11-06). */
async function expectLineOverPanel(page: Page): Promise<void> {
  const row = page.locator(".line-return");
  await expect(row).toBeInViewport({ ratio: 1 });
  await expect(panelOf(page)).toBeInViewport({ ratio: 1 });
  await expect
    .poll(async () => {
      const line = await row.boundingBox();
      const under = await panelOf(page).boundingBox();
      return line && under ? line.y + line.height - under.y : Infinity;
    })
    .toBeLessThanOrEqual(1);
}

/** Telegram's «Назад» pressed. */
async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
}

/** What the app tells Telegram: its buzzes, and its «Назад» shown or not. */
async function hearTelegram(
  page: Page,
): Promise<() => Promise<{ buzzes: unknown[]; backs: boolean[] }>> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
      backs: boolean[];
    };
    host.buzzes = [];
    host.backs = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
        if (event === "web_app_setup_back_button")
          host.backs.push(
            (JSON.parse(data) as { is_visible: boolean }).is_visible,
          );
      },
    };
  });
  return () =>
    page.evaluate(() => {
      const host = window as unknown as { buzzes: string[]; backs: boolean[] };
      return {
        buzzes: host.buzzes.map((data) => JSON.parse(data) as unknown),
        backs: host.backs,
      };
    });
}

test("a sale's return is a task's screen: the menu aside, Telegram's «Назад» its «До списку»; its stickers with their glyphs, the two counts in one row felt as a light tap, the way's switch felt as a choice (stage 2, orders task list, P0-6, В-ЗП6 (а))", async ({
  page,
}) => {
  const heard = await hearTelegram(page);
  await oneSale(page, [line("Лоран шоколад", 1)], {
    parts: true,
    firstDays: false,
  });
  await opened(page, undefined, "8.0");
  await expect(page.getByRole("heading", { name: "Повернення" })).toBeVisible();
  // The menu steps aside, as on «Внесок» and the cash's count; Telegram's
  // «Назад» stands for «До списку».
  await expect(menu(page)).toBeHidden();
  await expect.poll(async () => (await heard()).backs.at(-1)).toBe(true);
  // Each sticker its glyph beside its words: never a colour alone.
  const marks = page.locator(".sale-marks");
  await expect(marks.locator(".sticker.tone-debt")).toHaveText(
    "Оплата частинами",
  );
  await expectGlyphBeside(marks.locator(".sticker.tone-debt"));
  await expect(marks.locator(".sticker.tone-warn")).toHaveText(
    "Продано під час збою",
  );
  await expectGlyphBeside(marks.locator(".sticker.tone-warn"));
  // «Цілі» and «Пошкоджені» side by side, «Пошкоджені» with «Брак»'s torn
  // tag, each «−» and «+» at least 44 square.
  const intact = page.locator(".return-step").first();
  const damaged = page.locator(".return-step.damaged");
  const left = await intact.boundingBox();
  const right = await damaged.boundingBox();
  if (!left || !right) throw new Error("not laid out");
  expect(Math.round(right.y)).toBe(Math.round(left.y));
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
  await expect(damaged.locator(".return-step-name svg.icon")).toHaveCount(1);
  await expect(intact.locator("svg.icon")).toHaveCount(0);
  for (const button of await page
    .locator(".return-step .stepper button")
    .all()) {
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // A count felt as the basket's: a light tap each.
  const before = (await heard()).buzzes.length;
  await page.getByRole("button", { name: "Цілі: більше" }).click();
  await page.getByRole("button", { name: "Цілі: менше" }).click();
  await page.getByRole("button", { name: "Пошкоджені: більше" }).click();
  await expect(page.locator(".return-step.damaged .return-count")).toHaveText(
    "1",
  );
  const light = { type: "impact", impact_style: "light" };
  expect((await heard()).buzzes.slice(before)).toEqual([light, light, light]);
  // The way's switch, a choice felt as one.
  await panelOf(page).getByRole("radio", { name: "На картку" }).check();
  expect((await heard()).buzzes.slice(before + 3)).toEqual([
    { type: "selection_change" },
  ]);
  // Telegram's «Назад»: the list, and the menu again.
  await pressBack(page);
  await expect(
    page.getByRole("searchbox", { name: "Що повертають?" }),
  ).toBeVisible();
  await expect(menu(page)).toBeVisible();
});

for (const [name, theme] of [
  ["light", LIGHT],
  ["dark", DARK],
] as const)
  test(`in the ${name} theme at 360 × 640 a return's stickers, its counts and a refusal's plate read at 4.5:1, its one line and the panel in view without a scroll (stage 2, orders task list, P0-6)`, async ({
    page,
  }) => {
    const { sent } = await oneSale(page, [line("Лоран шоколад", 1)], {
      parts: true,
      firstDays: true,
      answer: () => ({
        status: 409,
        json: {
          code: "DAMAGED_RETURNS_UNAVAILABLE",
          message: "The store has no «Брак» warehouse to take damaged goods",
          details: { reason: "NOT_SET_UP" },
        },
      }),
    });
    await opened(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(name);
    await expect(page.locator(".sale-marks .sticker.tone-warn")).toHaveText(
      "Продано з паперу",
    );
    await page.getByRole("button", { name: "Пошкоджені: більше" }).click();
    for (const part of [
      page.locator(".sale-marks .sticker.tone-debt"),
      page.locator(".sale-marks .sticker.tone-warn"),
      page.locator(".line-return h3"),
      page.locator(".line-return-meta"),
      page.locator(".return-step").first().locator(".return-step-name"),
      page.locator(".return-step.damaged .return-step-name"),
      page.locator(".return-step.damaged .return-count"),
      // The way chosen, and one not.
      panelOf(page).locator(".way-switch span").nth(0),
      panelOf(page).locator(".way-switch span").nth(1),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    // One line: its row over the panel, both whole on the screen, the
    // person scrolling nothing — paid in parts, from paper, the app brings
    // the row above the panel itself.
    await expectLineOverPanel(page);
    await noSideScroll(page);
    await page.screenshot({ path: `test-results/returns-task-${name}.png` });
    await panelOf(page)
      .getByRole("button", { name: "Повернути товар на 3 000,00 грн" })
      .click();
    // Refused: the error's plate, never a debt's colour, the counts kept.
    const plate = page.getByRole("alert");
    await expect(plate).toContainText("Нічого не повернено.");
    await expectPlate(plate, "refused", name);
    await expect(page.locator(".return-step.damaged .return-count")).toHaveText(
      "1",
    );
    expect(sent).toHaveLength(1);
  });

test("a return in four taps from the till: «Повернути» — its field where the till's stood — the sale's row, «Цілі: більше», and the button that hands the money back, its way the sale's («Усе на бірці» task list, P1-3)", async ({
  page,
}) => {
  const { sent } = await oneSale(page, [line("Лоран шоколад", 1)]);
  // The till sells from its one warehouse, which has its goods: its search
  // stands under the switch, nothing said over it.
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
  const ways = tillWays(page);
  await expect(
    ways.getByRole("button", { name: "Продати", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const tillSearch = page.getByRole("searchbox", { name: "Знайти модель" });
  await expect(tillSearch).toBeVisible();
  const tillField = await tillSearch.boundingBox();
  const taps = await countTaps(page);
  await ways.getByRole("button", { name: "Повернути", exact: true }).click();
  // The returns' field where the till's stood: switching moves nothing
  // under the finger.
  const returnsSearch = page.getByRole("searchbox", {
    name: "Що повертають?",
  });
  await expect(returnsSearch).toBeVisible();
  const returnsField = await returnsSearch.boundingBox();
  if (!tillField || !returnsField) throw new Error("not laid out");
  expect(Math.round(returnsField.y)).toBe(Math.round(tillField.y));
  expect(returnsField.height).toBe(tillField.height);
  await page
    .getByRole("button", { name: /^Оформити повернення: Лоран шоколад · M, / })
    .click();
  await page.getByRole("button", { name: "Цілі: більше" }).click();
  // One line at 360 × 640: its row over the panel, both whole on the
  // screen, the person scrolling nothing — the app brings the row above the
  // panel itself (stage 2, orders task list, P0-6).
  await expectLineOverPanel(page);
  await panelOf(page)
    .getByRole("button", {
      name: "Повернути покупцю 3 000,00 грн готівкою",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Повернення записано" }),
  ).toBeVisible();
  expect(await taps()).toBe(4);
  expect(sent).toEqual([
    expect.objectContaining({
      payment_method: "CASH",
      lines: [expect.objectContaining({ quantity: 1, condition: "INTACT" })],
    }),
  ]);
});

test("before a tap: nine things to see, nothing to type and nothing to press; a unit counted brings the panel, thirteen", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  const { sent } = await oneSale(page, [coat]);
  await opened(page);
  // «Продаж 17.10, 14:32 · 6 000,00 грн»: one sale's sum (G33), the
  // header's one line of context in the store's and the person's place;
  // «← До списку» over the title (audit after stage 2, sale P1-3).
  const context = page.locator(".store-line");
  await expect(context).toHaveCount(1);
  await expect(context.locator(".t-meta")).toHaveText(
    /^Продаж \d\d\.\d\d, \d\d:\d\d · 6\s000,00\sгрн$/,
  );
  await expect(page.locator(".sale-context")).toHaveCount(0);
  const back = page.locator(".screen-header > .back");
  await expect(back).toHaveText("← До списку");
  const over = await back.boundingBox();
  const title = await page
    .getByRole("heading", { name: "Повернення", level: 1 })
    .boundingBox();
  expect((over?.y ?? 0) + (over?.height ?? 0)).toBeLessThanOrEqual(
    title?.y ?? 0,
  );
  await expect(
    page.getByRole("heading", { name: "Лоран шоколад · M", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".line-return-meta")).toHaveText(
    "3 000,00 грн за 1 шт. · можна повернути 2 шт.",
  );
  expect(await shown(page)).toBeLessThanOrEqual(9);
  // Counted, never typed: no field opens the keyboard.
  await expect(
    page.locator(".line-return input, .line-return textarea"),
  ).toHaveCount(0);
  await expect(panelOf(page)).toHaveCount(0);
  await noSideScroll(page);

  await returnUnits(page, { intact: 1 });
  // The count is heard with its row's name, «Цілі: 1», as it changes.
  const count = page.locator(".return-step").first().locator("output");
  await expect(count).toHaveText("Цілі: 1");
  await expect(count).toHaveAttribute("aria-live", "polite");
  const panel = panelOf(page);
  // Under the thumb at 360 × 640: what, how much and how, in view at once.
  await expect(panel.locator(".pay-what")).toHaveText("Лоран шоколад · M × 1");
  await expect(panel.locator(".pay-total")).toHaveText(
    "Повернути 3 000,00 грн",
  );
  await expect(panel.getByRole("radio", { name: "Готівкою" })).toBeChecked();
  const press = panel.getByRole("button", {
    name: "Повернути покупцю 3 000,00 грн готівкою",
    exact: true,
  });
  for (const part of [
    panel.locator(".pay-total"),
    panel.getByRole("group", { name: "Як повертаємо гроші", exact: true }),
    press,
  ])
    await expect(part).toBeInViewport({ ratio: 1 });
  // The tag counted stays above the panel.
  const tag = await page.locator(".line-return").boundingBox();
  const under = await panel.boundingBox();
  if (!tag || !under) throw new Error("not laid out");
  expect(tag.y + tag.height).toBeLessThanOrEqual(under.y + 1);
  expect(await shown(page)).toBeLessThanOrEqual(13);
  await noSideScroll(page);
  expect(sent).toEqual([]);

  // The sum said large is the sum in the button's name.
  await returnUnits(page, { damaged: 1 });
  await expect(panel.locator(".pay-what")).toHaveText("Лоран шоколад · M × 2");
  await expect(panel.locator(".pay-total")).toHaveText(
    "Повернути 6 000,00 грн",
  );
  await expect(
    panel.getByRole("button", {
      name: "Повернути покупцю 6 000,00 грн готівкою",
      exact: true,
    }),
  ).toBeVisible();
  // At the till's scale (audit 2026-11-13, sale P2-1): what comes back in
  // money-l, as the tray's «Разом»; the button that hands it back 56, its
  // name two lines at most at 360, the longest way chosen.
  const large = panel.locator(".pay-total .sum");
  await expect(large).toHaveCSS("font-size", "32px");
  await expect(large).toHaveCSS("line-height", "34px");
  await expect(large).toHaveCSS("font-weight", "800");
  await panel.getByRole("radio", { name: "На картку" }).check();
  const card = panel.getByRole("button", {
    name: "Повернути покупцю 6 000,00 грн на картку",
    exact: true,
  });
  await expect(card).toHaveCSS("min-height", "56px");
  expect((await card.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
  const lines = await card.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(
      [...range.getClientRects()].map((rect) => Math.round(rect.top)),
    ).size;
  });
  expect(lines).toBeLessThanOrEqual(2);
  await expect(card).toBeInViewport({ ratio: 1 });
  await noSideScroll(page);
  await page.screenshot({ path: "test-results/return-dock-360.png" });
});

test("the way not read says so, the seller's own goes, and the result's sum is the server's", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  const { sent, saleId } = await oneSale(page, [coat], {
    way: "REFUSED",
    // The server's own sum, not the one worked out on the phone.
    answer: (body) => ({
      status: 201,
      json: refundOf(
        saleId,
        body.lines,
        body.payment_method ?? null,
        "2950.00",
      ),
    }),
  });
  await opened(page);
  await returnUnits(page, { intact: 1 });
  const panel = panelOf(page);
  await expect(panel).toContainText(
    "Не вдалося прочитати, як платили. Оберіть, як повертаєте.",
  );
  for (const option of ["Готівкою", "На картку", "Переказом"])
    await expect(panel.getByRole("radio", { name: option })).not.toBeChecked();
  await expect(
    panel.getByRole("button", { name: "Оберіть, як повертаєте гроші" }),
  ).toBeDisabled();
  await panel.getByRole("radio", { name: "Переказом" }).check();
  await panel
    .getByRole("button", {
      name: "Повернути покупцю 3 000,00 грн переказом",
      exact: true,
    })
    .click();
  expect(sent[0]?.payment_method).toBe("TRANSFER");

  // In place of the form.
  await expect(
    page.getByRole("heading", { name: "Повернення записано" }),
  ).toBeFocused();
  await expect(page.locator(".line-return")).toHaveCount(0);
  await expectStub(page, {
    way: "Переказ",
    say: "Надішліть покупцю переказом",
    sum: "2 950,00 грн",
  });
  // Seen as the pill and the sum, heard as the one sentence.
  await expect(page.locator(".hand-back-sum")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator(".way-pill")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator(".hand-back")).toMatchAriaSnapshot(
    "- paragraph: Надішліть покупцю 2 950,00 грн переказом.",
  );
  await expect(
    page.getByText("Надішліть покупцю 2 950,00 грн переказом.", {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(page.getByText(/3\s000,00/)).toHaveCount(0);
  // Nothing damaged: the till alone mends a mistake (P1-5).
  await expect(page.locator(".return-mistake")).toHaveText(
    "Помилилися з поверненням? Продайте ці речі знову на касі.",
  );
  await noSideScroll(page);
});

test("two lines: each tag counts its own, and the panel says how many in all", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  const other = line("Альпака сіра", 2, 1);
  const { sent } = await oneSale(page, [coat, other]);
  await opened(page);
  await returnUnits(page, { intact: 2, line: "Лоран шоколад · M" });
  await expect(
    page
      .getByRole("group", { name: "Альпака сіра · M", exact: true })
      .locator(".line-return-meta"),
  ).toHaveText(
    "3 000,00 грн за 1 шт. · можна повернути 1 шт. · уже повернено 1 шт.",
  );
  await returnUnits(page, { damaged: 1, line: "Альпака сіра · M" });
  // Nothing more of it may come back.
  await expect(
    page
      .getByRole("group", { name: "Альпака сіра · M", exact: true })
      .getByRole("button", { name: "Цілі: більше" }),
  ).toBeDisabled();
  const panel = panelOf(page);
  await expect(panel.locator(".pay-what")).toHaveText("Повертають 3 шт.");
  // The last tag counted stays above the panel.
  const tag = await page
    .getByRole("group", { name: "Альпака сіра · M", exact: true })
    .boundingBox();
  const under = await panel.boundingBox();
  if (!tag || !under) throw new Error("not laid out");
  expect(tag.y + tag.height).toBeLessThanOrEqual(under.y + 1);
  await panel
    .getByRole("button", {
      name: "Повернути покупцю 9 000,00 грн готівкою",
      exact: true,
    })
    .click();
  expect(sent[0]?.lines).toEqual([
    { sale_item_id: coat.id, quantity: 2, restock: true, condition: "INTACT" },
    {
      sale_item_id: other.id,
      quantity: 1,
      restock: true,
      condition: "DAMAGED",
    },
  ]);
  await expect(
    page.getByText("Цілі: 2 шт. — на склад, з якого продали.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Пошкоджені: 1 шт\. — у «Брак»\./),
  ).toBeVisible();
});

test("a return refused is said above the panel, in view, and the counts are kept", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  await oneSale(page, [coat], {
    answer: () => ({
      status: 409,
      json: {
        code: "DAMAGED_RETURNS_UNAVAILABLE",
        message: "The store has no «Брак» warehouse to take damaged goods",
        details: { reason: "NOT_SET_UP" },
      },
    }),
  });
  await opened(page);
  await returnUnits(page, { damaged: 1 });
  await panelOf(page)
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();
  const refused = page.getByRole("alert");
  await expect(refused).toContainText("Нічого не повернено.");
  await expect(refused).toBeInViewport({ ratio: 1 });
  const said = await refused.boundingBox();
  const under = await panelOf(page).boundingBox();
  if (!said || !under) throw new Error("not laid out");
  expect(said.y + said.height).toBeLessThanOrEqual(under.y + 1);
  await expect(page.locator(".line-return .return-count")).toHaveText([
    "0",
    "1",
  ]);
});

test("without «Брак» and the till, the result offers no section to open, says a mistake's mending as how it is done, and offers only «До списку»", async ({
  page,
}) => {
  await without(page, ["damaged:handle", "sale:create"]);
  const coat = line("Лоран шоколад");
  await oneSale(page, [coat]);
  await opened(page);
  await returnUnits(page, { damaged: 1 });
  await panelOf(page)
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();
  await expect(
    page.getByText("Пошкоджені: 1 шт. — у «Брак».", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/розділі «Брак»/)).toHaveCount(0);
  // The till and «Брак» said as how it is done, never offered (P1-5).
  await expect(page.locator(".return-mistake")).toHaveText(
    "Помилилися з поверненням? Ці речі продають знову на касі; пошкоджене спершу повертають у продаж у «Браку».",
  );
  await expect(page.getByRole("button", { name: "Новий продаж" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Ще повернення" })).toHaveCount(
    0,
  );
  // The screen's one way on, its main in the dock at the menu's top (audit
  // 2026-11-13, sale P1-2).
  const dock = await dockOnMenu(page);
  await expect(dock.getByRole("button")).toHaveCount(1);
  await expect(
    dock.getByRole("button", { name: "До списку", exact: true }),
  ).toHaveClass(/\bprimary\b/);
  await page.getByRole("button", { name: "До списку", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("a return's result at 360 × 640: «Новий продаж» the dock's one main at the menu's top, as the receipt's; «Ще повернення» quiet under the hint (audit 2026-11-13, sale P1-2)", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  await oneSale(page, [coat]);
  await opened(page);
  await returnUnits(page, { intact: 1 });
  await panelOf(page)
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Повернення записано" }),
  ).toBeFocused();
  const dock = await dockOnMenu(page);
  await expect(dock.getByRole("button")).toHaveCount(1);
  await expect(dock.getByRole("button", { name: "Новий продаж" })).toHaveClass(
    /\bprimary\b/,
  );
  await expect(page.locator("main button.primary:visible")).toHaveCount(1);
  // Another return, quiet, under the hint of a mistake's mending.
  const more = page.locator(
    ".return-result .result-body > .return-mistake + button.quiet",
  );
  await expect(more).toHaveText("Ще повернення");
  await noSideScroll(page);
  await page.screenshot({ path: "test-results/return-result-dock-360.png" });
  await more.click();
  await expect(page.getByRole("article")).toHaveCount(1);
});

for (const [name, theme, scheme] of [
  ["light", LIGHT, "light"],
  ["dark", DARK, "dark"],
] as const)
  test(`in the ${name} theme the tags, the panel and the result read at 4.5:1`, async ({
    page,
  }) => {
    const coat = line("Лоран шоколад");
    await oneSale(page, [coat]);
    await opened(page, theme);
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
    ).toBe(scheme);
    await returnUnits(page, { intact: 1, damaged: 1 });
    for (const part of [
      page.locator(".return-step").first().locator(".return-step-name"),
      page.locator(".return-step.damaged .return-step-name"),
      page.locator(".return-step.damaged .return-count"),
      page.locator(".line-return-meta"),
      panelOf(page).locator(".pay-total"),
      panelOf(page).locator(".pay-what"),
      panelOf(page).locator("label:has(input:checked)"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/returns-form-${name}.png` });
    const metaSize = await page
      .locator(".line-return-meta")
      .evaluate((node) => getComputedStyle(node).fontSize);
    // «Пошкоджені» keeps the colour of «Брак» on the result (P2-4).
    const damagedColour = await page
      .locator(".return-step.damaged .return-step-name")
      .evaluate((node) => getComputedStyle(node).color);
    await panelOf(page)
      .getByRole("button", { name: "Повернути покупцю 6 000,00 грн готівкою" })
      .click();
    await expect(page.locator(".hand-back-sum")).toHaveText("6 000,00 грн");
    for (const part of [
      page.locator(".way-pill"),
      page.locator(".hand-back-sum .sum"),
      page.locator(".return-goods p").first(),
      page.locator(".damaged-line"),
      page.locator(".return-mistake"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page
        .locator(".damaged-line")
        .evaluate((node) => getComputedStyle(node).color),
    ).toBe(damagedColour);
    // The returns screens' meta at 14 px (P2-4), the result's as the form's.
    expect(
      await page
        .locator(".return-mistake")
        .evaluate((node) => getComputedStyle(node).fontSize),
    ).toBe("14px");
    expect(metaSize).toBe("14px");
    await noSideScroll(page);
    await page.screenshot({ path: `test-results/returns-result-${name}.png` });
  });

test("paid in parts, a sale that suggests no way is returned without one (G35), and nothing back is said", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  const { sent, saleId } = await oneSale(page, [coat], {
    way: "NONE",
    parts: true,
    answer: (body) => ({
      status: 201,
      json: {
        ...refundOf(saleId, body.lines, null),
        credit: {
          debt_reduced: "3000.00",
          cash_back: "0.00",
          owed_after: "1000.00",
        },
      },
    }),
  });
  await opened(page);
  await expect(page.locator(".sale-marks")).toHaveText("Оплата частинами");
  await returnUnits(page, { intact: 1 });
  const panel = panelOf(page);
  for (const option of ["Готівкою", "На картку", "Переказом"])
    await expect(panel.getByRole("radio", { name: option })).not.toBeChecked();
  await panel
    .getByRole("button", {
      name: "Повернути товар на 3 000,00 грн",
      exact: true,
    })
    .click();
  expect(sent[0]).not.toHaveProperty("payment_method");
  await expect(page.locator(".hand-back-sum")).toHaveText("0,00 грн");
  await expect(page.getByText("Грошей покупцю не повертаємо.")).toBeVisible();
  await expect(
    page.getByText("Борг покупця зменшено на 3 000,00 грн."),
  ).toBeVisible();
  await expect(page.getByText("Покупець ще винен 1 000,00 грн.")).toBeVisible();
  // What is still owed, in the debt's colour with its arrow (audit
  // 2026-11-13, sale P2-3).
  await expectOwed(page.locator(".return-result"), "1 000,00 грн");
  await expect(page.getByText(/Поверніть/)).toHaveCount(0);
});

test("from paper at 360 × 640: its banner on top, three rows over the first goods — the switch, the series, the time — and the first goods in view (stage 2, orders task list, P0-4)", async ({
  page,
}) => {
  await oneSale(page, [line("Лоран шоколад")]);
  await opened(page);
  await fromPaper(page, "Вношу повернення з паперу");
  const banner = page.getByRole("region", { name: "Режим: з паперу" });
  await expect(banner).toBeVisible();
  const form = page.locator("section.returns fieldset").first();
  const rows = await form.evaluate((node) =>
    [...node.children]
      .slice(
        0,
        [...node.children].findIndex((child) =>
          child.classList.contains("line-return"),
        ),
      )
      .filter((child) => child.tagName !== "LEGEND")
      .map((child) => child.className),
  );
  expect(rows).toEqual(["switch-row", "sale-row paper-series", "fields"]);
  const top = await banner.boundingBox();
  const turn = await page.locator(".switch-row").first().boundingBox();
  expect((top?.y ?? 0) + (top?.height ?? 0)).toBeLessThanOrEqual(turn?.y ?? 0);
  await expect(
    page.locator(".line-return").first().locator("h3"),
  ).toBeInViewport({ ratio: 1 });
  // Read as switches.
  await expect(
    page.getByRole("switch", { name: "Вношу повернення з паперу" }),
  ).toBeChecked();
});

test("from paper, the panel's large line says so too, and never what to hand back later", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  await oneSale(page, [coat], { parts: true });
  await opened(page);
  await fromPaper(page, "Вношу повернення з паперу");
  await returnUnits(page, { intact: 1 });
  const panel = panelOf(page);
  await expect(panel.locator(".pay-total")).toHaveText(
    "З паперу · Товар на 3 000,00 грн",
  );
  // One line under the button: who took it, and the paper's time once it
  // is given — today's says so (P1-4).
  await expect(panel.locator(".pay-seller")).toHaveText(
    "Хто прийняв: не вказано",
  );
  await page.getByLabel("Час з паперу").fill("10:15");
  await expect(panel.locator(".pay-seller")).toHaveText(
    "Хто прийняв: не вказано · за папером сьогодні, 10:15",
  );
  await expect(panel).not.toContainText("скільки віддати");
  await expect(
    panel.getByRole("button", {
      name: "З паперу · Повернути товар на 3 000,00 грн",
      exact: true,
    }),
  ).toBeVisible();
});

test("a warehouse to choose, for goods from another store's own, is brought above the panel with its tag; its chips deciding ones of 44, the one chosen in the chosen colours (stage 2, orders task list, P0-6)", async ({
  page,
}) => {
  const coat = { ...line("Лоран шоколад"), back_to_sold_from: false };
  await oneSale(page, [coat]);
  // A store's two warehouses, as a store has: the shared test store holds
  // every journey's.
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    await route.fulfill({
      json: [
        ["Основний склад", "4f1c2b3a-0d9e-4c7b-8a6f-5e4d3c2b1a01"],
        ["Склад повернень", "4f1c2b3a-0d9e-4c7b-8a6f-5e4d3c2b1a02"],
      ].map(([name, id]) => ({
        id,
        store_id: fixture.store_id,
        name,
        is_active: true,
        can_receive: true,
        damaged_returns: false,
      })),
    });
  });
  await opened(page);
  await returnUnits(page, { intact: 1 });
  // A chip each (P1-1), brought into view with the tag.
  const place = page.getByRole("group", { name: "Цілі — на який склад?" });
  await expect(place.locator(".chip").first()).toBeVisible();
  await expect(place).toBeInViewport({ ratio: 1 });
  // The chips and the «Цілі» row just tapped, above the panel.
  const chips = await place.boundingBox();
  const counted = await page
    .getByRole("button", { name: "Цілі: більше" })
    .boundingBox();
  const under = await panelOf(page).boundingBox();
  if (!chips || !counted || !under) throw new Error("not laid out");
  expect(chips.y + chips.height).toBeLessThanOrEqual(under.y + 1);
  expect(counted.y).toBeGreaterThanOrEqual(0);
  await expect(
    panelOf(page).getByRole("button", {
      name: "Оберіть склад для цілого товару",
    }),
  ).toBeDisabled();
  // Deciding chips 44, nothing chosen beforehand; the one tapped in the
  // chosen colours (spec §6.13), as «Куди» (P0-6).
  const chip = place.getByRole("button", { name: "Склад повернень" });
  await expect(place.locator('[aria-pressed="true"]')).toHaveCount(0);
  expect((await chip.boundingBox())?.height).toBe(44);
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const colours = await page.evaluate(() => {
    const probe = document.createElement("i");
    document.body.append(probe);
    probe.style.color = "var(--chosen)";
    const back = getComputedStyle(probe).color;
    probe.style.color = "var(--on-chosen)";
    const fore = getComputedStyle(probe).color;
    probe.remove();
    return { back, fore };
  });
  await expect(chip).toHaveCSS("background-color", colours.back);
  await expect(chip).toHaveCSS("color", colours.fore);
});

test("Telegram buzzes once the server answers a return: an error refused, a success recorded; a kept one a warning, confirmed later nothing — and its banner and notice name it", async ({
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
  // The answers' buzzes: a choice's are telegram-rules.spec's.
  const buzzes = async (): Promise<unknown[]> =>
    (
      await page.evaluate(
        () => (window as unknown as { buzzes: string[] }).buzzes,
      )
    )
      .map((data) => JSON.parse(data) as { type: string })
      .filter((buzz) => buzz.type === "notification");
  const coat = line("Лоран шоколад");
  const other = line("Альпака сіра", 1);
  let answers = 0;
  const { sent, saleId } = await oneSale(page, [coat, other], {
    answer: (body) => {
      answers += 1;
      return answers === 1
        ? {
            status: 409,
            json: {
              code: "DAMAGED_RETURNS_UNAVAILABLE",
              message:
                "The store has no «Брак» warehouse to take damaged goods",
              details: { reason: "NOT_SET_UP" },
            },
          }
        : {
            status: 201,
            json: refundOf(saleId, body.lines, body.payment_method ?? null),
          };
    },
  });
  // The kept one: every answer lost until the app is opened again — any
  // other answer meanwhile has the phone check it at once (CI, #170) — its
  // first body kept to compare.
  let lose = false;
  let lost: unknown = null;
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    if (lose) {
      lost ??= route.request().postDataJSON();
      await route.abort("connectionreset");
      return;
    }
    await route.fallback();
  });
  await opened(page, undefined, "8.0");
  await returnUnits(page, { intact: 1, line: "Лоран шоколад · M" });
  const press = panelOf(page).getByRole("button", {
    name: "Повернути покупцю 3 000,00 грн готівкою",
  });
  await press.click();
  await expect(page.getByRole("alert")).toContainText("Нічого не повернено.");
  expect(await buzzes()).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await press.click();
  await expect(
    page.getByRole("heading", { name: "Повернення записано" }),
  ).toBeVisible();
  expect(await buzzes()).toEqual([
    { type: "notification", notification_type: "error" },
    { type: "notification", notification_type: "success" },
  ]);

  // Another, its answer lost: the banner names it, it is felt once, a
  // warning, and its confirmation later buzzes nothing.
  await page.getByRole("button", { name: "Ще повернення" }).click();
  await page.getByRole("button", { name: /^Оформити повернення: / }).click();
  await returnUnits(page, { intact: 1, line: "Лоран шоколад · M" });
  await returnUnits(page, { damaged: 1, line: "Альпака сіра · M" });
  lose = true;
  await panelOf(page)
    .getByRole("button", { name: "Повернути покупцю 6 000,00 грн готівкою" })
    .click();
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
  });
  await expect(banner.locator("p").first()).toHaveText(
    "Повернення: Лоран шоколад · M × 1, Альпака сіра · M × 1 · 6 000,00 грн готівкою — сервер не відповів. Двічі воно не запишеться, і гроші двічі не повернуться. Поки чекаємо, інші дії недоступні.",
  );
  // A lost answer is not an answer (P2-5), but a return kept on the phone:
  // a warning (spec §4.4; «Усе на бірці» task list, P1-2).
  expect(await buzzes()).toEqual([
    { type: "notification", notification_type: "error" },
    { type: "notification", notification_type: "success" },
    { type: "notification", notification_type: "warning" },
  ]);
  // Hours later, the app opened again: the phone confirms it by itself,
  // and buzzes nothing either.
  lose = false;
  await page.reload();
  await openStore(page, "Основний MAIN");
  const notice = page.locator("section.notice", {
    has: page.getByRole("heading", { name: "Повернення записано один раз" }),
  });
  await expect(notice).toBeVisible();
  expect(await buzzes()).toEqual([]);
  // The way alone over the sum: «Поверніть» only where it is conditional.
  await expect(notice.locator(".way-pill")).toHaveText("Готівка");
  await expect(notice.getByText(/^Поверніть|· Поверніть/)).toHaveCount(0);
  // The result's block, compact: the sum, and to give it only if nobody did.
  await expect(notice.locator(".hand-back-sum")).toHaveText("6 000,00 грн");
  await expect(
    notice.getByText(
      "Якщо гроші ще не повернули — поверніть покупцю 6 000,00 грн готівкою. Якщо вже повернули, поки сервер не відповідав, — не повертайте вдруге.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    notice.getByText("Цілі: 1 шт. — на склад, з якого продали.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    notice.getByText(/^Пошкоджені: 1 шт\. — у «Брак»\./),
  ).toBeVisible();
  await expect(notice.locator(".return-mistake")).toHaveCount(0);
  await expect(
    notice.getByRole("button", { name: "Новий продаж" }),
  ).toHaveCount(0);
  // Resent as it was first sent: what the banner named never goes.
  expect(sent).toHaveLength(3);
  expect(sent[2]).toEqual(lost);
  expect(lost).not.toHaveProperty("shown");
  await notice.getByRole("button", { name: "Зрозуміло" }).click();
  await expect(notice).toHaveCount(0);
});

test("paid in parts, a way not read asks for one only if money goes back", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  await oneSale(page, [coat], { way: "REFUSED", parts: true });
  await opened(page);
  await returnUnits(page, { intact: 1 });
  const panel = panelOf(page);
  await expect(
    panel.getByText(
      "Не вдалося прочитати, як платили. Якщо буде що повертати — оберіть, як.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(panel.getByText(/Оберіть, як повертаєте/)).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: "Повернути товар на 3 000,00 грн",
      exact: true,
    }),
  ).toBeEnabled();
});

for (const rights of [
  {
    lacking: "damaged:handle",
    said: "Помилилися з поверненням? Продайте ці речі знову на касі; пошкоджене спершу повертають у продаж у «Браку».",
  },
  {
    lacking: "sale:create",
    said: "Помилилися з поверненням? Ці речі продають знову на касі; пошкоджене спершу поверніть у продаж у «Браку».",
  },
])
  test(`without ${rights.lacking} alone, a mistake's mending says that part as how it is done`, async ({
    page,
  }) => {
    await without(page, [rights.lacking]);
    const coat = line("Лоран шоколад");
    await oneSale(page, [coat]);
    await opened(page);
    await returnUnits(page, { damaged: 1 });
    await panelOf(page)
      .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
      .click();
    await expect(page.locator(".return-mistake")).toHaveText(rights.said);
  });

test("a refusal nothing more is known of says the return's own words, never an order's, nor «спробуйте ще раз» (audit after stage 2, sale P2-5)", async ({
  page,
}) => {
  const coat = line("Лоран шоколад");
  let answers = 0;
  await oneSale(page, [coat], {
    answer: () => {
      answers += 1;
      return answers === 2
        ? {
            status: 422,
            json: {
              code: "VALIDATION_ERROR",
              message: "Request failed validation",
              details: {},
            },
          }
        : answers === 3
          ? {
              status: 400,
              json: {
                code: "BAD_REQUEST",
                message: "Bad request",
                details: {},
              },
            }
          : answers === 4
            ? {
                // The warehouse the goods went to, closed meanwhile.
                status: 404,
                json: {
                  code: "NOT_FOUND",
                  message: "Not found",
                  details: { reason: "WAREHOUSE_UNAVAILABLE" },
                },
              }
            : {
                status: 409,
                json: { code: "CONFLICT", message: "Conflict", details: {} },
              };
    },
  });
  await opened(page);
  await returnUnits(page, { intact: 1 });
  const press = panelOf(page).getByRole("button", {
    name: "Повернути покупцю 3 000,00 грн готівкою",
  });
  await press.click();
  const refused = page.getByRole("alert");
  await expect(refused).toHaveText(
    "Дані змінилися, поки ви працювали. Поверніться до списку й відкрийте продаж знову. Нічого не повернено.",
  );
  await press.click();
  await expect(refused).toHaveText(
    "Перевірте, що повертають. Нічого не повернено.",
  );
  // Refused for nothing named at all: its fate, then what to check.
  await press.click();
  await expect(refused).toHaveText(
    "Нічого не повернено. Перевірте, що повертають.",
  );
  // A closed warehouse named: the kept return's words, never the goods to
  // check (review).
  await press.click();
  await expect(refused).toHaveText(
    "Склад, куди йшов цей товар, закрито. Зверніться до менеджера. Нічого не повернено.",
  );
  // From paper, nothing is recorded rather than handed back.
  await fromPaper(page, "Вношу повернення з паперу");
  await panelOf(page)
    .getByRole("button", {
      name: "З паперу · Повернути покупцю 3 000,00 грн готівкою",
    })
    .click();
  await expect(refused).toHaveText(
    "Дані змінилися, поки ви працювали. Поверніться до списку й відкрийте продаж знову. Нічого не записано.",
  );
  await expect(
    page.getByRole("alert").filter({ hasText: /спробуйте/i }),
  ).toHaveCount(0);
  // Not a word of an order in what is said (the sections' row names theirs).
  await expect(
    page.getByRole("alert").filter({ hasText: /замовлен/i }),
  ).toHaveCount(0);
});
