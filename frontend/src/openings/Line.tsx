import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import type { Store } from "@/orders/types";
import { AddedStub, CatalogPicker } from "@/inventory/CatalogPicker";
import type { ReceivableVariant, SizeOption } from "@/inventory/receiptTypes";
import { Back } from "@/shared/Back";
import { Eyelet } from "@/shared/Eyelet";
import { usePanelRoom } from "@/shared/panel";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { buzz, useMainButton } from "@/shared/telegram";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import { visible } from "@/shared/visible";
import { partName } from "./Parts";
import {
  basisLabels,
  cannotReceiveText,
  fileReasonLabels,
  listConflict,
  listRefusal,
  number,
  plural,
  priceKindLabels,
  sizesWithCounts,
  sourceQuantity,
  times,
} from "./types";
import type {
  Basis,
  ListLine,
  Reading,
  ShownSize,
  SplitReading,
  StockList,
  StockPart,
} from "./types";

export function sizeText(code: string | null): string {
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
 * `visible()`. Shown on the line's own screen, under its text (stage 2,
 * goods task list, P0-5).
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
        <p className="t-meta">
          Фото: {visible(line.photo_name)}, рядок {line.photo_line}
        </p>
      )}
      {part && (part.kind === "FILE" || parts.length > 1) && (
        <p className="t-meta">Файл: {partName(part)}</p>
      )}
      {read !== "" && <p className="t-meta">Прочитано: {read}</p>}
      {reading?.count != null && (
        <p className="t-meta">Парсер прочитав кількість: {reading.count}</p>
      )}
      {reading?.price != null && (
        <p className="t-meta">
          Ціна з зошита: {visible(reading.price)}
          {line.price_kind ? ` (${priceKindLabels[line.price_kind]})` : ""}
        </p>
      )}
      {line.file_reasons.map((reason) =>
        reason === "FILE_NOTE" ? (
          <p className="t-meta" key={reason}>
            Примітка парсера: {visible(reading?.note ?? "")}
          </p>
        ) : (
          <p className="t-meta opening-why" key={reason}>
            {fileReasonLabels[reason] ?? reason}
          </p>
        ),
      )}
      {line.same_photo_lines > 1 && (
        <p className="t-meta opening-why">
          Цей рядок того самого фото у списку — {times(line.same_photo_lines)}:
          можливо, фото прочитано двічі або додано у двох файлах.
        </p>
      )}
    </>
  );
}

/**
 * What the list and the parser say of a line: on its own screen, and on its
 * row where that screen does not open — an approver who does not answer
 * lines, a list only to reject, a list decided — so the reasons to reject
 * are seen there too (review, 2026-11-08). `row`: on the row, its count
 * said above it already, and a record that may be a range said, not asked.
 */
