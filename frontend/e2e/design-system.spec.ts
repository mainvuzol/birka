import {
  test,
  expect,
  openStore,
  menu,
  listRow,
  more,
  openModel,
  section,
  tillWays,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The design system of «Усе на бірці» (the frame's task list, P0-1): its
 * colours read in both themes, its one face ships with the app, Telegram's
 * header, background and bottom bar take the app's colours before it is
 * ready, and a sum keeps its «грн» on its line. Once ready, Telegram is
 * asked once for the whole height and to keep a downward swipe from
 * closing the app (P0-4).
 */

interface Fixture {
  telegram_user_id: string;
  network_owner_telegram_user_id: string;
}

const fixture = JSON.parse(
  readFileSync(
    process.env.BIRKA_E2E_FIXTURE ?? "/tmp/birka-orders-ui-fixture.json",
    "utf8",
  ),
) as Fixture;

function initData(id = fixture.telegram_user_id): string {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: `{"id":${id},"first_name":"Оля"}`,
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

/** Opened from Telegram of `version`, its theme `theme`. */
function launch(version: string, theme: Record<string, string>): string {
  const hash = new URLSearchParams({
    tgWebAppData: initData(),
    tgWebAppVersion: version,
    tgWebAppThemeParams: JSON.stringify(theme),
  });
  return `/#${hash.toString()}`;
}

const light = { bg_color: "#ffffff", text_color: "#000000" };
const dark = { bg_color: "#17212b", text_color: "#f5f5f5" };

/** Everything the app tells Telegram, in order, with what it said. */
async function hearTelegram(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const host = window as unknown as {
      TelegramWebviewProxy: {
        postEvent: (event: string, data: string) => void;
      };
      told: { event: string; data: unknown }[];
    };
    host.told = [];
    host.TelegramWebviewProxy = {
      postEvent: (event, data) => {
        host.told.push({ event, data: data ? JSON.parse(data) : null });
      },
    };
  });
}

async function told(page: Page): Promise<{ event: string; data: unknown }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { told: { event: string; data: unknown }[] }).told,
  );
}

const colours = [
  "web_app_set_header_color",
  "web_app_set_background_color",
  "web_app_set_bottom_bar_color",
];

/** The colour events alone, as `event colour`. */
function painted(events: { event: string; data: unknown }[]): string[] {
  return events
    .filter(({ event }) => colours.includes(event))
    .map(
      ({ event, data }) =>
        `${event} ${(data as { color: string }).color.toLowerCase()}`,
    );
}

test("Telegram's header and background take the app's paper and its bottom bar the card, before it is ready and again when the theme changes (direction §6.1; «Усе на бірці» task list, P0-1)", async ({
  page,
}) => {
  await hearTelegram(page);
  await page.goto(launch("8.0", light));
  await expect
    .poll(async () => (await told(page)).map(({ event }) => event))
    .toContain("web_app_ready");
  const events = await told(page);
  const ready = events.findIndex(({ event }) => event === "web_app_ready");
  // All three before «ready», so Telegram shows the app in them at once.
  expect(painted(events.slice(0, ready))).toEqual([
    "web_app_set_header_color #ecede7",
    "web_app_set_background_color #ecede7",
    "web_app_set_bottom_bar_color #ffffff",
  ]);
  expect(painted(events.slice(ready))).toEqual([]);
  // Telegram turned dark: its strips with the app.
  await page.evaluate((theme_params) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          eventType: "theme_changed",
          eventData: { theme_params },
        }),
        source: window.parent,
      }),
    );
  }, dark);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(painted((await told(page)).slice(events.length))).toEqual([
    "web_app_set_header_color #0d0e0a",
    "web_app_set_background_color #0d0e0a",
    "web_app_set_bottom_bar_color #181a14",
  ]);
});

test("a colour written short, as the build writes white, still reaches Telegram as #rrggbb (review of P0-1)", async ({
  page,
}) => {
  await hearTelegram(page);
  await page.goto(launch("8.0", light));
  await expect
    .poll(async () => (await told(page)).map(({ event }) => event))
    .toContain("web_app_ready");
  const before = (await told(page)).length;
  await page.addStyleTag({
    content: ":root { --paper: #ABC !important; --card: #FEF !important; }",
  });
  await page.evaluate((theme_params) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          eventType: "theme_changed",
          eventData: { theme_params },
        }),
        source: window.parent,
      }),
    );
  }, light);
  await expect
    .poll(async () => painted((await told(page)).slice(before)))
    .toEqual([
      "web_app_set_header_color #aabbcc",
      "web_app_set_background_color #aabbcc",
      "web_app_set_bottom_bar_color #ffeeff",
    ]);
});

