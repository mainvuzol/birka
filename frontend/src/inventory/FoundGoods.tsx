import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api";
import { Back } from "@/shared/Back";
import { Icon } from "@/shared/Icon";
import { Placeholder } from "@/shared/Placeholder";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Unread } from "@/shared/Unread";
import { buzz, hideKeyboard } from "@/shared/telegram";
import { visible } from "@/shared/visible";
import type { Store } from "@/orders/types";
import { AddedStub, CatalogPicker } from "./CatalogPicker";
import type { ReceivableVariant, SizeOption } from "./receiptTypes";

/** What the ledger holds of a size found, where the screen knows it. */
export interface Held {
  quantity: number;
  reserved: number;
}

/**
 * «Знайшли товар, якого немає в списку» (goods task list after stage 2,
 * P1-2): goods on the shelf the system holds none of here, on a screen of
 * their own — one for the stocktake's entry and its count. «←» back where
 * it was opened, and Telegram's «Назад»; the menu aside, as a task's screen.
 *
 * The model found in the catalogue as it is typed, the cursor in its field
 * at once; one the catalogue has not, added in the sheet «Нова модель» over
 * this screen, whose words stay. Chosen, the organization's sizes as cells
 * 60 × 60, in its order; a cell tapped is the size, the keyboard hidden —
 * the count's sheet, or the correction's, opens over the screen. At the
 * count a cell says what the ledger holds as the list read it, «в обліку 0»
 * where it holds none. Counted against that: one held after all is refused
 * by the server, which says how many.
 *
 * No `<select>`, no «Скасувати», no MainButton of its own: the sheet's is
 * the one there is.
 */
export function FoundGoods({
  store,
  token,
  scopeKey,
  blocked,
  back,
  ledger,
  pick,
}: {
  store: Store;
  token: string;
  scopeKey: string;
  blocked: boolean;
  /** «← Інвентаризація», its name read aloud. */
  back: { go: () => void; label: string };
  /** At the count: what the ledger holds of a cell, «в обліку N». */
  ledger?: ((variant: ReceivableVariant, size: SizeOption) => Held) | undefined;
  pick: (variant: ReceivableVariant, size: SizeOption) => void;
}): JSX.Element {
  const [variant, setVariant] = useState<ReceivableVariant | null>(null);
  // A model added from an empty search: its stub, till another is chosen.
  const [added, setAdded] = useState<string | null>(null);
  const sizes = useQuery({
    queryKey: ["receive-sizes", scopeKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    retry: false,
  });
  // Where the cursor goes once the model changes: its name once chosen,
  // the catalogue's field once it is changed, as receiving does.
  const modelName = useRef<HTMLParagraphElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const focusNext = useRef<"model" | "search" | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    focusNext.current = null;
    if (next === "model") modelName.current?.focus();
    else if (next === "search") picker.current?.querySelector("input")?.focus();
  }, [variant]);
  // Opened: from its top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  function choose(next: ReceivableVariant | null, said?: string): void {
    focusNext.current = next ? "model" : "search";
    setVariant(next);
    setAdded(said ?? null);
  }

  return (
    <>
      <ScreenHeader
        wraps
        title="Товар, якого немає в списку"
        back={
          <Back go={back.go} label={back.label}>
            <span aria-hidden="true">← </span>Інвентаризація
          </Back>
        }
      />
      <section className="found-goods" aria-label="Товар, якого немає в списку">
        <p className="hint">
          Якщо товар уже є в обліку цього складу, сервер скаже, скільки саме.
        </p>
        {variant ? (
          <>
            <div className="receive-model">
              <p className="t-row" ref={modelName} tabIndex={-1}>
                {visible(variant.display_name)}
              </p>
              <button
                type="button"
                className="quiet"
                aria-label={`Змінити модель ${visible(variant.display_name)}`}
                disabled={blocked}
                onClick={() => {
                  choose(null);
                }}
              >
                Змінити
              </button>
            </div>
            <AddedStub said={added} />
            {sizes.isPending ? (
              // The cells in grey where they come (spec §6.13).
              <Placeholder said="Завантажуємо розміри…" cells={4} />
            ) : sizes.data === undefined ? (
              <Unread
                error={sizes.error}
                retry={() => {
                  void sizes.refetch();
                }}
              />
            ) : (
              <div
                className="cells found-cells"
                role="group"
                aria-label="Розмір"
              >
                {sizes.data.map((size) => {
                  const held = ledger?.(variant, size);
                  return (
                    <button
                      type="button"
                      key={size.size_id}
                      className="size-cell"
                      aria-label={
                        held
                          ? [
                              visible(size.code),
                              `в обліку ${String(held.quantity)}`,
                              ...(held.reserved > 0
                                ? [`у резерві ${String(held.reserved)}`]
                                : []),
                            ].join(", ")
                          : undefined
                      }
                      aria-haspopup="dialog"
                      disabled={blocked}
                      onClick={() => {
                        // The sheet's keypad is the app's: never the
                        // phone's keyboard over it (spec §6.3).
                        hideKeyboard();
                        buzz("selection");
                        pick(variant, size);
                      }}
                    >
                      <span className="size-letter">{visible(size.code)}</span>
                      {held && (
                        <span className="size-free">
                          в обліку {held.quantity}
                        </span>
                      )}
                      {held && held.reserved > 0 && (
                        <span className="size-held">
                          <Icon name="held" size={12} />
                          {held.reserved}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div ref={picker}>
            <CatalogPicker
              store={store}
              token={token}
              scopeKey={scopeKey}
              variant={null}
              onVariant={(picked, said) => {
                if (picked) choose(picked, said);
              }}
              adds
              autoFocus
            />
          </div>
        )}
      </section>
    </>
  );
}
