import {
  test,
  expect,
  addModel,
  listWay,
  rejectList,
  removePart,
  menu,
  more,
  newModelSheet,
  openStore,
  receiveInto,
  receiveModel,
  receiveUnits,
  recordReceipt,
  section,
  sizeCell,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Початкові залишки»: the shops' existing stock, entered as a list (owner
 * decision, 2026-10-01; ADR-0005). A list is typed line by line, each line
 * answered by a person, and the whole list approved into the opening balance
 * of a warehouse nothing has moved in yet — which the seed has exactly one
 * of, so the approving journey runs once per seed.
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  opening_location_id: string;
  waiting_location_id: string;
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

/** A model of this test's own, in sizes M and L, held nowhere. */
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

/**
 * No list waits at this warehouse when a journey starts one there: the app
 * offers no second list for a warehouse whose list waits (owner decision,
 * 2026-10-08; ADR-0014 §7), and a journey run before may have left one.
 */
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

/** «Початкові залишки»; `version`: inside Telegram of that version. */
async function openings(page: Page, version?: string): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({
      tgWebAppData: initData(),
      ...(version === undefined ? {} : { tgWebAppVersion: version }),
    }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await section(page, "Початкові залишки");
}

/** A warehouse of the store, by its id: its name, as its chip says it. */
async function placeName(page: Page, location: string): Promise<string> {
  const answer = await page.request.get(
    `/api/v1/stock-locations?store_id=${fixture.store_id}`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  const places = (await answer.json()) as { id: string; name: string }[];
  const name = places.find((place) => place.id === location)?.name;
  expect(name).toBeDefined();
  return name ?? "";
}

/** The new list's warehouse: a chip, or — the only one a list may start
 * at — said and taken (stage 2, goods task list, P0-6). */
async function chip(page: Page, name: string): Promise<void> {
  const form = page.getByRole("form", { name: "Новий список" });
  const button = form
    .getByRole("group", { name: "Склад" })
    .getByRole("button", { name, exact: true });
  const only = form.locator(".opening-place");
  await expect(button.or(only)).toBeVisible();
  if (await only.isVisible()) await expect(only).toHaveText(`Склад «${name}»`);
  else await button.click();
}

async function warehouse(page: Page, location: string): Promise<void> {
  await chip(page, await placeName(page, location));
}

async function typeList(
  page: Page,
  location: string,
  source: string,
  lines: string[],
): Promise<void> {
  await page.getByRole("button", { name: "Новий список" }).click();
  await warehouse(page, location);
  await page.getByLabel("Звідки список (необов’язково)").fill(source);
  await page
    .getByLabel("Рядки списку — кожен товар з нового рядка, як написано")
    .fill(lines.join("\n"));
}

async function pick(page: Page, form: string, name: string): Promise<void> {
  const editor = page.getByRole("form", { name: form });
  await editor.getByLabel("Пошук у каталозі").fill(name);
  await editor.getByRole("radio", { name: `${name} сірий` }).click();
}

/** The list's other lines, from ⋯'s sheet (stage 2, goods task list,
 * P0-6): «Усі», «Не товар». */
async function showLines(page: Page, which: string): Promise<void> {
  await page.getByRole("button", { name: /^Інші рядки/ }).click();
  // A tap is taken once the sheet has risen.
  const sheet = page.getByRole("dialog", { name: "Інші рядки" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: new RegExp(`^${which}`) }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

function card(page: Page, line: number): Locator {
  return page.getByRole("article", {
    name: `Рядок ${String(line)}`,
    exact: true,
  });
}

/** A line's own screen, from its row (P0-5). */
async function answer(page: Page, line: number): Promise<Locator> {
  await card(page, line)
    .getByRole("button", { name: /^(Розібрати|Змінити відповідь)$/ })
    .click();
  return page.getByRole("form", { name: `Розбір рядка ${String(line)}` });
}

/** A size of a line's model, a cell (P0-5); `at`: of its `at`-th model. */
async function size(editor: Locator, code: string, at = 0): Promise<void> {
  await editor
    .getByRole("radiogroup", { name: "Розмір" })
    .nth(at)
    .getByRole("radio", { name: code, exact: true })
    .click();
}

/** Its MainButton, outside Telegram the dock's: «Зберегти й далі · …». */
function saving(editor: Locator): Locator {
  return editor.getByRole("button", { name: /^Зберегти/ });
}

/** Saved: the next line opens by itself, or the list; back on the list
 * either way. */
async function save(page: Page, editor: Locator): Promise<void> {
  await saving(editor).click();
  await expect(editor).toHaveCount(0);
  const another = page.getByRole("form", { name: /^Розбір рядка/ });
  if ((await another.count()) > 0)
    await page.getByRole("button", { name: "Назад до списку" }).click();
  await expect(another).toHaveCount(0);
}

/** «Затвердити · N шт.», Telegram's MainButton, outside it the dock's;
 * then «Так, затвердити» in its sheet once the sheet takes a tap (P0-6). */
async function approve(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Затвердити · / }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: "Так, затвердити" }).click();
}

