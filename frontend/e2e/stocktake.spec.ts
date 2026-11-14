import {
  test,
  expect,
  gridCell,
  countTaps,
  leaveNewModel,
  menu,
  more,
  newModelSheet,
  openModel,
  openStore,
  readsOf,
  refuseOnce,
  section,
} from "./fixtures";
import type { Locator, Page, Request, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A stocktake of a whole warehouse (owner decisions, 2026-10-10; ADR-0022),
 * against the real server, on «Ще» › «Товар» › «Інвентаризація» («Усе на
 * бірці» sections task list, P1-5), drawn in stage 2 (goods task list,
 * P0-2, P0-3): the open one a tag, its start and end a sheet, counting a
 * task's screen whose cells open the count's sheet with the app's keypad.
 * Each journey has a warehouse of its own: a stocktake stays open until it
 * is finished, and one is open per warehouse.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  stocktake_location_id: string;
  recount_location_id: string;
  refresh_location_id: string;
  kept_count_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

interface CountBody {
  store_id: string;
  command_id: string;
  product_variant_id: string;
  size_id: string;
  counted_quantity: number;
  expected_quantity: number;
}

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
  return `/#${new URLSearchParams({
    tgWebAppData: fields.toString(),
    ...(version === undefined ? {} : { tgWebAppVersion: version }),
  }).toString()}`;
}

/** «Інвентаризація», the warehouse chosen by its name, as a chip. */
async function enter(
  page: Page,
  location: string,
  version?: string,
): Promise<void> {
  await page.goto(launch(version));
  await openStore(page, "Основний MAIN");
  await section(page, "Інвентаризація");
  await page
    .getByRole("group", { name: "Склад" })
    .getByRole("button", { name: location, exact: true })
    .click();
}

/** «Почати інвентаризацію»'s sheet, once it takes taps: what it means said
 * first. */
async function startSheet(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog", {
    name: /^Почати інвентаризацію складу «.+»\?$/,
  });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(sheet.getByText("Склад продає далі.")).toBeVisible();
  return sheet;
}

/** Start the warehouse's stocktake: «Почати інвентаризацію», «Почати» —
 * two taps (goods task list, P0-2). */
async function begin(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Почати інвентаризацію", exact: true })
    .click();
  const sheet = await startSheet(page);
  await sheet.getByRole("button", { name: "Почати", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Інвентаризація · «/ }),
  ).toBeVisible();
}

function counting(page: Page): Locator {
  return page.getByRole("region", { name: "Інвентаризація", exact: true });
}

/** A size's cell on a model's tag of positions not counted. */
function cell(page: Page, size = "M"): Locator {
  return counting(page)
    .getByRole("button", { name: new RegExp(`^${size}, в обліку \\d+`) })
    .first();
}

/** What the cell says the ledger holds. */
async function onRecord(page: Page, size = "M"): Promise<number> {
  const said = await cell(page, size).getAttribute("aria-label");
  return Number(/в обліку (\d+)/.exec(said ?? "")?.[1]);
}

/** The count's sheet, once it takes taps. */
async function countSheet(page: Page): Promise<Locator> {
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** The cell tapped: its count's sheet. */
async function openCount(page: Page, size = "M"): Promise<Locator> {
  await cell(page, size).click();
  return countSheet(page);
}

/** A number typed on the sheet's keypad, a key at a time. */
async function type(sheet: Locator, count: number): Promise<void> {
  for (const key of String(count))
    await sheet.getByRole("button", { name: key, exact: true }).click();
}

/** The sheet's own «Записати · N шт.», outside Telegram. */
function record(sheet: Locator, count: number): Locator {
  return sheet.getByRole("button", {
    name: `Записати · ${String(count)} шт.`,
    exact: true,
  });
}

function toast(page: Page): Locator {
  return page.locator(".toast");
}

/** «Пораховані»'s row of a size. */
function countedRow(page: Page, size = "M"): Locator {
  return counting(page)
    .getByRole("list", { name: "Пораховані позиції" })
    .getByRole("listitem")
    .filter({ hasText: ` · ${size} — ` })
    .first();
}

function modes(page: Page): Locator {
  return counting(page).getByRole("group", { name: "Які позиції" });
}

function counts(page: Page): CountBody[] {
  const sent: CountBody[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && /\/counts$/.test(request.url()))
      sent.push(request.postDataJSON() as CountBody);
  });
  return sent;
}

/** No «од.» on the page: pieces are «шт.» (goods task list, P0-2, P2-1). */
async function noUnits(page: Page): Promise<void> {
  expect(await page.locator("body").innerText()).not.toMatch(/(^|\s)од\./);
}

