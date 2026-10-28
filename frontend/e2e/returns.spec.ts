import {
  test,
  expect,
  more,
  openStore,
  returnUnits,
  section,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
  bin_location_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

interface ReturnBody {
  command_id: string;
  lines: {
    sale_item_id: string;
    quantity: number;
    restock: boolean;
    condition: string;
  }[];
  reason: string | null;
  payment_method?: string;
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

function launch(): string {
  return `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`;
}

/**
 * A coat of a model of this test's own — so the list's search finds exactly
 * its sale — received into the returns warehouse and sold, through the API,
 * paid `way`.
 */
async function sold(
  page: Page,
  quantity: number,
  way: "CASH" | "CARD" | "TRANSFER" = "CASH",
): Promise<{ model: string; variant: string; size: string; token: string }> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token: token } = (await auth.json()) as {
    access_token: string;
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    "Idempotency-Key": randomUUID(),
  };
  const model = `Повернення ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers,
    data: {
      store_id: fixture.store_id,
      concept: model,
      variant: { color: "графіт" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
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
  expect(received.status()).toBe(201);
  const sale = await page.request.post("/api/v1/sales", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: {
      store_id: fixture.store_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: variant,
          size_id: size,
          source_location_id: fixture.returns_location_id,
          quantity,
          unit_price: "3000.00",
        },
      ],
      payment_method: way,
    },
  });
  expect(sale.status()).toBe(201);
  return { model, variant, size, token };
}

async function held(
  page: Page,
  token: string,
  location: string,
  variant: string,
): Promise<number> {
  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.store_id}&location_id=${location}&limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const { items } = (await response.json()) as {
    items: { product_variant_id: string; quantity: number }[];
  };
  return items.find((i) => i.product_variant_id === variant)?.quantity ?? 0;
}

/** The returns tab, searched down to one model's sales. */
async function find(page: Page, model: string): Promise<void> {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Повернення");
  await page.getByLabel("Що повертають?").fill(model);
  await page.getByLabel("Що повертають?").press("Enter");
  await expect(page.getByRole("article")).toHaveCount(1);
}

function returns(page: Page): { bodies: ReturnBody[]; keys: string[] } {
  const seen = { bodies: [] as ReturnBody[], keys: [] as string[] };
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/refunds")) {
      seen.bodies.push(request.postDataJSON() as ReturnBody);
      seen.keys.push(request.headers()["idempotency-key"] ?? "");
    }
  });
  return seen;
}

test("one coat back intact goes where it was sold, one damaged to the store's «Брак»", async ({
  page,
}) => {
  const { model, variant, token } = await sold(page, 2, "CARD");
  const before = await held(page, token, fixture.returns_location_id, variant);
  const sent = returns(page);
  await find(page, model);
  await expect(page.getByRole("article")).toContainText(model);
  // The list a seller pages through never says how a sale was paid (G32).
  await expect(page.getByRole("article")).not.toContainText(/картк/i);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  // A tag, as at the till: «Назва · M», its price «за 1 шт.» (sale-slice TZ,
  // P2-2) and what may come back, in units (returns task list, P0-3).
  await expect(
    page.getByRole("heading", { name: new RegExp(`^${model}.* · M$`) }),
  ).toBeVisible();
  await expect(page.locator(".line-return .hint")).toContainText(
    / за 1 шт\. · можна повернути 2 шт\.$/,
  );
  // Nothing counted, nothing to press: the state of each unit is the
  // seller's to name (owner decisions, 2026-09-15, §3).
  await expect(page.locator(".line-return .return-count")).toHaveText([
    "0",
    "0",
  ]);
  await expect(page.getByRole("button", { name: /Повернути/ })).toHaveCount(0);

  await returnUnits(page, { intact: 1, damaged: 1 });
  // The reason only when the seller has one.
  await expect(
    page.getByLabel("Причина повернення (необов’язково)"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Додати причину" }).click();
  await expect(
    page.getByLabel("Причина повернення (необов’язково)"),
  ).toBeFocused();
  await expect(
    page.getByLabel("Причина повернення (необов’язково)"),
  ).toHaveAccessibleDescription("Без імен і телефонів покупців.");
  await page
    .getByLabel("Причина повернення (необов’язково)")
    .fill("не підійшов");
  // The money goes back the way the sale was paid unless the seller changes
  // it (owner decision, 2026-10-04): a card sale, returned in cash.
  const way = page.getByRole("group", {
    name: "Як повертаємо гроші",
    exact: true,
  });
  await expect(way.getByRole("radio", { name: "На картку" })).toBeChecked();
  await expect(
    page.getByRole("button", {
      name: "Повернути покупцю 6 000,00 грн на картку",
    }),
  ).toBeVisible();
  await way.getByRole("radio", { name: "Готівкою" }).check();
  await page
    .getByRole("button", {
      name: "Повернути покупцю 6 000,00 грн готівкою",
      exact: true,
    })
    .click();

  // The result, in place of the form (returns task list, P0-5): the sum to
  // hand back, large, the way over it; heard as one sentence.
  await expect(
    page.getByRole("heading", { name: "Повернення записано" }),
  ).toBeVisible();
  await expect(page.getByText("Готівка · Поверніть покупцю")).toBeVisible();
  await expect(page.locator(".hand-back-sum")).toHaveText("6 000,00 грн");
  await expect(
    page.getByText("Поверніть покупцю 6 000,00 грн готівкою.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Цілі: 1 шт. — на склад, з якого продали.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Пошкоджені: 1 шт. — у «Брак». Перевірити можна в розділі «Брак».",
      { exact: true },
    ),
  ).toBeVisible();
  // How a mistake is mended (owner decision, 2026-10-17, В2 (а); P1-5).
  await expect(
    page.getByText(
      "Помилилися з поверненням? Продайте ці речі знову на касі; пошкоджене спершу поверніть у продаж у «Браку».",
      { exact: true },
    ),
  ).toBeVisible();
  expect(sent.bodies).toHaveLength(1);
  expect(sent.bodies[0]?.lines.map((l) => l.condition).sort()).toEqual([
    "DAMAGED",
    "INTACT",
  ]);
  expect(sent.bodies[0]?.reason).toBe("не підійшов");
  expect(sent.bodies[0]?.payment_method).toBe("CASH");
  // The store and the sale are the journal's own, never sent.
  expect(Object.keys(sent.bodies[0] ?? {}).sort()).toEqual([
    "command_id",
    "lines",
    "payment_method",
    "reason",
  ]);

  expect(await held(page, token, fixture.returns_location_id, variant)).toBe(
    before + 1,
  );
  expect(await held(page, token, fixture.bin_location_id, variant)).toBe(1);
  // «Ще повернення»: the list, its search as it was.
  await page.getByRole("button", { name: "Ще повернення" }).click();
  await expect(page.getByLabel("Що повертають?")).toHaveValue(model);
  await expect(page.getByRole("article")).toContainText("повернено 2 шт.");
  await expect(page.getByText("Усе вже повернено")).toBeVisible();
});

test("the counts stop at what may still come back, and nothing is sent before the press", async ({
  page,
}) => {
  const { model } = await sold(page, 2);
  const sent = returns(page);
  await find(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await expect(
    page.getByRole("button", { name: "Цілі: менше" }),
  ).toBeDisabled();
  await returnUnits(page, { intact: 2 });
  // Both states share what is left: two intact leave room for none damaged.
  await expect(
    page.getByRole("button", { name: "Цілі: більше" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Пошкоджені: більше" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Цілі: менше" }).click();
  await returnUnits(page, { damaged: 1 });
  await expect(
    page.getByRole("button", { name: "Пошкоджені: більше" }),
  ).toBeDisabled();
  await expect(page.locator(".line-return .return-count")).toHaveText([
    "1",
    "1",
  ]);
  // Back to none: the panel goes, and there is nothing to press.
  await page.getByRole("button", { name: "Цілі: менше" }).click();
  await page.getByRole("button", { name: "Пошкоджені: менше" }).click();
  await expect(
    page.getByRole("group", { name: "Повернення: сума і спосіб" }),
  ).toHaveCount(0);
  expect(sent.bodies).toEqual([]);
});

test("a return whose outcome is unknown blocks the app until it is resent unchanged", async ({
  page,
}) => {
  const { model } = await sold(page, 1);
  const sent = returns(page);
  let first = true;
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    if (first) {
      first = false;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await find(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await returnUnits(page, { intact: 1 });
  await page
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();

  // Which customer it is: the goods, the sum and the way the attempt kept
  // beside its body (returns task list, P1-2).
  const banner = page.locator("section.notice", {
    has: page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
  });
  await expect(banner.locator("p").first()).toHaveText(
    new RegExp(
      `^Повернення: ${model}.* · M × 1 · 3\\s000,00\\sгрн готівкою — сервер не відповів\\. Двічі воно не запишеться, і гроші двічі не повернуться\\. Поки чекаємо, інші дії недоступні\\.`,
    ),
  );
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeDisabled();
  // The panel is held as the form is: nothing pressed twice, no way changed.
  const panel = page.getByRole("group", { name: "Повернення: сума і спосіб" });
  await expect(
    panel.getByRole("button", {
      name: "Повернути покупцю 3 000,00 грн готівкою",
    }),
  ).toBeDisabled();
  for (const option of ["Готівкою", "На картку", "Переказом"])
    await expect(panel.getByRole("radio", { name: option })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Цілі: менше" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Перевірити результат повернення" })
    .click();
  await expect(banner).toHaveCount(0);
  expect(sent.bodies).toHaveLength(2);
  // What the banner named is the phone's own: never sent.
  expect(sent.bodies[0]).not.toHaveProperty("shown");
  await expect(
    page.getByRole("heading", { name: "Повернення записано один раз" }),
  ).toBeVisible();
  expect(sent.bodies[1]).toEqual(sent.bodies[0]);
  expect(sent.keys[1]).toBe(sent.keys[0]);
  await expect(
    page.getByRole("button", { name: "Продаж", exact: true }),
  ).toBeEnabled();
  // The settled return still says how to give the money back.
  await expect(
    page.getByText("Поверніть покупцю 3 000,00 грн готівкою."),
  ).toBeVisible();
  // «Повернення» opens afresh: the form that sent it is gone, so it cannot be
  // pressed again and answered as though nothing had been given back yet.
  await expect(
    page.getByRole("button", {
      name: "Повернути покупцю 3 000,00 грн готівкою",
    }),
  ).toHaveCount(0);
  expect(sent.bodies).toHaveLength(2);
});

test("money back on a card goes through the terminal, and a transfer is sent", async ({
  page,
}) => {
  const card = await sold(page, 1, "CARD");
  const sent = returns(page);
  await find(page, card.model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await returnUnits(page, { intact: 1 });
  await expect(
    page.getByRole("radio", { name: "На картку", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", {
      name: "Повернути покупцю 3 000,00 грн на картку",
      exact: true,
    })
    .click();
  // Answered at once: the money goes back now, said plainly (owner
  // decision, 2026-10-08: only a kept return confirmed later hedges it).
  await expect(
    page.getByText("Картка · Поверніть на картку через термінал"),
  ).toBeVisible();
  await expect(page.locator(".hand-back-sum")).toHaveText("3 000,00 грн");
  await expect(
    page.getByText("Поверніть 3 000,00 грн на картку покупця через термінал.", {
      exact: true,
    }),
  ).toHaveCount(1);
  expect(sent.bodies[0]?.payment_method).toBe("CARD");

  // A sale whose way suggests nothing — sold before the way was asked, or in
  // parts paid several ways (G5) — waits for the seller to choose.
  const transfer = await sold(page, 1, "TRANSFER");
  await page.route("**/api/v1/cash/sales/*/method?**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...((await response.json()) as object),
        refund_method: null,
      },
    });
  });
  // A launch link that differs only in its hash would not reload the app.
  await page.goto("about:blank");
  await find(page, transfer.model);
  const asked = page.waitForResponse(
    (r) => r.url().includes("/api/v1/cash/sales/") && r.status() === 200,
  );
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await asked;
  await returnUnits(page, { intact: 1 });
  for (const option of ["Готівкою", "На картку", "Переказом"])
    await expect(
      page.getByRole("radio", { name: option, exact: true }),
    ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Оберіть, як повертаєте гроші" }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: "Переказом", exact: true }).check();
  await page
    .getByRole("button", {
      name: "Повернути покупцю 3 000,00 грн переказом",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Переказ · Надішліть покупцю переказом"),
  ).toBeVisible();
  await expect(
    page.getByText("Надішліть покупцю 3 000,00 грн переказом.", {
      exact: true,
    }),
  ).toHaveCount(1);
  expect(sent.bodies[1]?.payment_method).toBe("TRANSFER");
});

test("a store without a «Брак» is told so, and nothing is returned", async ({
  page,
}) => {
  const { model } = await sold(page, 1);
  await page.route("**/api/v1/sales/*/refunds", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "DAMAGED_RETURNS_UNAVAILABLE",
        message: "The store has no «Брак» warehouse to take damaged goods",
        details: { reason: "NOT_SET_UP" },
      },
    });
  });
  await find(page, model);
  await page.getByRole("button", { name: "Оформити повернення" }).click();
  await returnUnits(page, { damaged: 1 });
  await page
    .getByRole("button", { name: "Повернути покупцю 3 000,00 грн готівкою" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "ще немає складу «Брак» для пошкодженого товару",
  );
  await expect(page.getByRole("alert")).toContainText("Нічого не повернено.");
  await expect(page.getByText("Повернення ще не підтверджено")).toHaveCount(0);
});

test("the search says when no sale has such goods", async ({ page }) => {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Повернення");
  await page.getByLabel("Що повертають?").fill(`немає ${randomUUID()}`);
  await page.getByLabel("Що повертають?").press("Enter");
  await expect(
    page.getByText(/^За «немає .*» продажів не знайдено\./),
  ).toBeVisible();
});

test("taking returns needs its own permission", async ({ page }) => {
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of body.stores)
      store.permissions = store.permissions.filter((p) => p !== "sale:refund");
    await route.fulfill({ response, json: body });
  });
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  // The till, with no way to take a return: no «Повернути», nor a switch
  // (navigation task list, P0-1).
  await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Продаж або повернення" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Повернути", exact: true }),
  ).toHaveCount(0);
  await more(page);
  await expect(
    page.getByRole("button", { name: "Перевірка каталогу", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Повернення", exact: true }),
  ).toHaveCount(0);
});

test("the «Брак» takes no deliveries, and is named in the stock", async ({
  page,
}) => {
  await page.goto(launch());
  await openStore(page, "Основний MAIN");
  await section(page, "Приймання");
  const offered = page.locator(`option[value="${fixture.bin_location_id}"]`);
  await expect(offered).toHaveAttribute("disabled", "");
  await expect(offered).toContainText("брак, лише для повернень");
  await section(page, "Залишки");
  await expect(
    page.locator(`option[value="${fixture.bin_location_id}"]`),
  ).toContainText("брак, не продається");
});
