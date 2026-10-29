import {
  test,
  expect,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Каса»'s cash taken out and put in (cash task list, P1-2), and a way of
 * payment changed (P1-3): what for as chips, the sum large, the button
 * under the thumb; the seller's operations as rows, never a sum nor a way
 * (G32), one operation's sum large, its way a pill, the ways as the till's
 * buttons. The drawer is stubbed, so each answer is the one each journey
 * asks for.
 */

interface Fixture {
  network_cash_seller_telegram_user_id: string;
  network_cash_store_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;
const store = fixture.network_cash_store_id;
const olya = fixture.network_cash_seller_telegram_user_id;

function launch(
  options: { theme?: Record<string, string>; version?: string } = {},
): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${olya},"first_name":"Оля"}`,
  });
  const check = [...fields]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  const hash = new URLSearchParams({ tgWebAppData: fields.toString() });
  if (options.theme)
    hash.set("tgWebAppThemeParams", JSON.stringify(options.theme));
  if (options.version) hash.set("tgWebAppVersion", options.version);
  return `/#${hash.toString()}`;
}

const lastClose = {
  id: "7b1c2d3e-0000-4000-8000-00000000c101",
  number: 3,
  business_day: "2026-10-20",
  closed_at: "2026-10-20T17:14:00Z",
  closed_by: "Олена",
  mine: false,
};

type Drawer = Record<string, unknown>;

function drawer(over: Drawer = {}): Drawer {
  return {
    store_id: store,
    store_name: "Каса",
    store_state: "ACTIVE",
    last_close: lastClose,
    next_is_opening: false,
    closed_today: false,
    may_close: true,
    movement_kinds: ["EXPENSES", "SUPPLIER_COURIER", "CHANGE"],
    may_correct: false,
    movements: [],
    unclosed_days: [],
    reason_owed: null,
    ...over,
  };
}

/** Cash moved, as the server answers it. */
function movementOf(body: Record<string, unknown>): Record<string, unknown> {
  return {
    id: randomUUID(),
    store_id: store,
    kind: body.kind,
    direction: body.kind === "CHANGE" ? "IN" : "OUT",
    amount: body.amount,
    note: body.note ?? null,
    at: new Date().toISOString(),
    by: "Оля",
    for_close_id: null,
    for_day: null,
    moved_to_close: false,
  };
}

/** A moment by this machine's clock, which the phone shares: `time` of
 * today, or of `days` back. */
function at(time: string, days = 0): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const moment = new Date();
  moment.setDate(moment.getDate() - days);
  moment.setHours(hours, minutes, 0, 0);
  return moment.toISOString();
}

/** The seller's own operations of the open period: time, kind, goods —
 * the last of a day nobody closed. */
const mine = [
  {
    target: "SALE",
    target_id: randomUUID(),
    at: at("20:05"),
    label: "Лоран шоколад · M",
  },
  {
    target: "PAYMENT",
    target_id: randomUUID(),
    at: at("18:40"),
    label: "Пальто Ірис · L",
  },
  {
    target: "REFUND",
    target_id: randomUUID(),
    at: at("12:15", 1),
    label: "Шарф · єдиний",
  },
];

/** A day's money events, as the owner and managers read them. */
const day = [
  {
    target: "SALE",
    target_id: mine[0]?.target_id,
    at: at("20:05"),
    by: "Оля",
    amount: "700.00",
    direction: "IN",
    stated_method: "CARD",
    method: "CARD",
    corrected: false,
    closed: false,
    label: "Лоран шоколад · M",
    is_order: false,
    may_change: true,
  },
];

interface Server {
  /** What each POST sent, by path. */
  sent: Record<string, Record<string, unknown>[]>;
  /** How many times the chosen operation's way was read. */
  methodReads: () => number;
}

/**
 * «Каса», stubbed: the drawer, its closes, the seller's operations and
 * one operation's way, cash moved and ways changed — answered with
 * `answers`' next status or, when none is left, as recorded.
 */
