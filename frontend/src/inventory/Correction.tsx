import { useState } from "react";
import type { JSX } from "react";
import { errorText } from "@/shared/api";
import type { ApiError } from "@/shared/api";
import type { Store } from "@/orders/types";
import { submitAdjustment, useAdjustmentCommand } from "./adjustmentCommands";
import { reasonLabels } from "./adjustmentTypes";
import type { Adjustment, AdjustmentReason } from "./adjustmentTypes";

/** One balance at one warehouse, as the screen last read it. */
export interface Target {
  product_variant_id: string;
  size_id: string;
  name: string;
  size: string;
  sizeIsUnknown: boolean;
  /** What the system holds. Zero for goods found that it does not know of. */
  quantity: number;
}

export interface Corrected {
  target: Target;
  reason: AdjustmentReason;
  adjustment: Adjustment;
}

/**
 * Correct one balance, with a reason (`POST /inventory/adjustments`).
 *
 * A manager's command: it needs `inventory:adjust`, which the default seller
 * does not hold. A seller's corrections are the bounded ones the till offers
 * inside a sale.
 *
 * What is asked depends on the reason, because the number a person knows
 * does. A stocktake knows what the shelf holds, so it asks for that and sends
 * the difference *with the balance it was worked out against*: if a sale or a
 * delivery moved the balance meanwhile, the server refuses it as
 * `STOCK_CHANGED` and nothing is written. Damaged or lost goods are a number
 * of units whatever the balance, so they send only the change.
 */
