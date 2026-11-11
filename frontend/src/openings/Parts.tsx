import { useEffect, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, SlowAnswer, api, errorText } from "@/shared/api";
import type { Store } from "@/orders/types";
import { Back } from "@/shared/Back";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { usePanelRoom } from "@/shared/panel";
import { Placeholder } from "@/shared/Placeholder";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { buzz, useMainButton } from "@/shared/telegram";
import { Unread } from "@/shared/Unread";
import { visible } from "@/shared/visible";
import { FileChooser } from "./FileChooser";
import { fileProblemTexts } from "./fileErrors";
import { MAX_BODY_BYTES, TOO_LARGE, bodyBytes } from "./stockFile";
import type { StockFileRead } from "./stockFile";
import {
  cannotReceiveText,
  listConflict,
  listRefusal,
  number,
  typedTooMuch,
} from "./types";
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
/** The same, of a list's last part when it is lines typed by hand. */
export const LAST_TYPED_PART =
  "Це останні рядки списку. Якщо вони помилкові — відхиліть список: склад звільниться.";

/**
 * What removing a part asks, and its button: a file by its name, typed
 * lines as typed lines (review, 2026-10-09).
 */
function removal(
  part: StockPart,
  answered: number,
): {
  button: string;
  question: string;
} {
  const lines = String(part.lines);
  const answers = String(answered);
  return part.kind === "FILE"
    ? {
        button: "Прибрати файл",
        question: `Прибрати файл ${partName(part)}? Рядки цього файлу (${lines}) не увійдуть до затвердження, а відповіді на них (${answers}) зникнуть; рядки буде видно як прибрані. Інші файли лишаться.`,
      }
    : {
        button: "Прибрати рядки",
        question: `Прибрати рядки, внесені вручну? Ці рядки (${lines}) не увійдуть до затвердження, а відповіді на них (${answers}) зникнуть; їх буде видно як прибрані. Інші файли лишаться.`,
      };
}

/**
 * A list with no room for a part, as the server counted it. Its parts are
 * its files and its lines typed by hand, removed ones too (review, fourth
 * round, 2026-10-09).
 */
function listFull(details: Record<string, unknown>): string {
  const limit =
    typeof details.limit === "number"
      ? number(details.limit)
      : String(details.limit);
  return details.what === "parts"
    ? `Список повний: не більше ${limit} частин — файлів і рядків, внесених вручну, — разом із прибраними.`
    : details.what === "rows"
      ? `Список повний: не більше ${limit} рядків разом із прибраними.`
      : `Список повний: не більше ${limit} рядків.`;
}

/**
 * Why a part was not added, in words; one line each. `unknownOutcome`: what
 * is said when the answer never came; `resent`: what is said when the same
 * command was sent before in another form, and is now sent as a new one.
 */
