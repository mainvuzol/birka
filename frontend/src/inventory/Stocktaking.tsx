import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, readText } from "@/shared/api";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { visible } from "@/shared/visible";
import type { Location, Store } from "@/orders/types";
import { CatalogPicker } from "./CatalogPicker";
import { Correction } from "./Correction";
import type { Corrected } from "./Correction";
import { Stocktake, Stocktakes } from "./Stocktake";
import { useAdjustmentCommand } from "./adjustmentCommands";
import { reasonLabels } from "./adjustmentTypes";
import type { ReceivableVariant, SizeOption } from "./receiptTypes";
import { useCountCommand } from "./stocktakeCommands";
import type { StocktakeRecord } from "./stocktakeTypes";

/**
 * «Інвентаризація» (sections task list, P1-5): a warehouse's stocktake, and
 * goods found that the system holds none of, on a screen of their own —
 * «Ще» › «Товар» › «Інвентаризація», or a model's ⋯. Moved as they were
 * from «Залишки», whose list the till's search and the model's detail
 * replace (P0-6); drawn anew only in stage 2.
 *
 * Only a warehouse whose stock may be corrected is offered — active,
 * received into, never «Брак» — chosen by the person while there are two
 * or more, never by the screen; the only one is said and taken. Counting
 * replaces the rest until the person leaves it (owner decisions,
 * 2026-10-10; ADR-0022).
 */
