import {
  expectFieldLine,
  expectFieldSaidWrong,
  expectListMore,
  test,
  expect,
  addModel,
  blockRow,
  expectFold,
  expectWarningPlate,
  feels,
  haptics,
  leaveNewModel,
  listRow,
  more,
  newModelSheet,
  openStore,
  propose,
  refuseOnce,
  rowTitle,
  section,
  sheetRow,
  sizeCell,
  tokenColour,
  typeSize,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  variant_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
function launch(version?: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${fixture.telegram_user_id},"first_name":"Оля"}`,
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
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
}
async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
}
/** «Нова пропозиція»: the sheet «Нова модель», its words as typed, not
 * sent yet (stage 2, goods task list, P0-1, P1-1). */
async function draft(page: Page, raw: string): Promise<Locator> {
  await page
    .getByRole("button", { name: "Нова пропозиція", exact: true })
    .click();
  const sheet = await newModelSheet(page);
  await sheet.getByLabel("Як записано").fill(raw);
  return sheet;
}
/** The proposal saved: the catalogue's models offered, none chosen. */
const create = propose;
const loran = "Лоран шоколад 70 см";
/** «Це вона» on a model offered. */
function itIs(where: Page | Locator, name = loran): Locator {
  return where.getByRole("button", { name: `Це вона: ${name}`, exact: true });
}
/** Each part's top and bottom, read in one frame (review). */
async function edges(
  where: Page,
  parts: Locator[],
): Promise<{ top: number; bottom: number }[]> {
  const nodes = await Promise.all(parts.map((part) => part.elementHandle()));
  return where.evaluate(
    (all) =>
      all.map((node) => {
        const box = (node as Element).getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    nodes,
  );
}

/**
 * A kept catalogue operation's stub under its screen's title and line, as
 * every own screen's (spec S12; audit 2026-11-18, goods P2-1): measured once
 * it has come to rest.
 */
async function stubUnder(where: Page, title: string): Promise<Locator> {
  const header = where.locator("header.screen-header").filter({
    has: where.getByRole("heading", { level: 1, name: title, exact: true }),
  });
  const stub = where.locator(".stub-notice").filter({
    has: where.getByRole("heading", {
      name: "Операцію каталогу ще не підтверджено",
    }),
  });
  await expect(header).toHaveCount(1);
  await expect(stub).toHaveCount(1);
  await stub
    .locator(":scope > .stub")
    .evaluate((node) =>
      Promise.all(
        node
          .getAnimations()
          .map((each) => each.finished.catch(() => undefined)),
      ),
    );
  const [top, box] = await edges(where, [header, stub]);
  if (!top || !box) throw new Error("not laid out");
  expect(top.bottom).toBeLessThanOrEqual(box.top + 0.5);
  return stub;
}
/** «Підтвердити: …», the one button once a model is chosen. */
function confirmAs(where: Page | Locator, name = loran): Locator {
  return where.getByRole("button", {
    name: `Підтвердити: ${name}`,
    exact: true,
  });
}
/** «Ні, це нова модель»: the model named, a letter size typed. */
async function newModel(
  sheet: Locator,
  name: string,
  size: string,
): Promise<void> {
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await typeSize(sheet, size, "ALPHA");
}
/** The proposal left in the sheet: its own screen. */
async function leave(page: Page): Promise<void> {
  await leaveNewModel(page.getByRole("dialog", { name: "Нова модель" }));
  await expect(page.getByRole("heading", { name: "Пропозиція" })).toBeVisible();
}
/** Telegram's MainButton pressed, where it is the screen's one button. */
async function pressMain(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
}

test("explicit catalog choice and opt-in alias feedback through real API", async ({
  page,
}) => {
  await enter(page);
  const id = randomUUID().slice(0, 8);
  const sheet = await create(page, `  Мій виріб для перевірки ${id}\n`);
  // None is chosen for the person: no confirmation until one is.
  await expect(sheet.getByRole("button", { name: /^Підтвердити/ })).toHaveCount(
    0,
  );
  await expect(itIs(sheet)).toHaveAttribute("aria-pressed", "false");
  await itIs(sheet).click();
  await expect(itIs(sheet)).toHaveAttribute("aria-pressed", "true");
  let feedbackCount = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/alias-feedback")) feedbackCount += 1;
  });
  await confirmAs(sheet).click();
  // Chosen: the proposal's own screen, said in the shop's words.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(`Модель обрано: ${loran}.`);
  // The name's answer is folded, never sent unasked.
  const fold = page.getByRole("button", { name: "Цей опис — назва товару?" });
  await expect(
    page.getByRole("button", { name: "Так, це його назва" }),
  ).toHaveCount(0);
  // The one fold (audit 2026-11-13, frame P2-3; review).
  await expectFold(
    fold,
    "Цей опис — назва товару?",
    page.locator(".catalog-name-fold"),
  );
  // The models it may name as a list's rows on its white block, each named
  // 17/600, its answer on its right (audit 2026-11-18, goods P2-5 (б)).
  const named = page.locator(".catalog-name-fold > .list-block > li");
  await expect(named.first()).toContainText(
    new RegExp(`^Обраний товар:\\s${loran}`),
  );
  for (const item of await named.all()) {
    await blockRow(item);
    const title = item.locator(".new-model-name strong");
    await rowTitle(title);
    const [name, answer] = await Promise.all([
      title.boundingBox(),
      item.getByRole("button").boundingBox(),
    ]);
    if (!name || !answer) throw new Error("not laid out");
    expect(answer.x).toBeGreaterThanOrEqual(name.x + name.width);
  }
  await page.setViewportSize({ width: 360, height: 640 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/catalog-name-rows-${scheme}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  expect(feedbackCount).toBe(0);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/alias-feedback") && r.status() === 200,
  );
  await page.getByRole("button", { name: "Так, це його назва" }).click();
  const body = (await (await response).json()) as {
    status: string;
    confirm_count: number;
  };
  expect(body.status).toBe("LEARNING");
  expect(body.confirm_count).toBe(1);
  // Said in the shop's words, the description as its name (stage 2, goods
  // task list, P2-2); the proposal stays on the screen.
  await expect(
    page.getByRole("status").filter({ hasText: /^Збережено/ }),
  ).toHaveText(
    new RegExp(
      `^Збережено: «Мій виріб для перевірки ${id}» — назва Лоран шоколад 70 см`,
    ),
  );
  await expect(fold).toBeVisible();
  await expect(page.getByText(/свідчен/i)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/catalog-confirmed-mobile.png",
    fullPage: true,
  });
});

test("reject proposal and retrieve its preserved reason from history", async ({
  page,
}) => {
  const raw = `Помилковий запис ${randomUUID().slice(0, 8)}`;
  await enter(page);
  await create(page, raw);
  await leave(page);
  // «Відхилити» is a sheet, the reason in it (P1-1).
  await page.getByRole("button", { name: "Відхилити", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Відхилити пропозицію" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  const reject = sheet.getByRole("button", { name: "Відхилити", exact: true });
  await expect(reject).toBeDisabled();
  await sheet.getByLabel("Причина відхилення").fill("Це інша модель");
  // Refused for a reason it does not name: what was not done, then what to
  // check — never «спробуйте ще раз» (owner, В-П1 (б)); the reason kept.
  await refuseOnce(page, "**/api/v1/catalog/match-decisions/*/reject", 404);
  await reject.click();
  await expect(
    sheet.getByText(
      "Операцію каталогу не записано. Перевірте причину відхилення.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(sheet.getByLabel("Причина відхилення")).toHaveValue(
    "Це інша модель",
  );
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/reject") && r.status() === 200,
  );
  await reject.click();
  await response;
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText("Причина відхилення: Це інша модель", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
  const states = page.getByRole("group", { name: "Стан пропозицій" });
  await expect(states.getByRole("button")).toHaveText([
    "Чекають",
    "Підтверджені",
    "Відхилені",
  ]);
  await expect(states.getByRole("button", { name: "Чекають" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await states.getByRole("button", { name: "Відхилені" }).click();
  // A row: its words in quotes, its sticker.
  const row = page
    .getByRole("list", { name: "Пропозиції" })
    .getByRole("button", { name: new RegExp(raw) });
  await expect(row).toHaveText(`«${raw}»Відхилено`);
  // A list's row on the queue's white block, its chevron to the proposal
  // (audit 2026-11-15, goods P2-2).
  await listRow(page, row, ".catalog-raw");
  await row.click();
  await expect(
    page.getByText("Причина відхилення: Це інша модель", { exact: true }),
  ).toBeVisible();
});

test("a proposal whose candidates' list was cut says so on a warning's plate, in the sheet and on its screen while it waits; settled, it says nothing (audit 2026-11-15, goods P2-1; frame P2-8)", async ({
  page,
}) => {
  const raw = `Обрізаний список ${randomUUID().slice(0, 8)}`;
  // The server cut the list: every answer that carries the proposal says so.
  await page.route("**/api/v1/catalog/match-decisions**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json().catch(() => null)) as {
      preview?: { truncated: boolean };
    } | null;
    if (!body?.preview) {
      await route.fulfill({ response });
      return;
    }
    body.preview.truncated = true;
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  const sheet = await create(page, raw);
  const plate = (where: Locator): Locator =>
    where.locator(".notice.warning-plate", {
      hasText: "Список кандидатів обмежено.",
    });
  // Standing from the sheet's step: no role, read in its place; its lead
  // first, in the warning's words.
  await expect(plate(sheet)).not.toHaveAttribute("role");
  await expect(plate(sheet).locator(".notice-lead")).toHaveText(
    "Список кандидатів обмежено.",
  );
  await expect(plate(sheet).locator("p").nth(1)).toHaveText(
    "Не обирайте товар лише через схожість назви.",
  );
  await expectWarningPlate(plate(sheet));
  await leave(page);
  const screen = page.locator(".catalog-proposal-screen");
  await expect(plate(screen)).toHaveCount(1);
  await expect(plate(screen)).not.toHaveAttribute("role");
  await expect(plate(screen).locator(".notice-lead")).toHaveCSS(
    "font-weight",
    "600",
  );
  await expectWarningPlate(plate(screen));
  // Settled, the list's cut is no longer a choice to warn about.
  await page.getByRole("button", { name: "Відхилити", exact: true }).click();
  const reject = page.getByRole("dialog", { name: "Відхилити пропозицію" });
  await expect(reject).toHaveAttribute("data-ready", "");
  await reject.getByLabel("Причина відхилення").fill("Інша модель");
  await reject.getByRole("button", { name: "Відхилити", exact: true }).click();
  await expect(reject).toHaveCount(0);
  await expect(
    page.getByText("Причина відхилення: Інша модель", { exact: true }),
  ).toBeVisible();
  await expect(plate(page)).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
});

test("lost proposal response survives reopening with the same UUID", async ({
  page,
  context,
}) => {
  await enter(page);
  const sheet = await draft(page, "Запис зі зниклою відповіддю");
  const ids: string[] = [];
  await context.route("**/api/v1/catalog/match-decisions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    ids.push(
      (route.request().postDataJSON() as { decision_id: string }).decision_id,
    );
    if (ids.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  // Kept, it is said in the sheet that sent it, as every kept operation
  // (goods task list after stage 2, P1-4): one check, nothing to cancel.
  await expect(
    sheet.getByRole("button", { name: "Перевірити результат операції" }),
  ).toBeEnabled();
  await expect(sheet.locator(".stub-notice").getByRole("button")).toHaveText([
    "Перевірити результат операції",
  ]);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(launch());
  await openStore(reopened, "Основний MAIN");
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3): its proposal's own screen.
  await expect(
    reopened.getByRole("heading", { name: "Пропозиція" }),
  ).toBeVisible();
  await expect(itIs(reopened)).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test("a proposal kept on the phone is felt once, a warning; its later checks, lost again or answered, nothing (spec §4.4; «Усе на бірці» task list, P1-2)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
    };
    host.buzzes = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
      },
    };
  });
  // The answers' buzzes: the store's door is a choice.
  const buzzes = async (): Promise<unknown[]> =>
    (
      await page.evaluate(
        () => (window as unknown as { buzzes: string[] }).buzzes,
      )
    )
      .map((data) => JSON.parse(data) as { type: string })
      .filter((buzz) => buzz.type === "notification");
  await page.goto(launch("6.1"));
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
  const sheet = await draft(page, "Запис, що чекає відповіді");
  let posts = 0;
  await page.route("**/api/v1/catalog/match-decisions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts += 1;
    if (posts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else if (posts === 2) await route.abort("failed");
    else await route.continue();
  });
  // The second check's look at the proposal is lost too: kept still.
  let looks = 0;
  await page.route("**/api/v1/catalog/match-decisions/*", async (route) => {
    if (posts === 2 && looks++ === 0) await route.abort("failed");
    else await route.continue();
  });
  // Telegram's MainButton is the sheet's «Далі» here.
  await expect(sheet.getByRole("button", { name: "Далі" })).toHaveCount(0);
  await pressMain(page);
  const again = sheet.getByRole("button", {
    name: "Перевірити результат операції",
  });
  await expect(again).toBeEnabled();
  const warned = [{ type: "notification", notification_type: "warning" }];
  expect(await buzzes()).toEqual(warned);
  await again.click();
  await expect.poll(() => looks).toBe(1);
  await expect(again).toBeEnabled();
  expect(await buzzes()).toEqual(warned);
  await again.click();
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  expect(await buzzes()).toEqual(warned);
});

test("inside Telegram a model offered, chosen, is felt as a choice — never the one chosen tapped again — in «Нова модель»'s sheet and on «Пропозиція»'s screen; for «Інший колір нашої моделі» a similar model's chip and a model found felt too (audit 2026-11-15, goods P2-3); a typed size's system felt as it changes (audit 2026-11-18, goods P2-5 (в))", async ({
  page,
}) => {
  const felt = await haptics(page);
  const selection = { type: "selection_change" };
  await page.goto(launch("8.0"));
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
  // Its words the catalogue's «Лоран»'s, so it is offered among many.
  const sheet = await draft(
    page,
    `Лоран шоколад відчутна ${randomUUID().slice(0, 8)}`,
  );
  // Telegram's MainButton is the sheet's «Далі».
  await pressMain(page);
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  await feels(felt, () => itIs(sheet).click(), [selection]);
  await expect(itIs(sheet)).toHaveAttribute("aria-pressed", "true");
  await feels(felt, () => itIs(sheet).click(), []);
  // Its own screen: the same.
  await leave(page);
  await feels(felt, () => itIs(page).click(), [selection]);
  await expect(itIs(page)).toHaveAttribute("aria-pressed", "true");
  await feels(felt, () => itIs(page).click(), []);
  // «Створити нову», another colour of a model the catalogue has: a similar
  // model's chip, then a model found, each felt.
  await page.getByRole("button", { name: "Створити нову" }).click();
  const making = await newModelSheet(page);
  // A size typed by hand asks its system: a system chosen is felt, the one
  // chosen tapped again nothing (audit 2026-11-18, goods P2-5 (в)).
  await making
    .getByLabel("Іншого розміру немає — впишіть")
    .fill(`Q${randomUUID().slice(0, 6)}`);
  const systems = making.getByRole("group", { name: "Система розміру" });
  const letters = systems.getByRole("button", { name: "Літерна", exact: true });
  await feels(felt, () => letters.click(), [selection]);
  await expect(letters).toHaveAttribute("aria-pressed", "true");
  await feels(felt, () => letters.click(), []);
  await feels(
    felt,
    () => systems.getByRole("button", { name: "Числова EU" }).click(),
    [selection],
  );
  await making
    .getByRole("group", { name: "Яка модель" })
    .getByRole("button", { name: "Інший колір нашої моделі" })
    .click();
  await feels(
    felt,
    () =>
      making
        .getByRole("group", { name: "Схожі моделі" })
        .getByRole("button")
        .first()
        .click(),
    [selection],
  );
  await expect(making.getByText(/^Модель: /)).toBeVisible();
  await making.getByRole("button", { name: "Інша модель" }).click();
  // Found by its name, not its colour.
  await making.getByLabel("Пошук моделі в каталозі").fill("Лоран");
  await feels(
    felt,
    () =>
      making
        .getByRole("button", { name: /^Обрати модель: Лоран/ })
        .first()
        .click(),
    [selection],
  );
  await expect(making.getByText(/^Модель: /)).toBeVisible();
});

test("a proposal kept on the phone asks before Бірка closes, never while its first send is on its way, and lets it go once its check answers it (audit 2026-11-13, frame P2-5)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      closing: unknown[];
    };
    host.closing = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_closing_behavior")
          host.closing.push(JSON.parse(data) as unknown);
      },
    };
  });
  const closing = (): Promise<unknown> =>
    page.evaluate(() =>
      (window as unknown as { closing: unknown[] }).closing.at(-1),
    );
  await page.goto(launch("8.0"));
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
  const sheet = await draft(page, "Запис, що питає перед закриттям");
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  await page.route("**/api/v1/catalog/match-decisions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts += 1;
    if (posts === 1) {
      await gate;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/catalog/match-decisions",
  );
  await pressMain(page);
  await sent;
  // On its way the first time: the sheet's to say, nothing asked.
  expect(await closing()).toBeUndefined();
  release();
  const again = sheet.getByRole("button", {
    name: "Перевірити результат операції",
  });
  await expect(again).toBeEnabled();
  await expect.poll(closing).toEqual({ need_confirmation: true });
  await again.click();
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  await expect.poll(closing).toEqual({ need_confirmation: false });
});

test("catalog change rejects stale confirmation through real API", async ({
  page,
}) => {
  let authorization = "";
  page.on("request", (request) => {
    if (request.url().endsWith("/api/v1/me"))
      authorization = request.headers()["authorization"] ?? "";
  });
  await enter(page);
  const sheet = await create(page, "Запис для перевірки актуальності");
  await itIs(sheet).click();
  const mutation = await page.request.post("/api/v1/catalog/products", {
    headers: { Authorization: authorization, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      concept: `Нова модель ${randomUUID()}`,
      variant: { color: "чорний" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(mutation.status()).toBe(201);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/confirm") && r.status() === 409,
  );
  await confirmAs(sheet).click();
  await response;
  await expect(sheet.getByRole("alert")).toContainText(
    /зміни|застар|нову пропозицію/i,
  );
  await expect(
    page.getByRole("button", { name: "Цей опис — назва товару?" }),
  ).toHaveCount(0);
});

test("«Нова пропозиція» is said as «+ Нове замовлення»: in words, its «+» before them, the link's colour on nothing — by the title or under it, one line, at 360 and 390; never on a proposal's own screen (audit 2026-11-20, goods P2-2)", async ({
  page,
}) => {
  const make = page.getByRole("button", {
    name: "Нова пропозиція",
    exact: true,
  });
  const title = page.getByRole("heading", {
    name: "Перевірка каталогу",
    level: 1,
  });
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await enter(page);
    await expect(make).toHaveText("Нова пропозиція");
    await expect(make).toHaveClass(/\bhead-add\b/);
    await expect(make.locator("svg.icon")).toHaveCount(1);
    expect(
      await make.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.borderTopWidth, style.backgroundColor];
      }),
    ).toEqual(["0px", "rgba(0, 0, 0, 0)"]);
    await expect(make).toHaveCSS("color", await tokenColour(page, "--link"));
    await expect(make).toBeInViewport({ ratio: 1 });
    const [said, place] = await Promise.all([
      title.boundingBox(),
      make.boundingBox(),
    ]);
    if (!said || !place) throw new Error("not laid out");
    // One line, 44 high; beside the title or under it, never over it.
    expect(place.height).toBeGreaterThanOrEqual(44);
    expect(place.height).toBeLessThanOrEqual(45);
    expect(
      place.x >= said.x + said.width - 1 || place.y >= said.y + said.height - 1,
    ).toBe(true);
    expect(
      await title.evaluate(
        (node) =>
          node.getBoundingClientRect().height <
          parseFloat(getComputedStyle(node).lineHeight) * 1.5,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/catalog-new-proposal-${String(width)}.png`,
    });
  }
  // What it does, as before: the sheet «Нова модель»; and on a proposal's
  // own screen it is not.
  await create(page, `Шапка ${randomUUID().slice(0, 8)}`);
  await leave(page);
  await expect(make).toHaveCount(0);
});

