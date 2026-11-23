import {
  changeStore,
  comeBack,
  test,
  expect,
  expectPressed,
  menu,
  openStore,
  section,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Signing in (owner decision, 2026-10-03): a seller stays signed in for 12
 * hours after opening the app, then closes it and opens it again in Telegram.
 * The server takes Telegram's launch data for an hour only, so the app signs
 * in with it once, and reads everything after that — what each store lets the
 * person do, after a store's state changed, on «Спробувати ще раз» — with
 * the token it was given.
 *
 * Launch data past its hour is played by answering every sign-in sent after
 * the app opened as the server answers it then.
 *
 * The network of stores.spec.ts: «Центр», and «Ринок» (Петро), which a
 * journey here blocks and opens again.
 */
interface Fixture {
  network_owner_telegram_user_id: string;
  network_centre_seller_telegram_user_id: string;
  network_market_seller_telegram_user_id: string;
  network_market_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const owner = fixture.network_owner_telegram_user_id;
const hanna = fixture.network_centre_seller_telegram_user_id;
const petro = fixture.network_market_seller_telegram_user_id;
const market = fixture.network_market_store_id;

function initData(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Тест"}`,
  });
  const check = [...fields]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

/** The app, opened from Telegram by this person. */
async function openAs(page: Page, telegramUserId: string): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId) }).toString()}`,
  );
}

/** Put a store in a state through the API, whatever state a journey left it in. */
async function settle(
  page: Page,
  store: string,
  state: "ACTIVE" | "BLOCKED",
): Promise<void> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(owner) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const stores = (await (
    await page.request.get("/api/v1/stores", { headers })
  ).json()) as { id: string; state: string }[];
  if (stores.find((s) => s.id === store)?.state === state) return;
  const changed = await page.request.post(`/api/v1/stores/${store}/state`, {
    headers,
    data: { command_id: randomUUID(), state, reason: "підготовка тесту" },
  });
  expect(changed.status()).toBe(200);
}

/**
 * From now on the launch data is past its hour: each sign-in the app sends is
 * refused as the server refuses it then, and counted.
 */
async function launchDataExpired(page: Page): Promise<{ sent: number }> {
  const signIns = { sent: 0 };
  await page.route("**/api/v1/auth/telegram", async (route) => {
    signIns.sent += 1;
    await route.fulfill({
      status: 401,
      json: { code: "INVALID_INIT_DATA", message: "init data has expired" },
    });
  });
  return signIns;
}

test("a sign-in refused for a reason the app does not name says how to sign in, never an order's words (owner decision, 2026-10-25)", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/telegram", async (route) => {
    await route.fulfill({
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "Request failed validation",
        details: {},
      },
    });
  });
  await openAs(page, owner);
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "Не вдалося увійти. Відкрийте застосунок знову кнопкою в боті вашого магазину.",
  );
});

test("the owner changes a store's state over an hour after opening the app, and keeps working", async ({
  page,
}) => {
  await settle(page, market, "ACTIVE");
  try {
    await openAs(page, owner);
    await openStore(page, "Центр CENTRE");
    const signIns = await launchDataExpired(page);
    await section(page, "Магазини");
    // Its own screen, the question a sheet (stage 2, admin task list, P0-3,
    // P0-4).
    await page.getByRole("button", { name: /^Магазин Ринок(, |$)/ }).click();
    const card = page.getByRole("article", { name: "Магазин Ринок" });
    await card.getByRole("button", { name: "Заблокувати" }).click();
    const sheet = page.getByRole("dialog", { name: "Заблокувати «Ринок»?" });
    await expect(sheet).toHaveAttribute("data-ready", "");
    await sheet.getByLabel(/^Причина/).fill("Ревізія каси");
    await sheet
      .getByRole("button", { name: "Так, заблокувати «Ринок»" })
      .click();
    await expect(card.locator(".store-tag-state")).toHaveText(
      /^Заблоковано з /,
    );

    // What the app knows of the stores is read again, with the token: the
    // door's question again (spec S06; «Усе на бірці» task list, P1-4).
    await changeStore(page);
    await expect(
      page.getByRole("heading", { name: "Де ви сьогодні?", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Ринок MARKET/ }),
    ).toContainText("Заблоковано власником з");
    await expect(
      page.getByRole("heading", { name: "Вхід через Telegram" }),
    ).toHaveCount(0);
    await openStore(page, "Центр CENTRE");
    await expect(
      page.getByRole("button", { name: "Продаж", exact: true }),
    ).toBeVisible();
    expect(signIns.sent).toBe(0);
  } finally {
    await settle(page, market, "ACTIVE");
  }
});

test("a seller at a blocked store reads it again with the token, however the reading goes", async ({
  page,
}) => {
  await settle(page, market, "BLOCKED");
  try {
    await openAs(page, petro);
    await openStore(page, /^Ринок MARKET/);
    await expect(
      page.getByText(/^Продажі, приймання, повернення й оплати тут зупинено\./),
    ).toBeVisible();
    const signIns = await launchDataExpired(page);
    // The first reading is lost on the way; the second finds the access
    // ended; by the third it is back.
    let reads = 0;
    let release = (): void => undefined;
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/api/v1/me", async (route) => {
      reads += 1;
      if (reads === 1) {
        await held;
        await route.abort("connectionreset");
      } else if (reads === 2)
        await route.fulfill({
          status: 401,
          json: { code: "NO_ACCESS", message: "No access" },
        });
      else await route.continue();
    });

    // Pressed, it keeps its look while the store is read again, the ring
    // turning before its words (audit 2026-11-22, frame P2-2).
    const again = page.getByRole("button", { name: "Спробувати ще раз" });
    await again.click();
    await expectPressed(again, "--link");
    await again.click({ force: true });
    release();
    // No answer: the shop sells on paper (owner decision, 2026-10-04), on
    // the paper's banner, never a refusal's red (audit 2026-11-22, frame
    // P2-1).
    await expect(page.locator("section.banner-paper")).toHaveText(
      "Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect(
      page.getByRole("heading", { name: "Доступу ще немає" }),
    ).toBeVisible();

    // Meanwhile the owner opened the store again.
    await settle(page, market, "ACTIVE");
    await page.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect(
      page.getByRole("button", { name: "Продаж", exact: true }),
    ).toBeVisible();
    expect(reads).toBe(3);
    expect(signIns.sent).toBe(0);
  } finally {
    await settle(page, market, "ACTIVE");
  }
});

test("a seller at a blocked store opens it with «Спробувати ще раз» once it trades again, never signing in anew (stage 2, admin task list, P1-1)", async ({
  page,
}) => {
  await settle(page, market, "BLOCKED");
  try {
    await openAs(page, petro);
    await openStore(page, /^Ринок MARKET/);
    await expect(
      page.getByRole("heading", { name: /^Магазин заблоковано власником з/ }),
    ).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    const signIns = await launchDataExpired(page);

    // Meanwhile the owner opened the store again.
    await settle(page, market, "ACTIVE");
    await page.getByRole("button", { name: "Спробувати ще раз" }).click();
    await expect(
      page.getByRole("button", { name: "Продаж", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".blank-tag")).toHaveCount(0);
    expect(signIns.sent).toBe(0);
  } finally {
    await settle(page, market, "ACTIVE");
  }
});

test("a session past its 12 hours asks for the app to be opened again in S02's words, says the unfinished is kept only where the phone keeps this person's, and never signs in with the old launch data (audit 2026-11-13, frame P2-6)", async ({
  page,
}) => {
  await settle(page, market, "BLOCKED");
  try {
    // From `refusing` on, the server refuses the token: each state of the
    // phone's storage is a new opening, read with a fresh token, whose
    // store's «Спробувати ще раз» meets the end (audit 2026-11-15, frame
    // P1-1: the end has none of its own to press).
    let refusing = false;
    let reads = 0;
    let signIns = 0;
    await page.route("**/api/v1/auth/telegram", async (route) => {
      if (refusing) signIns += 1;
      await route.fallback();
    });
    await page.route("**/api/v1/me", async (route) => {
      if (!refusing) {
        await route.fallback();
        return;
      }
      reads += 1;
      await route.fulfill({
        status: 401,
        json: { code: "SESSION_EXPIRED", message: "Session has expired" },
      });
    });
    let me = { organization_id: "", user_id: "" };
    const opened = async (): Promise<void> => {
      refusing = false;
      const read = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/me" && response.ok(),
      );
      await openAs(page, petro);
      me = (await (await read).json()) as typeof me;
      await openStore(page, /^Ринок MARKET/);
      await expect(
        page.getByRole("heading", { name: /^Магазин заблоковано власником з/ }),
      ).toBeVisible();
    };
    const ended =
      "Сесію завершено. Закрийте Бірку й відкрийте знову кнопкою в боті.";
    const kept = `${ended} Незавершене збережено.`;
    const keep = (name: string): Promise<void> =>
      page.evaluate((key) => {
        localStorage.setItem(key, "{}");
      }, name);
    const told = page.getByRole("alert");
    const end = async (words: string): Promise<void> => {
      refusing = true;
      await page.getByRole("button", { name: "Спробувати ще раз" }).click();
      await expect(told).toHaveText(words);
      await expect(
        page.getByRole("heading", { name: "Вхід через Telegram" }),
      ).toBeVisible();
      // Nothing to press: the same token would be refused again.
      await expect(
        page.getByRole("button", { name: "Спробувати ще раз" }),
      ).toHaveCount(0);
    };

    // Nothing kept on the phone: not a word of it.
    await opened();
    await end(ended);
    // This person's sale, kept in another store: kept.
    await opened();
    const sale = `birka:sale-pending:${me.organization_id}:${me.user_id}:${randomUUID()}`;
    await keep(sale);
    await end(kept);
    // Another person's sale, and one of another network's: not this one's.
    await opened();
    await page.evaluate((key) => {
      localStorage.removeItem(key);
    }, sale);
    await keep(
      `birka:sale-pending:${me.organization_id}:${randomUUID()}:${market}`,
    );
    await keep(`birka:sale-pending:${randomUUID()}:${me.user_id}:${market}`);
    await end(ended);
    // This person's order, its step sent and not answered: kept.
    await opened();
    await keep(`birka:pending:${me.organization_id}:${me.user_id}:${market}`);
    await end(kept);
    // The app coming back asks nothing with the refused token.
    await comeBack(page);
    await page.waitForTimeout(500);
    expect(reads).toBe(4);
    expect(signIns).toBe(0);
  } finally {
    await settle(page, market, "ACTIVE");
  }
});

for (const who of [
  { name: "a seller from the till", id: hanna, store: "", first: "Продаж" },
  {
    name: "the owner from «Сьогодні»",
    id: owner,
    store: "Центр CENTRE",
    first: "Сьогодні",
  },
])
  test(`a session that ends mid-work — ${who.name} — is one screen in S02's words: no menu, no plate, nothing to press, and nothing more asked with its token (audit 2026-11-15, frame P1-1)`, async ({
    page,
  }) => {
    await openAs(page, who.id);
    if (who.store) await openStore(page, who.store);
    await menu(page)
      .getByRole("button", { name: who.first, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: who.first, exact: true }),
    ).toBeVisible();
    // Whatever the screen reads as it opens is read before the end.
    await page.waitForLoadState("networkidle");
    // From now on the server refuses the token; launch data is never sent.
    let asked = 0;
    let signIns = 0;
    await page.route("**/api/v1/**", async (route, request) => {
      if (new URL(request.url()).pathname === "/api/v1/auth/telegram")
        signIns += 1;
      else asked += 1;
      await route.fulfill({
        status: 401,
        json: { code: "SESSION_EXPIRED", message: "Session has expired" },
      });
    });
    // The next read: «Гроші» opened.
    await menu(page)
      .getByRole("button", { name: "Гроші", exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveText(
      "Сесію завершено. Закрийте Бірку й відкрийте знову кнопкою в боті.",
    );
    await expect(
      page.getByRole("heading", { name: "Вхід через Telegram" }),
    ).toBeVisible();
    await expect(page.locator(".blank-tag")).toHaveCount(1);
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator(".read-failure")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Спробувати ще раз" }),
    ).toHaveCount(0);
    // At 360 × 640, light and dark: the title on one line, the screen whole
    // — nothing wider or taller than the phone.
    await page.setViewportSize({ width: 360, height: 640 });
    const title = page.getByRole("heading", { name: "Вхід через Telegram" });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(
        await title.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return new Set(
            [...range.getClientRects()].map((rect) => Math.round(rect.top)),
          ).size;
        }),
      ).toBe(1);
      expect(
        await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.scrollHeight,
        ]),
      ).toEqual([360, 640]);
    }
    await page.emulateMedia({ colorScheme: "light" });
    expect(asked).toBeGreaterThan(0);
    // Nothing more is asked with the refused token: not as the app comes
    // back, not by itself.
    const before = asked;
    await comeBack(page);
    await page.waitForTimeout(1000);
    expect(asked).toBe(before);
    expect(signIns).toBe(0);
  });

