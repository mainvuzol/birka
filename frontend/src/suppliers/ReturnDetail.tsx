import { useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, isConflict } from "@/shared/api";
import { Back } from "@/shared/Back";
import { Icon } from "@/shared/Icon";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { buzz } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import { Sticker } from "@/shared/Sticker";
import { money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { shortDay, shortWhen } from "@/credits/format";
import { Reasoned, noAnswer } from "./InvoiceActions";
import { lineText, placeText, refusalText } from "./returnWords";
import type { ReturnPage, SetOff, SupplierReturn } from "./types";

/**
 * One return to a supplier (stage 2, money task list, P0-4): the supplier
 * its title; when, where from and who; its goods, its note, and what the
 * supplier counted of it, each with «Відкрити накладну ›» for whoever keeps
 * the invoices (P1-3). Quiet at the bottom, «Скасувати повернення» asks why
 * in a sheet; while a set-off stands it is not cancelled (owner decision,
 * 2026-10-01), and says so instead. No MainButton: a cancel is not the
 * screen's main action. A unit from «Брак» is cancelled through «Брак», as
 * before.
 */
export function ReturnDetail({
  store,
  token,
  item: opened,
  held,
  back,
  openInvoice,
}: {
  store: Store;
  token: string;
  /** The return as the list showed it. */
  item: SupplierReturn;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  held: boolean;
  /** «← Постачальникам». */
  back: () => void;
  /** A set-off's invoice, for whoever keeps the invoices; held while
   * «Накладні» are. */
  openInvoice?: { go: (setOff: SetOff) => void; held: boolean } | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  // The return as it is now — a set-off cancelled in «Накладних» meanwhile
  // is gone: there is no read of one, so its supplier's are read.
  const fresh = useQuery({
    queryKey: ["supplier-returns", store.id, "of", opened.supplier.id],
    queryFn: () =>
      api<ReturnPage>(
        `/supplier-returns?store_id=${store.id}&supplier_id=${opened.supplier.id}&limit=50`,
        token,
      ),
    retry: false,
  });
  // A cancel's own answer: a return older than its supplier's fifty newest
  // is not in that read.
  const [answered, setAnswered] = useState<SupplierReturn | null>(null);
  const item =
    fresh.data?.items.find((one) => one.id === opened.id) ?? answered ?? opened;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = useRef<HTMLHeadingElement>(null);

  async function changed(): Promise<void> {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
      cache.invalidateQueries({ queryKey: ["sale-stock"] }),
      cache.invalidateQueries({ queryKey: ["damaged-units", store.id] }),
    ]);
  }

  async function undo(reason: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      // A unit from «Брак» comes back through «Брак». Pressed twice, either
      // is answered as it is: a return is cancelled once.
      if (item.damaged_unit_id)
        await api(
          `/damaged-units/${item.damaged_unit_id}/cancel-supplier-return`,
          token,
          { supplier_return_id: item.id, reason },
        );
      else
        setAnswered(
          await api<SupplierReturn>(
            `/supplier-returns/${item.id}/cancel`,
            token,
            { reason },
          ),
        );
      buzz("success");
      // Read again before the sheet goes: its button is never there twice.
      await changed();
      setAsking(false);
    } catch (error) {
      if (error instanceof ApiError) {
        buzz("error");
        if (isConflict(error)) void changed();
        setAsking(false);
        setProblem(refusalText(error));
      } else setProblem(noAnswer);
    } finally {
      setBusy(false);
    }
  }

  const standing = item.set_offs.length > 0;
  return (
    <>
      <ScreenHeader
        ref={name}
        focusable
        title={visible(item.supplier.name)}
        back={
          <Back go={back} held={busy}>
            <span aria-hidden="true">← </span>
            Постачальникам
          </Back>
        }
      />
      <section className="supplier-return">
        <p className="t-meta">
          {shortWhen(item.at)} · {placeText(item)} · {visible(item.by)}
        </p>
        {item.cancelled && (
          <p className="supplier-return-cancelled" role="status">
            <Sticker tone="offline" icon="close">
              Скасовано
            </Sticker>
            <span className="t-meta">
              {shortDay(item.cancelled.at)} · {visible(item.cancelled.reason)} ·{" "}
              {visible(item.cancelled.by)}
            </span>
          </p>
        )}
        <ul className="supplier-return-lines" aria-label="Що повернули">
          {item.lines.map((line) => (
            <li
              className="t-row"
              key={`${line.product_variant_id}:${line.size_id}`}
            >
              {lineText(line)}
            </li>
          ))}
        </ul>
        {item.note && <p className="t-meta">{visible(item.note)}</p>}
        {standing && (
          <ul
            className="supplier-return-set-offs"
            aria-label="Зараховано в накладні"
          >
            {item.set_offs.map((setOff) => (
              <li key={setOff.entry_id}>
                <span>
                  Постачальник зарахував {money(setOff.amount)} у накладну ·{" "}
                  {shortDay(setOff.at)}
                </span>
                {openInvoice && (
                  <button
                    type="button"
                    className="quiet set-off-open"
                    disabled={openInvoice.held || busy}
                    onClick={() => {
                      openInvoice.go(setOff);
                    }}
                  >
                    Відкрити накладну
                    <Icon name="chevron-right" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {problem && !asking && <p role="alert">{problem}</p>}
        {item.cancelled ? null : standing ? (
          // The goods stay with the supplier while it counts them (owner
          // decision, 2026-10-01).
          <p className="hint">
            Щоб скасувати повернення, спершу скасуйте залік у «Накладних».
          </p>
        ) : (
          <button
            type="button"
            className="quiet supplier-return-cancel"
            disabled={held || busy}
            onClick={() => {
              setProblem(null);
              setAsking(true);
            }}
          >
            Скасувати повернення
          </button>
        )}
      </section>
      {asking && (
        <Reasoned
          title="Скасувати повернення"
          question={`Товар повернеться ${
            item.damaged_unit_id ? "у «Брак»" : "на склад"
          } «${visible(item.location_name)}». Скасувати можна лише раз.`}
          label="Чому скасовуємо"
          confirm="Так, скасувати повернення"
          back="Не скасовувати"
          held={held}
          busy={busy}
          problem={problem}
          fallback={name}
          close={() => {
            setAsking(false);
            setProblem(null);
          }}
          run={(reason) => {
            void undo(reason);
          }}
        />
      )}
    </>
  );
}
