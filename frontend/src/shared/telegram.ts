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

function applyTheme(theme: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(theme)) {
    if (
      /^[a-z_]+$/.test(key) &&
      typeof value === "string" &&
      /^#[0-9a-f]{6}$/i.test(value)
    ) {
      document.documentElement.style.setProperty(
        `--tg-theme-${key.replaceAll("_", "-")}`,
        value,
      );
    }
  }
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
