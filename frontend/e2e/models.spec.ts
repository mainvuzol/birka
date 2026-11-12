import {
  test,
  expect,
  addModel,
  FAILED_REQUEST_ID,
  fillLine,
  leaveNewModel,
  more,
  newModelSheet,
  openStore,
  readsOf,
  receiveInto,
  receiveModel,
  receiveUnits,
  recordReceipt,
  refuseOnce,
  section,
  sections,
  tapSize,
  waitsFor,
  sellsFrom,
  propose,
  typeSize,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Correcting the catalogue (owner decision, 2026-10-03; ADR-0008).
 *
 * The owner and managers rename a model, merge a duplicate into the model
 * that stays, and retire a model and bring it back, in «Моделі». A merge
 * cannot be undone: it shows both models and their stock, and asks first.
 * A name like one the catalogue uses is warned about once.
 *
 * «Оля» holds every permission in both of the seed's stores, so she may
 * merge (the right in every store). Each test makes models of its own, held
 * in the returns warehouse, so nothing here changes another journey's shelf.
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(): string {
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
  return fields.toString();
}

/** A section; `version`: inside Telegram of that version. */
async function enter(page: Page, tab: string, version?: string): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({
      tgWebAppData: initData(),
      ...(version === undefined ? {} : { tgWebAppVersion: version }),
    }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await section(page, tab);
}

async function token(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

interface Made {
  variant: string;
  family: string;
  size: string;
}

/** A model of this test's own, `quantity` of it in the returns warehouse. */
async function model(
  page: Page,
  bearer: string,
  body: Record<string, unknown>,
  quantity: number,
): Promise<Made> {
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      sizes: [{ system: "ALPHA", code: "M" }],
      ...body,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    product_family_id: string;
    sizes: { size_id: string }[];
  };
  const size = product.sizes[0]?.size_id ?? "";
  if (quantity > 0) {
    const received = await page.request.post("/api/v1/inventory/receipts", {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        store_id: fixture.store_id,
        location_id: fixture.returns_location_id,
        command_id: randomUUID(),
        lines: [
          {
            product_variant_id: product.product_variant_id,
            size_id: size,
            quantity,
            acquisition_type: "PURCHASE",
            unit_cost: null,
          },
        ],
        notes: null,
      },
    });
    expect(received.status(), await received.text()).toBe(201);
  }
  return {
    variant: product.product_variant_id,
    family: product.product_family_id,
    size,
  };
}

/**
 * A colour of this test's own, and its typo: a Latin «a» in place of the
 * Cyrillic one, as the owner described. Every journey shares one catalogue,
 * so a typo of a word other journeys type (the seed's «шоколад») would warn
 * them all; digits keep each test's word its own.
 */
function colours(): { right: string; typo: string } {
  const tag = randomUUID().replace(/\D/g, "").slice(0, 8);
  return { right: `кава ${tag}`, typo: `кaва ${tag}` };
}

/** Two models of one name, the second a typo of the first's colour. */
async function duplicate(
  page: Page,
  bearer: string,
  name: string,
  colour: { right: string; typo: string },
): Promise<{ stays: Made; typo: Made }> {
  const stays = await model(
    page,
    bearer,
    { concept: name, variant: { color: colour.right } },
    2,
  );
  // Created on purpose, past the similar-name warning.
  const typo = await model(
    page,
    bearer,
    {
      product_family_id: stays.family,
      variant: { color: colour.typo },
      similar_confirmed: true,
    },
    3,
  );
  return { stays, typo };
}

async function held(
  page: Page,
  bearer: string,
  variant: string,
): Promise<number> {
  const response = await page.request.get(
    `/api/v1/inventory?store_id=${fixture.store_id}&location_id=${fixture.returns_location_id}&limit=500`,
    { headers: { Authorization: `Bearer ${bearer}` } },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    rows: { product_variant_id: string; quantity: number }[];
  };
  return body.rows
    .filter((row) => row.product_variant_id === variant)
    .reduce((sum, row) => sum + row.quantity, 0);
}

/** The models found as their words are typed — no «Знайти» (stage 2, goods
 * task list, P1-2). */
function foundModels(page: Page): Locator {
  return page.getByRole("list", { name: "Знайдені моделі" });
}

/** A model found and opened: its big tag, the cursor on its name. */
async function open(
  page: Page,
  query: string,
  name: RegExp | string,
): Promise<void> {
  await page.getByLabel("Знайти модель").fill(query);
  await foundModels(page).getByRole("button", { name }).click();
  await expect(page.locator("h1.model-hero-name")).toBeFocused();
}

/** The model's ⋯ sheet, its way taken (P1-2). */
async function way(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Дії з моделлю" }).click();
  const ways = page.getByRole("dialog");
  await expect(ways).toHaveAttribute("data-ready", "");
  await ways.getByRole("button", { name, exact: true }).click();
}

/** «Перейменувати» in its own sheet. */
async function renameSheet(page: Page): Promise<Locator> {
  await way(page, "Перейменувати");
  const sheet = page.getByRole("dialog", { name: "Перейменувати модель" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** «Зберегти назву»: outside Telegram, its MainButton in the sheet's foot. */
function saveName(sheet: Locator): Locator {
  return sheet.getByRole("button", { name: "Зберегти назву" });
}

/** «Об’єднати з іншою», the model that stays found and chosen. */
async function mergeWith(
  page: Page,
  query: string,
  name: RegExp | string,
): Promise<void> {
  await way(page, "Об’єднати з іншою");
  await expect(page.getByLabel("Модель, що лишиться")).toBeFocused();
  await page.getByLabel("Модель, що лишиться").fill(query);
  await foundModels(page)
    .getByRole("button", {
      name,
      ...(typeof name === "string" ? { exact: true } : {}),
    })
    .click();
}

/** «Об’єднати»: outside Telegram, its MainButton as the dock's button. */
function mergeButton(page: Page): Locator {
  return page
    .locator(".order-dock")
    .getByRole("button", { name: "Об’єднати", exact: true });
}

/** «Об’єднати», then the sheet that asks — Telegram's popup where it has
 * none — answered «Об’єднати». */
async function confirmMerge(
  page: Page,
  from: string,
  into: string,
): Promise<void> {
  await mergeButton(page).click();
  const ask = page.getByRole("dialog", {
    name: `Об’єднати «${from}» з «${into}»?`,
    exact: true,
  });
  await expect(ask).toHaveAttribute("data-ready", "");
  await expect(ask.getByText("Скасувати не можна.")).toBeVisible();
  await ask.getByRole("button", { name: "Об’єднати", exact: true }).click();
  await expect(ask).toHaveCount(0);
}

/**
 * A kept correction's next attempts, held until `release`: the phone asks
 * again by itself as soon as anything answers (ADR-0013 §4.3), so the
 * journey sees it kept first.
 */
function gate(): { held: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  return { held, release };
}

/** «Перевірити результат зміни» pressed — unless the phone, answered
 * meanwhile by another read, asked again by itself first: either way, the
 * same correction, and then `settled` is said. */
async function checked(page: Page, settled: Locator): Promise<void> {
  const pressed = page
    .getByRole("button", { name: "Перевірити результат зміни" })
    .click()
    .catch(() => undefined);
  await Promise.race([pressed, settled.waitFor()]);
  await expect(settled).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Зміну каталогу ще не підтверджено" }),
  ).toHaveCount(0);
}

/** A proposal of this test's own in «Каталог», waiting for review. */
async function proposal(
  page: Page,
  bearer: string,
  raw: string,
): Promise<string> {
  const id = randomUUID();
  const made = await page.request.post("/api/v1/catalog/match-decisions", {
    headers: { Authorization: `Bearer ${bearer}` },
    data: { decision_id: id, store_id: fixture.store_id, raw_text: raw },
  });
  expect(made.status(), await made.text()).toBe(200);
  return id;
}

/**
 * «Каталог»'s queue as these proposals alone: every journey shares one
 * queue, the oldest first, so a proposal made now is not on its first page.
 */
async function queue(page: Page, bearer: string, ids: string[]): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith("/api/v1/catalog/match-decisions"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const items = await Promise.all(
        ids.map(async (id) => {
          const read = await page.request.get(
            `/api/v1/catalog/match-decisions/${id}`,
            { headers: { Authorization: `Bearer ${bearer}` } },
          );
          return (await read.json()) as unknown;
        }),
      );
      await route.fulfill({ json: { items, has_more: false } });
    },
  );
}

