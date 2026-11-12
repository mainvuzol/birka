import { expect, test as base } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * Playwright's `test`, except that:
 *
 * - a test's pages close only once the route handlers it installed have
 *   answered. The app keeps talking after a test's last assertion — a sale,
 *   once written down, reads the shelf again. A handler still busy with that
 *   request when the context closes finds its fetched response disposed, and
 *   the error lands on a test that passed. So the handlers are unrouted,
 *   waiting for any still running, before the context goes.
 * - an error the page did not catch fails the test, even when every assertion
 *   passed: on a seller's phone it would break the screen or be lost unseen.
 *   A journey that breaks a screen on purpose says so with
 *   `test.use({ pageErrorsExpected: true })`.
 */
export const test = base.extend<{ pageErrorsExpected: boolean }>({
  pageErrorsExpected: [false, { option: true }],
  context: async ({ context, pageErrorsExpected }, use) => {
    const uncaught: string[] = [];
    const watch = (page: Page): void => {
      page.on("pageerror", (error) => {
        uncaught.push(error.stack ?? error.message);
      });
    };
    context.pages().forEach(watch);
    context.on("page", watch);
    await use(context);
    await Promise.all([
      context.unrouteAll({ behavior: "wait" }),
      ...context.pages().map((page) => page.unrouteAll({ behavior: "wait" })),
    ]);
    if (!pageErrorsExpected && uncaught.length > 0)
      throw new Error(
        `The page threw and nothing caught it:\n${uncaught.join("\n")}`,
      );
  },
});

export { expect } from "@playwright/test";

/** The banner of a command kept on the phone, under its `heading`, says
 * what waits for it, as the till's does (sale-slice TZ, P2-2). */
export async function waitsFor(page: Page, heading: RegExp): Promise<void> {
  await expect(
    page.locator("section.notice", {
      has: page.getByRole("heading", { name: heading }),
    }),
  ).toContainText("Поки чекаємо, інші дії недоступні.");
}

/** The count's question «Закрити касу: у касі …?» (spec S27; «Усе на
 * бірці» sections task list, P1-2), once it takes taps: a tap sooner than
 * 0.7 s after «Закрити касу» is let go as a double tap's second half. */
export async function closeSheet(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: /^Закрити касу: у касі / });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** «Так, закрити», pressed as a person presses it: the sum read first in
 * the sheet «Закрити касу» opened — the sheet's own button, or Telegram's
 * MainButton where it is. */
export async function confirmClose(page: Page): Promise<void> {
  const sheet = await closeSheet(page);
  const yes = sheet.getByRole("button", { name: "Так, закрити" });
  if ((await yes.count()) > 0) {
    await yes.click();
    return;
  }
  // Inside Telegram, its MainButton: the sheet draws none of its own.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
}

/** «Видати з каси» or «Внести в касу», a sheet over «Каса» or the count
 * (spec §6.29; «Усе на бірці» sections task list, P1-1), once it takes
 * taps. */
export async function moveSheet(
  page: Page,
  title: "Видати з каси" | "Внести в касу",
): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** A sum of the server's, «1850.00», as the app writes it: «1 850,00 грн»,
 * thousands apart by a no-break space, and «грн» too (sale-slice TZ, P2-1;
 * «Усе на бірці» task list, P0-1). */
export function grn(sum: string): string {
  const [whole = "0", fraction = "00"] = sum.split(".");
  return `${whole.replace(/\B(?=(\d{3})+$)/g, "\u00a0")},${fraction.padEnd(2, "0")}\u00a0грн`;
}

/** The day's first word on «Сьогодні»'s line: «Четвер, 22 жовтня». */
const weekday = "(Неділя|Понеділок|Вівторок|Середа|Четвер|П’ятниця|Субота)";

/**
 * Into a store's workspace. A person with one store is taken into it as the
 * app opens (redesign P0-1); with two or more, the door asks «Де ви
 * сьогодні?» (spec S06; «Усе на бірці» task list, P1-4), and this presses
 * the store's tag, named by its name and code. It waits for whichever
 * comes: the door, the workspace's sections, or the blank tag of a store
 * that does not trade.
 */
export async function openStore(
  page: Page,
  name: string | RegExp,
): Promise<void> {
  const choice = page.getByRole("button", { name });
  await expect(
    choice
      .or(page.getByRole("navigation", { name: "Розділи" }))
      // A store that does not trade: its blank tag, «Магазин …» its
      // title (stage 2, admin task list, P1-1) — not the door's or the
      // sign-in's «Спробувати ще раз» (review).
      .or(
        page
          .locator(".blank-tag")
          .filter({
            has: page.getByRole("heading", { name: /^Магазин /, level: 1 }),
          })
          .getByRole("button", { name: "Спробувати ще раз", exact: true }),
      )
      .first(),
  ).toBeVisible();
  if (!(await choice.isVisible())) return;
  // Asked at the door, whatever was chosen before (В6).
  await expect(
    page.getByRole("heading", { name: "Де ви сьогодні?", level: 1 }),
  ).toBeVisible();
  // The store chosen is the store opened: its name heads the line under
  // the screen's title, «{Магазин} · {Ім’я}» (redesign P1-6; «Усе на
  // бірці» task list, P0-4) — on «Сьогодні», the day of every store, the
  // day heads it (P0-6).
  const label = (await choice.innerText()).split("\n")[0]?.trim() ?? "";
  await choice.click();
  await expect(storeLine(page)).toHaveText(
    new RegExp(
      `^(${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${weekday}, \\d+ \\S+) · `,
    ),
  );
}

