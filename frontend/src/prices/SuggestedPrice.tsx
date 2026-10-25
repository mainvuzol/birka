import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText, inOwnWords, isConflict } from "@/shared/api";
import { visible } from "@/shared/visible";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import type { AppliesTo, Prices } from "./types";

/**
 * A model's suggested selling price (owner decisions, 2026-10-01; Q-F).
 *
 * The till prefills it, so a seller does not type it on every sale; the
 * final price is still agreed at the counter. The owner and managers set it
 * (`catalog:set_price`): one price for the whole shop, which a store may
 * override with its own. Holding the permission in this store sets the
 * store's own; holding it organization-wide, or in every store, also the
 * shared one — the server says which (`may_set_shared`).
 *
 * A change states the price the screen showed, so nobody overwrites one they
 * have not seen; saving twice is safe.
 */
export function SuggestedPrice({
  store,
  token,
  scopeKey,
  variantId,
  blocked,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variantId: string;
  blocked: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const prices = usePrices(store, token, scopeKey, variantId);
  const maySet = store.permissions.includes("catalog:set_price");

  return (
    <div className="price">
      {prices.isPending ? (
        <p role="status">Завантажуємо ціну продажу…</p>
      ) : prices.error ? (
        <div role="alert">
          <p>{errorText(prices.error)}</p>
          <button
            type="button"
            onClick={() => {
              void prices.refetch();
            }}
          >
            Повторити завантаження
          </button>
        </div>
      ) : (
        <>
          <p>
            Ціна продажу: <strong>{describe(prices.data, store)}</strong>
          </p>
          {saved && !editing && <p role="status">Ціну збережено.</p>}
          {maySet &&
            (editing ? (
              <PriceEditor
                store={store}
                token={token}
                scopeKey={scopeKey}
                variantId={variantId}
                blocked={blocked}
                onDone={() => {
                  setEditing(false);
                  setSaved(true);
                }}
                onCancel={() => {
                  setEditing(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="quiet"
                disabled={blocked}
                onClick={() => {
                  setEditing(true);
                  setSaved(false);
                }}
              >
                {prices.data.suggested_price === null
                  ? "Задати ціну продажу"
                  : "Змінити ціну продажу"}
              </button>
            ))}
        </>
      )}
    </div>
  );
}

/** Change, set or remove one price — the shared one or this store's own. */
export function PriceEditor({
  store,
  token,
  scopeKey,
  variantId,
  blocked,
  onDone,
  onCancel,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variantId: string;
  blocked: boolean;
  onDone: (prices: Prices) => void;
  onCancel: () => void;
}): JSX.Element {
  const prices = usePrices(store, token, scopeKey, variantId);
  if (prices.isPending) return <p role="status">Завантажуємо ціну продажу…</p>;
  if (prices.error)
    return (
      <div role="alert">
        <p>{errorText(prices.error)}</p>
        <button
          type="button"
          onClick={() => {
            void prices.refetch();
          }}
        >
          Повторити завантаження
        </button>
      </div>
    );
  return (
    <Form
      store={store}
      token={token}
      scopeKey={scopeKey}
      variantId={variantId}
      blocked={blocked}
      prices={prices.data}
      refetch={async () => {
        await prices.refetch();
      }}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}

function Form({
  store,
  token,
  scopeKey,
  variantId,
  blocked,
  prices,
  refetch,
  onDone,
  onCancel,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variantId: string;
  blocked: boolean;
  prices: Prices;
  refetch: () => Promise<void>;
  onDone: (prices: Prices) => void;
  onCancel: () => void;
}): JSX.Element {
  const cache = useQueryClient();
  // A store with its own price is changing that one; otherwise whoever may
  // set the shared price starts there.
  const mayShare = prices.may_set_shared;
  const [appliesTo, setAppliesTo] = useState<AppliesTo>(
    prices.store_price === null && mayShare ? "ORGANIZATION" : "STORE",
  );
  const [text, setText] = useState(() => {
    const start = prices.store_price ?? prices.shared_price;
    return start === null ? "" : asInput(start);
  });
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  // What the screen shows for the chosen price is what the change is stated
  // against: the server refuses it if that no longer stands.
  const current =
    appliesTo === "ORGANIZATION" ? prices.shared_price : prices.store_price;

  async function save(price: string | null): Promise<void> {
    setBusy(true);
    setProblem("");
    try {
      const result = await api<Prices>("/catalog/prices", token, {
        store_id: store.id,
        product_variant_id: variantId,
        applies_to: appliesTo,
        expected_price: current,
        suggested_price: price,
      });
      cache.setQueryData(priceKey(scopeKey, store.id, variantId), result);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["sale-stock"] }),
        cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
      ]);
      onDone(result);
    } catch (error) {
      if (error instanceof ApiError && error.code === "PRICE_CHANGED") {
        const now = error.details.current;
        setProblem(
          `Цю ціну щойно змінив хтось інший: тепер ${typeof now === "string" ? money(now) : "не задана"}. Перевірте й збережіть ще раз.`,
        );
        await refetch();
      } else {
        if (isConflict(error)) await refetch();
        setProblem(
          error instanceof ApiError
            ? inOwnWords(
                errorText(error),
                "Ціну не збережено. Перевірте суму та спробуйте ще раз.",
                "Ціну не збережено: її щойно змінили — перевірте й збережіть ще раз.",
              )
            : "Немає відповіді сервера. Натисніть ще раз — повторне збереження безпечне.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset disabled={blocked || busy}>
      <legend>Змінити ціну продажу</legend>
      {mayShare ? (
        <label>
          Яку ціну змінюємо
          <select
            value={appliesTo}
            onChange={(event) => {
              setAppliesTo(event.target.value as AppliesTo);
              setProblem("");
            }}
          >
            <option value="ORGANIZATION">Спільну — для всіх магазинів</option>
            <option value="STORE">
              Лише для магазину «{visible(store.name)}»
            </option>
          </select>
        </label>
      ) : (
        <p className="hint">
          Ця ціна діятиме лише в магазині «{visible(store.name)}». Спільну ціну
          для всіх магазинів тут змінити не можна.
        </p>
      )}
      <p className="hint">
        Зараз:{" "}
        {current !== null
          ? money(current)
          : appliesTo === "STORE" && prices.shared_price !== null
            ? `своєї ціни немає, діє спільна ${money(prices.shared_price)}`
            : "не задана"}
        . На касі продавець може домовитися про іншу ціну.
      </p>
      <label>
        Нова ціна, грн
        <input
          inputMode="decimal"
          placeholder="0,00"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            const cents = kopecks(text);
            if (cents === null || cents === 0n) {
              setProblem(
                "Ціну вкажіть у гривнях, до копійок, більше нуля, наприклад 1850,50.",
              );
              return;
            }
            void save(decimal(cents));
          }}
        >
          Зберегти ціну
        </button>
        {current !== null && (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              void save(null);
            }}
          >
            {appliesTo === "STORE"
              ? "Прибрати ціну магазину"
              : "Прибрати спільну ціну"}
          </button>
        )}
        <button type="button" className="quiet" onClick={onCancel}>
          Скасувати
        </button>
      </div>
    </fieldset>
  );
}

function usePrices(
  store: Store,
  token: string,
  scopeKey: string,
  variantId: string,
) {
  return useQuery({
    queryKey: priceKey(scopeKey, store.id, variantId),
    queryFn: () =>
      api<Prices>(
        `/catalog/prices?store_id=${store.id}&product_variant_id=${variantId}`,
        token,
      ),
    retry: false,
  });
}

function priceKey(
  scopeKey: string,
  storeId: string,
  variantId: string,
): string[] {
  return ["catalog-price", scopeKey, storeId, variantId];
}

/** What the till suggests here, and where that price comes from. */
function describe(prices: Prices, store: Store): string {
  if (prices.store_price !== null)
    return `${money(prices.store_price)} — ціна магазину «${visible(store.name)}»`;
  if (prices.shared_price !== null)
    return `${money(prices.shared_price)} — спільна для всіх магазинів`;
  return "не задана";
}

/** A price as the input field takes it: "1850,50". */
export function asInput(price: string): string {
  const cents = kopecks(price);
  return cents === null ? "" : decimal(cents).replace(".", ",");
}
