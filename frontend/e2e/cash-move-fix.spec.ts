import {
  test,
  expect,
  expectCaption,
  expectGlyphBeside,
  expectListBlock,
  listRow,
  moveSheet,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Каса»'s cash taken out and put in (cash task list, P1-2), in a sheet
 * over «Каса» («Усе на бірці» sections task list, P1-1), and a way of
 * payment changed (P1-3): what for as chips, the sum large, the sheet's
 * button under it; the seller's operations as rows, never a sum nor a way
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
    /** The next command answered only once this opens. */
    hold?: Promise<void>;
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
      if (state.hold) {
        const held = state.hold;
        delete state.hold;
        await held;
      }
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

/** The take-out sheet's own button, «Видати 150,00 грн»: never Telegram's
 * MainButton, as it moves money. */
function moveButton(page: Page): Locator {
  return page.locator(".cash-move-button");
}

test("«Видати з каси»: a sheet over «Каса», what for as chips, nothing chosen; the chip puts the cursor in «Сума»; «Видати 150,00 грн» the sheet's own button — four taps and the sum (cash task list, P1-2; «Усе на бірці» sections task list, P1-1)", async ({
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
  await moveSheet(page, "Видати з каси");
  await expect(
    page.getByRole("heading", { name: "Видати з каси" }),
  ).toBeVisible();
  // Over «Каса», which stands behind it.
  await expect(
    page.getByRole("heading", { name: "Каса", exact: true }),
  ).toBeAttached();
  const kinds = page.getByRole("group", { name: "Кому чи на що" });
  await expect(kinds.getByRole("button")).toHaveCount(2);
  // Nothing chosen for them, and nothing to press.
  for (const chip of await kinds.getByRole("button").all()) {
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
  await expect(moveButton(page)).toHaveText("Видати");
  await expect(moveButton(page)).toBeDisabled();
  // A sum without a kind is not to be sent either.
  await sum(page).fill("150");
  await expect(moveButton(page)).toHaveText("Видати 150,00 грн");
  await expect(moveButton(page)).toBeDisabled();
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
  await expect(moveButton(page)).toHaveText("Видати 150,00 грн");
  await sum(page).fill("150,555");
  await expect(page.getByRole("alert")).toHaveText(
    "Вкажіть суму з точністю до копійок.",
  );
  await expect(moveButton(page)).toBeDisabled();
  await sum(page).fill("0");
  await expect(moveButton(page)).toBeDisabled();
  await sum(page).fill("150");
  await page.getByLabel("На що (необов’язково)").fill("пакети");
  // The field and the sheet's button together at 360×640, the button 52 px
  // tall at its foot.
  const field = await page.locator(".count-field").boundingBox();
  const button = await moveButton(page).boundingBox();
  if (!field || !button) throw new Error("not laid out");
  expect(field.y).toBeGreaterThanOrEqual(0);
  expect(field.y + field.height).toBeLessThanOrEqual(button.y);
  expect(button.y + button.height).toBeLessThanOrEqual(640);
  expect(button.height).toBeGreaterThanOrEqual(52);
  await moveButton(page).click();
  await expect(
    page.getByText("Записано: Витрати, 150,00 грн.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  // The chip felt as a choice (audit 2026-11-13, orders-cash P2-3).
  expect(await buzzes(page)).toEqual([
    { type: "selection_change" },
    { type: "notification", notification_type: "success" },
  ]);
});

for (const [name, theme] of [
  ["light", { bg_color: "#ffffff", text_color: "#000000" }],
  ["dark", { bg_color: "#17212b", text_color: "#f5f5f5" }],
] as const)
  test(`in the ${name} theme what «Каса» recorded is a line with its eyelet filled in ink, as an order's step, at 4.5:1, its words never over the eyelet at 360 (orders and «Каса» task list after stage 2, P1-3)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await stub(page, { now: drawer(), method: sale });
    await open(page, { theme });
    await cash(page);
    await page
      .getByRole("button", { name: "Видати з каси", exact: true })
      .click();
    await moveSheet(page, "Видати з каси");
    await page
      .getByRole("group", { name: "Кому чи на що" })
      .getByRole("button", { name: "Витрати", exact: true })
      .click();
    await sum(page).fill("150");
    await moveButton(page).click();
    const line = page
      .getByRole("status")
      .filter({ hasText: /^Записано: Витрати, 150,00\sгрн\.$/ });
    await expect(line).toBeVisible();
    await expect(line).toHaveClass(/(?:^|\s)step-done(?:\s|$)/);
    const look = await line.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--ink)";
      document.body.append(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      const eyelet = node.querySelector(":scope > .eyelet-filled");
      const hole = eyelet?.getBoundingClientRect();
      const words = [...node.childNodes].find(
        (child) => child.nodeType === Node.TEXT_NODE,
      );
      const said = document.createRange();
      if (words) said.selectNodeContents(words);
      return {
        eyelet: eyelet
          ? [getComputedStyle(eyelet).backgroundColor === ink, hole?.width]
          : null,
        clear:
          hole !== undefined &&
          [...said.getClientRects()].every((rect) => rect.left >= hole.right),
        weight: getComputedStyle(node).fontWeight,
      };
    });
    expect(look).toEqual({ eyelet: [true, 12], clear: true, weight: "600" });
    expect(await contrast(line)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-recorded-${name}.png` });
  });

test("cash taken out and a way changed, on their way, wait as the till's dock: the pressed button's ring in its colour, «Ще надсилаємо…» over it past 3 s, the sheet kept and «← Каса» held, Telegram's «Назад» hidden; answered, as before (audit after stage 2, orders-cash P0-1; review, 2026-11-09)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await record(page);
  // What the app tells Telegram of its «Назад», shown or not.
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      backs: boolean[];
    };
    host.backs = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        if (event === "web_app_setup_back_button")
          host.backs.push(
            (JSON.parse(data) as { is_visible: boolean }).is_visible,
          );
      },
    };
  });
  const back = (): Promise<boolean | undefined> =>
    page.evaluate(() =>
      (window as unknown as { backs: boolean[] }).backs.at(-1),
    );
  let answer = (): void => undefined;
  const hold = (): Promise<void> =>
    new Promise<void>((done) => {
      answer = done;
    });
  const state: Parameters<typeof stub>[1] = {
    now: drawer(),
    method: { ...sale },
    hold: hold(),
  };
  const server = await stub(page, state);
  await open(page);
  await cash(page);
  // «Видати з каси» on its way.
  await page
    .getByRole("button", { name: "Видати з каси", exact: true })
    .click();
  const out = await moveSheet(page, "Видати з каси");
  await out
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await sum(page).fill("150");
  await expect.poll(back).toBe(true);
  await moveButton(page).click();
  await expect.poll(() => server.sent.movements?.length).toBe(1);
  await expect(moveButton(page)).toHaveClass(/\bpressed\b/);
  await expect(moveButton(page).locator(".eyelet-spin")).toBeVisible();
  await expect.poll(back).toBe(false);
  const outLine = out.locator(".sending-line");
  await expect(outLine).toBeAttached();
  await expect(outLine).not.toContainText("Ще надсилаємо…");
  await expect(outLine).toHaveText("Ще надсилаємо…", { timeout: 6000 });
  // Over the button, never moving it.
  const [said, button] = await Promise.all([
    outLine.locator("span").boundingBox(),
    moveButton(page).boundingBox(),
  ]);
  if (!said || !button) throw new Error("not laid out");
  expect(said.y + said.height).toBeLessThanOrEqual(button.y);
  expect(button.y - (said.y + said.height)).toBeLessThanOrEqual(12);
  await out.focus();
  await page.keyboard.press("Escape");
  await expect(out).toBeVisible();
  answer();
  await expect(
    page.getByText("Записано: Витрати, 150,00 грн.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // «Змінити на «Готівка»» on its way.
  state.hold = hold();
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  await page
    .getByRole("list", { name: "Ваші операції" })
    .getByRole("button")
    .first()
    .click();
  await page
    .getByRole("group", { name: "Новий спосіб оплати" })
    .getByRole("button", { name: "Готівка", exact: true })
    .click();
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  await expect.poll(() => server.sent.corrections?.length).toBe(1);
  await expect(panelButton(page)).toHaveClass(/\bpressed\b/);
  await expect(panelButton(page)).toBeDisabled();
  await expect(panelButton(page).locator(".eyelet-spin")).toBeVisible();
  // No way out meanwhile: «← Каса» held, Telegram's «Назад» hidden.
  await expect(
    page.getByRole("button", { name: "Назад до каси" }),
  ).toBeDisabled();
  await expect.poll(back).toBe(false);
  const fixLine = page.locator(".pay-panel .sending-line");
  await expect(fixLine).toBeAttached();
  await expect(fixLine).not.toContainText("Ще надсилаємо…");
  await expect(fixLine).toHaveText("Ще надсилаємо…", { timeout: 6000 });
  answer();
  await expect(
    page.getByText("Спосіб оплати змінено: Картка → Готівка.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(server.sent.corrections).toHaveLength(1);
  expect(server.sent.movements).toHaveLength(1);
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
  await moveSheet(page, "Внести в касу");
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
  await moveSheet(page, "Видати з каси");
  await page
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await sum(page).fill("150");
  await moveButton(page).click();
  await expect(page.getByRole("alert")).toHaveText(
    /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\./,
  );
  await expect(sum(page)).toHaveValue("150");
  await expect(sum(page)).toBeFocused();
  expect(await buzzes(page)).toEqual([
    { type: "selection_change" },
    { type: "notification", notification_type: "error" },
  ]);
  await moveButton(page).click();
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
  await moveSheet(page, "Видати з каси");
  await page
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await sum(page).fill("150");
  await moveButton(page).click();
  // Refused on its check: still the form, what was typed in it.
  await expect(page.getByRole("alert")).toHaveText(
    /^Не записано: поки форма була відкрита, касу закрили о \d{2}:\d{2} · Олена\./,
  );
  await expect(
    page.getByRole("heading", { name: "Видати з каси" }),
  ).toBeVisible();
  await expect(sum(page)).toHaveValue("150");
  await expect(moveButton(page)).toBeEnabled();
  expect(server.sent.movements).toHaveLength(2);
  expect(server.sent.movements[1]).toEqual(server.sent.movements[0]);
  // Pressed again: a new command, held under the banner, nothing to press.
  await moveButton(page).click();
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
  await expect(moveButton(page)).toBeDisabled();
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
  // The sheet gone while its row waited for the answer: the cursor on
  // «Каса»'s title or back on the row, never lost (review, 2026-11-03).
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.matches("h1, .cash-row") === true,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Каса", exact: true }),
  ).toBeVisible();
  expect(server.sent.movements).toHaveLength(5);
  expect(server.sent.movements[4]).toEqual(server.sent.movements[2]);
});

test("cash taken out and unanswered, its sheet closed while its row waits for the answer: the cursor on «Каса»'s title, never lost (review, 2026-11-03)", async ({
  page,
}) => {
  const server = await stub(page, {
    now: drawer(),
    method: sale,
    // Lost, then the server fails the phone's own check: kept.
    answers: ["lost", 500],
  });
  await open(page);
  await cash(page);
  const row = page.getByRole("button", { name: "Видати з каси", exact: true });
  await row.click();
  await moveSheet(page, "Видати з каси");
  await page
    .getByRole("group", { name: "Кому чи на що" })
    .getByRole("button", { name: "Витрати", exact: true })
    .click();
  await sum(page).fill("150");
  await moveButton(page).click();
  await expect(
    page.getByRole("heading", { name: "Видачу ще не підтверджено" }),
  ).toBeVisible();
  await expect.poll(() => server.sent.movements.length).toBe(2);
  await page.locator(".sheet-scrim").click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toBeDisabled();
  // Seen with nothing over it: the row waits unfaded, its title in pencil
  // (audit 2026-11-13, orders-cash P1-2; review).
  expect(
    await row.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--pencil)";
      document.body.append(probe);
      const pencil = getComputedStyle(probe).color;
      probe.remove();
      const title = node.querySelector(".cash-row-title") ?? node;
      return [
        getComputedStyle(node).opacity,
        getComputedStyle(title).color === pencil,
      ];
    }),
  ).toEqual(["1", true]);
  expect(await contrast(row.locator(".cash-row-title"))).toBeGreaterThanOrEqual(
    4.5,
  );
  await expect(
    page.getByRole("heading", { name: "Каса", exact: true }),
  ).toBeFocused();
});