for (const [version, expected] of [
  ["6.0", []],
  ["6.1", ["web_app_set_background_color #0d0e0a"]],
  [
    "6.9",
    [
      "web_app_set_header_color #0d0e0a",
      "web_app_set_background_color #0d0e0a",
    ],
  ],
  [
    "7.10",
    [
      "web_app_set_header_color #0d0e0a",
      "web_app_set_background_color #0d0e0a",
      "web_app_set_bottom_bar_color #181a14",
    ],
  ],
] as const)
  test(`a Telegram of ${version} is asked only for the colours it knows (P0-1)`, async ({
    page,
  }) => {
    await hearTelegram(page);
    await page.goto(launch(version, dark));
    await expect
      .poll(async () => (await told(page)).map(({ event }) => event))
      .toContain("web_app_ready");
    expect(painted(await told(page))).toEqual(expected);
  });

test("outside Telegram nothing is painted, nor anything told (P0-1)", async ({
  page,
}) => {
  await hearTelegram(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  expect(await told(page)).toEqual([]);
});

for (const [version, swipe] of [
  ["8.0", true],
  ["6.0", false],
] as const)
  test(`once ready, a Telegram of ${version} is asked once for the whole height${swipe ? " and to keep a downward swipe from closing the app" : ", and of the swipe nothing it does not know"} (direction §6.1; «Усе на бірці» task list, P0-4)`, async ({
    page,
  }) => {
    await hearTelegram(page);
    await page.goto(launch(version, light));
    await expect
      .poll(async () => (await told(page)).map(({ event }) => event))
      .toContain("web_app_ready");
    // Whatever else is said afterwards, a store opened, nothing is asked
    // twice.
    await openStore(page, "Основний MAIN");
    await expect(
      page.getByRole("navigation", { name: "Розділи" }),
    ).toBeVisible();
    const events = await told(page);
    const ready = events.findIndex(({ event }) => event === "web_app_ready");
    const asked = events.filter(({ event }) =>
      ["web_app_expand", "web_app_setup_swipe_behavior"].includes(event),
    );
    expect(asked).toEqual([
      { event: "web_app_expand", data: null },
      ...(swipe
        ? [
            {
              event: "web_app_setup_swipe_behavior",
              data: { allow_vertical_swipe: false },
            },
          ]
        : []),
    ]);
    for (const { event } of asked)
      expect(events.findIndex((told) => told.event === event)).toBeGreaterThan(
        ready,
      );
  });

/** The WCAG contrast of two `#rrggbb` colours. */
function ratio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
      const v = parseInt(hex.slice(at, at + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Text on its ground, each at 4.5:1 at least (direction §4, «Контраст»). */
const texts = [
  ["--ink", "--paper"],
  ["--ink", "--card"],
  ["--ink", "--fold"],
  ["--pencil", "--paper"],
  ["--pencil", "--card"],
  ["--pencil", "--fold"],
  ["--on-primary", "--primary"],
  ["--on-chosen", "--chosen"],
  ["--link", "--card"],
  ["--on-inverse", "--inverse"],
  ["--inverse-pencil", "--inverse"],
  ["--paid", "--paid-bg"],
  ["--owed", "--owed-bg"],
  ["--owed", "--card"],
  ["--warning", "--warning-bg"],
  ["--transit", "--transit-bg"],
  ["--online", "--online-bg"],
  ["--offline", "--offline-bg"],
  ["--damaged", "--damaged-bg"],
  ["--danger", "--danger-bg"],
  ["--on-owed", "--owed"],
  ["--on-warning", "--warning"],
  ["--on-danger", "--danger"],
] as const;

/** A field's or a quiet button's edge, and the focus ring, at 3:1. */
const edges = [
  ["--edge", "--card"],
  ["--edge", "--paper"],
  ["--focus", "--paper"],
  ["--focus", "--card"],
] as const;

/** Each name before «Усе на бірці» and the token it now is (task list,
 * P0-1, 1): screens not yet redrawn take the new colours as they are. */
const aliases = [
  ["--bg", "--paper"],
  ["--surface", "--card"],
  ["--field", "--fold"],
  ["--text", "--ink"],
  ["--text-2", "--pencil"],
  ["--line", "--hairline"],
  ["--line-strong", "--edge"],
  ["--accent", "--primary"],
  ["--on-accent", "--on-primary"],
  ["--accent-text", "--link"],
  ["--accent-soft", "--fold"],
  ["--debt", "--owed"],
  ["--debt-bg", "--owed-bg"],
  ["--warn", "--warning"],
  ["--warn-bg", "--warning-bg"],
  ["--warn-line", "--warning"],
  ["--dark-card", "--inverse"],
  ["--on-dark-card", "--on-inverse"],
  ["--dark-card-line", "--inverse-edge"],
] as const;

/** Every token of the page as it is drawn now, by name. */
async function tokensOf(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      Array.from(style)
        .filter((name) => name.startsWith("--"))
        .map((name) => [name, style.getPropertyValue(name).trim()]),
    );
  });
}