/** The bottom menu's tabs, each for whoever may open it; every other place
 * is under «Ще» («Усе на бірці» task list, P0-4). «Повернення» is
 * «Продаж»'s other way (navigation task list, P0-1); «Каса» is a tab for
 * whoever reads no report, a row of «Гроші» for whoever does. */
const tabs = ["Продаж", "Замовлення", "Каса"];

/** The screens «Гроші» opens for whoever has it, by the way to each there
 * («Усе на бірці» sections task list, P0-7): «Каса · {магазин}», the report's
 * row, the open store's line of the suppliers' place. */
const fromMoney: Record<string, (page: Page) => Locator> = {
  Каса: (page) =>
    page
      .getByRole("navigation", { name: "Гроші" })
      .getByRole("button", { name: /^Каса · / }),
  "Звіт про продажі": (page) =>
    page
      .getByRole("navigation", { name: "Гроші" })
      .getByRole("button", { name: "Звіт про продажі" }),
  // The open store's line: «Накладні» read it alone (money task list after
  // stage 2, P1-2).
  Накладні: (page) =>
    page
      .getByRole("article", { name: "Ви винні постачальникам" })
      .getByRole("button", { name: /^Накладні магазину / }),
};

/** «Ще»'s rows by the screen they open, where a journey still calls it by
 * its old name: «Приймання» is «Прийшов товар» (sections task list,
 * P1-4). */
const rows: Record<string, string> = {
  Приймання: "Прийшов товар",
};

/** A row of «Ще» by its label: what waits there is read after it — «Брак
 * 2 очікують перевірки», «Покупці ніхто не винен» («Усе на бірці» task
 * list, P1-5). */
export function rowNamed(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
}

/** «Товар і каталог»'s screens: a list of their own for whoever has two of
 * them or more. */
const catalogue = ["Перевірка каталогу", "Моделі", "Початкові залишки"];

/** The line under a store's screen's title, «{Магазин} · {Ім’я}» (spec
 * §6.2; «Усе на бірці» task list, P0-4): the shown screen's — an order's
 * card is kept, hidden, under its step's screen. */
export function storeLine(page: Page): Locator {
  return page.locator(".store-line > p").filter({ visible: true });
}

/** Every press from now on: a finger's, typing not counted — a path's
 * taps, as the hot-path budget counts them. */
export async function countTaps(page: Page): Promise<() => Promise<number>> {
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
  return () =>
    page.evaluate(() => (window as unknown as { taps: number }).taps);
}

/**
 * The till, as whoever reads the report reaches it as Бірка opens: on
 * «Сьогодні» first (owner decision, 2026-10-26, В3; «Усе на бірці» task
 * list, P0-6), then «Продаж». Whoever opened anywhere else stays there.
 */
export async function toTill(page: Page): Promise<void> {
  const today = page.getByRole("heading", { name: "Сьогодні", exact: true });
  await expect(today.or(menu(page)).first()).toBeVisible();
  // A kept operation turns to its own tab after the first frame: the screen
  // is read once it has.
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
  if (await today.isVisible())
    await menu(page)
      .getByRole("button", { name: "Продаж", exact: true })
      .click();
}

/**
 * A model's detail (spec S23; «Усе на бірці» sections task list, P0-6):
 * the till, its search settled on `query`, and the model's name on its
 * tag — «Показати ще» read until the tag is listed.
 */
export async function openModel(
  page: Page,
  query: string,
  name: string | RegExp,
): Promise<void> {
  await toTill(page);
  const answered = page.waitForResponse(
    (response) =>
      response.url().includes("/catalog/stock-options?") &&
      new URL(response.url()).searchParams.get("query") === query,
  );
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill(query);
  await answered;
  const open = page
    .getByRole("group", { name, exact: typeof name === "string" })
    .locator("button.model-open")
    .first();
  const more = page.getByRole("button", { name: "Показати ще" });
  while (!(await open.isVisible()) && (await more.isVisible())) {
    await more.click();
    await expect(
      open.or(more.and(page.locator("button:enabled"))).first(),
    ).toBeVisible();
  }
  await open.click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name,
      exact: typeof name === "string",
    }),
  ).toBeVisible();
}

/** One cell of a model's grid: a size's units at a warehouse, «total» for
 * «Разом»; `held`, its row of «з них у резерві». */
export function gridCell(
  page: Page,
  locationId: string,
  sizeId: string,
  held = false,
): Locator {
  return page.locator(
    `table.size-grid tr[data-${held ? "held" : "location"}="${locationId}"] td[data-size="${sizeId}"]`,
  );
}

/** What a model's grid shows in a cell, «·» read as none. */
export async function units(cell: Locator): Promise<number> {
  return Number(/\d+/.exec((await cell.textContent()) ?? "")?.[0] ?? "0");
}

/** The bottom menu (spec §6.2; «Усе на бірці» task list, P0-4). */
export function menu(page: Page): Locator {
  return page.getByRole("navigation", { name: "Розділи" });
}

