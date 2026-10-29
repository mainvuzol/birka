import { useEffect, useId, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { decimal, kopecks, money } from "@/orders/types";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { Sum } from "@/shared/Sum";
import { Back } from "@/shared/Back";
import { ScreenHeader } from "@/shared/ScreenHeader";

/**
 * The blind count, on a screen of its own (cash task list, P0-2): one large
 * field for what is in the drawer, the cursor already in it; the reminders
 * the owner kept for this screen (2026-10-21, В1 (а)); and «Закрити касу»
 * in the panel under the thumb, confirmed there — «Каса», «Закрити касу»,
 * the sum, «Закрити касу», «Так, закрити». Nothing tells what the drawer
 * should hold (G32). «Так, закрити» stands where «Закрити касу» stood, so a
 * double tap's second half is let go: the sum is looked at before the close
 * that cannot be changed («Усе на бірці» sections task list, P1-2).
 */
export function Count({
  typed,
  setTyped,
  kept,
  done,
  problem,
  disabled,
  reading,
  takeOut,
  close,
  back,
}: {
  /** What was typed: kept on this screen's way to «Видати з каси» and back. */
  typed: string;
  setTyped: (typed: string) => void;
  /** The kept command's banner and words, as on every screen of «Каса». */
  kept: ReactNode;
  done: string | null;
  problem: string | null;
  disabled: boolean;
  /** The drawer is being read again: the count waits for the newest close
   * it is to name (review, 2026-10-21). */
  reading: boolean;
  /** «Спершу запишіть видане з каси», for whoever takes cash out. */
  takeOut: (() => void) | null;
  /** Sends the count; says whether it settled, so a refusal asks again. */
  close: (counted: string) => Promise<"done" | "refused" | "unknown">;
  back: () => void;
}): JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, true);
  const id = useId();
  const wrong = useId();
  const [asking, setAsking] = useState<string | null>(null);
  // Nothing typed is no sum; 0 is one: an empty drawer. «2000,» is a sum
  // still being typed, never said to be wrong (review, 2026-10-21).
  const cents =
    typed.trim() === "" ? null : kopecks(typed.trim().replace(/[.,]$/, ""));
  const unread = typed.trim() !== "" && cents === null;
  // The panel's buttons change under the finger: the focus follows them.
  const closeButton = useRef<HTMLButtonElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  // When «Закрити касу» was pressed: a tap on «Так, закрити» sooner than
  // `CARRIED_TAP` after it was meant for «Закрити касу».
  const askedAt = useRef(-Infinity);
  useEffect(() => {
    field.current?.focus();
  }, []);
  useEffect(() => {
    if (asking !== null) yes.current?.focus();
  }, [asking]);
  return (
    <>
      <ScreenHeader
        title="Підрахунок каси"
        back={
          <Back go={back} label="Назад до каси">
            <span aria-hidden="true">← </span>Каса
          </Back>
        }
      />
      <section className="cash-count">
        {kept}
        {done && <p role="status">{done}</p>}
        {takeOut && (
          <button type="button" className="quiet cash-first" onClick={takeOut}>
            Спершу запишіть видане з каси<span aria-hidden="true"> ›</span>
          </button>
        )}
        <label className="count-label" htmlFor={id}>
          Скільки готівки в касі зараз
        </label>
        <div className="count-field">
          <input
            id={id}
            ref={field}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0"
            value={typed}
            disabled={disabled}
            aria-invalid={unread}
            aria-describedby={unread ? wrong : undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              setAsking(null);
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
        <p className="hint">Поки рахуєте, не продавайте.</p>
        {/* Shown always: another phone may have seen the server down (owner
            decisions, 2026-10-04 and 2026-10-21; ADR-0013 §9, G7). */}
        <p className="hint">
          Спершу внесіть усе з паперу й перевірте, чи нічого не чекає на інших
          телефонах.
        </p>
        {problem && <p role="alert">{problem}</p>}
        <div className="pay-panel" ref={panel}>
          {asking === null ? (
            <>
              <p className="pay-total">
                {cents === null ? (
                  "Впишіть суму"
                ) : (
                  <>
                    У касі <Sum value={money(decimal(cents))} />
                  </>
                )}
              </p>
              <button
                ref={closeButton}
                type="button"
                className="cash-panel-button"
                disabled={disabled || reading || cents === null}
                onClick={(event) => {
                  if (cents === null) return;
                  askedAt.current = event.timeStamp;
                  setAsking(decimal(cents));
                }}
              >
                Закрити касу
              </button>
            </>
          ) : (
            <>
              {/* The sum confirmed as large as it was typed. */}
              <p className="pay-total">
                Закрити касу: у касі <Sum value={money(asking)} />?
              </p>
              <p className="pay-what">Змінити потім не можна.</p>
              <div className="pay-confirm">
                <button
                  ref={yes}
                  type="button"
                  className="cash-panel-button"
                  disabled={disabled || reading}
                  onKeyDown={(event) => {
                    // A key held from «Закрити касу» repeats onto it: only a
                    // fresh press closes.
                    if (event.repeat) event.preventDefault();
                  }}
                  onClick={(event) => {
                    if (event.timeStamp - askedAt.current < CARRIED_TAP) return;
                    void close(asking).then((settled) => {
                      if (settled === "done") return;
                      setAsking(null);
                      // Refused: back on the button, the sum kept.
                      requestAnimationFrame(() => closeButton.current?.focus());
                    });
                  }}
                >
                  Так, закрити
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={disabled}
                  onClick={() => {
                    setAsking(null);
                    requestAnimationFrame(() => closeButton.current?.focus());
                  }}
                >
                  Скасувати
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