test("at 360 × 400, «Змінити спосіб оплати»'s list scrolled to its foot, an operation tapped opens its card at the top, under the same title (audit after stage 2, frame P1-3; review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 400 });
  await record(page);
  await stub(page, { now: drawer(), method: { ...sale } });
  await open(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  const rows = page.getByRole("list", { name: "Ваші операції" });
  await expect(rows.getByRole("listitem")).toHaveCount(3);
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await rows.getByRole("button").first().click();
  await expect(page.locator(".fix-sum")).toHaveText("700,00 грн");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
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
  // One context line, the store's; «Ваші операції після останнього
  // закриття» the list's caption over its rows (audit 2026-11-13,
  // orders-cash P2-2).
  await expect(page.locator(".cash-fix .cash-context")).toHaveCount(0);
  const caption = page.getByRole("heading", {
    name: "Ваші операції після останнього закриття",
    level: 2,
  });
  await expectCaption(caption);
  const rows = page.getByRole("list", { name: "Ваші операції" });
  await expect(rows.getByRole("listitem")).toHaveCount(3);
  const [over, list] = await Promise.all([
    caption.boundingBox(),
    rows.boundingBox(),
  ]);
  if (!over || !list) throw new Error("not laid out");
  expect(over.y + over.height).toBeLessThanOrEqual(list.y);
  expect(list.y - (over.y + over.height)).toBeLessThanOrEqual(12);
  // Two lines at most at 360, within the phone.
  expect(over.height).toBeLessThanOrEqual(32);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({ path: "test-results/cash-fix-list.png" });
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
  await expect(page.locator(".fix-card .way-pill")).toHaveText("Зараз: Картка");
  // With its glyph beside its words, as on a sale's stub (stage 2, money
  // task list, P2-1).
  await expectGlyphBeside(page.locator(".fix-card .way-pill"));
  const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
  await expect(ways.getByRole("button")).toHaveCount(3);
  await expect(
    ways.getByRole("button", { name: "Картка зараз", exact: true }),
  ).toBeDisabled();
  // «зараз» at the reading floor, 14; the way it is under still the ways'
  // 54 (audit 2026-11-13, orders-cash P2-2).
  const now = ways.getByRole("button", { name: "Картка зараз", exact: true });
  await expect(now.locator(".fix-now")).toHaveCSS("font-size", "14px");
  expect((await now.boundingBox())?.height).toBe(54);
  expect(
    (
      await ways
        .getByRole("button", { name: "Готівка", exact: true })
        .boundingBox()
    )?.height,
  ).toBe(54);
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
  // The way felt as a choice (audit 2026-11-13, orders-cash P2-3).
  expect(await buzzes(page)).toEqual([
    { type: "selection_change" },
    { type: "notification", notification_type: "success" },
  ]);
});