test("«Схожі» says what tells a model apart as the proposal's rows do: «Відмінність моделі: …» under its name, at most two lines at 360 in both themes, «Це вона» beside it choosing that model (audit 2026-11-20, goods P2-3 (а))", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // The catalogue's first «Лоран» told apart by a word of its own, as the
  // server says it of a model with a distinction — in the proposal read
  // once it is sent, which the sheet shows.
  await page.route("**/api/v1/catalog/match-decisions/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      preview: { candidates: { distinction_note: string | null }[] };
    };
    const first = body.preview.candidates[0];
    if (first) first.distinction_note = "довге";
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  const sheet = await create(
    page,
    `Лоран шоколад відмінність ${randomUUID().slice(0, 8)}`,
  );
  const row = sheet.locator(".new-model-candidates > li").first();
  const told = row.locator(".new-model-name .t-meta");
  await expect(told).toHaveText("Відмінність моделі: довге");
  const it = row.getByRole("button", { name: /^Це вона: / });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(told).toHaveCSS("font-size", "14px");
    const [name, line, way] = await Promise.all([
      row.locator(".new-model-name").boundingBox(),
      told.boundingBox(),
      it.boundingBox(),
    ]);
    if (!name || !line || !way) throw new Error("not laid out");
    expect(line.height).toBeLessThanOrEqual(2 * 19 + 1);
    // Beside the words, never under them.
    expect(way.x).toBeGreaterThanOrEqual(name.x + name.width - 1);
    await page.screenshot({
      path: `test-results/catalog-similar-distinction-${scheme}.png`,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await it.click();
  await expect(it).toHaveAttribute("aria-pressed", "true");
});

test("«Схожі» says where what was typed says otherwise, as the proposal's rows do: «Лоран бордо» typed, «Не збігається: колір» under «Лоран шоколад 70 см», a fact in the row's grey, never an alert, «Це вона» beside it and choosing it; at 360 in both themes; «Лоран шоколад» typed, no such line (audit 2026-11-22, goods P1-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await enter(page);
  const sheet = await create(page, `Лоран бордо ${randomUUID().slice(0, 8)}`);
  const row = sheet
    .locator(".new-model-candidates > li")
    .filter({ has: itIs(page) });
  const said = row.locator(".new-model-name .t-meta");
  await expect(said).toHaveText("Не збігається: колір");
  // Before «Це вона», which stays beside the words; nothing held, nothing
  // said as an error.
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(said).toHaveCSS("font-size", "14px");
    const [name, line, way] = await Promise.all([
      row.locator(".new-model-name").boundingBox(),
      said.boundingBox(),
      itIs(sheet).boundingBox(),
    ]);
    if (!name || !line || !way) throw new Error("not laid out");
    expect(line.height).toBeLessThanOrEqual(2 * 19 + 1);
    expect(way.x).toBeGreaterThanOrEqual(name.x + name.width - 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/catalog-similar-conflicts-${scheme}.png`,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  // Chosen anyway, it is the person's to choose — as before.
  await itIs(sheet).click();
  await expect(itIs(sheet)).toHaveAttribute("aria-pressed", "true");
  await expect(confirmAs(sheet)).toBeEnabled();
  // The proposal's own rows say it in the same words.
  await leave(page);
  await expect(
    page
      .locator(".new-model-candidates > li")
      .filter({ has: itIs(page) })
      .locator(".new-model-name .t-meta"),
  ).toHaveText("Не збігається: колір");
  // Typed in the model's own colour: nothing to say.
  await enter(page);
  const same = await create(page, `Лоран шоколад ${randomUUID().slice(0, 8)}`);
  const own = same
    .locator(".new-model-candidates > li")
    .filter({ has: itIs(page) });
  await expect(own).toHaveCount(1);
  await expect(own.getByText(/^Не збігається/)).toHaveCount(0);
});

test("catalog navigation requires catalog permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "catalog:confirm",
      );
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  // «Ще» › «Товар і каталог» without the check: its line says so, and its
  // own list holds none («Усе на бірці» task list, P0-4).
  await more(page);
  const catalogue = page
    .getByRole("navigation", { name: "Ще" })
    .getByRole("button", { name: /^Товар і каталог/ });
  // After the lists waiting to be approved and to be finished, as many as
  // the shared database holds (P1-5; stage 2, admin task list, P0-1).
  await expect(catalogue.locator(".more-meta")).toHaveText(
    /^(\d+\+? на затвердження · )?(\d+\+? доробити · )?моделі, початкові залишки$/,
  );
  await catalogue.click();
  await expect(
    page.getByRole("button", { name: "Моделі", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Перевірка каталогу", exact: true }),
  ).toHaveCount(0);
});

test("lost alias-feedback response reuses the same evidence UUID after reopening", async ({
  page,
  context,
}) => {
  await enter(page);
  const sheet = await create(
    page,
    `Назва для повтору доказу ${randomUUID().slice(0, 8)}`,
  );
  await itIs(sheet).click();
  await confirmAs(sheet).click();
  await page.getByRole("button", { name: "Цей опис — назва товару?" }).click();
  const ids: string[] = [];
  await context.route(
    "**/api/v1/catalog/match-decisions/*/alias-feedback",
    async (route) => {
      ids.push(
        (route.request().postDataJSON() as { feedback_id: string }).feedback_id,
      );
      if (ids.length === 1) {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Так, це його назва" }).click();
  await expect(
    page.getByRole("button", { name: "Перевірити результат операції" }),
  ).toBeEnabled();
  // On the proposal, under «← Перевірка каталогу» and «Пропозиція» (audit
  // 2026-11-18, goods P2-1).
  await stubUnder(page, "Пропозиція");
  await page.close();
  const reopened = await context.newPage();
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3).
  const response = reopened.waitForResponse(
    (r) => r.url().endsWith("/alias-feedback") && r.status() === 200,
  );
  await reopened.goto(launch());
  await openStore(reopened, "Основний MAIN");
  const body = (await (await response).json()) as { confirm_count: number };
  await expect(
    reopened.getByRole("heading", { name: "Пропозиція" }),
  ).toBeVisible();
  expect(body.confirm_count).toBe(1);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});

test("copied decision from another store cannot be mutated by a scoped journal", async ({
  page,
}) => {
  await enter(page);
  const sheet = await create(page, "Перевірка магазину перед дією");
  await itIs(sheet).click();
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/confirm")) posts += 1;
  });
  await page.route("**/api/v1/catalog/match-decisions/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as { store_id: string };
    body.store_id = randomUUID();
    await route.fulfill({ response, json: body });
  });
  await confirmAs(sheet).click();
  await expect(sheet.getByRole("alert")).toContainText("Немає доступу");
  expect(posts).toBe(0);
});

test("uncertain catalog operation remains recoverable after access denial", async ({
  page,
  context,
}) => {
  await enter(page);
  const sheet = await draft(page, "Перевірка втрати доступу");
  let requests = 0;
  let denied = false;
  await context.route("**/api/v1/catalog/match-decisions**", async (route) => {
    if (denied) {
      await route.fulfill({ status: 403, json: { code: "PERMISSION_DENIED" } });
      return;
    }
    if (route.request().method() === "POST") {
      requests += 1;
      if (requests === 1) {
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  const retry = sheet.getByRole("button", {
    name: "Перевірити результат операції",
  });
  await expect(retry).toBeEnabled();
  denied = true;
  await retry.click();
  await expect(sheet.getByRole("alert")).toContainText("Немає доступу");
  await expect(retry).toBeEnabled();
  // The sheet stands while it is kept: «Назад» does not drop it.
  await sheet.press("Escape");
  await expect(sheet).toBeVisible();
  denied = false;
  await retry.click();
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
});

test("a catalogue operation kept when its right goes opens its screen, is checked there until answered, then «Ще» (stage 2, goods task list, P1-5; review)", async ({
  page,
  context,
}) => {
  await enter(page);
  const sheet = await draft(page, "Право забрали, поки чекали відповіді");
  let posts = 0;
  let denied = false;
  await context.route("**/api/v1/catalog/match-decisions**", async (route) => {
    if (denied) {
      await route.fulfill({ status: 403, json: { code: "PERMISSION_DENIED" } });
      return;
    }
    if (route.request().method() === "POST") {
      posts += 1;
      if (posts === 1) {
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  await expect(
    sheet.getByRole("button", { name: "Перевірити результат операції" }),
  ).toBeEnabled();
  // The right taken away while the answer is lost.
  await context.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "catalog:confirm",
      );
    await route.fulfill({ response, json: body });
  });
  denied = true;
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(launch());
  await openStore(reopened, "Основний MAIN");
  // Its own screen, the operation on it: never a silent «Ще» held by it.
  await expect(
    reopened.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", {
      name: "Операцію каталогу ще не підтверджено",
    }),
  ).toBeVisible();
  const retry = reopened.getByRole("button", {
    name: "Перевірити результат операції",
  });
  await expect(retry).toBeEnabled();
  // Answered: settled, and «Ще» opens, its row not shown.
  denied = false;
  await retry.click();
  await expect(reopened.getByRole("navigation", { name: "Ще" })).toBeVisible();
  await expect(
    reopened.getByRole("heading", {
      name: "Операцію каталогу ще не підтверджено",
    }),
  ).toHaveCount(0);
  await expect(
    reopened.getByRole("button", { name: "Перевірка каталогу", exact: true }),
  ).toHaveCount(0);
  expect(posts).toBeGreaterThanOrEqual(2);
});

test("a catalogue operation kept on its own screen stands under «Перевірка каталогу» and its line, a server's refusal under it, the queue under them, at 360 × 640 in both themes (audit 2026-11-18, goods P2-1)", async ({
  page,
  context,
}) => {
  await enter(page);
  const sheet = await draft(
    page,
    `Корешок під заголовком ${randomUUID().slice(0, 8)}`,
  );
  let posts = 0;
  let answer: "lose" | "refuse" | "pass" = "lose";
  await context.route("**/api/v1/catalog/match-decisions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts += 1;
    if (posts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else if (answer === "lose") await route.abort("failed");
    else if (answer === "refuse")
      await route.fulfill({
        status: 500,
        json: {
          code: "INTERNAL_ERROR",
          message: "Внутрішня помилка сервера.",
          details: {},
        },
      });
    else await route.continue();
  });
  // A check's look at the proposal is lost too, until it may pass.
  await context.route("**/api/v1/catalog/match-decisions/*", async (route) => {
    if (answer !== "pass" && route.request().method() === "GET")
      await route.abort("failed");
    else await route.continue();
  });
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  await expect(
    sheet.getByRole("button", { name: "Перевірити результат операції" }),
  ).toBeEnabled();
  await page.close();
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 360, height: 640 });
  await reopened.goto(launch());
  await openStore(reopened, "Основний MAIN");
  // Its own screen, checked at once and lost again: kept, under the title.
  const stub = await stubUnder(reopened, "Перевірка каталогу");
  const retry = stub.getByRole("button", {
    name: "Перевірити результат операції",
  });
  await expect(retry).toBeEnabled();
  // The queue under it. At 360 × 640 one scroll down: the title and the
  // stub, its paper words with it, fill the phone (found while proving).
  const queue = reopened.getByRole("list", { name: "Пропозиції" });
  for (const scheme of ["light", "dark"] as const) {
    await reopened.emulateMedia({ colorScheme: scheme });
    await stubUnder(reopened, "Перевірка каталогу");
    const [kept, rows] = await edges(reopened, [stub, queue]);
    if (!kept || !rows) throw new Error("not laid out");
    expect(kept.bottom).toBeLessThanOrEqual(rows.top + 0.5);
    await reopened.screenshot({
      path: `test-results/catalog-kept-360-${scheme}.png`,
      fullPage: true,
    });
  }
  await reopened.emulateMedia({ colorScheme: "light" });
  // A server's answer that settles nothing: said under the stub, over the
  // queue.
  answer = "refuse";
  await retry.click();
  // The screen's next block after the stub (review).
  const refusal = reopened.locator(".stub-notice + p[role='alert']");
  await expect(refusal).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await reopened.emulateMedia({ colorScheme: scheme });
    await stubUnder(reopened, "Перевірка каталогу");
    const [box, said, first] = await edges(reopened, [stub, refusal, queue]);
    if (!box || !said || !first) throw new Error("not laid out");
    expect(box.bottom).toBeLessThanOrEqual(said.top + 0.5);
    expect(said.bottom).toBeLessThanOrEqual(first.top + 0.5);
  }
  await reopened.emulateMedia({ colorScheme: "light" });
  // Answered: settled, its proposal's own screen.
  answer = "pass";
  await retry.click();
  await expect(
    reopened.getByRole("heading", { name: "Пропозиція" }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("heading", {
      name: "Операцію каталогу ще не підтверджено",
    }),
  ).toHaveCount(0);
});

test("create a reviewed product and recover a lost response without duplication", async ({
  page,
  context,
}) => {
  await enter(page);
  const name = `Модель ${randomUUID().slice(0, 8)}`;
  const raw = `  ${name} невідомий опис\n`;
  const sheet = await create(page, raw);
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  // Its one button names its sizes, none until one is chosen.
  await expect(addModel(sheet)).toHaveText("Додати модель");
  await expect(addModel(sheet)).toBeDisabled();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await sheet.getByLabel("Колір", { exact: true }).fill("синій");
  await sizeCell(sheet, "L").click();
  await expect(sizeCell(sheet, "L")).toHaveAttribute("aria-pressed", "true");
  const commands: string[] = [];
  const results: {
    resolved_variant_id: string;
    preview: { raw_text: string };
  }[] = [];
  await context.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      commands.push(route.request().postData() ?? "");
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      results.push((await response.json()) as (typeof results)[number]);
      if (commands.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    },
  );
  await addModel(sheet).click();
  await expect(
    sheet.getByRole("button", { name: "Перевірити результат операції" }),
  ).toBeEnabled();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(launch());
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3).
  await openStore(reopened, "Основний MAIN");
  await expect(
    reopened.getByText(`Збережений товар: ${name} синій. Розміри: L`, {
      exact: true,
    }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0]).toBe(commands[1]);
  expect(results[0]?.resolved_variant_id).toBe(results[1]?.resolved_variant_id);
  expect(results[1]?.preview.raw_text).toBe(raw);
  expect(
    await reopened.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await reopened.screenshot({
    path: "test-results/catalog-created-mobile.png",
    fullPage: true,
  });
});

test("a product created says its sizes as the cells do, never the system's code; at 360 a long name wraps on the screen (audit 2026-11-18, goods P1-1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enter(page);
  const name = `Модель ${randomUUID().slice(0, 8)} з довгою назвою для переносу`;
  const sheet = await create(page, name);
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await sizeCell(sheet, "M").click();
  await sizeCell(sheet, "L").click();
  await addModel(sheet).click();
  const line = page.getByText(`Збережений товар: ${name}. Розміри: M, L`, {
    exact: true,
  });
  await expect(line).toBeVisible();
  await expect(page.getByText(/ALPHA|NUMERIC_EU|UNSPECIFIED/)).toHaveCount(0);
  // Wrapped inside the screen's sides, never cut or pushed past them.
  const box = await line.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  expect(box.x).toBeGreaterThanOrEqual(16 - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(360 - 16 + 0.5);
  const lineHeight = await line.evaluate((node) =>
    parseFloat(getComputedStyle(node).lineHeight),
  );
  expect(box.height).toBeGreaterThan(lineHeight * 1.5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({
      path: `test-results/catalog-created-sizes-${theme}.png`,
      fullPage: true,
    });
  }
});

/** «Нова модель» for «Лоран», a size typed, sent and refused as a name
 * some models have: the models the refusal names, as the fork reads them. */
async function refusedAsNamed(
  page: Page,
  sheet: Locator,
): Promise<{ family_id: string }[]> {
  const read = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      r.url().includes("/catalog/families?") &&
      !r.url().includes("offset="),
  );
  const refused = page.waitForResponse(
    (r) => r.url().endsWith("/create-product") && r.status() === 409,
  );
  await addModel(sheet).click();
  const refusal = (await (await refused).json()) as {
    code: string;
    details: { candidate_family_ids: string[] };
  };
  expect(refusal.code).toBe("CATALOG_AMBIGUOUS");
  const ids = refusal.details.candidate_family_ids;
  const { items } = (await (await read).json()) as {
    items: { family_id: string }[];
  };
  return items.filter((item) => ids.includes(item.family_id));
}
const forkAsks =
  "З такою назвою вже є модель. Це вона — чи окрема модель зі схожою назвою?";

test("a name some models have asks its fork in «Нова модель», as the rename does: the question said, never a refusal's plate; the models as rows with «Це вона», «Окрема модель зі схожою назвою» under them, nothing chosen and nothing created until one is; in sight at 360×640 in both themes; «Ще ознаки» as they were. «Це вона», then «Нова модель» again: nothing chosen, held. The other way: the form's own «Окрема модель…» ticked, «Ще ознаки» open, the cursor in what tells it apart — a separate model, as before (audit 2026-11-22, goods P1-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enter(page);
  const sheet = await create(page, "Лоран інша модель");
  await newModel(sheet, "Лоран", "XL");
  const families = await refusedAsNamed(page, sheet);
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toHaveValue(
    "Лоран",
  );
  const fork = sheet.locator(".rename-fork");
  const question = fork.getByRole("status");
  await expect(question).toHaveText(forkAsks);
  // Where the refusal stood, under the title — the cursor on it, in sight:
  // the sheet's own button it holds never keeps it (review).
  await expect(question).toBeFocused();
  await expect(question).toBeInViewport();
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(sheet.getByText(/неоднозначна/)).toHaveCount(0);
  await expect(
    sheet.getByRole("button", { name: "Ще ознаки" }),
  ).toHaveAttribute("aria-expanded", "false");
  const rows = fork.locator(".new-model-candidates > li");
  await expect(rows).toHaveCount(families.length);
  const its = rows.getByRole("button", { name: /^Це вона: / });
  const apart = fork.getByRole("button", {
    name: "Окрема модель зі схожою назвою",
    exact: true,
  });
  for (const each of await its.all())
    await expect(each).toHaveAttribute("aria-pressed", "false");
  await expect(apart).toHaveAttribute("aria-pressed", "false");
  await expect(addModel(sheet)).toBeDisabled();
  await sheetRow(rows.first());
  await rowTitle(rows.first().locator(".new-model-name strong"));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `test-results/catalog-new-model-fork-${scheme}.png`,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  // «Це вона», then «Нова модель» pressed again: nothing chosen, held.
  const kind = sheet.getByRole("group", { name: "Яка модель" });
  await its.first().click();
  await expect(its.first()).toHaveAttribute("aria-pressed", "true");
  await kind.getByRole("button", { name: "Нова модель" }).click();
  await expect(its.first()).toHaveAttribute("aria-pressed", "false");
  await expect(addModel(sheet)).toBeDisabled();
  // The other way: the form's own box, one state with it.
  await apart.click();
  await expect(apart).toHaveAttribute("aria-pressed", "true");
  await expect(
    sheet.getByLabel("Окрема модель зі схожою назвою"),
  ).toBeChecked();
  await expect(
    sheet.getByRole("button", { name: "Ще ознаки" }),
  ).toHaveAttribute("aria-expanded", "true");
  const how = sheet.getByLabel("Чим відрізняється модель");
  await expect(how).toBeFocused();
  await expect(addModel(sheet)).toBeDisabled();
  await how.fill("Інший крій для тесту");
  const sent = page.waitForRequest((r) => r.url().endsWith("/create-product"));
  await addModel(sheet).click();
  expect((await sent).postDataJSON()).toMatchObject({
    concept: "Лоран",
    new_model: true,
    distinction_note: "Інший крій для тесту",
  });
  await expect(
    page.getByText("Збережений товар: Лоран. Розміри: XL", {
      exact: true,
    }),
  ).toBeVisible();
});

test("«Це вона» in «Нова модель»'s fork: another colour of that model — «Інший колір нашої моделі» with it, the colour and the sizes typed kept; created in that model, nothing of a new one sent (audit 2026-11-22, goods P1-2)", async ({
  page,
}) => {
  await enter(page);
  // A model of its own, so the fork names it alone and the shared
  // catalogue's «Лоран» gains nothing (review).
  const name = `Модель ${randomUUID().slice(0, 8)}`;
  const fresh = await create(page, name);
  await newModel(fresh, name, "XL");
  await addModel(fresh).click();
  await expect(
    page.getByText(`Збережений товар: ${name}. Розміри: XL`, { exact: true }),
  ).toBeVisible();
  await enter(page);
  const colour = `тест ${randomUUID().slice(0, 8)}`;
  const sheet = await create(page, `${name} ${colour}`);
  await newModel(sheet, name, "XL");
  await sheet.getByLabel("Колір", { exact: true }).fill(colour);
  const named = await refusedAsNamed(page, sheet);
  expect(named).toHaveLength(1);
  const [first] = named;
  if (!first) throw new Error("no model named");
  const it = sheet
    .locator(".rename-fork .new-model-candidates > li")
    .first()
    .getByRole("button", { name: /^Це вона: / });
  const label = ((await it.getAttribute("aria-label")) ?? "").replace(
    /^Це вона: /,
    "",
  );
  await it.click();
  await expect(it).toHaveAttribute("aria-pressed", "true");
  const kind = sheet.getByRole("group", { name: "Яка модель" });
  await expect(
    kind.getByRole("button", { name: "Інший колір нашої моделі" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByText(/^Модель: /)).toHaveText(`Модель: ${label}`);
  await expect(sheet.getByLabel("Колір", { exact: true })).toHaveValue(colour);
  await expect(sizeCell(sheet, "XL")).toHaveAttribute("aria-pressed", "true");
  await expect(addModel(sheet)).toHaveText("Додати модель · 1 розмір");
  const sent = page.waitForRequest((r) => r.url().endsWith("/create-product"));
  const made = page.waitForResponse(
    (r) => r.url().endsWith("/create-product") && r.status() === 200,
  );
  await addModel(sheet).click();
  const body = (await sent).postDataJSON() as Record<string, unknown>;
  expect(body.product_family_id).toBe(first.family_id);
  for (const gone of ["concept", "new_model", "distinction_note"])
    expect(body).not.toHaveProperty(gone);
  const result = (await (await made).json()) as {
    creation: {
      product_family_id: string;
      family_created: boolean;
      variant_created: boolean;
    };
  };
  expect(result.creation.product_family_id).toBe(first.family_id);
  expect(result.creation.family_created).toBe(false);
  expect(result.creation.variant_created).toBe(true);
  await expect(
    page.getByText(
      new RegExp(`^Збережений товар: ${name}.* ${colour}.*\\. Розміри: XL$`),
    ),
  ).toBeVisible();
});

test("a word of the name changed after «Нова модель»'s fork forgets it and what was chosen in it, as the rename's does: the other way chosen and written, the name changed — no question, «Окрема модель…» unticked, what tells it apart gone, the model creatable as typed; «Це вона» chosen, the name changed under «Нова модель» — that model forgotten for «Інший колір нашої моделі» (audit 2026-11-22, goods P1-2)", async ({
  page,
}) => {
  await enter(page);
  const sheet = await create(page, "Лоран інша модель");
  await newModel(sheet, "Лоран", "XL");
  await refusedAsNamed(page, sheet);
  const fork = sheet.locator(".rename-fork");
  const name = sheet.getByLabel("Назва моделі", { exact: true });
  await fork
    .getByRole("button", { name: "Окрема модель зі схожою назвою" })
    .click();
  await sheet.getByLabel("Чим відрізняється модель").fill("Інший крій");
  await name.fill("Лоран Б");
  await expect(fork).toHaveCount(0);
  await expect(sheet.getByText(forkAsks)).toHaveCount(0);
  await expect(
    sheet.getByLabel("Окрема модель зі схожою назвою"),
  ).not.toBeChecked();
  await expect(sheet.getByLabel("Чим відрізняється модель")).toHaveCount(0);
  await expect(addModel(sheet)).toBeEnabled();
  // Asked again, «Це вона», then the name changed under «Нова модель».
  await name.fill("Лоран");
  await refusedAsNamed(page, sheet);
  await fork
    .locator(".new-model-candidates > li")
    .first()
    .getByRole("button", { name: /^Це вона: / })
    .click();
  const kind = sheet.getByRole("group", { name: "Яка модель" });
  await expect(sheet.getByText(/^Модель: /)).toBeVisible();
  await kind.getByRole("button", { name: "Нова модель" }).click();
  await name.fill("Лоран В");
  await expect(fork).toHaveCount(0);
  await kind.getByRole("button", { name: "Інший колір нашої моделі" }).click();
  await expect(sheet.getByText(/^Модель: /)).toHaveCount(0);
  await expect(sheet.getByLabel("Пошук моделі в каталозі")).toBeVisible();
});

test("the fork's models read slowly: their rows' places stand where they will, a name's and «Це вона»'s in grey, unheard; «Завантажуємо моделі…» said to a reader alone, beside the fork — «Окрема модель…» never the only way in sight; come, the rows where they stood (audit 2026-11-22, goods P1-2; review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  let answer = (): void => undefined;
  // Let go by itself in ten seconds, should the journey fail before it
  // answers: no read is left hanging as it ends.
  const held = new Promise<void>((resolve) => {
    answer = resolve;
    setTimeout(resolve, 10_000);
  });
  await enter(page);
  const sheet = await create(page, "Лоран інша модель");
  await newModel(sheet, "Лоран", "XL");
  await page.route("**/api/v1/catalog/families?*", async (route) => {
    await held;
    await route.fallback();
  });
  const refused = page.waitForResponse(
    (r) => r.url().endsWith("/create-product") && r.status() === 409,
  );
  await addModel(sheet).click();
  const { details } = (await (await refused).json()) as {
    details: { candidate_family_ids: string[] };
  };
  const fork = sheet.locator(".rename-fork");
  await expect(fork.getByRole("status")).toHaveText(forkAsks);
  const grey = fork.locator(".new-model-candidates > li[aria-hidden='true']");
  await expect(grey).toHaveCount(
    Math.min(details.candidate_family_ids.length, 3),
  );
  await expect(grey.first().locator(".skeleton-name")).toBeVisible();
  await expect(grey.first().locator(".skeleton-choose")).toBeVisible();
  await expect(grey.first()).toBeInViewport();
  await expect(
    sheet.getByRole("status").filter({ hasText: "Завантажуємо моделі…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  await expect(fork.getByText("Завантажуємо моделі…")).toHaveCount(0);
  await expect(fork.getByRole("button", { name: /^Це вона: / })).toHaveCount(0);
  await expect(addModel(sheet)).toBeDisabled();
  const from = (await fork.boundingBox())?.y ?? 0;
  const before = await grey.first().boundingBox();
  answer();
  const rows = fork.locator(".new-model-candidates > li:not([aria-hidden])");
  await expect(rows.first()).toBeVisible();
  await expect(grey).toHaveCount(0);
  await expect(sheet.getByText("Завантажуємо моделі…")).toHaveCount(0);
  const after = await rows.first().boundingBox();
  const to = (await fork.boundingBox())?.y ?? 0;
  expect(
    Math.abs((after?.y ?? 0) - to - ((before?.y ?? 0) - from)),
  ).toBeLessThanOrEqual(4);
});

test("a read of the fork's models that finds none of them says the refusal as before — its plate, «Ще ознаки» open on «Окрема модель зі схожою назвою»; no fork with that way alone (audit 2026-11-22, goods P1-2; review)", async ({
  page,
}) => {
  await enter(page);
  const sheet = await create(page, "Лоран інша модель");
  await newModel(sheet, "Лоран", "XL");
  // As a model under review, or past the name's first fifty, is read.
  await page.route("**/api/v1/catalog/families?*", async (route) => {
    const response = await route.fetch();
    const read = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...read, items: [] } });
  });
  const read = page.waitForResponse((r) =>
    r.url().includes("/catalog/families?"),
  );
  await addModel(sheet).click();
  await read;
  await expect(sheet.getByRole("alert")).toContainText("Модель неоднозначна");
  await expect(sheet.locator(".rename-fork")).toHaveCount(0);
  await expect(sheet.getByText(forkAsks)).toHaveCount(0);
  await expect(
    sheet.getByRole("button", { name: "Ще ознаки" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    sheet.getByLabel("Окрема модель зі схожою назвою"),
  ).toBeVisible();
});

test("in Telegram «Ще ознаки» go by Enter as their keys say: each «next» takes the cursor on, «Довжина, см»'s «done» lets the keyboard go, nothing sent; a size cell tapped lets it go too (audit 2026-11-13, goods P2-3)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: { postEvent: (event: string) => void };
      told: string[];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event) => {
        host.told.push(event);
      },
    };
  });
  const hidden = (): Promise<number> =>
    page.evaluate(
      () =>
        (window as unknown as { told: string[] }).told.filter(
          (event) => event === "web_app_hide_keyboard",
        ).length,
    );
  await page.goto(launch("9.1"));
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
  // «Далі» is Telegram's MainButton here.
  const sheet = await draft(page, `Клавіші ${randomUUID().slice(0, 8)}`);
  // Several lines: Enter a new line (review).
  await expect(sheet.getByLabel("Як записано")).toHaveAttribute(
    "enterkeyhint",
    "enter",
  );
  await pressMain(page);
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  // The name's «next» goes to the colour (review).
  await sheet.getByLabel("Назва моделі", { exact: true }).press("Enter");
  await expect(sheet.getByLabel("Колір", { exact: true })).toBeFocused();
  // A fold's one look: the set's chevron after its words, what it opens
  // named (audit 2026-11-13, frame P2-3).
  await expectFold(
    sheet.getByRole("button", { name: "Ще ознаки" }),
    "Ще ознаки",
    sheet.locator(".new-model-extra"),
  );
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/v1/"))
      sent.push(request.url());
  });
  const fields = [
    "Джерело",
    "Категорія",
    "Тип виробу",
    "Матеріал",
    "Фактура",
    "Хутро",
    "Комір",
    "Довжина, см",
  ];
  for (const [at, label] of fields.slice(0, -1).entries()) {
    const field = sheet.getByLabel(label, { exact: true });
    await expect(field).toHaveAttribute("enterkeyhint", "next");
    await field.fill("так");
    await field.press("Enter");
    await expect(
      sheet.getByLabel(fields[at + 1] ?? "", { exact: true }),
    ).toBeFocused();
  }
  const length = sheet.getByLabel("Довжина, см", { exact: true });
  await expect(length).toHaveAttribute("enterkeyhint", "done");
  const before = await hidden();
  await length.press("Enter");
  await expect(length).not.toBeFocused();
  expect(await hidden()).toBe(before + 1);
  // The cursor left on the sheet, where Escape still closes it (review).
  await expect(sheet).toBeFocused();
  // The cursor in the name, a cell tapped: a choice, not typing.
  await sheet.getByLabel("Назва моделі", { exact: true }).focus();
  await sizeCell(sheet, "L").click();
  await expect(sizeCell(sheet, "L")).toHaveAttribute("aria-pressed", "true");
  expect(await hidden()).toBe(before + 2);
  expect(sent).toEqual([]);
});

test("review-only users cannot open product creation", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "catalog:create",
      );
    await route.fulfill({ response, json: body });
  });
  await enter(page);
  const sheet = await create(page, "Опис для перевірки прав");
  await expect(
    sheet.getByRole("button", { name: "Ні, це нова модель" }),
  ).toHaveCount(0);
  await leave(page);
  await expect(page.getByRole("button", { name: "Створити нову" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Відхилити", exact: true }),
  ).toBeVisible();
});

test("lost product rejection can be explicitly cancelled without leaving blocked navigation", async ({
  page,
  context,
}) => {
  await enter(page);
  const sheet = await create(page, "Лоран помилкова нова модель");
  await newModel(sheet, "Лоран", "M");
  await context.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(409);
      await route.abort("failed");
    },
  );
  await addModel(sheet).click();
  // In the one form every kept operation has (goods task list after stage
  // 2, P1-4): its stub, «Ще не підтверджено» on it, what is unknown and
  // that it is never recorded twice, its check — then, under it, the
  // creation's cancelling.
  const stub = sheet.locator(".stub-notice");
  await expect(stub.locator(".stub-head")).toHaveText("Ще не підтверджено");
  await expect(stub.getByRole("heading")).toHaveText(
    "Операцію каталогу ще не підтверджено",
  );
  await expect(
    stub.getByText(
      "Невідомо, чи записано операцію каталогу. Перевірте результат — та сама операція не запишеться двічі.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(stub.getByRole("button")).toHaveText([
    "Перевірити результат операції",
    "Скасувати незавершене створення",
  ]);
  await expect(
    stub.getByText(
      "Якщо створення не вдається, можна скасувати пропозицію. Якщо товар уже збережено, покажемо результат.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(sheet.getByText(/Повторна спроба|Незавершена/)).toHaveCount(0);
  await stub.screenshot({ path: "test-results/catalog-kept-stub.png" });
  await sheet
    .getByRole("button", { name: "Скасувати незавершене створення" })
    .click();
  // Cancelled: the sheet goes, its proposal's screen says why.
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText("Причина відхилення:", { exact: false }),
  ).toBeVisible();
  // Back to the queue, read again as it comes (no «Оновити» by the title, audit
  // 2026-11-13; review).
  const queue = page.waitForRequest("**/api/v1/catalog/match-decisions?**");
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
  await queue;
  await expect(
    page.getByRole("button", { name: "Нова пропозиція", exact: true }),
  ).toBeEnabled();
});

test("cancelling a lost committed creation shows its saved product", async ({
  page,
  context,
}) => {
  await enter(page);
  const name = `Збережена ${randomUUID().slice(0, 8)}`;
  const sheet = await create(page, name);
  await newModel(sheet, name, "M");
  await context.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    },
  );
  await addModel(sheet).click();
  await sheet
    .getByRole("button", { name: "Скасувати незавершене створення" })
    .click();
  // Saved already: shown as it is, the model added.
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText(`Збережений товар: ${name}. Розміри: M`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(`Модель додано: ${name}.`);
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
  await expect(
    page.getByRole("button", { name: "Нова пропозиція", exact: true }),
  ).toBeEnabled();
});

test("creation cancellation accepts another reviewer's terminal rejection", async ({
  page,
  context,
}) => {
  await enter(page);
  const sheet = await create(page, "Лоран переглядають одночасно");
  await newModel(sheet, "Лоран", "M");
  await context.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      expect((await route.fetch()).status()).toBe(409);
      const rejected = await page.request.post(
        route
          .request()
          .url()
          .replace(/create-product$/, "reject"),
        {
          headers: {
            Authorization: route.request().headers()["authorization"] ?? "",
          },
          data: { reason: "Інший менеджер уже відхилив" },
        },
      );
      expect(rejected.status()).toBe(200);
      await route.abort("failed");
    },
  );
  await addModel(sheet).click();
  await sheet
    .getByRole("button", { name: "Скасувати незавершене створення" })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText("Причина відхилення: Інший менеджер уже відхилив", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
  await expect(
    page.getByRole("button", { name: "Нова пропозиція", exact: true }),
  ).toBeEnabled();
});

test("search selects an existing family outside preview without creating another family", async ({
  page,
}) => {
  let authorization = "";
  page.on("request", (r) => {
    if (r.url().endsWith("/api/v1/me"))
      authorization = r.headers()["authorization"] ?? "";
  });
  await enter(page);
  const sheet = await create(page, "Невідомий початковий опис");
  const name = `Віддалена модель ${randomUUID().slice(0, 8)}`;
  const product = await page.request.post("/api/v1/catalog/products", {
    headers: { Authorization: authorization, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      concept: name,
      source: "Постачальник тестовий",
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(product.status()).toBe(201);
  const existing = (await product.json()) as { product_family_id: string };
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  // Another colour of a model the catalogue has, found by its name. The
  // switch changes the form in the same sheet: pressed, never «the page»
  // (audit 2026-11-13, frame P2-2).
  const kind = sheet.getByRole("group", { name: "Яка модель" });
  await expect(
    kind.getByRole("button", { name: "Нова модель" }),
  ).toHaveAttribute("aria-pressed", "true");
  await kind.getByRole("button", { name: "Інший колір нашої моделі" }).click();
  await expect(
    kind.getByRole("button", { name: "Інший колір нашої моделі" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    kind.getByRole("button", { name: "Нова модель" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(kind.locator("[aria-current]")).toHaveCount(0);
  // Asked as it is typed, no «Знайти модель», no Enter (goods task list
  // after stage 2, P1-5).
  await sheet.getByLabel("Пошук моделі в каталозі").fill(name);
  const choice = sheet.getByRole("button", {
    name: `Обрати модель: ${name} — Постачальник тестовий`,
    exact: true,
  });
  await expect(choice).toBeVisible();
  // In the sheet, white already: a row 64 with no block (audit 2026-11-15,
  // goods P2-2).
  await sheetRow(choice);
  await rowTitle(choice);
  await expect(sheet.getByText(/^Модель: /)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/catalog-family-search-mobile.png",
    fullPage: true,
  });
  await choice.click();
  await expect(sheet.getByText(/^Модель: /)).toHaveText(
    `Модель: ${name} — Постачальник тестовий`,
  );
  await sheet.getByLabel("Колір", { exact: true }).fill("зелений");
  await sizeCell(sheet, "L").click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/create-product") && r.status() === 200,
  );
  await addModel(sheet).click();
  const result = (await (await response).json()) as {
    creation: {
      product_family_id: string;
      family_created: boolean;
      variant_created: boolean;
    };
  };
  expect(result.creation.product_family_id).toBe(existing.product_family_id);
  expect(result.creation.family_created).toBe(false);
  expect(result.creation.variant_created).toBe(true);
});

test("family search empty and failure states keep the manual draft", async ({
  page,
}) => {
  await enter(page);
  const sheet = await create(page, "Пошук без збігів");
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill("Ручна назва");
  const kind = sheet.getByRole("group", { name: "Яка модель" });
  await kind.getByRole("button", { name: "Інший колір нашої моделі" }).click();
  const nothing = randomUUID();
  await sheet.getByLabel("Пошук моделі в каталозі").fill(nothing);
  await expect(
    sheet.getByText(`Нічого не знайшли за «${nothing}»`, { exact: true }),
  ).toBeVisible();
  // In a sheet a line of `meta` in pencil, never the blank tag; heard as
  // it comes (audit 2026-11-18, goods P2-4).
  const line = sheet
    .getByRole("status")
    .filter({ hasText: "Нічого не знайшли" });
  await expect(line).toHaveText(`Нічого не знайшли за «${nothing}»`);
  await expect(line).toHaveClass(/\bt-meta\b/);
  await expect(line).toHaveCSS("font-size", "14px");
  const pencil = await line.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--pencil)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  await expect(line).toHaveCSS("color", pencil);
  await expect(sheet.locator(".orders-empty")).toHaveCount(0);
  await page.route("**/api/v1/catalog/families?**", async (route) => {
    await route.fulfill({ status: 403, json: { code: "PERMISSION_DENIED" } });
  });
  await sheet.getByLabel("Пошук моделі в каталозі").fill("інший пошук");
  await expect(sheet.getByRole("alert")).toContainText("Немає доступу");
  // The warning's plate, «Спробувати ще раз» — never «Повторити пошук»
  // (audit after stage 2, goods P1-1).
  const plate = sheet.locator(".read-failure");
  await expect(plate).toContainText("Немає доступу");
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(
    sheet.getByRole("button", { name: "Повторити пошук" }),
  ).toHaveCount(0);
  await expect(sheet.getByText(/^Модель: /)).toHaveCount(0);
  // Back to a new model: the name typed is where it was.
  await kind.getByRole("button", { name: "Нова модель" }).click();
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toHaveValue(
    "Ручна назва",
  );
});

test("«Інший колір нашої моделі»: every model at once, asked as it is typed from two letters, one line of hint, «Показати ще» adds under the first page, a failed page its retry alone; the model chosen in two taps (goods task list after stage 2, P1-5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const family = (name: string) => ({
    family_id: randomUUID(),
    concept_name: name,
    source_name: "Постачальник тестовий",
    business_category_name: null,
    garment_type_name: null,
    distinction_note: null,
  });
  const first = Array.from({ length: 20 }, (_, i) =>
    family(`Модель ${String(i + 1).padStart(2, "0")}`),
  );
  const second = [family("Модель 21"), family("Модель 22")];
  const mohair = Array.from({ length: 20 }, (_, i) =>
    family(`Мохер ${String(i + 1).padStart(2, "0")}`),
  );
  const coats = Array.from({ length: 22 }, (_, i) =>
    family(`Пальто ${String(i + 1).padStart(2, "0")}`),
  );
  const asked: string[] = [];
  let nextFails = true;
  let none = false;
  await page.route("**/api/v1/catalog/families?**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query") ?? "";
    const offset = url.searchParams.get("offset") ?? "";
    asked.push(`${query}@${offset}`);
    if (query === "" && offset === "0")
      await route.fulfill({
        json: none
          ? { items: [], has_more: false }
          : { items: first, has_more: true },
      });
    else if (query === "" && offset === "20" && nextFails) {
      nextFails = false;
      await route.fulfill({ status: 500, json: { code: "INTERNAL_ERROR" } });
    } else if (query === "" && offset === "20")
      await route.fulfill({ json: { items: second, has_more: false } });
    else if (query === "ко")
      await route.fulfill({
        json: { items: [family("Кокон")], has_more: false },
      });
    else if (query === "мо" && offset === "0")
      await route.fulfill({ json: { items: mohair, has_more: true } });
    else if (query === "мо")
      await route.fulfill({ status: 500, json: { code: "INTERNAL_ERROR" } });
    else if (query === "па")
      await route.fulfill({ json: { items: coats, has_more: false } });
    else await route.fulfill({ json: { items: [], has_more: false } });
  });
  await enter(page);
  const sheet = await create(page, `Інший колір ${randomUUID().slice(0, 8)}`);
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  const kind = sheet.getByRole("group", { name: "Яка модель" });
  await kind.getByRole("button", { name: "Інший колір нашої моделі" }).click();
  const search = sheet.getByRole("region", { name: "Пошук наявної моделі" });
  const found = search
    .getByRole("group", { name: "Знайдені моделі" })
    .getByRole("button");
  // Nothing typed: every model at once, from the first page — nothing to
  // press first.
  await expect(found).toHaveCount(20);
  await expect(found.first()).toHaveText("Модель 01 — Постачальник тестовий");
  await expect(found.first()).toHaveAccessibleName(
    "Обрати модель: Модель 01 — Постачальник тестовий",
  );
  expect(asked).toEqual(["@0"]);
  for (const gone of ["Знайти модель", "Попередні моделі", "Наступні моделі"])
    await expect(
      sheet.getByRole("button", { name: gone, exact: true }),
    ).toHaveCount(0);
  // One line of hint: a likeness is not the same goods.
  await expect(search.locator(".hint")).toHaveText([
    "Схожі назви не означають однаковий товар.",
  ]);
  await expect(sheet.getByText(/Пошук за назвою|Порожній запит/)).toHaveCount(
    0,
  );
  const field = sheet.getByLabel("Пошук моделі в каталозі");
  await expect(field).toHaveAttribute(
    "placeholder",
    "Назва моделі або джерело",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await field.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
  });
  await page.screenshot({
    path: "test-results/catalog-family-as-typed-360.png",
  });
  // «Показати ще»: a page that fails says so where it stood, the rows
  // stay; its retry reads that page alone, added under the first, the
  // cursor on the first it brings.
  // One word and one look under every list, the sheet's width (audit 2026-11-20, frame P2-1).
  await expectListMore(
    search.getByRole("button", { name: "Показати ще" }),
    search.getByRole("group", { name: "Знайдені моделі" }),
  );
  await search.getByRole("button", { name: "Показати ще" }).click();
  const plate = search.locator(".read-failure");
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(found).toHaveCount(20);
  await expect(search.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(found).toHaveCount(22);
  await expect(found.nth(0)).toHaveText("Модель 01 — Постачальник тестовий");
  await expect(found.nth(20)).toHaveText("Модель 21 — Постачальник тестовий");
  await expect(found.nth(20)).toBeFocused();
  await expect(plate).toHaveCount(0);
  await expect(search.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  expect(asked).toEqual(["@0", "@20", "@20"]);
  // One letter is every model still: the list stands, nothing is asked,
  // never a blank between (review).
  await field.fill("к");
  await expect(found).toHaveCount(22);
  await page.waitForTimeout(700);
  await expect(found).toHaveCount(22);
  expect(asked).toEqual(["@0", "@20", "@20"]);
  // New words after a page pressed for others that failed: the cursor
  // stays in the field (review).
  await field.fill("мо");
  await expect(found.first()).toHaveText("Мохер 01 — Постачальник тестовий");
  await search.getByRole("button", { name: "Показати ще" }).click();
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await field.fill("па");
  await expect(found).toHaveCount(22);
  await expect(found.first()).toHaveText("Пальто 01 — Постачальник тестовий");
  await expect(field).toBeFocused();
  // Two letters asked once the typing pauses.
  await field.fill("ко");
  await expect(found).toHaveText(["Кокон — Постачальник тестовий"]);
  expect(asked.filter((one) => one.startsWith("к@"))).toEqual([]);
  expect(asked.slice(3)).toEqual(["мо@0", "мо@20", "па@0", "ко@0"]);
  // The second tap chooses it.
  await found.first().click();
  await expect(sheet.getByText(/^Модель: /)).toHaveText(
    "Модель: Кокон — Постачальник тестовий",
  );
  await expect(search).toHaveCount(0);
  // A catalogue with no model at all says so, with nothing typed.
  none = true;
  await sheet.getByRole("button", { name: "Інша модель" }).click();
  await expect(
    sheet.getByText("Моделей не знайдено.", { exact: true }),
  ).toBeVisible();
  await expect(sheet.getByText(/Нічого не знайшли/)).toHaveCount(0);
});

test("at 360 px a proposal is its own screen: its words large, the models offered with «Це вона», none chosen, «Підтвердити: …» docked once one is, «Створити нову» and «Відхилити» — in sight, nothing past the width, in both themes; refused as changed meanwhile, it is read again (stage 2, goods task list, P1-1; audit 2026-11-13)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enter(page);
  const raw = `Пропозиція на вузькому ${randomUUID().slice(0, 8)}`;
  await create(page, raw);
  await leave(page);
  const words = page.locator(".catalog-raw-large");
  await expect(words).toHaveText(`«${raw}»`);
  await expect(
    page.getByText("Потребує перевірки", { exact: true }),
  ).toBeVisible();
  const offered = page.getByRole("list", { name: "Схожі моделі" });
  await expect(
    offered.getByRole("button", { name: /^Це вона: / }).first(),
  ).toBeVisible();
  await expect(offered.getByRole("button", { pressed: true })).toHaveCount(0);
  // The models offered as a list's rows on its white block, each named
  // 17/600 in ink (audit 2026-11-15, goods P2-2).
  for (const item of await offered.getByRole("listitem").all()) {
    await blockRow(item);
    await rowTitle(item.locator(".new-model-name strong"));
  }
  await expect(page.getByRole("button", { name: /^Підтвердити/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Створити нову" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Відхилити", exact: true }),
  ).toBeVisible();
  await itIs(page).click();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    // The words and the first model in sight as it opens; the one button
    // docked over the menu, in sight too.
    const text = await words.boundingBox();
    const first = await offered.getByRole("button").first().boundingBox();
    const dock = await confirmAs(page).boundingBox();
    expect(text && first && dock).toBeTruthy();
    if (!text || !first || !dock) return;
    expect(first.y + first.height).toBeLessThanOrEqual(640);
    expect(dock.y + dock.height).toBeLessThanOrEqual(640);
    expect(dock.y).toBeGreaterThan(first.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/catalog-proposal-360-${scheme}.png`,
    });
  }
  // At the page's end «Створити нову» and «Відхилити» are in sight, clear
  // of the dock, each the one tapped (review).
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const dock = await confirmAs(page).boundingBox();
  expect(dock).not.toBeNull();
  for (const way of [
    page.getByRole("button", { name: "Створити нову" }),
    page.getByRole("button", { name: "Відхилити", exact: true }),
  ]) {
    await expect(way).toBeInViewport();
    const box = await way.boundingBox();
    expect(box && dock).toBeTruthy();
    if (!box || !dock) return;
    // Never under it: above, or below it where it rests at the end.
    expect(box.y + box.height <= dock.y || box.y >= dock.y + dock.height).toBe(
      true,
    );
    await way.click({ trial: true });
  }
  // Docked: on a screen too short for the proposal it floats over the menu,
  // whole in sight from the top.
  await page.setViewportSize({ width: 360, height: 400 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await expect(confirmAs(page)).toBeInViewport({ ratio: 1 });
  // Refused as changed meanwhile: said, and the proposal and the queue are
  // read again under it (no «Оновити» by the title, audit 2026-11-13; review).
  const reads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "GET" &&
      path.startsWith("/api/v1/catalog/match-decisions")
    )
      reads.push(path);
  });
  await refuseOnce(page, "**/api/v1/catalog/match-decisions/*/confirm", 409);
  await confirmAs(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Каталог або рішення змінилися.",
  );
  await expect
    .poll(() => reads.some((path) => /match-decisions\/[^/]+$/.test(path)))
    .toBe(true);
  await expect
    .poll(() => reads.includes("/api/v1/catalog/match-decisions"))
    .toBe(true);
});

