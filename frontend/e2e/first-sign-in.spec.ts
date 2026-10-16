import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * The first sign-in (sale-slice TZ, P1-3; owner, 2026-10-16): someone the
 * shop has not added is shown their Telegram ID — not a phone number —
 * with «Скопіювати ID», and told to open the app again from the bot once
 * added; launch data too old to sign in says the same, never a command
 * kept, since none can be before the sign-in. The server is stubbed.
 */

const telegramId = "777000444";

function launch(): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramId},"first_name":"Ірина"}`,
    hash: "0".repeat(64),
  });
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

/** The sign-in refused with `code`; whatever else is asked, a mistake. */
async function refused(page: Page, code: string): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      status: 404,
      json: { code: "NOT_FOUND", message: route.request().url() },
    });
  });
  await page.route("**/api/v1/client-errors", async (route) => {
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/auth/telegram", async (route) => {
    await route.fulfill({
      status: 401,
      json: { code, message: "refused" },
    });
  });
}

/** The phone's clipboard as the app sees it: what was copied, or a refusal,
 * or none at all. */
async function clipboard(
  page: Page,
  kind: "copies" | "refuses" | "absent",
): Promise<void> {
  await page.addInitScript((how) => {
    const copied = { text: null as string | null };
    Object.assign(window, { copied });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value:
        how === "absent"
          ? undefined
          : {
              writeText: (text: string) => {
                if (how === "refuses")
                  return Promise.reject(new Error("not allowed"));
                copied.text = text;
                return Promise.resolve();
              },
            },
    });
  }, kind);
}

/** How the element's text stands out of what is behind it (WCAG). */
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

async function noSideways(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("someone not yet added sees their Telegram ID, said not to be a phone number, and copies it with one tap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await clipboard(page, "copies");
  await refused(page, "NO_ACCESS");
  await page.goto(launch());
  await expect(
    page.getByRole("heading", { name: "Доступу ще немає" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `Ваш Telegram ID: ${telegramId} — це не номер телефону. Надішліть його власнику магазину. Коли вас додадуть, закрийте застосунок і відкрийте його знову кнопкою в боті.`,
    ),
  ).toBeVisible();
  await expect(page.getByText(/Ваш номер у Telegram/)).toHaveCount(0);
  await page.getByRole("button", { name: "Скопіювати ID" }).click();
  await expect(page.getByRole("status")).toHaveText("ID скопійовано.");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { copied: { text: string | null } }).copied.text,
    ),
  ).toBe(telegramId);
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
  await noSideways(page);

  // Dark, as Telegram may be: the same, readable on its own colours.
  await page.emulateMedia({ colorScheme: "dark" });
  const id = page.getByText(telegramId, { exact: true });
  await expect(id).toBeVisible();
  expect(await contrast(id)).toBeGreaterThanOrEqual(4.5);
  await noSideways(page);
});

test("where copying is refused, it says to select the ID; where the phone cannot copy, the ID is selected whole", async ({
  page,
}) => {
  await clipboard(page, "refuses");
  await refused(page, "NO_ACCESS");
  await page.goto(launch());
  await page.getByRole("button", { name: "Скопіювати ID" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Не вдалося скопіювати — виділіть ID і скопіюйте його.",
  );

  const other = await page.context().newPage();
  await clipboard(other, "absent");
  await refused(other, "NO_ACCESS");
  await other.goto(launch());
  await expect(
    other.getByRole("heading", { name: "Доступу ще немає" }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "Скопіювати ID" }),
  ).toHaveCount(0);
  const id = other.getByText(telegramId, { exact: true });
  await expect(id).toBeVisible();
  expect(
    await id.evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("all");
  await other.close();
});

test("launch data too old to sign in says to open the app again from the bot, and nothing of a kept command", async ({
  page,
}) => {
  // As the server refuses launch data past its hour (`INVALID_INIT_DATA`).
  await refused(page, "INVALID_INIT_DATA");
  await page.goto(launch());
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "Відкрийте застосунок знову кнопкою в боті вашого магазину.",
  );
  await expect(page.getByText(/Незавершену команду збережено/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
});