function refusal(
  error: unknown,
  list: StockList,
  unknownOutcome: string,
  resent: string,
  /** Not named: what was not added, and what to check. */
  notAdded: [string, string],
): string[] {
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
  if (reason === "LIST_STORE_CANNOT_RECEIVE") return [cannotReceiveText(list)];
  if (error.code === "IDEMPOTENCY_CONFLICT") return [resent];
  const problems = fileProblemTexts(error.validation, error.validationMore);
  return problems.length > 0 ? problems : [listRefusal(error, ...notAdded)];
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

/** A screen of the list's own: its «←» the list's name, over its title; the
 * title takes the cursor as it opens (goods task list after stage 2, P0-1). */
function ListBack({
  title,
  held,
  leave,
}: {
  title: string;
  held: boolean;
  leave: () => void;
}): JSX.Element {
  return (
    <Back go={leave} held={held} label={`Назад до «${title}»`}>
      <span aria-hidden="true">← </span>
      {title}
    </Back>
  );
}

function useTitleFocus(): RefObject<HTMLHeadingElement> {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return heading;
}

/**
 * «Файли списку» (goods task list after stage 2, P0-1): a screen of its own,
 * «← {список}» — how much room the list has left, and a tag a file: its
 * number and name, where it came from, its lines and who added it, a
 * warning when its photo's lines stand in other files too, «Показати рядки»
 * and, while the list waits, a quiet «Прибрати файл» asked in a sheet.
 */
export function PartsScreen({
  list,
  store,
  token,
  parts,
  title,
  editable,
  blocked,
  show,
  leave,
  refresh,
}: {
  list: StockList;
  store: Store;
  token: string;
  parts: UseQueryResult<{ items: StockPart[] }>;
  /** The list's name, its «←». */
  title: string;
  /** The list waits, and this person may add and remove its parts. */
  editable: boolean;
  blocked: boolean;
  /** The file's lines, on the list. */
  show: (part: StockPart) => void;
  leave: () => void;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [asking, setAsking] = useState<StockPart | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const heading = useTitleFocus();
  const items = parts.data?.items ?? [];
  const live = items.filter((part) => part.removed_at === null);

  async function remove(part: StockPart): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await api(
        `/snapshots/${list.snapshot_id}/parts/${part.part_id}/remove?store_id=${store.id}`,
        token,
        {},
      );
      buzz("success");
    } catch (error) {
      buzz("error");
      const reason =
        error instanceof ApiError ? error.details.reason : undefined;
      setProblem(
        !(error instanceof ApiError)
          ? part.kind === "FILE"
            ? "Невідомо, чи файл прибрано. Оновіть список і подивіться; повторити безпечно."
            : "Невідомо, чи рядки прибрано. Оновіть список і подивіться; повторити безпечно."
          : reason === "LAST_PART"
            ? part.kind === "FILE"
              ? LAST_PART
              : LAST_TYPED_PART
            : reason === "ALREADY_DECIDED"
              ? "Цей список уже затвердили або відхилили."
              : reason === "LIST_STORE_CANNOT_RECEIVE"
                ? cannotReceiveText(list)
                : // The list is read again just below. What was not done,
                  // then the step (owner, В-П1 (б), 2026-11-11).
                  listRefusal(
                    error,
                    part.kind === "FILE"
                      ? "Файл не прибрано."
                      : "Рядки не прибрано.",
                    "Перегляньте файли списку.",
                  ),
      );
      // Refused: the sheet closed at once, the problem said on the screen,
      // the list read again behind it.
      setAsking(null);
      setBusy(false);
      await refresh();
      return;
    }
    // Removed: read again under the sheet's eyelet, then closed — the
    // file's tag comes back as it now is (review).
    await refresh();
    setAsking(null);
    setBusy(false);
  }

  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        pushed
        title="Файли списку"
        back={<ListBack title={title} held={busy} leave={leave} />}
      />
      <section className="openings opening-files">
        {list.status === "IN_REVIEW" && <Room list={list} />}
        {problem && <p role="alert">{problem}</p>}
        {parts.error && (
          <Unread
            error={parts.error}
            held={parts.isFetching}
            retry={() => {
              void parts.refetch();
            }}
          />
        )}
        {parts.isPending ? (
          <Placeholder said="Завантажуємо файли…" lineTags={2} />
        ) : (
          <div className="tags opening-parts">
            {items.map((part) => (
              <PartTag
                key={part.part_id}
                part={part}
                last={part.removed_at === null && live.length === 1}
                editable={editable}
                held={busy || blocked}
                show={() => {
                  show(part);
                }}
                ask={() => {
                  setProblem(null);
                  setAsking(part);
                }}
              />
            ))}
          </div>
        )}
      </section>
      {asking && (
        <RemoveSheet
          part={asking}
          busy={busy}
          blocked={blocked}
          fallback={heading}
          remove={() => {
            void remove(asking);
          }}
          close={() => {
            if (!busy) setAsking(null);
          }}
        />
      )}
    </>
  );
}

/** How much room the list has left, one line: on «Файли списку», and where
 * lines are added — a list typed in one go has no files' screen (P0-1;
 * review). */
