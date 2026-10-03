import { ApiError } from "@/shared/api";
import { telegramInitData } from "@/shared/telegram";

/**
 * A short note of a broken screen, sent to our own server's log only (owner
 * decision, 2026-10-03): which screen, which error, the app's version and the
 * request's number. It never holds a name, a phone, what was typed, or the
 * Telegram number — so nothing here reads the address (the launch data sits
 * in it), storage (the saved commands hold customers' names and phones), a
 * form, or the person.
 */
export const release: string = __BIRKA_RELEASE__;

let screen = "sign-in";

/** The screen a note names: App sets it as the person moves between them. */
export function setScreen(name: string): void {
  screen = name;
}

type Kind = "render" | "error" | "rejection";

// A broken screen often throws the same error again and again; a page load
// sends each one once, and five at most, so a loop cannot flood the server.
const MAX_NOTES = 5;
const sent = new Set<string>();

/** The error's name and message, never a thrown value's own content. */
function describe(error: unknown): { name: string; message: string } {
  if (error instanceof ApiError)
    return {
      name: "ApiError",
      message: `${String(error.status)} ${error.code}`,
    };
  if (error instanceof Error)
    return { name: error.name || "Error", message: error.message };
  // A thrown string or object may be anything, a form's values included.
  return {
    name: "NonError",
    message: `A value of type ${error === null ? "null" : typeof error} was thrown.`,
  };
}

/**
 * The launch data out of a message, should a browser have quoted the page's
 * address in it: it holds the person's name and Telegram number.
 */
function withoutLaunchData(text: string): string {
  let clean = text;
  for (const part of [
    window.location.href,
    window.location.hash,
    window.location.search,
    telegramInitData() ?? "",
  ])
    if (part.length > 1) clean = clean.split(part).join("[адреса]");
  return clean.replace(/tgWebAppData=\S*/g, "[адреса]");
}

function requestId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.requestId === null) return null;
  return /^[A-Za-z0-9._-]{1,64}$/.test(error.requestId)
    ? error.requestId
    : null;
}

/**
 * Send the note. It carries no session (a screen can break before sign-in),
 * no referrer (the page's address), and is kept alive past a reload. A note
 * that fails is dropped: the person is not to see a second failure.
 */
export function reportError(kind: Kind, error: unknown): void {
  try {
    const { name, message } = describe(error);
    const key = `${name}\n${message}`;
    if (sent.has(key) || sent.size >= MAX_NOTES) return;
    sent.add(key);
    void fetch("/api/v1/client-errors", {
      method: "POST",
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        screen: screen.slice(0, 40),
        name: name.slice(0, 80),
        message: withoutLaunchData(message).slice(0, 500),
        release: release.slice(0, 40),
        request_id: requestId(error),
      }),
    }).catch(() => undefined);
  } catch {
    /* Nothing more can be done for a note that cannot even be written. */
  }
}

/**
 * Note what the screen survives: an error thrown outside rendering (a button's
 * handler, a timer) and a promise nobody awaited. Neither replaces the screen.
 *
 * Each is noted a moment later, so a render crash that the browser also sees
 * as an error — React's development build throws it again for the console —
 * is noted once, as the crash it is.
 */
export function noteUnhandledErrors(): void {
  window.addEventListener("error", (event) => {
    const error: unknown = event.error;
    setTimeout(() => {
      reportError("error", error);
    }, 0);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    setTimeout(() => {
      reportError("rejection", reason);
    }, 0);
  });
}