test("a list is typed, each line answered, and approved into opening stock", async ({
  page,
}) => {
  const coat = await model(page);
  await openings(page);
  await typeList(page, fixture.opening_location_id, "Зошит 1", [
    `${coat} сірий 3 шт`,
    "",
    `${coat} сірий`,
    "Разом по сторінці",
  ]);
  await expect(page.getByText("Рядків: 3. Порожні рядки")).toBeVisible();
  await page.getByRole("button", { name: "Зберегти список" }).click();

  await expect(page.getByRole("heading", { name: "Зошит 1" })).toBeVisible();
  await showLines(page, "Усі");

  // A line on its own screen: «Рядок 1 з 3», the menu aside (stage 2,
  // goods task list, P0-5).
  let editor = await answer(page, 1);
  await expect(
    page.getByRole("heading", { name: "Рядок 1 з 3" }),
  ).toBeFocused();
  await expect(menu(page)).toBeHidden();
  await expect(editor.locator(".opening-paper")).toHaveText(
    `${coat} сірий 3 шт`,
  );
  // What the line states is chosen, dashed with «Прочитали в рядку» until
  // touched (В-Г7 (а)), and nothing more is offered.
  await expect(editor.getByLabel("Як у списку: 3 шт.")).toBeChecked();
  await expect(editor.locator(".way-option.read")).toHaveText(
    "Як у списку: 3 шт. Прочитали в рядку",
  );
  await expect(
    editor.getByLabel("Рядок без кількості — одна штука"),
  ).toHaveCount(0);
  // No model is chosen for the person.
  await expect(saving(editor)).toBeDisabled();
  await pick(page, "Розбір рядка 1", coat);
  await expect(
    editor.getByText(`${coat} сірий`, { exact: true }),
  ).toBeVisible();
  await size(editor, "M");
  await expect(editor.getByLabel("Кількість")).toHaveValue("3");
  await expect(editor.getByLabel("Кількість")).toBeDisabled();
  // The MainButton says what is recorded, and opens the next line.
  await expect(saving(editor)).toHaveText("Зберегти й далі · M × 3 шт.");
  await saving(editor).click();

  // A line with no count may be taken as one piece, its size not known.
  editor = page.getByRole("form", { name: "Розбір рядка 2" });
  await expect(
    page.getByRole("heading", { name: "Рядок 2 з 3" }),
  ).toBeFocused();
  await expect(
    editor.getByLabel("Рядок без кількості — одна штука"),
  ).toBeChecked();
  await pick(page, "Розбір рядка 2", coat);
  await editor.getByRole("radio", { name: "Розмір невідомий" }).click();
  await expect(saving(editor)).toHaveText(
    "Зберегти й далі · розмір невідомий × 1 шт.",
  );
  await saving(editor).click();

  // And a line that is not stock says why; the last one's MainButton is
  // «Зберегти», back to the list's tag.
  editor = page.getByRole("form", { name: "Розбір рядка 3" });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Не товар" }).click();
  await editor.getByLabel("Чому це не товар").fill("підсумок сторінки");
  await expect(saving(editor)).toHaveText("Зберегти · не товар");
  await saving(editor).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".opening-hero-in")).toBeFocused();
  await expect(menu(page)).toBeVisible();
  await expect(card(page, 1)).toContainText("Розібрано");
  await expect(card(page, 2)).toContainText(
    `→ ${coat} сірий, розмір невідомий × 1`,
  );
  await expect(card(page, 3)).toContainText("Не товар: підсумок сторінки");
  await expect(page.locator(".opening-progress")).toContainText(
    "Розібрано 2 з 3",
  );
  // The bar fills with what is decided, and says it.
  await expect(
    page.getByRole("progressbar", { name: "Розібрано рядків" }),
  ).toHaveAttribute("aria-valuetext", "Розібрано 2 з 3, не товар 1");

  // What the approval adds up is its sheet's, under the number — nothing
  // of it on the list (goods task list after stage 2, P0-1).
  await expect(page.getByLabel("Затвердження списку")).toHaveCount(0);
  await expect(page.getByText(/^Затвердити можна, коли/)).toHaveCount(0);
  await page.getByRole("button", { name: "Затвердити · 4 шт." }).click();
  const sheet = page.getByRole("dialog", { name: "Затвердити «Зошит 1»?" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(sheet.locator(".opening-units")).toHaveText("4 шт.");
  await expect(
    sheet.getByText(
      "стануть початковим залишком складу «Новий склад». Скасувати це потім не можна.",
    ),
  ).toBeVisible();
  await expect(
    sheet.getByText("Як у списку: 1 рядок · 3 шт.", { exact: true }),
  ).toBeVisible();
  // One file: no count of files.
  await expect(sheet.getByText(/^Файлів у списку/)).toHaveCount(0);
  await sheet.getByRole("button", { name: "Так, затвердити" }).click();
  await expect(
    page.getByText(
      "Затверджено: 4 шт. стали початковим залишком складу «Новий склад».",
    ),
  ).toBeVisible();

  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.store_id}&location_id=${fixture.opening_location_id}&limit=100&offset=0`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  const { items } = (await response.json()) as {
    items: {
      display_name: string;
      size_label: string;
      size_is_unknown: boolean;
      quantity: number;
    }[];
  };
  expect(
    items
      .filter((item) => item.display_name === `${coat} сірий`)
      .map((item) => [
        item.size_is_unknown ? "?" : item.size_label,
        item.quantity,
      ])
      .sort(),
  ).toEqual([
    ["?", 1],
    ["M", 3],
  ]);
});

/** Telegram, the journey's own: what the app tells it, and its MainButton
 * and «Назад» pressed. Before the page opens. */
async function telegram(page: Page): Promise<{
  main: () => Promise<unknown>;
  back: () => Promise<unknown>;
  pressMain: () => Promise<void>;
  pressBack: () => Promise<void>;
}> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
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
  const told = async (event: string): Promise<unknown> =>
    (
      await page.evaluate(
        (wanted) =>
          (window as unknown as { told: [string, unknown][] }).told
            .filter(([name]) => name === wanted)
            .map(([, data]) => data),
        event,
      )
    ).at(-1) ?? null;
  const press = (eventType: string): Promise<void> =>
    page.evaluate((type) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: type }),
          source: window.parent,
        }),
      );
    }, eventType);
  return {
    main: () => told("web_app_setup_main_button"),
    back: () => told("web_app_setup_back_button"),
    pressMain: () => press("main_button_pressed"),
    pressBack: () => press("back_button_pressed"),
  };
}

test("inside Telegram a line's answer is its MainButton, naming what is recorded, and the next line opens; «Назад» goes back to the list, hidden while an answer is on its way; «Пропустити» opens the next line with nothing sent; approval is the MainButton and its sheet's; lines typed and the rejection are ⋯'s, each with its own MainButton, «Назад» the list (stage 2, goods task list, P0-5, P0-6; after stage 2, P0-1)", async ({
  page,
}) => {
  const { main, back, pressMain, pressBack } = await telegram(page);
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  const sent: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      (request.method() === "PUT" && /\/lines\/\d+$/.test(path)) ||
      (request.method() === "POST" && /\/(approve|reject|parts)$/.test(path))
    )
      sent.push(path.split("/").slice(-2).join("/"));
  });
  await openings(page, "8.0");
  // The lists' one action, Telegram's; the screen draws none of its own.
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Новий список",
  });
  await expect(page.locator(".main-mimic")).toHaveCount(0);
  await pressMain();
  await warehouse(page, fixture.opening_location_id);
  await page
    .getByLabel("Звідки список (необов’язково)")
    .fill("Зошит у Телеграмі");
  await page
    .getByLabel("Рядки списку — кожен товар з нового рядка, як написано")
    .fill([`${coat} сірий 2 шт`, `${coat} сірий 1 шт`, "Разом"].join("\n"));
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Зберегти список",
  });
  await pressMain();
  await expect(
    page.getByRole("heading", { name: "Зошит у Телеграмі" }),
  ).toBeVisible();
  // Lines wait: no approval yet.
  await expect.poll(main).toMatchObject({ is_visible: false });
  await showLines(page, "Усі");

  // «Пропустити»: the next line, nothing sent.
  let editor = await answer(page, 1);
  await editor.getByRole("button", { name: "Пропустити" }).click();
  editor = page.getByRole("form", { name: "Розбір рядка 2" });
  await expect(
    page.getByRole("heading", { name: "Рядок 2 з 3" }),
  ).toBeFocused();
  expect(sent).toEqual([]);
  // Held until the answer is whole.
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Зберегти й далі",
  });

  // Its answer, the MainButton naming it; while it is on its way, «Назад»
  // is hidden and does nothing.
  await pick(page, "Розбір рядка 2", coat);
  await size(editor, "M");
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Зберегти й далі · M × 1 шт.",
  });
  await expect(editor.locator(".main-mimic")).toHaveCount(0);
  let free = (): void => undefined;
  const freed = new Promise<void>((resolve) => {
    free = resolve;
  });
  const answers = "**/api/v1/snapshots/*/lines/*";
  await page.route(answers, async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await freed;
    await route.fallback();
  });
  await pressMain();
  await expect.poll(main).toMatchObject({ is_progress_visible: true });
  await expect.poll(back).toMatchObject({ is_visible: false });
  await pressBack();
  await expect(editor).toBeVisible();
  free();
  editor = page.getByRole("form", { name: "Розбір рядка 3" });
  await expect(editor).toBeVisible();
  await page.unroute(answers);
  await expect.poll(back).toMatchObject({ is_visible: true });
  expect(sent).toEqual(["lines/2"]);

  // «Назад»: the list, nothing recorded, the cursor on the line's verb.
  await pressBack();
  await expect(editor).toHaveCount(0);
  await expect(
    card(page, 3).getByRole("button", { name: "Розібрати", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".opening-progress")).toContainText(
    "Розібрано 1 з 3",
  );

  // The line skipped, answered; the next of all the lines opens.
  editor = await answer(page, 1);
  await pick(page, "Розбір рядка 1", coat);
  await size(editor, "M");
  await expect.poll(main).toMatchObject({
    text: "Зберегти й далі · M × 2 шт.",
  });
  await pressMain();
  await expect(
    page.getByRole("form", { name: "Розбір рядка 2" }),
  ).toBeVisible();
  await pressBack();
  editor = await answer(page, 3);
  await editor.getByRole("button", { name: "Не товар" }).click();
  await editor.getByLabel("Чому це не товар").fill("підсумок сторінки");
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Зберегти · не товар",
  });
  await pressMain();
  await expect(editor).toHaveCount(0);
  expect(sent).toEqual(["lines/2", "lines/1", "lines/3"]);

  // Nothing waits: «Затвердити · 3 шт.», then «Так, затвердити» in its
  // sheet; «Назад» closes the sheet, nothing approved.
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Затвердити · 3 шт.",
  });
  await expect(page.locator(".main-mimic")).toHaveCount(0);
  // A press as its sheet rises — a double tap's second — is let go (spec
  // §6.6); the server's answer to an approval is this journey's own.
  await page.route("**/api/v1/snapshots/*/approve?**", async (route) => {
    await route.fulfill({ json: {} });
  });
  await pressMain();
  await expect
    .poll(main, { intervals: [20] })
    .toMatchObject({ text: "Так, затвердити" });
  await pressMain();
  const sheet = page.getByRole("dialog", {
    name: "Затвердити «Зошит у Телеграмі»?",
  });
  await expect(sheet).toHaveAttribute("data-ready", "");
  expect(sent).toEqual(["lines/2", "lines/1", "lines/3"]);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Так, затвердити",
  });
  await expect(sheet.locator(".main-mimic")).toHaveCount(0);
  await pressBack();
  await expect(sheet).toHaveCount(0);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    text: "Затвердити · 3 шт.",
  });
  // ⋯'s sheet over the list: its MainButton is not the approval's.
  await page.getByRole("button", { name: /^Інші рядки/ }).click();
  await expect(page.getByRole("dialog", { name: "Інші рядки" })).toBeVisible();
  await expect.poll(main).toMatchObject({ is_visible: false });
  await pressBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    text: "Затвердити · 3 шт.",
  });
  expect(sent).toEqual(["lines/2", "lines/1", "lines/3"]);
  // Lines typed into the list: the tag's ⋯, a screen of their own, its
  // MainButton «Додати рядки» until there are lines; «Назад» the list
  // (goods task list after stage 2, P0-1).
  await page.getByRole("button", { name: "Дії зі списком" }).click();
  const ways = page.getByRole("dialog", { name: "Зошит у Телеграмі" });
  await expect(ways).toHaveAttribute("data-ready", "");
  await expect.poll(main).toMatchObject({ is_visible: false });
  await ways.getByRole("button", { name: "Додати рядки вручну" }).click();
  const typing = page.getByRole("form", { name: "Додати рядки вручну" });
  await expect(
    page.getByRole("heading", { name: "Додати рядки вручну" }),
  ).toBeFocused();
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Додати рядки",
  });
  await expect(typing.locator(".main-mimic")).toHaveCount(0);
  await typing
    .getByLabel("Рядки — кожен товар з нового рядка, як написано")
    .fill("ще рядок");
  await expect.poll(main).toMatchObject({ is_active: true });
  await pressBack();
  await expect(typing).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Дії зі списком" }),
  ).toBeFocused();
  await expect.poll(main).toMatchObject({
    is_visible: true,
    text: "Затвердити · 3 шт.",
  });
  // The rejection, ⋯'s too: its MainButton «Так, відхилити» not pressed
  // until a reason is given; «Назад» closes the sheet, nothing rejected.
  await page.getByRole("button", { name: "Дії зі списком" }).click();
  await expect(ways).toHaveAttribute("data-ready", "");
  await ways.getByRole("button", { name: "Відхилити список" }).click();
  const rejecting = page.getByRole("dialog", {
    name: "Відхилити «Зошит у Телеграмі»?",
  });
  await expect(rejecting).toBeVisible();
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Так, відхилити",
  });
  await expect(rejecting.locator(".main-mimic")).toHaveCount(0);
  await expect(
    rejecting.getByRole("button", { name: "Скасувати" }),
  ).toHaveCount(0);
  await rejecting.getByLabel("Чому відхиляємо").fill("ще подумаємо");
  await expect.poll(main).toMatchObject({ is_active: true });
  await pressBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    text: "Затвердити · 3 шт.",
  });
  expect(sent).toEqual(["lines/2", "lines/1", "lines/3"]);
  // Pressed once the sheet has risen, it approves.
  await pressMain();
  await expect(sheet).toHaveAttribute("data-ready", "");
  await pressMain();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent[3]).toMatch(/\/approve$/);
  await expect(sheet).toHaveCount(0);
});

test("lines answered where they wait: the line answered leaves its filter and the next opens, past the page read too; the last that waits says «Зберегти», back to the list's tag (stage 2, goods task list, P0-5)", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  await openings(page);
  const source = `Зошит черги ${word()}`;
  await typeList(
    page,
    fixture.opening_location_id,
    source,
    Array.from({ length: 52 }, (_, i) => `${coat} сірий ${String(i + 1)} шт`),
  );
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name: source })).toBeVisible();
  // Where they wait, the switch saying so; a page of fifty read.
  const modes = page.getByRole("group", { name: "Які рядки" });
  await expect(modes.getByRole("button", { pressed: true })).toHaveText(
    /^(Потребують уваги|Чекають) 52$/,
  );
  await expect(page.getByRole("article", { name: /^Рядок \d+$/ })).toHaveCount(
    50,
  );

  // Answered, the line leaves its filter; the next opens by itself.
  let editor = await answer(page, 1);
  await expect(
    page.getByRole("heading", { name: "Рядок 1 з 52" }),
  ).toBeFocused();
  await pick(page, "Розбір рядка 1", coat);
  await size(editor, "M");
  await expect(saving(editor)).toHaveText("Зберегти й далі · M × 1 шт.");
  await saving(editor).click();
  editor = page.getByRole("form", { name: "Розбір рядка 2" });
  await expect(
    page.getByRole("heading", { name: "Рядок 2 з 52" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Назад до списку" }).click();
  await expect(editor).toHaveCount(0);
  await expect(card(page, 1)).toHaveCount(0);
  await expect(modes.getByRole("button", { pressed: true })).toHaveText(/ 51$/);

  // The last line read, more past it: «Зберегти й далі». «Пропустити»
  // reads the next page, and its line opens.
  editor = await answer(page, 51);
  await expect(saving(editor)).toHaveText("Зберегти й далі");
  await editor.getByRole("button", { name: "Пропустити" }).click();
  editor = page.getByRole("form", { name: "Розбір рядка 52" });
  await expect(
    page.getByRole("heading", { name: "Рядок 52 з 52" }),
  ).toBeFocused();

  // The last that waits: «Зберегти», back to the list's tag.
  await pick(page, "Розбір рядка 52", coat);
  await size(editor, "L");
  await expect(saving(editor)).toHaveText("Зберегти · L × 52 шт.");
  await saving(editor).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".opening-hero-in")).toBeFocused();
  await expect(page.locator(".opening-progress")).toContainText(
    "Розібрано 2 з 52",
  );
});

test("at 360 px, light and dark, the lists, a list's big tag and a line's screen fit; every kind of line is reached — three on the switch, a tap each, «Не товар» and «Усі» behind ⋯ (stage 2, goods task list, P0-5, P0-6)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  // One warehouse a list may start at: said and taken, no chips (decided
  // in chat, 2026-11-08).
  await page.route("**/api/v1/stock-locations?**", async (route) => {
    const response = await route.fetch();
    const places = (await response.json()) as { id: string }[];
    await route.fulfill({
      response,
      json: places.filter((place) => place.id === fixture.opening_location_id),
    });
  });
  const place = await placeName(page, fixture.opening_location_id);
  await openings(page);
  const name =
    "Зошит вузького телефона, сторінки з першої по двадцять четверту включно";
  await page.getByRole("button", { name: "Новий список" }).click();
  await expect(
    page.getByRole("heading", { name: "Новий список" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Назад до «Початкові залишки»" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Початкові залишки" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Новий список" }).click();
  const form = page.getByRole("form", { name: "Новий список" });
  await expect(form.locator(".opening-place")).toHaveText(`Склад «${place}»`);
  await expect(form.getByRole("group", { name: "Склад" })).toHaveCount(0);
  await form.getByLabel("Звідки список (необов’язково)").fill(name);
  await form
    .getByLabel("Рядки списку — кожен товар з нового рядка, як написано")
    .fill(
      [`${coat} сірий 2 шт`, "Разом по сторінці", `${coat} сірий`].join("\n"),
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await showLines(page, "Усі");
  const editor = await answer(page, 2);
  await editor.getByRole("button", { name: "Не товар" }).click();
  await editor.getByLabel("Чому це не товар").fill("підсумок сторінки");
  await save(page, editor);
  // Not stock apart from the answered, and what waits.
  await expect(page.locator(".opening-rest")).toHaveText(
    "Не товар 1 · чекають 2 · 0 шт.",
  );

  // Three on the switch, each a tap.
  const modes = page.getByRole("group", { name: "Які рядки" });
  const others = page.getByRole("button", { name: /^Інші рядки/ });
  await expect(modes.getByRole("button")).toHaveText([
    /^Потребують уваги \d+$/,
    /^Чекають \d+$/,
    "Розібрані 0",
  ]);
  for (const mode of [/^Потребують уваги/, /^Чекають/, /^Розібрані/]) {
    await modes.getByRole("button", { name: mode }).click();
    await expect(modes.getByRole("button", { name: mode })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(others).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.getByText("Тут рядків немає.")).toBeVisible();
  // Two behind ⋯, said on it once chosen.
  await showLines(page, "Не товар");
  await expect(
    page.getByRole("button", { name: "Інші рядки: Не товар" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(modes.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: /^Рядок \d+$/ })).toHaveCount(
    1,
  );
  await expect(card(page, 2)).toContainText("Не товар: підсумок сторінки");
  await showLines(page, "Усі");
  await expect(page.getByRole("article", { name: /^Рядок \d+$/ })).toHaveCount(
    3,
  );

  const fits = (): Promise<boolean> =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const paper: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // The list: its big tag, the switch and the rows — no `<select>`, no
    // h3 and no form inside a plate (goods task list after stage 2, P0-1).
    await expect(page.locator(".opening-hero-in")).toBeVisible();
    const list = page.locator("section.openings");
    await expect(list.locator("select")).toHaveCount(0);
    await expect(list.locator("h3")).toHaveCount(0);
    await expect(list.locator(".notice form, .notice [role=form]")).toHaveCount(
      0,
    );
    expect(await fits()).toBe(true);
    await page.screenshot({
      path: `test-results/openings-list-360-${scheme}.png`,
    });
    // A line's screen.
    const line = await answer(page, 1);
    await expect(line.locator(".opening-paper")).toBeVisible();
    // The notebook's line a slip of the card's white on the paper (review
    // of the audit after stage 2's first batch, 2026-11-09).
    const [slip, white, ground] = await line
      .locator(".opening-paper")
      .evaluate((element) => {
        const probe = document.createElement("span");
        document.body.append(probe);
        probe.style.color = "var(--card)";
        const card = getComputedStyle(probe).color;
        probe.style.color = "var(--paper)";
        const under = getComputedStyle(probe).color;
        probe.remove();
        return [getComputedStyle(element).backgroundColor, card, under];
      });
    expect(slip).toBe(white);
    expect(slip).not.toBe(ground);
    paper.push(slip);
    expect(await fits()).toBe(true);
    await page.screenshot({
      path: `test-results/openings-line-360-${scheme}.png`,
    });
    await page.getByRole("button", { name: "Назад до списку" }).click();
    await expect(line).toHaveCount(0);
    // The lists: «← Початкові залишки» over the title (P0-1).
    await page
      .getByRole("button", { name: "Назад до «Початкові залишки»" })
      .click();
    await expect(
      page.getByRole("article", { name: `Список ${name}` }),
    ).toContainText("Розібрано 0 з 3 · не товар 1");
    expect(await fits()).toBe(true);
    await page.screenshot({
      path: `test-results/openings-lists-360-${scheme}.png`,
    });
    await page
      .getByRole("article", { name: `Список ${name}` })
      .getByRole("button", { name: "Відкрити" })
      .click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  // The paper is the theme's own.
  expect(paper[0]).not.toBe(paper[1]);
});

/** The next command sent to `pattern` (never a read of it) answered as
 * `answer` says, once: a form the server does not name (422), a conflict
 * (409), or any answer of its own. */
/** The server's own failure, its request numbered. */
const serverFailed = {
  status: 500,
  headers: { "X-Request-ID": "3f9c2a7e-1b2c-4d5e-8f90-a1b2c3d4e5f6" },
  json: {
    code: "INTERNAL_ERROR",
    message: "Внутрішня помилка сервера.",
    details: {},
  },
};

async function refuseOnce(
  page: Page,
  pattern: string,
  answer:
    | "form"
    | "conflict"
    | { status: number; json: object; headers?: Record<string, string> },
): Promise<void> {
  let used = false;
  await page.route(pattern, async (route) => {
    if (used || route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    used = true;
    await route.fulfill(
      answer === "form"
        ? {
            status: 422,
            json: {
              code: "VALIDATION_ERROR",
              message: "Request failed validation",
              details: {},
            },
          }
        : answer === "conflict"
          ? {
              status: 409,
              json: { code: "CONFLICT", message: "Conflict", details: {} },
            }
          : answer,
    );
  });
}

/** How many times the list's `what` («lines», «parts») was read. */
function reads(page: Page, what: string): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname.endsWith(`/${what}`)
    )
      count += 1;
  });
  return () => count;
}

test("a new list refused for a reason the screen does not name says so by what was sent; lines past what the server takes at once are said before sending", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  await openings(page);
  await typeList(page, fixture.opening_location_id, "Зошит нового списку", [
    `${coat} сірий 3 шт`,
  ]);
  const save = page.getByRole("button", { name: "Зберегти список" });
  const listReads = reads(page, "snapshots");
  await refuseOnce(page, "**/api/v1/snapshots", "form");
  await save.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Список не збережено. Перевірте рядки.",
  );
  await refuseOnce(page, "**/api/v1/snapshots", "conflict");
  await save.click();
  const before = listReads();
  await expect(page.getByRole("alert")).toHaveText(
    "Список не збережено. Поки ви працювали, дані змінилися: перевірте склад і натисніть «Зберегти список» ще раз.",
  );
  // The warehouse read again: a list made meanwhile is found.
  await expect.poll(listReads).toBeGreaterThan(before);
  // A notebook pasted whole: more lines than one part takes.
  const text = page.getByLabel(
    "Рядки списку — кожен товар з нового рядка, як написано",
  );
  await text.fill(
    Array.from({ length: 1001 }, (_, i) => `${coat} сірий ${String(i)}`).join(
      "\n",
    ),
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /^Рядків: 1\s001, а за раз їх беруть/ }),
  ).toHaveText(
    /^Рядків: 1\s001, а за раз їх беруть не більше 1\s000\. Розділіть: решту додайте до списку через «Додати рядки вручну»\.$/,
  );
  await expect(save).toBeDisabled();
  await text.fill(`${coat} сірий 3 шт`);
  await save.click();
  await expect(
    page.getByRole("heading", { name: "Зошит нового списку" }),
  ).toBeVisible();
  // Rejected: the warehouse free for the journeys after.
  await rejectList(page, "перевірка нового списку");
  await expect(
    page.getByText(/^Відхилено: перевірка нового списку/),
  ).toBeVisible();
});

test("a list's refusals the server does not name are said in the list's words, never an order's: what was not done, then the step — never «спробуйте ще раз» on a write; a conflict read again (owner, В-П1 (б), 2026-11-11)", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  await openings(page);
  await typeList(page, fixture.opening_location_id, "Зошит відмов", [
    `${coat} сірий 3 шт`,
  ]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByRole("heading", { name: "Зошит відмов" }),
  ).toBeVisible();
  const lineReads = reads(page, "lines");
  const partReads = reads(page, "parts");

  // A line's answer.
  await showLines(page, "Усі");
  const line = await answer(page, 1);
  // A search no longer than the server reads (review, 2026-10-24).
  await expect(line.getByLabel("Пошук у каталозі")).toHaveAttribute(
    "maxlength",
    "200",
  );
  await pick(page, "Розбір рядка 1", coat);
  await size(line, "M");
  const answered = saving(line);
  await refuseOnce(page, "**/api/v1/snapshots/*/lines/*", "form");
  await answered.click();
  await expect(line.getByRole("alert")).toHaveText(
    "Відповідь не збережено. Перевірте її.",
  );
  const before = lineReads();
  await refuseOnce(page, "**/api/v1/snapshots/*/lines/*", "conflict");
  await answered.click();
  await expect(line.getByRole("alert")).toHaveText(
    "Відповідь не збережено. Поки ви працювали, список змінився — перегляньте його.",
  );
  // Read again, as it says.
  await expect.poll(lineReads).toBeGreaterThan(before);
  // An answer the shared words name keeps them: no access.
  await refuseOnce(page, "**/api/v1/snapshots/*/lines/*", {
    status: 403,
    json: { code: "PERMISSION_DENIED", message: "Forbidden", details: {} },
  });
  await answered.click();
  await expect(line.getByRole("alert")).toHaveText(
    "Немає доступу до цієї операції або складу. Зверніться до менеджера.",
  );
  // The server's own failure: what was not done, and to press again — its
  // request's number kept, never «Спробуйте ще раз» (review).
  await refuseOnce(page, "**/api/v1/snapshots/*/lines/*", serverFailed);
  await answered.click();
  await expect(line.getByRole("alert")).toHaveText(
    "Відповідь не збережено. Натисніть ще раз — повторити безпечно. Номер запиту: 3f9c2a7e.",
  );
  // The only line: «Зберегти», back to the list.
  await answered.click();
  await expect(line).toHaveCount(0);
  await expect(card(page, 1).getByText(/^Розібрано/)).toBeVisible();

  // Lines typed by hand, ⋯'s: too many said first; refused; added, then
  // removed on «Файли списку» (P0-1).
  await listWay(page, "Додати рядки вручну");
  const typing = page.getByRole("form", { name: "Додати рядки вручну" });
  const pasted = typing.getByLabel(/Рядки — кожен товар/);
  const add = typing.getByRole("button", { name: "Додати рядки" });
  // How much room the list has: a list typed in one go has no files'
  // screen to say it (review).
  await expect(typing.getByText(/^Місце у списку: рядків 1 з /)).toBeVisible();
  await pasted.fill(
    Array.from({ length: 1001 }, (_, i) => `${coat} сірий ${String(i)}`).join(
      "\n",
    ),
  );
  await expect(
    typing.getByRole("alert").filter({ hasText: /^Рядків: 1\s001/ }),
  ).toHaveText(
    /^Рядків: 1\s001, а за раз їх беруть не більше 1\s000\. Розділіть їх на кілька разів\.$/,
  );
  await expect(add).toBeDisabled();
  // Fewer lines, but more characters in all than one part takes.
  await pasted.fill(
    Array.from({ length: 900 }, () => `${coat} сірий ${"x".repeat(120)}`).join(
      "\n",
    ),
  );
  await expect(
    typing.getByRole("alert").filter({ hasText: /^Рядки разом задовгі/ }),
  ).toHaveText(
    /^Рядки разом задовгі: за раз беруть не більше 100\s000 знаків\. Розділіть їх на кілька разів\.$/,
  );
  await expect(add).toBeDisabled();
  await pasted.fill(`${coat} сірий L 1 шт`);
  await refuseOnce(page, "**/api/v1/snapshots/*/parts?**", "form");
  await add.click();
  await expect(typing.getByRole("alert")).toHaveText(
    "Рядки не додано. Перевірте їх.",
  );
  const partsBefore = partReads();
  await refuseOnce(page, "**/api/v1/snapshots/*/parts?**", "conflict");
  await add.click();
  await expect(typing.getByRole("alert")).toHaveText(
    "Рядки не додано. Поки ви працювали, список змінився — перегляньте його.",
  );
  await expect.poll(partReads).toBeGreaterThan(partsBefore);
  // Added: back on the list, the files ⋯'s.
  await add.click();
  await expect(typing).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Дії зі списком" }),
  ).toBeFocused();
  await listWay(page, "Файли списку · 2");
  await expect(
    page.getByRole("heading", { name: "Файли списку" }),
  ).toBeFocused();
  const typed = page.getByRole("article", { name: "Файл 2" });
  await expect(typed).toContainText("Рядки, внесені вручну");
  await refuseOnce(page, "**/api/v1/snapshots/*/parts/*/remove?**", "form");
  const removing = await removePart(page, typed, "Прибрати рядки");
  await expect(removing).toHaveCount(0);
  await expect(
    page.getByText("Рядки не прибрано. Перегляньте файли списку.", {
      exact: true,
    }),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/snapshots/*/parts/*/remove?**", "conflict");
  await removePart(page, typed, "Прибрати рядки");
  await expect(
    page.getByText(
      "Рядки не прибрано. Поки ви працювали, список змінився — перегляньте його.",
      { exact: true },
    ),
  ).toBeVisible();
  await removePart(page, typed, "Прибрати рядки");
  await expect(typed).toContainText(/Прибрано: Оля, /);
  await page.getByRole("button", { name: "Назад до «Зошит відмов»" }).click();

  // The decision: an approval refused said under the tag; a rejection
  // refused in its sheet, its reason kept (P0-1).
  const said = page.locator(".opening-said");
  await refuseOnce(page, "**/api/v1/snapshots/*/approve?**", "form");
  await approve(page);
  await expect(said).toHaveText(
    "Список не затверджено. Перегляньте рядки списку.",
  );
  await refuseOnce(page, "**/api/v1/snapshots/*/approve?**", "conflict");
  await approve(page);
  await expect(said).toHaveText(
    "Список не затверджено. Поки ви працювали, список змінився — перегляньте його.",
  );
  await refuseOnce(page, "**/api/v1/snapshots/*/approve?**", serverFailed);
  await approve(page);
  await expect(said).toHaveText(
    "Список не затверджено. Натисніть ще раз — повторити безпечно. Номер запиту: 3f9c2a7e.",
  );
  // Said of its moment: a line opened to be answered takes it away
  // (review).
  await card(page, 1)
    .getByRole("button", { name: "Змінити відповідь" })
    .click();
  await page.getByRole("button", { name: "Назад до списку" }).click();
  await expect(said).toHaveCount(0);
  // Nothing in it is stock: the server's own answer, said.
  await refuseOnce(page, "**/api/v1/snapshots/*/approve?**", {
    status: 409,
    json: {
      code: "SNAPSHOT_CONFLICT",
      message: "Nothing in this stock list is stock",
      details: { reason: "NOTHING_TO_APPLY" },
    },
  });
  await approve(page);
  await expect(said).toHaveText(
    "Список не затверджено: у ньому немає жодного рядка товару. Якщо так і є — відхиліть його.",
  );
  await listWay(page, "Відхилити список");
  await expect(said).toHaveCount(0);
  const rejecting = page.getByRole("dialog", {
    name: "Відхилити «Зошит відмов»?",
  });
  await expect(rejecting).toHaveAttribute("data-ready", "");
  const yes = rejecting.getByRole("button", { name: "Так, відхилити" });
  // Not pressed until a reason is given; what it does not change, said.
  await expect(yes).toBeDisabled();
  await expect(
    rejecting.getByText("Залишків цей список не змінить.", { exact: true }),
  ).toBeVisible();
  await rejecting.getByLabel("Чому відхиляємо").fill("перевірка відмов");
  await refuseOnce(page, "**/api/v1/snapshots/*/reject?**", "form");
  await yes.click();
  await expect(rejecting.getByRole("alert")).toHaveText(
    "Список не відхилено. Перевірте причину.",
  );
  // Rejected meanwhile by someone else for another reason: the server's
  // conflict for it.
  await refuseOnce(page, "**/api/v1/snapshots/*/reject?**", {
    status: 409,
    json: {
      code: "IDEMPOTENCY_CONFLICT",
      message: "This stock list was already rejected for another reason",
      details: {},
    },
  });
  await yes.click();
  await expect(rejecting.getByRole("alert")).toHaveText(
    "Цей список уже затвердили або відхилили.",
  );
  // Enter only puts the keyboard away: a rejection is never undone, so
  // only the button rejects; closed and opened again, the reason is the
  // list's still (review).
  let rejects = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/reject\?/.test(request.url()))
      rejects += 1;
  });
  const why = rejecting.getByLabel("Чому відхиляємо");
  await why.focus();
  await page.keyboard.press("Enter");
  await expect(why).not.toBeFocused();
  await expect(rejecting).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rejecting).toHaveCount(0);
  await listWay(page, "Відхилити список");
  await expect(rejecting).toHaveAttribute("data-ready", "");
  expect(rejects).toBe(0);
  // And rejected for real, the reason kept: the sheet closes, the tag
  // says so, the warehouse free for the journeys after.
  await expect(rejecting.getByLabel("Чому відхиляємо")).toHaveValue(
    "перевірка відмов",
  );
  await yes.click();
  await expect(rejecting).toHaveCount(0);
  await expect(page.getByText(/^Відхилено: перевірка відмов/)).toBeVisible();
  await expect(page.locator(".opening-hero-in")).toBeFocused();
});

test("a split the list does not state asks who counted, and a warehouse with history refuses it", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.location_id);
  await openings(page);
  await typeList(page, fixture.location_id, "Зошит 2", [
    `${coat} сірий M/L 2 шт`,
  ]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await showLines(page, "Усі");
  const editor = await answer(page, 1);

  // Neither "as the list says" nor "one piece": the list states no split.
  await expect(editor.getByLabel(/Як у списку/)).toHaveCount(0);
  await expect(
    editor.getByLabel("Рядок без кількості — одна штука"),
  ).toHaveCount(0);
  // Nothing chosen, nothing drawn as read.
  await expect(editor.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(editor.locator(".way-option.read")).toHaveCount(0);
  await editor.getByLabel("Перелічили").check();
  await pick(page, "Розбір рядка 1", coat);
  await size(editor, "M");
  await editor.getByRole("button", { name: "Ще розмір чи колір" }).click();
  await size(editor, "L", 1);
  await expect(saving(editor)).toBeDisabled();
  await editor.getByLabel("Хто й коли перелічив").fill("Оля, 01.10");
  await expect(saving(editor)).toHaveText("Зберегти · M × 1, L × 1 шт.");
  await save(page, editor);
  await expect(
    card(page, 1).getByText("Звідки кількість: Перелічили"),
  ).toBeVisible();

  // Refused, said under the tag (goods task list after stage 2, P0-1).
  const said = page.locator(".opening-said");
  await approve(page);
  await expect(said).toHaveText(
    /уже був рух товару, тому початковий залишок туди внести не можна/,
  );
  // Where the missing goods go in, as the row names it now (owner decision
  // after #142, 2026-10-26).
  await expect(said).toHaveText(
    /Відхиліть цей список, а відсутній товар прийміть через «Ще» › «Прийшов товар»\.$/,
  );

  await rejectList(page, "склад уже працює");
  await expect(
    page.getByText(
      "Відхилено: склад уже працює. Залишків цей список не змінив.",
    ),
  ).toBeVisible();
});

test("a line's model the catalogue has not is added from its empty search, in the sheet «Нова модель» over the list: the line keeps what it was answered, its model chosen and said (stage 2, goods task list, P0-1)", async ({
  page,
}) => {
  // A coat no catalogue holds yet.
  const coat = `Ліст ${word()}`;
  await noListWaits(page, fixture.location_id);
  await openings(page);
  await typeList(page, fixture.location_id, "Зошит нової моделі", [
    `${coat} сірий L 2 шт`,
  ]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await showLines(page, "Усі");
  const editor = await answer(page, 1);
  await expect(editor.getByLabel("Як у списку: 2 шт.")).toBeChecked();
  await editor.getByLabel("Пошук у каталозі").fill(coat);
  await expect(
    editor.getByText(`Нічого не знайшли за «${coat}»`),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: `Додати нову модель «${coat}»` })
    .click();
  const sheet = await newModelSheet(page);
  await expect(sheet.getByLabel("Як записано")).toHaveValue(coat);
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(coat);
  await sheet.getByLabel("Колір", { exact: true }).fill("сірий");
  await sizeCell(sheet, "M").click();
  await sizeCell(sheet, "L").click();
  await addModel(sheet).click();
  await expect(sheet).toHaveCount(0);
  // The line as it was answered, its model the one made, and said so.
  await expect(
    editor.getByRole("status").filter({ hasText: /^Модель додано/ }),
  ).toHaveText(`Модель додано: ${coat} сірий. Кількість впишіть тут.`);
  await expect(
    editor.getByText(`${coat} сірий`, { exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel("Як у списку: 2 шт.")).toBeChecked();
  await size(editor, "L");
  await save(page, editor);
  await expect(card(page, 1).getByText(/^Розібрано/)).toBeVisible();
  // The list goes: nothing waits at the warehouse the receipts use.
  await rejectList(page, "перевірка нової моделі");
  await expect(
    page.getByText(/^Відхилено: перевірка нової моделі\./),
  ).toBeVisible();
});

test("the check that no list waits at the warehouse, failed, is the warning's plate with «Спробувати ще раз» — never «Перевірити ще раз» —, which checks again (audit after stage 2, goods P1-1)", async ({
  page,
}) => {
  let refused = true;
  await page.route("**/api/v1/snapshots?*status=IN_REVIEW*", async (route) => {
    if (!refused) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 503,
      json: { code: "UNAVAILABLE", message: "No" },
    });
  });
  await openings(page);
  await page.getByRole("button", { name: "Новий список" }).click();
  await warehouse(page, fixture.opening_location_id);
  const plate = page
    .getByRole("form", { name: "Новий список" })
    .locator(".read-failure");
  await expect(plate).toBeVisible();
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(
    page.getByRole("button", { name: "Перевірити ще раз" }),
  ).toHaveCount(0);
  refused = false;
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(plate).toHaveCount(0);
});

test("a list typed is kept on the phone, and saved once when its answer is lost", async ({
  page,
}) => {
  const coat = await model(page);
  let calls = 0;
  await page.route("**/api/v1/snapshots", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    if (calls === 1) {
      // Saved on the server, and the answer lost on the way back.
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await noListWaits(page, fixture.location_id);
  await openings(page);
  const source = `Зошит ${word()}`;
  await typeList(page, fixture.location_id, source, [`${coat} сірий 1 шт`]);

  // A reload loses nothing typed.
  await page.reload();
  await openStore(page, "Основний MAIN");
  await section(page, "Початкові залишки");
  await page.getByRole("button", { name: "Новий список" }).click();
  await expect(
    page.getByLabel("Рядки списку — кожен товар з нового рядка, як написано"),
  ).toHaveValue(`${coat} сірий 1 шт`);

  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByText(/Невідомо, чи збережено список/)).toBeVisible();
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name: source })).toBeVisible();
  expect(calls).toBe(2);

  const lists = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&limit=100`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  const { items } = (await lists.json()) as {
    items: { source_document_ref: string | null }[];
  };
  expect(items.filter((l) => l.source_document_ref === source)).toHaveLength(1);
});

