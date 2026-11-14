import {
  test,
  expect,
  countTaps,
  dockOnMenu,
  expectEmpty,
  expectGlyphBeside,
  expectResultHeading,
  expectSumRole,
  grn,
  menu,
  more,
  openStore,
  pickSupplier,
  readsOf,
  refuseOnce,
  rowNamed,
  section,
  sections,
  supplierList,
  holdReads,
  under14,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * What a store owes its suppliers (owner decisions, 2026-10-01): an invoice
 * recorded on its own and paid in parts with no schedule; goods returned to
 * that supplier set off against it; a payment, a set-off or the invoice
 * itself recorded by mistake cancelled saying why; what is left written off
 * by the owner only; and an archived store's invoices paid by a store that
 * trades. Drawn in the new system (stage 2, money task list, P0-1, P0-2,
 * P0-3): the invoices as tags under «Винні зараз · Усі» and one field of
 * the supplier, the total in ink; a card with what is owed large and its
 * history as a thread, the rare ways behind its ⋯; the payment on the
 * app's keypad, its stub.
 *
 * In the stores' own network: Ганна holds every right at «Центр», Марко
 * manages it with a manager's default rights, and «Старий», archived, still
 * owes «Постачальник Старого».
 */
interface Fixture {
  network_centre_seller_telegram_user_id: string;
  network_centre_manager_telegram_user_id: string;
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
const marko = fixture.network_centre_manager_telegram_user_id;
const centre = fixture.network_centre_store_id;

const light = { bg_color: "#ffffff", text_color: "#000000" };
const dark = { bg_color: "#17212b", text_color: "#f5f5f5" };

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

/** Бірка at «Центр», as this person; inside Telegram 7.0 with `telegram`,
 * what it is told recorded (`told`); in `theme`'s colours. */
async function at(
  page: Page,
  telegramUserId: string,
  {
    telegram = false,
    theme,
  }: { telegram?: boolean; theme?: Record<string, string> } = {},
): Promise<void> {
  if (telegram)
    await page.addInitScript(() => {
      const host = window as unknown as {
        TelegramWebviewProxy: {
          postEvent: (event: string, data: string) => void;
        };
        told: { event: string; data: Record<string, unknown> }[];
      };
      host.told = [];
      host.TelegramWebviewProxy = {
        postEvent: (event, data) => {
          host.told.push({
            event,
            data: JSON.parse(data || "{}") as Record<string, unknown>,
          });
        },
      };
    });
  // A change of the hash alone would not reload the app.
  await page.goto("about:blank");
  const hash = new URLSearchParams({ tgWebAppData: initData(telegramUserId) });
  if (theme) hash.set("tgWebAppThemeParams", JSON.stringify(theme));
  if (telegram) hash.set("tgWebAppVersion", "7.0");
  await page.goto(`/#${hash.toString()}`);
  await openStore(page, "Центр CENTRE");
}

/** «Накладні» at «Центр», as this person. */
async function invoicesAt(
  page: Page,
  telegramUserId: string,
  options: { telegram?: boolean; theme?: Record<string, string> } = {},
): Promise<void> {
  await at(page, telegramUserId, options);
  await section(page, "Накладні");
}

/** What Telegram was told of `event`, in order. */
async function told(
  page: Page,
  event: string,
): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (wanted) =>
      (
        window as unknown as {
          told: { event: string; data: Record<string, unknown> }[];
        }
      ).told
        .filter((each) => each.event === wanted)
        .map((each) => each.data),
    event,
  );
}

/** Telegram's MainButton as it was last set up. */
async function mainButton(page: Page): Promise<Record<string, unknown>> {
  return (await told(page, "web_app_setup_main_button")).at(-1) ?? {};
}

/** Telegram's own event, as its client sends it. */
async function telegramSays(page: Page, eventType: string): Promise<void> {
  await page.evaluate((type) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ eventType: type }),
        source: window.parent,
      }),
    );
  }, eventType);
}

function posts(page: Page, ending: RegExp): { bodies: unknown[] } {
  const seen = { bodies: [] as unknown[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && ending.test(request.url()))
      seen.bodies.push(request.postDataJSON());
  });
  return seen;
}

/** A supplier of its own, on the network's list. */
async function aSupplier(
  page: Page,
  name: string,
  phone: string | null = null,
): Promise<string> {
  const added = await page.request.post("/api/v1/suppliers", {
    headers: await headersOf(page, hanna),
    data: { store_id: centre, name, phone },
  });
  expect(added.status()).toBe(201);
  return ((await added.json()) as { id: string }).id;
}

async function anInvoice(
  page: Page,
  supplierId: string,
  amount: string,
  paidNow = "0",
): Promise<string> {
  const recorded = await page.request.post("/api/v1/supplier-invoices", {
    headers: await headersOf(page, hanna),
    data: {
      command_id: randomUUID(),
      store_id: centre,
      supplier_id: supplierId,
      amount,
      paid_now: paidNow,
      note: null,
    },
  });
  expect(recorded.status()).toBe(201);
  return ((await recorded.json()) as { id: string }).id;
}

async function owed(page: Page, invoiceId: string, elsewhere = false) {
  const response = await page.request.get(
    `/api/v1/supplier-invoices?store_id=${centre}&limit=50${elsewhere ? "&elsewhere=true" : ""}`,
    { headers: await headersOf(page, hanna) },
  );
  const { items } = (await response.json()) as {
    items: { id: string; owed: string }[];
  };
  return items.find((item) => item.id === invoiceId)?.owed;
}

/** A sheet by its title, once it takes taps: a tap carried from what
 * opened it is let go. */
async function sheet(page: Page, name: string | RegExp): Promise<Locator> {
  const it = page.getByRole("dialog", { name });
  await expect(it).toHaveAttribute("data-ready", "");
  return it;
}

/** «Винні зараз · Усі»: one of the two. */
function mode(page: Page, name: "Винні зараз" | "Усі"): Locator {
  return page
    .getByRole("group", { name: "Які накладні" })
    .getByRole("button", { name, exact: true });
}

/** One supplier's invoice as its tag. */
function tag(page: Page, supplier: string): Locator {
  return page.getByRole("article", { name: supplier, exact: true });
}

/** One supplier's invoice, its card opened from its tag. */
async function open(page: Page, supplier: string): Promise<void> {
  await mode(page, "Усі").click();
  await tag(page, supplier).locator(".order-row").click();
  await expect(
    page.getByRole("heading", { name: supplier, level: 1 }),
  ).toBeVisible();
}

/** «← Накладні» or «← Накладна»: the way back over the title. */
function back(page: Page, to: "Накладні" | "Накладна"): Locator {
  return page.getByRole("button", { name: to, exact: true });
}

/** What is owed on the card, large. */
function owes(page: Page): Locator {
  return page.getByRole("group", { name: "Скільки винні" });
}

/** A key of the app's keypad: a digit, «Кома» or «Стерти». */
function key(page: Page, name: string): Locator {
  return page.locator(".keypad").getByRole("button", { name, exact: true });
}

async function keyIn(page: Page, keys: string): Promise<void> {
  for (const one of keys) await key(page, one === "," ? "Кома" : one).click();
}

/** The card's «Сплатити»: outside Telegram, the dock's one button. */
function payOnCard(page: Page): Locator {
  return page
    .locator(".order-dock")
    .getByRole("button", { name: "Сплатити", exact: true });
}

/** The payment's own button, «Сплатити 500,00 грн», on its dock. */
function payButton(page: Page): Locator {
  return page
    .getByRole("group", { name: "Оплата" })
    .getByRole("button", { name: /^Сплатити/ });
}

/** The card's ⋯, its sheet once it takes taps. */
async function ways(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Дії з накладною" }).click();
  return sheet(page, /^Накладна «/);
}

/** One of the ways behind the card's ⋯. */
async function act(page: Page, way: string): Promise<void> {
  await (
    await ways(page)
  )
    .getByRole("button", { name: way, exact: true })
    .click();
}

/** The invoice's history. */
function history(page: Page): Locator {
  return page.getByRole("list", { name: "Історія накладної" });
}

/** One line of the history, by what it was. */
function line(page: Page, what: string): Locator {
  return history(page).getByRole("listitem").filter({ hasText: what });
}

/** What an operation recorded, as its stub. */
function result(page: Page): Locator {
  return page.locator(".invoice-result");
}

/** «Готово» under a result: outside Telegram, the screen's own — the
 * MainButton's place in the dock at the menu's top (audit 2026-11-13, frame
 * P2-9). */
async function done(page: Page): Promise<void> {
  await page
    .locator(".invoice-result-screen .result-dock")
    .getByRole("button", { name: "Готово" })
    .click();
}

/** A colour as the page resolves it: «var(--ink)». */
async function resolved(page: Page, value: string): Promise<string> {
  return page.evaluate((colour) => {
    const probe = document.createElement("i");
    probe.style.color = colour;
    document.body.append(probe);
    const shown = getComputedStyle(probe).color;
    probe.remove();
    return shown;
  }, value);
}

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

/** Wholly on the screen and over the menu. */
async function overMenu(page: Page, part: Locator): Promise<void> {
  await expect(part).toBeInViewport({ ratio: 1 });
  const box = await part.boundingBox();
  const bar = await menu(page).boundingBox();
  if (!box || !bar) throw new Error("not laid out");
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
}

