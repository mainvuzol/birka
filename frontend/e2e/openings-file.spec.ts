import { test, expect, openStore, section } from "./fixtures";
import type { Locator, Page, Request, Route } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Початкові залишки» from a parser's file (owner decision, 2026-10-08;
 * ADR-0014): the shops photograph their notebooks, a parser reads them into
 * Birka's format, and each file joins the warehouse's one list. Every line is
 * still answered by a person: the parser's reading is shown beside it as a
 * hint, and only a split the line's own text shows is confirmed by a tap.
 *
 * Each journey has an empty warehouse of its own in the seed, and starts by
 * rejecting a list an earlier run left waiting there: the app offers no
 * second list for a warehouse whose list waits. The two that approve their
 * list open their warehouse, so they run once per seed.
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  second_store_id: string;
  file_location_id: string;
  file_removal_location_id: string;
  file_checks_location_id: string;
  file_slow_location_id: string;
  file_range_location_id: string;
  file_lost_location_id: string;
  file_narrow_location_id: string;
  file_late_location_id: string;
  file_later_location_id: string;
  shared_opening_location_id: string;
  network_owner_telegram_user_id: string;
  network_north_store_id: string;
  network_south_store_id: string;
  network_north_south_location_id: string;
  network_south_manager_telegram_user_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

/** RIGHT-TO-LEFT OVERRIDE: makes «12 шт» read «шт 21» where it stands. */
const RLO = String.fromCodePoint(0x202e);
/** SOFT HYPHEN: prints nothing, and makes a text differ from its look. */
const SHY = String.fromCodePoint(0x00ad);
/** VARIATION SELECTOR-16: a part of an emoji after a pictograph, hidden after a letter. */
const VS16 = String.fromCodePoint(0xfe0f);
/** LINE SEPARATOR: a line break by Unicode's rules. */
const LINE_SEPARATOR = String.fromCodePoint(0x2028);
/** Emoji a person's name may hold: a heart, a family joined, a keycap. */
const HEART = `${String.fromCodePoint(0x2764)}${VS16}`;
const FAMILY = [0x1f468, 0x1f469, 0x1f467]
  .map((code) => String.fromCodePoint(code))
  .join(String.fromCodePoint(0x200d));
const KEYCAP_ONE = `1${VS16}${String.fromCodePoint(0x20e3)}`;
/** A JSON escape's backslash, written out: the file holds `\` + `u0078`. */
const BACKSLASH = String.fromCharCode(92);
const SLOW =
  "Сервер ще не відповів. Оновіть список і перевірте, чи це збережено; повторити безпечно.";
const LAST =
  "Це останній файл списку. Якщо він помилковий — відхиліть список: склад звільниться.";

function initData(telegramUserId = fixture.telegram_user_id): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Оля"}`,
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

async function token(
  page: Page,
  telegramUserId = fixture.telegram_user_id,
): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId) },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

/** A name with no digits in it: a digit could be read as a count. */
function word(): string {
  const letters = "абвгдежзиклмнопрстуфхцчшщ";
  return Array.from(randomBytes(8), (b) =>
    letters.charAt(b % letters.length),
  ).join("");
}

/** A model of this test's own, in sizes M and L, colour «сірий». */
async function model(page: Page): Promise<string> {
  const name = `Ліст ${word()}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${await token(page)}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: name,
      variant: { color: "сірий" },
      sizes: [
        { system: "ALPHA", code: "M" },
        { system: "ALPHA", code: "L" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  return name;
}

/** A model of this test's own in the sizes 42 and 44, colour «сірий». */
async function numericModel(page: Page): Promise<string> {
  const name = `Парка ${word()}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${await token(page)}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: name,
      variant: { color: "сірий" },
      sizes: [
        { system: "NUMERIC_EU", code: "42" },
        { system: "NUMERIC_EU", code: "44" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  return name;
}

/**
 * A size brought into the catalogue by a model in it, as anyone may while a
 * list is answered: a number no other journey's line counts.
 */
async function sizeMade(page: Page, code: string): Promise<void> {
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${await token(page)}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: `Мірка ${word()}`,
      variant: { color: "сірий" },
      sizes: [{ system: "NUMERIC_EU", code }],
    },
  });
  expect(created.status()).toBe(201);
}