test("a new model's sizes read slowly: a row of four cells in grey, 60 × 60 and the cell's corner, «Завантажуємо розміри…» said to a reader alone; come, the cells where they stood (audit after stage 2, frame P1-4)", async ({
  page,
}) => {
  let answer = (): void => undefined;
  // Let go by itself in ten seconds, should the journey fail before it
  // answers: no read is left hanging as it ends.
  const held = new Promise<void>((resolve) => {
    answer = resolve;
    setTimeout(resolve, 10_000);
  });
  await page.route("**/api/v1/catalog/sizes?*", async (route) => {
    await held;
    await route.fallback();
  });
  await enter(page);
  const sheet = await create(
    page,
    `Повільні розміри ${randomUUID().slice(0, 8)}`,
  );
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  const grey = sheet.locator(
    ".new-model-sizes .placeholder.cells > .size-cell",
  );
  await expect(grey).toHaveCount(4);
  // Where a cell stands in the sizes' place: the sheet itself grows with
  // the rows that come.
  const place = sheet.locator(".new-model-sizes");
  const from = (await place.boundingBox())?.y ?? 0;
  const before = await grey.first().boundingBox();
  expect([before?.width ?? 0, before?.height ?? 0].map(Math.round)).toEqual([
    60, 60,
  ]);
  await expect(grey.first()).toHaveCSS("border-top-left-radius", "6px");
  await expect(
    sheet.getByRole("status").filter({ hasText: "Завантажуємо розміри…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  answer();
  const cells = sheet.getByRole("group", { name: "Розміри" });
  await expect(cells.locator(".size-cell").first()).toBeVisible();
  await expect(grey).toHaveCount(0);
  await expect(cells.locator(".size-cell").first()).toHaveCSS(
    "border-top-left-radius",
    "6px",
  );
  const after = await cells.locator(".size-cell").first().boundingBox();
  const to = (await place.boundingBox())?.y ?? 0;
  expect(
    Math.abs((after?.y ?? 0) - to - ((before?.y ?? 0) - from)),
  ).toBeLessThanOrEqual(4);
  await leave(page);
});

test("without the right to receive, a new model's sizes are typed: the organisation's are not asked, and nothing is refused (stage 2, goods task list, P1-1; review)", async ({
  page,
}) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "inventory:receive",
      );
    await route.fulfill({ response, json: body });
  });
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/catalog/sizes"))
      asked.push(request.url());
  });
  await enter(page);
  const raw = `Без приймання ${randomUUID().slice(0, 8)}`;
  const sheet = await create(page, raw);
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toBeVisible();
  await typeSize(sheet, "M", "ALPHA");
  await expect(sizeCell(sheet, "M")).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  await expect(sheet.getByText("Завантажуємо розміри…")).toHaveCount(0);
  expect(asked).toEqual([]);
  await leave(page);
});

