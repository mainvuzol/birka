import {
  test,
  expect,
  fillLine,
  openStore,
  tapSize,
  sellsFrom,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The till's money and words (sale-slice TZ, P2-1, P2-2, P2-4; owner,
 * 2026-10-17): sums as «12 950,00 грн», their thousands kept together and in
 * even digits, while the price field keeps «1850,50»; one word for a thing
 * — «шт.», and «Кошик» for the lines to pay only; and a refusal the till
 * knows no more of speaks of the sale, never of an order. The goods and the
 * server's answers are stubbed.
 */

interface Fixture {
  telegram_user_id: string;
  store_id: string;
  till_location_id: string;
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
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return fields.toString();
}

const sizeL = randomUUID();

function coat(sizeId: string, label: string): Record<string, unknown> {
  return {
    product_variant_id: fixture.variant_id,
    size_id: sizeId,
    display_name: "Лоран шоколад",
    size_label: label,
    size_is_unknown: false,
    quantity: 9,
    reserved_quantity: 0,
    available_quantity: 9,
    suggested_price: "1850.00",
  };
}

async function onTheTill(page: Page): Promise<void> {
  await page.route("**/api/v1/catalog/stock-options?**", async (route) => {
    await route.fulfill({
      json: {
        items: [coat(fixture.size_id, "M"), coat(sizeL, "L")],
        has_more: false,
      },
    });
  });
  await sellsFrom(page, fixture.till_location_id);
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
}

function pay(page: Page, way: string) {
  return page
    .getByRole("group", { name: "Продати — як платить покупець" })
    .getByRole("button", { name: way, exact: true });
}

/** What the till said of a sale it did not make. */
function refused(page: Page) {
  return page
    .getByRole("alert")
    .filter({ hasText: "Кошик збережено — нічого не продано." });
}

test("sums read «12 950,00 грн», thousands kept together, in even digits, and the price field keeps «1850,50»", async ({
  page,
}) => {
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        id: randomUUID(),
        store_id: fixture.store_id,
        currency_code: "UAH",
        subtotal: "12953.50",
        discount_total: "0.00",
        total: "12953.50",
        items: [
          {
            id: randomUUID(),
            product_variant_id: fixture.variant_id,
            size_id: fixture.size_id,
            source_location_id: fixture.till_location_id,
            quantity: 7,
            unit_price: "1850.50",
            discount_amount: "0.00",
            final_unit_price: "1850.50",
            line_total: "12953.50",
            display_name: "Лоран шоколад",
            size: "M",
          },
        ],
        corrections: [],
        shortages: [],
        size_reclassifications: [],
        payment_method: "CASH",
      },
    });
  });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  const total = page.locator(".pay-total");
  const sum = total.locator(".sum");
  // A sum as it first shows does not blink (P0-1).
  await expect(sum).toBeVisible();
  await expect(sum.locator(".sum-flash")).toHaveCount(0);
  await fillLine(page, { quantity: 7 });
  await expect(total).toHaveText("Разом 12 950,00 грн");
  // A regex is not normalised: a no-break space, so «12 950» never splits.
  await expect(total).toHaveText(/^Разом 12\u00a0950,00\u00a0грн$/);
  // Its parts (spec §6.17; P0-1): the figures, then «,00» at 0.55 of them
  // and «грн» at 0.6, held to them by a no-break space.
  await expect(sum.locator(".sum-kop")).toHaveText(",00");
  await expect(sum.locator(".sum-unit")).toHaveText(/^\u00a0грн$/);
  const [whole = 0, kopecks = 0, unit = 0] = await sum.evaluate((node) =>
    [node, node.querySelector(".sum-kop"), node.querySelector(".sum-unit")].map(
      (part) => (part ? parseFloat(getComputedStyle(part).fontSize) : 0),
    ),
  );
  expect(kopecks / whole).toBeCloseTo(0.55, 2);
  expect(unit / whole).toBeCloseTo(0.6, 2);
  // Changed under the eye: the fold behind it, faded out by 400 ms.
  await expect(sum.locator(".sum-flash")).toHaveCount(1);
  await expect(sum.locator(".sum-flash")).toHaveCSS("opacity", "0");
  expect(
    await total
      .locator(".sum")
      .evaluate((sum) => getComputedStyle(sum).fontVariantNumeric),
  ).toBe("tabular-nums");
  await expect(
    page.getByText("Ціна продажу 1\u00a0850,00 грн. Домовилися про іншу"),
  ).toBeVisible();

  // Typed as before, without a space.
  const price = page.locator(".line").getByLabel("Ціна, грн");
  await price.fill("1850,50");
  await expect(price).toHaveValue("1850,50");
  await expect(total).toHaveText(/^Разом 12\u00a0953,50\u00a0грн$/);

  await pay(page, "Готівка").click();
  await expect(
    page.getByRole("heading", { name: "Продаж записано" }),
  ).toBeVisible();
  await expect(page.locator(".line span")).toHaveText(
    /^7 × 1\u00a0850,50\u00a0грн$/,
  );
  await expect(page.locator(".stub-sum")).toHaveText(/12\u00a0953,50\u00a0грн/);
});

