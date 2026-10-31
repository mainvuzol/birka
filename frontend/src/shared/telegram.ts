import { useEffect, useRef } from "react";
import {
  compareVersions,
  isColorDark,
  on,
  postEvent,
  supports,
} from "@telegram-apps/sdk-react";

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
    tellMain(true);
  });
  const unwatch = on("viewport_changed", ({ height, is_state_stable }) => {
    keepStableHeight(height, is_state_stable);
  });
  const unpress = on("back_button_pressed", pressBack);
  const unpressMain = on("main_button_pressed", pressMain);
  // Turned upright while a basket holds goods: locked then.
  const turns = uprightNow();
  turns.addEventListener("change", portrait.settle);
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
    unpressMain();
    turns.removeEventListener("change", portrait.settle);
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
 * A buzz in the hand (redesign P1-1; spec §4.4; «Усе на бірці» task list,
 * P1-2): `success` once the server records a sale, a payment, a step;
 * `error` once it refuses; `warning` for an operation kept on the phone and
 * a drawer's difference; `selection` for a choice — a segment, a store, a
 * size picked; `light` for a coat into the basket, ±1, a tag's verb. Never
 * on a scroll, a key or a screen opening. Only inside Telegram, and only
 * where its version has haptics.
 */
export type Buzz = "success" | "error" | "warning" | "selection" | "light";

export function buzz(kind: Buzz): void {
  if (!telegramInitData()) return;
  const version = launchParam("tgWebAppVersion");
  try {
    if (!version || !supports("web_app_trigger_haptic_feedback", version))
      return;
    if (kind === "selection")
      postEvent("web_app_trigger_haptic_feedback", {
        type: "selection_change",
      });
    else if (kind === "light")
      postEvent("web_app_trigger_haptic_feedback", {
        type: "impact",
        impact_style: "light",
      });
    else
      postEvent("web_app_trigger_haptic_feedback", {
        type: "notification",
        notification_type: kind,
      });
  } catch {
    /* No Telegram host to buzz. */
  }
}

/** Telegram's version, inside Telegram: told nothing where it names none,
 * as its «Назад» and its buzz are not. */
function telegramVersion(): string | null {
  return telegramInitData() ? launchParam("tgWebAppVersion") : null;
}

/** Whether this Telegram knows a method its SDK here does not yet: the
 * keyboard's (9.1) and the orientation's (8.0) — or takes for any version:
 * the question before closing (6.2). */
function knows(since: string): boolean {
  const version = telegramVersion();
  return version !== null && compareVersions(version, since) >= 0;
}

/** A method the SDK here does not name, posted as any other. */
function postNew(method: string, params?: Record<string, unknown>): void {
  const post: (method: string, params?: unknown) => void = postEvent;
  post(method, params);
}

/** Something Telegram holds: asked for by screens, and told again when what
 * it may hold by changes. */
interface Held {
  hold: (on: boolean) => void;
  settle: () => void;
}

/**
 * Something Telegram holds while any screen asks for it and `may` allows,
 * told only when it changes, once the screens have settled — a screen and
 * the next asking in turn never make it blink — and only inside Telegram
 * that names its version.
 */
function held(
  tell: (on: boolean) => void,
  may: () => boolean = () => true,
): Held {
  let holds = 0;
  let told = false;
  let asked = false;
  const settle = (): void => {
    if (asked) return;
    asked = true;
    queueMicrotask(() => {
      asked = false;
      const on = holds > 0 && may();
      if (on === told || telegramVersion() === null) return;
      told = on;
      try {
        tell(on);
      } catch {
        /* No Telegram host to tell. */
      }
    });
  };
  return {
    hold: (on: boolean): void => {
      holds += on ? 1 : -1;
      settle();
    },
    settle,
  };
}

/** Held while `on`, by a mounted screen. */
function useHeld({ hold }: Held, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    hold(true);
    return () => {
      hold(false);
    };
  }, [hold, on]);
}

/** Telegram's question before closing came with 6.2, though the SDK here
 * takes it for any version. */
const closing = held((on) => {
  if (knows("6.2"))
    postEvent("web_app_setup_closing_behavior", { need_confirmation: on });
});

