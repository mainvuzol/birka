import type { JSX } from "react";

/** A row a table will have whatever its stores: its words, a sum's line
 * under its figure where it has one, «Разом» bold. */
export interface WaitRow {
  label: string;
  /** What it counts, under its figure: «3 · 5 шт.». */
  meta?: string;
  total?: boolean;
}

/** A word's place: the word unseen, a grey line its width. */
function Grey({ words }: { words: string }): JSX.Element {
  return (
    <span className="skeleton-line">
      <span>{words}</span>
    </span>
  );
}

/**
 * A table's place while it is read (audit 2026-11-13, money P2-1): the
 * rows it will have but those only some stores have — the corner, a
 * store's column, each section's name and its rows — as grey lines in
 * those rows' own heights, so nothing under it moves when the figures
 * come. «Надійшло» and «Звіт про продажі». `said`, for a reader: the
 * report's «Рахуємо…»; none where the screen says it already.
 */
export function TableWait({
  said,
  className,
  sections,
}: {
  said?: string;
  /** The table's own class, where it has one: its rows' heights. */
  className?: string;
  sections: { title?: string; rows: WaitRow[] }[];
}): JSX.Element {
  return (
    <div className="money-table-wrap table-wait">
      {said !== undefined && (
        <p role="status" className="visually-hidden">
          {said}
        </p>
      )}
      <table
        className={className ? `money-table ${className}` : "money-table"}
        aria-hidden="true"
      >
        <thead>
          <tr>
            <td className="money-unit">
              <Grey words="грн" />
            </td>
            <th scope="col">
              <Grey words="Магазин" />
            </th>
          </tr>
        </thead>
        {sections.map((section, at) => (
          <tbody key={section.title ?? at}>
            {section.title !== undefined && (
              <tr className="report-section">
                <th scope="rowgroup" colSpan={2}>
                  <span className="t-label">
                    <Grey words={section.title} />
                  </span>
                </th>
              </tr>
            )}
            {section.rows.map((row) => (
              <tr
                key={row.label}
                className={row.total ? "money-total" : undefined}
              >
                <th scope="row">
                  <Grey words={row.label} />
                </th>
                <td>
                  <Grey words="0,00" />
                  {row.meta !== undefined && (
                    <span className="report-meta">
                      <Grey words={row.meta} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
