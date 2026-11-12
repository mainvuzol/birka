import { useEffect, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { createPortal } from "react-dom";
import { errorText, inOwnWords, refusalStep } from "@/shared/api";
import { visible } from "@/shared/visible";
import type { ApiError } from "@/shared/api";
import { Eyelet } from "@/shared/Eyelet";
import { Keypad } from "@/shared/Keypad";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { buzz, useMainButton } from "@/shared/telegram";
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

/** «−2», «+3»: a change of pieces, its sign always said. */
function signedPieces(delta: number): string {
  return `${delta > 0 ? "+" : "−"}${String(Math.abs(delta))}`;
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
 *
 * Drawn in the tag's system (stage 2, goods task list, P1-3): the reason a
 * chip; «Додати · Списати» where the way is asked; the number on the app's
 * keypad of pieces, the line over it saying what the ledger holds and what
 * it becomes, «В обліку 3 → 1 · −2»; the note folded. Its one button,
 * «Записати · −2 шт.», is Telegram's MainButton in a sheet — outside
 * Telegram its own, in `foot`, where the sheet keeps it in view —; on a
 * screen, which may have a MainButton of its own, the form's own under it.
 * «Назад» leaves it, closing its sheet; `onCancel`, where it stands on a
 * screen, is its «Скасувати».
 */
export function Correction({
  store,
  token,
  journalKey,
  blocked,
  locationId,
  target,
  place,
  foot,
  onDone,
  onCancel,
  onRefused,
  onLost,
}: {
  store: Store;
  token: string;
  journalKey: string;
  blocked: boolean;
  locationId: string;
  target: Target;
  /** The warehouse's name, where the screen does not say it. */
  place?: string | undefined;
  /** Where its own button stands outside Telegram: a sheet's foot, null
   * until it is drawn. None, under the form. */
  foot?: HTMLElement | null | undefined;
  onDone: (corrected: Corrected) => void;
  /** On a screen, not a sheet: «Скасувати». */
  onCancel?: (() => void) | undefined;
  /** The balances may be stale: read them again. */
  onRefused: () => void;
  /** The answer lost: the app's notice, kept over every screen, settles
   * it. */
  onLost?: () => void;
}): JSX.Element {
  // Where the count is judged from. It starts as what the list showed and is
  // replaced by what the server saw under its lock when the two disagree.
  const [system, setSystem] = useState(target.quantity);
  const [reason, setReason] = useState<AdjustmentReason | null>(null);
  const [count, setCount] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("remove");
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  // The server's answer, which only it can give; the form's own checks are
  // `invalid` below and are shown as the person types.
  const [refusal, setRefusal] = useState("");
  const { busy, pending } = useAdjustmentCommand();
  const lineId = useId();
  const invalidId = useId();
  // The note unfolded: the cursor in it, never lost with the button gone
  // (review, 2026-11-07).
  const noteField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (noting) noteField.current?.focus();
  }, [noting]);

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

  const typed = /^\d{1,5}$/.test(count) ? Number(count) : null;
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
  // What is wrong with the number typed, said as it is typed; "" where
  // nothing is.
  const invalid =
    delta === null
      ? null
      : delta === 0
        ? reason === "STOCKTAKE"
          ? "Облік збігається з фактом — виправляти нічого."
          : "Вкажіть кількість від 1."
        : system + delta < 0
          ? `В обліку лише ${String(system)} шт. — більше списати не можна.`
          : delta > 0 && target.sizeIsUnknown
            ? "Облік товару з невідомим розміром можна лише зменшити."
            : Math.abs(delta) > 10000
              ? "За один раз можна змінити облік не більше ніж на 10000 шт."
              : "";

  const working = blocked || busy || pending !== null;
  const ready = invalid === "" && !working;
  const words =
    delta === null || delta === 0
      ? "Записати"
      : `Записати · ${signedPieces(delta)} шт.`;

  async function send(): Promise<void> {
    if (!ready || reason === null || delta === null) return;
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
      buzz("success");
      onDone({ target, reason, adjustment: outcome.result });
    } else if (outcome.kind === "refused") {
      buzz("warning");
      setRefusal(refusalText(outcome.error, system));
      const actual = outcome.error.details.actual;
      if (outcome.error.code === "STOCK_CHANGED" && typeof actual === "number")
        setSystem(actual);
      // A person past their requests (ADR-0020) counted right: the same count
      // is sent again after the wait. Any other refusal asks for a recount.
      if (outcome.error.code !== "TOO_MANY_REQUESTS") setCount("");
      onRefused();
    } else onLost?.();
  }
  const press = (): void => {
    void send();
  };
  // In a sheet, Telegram's MainButton; on a screen, which may have its own,
  // the form's own button.
  const inSheet = foot !== undefined;
  // Telegram's, only where it was put up: on a screen inside Telegram the
  // form's own button stands (review, 2026-11-07).
  const main =
    useMainButton(words, press, {
      shown: inSheet && reason !== null,
      progress: busy,
      active: ready,
    }) && inSheet;
  const own = (
    <button
      type="button"
      className="sheet-done main-mimic"
      disabled={!ready && !busy}
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
  );

  return (
    // On a screen it is named, as its fieldset named it; in a sheet the
    // sheet's title does (review, 2026-11-07).
    <div
      className="correction"
      role="group"
      aria-label={`Виправити залишок: ${visible(target.name)} · ${visible(target.size)}`}
    >
      {place !== undefined && (
        <p className="t-meta">Склад «{visible(place)}»</p>
      )}
      <div className="chips reason-chips" role="group" aria-label="Причина">
        {reasons.map((key) => (
          <button
            type="button"
            className="chip"
            aria-pressed={reason === key}
            key={key}
            disabled={working}
            onClick={() => {
              if (reason !== key) buzz("selection");
              setReason(key);
              setRefusal("");
            }}
          >
            {reasonLabels[key]}
          </button>
        ))}
      </div>
      {signed !== null && canAdd && canRemove && (
        <ModeSwitch
          label="Що зробити"
          modes={[
            { mode: "add", label: "Додати" },
            { mode: "remove", label: "Списати" },
          ]}
          current={signed}
          choose={(mode) => {
            setDirection(mode);
            setRefusal("");
          }}
          disabled={working}
          filters
        />
      )}
      <p className="t-row count-live" id={lineId}>
        В обліку {system}
        {delta !== null && invalid === "" && (
          <>
            {" "}
            → {system + delta} · {signedPieces(delta)}
          </>
        )}
      </p>
      {reason !== null && (
        <Keypad
          pieces
          label={
            reason === "STOCKTAKE"
              ? "Фактично, шт."
              : reason === "DAMAGED" || reason === "LOST"
                ? "Списати, шт."
                : "Скільки, шт."
          }
          value={count}
          change={(next) => {
            setCount(next);
            setRefusal("");
          }}
          disabled={working}
          invalid={Boolean(invalid)}
          // What is wrong with the number, as it is said under it.
          describedBy={invalid ? `${lineId} ${invalidId}` : lineId}
        />
      )}
      {invalid && (
        <p role="alert" id={invalidId}>
          {invalid}
        </p>
      )}
      {refusal && <p role="alert">{refusal}</p>}
      {noting ? (
        <label>
          Примітка
          <input
            ref={noteField}
            value={note}
            maxLength={500}
            placeholder={reason === "OTHER" ? "Що сталося" : "не обов’язково"}
            disabled={working}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
      ) : (
        <button
          type="button"
          className="quiet correction-note"
          aria-expanded="false"
          disabled={working}
          onClick={() => {
            setNoting(true);
          }}
        >
          Додати примітку
        </button>
      )}
      {!main &&
        reason !== null &&
        (foot === undefined ? (
          <div className="count-foot">{own}</div>
        ) : (
          // A sheet's foot not there yet: it comes at once, the button in it.
          foot && createPortal(own, foot)
        ))}
      {onCancel && (
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={onCancel}
        >
          Скасувати
        </button>
      )}
    </div>
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
      ? `Цей товар уже є в обліку цього складу: ${String(details.actual)} шт. Перерахуйте його й введіть кількість ще раз.`
      : `Поки ви рахували, облік змінився: було ${String(details.expected)}, тепер ${String(details.actual)}. Перерахуйте товар і введіть кількість ще раз.${after}`;
  if (error.code === "INSUFFICIENT_STOCK")
    return `В обліку вже менше, ніж ви списуєте. Залишки оновлено — перевірте кількість.${after}`;
  if (details.reason === "RESERVED" && typeof details.reserved === "number")
    return `На цей товар є резерв замовлення (${String(details.reserved)} шт.). Виправити облік можна після видачі або скасування замовлення.${after}`;
  // A kept correction refused on resend keeps its words (owner, В-П1 (б):
  // the kept operations' words stay, `@/cash/errors`); one refused as it is
  // pressed says what to check, or the step — never «спробуйте ще раз».
  return `${
    after === ""
      ? inOwnWords(
          errorText(error),
          "Перевірте кількість та спробуйте ще раз.",
          "Облік змінився — перерахуйте товар і спробуйте ще раз.",
        )
      : refusalStep(
          error,
          "Перевірте кількість.",
          "Облік змінився — перерахуйте товар і введіть кількість ще раз.",
        )
  }${after}`;
}
