import {
  test,
  expect,
  gridCell,
  holdReads,
  openModel,
  openStore,
  receiveInto,
  receiveUnits,
  section,
} from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Товар»'s places while read, its lists by pages, its ways back (goods task
 * list after stage 2, P2-1, P2-2, P2-3): what the section reads stands in
 * grey where it will come, nothing jumps when it does; «Показати ще» and «Ще
 * товари» add the next page under the first; «← Перевірка каталогу» over a
 * proposal; a receipt's result keeps the form's «←».
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  till_location_id: string;
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

/** A section of «Основний MAIN», as Оля opens it. */
async function enter(page: Page, name: string): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await section(page, name);
}

async function token(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

/** An answer held until `release` is called — or ten seconds, should the
 * journey fail first — then given as `body`, or what it makes of the
 * request. */
function heldAnswer(
  body: object,
  make?: (route: Route) => object,
): {
  answer: (route: Route) => Promise<void>;
  release: () => void;
  /** Whether its request has come. */
  asked: () => boolean;
} {
  let release = (): void => undefined;
  let asked = false;
  const held = new Promise<void>((resolve) => {
    release = resolve;
    setTimeout(resolve, 10_000);
  });
  return {
    release,
    asked: () => asked,
    answer: async (route) => {
      asked = true;
      await held;
      await route.fulfill({
        json: make ? make(route) : body,
      });
    },
  };
}

/** What the app tells Telegram of its «Назад», shown or not, in order. */
async function hearBack(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      backs: boolean[];
    };
    host.backs = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_back_button")
          host.backs.push(
            (JSON.parse(data) as { is_visible: boolean }).is_visible,
          );
      },
    };
  });
}

async function lastBack(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() =>
    (window as unknown as { backs: boolean[] }).backs.at(-1),
  );
}

/** Telegram's «Назад» pressed. */
async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
}

/** A proposal of the queue, as the server answers it. */
function proposal(n: number, raw = `Пропозиція черги ${String(n)}`) {
  return {
    decision_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    store_id: fixture.store_id,
    status: "PENDING",
    knowledge_revision: 1,
    resolved_variant_id: null,
    preview: {
      raw_text: raw,
      candidates: [
        {
          family_id: randomUUID(),
          variant_id: randomUUID(),
          display_name: "Кокон графіт",
          distinction_note: null,
          conflicts: [],
        },
      ],
      review_reasons: [],
      truncated: false,
    },
    rejection: null,
    creation: null,
  };
}

/** The words of a place to a screen reader alone. */
async function heardOnly(page: Page, words: string): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: words })).toHaveClass(
    /visually-hidden/,
  );
  await expect(page.getByText(words, { exact: true })).toHaveCount(1);
}

async function top(element: Locator): Promise<number> {
  return (await element.boundingBox())?.y ?? Number.NaN;
}

/** The blank tag (spec §6.28): 64, its one line, its meta when given. */
async function blank(
  page: Page,
  line: string,
  meta: string | null = null,
): Promise<void> {
  const empty = page.locator(".orders-empty");
  await expect(empty.locator(".t-row")).toHaveText(line);
  const mark = empty.locator(".orders-empty-mark");
  await expect(mark).toBeVisible();
  expect(Math.round((await mark.boundingBox())?.height ?? 0)).toBe(64);
  if (meta === null) await expect(empty.locator(".t-meta")).toHaveCount(0);
  else await expect(empty.locator(".t-meta")).toHaveText(meta);
  await expect(empty.locator("button")).toHaveCount(0);
}