/** A list an earlier run left waiting here is rejected first. */
async function noListWaits(page: Page, location: string): Promise<void> {
  const headers = { Authorization: `Bearer ${await token(page)}` };
  const lists = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&location_id=${location}&status=IN_REVIEW&limit=100`,
    { headers },
  );
  const { items } = (await lists.json()) as {
    items: { snapshot_id: string }[];
  };
  for (const list of items) {
    const rejected = await page.request.post(
      `/api/v1/snapshots/${list.snapshot_id}/reject`,
      { headers, data: { reason: "лишився від іншого прогону" } },
    );
    expect(rejected.ok()).toBe(true);
  }
}

async function openings(page: Page): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await section(page, "Початкові залишки");
}

interface Line {
  text: string;
  photo: string;
  photo_line: number;
  model?: string;
  colours?: string[];
  sizes?: string[];
  size_counts?: { size: string; count: number }[];
  count?: number;
  price?: string;
  note?: string;
}

/** A parser's file, as a parser would write it: indented, `$schema` first. */
function stockFile(
  lines: Line[],
  envelope: Record<string, unknown> = {},
): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        $schema: "./birka-stock-list-v1.schema.json",
        format: "birka.stock-list",
        version: 1,
        parser: null,
        ...envelope,
        lines,
      },
      null,
      2,
    ),
  );
}

async function choose(
  scope: Locator,
  name: string,
  buffer: Buffer,
): Promise<void> {
  await scope
    .getByLabel("Файл від парсера (.json)")
    .setInputFiles({ name, mimeType: "application/json", buffer });
}

/** «Новий список» for this warehouse, from a file. */
/** The next command sent to `pattern` (never a read of it) refused once,
 * for a reason the screens do not name: its form (422) or a conflict
 * (409). */
async function refuseOnce(
  page: Page,
  pattern: string,
  status: 422 | 409,
): Promise<void> {
  let used = false;
  await page.route(pattern, async (route) => {
    if (used || route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    used = true;
    await route.fulfill({
      status,
      json:
        status === 422
          ? {
              code: "VALIDATION_ERROR",
              message: "Request failed validation",
              details: {},
            }
          : { code: "CONFLICT", message: "Conflict", details: {} },
    });
  });
}

async function newFromFile(page: Page, location: string): Promise<Locator> {
  await page.getByRole("button", { name: "Новий список" }).click();
  const form = page.getByRole("form", { name: "Новий список" });
  await form.getByLabel("Склад").selectOption(location);
  await form.getByLabel("Завантажити файл").check();
  return form;
}

function card(page: Page, line: number): Locator {
  return page.getByRole("article", {
    name: `Рядок ${String(line)}`,
    exact: true,
  });
}

async function answer(page: Page, line: number): Promise<Locator> {
  await card(page, line)
    .getByRole("button", { name: "Розібрати рядок" })
    .click();
  return page.getByRole("form", { name: `Розбір рядка ${String(line)}` });
}

/** The model is the person's choice: searched for, then picked. */
async function pickModel(editor: Locator, name: string): Promise<void> {
  await editor.getByRole("button", { name: "Знайти" }).click();
  await editor.getByRole("radio", { name: `${name} сірий` }).click();
}

/** Whether the phone holds the server for gone (ADR-0013 §4.2). */
async function down(page: Page): Promise<boolean> {
  return page.evaluate(async (path) => {
    const { useReach } = (await import(
      path
    )) as typeof import("../src/shared/reach");
    return useReach.getState().down;
  }, "/src/shared/reach.ts");
}

test("a file fills a new list: lines show their photo and reading, a split the line shows is confirmed by a tap, a second file joins, and the owner approves", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.file_location_id);
  await openings(page);
  const form = await newFromFile(page, fixture.file_location_id);
  await choose(
    form,
    "зошит-1.json",
    stockFile(
      [
        {
          text: `${coat} сірий M-1 L-2`,
          photo: "IMG_0001.jpg",
          photo_line: 1,
          model: coat,
          colours: ["сірий"],
          size_counts: [
            { size: "M", count: 1 },
            { size: "L", count: 2 },
          ],
        },
        {
          text: `${coat} сірий M 3 1200`,
          photo: "IMG_0001.jpg",
          photo_line: 2,
          model: coat,
          colours: ["сірий"],
          sizes: ["M"],
          count: 3,
          price: "1200",
        },
        {
          text: "Залишки на перше жовтня",
          photo: "IMG_0001.jpg",
          photo_line: 3,
          note: "заголовок",
        },
        {
          text: `Куртка ${RLO}абв${SHY} 1 шт`,
          photo: "IMG_0001.jpg",
          photo_line: 4,
        },
        {
          text: `${coat} сірий M-1 4XL-2`,
          photo: "IMG_0001.jpg",
          photo_line: 5,
          model: coat,
          size_counts: [
            { size: "M", count: 1 },
            { size: "4XL", count: 2 },
          ],
        },
      ],
      { source: "Зошит 1", price_kind: "purchase", counted_on: "жовтень" },
    ),
  );
  // What is in it, and where it goes, before anything is sent.
  await expect(form.getByLabel("Що у файлі")).toHaveText(
    "Файл «зошит-1.json»: рядків 5, фото 1, ціни закупівельні. Піде до списку складу «Склад для файлу».",
  );
  await expect(form.getByLabel("Звідки список (необов’язково)")).toHaveValue(
    "Зошит 1",
  );
  await expect(form.getByLabel("Коли перелічено (необов’язково)")).toHaveValue(
    "жовтень",
  );
  // The draft kept on the phone holds the file's name, nothing of its
  // content: the name and date it filled in come back with the file.
  const kept = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    `birka:stock-list-draft:${fixture.store_id}`,
  );
  expect(kept).toContain("зошит-1.json");
  expect(kept).not.toContain("Зошит 1");
  expect(kept).not.toContain("жовтень");
  await form.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name: "Зошит 1" })).toBeVisible();
  // The room left, as the server measures it: no cap is the phone's own.
  const waiting = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&location_id=${fixture.file_location_id}&status=IN_REVIEW&limit=1`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  const { limits } = (
    (await waiting.json()) as {
      items: { summary: { limits: { lines: number; allocations: number } } }[];
    }
  ).items[0]?.summary ?? { limits: { lines: -1, allocations: -1 } };
  await expect(
    page.getByText(
      `Місце у списку: рядків 5 з ${limits.lines.toLocaleString("uk-UA")} · відповідей 0 з ${limits.allocations.toLocaleString("uk-UA")}`,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Усі", exact: true }).click();

  // A line keeps its photo and what the parser read, as a hint.
  await expect(card(page, 1)).toContainText("Фото: IMG_0001.jpg, рядок 1");
  await expect(card(page, 1)).toContainText(
    "у рядку по розмірах: M × 1, L × 2",
  );
  await expect(card(page, 1)).toContainText(
    `Прочитано: ${coat} · сірий · M × 1, L × 2`,
  );
  // A number without «шт» is the parser's, not the line's.
  const hinted = card(page, 2);
  await expect(hinted).toContainText("Парсер прочитав кількість: 3");
  await expect(hinted).toContainText(
    "Парсер прочитав кількість, але в рядку вона не написана зі «шт» — це лише підказка. Вкажіть кількість і звідки вона відома.",
  );
  await expect(hinted).toContainText("Ціна з зошита: 1200 (закупівельна)");
  await expect(card(page, 3)).toContainText("Примітка парсера: заголовок");
  // What reorders the line, or prints nothing, is shown as a mark, and the
  // line kept as is.
  const reordered = card(page, 4).locator(".catalog-raw");
  await expect(reordered).toHaveText("4. Куртка ⟦U+202E⟧абв⟦U+00AD⟧ 1 шт");
  expect(await card(page, 4).innerText()).not.toContain(RLO);
  expect(await card(page, 4).innerText()).not.toContain(SHY);

  // The count the parser read is never offered as stated, nor one piece.
  let editor = await answer(page, 2);
  await expect(editor.getByLabel(/Як у списку/)).toHaveCount(0);
  await expect(editor.getByLabel(/Як у рядку/)).toHaveCount(0);
  await expect(
    editor.getByLabel("Рядок без кількості — одна штука"),
  ).toHaveCount(0);
  await expect(editor.getByRole("radio", { checked: true })).toHaveCount(0);
  // The search starts from the model as read, never with its colour.
  await expect(editor.getByLabel("Пошук у каталозі")).toHaveValue(coat);
  await editor.getByLabel("Відомо інакше").check();
  await pickModel(editor, coat);
  await editor.getByLabel("Розмір").selectOption({ label: "M" });
  await editor.getByLabel("Кількість").fill("3");
  const save = editor.getByRole("button", { name: "Зберегти відповідь" });
  await expect(save).toBeDisabled();
  await editor.getByLabel("Звідки це відомо").fill("на фото видно 3 шт");
  await save.click();
  await expect(card(page, 2)).toContainText("Звідки кількість: Відомо інакше");

  // The split the line shows is offered, and taken only by a tap.
  editor = await answer(page, 1);
  const bySize = editor.getByLabel("Як у рядку, по розмірах: M × 1, L × 2");
  await expect(bySize).toBeVisible();
  await expect(bySize).not.toBeChecked();
  await expect(editor.getByRole("radio", { checked: true })).toHaveCount(0);
  await bySize.check();
  await expect(
    editor
      .getByRole("list", { name: "Розміри й кількість, як у рядку" })
      .getByRole("listitem"),
  ).toHaveText(["M × 1", "L × 2"]);
  await expect(
    editor.getByRole("combobox", { name: "Розмір", exact: true }),
  ).toHaveCount(0);
  const saveSplit = editor.getByRole("button", { name: "Зберегти відповідь" });
  await expect(saveSplit).toBeDisabled();
  await pickModel(editor, coat);
  await saveSplit.click();
  await expect(card(page, 1)).toContainText(
    "Звідки кількість: Як у рядку, по розмірах",
  );
  await expect(card(page, 1)).toContainText(`→ ${coat} сірий, M × 1`);
  await expect(card(page, 1)).toContainText(`→ ${coat} сірий, L × 2`);

  // A size the catalogue lacks: no tap; the person creates it, or says how.
  editor = await answer(page, 5);
  await expect(editor.getByLabel(/Як у рядку/)).toHaveCount(0);
  await expect(editor).toContainText(
    "Рядок показує кількість по розмірах (M × 1, 4XL × 2), але розміру «4XL» немає в каталозі.",
  );
  await editor.getByLabel("Це не товар").check();
  await editor.getByLabel("Чому це не товар").fill("розмір 4XL ще не заведено");
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 5)).toContainText("Не товар");

  for (const [line, why] of [
    [3, "заголовок сторінки"],
    [4, "не наша модель"],
  ] as const) {
    editor = await answer(page, line);
    await editor.getByLabel("Це не товар").check();
    await editor.getByLabel("Чому це не товар").fill(why);
    await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
    await expect(card(page, line)).toContainText(`Не товар: ${why}`);
  }

  // A second file joins the same list.
  await page.getByRole("button", { name: "Додати файл" }).click();
  const adding = page.getByRole("form", { name: "Додати файл" });
  await choose(
    adding,
    "зошит-2.json",
    stockFile(
      [
        {
          text: `${coat} сірий L-1`,
          photo: "IMG_0002.jpg",
          photo_line: 1,
          model: coat,
          size_counts: [{ size: "L", count: 1 }],
        },
      ],
      { source: "Зошит 2" },
    ),
  );
  await expect(adding.getByLabel("Що у файлі")).toHaveText(
    "Файл «зошит-2.json»: рядків 1, фото 1. Піде до списку складу «Склад для файлу».",
  );
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  const second = page.getByRole("article", { name: "Файл 2" });
  await expect(second).toContainText("2. «зошит-2.json»");
  await expect(second).toContainText("Рядки 6–6 · розібрано 0 з 1");
  await expect(second).toContainText(/Додано: Оля, /);

  // Its lines alone, and its one size with its count, by a tap.
  await page
    .getByRole("combobox", { name: "Файл", exact: true })
    .selectOption({ label: "2. «зошит-2.json»" });
  await expect(card(page, 6)).toBeVisible();
  await expect(card(page, 1)).toHaveCount(0);
  await expect(card(page, 6)).toContainText("Файл: «зошит-2.json»");
  editor = await answer(page, 6);
  const oneSize = editor.getByLabel("Як у рядку, по розмірах: L × 1");
  await expect(oneSize).not.toBeChecked();
  await oneSize.check();
  await pickModel(editor, coat);
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 6)).toContainText(`→ ${coat} сірий, L × 1`);

  // The approval names what rests on the split the lines showed.
  const approval = page.getByLabel("Затвердження списку");
  await expect(approval).toContainText("Файлів у списку: 2");
  await expect(
    approval.getByText("Як у рядку, по розмірах: рядків 2, одиниць 4"),
  ).toBeVisible();
  await expect(
    approval.getByText("Відомо інакше: рядків 1, одиниць 3"),
  ).toBeVisible();
  await approval.getByRole("button", { name: "Затвердити список" }).click();
  await approval.getByRole("button", { name: "Так, затвердити" }).click();
  await expect(
    page.getByText(
      "Затверджено: 7 од. стали початковим залишком складу «Склад для файлу».",
    ),
  ).toBeVisible();

  // The line is kept as the file wrote it: the mark was only on the screen.
  const headers = { Authorization: `Bearer ${await token(page)}` };
  const lists = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&location_id=${fixture.file_location_id}&limit=1`,
    { headers },
  );
  const [list] = ((await lists.json()) as { items: { snapshot_id: string }[] })
    .items;
  const lines = await page.request.get(
    `/api/v1/snapshots/${list?.snapshot_id ?? ""}/lines?limit=50`,
    { headers },
  );
  const { items } = (await lines.json()) as {
    items: { line_no: number; raw_text: string }[];
  };
  expect(items.find((line) => line.line_no === 4)?.raw_text).toBe(
    `Куртка ${RLO}абв${SHY} 1 шт`,
  );
});

test("a file added by mistake is removed with its answers, the last file is not, and a removed file comes back as a new one", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.file_removal_location_id);
  await openings(page);
  const first = stockFile(
    [{ text: `${coat} сірий M 2 шт`, photo: "P1.jpg", photo_line: 1 }],
    { source: "Зошит прибирання" },
  );
  const wrong = stockFile([
    { text: `${coat} сірий L 1 шт`, photo: "P2.jpg", photo_line: 1 },
    { text: "Разом по сторінці", photo: "P2.jpg", photo_line: 2 },
  ]);
  const form = await newFromFile(page, fixture.file_removal_location_id);
  await choose(form, "a.json", first);
  await form.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByRole("heading", { name: "Зошит прибирання" }),
  ).toBeVisible();

  // The one file of a list is not removed: the list is rejected instead.
  const one = page.getByRole("article", { name: "Файл 1" });
  await expect(
    one.getByRole("button", { name: "Прибрати файл" }),
  ).toBeDisabled();
  await expect(one).toContainText(LAST);

  await page.getByRole("button", { name: "Додати файл" }).click();
  await choose(
    page.getByRole("form", { name: "Додати файл" }),
    "b.json",
    wrong,
  );
  // Refused for a reason the screen does not name: a file's words, never
  // an order's (review, 2026-10-24).
  await refuseOnce(page, "**/api/v1/snapshots/*/parts?**", 422);
  await page.getByRole("button", { name: "Додати до списку" }).click();
  await expect(
    page.getByRole("form", { name: "Додати файл" }).getByRole("alert"),
  ).toHaveText("Файл не додано. Перевірте його та спробуйте ще раз.");
  await page.getByRole("button", { name: "Додати до списку" }).click();
  const two = page.getByRole("article", { name: "Файл 2" });
  await expect(two).toContainText("Рядки 2–3 · розібрано 0 з 2");
  await expect(
    one.getByRole("button", { name: "Прибрати файл" }),
  ).toBeEnabled();
  await expect(one).not.toContainText(LAST);

  // One of its lines answered, then the file goes, with that answer.
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  let editor = await answer(page, 2);
  await expect(editor.getByLabel("Як у списку: 1 шт")).toBeChecked();
  await pickModel(editor, coat);
  await editor.getByLabel("Розмір").selectOption({ label: "L" });
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(two).toContainText("розібрано 1 з 2");
  await expect(page.getByText(/^Рядків: 3 · розібрано 1/)).toBeVisible();

  await two.getByRole("button", { name: "Прибрати файл" }).click();
  await expect(two.getByLabel("Прибрати файл?", { exact: true })).toContainText(
    "Прибрати файл «b.json»? Рядки цього файлу (2) не увійдуть до затвердження, а відповіді на них (1) зникнуть; рядки буде видно як прибрані. Інші файли лишаться.",
  );
  await refuseOnce(page, "**/api/v1/snapshots/*/parts/*/remove?**", 409);
  await two.getByRole("button", { name: "Так, прибрати" }).click();
  await expect(
    page.getByText(
      "Файл не прибрано. Поки ви працювали, список змінився — перегляньте його й спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await two.getByRole("button", { name: "Прибрати файл" }).click();
  await two.getByRole("button", { name: "Так, прибрати" }).click();
  await expect(two).toContainText(/Прибрано: Оля, /);
  await expect(two).toHaveClass(/part-removed/);
  await expect(page.getByText(/^Рядків: 1 · розібрано 0/)).toBeVisible();
  // The one left is the last again.
  await expect(
    one.getByRole("button", { name: "Прибрати файл" }),
  ).toBeDisabled();
  await expect(one).toContainText(LAST);
  await expect(two.getByRole("button", { name: "Прибрати файл" })).toHaveCount(
    0,
  );

  // Its lines stay readable, as removed, and take no answer.
  await page.getByRole("button", { name: "Прибрані" }).click();
  await expect(card(page, 2)).toContainText("Прибрано");
  await expect(card(page, 3)).toContainText("Прибрано");
  await expect(
    card(page, 2).getByRole("button", { name: /Розібрати|Змінити/ }),
  ).toHaveCount(0);

  // Added again, it is a new file, whose lines wait to be answered.
  await page.getByRole("button", { name: "Додати файл" }).click();
  await choose(
    page.getByRole("form", { name: "Додати файл" }),
    "b.json",
    wrong,
  );
  await page.getByRole("button", { name: "Додати до списку" }).click();
  const three = page.getByRole("article", { name: "Файл 3" });
  await expect(three).toContainText("Рядки 4–5 · розібрано 0 з 2");
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  await expect(card(page, 4)).toContainText(/Чекає|Потребує уваги/);

  editor = await answer(page, 1);
  await pickModel(editor, coat);
  await editor.getByLabel("Розмір").selectOption({ label: "M" });
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 1)).toContainText("Розібрано");
  editor = await answer(page, 4);
  await pickModel(editor, coat);
  await editor.getByLabel("Розмір").selectOption({ label: "L" });
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 4)).toContainText("Розібрано");
  editor = await answer(page, 5);
  await editor.getByLabel("Це не товар").check();
  await editor.getByLabel("Чому це не товар").fill("підсумок сторінки");
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 5)).toContainText("Не товар: підсумок сторінки");

  const approval = page.getByLabel("Затвердження списку");
  await expect(approval).toContainText("Файлів у списку: 2 · прибрано: 1");
  await approval.getByRole("button", { name: "Затвердити список" }).click();
  await approval.getByRole("button", { name: "Так, затвердити" }).click();
  await expect(
    page.getByText(
      "Затверджено: 3 од. стали початковим залишком складу «Склад, де прибирають файл».",
    ),
  ).toBeVisible();
});

test("a file not in Birka's format is refused before it is sent, and the same file twice is refused by the server", async ({
  page,
}) => {
  await noListWaits(page, fixture.file_checks_location_id);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/v1/snapshots")
    )
      sent.push(request.url());
  });
  await openings(page);
  const form = await newFromFile(page, fixture.file_checks_location_id);
  const refused = form.getByRole("alert");
  const line = {
    text: "Куртка 1 шт",
    photo: "IMG_0001.jpg",
    photo_line: 1,
  };
  // Birka reads a concept here («лоран»), the parser a model («Лоран»).
  const read = {
    text: "Лоран шоколад M 3 1200",
    photo: "IMG_0001.jpg",
    photo_line: 2,
    model: "Лоран",
    colours: ["шоколад"],
    count: 3,
  };
  const valid = JSON.stringify(stockFile([line, read]).toString());
  const refusals: [string, Buffer, string][] = [
    [
      "bytes.json",
      Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]),
      "Файл не в кодуванні UTF-8. Збережіть його як UTF-8.",
    ],
    [
      "text.json",
      Buffer.from("format: birka.stock-list"),
      "Це не JSON-файл, або він пошкоджений.",
    ],
    [
      "other.json",
      Buffer.from(JSON.stringify({ format: "other", version: 1, lines: [] })),
      "Це не файл формату Бірки («birka.stock-list»).",
    ],
    [
      "v2.json",
      stockFile([line], { version: 2 }),
      "Версія формату 2 не підтримується: застосунок читає версію 1.",
    ],
    [
      "twice.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1},{"text":"Б 1 шт","photo":"a.jpg","te${BACKSLASH}u0078t":"В 1 шт","photo_line":2}]}`,
      ),
      "Рядок 2 файлу: ключ «text» повторюється.",
    ],
    // A key that runs on is named by its first sixty characters (review,
    // 2026-10-09).
    [
      "runs-on.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1,"${"к".repeat(90)}":1,"${"к".repeat(90)}":2}]}`,
      ),
      `Рядок 1 файлу: ключ «${"к".repeat(60)}…» повторюється.`,
    ],
    [
      "float.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 3 шт","photo":"a.jpg","photo_line":1,"count":3.0}]}`,
      ),
      "Рядок 1 файлу: «count» має бути цілим числом, а записано 3.0.",
    ],
    [
      "split.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1},{"text":"Б M-2","photo":"a.jpg","photo_line":2,"size_counts":[{"size":"M","count":2e0}]}]}`,
      ),
      "Рядок 2 файлу: «count» має бути цілим числом, а записано 2e0.",
    ],
    [
      "version.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1.0,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1}]}`,
      ),
      "Файл: «version» має бути цілим числом, а записано 1.0.",
    ],
    // A number too large to read is Infinity to the phone, then null, then
    // left out: refused wherever it stands, as the validator refuses it.
    [
      "model.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1,"model":1e400}]}`,
      ),
      "Рядок 1 файлу: у «model» записано 1e400 — завелике число, застосунок його не прочитає.",
    ],
    [
      "price.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1},{"text":"Б 1 шт","photo":"a.jpg","photo_line":2,"price":-1e999}]}`,
      ),
      "Рядок 2 файлу: у «price» записано -1e999 — завелике число, застосунок його не прочитає.",
    ],
    [
      "counts.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А M-1","photo":"a.jpg","photo_line":1,"size_counts":1e400}]}`,
      ),
      "Рядок 1 файлу: у «size_counts» записано 1e400 — завелике число, застосунок його не прочитає.",
    ],
    [
      "note.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1,"note":2e308}]}`,
      ),
      "Рядок 1 файлу: у «note» записано 2e308 — завелике число, застосунок його не прочитає.",
    ],
    [
      "digits.json",
      Buffer.from(
        `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"a.jpg","photo_line":1${"0".repeat(400)}}]}`,
      ),
      `Рядок 1 файлу: у «photo_line» записано 1${"0".repeat(19)}… — завелике число, застосунок його не прочитає.`,
    ],
    [
      "long.json",
      stockFile(
        Array.from({ length: 1001 }, (_, index) => ({
          ...line,
          photo_line: index + 1,
        })),
      ),
      "Рядків у файлі: 1001, а один файл бере не більше 1000. Розділіть його.",
    ],
    [
      "large.json",
      stockFile(
        Array.from({ length: 1000 }, (_, index) => ({
          text: "ж".repeat(500),
          photo: "IMG_0001.jpg",
          photo_line: index + 1,
        })),
      ),
      "Файл завеликий — розділіть його на два.",
    ],
  ];
  for (const [name, bytes, said] of refusals) {
    await choose(form, name, bytes);
    await expect(refused).toContainText(`Файл «${name}» не прийнято:`);
    await expect(refused).toContainText(said);
    await expect(
      form.getByRole("button", { name: "Зберегти список" }),
    ).toBeDisabled();
  }
  expect(sent).toEqual([]);

  // A valid file, a BOM before it, makes the list.
  const checked = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.parse(valid) as string),
  ]);
  await choose(form, "перевірка.json", checked);
  await expect(form.getByLabel("Що у файлі")).toContainText(
    "Файл «перевірка.json»: рядків 2, фото 1.",
  );
  await form.getByLabel("Звідки список (необов’язково)").fill("Перевірка");
  await form.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name: "Перевірка" })).toBeVisible();
  expect(sent).toHaveLength(1);

  // The search starts from the model the parser read: not Birka's own
  // reading of the concept, and never with the colour.
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  const editor = await answer(page, 2);
  await expect(editor.getByLabel("Пошук у каталозі")).toHaveValue("Лоран");
  await editor.getByRole("button", { name: "Скасувати" }).click();

  // The same file again is the server's to refuse, naming the file.
  await page.getByRole("button", { name: "Додати файл" }).click();
  const adding = page.getByRole("form", { name: "Додати файл" });
  await choose(adding, "перевірка-2.json", checked);
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(adding.getByRole("alert")).toHaveText(
    "Цей файл уже є в списку: «перевірка.json». Двічі його не додають.",
  );

  // What only the server checks is named by its line, from the server; a
  // key that runs on is named by its first sixty characters (review,
  // 2026-10-09).
  const runsOn = "з".repeat(80);
  await choose(
    adding,
    "службові.json",
    Buffer.from(
      `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"b.jpg","photo_line":1},{"text":"Б\\t2 шт","photo":"b.jpg","photo_line":2},{"text":"В 1 шт","photo":"b.jpg","photo_line":3,"colour":"сірий"},{"text":"Г 1 шт","photo":"b.jpg","photo_line":4,"${runsOn}":1}]}`,
    ),
  );
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(adding.getByRole("alert").getByRole("listitem")).toHaveText([
    "Рядок 2 файлу: у полі «текст» є службовий символ (перенесення рядка чи табуляція).",
    "Рядок 3 файлу: невідоме поле «colour».",
    `Рядок 4 файлу: невідоме поле «${"з".repeat(60)}…».`,
  ]);

  // A refusal that names no line in its context is placed by its index;
  // those the server counted without listing them are counted too.
  await page.route("**/api/v1/snapshots/*/parts?*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 422,
      json: {
        detail: [
          {
            type: "missing",
            loc: ["body", "file", "lines", 4, "photo"],
            msg: "Field required",
          },
          {
            type: "string_too_long",
            loc: ["body", "file", "lines", 4, "size_counts", 0, "size"],
            msg: "String should have at most 20 characters",
          },
        ],
        detail_truncated: 3,
      },
    });
  });
  await choose(
    adding,
    "п’ятий.json",
    stockFile(
      Array.from({ length: 5 }, (_, index) => ({
        ...line,
        photo: "c.jpg",
        photo_line: index + 1,
      })),
    ),
  );
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(adding.getByRole("alert").getByRole("listitem")).toHaveText([
    "Рядок 5 файлу: поле «фото» відсутнє.",
    "Рядок 5 файлу: поле «розмір» задовге.",
    "…і ще 3",
  ]);
  await page.unrouteAll({ behavior: "wait" });

  // A file larger than the server takes is not sent: said by the phone. The
  // file as the server measures it — compact, its nulls left out — may be
  // 950 000 bytes, and not one more.
  const before = sent.length;
  const near = { ...line, photo: "d.jpg" };
  const base = Buffer.byteLength(
    JSON.stringify({
      format: "birka.stock-list",
      version: 1,
      parser: "",
      lines: [near],
    }),
  );
  const padded = (bytes: number): Buffer =>
    stockFile([near], {
      $schema: undefined,
      parser: "x".repeat(bytes - base),
    });
  await choose(adding, "межа.json", padded(950_000));
  await expect(adding.getByLabel("Що у файлі")).toBeVisible();
  await expect(
    adding.getByRole("button", { name: "Додати до списку" }),
  ).toBeEnabled();
  await choose(adding, "за-межею.json", padded(950_001));
  await expect(adding.getByRole("alert")).toContainText(
    "Файл «за-межею.json» не прийнято:",
  );
  await expect(adding.getByRole("alert")).toContainText(
    "Файл завеликий — розділіть його на два.",
  );
  await expect(
    adding.getByRole("button", { name: "Додати до списку" }),
  ).toBeDisabled();
  expect(sent).toHaveLength(before);
});