async function stub(
  page: Page,
  state: {
    now: Drawer;
    method: Record<string, unknown>;
    answers?: (number | "lost")[];
  },
): Promise<Server> {
  const sent: Record<string, Record<string, unknown>[]> = {
    movements: [],
    corrections: [],
  };
  let methodReads = 0;
  await page.route("**/api/v1/cash/drawer?**", async (route) => {
    await route.fulfill({ json: state.now });
  });
  await page.route("**/api/v1/cash/closes?**", async (route) => {
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  await page.route("**/api/v1/cash/events?**", async (route, request) => {
    // The seller's own operations, or a day's for whoever corrects.
    await route.fulfill({
      json: {
        items: new URL(request.url()).searchParams.has("mine") ? mine : day,
      },
    });
  });
  await page.route("**/api/v1/cash/*/*/method?**", async (route) => {
    methodReads += 1;
    await route.fulfill({ json: state.method });
  });
  for (const path of ["movements", "corrections"] as const)
    await page.route(`**/api/v1/cash/${path}`, async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      sent[path]?.push(body);
      const next = state.answers?.shift();
      if (next === "lost") {
        await route.abort("connectionreset");
        return;
      }
      if (next === 500) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL_ERROR", message: "Internal error" },
        });
        return;
      }
      if (next !== undefined) {
        await route.fulfill({
          status: next,
          json:
            next === 409
              ? {
                  code: "PAYMENT_METHOD_CHANGED",
                  message: "Payment method changed",
                  details: { current: "CASH" },
                }
              : {
                  code: "VALIDATION_ERROR",
                  message: "Request failed validation",
                  details: {
                    reason: "CLOSE_IN_BETWEEN",
                    recorded: false,
                    closed_at: new Date().toISOString(),
                    closed_by: "Олена",
                  },
                },
        });
        if (next === 409) state.method = { ...state.method, method: "CASH" };
        return;
      }
      await route.fulfill({
        status: 201,
        json:
          path === "movements"
            ? movementOf(body)
            : {
                id: randomUUID(),
                seq: 1,
                store_id: store,
                target: body.target,
                target_id: body.target_id,
                amount: state.method.amount_taken,
                direction: "IN",
                from_method: body.from_method,
                to_method: body.to_method,
                explains_close_id: null,
                explains_day: null,
                at: new Date().toISOString(),
                by: "Оля",
                note: body.note ?? null,
              },
      });
    });
  return { sent, methodReads: () => methodReads };
}

const sale = {
  target: "SALE",
  target_id: mine[0]?.target_id,
  amount_taken: "700.00",
  method: "CARD",
  corrected: false,
  may_change: true,
  is_order: false,
};

/** Telegram's buzzes, and the buttons tapped, counted from now. */
async function record(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      buzzes: string[];
    };
    host.buzzes = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_trigger_haptic_feedback") host.buzzes.push(data);
      },
    };
  });
}

async function buzzes(page: Page): Promise<unknown[]> {
  return (
    await page.evaluate(
      () => (window as unknown as { buzzes: string[] }).buzzes,
    )
  ).map((data) => JSON.parse(data) as unknown);
}

async function countTaps(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const host = window as unknown as { taps: number };
    host.taps = 0;
    document.addEventListener(
      "click",
      (event) => {
        if ((event.target as Element).closest("button")) host.taps += 1;
      },
      true,
    );
  });
  return () =>
    page.evaluate(() => (window as unknown as { taps: number }).taps);
}

/** The store open, «Каса» one tap away. */
async function open(
  page: Page,
  options: { theme?: Record<string, string> } = {},
): Promise<void> {
  await page.goto("about:blank");
  await page.goto(launch({ version: "6.1", ...options }));
  await openStore(page, /^Каса CASH/);
}

async function cash(page: Page): Promise<void> {
  await section(page, "Каса");
  await expect(
    page.getByRole("heading", { name: "Каса", exact: true }),
  ).toBeVisible();
}

