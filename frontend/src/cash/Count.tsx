import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode, RefObject } from "react";
import { decimal, kopecks, money } from "@/orders/types";
import { Eyelet } from "@/shared/Eyelet";
import { Icon } from "@/shared/Icon";
import { Keypad } from "@/shared/Keypad";
import { CARRIED_TAP, usePanelRoom } from "@/shared/panel";
import { Sheet } from "@/shared/Sheet";
import { Sum } from "@/shared/Sum";
import {
  useAskBeforeClosing,
  useLockPortrait,
  useMainButton,
} from "@/shared/telegram";
import { Back } from "@/shared/Back";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { timeOf } from "./errors";

/**
 * The blind count, a task's screen of its own (cash task list, P0-2; spec
 * S26; «Усе на бірці» sections task list, P1-2): the menu steps aside, the
 * phone is kept upright, and Telegram asks before Бірка closes while a sum
 * is typed. The reminders the owner kept for this screen (2026-10-21, В1
 * (а)), and in the dock the app's keypad — the phone's keyboard never
 * covers it, its display the sum — with «Закрити касу» under the thumb.
 * Nothing tells what the drawer should hold (G32). «Закрити касу» asks in
 * a sheet, the sum large; Telegram's MainButton «Так, закрити» closes (spec
 * S27) — «Каса», «Закрити касу», the sum, «Закрити касу», «Так, закрити».
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
  task,
}: {
  /** What was typed: kept while cash taken out is recorded over it. */
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
  /** The menu steps aside while the count stands (spec S26). */
  task: (shown: boolean) => void;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  usePanelRoom(panel, true);
  useEffect(() => {
    task(true);
    return () => {
      task(false);
    };
  }, [task]);
  useLockPortrait(true);
  useAskBeforeClosing(typed !== "");
  // Nothing typed is no sum; 0 is one: an empty drawer. «2000,» is a sum
  // still being typed (review, 2026-10-21).
  const cents = typed === "" ? null : kopecks(typed.replace(/,$/, ""));
  const [asking, setAsking] = useState<string | null>(null);
  // Opened from «Каса»: the count begins at its top, and a reader at its
  // title — the tag that opened it is gone (review, 2026-11-03).
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, []);
  // The phone's time, said with whose count it is (spec S26): read again
  // each minute, never the moment that is recorded, which is «Так,
  // закрити»'s (G31).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(new Date());
    }, 15_000);
    return () => {
      window.clearInterval(tick);
    };
  }, []);
  return (
    <>
      <ScreenHeader
        ref={heading}
        focusable
        title="Підрахунок каси"
        after={timeOf(now.toISOString())}
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
          <button
            type="button"
            className="quiet cash-first"
            aria-haspopup="dialog"
            onClick={takeOut}
          >
            <Icon name="info" size={16} />
            Спершу запишіть видане з каси<span aria-hidden="true"> ›</span>
          </button>
        )}
        <p className="hint">Поки рахуєте, не продавайте.</p>
        {/* Shown always: another phone may have seen the server down (owner
            decisions, 2026-10-04 and 2026-10-21; ADR-0013 §9, G7). */}
        <p className="hint">
          Спершу внесіть усе з паперу й перевірте, чи нічого не чекає на інших
          телефонах.
        </p>
        <div className="pay-panel count-dock" ref={panel}>
          {/* Over the keypad: a refusal of «Закрити касу» said by it, never
              under the dock (review, 2026-11-03). */}
          {problem && <p role="alert">{problem}</p>}
          <Keypad
            label="Скільки готівки в касі зараз"
            value={typed}
            change={setTyped}
            disabled={disabled}
          />
          <button
            type="button"
            className="cash-panel-button"
            aria-haspopup="dialog"
            disabled={disabled || reading || cents === null}
            onClick={() => {
              if (cents !== null) setAsking(decimal(cents));
            }}
          >
            Закрити касу
          </button>
        </div>
      </section>
      {asking !== null && (
        <Confirm
          sum={asking}
          held={disabled || reading}
          fallback={heading}
          close={close}
          cancel={() => {
            setAsking(null);
          }}
        />
      )}
    </>
  );
}

/**
 * «Закрити касу: у касі 5 260,00 грн?» (spec S27): the sum as large as it
 * was typed, «Змінити потім не можна.», the app's «Скасувати» and Telegram's
 * MainButton «Так, закрити» — outside Telegram, the sheet's own. A press
 * sooner than `CARRIED_TAP` after it opened was meant for «Закрити касу»,
 * which stood where «Так, закрити» stands: let go, and so is a key held
 * from there. Refused, it goes and the dock says why, the sum kept.
 */
function Confirm({
  sum,
  held,
  fallback,
  close,
  cancel,
}: {
  sum: string;
  held: boolean;
  /** Where the cursor goes when «Закрити касу» waits for the drawer. */
  fallback: RefObject<HTMLElement>;
  close: (counted: string) => Promise<"done" | "refused" | "unknown">;
  cancel: () => void;
}): JSX.Element {
  const [openedAt] = useState(() => performance.now());
  const [sending, setSending] = useState(false);
  // Mounted: a late answer to a sheet gone changes nothing (set again on
  // a remount, as React's strict mode does).
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  function press(): void {
    if (held || sending || performance.now() - openedAt < CARRIED_TAP) return;
    setSending(true);
    void close(sum).then((settled) => {
      if (!live.current) return;
      setSending(false);
      // Refused: the sheet goes, the sum kept, the cursor on «Закрити
      // касу» (on the title while it waits), the dock saying why.
      if (settled === "refused") cancel();
    });
  }
  const main = useMainButton("Так, закрити", press, {
    progress: sending,
    active: !held,
  });
  const yes = useRef<HTMLButtonElement>(null);
  // The sheet takes the cursor; outside Telegram «Так, закрити» does, as
  // the panel's did.
  useEffect(() => {
    yes.current?.focus();
  }, []);
  const said = money(sum);
  return (
    <Sheet
      title={
        <>
          Закрити касу: у касі{" "}
          <span className="count-ask">
            <Sum value={said} />?
          </span>
        </>
      }
      close={() => {
        if (!sending) cancel();
      }}
      fallback={fallback}
      foot={
        <div className="count-foot">
          {!main && (
            <button
              ref={yes}
              type="button"
              className="sheet-done main-mimic"
              disabled={held}
              onKeyDown={(event) => {
                // A key held from «Закрити касу» repeats onto it: only a
                // fresh press closes.
                if (event.repeat) event.preventDefault();
              }}
              onClick={press}
            >
              {sending ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">Так, закрити</span>
                </>
              ) : (
                "Так, закрити"
              )}
            </button>
          )}
          <button
            type="button"
            className="quiet"
            disabled={sending}
            onClick={cancel}
          >
            Скасувати
          </button>
        </div>
      }
    >
      <p className="count-warn">Змінити потім не можна.</p>
    </Sheet>
  );
}