async function wide(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

test("«Перевірка каталогу» read slowly: three proposals' rows in grey where they come, a sticker's place each, the words to a reader alone; «Показати ще» adds the next page under the first, the cursor on the first it brings; a page that failed its retry alone, held while the queue is read again; the rows read stay under a re-read and its refusal (goods task list after stage 2, P2-1, P2-2; review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const twenty = {
    items: Array.from({ length: 20 }, (_, n) => proposal(n + 1)),
    has_more: true,
  };
  const first = heldAnswer(twenty);
  // «Оновити» after the next page failed: held, then refused.
  let refuseAgain = (): void => undefined;
  const againHeld = new Promise<void>((resolve) => {
    refuseAgain = resolve;
    setTimeout(resolve, 10_000);
  });
  let firstReads = 0;
  let nextReads = 0;
  await page.route("**/api/v1/catalog/match-decisions?**", async (route) => {
    const offset = new URL(route.request().url()).searchParams.get("offset");
    if (offset === "0") {
      firstReads += 1;
      if (firstReads === 1) return first.answer(route);
      if (firstReads === 2) {
        await againHeld;
        return route.fulfill({ status: 503, json: { detail: "later" } });
      }
      return route.fulfill({ json: twenty });
    }
    // The next page: refused once, then read.
    nextReads += 1;
    if (nextReads === 1)
      return route.fulfill({ status: 503, json: { detail: "later" } });
    return route.fulfill({
      json: {
        items: [21, 22, 23].map((n) => proposal(n)),
        has_more: false,
      },
    });
  });
  await enter(page, "Перевірка каталогу");
  const grey = page.locator(".placeholder .catalog-rows > .catalog-proposal");
  await expect(grey).toHaveCount(3);
  // Its lines the row's width, as the row's own words; under them a
  // sticker's place, 28 high.
  expect(
    (await grey.first().locator(".skeleton-name").boundingBox())?.width,
  ).toBeGreaterThan(100);
  expect(
    (await grey.first().locator(".skeleton-pill").boundingBox())?.height,
  ).toBe(28);
  await heardOnly(page, "Завантажуємо чергу…");
  const greyAt = await top(grey.first());
  const greyHigh = (await grey.first().boundingBox())?.height ?? 0;
  first.release();

  const rows = page
    .getByRole("list", { name: "Пропозиції" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(20);
  await expect(grey).toHaveCount(0);
  expect(Math.abs((await top(rows.first())) - greyAt)).toBeLessThanOrEqual(2);
  // The grey row as high as the row that came in its place.
  expect(
    Math.abs(
      ((await rows.first().getByRole("button").boundingBox())?.height ?? 0) -
        greyHigh,
    ),
  ).toBeLessThanOrEqual(2);
  expect(await wide(page)).toBe(360);
  for (const gone of ["Попередні пропозиції", "Наступні пропозиції"])
    await expect(page.getByRole("button", { name: gone })).toHaveCount(0);

  const more = page.getByRole("button", { name: "Показати ще", exact: true });
  await more.click();
  const retry = page.getByRole("button", { name: "Спробувати ще раз" });
  await expect(retry).toHaveCount(1);
  await expect(more).toHaveCount(0);
  await expect(rows).toHaveCount(20);

  // «Оновити» while the next page's failure stands: the rows stay, its
  // retry at their foot held while they are read.
  await page.getByRole("button", { name: "Оновити", exact: true }).click();
  await expect.poll(() => firstReads).toBe(2);
  await expect(retry).toBeDisabled();
  await expect(rows).toHaveCount(20);
  // Refused: its plate over the rows read, which stay; «Показати ще» held.
  refuseAgain();
  await expect(rows).toHaveCount(20);
  await expect(retry).toHaveCount(1);
  await expect(retry).toBeEnabled();
  expect(
    await retry.evaluate(
      (button) =>
        button.compareDocumentPosition(
          document.querySelector(".catalog-rows") as Node,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ),
  ).toBeTruthy();
  await expect(more).toBeDisabled();
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect(rows).toHaveCount(20);
  await expect(more).toBeEnabled();

  // The next page read: under the first, the cursor on the first it brings.
  await more.click();
  await expect(rows).toHaveCount(23);
  await expect(rows.first()).toContainText("Пропозиція черги 1");
  await expect(rows.last()).toContainText("Пропозиція черги 23");
  await expect(rows.nth(20).getByRole("button")).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(more).toHaveCount(0);
});

test("«Перевірка каталогу» with nothing: the blank tag on each of its three switches, in their words (goods task list after stage 2, P2-2)", async ({
  page,
}) => {
  await page.route("**/api/v1/catalog/match-decisions?**", (route) =>
    route.fulfill({ json: { items: [], has_more: false } }),
  );
  await enter(page, "Перевірка каталогу");
  await blank(
    page,
    "Нічого не чекає перевірки.",
    "Перевірка не змінює залишки й не об’єднує моделі.",
  );
  const queues = page.getByRole("group", { name: "Стан пропозицій" });
  await queues.getByRole("button", { name: "Підтверджені" }).click();
  await blank(page, "Підтверджених пропозицій ще немає.");
  await queues.getByRole("button", { name: "Відхилені" }).click();
  await blank(page, "Відхилених пропозицій немає.");
});

test("a proposal read slowly: its words, its sticker and two models offered in grey under «Пропозиція»; «← Перевірка каталогу» over it, the arrow unheard (goods task list after stage 2, P2-2, P2-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const one = proposal(1, "Пальто кокон графіт з поясом");
  await page.route("**/api/v1/catalog/match-decisions?**", (route) =>
    route.fulfill({ json: { items: [one], has_more: false } }),
  );
  const detail = heldAnswer(one);
  await page.route(
    `**/api/v1/catalog/match-decisions/${one.decision_id}`,
    detail.answer,
  );
  await enter(page, "Перевірка каталогу");
  await page
    .getByRole("button", { name: /Пальто кокон графіт з поясом/ })
    .click();

  await expect(
    page.getByRole("heading", { name: "Пропозиція", level: 1 }),
  ).toBeVisible();
  const back = page.getByRole("button", {
    name: "Назад до «Перевірка каталогу»",
    exact: true,
  });
  await expect(back).toHaveText("← Перевірка каталогу");
  await expect(back.locator('[aria-hidden="true"]')).toHaveText("←");
  await expect(back).toHaveClass(/\bback\b/);
  const grey = page.locator(".catalog-proposal-screen.placeholder");
  await expect(grey.locator(".catalog-raw-large .skeleton-line")).toBeVisible();
  await expect(grey.locator(".skeleton-pill")).toBeVisible();
  const offered = grey.locator(".new-model-candidates > li");
  await expect(offered).toHaveCount(2);
  expect(
    Math.round(
      (await offered.first().locator(".skeleton-choose").boundingBox())
        ?.height ?? 0,
    ),
  ).toBe(44);
  await heardOnly(page, "Завантажуємо пропозицію…");
  const greyAt = await top(grey.locator(".catalog-raw-large"));
  detail.release();

  const words = page.locator(".catalog-proposal-screen .catalog-raw-large");
  await expect(words).toHaveText("«Пальто кокон графіт з поясом»");
  await expect(grey).toHaveCount(0);
  expect(Math.abs((await top(words)) - greyAt)).toBeLessThanOrEqual(2);
  expect(await wide(page)).toBe(360);

  await back.click();
  await expect(
    page.getByRole("heading", { name: "Перевірка каталогу", level: 1 }),
  ).toBeVisible();
});

test("«Прийшов товар» read slowly: two warehouses' choices in grey, then a size's steps four in grey, 44 high; the catalogue's search three rows in grey, «Ще товари» adding its next page under the first, a page that failed its retry alone, «Попередні» gone (goods task list after stage 2, P2-1, P2-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const places = await holdReads(page, "stock-locations");
  const sizes = await holdReads(page, "catalog/sizes");
  const word = `Шукане${randomUUID().replace(/\D/g, "").slice(0, 6)}`;
  const found = (n: number) => ({
    product_variant_id: `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`,
    display_name: `${word} ${String(n)}`,
  });
  const firstPage = heldAnswer({
    items: Array.from({ length: 20 }, (_, n) => found(n + 1)),
    has_more: true,
  });
  // Typed again: read slowly, what was found before stays meanwhile.
  const retyped = heldAnswer({
    items: [found(31), found(32)],
    has_more: false,
  });
  let failed = 0;
  await page.route(
    "**/api/v1/catalog/receivable-variants?**",
    async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("query") === `${word}0`)
        return retyped.answer(route);
      // Other words, as many models as reach the failed page's place.
      if (url.searchParams.get("query") === `${word}9`)
        return route.fulfill({
          json: {
            items: Array.from({ length: 22 }, (_, n) => found(n + 41)),
            has_more: false,
          },
        });
      if (url.searchParams.get("query") !== word) return route.fallback();
      if (url.searchParams.get("offset") === "0")
        return firstPage.answer(route);
      if (failed < 2) {
        failed += 1;
        return route.fulfill({ status: 503, json: { detail: "later" } });
      }
      return route.fulfill({
        json: { items: [21, 22, 23].map(found), has_more: false },
      });
    },
  );
  await enter(page, "Прийшов товар");

  const chips = page.locator(
    ".placeholder.chips.receive-place > .chip.skeleton",
  );
  await expect(chips).toHaveCount(2);
  await heardOnly(page, "Завантажуємо склади…");
  places();
  await expect(chips).toHaveCount(0);

  // The catalogue's search, typed: three rows in grey, one line each.
  await page.getByLabel("Пошук у каталозі").fill(word);
  const greyRows = page.locator(".placeholder .catalog-found > .catalog-row");
  await expect(greyRows).toHaveCount(3);
  // Counted once: the held answer lets itself go after ten seconds.
  expect(await greyRows.first().locator(".skeleton-meta").count()).toBe(0);
  await heardOnly(page, "Шукаємо…");
  const greyAt = await top(greyRows.first());
  firstPage.release();
  const radios = page
    .getByRole("radiogroup", { name: "Знайдені товари" })
    .getByRole("radio");
  await expect(radios).toHaveCount(20);
  await expect(greyRows).toHaveCount(0);
  expect(Math.abs((await top(radios.first())) - greyAt)).toBeLessThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Попередні" })).toHaveCount(0);

  const more = page.getByRole("button", { name: "Ще товари", exact: true });
  await more.click();
  const retry = page.getByRole("button", { name: "Спробувати ще раз" });
  await expect(retry).toHaveCount(1);
  await expect(more).toHaveCount(0);
  await expect(radios).toHaveCount(20);
  // Other words typed after a page failed: their rows reach its place, and
  // the cursor stays in the field (the review of the audit's batch 16).
  const field = page.getByLabel("Пошук у каталозі");
  await field.fill(`${word}9`);
  await expect(radios).toHaveCount(22);
  await expect(radios.first()).toHaveText(`${word} 41`);
  await expect(field).toBeFocused();
  // Back to the first words, their page pressed and failed again.
  await field.fill(word);
  await expect(radios.first()).toHaveText(`${word} 1`);
  await expect(more).toHaveCount(1);
  await more.click();
  await expect(retry).toHaveCount(1);
  await expect(radios).toHaveCount(20);
  await retry.click();
  await expect(radios).toHaveCount(23);
  await expect(radios.first()).toHaveText(`${word} 1`);
  // The cursor on the first model the page brought.
  await expect(radios.nth(20)).toBeFocused();
  await expect(more).toHaveCount(0);
  await expect(retry).toHaveCount(0);

  // Typed again: what was found stays in place, no grey, no «Нічого не
  // знайшли», until the new search comes.
  await page.getByLabel("Пошук у каталозі").fill(`${word}0`);
  await expect.poll(() => retyped.asked()).toBe(true);
  await expect(radios).toHaveCount(23);
  await expect(greyRows).toHaveCount(0);
  await expect(page.getByText("Нічого не знайшли")).toHaveCount(0);
  retyped.release();
  await expect(radios).toHaveCount(2);
  await expect(radios.first()).toHaveText(`${word} 31`);

  // A model chosen, its sizes read slowly: four sizes' steps in grey.
  await radios.first().click();
  const steps = page.locator(".placeholder .receive-sizes > .receive-size");
  await expect(steps).toHaveCount(4);
  await expect(steps.first().locator(".skeleton")).toHaveCount(4);
  for (const step of await steps.first().locator(".skeleton-step").all())
    expect(Math.round((await step.boundingBox())?.height ?? 0)).toBe(44);
  expect(
    await steps.first().locator(".skeleton-code").boundingBox(),
  ).toMatchObject({ width: 28, height: 26 });
  await heardOnly(page, "Завантажуємо розміри…");
  expect(await wide(page)).toBe(360);
  sizes();
  await expect(steps).toHaveCount(0);
});