test("a store with no warehouse to count says so, never who may (stage 2, goods task list, P1-5)", async ({
  page,
}) => {
  await page.route("**/api/v1/stock-locations?*", async (route) => {
    const response = await route.fetch();
    const places = (await response.json()) as { can_receive: boolean }[];
    await route.fulfill({
      response,
      json: places.map((place) => ({ ...place, can_receive: false })),
    });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Інвентаризація");
  await expect(
    page.getByText("Тут немає складу для інвентаризації.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Зверніться|може виправляти/)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Склад" })).toHaveCount(0);
});

test("«Інвентаризація»'s warehouses not read are the warning's plate with «Спробувати ще раз», which reads them again (audit after stage 2, goods P1-1)", async ({
  page,
}) => {
  let refused = true;
  await page.route("**/api/v1/stock-locations?*", async (route) => {
    if (!refused) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 503,
      json: { code: "UNAVAILABLE", message: "No" },
    });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Інвентаризація");
  const plate = page.locator(".stocktaking .read-failure");
  await expect(plate).toBeVisible();
  await expect(plate.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  refused = false;
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(page.getByRole("group", { name: "Склад" })).toBeVisible();
  await expect(plate).toHaveCount(0);
});

test("a warehouse is counted cell by cell, each difference applied at once, and finished in a sheet as one record whose stub says it (stage 2, goods task list, P0-2, P0-3)", async ({
  page,
}) => {
  const sent = counts(page);
  await enter(page, "Склад інвентаризації");
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25) — in the sheet.
  await refuseOnce(page, "**/api/v1/stocktakes", 422);
  await page
    .getByRole("button", { name: "Почати інвентаризацію", exact: true })
    .click();
  const start = await startSheet(page);
  await expect(start).toHaveAccessibleName(
    "Почати інвентаризацію складу «Склад інвентаризації»?",
  );
  await start.getByRole("button", { name: "Почати", exact: true }).click();
  await expect(
    start.getByText("Інвентаризацію не почато. Перевірте склад.", {
      exact: true,
    }),
  ).toBeVisible();
  // The server's own failure, or a request naming nothing: what was not
  // done, then the step — never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/stocktakes", 500);
  await start.getByRole("button", { name: "Почати", exact: true }).click();
  await expect(
    start.getByText(
      "Інвентаризацію не почато. Натисніть ще раз — повторити безпечно. Номер запиту: 3f9c2a7e.",
      { exact: true },
    ),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/stocktakes", 404);
  await start.getByRole("button", { name: "Почати", exact: true }).click();
  await expect(
    start.getByText("Інвентаризацію не почато. Перевірте склад.", {
      exact: true,
    }),
  ).toBeVisible();
  const listReads = readsOf(page, /\/api\/v1\/stocktakes$/);
  await refuseOnce(page, "**/api/v1/stocktakes", 409);
  await start.getByRole("button", { name: "Почати", exact: true }).click();
  await expect(
    start.getByText(
      "Інвентаризацію не почато: дані складу змінилися — перегляньте їх.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(listReads).toBeGreaterThan(0);
  await start.getByRole("button", { name: "Почати", exact: true }).click();
  // Straight to counting: a task's screen, the menu aside.
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Інвентаризація · «Склад інвентаризації»",
    }),
  ).toBeVisible();
  await expect(page.getByText(/^Почато о \d\d:\d\d · Оля$/)).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
  await expect(
    modes(page).getByRole("button", { name: /^Не пораховані \d+$/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const system = await onRecord(page);
  const sheet = await openCount(page);
  await expect(sheet).toHaveAccessibleName(/^Лоран шоколад 70(?:\.0)? см · M$/);
  await expect(
    sheet.getByText(
      `В обліку ${String(system)} · склад «Склад інвентаризації»`,
    ),
  ).toBeVisible();
  // Pieces: no comma, and the phone's keyboard never opens.
  await expect(sheet.getByRole("button", { name: "Кома" })).toHaveCount(0);
  await expect(sheet.getByLabel("Фактично, шт.")).toHaveAttribute(
    "inputmode",
    "none",
  );
  await type(sheet, system - 2);
  await expect(
    sheet.getByText(`${String(system)} → ${String(system - 2)} · −2`),
  ).toHaveClass(/\bshort\b/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/stocktake-mobile.png",
    fullPage: true,
  });
  await refuseOnce(page, "**/api/v1/stocktakes/*/counts", 422);
  await record(sheet, system - 2).click();
  await expect(
    sheet.getByText("Перевірте кількість. Нічого не записано.", {
      exact: true,
    }),
  ).toBeVisible();
  // The keypad empty, as after any refusal: counted again.
  await expect(sheet.getByLabel("Фактично, шт.")).toHaveValue("");
  await type(sheet, system - 2);
  await record(sheet, system - 2).click();
  // The model's only cell: the sheet goes, and a toast says it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toast(page)).toHaveText(
    new RegExp(
      ` · M — облік ${String(system)} → ${String(system - 2)} \\(−2\\)$`,
    ),
  );
  await expect(
    counting(page).getByText("Усі позиції з залишком пораховано."),
  ).toBeVisible();
  await expect(
    modes(page).getByRole("button", { name: "Пораховані 1" }),
  ).toBeVisible();
  // The model's tag gone with the cell the cursor went back to: no model
  // left, the cursor on the title (review, 2026-11-07).
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Інвентаризація · «Склад інвентаризації»",
    }),
  ).toBeFocused();

  // Goods the list does not show: a screen of their own, the menu still
  // aside, the cursor in the catalogue's search; one line under the title,
  // no list's wheel, no «Скасувати» (goods task list after stage 2, P1-2).
  const finder = counting(page).getByRole("button", {
    name: "Знайшли товар, якого немає в списку",
  });
  await finder.click();
  const found = page.getByRole("region", {
    name: "Товар, якого немає в списку",
  });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Товар, якого немає в списку",
    }),
  ).toBeVisible();
  await expect(counting(page)).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByLabel("Пошук у каталозі")).toBeFocused();
  await expect(found.locator("p.hint")).toHaveText(
    "Якщо товар уже є в обліку цього складу, сервер скаже, скільки саме.",
  );
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Скасувати" })).toHaveCount(0);
  // «← Інвентаризація» back to the count, the cursor where it was pressed.
  await page
    .getByRole("button", {
      name: "Назад до інвентаризації складу «Склад інвентаризації»",
    })
    .click();
  await expect(finder).toBeFocused();
  await expect(found).toHaveCount(0);
  // One the catalogue has not is added from here, in the sheet «Нова
  // модель» over the screen; left, the screen is as it was (stage 2, goods
  // task list, P0-1).
  await finder.click();
  const missing = `Немає в каталозі ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Пошук у каталозі").fill(missing);
  await page
    .getByRole("button", { name: `Додати нову модель «${missing}»` })
    .click();
  const adding = await newModelSheet(page);
  await expect(adding.getByLabel("Як записано")).toHaveValue(missing);
  await leaveNewModel(adding);
  await expect(page.getByLabel("Пошук у каталозі")).toHaveValue(missing);
  await page
    .getByRole("button", {
      name: "Назад до інвентаризації складу «Склад інвентаризації»",
    })
    .click();
  await expect(finder).toBeFocused();
  // Four taps and the number: «Знайшли товар…», the model, the cell, the
  // number's one key, the sheet's button.
  const taps = await countTaps(page);
  await finder.click();
  await page.getByLabel("Пошук у каталозі").fill("лоран");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  // The model chosen: its name, and the organisation's sizes as cells, each
  // saying what the ledger holds as the list read it.
  await expect(found.locator(".receive-model p")).toHaveText(/Лоран шоколад/);
  const sizes = found.getByRole("group", { name: "Розмір" });
  await expect(sizes.getByRole("button").first()).toHaveAccessibleName(
    /^\S+, в обліку 0$/,
  );
  const box = await sizes
    .getByRole("button", { name: "L, в обліку 0", exact: true })
    .boundingBox();
  expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(60);
  expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(60);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/stocktake-found-goods.png",
    fullPage: true,
  });
  await sizes
    .getByRole("button", { name: "L, в обліку 0", exact: true })
    .click();
  const foundSheet = await countSheet(page);
  await type(foundSheet, 1);
  await expect(foundSheet.getByText("0 → 1 · +1")).not.toHaveClass(/\bshort\b/);
  await record(foundSheet, 1).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toast(page)).toHaveText(/ · L — облік 0 → 1 \(\+1\)$/);
  // Back on the count, the cursor on «Знайшли товар…» where it was pressed.
  await expect(found).toHaveCount(0);
  await expect(finder).toBeFocused();
  expect(await taps()).toBe(4 + 1);

  // «Пораховані», newest first, each with whom and when.
  await modes(page).getByRole("button", { name: "Пораховані 2" }).click();
  await expect(countedRow(page)).toContainText(
    `${String(system)} → ${String(system - 2)} (−2)`,
  );
  await expect(countedRow(page)).toContainText(/Оля, \d\d:\d\d/);
  await expect(countedRow(page, "L")).toContainText("0 → 1 (+1)");
  await expect(
    counting(page)
      .getByRole("list", { name: "Пораховані позиції" })
      .getByRole("listitem")
      .first(),
  ).toContainText(" · L — ");
  await noUnits(page);

  // Each count travels with the balance it was counted against: the refused
  // one first, then the same count as a new command.
  expect(sent).toHaveLength(3);
  expect(sent[1]?.command_id).not.toBe(sent[0]?.command_id);
  expect({ ...sent[0], command_id: null }).toEqual({
    ...sent[1],
    command_id: null,
  });
  expect(sent[1]).toMatchObject({
    product_variant_id: fixture.variant_id,
    size_id: fixture.size_id,
    counted_quantity: system - 2,
    expected_quantity: system,
  });
  expect(sent[2]).toMatchObject({ counted_quantity: 1, expected_quantity: 0 });
  expect(Object.keys(sent[1] ?? {}).sort()).toEqual([
    "command_id",
    "counted_quantity",
    "expected_quantity",
    "product_variant_id",
    "size_id",
    "store_id",
  ]);

  // A coat in hand that turns out to be held: the server names how many,
  // and the sheet counts against that.
  await modes(page)
    .getByRole("button", { name: /^Не пораховані \d+$/ })
    .click();
  await finder.click();
  await page.getByLabel("Пошук у каталозі").fill("лоран");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await found
    .getByRole("button", { name: "M, в обліку 0", exact: true })
    .click();
  const held = await countSheet(page);
  await type(held, 1);
  await record(held, 1).click();
  await expect(held.getByRole("alert")).toContainText(
    `Цей товар уже є в обліку цього складу: ${String(system - 2)} шт.`,
  );
  await expect(
    held.getByText(
      `В обліку ${String(system - 2)} · склад «Склад інвентаризації»`,
    ),
  ).toBeVisible();
  await expect(held.getByLabel("Фактично, шт.")).toHaveValue("");
  await type(held, system - 2);
  await expect(held.getByText("Збігається з обліком.")).toBeVisible();
  await record(held, system - 2).click();
  await expect(toast(page)).toHaveText(
    new RegExp(` · M — збігається з обліком \\(${String(system - 2)}\\)$`),
  );

  // «Завершити» in the header, its sheet: the differences large, then
  // «Так, завершити» — two taps.
  await page.getByRole("button", { name: "Завершити", exact: true }).click();
  const end = page.getByRole("dialog", {
    name: "Завершити інвентаризацію складу «Склад інвентаризації»?",
  });
  await expect(end).toHaveAttribute("data-ready", "");
  // Its «not now» is every confirming sheet's «Скасувати», never «Ще ні»:
  // the sheet closes, nothing finished (audit 2026-11-13, frame P2-6).
  await expect(end.getByRole("button", { name: "Ще ні" })).toHaveCount(0);
  await end.getByRole("button", { name: "Скасувати", exact: true }).click();
  await expect(end).toHaveCount(0);
  await page.getByRole("button", { name: "Завершити", exact: true }).click();
  await expect(end).toHaveAttribute("data-ready", "");
  await expect(end.locator(".finish-sum")).toHaveText([
    "Нестача 2 шт.",
    "Надлишок 1 шт.",
  ]);
  await expect(
    end.getByText(
      "Після завершення рахувати в цій інвентаризації вже не можна. Бот надішле підсумок власнику мережі, якщо завершує не власник.",
    ),
  ).toBeVisible();
  await noUnits(page);
  // The server's own failure, or a request naming nothing: what was not
  // done, then the step — never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/stocktakes/*/finish", 500);
  await end.getByRole("button", { name: "Так, завершити" }).click();
  await expect(
    end.getByText(
      "Інвентаризацію не завершено. Натисніть ще раз — повторити безпечно. Номер запиту: 3f9c2a7e.",
      { exact: true },
    ),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/stocktakes/*/finish", 404);
  await end.getByRole("button", { name: "Так, завершити" }).click();
  await expect(
    end.getByText("Інвентаризацію не завершено. Перегляньте підрахунок.", {
      exact: true,
    }),
  ).toBeVisible();
  const recordReads = readsOf(page, /\/api\/v1\/stocktakes\/[^/]+$/);
  await refuseOnce(page, "**/api/v1/stocktakes/*/finish", 409);
  await end.getByRole("button", { name: "Так, завершити" }).click();
  await expect(
    end.getByText(
      "Інвентаризацію не завершено: дані складу змінилися — перегляньте їх.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(recordReads).toBeGreaterThan(0);
  await end.getByRole("button", { name: "Так, завершити" }).click();
  // The result: its title with the check, and the stub knotted — nothing
  // left to check.
  await expect(
    page.getByRole("heading", { level: 1, name: "Інвентаризацію завершено" }),
  ).toBeFocused();
  const done = page.getByRole("region", { name: "Інвентаризацію завершено" });
  await expect(done.locator(".stub")).toHaveClass(/\bstub-settled\b/);
  await expect(done.locator(".stub-line")).toHaveText([
    "Пораховано позицій: 2",
    "Нестача 2 шт. · 1 позиція",
    "Надлишок 1 шт. · 1 позиція",
  ]);
  const differences = done.getByRole("list", { name: "Розбіжності" });
  await expect(differences.getByRole("listitem")).toHaveCount(2);
  await expect(differences).toContainText(" — −2 шт. (пораховано");
  await expect(differences).toContainText(" — +1 шт. (пораховано 1, Оля)");
  await noUnits(page);
  // A tap sooner than 0.7 s after the result came was the finish's second
  // half, and is let go: waited out.
  await page.waitForTimeout(700);
  await done.getByRole("button", { name: "До інвентаризації" }).click();

  // The entry: no open stocktake, «Почати інвентаризацію» again, and the
  // finished one first in «Попередні».
  await expect(menu(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Почати інвентаризацію", exact: true }),
  ).toBeVisible();
  const history = page.getByRole("list", { name: "Попередні інвентаризації" });
  await expect(history.getByRole("listitem").first()).toContainText(
    "Нестача 2 шт. · надлишок 1 шт.",
  );
  await expect(history.getByRole("listitem").first()).toContainText(
    /Оля · \d\d:\d\d/,
  );
  await history
    .getByRole("button", { name: "Показати розбіжності" })
    .first()
    .click();
  await expect(
    history
      .getByRole("list", { name: "Розбіжності" })
      .first()
      .getByRole("listitem"),
  ).toHaveCount(2);
  // The model's grid holds what was counted.
  await menu(page).getByRole("button", { name: "Продаж", exact: true }).click();
  await openModel(page, "Лоран", /^Лоран шоколад 70(?:\.0)? см$/);
  await expect(
    gridCell(page, fixture.stocktake_location_id, fixture.size_id),
  ).toHaveText(String(system - 2));
});

test("a position sold while it was counted is refused and counted again, alone, the sheet staying", async ({
  page,
}) => {
  // The list shows one more than the warehouse holds, as it would if a sale
  // had taken a coat after the list was read — and goes on showing it, as
  // a read again that comes late would: the sheet counts against what the
  // server saw under its lock (review, 2026-10-10).
  await page.route("**/api/v1/stocktakes/*/positions?**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { size_label: string; quantity: number }[];
    };
    for (const item of body.items)
      if (item.size_label === "M") item.quantity += 1;
    await route.fulfill({ response, json: body });
  });
  const sent = counts(page);
  await enter(page, "Склад, де рахують знову");
  await begin(page);
  const shown = await onRecord(page);
  const sheet = await openCount(page);
  await type(sheet, shown - 1);
  await record(sheet, shown - 1).click();
  await expect(sheet.getByRole("alert")).toContainText(
    `облік змінився: було ${String(shown)}, тепер ${String(shown - 1)}`,
  );
  await expect(sheet.getByRole("alert")).toContainText("Нічого не записано.");
  await expect(
    sheet.getByText(
      `В обліку ${String(shown - 1)} · склад «Склад, де рахують знову»`,
    ),
  ).toBeVisible();
  await expect(sheet.getByLabel("Фактично, шт.")).toHaveValue("");
  await type(sheet, shown - 1);
  await expect(sheet.getByText("Збігається з обліком.")).toBeVisible();
  await record(sheet, shown - 1).click();
  await expect(toast(page)).toHaveText(
    new RegExp(` · M — збігається з обліком \\(${String(shown - 1)}\\)$`),
  );
  await expect(
    page.getByRole("heading", { name: "Підрахунок ще не підтверджено" }),
  ).toHaveCount(0);
  expect(sent.map((body) => body.expected_quantity)).toEqual([
    shown,
    shown - 1,
  ]);
});

test("a count whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  const keys: (string | null)[] = [];
  const commands: string[] = [];
  await page.route("**/api/v1/stocktakes/*/counts", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    commands.push((route.request().postDataJSON() as CountBody).command_id);
    if (keys.length === 1) {
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });
  await enter(page, "Склад, де підрахунок губиться");
  await begin(page);
  const system = await onRecord(page);
  const sheet = await openCount(page);
  await type(sheet, system - 1);
  await record(sheet, system - 1).click();
  // The sheet goes: on «Інвентаризація», its own screen, the count's stub,
  // still attached (stage 2, orders task list, P0-1).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect(kept.locator(".stub-head")).toHaveText("Ще не підтверджено");
  await expect(
    kept.getByRole("heading", { name: "Підрахунок ще не підтверджено" }),
  ).toBeVisible();
  // Nothing else happens until this is settled, and no sums are frozen
  // without it: the finish waits, and so do the cells; the menu is aside.
  await expect(
    page.getByRole("button", { name: "Завершити", exact: true }),
  ).toBeDisabled();
  await expect(cell(page)).toBeDisabled();
  await expect(menu(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Перевірити результат підрахунку" })
    .click();
  // Confirmed: torn off, once (В-ЗП2 (а)).
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect(
    kept.getByRole("heading", { name: "Підрахунок записано один раз" }),
  ).toBeVisible();
  await expect(
    kept.getByText(`Облік ${String(system)} → ${String(system - 1)}.`, {
      exact: true,
    }),
  ).toBeVisible();
  expect(keys[1]).toBe(keys[0]);
  expect(commands[1]).toBe(commands[0]);
  await expect(
    page.getByRole("button", { name: "Завершити", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Назад до інвентаризації" }).click();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
});

test("a stocktake is offered only to whoever may correct stock, and read it", async ({
  page,
}) => {
  // Either right taken: a stocktake reads the warehouse it counts (review,
  // 2026-11-01).
  for (const right of ["inventory:adjust", "inventory:view"]) {
    await page.unrouteAll({ behavior: "wait" });
    await page.route("**/api/v1/me", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        stores: { permissions: string[] }[];
      };
      for (const store of body.stores)
        store.permissions = store.permissions.filter((p) => p !== right);
      await route.fulfill({ response, json: body });
    });
    // Opened afresh: its rights read again.
    await page.goto("about:blank");
    await page.goto(launch());
    await openStore(page, "Основний MAIN");
    // No «Інвентаризація» in «Ще» › «Товар»; its other rows stay (sections
    // task list, P1-5).
    await more(page);
    const goods = page.getByRole("navigation", { name: "Ще" });
    await expect(
      goods.getByRole("button", { name: "Прийшов товар", exact: true }),
    ).toBeVisible();
    await expect(
      goods.getByRole("button", { name: "Інвентаризація", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Почати інвентаризацію" }),
    ).toHaveCount(0);
  }
});

test("a balance read again is the one a count is made against", async ({
  page,
}) => {
  // The list first shows one more than the warehouse holds, as when a sale
  // took a coat after it was read; read again, it shows what is held.
  let stale = true;
  await page.route("**/api/v1/stocktakes/*/positions?**", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { size_label: string; quantity: number }[];
    };
    if (stale)
      for (const item of body.items)
        if (item.size_label === "M") item.quantity += 1;
    await route.fulfill({ response, json: body });
  });
  const sent = counts(page);
  await enter(page, "Склад, де облік оновлюється");
  await begin(page);
  const shown = await onRecord(page);
  // The sheet open on the balance shown.
  const sheet = await openCount(page);
  await expect(
    sheet.getByText(`В обліку ${String(shown)} · склад`, { exact: false }),
  ).toBeVisible();
  stale = false;
  const reread = page.waitForResponse((r) => r.url().includes("/positions?"));
  // The phone comes back to the app: its lists are read again, and the
  // open sheet counts against what is read.
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await reread;
  await expect(
    sheet.getByText(`В обліку ${String(shown - 1)} · склад`, { exact: false }),
  ).toBeVisible();
  await type(sheet, shown - 1);
  await expect(sheet.getByText("Збігається з обліком.")).toBeVisible();
  await record(sheet, shown - 1).click();
  await expect(toast(page)).toHaveText(
    new RegExp(` · M — збігається з обліком \\(${String(shown - 1)}\\)$`),
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    counted_quantity: shown - 1,
    expected_quantity: shown - 1,
  });
});

type Size = "S" | "M" | "L" | "XL" | "unknown";

/** A position as a stubbed stocktake lists it. */
interface Stubbed {
  variant: string;
  name: string;
  size: Size;
  qty: number;
  held: number;
}

/** A model of four sizes, listed as the server orders them — by its inner
 * numbers, not their order — and a coat whose size is not known. */
function marselAndLoran(): Stubbed[] {
  const marsel = randomUUID();
  const loran = randomUUID();
  return [
    { variant: marsel, name: "Марсель молочний", size: "XL", qty: 2, held: 0 },
    { variant: marsel, name: "Марсель молочний", size: "S", qty: 3, held: 0 },
    { variant: marsel, name: "Марсель молочний", size: "L", qty: 1, held: 0 },
    { variant: marsel, name: "Марсель молочний", size: "M", qty: 4, held: 1 },
    { variant: loran, name: "Лоран шоколад", size: "unknown", qty: 2, held: 0 },
  ];
}

/** Fifty-two positions: two models of one size, then twenty-five of two —
 * so the fiftieth is a model's first size once the first model is gone —
 * and before them one that holds nothing until goods arrive. */
function many(): Stubbed[] {
  const one = (name: string): Stubbed => ({
    variant: randomUUID(),
    name,
    size: "M",
    qty: 1,
    held: 0,
  });
  const models = Array.from({ length: 25 }, (_, at) => {
    const variant = randomUUID();
    const name = `Модель ${String(at + 1).padStart(2, "0")}`;
    return (["S", "M"] as const).map((code): Stubbed => ({
      variant,
      name,
      size: code,
      qty: 2,
      held: 0,
    }));
  });
  return [
    { ...one("Модель 0"), qty: 0 },
    one("Модель А"),
    one("Модель Б"),
    ...models.flat(),
  ];
}

/** A stocktake the server answers for in this journey alone: its
 * positions read fifty at a time, each count answered as the server
 * answers it, its sums kept, and its finish. Nothing reaches the server's
 * warehouse. */
function stubbed(
  page: Page,
  positions: readonly Stubbed[] = marselAndLoran(),
): Promise<{
  sent: CountBody[];
  started: () => number;
  /** Counted by someone else, as it stands. */
  elsewhere: (name: string, code: Size) => void;
  /** Goods received into it meanwhile. */
  arrive: (name: string, code: Size, qty: number) => void;
}> {
  const stocktake = randomUUID();
  const size: Record<Size, string> = {
    S: randomUUID(),
    M: randomUUID(),
    L: randomUUID(),
    XL: randomUUID(),
    unknown: randomUUID(),
  };
  const keyOf = (p: Stubbed): string => `${p.variant}:${size[p.size]}`;
  const ledger = new Map<string, number>(
    positions.map((p) => [keyOf(p), p.qty]),
  );
  const last = new Map<
    string,
    { counted: number; net: number; at: string; order: number }
  >();
  let open = false;
  let starts = 0;
  let order = 0;
  let finished: Date | null = null;
  const began = new Date();
  began.setHours(10, 20, 0, 0);
  const sent: CountBody[] = [];
  const item = (p: Stubbed): Record<string, unknown> => {
    const count = last.get(keyOf(p));
    return {
      product_variant_id: p.variant,
      size_id: size[p.size],
      display_name: p.name,
      size_label: p.size === "unknown" ? "UNKNOWN" : p.size,
      size_is_unknown: p.size === "unknown",
      quantity: ledger.get(keyOf(p)) ?? 0,
      reserved_quantity: p.held,
      count: count
        ? {
            counted_quantity: count.counted,
            net_delta: count.net,
            counted_by: "Оля",
            counted_at: count.at,
          }
        : null,
    };
  };
  const uncounted = (): Stubbed[] =>
    positions.filter(
      (p) => !last.has(keyOf(p)) && (ledger.get(keyOf(p)) ?? 0) > 0,
    );
  const nets = (): number[] => [...last.values()].map((count) => count.net);
  const record = (): Record<string, unknown> => ({
    id: stocktake,
    location_id: fixture.stocktake_location_id,
    location_name: "Склад інвентаризації",
    store_id: fixture.store_id,
    started_by: "Тетяна",
    started_at: began.toISOString(),
    finished_by: finished ? "Тетяна" : null,
    finished_at: finished?.toISOString() ?? null,
    sums: {
      counted_positions: last.size,
      unchecked_positions: uncounted().length,
      shortage_units: nets()
        .filter((net) => net < 0)
        .reduce((sum, net) => sum - net, 0),
      shortage_positions: nets().filter((net) => net < 0).length,
      surplus_units: nets()
        .filter((net) => net > 0)
        .reduce((sum, net) => sum + net, 0),
      surplus_positions: nets().filter((net) => net > 0).length,
    },
  });
  const answer = async (route: Route): Promise<void> => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    if (path === "/stocktakes" && request.method() === "POST") {
      open = true;
      starts += 1;
      await route.fulfill({ status: 201, json: record() });
    } else if (path === "/stocktakes")
      // Its own warehouse's: «Сьогодні» reads each warehouse's apart.
      await route.fulfill({
        json: {
          items:
            open &&
            url.searchParams.get("location_id") ===
              fixture.stocktake_location_id
              ? [record()]
              : [],
        },
      });
    else if (path === `/stocktakes/${stocktake}`)
      await route.fulfill({ json: record() });
    else if (path === `/stocktakes/${stocktake}/finish`) {
      finished = new Date();
      await route.fulfill({ json: record() });
    } else if (path === `/stocktakes/${stocktake}/positions`) {
      const state = url.searchParams.get("state");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const items =
        state === "uncounted"
          ? uncounted()
          : state === "differences"
            ? positions.filter((p) => (last.get(keyOf(p))?.net ?? 0) !== 0)
            : positions
                .filter((p) => last.has(keyOf(p)))
                .sort(
                  (a, b) =>
                    (last.get(keyOf(b))?.order ?? 0) -
                    (last.get(keyOf(a))?.order ?? 0),
                );
      await route.fulfill({
        json: {
          items: items.slice(offset, offset + limit).map(item),
          has_more: offset + limit < items.length,
        },
      });
    } else if (path === `/stocktakes/${stocktake}/counts`) {
      const body = request.postDataJSON() as CountBody;
      sent.push(body);
      const key = `${body.product_variant_id}:${body.size_id}`;
      const before = ledger.get(key) ?? 0;
      const held = positions.find((p) => keyOf(p) === key)?.held ?? 0;
      if (held > 0 && body.counted_quantity !== before) {
        await route.fulfill({
          status: 422,
          json: {
            code: "VALIDATION_FAILED",
            message: "Release reservations before correcting this stock key",
            details: {
              reason: "RESERVED",
              reserved: held,
              size_id: body.size_id,
            },
          },
        });
        return;
      }
      const delta = body.counted_quantity - before;
      ledger.set(key, body.counted_quantity);
      order += 1;
      const at = new Date(Date.now() + order * 1000).toISOString();
      last.set(key, {
        counted: body.counted_quantity,
        net: (last.get(key)?.net ?? 0) + delta,
        at,
        order,
      });
      await route.fulfill({
        status: 201,
        json: {
          id: randomUUID(),
          stocktake_id: stocktake,
          product_variant_id: body.product_variant_id,
          size_id: body.size_id,
          counted_quantity: body.counted_quantity,
          quantity_before: before,
          quantity_delta: delta,
          counted_at: at,
        },
      });
    } else await route.fallback();
  };
  const elsewhere = (name: string, code: Size): void => {
    const p = positions.find((x) => x.name === name && x.size === code);
    if (!p) throw new Error(`${name} · ${code}: no such position`);
    order += 1;
    last.set(keyOf(p), {
      counted: ledger.get(keyOf(p)) ?? 0,
      net: 0,
      at: new Date(Date.now() + order * 1000).toISOString(),
      order,
    });
  };
  const arrive = (name: string, code: Size, qty: number): void => {
    const p = positions.find((x) => x.name === name && x.size === code);
    if (!p) throw new Error(`${name} · ${code}: no such position`);
    ledger.set(keyOf(p), qty);
  };
  return (async () => {
    await page.route("**/api/v1/stocktakes**", answer);
    // The organization's order of sizes, receiving's to read.
    await page.route("**/api/v1/catalog/sizes?**", async (route) => {
      await route.fulfill({
        json: (["S", "M", "L", "XL"] as const).map((code) => ({
          size_id: size[code],
          code,
          system: "ALPHA",
        })),
      });
    });
    return { sent, started: () => starts, elsewhere, arrive };
  })();
}

/** Telegram 8.0, the journey's own: what the app tells it, and its
 * MainButton and «Назад» pressed. Before the page opens. */
async function telegram(page: Page): Promise<{
  told: (event: string) => Promise<unknown[]>;
  main: () => Promise<unknown>;
  buzzes: () => Promise<unknown[]>;
  pressMain: () => Promise<void>;
  pressBack: () => Promise<void>;
  closing: () => Promise<unknown>;
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
  const told = (event: string): Promise<unknown[]> =>
    page.evaluate(
      (wanted) =>
        (window as unknown as { told: [string, unknown][] }).told
          .filter(([name]) => name === wanted)
          .map(([, data]) => data),
      event,
    );
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
    told,
    main: async () => (await told("web_app_setup_main_button")).at(-1) ?? null,
    buzzes: () => told("web_app_trigger_haptic_feedback"),
    pressMain: () => press("main_button_pressed"),
    pressBack: () => press("back_button_pressed"),
    closing: async () => (await told("web_app_setup_closing_behavior")).at(-1),
  };
}

test("inside Telegram a model of four sizes is one tag, its cells in the sizes' order, counted in five taps and four numbers: the sheet goes on to the next cell, round from the one tapped, and closes after the last; the menu aside, kept upright, closing asked only while a number is typed (stage 2, goods task list, P0-2, P0-3)", async ({
  page,
}) => {
  const { told, main, buzzes, pressMain, pressBack, closing } =
    await telegram(page);
  await page.setViewportSize({ width: 360, height: 780 });
  const server = await stubbed(page);
  await enter(page, "Склад інвентаризації", "8.0");

  // None open: «Почати інвентаризацію», Telegram's, set on entry.
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Почати інвентаризацію",
  });
  await expect(
    page.getByRole("button", { name: "Почати інвентаризацію" }),
  ).toHaveCount(0);
  await pressMain();
  const start = page.getByRole("dialog", {
    name: "Почати інвентаризацію складу «Склад інвентаризації»?",
  });
  // A press carried from «Почати інвентаризацію» is let go: pressed as
  // soon as «Почати» is set, well within the 0.7 s (review, 2026-11-07).
  await expect
    .poll(main, { intervals: [10] })
    .toMatchObject({ is_visible: true, text: "Почати" });
  await pressMain();
  await expect(start).toHaveAttribute("data-ready", "");
  expect(server.started()).toBe(0);
  await pressMain();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Інвентаризація · «Склад інвентаризації»",
    }),
  ).toBeVisible();
  expect(server.started()).toBe(1);
  expect(await buzzes()).toContainEqual({
    type: "notification",
    notification_type: "success",
  });
  await expect(page.getByText("Почато о 10:20 · Тетяна")).toBeVisible();
  // A task's screen: the menu aside, kept upright, no MainButton of its own
  // — «Завершити» is the header's quiet one.
  await expect(menu(page)).toHaveCount(0);
  await expect
    .poll(async () => (await told("web_app_toggle_orientation_lock")).at(-1))
    .toEqual({ locked: true });
  await expect
    .poll(async () => ((await main()) as { is_visible?: boolean }).is_visible)
    .toBe(false);
  await expect(closing()).resolves.not.toEqual({ need_confirmation: true });

  // One tag a model; its sizes in the organization's order; the reserve's
  // pin and the size not known on their cells.
  const tags = counting(page).locator(".model-tag");
  await expect(tags).toHaveCount(2);
  const marsel = counting(page).getByRole("group", {
    name: "Марсель молочний",
  });
  const cells = marsel.locator(".count-cell");
  await expect(cells).toHaveText([
    "Sв обліку 3",
    "Mв обліку 41",
    "Lв обліку 1",
    "XLв обліку 2",
  ]);
  await expect(cells.nth(1)).toHaveAccessibleName("M, в обліку 4, у резерві 1");
  await expect(cells.nth(1).locator(".size-held")).toHaveText("1");
  const loran = counting(page).getByRole("group", { name: "Лоран шоколад" });
  await expect(loran.locator(".count-cell")).toHaveAccessibleName(
    "розмір невідомий, в обліку 2",
  );
  await expect(loran.locator(".size-letter")).toHaveText("?");
  await expect(loran.getByText("? — розмір невідомий")).toBeAttached();
  await expect(
    modes(page).getByRole("button", { name: "Не пораховані 5" }),
  ).toHaveAttribute("aria-pressed", "true");
  // At 360 the cells wrap, 8 apart, and nothing is wider than the phone.
  const box = async (
    at: number,
  ): Promise<{ x: number; y: number; w: number }> => {
    const b = await cells.nth(at).boundingBox();
    return { x: b?.x ?? 0, y: b?.y ?? 0, w: b?.width ?? 0 };
  };
  const [s, m, xl] = [await box(0), await box(1), await box(3)];
  expect(Math.round(m.x - (s.x + s.w))).toBe(8);
  expect(xl.y).toBeGreaterThan(s.y);
  await page.screenshot({
    path: "test-results/stocktake-cells-360.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);

  // Tap 1: M, a size in the middle. Its sheet, its reserve said;
  // Telegram's «Записати», held until a number is typed; closing asked only
  // while one is.
  const before = (await buzzes()).length;
  await cells.nth(1).click();
  const sheet = await countSheet(page);
  await expect(sheet).toHaveAccessibleName("Марсель молочний · M");
  await expect(sheet.getByRole("button", { name: /^Записати/ })).toHaveCount(0);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Записати",
  });
  expect((await buzzes()).slice(before)).toEqual([
    { type: "selection_change" },
  ]);
  await expect(
    sheet.getByText(
      "У резерві замовлень: 1. Якщо кількість не збігається, виправити облік можна після видачі або скасування замовлення.",
    ),
  ).toBeVisible();
  await type(sheet, 3);
  await expect(sheet.getByText("4 → 3 · −1")).toHaveClass(/\bshort\b/);
  await expect.poll(main).toMatchObject({
    is_active: true,
    text: "Записати · 3 шт.",
  });
  await expect.poll(closing).toEqual({ need_confirmation: true });
  // A difference where an order holds it is refused, as a correction is:
  // the sheet stays, the keypad empty, a warning felt.
  const refusedFrom = (await buzzes()).length;
  await pressMain();
  await expect(sheet.getByRole("alert")).toHaveText(
    "На цей товар є резерв замовлення (1 шт.). Якщо кількість не збігається, виправити облік можна після видачі або скасування замовлення. Нічого не записано.",
  );
  await expect(sheet).toHaveAccessibleName("Марсель молочний · M");
  await expect(sheet.getByLabel("Фактично, шт.")).toHaveValue("");
  expect((await buzzes()).slice(refusedFrom)).toContainEqual({
    type: "notification",
    notification_type: "warning",
  });
  await expect.poll(closing).toEqual({ need_confirmation: false });
  // Tap 2: M as the ledger holds it; on to L, said — to a reader with the
  // cell it goes on to.
  await type(sheet, 4);
  await expect(sheet.getByText("Збігається з обліком.")).toBeVisible();
  await pressMain();
  await expect(sheet).toHaveAccessibleName("Марсель молочний · L");
  await expect(sheet.getByRole("status")).toHaveText(
    "Записано: Марсель молочний · M — збігається з обліком (4) Далі: L.",
  );
  await expect.poll(closing).toEqual({ need_confirmation: false });
  // Tap 3: L, one short — the line in the warning's colour.
  await type(sheet, 0);
  await expect(sheet.getByText("1 → 0 · −1")).toHaveClass(/\bshort\b/);
  await pressMain();
  await expect(sheet).toHaveAccessibleName("Марсель молочний · XL");
  // Tap 4: XL; the sheet goes round to S, the first.
  await type(sheet, 2);
  await pressMain();
  await expect(sheet).toHaveAccessibleName("Марсель молочний · S");
  // Tap 5: S, the last: the sheet closes, its MainButton gone, a toast.
  await type(sheet, 3);
  await pressMain();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toast(page)).toHaveText(
    "Записано: Марсель молочний · S — збігається з обліком (3)",
  );
  await expect
    .poll(async () => ((await main()) as { is_visible?: boolean }).is_visible)
    .toBe(false);
  // Each count recorded lightly felt, one command a size.
  expect(
    (await buzzes()).filter(
      (buzz) =>
        JSON.stringify(buzz) ===
        JSON.stringify({ type: "impact", impact_style: "light" }),
    ),
  ).toHaveLength(4);
  expect(server.sent.map((body) => body.counted_quantity)).toEqual([
    3, 4, 0, 2, 3,
  ]);
  expect(server.sent.map((body) => body.expected_quantity)).toEqual([
    4, 4, 1, 2, 3,
  ]);
  await expect(tags).toHaveCount(1);
  await expect(
    modes(page).getByRole("button", { name: "Не пораховані 1" }),
  ).toBeVisible();
  // The model's tag gone, the cursor on the next model's cell (review,
  // 2026-11-07).
  await expect(loran.locator(".count-cell")).toBeFocused();

  // The size not known is only ever counted down.
  await loran.locator(".count-cell").click();
  const unknown = await countSheet(page);
  await expect(unknown).toHaveAccessibleName(
    "Лоран шоколад · розмір невідомий",
  );
  await type(unknown, 3);
  await expect(unknown.getByRole("alert")).toHaveText(
    "Облік товару з невідомим розміром можна лише зменшити.",
  );
  await expect.poll(main).toMatchObject({ is_active: false });
  // Telegram's «Назад» closes the sheet only — and the last sheet's toast
  // does not come back with it (review, 2026-11-07).
  await pressBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Read once: a toast back would stand its 4 s, outlasting a retried check.
  await page.waitForTimeout(300);
  expect(await toast(page).count()).toBe(0);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Інвентаризація · «Склад інвентаризації»",
    }),
  ).toBeVisible();
  await expect.poll(closing).toEqual({ need_confirmation: false });

  // «Пораховані», newest first; «Перерахувати» in the same sheet.
  await modes(page).getByRole("button", { name: "Пораховані 4" }).click();
  const rows = counting(page)
    .getByRole("list", { name: "Пораховані позиції" })
    .locator(".counted-what");
  await expect(rows).toHaveText([
    "Марсель молочний · S — 3, збігається",
    "Марсель молочний · XL — 2, збігається",
    "Марсель молочний · L — 1 → 0 (−1)",
    "Марсель молочний · M — 4, збігається",
  ]);
  await counting(page)
    .getByRole("button", { name: "Перерахувати: Марсель молочний · L" })
    .click();
  const again = await countSheet(page);
  await expect(
    again.getByText("В обліку 0 · склад «Склад інвентаризації»"),
  ).toBeVisible();
  await type(again, 1);
  await pressMain();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rows.nth(0)).toHaveText("Марсель молочний · L — 1, збігається");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "test-results/stocktake-dark-360.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);

  // Telegram's «Назад» leaves counting for the entry: the open one a tag,
  // no MainButton there.
  await pressBack();
  const open = page.getByRole("article", {
    name: /^Триває з 10:20 · Тетяна$/,
  });
  await expect(open).toBeVisible();
  await expect(open).toContainText("Пораховано 4 · розбіжностей немає");
  await expect(menu(page)).toBeVisible();
  await expect
    .poll(async () => (await told("web_app_toggle_orientation_lock")).at(-1))
    .toEqual({ locked: false });
  await expect
    .poll(async () => ((await main()) as { is_visible?: boolean }).is_visible)
    .toBe(false);
  await open.getByRole("button", { name: "Продовжити" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Інвентаризація · «Склад інвентаризації»",
    }),
  ).toBeFocused();
});

test("a long count inside Telegram: «Показати ще» waits while the list is read again and reads the next fifty, a model across two pages one tag; the cursor goes on to the next model; a cell counted meanwhile by someone else is passed; the finish's MainButton, and a press carried onto the result's let go (stage 2, goods task list, P0-2, P0-3; review, 2026-11-07)", async ({
  page,
}) => {
  const { main, pressMain } = await telegram(page);
  const server = await stubbed(page, many());
  // The list's reads, held while the journey says.
  let gate: Promise<void> | null = null;
  let release = (): void => undefined;
  await page.route("**/api/v1/stocktakes/*/positions?**", async (route) => {
    if (gate) await gate;
    await route.fallback();
  });
  await enter(page, "Склад інвентаризації", "8.0");
  await expect.poll(main).toMatchObject({
    is_visible: true,
    text: "Почати інвентаризацію",
  });
  await pressMain();
  await expect(page.getByRole("dialog")).toHaveAttribute("data-ready", "");
  await pressMain();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Інвентаризація · «Склад інвентаризації»",
    }),
  ).toBeVisible();

  // Fifty positions read: two models of one size, twenty-four of two.
  const tags = counting(page).locator(".model-tag");
  await expect(tags).toHaveCount(26);
  const more = counting(page).getByRole("button", { name: "Показати ще" });
  await expect(more).toBeEnabled();

  // A model's only cell counted; while the list is read again «Показати
  // ще» waits — asked meanwhile, it would be read past a position that
  // moved up.
  const first = counting(page).getByRole("group", { name: "Модель А" });
  await first.locator(".count-cell").click();
  const sheet = await countSheet(page);
  await type(sheet, 1);
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await pressMain();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(more).toBeDisabled();
  release();
  gate = null;
  await expect(first).toHaveCount(0);
  // Its tag gone, the cursor on the next model's first cell.
  await expect(
    counting(page)
      .getByRole("group", { name: "Модель Б" })
      .locator(".count-cell"),
  ).toBeFocused();

  // The fiftieth now «Модель 25»'s S, its M on the next page: one tag once
  // that is read.
  const split = counting(page).getByRole("group", { name: "Модель 25" });
  await expect(split.locator(".count-cell")).toHaveText(["Sв обліку 2"]);
  await expect(more).toBeEnabled();
  // Goods arrive meanwhile for a position before them all: the next page
  // read from its place begins with «Модель 25»'s S again — shown once.
  server.arrive("Модель 0", "M", 1);
  // That page fails once (audit 2026-11-13, goods P1-1): the fifty read
  // stand, one «Спробувати ще раз» at the foot where «Показати ще» stood.
  let failNext = true;
  await page.route(
    "**/api/v1/stocktakes/*/positions?**offset=50**",
    async (route) => {
      if (failNext) {
        failNext = false;
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL", message: "boom" },
        });
        return;
      }
      await route.fallback();
    },
  );
  const shownBefore = await tags.count();
  await more.click();
  const foot = counting(page).locator(".read-failure");
  await expect(foot).toBeVisible();
  await expect(tags).toHaveCount(shownBefore);
  await expect(split.locator(".count-cell")).toHaveText(["Sв обліку 2"]);
  await expect(more).toHaveCount(0);
  await expect(
    counting(page).getByRole("button", { name: "Спробувати ще раз" }),
  ).toHaveCount(1);
  // Its retry reads that page alone.
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/positions?")) asked.push(request.url());
  });
  await foot.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(split).toHaveCount(1);
  await expect(split.locator(".count-cell")).toHaveText([
    "Sв обліку 2",
    "Mв обліку 2",
  ]);
  await expect(foot).toHaveCount(0);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("state=uncounted");
  expect(asked[0]).toContain("offset=50");
  // The cursor on the first position it brought.
  await expect(split.locator(".count-cell").nth(1)).toBeFocused();
  await expect(more).toHaveCount(0);
  await expect(tags).toHaveCount(26);

  // A cell counted by someone else while this sheet is open: the list read
  // again, it is passed, and the sheet closes after its own cell.
  await counting(page)
    .getByRole("group", { name: "Модель 01" })
    .locator(".count-cell")
    .first()
    .click();
  const own = await countSheet(page);
  await expect(own).toHaveAccessibleName("Модель 01 · S");
  server.elsewhere("Модель 01", "M");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  // The screen behind is inert: its tag found by its markup.
  await expect(
    page
      .locator(".model-tag")
      .filter({ hasText: /^Модель 01/ })
      .locator(".count-cell"),
  ).toHaveCount(1);
  await type(own, 2);
  await pressMain();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toast(page)).toHaveText(
    "Записано: Модель 01 · S — збігається з обліком (2)",
  );
  expect(server.sent.map((body) => body.counted_quantity)).toEqual([1, 2]);

  // Two cells of a model counted while the list's read is late: the sheet
  // goes on to M, and after it closes — S recorded in it already, though
  // the list still shows it.
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await counting(page)
    .getByRole("group", { name: "Модель 02" })
    .locator(".count-cell")
    .first()
    .click();
  const both = await countSheet(page);
  await expect(both).toHaveAccessibleName("Модель 02 · S");
  await type(both, 2);
  await pressMain();
  await expect(both).toHaveAccessibleName("Модель 02 · M");
  await type(both, 2);
  await pressMain();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  release();
  gate = null;
  expect(server.sent.map((body) => body.counted_quantity)).toEqual([
    1, 2, 2, 2,
  ]);

  // «Завершити», its sheet, Telegram's «Так, завершити».
  await page.getByRole("button", { name: "Завершити", exact: true }).click();
  const end = page.getByRole("dialog", {
    name: "Завершити інвентаризацію складу «Склад інвентаризації»?",
  });
  await expect(end).toHaveAttribute("data-ready", "");
  await expect(end.locator(".finish-sum")).toHaveText(["Розбіжностей немає"]);
  await expect(
    end.getByText("Не перевірено позицій: 48 — їхні залишки не зміняться."),
  ).toBeVisible();
  await expect
    .poll(main)
    .toMatchObject({ is_visible: true, text: "Так, завершити" });
  await pressMain();
  const result = page.getByRole("heading", {
    level: 1,
    name: "Інвентаризацію завершено",
  });
  await expect(result).toBeFocused();
  // The press's second tap, landing on «До інвентаризації» as soon as it
  // is set, is let go: the result stays.
  await expect
    .poll(main, { intervals: [10] })
    .toMatchObject({ is_visible: true, text: "До інвентаризації" });
  await pressMain();
  const done = page.getByRole("region", { name: "Інвентаризацію завершено" });
  await expect(done.locator(".stub-line")).toHaveText([
    "Пораховано позицій: 5",
    "Розбіжностей немає",
  ]);
  await expect(
    done.getByText("Не перевірено позицій: 48 — їхні залишки не змінювались."),
  ).toBeVisible();
  await expect(result).toBeVisible();
  // Pressed again after it, the entry: the finished one first in
  // «Попередні» at once, from what the finish answered — never «Продовжити»
  // while the list is read again (held here) — and «Почати інвентаризацію»
  // Telegram's again.
  let listed = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    listed = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.endsWith("/stocktakes") &&
      url.searchParams.has("location_id"),
    async (route) => {
      await held;
      await route.fallback();
    },
  );
  await page.waitForTimeout(700);
  await pressMain();
  const history = page.getByRole("list", { name: "Попередні інвентаризації" });
  await expect(history.getByRole("listitem").first()).toContainText(
    "Розбіжностей немає · не перевірено 48",
  );
  await expect(history.getByRole("listitem").first()).toContainText(
    /Тетяна · \d\d:\d\d/,
  );
  await expect(page.getByRole("button", { name: "Продовжити" })).toHaveCount(0);
  listed();
  await expect
    .poll(main)
    .toMatchObject({ is_visible: true, text: "Почати інвентаризацію" });
});

test("«Пораховані»'s next page refused: the fifty read stand, one «Спробувати ще раз» at their foot and no «Показати ще»; it reads that page alone, the cursor on the first row it brings; the list read again and refused, the plate over the rows, «Показати ще» waiting under them (audit 2026-11-13, goods P1-1)", async ({
  page,
}) => {
  await stubbed(page, many());
  // A hundred and three counted, served here: nothing is counted on the
  // stub.
  const rows = Array.from({ length: 103 }, (_, at) => ({
    product_variant_id: randomUUID(),
    size_id: randomUUID(),
    display_name: `Пораховано ${String(at + 1).padStart(3, "0")}`,
    size_label: "M",
    size_is_unknown: false,
    quantity: 1,
    reserved_quantity: 0,
    count: {
      counted_quantity: 1,
      net_delta: 0,
      counted_by: "Оля",
      counted_at: new Date().toISOString(),
    },
  }));
  let refuse: "next" | "all" | null = "next";
  const asked: string[] = [];
  await page.route(
    "**/api/v1/stocktakes/*/positions?**state=counted**",
    async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") ?? "0");
      asked.push(`offset=${String(offset)}`);
      if (
        (refuse === "next" && offset === 50) ||
        (refuse === "all" && offset === 0)
      ) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL", message: "boom" },
        });
        return;
      }
      await route.fulfill({
        json: {
          items: rows.slice(offset, offset + 50),
          has_more: offset + 50 < rows.length,
        },
      });
    },
  );
  await enter(page, "Склад інвентаризації");
  await begin(page);
  await modes(page)
    .getByRole("button", { name: /^Пораховані/ })
    .click();
  const list = counting(page).getByRole("list", {
    name: "Пораховані позиції",
  });
  await expect(list.getByRole("listitem")).toHaveCount(50);
  const more = counting(page).getByRole("button", { name: "Показати ще" });
  await more.click();
  const foot = counting(page).locator(".read-failure");
  await expect(foot).toBeVisible();
  // The rows read stand, and the plate is after them.
  await expect(list.getByRole("listitem")).toHaveCount(50);
  await expect(more).toHaveCount(0);
  const last = await list.getByRole("listitem").last().boundingBox();
  const plate = await foot.boundingBox();
  expect(last && plate && plate.y > last.y).toBe(true);
  refuse = null;
  asked.length = 0;
  await foot.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(100);
  await expect(foot).toHaveCount(0);
  expect(asked).toEqual(["offset=50"]);
  await expect(
    counting(page).getByRole("button", {
      name: "Перерахувати: Пораховано 051 · M",
    }),
  ).toBeFocused();
  await expect(more).toBeEnabled();
  // Read again whole and refused: the plate over the rows, which stand.
  refuse = "all";
  await page.evaluate(() => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
  const over = counting(page).locator(".read-failure");
  await expect(over).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(100);
  const first = await list.getByRole("listitem").first().boundingBox();
  const overBox = await over.boundingBox();
  expect(first && overBox && overBox.y < first.y).toBe(true);
  await expect(more).toBeDisabled();
});

test("a finished stocktake's «Розбіжності», a next page refused: those read stand, one «Спробувати ще раз» at their foot and no «Показати ще»; it reads that page alone (audit 2026-11-13, goods P1-1)", async ({
  page,
}) => {
  const day = new Date(Date.now() - 86_400_000);
  const finished = {
    id: randomUUID(),
    location_id: fixture.stocktake_location_id,
    location_name: "Склад інвентаризації",
    store_id: fixture.store_id,
    started_by: "Тетяна",
    started_at: day.toISOString(),
    finished_by: "Тетяна",
    finished_at: day.toISOString(),
    sums: {
      counted_positions: 55,
      unchecked_positions: 0,
      shortage_units: 55,
      shortage_positions: 55,
      surplus_units: 0,
      surplus_positions: 0,
    },
  };
  const differences = Array.from({ length: 55 }, (_, at) => ({
    product_variant_id: randomUUID(),
    size_id: randomUUID(),
    display_name: `Модель ${String(at + 1)}`,
    size_label: "M",
    size_is_unknown: false,
    quantity: 1,
    reserved_quantity: 0,
    count: {
      counted_quantity: 0,
      net_delta: -1,
      counted_by: "Оля",
      counted_at: new Date().toISOString(),
    },
  }));
  let failing = true;
  const asked: string[] = [];
  await page.route("**/api/v1/stocktakes**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/stocktakes"))
      await route.fulfill({
        json: {
          items:
            url.searchParams.get("location_id") ===
            fixture.stocktake_location_id
              ? [finished]
              : [],
        },
      });
    else if (path.endsWith("/positions")) {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      asked.push(`offset=${String(offset)}`);
      if (failing && offset === 50) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL", message: "boom" },
        });
        return;
      }
      await route.fulfill({
        json: {
          items: differences.slice(offset, offset + 50),
          has_more: offset + 50 < differences.length,
        },
      });
    } else await route.fallback();
  });
  await enter(page, "Склад інвентаризації");
  const history = page.getByRole("list", { name: "Попередні інвентаризації" });
  await history
    .locator(":scope > li")
    .first()
    .getByRole("button", { name: "Показати розбіжності" })
    .click();
  const shown = history.getByRole("list", { name: "Розбіжності" });
  await page.getByRole("button", { name: "Ще 50", exact: true }).click();
  await expect(shown.getByRole("listitem")).toHaveCount(50);
  await page.getByRole("button", { name: "Показати ще" }).click();
  const foot = history.locator(".read-failure");
  await expect(foot).toBeVisible();
  await expect(shown.getByRole("listitem")).toHaveCount(50);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  failing = false;
  asked.length = 0;
  await foot.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(shown.getByRole("listitem")).toHaveCount(55);
  await expect(foot).toHaveCount(0);
  expect(asked).toEqual(["offset=50"]);
});

test("«Попередні»: the last three and «Ще N»; a finished one's differences five and «Ще N», each in the words of before (stage 2, goods task list, P0-2)", async ({
  page,
}) => {
  const zero = {
    counted_positions: 1,
    unchecked_positions: 0,
    shortage_units: 0,
    shortage_positions: 0,
    surplus_units: 0,
    surplus_positions: 0,
  };
  const finished = Array.from({ length: 5 }, (_, at) => {
    const day = new Date(Date.now() - (at + 1) * 86_400_000);
    return {
      id: randomUUID(),
      location_id: fixture.stocktake_location_id,
      location_name: "Склад інвентаризації",
      store_id: fixture.store_id,
      started_by: "Тетяна",
      started_at: day.toISOString(),
      finished_by: "Тетяна",
      finished_at: day.toISOString(),
      sums:
        at === 0
          ? {
              counted_positions: 7,
              unchecked_positions: 140,
              shortage_units: 3,
              shortage_positions: 3,
              surplus_units: 4,
              surplus_positions: 4,
            }
          : zero,
    };
  });
  const differences = Array.from({ length: 7 }, (_, at) => ({
    product_variant_id: randomUUID(),
    size_id: randomUUID(),
    display_name: `Модель ${String(at + 1)}`,
    size_label: "M",
    size_is_unknown: false,
    quantity: 1,
    reserved_quantity: 0,
    count: {
      counted_quantity: 1,
      net_delta: at < 3 ? -1 : 1,
      counted_by: "Оля",
      counted_at: new Date().toISOString(),
    },
  }));
  await page.route("**/api/v1/stocktakes**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/stocktakes"))
      await route.fulfill({
        json: {
          items:
            url.searchParams.get("location_id") ===
            fixture.stocktake_location_id
              ? finished
              : [],
        },
      });
    else if (path.endsWith("/positions"))
      await route.fulfill({ json: { items: differences, has_more: false } });
    else await route.fallback();
  });
  await enter(page, "Склад інвентаризації");
  const history = page.getByRole("list", { name: "Попередні інвентаризації" });
  const rows = history.locator(":scope > li");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText(
    "Нестача 3 шт. · надлишок 4 шт. · не перевірено 140",
  );
  await expect(rows.nth(1)).toContainText("Розбіжностей немає");
  await expect(
    rows.nth(1).getByRole("button", { name: "Показати розбіжності" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ще 2", exact: true }).click();
  await expect(rows).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "Ще 2", exact: true }),
  ).toHaveCount(0);
  await rows
    .first()
    .getByRole("button", { name: "Показати розбіжності" })
    .click();
  const shown = rows.first().getByRole("list", { name: "Розбіжності" });
  await expect(shown.getByRole("listitem")).toHaveCount(5);
  await expect(shown.getByRole("listitem").first()).toHaveText(
    "Модель 1 · M — −1 шт. (пораховано 1, Оля)",
  );
  await page.getByRole("button", { name: "Ще 2", exact: true }).click();
  await expect(shown.getByRole("listitem")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "Показати ще" })).toHaveCount(
    0,
  );
  await noUnits(page);
});
