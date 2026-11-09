import type { JSX, ReactNode } from "react";
import { Back } from "./Back";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { ScreenHeader } from "./ScreenHeader";

/** A section under «Ще»: its label, held by its own section's rule. */
export interface MoreRow {
  key: string;
  label: string;
  /** Its glyph at 24, before the label (spec S07; «Усе на бірці» task
   * list, P1-5). */
  icon: IconName;
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
  /** Where it goes back to, when not «Ще»: «Сьогодні», whose tag opened
   * it («Усе на бірці» task list, P0-6). */
  to?: string;
}

/**
 * «Ще», a screen of its own (spec S07; «Усе на бірці» task list, P0-4,
 * P1-5): every place that is not a tab, by the design's groups in its order
 * — a group with nothing in it not shown — a row each, its glyph, named as
 * its screen's heading, what waits there under it, its chevron; this
 * phone's switches as switches; at its foot, who is signed in and until
 * when. A group's own list, «Товар і каталог», is the same screen under its
 * own name, with «← Ще».
 */
export function More({
  title = "Ще",
  groups,
  back,
  foot,
}: {
  title?: string;
  groups: readonly MoreGroup[];
  /** A group's own list: back to «Ще». */
  back?: MoreBack | undefined;
  /** Under the groups: «Ви увійшли як … · сесія до …». */
  foot?: string | undefined;
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
                {/* The group's rows on a white block, its label on the
                    paper (spec S07, §6.8; audit after stage 2, frame
                    P0-1). */}
                <div className="list-block">
                  {group.rows.map((row) =>
                    row.on === undefined ? (
                      <button
                        key={row.key}
                        type="button"
                        className="sale-row more-row"
                        disabled={row.disabled}
                        onClick={row.open}
                      >
                        <Icon name={row.icon} />
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
                        <Icon
                          name="chevron-right"
                          size={16}
                          className="sale-open"
                        />
                      </button>
                    ) : (
                      <button
                        key={row.key}
                        type="button"
                        role="switch"
                        aria-checked={row.on}
                        className="sale-row more-row more-switch"
                        disabled={row.disabled}
                        onClick={row.open}
                      >
                        <Icon name={row.icon} />
                        <span className="more-label">{row.label}</span>
                        <span className="switch-track" aria-hidden="true">
                          <span className="switch-knob" />
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </nav>
        )}
        {foot !== undefined && <p className="t-meta more-foot">{foot}</p>}
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
  const to = back.to ?? "Ще";
  return (
    <Back
      go={back.go}
      held={back.held}
      label={`Назад до «${to}»`}
      className="quiet back to-more"
    >
      <span aria-hidden="true">← </span>
      {to}
    </Back>
  );
}