function sum(page: Page): Locator {
  return page.getByLabel("Сума", { exact: true });
}

function panelButton(page: Page): Locator {
  return page.locator(".pay-panel button");
}

test("«Видати з каси»: what for as chips, nothing chosen; the chip puts the cursor in «Сума»; «Видати 150,00 грн» under the thumb — four taps and the sum (cash task list, P1-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await record(page);
  const server = await stub(page, { now: drawer(), method: sale });
  await open(page);
  const taps = await countTaps(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Видати з каси", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Видати з каси" }),
  ).toBeVisible();
  const kinds = page.getByRole("group", { name: "Кому чи на що" });
  await expect(kinds.getByRole("button")).toHaveCount(2);
  // Nothing chosen for them, and nothing to press.
  for (const chip of await kinds.getByRole("button").all()) {
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
  await expect(panelButton(page)).toHaveText("Видати");
  await expect(panelButton(page)).toBeDisabled();
  // A sum without a kind is not to be sent either.
  await sum(page).fill("150");
  await expect(panelButton(page)).toHaveText("Видати 150,00 грн");
  await expect(panelButton(page)).toBeDisabled();
  // The seller's two kinds in one row at 360 px.
  const [spent, courier] = await Promise.all(
    ["Витрати", "Кур’єру постачальника"].map((name) =>
      kinds.getByRole("button", { name, exact: true }).boundingBox(),
    ),
  );
  if (!spent || !courier) throw new Error("not laid out");
  expect(courier.y).toBe(spent.y);
  await kinds.getByRole("button", { name: "Витрати", exact: true }).click();
  await expect(
    kinds.getByRole("button", { name: "Витрати", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(sum(page)).toBeFocused();
  await expect(sum(page)).toHaveAttribute("inputmode", "decimal");
  // A sum still being typed is never said to be wrong; nothing is no sum.
  await sum(page).fill("150,");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(panelButton(page)).toHaveText("Видати 150,00 грн");
  await sum(page).fill("150,555");
  await expect(page.getByRole("alert")).toHaveText(
    "Вкажіть суму з точністю до копійок.",
  );
  await expect(panelButton(page)).toBeDisabled();
  await sum(page).fill("0");
  await expect(panelButton(page)).toBeDisabled();
  await sum(page).fill("150");
  await page.getByLabel("На що (необов’язково)").fill("пакети");
  // The field and the panel together at 360×640, the panel's button 54 px
  // tall at the bottom.
  const field = await page.locator(".count-field").boundingBox();
  const panel = await page.locator(".pay-panel").boundingBox();
  const button = await panelButton(page).boundingBox();
  if (!field || !panel || !button) throw new Error("not laid out");
  expect(field.y).toBeGreaterThanOrEqual(0);
  expect(field.y + field.height).toBeLessThanOrEqual(panel.y);
  expect(panel.y + panel.height).toBeLessThanOrEqual(640);
  expect(button.height).toBeGreaterThanOrEqual(54);
  await panelButton(page).click();
  await expect(
    page.getByText("Записано: Витрати, 150,00 грн.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Каса", exact: true }),
  ).toBeVisible();
  // What is sent is as before.
  expect(server.sent.movements).toEqual([
    {
      store_id: store,
      command_id: expect.any(String) as string,
      kind: "EXPENSES",
      amount: "150.00",
      note: "пакети",
      after_close_id: lastClose.id,
    },
  ]);
  expect(await taps()).toBe(4);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
});

test("«Внести в касу»: one kind, nothing to choose, the cursor in «Сума» at once — three taps and the sum (cash task list, P1-2)", async ({
  page,
}) => {
  const server = await stub(page, { now: drawer(), method: sale });
  await open(page);
  const taps = await countTaps(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Внести в касу", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Внести в касу" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Кому чи на що" })).toHaveCount(
    0,
  );
  await expect(sum(page)).toBeFocused();
  await sum(page).fill("100");
  await page.getByRole("button", { name: "Внести 100,00 грн" }).click();
  await expect(
    page.getByText("Записано: Розмін, 100,00 грн.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(server.sent.movements).toEqual([
    {
      store_id: store,
      command_id: expect.any(String) as string,
      kind: "CHANGE",
      amount: "100.00",
      after_close_id: lastClose.id,
    },
  ]);
  expect(await taps()).toBe(3);
});

test("cash taken out and refused is said over the panel, the sum kept and the cursor in it; pressed again it is a new command (cash task list, P1-2)", async ({
  page,
}) => {
  await record(page);
  const server = await stub(page, {
    now: drawer(),
    method: sale,
    answers: [422],
  });
  await open(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Видати з каси", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await sum(page).fill("150");
  await panelButton(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\./,
  );
  await expect(sum(page)).toHaveValue("150");
  await expect(sum(page)).toBeFocused();
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
  await panelButton(page).click();
  await expect(
    page.getByText("Записано: Витрати, 150,00 грн.", { exact: true }),
  ).toBeVisible();
  expect(server.sent.movements).toHaveLength(2);
  expect(server.sent.movements[1]?.command_id).not.toBe(
    server.sent.movements[0]?.command_id,
  );
});

test("cash taken out and unanswered: the form held under «Каса»'s banner with what was typed; refused on its check, it is there to record again; confirmed, «Каса» says it was recorded once (cash task list, P1-2; review, 2026-10-22)", async ({
  page,
}) => {
  const server = await stub(page, {
    now: drawer(),
    method: sale,
    // Lost, then refused on the phone's own check; pressed again, lost,
    // then the server fails the check; checked again, recorded.
    answers: ["lost", 422, "lost", 500],
  });
  await open(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Видати з каси", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await sum(page).fill("150");
  await panelButton(page).click();
  // Refused on its check: still the form, what was typed in it.
  await expect(page.getByRole("alert")).toHaveText(
    /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\./,
  );
  await expect(
    page.getByRole("heading", { name: "Видати з каси" }),
  ).toBeVisible();
  await expect(sum(page)).toHaveValue("150");
  await expect(panelButton(page)).toBeEnabled();
  expect(server.sent.movements).toHaveLength(2);
  expect(server.sent.movements[1]).toEqual(server.sent.movements[0]);
  // Pressed again: a new command, held under the banner, nothing to press.
  await panelButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Видачу ще не підтверджено" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Видати з каси" }),
  ).toBeVisible();
  await expect(page.locator("section.notice p").first()).toHaveText(
    "Видача 150,00 грн · Витрати — сервер не відповів. Двічі цю операцію не запишуть. Поки чекаємо, інші дії недоступні.",
  );
  await expect(sum(page)).toHaveValue("150");
  await expect(sum(page)).toBeDisabled();
  await expect(panelButton(page)).toBeDisabled();
  await expect.poll(() => server.sent.movements.length).toBe(4);
  expect(server.sent.movements[2]?.command_id).not.toBe(
    server.sent.movements[0]?.command_id,
  );
  await page.getByRole("button", { name: "Перевірити видачу" }).click();
  await expect(
    page.getByText("Видачу записано один раз: Витрати, 150,00 грн.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Каса", exact: true }),
  ).toBeVisible();
  expect(server.sent.movements).toHaveLength(5);
  expect(server.sent.movements[4]).toEqual(server.sent.movements[2]);
});

