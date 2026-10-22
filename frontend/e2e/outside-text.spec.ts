import { test, expect, openStore, section } from "./fixtures";
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Text from outside the app, shown as it is (owner decision, 2026-10-10).
 *
 * A model's name, a person's name from Telegram, a supplier's, a customer's,
 * a write-off's reason: each may hold characters that reorder the text around
 * them or are not seen at all. Every screen shows each such character as its
 * code, «⟦U+202E⟧», and nothing stored changes (`src/shared/visible.ts`).
 *
 * The journey plants them the ways they arrive: a model and a supplier made
 * through the API, a seller added by the server command whose Telegram name
 * holds one and who sells on credit, a customer's name on that debt, and a
 * reason the owner writes. Then every screen they reach is read whole — its
 * text, its labels, its options — and must hold the marks and none of the
 * characters themselves.
 */
interface Fixture {
  telegram_user_id: string;
  owner_telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const backend = fileURLToPath(new URL("../../backend", import.meta.url));

const RLO = "\u202E"; // right-to-left override: «21 шт» after it reads «тш 12»
const ZWSP = "\u200B"; // zero width: two names that look the same differ
const LRI = "\u2066"; // left-to-right isolate, left open
const marks = { [RLO]: "⟦U+202E⟧", [ZWSP]: "⟦U+200B⟧", [LRI]: "⟦U+2066⟧" };
// What `visible()` marks.
const HIDDEN =
  /[\p{Cc}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/u;

function initData(telegramUserId: string, firstName: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(telegramUserId), first_name: firstName }),
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
  telegramUserId: string,
  firstName: string,
): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(telegramUserId, firstName) },
  });
  expect(auth.status()).toBe(200);
  return ((await auth.json()) as { access_token: string }).access_token;
}

async function open(
  page: Page,
  telegramUserId: string,
  firstName: string,
  tab: string,
): Promise<void> {
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(telegramUserId, firstName) }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await section(page, tab);
}

/**
 * The screen as a person meets it: its text, every label a reader speaks,
 * and every option of every list. It must hold `expected`, as marks — on
 * the page, since an option of a closed list is not "visible" — and no
 * character `visible()` marks.
 */
async function shownSafely(page: Page, ...expected: string[]): Promise<void> {
  for (const text of expected)
    await expect(page.getByText(text).first()).toBeAttached();
  const read = await page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const element of document.querySelectorAll(
      "[aria-label], [title], [alt], [placeholder]",
    ))
      for (const name of ["aria-label", "title", "alt", "placeholder"])
        parts.push(element.getAttribute(name) ?? "");
    for (const option of document.querySelectorAll("option"))
      parts.push(option.textContent);
    return parts.join(" ");
  });
  // Line breaks and tabs are how the page's own text reads as lines, not
  // characters someone typed.
  const text = read.replace(/[\t\n\r]/g, " ");
  const found = HIDDEN.exec(text);
  expect(
    found,
    found
      ? `U+${(found[0].codePointAt(0) ?? 0).toString(16).toUpperCase()} shown as itself, in: …${text.slice(Math.max(0, found.index - 40), found.index + 40)}…`
      : "",
  ).toBeNull();
}

