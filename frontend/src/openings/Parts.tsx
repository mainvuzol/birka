import { useState } from "react";
import type { JSX } from "react";
import { ApiError, SlowAnswer, api, errorText } from "@/shared/api";
import type { Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { FileChooser } from "./FileChooser";
import { fileProblemTexts } from "./fileErrors";
import { MAX_BODY_BYTES, TOO_LARGE, bodyBytes } from "./stockFile";
import type { StockFileRead } from "./stockFile";
import type { StockList, StockPart } from "./types";

/**
 * A list's parts (ADR-0014 §2, §8, §9): each file, or each text typed by
 * hand, added, shown and removed as one.
 *
 * Owner decisions, 2026-10-08: several files fill one list; a file added by
 * mistake is removed by the owner or any manager, with its lines' answers and
 * no reason — the history shows who and when; the last file is not removed,
 * the list is rejected instead; a removed file comes back only as a new one.
 */

/** «08.10.26, 20:21», the phone's own time. */
function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** A part as a person calls it: the file's name, or that it was typed. */
export function partName(part: StockPart): string {
  return part.file_name === null
    ? "Рядки, внесені вручну"
    : `«${visible(part.file_name)}»`;
}

export const LAST_PART =
  "Це останній файл списку. Якщо він помилковий — відхиліть список: склад звільниться.";

/** A list with no room for a part, as the server counted it. */
function listFull(details: Record<string, unknown>): string {
  const limit = String(details.limit);
  return details.what === "parts"
    ? `Список повний: не більше ${limit} файлів.`
    : details.what === "rows"
      ? `Список повний: не більше ${limit} рядків разом із прибраними.`
      : `Список повний: не більше ${limit} рядків.`;
}

/** Why a part was not added, in words; one line each. */
function refusal(error: unknown, unknownOutcome: string): string[] {
  if (error instanceof SlowAnswer) return [errorText(error)];
  if (!(error instanceof ApiError)) return [unknownOutcome];
  const reason = error.details.reason;
  if (reason === "PART_DUPLICATE")
    return [
      `Цей файл уже є в списку: «${visible(typeof error.details.file_name === "string" ? error.details.file_name : "")}». Двічі його не додають.`,
    ];
  if (reason === "LIST_FULL") return [listFull(error.details)];
  if (reason === "ALREADY_DECIDED")
    return ["Цей список уже затвердили або відхилили."];
  if (error.code === "IDEMPOTENCY_CONFLICT")
    return [
      "Це вже надсилали, але в іншому вигляді. Оберіть файл чи введіть рядки ще раз — їх буде надіслано як нові.",
    ];
  const problems = fileProblemTexts(error.validation);
  return problems.length > 0 ? problems : [errorText(error)];
}

function Problems({ problems }: { problems: string[] }): JSX.Element | null {
  if (problems.length === 0) return null;
  if (problems.length === 1)
    return <p role="alert">{visible(problems[0] ?? "")}</p>;
  return (
    <div role="alert">
      <ul>
        {problems.map((problem, index) => (
          <li key={index}>{visible(problem)}</li>
        ))}
      </ul>
    </div>
  );
}

export function PartsSection({
  list,
  store,
  token,
  parts,
  editable,
  blocked,
  show,
  refresh,
}: {
  list: StockList;
  store: Store;
  token: string;
  parts: StockPart[];
  /** The list waits, and this person may add and remove its parts. */
  editable: boolean;
  blocked: boolean;
  show: (part: StockPart) => void;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const live = parts.filter((part) => part.removed_at === null);

  async function remove(part: StockPart): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await api(
        `/snapshots/${list.snapshot_id}/parts/${part.part_id}/remove?store_id=${store.id}`,
        token,
        {},
      );
    } catch (error) {
      const reason =
        error instanceof ApiError ? error.details.reason : undefined;
      setProblem(
        !(error instanceof ApiError)
          ? "Невідомо, чи файл прибрано. Оновіть список і подивіться; повторити безпечно."
          : reason === "LAST_PART"
            ? LAST_PART
            : reason === "ALREADY_DECIDED"
              ? "Цей список уже затвердили або відхилили."
              : errorText(error),
      );
    } finally {
      setAsking(null);
      setBusy(false);
      await refresh();
    }
  }

  return (
    <section className="section-block" aria-label="Файли списку">
      <h3>Файли списку</h3>
      {problem && <p role="alert">{problem}</p>}
      {parts.map((part) => {
        const removed = part.removed_at !== null;
        const last = !removed && live.length === 1;
        const answered = part.progress.resolved + part.progress.skipped;
        return (
          <article
            key={part.part_id}
            className={removed ? "line part-removed" : "line"}
            aria-label={`Файл ${String(part.part_no)}`}
          >
            <strong>
              {part.part_no}. {partName(part)}
            </strong>
            {part.source !== null && (
              <small>Звідки: {visible(part.source)}</small>
            )}
            <small>
              Рядки {part.first_line_no}–{part.last_line_no}
              {removed
                ? ` · рядків ${String(part.lines)}`
                : ` · розібрано ${String(answered)} з ${String(part.lines)}`}
            </small>
            <small>
              Додано: {part.added_by_name ?? "—"}, {when(part.added_at)}
            </small>
            {part.removed_at !== null && (
              <small>
                Прибрано: {part.removed_by_name ?? "—"}, {when(part.removed_at)}
              </small>
            )}
            {!removed && part.photo_lines_elsewhere > 0 && (
              <small>
                Рядків цього файлу, що вже є в інших файлах списку (те саме фото
                й рядок): {part.photo_lines_elsewhere}. Якщо файл додано
                помилково, приберіть його.
              </small>
            )}
            <div className="actions">
              <button
                className="quiet"
                onClick={() => {
                  show(part);
                }}
              >
                Показати рядки
              </button>
              {editable && !removed && (
                <button
                  className="quiet"
                  disabled={last || busy || blocked}
                  onClick={() => {
                    setProblem(null);
                    setAsking(part.part_id);
                  }}
                >
                  Прибрати файл
                </button>
              )}
            </div>
            {editable && last && <p className="hint">{LAST_PART}</p>}
            {asking === part.part_id && !last && (
              <div className="notice" aria-label="Прибрати файл?">
                <p>
                  {`Прибрати файл ${partName(part)}? Рядки цього файлу (${String(part.lines)}) не увійдуть до затвердження, а відповіді на них (${String(answered)}) зникнуть; рядки буде видно як прибрані. Інші файли лишаться.`}
                </p>
                <div className="actions">
                  <button
                    disabled={busy || blocked}
                    onClick={() => {
                      void remove(part);
                    }}
                  >
                    Так, прибрати
                  </button>
                  <button
                    className="quiet"
                    disabled={busy}
                    onClick={() => {
                      setAsking(null);
                    }}
                  >
                    Скасувати
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

function partKey(listId: string, read: StockFileRead): string | null {
  return read.ok && read.sha256 !== null
    ? `birka:stock-list-part:${listId}:${read.sha256}:${read.name}`
    : null;
}

/**
 * «Додати файл»: one more parser's file into a waiting list. Its command id
 * is kept on the phone, by the list and the file's bytes and name, until the
 * server has answered it: the same file picked again after a lost answer is
 * the same command, never a second part.
 */
export function AddFile({
  list,
  store,
  token,
  warehouse,
  blocked,
  done,
  refresh,
  cancel,
}: {
  list: StockList;
  store: Store;
  token: string;
  warehouse: string;
  blocked: boolean;
  /** Added: the list is read again, and this form closes. */
  done: () => Promise<void>;
  /** Not known yet: the list is read again, and this form stays. */
  refresh: () => Promise<void>;
  cancel: () => void;
}): JSX.Element {
  const [read, setRead] = useState<StockFileRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  // Where storage cannot keep it, the command lives as long as this form.
  const [fallback] = useState(() => crypto.randomUUID());

  function commandId(key: string | null): string {
    if (key === null) return fallback;
    try {
      const kept = window.localStorage.getItem(key);
      if (kept) return kept;
      const fresh = crypto.randomUUID();
      window.localStorage.setItem(key, fresh);
      return fresh;
    } catch {
      return fallback;
    }
  }

  function forget(key: string | null): void {
    if (key === null) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* Nothing kept: nothing to forget. */
    }
  }

  async function send(): Promise<void> {
    if (!read?.ok) return;
    const key = partKey(list.snapshot_id, read);
    const body = {
      command_id: commandId(key),
      file: read.file,
      file_name: read.name,
    };
    if (bodyBytes(body) > MAX_BODY_BYTES) {
      setProblems([TOO_LARGE]);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      await api(
        `/snapshots/${list.snapshot_id}/parts?store_id=${store.id}`,
        token,
        body,
        undefined,
        "POST",
        { slow: true },
      );
      forget(key);
      await done();
    } catch (error) {
      // Answered: a second press is a new command. Not answered: the same.
      if (error instanceof ApiError) forget(key);
      setProblems(
        refusal(
          error,
          "Невідомо, чи додано файл. Натисніть ще раз — той самий файл не додасться двічі.",
        ),
      );
      if (error instanceof SlowAnswer) await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notice" role="form" aria-label="Додати файл">
      <h3>Додати файл</h3>
      <FileChooser
        read={read}
        onRead={(next) => {
          setRead(next);
          setProblems([]);
        }}
        warehouse={warehouse}
        disabled={busy}
      />
      <Problems problems={problems} />
      <div className="actions">
        <button
          type="button"
          disabled={!read?.ok || busy || blocked}
          onClick={() => {
            void send();
          }}
        >
          Додати до списку
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={cancel}
        >
          Закрити
        </button>
      </div>
    </div>
  );
}

interface LinesDraft {
  command_id: string;
  text: string;
  source: string;
  counted: string;
}

function linesKey(listId: string): string {
  return `birka:stock-list-lines:${listId}`;
}

function loadLines(listId: string): LinesDraft {
  try {
    const stored = window.localStorage.getItem(linesKey(listId));
    if (stored) return JSON.parse(stored) as LinesDraft;
  } catch {
    /* Fresh lines: the server has not seen these. */
  }
  return { command_id: crypto.randomUUID(), text: "", source: "", counted: "" };
}

function saveLines(listId: string, draft: LinesDraft | null): void {
  try {
    if (draft)
      window.localStorage.setItem(linesKey(listId), JSON.stringify(draft));
    else window.localStorage.removeItem(linesKey(listId));
  } catch {
    /* Typing still works; only a reload loses it. */
  }
}

/**
 * «Додати рядки вручну»: a page the parser could not read, typed into the
 * list as a part of its own (owner, 2026-10-08). No photo reference; each
 * line is reviewed like any other. Kept on the phone until the server has it.
 */
export function AddLines({
  list,
  store,
  token,
  blocked,
  done,
  refresh,
  cancel,
}: {
  list: StockList;
  store: Store;
  token: string;
  blocked: boolean;
  done: () => Promise<void>;
  refresh: () => Promise<void>;
  cancel: () => void;
}): JSX.Element {
  const [draft, setDraftState] = useState<LinesDraft>(() =>
    loadLines(list.snapshot_id),
  );
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const lines = draft.text.split("\n").filter((line) => line.trim() !== "");
  const tooLong = lines.find((line) => line.length > 500);

  function setDraft(change: Partial<LinesDraft>): void {
    const next = { ...draft, ...change };
    setDraftState(next);
    saveLines(list.snapshot_id, next);
  }

  async function send(): Promise<void> {
    setBusy(true);
    setProblems([]);
    try {
      await api(
        `/snapshots/${list.snapshot_id}/parts?store_id=${store.id}`,
        token,
        {
          command_id: draft.command_id,
          lines,
          source: draft.source.trim() || null,
          counted_on: draft.counted.trim() || null,
        },
        undefined,
        "POST",
        { slow: true },
      );
      saveLines(list.snapshot_id, null);
      await done();
    } catch (error) {
      setProblems(
        refusal(
          error,
          "Невідомо, чи додано рядки. Натисніть ще раз — ті самі рядки не додадуться двічі.",
        ),
      );
      if (error instanceof SlowAnswer) await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notice" role="form" aria-label="Додати рядки вручну">
      <h3>Додати рядки вручну</h3>
      <label>
        Звідки ці рядки (необов’язково)
        <input
          value={draft.source}
          maxLength={300}
          placeholder="Наприклад, «Зошит 2, сторінка 5»"
          onChange={(event) => {
            setDraft({ source: event.target.value });
          }}
        />
      </label>
      <label>
        Коли перелічено (необов’язково)
        <input
          value={draft.counted}
          maxLength={40}
          onChange={(event) => {
            setDraft({ counted: event.target.value });
          }}
        />
      </label>
      <label>
        Рядки — кожен товар з нового рядка, як написано
        <textarea
          value={draft.text}
          rows={6}
          onChange={(event) => {
            setDraft({ text: event.target.value });
          }}
        />
      </label>
      <p className="hint">
        Рядків: {lines.length}. Порожні рядки не зберігаються.
      </p>
      {tooLong && (
        <p role="alert">Рядок довший за 500 символів: розділіть його.</p>
      )}
      <Problems problems={problems} />
      <div className="actions">
        <button
          type="button"
          disabled={lines.length === 0 || !!tooLong || busy || blocked}
          onClick={() => {
            void send();
          }}
        >
          Додати рядки
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={cancel}
        >
          Закрити
        </button>
      </div>
    </div>
  );
}