/** «Нова модель» (stage 2, goods task list, P0-1), filled with a name, a
 * colour and the size S. */
async function fillProduct(
  sheet: Locator,
  name: string,
  colour: string,
): Promise<void> {
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await sheet.getByLabel("Колір", { exact: true }).fill(colour);
  await typeSize(sheet, "S", "ALPHA");
}

/** «Нова пропозиція», its words saved, then «Ні, це нова модель». */
async function proposeNew(page: Page, raw: string): Promise<Locator> {
  const sheet = await propose(page, raw);
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  return sheet;
}

/** A proposal of the queue's, opened, then «Створити нову» (P1-1). */
async function createFrom(page: Page, raw: string): Promise<Locator> {
  await page.getByRole("button", { name: new RegExp(raw) }).click();
  await page.getByRole("button", { name: "Створити нову" }).click();
  return newModelSheet(page);
}

test("a duplicate is merged after a preview, its stock moving to the model that stays", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Злиття ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  const { stays, typo } = await duplicate(page, bearer, name, colour);
  await enter(page, "Моделі");
  await open(page, name, new RegExp(colour.typo));
  await way(page, "Об’єднати з іншою");
  await expect(page.getByLabel("Модель, що лишиться")).toBeFocused();
  await page.getByLabel("Модель, що лишиться").fill(name);
  // The duplicate itself is not offered to stay.
  await expect(foundModels(page).getByRole("button")).toHaveText([
    `${name} ${colour.right}`,
  ]);
  await foundModels(page)
    .getByRole("button", { name: `${name} ${colour.right}`, exact: true })
    .click();
  // Both models' tags, and the stock that would move, before anything is
  // done: what goes, and what the model that stays holds already. The
  // cursor on the screen's heading, the tags under it.
  await expect(
    page.getByRole("heading", { name: "Об’єднати моделі", exact: true }),
  ).toBeFocused();
  const goes = page.getByRole("group", {
    name: `${name} ${colour.typo}`,
    exact: true,
  });
  const staying = page.getByRole("group", {
    name: `${name} ${colour.right}`,
    exact: true,
  });
  await expect(goes.locator(".sticker")).toHaveText("Зникне");
  await expect(staying.locator(".sticker")).toHaveText("Лишається");
  await expect(
    goes.getByRole("list", { name: "Склад повернень" }).getByRole("listitem"),
  ).toHaveText(["M — 3 шт.M3"]);
  await expect(
    staying
      .getByRole("list", { name: "Склад повернень" })
      .getByRole("listitem"),
  ).toHaveText(["M — 2 шт.M2"]);
  // The box to tick is gone: what cannot be undone is asked (§6.6).
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(mergeButton(page)).toBeEnabled();
  // The first answer is lost after the server merged: the journal keeps the
  // correction, and asking again answers with what was done, once. The
  // phone asks again by itself as soon as anything answers, and as
  // «Моделі» opens again (ADR-0013 §4.3): those answers lost too, until
  // the screen is seen kept.
  let attempts = 0;
  let lost = true;
  const keys: (string | null)[] = [];
  await page.route("**/api/v1/catalog/models/*/merge", async (route) => {
    attempts += 1;
    keys.push(await route.request().headerValue("Idempotency-Key"));
    if (attempts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else if (lost) await route.abort("failed");
    else await route.fulfill({ response: await route.fetch() });
  });
  await refuseOnce(page, "**/api/v1/catalog/models/*/merge", 422);
  await confirmMerge(page, `${name} ${colour.typo}`, `${name} ${colour.right}`);
  await expect(
    page.getByText("Моделі не об’єднано. Перевірте, яка модель лишається.", {
      exact: true,
    }),
  ).toBeVisible();
  // Changed meanwhile, or a request naming nothing: never «спробуйте ще
  // раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/catalog/models/*/merge", 409);
  await confirmMerge(page, `${name} ${colour.typo}`, `${name} ${colour.right}`);
  await expect(
    page.getByText("Моделі не об’єднано: їх щойно змінили — перегляньте їх.", {
      exact: true,
    }),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/catalog/models/*/merge", 404);
  await confirmMerge(page, `${name} ${colour.typo}`, `${name} ${colour.right}`);
  await expect(
    page.getByText("Моделі не об’єднано. Перевірте, яка модель лишається.", {
      exact: true,
    }),
  ).toBeVisible();
  await confirmMerge(page, `${name} ${colour.typo}`, `${name} ${colour.right}`);
  await expect(
    page.getByRole("heading", { name: "Зміну каталогу ще не підтверджено" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /^Чекає відповіді сервера з \d\d:\d\d\. Телефон перевірить сам\./,
    ),
  ).toBeVisible();
  // Held while it is unknown: the merge's own ways, and every section.
  await expect(
    page.getByRole("button", { name: "Поміняти місцями" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  // Its own section stays free under «Ще» › «Товар і каталог», every other
  // is held (P1-6; navigation task list, P0-4; «Усе на бірці» task list,
  // P0-4).
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: "Інвентаризація", exact: true }),
  ).toBeDisabled();
  await sections(page)
    .getByRole("button", { name: /^Товар і каталог/ })
    .click();
  await expect(
    sections(page).getByRole("button", {
      name: "Перевірка каталогу",
      exact: true,
    }),
  ).toBeDisabled();
  await sections(page)
    .getByRole("button", { name: "Моделі", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Зміну каталогу ще не підтверджено" }),
  ).toBeVisible();
  lost = false;
  // Answered on the search it opened on: said there.
  await checked(
    page,
    page.getByText(
      `Об’єднано: «${name} ${colour.typo}» тепер веде до «${name} ${colour.right}». Залишок і ціни перенесено.`,
    ),
  );
  // Every attempt the same correction, under its one key.
  expect(attempts).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1);
  expect(await held(page, bearer, stays.variant)).toBe(5);
  expect(await held(page, bearer, typo.variant)).toBe(0);
  // Searching the old name finds the model that stays.
  const found = await page.request.get(
    `/api/v1/catalog/receivable-variants?store_id=${fixture.store_id}&query=${encodeURIComponent(`${name} ${colour.typo}`)}`,
    { headers: { Authorization: `Bearer ${bearer}` } },
  );
  const items = (
    (await found.json()) as { items: { product_variant_id: string }[] }
  ).items;
  expect(items.map((item) => item.product_variant_id)).toEqual([stays.variant]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("nothing is merged into a retired model: the preview says so and the merge stays shut", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Прибрана ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  const { stays } = await duplicate(page, bearer, name, colour);
  const retired = await page.request.post(
    `/api/v1/catalog/models/${stays.variant}/retire`,
    {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Idempotency-Key": randomUUID(),
      },
      data: { store_id: fixture.store_id, command_id: randomUUID() },
    },
  );
  expect(retired.status()).toBe(200);
  await enter(page, "Моделі");
  await open(page, name, new RegExp(colour.typo));
  await mergeWith(page, name, `${name} ${colour.right} — Прибрана`);
  // What stops it, as rows under their heading (P1-2).
  const blockers = page.getByRole("alert").filter({
    has: page.getByRole("heading", { name: "Поки що не можна об’єднати" }),
  });
  await expect(blockers.getByRole("listitem")).toHaveText([
    "Модель, що лишається, прибрана. Спершу поверніть її.",
  ]);
  // The model that stays says it is retired on its tag.
  await expect(
    page
      .getByRole("group", { name: `${name} ${colour.right}`, exact: true })
      .locator(".sticker"),
  ).toHaveText(["Лишається", "Прибрана"]);
  await expect(mergeButton(page)).toBeDisabled();
  // «Поміняти місцями»: the retired one goes, and nothing stops it.
  await page.getByRole("button", { name: "Поміняти місцями" }).click();
  await expect(blockers).toHaveCount(0);
  await expect(
    page
      .getByRole("group", { name: `${name} ${colour.right}`, exact: true })
      .locator(".sticker"),
  ).toHaveText(["Зникне", "Прибрана"]);
  // Asked first, outside Telegram in a sheet of the popup's words: «Ні»
  // sends nothing.
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/merge"))
      sent.push(request.url());
  });
  await mergeButton(page).click();
  const ask = page.getByRole("dialog", {
    name: `Об’єднати «${name} ${colour.right}» з «${name} ${colour.typo}»?`,
    exact: true,
  });
  await expect(ask).toHaveAttribute("data-ready", "");
  await expect(mergeButton(page)).toHaveCount(0);
  await ask.getByRole("button", { name: "Ні", exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(mergeButton(page)).toBeEnabled();
  expect(sent).toEqual([]);
  // Back to the model, then to the search: its words as they were left,
  // the cursor on the row the model was opened from.
  await page
    .getByRole("button", { name: `Назад до моделі «${name} ${colour.typo}»` })
    .click();
  await expect(page.locator("h1.model-hero-name")).toBeFocused();
  await page.getByRole("button", { name: "Назад до пошуку моделей" }).click();
  await expect(page.getByLabel("Знайти модель")).toHaveValue(name);
  await expect(
    foundModels(page).getByRole("button", {
      name: new RegExp(colour.typo),
    }),
  ).toBeFocused();
});

test("a rename warns of a similar word, and taking the word in use saves it", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Назва ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  // The right spelling is in use, by another model.
  await model(
    page,
    bearer,
    { concept: `${name} інша`, variant: { color: colour.right } },
    0,
  );
  const renamed = await model(
    page,
    bearer,
    { concept: name, variant: { color: "графіт" } },
    1,
  );
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  const sheet = await renameSheet(page);
  // Its words grouped: the model and its colour, the rest folded (P1-2).
  await expect(
    sheet.getByText(
      "Змінюється лише ця модель. Старі продажі зберігають назву, під якою продали.",
    ),
  ).toBeVisible();
  const more = sheet.getByRole("button", { name: "Ще ознаки" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(sheet.getByLabel("Джерело", { exact: true })).toHaveCount(0);
  await sheet.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await saveName(sheet).click();
  await expect(sheet.getByText("Схожа назва вже є")).toBeVisible();
  await expect(
    sheet.getByText(
      `Колір: «${colour.typo}» схоже на «${colour.right}», що вже є в каталозі.`,
    ),
  ).toBeVisible();
  await expect(
    sheet.getByText(`Моделі з нею: ${name} інша ${colour.right}`),
  ).toBeVisible();
  // A similar word is the sheet's to answer: nothing more unfolds.
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await sheet.getByRole("button", { name: `Взяти «${colour.right}»` }).click();
  await expect(sheet.getByLabel("Колір", { exact: true })).toHaveValue(
    colour.right,
  );
  // A similar word of a folded field, taken: «Ще ознаки» unfolds to show it
  // as it changes (review, 2026-11-08). Its answer stubbed: the seed has no
  // such material.
  let similarOnce = false;
  await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
    if (similarOnce || route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    similarOnce = true;
    await route.fulfill({
      status: 409,
      json: {
        code: "CATALOG_SIMILAR",
        message: "Similar catalog word",
        details: {
          similar: [
            {
              field: "material",
              typed: "вавна",
              existing: ["вовна"],
              models: [],
            },
          ],
        },
      },
    });
  });
  await saveName(sheet).click();
  await expect(
    sheet.getByText("Матеріал: «вавна» схоже на «вовна», що вже є в каталозі."),
  ).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await sheet.getByRole("button", { name: "Взяти «вовна»" }).click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.getByLabel("Матеріал", { exact: true })).toHaveValue(
    "вовна",
  );
  // Left as it was, and folded again: the rest renames the colour alone.
  await sheet.getByLabel("Матеріал", { exact: true }).fill("");
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // Refused for a reason the screen does not name: its own words, never an
  // order's (owner decision, 2026-10-25) — every word unfolded to look at.
  await refuseOnce(page, "**/api/v1/catalog/models/*/rename", 422);
  await saveName(sheet).click();
  await expect(
    sheet.getByText("Назву не змінено. Перевірте поля.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(sheet.getByLabel("Джерело", { exact: true })).toBeVisible();
  await refuseOnce(page, "**/api/v1/catalog/models/*/rename", 409);
  await saveName(sheet).click();
  await expect(
    sheet.getByText(
      "Назву не змінено: модель щойно змінили — перегляньте її.",
      { exact: true },
    ),
  ).toBeVisible();
  // A request naming nothing: what was not done, then what to check —
  // never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/catalog/models/*/rename", 404);
  await saveName(sheet).click();
  await expect(
    sheet.getByText("Назву не змінено. Перевірте поля.", { exact: true }),
  ).toBeVisible();
  await saveName(sheet).click();
  // Done: the sheet gone, the card says it, the cursor on its new name.
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText(
      `Назву змінено: «${name} графіт» → «${name} ${colour.right}».`,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `${name} ${colour.right}`, exact: true }),
  ).toBeFocused();
  // Back to the search: the cursor on the row it was opened from.
  await page.getByRole("button", { name: "Назад до пошуку моделей" }).click();
  await expect(
    foundModels(page).locator(`[data-model="${renamed.variant}"]`),
  ).toBeFocused();
});

