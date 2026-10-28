import type { JSX, ReactNode } from "react";
import { Eyelet } from "./Eyelet";
import { Icon } from "./Icon";

/**
 * A banner over the screen (spec §6.23; «Усе на бірці» task list, P0-2): its
 * glyph, a title and what to know, in the colours of what it is. Paper —
 * the server is silent, sell on paper; kept — an operation on the phone,
 * not yet confirmed; back — the server answers again; recorded — a kept
 * operation confirmed once; blocked — the store does not trade. Its words
 * are its own: the banner changes only how it looks.
 */
export type BannerKind = "paper" | "kept" | "back" | "recorded" | "blocked";

const glyphs: Record<BannerKind, JSX.Element> = {
  paper: <Icon name="warning" size={20} />,
  kept: <Eyelet state="dashed" size={20} />,
  back: <Icon name="check" size={20} />,
  recorded: <Icon name="check" size={20} />,
  blocked: <Icon name="info" size={20} />,
};

export function Banner({
  kind,
  label,
  role,
  as = "section",
  children,
}: {
  kind: BannerKind;
  /** Its name, where a title inside does not give one. */
  label?: string;
  role?: "status";
  /** A paragraph where it says one thing only. */
  as?: "section" | "div";
  children: ReactNode;
}): JSX.Element {
  const Box = as;
  return (
    <Box
      className={`notice banner banner-${kind}`}
      aria-label={label}
      role={role}
    >
      <span className="banner-glyph">{glyphs[kind]}</span>
      <div className="banner-body">{children}</div>
    </Box>
  );
}