test("where motion is reduced a changed sum shows no fold behind it (spec §5.8; P0-1)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await fillLine(page, { quantity: 7 });
  const sum = page.locator(".pay-total .sum");
  await expect(sum).toHaveText("12 950,00 грн");
  await expect(sum.locator(".sum-flash")).toHaveCount(1);
  await expect(sum.locator(".sum-flash")).toBeHidden();
});

test("the basket of two lines counts «шт.», and «Кошик» names no more than the lines", async ({
  page,
}) => {
  await onTheTill(page);
  await expect(
    page.getByText("Кошик порожній — знайдіть модель угорі."),
  ).toBeVisible();
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await tapSize(page, fixture.variant_id, sizeL);
  await fillLine(page, { quantity: 2 });
  await expect(page.locator(".pay-what")).toHaveText("У кошику: 3 шт.");
  // «Кошик» names the lines to pay; the form around the warehouse, the
  // search and the lines is not it.
  await expect(
    page.getByRole("group", { name: "Кошик", exact: true }).locator(".line"),
  ).toHaveCount(2);
  await expect(page.getByText("Кошик", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/(^|\s)од\./)).toHaveCount(0);
});

test("a shelf short of what an order holds says how many are free of it, in «шт.»", async ({
  page,
}) => {
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        code: "INSUFFICIENT_STOCK",
        message: "Not enough stock for this operation",
        details: {
          location_id: fixture.till_location_id,
          product_variant_id: fixture.variant_id,
          size_id: fixture.size_id,
          requested: 2,
          available: 1,
          correctable: false,
          reserved: true,
        },
      },
    });
  });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await fillLine(page, { quantity: 2 });
  await pay(page, "Готівка").click();
  await expect(
    page
      .getByRole("alert", { name: "Залишку не вистачає" })
      .getByText("Лоран шоколад · M:"),
  ).toHaveText(
    "Лоран шоколад · M: у кошику 2 шт., в обліку 1 шт. поза резервом замовлення.",
  );
});

test("a conflict the till knows no more of says to try again, and a request it could not read to check the goods, the count and the price — never an order", async ({
  page,
}) => {
  let answer: { status: number; json: object } = {
    status: 409,
    json: {
      code: "IDEMPOTENCY_CONFLICT",
      message: "This idempotency key was already used with a different request",
      details: {},
    },
  };
  await page.route("**/api/v1/sales", async (route) => {
    await route.fulfill(answer);
  });
  await onTheTill(page);
  await tapSize(page, fixture.variant_id, fixture.size_id);
  await pay(page, "Готівка").click();
  await expect(refused(page)).toHaveText(
    "Дані змінилися, поки ви працювали. Спробуйте ще раз. Кошик збережено — нічого не продано.",
  );
  await expect(refused(page)).not.toContainText(/замовлен/);

  answer = {
    status: 422,
    json: {
      code: "VALIDATION_ERROR",
      message: "Request failed validation",
      details: {},
    },
  };
  await pay(page, "Готівка").click();
  await expect(refused(page)).toHaveText(
    "Перевірте товар, кількість і ціну. Кошик збережено — нічого не продано.",
  );
  await expect(refused(page)).not.toContainText(/замовлен/);
  // The basket is kept as it was.
  await expect(page.locator(".line")).toHaveCount(1);
});