/** The workspace's sections (redesign P1-6): the menu, and «Ще»'s own
 * screen — or «Товар і каталог»'s — while it is open (navigation task
 * list, P0-4). */
export function sections(page: Page): Locator {
  return page.getByRole("navigation", {
    name: /^(Розділи|Ще|Товар і каталог)$/,
  });
}

/**
 * «Ще»'s screen opened, if it is not already: every section but the
 * counter's is on it, by groups. A section looked for while it is not open
 * is never found, so a journey that says one is absent, or disabled, opens
 * it first.
 */
export async function more(page: Page): Promise<void> {
  const screen = page.getByRole("heading", { name: "Ще", exact: true });
  if (!(await screen.isVisible()))
    await menu(page)
      .getByRole("button", { name: /^Ще( — є що перевірити)?$/ })
      .click();
  await expect(screen).toBeVisible();
}

/** «Змінити магазин», on the workspace's line of any screen of a store
 * («Усе на бірці» task list, P0-4). */
export async function changeStore(page: Page): Promise<void> {
  await page
    .locator(".store-line")
    .getByRole("button", { name: "Змінити магазин" })
    .click();
}

/**
 * The till's ways under its heading, «Продати · Повернути · Внесок», by
 * whichever of them this person has (navigation task list, P0-1; «Усе на
 * бірці» task list, P0-3): named for a reader by the ways it holds.
 */
export function tillWays(page: Page): Locator {
  return page.getByRole("group", {
    name: /^(Продаж|Повернення)(, повернення)? або (повернення|внесок)$/,
  });
}

/**
 * A section opened as a person opens it: a tab of the menu — and its way
 * under it — any other from «Ще», by its row, or «Товар і каталог»'s.
 */
