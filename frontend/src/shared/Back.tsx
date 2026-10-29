import { useEffect, useRef } from "react";
import type { JSX, MouseEvent, ReactNode } from "react";
import { addBackWay, showBack } from "./telegram";
import type { BackWay } from "./telegram";

/**
 * A screen's way back — «← Ще», «← Каса», «← До замовлень» over its title,
 * «До списку» beside it — and Telegram's «Назад» doing the same, one
 * handler for both (direction §6.8; «Усе на бірці» task list, P1-1), while
 * it is drawn and free. Held, Telegram's is hidden too.
 */
export function Back({
  go,
  held = false,
  label,
  className = "quiet back",
  carried,
  children,
}: {
  go: () => void;
  /** A send in flight, or an operation kept: no way out. */
  held?: boolean;
  /** Its name read aloud, where its words alone do not say it: «Назад до
   * каси». */
  label?: string;
  /** Over the title by default; «quiet» beside it. */
  className?: string;
  /** A tap on the button that was meant for the step before: let go.
   * Telegram's «Назад» is not under the finger, so never carried. */
  carried?: (event: MouseEvent<HTMLButtonElement>) => boolean;
  children: ReactNode;
}): JSX.Element {
  const button = useRef<HTMLButtonElement>(null);
  const way = useRef<BackWay>({
    go,
    held,
    drawn: () => (button.current?.getClientRects().length ?? 0) > 0,
  });
  useEffect(() => addBackWay(way.current), []);
  useEffect(() => {
    way.current.go = go;
    way.current.held = held;
    // Held, or its screen hidden or shown again: said to Telegram.
    showBack();
  });
  return (
    <button
      ref={button}
      type="button"
      className={className}
      aria-label={label}
      disabled={held}
      onClick={(event) => {
        if (!carried?.(event)) go();
      }}
    >
      {children}
    </button>
  );
}
