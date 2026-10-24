import { test, expect, more, openStore, section } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Початкові залишки»: the shops' existing stock, entered as a list (owner
 * decision, 2026-10-01; ADR-0005). A list is typed line by line, each line
 * answered by a person, and the whole list approved into the opening balance
 * of a warehouse nothing has moved in yet — which the seed has exactly one
 * of, so the approving journey runs once per seed.
 */
interface Fixture {
  telegram_user_id: string;
  store_id: string;
  location_id: string;
  opening_location_id: string;
  waiting_location_id: string;
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

async function token(page: Page): Promise<string> {
  const auth = await page.request.post("/api/v1/auth/telegram", {
    data: { init_data: initData() },
  });
  return ((await auth.json()) as { access_token: string }).access_token;
}

/** A name with no digits in it: a digit could be read as a count. */
function word(): string {
  const letters = "абвгдежзиклмнопрстуфхцчшщ";
  return Array.from(randomBytes(8), (b) =>
    letters.charAt(b % letters.length),
  ).join("");
}

/** A model of this test's own, in sizes M and L, held nowhere. */
async function model(page: Page): Promise<string> {
  const name = `Ліст ${word()}`;
  const created = await page.request.post("/api/v1/catalog/products", {
    headers: {
      Authorization: `Bearer ${await token(page)}`,
      "Idempotency-Key": randomUUID(),
    },
    data: {
      store_id: fixture.store_id,
      concept: name,
      variant: { color: "сірий" },
      sizes: [
        { system: "ALPHA", code: "M" },
        { system: "ALPHA", code: "L" },
      ],
    },
  });
  expect(created.status()).toBe(201);
  return name;
}

/**
 * No list waits at this warehouse when a journey starts one there: the app
 * offers no second list for a warehouse whose list waits (owner decision,
 * 2026-10-08; ADR-0014 §7), and a journey run before may have left one.
 */
async function noListWaits(page: Page, location: string): Promise<void> {
  const headers = { Authorization: `Bearer ${await token(page)}` };
  const lists = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&location_id=${location}&status=IN_REVIEW&limit=100`,
    { headers },
  );
  const { items } = (await lists.json()) as {
    items: { snapshot_id: string }[];
  };
  for (const list of items) {
    const rejected = await page.request.post(
      `/api/v1/snapshots/${list.snapshot_id}/reject`,
      { headers, data: { reason: "лишився від іншого прогону" } },
    );
    expect(rejected.ok()).toBe(true);
  }
}

async function openings(page: Page): Promise<void> {
  await page.goto(
    `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
  );
  await openStore(page, "Основний MAIN");
  await section(page, "Початкові залишки");
}

async function typeList(
  page: Page,
  location: string,
  source: string,
  lines: string[],
): Promise<void> {
  await page.getByRole("button", { name: "Новий список" }).click();
  await page.getByLabel("Склад").selectOption(location);
  await page.getByLabel("Звідки список (необов’язково)").fill(source);
  await page
    .getByLabel("Рядки списку — кожен товар з нового рядка, як написано")
    .fill(lines.join("\n"));
}

async function pick(page: Page, form: string, name: string): Promise<void> {
  const editor = page.getByRole("form", { name: form });
  await editor.getByLabel("Пошук у каталозі").fill(name);
  await editor.getByRole("button", { name: "Знайти" }).click();
  await editor.getByRole("radio", { name: `${name} сірий` }).click();
}