function Room({ list }: { list: StockList }): JSX.Element {
  return (
    <p className="hint opening-room">
      {`Місце у списку: рядків ${number(list.summary.lines)} з ${number(list.summary.limits.lines)} · відповідей ${number(list.summary.allocations)} з ${number(list.summary.limits.allocations)}`}
    </p>
  );
}

/** «08.10.26, 20:21 · Звідки …»: a file's tag on «Файли списку» (P0-1) —
 * a row tag, as the list's lines (stage 2, goods task list, P0-6). */
function PartTag({
  part,
  last,
  editable,
  held,
  show,
  ask,
}: {
  part: StockPart;
  /** The list's last file: rejected, never removed. */
  last: boolean;
  editable: boolean;
  held: boolean;
  show: () => void;
  ask: () => void;
}): JSX.Element {
  const removed = part.removed_at !== null;
  const answered = part.progress.resolved + part.progress.skipped;
  return (
    <article
      className={`today-tag tag-row tag-outline opening-part${
        removed ? " part-removed tone-offline ring" : " tone-ink"
      }`}
      aria-label={`Файл ${String(part.part_no)}`}
    >
      <div className="today-tag-body">
        <span className="today-tag-eyelet" aria-hidden="true" />
        <h3 className="t-row today-tag-title">
          <span>
            {`${String(part.part_no)}. ${partName(part)}${
              part.source === null ? "" : ` · Звідки: ${visible(part.source)}`
            }`}
          </span>
        </h3>
        <p className="t-meta today-tag-meta">
          {`Рядки ${String(part.first_line_no)}–${String(part.last_line_no)}${
            removed
              ? ` · рядків ${String(part.lines)}`
              : ` · розібрано ${String(answered)} з ${String(part.lines)}`
          }`}
        </p>
        <p className="t-meta today-tag-meta">
          {part.removed_at === null
            ? `Додано: ${visible(part.added_by_name ?? "—")}, ${when(part.added_at)}`
            : `Прибрано: ${visible(part.removed_by_name ?? "—")}, ${when(part.removed_at)}`}
        </p>
        {/* The reason to remove a file, in a warning's colour (P0-1). */}
        {!removed && part.photo_lines_elsewhere > 0 && (
          <p className="opening-repeats">
            <Icon name="warning" size={16} />
            <span>
              {`Рядків цього файлу, що вже є в інших файлах списку (те саме фото й рядок): ${String(part.photo_lines_elsewhere)}. Якщо файл додано помилково, приберіть його.`}
            </span>
          </p>
        )}
        <div className="opening-tag-foot">
          {editable && !removed && (
            <button
              type="button"
              className="quiet"
              aria-haspopup="dialog"
              disabled={last || held}
              onClick={ask}
            >
              {part.kind === "FILE" ? "Прибрати файл" : "Прибрати рядки"}
            </button>
          )}
          <button
            type="button"
            className="tag-verb opening-part-lines"
            onClick={() => {
              // A tag's verb, felt (spec §6.9).
              buzz("light");
              show();
            }}
          >
            Показати рядки
          </button>
        </div>
        {editable && last && (
          <p className="hint">
            {part.kind === "FILE" ? LAST_PART : LAST_TYPED_PART}
          </p>
        )}
      </div>
    </article>
  );
}

/** «Прибрати файл?»: the same question, and Telegram's MainButton «Так,
 * прибрати» — outside Telegram, the sheet's own; «Назад» closes it (P0-1). */
function RemoveSheet({
  part,
  busy,
  blocked,
  fallback,
  remove,
  close,
}: {
  part: StockPart;
  busy: boolean;
  blocked: boolean;
  fallback: RefObject<HTMLElement>;
  remove: () => void;
  close: () => void;
}): JSX.Element {
  const asked = removal(part, part.progress.resolved + part.progress.skipped);
  const words = "Так, прибрати";
  const press = (): void => {
    if (!busy && !blocked) remove();
  };
  const main = useMainButton(words, press, {
    progress: busy,
    active: !blocked,
  });
  return (
    <Sheet
      title={`${asked.button}?`}
      close={close}
      fallback={fallback}
      held={busy}
      foot={
        main ? undefined : (
          <div className="count-foot">
            <MainMimic
              words={words}
              busy={busy}
              ready={!blocked}
              press={press}
            />
          </div>
        )
      }
    >
      <p className="opening-asked">{asked.question}</p>
    </Sheet>
  );
}

