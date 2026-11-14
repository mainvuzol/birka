import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { buzz } from "./telegram";

/**
 * Ways of one section, as segments on a grey field (redesign direction §5,
 * «Переключатель режима»): «Продати · Повернути · Внесок» on the till
 * (navigation task list, P0-1; «Усе на бірці» task list, P0-3). Each a
 * button, the way open marked for a reader as the page. A way
 * chosen opens another screen: its switch takes the focus on the way now
 * open, never lost to the page (review, 2026-10-26). A switch that only
 * filters what the screen shows, or changes a form in the same place, marks
 * its way as pressed: «Винні зараз · Сплачені · Списані» («Усе на бірці»
 * sections task list, P0-4), «Яка модель». Which, every switch says: no
 * default to forget (audit 2026-11-13, frame P2-2).
 */
export function ModeSwitch<Mode extends string>({
  label,
  modes,
  current,
  choose,
  disabled,
  focus = false,
  focused,
  kind,
  className,
}: {
  /** What the group is called for a reader: «Продаж або повернення». */
  label: string;
  modes: readonly { mode: Mode; label: string }[];
  current: Mode;
  choose: (mode: Mode) => void;
  /** Every way held, or each by itself: «Сьогодні» needs no day said. */
  disabled: boolean | ((mode: Mode) => boolean);
  /** Mounted by a way just chosen: the focus on the way now open. */
  focus?: boolean;
  /** The focus taken. */
  focused?: () => void;
  /** «page»: a way opens another screen (the till's only); «pressed»: its
   * ways filter this screen or change its form, never open another. */
  kind: "page" | "pressed";
  className?: string;
}): JSX.Element {
  const open = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focus) return;
    open.current?.focus();
    focused?.();
  }, [focus, focused]);
  return (
    <div
      className={className ? `mode-switch ${className}` : "mode-switch"}
      role="group"
      aria-label={label}
    >
      {modes.map(({ mode, label: name }) => (
        <button
          type="button"
          key={mode}
          ref={mode === current ? open : undefined}
          {...(kind === "pressed"
            ? { "aria-pressed": mode === current }
            : { "aria-current": mode === current ? "page" : undefined })}
          disabled={typeof disabled === "function" ? disabled(mode) : disabled}
          onClick={() => {
            if (mode === current) return;
            // A choice, felt (spec §4.4; «Усе на бірці» task list, P1-2).
            buzz("selection");
            choose(mode);
          }}
        >
          {/* Its words, cut with «…» where a switch says so, the button's
              tap left whole (frame P1-1, part 2). */}
          <span>{name}</span>
        </button>
      ))}
    </div>
  );
}
