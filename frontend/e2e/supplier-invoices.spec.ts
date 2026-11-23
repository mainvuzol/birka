import {
  expectListMore,
  test,
  expect,
  countTaps,
  dockOnMenu,
  expectEmpty,
  expectFieldLine,
  expectGlyphBeside,
  expectHeldRow,
  expectListBlock,
  expectResultHeading,
  expectSheetCancel,
  expectSignLink,
  expectSumRole,
  grn,
  menu,
  more,
  openStore,
  ownStub,
  pickSupplier,
  readsOf,
  refuseOnce,
  rowNamed,
  section,
  sections,
  supplierList,
  holdReads,
  tokenColour,
  under14,
  resultTakesPresses,
} from "./fixtures";
import type { Locator, Page, Request, Route } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { icons } from "../src/shared/icons";
import type { IconName } from "../src/shared/icons";

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
  network_market_seller_telegram_user_id: string;
  network_market_store_id: string;
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

/** Whether the one icon in `where` is the set's `name`, as the page reads
 * both. */
function drawn(where: Locator, name: IconName): Promise<boolean> {
  return where.locator(".icon").evaluate((svg, want) => {
    const probe = document.createElementNS(svg.namespaceURI, "svg");
    probe.innerHTML = want;
    return svg.innerHTML === probe.innerHTML;
  }, icons[name]);
}

/** What a reader hears of a line: its words without what is drawn for the
 * eye alone. */