/**
 * Telegram asks before Бірка closes (spec §4.4, rule 2; «Усе на бірці» task
 * list, P1-2; В-Т7 (а)) while something here would be lost or left unknown:
 * a basket with goods, a payment's sum typed, a sale waiting to be checked.
 */
export function useAskBeforeClosing(on: boolean): void {
  useHeld(closing, on);
}

/** Telegram's lock keeps the screen as it is, upright or not: asked only
 * while the phone is upright, and as it turns upright (review,
 * 2026-10-31). */
const uprightNow = (): MediaQueryList =>
  window.matchMedia("(orientation: portrait)");

const portrait = held(
  (on) => {
    if (knows("8.0"))
      postNew("web_app_toggle_orientation_lock", { locked: on });
  },
  () => uprightNow().matches,
);

/** The screen kept upright while a basket is open (spec §4.4, rule 7):
 * turning the phone never moves the till under the finger. Held sideways,
 * it is locked once it is upright. */
export function useLockPortrait(on: boolean): void {
  useHeld(portrait, on);
}

/**
 * The keyboard away (spec §4.4, rule 3): a size cell, a search's result
 * tapped, a sum confirmed — what was typed is done with. Telegram's own way
 * where it knows it; and the field lets go of the cursor, which a tap on a
 * button does not take everywhere.
 */
export function hideKeyboard(): void {
  if (knows("9.1")) {
    try {
      postNew("web_app_hide_keyboard");
    } catch {
      /* No Telegram host: the field lets go. */
    }
  }
  // The field lets go in Telegram's way too: the cursor put back later
  // brings the keyboard back (review, 2026-10-31).
  const field = document.activeElement;
  if (
    field instanceof HTMLTextAreaElement ||
    (field instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "submit"].includes(field.type))
  )
    field.blur();
}

/** Whether Telegram's MainButton is here: inside Telegram, any version. */
function mainButtonHere(): boolean {
  return telegramVersion() !== null;
}

/** A screen's one action, as Telegram's MainButton shows it. */
interface MainAction {
  text: string;
  press: () => void;
}

/** The screens that want the MainButton, in the order they came: the last
 * is shown. */
const mains: MainAction[] = [];

/** What Telegram was last told the MainButton says: hidden as the app
 * opens. */
let mainShown: string | null = null;
let mainAsked = false;

/** Told once the screens have settled — a screen mounted twice, or the
 * next taking it from the last, never makes it blink — and only when it
 * changes, unless the theme did. */
function showMain(): void {
  if (mainAsked) return;
  mainAsked = true;
  queueMicrotask(() => {
    mainAsked = false;
    tellMain(false);
  });
}

function tellMain(repaint: boolean): void {
  const text = mains.at(-1)?.text ?? null;
  if ((text === mainShown && !repaint) || !mainButtonHere()) return;
  if (repaint && text === null) return;
  mainShown = text;
  // In the app's `primary` and `on-primary`, read from the theme shown.
  const color = colourOf("--primary");
  const textColor = colourOf("--on-primary");
  try {
    postEvent(
      "web_app_setup_main_button",
      text === null
        ? { is_visible: false }
        : {
            is_visible: true,
            is_active: true,
            text,
            ...(color ? { color } : {}),
            ...(textColor ? { text_color: textColor } : {}),
          },
    );
  } catch {
    /* No Telegram host to tell. */
  }
}

/** Telegram's MainButton pressed: the shown screen's action. */
function pressMain(): void {
  mains.at(-1)?.press();
}

/**
 * Telegram's MainButton for a screen's one action (spec §4.4, rules 4 and
 * 8; «Усе на бірці» task list, P1-2): set as the screen opens, in the app's
 * `primary` and `on-primary`, cleared as it closes; never on the till, the
 * return or a payment, and never one that pays. Pressed, `press`. Says
 * whether it is shown — the screen then draws no button of its own for it;
 * outside Telegram it does.
 */
export function useMainButton(text: string, press: () => void): boolean {
  const here = mainButtonHere();
  const latest = useRef(press);
  useEffect(() => {
    latest.current = press;
  });
  useEffect(() => {
    if (!here) return;
    const main: MainAction = {
      text,
      press: () => {
        latest.current();
      },
    };
    mains.push(main);
    showMain();
    return () => {
      const at = mains.indexOf(main);
      if (at >= 0) mains.splice(at, 1);
      showMain();
    };
  }, [here, text]);
  return here;
}
