import { test, expect, more, openStore, sections } from "./fixtures";
import type { Page, Request, Response } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Failures are visible (owner decision, 2026-10-03).
 *
 * - A broken screen shows «Щось пішло не так» and «Перезапустити» instead of
 *   a blank page, and an unsent sale is not lost. It says which case it is:
 *   a sale sent without an answer is kept, a basket still being filled is
 *   not (carried out, 2026-10-03). A short note goes to the server's log:
 *   which screen, which error, the version, the request's number — never a
 *   name, a phone, what was typed, or the Telegram number.
 * - A server error tells the seller its request's number; a server the edge
 *   cannot reach, or no answer at all, tells them to sell on paper (owner
 *   decision, 2026-10-04; ADR-0013 §3).
 * - Trouble on the server is shown in «Резервні копії», as backups are.
 *
 * The server's side of each is played with stubs: the API's note endpoint,
 * its error body and the watcher's report are another part's work.
 *
 * And one failure the real server plays: an attempt an older page saved
 * before the way of paying was asked (owner decision, 2026-10-04; ADR-0012
 * §B13), resent by itself as the store opens (ADR-0013 §4.3) and refused as
 * having recorded nothing.
 */
interface Fixture {
  owner_telegram_user_id: string;
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

const release = process.env.BIRKA_RELEASE ?? "dev";

// A person nobody else's journey knows, signed in by stubs alone.
const telegramId = "777000111";
const firstName = "Тетяна";
const ids = {
  organization: "0b8f3c1e-7a51-4c0e-9d0f-0d6a3c1b2a01",
  user: "0b8f3c1e-7a51-4c0e-9d0f-0d6a3c1b2a02",
  store: "0b8f3c1e-7a51-4c0e-9d0f-0d6a3c1b2a03",
};
const me = {
  user_id: ids.user,
  organization_id: ids.organization,
  display_name: `${firstName} Коваль`,
  organization_permissions: [],
  stores: [
    {
      id: ids.store,
      name: "Подільський",
      code: "POD",
      state: "ACTIVE",
      state_since: null,
      permissions: [],
    },
    // A second store, so the app stops at the choice: one store opens
    // straight (redesign P0-1), and these journeys are about that screen.
    {
      id: "6a3c1f0e-0000-4000-8000-0000000000b2",
      name: "Ринок",
      code: "RIN",
      state: "ACTIVE",
      state_since: null,
      permissions: [],
    },
  ],
};

/** The app opened from Telegram by the stubbed person; nothing is checked. */
function stubbedLaunch(): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramId},"first_name":"${firstName}"}`,
    hash: "0".repeat(64),
  });
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

/** Telegram's launch data for a person the seed knows, signed. */
function signedData(telegramUserId: string, name = "Власниця"): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"${name}"}`,
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

/** The app opened from Telegram by a person the seed knows, signed. */
function signedLaunch(telegramUserId: string, name?: string): string {
  return `/#${new URLSearchParams({ tgWebAppData: signedData(telegramUserId, name) }).toString()}`;
}

async function signInStubbed(page: Page): Promise<void> {
  await page.route("**/api/v1/auth/telegram", async (route) => {
    await route.fulfill({ json: { access_token: "stubbed-session" } });
  });
}

/** Every note of a broken screen the page sends, answered as the API does. */
async function collectNotes(page: Page): Promise<Request[]> {
  const notes: Request[] = [];
  await page.route("**/api/v1/client-errors", async (route) => {
    notes.push(route.request());
    await route.fulfill({ status: 204 });
  });
  return notes;
}

function noteOf(request: Request): Record<string, unknown> {
  return request.postDataJSON() as Record<string, unknown>;
}

/** Puts entries in the phone's storage, as an earlier visit left them. */
async function seed(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  // Outside Telegram the app only asks to be opened from the bot.
  await page.goto("/");
  await page.evaluate((saved) => {
    for (const [key, value] of Object.entries(saved))
      localStorage.setItem(key, value);
  }, entries);
  await page.goto("about:blank");
}

