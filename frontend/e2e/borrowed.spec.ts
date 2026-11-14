import {
  test,
  expect,
  countTaps,
  more,
  openStore,
  pickSupplier,
  readsOf,
  receiveModel,
  receiveUnits,
  receiveWay,
  receiveWayDone,
  recordReceipt,
  refuseOnce,
  rowNamed,
  section,
  supplierList,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Goods borrowed from another shop, and goods under consignment (owner
 * decisions, 2026-10-01): taken through «Приймання» from a supplier at a
 * price agreed for each, by the owner and managers only; marked sold on
 * «Позичене й під реалізацію», which is an invoice in «Накладні»; sent back
 * unsold for nothing. A mistaken «Продано» is undone by cancelling its
 * invoice.
 *
 * Its own screen (stage 2, money task list, P0-5): a lot a tag, «На руках ·
 * Усе», a sheet with how many and the price for each, a stub for what was
 * recorded; «Відкрити накладну ›» from that stub, «Позичене й під
 * реалізацію ›» from the sold invoice's card (P1-3).
 *
 * In the stores' own network: Ганна holds every right at «Центр», Ліда sells
 * there with a seller's rights.
 */
interface Fixture {
  network_centre_seller_telegram_user_id: string;
  network_centre_cashier_telegram_user_id: string;
  network_centre_store_id: string;
  network_shared_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const hanna = fixture.network_centre_seller_telegram_user_id;
const lida = fixture.network_centre_cashier_telegram_user_id;
const centre = fixture.network_centre_store_id;

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

/** Бірка at «Центр», as this person; in `theme`'s colours; inside
 * Telegram 8.0 when `telegram`, what it is told kept in `window.told`. */
async function openAs(
  page: Page,
  telegramUserId: string,
  theme?: Record<string, string>,
  telegram = false,
): Promise<void> {
  if (telegram)
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
  await page.goto("about:blank");
  const hash = new URLSearchParams({ tgWebAppData: initData(telegramUserId) });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  if (telegram) hash.set("tgWebAppVersion", "8.0");
  await page.goto(`/#${hash.toString()}`);
  await openStore(page, "Центр CENTRE");
}

async function headers(page: Page): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(hanna) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

function posts(page: Page, ending: RegExp): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && ending.test(request.url()))
      seen.bodies.push(request.postDataJSON());
  });
  return seen;
}

interface Coat {
  model: string;
  variant: string;
  size: string;
}

