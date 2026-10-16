import { test, expect, more, openStore, sections, tapSize } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The sections and the header in the new design (sale-slice TZ, P1-6), and
 * the till's reminder once the server is back (P1-7; owner decisions,
 * 2026-10-15: the reminder is the till's alone, В7 (б)).
 *
 * The counter's work stands in one row — «Продаж», «Повернення», «Борги»,
 * «Каса», each for whoever may do it — and every other section is under
 * «Ще», by the same rights as before. The header is one line,
 * «{Магазин} · {Ім’я}».
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

function launch(telegramUserId: string, name: string): string {
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
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
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

  await expect(row(page)).toHaveText([
    "Продаж",
    "Повернення",
    "Борги",
    "Каса",
    "Ще",
  ]);
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
    "Замовлення",
    "+ Нове замовлення",
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
  await row(page).filter({ hasText: "Борги" }).click();
  await row(page).filter({ hasText: "Продаж" }).click();
  await moreButton(page).click();
  await row(page).filter({ hasText: "Продаж" }).click();
  await expect(underMore(page)).toHaveCount(0);
});

test("whoever does none of the counter's work has «Ще» alone, holding only what they may open", async ({
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
    page.getByRole("heading", { name: "Замовлення магазину" }),
  ).toBeVisible();
  await expect(row(page)).toHaveText(["Ще"]);
  await expect(moreButton(page)).toHaveClass(/active/);
  await more(page);
  await expect(underMore(page)).toHaveText([
    "Замовлення",
    "Каталог",
    "Приймання",
    "Залишки",
    "Брак",
  ]);
});

test("the owner's row is the same four and «Ще», on one line at 360 px; «Ще» holds the owner's sections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch(fixture.owner_telegram_user_id, "Власник"));
  await openStore(page, "Основний MAIN");
  await expect(row(page)).toHaveText([
    "Продаж",
    "Повернення",
    "Борги",
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
        .getByRole("button", { name: "Повторити завантаження" })
        .click({ timeout: 1000 });
    await expect(failed(page)).toHaveCount(0, { timeout: 1000 });
  }).toPass();
}

/** Another section, and the till again: it reads its warehouses anew. */
async function tillAgain(page: Page): Promise<void> {
  await sections(page).getByRole("button", { name: "Борги" }).click();
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
  await expect(page.getByText("Незавершений продаж")).toBeVisible();
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