for (const scheme of ["light", "dark"] as const)
  test(`every pair of the design reads in the ${scheme} theme: text at 4.5:1, an edge at 3:1 (direction §4; P0-1)`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Вхід через Telegram" }),
    ).toBeVisible();
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, scheme);
    const tokens = await tokensOf(page);
    const colour = (name: string): string => {
      const value = tokens[name];
      if (!value || !/^#[0-9a-f]{6}$/i.test(value))
        throw new Error(`${name} is not a colour: ${String(value)}`);
      return value;
    };
    for (const [fore, back] of texts)
      expect(
        ratio(colour(fore), colour(back)),
        `${fore} on ${back}`,
      ).toBeGreaterThanOrEqual(4.5);
    for (const [fore, back] of edges)
      expect(
        ratio(colour(fore), colour(back)),
        `${fore} against ${back}`,
      ).toBeGreaterThanOrEqual(3);
    // The names before «Усе на бірці» are the new tokens of their meaning.
    for (const [old, now] of aliases)
      expect(
        await page.evaluate(
          ([a, b]: readonly string[]) => {
            const probe = document.createElement("span");
            document.body.append(probe);
            probe.style.color = `var(${a ?? ""})`;
            const first = getComputedStyle(probe).color;
            probe.style.color = `var(${b ?? ""})`;
            const second = getComputedStyle(probe).color;
            probe.remove();
            return first === second;
          },
          [old, now],
        ),
        `${old} is ${now}`,
      ).toBe(true);
  });

test("outside Telegram the device's dark is the dark Telegram gets, and Telegram's light wins over a dark device (P0-1)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  const device = await tokensOf(page);
  expect([device["--paper"], device["--card"]]).toEqual(["#0d0e0a", "#181a14"]);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  expect(await tokensOf(page)).toEqual(device);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  const light = await tokensOf(page);
  expect([light["--paper"], light["--card"]]).toEqual(["#ecede7", "#ffffff"]);
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
  expect(await tokensOf(page)).toEqual(light);
});

test("a heading is drawn in the display face, not in what stands after it, once the face is at hand (P0-1)", async ({
  page,
}) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Вхід через Telegram" });
  await expect(heading).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // `optional` lets a very first open keep the fallback; from then on the
  // face is at hand from the first paint.
  await page.reload();
  await expect(heading).toBeVisible();
  // The heading's word in its own face, and in the faces after it alone.
  const [drawn, fallback] = await heading.evaluate((node) => {
    const style = getComputedStyle(node);
    return [
      style.fontFamily,
      style.fontFamily.replace(/^"Fira Sans Extra Condensed",\s*/, ""),
    ].map((family) => {
      const probe = document.createElement("span");
      probe.textContent = node.textContent;
      Object.assign(probe.style, {
        position: "absolute",
        whiteSpace: "nowrap",
        fontFamily: family,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
      });
      document.body.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    });
  });
  const headingWidth = await heading.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node.firstChild ?? node);
    return range.getBoundingClientRect().width;
  });
  expect(drawn).not.toBeCloseTo(fallback ?? 0, 0);
  expect(headingWidth).toBeCloseTo(drawn ?? 0, 0);
});

