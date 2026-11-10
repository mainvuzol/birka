import type { JSX, ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

/** What a sticker means, each in its colours (spec §5.3, §6.18): a debt,
 * a warning or paper, a kept operation not yet confirmed, a drawer counted
 * to the kopeck, paid or recorded, on its way, held or online, done with
 * and grey; `neutral` says a thing by the way in pencil. None: ink on the
 * fold. */
export type Tone =
  | "debt"
  | "warn"
  | "kept"
  | "match"
  | "paid"
  | "transit"
  | "online"
  | "offline"
  | "neutral";

/** Each meaning's own glyph, so a colour is never all a sticker says
 * (direction §4, «Смысловые цвета — всегда с двойником-формой»; audit
 * after stage 2, frame P1-5). Brought by the tone; a screen may draw
 * another of its meaning — an order at the post office its building — but
 * never none. */
const glyphs = {
  debt: "owed",
  warn: "warning",
  kept: "eyelet-dashed",
  match: "eyelet-knot",
  paid: "collected",
  transit: "sent",
  online: "held",
} as const satisfies Record<Exclude<Tone, "offline" | "neutral">, IconName>;

/**
 * A status as a printed label (spec §6.18): 28 high, its corners the
 * sticker's 3, a glyph of 16 and a word of 14/600, on its meaning's ground
 * (audit after stage 2, frame P1-5). The one sticker of the app: every
 * other is this, the lint holding it. Its words are the screen's own.
 * `hidden` where a sentence beside it says it all to a reader.
 */
export function Sticker({
  tone,
  icon,
  as: Tag = "span",
  className,
  hidden = false,
  children,
}: {
  tone?: Tone | undefined;
  icon?: IconName | undefined;
  as?: "span" | "p";
  className?: string | undefined;
  hidden?: boolean;
  children: ReactNode;
}): JSX.Element {
  const glyph =
    icon ??
    (tone === undefined || tone === "offline" || tone === "neutral"
      ? undefined
      : glyphs[tone]);
  return (
    <Tag
      className={[
        "sticker",
        tone === undefined ? null : `tone-${tone}`,
        className ?? null,
      ]
        .filter((part) => part !== null)
        .join(" ")}
      aria-hidden={hidden || undefined}
    >
      {glyph !== undefined && <Icon name={glyph} size={16} />}
      {children}
    </Tag>
  );
}
