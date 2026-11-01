import { useEffect, useState } from "react";
import type { JSX } from "react";
import { timeOf } from "@/cash/errors";
import { Icon } from "@/shared/Icon";
import { STALE_AFTER } from "./reads";
import type { Age } from "./reads";

/**
 * How old what a screen of the day shows is, said alike on «Сьогодні» and
 * «Гроші» (spec §6.17; «Усе на бірці» task list, P0-6; sections task list,
 * P0-7): the day, the clock, the stamp, a line held while it is read.
 */

const weekdays = [
  "Неділя",
  "Понеділок",
  "Вівторок",
  "Середа",
  "Четвер",
  "П’ятниця",
  "Субота",
];
const months = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

/** «Четвер, 22 жовтня»: the stores' own day once the report gives it, the
 * phone's before. */
export function dayLine(day: string | undefined): string {
  const date = day ? new Date(`${day}T12:00:00`) : new Date();
  const weekday = weekdays[date.getDay()] ?? "";
  const month = months[date.getMonth()] ?? "";
  return `${weekday}, ${String(date.getDate())} ${month}`;
}

/** The clock, read again every quarter of a minute: what was live five
 * minutes ago is said to be old. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      window.clearInterval(tick);
    };
  }, []);
  return now;
}

/** A line still read, in its place. */
export function Waiting({ width }: { width: string }): JSX.Element {
  return (
    <span
      className="skeleton-line day-wait"
      style={{ width }}
      aria-hidden="true"
    />
  );
}

/** Not live: older than five minutes, or the last asking of a read
 * failed. */
export function staleOf(age: Age, now: number): boolean {
  return age.failed || (age.at !== undefined && now - age.at > STALE_AFTER);
}

/** How old the day-tag's figures are (spec §6.17): «● наживо · 11:40», or
 * «дані на 11:32» in a warning's colour when older than five minutes or
 * the last asking failed — «— сервер не відповідає» when it went
 * unanswered. */
export function Stamp({ age, now }: { age: Age; now: number }): JSX.Element {
  if (age.at === undefined)
    return age.failed ? (
      <span className="day-stamp stale">
        <Icon name="warning" size={16} />
        {age.silent ? "сервер не відповідає" : "не вдалося прочитати"}
      </span>
    ) : (
      <Waiting width="7em" />
    );
  const at = timeOf(new Date(age.at).toISOString());
  if (!staleOf(age, now))
    return (
      <span className="day-stamp live">
        <span className="live-dot" aria-hidden="true" />
        наживо · {at}
      </span>
    );
  return (
    <span className="day-stamp stale">
      <Icon name="warning" size={16} />
      дані на {at}
      {age.silent && " — сервер не відповідає"}
    </span>
  );
}
