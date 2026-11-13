import { Fragment, useId, useRef, useState } from "react";
import type { JSX } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Unread } from "@/shared/Unread";
import { Icon } from "@/shared/Icon";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Placeholder } from "@/shared/Placeholder";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { visible } from "@/shared/visible";
import { money } from "@/orders/types";
import type { Location, StockOption, Store } from "@/orders/types";
import { PriceSheet } from "@/prices/SuggestedPrice";
import { Correction } from "./Correction";
import type { Corrected } from "./Correction";
import { reasonLabels } from "./adjustmentTypes";
import type { SizeOption } from "./receiptTypes";
import { useCountCommand } from "./stocktakeCommands";
import { useAdjustmentCommand } from "./adjustmentCommands";

/** A model as the till's search found it: what opens its detail. */
export interface Opened {
  variantId: string;
  name: string;
  /** The search it was found by, settled; empty for the whole list. */
  query: string;
}

const pageSize = 100;

/**
 * One listing's rows of this model (`/catalog/stock-options`), page after
 * page while they may go on: the server lists a model's rows together, so
 * a page that ends past them, or the list's end, means all are read.
 * Without a search, the whole list until them («Усе на бірці» sections task
 * list, P0-6).
 */
async function modelRows(
  store: Store,
  token: string,
  opened: Opened,
  locationId: string | null,
): Promise<StockOption[]> {
  const rows = new Map<string, StockOption>();
  for (let offset = 0; ; offset += pageSize) {
    const page = await api<{ items: StockOption[]; has_more: boolean }>(
      `/catalog/stock-options?store_id=${store.id}${locationId === null ? "" : `&location_id=${locationId}`}&limit=${String(pageSize)}&offset=${String(offset)}${opened.query ? `&query=${encodeURIComponent(opened.query)}` : ""}`,
      token,
    );
    // A row read twice, when a sale moved a page's edge, counts once.
    for (const item of page.items)
      if (item.product_variant_id === opened.variantId)
        rows.set(`${item.size_id}:${item.location_id}`, item);
    const last = page.items[page.items.length - 1];
    if (
      !page.has_more ||
      (rows.size > 0 && last?.product_variant_id !== opened.variantId)
    )
      return [...rows.values()];
  }
}

interface Size {
  id: string;
  label: string;
  unknown: boolean;
}

/** A warehouse holding any of the model, a row of the grid. */
interface Place {
  location: Location;
  /** Sold from by this store: counted in «Можна продати». */
  selling: boolean;
  /** Its rows, by size. */
  rows: Map<string, StockOption>;
}

/**
 * The grid's sizes and rows. The sizes in the server's order — the
 * organization's, where this person reads it, else as the listings give
 * them, each in that order: the selling one first, a size another lacks
 * before the first that follows it there — a size not known last; the
 * warehouses in the store's order, those it sells from first.
 */
