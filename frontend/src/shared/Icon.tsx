import type { JSX } from "react";

import { icons } from "./icons";
import type { IconName } from "./icons";

/**
 * One icon of the set (spec §5.9; «Усе на бірці» task list, P0-1): 24 on
 * tabs and rows, 20 on buttons and stickers, 16 in a meta line. Never read
 * aloud: the word beside it says what it means. Its inside is the set's own
 * constant markup, never anything typed or answered.
 */
export function Icon({
  name,
  size = 24,
  className,
}: {
  name: IconName;
  size?: 24 | 20 | 16;
  className?: string;
}): JSX.Element {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
