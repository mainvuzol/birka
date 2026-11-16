import type { JSX } from "react";
import { Sticker } from "@/shared/Sticker";
import type { Tone } from "@/shared/Sticker";
import type { IconName } from "@/shared/icons";
import { statusLabels } from "./invoiceWords";
import type { InvoiceStatus } from "./types";

const stickers: Record<
  Exclude<InvoiceStatus, "OPEN">,
  { tone: Tone; icon?: IconName }
> = {
  SETTLED: { tone: "paid" },
  WRITTEN_OFF: { tone: "offline", icon: "minus" },
  CANCELLED: { tone: "offline", icon: "close" },
};

/**
 * A closed invoice's status as a printed sticker (spec §6.18; stage 2,
 * money task list, P0-1): its glyph and its word — «Сплачено повністю» in
 * the paid's green with the paid's own mark, «Залишок списано» grey with
 * its minus, as a customer's «Сплачено» and «Списано» (audit 2026-11-15,
 * money P2-1); «Скасовано» grey with its cross.
 */
export function InvoiceSticker({
  status,
}: {
  status: Exclude<InvoiceStatus, "OPEN">;
}): JSX.Element {
  const { tone, icon } = stickers[status];
  return (
    <Sticker tone={tone} icon={icon}>
      {statusLabels[status]}
    </Sticker>
  );
}