test("text from outside is shown with its hidden characters marked, on every screen it reaches", async ({
  page,
}) => {
  const tag = randomUUID().slice(0, 6);
  const owner = await token(page, fixture.telegram_user_id, "Оля");
  const headers = { Authorization: `Bearer ${owner}` };

  // A model whose name reorders what follows it, in a colour with a
  // character nobody sees; five of it where the till sells.
  const concept = `Шуба ${tag}${RLO}21 шт`;
  const colour = `чорний${ZWSP}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      concept,
      variant: { color: colour },
      sizes: [{ system: "ALPHA", code: "L" }],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const variant = product.product_variant_id;
  const size = product.sizes[0]?.size_id ?? "";
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.returns_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          quantity: 5,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(received.status(), await received.text()).toBe(201);

  // A supplier with a character nobody sees.
  const supplier = `Постачальник ${tag}${ZWSP}`;
  const added = await page.request.post("/api/v1/suppliers", {
    headers,
    data: { store_id: fixture.store_id, name: supplier, phone: null },
  });
  expect(added.status(), await added.text()).toBe(201);
  const supplierId = ((await added.json()) as { id: string }).id;
  // An invoice from them, with a note that reorders itself.
  const note = `накладна ${tag}${RLO}№ 12`;
  const invoiced = await page.request.post("/api/v1/supplier-invoices", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: fixture.store_id,
      supplier_id: supplierId,
      amount: "1000.00",
      paid_now: "0",
      note,
    },
  });
  expect(invoiced.status(), await invoiced.text()).toBe(201);

  // A seller added on the server, whose Telegram name reorders itself, sells
  // on credit to a customer whose name opens an isolate it never closes.
  const seller = String(randomInt(2 ** 40, 2 ** 47));
  const sellerName = `Оксана ${tag}${RLO}`;
  execFileSync(
    process.env.BIRKA_E2E_PYTHON ?? "python",
    [
      "-m",
      "scripts.people",
      "grant",
      "--approved-by",
      fixture.owner_telegram_user_id,
      "--telegram-user-id",
      seller,
      "--store",
      "MAIN",
      "--role",
      "E2E",
    ],
    { cwd: backend, encoding: "utf8" },
  );
  const sellerToken = await token(page, seller, sellerName);
  const customer = `Марта ${tag}${LRI}`;
  const sold = await page.request.post("/api/v1/sales", {
    headers: {
      Authorization: `Bearer ${sellerToken}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          source_location_id: fixture.returns_location_id,
          quantity: 1,
          unit_price: "1500.00",
        },
      ],
      credit: {
        customer_name: customer,
        customer_phone: `067${String(randomInt(1_000_000, 9_999_999))}`,
        paid_now: "500.00",
      },
      payment_method: "CASH",
    },
  });
  expect(sold.status(), await sold.text()).toBe(201);
  const creditId = ((await sold.json()) as { credit: { credit_id: string } })
    .credit.credit_id;

  // The owner writes the rest off, with a reason that reorders itself.
  const reason = `виїхала ${tag}${RLO}за кордон`;
  const written = await page.request.post(
    `/api/v1/credits/${creditId}/write-off`,
    { headers, data: { command_id: randomUUID(), reason } },
  );
  expect(written.status(), await written.text()).toBe(200);

  // The seller's own phone: their name at the top, the model at the till.
  await open(page, seller, sellerName, "Продаж");
  await page
    .getByRole("combobox", { name: "Склад", exact: true })
    .selectOption(fixture.returns_location_id);
  await shownSafely(
    page,
    `Оксана ${tag}${marks[RLO]}`,
    `${tag}${marks[RLO]}21 шт`,
  );

  // The owner's «Залишки».
  await open(page, fixture.telegram_user_id, "Оля", "Залишки");
  await page
    .getByLabel("Склад для перегляду")
    .selectOption(fixture.returns_location_id);
  await shownSafely(page, `${tag}${marks[RLO]}21 шт`, `чорний${marks[ZWSP]}`);

  // «Моделі».
  await open(page, fixture.telegram_user_id, "Оля", "Моделі");
  await page.getByLabel("Знайти модель").fill(tag);
  await page.getByRole("button", { name: "Знайти", exact: true }).click();
  await shownSafely(page, `${tag}${marks[RLO]}21 шт`);

  // «Борги»: the customer, the goods, who sold, and the reason.
  await open(page, fixture.owner_telegram_user_id, "Оля", "Борги");
  await page
    .getByRole("button", { name: "Показати сплачені й списані" })
    .click();
  await page.getByLabel("Ім’я або телефон").fill(tag);
  await shownSafely(page, `Марта ${tag}${marks[LRI]}`);
  await page
    .getByRole("button", {
      name: `Відкрити борг: Марта ${tag}${marks[LRI]},`,
    })
    .click();
  await shownSafely(
    page,
    `${tag}${marks[RLO]}за кордон`,
    `Оксана ${tag}${marks[RLO]}`,
  );

  // «Звіт», today's.
  await open(page, fixture.telegram_user_id, "Оля", "Звіт");
  await shownSafely(page, `${tag}${marks[RLO]}21 шт`);

  // «Повернення»: the seller's sale, found by the model.
  await open(page, fixture.telegram_user_id, "Оля", "Повернення");
  await page.getByLabel("Що повертають?").fill(tag);
  await page.getByLabel("Що повертають?").press("Enter");
  await shownSafely(page, `${tag}${marks[RLO]}21 шт`);

  // «Каса»: the seller's own sale, among what they may correct.
  await open(page, seller, sellerName, "Каса");
  await page.getByRole("button", { name: "Змінити спосіб оплати" }).click();
  // A cash day runs from 06:00 to 06:00, Kyiv time: a sale just after
  // midnight is the evening before's (owner, 2026-10-04).
  const cashDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 6 * 3600 * 1000));
  // By Kyiv's clock, which the phone's may not be: on the calendar (cash
  // task list, P2-4).
  await page.getByRole("radio", { name: "Інший день" }).check();
  await page.getByLabel("День", { exact: true }).fill(cashDay);
  await shownSafely(page, `${tag}${marks[RLO]}21 шт`);

  // «Накладні»: the supplier and the note.
  await open(page, fixture.telegram_user_id, "Оля", "Накладні");
  await shownSafely(
    page,
    `Постачальник ${tag}${marks[ZWSP]}`,
    `${tag}${marks[RLO]}№ 12`,
  );

  // «Постачальникам»: the list of suppliers, and the one to receive from.
  await open(page, fixture.telegram_user_id, "Оля", "Постачальникам");
  await page.getByText("Список постачальників").click();
  await expect(
    page
      .getByRole("list", { name: "Постачальники" })
      .getByText(`Постачальник ${tag}${marks[ZWSP]}`)
      .first(),
  ).toBeVisible();
  await shownSafely(page);
});