/** Telegram's MainButton outside Telegram: the dock's, or a sheet's foot's,
 * one button; pressed, its eyelet turns. */
function MainMimic({
  words,
  busy,
  ready,
  press,
  submit = false,
}: {
  words: string;
  busy: boolean;
  ready: boolean;
  press?: () => void;
  /** The form's own: Enter in a field presses it too. */
  submit?: boolean;
}): JSX.Element {
  return (
    <button
      type={submit ? "submit" : "button"}
      className={submit ? "main-mimic" : "sheet-done main-mimic"}
      disabled={!ready && !busy}
      aria-disabled={busy || undefined}
      onClick={
        submit
          ? undefined
          : () => {
              if (!busy) press?.();
            }
      }
    >
      {busy ? (
        <>
          <Eyelet state="spin" size={20} />
          <span className="visually-hidden">{words}</span>
        </>
      ) : (
        words
      )}
    </button>
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
 *
 * A kept command may name a part removed since its answer was lost: the
 * server then answers with that part, removed, and the file is sent again as
 * a new command — a removed file comes back only as a new one (owner,
 * 2026-10-08; review, 2026-10-09).
 */
export function AddFile({
  list,
  store,
  token,
  title,
  warehouse,
  blocked,
  done,
  refresh,
  leave,
}: {
  list: StockList;
  store: Store;
  token: string;
  /** The list's name, its «←». */
  title: string;
  warehouse: string;
  blocked: boolean;
  /** Added: the list is read again, and this screen closes. */
  done: () => Promise<void>;
  /** Not known yet: the list is read again, and this screen stays. */
  refresh: () => Promise<void>;
  leave: () => void;
}): JSX.Element {
  const [read, setRead] = useState<StockFileRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const heading = useTitleFocus();
  // Where storage cannot keep it, the command lives as long as this form,
  // until the server answers it.
  const fallback = useRef<string | null>(null);

  function formCommand(): string {
    fallback.current ??= crypto.randomUUID();
    return fallback.current;
  }

  function commandId(key: string | null): string {
    if (key === null) return formCommand();
    try {
      const kept = window.localStorage.getItem(key);
      if (kept) return kept;
      const fresh = crypto.randomUUID();
      window.localStorage.setItem(key, fresh);
      return fresh;
    } catch {
      return formCommand();
    }
  }

  /** The server answered the command: the next press is a new one. */
  function forget(key: string | null): void {
    fallback.current = null;
    if (key === null) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* Nothing kept: nothing to forget. */
    }
  }

  /** `again`: sent once more, the kept command having named a removed part. */
  async function send(again = false): Promise<void> {
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
    let removed = false;
    try {
      const added = await api<{ part: StockPart }>(
        `/snapshots/${list.snapshot_id}/parts?store_id=${store.id}`,
        token,
        body,
        undefined,
        "POST",
        { slow: true },
      );
      forget(key);
      // The kept command named a part removed since: sent again, as new.
      removed = added.part.removed_at !== null && !again;
      if (!removed) await done();
    } catch (error) {
      // Answered: a second press is a new command. Not answered, or refused
      // for the person's requests before anything was read (ADR-0020): the
      // same.
      if (error instanceof ApiError && error.code !== "TOO_MANY_REQUESTS")
        forget(key);
      setProblems(
        refusal(
          error,
          list,
          "Невідомо, чи додано файл. Натисніть ще раз — той самий файл не додасться двічі.",
          "Цей файл уже надсилали, але в іншому вигляді. Натисніть «Додати до списку» ще раз — його буде надіслано як новий.",
          // What was not done, then the step (owner, В-П1 (б),
          // 2026-11-11).
          ["Файл не додано.", "Перевірте його."],
        ),
      );
      // Changed in a way it does not name: read again (review, 2026-10-24).
      if (error instanceof SlowAnswer || listConflict(error)) await refresh();
    } finally {
      setBusy(false);
    }
    if (removed) await send(true);
  }

  // The screen's one action, Telegram's (spec §6.4; P0-1).
  const words = "Додати до списку";
  const press = (): void => {
    if (read?.ok && !busy && !blocked) void send();
  };
  const main = useMainButton(words, press, {
    progress: busy,
    active: read?.ok === true && !blocked,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, !main);

  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        pushed
        title="Додати файл"
        back={<ListBack title={title} held={busy} leave={leave} />}
      />
      <form
        className="openings opening-add"
        aria-label="Додати файл"
        onSubmit={(event) => {
          event.preventDefault();
          press();
        }}
      >
        <Room list={list} />
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
        {!main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <MainMimic
              words={words}
              busy={busy}
              ready={read?.ok === true && !blocked}
              submit
            />
          </div>
        )}
      </form>
    </>
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
 *
 * Sent again after a lost answer, with the text changed meanwhile, the same
 * command is refused as another one (`IDEMPOTENCY_CONFLICT`): what was sent
 * first is in the list, so the text is kept and goes as a new command at the
 * next press (review, 2026-10-09).
 */
export function AddLines({
  list,
  store,
  token,
  title,
  blocked,
  done,
  refresh,
  leave,
}: {
  list: StockList;
  store: Store;
  token: string;
  /** The list's name, its «←». */
  title: string;
  blocked: boolean;
  done: () => Promise<void>;
  refresh: () => Promise<void>;
  leave: () => void;
}): JSX.Element {
  const [draft, setDraftState] = useState<LinesDraft>(() =>
    loadLines(list.snapshot_id),
  );
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const heading = useTitleFocus();
  const lines = draft.text.split("\n").filter((line) => line.trim() !== "");
  const tooLong = lines.find((line) => line.length > 500);
  const tooMuch = typedTooMuch(lines, "Розділіть їх на кілька разів.");

  function setDraft(change: Partial<LinesDraft>): void {
    // From the draft as it is now: typing may go on while an answer is
    // awaited, and a new command id must not undo it.
    setDraftState((current) => {
      const next = { ...current, ...change };
      saveLines(list.snapshot_id, next);
      return next;
    });
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
      if (error instanceof ApiError && error.code === "IDEMPOTENCY_CONFLICT") {
        setDraft({ command_id: crypto.randomUUID() });
        await refresh();
      }
      setProblems(
        refusal(
          error,
          list,
          "Невідомо, чи додано рядки. Натисніть ще раз — ті самі рядки не додадуться двічі.",
          "Рядки, надіслані перед цим, уже є в списку, а ці відрізняються від них. Натисніть «Додати рядки» ще раз — ці буде додано як нові, окремо від тих.",
          // What was not done, then the step (owner, В-П1 (б),
          // 2026-11-11).
          ["Рядки не додано.", "Перевірте їх."],
        ),
      );
      // Changed in a way it does not name: read again (review, 2026-10-24).
      if (error instanceof SlowAnswer || listConflict(error)) await refresh();
    } finally {
      setBusy(false);
    }
  }

  // The screen's one action, Telegram's (spec §6.4; P0-1).
  const ready = lines.length > 0 && !tooLong && !tooMuch;
  const words = "Додати рядки";
  const press = (): void => {
    if (ready && !busy && !blocked) void send();
  };
  const main = useMainButton(words, press, {
    progress: busy,
    active: ready && !blocked,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, !main);

  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        pushed
        title="Додати рядки вручну"
        back={<ListBack title={title} held={busy} leave={leave} />}
      />
      <form
        className="openings opening-add"
        aria-label="Додати рядки вручну"
        onSubmit={(event) => {
          event.preventDefault();
          press();
        }}
      >
        <Room list={list} />
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
        {tooMuch && <p role="alert">{tooMuch}</p>}
        <Problems problems={problems} />
        {!main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <MainMimic
              words={words}
              busy={busy}
              ready={ready && !blocked}
              submit
            />
          </div>
        )}
      </form>
    </>
  );
}
