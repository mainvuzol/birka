import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { Placeholder } from "@/shared/Placeholder";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { visible } from "@/shared/visible";
import type { Location, Store } from "@/orders/types";
import { Correction } from "./Correction";
import type { Corrected, Target } from "./Correction";
import { FoundGoods } from "./FoundGoods";
import { Stocktake, Stocktakes } from "./Stocktake";
import { useAdjustmentCommand } from "./adjustmentCommands";
import { reasonLabels } from "./adjustmentTypes";
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
 * is a task's screen of its own, the menu aside, until the person leaves
 * it (owner decisions, 2026-10-10; ADR-0022; stage 2, goods task list,
 * P0-2, P0-3).
 */
export function Stocktaking({
  store,
  token,
  scopeKey,
  journalKey,
  countKey,
  blocked,
  back,
  task,
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
  /** The menu steps aside while a warehouse is counted (P0-3). */
  task?: (shown: boolean) => void;
}): JSX.Element | null {
  const cache = useQueryClient();
  const [chosen, setChosen] = useState("");
  const [lost, setLost] = useState(false);
  const [counting, setCounting] = useState<StocktakeRecord | null>(null);
  // «Знайшли товар…» open, for the warehouse it was opened for.
  const [findingAt, setFindingAt] = useState<string | null>(null);
  // «Знайшли товар…»'s size tapped: its correction, in a sheet.
  const [fixing, setFixing] = useState<Target | null>(null);
  const [fixFoot, setFixFoot] = useState<HTMLDivElement | null>(null);
  const [found, setFound] = useState<Corrected | null>(null);
  const finder = useRef<HTMLButtonElement>(null);
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
  // It stands for its warehouse alone, and while it may be found: another
  // the only one now, or the right gone, and it is gone with its sheet —
  // never back by itself (review).
  const finding =
    selected !== undefined &&
    findingAt === selected.id &&
    store.permissions.includes("inventory:receive");

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
      setFindingAt(null);
      setFixing(null);
    }
  }, [chosen, locations.isSuccess, locations.data]);
  useEffect(() => {
    if (findingAt !== null && !finding) {
      setFindingAt(null);
      setFixing(null);
    }
  }, [findingAt, finding]);

  // «Знайшли товар…» is a task's screen: the menu aside while it stands
  // (goods task list after stage 2, P1-2).
  useEffect(() => {
    if (!finding) return;
    task?.(true);
    return () => {
      task?.(false);
    };
  }, [finding, task]);
  // Left — by «←», Telegram's «Назад» or a correction recorded — the cursor
  // goes to «Знайшли товар…» where it was pressed, the stub over it.
  const wasFinding = useRef(false);
  useEffect(() => {
    if (wasFinding.current && !finding) finder.current?.focus();
    wasFinding.current = finding;
  }, [finding]);

  function done(result: Corrected): void {
    setFixing(null);
    setFindingAt(null);
    setFound(result);
    void cache.invalidateQueries({ queryKey: ["inventory-stock"] });
  }

  // Never opened without the right: nothing is said of the rule
  // («Усе на бірці» task list, P2-1).
  if (!allowed) return null;

  // A count is its warehouse's: the only one gone and another the only one
  // now, it is never counted there (review, 2026-11-01).
  if (selected && counting?.location_id === selected.id)
    return (
      <Stocktake
        store={store}
        token={token}
        scopeKey={scopeKey}
        journalKey={countKey}
        blocked={countingBlocked}
        location={selected}
        record={counting}
        task={task}
        onLeave={() => {
          setCounting(null);
          window.scrollTo(0, 0);
          void cache.invalidateQueries({
            queryKey: ["inventory-stock"],
          });
        }}
      />
    );

  // Goods the list does not show, on their screen; a size tapped, the
  // correction's sheet over it, Telegram's MainButton its one button
  // (P1-2).
  if (selected && finding)
    return (
      <>
        <FoundGoods
          key={selected.id}
          store={store}
          token={token}
          scopeKey={scopeKey}
          blocked={correcting}
          back={{
            go: () => {
              setFindingAt(null);
              setFixing(null);
            },
            label: "Назад до інвентаризації",
          }}
          pick={(variant, size) => {
            setFixing({
              product_variant_id: variant.product_variant_id,
              size_id: size.size_id,
              name: variant.display_name,
              size: size.code,
              sizeIsUnknown: false,
              quantity: 0,
            });
          }}
        />
        {fixing && (
          <Sheet
            title={`${visible(fixing.name)} · ${visible(fixing.size)}`}
            close={() => {
              // The form's answer is waited for: it is the screen's to say.
              if (!adjustment.busy) setFixing(null);
            }}
            fallback={finder}
            // The form's own button, outside Telegram, kept in view under
            // it.
            foot={<div ref={setFixFoot} />}
          >
            <Correction
              key={`${fixing.product_variant_id}:${fixing.size_id}`}
              store={store}
              token={token}
              journalKey={journalKey}
              blocked={correcting}
              locationId={selected.id}
              place={selected.name}
              foot={fixFoot}
              target={fixing}
              onDone={done}
              onRefused={() => {
                void cache.invalidateQueries({
                  queryKey: ["inventory-stock"],
                });
              }}
              // Settled from the app's notice, which the sheet would cover,
              // as on a model's detail.
              onLost={() => {
                setFixing(null);
              }}
            />
          </Sheet>
        )}
      </>
    );

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
          // The warehouses' choices in grey, where they come (goods task
          // list after stage 2, P2-2).
          <Placeholder said="Завантажуємо склади…" chips={2} />
        ) : locations.error ? (
          <Unread
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
                      setFindingAt(null);
                      setFound(null);
                    }}
                  >
                    {visible(location.name)}
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <>
                <Stocktakes
                  store={store}
                  token={token}
                  scopeKey={scopeKey}
                  blocked={countingBlocked}
                  location={selected}
                  onCount={(record) => {
                    setCounting(record);
                    setFindingAt(null);
                    setFound(null);
                  }}
                />
                {found && (
                  // Its stub, as a model's detail says a correction (P1-2).
                  <section className="notice stub-notice" role="status">
                    <Stub state="recorded">
                      <p>
                        {`Коригування записано: ${visible(found.target.name)} · ${visible(found.target.size)} — ${reasonLabels[found.reason]}, облік ${String(found.adjustment.quantity_before)} → ${String(found.adjustment.quantity_after)}.`}
                      </p>
                    </Stub>
                  </section>
                )}
                {store.permissions.includes("inventory:receive") && (
                  <button
                    ref={finder}
                    type="button"
                    className="quiet"
                    disabled={blocked}
                    onClick={() => {
                      setFindingAt(selected.id);
                      setFixing(null);
                      setFound(null);
                    }}
                  >
                    Знайшли товар, якого немає в списку
                  </button>
                )}
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
