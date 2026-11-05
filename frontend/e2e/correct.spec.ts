import {
  test,
  expect,
  gridCell,
  more,
  openModel,
  openStore,
  refuseOnce,
  section,
  units,
  waitsFor,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  count_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

interface AdjustmentBody {
  command_id: string;
  location_id: string;
  size_id: string;
  quantity_delta: number;
  reason_code: string;
  note: string | null;
  expected_quantity: number | null;
}

function launch(version?: string): string {
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
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
}

const lorans = /^Лоран шоколад 70(?:\.0)? см$/;

async function login(page: Page, version?: string): Promise<void> {
  await page.goto(launch(version));
  await openStore(page, "Основний MAIN");
}

/** The model's detail (spec S23), from the till's search: a correction is
 * made from its grid («Усе на бірці» sections task list, P0-6). */
async function enter(
  page: Page,
  query = "Лоран",
  name: string | RegExp = lorans,
  version?: string,
): Promise<void> {
  await login(page, version);
  await openModel(page, query, name);
}

/** What the grid says the stocktake warehouse holds of M: it is the one no
 * other spec sells from or receives into. */
function here(page: Page): Locator {
  return gridCell(page, fixture.count_location_id, fixture.size_id);
}

/** «Виправити залишок», its sheet ready for a tap. */
async function fixSheet(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Виправити залишок" }).click();
  const sheet = page.getByRole("dialog");
  // A tap carried from the button is let go for a moment.
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** The stocktake warehouse's cell of M, tapped: the correction form. */
async function correct(page: Page): Promise<void> {
  const sheet = await fixSheet(page);
  await sheet
    .getByRole("button", { name: /^M, Склад перерахунку, в обліку \d+$/ })
    .click();
}

/** «Інвентаризація», the stocktake warehouse chosen (sections task list,
 * P1-5). */
async function stocktaking(page: Page): Promise<void> {
  await page
    .getByRole("group", { name: "Склад" })
    .getByRole("button", { name: "Склад перерахунку", exact: true })
    .click();
}

function adjustments(page: Page): AdjustmentBody[] {
  const sent: AdjustmentBody[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/inventory/adjustments")
    )
      sent.push(request.postDataJSON() as AdjustmentBody);
  });
  return sent;
}

test("a stocktake states what the shelf holds, and the ledger takes the difference", async ({
  page,
}) => {
  const sent = adjustments(page);
  await enter(page);
  const system = await units(here(page));
  await correct(page);
  await expect(page.getByText(`В обліку: ${String(system)}`)).toBeVisible();
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, шт.").fill(String(system - 2));
  await expect(
    page.getByText(`Облік ${String(system)} → ${String(system - 2)} (−2)`),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/correct-mobile.png",
    fullPage: true,
  });
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25).
  await refuseOnce(page, "**/api/v1/inventory/adjustments", 422);
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(
    page.getByText(
      "Перевірте кількість та спробуйте ще раз. Нічого не записано.",
      { exact: true },
    ),
  ).toBeVisible();
  // Counted again, as the form asks after a refusal.
  await page.getByLabel("Фактично на складі, шт.").fill(String(system - 2));
  await refuseOnce(page, "**/api/v1/inventory/adjustments", 409);
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(
    page.getByText(
      "Облік змінився — перерахуйте товар і спробуйте ще раз. Нічого не записано.",
      { exact: true },
    ),
  ).toBeVisible();
  // «Брак» changes only through returns and its own section: said, never a
  // count to make again (owner decision, 2026-10-01).
  await page.getByLabel("Фактично на складі, шт.").fill(String(system - 2));
  await page.route(
    "**/api/v1/inventory/adjustments",
    async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          code: "DAMAGED_STOCK_CLOSED",
          message:
            "Stock in «Брак» changes only through returns and the «Брак» section",
          details: {},
        },
      });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(
    page.getByText(
      "Залишок «Браку» змінюють лише повернення й розділ «Брак». Нічого не записано.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Фактично на складі, шт.").fill(String(system - 2));
  await page.getByRole("button", { name: "Записати коригування" }).click();

  // The sheet closes; a stub over the grid says it, and the grid is read
  // again.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    `Перерахунок, облік ${String(system)} → ${String(system - 2)}.`,
  );
  await expect(here(page)).toHaveText(String(system - 2));
  // The count travels as a change *and* the balance it was worked out from:
  // the refused one first, then the same change as a new command.
  expect(sent).toHaveLength(4);
  expect(sent[3]?.command_id).not.toBe(sent[0]?.command_id);
  expect({ ...sent[0], command_id: null }).toEqual({
    ...sent[3],
    command_id: null,
  });
  expect(sent[3]).toMatchObject({
    location_id: fixture.count_location_id,
    size_id: fixture.size_id,
    quantity_delta: -2,
    reason_code: "STOCKTAKE",
    expected_quantity: system,
    note: null,
  });
});