export function LineEvidence({
  line,
  parts,
  row = false,
}: {
  line: ListLine;
  parts: StockPart[];
  row?: boolean;
}): JSX.Element {
  return (
    <>
      {!row && <p className="t-meta">{visible(sourceQuantity(line))}</p>}
      <FileEvidence line={line} parts={parts} />
      {row &&
        (line.shown_split ?? [])
          .filter((size) => size.may_be_range)
          .map((size) => (
            <p className="t-meta opening-why" key={`range:${size.size}`}>
              {`Запис «${recordText(size)}» може означати й діапазон розмірів: під час розбору вкажіть, що саме.`}
            </p>
          ))}
      {line.same_text_lines > 1 && (
        <p className="t-meta opening-why">
          Такий самий рядок у списку — {times(line.same_text_lines)}: це може
          бути по рядку на кожну одиницю, або помилка переписування.
        </p>
      )}
    </>
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
 * An answer by size refused: a record of the line may now be a range of
 * sizes, a size having been created since the line was read
 * (`SPLIT_MAY_BE_RANGE`, `records`; review, fourth round, 2026-10-09). The
 * line is read again, and the record is asked about on its screen.
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
  /** Its size touched: what the line read is no longer only offered. */
  touched: boolean;
}

/**
 * The organization's sizes as cells (spec §5 «Ячейка размера»), and «?» for
 * a size not known. The size the line reads is chosen for the person, and
 * drawn dashed until it is touched: «Схоже на M — торкніться, щоб
 * підтвердити» (P6; В-Г7 (а)).
 */
function SizeCells({
  sizes,
  size,
  read,
  hint,
  choose,
}: {
  sizes: SizeOption[];
  size: string;
  /** The size is the line's reading, not yet touched. */
  read: boolean;
  /** What says so — «Схоже на M…» —, for a reader on the dashed cell. */
  hint?: string | undefined;
  choose: (size: string) => void;
}): JSX.Element {
  const look = (on: boolean, long: boolean): string =>
    `size-cell${long ? " long" : ""}${on ? (read ? " suggested" : " chosen") : ""}`;
  return (
    <div className="cells opening-sizes" role="radiogroup" aria-label="Розмір">
      {sizes.map((option) => {
        const code = visible(option.code);
        return (
          <button
            type="button"
            role="radio"
            aria-checked={size === option.size_id}
            aria-describedby={
              read && size === option.size_id ? hint : undefined
            }
            key={option.size_id}
            className={look(size === option.size_id, code.length > 3)}
            onClick={() => {
              // A choice, felt (spec §4.4).
              buzz("selection");
              choose(option.size_id);
            }}
          >
            <span className="size-letter">{code}</span>
          </button>
        );
      })}
      <button
        type="button"
        role="radio"
        aria-checked={size === "UNKNOWN"}
        aria-label="Розмір невідомий"
        className={look(size === "UNKNOWN", false)}
        onClick={() => {
          buzz("selection");
          choose("UNKNOWN");
        }}
      >
        <span className="size-letter" aria-hidden="true">
          ?
        </span>
        <span className="size-free" aria-hidden="true">
          невідомий
        </span>
      </button>
    </div>
  );
}

/**
 * One line of a list, on a task's screen of its own (stage 2, goods task
 * list, P0-5): «Рядок 12 з 412», the menu aside. The line as it was written,
 * large, never edited; what the parser read beside it, as a hint. The model
 * searched for by itself from what the line reads, and chosen by a tap;
 * the size the line reads, and where its count comes from as the line
 * states it, chosen for the person and drawn dashed until touched (В-Г7
 * (а)); a split the line shows offered as one button, never chosen; a
 * record that may be a range asked about first (owner decision,
 * 2026-10-09). Telegram's MainButton says what is recorded — «Зберегти й
 * далі · M × 2 шт.» — and opens the next line of the same lines; on the
 * last, «Зберегти», back to the list. «Не товар» and «Пропустити» are quiet;
 * «Назад» goes to the list, nothing recorded. What is sent is what the form
 * sent before: the same request.
 */
export function LineTask({
  line,
  list,
  title,
  store,
  token,
  scopeKey,
  sizes,
  listParts,
  warehouse,
  blocked,
  more,
  next,
  leave,
  reread,
  task,
}: {
  line: ListLine;
  list: StockList;
  /** The list's name, for «←». */
  title: string;
  store: Store;
  token: string;
  scopeKey: string;
  sizes: UseQueryResult<SizeOption[]>;
  listParts: StockPart[];
  warehouse: string;
  blocked: boolean;
  /** Another line of the same lines after this one. */
  more: boolean;
  /** Answered, or passed by: the next line of the same lines, or the list. */
  next: (answered: boolean) => Promise<void>;
  /** Back to the list, nothing recorded. */
  leave: () => void;
  /** Read the list's lines again, this one with them: the screen stays
   * open and shows the line as the server reads it now. */
  reread: () => void;
  /** The menu steps aside while a line is answered. */
  task?: ((shown: boolean) => void) | undefined;
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
  // A model added from an empty search: its stub, under that model only
  // (stage 2, goods task list, P0-1; review).
  const [added, setAdded] = useState<Readonly<Record<string, string>>>({});
  const addedSaid = (
    variant: ReceivableVariant | null,
    said?: string,
  ): void => {
    if (variant === null || said === undefined) return;
    setAdded((was) => ({ ...was, [variant.product_variant_id]: said }));
  };
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
  const startSize = sizes.data?.find((s) => s.code === readSize)?.size_id ?? "";
  // What the line states is chosen for the person, dashed until touched
  // (В-Г7 (а)).
  const [preset] = useState<Basis | "">(
    stated ? "STATED" : line.may_imply_one ? "LINE_IMPLIES_ONE" : "",
  );
  const [chosen, setBasis] = useState<Basis | "">(preset);
  const [basisTouched, setBasisTouched] = useState(false);
  const [skip, setSkip] = useState(false);
  // A choice the line no longer offers is no choice. The line is read again
  // while its screen is open (the phone comes back to the app, the
  // connection returns, an answer is refused): a record made a possible
  // range since is asked about, and «Як у рядку» waits for its answer
  // (review, fourth round, 2026-10-09).
  const basis = chosen === "" || allowed.includes(chosen) ? chosen : "";
  const [parts, setParts] = useState<Part[]>([
    {
      variant: null,
      size: startSize,
      quantity: stated ? String(line.quantity_total) : "1",
      picking: true,
      touched: false,
    },
  ]);
  // The organization's sizes read after the screen opened: the line's own
  // is still where to start, unless one was chosen meanwhile.
  useEffect(() => {
    if (startSize === "") return;
    setParts((was) =>
      was.map((part, index) =>
        index === 0 && part.size === "" && !part.touched
          ? { ...part, size: startSize }
          : part,
      ),
    );
  }, [startSize]);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

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
  const first = parts[0];
  const model = first?.variant ?? null;
  // The records the person read as a size with its count, by name: what
  // was answered here, never every record the line now flags (review,
  // fourth round, 2026-10-09).
  const readRecords = split.flatMap((size, index) =>
    readings[index] === "SIZE_WITH_COUNT" ? [recordKey(size)] : [],
  );
  const complete = skip
    ? reason.trim() !== ""
    : bySize
      ? model !== null
      : basis !== "" &&
        shown.every((p) => p.variant !== null && p.size !== "") &&
        quantities.every((q) => Number.isInteger(q) && q > 0 && q <= 10000) &&
        !duplicate &&
        (!needsNote || note.trim() !== "");

  const sizeWord = (size: string): string =>
    size === "UNKNOWN"
      ? "розмір невідомий"
      : visible(sizes.data?.find((s) => s.size_id === size)?.code ?? "—");
  // What is recorded, said on the MainButton (В-Г7 (а)).
  const what = skip
    ? "не товар"
    : bySize
      ? `${split.map((size) => `${visible(size.size)} × ${String(size.count)}`).join(", ")} шт.`
      : `${shown.map((p, i) => `${sizeWord(p.size)} × ${String(quantities[i])}`).join(", ")} шт.`;
  const words = `${more ? "Зберегти й далі" : "Зберегти"}${complete ? ` · ${what}` : ""}`;

  function update(index: number, change: Partial<Part>): void {
    setParts(parts.map((p, i) => (i === index ? { ...p, ...change } : p)));
  }

  async function send(): Promise<void> {
    let saved = false;
    setBusy(true);
    setProblem(null);
    const body = skip
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
      buzz("success");
      saved = true;
    } catch (error) {
      buzz("error");
      const why = error instanceof ApiError ? error.details.reason : undefined;
      // A record made a possible range since the line was read: read it
      // again, so the record named is asked about here.
      // So is a list changed in a way it does not name (review,
      // 2026-10-24).
      if (why === "SPLIT_MAY_BE_RANGE" || listConflict(error)) reread();
      if (!live.current) return;
      setProblem(
        !(error instanceof ApiError)
          ? "Немає відповіді сервера. Натисніть ще раз — повторна відповідь безпечна."
          : why === "PART_REMOVED"
            ? "Файл цього рядка прибрали — відповідь не збережено."
            : why === "SPLIT_MAY_BE_RANGE"
              ? rangeNowText(error.details)
              : why === "LIST_STORE_NOT_TRADING"
                ? errorText(error)
                : why === "LIST_STORE_CANNOT_RECEIVE"
                  ? cannotReceiveText(list)
                  : why === "LIST_FULL" && error.details.what === "allocations"
                    ? noRoomText(error.details.limit)
                    : error.code === "SNAPSHOT_CONFLICT"
                      ? "Список уже затвердили або відхилили — відповідь не збережено."
                      : error.code === "NOT_FOUND"
                        ? "Товар або розмір більше недоступний. Оберіть інший."
                        : // What was not done, then the step (owner,
                          // В-П1 (б), 2026-11-11).
                          listRefusal(
                            error,
                            "Відповідь не збережено.",
                            "Перевірте її.",
                          ),
      );
    } finally {
      // Saved, the button turns until the next line opens.
      if (!saved && live.current) setBusy(false);
    }
    if (!saved) return;
    try {
      await next(true);
    } finally {
      if (live.current) setBusy(false);
    }
  }

  const press = (): void => {
    if (complete && !busy && !blocked) void send();
  };
  const main = useMainButton(words, press, {
    progress: busy,
    active: complete && !blocked,
  });
  const dock = useRef<HTMLDivElement>(null);
  usePanelRoom(dock, !main);
  const heading = useRef<HTMLHeadingElement>(null);
  const seems = useId();
  // The line's number among the list's: numbers go on past a file removed
  // (review, 2026-11-08).
  const lastLine = Math.max(
    list.summary.lines,
    ...listParts.map((part) => part.last_line_no),
  );
  // A task's screen: the menu aside while it is open (P0-5).
  useEffect(() => {
    task?.(true);
    return () => {
      task?.(false);
    };
  }, [task]);
  // Opened, from the list or the line before: at its top, a reader at its
  // title.
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, []);

  const picker = (index: number, part: Part): JSX.Element =>
    part.picking || part.variant === null ? (
      <CatalogPicker
        store={store}
        token={token}
        scopeKey={scopeKey}
        variant={part.variant}
        initialSearch={
          line.reading?.model ?? line.candidates.concept?.[0] ?? ""
        }
        onVariant={(variant, said) => {
          update(index, { variant, picking: variant === null });
          addedSaid(variant, said);
        }}
        adds
      />
    ) : (
      <>
        <div className="opening-model">
          <p className="t-row">{visible(part.variant.display_name)}</p>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              update(index, { picking: true });
            }}
          >
            Інша модель
          </button>
        </div>
        <AddedStub said={added[part.variant.product_variant_id] ?? null} />
      </>
    );
  const cells = (index: number, part: Part): JSX.Element =>
    sizes.isPending ? (
      // A row of size cells in grey, where they come (goods task list after
      // stage 2, P2-2).
      <Placeholder said="Завантажуємо розміри…" cells={4} />
    ) : sizes.isError ? (
      <Unread
        error={sizes.error}
        retry={() => {
          void sizes.refetch();
        }}
      />
    ) : (
      <SizeCells
        sizes={sizes.data}
        size={part.size}
        read={
          index === 0 &&
          !part.touched &&
          part.size !== "" &&
          part.size === startSize
        }
        hint={index === 0 ? seems : undefined}
        choose={(size) => {
          update(index, { size, touched: true });
        }}
      />
    );
  const quantity = (index: number, part: Part): JSX.Element => (
    <label className="opening-count">
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
  );
  const read = (option: Basis): boolean =>
    option === preset && !basisTouched && basis === option;
  const choose = (option: Basis): void => {
    buzz("selection");
    setBasis(option);
    setBasisTouched(true);
  };
  const basisName = `basis-${String(line.line_no)}`;

  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title={`Рядок ${String(line.line_no)} з ${number(lastLine)}`}
        context={`Склад «${warehouse}» · чекають ${number(
          list.summary.pending + list.summary.needs_review,
        )}`}
        back={
          <Back go={leave} held={busy} label={`Назад до списку «${title}»`}>
            <span aria-hidden="true">← </span>
            {title}
          </Back>
        }
      />
      {/* Not a <form>: the catalogue picker inside it is one, and a form
          inside a form would submit the wrong one. */}
      <div
        className="opening-task"
        role="form"
        aria-label={`Розбір рядка ${String(line.line_no)}`}
      >
        <div className="opening-paper">
          <p className="t-row catalog-raw">
            {line.raw_text === null ? "—" : visible(line.raw_text)}
          </p>
        </div>
        <div className="opening-evidence">
          <LineEvidence line={line} parts={listParts} />
        </div>
        {skip ? (
          <label className="opening-skip">
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
        ) : (
          <>
            {ambiguous.map((index) => {
              const size = split[index];
              if (size === undefined) return null;
              const name = `split-${String(line.line_no)}-${String(index)}`;
              const answer = (reading: SplitReading): void => {
                buzz("selection");
                setReadings({ ...readings, [index]: reading });
                // Read as a range, the line is no longer answered as it
                // shows.
                if (reading === "RANGE" && chosen === "STATED_BY_SIZE")
                  setBasis("");
              };
              return (
                <fieldset className="opening-ways" key={name}>
                  <legend className="t-row">{`Запис «${recordText(size)}» — це:`}</legend>
                  <label
                    className={`way-option${readings[index] === "SIZE_WITH_COUNT" ? " chosen" : ""}`}
                  >
                    <input
                      type="radio"
                      name={name}
                      checked={readings[index] === "SIZE_WITH_COUNT"}
                      onChange={() => {
                        answer("SIZE_WITH_COUNT");
                      }}
                    />
                    <span>{`Розмір ${visible(size.size)} — ${String(size.count)} шт.`}</span>
                  </label>
                  <label
                    className={`way-option${readings[index] === "RANGE" ? " chosen" : ""}`}
                  >
                    <input
                      type="radio"
                      name={name}
                      checked={readings[index] === "RANGE"}
                      onChange={() => {
                        answer("RANGE");
                      }}
                    />
                    <span>{`Діапазон розмірів ${visible(size.size)}–${String(size.count)}`}</span>
                  </label>
                </fieldset>
              );
            })}
            {readAsRange && (
              <p className="t-meta opening-why">
                Діапазон не каже, скільки якого розміру: вкажіть розміри й
                кількість і звідки вони відомі.
              </p>
            )}
            <h2 className="t-label opening-step">Модель</h2>
            {first && picker(0, first)}
            <h2 className="t-label opening-step">Розмір</h2>
            {bySizeOffered && (
              <label className={`way-option${bySize ? " chosen" : ""}`}>
                <input
                  type="radio"
                  name={basisName}
                  checked={bySize}
                  onChange={() => {
                    choose("STATED_BY_SIZE");
                  }}
                />
                <span>{`Як у рядку: ${split.map((size) => `${visible(size.size)} ${String(size.count)}`).join(" · ")}`}</span>
              </label>
            )}
            {missing.length > 0 && (
              <p className="t-meta opening-why">
                {`Рядок показує кількість по розмірах (${visible(sizesWithCounts(split))}), але ${missing.length === 1 ? "розміру" : "розмірів"} ${missing.map((size) => `«${visible(size.size)}»`).join(", ")} немає в каталозі. Створіть розмір або вкажіть, звідки відома кількість.`}
              </p>
            )}
            {bySize ? (
              <ul
                className="cells opening-split"
                aria-label="Розміри й кількість, як у рядку"
              >
                {split.map((size) => (
                  <li className="size-cell chosen" key={size.size}>
                    <span className="size-letter">{visible(size.size)}</span>{" "}
                    <span className="size-free">× {size.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              first && (
                <>
                  {cells(0, first)}
                  {first.size !== "" &&
                    !first.touched &&
                    first.size === startSize && (
                      <p className="t-meta opening-read" id={seems}>
                        {`Схоже на ${sizeWord(first.size)} — торкніться, щоб підтвердити`}
                      </p>
                    )}
                </>
              )
            )}
            <fieldset className="opening-ways">
              <legend className="t-label opening-step">Звідки кількість</legend>
              {allowed
                .filter((option) => option !== "STATED_BY_SIZE")
                .map((option) => (
                  <label
                    className={`way-option${
                      basis === option
                        ? read(option)
                          ? " read"
                          : " chosen"
                        : ""
                    }`}
                    key={option}
                  >
                    <input
                      type="radio"
                      name={basisName}
                      checked={basis === option}
                      onChange={() => {
                        choose(option);
                      }}
                    />
                    <span>
                      {option === "STATED"
                        ? `${basisLabels.STATED}: ${String(line.quantity_total)} шт.`
                        : basisLabels[option]}
                    </span>
                    {read(option) && (
                      // Read with the way: «Як у списку: 3 шт. Прочитали в
                      // рядку».
                      <span className="t-meta way-option-read">
                        {" "}
                        Прочитали в рядку
                      </span>
                    )}
                  </label>
                ))}
            </fieldset>
            {line.quantity_state !== "KNOWN" &&
              !line.may_imply_one &&
              split.length === 0 && (
                <p className="t-meta opening-why">
                  Список не каже, скільки тут штук і якого розміру. Вкажіть, хто
                  перелічив, або звідки це відомо.
                </p>
              )}
            {!bySize && first && quantity(0, first)}
            {!bySize &&
              fixed === null &&
              shown.slice(1).map((part, at) => {
                const index = at + 1;
                return (
                  <div className="section-block opening-alloc" key={index}>
                    {picker(index, part)}
                    {cells(index, part)}
                    {quantity(index, part)}
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        setParts(parts.filter((_, i) => i !== index));
                      }}
                    >
                      Прибрати
                    </button>
                  </div>
                );
              })}
            {!bySize && fixed === null && basis !== "" && (
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
                      touched: false,
                    },
                  ]);
                }}
              >
                Ще розмір чи колір
              </button>
            )}
            <label className="opening-note">
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
        <div className="actions opening-quiet">
          <button
            type="button"
            className="quiet"
            aria-pressed={skip}
            disabled={busy}
            onClick={() => {
              setSkip(!skip);
              setProblem(null);
            }}
          >
            Не товар
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => {
              void next(false);
            }}
          >
            Пропустити
          </button>
        </div>
        {!main && (
          // Outside Telegram, its MainButton as the dock's one button.
          <div className="pay-panel order-dock" ref={dock}>
            <button
              type="button"
              className="main-mimic"
              disabled={!complete || blocked}
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
        )}
      </div>
    </>
  );
}
