import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import type { Location, Store } from "@/orders/types";
import { CatalogPicker } from "@/inventory/CatalogPicker";
import type { ReceivableVariant, SizeOption } from "@/inventory/receiptTypes";
import {
  basisLabels,
  lineStatusLabels,
  listStatusLabels,
  sourceQuantity,
} from "./types";
import type { Basis, LineStatus, ListLine, StockList } from "./types";

/**
 * «Початкові залишки»: the goods already in a shop, entered as a list.
 *
 * The owner's way in for existing stock (2026-10-01; ADR-0005): a list is kept
 * line by line as it was written, a person says what each line is and where
 * its numbers came from, and an owner approves the whole list into the
 * warehouse's opening balance — once, into a warehouse with no history.
 *
 * Every command here is safe to send twice — the list by its `command_id`, a
 * line's answer by the line, an approval by the review revision it approves —
 * so no journal is kept: a lost answer is resent, or the list read again. The
 * list being typed is kept on this phone until the server has it.
 */
export function Openings({
  store,
  token,
  scopeKey,
  blocked,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
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
  const warehouse = (id: string): string =>
    locations.data?.find((l) => l.id === id)?.name ?? "склад";
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
    <section>
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
        у зошиті. Кожен рядок розбирає людина, потім власник затверджує список,
        і він стає початковим залишком складу. Склад має бути без жодного руху
        товару: затвердьте список до першого приймання чи продажу з нього.
      </p>
      {canImport &&
        (creating ? (
          <NewList
            store={store}
            token={token}
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
            aria-label={`Список ${list.source_document_ref ?? ""}`.trim()}
          >
            <strong>
              {list.source_document_ref ?? "Список без назви"} · склад «
              {warehouse(list.location_id)}»
            </strong>
            <span className="badge">{listStatusLabels[list.status]}</span>
            <small>
              Рядків: {list.summary.lines} · розібрано{" "}
              {list.summary.resolved + list.summary.skipped} · одиниць{" "}
              {list.summary.units}
            </small>
            <button
              className="quiet"
              onClick={() => {
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

interface Draft {
  command_id: string;
  location_id: string;
  source: string;
  captured: string;
  text: string;
}

function draftKey(store: Store): string {
  return `birka:stock-list-draft:${store.id}`;
}

function loadDraft(store: Store): Draft {
  try {
    const stored = window.localStorage.getItem(draftKey(store));
    if (stored) return JSON.parse(stored) as Draft;
  } catch {
    /* A fresh list: the server has not seen this one. */
  }
  return {
    command_id: crypto.randomUUID(),
    location_id: "",
    source: "",
    captured: "",
    text: "",
  };
}

function saveDraft(store: Store, draft: Draft | null): void {
  try {
    if (draft)
      window.localStorage.setItem(draftKey(store), JSON.stringify(draft));
    else window.localStorage.removeItem(draftKey(store));
  } catch {
    /* Typing still works; only a reload loses it. */
  }
}

/** The list's lines as the server keeps them: verbatim, minus blank ones. */
function listLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

function NewList({
  store,
  token,
  locations,
  blocked,
  done,
  cancel,
}: {
  store: Store;
  token: string;
  locations: Location[];
  blocked: boolean;
  done: (list: StockList) => void;
  cancel: () => void;
}): JSX.Element {
  const [draft, setDraftState] = useState<Draft>(() => loadDraft(store));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const lines = listLines(draft.text);
  const tooLong = lines.find((line) => line.length > 500);
  const ready =
    draft.location_id !== "" && lines.length > 0 && !tooLong && !busy;

  function setDraft(change: Partial<Draft>): void {
    const next = { ...draft, ...change };
    setDraftState(next);
    saveDraft(store, next);
  }

  async function send(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      const list = await api<StockList>("/snapshots", token, {
        command_id: draft.command_id,
        store_id: store.id,
        location_id: draft.location_id,
        source_document_ref: draft.source.trim() || null,
        captured_at: draft.captured.trim() || null,
        lines,
      });
      saveDraft(store, null);
      done(list);
    } catch (error) {
      setProblem(
        !(error instanceof ApiError)
          ? "Невідомо, чи збережено список. Натисніть ще раз — той самий список не збережеться двічі."
          : error.code === "IDEMPOTENCY_CONFLICT"
            ? "Цей список уже збережено, але в іншому вигляді. Знайдіть його в переліку, або почніть новий."
            : errorText(error),
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
              {location.name}
            </option>
          ))}
        </select>
      </label>
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
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button type="submit" disabled={!ready || blocked}>
          Зберегти список
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={cancel}
        >
          Закрити
        </button>
        {problem && (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => {
              setDraft({ command_id: crypto.randomUUID() });
              setProblem(null);
            }}
          >
            Почати як новий список
          </button>
        )}
      </div>
    </form>
  );
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
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const lines = useQuery({
    queryKey: ["stock-list-lines", scopeKey, list.snapshot_id, filter, offset],
    queryFn: () =>
      api<{ items: ListLine[]; has_more: boolean }>(
        `/snapshots/${list.snapshot_id}/lines?limit=${String(linesPerPage)}&offset=${String(offset)}${filter ? `&status=${filter}` : ""}`,
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

  async function refresh(): Promise<void> {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["stock-lists"] }),
      cache.invalidateQueries({ queryKey: ["stock-list-lines"] }),
      cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
    ]);
  }

  return (
    <section>
      <div className="toolbar">
        <h2>{list.source_document_ref ?? "Список без назви"}</h2>
        <button className="quiet" onClick={close}>
          До списків
        </button>
      </div>
      <p>
        Склад «{warehouse}» · {listStatusLabels[list.status]}
        {list.captured_at ? ` · перелічено ${list.captured_at}` : ""}
      </p>
      <p className="hint">
        Рядків: {list.summary.lines} · розібрано {list.summary.resolved} · не
        товар {list.summary.skipped} · чекають{" "}
        {list.summary.pending + list.summary.needs_review} · одиниць{" "}
        {list.summary.units}
      </p>
      {list.status === "APPLIED" && (
        <p role="status">
          Затверджено: {list.application?.units ?? list.summary.units} од. стали
          початковим залишком складу «{warehouse}».
        </p>
      )}
      {list.status === "REJECTED" && (
        <p role="status">
          Відхилено{list.rejection_reason ? `: ${list.rejection_reason}` : ""}.
          Залишків цей список не змінив.
        </p>
      )}
      {list.status === "IN_REVIEW" && canApprove && (
        <Approval
          list={list}
          token={token}
          warehouse={warehouse}
          blocked={blocked}
          refresh={refresh}
        />
      )}
      {list.status === "IN_REVIEW" && canImport && !canPick && (
        <p role="alert">
          Щоб розбирати рядки, потрібне право приймати товар у цьому магазині.
        </p>
      )}
      <nav aria-label="Рядки списку">
        {lineFilters.map(({ status, label }) => (
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
                blocked={blocked}
                done={() => {
                  setEditing(null);
                  void refresh();
                }}
                cancel={() => {
                  setEditing(null);
                }}
              />
            ) : (
              <LineCard
                key={line.line_no}
                line={line}
                answer={
                  list.status === "IN_REVIEW" && canImport && canPick
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
  return code === null || code === "UNKNOWN" ? "розмір невідомий" : code;
}

function LineCard({
  line,
  answer,
  blocked,
}: {
  line: ListLine;
  answer: (() => void) | null;
  blocked: boolean;
}): JSX.Element {
  return (
    <article
      className="line catalog-card"
      aria-label={`Рядок ${String(line.line_no)}`}
    >
      <strong className="catalog-raw">
        {line.line_no}. {line.raw_text ?? "—"}
      </strong>
      <span className="badge">{lineStatusLabels[line.status]}</span>
      <small>{sourceQuantity(line)}</small>
      {line.same_text_lines > 1 && (
        <small>
          Такий самий рядок у списку — {line.same_text_lines} разів: це може
          бути по рядку на кожну одиницю, або помилка переписування.
        </small>
      )}
      {line.status === "RESOLVED" && (
        <>
          {line.allocations.map((a) => (
            <small key={`${a.product_variant_id}:${a.size_id}`}>
              → {a.display_name ?? "товар"}, {sizeText(a.size_code)} ×{" "}
              {a.quantity}
            </small>
          ))}
          {line.quantity_basis && (
            <small>Звідки кількість: {basisLabels[line.quantity_basis]}</small>
          )}
          {line.resolution_note && (
            <small>Примітка: {line.resolution_note}</small>
          )}
        </>
      )}
      {line.status === "SKIPPED" && line.resolution_note && (
        <small>Не товар: {line.resolution_note}</small>
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
  blocked,
  done,
  cancel,
}: {
  line: ListLine;
  list: StockList;
  store: Store;
  token: string;
  scopeKey: string;
  sizes: SizeOption[];
  blocked: boolean;
  done: () => void;
  cancel: () => void;
}): JSX.Element {
  const stated =
    line.quantity_state === "KNOWN" && line.quantity_total !== null;
  const allowed: Basis[] = [
    ...(stated ? (["STATED"] as const) : []),
    ...(line.may_imply_one ? (["LINE_IMPLIES_ONE"] as const) : []),
    "RECOUNTED",
    "OWNER_KNOWLEDGE",
  ];
  // The parser's one size, if it read exactly one, is where to start.
  const readSize =
    line.candidates.size?.length === 1 ? line.candidates.size[0] : undefined;
  const startSize = sizes.find((s) => s.code === readSize)?.size_id ?? "";
  const [basis, setBasis] = useState<Basis | "SKIP" | "">(
    stated ? "STATED" : line.may_imply_one ? "LINE_IMPLIES_ONE" : "",
  );
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
  const complete =
    basis === "SKIP"
      ? reason.trim() !== ""
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
        `/snapshots/${list.snapshot_id}/lines/${String(line.line_no)}`,
        token,
        body,
        undefined,
        "PUT",
      );
      done();
    } catch (error) {
      setProblem(
        !(error instanceof ApiError)
          ? "Немає відповіді сервера. Натисніть ще раз — повторна відповідь безпечна."
          : error.code === "SNAPSHOT_CONFLICT"
            ? "Список уже затвердили або відхилили — відповідь не збережено."
            : error.code === "NOT_FOUND"
              ? "Товар або розмір більше недоступний. Оберіть інший."
              : errorText(error),
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
        {line.line_no}. {line.raw_text ?? "—"}
      </strong>
      <small>{sourceQuantity(line)}</small>
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
      {line.quantity_state !== "KNOWN" && !line.may_imply_one && (
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
                  initialSearch={line.candidates.concept?.[0] ?? ""}
                  onVariant={(variant) => {
                    update(index, { variant, picking: variant === null });
                  }}
                />
              ) : (
                <div className="fields">
                  <span>{part.variant.display_name}</span>
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
              <div className="fields">
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
                        {size.code}
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

function Approval({
  list,
  token,
  warehouse,
  blocked,
  refresh,
}: {
  list: StockList;
  token: string;
  warehouse: string;
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
        `/snapshots/${list.snapshot_id}/${action}`,
        token,
        action === "approve"
          ? { expected_review_revision: list.review_revision }
          : { reason: reason.trim() },
      );
    } catch (error) {
      const reasonCode =
        error instanceof ApiError ? error.details.reason : undefined;
      setProblem(
        !(error instanceof ApiError)
          ? "Немає відповіді сервера. Оновіть список і подивіться, чи рішення збережено."
          : error.code === "OPENING_BALANCE_CONFLICT"
            ? `У складі «${warehouse}» уже був рух товару, тому початковий залишок туди внести не можна. Відхиліть цей список, а відсутній товар прийміть через «Приймання».`
            : reasonCode === "REVISION_CHANGED"
              ? "Поки ви дивились, хтось змінив відповідь у списку. Перегляньте підсумок ще раз."
              : reasonCode === "ROWS_NEED_REVIEW"
                ? "Ще не всі рядки розібрано."
                : reasonCode === "ALREADY_DECIDED"
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
    <div className="notice" aria-label="Затвердження списку">
      <h3>Затвердження</h3>
      <p>
        Стане початковим залишком складу «{warehouse}»:{" "}
        <strong>{list.summary.units} од.</strong>
      </p>
      {bases.length > 0 && (
        <ul>
          {bases.map((basis) => (
            <li key={basis}>
              {basisLabels[basis]}: рядків {list.summary.lines_by_basis[basis]},
              одиниць {list.summary.units_by_basis[basis]}
            </li>
          ))}
        </ul>
      )}
      {list.summary.lines_differing_from_source > 0 && (
        <p>
          Рядків, де відповідь відрізняється від списку:{" "}
          {list.summary.lines_differing_from_source}
        </p>
      )}
      {waiting > 0 && (
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
          <button
            disabled={!list.ready_to_approve || busy || blocked}
            onClick={() => {
              setAsking("approve");
            }}
          >
            Затвердити список
          </button>
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