test("approving is for whoever may approve, and the section for whoever handles lists", async ({
  page,
}) => {
  let drop = ["snapshot:approve"];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of me.stores)
      store.permissions = store.permissions.filter((p) => !drop.includes(p));
    await route.fulfill({ response, json: me });
  });
  const coat = await model(page);
  await noListWaits(page, fixture.location_id);
  await openings(page);
  const source = `Зошит ${word()}`;
  await typeList(page, fixture.location_id, source, [`${coat} сірий 1 шт`]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  // Its one line answered, nothing waits: only the right keeps the
  // approval away (review, 2026-11-08).
  const editor = await answer(page, 1);
  await pick(page, "Розбір рядка 1", coat);
  await size(editor, "M");
  await save(page, editor);
  await expect(page.locator(".opening-progress")).toContainText(
    "Розібрано 1 з 1",
  );
  await expect(page.locator(".opening-rest")).toHaveText("1 шт.");
  await expect(page.getByLabel("Затвердження списку")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Затвердити/ })).toHaveCount(
    0,
  );
  // Whoever handles a list may still reject it (review, 2026-10-09): the
  // tag's ⋯ offers what this person may do, and only that (goods task
  // list after stage 2, P0-1). One part typed in one go: no files.
  await page.getByRole("button", { name: "Дії зі списком" }).click();
  const ways = page.getByRole("dialog", { name: source });
  await expect(ways.getByRole("button")).toHaveText([
    "Додати файл",
    "Додати рядки вручну",
    "Відхилити список",
  ]);
  await page.keyboard.press("Escape");
  await expect(ways).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Дії зі списком" }),
  ).toBeFocused();

  // Whoever may not take the stock in reads the lines without «Розібрати
  // рядок», and nothing is said of the rule (stage 2, goods task list,
  // P1-5).
  drop = ["snapshot:approve", "inventory:receive"];
  await page.reload();
  await openStore(page, "Основний MAIN");
  await section(page, "Початкові залишки");
  await page
    .getByRole("article", { name: `Список ${source}` })
    .getByRole("button", { name: "Відкрити", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: source })).toBeVisible();
  await expect(page.getByText(`${coat} сірий 1 шт`).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Розібрати|Змінити відповідь)$/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/право/)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  drop = ["snapshot:approve", "snapshot:import"];
  await page.reload();
  await openStore(page, "Основний MAIN");
  // «Ще» › «Товар і каталог» without the lists: its line says so, and its
  // own list holds none («Усе на бірці» task list, P0-4).
  await more(page);
  const catalogue = page
    .getByRole("navigation", { name: "Ще" })
    .getByRole("button", { name: /^Товар і каталог/ });
  await expect(catalogue.locator(".more-meta")).toHaveText("перевірка, моделі");
  await catalogue.click();
  await expect(
    page.getByRole("button", { name: "Перевірка каталогу", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Початкові залишки" }),
  ).toHaveCount(0);
});

