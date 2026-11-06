import type { JSX } from "react";
import { Icon } from "@/shared/Icon";
import type { IconName } from "@/shared/icons";
import { statusLabels } from "./invoiceWords";
import type { InvoiceStatus } from "./types";

const stickers: Record<
  Exclude<InvoiceStatus, "OPEN">,
  { tone: string; icon: IconName }
> = {
  SETTLED: { tone: "tone-paid", icon: "check" },
  WRITTEN_OFF: { tone: "", icon: "minus" },
  CANCELLED: { tone: "tone-offline", icon: "close" },
};

/**
 * A closed invoice's status as a printed sticker (spec §6.18; stage 2,
 * money task list, P0-1): its glyph and its word — «Сплачено повністю» in
 * the paid's green, «Залишок списано» in ink, «Скасовано» grey.
 */
export function InvoiceSticker({
  status,
}: {
  status: Exclude<InvoiceStatus, "OPEN">;
}): JSX.Element {
  const { tone, icon } = stickers[status];
  return (
    <span className={tone ? `sticker ${tone}` : "sticker"}>
      <Icon name={icon} size={16} />
      {statusLabels[status]}
    </span>
  );
}
