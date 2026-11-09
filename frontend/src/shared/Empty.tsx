import type { JSX, ReactNode, Ref } from "react";
import { Icon } from "./Icon";

/**
 * Nothing here yet (spec §6.28; audit after stage 2, frame P2-1): the
 * blank tag at 64 in the edge, one line 17/600 under it, one line of meta
 * when needed, and what the place offers — one button at most. Centred in
 * its own section, never the screen's: a list with nothing in it reads as
 * an empty page of the notebook, not as something broken. One markup for
 * every empty place; the words are each place's own.
 */
export function Empty({
  title,
  meta,
  children,
  className,
  heading,
  hidden,
}: {
  /** The one line. */
  title: ReactNode;
  /** A line of meta under it, when the place needs one. */
  meta?: ReactNode;
  /** Under the lines: its one button, or what the screen still says. */
  children?: ReactNode;
  /** The place's own class, beside the shared one. */
  className?: string | undefined;
  /** The line as its section's heading, to be focused as the screen
   * opens: drawn as a section labelled by it. */
  heading?: { id: string; ref?: Ref<HTMLHeadingElement> } | undefined;
  /** Its section kept, not shown — while a search answers instead. */
  hidden?: boolean | undefined;
}): JSX.Element {
  const shared =
    className === undefined ? "orders-empty" : `orders-empty ${className}`;
  const body = (
    <>
      <Icon name="mark-lg" className="orders-empty-mark" />
      {heading === undefined ? (
        <p className="t-row">{title}</p>
      ) : (
        <h2 ref={heading.ref} id={heading.id} className="t-row" tabIndex={-1}>
          {title}
        </h2>
      )}
      {meta !== undefined && <p className="t-meta">{meta}</p>}
      {children}
    </>
  );
  return heading === undefined ? (
    <div className={shared} hidden={hidden}>
      {body}
    </div>
  ) : (
    <section className={shared} aria-labelledby={heading.id} hidden={hidden}>
      {body}
    </section>
  );
}
