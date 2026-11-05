import {
  test,
  expect,
  countTaps,
  more,
  openStore,
  receiveInto,
  receiveSize,
  receiveUnits,
  receiveWay,
  receiveWayDone,
  recordReceipt,
  refuseOnce,
  section,
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
  await page.getByRole("button", { name: "Знайти" }).click();
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
  await sheet
    .getByLabel("Примітка (накладна, постачальник)")
    .fill("Накладна 17");
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
    "Нічого не прийнято. Перевірте рядки та спробуйте ще раз — список збережено.",
  );
  await expect(
    page
      .getByRole("region", { name: "У поставці" })
      .getByText("5 шт. · Закупівля"),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/inventory/receipts", 409);
  await recordReceipt(page, 5).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Нічого не прийнято: поки ви працювали, дані змінилися. Перевірте рядки та спробуйте ще раз — список збережено.",
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
  expect(sent).toHaveLength(3);
  expect(sent.map((body) => body.lines.length)).toEqual([1, 1, 1]);
  expect(sent[0]?.command_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(new Set(sent.map((body) => body.command_id)).size).toBe(1);
  expect(sent[2]?.location_id).toBe(fixture.till_location_id);
  expect(sent[2]?.notes).toBe("Накладна 17");
  expect(sent[2]?.lines.map((line) => line.quantity)).toEqual([5]);
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
  await page.locator(".sheet-scrim").click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Як надійшов: Закупівля · ціна з помилкою",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Додати ще модель" }).click();
  await expect(page.getByText(/до копійок, наприклад 1850,50/)).toBeVisible();
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
  await expect(page.getByText(/нічого не прийнято/)).toBeVisible();
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
  // (stage 2, orders task list, P0-1).
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
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
  // Confirmed: torn off, once (В-ЗП2 (а)).
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
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
    page.getByRole("button", { name: "Повторити завантаження" }),
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

test("a model in two sizes in 8 taps: «M 2, L 1» as the notebook has it, one delivery with every line («Усе на бірці» sections task list, P1-4)", async ({
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
  expect(await taps()).toBe(8);
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
