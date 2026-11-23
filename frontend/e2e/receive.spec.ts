import {
  test,
  expect,
  expectFieldLine,
  expectHeldLook,
  expectNoticeLead,
  addModel,
  feels as feelsAs,
  haptics,
  blockRow,
  countTaps,
  dockOnMenu,
  leaveNewModel,
  more,
  newModelSheet,
  openStore,
  ownStub,
  receiveInto,
  receiveSize,
  receiveUnits,
  receiveWay,
  receiveWayDone,
  recordReceipt,
  refuseOnce,
  rowTitle,
  section,
  sheetRow,
  sizeCell,
  nothingFound,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  till_location_id: string;
  variant_id: string;
  size_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

interface ReceiptBody {
  command_id: string;
  location_id: string;
  notes: string | null;
  supplier_id?: string;
  lines: {
    product_variant_id: string;
    size_id: string;
    quantity: number;
    acquisition_type: string;
    unit_cost: string | null;
  }[];
}

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

/** A browser's page, unless `version` names Telegram's: then its
 * MainButton. */
function launch(version?: string): string {
  const hash = new URLSearchParams({ tgWebAppData: initData() });
  if (version) hash.set("tgWebAppVersion", version);
  return `/#${hash.toString()}`;
}

async function enter(page: Page): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Приймання");
}

async function find(page: Page, query: string): Promise<void> {
  await page.getByLabel("Пошук у каталозі").click();
  await page.getByLabel("Пошук у каталозі").fill(query);
}

/** A size's stepper, «+» tapped `times`. */
async function plus(page: Page, code: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1)
    await receiveSize(page, code)
      .getByRole("button", { name: "Більше" })
      .click();
}

function receipts(page: Page): ReceiptBody[] {
  const sent: ReceiptBody[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/inventory/receipts")
    )
      sent.push(request.postDataJSON() as ReceiptBody);
  });
  return sent;
}

