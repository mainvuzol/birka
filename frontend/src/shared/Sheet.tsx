import { useEffect, useId, useRef, useState } from "react";
import type { JSX, PointerEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { CARRIED_TAP } from "./panel";
import { addBackWay } from "./telegram";
import type { BackWay } from "./telegram";

/** How far down the handle is pulled before the sheet closes. */
const PULLED = 80;

/**
 * A sheet over the screen (spec §6.29; «Усе на бірці» task list, P0-5): the
 * card rising from the bottom with its handle, the scrim behind, at most
 * 92 % of Telegram's stable height, its inside scrolling. Telegram's
 * «Назад», Escape, a tap on the scrim and the handle pulled down close it,
 * as its own button does; what it shows is kept by the screen, never lost.
 * The screen behind is out of reach while it is open. The cursor goes into
 * it, and back where it was once it closes — or to `fallback` when that is
 * gone. `foot` stands under its scrolling inside, always in view.
 */
export function Sheet({
  title,
  close,
  fallback,
  foot,
  children,
}: {
  title: string;
  close: () => void;
  fallback?: RefObject<HTMLElement>;
  foot?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const shut = useRef(close);
  shut.current = close;
  // Telegram's «Назад» closes it while it is open: the last way mounted.
  useEffect(() => {
    const way: BackWay = {
      go: () => {
        shut.current();
      },
      held: false,
      drawn: () => true,
    };
    return addBackWay(way);
  }, []);
  // No tab, tap or reader gets behind it. Before the cursor's way back
  // below: the screen takes the cursor again only once it is in reach.
  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => {
      root?.removeAttribute("inert");
    };
  }, []);
  // Where the cursor was as it opened, read once. The page's body is
  // nowhere: a tapped button takes no cursor on iOS.
  const [before] = useState(() =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    const node = sheet.current;
    // A field inside may have taken the cursor already.
    if (!node?.contains(document.activeElement))
      node?.focus({ preventScroll: true });
    return () => {
      // Still on the page: not closed, only mounted again (React's
      // StrictMode), the cursor left where it is.
      if (node?.isConnected) return;
      // Scrolled to: a cell tapped as the tray came is under it now, and the
      // page's scroll padding keeps it clear.
      const back = before?.isConnected ? before : fallback?.current;
      if (back?.isConnected) back.focus();
    };
  }, [before, fallback]);
  // The second tap of the one that opened it lands on what rose under the
  // finger — the scrim, a button: let go for a moment, as the order's steps
  // let theirs (review, 2026-10-24). A key's press is never one.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const wait = window.setTimeout(() => {
      setReady(true);
    }, CARRIED_TAP);
    return () => {
      window.clearTimeout(wait);
    };
  }, []);
  // The handle pulled: the sheet follows the finger down, never up. Where
  // the finger came down is kept apart from what is drawn, and the finger's
  // last place decides: a quick pull is not drawn to its end before it is
  // let go.
  const from = useRef<number | null>(null);
  const [pulled, setPulled] = useState(0);
  const grab = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    from.current = event.clientY;
    setPulled(0);
  };
  const drag = (event: PointerEvent<HTMLDivElement>): void => {
    if (from.current !== null)
      setPulled(Math.max(0, event.clientY - from.current));
  };
  const drop = (event: PointerEvent<HTMLDivElement>): void => {
    const start = from.current;
    from.current = null;
    setPulled(0);
    if (start !== null && event.clientY - start > PULLED) close();
  };
  return createPortal(
    <div
      className="sheet-layer"
      onClickCapture={(event) => {
        if (ready || event.detail === 0) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="sheet-scrim" aria-hidden="true" onClick={close} />
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-ready={ready ? "" : undefined}
        style={
          pulled > 0 ? { transform: `translateY(${String(pulled)}px)` } : {}
        }
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          close();
        }}
      >
        <div
          className="sheet-grip"
          aria-hidden="true"
          onPointerDown={grab}
          onPointerMove={drag}
          onPointerUp={drop}
          onPointerCancel={() => {
            from.current = null;
            setPulled(0);
          }}
        >
          <span className="sheet-handle" />
        </div>
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        <div className="sheet-body">{children}</div>
        {foot !== undefined && <div className="sheet-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  );
}