test("an invoice is recorded on its own screen and paid in parts until it is settled", async ({
  page,
}) => {
  const supplier = `Накладна ${randomUUID().slice(0, 6)}`;
  const recorded = posts(page, /\/api\/v1\/supplier-invoices$/);
  const paid = posts(page, /\/payments$/);
  await invoicesAt(page, hanna);
  // «+» by the title: a screen of its own, nothing chosen beforehand, no
  // native list anywhere (stage 2, money task list, P0-1, P0-3).
  await page
    .getByRole("button", { name: "Записати накладну", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Нова накладна", level: 1 }),
  ).toBeVisible();
  await expect(menu(page)).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Постачальник Оберіть", exact: true }),
  ).toBeVisible();
  // A new one begun and the sheet closed: nothing is remembered (spec
  // §6.29), the search again.
  const begun = await supplierList(page);
  await begun
    .getByRole("button", { name: "Новий постачальник", exact: true })
    .click();
  await begun.getByLabel("Назва постачальника").fill("Чернетка");
  await page.keyboard.press("Escape");
  await expect(begun).toHaveCount(0);
  // A name typed and not found is the new one's.
  const suppliers = await supplierList(page);
  await expect(suppliers.getByLabel("Назва постачальника")).toHaveCount(0);
  await expect(
    suppliers.getByRole("searchbox", { name: "Пошук постачальника" }),
  ).toBeFocused();
  await suppliers
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(supplier);
  await suppliers
    .getByRole("button", {
      name: `Новий постачальник «${supplier}»`,
      exact: true,
    })
    .click();
  await expect(suppliers.getByLabel("Назва постачальника")).toHaveValue(
    supplier,
  );
  // Refused once for a reason the screen does not name: its own words,
  // never an order's (owner decision, 2026-10-25).
  await refuseOnce(page, "**/api/v1/suppliers", 422);
  await suppliers.getByRole("button", { name: "Додати постачальника" }).click();
  await expect(
    suppliers.getByText("Постачальника не додано. Перевірте назву й телефон.", {
      exact: true,
    }),
  ).toBeVisible();
  // Changed meanwhile, the server's own failure, a request naming
  // nothing: never «спробуйте ще раз» (owner, В-П1 (б)).
  const listReads = readsOf(page, /\/api\/v1\/suppliers$/);
  await refuseOnce(page, "**/api/v1/suppliers", 409);
  await suppliers.getByRole("button", { name: "Додати постачальника" }).click();
  await expect(
    suppliers.getByText(
      "Постачальника не додано: дані змінилися — перегляньте список постачальників.",
      { exact: true },
    ),
  ).toBeVisible();
  // The list it says to look at, read again.
  await expect.poll(listReads).toBeGreaterThan(0);
  await refuseOnce(page, "**/api/v1/suppliers", 500);
  await suppliers.getByRole("button", { name: "Додати постачальника" }).click();
  await expect(
    suppliers.getByText(
      "Постачальника не додано. Натисніть ще раз — повторити безпечно. Номер запиту: 3f9c2a7e.",
      { exact: true },
    ),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/suppliers", 404);
  await suppliers.getByRole("button", { name: "Додати постачальника" }).click();
  await expect(
    suppliers.getByText("Постачальника не додано. Перевірте назву й телефон.", {
      exact: true,
    }),
  ).toBeVisible();
  await suppliers.getByRole("button", { name: "Додати постачальника" }).click();
  await expect(suppliers).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Постачальник ${supplier}`, exact: true }),
  ).toBeVisible();
  // Picked: the cursor in the sum next.
  await expect(page.getByLabel("Сума за накладною, грн")).toBeFocused();
  await page.getByLabel("Сума за накладною, грн").fill("5000");
  await page.getByLabel("Сплачено одразу, грн").fill("1000,50");
  await page.getByLabel("Примітка (необов’язково)").fill("накладна № 7");
  await page
    .getByRole("button", { name: "Записати накладну", exact: true })
    .click();
  // Its stub: the sum, the supplier, a perforation and what is left (spec
  // §6.30).
  await expect(
    result(page).getByRole("heading", { name: "Накладну записано" }),
  ).toBeVisible();
  // The result's heading as «Продано 1 шт.»'s: 24/26, 800, the display
  // face, its check 28, one line at 360 (audit 2026-11-13, money P2-2 (а);
  // review).
  const phone = page.viewportSize();
  await page.setViewportSize({ width: 360, height: phone?.height ?? 640 });
  await expectResultHeading(
    result(page).getByRole("heading", { name: "Накладну записано" }),
  );
  if (phone) await page.setViewportSize(phone);
  await expect(result(page).locator(".stub")).toHaveClass(/\bstub-recorded\b/);
  await expect(result(page).locator(".stub-sum")).toHaveText("5 000,00 грн");
  await expect(result(page).locator(".stub-say")).toHaveText(
    `${supplier} · 5 000,00 грн`,
  );
  await expect(result(page).locator(".stub-line")).toHaveText(
    "Залишок 3 999,50 грн.",
  );
  expect(recorded.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      store_id: centre,
      supplier_id: expect.any(String) as string,
      amount: "5000.00",
      paid_now: "1000.50",
      note: "накладна № 7",
    },
  ]);
  // Outside Telegram, «Готово» in the MainButton's place — 50 high, 10
  // round — in the dock at the menu's top; the screen's «←» as it was
  // (spec §6.4; audit 2026-11-13, frame P2-9).
  const dock = await dockOnMenu(page);
  const ready = dock.getByRole("button", { name: "Готово" });
  await expect(ready).toHaveClass("main-mimic");
  await expect(ready).toHaveCSS("min-height", "50px");
  await expect(ready).toHaveCSS("border-top-left-radius", "10px");
  await expect(back(page, "Накладні")).toBeVisible();
  // «Готово»: its card — the supplier its title, what is owed large.
  await done(page);
  await expect(
    page.getByRole("heading", { name: supplier, level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".debt-context")).toHaveText(
    /^Записано .+ · Тест · накладна № 7$/,
  );
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "3 999,50 грн",
  );
  await expect(owes(page)).toContainText(
    /Сплачено 1\s000,50\sгрн з 5\s000,00\sгрн · остання оплата \d\d\.\d\d/,
  );

  // From the card: «Сплатити», the sum, the dock's button.
  await payOnCard(page).click();
  await expect(back(page, "Накладна")).toBeVisible();
  // The menu stands aside while a sum is typed (spec S21).
  await expect(menu(page)).toBeHidden();
  await expect(payButton(page)).toBeDisabled();
  await keyIn(page, "999,5");
  await expect(payButton(page)).toHaveText("Сплатити 999,50 грн");
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/payments", 409);
  await payButton(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Не записано: дані змінилися — перегляньте їх.",
  );
  // The sum kept: pressed again.
  await expect(payButton(page)).toHaveText("Сплатити 999,50 грн");
  // A request naming nothing: what was not done, then what to check —
  // never «спробуйте ще раз» (owner, В-П1 (б)).
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/payments", 404);
  await payButton(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Не записано. Перевірте дані накладної.",
  );
  await expect(payButton(page)).toHaveText("Сплатити 999,50 грн");
  await payButton(page).click();
  await expect(
    result(page).getByRole("heading", { name: "Оплату записано" }),
  ).toBeVisible();
  await expectResultHeading(
    result(page).getByRole("heading", { name: "Оплату записано" }),
  );
  await expect(result(page).locator(".stub")).toHaveClass(/\bstub-recorded\b/);
  await expect(result(page).locator(".stub-sum")).toHaveText("999,50 грн");
  await expect(result(page).locator(".stub-say")).toHaveText(
    new RegExp(`^${supplier} · накладна від \\d\\d\\.\\d\\d$`),
  );
  await expect(result(page).locator(".stub-line")).toHaveText(
    "Залишок 3 000,00 грн.",
  );
  // «← Накладна» instead of «Готово»: the card as it is now, the payment in
  // its history.
  await back(page, "Накладна").click();
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "3 000,00 грн",
  );
  await expect(line(page, "Оплата 999,50 грн")).toHaveCount(1);
  await expect(menu(page)).toBeVisible();
  await back(page, "Накладні").click();
  // Its tag: what is owed on the right, what is paid under it.
  const own = tag(page, supplier);
  await expect(own.locator(".invoice-tag-sum")).toHaveText("3 000,00 грн");
  await expect(own.locator(".order-tag-meta").first()).toHaveText(
    /^\d\d\.\d\d · Тест · сплачено 2\s000,00\sгрн з 5\s000,00\sгрн$/,
  );
  await expect(own.locator(".order-tag-meta").last()).toHaveText(
    "накладна № 7",
  );

  // «Сплатити» on the tag: the payment at once, «← Накладні» back to it. A
  // reader hears whose, how much and of which day.
  await expect(
    own.getByRole("button", { name: "Сплатити" }),
  ).toHaveAccessibleDescription(
    new RegExp(
      `^${supplier} 3\\s000,00\\sгрн \\d\\d\\.\\d\\d · Тест · сплачено`,
    ),
  );
  await own.getByRole("button", { name: "Сплатити" }).click();
  await expect(back(page, "Накладні")).toBeVisible();
  await page
    .getByRole("button", { name: "Увесь залишок 3 000,00 грн" })
    .click();
  await expect(payButton(page)).toHaveText("Сплатити 3 000,00 грн");
  await payButton(page).click();
  // Nothing left: its stub knotted.
  await expect(result(page).locator(".stub")).toHaveClass(/\bstub-settled\b/);
  await expect(result(page).locator(".stub > .eyelet")).toHaveClass(
    /\beyelet-knot\b/,
  );
  await expect(result(page).locator(".stub-line")).toHaveText(
    "Накладну сплачено повністю.",
  );
  await done(page);
  await expect(page.locator(".invoice-closed")).toContainText(
    "Сплачено повністю",
  );
  await expectGlyphBeside(page.locator(".invoice-closed .sticker"));
  await expect(payOnCard(page)).toHaveCount(0);
  await expect(history(page).getByRole("listitem")).toHaveCount(3);
  // The two refused above, then the same payment as a new command, then
  // the rest.
  expect(paid.bodies).toHaveLength(4);
  expect({ ...(paid.bodies[0] as object), command_id: null }).toEqual({
    ...(paid.bodies[2] as object),
    command_id: null,
  });
  expect(paid.bodies.slice(2)).toEqual([
    { command_id: expect.any(String) as string, amount: "999.50" },
    { command_id: expect.any(String) as string, amount: "3000.00" },
  ]);
  // Owed no more: gone from «Винні зараз».
  await back(page, "Накладні").click();
  await expect(mode(page, "Винні зараз")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tag(page, supplier)).toHaveCount(0);
});

test("goods returned are set off against an invoice, and their return waits for the set-off", async ({
  page,
}) => {
  const supplier = `Залік ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  const headers = await headersOf(page, hanna);
  const model = `Залікове ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      concept: model,
      variant: { color: "сірий" },
      sizes: [{ system: "ALPHA", code: "L" }],
    },
  });
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const goods = {
    product_variant_id: product.product_variant_id,
    size_id: product.sizes[0]?.size_id ?? "",
  };
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: [{ ...goods, quantity: 2, acquisition_type: "PURCHASE" }],
      notes: null,
    },
  });
  expect(receipt.status()).toBe(201);
  const returned = await page.request.post("/api/v1/supplier-returns", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      supplier_id: supplierId,
      lines: [{ ...goods, quantity: 2 }],
      note: null,
    },
  });
  expect(returned.status()).toBe(201);
  const returnId = ((await returned.json()) as { id: string }).id;
  // Another return to that supplier, cancelled: its goods came back, so it
  // is never counted.
  const receiptAgain = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: [{ ...goods, quantity: 1, acquisition_type: "PURCHASE" }],
      notes: null,
    },
  });
  expect(receiptAgain.status()).toBe(201);
  const undone = await page.request.post("/api/v1/supplier-returns", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      supplier_id: supplierId,
      lines: [{ ...goods, quantity: 1 }],
      note: null,
    },
  });
  const undoneId = ((await undone.json()) as { id: string }).id;
  expect(
    (
      await page.request.post(`/api/v1/supplier-returns/${undoneId}/cancel`, {
        headers,
        data: { reason: "постачальник не взяв" },
      })
    ).status(),
  ).toBe(200);
  const invoiceId = await anInvoice(page, supplierId, "4000.00");
  const counted = posts(page, /\/set-offs$/);

  await invoicesAt(page, hanna);
  await open(page, supplier);
  // Behind the card's ⋯: a sheet of its own (stage 2, money task list,
  // P0-2).
  await act(page, "Зарахувати повернення");
  const setOff = await sheet(page, "Зарахувати повернення");
  await expect(setOff).toContainText(
    `Повернення постачальнику «${supplier}» з цього магазину`,
  );
  // The one standing, none chosen beforehand.
  const returns = setOff
    .getByRole("list", { name: "Повернення" })
    .getByRole("button");
  await expect(returns).toHaveCount(1);
  await expect(returns).toHaveText(/^\d\d\.\d\d · 2 шт\. · склад «.+»$/);
  await expect(returns).toHaveAttribute("aria-pressed", "false");
  await returns.click();
  await expect(returns).toHaveAttribute("aria-pressed", "true");
  // More than is owed: said as it is typed, under the field, and the button
  // holds — nothing sent — as the payment's (audit 2026-11-13, money P2-5
  // (а)).
  const field = setOff.getByLabel("Скільки зарахував постачальник, грн");
  const over = setOff.locator(".pay-over");
  await field.fill("4000,01");
  await expect(over).toHaveText(
    "Це більше, ніж винні: залишок 4 000,00 грн. Решту зарахуйте на іншу накладну.",
  );
  await expect(over).toHaveAttribute("role", "alert");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(
    "Це більше, ніж винні: залишок 4 000,00 грн. Решту зарахуйте на іншу накладну.",
  );
  const held = setOff.getByRole("button", {
    name: "Зарахувати 4 000,01 грн",
    exact: true,
  });
  await expect(held).toBeDisabled();
  await held.click({ force: true });
  // The whole debt is not more: no line, the button free.
  await field.fill("4000");
  await expect(over).toHaveCount(0);
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await expect(
    setOff.getByRole("button", {
      name: "Зарахувати 4 000,00 грн",
      exact: true,
    }),
  ).toBeEnabled();
  await field.fill("4000,01");
  await expect(over).toBeVisible();
  // A sum still being typed, its comma last, is said on as it stands
  // (review).
  await field.fill("4001,");
  await expect(over).toBeVisible();
  await expect(
    setOff.getByRole("button", { name: "Зарахувати", exact: true }),
  ).toBeDisabled();
  // The sum changed: the line gone.
  await field.fill("1200");
  await expect(over).toHaveCount(0);
  await expect(field).not.toHaveAttribute("aria-describedby", /.+/);
  expect(counted.bodies).toHaveLength(0);
  // Refused: said in its sheet, the return chosen and the sum kept, as a
  // refused payment keeps its sum.
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/set-offs", 409);
  await setOff
    .getByRole("button", { name: "Зарахувати 1 200,00 грн", exact: true })
    .click();
  await expect(setOff.getByRole("alert")).toHaveText(
    "Не записано: дані змінилися — перегляньте їх.",
  );
  await expect(returns).toHaveAttribute("aria-pressed", "true");
  await expect(
    setOff.getByLabel("Скільки зарахував постачальник, грн"),
  ).toHaveValue("1200");
  await setOff
    .getByRole("button", { name: "Зарахувати 1 200,00 грн", exact: true })
    .click();
  await expect(setOff).toHaveCount(0);
  // Said over the sum by its filled eyelet.
  await expect(page.locator(".invoice-done")).toHaveText(
    "Залік 1 200,00 грн записано. Залишок 2 800,00 грн.",
  );
  await expect(page.locator(".invoice-done .eyelet")).toHaveClass(
    /\beyelet-filled\b/,
  );
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "2 800,00 грн",
  );
  await expect(owes(page)).toContainText(
    "зараховано за повернений товар 1 200,00 грн",
  );
  // The one refused, then the same set-off as a new command.
  expect(counted.bodies).toHaveLength(2);
  expect({ ...(counted.bodies[0] as object), command_id: null }).toEqual({
    ...(counted.bodies[1] as object),
    command_id: null,
  });
  expect(counted.bodies[1]).toEqual({
    command_id: expect.any(String) as string,
    supplier_return_id: returnId,
    amount: "1200.00",
  });

  // The goods stay with the supplier while it counts them: its row says
  // what was counted, its screen why it stands (stage 2, money task list,
  // P0-4).
  await section(page, "Постачальникам");
  const row = page
    .getByRole("list", { name: "Повернення постачальникам" })
    .getByRole("button", { name: new RegExp(`^${supplier} `) })
    .filter({ hasText: "× 2" });
  await expect(row.locator(".sticker")).toHaveText("Зараховано 1 200,00 грн");
  await row.click();
  await expect(
    page.getByRole("heading", { name: supplier, exact: true }),
  ).toBeVisible();
  const counts = page.getByRole("list", { name: "Зараховано в накладні" });
  await expect(counts).toContainText(
    "Постачальник зарахував 1 200,00 грн у накладну",
  );
  await expect(page.locator(".supplier-return")).toContainText(
    "Щоб скасувати повернення, спершу скасуйте залік у «Накладних».",
  );
  await expect(
    page.getByRole("button", { name: "Скасувати повернення" }),
  ).toHaveCount(0);

  // «Відкрити накладну ›» from its set-off (P1-3): the invoice's card, its
  // way back to the return.
  await counts.getByRole("button", { name: "Відкрити накладну" }).click();
  await expect(
    page.getByRole("heading", { name: supplier, exact: true }),
  ).toBeVisible();
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "2 800,00 грн",
  );
  // A line of the history pressed: its sheet asks why. A reader hears what
  // a press does.
  await expect(
    line(page, "Залік за повернення 1 200,00 грн").getByRole("button"),
  ).toHaveAccessibleName(/^Скасувати: .*Залік за повернення 1\s200,00\sгрн/);
  await line(page, "Залік за повернення 1 200,00 грн")
    .getByRole("button")
    .click();
  const why = await sheet(page, "Скасувати: залік за повернення 1 200,00 грн");
  await expect(why).toContainText(
    "Залік за повернення 1 200,00 грн записано помилково? Борг зросте на цю суму.",
  );
  await why.getByLabel("Чому скасовуємо").fill("постачальник передумав");
  await why.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(why).toHaveCount(0);
  const undoneLine = line(page, "Залік за повернення 1 200,00 грн");
  await expect(undoneLine.locator(".sticker")).toHaveText("Скасовано");
  await expect(undoneLine).toContainText(
    /\d\d\.\d\d · постачальник передумав · Тест/,
  );
  await expect(undoneLine.locator(".timeline-node")).toHaveClass(/\bhollow\b/);
  await expect(undoneLine.getByRole("button")).toHaveCount(0);
  expect(await owed(page, invoiceId)).toBe("4000.00");

  // A payment's answer lost on this card: the way back is held as
  // «Постачальникам»'s row is, until the payment is checked.
  let payment = true;
  await page.route("**/api/v1/supplier-invoices/*/payments", async (route) => {
    if (payment) {
      payment = false;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await payOnCard(page).click();
  await keyIn(page, "100");
  await payButton(page).click();
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await back(page, "Накладна").click();
  const toReturn = page.getByRole("button", { name: "Назад до «Повернення»" });
  await expect(toReturn).toBeDisabled();
  await kept
    .getByRole("button", { name: "Перевірити результат оплати" })
    .click();
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await kept.getByRole("button", { name: "Зрозуміло" }).click();
  await expect(toReturn).toBeEnabled();

  // Back to the return, read again: the set-off gone, it is cancelled.
  await toReturn.click();
  await expect(
    page.getByRole("heading", { name: supplier, exact: true }),
  ).toBeVisible();
  await expect(counts).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Скасувати повернення" }),
  ).toBeVisible();

  // Opened again once: a return made next, its answer lost and then
  // confirmed, brings back the returns' list, never this return.
  let lost = true;
  await page.route("**/api/v1/supplier-returns", async (route) => {
    if (route.request().method() === "POST" && lost) {
      lost = false;
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Постачальникам", exact: true })
    .click();
  await page
    .locator(".screen-title")
    .getByRole("button", { name: "Повернути товар постачальнику" })
    .click();
  await pickSupplier(page, supplier, {
    of: page.getByRole("group", { name: "Повернення постачальнику" }),
  });
  await page.getByRole("searchbox", { name: "Пошук моделі" }).fill(model);
  await page
    .getByRole("list", { name: "Товар на складі" })
    .getByRole("button", { name: new RegExp(`^${model}`) })
    .click();
  await page
    .getByRole("group", { name: /^Розмір L, вільно / })
    .getByRole("button", { name: "Більше" })
    .click();
  await page
    .getByRole("button", {
      name: "Повернути постачальнику · 1 шт.",
      exact: true,
    })
    .click();
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await kept
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect(
    page.getByRole("heading", { name: "Постачальникам", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Повернення постачальникам" }),
  ).toBeVisible();
});

test("read slowly, «Зарахувати повернення» holds three returns' cards in grey, and an invoice opened from its return its card's places — the title's, what is owed, two rows of its history; the words to a reader alone; nothing there under 14 (money task list after stage 2, P1-3, P2-4)", async ({
  page,
}) => {
  const supplier = `Повільний ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  const headers = await headersOf(page, hanna);
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      concept: `Повільне ${randomUUID().slice(0, 8)}`,
      variant: { color: "сірий" },
      sizes: [{ system: "ALPHA", code: "L" }],
    },
  });
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const goods = {
    product_variant_id: product.product_variant_id,
    size_id: product.sizes[0]?.size_id ?? "",
  };
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: [{ ...goods, quantity: 1, acquisition_type: "PURCHASE" }],
      notes: null,
    },
  });
  expect(receipt.status()).toBe(201);
  const returned = await page.request.post("/api/v1/supplier-returns", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      supplier_id: supplierId,
      lines: [{ ...goods, quantity: 1 }],
      note: null,
    },
  });
  expect(returned.status()).toBe(201);
  const returnId = ((await returned.json()) as { id: string }).id;
  const invoiceId = await anInvoice(page, supplierId, "4000.00");
  const counted = await page.request.post(
    `/api/v1/supplier-invoices/${invoiceId}/set-offs`,
    {
      headers,
      data: {
        command_id: randomUUID(),
        supplier_return_id: returnId,
        amount: "500.00",
      },
    },
  );
  expect(counted.status()).toBe(201);

  await invoicesAt(page, hanna);
  await open(page, supplier);
  // The card's «Записано …» and its history: 14 at least.
  expect(await under14(page.locator("section.invoice-detail"))).toEqual([]);
  const actions = await ways(page);
  await expect(
    actions.getByText("Спершу скасуйте її оплати й заліки.", { exact: true }),
  ).toHaveCSS("font-size", "14px");
  expect(await under14(actions)).toEqual([]);
  const returns = await holdReads(page, "supplier-returns");
  await actions
    .getByRole("button", { name: "Зарахувати повернення", exact: true })
    .click();
  const setOff = await sheet(page, "Зарахувати повернення");
  const cards = setOff.locator(
    ".placeholder .set-off-returns > .set-off-return",
  );
  await expect(cards).toHaveCount(3);
  // Each card's grey lines across the card, as its own words would be.
  expect(
    (await cards.first().locator(".skeleton-name").boundingBox())?.width ?? 0,
  ).toBeGreaterThan(100);
  await expect(
    setOff.getByRole("status").filter({ hasText: "Завантажуємо повернення…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  returns();
  await expect(
    setOff.getByRole("list", { name: "Повернення" }).getByRole("button"),
  ).toHaveCount(1);
  await expect(cards).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(setOff).toHaveCount(0);

  // From the return, by its set-off: the invoice is found among its
  // supplier's, its card's places held meanwhile.
  await section(page, "Постачальникам");
  await page
    .getByRole("list", { name: "Повернення постачальникам" })
    .getByRole("button", { name: new RegExp(`^${supplier} `) })
    .click();
  await expect(
    page.getByRole("heading", { name: supplier, exact: true }),
  ).toBeVisible();
  const why = page.getByText(
    "Щоб скасувати повернення, спершу скасуйте залік у «Накладних».",
    { exact: true },
  );
  await expect(why).toHaveCSS("font-size", "14px");
  expect(await under14(page.locator(".supplier-return"))).toEqual([]);
  const invoices = await holdReads(page, "supplier-invoices");
  await page
    .getByRole("list", { name: "Зараховано в накладні" })
    .getByRole("button", { name: "Відкрити накладну" })
    .click();
  const place = page.locator(".invoice-placeholder");
  await expect(place).toBeVisible();
  await expect(page.locator(".screen-title .skeleton-title")).toBeVisible();
  // The line under the title where the card's will be: its ⋯'s place held.
  const line = page.locator(".store-line");
  const under = (await line.boundingBox())?.y ?? Number.NaN;
  await expect(
    page.getByRole("button", { name: "Назад до «Повернення»" }),
  ).toBeVisible();
  await expect(place.locator(".invoice-owed-sum .skeleton-line")).toBeVisible();
  await expect(place.locator(".invoice-bar")).toBeVisible();
  await expect(place.locator(".timeline-row")).toHaveCount(2);
  // Its eyelets round, as the history's own.
  await expect(place.locator(".timeline-node").first()).toHaveCSS(
    "border-top-left-radius",
    "999px",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Завантажуємо накладну…" }),
  ).toHaveClass(/\bvisually-hidden\b/);
  await expect(page.getByText("Завантажуємо накладну…")).toHaveCount(1);
  await page.screenshot({ path: "test-results/invoice-finding.png" });
  invoices();
  await expect(
    page.getByRole("heading", { name: supplier, level: 1 }),
  ).toBeVisible();
  await expect(place).toHaveCount(0);
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "3 500,00 грн",
  );
  await expect(
    page.getByRole("button", { name: "Дії з накладною" }),
  ).toBeVisible();
  expect(
    Math.abs(((await line.boundingBox())?.y ?? Number.NaN) - under),
  ).toBeLessThanOrEqual(1);
});

