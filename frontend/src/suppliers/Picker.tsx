import { useEffect, useId, useRef, useState } from "react";
import type {
  Dispatch,
  JSX,
  ReactNode,
  RefObject,
  SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, api, errorText, inOwnWords } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import type { Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { Icon } from "@/shared/Icon";
import { SearchField } from "@/shared/SearchField";
import { Sheet } from "@/shared/Sheet";
import { buzz } from "@/shared/telegram";
import type { Supplier } from "./types";

/** The network's suppliers, as whoever returns goods in this store sees them. */
export function useSuppliers(
  store: Store,
  token: string,
  enabled = true,
): UseQueryResult<Supplier[]> {
  return useQuery({
    queryKey: ["suppliers", store.id],
    queryFn: () => api<Supplier[]>(`/suppliers?store_id=${store.id}`, token),
    enabled,
    retry: false,
  });
}

/** «+ Новий постачальник» as it is being typed. */
export interface SupplierDraft {
  adding: boolean;
  name: string;
  phone: string;
}

export const noSupplierDraft: SupplierDraft = {
  adding: false,
  name: "",
  phone: "",
};

/** The suppliers whose name or phone holds every word typed, as the till's
 * search takes them; all of them while nothing is typed. */
export function matching(suppliers: Supplier[], query: string): Supplier[] {
  const words = query.toLocaleLowerCase("uk").split(/\s+/).filter(Boolean);
  return suppliers.filter((supplier) => {
    const phone = supplier.phone ?? "";
    const text =
      `${supplier.name} ${phone} ${phone.replace(/\D/g, "")}`.toLocaleLowerCase(
        "uk",
      );
    return words.every((word) => text.includes(word));
  });
}

/**
 * The field a supplier is chosen by (stage 2, money task list, P0-3): its
 * name over a field 52 high, as the search's, the supplier chosen — «Ганна ·
 * 067 000 12 34 ›» — or «Оберіть ›». A tap opens the sheet «Постачальник»;
 * inside another sheet the list opens in place, never a sheet over a sheet.
 * A filter's name is a reader's alone, as the search's: «Усі постачальники
 * ›» says what it is.
 */
function PickField({
  label,
  labelShown = true,
  shown,
  disabled,
  opener,
  inPlace,
  open,
  toggle,
}: {
  label: string;
  labelShown?: boolean;
  shown: ReactNode;
  disabled: boolean;
  opener: RefObject<HTMLButtonElement>;
  /** Its list opens under it, not in a sheet. */
  inPlace: boolean;
  open: boolean;
  toggle: () => void;
}): JSX.Element {
  const labelId = useId();
  const shownId = useId();
  return (
    <div className="pick-field">
      <span
        className={labelShown ? "pick-label" : "visually-hidden"}
        id={labelId}
      >
        {label}
      </span>
      <button
        type="button"
        ref={opener}
        className="pick-value"
        aria-labelledby={`${labelId} ${shownId}`}
        {...(inPlace
          ? { "aria-expanded": open }
          : { "aria-haspopup": "dialog" })}
        disabled={disabled}
        onClick={toggle}
      >
        <span id={shownId} className="pick-shown">
          {shown}
        </span>
        <Icon
          name={inPlace && open ? "chevron-up" : "chevron-right"}
          size={20}
        />
      </button>
    </div>
  );
}

/** One supplier on the list (spec §6.8): the name, under it its meta; the
 * one chosen marked. */
function SupplierRow({
  name,
  meta,
  chosen,
  disabled,
  pick,
}: {
  name: string;
  meta: string | null;
  chosen: boolean;
  disabled: boolean;
  pick: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        className="supplier-row"
        aria-current={chosen ? "true" : undefined}
        disabled={disabled}
        onClick={pick}
      >
        <span className="supplier-row-main">
          <span className="t-row">{name}</span>
          {meta !== null && <span className="t-meta">{meta}</span>}
        </span>
        {chosen && <Icon name="check" size={20} />}
      </button>
    </li>
  );
}

/**
 * The search over the network's suppliers and their rows, in the sheet or
 * in place: what is typed matches each word of a name or a phone. `first`,
 * a row over them — «Усі постачальники»; `foot`, what stands under them.
 */
function SupplierList({
  suppliers,
  query,
  search,
  value,
  metaOf,
  first,
  disabled,
  pick,
  foot,
}: {
  suppliers: UseQueryResult<Supplier[]>;
  query: string;
  search: (text: string) => void;
  value: string;
  metaOf: (supplier: Supplier) => string | null;
  first?: ReactNode;
  disabled: boolean;
  pick: (supplier: Supplier) => void;
  foot?: ReactNode;
}): JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const found = matching(suppliers.data ?? [], query);
  return (
    <div className="supplier-list">
      <SearchField
        label="Пошук постачальника"
        placeholder="Пошук постачальника"
        value={query}
        change={search}
        inputRef={field}
        autoFocus
      />
      {suppliers.isPending ? (
        <p role="status">Завантажуємо постачальників…</p>
      ) : suppliers.error ? (
        <Unread
          error={suppliers.error}
          retry={() => {
            void suppliers.refetch();
          }}
        />
      ) : (
        <>
          <ul className="supplier-rows">
            {first}
            {found.map((supplier) => (
              <SupplierRow
                key={supplier.id}
                name={visible(supplier.name)}
                meta={metaOf(supplier)}
                chosen={supplier.id === value}
                disabled={disabled}
                pick={() => {
                  pick(supplier);
                }}
              />
            ))}
          </ul>
          {query.trim() !== "" && found.length === 0 && (
            <p className="t-meta" role="status">
              Нічого не знайшли за «{visible(query.trim())}»
            </p>
          )}
        </>
      )}
      {foot}
    </div>
  );
}

