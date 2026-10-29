import {
  confirmClose,
  test,
  expect,
  grn,
  openStore,
  section,
} from "./fixtures";
import type { Locator, Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Каса»'s kept command (cash task list, P1-1): its banner names what waits
 * and for how much, from the attempt alone; the phone checks it by itself,
 * and nothing of the drawer goes on paper (owner decision, 2026-10-21, В2);
 * confirmed, «… записано один раз: …»; a count that came too late the same
 * evening is counted again (В3). The drawer is stubbed, so each answer is
 * the one each journey asks for. Kyiv's clock, as the shops': the drawer's
 * day is its hours, whatever zone the journeys run in.
 */
test.use({ timezoneId: "Europe/Kyiv" });

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

function initData(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Оля"}`,
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

/** Where this person's drawer journal is kept on the phone. */
async function journalKey(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData(olya) },
  });
  const { access_token } = (await auth.json()) as { access_token: string };
  const me = (await (
    await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    })
  ).json()) as { organization_id: string; user_id: string };
  return `birka:cash-pending:${me.organization_id}:${me.user_id}:${store}`;
}

/** A drawer command kept on the phone, its answer never heard. */
async function keep(
  page: Page,
  body: Record<string, unknown>,
  since?: string,
): Promise<string> {
  const key = await journalKey(page);
  // Outside Telegram the app only asks to be opened from the bot.
  await page.goto("/");
  await page.evaluate(
    ([name, saved]) => {
      localStorage.setItem(name, saved);
    },
    [
      key,
      JSON.stringify({
        key: randomUUID(),
        body: { store_id: store, command_id: randomUUID(), ...body },
        ambiguous: true,
        ...(since === undefined ? {} : { since }),
      }),
    ] as const,
  );
  return key;
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
    movement_kinds: ["EXPENSES", "SUPPLIER_COURIER"],
    may_correct: false,
    movements: [],
    unclosed_days: [],
    reason_owed: null,
    ...over,
  };
}

const zero = {
  came_in: "0.00",
  went_out: "0.00",
  corrected: "0.00",
  net: "0.00",
};

function closeOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    number: 4,
    business_day: "2026-10-21",
    closed_at: new Date().toISOString(),
    closed_by: "Оля",
    mine: true,
    store_id: store,
    store_name: "Каса",
    opening: false,
    since: lastClose.closed_at,
    counted: "2000.00",
    expected: "2000.00",
    difference: "0.00",
    card: zero,
    transfer: zero,
    unclosed_days: [],
    reason: null,
    reason_by: null,
    reason_required: false,
    opening_float: null,
    cash_in: null,
    cash_out: null,
    taken_out: null,
    put_in: null,
    cash_corrected: null,
    prepaid_transfer: null,
    carrier_cod: null,
    not_stated: null,
    explained: null,
    unexplained: null,
    explanations: [],
    ...over,
  };
}

/** The drawer read as `state.now`, and its closes' list empty. Returns how
 * many times the drawer was read. */
async function stubDrawer(
  page: Page,
  state: {
    now: Drawer;
    /** The server out of reach for the drawer's reads. */
    lost?: boolean;
  },
): Promise<() => number> {
  let reads = 0;
  await page.route("**/api/v1/cash/drawer?**", async (route) => {
    reads += 1;
    if (state.lost) {
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({ json: state.now });
  });
  await page.route("**/api/v1/cash/closes?**", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { items: [], has_more: false } });
  });
  return () => reads;
}

/** «Каса», opened as Оля with the kept command already on the phone; its
 * main screen awaited unless `main` is false. */
