import { test, expect, menu, more, openStore, rowNamed } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * «Ще» says what waits under each row («Усе на бірці» task list, P1-5;
 * spec S07): a glyph at 24 on every row; who owes the store, «Брак»'s
 * units, the lists to approve, each count the row's one colour; the
 * backups in order and when, or a dot in the warning's colour — on the row
 * and on the menu's «Ще», read «Ще — є що перевірити» — never «⚠»; the
 * store open now under «Змінити магазин»; and at the foot who is signed in
 * and until when: the sign-in's moment and the session's length. What the
 * seed cannot hold at once is stubbed.
 */
interface Fixture {
  owner_telegram_user_id: string;
}
const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function launch(telegramUserId: string): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${telegramUserId},"first_name":"Власниця"}`,
  });
  const check = [...fields]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("123456:TEST-TOKEN-not-a-real-secret")
    .digest();
  fields.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return `/#${new URLSearchParams({ tgWebAppData: fields.toString() }).toString()}`;
}

const minute = 60_000;

/** «03:15», as the phone writes a moment. */
async function clock(page: Page, at: number): Promise<string> {
  return page.evaluate(
    (moment) =>
      new Date(moment).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    at,
  );
}

/** The backups, as the server would answer: in order last night, or a
 * failed copy. */
async function backups(page: Page, state: "OK" | "FAILED"): Promise<string> {
  const finished = new Date(Date.now() - 8 * 60 * minute).toISOString();
  const nightly = {
    started_at: finished,
    finished_at: finished,
    ok: state === "OK",
    archive: "birka.dump.age",
    archive_bytes: 2_500_000,
    drill_ok: state === "OK",
    restore_seconds: 0.42,
    reasons: state === "OK" ? [] : ["Залишки не сходяться."],
  };
  await page.route("**/api/v1/backups", async (route) => {
    await route.fulfill({
      json: {
        state,
        checked_at: new Date().toISOString(),
        due_hours: 26,
        latest: nightly,
        last_good: state === "OK" ? nightly : null,
        nights: [nightly],
        your_last_message: null,
        server: { looked_at: finished, open: [], recent: [] },
      },
    });
  });
  return finished;
}

/** Two customers' worth of debts, and «Брак»'s and the lists' waiting, as
 * the open store's own reads answer them. */
async function waiting(page: Page): Promise<void> {
  await page.route("**/api/v1/credits/summary?**", async (route) => {
    await route.fulfill({
      json: { owed: "8400.00", customers: 4, debts: 5 },
    });
  });
  await page.route("**/api/v1/damaged-units?**", async (route) => {
    await route.fulfill({
      json: {
        units: [0, 1].map((at) => ({
          id: `00000000-0000-4000-8000-7${String(at).padStart(11, "0")}`,
          display_name: "Кокон графіт",
          size: "M",
          status: "AWAITING",
          returned_at: new Date().toISOString(),
          status_by: null,
          status_at: null,
          sold_from_location_id: "00000000-0000-4000-8000-500000000000",
          sold_from_location_name: "Основний",
          back_to_sold_from: true,
          note: null,
        })),
      },
    });
  });
  // Two lists in review, kept by the store asked about.
  await lists(page, [true, true]);
}

/** The lists in review, kept by the store asked about: each ready to
 * approve, or with a line still to decide. */
async function lists(page: Page, ready: boolean[]): Promise<void> {
  await page.route("**/api/v1/snapshots?**", async (route) => {
    const store = new URL(route.request().url()).searchParams.get("store_id");
    await route.fulfill({
      json: {
        items: ready.map((done, at) => ({
          snapshot_id: `00000000-0000-4000-8000-8${String(at).padStart(11, "0")}`,
          command_id: `00000000-0000-4000-8000-9${String(at).padStart(11, "0")}`,
          store_id: store,
          store_name: "Основний",
          store_state: "ACTIVE",
          location_id: "00000000-0000-4000-8000-500000000000",
          status: "IN_REVIEW",
          source_document_ref: null,
          captured_at: null,
          review_revision: 1,
          created_at: new Date().toISOString(),
          rejection_reason: null,
          decided_at: null,
          summary: {
            lines: 3,
            pending: done ? 0 : 1,
            needs_review: 0,
            resolved: done ? 3 : 2,
            skipped: 0,
            allocations: 3,
            units: 5,
            lines_differing_from_source: 0,
            lines_by_basis: {},
            units_by_basis: {},
            parts: 1,
            parts_removed: 0,
          },
          ready_to_approve: done,
          application: null,
        })),
        has_more: false,
      },
    });
  });
}