test("a list is typed, each line answered, and approved into opening stock", async ({
  page,
}) => {
  const coat = await model(page);
  await openings(page);
  await typeList(page, fixture.opening_location_id, "Зошит 1", [
    `${coat} сірий 3 шт`,
    "",
    `${coat} сірий`,
    "Разом по сторінці",
  ]);
  await expect(page.getByText("Рядків: 3. Порожні рядки")).toBeVisible();
  await page.getByRole("button", { name: "Зберегти список" }).click();

  await expect(page.getByRole("heading", { name: "Зошит 1" })).toBeVisible();
  await page.getByRole("button", { name: "Усі", exact: true }).click();

  // What the line states is offered as it is, and nothing more.
  await page
    .getByRole("article", { name: "Рядок 1" })
    .getByRole("button", { name: "Розібрати рядок" })
    .click();
  const first = page.getByRole("form", { name: "Розбір рядка 1" });
  await expect(first.getByLabel("Як у списку: 3 шт")).toBeChecked();
  await expect(
    first.getByLabel("Рядок без кількості — одна штука"),
  ).toHaveCount(0);
  await pick(page, "Розбір рядка 1", coat);
  await first.getByLabel("Розмір").selectOption({ label: "M" });
  await expect(first.getByLabel("Кількість")).toHaveValue("3");
  await expect(first.getByLabel("Кількість")).toBeDisabled();
  await first.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(
    page.getByRole("article", { name: "Рядок 1" }).getByText("Розібрано"),
  ).toBeVisible();

  // A line with no count may be taken as one piece, its size not known.
  await page
    .getByRole("article", { name: "Рядок 2" })
    .getByRole("button", { name: "Розібрати рядок" })
    .click();
  const second = page.getByRole("form", { name: "Розбір рядка 2" });
  await expect(
    second.getByLabel("Рядок без кількості — одна штука"),
  ).toBeChecked();
  await pick(page, "Розбір рядка 2", coat);
  await second.getByLabel("Розмір").selectOption({ label: "Розмір невідомий" });
  await second.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(
    page
      .getByRole("article", { name: "Рядок 2" })
      .getByText(`→ ${coat} сірий, розмір невідомий × 1`),
  ).toBeVisible();

  // And a line that is not stock says why.
  await page
    .getByRole("article", { name: "Рядок 3" })
    .getByRole("button", { name: "Розібрати рядок" })
    .click();
  const third = page.getByRole("form", { name: "Розбір рядка 3" });
  await third.getByLabel("Це не товар").check();
  await third.getByLabel("Чому це не товар").fill("підсумок сторінки");
  await third.getByRole("button", { name: "Зберегти відповідь" }).click();
  await expect(
    page
      .getByRole("article", { name: "Рядок 3" })
      .getByText("Не товар: підсумок сторінки"),
  ).toBeVisible();

  const approval = page.getByLabel("Затвердження списку");
  await expect(
    approval.getByText("Як у списку: рядків 1, одиниць 3"),
  ).toBeVisible();
  await approval.getByRole("button", { name: "Затвердити список" }).click();
  await expect(approval.getByText("Скасувати це потім не можна")).toBeVisible();
  await approval.getByRole("button", { name: "Так, затвердити" }).click();
  await expect(
    page.getByText(
      "Затверджено: 4 од. стали початковим залишком складу «Новий склад».",
    ),
  ).toBeVisible();

  const response = await page.request.get(
    `/api/v1/catalog/stock-options?store_id=${fixture.store_id}&location_id=${fixture.opening_location_id}&limit=100&offset=0`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  const { items } = (await response.json()) as {
    items: {
      display_name: string;
      size_label: string;
      size_is_unknown: boolean;
      quantity: number;
    }[];
  };
  expect(
    items
      .filter((item) => item.display_name === `${coat} сірий`)
      .map((item) => [
        item.size_is_unknown ? "?" : item.size_label,
        item.quantity,
      ])
      .sort(),
  ).toEqual([
    ["?", 1],
    ["M", 3],
  ]);
});

/** The next command sent to `pattern` (never a read of it) answered as
 * `answer` says, once: a form the server does not name (422), a conflict
 * (409), or any answer of its own. */
async function refuseOnce(
  page: Page,
  pattern: string,
  answer: "form" | "conflict" | { status: number; json: object },
): Promise<void> {
  let used = false;
  await page.route(pattern, async (route) => {
    if (used || route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    used = true;
    await route.fulfill(
      answer === "form"
        ? {
            status: 422,
            json: {
              code: "VALIDATION_ERROR",
              message: "Request failed validation",
              details: {},
            },
          }
        : answer === "conflict"
          ? {
              status: 409,
              json: { code: "CONFLICT", message: "Conflict", details: {} },
            }
          : answer,
    );
  });
}

/** How many times the list's `what` («lines», «parts») was read. */
function reads(page: Page, what: string): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      new URL(request.url()).pathname.endsWith(`/${what}`)
    )
      count += 1;
  });
  return () => count;
}

