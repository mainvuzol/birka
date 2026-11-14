import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * The first sign-in (sale-slice TZ, P1-3; owner, 2026-10-16): someone the
 * shop has not added is shown their Telegram ID — not a phone number —
 * with «Скопіювати ID», and told to open the app again from the bot once
 * added; launch data too old to sign in says the same, never a command
 * kept, since none can be before the sign-in. In the new system («Усе на
 * бірці» task list, P1-4): the opening's places with no menu (S02), the ID
 * large on a blank tag (S03), and the door's question for whoever has two
 * stores (S06). The server is stubbed.
 */

const telegramId = "777000444";

function launch(): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramId},"first_name":"Ірина","last_name":"Коваль"}`,
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

/** Whoever the server signs in, with these stores; whatever else is asked
 * of it, a mistake. `held`, the rights are not read until it is let go. */
async function signedIn(
  page: Page,
  stores: unknown[],
  held?: Promise<void>,
): Promise<void> {
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
      json: {
        access_token: "token",
        token_type: "bearer",
        expires_in: 43200,
        user_id: "00000000-0000-4000-8000-000000000001",
        organization_id: "00000000-0000-4000-8000-000000000002",
      },
    });
  });
  await page.route("**/api/v1/me", async (route) => {
    await held;
    await route.fulfill({
      json: {
        user_id: "00000000-0000-4000-8000-000000000001",
        organization_id: "00000000-0000-4000-8000-000000000002",
        display_name: "Ірина",
        organization_permissions: [],
        stores,
      },
    });
  });
}

/** A store of `signedIn`'s, trading unless said, where Ірина sells. */
function storeOf(
  name: string,
  code: string,
  state: "ACTIVE" | "BLOCKED" = "ACTIVE",
): unknown {
  return {
    id: `00000000-0000-4000-8000-0000000000${code === "CENTRE" ? "10" : "20"}`,
    name,
    code,
    state,
    state_since: state === "ACTIVE" ? null : "2026-10-20T09:00:00Z",
    permissions: state === "ACTIVE" ? ["sale:create", "inventory:view"] : [],
  };
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

test("someone not yet added sees their Telegram ID large on a blank tag, said not to be a phone number, copies its digits with one tap, and trying again without access says so (spec S03)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await clipboard(page, "copies");
  await refused(page, "NO_ACCESS");
  await page.goto(launch());
  const heading = page.getByRole("heading", {
    name: "Доступу ще немає",
    level: 1,
  });
  await expect(heading).toBeVisible();
  // Telegram's own name for the account, on this phone; no «Бірка» over
  // it, no menu: nothing here is anyone's yet.
  await expect(
    page.getByText("Ви відкрили Бірку як Ірина Коваль", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Бірка" })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText(
    "Цей акаунт Telegram не має доступу до жодного магазину.",
  );
  await expect(
    page.getByText("Ваш Telegram ID", { exact: true }),
  ).toBeVisible();
  // Its groups apart by their margins: the digits alone are its text.
  const id = page.getByText(telegramId, { exact: true });
  await expect(id).toBeVisible();
  await expect(id.locator("span")).toHaveText(["777", "000", "444"]);
  expect(
    await id.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.fontWeight];
    }),
  ).toEqual(["32px", "800"]);
  await expect(
    page.getByText("Це не номер телефону. Надішліть його власнику магазину.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Коли вас додадуть, закрийте застосунок і відкрийте його знову кнопкою в боті.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/Ваш номер у Telegram/)).toHaveCount(0);

  const copy = page.getByRole("button", { name: "Скопіювати ID" });
  expect((await copy.boundingBox())?.height).toBeGreaterThanOrEqual(52);
  await copy.click();
  await expect(page.getByRole("status")).toHaveText("ID скопійовано");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { copied: { text: string | null } }).copied.text,
    ),
  ).toBe(telegramId);
  await noSideways(page);

  // Tried again, still not added: said so, the same screen.
  let asked = 0;
  await page.route("**/api/v1/auth/telegram", async (route) => {
    asked += 1;
    await route.fulfill({
      status: 401,
      json: { code: "NO_ACCESS", message: "refused" },
    });
  });
  await page.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Доступу поки немає. Попросіть власника магазину додати ваш ID.",
  );
  expect(asked).toBe(1);
  await expect(heading).toBeVisible();
  await expect(id).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);

  // Dark, as Telegram may be: the same, readable on its own colours.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await contrast(id)).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrast(
        page.getByText(
          "Це не номер телефону. Надішліть його власнику магазину.",
          { exact: true },
        ),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    await noSideways(page);
  }
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
  // Nothing copied, nothing felt as copied.
  await expect(page.getByText("ID скопійовано")).toHaveCount(0);

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
  // On the same blank tag as «Доступу ще немає», its words as they were.
  await expect(
    page
      .locator(".blank-tag")
      .getByRole("heading", { name: "Вхід через Telegram", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Бірка" })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText(
    "Відкрийте застосунок знову кнопкою в боті вашого магазину.",
  );
  await expect(page.getByText(/збережено/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toBeVisible();
});

test("Бірка opening shows a first screen's places and no menu until the rights are read, then the first tab's places under the real menu (spec S02)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let rightsRead = (): void => undefined;
  await signedIn(
    page,
    [storeOf("Центр", "CENTRE")],
    new Promise<void>((done) => {
      rightsRead = done;
    }),
  );
  // The till's warehouses not read while it is looked at: its own places
  // stay.
  let warehousesRead = (): void => undefined;
  const warehouses = new Promise<void>((done) => {
    warehousesRead = done;
  });
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    await warehouses;
    await route.fulfill({ json: [] });
  });
  await page.goto(launch());
  await expect(page.getByRole("status")).toHaveText("Входимо в магазин…");
  const places = page.locator(".opening");
  const title = await places.locator(".skeleton-title").boundingBox();
  expect([title?.width, title?.height]).toEqual([180, 34]);
  expect((await places.locator(".skeleton-field").boundingBox())?.height).toBe(
    52,
  );
  await expect(places.locator(".sale-row")).toHaveCount(3);
  for (const row of await places.locator(".sale-row").all())
    expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(64);
  await expect(page.getByRole("heading")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);

  rightsRead();
  await expect(page.getByRole("navigation", { name: "Розділи" })).toBeVisible();
  await expect(places).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Продаж", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Завантажуємо склади…");
  warehousesRead();
  await page.unrouteAll({ behavior: "wait" });
});

test("whoever has two stores is asked «Де ви сьогодні?» at every opening, nothing chosen beforehand, both stores' tags whole on a small screen (spec S06's door)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await signedIn(page, [
    storeOf("Центр", "CENTRE"),
    storeOf("Ринок", "MARKET", "BLOCKED"),
  ]);
  await page.goto(launch());
  const door = page.getByRole("heading", { name: "Де ви сьогодні?", level: 1 });
  await expect(door).toBeVisible();
  await expect(
    page.getByText("Продажі запишуться на той магазин, у якому ви зараз.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const centre = page.getByRole("button", { name: /^Центр CENTRE/ });
  const market = page.getByRole("button", { name: /^Ринок MARKET/ });
  // A store that does not trade says so on its tag, in its words.
  await expect(market).toContainText("Заблоковано власником з");
  const chosenNone = async (): Promise<void> => {
    for (const tag of [centre, market]) {
      const box = await tag.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(96);
      expect((box?.y ?? 640) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
      await expect(tag).not.toBeFocused();
      for (const mark of ["aria-pressed", "aria-current", "aria-checked"])
        await expect(tag).not.toHaveAttribute(mark);
    }
  };
  await chosenNone();
  const name = centre.locator(".store-tag-name");
  expect(
    await name.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.fontWeight];
    }),
  ).toEqual(["22px", "700"]);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await contrast(name)).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrast(centre.getByText("CENTRE", { exact: true })),
    ).toBeGreaterThanOrEqual(4.5);
    await noSideways(page);
  }
  await page.emulateMedia({ colorScheme: "light" });

  await centre.click();
  await expect(page.getByRole("navigation", { name: "Розділи" })).toBeVisible();
  // Opened again: the same question, nothing remembered (В6).
  await page.goto("about:blank");
  await page.goto(launch());
  await expect(door).toBeVisible();
  await chosenNone();
});
