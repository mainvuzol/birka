/** «14:20», the phone's own time, as the app shows every moment; «—» for
 * a moment that is none. */
function clockOf(iso: string): string {
  return Number.isNaN(Date.parse(iso))
    ? "—"
    : new Date(iso).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** Whether a moment is of the phone's today. */
export function isToday(iso: string, now: number): boolean {
  return new Date(iso).toDateString() === new Date(now).toDateString();
}

/** «сьогодні о 03:15», «учора о 03:15», «28.10 о 03:15»: when, by the
 * phone's day — «Сьогодні»'s, and a kept operation's since another day
 * (audit 2026-11-20, frame P2-3). */
export function whenText(iso: string, now: number): string {
  const at = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = clockOf(iso);
  if (isToday(iso, now)) return `сьогодні о ${time}`;
  if (at.toDateString() === yesterday.toDateString()) return `учора о ${time}`;
  const date = at.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${date} о ${time}`;
}