/** How a colour stands out of what is behind it (WCAG): the element's
 * text, its own fill, or its pseudo-element's fill — a dot — against the
 * first fill behind it. A dot on a tab not open stands on the menu's card,
 * its ring's colour. */
async function contrast(
  element: Locator,
  fore: "text" | "fill" | "after",
): Promise<number> {
  return element.evaluate((node, kind) => {
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
    const own =
      kind === "text"
        ? getComputedStyle(node).color
        : kind === "fill"
          ? getComputedStyle(node).backgroundColor
          : getComputedStyle(node, "::after").backgroundColor;
    let ground: Element | null = kind === "fill" ? node.parentElement : node;
    let behind = "rgba(0, 0, 0, 0)";
    while (ground) {
      behind = getComputedStyle(ground).backgroundColor;
      const alpha = rgb(behind)[3];
      if (alpha === undefined || alpha > 0) break;
      ground = ground.parentElement;
    }
    const a = luminance(rgb(own));
    const b = luminance(rgb(behind));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, fore);
}

function row(page: Page, label: string): Locator {
  return page
    .getByRole("navigation", { name: /^(Ще|Товар і каталог)$/ })
    .getByRole("button", { name: rowNamed(label) });
}

test("«Ще» says what waits under each row, its count the row's one colour, a glyph on each, the store open now, and who is signed in until when; its first two groups whole at 360 × 640", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await waiting(page);
  const night = await backups(page, "OK");
  // The session a little shorter than the server's, so its end is the
  // answer's, not a guess: sign-in's moment plus 90 minutes.
  const asked: number[] = [];
  let person = "";
  await page.route("**/api/v1/auth/telegram", async (route) => {
    asked.push(Date.now());
    const answer = await route.fetch();
    await route.fulfill({
      response: answer,
      json: { ...((await answer.json()) as object), expires_in: 5400 },
    });
    asked.push(Date.now());
  });
  await page.route("**/api/v1/me", async (route) => {
    const answer = await route.fetch();
    const me = (await answer.json()) as { display_name: string };
    person = me.display_name;
    await route.fulfill({ response: answer, json: me });
  });
  // The app takes its moment before it asks: this one too, should a minute
  // turn in between.
  asked.push(Date.now());
  await page.goto(launch(fixture.owner_telegram_user_id));
  await openStore(page, "Основний MAIN");
  await more(page);

  await expect(row(page, "Покупці")).toHaveAccessibleName(
    "Покупці 4 людини винні",
  );
  await expect(row(page, "Брак")).toHaveAccessibleName(
    "Брак 2 очікують перевірки",
  );
  await expect(row(page, "Товар і каталог")).toHaveAccessibleName(
    "Товар і каталог 2 на затвердження · перевірка, моделі, початкові залишки",
  );
  await expect(row(page, "Резервні копії")).toHaveAccessibleName(
    `Резервні копії в порядку, уночі о ${await clock(page, Date.parse(night))}`,
  );
  await expect(row(page, "Змінити магазин")).toHaveAccessibleName(
    "Змінити магазин Основний",
  );
  // Nothing that waits, nothing coloured: the rows with no count.
  await expect(row(page, "Прийшов товар").locator(".more-count")).toHaveCount(
    0,
  );
  // A glyph at 24 on every row, the switch too.
  const rows = page
    .getByRole("navigation", { name: "Ще" })
    .locator("button.more-row");
  expect(await rows.count()).toBeGreaterThanOrEqual(10);
  for (const each of await rows.all()) {
    const glyph = await each.locator("svg.icon:not(.sale-open)").boundingBox();
    expect([glyph?.width, glyph?.height]).toEqual([24, 24]);
  }
  // Who is signed in, and until when: the sign-in's moment and its 90
  // minutes, by this phone's clock.
  const until = await Promise.all(
    asked.map((at) => clock(page, at + 90 * minute)),
  );
  await expect(page.locator(".more-foot")).toHaveText(
    new RegExp(`^Ви увійшли як ${person} · сесія до (${until.join("|")})$`),
  );
  // People and goods whole above the menu.
  const menuTop = (await menu(page).boundingBox())?.y ?? 0;
  const goods = await row(page, "Товар і каталог").boundingBox();
  expect((goods?.y ?? 640) + (goods?.height ?? 0)).toBeLessThanOrEqual(menuTop);
  // Each count reads in both themes.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const label of ["Покупці", "Брак", "Товар і каталог"])
      expect(
        await contrast(row(page, label).locator(".more-count"), "text"),
      ).toBeGreaterThanOrEqual(4.5);
  }
  await page.emulateMedia({ colorScheme: "light" });
  // «Товар і каталог»'s own mark on each of its rows; «paper» the paper
  // mode's alone (stage 2, goods task list, P2-3).
  const mark = await row(page, "Товар і каталог")
    .locator("svg.icon:not(.sale-open)")
    .innerHTML();
  const paper = page
    .getByRole("navigation", { name: "Ще" })
    .getByRole("switch", { name: /^Вношу продаж з паперу/ });
  expect(await paper.locator("svg.icon").innerHTML()).not.toBe(mark);
  // Inside «Товар і каталог», the lists' own row says it too.
  await row(page, "Товар і каталог").click();
  await expect(row(page, "Початкові залишки")).toHaveAccessibleName(
    "Початкові залишки 2 на затвердження",
  );
  for (const label of ["Перевірка каталогу", "Моделі", "Початкові залишки"])
    expect(
      await row(page, label).locator("svg.icon:not(.sale-open)").innerHTML(),
    ).toBe(mark);
  await expect(page.locator("body")).not.toContainText("⚠");
});