function grid(
  locations: Location[],
  selling: StockOption[],
  elsewhere: ReadonlyMap<string, StockOption[]>,
  order: SizeOption[] | undefined,
): { sizes: Size[]; places: Place[] } {
  const sells = (location: Location): boolean =>
    location.is_active && location.can_sell;
  const places: Place[] = [];
  for (const location of [
    ...locations.filter(sells),
    ...locations.filter((location) => !sells(location)),
  ]) {
    const rows = (
      sells(location) ? selling : (elsewhere.get(location.id) ?? [])
    ).filter((row) => row.location_id === location.id);
    if (rows.length > 0)
      places.push({
        location,
        selling: sells(location),
        rows: new Map(rows.map((row) => [row.size_id, row])),
      });
  }
  const listed = new Set(
    places.filter((place) => place.selling).map((place) => place.location.id),
  );
  const merged: Size[] = [];
  for (const list of [
    selling.filter((row) => listed.has(row.location_id)),
    ...places
      .filter((place) => !place.selling)
      .map((place) => [...place.rows.values()]),
  ]) {
    // From its end: a size not seen yet goes before the last one seen.
    let before = merged.length;
    for (const row of [...list].reverse()) {
      const at = merged.findIndex((size) => size.id === row.size_id);
      if (at >= 0) before = at;
      else
        merged.splice(before, 0, {
          id: row.size_id,
          label: row.size_label,
          unknown: row.size_is_unknown,
        });
    }
  }
  const rank = new Map(order?.map((size, at) => [size.size_id, at]));
  const first = new Map(merged.map((size, at) => [size.id, at]));
  const sizes = merged.sort(
    (a, b) =>
      Number(a.unknown) - Number(b.unknown) ||
      (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
      (first.get(a.id) ?? 0) - (first.get(b.id) ?? 0),
  );
  return { sizes, places };
}

/** A unit count of one size, or of «Разом»: «·» in pencil for none, read
 * «0». */
function Count({ size, units }: { size: string; units: number }): JSX.Element {
  return units === 0 ? (
    <td className="grid-zero" data-size={size}>
      <span aria-hidden="true">·</span>
      <span className="visually-hidden">0</span>
    </td>
  ) : (
    <td data-size={size}>{units}</td>
  );
}

type Said =
  | { kind: "corrected"; corrected: Corrected }
  | { kind: "priced"; name: string };

/**
 * A model's detail (spec S23; «Усе на бірці» sections task list, P0-6):
 * one coat across its sizes and the store's warehouses, opened by its name
 * on the till's search. Its name and the price the till suggests on a hero
 * tag, and under them a grid — a row a warehouse holding any, what orders
 * hold under it, «Брак» and a paused one by their own looks, then «Можна
 * продати», what is free where the store sells from. Read only: a coat is
 * sold from the till's cells (В4 (а)), one «←» away.
 *
 * Its ways, each by its own right: «Прийшов товар» with this model chosen;
 * «Виправити залишок», a sheet of the cells that may be corrected, each
 * opening the correction form as before; behind the ⋯, «Інвентаризація».
 * What is recorded is said on a stub over the grid, which is read again.
 */
export function Model({
  store,
  token,
  scopeKey,
  journalKey,
  opened,
  blocked,
  back,
  receive,
  stocktake,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  /** Where a correction is kept until it is settled. */
  journalKey: string;
  opened: Opened;
  blocked: boolean;
  /** «← Продаж»: the till, its search as it was. */
  back: MoreBack;
  /** «Прийшов товар», this model chosen. */
  receive: () => void;
  /** «Інвентаризація», from the ⋯. */
  stocktake: () => void;
}): JSX.Element {
  const cache = useQueryClient();
  const nameId = useId();
  const more = useRef<HTMLButtonElement>(null);
  const fix = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<"price" | "correct" | "more" | null>(null);
  const [editing, setEditing] = useState<StockOption | null>(null);
  const [fixFoot, setFixFoot] = useState<HTMLDivElement | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  // A correction and a count each wait for the other to settle, as on
  // «Залишки».
  const adjustment = useAdjustmentCommand();
  const count = useCountCommand();
  const correcting = blocked || count.busy || count.pending !== null;
  // Either kept, the ways that would wait for it are held, as in «Ще»: the
  // app's notice settles it (review, 2026-11-01).
  const unsettled =
    adjustment.busy ||
    adjustment.pending !== null ||
    count.busy ||
    count.pending !== null;
  const canReceive = store.permissions.includes("inventory:receive");
  const canAdjust = store.permissions.includes("inventory:adjust");
  const canPrice = store.permissions.includes("catalog:set_price");

  const locations = useQuery({
    queryKey: ["inventory-locations", scopeKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  // Under «Залишки»'s own key, so whatever reads its stock again — a
  // correction, a price, a return — reads this too.
  const key = [
    "inventory-stock",
    scopeKey,
    store.id,
    "model",
    opened.variantId,
    opened.query,
  ];
  const selling = useQuery({
    queryKey: [...key, "selling"],
    queryFn: () => modelRows(store, token, opened, null),
    retry: false,
  });
  // «Брак», a paused warehouse, one the store reads but does not sell from:
  // each by its own address, as «Залишки» reads them.
  const others = (locations.data ?? []).filter(
    (location) => !(location.is_active && location.can_sell),
  );
  const elsewhere = useQueries({
    queries: others.map((location) => ({
      queryKey: [...key, location.id],
      queryFn: () => modelRows(store, token, opened, location.id),
      retry: false,
    })),
  });
  // The organization's order of sizes is receiving's to read.
  const sizes = useQuery({
    queryKey: ["receive-sizes", scopeKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    enabled: canReceive,
    retry: false,
  });
  const reads = [locations, selling, ...elsewhere];
  const failed = reads.find((read) => read.isError);
  const waiting =
    reads.some((read) => read.isPending) || (canReceive && sizes.isPending);

  function readAgain(): void {
    void cache.invalidateQueries({ queryKey: key });
  }

  // Not read: the model's name it was opened by heads the screen, under its
  // «←», over the warning's plate (stage 2's audit, goods P1-1).
  if (failed)
    return (
      <>
        <ScreenHeader
          title={visible(opened.name)}
          back={<BackToMore back={back} />}
        />
        <section>
          <Unread
            error={failed.error}
            retry={() => {
              for (const read of reads) if (read.isError) void read.refetch();
            }}
          />
        </section>
      </>
    );
  if (waiting || !locations.data || !selling.data)
    return (
      <>
        <ScreenHeader back={<BackToMore back={back} />} />
        <Placeholder said="Завантажуємо залишки моделі…" tags={1} />
      </>
    );

  const { sizes: columns, places } = grid(
    locations.data,
    selling.data,
    new Map(
      others.map((location, at) => [location.id, elsewhere[at]?.data ?? []]),
    ),
    sizes.data,
  );
  const rows = places.flatMap((place) => [...place.rows.values()]);
  const name = rows[0]?.display_name ?? opened.name;
  const price = rows[0]?.suggested_price ?? null;
  const total = (place: Place, units: (row: StockOption) => number): number =>
    [...place.rows.values()].reduce((sum, row) => sum + units(row), 0);
  const free = (row: StockOption): number =>
    Math.max(row.available_quantity, 0);
  const sold = places.filter((place) => place.selling);
  const freeOf = (size: Size): number =>
    sold.reduce((sum, place) => {
      const row = place.rows.get(size.id);
      return sum + (row ? free(row) : 0);
    }, 0);
  // What may be corrected: as receiving into it, never «Брак», never a
  // paused one (owner decision, 2026-10-01; the server refuses them too).
  const fixable = places
    .filter(
      (place) =>
        place.location.is_active &&
        place.location.can_receive &&
        !place.location.damaged_returns,
    )
    .flatMap((place) =>
      columns.flatMap((size) => {
        const row = place.rows.get(size.id);
        return row ? [{ row, place: place.location.name }] : [];
      }),
    )
    // Size first, as the till's cells.
    .sort(
      (a, b) =>
        columns.findIndex((size) => size.id === a.row.size_id) -
        columns.findIndex((size) => size.id === b.row.size_id),
    );
  const sizeName = (row: StockOption): string =>
    row.size_is_unknown ? "розмір невідомий" : row.size_label;
  const closeFix = (): void => {
    // The form's answer is waited for: it is the screen's to say.
    if (adjustment.busy) return;
    setSheet(null);
    setEditing(null);
  };

  return (
    <>
      <ScreenHeader back={<BackToMore back={back} />} />
      <section className="model-screen">
        {said && (
          <section className="notice stub-notice" role="status">
            <Stub state="recorded">
              <p>
                {said.kind === "corrected"
                  ? `Коригування записано: ${visible(said.corrected.target.name)} · ${visible(said.corrected.target.size)} — ${reasonLabels[said.corrected.reason]}, облік ${String(said.corrected.adjustment.quantity_before)} → ${String(said.corrected.adjustment.quantity_after)}.`
                  : `Ціну продажу збережено: ${visible(said.name)}.`}
              </p>
            </Stub>
          </section>
        )}
        <div className="model-hang">
          <div className="tag-hero tag-outline">
            <div className="model-hero" role="group" aria-labelledby={nameId}>
              <span className="hero-eyelet" aria-hidden="true" />
              <div className="model-hero-head">
                <h1 id={nameId} className="model-hero-name">
                  {visible(name)}
                </h1>
                {canAdjust && (
                  <button
                    ref={more}
                    type="button"
                    className="debt-more"
                    aria-label="Ще дії з моделлю"
                    aria-haspopup="dialog"
                    disabled={blocked}
                    onClick={() => {
                      setSheet("more");
                    }}
                  >
                    <Icon name="tab-more" />
                  </button>
                )}
              </div>
              <div className="model-price-row">
                {/* Its price comes with its rows: with none, nothing is
                    said of it (review, 2026-11-01). */}
                {rows.length > 0 && (
                  <p className="t-row">
                    Ціна продажу{" "}
                    <span className="model-price">
                      {price ? money(price) : "не задана"}
                    </span>
                  </p>
                )}
                {canPrice && (
                  <button
                    type="button"
                    className="quiet"
                    aria-haspopup="dialog"
                    disabled={blocked}
                    onClick={() => {
                      setSheet("price");
                      setSaid(null);
                    }}
                  >
                    Змінити ціну
                  </button>
                )}
              </div>
              {places.length === 0 ? (
                <p className="t-meta grid-none">
                  Зараз цієї моделі немає на складах магазину.
                </p>
              ) : (
                <div className="size-grid-wrap">
                  <table className="size-grid">
                    <caption className="visually-hidden">
                      Залишок за розмірами, шт.
                    </caption>
                    <thead>
                      <tr>
                        <td aria-hidden="true" />
                        {columns.map((size) => (
                          <th scope="col" key={size.id}>
                            {size.unknown ? (
                              <>
                                <span aria-hidden="true">?</span>
                                <span className="visually-hidden">
                                  розмір невідомий
                                </span>
                              </>
                            ) : (
                              visible(size.label)
                            )}
                          </th>
                        ))}
                        <th scope="col" className="grid-total">
                          Разом
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {places.map((place) => {
                        const held = total(
                          place,
                          (row) => row.reserved_quantity,
                        );
                        return (
                          <Fragment key={place.location.id}>
                            <tr
                              data-location={place.location.id}
                              className={
                                [
                                  !place.location.is_active && "grid-paused",
                                  place.location.damaged_returns &&
                                    "grid-damaged",
                                ]
                                  .filter(Boolean)
                                  .join(" ") || undefined
                              }
                            >
                              <th scope="row">
                                {place.location.damaged_returns && (
                                  <Icon name="damaged" size={16} />
                                )}
                                {visible(place.location.name)}
                              </th>
                              {columns.map((size) => (
                                <Count
                                  key={size.id}
                                  size={size.id}
                                  units={place.rows.get(size.id)?.quantity ?? 0}
                                />
                              ))}
                              <Count
                                size="total"
                                units={total(place, (row) => row.quantity)}
                              />
                            </tr>
                            {held > 0 && (
                              <tr
                                className="grid-held"
                                data-held={place.location.id}
                              >
                                <th scope="row">
                                  <Icon name="held" size={16} />з них у резерві
                                </th>
                                {columns.map((size) => (
                                  <Count
                                    key={size.id}
                                    size={size.id}
                                    units={
                                      place.rows.get(size.id)
                                        ?.reserved_quantity ?? 0
                                    }
                                  />
                                ))}
                                <Count size="total" units={held} />
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="grid-free">
                        <th scope="row">Можна продати</th>
                        {columns.map((size) => (
                          <Count
                            key={size.id}
                            size={size.id}
                            units={freeOf(size)}
                          />
                        ))}
                        <Count
                          size="total"
                          units={sold.reduce(
                            (sum, place) => sum + total(place, free),
                            0,
                          )}
                        />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {places.some((place) => !place.location.is_active) && (
                <p className="t-meta grid-note">
                  Склад на паузі. Залишки доступні для перегляду.
                </p>
              )}
            </div>
          </div>
        </div>
        {(canReceive || (canAdjust && fixable.length > 0)) && (
          <div className="model-ways">
            {canReceive && (
              <button
                type="button"
                className="quiet"
                disabled={blocked || unsettled}
                onClick={receive}
              >
                Прийшов товар
              </button>
            )}
            {canAdjust && fixable.length > 0 && (
              <button
                ref={fix}
                type="button"
                className="quiet"
                aria-haspopup="dialog"
                disabled={blocked || unsettled}
                onClick={() => {
                  setSheet("correct");
                  setSaid(null);
                }}
              >
                Виправити залишок
              </button>
            )}
          </div>
        )}
      </section>
      {sheet === "price" && (
        <PriceSheet
          store={store}
          token={token}
          scopeKey={scopeKey}
          variantId={opened.variantId}
          name={name}
          blocked={blocked}
          close={() => {
            setSheet(null);
          }}
          done={() => {
            setSheet(null);
            setSaid({ kind: "priced", name });
          }}
        />
      )}
      {sheet === "correct" && (
        <Sheet
          title={
            editing
              ? `${visible(name)} · ${visible(sizeName(editing))}`
              : visible(name)
          }
          close={closeFix}
          fallback={fix}
          // The form's own button, outside Telegram, kept in view under it.
          foot={editing ? <div ref={setFixFoot} /> : undefined}
        >
          {editing ? (
            <Correction
              key={`${editing.size_id}:${editing.location_id}`}
              store={store}
              token={token}
              journalKey={journalKey}
              blocked={correcting}
              locationId={editing.location_id}
              place={
                locations.data.find(
                  (location) => location.id === editing.location_id,
                )?.name
              }
              foot={fixFoot}
              target={{
                product_variant_id: editing.product_variant_id,
                size_id: editing.size_id,
                name: editing.display_name,
                size: sizeName(editing),
                sizeIsUnknown: editing.size_is_unknown,
                quantity: editing.quantity,
              }}
              onDone={(corrected) => {
                setSheet(null);
                setEditing(null);
                setSaid({ kind: "corrected", corrected });
                readAgain();
              }}
              onRefused={readAgain}
              // Settled from the app's notice, which the sheet would cover,
              // as a debt's write-off.
              onLost={() => {
                setSheet(null);
                setEditing(null);
              }}
            />
          ) : (
            <>
              <div
                className="cells"
                role="group"
                aria-label="Який розмір виправити"
              >
                {fixable.map(({ row, place }) => {
                  const held = row.reserved_quantity > 0;
                  return (
                    <button
                      type="button"
                      key={`${row.size_id}:${row.location_id}`}
                      className={held ? "size-cell held-only" : "size-cell"}
                      aria-label={[
                        visible(sizeName(row)),
                        visible(place),
                        `в обліку ${String(row.quantity)}`,
                        held
                          ? `у резерві ${String(row.reserved_quantity)}`
                          : null,
                      ]
                        .filter((part) => part !== null)
                        .join(", ")}
                      aria-disabled={held || undefined}
                      disabled={blocked}
                      onClick={() => {
                        if (!held) setEditing(row);
                      }}
                    >
                      <span className="size-letter">
                        {row.size_is_unknown ? "?" : visible(row.size_label)}
                      </span>
                      <span className="size-free">
                        <span className="size-place">{visible(place)}</span>{" "}
                        {row.quantity}
                      </span>
                      {held && (
                        <span className="size-held">
                          <Icon name="held" size={12} />
                          {row.reserved_quantity}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {fixable.some(({ row }) => row.reserved_quantity > 0) && (
                <p className="hint fix-held">
                  Є резерв замовлення — виправити залишок можна після його
                  видачі або скасування.
                </p>
              )}
            </>
          )}
        </Sheet>
      )}
      {sheet === "more" && (
        <Sheet
          title={visible(name)}
          close={() => {
            setSheet(null);
          }}
          fallback={more}
        >
          <div className="debt-more-ways">
            <button
              type="button"
              className="sheet-way"
              disabled={blocked}
              onClick={() => {
                setSheet(null);
                stocktake();
              }}
            >
              Інвентаризація
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
