import { useEffect, useId, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { NoCustomerData } from "@/shared/NoCustomerData";
import type { JournalOutcome } from "@/shared/journal";
import { usePanelRoom } from "@/shared/panel";
import { buzz } from "@/shared/telegram";
import { cashErrorText, dayOf } from "./errors";
import { movementDone } from "./format";
import { directionOf, movementLabels } from "./types";
import type {
  CashAnswer,
  CashBody,
  CloseBrief,
  Drawer,
  Movement,
  MovementKind,
} from "./types";

/**
 * Cash taken out, or put in for change (B5; cash task list, P1-2): what for
 * as chips, nothing chosen until the person chooses, then the sum large, the
 * cursor already in it, and «Видати 150,00 грн» in the panel under the
 * thumb — «Каса», «Видати з каси», a chip, the sum, the button. Cash put in
 * has one kind: the field is the first thing, and the cursor is in it.
 *
 * Recorded when it moves: the newest close the form read is sent with it,
 * so a record that reaches the server after a colleague's close is put on
 * that close, where the cash left. Whoever holds `cash:correct` may name an
 * earlier close for cash moved and forgotten: it explains that close and
 * changes no expected sum now (G7).
 */
export function Move({
  store,
  drawer,
  direction,
  from,
  closes,
  kept,
  disabled,
  send,
  back,
}: {
  store: Store;
  drawer: Drawer;
  direction: "OUT" | "IN";
  /** Where it was opened from, and goes back to. */
  from: "main" | "count";
  closes: CloseBrief[];
  /** «Каса»'s kept command's banner and words. */
  kept: ReactNode;
  disabled: boolean;
  send: (body: CashBody) => Promise<JournalOutcome<CashAnswer>>;
  /** Back where it came from: what was recorded, or null. */
  back: (done: string | null) => void;
}): JSX.Element {
  const hint = useId();
  const id = useId();
  const wrong = useId();
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, true);
  const kinds = drawer.movement_kinds.filter(
    (kind) => directionOf(kind) === direction,
  );
  const [kind, setKind] = useState<MovementKind | null>(
    kinds.length === 1 ? (kinds[0] ?? null) : null,
  );
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  // Empty: the open period, after the last close.
  const [forClose, setForClose] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // «150,» is a sum still being typed, never said to be wrong; nothing, or
  // nothing at all, is no sum to move.
  const cents =
    amount.trim() === "" ? null : kopecks(amount.trim().replace(/[.,]$/, ""));
  const unread = amount.trim() !== "" && cents === null;
  const sum = cents !== null && cents > 0n ? cents : null;
  // One kind: nothing to choose, the sum first.
  useEffect(() => {
    if (kinds.length === 1) field.current?.focus();
  }, [kinds.length]);

  async function record(): Promise<void> {
    if (kind === null || sum === null) return;
    setProblem(null);
    const outcome = await send({
      command: "movement",
      store_id: store.id,
      command_id: crypto.randomUUID(),
      movement_kind: kind,
      amount: decimal(sum),
      note: note.trim() === "" ? null : note.trim(),
      after_close_id: drawer.last_close?.id ?? null,
      ...(forClose === "" ? {} : { for_close_id: forClose }),
    });
    if (outcome.kind === "done") {
      // A buzz in the hand once the server answers, as at the close.
      buzz("success");
      back(movementDone(outcome.result as Movement));
    } else if (outcome.kind === "refused") {
      // Said over the panel, what was typed kept, the cursor back in it.
      buzz("error");
      setProblem(cashErrorText(outcome.error, false, "movement"));
      requestAnimationFrame(() => field.current?.focus());
    }
    // Unknown: the form stays, held under «Каса»'s banner, what was typed
    // kept — refused later, it is there to record again; confirmed, «Каса»
    // leaves it (review, 2026-10-22).
  }

  const verb = direction === "OUT" ? "Видати" : "Внести";
  return (
    <section className="cash-move">
      <button
        type="button"
        className="quiet back"
        aria-label={from === "count" ? "Назад до підрахунку" : "Назад до каси"}
        onClick={() => {
          back(null);
        }}
      >
        <span aria-hidden="true">← </span>
        {from === "count" ? "Підрахунок" : "Каса"}
      </button>
      <h2>{direction === "OUT" ? "Видати з каси" : "Внести в касу"}</h2>
      {kept}
      {direction === "OUT" && (
        <div className="chips" role="group" aria-label="Кому чи на що">
          {kinds.map((each) => (
            <button
              key={each}
              type="button"
              className="chip"
              aria-pressed={kind === each}
              disabled={disabled}
              onClick={() => {
                setKind(each);
                setProblem(null);
                // Chosen: the sum next, the keyboard already up.
                field.current?.focus();
              }}
            >
              {movementLabels[each]}
            </button>
          ))}
        </div>
      )}
      {kind === "SUPPLIER_COURIER" && (
        // The invoice and its payment stay in «Накладні», which a seller
        // does not see (G20).
        <p className="hint">
          {store.permissions.includes("supplier:debt")
            ? "Оплату накладної запишіть у «Накладних»."
            : "Накладну й оплату за нею запише менеджер."}
        </p>
      )}
      <label className="count-label" htmlFor={id}>
        Сума
      </label>
      <div className="count-field move-field">
        <input
          id={id}
          ref={field}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          placeholder="0"
          value={amount}
          disabled={disabled}
          aria-invalid={unread}
          aria-describedby={unread ? wrong : undefined}
          onChange={(event) => {
            setAmount(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.currentTarget.blur();
          }}
        />
        <span aria-hidden="true">грн</span>
      </div>
      {unread && (
        <p className="hint" role="alert" id={wrong}>
          Вкажіть суму з точністю до копійок.
        </p>
      )}
      <label>
        {direction === "OUT"
          ? "На що (необов’язково)"
          : "Примітка (необов’язково)"}
        <input
          value={note}
          maxLength={200}
          disabled={disabled}
          aria-describedby={hint}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <NoCustomerData id={hint} />
      </label>
      {drawer.may_correct && closes.length > 0 && (
        <label>
          Коли?
          <select
            value={forClose}
            disabled={disabled}
            onChange={(event) => {
              setForClose(event.target.value);
            }}
          >
            <option value="">Після останнього закриття</option>
            {closes.map((each) => (
              <option key={each.id} value={each.id}>
                До закриття {dayOf(each.business_day)}
              </option>
            ))}
          </select>
        </label>
      )}
      {problem && <p role="alert">{problem}</p>}
      <div className="pay-panel" ref={panel}>
        <button
          type="button"
          className="cash-panel-button"
          disabled={disabled || kind === null || sum === null}
          onClick={() => {
            void record();
          }}
        >
          {sum === null ? verb : `${verb} ${money(decimal(sum))}`}
        </button>
      </div>
    </section>
  );
}