/** Opens the app on a store list that is not one: its screen throws. */
async function openBroken(page: Page): Promise<void> {
  await collectNotes(page);
  await signInStubbed(page);
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({ json: { ...me, stores: null } });
  });
  await page.goto(stubbedLaunch());
  await expect(
    page.getByRole("heading", { name: "Щось пішло не так" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Бірка");
}

test.describe("a screen that breaks", () => {
  test.use({ pageErrorsExpected: true });

  // A sale sent with no answer, paid in parts: the customer's name and phone
  // are on the phone, and must stay there.
  const saleKey = `birka:sale-pending:${ids.organization}:${ids.user}:${ids.store}`;
  const saved = JSON.stringify({
    key: "5f0c2b8e-3a41-4d2c-9f61-1e2d3c4b5a60",
    body: {
      command_id: "5f0c2b8e-3a41-4d2c-9f61-1e2d3c4b5a61",
      store_id: ids.store,
      lines: [{ size_id: "5f0c2b8e-3a41-4d2c-9f61-1e2d3c4b5a62" }],
      found_in_store: [],
      missing_in_store: [],
      credit: {
        customer_name: "Оксана Петренко",
        customer_phone: "+380 67 123 45 67",
        paid_now: "100.00",
      },
    },
    ambiguous: true,
  });
  const keptSaid =
    "Операцію, на яку сервер ще не відповів, збережено: після перезапуску застосунок покаже її для перевірки.";
  const nothingKeptSaid =
    "Якщо ви щойно провели операцію, перевірте, чи її записано, перш ніж повторювати. Кошик, який ви ще не надіслали, доведеться скласти заново.";

  test("shows «Щось пішло не так», keeps the sale sent without an answer, notes it without the person, and comes back on «Перезапустити»", async ({
    page,
  }) => {
    await seed(page, { [saleKey]: saved });

    const notes = await collectNotes(page);
    await signInStubbed(page);
    // What the server says of this person, broken: a store list that is not
    // one. The screen that lists the stores throws on it.
    let broken = true;
    await page.route("**/api/v1/me", async (route) => {
      await route.fulfill({ json: broken ? { ...me, stores: null } : me });
    });
    await page.goto(stubbedLaunch());

    await expect(
      page.getByRole("heading", { name: "Щось пішло не так" }),
    ).toBeVisible();
    await expect(page.locator("[data-crashed]")).toContainText(keptSaid);
    await expect(page.locator("[data-crashed]")).not.toContainText(
      nothingKeptSaid,
    );
    await expect(page.locator("[data-crashed]")).toContainText(
      `Версія ${release}`,
    );
    // Nothing of the phone's storage was cleared.
    expect(
      await page.evaluate((key) => localStorage.getItem(key), saleKey),
    ).toBe(saved);

    // One note, though React drew the screen twice and its development build
    // throws the error once more for the console.
    await expect.poll(() => notes.length).toBe(1);
    await page.waitForTimeout(500);
    expect(notes).toHaveLength(1);
    const [request] = notes;
    if (!request) throw new Error("no note");
    const note = noteOf(request);
    expect(Object.keys(note).sort()).toEqual([
      "kind",
      "message",
      "name",
      "release",
      "request_id",
      "screen",
    ]);
    expect(note).toMatchObject({
      kind: "render",
      screen: "store-choice",
      name: "TypeError",
      release,
      request_id: null,
    });
    expect(String(note.message)).toContain("find");
    const headers = await request.allHeaders();
    expect(headers.authorization).toBeUndefined();
    expect(headers.referer).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
    const sent = request.postData() ?? "";
    for (const secret of [
      telegramId,
      firstName,
      "tgWebAppData",
      "Оксана",
      "123 45 67",
      "stubbed-session",
    ])
      expect(sent).not.toContain(secret);

    // Started again, the app signs in from the same launch data and finds
    // the sale it had sent, to check — never to send anew. It checks it at
    // once, with no tap (ADR-0013 §4.3): the same sale under the same key.
    // The server still does not answer, so it stays kept.
    const resent: { key: string | null; body: string | null }[] = [];
    await page.route("**/api/v1/sales", async (route) => {
      resent.push({
        key: await route.request().headerValue("Idempotency-Key"),
        body: route.request().postData(),
      });
      await route.abort("connectionreset");
    });
    broken = false;
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Перезапустити" }).click(),
    ]);
    expect(page.url()).toContain("#tgWebAppData=");
    await openStore(page, /Подільський/);
    await expect.poll(() => resent.length).toBe(1);
    await expect(
      page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
    ).toBeVisible();
    const first = JSON.parse(saved) as { key: string; body: unknown };
    expect(resent[0]?.key).toBe(first.key);
    expect(JSON.parse(resent[0]?.body ?? "null")).toEqual(first.body);
    expect(notes).toHaveLength(1);
  });

  test("with no sale sent awaiting its answer, promises nothing and says to check before repeating", async ({
    page,
  }) => {
    // A count being typed is kept on the phone too, but it was never sent:
    // there is no answer to wait for.
    const draftKey = `birka:stock-list-draft:${ids.store}`;
    await seed(page, { [draftKey]: '{"lines":[]}' });
    await openBroken(page);

    const crashed = page.locator("[data-crashed]");
    await expect(crashed).toContainText(nothingKeptSaid);
    await expect(crashed).not.toContainText("збережено");
    await expect(crashed).toContainText(`Версія ${release}`);
    await expect(
      page.getByRole("button", { name: "Перезапустити" }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), draftKey),
    ).toBe('{"lines":[]}');
  });

  test("with storage it cannot read, it still shows, and promises nothing", async ({
    page,
  }) => {
    // Some phones' web views refuse storage outright. The screen that tells
    // of a failure must not fail in turn.
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Storage is off.", "SecurityError");
        },
      });
    });
    await openBroken(page);

    const crashed = page.locator("[data-crashed]");
    await expect(crashed).toContainText(nothingKeptSaid);
    await expect(
      page.getByRole("button", { name: "Перезапустити" }),
    ).toBeVisible();
  });

  test("a sale answered after the screen broke is no longer promised, and no saved value is read", async ({
    page,
  }) => {
    await seed(page, { [saleKey]: saved });
    // Every key whose value the page reads: the crash screen may look at the
    // names only, for the values hold the customer's name and phone.
    await page.addInitScript(() => {
      const reads: string[] = [];
      Object.assign(window, { storageReads: reads });
      const original = Object.getOwnPropertyDescriptor(
        Storage.prototype,
        "getItem",
      )?.value as (this: Storage, key: string) => string | null;
      Storage.prototype.getItem = function (this: Storage, key: string) {
        reads.push(key);
        return original.call(this, key);
      };
    });
    await openBroken(page);

    // Sent just before the screen broke, its journal is on the phone.
    const crashed = page.locator("[data-crashed]");
    await expect(crashed).toContainText(keptSaid);
    // Then the answer arrives: the sale went through, and its journal is
    // removed. A reload would show nothing, so nothing may be promised.
    await page.evaluate((key) => {
      localStorage.removeItem(key);
    }, saleKey);
    await expect(crashed).toContainText(nothingKeptSaid);
    await expect(crashed).not.toContainText(keptSaid);
    const reads = await page.evaluate(
      () => (window as unknown as { storageReads: string[] }).storageReads,
    );
    expect(reads.filter((key) => key.startsWith("birka:"))).toEqual([]);
  });

  test("an error outside drawing is noted but leaves the screen; each once, five at most", async ({
    page,
  }) => {
    const notes = await collectNotes(page);
    await signInStubbed(page);
    await page.route("**/api/v1/me", async (route) => {
      await route.fulfill({ json: me });
    });
    await page.goto(stubbedLaunch());
    const store = page.getByRole("button", { name: /Подільський/ });
    await expect(store).toBeVisible();

    // A server error nobody awaited carries its request's number. The class
    // is the app's own: the development server hands out the same module.
    await page.evaluate(async (path) => {
      const { ApiError } = (await import(
        path
      )) as typeof import("../src/shared/api");
      void Promise.reject(
        new ApiError(500, "INTERNAL_ERROR", {}, "3f9c2a7e-1b2c-4d5e-8f90"),
      );
    }, "/src/shared/api.ts");
    await expect.poll(() => notes.length).toBe(1);
    expect(noteOf(notes[0] as Request)).toMatchObject({
      kind: "rejection",
      screen: "store-choice",
      name: "ApiError",
      message: "500 INTERNAL_ERROR",
      request_id: "3f9c2a7e-1b2c-4d5e-8f90",
    });

    // A thrown value that is not an error is never quoted: it may be anything.
    await page.evaluate(() => {
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { customer_phone: "+380671234567" };
      }, 0);
    });
    await expect.poll(() => notes.length).toBe(2);
    expect(noteOf(notes[1] as Request)).toMatchObject({
      kind: "error",
      name: "NonError",
    });
    expect(notes[1]?.postData()).not.toContain("380671234567");

    // The same error again is not noted again; seven new ones make five.
    await page.evaluate(() => {
      for (const n of [1, 1, 2, 3, 4, 5, 6, 7])
        setTimeout(() => {
          throw new RangeError(`broken ${String(n)}`);
        }, 0);
    });
    await expect.poll(() => notes.length).toBe(5);
    await page.waitForTimeout(500);
    expect(notes).toHaveLength(5);
    expect(notes.slice(2).map((n) => noteOf(n).message)).toEqual([
      "broken 1",
      "broken 2",
      "broken 3",
    ]);

    // None of it replaced the screen.
    await expect(store).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Щось пішло не так" }),
    ).toHaveCount(0);
  });

  test("while the server does not answer, it says to sell on paper, and that the app may not open again", async ({
    page,
  }) => {
    await openBroken(page);
    const crashed = page.locator("[data-crashed]");
    await expect(crashed).not.toContainText("Продавайте на папері");
    // The server stops answering: what the app's own requests note (the
    // class is the app's own, handed out by the development server).
    await page.evaluate(async (path) => {
      const { noteUnreachable } = (await import(
        path
      )) as typeof import("../src/shared/reach");
      noteUnreachable();
    }, "/src/shared/reach.ts");
    await expect(crashed).toContainText(
      "Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.",
    );
    await expect(crashed).toContainText(
      "Якщо сервер не відповідає, після перезапуску застосунок може не відкритися — продавайте на папері.",
    );
    await expect(
      page.getByRole("button", { name: "Перезапустити" }),
    ).toBeVisible();
  });

  test("a note that cannot be sent is dropped without a word", async ({
    page,
  }) => {
    await page.route("**/api/v1/client-errors", async (route) => {
      await route.abort("connectionrefused");
    });
    await signInStubbed(page);
    await page.route("**/api/v1/me", async (route) => {
      await route.fulfill({ json: { ...me, stores: null } });
    });
    // The crash is expected here; what must not follow is a second failure,
    // which would surface as an error nothing caught.
    const thrown: string[] = [];
    page.on("pageerror", (error) => thrown.push(error.message));
    await page.goto(stubbedLaunch());
    await expect(
      page.getByRole("heading", { name: "Щось пішло не так" }),
    ).toBeVisible();
    await page.waitForTimeout(500);
    expect(thrown.every((message) => message.includes("find"))).toBe(true);
    await expect(
      page.getByRole("button", { name: "Перезапустити" }),
    ).toBeVisible();
  });
});

