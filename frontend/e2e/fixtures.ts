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

/** «Так, закрити», pressed as a person presses it: the sum read first. It
 * stands where «Закрити касу» stood, and a tap there sooner than 0.7 s after
 * «Закрити касу» is let go as a double tap's second half («Усе на бірці»
 * sections task list, P1-2). */
export async function confirmClose(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 800);
      }),
  );
  await page.getByRole("button", { name: "Так, закрити" }).click();
}

/** A sum of the server's, «1850.00», as the app writes it: «1 850,00 грн»,
 * thousands apart by a no-break space, and «грн» too (sale-slice TZ, P2-1;
 * «Усе на бірці» task list, P0-1). */
export function grn(sum: string): string {
  const [whole = "0", fraction = "00"] = sum.split(".");
  return `${whole.replace(/\B(?=(\d{3})+$)/g, "\u00a0")},${fraction.padEnd(2, "0")}\u00a0грн`;
}

/**
 * Into a store's workspace. A person with one store is taken into it as the
 * app opens (redesign P0-1); with two or more, the store is chosen, and this
 * presses its button. It waits for whichever comes: the choice, the
 * workspace's sections, or a store's state that offers only «Оновити».
 */
export async function openStore(
  page: Page,
  name: string | RegExp,
): Promise<void> {
  const choice = page.getByRole("button", { name });
  await expect(
    choice
      .or(page.getByRole("navigation", { name: "Розділи" }))
      .or(page.getByRole("button", { name: "Оновити", exact: true }))
      .first(),
  ).toBeVisible();
  if (!(await choice.isVisible())) return;
  // The store chosen is the store opened: its name heads the workspace's
  // line, «{Магазин} · {Ім’я}» (redesign P1-6).
  const label = (await choice.innerText()).split("\n")[0]?.trim() ?? "";
  await choice.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · `),
  );
}

/** The bottom menu's tabs, each for whoever may open it; every other place
 * is under «Ще» («Усе на бірці» task list, P0-4). «Повернення» is
 * «Продаж»'s other way (navigation task list, P0-1); «Каса» is a tab for
 * whoever reads no report, a row of «Ще» › «Гроші» for whoever does. */
const tabs = ["Продаж", "Замовлення", "Каса"];

/** «Ще»'s rows by the screen they open, where the row's word is not the
 * screen's: «Приймання товару» is «Прийшов товар», «Брак» says how many
 * wait under it. */
const rows: Record<string, string | RegExp> = {
  Приймання: "Прийшов товар",
  Брак: /^Брак( |$)/,
};

/** «Товар і каталог»'s screens: a list of their own for whoever has two of
 * them or more. */
const catalogue = ["Перевірка каталогу", "Моделі", "Початкові залишки"];

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
      .getByRole("button", { name: /^Ще( ⚠)?$/ })
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
      page.getByRole("heading", { name: /^(Продаж|Повернення)$/ }),
    ).toBeVisible();
    const back = tillWays(page).getByRole("button", {
      name: "Повернути",
      exact: true,
    });
    if ((await back.count()) > 0) await back.click();
    await expect(
      page.getByRole("heading", { name: "Повернення" }),
    ).toBeVisible();
    return;
  }
  if (name === "Залишки" || name === "Приймання" || name === "Брак") {
    // «Ще» › «Товар», then the row asked for (P0-4).
    await more(page);
    await page
      .getByRole("navigation", { name: "Ще" })
      .getByRole("button", { name: rows[name] ?? name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: name === "Приймання" ? "Приймання товару" : name,
        exact: true,
      }),
    ).toBeVisible();
    return;
  }
  if (name === "+ Нове замовлення") {
    // «+» in «Замовлення»'s heading (P0-2).
    await section(page, "Замовлення");
    await page
      .locator(".orders-head")
      .getByRole("button", { name: "Нове замовлення" })
      .click();
    return;
  }
  const tab = menu(page).getByRole("button", { name, exact: true });
  if (tabs.includes(name) && (await tab.count()) > 0) {
    await tab.click();
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
    .getByRole("button", { name, exact: true })
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
 * A coat into the till's basket as a seller puts it (redesign P0-3): a tap
 * on its size chip, under its model's tag — of `locationId`'s, when every
 * warehouse is listed (a new order's, orders task list, P0-5). «Ще товари»
 * is read until the chip is listed: a warehouse the specs share holds more
 * than a page.
 */
export async function tapSize(
  page: Page,
  variantId: string,
  sizeId: string,
  locationId?: string,
): Promise<void> {
  const chip = page.locator(
    `button.chip[data-stock="${variantId}:${sizeId}"]${locationId ? `[data-location="${locationId}"]` : ""}`,
  );
  const more = page.getByRole("button", { name: "Ще товари" });
  for (;;) {
    await expect(page.getByText("Завантажуємо товари…")).toHaveCount(0);
    if (await chip.isVisible()) break;
    if (!(await more.isVisible())) break;
    await more.click();
    // The next page read: the chip, or «Ще товари» again.
    await expect(
      chip.or(more.and(page.locator("button:enabled"))).first(),
    ).toBeVisible();
  }
  await chip.click();
}

/**
 * The basket's last line, as the seller sets it (redesign P0-3): «Більше»
 * until it holds as many, and the price typed over the one it started from.
 */
export async function fillLine(
  page: Page,
  { quantity = 1, price }: { quantity?: number; price?: string },
): Promise<void> {
  const line = page.locator(".line").last();
  for (let held = 1; held < quantity; held += 1)
    await line.getByRole("button", { name: "Більше" }).click();
  await expect(line.locator("output")).toHaveText(String(quantity));
  if (price !== undefined) await line.getByLabel("Ціна, грн").fill(price);
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
 * nothing typed from paper is sent until the series says which it is.
 */
export async function fromPaper(
  page: Page,
  label = "Вношу продаж з паперу",
  firstDays = false,
): Promise<void> {
  await page.getByLabel(label).check();
  await page
    .getByRole("radio", {
      name: firstDays
        ? "Перші дні, до затвердження залишків"
        : "Сервер не відповідав",
    })
    .check();
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
  if (sum !== undefined) await expect(stub.locator(".stub-sum")).toHaveText(sum);
}