test("a retired model is not received until it is brought back", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Сезон ${randomUUID().slice(0, 8)}`;
  const made = await model(
    page,
    bearer,
    { concept: name, variant: { color: "графіт" } },
    1,
  );
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  const cardReads = readsOf(page, /\/api\/v1\/catalog\/models\/[^/]+$/);
  await refuseOnce(page, "**/api/v1/catalog/models/*/retire", 409);
  await way(page, "Прибрати модель");
  await expect(
    page.getByText("Модель не прибрано: її щойно змінили — перегляньте її.", {
      exact: true,
    }),
  ).toBeVisible();
  // The card read again, as it says.
  await expect.poll(cardReads).toBeGreaterThan(0);
  // A request naming nothing: what was not done, then what to check —
  // never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/catalog/models/*/retire", 404);
  await way(page, "Прибрати модель");
  await expect(
    page.getByText("Модель не прибрано. Перегляньте її картку.", {
      exact: true,
    }),
  ).toBeVisible();
  await way(page, "Прибрати модель");
  await expect(
    page.getByText(
      `«${name} графіт» прибрано: залишок продають, нового не приймають.`,
    ),
  ).toBeVisible();
  // Brought back at will: nothing was asked, the sheet is gone (P1-2).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".model-state")).toHaveText("Прибрана");
  await expect(
    page.getByText(
      "Прибрану модель не пропонують у «Прийшов товар» і пошуку; її залишок продають, повертають і списують.",
    ),
  ).toBeVisible();
  const receipt = (): Promise<{ status(): number; json(): Promise<unknown> }> =>
    page.request.post("/api/v1/inventory/receipts", {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        store_id: fixture.store_id,
        location_id: fixture.returns_location_id,
        command_id: randomUUID(),
        lines: [
          {
            product_variant_id: made.variant,
            size_id: made.size,
            quantity: 1,
            acquisition_type: "PURCHASE",
            unit_cost: null,
          },
        ],
        notes: null,
      },
    });
  const refused = await receipt();
  expect(refused.status()).toBe(409);
  expect(((await refused.json()) as { code: string }).code).toBe(
    "MODEL_RETIRED",
  );
  await refuseOnce(page, "**/api/v1/catalog/models/*/restore", 422);
  await way(page, "Повернути модель");
  await expect(
    page.getByText("Модель не повернуто. Перегляньте її картку.", {
      exact: true,
    }),
  ).toBeVisible();
  await way(page, "Повернути модель");
  await expect(
    page.getByText(`«${name} графіт» повернуто: її знову приймають.`),
  ).toBeVisible();
  await expect(page.locator(".model-state")).toHaveCount(0);
  expect((await receipt()).status()).toBe(201);
});

test("a sale whose answer was lost settles when its model was merged meanwhile", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Каса ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  const { stays, typo } = await duplicate(page, bearer, name, colour);
  // The first attempt never reaches the server: nothing is recorded, and the
  // till does not know it.
  let attempts = 0;
  await page.route("**/api/v1/sales", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  await sellsFrom(page, fixture.returns_location_id);
  const options = page.waitForResponse(
    (r) => r.url().includes("/catalog/stock-options?") && r.status() === 200,
  );
  await enter(page, "Продаж");
  await options;
  await tapSize(page, typo.variant, typo.size);
  await fillLine(page, { price: "150.00" });
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(page.getByText("Продаж ще не підтверджено")).toBeVisible();
  // Meanwhile a manager merges the duplicate.
  const merged = await page.request.post(
    `/api/v1/catalog/models/${typo.variant}/merge`,
    {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Idempotency-Key": randomUUID(),
      },
      data: {
        store_id: fixture.store_id,
        command_id: randomUUID(),
        into: stays.variant,
      },
    },
  );
  expect(merged.status(), await merged.text()).toBe(200);
  // Asking again is refused as proof nothing was recorded: the till is the
  // seller's again, and says why, and what to do with goods already given
  // (ADR-0013 §8).
  await page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click();
  await expect(page.getByText("Продаж ще не підтверджено")).toHaveCount(0);
  await expect(
    page.getByText(
      "Продаж не записано (цю модель об’єднано з іншою. Виберіть товар ще раз: стара назва тепер веде до моделі, що лишилась). Якщо товар віддали покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати знову.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Замовлення", exact: true }),
  ).toBeEnabled();
  expect(attempts).toBe(2);
  expect(await held(page, bearer, stays.variant)).toBe(5);
});

test("creating a product with a Latin letter in a known word is warned once", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Схожа ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} інша`, variant: { color: colour.right } },
    0,
  );
  await enter(page, "Перевірка каталогу");
  const sheet = await proposeNew(page, `${name} опис`);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  await expect(sheet.getByText("Схожа назва вже є")).toBeVisible();
  await sheet.getByRole("button", { name: `Взяти «${colour.right}»` }).click();
  await expect(sheet.getByLabel("Колір", { exact: true })).toHaveValue(
    colour.right,
  );
  await expect(sheet.getByText("Схожа назва вже є")).toHaveCount(0);
  await expect(sheet.getByText("У каталозі вже є схожа назва")).toHaveCount(0);
  await addModel(sheet).click();
  await expect(
    page.getByText(
      `Збережений товар: ${name} ${colour.right}. Розміри: S (ALPHA)`,
      { exact: true },
    ),
  ).toBeVisible();
});