test("nothing is received into a warehouse while its list waits, and it is once the list is rejected", async ({
  page,
}) => {
  // The owner's answer of 2026-10-02: the lists are approved before new
  // deliveries, and the app keeps that order.
  const source = `Зошит ${word()}`;
  await noListWaits(page, fixture.waiting_location_id);
  await openings(page);
  await typeList(page, fixture.waiting_location_id, source, ["Куртка 1 шт"]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByText(
      "Поки список чекає рішення, на складі «Склад, що чекає», де ще не було руху товару, нічого не приймають, не продають і не виправляють.",
      { exact: false },
    ),
  ).toBeVisible();

  async function receiveOne(): Promise<void> {
    await section(page, "Приймання");
    await receiveInto(page, "Склад, що чекає");
    await receiveModel(page, "лоран шоколад", /Лоран шоколад/);
    await receiveUnits(page, "M", 1);
    await recordReceipt(page, 1).click();
  }

  await receiveOne();
  await expect(
    page.getByText(
      "На цьому складі чекає список початкових залишків. Спершу затвердіть або відхиліть його в «Початкових залишках».",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByText(/нічого не прийнято/)).toBeVisible();

  await section(page, "Початкові залишки");
  await page
    .getByRole("article", { name: `Список ${source}` })
    .getByRole("button", { name: "Відкрити" })
    .click();
  await rejectList(page, "перелічимо заново");
  await expect(
    page.getByText(
      "Відхилено: перелічимо заново. Залишків цей список не змінив.",
    ),
  ).toBeVisible();

  await receiveOne();
  await expect(
    page.getByRole("heading", {
      name: "Прийшло 1 шт. · склад «Склад, що чекає» · Закупівля",
    }),
  ).toBeVisible();
});

test("a list typed is said on «Сьогодні» at once, its lines still to decide counted (stage 2, admin task list, P0-1, P0-2)", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  const read = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(`/api/v1/snapshots?store_id=${fixture.store_id}&limit=100`) &&
      response.ok(),
  );
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  // «Сьогодні» first, its lists read: fresh for a minute.
  await expect(
    page.getByRole("heading", { name: "Сьогодні", exact: true }),
  ).toBeVisible();
  await read;
  await section(page, "Початкові залишки");
  await typeList(page, fixture.opening_location_id, "Зошит на сьогодні", [
    `${coat} сірий 3 шт`,
    `${coat} сірий 2 шт`,
  ]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByRole("heading", { name: "Зошит на сьогодні" }),
  ).toBeVisible();
  // What waits in the store now, read as «Сьогодні» reads it.
  const answer = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&limit=100`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  const { items } = (await answer.json()) as {
    items: {
      store_id: string;
      status: string;
      ready_to_approve: boolean;
      summary: { pending: number; needs_review: number };
    }[];
  };
  const undecided = items
    .filter(
      (list) =>
        list.status === "IN_REVIEW" &&
        list.store_id === fixture.store_id &&
        !list.ready_to_approve,
    )
    .reduce(
      (n, list) => n + list.summary.pending + list.summary.needs_review,
      0,
    );
  expect(undecided).toBeGreaterThanOrEqual(2);
  // Back on «Сьогодні»: said at once, never a minute later.
  await menu(page)
    .getByRole("button", { name: "Сьогодні", exact: true })
    .click();
  const waiting = page.getByRole("region", { name: /^Чекає на вас/ });
  await expect(waiting).toBeVisible();
  const folded = waiting.getByRole("button", { name: /^\+ ще/ });
  if (await folded.isVisible()) await folded.click();
  await expect(
    waiting
      .locator(".today-tag", { hasText: "Доробіть початкові залишки" })
      .locator(".today-tag-meta", { hasText: "Основний · " }),
  ).toHaveText(
    `Основний · ${String(undecided)} ${
      undecided % 10 === 1 && undecided % 100 !== 11
        ? "рядок чекає"
        : [2, 3, 4].includes(undecided % 10) &&
            ![12, 13, 14].includes(undecided % 100)
          ? "рядки чекають"
          : "рядків чекають"
    } рішення`,
  );
  // The warehouse's own list waits no more for the journeys after.
  await noListWaits(page, fixture.opening_location_id);
});
