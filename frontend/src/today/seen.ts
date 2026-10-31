import { create } from "zustand";

/**
 * What this person has seen on this phone («Бачу»; «Усе на бірці» task
 * list, P0-6, item 5; owner question В-Т3 (а)): a news tag's id alone, by
 * organisation and person, with when it was seen — never what it said.
 * Forgotten after seven days, by then long out of «Сьогодні»'s two days.
 * The screen and the tab's badge read the same, so a tag seen goes from
 * both at once.
 */
export const SEEN_FOR = 7 * 24 * 60 * 60_000;

type Seen = Readonly<Record<string, number>>;

const none: Seen = {};

function storageKey(scopeKey: string): string {
  return `birka:seen:${scopeKey}`;
}

/** What this phone keeps, younger than seven days; what was older is
 * written away. Storage closed or spoilt: nothing seen. */
function load(scopeKey: string, now: number): Seen {
  let kept: Record<string, number> = {};
  try {
    const raw = localStorage.getItem(storageKey(scopeKey));
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null)
      kept = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && now - entry[1] < SEEN_FOR,
        ),
      );
  } catch {
    return none;
  }
  save(scopeKey, kept);
  return kept;
}

function save(scopeKey: string, seen: Seen): void {
  try {
    if (Object.keys(seen).length === 0)
      localStorage.removeItem(storageKey(scopeKey));
    else localStorage.setItem(storageKey(scopeKey), JSON.stringify(seen));
  } catch {
    // A phone that keeps nothing: seen for as long as Бірка stays open.
  }
}

/** Read from storage once a page, then kept here; each change counted, so
 * whoever reads it draws again. */
const loaded = new Map<string, Seen>();
const useSeenStore = create<{ changes: number }>(() => ({ changes: 0 }));

function current(scopeKey: string): Seen {
  const known = loaded.get(scopeKey);
  if (known) return known;
  const read = load(scopeKey, Date.now());
  loaded.set(scopeKey, read);
  return read;
}

function write(scopeKey: string, seen: Seen): void {
  save(scopeKey, seen);
  loaded.set(scopeKey, seen);
  useSeenStore.setState((state) => ({ changes: state.changes + 1 }));
}

/** «Бачу»: seen now. */
export function see(scopeKey: string, id: string): void {
  write(scopeKey, { ...current(scopeKey), [id]: Date.now() });
}

/** «Повернути»: not seen after all. */
export function unsee(scopeKey: string, id: string): void {
  const rest = Object.fromEntries(
    Object.entries(current(scopeKey)).filter(([key]) => key !== id),
  );
  write(scopeKey, rest);
}

/** This person's seen ids on this phone, each with when. */
export function useSeen(scopeKey: string): Seen {
  useSeenStore((state) => state.changes);
  return current(scopeKey);
}
