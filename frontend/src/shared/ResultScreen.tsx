import { useRef } from "react";
import type { JSX, ReactNode } from "react";
import { usePanelRoom } from "./panel";

/**
 * A result's screen (spec §5 «Док дій», §6.5; audit 2026-11-13, frame P2-9,
 * sale P1-2): at least as tall as what shows over the menu, its main action
 * last, in the dock — at the menu's top on a short result, sticking there on
 * a long one. What the result says is one block over the dock; the dock's
 * height is kept clear wherever the page scrolls to (`shared/panel.ts`). A
 * banner over the screen moves it down: the page scrolls by the banner.
 * `on` false: a screen that is a result only sometimes — an order's card,
 * once collected — keeps its shape and is drawn as before.
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
  const classes = [on ? "result-screen" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  usePanelRoom(
    docked,
    on && hidden !== true && Boolean(dock),
    "--result-dock-h",
  );
  return (
    <Tag className={classes || undefined} hidden={hidden}>
      <div className="result-body">{children}</div>
      {dock ? (
        <div className="result-dock" ref={docked}>
          {dock}
        </div>
      ) : null}
    </Tag>
  );
}
