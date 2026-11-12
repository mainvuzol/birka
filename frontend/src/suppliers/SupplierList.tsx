import { useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api, refusedWrite, isConflict } from "@/shared/api";
import { Back } from "@/shared/Back";
import { Icon } from "@/shared/Icon";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { SearchField } from "@/shared/SearchField";
import { Sheet } from "@/shared/Sheet";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import { buzz } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { Empty } from "@/shared/Empty";
import type { Store } from "@/orders/types";
import { matching, useSuppliers } from "./Picker";
import type { Supplier } from "./types";

/**
 * «Список постачальників» (stage 2, money task list, P0-4): the network's
 * suppliers, a search over their names and phones, a row each — the name,
 * its phone under it. A tap opens «Змінити постачальника»: its name and
 * phone, «Зберегти». None is ever deleted (owner decision, 2026-10-01): a
 * supplier's returns and invoices keep it.
 */
export function SupplierList({
  store,
  token,
  back,
}: {
  store: Store;
  token: string;
  /** «← Постачальникам». */
  back: () => void;
}): JSX.Element {
  const suppliers = useSuppliers(store, token);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Supplier | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const found = matching(suppliers.data ?? [], query);
  return (
    <>
      <ScreenHeader
        ref={title}
        focusable
        title="Список постачальників"
        back={
          <Back go={back}>
            <span aria-hidden="true">← </span>
            Постачальникам
          </Back>
        }
      />
      <section className="supplier-list-screen">
        {/* The search stands as the list is read, over its rows' places:
          nothing moves when they come (money task list after stage 2,
          P1-3). */}
        {(suppliers.isPending || (suppliers.data?.length ?? 0) > 0) && (
          <SearchField
            label="Пошук постачальника"
            placeholder="Пошук постачальника"
            value={query}
            change={setQuery}
            inputRef={field}
          />
        )}
        {suppliers.isPending ? (
          <Placeholder
            said="Завантажуємо постачальників…"
            rows={3}
            day={false}
            rowShape={{ list: "supplier-rows", row: "supplier-row" }}
          />
        ) : suppliers.data === undefined ? (
          <Unread
            error={suppliers.error}
            retry={() => {
              void suppliers.refetch();
            }}
          />
        ) : suppliers.data.length === 0 ? (
          <Empty
            title="Постачальників ще немає."
            meta="Нового додають у полі «Постачальник» — там, де його обирають."
          />
        ) : (
          <>
            <ul className="supplier-rows" aria-label="Постачальники">
              {found.map((supplier) => (
                <li key={supplier.id}>
                  <button
                    type="button"
                    className="supplier-row"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setEditing(supplier);
                    }}
                  >
                    <span className="supplier-row-main">
                      <span className="t-row">{visible(supplier.name)}</span>
                      {supplier.phone && (
                        <span className="t-meta">
                          {visible(supplier.phone)}
                        </span>
                      )}
                    </span>
                    <Icon name="chevron-right" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            {query.trim() !== "" && found.length === 0 && (
              <p className="t-meta" role="status">
                Нічого не знайшли за «{visible(query.trim())}»
              </p>
            )}
          </>
        )}
      </section>
      {editing && (
        <SupplierEdit
          key={editing.id}
          store={store}
          token={token}
          supplier={editing}
          fallback={title}
          close={() => {
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** «Змінити постачальника»: its name and phone, «Зберегти»; a name the list
 * holds already is said, never saved twice. */
function SupplierEdit({
  store,
  token,
  supplier,
  fallback,
  close,
}: {
  store: Store;
  token: string;
  supplier: Supplier;
  fallback: RefObject<HTMLElement>;
  close: () => void;
}): JSX.Element {
  const cache = useQueryClient();
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await api(
        `/suppliers/${supplier.id}`,
        token,
        { store_id: store.id, name: name.trim(), phone: phone.trim() || null },
        undefined,
        "PUT",
      );
      buzz("success");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["suppliers", store.id] }),
        cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
        cache.invalidateQueries({ queryKey: ["supplier-invoices", store.id] }),
      ]);
      close();
    } catch (error) {
      buzz("error");
      if (isConflict(error))
        await cache.invalidateQueries({ queryKey: ["suppliers", store.id] });
      setProblem(
        error instanceof ApiError && error.details.reason === "DUPLICATE"
          ? `«${visible(String(error.details.name))}» уже є у списку.`
          : refusedWrite(
              error,
              "Постачальника не збережено.",
              "Перевірте назву й телефон.",
              "Постачальника не збережено: дані змінилися — перегляньте їх.",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Змінити постачальника"
      close={() => {
        if (!busy) close();
      }}
      fallback={fallback}
      foot={
        <button
          type="button"
          className="sheet-done primary"
          disabled={busy || name.trim() === ""}
          onClick={() => {
            void save();
          }}
        >
          Зберегти
        </button>
      }
    >
      <label>
        Назва
        <input
          value={name}
          maxLength={200}
          disabled={busy}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
        />
      </label>
      <label>
        Телефон
        <input
          value={phone}
          maxLength={40}
          inputMode="tel"
          disabled={busy}
          onChange={(event) => {
            setPhone(event.target.value);
            setProblem(null);
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
    </Sheet>
  );
}