test("«Змінити спосіб оплати»: the seller's operations as rows by time, kind and goods, never a sum or a way; one operation's sum large, its way a pill, the ways as buttons — five taps (cash task list, P1-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await record(page);
  const server = await stub(page, { now: drawer(), method: { ...sale } });
  await open(page);
  const taps = await countTaps(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  await expect(page.locator(".cash-context")).toHaveText(
    "Ваші операції після останнього закриття",
  );
  const rows = page.getByRole("list", { name: "Ваші операції" });
  await expect(rows.getByRole("listitem")).toHaveCount(3);
  const first = rows.getByRole("button").first();
  await expect(first.locator(".fix-time")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(first.locator(".cash-row-title")).toHaveText("Продаж");
  await expect(first.locator(".sale-meta")).toHaveText("Лоран шоколад · M");
  await expect(rows.getByRole("button").nth(1)).toContainText("Внесок");
  await expect(rows.getByRole("button").nth(2)).toContainText("Повернення");
  // A day nobody closed: its date said too.
  await expect(rows.locator(".fix-time").nth(2)).toHaveText(
    /^\d{2}\.\d{2}, 12:15$/,
  );
  // Blind: no sum and no way in the list (G32).
  await expect(rows).not.toContainText(/грн|Готівка|Картка|Переказ/);
  const at = await first.locator(".fix-time").textContent();
  await first.click();
  await expect(page.locator(".fix-what")).toHaveText(`Продаж · ${at ?? ""}`);
  await expect(page.locator(".fix-sum")).toHaveText("700,00 грн");
  await expect(page.locator(".fix-card .badge")).toHaveText("Зараз: Картка");
  const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
  await expect(ways.getByRole("button")).toHaveCount(3);
  await expect(
    ways.getByRole("button", { name: "Картка зараз", exact: true }),
  ).toBeDisabled();
  await expect(panelButton(page)).toHaveText("Оберіть новий спосіб");
  await expect(panelButton(page)).toBeDisabled();
  await ways.getByRole("button", { name: "Готівка", exact: true }).click();
  await expect(
    ways.getByRole("button", { name: "Готівка", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // The ways and the panel together at 360×640.
  const group = await ways.boundingBox();
  const panel = await page.locator(".pay-panel").boundingBox();
  if (!group || !panel) throw new Error("not laid out");
  expect(group.y).toBeGreaterThanOrEqual(0);
  expect(group.y + group.height).toBeLessThanOrEqual(panel.y);
  expect(panel.y + panel.height).toBeLessThanOrEqual(640);
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  await expect(
    page.getByText("Спосіб оплати змінено: Картка → Готівка.", {
      exact: true,
    }),
  ).toBeVisible();
  // What is sent is as before.
  expect(server.sent.corrections).toEqual([
    {
      command_id: expect.any(String) as string,
      target: "SALE",
      target_id: sale.target_id,
      from_method: "CARD",
      to_method: "CASH",
    },
  ]);
  expect(await taps()).toBe(5);
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "success" },
  ]);
});

test("an order's sale offers its five ways, a row each; a way changed meanwhile is read again, and the way it now has is no longer to be chosen (cash task list, P1-3; B6.1)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await record(page);
  const state = {
    now: drawer(),
    method: { ...sale, method: "CARD", is_order: true },
    answers: [409] as (number | "lost")[],
  };
  const server = await stub(page, state);
  await open(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  await page
    .getByRole("list", { name: "Ваші операції" })
    .getByRole("button")
    .first()
    .click();
  const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
  await expect(ways.getByRole("button")).toHaveCount(5);
  // A row each, every name within its button at 360 px.
  const laid = await ways.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => ({
      x: button.getBoundingClientRect().x,
      fits: button.scrollWidth <= button.clientWidth,
    })),
  );
  expect(new Set(laid.map((each) => each.x)).size).toBe(1);
  expect(laid.every((each) => each.fits)).toBe(true);
  for (const name of [
    "Переказ наперед",
    "Накладений платіж",
    "Готівка",
    "Переказ",
  ])
    await expect(ways.getByRole("button", { name, exact: true })).toBeEnabled();
  await ways.getByRole("button", { name: "Готівка", exact: true }).click();
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Спосіб оплати вже змінили: зараз — Готівка. Перевірте й оберіть ще раз.",
  );
  // Read again after the refusal.
  await expect.poll(server.methodReads).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".fix-card .badge")).toHaveText("Зараз: Готівка");
  await expect(
    ways.getByRole("button", { name: "Готівка зараз", exact: true }),
  ).toBeDisabled();
  // On a way to choose again.
  await expect(
    ways.getByRole("button", { name: "Переказ наперед", exact: true }),
  ).toBeFocused();
  await expect(panelButton(page)).toHaveText("Оберіть новий спосіб");
  await expect(panelButton(page)).toBeDisabled();
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
  ]);
});

