import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { timeOf } from "@/cash/errors";
import { Icon } from "@/shared/Icon";
import { Unread } from "@/shared/Unread";
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

/** Said in a figure's place where its read failed before it ever answered,
 * as «Гроші» says it (audit 2026-11-13, frame P1-1). */
export const UNREAD = "не вдалося прочитати";

/** The reads of a tag that never answered and whose last asking failed. */
export function failedOf(reads: readonly UseQueryResult[]): UseQueryResult[] {
  return reads.filter((read) => read.isError && read.data === undefined);
}

/** One plate for a tag, however many of its reads failed before they ever
 * answered: its «Спробувати ще раз» asks only those again, as «Гроші»'s
 * places do (audit 2026-11-13, frame P1-1). What was read and failed later
 * keeps its figures and its stamp, and gives none. */
export function Unreads({
  reads,
}: {
  reads: readonly UseQueryResult[];
}): JSX.Element | null {
  const failed = failedOf(reads);
  const first = failed[0];
  if (!first) return null;
  return (
    <Unread
      error={first.error}
      held={failed.some((read) => read.isFetching)}
      retry={() => {
        for (const read of failed) void read.refetch();
      }}
    />
  );
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
        {age.silent ? "сервер не відповідає" : UNREAD}
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
