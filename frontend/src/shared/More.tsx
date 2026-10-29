import type { JSX, ReactNode } from "react";
import { Back } from "./Back";
import { ScreenHeader } from "./ScreenHeader";

/** A section under «Ще»: its label, held by its own section's rule. */
export interface MoreRow {
  key: string;
  label: string;
  /** Under the label: what waits, or what the row holds — its words, or a
   * line that reads them itself and draws its own `.more-meta`. */
  meta?: ReactNode;
  disabled: boolean;
  open: () => void;
  /** A switch of this phone's, not a screen: on or off. */
  on?: boolean;
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
 * «Ще», a screen of its own (spec S07; «Усе на бірці» task list, P0-4):
 * every place that is not a tab, by the design's groups in its order — a
 * group with nothing in it not shown — a row each, named as its screen's
 * heading, with its chevron; this phone's switches as switches. A group's
 * own list, «Товар і каталог», is the same screen under its own name, with
 * «← Ще».
 */
export function More({
  title = "Ще",
  groups,
  back,
}: {
  title?: string;
  groups: readonly MoreGroup[];
  /** A group's own list: back to «Ще». */
  back?: MoreBack | undefined;
}): JSX.Element {
  const shown = groups.filter((group) => group.rows.length > 0);
  return (
    <>
      <ScreenHeader
        title={title}
        back={back && <BackToMore back={back} />}
      />
      <section className="more-screen">
        {/* Not a row of buttons, as other navs are: a list of rows. */}
        {shown.length > 0 && (
          <nav aria-label={title} className="more-list">
            {shown.map((group) => (
              <div className="more-group" key={group.title}>
                {group.title !== "" && <h3>{group.title}</h3>}
                {group.rows.map((row) =>
                  row.on === undefined ? (
                    <button
                      key={row.key}
                      type="button"
                      className="sale-row"
                      disabled={row.disabled}
                      onClick={row.open}
                    >
                      <span className="more-label">
                        {row.label}
                        {/* Read as two words, not run together. */}
                        {row.meta !== undefined && " "}
                        {typeof row.meta === "string" ? (
                          <span className="more-meta">{row.meta}</span>
                        ) : (
                          row.meta
                        )}
                      </span>
                      <span className="sale-open" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ) : (
                    <button
                      key={row.key}
                      type="button"
                      role="switch"
                      aria-checked={row.on}
                      className="sale-row more-switch"
                      disabled={row.disabled}
                      onClick={row.open}
                    >
                      <span className="more-label">{row.label}</span>
                      <span className="switch-track" aria-hidden="true">
                        <span className="switch-knob" />
                      </span>
                    </button>
                  ),
                )}
              </div>
            ))}
          </nav>
        )}
      </section>
    </>
  );
}

/**
 * «← Ще» over a section opened from «Ще», leading back to its groups; read
 * «Назад до «Ще»», as «← Каса» is read «Назад до каси». Held, as «Ще» is,
 * only while a first send is in flight (review, 2026-10-26).
 */
export function BackToMore({ back }: { back: MoreBack }): JSX.Element {
  return (
    <Back
      go={back.go}
      held={back.held}
      label="Назад до «Ще»"
      className="quiet back to-more"
    >
      <span aria-hidden="true">← </span>Ще
    </Back>
  );
}
