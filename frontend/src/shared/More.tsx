import type { JSX } from "react";

/** A section under «Ще»: its label, held by its own section's rule. */
export interface MoreRow {
  key: string;
  label: string;
  disabled: boolean;
  open: () => void;
}

export interface MoreGroup {
  title: string;
  rows: MoreRow[];
}

/** «← Ще»: where it goes, and whether it is held. */
export interface MoreBack {
  go: () => void;
  /** A first send in flight: leaving would lose what it answers. */
  held: boolean;
}

/**
 * «Ще», a screen of its own (navigation task list, P0-4; the owner's answers
 * after #142, 2026-10-26): every section that is not the row's, by groups in
 * the direction's order — a group with nothing in it not shown — a row each,
 * named as its screen's heading, with its chevron; «Змінити магазин» last,
 * for whoever has two stores or more, held as the row is.
 */
export function More({
  groups,
  changeStore,
  changeHeld,
}: {
  groups: readonly MoreGroup[];
  /** Absent when the person has one store: there is nothing to change to. */
  changeStore: (() => void) | undefined;
  changeHeld: boolean;
}): JSX.Element {
  const shown = groups.filter((group) => group.rows.length > 0);
  return (
    <section className="more-screen">
      <h2>Ще</h2>
      {/* Not a row of buttons, as other navs are: a list of rows; none
          when «Ще» holds only «Змінити магазин» (review, 2026-10-26). */}
      {shown.length > 0 && (
        <nav aria-label="Ще" className="more-list">
          {shown.map((group) => (
            <div className="more-group" key={group.title}>
              <h3>{group.title}</h3>
              {group.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className="sale-row"
                  disabled={row.disabled}
                  onClick={row.open}
                >
                  <span className="more-label">{row.label}</span>
                  <span className="sale-open" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      )}
      {changeStore && (
        <button
          type="button"
          className="quiet more-change"
          disabled={changeHeld}
          onClick={changeStore}
        >
          Змінити магазин
        </button>
      )}
    </section>
  );
}

/**
 * «← Ще» over a section opened from «Ще», leading back to its groups; read
 * «Назад до «Ще»», as «← Каса» is read «Назад до каси». Held, as «Ще» is,
 * only while a first send is in flight (review, 2026-10-26).
 */
export function BackToMore({ back }: { back: MoreBack }): JSX.Element {
  return (
    <button
      type="button"
      className="quiet back to-more"
      aria-label="Назад до «Ще»"
      disabled={back.held}
      onClick={back.go}
    >
      <span aria-hidden="true">← </span>Ще
    </button>
  );
}
