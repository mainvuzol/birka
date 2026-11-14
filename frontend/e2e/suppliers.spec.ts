import {
  test,
  expect,
  addSupplier,
  countTaps,
  expectResultHeading,
  more,
  openStore,
  pickSupplier,
  readsOf,
  refuseOnce,
  rowNamed,
  section,
  sections,
  holdReads,
  under14,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Returns to a supplier (owner decisions, 2026-10-01): the owner and
 * managers send goods back from a warehouse as one document with a list, or
 * a confirmed unit from «Брак»; pick the supplier from the network's list or
 * add one on the spot; and cancel a return whole, saying why.
 *
 * «Постачальникам» lists the returns as rows; «+» opens «Повернути
 * постачальнику», after «Прийшов товар» — the warehouse as chips, the
 * till's search, steppers, the MainButton — a row opens the return, and its
 * cancel asks why in a sheet; «Список постачальників» is a screen (stage 2,
 * money task list, P0-4).
 *
 * In the stores' own network: Ганна works at «Центр», with the network's
 * warehouse alone; Петро at «Ринок», which has its own too, and its «Брак».
 */
interface Fixture {
  network_centre_seller_telegram_user_id: string;
  network_market_seller_telegram_user_id: string;
  network_centre_store_id: string;
  network_market_store_id: string;
  network_shared_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const hanna = fixture.network_centre_seller_telegram_user_id;
const petro = fixture.network_market_seller_telegram_user_id;

function initData(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Тест"}`,
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

/** Бірка as this person; in `theme`'s colours; in Telegram `version`. */
async function openAs(
  page: Page,
  telegramUserId: string,
  theme?: Record<string, string>,
  version?: string,
): Promise<void> {
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  const hash = new URLSearchParams({ tgWebAppData: initData(telegramUserId) });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  if (version) hash.set("tgWebAppVersion", version);
  await page.goto(`/#${hash.toString()}`);
}

async function headersOf(
  page: Page,
  telegramUserId: string,
): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

interface Coat {
  model: string;
  variant: string;
  size: string;
  /** Every size's, in the order given. */
  sizes: string[];
}

/** A model of its own, `quantity` of each of its sizes received by `who`
 * at `store`; the first size its own. */
async function received(
  page: Page,
  who: string,
  store: string,
  quantity: number,
  codes: string[] = ["M"],
): Promise<Coat> {
  const headers = await headersOf(page, who);
  const model = `Постачальнику ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: store,
      concept: model,
      variant: { color: "беж" },
      sizes: codes.map((code) => ({ system: "ALPHA", code })),
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const size = product.sizes[0]?.size_id ?? "";
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: store,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: product.sizes.map((one) => ({
        product_variant_id: product.product_variant_id,
        size_id: one.size_id,
        quantity,
        acquisition_type: "PURCHASE",
        unit_cost: null,
      })),
      notes: null,
    },
  });
  expect(receipt.status()).toBe(201);
  return {
    model,
    variant: product.product_variant_id,
    size,
    sizes: product.sizes.map((one) => one.size_id),
  };
}

async function available(page: Page, coat: Coat): Promise<number> {
  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.network_centre_store_id}&location_id=${fixture.network_shared_location_id}&limit=100&offset=0`,
    { headers: await headersOf(page, hanna) },
  );
  const { items } = (await response.json()) as {
    items: { product_variant_id: string; available_quantity: number }[];
  };
  return (
    items.find((item) => item.product_variant_id === coat.variant)
      ?.available_quantity ?? 0
  );
}

function posts(page: Page, ending: string): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith(ending))
      seen.bodies.push(request.postDataJSON());
  });
  return seen;
}

/** «Повернути постачальнику», by «Постачальникам»'s «+», at «Центр»: its
 * one warehouse said in a line, nothing to choose. */
async function newReturn(page: Page): Promise<void> {
  await openAs(page, hanna);
  await openStore(page, "Центр CENTRE");
  await section(page, "Постачальникам");
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Повернути товар постачальнику" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Повернути постачальнику" }),
  ).toBeVisible();
  await expect(
    page.getByText("Склад «Склад мережі»", { exact: true }),
  ).toBeVisible();
}

/** «Повернути постачальнику»'s fields, under its heading. */
function returnForm(page: Page): Locator {
  return page.getByRole("group", { name: "Повернення постачальнику" });
}

/** A model found by the till's search, the server's (P0-4), and chosen. */
async function chooseModel(page: Page, coat: Coat): Promise<void> {
  await page.getByRole("searchbox", { name: "Пошук моделі" }).fill(coat.model);
  await page
    .getByRole("list", { name: "Товар на складі" })
    .getByRole("button", { name: new RegExp(`^${coat.model}`) })
    .click();
  await expect(
    page.getByRole("button", { name: `Змінити модель ${coat.model}` }),
  ).toBeVisible();
}

/** A size's «+», `times` over. */
async function tapMore(page: Page, size: string, times: number): Promise<void> {
  const plus = page
    .getByRole("group", { name: new RegExp(`^Розмір ${size}, вільно `) })
    .getByRole("button", { name: "Більше" });
  for (let at = 0; at < times; at += 1) await plus.click();
}

/** «Повернути постачальнику · N шт.», the dock's one button outside
 * Telegram. */
function sendBack(page: Page, units: number): Locator {
  return page.getByRole("button", {
    name: `Повернути постачальнику · ${String(units)} шт.`,
    exact: true,
  });
}

/** A return's row on «Постачальникам», by its supplier. */
function returnRow(page: Page, supplier: string): Locator {
  return page
    .getByRole("list", { name: "Повернення постачальникам" })
    .getByRole("button", { name: new RegExp(`^${supplier} `) });
}