test("a new list refused for a reason the screen does not name says so by what was sent; lines past what the server takes at once are said before sending", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  await openings(page);
  await typeList(page, fixture.opening_location_id, "Зошит нового списку", [
    `${coat} сірий 3 шт`,
  ]);
  const save = page.getByRole("button", { name: "Зберегти список" });
  const listReads = reads(page, "snapshots");
  await refuseOnce(page, "**/api/v1/snapshots", "form");
  await save.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Список не збережено. Перевірте рядки та спробуйте ще раз.",
  );
  await refuseOnce(page, "**/api/v1/snapshots", "conflict");
  await save.click();
  const before = listReads();
  await expect(page.getByRole("alert")).toHaveText(
    "Список не збережено. Поки ви працювали, дані змінилися — спробуйте ще раз.",
  );
  // The warehouse read again: a list made meanwhile is found.
  await expect.poll(listReads).toBeGreaterThan(before);
  // A notebook pasted whole: more lines than one part takes.
  const text = page.getByLabel(
    "Рядки списку — кожен товар з нового рядка, як написано",
  );
  await text.fill(
    Array.from({ length: 1001 }, (_, i) => `${coat} сірий ${String(i)}`).join(
      "\n",
    ),
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /^Рядків: 1\s001, а за раз їх беруть/ }),
  ).toHaveText(
    /^Рядків: 1\s001, а за раз їх беруть не більше 1\s000\. Розділіть: решту додайте до списку через «Додати рядки вручну»\.$/,
  );
  await expect(save).toBeDisabled();
  await text.fill(`${coat} сірий 3 шт`);
  await save.click();
  await expect(
    page.getByRole("heading", { name: "Зошит нового списку" }),
  ).toBeVisible();
  // Rejected: the warehouse free for the journeys after.
  const approval = page.getByLabel("Затвердження списку");
  await approval.getByRole("button", { name: "Відхилити список" }).click();
  await approval.getByLabel("Чому відхиляємо").fill("перевірка нового списку");
  await approval.getByRole("button", { name: "Так, відхилити" }).click();
  await expect(
    page.getByText(/^Відхилено: перевірка нового списку/),
  ).toBeVisible();
});