test("a receipt's result keeps the form's «←» and Telegram's «Назад»: from a model, pressed, it leads back to it, its grid read anew with what came — never the count before (goods task list after stage 2, P2-3; review)", async ({
  page,
}) => {
  const bearer = await token(page);
  const headers = {
    Authorization: `Bearer ${bearer}`,
    "Idempotency-Key": randomUUID(),
  };
  const tag = randomUUID().replace(/\D/g, "").slice(0, 8);
  const created = await page.request.post("/api/v1/catalog/products", {
    headers,
    data: {
      store_id: fixture.store_id,
      concept: `Плащ ${tag}`,
      variant: { color: "пісок" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const size = product.sizes[0]?.size_id ?? "";
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.till_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: size,
          quantity: 1,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(received.status(), await received.text()).toBe(201);
  const places = (await (
    await page.request.get(
      `/api/v1/stock-locations?store_id=${fixture.store_id}`,
      { headers: { Authorization: `Bearer ${bearer}` } },
    )
  ).json()) as { id: string; name: string }[];
  const till = places.find((one) => one.id === fixture.till_location_id);
  expect(till).toBeDefined();

  // From a Telegram that is told of «Назад».
  await hearBack(page);
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(), tgWebAppVersion: "8.0" }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  const name = new RegExp(`Плащ ${tag}`);
  await openModel(page, `Плащ ${tag}`, name);
  const cell = gridCell(page, fixture.till_location_id, size);
  await expect(cell).toContainText("1");
  const modelName =
    (await page.getByRole("heading", { level: 1, name }).textContent()) ?? "";

  await page.getByRole("button", { name: "Прийшов товар" }).click();
  await receiveInto(page, till?.name ?? "");
  await receiveUnits(page, "M", 2);
  // «Записати прихід · 2 шт.» is Telegram's MainButton here.
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  const result = page.getByRole("heading", {
    level: 1,
    name: /^Прийшло 2 шт\./,
  });
  await expect(result).toBeFocused();
  // The result's «←», as its form's; read only once the model is opened
  // again, while it is held.
  const back = page.getByRole("button", {
    name: `Назад до «${modelName}»`,
    exact: true,
  });
  await expect(back).toBeVisible();
  // Telegram's «Назад» shown over it, and pressed, it goes where «←» does.
  await expect.poll(() => lastBack(page)).toBe(true);
  const stock = await holdReads(page, "catalog/stock-options");
  await pressBack(page);
  // Never the count before the delivery: the grid's place, not «1».
  await expect(page.locator(".placeholder .model-tag")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name })).toHaveCount(0);
  stock();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(cell).toContainText("3");
});

test("«Моделі»'s model read slowly: its hero tag in place — the eyelet, the name's line 42 in grey, ⋯'s place — under «← Моделі»; the name comes where its grey stood (goods task list after stage 2, P2-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await enter(page, "Моделі");
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("Лоран");
  const row = page.getByRole("button", { name: /^Лоран шоколад 70/ }).first();
  await expect(row).toBeVisible();
  const card = await holdReads(page, "catalog/models/*");
  await row.click();
  const grey = page.locator(".model-screen.placeholder");
  await expect(grey.locator(".hero-eyelet")).toBeVisible();
  const title = grey.locator(".model-hero-head > .skeleton-title");
  expect(Math.round((await title.boundingBox())?.height ?? 0)).toBe(42);
  await expect(grey.locator(".model-hero-head > .debt-more")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Назад до пошуку моделей" }),
  ).toBeVisible();
  await heardOnly(page, "Завантажуємо модель…");
  const greyAt = await top(title);
  card();
  const heading = page.getByRole("heading", { level: 1, name: /^Лоран/ });
  await expect(heading).toBeVisible();
  await expect(grey).toHaveCount(0);
  expect(Math.abs((await top(heading)) - greyAt)).toBeLessThanOrEqual(2);
  expect(await wide(page)).toBe(360);
});