test("a payment or an invoice recorded by mistake is cancelled, saying why", async ({
  page,
}) => {
  const supplier = `Помилка ${randomUUID().slice(0, 6)}`;
  const invoiceId = await anInvoice(
    page,
    await aSupplier(page, supplier),
    "2000.00",
    "500.00",
  );
  await invoicesAt(page, hanna);
  await open(page, supplier);
  // Not while a payment on it stands: dark, and why under it.
  let actions = await ways(page);
  const cancel = actions.getByRole("button", { name: "Скасувати накладну" });
  await expect(cancel).toBeDisabled();
  await expect(cancel).toHaveAccessibleDescription(
    "Спершу скасуйте її оплати й заліки.",
  );
  await page.keyboard.press("Escape");
  await expect(actions).toHaveCount(0);

  await line(page, "Оплата 500,00 грн").getByRole("button").click();
  const why = await sheet(page, "Скасувати: оплата 500,00 грн");
  await expect(
    why.getByRole("button", { name: "Так, скасувати" }),
  ).toBeDisabled();
  await why.getByLabel("Чому скасовуємо").fill("гроші не віддали");
  await why.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(line(page, "Оплата 500,00 грн")).toContainText(
    "гроші не віддали",
  );
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "2 000,00 грн",
  );
  expect(await owed(page, invoiceId)).toBe("2000.00");

  actions = await ways(page);
  await actions.getByRole("button", { name: "Скасувати накладну" }).click();
  const cancelling = await sheet(page, "Скасувати накладну");
  await expect(cancelling).toContainText(
    "Накладну записано помилково? Вона лишиться в історії як скасована.",
  );
  await cancelling.getByLabel("Чому скасовуємо").fill("не та сума");
  await cancelling
    .getByRole("button", { name: "Так, скасувати накладну" })
    .click();
  await expect(page.locator(".invoice-closed .sticker")).toHaveText(
    "Скасовано",
  );
  await expect(page.locator(".invoice-closed")).toContainText(
    /\d\d\.\d\d · не та сума · Тест/,
  );
  // Nothing to pay, nothing behind a ⋯.
  await expect(payOnCard(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Дії з накладною" }),
  ).toHaveCount(0);
  expect(await owed(page, invoiceId)).toBe("0.00");
});