function heard(line: Locator): Promise<string> {
  return line.evaluate((node) => {
    const copy = node.cloneNode(true) as Element;
    for (const unseen of copy.querySelectorAll('[aria-hidden="true"]'))
      unseen.remove();
    return copy.textContent;
  });
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
  // «+» by the title, and nothing else: the list is read as it opens and
  // as the app comes back (audit 2026-11-13; chosen in chat 2026-11-15).
  await expect(
    page.getByRole("button", { name: "Записати накладну", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Оновити", exact: true }),
  ).toHaveCount(0);
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
  // The newest first (audit 2026-11-22, money P2-3).
  await expect(history(page).locator(".timeline-sum")).toHaveText([
    "3 000,00 грн",
    "999,50 грн",
    "1 000,50 грн",
  ]);
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
  // The one standing, none chosen beforehand: one of a group chosen, a
  // radio (audit 2026-11-15, money P2-6 (а)).
  const returns = setOff
    .getByRole("radiogroup", { name: "Повернення" })
    .getByRole("radio");
  await expect(returns).toHaveCount(1);
  // What was given back under its day, units and warehouse, as its row in
  // «Постачальникам» says it (audit 2026-11-20, money P2-3).
  await expect(returns).toHaveText(
    new RegExp(`^\\d\\d\\.\\d\\d · 2 шт\\. · склад «.+»${model}[^·]*, L × 2$`),
  );
  await expect(returns.locator(".t-meta")).toHaveText(
    new RegExp(`^${model}[^·]*, L × 2$`),
  );
  await expect(returns).not.toBeChecked();
  await returns.click();
  await expect(returns).toBeChecked();
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
  // A field's line, never a refusal's plate (audit 2026-11-18, frame P2-2).
  await expectFieldLine(over);
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
  // (review) — its button too, held (audit 2026-11-18, sale P2-1).
  await field.fill("4001,");
  await expect(over).toBeVisible();
  await expect(
    setOff.getByRole("button", {
      name: "Зарахувати 4 001,00 грн",
      exact: true,
    }),
  ).toBeDisabled();
  // The sum changed: the line gone. Its comma last, it is the sum pressed
  // and sent (audit 2026-11-18, sale P2-1).
  await field.fill("1200,");
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
  await expect(returns).toBeChecked();
  await expect(
    setOff.getByLabel("Скільки зарахував постачальник, грн"),
  ).toHaveValue("1200,");
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
  // way back to the return. The way of its line, told by its sign (audit
  // 2026-11-22, money P2-2).
  await expectSignLink(
    counts.getByRole("button", { name: "Відкрити накладну" }),
    "Відкрити накладну",
  );
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

test("«Зарахувати повернення» reads past the fifty newest: a page all cancelled read on at once, «Показати ще» bringing the older and reading on past a page with none standing, a failed page its retry alone, and the oldest set off (audit 2026-11-18, the set-off's find)", async ({
  page,
}) => {
  const supplier = `Давній ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  const headers = await headersOf(page, hanna);
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      concept: `Давнє ${randomUUID().slice(0, 8)}`,
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
  await anInvoice(page, supplierId, "4000.00");
  // A hundred and fifty returns to that supplier listed over the real one,
  // as the server pages them, fifty a page: the first page all cancelled,
  // the second all but its first, the third all cancelled, the real one the
  // fourth's.
  const listedOver = Array.from({ length: 150 }, (_, n) => ({
    id: randomUUID(),
    store_id: centre,
    location_id: randomUUID(),
    location_name: "Основний",
    supplier: { id: supplierId, name: supplier, phone: null },
    damaged_unit_id: null,
    note: null,
    by: "Ганна",
    at: new Date(Date.now() - (n + 1) * 3_600_000).toISOString(),
    lines: [
      {
        product_variant_id: goods.product_variant_id,
        size_id: goods.size_id,
        quantity: 1,
        display_name: "Давнє",
        size: "L",
      },
    ],
    cancelled:
      n === 50
        ? null
        : {
            reason: "постачальник не взяв",
            by: "Ганна",
            at: new Date().toISOString(),
          },
    set_offs: [],
  }));
  const asked: URLSearchParams[] = [];
  let second = (): void => {};
  const secondHeld = new Promise<void>((resolve) => {
    second = resolve;
  });
  // The page read on by itself, and the one «Показати ще» asks: each fails
  // once.
  const failed = new Set<number>();
  const paged = /\/api\/v1\/supplier-returns\?/;
  const pages = async (route: Route): Promise<void> => {
    const url = new URL(route.request().url());
    const params = url.searchParams;
    if (params.get("supplier_id") !== supplierId) {
      await route.continue();
      return;
    }
    // As asked: the real one is fetched below by these params changed.
    asked.push(new URLSearchParams(params));
    const limit = Number(params.get("limit") ?? "20");
    const offset = Number(params.get("offset") ?? "0");
    if (limit > 50) {
      await route.fulfill({
        status: 422,
        json: { code: "VALIDATION_ERROR", message: "Invalid request" },
      });
      return;
    }
    if (offset === 50) await secondHeld;
    if ((offset === 50 || offset === 100) && !failed.has(offset)) {
      failed.add(offset);
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    url.searchParams.set("offset", "0");
    url.searchParams.set("limit", "50");
    const real = (await (
      await route.fetch({ url: url.toString() })
    ).json()) as {
      items: unknown[];
    };
    const all = [...listedOver, ...real.items];
    await route.fulfill({
      json: {
        items: all.slice(offset, offset + limit),
        has_more: offset + limit < all.length,
      },
    });
  };
  await page.route(paged, pages);
  const counted = posts(page, /\/set-offs$/);

  await invoicesAt(page, hanna);
  await open(page, supplier);
  await act(page, "Зарахувати повернення");
  const setOff = await sheet(page, "Зарахувати повернення");
  const returns = setOff
    .getByRole("radiogroup", { name: "Повернення" })
    .getByRole("radio");
  const nothing = setOff.getByText(/нічого не повертав/);
  const more = setOff.getByRole("button", { name: "Показати ще", exact: true });
  // The fifty newest all cancelled: the next fifty read at once, the
  // returns' places held meanwhile — never «нічого не повертав» over
  // returns not yet read.
  await expect
    .poll(() => asked.map((params) => params.get("offset")))
    .toEqual(["0", "50"]);
  await expect(
    setOff.locator(".placeholder .set-off-returns > .set-off-return"),
  ).toHaveCount(3);
  await expect(nothing).toHaveCount(0);
  await expect(returns).toHaveCount(0);
  second();
  // The page read on fails: its retry alone, never «нічого не повертав».
  const failure = setOff.getByRole("alert");
  await expect(failure.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(nothing).toHaveCount(0);
  await expect(returns).toHaveCount(0);
  await expect(more).toHaveCount(0);
  await failure.getByRole("button", { name: "Спробувати ще раз" }).click();
  // The one standing of those, and «Показати ще» for the older. Its date
  // may carry its year in the first days of January.
  await expect(returns).toHaveCount(1);
  await expect(returns).toHaveText(
    /^\d\d\.\d\d(?:\.\d\d)? · 1 шт\. · склад «Основний»Давнє, L × 1$/,
  );
  await expect(failure).toHaveCount(0);
  await expect(more).toBeVisible();
  // One word and one look under every list, the sheet's width (audit 2026-11-20, frame P2-1).
  await expectListMore(
    more,
    setOff.getByRole("radiogroup", { name: "Повернення" }),
  );
  await expect(nothing).toHaveCount(0);
  // Read again by its own retry alone, never the pages read before it.
  expect(asked.map((params) => params.get("offset"))).toEqual([
    "0",
    "50",
    "50",
  ]);
  // The page after them fails: its retry alone where «Показати ще» stood,
  // the return read kept.
  await more.click();
  await expect(failure).toBeVisible();
  await expect(failure.getByRole("button")).toHaveText(["Спробувати ще раз"]);
  await expect(more).toHaveCount(0);
  await expect(returns).toHaveCount(1);
  await failure.getByRole("button", { name: "Спробувати ще раз" }).click();
  // That page none standing: read on by itself (review). The real one, past
  // the hundred and fifty: its own card, the cursor on it and Tab's stop
  // with it, nothing more to read.
  await expect(returns).toHaveCount(2);
  await expect(returns.nth(1)).toHaveText(
    /^\d\d\.\d\d · 2 шт\. · склад «.+».+ × 2$/,
  );
  await expect(returns.nth(1)).toBeFocused();
  await expect(returns.nth(1)).toHaveAttribute("tabindex", "0");
  await expect(returns.nth(0)).toHaveAttribute("tabindex", "-1");
  await expect(failure).toHaveCount(0);
  await expect(more).toHaveCount(0);
  expect(asked.map((params) => params.get("offset"))).toEqual([
    "0",
    "50",
    "50",
    "100",
    "100",
    "150",
  ]);
  // Every page read: the set-off's answer reads the returns again, twice
  // at once, from the server itself — never answered here as the journey
  // ends (CI: «Route is already handled»).
  await page.unroute(paged, pages);
  await returns.nth(1).click();
  await expect(returns.nth(1)).toBeChecked();
  await setOff.getByLabel("Скільки зарахував постачальник, грн").fill("1200");
  await setOff
    .getByRole("button", { name: "Зарахувати 1 200,00 грн", exact: true })
    .click();
  await expect(setOff).toHaveCount(0);
  await expect(page.locator(".invoice-done")).toHaveText(
    "Залік 1 200,00 грн записано. Залишок 2 800,00 грн.",
  );
  expect(counted.bodies).toEqual([
    {
      command_id: expect.any(String),
      supplier_return_id: returnId,
      amount: "1200.00",
    },
  ]);
  // Fifty a page, the most the server takes, each after those read.
  expect(asked.every((params) => params.get("limit") === "50")).toBe(true);
  expect(asked.map((params) => params.get("offset"))).toEqual(
    expect.arrayContaining(["0", "50", "100", "150"]),
  );
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
    setOff.getByRole("radiogroup", { name: "Повернення" }).getByRole("radio"),
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

test("«Зарахувати повернення»: a sum typed, Telegram asks before Бірка closes, as «Оплатити» and «Видати з каси» do; the sum cleared or the sheet closed, it no longer asks (audit 2026-11-22, orders-cash P2-1's sweep, forwarded)", async ({
  page,
}) => {
  // Inside Telegram 7.0, what it is told recorded.
  const closing = async (): Promise<unknown> =>
    (await told(page, "web_app_setup_closing_behavior")).at(-1) ?? null;
  const supplier = `Питає ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  const headers = await headersOf(page, hanna);
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      concept: `Питане ${randomUUID().slice(0, 8)}`,
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
  await anInvoice(page, supplierId, "4000.00");
  const counted = posts(page, /\/set-offs$/);

  await invoicesAt(page, hanna, { telegram: true });
  await open(page, supplier);
  await act(page, "Зарахувати повернення");
  const setOff = await sheet(page, "Зарахувати повернення");
  await setOff
    .getByRole("radiogroup", { name: "Повернення" })
    .getByRole("radio")
    .click();
  // A return chosen, no sum yet: nothing to lose, nothing asked.
  expect(await closing()).not.toEqual({ need_confirmation: true });
  const field = setOff.getByLabel("Скільки зарахував постачальник, грн");
  await field.fill("1200");
  await expect.poll(closing).toEqual({ need_confirmation: true });
  // Cleared, there is nothing to lose.
  await field.fill("");
  await expect.poll(closing).toEqual({ need_confirmation: false });
  await field.fill("1200,");
  await expect.poll(closing).toEqual({ need_confirmation: true });
  // The sheet closed unsent: the sum gone with it, nothing asked.
  await page.keyboard.press("Escape");
  await expect(setOff).toHaveCount(0);
  await expect.poll(closing).toEqual({ need_confirmation: false });
  expect(counted.bodies).toHaveLength(0);
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

  // Where: the payment that may be cancelled says so by the set's chevron
  // at its end, in pencil, its line at least 44 high (audit 2026-11-15,
  // money P1-2).
  const paid = line(page, "Оплата 500,00 грн");
  const chevron = paid.getByRole("button").locator("svg.timeline-open");
  await expect(chevron).toBeVisible();
  const pencil = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--pencil)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  await expect(chevron).toHaveCSS("color", pencil);
  expect(
    (await paid.getByRole("button").boundingBox())?.height ?? 0,
  ).toBeGreaterThanOrEqual(44);
  const mainRight = async (): Promise<number> => {
    const box = await paid.locator(".timeline-main").boundingBox();
    return box ? box.x + box.width : Number.NaN;
  };
  const before = await mainRight();
  await paid.getByRole("button").click();
  const why = await sheet(page, "Скасувати: оплата 500,00 грн");
  await expect(
    why.getByRole("button", { name: "Так, скасувати" }),
  ).toBeDisabled();
  await why.getByLabel("Чому скасовуємо").fill("гроші не віддали");
  await why.getByRole("button", { name: "Так, скасувати" }).click();
  await expect(line(page, "Оплата 500,00 грн")).toContainText(
    "гроші не віддали",
  );
  // Cancelled, it is pressed no more: no chevron, its place kept, the
  // line's words where they were.
  await expect(paid.getByRole("button")).toHaveCount(0);
  await expect(paid.locator("svg.timeline-open")).toHaveCount(0);
  await expect(paid.locator(".timeline-open")).toHaveCount(1);
  expect(await mainRight()).toBeCloseTo(before, 0);
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
  // Its «not now», «Не скасовувати», a text button (frame P2-4).
  await expectSheetCancel(
    cancelling.getByRole("button", { name: "Не скасовувати" }),
  );
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
  await expectSheetCancel(off.getByRole("button", { name: "Скасувати" }));
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
  // A write-off is never cancelled: no chevron, its place kept (audit
  // 2026-11-15, money P1-2).
  await expect(
    line(page, "Списано 1 500,00 грн").locator("svg.timeline-open"),
  ).toHaveCount(0);
  await expect(
    line(page, "Списано 1 500,00 грн").locator(".timeline-open"),
  ).toHaveCount(1);
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
  // A payment may be cancelled where it may be made now: its chevron says
  // so here too (audit 2026-11-15, money P1-2).
  await expect(
    line(page, "Оплата 100,00 грн")
      .first()
      .getByRole("button")
      .locator("svg.timeline-open"),
  ).toBeVisible();
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
  // Under the supplier's name and its line (audit 2026-11-15, frame P2-9).
  await ownStub(page, supplier, "Оплату ще не підтверджено");
  await expect(kept).toContainText(
    "Невідомо, чи записано оплату. Перевірте результат — та сама операція не запишеться двічі.",
  );
  await expect(kept).toContainText(
    /Чекає відповіді сервера з (?:учора о )?\d{2}:\d{2}\./,
  );
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
  await expect(banner).toContainText(
    /Чекає відповіді сервера з (?:учора о )?\d{2}:\d{2}\./,
  );
  await expect(banner.locator(".check-line")).toHaveCount(0);
  await expect(page.locator(".stub-notice")).toHaveCount(0);
  // «Ще» meanwhile: its row «Постачальникам» held, unfaded, its title in
  // pencil (audit 2026-11-13, frame P2-4).
  await more(page);
  const way = sections(page).getByRole("button", {
    name: "Постачальникам",
    exact: true,
  });
  await expectHeldRow(way, way.locator(".more-label"));
  await menu(page).getByRole("button", { name: "Гроші", exact: true }).click();
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

test("a payment refused as another phone paid meanwhile shows the invoice as it is now, past its supplier's fifty newest invoices (audit 2026-11-20, money Н2)", async ({
  page,
}) => {
  const supplier = `Далі ${randomUUID().slice(0, 6)}`;
  const invoiceId = await anInvoice(
    page,
    await aSupplier(page, supplier),
    "800.00",
  );
  // The read after a refusal: fifty others of the supplier's the newest,
  // this one on the next page.
  const readAgain = (url: URL): boolean =>
    url.pathname === "/api/v1/supplier-invoices" &&
    url.searchParams.has("supplier_id") &&
    url.searchParams.get("limit") === "50";
  const offsets: string[] = [];
  await page.route(readAgain, async (route, request) => {
    const url = new URL(request.url());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    offsets.push(String(offset));
    if (offset === 0) {
      const real = (await (await route.fetch()).json()) as {
        items: { id: string }[];
      };
      await route.fulfill({
        json: {
          items: real.items.map((item) => ({ ...item, id: randomUUID() })),
          has_more: true,
        },
      });
      return;
    }
    url.searchParams.set("offset", String(offset - 50));
    await route.fallback({ url: url.toString() });
  });
  await invoicesAt(page, hanna);
  await open(page, supplier);
  await payOnCard(page).click();
  await keyIn(page, "400");
  // 500,00 paid on another phone meanwhile: 300,00 left.
  const elsewhere = await page.request.post(
    `/api/v1/supplier-invoices/${invoiceId}/payments`,
    {
      headers: await headersOf(page, hanna),
      data: { command_id: randomUUID(), amount: "500.00" },
    },
  );
  expect(elsewhere.status()).toBe(201);
  await payButton(page).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Це більше, ніж винні: залишок 300,00 грн." }),
  ).toBeVisible();
  // Read again to its page: what is left, as it is now.
  await expect(
    page.getByRole("button", { name: "Увесь залишок 300,00 грн" }),
  ).toBeVisible();
  expect(offsets).toEqual(["0", "50"]);
  await back(page, "Накладна").click();
  await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
    "300,00 грн",
  );
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
  // A radio, the one chosen checked (audit 2026-11-13, frame P2-2).
  await expect(everyone).toHaveAttribute("role", "radio");
  await expect(everyone).toHaveAttribute("aria-checked", "true");
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
    // Those of the stores that do not trade: a row in a block of its own,
    // the set's chevron 16 (audit 2026-11-13, money P2-4).
    const elsewhere = page.locator(".invoice-elsewhere-block");
    await expectListBlock(elsewhere, elsewhere.locator(".sale-row"));
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

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const)
  test(`in the ${name} theme at 360 px «Записати накладну» is said in words by the title; a history's sums on the right in money-s, under one another with the chevron or without, each heard in its line's place; «Сплачено повністю» and «Залишок списано» in their tones' colours and marks; what is owed 56 on the card, a closed one's 32 (audit 2026-11-15, money P2-1, P2-2, P2-4)`, async ({
    page,
  }) => {
    const key = randomUUID().slice(0, 6);
    const [open, settled, written] = [
      `Стовпчик ${key}`,
      `Сплачено ${key}`,
      `Списано ${key}`,
    ];
    const headers = await headersOf(page, hanna);
    const invoiceId = await anInvoice(
      page,
      await aSupplier(page, open),
      "1500.00",
      "500.00",
    );
    // A second payment, cancelled: its line keeps no chevron.
    const paid = await page.request.post(
      `/api/v1/supplier-invoices/${invoiceId}/payments`,
      { headers, data: { command_id: randomUUID(), amount: "300.00" } },
    );
    expect(paid.status()).toBe(201);
    const { entries } = (await paid.json()) as {
      entries: { id: string; kind: string; amount: string }[];
    };
    const second = entries.find(
      (entry) => entry.kind === "PAYMENT" && entry.amount === "300.00",
    );
    if (second === undefined) throw new Error("no second payment");
    expect(
      (
        await page.request.post(
          `/api/v1/supplier-invoices/${invoiceId}/entries/${second.id}/cancel`,
          { headers, data: { reason: "двічі" } },
        )
      ).status(),
    ).toBe(200);
    await anInvoice(page, await aSupplier(page, settled), "200.00", "200.00");
    const writtenId = await anInvoice(
      page,
      await aSupplier(page, written),
      "100.00",
    );
    expect(
      (
        await page.request.post(
          `/api/v1/supplier-invoices/${writtenId}/write-off`,
          {
            headers,
            data: { command_id: randomUUID(), reason: "пробачив" },
          },
        )
      ).status(),
    ).toBe(200);
    await page.setViewportSize({ width: 360, height: 740 });
    await invoicesAt(page, hanna, { theme });

    // «Записати накладну» in words, its «+» before them, by the title or
    // under it, nothing cut or wider than the phone (P2-4).
    const make = page.getByRole("button", {
      name: "Записати накладну",
      exact: true,
    });
    await expect(make).toHaveText("Записати накладну");
    await expect(make.locator("svg.icon")).toHaveCount(1);
    expect(await drawn(make, "plus")).toBe(true);
    await expect(make).toBeInViewport({ ratio: 1 });
    expect((await make.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Its words seen, whole, in the link's colour — never an icon's square.
    expect((await make.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    expect(
      await make.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expect(make).toHaveClass(/\bhead-add\b/);
    const title = page.getByRole("heading", { name: "Накладні", level: 1 });
    await expect(title).toBeInViewport({ ratio: 1 });
    expect(
      await title.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    // The title's word never broken to make room for it: one line.
    expect(
      await title.evaluate(
        (node) =>
          node.getBoundingClientRect().height <
          parseFloat(getComputedStyle(node).lineHeight) * 1.5,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    expect(await contrast(make)).toBeGreaterThanOrEqual(4.5);

    // Closed: «Сплачено повністю» in the paid's colours with the paid's own
    // mark, «Залишок списано» grey with its minus, as a customer's (P2-1
    // (б)); each at 4.5:1.
    await mode(page, "Усі").click();
    const paidOff = tag(page, settled).locator(".sticker");
    await expect(paidOff).toHaveText("Сплачено повністю");
    await expect(paidOff).toHaveClass(/\btone-paid\b/);
    expect(await drawn(paidOff, "collected")).toBe(true);
    const writtenOff = tag(page, written).locator(".sticker");
    await expect(writtenOff).toHaveText("Залишок списано");
    await expect(writtenOff).toHaveClass(/\btone-offline\b/);
    expect(await drawn(writtenOff, "minus")).toBe(true);
    for (const sticker of [paidOff, writtenOff]) {
      await expectGlyphBeside(sticker);
      expect(await contrast(sticker)).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({
      path: `test-results/invoice-stickers-${name}.png`,
    });

    // The open one's card: what is owed in money-xl (P2-2).
    await tag(page, open).locator(".order-row").click();
    await expect(
      page.getByRole("heading", { name: open, level: 1 }),
    ).toBeVisible();
    await expect(owes(page).locator(".invoice-owed-sum")).toHaveText(
      "1 000,00 грн",
    );
    await expect(owes(page).locator(".invoice-owed-sum")).toHaveCSS(
      "font-size",
      "56px",
    );

    // Its history: the word on the line, its sum on the right in money-s,
    // never in the line's title; the sums' right edges one vertical, the
    // chevron's place after them kept or used (P2-1 (а)).
    const standing = line(page, "Оплата 500,00 грн");
    const cancelled = line(page, "Оплата 300,00 грн");
    await expect(standing.locator("svg.timeline-open")).toHaveCount(1);
    await expect(cancelled.locator("svg.timeline-open")).toHaveCount(0);
    await expect(cancelled.locator(".sticker")).toHaveText("Скасовано");
    const sums = history(page).locator(".timeline-sum");
    await expect(sums).toHaveCount(2);
    for (const [one, sum] of [
      [standing, "500,00 грн"],
      [cancelled, "300,00 грн"],
    ] as const) {
      const shown = one.locator(".timeline-sum");
      await expect(shown).toHaveText(sum);
      await expect(shown).toHaveAttribute("aria-hidden", "true");
      await expect(shown).toHaveCSS("font-size", "16px");
      await expect(shown).toHaveCSS("line-height", "20px");
      await expect(shown).toHaveCSS("font-weight", "600");
      await expect(shown).toHaveCSS("font-variant-numeric", "tabular-nums");
      expect(await contrast(shown)).toBeGreaterThanOrEqual(4.5);
      // Beside the line's words, never inside its title.
      const words = await one.locator(".timeline-main").boundingBox();
      const figure = await shown.boundingBox();
      expect(figure?.x ?? 0).toBeGreaterThanOrEqual(
        (words?.x ?? 0) + (words?.width ?? 0),
      );
    }
    const edges = await sums.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().right),
    );
    expect(Math.abs((edges[0] ?? 0) - (edges[1] ?? 9))).toBeLessThanOrEqual(
      0.5,
    );
    // The chevron after the sum, in the place a cancelled line keeps.
    const [sumBox, chevron] = [
      await standing.locator(".timeline-sum").boundingBox(),
      await standing.locator("svg.timeline-open").boundingBox(),
    ];
    expect(chevron?.x ?? 0).toBeGreaterThanOrEqual(
      (sumBox?.x ?? 999) + (sumBox?.width ?? 0) - 0.5,
    );
    // A reader hears each line as before: its sum once, after its word.
    await expect(standing.getByRole("button")).toHaveAccessibleName(
      /^Скасувати: ?\d\d\.\d\d ?Оплата 500,00\sгрн ?Тест$/,
    );
    expect(await heard(cancelled)).toMatch(
      /^\d\d\.\d\dОплата 300,00\sгрнТест.*Скасовано/,
    );
    expect((await heard(cancelled)).split("300,00").length).toBe(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({ path: `test-results/invoice-history-${name}.png` });

    // A closed one's sum stays money-l.
    await back(page, "Накладні").click();
    await tag(page, settled).locator(".order-row").click();
    await expect(page.locator(".invoice-closed .invoice-owed-sum")).toHaveCSS(
      "font-size",
      "32px",
    );
  });

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const)
  test(`in the ${name} theme «Нова накладна» says more paid at once than its sum as it is typed, under the field, and «Записати накладну» holds — «1500,» read as 1500, on sending too; a history with nothing in it and a set-off with no return say so in pencil at 14; two returns to set off are radios the arrows go through (audit 2026-11-15, money P2-3 (б), P2-6 (а)(в))`, async ({
    page,
  }) => {
    const key = randomUUID().slice(0, 6);
    const [lone, two] = [`Порожня ${key}`, `Два повернення ${key}`];
    const headers = await headersOf(page, hanna);
    await anInvoice(page, await aSupplier(page, lone), "1000.00");
    // Two returns standing to one supplier, a unit each.
    const twoId = await aSupplier(page, two);
    const created = await page.request.post("/api/v1/catalog/products", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        store_id: centre,
        concept: `Радіо ${randomUUID().slice(0, 8)}`,
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
    for (let at = 0; at < 2; at += 1) {
      const returned = await page.request.post("/api/v1/supplier-returns", {
        headers,
        data: {
          command_id: randomUUID(),
          store_id: centre,
          location_id: fixture.network_shared_location_id,
          supplier_id: twoId,
          lines: [{ ...goods, quantity: 1 }],
          note: null,
        },
      });
      expect(returned.status()).toBe(201);
    }
    await anInvoice(page, twoId, "3000.00");
    const recorded = posts(page, /\/api\/v1\/supplier-invoices$/);
    await page.setViewportSize({ width: 360, height: 640 });
    await invoicesAt(page, hanna, { theme });
    const pencil = await resolved(page, "var(--pencil)");

    // Nothing paid or set off yet: a `meta` line in pencil (P2-6 (в)).
    await open(page, lone);
    const none = page.getByText("Оплат і заліків ще не було.", {
      exact: true,
    });
    await expect(none).toHaveCSS("font-size", "14px");
    await expect(none).toHaveCSS("color", pencil);
    expect(await contrast(none)).toBeGreaterThanOrEqual(4.5);
    // No return to set off: the same.
    await act(page, "Зарахувати повернення");
    const empty = await sheet(page, "Зарахувати повернення");
    const nothing = empty.getByText(
      `Цей магазин нічого не повертав постачальнику «${lone}».`,
      { exact: true },
    );
    await expect(nothing).toHaveCSS("font-size", "14px");
    await expect(nothing).toHaveCSS("color", pencil);
    expect(await contrast(nothing)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Escape");
    await expect(empty).toHaveCount(0);

    // Two returns: one chosen of a group, radios; Tab's one stop the first,
    // none chosen; the arrows choose as they go, round the ends (P2-6 (а)).
    await back(page, "Накладні").click();
    await open(page, two);
    await act(page, "Зарахувати повернення");
    const setOff = await sheet(page, "Зарахувати повернення");
    const radios = setOff
      .getByRole("radiogroup", { name: "Повернення" })
      .getByRole("radio");
    await expect(radios).toHaveCount(2);
    const [first, second] = [radios.nth(0), radios.nth(1)];
    await expect(first).not.toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(first).toHaveAttribute("tabindex", "0");
    await expect(second).toHaveAttribute("tabindex", "-1");
    await first.focus();
    for (const [arrow, now, was] of [
      ["ArrowDown", second, first],
      ["ArrowDown", first, second],
      ["ArrowUp", second, first],
      ["ArrowLeft", first, second],
      ["ArrowRight", second, first],
    ] as const) {
      await page.keyboard.press(arrow);
      await expect(now).toBeFocused();
      await expect(now).toBeChecked();
      await expect(was).not.toBeChecked();
      await expect(now).toHaveAttribute("tabindex", "0");
      await expect(was).toHaveAttribute("tabindex", "-1");
    }
    // The chosen in the chosen colours, as before.
    await expect(second).toHaveCSS(
      "background-color",
      await resolved(page, "var(--chosen)"),
    );
    await expect(first).toHaveCSS(
      "background-color",
      await resolved(page, "var(--card)"),
    );
    // Taken by a tap too.
    await first.click();
    await expect(first).toBeChecked();
    await expect(second).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(setOff).toHaveCount(0);

    // More paid at once than the sum: said under the field as it is typed,
    // the field wrong and described by it, «Записати накладну» held, nothing
    // sent (P2-3 (б)).
    await back(page, "Накладні").click();
    await page
      .getByRole("button", { name: "Записати накладну", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Нова накладна", level: 1 }),
    ).toBeVisible();
    await pickSupplier(page, lone);
    const sum = page.getByLabel("Сума за накладною, грн");
    const paidNow = page.getByLabel("Сплачено одразу, грн");
    const over = page.locator(".field-wrong");
    const words = "Сплачено одразу не може бути більше, ніж сума накладної.";
    const make = page
      .locator(".order-dock")
      .getByRole("button", { name: "Записати накладну", exact: true });
    await sum.fill("1000");
    await paidNow.fill("1200");
    await expect(over).toHaveText(words);
    await expect(over).toHaveAttribute("role", "alert");
    await expect(over).toHaveCSS("font-size", "14px");
    // A line, never a refusal's plate (audit 2026-11-18, frame P2-2).
    await expectFieldLine(over);
    await expect(over).toHaveCSS(
      "color",
      await resolved(page, "var(--danger)"),
    );
    expect(await contrast(over)).toBeGreaterThanOrEqual(4.5);
    await expect(paidNow).toHaveAttribute("aria-invalid", "true");
    await expect(paidNow).toHaveAccessibleDescription(words);
    await expect(paidNow).toHaveCSS(
      "border-top-color",
      await resolved(page, "var(--danger)"),
    );
    // Under its field, over the note.
    const [field, line, note] = [
      await paidNow.boundingBox(),
      await over.boundingBox(),
      await page.getByLabel("Примітка (необов’язково)").boundingBox(),
    ];
    if (!field || !line || !note) throw new Error("not laid out");
    expect(line.y).toBeGreaterThanOrEqual(field.y + field.height - 1);
    expect(line.y + line.height).toBeLessThanOrEqual(note.y);
    await expect(make).toBeDisabled();
    await make.click({ force: true });
    // As much as the sum is not more: no line, the button free.
    await paidNow.fill("1000");
    await expect(over).toHaveCount(0);
    await expect(paidNow).not.toHaveAttribute("aria-invalid", "true");
    await expect(paidNow).not.toHaveAttribute("aria-describedby", /.+/);
    await expect(make).toBeEnabled();
    // A sum still being typed, its comma last, is read as it stands.
    await paidNow.fill("1000,");
    await expect(over).toHaveCount(0);
    await paidNow.fill("1000,01");
    await expect(over).toBeVisible();
    await sum.fill("1500,");
    await expect(over).toHaveCount(0);
    await paidNow.fill("1500,01");
    await expect(over).toBeVisible();
    await expect(make).toBeDisabled();
    await paidNow.fill("1000,");
    await expect(over).toHaveCount(0);
    expect(recorded.bodies).toHaveLength(0);
    await make.click();
    await expect(
      result(page).getByRole("heading", { name: "Накладну записано" }),
    ).toBeVisible();
    expect(recorded.bodies).toHaveLength(1);
    expect(recorded.bodies[0]).toMatchObject({
      amount: "1500.00",
      paid_now: "1000.00",
    });
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
  // What is owed in money-xl over 700 px; on a short phone as S21 — the
  // keys 44, the sum 64, «Винні» and what is owed one line in money-l,
  // over the dock unscrolled (audit 2026-11-15, money P2-2).
  for (const [width, height, size] of [
    [360, 640, "32px"],
    [390, 844, "56px"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(payButton(page)).toBeInViewport({ ratio: 1 });
    await expect(key(page, "0")).toBeInViewport({ ratio: 1 });
    const sum = owes(page).locator(".invoice-owed-sum");
    await expect(sum).toHaveCSS("font-size", size);
    const dockTop =
      (await page.locator(".pay-panel").boundingBox())?.y ?? Number.NaN;
    for (const part of [owes(page).locator(".owed-what"), sum]) {
      await expect(part).toBeInViewport({ ratio: 1 });
      const box = await part.boundingBox();
      expect((box?.y ?? 0) + (box?.height ?? 999)).toBeLessThanOrEqual(dockTop);
    }
    if (height === 640) {
      await expect(key(page, "0")).toHaveCSS("height", "44px");
      await expect(page.locator(".pay-panel .keypad-sum")).toHaveCSS(
        "height",
        "64px",
      );
      // «Винні» on the figure's line, «Сплачено X з Y» under it.
      const what = await owes(page).locator(".owed-what").boundingBox();
      const figure = await sum.boundingBox();
      const count = await owes(page).locator(".owed-count").boundingBox();
      expect((what?.x ?? 0) + (what?.width ?? 0)).toBeLessThanOrEqual(
        figure?.x ?? 0,
      );
      expect(count?.y ?? 0).toBeGreaterThanOrEqual(
        (figure?.y ?? 0) + (figure?.height ?? 999) - 1,
      );
    }
  }
  // More than is owed: never pressed, and said why. Typed key by key, the
  // button says the sum so far at each, and «1500,» is still 1 500,00 —
  // the button and the line never blink under the finger (P2-2 (в)).
  for (const [one, said] of [
    ["1", "1,00"],
    ["5", "15,00"],
    ["0", "150,00"],
    ["0", "1 500,00"],
    [",", "1 500,00"],
  ] as const) {
    await keyIn(page, one);
    await expect(payButton(page)).toHaveText(`Сплатити ${said} грн`);
  }
  // The comma taken: the sum is still being typed.
  await expect(page.getByLabel("Сума, грн")).toHaveValue(/^1\s?500,$/);
  await expect(payButton(page)).toBeDisabled();
  await expect(page.locator(".pay-over")).toHaveText(
    "Це більше, ніж винні: залишок 1 000,00 грн. Сплатіть не більше.",
  );
  await expectFieldLine(page.locator(".pay-over"));
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
  // Past the 0.7 s the result lets the payment's press go (audit
  // 2026-11-20, frame P1-1).
  await resultTakesPresses(page);
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
  // The total's first read fails: «не вдалося прочитати» in its place and one
  // plate whose «Спробувати ще раз» asks it again (no «Оновити» by the title,
  // audit 2026-11-13; review).
  let totalFails = true;
  await page.route(
    (url) => url.pathname === "/api/v1/supplier-invoices/summary",
    async (route) => {
      if (totalFails) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL_ERROR", message: "boom" },
        });
        return;
      }
      await route.fulfill({
        json: { owed: "0.00", invoices: 0, suppliers: [] },
      });
    },
  );
  await invoicesAt(page, hanna);
  const total = page.locator(".invoice-total");
  await expect(total).toContainText("не вдалося прочитати");
  const plate = page.locator(".read-failure");
  await expect(plate).toHaveCount(1);
  totalFails = false;
  await plate.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(plate).toHaveCount(0);
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

test("«Зарахувати повернення» says what each return gave back, as «Постачальникам» does: two lines and «+ ще 1» past them, wrapped within the sheet at 360 × 640, the chosen's lines in its colours; its places as tall as a return of one line (audit 2026-11-20, money P2-3)", async ({
  page,
}) => {
  const supplier = `Що повернули ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  const headers = await headersOf(page, hanna);
  const model = `Три ${randomUUID().slice(0, 6)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      concept: model,
      variant: { color: "сірий" },
      sizes: ["S", "M", "L"].map((code) => ({ system: "ALPHA", code })),
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const lines = product.sizes.map((size) => ({
    product_variant_id: product.product_variant_id,
    size_id: size.size_id,
  }));
  expect(lines).toHaveLength(3);
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: centre,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: lines.map((line) => ({
        ...line,
        quantity: 2,
        acquisition_type: "PURCHASE",
      })),
      notes: null,
    },
  });
  expect(receipt.status()).toBe(201);
  // Three lines given back, then one: the newest first.
  for (const given of [lines, lines.slice(0, 1)]) {
    const returned = await page.request.post("/api/v1/supplier-returns", {
      headers,
      data: {
        command_id: randomUUID(),
        store_id: centre,
        location_id: fixture.network_shared_location_id,
        supplier_id: supplierId,
        lines: given.map((line) => ({ ...line, quantity: 1 })),
        note: null,
      },
    });
    expect(returned.status()).toBe(201);
  }
  await anInvoice(page, supplierId, "1000.00");

  await invoicesAt(page, hanna);
  await open(page, supplier);
  const held = await holdReads(page, "supplier-returns");
  await act(page, "Зарахувати повернення");
  const setOff = await sheet(page, "Зарахувати повернення");
  const cards = setOff.locator(
    ".placeholder .set-off-returns > .set-off-return",
  );
  await expect(cards).toHaveCount(3);
  const place = (await cards.first().boundingBox())?.height ?? 0;
  held();
  const returns = setOff
    .getByRole("radiogroup", { name: "Повернення" })
    .getByRole("radio");
  await expect(returns).toHaveCount(2);
  // Under its day, units and warehouse, what was given back, in the words
  // of its row in «Постачальникам»: two lines, and «+ ще 1» past them.
  await expect(returns.locator(".t-meta")).toHaveText([
    new RegExp(`^${model}[^·]*× 1$`),
    new RegExp(`^${model}[^·]*× 1 · ${model}[^·]*× 1 · \\+ ще 1$`),
  ]);
  // Heard with it: its name is all it says, as before.
  await expect(returns.nth(1)).toHaveAccessibleName(/ · \+ ще 1$/);
  // A return of one line as tall as its places: nothing moves as the
  // answer comes.
  const one = (await returns.first().boundingBox())?.height ?? 0;
  expect(Math.abs(one - place)).toBeLessThanOrEqual(1);
  // At 360 × 640 its lines wrap within it, nothing wider than the screen.
  await page.setViewportSize({ width: 360, height: 640 });
  const within = await setOff.boundingBox();
  if (!within) throw new Error("not laid out");
  for (const option of await returns.all()) {
    const box = await option.boundingBox();
    if (!box) throw new Error("not laid out");
    expect(box.x + box.width).toBeLessThanOrEqual(within.x + within.width);
  }
  // The sheet's own scroller, not the page's: a sheet stands fixed over it.
  expect(
    await setOff
      .locator(".sheet-body")
      .evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(0);
  // Chosen, each of its lines in the chosen's colours, in both themes.
  await returns.nth(1).click();
  await expect(returns.nth(1)).toBeChecked();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const onChosen = await tokenColour(page, "--on-chosen");
    for (const said of await returns.nth(1).locator("span").all())
      await expect(said).toHaveCSS("color", onChosen);
  }
  await page.emulateMedia({ colorScheme: "light" });
});

test("«Зарахувати повернення» says a unit given back from «Брак» came from it, as «Постачальникам» does: «з «Браку» «…»», never «склад «…»»; a warehouse's return «склад «…»», as before; wrapped within the sheet at 360 × 640, the chosen's lines in its colours (audit 2026-11-22, money P2-1)", async ({
  page,
}) => {
  const supplier = `З браку ${randomUUID().slice(0, 6)}`;
  const supplierId = await aSupplier(page, supplier);
  // «Ринок», whose «Брак ринку» takes damaged goods; Центр has none.
  const petro = fixture.network_market_seller_telegram_user_id;
  const market = fixture.network_market_store_id;
  const headers = await headersOf(page, petro);
  const model = `Брак ${randomUUID().slice(0, 6)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: market,
      concept: model,
      variant: { color: "сірий" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const coat = {
    product_variant_id: product.product_variant_id,
    size_id: product.sizes[0]?.size_id ?? "",
  };
  const receipt = await page.request.post("/api/v1/inventory/receipts", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: market,
      location_id: fixture.network_shared_location_id,
      command_id: randomUUID(),
      lines: [{ ...coat, quantity: 2, acquisition_type: "PURCHASE" }],
      notes: null,
    },
  });
  expect(receipt.status()).toBe(201);
  // One sold and brought back damaged: a unit in «Брак», taken, confirmed
  // and given back to the supplier from there.
  const sold = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: market,
      command_id: randomUUID(),
      lines: [
        {
          ...coat,
          source_location_id: fixture.network_shared_location_id,
          quantity: 1,
          unit_price: "2000.00",
        },
      ],
      payment_method: "CASH",
    },
  });
  expect(sold.status()).toBe(201);
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
  expect(back.status(), await back.text()).toBe(201);
  const units = await page.request.get(
    `/api/v1/damaged-units?store_id=${market}`,
    { headers },
  );
  expect(units.status()).toBe(200);
  const unit = (
    (await units.json()) as { units: { id: string; display_name: string }[] }
  ).units.find((one) => one.display_name.startsWith(model));
  if (!unit) throw new Error("the damaged unit not found");
  for (const [step, data] of [
    ["take", undefined],
    ["confirm", { note: null }],
    ["return-to-supplier", { supplier_id: supplierId, note: null }],
  ] as const) {
    const done = await page.request.post(
      `/api/v1/damaged-units/${unit.id}/${step}`,
      { headers: { ...headers, "Idempotency-Key": randomUUID() }, data },
    );
    expect(done.status(), step).toBe(200);
  }
  // And one from the warehouse, the newest.
  const returned = await page.request.post("/api/v1/supplier-returns", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: market,
      location_id: fixture.network_shared_location_id,
      supplier_id: supplierId,
      lines: [{ ...coat, quantity: 1 }],
      note: null,
    },
  });
  expect(returned.status()).toBe(201);
  const invoice = await page.request.post("/api/v1/supplier-invoices", {
    headers,
    data: {
      command_id: randomUUID(),
      store_id: market,
      supplier_id: supplierId,
      amount: "1000.00",
      paid_now: "0",
      note: null,
    },
  });
  expect(invoice.status()).toBe(201);

  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(petro) }).toString()}`,
  );
  await openStore(page, /^Ринок MARKET/);
  await section(page, "Накладні");
  await open(page, supplier);
  await act(page, "Зарахувати повернення");
  const setOff = await sheet(page, "Зарахувати повернення");
  const returns = setOff
    .getByRole("radiogroup", { name: "Повернення" })
    .getByRole("radio");
  await expect(returns).toHaveCount(2);
  // Its day, units and where it came back from, as its row in
  // «Постачальникам» says it.
  await expect(returns.locator(".t-row")).toHaveText([
    /^\d\d\.\d\d · 1 шт\. · склад «[^«»]+»$/,
    /^\d\d\.\d\d · 1 шт\. · з «Браку» «[^«»]+»$/,
  ]);
  await expect(returns.nth(1)).toHaveAccessibleName(
    new RegExp(`^\\d\\d\\.\\d\\d · 1 шт\\. · з «Браку» «[^«»]+»\\s*${model}`),
  );
  await expect(setOff).not.toContainText(/склад «[^«»]*Брак/);
  // At 360 × 640 within the sheet, nothing wider than the screen.
  await page.setViewportSize({ width: 360, height: 640 });
  const within = await setOff.boundingBox();
  if (!within) throw new Error("not laid out");
  for (const option of await returns.all()) {
    const box = await option.boundingBox();
    if (!box) throw new Error("not laid out");
    expect(box.x + box.width).toBeLessThanOrEqual(within.x + within.width);
  }
  expect(
    await setOff
      .locator(".sheet-body")
      .evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(0);
  // Chosen, each of its lines in the chosen's colours, in both themes.
  await returns.nth(1).click();
  await expect(returns.nth(1)).toBeChecked();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const onChosen = await tokenColour(page, "--on-chosen");
    for (const said of await returns.nth(1).locator("span").all())
      await expect(said).toHaveCSS("color", onChosen);
  }
  await page.emulateMedia({ colorScheme: "light" });
});

test("an invoice's history is the newest first, as a customer's and «Продажі й повернення»: the last payment at its top, the first at its bottom; one cancelled where it was recorded, never where it was cancelled (audit 2026-11-22, money P2-3)", async ({
  page,
}) => {
  const supplier = `Нове згори ${randomUUID().slice(0, 6)}`;
  const invoiceId = await anInvoice(
    page,
    await aSupplier(page, supplier),
    "2000.00",
    "500.00",
  );
  const headers = await headersOf(page, hanna);
  const entries: { id: string; amount: string }[] = [];
  for (const amount of ["300.00", "200.00"]) {
    const paid = await page.request.post(
      `/api/v1/supplier-invoices/${invoiceId}/payments`,
      { headers, data: { command_id: randomUUID(), amount } },
    );
    expect(paid.status()).toBe(201);
    entries.splice(
      0,
      entries.length,
      ...((await paid.json()) as { entries: { id: string; amount: string }[] })
        .entries,
    );
  }
  const middle = entries.find((entry) => entry.amount === "300.00");
  if (!middle) throw new Error("the payment of 300 not found");
  const cancelled = await page.request.post(
    `/api/v1/supplier-invoices/${invoiceId}/entries/${middle.id}/cancel`,
    { headers, data: { reason: "не ті гроші" } },
  );
  expect(cancelled.status()).toBe(200);

  await invoicesAt(page, hanna);
  await open(page, supplier);
  await expect(history(page).locator(".timeline-sum")).toHaveText([
    "200,00 грн",
    "300,00 грн",
    "500,00 грн",
  ]);
  // The cancelled one in its own place, saying so.
  await expect(
    history(page).getByRole("listitem").nth(1).locator(".sticker"),
  ).toHaveText("Скасовано");
  await expect(history(page).getByRole("listitem").nth(1)).toContainText(
    "не ті гроші",
  );
  // The newest, cancelled in two taps from its own line at the top.
  await history(page).getByRole("listitem").first().getByRole("button").click();
  await sheet(page, "Скасувати: оплата 200,00 грн");
});

test("«Зарахувати повернення» only for whoever may read the returns: without `supplier:return` no way behind ⋯ and no read of them — «Скасувати накладну» still there; with it, as before (audit 2026-11-22, money P2-4)", async ({
  page,
}) => {
  const supplier = `Без повернень ${randomUUID().slice(0, 6)}`;
  await anInvoice(page, await aSupplier(page, supplier), "1000.00");
  for (const reads of [false, true]) {
    await page.unrouteAll({ behavior: "wait" });
    if (!reads)
      await page.route("**/api/v1/me", async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as {
          stores: { permissions: string[] }[];
        };
        for (const store of body.stores)
          store.permissions = store.permissions.filter(
            (p) => p !== "supplier:return",
          );
        await route.fulfill({ response, json: body });
      });
    const returnsRead = readsOf(page, /^\/api\/v1\/supplier-returns$/);
    await invoicesAt(page, hanna);
    await open(page, supplier);
    const actions = await ways(page);
    await expect(
      actions.getByRole("button", { name: "Зарахувати повернення" }),
    ).toHaveCount(reads ? 1 : 0);
    await expect(
      actions.getByRole("button", { name: "Скасувати накладну" }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(actions).toHaveCount(0);
    if (!reads) {
      expect(returnsRead()).toBe(0);
      await expect(page.getByText("Немає доступу")).toHaveCount(0);
    }
  }
});

test("an invoice for borrowed goods sold, of a store that does not trade, says only what it is for — never its cancelling or a batch this store does not keep; this store's own says both (audit 2026-11-20, money P2-4)", async ({
  page,
}) => {
  const lot = {
    stock_lot_id: randomUUID(),
    quantity: 2,
    label: "Пальто Старе графіт, M",
  };
  const own = `Позичене ${randomUUID().slice(0, 6)}`;
  const ownInvoice = await anInvoice(
    page,
    await aSupplier(page, own),
    "500.00",
  );
  // The archived store's invoices, and one of this store's, each for
  // borrowed goods sold: so in the server's answer.
  await page.route(/\/api\/v1\/supplier-invoices\?/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { id: string; store_id: string }[];
    };
    await route.fulfill({
      response,
      json: {
        ...body,
        items: body.items.map((item) =>
          item.store_id !== centre || item.id === ownInvoice
            ? { ...item, sold: lot }
            : item,
        ),
      },
    });
  });
  await invoicesAt(page, hanna);
  const sold = page.locator(".invoice-sold");
  // This store's own: what it is for, how to undo it, and its batch.
  await open(page, own);
  await expect(sold.locator("p")).toHaveText(
    "За продане позичене: Пальто Старе графіт, M × 2. Якщо позначили помилково — скасуйте накладну, і товар знову буде «на руках».",
  );
  await expect(
    sold.getByRole("button", { name: "Позичене й під реалізацію" }),
  ).toBeVisible();
  await back(page, "Накладні").click();
  // The archived store's, paid here: what it is for alone — its cancelling
  // is that store's, and its batch is not among this store's.
  await page
    .getByRole("button", { name: "Накладні магазинів, що не працюють" })
    .click();
  await tag(page, "Постачальник Старого").locator(".order-row").click();
  await expect(
    page.getByText(/^Накладна магазину «Старий», який зараз закрито/),
  ).toBeVisible();
  await expect(sold.locator("p")).toHaveText(
    "За продане позичене: Пальто Старе графіт, M × 2.",
  );
  await expect(page.getByText(/скасуйте накладну/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Позичене й під реалізацію" }),
  ).toHaveCount(0);
  await expect(payOnCard(page)).toBeVisible();
});