test("a choice in «Каса» is felt once as it changes, never again on the same — a chip of «Видати з каси», a new way; the notes' key says «done» and puts the keyboard away (audit 2026-11-13, orders-cash P2-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await record(page);
  const server = await stub(page, { now: drawer(), method: { ...sale } });
  await open(page);
  await cash(page);
  const selection = { type: "selection_change" };
  await page
    .getByRole("button", { name: "Видати з каси", exact: true })
    .click();
  const out = await moveSheet(page, "Видати з каси");
  const kinds = out.getByRole("group", { name: "Кому чи на що" });
  await kinds.getByRole("button", { name: "Витрати", exact: true }).click();
  expect(await buzzes(page)).toEqual([selection]);
  await kinds.getByRole("button", { name: "Витрати", exact: true }).click();
  expect(await buzzes(page)).toEqual([selection]);
  await kinds
    .getByRole("button", { name: "Кур’єру постачальника", exact: true })
    .click();
  expect(await buzzes(page)).toEqual([selection, selection]);
  // A line's key: «done», the keyboard put away, what was typed kept —
  // nothing sent, though the sheet's button could send it.
  await sum(page).fill("150");
  await expect(moveButton(page)).toBeEnabled();
  const note = out.getByLabel("На що (необов’язково)");
  await expect(note).toHaveAttribute("enterkeyhint", "done");
  await note.fill("пакети");
  await note.press("Enter");
  await expect(note).not.toBeFocused();
  await expect(note).toHaveValue("пакети");
  await expect(out).toBeVisible();
  expect(server.sent.movements ?? []).toHaveLength(0);
  // Left by the scrim: nothing sent.
  await page.mouse.click(180, 20);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  await page
    .getByRole("list", { name: "Ваші операції" })
    .getByRole("button")
    .first()
    .click();
  const ways = page.getByRole("group", { name: "Новий спосіб оплати" });
  await ways.getByRole("button", { name: "Готівка", exact: true }).click();
  expect(await buzzes(page)).toEqual([selection, selection, selection]);
  await ways.getByRole("button", { name: "Готівка", exact: true }).click();
  expect(await buzzes(page)).toEqual([selection, selection, selection]);
  await ways.getByRole("button", { name: "Переказ", exact: true }).click();
  expect(await buzzes(page)).toEqual([
    selection,
    selection,
    selection,
    selection,
  ]);
  await expect(panelButton(page)).toBeEnabled();
  const why = page.getByLabel("Пояснення (необов’язково)");
  await expect(why).toHaveAttribute("enterkeyhint", "done");
  await why.fill("помилка");
  await why.press("Enter");
  await expect(why).not.toBeFocused();
  await expect(why).toHaveValue("помилка");
  expect(server.sent.corrections ?? []).toHaveLength(0);
});