test("a record that may be a size with its count or a range of sizes is asked about, and the split is taken by a tap only once it is read as a size with its count", async ({
  page,
}) => {
  const parka = await numericModel(page);
  const coat = await model(page);
  // Counts no size of the catalogue is written as, until this journey
  // makes one: four digits, no other journey's.
  const [early, late] = [1000, 5000].map((from) =>
    String(from + (randomBytes(2).readUInt16BE() % 4000)),
  ) as [string, string];
  await noListWaits(page, fixture.file_range_location_id);
  const answers: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/lines/"))
      answers.push(request.postDataJSON() as Record<string, unknown>);
  });
  await openings(page);
  const form = await newFromFile(page, fixture.file_range_location_id);
  await choose(
    form,
    "діапазони.json",
    stockFile(
      [
        {
          text: `${parka} сірий 42-44`,
          photo: "R.jpg",
          photo_line: 1,
          model: parka,
          size_counts: [{ size: "42", count: 44 }],
        },
        {
          text: `${parka} сірий 42 – 44`,
          photo: "R.jpg",
          photo_line: 2,
          model: parka,
          size_counts: [{ size: "42", count: 44 }],
        },
        {
          text: `${coat} сірий M-${early}`,
          photo: "R.jpg",
          photo_line: 3,
          model: coat,
          size_counts: [{ size: "M", count: Number(early) }],
        },
        {
          text: `${coat} сірий M-${late}`,
          photo: "R.jpg",
          photo_line: 4,
          model: coat,
          size_counts: [{ size: "M", count: Number(late) }],
        },
      ],
      { source: "Зошит діапазонів" },
    ),
  );
  await form.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByRole("heading", { name: "Зошит діапазонів" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  // 44 is a size too: the record may be read either way.
  await expect(card(page, 1)).toContainText(
    "Запис «42-44» може означати й діапазон розмірів: під час розбору вкажіть, що саме.",
  );

  // Asked first; the split as the line shows it waits for the answer.
  let editor = await answer(page, 1);
  const question = editor.getByRole("group", { name: "Запис «42-44» — це:" });
  await expect(question).toBeVisible();
  await expect(editor.getByLabel(/Як у рядку/)).toHaveCount(0);
  await expect(editor.getByRole("radio", { checked: true })).toHaveCount(0);
  await question.getByLabel("Розмір 42 — 44 шт").check();
  const bySize = editor.getByLabel("Як у рядку, по розмірах: 42 × 44");
  await expect(bySize).toBeVisible();
  await expect(bySize).not.toBeChecked();
  // Read as a range after all: the tap goes, and the choice made with it.
  await bySize.check();
  await question.getByLabel("Діапазон розмірів 42–44").check();
  await expect(editor.getByLabel(/Як у рядку/)).toHaveCount(0);
  await expect(editor).toContainText(
    "Діапазон не каже, скільки якого розміру: вкажіть розміри й кількість і звідки вони відомі.",
  );
  await question.getByLabel("Розмір 42 — 44 шт").check();
  await expect(bySize).not.toBeChecked();
  await bySize.check();
  await pickModel(editor, parka);
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 1)).toContainText(
    "Звідки кількість: Як у рядку, по розмірах",
  );
  await expect(card(page, 1)).toContainText(`→ ${parka} сірий, 42 × 44`);
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({
    quantity_basis: "STATED_BY_SIZE",
    split_read_as: "SIZE_WITH_COUNT",
  });
  // The person's word names the records it was said of: those asked about,
  // as the line writes them (review, third round, 2026-10-09).
  expect(answers[0]?.split_read_records).toEqual(["42-44"]);

  // Read as a range, as the text writes it: answered as any line, with a note.
  editor = await answer(page, 2);
  const asWritten = editor.getByRole("group", {
    name: "Запис «42 – 44» — це:",
  });
  await asWritten.getByLabel("Діапазон розмірів 42–44").check();
  await expect(editor.getByLabel(/Як у рядку/)).toHaveCount(0);
  await editor.getByLabel("Відомо інакше").check();
  await pickModel(editor, parka);
  await editor
    .getByRole("combobox", { name: "Розмір", exact: true })
    .selectOption({ label: "42" });
  await editor.getByLabel("Кількість").fill("1");
  await editor
    .getByLabel("Звідки це відомо")
    .fill("діапазон 42–44: на полиці одна 42");
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 2)).toContainText("Звідки кількість: Відомо інакше");
  expect(answers).toHaveLength(2);
  expect(answers[1]).toMatchObject({ quantity_basis: "OWNER_KNOWLEDGE" });
  expect(answers[1]).not.toHaveProperty("split_read_as");
  expect(answers[1]).not.toHaveProperty("split_read_records");

  // A size created while the editor is open makes a record a possible range
  // (review, fourth round, 2026-10-09). The line read again as the phone
  // comes back to the app asks about it, «Як у рядку» waits for the answer,
  // and only the record answered is named.
  editor = await answer(page, 3);
  const asShown = editor.getByLabel(`Як у рядку, по розмірах: M × ${early}`);
  await expect(editor.getByRole("group", { name: /^Запис/ })).toHaveCount(0);
  await asShown.check();
  await pickModel(editor, coat);
  const save = editor.getByRole("button", { name: "Зберегти відповідь" });
  await expect(save).toBeEnabled();
  await sizeMade(page, early);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  const madeRange = editor.getByRole("group", {
    name: `Запис «M-${early}» — це:`,
  });
  await expect(madeRange).toBeVisible();
  await expect(editor.getByLabel(/Як у рядку/)).toHaveCount(0);
  await expect(save).toBeDisabled();
  expect(answers).toHaveLength(2);
  await madeRange.getByLabel(`Розмір M — ${early} шт`).check();
  await expect(asShown).toBeChecked();
  await save.click();
  await expect(card(page, 3)).toContainText(
    "Звідки кількість: Як у рядку, по розмірах",
  );
  expect(answers).toHaveLength(3);
  expect(answers[2]).toMatchObject({
    quantity_basis: "STATED_BY_SIZE",
    split_read_as: "SIZE_WITH_COUNT",
    split_read_records: [`M-${early}`],
  });

  // A size created after the editor read the line and before the answer
  // arrives: the server refuses the answer naming the record, the line is
  // read again, and the record is asked about here.
  editor = await answer(page, 4);
  await editor.getByLabel(`Як у рядку, по розмірах: M × ${late}`).check();
  await pickModel(editor, coat);
  await sizeMade(page, late);
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(editor.getByRole("alert")).toHaveText(
    `Запис «M-${late}» тепер може означати й діапазон розмірів. Рядок прочитано знову: вкажіть нижче, що він означає, і збережіть відповідь ще раз.`,
  );
  const askedNow = editor.getByRole("group", {
    name: `Запис «M-${late}» — це:`,
  });
  await expect(askedNow).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "Зберегти відповідь" }),
  ).toBeDisabled();
  await askedNow.getByLabel(`Розмір M — ${late} шт`).check();
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 4)).toContainText(
    "Звідки кількість: Як у рядку, по розмірах",
  );
  expect(answers).toHaveLength(5);
  expect(answers[3]).not.toHaveProperty("split_read_records");
  expect(answers[4]).toMatchObject({
    quantity_basis: "STATED_BY_SIZE",
    split_read_as: "SIZE_WITH_COUNT",
    split_read_records: [`M-${late}`],
  });

  // A size created since may make a record answered by size a range after
  // all: the approval names the lines to answer again (owner decision,
  // 2026-10-09). The server's refusal, as it words it.
  const refusals = [
    { count: 1, line_nos: [1] },
    { count: 3, line_nos: [1, 2] },
  ];
  await page.route("**/api/v1/snapshots/*/approve?*", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "SNAPSHOT_CONFLICT",
        message: "Some lines answered by size may now be read as ranges",
        details: { reason: "SPLIT_MAY_BE_RANGE", ...refusals.shift() },
      },
    });
  });
  const approval = page.getByLabel("Затвердження списку");
  for (const said of [
    "Рядок 1 треба розібрати ще раз: запис у ньому тепер може бути діапазоном розмірів.",
    "Рядки 1, 2 і ще 1 треба розібрати ще раз: запис у них тепер може бути діапазоном розмірів.",
  ]) {
    await approval.getByRole("button", { name: "Затвердити список" }).click();
    await approval.getByRole("button", { name: "Так, затвердити" }).click();
    await expect(approval.getByRole("alert")).toHaveText(said);
  }
  await page.unrouteAll({ behavior: "wait" });
});

