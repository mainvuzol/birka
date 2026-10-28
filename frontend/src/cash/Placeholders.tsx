import type { JSX } from "react";

/**
 * «Каса»'s places while it is read (cash task list, P2-2): grey blocks in
 * the size of what is to come — sized by text never seen, so a line wraps
 * as the one it stands for — so nothing jumps under the finger when it
 * comes. A screen reader still hears the words that were there before.
 */

/** A line's place, its sizing text hidden even where a theme forces
 * colours. */
function Line({ size }: { size: string }): JSX.Element {
  return (
    <span className="skeleton-line">
      <span>{size}</span>
    </span>
  );
}

/** A screen's context line, in its own slot: sized by `size`. */
export function ContextPlaceholder({ size }: { size: string }): JSX.Element {
  return (
    <p className="cash-context" aria-hidden="true">
      <Line size={size} />
    </p>
  );
}

/** The card «Закрити касу» — for whoever may close — and two rows; where
 * the drawer stands is `ContextPlaceholder`, above what is kept. */
export function DrawerPlaceholder({ card }: { card: boolean }): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо касу…
      </p>
      <div className="placeholder" aria-hidden="true">
        {card && (
          <div className="cash-card cash-card-skeleton">
            <span className="cash-card-title">Закрити касу</span>
            <span className="cash-card-hint">
              Скільки мало бути — покажемо після підрахунку
            </span>
          </div>
        )}
        <div className="cash-rows">
          {[0, 1].map((n) => (
            <div className="sale-row cash-row" key={n}>
              <span className="sale-main">
                <span className="skeleton skeleton-name" />
                <span className="skeleton skeleton-meta" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** One operation whose way is to be changed: what, its sum, its way, and
 * the ways' row. */
export function OperationPlaceholder(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо операцію…
      </p>
      <div className="placeholder" aria-hidden="true">
        <div className="fix-card">
          <p className="fix-what">
            <Line size="Продаж · 00:00" />
          </p>
          <p className="fix-sum">
            <span className="sum">
              <Line size={"000,00\u00a0грн"} />
            </span>
          </p>
          <span className="skeleton skeleton-pill" />
        </div>
        <div className="pay-ways fix-ways">
          {[0, 1, 2].map((n) => (
            <span className="skeleton skeleton-way" key={n} />
          ))}
        </div>
      </div>
    </>
  );
}

/** A close's three figures, as its result shows them. */
export function ClosePlaceholder(): JSX.Element {
  return (
    <>
      <p role="status" className="visually-hidden">
        Завантажуємо закриття…
      </p>
      <div className="owed-card cash-figures placeholder" aria-hidden="true">
        {["Мало бути", "Порахували"].map((what) => (
          <div className="cash-figure" key={what}>
            <p className="owed-what">
              <Line size={what} />
            </p>
            <p className="cash-sum">
              <span className="sum">
                <Line size={"0\u00a0000,00\u00a0грн"} />
              </span>
            </p>
          </div>
        ))}
        <p className="cash-difference">
          <Line size={"Нестача 00,00\u00a0грн"} />
        </p>
      </div>
    </>
  );
}