test("the list's caption stands over its rows' places while they are read and over a refused read, never over the blank tag (audit 2026-11-13, orders-cash P2-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await stub(page, { now: drawer(), method: { ...sale } });
  // The seller's operations: the first read held, then refused; the next
  // read none.
  let answer = (): void => undefined;
  const held = new Promise<void>((done) => {
    answer = done;
  });
  let reads = 0;
  await page.route("**/api/v1/cash/events?**", async (route) => {
    reads += 1;
    if (reads === 1) {
      await held;
      await route.fulfill({
        status: 500,
        json: { code: "INTERNAL_ERROR", message: "Internal error" },
      });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  await open(page);
  await cash(page);
  await page
    .getByRole("button", { name: "Змінити спосіб оплати", exact: true })
    .click();
  const caption = page.getByRole("heading", {
    name: "Ваші операції після останнього закриття",
    level: 2,
  });
  const places = page.locator(".cash-fix .placeholder");
  await expect(places).toBeVisible();
  await expectCaption(caption);
  const [over, under] = await Promise.all([
    caption.boundingBox(),
    places.boundingBox(),
  ]);
  if (!over || !under) throw new Error("not laid out");
  expect(over.y + over.height).toBeLessThanOrEqual(under.y);
  answer();
  const refused = page.locator(".cash-fix .read-failure");
  await expect(refused).toBeVisible();
  await expectCaption(caption);
  await refused.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(page.locator(".cash-fix .orders-empty")).toBeVisible();
  await expect(caption).toHaveCount(0);
  await expect(page.locator(".cash-fix .cash-context")).toHaveCount(0);
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
  await expect(page.locator(".fix-card .way-pill")).toHaveText(
    "Зараз: Готівка",
  );
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
    { type: "selection_change" },
    { type: "notification", notification_type: "error" },
  ]);
});