test("the shared warehouse's list is seen and filled from the other store, and no second list is offered for it", async ({
  page,
}) => {
  const coat = await model(page);
  const name = `Спільний зошит ${word()}`;
  await noListWaits(page, fixture.shared_opening_location_id);
  await openings(page);
  const form = await newFromFile(page, fixture.shared_opening_location_id);
  await choose(
    form,
    "спільний-1.json",
    stockFile(
      [{ text: `${coat} сірий M 1 шт`, photo: "S1.jpg", photo_line: 1 }],
      { source: name },
    ),
  );
  await form.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Веде магазин «Основний»")).toHaveCount(0);

  // The other store sees it, through itself.
  const asked: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/snapshots\/[^/?]+/.test(request.url()))
      asked.push(request.url());
  });
  await page.getByRole("button", { name: "Змінити магазин" }).click();
  await openStore(page, "Другий SECOND");
  await section(page, "Початкові залишки");
  const listed = page.getByRole("article", { name: `Список ${name}` });
  await expect(listed).toContainText("Веде магазин «Основний»");
  await listed.getByRole("button", { name: "Відкрити" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Веде магазин «Основний»")).toBeVisible();

  await page.getByRole("button", { name: "Додати файл" }).click();
  await choose(
    page.getByRole("form", { name: "Додати файл" }),
    "спільний-2.json",
    stockFile([
      { text: `${coat} сірий L 2 шт`, photo: "S2.jpg", photo_line: 1 },
    ]),
  );
  await page.getByRole("button", { name: "Додати до списку" }).click();
  await expect(page.getByRole("article", { name: "Файл 2" })).toContainText(
    "Рядки 2–2 · розібрано 0 з 1",
  );
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  const editor = await answer(page, 2);
  await expect(editor.getByLabel("Як у списку: 2 шт")).toBeChecked();
  await pickModel(editor, coat);
  await editor.getByLabel("Розмір").selectOption({ label: "L" });
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 2)).toContainText("Розібрано");
  // Every call on the list named the store it was made through.
  expect(asked.length).toBeGreaterThan(0);
  for (const url of asked)
    expect(new URL(url).searchParams.get("store_id")).toBe(
      fixture.second_store_id,
    );

  // No second list for the warehouse: its list is named, and opened.
  await page.getByRole("button", { name: "До списків" }).click();
  await page.getByRole("button", { name: "Новий список" }).click();
  const another = page.getByRole("form", { name: "Новий список" });
  await another
    .getByLabel("Склад")
    .selectOption(fixture.shared_opening_location_id);
  await expect(another).toContainText(
    `На складі «Спільний новий склад» уже чекає список «${name}» (веде магазин «Основний»). Другий список для нього не створюють — додайте файл до наявного.`,
  );
  await expect(
    another.getByRole("button", { name: "Зберегти список" }),
  ).toHaveCount(0);
  await another.getByRole("button", { name: "Відкрити список" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

/** Put a store in a state through the API, whatever state a run left it in. */
async function settle(
  page: Page,
  store: string,
  state: "ACTIVE" | "BLOCKED",
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${await token(page, fixture.network_owner_telegram_user_id)}`,
  };
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

test("a shared list whose own store stopped trading is only rejected, from the other store, and its warehouse takes a new list there", async ({
  page,
}) => {
  const north = fixture.network_north_store_id;
  const south = fixture.network_south_store_id;
  const between = fixture.network_north_south_location_id;
  const headers = {
    Authorization: `Bearer ${await token(page, fixture.network_owner_telegram_user_id)}`,
  };
  const name = `Північний зошит ${word()}`;
  // What an earlier run left waiting is rejected, through the store that
  // trades, whatever state the store that started it is in.
  const waiting = await page.request.get(
    `/api/v1/snapshots?store_id=${south}&location_id=${between}&status=IN_REVIEW&limit=100`,
    { headers },
  );
  for (const list of (
    (await waiting.json()) as { items: { snapshot_id: string }[] }
  ).items) {
    const rejected = await page.request.post(
      `/api/v1/snapshots/${list.snapshot_id}/reject?store_id=${south}`,
      { headers, data: { reason: "лишився від іншого прогону" } },
    );
    expect(rejected.ok()).toBe(true);
  }
  await settle(page, north, "ACTIVE");
  try {
    // «Північний» starts the warehouse's list, then the owner blocks it.
    const started = await page.request.post("/api/v1/snapshots", {
      headers,
      data: {
        command_id: randomUUID(),
        store_id: north,
        location_id: between,
        source_document_ref: name,
        lines: ["Пальто сіре 2 шт"],
      },
    });
    expect(started.status()).toBe(201);
    await settle(page, north, "BLOCKED");

    // «Ніна» manages «Південний»: no second list, and the one waiting named.
    const asked: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/v1\/snapshots\/[^/?]+/.test(request.url()))
        asked.push(request.url());
    });
    await page.goto(
      `/#${new URLSearchParams({ tgWebAppData: initData(fixture.network_south_manager_telegram_user_id) }).toString()}`,
    );
    await openStore(page, "Південний SOUTH");
    await section(page, "Початкові залишки");
    await page.getByRole("button", { name: "Новий список" }).click();
    const form = page.getByRole("form", { name: "Новий список" });
    await form.getByLabel("Склад").selectOption(between);
    await expect(form).toContainText(
      `На складі «Склад півночі й півдня» чекає список «${name}» магазину «Північний», який не працює. Відкрийте й відхиліть його — тоді можна почати новий список і додати до нього файли.`,
    );
    await expect(
      form.getByRole("button", { name: "Зберегти список" }),
    ).toHaveCount(0);
    await form.getByRole("button", { name: "Відкрити список" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(
      page.getByText(
        "Магазин «Північний», що почав цей список, не працює: список можна лише відхилити, а файли додати до нового списку.",
      ),
    ).toBeVisible();
    // Nothing else is done to it: no approval, no file, no answer.
    await page.getByRole("button", { name: "Усі", exact: true }).click();
    await expect(card(page, 1)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Затвердити список" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Додати файл" })).toHaveCount(
      0,
    );
    await expect(
      card(page, 1).getByRole("button", { name: "Розібрати рядок" }),
    ).toHaveCount(0);

    // A manager rejects it, and the warehouse is released.
    const decision = page.getByLabel("Рішення щодо списку");
    await decision.getByRole("button", { name: "Відхилити список" }).click();
    await decision
      .getByLabel("Чому відхиляємо")
      .fill("Північний не працює, файли — до нового списку");
    await decision.getByRole("button", { name: "Так, відхилити" }).click();
    await expect(
      page.getByText(
        "Відхилено: Північний не працює, файли — до нового списку. Залишків цей список не змінив.",
      ),
    ).toBeVisible();
    expect(asked.length).toBeGreaterThan(0);
    for (const url of asked)
      expect(new URL(url).searchParams.get("store_id")).toBe(south);

    // Its warehouse takes a new list, started from «Південний».
    await page.getByRole("button", { name: "До списків" }).click();
    await page.getByRole("button", { name: "Новий список" }).click();
    const fresh = page.getByRole("form", { name: "Новий список" });
    await fresh.getByLabel("Склад").selectOption(between);
    await fresh.getByLabel("Завантажити файл").check();
    await choose(
      fresh,
      "заново.json",
      stockFile([{ text: "Пальто сіре 2 шт", photo: "N1.jpg", photo_line: 1 }]),
    );
    await expect(fresh.getByLabel("Що у файлі")).toBeVisible();
    await fresh
      .getByLabel("Звідки список (необов’язково)")
      .fill(`${name}, заново`);
    await fresh.getByRole("button", { name: "Зберегти список" }).click();
    await expect(
      page.getByRole("heading", { name: `${name}, заново` }),
    ).toBeVisible();
    await expect(page.getByText("Веде магазин «Північний»")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Додати файл" }),
    ).toBeVisible();

    // Its one file is the last: a manager is told to reject the list
    // instead, and the button to is there. Approving is not theirs, and
    // they are not asked to (review, 2026-10-09).
    await expect(page.getByRole("article", { name: "Файл 1" })).toContainText(
      LAST,
    );
    await expect(
      page.getByRole("button", { name: "Затвердити список" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Затверджує той, хто має право затверджувати списки; відхилити його можна й вам.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Затвердіть або відхиліть його.")).toHaveCount(
      0,
    );
    const own = page.getByLabel("Рішення щодо списку");
    await own.getByRole("button", { name: "Відхилити список" }).click();
    // A character that reorders a reason is shown as a mark, and so is a
    // line separator and a selector after a letter; an emoji's own
    // selector and joiner are not (review, 2026-10-09).
    await own
      .getByLabel("Чому відхиляємо")
      .fill(
        `Не той файл ${RLO}12 ${HEART} ${FAMILY} ${KEYCAP_ONE}${LINE_SEPARATOR}M${VS16}`,
      );
    await own.getByRole("button", { name: "Так, відхилити" }).click();
    await expect(
      page.getByText(
        `Відхилено: Не той файл ⟦U+202E⟧12 ${HEART} ${FAMILY} ${KEYCAP_ONE}⟦U+2028⟧M⟦U+FE0F⟧. Залишків цей список не змінив.`,
      ),
    ).toBeVisible();
  } finally {
    await settle(page, north, "ACTIVE");
  }
});

/** Holds each matching request until released, or gives it no answer. */
function hold(
  page: Page,
  pattern: string,
): {
  held: () => number;
  mode: (next: "hold" | "abort" | "pass") => void;
  release: () => Promise<void>;
  ready: Promise<void>;
} {
  let count = 0;
  let current: "hold" | "abort" | "pass" = "hold";
  const waiting: Route[] = [];
  let free: () => void = () => undefined;
  const freed = new Promise<void>((resolve) => {
    free = resolve;
  });
  const ready = page.route(pattern, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (current === "pass") return route.continue();
    if (current === "abort") return route.abort("connectionreset");
    count += 1;
    waiting.push(route);
    await freed;
    // The phone gave up on it long ago: nothing listens any more.
    await route.abort("failed").catch(() => undefined);
  });
  return {
    held: () => count,
    mode: (next) => {
      current = next;
    },
    release: async () => {
      free();
      await page.unroute(pattern);
    },
    ready,
  };
}

