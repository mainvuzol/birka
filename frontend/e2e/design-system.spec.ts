import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The design system of «Усе на бірці» (the frame's task list, P0-1): its
 * colours read in both themes, its one face ships with the app, Telegram's
 * header, background and bottom bar take the app's colours before it is
 * ready, and a sum keeps its «грн» on its line.
 */

interface Fixture {
  telegram_user_id: string;
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
  await expect(page.getByRole("heading", { name: "Бірка" })).toBeVisible();
  expect(await told(page)).toEqual([]);
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
    await expect(page.getByRole("heading", { name: "Бірка" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Бірка" })).toBeVisible();
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
  const heading = page.getByRole("heading", { name: "Бірка" });
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
  const heading = page.getByRole("heading", { name: "Бірка" });
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
  await expect(page.getByRole("heading", { name: "Бірка" })).toBeVisible();
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
