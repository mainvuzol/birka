import type { JSX } from "react";

/**
 * What is being read, in its own place (sale-slice TZ, P2-6): grey blocks
 * the size of the field and the tags to come, so the screen does not jump
 * under the finger when they do. A screen reader still hears `said`, which
 * the eye does not need.
 */
export function Placeholder({
  said,
  field = false,
  tags = 3,
}: {
  said: string;
  /** The search field's place, above the tags. */
  field?: boolean;
  tags?: number;
}): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        {said}
      </p>
      <div className="placeholder" aria-hidden="true">
        {field && (
          <div>
            <span className="skeleton skeleton-label" />
            <span className="skeleton skeleton-field" />
          </div>
        )}
        <div className="tags">
          {Array.from({ length: tags }, (_, n) => (
            <div className="tag" key={n}>
              <p className="tag-head">
                <span className="skeleton skeleton-name" />
              </p>
              <div className="chips">
                <span className="chip skeleton" />
                <span className="chip skeleton" />
                <span className="chip skeleton" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
