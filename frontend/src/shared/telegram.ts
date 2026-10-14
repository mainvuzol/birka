import { on, postEvent } from "@telegram-apps/sdk-react";

/** Launch credentials stay in memory: the SDK launch reader persists them. */
export function telegramInitData(): string | null {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  return hash.get("tgWebAppData") ?? query.get("tgWebAppData");
}

/**
 * The Telegram account number in the launch data, unverified: shown only to
 * its own holder, to pass on so they can be given access.
 */
export function telegramUserId(): number | null {
  const initData = telegramInitData();
  if (!initData) return null;
  try {
    const user = JSON.parse(
      new URLSearchParams(initData).get("user") ?? "null",
    ) as { id?: unknown } | null;
    return typeof user?.id === "number" ? user.id : null;
  } catch {
    return null;
  }
}

/**
 * Light or dark, as Telegram is (redesign P0-5): the app paints its own
 * palette (`styles.css`), and takes from Telegram only which of the two. The
 * brightness of Telegram's background decides it, as Telegram's own
 * `colorScheme` is derived; outside Telegram the device's setting does.
 */
export function schemeOf(
  theme: Record<string, unknown>,
): "light" | "dark" | null {
  const bg = theme.bg_color;
  if (typeof bg !== "string" || !/^#[0-9a-f]{6}$/i.test(bg)) return null;
  const channel = (at: number): number => parseInt(bg.slice(at, at + 2), 16);
  // Perceived brightness (ITU-R BT.601), 0–255.
  const brightness =
    0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5);
  return brightness < 128 ? "dark" : "light";
}

function applyTheme(theme: Record<string, unknown>): void {
  const scheme = schemeOf(theme);
  if (scheme) document.documentElement.dataset.theme = scheme;
}

/** Notify the host after rendering; keep bridge calls out of business UI. */
export function connectTelegram(): () => void {
  if (!telegramInitData()) return () => undefined;
  const rawTheme = new URLSearchParams(window.location.hash.slice(1)).get(
    "tgWebAppThemeParams",
  );
  if (rawTheme) {
    try {
      applyTheme(JSON.parse(rawTheme) as Record<string, unknown>);
    } catch {
      /* Keep accessible defaults. */
    }
  }
  const unsubscribe = on("theme_changed", ({ theme_params }) => {
    applyTheme(theme_params);
  });
  try {
    postEvent("web_app_ready");
    postEvent("web_app_request_theme");
  } catch {
    /* A browser test can supply signed launch data without a Telegram host. */
  }
  return unsubscribe;
}
