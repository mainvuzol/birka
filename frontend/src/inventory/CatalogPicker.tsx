import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, readText } from "@/shared/api";
import { SearchField } from "@/shared/SearchField";
import { hideKeyboard } from "@/shared/telegram";
import { Stub } from "@/shared/Stub";
import { visible } from "@/shared/visible";
import { NewModel } from "@/catalog/NewModel";
import { useCatalogCommand, useCatalogJournal } from "@/catalog/commands";
import type { Store } from "@/orders/types";
import type { ReceivableVariant } from "./receiptTypes";

const pageSize = 20;

/** «Модель додано: … Кількість впишіть тут.»: a model added from an empty
 * search, said where its screen chose it (stage 2, goods task list, P0-1). */
export function AddedStub({
  said,
}: {
  said: string | null;
}): JSX.Element | null {
  if (said === null) return null;
  return (
    <div className="notice stub-notice">
      <Stub state="recorded">
        <p role="status">{said}</p>
      </Stub>
    </div>
  );
}
/** Typed letters wait this long before they are asked (spec §5 «Поиск»). */
const PAUSE = 300;
/** What a search starts from: two letters. */
const FROM = 2;

/** What is asked for: the text trimmed, once it is long enough. */
function askable(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length >= FROM ? trimmed : null;
}

/**
 * Pick a model from the whole catalogue, not from what a warehouse holds.
 *
 * Receiving needs it because a delivery is usually of something the shop has
 * run out of; a stocktake needs it for goods found on a shelf the system says
 * is empty. Both are exactly what a stock list can never offer. The endpoint
 * requires `inventory:receive`. A legacy list's review starts from what its
 * line reads, as `initialSearch`.
 *
 * It searches as it is typed, from two letters, a moment after the last
 * (stage 2, goods task list, P0-1): no «Знайти». Found nothing, it says so,
 * and — where the screen lets a model be added (`adds`), and the person may
 * create and confirm in this store — offers «Додати нову модель «…»»: the
 * sheet «Нова модель» over this screen, whose lines stay. Added, the model is
 * chosen, and `onVariant` is told what its stub says.
 */
export function CatalogPicker({
  store,
  token,
  scopeKey,
  variant,
  onVariant,
  initialSearch = "",
  adds = false,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  variant: ReceivableVariant | null;
  onVariant: (variant: ReceivableVariant | null, said?: string) => void;
  initialSearch?: string;
  /** A new model may be added here from an empty search (В-Г1 (а)); never
   * at the till (В-Г2 (а)). */
  adds?: boolean;
}): JSX.Element {
  const [search, setSearch] = useState(initialSearch);
  // What the line reads is asked at once; what is typed, after a pause.
  const [asked, setAsked] = useState<string | null>(() =>
    askable(initialSearch),
  );
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  // The words a model was added for: their empty answer is not said again,
  // nor its button offered (review).
  const [addedFor, setAddedFor] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const wanted = askable(search);
    if (wanted === asked) return;
    const wait = window.setTimeout(() => {
      setOffset(0);
      setAsked(wanted);
    }, PAUSE);
    return () => {
      window.clearTimeout(wait);
    };
  }, [search, asked]);
  const variants = useQuery({
    queryKey: ["receivable-variants", scopeKey, store.id, asked, offset],
    queryFn: () =>
      api<{ items: ReceivableVariant[]; has_more: boolean }>(
        `/catalog/receivable-variants?store_id=${store.id}&query=${encodeURIComponent(asked ?? "")}&limit=${String(pageSize)}&offset=${String(offset)}`,
        token,
      ),
    enabled: asked !== null,
    retry: false,
  });
  const journal = useCatalogJournal((state) => state.key);
  const kept = useCatalogCommand((state) => state.pending !== null);
  const mayAdd =
    adds &&
    journal !== null &&
    store.permissions.includes("catalog:create") &&
    store.permissions.includes("catalog:confirm");

  return (
    <>
      <SearchField
        label="Пошук у каталозі"
        placeholder="Назва моделі або колір"
        value={search}
        change={setSearch}
        inputRef={field}
      />
      {asked !== null &&
        (variants.isPending ? (
          <p role="status">Шукаємо…</p>
        ) : variants.error ? (
          <div className="notice read-failure" role="alert">
            <p>{readText(variants.error)}</p>
            <button
              type="button"
              onClick={() => {
                void variants.refetch();
              }}
            >
              Спробувати ще раз
            </button>
          </div>
        ) : (
          <>
            {variants.data.items.length === 0 &&
              offset === 0 &&
              asked !== addedFor && (
                <div className="catalog-none">
                  <p>Нічого не знайшли за «{visible(asked)}»</p>
                  {mayAdd && (
                    <button
                      type="button"
                      className="quiet"
                      disabled={kept}
                      onClick={() => {
                        hideKeyboard();
                        // The words as typed, unless more came since.
                        setAdding(search.trim() === asked ? search : asked);
                      }}
                    >
                      Додати нову модель «{visible(asked)}»
                    </button>
                  )}
                </div>
              )}
            {variants.data.items.length > 0 && (
              <div
                className="catalog-found"
                role="radiogroup"
                aria-label="Знайдені товари"
              >
                {variants.data.items.map((item) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={
                      variant?.product_variant_id === item.product_variant_id
                    }
                    key={item.product_variant_id}
                    className="catalog-row"
                    onClick={() => {
                      hideKeyboard();
                      onVariant(item);
                    }}
                  >
                    {visible(item.display_name)}
                  </button>
                ))}
              </div>
            )}
            {(offset > 0 || variants.data.has_more) && (
              <div className="toolbar">
                <button
                  type="button"
                  className="quiet"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - pageSize));
                  }}
                >
                  Попередні
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={!variants.data.has_more}
                  onClick={() => {
                    setOffset(offset + pageSize);
                  }}
                >
                  Ще товари
                </button>
              </div>
            )}
          </>
        ))}
      {variant && (
        <p className="hint">Обрано: {visible(variant.display_name)}</p>
      )}
      {adding !== null && (
        <NewModel
          store={store}
          token={token}
          raw={adding}
          close={() => {
            setAdding(null);
          }}
          done={(added, said) => {
            setAdding(null);
            setAddedFor(asked);
            onVariant(added, said);
          }}
        />
      )}
    </>
  );
}