test("damaged goods are written off by how many, whatever the balance", async ({
  page,
}) => {
  const sent = adjustments(page);
  await enter(page);
  const system = await units(here(page));
  await correct(page);
  await page.getByRole("radio", { name: "Пошкоджено" }).click();
  await page.getByLabel("Скільки списати, шт.").fill("1");
  await page.getByLabel("Примітка").fill("Пляма на рукаві");
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(page.getByRole("status")).toContainText(
    `Пошкоджено, облік ${String(system)} → ${String(system - 1)}.`,
  );
  expect(sent[0]).toMatchObject({
    quantity_delta: -1,
    reason_code: "DAMAGED",
    expected_quantity: null,
    note: "Пляма на рукаві",
  });
});

test("a count made against a balance that has since moved is refused, and asks for a recount", async ({
  page,
}) => {
  // The screen shows one more than the warehouse holds, as it would if a sale
  // had taken a coat after the list was read.
  let stale = true;
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { size_label: string; quantity: number }[];
    };
    if (stale)
      for (const item of body.items)
        if (item.size_label === "M") item.quantity += 1;
    // A read the page dropped meanwhile — the till's, as the model opens —
    // is answered to no one.
    await route.fulfill({ response, json: body }).catch(() => undefined);
  });
  await enter(page);
  const shown = await units(here(page));
  stale = false;
  await correct(page);
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, шт.").fill(String(shown - 3));
  await page.getByRole("button", { name: "Записати коригування" }).click();

  await expect(page.getByRole("alert")).toContainText(
    `облік змінився: було ${String(shown)}, тепер ${String(shown - 1)}`,
  );
  await expect(page.getByRole("alert")).toContainText("Нічого не записано.");
  // The form now judges the count from what the server saw.
  await expect(page.getByText(`В обліку: ${String(shown - 1)}`)).toBeVisible();
  await expect(page.getByLabel("Фактично на складі, шт.")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Коригування ще не підтверджено" }),
  ).toHaveCount(0);
  // The grid read again as the refusal came may still be on its way: the
  // page closes without waiting for it.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("goods the system holds none of are found in the catalogue and counted from zero", async ({
  page,
}) => {
  const sent = adjustments(page);
  await login(page);
  await section(page, "Інвентаризація");
  await stocktaking(page);
  await page
    .getByRole("button", { name: "Знайшли товар, якого немає в списку" })
    .click();
  await page.getByLabel("Пошук у каталозі").fill("лоран");
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "L" });
  await expect(page.getByText("В обліку: 0")).toBeVisible();
  // Nothing to write off where nothing is held.
  await expect(page.getByRole("radio", { name: "Пошкоджено" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Втрачено" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, шт.").fill("2");
  await page.getByRole("button", { name: "Записати коригування" }).click();

  await expect(page.getByRole("status")).toContainText(
    "L — Перерахунок, облік 0 → 2.",
  );
  expect(sent[0]).toMatchObject({ quantity_delta: 2, expected_quantity: 0 });
  // The model's grid holds it now.
  await section(page, "Продаж");
  await openModel(page, "Лоран", lorans);
  await expect(
    gridCell(page, fixture.count_location_id, sent[0]?.size_id ?? ""),
  ).toHaveText("2");
});

test("found goods that turn out to be held are counted against what is held", async ({
  page,
}) => {
  await enter(page);
  const held = await units(here(page));
  const name =
    (await page
      .getByRole("heading", { level: 1, name: lorans })
      .textContent()) ?? "";
  // From the model's ⋯.
  await page.getByRole("button", { name: "Ще дії з моделлю" }).click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: "Інвентаризація" }).click();
  await stocktaking(page);
  await page
    .getByRole("button", { name: "Знайшли товар, якого немає в списку" })
    .click();
  await page.getByLabel("Пошук у каталозі").fill("лоран");
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "M" });
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, шт.").fill("1");
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await expect(page.getByRole("alert")).toContainText(
    `уже є в обліку цього складу: ${String(held)} шт.`,
  );
  await expect(page.getByText(`В обліку: ${String(held)}`)).toBeVisible();
  await page.getByRole("button", { name: `Назад до «${name}»` }).click();
  await expect(here(page)).toHaveText(String(held));
});

