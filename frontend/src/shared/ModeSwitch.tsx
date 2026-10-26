import { useEffect, useRef } from "react";
import type { JSX } from "react";

/**
 * Two ways of one section, as segments on a grey field (redesign direction
 * §5, «Переключатель режима»): «Продати | Повернути» on the till
 * (navigation task list, P0-1), «Борги | Замовлення» under «Клієнти» to
 * come. Each a button, the way open marked for a reader as the page. A way
 * chosen opens another screen: its switch takes the focus on the way now
 * open, never lost to the page (review, 2026-10-26).
 */
export function ModeSwitch<Mode extends string>({
  label,
  modes,
  current,
  choose,
  disabled,
  focus = false,
  focused,
}: {
  /** What the group is called for a reader: «Продаж або повернення». */
  label: string;
  modes: readonly { mode: Mode; label: string }[];
  current: Mode;
  choose: (mode: Mode) => void;
  disabled: boolean;
  /** Mounted by a way just chosen: the focus on the way now open. */
  focus?: boolean;
  /** The focus taken. */
  focused?: () => void;
}): JSX.Element {
  const open = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focus) return;
    open.current?.focus();
    focused?.();
  }, [focus, focused]);
  return (
    <div className="mode-switch" role="group" aria-label={label}>
      {modes.map(({ mode, label: name }) => (
        <button
          type="button"
          key={mode}
          ref={mode === current ? open : undefined}
          aria-current={mode === current ? "page" : undefined}
          disabled={disabled}
          onClick={() => {
            if (mode !== current) choose(mode);
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
