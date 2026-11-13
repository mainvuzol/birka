import {
  test,
  expect,
  dockOnMenu,
  expectStub,
  fillLine,
  openStore,
  tapSize,
  sellsFrom,
  shortage,
} from "./fixtures";
import type { Page, Request } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Nothing on the shelf (owner decisions, 2026-10-01; Q-G).
 *
 * A line with nothing on the shelf is dropped and its shortage recorded, and
 * the rest is sold; when nothing is left to sell, the shortage is recorded
 * without a sale. Each test sells models of its own, received into the
 * returns warehouse, so no other journey's shelf changes.
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  returns_location_id: string;
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
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

interface Model {
  name: string;
  variant: string;
  option: string;
}

/** A model of this test's own, `held` of it in the returns warehouse. */
async function model(page: Page, held: number): Promise<Model> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token: token } = (await auth.json()) as {
    access_token: string;
  };
  const name = `Полиця ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: name,
      variant: { color: "сірий" },
      sizes: [{ system: "ALPHA", code: "M" }],
    },
  });
  expect(created.status()).toBe(201);
  const product = (await created.json()) as {
    product_variant_id: string;
    sizes: { size_id: string }[];
  };
  const size = product.sizes[0]?.size_id ?? "";
  const received = await page.request.post("/api/v1/inventory/receipts", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      location_id: fixture.returns_location_id,
      command_id: randomUUID(),
      lines: [
        {
          product_variant_id: product.product_variant_id,
          size_id: size,
          quantity: held,
          acquisition_type: "PURCHASE",
          unit_cost: null,
        },
      ],
      notes: null,
    },
  });
  expect(received.status()).toBe(201);
  return {
    name,
    variant: product.product_variant_id,
    option: `${product.product_variant_id}:${size}`,
  };
}

async function till(page: Page): Promise<void> {
  await sellsFrom(page, fixture.returns_location_id);
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await page.getByRole("button", { name: "Продаж", exact: true }).click();
}

async function add(page: Page, coat: Model, quantity: number): Promise<void> {
  const [variant = "", size = ""] = coat.option.split(":");
  await tapSize(page, variant, size);
  await fillLine(page, { quantity, price: "2000" });
}

async function held(page: Page, coat: Model): Promise<number> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  const { access_token: token } = (await auth.json()) as {
    access_token: string;
  };
  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.store_id}&location_id=${fixture.returns_location_id}&limit=100&offset=0`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const { items } = (await response.json()) as {
    items: { product_variant_id: string; quantity: number }[];
  };
  return (
    items.find((i) => i.product_variant_id === coat.variant)?.quantity ?? 0
  );
}

test("a line with nothing on the shelf is dropped, and the rest is sold", async ({
  page,
}) => {
  const empty = await model(page, 2);
  const there = await model(page, 1);
  const sent: { lines: unknown[]; missing_in_store: unknown[] }[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/sales"))
      sent.push(
        request.postDataJSON() as {
          lines: unknown[];
          missing_in_store: unknown[];
        },
      );
  });
  await till(page);
  await add(page, empty, 3);
  await add(page, there, 1);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await shortage(page);

  await page
    .getByRole("button", {
      name: "На полиці немає жодної — продати решту · Готівка",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.getByText(`${there.name} сірий`)).toBeVisible();
  await expect(
    page.getByText(`Не продано — на полиці не було: ${empty.name} сірий · M.`),
  ).toBeVisible();
  await expectStub(page, {
    way: "Готівка",
    say: "У касу",
    sum: "2 000,00 грн",
  });
  expect(sent[1]?.missing_in_store).toEqual([{ line_index: 0, quantity: 0 }]);
  // The two the ledger believed in were taken off; the one there was sold.
  expect(await held(page, empty)).toBe(0);
  expect(await held(page, there)).toBe(0);
});