test("what is left is written off by the owner, never by a manager", async ({
  page,
}) => {
  const supplier = `Списання ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "1500.00");
  await invoicesAt(page, marko);
  await open(page, supplier);
  await expect(payOnCard(page)).toBeVisible();
  // A manager's ⋯: set off and cancelled, never written off (P0-2).
  await expect((await ways(page)).locator(".sheet-way")).toHaveText([
    "Зарахувати повернення",
    "Скасувати накладну",
  ]);

  await invoicesAt(page, hanna);
  await open(page, supplier);
  await expect((await ways(page)).locator(".sheet-way")).toHaveText([
    "Зарахувати повернення",
    "Списати залишок",
    "Скасувати накладну",
  ]);
  await page.keyboard.press("Escape");
  await act(page, "Списати залишок");
  const off = await sheet(page, "Списати залишок 1 500,00 грн?");
  await expect(off).toContainText(
    "Залишок 1 500,00 грн закриється без оплати. Скасувати це потім не можна.",
  );
  await expect(
    off.getByRole("button", { name: "Так, списати 1 500,00 грн" }),
  ).toBeDisabled();
  await off.getByLabel("Чому списуємо").fill("постачальник пробачив");
  await off.getByRole("button", { name: "Так, списати 1 500,00 грн" }).click();
  await expect(off).toHaveCount(0);
  await expect(page.locator(".invoice-done")).toHaveText(
    "Списано 1 500,00 грн.",
  );
  await expect(page.locator(".invoice-closed .sticker")).toHaveText(
    "Залишок списано",
  );
  await expectGlyphBeside(page.locator(".invoice-closed .sticker"));
  await expect(line(page, "Списано 1 500,00 грн")).toContainText(
    "Тест · постачальник пробачив",
  );
  // Final: nothing of it pressed, nothing behind a ⋯, nothing to pay.
  await expect(history(page).getByRole("button")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Дії з накладною" }),
  ).toHaveCount(0);
  await expect(payOnCard(page)).toHaveCount(0);
  // On «Усі»: knotted, its sticker, no verb.
  await back(page, "Накладні").click();
  const written = tag(page, supplier);
  await expect(written).toHaveClass(/\btied\b/);
  await expect(written.locator(".order-tag-eyelet .eyelet")).toHaveClass(
    /\beyelet-knot\b/,
  );
  await expect(written.locator(".sticker")).toHaveText("Залишок списано");
  await expect(written.locator(".invoice-tag-sum")).toHaveText("1 500,00 грн");
  await expect(written.getByRole("button", { name: "Сплатити" })).toHaveCount(
    0,
  );
});

test("an invoice read again after a refusal never brings back the screen left before its answer came", async ({
  page,
}) => {
  const supplier = `Пізно ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "800.00");
  // The read after a refusal — the supplier's invoices, fifty at most —
  // held until the screen is left.
  const readAgain = (url: URL): boolean =>
    url.pathname === "/api/v1/supplier-invoices" &&
    url.searchParams.get("limit") === "50";
  let release = (): void => {};
  await page.route(readAgain, async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.continue();
  });
  const asked = (): Promise<unknown> =>
    page.waitForRequest((request) => readAgain(new URL(request.url())));
  const answered = (): Promise<unknown> =>
    page.waitForResponse((response) => readAgain(new URL(response.url())));
  await invoicesAt(page, hanna);
  await open(page, supplier);

  // A payment refused, «← Накладна» pressed before the invoice is read
  // again: the card stays, never the payment again.
  await payOnCard(page).click();
  await keyIn(page, "100");
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/payments", 409);
  let read = asked();
  await payButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await read;
  await back(page, "Накладна").click();
  await expect(owes(page)).toBeVisible();
  let came = answered();
  release();
  await came;
  await page.waitForTimeout(300);
  await expect(page.locator(".invoice-pay")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: supplier, level: 1 }),
  ).toBeVisible();
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "800,00 грн",
  );

  // A write-off refused on the card, «← Накладні» pressed before it is read
  // again: the list stays.
  await act(page, "Списати залишок");
  const off = await sheet(page, "Списати залишок 800,00 грн?");
  await off.getByLabel("Чому списуємо").fill("постачальник пробачив");
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/write-off", 409);
  read = asked();
  await off.getByRole("button", { name: "Так, списати 800,00 грн" }).click();
  await expect(off).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  await read;
  await back(page, "Накладні").click();
  await expect(tag(page, supplier)).toBeVisible();
  came = answered();
  release();
  await came;
  await page.waitForTimeout(300);
  await expect(page.locator(".invoice-detail")).toHaveCount(0);
  await expect(tag(page, supplier)).toBeVisible();
});