test("«Залишки» read slowly: two warehouses' choices in grey; a warehouse with nothing on it, the blank tag (goods task list after stage 2, P2-2)", async ({
  page,
}) => {
  // «Залишки» is «Ще»'s for whoever has no till (navigation task list,
  // P0-4), as «Залишки»'s own journeys open it.
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => p !== "sale:create");
    await route.fulfill({ response, json: body });
  });
  const places = await holdReads(page, "stock-locations");
  await page.route("**/api/v1/catalog/stock-options?**", (route) =>
    route.fulfill({ json: { items: [], has_more: false } }),
  );
  await enter(page, "Залишки");
  const chips = page.locator(
    ".placeholder.chips.stock-places > .chip.skeleton",
  );
  await expect(chips).toHaveCount(2);
  await heardOnly(page, "Завантажуємо склади…");
  places();
  await expect(chips).toHaveCount(0);
  // A warehouse chosen by the person, never by the screen.
  await page
    .getByRole("group", { name: "Склад" })
    .getByRole("button")
    .first()
    .click();
  await blank(page, "На цьому складі зараз немає товару.");
});

test("«Інвентаризація» read slowly: two warehouses' choices in grey; «Попередні»'s thread in grey, its eyelets round; a stocktake's differences in grey lines, as many as will be shown; counting with nothing, the blank tag on both switches (goods task list after stage 2, P2-2)", async ({
  page,
}) => {
  const at = "2026-11-10T09:30:00Z";
  const sums = {
    counted_positions: 0,
    unchecked_positions: 0,
    shortage_units: 4,
    shortage_positions: 4,
    surplus_units: 3,
    surplus_positions: 3,
  };
  // Of the warehouse chosen: a count opens only there.
  let where = "";
  const record = (id: string, finished: boolean) => ({
    id,
    location_id: where,
    location_name: "Склад",
    store_id: fixture.store_id,
    started_by: "Оля",
    started_at: at,
    finished_by: finished ? "Оля" : null,
    finished_at: finished ? at : null,
    sums,
  });
  const doneId = randomUUID();
  const openId = randomUUID();
  const places = await holdReads(page, "stock-locations");
  const list = heldAnswer({}, (route) => {
    where =
      new URL(route.request().url()).searchParams.get("location_id") ?? "";
    return { items: [record(openId, false), record(doneId, true)] };
  });
  await page.route("**/api/v1/stocktakes?**", list.answer);
  const differences = heldAnswer({ items: [], has_more: false });
  await page.route(`**/api/v1/stocktakes/${doneId}/positions?**`, (route) =>
    differences.answer(route),
  );
  await page.route(`**/api/v1/stocktakes/${openId}?**`, (route) =>
    route.fulfill({ json: record(openId, false) }),
  );
  await page.route(`**/api/v1/stocktakes/${openId}/positions?**`, (route) =>
    route.fulfill({ json: { items: [], has_more: false } }),
  );
  await enter(page, "Інвентаризація");

  const chips = page.locator(
    ".stocktaking .placeholder.chips > .chip.skeleton",
  );
  await expect(chips).toHaveCount(2);
  await heardOnly(page, "Завантажуємо склади…");
  places();
  await expect(chips).toHaveCount(0);
  await page
    .getByRole("group", { name: "Склад" })
    .getByRole("button")
    .first()
    .click();

  const thread = page.locator(".stocktakes .placeholder");
  await expect(
    thread.locator(".customer-history-title .skeleton-line"),
  ).toHaveText("Попередні");
  const knots = thread.locator(".timeline-row > .timeline-node.skeleton");
  await expect(knots).toHaveCount(3);
  await expect(knots.first()).toHaveCSS("border-radius", "999px");
  await heardOnly(page, "Завантажуємо інвентаризації…");
  list.release();
  await expect(thread).toHaveCount(0);

  await page.getByRole("button", { name: "Показати розбіжності" }).click();
  // As many as will be shown: seven, folded to five (review).
  const lines = page.locator(".stocktake-differences.placeholder > li");
  await expect(lines).toHaveCount(5);
  await heardOnly(page, "Завантажуємо розбіжності…");
  differences.release();
  await expect(lines).toHaveCount(0);

  await page.getByRole("button", { name: "Продовжити" }).click();
  await blank(page, "Усі позиції з залишком пораховано.");
  await page
    .getByRole("group", { name: "Які позиції" })
    .getByRole("button", { name: /^Пораховані/ })
    .click();
  await blank(page, "Ще нічого не пораховано.");
});

test("«Початкові залишки» read slowly: three lists' tags in grey, a list's own shape; none, the blank tag with what a list is (goods task list after stage 2, P2-2)", async ({
  page,
}) => {
  const lists = heldAnswer({ items: [], has_more: false });
  await page.route("**/api/v1/snapshots?**", lists.answer);
  await enter(page, "Початкові залишки");
  const grey = page.locator(
    ".openings .placeholder > .tags.opening-lists > .today-tag",
  );
  await expect(grey).toHaveCount(3);
  // A list's own shape: its eyelet, its name and meta, its sticker 28 and
  // «Відкрити» 44 at its foot (review).
  await expect(grey.first().locator(".today-tag-eyelet")).toHaveCount(1);
  const foot = grey.first().locator(".opening-tag-foot");
  expect((await foot.locator(".skeleton-pill").boundingBox())?.height).toBe(28);
  expect((await foot.locator(".skeleton-verb").boundingBox())?.height).toBe(44);
  await heardOnly(page, "Завантажуємо списки…");
  lists.release();
  await expect(grey).toHaveCount(0);
  await blank(
    page,
    "Списки із зошита — рядок за рядком.",
    "Поки список чекає, склад не рухається.",
  );
});
