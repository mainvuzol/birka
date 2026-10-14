import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

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
  // The store chosen is the store opened: its name heads the workspace.
  const label = (await choice.innerText()).split("\n")[0]?.trim() ?? "";
  await choice.click();
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
    label,
  );
}