test("the owner's and managers' correction takes the same card: the operation's sum and way, the ways as buttons, «Інша операція»; on its way, neither «← Каса» nor «Інша операція» leads off it (cash task list, P1-3; review, 2026-11-09)", async ({
  page,
}) => {
  await record(page);
  const state: Parameters<typeof stub>[1] = {
    now: drawer({ may_correct: true }),
    method: sale,
    answers: [409],
  };
  const server = await stub(page, state);
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
  await expect(page.locator(".fix-card .way-pill")).toHaveText("Зараз: Картка");
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
  let answer = (): void => undefined;
  state.hold = new Promise<void>((done) => {
    answer = done;
  });
  await page.getByRole("button", { name: "Змінити на «Готівка»" }).click();
  await expect.poll(() => server.sent.corrections?.length).toBe(2);
  await expect(
    page.getByRole("button", { name: "Назад до каси" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Інша операція" }),
  ).toBeDisabled();
  answer();
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
    { type: "selection_change" },
    { type: "notification", notification_type: "error" },
    { type: "selection_change" },
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
  test(`in the ${name} theme «Каса»'s rows and the seller's operations lie on a list's white block; while cash taken out is on its way, «Каса»'s rows take no tap and nothing fades — their titles in pencil, at 4.5:1 (audit 2026-11-13, orders-cash P1-2)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    let answer = (): void => undefined;
    const state: Parameters<typeof stub>[1] = {
      now: drawer(),
      method: { ...sale },
    };
    const server = await stub(page, state);
    await open(page, { theme });
    await cash(page);
    const block = page.locator(".cash-rows");
    const rows = block.locator(".cash-row");
    await expect(
      rows.filter({ hasText: "Змінити спосіб оплати" }),
    ).toBeVisible();
    await expectListBlock(block, rows);
    await listRow(page, rows.first(), ".cash-row-title");
    await listRow(page, rows.last(), ".cash-row-title");
    const pencil = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--pencil)";
      document.body.append(probe);
      const said = getComputedStyle(probe).color;
      probe.remove();
      return said;
    });
    // «Видати з каси» on its way: the rows behind its sheet take no tap,
    // their titles in pencil, nothing faded over them.
    state.hold = new Promise<void>((done) => {
      answer = done;
    });
    await page
      .getByRole("button", { name: "Видати з каси", exact: true })
      .click();
    const out = await moveSheet(page, "Видати з каси");
    await out
      .getByRole("group", { name: "Кому чи на що" })
      .getByRole("button", { name: "Витрати", exact: true })
      .click();
    await sum(page).fill("150");
    await moveButton(page).click();
    await expect.poll(() => server.sent.movements?.length).toBe(1);
    const change = rows.filter({ hasText: "Змінити спосіб оплати" });
    await expect(change).toBeDisabled();
    for (const row of await rows.all()) {
      await expect(row).toBeDisabled();
      expect(
        await row.evaluate((node) => [
          getComputedStyle(node).opacity,
          getComputedStyle(node.querySelector(".cash-row-title") ?? node).color,
        ]),
      ).toEqual(["1", pencil]);
      expect(
        await contrast(row.locator(".cash-row-title")),
      ).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({
      path: `test-results/cash-rows-waiting-${name}.png`,
    });
    answer();
    await expect(
      page.getByText("Записано: Витрати, 150,00 грн.", { exact: true }),
    ).toBeVisible();
    await expect(change).toBeEnabled();
    // The seller's own operations, on the same block.
    await change.click();
    const mine = page.getByRole("list", { name: "Ваші операції" });
    await expect(mine.getByRole("listitem")).toHaveCount(3);
    await expectListBlock(mine, mine.locator(".fix-row"));
    await listRow(page, mine.locator(".fix-row").first(), ".cash-row-title");
    await listRow(page, mine.locator(".fix-row").last(), ".cash-row-title");
    await page.screenshot({ path: `test-results/cash-rows-mine-${name}.png` });
  });

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
    await moveSheet(page, "Видати з каси");
    const kinds = page.getByRole("group", { name: "Кому чи на що" });
    await kinds.getByRole("button", { name: "Витрати", exact: true }).click();
    await sum(page).fill("150");
    for (const part of [
      kinds.getByRole("button", { name: "Витрати", exact: true }),
      kinds.getByRole("button", { name: "Кур’єру постачальника", exact: true }),
      sum(page),
      moveButton(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-move-${name}.png` });
    // «Назад» (Escape here) closes the sheet.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
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
      page.locator(".fix-card .way-pill"),
      ways.getByRole("button", { name: "Готівка", exact: true }),
      ways.getByRole("button", { name: "Переказ", exact: true }),
      panelButton(page),
    ])
      expect(await contrast(part)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `test-results/cash-fix-${name}.png` });
  });
