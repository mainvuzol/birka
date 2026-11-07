import { test, expect, more, openStore, sections } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  owner_telegram_user_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function launch(
  telegramUserId: string,
  theme?: Record<string, string>,
): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Власниця"}`,
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
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  return `/#${hash.toString()}`;
}

async function enter(
  page: Page,
  telegramUserId: string,
  theme?: Record<string, string>,
): Promise<void> {
  await page.goto(launch(telegramUserId, theme));
  await openStore(page, "Основний MAIN");
}

/** The verdict's eyelet: a knot when nothing is left to do, filled while
 * something waits for the owner (spec P3). */
function eyelet(verdict: Locator): Locator {
  return verdict.locator(".backups-eyelet .eyelet");
}

function tab(page: Page) {
  return sections(page).getByRole("button", { name: /^Резервні копії/ });
}

/** «Ще», which holds the section and is marked as it is (redesign P1-6). */
function moreTab(page: Page) {
  return sections(page).getByRole("button", {
    name: /^Ще( — є що перевірити)?$/,
  });
}

const hour = 3_600_000;
function night(hoursAgo: number, reasons: string[] = []) {
  const finished = new Date(Date.now() - hoursAgo * hour).toISOString();
  return {
    started_at: finished,
    finished_at: finished,
    ok: reasons.length === 0,
    archive: "birka-20260930T031500Z.dump.age",
    archive_bytes: 2_500_000,
    drill_ok: reasons.length === 0,
    restore_seconds: 0.42,
    reasons,
  };
}

/** A state the seed cannot hold at the same time as its own. */
async function serve(page: Page, body: object): Promise<void> {
  await page.route("**/api/v1/backups", async (route) => {
    await route.fulfill({
      json: {
        checked_at: new Date().toISOString(),
        due_hours: 26,
        your_last_message: null,
        ...body,
      },
    });
  });
}

test("the owner is shown last night's failed copy, and why Telegram did not say so", async ({
  page,
}) => {
  await enter(page, fixture.owner_telegram_user_id);
  // Seen before «Ще» is opened: a dot on its glyph, read with its name
  // («Усе на бірці» task list, P1-5).
  await expect(moreTab(page)).toHaveAccessibleName("Ще — є що перевірити");
  await expect(moreTab(page).locator(".tab-pill")).toHaveAttribute(
    "data-attention",
    "",
  );
  await more(page);
  await expect(tab(page)).toHaveAccessibleName(
    "Резервні копії потрібна ваша увага",
  );
  await tab(page).click();

  // One tag, the verdict its title, its eyelet filled: it waits for the
  // owner (stage 2, admin task list, P0-5).
  const verdict = page.locator('[data-state="FAILED"]');
  await expect(
    verdict.getByRole("heading", { name: "Остання нічна копія не вдалася" }),
  ).toBeVisible();
  await expect(verdict).toHaveClass(/tag-hero/);
  await expect(eyelet(verdict)).toHaveClass(/eyelet-filled/);
  await expect(verdict).toContainText(
    "Копію зроблено, але перевірка відновленням не пройшла: залишки не сходяться з рухом товару.",
  );
  await expect(verdict).toContainText("Попередні копії не видалено.");
  await expect(verdict).toContainText("Остання вдала копія:");
  // Telegram refused: a row that waits, never an alert read out at once —
  // the screen only reads.
  const telegram = page
    .locator(".today-tag")
    .filter({ has: page.locator('[data-telegram="REFUSED"]') });
  await expect(
    telegram.getByRole("heading", { name: "Сповіщення в Telegram" }),
  ).toBeVisible();
  await expect(telegram).toHaveClass(/tone-warning/);
  await expect(telegram).toContainText(
    "бот не може вам написати. Відкрийте чат із ботом магазину й натисніть «Start»",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The nights a thread, the newest first: a failed night's node in the
  // warning's colour, a checked one's a knot.
  const nights = page.locator(".nights > li");
  await expect(nights).toHaveCount(3);
  await expect(nights.nth(0)).toContainText("не вдалася");
  await expect(nights.nth(0).locator(".timeline-node")).toHaveClass(/warn/);
  await expect(nights.nth(1)).toContainText("перевірена");
  await expect(nights.nth(1)).toContainText("2,4 МБ");
  await expect(nights.nth(1).locator(".timeline-node")).toHaveClass(/knot/);
  // The explanation one line at the foot, as the owner approved it (В-А5 (а)).
  await expect(page.locator(".backups-about")).toHaveText(
    "Щоночі сервер робить копію бази, перевіряє її відновленням і шифрує вашим ключем. Цей розділ бачить лише власник.",
  );

  // A phone shows it without sideways scrolling.
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a seller, even holding every permission for the store, has no such section", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/backups")) asked.push(request.url());
  });
  await enter(page, fixture.telegram_user_id);
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: /^Товар і каталог/ }),
  ).toBeVisible();
  await expect(tab(page)).toHaveCount(0);
  await expect(moreTab(page)).toHaveText("Ще");
  expect(asked).toEqual([]);
});