test("a basket with nothing on the shelf records the shortage and sells nothing: at 360 the record a stub torn off, «Новий продаж» in the receipt's dock (audit after stage 2, sale P2-3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const empty = await model(page, 1);
  const recorded: Request[] = [];
  page.on("request", (request: Request) => {
    if (request.url().endsWith("/api/v1/shelf-shortages"))
      recorded.push(request);
  });
  await till(page);
  await add(page, empty, 2);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await shortage(page);
  await page
    .getByRole("button", {
      // Records an empty shelf, takes no money: no way is named.
      name: "На полиці немає жодної — записати нестачу",
      exact: true,
    })
    .click();

  await expect(
    page.getByRole("heading", { name: "Продажу немає" }),
  ).toBeVisible();
  await expect(
    page.locator(".nothing-sold .result-body > p").first(),
  ).toHaveText("Нічого з кошика не було на полиці.");
  // The shortage the server recorded, on a stub torn off, its eyelet
  // filled (spec §6.30, P3).
  const stub = page.locator(".nothing-sold .stub");
  await expect(stub).toHaveClass(/\bstub-recorded\b/);
  await expect(stub.locator(".eyelet")).toBeVisible();
  await expect(
    stub.getByRole("heading", { name: "Нестачу записано" }),
  ).toBeVisible();
  await expect(stub.locator(".line")).toHaveCount(1);
  await expect(stub.locator(".line span")).toHaveText("Знято з обліку: 1 шт.");
  // What to do, one line under it.
  const hint = page.locator(".nothing-sold .result-body > .hint");
  await expect(hint).toHaveText("Перевірте склад із менеджером.");
  const line = await hint.evaluate((node) =>
    parseFloat(getComputedStyle(node).lineHeight),
  );
  expect((await hint.boundingBox())?.height ?? 0).toBeLessThanOrEqual(line + 1);
  // Under the thumb, as the receipt's: the screen's one main in its dock,
  // on the screen's field of 16.
  const dock = page.locator(".nothing-sold .result-dock");
  const next = dock.getByRole("button", { name: "Новий продаж" });
  await expect(next).toHaveClass(/\bprimary\b/);
  await expect(next).toBeInViewport({ ratio: 1 });
  await expect(page.locator("main button.primary:visible")).toHaveCount(1);
  const docked = await dock.boundingBox();
  expect(Math.round(docked?.x ?? 0)).toBe(16);
  expect(Math.round((docked?.x ?? 0) + (docked?.width ?? 0))).toBe(344);
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", 360);
  // At the menu's top however short, the page still (audit 2026-11-13, sale
  // P1-2).
  await dockOnMenu(page);
  await page.screenshot({ path: "test-results/nothing-sold-360.png" });
  // In both themes the slip and the dock white on the paper.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const [slip, bottom, card, paper] = await stub.evaluate((node) => {
      const probe = document.createElement("span");
      document.body.append(probe);
      probe.style.color = "var(--card)";
      const white = getComputedStyle(probe).color;
      probe.style.color = "var(--paper)";
      const ground = getComputedStyle(probe).color;
      probe.remove();
      const dockOf = document.querySelector(".nothing-sold .result-dock");
      return [
        getComputedStyle(node).backgroundColor,
        dockOf ? getComputedStyle(dockOf).backgroundColor : "",
        white,
        ground,
      ];
    });
    expect([slip, bottom]).toEqual([card, card]);
    expect(card).not.toBe(paper);
  }
  await page.emulateMedia({ colorScheme: "light" });
  expect(recorded).toHaveLength(1);
  expect(await held(page, empty)).toBe(0);
  await page.getByRole("button", { name: "Новий продаж" }).click();
  // The next customer's search, ready (redesign P0-3).
  await expect(
    page.getByRole("searchbox", { name: "Знайти модель" }),
  ).toBeFocused();
  // An empty basket offers none of the three ways to sell, nor their panel
  // (redesign direction §5).
  await expect(
    page.getByRole("group", { name: "Продати — як платить покупець" }),
  ).toHaveCount(0);
});

test("an empty shelf whose answer was lost is checked, and not recorded twice", async ({
  page,
}) => {
  const empty = await model(page, 1);
  let calls = 0;
  await page.route("**/api/v1/shelf-shortages", async (route) => {
    calls += 1;
    if (calls === 1) {
      // Recorded on the server, and the answer lost on the way back.
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await till(page);
  await add(page, empty, 2);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await shortage(page);
  await page
    .getByRole("button", {
      // Records an empty shelf, takes no money: no way is named.
      name: "На полиці немає жодної — записати нестачу",
      exact: true,
    })
    .click();
  // An empty shelf kept: said as one, not as a sale (redesign P1-4).
  await expect(
    page.getByRole("heading", { name: "Запис нестачі ще не підтверджено" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Сервер не відповів. Двічі нестача не запишеться. Поки чекаємо, інші дії недоступні.",
    ),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Перевірити результат продажу" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Продажу не було" }),
  ).toBeVisible();
  expect(calls).toBe(2);
  expect(await held(page, empty)).toBe(0);
});

test("whoever may not report goods missing is not offered the empty shelf", async ({
  page,
}) => {
  const empty = await model(page, 1);
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of me.stores)
      store.permissions = store.permissions.filter(
        (permission) => permission !== "inventory:report_missing_during_sale",
      );
    await route.fulfill({ response, json: me });
  });
  await till(page);
  await add(page, empty, 2);
  await page.getByRole("button", { name: "Готівка", exact: true }).click();
  await shortage(page);
  await expect(
    page.getByRole("button", { name: /На полиці немає жодної/ }),
  ).toHaveCount(0);
});