test("a delivery of a known model is received into an explicitly chosen warehouse", async ({
  page,
}) => {
  const sent = receipts(page);
  await enter(page);
  // Two warehouses and more take deliveries, so none is chosen; «Брак»
  // takes none.
  const chips = page.getByRole("group", { name: "Склад", exact: true });
  await expect(
    chips.getByRole("button", { name: "Каса-склад", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(chips.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(
    chips.getByRole("button", { name: "Брак", exact: true }),
  ).toHaveCount(0);
  await expect(recordReceipt(page, 0)).toBeDisabled();
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  // The model chosen is a line with «Змінити», the cursor on its name; the
  // catalogue is put away.
  await expect(page.locator(".receive-model p")).toBeFocused();
  await expect(page.getByLabel("Пошук у каталозі")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Змінити модель Лоран шоколад/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Додати ще модель" }),
  ).toBeDisabled();
  // Typed, or stepped: digits only, 10000 at most.
  const m = receiveSize(page, "M").getByLabel("M, шт.");
  await m.fill("123456");
  await expect(m).toHaveValue("10000");
  await m.fill("4 шт");
  await expect(m).toHaveValue("4");
  await plus(page, "M", 1);
  await expect(m).toHaveValue("5");
  // A size's count goes on to the next by Enter, the last's «done» puts the
  // keyboard away; nothing changes, nothing is sent (audit 2026-11-13,
  // goods P2-3).
  const counts = page.locator(".receive-sizes input");
  const many = await counts.count();
  expect(many).toBeGreaterThan(1);
  for (let at = 0; at < many - 1; at += 1)
    await expect(counts.nth(at)).toHaveAttribute("enterkeyhint", "next");
  await expect(counts.nth(many - 1)).toHaveAttribute("enterkeyhint", "done");
  await counts.nth(0).press("Enter");
  await expect(counts.nth(1)).toBeFocused();
  await counts.nth(many - 1).press("Enter");
  await expect(counts.nth(many - 1)).not.toBeFocused();
  await expect(m).toHaveValue("5");
  // Stepped back to 0, «−» is held and keeps the cursor.
  await plus(page, "L", 1);
  const fewer = receiveSize(page, "L").getByRole("button", { name: "Менше" });
  await fewer.click();
  await expect(fewer).toBeFocused();
  await expect(fewer).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await expect(receiveSize(page, "L").getByLabel("L, шт.")).toHaveValue("0");
  // Counted, with no warehouse chosen: nothing to record yet.
  await expect(page.locator(".receive-total")).toHaveText("5 шт.");
  await expect(recordReceipt(page, 5)).toBeDisabled();
  await receiveInto(page, "Каса-склад");
  await expect(page.locator(".receive-total")).toHaveText(
    "5 шт. · склад «Каса-склад»",
  );
  const sheet = await receiveWay(page);
  // The price's «next» takes the cursor to the note, whose «done» puts the
  // keyboard away: the sheet stays, nothing is sent (audit 2026-11-13,
  // goods P2-3).
  const price = sheet.getByLabel(/^Закупівельна ціна за шт\./);
  const note = sheet.getByLabel("Примітка (накладна, постачальник)");
  await expect(price).toHaveAttribute("enterkeyhint", "next");
  await expect(note).toHaveAttribute("enterkeyhint", "done");
  await price.press("Enter");
  await expect(note).toBeFocused();
  await note.fill("Накладна 17");
  await note.press("Enter");
  await expect(note).not.toBeFocused();
  // The cursor left on the sheet, where Escape still closes it (review).
  await expect(sheet).toBeFocused();
  expect(sent).toHaveLength(0);
  await receiveWayDone(sheet);
  await expect(
    page.getByRole("button", {
      name: "Як надійшов: Закупівля · ціна не вказана · Накладна 17",
    }),
  ).toBeVisible();
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25); what was counted is in
  // the list, and sent again it is the same delivery.
  await refuseOnce(page, "**/api/v1/inventory/receipts", 422);
  await recordReceipt(page, 5).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Нічого не прийнято, список збережено. Перевірте рядки.",
  );
  await expect(
    page
      .getByRole("region", { name: "У поставці" })
      .getByText("5 шт. · Закупівля"),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/inventory/receipts", 409);
  await recordReceipt(page, 5).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Нічого не прийнято, список збережено: поки ви працювали, дані змінилися. Перевірте рядки й натисніть «Записати прихід» ще раз.",
  );
  // A request naming nothing: what was not done, then what to check —
  // never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/inventory/receipts", 404);
  await recordReceipt(page, 5).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Нічого не прийнято, список збережено. Перевірте рядки.",
  );
  const posted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/inventory/receipts") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await recordReceipt(page, 5).click();
  const response = await posted;
  // The delivery's permanent identity travels with it (ADR-0006), the same
  // through every refusal.
  expect(sent).toHaveLength(4);
  expect(sent.map((body) => body.lines.length)).toEqual([1, 1, 1, 1]);
  expect(sent[0]?.command_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Set(sent.map((body) => body.command_id)).size).toBe(1);
  expect(sent[3]?.location_id).toBe(fixture.till_location_id);
  expect(sent[3]?.notes).toBe("Накладна 17");
  expect(sent[3]?.lines.map((line) => line.quantity)).toEqual([5]);
  expect(await response.request().headerValue("Idempotency-Key")).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  const receipt = (await response.json()) as {
    lines: { quantity_received: number; quantity_after: number }[];
  };
  await expect(
    page.getByRole("heading", {
      name: "Прийшло 5 шт. · склад «Каса-склад» · Закупівля",
    }),
  ).toBeFocused();
  await expect(
    page.getByText(
      `+5 · тепер на складі ${String(receipt.lines[0]?.quantity_after)}`,
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/receive-mobile.png",
    fullPage: true,
  });
  // One line, and «Прийняти ще» under the thumb, the screen's main in its
  // dock at the menu's top (audit 2026-11-13, frame P2-9).
  const dock = await dockOnMenu(page);
  await expect(dock.getByRole("button")).toHaveText("Прийняти ще");
  await expect(dock.getByRole("button")).toHaveClass(/\bprimary\b/);
  // «Прийняти ще»: the warehouse and the model kept, nothing counted.
  await page.getByRole("button", { name: "Прийняти ще" }).click();
  await expect(
    chips.getByRole("button", { name: "Каса-склад", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(receiveSize(page, "M").getByLabel("M, шт.")).toHaveValue("0");
  await expect(recordReceipt(page, 0)).toBeDisabled();
});

test("a delivery carries what the shop paid, and shows back what was stored", async ({
  page,
}) => {
  // The owner's answer of 2026-09-30: a seller may enter and see the cost.
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 5);

  // Money is typed as a person writes it, and refused when it is not money:
  // «Готово» says so in the sheet; closed another way, the row says it.
  let sheet = await receiveWay(page);
  await sheet
    .getByLabel("Закупівельна ціна за шт., грн (необов’язково)")
    .fill("12,345");
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet.getByRole("alert")).toHaveText(
    "Закупівельну ціну вкажіть у гривнях, до копійок, наприклад 1850,50.",
  );
  // A field's line under it, never a refusal's plate (audit 2026-11-18,
  // frame P2-2).
  await expectFieldLine(sheet.getByRole("alert"));
  await page.locator(".sheet-scrim").click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Як надійшов: Закупівля · ціна з помилкою",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await expect(page.getByText(/до копійок, наприклад 1850,50/)).toBeVisible();
  // A price still being typed, its comma last, is the price as it stands:
  // «Готово» takes it, the row says it (audit 2026-11-18, sale P2-1).
  sheet = await receiveWay(page);
  await sheet
    .getByLabel("Закупівельна ціна за шт., грн (необов’язково)")
    .fill("1850,");
  await receiveWayDone(sheet);
  await expect(
    page.getByRole("button", {
      name: "Як надійшов: Закупівля · 1 850,00 грн за шт.",
    }),
  ).toBeVisible();
  sheet = await receiveWay(page);
  await sheet
    .getByLabel("Закупівельна ціна за шт., грн (необов’язково)")
    .fill("1850,50");
  await receiveWayDone(sheet);
  await expect(
    page.getByRole("button", {
      name: "Як надійшов: Закупівля · 1 850,50 грн за шт.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await expect(
    page.getByText("5 шт. · Закупівля · 1 850,50 грн за шт."),
  ).toBeVisible();
  // The next model starts afresh: its field, and no price.
  await expect(page.getByLabel("Пошук у каталозі")).toBeFocused();
  await expect(
    page.getByRole("button", {
      name: "Як надійшов: Закупівля · ціна не вказана",
    }),
  ).toBeVisible();

  // The same size at the same price is a line already listed.
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 2);
  sheet = await receiveWay(page);
  await sheet
    .getByLabel("Закупівельна ціна за шт., грн (необов’язково)")
    .fill("1850,50");
  await receiveWayDone(sheet);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Такий рядок уже в списку. Приберіть його, щоб змінити кількість.",
  );
  // A second line with no price: counted in units, left out of the value.
  sheet = await receiveWay(page);
  await sheet
    .getByLabel("Закупівельна ціна за шт., грн (необов’язково)")
    .fill("");
  await receiveWayDone(sheet);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await expect(page.locator(".receive-total")).toHaveText(
    "7 шт. · склад «Каса-склад»",
  );
  await expect(
    page.getByText("Закупівельна вартість 9 252,50 грн"),
  ).toBeVisible();
  await expect(page.getByText(/Рядків без ціни: 1/)).toBeVisible();

  const posted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/inventory/receipts") &&
      r.request().method() === "POST",
  );
  await recordReceipt(page, 7).click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const sent = response.request().postDataJSON() as ReceiptBody;
  expect(sent.lines.map((line) => [line.quantity, line.unit_cost])).toEqual([
    [5, "1850.50"],
    [2, null],
  ]);
  // What is shown back is what the server stored, not what was typed.
  await expect(
    page.getByRole("heading", {
      name: "Прийшло 7 шт. · склад «Каса-склад» · Закупівля",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/\+5 · тепер на складі \d+ · 1\s850,50\sгрн за шт\./),
  ).toBeVisible();
  await expect(
    page.getByText("Закупівельна вартість 9 252,50 грн"),
  ).toBeVisible();
});

test("a brand-new model nobody holds any of can be received", async ({
  page,
}) => {
  // The property this screen exists for: the till's stock search could never
  // offer a model with no balance, and a delivery is usually exactly that.
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const model = `Прийом ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: model,
      variant: { color: "смарагд" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);

  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, model);
  await expect(page.getByRole("radio")).toHaveCount(1);
  await page.getByRole("radio", { name: new RegExp(model) }).click();
  await plus(page, "M", 3);
  await recordReceipt(page, 3).click();
  await expect(
    page.getByRole("heading", { name: /^Прийшло 3 шт\./ }),
  ).toBeVisible();
  await expect(page.getByText("+3 · тепер на складі 3")).toBeVisible();
});

test("a definite refusal keeps the list and says nothing was received", async ({
  page,
}) => {
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((done) => {
    answer = done;
  });
  await page.route("**/api/v1/inventory/receipts", async (route) => {
    await answered;
    await route.fulfill({
      status: 403,
      json: { code: "LOCATION_ACCESS_DENIED", message: "No" },
    });
  });
  const sent = receipts(page);
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 2);
  await recordReceipt(page, 2).click();
  // Its first send is its press's to say: the ring, never a kept stub nor
  // a banner (stage 2, orders task list, P0-1).
  await expect(page.locator(".order-dock .eyelet-spin")).toHaveCount(1);
  await expect(page.locator(".stub-kept, .banner-kept")).toHaveCount(0);
  answer();
  await expect(
    page.getByText(/ Нічого не прийнято, список збережено\.$/),
  ).toBeVisible();
  await expect(page.getByText("2 шт. · Закупівля")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Приймання ще не підтверджено" }),
  ).toHaveCount(0);
  // A size counted after it is another delivery; sent again unchanged, the
  // same one; a line taken out, another again.
  await plus(page, "L", 1);
  await recordReceipt(page, 3).click();
  await expect.poll(() => sent.length).toBe(2);
  await recordReceipt(page, 3).click();
  await expect.poll(() => sent.length).toBe(3);
  await page
    .getByRole("button", { name: /^Прибрати Лоран шоколад.* · L$/ })
    .click();
  await recordReceipt(page, 2).click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent.map((body) => body.lines.map((line) => line.quantity))).toEqual([
    [2],
    [2, 1],
    [2, 1],
    [2],
  ]);
  const [first, counted, again, removed] = sent.map((body) => body.command_id);
  expect(counted).not.toBe(first);
  expect(again).toBe(counted);
  expect(removed).not.toBe(again);
});

test("a delivery whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  const keys: (string | null)[] = [];
  const commands: string[] = [];
  await page.route("**/api/v1/inventory/receipts", async (route) => {
    keys.push(await route.request().headerValue("Idempotency-Key"));
    commands.push(
      (route.request().postDataJSON() as { command_id: string }).command_id,
    );
    if (keys.length === 1) {
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 1);
  await recordReceipt(page, 1).click();
  // On «Прийшов товар», its own screen: the sale's stub, still attached
  // (stage 2, orders task list, P0-1), under the title and its line, over
  // the delivery (audit 2026-11-15, frame P2-9).
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await ownStub(page, "Прийшов товар", "Приймання ще не підтверджено");
  await expect(kept.locator(".stub-head")).toHaveText("Ще не підтверджено");
  await expect(
    kept.getByRole("heading", { name: "Приймання ще не підтверджено" }),
  ).toBeVisible();
  // The till, too, waits: nothing else happens until this is settled.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат приймання" })
    .click();
  // Confirmed: torn off, once (В-ЗП2 (а)), where it stood.
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await ownStub(page, "Прийшов товар", "Приймання записано один раз");
  await expect(
    kept.getByRole("heading", { name: "Приймання записано один раз" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Приймання ще не підтверджено" }),
  ).toHaveCount(0);
  expect(keys[1]).toBe(keys[0]);
  expect(commands[1]).toBe(commands[0]);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  // Proven recorded, the screen starts afresh: its list, edited, would be
  // recorded again (review, 2026-11-03).
  await expect(page.getByRole("region", { name: "У поставці" })).toHaveCount(0);
  await expect(recordReceipt(page, 0)).toBeDisabled();
});

test("a kept delivery confirmed while the phone keeps an invoice operation it cannot read leaves «Прийшов товар» held, as the till is (audit 2026-11-13, frame Д4; review)", async ({
  page,
}) => {
  // Whoever may see the suppliers' invoices: their kept operation is read.
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = [...new Set([...store.permissions, "supplier:debt"])];
    await route.fulfill({ response, json: body });
  });
  let first = true;
  await page.route("**/api/v1/inventory/receipts", async (route) => {
    if (first) {
      first = false;
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 1);
  await recordReceipt(page, 1).click();
  await expect(
    page.getByRole("heading", { name: "Приймання ще не підтверджено" }),
  ).toBeVisible();
  // The phone keeps an invoice operation too, one it cannot read; Бірка is
  // opened again, on «Прийшов товар» and its kept delivery.
  await page.evaluate(() => {
    const kept = Object.keys(localStorage).find((key) =>
      key.startsWith("birka:receipt-pending:"),
    );
    if (kept === undefined) throw new Error("no kept delivery");
    localStorage.setItem(
      kept.replace("birka:receipt-pending:", "birka:supplier-invoice-pending:"),
      "{not an invoice",
    );
  });
  await page.goto("about:blank");
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "збережену операцію з накладною" }),
  ).toBeVisible();
  // Opened again, the phone checks the kept delivery by itself.
  await expect(
    page.getByRole("heading", { name: "Приймання записано один раз" }),
  ).toBeVisible();
  // The delivery settled, the invoice is not: no other delivery begins.
  await expect(
    page.getByRole("heading", { name: "Прийшов товар" }),
  ).toBeVisible();
  await expect(page.getByLabel("Пошук у каталозі")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
});

test("a read that fails again keeps the warehouses and the sizes counted, and the button records what is shown", async ({
  page,
}) => {
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 1);
  // Back from another chat on a poor line: read again, refused.
  for (const path of [
    "**/api/v1/catalog/sizes?*",
    "**/api/v1/stock-locations?*",
  ])
    await page.route(path, async (route) => {
      await route.fulfill({
        status: 503,
        json: { code: "UNAVAILABLE", message: "No" },
      });
    });
  const failed = page.waitForResponse(
    (r) => r.url().includes("/api/v1/catalog/sizes?") && r.status() === 503,
  );
  await page.evaluate(() => {
    // Where the queries' focus listens: the window.
    window.dispatchEvent(new Event("visibilitychange"));
  });
  await failed;
  await expect(receiveSize(page, "M").getByLabel("M, шт.")).toHaveValue("1");
  await expect(
    page
      .getByRole("group", { name: "Склад", exact: true })
      .getByRole("button", { name: "Каса-склад", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Спробувати ще раз" }),
  ).toHaveCount(0);
  await expect(recordReceipt(page, 1)).toBeEnabled();
});

test("receiving needs its own permission", async ({ page }) => {
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
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  // «Ще» › «Товар» without its row (navigation task list, P0-3; «Усе на
  // бірці» task list, P0-4).
  await more(page);
  await expect(
    page
      .getByRole("navigation", { name: "Ще" })
      .getByRole("button", { name: /^Брак( |$)/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Прийшов товар/ }),
  ).toHaveCount(0);
});

test("a first read refused says why with «Спробувати ще раз», which reads it again (stage 2, orders task list, P2-3)", async ({
  page,
}) => {
  let refused = true;
  await page.route("**/api/v1/stock-locations?*", async (route) => {
    if (refused) {
      await route.fulfill({
        status: 503,
        json: { code: "UNAVAILABLE", message: "No" },
      });
      return;
    }
    await route.continue();
  });
  await enter(page);
  const retry = page
    .getByRole("alert")
    .getByRole("button", { name: "Спробувати ще раз", exact: true });
  await expect(retry).toBeVisible();
  // The warning's plate, never a refusal's red (audit after stage 2, goods
  // P1-1).
  await expect(page.locator(".read-failure").getByRole("button")).toHaveText([
    "Спробувати ще раз",
  ]);
  await expect(
    page.getByRole("button", { name: "Повторити завантаження" }),
  ).toHaveCount(0);
  refused = false;
  await retry.click();
  await expect(
    page
      .getByRole("group", { name: "Склад", exact: true })
      .getByRole("button", { name: "Каса-склад", exact: true }),
  ).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test("a store with no warehouse to receive into says so, never who may (stage 2, goods task list, P1-5)", async ({
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
  await enter(page);
  // The blank tag, the same words (audit 2026-11-13, goods P2-1).
  const none = page.locator(".orders-empty", {
    hasText: "Тут немає складу для приймання.",
  });
  await expect(none).toBeVisible();
  await expect(none.locator(".orders-empty-mark")).toBeVisible();
  // The blank tag alone: nothing to count into, no search, no dock
  // (review).
  await expect(page.getByLabel("Пошук у каталозі")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Як надійшов/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: /^Записати прихід/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/Зверніться|може приймати/)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Склад" })).toHaveCount(0);
});

/** The store's two warehouses that take deliveries, as a shop has them —
 * the seed's store holds twenty — and two that take none: one paused, one
 * not received into. */
async function twoWarehouses(page: Page): Promise<void> {
  await page.route("**/api/v1/stock-locations?*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { id: string; name: string }[];
    const two = body.filter(
      (location) =>
        location.id === fixture.location_id ||
        location.id === fixture.till_location_id,
    );
    const [one] = two;
    await route.fulfill({
      response,
      json: [
        ...two,
        { ...one, id: randomUUID(), name: "Склад на паузі", is_active: false },
        {
          ...one,
          id: randomUUID(),
          name: "Склад без приймання",
          can_receive: false,
        },
      ],
    });
  });
}

test("a model in two sizes in 7 taps: «M 2, L 1» as the notebook has it, one delivery with every line («Усе на бірці» sections task list, P1-4; the search live, stage 2, goods task list, P0-1)", async ({
  page,
}) => {
  await twoWarehouses(page);
  const sent = receipts(page);
  await enter(page);
  const chips = page.getByRole("group", { name: "Склад", exact: true });
  await expect(chips.getByRole("button")).toHaveText([
    "Основний склад",
    "Каса-склад",
  ]);
  const taps = await countTaps(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 2);
  await plus(page, "L", 1);
  await recordReceipt(page, 3).click();
  await expect(
    page.getByRole("heading", {
      name: "Прийшло 3 шт. · склад «Каса-склад» · Закупівля",
    }),
  ).toBeVisible();
  // Eight before the search was live: «Знайти» is no tap now.
  expect(await taps()).toBe(7);
  // One delivery, its lines a size each.
  expect(sent).toHaveLength(1);
  expect(
    sent[0]?.lines.map((line) => [line.product_variant_id, line.quantity]),
  ).toEqual([
    [fixture.variant_id, 2],
    [fixture.variant_id, 1],
  ]);
  expect(sent[0]?.supplier_id).toBeUndefined();
});

test("two models in one delivery: «Додати ще модель» lists the first, «Змінити» clears what was counted, and the record holds both", async ({
  page,
}) => {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  // After «Лоран» in the till's list, which is by name: the sale journeys
  // sell its first line two at a time, and this one is left with one.
  const other = `Прийом друга ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: other,
      variant: { color: "пісок" },
      sizes: [{ system: "ALPHA", code: "L" }],
    },
  });
  expect(created.status()).toBe(201);
  const sent = receipts(page);
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 2);
  await plus(page, "L", 1);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  // A line a size, each «Прибрати» named by it.
  await page
    .getByRole("button", { name: /^Прибрати Лоран шоколад.* · L$/ })
    .click();
  await expect(page.getByText("1 шт. · Закупівля")).toHaveCount(0);
  await expect(page.getByText("2 шт. · Закупівля")).toBeVisible();
  await find(page, other);
  await page.getByRole("radio", { name: new RegExp(other) }).click();
  await plus(page, "L", 4);
  await expect(recordReceipt(page, 6)).toBeEnabled();
  // Another model chosen instead: what was counted of this one goes.
  await page
    .getByRole("button", { name: new RegExp(`^Змінити модель ${other}`) })
    .click();
  await expect(recordReceipt(page, 2)).toBeEnabled();
  await find(page, other);
  await page.getByRole("radio", { name: new RegExp(other) }).click();
  await expect(receiveSize(page, "L").getByLabel("L, шт.")).toHaveValue("0");
  await plus(page, "L", 1);
  await recordReceipt(page, 3).click();
  await expect(
    page.getByRole("heading", { name: /^Прийшло 3 шт\./ }),
  ).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.lines.map((line) => line.quantity)).toEqual([2, 1]);
  await expect(page.getByText(new RegExp(`^${other}.* · L$`))).toBeVisible();
});

