import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  SlowAnswer,
  api,
  errorText,
  unreachable,
} from "@/shared/api";
import type { Location, Store } from "@/orders/types";
import { CatalogPicker } from "@/inventory/CatalogPicker";
import type { ReceivableVariant, SizeOption } from "@/inventory/receiptTypes";
import { visible } from "@/shared/visible";
import { FileChooser } from "./FileChooser";
import { fileProblemTexts } from "./fileErrors";
import { AddFile, AddLines, PartsSection, partName } from "./Parts";
import { MAX_BODY_BYTES, TOO_LARGE, bodyBytes } from "./stockFile";
import type { StockFileRead } from "./stockFile";
import {
  basisLabels,
  cannotReceiveText,
  fileReasonLabels,
  lineStatusLabels,
  listConflict,
  listRefusal,
  listStatusLabels,
  number,
  plural,
  priceKindLabels,
  sizesWithCounts,
  sourceQuantity,
  times,
  typedTooMuch,
} from "./types";
import type {
  Basis,
  LineStatus,
  ListLine,
  Reading,
  ShownSize,
  SplitReading,
  StockList,
  StockPart,
} from "./types";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";

/**
 * «Початкові залишки»: the goods already in a shop, entered as a list.
 *
 * The owner's way in for existing stock (2026-10-01; ADR-0005): a list is kept
 * line by line as it was written, a person says what each line is and where
 * its numbers came from, and an owner approves the whole list into the
 * warehouse's opening balance — once, into a warehouse with no history.
 *
 * A list is typed, or filled from a parser's files (owner decision,
 * 2026-10-08; ADR-0014): the shops photograph their notebooks, a parser reads
 * them into Birka's format, and each file joins the warehouse's one list.
 * The parser's reading is shown beside each line as a hint, never as the
 * answer. A shared warehouse's list belongs to both stores, so every call on
 * a list names the store acted through (`store_id`).
 *
 * Every command here is safe to send twice — the list by its `command_id`, a
 * line's answer by the line, an approval by the review revision it approves —
 * so no journal is kept: a lost answer is resent, or the list read again. The
 * list being typed is kept on this phone until the server has it; a file's
 * name and fingerprint are, never its content.
 *
 * Every text from a file, every line of a list, and every name and reason
 * people gave it is shown through `visible()`: what reorders or hides
 * characters is shown as a mark.
 *
 * While the store that started a shared warehouse's list does not trade,
 * the list is only rejected, through the other store, which releases the
 * warehouse for a new list there (owner decision, 2026-10-09).
 */
