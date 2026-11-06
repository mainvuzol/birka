import type { JSX, ReactNode } from "react";

/**
 * The blank tag (spec S03; «Усе на бірці» task list, P1-4): the hero tag's
 * cut top, no thread, its eyelet dashed — nothing hangs on it yet. The
 * screens before a store: no access yet, a sign-in that failed; and a
 * screen that broke (stage 2, orders task list, P1-5).
 */
export function BlankTag({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="tag-hero tag-outline blank">
      <div className="blank-tag">
        <span className="blank-eyelet" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