export async function section(page: Page, name: string): Promise<void> {
  if (name === "Повернення") {
    // «Продаж», then «Повернути» — for whoever only takes returns,
    // «Продаж» opens them, with no switch.
    await sections(page)
      .getByRole("button", { name: "Продаж", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Продаж", exact: true }),
    ).toBeVisible();
    const back = tillWays(page).getByRole("button", {
      name: "Повернути",
      exact: true,
    });
    if ((await back.count()) > 0) await back.click();
    // The till's heading stays; the field says the place («Усе на бірці»
    // task list, P1-3).
    await expect(
      page.getByRole("searchbox", { name: "Що повертають?" }),
    ).toBeVisible();
    return;
  }
  if (
    name === "Залишки" ||
    name === "Приймання" ||
    name === "Брак" ||
    name === "Інвентаризація"
  ) {
    // «Ще» › «Товар», then the row asked for (P0-4).
    await more(page);
    await page
      .getByRole("navigation", { name: "Ще" })
      .getByRole("button", { name: rowNamed(rows[name] ?? name) })
      .click();
    await expect(
      page.getByRole("heading", { name: rows[name] ?? name, exact: true }),
    ).toBeVisible();
    return;
  }
  if (name === "+ Нове замовлення") {
    // Beside «Замовлення»'s title, said in words (P0-2; stage 2, orders
    // task list, P1-4).
    await section(page, "Замовлення");
    await page
      .locator(".screen-title")
      .getByRole("button", { name: "Нове замовлення", exact: true })
      .click();
    return;
  }
  const tab = menu(page).getByRole("button", { name, exact: true });
  if (tabs.includes(name) && (await tab.count()) > 0) {
    await tab.click();
    return;
  }
  const money = menu(page).getByRole("button", { name: "Гроші", exact: true });
  const way = fromMoney[name];
  if (way && (await money.count()) > 0) {
    if (
      !(await page
        .getByRole("heading", { name: "Гроші", exact: true })
        .isVisible())
    )
      await money.click();
    await way(page).click();
    return;
  }
  await more(page);
  if (catalogue.includes(name)) {
    const group = page
      .getByRole("navigation", { name: "Ще" })
      .getByRole("button", { name: /^Товар і каталог/ });
    if ((await group.count()) > 0) await group.click();
  }
  await page
    .getByRole("navigation", { name: /^(Ще|Товар і каталог)$/ })
    .getByRole("button", { name: rowNamed(name) })
    .click();
}

/**
 * The next command sent to `pattern` — never a read of it — refused once,
 * for a reason no screen names: its form (422) or a conflict (409); the
 * shared words for those speak of an order, and every screen says its own
 * (owner decisions, 2026-10-24 and 2026-10-25). `details` as the server
 * would add them, e.g. `{ recorded: false }`.
 */
export async function refuseOnce(
  page: Page,
  pattern: string,
  status: 422 | 409,
  details: Record<string, unknown> = {},
): Promise<void> {
  let used = false;
  await page.route(pattern, async (route) => {
    if (used || route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    used = true;
    await route.fulfill({
      status,
      json:
        status === 422
          ? {
              code: "VALIDATION_ERROR",
              message: "Request failed validation",
              details,
            }
          : { code: "CONFLICT", message: "Conflict", details },
    });
  });
}

/** «Прийшов товар»: the warehouse's chip, where two or more take
 * deliveries and none is chosen (sections task list, P1-4). */
export async function receiveInto(page: Page, name: string): Promise<void> {
  await page
    .getByRole("group", { name: "Склад", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

/** «Прийшов товар»: a model from the catalogue, chosen. */
export async function receiveModel(
  page: Page,
  query: string,
  model: RegExp = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
): Promise<void> {
  await page.getByLabel("Пошук у каталозі").click();
  await page.getByLabel("Пошук у каталозі").fill(query);
  await page.getByRole("radio", { name: model }).click();
}

/** «Нова модель» (stage 2, goods task list, P0-1): the sheet over the
 * screen where the coat is in hand, once it takes taps. */
export async function newModelSheet(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: "Нова модель" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** «Нова пропозиція» in «Перевірка каталогу» (P1-1): the words as typed,
 * saved by «Далі», the catalogue's models offered, none chosen. */
export async function propose(page: Page, raw: string): Promise<Locator> {
  await page
    .getByRole("button", { name: "Нова пропозиція", exact: true })
    .click();
  const sheet = await newModelSheet(page);
  await sheet.getByLabel("Як записано").fill(raw);
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  return sheet;
}

/** «Нова модель»'s cell of a size the organisation has. */
export function sizeCell(sheet: Locator, code: string): Locator {
  return sheet
    .getByRole("group", { name: "Розміри" })
    .getByRole("button", { name: code, exact: true });
}

const systemWords = {
  ALPHA: "Літерна",
  NUMERIC_EU: "Числова EU",
  UNSPECIFIED: "Інша",
} as const;

/** «Іншого розміру немає — впишіть»: a size typed by hand, its system the
 * person's — unless the organisation has that size, which needs none
 * (ADR-0009 §2). */
export async function typeSize(
  sheet: Locator,
  code: string,
  system: keyof typeof systemWords,
): Promise<void> {
  await sheet.getByLabel("Іншого розміру немає — впишіть").fill(code);
  const systems = sheet.getByRole("group", { name: "Система розміру" });
  const add = sheet.getByRole("button", { name: "Додати розмір" });
  // The sizes read afresh may find it known as it is typed: the system is
  // asked until then.
  await expect(async () => {
    if (await systems.isVisible())
      await systems
        .getByRole("button", { name: systemWords[system], exact: true })
        .click({ timeout: 1000 });
    await expect(add).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await add.click();
}

/** «Додати модель · N розмір(и/ів)»: the sheet's one button. */
export function addModel(sheet: Locator): Locator {
  return sheet.getByRole("button", { name: /^Додати модель/ });
}

/** «Нова модель» left by «Назад» (Escape here). */
export async function leaveNewModel(sheet: Locator): Promise<void> {
  await sheet.press("Escape");
  await expect(sheet).toHaveCount(0);
}

/** «Прийшов товар»: a size's stepper, «S − 2 +». */
export function receiveSize(page: Page, code: string): Locator {
  return page.getByRole("group", { name: `Розмір ${code}`, exact: true });
}

/** «Прийшов товар»: a size's units, typed. */
export async function receiveUnits(
  page: Page,
  code: string,
  units: number,
): Promise<void> {
  await receiveSize(page, code).getByLabel(`${code}, шт.`).fill(String(units));
}

/** «Прийшов товар»'s «Як надійшов», opened from its row: a tap in it is
 * taken once the one that opened it is let go. */
export async function receiveWay(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^Як надійшов: / }).click();
  const sheet = page.getByRole("dialog", { name: "Як надійшов" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** «Як надійшов» closed by «Готово», what it holds kept. */
export async function receiveWayDone(sheet: Locator): Promise<void> {
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toHaveCount(0);
}

/** Where a supplier's field stands: `of` a form, when a screen has two —
 * «Постачальникам»'s filter and its return's form — or `inside` another
 * sheet («Як надійшов»), where its list opens in place. */
export interface SupplierField {
  of?: Locator;
  inside?: Locator;
}

/** The supplier field (stage 2, money task list, P0-3) tapped: its sheet
 * «Постачальник», once it takes taps — or, inside another sheet, its list
 * opened in place under it. */
export async function supplierList(
  page: Page,
  { of, inside }: SupplierField = {},
): Promise<Locator> {
  await (inside ?? of ?? page)
    .getByRole("button", { name: /^Постачальник / })
    .click();
  if (inside) {
    const list = inside.locator(".supplier-in-place");
    await expect(list).toBeVisible();
    return list;
  }
  const sheet = page.getByRole("dialog", { name: "Постачальник" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** A supplier on the network's list, picked: the field, its name typed in
 * the search, its row. */
export async function pickSupplier(
  page: Page,
  name: string,
  field: SupplierField = {},
): Promise<void> {
  const list = await supplierList(page, field);
  await list.getByRole("searchbox", { name: "Пошук постачальника" }).fill(name);
  await list
    .locator(".supplier-row")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await expect(list).toHaveCount(0);
}

/** A supplier added from the field: «Новий постачальник», its name and
 * phone, «Додати постачальника». Added, or found on the list, it is picked
 * and its list is gone. */
export async function addSupplier(
  page: Page,
  name: string,
  phone: string | null = null,
  field: SupplierField = {},
): Promise<void> {
  const list = await supplierList(page, field);
  await list
    .getByRole("button", { name: "Новий постачальник", exact: true })
    .click();
  await list.getByLabel("Назва постачальника").fill(name);
  if (phone !== null)
    await list.getByLabel("Телефон (необов’язково)").fill(phone);
  const add = list.getByRole("button", { name: "Додати постачальника" });
  // Its own sheet's main; in another sheet, whose foot or MainButton is,
  // the secondary (audit after stage 2, frame P1-1; review).
  if (field.inside) await expect(add).not.toHaveClass(/\bprimary\b/);
  else await expect(add).toHaveClass(/\bprimary\b/);
  await add.click();
  await expect(list).toHaveCount(0);
}

/** «Записати прихід · N шт.», the dock's one button outside Telegram. */
export function recordReceipt(page: Page, units: number): Locator {
  return page.getByRole("button", {
    name: `Записати прихід · ${String(units)} шт.`,
    exact: true,
  });
}

/** How many times a path `path` matches was read (GET) from now on: a
 * screen reading again what it shows after a conflict (review,
 * 2026-10-25). */
export function readsOf(page: Page, path: RegExp): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      path.test(new URL(request.url()).pathname)
    )
      count += 1;
  });
  return () => count;
}

/**
 * The till of a store that sells from `locationId` alone («Усе на бірці»
 * task list, P0-5): the store the specs share sells from many, and the till
 * now lists every one at once, a cell each, with no warehouse to choose.
 * The warehouses as the server lists them, every other one marked not sold
 * from — what the till and a new order read of them, and nothing else
 * does. Before the till is opened.
 */
export async function sellsFrom(page: Page, locationId: string): Promise<void> {
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as { id: string }[];
    await route.fulfill({
      response,
      json: rows.map((row) =>
        row.id === locationId ? row : { ...row, can_sell: false },
      ),
    });
  });
}

/**
 * A coat into the till's basket as a seller puts it (redesign P0-3): a tap
 * on its size cell, under its model's tag — of `locationId`'s, when every
 * warehouse is listed (a new order's, orders task list, P0-5). «Показати ще»
 * is read until the cell is listed: a warehouse the specs share holds more
 * than a page.
 */
export async function tapSize(
  page: Page,
  variantId: string,
  sizeId: string,
  locationId?: string,
): Promise<void> {
  const chip = page.locator(
    `button.size-cell[data-stock="${variantId}:${sizeId}"]${locationId ? `[data-location="${locationId}"]` : ""}`,
  );
  const more = page.getByRole("button", { name: "Показати ще" });
  for (;;) {
    await expect(page.getByText("Завантажуємо товари…")).toHaveCount(0);
    if (await chip.isVisible()) break;
    if (!(await more.isVisible())) break;
    // A search typed just before is answered under it: the list before it
    // stays, «Показати ще» held, and the answer takes the button away — even
    // between two looks. Looked at again once it is not held, never waited
    // on for good.
    const held = await more.isDisabled({ timeout: 1000 }).catch(() => null);
    if (held !== false) {
      await expect(more.and(page.locator("button:disabled"))).toHaveCount(0);
      continue;
    }
    if (
      !(await more.click({ timeout: 2000 }).then(
        () => true,
        () => false,
      ))
    )
      continue;
    // The next page read: the chip, or «Показати ще» again.
    await expect(
      chip.or(more.and(page.locator("button:enabled"))).first(),
    ).toBeVisible();
  }
  await chip.click();
}

/**
 * The basket's sheet over the till (spec §6.16; «Усе на бірці» task list,
 * P0-5), opened from the tray's row unless it is open already — once it
 * takes taps: a tap carried from what opened it is let go for a moment.
 */
export async function basketSheet(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: await trayOf(page) });
  if (!(await sheet.isVisible()))
    await page.locator(".till-tray .tray-basket").click();
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/**
 * The shelf's question over the till (spec §4.3; «Усе на бірці» task list,
 * P0-5), once it takes taps: a tap carried from the way pressed is let go
 * for a moment.
 */
export async function shortage(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: "Залишку не вистачає" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** The tray's sheet as it is named: the till's «Кошик», a new order's «У
 * замовленні» (stage 2, orders task list, P0-5). */
async function trayOf(page: Page): Promise<string> {
  return (await page.locator(".order-tray").count()) > 0
    ? "У замовленні"
    : "Кошик";
}

/** The basket's sheet closed by its «Готово», the tray under it again. */
export async function basketDone(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog", { name: await trayOf(page) });
  if (await sheet.isVisible()) {
    await expect(sheet).toHaveAttribute("data-ready", "");
    await sheet.getByRole("button", { name: "Готово", exact: true }).click();
  }
  await expect(sheet).toHaveCount(0);
}

/**
 * The basket's last line, as the seller sets it (redesign P0-3): «Більше»
 * until it holds as many, and the price typed over the one it started from
 * — in the tray's sheet (P0-5), the till's or a new order's (stage 2, orders
 * task list, P0-5), closed again by «Готово».
 */
export async function fillLine(
  page: Page,
  { quantity = 1, price }: { quantity?: number; price?: string },
): Promise<void> {
  const till = (await page.locator(".till-tray").count()) > 0;
  const line = (till ? await basketSheet(page) : page).locator(".line").last();
  for (let held = 1; held < quantity; held += 1)
    await line.getByRole("button", { name: "Більше" }).click();
  await expect(line.locator("output")).toHaveText(String(quantity));
  if (price !== undefined) await line.getByLabel("Ціна, грн").fill(price);
  if (till) await basketDone(page);
}

/**
 * A return's units counted as a seller counts them (returns task list,
 * P0-3): «Цілі: більше» and «Пошкоджені: більше», tapped, never typed — in
 * the tag of `line` when the sale has more than one. Each count is checked
 * as it ends.
 */
export async function returnUnits(
  page: Page,
  {
    intact = 0,
    damaged = 0,
    line,
  }: { intact?: number; damaged?: number; line?: string },
): Promise<void> {
  const tag = line
    ? page.getByRole("group", { name: line, exact: true })
    : page.locator(".line-return");
  for (const [name, times] of [
    ["Цілі", intact],
    ["Пошкоджені", damaged],
  ] as const) {
    for (let tapped = 0; tapped < times; tapped += 1)
      await tag.getByRole("button", { name: `${name}: більше` }).click();
    if (times > 0)
      await expect(
        tag.locator(".return-step", { hasText: name }).locator(".return-count"),
      ).toHaveText(String(times));
  }
}

/**
 * The paper switch ticked, and the paper said to be an outage's — or, with
 * `firstDays`, the first days', «з паперу» (owner decision, 2026-10-16):
 * nothing typed from paper is sent until the series says which it is. Said
 * in «З паперу», which the switch opens while the series has said nothing
 * (stage 2, orders task list, P0-4), or its row once it has; `named`, who
 * sold or took it, in the same sheet; then «Готово».
 */
export async function fromPaper(
  page: Page,
  label = "Вношу продаж з паперу",
  firstDays = false,
  named?: string,
): Promise<void> {
  const toggle = page.getByLabel(label);
  const was = await toggle.isChecked();
  await toggle.check();
  // Turned on, «З паперу» is open from that tap, never by the row behind it
  // (review, 2026-11-05); already on, its row opens it.
  const sheet = page.getByRole("dialog", { name: "З паперу" });
  if (was) await paperSheet(page);
  else await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet
    .getByRole("radio", {
      name: firstDays
        ? "Перші дні, до затвердження залишків"
        : "Сервер не відповідав",
    })
    .check();
  if (named !== undefined)
    await sheet.getByRole("radio", { name: named, exact: true }).check();
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toHaveCount(0);
}

/** «З паперу», open (stage 2, orders task list, P0-4): opened by the
 * switch, or else by the series' row; once it takes taps (`Sheet`). */
export async function paperSheet(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog", { name: "З паперу" });
  if ((await sheet.count()) === 0)
    await page.locator(".paper-series").first().click();
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** The series' row (stage 2, orders task list, P0-4): which paper, and who
 * is named under it — nobody named until the paper is said. */
export async function expectSeries(
  page: Page,
  title: string,
  meta: string | null,
): Promise<void> {
  const row = page.locator(".paper-series");
  await expect(row.locator(".paper-series-title")).toHaveText(title);
  if (meta === null) await expect(row.locator(".sale-meta")).toHaveCount(0);
  else await expect(row.locator(".sale-meta")).toHaveText(meta);
  // Its chevron the set's 16 in pencil, whatever is said, never a «›»
  // (audit after stage 2, frame P2-2; review).
  await expect(row).not.toContainText("›");
  const chevron = row.locator("svg.sale-open");
  await expect(chevron).toHaveCount(1);
  expect(
    await chevron.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--pencil)";
      document.body.append(probe);
      const pencil = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(node).color === pencil;
    }),
  ).toBe(true);
}

/** Who sold or took it, picked in «З паперу»; then «Готово». */
export async function namedFromPaper(page: Page, named: string): Promise<void> {
  const sheet = await paperSheet(page);
  await sheet.getByRole("radio", { name: named, exact: true }).check();
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toHaveCount(0);
}

/**
 * A result's stub as it reads (spec S11, S22; «Усе на бірці» task list,
 * P0-2): its way's sticker, what to do with the money, and the sum — with
 * «Зараз» before what is paid now in parts, «Разом» where the answer names
 * no way. `null`: not there at all.
 */
export async function expectStub(
  scope: Page | Locator,
  { way, say, sum }: { way: string | null; say: string | null; sum?: string },
): Promise<void> {
  const stub = scope.locator(".stub").first();
  await expect(stub).toBeVisible();
  if (way === null) await expect(stub.locator(".way-pill")).toHaveCount(0);
  else await expect(stub.locator(".way-pill")).toHaveText(way);
  if (say === null) await expect(stub.locator(".stub-say")).toHaveCount(0);
  else await expect(stub.locator(".stub-say")).toHaveText(say);
  if (sum !== undefined)
    await expect(stub.locator(".stub-sum")).toHaveText(sum);
}

/** A sticker's glyph beside its words and centred on them, 4 px apart
 * (stage 2, money task list, P2-1; review): never on the words' baseline,
 * never touching them. */
export async function expectGlyphBeside(sticker: Locator): Promise<void> {
  await expect(sticker.locator("svg.icon")).toHaveCount(1);
  const look = await sticker.evaluate((node) => {
    const icon = node.querySelector("svg.icon");
    if (icon === null) throw new Error("no glyph");
    const glyph = icon.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const words = document.createRange();
    const text = [...node.childNodes].find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
    );
    if (text === undefined) throw new Error("no words");
    words.selectNodeContents(text);
    const said = words.getBoundingClientRect();
    return {
      apart: said.left - glyph.right,
      off: Math.abs(glyph.top + glyph.height / 2 - (box.top + box.height / 2)),
    };
  });
  expect(look.apart).toBeGreaterThanOrEqual(3.5);
  expect(look.off).toBeLessThanOrEqual(1.5);
}

/**
 * Every sticker in `scope` the app's one sticker (spec §6.18; audit after
 * stage 2, frame P1-5): 28 high on one line (5 above and below a line of
 * 18, so a long one wraps a line of 18 more), the sticker's corner 3, a
 * word of 14/600, never shrunk — and every one with a meaning draws its
 * glyph of 16, so a colour is never all it says. At least one is there to
 * read. The height is the laid-out one: a stub's swing tilts its box.
 */
export async function expectOneSticker(scope: Page | Locator): Promise<void> {
  const stickers = scope.locator(".sticker:visible");
  await expect(stickers.first()).toBeVisible();
  for (const sticker of await stickers.all()) {
    const look = await sticker.evaluate((node) => {
      const style = getComputedStyle(node);
      const glyph = node.querySelector(":scope > svg.icon");
      const high = node instanceof HTMLElement ? node.offsetHeight : 0;
      return {
        words: `${node.textContent} (${String(high)})`,
        drawn: [
          high >= 28 && (high - 10) % 18 === 0,
          style.borderTopLeftRadius,
          style.fontSize,
          style.fontWeight,
        ],
        meaning: [...node.classList].some((name) =>
          /^tone-(?:debt|warn|kept|paid|match|transit|online)$/.test(name),
        ),
        glyph: glyph === null ? null : getComputedStyle(glyph).width,
      };
    });
    expect(look.drawn, look.words).toEqual([true, "3px", "14px", "600"]);
    if (look.meaning) expect(look.glyph, look.words).toBe("16px");
  }
}

/**
 * The display face drawn from the first paint, for a journey that measures
 * what fits in it. The app's face is `optional` (styles.css): a till never
 * redraws its sum when the face comes late, so on a busy runner a page may
 * keep the fallback for good — CI's frame of #166 drew «КОКОН ГРАФІТ» and
 * the grid in it. The same file, added by the page as `block`, is the one
 * drawn; the journey waits for `document.fonts.ready` before it measures.
 * Not on `about:blank`, which a journey may open first: the file has no
 * address there, and its refusal would be the page's (review).
 */
export async function shippedFace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (location.origin === "null") return;
    const face = new FontFace(
      "Fira Sans Extra Condensed",
      'url("/src/assets/fonts/fira-sans-extra-condensed-800.woff2") format("woff2")',
      { weight: "800", style: "normal", display: "block" },
    );
    document.fonts.add(face);
    void face.load();
  });
}

