import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorText } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Location, Store } from "@/orders/types";
import { CatalogPicker } from "./CatalogPicker";
import { submitReceipt, useReceiptCommand } from "./receiptCommands";
import { acquisitionLabels } from "./receiptTypes";
import type {
  Acquisition,
  Receipt,
  ReceiptLine,
  ReceivableVariant,
  SizeOption,
} from "./receiptTypes";

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
 * (`CatalogPicker`) and offers the organization's sizes.
 * "Size not known" is never among them — goods arrive with a size, and that
 * one enters only from a legacy stock list (ADR-0005 §3).
 *
 * Purchase cost is optional and a seller may enter and see it (owner decision,
 * 2026-09-30). The screen shows back the cost the server stored on each lot,
 * not what it typed; the cost is part of the delivery's permanent identity,
 * so the same command at another price is refused as another delivery.
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
  const [variant, setVariant] = useState<ReceivableVariant | null>(null);
  const [sizeId, setSizeId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("");
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

  // A store's «Брак» takes damaged returns, not deliveries: offering it here
  // would put new goods where nothing sells (owner decision, 2026-10-01).
  const receivable = (locations.data ?? []).filter(
    (location) =>
      location.is_active && location.can_receive && !location.damaged_returns,
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
    const stated = cost.trim();
    const cents = stated ? kopecks(stated) : null;
    if (stated && cents === null) {
      setValidation(
        "Закупівельну ціну вкажіть у гривнях, до копійок, наприклад 1850,50.",
      );
      return;
    }
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
      unit_cost: cents === null ? null : decimal(cents),
    };
    if (
      draft.some(
        (d) =>
          d.line.product_variant_id === line.product_variant_id &&
          d.line.size_id === line.size_id &&
          d.line.acquisition_type === line.acquisition_type &&
          d.line.unit_cost === line.unit_cost,
      )
    ) {
      setValidation(
        "Такий рядок уже в списку. Приберіть його, щоб змінити кількість.",
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
    if (outcome.kind === "done") {
      setReceived({ receipt: outcome.result, names: draft, warehouse });
      setDraft([]);
      setNotes("");
      setCommandId(crypto.randomUUID());
    } else if (outcome.kind === "refused") {
      setRefusal(outcome.error);
    }
  }

  const working = busy || pending !== null;
  const units = draft.reduce((sum, d) => sum + d.line.quantity, 0);
  const costed = draft
    .map((d) => ({ quantity: d.line.quantity, unit_cost: d.line.unit_cost }))
    .filter((line) => line.unit_cost !== null);

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
              {line.unit_cost !== null && ` · ${money(line.unit_cost)} за од.`}
            </span>
          </div>
        ))}
        {received.receipt.lines.some((line) => line.unit_cost !== null) && (
          <p className="total">
            Закупівельна вартість{" "}
            <strong>
              {money(
                decimal(
                  purchaseValue(
                    received.receipt.lines.map((line) => ({
                      quantity: line.quantity_received,
                      unit_cost: line.unit_cost,
                    })),
                  ),
                ),
              )}
            </strong>
          </p>
        )}
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
                  disabled={
                    !location.is_active ||
                    !location.can_receive ||
                    location.damaged_returns
                  }
                >
                  {location.name}
                  {!location.is_active
                    ? " — на паузі"
                    : location.damaged_returns
                      ? " — брак, лише для повернень"
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
        <CatalogPicker
          store={store}
          token={token}
          scopeKey={journalKey}
          variant={variant}
          onVariant={(picked) => {
            setVariant(picked);
            // A new model starts without the previous one's price.
            setCost("");
          }}
        />
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
            Закупівельна ціна за од., грн
            <input
              inputMode="decimal"
              placeholder="не обов’язково"
              value={cost}
              onChange={(event) => {
                setCost(event.target.value);
              }}
            />
          </label>
        </div>
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
            key={`${d.line.product_variant_id}:${d.line.size_id}:${d.line.acquisition_type}:${d.line.unit_cost ?? ""}`}
          >
            <strong>
              {d.name} · {d.size}
            </strong>
            <span>
              {d.line.quantity} од. ·{" "}
              {acquisitionLabels[d.line.acquisition_type]}
              {d.line.unit_cost !== null &&
                ` · ${money(d.line.unit_cost)} за од.`}
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
        {costed.length > 0 && (
          <p className="total">
            Закупівельна вартість{" "}
            <strong>{money(decimal(purchaseValue(costed)))}</strong>
          </p>
        )}
        {costed.length > 0 && costed.length < draft.length && (
          <p className="hint">
            Рядків без ціни: {draft.length - costed.length}. Їх вартість не
            враховано.
          </p>
        )}
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

/** Quantity × unit cost over the lines that state a cost, in kopecks. */
function purchaseValue(
  lines: { quantity: number; unit_cost: string | null }[],
): bigint {
  return lines.reduce(
    (sum, line) =>
      line.unit_cost === null
        ? sum
        : sum + (kopecks(line.unit_cost) ?? 0n) * BigInt(line.quantity),
    0n,
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
