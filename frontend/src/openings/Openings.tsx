import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  ApiError,
  SlowAnswer,
  api,
  errorText,
  unreachable,
} from "@/shared/api";
import { Unread } from "@/shared/Unread";
import type { Location, Store } from "@/orders/types";
import type { SizeOption } from "@/inventory/receiptTypes";
import { visible } from "@/shared/visible";
import { FileChooser } from "./FileChooser";
import { fileProblemTexts } from "./fileErrors";
import { LineEvidence, LineTask, sizeText } from "./Line";
import { AddFile, AddLines, PartsSection, partName } from "./Parts";
import { MAX_BODY_BYTES, TOO_LARGE, bodyBytes } from "./stockFile";
import type { StockFileRead } from "./stockFile";
import {
  basisLabels,
  cannotReceiveText,
  lineStatusLabels,
  listConflict,
  listRefusal,
  listStatusLabels,
  number,
  sourceQuantity,
  typedTooMuch,
} from "./types";
import type {
  Basis,
  LineStatus,
  ListLine,
  StockList,
  StockPart,
} from "./types";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Back } from "@/shared/Back";
import { BlankTag } from "@/shared/BlankTag";
import { Eyelet } from "@/shared/Eyelet";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { buzz, useMainButton } from "@/shared/telegram";

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
 *
 * In the tag's system (stage 2, goods task list, P0-5, P0-6): the lists as
 * row tags under the screen's title, «Новий список» Telegram's MainButton
 * and its form a screen of its own; a list's big tag with its progress, its
 * lines on a switch of three, each line answered on a task's screen of its
 * own and the next opened by itself; the approval Telegram's MainButton,
 * confirmed in a sheet with its number large.
 */