test("the display face is one file of the app's own, never from the network, and draws the headings (direction §4, «Шрифт»; P0-1)", async ({
  page,
}) => {
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fonts.push(request.url());
  });
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "Вхід через Telegram" });
  await expect(heading).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(fonts).toHaveLength(1);
  const [font = ""] = fonts;
  expect(new URL(font).origin).toBe(new URL(page.url()).origin);
  expect(new URL(font).pathname).toMatch(
    /fira-sans-extra-condensed-800(-[\w-]+)?\.woff2$/,
  );
  expect(
    await heading.evaluate((node) => getComputedStyle(node).fontFamily),
  ).toMatch(/^"Fira Sans Extra Condensed"/);
  expect(
    await page.evaluate(() =>
      document.fonts.check('800 34px "Fira Sans Extra Condensed"', "Бірка ₴"),
    ),
  ).toBe(true);
});

test("a sum keeps «грн» on its line: no-break spaces between thousands and before «грн», every kopeck kept, a true minus (P0-1)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Вхід через Telegram" }),
  ).toBeVisible();
  const written = await page.evaluate(async () => {
    const { money } = (await import("/src/orders/types.ts")) as {
      money: (value: string) => string;
    };
    const { signed } = (await import("/src/cash/format.ts")) as {
      signed: (value: string) => string;
    };
    return [
      money("1850.00"),
      money("0.07"),
      money("1234567890.99"),
      money("5"),
      money("пусто"),
      signed("-150.50"),
    ];
  });
  expect(written).toEqual([
    "1\u00a0850,00\u00a0грн",
    "0,07\u00a0грн",
    "1\u00a0234\u00a0567\u00a0890,99\u00a0грн",
    "5,00\u00a0грн",
    "—",
    "\u2212150,50\u00a0грн",
  ]);
});

/** Each section of the page, as the browser draws it: its fill, outline,
 * corner and inside. */
async function sectionsDrawn(page: Page): Promise<string[][]> {
  return page.locator("main > section").evaluateAll((all) =>
    all.map((node) => {
      const style = getComputedStyle(node);
      return [
        style.backgroundColor,
        style.borderTopWidth,
        style.borderTopLeftRadius,
        style.paddingLeft,
      ];
    }),
  );
}

/** A colour of the design, as the browser writes it. */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((each) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    probe.style.color = `var(${each})`;
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
}

