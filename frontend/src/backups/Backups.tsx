import { useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { shortDay, shortTime } from "@/credits/format";
import { api } from "@/shared/api";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { Sheet } from "@/shared/Sheet";
import { Unread } from "@/shared/Unread";
import { Waiting } from "@/today/age";
import type {
  Backups as State,
  Message,
  Night,
  PastTrouble,
  Server as ServerState,
  Trouble,
  TroubleKind,
} from "./types";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { ScreenHeader } from "@/shared/ScreenHeader";

/**
 * The server's backups, read for whoever holds `backup:view`
 * organization-wide — the owner (owner decision, 2026-09-30). Shared by the
 * section and by its tab, which is marked while something is wrong.
 */
export function useBackups(
  token: string,
  scopeKey: string,
  enabled: boolean,
): UseQueryResult<State> {
  return useQuery({
    queryKey: ["backups", scopeKey],
    queryFn: () => api<State>("/backups", token),
    enabled,
    retry: false,
    // Asked again as the app comes back at most once a minute, as
    // «Сьогодні» reads them («Усе на бірці» task list, P0-6).
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const minute = 60_000;

/** How long from one moment to another, in the largest unit that fits. */
function span(from: string, to: string): string {
  const minutes = Math.max(
    0,
    Math.floor((Date.parse(to) - Date.parse(from)) / minute),
  );
  if (minutes < 60) return `${String(Math.max(minutes, 1))} хв`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} год`;
  return `${String(Math.floor(hours / 24))} дн.`;
}

/**
 * How long ago, by the server's clock (`checked_at`), never the phone's: a
 * phone whose clock is off would otherwise make a live watcher look silent.
 */
function ago(iso: string, now: string): string {
  return Date.parse(now) - Date.parse(iso) < minute
    ? "щойно"
    : `${span(iso, now)} тому`;
}

function size(bytes: number | null): string {
  if (bytes === null) return "";
  return `${(bytes / 1024 / 1024).toLocaleString("uk-UA", {
    maximumFractionDigits: 1,
  })} МБ`;
}

export function Backups({
  token,
  scopeKey,
  back,
}: {
  token: string;
  scopeKey: string;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element {
  // The verdict in view as the screen opens, whatever «Ще» was scrolled to
  // (stage 2, admin task list, P0-5): the header's (audit after stage 2,
  // frame P1-3).
  const backups = useBackups(token, scopeKey, true);
  return (
    <>
      <ScreenHeader
        title="Резервні копії"
        back={back && <BackToMore back={back} />}
        aside={
          <button
            className="quiet"
            disabled={backups.isFetching}
            onClick={() => {
              void backups.refetch();
            }}
          >
            Оновити
          </button>
        }
      />
      {/* The one question first and largest — are the data safe — what is
          wrong now under it, the nights as a thread, the explanation one
          line at the foot (stage 2, admin task list, P0-5; В-А5 (а)). The
          screen only reads: nothing to feel. */}
      <section className="backups">
        {backups.isPending ? (
          <>
            <p role="status" className="visually-hidden">
              Завантажуємо стан копій…
            </p>
            <div className="backups-wait" aria-hidden="true">
              <div className="tag-hero tag-outline">
                <div className="backups-verdict-in">
                  <Waiting width="70%" />
                  <Waiting width="55%" />
                </div>
              </div>
              <Waiting width="80%" />
              <Waiting width="65%" />
              <Waiting width="50%" />
            </div>
          </>
        ) : backups.error ? (
          <Unread
            error={backups.error}
            retry={() => {
              void backups.refetch();
            }}
          />
        ) : (
          <>
            <Verdict backups={backups.data} />
            <div className="backups-now">
              {backups.data.server && (
                <Server
                  server={backups.data.server}
                  now={backups.data.checked_at}
                />
              )}
              <Telegram message={backups.data.your_last_message} />
            </div>
            <Nights nights={backups.data.nights} />
          </>
        )}
        <p className="t-meta backups-about">
          Щоночі сервер робить копію бази, перевіряє її відновленням і шифрує
          вашим ключем. Цей розділ бачить лише власник.
        </p>
      </section>
    </>
  );
}

function LastGood({ night }: { night: Night | null }): JSX.Element {
  return night ? (
    <p>Остання вдала копія: {when(night.finished_at)}.</p>
  ) : (
    <p>Вдалих копій ще не було.</p>
  );
}

/**
 * What the backups' state is called: this screen's heading for it, and
 * «Сьогодні»'s tag's while it is not in order («Усе на бірці» task list,
 * P0-6).
 */
export function verdictTitle(backups: State): string {
  const { latest } = backups;
  if (backups.state === "NOT_SET_UP" || latest === null)
    return "Резервне копіювання ще не налаштоване";
  if (backups.state === "OVERDUE") {
    const hours = Math.floor(
      (Date.parse(backups.checked_at) - Date.parse(latest.finished_at)) /
        3_600_000,
    );
    return `Копія не робилася вже ${String(hours)} год`;
  }
  if (backups.state === "FAILED") return "Остання нічна копія не вдалася";
  return "Копії в порядку";
}

/**
 * The verdict, one large tag (spec §6.10, P3): its eyelet a knot when the
 * copies are in order — nothing is left to do — and filled in the warning's
 * colour in the three other cases, which wait for the owner; its title the
 * verdict's words, under it at most the last good copy and what the verdict
 * rests on.
 */
function Verdict({ backups }: { backups: State }): JSX.Element {
  const { latest } = backups;
  const state =
    backups.state === "NOT_SET_UP" || latest === null
      ? "NOT_SET_UP"
      : backups.state;
  return (
    <div className="tag-hero tag-outline backups-verdict" data-state={state}>
      <div className="backups-verdict-in">
        <span className="backups-eyelet">
          <Eyelet state={state === "OK" ? "knot" : "filled"} />
        </span>
        <h2 className="t-title-xl">{verdictTitle(backups)}</h2>
        {state === "NOT_SET_UP" || latest === null ? (
          <p>
            На сервері немає жодної копії бази. Якщо сервер зламається, дані
            магазину буде втрачено. Налаштування описане в інструкції з
            резервних копій.
          </p>
        ) : state === "OVERDUE" ? (
          <>
            <LastGood night={backups.last_good} />
            <p>
              Остання спроба: {when(latest.finished_at)}. Ймовірно, на сервері
              зупинився нічний розклад — перевірте його за інструкцією.
            </p>
          </>
        ) : state === "FAILED" ? (
          <>
            <LastGood night={backups.last_good} />
            <ul>
              {latest.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p>Попередні копії не видалено.</p>
          </>
        ) : (
          <>
            <LastGood night={latest} />
            <p>
              {[
                `перевірена відновленням${
                  latest.restore_seconds === null
                    ? ""
                    : ` за ${latest.restore_seconds.toLocaleString("uk-UA", {
                        maximumFractionDigits: 1,
                      })} с`
                }`,
                ...(latest.archive_bytes === null
                  ? []
                  : [size(latest.archive_bytes)]),
              ].join(" · ")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// The watcher looks at the server every minute; a quarter of an hour without
// a look means it has stopped, and with it every message of the bot.
const SILENT_AFTER = 15 * minute;

const troubleNow: Record<TroubleKind, string> = {
  NOT_ANSWERING: "Сервер не відповідає",
  DISK_LOW: "Закінчується місце на диску",
  SIGN_IN_FAILING: "Ніхто не може увійти",
};
const troubleThen: Record<TroubleKind, string> = {
  NOT_ANSWERING: "Сервер не відповідав",
  DISK_LOW: "Закінчувалося місце на диску",
  SIGN_IN_FAILING: "Ніхто не міг увійти",
};

/** A kind this app does not know yet still shows, as trouble. */
function label(words: Record<TroubleKind, string>, kind: TroubleKind): string {
  return (words as Partial<Record<string, string>>)[kind] ?? "Проблема";
}

/** What is wrong on the server now, as this screen says it. */
export function troubleText(kind: TroubleKind): string {
  return label(troubleNow, kind);
}

/** «Сьогодні»'s tag for the server: «Проблема на сервері», «Проблеми …»;
 * here, the name its rows are read by. */
export function serverTitle(open: number): string {
  return open === 0
    ? "Стан сервера"
    : open === 1
      ? "Проблема на сервері"
      : "Проблеми на сервері";
}

/**
 * A tag row that waits for the owner (spec §6.9): its eyelet filled in the
 * warning's colour, its title, its words under it.
 */
function WaitsForYou({
  title,
  children,
  watcher = false,
}: {
  title: string;
  children: JSX.Element | JSX.Element[];
  /** The watcher's own words, which the tests find it by. */
  watcher?: boolean;
}): JSX.Element {
  return (
    <div className="today-tag tag-row tag-outline tone-warning">
      <div className="today-tag-body">
        <span className="today-tag-eyelet" aria-hidden="true" />
        <h3
          className="t-row today-tag-title"
          data-watcher={watcher ? "" : undefined}
        >
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

/**
 * Trouble on the server, shown here as the backups are (owner decision,
 * 2026-10-03): each trouble open now a row that waits — what, since when,
 * why — and a watcher gone quiet another; with neither, one line. What was
 * wrong this week is one line more, its list in a sheet.
 */
function Server({
  server,
  now,
}: {
  server: ServerState;
  now: string;
}): JSX.Element {
  const [past, setPast] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const silent =
    server.looked_at === null ||
    Date.parse(now) - Date.parse(server.looked_at) > SILENT_AFTER;
  const state = server.open.length > 0 ? "TROUBLE" : silent ? "SILENT" : "OK";
  return (
    <div className="backups-server" data-server={state}>
      {server.open.length > 0 && (
        <ul
          className="backups-rows"
          data-troubles="open"
          aria-label={serverTitle(server.open.length)}
        >
          {server.open.map((trouble: Trouble) => (
            <li key={`${trouble.kind}:${trouble.started_at}`}>
              <WaitsForYou title={label(troubleNow, trouble.kind)}>
                <p className="t-meta today-tag-meta">
                  з {when(trouble.started_at)}, уже{" "}
                  {span(trouble.started_at, now)}
                </p>
                <p className="t-meta backups-why">{trouble.reason}</p>
              </WaitsForYou>
            </li>
          ))}
        </ul>
      )}
      {silent ? (
        <WaitsForYou
          watcher
          title={
            server.looked_at === null
              ? "Сторож ще не перевіряв сервер."
              : `Сторож перевіряв ${ago(server.looked_at, now)}.`
          }
        >
          <p className="t-meta backups-why">
            Поки він мовчить, бот нічого не напише — ні про копії, ні про
            сервер. Перевірте його за інструкцією сервера.
          </p>
        </WaitsForYou>
      ) : (
        <p className="backups-line" data-watcher="">
          <span className="backups-line-name">Стан сервера</span>
          {server.open.length === 0 && " · проблем не помічено"}
          {server.looked_at !== null &&
            ` · сторож перевіряв ${ago(server.looked_at, now)}`}
        </p>
      )}
      {server.recent.length > 0 && (
        <button
          ref={opener}
          type="button"
          className="backups-line backups-line-press"
          aria-haspopup="dialog"
          onClick={() => {
            setPast(true);
          }}
        >
          <span>
            <span className="backups-line-name">Минулі проблеми за 7 днів</span>{" "}
            · {server.recent.length}
          </span>
          <Icon name="chevron-right" size={16} />
        </button>
      )}
      {past && (
        <Sheet
          title="Минулі проблеми за 7 днів"
          fallback={opener}
          close={() => {
            setPast(false);
          }}
        >
          <ul className="troubles" data-troubles="recent">
            {server.recent.map((trouble: PastTrouble) => (
              <li key={`${trouble.kind}:${trouble.started_at}`}>
                <span className="t-row">
                  {label(troubleThen, trouble.kind)}
                </span>
                <span className="t-meta">
                  {when(trouble.started_at)}, тривало{" "}
                  {span(trouble.started_at, trouble.ended_at)}
                </span>
                <span className="t-meta">{trouble.reason}</span>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

/**
 * Whether the bot can tell the owner: a row that waits only when Telegram
 * refused or failed it, its words as before; otherwise one line.
 */
function Telegram({ message }: { message: Message | null }): JSX.Element {
  if (message?.status === "REFUSED")
    return (
      <WaitsForYou title="Сповіщення в Telegram">
        <p className="t-meta backups-why" data-telegram="REFUSED">
          Telegram не доставив повідомлення: бот не може вам написати. Відкрийте
          чат із ботом магазину й натисніть «Start» (або розблокуйте бота).
        </p>
      </WaitsForYou>
    );
  if (message?.status === "FAILED")
    return (
      <WaitsForYou title="Сповіщення в Telegram">
        <p className="t-meta backups-why" data-telegram="FAILED">
          Не вдалося надіслати повідомлення в Telegram після кількох спроб.
          {message.error && ` ${message.error}`}
        </p>
      </WaitsForYou>
    );
  return (
    <p
      className="backups-line"
      data-telegram={message?.status ?? "NONE"}
      role={message?.status === "PENDING" ? "status" : undefined}
    >
      <span className="backups-line-name">Сповіщення в Telegram</span>
      {message === null
        ? " · бот напише, щойно з копіями щось станеться"
        : message.status === "SENT"
          ? ` · останнє ${shortDay(message.sent_at ?? message.created_at)} о ${shortTime(message.sent_at ?? message.created_at)}`
          : ` · повідомлення надсилається${
              message.error
                ? " · Telegram поки недоступний, бот спробує ще"
                : ""
            }`}
    </p>
  );
}

/**
 * «Останні ночі» as a thread (spec §6.21): the day on the left, a knot for
 * a copy checked, a node filled in the warning's colour for one that
 * failed, and why.
 */
function Nights({ nights }: { nights: Night[] }): JSX.Element | null {
  if (nights.length === 0) return null;
  return (
    <>
      <h2 className="t-label customer-history-title">Останні ночі</h2>
      <ul className="timeline nights" aria-label="Останні ночі">
        {nights.map((night) => (
          <li className="timeline-row" key={night.finished_at}>
            <span className="timeline-day">{shortDay(night.finished_at)}</span>
            <span
              className={`timeline-node ${night.ok ? "knot" : "warn"}`}
              aria-hidden="true"
            />
            <span className="timeline-main">
              <span className="timeline-what">
                {night.ok ? "перевірена" : "не вдалася"}
              </span>
              <span className="timeline-meta">
                {[shortTime(night.finished_at), size(night.archive_bytes)]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </span>
              {!night.ok &&
                night.reasons.map((reason) => (
                  <span className="timeline-meta" key={reason}>
                    {reason}
                  </span>
                ))}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
