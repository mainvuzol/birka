import { test, expect, more, openStore, sections } from "./fixtures";
import type { Page } from "@playwright/test";
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

function launch(telegramUserId: string): string {
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
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

async function enter(page: Page, telegramUserId: string): Promise<void> {
  await page.goto(launch(telegramUserId));
  await openStore(page, "Основний MAIN");
}

function tab(page: Page) {
  return sections(page).getByRole("button", { name: /^Резервні копії/ });
}

/** «Ще», which holds the section and is marked as it is (redesign P1-6). */
function moreTab(page: Page) {
  return sections(page).getByRole("button", { name: /^Ще( ⚠)?$/ });
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
  // Seen before «Ще» is opened.
  await expect(moreTab(page)).toHaveText("Ще ⚠");
  await more(page);
  await expect(tab(page)).toHaveText("Резервні копії ⚠");
  await tab(page).click();

  const verdict = page.locator('[data-state="FAILED"]');
  await expect(
    verdict.getByRole("heading", { name: "Остання нічна копія не вдалася" }),
  ).toBeVisible();
  await expect(verdict).toContainText(
    "Копію зроблено, але перевірка відновленням не пройшла: залишки не сходяться з рухом товару.",
  );
  await expect(verdict).toContainText("Попередні копії не видалено.");
  await expect(verdict).toContainText("Остання вдала копія:");
  await expect(page.getByRole("alert")).toContainText(
    "бот не може вам написати. Відкрийте чат із ботом магазину й натисніть «Start»",
  );
  const nights = page.locator(".nights > li");
  await expect(nights).toHaveCount(3);
  await expect(nights.nth(0)).toContainText("не вдалася");
  await expect(nights.nth(1)).toContainText("перевірена");
  await expect(nights.nth(1)).toContainText("2,4 МБ");

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
    sections(page).getByRole("button", { name: "Залишки", exact: true }),
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
  await more(page);
  await expect(tab(page)).toHaveText("Резервні копії");
  await expect(verdict).toContainText("перевірена відновленням за 0,4 с.");
  await expect(verdict).toContainText("Розмір: 2,4 МБ.");
  await expect(page.getByText("Останнє повідомлення надіслано")).toBeVisible();
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
  await expect(
    page.getByText("Повідомлень ще не було. Бот напише вам"),
  ).toBeVisible();
});

test("a server never backed up says so plainly", async ({ page }) => {
  await serve(page, {
    state: "NOT_SET_UP",
    latest: null,
    last_good: null,
    nights: [],
  });
  await enter(page, fixture.owner_telegram_user_id);
  await expect(moreTab(page)).toHaveText("Ще ⚠");
  await more(page);
  await expect(tab(page)).toHaveText("Резервні копії ⚠");
  await tab(page).click();
  await expect(
    page
      .locator('[data-state="NOT_SET_UP"]')
      .getByRole("heading", { name: "Резервне копіювання ще не налаштоване" }),
  ).toBeVisible();
  await expect(page.locator(".nights")).toHaveCount(0);
});
