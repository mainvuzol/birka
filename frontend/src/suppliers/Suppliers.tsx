import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import { money } from "@/orders/types";
import type { StockOption, Store } from "@/orders/types";
import { useBackOnSale } from "@/returns/places";
import {
  resolveReturnToSupplier,
  submitReturnToSupplier,
  useReturnToSupplier,
} from "./commands";
import { Borrowed } from "./Borrowed";
import { SupplierPicker, useSuppliers } from "./Picker";
import type { ReturnPage, Supplier, SupplierReturn } from "./types";

const pageSize = 20;

/**
 * Goods returned to a supplier (owner decisions, 2026-10-01).
 *
 * The owner and managers send goods back from a warehouse — one document
 * with a list — to a supplier picked from the network's list or added on
 * the spot. Only the goods are recorded. A return is cancelled whole, once,
 * saying why, and its goods come back where they left. A confirmed unit
 * from «Брак» goes back from «Брак»; it is listed here too, and cancelled
 * through «Брак».
 */
export function Suppliers({
  store,
  token,
  journalKey,
  invoiceJournalKey,
  blocked,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** The invoices' journal, through which borrowed goods are marked sold. */
  invoiceJournalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, error } = useReturnToSupplier();
  const [making, setMaking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [shown, setShown] = useState(pageSize);
  const suppliers = useSuppliers(store, token);
  const returns = useQuery({
    queryKey: ["supplier-returns", store.id, supplierId, shown],
    queryFn: () =>
      api<ReturnPage>(
        `/supplier-returns?store_id=${store.id}&limit=${String(shown)}${
          supplierId ? `&supplier_id=${supplierId}` : ""
        }`,
        token,
      ),
    retry: false,
  });
  const working = busy || pending !== null;

  async function settled(result: SupplierReturn): Promise<void> {
    setMaking(false);
    setDone(
      `Повернено постачальнику «${result.supplier.name}»: ${String(
        result.lines.reduce((units, line) => units + line.quantity, 0),
      )} од.`,
    );
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
      cache.invalidateQueries({ queryKey: ["stock", store.id] }),
    ]);
  }

  return (
    <section>
      <div className="toolbar">
        <h2>Постачальникам</h2>
        <button
          className="quiet"
          disabled={returns.isFetching}
          onClick={() => {
            void returns.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        Товар, повернений постачальнику: непроданий зі складу або брак із
        розділу «Брак». Скільки постачальник за нього зарахував, записують
        заліком у «Накладних».
      </p>
      {pending && (
        <section className="notice">
          <h3>{busy ? "Перевіряємо повернення…" : "Незавершене повернення"}</h3>
          <p>
            Невідомо, чи записано повернення постачальнику. Перевірте результат
            — те саме повернення не запишеться двічі.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              void resolveReturnToSupplier(journalKey, token, pending).then(
                (outcome) => {
                  if (outcome.kind === "done") void settled(outcome.result);
                  else if (outcome.kind === "refused")
                    setDone(refusalText(outcome.error));
                },
              );
            }}
          >
            Перевірити результат повернення
          </button>
        </section>
      )}
      {error instanceof Error && !(error instanceof ApiError) && (
        <p role="alert">{error.message}</p>
      )}
      {done && <p role="status">{done}</p>}
      {making ? (
        <NewReturn
          store={store}
          token={token}
          disabled={blocked || working}
          cancel={() => {
            setMaking(false);
          }}
          send={async (body) => {
            setDone(null);
            const outcome = await submitReturnToSupplier(journalKey, token, {
              // A new transport key per attempt; the return's identity is
              // `command_id`, which is what makes a late retry safe.
              key: crypto.randomUUID(),
              body,
            });
            if (outcome.kind === "done") await settled(outcome.result);
            else if (outcome.kind === "refused")
              return refusalText(outcome.error);
            return null;
          }}
        />
      ) : (
        <button
          disabled={blocked || working}
          onClick={() => {
            setDone(null);
            setMaking(true);
          }}
        >
          + Повернути товар постачальнику
        </button>
      )}
      <label>
        Постачальник у списку
        <select
          value={supplierId}
          onChange={(event) => {
            setSupplierId(event.target.value);
            setShown(pageSize);
          }}
        >
          <option value="">Усі постачальники</option>
          {(suppliers.data ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      {returns.isPending ? (
        <p role="status">Завантажуємо повернення…</p>
      ) : returns.error ? (
        <p role="alert">{errorText(returns.error)}</p>
      ) : returns.data.items.length === 0 ? (
        <p>Цей магазин ще нічого не повертав постачальникам.</p>
      ) : (
        <>
          {returns.data.items.map((item) => (
            <ReturnCard
              key={item.id}
              item={item}
              token={token}
              disabled={blocked || working}
              changed={() => {
                void Promise.all([
                  cache.invalidateQueries({
                    queryKey: ["supplier-returns", store.id],
                  }),
                  cache.invalidateQueries({ queryKey: ["stock", store.id] }),
                  cache.invalidateQueries({
                    queryKey: ["damaged-units", store.id],
                  }),
                ]);
              }}
            />
          ))}
          {returns.data.has_more && (
            <button
              className="quiet"
              disabled={returns.isFetching}
              onClick={() => {
                setShown(shown + pageSize);
              }}
            >
              Показати ще
            </button>
          )}
        </>
      )}
      <Borrowed
        store={store}
        token={token}
        journalKey={journalKey}
        invoiceJournalKey={invoiceJournalKey}
        blocked={blocked || working}
      />
      <SupplierList
        store={store}
        token={token}
        suppliers={suppliers.data ?? []}
      />
    </section>
  );
}

function NewReturn({
  store,
  token,
  disabled,
  cancel,
  send,
}: {
  store: Store;
  token: string;
  disabled: boolean;
  cancel: () => void;
  send: (body: {
    command_id: string;
    store_id: string;
    location_id: string;
    supplier_id: string;
    lines: { product_variant_id: string; size_id: string; quantity: number }[];
    note: string | null;
  }) => Promise<string | null>;
}): JSX.Element {
  const places = useBackOnSale(store, token, true);
  const [location, setLocation] = useState("");
  const [supplier, setSupplier] = useState("");
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const stock = useQuery({
    queryKey: ["stock-options", store.id, location, offset],
    queryFn: () =>
      api<{ items: StockOption[]; has_more: boolean }>(
        `/catalog/stock-options?store_id=${store.id}&location_id=${location}&limit=100&offset=${String(offset)}`,
        token,
      ),
    enabled: location !== "",
    retry: false,
  });
  const key = (option: StockOption): string =>
    `${option.product_variant_id}:${option.size_id}`;
  const options = (stock.data?.items ?? []).filter(
    (option) =>
      option.available_quantity > 0 &&
      option.display_name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const chosen = Object.entries(counts)
    .map(([id, count]) => ({ id, quantity: Number(count) }))
    .filter((line) => Number.isInteger(line.quantity) && line.quantity > 0);
  const units = chosen.reduce((sum, line) => sum + line.quantity, 0);

  function submit(): void {
    setProblem(null);
    if (!location || !supplier) {
      setProblem("Оберіть склад і постачальника.");
      return;
    }
    if (chosen.length === 0) {
      setProblem("Вкажіть, скільки чого повертаєте.");
      return;
    }
    const all = stock.data?.items ?? [];
    for (const line of chosen) {
      const option = all.find((item) => key(item) === line.id);
      if (option && line.quantity > option.available_quantity) {
        setProblem(
          `${option.display_name}, ${option.size_label}: вільно лише ${String(option.available_quantity)} од.`,
        );
        return;
      }
    }
    void send({
      // Its permanent name (I20). A resend after a lost answer comes from
      // the journal, which keeps this one; a refused attempt wrote nothing.
      command_id: crypto.randomUUID(),
      store_id: store.id,
      location_id: location,
      supplier_id: supplier,
      lines: chosen.map((line) => {
        const [variant = "", size = ""] = line.id.split(":");
        return {
          product_variant_id: variant,
          size_id: size,
          quantity: line.quantity,
        };
      }),
      note: note.trim() || null,
    }).then((refusal) => {
      if (refusal) setProblem(refusal);
    });
  }

  return (
    <fieldset disabled={disabled}>
      <legend>Нове повернення постачальнику</legend>
      <label>
        Склад
        <select
          value={location}
          onChange={(event) => {
            setLocation(event.target.value);
            setOffset(0);
            setCounts({});
          }}
        >
          <option value="">Оберіть склад</option>
          {(places.data ?? []).map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </select>
      </label>
      <SupplierPicker
        store={store}
        token={token}
        value={supplier}
        change={setSupplier}
        disabled={disabled}
      />
      {location && (
        <>
          <label>
            Пошук моделі
            <input
              type="search"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
            />
          </label>
          {stock.isPending ? (
            <p role="status">Завантажуємо залишки…</p>
          ) : stock.error ? (
            <p role="alert">{errorText(stock.error)}</p>
          ) : options.length === 0 ? (
            <p>На цьому складі немає вільного товару.</p>
          ) : (
            <ul aria-label="Товар на складі">
              {options.map((option) => (
                <li key={key(option)}>
                  <label>
                    {option.display_name}, {option.size_label} · вільно{" "}
                    {option.available_quantity}
                    <input
                      inputMode="numeric"
                      aria-label={`Повернути: ${option.display_name}, ${option.size_label}`}
                      value={counts[key(option)] ?? ""}
                      placeholder="0"
                      onChange={(event) => {
                        setCounts({
                          ...counts,
                          [key(option)]: event.target.value.replace(/\D/g, ""),
                        });
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          )}
          {stock.data?.has_more && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setOffset(offset + 100);
              }}
            >
              Наступні товари
            </button>
          )}
        </>
      )}
      <label>
        Примітка (необов’язково)
        <textarea
          value={note}
          maxLength={1000}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button type="button" disabled={units === 0} onClick={submit}>
          Повернути постачальнику {units > 0 ? `${String(units)} од.` : ""}
        </button>
        <button type="button" className="quiet" onClick={cancel}>
          Скасувати
        </button>
      </div>
    </fieldset>
  );
}

function ReturnCard({
  item,
  token,
  disabled,
  changed,
}: {
  item: SupplierReturn;
  token: string;
  disabled: boolean;
  changed: () => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function undo(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      // A unit from «Брак» comes back through «Брак». Pressed twice, either
      // is answered as it is: a return is cancelled once.
      if (item.damaged_unit_id)
        await api(
          `/damaged-units/${item.damaged_unit_id}/cancel-supplier-return`,
          token,
          { supplier_return_id: item.id, reason: reason.trim() },
        );
      else
        await api(`/supplier-returns/${item.id}/cancel`, token, {
          reason: reason.trim(),
        });
      setAsking(false);
      changed();
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? refusalText(error)
          : "Немає відповіді сервера. Натисніть ще раз — повторне натискання безпечне.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="order-card"
      aria-label={`Повернення ${item.supplier.name} від ${when(item.at)}`}
    >
      <strong>{item.supplier.name}</strong>
      <small>
        {when(item.at)} · {item.damaged_unit_id ? "з «Брак»" : "склад"} «
        {item.location_name}» · {item.by}
      </small>
      <ul aria-label="Що повернули">
        {item.lines.map((line) => (
          <li key={`${line.product_variant_id}:${line.size_id}`}>
            {line.display_name}, {line.size ?? "розмір не вказано"} ×{" "}
            {line.quantity}
          </li>
        ))}
      </ul>
      {item.note && <p className="hint">{item.note}</p>}
      {item.set_offs.length > 0 && (
        <ul aria-label="Зараховано в накладні">
          {item.set_offs.map((setOff) => (
            <li key={setOff.entry_id}>
              Постачальник зарахував {money(setOff.amount)} у накладну ·{" "}
              {when(setOff.at)}
            </li>
          ))}
        </ul>
      )}
      {item.cancelled ? (
        <p className="badge">
          Скасовано {when(item.cancelled.at)} · {item.cancelled.reason} ·{" "}
          {item.cancelled.by}
        </p>
      ) : asking ? (
        <div className="notice">
          <p>
            Товар повернеться {item.damaged_unit_id ? "у «Брак»" : "на склад"} «
            {item.location_name}». Скасувати можна лише раз.
          </p>
          <label>
            Чому скасовуємо
            <textarea
              value={reason}
              maxLength={1000}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
          <div className="actions">
            <button
              disabled={disabled || busy || reason.trim() === ""}
              onClick={() => {
                void undo();
              }}
            >
              Так, скасувати повернення
            </button>
            <button
              className="quiet"
              onClick={() => {
                setAsking(false);
              }}
            >
              Не скасовувати
            </button>
          </div>
        </div>
      ) : item.set_offs.length > 0 ? (
        // The goods stay with the supplier while it counts them (owner
        // decision, 2026-10-01).
        <p className="hint">
          Щоб скасувати повернення, спершу скасуйте залік у «Накладних».
        </p>
      ) : (
        <button
          className="quiet"
          disabled={disabled}
          onClick={() => {
            setProblem(null);
            setAsking(true);
          }}
        >
          Скасувати повернення
        </button>
      )}
      {problem && <p role="alert">{problem}</p>}
    </article>
  );
}

function SupplierList({
  store,
  token,
  suppliers,
}: {
  store: Store;
  token: string;
  suppliers: Supplier[];
}): JSX.Element | null {
  const cache = useQueryClient();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (suppliers.length === 0) return null;

  async function save(): Promise<void> {
    if (!editing) return;
    setProblem(null);
    try {
      await api(
        `/suppliers/${editing.id}`,
        token,
        { store_id: store.id, name: name.trim(), phone: phone.trim() || null },
        undefined,
        "PUT",
      );
      setEditing(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["suppliers", store.id] }),
        cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
      ]);
    } catch (error) {
      setProblem(
        error instanceof ApiError && error.details.reason === "DUPLICATE"
          ? `«${String(error.details.name)}» уже є у списку.`
          : errorText(error),
      );
    }
  }

  return (
    <details>
      <summary>Список постачальників</summary>
      <ul aria-label="Постачальники">
        {suppliers.map((supplier) => (
          <li key={supplier.id}>
            {editing?.id === supplier.id ? (
              <div className="actions">
                <label>
                  Назва
                  <input
                    value={name}
                    maxLength={200}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Телефон
                  <input
                    value={phone}
                    maxLength={40}
                    onChange={(event) => {
                      setPhone(event.target.value);
                    }}
                  />
                </label>
                <button
                  disabled={name.trim() === ""}
                  onClick={() => {
                    void save();
                  }}
                >
                  Зберегти
                </button>
                <button
                  className="quiet"
                  onClick={() => {
                    setEditing(null);
                  }}
                >
                  Скасувати
                </button>
              </div>
            ) : (
              <>
                {supplier.name}
                {supplier.phone && ` · ${supplier.phone}`}{" "}
                <button
                  className="quiet"
                  onClick={() => {
                    setProblem(null);
                    setEditing(supplier);
                    setName(supplier.name);
                    setPhone(supplier.phone ?? "");
                  }}
                >
                  Змінити {supplier.name}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {problem && <p role="alert">{problem}</p>}
    </details>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INSUFFICIENT_STOCK")
      return "Вільного товару вже менше, ніж ви повертаєте: частину могли продати чи забронювати. Оновіть і перевірте кількість.";
    switch (error.details.reason) {
      case "FROM_DAMAGED":
        return "Брак повертають постачальнику з розділу «Брак».";
      case "DUPLICATE_LINE":
        return "Кожну модель і розмір — один раз, з усією кількістю.";
      case "NO_REASON":
        return "Вкажіть, чому скасовуєте.";
      case "SET_OFF":
        return "Постачальник зарахував це повернення в накладну — спершу скасуйте залік у «Накладних».";
    }
  }
  return errorText(error);
}
