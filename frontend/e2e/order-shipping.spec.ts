import {
  test,
  expect,
  fillLine,
  openStore,
  section,
  tapSize,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Where an order goes (owner decisions, 2026-10-01): within Ukraine — the
 * default — by Нова пошта, Укрпошта or Міст, picked when the order is made;
 * or abroad. The waybill, or abroad where and how it went, is written when
 * the order is sent or later; any of it is corrected while the order is
 * open, and every version stays. One waybill on two orders is saved, and
 * named; orders are found by it.
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  variant_id: string;
  size_id: string;
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
  return new RegExp(`^${escaped} · з\\s\\d{2}\\.\\d{2}$`);
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

/** A carrier's chip (P0-5). */
async function carrier(page: Page, name: string): Promise<void> {
  await page
    .getByRole("group", { name: "Перевізник" })
    .getByRole("button", { name, exact: true })
    .click();
}

/** «Замовити та зарезервувати», what it did read before the next step. */
async function reserve(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Замовити та зарезервувати" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /^Зарезервовано: 1 шт\. Чекає відправлення\.$/ }),
  ).toBeVisible();
  await readTheAnswer(page);
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
  const press = page.locator(".pay-panel").getByRole("button");
  await expect(press).toHaveText("Оберіть перевізника");
  await expect(press).toBeDisabled();
  expect(made.bodies).toHaveLength(0);
  await carrier(page, "Укрпошта");
  await reserve(page);
  await expect(page.locator(".order-context")).toHaveText(
    goes("Укрпошта · ТТН ще немає"),
  );
  expect(made.bodies).toEqual([
    expect.objectContaining({ destination: "UKRAINE", carrier: "UKRPOSHTA" }),
  ]);

  await page
    .getByLabel("Номер ТТН (можна дописати пізніше)")
    .fill(" 0500012345678 ");
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  await expect(page.locator(".order-context")).toHaveText(
    goes("Укрпошта · ТТН 0500012345678"),
  );
  // What the step did, with a buzz (orders task list, P0-2).
  await expect(
    page.getByText("Відправлено · ТТН 0500012345678", { exact: true }),
  ).toBeVisible();
  expect(sent.bodies).toEqual([
    { command_id: expect.any(String) as string, waybill: "0500012345678" },
  ]);
  await expect(
    page.getByRole("list", { name: "Історія доставки" }).getByRole("listitem"),
  ).toHaveText([
    /Вказано при створенні · Укрпошта · ТТН ще немає · Оля$/,
    /Вписано при відправленні · Укрпошта · ТТН 0500012345678 · Оля$/,
  ]);
});

test("an order abroad says where and how it went, in one line", async ({
  page,
}) => {
  const made = posts(page, /\/api\/v1\/orders$/);
  const sent = posts(page, /\/dispatch$/);
  await enter(page);
  await draft(page);
  await page.getByRole("radio", { name: "За кордон", exact: true }).check();
  await expect(page.getByRole("group", { name: "Перевізник" })).toHaveCount(0);
  await expect(
    page.getByText("Куди і як відправили — впишете, коли відправите.", {
      exact: true,
    }),
  ).toBeVisible();
  await reserve(page);
  await expect(page.locator(".order-context")).toHaveText(goes("За кордон"));
  const [body] = made.bodies as Record<string, unknown>[];
  expect(body?.destination).toBe("ABROAD");
  expect(body).not.toHaveProperty("carrier");

  await expect(
    page.getByLabel(
      "Куди і як відправили: місто, країна, спосіб (можна дописати пізніше)",
    ),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await page
    .getByLabel(
      "Куди і як відправили: місто, країна, спосіб (можна дописати пізніше)",
    )
    .fill("Варшава, Польща, Нова пошта Глобал");
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  await expect(page.locator(".order-context")).toHaveText(
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

test("where an order goes is corrected while it is open, and every version stays", async ({
  page,
}) => {
  const changed = posts(page, /\/shipping$/);
  await enter(page);
  await draft(page);
  await carrier(page, "Нова пошта");
  await reserve(page);
  await page.getByRole("button", { name: "Відправлено", exact: true }).click();
  await expect(page.getByText("Відправлено", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Змінити доставку" }).click();
  const where = page.getByRole("combobox", { name: "Куди", exact: true });
  await where.selectOption("ABROAD");
  // The hint describes the field and stays out of its name.
  await expect(
    page.getByRole("textbox", {
      name: "Куди і як відправили: місто, країна, спосіб",
      exact: true,
    }),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await where.selectOption("UKRAINE");
  await page
    .getByRole("combobox", { name: "Перевізник", exact: true })
    .selectOption("MEEST");
  await page.getByLabel("Номер накладної", { exact: true }).fill("MEEST-777");
  await page.getByRole("button", { name: "Зберегти доставку" }).click();
  await expect(page.locator(".order-context")).toHaveText(
    goes("Міст · ТТН MEEST-777"),
  );
  // Saved, the form closes on the order as it now stands.
  await expect(
    page.getByRole("button", { name: "Змінити доставку" }),
  ).toBeVisible();
  expect(changed.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      destination: "UKRAINE",
      carrier: "MEEST",
      waybill: "MEEST-777",
    },
  ]);
  await expect(
    page.getByRole("list", { name: "Історія доставки" }).getByRole("listitem"),
  ).toHaveText([
    /Вказано при створенні · Нова пошта · ТТН ще немає · Оля$/,
    /Змінено · Міст · ТТН MEEST-777 · Оля$/,
  ]);
  // Closed, it is no longer changed. Collected, it says how it was paid:
  // every order goes by a carrier, this one paid to it on delivery (owner
  // decisions, 2026-10-04).
  await page
    .getByRole("button", { name: "Прибув на пошту", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Прибув на пошту$/ }),
  ).toBeVisible();
  await readTheAnswer(page);
  await page
    .getByRole("group", { name: "Клієнт забрав — як оплачено?" })
    .getByRole("button", { name: "Накладений платіж", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Змінити доставку" }),
  ).toHaveCount(0);
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
    .getByRole("button");
  await expect(found).toHaveCount(2);
  await expect(found.first()).toContainText(`Нова пошта · ТТН ${waybill}`);
  // Newest first: the second.
  await found.first().click();
  await expect(page.locator(".order-number")).toHaveText(
    `№ ${second.slice(0, 8)}`,
  );
  await expect(
    page.getByText(
      `Ця накладна є також у замовленні № ${first.slice(0, 8)}. Збережено — перевірте, чи це один пакунок.`,
    ),
  ).toBeVisible();
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
  await page.getByRole("button", { name: "Змінити доставку" }).click();
  await page
    .getByRole("combobox", { name: "Перевізник", exact: true })
    .selectOption("UKRPOSHTA");
  await page.getByLabel("Номер накладної", { exact: true }).fill("20451111");
  await page.getByRole("button", { name: "Зберегти доставку" }).click();
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
    /· Укрпошта · ТТН 20451111 — сервер не відповів\. Двічі вона не запишеться\./,
  );
  await page.close();
  const reopened = await context.newPage();
  // Read from the phone's storage, it is checked at once, with no tap
  // (ADR-0013 §4.3), and its own tab opens (redesign P0-1).
  await reopen(reopened);
  await expect(reopened.locator(".order-context")).toHaveText(
    goes("Укрпошта · ТТН 20451111"),
  );
  await expect(
    reopened.getByRole("status").filter({
      hasText: /^Операцію «Зміна доставки» записано один раз$/,
    }),
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  await expect(
    reopened
      .getByRole("list", { name: "Історія доставки" })
      .getByRole("listitem"),
  ).toHaveCount(2);
});