for (const width of [360, 390])
  test(`at ${String(width)} px every screen is the paper, never a card: no section has a fill, an outline, a corner or an inside of its own, the screen's gutter 16; «Ще»'s and «Гроші»'s rows on a white block, outlined in the light theme alone, its labels on the paper; a plate drawn as a section keeps its own box; a model's detail too (audit after stage 2, frame P0-1)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto("about:blank");
    await page.goto(
      `/#${new URLSearchParams({ tgWebAppData: initData(fixture.network_owner_telegram_user_id) }).toString()}`,
    );
    await openStore(page, "Центр CENTRE");
    // Each screen: its heading, how it is reached, and — where the heading
    // is another's too — its own section, waited for.
    const screens: [string, () => Promise<void>, string?][] = [
      ["Сьогодні", () => Promise.resolve()],
      [
        "Продаж",
        () =>
          menu(page)
            .getByRole("button", { name: "Продаж", exact: true })
            .click(),
      ],
      [
        "Продаж",
        () =>
          tillWays(page)
            .getByRole("button", { name: "Повернути", exact: true })
            .click(),
        "main > section.returns",
      ],
      [
        "Продаж",
        () =>
          tillWays(page)
            .getByRole("button", { name: "Внесок", exact: true })
            .click(),
        "main > section.credits",
      ],
      ["Замовлення", () => section(page, "Замовлення")],
      [
        "Гроші",
        () =>
          menu(page)
            .getByRole("button", { name: "Гроші", exact: true })
            .click(),
      ],
      ["Каса", () => section(page, "Каса")],
      ["Звіт про продажі", () => section(page, "Звіт про продажі")],
      ["Покупці", () => section(page, "Покупці")],
      ["Ще", () => more(page)],
    ];
    for (const [title, go, own] of screens) {
      await go();
      await expect(
        page.getByRole("heading", { name: title, exact: true, level: 1 }),
      ).toBeVisible();
      if (own !== undefined) await expect(page.locator(own)).toBeVisible();
      await expect
        .poll(() => sectionsDrawn(page), { message: title })
        .not.toEqual([]);
      for (const drawn of await sectionsDrawn(page))
        expect(drawn, title).toEqual(["rgba(0, 0, 0, 0)", "0px", "0px", "0px"]);
      expect(
        await page
          .locator("main")
          .evaluate((node) => [
            getComputedStyle(node).paddingLeft,
            getComputedStyle(node).paddingRight,
          ]),
        title,
      ).toEqual(["16px", "16px"]);
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
    }
    // «Ще»: a group's rows on the card's white, 4 round; its label on the
    // paper, nothing white under it.
    const card = await token(page, "--card");
    const blocks = page.locator(".more-group .list-block");
    await expect(blocks.first()).toBeVisible();
    for (const block of await blocks.all())
      expect(
        await block.evaluate((node) => [
          getComputedStyle(node).backgroundColor,
          getComputedStyle(node).borderTopLeftRadius,
        ]),
      ).toEqual([card, "4px"]);
    // Its rows by §6.8 (audit after stage 2, frame P2-2).
    await listRow(
      page,
      page.locator(".more-group .more-row").first(),
      ".more-label",
    );
    await listRow(
      page,
      page
        .locator(".more-group .list-block")
        .first()
        .locator(".more-row")
        .last(),
      ".more-label",
    );
    for (const label of await page.locator(".more-group h3").all())
      expect(
        await label.evaluate((node) => {
          let at: Element | null = node;
          while (at && at !== document.documentElement) {
            const fill = getComputedStyle(at).backgroundColor;
            if (fill !== "rgba(0, 0, 0, 0)") return fill;
            at = at.parentElement;
          }
          return "paper";
        }),
      ).toBe("paper");
    // A plate drawn as a section has a box of its own, the card's gone.
    expect(
      await page.evaluate(() => {
        const plate = document.createElement("section");
        plate.className = "notice";
        plate.textContent = "Пробна плашка";
        document.querySelector("main")?.append(plate);
        const style = getComputedStyle(plate);
        const drawn = [
          style.paddingTop,
          style.paddingLeft,
          style.borderTopWidth,
          style.borderTopStyle,
          style.borderTopLeftRadius,
        ];
        plate.remove();
        return drawn;
      }),
    ).toEqual(["12px", "16px", "1px", "solid", "4px"]);
    // «Гроші»'s rows on the same block; outlined by the hairline in the
    // light theme, by nothing in the dark, where its fill parts it from the
    // paper (spec §4, «Тени» 1).
    await menu(page)
      .getByRole("button", { name: "Гроші", exact: true })
      .click();
    const rows = page.locator(".money-rows .list-block");
    await expect(rows).toBeVisible();
    expect(
      await rows.evaluate((node) => [
        getComputedStyle(node).backgroundColor,
        getComputedStyle(node).borderTopLeftRadius,
        getComputedStyle(node).borderTopColor,
      ]),
    ).toEqual([card, "4px", await token(page, "--hairline")]);
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await token(page, "--card");
    expect(dark).not.toBe(card);
    expect(dark).not.toBe(await token(page, "--paper"));
    await expect(rows).toHaveCSS("background-color", dark);
    await expect(rows).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
    await page.emulateMedia({ colorScheme: "light" });
    // A model's detail (S23), at the main store.
    await page.goto("about:blank");
    await page.goto(
      `/#${new URLSearchParams({ tgWebAppData: initData() }).toString()}`,
    );
    await openStore(page, "Основний MAIN");
    await openModel(page, "Лоран", /^Лоран шоколад 70(?:\.0)? см$/);
    await expect
      .poll(() => sectionsDrawn(page), { message: "S23" })
      .not.toEqual([]);
    for (const drawn of await sectionsDrawn(page))
      expect(drawn, "S23").toEqual(["rgba(0, 0, 0, 0)", "0px", "0px", "0px"]);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
  });

/** Opened from Telegram of 8.0 as the network's owner, its theme light. */
function ownerInTelegram(): string {
  const hash = new URLSearchParams({
    tgWebAppData: initData(fixture.network_owner_telegram_user_id),
    tgWebAppVersion: "8.0",
    tgWebAppThemeParams: JSON.stringify(light),
  });
  return `/#${hash.toString()}`;
}