test("at 360 × 640 the model, four sizes' steppers and the button fit unscrolled, in both themes; a seller has no kinds («Усе на бірці» sections task list, P1-4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await twoWarehouses(page);
  // An organization with four sizes; the seed's gathers what journeys
  // leave.
  await page.route("**/api/v1/catalog/sizes?*", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { code: string }[];
    const m = body.find((one) => one.code === "M");
    const l = body.find((one) => one.code === "L");
    await route.fulfill({
      response,
      json: [
        { size_id: randomUUID(), code: "S", system: "ALPHA" },
        m,
        l,
        { size_id: randomUUID(), code: "XL", system: "ALPHA" },
      ],
    });
  });
  // A seller, who keeps no suppliers' debts.
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter(
        (p) => p !== "supplier:debt",
      );
    await route.fulfill({ response, json: body });
  });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await enter(page);
    await receiveInto(page, "Каса-склад");
    await find(page, "лоран шоколад");
    await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
    await plus(page, "S", 1);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: `test-results/receive-360-${scheme}.png` });
    const view = page.viewportSize();
    const dock = await recordReceipt(page, 1).boundingBox();
    const name = await page
      .getByRole("button", { name: /^Змінити модель/ })
      .boundingBox();
    expect(dock).not.toBeNull();
    expect(name).not.toBeNull();
    if (!dock || !name || !view) return;
    expect(dock.y + dock.height).toBeLessThanOrEqual(view.height);
    expect(name.y).toBeGreaterThanOrEqual(0);
    for (const code of ["S", "M", "L", "XL"]) {
      const box = await receiveSize(page, code).boundingBox();
      expect(box, code).not.toBeNull();
      if (!box) return;
      // Above the dock, inside the page's width: nothing scrolled to.
      expect(box.y + box.height, code).toBeLessThanOrEqual(dock.y);
      expect(box.x + box.width, code).toBeLessThanOrEqual(view.width);
      const plus = await receiveSize(page, code)
        .getByRole("button", { name: "Більше" })
        .boundingBox();
      expect(plus?.width, code).toBeGreaterThanOrEqual(44);
      expect(plus?.height, code).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    // The seller's sheet: no kinds, the price and the note.
    const sheet = await receiveWay(page);
    await expect(sheet.getByRole("group", { name: "Як надійшов" })).toHaveCount(
      0,
    );
    await expect(
      sheet.getByLabel("Закупівельна ціна за шт., грн (необов’язково)"),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/receive-360-${scheme}-sheet.png`,
    });
    await receiveWayDone(sheet);
  }
});

test("a delivery holds 200 lines at most, as the server takes them: past them it is said, and nothing is sent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // An organization of 201 sizes, each counted once.
  await page.route("**/api/v1/catalog/sizes?*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: Array.from({ length: 201 }, (_, i) => ({
        size_id: randomUUID(),
        code: String(i + 1),
        system: "NUMERIC",
      })),
    });
  });
  const sent = receipts(page);
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  for (let i = 1; i <= 201; i += 1) await receiveUnits(page, String(i), 1);
  const said =
    "В одній поставці — до 200 рядків. Запишіть цю, а решту прийміть окремою поставкою.";
  await recordReceipt(page, 201).click();
  await expect(page.getByRole("alert")).toHaveText(said);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await expect(page.getByRole("alert")).toHaveText(said);
  expect(sent).toHaveLength(0);
});

test("inside Telegram the MainButton records it: held at nothing counted, put away under the sheet, a light tap on «+», «success» once recorded, and closing asked while counted", async ({
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
  const told = (event: string): Promise<unknown[]> =>
    page.evaluate(
      (wanted) =>
        (window as unknown as { told: [string, unknown][] }).told
          .filter(([name]) => name === wanted)
          .map(([, data]) => data),
      event,
    );
  const main = async (): Promise<unknown> =>
    (await told("web_app_setup_main_button")).at(-1) ?? null;
  await page.goto(launch("6.2"));
  await openStore(page, "Основний MAIN");
  await section(page, "Приймання");
  // No dock: Telegram's own button.
  await expect(page.locator(".order-dock")).toHaveCount(0);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Записати прихід · 0 шт.",
  });
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 1);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Записати прихід · 1 шт.",
  });
  expect(await told("web_app_trigger_haptic_feedback")).toContainEqual({
    type: "impact",
    impact_style: "light",
  });
  await expect
    .poll(async () => (await told("web_app_setup_closing_behavior")).at(-1))
    .toEqual({ need_confirmation: true });
  // The price in its sheet: its MainButton the one there is, «Записати
  // прихід» put away under it, none of the form's own; Telegram's «Назад»
  // leaves it, nothing saved, and «Записати прихід» is back with the
  // count (goods task list after stage 2, P1-3).
  // Its price read again as the sheet opens, and refused: the plate in the
  // sheet and no MainButton of its form — «Записати прихід» still put away
  // under it (review).
  let refused = false;
  await page.route("**/api/v1/catalog/prices?*", async (route) => {
    if (!refused && route.request().method() === "GET") {
      refused = true;
      await route.fulfill({
        status: 503,
        json: { code: "UNAVAILABLE", message: "No" },
      });
      return;
    }
    await route.fallback();
  });
  await page.getByRole("button", { name: "Змінити ціну", exact: true }).click();
  const price = page.getByRole("dialog", { name: /Лоран шоколад/ });
  await expect(price).toHaveAttribute("data-ready", "");
  await expect(price.locator(".read-failure")).toBeVisible();
  await expect.poll(main).toMatchObject({ is_visible: false });
  await price.getByRole("button", { name: "Спробувати ще раз" }).click();
  await price
    .locator(".keypad-keys")
    .getByRole("button", { name: "5", exact: true })
    .click();
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Зберегти · 5,00\u00a0грн",
  });
  await expect(price.getByRole("button", { name: /^Зберегти/ })).toHaveCount(0);
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "back_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await expect(price).toHaveCount(0);
  await expect
    .poll(main)
    .toMatchObject({ is_visible: true, text: "Записати прихід · 1 шт." });
  // Under the sheet it is put away, and back once the sheet closes.
  const sheet = await receiveWay(page);
  await expect.poll(main).toMatchObject({ is_visible: false });
  await receiveWayDone(sheet);
  await expect
    .poll(main)
    .toMatchObject({ is_visible: true, text: "Записати прихід · 1 шт." });
  await page.evaluate(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: "main_button_pressed" }),
        source: window.parent,
      }),
    );
  });
  await expect(
    page.getByRole("heading", { name: /^Прийшло 1 шт\./ }),
  ).toBeVisible();
  await expect.poll(main).toMatchObject({ is_visible: false });
  expect(await told("web_app_trigger_haptic_feedback")).toContainEqual({
    type: "notification",
    notification_type: "success",
  });
  await expect
    .poll(async () => (await told("web_app_setup_closing_behavior")).at(-1))
    .toEqual({ need_confirmation: false });
});

/** A bearer for the API, as the journeys that make their own models. */
async function bearer(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

/** The delivery's first model, counted: «Лоран шоколад» M × 2 and L × 1,
 * then «Додати ще модель» — two lines the sheet must leave where they are. */
async function firstLine(page: Page): Promise<void> {
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
  await plus(page, "M", 2);
  await plus(page, "L", 1);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await twoLines(page);
}
/** The first model's two lines, where they were. */
async function twoLines(page: Page): Promise<void> {
  await expect(page.getByText("2 шт. · Закупівля")).toBeVisible();
  await expect(page.getByText("1 шт. · Закупівля")).toBeVisible();
}

test("a coat the catalogue has not is added from the empty search, in the sheet «Нова модель» over the delivery: the line counted stays, the model is chosen and said, and its words are the proposal «Перевірка каталогу» confirmed (stage 2, goods task list, P0-1; В-Г1 (а))", async ({
  page,
}) => {
  const sent = receipts(page);
  await enter(page);
  await firstLine(page);
  const name = `Новинка ${randomUUID().slice(0, 8)}`;
  // A long word typed with no space: the line and its button wrap, nothing
  // past a 360 phone's width, in both themes (audit 2026-11-18, goods P2-4;
  // review).
  const long = `Новинкабезпробілу${randomUUID().replaceAll("-", "")}`;
  const size = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 640 });
  await find(page, long);
  const wide = await nothingFound(page, `Нічого не знайшли за «${long}»`);
  await expect(
    wide.getByRole("button", { name: `Додати нову модель «${long}»` }),
  ).toBeVisible();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
  await page.emulateMedia({ colorScheme: "light" });
  if (size) await page.setViewportSize(size);
  await find(page, name);
  // Nothing found is said — the blank tag, heard — and the model added
  // from its one button (audit 2026-11-18, goods P2-4).
  const none = await nothingFound(page, `Нічого не знайшли за «${name}»`);
  await expect(none.getByRole("button")).toHaveText([
    `Додати нову модель «${name}»`,
  ]);
  await none
    .getByRole("button", { name: `Додати нову модель «${name}»` })
    .click();
  const sheet = await newModelSheet(page);
  // Its words as searched, sent as they stand by «Далі».
  await expect(sheet.getByLabel("Як записано")).toHaveValue(name);
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  // The catalogue's models offered, none chosen for the person: no
  // confirmation until one is. The cursor on the step's words, not lost.
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  await expect(sheet.getByText(`«${name}»`)).toBeFocused();
  await expect(
    sheet.getByRole("button", { name: /^Це вона: / }).first(),
  ).toBeVisible();
  await expect(sheet.getByRole("button", { pressed: true })).toHaveCount(0);
  // In the sheet, white already: rows 64 with no block (audit 2026-11-15,
  // goods P2-2).
  const offered = sheet.locator(".new-model-candidates > li");
  await sheetRow(offered.first());
  await rowTitle(offered.first().locator(".new-model-name strong"));
  await expect(sheet.getByRole("button", { name: /^Підтвердити/ })).toHaveCount(
    0,
  );
  await expect(
    sheet.getByRole("button", { name: "Оберіть модель" }),
  ).toBeDisabled();
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await expect(sheet.getByText(`«${name}»`)).toBeFocused();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await sheet.getByLabel("Колір", { exact: true }).fill("графіт");
  // A size typed by hand asks its system, none chosen, and again once its
  // letters change; the same letters typed twice are one size, whichever
  // system (ADR-0009; review).
  const typed = sheet.getByLabel("Іншого розміру немає — впишіть");
  const systems = sheet.getByRole("group", { name: "Система розміру" });
  const addSize = sheet.getByRole("button", { name: "Додати розмір" });
  await typed.fill("R52");
  await expect(systems.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(addSize).toBeDisabled();
  await systems.getByRole("button", { name: "Числова EU" }).click();
  await typed.fill("R54");
  await expect(systems.getByRole("button", { pressed: true })).toHaveCount(0);
  await expect(addSize).toBeDisabled();
  await systems.getByRole("button", { name: "Числова EU" }).click();
  await addSize.click();
  await expect(sizeCell(sheet, "R54")).toHaveAttribute("aria-pressed", "true");
  await typed.fill("r54");
  await expect(systems).toHaveCount(0);
  await addSize.click();
  await expect(sizeCell(sheet, "R54")).toHaveCount(1);
  await expect(addModel(sheet)).toHaveText("Додати модель · 1 розмір");
  // Taken off again: only the sizes chosen go.
  await sizeCell(sheet, "R54").click();
  await expect(sizeCell(sheet, "R54")).toHaveCount(0);
  // Every size at once; the stock is not added here.
  await sizeCell(sheet, "M").click();
  await sizeCell(sheet, "L").click();
  await expect(
    sheet.getByText("Залишок не додається — кількість впишете тут."),
  ).toBeVisible();
  await expect(addModel(sheet)).toHaveText("Додати модель · 2 розміри");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/create-product") && r.status() === 200,
  );
  await addModel(sheet).click();
  const decision = (await (await response).json()) as {
    status: string;
    preview: { raw_text: string };
    creation: { sizes: { code: string }[] };
  };
  // Chosen where its count is typed, and said so; the first lines where
  // they were.
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^Модель додано/ }),
  ).toHaveText(`Модель додано: ${name} графіт. Кількість впишіть тут.`);
  const change = page.getByRole("button", {
    name: new RegExp(`^Змінити модель ${name} графіт`),
  });
  await expect(change).toBeVisible();
  await twoLines(page);
  // Searched for again, it is found at once — never the empty answer
  // remembered from before it was added, while the server's is awaited
  // (review).
  await change.click();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/catalog/receivable-variants**", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByLabel("Пошук у каталозі").fill(name);
  const found = page.getByRole("radio", { name: `${name} графіт` });
  await expect(found).toBeVisible();
  await expect(page.getByText(/^Нічого не знайшли/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Додати нову модель/ }),
  ).toHaveCount(0);
  release();
  await found.click();
  await plus(page, "L", 1);
  await recordReceipt(page, 4).click();
  await expect(
    page.getByRole("heading", { name: /^Прийшло 4 шт\./ }),
  ).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.lines.map((line) => line.quantity)).toEqual([2, 1, 1]);
  // The proposal «Перевірка каталогу» holds: the words as typed, confirmed
  // by the model made in both sizes.
  expect(decision.status).toBe("APPLIED");
  expect(decision.preview.raw_text).toBe(name);
  expect(decision.creation.sizes.map((size) => size.code).sort()).toEqual([
    "L",
    "M",
  ]);
});

test("without the right to create or to confirm in the catalogue, an empty search only says so: no model is offered to add (stage 2, goods task list, P0-1)", async ({
  page,
}) => {
  let without = "catalog:create";
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => p !== without);
    await route.fulfill({ response, json: body });
  });
  for (const right of ["catalog:create", "catalog:confirm"]) {
    without = right;
    // A page loaded afresh: its rights read again, not the last pass's.
    await page.goto("about:blank");
    await enter(page);
    await receiveInto(page, "Каса-склад");
    const missing = `Немає такої ${randomUUID().slice(0, 8)}`;
    await find(page, missing);
    await expect(
      page.getByText(`Нічого не знайшли за «${missing}»`),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Додати нову модель/ }),
    ).toHaveCount(0);
  }
});

test("the catalogue is searched as it is typed, from two letters, once typing pauses: no «Знайти» (stage 2, goods task list, P0-1)", async ({
  page,
}) => {
  await enter(page);
  await receiveInto(page, "Каса-склад");
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/catalog/receivable-variants"))
      asked.push(new URL(request.url()).searchParams.get("query") ?? "");
  });
  await expect(
    page.getByRole("button", { name: "Знайти", exact: true }),
  ).toHaveCount(0);
  const field = page.getByLabel("Пошук у каталозі");
  await field.click();
  await field.pressSequentially("л");
  // One letter is not asked, however long it stands; two are.
  await page.waitForTimeout(700);
  expect(asked).toEqual([]);
  await field.pressSequentially("о");
  await expect.poll(() => asked).toEqual(["ло"]);
  await field.pressSequentially("ран шоколад", { delay: 40 });
  // Asked once more, for what stood as typing paused: not a letter at a
  // time.
  await expect.poll(() => asked).toEqual(["ло", "лоран шоколад"]);
  await expect(
    page.getByRole("radio", { name: /Лоран шоколад/ }),
  ).toBeVisible();
});

test("inside Telegram the sheet's one button is its MainButton — «Далі», held «Оберіть модель», «Додати модель · 2 розміри» — never the delivery's from under it, and «Назад» hidden while it waits; at 360 px the sheet keeps to the screen in both themes (stage 2, goods task list, P0-1)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      main: unknown;
      back: unknown;
    };
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_main_button")
          host.main = JSON.parse(data) as unknown;
        if (event === "web_app_setup_back_button")
          host.back = JSON.parse(data) as unknown;
      },
    };
  });
  const main = (): Promise<unknown> =>
    page.evaluate(() => (window as unknown as { main: unknown }).main);
  const back = (): Promise<unknown> =>
    page.evaluate(() => (window as unknown as { back: unknown }).back);
  const sent = receipts(page);
  const press = (): Promise<void> =>
    page.evaluate(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ eventType: "main_button_pressed" }),
          source: window.parent,
        }),
      );
    });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(launch("8.0"));
  await openStore(page, "Основний MAIN");
  await section(page, "Приймання");
  // A delivery with its lines counted: «Записати прихід · 3 шт.» free
  // under the sheet.
  await firstLine(page);
  const name = `Телеграм ${randomUUID().slice(0, 8)}`;
  await find(page, name);
  await page
    .getByRole("button", { name: `Додати нову модель «${name}»` })
    .click();
  const sheet = await newModelSheet(page);
  // No button of its own: Telegram's says «Далі».
  await expect(sheet.locator(".sheet-done")).toHaveCount(0);
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Далі",
  });
  await press();
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  // Nothing chosen: the sheet's, held — never «Записати прихід» under it,
  // and pressed, nothing is sent.
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: false,
    text: "Оберіть модель",
  });
  await press();
  await expect(sheet.getByText("Може, це модель, що вже є?")).toBeVisible();
  expect(sent).toHaveLength(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({
      path: `test-results/new-model-similar-360-${scheme}.png`,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(name);
  await sizeCell(sheet, "M").click();
  await sizeCell(sheet, "L").click();
  await expect.poll(main).toMatchObject({
    is_visible: true,
    is_active: true,
    text: "Додати модель · 2 розміри",
  });
  // «Назад» closes the sheet while it is free.
  await expect.poll(back).toEqual({ is_visible: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // At most 92 % of the screen, nothing past its width.
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.height).toBeLessThanOrEqual(640 * 0.92 + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/new-model-360-${scheme}.png`,
    });
  }
  // While the model is on its way, no way out: «Назад» hidden (review).
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route(
    "**/api/v1/catalog/match-decisions/*/create-product",
    async (route) => {
      await answered;
      await route.continue();
    },
  );
  await press();
  await expect.poll(back).toEqual({ is_visible: false });
  await expect(sheet).toBeVisible();
  answer();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^Модель додано/ }),
  ).toHaveText(`Модель додано: ${name}. Кількість впишіть тут.`);
  // The delivery's own again, its lines as they were.
  await expect.poll(main).toMatchObject({
    text: "Записати прихід · 3 шт.",
  });
  await expect.poll(back).toEqual({ is_visible: true });
  expect(sent).toHaveLength(0);
});