test("only a person with the right in every store is offered a merge", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Право ${randomUUID().slice(0, 8)}`;
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  // The server says this person may not merge: a manager of one store.
  await page.route("**/api/v1/catalog/models/*?store_id=*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, may_merge: false } });
  });
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  await page.getByRole("button", { name: "Дії з моделлю" }).click();
  const ways = page.getByRole("dialog", { name: `${name} графіт` });
  await expect(ways.getByRole("button")).toHaveText([
    "Перейменувати",
    "Прибрати модель",
  ]);
  await expect(
    page.getByRole("button", { name: "Об’єднати з іншою" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(ways).toHaveCount(0);

  // Renamed as another model is named: said so, never who may join them
  // (stage 2, goods task list, P1-5).
  await model(
    page,
    bearer,
    { concept: `${name} друга`, variant: { color: "графіт" } },
    0,
  );
  await enter(page, "Моделі");
  await open(page, `${name} друга`, /друга графіт/);
  const sheet = await renameSheet(page);
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await saveName(sheet).click();
  // The same model, and the same colour: the name is that one's.
  await sheet.getByRole("radio", { name, exact: true }).check();
  await saveName(sheet).click();
  await expect(
    sheet.getByText("Така назва вже є в іншої моделі.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/право/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Об’єднати з тією моделлю" }),
  ).toHaveCount(0);
});

test("«Моделі» is the owner's and managers' alone", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (permission) => permission !== "catalog:merge",
      );
    await route.fulfill({ response, json: body });
  });
  await enter(page, "Продаж");
  // «Ще» › «Товар і каталог» without «Моделі»: its line says so, and its
  // own list holds none («Усе на бірці» task list, P0-4).
  await more(page);
  const catalogue = page
    .getByRole("navigation", { name: "Ще" })
    .getByRole("button", { name: /^Товар і каталог/ });
  // After the lists waiting to be approved and to be finished, as many as
  // the shared database holds (P1-5; stage 2, admin task list, P0-1).
  await expect(catalogue.locator(".more-meta")).toHaveText(
    /^(\d+\+? на затвердження · )?(\d+\+? доробити · )?перевірка, початкові залишки$/,
  );
  await catalogue.click();
  await expect(
    page.getByRole("button", { name: "Перевірка каталогу", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Моделі", exact: true }),
  ).toHaveCount(0);
});

test("a rename keeps a similar word once the person says it is another", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Інша ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: colour.right } },
    0,
  );
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  const sheet = await renameSheet(page);
  await sheet.getByLabel("Колір", { exact: true }).fill(colour.typo);
  // Enter in a field saves, as the button does.
  await sheet.getByLabel("Колір", { exact: true }).press("Enter");
  await expect(sheet.getByText("Схожа назва вже є")).toBeVisible();
  await sheet
    .getByRole("button", { name: "Це інша назва — зберегти як є" })
    .click();
  await expect(
    page.getByText(
      `Назву змінено: «${name} графіт» → «${name} ${colour.typo}».`,
    ),
  ).toBeVisible();
});

test("creating a product keeps a similar word once the person says it is another", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Своя ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: colour.right } },
    0,
  );
  await enter(page, "Перевірка каталогу");
  const sheet = await proposeNew(page, `${name} опис`);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  await expect(sheet.getByText("Схожа назва вже є")).toBeVisible();
  await sheet
    .getByRole("button", { name: "Це інша назва — створити як є" })
    .click();
  await expect(
    page.getByText(
      `Збережений товар: ${name} ${colour.typo}. Розміри: S (ALPHA)`,
      { exact: true },
    ),
  ).toBeVisible();
});

test("a similar name refused is not left over the queue after another tab", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Черга ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: colour.right } },
    0,
  );
  const raw = `${name} опис`;
  await queue(page, bearer, [await proposal(page, bearer, raw)]);
  await enter(page, "Перевірка каталогу");
  let sheet = await createFrom(page, raw);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  const refused = page.getByText(
    "У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
    { exact: true },
  );
  await expect(refused).toBeVisible();
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  // A first attempt refused kept nothing: the refusal answered that form,
  // and goes with it.
  await leaveNewModel(sheet);
  await expect(refused).toHaveCount(0);
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await section(page, "Перевірка каталогу");
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  await expect(refused).toHaveCount(0);
  // Opened again, its empty form is not answered by it either.
  sheet = await createFrom(page, raw);
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByText("Схожа назва вже є")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Це інша назва — створити як є" }),
  ).toHaveCount(0);
});

test("a similar name refused on one proposal is not answered on another", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Пропозиція ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: colour.right } },
    0,
  );
  const first = `${name} перша`;
  const second = `${name} друга`;
  await queue(page, bearer, [
    await proposal(page, bearer, first),
    await proposal(page, bearer, second),
  ]);
  await enter(page, "Перевірка каталогу");
  let sheet = await createFrom(page, first);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  await expect(sheet.getByText("Схожа назва вже є")).toBeVisible();
  await leaveNewModel(sheet);
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
  sheet = await createFrom(page, second);
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toBeVisible();
  // Nothing of this proposal was sent: nothing here says its words are like
  // another's, and nothing confirms them as another past the check.
  await expect(page.getByText("Схожа назва вже є")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Це інша назва — створити як є" }),
  ).toHaveCount(0);
  await expect(page.getByText("У каталозі вже є схожа назва")).toHaveCount(0);
});

test("words changed after a similar-name warning are checked, not confirmed", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Слова ${randomUUID().slice(0, 8)}`;
  const first = colours();
  const second = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: first.right } },
    0,
  );
  await model(
    page,
    bearer,
    { concept: `${name} ще`, variant: { color: second.right } },
    0,
  );
  const sent: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/create-product"))
      sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  await enter(page, "Перевірка каталогу");
  const sheet = await proposeNew(page, `${name} опис`);
  await fillProduct(sheet, name, first.typo);
  const create = addModel(sheet);
  const another = sheet.getByRole("button", {
    name: "Це інша назва — створити як є",
  });
  const advice = page.getByText(
    "У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
    { exact: true },
  );
  await create.click();
  await expect(
    page.getByText(
      `Колір: «${first.typo}» схоже на «${first.right}», що вже є в каталозі.`,
    ),
  ).toBeVisible();
  await expect(another).toBeVisible();
  await expect(advice).toBeVisible();
  // Another word typed since: «another» would confirm words never checked,
  // and nothing is left saying to take a spelling or confirm.
  await sheet.getByLabel("Колір", { exact: true }).fill(second.typo);
  await expect(another).toHaveCount(0);
  await expect(page.getByText("Схожа назва вже є")).toHaveCount(0);
  await expect(advice).toHaveCount(0);
  await create.click();
  await expect(
    page.getByText(
      `Колір: «${second.typo}» схоже на «${second.right}», що вже є в каталозі.`,
    ),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[1]?.similar_confirmed).toBeUndefined();
  expect(sent[1]?.variant).toEqual({ color: second.typo });
  // The words warned about may be confirmed as another.
  await another.click();
  await expect(
    page.getByText(
      `Збережений товар: ${name} ${second.typo}. Розміри: S (ALPHA)`,
      { exact: true },
    ),
  ).toBeVisible();
  expect(sent[2]).toMatchObject({
    similar_confirmed: true,
    variant: { color: second.typo },
  });
});