test("a list's refusals the server does not name are said in the list's words, never an order's: what was not done, and what to check; a conflict read again", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.opening_location_id);
  await openings(page);
  await typeList(page, fixture.opening_location_id, "Зошит відмов", [
    `${coat} сірий 3 шт`,
  ]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByRole("heading", { name: "Зошит відмов" }),
  ).toBeVisible();
  const lineReads = reads(page, "lines");
  const partReads = reads(page, "parts");

  // A line's answer.
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  await page
    .getByRole("article", { name: "Рядок 1" })
    .getByRole("button", { name: "Розібрати рядок" })
    .click();
  const line = page.getByRole("form", { name: "Розбір рядка 1" });
  // A search no longer than the server reads (review, 2026-10-24).
  await expect(line.getByLabel("Пошук у каталозі")).toHaveAttribute(
    "maxlength",
    "200",
  );
  await pick(page, "Розбір рядка 1", coat);
  await line.getByLabel("Розмір").selectOption({ label: "M" });
  const answer = line.getByRole("button", { name: "Зберегти відповідь" });
  await refuseOnce(page, "**/api/v1/snapshots/*/lines/*", "form");
  await answer.click();
  await expect(line.getByRole("alert")).toHaveText(
    "Відповідь не збережено. Перевірте її та спробуйте ще раз.",
  );
  const before = lineReads();
  await refuseOnce(page, "**/api/v1/snapshots/*/lines/*", "conflict");
  await answer.click();
  await expect(line.getByRole("alert")).toHaveText(
    "Відповідь не збережено. Поки ви працювали, список змінився — перегляньте його й спробуйте ще раз.",
  );
  // Read again, as it says.
  await expect.poll(lineReads).toBeGreaterThan(before);
  // An answer the shared words name keeps them: no access.
  await refuseOnce(page, "**/api/v1/snapshots/*/lines/*", {
    status: 403,
    json: { code: "PERMISSION_DENIED", message: "Forbidden", details: {} },
  });
  await answer.click();
  await expect(line.getByRole("alert")).toHaveText(
    "Немає доступу до цієї операції або складу. Зверніться до менеджера.",
  );
  await answer.click();
  await expect(
    page.getByRole("article", { name: "Рядок 1" }).getByText("Розібрано"),
  ).toBeVisible();

  // Lines typed by hand: too many said first; refused; added, then removed.
  await page.getByRole("button", { name: "Додати рядки вручну" }).click();
  const typing = page.getByRole("form", { name: "Додати рядки вручну" });
  const pasted = typing.getByLabel(/Рядки — кожен товар/);
  const add = typing.getByRole("button", { name: "Додати рядки" });
  await pasted.fill(
    Array.from({ length: 1001 }, (_, i) => `${coat} сірий ${String(i)}`).join(
      "\n",
    ),
  );
  await expect(
    typing.getByRole("alert").filter({ hasText: /^Рядків: 1\s001/ }),
  ).toHaveText(
    /^Рядків: 1\s001, а за раз їх беруть не більше 1\s000\. Розділіть їх на кілька разів\.$/,
  );
  await expect(add).toBeDisabled();
  // Fewer lines, but more characters in all than one part takes.
  await pasted.fill(
    Array.from({ length: 900 }, () => `${coat} сірий ${"x".repeat(120)}`).join(
      "\n",
    ),
  );
  await expect(
    typing.getByRole("alert").filter({ hasText: /^Рядки разом задовгі/ }),
  ).toHaveText(
    /^Рядки разом задовгі: за раз беруть не більше 100\s000 знаків\. Розділіть їх на кілька разів\.$/,
  );
  await expect(add).toBeDisabled();
  await pasted.fill(`${coat} сірий L 1 шт`);
  await refuseOnce(page, "**/api/v1/snapshots/*/parts?**", "form");
  await add.click();
  await expect(typing.getByRole("alert")).toHaveText(
    "Рядки не додано. Перевірте їх та спробуйте ще раз.",
  );
  const partsBefore = partReads();
  await refuseOnce(page, "**/api/v1/snapshots/*/parts?**", "conflict");
  await add.click();
  await expect(typing.getByRole("alert")).toHaveText(
    "Рядки не додано. Поки ви працювали, список змінився — перегляньте його й спробуйте ще раз.",
  );
  await expect.poll(partReads).toBeGreaterThan(partsBefore);
  await add.click();
  const typed = page.getByRole("article", { name: "Файл 2" });
  await expect(typed).toContainText("Рядки, внесені вручну");
  await typed.getByRole("button", { name: "Прибрати рядки" }).click();
  await refuseOnce(page, "**/api/v1/snapshots/*/parts/*/remove?**", "form");
  await typed.getByRole("button", { name: "Так, прибрати" }).click();
  await expect(
    page.getByText("Рядки не прибрано. Спробуйте ще раз.", { exact: true }),
  ).toBeVisible();
  await typed.getByRole("button", { name: "Прибрати рядки" }).click();
  await refuseOnce(page, "**/api/v1/snapshots/*/parts/*/remove?**", "conflict");
  await typed.getByRole("button", { name: "Так, прибрати" }).click();
  await expect(
    page.getByText(
      "Рядки не прибрано. Поки ви працювали, список змінився — перегляньте його й спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  await typed.getByRole("button", { name: "Прибрати рядки" }).click();
  await typed.getByRole("button", { name: "Так, прибрати" }).click();
  await expect(typed).toContainText(/Прибрано: Оля, /);

  // The decision: approved, rejected.
  const approval = page.getByLabel("Затвердження списку");
  const approve = async (): Promise<void> => {
    await approval.getByRole("button", { name: "Затвердити список" }).click();
    await approval.getByRole("button", { name: "Так, затвердити" }).click();
  };
  const reject = async (): Promise<void> => {
    await approval.getByRole("button", { name: "Відхилити список" }).click();
    await approval.getByLabel("Чому відхиляємо").fill("перевірка відмов");
    await approval.getByRole("button", { name: "Так, відхилити" }).click();
  };
  await refuseOnce(page, "**/api/v1/snapshots/*/approve?**", "form");
  await approve();
  await expect(
    approval.getByText("Список не затверджено. Спробуйте ще раз.", {
      exact: true,
    }),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/snapshots/*/approve?**", "conflict");
  await approve();
  await expect(
    approval.getByText(
      "Список не затверджено. Поки ви працювали, список змінився — перегляньте його й спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  // Nothing in it is stock: the server's own answer, said.
  await refuseOnce(page, "**/api/v1/snapshots/*/approve?**", {
    status: 409,
    json: {
      code: "SNAPSHOT_CONFLICT",
      message: "Nothing in this stock list is stock",
      details: { reason: "NOTHING_TO_APPLY" },
    },
  });
  await approve();
  await expect(
    approval.getByText(
      "Список не затверджено: у ньому немає жодного рядка товару. Якщо так і є — відхиліть його.",
      { exact: true },
    ),
  ).toBeVisible();
  await refuseOnce(page, "**/api/v1/snapshots/*/reject?**", "form");
  await reject();
  await expect(
    approval.getByText(
      "Список не відхилено. Перевірте причину та спробуйте ще раз.",
      { exact: true },
    ),
  ).toBeVisible();
  // Rejected meanwhile by someone else for another reason: the server's
  // conflict for it.
  await refuseOnce(page, "**/api/v1/snapshots/*/reject?**", {
    status: 409,
    json: {
      code: "IDEMPOTENCY_CONFLICT",
      message: "This stock list was already rejected for another reason",
      details: {},
    },
  });
  await reject();
  await expect(
    approval.getByText("Цей список уже затвердили або відхилили.", {
      exact: true,
    }),
  ).toBeVisible();
  // And rejected for real: the warehouse free for the journeys after.
  await reject();
  await expect(page.getByText(/^Відхилено: перевірка відмов/)).toBeVisible();
});

test("a split the list does not state asks who counted, and a warehouse with history refuses it", async ({
  page,
}) => {
  const coat = await model(page);
  await noListWaits(page, fixture.location_id);
  await openings(page);
  await typeList(page, fixture.location_id, "Зошит 2", [
    `${coat} сірий M/L 2 шт`,
  ]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await page.getByRole("button", { name: "Усі", exact: true }).click();
  await page
    .getByRole("article", { name: "Рядок 1" })
    .getByRole("button", { name: "Розібрати рядок" })
    .click();
  const editor = page.getByRole("form", { name: "Розбір рядка 1" });

  // Neither "as the list says" nor "one piece": the list states no split.
  await expect(editor.getByLabel(/Як у списку/)).toHaveCount(0);
  await expect(
    editor.getByLabel("Рядок без кількості — одна штука"),
  ).toHaveCount(0);
  await editor.getByLabel("Перелічили").check();
  await pick(page, "Розбір рядка 1", coat);
  await editor.getByLabel("Розмір").selectOption({ label: "M" });
  await editor.getByRole("button", { name: "Ще розмір чи колір" }).click();
  await editor.getByLabel("Розмір").nth(1).selectOption({ label: "L" });
  const save = editor.getByRole("button", { name: "Зберегти відповідь" });
  await expect(save).toBeDisabled();
  await editor.getByLabel("Хто й коли перелічив").fill("Оля, 01.10");
  await save.click();
  await expect(
    page
      .getByRole("article", { name: "Рядок 1" })
      .getByText("Звідки кількість: Перелічили"),
  ).toBeVisible();

  const approval = page.getByLabel("Затвердження списку");
  await approval.getByRole("button", { name: "Затвердити список" }).click();
  await approval.getByRole("button", { name: "Так, затвердити" }).click();
  await expect(
    approval.getByText(
      /уже був рух товару, тому початковий залишок туди внести не можна/,
    ),
  ).toBeVisible();

  await approval.getByRole("button", { name: "Відхилити список" }).click();
  await approval.getByLabel("Чому відхиляємо").fill("склад уже працює");
  await approval.getByRole("button", { name: "Так, відхилити" }).click();
  await expect(
    page.getByText(
      "Відхилено: склад уже працює. Залишків цей список не змінив.",
    ),
  ).toBeVisible();
});

test("a list typed is kept on the phone, and saved once when its answer is lost", async ({
  page,
}) => {
  const coat = await model(page);
  let calls = 0;
  await page.route("**/api/v1/snapshots", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    if (calls === 1) {
      // Saved on the server, and the answer lost on the way back.
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await noListWaits(page, fixture.location_id);
  await openings(page);
  const source = `Зошит ${word()}`;
  await typeList(page, fixture.location_id, source, [`${coat} сірий 1 шт`]);

  // A reload loses nothing typed.
  await page.reload();
  await openStore(page, "Основний MAIN");
  await section(page, "Початкові залишки");
  await page.getByRole("button", { name: "Новий список" }).click();
  await expect(
    page.getByLabel("Рядки списку — кожен товар з нового рядка, як написано"),
  ).toHaveValue(`${coat} сірий 1 шт`);

  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByText(/Невідомо, чи збережено список/)).toBeVisible();
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(page.getByRole("heading", { name: source })).toBeVisible();
  expect(calls).toBe(2);

  const lists = await page.request.get(
    `/api/v1/snapshots?store_id=${fixture.store_id}&limit=100`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  const { items } = (await lists.json()) as {
    items: { source_document_ref: string | null }[];
  };
  expect(items.filter((l) => l.source_document_ref === source)).toHaveLength(1);
});

test("approving is for whoever may approve, and the section for whoever handles lists", async ({
  page,
}) => {
  let drop = ["snapshot:approve"];
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as {
      stores: { permissions: string[] }[];
    };
    for (const store of me.stores)
      store.permissions = store.permissions.filter((p) => !drop.includes(p));
    await route.fulfill({ response, json: me });
  });
  await noListWaits(page, fixture.location_id);
  await openings(page);
  await typeList(page, fixture.location_id, `Зошит ${word()}`, ["Куртка 1 шт"]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByRole("button", { name: "Розібрати рядок" }),
  ).toBeVisible();
  await expect(page.getByLabel("Затвердження списку")).toHaveCount(0);
  // Whoever handles a list may still reject it (review, 2026-10-09).
  await expect(
    page
      .getByLabel("Рішення щодо списку")
      .getByRole("button", { name: "Відхилити список" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Затвердити список" }),
  ).toHaveCount(0);

  drop = ["snapshot:approve", "snapshot:import"];
  await page.reload();
  await openStore(page, "Основний MAIN");
  await more(page);
  await expect(
    page.getByRole("button", { name: "Залишки", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Початкові залишки" }),
  ).toHaveCount(0);
});

test("nothing is received into a warehouse while its list waits, and it is once the list is rejected", async ({
  page,
}) => {
  // The owner's answer of 2026-10-02: the lists are approved before new
  // deliveries, and the app keeps that order.
  const source = `Зошит ${word()}`;
  await noListWaits(page, fixture.waiting_location_id);
  await openings(page);
  await typeList(page, fixture.waiting_location_id, source, ["Куртка 1 шт"]);
  await page.getByRole("button", { name: "Зберегти список" }).click();
  await expect(
    page.getByText(
      "Поки список чекає рішення, на складі «Склад, що чекає», де ще не було руху товару, нічого не приймають, не продають і не виправляють.",
      { exact: false },
    ),
  ).toBeVisible();

  async function receiveOne(): Promise<void> {
    await section(page, "Приймання");
    await page
      .getByRole("combobox", { name: "Склад", exact: true })
      .selectOption(fixture.waiting_location_id);
    await page.getByLabel("Пошук у каталозі").fill("лоран шоколад");
    await page.getByRole("button", { name: "Знайти" }).click();
    await page.getByRole("radio", { name: /Лоран шоколад/ }).click();
    await page
      .getByRole("combobox", { name: "Розмір" })
      .selectOption({ label: "M" });
    await page.getByLabel("Кількість").fill("1");
    await page.getByRole("button", { name: "Додати до поставки" }).click();
    await page.getByRole("button", { name: "Прийняти на склад" }).click();
  }

  await receiveOne();
  await expect(
    page.getByText(
      "На цьому складі чекає список початкових залишків. Спершу затвердіть або відхиліть його в «Початкових залишках».",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByText(/нічого не прийнято/)).toBeVisible();

  await section(page, "Початкові залишки");
  await page
    .getByRole("article", { name: `Список ${source}` })
    .getByRole("button", { name: "Відкрити" })
    .click();
  const approval = page.getByLabel("Затвердження списку");
  await approval.getByRole("button", { name: "Відхилити список" }).click();
  await approval.getByLabel("Чому відхиляємо").fill("перелічимо заново");
  await approval.getByRole("button", { name: "Так, відхилити" }).click();
  await expect(
    page.getByText(
      "Відхилено: перелічимо заново. Залишків цей список не змінив.",
    ),
  ).toBeVisible();

  await receiveOne();
  await expect(
    page.getByRole("heading", { name: "Товар прийнято" }),
  ).toBeVisible();
});
