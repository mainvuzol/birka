import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText, inOwnWords } from "@/shared/api";
import { visible } from "@/shared/visible";
import type { StoreState } from "@/orders/types";
import {
  resolveStateCommand,
  submitStateCommand,
  useStateCommand,
} from "./commands";
import { stateLabels } from "./types";
import type { Leftover, StoreRecord } from "./types";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";

/**
 * The network's stores and their states (owner decisions, 2026-10-01).
 *
 * The owner of the network blocks a store for a while, archives one that
 * stopped trading, and opens either again, saying why each time. A store
 * that does not trade does nothing: the owner and the network's managers read
 * it, and its own people see only that it is blocked or archived, and since
 * when — never why. Only an empty store is archived.
 */
export function Stores({
  storeId,
  token,
  journalKey,
  blocked,
  changed,
  back,
}: {
  /** The store the owner is working in, which the journal is kept under. */
  storeId: string;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** A state changed: what the app knows of its stores is read again. */
  changed: () => void;
  /** «← Ще» over the heading: a section opened from «Ще» (navigation task
   * list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, error } = useStateCommand();
  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => api<StoreRecord[]>("/stores", token),
    retry: false,
  });
  const [done, setDone] = useState<string | null>(null);

  async function settled(record: StoreRecord): Promise<void> {
    setDone(
      `«${visible(record.name)}»: ${stateLabels[record.state].toLowerCase()}.`,
    );
    await cache.invalidateQueries({ queryKey: ["stores"] });
    changed();
  }

  return (
    <section>
      {back && <BackToMore back={back} />}
      <div className="toolbar">
        <h2>Магазини</h2>
        <button
          className="quiet"
          disabled={stores.isFetching}
          onClick={() => {
            void stores.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        Заблокований чи закритий магазин нічого не робить: ні продажів, ні
        приймання, ні повернень, ні оплат. Ви й менеджери мережі його бачите;
        його люди бачать лише, що магазин заблоковано чи закрито, без причини.
        Борги його покупців приймає будь-який магазин, що працює.
      </p>
      {pending && (
        <section className="notice">
          <h3>
            {busy ? "Перевіряємо зміну стану…" : "Незавершена зміна стану"}
          </h3>
          <p>
            Невідомо, чи змінено стан магазину. Перевірте результат — та сама
            зміна не виконається двічі.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              void resolveStateCommand(journalKey, token, pending).then(
                (outcome) => {
                  if (outcome.kind === "done") void settled(outcome.result);
                  else if (outcome.kind === "refused")
                    setDone(refusalText(outcome.error));
                },
              );
            }}
          >
            Перевірити результат
          </button>
        </section>
      )}
      {done && <p role="status">{done}</p>}
      {error instanceof Error && !(error instanceof ApiError) && (
        <p role="alert">{error.message}</p>
      )}
      {stores.isPending ? (
        <p role="status">Завантажуємо магазини…</p>
      ) : stores.error ? (
        <p role="alert">{errorText(stores.error)}</p>
      ) : (
        stores.data.map((store) => (
          <StoreCard
            key={store.id}
            store={store}
            disabled={blocked || busy || pending !== null}
            change={async (state, reason) => {
              setDone(null);
              const outcome = await submitStateCommand(journalKey, token, {
                // A new transport key per attempt; the change's identity is
                // `command_id`, which is what makes a late retry safe.
                key: crypto.randomUUID(),
                body: {
                  store_id: storeId,
                  target_id: store.id,
                  command_id: crypto.randomUUID(),
                  state,
                  reason,
                },
              });
              if (outcome.kind === "done") {
                await settled(outcome.result);
                return null;
              }
              if (outcome.kind === "refused") {
                await cache.invalidateQueries({ queryKey: ["stores"] });
                return outcome.error;
              }
              return null;
            }}
          />
        ))
      )}
    </section>
  );
}

const actions: Record<StoreState, { to: StoreState; label: string }[]> = {
  ACTIVE: [
    { to: "BLOCKED", label: "Заблокувати" },
    { to: "ARCHIVED", label: "Закрити в архів" },
  ],
  BLOCKED: [
    { to: "ACTIVE", label: "Розблокувати" },
    { to: "ARCHIVED", label: "Закрити в архів" },
  ],
  ARCHIVED: [{ to: "ACTIVE", label: "Відкрити знову" }],
};

const confirmLabels: Record<StoreState, string> = {
  BLOCKED: "Так, заблокувати",
  ARCHIVED: "Так, закрити в архів",
  ACTIVE: "Так, магазин працює",
};

function StoreCard({
  store,
  disabled,
  change,
}: {
  store: StoreRecord;
  disabled: boolean;
  change: (state: StoreState, reason: string) => Promise<ApiError | null>;
}): JSX.Element {
  const [asking, setAsking] = useState<StoreState | null>(null);
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const latest = store.changes[0];
  const leftovers =
    refusal?.details.reason === "NOT_EMPTY"
      ? (refusal.details.leftovers as Leftover[])
      : null;
  return (
    <article
      className="order-card"
      aria-label={`Магазин ${visible(store.name)}`}
    >
      <strong>{visible(store.name)}</strong>
      <small>{visible(store.code)}</small>
      <p>
        <span className="badge" data-state={store.state}>
          {stateLabels[store.state]}
        </span>
        {store.state_since && store.state !== "ACTIVE" && (
          <span> з {when(store.state_since)}</span>
        )}
      </p>
      {latest && store.state !== "ACTIVE" && (
        <p className="hint">Причина: {visible(latest.reason)}</p>
      )}
      {asking ? (
        <div className="notice">
          {asking === "ARCHIVED" ? (
            <p>
              Закрити можна лише порожній магазин: на його власних складах і в
              «Брак» нічого немає, відкритих замовлень немає. Його люди не
              зможуть нічого робити в ньому; відкрити його знову можна пізніше.
            </p>
          ) : asking === "BLOCKED" ? (
            <p>
              У магазині зупиняться продажі, приймання, повернення, оплати й
              замовлення. Його відкриті замовлення чекатимуть, товар під ними
              лишиться заброньованим.
            </p>
          ) : (
            <p>Магазин знову працюватиме, його люди — з тими самими правами.</p>
          )}
          <label>
            Причина (бачите ви й менеджери мережі, не продавці)
            <textarea
              value={reason}
              maxLength={1000}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </label>
          <div className="actions">
            <button
              disabled={disabled || reason.trim() === ""}
              onClick={() => {
                void change(asking, reason.trim()).then((error) => {
                  setRefusal(error);
                  if (error === null) {
                    setAsking(null);
                    setReason("");
                  }
                });
              }}
            >
              {confirmLabels[asking]} «{visible(store.name)}»
            </button>
            <button
              className="quiet"
              onClick={() => {
                setAsking(null);
                setRefusal(null);
              }}
            >
              Скасувати
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          {actions[store.state].map((action) => (
            <button
              key={action.to}
              className={action.to === "ARCHIVED" ? "quiet" : undefined}
              disabled={disabled}
              onClick={() => {
                setRefusal(null);
                setAsking(action.to);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {refusal && (
        <div role="alert">
          <p>{refusalText(refusal)}</p>
          {leftovers && (
            <ul aria-label="Що лишилось у магазині">
              {leftovers.map((left) =>
                left.kind === "ORDERS" ? (
                  <li key="orders">Відкриті замовлення: {left.count}</li>
                ) : (
                  <li key={left.location_id}>
                    {left.kind === "DAMAGED" ? "Брак" : "Власний склад"} «
                    {visible(left.name)}»: {left.units} од.
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
      {store.changes.length > 0 && (
        <details>
          <summary>Історія змін</summary>
          <ul aria-label={`Історія: ${visible(store.name)}`}>
            {store.changes.map((item, index) => (
              <li key={`${item.at}:${String(index)}`}>
                {when(item.at)} · {stateLabels[item.from_state]} →{" "}
                {stateLabels[item.to_state]} · {visible(item.by)} ·{" "}
                {visible(item.reason)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.details.reason) {
      case "NOT_EMPTY":
        return "Закрити в архів можна лише порожній магазин. Спершу продайте, перемістіть чи спишіть те, що лишилось, і завершіть замовлення:";
      case "ALREADY":
        return "Магазин уже в цьому стані. Список оновлено.";
      case "NOT_FROM_ARCHIVE":
        return "Закритий магазин не блокують — його відкривають знову.";
      case "NO_REASON":
        return "Вкажіть причину.";
    }
  }
  return inOwnWords(
    errorText(error),
    "Стан магазину не змінено. Перевірте причину та спробуйте ще раз.",
    "Стан магазину не змінено: його змінили — перегляньте його й спробуйте ще раз.",
  );
}