test("a proposal kept on the phone and then refused is said in its own sheet, never in the next one opened (stage 2, goods task list, P0-1; review)", async ({
  page,
}) => {
  // Lost on the way; resent, the server proves it never recorded it.
  const never = {
    status: 409,
    json: {
      code: "CONFLICT",
      message: "Conflict",
      details: { recorded: false },
    },
  };
  let calls = 0;
  await page.route("**/api/v1/catalog/match-decisions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    if (calls === 1) return route.abort("failed");
    await route.fulfill(never);
  });
  await page.route("**/api/v1/catalog/match-decisions/*", async (route) => {
    if (route.request().method() !== "GET" || calls === 0)
      return route.continue();
    await route.fulfill(never);
  });
  await enter(page);
  await receiveInto(page, "Каса-склад");
  const first = `Загублена ${randomUUID().slice(0, 8)}`;
  await find(page, first);
  await page
    .getByRole("button", { name: `Додати нову модель «${first}»` })
    .click();
  const sheet = await newModelSheet(page);
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  await expect(
    sheet.getByRole("heading", {
      name: "Операцію каталогу ще не підтверджено",
    }),
  ).toBeVisible();
  // Resent by its button, or by the phone itself as the server answers.
  const again = sheet.getByRole("button", {
    name: "Перевірити результат операції",
  });
  await expect(async () => {
    if (await again.isVisible()) await again.click({ timeout: 1000 });
    await expect(sheet.getByRole("alert")).toContainText(
      "Операцію каталогу не записано",
      { timeout: 1000 },
    );
  }).toPass();
  await leaveNewModel(sheet);
  // Another empty search, another sheet: nothing of the last one said.
  const second = `Наступна ${randomUUID().slice(0, 8)}`;
  await find(page, second);
  await page
    .getByRole("button", { name: `Додати нову модель «${second}»` })
    .click();
  const next = await newModelSheet(page);
  await expect(next.getByLabel("Як записано")).toHaveValue(second);
  await expect(next.getByRole("alert")).toHaveCount(0);
  await leaveNewModel(next);
});

