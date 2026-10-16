import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import { money } from "@/orders/types";
import { sizeLabel } from "@/returns/types";
import type { Store } from "@/orders/types";
import { visible } from "@/shared/visible";
import { submitReturnToSupplier } from "./commands";
import { submitInvoiceCommand, useInvoiceCommand } from "./invoiceCommands";
import type { Borrowed as Lot, BorrowedPage } from "./types";

const pageSize = 20;

/**
 * Goods borrowed from another shop, and goods under consignment (owner
 * decisions, 2026-10-01).
 *
 * They arrive through «Прийняти товар», from a supplier, at a price agreed
 * for each, and the till sells them as any goods. Here the owner or a
 * manager marks some sold — an invoice in «Накладні» for their price — or
 * sends unsold ones back to the supplier for nothing. A mistaken «Продано»
 * is undone by cancelling its invoice; a return, by cancelling the return.
 */
export function Borrowed({
  store,
  token,
  journalKey,
  invoiceJournalKey,
  blocked,
}: {
  store: Store;
  token: string;
  /** The returns' journal, which a return of borrowed goods goes through. */
  journalKey: string;
  /** The invoices' journal, which a mark of sold goes through. */
  invoiceJournalKey: string;
  blocked: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  const [onHandOnly, setOnHandOnly] = useState(true);
  const [shown, setShown] = useState(pageSize);
  const [done, setDone] = useState<string | null>(null);
  const invoiceCommand = useInvoiceCommand();
  const lots = useQuery({
    queryKey: ["borrowed", store.id, onHandOnly, shown],
    queryFn: () =>
      api<BorrowedPage>(
        `/borrowed?store_id=${store.id}&limit=${String(shown)}${
          onHandOnly ? "" : "&on_hand=false"
        }`,
        token,
      ),
    retry: false,
  });

  async function changed(message: string): Promise<void> {
    setDone(message);
    await Promise.all(
      ["borrowed", "supplier-invoices", "supplier-returns", "stock"].map(
        (name) => cache.invalidateQueries({ queryKey: [name, store.id] }),
      ),
    );
  }

  return (
    <section aria-label="Позичене й під реалізацію">
      <h3>Позичене й під реалізацію</h3>
      <p className="hint">
        Товар інших магазинів і постачальників: сплачують лише продане, за
        домовленою ціною, непродане повертають. Береться через «Прийняти товар».
      </p>
      {invoiceCommand.pending && (
        <p className="notice">
          Незавершена операція з накладною: перевірте її в «Накладних».
        </p>
      )}
      {done && <p role="status">{done}</p>}
      <label>
        Показати
        <select
          value={onHandOnly ? "ON_HAND" : "ALL"}
          onChange={(event) => {
            setOnHandOnly(event.target.value === "ON_HAND");
            setShown(pageSize);
          }}
        >
          <option value="ON_HAND">Ще на руках</option>
          <option value="ALL">Усе, разом із проданим і поверненим</option>
        </select>
      </label>
      {lots.isPending ? (
        <p role="status">Завантажуємо позичене…</p>
      ) : lots.error ? (
        <p role="alert">{errorText(lots.error)}</p>
      ) : lots.data.items.length === 0 ? (
        <p>
          {onHandOnly
            ? "Позиченого на руках немає."
            : "Цей магазин нічого не позичав."}
        </p>
      ) : (
        <>
          {lots.data.items.map((lot) => (
            <LotCard
              key={lot.stock_lot_id}
              lot={lot}
              store={store}
              disabled={blocked}
              sell={async (quantity) => {
                const outcome = await submitInvoiceCommand(
                  invoiceJournalKey,
                  token,
                  {
                    // The mark's permanent name, made once: a resend after a
                    // lost answer comes from the journal, which keeps it.
                    key: crypto.randomUUID(),
                    body: {
                      kind: "sold",
                      command_id: crypto.randomUUID(),
                      store_id: store.id,
                      stock_lot_id: lot.stock_lot_id,
                      quantity,
                    },
                  },
                );
                if (outcome.kind === "done") {
                  await changed(
                    `Продано ${String(quantity)} од.: у «Накладних» борг «${visible(lot.supplier.name)}» ${money(outcome.result.amount)}.`,
                  );
                  return null;
                }
                return outcome.kind === "refused"
                  ? refusalText(outcome.error)
                  : null;
              }}
              sendBack={async (quantity) => {
                const outcome = await submitReturnToSupplier(
                  journalKey,
                  token,
                  {
                    key: crypto.randomUUID(),
                    body: {
                      command_id: crypto.randomUUID(),
                      store_id: store.id,
                      location_id: lot.location_id,
                      supplier_id: lot.supplier.id,
                      lines: [
                        {
                          product_variant_id: lot.held_as_variant_id,
                          size_id: lot.size_id,
                          quantity,
                        },
                      ],
                      note: null,
                      stock_lot_id: lot.stock_lot_id,
                    },
                  },
                );
                if (outcome.kind === "done") {
                  await changed(
                    `Повернено постачальнику «${visible(lot.supplier.name)}»: ${String(quantity)} од.`,
                  );
                  return null;
                }
                return outcome.kind === "refused"
                  ? refusalText(outcome.error)
                  : null;
              }}
            />
          ))}
          {lots.data.has_more && (
            <button
              className="quiet"
              disabled={lots.isFetching}
              onClick={() => {
                setShown(shown + pageSize);
              }}
            >
              Показати ще
            </button>
          )}
        </>
      )}
    </section>
  );
}

function LotCard({
  lot,
  store,
  disabled,
  sell,
  sendBack,
}: {
  lot: Lot;
  store: Store;
  disabled: boolean;
  sell: (quantity: number) => Promise<string | null>;
  sendBack: (quantity: number) => Promise<string | null>;
}): JSX.Element {
  const [count, setCount] = useState("1");
  const [problem, setProblem] = useState<string | null>(null);
  const maySell = store.permissions.includes("supplier:debt");

  function quantity(): number | null {
    const value = Number(count);
    if (!/^\d+$/.test(count) || value < 1) {
      setProblem("Вкажіть, скільки одиниць.");
      return null;
    }
    if (value > lot.on_hand) {
      setProblem(`На руках лише ${String(lot.on_hand)} од.`);
      return null;
    }
    return value;
  }

  return (
    <article
      className="order-card"
      aria-label={`${visible(lot.display_name)}, ${visible(lot.size ?? "")} від ${visible(lot.supplier.name)}`}
    >
      <strong>
        {visible(lot.display_name)}, {sizeLabel(lot.size)}
      </strong>
      <small>
        {lot.acquisition_type === "BORROWED" ? "Позичено" : "Під реалізацію"} у
        «{visible(lot.supplier.name)}» · {when(lot.at)} ·{" "}
        {visible(lot.location_name)}
      </small>
      <p>
        {lot.unit_cost ? `${money(lot.unit_cost)} за од. · ` : ""}взято{" "}
        {lot.received} · продано {lot.sold} · повернено {lot.returned} · на
        руках <strong>{lot.on_hand}</strong>
      </p>
      {lot.on_hand > 0 && (
        <fieldset disabled={disabled}>
          <label>
            Скільки одиниць
            <input
              inputMode="numeric"
              value={count}
              onChange={(event) => {
                setCount(event.target.value.replace(/\D/g, ""));
                setProblem(null);
              }}
            />
          </label>
          <div className="actions">
            {maySell && (
              <button
                type="button"
                onClick={() => {
                  const value = quantity();
                  if (value !== null)
                    void sell(value).then((refusal) => {
                      setProblem(refusal);
                    });
                }}
              >
                Продано
              </button>
            )}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                const value = quantity();
                if (value !== null)
                  void sendBack(value).then((refusal) => {
                    setProblem(refusal);
                  });
              }}
            >
              Повернути постачальнику
            </button>
          </div>
        </fieldset>
      )}
      {problem && <p role="alert">{problem}</p>}
    </article>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA");
}

function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "INSUFFICIENT_STOCK")
      return "На складі цього товару вже менше: можливо, його продали. Позначте проданим.";
    switch (error.details.reason) {
      case "MORE_THAN_ON_HAND":
        return `На руках лише ${String(error.details.on_hand)} од.`;
      case "NO_PRICE":
        return "Для цього товару не вказали домовлену ціну.";
    }
  }
  return errorText(error);
}
