import {
  test,
  expect,
  fillLine,
  more,
  openStore,
  readsOf,
  refuseOnce,
  section,
  sections,
  tapSize,
  waitsFor,
} from "./fixtures";
import type { Page } from "@playwright/test";
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

async function enter(page: Page, tab: string): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
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

async function open(page: Page, query: string, name: RegExp): Promise<void> {
  await page.getByLabel("Знайти модель").fill(query);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("button", { name }).click();
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

/** «Створити товар з опису», filled with a name, a colour and the size S. */
async function fillProduct(
  page: Page,
  name: string,
  colour: string,
): Promise<void> {
  await page.getByRole("button", { name: "Створити товар з опису" }).click();
  await page.getByLabel("Назва моделі", { exact: true }).fill(name);
  await page.getByLabel("Колір", { exact: true }).fill(colour);
  await page.getByLabel("Система розмірів").selectOption("ALPHA");
  await page.getByLabel("Розмір", { exact: true }).fill("S");
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
  await page.getByRole("button", { name: "Об’єднати з іншою" }).click();
  await page.getByLabel("Модель, що лишиться").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page
    .getByRole("button", { name: `${name} ${colour.right}`, exact: true })
    .click();
  // Both models, and the stock that would move, before anything is done.
  await expect(page.getByRole("definition").first()).toHaveText(
    `${name} ${colour.typo}`,
  );
  // What moves, and what the model that stays holds already.
  await expect(page.getByText("Склад повернень · M · 3 шт.")).toBeVisible();
  await expect(page.getByText("Залишок моделі, що лишається")).toBeVisible();
  await expect(page.getByText("Склад повернень · M · 2 шт.")).toBeVisible();
  const merge = page.getByRole("button", { name: "Об’єднати", exact: true });
  await expect(merge).toBeDisabled();
  await page.getByLabel("Розумію: об’єднання не можна скасувати.").check();
  // The first answer is lost after the server merged: the journal keeps the
  // correction, and asking again answers with what was done, once.
  let attempts = 0;
  const keys: (string | null)[] = [];
  await page.route("**/api/v1/catalog/models/*/merge", async (route) => {
    attempts += 1;
    keys.push(await route.request().headerValue("Idempotency-Key"));
    const response = await route.fetch();
    if (attempts === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await refuseOnce(page, "**/api/v1/catalog/models/*/merge", 422);
  await merge.click();
  await expect(
    page.getByText("Моделі не об’єднано. Спробуйте ще раз.", { exact: true }),
  ).toBeVisible();
  await merge.click();
  await expect(page.getByText("Незавершена зміна каталогу")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  // Its own section stays open under «Ще», every other is held (P1-6).
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: "Моделі", exact: true }),
  ).toBeEnabled();
  await expect(
    sections(page).getByRole("button", { name: "Товар", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат зміни" })
    .click();
  await expect(
    page.getByText(
      `Об’єднано: «${name} ${colour.typo}» тепер веде до «${name} ${colour.right}». Залишок і ціни перенесено.`,
    ),
  ).toBeVisible();
  expect(attempts).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  // The card now is the model that stays.
  await expect(
    page.getByRole("heading", { name: `${name} ${colour.right}`, exact: true }),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Об’єднати з іншою" }).click();
  await page.getByLabel("Модель, що лишиться").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page
    .getByRole("button", { name: `${name} ${colour.right} — Прибрана` })
    .click();
  await expect(
    page.getByText("Модель, що лишається, прибрана. Спершу поверніть її."),
  ).toBeVisible();
  await expect(
    page.getByLabel("Розумію: об’єднання не можна скасувати."),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Об’єднати", exact: true }),
  ).toBeDisabled();
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
  await model(page, bearer, { concept: name, variant: { color: "графіт" } }, 1);
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  await page.getByRole("button", { name: "Перейменувати" }).click();
  await page.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await page.getByRole("button", { name: "Зберегти назву" }).click();
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  await expect(
    page.getByText(
      `Колір: «${colour.typo}» схоже на «${colour.right}», що вже є в каталозі.`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(`Моделі з нею: ${name} інша ${colour.right}`),
  ).toBeVisible();
  await page.getByRole("button", { name: `Взяти «${colour.right}»` }).click();
  await expect(page.getByLabel("Колір", { exact: true })).toHaveValue(
    colour.right,
  );
  // Refused for a reason the screen does not name: its own words, never an
  // order's (owner decision, 2026-10-25).
  await refuseOnce(page, "**/api/v1/catalog/models/*/rename", 422);
  await page.getByRole("button", { name: "Зберегти назву" }).click();
  await expect(
    page.getByText("Назву не змінено. Перевірте поля та спробуйте ще раз.", {
      exact: true,
    }),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/catalog/models/*/rename", 409);
  await page.getByRole("button", { name: "Зберегти назву" }).click();
  await expect(
    page.getByText(
      "Назву не змінено: модель щойно змінили — перегляньте її й спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Зберегти назву" }).click();
  await expect(
    page.getByText(
      `Назву змінено: «${name} графіт» → «${name} ${colour.right}».`,
    ),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Прибрати модель" }).click();
  await expect(
    page.getByText(
      "Модель не прибрано: її щойно змінили — перегляньте її й спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  // The card read again, as it says.
  await expect.poll(cardReads).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Прибрати модель" }).click();
  await expect(
    page.getByText(
      `«${name} графіт» прибрано: залишок продають, нового не приймають.`,
    ),
  ).toBeVisible();
  await expect(page.getByText("Прибрана", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Повернути модель" }).click();
  await expect(
    page.getByText("Модель не повернуто. Спробуйте ще раз.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Повернути модель" }).click();
  await expect(
    page.getByText(`«${name} графіт» повернуто: її знову приймають.`),
  ).toBeVisible();
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
  await enter(page, "Продаж");
  const options = page.waitForResponse(
    (r) => r.url().includes("/catalog/stock-options?") && r.status() === 200,
  );
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.returns_location_id);
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
    page.getByRole("button", { name: "Змінити магазин" }),
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
  await enter(page, "Каталог");
  await page.getByRole("button", { name: "+ Нова пропозиція" }).click();
  await page.getByLabel("Початковий опис товару").fill(`${name} опис`);
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  await page.getByRole("button", { name: "Створити товар з опису" }).click();
  await page.getByLabel("Назва моделі", { exact: true }).fill(name);
  await page.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await page.getByLabel("Система розмірів").selectOption("ALPHA");
  await page.getByLabel("Розмір", { exact: true }).fill("S");
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  await page.getByRole("button", { name: `Взяти «${colour.right}»` }).click();
  await expect(page.getByLabel("Колір", { exact: true })).toHaveValue(
    colour.right,
  );
  await expect(page.getByText("Схожа назва вже є")).toHaveCount(0);
  await expect(page.getByText("У каталозі вже є схожа назва")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
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
  await expect(
    page.getByRole("button", { name: "Перейменувати" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Прибрати модель" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Об’єднати з іншою" }),
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
  await more(page);
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
  await page.getByRole("button", { name: "Перейменувати" }).click();
  await page.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await page.getByRole("button", { name: "Зберегти назву" }).click();
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  await page
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
  await enter(page, "Каталог");
  await page.getByRole("button", { name: "+ Нова пропозиція" }).click();
  await page.getByLabel("Початковий опис товару").fill(`${name} опис`);
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  await page.getByRole("button", { name: "Створити товар з опису" }).click();
  await page.getByLabel("Назва моделі", { exact: true }).fill(name);
  await page.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await page.getByLabel("Система розмірів").selectOption("ALPHA");
  await page.getByLabel("Розмір", { exact: true }).fill("S");
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  await page
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
  await enter(page, "Каталог");
  await page.getByRole("button", { name: new RegExp(raw) }).click();
  await fillProduct(page, name, colour.typo);
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
  const refused = page.getByText(
    "У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
    { exact: true },
  );
  await expect(refused).toBeVisible();
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  // A first attempt refused kept nothing: the refusal answered that form,
  // and goes with it.
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await section(page, "Каталог");
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  await expect(refused).toHaveCount(0);
  // Opened again, its empty form is not answered by it either.
  await page.getByRole("button", { name: new RegExp(raw) }).click();
  await page.getByRole("button", { name: "Створити товар з опису" }).click();
  await expect(page.getByLabel("Назва моделі", { exact: true })).toHaveValue(
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
  await enter(page, "Каталог");
  await page.getByRole("button", { name: new RegExp(first) }).click();
  await fillProduct(page, name, colour.typo);
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
  await expect(page.getByText("Схожа назва вже є")).toBeVisible();
  await page.getByRole("button", { name: "← До черги перевірки" }).click();
  await page.getByRole("button", { name: new RegExp(second) }).click();
  await page.getByRole("button", { name: "Створити товар з опису" }).click();
  await expect(page.getByLabel("Назва моделі", { exact: true })).toBeVisible();
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
  await enter(page, "Каталог");
  await page.getByRole("button", { name: "+ Нова пропозиція" }).click();
  await page.getByLabel("Початковий опис товару").fill(`${name} опис`);
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  await fillProduct(page, name, first.typo);
  const create = page.getByRole("button", {
    name: "Створити та пов’язати товар",
  });
  const another = page.getByRole("button", {
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
  await page.getByLabel("Колір", { exact: true }).fill(second.typo);
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
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.returns_location_id);
  await page.getByLabel("Пошук у каталозі").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page.getByRole("radio", { name: new RegExp(name) }).click();
  await page
    .getByRole("combobox", { name: "Розмір" })
    .selectOption({ label: "M" });
  await page.getByLabel("Кількість").fill("1");
  await page.getByRole("button", { name: "Додати до поставки" }).click();
  await page.getByRole("button", { name: "Прийняти на склад" }).click();
  await expect(page.getByText("Незавершене приймання")).toBeVisible();
  await waitsFor(page, /приймання/);
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
  await expect(page.getByText("Незавершене приймання")).toHaveCount(0);
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
  await page.getByRole("button", { name: "Об’єднати з іншою" }).click();
  await page.getByLabel("Модель, що лишиться").fill(name);
  await page.getByRole("button", { name: "Знайти" }).click();
  await page
    .getByRole("button", { name: `${name} ${colour.right}`, exact: true })
    .click();
  await page.getByLabel("Розумію: об’єднання не можна скасувати.").check();
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
  await page.getByRole("button", { name: "Об’єднати", exact: true }).click();
  await expect(
    page.getByText("Модель, що лишається, прибрана. Спершу поверніть її."),
  ).toBeVisible();
  await expect(
    page.getByLabel("Розумію: об’єднання не можна скасувати."),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Об’єднати", exact: true }),
  ).toBeDisabled();
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
  await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
    attempts += 1;
    if (attempts === 1) await route.abort("connectionfailed");
    else await route.continue();
  });
  await enter(page, "Моделі");
  await open(page, name, /графіт/);
  await page.getByRole("button", { name: "Перейменувати" }).click();
  await page.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await page.getByRole("button", { name: "Зберегти назву" }).click();
  await expect(page.getByText("Незавершена зміна каталогу")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат зміни" })
    .click();
  await expect(page.getByText("Незавершена зміна каталогу")).toHaveCount(0);
  await expect(
    page.getByText(
      "Зміну каталогу не записано. У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  expect(attempts).toBe(2);
});

for (const [what, status, said] of [
  ["a form", 422, "Зміну каталогу не записано. Внесіть її ще раз."],
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
    await page.route("**/api/v1/catalog/models/*/rename", async (route) => {
      attempts += 1;
      if (attempts === 1) await route.abort("connectionfailed");
      else
        await route.fulfill({
          status,
          json: {
            code: status === 422 ? "VALIDATION_ERROR" : "CONFLICT",
            message: "Refused",
            details: { recorded: false },
          },
        });
    });
    await enter(page, "Моделі");
    await open(page, name, /графіт/);
    await page.getByRole("button", { name: "Перейменувати" }).click();
    await page.getByLabel("Колір", { exact: true }).fill("сірий");
    await page.getByRole("button", { name: "Зберегти назву" }).click();
    await expect(page.getByText("Незавершена зміна каталогу")).toBeVisible();
    const cardReads = readsOf(page, /\/api\/v1\/catalog\/models\/[^/]+$/);
    await page
      .getByRole("button", { name: "Перевірити результат зміни" })
      .click();
    await expect(page.getByText(said, { exact: true })).toBeVisible();
    expect(attempts).toBe(2);
    // A conflict reads the card again.
    if (status === 409) await expect.poll(cardReads).toBeGreaterThan(0);
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
  await enter(page, "Каталог");
  await page.getByRole("button", { name: "+ Нова пропозиція" }).click();
  await page.getByLabel("Початковий опис товару").fill(`${name} опис`);
  await page.getByRole("button", { name: "Зберегти пропозицію" }).click();
  await page.getByRole("button", { name: "Створити товар з опису" }).click();
  await page.getByLabel("Назва моделі", { exact: true }).fill(name);
  await page.getByLabel("Колір", { exact: true }).fill(colour.typo);
  await page.getByLabel("Система розмірів").selectOption("ALPHA");
  await page.getByLabel("Розмір", { exact: true }).fill("S");
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
  await expect(page.getByText("Незавершена операція каталогу")).toBeVisible();
  await page
    .getByRole("button", { name: "Повторити ту саму операцію" })
    .click();
  await expect(page.getByText("Незавершена операція каталогу")).toHaveCount(0);
  await expect(
    page.getByText(
      "Операцію каталогу не записано. У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(attempts).toBe(2);
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
  await enter(page, "Каталог");
  await page.getByRole("button", { name: new RegExp(first) }).click();
  await fillProduct(page, name, colour.typo);
  await page
    .getByRole("button", { name: "Створити та пов’язати товар" })
    .click();
  await expect(page.getByText("Незавершена операція каталогу")).toBeVisible();
  await page
    .getByRole("button", { name: "Повторити ту саму операцію" })
    .click();
  const kept = page.getByText(
    "Операцію каталогу не записано. У каталозі вже є схожа назва. Візьміть її або підтвердьте, що це інша.",
    { exact: true },
  );
  await expect(kept).toBeVisible();
  expect(attempts).toBe(2);
  // A kept operation's refusal says what was not recorded until the next
  // attempt: not left behind with the form, nor with the tab.
  await page.getByRole("button", { name: "← До черги перевірки" }).click();
  await expect(kept).toBeVisible();
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
  await section(page, "Каталог");
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу" }),
  ).toBeVisible();
  await expect(kept).toBeVisible();
  // Another proposal, the same words: they were not sent for it, so nothing
  // there says they are like another's, or confirms them past the check.
  await page.getByRole("button", { name: new RegExp(second) }).click();
  await fillProduct(page, name, colour.typo);
  await expect(page.getByText("Схожа назва вже є")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Це інша назва — створити як є" }),
  ).toHaveCount(0);
  // Its own proposal, the words it sent: answered there.
  await page.getByRole("button", { name: "← До черги перевірки" }).click();
  await page.getByRole("button", { name: new RegExp(first) }).click();
  await fillProduct(page, name, colour.typo);
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
  await open(page, name, /графіт/);
  await page.getByRole("button", { name: "Прибрати модель" }).click();
  await expect(
    page.getByText(
      "Модель є в списку початкових залишків, що чекає. Спершу затвердіть або відхиліть його в «Початкових залишках».",
    ),
  ).toBeVisible();
});