async function cash(page: Page, main = true): Promise<void> {
  await page.goto("about:blank");
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData(olya) }).toString()}`,
  );
  await openStore(page, /^Каса CASH/);
  await section(page, "Каса");
  if (main)
    await expect(
      page.getByRole("heading", { name: "Каса", exact: true }),
    ).toBeVisible();
}

function card(page: Page): Locator {
  return page.getByRole("button", { name: "Закрити касу", exact: true });
}

const waits = "Поки чекаємо, інші дії недоступні.";
const checksItself =
  "Телефон перевірить сам. Нічого не повторюйте, поки він не скаже «не записано».";
const owed = closeOf({
  expected: "2050.00",
  difference: "-50.00",
  reason_required: true,
});
// A close of an hour ago: the bot's 15 minutes long over (G11).
const owedBefore = closeOf({
  expected: "2050.00",
  difference: "-50.00",
  reason_required: true,
  closed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
});

/** Cash moved, as the server answers it. */
function movementOf(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: randomUUID(),
    store_id: store,
    kind: "EXPENSES",
    direction: "OUT",
    amount: "1150.00",
    note: "пакети",
    at: new Date().toISOString(),
    by: "Оля",
    for_close_id: null,
    for_day: null,
    moved_to_close: false,
    ...over,
  };
}

/** A way changed, as the server answers it. */
function correctionOf(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: randomUUID(),
    seq: 1,
    store_id: store,
    target: "SALE",
    target_id: randomUUID(),
    amount: "700.00",
    direction: "IN",
    from_method: "CARD",
    to_method: "CASH",
    explains_close_id: null,
    explains_day: null,
    at: new Date().toISOString(),
    by: "Оля",
    note: null,
    ...over,
  };
}

const takeOut = {
  path: "**/api/v1/cash/movements",
  body: {
    command: "movement",
    movement_kind: "EXPENSES",
    amount: "1150.00",
    note: "пакети",
    after_close_id: lastClose.id,
  },
  heading: "Видачу",
  lower: "видачу",
  line: `Видача ${grn("1150.00")} · Витрати — сервер не відповів. Двічі цю операцію не запишуть. ${waits}`,
};
const putIn = {
  path: "**/api/v1/cash/movements",
  body: {
    command: "movement",
    movement_kind: "CHANGE",
    amount: "100.00",
    note: null,
    after_close_id: lastClose.id,
  },
  heading: "Внесення",
  lower: "внесення",
  line: `Внесення ${grn("100.00")} — сервер не відповів. Двічі цю операцію не запишуть. ${waits}`,
};
const fix = {
  path: "**/api/v1/cash/corrections",
  body: {
    command: "correction",
    target: "SALE",
    target_id: randomUUID(),
    from_method: "CARD",
    to_method: "CASH",
    note: null,
  },
  heading: "Зміну способу оплати",
  lower: "зміну способу оплати",
  line: `Зміна способу оплати: Картка → Готівка — сервер не відповів. Двічі цю операцію не запишуть. ${waits}`,
};
const reason = {
  path: "**/api/v1/cash/closes/*/reason",
  heading: "Причину",
  lower: "причину",
  line: `Причина різниці — сервер не відповів. Двічі цю операцію не запишуть. ${waits}`,
};

// `since`: when the attempt was first sent — five minutes ago, a moment of
// its own, or none for one kept before the phone said since when.
for (const kept of [
  {
    name: "count at the close",
    path: "**/api/v1/cash/closes?**",
    body: {
      command: "close",
      counted: "2000.00",
      counted_at: new Date().toISOString(),
      after_close_id: lastClose.id,
    },
    since: true,
    heading: "Підрахунок",
    lower: "підрахунок",
    line: `Підрахунок ${grn("2000.00")} — сервер не відповів. Двічі цю операцію не запишуть. ${waits}`,
    answer: closeOf(),
    done: "Підрахунок записано один раз.",
  },
  {
    name: "reason of a difference",
    ...reason,
    body: { command: "reason", close_id: owed.id, reason: "Решта" },
    since: false,
    answer: { ...owed, reason: "Решта", reason_by: "Оля" },
    done: "Причину записано один раз. Власник отримає повідомлення.",
  },
  {
    // Recorded when it first reached the server, which may have been within
    // the bot's wait: neither «отримає» nor «уже отримав» is known.
    name: "reason to a close of an hour ago",
    ...reason,
    body: { command: "reason", close_id: owedBefore.id, reason: "Решта" },
    since: false,
    answer: { ...owedBefore, reason: "Решта", reason_by: "Оля" },
    done: "Причину записано один раз. Власник побачить її в застосунку.",
  },
  {
    name: "reason first sent past the bot's wait",
    ...reason,
    body: { command: "reason", close_id: owedBefore.id, reason: "Решта" },
    since: new Date(
      Date.parse(String(owedBefore.closed_at)) + 20 * 60 * 1000,
    ).toISOString(),
    answer: { ...owedBefore, reason: "Решта", reason_by: "Оля" },
    done: "Причину записано один раз. Власник уже отримав повідомлення без причини — побачить її в застосунку.",
  },
  {
    name: "money taken out",
    ...takeOut,
    since: true,
    answer: movementOf({}),
    done: `Видачу записано один раз: Витрати, ${grn("1150.00")}.`,
  },
  {
    name: "money taken out the server put on a colleague's close",
    ...takeOut,
    since: true,
    answer: movementOf({
      for_close_id: lastClose.id,
      for_day: "2026-10-20",
      moved_to_close: true,
    }),
    done: `Видачу записано один раз: Витрати, ${grn("1150.00")} — до закриття 20.10, гроші взяли до нього.`,
  },
  {
    name: "money put in",
    ...putIn,
    since: true,
    answer: movementOf({
      kind: "CHANGE",
      direction: "IN",
      amount: "100.00",
      note: null,
    }),
    done: `Внесення записано один раз: ${grn("100.00")}.`,
  },
  {
    name: "money put in the server put on a colleague's close",
    ...putIn,
    since: true,
    answer: movementOf({
      kind: "CHANGE",
      direction: "IN",
      amount: "100.00",
      note: null,
      for_close_id: lastClose.id,
      for_day: "2026-10-20",
      moved_to_close: true,
    }),
    done: `Внесення записано один раз: ${grn("100.00")} — до закриття 20.10, гроші внесли до нього.`,
  },
  {
    name: "fix of a way",
    ...fix,
    since: true,
    answer: correctionOf(),
    done: "Зміну способу оплати записано один раз: Картка → Готівка.",
  },
  {
    name: "fix of a way that explains a close",
    ...fix,
    since: true,
    answer: correctionOf({
      explains_close_id: lastClose.id,
      explains_day: "2026-10-20",
    }),
    done: "Зміну способу оплати записано один раз: Картка → Готівка. Пояснює різницю закриття 20.10.",
  },
])
  test(`a kept ${kept.name} names what waits and for how much, the phone checks it itself, and confirmed it says it was recorded once (cash task list, P1-1; owner decision, 2026-10-21, В2)`, async ({
    page,
  }) => {
    const since =
      typeof kept.since === "string"
        ? kept.since
        : kept.since
          ? new Date(Date.now() - 5 * 60 * 1000).toISOString()
          : undefined;
    const key = await keep(page, kept.body, since);
    await stubDrawer(page, { now: drawer() });
    let answered = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    await page.route(kept.path, async (route, request) => {
      if (request.method() !== "POST") {
        await route.fallback();
        return;
      }
      sent.push(request.postData() ?? "");
      if (!answered) {
        await route.fulfill({
          status: 500,
          json: { code: "INTERNAL_ERROR", message: "Refused" },
        });
        return;
      }
      await held;
      await route.fulfill({ status: 201, json: kept.answer });
    });
    await cash(page);
    const banner = page.locator("section.notice");
    // Checked by itself on opening, and still unconfirmed.
    await expect(page.getByRole("alert")).toContainText(
      `${kept.heading} ще не підтверджено: сервер не зміг відповісти.`,
    );
    await expect(banner.getByRole("heading")).toHaveText(
      `${kept.heading} ще не підтверджено`,
    );
    await expect(banner.locator("p").first()).toHaveText(kept.line);
    // Nothing of the drawer on paper: no paper line, no name.
    await expect(banner.locator("p").nth(1)).toHaveText(
      kept.since
        ? new RegExp(
            `^Чекає відповіді сервера з \\d{2}:\\d{2}\\. ${checksItself.replace(/\./g, "\\.")}$`,
          )
        : checksItself,
    );
    await expect(banner).not.toContainText("папері");
    const check = banner.getByRole("button", {
      name: `Перевірити ${kept.lower}`,
      exact: true,
    });
    await expect(check).toBeEnabled();
    expect(sent).toHaveLength(1);
    answered = true;
    await check.click();
    await expect(banner.getByRole("heading")).toHaveText(
      `Перевіряємо ${kept.lower}…`,
    );
    await expect(check).toBeDisabled();
    release();
    await expect(page.getByText(kept.done, { exact: true })).toBeVisible();
    await expect(banner).toHaveCount(0);
    if (kept.name === "count at the close")
      await expect(
        page.getByRole("heading", { name: "Касу закрито" }),
      ).toBeVisible();
    // The same command, byte for byte.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(
      await page.evaluate((stored) => localStorage.getItem(stored), key),
    ).toBeNull();
  });

/** A kept count, refused for coming over ten minutes late (G31). */
function stale(countedAt: string): Record<string, unknown> {
  return {
    code: "VALIDATION_ERROR",
    message: "Request failed validation",
    details: {
      reason: "COUNT_IS_STALE",
      recorded: false,
      counted_at: countedAt,
    },
  };
}

/** A moment by Kyiv's clock, «HH:MM» on `day`: by default an ordinary
 * Thursday, never the day the journey runs — summer time, +03:00, all of it
 * and of the Wednesday before. */
function at(time: string, day = "2026-10-22"): Date {
  return new Date(`${day}T${time}:00+03:00`);
}

/** Every heading the page ever drew, however briefly: a screen opened and
 * left at once is still caught. */
async function recordHeadings(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const drawn: string[] = [];
    (window as unknown as { drawn: string[] }).drawn = drawn;
    new MutationObserver(() => {
      for (const heading of document.querySelectorAll("h1, h2, h3")) {
        const text = heading.textContent;
        if (!drawn.includes(text)) drawn.push(text);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  return () =>
    page.evaluate(() => (window as unknown as { drawn: string[] }).drawn);
}

/** Cash taken out, as the drawer lists it: what a read after the refusal
 * shows, so a journey knows that read has come. */
const seen = movementOf({ note: "після відмови" });

const recountWords =
  "Підрахунок не записано — він дійшов надто пізно. Перерахуйте касу ще раз і закрийте.";
const asUsual =
  "Підрахунок не записано — він дійшов надто пізно. Закрийте касу, як завжди, увечері: цей день увійде в те закриття.";

// The drawer's day runs 06:00 to 06:00 (G8): 23:50 and 00:15 are one
// evening's. By the hour on the clock: the night the clocks go back an
// hour, at 04:00 on the last Sunday of October, 05:30 is still the evening
// before's, though six hours back from it is already that Sunday.
for (const [name, now, counted] of [
  ["counted at 20:15, refused at 20:30", at("20:30"), at("20:15")],
  [
    "counted at 23:50, refused at 00:15 after midnight",
    at("00:15"),
    at("23:50", "2026-10-21"),
  ],
  [
    "counted at 23:50, refused at 05:30 the night the clocks go back (Kyiv, 2026-10-25)",
    new Date("2026-10-25T05:30:00+02:00"),
    new Date("2026-10-24T23:50:00+03:00"),
  ],
] as const)
  test(`a kept count that came too late the same evening — ${name} — the drawer still to close, opens the count again: «Перерахуйте касу ще раз і закрийте» (owner decision, 2026-10-21, В3)`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(now);
    const countedAt = counted.toISOString();
    const key = await keep(page, {
      command: "close",
      counted: "1990.00",
      counted_at: countedAt,
      after_close_id: lastClose.id,
    });
    const state = { now: drawer() };
    const reads = await stubDrawer(page, state);
    const closes: Request[] = [];
    let readsAtRefusal = 0;
    await page.route("**/api/v1/cash/closes?**", async (route, request) => {
      if (request.method() !== "POST") {
        await route.fallback();
        return;
      }
      closes.push(request);
      if (closes.length === 1) {
        readsAtRefusal = reads();
        await route.fulfill({ status: 422, json: stale(countedAt) });
        return;
      }
      await route.fulfill({ status: 201, json: closeOf() });
    });
    // The count may open before «Каса»'s own screen is seen.
    await cash(page, false);
    await expect(
      page.getByRole("heading", { name: "Підрахунок каси" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(recountWords);
    // Opened on the drawer read again after the refusal.
    expect(reads()).toBeGreaterThan(readsAtRefusal);
    const field = page.getByLabel("Скільки готівки в касі зараз");
    await expect(field).toHaveValue("");
    expect(
      await page.evaluate((stored) => localStorage.getItem(stored), key),
    ).toBeNull();
    // Left, it does not open again by itself, nor when «Каса» is opened
    // again from another tab.
    await page.getByRole("button", { name: "Назад до каси" }).click();
    await expect(
      page.getByRole("heading", { name: "Каса", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Продаж", exact: true }).click();
    // What «Каса» reads when opened again: a row to know the read has come.
    state.now = drawer({ movements: [seen] });
    await section(page, "Каса");
    await expect(page.getByText("після відмови")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Підрахунок каси" }),
    ).toHaveCount(0);
    // Counted again: a command of its own, its own sum and moment.
    await card(page).click();
    await field.fill("2000");
    await page
      .getByRole("button", { name: "Закрити касу", exact: true })
      .click();
    await confirmClose(page);
    await expect(
      page.getByRole("heading", { name: "Касу закрито" }),
    ).toBeVisible();
    const [late, again] = closes.map(
      (request) =>
        request.postDataJSON() as {
          command_id: string;
          counted: string;
          counted_at: string;
        },
    );
    if (!late || !again) throw new Error("not sent");
    expect(again.command_id).not.toBe(late.command_id);
    expect(again.counted).toBe("2000.00");
    expect(Date.parse(again.counted_at)).toBeGreaterThan(Date.parse(countedAt));
  });

for (const [name, now, counted, before, after] of [
  [
    "counted on an earlier day",
    at("20:30"),
    at("20:00", "2026-10-21"),
    drawer(),
    drawer({ movements: [seen] }),
  ],
  [
    "counted at 05:50, refused at 06:10 — another day of the drawer",
    at("06:10"),
    at("05:50"),
    drawer(),
    drawer({ movements: [seen] }),
  ],
  // The nights the clocks change: six hours back from 05:50 and from 06:10
  // is one date, an hour off the clock's.
  [
    "counted at 05:50, refused at 06:10 the night the clocks go back (Kyiv, 2026-10-25) — another day of the drawer",
    new Date("2026-10-25T06:10:00+02:00"),
    new Date("2026-10-25T05:50:00+02:00"),
    drawer(),
    drawer({ movements: [seen] }),
  ],
  [
    "counted at 05:50, refused at 06:10 the night the clocks go forward (Kyiv, 2027-03-28) — another day of the drawer",
    new Date("2027-03-28T06:10:00+03:00"),
    new Date("2027-03-28T05:50:00+03:00"),
    drawer(),
    drawer({ movements: [seen] }),
  ],
  [
    "counted today, the drawer closed meanwhile on another phone",
    at("20:30"),
    at("20:15"),
    drawer({
      closed_today: true,
      last_close: {
        ...lastClose,
        id: randomUUID(),
        closed_at: at("20:20").toISOString(),
      },
    }),
    drawer({
      closed_today: true,
      last_close: {
        ...lastClose,
        id: randomUUID(),
        closed_at: at("20:20").toISOString(),
      },
      movements: [seen],
    }),
  ],
  [
    "counted today, the drawer found closed on the read after the refusal",
    at("20:30"),
    at("20:15"),
    drawer(),
    drawer({
      closed_today: true,
      last_close: {
        ...lastClose,
        id: randomUUID(),
        closed_at: at("20:20").toISOString(),
      },
      movements: [seen],
    }),
  ],
] as const)
  test(`a kept count that came too late, ${name}, says to close as usual and opens nothing (owner decision, 2026-10-21, В3)`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(now);
    const countedAt = counted.toISOString();
    await keep(page, {
      command: "close",
      counted: "1990.00",
      counted_at: countedAt,
      after_close_id: lastClose.id,
    });
    const state: { now: Drawer } = { now: before };
    await stubDrawer(page, state);
    const drawn = await recordHeadings(page);
    await page.route("**/api/v1/cash/closes?**", async (route, request) => {
      if (request.method() !== "POST") {
        await route.fallback();
        return;
      }
      // What the drawer says when read after the refusal.
      state.now = after;
      await route.fulfill({ status: 422, json: stale(countedAt) });
    });
    await cash(page);
    await expect(page.getByRole("alert")).toHaveText(asUsual);
    // The read after the refusal has come, and still «Каса» itself.
    await expect(page.getByText("після відмови")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Каса", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Підрахунок каси" }),
    ).toHaveCount(0);
    // Not even for a moment, on the read still under way.
    expect(await drawn()).not.toContain("Підрахунок каси");
  });

test("a kept count that came too late the same evening opens nothing while the drawer cannot be read, and opens the count once it is read again (G26; owner decision, 2026-10-21, В3)", async ({
  page,
}) => {
  await page.clock.setFixedTime(at("20:30"));
  const countedAt = at("20:15").toISOString();
  await keep(page, {
    command: "close",
    counted: "1990.00",
    counted_at: countedAt,
    after_close_id: lastClose.id,
  });
  const state: { now: Drawer; lost?: boolean } = { now: drawer() };
  await stubDrawer(page, state);
  await page.route("**/api/v1/cash/closes?**", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    // The server out of reach for the read after the refusal.
    state.lost = true;
    await route.fulfill({ status: 422, json: stale(countedAt) });
  });
  await cash(page);
  await expect(
    page.getByText(/^Касу зараз не закрити: сервер не відповідає\./),
  ).toBeVisible();
  // Never «Перерахуйте» beside «Касу зараз не закрити».
  await expect(page.getByText(asUsual, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Підрахунок каси" }),
  ).toHaveCount(0);
  state.lost = false;
  await page.getByRole("button", { name: "Спробувати ще раз" }).click();
  await expect(
    page.getByRole("heading", { name: "Підрахунок каси" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(recountWords);
});

test("a count on its first sending says nothing of a server that did not answer, and closes (review, 2026-10-22)", async ({
  page,
}) => {
  await stubDrawer(page, { now: drawer() });
  let arrived = false;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/cash/closes?**", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    arrived = true;
    await held;
    await route.fulfill({ status: 201, json: closeOf() });
  });
  await cash(page);
  await card(page).click();
  await page.getByLabel("Скільки готівки в касі зараз").fill("2000");
  await page.getByRole("button", { name: "Закрити касу", exact: true }).click();
  const yes = page.getByRole("button", { name: "Так, закрити" });
  await confirmClose(page);
  await expect.poll(() => arrived).toBe(true);
  // Drawn with the command under way: no banner yet.
  await expect(yes).toBeDisabled();
  await expect(page.locator("section.notice")).toHaveCount(0);
  await expect(page.getByText(/сервер не відповів/)).toHaveCount(0);
  release();
  await expect(
    page.getByRole("heading", { name: "Касу закрито" }),
  ).toBeVisible();
  await expect(page.locator("section.notice")).toHaveCount(0);
});