async function aModel(page: Page): Promise<Coat> {
  const model = `Позичене ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...(await headers(page)), "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      concept: model,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  return {
    model,
    variant: product.product_variant_id,
    size: product.sizes[0]?.size_id ?? "",
  };
}

async function aSupplier(
  page: Page,
  name = `Сусід ${randomUUID().slice(0, 6)}`,
): Promise<{ id: string; name: string }> {
  const added = await page.request.post("/api/v1/suppliers", {
    headers: await headers(page),
    data: { store_id: centre, name, phone: null },
  });
  expect(added.status()).toBe(201);
  return { id: ((await added.json()) as { id: string }).id, name };
}

/** Borrowed through the API: `quantity` of the coat at `price` each. */
async function borrowed(
  page: Page,
  coat: Coat,
  supplierId: string,
  quantity: number,
  price = "1000.00",
): Promise<string> {
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...(await headers(page)), "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      supplier_id: supplierId,
      lines: [
        {
          product_variant_id: coat.variant,
          size_id: coat.size,
          quantity,
          acquisition_type: "BORROWED",
          unit_cost: price,
        },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  const { lines } = (await received.json()) as {
    lines: { stock_lot_id: string }[];
  };
  return lines[0]?.stock_lot_id ?? "";
}

async function onHand(page: Page, lotId: string): Promise<number | undefined> {
  const page_ = await page.request.get(
    `/api/v1/borrowed?store_id=${centre}&on_hand=false&limit=50`,
    { headers: await headers(page) },
  );
  const { items } = (await page_.json()) as {
    items: { stock_lot_id: string; on_hand: number }[];
  };
  return items.find((item) => item.stock_lot_id === lotId)?.on_hand;
}

/** A lot's tag on «Позичене й під реалізацію»: its model and size. */
function tag(page: Page, coat: Coat): Locator {
  return page
    .getByRole("list", { name: "Позичене" })
    .getByRole("article", { name: `${coat.model} графіт, M`, exact: true });
}

/** A lot's sheet, opened by its verb «Продано» or by the tag, once it
 * takes taps. */
async function lotSheet(page: Page, coat: Coat, by: "verb" | "tag") {
  const lot = tag(page, coat);
  await (
    by === "verb"
      ? lot.getByRole("button", { name: "Продано", exact: true })
      : lot.locator(".order-row")
  ).click();
  const sheet = page.getByRole("dialog", { name: `${coat.model} графіт, M` });
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

test("jackets borrowed from another shop are taken at a price, marked sold, and owed in «Накладні»", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const other = await aSupplier(page);
  const receipts = posts(page, /\/inventory\/receipts$/);
  await openAs(page, hanna);
  await section(page, "Приймання");
  // The store's only warehouse that takes deliveries: said, not offered.
  await expect(page.locator(".receive-place")).toHaveText(/^Склад «.+»$/);
  await receiveModel(page, coat.model);
  await receiveUnits(page, "M", 3);
  // How it came, in «Як надійшов» (sections task list, P1-4).
  let way = await receiveWay(page);
  await way
    .getByRole("group", { name: "Як надійшов", exact: true })
    .getByRole("button", { name: "Позичено", exact: true })
    .click();
  // Whose goods is asked as soon as they are borrowed.
  await expect(
    way.getByRole("button", { name: "Постачальник Оберіть", exact: true }),
  ).toBeVisible();
  // Inside «Як надійшов», the list opens in place: never a sheet over a
  // sheet (stage 2, money task list, P0-3).
  const suppliers = await supplierList(page, { inside: way });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.locator("select")).toHaveCount(0);
  // A supplier being added is kept while the sheet is closed.
  await suppliers
    .getByRole("button", { name: "Новий постачальник", exact: true })
    .click();
  await way.getByLabel("Назва постачальника").fill("Ще не додано");
  await receiveWayDone(way);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await expect(
    page.getByText(
      "Вкажіть ціну за одиницю, домовлену з постачальником: її сплатять, коли товар продадуть.",
    ),
  ).toBeVisible();
  way = await receiveWay(page);
  await expect(way.getByLabel("Назва постачальника")).toHaveValue(
    "Ще не додано",
  );
  await way.getByRole("button", { name: "Скасувати" }).click();
  await way.getByLabel("Домовлена ціна за шт., грн").fill("1500");
  await receiveWayDone(way);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await recordReceipt(page, 3).click();
  await expect(
    page.getByText("Оберіть постачальника, чий це товар."),
  ).toBeVisible();
  expect(receipts.bodies).toHaveLength(0);
  // Another supplier's goods are another delivery: refused for the first,
  // the second goes under a new identity.
  way = await receiveWay(page);
  await pickSupplier(page, other.name, { inside: way });
  await receiveWayDone(way);
  await refuseOnce(page, "**/api/v1/inventory/receipts", 422);
  await recordReceipt(page, 3).click();
  await expect(
    page.getByText("Нічого не прийнято, список збережено. Перевірте рядки.", {
      exact: true,
    }),
  ).toBeVisible();
  way = await receiveWay(page);
  await pickSupplier(page, supplier.name, { inside: way });
  await receiveWayDone(way);
  await expect(
    page.getByRole("button", {
      name: `Як надійшов: Позичено · ціна не вказана · ${supplier.name}`,
    }),
  ).toBeVisible();
  await recordReceipt(page, 3).click();
  await expect(
    page.getByRole("heading", {
      name: /^Прийшло 3 шт\. · склад «.+» · Позичено$/,
    }),
  ).toBeVisible();
  const [refused, taken] = receipts.bodies as {
    command_id: string;
    supplier_id: string;
  }[];
  expect(refused?.supplier_id).toBe(other.id);
  expect(taken?.command_id).not.toBe(refused?.command_id);
  expect(receipts.bodies.slice(1)).toEqual([
    expect.objectContaining({
      supplier_id: supplier.id,
      lines: [
        expect.objectContaining({
          acquisition_type: "BORROWED",
          quantity: 3,
          unit_cost: "1500.00",
        }),
      ],
    }),
  ]);

  // Its own screen, a row of «Ще» › «Гроші» (P0-5, P1-3).
  await section(page, "Позичене й під реалізацію");
  await expect(
    page.getByRole("heading", { name: "Позичене й під реалізацію" }),
  ).toBeVisible();
  // On a list that is not empty, nothing explains it.
  await expect(page.getByText(/Береться через/)).toHaveCount(0);
  const lot = tag(page, coat);
  await expect(lot).toContainText("на руках 3");
  await expect(lot).toContainText(`Позичено у «${supplier.name}» · `);
  await expect(lot).toContainText(
    "1 500,00 грн за шт. · взято 3 · продано 0 · повернено 0",
  );
  await expect(lot).toHaveClass(/\bfilled\b/);
  // «Продано» opens its sheet: how many, and the price before the press
  // (В7 (а)).
  const sheet = await lotSheet(page, coat, "verb");
  await expect(
    sheet.getByRole("button", { name: "Позначити проданим · 1 шт." }),
  ).toBeVisible();
  await expect(
    sheet.getByText("1 500,00 грн за шт.", { exact: true }),
  ).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Менше" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await sheet.getByRole("button", { name: "Більше" }).click();
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25).
  await refuseOnce(page, "**/api/v1/supplier-invoices/sold", 422);
  await sheet
    .getByRole("button", { name: "Позначити проданим · 2 шт." })
    .click();
  await expect(
    sheet.getByText("Не записано. Перевірте кількість.", {
      exact: true,
    }),
  ).toBeVisible();
  const lotReads = readsOf(page, /\/api\/v1\/borrowed$/);
  await refuseOnce(page, "**/api/v1/supplier-invoices/sold", 409);
  await sheet
    .getByRole("button", { name: "Позначити проданим · 2 шт." })
    .click();
  await expect(
    sheet.getByText("Не записано: дані змінилися — перегляньте їх.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect.poll(lotReads).toBeGreaterThan(0);
  // A request naming nothing: what was not done, then what to check —
  // never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/supplier-invoices/sold", 404);
  await sheet
    .getByRole("button", { name: "Позначити проданим · 2 шт." })
    .click();
  await expect(
    sheet.getByText("Не записано. Перевірте кількість.", { exact: true }),
  ).toBeVisible();
  await sheet
    .getByRole("button", { name: "Позначити проданим · 2 шт." })
    .click();
  // Its stub: the debt the server counted, large, as an invoice's own
  // stub; whose and what under it; and its invoice one tap away (money task
  // list after stage 2, P2-3).
  await expect(sheet).toHaveCount(0);
  const said = page.locator(".result-title");
  await expect(said).toHaveText("Продано 2 шт.");
  await expect(said).toBeFocused();
  // Heard with the debt it recorded and where it is (review).
  await expect(said).toHaveAccessibleDescription(
    `3 000,00 грн Борг «${supplier.name}» — у «Накладних».`,
  );
  const stub = page.locator(".borrowed-done .stub");
  await expect(stub).toHaveClass(/\bstub-recorded\b/);
  await expect(stub.locator(".stub-sum")).toHaveText("3 000,00 грн");
  await expect(stub.locator(".stub-say")).toHaveText(
    `${supplier.name} · ${coat.model} графіт, M × 2`,
  );
  await expect(stub.locator(".perforation")).toHaveCount(1);
  await expect(stub.locator(".stub-line")).toHaveText(
    `Борг «${supplier.name}» — у «Накладних».`,
  );
  await stub.getByRole("button", { name: "Відкрити накладну" }).click();
  await expect(
    page.getByRole("heading", { name: supplier.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      new RegExp(`^За продане позичене: ${coat.model} графіт, M × 2\\.`),
    ),
  ).toBeVisible();
  // «←» back where it was opened: the lots, the stub gone.
  await page
    .getByRole("button", { name: "Назад до «Позичене й під реалізацію»" })
    .click();
  await expect(lot).toContainText("на руках 1");
  await expect(lot).toContainText("продано 2 · повернено 0");
  await expect(stub).toHaveCount(0);
});

test("unsold borrowed jackets go back to their supplier for nothing", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const lotId = await borrowed(page, coat, supplier.id, 2);
  const returns = posts(page, /\/supplier-returns$/);
  await openAs(page, hanna);
  await section(page, "Позичене й під реалізацію");
  // By the tag itself: no more than in hand.
  const sheet = await lotSheet(page, coat, "tag");
  await sheet.getByRole("button", { name: "Більше" }).click();
  await expect(sheet.getByRole("button", { name: "Більше" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await sheet
    .getByRole("button", { name: "Повернути постачальнику · 2 шт." })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText(`Повернено постачальнику «${supplier.name}»: 2 шт.`, {
      exact: true,
    }),
  ).toBeVisible();
  // No «Відкрити накладну» for goods sent back: no invoice.
  await expect(
    page.getByRole("button", { name: "Відкрити накладну" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  // None in hand: gone from «На руках», a knot under «Усе», nothing to
  // press.
  await expect(tag(page, coat)).toHaveCount(0);
  await page
    .getByRole("group", { name: "Яке позичене" })
    .getByRole("button", { name: "Усе" })
    .click();
  await expect(tag(page, coat)).toHaveClass(/\btied\b/);
  await expect(tag(page, coat).getByRole("button")).toHaveCount(0);
  await expect(tag(page, coat)).toContainText("на руках 0");
  expect(returns.bodies).toEqual([
    expect.objectContaining({
      supplier_id: supplier.id,
      stock_lot_id: lotId,
      lines: [
        { product_variant_id: coat.variant, size_id: coat.size, quantity: 2 },
      ],
    }),
  ]);
  await section(page, "Постачальникам");
  await expect(
    page
      .getByRole("list", { name: "Повернення постачальникам" })
      .getByRole("button", { name: new RegExp(`^${supplier.name} `) }),
  ).toContainText(`${coat.model} графіт, M × 2`);
  // «Позичене й під реалізацію ›» under the returns, «← Постачальникам»
  // back.
  await page
    .locator(".supplier-ways")
    .getByRole("button", { name: "Позичене й під реалізацію" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Позичене й під реалізацію" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Назад до «Постачальникам»" }).click();
  await expect(
    page.getByRole("heading", { name: "Постачальникам", exact: true }),
  ).toBeVisible();
  expect(await onHand(page, lotId)).toBe(0);
});

test("a mistaken «Продано» is undone by cancelling its invoice", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const lotId = await borrowed(page, coat, supplier.id, 1);
  const marked = await page.request.post("/api/v1/supplier-invoices/sold", {
    headers: await headers(page),
    data: {
      command_id: randomUUID(),
      store_id: centre,
      stock_lot_id: lotId,
      quantity: 1,
    },
  });
  expect(marked.status()).toBe(201);
  expect(await onHand(page, lotId)).toBe(0);

  await openAs(page, hanna);
  await section(page, "Накладні");
  await page
    .getByRole("article", { name: supplier.name, exact: true })
    .locator(".order-row")
    .click();
  await expect(
    page.getByText(/Якщо позначили помилково — скасуйте накладну/),
  ).toBeVisible();
  // Behind the card's ⋯ (stage 2, money task list, P0-2).
  await page.getByRole("button", { name: "Дії з накладною" }).click();
  const ways = page.getByRole("dialog");
  await expect(ways).toHaveAttribute("data-ready", "");
  await ways.getByRole("button", { name: "Скасувати накладну" }).click();
  // Its own sheet, once it takes taps.
  const why = page.getByRole("dialog", { name: "Скасувати накладну" });
  await expect(why).toHaveAttribute("data-ready", "");
  await why.getByLabel("Чому скасовуємо").fill("ще не продали");
  await why.getByRole("button", { name: "Так, скасувати накладну" }).click();
  await expect(page.locator(".invoice-closed")).toContainText("Скасовано");
  await expect(page.locator(".invoice-closed")).toContainText(
    / · ще не продали · /,
  );
  // From the card to its lot, and back to the card (P1-3).
  await page.getByRole("button", { name: "Позичене й під реалізацію" }).click();
  await expect(
    page.getByRole("heading", { name: "Позичене й під реалізацію" }),
  ).toBeVisible();
  await expect(tag(page, coat)).toContainText("на руках 1");
  await expect(tag(page, coat)).toContainText("продано 0 · повернено 0");
  await page.getByRole("button", { name: "Назад до «Накладна»" }).click();
  await expect(
    page.getByRole("heading", { name: supplier.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".invoice-closed")).toContainText("Скасовано");
});

test("a seller takes only the shop's own goods", async ({ page }) => {
  await openAs(page, lida);
  await section(page, "Приймання");
  const way = await receiveWay(page);
  await expect(
    way.getByRole("group", { name: "Як надійшов", exact: true }),
  ).toHaveCount(0);
  await receiveWayDone(way);
  await more(page);
  await expect(
    page.getByRole("button", { name: "Постачальникам", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Позичене й під реалізацію" }),
  ).toHaveCount(0);
});

test("nothing borrowed: the blank tag, what is so, and what these goods are", async ({
  page,
}) => {
  await page.route("**/api/v1/borrowed?*", async (route) => {
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await openAs(page, hanna);
  await section(page, "Позичене й під реалізацію");
  const empty = page.locator(".orders-empty");
  await expect(empty.locator(".t-row")).toHaveText(
    "Позиченого на руках немає.",
  );
  await expect(empty.locator(".t-meta")).toHaveText(
    "Товар інших магазинів і постачальників: сплачують лише продане, за домовленою ціною, непродане повертають. Береться через «Прийшов товар».",
  );
  await page
    .getByRole("group", { name: "Яке позичене" })
    .getByRole("button", { name: "Усе" })
    .click();
  await expect(empty.locator(".t-row")).toHaveText(
    "Цей магазин нічого не позичав.",
  );
});

test("a «Продано» whose answer is lost is resent unchanged, and counted once", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const lotId = await borrowed(page, coat, supplier.id, 2);
  const marks = posts(page, /\/supplier-invoices\/sold$/);
  let first = true;
  await page.route("**/api/v1/supplier-invoices/sold", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await openAs(page, hanna);
  await section(page, "Позичене й під реалізацію");
  const sheet = await lotSheet(page, coat, "verb");
  await sheet
    .getByRole("button", { name: "Позначити проданим · 1 шт." })
    .click();
  // The sheet goes; on «Позичене й під реалізацію», its own screen, the
  // stub, its own check (stage 2, money task list, P0-6).
  await expect(sheet).toHaveCount(0);
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect(
    kept.getByRole("heading", {
      name: "Продаж позиченого ще не підтверджено",
    }),
  ).toBeVisible();
  await expect(kept).toContainText(
    "Невідомо, чи записано продаж позиченого. Перевірте результат — та сама операція не запишеться двічі.",
  );
  await expect(page.getByText(/Перевіряємо кожні 20 с/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Замовлення", exact: true }),
  ).toBeDisabled();
  // Nothing marked meanwhile: the verbs held.
  await expect(
    tag(page, coat).getByRole("button", { name: "Продано", exact: true }),
  ).toBeDisabled();
  // Written down before it was sent: a reload still knows what to ask
  // about, and opens where it was made.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  const own = page.getByRole("heading", {
    name: "Позичене й під реалізацію",
    exact: true,
  });
  await expect(own).toBeVisible();
  // Left, it is a banner over «Ще», and its row stays open to it, its own
  // screen (review, 2026-11-05).
  await more(page);
  await expect(
    page.locator(".banner-kept").getByRole("heading", {
      name: "Продаж позиченого ще не підтверджено",
    }),
  ).toBeVisible();
  const row = page.getByRole("button", {
    name: "Позичене й під реалізацію",
    exact: true,
  });
  await expect(row).toBeEnabled();
  await row.click();
  await expect(own).toBeVisible();
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await kept
    .getByRole("button", { name: "Перевірити результат продажу позиченого" })
    .click();
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect(
    kept.getByRole("heading", { name: "Продаж позиченого записано один раз" }),
  ).toBeVisible();
  await expect(kept).toContainText(
    new RegExp(`Продано з позиченого: ${coat.model}`),
  );
  expect(marks.bodies).toHaveLength(2);
  expect(marks.bodies[1]).toEqual(marks.bodies[0]);
  expect(await onHand(page, lotId)).toBe(1);
});

test("inside Telegram a «Продано» kept on the phone asks before Бірка closes, never while its first send is on its way, and lets it go once its check confirms it (audit 2026-11-13, money P2-6)", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  await borrowed(page, coat, supplier.id, 2);
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/api/v1/supplier-invoices/sold", async (route) => {
    if (first) {
      first = false;
      // Held on its way, then taken by the server, its answer lost.
      await gate;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await openAs(page, hanna, undefined, true);
  const closing = (): Promise<unknown> =>
    page.evaluate(
      () =>
        (window as unknown as { told: [string, unknown][] }).told
          .filter(([event]) => event === "web_app_setup_closing_behavior")
          .map(([, data]) => data)
          .at(-1) ?? null,
    );
  await section(page, "Позичене й під реалізацію");
  const sheet = await lotSheet(page, coat, "verb");
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/supplier-invoices/sold",
  );
  await sheet
    .getByRole("button", { name: "Позначити проданим · 1 шт." })
    .click();
  await sent;
  // On its way the first time: its button's ring says so, nothing asked.
  expect(await closing()).toBeNull();
  release();
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect.poll(closing).toEqual({ need_confirmation: true });
  await kept
    .getByRole("button", { name: "Перевірити результат продажу позиченого" })
    .click();
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect.poll(closing).toEqual({ need_confirmation: false });
});

test("a return of borrowed goods whose answer is lost is «Позичене»'s: its stub there, a banner on «Постачальникам»", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  const lotId = await borrowed(page, coat, supplier.id, 1);
  let first = true;
  await page.route("**/api/v1/supplier-returns", async (route) => {
    if (route.request().method() === "POST" && first) {
      first = false;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await openAs(page, hanna);
  await section(page, "Позичене й під реалізацію");
  const sheet = await lotSheet(page, coat, "tag");
  await sheet
    .getByRole("button", { name: "Повернути постачальнику · 1 шт." })
    .click();
  await expect(sheet).toHaveCount(0);
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect(
    kept.getByRole("heading", {
      name: "Повернення постачальнику ще не підтверджено",
    }),
  ).toBeVisible();
  // Written down before it was sent: a reload opens where it was made.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByRole("heading", {
      name: "Позичене й під реалізацію",
      exact: true,
    }),
  ).toBeVisible();
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  // Not «Постачальникам»'s: a banner there, the same check.
  await section(page, "Постачальникам");
  await expect(kept).toHaveCount(0);
  const banner = page.locator(".banner-kept");
  await expect(
    banner.getByRole("heading", {
      name: "Повернення постачальнику ще не підтверджено",
    }),
  ).toBeVisible();
  await banner
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Повернення постачальнику записано один раз",
    }),
  ).toBeVisible();
  expect(await onHand(page, lotId)).toBe(0);
});

// --- what the task list measures --------------------------------------------

test("one borrowed jacket is marked sold in four taps from «Ще», nothing scrolled, its price in the sheet before the press", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  await borrowed(page, coat, supplier.id, 2, "1500.00");
  await page.setViewportSize({ width: 390, height: 844 });
  await openAs(page, hanna);
  const taps = await countTaps(page);
  // «Ще», its row; the tag's verb; the sheet's button.
  await more(page);
  await page
    .getByRole("navigation", { name: "Ще" })
    .getByRole("button", { name: rowNamed("Позичене й під реалізацію") })
    .click();
  const verb = tag(page, coat).getByRole("button", {
    name: "Продано",
    exact: true,
  });
  await expect(verb).toBeInViewport();
  await verb.click();
  const sheet = page.getByRole("dialog", { name: `${coat.model} графіт, M` });
  await expect(sheet).toHaveAttribute("data-ready", "");
  await expect(sheet.locator(".lot-price")).toHaveText("1 500,00 грн за шт.");
  const mark = sheet.getByRole("button", {
    name: "Позначити проданим · 1 шт.",
  });
  await expect(mark).toBeInViewport();
  await mark.click();
  await expect(page.locator(".result-title")).toHaveText("Продано 1 шт.");
  await expect(page.locator(".borrowed-done .stub-sum")).toHaveText(
    "1 500,00 грн",
  );
  expect(await taps()).toBe(4);
});

test("inside Telegram ±1 of a lot's count is felt both ways, «Менше» held at one is not (money task list after stage 2, P2-4)", async ({
  page,
}) => {
  const coat = await aModel(page);
  const supplier = await aSupplier(page);
  await borrowed(page, coat, supplier.id, 2);
  await openAs(page, hanna, undefined, true);
  await section(page, "Позичене й під реалізацію");
  const sheet = await lotSheet(page, coat, "tag");
  const impacts = (): Promise<unknown[]> =>
    page.evaluate(() =>
      (window as unknown as { told: [string, { type?: string }][] }).told
        .filter(
          ([event, data]) =>
            event === "web_app_trigger_haptic_feedback" &&
            data.type === "impact",
        )
        .map(([, data]) => data),
    );
  const light = { type: "impact", impact_style: "light" };
  const count = sheet.locator(".lot-count output");
  await sheet.getByRole("button", { name: "Більше" }).click();
  await expect(count).toHaveText("2");
  await expect.poll(impacts).toEqual([light]);
  await sheet.getByRole("button", { name: "Менше" }).click();
  await expect(count).toHaveText("1");
  await expect.poll(impacts).toEqual([light, light]);
  // Held at one (aria-disabled, the cursor kept on it): nothing changes,
  // nothing is felt.
  await sheet.getByRole("button", { name: "Менше" }).click({ force: true });
  await expect(count).toHaveText("1");
  await sheet.getByRole("button", { name: "Більше" }).click();
  await expect(count).toHaveText("2");
  await expect.poll(impacts).toEqual([light, light, light]);
});

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme at 360 × 640 «Позичене»'s tags, a lot's sheet and «Продано»'s stub read at 4.5:1, nothing wider than the phone; a forty-letter name wraps, the sum whole`, async ({
    page,
  }) => {
    const coat = await aModel(page);
    // Forty letters with no space to break at, as a shop's Instagram name
    // is: the longest a stub must hold (money task list after stage 2,
    // P2-3).
    const supplier = await aSupplier(
      page,
      `@postachalnyk_duzhe_dovhoiu_nazvoiu_${randomUUID().slice(0, 4)}`,
    );
    expect(supplier.name).toHaveLength(40);
    await borrowed(page, coat, supplier.id, 2, "123456.78");
    await page.setViewportSize({ width: 360, height: 640 });
    await openAs(page, hanna, theme);
    await section(page, "Позичене й під реалізацію");
    const own = tag(page, coat);
    for (const part of [
      own.locator(".order-tag-title"),
      own.locator(".lot-on-hand"),
      own.locator(".order-tag-meta").first(),
      own.locator(".order-tag-meta").nth(1),
      own.getByRole("button", { name: "Продано", exact: true }),
      page.locator(".mode-switch button").first(),
      page.locator(".mode-switch button").nth(1),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({ path: `test-results/borrowed-${name}.png` });

    const sheet = await lotSheet(page, coat, "tag");
    for (const part of [
      sheet.locator(".t-meta").first(),
      sheet.locator(".lot-count .t-row"),
      sheet.locator(".lot-count output"),
      sheet.getByRole("button", { name: "Позначити проданим · 1 шт." }),
      sheet.locator(".lot-price"),
      sheet.getByRole("button", { name: "Повернути постачальнику · 1 шт." }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({ path: `test-results/borrowed-lot-${name}.png` });

    // «Продано»'s stub: the sum the server counted, whole on one line; the
    // name wraps inside the stub (P2-3).
    await sheet
      .getByRole("button", { name: "Позначити проданим · 1 шт." })
      .click();
    const stub = page.locator(".borrowed-done .stub");
    const sum = stub.locator(".stub-sum .sum");
    await expect(sum).toHaveText("123 456,78 грн");
    const size = await sum.evaluate((node) =>
      parseFloat(getComputedStyle(node).fontSize),
    );
    expect((await sum.boundingBox())?.height ?? 0).toBeLessThan(size * 1.6);
    const say = stub.locator(".stub-say");
    await expect(say).toContainText(supplier.name);
    // Every line of the stub inside it, the name's two included.
    for (const line of await stub.locator("p").all())
      expect(
        await line.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    for (const part of [
      page.locator(".borrowed-done .result-title"),
      sum,
      say,
      stub.locator(".stub-line"),
      stub.getByRole("button", { name: "Відкрити накладну" }),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
    await page.screenshot({ path: `test-results/borrowed-sold-${name}.png` });
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
