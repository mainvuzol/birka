import {
  test,
  expect,
  addModel,
  leaveNewModel,
  more,
  newModelSheet,
  openStore,
  propose,
  refuseOnce,
  section,
  sizeCell,
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
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Так, це його назва" }),
  ).toHaveCount(0);
  await fold.click();
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
  await row.click();
  await expect(
    page.getByText("Причина відхилення: Це інша модель", { exact: true }),
  ).toBeVisible();
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
    reopened.getByText(`Збережений товар: ${name} синій. Розміри: L (ALPHA)`, {
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

test("ambiguous named model retains explicit form then allows a distinct model", async ({
  page,
}) => {
  await enter(page);
  const sheet = await create(page, "Лоран інша модель");
  await newModel(sheet, "Лоран", "XL");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/create-product") && r.status() === 409,
  );
  await addModel(sheet).click();
  await response;
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toHaveValue(
    "Лоран",
  );
  // The way to say it is another model is in sight, «Ще ознаки» open.
  await expect(
    sheet.getByRole("button", { name: "Ще ознаки" }),
  ).toHaveAttribute("aria-expanded", "true");
  await sheet.getByLabel("Окрема модель зі схожою назвою").check();
  await sheet
    .getByLabel("Чим відрізняється модель")
    .fill("Інший крій для тесту");
  await addModel(sheet).click();
  await expect(
    page.getByText("Збережений товар: Лоран. Розміри: XL (ALPHA)", {
      exact: true,
    }),
  ).toBeVisible();
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
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
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
    page.getByText(`Збережений товар: ${name}. Розміри: M (ALPHA)`, {
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
  // Another colour of a model the catalogue has, found by its name.
  await sheet
    .getByRole("group", { name: "Яка модель" })
    .getByRole("button", { name: "Інший колір нашої моделі" })
    .click();
  // Asked as it is typed, no «Знайти модель», no Enter (goods task list
  // after stage 2, P1-5).
  await sheet.getByLabel("Пошук моделі в каталозі").fill(name);
  const choice = sheet.getByRole("button", {
    name: `Обрати модель: ${name} — Постачальник тестовий`,
    exact: true,
  });
  await expect(choice).toBeVisible();
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

test("at 360 px a proposal is its own screen: its words large, the models offered with «Це вона», none chosen, «Підтвердити: …» docked once one is, «Створити нову» and «Відхилити» — in sight, nothing past the width, in both themes (stage 2, goods task list, P1-1)", async ({
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