/** How many mains a screen shows: its own `.primary`, the MainButton's
 * place outside Telegram, and Telegram's MainButton when last told shown. */
async function mainsShown(page: Page): Promise<number> {
  // The till's three ways, the primary each, are one main together.
  const own = await page
    .locator(
      "button.primary:visible, .main-mimic:visible, .till-tray .pay-ways:visible, .till-dock .pay-ways:visible",
    )
    .count();
  const last = (await told(page))
    .filter(({ event }) => event === "web_app_setup_main_button")
    .at(-1);
  const telegram =
    (last?.data as { is_visible?: boolean } | null | undefined)?.is_visible ===
    true
      ? 1
      : 0;
  return own + telegram;
}

/** The screens that say what could not be read when every list fails;
 * «Сьогодні» and «Ще» draw no plate. */
const PLATES = ["Продаж", "Замовлення", "Гроші", "Каса", "Покупці"];

for (const failing of [false, true])
  test(`one main a screen at most — its own or Telegram's — on «Сьогодні», «Ще», «Продаж», «Замовлення», «Покупці», «Каса» and «Гроші»${failing ? ", with what could not be read said on it, its «Спробувати ще раз» the secondary button" : ""} (spec S04, S07, S08, S16, S19, S25, S29; audit after stage 2, frame P1-1${failing ? ", P1-2" : ""})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await hearTelegram(page);
    await page.goto(ownerInTelegram());
    await openStore(page, "Центр CENTRE");
    if (failing)
      // Every list refused once the store is open: what is shown says so.
      await page.route("**/api/v1/**", async (route) => {
        const { pathname } = new URL(route.request().url());
        if (
          route.request().method() !== "GET" ||
          /\/api\/v1\/(?:me|stores|auth)\b/.test(pathname)
        ) {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 500, json: { code: "INTERNAL" } });
      });
    const screens: [string, () => Promise<void>][] = [
      ["Сьогодні", () => Promise.resolve()],
      [
        "Продаж",
        () =>
          menu(page)
            .getByRole("button", { name: "Продаж", exact: true })
            .click(),
      ],
      ["Замовлення", () => section(page, "Замовлення")],
      [
        "Гроші",
        () =>
          menu(page)
            .getByRole("button", { name: "Гроші", exact: true })
            .click(),
      ],
      ["Каса", () => section(page, "Каса")],
      ["Покупці", () => section(page, "Покупці")],
      ["Ще", () => more(page)],
    ];
    const plates: string[] = [];
    for (const [title, go] of screens) {
      await go();
      await expect(
        page.getByRole("heading", { name: title, exact: true, level: 1 }),
      ).toBeVisible();
      if (failing) {
        // Said once the screen's reads have failed — waited for, not
        // glanced at.
        const plate = page.locator(".read-failure").first();
        if (
          await plate.waitFor({ state: "visible", timeout: 4_000 }).then(
            () => true,
            () => false,
          )
        ) {
          plates.push(title);
          const retry = plate.getByRole("button", {
            name: "Спробувати ще раз",
          });
          await expect(retry).toHaveCSS(
            "background-color",
            await token(page, "--card"),
          );
          await expect(retry).not.toHaveClass(/\bprimary\b/);
        }
      }
      // Settled: the screen's reads answered, Telegram told.
      await page.waitForTimeout(300);
      expect(await mainsShown(page), title).toBeLessThanOrEqual(1);
    }
    if (failing) expect(plates).toEqual(PLATES);
  });

for (const scheme of ["light", "dark"] as const)
  test(`in the ${scheme} theme a button is the secondary one — the card, an edge, ink, 15/600, 44 high, 8 round — unless it says it is the screen's main, primary 52 and 17/700; a field 8 round, typed 16/400, the card on the paper and the fold in a sheet; the focus ring 2 at 2; what is said under 14/500 in pencil; no weight but the roles' (audit after stage 2, frame P1-1)`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(
      `/#${new URLSearchParams({ tgWebAppData: initData(fixture.network_owner_telegram_user_id) }).toString()}`,
    );
    await openStore(page, "Центр CENTRE");
    const [card, edge, ink, primary, onPrimary, pencil, fold] =
      await Promise.all(
        [
          "--card",
          "--edge",
          "--ink",
          "--primary",
          "--on-primary",
          "--pencil",
          "--fold",
        ].map((name) => token(page, name)),
      );
    const drawn = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return null;
      const keys = [
        "background-color",
        "border-top-width",
        "border-top-color",
        "color",
        "border-top-left-radius",
        "min-height",
        "font-size",
        "font-weight",
      ];
      // Drawn on the paper for a moment, read, and gone.
      const read = (html: string, pick: string): string[] => {
        const box = document.createElement("div");
        box.innerHTML = html;
        main.append(box);
        const style = getComputedStyle(box.querySelector(pick) ?? box);
        const out = keys.map((key) => style.getPropertyValue(key));
        box.remove();
        return out;
      };
      return {
        base: read("<button>Зрозуміло</button>", "button"),
        main: read('<button class="primary">Новий продаж</button>', "button"),
        // In its label, whose 14/700 it never takes.
        field: read("<label>Ціна, грн<input></label>", "input"),
        inSheet: read(
          '<div class="sheet"><label>Ціна, грн<input></label></div>',
          "input",
        ),
        hint: read('<p class="hint">Під полем</p>', "p"),
        small: read("<small>Під полем</small>", "small"),
        meta: read('<span class="more-meta">2 чекають</span>', "span"),
        label: read("<label>Ціна, грн</label>", "label"),
        // A row that is a button reads in the body's 16.
        row: read('<button class="sale-row">Рядок</button>', "button"),
        // A field of its own look keeps it in a white block.
        keypad: read(
          '<div class="pay-panel"><input class="keypad-sum"></div>',
          "input",
        ),
        // A search in a sheet: the fold on its white (review).
        search: read(
          '<div class="sheet"><div class="search-field"><input type="search"></div></div>',
          "input",
        ),
      };
    });
    expect(drawn).not.toBeNull();
    if (!drawn) return;
    expect(drawn.base).toEqual([
      card,
      "1px",
      edge,
      ink,
      "8px",
      "44px",
      "15px",
      "600",
    ]);
    expect(drawn.main).toEqual([
      primary,
      "1px",
      "rgba(0, 0, 0, 0)",
      onPrimary,
      "8px",
      "52px",
      "17px",
      "700",
    ]);
    expect([
      drawn.field[0],
      drawn.field[4],
      drawn.field[6],
      drawn.field[7],
    ]).toEqual([card, "8px", "16px", "400"]);
    expect(drawn.inSheet[0]).toBe(fold);
    for (const said of [drawn.hint, drawn.small, drawn.meta])
      expect([said[3], said[6], said[7]]).toEqual([pencil, "14px", "500"]);
    expect([drawn.label[6], drawn.label[7]]).toEqual(["14px", "700"]);
    expect(drawn.row[6]).toBe("16px");
    expect(drawn.keypad[0]).toBe(card);
    expect(drawn.search[0]).toBe(fold);
    // A real button, reached by the keyboard: its ring 2, 2 away — never
    // one inside a tag or the menu, whose ring is drawn inward.
    for (let at = 0; at < 30; at += 1) {
      await page.keyboard.press("Tab");
      if (
        await page.evaluate(() => {
          const node = document.activeElement;
          return (
            node instanceof HTMLButtonElement &&
            !node.matches(
              ".tab, .tag-row, .tag-hero, .order-row, .cash-card, .opening-hero-in",
            )
          );
        })
      )
        break;
    }
    expect(
      await page.evaluate(() => {
        const node = document.activeElement;
        if (!(node instanceof HTMLButtonElement)) return null;
        const style = getComputedStyle(node);
        return [
          node.matches(":focus-visible"),
          style.outlineStyle,
          style.outlineWidth,
          style.outlineOffset,
        ];
      }),
    ).toEqual([true, "solid", "2px", "2px"]);
    // No weight but the roles' — 400, 500, 600, 700, 800 — in the sheet.
    const css = readFileSync("src/styles.css", "utf8");
    expect(
      css
        .match(/font-weight:\s*\d+/g)
        ?.filter((w) => !/\b(?:400|500|600|700|800)$/.test(w)) ?? [],
    ).toEqual([]);
  });
