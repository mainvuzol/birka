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

/**
 * Telegram's header, background and bottom bar in the app's own colours
 * (direction §6.1; «Усе на бірці» task list, P0-1): the header and the
 * background the screen's paper, the bottom bar its card, so no stripe of
 * Telegram's colour cuts the screen. Read from the theme just applied, and
 * only where the version knows each: the header's own colour since 6.9, the
 * bottom bar's since 7.10. Told once per change of colour: a theme Telegram
 * sends again unchanged, or the app connecting twice, says nothing new.
 */
let painted: string | null = null;
function paintTelegram(): void {
  const version = launchParam("tgWebAppVersion");
  if (!version) return;
  const paper = colourOf("--paper");
  const card = colourOf("--card");
  if (painted === `${String(paper)} ${String(card)}`) return;
  painted = `${String(paper)} ${String(card)}`;
  try {
    if (paper && supports("web_app_set_header_color", "color", version))
      postEvent("web_app_set_header_color", { color: paper });
    if (paper && supports("web_app_set_background_color", version))
      postEvent("web_app_set_background_color", { color: paper });
    if (card && supports("web_app_set_bottom_bar_color", version))
      postEvent("web_app_set_bottom_bar_color", { color: card });
  } catch {
    /* No Telegram host to paint. */
  }
}

/**
 * A colour token as Telegram takes it, `#rrggbb`: read as the page draws it,
 * since the build writes white as `#fff` (review of P0-1, 2026-10-28).
 */
function colourOf(token: string): `#${string}` | null {
  const probe = document.createElement("span");
  probe.style.color = `var(${token}, transparent)`;
  document.documentElement.append(probe);
  const drawn = getComputedStyle(probe).color;
  probe.remove();
  const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(drawn);
  if (!rgb) return null;
  return `#${rgb
    .slice(1)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Telegram's own height for the app once it stops moving: the keyboard and
 * the sheet being dragged leave it as it was, so nothing jumps
 * (`--tg-viewport-stable-height`, read by `styles.css`; direction §6.3).
 */
function keepStableHeight(height: number, stable: boolean): void {
  if (!stable || height <= 0) return;
  document.documentElement.style.setProperty(
    "--tg-viewport-stable-height",
    `${String(height)}px`,
  );
}

/** Whether the whole height and the swipe were asked for: once a launch,
 * however often the app connects. */
let expanded = false;

/** Notify the host after rendering; keep bridge calls out of business UI.
 * Its colours go first, so Telegram shows the app in them when it is ready.
 * Once ready the app asks for the whole height and keeps a downward swipe
 * from closing it (direction §6.1; «Усе на бірці» task list, P0-4), where
 * the version knows it. */
export function connectTelegram(): () => void {
  if (!telegramInitData()) return () => undefined;
  launchTheme();
  paintTelegram();
  const unsubscribe = on("theme_changed", ({ theme_params }) => {
    applyTheme(theme_params);
    paintTelegram();
  });
  const unwatch = on("viewport_changed", ({ height, is_state_stable }) => {
    keepStableHeight(height, is_state_stable);
  });
  const unpress = on("back_button_pressed", pressBack);
  const version = launchParam("tgWebAppVersion");
  try {
    postEvent("web_app_ready");
    postEvent("web_app_request_theme");
    if (!expanded) {
      expanded = true;
      postEvent("web_app_expand");
      if (version && supports("web_app_setup_swipe_behavior", version))
        postEvent("web_app_setup_swipe_behavior", {
          allow_vertical_swipe: false,
        });
    }
    postEvent("web_app_request_viewport");
  } catch {
    /* A browser test can supply signed launch data without a Telegram host. */
  }
  return () => {
    unsubscribe();
    unwatch();
    unpress();
  };
}

/** A screen's «←», as Telegram's «Назад» knows it. */
export interface BackWay {
  /** What the «←» does. */
  go: () => void;
  /** Held while a send or a kept operation stands: no way out. */
  held: boolean;
  /** Drawn on the screen shown: an order's card stays mounted, hidden,
   * under its step's screen. */
  drawn: () => boolean;
}

/** The «←»s mounted, in the order they came: the last drawn is the screen's
 * own, a step's over its card's, «До пошуку» over «← Ще». */
const ways: BackWay[] = [];

function wayOut(): BackWay | undefined {
  return [...ways].reverse().find((way) => way.drawn());
}

/** Whether Telegram was last told to show its «Назад»: hidden as the app
 * opens. */
let backShown = false;
let backAsked = false;

/**
 * Telegram's «Назад» (direction §6.8; «Усе на бірці» task list, P1-1):
 * shown while a screen's «←» is drawn and free, hidden on a tab's first
 * screen, where Telegram offers «Закрити» in its place, and while the «←» is
 * held. Read once the screen has settled — a step's «←» comes as its card's
 * is hidden, and Telegram's never blinks between them — and told only when
 * it changes, only inside Telegram, and only where the version knows it.
 */
export function showBack(): void {
  if (backAsked) return;
  backAsked = true;
  queueMicrotask(() => {
    backAsked = false;
    tellBack();
  });
}

function tellBack(): void {
  const way = wayOut();
  const shown = way !== undefined && !way.held;
  if (shown === backShown || !telegramInitData()) return;
  const version = launchParam("tgWebAppVersion");
  if (!version || !supports("web_app_setup_back_button", version)) return;
  backShown = shown;
  try {
    postEvent("web_app_setup_back_button", { is_visible: shown });
  } catch {
    /* No Telegram host to tell. */
  }
}

/** A «←» mounted: Telegram's «Назад» does what it does while it is the
 * screen's. Unmounted by what this returns. */
export function addBackWay(way: BackWay): () => void {
  ways.push(way);
  showBack();
  return () => {
    const at = ways.indexOf(way);
    if (at >= 0) ways.splice(at, 1);
    showBack();
  };
}

/** Telegram's «Назад» pressed: the screen's «←», unless it is held. */
function pressBack(): void {
  const way = wayOut();
  if (way && !way.held) way.go();
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
