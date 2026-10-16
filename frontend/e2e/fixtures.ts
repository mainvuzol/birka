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

/** The counter's work, in the row of sections; every other is under «Ще». */
const counter = ["Продаж", "Повернення", "Борги", "Каса"];

/** The workspace's sections (redesign P1-6). */
export function sections(page: Page): Locator {
  return page.getByRole("navigation", { name: "Розділи" });
}

/**
 * «Ще» opened, if it is not already: every section but the counter's is
 * under it. A section looked for while «Ще» is closed is never found, so a
 * journey that says one is absent, or disabled, opens it first.
 */
export async function more(page: Page): Promise<void> {
  const button = sections(page).getByRole("button", { name: /^Ще( ⚠)?$/ });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

/**
 * A section opened as a person opens it: one of the counter's from the
 * row, any other from «Ще».
 */
export async function section(page: Page, name: string): Promise<void> {
  if (!counter.includes(name)) await more(page);
  await sections(page).getByRole("button", { name, exact: true }).click();
}

/**
 * A coat into the till's basket as a seller puts it (redesign P0-3): a tap
 * on its size chip, under its model's tag. «Ще товари» is read until the
 * chip is listed: a warehouse the specs share holds more than a page.
 */
export async function tapSize(
  page: Page,
  variantId: string,
  sizeId: string,
): Promise<void> {
  const chip = page.locator(`button.chip[data-stock="${variantId}:${sizeId}"]`);
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