export function Stocktaking({
  store,
  token,
  scopeKey,
  journalKey,
  countKey,
  blocked,
  back,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  /** Where a correction is kept until it is settled. */
  journalKey: string;
  /** Where a stocktake's count is kept until it is settled. */
  countKey: string;
  blocked: boolean;
  /** «← Ще», or «← {модель}» from a model's ⋯. */
  back: MoreBack;
}): JSX.Element | null {
  const cache = useQueryClient();
  const [chosen, setChosen] = useState("");
  const [lost, setLost] = useState(false);
  const [counting, setCounting] = useState<StocktakeRecord | null>(null);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<Corrected | null>(null);
  // A correction and a count each wait for the other to settle.
  const adjustment = useAdjustmentCommand();
  const countCommand = useCountCommand();
  const correcting =
    blocked || countCommand.busy || countCommand.pending !== null;
  // A count not yet settled holds the finish, a new start and a return to
  // counting too: the sums would be frozen without it (review, 2026-10-10).
  const countingBlocked =
    blocked ||
    adjustment.busy ||
    adjustment.pending !== null ||
    countCommand.busy ||
    countCommand.pending !== null;
  const allowed = store.permissions.includes("inventory:adjust");
  const locations = useQuery({
    queryKey: ["inventory-locations", scopeKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    enabled: allowed,
    retry: false,
  });
  // Adjusting a warehouse is receiving into it as far as access goes: the
  // server requires `can_receive` there, and refuses a paused one. «Брак»
  // changes only through returns and its own section (owner decision,
  // 2026-10-01).
  const fixable = (locations.data ?? []).filter(
    (location) =>
      location.is_active && location.can_receive && !location.damaged_returns,
  );
  const only = fixable.length === 1 ? fixable[0] : undefined;
  const selected = fixable.find((location) => location.id === chosen) ?? only;

  useEffect(() => {
    // Revocation clears the selection; later access never restores it
    // implicitly.
    if (
      chosen &&
      locations.isSuccess &&
      !locations.data.some(
        (location) =>
          location.id === chosen &&
          location.is_active &&
          location.can_receive &&
          !location.damaged_returns,
      )
    ) {
      setChosen("");
      setLost(true);
      setCounting(null);
      setFinding(false);
    }
  }, [chosen, locations.isSuccess, locations.data]);

  function done(result: Corrected): void {
    setFinding(false);
    setFound(result);
    void cache.invalidateQueries({ queryKey: ["inventory-stock"] });
  }

  // Never opened without the right: nothing is said of the rule
  // («Усе на бірці» task list, P2-1).
  if (!allowed) return null;

  return (
    <>
      <ScreenHeader title="Інвентаризація" back={<BackToMore back={back} />} />
      <section className="stocktaking">
        {lost && (
          <p role="status">
            Обраний склад більше не доступний. Оберіть інший склад зі списку.
          </p>
        )}
        {locations.isPending ? (
          <p role="status">Завантажуємо склади…</p>
        ) : locations.error ? (
          <Failure
            error={locations.error}
            retry={() => {
              void locations.refetch();
            }}
          />
        ) : fixable.length === 0 ? (
          // Nothing said of the rule (stage 2, goods task list, P1-5).
          <p>Тут немає складу для інвентаризації.</p>
        ) : (
          <>
            {only ? (
              <p className="t-row stocktaking-place">
                Склад «{visible(only.name)}»
              </p>
            ) : (
              <div className="chips" role="group" aria-label="Склад">
                {fixable.map((location) => (
                  <button
                    type="button"
                    className="chip"
                    key={location.id}
                    aria-pressed={selected?.id === location.id}
                    onClick={() => {
                      setChosen(location.id);
                      setLost(false);
                      setCounting(null);
                      setFinding(false);
                      setFound(null);
                    }}
                  >
                    {visible(location.name)}
                  </button>
                ))}
              </div>
            )}
            {selected &&
              // A count is its warehouse's: the only one gone and another
              // the only one now, it is never counted there (review,
              // 2026-11-01).
              (counting?.location_id === selected.id ? (
                <Stocktake
                  store={store}
                  token={token}
                  scopeKey={scopeKey}
                  journalKey={countKey}
                  blocked={countingBlocked}
                  location={selected}
                  record={counting}
                  onLeave={() => {
                    setCounting(null);
                    void cache.invalidateQueries({
                      queryKey: ["inventory-stock"],
                    });
                  }}
                />
              ) : (
                <>
                  <Stocktakes
                    store={store}
                    token={token}
                    scopeKey={scopeKey}
                    blocked={countingBlocked}
                    location={selected}
                    canCount
                    onCount={(record) => {
                      setCounting(record);
                      setFinding(false);
                      setFound(null);
                    }}
                  />
                  {found && (
                    <p role="status">
                      Коригування записано: {visible(found.target.name)} ·{" "}
                      {visible(found.target.size)} —{" "}
                      {reasonLabels[found.reason]}, облік{" "}
                      {found.adjustment.quantity_before} →{" "}
                      {found.adjustment.quantity_after}.
                    </p>
                  )}
                  {store.permissions.includes("inventory:receive") &&
                    (finding ? (
                      <FoundGoods
                        key={selected.id}
                        store={store}
                        token={token}
                        scopeKey={scopeKey}
                        journalKey={journalKey}
                        blocked={correcting}
                        locationId={selected.id}
                        onDone={done}
                        onCancel={() => {
                          setFinding(false);
                        }}
                        onRefused={() => {
                          void cache.invalidateQueries({
                            queryKey: ["inventory-stock"],
                          });
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="quiet"
                        disabled={blocked}
                        onClick={() => {
                          setFinding(true);
                          setFound(null);
                        }}
                      >
                        Знайшли товар, якого немає в списку
                      </button>
                    ))}
                </>
              ))}
          </>
        )}
      </section>
    </>
  );
}

/**
 * Goods on the shelf that the system holds none of here.
 *
 * Offered as a count against zero, so if the model and size turn out to be
 * held after all — received meanwhile, say — the server refuses it as
 * `STOCK_CHANGED` and says how many, and the form carries on as an ordinary
 * stocktake against that. "Size not known" is never offered: the
 * organization's sizes exclude it.
 */
function FoundGoods({
  store,
  token,
  scopeKey,
  journalKey,
  blocked,
  locationId,
  onDone,
  onCancel,
  onRefused,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  journalKey: string;
  blocked: boolean;
  locationId: string;
  onDone: (corrected: Corrected) => void;
  onCancel: () => void;
  onRefused: () => void;
}): JSX.Element {
  const [variant, setVariant] = useState<ReceivableVariant | null>(null);
  const [sizeId, setSizeId] = useState("");
  const sizes = useQuery({
    queryKey: ["receive-sizes", scopeKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    retry: false,
  });
  const size = sizes.data?.find((option) => option.size_id === sizeId);

  return (
    <section className="notice">
      <h3>Товар, якого немає в списку</h3>
      <p className="hint">
        Знайдіть модель у каталозі й оберіть розмір. Якщо товар уже є в обліку
        цього складу, сервер скаже, скільки саме.
      </p>
      <CatalogPicker
        store={store}
        token={token}
        scopeKey={scopeKey}
        variant={variant}
        onVariant={setVariant}
      />
      <label>
        Розмір
        <select
          value={sizeId}
          onChange={(event) => {
            setSizeId(event.target.value);
          }}
        >
          <option value="">Оберіть розмір</option>
          {(sizes.data ?? []).map((option) => (
            <option key={option.size_id} value={option.size_id}>
              {visible(option.code)}
            </option>
          ))}
        </select>
      </label>
      {sizes.error && (
        <Failure
          error={sizes.error}
          retry={() => {
            void sizes.refetch();
          }}
        />
      )}
      {variant && size ? (
        <Correction
          key={`${variant.product_variant_id}:${size.size_id}`}
          store={store}
          token={token}
          journalKey={journalKey}
          blocked={blocked}
          locationId={locationId}
          target={{
            product_variant_id: variant.product_variant_id,
            size_id: size.size_id,
            name: variant.display_name,
            size: size.code,
            sizeIsUnknown: false,
            quantity: 0,
          }}
          onDone={onDone}
          onCancel={onCancel}
          onRefused={onRefused}
        />
      ) : (
        <button type="button" className="quiet" onClick={onCancel}>
          Скасувати
        </button>
      )}
    </section>
  );
}

function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): JSX.Element {
  return (
    <div role="alert">
      <p>{readText(error)}</p>
      <button onClick={retry}>Спробувати ще раз</button>
    </div>
  );
}
