import {
  test,
  expect,
  fillLine,
  openStore,
  section,
  tapSize,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Where an order goes (owner decisions, 2026-10-01): within Ukraine — the
 * default — by Нова пошта, Укрпошта or Міст, picked when the order is made;
 * or abroad. The waybill, or abroad where and how it went, is written when
 * the order is sent or later; any of it is corrected while the order is
 * open, and every version stays. One waybill on two orders is saved, and
 * named; orders are found by it. Where it goes is its own step, its history
 * a row a version, the other order with its waybill its row (orders task
 * list, P1-3) — a sheet over the card, one row of chips «Куди» (stage 2,
 * orders task list, P1-1, P0-5).
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  variant_id: string;
  size_id: string;
}
// Waybills of this run alone: the shared database keeps the orders of the
// runs before, and a waybill one of them has is said as one parcel's — the
// sheet then stays with the warning («Усе на бірці» sections task list,
// P0-3).
const run = String(Date.now()).slice(-8);
const UKRPOSHTA = `05000${run}`;
const WRITTEN = `204512${run}`;
const SAVED = `2045${run}`;
const MEEST = `MEEST-${run}`;

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
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

/** An order's line of context (orders task list, P0-2): how it goes, and
 * since when. */
function goes(how: string): RegExp {
  const escaped = how.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`);
}

/** What a step did is read before the next is pressed: a tap within 0.7 s
 * of its answer is taken as meant for the step before (review,
 * 2026-10-24). */
async function readTheAnswer(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(done, 800);
      }),
  );
}

async function enter(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  // The till opens first for whoever sells (redesign P0-1).
  await section(page, "Замовлення");
}

/** The app opened again: a kept order turns to «Замовлення» by itself. */
async function reopen(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
}

/** A new order of one coat, its goods picked, nothing said yet of where it
 * goes (orders task list, P0-5): found by name, its size tapped from the
 * fixture's warehouse, its price typed. */
async function draft(page: Page): Promise<void> {
  await section(page, "+ Нове замовлення");
  await page.getByRole("searchbox", { name: "Знайти модель" }).fill("Лоран");
  await tapSize(page, fixture.variant_id, fixture.size_id, fixture.location_id);
  await fillLine(page, { price: "900" });
}

/** Where it goes: a carrier's chip, or «За кордон», of one row (stage 2,
 * orders task list, P0-5). */
async function carrier(page: Page, name: string): Promise<void> {
  await page
    .getByRole("group", { name: "Куди" })
    .getByRole("button", { name, exact: true })
    .click();
}

/** «Замовити та зарезервувати», what it did read before the next step: the
 * reserve torn off as a stub (stage 2, orders task list, P1-3). */
async function reserve(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  await expect(
    page.locator(".order-done .stub-recorded .stub-line").last(),
  ).toHaveText("Зарезервовано: 1 шт. Чекає відправлення.");
  await readTheAnswer(page);
}

/** «Змінити доставку», or «ТТН ще немає — вписати»: its sheet over the card
 * (stage 2, orders task list, P1-1). */
async function shippingSheet(page: Page, row: string): Promise<Locator> {
  await page.getByRole("button", { name: row, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Доставка" });
  // The tap that opened it is let go for a moment.
  await expect(sheet).toHaveAttribute("data-ready", "");
  return sheet;
}

/** Where an order goes, as its own step (orders task list, P1-3): the
 * carrier's chip, the waybill typed. */
async function where(
  page: Page,
  to: { carrier?: string; waybill?: string },
): Promise<void> {
  if (to.carrier) await carrier(page, to.carrier);
  if (to.waybill !== undefined)
    await page.getByLabel("Номер ТТН", { exact: true }).fill(to.waybill);
}

/** «Зберегти доставку», the sheet's one button outside Telegram, back on
 * the card with what it did. A tap within 0.7 s of the sheet opening is
 * taken as carried from the row (review, 2026-10-25): a person's typing
 * takes longer. */
async function saveShipping(page: Page): Promise<void> {
  await readTheAnswer(page);
  await page
    .getByRole("dialog", { name: "Доставка" })
    .getByRole("button", { name: "Зберегти доставку" })
    .click();
  await expect(page.getByRole("dialog", { name: "Доставка" })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^Доставку збережено$/ }),
  ).toBeVisible();
}

/** «Відправити», the dock's one button outside Telegram, its sheet with
 * what was typed in its field, and «Відправлено» («Усе на бірці» sections
 * task list, P0-3). */
async function send(page: Page, written?: string): Promise<Locator> {
  await page.getByRole("button", { name: "Відправити", exact: true }).click();
  const sending = page.getByRole("dialog", { name: "Відправити" });
  // The tap that opened it is let go for a moment.
  await expect(sending).toHaveAttribute("data-ready", "");
  if (written !== undefined)
    await sending.getByLabel(/^(Номер ТТН|Куди і як відправили)/).fill(written);
  await sending.getByRole("button", { name: "Відправлено" }).click();
  return sending;
}

/** When a version was stated, and by whom: «22.10, 14:05 · Оля». */
const stated = expect.stringMatching(
  /^\d{2}\.\d{2}, \d{2}:\d{2} · Оля$/,
) as unknown as string;

/** The history of where it went, a version on the thread (P1-3; orders and
 * «Каса» task list after stage 2, P2-2): what it was; its day at the left
 * with when and by whom under it, «22.10, 14:05 · Оля»; how it went. */
async function changes(page: Page): Promise<string[][]> {
  // Folded until it is opened («Усе на бірці» sections task list, P0-2).
  const folded = page.getByRole("button", { name: "Історія доставки" });
  if ((await folded.getAttribute("aria-expanded")) === "false")
    await folded.click();
  return page
    .getByRole("list", { name: "Історія доставки" })
    .getByRole("listitem")
    .evaluateAll((rows) =>
      rows.map((row) => [
        row.querySelector(".timeline-what")?.textContent ?? "",
        `${row.querySelector(".timeline-day")?.textContent ?? ""}, ${
          row.querySelector(".timeline-meta")?.textContent ?? ""
        }`,
        row.querySelector(".shipping-how")?.textContent ?? "",
      ]),
    );
}

function posts(page: Page, ending: RegExp): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && ending.test(request.url()))
      seen.bodies.push(request.postDataJSON());
  });
  return seen;
}

async function headers(page: Page): Promise<Record<string, string>> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

/** An order made and sent through the API, with this waybill. */
async function sentWith(page: Page, waybill: string): Promise<string> {
  const auth = await headers(page);
  const made = await page.request.post("/api/v1/orders", {
    headers: auth,
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      carrier: "NOVA_POSHTA",
      lines: [
        {
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          source_location_id: fixture.location_id,
          quantity: 1,
          unit_price: "900.00",
        },
      ],
    },
  });
  expect(made.status()).toBe(201);
  const id = ((await made.json()) as { id: string }).id;
  const sent = await page.request.post(`/api/v1/orders/${id}/dispatch`, {
    headers: auth,
    data: { command_id: randomUUID(), waybill },
  });
  expect(sent.status()).toBe(200);
  return id;
}

test("an order within Ukraine names its carrier, and its waybill when it is sent", async ({
  page,
}) => {
  const made = posts(page, /\/api\/v1\/orders$/);
  const sent = posts(page, /\/dispatch$/);
  await enter(page);
  await draft(page);
  // No carrier yet: the press asks for one and sends nothing (orders task
  // list, P0-5).
  const press = page.locator(".order-tray .main-mimic");
  await expect(press).toHaveText("Оберіть перевізника");
  await expect(press).toBeDisabled();
  expect(made.bodies).toHaveLength(0);
  await carrier(page, "Укрпошта");
  await reserve(page);
  await expect(page.locator(".order-goes")).toHaveText(
    goes("Укрпошта · ТТН ще немає"),
  );
  expect(made.bodies).toEqual([
    expect.objectContaining({ destination: "UKRAINE", carrier: "UKRPOSHTA" }),
  ]);

  await send(page, ` ${UKRPOSHTA} `);
  await expect(page.locator(".order-goes")).toHaveText(
    goes(`Укрпошта · ТТН ${UKRPOSHTA}`),
  );
  // What the step did, with a buzz (orders task list, P0-2).
  await expect(
    page.getByText(`Відправлено · ТТН ${UKRPOSHTA}`, { exact: true }),
  ).toBeVisible();
  expect(sent.bodies).toEqual([
    { command_id: expect.any(String) as string, waybill: UKRPOSHTA },
  ]);
  await expect
    .poll(() => changes(page))
    .toEqual([
      ["Вказано при створенні", stated, "Укрпошта · ТТН ще немає"],
      ["Вписано при відправленні", stated, `Укрпошта · ТТН ${UKRPOSHTA}`],
    ]);
  // Sent with its waybill: changed, never «вписати».
  await expect(
    page.getByRole("button", { name: "Змінити доставку", exact: true }),
  ).toBeVisible();
});

test("an order abroad says where and how it went, in one line", async ({
  page,
}) => {
  const made = posts(page, /\/api\/v1\/orders$/);
  const sent = posts(page, /\/dispatch$/);
  await enter(page);
  await draft(page);
  await carrier(page, "За кордон");
  await expect(
    page.getByRole("group", { name: "Куди" }).locator("[aria-pressed='true']"),
  ).toHaveText(["За кордон"]);
  await expect(
    page.getByText("Куди і як відправили — впишете, коли відправите.", {
      exact: true,
    }),
  ).toBeVisible();
  await reserve(page);
  await expect(page.locator(".order-goes")).toHaveText(goes("За кордон"));
  const [body] = made.bodies as Record<string, unknown>[];
  expect(body?.destination).toBe("ABROAD");
  expect(body).not.toHaveProperty("carrier");

  await page.getByRole("button", { name: "Відправити", exact: true }).click();
  const sending = page.getByRole("dialog", { name: "Відправити" });
  await expect(
    sending.getByLabel(
      "Куди і як відправили: місто, країна, спосіб (можна дописати пізніше)",
    ),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await page.keyboard.type("Варшава, Польща, Нова пошта Глобал");
  await expect(sending).toHaveAttribute("data-ready", "");
  await sending.getByRole("button", { name: "Відправлено" }).click();
  await expect(page.locator(".order-goes")).toHaveText(
    goes("За кордон · Варшава, Польща, Нова пошта Глобал"),
  );
  await expect(page.getByText("Відправлено.", { exact: true })).toBeVisible();
  expect(sent.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      abroad_note: "Варшава, Польща, Нова пошта Глобал",
    },
  ]);
});

test("where an order goes is corrected while it is open, as its own step, and every version stays a row (orders task list, P1-3)", async ({
  page,
}) => {
  const changed = posts(page, /\/shipping$/);
  await enter(page);
  await draft(page);
  await carrier(page, "Нова пошта");
  await reserve(page);

  // Before it is sent, the waybill is written in «Відправити»'s sheet: the
  // row changes where it goes.
  await expect(
    page.getByRole("button", { name: "ТТН ще немає — вписати" }),
  ).toHaveCount(0);
  // A sheet over the card (stage 2, orders task list, P1-1): the card
  // behind it out of reach, the order in its line, the cursor in the sheet,
  // no field for the waybill but its own.
  const shipping = await shippingSheet(page, "Змінити доставку");
  await expect(shipping).toBeFocused();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await expect(shipping.locator(".send-parcel")).toHaveText(/^Лоран/);
  await expect(
    page.getByLabel("Номер ТТН (можна дописати пізніше)"),
  ).toHaveCount(0);
  // As it stands: by Нова пошта, one chip of the row chosen.
  const row = shipping.getByRole("group", { name: "Куди" });
  await expect(row.locator("[aria-pressed='true']")).toHaveText(["Нова пошта"]);
  await expect(shipping.getByLabel("Номер ТТН", { exact: true })).toHaveValue(
    "",
  );
  // Abroad: no carrier, where and how it went, never a customer's name.
  await carrier(page, "За кордон");
  await expect(row.locator("[aria-pressed='true']")).toHaveText(["За кордон"]);
  await expect(shipping.getByLabel("Номер ТТН", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    shipping.getByRole("textbox", {
      name: "Куди і як відправили: місто, країна, спосіб",
      exact: true,
    }),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  // A text's key makes a new line (audit 2026-11-13, orders-cash P2-3).
  await expect(
    shipping.getByRole("textbox", {
      name: "Куди і як відправили: місто, країна, спосіб",
      exact: true,
    }),
  ).toHaveAttribute("enterkeyhint", "enter");
  // A carrier's chip: within Ukraine again, by it.
  await where(page, { carrier: "Міст", waybill: MEEST });
  await saveShipping(page);
  // Saved: back on the card as it now stands.
  await expect(page.locator(".order-goes")).toHaveText(
    goes(`Міст · ТТН ${MEEST}`),
  );
  expect(changed.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      destination: "UKRAINE",
      carrier: "MEEST",
      waybill: MEEST,
    },
  ]);
  await expect
    .poll(() => changes(page))
    .toEqual([
      ["Вказано при створенні", stated, "Нова пошта · ТТН ще немає"],
      ["Змінено", stated, `Міст · ТТН ${MEEST}`],
    ]);
  // Closed, it is no longer changed. Collected, it says how it was paid:
  // every order goes by a carrier, this one paid to it on delivery (owner
  // decisions, 2026-10-04).
  await readTheAnswer(page);
  await send(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: new RegExp(`^Відправлено · ТТН ${MEEST}$`) }),
  ).toBeVisible();
  await readTheAnswer(page);
  await page
    .getByRole("button", { name: "Прибув на пошту", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Прибув на пошту$/ }),
  ).toBeVisible();
  await readTheAnswer(page);
  await page
    .getByRole("button", { name: "Клієнт забрав", exact: true })
    .click();
  const ways = page.getByRole("dialog", {
    name: "Клієнт забрав — як оплачено?",
  });
  await expect(ways).toHaveAttribute("data-ready", "");
  await ways
    .getByRole("button", { name: "Накладений платіж", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Змінити доставку" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /вписати/ })).toHaveCount(0);
});

test("a waybill written after the parcel went: «ТТН ще немає — вписати», the cursor in its field, saved under the thumb (orders task list, P1-3)", async ({
  page,
}) => {
  const changed = posts(page, /\/shipping$/);
  await enter(page);
  await draft(page);
  await carrier(page, "Нова пошта");
  await reserve(page);
  await send(page);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Відправлено\. ТТН можна вписати пізніше\.$/ }),
  ).toBeVisible();
  await readTheAnswer(page);
  const write = page.getByRole("button", {
    name: "ТТН ще немає — вписати",
    exact: true,
  });
  await expect(write).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Змінити доставку" }),
  ).toHaveCount(0);
  // Back without saving: nothing sent, the row in focus.
  const shipping = await shippingSheet(page, "ТТН ще немає — вписати");
  const waybill = shipping.getByLabel("Номер ТТН", { exact: true });
  await expect(waybill).toBeFocused();
  // The keyboard's «Готово» puts it away, nothing saved (stage 2, orders
  // task list, P1-1).
  await expect(waybill).toHaveAttribute("enterkeyhint", "done");
  await waybill.press("Enter");
  await expect(waybill).not.toBeFocused();
  expect(changed.bodies).toHaveLength(0);
  // Closed as any sheet is, by «Назад» (Escape here).
  await shipping.focus();
  await page.keyboard.press("Escape");
  await expect(shipping).toHaveCount(0);
  await expect(write).toBeFocused();
  expect(changed.bodies).toHaveLength(0);
  // A tap, the number typed where the cursor already is, a tap: with the
  // two that open «Замовлення» and the one that opens the order, five.
  await write.click();
  await page.keyboard.type(WRITTEN);
  await saveShipping(page);
  await expect(page.locator(".order-goes")).toHaveText(
    goes(`Нова пошта · ТТН ${WRITTEN}`),
  );
  expect(changed.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      destination: "UKRAINE",
      carrier: "NOVA_POSHTA",
      waybill: WRITTEN,
    },
  ]);
  await expect
    .poll(() => changes(page))
    .toEqual([
      ["Вказано при створенні", stated, "Нова пошта · ТТН ще немає"],
      ["Змінено", stated, `Нова пошта · ТТН ${WRITTEN}`],
    ]);
  await expect(
    page.getByRole("button", { name: "Змінити доставку", exact: true }),
  ).toBeVisible();
});

test("where an order goes saved as it was: back on its card, and a tap carried from the press is let go (orders task list, P1-3)", async ({
  page,
}) => {
  const changed = posts(page, /\/shipping$/);
  const arrived = posts(page, /\/arrive$/);
  await enter(page);
  await draft(page);
  await carrier(page, "Нова пошта");
  await reserve(page);
  await send(page, SAVED);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: new RegExp(`^Відправлено · ТТН ${SAVED}$`) }),
  ).toBeVisible();
  await readTheAnswer(page);
  await shippingSheet(page, "Змінити доставку");
  await saveShipping(page);
  // Nothing changed: no version added.
  expect(changed.bodies).toHaveLength(1);
  await expect.poll(async () => (await changes(page)).length).toBe(2);
  // The card's step stands where «Зберегти доставку» was: a tap at once is
  // the save's, and nothing is sent.
  await page
    .getByRole("button", { name: "Прибув на пошту", exact: true })
    .click();
  await readTheAnswer(page);
  expect(arrived.bodies).toHaveLength(0);
  await expect(
    page.locator(".knot-string [aria-current='step'] .knot-label"),
  ).toHaveText("Відправлено");
});

test("one waybill on two orders is saved and named, and orders are found by it", async ({
  page,
}) => {
  const waybill = `20${String(randomInt(100_000_000_000, 999_999_999_999))}`;
  const first = await sentWith(page, waybill);
  const second = await sentWith(page, waybill);
  await enter(page);
  // Found as it is typed, with no «Знайти» (orders task list, P0-1).
  await page
    .getByLabel("Номер ТТН")
    .fill(`${waybill.slice(0, 4)} ${waybill.slice(4)}`);
  const found = page
    .getByRole("list", { name: "Знайдені замовлення" })
    .locator(".order-row");
  await expect(found).toHaveCount(2);
  await expect(found.first()).toContainText(`Нова пошта · ТТН ${waybill}`);
  // Newest first: the second.
  await found.first().click();
  await expect(page.locator(".order-number")).toHaveText(
    `№ ${second.slice(0, 8)}`,
  );
  // The other order its row (orders task list, P1-3): its goods, since
  // when and its pill — never its eight characters (В1).
  await expect(
    page.getByText(
      "Ця ТТН є також у замовленні — перевірте, чи це один пакунок.",
      { exact: true },
    ),
  ).toBeVisible();
  const other = page
    .getByRole("list", { name: "Замовлення з цією ТТН" })
    .getByRole("button");
  await expect(other).toHaveCount(1);
  await expect(other.locator(".sale-goods")).toHaveText(/^Лоран.* · \S+$/);
  await expect(other.locator(".sale-meta")).toHaveText(/^з\s\d{2}\.\d{2}$/);
  await expect(other.locator(".sticker")).toHaveText("Відправлено");
  await expect(other).not.toContainText(first.slice(0, 8));
  // A tap opens it, and it names this one.
  await other.click();
  await expect(page.locator(".order-number")).toHaveText(
    `№ ${first.slice(0, 8)}`,
  );
  await expect(
    page
      .getByRole("list", { name: "Замовлення з цією ТТН" })
      .getByRole("button"),
  ).toHaveCount(1);
});

test("a correction whose answer is lost is resent unchanged", async ({
  page,
  context,
}) => {
  const commands: unknown[] = [];
  await context.route("**/api/v1/orders/*/shipping", async (route) => {
    commands.push(route.request().postDataJSON());
    if (commands.length === 1) {
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await enter(page);
  await draft(page);
  await carrier(page, "Нова пошта");
  await reserve(page);
  await shippingSheet(page, "Змінити доставку");
  await where(page, { carrier: "Укрпошта", waybill: "20451111" });
  await readTheAnswer(page);
  await page
    .getByRole("dialog", { name: "Доставка" })
    .getByRole("button", { name: "Зберегти доставку" })
    .click();
  await expect(
    page.getByRole("button", { name: "Перевірити результат замовлення" }),
  ).toBeEnabled();
  // The delivery it sets, whole — never the old carrier with the new
  // waybill (orders task list, P1-1; review, 2026-10-25).
  await expect(
    page.locator("section.notice", {
      has: page.getByRole("heading", {
        name: "Операцію «Зміна доставки» ще не підтверджено",
      }),
    }),
  ).toContainText(
    /· Укрпошта · ТТН 20451111 — сервер не відповів\. Двічі цю операцію не запишуть\./,
  );
  await page.close();
  const reopened = await context.newPage();
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3), and its own tab opens (redesign P0-1).
  await reopen(reopened);
  await expect(reopened.locator(".order-goes")).toHaveText(
    goes("Укрпошта · ТТН 20451111"),
  );
  await expect(
    reopened.getByRole("status").filter({
      hasText: /^Операцію «Зміна доставки» записано один раз$/,
    }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  await expect.poll(async () => (await changes(reopened)).length).toBe(2);
});