test("an archived store's invoice is paid by a store that trades", async ({
  page,
}) => {
  const paid = posts(page, /\/payments$/);
  await invoicesAt(page, hanna);
  // A row under the list, never a list of whose (P0-1).
  await page
    .getByRole("button", { name: "Накладні магазинів, що не працюють" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Накладні магазинів, що не працюють",
      level: 1,
    }),
  ).toBeVisible();
  // No total there, nothing new, no row to itself.
  await expect(page.locator(".invoice-total")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Записати накладну" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Накладні магазинів, що не працюють" }),
  ).toHaveCount(0);
  const old = tag(page, "Постачальник Старого");
  await expect(old).toContainText("магазин «Старий»");
  await old.locator(".order-row").click();
  await expect(
    page.getByText(/^Накладна магазину «Старий», який зараз закрито/),
  ).toBeVisible();
  // Set off and cancelled only where it is owed; written off by the
  // network's owner alone: nothing behind a ⋯ here.
  await expect(
    page.getByRole("button", { name: "Дії з накладною" }),
  ).toHaveCount(0);
  const before = Number(
    (await owes(page).locator(".invoice-owed-sum").innerText())
      .replace(/[^\d,]/g, "")
      .replace(",", "."),
  );
  await payOnCard(page).click();
  await expect(
    page.getByText(/^Накладна магазину «Старий», який зараз закрито/),
  ).toBeVisible();
  await keyIn(page, "100");
  await payButton(page).click();
  await expect(result(page).locator(".stub-line")).toHaveText(
    `Залишок ${grn((before - 100).toFixed(2))}.`,
  );
  await done(page);
  await expect(line(page, "Оплата 100,00 грн").first()).toContainText(
    "сплатив магазин «Центр»",
  );
  expect(paid.bodies).toEqual([
    {
      command_id: expect.any(String) as string,
      amount: "100.00",
      store_id: centre,
    },
  ]);
  await back(page, "Накладні").click();
  await expect(
    page.getByRole("heading", {
      name: "Накладні магазинів, що не працюють",
      level: 1,
    }),
  ).toBeVisible();
});

test("a payment whose answer is lost is resent unchanged, and paid once", async ({
  page,
}) => {
  const supplier = `Втрачена ${randomUUID().slice(0, 6)}`;
  const invoiceId = await anInvoice(
    page,
    await aSupplier(page, supplier),
    "1000.00",
  );
  const paid = posts(page, /\/payments$/);
  let first = true;
  await page.route("**/api/v1/supplier-invoices/*/payments", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await invoicesAt(page, hanna);
  await open(page, supplier);
  await payOnCard(page).click();
  await keyIn(page, "300");
  await payButton(page).click();
  // On «Накладні», its own screen: the sale's stub, still attached, its
  // check its main button — the phone never checks an invoice by itself, so
  // nothing says it does (G11; stage 2, money task list, P0-6).
  const kept = page.locator(".stub-notice .stub");
  await expect(kept).toHaveClass(/\bstub-kept\b/);
  await expect(kept.locator("> .eyelet")).toHaveClass(/\beyelet-dashed\b/);
  await expect(kept.locator(".stub-head")).toHaveText("Ще не підтверджено");
  await expect(
    kept.getByRole("heading", { name: "Оплату ще не підтверджено" }),
  ).toBeVisible();
  await expect(kept).toContainText(
    "Невідомо, чи записано оплату. Перевірте результат — та сама операція не запишеться двічі.",
  );
  await expect(kept).toContainText(/Чекає відповіді сервера з \d{2}:\d{2}\./);
  await expect(page.getByText(/Перевіряємо кожні 20 с/)).toHaveCount(0);
  // Suppliers are not paid on paper: no paper line on it, and nothing
  // under it says what the paper banner says (stage 2, orders task list,
  // P0-3).
  await expect(kept).not.toContainText("папері");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    kept.getByRole("button", { name: "Перевірити результат оплати" }),
  ).not.toHaveClass(/\bquiet\b/);
  // Nothing is paid twice meanwhile: the keypad is held.
  await expect(payButton(page)).toBeDisabled();
  // Back to the card, the menu with it.
  await back(page, "Накладна").click();
  await expect(
    page.getByRole("button", { name: "Замовлення", exact: true }),
  ).toBeDisabled();
  // Its own section stays open — on «Гроші» for whoever has it — every
  // other is held (P1-6; «Усе на бірці» sections task list, P0-7).
  await sections(page)
    .getByRole("button", { name: "Гроші", exact: true })
    .click();
  await expect(
    page
      .getByRole("article", { name: "Ви винні постачальникам" })
      .getByRole("button", { name: /^Накладні магазину / }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("article", { name: "Вам винні клієнти" })
      .getByRole("button", { name: "Вам винні клієнти" }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("navigation", { name: "Гроші" })
      .getByRole("button", { name: "Закриття" }),
  ).toBeDisabled();
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: "Інвентаризація", exact: true }),
  ).toBeDisabled();
  // Written down before it was sent: a reload still knows what to ask about.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByRole("heading", { name: "Накладні", exact: true }),
  ).toBeVisible();
  await kept
    .getByRole("button", { name: "Перевірити результат оплати" })
    .click();
  // Confirmed: torn off, once, with what it recorded.
  await expect(kept).toHaveClass(/\bstub-recorded\b/);
  await expect(
    kept.getByRole("heading", { name: "Оплату записано один раз" }),
  ).toBeVisible();
  await expect(kept).toContainText(
    "Оплату 300,00 грн записано. Залишок 700,00 грн.",
  );
  expect(paid.bodies).toHaveLength(2);
  expect(paid.bodies[1]).toEqual(paid.bodies[0]);
  expect(await owed(page, invoiceId)).toBe("700.00");
  await kept.getByRole("button", { name: "Зрозуміло" }).click();
  await expect(page.locator(".stub-notice")).toHaveCount(0);
});