test("a correction whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  // Inside Telegram: whether it asks before Бірка closes, as last told.
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      asked: unknown;
    };
    host.asked = null;
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_closing_behavior")
          host.asked = JSON.parse(data) as unknown;
      },
    };
  });
  const asked = (): Promise<unknown> =>
    page.evaluate(() => (window as unknown as { asked: unknown }).asked);
  const keys: (string | null)[] = [];
  const commands: string[] = [];
  let lose: () => void = () => undefined;
  const lost = new Promise<void>((done) => {
    lose = done;
  });
  await page.route("**/api/v1/inventory/adjustments", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    commands.push(
      (route.request().postDataJSON() as AdjustmentBody).command_id,
    );
    if (keys.length === 1) {
      await lost;
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });
  await enter(page, "Лоран", lorans, "9.1");
  const system = await units(here(page));
  await correct(page);
  await page.getByRole("radio", { name: "Втрачено" }).click();
  await page.getByLabel("Скільки списати, шт.").fill("1");
  await page.getByRole("button", { name: "Записати коригування" }).click();
  // Its first send in flight: the sheet stands, and the attempt is on the
  // phone already, so Telegram is not asked until it is kept (review,
  // 2026-11-05).
  await expect.poll(() => keys.length).toBe(1);
  await expect(page.getByRole("dialog")).toBeVisible();
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await page.evaluate(
    () =>
      new Promise((done) => {
        requestAnimationFrame(() => setTimeout(done, 50));
      }),
  );
  expect(await asked()).not.toEqual({ need_confirmation: true });
  lose();
  // The sheet steps aside: the app's notice is where it is settled.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(asked).toEqual({ need_confirmation: true });
  // On the model's detail, its own screen: the sale's stub, still attached
  // (stage 2, orders task list, P0-1).
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect(kept.locator(".stub-head")).toHaveText("Ще не підтверджено");
  await expect(
    kept.getByRole("heading", { name: "Коригування ще не підтверджено" }),
  ).toBeVisible();
  // The model's ways that would wait for it wait too, under the notice
  // (review, 2026-11-01).
  for (const name of ["Виправити залишок", "Прийшов товар"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  await waitsFor(page, /^Коригування ще не підтверджено$/);
  // The till waits too: nothing else happens until this is settled.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат коригування" })
    .click();
  // Confirmed: torn off, once (В-ЗП2 (а)).
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect(
    kept.getByRole("heading", { name: "Коригування записано один раз" }),
  ).toBeVisible();
  await expect(
    kept.getByText(`Облік ${String(system)} → ${String(system - 1)}.`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Коригування ще не підтверджено" }),
  ).toHaveCount(0);
  expect(keys[1]).toBe(keys[0]);
  expect(commands[1]).toBe(commands[0]);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  await expect.poll(asked).toEqual({ need_confirmation: false });
});

test("correcting stock needs inventory:adjust, which a seller does not hold", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "inventory:adjust",
      );
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  await expect(here(page)).toBeVisible();
  for (const name of ["Виправити залишок", "Ще дії з моделлю"])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  // Nor «Інвентаризація», where goods found are counted.
  await more(page);
  await expect(
    page
      .getByRole("navigation", { name: "Ще" })
      .getByRole("button", { name: "Інвентаризація", exact: true }),
  ).toHaveCount(0);
});

test("a reserved balance's cell is held, and a size not known is only reduced", async ({
  page,
}) => {
  const sent = adjustments(page);
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            location_id: fixture.count_location_id,
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            display_name: "Зарезервований",
            size_label: "M",
            size_is_unknown: false,
            quantity: 4,
            reserved_quantity: 1,
            available_quantity: 3,
            suggested_price: null,
          },
          {
            location_id: fixture.count_location_id,
            product_variant_id: fixture.variant_id,
            size_id: "00000000-0000-4000-8000-000000000000",
            display_name: "Зарезервований",
            size_label: "UNKNOWN",
            size_is_unknown: true,
            quantity: 3,
            reserved_quantity: 0,
            available_quantity: 3,
            suggested_price: null,
          },
        ],
        has_more: false,
      },
    });
  });
  await enter(page, "Зарезервований", "Зарезервований");
  const sheet = await fixSheet(page);
  await expect(
    sheet.getByRole("button", {
      name: "M, Склад перерахунку, в обліку 4, у резерві 1",
    }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(sheet.getByText(/^Є резерв замовлення/)).toBeVisible();

  await sheet
    .getByRole("button", { name: /^розмір невідомий, Склад перерахунку/ })
    .click();
  await page.getByRole("radio", { name: "Перерахунок" }).click();
  await page.getByLabel("Фактично на складі, шт.").fill("5");
  await expect(
    page.getByText("Облік товару з невідомим розміром можна лише зменшити."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Записати коригування" }).click();
  await page.getByRole("radio", { name: "Помилка обліку" }).click();
  await expect(
    page.getByRole("radio", { name: "Додати до обліку" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: "Списати з обліку" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(sent).toEqual([]);
});