test("the owner's and managers' correction takes the same card: the operation's sum and way, the ways as buttons, «Інша операція» (cash task list, P1-3)", async ({
  page,
}) => {
  await record(page);
  const server = await stub(page, {
    now: drawer({ may_correct: true }),
    method: sale,
    answers: [409],
  });
  await open(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  const events = page.getByRole("list", { name: "Операції дня" });
  await events.getByRole("button").first().click();
  await expect(page.locator(".fix-what")).toHaveText(
    /^Продаж · \d{2}:\d{2} · Лоран шоколад · M · Оля$/,
  );
  await expect(page.locator(".fix-sum")).toHaveText("700,00 грн");
  await expect(page.locator(".fix-card .badge")).toHaveText("Зараз: Картка");
  // Another operation: the day's list again.
  await page.getByRole("button", { name: "Інша операція" }).click();
  await events.getByRole("button").first().click();
  const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
  await expect(
    ways.getByRole("button", { name: "Картка зараз", exact: true }),
  ).toBeDisabled();
  await ways.getByRole("button", { name: "Готівка", exact: true }).click();
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  // Refused: why, over the day's list read again.
  await expect(page.getByRole("alert")).toHaveText(
    "Спосіб оплати вже змінили: зараз — Готівка. Перевірте й оберіть ще раз.",
  );
  await expect(events).toBeVisible();
  await events.getByRole("button").first().click();
  await ways.getByRole("button", { name: "Готівка", exact: true }).click();
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  await expect(
    page.getByText("Спосіб оплати змінено: Картка → Готівка.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(server.sent.corrections).toHaveLength(2);
  expect(server.sent.corrections[1]).toEqual({
    command_id: expect.any(String) as string,
    target: "SALE",
    target_id: sale.target_id,
    from_method: "CARD",
    to_method: "CASH",
  });
  expect(await buzzes(page)).toEqual([
    { type: "notification", notification_type: "error" },
    { type: "notification", notification_type: "success" },
  ]);
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

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme cash taken out and a way changed read at 4.5:1`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await stub(page, { now: drawer(), method: { ...sale } });
    await open(page, { theme });
    await cash(page);
    await page
      .getByRole("button", { name: "Видати з каси", exact: true })
      .click();
    const kinds = page.getByRole("group", { name: "Кому чи на що" });
    await kinds.getByRole("button", { name: "Витрати", exact: true }).click();
    await sum(page).fill("150");
    for (const part of [
      kinds.getByRole("button", { name: "Витрати", exact: true }),
      kinds.getByRole("button", { name: "Кур’єру постачальника", exact: true }),
      sum(page),
      panelButton(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-move-${name}.png` });
    await page.getByRole("button", { name: "Назад до каси" }).click();
    await page
      .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
      .click();
    await expect(
      page.getByRole("list", { name: "Ваші операції" }).getByRole("listitem"),
    ).toHaveCount(3);
    for (const part of [
      page.locator(".fix-time").first(),
      page.locator(".fix-row .cash-row-title").first(),
      page.locator(".fix-row .sale-meta").first(),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-fix-list-${name}.png` });
    await page
      .getByRole("list", { name: "Ваші операції" })
      .getByRole("button")
      .first()
      .click();
    const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
    await ways.getByRole("button", { name: "Готівка", exact: true }).click();
    for (const part of [
      page.locator(".fix-what"),
      page.locator(".fix-sum .sum"),
      page.locator(".fix-card .badge"),
      ways.getByRole("button", { name: "Готівка", exact: true }),
      ways.getByRole("button", { name: "Переказ", exact: true }),
      panelButton(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-fix-${name}.png` });
  });