test("«Доступ до магазину закрито» mid-work is no session's end: the screen says it where it was read, as before (audit 2026-11-15, frame P1-1)", async ({
  page,
}) => {
  await openAs(page, hanna);
  await expect(menu(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      status: 401,
      json: { code: "NO_ACCESS", message: "No access" },
    });
  });
  await section(page, "Каса");
  await expect(
    page
      .locator(".read-failure")
      .getByText("Доступ до магазину закрито. Зверніться до власника."),
  ).toBeVisible();
  await expect(menu(page)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toHaveCount(0);
});

test("a sign-in refused for too many attempts says to wait, and the next one signs in", async ({
  page,
}) => {
  let refused = true;
  await page.route("**/api/v1/auth/telegram", async (route) => {
    if (refused)
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "60" },
        json: {
          code: "RATE_LIMITED",
          message: "Too many sign-in attempts from this address",
          details: { retry_after: 60 },
        },
      });
    else await route.continue();
  });
  await openAs(page, hanna);
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "Забагато спроб входу. Зачекайте хвилину й спробуйте ще раз.",
  );

  // No token yet: trying again signs in with the launch data.
  refused = false;
  await page.getByRole("button", { name: "Спробувати ще раз" }).click();
  // One store: the app opens on it (redesign P0-1).
  await expect(page.getByRole("navigation", { name: "Розділи" })).toBeVisible();
});