test("inside Telegram a payment kept on the phone asks before Бірка closes off its own screen, after a reload too, until its check confirms it; «Нова накладна» asks while a supplier or a sum is typed, never once recorded or left (audit 2026-11-13, money P2-6)", async ({
  page,
}) => {
  const supplier = `Закриття ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "900.00");
  let first = true;
  await page.route("**/api/v1/supplier-invoices/*/payments", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  const closing = async (): Promise<unknown> =>
    (await told(page, "web_app_setup_closing_behavior")).at(-1);
  await invoicesAt(page, hanna, { telegram: true });
  await open(page, supplier);
  await telegramSays(page, "main_button_pressed");
  await keyIn(page, "300");
  await payButton(page).click();
  await expect(page.locator(".stub-notice .stub-kept")).toBeVisible();
  // Off the payment, whose own sum asked: kept, Telegram still asks.
  await back(page, "Накладна").click();
  await expect(
    page.getByRole("heading", { name: supplier, level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".keypad")).toHaveCount(0);
  expect(await closing()).toEqual({ need_confirmation: true });
  // Read from the phone after a reload: asked from the first.
  await page.reload();
  await openStore(page, "Центр CENTRE");
  await expect(
    page.getByRole("heading", { name: "Накладні", exact: true }),
  ).toBeVisible();
  await expect.poll(closing).toEqual({ need_confirmation: true });
  const kept = page.locator(".stub-notice .stub");
  await kept
    .getByRole("button", { name: "Перевірити результат оплати" })
    .click();
  await expect(
    kept.getByRole("heading", { name: "Оплату записано один раз" }),
  ).toBeVisible();
  await expect.poll(closing).toEqual({ need_confirmation: false });
  await kept.getByRole("button", { name: "Зрозуміло" }).click();

  // «Нова накладна»: nothing typed, nothing asked; a supplier chosen, it
  // asks; «←» lets it go.
  const newInvoice = page.getByRole("button", {
    name: "Записати накладну",
    exact: true,
  });
  await newInvoice.click();
  await expect(
    page.getByRole("heading", { name: "Нова накладна", level: 1 }),
  ).toBeVisible();
  expect(await closing()).toEqual({ need_confirmation: false });
  await page
    .getByRole("button", { name: "Постачальник Оберіть", exact: true })
    .click();
  const suppliers = await sheet(page, "Постачальник");
  await suppliers
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(supplier);
  await suppliers
    .locator(".supplier-row")
    .filter({ has: page.getByText(supplier, { exact: true }) })
    .click();
  await expect.poll(closing).toEqual({ need_confirmation: true });
  await back(page, "Накладні").click();
  await expect(
    page.getByRole("heading", { name: "Накладні", exact: true }),
  ).toBeVisible();
  await expect.poll(closing).toEqual({ need_confirmation: false });
  // A sum alone asks too; recorded, it is let go.
  await newInvoice.click();
  await page.getByLabel("Сума за накладною, грн").fill("400");
  await expect.poll(closing).toEqual({ need_confirmation: true });
  await page
    .getByRole("button", { name: "Постачальник Оберіть", exact: true })
    .click();
  const again = await sheet(page, "Постачальник");
  await again
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(supplier);
  await again
    .locator(".supplier-row")
    .filter({ has: page.getByText(supplier, { exact: true }) })
    .click();
  await page
    .locator(".order-dock")
    .getByRole("button", { name: "Записати накладну", exact: true })
    .click();
  await expect(
    result(page).getByRole("heading", { name: "Накладну записано" }),
  ).toBeVisible();
  await expect.poll(closing).toEqual({ need_confirmation: false });
});

test("a payment kept on the phone is checked from another screen, and the till is free once it is confirmed", async ({
  page,
}) => {
  const supplier = `Здалеку ${randomUUID().slice(0, 6)}`;
  const invoiceId = await anInvoice(
    page,
    await aSupplier(page, supplier),
    "800.00",
  );
  const paid = posts(page, /\/payments$/);
  let first = true;
  await page.route("**/api/v1/supplier-invoices/*/payments", async (route) => {
    if (first) {
      first = false;
      // The server takes it; the answer never arrives.
      await route.fetch();
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await invoicesAt(page, hanna);
  await open(page, supplier);
  await payOnCard(page).click();
  await keyIn(page, "200");
  await payButton(page).click();
  await expect(page.locator(".stub-notice .stub-kept")).toBeVisible();
  await back(page, "Накладна").click();
  // «Гроші», the section it leaves open: over it, a banner — the same
  // words, the same check (stage 2, money task list, P0-6).
  await sections(page)
    .getByRole("button", { name: "Гроші", exact: true })
    .click();
  const banner = page.locator(".banner-kept");
  await expect(
    banner.getByRole("heading", { name: "Оплату ще не підтверджено" }),
  ).toBeVisible();
  await expect(banner).toContainText("Невідомо, чи записано оплату.");
  await expect(banner).toContainText(/Чекає відповіді сервера з \d{2}:\d{2}\./);
  await expect(banner.locator(".check-line")).toHaveCount(0);
  await expect(page.locator(".stub-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  await banner
    .getByRole("button", { name: "Перевірити результат оплати" })
    .click();
  const recorded = page.locator(".banner-recorded");
  await expect(
    recorded.getByRole("heading", { name: "Оплату записано один раз" }),
  ).toBeVisible();
  await expect(recorded).toContainText(
    "Оплату 200,00 грн записано. Залишок 600,00 грн.",
  );
  await expect(banner).toHaveCount(0);
  // Settled: the till is the seller's again.
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  await recorded.getByRole("button", { name: "Зрозуміло" }).click();
  await expect(recorded).toHaveCount(0);
  expect(paid.bodies).toHaveLength(2);
  expect(paid.bodies[1]).toEqual(paid.bodies[0]);
  expect(await owed(page, invoiceId)).toBe("600.00");
  // Back on «Накладні», the invoices read again, nothing typed.
  await section(page, "Накладні");
  await expect(page.locator(".stub-notice")).toHaveCount(0);
  await expect(page.locator(".keypad")).toHaveCount(0);
  const own = tag(page, supplier);
  await expect(own.locator(".invoice-tag-sum")).toHaveText("600,00 грн");
  await expect(own).toContainText("сплачено 200,00 грн з 800,00 грн");
});

test("a kept payment refused on its check says why in the invoices' words, and frees the till", async ({
  page,
}) => {
  const supplier = `Відмова ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "500.00");
  let first = true;
  await page.route("**/api/v1/supplier-invoices/*/payments", async (route) => {
    if (first) {
      first = false;
      // Never reached the server.
      await route.abort("connectionfailed");
    } else await route.fallback();
  });
  await invoicesAt(page, hanna);
  await open(page, supplier);
  await payOnCard(page).click();
  await keyIn(page, "100");
  await payButton(page).click();
  await expect(page.locator(".stub-notice .stub-kept")).toBeVisible();
  // Paid in full meanwhile, says the server, having recorded nothing.
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/payments", 422, {
    reason: "NOT_OWED",
    status: "SETTLED",
    recorded: false,
  });
  await back(page, "Накладна").click();
  await sections(page)
    .getByRole("button", { name: "Гроші", exact: true })
    .click();
  await page
    .locator(".banner-kept")
    .getByRole("button", { name: "Перевірити результат оплати" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "За цією накладною вже нічого не винні." }),
  ).toBeVisible();
  await expect(page.locator(".banner-kept, .banner-recorded")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
});