test("a name spelt like one the catalogue uses is offered its spelling, never given it; left, the sheet leaves the delivery as it was (stage 2, goods task list, P0-1; owner decision, 2026-10-03)", async ({
  page,
}) => {
  // A model the catalogue has; the sheet's name the same but for a Latin
  // «a».
  const tag = randomUUID().replace(/\D/g, "").slice(0, 8);
  const right = `Пальто ${tag}`;
  const typo = `Пaльто ${tag}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${await bearer(page)}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: right,
      variant: { color: "пісок" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  await enter(page);
  await firstLine(page);
  const missing = `Схоже ${tag}`;
  await find(page, missing);
  await page
    .getByRole("button", { name: `Додати нову модель «${missing}»` })
    .click();
  const sheet = await newModelSheet(page);
  await sheet.getByRole("button", { name: "Далі", exact: true }).click();
  await sheet.getByRole("button", { name: "Ні, це нова модель" }).click();
  await sheet.getByLabel("Назва моделі", { exact: true }).fill(typo);
  await sizeCell(sheet, "M").click();
  await addModel(sheet).click();
  // Offered, not put in its place: a warning's plate led by its line, no
  // heading (audit 2026-11-13, goods P2-5).
  await expect(sheet.getByText("Схожа назва вже є")).toBeVisible();
  const alike = sheet.getByRole("alert").filter({
    hasText: "Схожа назва вже є",
  });
  await expectNoticeLead(
    alike,
    alike.getByText("Схожа назва вже є", { exact: true }),
  );
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toHaveValue(
    typo,
  );
  await expect(
    sheet.getByRole("button", { name: "Це інша назва — створити як є" }),
  ).toBeVisible();
  await sheet.getByRole("button", { name: `Взяти «${right}»` }).click();
  await expect(sheet.getByLabel("Назва моделі", { exact: true })).toHaveValue(
    right,
  );
  // Left by «Назад»: nothing chosen, the delivery's line where it was.
  await leaveNewModel(sheet);
  await twoLines(page);
  await expect(
    page.getByRole("button", { name: /^Змінити модель/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Пошук у каталозі")).toHaveValue(missing);
});

test("«Прийшов товар» at 360 in both themes: the catalogue's models found as a list's rows on a white block; «У поставці» a white block of rows, a long name wrapped in its row, how many, how it came and its price under it, «Прибрати …» under them named as before, nothing past the width (audit 2026-11-15, goods P2-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // A model's name as long as a supplier's may write it: its words wrap in
  // the row, never past it.
  const tail = "пальто кокон подовжене з поясом і накладними кишенями";
  await page.route(
    "**/api/v1/catalog/receivable-variants?**",
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        items: { display_name: string }[];
      };
      for (const item of body.items)
        if (item.display_name.startsWith("Лоран шоколад"))
          item.display_name = `${item.display_name} ${tail}`;
      await route.fulfill({ response, json: body });
    },
  );
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "лоран шоколад");
  const radio = page
    .getByRole("radiogroup", { name: "Знайдені товари" })
    .getByRole("radio", { name: /Лоран шоколад/ })
    .first();
  await blockRow(radio);
  await rowTitle(radio);
  await radio.click();
  await plus(page, "M", 2);
  await plus(page, "L", 1);
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await twoLines(page);
  const lines = page
    .getByRole("region", { name: "У поставці" })
    .getByRole("listitem");
  await expect(lines).toHaveCount(2);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const line of await lines.all()) {
      await blockRow(line);
      const what = line.locator(".receive-line-what");
      await rowTitle(what);
      await expect(what).toContainText(tail);
      // Wrapped: two lines and more, inside the row's sides.
      const words = await what.boundingBox();
      const row = await line.boundingBox();
      const meta = await line.locator(".sale-meta").boundingBox();
      const remove = await line.getByRole("button").boundingBox();
      expect(words && row && meta && remove).toBeTruthy();
      if (!words || !row || !meta || !remove) return;
      expect(words.height).toBeGreaterThanOrEqual(40);
      expect(words.x + words.width).toBeLessThanOrEqual(
        row.x + row.width - 16 + 0.5,
      );
      // How many and how it came under the name, «Прибрати» under them.
      expect(meta.y).toBeGreaterThanOrEqual(words.y + words.height - 0.5);
      expect(remove.y).toBeGreaterThanOrEqual(meta.y + meta.height - 0.5);
      expect(remove.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `test-results/receive-lines-360-${scheme}.png`,
      fullPage: true,
    });
  }
  // «Прибрати» named by its line, as before.
  await expect(
    page.getByRole("button", { name: /^Прибрати Лоран шоколад.* · L$/ }),
  ).toHaveText(/^Прибрати Лоран шоколад/);
  await page
    .getByRole("button", { name: /^Прибрати Лоран шоколад.* · L$/ })
    .click();
  await expect(lines).toHaveCount(1);
  await blockRow(lines.first());
});

test("inside Telegram «Прийшов товар» is felt: a warehouse, a model or a way chosen anew as a choice, never the one chosen again; «−» as «+», nothing at 0; a price that is not money at «Готово», the same line twice and a refusal as an error — nothing as a price is typed (audit 2026-11-15, goods P2-3)", async ({
  page,
}) => {
  const felt = await haptics(page);
  const feels = (act: () => Promise<unknown>, want: unknown[]) =>
    feelsAs(felt, act, want);
  const selection = { type: "selection_change" };
  const light = { type: "impact", impact_style: "light" };
  const error = { type: "notification", notification_type: "error" };
  await page.goto(launch("6.2"));
  await openStore(page, "Основний MAIN");
  // Entered: nothing felt.
  const entered = (await felt()).length;
  await section(page, "Приймання");
  const place = page
    .getByRole("group", { name: "Склад", exact: true })
    .getByRole("button", { name: "Каса-склад", exact: true });
  await expect(place).toBeVisible();
  expect((await felt()).slice(entered)).toEqual([]);
  // A warehouse chosen: felt; the one chosen tapped again, nothing.
  await feels(() => place.click(), [selection]);
  await feels(() => place.click(), []);
  // A model chosen from what is found: felt.
  await find(page, "лоран шоколад");
  const radio = page.getByRole("radio", { name: /Лоран шоколад/ });
  await feels(() => radio.click(), [selection]);
  // «−» as «+»; at 0 it takes no tap, and nothing is felt.
  const down = receiveSize(page, "M").getByRole("button", { name: "Менше" });
  const up = receiveSize(page, "M").getByRole("button", { name: "Більше" });
  // Held at 0: a secondary taking no tap, never faded — the rule its twin
  // «Повернути постачальнику» shares (audit 2026-11-18, money P2-4 (а)).
  await expectHeldLook(down, "stepped");
  await feels(() => down.click({ force: true }), []);
  await feels(() => up.click(), [light]);
  await feels(() => down.click(), [light]);
  await feels(() => down.click({ force: true }), []);
  // «Як надійшов»: a way chosen anew felt, the one chosen nothing; a price
  // that is not money nothing as typed, an error at «Готово».
  const sheet = await receiveWay(page);
  const ways = sheet.getByRole("group", { name: "Як надійшов" });
  await feels(
    () => ways.getByRole("button", { name: "Закупівля", exact: true }).click(),
    [],
  );
  await feels(
    () => ways.getByRole("button", { name: "Під реалізацію" }).click(),
    [selection],
  );
  await feels(
    () => ways.getByRole("button", { name: "Закупівля", exact: true }).click(),
    [selection],
  );
  const price = sheet.getByLabel(/^Закупівельна ціна/);
  await feels(() => price.fill("1,2,3"), []);
  await feels(
    () => sheet.getByRole("button", { name: "Готово" }).click(),
    [error],
  );
  await expect(sheet.getByRole("alert")).toHaveText(
    "Закупівельну ціну вкажіть у гривнях, до копійок, наприклад 1850,50.",
  );
  // Read with its field, while it stands (audit 2026-11-22, goods P2-4).
  await expect(price).toHaveAttribute("aria-invalid", "true");
  await expect(price).toHaveAccessibleDescription(
    "Закупівельну ціну вкажіть у гривнях, до копійок, наприклад 1850,50.",
  );
  await price.fill("");
  await expect(price).not.toHaveAttribute("aria-describedby", /./);
  await receiveWayDone(sheet);
  // The same line twice: said at «Додати ще модель», felt as an error.
  await up.click();
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await find(page, "лоран шоколад");
  await feels(() => radio.click(), [selection]);
  await up.click();
  await feels(
    () => page.getByRole("button", { name: "Додати ще модель" }).click(),
    [error],
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Такий рядок уже в списку. Приберіть його, щоб змінити кількість.",
  );
  await down.click();
  // Refused by the server: said, and felt as the till's refusal.
  await refuseOnce(page, "**/api/v1/inventory/receipts", 422);
  await feels(
    () =>
      page.evaluate(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ eventType: "main_button_pressed" }),
            source: window.parent,
          }),
        );
      }),
    [error],
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Нічого не прийнято, список збережено. Перевірте рядки.",
  );
});

test("«Пошук у каталозі»: a model added on another phone between two pages moves the next by one — the row it repeats is shown once, no key said twice (audit 2026-11-22, goods Н1)", async ({
  page,
}) => {
  const said: string[] = [];
  page.on("console", (message) => {
    said.push(message.text());
  });
  const variant = (name: string) => ({
    product_variant_id: randomUUID(),
    display_name: name,
  });
  const first = Array.from({ length: 20 }, (_, i) =>
    variant(`Двічі ${String(i + 1).padStart(2, "0")}`),
  );
  // The next page asked from 20 after one more was added before: it starts
  // with the first page's last.
  const second = [first[19], variant("Двічі 21"), variant("Двічі 22")];
  await page.route(
    "**/api/v1/catalog/receivable-variants?**",
    async (route) => {
      const offset = new URL(route.request().url()).searchParams.get("offset");
      await route.fulfill({
        json:
          offset === "0"
            ? { items: first, has_more: true }
            : { items: second, has_more: false },
      });
    },
  );
  await enter(page);
  await receiveInto(page, "Каса-склад");
  await find(page, "Двічі");
  const found = page
    .getByRole("radiogroup", { name: "Знайдені товари" })
    .getByRole("radio");
  await expect(found).toHaveCount(20);
  await page.getByRole("button", { name: "Показати ще" }).click();
  await expect(found).toHaveCount(22);
  const names = await found.allTextContents();
  expect(new Set(names).size).toBe(22);
  expect(names.filter((name) => name === "Двічі 20")).toHaveLength(1);
  await expect(found.nth(20)).toHaveText("Двічі 21");
  await expect(found.nth(20)).toBeFocused();
  expect(said.filter((line) => /same key/i.test(line))).toEqual([]);
});
