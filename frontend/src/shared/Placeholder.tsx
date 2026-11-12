import type { JSX, ReactNode } from "react";

/**
 * What is being read, in its own place (sale-slice TZ, P2-6): grey blocks
 * the size of the field and the tags to come, so the screen does not jump
 * under the finger when they do. A screen reader still hears `said`, which
 * the eye does not need — never a «Завантажуємо …» on the screen.
 *
 * One shape a place, each the real element's size and corner (spec §5's
 * skeleton, §6.27; audit after stage 2, frame P1-4): a list's rows 64, with
 * a mark 40 or without; a row tag 76 of a line and its meta, as an order's
 * list draws it; a store's tag 96;
 * a field 52 under its label; a row of size cells 60; a row of choices;
 * rows in their own list's shape, where a row is not a list's 64;
 * and the model tags with their cells, as before.
 */
export function Placeholder({
  said,
  field = false,
  tags = 3,
  rows = 0,
  debts = false,
  avatar = false,
  day = true,
  block = false,
  under,
  lineTags = 0,
  stores = 0,
  cells = 0,
  chips = 0,
  className,
  rowShape,
}: {
  said: string;
  /** The search field's place, above the tags. */
  field?: boolean;
  tags?: number;
  /** «Повернення»'s rows of sales, under a day's heading, in place of the
   * tags (returns task list, P2-3). */
  rows?: number;
  /** The rows are «Покупці»'s customers: a mark, a name and its meta, what is
   * owed on the right, and no day (credits task list, P2-3). */
  debts?: boolean;
  /** The rows a person's or a supplier's: a round mark 40 at their left
   * (spec §6.8). */
  avatar?: boolean;
  /** A day's heading over the rows; «Каса»'s lists have none (cash task
   * list, P2-2). */
  day?: boolean;
  /** The rows on a list's white block, as the list whose place they hold
   * (spec §6.8; audit after stage 2, frame P2-2). */
  block?: boolean;
  /** What stands under the search field, over the tags, in its own place:
   * the till's paper switch («Усе на бірці» task list, P0-5). */
  under?: ReactNode;
  /** Row tags 76 of a line and its meta, no cells, in the order tags' own
   * list: an order's, a unit's of «Брак» (spec §6.9; orders and «Каса» task
   * list after stage 2, P1-1). */
  lineTags?: number;
  /** Stores' tags 96, the eyelet on top (spec §6.10): «Магазини». */
  stores?: number;
  /** One row of size cells 60 × 60 (spec §6.13): «Нова модель»'s sizes. */
  cells?: number;
  /** A row of choices, as the real row's class has them: «Брак»'s
   * warehouses (`damaged-place`). */
  chips?: number;
  /** The real row's own class, for `chips`. */
  className?: string;
  /** The rows' own class and their list's, where a row is not a list's 64:
   * a supplier's 56 over a line, a return's card in «Зарахувати
   * повернення» (money task list after stage 2, P1-3). */
  rowShape?: { list: string; row: string };
}): JSX.Element {
  const status = (
    <p role="status" className="visually-hidden">
      {said}
    </p>
  );
  if (stores > 0)
    return (
      <>
        {status}
        <div className="placeholder door stores-list" aria-hidden="true">
          {Array.from({ length: stores }, (_, n) => (
            <div className="store-tag tag-hero tag-outline" key={n}>
              <span className="store-tag-in">
                <span className="skeleton skeleton-name" />
                <span className="skeleton skeleton-meta" />
              </span>
            </div>
          ))}
        </div>
      </>
    );
  if (cells > 0)
    return (
      <>
        {status}
        <div className="placeholder cells" aria-hidden="true">
          {Array.from({ length: cells }, (_, n) => (
            <span className="size-cell skeleton" key={n} />
          ))}
        </div>
      </>
    );
  if (chips > 0)
    return (
      <>
        {status}
        <div
          className={["placeholder chips", className ?? ""].join(" ").trim()}
          aria-hidden="true"
        >
          {Array.from({ length: chips }, (_, n) => (
            <span className="chip skeleton" key={n} />
          ))}
        </div>
      </>
    );
  if (lineTags > 0)
    return (
      <>
        {status}
        <div className="placeholder order-tags" aria-hidden="true">
          {Array.from({ length: lineTags }, (_, n) => (
            <div className="order-tag tag-row tag-outline" key={n}>
              <div className="order-tag-body">
                <span className="skeleton skeleton-name" />
                <span className="skeleton skeleton-meta" />
              </div>
            </div>
          ))}
        </div>
      </>
    );
  if (rows > 0)
    return (
      <>
        {status}
        <div className="placeholder" aria-hidden="true">
          {!debts && day && <span className="skeleton skeleton-day" />}
          <div className={block ? "list-block" : rowShape?.list}>
            {Array.from({ length: rows }, (_, n) => (
              <div
                className={
                  debts ? "sale-row debt-row" : (rowShape?.row ?? "sale-row")
                }
                key={n}
              >
                {debts && <span className="debt-mark skeleton" />}
                {avatar && !debts && <span className="avatar skeleton" />}
                <span className="sale-main">
                  <span className="skeleton skeleton-name" />
                  <span className="skeleton skeleton-meta" />
                </span>
                {debts && <span className="skeleton skeleton-owed" />}
              </div>
            ))}
          </div>
        </div>
      </>
    );
  return (
    <>
      {status}
      {field && (
        <div className="placeholder" aria-hidden="true">
          <span className="skeleton skeleton-label" />
          <span className="skeleton skeleton-field" />
        </div>
      )}
      {under}
      {tags > 0 && (
        <div className="placeholder" aria-hidden="true">
          {/* The model tags to come, their cells 60 × 60 (spec §6.27;
            «Усе на бірці» task list, P0-5). */}
          <div className="tags">
            {Array.from({ length: tags }, (_, n) => (
              <div className="model-tag tag-row tag-outline" key={n}>
                <div className="model-tag-in">
                  <p className="model-head">
                    <span className="skeleton skeleton-name" />
                  </p>
                  <div className="cells">
                    <span className="size-cell skeleton" />
                    <span className="size-cell skeleton" />
                    <span className="size-cell skeleton" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Бірка opening, before it knows whose it is (spec S02; «Усе на бірці» task
 * list, P1-4): grey blocks where a first screen's title, its line, its
 * search and three rows stand, and no menu — no tab is anyone's until their
 * rights are read (P7). A screen reader hears that the app is signing in.
 */
export function Opening(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Входимо в магазин…
      </p>
      <div className="placeholder opening" aria-hidden="true">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-meta" />
        <span className="skeleton skeleton-field" />
        {Array.from({ length: 3 }, (_, n) => (
          <div className="sale-row" key={n}>
            <span className="sale-main">
              <span className="skeleton skeleton-name" />
              <span className="skeleton skeleton-meta" />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
