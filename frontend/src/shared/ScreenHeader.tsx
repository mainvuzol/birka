import { createContext, forwardRef, useContext } from "react";
import type { ReactNode } from "react";
import { visible } from "./visible";

/** The line under every screen's title in a store: the store, who works in
 * it, and «Змінити магазин» for whoever has two stores or more — one tap
 * from any screen of a store («Усе на бірці» task list, P0-4), held as the
 * menu is. */
export interface WorkspaceLine {
  store: string;
  person: string;
  changeStore?: (() => void) | undefined;
  changeHeld: boolean;
}

/** None before a store opens: the app's own name heads those screens. */
export const WorkspaceLineContext = createContext<WorkspaceLine | null>(null);

/**
 * A screen's head (spec §6.2; «Усе на бірці» task list, P0-4, part 2): its
 * own title as the page's heading — a tab's first screen at 34, a screen
 * opened from another at 28, under its «←» — and under it one line of
 * context, «{Магазин} · {Ім’я}», with «Змінити магазин» at its right. What
 * stood beside a screen's title, «Оновити» or «До списку», stands there
 * still. A title not read yet keeps its place while it is read, so nothing
 * moves when it comes.
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
    className?: string;
    /** What the line names first, where it is not the store: «Сьогодні»'s
     * day, for whoever reads the network there; a new order's one
     * warehouse. */
    lead?: string | undefined;
    /** What the line says after the person: the count's time (spec S26). */
    after?: string;
    /** The line's words in place of the store and the person, on a task's
     * screen that says its own: «Почато о 10:20 · Тетяна» (stage 2, goods
     * task list, P0-3). */
    context?: string;
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
    className,
    lead,
    after,
    context,
  },
  ref,
) {
  const line = useContext(WorkspaceLineContext);
  return (
    <header className="screen-header">
      {back}
      <div className={wraps ? "screen-title wraps" : "screen-title"}>
        {title !== undefined ? (
          <h1
            ref={ref}
            tabIndex={focusable ? -1 : undefined}
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
                {after !== undefined && ` · ${after}`}
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