export function Correction({
  store,
  token,
  journalKey,
  blocked,
  locationId,
  target,
  onDone,
  onCancel,
  onRefused,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  locationId: string;
  target: Target;
  onDone: (corrected: Corrected) => void;
  onCancel: () => void;
  /** The balances may be stale: read them again. */
  onRefused: () => void;
}): JSX.Element {
  // Where the count is judged from. It starts as what the list showed and is
  // replaced by what the server saw under its lock when the two disagree.
  const [system, setSystem] = useState(target.quantity);
  const [reason, setReason] = useState<AdjustmentReason | null>(null);
  const [count, setCount] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  // The server's answer, which only it can give; the form's own checks are
  // `invalid` below and are shown as the person types.
  const [refusal, setRefusal] = useState("");
  const { busy, pending } = useAdjustmentCommand();

  // Nothing to write off where the system holds nothing, and a size that is
  // not known is never added (ADR-0005 §3): it enters only from a legacy list.
  const reasons = (Object.keys(reasonLabels) as AdjustmentReason[]).filter(
    (key) => system > 0 || (key !== "DAMAGED" && key !== "LOST"),
  );
  const canAdd = !target.sizeIsUnknown;
  const canRemove = system > 0;
  const signed =
    reason === "CORRECTION" || reason === "OTHER"
      ? !canAdd
        ? "remove"
        : !canRemove
          ? "add"
          : direction
      : null;

  const typed = /^\d{1,5}$/.test(count.trim()) ? Number(count.trim()) : null;
  const delta =
    reason === null || typed === null
      ? null
      : reason === "STOCKTAKE"
        ? typed - system
        : reason === "DAMAGED" || reason === "LOST"
          ? -typed
          : signed === "add"
            ? typed
            : -typed;
  const invalid =
    reason === null
      ? "Оберіть причину."
      : typed === null
        ? reason === "STOCKTAKE"
          ? "Вкажіть, скільки одиниць фактично на складі."
          : "Вкажіть кількість одиниць."
        : delta === 0
          ? reason === "STOCKTAKE"
            ? "Облік збігається з фактом — виправляти нічого."
            : "Вкажіть кількість від 1."
          : delta !== null && system + delta < 0
            ? `В обліку лише ${String(system)} од. — більше списати не можна.`
            : delta !== null && delta > 0 && target.sizeIsUnknown
              ? "Облік товару з невідомим розміром можна лише зменшити."
              : delta !== null && Math.abs(delta) > 10000
                ? "За один раз можна змінити облік не більше ніж на 10000 од."
                : "";

  async function send(): Promise<void> {
    setTried(true);
    if (invalid || delta === null || reason === null) return;
    setRefusal("");
    const trimmed = note.trim();
    const outcome = await submitAdjustment(journalKey, token, {
      // A new transport key per attempt, and a new command per correction:
      // a definite refusal wrote nothing, and an unknown outcome is settled
      // by resending the stored attempt, never by sending this form again.
      key: crypto.randomUUID(),
      body: {
        store_id: store.id,
        location_id: locationId,
        command_id: crypto.randomUUID(),
        product_variant_id: target.product_variant_id,
        size_id: target.size_id,
        quantity_delta: delta,
        reason_code: reason,
        note: trimmed ? trimmed : null,
        expected_quantity: reason === "STOCKTAKE" ? system : null,
      },
    });
    if (outcome.kind === "done") {
      onDone({ target, reason, adjustment: outcome.result });
    } else if (outcome.kind === "refused") {
      setRefusal(refusalText(outcome.error, system));
      const actual = outcome.error.details.actual;
      if (outcome.error.code === "STOCK_CHANGED" && typeof actual === "number")
        setSystem(actual);
      setCount("");
      setTried(false);
      onRefused();
    }
  }

  const working = blocked || busy || pending !== null;
  return (
    <fieldset disabled={working}>
      <legend>
        Виправити залишок: {target.name} · {target.size}
      </legend>
      <p>
        В обліку: <strong>{system}</strong>
      </p>
      <div role="radiogroup" aria-label="Причина" className="choices">
        {reasons.map((key) => (
          <button
            type="button"
            role="radio"
            aria-checked={reason === key}
            key={key}
            className={reason === key ? "active" : "quiet"}
            onClick={() => {
              setReason(key);
              setRefusal("");
            }}
          >
            {reasonLabels[key]}
          </button>
        ))}
      </div>
      {signed !== null && (
        <div role="radiogroup" aria-label="Що зробити" className="choices">
          <button
            type="button"
            role="radio"
            aria-checked={signed === "add"}
            className={signed === "add" ? "active" : "quiet"}
            disabled={!canAdd}
            onClick={() => {
              setDirection("add");
            }}
          >
            Додати до обліку
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={signed === "remove"}
            className={signed === "remove" ? "active" : "quiet"}
            disabled={!canRemove}
            onClick={() => {
              setDirection("remove");
            }}
          >
            Списати з обліку
          </button>
        </div>
      )}
      {reason !== null && (
        <label>
          {reason === "STOCKTAKE"
            ? "Фактично на складі, од."
            : reason === "DAMAGED" || reason === "LOST"
              ? "Скільки списати, од."
              : "Скільки, од."}
          <input
            inputMode="numeric"
            value={count}
            onChange={(event) => {
              setCount(event.target.value);
              setRefusal("");
            }}
          />
        </label>
      )}
      {reason !== null && typed !== null && !invalid && delta !== null && (
        <p className="total">
          Облік{" "}
          <strong>
            {system} → {system + delta} ({delta > 0 ? "+" : "−"}
            {Math.abs(delta)})
          </strong>
        </p>
      )}
      <label>
        Примітка
        <input
          value={note}
          maxLength={500}
          placeholder={reason === "OTHER" ? "Що сталося" : "не обов’язково"}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </label>
      {invalid && (tried || count !== "") && <p role="alert">{invalid}</p>}
      {refusal && <p role="alert">{refusal}</p>}
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            void send();
          }}
        >
          Записати коригування
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Скасувати
        </button>
      </div>
    </fieldset>
  );
}

/**
 * What the screen can say about a refusal it knows the cause of. `system` is
 * the balance the count was made against. `after` says that nothing was
 * recorded; a kept correction refused on resend says it first instead
 * («Коригування не записано.», `@/cash/errors`), and passes none.
 */
export function refusalText(
  error: ApiError,
  system: number | null,
  after = " Нічого не записано.",
): string {
  const { details } = error;
  if (error.code === "STOCK_CHANGED" && typeof details.actual === "number")
    return details.expected === 0 && system === 0
      ? `Цей товар уже є в обліку цього складу: ${String(details.actual)} од. Перерахуйте його й введіть кількість ще раз.`
      : `Поки ви рахували, облік змінився: було ${String(details.expected)}, тепер ${String(details.actual)}. Перерахуйте товар і введіть кількість ще раз.${after}`;
  if (error.code === "INSUFFICIENT_STOCK")
    return `В обліку вже менше, ніж ви списуєте. Залишки оновлено — перевірте кількість.${after}`;
  if (details.reason === "RESERVED" && typeof details.reserved === "number")
    return `На цей товар є резерв замовлення (${String(details.reserved)} од.). Виправити облік можна після видачі або скасування замовлення.${after}`;
  return `${errorText(error)}${after}`;
}