test("a delivery whose answer was lost settles when its model was retired meanwhile", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Поставка ${randomUUID().slice(0, 8)}`;
  const made = await model(
    page,
    bearer,
    { concept: name, variant: { color: "графіт" } },
    0,
  );
  // The first attempt never reaches the server: nothing is recorded.
  let attempts = 0;
  await page.route("**/api/v1/inventory/receipts", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  await enter(page, "Приймання");
  await receiveInto(page, "Склад повернень");
  await receiveModel(page, name);
  await receiveUnits(page, "M", 1);
  await recordReceipt(page, 1).click();
  await expect(
    page.getByRole("heading", { name: "Приймання ще не підтверджено" }),
  ).toBeVisible();
  await waitsFor(page, /^Приймання ще не підтверджено$/);
  // Meanwhile a manager retires the model.
  const retired = await page.request.post(
    `/api/v1/catalog/models/${made.variant}/retire`,
    {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Idempotency-Key": randomUUID(),
      },
      data: { store_id: fixture.store_id, command_id: randomUUID() },
    },
  );
  expect(retired.status()).toBe(200);
  await page
    .getByRole("button", { name: "Перевірити результат приймання" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Приймання ще не підтверджено" }),
  ).toHaveCount(0);
  // Settled, and said: what was not recorded, then why (ADR-0013 §1).
  await expect(
    page.getByText(
      "Приймання не записано. Цю модель прибрано: її залишок продають, але нового не приймають. Щоб приймати, поверніть її в «Моделях».",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  expect(attempts).toBe(2);
  expect(await held(page, bearer, made.variant)).toBe(0);
});

test("what opened after the preview is shown, and the merge waits for it", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Пізніше ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  const { stays } = await duplicate(page, bearer, name, colour);
  await enter(page, "Моделі");
  await open(page, name, new RegExp(colour.typo));
  await mergeWith(page, name, `${name} ${colour.right}`);
  await expect(mergeButton(page)).toBeEnabled();
  // Meanwhile someone retires the model that stays.
  const retired = await page.request.post(
    `/api/v1/catalog/models/${stays.variant}/retire`,
    {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Idempotency-Key": randomUUID(),
      },
      data: { store_id: fixture.store_id, command_id: randomUUID() },
    },
  );
  expect(retired.status()).toBe(200);
  // Asked, and answered: the server says what opened, read afresh.
  await confirmMerge(page, `${name} ${colour.typo}`, `${name} ${colour.right}`);
  await expect(
    page.getByText("Модель, що лишається, прибрана. Спершу поверніть її."),
  ).toBeVisible();
  await expect(mergeButton(page)).toBeDisabled();
});

test("a rename whose answer was lost settles when it was refused", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Втрачена ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: colour.right } },
    0,
  );
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  // The first attempt never reaches the server; asked again, it is refused
  // as a similar name, which proves nothing was recorded.
  let attempts = 0;
  const next = gate();
  await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("connectionfailed");
    else {
      await next.held;
      await route.continue();
    }
  });
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  const sheet = await renameSheet(page);
  await sheet.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await saveName(sheet).click();
  // Kept: the sheet gone, its stub over the card, the card's ways held.
  await expect(
    page.getByRole("heading", { name: "Зміну каталогу ще не підтверджено" }),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Дії з моделлю" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Назад до пошуку моделей" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  next.release();
  await checked(
    page,
    page.getByText(
      "Зміну каталогу не записано. У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
      { exact: true },
    ),
  );
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  expect(attempts).toBe(2);
});

for (const [what, status, said] of [
  ["a form", 422, "Зміну каталогу не записано. Внесіть її ще раз."],
  // Naming nothing at all: a kept change keeps its words (owner, В-П1 (б):
  // the kept operations' words stay).
  [
    "a request naming nothing",
    404,
    "Зміну каталогу не записано. Не вдалося виконати операцію. Спробуйте ще раз.",
  ],
  [
    "a conflict",
    409,
    "Зміну каталогу не записано. Каталог змінився, поки сервер не відповідав: перегляньте модель і внесіть зміну ще раз.",
  ],
] as const)
  test(`a rename whose answer was lost, refused on its check for ${what} no screen names and recorded nowhere, says it in the catalogue's words (owner decision, 2026-10-25)`, async ({
    page,
  }) => {
    const bearer = await token(page);
    const name = `Форма ${randomUUID().slice(0, 8)}`;
    await model(
      page,
      bearer,
      { concept: name, variant: { color: "графіт" } },
      0,
    );
    let attempts = 0;
    const next = gate();
    await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
      attempts += 1;
      if (attempts === 1) await route.abort("connectionfailed");
      else {
        await next.held;
        await route.fulfill({
          status,
          json: {
            code:
              status === 422
                ? "VALIDATION_ERROR"
                : status === 404
                  ? "NOT_FOUND"
                  : "CONFLICT",
            message: "Refused",
            details: { recorded: false },
          },
        });
      }
    });
    await enter(page, "Моделі");
    await open(page, name, /графіт/);
    const sheet = await renameSheet(page);
    await sheet.getByLabel("Колір", { exact: true }).fill("сірий");
    await saveName(sheet).click();
    await expect(
      page.getByRole("heading", { name: "Зміну каталогу ще не підтверджено" }),
    ).toBeVisible();
    const cardReads = readsOf(page, /\/api\/v1\/catalog\/models\/[^/]+$/);
    next.release();
    await checked(page, page.getByText(said, { exact: true }));
    expect(attempts).toBe(2);
    // A conflict reads the card again.
    if (status === 409) await expect.poll(cardReads).toBeGreaterThan(0);
  });