test("«Пропозиції» past their first page: «Показати ще» under them, the list's width, 44 high, its edge, ink on nothing — one look and one word under every list (audit 2026-11-20, frame P2-1)", async ({
  page,
}) => {
  await enter(page);
  await create(page, `Наступна сторінка ${randomUUID().slice(0, 8)}`);
  await leave(page);
  // The queue's first page as the server's, more said to follow; the next
  // none.
  const asked: (string | null)[] = [];
  await page.route("**/api/v1/catalog/match-decisions?**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || !url.searchParams.has("limit")) {
      await route.continue();
      return;
    }
    const offset = url.searchParams.get("offset");
    asked.push(offset);
    if (offset === "0") {
      const response = await route.fetch();
      const body = (await response.json()) as { has_more: boolean };
      await route.fulfill({ response, json: { ...body, has_more: true } });
    } else await route.fulfill({ json: { items: [], has_more: false } });
  });
  await page.reload();
  await openStore(page, "Основний MAIN");
  await section(page, "Перевірка каталогу");
  const list = page.getByRole("list", { name: "Пропозиції" });
  await expect(list.getByRole("button").first()).toBeVisible();
  const more = page.getByRole("button", { name: "Показати ще", exact: true });
  await expectListMore(more, list);
  await more.click();
  await expect(more).toHaveCount(0);
  expect(asked[0]).toBe("0");
  expect(asked).toContain("20");
});