/**
 * A plate said at once, as drawn (stage 2, orders task list, P0-2): a
 * refusal in the error's colours with the crossed circle, what could not be
 * read in the warning's with the triangle — never a debt's, which is a
 * customer's debt alone. Its words at 4.5:1 and its glyph at 3:1, in
 * `theme` — its tokens proven to be that theme's — and the glyph beside the
 * first line of its words.
 */
export async function expectPlate(
  plate: Locator,
  kind: "refused" | "unread",
  theme: "light" | "dark" = "light",
): Promise<void> {
  const look = await plate.evaluate((node) => {
    const resolved = (value: string): string => {
      const probe = document.createElement("i");
      probe.style.color = value;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    const luminance = (colour: string): number => {
      const [r, g, b] = (colour.match(/[\d.]+/g) ?? []).map((c) => {
        const v = Number(c) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    const ratio = (fore: string, back: string): number => {
      const [a, b] = [luminance(fore), luminance(back)];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const own = getComputedStyle(node);
    const glyph = getComputedStyle(node, "::before");
    // The first line of its words, where the glyph stands beside it.
    const words = document
      .createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode: (text) =>
          text.textContent?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
      })
      .nextNode();
    const range = document.createRange();
    if (words) range.selectNodeContents(words);
    const line = range.getClientRects()[0];
    const middle =
      node.getBoundingClientRect().top +
      parseFloat(glyph.top) +
      parseFloat(glyph.height) / 2;
    return {
      ground: own.backgroundColor,
      words: own.color,
      glyph: glyph.backgroundColor,
      mask:
        glyph.getPropertyValue("mask-image") ||
        glyph.getPropertyValue("-webkit-mask-image"),
      size: [glyph.width, glyph.height],
      // Drawn at all: a glyph with no content is styled but never painted.
      drawn: glyph.content !== "none" && glyph.content !== "normal",
      owed: resolved("var(--owed)"),
      owedGround: resolved("var(--owed-bg)"),
      danger: resolved("var(--danger)"),
      dangerGround: resolved("var(--danger-bg)"),
      warning: resolved("var(--warning)"),
      warningGround: resolved("var(--warning-bg)"),
      text: ratio(own.color, own.backgroundColor),
      mark: ratio(glyph.backgroundColor, own.backgroundColor),
      beside: line !== undefined && middle >= line.top && middle <= line.bottom,
    };
  });
  // The error's own red of the theme asked for: light #b42318, dark
  // #ff8b80.
  expect(look.danger).toBe(
    theme === "dark" ? "rgb(255, 139, 128)" : "rgb(180, 35, 24)",
  );
  expect(look.beside).toBe(true);
  expect(look.ground).not.toBe(look.owedGround);
  expect(look.words).not.toBe(look.owed);
  expect(look.drawn).toBe(true);
  expect(look.size).toEqual(["20px", "20px"]);
  if (kind === "refused") {
    expect(look.ground).toBe(look.dangerGround);
    expect(look.words).toBe(look.danger);
    expect(look.glyph).toBe(look.danger);
    expect(look.mask).toContain("circle");
  } else {
    expect(look.ground).toBe(look.warningGround);
    expect(look.glyph).toBe(look.warning);
    expect(look.mask).toContain("M10.27");
  }
  expect(look.text).toBeGreaterThanOrEqual(4.5);
  expect(look.mark).toBeGreaterThanOrEqual(3);
}

/**
 * A list's row by spec §6.8 (audit after stage 2, frame P2-2): 64 high at
 * least, on its list's white block with sides of 16; its title 17/600 in
 * ink; its chevron the set's 16 in pencil, never a «›»; pressed, the fold
 * under it. `title` finds the row's title inside it.
 */
export async function listRow(
  page: Page,
  row: Locator,
  title: string,
): Promise<void> {
  const tokens = await page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const read = (name: string): string => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const said = { ink: read("--ink"), pencil: read("--pencil") };
    probe.style.backgroundColor = "var(--fold)";
    const fold = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { ...said, fold };
  });
  expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(64);
  expect(
    await row.evaluate((node) => [
      node.closest(".list-block") !== null,
      getComputedStyle(node).paddingLeft,
      getComputedStyle(node).paddingRight,
    ]),
  ).toEqual([true, "16px", "16px"]);
  // A hairline under it from its text's edge — 68 past two letters, 16
  // else; none under its block's last.
  expect(
    await row.evaluate((node) => {
      const block = node.closest(".list-block");
      const last = block?.lastElementChild?.contains(node) ?? false;
      const inset = node.querySelector(":scope > .debt-mark") ? 68 : 16;
      const style = getComputedStyle(node);
      return last
        ? style.backgroundImage === "none"
        : style.backgroundImage.startsWith("linear-gradient") &&
            style.backgroundPositionX === `${String(inset)}px` &&
            style.backgroundSize === `calc(100% - ${String(inset)}px) 1px`;
    }),
  ).toBe(true);
  expect(
    await row
      .locator(title)
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.fontSize, style.fontWeight, style.color];
      }),
  ).toEqual(["17px", "600", tokens.ink]);
  await expect(row).not.toContainText("›");
  const chevron = row.locator("svg.sale-open");
  await expect(chevron).toHaveCount(1);
  expect(
    await chevron.evaluate((node) => [
      node.getBoundingClientRect().width,
      getComputedStyle(node).color,
    ]),
  ).toEqual([16, tokens.pencil]);
  // Pressed: the fold under it; let go elsewhere, nothing opens.
  await row.hover();
  await page.mouse.down();
  expect(
    await row.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe(tokens.fold);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(row).toBeVisible();
}