test("a correction whose answer was lost is sent again by itself as the server answers again, with no tap (ADR-0013 §4.3)", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Сама ${randomUUID().slice(0, 8)}`;
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  // The first attempt lost; the server is back at once.
  let attempts = 0;
  await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  const sheet = await renameSheet(page);
  await sheet.getByLabel("Колір", { exact: true }).fill("сірий");
  await saveName(sheet).click();
  // Nothing pressed: the phone's probe, or any answer, brings it back.
  await expect(
    page.getByText(`Назву змінено: «${name} графіт» → «${name} сірий».`),
  ).toBeVisible({ timeout: 20_000 });
  expect(attempts).toBe(2);
});

test("a correction whose answer was lost is checked once «Моделі» opens again, with no tap (review, 2026-11-08)", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Повернулась ${randomUUID().slice(0, 8)}`;
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  let lost = true;
  let attempts = 0;
  await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
    attempts += 1;
    if (lost) await route.abort("connectionfailed");
    else await route.continue();
  });
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  const sheet = await renameSheet(page);
  await sheet.getByLabel("Колір", { exact: true }).fill("сірий");
  await saveName(sheet).click();
  const kept = page.getByRole("heading", {
    name: "Зміну каталогу ще не підтверджено",
  });
  await expect(kept).toBeVisible();
  // The cursor on the stub as it comes.
  await expect(page.locator(".models-kept")).toBeFocused();
  // Left for «Ще»: nothing here sees the server come back.
  await more(page);
  lost = false;
  const before = attempts;
  await sections(page)
    .getByRole("button", { name: /^Товар і каталог/ })
    .click();
  await sections(page)
    .getByRole("button", { name: "Моделі", exact: true })
    .click();
  // Opened again: asked at once, said on the search it opens on — no
  // model opened for the person.
  await expect(
    page.getByText(`Назву змінено: «${name} графіт» → «${name} сірий».`),
  ).toBeVisible();
  await expect(page.getByLabel("Знайти модель")).toBeVisible();
  await expect(page.locator("h1.model-hero-name")).toHaveCount(0);
  await expect(kept).toHaveCount(0);
  expect(attempts).toBe(before + 1);
});

test("a correction whose answer was lost is checked by itself once the app is opened again, with no tap (ADR-0013 §4.3, G11)", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Знову ${randomUUID().slice(0, 8)}`;
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  // Every attempt lost until the app is opened again.
  let lost = true;
  let attempts = 0;
  await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
    attempts += 1;
    if (lost) await route.abort("connectionfailed");
    else await route.continue();
  });
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  const sheet = await renameSheet(page);
  await sheet.getByLabel("Колір", { exact: true }).fill("сірий");
  await saveName(sheet).click();
  const kept = page.getByRole("heading", {
    name: "Зміну каталогу ще не підтверджено",
  });
  await expect(kept).toBeVisible();
  // Opened again: «Моделі» at once, its stub, and the same correction asked
  // by itself.
  lost = false;
  const before = attempts;
  await page.reload();
  await openStore(page, "Основний MAIN");
  await expect(
    page.getByText(`Назву змінено: «${name} графіт» → «${name} сірий».`),
  ).toBeVisible();
  await expect(kept).toHaveCount(0);
  expect(attempts).toBe(before + 1);
});

test("a product whose creation answer was lost settles when it was refused", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Загублена ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: colour.right } },
    0,
  );
  let attempts = 0;
  await page.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      attempts += 1;
      if (attempts === 1) await route.abort("connectionfailed");
      else await route.continue();
    },
  );
  await enter(page, "Перевірка каталогу");
  const sheet = await proposeNew(page, `${name} опис`);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  await expect(page.getByText("Незавершена операція каталогу")).toBeVisible();
  // Pressed — unless the phone, answered meanwhile by another read, resends
  // it by itself first (ADR-0013 §4.3): either way, the same operation.
  const kept = page.getByText(
    "Операцію каталогу не записано. У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
    { exact: true },
  );
  const pressed = page
    .getByRole("button", { name: "Повторити ту саму операцію" })
    .click()
    .catch(() => undefined);
  await Promise.race([pressed, kept.waitFor()]);
  await expect(page.getByText("Незавершена операція каталогу")).toHaveCount(0);
  await expect(kept).toBeVisible();
  expect(attempts).toBe(2);
});

test("a catalogue operation refused for a reason it does not name says it was not recorded, then what to check (owner, В-П1 (б))", async ({
  page,
}) => {
  const name = `Ніщо ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  // Answered in turn — the last one set, the first: an ambiguous model,
  // a request not taken, a conflict it does not name, one naming nothing.
  await refuseOnce(
    page,
    "**/api/v1/catalog/match-decisions/*/create-product",
    404,
  );
  await refuseOnce(
    page,
    "**/api/v1/catalog/match-decisions/*/create-product",
    409,
  );
  await refuseOnce(
    page,
    "**/api/v1/catalog/match-decisions/*/create-product",
    422,
  );
  // An ambiguous model the server names: its words, never «повторіть
  // спробу» (owner, В-П1 (б)).
  await page.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          code: "CATALOG_AMBIGUOUS",
          message: "Ambiguous",
          details: { recorded: false },
        },
      });
    },
    { times: 1 },
  );
  await enter(page, "Перевірка каталогу");
  const sheet = await proposeNew(page, `${name} опис`);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  await expect(
    sheet.getByText(
      "Модель неоднозначна або стан каталогу змінився. Перевірте обрану модель. Для окремої моделі зі схожою назвою вкажіть її відмінність.",
      { exact: true },
    ),
  ).toBeVisible();
  await addModel(sheet).click();
  // Not taken, or changed in a way it does not name: what was not done
  // first.
  await expect(
    sheet.getByText(
      "Операцію каталогу не записано. Перевірте введені дані та стан пропозиції.",
      { exact: true },
    ),
  ).toBeVisible();
  await addModel(sheet).click();
  await expect(
    sheet.getByText(
      "Операцію каталогу не записано. Каталог або рішення змінилися. Оновіть перегляд. Для застарілої підказки створіть нову пропозицію та перевірте товар заново.",
      { exact: true },
    ),
  ).toBeVisible();
  await addModel(sheet).click();
  // Never «спробуйте ще раз»; nothing kept, the form as it was.
  await expect(
    sheet.getByText(
      "Операцію каталогу не записано. Перевірте модель і назву.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Незавершена операція каталогу")).toHaveCount(0);
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toHaveValue(
    name,
  );
  await addModel(sheet).click();
  await expect(
    page.getByText(
      `Збережений товар: ${name} ${colour.typo}. Розміри: S (ALPHA)`,
      { exact: true },
    ),
  ).toBeVisible();
});