/** «Ганна · 067 000 12 34». */
function named(supplier: Supplier): string {
  return supplier.phone
    ? `${visible(supplier.name)} · ${visible(supplier.phone)}`
    : visible(supplier.name);
}

/**
 * A supplier picked from the network's list, or added on the spot (owner
 * decision, 2026-10-01; stage 2, money task list, P0-3): the field opens
 * the sheet «Постачальник» — a search with the cursor in it, a row a
 * supplier, and «+ Новий постачальник», or «+ Новий постачальник «Ганна»»
 * for a name typed and not found, which opens its name and phone in the
 * sheet. Nothing is chosen beforehand, nothing remembered. A name already
 * on the list is never added twice: the server answers with that supplier,
 * and it is picked instead. Inside another sheet («Як надійшов») the list
 * opens in place.
 */
export function SupplierPicker({
  store,
  token,
  value,
  change,
  disabled,
  kept,
  inPlace = false,
  next,
  sheetOpen,
}: {
  store: Store;
  token: string;
  value: string;
  change: (supplierId: string) => void;
  disabled: boolean;
  /** The new supplier as typed, kept by a screen whose sheet may close
   * before it is added («Прийшов товар»'s «Як надійшов»). */
  kept?: [SupplierDraft, Dispatch<SetStateAction<SupplierDraft>>];
  /** Inside a sheet already: the list opens under the field. */
  inPlace?: boolean;
  /** Where the cursor goes once a supplier is picked: the sum next. */
  next?: RefObject<HTMLElement>;
  /** Its own sheet open, and closed again: the screen's MainButton waits
   * under it — one main a screen (frame P1-1; review). */
  sheetOpen?: (open: boolean) => void;
}): JSX.Element {
  const cache = useQueryClient();
  const suppliers = useSuppliers(store, token);
  const own = useState(noSupplierDraft);
  const [draft, setDraft] = kept ?? own;
  const { adding, name, phone } = draft;
  // A new supplier begun and kept: its fields are where it was left.
  const [open, setOpen] = useState(inPlace && adding);
  const [query, setQuery] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // Picked: the cursor where the screen goes on, once the sheet is gone.
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    if (picked > 0) next?.current?.focus();
  }, [picked, next]);
  const chosen = suppliers.data?.find((supplier) => supplier.id === value);
  useEffect(() => {
    if (inPlace || !open || !sheetOpen) return;
    sheetOpen(true);
    return () => {
      sheetOpen(false);
    };
  }, [inPlace, open, sheetOpen]);

  function close(): void {
    setOpen(false);
    setQuery("");
    setProblem(null);
    // Closed, nothing is remembered (spec §6.29): a new supplier begun is
    // kept only by a screen that keeps it.
    if (!kept) setDraft(noSupplierDraft);
  }

  function take(id: string): void {
    change(id);
    close();
    setPicked((count) => count + 1);
  }

  async function add(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      const added = await api<Supplier>("/suppliers", token, {
        store_id: store.id,
        name: name.trim(),
        phone: phone.trim() || null,
      });
      await cache.invalidateQueries({ queryKey: ["suppliers", store.id] });
      setDraft(noSupplierDraft);
      buzz("success");
      take(added.id);
    } catch (error) {
      if (error instanceof ApiError && error.details.reason === "DUPLICATE") {
        await cache.invalidateQueries({ queryKey: ["suppliers", store.id] });
        setDraft((now) => ({ ...now, adding: false }));
        setSaid(
          `«${visible(String(error.details.name))}» уже є у списку — обрано його.`,
        );
        take(String(error.details.supplier_id));
      } else
        setProblem(
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

  const typed = query.trim();
  const none =
    typed !== "" && matching(suppliers.data ?? [], query).length === 0;
  const adder = (
    <button
      type="button"
      className="quiet supplier-add"
      disabled={disabled}
      onClick={() => {
        setProblem(null);
        setDraft((now) => ({
          ...now,
          adding: true,
          // What was typed and not found is the new one's name.
          name: none ? typed : now.name,
        }));
      }}
    >
      <Icon name="plus" size={20} />
      {none ? `Новий постачальник «${typed}»` : "Новий постачальник"}
    </button>
  );
  const addButton = (
    <button
      type="button"
      // In a sheet already, whose foot or MainButton is its main: the
      // secondary (audit after stage 2, frame P1-1; review).
      className={inPlace ? undefined : "sheet-done primary"}
      disabled={disabled || busy || name.trim() === ""}
      onClick={() => {
        void add();
      }}
    >
      Додати постачальника
    </button>
  );
  const fields = (
    <fieldset className="supplier-new" disabled={disabled || busy}>
      <legend className="visually-hidden">Новий постачальник</legend>
      <label>
        Назва постачальника
        <input
          // Opened by a tap: the keyboard comes with it (iOS).
          autoFocus
          value={name}
          maxLength={200}
          enterKeyHint="next"
          onChange={(event) => {
            const text = event.target.value;
            setDraft((now) => ({ ...now, name: text }));
          }}
        />
      </label>
      <label>
        Телефон (необов’язково)
        <input
          value={phone}
          maxLength={40}
          inputMode="tel"
          enterKeyHint="done"
          onChange={(event) => {
            const text = event.target.value;
            setDraft((now) => ({ ...now, phone: text }));
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      {inPlace && addButton}
      <button
        type="button"
        className="quiet"
        onClick={() => {
          setProblem(null);
          setDraft((now) => ({ ...now, adding: false }));
        }}
      >
        Скасувати
      </button>
    </fieldset>
  );
  const list = adding ? (
    fields
  ) : (
    <SupplierList
      suppliers={suppliers}
      query={query}
      search={setQuery}
      value={value}
      metaOf={(supplier) => (supplier.phone ? visible(supplier.phone) : null)}
      disabled={disabled}
      pick={(supplier) => {
        buzz("selection");
        take(supplier.id);
      }}
      foot={adder}
    />
  );
  return (
    <div className="supplier-picker">
      <PickField
        label="Постачальник"
        shown={chosen ? named(chosen) : "Оберіть"}
        disabled={disabled}
        opener={opener}
        inPlace={inPlace}
        open={open}
        toggle={() => {
          setSaid(null);
          if (open) close();
          else setOpen(true);
        }}
      />
      {said && <p role="status">{said}</p>}
      {open &&
        (inPlace ? (
          <div className="supplier-in-place">{list}</div>
        ) : (
          <Sheet
            title="Постачальник"
            // Never closed while a new one is being added: once added, it
            // is picked.
            close={() => {
              if (!busy) close();
            }}
            fallback={opener}
            {...(adding ? { foot: addButton } : {})}
          >
            {list}
          </Sheet>
        ))}
    </div>
  );
}

/**
 * The supplier a list is narrowed to (stage 2, money task list, P0-1,
 * P0-3): «Усі постачальники ›» or «Ганна ›», its sheet the same search
 * with «Усі постачальники» first and nothing to add. `metaOf`, what each
 * row says under its name: «винні 20 000,00 грн · 2 накладні» in
 * «Накладні», the phone elsewhere.
 */
export function SupplierFilter({
  store,
  token,
  value,
  change,
  disabled,
  metaOf,
}: {
  store: Store;
  token: string;
  value: string;
  change: (supplierId: string) => void;
  disabled: boolean;
  metaOf?: (supplier: Supplier) => string | null;
}): JSX.Element {
  const suppliers = useSuppliers(store, token);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const chosen = suppliers.data?.find((supplier) => supplier.id === value);
  function take(id: string): void {
    if (id !== value) {
      buzz("selection");
      change(id);
    }
    setOpen(false);
    setQuery("");
  }
  return (
    <div className="supplier-picker">
      <PickField
        label="Постачальник"
        labelShown={false}
        shown={
          value === ""
            ? "Усі постачальники"
            : chosen
              ? visible(chosen.name)
              : "Оберіть"
        }
        disabled={disabled}
        opener={opener}
        inPlace={false}
        open={open}
        toggle={() => {
          setOpen(true);
        }}
      />
      {open && (
        <Sheet
          title="Постачальник"
          close={() => {
            setOpen(false);
            setQuery("");
          }}
          fallback={opener}
        >
          <SupplierList
            suppliers={suppliers}
            query={query}
            search={setQuery}
            value={value}
            metaOf={
              metaOf ??
              ((supplier) => (supplier.phone ? visible(supplier.phone) : null))
            }
            first={
              query.trim() === "" && (
                <SupplierRow
                  name="Усі постачальники"
                  meta={null}
                  chosen={value === ""}
                  disabled={disabled}
                  pick={() => {
                    take("");
                  }}
                />
              )
            }
            disabled={disabled}
            pick={(supplier) => {
              take(supplier.id);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
