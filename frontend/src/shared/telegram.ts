import { isColorDark, on, postEvent, supports } from "@telegram-apps/sdk-react";

/** Launch credentials stay in memory: the SDK launch reader persists them. */
export function telegramInitData(): string | null {
  return launchParam("tgWebAppData");
}

/** A launch parameter, from the hash or the query, as Telegram passes it. */
function launchParam(name: string): string | null {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  return hash.get(name) ?? query.get(name);
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
 * background's colour decides it by Telegram's own rule, the SDK's
 * `isColorDark`, as Telegram's `colorScheme` is derived; outside Telegram the
 * device's setting does (the stylesheet's `prefers-color-scheme`).
 */
export function schemeOf(
  theme: Record<string, unknown>,
): "light" | "dark" | null {
  const bg = theme.bg_color;
  if (typeof bg !== "string" || !/^#[0-9a-f]{6}$/i.test(bg)) return null;
  return isColorDark(bg) ? "dark" : "light";
}

function applyTheme(theme: Record<string, unknown>): void {
  const scheme = schemeOf(theme);
  if (scheme) document.documentElement.dataset.theme = scheme;
}

function launchTheme(): void {
  const rawTheme = new URLSearchParams(window.location.hash.slice(1)).get(
    "tgWebAppThemeParams",
  );
  if (!rawTheme) return;
  try {
    applyTheme(JSON.parse(rawTheme) as Record<string, unknown>);
  } catch {
    /* Keep the device's scheme. */
  }
}

/**
 * The launch theme, before the first paint: the sign-in screen never shows
 * in the other scheme first (review, 2026-10-15).
 */
export function applyLaunchTheme(): void {
  if (telegramInitData()) launchTheme();
}

/** Notify the host after rendering; keep bridge calls out of business UI. */
export function connectTelegram(): () => void {
  if (!telegramInitData()) return () => undefined;
  launchTheme();
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

/**
 * A buzz in the hand when the server answers the till's press (redesign
 * P1-1): success once a sale is recorded, error once it is refused. Only
 * inside Telegram, and only where its version has haptics.
 */
export function buzz(kind: "success" | "error"): void {
  if (!telegramInitData()) return;
  const version = launchParam("tgWebAppVersion");
  try {
    if (!version || !supports("web_app_trigger_haptic_feedback", version))
      return;
    postEvent("web_app_trigger_haptic_feedback", {
      type: "notification",
      notification_type: kind,
    });
  } catch {
    /* No Telegram host to buzz. */
  }
}