test("the app's code that never arrives is said so, but only after a wait", async ({
  page,
}) => {
  await page.route("**/src/main.tsx", async (route) => {
    await route.abort("connectionreset");
  });
  await page.goto(stubbedLaunch());
  const fallback = page.getByText(
    "Застосунок не завантажився. Перевірте зв’язок і відкрийте його ще раз.",
  );
  // A normal open never flashes it.
  await expect(fallback).toBeHidden();
  await page.waitForTimeout(3000);
  await expect(fallback).toBeHidden();
  await expect(fallback).toBeVisible({ timeout: 10_000 });
  // An outage, in practice: the owner's words under it (ADR-0013 §3).
  await expect(
    page.getByText(
      "Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.",
    ),
  ).toBeVisible();
});

test("an app that opens replaces the waiting text at once", async ({
  page,
}) => {
  await signInStubbed(page);
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({ json: me });
  });
  await page.goto(stubbedLaunch());
  await expect(page.getByRole("button", { name: /Подільський/ })).toBeVisible();
  await expect(page.locator(".not-loaded")).toHaveCount(0);
});

test("a server error gives its request's number; a server out of reach says to sell on paper", async ({
  page,
}) => {
  const notes = await collectNotes(page);
  let answer: "500" | "500-bare" | "502" | "503" | "504" | "lost" = "500";
  await page.route("**/api/v1/auth/telegram", async (route) => {
    if (answer === "lost") {
      await route.abort("connectionreset");
      return;
    }
    if (answer === "500") {
      await route.fulfill({
        status: 500,
        headers: { "X-Request-ID": "3f9c2a7e-1b2c-4d5e-8f90-a1b2c3d4e5f6" },
        json: {
          code: "INTERNAL_ERROR",
          message: "Внутрішня помилка сервера.",
          details: {},
        },
      });
      return;
    }
    // The edge's own answer: no body, no number.
    await route.fulfill({
      status: answer === "500-bare" ? 500 : Number(answer),
    });
  });
  const said = page.getByRole("alert");
  const again = page.getByRole("button", { name: "Спробувати ще раз" });
  await page.goto(stubbedLaunch());
  await expect(said).toHaveText(
    "Не вдалося виконати операцію. Спробуйте ще раз. Номер запиту: 3f9c2a7e.",
  );

  // The edge answering for a server that did not, and no answer at all: the
  // shop sells on paper (owner decision, 2026-10-04; ADR-0013 §3).
  for (const status of ["502", "503", "504", "lost"] as const) {
    answer = status;
    await again.click();
    await expect(said).toHaveText(
      "Сервер не відповідає. Продавайте на папері: модель, розмір, ціна, як оплачено, час. Коли сервер відповість — внесіть продажі до закриття каси.",
    );
  }

  // A server error without a number reads as it always did.
  answer = "500-bare";
  await again.click();
  await expect(said).toHaveText(
    "Не вдалося виконати операцію. Спробуйте ще раз.",
  );
  // A refusal the screen shows is not a broken screen: nothing is noted.
  expect(notes).toHaveLength(0);
});

