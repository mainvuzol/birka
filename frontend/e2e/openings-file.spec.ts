import { test, expect } from "./fixtures";
import type { Locator, Page, Route } from "@playwright/test";
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
  shared_opening_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

/** RIGHT-TO-LEFT OVERRIDE: makes «12 шт» read «шт 21» where it stands. */
const RLO = String.fromCodePoint(0x202e);
/** A JSON escape's backslash, written out: the file holds `\` + `u0078`. */
const BACKSLASH = String.fromCharCode(92);
const SLOW =
  "Сервер ще не відповів. Оновіть список і перевірте, чи це збережено; повторити безпечно.";
const LAST =
  "Це останній файл списку. Якщо він помилковий — відхиліть список: склад звільниться.";

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

async function token(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
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
  await page.getByRole("button", { name: "Основний MAIN" }).click();
  await page.getByRole("button", { name: "Початкові залишки" }).click();
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
        { text: `Куртка ${RLO}абв 1 шт`, photo: "IMG_0001.jpg", photo_line: 4 },
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
      `Місце у списку: рядків 5 з ${String(limits.lines)} · відповідей 0 з ${String(limits.allocations)}`,
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
    "У рядку ця кількість без «шт» — це лише підказка.",
  );
  await expect(hinted).toContainText("Ціна з зошита: 1200 (закупівельна)");
  await expect(card(page, 3)).toContainText("Примітка парсера: заголовок");
  // A character that reorders the line is shown as a mark, and kept as is.
  const reordered = card(page, 4).locator(".catalog-raw");
  await expect(reordered).toHaveText("4. Куртка ⟦U+202E⟧абв 1 шт");
  expect(await card(page, 4).innerText()).not.toContain(RLO);

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
    `Куртка ${RLO}абв 1 шт`,
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

  // What only the server checks is named by its line, from the server.
  await choose(
    adding,
    "службові.json",
    Buffer.from(
      `{"format":"birka.stock-list","version":1,"lines":[{"text":"А 1 шт","photo":"b.jpg","photo_line":1},{"text":"Б\\t2 шт","photo":"b.jpg","photo_line":2},{"text":"В 1 шт","photo":"b.jpg","photo_line":3,"colour":"сірий"}]}`,
    ),
  );
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(adding.getByRole("alert").getByRole("listitem")).toHaveText([
    "Рядок 2 файлу: у полі «текст» є службовий символ (перенесення рядка чи табуляція).",
    "Рядок 3 файлу: «colour» — невідоме поле.",
  ]);

  // A refusal that names no line in its context is placed by its index.
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
        ],
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
  await expect(adding.getByRole("alert")).toHaveText(
    "Рядок 5 файлу: фото — немає.",
  );
  await page.unrouteAll({ behavior: "wait" });

  // A request the edge would refuse is not sent: said by the phone.
  const before = sent.length;
  const near = { ...line, photo: "d.jpg" };
  const base = Buffer.byteLength(
    JSON.stringify({ format: "birka.stock-list", version: 1, lines: [near] }),
  );
  const padded = stockFile([near], {
    $schema: undefined,
    parser: "x".repeat(989_990 - base - `,"parser":""`.length),
  });
  await choose(adding, "межа.json", padded);
  await expect(adding.getByLabel("Що у файлі")).toBeVisible();
  await adding.getByRole("button", { name: "Додати до списку" }).click();
  await expect(adding.getByRole("alert")).toHaveText(
    "Файл завеликий — розділіть його на два.",
  );
  expect(sent).toHaveLength(before);
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
  await page.getByRole("button", { name: "Другий SECOND" }).click();
  await page.getByRole("button", { name: "Початкові залишки" }).click();
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
