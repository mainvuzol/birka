import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, api, errorText, inOwnWords } from "@/shared/api";
import type { Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import type { Supplier } from "./types";

/** The network's suppliers, as whoever returns goods in this store sees them. */
export function useSuppliers(
  store: Store,
  token: string,
): UseQueryResult<Supplier[]> {
  return useQuery({
    queryKey: ["suppliers", store.id],
    queryFn: () => api<Supplier[]>(`/suppliers?store_id=${store.id}`, token),
    retry: false,
  });
}

/**
 * A supplier picked from the network's list, or added on the spot (owner
 * decision, 2026-10-01). A name already on the list is never added twice:
 * the server answers with that supplier, and it is picked instead.
 */
export function SupplierPicker({
  store,
  token,
  value,
  change,
  disabled,
}: {
  store: Store;
  token: string;
  value: string;
  change: (supplierId: string) => void;
  disabled: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  const suppliers = useSuppliers(store, token);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(): Promise<void> {
    setBusy(true);
    setNote(null);
    try {
      const added = await api<Supplier>("/suppliers", token, {
        store_id: store.id,
        name: name.trim(),
        phone: phone.trim() || null,
      });
      await cache.invalidateQueries({ queryKey: ["suppliers", store.id] });
      change(added.id);
      setAdding(false);
      setName("");
      setPhone("");
    } catch (error) {
      if (error instanceof ApiError && error.details.reason === "DUPLICATE") {
        await cache.invalidateQueries({ queryKey: ["suppliers", store.id] });
        change(String(error.details.supplier_id));
        setAdding(false);
        setNote(
          `«${visible(String(error.details.name))}» уже є у списку — обрано його.`,
        );
      } else
        setNote(
          inOwnWords(
            errorText(error),
            "Постачальника не додано. Перевірте назву й телефон та спробуйте ще раз.",
            "Постачальника не додано: дані змінилися — спробуйте ще раз.",
          ),
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="supplier-picker">
      <label>
        Постачальник
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => {
            change(event.target.value);
          }}
        >
          <option value="">Оберіть постачальника</option>
          {(suppliers.data ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {visible(supplier.name)}
              {supplier.phone ? ` · ${visible(supplier.phone)}` : ""}
            </option>
          ))}
        </select>
      </label>
      {suppliers.error && <p role="alert">{errorText(suppliers.error)}</p>}
      {adding ? (
        <fieldset disabled={disabled || busy}>
          <legend>Новий постачальник</legend>
          <label>
            Назва постачальника
            <input
              value={name}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <label>
            Телефон (необов’язково)
            <input
              value={phone}
              maxLength={40}
              inputMode="tel"
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              disabled={name.trim() === ""}
              onClick={() => {
                void add();
              }}
            >
              Додати постачальника
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setAdding(false);
              }}
            >
              Скасувати
            </button>
          </div>
        </fieldset>
      ) : (
        <button
          type="button"
          className="quiet"
          disabled={disabled}
          onClick={() => {
            setNote(null);
            setAdding(true);
          }}
        >
          + Новий постачальник
        </button>
      )}
      {note && <p role="status">{note}</p>}
    </div>
  );
}
