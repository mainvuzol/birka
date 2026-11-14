import type { JSX, ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * What opens in place, under its words (audit 2026-11-13, frame P2-3; spec
 * S21 «Історія · 3 ›»): a quiet button of a finger's height, its words, the
 * set's chevron 16 in pencil after them, turned a quarter while open. A
 * reader hears it open or shut, and what it opened: `controls`, the id of
 * what stands under it while open. «Ще ознаки», «Ще про список», a debt's
 * «Історія · N», «Історія доставки». A folded day tag is another thing:
 * the whole tag folds (§6.10).
 */
export function Fold({
  open,
  toggle,
  controls,
  className,
  children,
}: {
  open: boolean;
  toggle: () => void;
  /** The id of what it opens, there only while open. */
  controls: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className={className ? `quiet fold ${className}` : "quiet fold"}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={toggle}
    >
      {children}{" "}
      <Icon name="chevron-right" size={16} className="fold-chevron" />
    </button>
  );
}