export function Openings({
  store,
  token,
  scopeKey,
  blocked,
  back,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element {
  const canImport = store.permissions.includes("snapshot:import");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const lists = useQuery({
    queryKey: ["stock-lists", scopeKey, store.id],
    queryFn: () =>
      api<{ items: StockList[]; has_more: boolean }>(
        `/snapshots?store_id=${store.id}&limit=100`,
        token,
      ),
    retry: false,
  });
  const locations = useQuery({
    queryKey: ["opening-locations", scopeKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  // Only ever shown, so guarded once here for every place it reaches.
  const warehouse = (id: string): string =>
    visible(locations.data?.find((l) => l.id === id)?.name ?? "склад");
  const open = lists.data?.items.find((l) => l.snapshot_id === openId);

  if (open)
    return (
      <ListView
        list={open}
        store={store}
        token={token}
        scopeKey={scopeKey}
        warehouse={warehouse(open.location_id)}
        blocked={blocked}
        close={() => {
          setOpenId(null);
        }}
      />
    );
  return (
    <section className="openings">
      {back && <BackToMore back={back} />}
      <div className="toolbar">
        <h2>Початкові залишки</h2>
        <button
          className="quiet"
          disabled={lists.isFetching}
          onClick={() => {
            void lists.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        Товар, що вже лежить у магазині, вноситься списком — рядок за рядком, як
        у зошиті: текстом або файлом від парсера. Кожен рядок розбирає людина,
        потім власник затверджує список, і він стає початковим залишком складу.
        Склад має бути без жодного руху товару: поки список чекає рішення, на
        такому складі нічого не приймають, не продають і не виправляють.
      </p>
      {canImport &&
        (creating ? (
          <NewList
            store={store}
            token={token}
            scopeKey={scopeKey}
            locations={(locations.data ?? []).filter(
              (l) => l.is_active && l.can_receive && !l.damaged_returns,
            )}
            blocked={blocked}
            done={(list) => {
              setCreating(false);
              void lists.refetch().then(() => {
                setOpenId(list.snapshot_id);
              });
            }}
            openList={(id) => {
              setCreating(false);
              void lists.refetch().then(() => {
                setOpenId(id);
              });
            }}
            cancel={() => {
              setCreating(false);
            }}
          />
        ) : (
          <button
            disabled={blocked}
            onClick={() => {
              setCreating(true);
            }}
          >
            Новий список
          </button>
        ))}
      {lists.isPending ? (
        <p role="status">Завантажуємо списки…</p>
      ) : lists.error ? (
        <p role="alert">{errorText(lists.error)}</p>
      ) : lists.data.items.length === 0 ? (
        <p>Списків ще немає.</p>
      ) : (
        lists.data.items.map((list) => (
          <article
            className="line catalog-card"
            key={list.snapshot_id}
            aria-label={`Список ${visible(list.source_document_ref ?? "")}`.trim()}
          >
            <strong>
              {listName(list)} · склад «{warehouse(list.location_id)}»
            </strong>
            <span className="badge">{listStatusLabels[list.status]}</span>
            {list.store_id !== store.id && (
              <small>Веде магазин «{visible(list.store_name ?? "—")}»</small>
            )}
            <small>
              Рядків: {list.summary.lines} · розібрано{" "}
              {list.summary.resolved + list.summary.skipped} · одиниць{" "}
              {list.summary.units}
            </small>
            <button
              className="quiet"
              onClick={() => {
                // The list a draft's command made, its answer lost, found
                // here: made, so nothing of the draft is sent again (review,
                // fourth round, 2026-10-09).
                forgetDraftOf(store, list);
                setOpenId(list.snapshot_id);
              }}
            >
              Відкрити
            </button>
          </article>
        ))
      )}
    </section>
  );
}

/** A list's name, as the shop called it; guarded, since a file may name it. */
function listName(list: StockList): string {
  return list.source_document_ref === null
    ? "Список без назви"
    : visible(list.source_document_ref);
}

interface Draft {
  command_id: string;
  location_id: string;
  source: string;
  captured: string;
  text: string;
  /** Typed in, or a parser's file. */
  mode: "text" | "file";
  /** The file last picked, by name and the sha256 of its bytes — never its
   * content: picked again after a lost answer, it is the same command. */
  file_name: string | null;
  file_sha256: string | null;
  /** A send got no answer, none in time, or a gateway's own (502, 503,
   * 504), and nothing since has settled it: the server may have made the
   * list, or may still, so the command stays the same whatever file is
   * picked, and no second list is started at the warehouse (review,
   * 2026-10-09). A refusal of a later send's form does not settle it (third
   * round, the same day); the command refused as sent before in another
   * form does: the server holds it, so no send of it makes another list
   * (fourth round). */
  unsettled: boolean;
}

function draftKey(store: Store): string {
  return `birka:stock-list-draft:${store.id}`;
}

function freshDraft(): Draft {
  return {
    command_id: crypto.randomUUID(),
    location_id: "",
    source: "",
    captured: "",
    text: "",
    mode: "text",
    file_name: null,
    file_sha256: null,
    unsettled: false,
  };
}

function loadDraft(store: Store): Draft {
  try {
    const stored = window.localStorage.getItem(draftKey(store));
    // A draft kept before files were taken has no mode: it was typed.
    if (stored)
      return { ...freshDraft(), ...(JSON.parse(stored) as Partial<Draft>) };
  } catch {
    /* A fresh list: the server has not seen this one. */
  }
  return freshDraft();
}

/**
 * Keep the draft on this phone — never anything of a file's content: a name
 * or a date the file filled in is left out, and filled in again when the
 * file is picked again (review, 2026-10-09). What the person typed is kept.
 */
function saveDraft(
  store: Store,
  draft: Draft | null,
  file: StockFileRead | null = null,
): void {
  const filled = file?.ok ? file.summary : null;
  try {
    if (draft)
      window.localStorage.setItem(
        draftKey(store),
        JSON.stringify({
          ...draft,
          source:
            filled !== null && draft.source === filled.source
              ? ""
              : draft.source,
          captured:
            filled !== null && draft.captured === filled.counted_on
              ? ""
              : draft.captured,
        }),
      );
    else window.localStorage.removeItem(draftKey(store));
  } catch {
    /* Typing still works; only a reload loses it. */
  }
}

/** A draft whose command made this list is done: it is never sent again. */
function forgetDraftOf(store: Store, list: StockList): void {
  if (loadDraft(store).command_id === list.command_id) saveDraft(store, null);
}

/** The list's lines as the server keeps them: verbatim, minus blank ones. */
function listLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/**
 * A new list refused for a reason the screen does not name, by what was
 * sent: its lines or its file — never the warehouse, chosen from the list.
 * `unsure`: a send before this one never answered, so whether that one made
 * the list is not known yet; the refusal is of this request alone
 * (review, 2026-10-24).
 */
function newListRefusal(
  error: unknown,
  mode: "text" | "file",
  unsure: boolean,
): string {
  const what = mode === "file" ? "файл" : "рядки";
  return unsure
    ? listRefusal(
        error,
        "Сервер не прийняв цей запит, а чи збережено список попередньою спробою — ще невідомо.",
        `Перевірте ${what}${mode === "file" ? " і" : " й"} натисніть ще раз — двічі список не збережеться.`,
        "Дані змінилися — натисніть ще раз: двічі список не збережеться.",
      )
    : listRefusal(
        error,
        "Список не збережено.",
        `Перевірте ${what} та спробуйте ще раз.`,
        "Поки ви працювали, дані змінилися — спробуйте ще раз.",
      );
}

/** A file's own name for itself, taken as the list's if it fits. */
function fits(value: string | null, limit: number): value is string {
  return value !== null && value.trim() !== "" && value.length <= limit;
}

function NewList({
  store,
  token,
  scopeKey,
  locations,
  blocked,
  done,
  openList,
  cancel,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  locations: Location[];
  blocked: boolean;
  done: (list: StockList) => void;
  /** Open a list already waiting at the chosen warehouse. */
  openList: (id: string) => void;
  cancel: () => void;
}): JSX.Element {
  const [draft, setDraftState] = useState<Draft>(() => loadDraft(store));
  const [read, setRead] = useState<StockFileRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const lines = listLines(draft.text);
  const tooLong = lines.find((line) => line.length > 500);
  const tooMuch =
    draft.mode === "text"
      ? typedTooMuch(
          lines,
          "Розділіть: решту додайте до списку через «Додати рядки вручну».",
        )
      : null;
  const chosen = locations.find((l) => l.id === draft.location_id);
  const warehouse = chosen ? visible(chosen.name) : null;
  // The owner's rule (2026-10-08): a warehouse whose list waits gets no
  // second one from the app — its files go into the list that waits. The
  // list this very draft created, its answer lost, is no second list.
  const waiting = useQuery({
    queryKey: ["stock-list-waiting", scopeKey, store.id, draft.location_id],
    queryFn: () =>
      api<{ items: StockList[] }>(
        `/snapshots?store_id=${store.id}&location_id=${draft.location_id}&status=IN_REVIEW&limit=20`,
        token,
      ),
    enabled: draft.location_id !== "",
    retry: false,
  });
  const other = waiting.data?.items.find(
    (list) => list.command_id !== draft.command_id,
  );
  // The list this draft's command made, its answer lost or too slow: the
  // person is taken to it, rather than send again (review, 2026-10-09).
  const mine = waiting.data?.items.find(
    (list) => list.command_id === draft.command_id,
  );
  // Read and not being read again: a list found by a re-read in flight
  // would come too late to stop a second one.
  const checked =
    waiting.isSuccess &&
    !waiting.isFetching &&
    other === undefined &&
    mine === undefined;
  const content =
    draft.mode === "text"
      ? lines.length > 0 && !tooLong && !tooMuch
      : read?.ok === true;
  const ready = draft.location_id !== "" && checked && content && !busy;

  /**
   * `file`: the file whose name and date are not kept on the phone. Merged
   * into the draft as it is now: a file is read while the person types.
   */
  function setDraft(change: Partial<Draft>, file = read): void {
    setDraftState((current) => {
      const next = { ...current, ...change };
      saveDraft(store, next, file);
      return next;
    });
  }

  function picked(next: StockFileRead): void {
    setRead(next);
    setProblems([]);
    if (!next.ok) return;
    // The same file again, after an answer that was lost: the same command.
    // So is any file while the last send is unsettled: the list it may have
    // made is found by its command, never started twice.
    const same =
      draft.unsettled ||
      (next.sha256 !== null &&
        next.sha256 === draft.file_sha256 &&
        next.name === draft.file_name);
    // The file's own name and date fill the list's, unless the person typed
    // their own; a file picked instead of another replaces what it filled.
    const filled = read?.ok ? read.summary : null;
    const { source, counted_on } = next.summary;
    setDraft(
      {
        command_id: same ? draft.command_id : crypto.randomUUID(),
        file_name: next.name,
        file_sha256: next.sha256,
        ...((draft.source.trim() === "" || draft.source === filled?.source) &&
        fits(source, 300)
          ? { source }
          : {}),
        ...((draft.captured.trim() === "" ||
          draft.captured === filled?.counted_on) &&
        fits(counted_on, 40)
          ? { captured: counted_on }
          : {}),
      },
      next,
    );
    // Whether the unsettled send made a list here, read again.
    if (draft.unsettled && draft.location_id !== "") void waiting.refetch();
  }

  async function send(): Promise<void> {
    // A send before this one never answered: it may have made the list.
    const unsure = draft.unsettled;
    const envelope = {
      command_id: draft.command_id,
      store_id: store.id,
      location_id: draft.location_id,
      source_document_ref: draft.source.trim() || null,
      captured_at: draft.captured.trim() || null,
    };
    const body =
      draft.mode === "file" && read?.ok
        ? { ...envelope, file: read.file, file_name: read.name }
        : { ...envelope, lines };
    if (draft.mode === "file" && bodyBytes(body) > MAX_BODY_BYTES) {
      setProblems([TOO_LARGE]);
      return;
    }
    setBusy(true);
    setProblems([]);
    try {
      const list = await api<StockList>(
        "/snapshots",
        token,
        body,
        undefined,
        "POST",
        // A file of a thousand lines may take longer than 20 s to take in.
        { slow: draft.mode === "file" },
      );
      saveDraft(store, null);
      done(list);
    } catch (error) {
      // No answer, none in time, or a gateway's own (502, 503, 504) leaves
      // the command unsettled: the list may have been made, or may still
      // be. A refusal of this request's form says nothing of a send before
      // it and leaves the command as it was. The command refused as sent
      // before in another form settles it: the server holds the command, so
      // no send of it, however slow, makes another list, whether that list
      // still waits, was decided, or is at another warehouse. The warehouse
      // is read again before a new command can be sent (review, third and
      // fourth rounds, 2026-10-09).
      const conflict =
        error instanceof ApiError && error.code === "IDEMPOTENCY_CONFLICT";
      const unanswered = !(error instanceof ApiError) || unreachable(error);
      if (unanswered) setDraft({ unsettled: true });
      if (conflict) setDraft({ unsettled: false });
      if (error instanceof SlowAnswer || conflict || listConflict(error))
        void waiting.refetch();
      const refused =
        error instanceof ApiError
          ? fileProblemTexts(error.validation, error.validationMore)
          : [];
      setProblems(
        error instanceof SlowAnswer
          ? [errorText(error)]
          : unanswered
            ? [
                "Невідомо, чи збережено список. Натисніть ще раз — той самий список не збережеться двічі.",
              ]
            : error.code === "IDEMPOTENCY_CONFLICT"
              ? [
                  "Цей список уже збережено, але в іншому вигляді. Знайдіть його в переліку, або почніть новий.",
                ]
              : refused.length > 0
                ? refused
                : [newListRefusal(error, draft.mode, unsure)],
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="notice"
      aria-label="Новий список"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h3>Новий список</h3>
      <label>
        Склад
        <select
          value={draft.location_id}
          onChange={(event) => {
            setDraft({ location_id: event.target.value });
          }}
        >
          <option value="">Оберіть склад</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {visible(location.name)}
            </option>
          ))}
        </select>
      </label>
      {draft.location_id !== "" &&
        (waiting.isPending ? (
          <p role="status">Перевіряємо, чи на складі не чекає список…</p>
        ) : waiting.error ? (
          <div role="alert">
            <p>{errorText(waiting.error)}</p>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                void waiting.refetch();
              }}
            >
              Перевірити ще раз
            </button>
          </div>
        ) : mine ? (
          <div className="notice" role="status">
            <p>
              {`Список «${listName(mine)}» уже збережено, хоч відповідь сервера й не дійшла вчасно. Відкрийте його — інші файли чи рядки додайте вже до нього.`}
            </p>
            <button
              type="button"
              onClick={() => {
                // Made: nothing of this draft is to be sent again.
                saveDraft(store, null);
                openList(mine.snapshot_id);
              }}
            >
              Відкрити список
            </button>
          </div>
        ) : (
          other && (
            <div className="notice" role="status">
              <p>
                {other.store_state === "ACTIVE"
                  ? `На складі «${warehouse ?? "—"}» уже чекає список «${listName(other)}» (веде магазин «${visible(other.store_name ?? "—")}»). Другий список для нього не створюють — додайте файл до наявного.`
                  : `На складі «${warehouse ?? "—"}» чекає список «${listName(other)}» магазину «${visible(other.store_name ?? "—")}», який не працює. Відкрийте й відхиліть його — тоді можна почати новий список і додати до нього файли.`}
              </p>
              <button
                type="button"
                onClick={() => {
                  openList(other.snapshot_id);
                }}
              >
                Відкрити список
              </button>
            </div>
          )
        ))}
      <fieldset>
        <legend>Як внести список</legend>
        <label className="check">
          <input
            type="radio"
            name="stock-list-mode"
            checked={draft.mode === "text"}
            onChange={() => {
              setDraft({ mode: "text" });
              setProblems([]);
            }}
          />
          Вставити текст
        </label>
        <label className="check">
          <input
            type="radio"
            name="stock-list-mode"
            checked={draft.mode === "file"}
            onChange={() => {
              setDraft({ mode: "file" });
              setProblems([]);
            }}
          />
          Завантажити файл
        </label>
      </fieldset>
      {draft.mode === "file" && (
        <>
          <FileChooser
            read={read}
            onRead={picked}
            warehouse={warehouse}
            disabled={busy}
          />
          {read === null && draft.file_name !== null && (
            <p className="hint">
              {`Раніше обрано файл «${visible(draft.file_name)}». Оберіть його ще раз — той самий файл не збережеться двічі.`}
            </p>
          )}
        </>
      )}
      <label>
        Звідки список (необов’язково)
        <input
          value={draft.source}
          maxLength={300}
          placeholder="Наприклад, «Зошит 2, сторінки 1–4»"
          onChange={(event) => {
            setDraft({ source: event.target.value });
          }}
        />
      </label>
      <label>
        Коли перелічено (необов’язково)
        <input
          value={draft.captured}
          maxLength={40}
          placeholder="Наприклад, 30.09.2026"
          onChange={(event) => {
            setDraft({ captured: event.target.value });
          }}
        />
      </label>
      {draft.mode === "text" && (
        <>
          <label>
            Рядки списку — кожен товар з нового рядка, як написано
            <textarea
              value={draft.text}
              rows={10}
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
        </>
      )}
      {problems.length === 1 ? (
        <p role="alert">{visible(problems[0] ?? "")}</p>
      ) : (
        problems.length > 1 && (
          <div role="alert">
            <ul>
              {problems.map((problem, index) => (
                <li key={index}>{visible(problem)}</li>
              ))}
            </ul>
          </div>
        )
      )}
      <div className="actions">
        {!other && !mine && (
          <button type="submit" disabled={!ready || blocked}>
            Зберегти список
          </button>
        )}
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={cancel}
        >
          Закрити
        </button>
        {/* Only after an answer: while the last send is unsettled, the list
            it may have made is found by its command, and a new command
            would start a second list beside it (review, 2026-10-09). */}
        {problems.length > 0 && !draft.unsettled && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => {
              setDraft({ command_id: crypto.randomUUID(), unsettled: false });
              setProblems([]);
              // A list made since the last read is found before the new
              // command can be sent.
              if (draft.location_id !== "") void waiting.refetch();
            }}
          >
            Почати як новий список
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * What the person is asked to do about a waiting list, by what they may do
 * (review, 2026-10-09): approving takes its own right, rejecting is open to
 * whoever may add a file, and someone who may do neither is asked nothing.
 */
function decisionText(
  trading: boolean,
  canApprove: boolean,
  canImport: boolean,
): string {
  if (!canApprove && !canImport) return "";
  if (!trading) return " Відхиліть його, щоб склад звільнився.";
  return canApprove
    ? " Затвердіть або відхиліть його."
    : " Затверджує той, хто має право затверджувати списки; відхилити його можна й вам.";
}

const lineFilters: { status: LineStatus | null; label: string }[] = [
  { status: "NEEDS_REVIEW", label: "Потребують уваги" },
  { status: "PENDING", label: "Чекають" },
  { status: "RESOLVED", label: "Розібрані" },
  { status: "SKIPPED", label: "Не товар" },
  { status: null, label: "Усі" },
];
const linesPerPage = 50;

function ListView({
  list,
  store,
  token,
  scopeKey,
  warehouse,
  blocked,
  close,
}: {
  list: StockList;
  store: Store;
  token: string;
  scopeKey: string;
  warehouse: string;
  blocked: boolean;
  close: () => void;
}): JSX.Element {
  const cache = useQueryClient();
  const canImport = store.permissions.includes("snapshot:import");
  const canApprove = store.permissions.includes("snapshot:approve");
  const canPick = store.permissions.includes("inventory:receive");
  const [filter, setFilter] = useState<LineStatus | null>(
    list.summary.needs_review > 0 ? "NEEDS_REVIEW" : "PENDING",
  );
  // One file's lines only, or every file's.
  const [partFilter, setPartFilter] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState<"file" | "lines" | null>(null);
  const lines = useQuery({
    queryKey: [
      "stock-list-lines",
      scopeKey,
      list.snapshot_id,
      filter,
      partFilter,
      offset,
    ],
    queryFn: () =>
      api<{ items: ListLine[]; has_more: boolean }>(
        `/snapshots/${list.snapshot_id}/lines?store_id=${store.id}&limit=${String(linesPerPage)}&offset=${String(offset)}${filter ? `&status=${filter}` : ""}${partFilter ? `&part_id=${partFilter}` : ""}`,
        token,
      ),
    retry: false,
  });
  const parts = useQuery({
    queryKey: ["stock-list-parts", scopeKey, list.snapshot_id],
    queryFn: () =>
      api<{ items: StockPart[] }>(
        `/snapshots/${list.snapshot_id}/parts?store_id=${store.id}`,
        token,
      ),
    retry: false,
  });
  const sizes = useQuery({
    queryKey: ["receive-sizes", scopeKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    enabled: canPick && list.status === "IN_REVIEW",
    retry: false,
  });
  const allParts = parts.data?.items ?? [];
  // While the store that started the list does not trade, the list is only
  // rejected, through this store; its files go into a new list (owner
  // decision, 2026-10-09).
  const trading = list.store_state === "ACTIVE";
  const editable = list.status === "IN_REVIEW" && canImport && trading;
  const statusFilters: { status: LineStatus | null; label: string }[] =
    list.summary.parts_removed > 0
      ? [...lineFilters, { status: "REMOVED", label: "Прибрані" }]
      : lineFilters;

  async function refresh(): Promise<void> {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["stock-lists"] }),
      cache.invalidateQueries({ queryKey: ["stock-list-lines"] }),
      cache.invalidateQueries({ queryKey: ["stock-list-parts"] }),
      cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
    ]);
  }

  function showPart(id: string | null): void {
    setPartFilter(id);
    // A file's lines, all of them: a removed file's are only «Прибрано».
    if (id !== null) setFilter(null);
    setOffset(0);
    setEditing(null);
  }

  return (
    <section className="openings">
      <div className="toolbar">
        <h2>{listName(list)}</h2>
        <button className="quiet" onClick={close}>
          До списків
        </button>
      </div>
      <p>
        Склад «{warehouse}» · {listStatusLabels[list.status]}
        {list.captured_at ? ` · перелічено ${visible(list.captured_at)}` : ""}
      </p>
      {list.store_id !== store.id && (
        <p className="hint">Веде магазин «{visible(list.store_name ?? "—")}»</p>
      )}
      {list.status === "IN_REVIEW" && !trading && (
        <p className="notice" role="status">
          {`Магазин «${visible(list.store_name ?? "—")}», що почав цей список, не працює: список можна лише відхилити, а файли додати до нового списку.`}
        </p>
      )}
      <p className="hint">
        Рядків: {list.summary.lines} · розібрано {list.summary.resolved} · не
        товар {list.summary.skipped} · чекають{" "}
        {list.summary.pending + list.summary.needs_review} · одиниць{" "}
        {list.summary.units}
      </p>
      {list.status === "IN_REVIEW" && (
        <p className="hint">
          {`Місце у списку: рядків ${number(list.summary.lines)} з ${number(list.summary.limits.lines)} · відповідей ${number(list.summary.allocations)} з ${number(list.summary.limits.allocations)}`}
        </p>
      )}
      {list.status === "APPLIED" && (
        <p role="status">
          Затверджено: {list.application?.units ?? list.summary.units} од. стали
          початковим залишком складу «{warehouse}».
        </p>
      )}
      {list.status === "REJECTED" && (
        <p role="status">
          Відхилено
          {list.rejection_reason ? `: ${visible(list.rejection_reason)}` : ""}.
          Залишків цей список не змінив.
        </p>
      )}
      {list.status === "IN_REVIEW" && (
        <p className="notice">
          Поки список чекає рішення, на складі «{warehouse}», де ще не було руху
          товару, нічого не приймають, не продають і не виправляють.
          {decisionText(trading, canApprove, canImport)}
        </p>
      )}
      {/* Whoever may add or remove a file may reject the list too: a list
          whose last file is wrong is rejected (owner, 2026-10-08), so the
          button the hint names is there. Approving takes its own right. */}
      {list.status === "IN_REVIEW" && (canApprove || canImport) && (
        <Approval
          list={list}
          store={store}
          token={token}
          warehouse={warehouse}
          approvable={trading && canApprove}
          blocked={blocked}
          refresh={refresh}
        />
      )}
      {list.status === "IN_REVIEW" && trading && canImport && !canPick && (
        <p role="alert">
          Щоб розбирати рядки, потрібне право приймати товар у цьому магазині.
        </p>
      )}
      {parts.error ? (
        <p role="alert">{errorText(parts.error)}</p>
      ) : (
        // A list typed in one go is one part: nothing to tell apart.
        (allParts.length > 1 || allParts[0]?.kind === "FILE") && (
          <PartsSection
            list={list}
            store={store}
            token={token}
            parts={allParts}
            editable={editable}
            blocked={blocked || editing !== null}
            show={(part) => {
              showPart(part.part_id);
            }}
            refresh={refresh}
          />
        )
      )}
      {editable &&
        (adding === "file" ? (
          <AddFile
            list={list}
            store={store}
            token={token}
            warehouse={warehouse}
            blocked={blocked}
            done={async () => {
              setAdding(null);
              await refresh();
            }}
            refresh={refresh}
            cancel={() => {
              setAdding(null);
            }}
          />
        ) : adding === "lines" ? (
          <AddLines
            list={list}
            store={store}
            token={token}
            blocked={blocked}
            done={async () => {
              setAdding(null);
              await refresh();
            }}
            refresh={refresh}
            cancel={() => {
              setAdding(null);
            }}
          />
        ) : (
          <div className="actions">
            <button
              className="quiet"
              disabled={blocked}
              onClick={() => {
                setAdding("file");
              }}
            >
              Додати файл
            </button>
            <button
              className="quiet"
              disabled={blocked}
              onClick={() => {
                setAdding("lines");
              }}
            >
              Додати рядки вручну
            </button>
          </div>
        ))}
      <nav aria-label="Рядки списку">
        {statusFilters.map(({ status, label }) => (
          <button
            key={label}
            className={filter === status ? "active" : "quiet"}
            onClick={() => {
              setFilter(status);
              setOffset(0);
              setEditing(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {allParts.length > 1 && (
        <label>
          Файл
          <select
            value={partFilter ?? ""}
            onChange={(event) => {
              showPart(event.target.value === "" ? null : event.target.value);
            }}
          >
            <option value="">Усі файли</option>
            {allParts.map((part) => (
              <option key={part.part_id} value={part.part_id}>
                {`${String(part.part_no)}. ${partName(part)}${part.removed_at === null ? "" : " (прибрано)"}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {lines.isPending ? (
        <p role="status">Завантажуємо рядки…</p>
      ) : lines.error ? (
        <p role="alert">{errorText(lines.error)}</p>
      ) : lines.data.items.length === 0 ? (
        <p>Тут рядків немає.</p>
      ) : (
        <>
          {lines.data.items.map((line) =>
            editing === line.line_no ? (
              <LineEditor
                key={line.line_no}
                line={line}
                list={list}
                store={store}
                token={token}
                scopeKey={scopeKey}
                sizes={sizes.data ?? []}
                listParts={allParts}
                blocked={blocked}
                done={() => {
                  setEditing(null);
                  void refresh();
                }}
                cancel={() => {
                  setEditing(null);
                }}
                reread={() => {
                  void cache.invalidateQueries({
                    queryKey: ["stock-list-lines"],
                  });
                }}
              />
            ) : (
              <LineCard
                key={line.line_no}
                line={line}
                parts={allParts}
                answer={
                  editable && canPick && line.status !== "REMOVED"
                    ? () => {
                        setEditing(line.line_no);
                      }
                    : null
                }
                blocked={blocked || editing !== null}
              />
            ),
          )}
          <div className="toolbar">
            <button
              className="quiet"
              disabled={offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - linesPerPage));
              }}
            >
              Попередні
            </button>
            <button
              className="quiet"
              disabled={!lines.data.has_more}
              onClick={() => {
                setOffset(offset + linesPerPage);
              }}
            >
              Ще рядки
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function sizeText(code: string | null): string {
  return code === null || code === "UNKNOWN"
    ? "розмір невідомий"
    : visible(code);
}

/** «Лоран · шоколад · M × 1, L × 2»: what the parser read, field by field. */
function readingText(reading: Reading): string {
  const sizes = reading.sizes
    ? reading.sizes.join(", ")
    : reading.size_counts
      ? sizesWithCounts(reading.size_counts)
      : null;
  return [reading.model, reading.colours?.join(", ") ?? null, sizes]
    .filter((part): part is string => part !== null && part !== "")
    .map(visible)
    .join(" · ");
}

/**
 * Where a line from a file was written, and what the parser read of it: a
 * hint beside the line, never its answer (ADR-0014 §6). Every string through
 * `visible()`. Shown on the line's card and in its editor alike.
 */
function FileEvidence({
  line,
  parts,
}: {
  line: ListLine;
  parts: StockPart[];
}): JSX.Element {
  const part = parts.find((p) => p.part_id === line.part_id);
  const reading = line.reading;
  const read = reading ? readingText(reading) : "";
  return (
    <>
      {line.photo_name !== null && line.photo_line !== null && (
        <small>
          Фото: {visible(line.photo_name)}, рядок {line.photo_line}
        </small>
      )}
      {part && (part.kind === "FILE" || parts.length > 1) && (
        <small>Файл: {partName(part)}</small>
      )}
      {read !== "" && <small>Прочитано: {read}</small>}
      {reading?.count != null && (
        <small>Парсер прочитав кількість: {reading.count}</small>
      )}
      {reading?.price != null && (
        <small>
          Ціна з зошита: {visible(reading.price)}
          {line.price_kind ? ` (${priceKindLabels[line.price_kind]})` : ""}
        </small>
      )}
      {line.file_reasons.map((reason) =>
        reason === "FILE_NOTE" ? (
          <small key={reason}>
            Примітка парсера: {visible(reading?.note ?? "")}
          </small>
        ) : (
          <small key={reason}>{fileReasonLabels[reason] ?? reason}</small>
        ),
      )}
      {line.same_photo_lines > 1 && (
        <small>
          Цей рядок того самого фото у списку — {times(line.same_photo_lines)}:
          можливо, фото прочитано двічі або додано у двох файлах.
        </small>
      )}
    </>
  );
}

function LineCard({
  line,
  parts,
  answer,
  blocked,
}: {
  line: ListLine;
  parts: StockPart[];
  answer: (() => void) | null;
  blocked: boolean;
}): JSX.Element {
  return (
    <article
      className="line catalog-card"
      aria-label={`Рядок ${String(line.line_no)}`}
    >
      <strong className="catalog-raw">
        {line.line_no}. {line.raw_text === null ? "—" : visible(line.raw_text)}
      </strong>
      <span className="badge">{lineStatusLabels[line.status]}</span>
      <small>{visible(sourceQuantity(line))}</small>
      <FileEvidence line={line} parts={parts} />
      {(line.shown_split ?? [])
        .filter((size) => size.may_be_range)
        .map((size) => (
          <small key={`range:${size.size}`}>
            {`Запис «${recordText(size)}» може означати й діапазон розмірів: під час розбору вкажіть, що саме.`}
          </small>
        ))}
      {line.same_text_lines > 1 && (
        <small>
          Такий самий рядок у списку — {times(line.same_text_lines)}: це може
          бути по рядку на кожну одиницю, або помилка переписування.
        </small>
      )}
      {line.status === "RESOLVED" && (
        <>
          {line.allocations.map((a) => (
            <small key={`${a.product_variant_id}:${a.size_id}`}>
              → {visible(a.display_name ?? "товар")}, {sizeText(a.size_code)} ×{" "}
              {a.quantity}
            </small>
          ))}
          {line.quantity_basis && (
            <small>Звідки кількість: {basisLabels[line.quantity_basis]}</small>
          )}
          {line.resolution_note && (
            <small>Примітка: {visible(line.resolution_note)}</small>
          )}
        </>
      )}
      {line.status === "SKIPPED" && line.resolution_note && (
        <small>Не товар: {visible(line.resolution_note)}</small>
      )}
      {answer && (
        <button className="quiet" disabled={blocked} onClick={answer}>
          {line.status === "RESOLVED" || line.status === "SKIPPED"
            ? "Змінити відповідь"
            : "Розібрати рядок"}
        </button>
      )}
    </article>
  );
}

/**
 * No room for another answer: a list takes so many in all (`LIST_FULL`,
 * `allocations`), each size of a line one (review, 2026-10-09).
 */
function noRoomText(limit: unknown): string {
  const most =
    typeof limit === "number"
      ? `${number(limit)} ${plural(limit, "відповідь", "відповіді", "відповідей")}`
      : `${String(limit)} відповідей`;
  return `У списку вже ${most} — більше він не вміщує, тож цю відповідь не збережено. Рядок із кількома розмірами бере відповідь на кожен розмір. Звільнити місце можна, прибравши файл.`;
}

/**
 * Lines answered by size whose record may now be a range of sizes, a size
 * having been created since (`SPLIT_MAY_BE_RANGE` at an approval; owner,
 * 2026-10-09): «Рядки 3, 7 треба розібрати ще раз…».
 */
function rangeAgainText(details: Record<string, unknown>): string {
  const listed = Array.isArray(details.line_nos)
    ? details.line_nos.filter((n): n is number => typeof n === "number")
    : [];
  const count =
    typeof details.count === "number" ? details.count : listed.length;
  const rest = count - listed.length;
  const named = `${listed.map(String).join(", ")}${rest > 0 ? ` і ще ${number(rest)}` : ""}`;
  return count === 1
    ? `Рядок ${named} треба розібрати ще раз: запис у ньому тепер може бути діапазоном розмірів.`
    : `Рядки ${named} треба розібрати ще раз: запис у них тепер може бути діапазоном розмірів.`;
}

/**
 * An answer by size refused: a record of the line may now be a range of
 * sizes, a size having been created since the line was read
 * (`SPLIT_MAY_BE_RANGE`, `records`; review, fourth round, 2026-10-09). The
 * line is read again, and the record is asked about in the editor.
 */
function rangeNowText(details: Record<string, unknown>): string {
  const records = Array.isArray(details.records)
    ? details.records.filter((r): r is string => typeof r === "string")
    : [];
  const named = records.map((record) => `«${visible(record)}»`).join(", ");
  return records.length === 0
    ? "Запис у рядку тепер може означати й діапазон розмірів. Рядок прочитано знову: вкажіть нижче, що він означає, і збережіть відповідь ще раз."
    : records.length === 1
      ? `Запис ${named} тепер може означати й діапазон розмірів. Рядок прочитано знову: вкажіть нижче, що він означає, і збережіть відповідь ще раз.`
      : `Записи ${named} тепер можуть означати й діапазон розмірів. Рядок прочитано знову: вкажіть нижче, що вони означають, і збережіть відповідь ще раз.`;
}

/**
 * A record of a split as the server names it: as the line writes it
 * («42-44»), or its size when the text no longer shows it.
 */
function recordKey(size: ShownSize): string {
  return size.written ?? size.size;
}

/** A record of a split as the line writes it: «42-44». Guarded. */
function recordText(size: ShownSize): string {
  return visible(size.written ?? `${size.size}-${String(size.count)}`);
}

interface Part {
  variant: ReceivableVariant | null;
  /** A size id, "UNKNOWN" for size not known, or "" while not chosen. */
  size: string;
  quantity: string;
  picking: boolean;
}

function LineEditor({
  line,
  list,
  store,
  token,
  scopeKey,
  sizes,
  listParts,
  blocked,
  done,
  cancel,
  reread,
}: {
  line: ListLine;
  list: StockList;
  store: Store;
  token: string;
  scopeKey: string;
  sizes: SizeOption[];
  listParts: StockPart[];
  blocked: boolean;
  done: () => void;
  cancel: () => void;
  /** Read the list's lines again, this one with them: the editor stays open
   * and shows the line as the server reads it now. */
  reread: () => void;
}): JSX.Element {
  const stated =
    line.quantity_state === "KNOWN" && line.quantity_total !== null;
  // The split the line's text shows, each size with its count (ADR-0014
  // §5): offered as it is only when every size is the catalogue's own, and
  // never chosen for the person.
  const split = line.shown_split ?? [];
  // A record that may also be a range of sizes («42-44») is asked about
  // first, and the split is offered as it is only once each such record is
  // read as a size with its count (owner decision, 2026-10-09).
  const [readings, setReadings] = useState<Record<number, SplitReading>>({});
  const ambiguous = split.flatMap((size, index) =>
    size.may_be_range ? [index] : [],
  );
  const readAsSizes = ambiguous.every(
    (index) => readings[index] === "SIZE_WITH_COUNT",
  );
  const readAsRange = ambiguous.some((index) => readings[index] === "RANGE");
  const bySizeOffered =
    split.length > 0 &&
    split.every((size) => size.size_id !== null) &&
    readAsSizes;
  const missing = split.filter((size) => size.size_id === null);
  const allowed: Basis[] = [
    ...(stated ? (["STATED"] as const) : []),
    ...(bySizeOffered ? (["STATED_BY_SIZE"] as const) : []),
    ...(line.may_imply_one ? (["LINE_IMPLIES_ONE"] as const) : []),
    "RECOUNTED",
    "OWNER_KNOWLEDGE",
  ];
  // The parser's one size, if it read exactly one, is where to start.
  const readSize =
    line.candidates.size?.length === 1 ? line.candidates.size[0] : undefined;
  const startSize = sizes.find((s) => s.code === readSize)?.size_id ?? "";
  const [chosen, setBasis] = useState<Basis | "SKIP" | "">(
    stated ? "STATED" : line.may_imply_one ? "LINE_IMPLIES_ONE" : "",
  );
  // A choice the line no longer offers is no choice. The line is read again
  // while the editor is open (the phone comes back to the app, the
  // connection returns, an answer is refused): a record made a possible
  // range since is asked about, and «Як у рядку» waits for its answer
  // (review, fourth round, 2026-10-09).
  const basis =
    chosen === "" || chosen === "SKIP" || allowed.includes(chosen)
      ? chosen
      : "";
  const [parts, setParts] = useState<Part[]>([
    {
      variant: null,
      size: startSize,
      quantity: stated ? String(line.quantity_total) : "1",
      picking: true,
    },
  ]);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A stated count, or one piece, is one allocation of exactly that.
  const fixed =
    basis === "STATED"
      ? line.quantity_total
      : basis === "LINE_IMPLIES_ONE"
        ? 1
        : null;
  const shown = fixed === null ? parts : parts.slice(0, 1);
  const quantities = shown.map((p) =>
    fixed === null ? Number(p.quantity) : fixed,
  );
  const keys = shown.map(
    (p) => `${p.variant?.product_variant_id ?? ""}:${p.size}`,
  );
  const duplicate = new Set(keys).size !== keys.length;
  const needsNote = basis === "RECOUNTED" || basis === "OWNER_KNOWLEDGE";
  // As the line shows it: one model, each size with its own count.
  const bySize = basis === "STATED_BY_SIZE";
  const model = parts[0]?.variant ?? null;
  // The records the person read as a size with its count, by name: what
  // was answered here, never every record the line now flags (review,
  // fourth round, 2026-10-09).
  const readRecords = split.flatMap((size, index) =>
    readings[index] === "SIZE_WITH_COUNT" ? [recordKey(size)] : [],
  );
  const complete =
    basis === "SKIP"
      ? reason.trim() !== ""
      : bySize
        ? model !== null
        : basis !== "" &&
          shown.every((p) => p.variant !== null && p.size !== "") &&
          quantities.every((q) => Number.isInteger(q) && q > 0 && q <= 10000) &&
          !duplicate &&
          (!needsNote || note.trim() !== "");

  function update(index: number, change: Partial<Part>): void {
    setParts(parts.map((p, i) => (i === index ? { ...p, ...change } : p)));
  }

  async function send(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const body =
      basis === "SKIP"
        ? { skip_reason: reason.trim() }
        : bySize
          ? {
              allocations: split.map((size) => ({
                product_variant_id: model?.product_variant_id,
                size_id: size.size_id,
                size_unknown: false,
                quantity: size.count,
              })),
              quantity_basis: basis,
              note: note.trim() || null,
              // What the person said each record that may be a range means,
              // and of which records: those answered here, as the line
              // writes them. A record made a range since is refused by name
              // (review, third and fourth rounds, 2026-10-09).
              ...(readRecords.length > 0
                ? {
                    split_read_as: "SIZE_WITH_COUNT",
                    split_read_records: readRecords,
                  }
                : {}),
            }
          : {
              allocations: shown.map((p, i) => ({
                product_variant_id: p.variant?.product_variant_id,
                size_id: p.size === "UNKNOWN" ? null : p.size,
                size_unknown: p.size === "UNKNOWN",
                quantity: quantities[i],
              })),
              quantity_basis: basis,
              note: note.trim() || null,
            };
    try {
      await api(
        `/snapshots/${list.snapshot_id}/lines/${String(line.line_no)}?store_id=${store.id}`,
        token,
        body,
        undefined,
        "PUT",
      );
      done();
    } catch (error) {
      const reason =
        error instanceof ApiError ? error.details.reason : undefined;
      // A record made a possible range since the line was read: read it
      // again, so the record named is asked about here.
      // So is a list changed in a way it does not name (review,
      // 2026-10-24).
      if (reason === "SPLIT_MAY_BE_RANGE" || listConflict(error)) reread();
      setProblem(
        !(error instanceof ApiError)
          ? "Немає відповіді сервера. Натисніть ще раз — повторна відповідь безпечна."
          : reason === "PART_REMOVED"
            ? "Файл цього рядка прибрали — відповідь не збережено."
            : reason === "SPLIT_MAY_BE_RANGE"
              ? rangeNowText(error.details)
              : reason === "LIST_STORE_NOT_TRADING"
                ? errorText(error)
                : reason === "LIST_STORE_CANNOT_RECEIVE"
                  ? cannotReceiveText(list)
                  : reason === "LIST_FULL" &&
                      error.details.what === "allocations"
                    ? noRoomText(error.details.limit)
                    : error.code === "SNAPSHOT_CONFLICT"
                      ? "Список уже затвердили або відхилили — відповідь не збережено."
                      : error.code === "NOT_FOUND"
                        ? "Товар або розмір більше недоступний. Оберіть інший."
                        : listRefusal(
                            error,
                            "Відповідь не збережено.",
                            "Перевірте її та спробуйте ще раз.",
                          ),
      );
    } finally {
      setBusy(false);
    }
  }

  // Not a <form>: the catalogue picker inside it is one, and a form inside a
  // form would submit the wrong one.
  return (
    <div
      className="line notice"
      role="form"
      aria-label={`Розбір рядка ${String(line.line_no)}`}
    >
      <strong className="catalog-raw">
        {line.line_no}. {line.raw_text === null ? "—" : visible(line.raw_text)}
      </strong>
      <small>{visible(sourceQuantity(line))}</small>
      <FileEvidence line={line} parts={listParts} />
      {ambiguous.map((index) => {
        const size = split[index];
        if (size === undefined) return null;
        const name = `split-${String(line.line_no)}-${String(index)}`;
        const choose = (reading: SplitReading): void => {
          setReadings({ ...readings, [index]: reading });
          // Read as a range, the line is no longer answered as it shows.
          if (reading === "RANGE" && chosen === "STATED_BY_SIZE") setBasis("");
        };
        return (
          <fieldset key={name}>
            <legend>{`Запис «${recordText(size)}» — це:`}</legend>
            <label className="check">
              <input
                type="radio"
                name={name}
                checked={readings[index] === "SIZE_WITH_COUNT"}
                onChange={() => {
                  choose("SIZE_WITH_COUNT");
                }}
              />
              {`Розмір ${visible(size.size)} — ${String(size.count)} шт`}
            </label>
            <label className="check">
              <input
                type="radio"
                name={name}
                checked={readings[index] === "RANGE"}
                onChange={() => {
                  choose("RANGE");
                }}
              />
              {`Діапазон розмірів ${visible(size.size)}–${String(size.count)}`}
            </label>
          </fieldset>
        );
      })}
      {readAsRange && (
        <p className="hint">
          Діапазон не каже, скільки якого розміру: вкажіть розміри й кількість і
          звідки вони відомі.
        </p>
      )}
      <fieldset>
        <legend>Звідки кількість</legend>
        {allowed.map((option) => (
          <label className="check" key={option}>
            <input
              type="radio"
              name={`basis-${String(line.line_no)}`}
              checked={basis === option}
              onChange={() => {
                setBasis(option);
              }}
            />
            {option === "STATED"
              ? `${basisLabels.STATED}: ${String(line.quantity_total)} шт`
              : option === "STATED_BY_SIZE"
                ? `${basisLabels.STATED_BY_SIZE}: ${visible(sizesWithCounts(split))}`
                : basisLabels[option]}
          </label>
        ))}
        <label className="check">
          <input
            type="radio"
            name={`basis-${String(line.line_no)}`}
            checked={basis === "SKIP"}
            onChange={() => {
              setBasis("SKIP");
            }}
          />
          Це не товар
        </label>
      </fieldset>
      {missing.length > 0 && (
        <p className="hint">
          {`Рядок показує кількість по розмірах (${visible(sizesWithCounts(split))}), але ${missing.length === 1 ? "розміру" : "розмірів"} ${missing.map((size) => `«${visible(size.size)}»`).join(", ")} немає в каталозі. Створіть розмір або вкажіть, звідки відома кількість.`}
        </p>
      )}
      {line.quantity_state !== "KNOWN" &&
        !line.may_imply_one &&
        split.length === 0 && (
          <p className="hint">
            Список не каже, скільки тут штук і якого розміру. Вкажіть, хто
            перелічив, або звідки це відомо.
          </p>
        )}
      {basis === "SKIP" ? (
        <label>
          Чому це не товар
          <input
            value={reason}
            maxLength={1000}
            placeholder="Наприклад, підсумок сторінки"
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
      ) : bySize ? (
        <>
          <div className="section-block">
            {(parts[0]?.picking ?? true) || model === null ? (
              <CatalogPicker
                store={store}
                token={token}
                scopeKey={scopeKey}
                variant={model}
                initialSearch={
                  line.reading?.model ?? line.candidates.concept?.[0] ?? ""
                }
                onVariant={(variant) => {
                  update(0, { variant, picking: variant === null });
                }}
              />
            ) : (
              <div className="fields">
                <span>{visible(model.display_name)}</span>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    update(0, { picking: true });
                  }}
                >
                  Інший товар
                </button>
              </div>
            )}
            <ul aria-label="Розміри й кількість, як у рядку">
              {split.map((size) => (
                <li key={size.size}>
                  {visible(size.size)} × {size.count}
                </li>
              ))}
            </ul>
          </div>
          <label>
            Примітка (необов’язково)
            <input
              value={note}
              maxLength={1000}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </label>
        </>
      ) : (
        <>
          {shown.map((part, index) => (
            <div className="section-block" key={index}>
              {part.picking || part.variant === null ? (
                <CatalogPicker
                  store={store}
                  token={token}
                  scopeKey={scopeKey}
                  variant={part.variant}
                  initialSearch={
                    line.reading?.model ?? line.candidates.concept?.[0] ?? ""
                  }
                  onVariant={(variant) => {
                    update(index, { variant, picking: variant === null });
                  }}
                />
              ) : (
                <div className="fields">
                  <span>{visible(part.variant.display_name)}</span>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      update(index, { picking: true });
                    }}
                  >
                    Інший товар
                  </button>
                </div>
              )}
              {/* The size's own room: «Оберіть розмір» whole, even at 375 px. */}
              <div className="fields size-count">
                <label>
                  Розмір
                  <select
                    value={part.size}
                    onChange={(event) => {
                      update(index, { size: event.target.value });
                    }}
                  >
                    <option value="">Оберіть розмір</option>
                    {sizes.map((size) => (
                      <option key={size.size_id} value={size.size_id}>
                        {visible(size.code)}
                      </option>
                    ))}
                    <option value="UNKNOWN">Розмір невідомий</option>
                  </select>
                </label>
                <label>
                  Кількість
                  <input
                    inputMode="numeric"
                    value={fixed === null ? part.quantity : String(fixed)}
                    disabled={fixed !== null}
                    onChange={(event) => {
                      update(index, { quantity: event.target.value });
                    }}
                  />
                </label>
              </div>
              {fixed === null && shown.length > 1 && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setParts(parts.filter((_, i) => i !== index));
                  }}
                >
                  Прибрати
                </button>
              )}
            </div>
          ))}
          {fixed === null && basis !== "" && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                const last = parts[parts.length - 1];
                setParts([
                  ...parts,
                  {
                    variant: last?.variant ?? null,
                    size: "",
                    quantity: "1",
                    picking: last?.variant == null,
                  },
                ]);
              }}
            >
              Ще розмір чи колір
            </button>
          )}
          <label>
            {needsNote
              ? basis === "RECOUNTED"
                ? "Хто й коли перелічив"
                : "Звідки це відомо"
              : "Примітка (необов’язково)"}
            <input
              value={note}
              maxLength={1000}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </label>
          {duplicate && (
            <p role="alert">Той самий товар і розмір двічі: об’єднайте їх.</p>
          )}
        </>
      )}
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button
          type="button"
          disabled={!complete || busy || blocked}
          onClick={() => {
            void send();
          }}
        >
          Зберегти відповідь
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={cancel}
        >
          Скасувати
        </button>
      </div>
    </div>
  );
}

/**
 * The decision on a list: approve it, or reject it. Approval is for whoever
 * may approve, while the store that started the list trades (owner decision,
 * 2026-10-09); rejection is for them and for whoever may add and remove the
 * list's files, so a list whose last file is wrong is rejected where it is
 * looked at (owner, 2026-10-08; review, 2026-10-09).
 */
function Approval({
  list,
  store,
  token,
  warehouse,
  approvable,
  blocked,
  refresh,
}: {
  list: StockList;
  store: Store;
  token: string;
  warehouse: string;
  /** Whether approval is offered at all; rejection always is. */
  approvable: boolean;
  blocked: boolean;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [asking, setAsking] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const waiting = list.summary.pending + list.summary.needs_review;
  const bases = (Object.keys(basisLabels) as Basis[]).filter(
    (basis) => list.summary.lines_by_basis[basis] > 0,
  );

  async function decide(action: "approve" | "reject"): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await api(
        `/snapshots/${list.snapshot_id}/${action}?store_id=${store.id}`,
        token,
        action === "approve"
          ? { expected_review_revision: list.review_revision }
          : { reason: reason.trim() },
        undefined,
        "POST",
        // A large list's approval may take longer than 20 s (ADR-0014 §16).
        { slow: action === "approve" },
      );
    } catch (error) {
      const reasonCode =
        error instanceof ApiError ? error.details.reason : undefined;
      setProblem(
        error instanceof SlowAnswer
          ? errorText(error)
          : !(error instanceof ApiError)
            ? "Немає відповіді сервера. Оновіть список і подивіться, чи рішення збережено."
            : error.code === "OPENING_BALANCE_CONFLICT"
              ? `У складі «${warehouse}» уже був рух товару, тому початковий залишок туди внести не можна. Відхиліть цей список, а відсутній товар прийміть через «Товар» › «Прийшов товар».`
              : reasonCode === "REVISION_CHANGED"
                ? "Поки ви дивились, хтось змінив відповідь у списку. Перегляньте підсумок ще раз."
                : reasonCode === "ROWS_NEED_REVIEW"
                  ? "Ще не всі рядки розібрано."
                  : // Rejected meanwhile for another reason: its
                    // conflict (review, 2026-10-24).
                    reasonCode === "ALREADY_DECIDED" ||
                      error.code === "IDEMPOTENCY_CONFLICT"
                    ? "Цей список уже затвердили або відхилили."
                    : reasonCode === "NOTHING_TO_APPLY"
                      ? "Список не затверджено: у ньому немає жодного рядка товару. Якщо так і є — відхиліть його."
                      : reasonCode === "SPLIT_MAY_BE_RANGE"
                        ? rangeAgainText(error.details)
                        : reasonCode === "LIST_STORE_CANNOT_RECEIVE"
                          ? cannotReceiveText(list)
                          : action === "approve"
                            ? listRefusal(
                                error,
                                "Список не затверджено.",
                                "Спробуйте ще раз.",
                              )
                            : listRefusal(
                                error,
                                "Список не відхилено.",
                                "Перевірте причину та спробуйте ще раз.",
                              ),
      );
    } finally {
      setAsking(null);
      setBusy(false);
      await refresh();
    }
  }

  return (
    <div
      className="notice"
      aria-label={approvable ? "Затвердження списку" : "Рішення щодо списку"}
    >
      <h3>{approvable ? "Затвердження" : "Рішення щодо списку"}</h3>
      {approvable && (
        <p>
          Стане початковим залишком складу «{warehouse}»:{" "}
          <strong>{list.summary.units} од.</strong>
        </p>
      )}
      <p>
        {`Файлів у списку: ${String(list.summary.parts)}${list.summary.parts_removed > 0 ? ` · прибрано: ${String(list.summary.parts_removed)}` : ""}`}
      </p>
      {approvable && bases.length > 0 && (
        <ul>
          {bases.map((basis) => (
            <li key={basis}>
              {basisLabels[basis]}: рядків {list.summary.lines_by_basis[basis]},
              одиниць {list.summary.units_by_basis[basis]}
            </li>
          ))}
        </ul>
      )}
      {approvable && list.summary.lines_differing_from_source > 0 && (
        <p>
          Рядків, де відповідь відрізняється від списку:{" "}
          {list.summary.lines_differing_from_source}
        </p>
      )}
      {approvable && waiting > 0 && (
        <p className="hint">
          Затвердити можна, коли кожен рядок розібрано або позначено «не товар».
          Ще чекають: {waiting}.
        </p>
      )}
      {problem && <p role="alert">{problem}</p>}
      {asking === "approve" ? (
        <div className="actions">
          <p>
            {list.summary.units} од. стануть початковим залишком складу «
            {warehouse}». Скасувати це потім не можна.
          </p>
          <button
            disabled={busy || blocked}
            onClick={() => {
              void decide("approve");
            }}
          >
            Так, затвердити
          </button>
          <button
            className="quiet"
            onClick={() => {
              setAsking(null);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : asking === "reject" ? (
        <div className="actions">
          <label>
            Чому відхиляємо
            <input
              value={reason}
              maxLength={1000}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
          <button
            disabled={busy || blocked || reason.trim() === ""}
            onClick={() => {
              void decide("reject");
            }}
          >
            Так, відхилити
          </button>
          <button
            className="quiet"
            onClick={() => {
              setAsking(null);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : (
        <div className="actions">
          {approvable && (
            <button
              disabled={!list.ready_to_approve || busy || blocked}
              onClick={() => {
                setAsking("approve");
              }}
            >
              Затвердити список
            </button>
          )}
          <button
            className="quiet"
            disabled={busy || blocked}
            onClick={() => {
              setAsking("reject");
            }}
          >
            Відхилити список
          </button>
        </div>
      )}
    </div>
  );
}