test("a slow answer is no outage: a file and an approval wait 60 s, say so, and the server is not marked gone; no answer at all still marks it", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.file_slow_location_id);
  const commands: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/snapshots"))
      commands.push(
        (request.postDataJSON() as { command_id: string }).command_id,
      );
  });
  // Every read of the warehouse's waiting lists, and those not yet answered.
  let asked = 0;
  let reading = 0;
  const warehouseRead = (url: string): boolean =>
    url.includes("/api/v1/snapshots?") &&
    url.includes(`location_id=${fixture.file_slow_location_id}`);
  page.on("request", (request) => {
    if (!warehouseRead(request.url())) return;
    asked += 1;
    reading += 1;
  });
  const settled = (request: Request): void => {
    if (warehouseRead(request.url())) reading -= 1;
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);
  await page.clock.install();
  const create = hold(page, "**/api/v1/snapshots");
  await create.ready;
  try {
    await openings(page);
    const form = await newFromFile(page, fixture.file_slow_location_id);
    await choose(
      form,
      "повільний.json",
      stockFile(
        [{ text: `${coat} сірий M 1 шт`, photo: "Z.jpg", photo_line: 1 }],
        { source: "Повільний зошит" },
      ),
    );
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect.poll(() => create.held()).toBe(1);

    // Past the 20 s any other call waits, it still waits.
    await page.clock.fastForward("00:21");
    await page.waitForTimeout(300);
    await expect(form.getByRole("alert")).toHaveCount(0);
    expect(await down(page)).toBe(false);
    // Its own 60 s run out: said, and not an outage.
    await page.clock.fastForward("00:40");
    await expect(form.getByRole("alert")).toHaveText(SLOW);
    expect(await down(page)).toBe(false);

    // Another file picked meanwhile is the same command: whatever the
    // server made of the first, it makes no second list of this one. The
    // warehouse is read again on the way.
    const before = asked;
    await choose(
      form,
      "повільний-інший.json",
      stockFile(
        [{ text: `${coat} сірий M 1 шт`, photo: "Z0.jpg", photo_line: 1 }],
        { source: "Повільний зошит" },
      ),
    );
    await expect(form.getByLabel("Що у файлі")).toContainText(
      "Файл «повільний-інший.json»",
    );
    await expect.poll(() => asked).toBeGreaterThan(before);
    await expect.poll(() => reading).toBe(0);

    // No answer at all is still no answer.
    create.mode("abort");
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Невідомо, чи збережено список. Натисніть ще раз — той самий список не збережеться двічі.",
    );
    expect(await down(page)).toBe(true);

    // Sent again, the same list is made once.
    create.mode("pass");
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect(
      page.getByRole("heading", { name: "Повільний зошит" }),
    ).toBeVisible();
    expect(await down(page)).toBe(false);
    expect(commands).toHaveLength(3);
    expect(new Set(commands).size).toBe(1);
  } finally {
    await create.release();
  }

  const add = hold(page, "**/api/v1/snapshots/*/parts?*");
  await add.ready;
  try {
    await page.getByRole("button", { name: "Додати файл" }).click();
    const adding = page.getByRole("form", { name: "Додати файл" });
    await choose(
      adding,
      "повільний-2.json",
      stockFile([{ text: "Куртка 2 шт", photo: "Z2.jpg", photo_line: 1 }]),
    );
    await adding.getByRole("button", { name: "Додати до списку" }).click();
    await expect.poll(() => add.held()).toBe(1);
    await page.clock.fastForward("00:21");
    await page.waitForTimeout(300);
    await expect(adding.getByRole("alert")).toHaveCount(0);
    await page.clock.fastForward("00:40");
    await expect(adding.getByRole("alert")).toHaveText(SLOW);
    expect(await down(page)).toBe(false);
    await adding.getByRole("button", { name: "Закрити" }).click();
  } finally {
    await add.release();
  }

  await page.getByRole("button", { name: "Усі", exact: true }).click();
  const editor = await answer(page, 1);
  await expect(editor.getByLabel("Як у списку: 1 шт")).toBeChecked();
  await pickModel(editor, coat);
  await editor.getByLabel("Розмір").selectOption({ label: "M" });
  await editor.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(card(page, 1)).toContainText("Розібрано");

  const approve = hold(page, "**/api/v1/snapshots/*/approve?*");
  await approve.ready;
  try {
    const approval = page.getByLabel("Затвердження списку");
    await approval.getByRole("button", { name: "Затвердити список" }).click();
    await approval.getByRole("button", { name: "Так, затвердити" }).click();
    await expect.poll(() => approve.held()).toBe(1);
    await page.clock.fastForward("00:21");
    await page.waitForTimeout(300);
    await expect(approval.getByRole("alert")).toHaveCount(0);
    await page.clock.fastForward("00:40");
    await expect(approval.getByRole("alert")).toHaveText(SLOW);
    expect(await down(page)).toBe(false);
  } finally {
    await approve.release();
  }
});