test("copies in order leave the tab unmarked and say when and how big", async ({
  page,
}) => {
  const good = night(5);
  await serve(page, {
    state: "OK",
    latest: good,
    last_good: good,
    nights: [good],
    your_last_message: {
      kind: "RECOVERED",
      status: "SENT",
      created_at: good.finished_at,
      sent_at: good.finished_at,
      error: null,
    },
  });
  await enter(page, fixture.owner_telegram_user_id);
  await more(page);
  await tab(page).click();
  const verdict = page.locator('[data-state="OK"]');
  await expect(verdict.getByRole("heading")).toHaveText("Копії в порядку");
  // Read once the state has arrived: before it, the tab is unmarked anyway.
  await expect(moreTab(page)).toHaveText("Ще");
  await expect(moreTab(page).locator(".tab-pill")).not.toHaveAttribute(
    "data-attention",
  );
  await more(page);
  // In order: when the last copy ended, by this phone's clock (P1-5).
  await expect(tab(page)).toHaveAccessibleName(
    `Резервні копії в порядку, уночі о ${await page.evaluate(
      (at) =>
        new Date(at).toLocaleTimeString("uk-UA", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      good.finished_at,
    )}`,
  );
  // «Ще» is a screen of its own (navigation task list, P0-4): back to the
  // section from it.
  await tab(page).click();
  // Nothing left to do: a knot; what it rests on one line (P0-5).
  await expect(eyelet(verdict)).toHaveClass(/eyelet-knot/);
  await expect(verdict).toContainText(
    "перевірена відновленням за 0,4 с · 2,4 МБ",
  );
  // Telegram told: one line, when, by this phone's clock — no row waits.
  const told = await page.evaluate((at) => {
    const date = new Date(at);
    const day = date.toLocaleDateString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
    });
    const time = date.toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${day} о ${time}`;
  }, good.finished_at);
  await expect(page.locator('[data-telegram="SENT"]')).toHaveText(
    `Сповіщення в Telegram · останнє ${told}`,
  );
  await expect(page.locator(".backups-now .today-tag")).toHaveCount(0);
});

test("a schedule that stopped is told in hours since the last attempt", async ({
  page,
}) => {
  const last = night(50);
  await serve(page, {
    state: "OVERDUE",
    latest: last,
    last_good: last,
    nights: [last],
  });
  await enter(page, fixture.owner_telegram_user_id);
  await more(page);
  await tab(page).click();
  const verdict = page.locator('[data-state="OVERDUE"]');
  await expect(verdict.getByRole("heading")).toHaveText(
    "Копія не робилася вже 50 год",
  );
  await expect(verdict).toContainText("зупинився нічний розклад");
  await expect(eyelet(verdict)).toHaveClass(/eyelet-filled/);
  await expect(page.locator('[data-telegram="NONE"]')).toHaveText(
    "Сповіщення в Telegram · бот напише, щойно з копіями щось станеться",
  );
});

test("a server never backed up says so plainly", async ({ page }) => {
  await serve(page, {
    state: "NOT_SET_UP",
    latest: null,
    last_good: null,
    nights: [],
  });
  await enter(page, fixture.owner_telegram_user_id);
  await expect(moreTab(page)).toHaveAccessibleName("Ще — є що перевірити");
  await more(page);
  await expect(tab(page)).toHaveAccessibleName(
    "Резервні копії потрібна ваша увага",
  );
  await tab(page).click();
  await expect(
    page
      .locator('[data-state="NOT_SET_UP"]')
      .getByRole("heading", { name: "Резервне копіювання ще не налаштоване" }),
  ).toBeVisible();
  await expect(eyelet(page.locator('[data-state="NOT_SET_UP"]'))).toHaveClass(
    /eyelet-filled/,
  );
  await expect(page.locator(".nights")).toHaveCount(0);
});

/** Text against the first ground under it that is not transparent. */
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

/** Everything wrong at once: a failed night, the server not answering,
 * Telegram refusing — the most the screen ever holds. */
function failedEverywhere() {
  const now = Date.now();
  const at = (minutesAgo: number) =>
    new Date(now - minutesAgo * 60_000).toISOString();
  return {
    state: "FAILED",
    latest: night(5, [
      "Копію зроблено, але перевірка відновленням не пройшла: залишки не сходяться з рухом товару.",
    ]),
    last_good: night(29),
    nights: [
      night(5, [
        "Копію зроблено, але перевірка відновленням не пройшла: залишки не сходяться з рухом товару.",
      ]),
      night(29),
      night(53),
    ],
    your_last_message: {
      kind: "FAILED",
      status: "REFUSED",
      created_at: at(290),
      sent_at: null,
      error: "Forbidden: bot was blocked by the user",
    },
    server: {
      looked_at: at(2),
      open: [
        {
          kind: "NOT_ANSWERING",
          reason: "База даних не відповідає.",
          started_at: at(25),
          told_at: at(25),
        },
      ],
      recent: [
        {
          kind: "DISK_LOW",
          reason: "На диску сервера лишилося 9 % місця.",
          started_at: at(30 * 60),
          ended_at: at(27 * 60),
        },
      ],
    },
  };
}

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme at 360 × 640 the verdict is the first and largest thing, the first row of what is wrong now in view under it, everything at 4.5:1 and nothing wider than the phone (stage 2, admin task list, P0-5)`, async ({
    page,
  }) => {
    await serve(page, failedEverywhere());
    await page.setViewportSize({ width: 360, height: 640 });
    await enter(page, fixture.owner_telegram_user_id, theme);
    await more(page);
    await tab(page).click();
    const verdict = page.locator('[data-state="FAILED"]');
    const title = verdict.getByRole("heading", {
      name: "Остання нічна копія не вдалася",
    });
    await expect(title).toBeVisible();
    // First in the section, and its title larger than any other words on
    // the screen, the screen's own title among them.
    await expect(page.locator(".backups > *").first()).toHaveAttribute(
      "data-state",
      "FAILED",
    );
    const sizes = await page.evaluate(() => {
      const largest = { verdict: 0, rest: 0 };
      for (const node of document.querySelectorAll("main *")) {
        const own = [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE &&
            (child.textContent ?? "").trim() !== "",
        );
        if (!own) continue;
        const size = parseFloat(getComputedStyle(node).fontSize);
        if (node.closest(".backups-verdict h2")) largest.verdict = size;
        else largest.rest = Math.max(largest.rest, size);
      }
      return largest;
    });
    expect(sizes.verdict).toBeGreaterThan(sizes.rest);
    // The verdict whole and the first row's title in view, above the menu.
    const menuTop =
      (await page.getByRole("navigation", { name: "Розділи" }).boundingBox())
        ?.y ?? 640;
    const first = page
      .locator(".backups-now")
      .getByRole("heading", { name: "Сервер не відповідає" });
    for (const part of [verdict, first]) {
      const box = await part.boundingBox();
      expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(menuTop);
    }
    for (const part of [
      title,
      verdict.locator("p").first(),
      verdict.locator("li").first(),
      first,
      page.locator(".backups-now .today-tag-meta").first(),
      page.locator(".backups-now .backups-why").first(),
      page.locator("[data-watcher]"),
      page.getByRole("button", { name: "Минулі проблеми за 7 днів · 1" }),
      page.getByRole("heading", { name: "Сповіщення в Telegram" }),
      page.locator('[data-telegram="REFUSED"]'),
      page.locator(".nights .timeline-day").first(),
      page.locator(".nights .timeline-what").first(),
      page.locator(".nights .timeline-meta").first(),
      page.locator(".backups-about"),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({
      path: `test-results/backups-${name}.png`,
      fullPage: true,
    });
    // The week's troubles in their sheet, as readable.
    await page
      .getByRole("button", { name: "Минулі проблеми за 7 днів · 1" })
      .click();
    const sheet = page.getByRole("dialog", {
      name: "Минулі проблеми за 7 днів",
    });
    const lines = sheet.locator(".troubles li > span");
    await expect(lines).toHaveCount(3);
    for (const part of await lines.all())
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
  });

test("while the state is on its way the screen holds a tag's and three rows' shape, read as loading, and «Оновити» waits (stage 2, admin task list, P0-5)", async ({
  page,
}) => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const good = night(5);
  await page.route("**/api/v1/backups", async (route) => {
    await held;
    await route.fulfill({
      json: {
        checked_at: new Date().toISOString(),
        due_hours: 26,
        state: "OK",
        latest: good,
        last_good: good,
        nights: [good],
        your_last_message: null,
      },
    });
  });
  await enter(page, fixture.owner_telegram_user_id);
  await more(page);
  await tab(page).click();
  const wait = page.locator(".backups-wait");
  await expect(wait).toBeVisible();
  await expect(wait).toHaveAttribute("aria-hidden", "true");
  await expect(wait.locator(".tag-hero")).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: "Завантажуємо стан копій…" }),
  ).toBeAttached();
  await expect(page.getByRole("button", { name: "Оновити" })).toBeDisabled();
  await expect(page.locator(".backups-verdict")).toHaveCount(0);
  release();
  await expect(
    page.locator('[data-state="OK"]').getByRole("heading"),
  ).toHaveText("Копії в порядку");
  await expect(wait).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Оновити" })).toBeEnabled();
});
