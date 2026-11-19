import type { JSX, ReactNode } from "react";

/**
 * A model's hero tag while it is read, in its own place (goods task list
 * after stage 2, P2-2; audit 2026-11-18, goods P2-3): the eyelet, the
 * name's line 42 in grey, ⋯'s place where the screen draws it, then what
 * else the tag will hold — so nothing jumps when it comes. A screen reader
 * hears `said`, which the eye does not need.
 */
export function HeroWait({
  said,
  more,
  children,
}: {
  said: string;
  /** ⋯ beside the name, where the screen draws it. */
  more: boolean;
  children?: ReactNode;
}): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        {said}
      </p>
      <section className="model-screen placeholder" aria-hidden="true">
        <div className="model-hang">
          <div className="tag-hero tag-outline">
            <div className="model-hero">
              <span className="hero-eyelet" />
              <div className="model-hero-head">
                <span className="skeleton skeleton-title" />
                {more && <span className="debt-more" />}
              </div>
              {children}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