test("a catalogue operation the server failed stays kept, said unconfirmed — never «не записано» nor «спробуйте ще раз» (review; owner decisions, 2026-10-18)", async ({
  page,
}) => {
  const name = `Збій ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  // The server's own failure, then the same operation sent again, held
  // until the screen is looked at.
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 500,
          headers: { "X-Request-ID": FAILED_REQUEST_ID },
          json: { code: "INTERNAL_ERROR", message: "Internal", details: {} },
        });
        return;
      }
      await gate;
      await route.continue();
    },
  );
  await enter(page, "Перевірка каталогу");
  const sheet = await proposeNew(page, `${name} опис`);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  await expect(sheet.getByText("Незавершена операція каталогу")).toBeVisible();
  await expect(
    sheet.getByText(
      "Операцію каталогу ще не підтверджено: сервер не зміг відповісти. Перевірте результат ще раз — двічі вона не запишеться. Номер запиту: 3f9c2a7e.",
      { exact: true },
    ),
  ).toBeVisible();
  release();
  await sheet
    .getByRole("button", { name: "Повторити ту саму операцію" })
    .click();
  await expect(
    page.getByText(
      `Збережений товар: ${name} ${colour.typo}. Розміри: S (ALPHA)`,
      { exact: true },
    ),
  ).toBeVisible();
  expect(calls).toBe(2);
});

test("a kept creation refused stays across tabs, answered on its own proposal alone", async ({
  page,
}) => {
  const bearer = await token(page);
  const name = `Збережена ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await model(
    page,
    bearer,
    { concept: `${name} вже`, variant: { color: colour.right } },
    0,
  );
  const first = `${name} перша`;
  const second = `${name} друга`;
  await queue(page, bearer, [
    await proposal(page, bearer, first),
    await proposal(page, bearer, second),
  ]);
  // The first attempt never reaches the server; resent, it is refused as a
  // similar name, which proves nothing was recorded.
  let attempts = 0;
  await page.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      attempts += 1;
      if (attempts === 1) await route.abort("connectionfailed");
      else await route.continue();
    },
  );
  await enter(page, "Перевірка каталогу");
  let sheet = await createFrom(page, first);
  await fillProduct(sheet, name, colour.typo);
  await addModel(sheet).click();
  await expect(page.getByText("Незавершена операція каталогу")).toBeVisible();
  // Pressed — unless the phone, answered meanwhile by another read, resends
  // it by itself first (ADR-0013 §4.3): either way, the same operation.
  const kept = page.getByText(
    "Операцію каталогу не записано. У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
    { exact: true },
  );
  const pressed = page
    .getByRole("button", { name: "Повторити ту саму операцію" })
    .click()
    .catch(() => undefined);
  await Promise.race([pressed, kept.waitFor()]);
  await expect(kept).toBeVisible();
  expect(attempts).toBe(2);
  // A kept operation's refusal says what was not recorded until the next
  // attempt: not left behind with the form, nor with the tab.
  await leaveNewModel(sheet);
  await expect(kept).toBeVisible();
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
  await expect(kept).toBeVisible();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await section(page, "Перевірка каталогу");
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  await expect(kept).toBeVisible();
  // Another proposal, the same words: they were not sent for it, so nothing
  // there says they are like another's, or confirms them past the check.
  sheet = await createFrom(page, second);
  await fillProduct(sheet, name, colour.typo);
  await expect(page.getByText("Схожа назва вже є")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Це інша назва — створити як є" }),
  ).toHaveCount(0);
  // Its own proposal, the words it sent: answered there.
  await leaveNewModel(sheet);
  await page
    .getByRole("button", { name: "Назад до «Перевірка каталогу»" })
    .click();
  sheet = await createFrom(page, first);
  await fillProduct(sheet, name, colour.typo);
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Це інша назва — створити як є" }),
  ).toBeVisible();
  await expect(kept).toBeVisible();
  expect(attempts).toBe(2);
});

test("a retirement an opening list stops says so", async ({ page }) => {
  const bearer = await token(page);
  const name = `Список ${randomUUID().slice(0, 8)}`;
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  // The server's refusal while a waiting list names the model (its shape is
  // the backend's to prove); what matters here is what the person reads.
  await page.route("**/api/v1/catalog/models/*/retire", async (route) => {
    await route.fulfill({
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "An opening list that waits names this model",
        details: {
          reason: "OPENING_LIST_WAITING",
          snapshot_ids: [randomUUID()],
          recorded: false,
        },
      },
    });
  });
  await enter(page, "Моделі");
  // Words no model has: said so.
  await page.getByLabel("Знайти модель").fill(`${name} немає`);
  await expect(
    page.getByText(`Нічого не знайшли за «${name} немає».`, { exact: true }),
  ).toBeVisible();
  await open(page, name, /графіт/);
  await way(page, "Прибрати модель");
  await expect(
    page.getByText(
      "Модель є в списку початкових залишків, що чекає. Спершу затвердіть або відхиліть його в «Початкових залишках».",
    ),
  ).toBeVisible();
});

/** Telegram, the journey's own: what the app tells it, and what it tells
 * the app. Before the page opens. */
async function telegram(page: Page): Promise<{
  told: (event: string) => Promise<unknown[]>;
  main: () => Promise<unknown>;
  fire: (type: string, data?: Record<string, unknown>) => Promise<void>;
}> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data?: string) => void;
      };
      told: [string, unknown][];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        host.told.push([event, data ? (JSON.parse(data) as unknown) : null]);
      },
    };
  });
  const told = (event: string): Promise<unknown[]> =>
    page.evaluate(
      (wanted) =>
        (window as unknown as { told: [string, unknown][] }).told
          .filter(([name]) => name === wanted)
          .map(([, data]) => data),
      event,
    );
  return {
    told,
    main: async () => (await told("web_app_setup_main_button")).at(-1) ?? null,
    fire: (type, data) =>
      page.evaluate(
        ([eventType, eventData]) => {
          window.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ eventType, eventData }),
              source: window.parent,
            }),
          );
        },
        [type, data] as const,
      ),
  };
}