test("answers lost on their way back: a file removed since comes back as a new one, and lines changed before they are sent again go as new", async ({
  page,
}) => {
  const coat = await model(page);
  // A name of this run's own: the lists of runs before stay in the overview.
  const source = `Зошит загублених відповідей ${word()}`;
  await noListWaits(page, fixture.file_lost_location_id);
  // The server records the next `lose` additions, and their answers are lost.
  const posted: string[] = [];
  let lose = 0;
  await page.route("**/api/v1/snapshots/*/parts?*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posted.push(
      (route.request().postDataJSON() as { command_id: string }).command_id,
    );
    if (lose === 0) return route.continue();
    lose -= 1;
    await route.fetch();
    await route.abort("failed");
  });
  await openings(page);
  const form = await newFromFile(page, fixture.file_lost_location_id);
  await choose(
    form,
    "перший.json",
    stockFile(
      [
        { text: `${coat} сірий M 2 шт`, photo: "L1.jpg", photo_line: 1 },
        // The split read is not the line's: «3+2» is no count of 3.
        {
          text: `${coat} сірий M-3+2`,
          photo: "L1.jpg",
          photo_line: 2,
          model: coat,
          size_counts: [{ size: "M", count: 3 }],
        },
      ],
      { source },
    ),
  );
  await form.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name: source })).toBeVisible();

  // A split the line does not show as the parser read it is offered no tap.
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  await expect(card(page, 2)).toContainText(
    "Парсер прочитав кількість по розмірах, але рядок показує її не так або не лише її — одним натиском її не підтвердити. Вкажіть, звідки відома кількість.",
  );
  const editor = await answer(page, 2);
  await expect(editor.getByLabel(/Як у рядку/)).toHaveCount(0);
  await editor.getByRole("button", { name: "Скасувати" }).click();

  // A file added, its answer lost: the person leaves it at that.
  const second = stockFile([
    { text: `${coat} сірий L 1 шт`, photo: "L2.jpg", photo_line: 1 },
  ]);
  lose = 1;
  await page.getByRole("button", { name: "Додати файл" }).click();
  let adding = page.getByRole("form", { name: "Додати файл" });
  await choose(adding, "другий.json", second);
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(adding.getByRole("alert")).toHaveText(
    "Невідомо, чи додано файл. Натисніть ще раз — той самий файл не додасться двічі.",
  );
  await adding.getByRole("button", { name: "Закрити" }).click();

  // Read again, the list has it; it is removed as a mistake.
  await page.getByRole("button", { name: "До списків" }).click();
  await page
    .getByRole("article", { name: `Список ${source}` })
    .getByRole("button", { name: "Відкрити" })
    .click();
  const two = page.getByRole("article", { name: "Файл 2" });
  await expect(two).toContainText("2. «другий.json»");
  await two.getByRole("button", { name: "Прибрати файл" }).click();
  await two.getByRole("button", { name: "Так, прибрати" }).click();
  await expect(two).toContainText(/Прибрано: Оля, /);

  // Added again: the command kept for it names the removed file, so it is
  // sent once more as a new one, and a new file joins.
  await page.getByRole("button", { name: "Додати файл" }).click();
  adding = page.getByRole("form", { name: "Додати файл" });
  await choose(adding, "другий.json", second);
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(page.getByRole("article", { name: "Файл 3" })).toContainText(
    "Рядки 4–4 · розібрано 0 з 1",
  );
  expect(posted).toHaveLength(3);
  expect(posted[1]).toBe(posted[0]);
  expect(posted[2]).not.toBe(posted[0]);

  // Lines typed by hand, their answer lost; changed, then sent again.
  lose = 1;
  await page.getByRole("button", { name: "Додати рядки вручну" }).click();
  const typing = page.getByRole("form", { name: "Додати рядки вручну" });
  const text = typing.getByLabel(/Рядки — кожен товар/);
  await text.fill(`${coat} сірий M 1 шт`);
  await typing.getByRole("button", { name: "Додати рядки" }).click();
  await expect(typing.getByRole("alert")).toHaveText(
    "Невідомо, чи додано рядки. Натисніть ще раз — ті самі рядки не додадуться двічі.",
  );
  const changed = `${coat} сірий M 1 шт\n${coat} сірий L 3 шт`;
  await text.fill(changed);
  await typing.getByRole("button", { name: "Додати рядки" }).click();
  // What went first is in the list; the text is kept, and goes as new.
  await expect(typing.getByRole("alert")).toHaveText(
    "Рядки, надіслані перед цим, уже є в списку, а ці відрізняються від них. Натисніть «Додати рядки» ще раз — ці буде додано як нові, окремо від тих.",
  );
  await expect(page.getByRole("article", { name: "Файл 4" })).toContainText(
    "4. Рядки, внесені вручну",
  );
  await expect(text).toHaveValue(changed);
  await typing.getByRole("button", { name: "Додати рядки" }).click();
  const typed = page.getByRole("article", { name: "Файл 5" });
  await expect(typed).toContainText("Рядки 6–7 · розібрано 0 з 2");
  // Typed lines are removed as typed lines, never called a file (review,
  // 2026-10-09).
  await expect(
    typed.getByRole("button", { name: "Прибрати файл" }),
  ).toHaveCount(0);
  await typed.getByRole("button", { name: "Прибрати рядки" }).click();
  await expect(
    typed.getByLabel("Прибрати рядки?", { exact: true }).locator("p"),
  ).toHaveText(
    "Прибрати рядки, внесені вручну? Ці рядки (2) не увійдуть до затвердження, а відповіді на них (0) зникнуть; їх буде видно як прибрані. Інші файли лишаться.",
  );
  await typed.getByRole("button", { name: "Скасувати" }).click();
  expect(posted).toHaveLength(6);
  expect(posted[4]).toBe(posted[3]);
  expect(posted[5]).not.toBe(posted[3]);

  // The same text twice in the list is said, with its count.
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  await expect(card(page, 6)).toContainText(
    "Такий самий рядок у списку — 2 рази: це може бути по рядку на кожну одиницю, або помилка переписування.",
  );
});