test.describe("trouble on the server, in «Резервні копії»", () => {
  const minute = 60_000;

  /** `server` gets times counted back from the very moment the answer says it
   * was checked (`checked_at`), so a minute is never lost between the two. */
  type Ago = (minutes: number) => string;

  async function serve(
    page: Page,
    server: (ago: Ago) => object,
  ): Promise<void> {
    await page.route("**/api/v1/backups", async (route) => {
      const now = Date.now();
      const ago: Ago = (minutes) =>
        new Date(now - minutes * minute).toISOString();
      const night = new Date(now - 5 * 60 * minute).toISOString();
      const good = {
        started_at: night,
        finished_at: night,
        ok: true,
        archive: "birka-20261003T031500Z.dump.age",
        archive_bytes: 2_500_000,
        drill_ok: true,
        restore_seconds: 0.42,
        reasons: [],
      };
      await route.fulfill({
        json: {
          state: "OK",
          checked_at: new Date(now).toISOString(),
          due_hours: 26,
          latest: good,
          last_good: good,
          nights: [good],
          your_last_message: null,
          server: server(ago),
        },
      });
    });
  }

  /** «Ще», which holds «Резервні копії» and is marked as it is (P1-6). */
  function tab(page: Page) {
    return sections(page).getByRole("button", { name: /^Ще( ⚠)?$/ });
  }

  async function open(page: Page): Promise<void> {
    await page.goto(signedLaunch(fixture.owner_telegram_user_id));
    await openStore(page, "Основний MAIN");
    await more(page);
    await sections(page)
      .getByRole("button", { name: /^Резервні копії/ })
      .click();
  }

  test("the owner sees what is wrong now and since when, what was wrong this week, and that the watcher looks", async ({
    page,
  }) => {
    await serve(page, (ago) => ({
      looked_at: ago(2),
      open: [
        {
          kind: "NOT_ANSWERING",
          reason: "База даних не відповідає.",
          started_at: ago(25),
          told_at: ago(25),
        },
      ],
      recent: [
        {
          kind: "DISK_LOW",
          reason: "На диску сервера лишилося 9 % місця.",
          started_at: ago(30 * 60),
          ended_at: ago(27 * 60),
        },
      ],
    }));
    await open(page);
    // Marked as backups are while something needs the owner: «Ще», and the
    // section under it.
    await expect(tab(page)).toHaveText("Ще ⚠");
    await more(page);
    const backups = sections(page).getByRole("button", {
      name: /^Резервні копії/,
    });
    await expect(backups).toHaveAccessibleName("Резервні копії ⚠");
    // «Ще» is a screen of its own (navigation task list, P0-4): back to the
    // section from it.
    await backups.click();

    const block = page.locator('[data-server="TROUBLE"]');
    await expect(block.getByRole("heading")).toHaveText("Проблема на сервері");
    const now = block.locator('[data-troubles="open"] > li');
    await expect(now).toHaveCount(1);
    await expect(now).toContainText("Сервер не відповідає");
    await expect(now).toContainText("уже 25 хв");
    await expect(now).toContainText("База даних не відповідає.");
    await expect(block.locator("[data-watcher]")).toHaveText(
      "Сторож перевіряв 2 хв тому.",
    );
    const past = block.locator('[data-troubles="recent"] > li');
    await expect(past).toHaveCount(1);
    await expect(past).toContainText("Закінчувалося місце на диску");
    await expect(past).toContainText("тривало 3 год");
    await expect(past).toContainText("На диску сервера лишилося 9 % місця.");
    // The backups' own verdict is untouched.
    await expect(
      page.locator('[data-state="OK"]').getByRole("heading"),
    ).toHaveText("Копії в порядку");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a watcher that went quiet, or never looked, is called out; a live one says all is well", async ({
    page,
  }) => {
    let lookedMinutesAgo: number | null = 0.3;
    await serve(page, (ago) => ({
      looked_at: lookedMinutesAgo === null ? null : ago(lookedMinutesAgo),
      open: [],
      recent: [],
    }));
    await open(page);
    const watcher = page.locator("[data-watcher]");
    await expect(page.locator('[data-server="OK"]')).toBeVisible();
    await expect(watcher).toHaveText(
      "Сторож перевіряв щойно. Проблем не помічено.",
    );
    await expect(tab(page)).toHaveText("Ще");

    const refresh = page.getByRole("button", { name: "Оновити" });
    lookedMinutesAgo = 40;
    await refresh.click();
    await expect(page.locator('[data-server="SILENT"]')).toBeVisible();
    await expect(watcher).toHaveText(
      "Сторож перевіряв 40 хв тому. Поки він мовчить, бот нічого не напише — ні про копії, ні про сервер. Перевірте його за інструкцією сервера.",
    );

    lookedMinutesAgo = null;
    await refresh.click();
    await expect(watcher).toHaveText(
      "Сторож ще не перевіряв сервер. Поки він мовчить, бот нічого не напише — ні про копії, ні про сервер. Перевірте його за інструкцією сервера.",
    );
    // The section shows the quiet watcher; the tab is marked for trouble only.
    await expect(tab(page)).toHaveText("Ще");
  });
});