test("a kept payment refused on its check for a conflict it does not name keeps the kept operations' words (owner, В-П1 (б))", async ({
  page,
}) => {
  const supplier = `Збережені ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "500.00");
  let first = true;
  await page.route("**/api/v1/supplier-invoices/*/payments", async (route) => {
    if (first) {
      first = false;
      // Never reached the server.
      await route.abort("connectionfailed");
    } else await route.fallback();
  });
  await invoicesAt(page, hanna);
  await open(page, supplier);
  await payOnCard(page).click();
  await keyIn(page, "100");
  await payButton(page).click();
  await expect(page.locator(".stub-notice .stub-kept")).toBeVisible();
  // Changed meanwhile, says the server, having recorded nothing: the kept
  // payment's words, as before — never the words of one just pressed.
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/payments", 409, {
    recorded: false,
  });
  await back(page, "Накладна").click();
  await sections(page)
    .getByRole("button", { name: "Гроші", exact: true })
    .click();
  await page
    .locator(".banner-kept")
    .getByRole("button", { name: "Перевірити результат оплати" })
    .click();
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Не записано: дані змінилися — перегляньте їх і спробуйте ще раз.",
    }),
  ).toBeVisible();
  await expect(page.locator(".banner-kept, .banner-recorded")).toHaveCount(0);
});

// --- «Накладні» as tags (stage 2, money task list, P0-1, P0-3) --------------

test("«Накладні» are tags: owed filled in ink, closed knotted, cancelled bare; one switch, one field, the total in ink", async ({
  page,
}) => {
  const supplier = `Бирки ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier, "067 000 12 34");
  const headers = await headersOf(page, hanna);
  await anInvoice(page, supplierId, "1000.00");
  await anInvoice(page, supplierId, "2000.00", "500.00");
  await anInvoice(page, supplierId, "300.00", "300.00");
  const mistaken = await anInvoice(page, supplierId, "400.00");
  expect(
    (
      await page.request.post(`/api/v1/supplier-invoices/${mistaken}/cancel`, {
        headers,
        data: { reason: "двічі" },
      })
    ).status(),
  ).toBe(200);
  await invoicesAt(page, hanna);
  // One switch, «Винні зараз» the first; one field; no native list.
  await expect(mode(page, "Винні зараз")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(mode(page, "Усі")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  // The store's total, as the server sums it, in ink.
  const total = page.locator(".invoice-total-line");
  await expect(total).toHaveText(
    /^Винні \d{1,3}(\s\d{3})*,\d\d\sгрн · \d+\sнакладн(а|і|их)$/,
  );
  const ink = await resolved(page, "var(--ink)");
  const owedRed = await resolved(page, "var(--owed)");
  await expect(total.locator(".t-money-l")).toHaveCSS("color", ink);
  expect(ink).not.toBe(owedRed);

  // The field opens its sheet: «Усі постачальники» first and chosen, what
  // each owes under its name, nothing to add.
  const field = page.getByRole("button", {
    name: "Постачальник Усі постачальники",
    exact: true,
  });
  await expect(field).toHaveAttribute("aria-haspopup", "dialog");
  const taps = await countTaps(page);
  await field.click();
  const suppliers = await sheet(page, "Постачальник");
  const everyone = suppliers
    .locator(".supplier-row")
    .filter({ hasText: "Усі постачальники" });
  await expect(suppliers.locator(".supplier-row").first()).toHaveText(
    "Усі постачальники",
  );
  await expect(everyone).toHaveAttribute("aria-current", "true");
  await expect(
    suppliers.getByRole("button", { name: /Новий постачальник/ }),
  ).toHaveCount(0);
  await suppliers
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(supplier);
  await expect(everyone).toHaveCount(0);
  const row = suppliers
    .locator(".supplier-row")
    .filter({ has: page.getByText(supplier, { exact: true }) });
  await expect(row.locator(".t-meta")).toHaveText(
    "винні 2 500,00 грн · 2 накладні",
  );
  await row.click();
  // Picked in two taps — the field and the row; typing is not one.
  expect(await taps()).toBe(2);
  await expect(suppliers).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Постачальник ${supplier}`, exact: true }),
  ).toBeVisible();
  await expect(total).toHaveText(
    `Винні постачальнику «${supplier}» 2 500,00 грн · 2 накладні`,
  );

  // What is owed now: two tags, the newest first, each filled — it waits on
  // you — what is owed on the right, in ink, «Сплатити» on it.
  const tags = page
    .getByRole("list", { name: "Накладні" })
    .getByRole("article");
  await expect(tags).toHaveCount(2);
  await expect(tags.locator(".invoice-tag-sum")).toHaveText([
    "1 500,00 грн",
    "1 000,00 грн",
  ]);
  await expect(tags.nth(0).locator(".order-tag-meta")).toHaveText(
    /^\d\d\.\d\d · Тест · сплачено 500,00\sгрн з 2\s000,00\sгрн$/,
  );
  await expect(tags.nth(1).locator(".order-tag-meta")).toHaveText(
    /^\d\d\.\d\d · Тест$/,
  );
  for (const each of await tags.all()) {
    await expect(each).toHaveClass(/\bfilled\b/);
    await expect(each.locator(".invoice-tag-sum")).toHaveCSS("color", ink);
    await expect(each.getByRole("button", { name: "Сплатити" })).toBeVisible();
    await expect(each.locator(".sticker")).toHaveCount(0);
  }

  // «Усі»: the paid one knotted, the cancelled one bare, each with its
  // sticker and its glyph; their sums the invoices', no verb on them.
  await mode(page, "Усі").click();
  await expect(tags).toHaveCount(4);
  await expect(tags.locator(".invoice-tag-sum")).toHaveText([
    "400,00 грн",
    "300,00 грн",
    "1 500,00 грн",
    "1 000,00 грн",
  ]);
  const cancelled = tags.nth(0);
  await expect(cancelled).toHaveClass(/\bnone\b/);
  await expect(cancelled.locator(".order-tag-eyelet .eyelet")).toHaveCount(0);
  await expect(cancelled.locator(".sticker")).toHaveText("Скасовано");
  await expect(cancelled.locator(".sticker")).toHaveClass(/\btone-offline\b/);
  const settled = tags.nth(1);
  await expect(settled).toHaveClass(/\btied\b/);
  await expect(settled.locator(".order-tag-eyelet .eyelet")).toHaveClass(
    /\beyelet-knot\b/,
  );
  await expect(settled.locator(".sticker")).toHaveText("Сплачено повністю");
  await expect(settled.locator(".sticker")).toHaveClass(/\btone-paid\b/);
  for (const closed of [cancelled, settled]) {
    await expectGlyphBeside(closed.locator(".sticker"));
    await expect(closed.getByRole("button", { name: "Сплатити" })).toHaveCount(
      0,
    );
    await expect(closed.locator(".invoice-tag-sum")).toHaveCSS("color", ink);
  }
  // The whole tag opens its card.
  await settled.locator(".order-row").click();
  await expect(
    page.getByRole("heading", { name: supplier, level: 1 }),
  ).toBeVisible();
  await back(page, "Накладні").click();

  // «Усі постачальники» again from the sheet's first row.
  await page
    .getByRole("button", { name: `Постачальник ${supplier}`, exact: true })
    .click();
  const again = await sheet(page, "Постачальник");
  await again
    .locator(".supplier-row")
    .filter({ hasText: "Усі постачальники" })
    .click();
  await expect(field).toBeVisible();
  await expect(total).toHaveText(/^Винні /);
  // Those of the stores that do not trade, a row under the list.
  await expect(
    page.getByRole("button", { name: "Накладні магазинів, що не працюють" }),
  ).toBeVisible();
});

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const)
  test(`in the ${name} theme the invoices' sums are in ink, and a tag, the card and the payment read at 4.5:1`, async ({
    page,
  }) => {
    const supplier = `Тема ${randomUUID().slice(0, 6)}`;
    await anInvoice(page, await aSupplier(page, supplier), "1499.50", "500");
    await page.setViewportSize({ width: 360, height: 740 });
    await invoicesAt(page, hanna, { theme });
    const ink = await resolved(page, "var(--ink)");
    const owedRed = await resolved(page, "var(--owed)");
    expect(ink).not.toBe(owedRed);
    const own = tag(page, supplier);
    await expect(own.locator(".invoice-tag-sum")).toHaveCSS("color", ink);
    await expect(page.locator(".invoice-total-line .t-money-l")).toHaveCSS(
      "color",
      ink,
    );
    for (const part of [
      own.locator(".order-tag-title"),
      own.locator(".invoice-tag-sum"),
      own.locator(".order-tag-meta"),
      own.getByRole("button", { name: "Сплатити" }),
      page.locator(".invoice-total-line .t-row").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/invoices-${name}.png` });

    await own.locator(".order-row").click();
    const sum = owes(page).locator(".invoice-owed-sum");
    await expect(sum).toHaveText("999,50 грн");
    await expect(sum).toHaveCSS("color", ink);
    // What is paid, in the paid colour — never the debts' red.
    await expect(page.locator(".invoice-bar span")).toHaveCSS(
      "background-color",
      await resolved(page, "var(--paid)"),
    );
    for (const part of [
      sum,
      owes(page).locator(".owed-count").first(),
      page.locator(".debt-context"),
      history(page).locator(".timeline-what").first(),
      history(page).locator(".timeline-meta").first(),
      payOnCard(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    const dots = page.getByRole("button", { name: "Дії з накладною" });
    const box = await dots.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/invoice-card-${name}.png` });

    await payOnCard(page).click();
    await keyIn(page, "500");
    for (const part of [
      owes(page).locator(".invoice-owed-sum"),
      page.locator(".keypad-label"),
      page.getByRole("button", { name: "Увесь залишок 999,50 грн" }),
      payButton(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/invoice-pay-${name}.png` });
    // Paid: «Оплату записано» the result's heading at 360, at 4.5:1 (audit
    // 2026-11-13, money P2-2 (а)).
    await payButton(page).click();
    const paid = result(page).getByRole("heading", {
      name: "Оплату записано",
    });
    await expectResultHeading(paid);
    expect(await contrast(paid)).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/invoice-paid-${name}.png` });
  });

test("at 390 × 844 the total and three tags show at once, at 360 × 640 the total and one; a forty-letter name wraps, its sum whole; its age said once five minutes old", async ({
  page,
}) => {
  // Forty letters, an older invoice; three of another supplier the newest.
  const long = `Постачальник із дуже довгою назвою ${randomUUID().slice(0, 5)}`;
  expect(long).toHaveLength(40);
  await anInvoice(page, await aSupplier(page, long), "123456.78");
  const supplier = `Видно ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  for (const amount of ["100.00", "200.00", "300.00"])
    await anInvoice(page, supplierId, amount);
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await invoicesAt(page, hanna);
  const total = page.locator(".invoice-total-line");
  const tags = page
    .getByRole("list", { name: "Накладні" })
    .getByRole("article");
  await expect(tags.first()).toHaveAccessibleName(supplier);
  await overMenu(page, total);
  for (const n of [0, 1, 2]) await overMenu(page, tags.nth(n));
  // No age while it is fresh.
  await expect(page.locator(".invoice-total .day-stamp")).toHaveCount(0);

  await page.setViewportSize({ width: 360, height: 640 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await overMenu(page, total);
  await overMenu(page, tags.first());
  // The long name wraps; the sum stays whole, inside the tag.
  const longTag = tag(page, long);
  await longTag.scrollIntoViewIfNeeded();
  await expect(longTag.locator(".invoice-tag-sum")).toHaveText(
    "123 456,78 грн",
  );
  const look = await longTag.evaluate((node) => {
    const name = node.querySelector(".order-tag-title");
    const money = node.querySelector(".invoice-tag-sum");
    if (!(name instanceof HTMLElement) || !(money instanceof HTMLElement))
      throw new Error("no tag");
    const box = node.getBoundingClientRect();
    const sumBox = money.getBoundingClientRect();
    const words = document.createRange();
    words.selectNodeContents(name);
    return {
      lines: new Set(
        [...words.getClientRects()].map((rect) => Math.round(rect.top)),
      ).size,
      cut: money.scrollWidth > money.clientWidth,
      inside: sumBox.right <= box.right && sumBox.left >= box.left,
    };
  });
  expect(look.lines).toBeGreaterThanOrEqual(2);
  expect(look.cut).toBe(false);
  expect(look.inside).toBe(true);
  // `money-m`, as a model's price on its tag: the text face, 20/24, 600 —
  // on one line beside the name's first (audit 2026-11-13, money P2-3).
  const tagSum = longTag.locator(".invoice-tag-sum");
  await expectSumRole(tagSum, "money-m");
  const sumBox = await tagSum.boundingBox();
  const nameBox = await longTag.locator(".order-tag-title").boundingBox();
  expect(sumBox?.height ?? 0).toBeLessThan(1.5 * 24);
  expect(Math.abs((sumBox?.y ?? 0) - (nameBox?.y ?? 0))).toBeLessThanOrEqual(4);
  await expect(longTag.locator(".order-tag-title")).toHaveText(long);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);

  // Six minutes on, nothing read again: «дані на …» by the total, in the
  // warning's colour (spec §6.17).
  await page.clock.fastForward("06:00");
  const stamp = page.locator(".invoice-total .day-stamp");
  await expect(stamp).toHaveText(/^дані на \d\d:\d\d/);
  await expect(stamp).toHaveClass(/\bstale\b/);
});

test("a part of an invoice is paid in four taps from «Гроші», a new invoice recorded in seven at most", async ({
  page,
}) => {
  const supplier = `Чотири ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  await anInvoice(page, supplierId, "900.00");
  await at(page, hanna);
  const taps = await countTaps(page);
  // The tab, the store's line of «Ви винні постачальникам», «Сплатити» on
  // the tag, the dock's button: the sum typed is not a tap.
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  await page
    .getByRole("article", { name: "Ви винні постачальникам" })
    .getByRole("button", { name: /^Накладні магазину / })
    .click();
  await tag(page, supplier).getByRole("button", { name: "Сплатити" }).click();
  await page.getByLabel("Сума, грн").fill("250");
  await expect(page.getByLabel("Сума, грн")).toHaveAttribute(
    "inputmode",
    "none",
  );
  await payButton(page).click();
  await expect(result(page).locator(".stub-line")).toHaveText(
    "Залишок 650,00 грн.",
  );
  expect(await taps()).toBe(4);

  // A new invoice: the tab, the store's line of «Ви винні постачальникам»,
  // «+», the field, the row — the cursor then in the sum — «Записати
  // накладну».
  await at(page, hanna);
  const newTaps = await countTaps(page);
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  await page
    .getByRole("article", { name: "Ви винні постачальникам" })
    .getByRole("button", { name: /^Накладні магазину / })
    .click();
  await page
    .getByRole("button", { name: "Записати накладну", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Постачальник Оберіть", exact: true })
    .click();
  const suppliers = await sheet(page, "Постачальник");
  await suppliers
    .getByRole("searchbox", { name: "Пошук постачальника" })
    .fill(supplier);
  await suppliers
    .locator(".supplier-row")
    .filter({ has: page.getByText(supplier, { exact: true }) })
    .click();
  await expect(page.getByLabel("Сума за накладною, грн")).toBeFocused();
  await page.keyboard.type("700");
  await page
    .getByRole("button", { name: "Записати накладну", exact: true })
    .click();
  await expect(
    result(page).getByRole("heading", { name: "Накладну записано" }),
  ).toBeVisible();
  expect(await newTaps()).toBeLessThanOrEqual(7);
});

test("inside Telegram «Сплатити» is its MainButton on the card, never on the payment; «Назад» closes a sheet, not the card; the payment buzzes, asks before closing, and its stub's «Готово» is the MainButton", async ({
  page,
}) => {
  const supplier = `Телеграм ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "1000.00");
  await invoicesAt(page, hanna, { telegram: true });
  await open(page, supplier);
  // The card's one main action, Telegram's: no dock of the app's.
  await expect
    .poll(() => mainButton(page))
    .toMatchObject({ is_visible: true, is_active: true, text: "Сплатити" });
  await expect(page.locator(".order-dock")).toHaveCount(0);
  // A sheet over it: the MainButton steps aside; «Назад» closes the sheet,
  // the card stays.
  const actions = await ways(page);
  await expect
    .poll(() => mainButton(page))
    .toMatchObject({ is_visible: false });
  await telegramSays(page, "back_button_pressed");
  await expect(actions).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: supplier, level: 1 }),
  ).toBeVisible();
  await expect
    .poll(() => mainButton(page))
    .toMatchObject({ is_visible: true, text: "Сплатити" });

  // Pressed: the payment, the menu aside — and no MainButton there: money
  // is paid by the app's own button.
  await telegramSays(page, "main_button_pressed");
  await expect(payButton(page)).toBeVisible();
  await expect(menu(page)).toBeHidden();
  await expect
    .poll(() => mainButton(page))
    .toMatchObject({ is_visible: false });
  await expect(page.getByLabel("Сума, грн")).toHaveAttribute(
    "inputmode",
    "none",
  );
  for (const [width, height] of [
    [360, 640],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(payButton(page)).toBeInViewport({ ratio: 1 });
    await expect(key(page, "0")).toBeInViewport({ ratio: 1 });
  }
  // More than is owed: never pressed, and said why.
  await keyIn(page, "1500");
  await expect(payButton(page)).toBeDisabled();
  await expect(page.locator(".pay-over")).toHaveText(
    "Це більше, ніж винні: залишок 1 000,00 грн. Сплатіть не більше.",
  );
  await expect(page.getByLabel("Сума, грн")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // A sum typed: Telegram asks before Бірка closes.
  await expect
    .poll(async () =>
      (await told(page, "web_app_setup_closing_behavior")).at(-1),
    )
    .toEqual({ need_confirmation: true });
  await page
    .getByRole("button", { name: "Увесь залишок 1 000,00 грн" })
    .click();
  await expect(page.locator(".pay-over")).toHaveCount(0);
  // Refused: a buzz of the error.
  await refuseOnce(page, "**/api/v1/supplier-invoices/*/payments", 409);
  await payButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect
    .poll(() => told(page, "web_app_trigger_haptic_feedback"))
    .toContainEqual({ type: "notification", notification_type: "error" });
  // Paid: a buzz of success, its stub knotted, «Готово» the MainButton.
  await payButton(page).click();
  await expect(result(page).locator(".stub")).toHaveClass(/\bstub-settled\b/);
  await expect
    .poll(() => told(page, "web_app_trigger_haptic_feedback"))
    .toContainEqual({ type: "notification", notification_type: "success" });
  await expect
    .poll(() => mainButton(page))
    .toMatchObject({ is_visible: true, text: "Готово" });
  await expect(page.locator(".result-dock")).toHaveCount(0);
  await expect
    .poll(async () =>
      (await told(page, "web_app_setup_closing_behavior")).at(-1),
    )
    .toEqual({ need_confirmation: false });
  // Never a MainButton that pays.
  for (const setup of await told(page, "web_app_setup_main_button"))
    if (setup.is_visible) expect(["Сплатити", "Готово"]).toContain(setup.text);
  await telegramSays(page, "main_button_pressed");
  // The card, settled: nothing to pay.
  await expect(page.locator(".invoice-closed")).toContainText(
    "Сплачено повністю",
  );
  await expect
    .poll(() => mainButton(page))
    .toMatchObject({ is_visible: false });
  await expect(menu(page)).toBeVisible();
});

test("a store that does not trade has no «Накладні»: nothing is recorded or paid there", async ({
  page,
}) => {
  // «Центр» blocked, as Бірка is told: what changes money is not shown
  // there (`asShown`), its invoices paid where a store trades.
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { id: string; state: string }[];
    };
    for (const store of body.stores)
      if (store.id === centre) store.state = "BLOCKED";
    await route.fulfill({ response, json: body });
  });
  await at(page, hanna);
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
  const owing = page.getByRole("article", { name: "Ви винні постачальникам" });
  await expect(owing).toBeVisible();
  await expect(owing.getByRole("button")).toHaveCount(0);
  await more(page);
  await expect(
    sections(page).getByRole("button", { name: rowNamed("Накладні") }),
  ).toHaveCount(0);
});

test("nothing owed: the blank mark, what is so now, what an invoice is, and «Записати накладну»", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname === "/api/v1/supplier-invoices",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({ json: { items: [], has_more: false } });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/v1/supplier-invoices/summary",
    async (route) => {
      await route.fulfill({
        json: { owed: "0.00", invoices: 0, suppliers: [] },
      });
    },
  );
  await invoicesAt(page, hanna);
  await expect(page.locator(".invoice-total-line")).toHaveText(
    "Нічого не винні",
  );
  // The shared empty place, as «Сьогодні»'s (audit after stage 2, frame
  // P2-1).
  const empty = page.locator(".orders-empty");
  await expectEmpty(empty, "Зараз магазин нічого не винен постачальникам.");
  await expect(empty.locator(".t-meta")).toHaveText(
    "Кожна накладна — окремий борг: сплачують частинами, без графіка.",
  );
  await mode(page, "Усі").click();
  await expect(empty.locator(".t-row")).toHaveText(
    "У цьому магазині ще не записували накладних.",
  );
  await empty.getByRole("button", { name: "Записати накладну" }).click();
  await expect(
    page.getByRole("heading", { name: "Нова накладна", level: 1 }),
  ).toBeVisible();
  await back(page, "Накладні").click();
  await page
    .getByRole("button", { name: "Накладні магазинів, що не працюють" })
    .click();
  await expect(empty.locator(".t-row")).toHaveText(
    "Магазини, що не працюють, нічого не винні постачальникам.",
  );
  await expect(empty.locator(".t-meta")).toHaveCount(0);
  await expect(
    empty.getByRole("button", { name: "Записати накладну" }),
  ).toHaveCount(0);
});
