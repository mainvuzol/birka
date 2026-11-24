import { useEffect, useId, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { decimal, money, typedKopecks } from "@/orders/types";
import type { Store } from "@/orders/types";
import { Eyelet } from "@/shared/Eyelet";
import { Keypad } from "@/shared/Keypad";
import { NoCustomerData } from "@/shared/NoCustomerData";
import type { JournalOutcome } from "@/shared/journal";
import { SendingLine } from "@/shared/Sending";
import { Sheet } from "@/shared/Sheet";
import { buzz, useAskBeforeClosing } from "@/shared/telegram";
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
 * Cash taken out, or put in for change (B5; cash task list, P1-2), in a
 * sheet over the screen it was opened from (spec §6.29; «Усе на бірці»
 * sections task list, P1-1) — «Каса», or the count, whose sum stays: what
 * for as chips, nothing chosen until the person chooses, then the sum on
 * Бірка's keypad, as the count's — the phone's keyboard never opens over
 * the sheet's button (spec §6.25; audit 2026-11-15, orders-cash P1-1) —
 * and the app's «Видати 150,00 грн» under it, never Telegram's MainButton:
 * it moves money. Cash put in has one kind: the keypad is the first thing.
 *
 * Recorded when it moves: the newest close the form read is sent with it,
 * so a record that reaches the server after a colleague's close is put on
 * that close, where the cash left. Whoever holds `cash:correct` may name an
 * earlier close for cash moved and forgotten: it explains that close and
 * changes no expected sum now (G7). Its answer lost, the sheet stays with
 * «Каса»'s banner in it, what was typed kept, until it is known.
 */
export function Move({
  store,
  drawer,
  direction,
  closes,
  kept,
  disabled,
  send,
  fallback,
  back,
}: {
  store: Store;
  drawer: Drawer;
  direction: "OUT" | "IN";
  closes: CloseBrief[];
  /** «Каса»'s kept command's banner and words: the screen behind is out of
   * reach while the sheet stands. */
  kept: ReactNode;
  disabled: boolean;
  send: (body: CashBody) => Promise<JournalOutcome<CashAnswer>>;
  /** Where the cursor goes when what opened it waits for an answer. */
  fallback: RefObject<HTMLElement>;
  /** Closed: what was recorded, or null. */
  back: (done: string | null) => void;
}): JSX.Element {
  const hint = useId();
  const wrong = useId();
  // The keypad's: the sum, where the cursor goes back after a refusal.
  const pad = useRef<HTMLDivElement>(null);
  const refused = useRef<HTMLParagraphElement>(null);
  const [sending, setSending] = useState(false);
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
  // Each refusal told once drawn: its top brought into view, then the
  // cursor back in the sum without moving the sheet again — after the
  // render that put it over the keys, never before it (review, audit
  // 2026-11-23, orders-cash P2-1; as «Внесок»'s).
  const [told, setTold] = useState(0);
  useEffect(() => {
    if (told === 0) return;
    refused.current?.scrollIntoView({ block: "nearest" });
    pad.current?.querySelector("input")?.focus({ preventScroll: true });
  }, [told]);
  // «150,» is a sum still being typed, never said to be wrong; nothing, or
  // nothing at all, is no sum to move. The keypad takes nothing wrong —
  // keys, a computer's keyboard or a paste alike, two figures after the
  // comma at most — so «Вкажіть суму з точністю до копійок.» stays only as
  // the guard the task list keeps (audit 2026-11-15, orders-cash P1-1
  // p. 6; review).
  const cents = amount.trim() === "" ? null : typedKopecks(amount);
  const unread = amount.trim() !== "" && cents === null;
  // A sum typed and not yet recorded: Telegram asks before Бірка closes, as
  // the count does (spec §4.4, rule 2; В-Т7 (а); audit 2026-11-22,
  // orders-cash P2-1). Recorded or closed, the sheet goes and the question
  // with it.
  useAskBeforeClosing(amount.trim() !== "");
  const sum = cents !== null && cents > 0n ? cents : null;

  async function record(): Promise<void> {
    if (kind === null || sum === null || sending) return;
    setProblem(null);
    setSending(true);
    let outcome: JournalOutcome<CashAnswer>;
    try {
      outcome = await send({
        command: "movement",
        store_id: store.id,
        command_id: crypto.randomUUID(),
        movement_kind: kind,
        amount: decimal(sum),
        note: note.trim() === "" ? null : note.trim(),
        after_close_id: drawer.last_close?.id ?? null,
        ...(forClose === "" ? {} : { for_close_id: forClose }),
      });
    } finally {
      // Whatever came of it, the ring stops and the sheet may be left: never
      // a sheet held for good (review, 2026-11-09).
      setSending(false);
    }
    if (outcome.kind === "done") {
      // A buzz in the hand once the server answers, as at the close.
      buzz("success");
      back(movementDone(outcome.result as Movement));
    } else if (outcome.kind === "refused") {
      // Said in the sheet, what was typed kept, the cursor back in it.
      // Over the keys, where the sum is (audit 2026-11-23, orders-cash
      // P2-1).
      buzz("error");
      setProblem(cashErrorText(outcome.error, false, "movement"));
      setTold((n) => n + 1);
    }
    // Unknown: the sheet stays, held under «Каса»'s banner, what was typed
    // kept — refused later, it is there to record again; confirmed, «Каса»
    // closes it (review, 2026-10-22).
  }

  const verb = direction === "OUT" ? "Видати" : "Внести";
  return (
    <Sheet
      title={direction === "OUT" ? "Видати з каси" : "Внести в касу"}
      close={() => {
        if (!sending) back(null);
      }}
      // On its way: Telegram's «Назад» hidden, as «Клієнт забрав» (review,
      // 2026-11-09).
      held={sending}
      fallback={fallback}
      foot={
        // «Ще надсилаємо…» over the button past 3 s, as the till's dock
        // (audit after stage 2, orders-cash P0-1).
        <div className="sending-room">
          <SendingLine busy={sending} />
          <button
            type="button"
            className={`sheet-done cash-move-button primary${sending ? " pressed" : ""}`}
            disabled={disabled || sending || kind === null || sum === null}
            onClick={() => {
              void record();
            }}
          >
            {sending && <Eyelet state="spin" size={20} />}
            {sum === null ? verb : `${verb} ${money(decimal(sum))}`}
          </button>
        </div>
      }
    >
      <div className="cash-move">
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
                  if (kind !== each) buzz("selection");
                  setKind(each);
                  setProblem(null);
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
        {/* A refusal of the sheet's over its keys, by the sum, as the
            count's, «Внесок»'s and an invoice's payment's (audit
            2026-11-23, orders-cash P2-1); the sum's own «з точністю до
            копійок» stays its line under it. */}
        {problem && (
          <p role="alert" ref={refused}>
            {problem}
          </p>
        )}
        {/* The next step after a chip: the keys, already in view. */}
        <div className="move-pad" ref={pad}>
          <Keypad
            label="Сума, грн"
            value={amount}
            // The refusal stays while the sum is mended, as the count's:
            // gone from over the keys at the first press, it would move
            // them under the finger (review, audit 2026-11-23). The next
            // «Видати»/«Внести» or another chip takes it away.
            change={setAmount}
            disabled={disabled}
            invalid={unread}
            {...(unread ? { describedBy: wrong } : {})}
          />
        </div>
        {unread && (
          <p className="field-wrong" role="alert" id={wrong}>
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
            enterKeyHint="done"
            aria-describedby={hint}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            onKeyDown={(event) => {
              // The keyboard put away, the sheet's button in view.
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.currentTarget.blur();
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
      </div>
    </Sheet>
  );
}
