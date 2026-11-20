import { useContext, useLayoutEffect, useRef } from "react";
import type { JSX, ReactNode } from "react";
import { resultStood, usePanelRoom } from "./panel";
import { UnderHeaderContext } from "./ScreenHeader";

/**
 * A result's screen (spec §5 «Док дій», §6.5; audit 2026-11-13, frame P2-9,
 * sale P1-2): at least as tall as what shows over the menu, its main action
 * last, in the dock — at the menu's top on a short result, sticking there on
 * a long one. What the result says is one block over the dock; the dock's
 * height is kept clear wherever the page scrolls to (`shared/panel.ts`). A
 * banner over the screen moves it down: the page scrolls by the banner.
 * `on` false: a screen that is a result only sometimes — an order's card,
 * once collected — keeps its shape and is drawn as before.
 *
 * A result, or a screen kept hidden under another, gives a kept operation's
 * stub no place under its title (audit 2026-11-15, frame P2-9; review): a
 * result's title is followed by what it says, never by another
 * operation's stub, which stands over it as before; a hidden one's would
 * hide the stub.
 *
 * Shown, it stands where it was pressed for (`resultStood`): for a moment
 * a finger's tap on its dock, the menu or Telegram's MainButton is that
 * press's second half, let go (audit 2026-11-20, frame P1-1). As it first
 * shows, before it is painted; and as its dock comes on it shown — «Готово»
 * where «Записати причину» was (review). Kept hidden under another screen
 * and shown again, not again.
 */
export function ResultScreen({
  as: Tag = "section",
  className,
  on = true,
  hidden,
  dock,
  children,
}: {
  as?: "section" | "div";
  className?: string | undefined;
  on?: boolean;
  hidden?: boolean | undefined;
  /** The screen's main, and nothing else: none where Telegram's is. */
  dock?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const docked = useRef<HTMLDivElement>(null);
  const under = useContext(UnderHeaderContext);
  const classes = [on ? "result-screen" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  usePanelRoom(
    docked,
    on && hidden !== true && Boolean(dock),
    "--result-dock-h",
  );
  const shown = on && hidden !== true;
  const docks = Boolean(dock);
  // Shown once, this time it is a result; a dock come since.
  const stood = useRef(false);
  const hadDock = useRef(docks);
  useLayoutEffect(() => {
    const arrives = docks && !hadDock.current;
    hadDock.current = docks;
    if (!on) stood.current = false;
    else if (shown && (!stood.current || arrives)) {
      stood.current = true;
      resultStood();
    }
  }, [on, shown, docks]);
  return (
    <Tag className={classes || undefined} hidden={hidden}>
      <div className="result-body">
        <UnderHeaderContext.Provider
          value={on || hidden === true ? null : under}
        >
          {children}
        </UnderHeaderContext.Provider>
      </div>
      {dock ? (
        <div className="result-dock" ref={docked}>
          {dock}
        </div>
      ) : null}
    </Tag>
  );
}