/** The shared empty place (spec §6.28; audit after stage 2, frame P2-1):
 * the blank tag 64 square in the edge, its one line 17/600 in ink — one
 * markup wherever nothing is yet. */
export async function expectEmpty(
  empty: Locator,
  line: string | RegExp,
): Promise<void> {
  await expect(empty).toHaveClass(/(?:^|\s)orders-empty(?:\s|$)/);
  const mark = empty.locator(":scope > svg.orders-empty-mark");
  await expect(mark).toBeVisible();
  const box = await mark.boundingBox();
  expect([box?.width, box?.height]).toEqual([64, 64]);
  const said = await empty.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const read = (name: string): string => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const colours = { edge: read("--edge"), ink: read("--ink") };
    probe.remove();
    return colours;
  });
  await expect(mark).toHaveCSS("color", said.edge);
  const title = empty.locator(":scope > .t-row");
  await expect(title).toHaveText(line);
  await expect(title).toHaveCSS("font-size", "17px");
  await expect(title).toHaveCSS("font-weight", "600");
  await expect(title).toHaveCSS("color", said.ink);
}

/* «Початкові залишки»' list (goods task list after stage 2, P0-1). */

/** A way of the list's tag's ⋯, once its sheet takes a tap (goods task
 * list after stage 2, P0-1): «Додати файл», «Додати рядки вручну»,
 * «Файли списку · N», «Відхилити список». */
export async function listWay(page: Page, way: string | RegExp): Promise<void> {
  await page.getByRole("button", { name: "Дії зі списком" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: way }).click();
}

/** «Відхилити список», ⋯'s: why, then «Так, відхилити» in its sheet. */
export async function rejectList(page: Page, reason: string): Promise<void> {
  await listWay(page, "Відхилити список");
  const sheet = page.getByRole("dialog", { name: /^Відхилити «/ });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByLabel("Чому відхиляємо").fill(reason);
  await sheet.getByRole("button", { name: "Так, відхилити" }).click();
  await expect(sheet).toHaveCount(0);
}

/** A part removed on «Файли списку»: its question's sheet, «Так,
 * прибрати» (P0-1). */
export async function removePart(
  page: Page,
  part: Locator,
  button: string,
): Promise<Locator> {
  await part.getByRole("button", { name: button }).click();
  const sheet = page.getByRole("dialog", { name: `${button}?` });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: "Так, прибрати" }).click();
  return sheet;
}
