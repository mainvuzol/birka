import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import type { Location, Store } from "@/orders/types";
import { submitReceipt, useReceiptCommand } from "./receiptCommands";
import { acquisitionLabels } from "./receiptTypes";
import type {
  Acquisition,
  Receipt,
  ReceiptLine,
  ReceivableVariant,
  SizeOption,
} from "./receiptTypes";

const pageSize = 20;

interface Draft {
  line: ReceiptLine;
  name: string;
  size: string;
}

/**
 * The back door.
 *
 * Differs from the till in what it searches. The till offers what a warehouse
 * holds, because it can only sell that; a delivery is usually of something the
 * shop has run out of, so this screen searches the catalogue instead
 * (`/catalog/receivable-variants`) and offers the organization's sizes.
 * "Size not known" is never among them — goods arrive with a size, and that
 * one enters only from a legacy stock list (ADR-0005 §3).
 *
 * Purchase cost is deliberately not asked for. The API accepts it, but whether
 * a seller should enter or see what the shop paid is a question for the owner,
 * and financial views are a manager's permission today.
 */
export function Receive({
  store,
  token,
  journalKey,
  blocked,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
}): JSX.Element {
  const [locationId, setLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [variant, setVariant] = useState<ReceivableVariant | null>(null);
  const [sizeId, setSizeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [acquisition, setAcquisition] = useState<Acquisition>("PURCHASE");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft[]>([]);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [validation, setValidation] = useState("");
  const [refusal, setRefusal] = useState<unknown>(null);
  const [received, setReceived] = useState<{
    receipt: Receipt;
    names: Draft[];
    warehouse: string;
  } | null>(null);
  const { busy, pending } = useReceiptCommand();

  const locations = useQuery({
    queryKey: ["receive-locations", journalKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  const sizes = useQuery({
    queryKey: ["receive-sizes", journalKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    retry: false,
  });
  const variants = useQuery({
    queryKey: ["receive-variants", journalKey, store.id, asked, offset],
    queryFn: () =>
      api<{ items: ReceivableVariant[]; has_more: boolean }>(
        `/catalog/receivable-variants?store_id=${store.id}&query=${encodeURIComponent(asked ?? "")}&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    enabled: asked !== null,
    retry: false,
  });

  const receivable = (locations.data ?? []).filter(
    (location) => location.is_active && location.can_receive,
  );
  const onlyWarehouse = receivable.length === 1 ? receivable[0] : undefined;

  useEffect(() => {
    // The client choosing among one option is not the server choosing: the
    // same reasoning, and the same boundary, as the till's warehouse.
    if (!locationId && onlyWarehouse) setLocationId(onlyWarehouse.id);
  }, [locationId, onlyWarehouse]);

  useEffect(() => {
    if (
      locationId &&
      locations.isSuccess &&
      !locations.data.some((location) => location.id === locationId)
    )
      setLocationId("");
  }, [locationId, locations.isSuccess, locations.data]);

  // A different list is a different delivery.
  function replaceDraft(next: Draft[]): void {
    setDraft(next);
    setCommandId(crypto.randomUUID());
    setRefusal(null);
  }

  function add(): void {
    const count = Number(quantity);
    const size = sizes.data?.find((option) => option.size_id === sizeId);
    if (
      !variant ||
      !size ||
      !/^\d+$/.test(quantity) ||
      count < 1 ||
      count > 10000
    ) {
      setValidation("Оберіть товар, розмір і кількість від 1 до 10000.");
      return;
    }
    const line: ReceiptLine = {
      product_variant_id: variant.product_variant_id,
      size_id: size.size_id,
      quantity: count,
      acquisition_type: acquisition,
    };
    if (
      draft.some(
        (d) =>
          d.line.product_variant_id === line.product_variant_id &&
          d.line.size_id === line.size_id &&
          d.line.acquisition_type === line.acquisition_type,
      )
    ) {
      setValidation(
        "Цей товар і розмір уже в списку. Приберіть рядок, щоб змінити кількість.",
      );
      return;
    }
    replaceDraft([
      ...draft,
      { line, name: variant.display_name, size: size.code },
    ]);
    setQuantity("1");
    setSizeId("");
    setValidation("");
  }

  async function send(): Promise<void> {
    setRefusal(null);
    const warehouse =
      locations.data?.find((location) => location.id === locationId)?.name ??
      "";
    const trimmed = notes.trim();
    const outcome = await submitReceipt(journalKey, token, {
      // A new transport key per attempt; the delivery's identity is
      // `command_id`, which is what makes a late retry safe (ADR-0006).
      key: crypto.randomUUID(),
      body: {
        store_id: store.id,
        location_id: locationId,
        command_id: commandId,
        lines: draft.map((d) => d.line),
        notes: trimmed ? trimmed : null,
      },
    });
    if (outcome.kind === "received") {
      setReceived({ receipt: outcome.receipt, names: draft, warehouse });
      setDraft([]);
      setNotes("");
      setCommandId(crypto.randomUUID());
    } else if (outcome.kind === "refused") {
      setRefusal(outcome.error);
    }
  }

  const working = busy || pending !== null;
  const units = draft.reduce((sum, d) => sum + d.line.quantity, 0);

  if (received)
    return (
      <section>
        <h2>Товар прийнято</h2>
        <p>
          {received.warehouse} · позицій: {received.receipt.lines.length} ·
          одиниць:{" "}
          {received.receipt.lines.reduce((s, l) => s + l.quantity_received, 0)}
        </p>
        {received.receipt.lines.map((line, index) => (
          <div className="line" key={line.stock_lot_id}>
            <strong>
              {received.names[index]?.name ?? "Товар"} ·{" "}
              {received.names[index]?.size ?? ""}
            </strong>
            <span>
              +{line.quantity_received} · тепер на складі {line.quantity_after}
            </span>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setReceived(null);
          }}
        >
          Прийняти ще
        </button>
      </section>
    );

  return (
    <section>
      <h2>Приймання товару</h2>
      <p className="hint">
        Оберіть склад, куди фізично надійшов товар. Шукайте в каталозі — зокрема
        те, чого зараз немає на складі.
      </p>
      <fieldset disabled={blocked || working}>
        <legend>Поставка</legend>
        {locations.isPending ? (
          <p role="status">Завантажуємо склади…</p>
        ) : locations.error ? (
          <Failure
            error={locations.error}
            retry={() => {
              void locations.refetch();
            }}
          />
        ) : (
          <label>
            Склад
            <select
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
              }}
            >
              {!onlyWarehouse && <option value="">Оберіть склад явно</option>}
              {locations.data.map((location) => (
                <option
                  key={location.id}
                  value={location.id}
                  disabled={!location.is_active || !location.can_receive}
                >
                  {location.name}
                  {!location.is_active
                    ? " — на паузі"
                    : !location.can_receive
                      ? " — без права приймання"
                      : ""}
                </option>
              ))}
            </select>
            {receivable.length === 0 && (
              <span>
                Немає складу, куди цей магазин може приймати товар. Зверніться
                до менеджера.
              </span>
            )}
          </label>
        )}
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setVariant(null);
            setAsked(search.trim());
          }}
        >
          <label>
            Пошук у каталозі
            <input
              value={search}
              placeholder="Модель, джерело або колір"
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </label>
          <button type="submit" className="quiet">
            Знайти
          </button>
        </form>
        {asked !== null &&
          (variants.isPending ? (
            <p role="status">Шукаємо…</p>
          ) : variants.error ? (
            <Failure
              error={variants.error}
              retry={() => {
                void variants.refetch();
              }}
            />
          ) : (
            <>
              {variants.data.items.length === 0 && (
                <p>
                  Нічого не знайдено. Якщо це новий товар, спершу створіть його
                  в каталозі.
                </p>
              )}
              <div role="radiogroup" aria-label="Знайдені товари">
                {variants.data.items.map((item) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={
                      variant?.product_variant_id === item.product_variant_id
                    }
                    key={item.product_variant_id}
                    className={
                      variant?.product_variant_id === item.product_variant_id
                        ? "active"
                        : "quiet"
                    }
                    onClick={() => {
                      setVariant(item);
                    }}
                  >
                    {item.display_name}
                  </button>
                ))}
              </div>
              <div className="toolbar">
                <button
                  type="button"
                  className="quiet"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - pageSize));
                  }}
                >
                  Попередні
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={!variants.data.has_more}
                  onClick={() => {
                    setOffset(offset + pageSize);
                  }}
                >
                  Ще товари
                </button>
              </div>
            </>
          ))}
        {variant && <p className="hint">Обрано: {variant.display_name}</p>}
        <label>
          Розмір
          <select
            value={sizeId}
            onChange={(event) => {
              setSizeId(event.target.value);
            }}
          >
            <option value="">Оберіть розмір</option>
            {(sizes.data ?? []).map((size) => (
              <option key={size.size_id} value={size.size_id}>
                {size.code}
              </option>
            ))}
          </select>
        </label>
        <div className="fields">
          <label>
            Кількість
            <input
              inputMode="numeric"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
              }}
            />
          </label>
          <label>
            Як надійшов
            <select
              value={acquisition}
              onChange={(event) => {
                setAcquisition(event.target.value as Acquisition);
              }}
            >
              {(Object.keys(acquisitionLabels) as Acquisition[]).map((key) => (
                <option key={key} value={key}>
                  {acquisitionLabels[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {sizes.error && (
          <Failure
            error={sizes.error}
            retry={() => {
              void sizes.refetch();
            }}
          />
        )}
        <button
          type="button"
          className="quiet"
          disabled={!variant || !sizeId || draft.length >= 200}
          onClick={add}
        >
          Додати до поставки
        </button>
        {validation && <p role="alert">{validation}</p>}
        {draft.map((d, index) => (
          <div
            className="line"
            key={`${d.line.product_variant_id}:${d.line.size_id}:${d.line.acquisition_type}`}
          >
            <strong>
              {d.name} · {d.size}
            </strong>
            <span>
              {d.line.quantity} од. · {acquisitionLabels[d.line.acquisition_type]}
            </span>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                replaceDraft(draft.filter((_, i) => i !== index));
              }}
            >
              Прибрати {d.name}
            </button>
          </div>
        ))}
        <label>
          Примітка (накладна, постачальник)
          <input
            value={notes}
            maxLength={1000}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
        </label>
        <p className="total">
          Разом <strong>{units} од.</strong>
        </p>
        <button
          type="button"
          disabled={draft.length === 0 || !locationId}
          onClick={() => {
            void send();
          }}
        >
          Прийняти на склад
        </button>
      </fieldset>
      {refusal !== null && (
        <p role="alert">
          {errorText(refusal)} Список збережено — нічого не прийнято.
        </p>
      )}
    </section>
  );
}

function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): JSX.Element {
  return (
    <div role="alert">
      <p>{errorText(error)}</p>
      <button type="button" onClick={retry}>
        Повторити завантаження
      </button>
    </div>
  );
}