test("an error nothing caught fails a journey that expected none", async ({
  page,
}) => {
  // The fixture's own check, proven: this journey must end failed.
  test.fail();
  await page.goto("about:blank");
  await Promise.all([
    page.waitForEvent("pageerror"),
    page.evaluate(() => {
      setTimeout(() => {
        throw new Error("thrown on purpose");
      }, 0);
    }),
  ]);
});

test.describe("an attempt saved before the way of paying was asked, resent to the real server", () => {
  /**
   * A page of the previous version wrote down a sale, a payment or a return
   * without `payment_method`, and never heard back. Nothing was recorded, so
   * the server refuses it as a new command without a way, after looking it up
   * (`recorded: false`). The attempt is resent byte for byte, settles, and the
   * phone says what was not recorded instead of staying blocked.
   */
  interface Seller {
    token: string;
    organization: string;
    user: string;
  }

  async function seller(page: Page): Promise<Seller> {
    const auth = await page.request.post("/api/v1/auth/telegram", {
      data: { init_data: signedData(fixture.telegram_user_id, "Оля") },
    });
    const { access_token: token } = (await auth.json()) as {
      access_token: string;
    };
    const me = await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const who = (await me.json()) as {
      user_id: string;
      organization_id: string;
    };
    return { token, organization: who.organization_id, user: who.user_id };
  }

  /** A model of the test's own, three of it received where the till sells. */
  async function coat(
    page: Page,
    token: string,
  ): Promise<{ variant: string; size: string }> {
    const headers = { Authorization: `Bearer ${token}` };
    const created = await page.request.post("/api/v1/catalog/products", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        store_id: fixture.store_id,
        concept: `Стара спроба ${randomUUID().slice(0, 8)}`,
        variant: { color: "чорний" },
        sizes: [{ system: "ALPHA", code: "S" }],
      },
    });
    expect(created.status()).toBe(201);
    const product = (await created.json()) as {
      product_variant_id: string;
      sizes: { size_id: string }[];
    };
    const size = product.sizes[0]?.size_id ?? "";
    const received = await page.request.post("/api/v1/inventory/receipts", {
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      data: {
        store_id: fixture.store_id,
        location_id: fixture.returns_location_id,
        command_id: randomUUID(),
        lines: [
          {
            product_variant_id: product.product_variant_id,
            size_id: size,
            quantity: 3,
            acquisition_type: "PURCHASE",
            unit_cost: null,
          },
        ],
        notes: null,
      },
    });
    expect(received.status()).toBe(201);
    return { variant: product.product_variant_id, size };
  }

  /** One of the coats sold now, through the API, as the new till sells. */
  async function sell(
    page: Page,
    token: string,
    terms?: object,
  ): Promise<{
    id: string;
    items: { id: string }[];
    credit: { credit_id: string } | null;
  }> {
    const { variant, size } = await coat(page, token);
    const sold = await page.request.post("/api/v1/sales", {
      headers: {
        Authorization: `Bearer ${token}`,
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
            unit_price: "3000.00",
          },
        ],
        ...(terms ? { credit: terms } : {}),
        payment_method: "CASH",
      },
    });
    expect(sold.status()).toBe(201);
    return (await sold.json()) as {
      id: string;
      items: { id: string }[];
      credit: { credit_id: string } | null;
    };
  }

  /** Leaves `attempt` in `scope`'s journal, as the older page did, and opens the store. */
  async function resume(
    page: Page,
    scope: string,
    who: Seller,
    attempt: object,
  ): Promise<string> {
    const key = `birka:${scope}:${who.organization}:${who.user}:${fixture.store_id}`;
    await seed(page, { [key]: JSON.stringify(attempt) });
    await page.goto(signedLaunch(fixture.telegram_user_id, "Оля"));
    await openStore(page, "Основний MAIN");
    return key;
  }

  /** The refusal proves nothing was recorded, so it settles the attempt. */
  async function refusedAsUnrecorded(response: Response): Promise<void> {
    expect(response.status()).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "PAYMENT_METHOD_REQUIRED", recorded: false },
    });
  }

  test("a sale is refused and settles, and the basket is put together again", async ({
    page,
  }) => {
    const who = await seller(page);
    const { variant, size } = await coat(page, who.token);
    const stored = {
      key: randomUUID(),
      ambiguous: true,
      body: {
        store_id: fixture.store_id,
        command_id: randomUUID(),
        lines: [
          {
            product_variant_id: variant,
            size_id: size,
            source_location_id: fixture.returns_location_id,
            quantity: 1,
            unit_price: "3000.00",
            discount_amount: "0.00",
          },
        ],
        found_in_store: [],
        missing_in_store: [],
        size_clarified: [],
      },
    };
    // Read from the phone's storage, it is checked at once, with no tap
    // (ADR-0013 §4.3).
    const answered = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/sales") && r.request().method() === "POST",
    );
    const key = await resume(page, "sale-pending", who, stored);
    const response = await answered;
    // Exactly what was saved, under its own key.
    expect(response.request().postData()).toBe(JSON.stringify(stored.body));
    expect(await response.request().headerValue("Idempotency-Key")).toBe(
      stored.key,
    );
    await refusedAsUnrecorded(response);

    await expect(
      page.getByRole("heading", { name: "Продаж ще не підтверджено" }),
    ).toHaveCount(0);
    // Whatever the reason, a kept sale not recorded says how to type it from
    // paper (ADR-0013 §8).
    await expect(
      page.getByText(
        "Продаж не записано (не вказано, як платить покупець. Натисніть «Готівка», «Картка» або «Переказ»). Якщо товар віддали покупцю — внесіть його з паперу з позначкою «Вношу продаж з паперу». Кошик треба зібрати знову.",
      ),
    ).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
    // The till is the seller's again; its three ways come with a basket
    // (redesign direction §5).
    await expect(
      page.getByRole("button", { name: "Замовлення", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Продаж" })).toBeVisible();
    await expect(
      page.getByRole("searchbox", { name: "Знайти модель" }),
    ).toBeEnabled();
  });

  test("a payment is refused and settles, and says it was not taken", async ({
    page,
  }) => {
    const who = await seller(page);
    const sale = await sell(page, who.token, {
      customer_name: `Покупець ${randomUUID().slice(0, 8)}`,
      customer_phone: `067${String(Date.now() % 10_000_000).padStart(7, "0")}`,
      paid_now: "1000.00",
    });
    const creditId = sale.credit?.credit_id ?? "";
    const stored = {
      key: randomUUID(),
      ambiguous: true,
      body: {
        kind: "payment",
        store_id: fixture.store_id,
        credit_id: creditId,
        command_id: randomUUID(),
        amount: "500.00",
      },
    };
    const answered = page.waitForResponse((r) =>
      r.url().endsWith(`/api/v1/credits/${creditId}/payments`),
    );
    const key = await resume(page, "credit-pending", who, stored);
    const response = await answered;
    expect(response.request().postData()).toBe(
      JSON.stringify({
        command_id: stored.body.command_id,
        amount: stored.body.amount,
      }),
    );
    await refusedAsUnrecorded(response);

    await expect(
      page.getByRole("heading", {
        name: /^(Внесок|Списання) ще не підтверджено$|^Перевіряємо (внесок|списання)…$/,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Внесок не записано — прийміть його ще раз і вкажіть, як платить покупець.",
      ),
    ).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
    const debt = await page.request.get(`/api/v1/credits/${creditId}`, {
      headers: { Authorization: `Bearer ${who.token}` },
    });
    expect(((await debt.json()) as { owed: string }).owed).toBe("2000.00");
  });

  test("a return is refused and settles, and says it was not made", async ({
    page,
  }) => {
    const who = await seller(page);
    const sale = await sell(page, who.token);
    const stored = {
      key: randomUUID(),
      ambiguous: true,
      body: {
        store_id: fixture.store_id,
        sale_id: sale.id,
        command_id: randomUUID(),
        lines: [
          {
            sale_item_id: sale.items[0]?.id ?? "",
            quantity: 1,
            restock: true,
            condition: "INTACT",
          },
        ],
        reason: null,
      },
    };
    const answered = page.waitForResponse((r) =>
      r.url().endsWith(`/api/v1/sales/${sale.id}/refunds`),
    );
    const key = await resume(page, "return-pending", who, stored);
    const response = await answered;
    expect(response.request().postData()).toBe(
      JSON.stringify({
        command_id: stored.body.command_id,
        lines: stored.body.lines,
        reason: null,
      }),
    );
    await refusedAsUnrecorded(response);

    await expect(
      page.getByRole("heading", { name: "Повернення ще не підтверджено" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Повернення не записано — оформіть його ще раз і вкажіть, як повертаєте гроші.",
      ),
    ).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  });
});
