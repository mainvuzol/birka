import { createContext, forwardRef, useContext, useLayoutEffect } from "react";
import type { ReactNode } from "react";
import { visible } from "./visible";

/** The line under every screen's title in a store: the store, who works in
 * it, and «Змінити магазин» for whoever has two stores or more — one tap
 * from any screen of a store («Усе на бірці» task list, P0-4), held while
 * an operation holds the store, and none on a task's screen (audit
 * 2026-11-13, frame P2-1). */
export interface WorkspaceLine {
  store: string;
  person: string;
  changeStore?: (() => void) | undefined;
  changeHeld: boolean;
}

/** None before a store opens: the app's own name heads those screens. */
export const WorkspaceLineContext = createContext<WorkspaceLine | null>(null);

/** The screen the page was last put at the top for, where its header said
 * which (`screen`): drawn again for the same one — an order's card read
 * anew, moved on — it keeps its place (frame P1-3; review). */
let atTop: string | undefined;

/**
 * A screen's head (spec §6.2; «Усе на бірці» task list, P0-4, part 2): its
 * own title as the page's heading — a tab's first screen at 34, a screen
 * opened from another at 28, under its «←» — and under it one line of
 * context, «{Магазин} · {Ім’я}», with «Змінити магазин» at its right. What
 * stood beside a screen's title, «Оновити» or «До списку», stands there
 * still. A title not read yet keeps its place while it is read, so nothing
 * moves when it comes.
 *
 * A screen begins at its top (spec §6.2; audit after stage 2, frame P1-3):
 * one reset, here, before the screen is painted — whenever a header is
 * drawn, or its title changes, or the screen it says it stands for. That
 * is every screen opened: a tab, a «Ще» row, a «Сьогодні» tag, a row's
 * card, «←» and Telegram's «Назад». Within a screen the place stays: a
 * sheet, «Показати ще», a switch, a filter or a search draws no header of
 * its own and changes no title. A screen that falls open where it was left
 * puts itself there after it (a close's list, the report's table).
 */
export const ScreenHeader = forwardRef<
  HTMLHeadingElement,
  {
    /** None while the screen is read, or once its read failed. */
    title?: ReactNode;
    /** Read: the title's place, held. */
    waiting?: boolean;
    /** Its «←», over the title. */
    back?: ReactNode;
    /** Opened from another screen: by its «←», unless said. */
    pushed?: boolean;
    aside?: ReactNode;
    /** Its aside goes under the title when the two do not fit one line —
     * the device's face drawn, its text larger — never breaking the
     * title's word (stage 2, orders task list, P1-4; review). */
    wraps?: boolean;
    /** Its heading takes the focus as the screen opens. */
    focusable?: boolean;
    /** Heard with the heading as focus comes: a result's one sentence. */
    describedBy?: string | undefined;
    className?: string;
    /** What the line names first, where it is not the store: «Сьогодні»'s
     * day, for whoever reads the network there; a new order's one
     * warehouse. */
    lead?: string | undefined;
    /** What the line says after the person: the count's time (spec S26);
     * when an order was made, its number small beside it (orders and
     * «Каса» task list after stage 2, P2-1). */
    after?: ReactNode;
    /** The line's words in place of the store and the person, on a task's
     * screen that says its own: «Почато о 10:20 · Тетяна» (stage 2, goods
     * task list, P0-3); none while what it names is read. */
    context?: string | undefined;
    /** What tells this screen from the one before it where its title may
     * not — a list and its row's card under one title — and what a screen
     * drawn anew is still: an order's card read again, moved on, stays
     * where it was read to (frame P1-3; review). */
    screen?: string;
  }
>(function ScreenHeader(
  {
    title,
    waiting = false,
    back,
    pushed = Boolean(back),
    aside,
    wraps = false,
    focusable = false,
    describedBy,
    className,
    lead,
    after,
    context,
    screen,
  },
  ref,
) {
  const line = useContext(WorkspaceLineContext);
  // A title drawn of parts — a mark beside it, a button in it — says no
  // screen of its own: its header's coming does.
  const opened = screen ?? (typeof title === "string" ? title : undefined);
  useLayoutEffect(() => {
    if (screen !== undefined && screen === atTop) return;
    atTop = screen;
    window.scrollTo(0, 0);
  }, [opened, screen]);
  return (
    <header className="screen-header">
      {back}
      <div className={wraps ? "screen-title wraps" : "screen-title"}>
        {title !== undefined ? (
          <h1
            ref={ref}
            tabIndex={focusable ? -1 : undefined}
            aria-describedby={describedBy}
            className={
              [pushed ? "t-title-l" : "", className ?? ""]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            {title}
          </h1>
        ) : (
          waiting && (
            <span className="skeleton skeleton-title" aria-hidden="true" />
          )
        )}
        {aside}
      </div>
      {line && (
        <div className="store-line">
          <p className="t-meta">
            {context ?? (
              <>
                {lead ?? visible(line.store)} · {visible(line.person)}
                {after !== undefined && <> · {after}</>}
              </>
            )}
          </p>
          {line.changeStore && (
            <button
              type="button"
              className="quiet"
              disabled={line.changeHeld}
              onClick={line.changeStore}
            >
              Змінити магазин
            </button>
          )}
        </div>
      )}
    </header>
  );
});