/** Whether the page fits the phone's width: nothing scrolls it sideways. */
async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );
}

test("on a narrow phone a file's long name breaks, never pushes the page sideways; an answer the list has no room for says so", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const coat = await model(page);
  await noListWaits(page, fixture.file_narrow_location_id);
  // A camera's name, one word of sixty characters.
  const long = `${"IMG_20261008_123456_".repeat(3).slice(0, 55)}.json`;
  const other = `${"SCAN_20261009_654321_".repeat(3).slice(0, 55)}.json`;
  expect(long).toHaveLength(60);
  await openings(page);
  const form = await newFromFile(page, fixture.file_narrow_location_id);
  await choose(form, long, Buffer.from("не JSON"));
  await expect(form.getByRole("alert")).toContainText(
    `Файл «${long}» не прийнято:`,
  );
  expect(await fitsWidth(page)).toBe(true);
  // Its date, one word of forty wide characters, fills the list's (review,
  // 2026-10-09).
  const date = `30.09.2026_${"Ш".repeat(29)}`;
  expect(date).toHaveLength(40);
  await choose(
    form,
    long,
    stockFile([{ text: `${coat} сірий M 1 шт`, photo: long, photo_line: 1 }], {
      source: "Вузький зошит",
      counted_on: date,
    }),
  );
  await expect(form.getByLabel("Що у файлі")).toContainText(`Файл «${long}»`);
  expect(await fitsWidth(page)).toBe(true);
  await form.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByRole("heading", { name: "Вузький зошит" }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "Файл 1" })).toContainText(
    long,
  );
  await expect(page.getByText(`перелічено ${date}`)).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);

  // A second file, and the question before one is removed, name it whole.
  await page.getByRole("button", { name: "Додати файл" }).click();
  const adding = page.getByRole("form", { name: "Додати файл" });
  await choose(
    adding,
    other,
    stockFile([{ text: `${coat} сірий L 1 шт`, photo: other, photo_line: 1 }]),
  );
  expect(await fitsWidth(page)).toBe(true);
  // A list with no room for another part says what a part is: a file or
  // lines typed by hand, removed ones counted (review, fourth round,
  // 2026-10-09). The server's refusal, as it words it.
  await page.route(
    "**/api/v1/snapshots/*/parts?*",
    async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          code: "SNAPSHOT_CONFLICT",
          message: "This stock list has no room for this part",
          details: {
            reason: "LIST_FULL",
            what: "parts",
            limit: 1000,
            now: 1000,
            adding: 1,
          },
        },
      });
    },
    { times: 1 },
  );
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(adding.getByRole("alert")).toHaveText(
    "Список повний: не більше 1 000 частин — файлів і рядків, внесених вручну, — разом із прибраними.",
  );
  await page.unrouteAll({ behavior: "wait" });
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  const two = page.getByRole("article", { name: "Файл 2" });
  await two.getByRole("button", { name: "Прибрати файл" }).click();
  await expect(two.getByLabel("Прибрати файл?", { exact: true })).toContainText(
    `Прибрати файл «${other}»?`,
  );
  expect(await fitsWidth(page)).toBe(true);
  await two.getByRole("button", { name: "Скасувати" }).click();

  // The line's editor names the file and the photo.
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  const editor = await answer(page, 1);
  await expect(editor).toContainText(`Файл: «${long}»`);
  await expect(editor).toContainText(`Фото: ${long}, рядок 1`);
  expect(await fitsWidth(page)).toBe(true);

  // The list has no room for another answer, or its store may no longer
  // receive goods there: each said as the server says it.
  const refusals = [
    {
      status: 422,
      json: {
        code: "VALIDATION_ERROR",
        message: "A stock list takes at most 5000 allocations in all",
        details: {
          reason: "LIST_FULL",
          what: "allocations",
          limit: 5000,
          now: 5000,
          adding: 1,
        },
      },
    },
    {
      status: 409,
      json: {
        code: "SNAPSHOT_CONFLICT",
        message: "The store that started this list can no longer receive",
        details: {
          reason: "LIST_STORE_CANNOT_RECEIVE",
          store_id: fixture.store_id,
          location_id: fixture.file_narrow_location_id,
        },
      },
    },
  ];
  await page.route("**/api/v1/snapshots/*/lines/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill(refusals.shift() ?? { status: 500 });
  });
  await expect(editor.getByLabel("Як у списку: 1 шт")).toBeChecked();
  await pickModel(editor, coat);
  await editor.getByLabel("Розмір").selectOption({ label: "M" });
  const save = editor.getByRole("button", { name: "Зберегти відповідь" });
  await save.click();
  await expect(editor.getByRole("alert")).toHaveText(
    "У списку вже 5 000 відповідей — більше він не вміщує, тож цю відповідь не збережено. Рядок із кількома розмірами бере відповідь на кожен розмір. Звільнити місце можна, прибравши файл.",
  );
  await save.click();
  await expect(editor.getByRole("alert")).toHaveText(
    "Магазин «Основний», що почав цей список, більше не може приймати товар на цей склад: список можна лише відхилити.",
  );
  await page.unrouteAll({ behavior: "wait" });
  await editor.getByRole("button", { name: "Скасувати" }).click();

  // A reason given as one long word, a link, breaks too (review,
  // 2026-10-09).
  const link = `https://example.com/${"zoshyt_2_storinky_1-4_".repeat(4)}`;
  const decision = page.getByLabel("Затвердження списку");
  await decision.getByRole("button", { name: "Відхилити список" }).click();
  await decision.getByLabel("Чому відхиляємо").fill(link);
  await decision.getByRole("button", { name: "Так, відхилити" }).click();
  await expect(page.getByText(`Відхилено: ${link}.`)).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
});

