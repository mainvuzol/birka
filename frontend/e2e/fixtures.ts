import { test as base } from "@playwright/test";

/**
 * Playwright's `test`, except that a test's pages close only once the route
 * handlers it installed have answered.
 *
 * The app keeps talking after a test's last assertion — a sale, once written
 * down, reads the shelf again. A handler still busy with that request when
 * the context closes finds its fetched response disposed, and the error lands
 * on a test that passed. So the handlers are unrouted, waiting for any still
 * running, before the context goes.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await use(context);
    await Promise.all([
      context.unrouteAll({ behavior: "wait" }),
      ...context.pages().map((page) => page.unrouteAll({ behavior: "wait" })),
    ]);
  },
});

export { expect } from "@playwright/test";