/** A supplier on the network's list, through the API: its id. */
async function aSupplier(page: Page, name: string): Promise<string> {
  const added = await page.request.post("/api/v1/suppliers", {
    headers: await headersOf(page, hanna),
    data: { store_id: fixture.network_centre_store_id, name, phone: null },
  });
  expect(added.status()).toBe(201);
  return ((await added.json()) as { id: string }).id;
}

/** A supplier added from a field (stage 2, money task list, P0-3) — the
 * return form's, or «Брак»'s — with a phone: added, or found on the list,
 * it is picked. */
async function addOne(page: Page, name: string, of?: Locator): Promise<void> {
  await addSupplier(page, name, "067 123 45 67", of ? { of } : {});
}

/** The return's field: the supplier picked, as it shows it. */
function supplierField(page: Page): Locator {
  return returnForm(page).getByRole("button", { name: /^Постачальник / });
}

test("a return's result keeps «← Постачальникам» and Telegram's «Назад», as its form and an invoice's result: each leads to «Постачальникам», «Готово» too (audit 2026-11-13, money P2-2 (б))", async ({
  page,
}) => {
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
  const told = (event: string): Promise<unknown> =>
    page.evaluate(
      (wanted) =>
        (window as unknown as { told: [string, unknown][] }).told
          .filter(([name]) => name === wanted)
          .map(([, data]) => data)
          .at(-1) ?? null,
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
  const coat = await received(page, hanna, fixture.network_centre_store_id, 3);
  const supplier = `Назад ${randomUUID().slice(0, 6)}`;
  await aSupplier(page, supplier);
  await openAs(page, hanna, undefined, "8.0");
  await openStore(page, "Центр CENTRE");
  await section(page, "Постачальникам");
  const list = page.getByRole("heading", {
    name: "Постачальникам",
    exact: true,
  });
  const result = page.getByRole("heading", {
    name: `Повернено постачальнику «${supplier}»: 1 шт.`,
  });
  const arrow = page.getByRole("button", {
    name: "Постачальникам",
    exact: true,
  });
  /** One unit of M back, by Telegram's MainButton: its result. */
  const returnOne = async (): Promise<void> => {
    await page
      .locator(".screen-title")
      .getByRole("button", { name: "Повернути товар постачальнику" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Повернути постачальнику" }),
    ).toBeVisible();
    await pickSupplier(page, supplier, { of: returnForm(page) });
    await chooseModel(page, coat);
    await tapMore(page, "M", 1);
    await expect
      .poll(() => told("web_app_setup_main_button"))
      .toMatchObject({
        is_visible: true,
        is_active: true,
        text: "Повернути постачальнику · 1 шт.",
      });
    await press("main_button_pressed");
    await expect(result).toBeFocused();
    // On the result: «← Постачальникам» over its title, Telegram's «Назад»
    // shown, «Готово» the MainButton.
    await expect(arrow).toBeVisible();
    await expect
      .poll(() => told("web_app_setup_back_button"))
      .toEqual({ is_visible: true });
    await expect
      .poll(() => told("web_app_setup_main_button"))
      .toMatchObject({ is_visible: true, text: "Готово" });
  };

  // Telegram's «Назад»: «Постачальникам».
  await returnOne();
  await press("back_button_pressed");
  await expect(list).toBeVisible();
  await expect(result).toHaveCount(0);
  await expect(returnRow(page, supplier)).toHaveCount(1);
  // «← Постачальникам»: the same.
  await returnOne();
  await arrow.click();
  await expect(list).toBeVisible();
  await expect(returnRow(page, supplier)).toHaveCount(2);
  // «Готово»: the same.
  await returnOne();
  await press("main_button_pressed");
  await expect(list).toBeVisible();
  await expect(returnRow(page, supplier)).toHaveCount(3);
});

test("goods go back to a supplier from a warehouse, and come back when it is cancelled", async ({
  page,
}) => {
  const coat = await received(page, hanna, fixture.network_centre_store_id, 4);
  const supplier = `Беларді ${randomUUID().slice(0, 6)}`;
  const sent = posts(page, "/api/v1/supplier-returns");
  await newReturn(page);
  // The menu aside while a return is made.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toHaveCount(0);
  await expect(sendBack(page, 0)).toBeDisabled();
  await addOne(page, supplier, returnForm(page));
  await expect(supplierField(page)).toHaveAccessibleName(
    `Постачальник ${supplier} · 067 123 45 67`,
  );
  // Picked: the cursor in the search.
  await expect(
    page.getByRole("searchbox", { name: "Пошук моделі" }),
  ).toBeFocused();
  // The search's own read, sent once the typing settles, answered before
  // the refusal's re-read is counted: on CI it left with the send and took
  // the re-read's place (2026-11-09).
  const searched = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/api/v1/catalog/stock-options") &&
      url.searchParams.get("query") === coat.model
    );
  });
  await chooseModel(page, coat);
  // Its one size, its free units the most: «вільно 4», «+» held there.
  const size = page.getByRole("group", { name: "Розмір M, вільно 4" });
  await expect(size).toContainText("вільно 4");
  await tapMore(page, "M", 4);
  await expect(size.getByRole("textbox", { name: "M, шт." })).toHaveValue("4");
  await expect(size.getByRole("button", { name: "Більше" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // Typed, no more than is free either.
  await size.getByRole("textbox", { name: "M, шт." }).fill("9");
  await expect(size.getByRole("textbox", { name: "M, шт." })).toHaveValue("4");
  await size.getByRole("button", { name: "Менше" }).click();
  await size.getByRole("button", { name: "Менше" }).click();
  await expect(size.getByRole("textbox", { name: "M, шт." })).toHaveValue("2");
  await page.getByLabel("Примітка (необов’язково)").fill("не продалось");
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25); what was counted stays,
  // and the warehouse is read again.
  await searched;
  const stockReads = readsOf(page, /\/api\/v1\/catalog\/stock-options$/);
  await refuseOnce(page, "**/api/v1/supplier-returns", 409);
  await sendBack(page, 2).click();
  await expect(
    page.getByText("Не записано: дані повернення змінилися — перегляньте їх.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(stockReads).toBeGreaterThan(0);
  const listed = page.getByRole("region", { name: "У поверненні" });
  await expect(listed).toContainText(coat.model);
  await expect(listed).toContainText("2 шт.");
  // A request naming nothing: what was not done, then what to check —
  // never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/supplier-returns", 404);
  await sendBack(page, 2).click();
  await expect(
    page.getByText("Не записано. Перевірте повернення.", { exact: true }),
  ).toBeVisible();
  await sendBack(page, 2).click();
  // Its stub: what went back, from where; «Готово» back to the list. Its
  // «← Постачальникам» stays, as the form's (audit 2026-11-13, money P2-2
  // (б)).
  await expect(
    page.getByRole("heading", {
      name: `Повернено постачальнику «${supplier}»: 2 шт.`,
    }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Постачальникам", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stub-recorded")).toContainText(
    "склад «Склад мережі»",
  );
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  // The two refused above, then the same return as a new command.
  expect(sent.bodies).toHaveLength(3);
  expect({ ...(sent.bodies[0] as object), command_id: null }).toEqual({
    ...(sent.bodies[2] as object),
    command_id: null,
  });
  expect(sent.bodies.slice(2)).toEqual([
    {
      command_id: expect.any(String) as string,
      store_id: fixture.network_centre_store_id,
      location_id: fixture.network_shared_location_id,
      supplier_id: expect.any(String) as string,
      lines: [
        { product_variant_id: coat.variant, size_id: coat.size, quantity: 2 },
      ],
      note: "не продалось",
    },
  ]);
  expect(await available(page, coat)).toBe(2);

  // Back on the list, its heading takes the cursor. Its row: the supplier,
  // how many, the day, where from and who, its goods.
  await expect(
    page.getByRole("heading", { name: "Постачальникам", exact: true }),
  ).toBeFocused();
  const row = returnRow(page, supplier);
  await expect(row).toContainText("2 шт.");
  await expect(row).toContainText("склад «Склад мережі» · Тест");
  await expect(row).toContainText(new RegExp(`${coat.model}.*, M × 2`));
  await row.click();
  await expect(
    page.getByRole("heading", { name: supplier, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Що повернули" })).toHaveText(
    new RegExp(`^${coat.model}.*, M × 2$`),
  );
  await expect(page.getByText("не продалось", { exact: true })).toBeVisible();
  // Cancelled in a sheet that asks why: refused, its words on the screen,
  // and the return read again.
  await page.getByRole("button", { name: "Скасувати повернення" }).click();
  const ask = page.getByRole("dialog", { name: "Скасувати повернення" });
  await expect(ask).toHaveAttribute("data-ready", "");
  await expect(ask).toContainText(
    "Товар повернеться на склад «Склад мережі». Скасувати можна лише раз.",
  );
  await expect(
    ask.getByRole("button", { name: "Так, скасувати повернення" }),
  ).toBeDisabled();
  await ask.getByLabel("Чому скасовуємо").fill("постачальник не взяв");
  const cancelReads = readsOf(page, /\/api\/v1\/supplier-returns$/);
  await refuseOnce(page, "**/api/v1/supplier-returns/*/cancel", 409);
  await ask.getByRole("button", { name: "Так, скасувати повернення" }).click();
  await expect(ask).toHaveCount(0);
  await expect(
    page.getByText("Не записано: дані повернення змінилися — перегляньте їх.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(cancelReads).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Скасувати повернення" }).click();
  await expect(ask).toHaveAttribute("data-ready", "");
  await ask.getByLabel("Чому скасовуємо").fill("постачальник не взяв");
  await ask.getByRole("button", { name: "Так, скасувати повернення" }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator(".supplier-return-cancelled")).toContainText(
    /^Скасовано.* · постачальник не взяв · Тест$/,
  );
  await expect(
    page.getByRole("button", { name: "Скасувати повернення" }),
  ).toHaveCount(0);
  expect(await available(page, coat)).toBe(4);
  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  await expect(row.locator(".sticker")).toHaveText("Скасовано");

  // The suppliers, a screen of their own; one edited in its sheet, refused
  // for a reason the screen does not name: its own words; a conflict reads
  // the list again (owner decision, 2026-10-25).
  await page.getByRole("button", { name: "Список постачальників" }).click();
  await expect(
    page.getByRole("heading", { name: "Список постачальників" }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(supplier);
  const list = page.getByRole("list", { name: "Постачальники" });
  await expect(list.locator(".supplier-row")).toHaveCount(1);
  await expect(list.locator(".supplier-row .t-meta")).toHaveText(
    "067 123 45 67",
  );
  await list.locator(".supplier-row").click();
  const edit = page.getByRole("dialog", { name: "Змінити постачальника" });
  await expect(edit).toHaveAttribute("data-ready", "");
  await expect(edit.getByLabel("Назва")).toHaveValue(supplier);
  await refuseOnce(page, "**/api/v1/suppliers/*", 422);
  await edit.getByRole("button", { name: "Зберегти" }).click();
  await expect(
    edit.getByText("Постачальника не збережено. Перевірте назву й телефон.", {
      exact: true,
    }),
  ).toBeVisible();
  const supplierReads = readsOf(page, /\/api\/v1\/suppliers$/);
  await refuseOnce(page, "**/api/v1/suppliers/*", 409);
  await edit.getByRole("button", { name: "Зберегти" }).click();
  await expect(
    edit.getByText(
      "Постачальника не збережено: дані змінилися — перегляньте їх.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect.poll(supplierReads).toBeGreaterThan(0);
  // The server's own failure, or a request naming nothing: what was not
  // done, then the step — never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/suppliers/*", 500);
  await edit.getByRole("button", { name: "Зберегти" }).click();
  await expect(
    edit.getByText(
      "Постачальника не збережено. Натисніть ще раз — повторити безпечно. Номер запиту: 3f9c2a7e.",
      { exact: true },
    ),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/suppliers/*", 404);
  await edit.getByRole("button", { name: "Зберегти" }).click();
  await expect(
    edit.getByText("Постачальника не збережено. Перевірте назву й телефон.", {
      exact: true,
    }),
  ).toBeVisible();
  // Saved: the list shows it as it is now; nothing deletes a supplier.
  await edit.getByLabel("Телефон").fill("067 000 00 01");
  await edit.getByRole("button", { name: "Зберегти" }).click();
  await expect(edit).toHaveCount(0);
  await expect(list.locator(".supplier-row .t-meta")).toHaveText(
    "067 000 00 01",
  );
  await expect(page.getByRole("button", { name: /Видалити/ })).toHaveCount(0);
});

test("goods held for an order are not offered to go back", async ({ page }) => {
  const coat = await received(page, hanna, fixture.network_centre_store_id, 1);
  const held = await page.request.post("/api/v1/orders", {
    headers: await headersOf(page, hanna),
    data: {
      store_id: fixture.network_centre_store_id,
      command_id: randomUUID(),
      carrier: "NOVA_POSHTA",
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          source_location_id: fixture.network_shared_location_id,
          quantity: 1,
          unit_price: "1500.00",
        },
      ],
    },
  });
  expect(held.status()).toBe(201);
  await newReturn(page);
  await page.getByRole("searchbox", { name: "Пошук моделі" }).fill(coat.model);
  await expect(
    page.getByText(
      `За «${coat.model}» на складі «Склад мережі» вільного товару немає.`,
    ),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Товар на складі" })).toHaveCount(
    0,
  );
});

test("a model is found by the server's search over the warehouse chosen, from two letters; two warehouses are chips, none chosen", async ({
  page,
}) => {
  // «Ринок» takes returns from two warehouses: chips, none chosen.
  const coat = await received(page, petro, fixture.network_market_store_id, 2);
  const searched: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/catalog/stock-options?"))
      searched.push(request.url());
  });
  await openAs(page, petro);
  await openStore(page, /^Ринок MARKET/);
  await section(page, "Постачальникам");
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Повернути товар постачальнику" })
    .click();
  const places = page.getByRole("group", { name: "Склад", exact: true });
  // In the store's own order.
  await expect(places.getByRole("button")).toHaveText([
    "Склад ринку",
    "Склад мережі",
  ]);
  await expect(places.locator("[aria-pressed=true]")).toHaveCount(0);
  // No search before a warehouse is chosen.
  await expect(
    page.getByRole("searchbox", { name: "Пошук моделі" }),
  ).toHaveCount(0);
  await places.getByRole("button", { name: "Склад мережі" }).click();
  // Its name's last letters, typed: asked of the server, never filtered
  // from the rows read — a model on any page of the warehouse is found.
  const tail = coat.model.slice(-6);
  await page.getByRole("searchbox", { name: "Пошук моделі" }).fill(tail);
  await expect
    .poll(() =>
      searched.some(
        (url) =>
          url.includes(`location_id=${fixture.network_shared_location_id}`) &&
          url.includes(`query=${encodeURIComponent(tail)}`),
      ),
    )
    .toBe(true);
  const found = page
    .getByRole("list", { name: "Товар на складі" })
    .getByRole("button");
  await expect(found).toHaveCount(1);
  await expect(found).toHaveText(new RegExp(`^${coat.model}.*M 2$`));
  // Another warehouse chosen is another return: what was counted goes.
  await found.click();
  await tapMore(page, "M", 1);
  await expect(page.locator(".receive-total")).toHaveText(
    "1 шт. · склад «Склад мережі»",
  );
  await places.getByRole("button", { name: "Склад ринку" }).click();
  await expect(
    page.getByRole("button", { name: /^Змінити модель / }),
  ).toHaveCount(0);
  await expect(page.locator(".receive-total")).toHaveText(
    "0 шт. · склад «Склад ринку»",
  );
  await places.getByRole("button", { name: "Склад мережі" }).click();
  // One letter is the whole warehouse again: never asked of the server.
  const asked = searched.length;
  await page.getByRole("searchbox", { name: "Пошук моделі" }).fill("П");
  await expect.poll(() => found.count()).toBeGreaterThan(1);
  expect(searched.slice(asked).some((url) => url.includes("query="))).toBe(
    false,
  );
});

test("in Telegram the supplier's sheet over «Повернути постачальнику» hides its MainButton, «Додати постачальника» its one main; picked, the MainButton is back (audit after stage 2, frame P1-1; review)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      told: { event: string; data: unknown }[];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        host.told.push({ event, data: data ? JSON.parse(data) : null });
      },
    };
  });
  const mainShown = (): Promise<boolean | undefined> =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            told: { event: string; data: { is_visible?: boolean } | null }[];
          }
        ).told
          .filter(({ event }) => event === "web_app_setup_main_button")
          .at(-1)?.data?.is_visible,
    );
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(hanna), tgWebAppVersion: "8.0" }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await section(page, "Постачальникам");
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Повернути товар постачальнику" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Повернути постачальнику" }),
  ).toBeVisible();
  await expect.poll(mainShown).toBe(true);
  await returnForm(page)
    .getByRole("button", { name: /^Постачальник / })
    .click();
  const sheet = page.getByRole("dialog", { name: "Постачальник" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect.poll(mainShown).toBe(false);
  await sheet
    .getByRole("button", { name: "Новий постачальник", exact: true })
    .click();
  await sheet
    .getByLabel("Назва постачальника")
    .fill(`Тельма ${randomUUID().slice(0, 6)}`);
  await expect(sheet.locator("button.primary:visible")).toHaveText([
    "Додати постачальника",
  ]);
  await sheet.getByRole("button", { name: "Додати постачальника" }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(mainShown).toBe(true);
});

test("read slowly, the suppliers' sheet and «Список постачальників» hold three rows in grey under a search that stands, «Повернути постачальнику» two warehouses in grey; the words to a reader alone (money task list after stage 2, P1-3)", async ({
  page,
}) => {
  await openAs(page, hanna);
  await openStore(page, "Центр CENTRE");
  const suppliers = await holdReads(page, "suppliers");
  await section(page, "Постачальникам");
  const said = "Завантажуємо постачальників…";
  // The returns' filter: its sheet.
  await page
    .getByRole("button", {
      name: "Постачальник Усі постачальники",
      exact: true,
    })
    .click();
  const sheet = page.getByRole("dialog", { name: "Постачальник" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  const inSheet = sheet.locator(".placeholder .supplier-rows > .supplier-row");
  await expect(inSheet).toHaveCount(3);
  await expect(
    sheet.getByRole("searchbox", { name: "Пошук постачальника" }),
  ).toBeVisible();
  await expect(sheet.getByRole("status").filter({ hasText: said })).toHaveClass(
    /\bvisually-hidden\b/,
  );
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // «Список постачальників»: its search stands over the rows' places.
  await page.getByRole("button", { name: /^Список постачальників/ }).click();
  await expect(
    page.getByRole("heading", { name: "Список постачальників" }),
  ).toBeVisible();
  // The places under the search field, both there at once.
  const grey = page.locator(
    ".supplier-list-screen > .search-field ~ .placeholder .supplier-rows > .supplier-row",
  );
  await expect(grey).toHaveCount(3);
  const search = page.getByRole("searchbox", { name: "Пошук постачальника" });
  await expect(search).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: said })).toHaveClass(
    /\bvisually-hidden\b/,
  );
  await expect(page.getByText(said)).toHaveCount(1);
  const field = (await search.boundingBox())?.y ?? Number.NaN;
  const top = (await grey.first().boundingBox())?.y ?? Number.NaN;
  suppliers();
  const first = page
    .getByRole("list", { name: "Постачальники" })
    .getByRole("button")
    .first();
  await expect(first).toBeVisible();
  await expect(grey).toHaveCount(0);
  // Nothing moved: the search where it stood, the first row on the first
  // grey's place.
  expect((await search.boundingBox())?.y).toBe(field);
  expect(
    Math.abs(((await first.boundingBox())?.y ?? Number.NaN) - top),
  ).toBeLessThanOrEqual(2);

  // «Повернути постачальнику»: its warehouses as two grey choices.
  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  const places = await holdReads(page, "stock-locations");
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Повернути товар постачальнику" })
    .click();
  const chips = page.locator(".placeholder.chips.receive-place > .chip");
  await expect(chips).toHaveCount(2);
  await expect(
    page.getByRole("status").filter({ hasText: "Завантажуємо склади…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  places();
  await expect(
    page.getByText("Склад «Склад мережі»", { exact: true }),
  ).toBeVisible();
  await expect(chips).toHaveCount(0);
});

test("inside Telegram a size's ±1 on «Повернути постачальнику» is felt both ways, «Менше» held at none is not (money task list after stage 2, P2-4)", async ({
  page,
}) => {
  const coat = await received(page, hanna, fixture.network_centre_store_id, 2);
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      told: { event: string; data: { type?: string } | null }[];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        host.told.push({
          event,
          data: data ? (JSON.parse(data) as { type?: string }) : null,
        });
      },
    };
  });
  const impacts = (): Promise<unknown[]> =>
    page.evaluate(() =>
      (
        window as unknown as {
          told: { event: string; data: { type?: string } | null }[];
        }
      ).told
        .filter(
          ({ event, data }) =>
            event === "web_app_trigger_haptic_feedback" &&
            data?.type === "impact",
        )
        .map(({ data }) => data),
    );
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(hanna), tgWebAppVersion: "8.0" }).toString()}`,
  );
  await openStore(page, "Центр CENTRE");
  await section(page, "Постачальникам");
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Повернути товар постачальнику" })
    .click();
  await chooseModel(page, coat);
  const size = page.getByRole("group", { name: /^Розмір M, вільно / });
  const count = size.getByRole("textbox");
  // Nothing on the form reads under 14: «вільно N» in the meta's size
  // (P2-4; review).
  expect(await under14(page.locator("section.supplier-return-new"))).toEqual(
    [],
  );
  const light = { type: "impact", impact_style: "light" };
  await size.getByRole("button", { name: "Більше" }).click();
  await expect(count).toHaveValue("1");
  await expect.poll(impacts).toEqual([light]);
  await size.getByRole("button", { name: "Менше" }).click();
  await expect(count).toHaveValue("0");
  await expect.poll(impacts).toEqual([light, light]);
  // Held at none (aria-disabled, the cursor kept on it): nothing changes,
  // nothing is felt.
  await size.getByRole("button", { name: "Менше" }).click({ force: true });
  await expect(count).toHaveValue("0");
  await size.getByRole("button", { name: "Більше" }).click();
  await expect(count).toHaveValue("1");
  await expect.poll(impacts).toEqual([light, light, light]);
});

test("a supplier is never written twice: the one on the list is picked", async ({
  page,
}) => {
  const supplier = `Арно ${randomUUID().slice(0, 6)}`;
  await newReturn(page);
  await addOne(page, supplier, returnForm(page));
  await addOne(page, `  ${supplier.toUpperCase()} `, returnForm(page));
  await expect(
    page.getByText(`«${supplier}» уже є у списку — обрано його.`),
  ).toBeVisible();
  // Picked, never added twice: the field shows the one on the list.
  await expect(supplierField(page)).toHaveAccessibleName(
    `Постачальник ${supplier} · 067 123 45 67`,
  );
  await expect(
    page.getByRole("combobox", { name: /Постачальник/ }),
  ).toHaveCount(0);
});

test("the returns are narrowed to a supplier from its sheet: «Усі постачальники» first, the phone under each, nothing to add", async ({
  page,
}) => {
  const supplier = `Фільтр ${randomUUID().slice(0, 6)}`;
  const added = await page.request.post("/api/v1/suppliers", {
    headers: await headersOf(page, hanna),
    data: {
      store_id: fixture.network_centre_store_id,
      name: supplier,
      phone: "067 765 43 21",
    },
  });
  expect(added.status()).toBe(201);
  const supplierId = ((await added.json()) as { id: string }).id;
  await openAs(page, hanna);
  await openStore(page, "Центр CENTRE");
  await section(page, "Постачальникам");
  // One field, never a native list (stage 2, money task list, P0-3).
  await expect(
    page.getByRole("combobox", { name: /Постачальник/ }),
  ).toHaveCount(0);
  const field = page.getByRole("button", {
    name: "Постачальник Усі постачальники",
    exact: true,
  });
  await field.click();
  const sheet = page.getByRole("dialog", { name: "Постачальник" });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(
    sheet.getByRole("searchbox", { name: "Пошук постачальника" }),
  ).toBeFocused();
  await expect(sheet.locator(".supplier-row").first()).toHaveText(
    "Усі постачальники",
  );
  await expect(sheet.locator(".supplier-row").first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    sheet.getByRole("button", { name: /Новий постачальник/ }),
  ).toHaveCount(0);
  // Nothing found: said, for a reader too.
  await sheet
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(`${supplier} нікого`);
  await expect(sheet.locator(".supplier-row")).toHaveCount(0);
  await expect(sheet.getByRole("status")).toHaveText(
    `Нічого не знайшли за «${supplier} нікого»`,
  );
  // Every word typed, of a name or a phone.
  await sheet
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(`${supplier.split(" ")[1] ?? ""} 765`);
  const row = sheet.locator(".supplier-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".t-meta")).toHaveText("067 765 43 21");
  const narrowed = page.waitForRequest(
    (request) =>
      request.url().includes("/api/v1/supplier-returns?") &&
      request.url().includes(`supplier_id=${supplierId}`),
  );
  await row.click();
  await narrowed;
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Постачальник ${supplier}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".supplier-returns .orders-empty .t-row"),
  ).toHaveText(
    `Постачальнику «${supplier}» цей магазин ще нічого не повертав.`,
  );
});

test("a confirmed unit goes back to its supplier from «Брак», and comes back there when cancelled", async ({
  page,
}) => {
  const coat = await received(page, petro, fixture.network_market_store_id, 1);
  const headers = await headersOf(page, petro);
  const sold = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.network_market_store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          source_location_id: fixture.network_shared_location_id,
          quantity: 1,
          unit_price: "2000.00",
        },
      ],
      payment_method: "CASH",
    },
  });
  const sale = (await sold.json()) as { id: string; items: { id: string }[] };
  const back = await page.request.post(`/api/v1/sales/${sale.id}/refunds`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      command_id: randomUUID(),
      lines: [
        {
          sale_item_id: sale.items[0]?.id,
          quantity: 1,
          restock: true,
          condition: "DAMAGED",
        },
      ],
      payment_method: "CASH",
    },
  });
  expect(back.status()).toBe(201);

  const supplier = `Брак-постачальник ${randomUUID().slice(0, 6)}`;
  await openAs(page, petro);
  await openStore(page, /^Ринок MARKET/);
  await section(page, "Брак");
  const unit = page.getByRole("article", { name: coat.model });
  await unit.getByRole("button", { name: "Взяти на перевірку" }).click();
  const sheet = page.getByRole("dialog", { name: new RegExp(coat.model) });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: "Брак підтверджений" }).click();
  const confirmed = sheet.getByRole("button", {
    name: "Так, брак підтверджений",
  });
  await expect(confirmed).toHaveAttribute("data-ready", "");
  await confirmed.click();
  await expect(sheet).toHaveCount(0);
  await page
    .getByRole("group", { name: "Які речі" })
    .getByRole("button", { name: /^Підтверджений/ })
    .click();
  await unit.getByRole("button", { name: "Вирішити" }).click();
  await expect(sheet).toHaveAttribute("data-ready", "");
  await sheet.getByRole("button", { name: "Повернути постачальнику" }).click();
  await expect(
    sheet.getByLabel("Примітка для постачальника (необов’язково)"),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  const toSupplier = sheet.getByRole("button", {
    name: "Так, повернути постачальнику",
  });
  await expect(toSupplier).toBeDisabled();
  // The supplier's field, its list in place in the unit's sheet: never a
  // native list, never a sheet over a sheet (stage 2, money task list,
  // P0-3).
  await expect(
    sheet.getByRole("combobox", { name: /Постачальник/ }),
  ).toHaveCount(0);
  await addSupplier(page, supplier, "067 123 45 67", { inside: sheet });
  await expect(toSupplier).toHaveAttribute("data-ready", "");
  await toSupplier.click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator(".stub-notice p")).toHaveText(
    `Повернули постачальнику «${supplier}»: ${coat.model} беж · M`,
  );
  await expect(unit).toHaveCount(0);

  await section(page, "Постачальникам");
  const row = returnRow(page, supplier);
  await expect(row).toContainText("з «Браку» «Брак ринку»");
  await row.click();
  await page.getByRole("button", { name: "Скасувати повернення" }).click();
  const ask = page.getByRole("dialog", { name: "Скасувати повернення" });
  await expect(ask).toHaveAttribute("data-ready", "");
  await expect(ask).toContainText("Товар повернеться у «Брак» «Брак ринку».");
  await ask.getByLabel("Чому скасовуємо").fill("постачальник відмовив");
  await ask.getByRole("button", { name: "Так, скасувати повернення" }).click();
  await expect(page.locator(".supplier-return-cancelled")).toContainText(
    /^Скасовано/,
  );

  await section(page, "Брак");
  await page
    .getByRole("group", { name: "Які речі" })
    .getByRole("button", { name: /^Підтверджений/ })
    .click();
  await expect(unit).toHaveAttribute("data-status", "CONFIRMED");
});

test("a return whose answer is lost is resent unchanged, and takes the goods once", async ({
  page,
}) => {
  const coat = await received(page, hanna, fixture.network_centre_store_id, 3);
  // An earlier return, to look at meanwhile.
  const earlier = `Раніше ${randomUUID().slice(0, 6)}`;
  const made = await page.request.post("/api/v1/supplier-returns", {
    headers: await headersOf(page, hanna),
    data: {
      command_id: randomUUID(),
      store_id: fixture.network_centre_store_id,
      location_id: fixture.network_shared_location_id,
      supplier_id: await aSupplier(page, earlier),
      lines: [
        { product_variant_id: coat.variant, size_id: coat.size, quantity: 1 },
      ],
      note: null,
    },
  });
  expect(made.status()).toBe(201);
  const sent = posts(page, "/api/v1/supplier-returns");
  let first = true;
  let answer = (): void => undefined;
  const answered = new Promise<void>((done) => {
    answer = done;
  });
  await page.route("**/api/v1/supplier-returns", async (route) => {
    if (route.request().method() === "POST" && first) {
      first = false;
      // The server takes it once let; the answer never arrives.
      await answered;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await newReturn(page);
  await addOne(page, `Втрачений ${randomUUID().slice(0, 6)}`, returnForm(page));
  await chooseModel(page, coat);
  await tapMore(page, "M", 1);
  await sendBack(page, 1).click();
  // While it is sent, «←» is held.
  await expect(
    page.getByRole("button", { name: "Постачальникам", exact: true }),
  ).toBeDisabled();
  answer();
  // On «Постачальникам», its own screen: the stub, still attached, checked
  // by its button alone (G11; stage 2, money task list, P0-6).
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect(kept.locator(".stub-head")).toHaveText("Ще не підтверджено");
  await expect(
    kept.getByRole("heading", {
      name: "Повернення постачальнику ще не підтверджено",
    }),
  ).toBeVisible();
  await expect(kept).toContainText(
    "Невідомо, чи записано повернення постачальнику. Перевірте результат — те саме повернення не запишеться двічі.",
  );
  await expect(kept).toContainText(/Чекає відповіді сервера з \d{2}:\d{2}\./);
  await expect(page.getByText(/Перевіряємо кожні 20 с/)).toHaveCount(0);
  // What was sent stays, held; «←» brings the menu back, the stub over the
  // returns.
  await expect(
    returnForm(page).getByRole("searchbox", { name: "Пошук моделі" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  // Nothing new meanwhile: «+» held, and another return's cancel.
  await expect(
    page
      .locator(".screen-title")
      .getByRole("button", { name: "Повернути товар постачальнику" }),
  ).toBeDisabled();
  await returnRow(page, earlier).click();
  await expect(
    page.getByRole("button", { name: "Скасувати повернення" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Замовлення", exact: true }),
  ).toBeDisabled();
  // Its own section stays open under «Ще», every other is held (P1-6); over
  // «Ще», a banner with the same check.
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: "Постачальникам", exact: true }),
  ).toBeEnabled();
  await expect(
    sections(page).getByRole("button", { name: "Інвентаризація", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator(".banner-kept").getByRole("button", {
      name: "Перевірити результат повернення",
    }),
  ).toBeVisible();
  // On «Гроші», the open store's way to «Накладні» is held too (money task
  // list after stage 2, P1-2).
  await sections(page)
    .getByRole("button", { name: "Гроші", exact: true })
    .click();
  const invoices = page
    .getByRole("article", { name: "Ви винні постачальникам" })
    .getByRole("button", { name: /^Накладні магазину / });
  await expect(invoices).toBeDisabled();
  // Held, it still reads: nothing faded over its money (review).
  await expect(invoices).toHaveCSS("opacity", "1");
  // Written down before it was sent: a reload still knows what to ask about.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await kept
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect(
    kept.getByRole("heading", {
      name: "Повернення постачальнику записано один раз",
    }),
  ).toBeVisible();
  await expect(kept).toContainText(
    /Повернено постачальнику «Втрачений .*»: 1 шт\./,
  );
  // The till is the seller's again.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  expect(sent.bodies).toHaveLength(2);
  expect(sent.bodies[1]).toEqual(sent.bodies[0]);
  expect(await available(page, coat)).toBe(1);
});

// --- what the task list measures --------------------------------------------

test("two sizes of a model go back in nine taps from «Ще» where one warehouse takes returns, ten where two do; «Постачальникам» holds no native list and no form unfolding", async ({
  page,
}) => {
  const supplier = `Дев’ять ${randomUUID().slice(0, 6)}`;
  await aSupplier(page, supplier);
  for (const [who, store, opened, budget] of [
    [hanna, fixture.network_centre_store_id, "Центр CENTRE", 9],
    [petro, fixture.network_market_store_id, /^Ринок MARKET/, 10],
  ] as const) {
    const coat = await received(page, who, store, 2, ["M", "L"]);
    await openAs(page, who);
    await openStore(page, opened);
    const taps = await countTaps(page);
    // «Ще», its row.
    await more(page);
    await page
      .getByRole("navigation", { name: "Ще" })
      .getByRole("button", { name: rowNamed("Постачальникам") })
      .click();
    await expect(
      page.getByRole("heading", { name: "Постачальникам", exact: true }),
    ).toBeVisible();
    await expect(page.locator("select, details")).toHaveCount(0);
    await expect(page.locator(".supplier-returns input")).toHaveCount(0);
    // «+»; the warehouse, where two take returns; the field and its row.
    await page
      .locator(".screen-title")
      .getByRole("button", { name: "Повернути товар постачальнику" })
      .click();
    if (budget === 10)
      await page
        .getByRole("group", { name: "Склад", exact: true })
        .getByRole("button", { name: "Склад мережі" })
        .click();
    await pickSupplier(page, supplier, { of: returnForm(page) });
    // The model, its name typed; a «+» for each size; the dock's button.
    await chooseModel(page, coat);
    await tapMore(page, "M", 1);
    await tapMore(page, "L", 1);
    await sendBack(page, 2).click();
    await expect(
      page.getByRole("heading", {
        name: `Повернено постачальнику «${supplier}»: 2 шт.`,
      }),
    ).toBeVisible();
    expect(await taps()).toBe(budget);
  }
});

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme at 360 × 640 a return's row, its screen and «Повернути постачальнику» read at 4.5:1, nothing wider than the phone`, async ({
    page,
  }) => {
    const coat = await received(
      page,
      hanna,
      fixture.network_centre_store_id,
      3,
      ["M", "L", "XL"],
    );
    const supplier = `Тема ${randomUUID().slice(0, 6)}`;
    const made = await page.request.post("/api/v1/supplier-returns", {
      headers: await headersOf(page, hanna),
      data: {
        command_id: randomUUID(),
        store_id: fixture.network_centre_store_id,
        location_id: fixture.network_shared_location_id,
        supplier_id: await aSupplier(page, supplier),
        lines: coat.sizes.map((size) => ({
          product_variant_id: coat.variant,
          size_id: size,
          quantity: 1,
        })),
        note: "не той колір",
      },
    });
    expect(made.status()).toBe(201);
    await page.setViewportSize({ width: 360, height: 640 });
    await openAs(page, hanna, theme);
    await openStore(page, "Центр CENTRE");
    await section(page, "Постачальникам");
    const row = returnRow(page, supplier);
    // Two of its goods named, then how many more.
    await expect(row.locator(".sale-meta").nth(1)).toHaveText(
      / × 1 · .+ × 1 · \+ ще 1$/,
    );
    for (const part of [
      row.locator(".t-row"),
      row.locator(".return-row-units"),
      row.locator(".sale-meta").first(),
      row.locator(".sale-meta").nth(1),
      page.locator(".supplier-ways .cash-row-title").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({
      path: `test-results/supplier-returns-${name}.png`,
    });

    await row.click();
    await expect(
      page.getByRole("heading", { name: supplier, exact: true }),
    ).toBeVisible();
    for (const part of [
      page.locator(".supplier-return > .t-meta").first(),
      page
        .getByRole("list", { name: "Що повернули" })
        .getByRole("listitem")
        .first(),
      page.getByText("не той колір", { exact: true }),
      page.getByRole("button", { name: "Скасувати повернення" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({ path: `test-results/supplier-return-${name}.png` });

    await page
      .getByRole("button", { name: "Постачальникам", exact: true })
      .click();
    await page
      .locator(".screen-title")
      .getByRole("button", { name: "Повернути товар постачальнику" })
      .click();
    await chooseModel(page, coat);
    await tapMore(page, "M", 1);
    const size = page.getByRole("group", { name: "Розмір M, вільно 2" });
    for (const part of [
      page.locator(".receive-place"),
      size.locator(".receive-size-code"),
      size.locator(".receive-size-free"),
      size.getByRole("textbox", { name: "M, шт." }),
      page.locator(".receive-total"),
      sendBack(page, 1),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({
      path: `test-results/supplier-return-new-${name}.png`,
    });
    // No supplier chosen: said, nothing sent.
    const sent = posts(page, "/api/v1/supplier-returns");
    await sendBack(page, 1).click();
    await expect(page.getByRole("alert")).toHaveText("Оберіть постачальника.");
    expect(sent.bodies).toHaveLength(0);
    // Returned: its result's heading as «Продано 1 шт.»'s, under its «←
    // Постачальникам» (audit 2026-11-13, money P2-2; review).
    await pickSupplier(page, supplier, { of: returnForm(page) });
    await sendBack(page, 1).click();
    const done = page.getByRole("heading", {
      name: `Повернено постачальнику «${supplier}»: 1 шт.`,
    });
    await expect(done).toBeFocused();
    await expectResultHeading(done, { wraps: true });
    const arrow = page.getByRole("button", {
      name: "Постачальникам",
      exact: true,
    });
    for (const part of [done, arrow, page.locator(".stub-line").first()])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({
      path: `test-results/supplier-return-done-${name}.png`,
    });
  });

/** The WCAG contrast of an element's text against what it is drawn on. */
async function contrast(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const rgb = (value: string): number[] =>
      (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]): number => {
      const channel = (c: number): number => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel(r ?? 0) +
        0.7152 * channel(g ?? 0) +
        0.0722 * channel(b ?? 0)
      );
    };
    let ground: Element | null = node;
    let background = "rgba(0, 0, 0, 0)";
    while (ground) {
      background = getComputedStyle(ground).backgroundColor;
      const alpha = rgb(background)[3];
      if (alpha === undefined || alpha > 0) break;
      ground = ground.parentElement;
    }
    const fore = luminance(rgb(getComputedStyle(node).color));
    const back = luminance(rgb(background));
    return (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
  });
}