export function Openings({
  store,
  token,
  scopeKey,
  blocked,
  back,
  task,
  opened = null,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
  /** The menu steps aside while a line is answered (P0-5). */
  task?: ((shown: boolean) => void) | undefined;
  /** The list «Сьогодні»'s tag opens itself, the one waiting there (P0-6). */
  opened?: string | null;
}): JSX.Element {
  const canImport = store.permissions.includes("snapshot:import");
  const [openId, setOpenId] = useState<string | null>(opened);
  const [creating, setCreating] = useState(false);
  // Back from a new list: the lists' heading, at the top (review,
  // 2026-11-08).
  const heading = useRef<HTMLHeadingElement>(null);
  const fromNew = useRef(false);
  useEffect(() => {
    if (creating || !fromNew.current) return;
    fromNew.current = false;
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, [creating]);
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
  // The list a draft's command made, its answer lost, opened — from its
  // tag here or «Сьогодні»'s: made, so nothing of the draft is sent again
  // (review, fourth round, 2026-10-09; 2026-11-08).
  useEffect(() => {
    if (open) forgetDraftOf(store, open);
  }, [open, store]);
  const cache = useQueryClient();
  // A list saved or found is opened once the lists are read again. A read
  // still on its way — the screen's first, slow while «Сьогодні» reads at
  // entry — knows nothing of it, and a refetch would only wait for that
  // one: it is let go first (CI, 2026-10-31).
  const openOnceRead = (id: string): void => {
    setCreating(false);
    void cache
      .cancelQueries({ queryKey: ["stock-lists", scopeKey, store.id] })
      .then(() => lists.refetch())
      .then(() => {
        setOpenId(id);
      });
    // «Сьогодні»'s too: its warehouse waiting for stock gives way to the
    // list begun at once (stage 2, admin task list, P0-2).
    void cache.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "stock-lists" && query.queryKey[1] !== scopeKey,
    });
  };
  // «Сьогодні»'s list, its read still on its way: the list, not the lists,
  // is what opens.
  const awaited = openId !== null && lists.isPending;
  // The lists' one action, Telegram's: «Новий список» (P0-6); not while
  // «Сьогодні»'s list is on its way.
  const here = open === undefined && !creating && !awaited;
  const begin = (): void => {
    if (!blocked) setCreating(true);
  };
  const main = useMainButton("Новий список", begin, {
    shown: canImport && here,
    active: !blocked,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, canImport && here && !main);

  if (open)
    return (
      <ListView
        list={open}
        store={store}
        token={token}
        scopeKey={scopeKey}
        warehouse={warehouse(open.location_id)}
        blocked={blocked}
        task={task}
        close={() => {
          setOpenId(null);
        }}
      />
    );
  if (creating && canImport)
    return (
      <NewList
        store={store}
        token={token}
        scopeKey={scopeKey}
        locations={(locations.data ?? []).filter(
          (l) => l.is_active && l.can_receive && !l.damaged_returns,
        )}
        blocked={blocked}
        done={(list) => {
          openOnceRead(list.snapshot_id);
        }}
        openList={openOnceRead}
        cancel={() => {
          fromNew.current = true;
          setCreating(false);
        }}
      />
    );
  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title="Початкові залишки"
        back={back && <BackToMore back={back} />}
        aside={
          <button
            className="quiet"
            disabled={lists.isFetching}
            onClick={() => {
              void lists.refetch();
            }}
          >
            Оновити
          </button>
        }
      />
      <section className="openings">
        {lists.isPending ? (
          <p role="status">
            {awaited ? "Завантажуємо список…" : "Завантажуємо списки…"}
          </p>
        ) : lists.error ? (
          <Unread
            error={lists.error}
            retry={() => {
              void lists.refetch();
            }}
          />
        ) : lists.data.items.length === 0 ? (
          // The five lines of what a list is: one, on a blank tag (P0-6).
          <BlankTag>
            <p className="t-row opening-empty">
              Списки із зошита — рядок за рядком. Поки список чекає, склад не
              рухається.
            </p>
          </BlankTag>
        ) : (
          <div className="tags opening-lists">
            {lists.data.items.map((list) => (
              <ListTag
                key={list.snapshot_id}
                list={list}
                store={store}
                warehouse={warehouse(list.location_id)}
                open={() => {
                  setOpenId(list.snapshot_id);
                }}
              />
            ))}
          </div>
        )}
        {canImport && !main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <button
              type="button"
              className="main-mimic"
              disabled={blocked}
              onClick={begin}
            >
              Новий список
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/** «Розібрано 120 з 412 · не товар 6»: how far a list is answered. */
function answeredText(list: StockList): string {
  const { lines, resolved, skipped } = list.summary;
  return `Розібрано ${number(resolved)} з ${number(lines)}${
    skipped > 0 ? ` · не товар ${number(skipped)}` : ""
  }`;
}

const listTones: Record<StockList["status"], string> = {
  IN_REVIEW: "tone-ink",
  APPLIED: "tone-live",
  REJECTED: "tone-offline",
};

/** A list on the lists' screen (P0-6): a row tag — «Зошит 1 · склад
 * «Основний»», how far it is answered, its state's sticker, «Відкрити». */
function ListTag({
  list,
  store,
  warehouse,
  open,
}: {
  list: StockList;
  store: Store;
  warehouse: string;
  open: () => void;
}): JSX.Element {
  return (
    <article
      className={`today-tag tag-row tag-outline opening-tag ${listTones[list.status]}`}
      aria-label={`Список ${visible(list.source_document_ref ?? "")}`.trim()}
    >
      <div className="today-tag-body">
        <span className="today-tag-eyelet" aria-hidden="true" />
        <h3 className="t-row today-tag-title">
          <span>
            {listName(list)} · склад «{warehouse}»
          </span>
        </h3>
        <p className="t-meta today-tag-meta">{answeredText(list)}</p>
        {list.store_id !== store.id && (
          <p className="t-meta today-tag-meta">
            Веде магазин «{visible(list.store_name ?? "—")}»
          </p>
        )}
        <div className="opening-tag-foot">
          <span className="badge">{listStatusLabels[list.status]}</span>
          <button
            type="button"
            className="tag-verb"
            onClick={() => {
              // A tag's verb, felt (spec §6.9).
              buzz("light");
              open();
            }}
          >
            Відкрити
          </button>
        </div>
      </div>
    </article>
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
  // A draft's warehouse no longer offered — closed, or no longer taking
  // goods — is no choice: another is chosen, or the only one taken (review,
  // 2026-11-08).
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
  const ready = chosen !== undefined && checked && content && !busy;

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

  // The only warehouse a list may be started at is said and taken: the
  // phone choosing among one is not choosing, as at a delivery and a
  // stocktake (owner decisions, 2026-10-10; stage 2, goods task list, P0-6).
  const only = locations.length === 1 ? locations[0] : undefined;
  // Never under a send whose answer is not known: its list is found by the
  // warehouse it was sent for.
  const taken = chosen !== undefined || draft.unsettled;
  useEffect(() => {
    if (!taken && only) setDraft({ location_id: only.id });
    // `setDraft` merges into the draft as it is: only the one warehouse.
  }, [taken, only]);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    title.current?.focus();
  }, []);
  const saving = !other && !mine;
  const press = (): void => {
    if (ready && !blocked) void send();
  };
  // The screen's one action, Telegram's (spec §6.4).
  const main = useMainButton("Зберегти список", press, {
    shown: saving,
    progress: busy,
    active: ready && !blocked,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, saving && !main);

  return (
    <>
      <ScreenHeader
        ref={title}
        focusable
        title="Новий список"
        back={
          <Back go={cancel} held={busy} label="Назад до «Початкові залишки»">
            <span aria-hidden="true">← </span>
            Початкові залишки
          </Back>
        }
      />
      <form
        className="openings opening-new"
        aria-label="Новий список"
        onSubmit={(event) => {
          event.preventDefault();
          press();
        }}
      >
        {only ? (
          <p className="t-row opening-place">Склад «{visible(only.name)}»</p>
        ) : (
          <div className="chips opening-places" role="group" aria-label="Склад">
            {locations.map((location) => (
              <button
                type="button"
                className="chip"
                key={location.id}
                aria-pressed={draft.location_id === location.id}
                onClick={() => {
                  // A choice, felt (spec §4.4).
                  buzz("selection");
                  setDraft({ location_id: location.id });
                }}
              >
                {visible(location.name)}
              </button>
            ))}
          </div>
        )}
        {draft.location_id !== "" &&
          (waiting.isPending ? (
            <p role="status">Перевіряємо, чи на складі не чекає список…</p>
          ) : waiting.error ? (
            // The warning's plate, «Спробувати ще раз» (stage 2's audit,
            // goods P1-1).
            <Unread
              error={waiting.error}
              retry={() => {
                void waiting.refetch();
              }}
            />
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
        {/* Only after an answer: while the last send is unsettled, the list
            it may have made is found by its command, and a new command
            would start a second list beside it (review, 2026-10-09). */}
        {problems.length > 0 && !draft.unsettled && (
          <div className="actions">
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
          </div>
        )}
        {saving && !main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <button
              type="submit"
              className="main-mimic"
              disabled={!ready || blocked}
            >
              {busy ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">Зберегти список</span>
                </>
              ) : (
                "Зберегти список"
              )}
            </button>
          </div>
        )}
      </form>
    </>
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
  // Nothing said of who may approve (stage 2, goods task list, P1-5).
  return canApprove
    ? " Затвердіть або відхиліть його."
    : " Відхилити його можете й ви.";
}

/** The switch's three (P0-6): what waits on a person, what waits, what is
 * answered — the rest in ⋯. */
type LineMode = "NEEDS_REVIEW" | "PENDING" | "RESOLVED" | "OTHER";

/** In ⋯'s sheet: «Не товар», «Усі», and «Прибрані» once a file was. */
const otherFilters: { status: LineStatus | null; label: string }[] = [
  { status: "SKIPPED", label: "Не товар" },
  { status: null, label: "Усі" },
];
const linesPerPage = 50;

interface LinePage {
  items: ListLine[];
  has_more: boolean;
}

/** «Не товар 6 · чекають 280 · 412 шт.»: the rest of the list's tag. */
function restText(list: StockList): string {
  const waiting = list.summary.pending + list.summary.needs_review;
  const parts = [
    ...(list.summary.skipped > 0
      ? [`не товар ${number(list.summary.skipped)}`]
      : []),
    ...(waiting > 0 ? [`чекають ${number(waiting)}`] : []),
    `${number(list.summary.units)} шт.`,
  ].join(" · ");
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

/** «Розібрано 120 з 412» over a bar of 6 (spec §6.24): what is decided,
 * answered or not stock, of the lines that count. */
function Progress({ list }: { list: StockList }): JSX.Element {
  const { lines, resolved, skipped } = list.summary;
  const decided = resolved + skipped;
  const share = lines === 0 ? 0 : Math.min(1, decided / lines);
  return (
    <div className="opening-progress">
      <p className="t-meta">
        Розібрано {number(resolved)} з {number(lines)}
      </p>
      <div
        className="progress"
        role="progressbar"
        aria-label="Розібрано рядків"
        aria-valuemin={0}
        aria-valuemax={lines}
        aria-valuenow={decided}
        aria-valuetext={`Розібрано ${number(resolved)} з ${number(lines)}${
          skipped > 0 ? `, не товар ${number(skipped)}` : ""
        }`}
      >
        <span style={{ width: `${String(share * 100)}%` }} />
      </div>
      <p className="t-meta opening-rest">{restText(list)}</p>
    </div>
  );
}

function ListView({
  list,
  store,
  token,
  scopeKey,
  warehouse,
  blocked,
  close,
  task,
}: {
  list: StockList;
  store: Store;
  token: string;
  scopeKey: string;
  warehouse: string;
  blocked: boolean;
  close: () => void;
  task?: ((shown: boolean) => void) | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const canImport = store.permissions.includes("snapshot:import");
  const canApprove = store.permissions.includes("snapshot:approve");
  const canPick = store.permissions.includes("inventory:receive");
  // Where something waits; nothing waits — a list to approve, opened from
  // «Сьогодні» — the lines answered (review, 2026-11-08).
  const [filter, setFilter] = useState<LineStatus | null>(
    list.summary.needs_review > 0
      ? "NEEDS_REVIEW"
      : list.summary.pending > 0 || list.summary.resolved === 0
        ? "PENDING"
        : "RESOLVED",
  );
  // One file's lines only, or every file's.
  const [partFilter, setPartFilter] = useState<string | null>(null);
  // The line answered on its own screen, as it was read when it opened.
  const [editing, setEditing] = useState<ListLine | null>(null);
  const [adding, setAdding] = useState<"file" | "lines" | null>(null);
  // ⋯'s sheet of the other lines.
  const [others, setOthers] = useState(false);
  const linesKey = [
    "stock-list-lines",
    scopeKey,
    list.snapshot_id,
    filter,
    partFilter,
  ] as const;
  const lines = useInfiniteQuery({
    queryKey: linesKey,
    queryFn: ({ pageParam }) =>
      api<LinePage>(
        `/snapshots/${list.snapshot_id}/lines?store_id=${store.id}&limit=${String(linesPerPage)}&offset=${String(pageParam)}${filter ? `&status=${filter}` : ""}${partFilter ? `&part_id=${partFilter}` : ""}`,
        token,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, _all, lastParam) =>
      last.has_more ? lastParam + last.items.length : undefined,
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
  const sheetFilters: { status: LineStatus | null; label: string }[] =
    list.summary.parts_removed > 0
      ? [...otherFilters, { status: "REMOVED", label: "Прибрані" }]
      : otherFilters;
  const mode: LineMode =
    filter === "NEEDS_REVIEW" || filter === "PENDING" || filter === "RESOLVED"
      ? filter
      : "OTHER";
  const otherLabel = sheetFilters.find((f) => f.status === filter)?.label;
  const items = lines.data?.pages.flatMap((page) => page.items) ?? [];

  // Back from a line: to the row it was on, or — the lines done — to the
  // list's tag, at the top (P0-5) — before it is painted, after the
  // header's reset (audit after stage 2, frame P1-3; review).
  const tag = useRef<HTMLDivElement>(null);
  const returned = useRef<number | "tag" | null>(null);
  useLayoutEffect(() => {
    if (editing !== null || returned.current === null) return;
    const to = returned.current;
    returned.current = null;
    const row =
      to === "tag"
        ? null
        : document.querySelector<HTMLElement>(`[data-line="${String(to)}"]`);
    if (row) {
      row.scrollIntoView({ block: "center" });
      (row.querySelector<HTMLElement>(".tag-verb") ?? row).focus();
      return;
    }
    window.scrollTo(0, 0);
    tag.current?.focus();
  }, [editing]);
  // Decided here — approved or rejected — the list's tag says so first.
  const status = useRef(list.status);
  useEffect(() => {
    if (status.current === list.status) return;
    status.current = list.status;
    window.scrollTo(0, 0);
    tag.current?.focus();
  }, [list.status]);

  async function refresh(): Promise<void> {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["stock-lists"] }),
      cache.invalidateQueries({ queryKey: ["stock-list-lines"] }),
      cache.invalidateQueries({ queryKey: ["stock-list-parts"] }),
      cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
      // Approved, its warehouse no longer waits for stock: «Сьогодні» says
      // so at once (stage 2, admin task list, P0-2).
      cache.invalidateQueries({ queryKey: ["inventory-locations"] }),
    ]);
  }

  /**
   * The line after `from` of the same lines (P0-5). One already read opens
   * at once, the lines read again behind it (review, 2026-11-08). Past
   * them, answered, the lines are read again first — an answered line
   * leaves «Чекають», and the next page's place with it — and the next
   * page read. None left: the list's tag.
   */
  async function advance(from: number, answered: boolean): Promise<void> {
    const after = (pages: LinePage[]): ListLine | undefined =>
      pages
        .flatMap((page) => page.items)
        .find((line) => line.line_no > from && line.status !== "REMOVED");
    const cached = (): LinePage[] =>
      cache.getQueryData<InfiniteData<LinePage>>(linesKey)?.pages ?? [];
    const near = after(cached());
    if (near) {
      setEditing(near);
      if (answered) void refresh();
      return;
    }
    if (answered) await refresh();
    let pages = cached();
    for (;;) {
      const found = after(pages);
      if (found) {
        setEditing(found);
        return;
      }
      if (!(pages[pages.length - 1]?.has_more ?? false)) break;
      const read = await lines.fetchNextPage();
      if (read.isError) break;
      pages = read.data?.pages ?? [];
    }
    returned.current = "tag";
    setEditing(null);
  }

  function showPart(id: string | null): void {
    setPartFilter(id);
    // A file's lines, all of them: a removed file's are only «Прибрано».
    if (id !== null) setFilter(null);
    setEditing(null);
  }

  function show(status: LineStatus | null): void {
    setFilter(status);
    setEditing(null);
  }

  const shown =
    editing && (items.find((l) => l.line_no === editing.line_no) ?? editing);
  if (shown)
    return (
      <LineTask
        key={shown.line_no}
        line={shown}
        list={list}
        title={listName(list)}
        store={store}
        token={token}
        scopeKey={scopeKey}
        sizes={sizes}
        listParts={allParts}
        warehouse={warehouse}
        blocked={blocked}
        more={
          items.some(
            (l) => l.line_no > shown.line_no && l.status !== "REMOVED",
          ) || lines.hasNextPage
        }
        next={(answered) => advance(shown.line_no, answered)}
        leave={() => {
          returned.current = shown.line_no;
          setEditing(null);
        }}
        reread={() => {
          void cache.invalidateQueries({ queryKey: ["stock-list-lines"] });
        }}
        task={task}
      />
    );

  return (
    <>
      <ScreenHeader
        pushed
        title={listName(list)}
        aside={
          <Back go={close} className="quiet">
            До списків
          </Back>
        }
      />
      <section className="openings">
        {/* The list's big tag (spec §5 «Большая бирка»; P0-6): its
            warehouse, its state, how far it is answered — or, decided, what
            became of it. */}
        <div className="tag-hero tag-outline opening-hero">
          <div className="opening-hero-in" ref={tag} tabIndex={-1}>
            <p className="opening-hero-place">Склад «{warehouse}»</p>
            <p className="badge opening-state">
              {listStatusLabels[list.status]}
            </p>
            {(list.captured_at || list.store_id !== store.id) && (
              <p className="t-meta">
                {[
                  ...(list.captured_at
                    ? [`перелічено ${visible(list.captured_at)}`]
                    : []),
                  ...(list.store_id !== store.id
                    ? [`Веде магазин «${visible(list.store_name ?? "—")}»`]
                    : []),
                ].join(" · ")}
              </p>
            )}
            {list.status === "IN_REVIEW" && <Progress list={list} />}
            {list.status === "APPLIED" && (
              <Stub state="settled">
                <p className="stub-line" role="status">
                  Затверджено: {list.application?.units ?? list.summary.units}{" "}
                  шт. стали початковим залишком складу «{warehouse}».
                </p>
              </Stub>
            )}
            {list.status === "REJECTED" && (
              <p role="status">
                Відхилено
                {list.rejection_reason
                  ? `: ${visible(list.rejection_reason)}`
                  : ""}
                . Залишків цей список не змінив.
              </p>
            )}
          </div>
        </div>
        {list.status === "IN_REVIEW" && !trading && (
          <p className="notice" role="status">
            {`Магазин «${visible(list.store_name ?? "—")}», що почав цей список, не працює: список можна лише відхилити, а файли додати до нового списку.`}
          </p>
        )}
        {list.status === "IN_REVIEW" && (
          <p className="hint">
            {`Місце у списку: рядків ${number(list.summary.lines)} з ${number(list.summary.limits.lines)} · відповідей ${number(list.summary.allocations)} з ${number(list.summary.limits.allocations)}`}
          </p>
        )}
        {list.status === "IN_REVIEW" && (
          <p className="notice">
            Поки список чекає рішення, на складі «{warehouse}», де ще не було
            руху товару, нічого не приймають, не продають і не виправляють.
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
            quiet={others || adding !== null}
            fallback={tag}
            refresh={refresh}
          />
        )}
        {/* Whoever may not take the stock in reads the lines without
            «Розібрати», and nothing is said of the rule (stage 2, goods
            task list, P1-5). */}
        {parts.error ? (
          <Unread
            error={parts.error}
            retry={() => {
              void parts.refetch();
            }}
          />
        ) : (
          // A list typed in one go is one part: nothing to tell apart.
          (allParts.length > 1 || allParts[0]?.kind === "FILE") && (
            <PartsSection
              list={list}
              store={store}
              token={token}
              parts={allParts}
              editable={editable}
              blocked={blocked}
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
        <nav className="opening-modes" aria-label="Рядки списку">
          <ModeSwitch<LineMode>
            label="Які рядки"
            filters
            modes={[
              {
                mode: "NEEDS_REVIEW",
                label: `Потребують уваги ${number(list.summary.needs_review)}`,
              },
              {
                mode: "PENDING",
                label: `Чекають ${number(list.summary.pending)}`,
              },
              {
                mode: "RESOLVED",
                label: `Розібрані ${number(list.summary.resolved)}`,
              },
            ]}
            current={mode}
            choose={(chosen) => {
              if (chosen !== "OTHER") show(chosen);
            }}
            disabled={false}
          />
          <button
            type="button"
            className="quiet opening-others"
            aria-haspopup="dialog"
            aria-pressed={mode === "OTHER"}
            aria-label={
              otherLabel === undefined
                ? "Інші рядки"
                : `Інші рядки: ${otherLabel}`
            }
            onClick={() => {
              setOthers(true);
            }}
          >
            {otherLabel === undefined ? (
              "⋯"
            ) : (
              <>
                {otherLabel}
                <span aria-hidden="true"> ⋯</span>
              </>
            )}
          </button>
        </nav>
        {others && (
          <Sheet
            title="Інші рядки"
            close={() => {
              setOthers(false);
            }}
          >
            <div className="debt-more-ways">
              {sheetFilters.map(({ status, label }) => (
                <button
                  type="button"
                  key={label}
                  className="sheet-way"
                  aria-pressed={filter === status}
                  onClick={() => {
                    buzz("selection");
                    setOthers(false);
                    show(status);
                  }}
                >
                  {label}
                  {status === "SKIPPED"
                    ? ` · ${number(list.summary.skipped)}`
                    : status === null
                      ? ` · ${number(list.summary.lines)}`
                      : ""}
                </button>
              ))}
            </div>
          </Sheet>
        )}
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
        {/* A read that failed is said over the lines read before, as the
            next page's failing is (review, 2026-11-08). */}
        {!lines.isPending && lines.error && (
          <Unread
            error={lines.error}
            retry={() => {
              void lines.refetch();
            }}
          />
        )}
        {lines.isPending ? (
          <p role="status">Завантажуємо рядки…</p>
        ) : lines.error && items.length === 0 ? null : items.length === 0 ? (
          <p>Тут рядків немає.</p>
        ) : (
          <>
            <div className="tags opening-lines">
              {items.map((line) => (
                <LineRow
                  key={line.line_no}
                  line={line}
                  parts={allParts}
                  answer={
                    editable && canPick && line.status !== "REMOVED"
                      ? () => {
                          setEditing(line);
                        }
                      : null
                  }
                  blocked={blocked}
                />
              ))}
            </div>
            {lines.hasNextPage && (
              <button
                type="button"
                className="quiet today-more"
                disabled={lines.isFetching}
                onClick={() => {
                  void lines.fetchNextPage();
                }}
              >
                Показати ще
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}

const lineTones: Record<LineStatus, string> = {
  NEEDS_REVIEW: "tone-warning",
  PENDING: "tone-ink",
  RESOLVED: "tone-live",
  SKIPPED: "tone-offline",
  REMOVED: "tone-offline ring",
};

/** A line on the list (P0-6): a row tag — the line as written, its state,
 * what the list says of its count, its answer once it has one, and one
 * verb: «Розібрати», or «Змінити відповідь». */
function LineRow({
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
      className={`today-tag tag-row tag-outline opening-line ${lineTones[line.status]}`}
      aria-label={`Рядок ${String(line.line_no)}`}
      data-line={line.line_no}
      tabIndex={-1}
    >
      <div className="today-tag-body">
        <span className="today-tag-eyelet" aria-hidden="true" />
        <p className="t-row catalog-raw">
          {line.line_no}.{" "}
          {line.raw_text === null ? "—" : visible(line.raw_text)}
        </p>
        <p className="t-meta today-tag-meta">
          {lineStatusLabels[line.status]} · {visible(sourceQuantity(line))}
        </p>
        {/* The line's screen does not open here: what was read of it,
            and the reasons to reject, on its row (review, 2026-11-08). */}
        {answer === null && <LineEvidence line={line} parts={parts} row />}
        {line.status === "RESOLVED" && (
          <>
            {line.allocations.map((a) => (
              <p
                className="t-meta"
                key={`${a.product_variant_id}:${a.size_id}`}
              >
                → {visible(a.display_name ?? "товар")}, {sizeText(a.size_code)}{" "}
                × {a.quantity}
              </p>
            ))}
            {line.quantity_basis && (
              <p className="t-meta">
                Звідки кількість: {basisLabels[line.quantity_basis]}
              </p>
            )}
            {line.resolution_note && (
              <p className="t-meta">
                Примітка: {visible(line.resolution_note)}
              </p>
            )}
          </>
        )}
        {line.status === "SKIPPED" && line.resolution_note && (
          <p className="t-meta">Не товар: {visible(line.resolution_note)}</p>
        )}
        {answer && (
          <button
            type="button"
            className="tag-verb"
            disabled={blocked}
            onClick={() => {
              buzz("light");
              answer();
            }}
          >
            {line.status === "RESOLVED" || line.status === "SKIPPED"
              ? "Змінити відповідь"
              : "Розібрати"}
          </button>
        )}
      </div>
    </article>
  );
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
 * The decision on a list: approve it, or reject it. Approval is for whoever
 * may approve, while the store that started the list trades (owner decision,
 * 2026-10-09); rejection is for them and for whoever may add and remove the
 * list's files, so a list whose last file is wrong is rejected where it is
 * looked at (owner, 2026-10-08; review, 2026-10-09).
 *
 * Approval is Telegram's MainButton, «Затвердити · 412 шт.», once nothing
 * waits — before, none, and the tag says what waits — and it is confirmed in
 * a sheet, the number large (spec §6.6; stage 2, goods task list, P0-6).
 * Rejection stays as it was.
 */
function Approval({
  list,
  store,
  token,
  warehouse,
  approvable,
  blocked,
  quiet,
  fallback,
  refresh,
}: {
  list: StockList;
  store: Store;
  token: string;
  warehouse: string;
  /** Whether approval is offered at all; rejection always is. */
  approvable: boolean;
  blocked: boolean;
  /** Another sheet over the list: its MainButton is not this one. */
  quiet: boolean;
  /** Where the cursor goes as the sheet closes, its button gone. */
  fallback: RefObject<HTMLElement>;
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
  const units = list.summary.units;
  const ready = approvable && list.ready_to_approve;
  const ask = (): void => {
    if (blocked || busy) return;
    setProblem(null);
    setAsking("approve");
  };
  const words = `Затвердити · ${number(units)} шт.`;
  const main = useMainButton(words, ask, {
    shown: ready && asking === null && !quiet,
    active: !blocked && !busy,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, ready && asking === null && !main);

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
      buzz("success");
    } catch (error) {
      buzz("error");
      const reasonCode =
        error instanceof ApiError ? error.details.reason : undefined;
      setProblem(
        error instanceof SlowAnswer
          ? errorText(error)
          : !(error instanceof ApiError)
            ? "Немає відповіді сервера. Оновіть список і подивіться, чи рішення збережено."
            : error.code === "OPENING_BALANCE_CONFLICT"
              ? `У складі «${warehouse}» уже був рух товару, тому початковий залишок туди внести не можна. Відхиліть цей список, а відсутній товар прийміть через «Ще» › «Прийшов товар».`
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
      className="notice opening-decision"
      aria-label={approvable ? "Затвердження списку" : "Рішення щодо списку"}
    >
      <h3>{approvable ? "Затвердження" : "Рішення щодо списку"}</h3>
      {approvable && (
        <p>
          Стане початковим залишком складу «{warehouse}»:{" "}
          <strong>{units} шт.</strong>
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
      {asking === "reject" ? (
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
          <button
            className="quiet"
            disabled={busy || blocked}
            onClick={() => {
              setProblem(null);
              setAsking("reject");
            }}
          >
            Відхилити список
          </button>
        </div>
      )}
      {ready && asking === null && !main && (
        // Outside Telegram, its MainButton as the dock's one button.
        <div className="pay-panel order-dock" ref={dock}>
          <button
            type="button"
            className="main-mimic"
            aria-haspopup="dialog"
            disabled={blocked || busy}
            onClick={ask}
          >
            {words}
          </button>
        </div>
      )}
      {asking === "approve" && (
        <ApproveSheet
          list={list}
          warehouse={warehouse}
          busy={busy}
          held={blocked}
          fallback={fallback}
          approve={() => {
            void decide("approve");
          }}
          close={() => {
            if (!busy) setAsking(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * «Затвердити «Зошит 1»?» (spec §6.6; P0-6): the number large, what it
 * becomes, that it cannot be undone, and Telegram's MainButton «Так,
 * затвердити» — outside Telegram, the sheet's own. A press sooner than
 * `CARRIED_TAP` after it opened was meant for «Затвердити · … шт.», which
 * stood where «Так, затвердити» stands: let go.
 */
function ApproveSheet({
  list,
  warehouse,
  busy,
  held,
  fallback,
  approve,
  close,
}: {
  list: StockList;
  warehouse: string;
  busy: boolean;
  held: boolean;
  fallback: RefObject<HTMLElement>;
  approve: () => void;
  close: () => void;
}): JSX.Element {
  const [openedAt] = useState(() => performance.now());
  const press = (): void => {
    if (held || busy || performance.now() - openedAt < CARRIED_TAP) return;
    approve();
  };
  const main = useMainButton("Так, затвердити", press, {
    progress: busy,
    active: !held,
  });
  return (
    <Sheet
      title={`Затвердити «${listName(list)}»?`}
      close={close}
      fallback={fallback}
      held={busy}
      foot={
        <div className="count-foot">
          {!main && (
            <button
              type="button"
              className="sheet-done main-mimic"
              disabled={held}
              aria-disabled={busy || undefined}
              onClick={press}
            >
              {busy ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">Так, затвердити</span>
                </>
              ) : (
                "Так, затвердити"
              )}
            </button>
          )}
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={close}
          >
            Скасувати
          </button>
        </div>
      }
    >
      <p className="t-money-l opening-units">
        {number(list.summary.units)} шт.
      </p>
      <p>
        стануть початковим залишком складу «{warehouse}». Скасувати це потім не
        можна.
      </p>
    </Sheet>
  );
}