test("«Довжина, см» said wrong in «Нова модель»: its line under the field, the field marked and read with it; folded, the line under «Ще ознаки», the way on held — never the plate (audit 2026-11-20, frame P2-2, goods P2-1 (а))", async ({
  page,
}) => {
  await enter(page);
  const sheet = await create(page, `Довжина ${randomUUID().slice(0, 8)}`);
  await newModel(sheet, `Довжина ${randomUUID().slice(0, 8)}`, "M");
  const more = sheet.getByRole("button", { name: "Ще ознаки" });
  if ((await more.getAttribute("aria-expanded")) === "false")
    await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const length = sheet.getByLabel("Довжина, см", { exact: true });
  const add = sheet.getByRole("button", { name: /^Додати модель/ });
  await expect(add).toBeEnabled();
  await length.fill("12,34");
  const line = sheet.locator(".field-wrong", {
    hasText: "Вкажіть додатну довжину до 9999,9 см, з одним знаком після коми.",
  });
  await expectFieldSaidWrong(length, line);
  await expect(add).toBeDisabled();
  // Folded: the same line under «Ще ознаки», read with it, heard once as it
  // was typed — no alert of its own.
  await more.click();
  await expect(length).toHaveCount(0);
  await expectFieldLine(line, { alert: false });
  const id = await line.getAttribute("id");
  expect(id).toBeTruthy();
  await expect(more).toHaveAttribute("aria-describedby", id ?? "");
  const [fold, under] = await Promise.all([
    more.boundingBox(),
    line.boundingBox(),
  ]);
  if (!fold || !under) throw new Error("the fold not laid out");
  expect(under.y).toBeGreaterThanOrEqual(fold.y + fold.height);
  await expect(add).toBeDisabled();
  // Open again: under its field; emptied, the line gone, the way on taken.
  await more.click();
  await expectFieldSaidWrong(length, line);
  await length.fill("");
  await expect(line).toHaveCount(0);
  await expect(more).not.toHaveAttribute("aria-describedby");
  await expect(add).toBeEnabled();
  await leave(page);
});