test("an answer too slow to wait for, its list made meanwhile: another file picked keeps the command, and the list made is opened, never a second", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.file_late_location_id);
  await page.clock.install();
  // The server makes the list; its answer never reaches the phone.
  const commands: string[] = [];
  let free: () => void = () => undefined;
  const freed = new Promise<void>((resolve) => {
    free = resolve;
  });
  await page.route("**/api/v1/snapshots", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    commands.push(
      (route.request().postDataJSON() as { command_id: string }).command_id,
    );
    await route.fetch();
    await freed;
    await route.abort("failed").catch(() => undefined);
  });
  try {
    await openings(page);
    const form = await newFromFile(page, fixture.file_late_location_id);
    await choose(
      form,
      "пізній.json",
      stockFile(
        [{ text: `${coat} сірий M 1 шт`, photo: "T1.jpg", photo_line: 1 }],
        { source: "Пізній зошит" },
      ),
    );
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect.poll(() => commands.length).toBe(1);
    // The list is made before the phone stops waiting.
    await expect
      .poll(async () => {
        const lists = await page.request.get(
          `/api/v1/snapshots?store_id=${fixture.store_id}&location_id=${fixture.file_late_location_id}&status=IN_REVIEW&limit=5`,
          { headers: { Authorization: `Bearer ${await token(page)}` } },
        );
        return ((await lists.json()) as { items: unknown[] }).items.length;
      })
      .toBe(1);
    await page.clock.fastForward("01:01");
    await expect(form.getByRole("alert")).toHaveText(SLOW);

    // The warehouse read again: the list made is named, and opened.
    const made = form.getByRole("status");
    await expect(made).toContainText(
      "Список «Пізній зошит» уже збережено, хоч відповідь сервера й не дійшла вчасно. Відкрийте його — інші файли чи рядки додайте вже до нього.",
    );
    await expect(
      form.getByRole("button", { name: "Зберегти список" }),
    ).toHaveCount(0);
    // Another file picked keeps the command the list was made by.
    await choose(
      form,
      "пізній-2.json",
      stockFile([
        { text: `${coat} сірий L 1 шт`, photo: "T2.jpg", photo_line: 1 },
      ]),
    );
    const draft = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      `birka:stock-list-draft:${fixture.store_id}`,
    );
    expect(
      (JSON.parse(draft ?? "{}") as { command_id?: string }).command_id,
    ).toBe(commands[0]);
    await made.getByRole("button", { name: "Відкрити список" }).click();
    await expect(
      page.getByRole("heading", { name: "Пізній зошит" }),
    ).toBeVisible();
    expect(commands).toHaveLength(1);
  } finally {
    free();
    await page.unrouteAll({ behavior: "wait" });
  }
  // One list waits there, and the phone keeps no draft of it.
  const lists = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&location_id=${fixture.file_late_location_id}&status=IN_REVIEW&limit=5`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  expect(((await lists.json()) as { items: unknown[] }).items).toHaveLength(1);
  expect(
    await page.evaluate(
      (key) => window.localStorage.getItem(key),
      `birka:stock-list-draft:${fixture.store_id}`,
    ),
  ).toBeNull();
});

test("an answer too slow to wait for, its list made only after: no new list is offered meanwhile, and saving again opens the one list", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.file_later_location_id);
  await page.clock.install();
  // The phone's request never reaches the server; the same request does,
  // after the phone stopped waiting and read the warehouse again.
  const sent: { command_id: string }[] = [];
  let free: () => void = () => undefined;
  const freed = new Promise<void>((resolve) => {
    free = resolve;
  });
  await page.route("**/api/v1/snapshots", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push(route.request().postDataJSON() as { command_id: string });
    // The second send is refused for its form, as a server would refuse a
    // body it cannot read: an answer about this request, not the first.
    if (sent.length === 2)
      return route.fulfill({
        status: 422,
        json: {
          code: "VALIDATION_ERROR",
          message: "Request failed validation",
          details: { reason: "SOMETHING_ELSE" },
        },
      });
    if (sent.length > 1) return route.continue();
    await freed;
    await route.abort("failed").catch(() => undefined);
  });
  const listed = async (): Promise<number> => {
    const lists = await page.request.get(
      `/api/v1/snapshots?store_id=${fixture.store_id}&location_id=${fixture.file_later_location_id}&status=IN_REVIEW&limit=5`,
      { headers: { Authorization: `Bearer ${await token(page)}` } },
    );
    return ((await lists.json()) as { items: unknown[] }).items.length;
  };
  try {
    await openings(page);
    const form = await newFromFile(page, fixture.file_later_location_id);
    await choose(
      form,
      "пізніший.json",
      stockFile(
        [{ text: `${coat} сірий M 1 шт`, photo: "U1.jpg", photo_line: 1 }],
        { source: "Пізніший зошит" },
      ),
    );
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect.poll(() => sent.length).toBe(1);
    await page.clock.fastForward("01:01");
    await expect(form.getByRole("alert")).toHaveText(SLOW);
    // Read again, the warehouse holds no list yet; still the send is
    // unsettled, so no new list is offered beside it (review, 2026-10-09).
    await expect(
      form.getByRole("button", { name: "Зберегти список" }),
    ).toBeEnabled();
    await expect(
      form.getByRole("button", { name: "Почати як новий список" }),
    ).toHaveCount(0);

    // Sent again, the request is refused for its form: an answer about this
    // send, which says nothing of the first. The send stays unsettled, and
    // no new list is offered (review, third round, 2026-10-09).
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect.poll(() => sent.length).toBe(2);
    // In the list's words, never an order's; and never «не збережено»,
    // since the send before it may still have made the list (review,
    // 2026-10-24).
    await expect(form.getByRole("alert")).toHaveText(
      "Сервер не прийняв цей запит, а чи збережено список попередньою спробою — ще невідомо. Перевірте файл і натисніть ще раз — двічі список не збережеться.",
    );
    await expect(
      form.getByRole("button", { name: "Зберегти список" }),
    ).toBeEnabled();
    await expect(
      form.getByRole("button", { name: "Почати як новий список" }),
    ).toHaveCount(0);
    const kept = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      `birka:stock-list-draft:${fixture.store_id}`,
    );
    expect(
      (JSON.parse(kept ?? "{}") as { unsettled?: boolean }).unsettled,
    ).toBe(true);

    // The server takes the same request in, late.
    const late = await page.request.post("/api/v1/snapshots", {
      data: sent[0],
      headers: { Authorization: `Bearer ${await token(page)}` },
    });
    expect(late.status()).toBe(201);
    expect(await listed()).toBe(1);

    // Saved again, the same command answers with the list made.
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect(
      page.getByRole("heading", { name: "Пізніший зошит" }),
    ).toBeVisible();
    expect(sent.map((body) => body.command_id)).toEqual([
      sent[0]?.command_id,
      sent[0]?.command_id,
      sent[0]?.command_id,
    ]);
  } finally {
    free();
    await page.unrouteAll({ behavior: "wait" });
  }
  expect(await listed()).toBe(1);
  expect(
    await page.evaluate(
      (key) => window.localStorage.getItem(key),
      `birka:stock-list-draft:${fixture.store_id}`,
    ),
  ).toBeNull();
});

test("a send refused as the same command in another form settles the draft: whatever became of the list it made, a new list is offered, and a list a lost send made, opened from the overview, ends the draft", async ({
  page,
}) => {
  const coat = await model(page);
  const location = fixture.file_later_location_id;
  // The lists' names, this run's own: the overview shows every list.
  const tag = word();
  await noListWaits(page, location);
  // The server takes each send in; while `lost` names how, its answer
  // never reaches the phone: a gateway's own 504, or none at all.
  const sent: { command_id: string }[] = [];
  let lost: "gateway" | "nothing" | null = "gateway";
  await page.route("**/api/v1/snapshots", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push(route.request().postDataJSON() as { command_id: string });
    if (lost === null) return route.continue();
    const made = await route.fetch();
    expect(made.status()).toBe(201);
    if (lost === "gateway")
      return route.fulfill({ status: 504, body: "Gateway Timeout" });
    return route.abort("failed");
  });
  const draft = async (): Promise<{
    command_id?: string;
    unsettled?: boolean;
  } | null> =>
    JSON.parse(
      (await page.evaluate(
        (key) => window.localStorage.getItem(key),
        `birka:stock-list-draft:${fixture.store_id}`,
      )) ?? "null",
    ) as { command_id?: string; unsettled?: boolean } | null;
  const unknown =
    "Невідомо, чи збережено список. Натисніть ще раз — той самий список не збережеться двічі.";
  const newList = (form: Locator): Locator =>
    form.getByRole("button", { name: "Почати як новий список" });
  try {
    await openings(page);
    let form = await newFromFile(page, location);
    await choose(
      form,
      "загублений.json",
      stockFile(
        [{ text: `${coat} сірий M 1 шт`, photo: "V1.jpg", photo_line: 1 }],
        { source: `Загублений зошит ${tag}` },
      ),
    );
    // A gateway gave up while the server went on and made the list: the
    // outcome is unknown, so no new list is offered (review, fourth round,
    // 2026-10-09).
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect(form.getByRole("alert")).toHaveText(unknown);
    await expect(newList(form)).toHaveCount(0);
    expect((await draft())?.unsettled).toBe(true);

    // Meanwhile someone rejects the list made: the file was wrong.
    await noListWaits(page, location);
    await form.getByRole("button", { name: "Закрити" }).click();

    // Later, a corrected file: the same command, as the draft is
    // unsettled, refused as sent before in another form. That settles it:
    // the command made a list, so no send of it makes another, and a new
    // list is offered, though no list of it waits at the warehouse.
    lost = null;
    form = await newFromFile(page, location);
    await choose(
      form,
      "виправлений.json",
      stockFile(
        [{ text: `${coat} сірий L 2 шт`, photo: "V2.jpg", photo_line: 1 }],
        { source: `Виправлений зошит ${tag}` },
      ),
    );
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Цей список уже збережено, але в іншому вигляді. Знайдіть його в переліку, або почніть новий.",
    );
    expect(sent.map((body) => body.command_id)).toEqual([
      sent[0]?.command_id,
      sent[0]?.command_id,
    ]);
    expect((await draft())?.unsettled).toBe(false);
    await newList(form).click();
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect(
      page.getByRole("heading", { name: `Виправлений зошит ${tag}` }),
    ).toBeVisible();
    expect(sent).toHaveLength(3);
    expect(sent[2]?.command_id).not.toBe(sent[0]?.command_id);
    expect(await draft()).toBeNull();

    // A send whose answer never came, its list then opened from the
    // overview: the list is made, and the draft is done.
    await noListWaits(page, location);
    await page.getByRole("button", { name: "До списків" }).click();
    lost = "nothing";
    form = await newFromFile(page, location);
    await choose(
      form,
      "без-відповіді.json",
      stockFile(
        [{ text: `${coat} сірий M 3 шт`, photo: "V3.jpg", photo_line: 1 }],
        { source: `Зошит без відповіді ${tag}` },
      ),
    );
    await form.getByRole("button", { name: "Зберегти список" }).click();
    await expect(form.getByRole("alert")).toHaveText(unknown);
    expect((await draft())?.command_id).toBe(sent[3]?.command_id);
    await form.getByRole("button", { name: "Закрити" }).click();
    lost = null;
    await page.getByRole("button", { name: "Оновити" }).click();
    await page
      .getByRole("article", { name: `Список Зошит без відповіді ${tag}` })
      .getByRole("button", { name: "Відкрити" })
      .click();
    await expect(
      page.getByRole("heading", { name: `Зошит без відповіді ${tag}` }),
    ).toBeVisible();
    expect(await draft()).toBeNull();
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
});