test("a list still to finish is counted apart from those to approve: «1 на затвердження · 1 доробити», each the row's colour (stage 2, admin task list, P0-1)", async ({
  page,
}) => {
  await lists(page, [true, false]);
  await page.goto(launch(fixture.owner_telegram_user_id));
  await openStore(page, "Основний MAIN");
  await more(page);
  await expect(row(page, "Товар і каталог")).toHaveAccessibleName(
    "Товар і каталог 1 на затвердження · 1 доробити · перевірка, моделі, початкові залишки",
  );
  await expect(row(page, "Товар і каталог").locator(".more-count")).toHaveText([
    "1 на затвердження",
    "1 доробити",
  ]);
  await row(page, "Товар і каталог").click();
  await expect(row(page, "Початкові залишки")).toHaveAccessibleName(
    "Початкові залишки 1 на затвердження · 1 доробити",
  );
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const count of await row(page, "Початкові залишки")
      .locator(".more-count")
      .all())
      expect(await contrast(count, "text")).toBeGreaterThanOrEqual(4.5);
  }
});

test("backups that need the owner put a dot in the warning's colour on «Ще» and on its row, read «Ще — є що перевірити», never «⚠», at 3:1 in both themes", async ({
  page,
}) => {
  await backups(page, "FAILED");
  await page.goto(launch(fixture.owner_telegram_user_id));
  await openStore(page, "Основний MAIN");
  const tab = menu(page).getByRole("button", {
    name: "Ще — є що перевірити",
  });
  await expect(tab).toBeVisible();
  await expect(tab.locator(".tab-label")).toHaveText("Ще");
  const pill = tab.locator(".tab-pill");
  await expect(pill).toHaveAttribute("data-attention", "");
  await expect(menu(page)).not.toContainText("⚠");
  // Drawn, 10 across: a colour is read off a dot not drawn as well.
  expect(
    await pill.evaluate((node) => {
      const dot = getComputedStyle(node, "::after");
      return [dot.content, dot.width, dot.height];
    }),
  ).toEqual(['""', "10px", "10px"]);
  // The menu's dot against the menu's card, its ring's colour, while «Ще»
  // is not the open tab.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await contrast(pill, "after")).toBeGreaterThanOrEqual(3);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await more(page);
  const backupsRow = row(page, "Резервні копії");
  await expect(backupsRow).toHaveAccessibleName(
    "Резервні копії потрібна ваша увага",
  );
  const dot = backupsRow.locator(".attention-dot");
  await expect(dot).toBeVisible();
  await expect(page.locator("body")).not.toContainText("⚠");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await contrast(dot, "fill")).toBeGreaterThanOrEqual(3);
  }
});