test("inside Telegram a duplicate is merged in six taps — its row, ⋯, «Об’єднати з іншою», the model that stays, the MainButton «Об’єднати» and the popup's destructive «Об’єднати»; «Ні» and a popup closed send nothing (stage 2, goods task list, P1-2)", async ({
  page,
}) => {
  const { told, main, fire } = await telegram(page);
  const bearer = await token(page);
  const name = `Попап ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  const { stays, typo } = await duplicate(page, bearer, name, colour);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/merge"))
      sent.push(request.url());
  });
  // The preview's first answer held: the MainButton shown, not pressable
  // until both models and what stops them are read.
  const preview = gate();
  let previewed = false;
  await page.route("**/api/v1/catalog/models/*/merge/*", async (route) => {
    if (previewed || route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    previewed = true;
    await preview.held;
    await route.fallback();
  });
  await enter(page, "Моделі", "7.0");
  // 1: the duplicate's row, found as its words are typed.
  await open(page, name, new RegExp(colour.typo));
  // 2, 3: ⋯ and «Об’єднати з іншою»; 4: the model that stays.
  await mergeWith(page, name, `${name} ${colour.right}`);
  await expect
    .poll(main)
    .toMatchObject({ is_visible: true, is_active: false, text: "Об’єднати" });
  preview.release();
  await expect(
    page.getByRole("group", { name: `${name} ${colour.typo}`, exact: true }),
  ).toBeVisible();
  // The MainButton is Telegram's: the screen draws none of its own.
  await expect
    .poll(main)
    .toMatchObject({ is_visible: true, is_active: true, text: "Об’єднати" });
  await expect(page.locator(".order-dock")).toHaveCount(0);
  // No title: the question is the message (Telegram's title holds 64).
  const popup = {
    message: `Об’єднати «${name} ${colour.typo}» з «${name} ${colour.right}»? Скасувати не можна.`,
    buttons: [
      { id: "no", type: "default", text: "Ні" },
      { id: "merge", type: "destructive", text: "Об’єднати" },
    ],
  };
  // Asked there, not in the page; «Ні» merges nothing.
  await fire("main_button_pressed");
  await expect.poll(() => told("web_app_open_popup")).toEqual([popup]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await fire("popup_closed", { button_id: "no" });
  // Closed without a button: nothing either.
  await fire("main_button_pressed");
  await expect
    .poll(async () => (await told("web_app_open_popup")).length)
    .toBe(2);
  await fire("popup_closed", {});
  // 5, 6: the MainButton, and the popup's «Об’єднати».
  await fire("main_button_pressed");
  await expect
    .poll(async () => (await told("web_app_open_popup")).length)
    .toBe(3);
  await fire("popup_closed", { button_id: "merge" });
  await expect(
    page.getByText(
      `Об’єднано: «${name} ${colour.typo}» тепер веде до «${name} ${colour.right}». Залишок і ціни перенесено.`,
    ),
  ).toBeVisible();
  // Merged once, and felt once.
  expect(sent).toHaveLength(1);
  expect(
    (await told("web_app_trigger_haptic_feedback")).filter(
      (buzz) => (buzz as { type: string }).type === "notification",
    ),
  ).toEqual([{ type: "notification", notification_type: "success" }]);
  // The model that stays, its card; the MainButton gone with the screen.
  await expect(
    page.getByRole("heading", { name: `${name} ${colour.right}`, exact: true }),
  ).toBeFocused();
  await expect.poll(main).toMatchObject({ is_visible: false });
  expect(await held(page, bearer, stays.variant)).toBe(5);
  expect(await held(page, bearer, typo.variant)).toBe(0);
});

test("inside Telegram «Зберегти назву» is the rename sheet's MainButton, held while its answer is on its way (stage 2, goods task list, P1-2)", async ({
  page,
}) => {
  const { main, fire } = await telegram(page);
  const bearer = await token(page);
  const name = `Кнопка ${randomUUID().slice(0, 8)}`;
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 0);
  let answer = (): void => undefined;
  const answered = new Promise<void>((done) => {
    answer = done;
  });
  await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
    await answered;
    await route.continue();
  });
  await enter(page, "Моделі", "7.0");
  await open(page, name, /графіт/);
  const sheet = await renameSheet(page);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Зберегти назву",
  });
  await expect(sheet.locator(".sheet-done")).toHaveCount(0);
  // No name, no save.
  await sheet.getByLabel("Назва моделі", { exact: true }).fill("");
  await expect.poll(main).toMatchObject({ is_visible: true, is_active: false });
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await sheet.getByLabel("Колір", { exact: true }).fill("сірий");
  await fire("main_button_pressed");
  // On its way: the ring, and the sheet stands.
  await expect
    .poll(main)
    .toMatchObject({ is_visible: true, is_progress_visible: true });
  await expect(sheet.getByLabel("Колір", { exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  answer();
  await expect(
    page.getByText(`Назву змінено: «${name} графіт» → «${name} сірий».`),
  ).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect.poll(main).toMatchObject({ is_visible: false });
});

test("the merge's question fits Telegram's popup: long names shortened alike with «…», the question whole (stage 2, goods task list, P1-2)", async ({
  page,
}) => {
  const { told, fire } = await telegram(page);
  const bearer = await token(page);
  const tag = randomUUID().slice(0, 8);
  const name = `Довга ${tag} ${"оксамит ".repeat(20).trim()}`;
  const colour = colours();
  await duplicate(page, bearer, name, colour);
  await enter(page, "Моделі", "7.0");
  await open(page, name, new RegExp(colour.typo));
  await mergeWith(page, name, `${name} ${colour.right}`);
  await expect(
    page.getByRole("group", { name: `${name} ${colour.typo}`, exact: true }),
  ).toBeVisible();
  await fire("main_button_pressed");
  await expect
    .poll(async () => (await told("web_app_open_popup")).length)
    .toBe(1);
  const [asked] = (await told("web_app_open_popup")) as { message: string }[];
  const message = asked?.message ?? "";
  expect(message.length).toBeLessThanOrEqual(256);
  expect(message.length).toBeGreaterThan(240);
  expect(message).toMatch(
    new RegExp(
      `^Об’єднати «Довга ${tag} оксамит[^«»]*…» з «Довга ${tag} оксамит[^«»]*…»\\? Скасувати не можна\\.$`,
    ),
  );
  await fire("popup_closed", { button_id: "no" });
});

test("at 360 px, light and dark, the model's big tag and the merge's two tags fit (stage 2, goods task list, P1-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const bearer = await token(page);
  const name = `Тема ${randomUUID().slice(0, 8)}`;
  const colour = colours();
  await duplicate(page, bearer, name, colour);
  await enter(page, "Моделі");
  await open(page, name, new RegExp(colour.typo));
  const fits = (): Promise<boolean> =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const tags: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // The model's big tag, its ⋯ on it.
    await expect(page.locator(".model-hero")).toBeVisible();
    expect(await fits()).toBe(true);
    await page.screenshot({
      path: `test-results/models-card-360-${scheme}.png`,
    });
    // The merge: two tags with their stock, «Об’єднати» in the dock.
    await mergeWith(page, name, `${name} ${colour.right}`);
    const goes = page.getByRole("group", {
      name: `${name} ${colour.typo}`,
      exact: true,
    });
    await expect(goes).toBeVisible();
    await expect(mergeButton(page)).toBeEnabled();
    tags.push(
      await goes
        .locator(".merge-tag-in")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    expect(await fits()).toBe(true);
    await page.screenshot({
      path: `test-results/models-merge-360-${scheme}.png`,
    });
    // Asked: the sheet of the popup's words.
    await mergeButton(page).click();
    const ask = page.getByRole("dialog");
    await expect(ask).toHaveAttribute("data-ready", "");
    expect(await fits()).toBe(true);
    await page.screenshot({
      path: `test-results/models-ask-360-${scheme}.png`,
    });
    await ask.getByRole("button", { name: "Ні", exact: true }).click();
    await page
      .getByRole("button", { name: `Назад до моделі «${name} ${colour.typo}»` })
      .click();
    await expect(page.locator("h1.model-hero-name")).toBeFocused();
  }
  // The tags drawn in each theme's own colours.
  expect(tags[0]).not.toBe(tags[1]);
});
