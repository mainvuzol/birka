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
import { AddFile, AddLines, PartsScreen } from "./Parts";
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
  plural,
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
import { Empty } from "@/shared/Empty";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { buzz, useMainButton } from "@/shared/telegram";
import { Sticker } from "@/shared/Sticker";

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
          // The lists' tags in grey, where they come (goods task list after
          // stage 2, P2-2); «Сьогодні»'s list awaited, its big tag over its
          // lines (review).
          awaited ? (
            <OpeningPlaceholder said="Завантажуємо список…" shape="list" />
          ) : (
            <OpeningPlaceholder said="Завантажуємо списки…" shape="lists" />
          )
        ) : lists.error ? (
          <Unread
            error={lists.error}
            retry={() => {
              void lists.refetch();
            }}
          />
        ) : lists.data.items.length === 0 ? (
          // What a list is, on the blank tag of every empty place (P0-6;
          // goods task list after stage 2, P2-2): its line, its meta.
          <Empty
            title="Списки із зошита — рядок за рядком."
            meta="Поки список чекає, склад не рухається."
          />
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
          <Sticker>{listStatusLabels[list.status]}</Sticker>
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

/**
 * «Початкові залишки» being read (goods task list after stage 2, P2-2;
 * review): three tags in grey, each the shape of the one to come — a
 * list's eyelet, its name and meta, its sticker and «Відкрити»; a line's
 * eyelet, its words, its meta and its verb — in the lists' or the lines'
 * own place. A list awaited from «Сьогодні»: its big tag over its lines.
 * The words to a screen reader alone.
 */
function OpeningPlaceholder({
  said,
  shape,
}: {
  said: string;
  shape: "lists" | "list" | "lines";
}): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        {said}
      </p>
      <div className="placeholder" aria-hidden="true">
        {shape === "list" && (
          <div className="tag-hero tag-outline opening-hero">
            <div className="opening-hero-in">
              <span className="skeleton-line opening-hero-place">
                <span>Склад</span>
              </span>
              <span className="skeleton skeleton-pill opening-state" />
              <span className="skeleton-line t-meta">
                <span>перелічено</span>
              </span>
            </div>
          </div>
        )}
        <div
          className={`tags ${shape === "lists" ? "opening-lists" : "opening-lines"}`}
        >
          {[0, 1, 2].map((n) => (
            <div className="today-tag tag-row tag-outline" key={n}>
              <div className="today-tag-body">
                <span className="today-tag-eyelet skeleton" />
                <span className="skeleton-line t-row">
                  <span>Список</span>
                </span>
                <span className="skeleton-line t-meta">
                  <span>рядків</span>
                </span>
                {shape === "lists" ? (
                  <div className="opening-tag-foot">
                    <span className="skeleton skeleton-pill" />
                    <span className="skeleton skeleton-verb" />
                  </div>
                ) : (
                  <span className="skeleton skeleton-verb" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
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
  extra: Refused = { fields: [], others: false },
): string {
  const what = mode === "file" ? "файл" : "рядки";
  // A refusal of «Ще про список» names its fields, and the lines too when
  // they are refused with them (goods task list after stage 2, P2-4;
  // review).
  const fields =
    extra.fields.length > 0
      ? [...(extra.others ? [what] : []), named(extra.fields)].join(" та ")
      : null;
  return unsure
    ? listRefusal(
        error,
        "Сервер не прийняв цей запит, а чи збережено список попередньою спробою — ще невідомо.",
        fields
          ? `Перевірте ${fields}, потім натисніть ще раз — двічі список не збережеться.`
          : `Перевірте ${what}${mode === "file" ? " і" : " й"} натисніть ще раз — двічі список не збережеться.`,
        "Дані змінилися — натисніть ще раз: двічі список не збережеться.",
      )
    : // What happened, then the step — never «спробуйте ще раз» on a write
      // (owner, В-П1 (б), 2026-11-11).
      listRefusal(
        error,
        "Список не збережено.",
        `Перевірте ${fields ?? what}.`,
        "Поки ви працювали, дані змінилися: перевірте склад і натисніть «Зберегти список» ще раз.",
      );
}

/** «Ще про список»'s fields as the server names them. */
const extraFields: [string, string][] = [
  ["source_document_ref", "Звідки список"],
  ["captured_at", "Коли перелічено"],
];

/** What a refusal names: «Ще про список»'s fields, in the form's order,
 * and whether it names anything else of the request too. */
interface Refused {
  fields: string[];
  others: boolean;
}

function refusedExtra(error: unknown): Refused {
  if (!(error instanceof ApiError)) return { fields: [], others: false };
  const body = error.validation.filter((issue) => issue.loc[0] === "body");
  return {
    fields: extraFields
      .filter(([field]) => body.some((issue) => issue.loc[1] === field))
      .map(([, name]) => name),
    others: body.some(
      (issue) => !extraFields.some(([field]) => issue.loc[1] === field),
    ),
  };
}

/** «Звідки список» та «Коли перелічено». */
function named(fields: string[]): string {
  return fields.map((field) => `«${field}»`).join(" та ");
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
  // What files filled, field by field, while nobody typed over it: the next
  // file replaces it, whatever was picked between them (review).
  const filledFrom = useRef<{ source: string | null; captured: string | null }>(
    { source: null, captured: null },
  );
  // «Звідки список» and «Коли перелічено» under the quiet «Ще про список»
  // (goods task list after stage 2, P2-4): open from the start when the
  // draft brought back holds their words, never hiding what will be saved.
  const [more, setMore] = useState(
    () => draft.source.trim() !== "" || draft.captured.trim() !== "",
  );
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
    // their own; a file picked instead of another replaces what a file
    // filled — a broken one, or one that fills nothing, between them changes
    // nothing (review).
    const filled = filledFrom.current;
    const { source, counted_on } = next.summary;
    const fills = {
      ...((draft.source.trim() === "" || draft.source === filled.source) &&
      fits(source, 300)
        ? { source }
        : {}),
      ...((draft.captured.trim() === "" ||
        draft.captured === filled.captured) &&
      fits(counted_on, 40)
        ? { captured: counted_on }
        : {}),
    };
    filledFrom.current = {
      source: fills.source ?? filled.source,
      captured: fills.captured ?? filled.captured,
    };
    setDraft(
      {
        command_id: same ? draft.command_id : crypto.randomUUID(),
        file_name: next.name,
        file_sha256: next.sha256,
        ...fills,
      },
      next,
    );
    // What goes with the file is seen before it is saved: what it filled,
    // or what an earlier one did (review).
    if (
      (fills.source ?? draft.source).trim() !== "" ||
      (fills.captured ?? draft.captured).trim() !== ""
    )
      setMore(true);
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
      // A refusal of «Ще про список»'s fields opens it (P2-4).
      const extra = refusedExtra(error);
      if (extra.fields.length > 0) setMore(true);
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
                ? // A file's problems, and the field refused with them.
                  extra.fields.length > 0
                  ? [...refused, `Перевірте ${named(extra.fields)}.`]
                  : refused
                : [newListRefusal(error, draft.mode, unsure, extra)],
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
        {/* The way in as a switch, its name for a reader alone (goods task
            list after stage 2, P2-4; spec §5 «Переключатель режима»). */}
        <ModeSwitch<Draft["mode"]>
          label="Як внести список"
          filters
          modes={[
            { mode: "text", label: "Вставити текст" },
            { mode: "file", label: "Завантажити файл" },
          ]}
          current={draft.mode}
          choose={(mode) => {
            setDraft({ mode });
            setProblems([]);
            // What goes with the other way is seen before it is saved
            // (review).
            if (draft.source.trim() !== "" || draft.captured.trim() !== "")
              setMore(true);
          }}
          disabled={busy}
          className="opening-way"
        />
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
        {/* What the list is and when it was counted: optional, under one
            quiet button — the screen's one field is the list (P2-4). */}
        <button
          type="button"
          className="quiet opening-more"
          aria-expanded={more}
          onClick={() => {
            setMore(!more);
          }}
        >
          Ще про список
        </button>
        {more && (
          <div className="opening-extra">
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
          </div>
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

/** A file's lines over the switch, once chosen on «Файли списку»: «Рядки
 * файлу «2. зошит-2.json»» — lines typed by hand by their part's own name. */
function fileLinesText(part: StockPart): string {
  const named =
    part.file_name === null
      ? `${String(part.part_no)}. Рядки, внесені вручну`
      : `Рядки файлу «${String(part.part_no)}. ${visible(part.file_name)}»`;
  return part.removed_at === null ? named : `${named} (прибрано)`;
}

/** The list's own screens beside its lines (goods task list after stage 2,
 * P0-1): its files, a file added, lines typed by hand. */
type ListScreen = "lines" | "files" | "file" | "typed";

/**
 * A list (goods task list after stage 2, P0-1): its big tag, and under it at
 * once the switch and the lines — what the manager comes for. The rest is
 * the tag's ⋯: a file or lines added, the list's files, its rejection; the
 * approval's summary is in its sheet. One line of what the waiting holds,
 * inside the tag.
 */
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
  // One file's lines only, chosen on «Файли списку», or every file's.
  const [partFilter, setPartFilter] = useState<StockPart | null>(null);
  // The line answered on its own screen, as it was read when it opened.
  const [editing, setEditing] = useState<ListLine | null>(null);
  const [screen, setScreen] = useState<ListScreen>("lines");
  // The tag's ⋯, the other lines, the rejection: one sheet at a time.
  const [sheet, setSheet] = useState<"ways" | "others" | "reject" | null>(null);
  // An approval refused, said under the tag.
  const [said, setSaid] = useState<string | null>(null);
  // Why the list is rejected, kept by the list while its sheet is closed
  // and opened again (review).
  const [reason, setReason] = useState("");
  // A refusal said under the tag is of its moment: gone once the list is
  // decided, or a line opened to be answered (review).
  const answering = editing !== null;
  useEffect(() => {
    setSaid(null);
  }, [list.status, answering]);
  const linesKey = [
    "stock-list-lines",
    scopeKey,
    list.snapshot_id,
    filter,
    partFilter?.part_id ?? null,
  ] as const;
  const lines = useInfiniteQuery({
    queryKey: linesKey,
    queryFn: ({ pageParam }) =>
      api<LinePage>(
        `/snapshots/${list.snapshot_id}/lines?store_id=${store.id}&limit=${String(linesPerPage)}&offset=${String(pageParam)}${filter ? `&status=${filter}` : ""}${partFilter ? `&part_id=${partFilter.part_id}` : ""}`,
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
  // Approving takes its own right, while the store that started the list
  // trades; rejecting is for whoever may approve, or add and remove the
  // list's files — a list whose last file is wrong is rejected (owner,
  // 2026-10-08; review, 2026-10-09).
  const approvable = list.status === "IN_REVIEW" && trading && canApprove;
  const rejectable = list.status === "IN_REVIEW" && (canApprove || canImport);
  // A list typed in one go is one part: nothing to tell apart. Before its
  // parts are read, the list's own counts say whether there are more.
  const hasFiles = parts.data
    ? allParts.length > 1 || allParts[0]?.kind === "FILE"
    : list.summary.parts + list.summary.parts_removed > 1;
  const ways = editable || hasFiles || rejectable;
  // The files' count as read: a file whose answer was lost is the list's
  // too, though the list read before it knows nothing of it.
  const liveParts = parts.data
    ? allParts.filter((part) => part.removed_at === null).length
    : list.summary.parts;
  // A form for a list decided meanwhile is no form: the lines, and the
  // screen left for them (review).
  const at: ListScreen =
    (screen === "file" || screen === "typed") && !editable ? "lines" : screen;
  useEffect(() => {
    if (!editable && (screen === "file" || screen === "typed")) {
      from.current = "more";
      setScreen("lines");
    }
  }, [editable, screen]);
  // The file whose lines are shown, as read now: removed meanwhile, its
  // line says so (review).
  const filePart =
    partFilter === null
      ? null
      : (allParts.find((part) => part.part_id === partFilter.part_id) ??
        partFilter);
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
  // Back from a screen of the list's own: the cursor on what opened it —
  // the tag's ⋯, or the line that names the file whose lines it showed.
  const more = useRef<HTMLButtonElement>(null);
  const fileLine = useRef<HTMLParagraphElement>(null);
  const from = useRef<"more" | "file" | null>(null);
  useLayoutEffect(() => {
    if (at !== "lines" || from.current === null) return;
    const to = from.current;
    from.current = null;
    ((to === "file" ? fileLine.current : more.current) ?? tag.current)?.focus();
  }, [at]);
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

  function showPart(part: StockPart | null): void {
    setPartFilter(part);
    // A file's lines, all of them: a removed file's are only «Прибрано».
    if (part !== null) setFilter(null);
    setEditing(null);
  }

  function show(status: LineStatus | null): void {
    setFilter(status);
    setEditing(null);
  }

  const back = (to: "more" | "file" = "more"): void => {
    from.current = to;
    setScreen("lines");
  };
  const go = (to: ListScreen): void => {
    setSheet(null);
    setScreen(to);
  };

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
  if (at === "files")
    return (
      <PartsScreen
        list={list}
        store={store}
        token={token}
        parts={parts}
        title={listName(list)}
        editable={editable}
        blocked={blocked}
        show={(part) => {
          showPart(part);
          back("file");
        }}
        leave={() => {
          back();
        }}
        refresh={refresh}
      />
    );
  if (at === "file")
    return (
      <AddFile
        list={list}
        store={store}
        token={token}
        title={listName(list)}
        warehouse={warehouse}
        blocked={blocked}
        done={async () => {
          // Read again first, under the screen's eyelet: the list comes
          // back with what was added, never a moment of the list before it
          // — «Затвердити» over a line just added.
          await refresh();
          back();
        }}
        refresh={refresh}
        leave={() => {
          back();
        }}
      />
    );
  if (at === "typed")
    return (
      <AddLines
        list={list}
        store={store}
        token={token}
        title={listName(list)}
        blocked={blocked}
        done={async () => {
          // Read again first, under the screen's eyelet: the list comes
          // back with what was added, never a moment of the list before it
          // — «Затвердити» over a line just added.
          await refresh();
          back();
        }}
        refresh={refresh}
        leave={() => {
          back();
        }}
      />
    );

  return (
    <>
      <ScreenHeader
        pushed
        title={listName(list)}
        back={
          <Back go={close} label="Назад до «Початкові залишки»">
            <span aria-hidden="true">← </span>
            Початкові залишки
          </Back>
        }
      />
      <section className="openings">
        {/* The list's big tag (spec §5 «Большая бирка»; P0-6): its
            warehouse, its state, how far it is answered and what its
            waiting holds — or, decided, what became of it; ⋯ for the rest
            (P0-1). */}
        <div className="tag-hero tag-outline opening-hero">
          <div className="opening-hero-in" ref={tag} tabIndex={-1}>
            <div className="opening-hero-head">
              <p className="opening-hero-place">Склад «{warehouse}»</p>
              {ways && (
                <button
                  ref={more}
                  type="button"
                  className="debt-more"
                  aria-label="Дії зі списком"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setSheet("ways");
                  }}
                >
                  <Icon name="tab-more" />
                </button>
              )}
            </div>
            <Sticker className="opening-state" as="p">
              {listStatusLabels[list.status]}
            </Sticker>
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
            {/* What the waiting holds, the tag's one line; what may be done
                about it, MainButton and ⋯ say (P0-1). */}
            {list.status === "IN_REVIEW" && (
              <p className="t-meta opening-hold">
                Поки список чекає рішення, на складі «{warehouse}», де ще не
                було руху товару, нічого не приймають, не продають і не
                виправляють.
              </p>
            )}
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
        {said && (
          <p role="alert" className="opening-said">
            {said}
          </p>
        )}
        {/* What may be done here, and the only thing: the plate stays
            (P0-1). */}
        {list.status === "IN_REVIEW" && !trading && (
          <p className="notice" role="status">
            {`Магазин «${visible(list.store_name ?? "—")}», що почав цей список, не працює: список можна лише відхилити, а файли додати до нового списку.`}
          </p>
        )}
        {/* The lines say what was read of them by their files. */}
        {parts.error && (
          <Unread
            error={parts.error}
            retry={() => {
              void parts.refetch();
            }}
          />
        )}
        {filePart !== null && (
          <div className="opening-file-line">
            <p className="t-meta" ref={fileLine} tabIndex={-1}>
              {fileLinesText(filePart)}
            </p>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                showPart(null);
              }}
            >
              Усі файли
            </button>
          </div>
        )}
        {/* Whoever may not take the stock in reads the lines without
            «Розібрати», and nothing is said of the rule (stage 2, goods
            task list, P1-5). */}
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
              setSheet("others");
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
          <OpeningPlaceholder said="Завантажуємо рядки…" shape="lines" />
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
        {approvable && (
          <Approval
            list={list}
            store={store}
            token={token}
            warehouse={warehouse}
            blocked={blocked}
            quiet={sheet !== null}
            fallback={tag}
            refresh={refresh}
            said={setSaid}
          />
        )}
      </section>
      {sheet === "ways" && (
        // Only what this person may do here (P0-1).
        <Sheet
          title={listName(list)}
          close={() => {
            setSheet(null);
          }}
          fallback={more}
        >
          <div className="debt-more-ways">
            {editable && (
              <>
                <button
                  type="button"
                  className="sheet-way"
                  disabled={blocked}
                  onClick={() => {
                    go("file");
                  }}
                >
                  Додати файл
                </button>
                <button
                  type="button"
                  className="sheet-way"
                  disabled={blocked}
                  onClick={() => {
                    go("typed");
                  }}
                >
                  Додати рядки вручну
                </button>
              </>
            )}
            {hasFiles && (
              <button
                type="button"
                className="sheet-way"
                onClick={() => {
                  go("files");
                }}
              >
                Файли списку · {number(liveParts)}
              </button>
            )}
            {rejectable && (
              <button
                type="button"
                className="sheet-way danger-way"
                disabled={blocked}
                onClick={() => {
                  setSaid(null);
                  setSheet("reject");
                }}
              >
                Відхилити список
              </button>
            )}
          </div>
        </Sheet>
      )}
      {sheet === "others" && (
        <Sheet
          title="Інші рядки"
          close={() => {
            setSheet(null);
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
                  setSheet(null);
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
      {sheet === "reject" && rejectable && (
        <RejectSheet
          list={list}
          store={store}
          token={token}
          warehouse={warehouse}
          blocked={blocked}
          fallback={more}
          reason={reason}
          setReason={setReason}
          close={() => {
            setSheet(null);
          }}
          rejected={() => {
            setReason("");
            setSheet(null);
          }}
          refresh={refresh}
        />
      )}
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
 * A decision on a list refused, in words: what the server named, or what was
 * not done and the step — never «спробуйте ще раз» on a write (owner, В-П1
 * (б), 2026-11-11).
 */
function decisionRefusal(
  error: unknown,
  action: "approve" | "reject",
  list: StockList,
  warehouse: string,
): string {
  if (error instanceof SlowAnswer) return errorText(error);
  if (!(error instanceof ApiError))
    return "Немає відповіді сервера. Оновіть список і подивіться, чи рішення збережено.";
  const reason = error.details.reason;
  if (error.code === "OPENING_BALANCE_CONFLICT")
    return `У складі «${warehouse}» уже був рух товару, тому початковий залишок туди внести не можна. Відхиліть цей список, а відсутній товар прийміть через «Ще» › «Прийшов товар».`;
  if (reason === "REVISION_CHANGED")
    return "Поки ви дивились, хтось змінив відповідь у списку. Перегляньте підсумок ще раз.";
  if (reason === "ROWS_NEED_REVIEW") return "Ще не всі рядки розібрано.";
  // Rejected meanwhile for another reason: its conflict (review,
  // 2026-10-24).
  if (reason === "ALREADY_DECIDED" || error.code === "IDEMPOTENCY_CONFLICT")
    return "Цей список уже затвердили або відхилили.";
  if (reason === "NOTHING_TO_APPLY")
    return "Список не затверджено: у ньому немає жодного рядка товару. Якщо так і є — відхиліть його.";
  if (reason === "SPLIT_MAY_BE_RANGE") return rangeAgainText(error.details);
  if (reason === "LIST_STORE_CANNOT_RECEIVE") return cannotReceiveText(list);
  return action === "approve"
    ? listRefusal(error, "Список не затверджено.", "Перегляньте рядки списку.")
    : listRefusal(error, "Список не відхилено.", "Перевірте причину.");
}

/**
 * The approval, for whoever may approve while the store that started the
 * list trades (owner decision, 2026-10-09): Telegram's MainButton,
 * «Затвердити · 412 шт.», once nothing waits — before, none, and the tag
 * says what waits — confirmed in a sheet, the number large (spec §6.6;
 * stage 2, goods task list, P0-6). The rejection is the tag's ⋯ (goods task
 * list after stage 2, P0-1). A refusal is `said` under the tag.
 */
function Approval({
  list,
  store,
  token,
  warehouse,
  blocked,
  quiet,
  fallback,
  refresh,
  said,
}: {
  list: StockList;
  store: Store;
  token: string;
  warehouse: string;
  blocked: boolean;
  /** Another sheet over the list: its MainButton is not this one. */
  quiet: boolean;
  /** Where the cursor goes as the sheet closes, its button gone. */
  fallback: RefObject<HTMLElement>;
  refresh: () => Promise<void>;
  said: (problem: string | null) => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const units = list.summary.units;
  const ready = list.ready_to_approve;
  const ask = (): void => {
    if (blocked || busy) return;
    said(null);
    setAsking(true);
  };
  const words = `Затвердити · ${number(units)} шт.`;
  const main = useMainButton(words, ask, {
    shown: ready && !asking && !quiet,
    active: !blocked && !busy,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, ready && !asking && !main);

  async function approve(): Promise<void> {
    setBusy(true);
    said(null);
    try {
      await api(
        `/snapshots/${list.snapshot_id}/approve?store_id=${store.id}`,
        token,
        { expected_review_revision: list.review_revision },
        undefined,
        "POST",
        // A large list's approval may take longer than 20 s (ADR-0014 §16).
        { slow: true },
      );
      buzz("success");
    } catch (error) {
      buzz("error");
      // Refused: said under the tag at once, the list read again behind it.
      said(decisionRefusal(error, "approve", list, warehouse));
      setAsking(false);
      setBusy(false);
      await refresh();
      return;
    }
    // Approved: read again under the sheet's eyelet, then closed — never a
    // moment of «Затвердити» over the list just decided (review).
    await refresh();
    setAsking(false);
    setBusy(false);
  }

  return (
    <>
      {ready && !asking && !main && (
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
      {asking && (
        <ApproveSheet
          list={list}
          warehouse={warehouse}
          busy={busy}
          held={blocked}
          fallback={fallback}
          approve={() => {
            void approve();
          }}
          close={() => {
            if (!busy) setAsking(false);
          }}
        />
      )}
    </>
  );
}

/**
 * «Відхилити «Зошит 1»?» (goods task list after stage 2, P0-1): why, and
 * Telegram's MainButton «Так, відхилити», not pressed until a reason is
 * given — outside Telegram, the sheet's own; «Назад» closes it, the reason
 * kept by the list. Enter only puts the keyboard away: a rejection is never
 * undone, so only the button rejects (review). Rejected, the list is read
 * again under the sheet's eyelet, then the sheet closes and the tag says
 * so; refused, it stays with the reason typed and says why.
 */
function RejectSheet({
  list,
  store,
  token,
  warehouse,
  blocked,
  fallback,
  reason,
  setReason,
  close,
  rejected,
  refresh,
}: {
  list: StockList;
  store: Store;
  token: string;
  warehouse: string;
  blocked: boolean;
  fallback: RefObject<HTMLElement>;
  reason: string;
  setReason: (reason: string) => void;
  close: () => void;
  rejected: () => void;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const given = reason.trim() !== "";
  const press = (): void => {
    if (given && !blocked && !busy) void reject();
  };
  const words = "Так, відхилити";
  const main = useMainButton(words, press, {
    progress: busy,
    active: given && !blocked,
  });

  async function reject(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await api(
        `/snapshots/${list.snapshot_id}/reject?store_id=${store.id}`,
        token,
        { reason: reason.trim() },
        undefined,
        "POST",
      );
      buzz("success");
    } catch (error) {
      buzz("error");
      // Refused: said in the sheet at once, its reason free to change; the
      // list read again behind it.
      setProblem(decisionRefusal(error, "reject", list, warehouse));
      setBusy(false);
      await refresh();
      return;
    }
    await refresh();
    rejected();
  }

  return (
    <Sheet
      title={`Відхилити «${listName(list)}»?`}
      close={() => {
        if (!busy) close();
      }}
      fallback={fallback}
      held={busy}
      foot={
        main ? undefined : (
          <div className="count-foot">
            <button
              type="button"
              className="sheet-done main-mimic"
              disabled={(!given || blocked) && !busy}
              aria-disabled={busy || undefined}
              onClick={press}
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
          </div>
        )
      }
    >
      <div className="opening-reject">
        <label>
          Чому відхиляємо
          <input
            value={reason}
            maxLength={1000}
            disabled={busy}
            enterKeyHint="done"
            onChange={(event) => {
              setReason(event.target.value);
              setProblem(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              // The keyboard put away, the cursor still the sheet's: Escape
              // and «Назад» close it as ever.
              event.currentTarget
                .closest<HTMLElement>('[role="dialog"]')
                ?.focus();
            }}
          />
        </label>
        <p className="t-meta">Залишків цей список не змінить.</p>
        {problem && <p role="alert">{problem}</p>}
      </div>
    </Sheet>
  );
}

/**
 * What an approval adds up, under its number (goods task list after stage
 * 2, P0-1): each basis's lines and pieces, the lines answered otherwise than
 * the list says, and its files when there are more than one.
 */
function ApprovalSummary({ list }: { list: StockList }): JSX.Element | null {
  const { summary } = list;
  const bases = (Object.keys(basisLabels) as Basis[]).filter(
    (basis) => summary.lines_by_basis[basis] > 0,
  );
  const differing = summary.lines_differing_from_source;
  if (bases.length === 0 && differing === 0 && summary.parts <= 1) return null;
  return (
    <ul className="opening-summary">
      {bases.map((basis) => {
        const count = summary.lines_by_basis[basis];
        return (
          <li key={basis}>
            {`${basisLabels[basis]}: ${number(count)} ${plural(count, "рядок", "рядки", "рядків")} · ${number(summary.units_by_basis[basis])} шт.`}
          </li>
        );
      })}
      {differing > 0 && (
        <li>{`Рядків, де відповідь відрізняється від списку: ${number(differing)}`}</li>
      )}
      {summary.parts > 1 && (
        <li>{`Файлів у списку: ${number(summary.parts)}`}</li>
      )}
    </ul>
  );
}

/**
 * «Затвердити «Зошит 1»?» (spec §6.6; P0-6): the number large, what it
 * becomes, that it cannot be undone, what it adds up (P0-1), and Telegram's
 * MainButton «Так, затвердити» — outside Telegram, the sheet's own. A press
 * sooner than `CARRIED_TAP` after it opened was meant for «Затвердити · …
 * шт.», which stood where «Так, затвердити» stands: let go.
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
      <ApprovalSummary list={list} />
    </Sheet>
  );
}
