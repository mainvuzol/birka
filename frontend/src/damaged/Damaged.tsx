import { useId, useState } from "react";
import type { JSX } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  api,
  errorText,
  inOwnWords,
  unreachable,
} from "@/shared/api";
import { NoCustomerData } from "@/shared/NoCustomerData";
import type { Location, Store } from "@/orders/types";
import { useBackOnSale } from "@/returns/places";
import { sizeLabel } from "@/returns/types";
import { SupplierPicker } from "@/suppliers/Picker";
import { visible } from "@/shared/visible";
import type { DamagedUnit } from "./types";
import { useDamagedUnits } from "./units";

/**
 * The store's «Брак» (owner decisions, 2026-10-01).
 *
 * Every unit a return put here, and what anyone who takes returns may do with
 * it: take it for inspection — the others see who is looking — then put it
 * back on sale in the warehouse it was sold from, or confirm it damaged; a
 * confirmed unit may be looked at again, or written off. A unit handed back
 * here but sold from another store's own warehouse goes back on sale in a
 * warehouse of this store the person chooses (owner decision, 2026-10-01).
 *
 * Every step is safe to press twice: the server answers a step already done
 * with the unit as it is. So no journal is kept here — if an answer is lost,
 * the list is read again and the step pressed again.
 */
export function Damaged({
  store,
  token,
  blocked,
  readOnly = false,
  back,
}: {
  store: Store;
  token: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** The store does not trade: its «Брак» is read, and nothing is done in it. */
  readOnly?: boolean;
  /** «← Товар» over the heading: the screen is one of «Товар»'s tiles
   * (navigation task list, P0-3). */
  back?: (() => void) | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const units = useDamagedUnits(store, token);
  const places = useBackOnSale(
    store,
    token,
    !readOnly &&
      (units.data?.units ?? []).some((unit) => !unit.back_to_sold_from),
  );

  async function act(
    unit: DamagedUnit,
    action:
      | "take"
      | "return-to-sale"
      | "confirm"
      | "write-off"
      | "return-to-supplier",
    body: Record<string, unknown> = {},
  ): Promise<void> {
    setBusy(unit.id);
    setProblem(null);
    try {
      await api<DamagedUnit>(
        `/damaged-units/${unit.id}/${action}`,
        token,
        body,
      );
    } catch (error) {
      // No answer reads as everywhere else, the owner's words (ADR-0013 §3,
      // G13), and this screen's own: pressing again is safe.
      setProblem(
        error instanceof ApiError && error.code === "DAMAGED_UNIT_CHANGED"
          ? "Цю одиницю щойно змінив хтось інший. Список оновлено — подивіться ще раз."
          : error instanceof ApiError && !unreachable(error)
            ? inOwnWords(
                errorText(error),
                "Не записано. Перевірте дані та спробуйте ще раз.",
                "Не записано: цю одиницю щойно змінили — список оновлено, подивіться ще раз.",
              )
            : `${errorText(error)} Повторне натискання безпечне.`,
      );
    } finally {
      setBusy(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["damaged-units", store.id] }),
        cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
        cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
      ]);
    }
  }

  const groups: { status: DamagedUnit["status"]; title: string }[] = [
    { status: "AWAITING", title: "Очікують перевірки" },
    { status: "INSPECTING", title: "На перевірці" },
    { status: "CONFIRMED", title: "Брак підтверджений — не продається" },
  ];

  return (
    <section className="goods-part">
      {back && (
        <button
          type="button"
          className="quiet back"
          aria-label="Назад до товару"
          disabled={blocked}
          onClick={back}
        >
          <span aria-hidden="true">← </span>Товар
        </button>
      )}
      <div className="toolbar">
        <h2>Брак</h2>
        <button
          className="quiet"
          disabled={units.isFetching}
          onClick={() => {
            void units.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        {readOnly
          ? "Пошкоджений товар із повернень. Магазин не торгує: тут лише перегляд."
          : "Пошкоджений товар із повернень. Візьміть одиницю на перевірку, а потім поверніть її в продаж або підтвердьте брак."}
      </p>
      {problem && <p role="alert">{problem}</p>}
      {units.isPending ? (
        <p role="status">Завантажуємо «Брак»…</p>
      ) : units.error ? (
        <p role="alert">{errorText(units.error)}</p>
      ) : units.data.units.length === 0 ? (
        <p>У «Брак» зараз нічого немає.</p>
      ) : (
        groups.map(({ status, title }) => {
          const here = units.data.units.filter((u) => u.status === status);
          if (here.length === 0) return null;
          return (
            <div className="section-block" key={status} data-status={status}>
              <h3>
                {title} · {here.length}
              </h3>
              {here.map((unit) => (
                <Unit
                  key={unit.id}
                  unit={unit}
                  places={places.data ?? []}
                  busy={blocked || busy !== null}
                  readOnly={readOnly}
                  supplier={
                    // The owner and managers return a confirmed unit to its
                    // supplier instead (owner decision, 2026-10-01).
                    store.permissions.includes("supplier:return")
                      ? { store, token }
                      : null
                  }
                  act={(action, body) => {
                    void act(unit, action, body);
                  }}
                />
              ))}
            </div>
          );
        })
      )}
    </section>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function Unit({
  unit,
  places,
  busy,
  readOnly,
  supplier,
  act,
}: {
  unit: DamagedUnit;
  /** This store's warehouses, for a unit sold from another store's own. */
  places: Location[];
  busy: boolean;
  readOnly: boolean;
  /** Whoever may return it to its supplier; null for everyone else. */
  supplier: { store: Store; token: string } | null;
  act: (
    action:
      | "take"
      | "return-to-sale"
      | "confirm"
      | "write-off"
      | "return-to-supplier",
    body?: Record<string, unknown>,
  ) => void;
}): JSX.Element {
  const hint = useId();
  const [asking, setAsking] = useState<
    "return" | "confirm" | "write-off" | "supplier" | null
  >(null);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [place, setPlace] = useState("");
  const trimmed = note.trim();
  const placeName = places.find((location) => location.id === place)?.name;
  return (
    <article className="damaged-unit" aria-label={visible(unit.display_name)}>
      <strong>
        {visible(unit.display_name)}, {sizeLabel(unit.size)}
      </strong>
      <small>
        Повернули {when(unit.returned_at)} · продано зі складу «
        {visible(unit.sold_from_location_name)}»
      </small>
      {unit.status === "INSPECTING" && unit.status_by && unit.status_at && (
        <small>
          На перевірці: {visible(unit.status_by)}, з {when(unit.status_at)}
        </small>
      )}
      {unit.note && <small>Примітка: {visible(unit.note)}</small>}
      {readOnly ? null : asking === "return" && !unit.back_to_sold_from ? (
        <div className="actions">
          <label>
            Повернути в продаж на склад вашого магазину
            <select
              value={place}
              onChange={(event) => {
                setPlace(event.target.value);
              }}
            >
              <option value="">Оберіть склад</option>
              {places.map((location) => (
                <option key={location.id} value={location.id}>
                  {visible(location.name)}
                </option>
              ))}
            </select>
            <span className="hint">
              Його продали з власного складу іншого магазину, куди ваш магазин
              не має доступу.
            </span>
          </label>
          <button
            disabled={busy || !placeName}
            onClick={() => {
              act("return-to-sale", { destination_location_id: place });
            }}
          >
            {placeName
              ? `Так, повернути на «${visible(placeName)}»`
              : "Оберіть склад"}
          </button>
          <button
            className="quiet"
            onClick={() => {
              setAsking(null);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : asking === "return" ? (
        <div className="actions">
          <p>
            Повернути в продаж на склад «{visible(unit.sold_from_location_name)}
            », звідки його продали?
          </p>
          <button
            disabled={busy}
            onClick={() => {
              act("return-to-sale", {
                destination_location_id: unit.sold_from_location_id,
              });
            }}
          >
            Так, повернути на «{visible(unit.sold_from_location_name)}»
          </button>
          <button
            className="quiet"
            onClick={() => {
              setAsking(null);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : asking === "supplier" && supplier ? (
        <div className="actions">
          <SupplierPicker
            store={supplier.store}
            token={supplier.token}
            value={supplierId}
            change={setSupplierId}
            disabled={busy}
          />
          <label>
            Примітка для постачальника (необов’язково)
            <textarea
              value={note}
              maxLength={1000}
              aria-describedby={hint}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <NoCustomerData id={hint} />
          </label>
          <button
            disabled={busy || supplierId === ""}
            onClick={() => {
              act("return-to-supplier", {
                supplier_id: supplierId,
                note: trimmed ? trimmed : null,
              });
            }}
          >
            Так, повернути постачальнику
          </button>
          <button
            className="quiet"
            onClick={() => {
              setAsking(null);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : asking === "confirm" || asking === "write-off" ? (
        <div className="actions">
          <label>
            {asking === "confirm"
              ? "Що з товаром (необов’язково)"
              : "Чому списуємо (необов’язково)"}
            <textarea
              value={note}
              maxLength={1000}
              aria-describedby={hint}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <NoCustomerData id={hint} />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              act(asking, { note: trimmed ? trimmed : null });
            }}
          >
            {asking === "confirm" ? "Так, брак підтверджений" : "Так, списати"}
          </button>
          <button
            className="quiet"
            onClick={() => {
              setAsking(null);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : (
        <div className="actions">
          {unit.status === "AWAITING" && (
            <button
              disabled={busy}
              onClick={() => {
                act("take");
              }}
            >
              Взяти на перевірку
            </button>
          )}
          {unit.status === "INSPECTING" && (
            <>
              <button
                disabled={busy}
                onClick={() => {
                  setAsking("return");
                }}
              >
                Повернути в продаж
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => {
                  setAsking("confirm");
                }}
              >
                Брак підтверджений
              </button>
            </>
          )}
          {unit.status === "CONFIRMED" && (
            <>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => {
                  act("take");
                }}
              >
                Перевірити ще раз
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setAsking("write-off");
                }}
              >
                Списати
              </button>
              {supplier && (
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() => {
                    setAsking("supplier");
                  }}
                >
                  Повернути постачальнику
                </button>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
