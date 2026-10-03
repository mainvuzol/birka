import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import type {
  Backups as State,
  Message,
  Night,
  PastTrouble,
  Server as ServerState,
  Trouble,
  TroubleKind,
} from "./types";

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
}: {
  token: string;
  scopeKey: string;
}): JSX.Element {
  const backups = useBackups(token, scopeKey, true);
  return (
    <section>
      <div className="toolbar">
        <h2>Резервні копії</h2>
        <button
          className="quiet"
          disabled={backups.isFetching}
          onClick={() => {
            void backups.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        Щоночі сервер робить копію бази, перевіряє її відновленням і шифрує
        вашим ключем. Цей розділ бачить лише власник.
      </p>
      {backups.isPending ? (
        <p role="status">Завантажуємо стан копій…</p>
      ) : backups.error ? (
        <p role="alert">{errorText(backups.error)}</p>
      ) : (
        <>
          <Verdict backups={backups.data} />
          {backups.data.server && (
            <Server
              server={backups.data.server}
              now={backups.data.checked_at}
            />
          )}
          <Telegram message={backups.data.your_last_message} />
          <Nights nights={backups.data.nights} />
        </>
      )}
    </section>
  );
}

function LastGood({ night }: { night: Night | null }): JSX.Element {
  return night ? (
    <p>Остання вдала копія: {when(night.finished_at)}.</p>
  ) : (
    <p>Вдалих копій ще не було.</p>
  );
}

function Verdict({ backups }: { backups: State }): JSX.Element {
  const { latest } = backups;
  if (backups.state === "NOT_SET_UP" || latest === null)
    return (
      <div className="section-block notice" data-state="NOT_SET_UP">
        <h3>Резервне копіювання ще не налаштоване</h3>
        <p>
          На сервері немає жодної копії бази. Якщо сервер зламається, дані
          магазину буде втрачено. Налаштування описане в інструкції з резервних
          копій.
        </p>
      </div>
    );
  if (backups.state === "OVERDUE") {
    const hours = Math.floor(
      (Date.parse(backups.checked_at) - Date.parse(latest.finished_at)) /
        3_600_000,
    );
    return (
      <div className="section-block notice" data-state="OVERDUE">
        <h3>Копія не робилася вже {hours} год</h3>
        <p>
          Остання спроба: {when(latest.finished_at)}. Ймовірно, на сервері
          зупинився нічний розклад — перевірте його за інструкцією.
        </p>
        <LastGood night={backups.last_good} />
      </div>
    );
  }
  if (backups.state === "FAILED")
    return (
      <div className="section-block notice" data-state="FAILED">
        <h3>Остання нічна копія не вдалася</h3>
        <p>{when(latest.finished_at)}:</p>
        <ul>
          {latest.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p>Попередні копії не видалено.</p>
        <LastGood night={backups.last_good} />
      </div>
    );
  return (
    <div className="section-block" data-state="OK">
      <h3>Копії в порядку</h3>
      <p>
        Остання копія: {when(latest.finished_at)}, перевірена відновленням
        {latest.restore_seconds === null
          ? ""
          : ` за ${latest.restore_seconds.toLocaleString("uk-UA", {
              maximumFractionDigits: 1,
            })} с`}
        .
        {latest.archive_bytes === null
          ? ""
          : ` Розмір: ${size(latest.archive_bytes)}.`}
      </p>
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

/**
 * Trouble on the server, shown here as the backups are (owner decision,
 * 2026-10-03): what is wrong now and since when, what was wrong this week,
 * and whether the watcher that tells the bot is still looking.
 */
function Server({
  server,
  now,
}: {
  server: ServerState;
  now: string;
}): JSX.Element {
  const silent =
    server.looked_at === null ||
    Date.parse(now) - Date.parse(server.looked_at) > SILENT_AFTER;
  const state = server.open.length > 0 ? "TROUBLE" : silent ? "SILENT" : "OK";
  return (
    <div
      className={state === "OK" ? "section-block" : "section-block notice"}
      data-server={state}
    >
      <h3>
        {server.open.length === 0
          ? "Стан сервера"
          : server.open.length === 1
            ? "Проблема на сервері"
            : "Проблеми на сервері"}
      </h3>
      {server.open.length > 0 && (
        <ul className="troubles" data-troubles="open">
          {server.open.map((trouble: Trouble) => (
            <li key={`${trouble.kind}:${trouble.started_at}`}>
              <strong>{label(troubleNow, trouble.kind)}</strong>{" "}
              <small>
                з {when(trouble.started_at)}, уже{" "}
                {span(trouble.started_at, now)}
              </small>
              <br />
              {trouble.reason}
            </li>
          ))}
        </ul>
      )}
      <p data-watcher="">
        {server.looked_at === null
          ? "Сторож ще не перевіряв сервер."
          : `Сторож перевіряв ${ago(server.looked_at, now)}.`}
        {silent
          ? " Поки він мовчить, бот нічого не напише — ні про копії, ні про сервер. Перевірте його за інструкцією сервера."
          : server.open.length === 0
            ? " Проблем не помічено."
            : ""}
      </p>
      {server.recent.length > 0 && (
        <>
          <p>Минулі проблеми за 7 днів:</p>
          <ul className="troubles" data-troubles="recent">
            {server.recent.map((trouble: PastTrouble) => (
              <li key={`${trouble.kind}:${trouble.started_at}`}>
                <span>{label(troubleThen, trouble.kind)}</span>{" "}
                <small>
                  {when(trouble.started_at)}, тривало{" "}
                  {span(trouble.started_at, trouble.ended_at)}
                </small>
                <br />
                <small>{trouble.reason}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Telegram({ message }: { message: Message | null }): JSX.Element {
  return (
    <div className="section-block">
      <h3>Сповіщення в Telegram</h3>
      {message === null ? (
        <p>
          Повідомлень ще не було. Бот напише вам, щойно з копіями щось
          станеться.
        </p>
      ) : message.status === "SENT" ? (
        <p>
          Останнє повідомлення надіслано{" "}
          {when(message.sent_at ?? message.created_at)}.
        </p>
      ) : message.status === "PENDING" ? (
        <p role="status">
          Повідомлення надсилається.
          {message.error ? " Telegram поки недоступний, бот спробує ще." : ""}
        </p>
      ) : message.status === "REFUSED" ? (
        <p role="alert">
          Telegram не доставив повідомлення: бот не може вам написати. Відкрийте
          чат із ботом магазину й натисніть «Start» (або розблокуйте бота).
        </p>
      ) : (
        <p role="alert">
          Не вдалося надіслати повідомлення в Telegram після кількох спроб.
          {message.error && <small> {message.error}</small>}
        </p>
      )}
    </div>
  );
}

function Nights({ nights }: { nights: Night[] }): JSX.Element | null {
  if (nights.length === 0) return null;
  return (
    <div className="section-block">
      <h3>Останні ночі</h3>
      <ul className="nights">
        {nights.map((night) => (
          <li key={night.finished_at}>
            <span>{when(night.finished_at)}</span>{" "}
            {night.ok ? (
              <span className="badge">перевірена</span>
            ) : (
              <span className="badge failed">не вдалася</span>
            )}{" "}
            <small>{size(night.archive_bytes)}</small>
            {!night.ok && (
              <ul>
                {night.reasons.map((reason) => (
                  <li key={reason}>
                    <small>{reason}</small>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
